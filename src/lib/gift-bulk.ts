// src/lib/gift-bulk.ts — COMPANY ORDERS: one buyer, many gift cards (a team's holiday gifts, thank-yous for clients).
//
//   tenants/{t}/giftBulk/{id}: the company, who to invoice, one design / line / note for all, the day they're sent, and the
//   list — name, email or mobile, amount — each row checked. requested (a company asked from the shop page) → draft →
//   invoiced (the contact has a private page to pay) → paid → issued (or cancelled before it's paid).
//   Cards are made only once it's paid — online (the payment webhook, or the page confirming), or marked paid by a
//   manager when a check or bank transfer comes in. Each person gets their own card, sent on the day chosen. The money is
//   recorded once, as Gift Card Sales (held — it counts as a sale when each card is used).
import { createHmac } from 'crypto';
import Stripe from 'stripe';
import { issueGiftCard, deliverGiftCard } from '@/lib/gift-cards';

const T = (t: string) => `tenants/${t}`;
const now = () => new Date().toISOString();
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_ROWS = 500;

export function bulkKey(tenantId: string, id: string) {
  const secret = process.env.GIFT_LINK_SECRET || process.env.REFUND_LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'gift';
  return createHmac('sha256', secret).update(`bulk:${tenantId}/${id}`).digest('base64url').slice(0, 22);
}
export const bulkPath = (tenantId: string, id: string) => `/gift/${encodeURIComponent(tenantId)}/company/${encodeURIComponent(id)}?k=${bulkKey(tenantId, id)}`;

import { checkRow, totals, type BulkRow } from '@/lib/gift-bulk-list';
export { checkRow, parseList, totals, MAX_ROWS, type BulkRow } from '@/lib/gift-bulk-list';

/** Create or update a company order (managers). Only before it's paid. */
export async function saveBulk(db: any, tenantId: string, b: any, by: string) {
  const ref = b.id ? db.doc(`${T(tenantId)}/giftBulk/${String(b.id).slice(0, 60)}`) : db.collection(`${T(tenantId)}/giftBulk`).doc();
  const cur: any = b.id ? (await ref.get()).data() : null; if (b.id && !cur) return { ok: false as const, error: 'That order wasn’t found.' };
  if (cur && ['paid', 'issued', 'cancelled'].includes(cur.status)) return { ok: false as const, error: 'It’s already paid — it can’t be changed now.' };
  const company = String(b.company || '').trim().slice(0, 80); if (!company) return { ok: false as const, error: 'Add the company name.' };
  const contactEmail = String(b.contactEmail || '').trim().toLowerCase().slice(0, 120); const contactName = String(b.contactName || '').trim().slice(0, 80);
  const defaultCents = Math.max(100, Math.min(500000, Math.round(Number(b.defaultAmount) * 100) || 5000));
  const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, MAX_ROWS).map((r: any) => checkRow({ name: r.name, contact: r.email || r.phone || r.contact || r.raw, amount: r.cents ? r.cents / 100 : r.amount }, defaultCents));
  let sendAt: string | null = null; if (b.sendAt) { const at = Date.parse(String(b.sendAt)); if (!Number.isFinite(at) || at > Date.now() + 366 * 864e5) return { ok: false as const, error: 'Choose a send date within the next year.' }; if (at > Date.now() + 5 * 60000) sendAt = new Date(at).toISOString(); }
  const tt = totals(rows);
  const doc = { id: ref.id, company, contactName: contactName || null, contactEmail: EMAIL.test(contactEmail) ? contactEmail : null, design: typeof b.design === 'string' && /^[a-z0-9-]{2,30}$/.test(b.design) ? b.design : 'frost',
    line: String(b.line || '').trim().slice(0, 30) || null, message: String(b.message || '').trim().slice(0, 400) || null, sendAt, defaultCents, rows, ...tt,
    status: cur?.status === 'invoiced' ? 'invoiced' : 'draft', updatedAt: now(), updatedBy: by, ...(cur ? {} : { createdAt: now(), createdBy: by }) };
  await ref.set(doc, { merge: true });
  return { ok: true as const, order: { ...cur, ...doc }, path: bulkPath(tenantId, ref.id) };
}

