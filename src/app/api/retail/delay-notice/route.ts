import { NextRequest, NextResponse } from 'next/server';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';

// ─── /api/retail/delay-notice ────────────────────────────────────────────────
// The shop's half of the FTC Mail, Internet, or Telephone Order Rule.
//
// The rule: when you can't ship by the date you promised, you owe the buyer
// a notice with a REVISED date and a plain way to cancel for a full refund.
// Their silence is not consent to keep waiting — which is why this email
// leads with the cancel option instead of burying it.
//
// Mechanics that keep it honest:
//   · The revised date REPLACES the promise on the order, so the customer's
//     late-order banner and their unconditional cancel right both re-arm
//     against the new date. A revised promise you can't keep is late again.
//   · Idempotent per revised date (notifiedForPromiseAt === shipPromiseAt),
//     the same guard the claim decisions use — a double-tap sends nothing,
//     a genuinely NEW date earns exactly one email.
//   · Every notice lands on the order's event ledger with both dates, so a
//     dispute months later can be answered with a record rather than memory.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let app = getApps().find((a: any) => a.name === 'retail-delay-notice');
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    }, 'retail-delay-notice');
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
    const orderId = String(body.orderId || '').trim();
    const revisedDate = String(body.revisedDate || '').trim();   // YYYY-MM-DD
    const note = String(body.note || '').trim().slice(0, 400);
    if (!tenantId || !orderId || !revisedDate) {
      return NextResponse.json({ error: 'Order and a new date are required.' }, { status: 400 });
    }
    const revisedAt = new Date(`${revisedDate}T23:59:59`);
    if (Number.isNaN(revisedAt.getTime())) {
      return NextResponse.json({ error: 'That date isn\u2019t readable.' }, { status: 400 });
    }

    const db = getAdminDb();
    const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);

    // Claim the send inside the transaction, then email after it commits:
    // a crash loses one email, never sends two.
    const claimed = await db.runTransaction(async (txn: any) => {
      const snap = await txn.get(orderRef);
      if (!snap.exists) return null;
      const o = snap.data() as any;
      if (['shipped', 'handed_off', 'completed', 'cancelled', 'refunded'].includes(String(o.stage))) return null;
      const promiseIso = revisedAt.toISOString();
      if (o.notifiedForPromiseAt === promiseIso) return null;
      txn.update(orderRef, {
        shipPromiseAt: promiseIso,
        notifiedForPromiseAt: promiseIso,
        promiseRevisions: (Number(o.promiseRevisions) || 0) + 1,
      });
      const ev = orderRef.collection('events').doc();
      txn.set(ev, {
        id: ev.id, type: 'note', at: new Date().toISOString(),
        actorId: 'staff', actorName: 'Shop',
        meta: {
          text: `Delay notice sent \u2014 new ship-by ${revisedDate}${o.shipPromiseAt ? ` (was ${String(o.shipPromiseAt).slice(0, 10)})` : ''}${note ? ` \u00b7 ${note}` : ''}`,
        },
      });
      return { ...o, shipPromiseAt: promiseIso };
    });

    if (!claimed) return NextResponse.json({ ok: true, sent: false });

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
    const to = String(claimed.customerEmail || '').trim();
    if (!RESEND_API_KEY || !RESEND_FROM || !to) {
      return NextResponse.json({ ok: true, sent: false, why: 'email not configured' });
    }

    const brand = await getEmailBrand(db, tenantId);
    const firstName = String(claimed.customerName || '').trim().split(/\s+/)[0] || 'there';
    const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
    const orderLink = origin ? `${origin}/shop/${tenantId}/order/${orderId}` : '';
    const pretty = revisedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const html = brandedEmail(brand, `
      <p style="font-size:14px;color:#0f172a;font-weight:700;margin:0 0 8px">Hi ${firstName},</p>
      <p style="font-size:14px;color:#334155;line-height:1.6">
        Your order #${String(claimed.orderNumber ?? '').padStart(4, '0')} is taking longer than we said it would. We now expect it to ship by <strong>${pretty}</strong>.
      </p>
      ${note ? `<p style="font-size:13px;color:#334155;line-height:1.6;border-left:3px solid #e2e8f0;padding-left:12px;margin:14px 0">${note.replace(/</g, '&lt;')}</p>` : ''}
      <p style="font-size:14px;color:#334155;line-height:1.6">
        You don\u2019t have to wait. If the new date doesn\u2019t work for you, cancel from your order page and we\u2019ll refund you in full \u2014 no reason needed, nothing to explain.
      </p>
      ${orderLink ? emailButton(orderLink, 'Wait or cancel \u2014 my order', brand) : ''}
      <p style="font-size:12px;color:#94a3b8;line-height:1.6">
        We\u2019re sorry for the wait. If you\u2019d rather talk it through, just reply to this email.
      </p>`,
      { preheader: `New ship-by date: ${pretty} \u2014 or cancel for a full refund` });

    const { sendNotification } = await import('@/lib/notify');
    await sendNotification(db, {
      tenantId, channel: 'email',
        to: to,
        subject: `Your order is running late \u2014 ${brand.shopName}`,
        html,
      kind: 'order_delayed', recipientType: 'client',
    });

    return NextResponse.json({ ok: true, sent: true });
  } catch (err: any) {
    console.error('[delay-notice] failed:', err?.message);
    return NextResponse.json({ error: 'Could not send the notice.' }, { status: 500 });
  }
}
