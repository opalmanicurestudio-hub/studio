// src/lib/screen-pay.ts — A PAYMENT TAKEN ON THE CLIENT SCREEN (OR A SPLIT SHARE ON A CARD) GOES ON ITS SALE (server).
// Used wherever the server learns a payment went through: the screen's "paid" answer, a payment found paid as the desk
// moves on or a manager records the sale, and Stripe's notice (connect-webhook) as the safety net. Whichever comes first
// puts it on the ticket; the others change nothing (lib/reader-sale keeps each payment on a ticket once).
//  - The whole sale: it pays for the sale (with the tip the client chose on the screen), or — when the sale was already
//    paid another way — it's kept apart for a manager to refund, and the desk and managers are told.
//  - One share of a split bill: added to the split as it's paid; one that lands on a sale already finished, discarded or
//    paid in full is kept apart the same way, never lost and never counted twice.
import crypto from 'crypto';
import { accountOf, addShareToTicket, checkDeskPayment, keepApartPayment, markSalePaid, readerStripe, tellDeskReader } from '@/lib/reader-sale';

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const now = () => new Date().toISOString();
const cents = (pi: any) => Math.round(Number(pi?.amount_received || pi?.amount) || 0);

/** The whole sale paid on the screen, on its ticket (see above). `q`: the screen's request, for the tip chosen there. */
export async function paidOnScreen(db: any, tenantId: string, pendingId: string, pi: any, q: any, more: Record<string, any> = {}) {
  const m = await markSalePaid(db, tenantId, pendingId, pi, 'client_screen', { paidTip: num(q?.tip), paidTipAllocations: q?.tipAllocations || null, ...more });
  // Paid twice, or paid after the desk had moved on to another sale: the desk and managers are told, so it's refunded
  // or recorded, never lost.
  if (m.fresh && (m.result === 'paid_twice' || m.revived)) {
    const pc: any = ((await db.doc(`tenants/${tenantId}/pendingCheckouts/${pendingId}`).get()).data() as any) || {};
    await tellDeskReader(db, tenantId, m.result === 'paid_twice' ? 'paid_twice' : 'unrecorded', pc, cents(pi), pendingId, 'client_screen').catch(() => {});
  }
  return m;
}

/** One card share of a split bill, on its ticket (see above), once Stripe confirms it went through for this sale and
 *  none of it was refunded (a notice delivered again can be out of date). Returns what happened: added, already there,
 *  kept apart (the sale was finished, paid in full, or it would pay more than the bill), or not added (refunded, taken
 *  off the split at the desk, or not this sale's). Stripe unreachable: throws, so it's asked again later. */
export async function recordCardShare(db: any, tenantId: string, pendingId: string, pi: any, s: { amount: number; tip?: number; label?: string | null; via: string; payerClientId?: string | null; by?: string }): Promise<'added' | 'already' | 'kept_apart' | 'refunded' | 'removed' | 'not_this_sale' | 'no_ticket'> {
  const tenant: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const acct = accountOf(tenant); const stripe = readerStripe();
  if (!acct || !stripe) throw new Error('Card payments aren’t set up, so the share can’t be checked.');
  const c = await checkDeskPayment(stripe, acct, String(pi.id), tenantId, pendingId);
  if (!c.ok && c.status === 'unknown') throw new Error(c.error);
  if (!c.ok) return c.status === 'refunded' ? 'refunded' : 'not_this_sale';
  const tn = { id: crypto.randomBytes(6).toString('hex'), method: 'card', amount: Math.round(num(s.amount) * 100) / 100, tip: Math.round(num(s.tip) * 100) / 100, stripePaymentIntentId: c.id,
    via: String(s.via || 'card').slice(0, 30), payerName: s.label || null, label: s.label || null, payerClientId: s.payerClientId || null, at: now(), by: s.by || 'Card payment' };
  const r = await addShareToTicket(db, tenantId, pendingId, tn);
  if (r.result === 'closed' || r.result === 'paid' || r.result === 'overpays') { await keepApartPayment(db, tenantId, pendingId, c.id).catch(() => null); return 'kept_apart'; }
  if (r.result === 'removed') return 'removed';
  return r.result === 'added' ? 'added' : r.result === 'already' ? 'already' : 'no_ticket';
}

/** Close an unfinished payment on the screen before anything replaces it — cancel it at Stripe, so the client can't pay
 *  for a sale the desk has moved on from. If Stripe says it had already gone through, it goes on its sale (or its split)
 *  as above. `why`: what happened, in words for the sale's note ("the desk moved on"). Returns 'none' | 'cancelled' |
 *  'paid' | 'processing' — still going through at the bank (some cards and wallets take a moment): it can't be called off
 *  and may yet be paid, so the caller leaves it open (Stripe's notice puts it on its sale if it goes through) | 'unknown'
 *  — it couldn't be called off and Stripe couldn't say why (unreachable, say): it may still be paid on the form already
 *  open, so it's left open too and the caller says to try again. Only Stripe saying it's canceled counts as called off. */
