import { NextRequest, NextResponse } from 'next/server';

import { getAdminDb } from '@/lib/firebase-admin';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/retail/return-notify — "we received your items, here's what
 * happened", fired when a return resolves. One email, three arms:
 *
 *   refund       → the exact amount heading back to their card (with the
 *                  return-shipping deduction disclosed when the policy took it)
 *   store_credit → the credit issued AND their new balance — this route
 *                  claims the credit doc's grantEmailAt itself, so the
 *                  separate grant email can never double up
 *   replacement  → the no-charge replacement shipment now in the queue
 *
 * Idempotent by claim on the return doc (outcomeEmailAt), so retries and
 * double-fires send exactly once.
 */

const str = (v: any, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const money = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const tenantId = str(body?.tenantId, 120);
    const returnId = str(body?.returnId, 200);
    if (!tenantId || !returnId) {
      return NextResponse.json({ ok: false, error: 'Missing tenant or return.' }, { status: 400 });
    }

    const db = getAdminDb();

    // Policy gate — mandatory kind; present for custom wording, fails open.
    try {
      const { gateMessage } = await import('@/lib/message-policy');
      const g = await gateMessage(db, tenantId, 'return_update');
      if (!g.send) return NextResponse.json({ ok: true, sent: false, why: g.reason });
    } catch { /* fail open */ }
    const retRef = db.doc(`tenants/${tenantId}/retailReturns/${returnId}`);
    const retSnap = await retRef.get();
    if (!retSnap.exists) return NextResponse.json({ ok: false, error: 'Return not found.' }, { status: 404 });
    const ret = (retSnap.data() as any) || {};
    if (ret.status !== 'resolved') {
      return NextResponse.json({ ok: false, error: 'The return has not resolved yet.' }, { status: 409 });
    }

    let claimed = false;
    try {
      claimed = await db.runTransaction(async (tx: any) => {
        const s = await tx.get(retRef);
        if (!s.exists) return false;
        if ((s.data() as any).outcomeEmailAt) return false;
        tx.set(retRef, { outcomeEmailAt: new Date().toISOString() }, { merge: true });
        return true;
      });
    } catch { claimed = false; }
    if (!claimed) return NextResponse.json({ ok: true, alreadyNotified: true });

    const orderSnap = await db.doc(`tenants/${tenantId}/retailOrders/${ret.orderId}`).get();
    const order = orderSnap.exists ? (orderSnap.data() as any) : {};
    const to = str(order.customerEmail, 200);
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
    if (!to || !RESEND_API_KEY || !RESEND_FROM) {
      return NextResponse.json({ ok: true, sent: false, message: 'No recipient or email not configured.' });
    }

    const emailBrand = await getEmailBrand(db, tenantId);
    const first = str(order.customerName, 120).split(' ')[0] || 'there';
    const num = `#${String(ret.orderNumber ?? order.orderNumber ?? '').padStart(4, '0')}`;
    const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
    const labelDeduct = Math.max(0, Number(ret.labelDeductCents) || 0);

    const itemsHtml = (Array.isArray(ret.lines) ? ret.lines : []).slice(0, 10).map((l: any) =>
      `<tr><td style="font-size:13px;color:#0f172a;padding:4px 0">${str(l.name, 120) || 'Item'}${(Number(l.qty) || 1) > 1 ? ` \u00d7 ${Number(l.qty)}` : ''}</td></tr>`
    ).join('');

    let outcomeHtml = '';
    const resolution = String(ret.resolution || '');

    if (resolution === 'refund') {
      const cents = Math.max(0, (Number(ret.refundCents) || 0) - labelDeduct);
      outcomeHtml = `
        <div style="border:2px solid #e2e8f0;border-radius:16px;padding:18px;margin:14px 0;text-align:center">
          <p style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:0 0 4px">Refund on its way</p>
          <p style="font-size:30px;font-weight:800;color:#0f172a;margin:0">${money(cents)}</p>
          ${labelDeduct ? `<p style="font-size:12px;color:#64748b;margin:8px 0 0">Return shipping of ${money(labelDeduct)} was deducted, per the return policy shown when your label was issued.</p>` : ''}
        </div>
        <p style="font-size:13px;color:#334155;line-height:1.6">Card refunds typically appear in 5\u201310 business days, depending on your bank.</p>`;
    } else if (resolution === 'store_credit') {
      const cents = Math.max(0, (Number(ret.storeCreditCents) || 0) - labelDeduct);
      // Claim the credit's own grant email so the two paths can never both send.
      let balanceCents = cents;
      try {
        const email = str(order.customerEmail, 200).toLowerCase();
        const credSnap = await db.collection(`tenants/${tenantId}/depositCredits`)
          .where('clientEmail', '==', email).limit(50).get();
        balanceCents = credSnap.docs.reduce((a: number, d: any) => {
          const c = d.data();
          return a + (c.status === 'available' ? Math.max(0, (Number(c.amountCents) || 0) - (Number(c.usedCents) || 0)) : 0);
        }, 0);
        const mine = credSnap.docs.find((d: any) => (d.data() as any).sourceRetailReturnId === returnId);
        if (mine && !(mine.data() as any).grantEmailAt) {
          await mine.ref.set({ grantEmailAt: new Date().toISOString() }, { merge: true });
        }
      } catch { /* balance display is best-effort; the credit itself is committed */ }
      outcomeHtml = `
        <div style="border:2px solid #e2e8f0;border-radius:16px;padding:18px;margin:14px 0;text-align:center">
          <p style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:0 0 4px">Store credit issued</p>
          <p style="font-size:30px;font-weight:800;color:#0f766e;margin:0">${money(cents)}</p>
          ${labelDeduct ? `<p style="font-size:12px;color:#64748b;margin:8px 0 0">Return shipping of ${money(labelDeduct)} was deducted, per the return policy shown when your label was issued.</p>` : ''}
        </div>
        <table style="width:100%;border-collapse:collapse;margin:0 0 8px">
          <tr>
            <td style="font-size:13px;font-weight:700;color:#0f172a;padding:6px 0">Your balance</td>
            <td style="font-size:16px;font-weight:800;text-align:right;color:#0f172a;padding:6px 0">${money(balanceCents)}</td>
          </tr>
        </table>
        <p style="font-size:13px;color:#334155;line-height:1.6">Spend it at checkout \u2014 sign in with this email and your balance applies right on the payment page, as much or as little as you like.</p>`;
    } else if (resolution === 'replacement') {
      outcomeHtml = `
        <div style="border:2px solid #e2e8f0;border-radius:16px;padding:18px;margin:14px 0;text-align:center">
          <p style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:0 0 4px">Replacement on the way</p>
          <p style="font-size:16px;font-weight:800;color:#0f172a;margin:0">Your replacement is in the fulfilment queue \u2014 at no charge.</p>
        </div>
        <p style="font-size:13px;color:#334155;line-height:1.6">It moves through packing like any order, and your order page updates live as it does.</p>`;
    } else {
      outcomeHtml = `<p style="font-size:13px;color:#334155;line-height:1.6">Your return is closed. If anything looks off, reply from your order page and it lands straight with the team.</p>`;
    }

    const html = brandedEmail(emailBrand, `
      <p style="font-size:16px;color:#0f172a;margin:0 0 8px"><strong>${first}, your return arrived.</strong></p>
      <p style="font-size:13px;color:#334155;line-height:1.6">We received and checked in your items from order ${num}:</p>
      <table style="border-collapse:collapse;margin:8px 0;border-top:2px solid #e2e8f0;border-bottom:2px solid #e2e8f0;width:100%">${itemsHtml}</table>
      ${outcomeHtml}
      ${origin ? emailButton(`${origin}/shop/${tenantId}/order/${ret.orderId}`, 'View my order', emailBrand) : ''}`,
      { preheader: `Return received for order ${num}` });

    const { sendNotification } = await import('@/lib/notify');
    const r = await sendNotification(db, {
      tenantId, channel: 'email', to,
      subject: `${emailBrand.shopName} \u2014 return received for order ${num}`,
      html, kind: 'return_received', recipientType: 'client',
      recipientId: ret.orderId || null, recipientName: order?.customerName || null,
    });

    return NextResponse.json({ ok: true, sent: r.ok });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Notify failed.' }, { status: 500 });
  }
}
