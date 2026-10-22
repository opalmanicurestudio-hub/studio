import { NextRequest, NextResponse } from 'next/server';
import { staffOrServer } from '@/lib/route-guard';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';
import { effectiveUnitCents } from '@/lib/retail-swap';
import { taxShareCents } from '@/lib/restocking';
import { cardRefundableCents } from '@/lib/retail-money';
import { cancelWithFollowUps, followUpsOf, isFollowUp } from '@/lib/order-family';
import { autoRefund, refundWords, type AutoRefund } from '@/lib/auto-refund';
import { roomCents } from '@/lib/non-card-back';

// ─── /api/retail/preorder-run-cancel ─────────────────────────────────────────
// The supplier fell through. Forty people are holding a promise you can't
// keep, and doing that by hand — find each order, cancel it, queue a refund,
// write an apology — is exactly the kind of afternoon that makes a shop owner
// avoid pre-orders forever.
//
// What this does, per affected order, in one pass:
//   · Cancels the pre-order line (status 'refunded', qtyShorted = what was
//     owed) and queues what was paid for it, with its tax, via
//     pendingRefundCents — the same pattern the claims desk uses. Within the
//     shop's automatic amount it goes back straight away (lib/auto-refund);
//     over it, a person sends it from Problems.
//   · Cancels the WHOLE order only when nothing else was on it. A mixed
//     order keeps its in-stock items and ships as normal — nobody loses
//     their gel because a kit fell through. An order cancelled this way gives
//     back everything paid on it (shipping too), card first, then what a gift
//     card or store credit paid (lib/cancel-restore), less anything made from
//     it that is still coming.
//   · Emails each customer plainly: what happened, what comes back, and
//     whether it has gone or is approved and on its way soon.
//   · Closes the run so the product stops selling immediately.
// Every order with the product is reached, page by page, however many there are.
//
// Idempotent per line: a re-run finds nothing left to cancel, so a nervous
// double-tap can't double-refund.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = 200;
const MAX_PAGES = 50;
const money = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
const open = (l: any, productId: string) => l.productId === productId && l.preorder === true && !['refunded', 'cancelled'].includes(String(l.status));
const owedOf = (l: any) => Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0));

