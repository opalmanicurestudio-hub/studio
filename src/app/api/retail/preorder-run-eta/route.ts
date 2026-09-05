import { NextRequest, NextResponse } from 'next/server';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';

// ─── /api/retail/preorder-run-eta ────────────────────────────────────────────
// "The kits slipped to February." Telling forty people BEFORE the date they
// were promised passes is the difference between a shop that communicates and
// one that goes quiet — and under the FTC rule, a revised date offered with a
// cancellation option is exactly what a delay requires. Waiting for the
// promise to lapse first is legal-minimum behaviour; this is the version a
// customer forgives.
//
// One pass over the run:
//   · The item's promised date moves, so new buyers see the truth.
//   · Every OPEN order holding that pre-order gets its line date and its
//     order-level promise moved to the new date, keeping the customer's
//     late-order banner and refund right armed against reality.
//   · Each customer gets one email: what slipped, the new date, and a plain
//     way out. Idempotent per date — re-running sends nothing.
//
// Not applied to shipped, handed-off, completed, cancelled or refunded
// orders: their promise is already settled, and re-opening it would be noise.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPEN_STAGES = ['paid', 'picking', 'packed', 'ready'];
const MAX_ORDERS = 200;

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let app = getApps().find((a: any) => a.name === 'retail-run-eta');
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    }, 'retail-run-eta');
  }
  return getFirestore(app);
}

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
    const newDate = String(body.newDate || '').trim();       // YYYY-MM-DD
    const note = String(body.note || '').trim().slice(0, 400);
    const dryRun = body.dryRun === true;
    if (!tenantId || !productId || (!newDate && !dryRun)) {
      return NextResponse.json({ error: 'Product and a new date are required.' }, { status: 400 });
    }
    const revisedAt = newDate ? new Date(`${newDate}T23:59:59`) : null;
    if (newDate && (!revisedAt || Number.isNaN(revisedAt.getTime()))) {
      return NextResponse.json({ error: 'That date isn\u2019t readable.' }, { status: 400 });
    }

    const db = getAdminDb();
    const ordersCol = db.collection(`tenants/${tenantId}/retailOrders`);
    const snap = await ordersCol.where('hasPreorder', '==', true).limit(MAX_ORDERS).get();
    const affected = snap.docs
      .map((d: any) => ({ id: d.id, ref: d.ref, ...(d.data() as any) }))
      .filter((o: any) =>
        OPEN_STAGES.includes(String(o.stage)) &&
        (o.lines || []).some((l: any) => l.productId === productId && l.preorder === true
          && !['refunded', 'cancelled'].includes(String(l.status))));

    if (dryRun) return NextResponse.json({ ok: true, dryRun: true, orders: affected.length });

    const promiseIso = (revisedAt as Date).toISOString();
    const brand = await getEmailBrand(db, tenantId);
    const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
    const pretty = (revisedAt as Date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    let updated = 0;
    let emailed = 0;

    for (const o of affected) {
      try {
        const claimed = await db.runTransaction(async (txn: any) => {
          const fresh = await txn.get(o.ref);
          if (!fresh.exists) return null;
          const order = fresh.data() as any;
          if (!OPEN_STAGES.includes(String(order.stage))) return null;
          if (order.notifiedForPromiseAt === promiseIso) return null;

          // Capture the outgoing date BEFORE the write: the ledger line is
          // only useful if it says what the promise moved FROM.
          const wasPromise = order.shipPromiseAt ? String(order.shipPromiseAt).slice(0, 10) : '';
          const lines = (order.lines || []).map((l: any) =>
            l.productId === productId && l.preorder === true && !['refunded', 'cancelled'].includes(String(l.status))
              ? { ...l, preorderEtaAt: newDate }
              : l);
          txn.update(o.ref, {
            lines,
            shipPromiseAt: promiseIso,
            notifiedForPromiseAt: promiseIso,
            promiseRevisions: (Number(order.promiseRevisions) || 0) + 1,
          });
          const ev = o.ref.collection('events').doc();
          txn.set(ev, {
            id: ev.id, type: 'note', at: new Date().toISOString(),
            actorId: 'staff', actorName: 'Shop',
            meta: { text: `Pre-order date moved to ${newDate}${wasPromise ? ` (was ${wasPromise})` : ''}${note ? ` \u00b7 ${note}` : ''}` },
          });
          return order;
        });
        if (!claimed) continue;
        updated += 1;

        const to = String(claimed.customerEmail || '').trim();
        if (!RESEND_API_KEY || !RESEND_FROM || !to) continue;
        const firstName = String(claimed.customerName || '').trim().split(/\s+/)[0] || 'there';
        const orderLink = origin ? `${origin}/shop/${tenantId}/order/${o.id}` : '';
        const html = brandedEmail(brand, `
          <p style="font-size:14px;color:#0f172a;font-weight:700;margin:0 0 8px">Hi ${firstName},</p>
          <p style="font-size:14px;color:#334155;line-height:1.6">
            A heads-up before the date we gave you passes: your pre-order is now expected to ship by <strong>${pretty}</strong>.
          </p>
          ${note ? `<p style="font-size:13px;color:#334155;line-height:1.6;border-left:3px solid #e2e8f0;padding-left:12px;margin:14px 0">${note.replace(/</g, '&lt;')}</p>` : ''}
          <p style="font-size:14px;color:#334155;line-height:1.6">
            Happy to keep it for you \u2014 nothing to do, we\u2019ll email tracking the moment it ships. If the new date doesn\u2019t work, cancel from your order page and we\u2019ll refund you in full, no reason needed.
          </p>
          ${orderLink ? emailButton(orderLink, 'Keep waiting or cancel', brand) : ''}
          <p style="font-size:12px;color:#94a3b8;line-height:1.6">Thanks for your patience \u2014 reply any time.</p>`,
          { preheader: `New date: ${pretty} \u2014 keep it or cancel for a full refund` });

        const { sendNotification } = await import('@/lib/notify');
        await sendNotification(db, {
          tenantId, channel: 'email', to: to,
            subject: `Your pre-order: new date \u2014 ${brand.shopName}`,
            html,
          kind: 'preorder_eta', recipientType: 'client',
        });
        emailed += 1;
      } catch (e: any) {
        console.error('[run-eta] order failed, continuing:', o.id, e?.message);
      }
    }

    // Move the product's own promise last, so new buyers see the honest date
    // even if some notices failed.
    try {
      await db.collection(`tenants/${tenantId}/inventory`).doc(productId).set({ preorderEtaAt: newDate }, { merge: true });
    } catch (e: any) {
      console.error('[run-eta] could not update the product date:', e?.message);
    }

    return NextResponse.json({ ok: true, orders: updated, emailed });
  } catch (err: any) {
    console.error('[run-eta] failed:', err?.message);
    return NextResponse.json({ error: 'Could not update the run.' }, { status: 500 });
  }
}
