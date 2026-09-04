import { NextRequest, NextResponse } from 'next/server';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';

// ─── /api/retail/preorder-run-cancel ─────────────────────────────────────────
// The supplier fell through. Forty people are holding a promise you can't
// keep, and doing that by hand — find each order, cancel it, queue a refund,
// write an apology — is exactly the kind of afternoon that makes a shop owner
// avoid pre-orders forever.
//
// What this does, per affected order, in one pass:
//   · Cancels the pre-order line (status 'refunded', qtyShorted = what was
//     owed) and queues the money via pendingRefundCents — the same pattern
//     the claims desk uses. A PERSON still executes the refund in Stripe;
//     software that moves money on its own is how books get out of sync.
//   · Cancels the WHOLE order only when nothing else was on it. A mixed
//     order keeps its in-stock items and ships as normal — nobody loses
//     their gel because a kit fell through.
//   · Emails each customer plainly: what happened, what they're owed, when.
//   · Closes the run so the product stops selling immediately.
//
// Idempotent per line: a re-run finds nothing left to cancel, so a nervous
// double-tap can't double-refund.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ORDERS = 200;

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let app = getApps().find((a: any) => a.name === 'retail-run-cancel');
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    }, 'retail-run-cancel');
  }
  return getFirestore(app);
}

