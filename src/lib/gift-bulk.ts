// src/lib/gift-bulk.ts — COMPANY ORDERS: one buyer, many gift cards (a team's holiday gifts, thank-yous for clients).
//
//   tenants/{t}/giftBulk/{id}: the company, who to invoice, one design / line / note for all, the day they're sent, and the
//   list — name, email or mobile, amount — each row checked. requested (a company asked from the shop page) → draft →
//   invoiced (the contact has a private page to pay) → paid → issued (or cancelled before it's paid).
//   Cards are made only once it's paid — online (the payment webhook, or the page confirming), or marked paid by a
//   manager when a check or bank transfer comes in. Each person gets their own card, sent on the day chosen. The money is
//   recorded once, as Gift Card Sales (held — it counts as a sale when each card is used), in the same step that marks
//   the order paid, on a line named after the order.
//   Paying online, every tap gets the same payment page while it's open, so two tabs can't make two payments. A second
//   payment that arrives anyway (an older page, or a card payment after a manager marked it paid by check) is never
//   dropped: it's written on the order under its own page, refunded to the card automatically, and the managers are
//   told; if the refund doesn't go through, it waits on the order for a manager, with a note saying so.
import { createHmac } from 'crypto';
import Stripe from 'stripe';
import { issueGiftCard, deliverGiftCard, alertManagers } from '@/lib/gift-cards';
import { refundAmount } from '@/lib/stripe-refund';

const T = (t: string) => `tenants/${t}`;
const now = () => new Date().toISOString();
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_ROWS = 500;
const safe = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const piOf = (s: any): string | null => (typeof s?.payment_intent === 'string' ? s.payment_intent : s?.payment_intent?.id || null);
const CLAIM_MS = 2 * 60000;

export function bulkKey(tenantId: string, id: string) {
  const secret = process.env.GIFT_LINK_SECRET || process.env.REFUND_LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'gift';
  return createHmac('sha256', secret).update(`bulk:${tenantId}/${id}`).digest('base64url').slice(0, 22);
}
export const bulkPath = (tenantId: string, id: string) => `/gift/${encodeURIComponent(tenantId)}/company/${encodeURIComponent(id)}?k=${bulkKey(tenantId, id)}`;

import { checkRow, totals, type BulkRow } from '@/lib/gift-bulk-list';
export { checkRow, parseList, totals, MAX_ROWS, type BulkRow } from '@/lib/gift-bulk-list';

/** Create or update a company order (managers). Only before it's paid — checked in the same step that saves it, so an
 *  edit made while the company is paying can't undo the payment or the cards it made: once the payment is in, the edit
 *  is refused. The payment's own fields are never written here. A new total closes the page made for the old one. */
