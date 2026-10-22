// src/app/api/retail/order-message/route.ts — A MESSAGE FROM THE SHOP ABOUT ONE ORDER. Team only.
// POST { tenantId, orderId, text }. Like every message about an order (lib/order-inbox), it goes on the customer's
// order page in full, and they get a one-line nudge with the link: by text when the order has their number, by email
// otherwise. They answer on the order page, where it lands in the shop's messages. On the order's record too.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { brandedEmail, emailButton, getEmailBrand } from '@/lib/email-shell';

export const dynamic = 'force-dynamic';

const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  const text = String(b.text || '').replace(/\r\n/g, '\n').trim().slice(0, 1500);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  if (!text) return NextResponse.json({ ok: false, error: 'Write the message first.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Please sign in to continue.' }, { status: auth.status || 401 });
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const o: any = snap.data() || {};
  if (!o.customerEmail && !o.customerPhone) return NextResponse.json({ ok: false, error: 'This order has no email or phone number to reach them.' }, { status: 409 });
  const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  const subject = `A message about your order ${num}`;
  const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || req.nextUrl.origin;
  const link = `${origin}/shop/${tenantId}/order/${orderId}`;
  const brand = await getEmailBrand(db, tenantId);
  const paras = text.split(/\n{2,}/).map((p) => `<p style="font-size:14px;color:#334155;line-height:1.6">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = brandedEmail(brand, `${paras}${emailButton(link, 'Open my order', brand)}`, { title: subject, tag: `Order ${num}`, preheader: text.slice(0, 90) });
  const { sendNotification } = await import('@/lib/notify');
  // Each message is its own news on the order page and its own nudge (a second message minutes after the first isn't
  // folded into it, whatever it starts with: its whole text tells it apart). The nudge quotes the start of it.
  const quote = text.replace(/\s+/g, ' ').slice(0, 90);
  const nudgeLine = `A message about your order ${num}: “${quote}${text.replace(/\s+/g, ' ').length > 90 ? '…' : ''}”`;
  const r: any = await sendNotification(db, {
    tenantId, channel: o.customerEmail ? 'email' : 'sms', to: String(o.customerEmail || o.customerPhone), subject, html,
    text: `${text} ${link}`, kind: 'shop_message', recipientType: 'client', recipientId: orderId, recipientName: o.customerName || null, orderId, nudgeLine, cardKey: text,
  } as any).catch(() => null);
  const now = new Date().toISOString();
  const ev = ref.collection('events').doc();
  await ev.set({ id: ev.id, type: 'note', at: now, actorId: auth.actor.uid, actorName: auth.actor.name, meta: { kind: 'shop_message', text: `Message to ${String(o.customerName || 'the customer').split(' ')[0]}: ${text.slice(0, 300)}` } }).catch(() => {});
  if (r && r.ok === false) return NextResponse.json({ ok: false, error: 'The message is on their order page, but the nudge didn’t go out. They’ll see it next time they open the order.' }, { status: 502 });
  return NextResponse.json({ ok: true, message: `It’s on ${String(o.customerName || 'their').split(' ')[0]}’s order page, and they’ve been told.` });
}
