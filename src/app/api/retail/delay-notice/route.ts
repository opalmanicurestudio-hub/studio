import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';

// ─── /api/retail/delay-notice ────────────────────────────────────────────────
// The shop's half of the FTC Mail, Internet, or Telephone Order Rule: when an order can't ship by the promised date,
// the customer gets a notice with a revised date and a plain way to cancel for a full refund.
//   · The revised date replaces the promise on the order, so the customer's late-order cancel right re-arms against it.
//   · One notice per revised date (notifiedForPromiseAt): a double tap sends nothing, a new date sends one email.
//   · Every notice is on the order's timeline with both dates, for any dispute later.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json().catch(() => ({}));
    const tenantId = String(body.tenantId || '').trim();
    const orderId = String(body.orderId || '').trim();
    const revisedDate = String(body.revisedDate || '').trim();   // YYYY-MM-DD
    const note = String(body.note || '').trim().slice(0, 400);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId) || !/^\d{4}-\d{2}-\d{2}$/.test(revisedDate)) {
      return NextResponse.json({ error: 'Choose a new ship-by date as YYYY-MM-DD.' }, { status: 400 });
    }
    const auth = await verifyStaffActor(req, tenantId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const revisedAt = new Date(`${revisedDate}T23:59:59`);
    if (Number.isNaN(revisedAt.getTime())) return NextResponse.json({ error: 'That date isn’t readable.' }, { status: 400 });
    if (revisedAt.getTime() < Date.now()) return NextResponse.json({ error: 'The new date has to be in the future.' }, { status: 400 });

    const db = getAdminDb();
    const orderRef = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
    // Claim the send inside the transaction, then email after it commits: a crash loses one email, never sends two.
    const claimed = await db.runTransaction(async (txn: any) => {
      const snap = await txn.get(orderRef);
      if (!snap.exists) return null;
      const o = snap.data() as any;
      if (['shipped', 'handed_off', 'completed', 'cancelled', 'refunded'].includes(String(o.stage))) return null;
      const promiseIso = revisedAt.toISOString();
      if (o.notifiedForPromiseAt === promiseIso) return null;
      txn.update(orderRef, { shipPromiseAt: promiseIso, notifiedForPromiseAt: promiseIso, promiseRevisions: (Number(o.promiseRevisions) || 0) + 1 });
      const ev = orderRef.collection('events').doc();
      txn.set(ev, {
        id: ev.id, type: 'note', at: new Date().toISOString(), actorId: auth.actor.uid, actorName: auth.actor.name,
        meta: { kind: 'delay_notice', text: `Delay notice sent: new ship-by ${revisedDate}${o.shipPromiseAt ? ` (was ${String(o.shipPromiseAt).slice(0, 10)})` : ''}${note ? ` · ${note}` : ''}` },
      });
      return { ...o, shipPromiseAt: promiseIso };
    });
    if (!claimed) return NextResponse.json({ ok: true, sent: false });

    const to = String(claimed.customerEmail || '').trim();
    if (!to) return NextResponse.json({ ok: true, sent: false, why: 'No email on this order.' });
    const brand = await getEmailBrand(db, tenantId);
    const firstName = esc(String(claimed.customerName || '').trim().split(/\s+/)[0] || 'there');
    const orderLink = `${req.nextUrl.origin}/shop/${tenantId}/order/${orderId}`;
    const pretty = revisedAt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const num = String(claimed.orderNumber ?? '').padStart(4, '0');
    const html = brandedEmail(brand, `
      <p style="font-size:14px;color:#16171a;margin:0 0 8px">Hi ${firstName},</p>
      <p style="font-size:14px;color:#334155;line-height:1.6">Your order #${num} is taking longer than we expected. We now expect it to ship by <strong>${pretty}</strong>.</p>
      ${note ? `<p style="font-size:14px;color:#334155;line-height:1.6;background:#f5f5f7;border-radius:12px;padding:12px 14px;margin:14px 0">${esc(note)}</p>` : ''}
      <p style="font-size:14px;color:#334155;line-height:1.6">If the new date doesn’t work for you, you can cancel from your order page and we’ll refund you in full. No reason needed.</p>
      ${emailButton(orderLink, 'Wait or cancel', brand)}
      <p style="font-size:13px;color:#6d7075;line-height:1.6">We’re sorry for the wait. If you have any questions, just reply to this email.</p>`,
      { title: 'Your order is running late', tag: `Order #${num}`, preheader: `New ship-by date: ${pretty}, or cancel for a full refund.` });
    const { sendNotification } = await import('@/lib/notify');
    await sendNotification(db, { tenantId, channel: 'email', to, subject: `Your order #${num} is running late`, html, kind: 'order_delayed', recipientType: 'client', recipientId: orderId, recipientName: claimed.customerName || null });
    return NextResponse.json({ ok: true, sent: true });
  } catch (err: any) {
    console.error('[delay-notice] failed:', err?.message);
    return NextResponse.json({ error: 'Couldn’t send the notice.' }, { status: 500 });
  }
}
