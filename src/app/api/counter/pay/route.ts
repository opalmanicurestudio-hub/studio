// src/app/api/counter/pay/route.ts — THE GUEST PAYS A DRIVE-THRU ORDER ON THEIR OWN PHONE (public: the signed link from the
// code they scanned is the only key, and it opens nothing but that one order, while it's unpaid). lib/counter-phone.
//   view { tenantId, o, s } → the order (number, first name, items, total) and the secure form's key for its payment,
//                             or that it's paid
//   done { tenantId, o, s } → after the form says it went through: the order is paid by it (asked of the card company,
//                             never taken from the page)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { phoneSigOk, phoneView, settlePhone, NOT_KEPT } from '@/lib/counter-phone';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); const orderId = String(b.o || ''); const action = String(b.action || '');
    if (!ID.test(tenantId) || !ID.test(orderId) || !['view', 'done'].includes(action)) return reply({ ok: false, error: 'This link doesn’t work. Ask at the window for a new one.' }, 400);
    // The signature first (it can't be guessed), so made-up links never use up the business's allowance.
    if (!phoneSigOk(tenantId, orderId, b.s)) return reply({ ok: false, error: 'This link doesn’t work. Ask at the window for a new one.' }, 404);
    const slow = await limitPublic(req, 'drive_thru_pay', tenantId, { perHour: 600, perDay: 6000 }); if (slow) return slow;
    const db = getAdminDb();
    if (action === 'view') { const r: any = await phoneView(db, tenantId, orderId, b.s); return reply(r, r.ok ? 200 : r.status); }
    // done: whatever the page says, it's the card company that's asked.
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const o: any = (await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).get()).data();
    if (!o) return reply({ ok: false, error: 'This order isn’t here any more.' }, 404);
    if (o.paidAt && (o.paidVia === 'phone' || !o.phone?.id)) return reply({ ok: true, paid: true, viaPhone: o.paidVia === 'phone' });
    if (!o.phone?.id) return reply({ ok: false, error: 'That payment didn’t start. Try again.' }, 409);
    // Paid another way already: whether their card went through as well (then it goes back) is asked all the same.
    const r: any = await settlePhone(db, tenantId, tenant, orderId, String(o.phone.id));
    if (!r.ok) return reply({ ok: false, error: r.error }, r.status);
    if (r.notKept) return reply({ ok: false, notKept: true, error: NOT_KEPT }, 409);
    if (r.pending) return reply({ ok: false, pending: true, error: 'Your payment is still going through.' }, 202);
    // Called off: paid another way (nothing charged to their card), or not, and it's paid at the window.
    if (!r.paid) return o.paidAt ? reply({ ok: true, paid: true, viaPhone: false }) : reply({ ok: false, error: 'This payment was called off. Pay at the window.' }, 409);
    return reply({ ok: true, paid: true, viaPhone: true });
  } catch (e: any) {
    console.error('[counter/pay] failed', e?.message);
    return reply({ ok: false, error: 'Something went wrong. Pay at the window.' }, 500);
  }
}