export async function saveBulk(db: any, tenantId: string, b: any, by: string) {
  const ref = b.id ? db.doc(`${T(tenantId)}/giftBulk/${String(b.id).slice(0, 60)}`) : db.collection(`${T(tenantId)}/giftBulk`).doc();
  const company = String(b.company || '').trim().slice(0, 80); if (!company) return { ok: false as const, error: 'Add the company name.' };
  const contactEmail = String(b.contactEmail || '').trim().toLowerCase().slice(0, 120); const contactName = String(b.contactName || '').trim().slice(0, 80);
  const defaultCents = Math.max(100, Math.min(500000, Math.round(Number(b.defaultAmount) * 100) || 5000));
  const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, MAX_ROWS).map((r: any) => checkRow({ name: r.name, contact: r.email || r.phone || r.contact || r.raw, amount: r.cents ? r.cents / 100 : r.amount }, defaultCents));
  let sendAt: string | null = null; if (b.sendAt) { const at = Date.parse(String(b.sendAt)); if (!Number.isFinite(at) || at > Date.now() + 366 * 864e5) return { ok: false as const, error: 'Choose a send date within the next year.' }; if (at > Date.now() + 5 * 60000) sendAt = new Date(at).toISOString(); }
  const tt = totals(rows);
  const fields = { id: ref.id, company, contactName: contactName || null, contactEmail: EMAIL.test(contactEmail) ? contactEmail : null, design: typeof b.design === 'string' && /^[a-z0-9-]{2,30}$/.test(b.design) ? b.design : 'frost',
    line: String(b.line || '').trim().slice(0, 30) || null, message: String(b.message || '').trim().slice(0, 400) || null, sendAt, defaultCents, rows, ...tt, updatedAt: now(), updatedBy: by };
  const out: any = await db.runTransaction(async (tx: any) => {
    const cur: any = b.id ? ((await tx.get(ref)).data() || null) : null;
    if (b.id && !cur) return { error: 'That order wasn’t found.' };
    if (cur && ['paid', 'issued', 'cancelled'].includes(cur.status)) return { error: 'It’s already paid — it can’t be changed now.' };
    const doc = { ...fields, status: cur?.status === 'invoiced' ? 'invoiced' : 'draft', ...(cur ? {} : { createdAt: now(), createdBy: by }) };
    tx.set(ref, doc, { merge: true });
    return { cur, doc };
  });
  if (out.error) return { ok: false as const, error: out.error as string };
  // A new total: the page made for the old one closes, so the old amount can't be paid as well.
  const page = out.cur?.payPage;
  if (page?.sessionId && Number(page.cents) !== Number(out.doc.totalCents)) {
    const t: any = (await db.doc(T(tenantId)).get()).data() || {};
    if (t.stripeAccountId) await stripe().checkout.sessions.expire(String(page.sessionId), {}, { stripeAccount: t.stripeAccountId }).catch(() => null);
  }
  return { ok: true as const, order: { ...(out.cur || {}), ...out.doc }, path: bulkPath(tenantId, ref.id) };
}