/** Email the contact their private page to pay (and see the list). */
export async function sendBulkInvoice(db: any, tenantId: string, id: string, origin: string) {
  const ref = db.doc(`${T(tenantId)}/giftBulk/${id}`); const o: any = (await ref.get()).data(); if (!o) return { ok: false as const, error: 'That order wasn’t found.' };
  if (!['draft', 'invoiced', 'requested'].includes(o.status)) return { ok: false as const, error: 'It’s already paid.' };
  if (!o.contactEmail) return { ok: false as const, error: 'Add the email to send the invoice to.' };
  if (!o.count || o.problems) return { ok: false as const, error: o.problems ? `Fix the ${o.problems} row${o.problems === 1 ? '' : 's'} that need a look first.` : 'Add the people first.' };
  const t: any = (await db.doc(T(tenantId)).get()).data() || {}; if (!t.stripeAccountId) return { ok: false as const, error: 'Card payments aren’t set up yet — mark it paid when their check or transfer arrives.' };
  const { linkOrigin } = await import('@/lib/app-origin'); const link = `${linkOrigin(t, origin)}${bulkPath(tenantId, id)}`; const biz = t.name || 'us';
  const sendDay = o.sendAt ? new Date(o.sendAt).toLocaleDateString('en-US', { timeZone: t.timezone || 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }) : 'as soon as it’s paid';
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16171a;max-width:520px;margin:0 auto;padding:24px">
<p style="font-size:13px;color:#6d7075;margin:0 0 6px">${esc(biz)}</p><h1 style="font-weight:400;font-size:28px;letter-spacing:-.02em;margin:0 0 14px">Your gift cards for ${esc(o.company)}</h1>
<p style="font-size:15px;line-height:1.55;margin:0 0 6px">${o.count} gift card${o.count === 1 ? '' : 's'} · <b>${money(o.totalCents)}</b></p><p style="font-size:15px;line-height:1.55;margin:0 0 18px;color:#6d7075">Each person gets their own card by email or text — sent ${esc(sendDay)}.</p>
<p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#16171a;color:#fff;text-decoration:none;border-radius:999px;padding:13px 24px;font-weight:600;font-size:15px">See the list and pay</a></p>
<p style="font-size:13px;color:#6d7075;line-height:1.5;margin:0">Paying by check or bank transfer? Reply to this email — we’ll mark it paid when it arrives.</p></div>`;
  const { sendNotification } = await import('@/lib/notify');
  const r: any = await sendNotification(db, { tenantId, channel: 'email', to: o.contactEmail, subject: `${o.count} gift cards for ${o.company} — ${money(o.totalCents)}`, html, text: `${o.count} gift cards for ${o.company}, ${money(o.totalCents)}. See the list and pay: ${link}`, kind: 'gift_card', recipientType: 'client', recipientName: o.contactName || o.company } as any);
  await ref.set({ status: 'invoiced', invoicedAt: now() }, { merge: true });
  return { ok: true as const, sent: ['sent', 'queued', 'delivered'].includes(String(r?.status)), path: bulkPath(tenantId, id) };
}

/** The contact's private page. */
export async function bulkView(db: any, tenantId: string, id: string) {
  const o: any = (await db.doc(`${T(tenantId)}/giftBulk/${id}`).get()).data(); if (!o || o.status === 'requested') return null;
  return { status: o.status, company: o.company, contactName: o.contactName, design: o.design, line: o.line, message: o.message, sendAt: o.sendAt, count: o.count, totalCents: o.totalCents,
    rows: (o.rows || []).filter((r: any) => !r.problem).map((r: any) => ({ name: r.name, to: r.email ? r.email.replace(/^(.).*(@.*)$/, '$1•••$2') : r.phone ? `•••${String(r.phone).slice(-4)}` : '', cents: r.cents, sent: !!r.cardId })) };
}

/** Pay online: a payment page on the business's account for the whole order (made fresh each time — they expire). */
export async function payBulk(db: any, tenantId: string, id: string, origin: string) {
  const o: any = (await db.doc(`${T(tenantId)}/giftBulk/${id}`).get()).data(); if (!o || o.status !== 'invoiced') return { ok: false as const, error: o?.status === 'paid' || o?.status === 'issued' ? 'It’s already paid — thank you!' : 'This order isn’t ready to pay.' };
  const t: any = (await db.doc(T(tenantId)).get()).data() || {}; if (!t.stripeAccountId) return { ok: false as const, error: 'Card payments aren’t set up here.' };
  const { linkOrigin } = await import('@/lib/app-origin'); const back = `${linkOrigin(t, origin)}${bulkPath(tenantId, id)}`;
  const session = await stripe().checkout.sessions.create({ mode: 'payment', customer_email: o.contactEmail || undefined,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: o.totalCents, product_data: { name: `${o.count} gift cards — ${t.name || 'Gift cards'}`, description: `For ${o.company}` } } }],
    payment_intent_data: { metadata: { tenantId, type: 'gift_bulk', giftBulkId: id }, description: `Company gift cards ${money(o.totalCents)}` },
    metadata: { tenantId, type: 'gift_bulk', giftBulkId: id }, success_url: `${back}&paid={CHECKOUT_SESSION_ID}`, cancel_url: back } as any, { stripeAccount: t.stripeAccountId });
  return { ok: true as const, url: session.url };
}

/** Back from paying: check it went through, then make the cards. */
export async function confirmBulk(db: any, tenantId: string, id: string, sessionId: string) {
  const o: any = (await db.doc(`${T(tenantId)}/giftBulk/${id}`).get()).data(); if (!o) return { ok: false as const };
  if (o.status === 'paid' || o.status === 'issued') return { ok: true as const, paid: true };
  const t: any = (await db.doc(T(tenantId)).get()).data() || {}; if (!t.stripeAccountId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return { ok: true as const, paid: false };
  const s: any = await stripe().checkout.sessions.retrieve(sessionId, {}, { stripeAccount: t.stripeAccountId });
  if (s.payment_status !== 'paid' || s.metadata?.giftBulkId !== id) return { ok: true as const, paid: false };
  await markBulkPaid(db, tenantId, id, { via: 'card', sessionId: s.id, amountCents: s.amount_total, by: 'Online' });
  return { ok: true as const, paid: true };
}

/** Paid → make every card, record the money once, send them (or schedule them). Runs once. */
export async function markBulkPaid(db: any, tenantId: string, id: string, p: { via: 'card' | 'check' | 'transfer' | 'cash'; sessionId?: string | null; amountCents?: number | null; by: string }) {
  const ref = db.doc(`${T(tenantId)}/giftBulk/${id}`);
  const o: any = await db.runTransaction(async (tx: any) => { const x = (await tx.get(ref)).data(); if (!x || !['draft', 'invoiced'].includes(x.status)) return null; tx.update(ref, { status: 'paid', paidAt: now(), paidVia: p.via, checkoutSessionId: p.sessionId || null }); return x; });
  if (!o) return { ok: false as const, error: 'It’s already paid, or it was cancelled.' };
  const t: any = (await db.doc(T(tenantId)).get()).data() || {}; const paid = Number(p.amountCents) > 0 ? Number(p.amountCents) : o.totalCents;
  const txRef = db.collection(`${T(tenantId)}/transactions`).doc();
  await txRef.set({ id: txRef.id, date: now(), description: `Gift cards for ${o.company}: ${o.count} cards`, clientOrVendor: o.company, type: 'income', context: 'Business', category: 'Gift Card Sales', taxBucket: 'transfer',
    amount: paid / 100, paymentMethod: p.via === 'card' ? 'Online Checkout' : p.via === 'check' ? 'Check' : p.via === 'transfer' ? 'Bank Transfer' : 'Cash', hasReceipt: true, checkoutSessionId: p.sessionId || null, giftBulkId: id, tenantId });
  const rows: BulkRow[] = [...(o.rows || [])]; let made = 0, failed = 0;
  for (let i = 0; i < rows.length; i++) { const r = rows[i]; if (r.problem || r.cardId) continue;
    const c: any = await issueGiftCard(db, tenantId, { amountCents: r.cents, by: p.by, source: 'desk', purchaser: { id: null, name: o.company }, purchaserEmail: o.contactEmail,
      recipient: { id: null, name: r.name, email: r.email, phone: r.phone }, message: o.message, design: o.design, line: o.line, sendVia: r.email ? 'email' : 'text', sendAt: o.sendAt && Date.parse(o.sendAt) > Date.now() ? o.sendAt : null, transactionId: txRef.id });
    if (!c.ok) { failed++; continue; } rows[i] = { ...r, cardId: c.card.id, code: c.card.code }; made++;
    await db.doc(`${T(tenantId)}/giftCards/${c.card.id}`).set({ bulkId: id }, { merge: true });
    if (!c.card.sendAt) await deliverGiftCard(db, tenantId, t, c.card).catch(() => null); }
  await ref.set({ status: failed ? 'paid' : 'issued', rows, made, failed: failed || null, issuedAt: now() }, { merge: true });
  return { ok: true as const, made, failed };
}

/** A company asks from the shop page — the managers get it as a request to set up. */
export async function requestBulk(db: any, tenantId: string, b: any) {
  const company = String(b.company || '').trim().slice(0, 80), contactName = String(b.contactName || '').trim().slice(0, 80), contactEmail = String(b.contactEmail || '').trim().toLowerCase().slice(0, 120);
  if (!company || !contactName || !EMAIL.test(contactEmail)) return { ok: false as const, error: 'Add the company, your name and your email.' };
  const count = Math.max(1, Math.min(MAX_ROWS, Math.round(Number(b.count) || 0))); const each = Math.max(0, Math.min(5000, Math.round(Number(b.each) || 0)));
  const ref = db.collection(`${T(tenantId)}/giftBulk`).doc();
  await ref.set({ id: ref.id, status: 'requested', company, contactName, contactEmail, askedCount: count, defaultCents: each ? each * 100 : 5000, note: String(b.note || '').trim().slice(0, 600) || null, rows: [], count: 0, totalCents: 0, problems: 0, design: 'frost', createdAt: now(), createdBy: 'Online request' });
  const { alertManagers } = await import('@/lib/gift-cards');
  await alertManagers(db, tenantId, `${company} would like ${count} gift card${count === 1 ? '' : 's'}${each ? ` at $${each} each` : ''} — ${contactName}, ${contactEmail}.`, '/gift-cards?company=1', null).catch(() => {});
  return { ok: true as const };
}

export async function cancelBulk(db: any, tenantId: string, id: string, by: string) {
  const ref = db.doc(`${T(tenantId)}/giftBulk/${id}`); const o: any = (await ref.get()).data(); if (!o) return { ok: false as const, error: 'That order wasn’t found.' };
  if (['paid', 'issued'].includes(o.status)) return { ok: false as const, error: 'It’s already paid — cancel the cards one by one from the list if you need to.' };
  await ref.set({ status: 'cancelled', cancelledAt: now(), cancelledBy: by }, { merge: true }); return { ok: true as const };
}