/** What the run's items on this order were paid for, with their tax, and whether anything else is left to send. */
function runShare(order: any, productId: string) {
  const items = (order.lines || []).filter((l: any) => open(l, productId)).reduce((s: number, l: any) => s + effectiveUnitCents(l) * owedOf(l), 0);
  const stillOwed = (order.lines || []).some((l: any) => !open(l, productId)
    && !['refunded', 'cancelled', 'backordered'].includes(String(l.status)) && owedOf(l) > 0);
  return { items, cents: items ? items + taxShareCents(order, items) : 0, stillOwed };
}

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
    if (!(await staffOrServer(req, String(tenantId || '')))) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });   // staff, or our own server — never the public
    const productId = String(body.productId || '').trim();
    const reason = String(body.reason || '').trim().slice(0, 300);
    const dryRun = body.dryRun === true;
    if (!tenantId || !productId) {
      return NextResponse.json({ error: 'Product is required.' }, { status: 400 });
    }

    const db = getAdminDb();
    const ordersCol = db.collection(`tenants/${tenantId}/retailOrders`);

    // Every order with pre-order items, page by page (one field, so no composite index); stage filtered in memory.
    const affected: any[] = [];
    let after: any = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      let q = ordersCol.where('hasPreorder', '==', true).orderBy('__name__').limit(PAGE);
      if (after) q = q.startAfter(after);
      const snap = await q.get();
      for (const d of snap.docs) {
        const o: any = { id: d.id, ref: d.ref, ...(d.data() as any) };
        if (OPEN_STAGES.includes(String(o.stage)) && (o.lines || []).some((l: any) => open(l, productId))) affected.push(o);
      }
      if (snap.docs.length < PAGE) break;
      after = snap.docs[snap.docs.length - 1];
    }

    if (dryRun) {
      // An order left with nothing to send gives back everything paid on it (shipping too, and what a gift card or store
      // credit paid), not just the item.
      return NextResponse.json({
        ok: true, dryRun: true,
        orders: affected.length,
        refundCents: affected.reduce((sum: number, o: any) => {
          const share = runShare(o, productId);
          return sum + (!share.stillOwed && !isFollowUp(o) ? Math.max(Number(o.pendingRefundCents) || 0, cardRefundableCents(o)) + roomCents(o) : share.cents);
        }, 0),
      });
    }

    const brand = await getEmailBrand(db, tenantId);
    const origin = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl?.origin || '').trim().replace(/\/+$/, '');
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
    let cancelledOrders = 0;
    let refundCents = 0;
    let sentCents = 0;
    let emailed = 0;

    for (const o of affected) {
      try {
        const outcome = await db.runTransaction(async (txn: any) => {
          const fresh = await txn.get(o.ref);
          if (!fresh.exists) return null;
          const order = { ...(fresh.data() as any), id: o.id };
          if (!OPEN_STAGES.includes(String(order.stage))) return null;
          const share = runShare(order, productId);
          if (share.items === 0) return null;
          const follow = isFollowUp(order);
          // The order the customer paid on, left with nothing to send: everything it hasn't given back yet goes back,
          // less what's still coming on orders made from it (a backorder of something else keeps going).
          const fam = !share.stillOwed && !follow ? await followUpsOf((r: any) => txn.get(r), ordersCol, o.id) : [];

          const lines = (order.lines || []).map((l: any) => (open(l, productId)
            ? { ...l, status: 'refunded', qtyShorted: (Number(l.qtyShorted) || 0) + owedOf(l), shortReason: 'run_cancelled' }
            : l));
          // Cancelled outright, the order it was paid on gives back what its card hasn't had back (covering anything
          // already queued), as a cancellation does (lib/retail-fulfill cancelOrder); its gift card and store credit
          // follow after (lib/cancel-restore). Otherwise the run's items come back with their tax, on top.
          const already = Math.max(0, Number(order.pendingRefundCents) || 0);
          const pending = !share.stillOwed && !follow ? Math.max(already, cancelWithFollowUps(order, fam, () => false).pendingCents) : already + share.cents;
          const update: any = { lines, pendingRefundCents: pending };
          if (!share.stillOwed) {
            update.stage = 'cancelled';
            update.cancelledAt = new Date().toISOString();
            update.cancelReason = reason || 'Pre-order run cancelled by the shop';
            // A question about swapping one of its items no longer applies.
            if (order.swapOffer?.status === 'waiting') { update.swapOffer = { ...order.swapOffer, status: 'closed', closedAt: update.cancelledAt, closedWhy: 'order cancelled' }; update.swapPendingPhone = null; }
          }
          txn.update(o.ref, update);

          const ev = o.ref.collection('events').doc();
          txn.set(ev, {
            id: ev.id, type: 'note', at: new Date().toISOString(),
            actorId: 'staff', actorName: 'Shop',
            meta: {
              text: `Pre-order run cancelled: ${money(pending - already)} refund queued${share.stillOwed ? ' (the rest of the order still ships)' : ' and the order was cancelled'}${reason ? ` \u00b7 ${reason}` : ''}`,
            },
          });
          return { order, cents: pending - already, stillOwed: share.stillOwed, names: [...new Set((order.lines || []).filter((l: any) => open(l, productId)).map((l: any) => String(l.name || 'item')))] };
        });

        if (!outcome) continue;
        cancelledOrders += 1;
        refundCents += outcome.cents;

        // An order cancelled outright gives back its gift card and store credit too (lib/cancel-restore), and within
        // the shop's automatic amount the rest goes back now (lib/auto-refund).
        let restored = { giftCents: 0, creditCents: 0 };
        if (!outcome.stillOwed) {
          try { const { restoreNonCardPayment } = await import('@/lib/cancel-restore'); restored = await restoreNonCardPayment(db, tenantId, o.id, 'Pre-order run cancelled'); } catch { /* the nightly check gives it back */ }
        }
        const sent: AutoRefund = await autoRefund(db, tenantId, o.id, origin);
        refundCents += restored.giftCents + restored.creditCents;
        sentCents += (sent.sent ? sent.cents : 0) + restored.giftCents + restored.creditCents;

        const to = String(outcome.order.customerEmail || '').trim();
        if (!RESEND_API_KEY || !RESEND_FROM || !to) continue;
        const firstName = String(outcome.order.customerName || '').trim().split(/\s+/)[0] || 'there';
        const orderLink = origin ? `${origin}/shop/${tenantId}/order/${o.id}` : '';
        const what = outcome.names.join(' and ') || 'the item you pre-ordered';
        const back = [restored.giftCents ? `${money(restored.giftCents)} is back on your gift card` : '', restored.creditCents ? `${money(restored.creditCents)} is back as store credit` : ''].filter(Boolean).join(' and ');
        const html = brandedEmail(brand, `
          <p style="font-size:14px;color:#0f172a;font-weight:700;margin:0 0 8px">Hi ${firstName},</p>
          <p style="font-size:14px;color:#334155;line-height:1.6">
            Unfortunately, we are unable to fulfill your pre-order of ${what.replace(/</g, '&lt;')}${outcome.stillOwed ? '' : ', so we have cancelled your order'}. There is nothing you need to do.
          </p>
          ${reason ? `<p style="font-size:13px;color:#334155;line-height:1.6;border-left:3px solid #e2e8f0;padding-left:12px;margin:14px 0">${reason.replace(/</g, '&lt;')}</p>` : ''}
          <p style="font-size:14px;color:#334155;line-height:1.6">
            ${outcome.cents > 0 ? refundWords(outcome.cents, sent) : ''}${back ? ` ${back.charAt(0).toUpperCase()}${back.slice(1)}.` : ''}${outcome.stillOwed ? ' The rest of your order is unaffected and is still on its way.' : ''}
          </p>
          ${orderLink ? emailButton(orderLink, 'View my order', brand) : ''}
          <p style="font-size:14px;color:#334155;line-height:1.6">
            We sincerely apologize for the disappointment and for keeping you waiting. If you have any questions, please reply to this email.
          </p>
          <p style="font-size:14px;color:#334155;line-height:1.6;margin:16px 0 0">Kind regards,<br>${brand.shopName}</p>`,
          { preheader: `We are unable to fulfill your pre-order${outcome.cents > 0 ? `, and ${money(outcome.cents)} comes back to you` : ''}.` });

        const { sendNotification } = await import('@/lib/notify');
        await sendNotification(db, {
          tenantId, channel: 'email', to: to,
            subject: `${brand.shopName}: an update about your pre-order`,
            html,
          kind: 'preorder_cancelled', recipientType: 'client', orderId: o.id,
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

    return NextResponse.json({ ok: true, orders: cancelledOrders, refundCents, sentCents, emailed });
  } catch (err: any) {
    console.error('[run-cancel] failed:', err?.message);
    return NextResponse.json({ error: 'Could not cancel the run.' }, { status: 500 });
  }
}