/** Email the contact their private page to pay (and see the list). */
export async function sendBulkInvoice(db: any, tenantId: string, id: string, origin: string) {
  const ref = db.doc(`${T(tenantId)}/giftBulk/${id}`); const o: any = (await ref.get()).data(); if (!o) return { ok: false as const, error: 'That order wasn’t found.' };
  if (!['draft', 'invoiced', 'requested'].includes(o.status)) return { ok: false as const, error: 'It’s already paid.' };
  if (!o.contactEmail) return { ok: false as const, error: 'Add the email to send the invoice to.' };
  if (!o.count || o.problems) return { ok: false as const, error: o.problems ? `Fix the ${o.problems} row${o.problems === 1 ? '' : 's'} that need a look first.` : 'Add the people first.' };
  const t: any = (await db.doc(T(tenantId)).get()).data() || {}; if (!t.stripeAccountId) return { ok: false as const, error: 'Card payments aren’t set up yet — mark it paid when their check or transfer arrives.' };
  const { linkOrigin } = await import('@/lib/app-origin'); const link = `${linkOrigin(t, origin)}${bulkPath(tenantId, id)}`; const biz = t.name || 'us';
  const sendDay = o.sendAt ? new Date(o.sendAt).toLocaleDateString('en-US', { timeZone: t.timezone || 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }) : 'as soon as your order is paid';
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16171a;max-width:520px;margin:0 auto;padding:24px">
<p style="font-size:13px;color:#6d7075;margin:0 0 6px">${esc(biz)}</p><h1 style="font-weight:400;font-size:28px;letter-spacing:-.02em;margin:0 0 14px">Your gift cards for ${esc(o.company)}</h1>
<p style="font-size:15px;line-height:1.55;margin:0 0 12px">${o.contactName ? `Hi ${esc(String(o.contactName).split(' ')[0])},` : 'Hello,'}</p><p style="font-size:15px;line-height:1.55;margin:0 0 12px">Thank you for your order. Here is a summary of your gift cards:</p>
<p style="font-size:15px;line-height:1.55;margin:0 0 6px">${o.count} gift card${o.count === 1 ? '' : 's'} · <b>${money(o.totalCents)}</b></p><p style="font-size:15px;line-height:1.55;margin:0 0 18px;color:#6d7075">Each person will receive their own gift card by email or text, sent ${esc(sendDay)}.</p>
<p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#16171a;color:#fff;text-decoration:none;border-radius:999px;padding:13px 24px;font-weight:600;font-size:15px">See the list and pay</a></p>
<p style="font-size:13px;color:#6d7075;line-height:1.5;margin:0 0 18px">If you would prefer to pay by check or bank transfer, please reply to this email and we will mark your order as paid once the payment arrives.</p><p style="font-size:15px;line-height:1.55;margin:0">Kind regards,<br>${esc(biz)}</p></div>`;
  const { sendNotification } = await import('@/lib/notify');
  const r: any = await sendNotification(db, { tenantId, channel: 'email', to: o.contactEmail, subject: `${o.count} gift cards for ${o.company} — ${money(o.totalCents)}`, html, text: `${o.contactName ? `Hi ${String(o.contactName).split(' ')[0]},` : 'Hello,'}\n\nThank you for your order of ${o.count} gift cards for ${o.company}, totaling ${money(o.totalCents)}. To review the list and pay, please visit ${link}\n\nKind regards,\n${biz}`, kind: 'gift_card', recipientType: 'client', recipientName: o.contactName || o.company } as any);
  await ref.set({ status: 'invoiced', invoicedAt: now() }, { merge: true });
  return { ok: true as const, sent: ['sent', 'queued', 'delivered'].includes(String(r?.status)), path: bulkPath(tenantId, id) };
}

/** The contact's private page. */
export async function bulkView(db: any, tenantId: string, id: string) {
  const o: any = (await db.doc(`${T(tenantId)}/giftBulk/${id}`).get()).data(); if (!o || o.status === 'requested') return null;
  return { status: o.status, company: o.company, contactName: o.contactName, design: o.design, line: o.line, message: o.message, sendAt: o.sendAt, count: o.count, totalCents: o.totalCents,
    rows: (o.rows || []).filter((r: any) => !r.problem).map((r: any) => ({ name: r.name, to: r.email ? r.email.replace(/^(.).*(@.*)$/, '$1•••$2') : r.phone ? `•••${String(r.phone).slice(-4)}` : '', cents: r.cents, sent: !!r.cardId })) };
}

/** Pay online: one payment page on the business's account for the whole order. Every tap gets the same page while it
 *  can still be paid (two taps or two tabs can't make two payments); a new one is made only once it has expired, or
 *  when the total has changed (the old one is closed first). Pages are named after the order, its total and how many
 *  have been made, so two taps at the same moment get the same new page. */
export async function payBulk(db: any, tenantId: string, id: string, origin: string) {
  const ref = db.doc(`${T(tenantId)}/giftBulk/${id}`);
  const o: any = (await ref.get()).data(); if (!o || o.status !== 'invoiced') return { ok: false as const, error: o?.status === 'paid' || o?.status === 'issued' ? 'It’s already paid — thank you!' : 'This order isn’t ready to pay.' };
  const t: any = (await db.doc(T(tenantId)).get()).data() || {}; if (!t.stripeAccountId) return { ok: false as const, error: 'Card payments aren’t set up here.' };
  const acct = t.stripeAccountId; const s = stripe();
  const page = o.payPage?.sessionId ? o.payPage : null;
  if (page) {
    // Stripe not knowing the page at all (another account, say) means it's gone; no answer means ask again.
    let cur: any = null; let gone = false;
    try { cur = await s.checkout.sessions.retrieve(String(page.sessionId), {}, { stripeAccount: acct }); } catch (e: any) { gone = String(e?.type || '') === 'StripeInvalidRequestError'; }
    if (!cur && !gone) return { ok: false as const, error: 'The payment page couldn’t be opened just now. Please try again in a moment.' };
    if (cur?.status === 'open' && Number(page.cents) === Number(o.totalCents) && cur.url) return { ok: true as const, url: cur.url as string };
    // Paid on that page, but the confirmation hasn't reached the order yet: it's recorded now, never paid again.
    if (cur?.status === 'complete' && cur.payment_status === 'paid') {
      await markBulkPaid(db, tenantId, id, { via: 'card', sessionId: cur.id, amountCents: cur.amount_total, paymentIntentId: piOf(cur), by: 'Online' });
      return { ok: false as const, error: 'It’s already paid — thank you!' };
    }
    if (cur?.status === 'complete') {
      // Finished, but the money hasn't arrived: a bank payment still clearing waits; one that failed makes way for a new page.
      const piId = piOf(cur); let st: 'clearing' | 'failed' | 'unknown' = 'failed';
      if (piId) { try { const x: any = await s.paymentIntents.retrieve(String(piId), {}, { stripeAccount: acct }); st = ['requires_payment_method', 'canceled'].includes(String(x?.status || '')) ? 'failed' : 'clearing'; } catch { st = 'unknown'; } }
      if (st === 'clearing') return { ok: false as const, error: 'Your payment is still going through. Please check back in a few minutes.' };
      if (st === 'unknown') return { ok: false as const, error: 'The payment page couldn’t be checked just now. Please try again in a moment.' };
    }
    // The total changed since that page was made: it closes, so the old amount can't be paid as well.
    if (cur?.status === 'open') await s.checkout.sessions.expire(String(cur.id), {}, { stripeAccount: acct }).catch(() => null);
  }
  const n = (Number(o.payPages) || 0) + 1;
  const { linkOrigin } = await import('@/lib/app-origin'); const back = `${linkOrigin(t, origin)}${bulkPath(tenantId, id)}`;
  const session = await s.checkout.sessions.create({ mode: 'payment', customer_email: o.contactEmail || undefined,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: o.totalCents, product_data: { name: `${o.count} gift cards — ${t.name || 'Gift cards'}`, description: `For ${o.company}` } } }],
    payment_intent_data: { metadata: { tenantId, type: 'gift_bulk', giftBulkId: id }, description: `Company gift cards ${money(o.totalCents)}` },
    metadata: { tenantId, type: 'gift_bulk', giftBulkId: id }, success_url: `${back}&paid={CHECKOUT_SESSION_ID}`, cancel_url: back } as any,
    { stripeAccount: acct, idempotencyKey: `gift-bulk-pay-${safe(id)}-${Math.round(Number(o.totalCents) || 0)}-${n}` });
  await ref.set({ payPage: { sessionId: session.id, cents: o.totalCents, at: now() }, payPages: n }, { merge: true });
  return { ok: true as const, url: session.url };
}

/** Back from paying: check it went through, then make the cards. A second payment for an order already paid is
 *  refunded (markBulkPaid), and the page is told so. */
export async function confirmBulk(db: any, tenantId: string, id: string, sessionId: string) {
  const o: any = (await db.doc(`${T(tenantId)}/giftBulk/${id}`).get()).data(); if (!o) return { ok: false as const };
  if ((o.status === 'paid' || o.status === 'issued') && o.checkoutSessionId === sessionId) return { ok: true as const, paid: true };
  const t: any = (await db.doc(T(tenantId)).get()).data() || {}; if (!t.stripeAccountId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return { ok: true as const, paid: o.status === 'paid' || o.status === 'issued' };
  const s: any = await stripe().checkout.sessions.retrieve(sessionId, {}, { stripeAccount: t.stripeAccountId });
  if (s.payment_status !== 'paid' || s.metadata?.giftBulkId !== id) return { ok: true as const, paid: o.status === 'paid' || o.status === 'issued' };
  const r: any = await markBulkPaid(db, tenantId, id, { via: 'card', sessionId: s.id, amountCents: s.amount_total, paymentIntentId: piOf(s), by: 'Online' });
  if (r?.twice) return { ok: true as const, paid: true, twice: true, refunded: !!r.refunded, message: r.error as string };
  return { ok: true as const, paid: true };
}

type PaidBy = { via: 'card' | 'check' | 'transfer' | 'cash'; sessionId?: string | null; amountCents?: number | null; paymentIntentId?: string | null; by: string };

/** Paid → make every card, record the money once, send them (or schedule them). Runs once: the order is marked paid
 *  and its line in the books (named after the order) is written in the same step. The same online payment again is
 *  nothing new; a different one is a second payment, and goes back (refundSecondPayment). */
export async function markBulkPaid(db: any, tenantId: string, id: string, p: PaidBy) {
  const ref = db.doc(`${T(tenantId)}/giftBulk/${id}`);
  const txRef = db.doc(`${T(tenantId)}/transactions/giftbulk_${safe(id)}`);
  const at = now();
  const claim: any = await db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(ref)).data(); const line = await tx.get(txRef);
    if (!x) return { none: true };
    if (['draft', 'invoiced'].includes(x.status) && !line.exists) {
      const paid = Number(p.amountCents) > 0 ? Number(p.amountCents) : x.totalCents;
      tx.update(ref, { status: 'paid', paidAt: at, paidVia: p.via, checkoutSessionId: p.sessionId || null, paidCents: paid, ...(p.paymentIntentId ? { paymentIntentId: p.paymentIntentId } : {}) });
      tx.set(txRef, { id: txRef.id, date: at, description: `Gift cards for ${x.company}: ${x.count} cards`, clientOrVendor: x.company, type: 'income', context: 'Business', category: 'Gift Card Sales', taxBucket: 'transfer',
        amount: paid / 100, paymentMethod: p.via === 'card' ? 'Online Checkout' : p.via === 'check' ? 'Check' : p.via === 'transfer' ? 'Bank Transfer' : 'Cash', hasReceipt: true, checkoutSessionId: p.sessionId || null,
        ...(p.paymentIntentId ? { stripePaymentIntentId: p.paymentIntentId } : {}), giftBulkId: id, tenantId });
      return { o: x };
    }
    // Paid already, or cancelled: the same online payment again is nothing new; any other online payment is a second one.
    if (p.sessionId && x.checkoutSessionId === p.sessionId) return { same: true };
    if (p.via === 'card' && p.sessionId) return { twice: true, o: x };
    return { done: true };
  });
  if (claim.twice) return refundSecondPayment(db, tenantId, id, claim.o, p);
  if (!claim.o) return { ok: false as const, error: 'It’s already paid, or it was cancelled.' };
  const o = claim.o;
  // Paid online for a different amount than the order now comes to (it was changed while they were paying): the cards
  // are made for the list as it is, and the managers are told, so the difference can be settled.
  const paidCents = Number(p.amountCents) > 0 ? Number(p.amountCents) : Number(o.totalCents);
  if (p.via === 'card' && paidCents !== Number(o.totalCents)) {
    await alertManagers(db, tenantId, `${o.company} paid ${money(paidCents)} online for their gift card order, which now comes to ${money(Number(o.totalCents) || 0)} because it was changed while they were paying. The cards were made for the list as it is now, so please settle the difference with them.`, '/gift-cards?company=1', null).catch(() => {});
  }
  const t: any = (await db.doc(T(tenantId)).get()).data() || {};
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

/** A second payment on an order already paid (or cancelled): written on the order under its own page first (so two
 *  notices at the same moment refund it once), refunded to the card under one key for that payment, and the managers
 *  are told. If Stripe says no, it stays on the order for a manager, and their note says so. If Stripe doesn't answer,
 *  it stays on its way (the order says so: extraRefundOpenAt) and the five-minute check sends it again under the same
 *  key (settleStuckBulkRefunds). */
async function refundSecondPayment(db: any, tenantId: string, id: string, o: any, p: PaidBy) {
  const ref = db.doc(`${T(tenantId)}/giftBulk/${id}`);
  const t: any = (await db.doc(T(tenantId)).get()).data() || {}; const acct = t.stripeAccountId || null;
  const key = safe(p.sessionId);
  let pi = p.paymentIntentId || null; let cents = Math.round(Number(p.amountCents) || 0);
  if ((!pi || !cents) && acct) {
    const s: any = await stripe().checkout.sessions.retrieve(String(p.sessionId), {}, { stripeAccount: acct }).catch(() => null);
    pi = pi || piOf(s); cents = cents || Math.round(Number(s?.amount_total) || 0);
  }
  const why = o.status === 'cancelled' ? 'cancelled' : 'paid_twice';
  const words = why === 'cancelled' ? 'was cancelled' : 'was already paid';
  const at = now();
  const claim: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {}; const e = cur.extraPayments?.[key] || null;
    if (e?.state === 'refunded') return { done: true };
    if (e?.state === 'refunding' && Date.now() - (Date.parse(String(e.claimAt || '')) || 0) < CLAIM_MS) return { busy: true };
    tx.set(ref, { extraPayments: { [key]: { sessionId: String(p.sessionId), paymentIntentId: pi, cents, why, state: 'refunding', claimAt: at, firstAt: e?.firstAt || at } },
      extraRefundOpenAt: cur.extraRefundOpenAt && cur.extraRefundOpenAt < at ? cur.extraRefundOpenAt : at }, { merge: true });
    return { go: true };
  });
  if (claim.done) return { ok: false as const, twice: true, refunded: true, cents, error: `This order ${words}, so this payment of ${money(cents)} was refunded to the card.` };
  if (claim.busy) return { ok: false as const, twice: true, refunded: false, cents, error: `This order ${words}, so this payment of ${money(cents)} is being refunded to the card.` };
  const state = await sendSecondRefund(db, tenantId, id, key, { paymentIntentId: pi, cents, why, company: o.company, paidVia: o.paidVia || null }, acct);
  const ok = state === 'refunded';
  return { ok: false as const, twice: true, refunded: ok, cents,
    error: ok ? `This order ${words}, so this payment of ${money(cents)} was refunded to the card.` : state === 'refunding' ? `This order ${words}, so this payment of ${money(cents)} is being refunded to the card.` : `This order ${words}. ${t.name || 'The business'} will refund this payment of ${money(cents)}.` };
}

/** Send a second payment's refund (under its one key), write where it got to, and tell the managers once. */
async function sendSecondRefund(db: any, tenantId: string, id: string, key: string, e: { paymentIntentId: string | null; cents: number; why: string; company: string; paidVia: string | null }, acct: string | null): Promise<'refunded' | 'refunding' | 'refund_failed'> {
  const ref = db.doc(`${T(tenantId)}/giftBulk/${id}`); const { paymentIntentId: pi, cents, why } = e;
  const words = why === 'cancelled' ? 'was cancelled' : 'was already paid';
  const r: any = pi && cents > 0 ? await refundAmount(acct, pi, cents, `gift-bulk-twice-${safe(pi)}-${cents}`, { tenantId, giftBulkId: id, why }) : { ok: false, error: 'No card payment was found to refund.' };
  // Refunded in Stripe by hand already: the money went back.
  const state = r.ok || r.code === 'charge_already_refunded' ? 'refunded' : r.unknown ? 'refunding' : 'refund_failed';
  // The managers hear once per change of where it got to (an unanswered refund sent again every few minutes says so once).
  const told = String((((await ref.get()).data() || {}).extraPayments?.[key] || {}).toldState || '');
  await ref.set({ extraPayments: { [key]: { ...(state === 'refunded' ? { state, refundedAt: now(), refundId: r.id || null } : state === 'refunding' ? { state } : { state, error: String(r.error || 'The refund didn’t go through.').slice(0, 200), failedAt: now() }), settlingAt: null, toldState: state } } }, { merge: true });
  await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const open = Object.values(cur.extraPayments || {}).filter((x: any) => x?.state === 'refunding').map((x: any) => String(x.claimAt || '')).sort()[0] || null;
    if ((cur.extraRefundOpenAt || null) !== open) tx.set(ref, { extraRefundOpenAt: open }, { merge: true });
  }).catch(() => {});
  const how = e.paidVia && e.paidVia !== 'card' && why === 'paid_twice' ? ` (marked paid by ${e.paidVia === 'transfer' ? 'bank transfer' : e.paidVia})` : '';
  if (told !== state) await alertManagers(db, tenantId, state === 'refunded'
    ? `${e.company} paid ${money(cents)} for their gift card order, which ${words}${how}. That payment was refunded to their card automatically.`
    : state === 'refunding' ? `${e.company} paid ${money(cents)} for their gift card order, which ${words}${how}. Stripe hasn’t confirmed the refund yet. It will be checked again in a few minutes, so there’s no need to refund it by hand.`
    : `${e.company} paid ${money(cents)} for their gift card order, which ${words}${how}. The automatic refund didn’t go through, so please refund it in Stripe.`, '/gift-cards?company=1', null).catch(() => {});
  return state;
}

/** The five-minute check: a second payment's refund left on its way more than 15 minutes (Stripe's answer was lost, and
 *  no notice came after) is sent again under the same key, so it goes back once. */
export async function settleStuckBulkRefunds(db: any, tenantId: string, tenant: any, o: { now?: number } = {}): Promise<{ checked: number; recorded: number; released: number; waiting: number }> {
  const out = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  const acct = tenant?.stripeAccountId || null; if (!acct) return out;
  const at = o.now ?? Date.now(); const iso = new Date(at).toISOString();
  const snap = await db.collection(`${T(tenantId)}/giftBulk`).where('extraRefundOpenAt', '>', '').limit(20).get().catch(() => ({ docs: [] as any[] }));
  for (const d of snap.docs) {
    const g: any = d.data() || {};
    for (const [k, e0] of Object.entries(g.extraPayments || {}) as [string, any][]) {
      if (e0?.state !== 'refunding' || at - (Date.parse(String(e0.claimAt || '')) || at) < 15 * 60000) continue;
      const e: any = await db.runTransaction(async (tx: any) => {
        const cur: any = ((await tx.get(d.ref)).data() || {}).extraPayments?.[k] || null;
        if (!cur || cur.state !== 'refunding' || (cur.settlingAt && at - (Date.parse(String(cur.settlingAt)) || 0) < 5 * 60000)) return null;
        tx.set(d.ref, { extraPayments: { [k]: { settlingAt: iso } } }, { merge: true }); return cur;
      }).catch(() => null);
      if (!e) continue;
      out.checked++;
      const st = await sendSecondRefund(db, tenantId, d.id, k, { paymentIntentId: e.paymentIntentId || null, cents: Math.round(Number(e.cents) || 0), why: String(e.why || 'paid_twice'), company: g.company || 'A company', paidVia: g.paidVia || null }, acct);
      if (st === 'refunded') out.recorded++; else if (st === 'refund_failed') out.released++; else out.waiting++;
    }
  }
  return out;
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
  const ref = db.doc(`${T(tenantId)}/giftBulk/${id}`);
  // In one step, so a payment arriving at the same moment either pays it first (and it can't be cancelled) or finds it
  // cancelled (and is refunded).
  const r: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return { error: 'That order wasn’t found.' };
    if (['paid', 'issued'].includes(o.status)) return { error: 'It’s already paid — cancel the cards one by one from the list if you need to.' };
    tx.set(ref, { status: 'cancelled', cancelledAt: now(), cancelledBy: by }, { merge: true }); return { o };
  });
  if (r.error) return { ok: false as const, error: r.error as string };
  // Its payment page closes, so it can't be paid now.
  if (r.o.payPage?.sessionId) {
    const t: any = (await db.doc(T(tenantId)).get()).data() || {};
    if (t.stripeAccountId) await stripe().checkout.sessions.expire(String(r.o.payPage.sessionId), {}, { stripeAccount: t.stripeAccountId }).catch(() => null);
  }
  return { ok: true as const };
}