export type Closed = 'none' | 'cancelled' | 'paid' | 'processing' | 'unknown';
/** Left open: still going through, or not known to be called off. */
export const stillOpen = (r: Closed) => r === 'processing' || r === 'unknown';
export async function closeOpenPayment(db: any, s: any, why: string): Promise<Closed> {
  const q = s?.request; if (!q || q.kind !== 'pay' || q.answeredAt || !q.paymentIntentId || !s.tenantId) return 'none';
  const t: any = ((await db.doc(`tenants/${s.tenantId}`).get()).data() as any) || {};
  const stripe: any = readerStripe();
  if (!t.stripeAccountId || !stripe) return 'none';
  try { await stripe.paymentIntents.cancel(q.paymentIntentId, { cancellation_reason: 'abandoned' } as any, { stripeAccount: t.stripeAccountId } as any); return 'cancelled'; }
  catch {
    // It couldn't be called off: it went through (and nothing of it was refunded since), so it goes on its sale.
    const ticket = String(q.splitPendingId || q.pendingId || '');
    const c = ticket ? await checkDeskPayment(stripe, t.stripeAccountId, String(q.paymentIntentId), s.tenantId, ticket) : null;
    if (c?.ok) {
      if (q.splitPendingId) await recordCardShare(db, s.tenantId, String(q.splitPendingId), c.pi, { amount: num(q.amount) - num(q.tip), tip: num(q.tip), label: q.shareLabel || null, via: 'client_screen', payerClientId: q.clientId || null, by: 'Client screen' }).catch(() => null);
      else if (q.pendingId) await paidOnScreen(db, s.tenantId, String(q.pendingId), c.pi, q, { note: `Paid on the client screen after ${why}` }).catch(() => {});
      return 'paid';
    }
    if (c?.status === 'processing') return 'processing';
    // Refunded, or not this sale's: nothing of it is left to pay here.
    if (c && c.status !== 'unknown' && c.status !== 'not_paid') return 'none';
    // Not paid, and it wouldn't be called off: called off only once Stripe says it's canceled.
    const st = (c as any)?.pi?.status || await stripe.paymentIntents.retrieve(String(q.paymentIntentId), {}, { stripeAccount: t.stripeAccountId } as any).then((p: any) => p?.status).catch(() => null);
    return st === 'canceled' ? 'cancelled' : st === 'processing' ? 'processing' : 'unknown';
  }
}

/** The answer the desk hears when a screen payment is closed: paid (with the payment, so the desk can save the sale
 *  with it) or not. */
export function closedAnswer(q: any, result: Closed) {
  return { requestId: q.id, kind: 'pay', paid: result === 'paid', abandoned: result !== 'paid', late: result === 'paid',
    ...(result === 'paid' ? { paymentIntentId: q.paymentIntentId || null, amount: num(q.amount), tip: num(q.tip), tipAllocations: q.tipAllocations || null, ...(q.splitPendingId ? { share: true, shareLabel: q.shareLabel || null } : {}) } : {}), at: now() };
}

/** Any client-screen payment still open for a sale is closed (one that went through goes on the sale), so the client
 *  can't pay for it after it's been settled another way: before a manager records or discards it, once the sale is saved,
 *  and before the desk asks for it on another screen (`except`: that screen — an iPad and the client's own phone never
 *  both hold a live payment for one sale). One still going through at the bank, or not known to be called off, is left
 *  open (see closeOpenPayment) and listed, so the desk can wait or try again. `keepShares`: split shares on other screens
 *  stay (two people can pay their shares at once). `exceptPi`: the payment the sale is being saved with stays.
 *  `failed`: the screens couldn't be looked up, so nothing is known to be closed. */
export type ScreenClose = { paid: number; processing: number; unknown: number; failed: boolean; names: string[]; open: { name: string; at: string | null; state: Closed }[] };
export async function closeScreenPaymentsFor(db: any, tenantId: string, pendingId: string, o: { except?: string; why?: string; keepShares?: boolean; exceptPi?: string | null } = {}): Promise<ScreenClose> {
  const out: ScreenClose = { paid: 0, processing: 0, unknown: 0, failed: false, names: [], open: [] };
  // Only screens with a payment on them; the business's screens all over again if that lookup can't be made.
  const snap = await db.collection('clientScreens').where('tenantId', '==', tenantId).where('request.kind', '==', 'pay').get()
    .catch(() => db.collection('clientScreens').where('tenantId', '==', tenantId).get()).catch(() => null);
  if (!snap) { out.failed = true; return out; }
  for (const d of snap.docs) {
    if (o.except && d.id === o.except) continue;
    const s: any = d.data() || {}; const q = s.request;
    if (!q || q.kind !== 'pay' || q.answeredAt || (String(q.pendingId || '') !== pendingId && String(q.splitPendingId || '') !== pendingId)) continue;
    if (o.keepShares && q.splitPendingId) continue;
    if (o.exceptPi && q.paymentIntentId === o.exceptPi) continue;
    const r = await closeOpenPayment(db, s, o.why || 'a manager settled the sale');
    if (stillOpen(r)) { if (r === 'processing') out.processing++; else out.unknown++; out.names.push(String(s.name || 'the client screen')); out.open.push({ name: String(s.name || 'the client screen'), at: q.at || null, state: r }); continue; }
    if (r === 'paid') out.paid++;
    await d.ref.update({ request: null, phase: 'ticket', response: closedAnswer(q, r), updatedAt: now() }).catch(() => {});
  }
  return out;
}
