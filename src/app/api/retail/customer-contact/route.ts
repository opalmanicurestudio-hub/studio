// src/app/api/retail/customer-contact/route.ts — THE TEAM CHANGES A CUSTOMER'S CONTACT DETAILS ON AN ORDER: name, email,
// mobile, and whether updates come by text. Managers and the front desk only (lib/contact-change), and a manager for an
// email change on an order held for review. POST { tenantId, orderId, name?, email?, phone?, textsOff? }.
// The order, its follow-ups (a backorder, a replacement) and the open cases on them all take the new details, so
// replies, updates and the order page reach them; the customer's profile keeps its own. A new email gets the order's
// link, and the old one is told it changed (a change they didn't ask for is noticed); a new mobile gets one text with
// the link. Every change is on the order's record with who made it.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { brandedEmail, emailButton, getEmailBrand } from '@/lib/email-shell';
import { changeLine, cleanContact, contactDiff, maskEmail, mayEditContact } from '@/lib/contact-change';
import { sendNotification } from '@/lib/notify';

export const dynamic = 'force-dynamic';

const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const d10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) return bad('Missing details.');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.error || 'Please sign in to continue.', auth.status || 401);
  if (!mayEditContact(auth.tenant, auth.actor)) return bad('Only managers and the front desk can change a customer’s details.', 403);

  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) return bad('Order not found.', 404);
  const o: any = snap.data() || {};
  const { next, errors } = cleanContact(o, { name: b.name, email: b.email, phone: b.phone, textsOff: b.textsOff });
  if (errors.length) return bad(errors[0]);
  const changes = contactDiff(o, next);
  if (!changes.length) return NextResponse.json({ ok: true, unchanged: true, message: 'Nothing changed.' });
  const emailChange = changes.find((c) => c.field === 'email') || null;
  const phoneChange = changes.find((c) => c.field === 'phone') || null;
  // An order held for review can be a stolen card: a new email on it is a manager's call.
  if (emailChange && o.holdForReview === true && !auth.actor.isManager) return bad('This order is held for review, so a manager changes its email.', 403);

  // The order's family: the order it came from (when it's a follow-up) and the follow-ups made from either.
  const root = String(o.parentOrderId || orderId);
  const famIds = new Set<string>([orderId]);
  try {
    if (root !== orderId) famIds.add(root);
    const kids = await db.collection(`tenants/${tenantId}/retailOrders`).where('parentOrderId', '==', root).limit(20).get();
    kids.docs.forEach((d: any) => famIds.add(d.id));
  } catch { /* the order itself is still changed */ }
  const oldEmail = String(o.customerEmail || '').trim().toLowerCase();
  const oldPhone = String(o.customerPhone || '');
  const now = new Date().toISOString();
  const patchFor = (x: any) => ({
    // A follow-up takes a change only to details it shares with this order (it was made with them).
    ...(changes.some((c) => c.field === 'name') && String(x.customerName || '') === String(o.customerName || '') ? { customerName: next.name } : {}),
    ...(emailChange && String(x.customerEmail || '').trim().toLowerCase() === oldEmail ? { customerEmail: next.email } : {}),
    ...(phoneChange && d10(x.customerPhone) === d10(oldPhone) ? { customerPhone: next.phone } : {}),
    ...(changes.some((c) => c.field === 'texts') ? { textsOff: next.textsOff } : {}),
    contactChangedAt: now, contactChangedBy: auth.actor.name,
  });
  const batch = db.batch();
  const touched: string[] = [];
  for (const id of famIds) {
    const r = db.doc(`tenants/${tenantId}/retailOrders/${id}`);
    const x: any = id === orderId ? o : (((await r.get().catch(() => null))?.data?.()) || null);
    if (!x) continue;
    batch.set(r, patchFor(x), { merge: true });
    touched.push(id);
  }
  // The open cases on these orders reply to the new email.
  if (emailChange) {
    for (const col of ['retailSupport', 'retailClaims']) {
      try {
        const s = await db.collection(`tenants/${tenantId}/${col}`).where('orderId', 'in', [...famIds].slice(0, 10)).limit(60).get();
        s.docs.forEach((d: any) => { if (String(d.data()?.customerEmail || '').trim().toLowerCase() === oldEmail) batch.set(d.ref, { customerEmail: next.email }, { merge: true }); });
      } catch { /* the order still changes */ }
    }
  }
  const ev = ref.collection('events').doc();
  batch.set(ev, { id: ev.id, type: 'note', at: now, actorId: auth.actor.uid, actorName: auth.actor.name,
    meta: { kind: 'contact_changed', text: `${changes.map(changeLine).join('. ')}.`, fields: changes.map((c) => c.field), followUps: touched.filter((id) => id !== orderId).length } });
  await batch.commit();

  // Telling them: the new email gets the link; the old one hears it changed; a new mobile gets one text.
  const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || req.nextUrl.origin;
  const link = `${origin}/shop/${tenantId}/order/${orderId}`;
  const first = String(next.name || o.customerName || '').split(' ')[0] || 'there';
  let toldNew = false; let toldOld = false; let texted = false;
  try {
    const brand = await getEmailBrand(db, tenantId);
    const shop = brand.shopName || 'the shop';
    if (emailChange && next.email) {
      const html = brandedEmail(brand, `<p style="font-size:14px;color:#334155;line-height:1.6">Hi ${esc(first)}, your order ${num} now uses this email address. Updates about it come here, and your order page has everything in one place.</p>${emailButton(link, 'Open my order', brand)}`,
        { title: 'Your order’s new email', tag: `Order ${num}`, preheader: `Updates about your order ${num} now come to this address.` });
      const r: any = await sendNotification(db, { tenantId, channel: 'email', to: next.email, subject: `${shop}: your order ${num} now uses this email`, html, text: `Your order ${num} now uses this email address. ${link}`,
        kind: 'contact_changed', recipientType: 'client', recipientId: orderId, recipientName: next.name || null, orderId } as any).catch(() => null);
      toldNew = !!r && r.ok !== false;
      if (oldEmail) {
        const html2 = brandedEmail(brand, `<p style="font-size:14px;color:#334155;line-height:1.6">Hi ${esc(first)}, the email address on your order ${num} was changed to ${esc(maskEmail(next.email))} by ${esc(shop)}. Updates about the order go there now.</p><p style="font-size:14px;color:#334155;line-height:1.6">If you didn’t ask for this, please let us know right away by replying to this email.</p>`,
          { title: 'The email on your order changed', tag: `Order ${num}`, preheader: `The email on your order ${num} was changed.` });
        const r2: any = await sendNotification(db, { tenantId, channel: 'email', to: oldEmail, subject: `${shop}: the email on your order ${num} changed`, html: html2, text: `The email on your order ${num} was changed to ${maskEmail(next.email)}. If you didn’t ask for this, reply to this email.`,
          kind: 'contact_changed_notice', recipientType: 'client', recipientId: orderId, recipientName: o.customerName || null, orderId } as any).catch(() => null);
        toldOld = !!r2 && r2.ok !== false;
      }
    }
    if (phoneChange && next.phone && !next.textsOff) {
      const r3: any = await sendNotification(db, { tenantId, channel: 'sms', to: next.phone, text: `${shop}: updates about your order ${num} will come to this number. ${link}`,
        kind: 'contact_changed', recipientType: 'client', recipientId: orderId, recipientName: next.name || null, orderId } as any).catch(() => null);
      texted = !!r3 && r3.ok !== false;
    }
  } catch (e) { console.error('[customer-contact] notices failed (the change is saved)', e); }

  const said = [
    emailChange ? (toldNew ? `the order link went to ${next.email}` : `the order now uses ${next.email}`) : '',
    emailChange && oldEmail ? (toldOld ? 'the old email was told it changed' : '') : '',
    phoneChange && next.phone ? (texted ? 'the new mobile got a text with the link' : '') : '',
    touched.length > 1 ? `its ${touched.length - 1 === 1 ? 'follow-up order' : `${touched.length - 1} follow-up orders`} changed too` : '',
  ].filter(Boolean);
  return NextResponse.json({ ok: true, changed: changes.map((c) => c.field), message: `Saved${said.length ? `: ${said.join(', ')}` : ''}.`, toldNew, toldOld, texted });
}