const OPEN_STAGES = ['paid', 'picking', 'packed', 'ready'];

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    const tenantId = String(body.tenantId || '').trim();
    const productId = String(body.productId || '').trim();
    const reason = String(body.reason || '').trim().slice(0, 300);
    const dryRun = body.dryRun === true;
    if (!tenantId || !productId) {
      return NextResponse.json({ error: 'Product is required.' }, { status: 400 });
    }

    const db = getAdminDb();
    const ordersCol = db.collection(`tenants/${tenantId}/retailOrders`);

    // Single-field query (no composite index prompt); stage filtered in memory.
    const snap = await ordersCol.where('hasPreorder', '==', true).limit(MAX_ORDERS).get();
    const affected = snap.docs
      .map((d: any) => ({ id: d.id, ref: d.ref, ...(d.data() as any) }))
      .filter((o: any) =>
        OPEN_STAGES.includes(String(o.stage)) &&
        (o.lines || []).some((l: any) => l.productId === productId && l.preorder === true
          && !['refunded', 'cancelled'].includes(String(l.status))));

    if (dryRun) {
      return NextResponse.json({
        ok: true, dryRun: true,
        orders: affected.length,
        refundCents: affected.reduce((sum: number, o: any) => sum + (o.lines || [])
          .filter((l: any) => l.productId === productId && l.preorder === true && !['refunded', 'cancelled'].includes(String(l.status)))
          .reduce((s: number, l: any) => s + (l.unitPriceCents || 0) * Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0)), 0), 0),
      });
    }

    const brand = await getEmailBrand(db, tenantId);
    const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
    let cancelledOrders = 0;
    let refundCents = 0;
    let emailed = 0;

    for (const o of affected) {
      try {
        const outcome = await db.runTransaction(async (txn: any) => {
          const fresh = await txn.get(o.ref);
          if (!fresh.exists) return null;
          const order = fresh.data() as any;
          if (!OPEN_STAGES.includes(String(order.stage))) return null;

          let lineRefund = 0;
          const lines = (order.lines || []).map((l: any) => {
            if (l.productId !== productId || l.preorder !== true) return l;
            if (['refunded', 'cancelled'].includes(String(l.status))) return l;
            const owed = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
            lineRefund += (l.unitPriceCents || 0) * owed;
            return { ...l, status: 'refunded', qtyShorted: (l.qtyShorted || 0) + owed, shortReason: 'run_cancelled' };
          });
          if (lineRefund === 0) return null;

          // Anything left to fulfil? Then the order lives on.
          const stillOwed = lines.some((l: any) =>
            !['refunded', 'cancelled', 'backordered'].includes(String(l.status))
            && Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0)) > 0);

          const update: any = {
            lines,
            pendingRefundCents: (Number(order.pendingRefundCents) || 0) + lineRefund,
          };
          if (!stillOwed) {
            update.stage = 'cancelled';
            update.cancelledAt = new Date().toISOString();
            update.cancelReason = reason || 'Pre-order run cancelled by the shop';
          }
          txn.update(o.ref, update);

          const ev = o.ref.collection('events').doc();
          txn.set(ev, {
            id: ev.id, type: 'note', at: new Date().toISOString(),
            actorId: 'staff', actorName: 'Shop',
            meta: {
              text: `Pre-order run cancelled \u2014 $${(lineRefund / 100).toFixed(2)} refund queued${stillOwed ? ' (rest of the order still ships)' : ' and the order was cancelled'}${reason ? ` \u00b7 ${reason}` : ''}`,
            },
          });
          return { order, lineRefund, stillOwed };
        });

        if (!outcome) continue;
        cancelledOrders += 1;
        refundCents += outcome.lineRefund;

        const to = String(outcome.order.customerEmail || '').trim();
        if (!RESEND_API_KEY || !RESEND_FROM || !to) continue;
        const firstName = String(outcome.order.customerName || '').trim().split(/\s+/)[0] || 'there';
        const orderLink = origin ? `${origin}/shop/${tenantId}/order/${o.id}` : '';
        const html = brandedEmail(brand, `
          <p style="font-size:14px;color:#0f172a;font-weight:700;margin:0 0 8px">Hi ${firstName},</p>
          <p style="font-size:14px;color:#334155;line-height:1.6">
            We\u2019re sorry \u2014 we can\u2019t fulfil the pre-order you placed with us, so we\u2019re refunding you <strong>$${(outcome.lineRefund / 100).toFixed(2)}</strong> in full. You don\u2019t need to do anything.
          </p>
          ${reason ? `<p style="font-size:13px;color:#334155;line-height:1.6;border-left:3px solid #e2e8f0;padding-left:12px;margin:14px 0">${reason.replace(/</g, '&lt;')}</p>` : ''}
          <p style="font-size:14px;color:#334155;line-height:1.6">
            The refund goes back to the card you paid with, usually within 5\u201310 days.${outcome.stillOwed ? ' The rest of your order is unaffected and still on its way.' : ''}
          </p>
          ${orderLink ? emailButton(orderLink, 'View my order', brand) : ''}
          <p style="font-size:12px;color:#94a3b8;line-height:1.6">
            We know that\u2019s disappointing, and we\u2019re sorry to have kept you waiting. Reply to this email any time.
          </p>`,
          { preheader: `Refunding $${(outcome.lineRefund / 100).toFixed(2)} \u2014 your pre-order can\u2019t be fulfilled` });

        const { sendNotification } = await import('@/lib/notify');
        await sendNotification(db, {
          tenantId, channel: 'email', to: to,
            subject: `About your pre-order \u2014 ${brand.shopName}`,
            html,
          kind: 'preorder_cancelled', recipientType: 'client',
        });
        emailed += 1;
      } catch (e: any) {
        console.error('[run-cancel] order failed, continuing:', o.id, e?.message);
      }
    }

    // Close the run so nobody joins something that no longer exists.
    try {
      await db.collection(`tenants/${tenantId}/inventory`).doc(productId).set({
        preorder: false,
        preorderRunCancelledAt: new Date().toISOString(),
      }, { merge: true });
    } catch (e: any) {
      console.error('[run-cancel] could not close the run:', e?.message);
    }

    return NextResponse.json({ ok: true, orders: cancelledOrders, refundCents, emailed });
  } catch (err: any) {
    console.error('[run-cancel] failed:', err?.message);
    return NextResponse.json({ error: 'Could not cancel the run.' }, { status: 500 });
  }
}
