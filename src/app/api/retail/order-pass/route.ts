// src/app/api/retail/order-pass/route.ts — SHOW IT'S YOU, ON AN ORDER PAGE (lib/order-pass). A 6-digit code goes to the
// email or mobile already on the order; the right code gives a pass that this device keeps for 30 days. With it the page
// shows the full address and email and lets them change their details, and an expired order link opens again.
//   POST { tenantId, orderId, action: 'send', via: 'email' | 'phone' }   → { verificationId, sentTo }
//   POST { tenantId, orderId, action: 'confirm', verificationId, code }  → { pass, until }
// Codes are limited per order, per email or number, and per shop each day (lib/order-contact), so this can't be used to
// flood anyone. Nothing here says whether an email or number is right: the code goes to the one on the order.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { makePass, passUntil } from '@/lib/order-pass';
import { maskEmail } from '@/lib/contact-change';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim(); const action = String(b.action || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId) || !['send', 'confirm'].includes(action)) return NextResponse.json({ error: 'Missing order details.' }, { status: 400 });
  const db = getAdminDb();
  const snap = await db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get();
  if (!snap.exists) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  const o: any = snap.data() || {};
  if (o.stage === 'placed' || !o.qrToken) return NextResponse.json({ error: 'This order isn’t finished yet.' }, { status: 409 });
  const { sendContactCode, confirmContactCode } = await import('@/lib/order-contact');
  if (action === 'send') {
    const via = b.via === 'phone' ? 'phone' : 'email';
    const to = via === 'phone' ? String(o.customerPhone || '').trim() : String(o.customerEmail || '').trim();
    if (!to) return NextResponse.json({ error: via === 'phone' ? 'There’s no mobile on this order. Ask for the code by email.' : 'There’s no email on this order. Send the shop a message instead.' }, { status: 409 });
    if (via === 'phone' && o.textsOff === true) return NextResponse.json({ error: 'Texts are off for this order. Ask for the code by email.' }, { status: 409 });
    const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || req.nextUrl.origin;
    const r: any = await sendContactCode(db, tenantId, orderId, o, via, to, { origin, purpose: 'order_pass' });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 429 });
    return NextResponse.json({ ok: true, verificationId: r.verificationId, sentTo: via === 'email' ? maskEmail(to) : r.sentTo });
  }
  const c = await confirmContactCode(db, tenantId, orderId, String(b.verificationId || ''), String(b.code || ''), Date.now(), 'order_pass');
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });
  const pass = makePass(tenantId, String(o.qrToken));
  return NextResponse.json({ ok: true, pass, until: passUntil(pass) });
}
