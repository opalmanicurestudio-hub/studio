// src/lib/screen-pay.ts — A PAYMENT TAKEN ON THE CLIENT SCREEN (OR A SPLIT SHARE ON A CARD) GOES ON ITS SALE (server).
// Used wherever the server learns a payment went through: the screen's "paid" answer, a payment found paid as the desk
// moves on or a manager records the sale, and Stripe's notice (connect-webhook) as the safety net. Whichever comes first
// puts it on the ticket; the others change nothing (lib/reader-sale keeps each payment on a ticket once).
//  - The whole sale: it pays for the sale (with the tip the client chose on the screen), or — when the sale was already
//    paid another way — it's kept apart for a manager to refund, and the desk and managers are told.
//  - One share of a split bill: added to the split as it's paid; one that lands on a sale already finished, discarded or
//    paid in full is kept apart the same way, never lost and never counted twice.
import crypto from 'crypto';
import { addShareToTicket, keepApartPayment, markSalePaid, readerStripe, tellDeskReader } from '@/lib/reader-sale';

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

/** One card share of a split bill, on its ticket (see above). Returns what happened: added, already there, or kept
 *  apart because the sale was finished or paid in full. */
export async function recordCardShare(db: any, tenantId: string, pendingId: string, pi: any, s: { amount: number; tip?: number; label?: string | null; via: string; payerClientId?: string | null; by?: string }): Promise<'added' | 'already' | 'kept_apart' | 'no_ticket'> {
  const tn = { id: crypto.randomBytes(6).toString('hex'), method: 'card', amount: Math.round(num(s.amount) * 100) / 100, tip: Math.round(num(s.tip) * 100) / 100, stripePaymentIntentId: String(pi.id),
    via: String(s.via || 'card').slice(0, 30), payerName: s.label || null, label: s.label || null, payerClientId: s.payerClientId || null, at: now(), by: s.by || 'Card payment' };
  const r = await addShareToTicket(db, tenantId, pendingId, tn);
  if (r.result === 'closed' || r.result === 'paid') { await keepApartPayment(db, tenantId, pendingId, String(pi.id)).catch(() => null); return 'kept_apart'; }
  return r.result === 'added' ? 'added' : r.result === 'already' ? 'already' : 'no_ticket';
}

/** Close an unfinished payment on the screen before anything replaces it — cancel it at Stripe, so the client can't pay
 *  for a sale the desk has moved on from. If Stripe says it had already gone through, it goes on its sale (or its split)
 *  as above. `why`: what happened, in words for the sale's note ("the desk moved on"). Returns 'none' | 'cancelled' |
 *  'paid'. */
export async function closeOpenPayment(db: any, s: any, why: string): Promise<'none' | 'cancelled' | 'paid'> {
  const q = s?.request; if (!q || q.kind !== 'pay' || q.answeredAt || !q.paymentIntentId || !s.tenantId) return 'none';
  const t: any = ((await db.doc(`tenants/${s.tenantId}`).get()).data() as any) || {};
  const stripe: any = readerStripe();
  if (!t.stripeAccountId || !stripe) return 'none';
  try { await stripe.paymentIntents.cancel(q.paymentIntentId, { cancellation_reason: 'abandoned' } as any, { stripeAccount: t.stripeAccountId } as any); return 'cancelled'; }
  catch {
    const pi: any = await stripe.paymentIntents.retrieve(q.paymentIntentId, { stripeAccount: t.stripeAccountId } as any).catch(() => null);
    if (pi?.status === 'succeeded') {
      if (q.splitPendingId) await recordCardShare(db, s.tenantId, String(q.splitPendingId), pi, { amount: num(q.amount) - num(q.tip), tip: num(q.tip), label: q.shareLabel || null, via: 'client_screen', payerClientId: q.clientId || null, by: 'Client screen' }).catch(() => null);
      else if (q.pendingId) await paidOnScreen(db, s.tenantId, String(q.pendingId), pi, q, { note: `Paid on the client screen after ${why}` }).catch(() => {});
      return 'paid';
    }
    return 'none';
  }
}

/** The answer the desk hears when a screen payment is closed: paid (with the payment, so the desk can save the sale
 *  with it) or not. */
export function closedAnswer(q: any, result: 'none' | 'cancelled' | 'paid') {
  return { requestId: q.id, kind: 'pay', paid: result === 'paid', abandoned: result !== 'paid', late: result === 'paid',
    ...(result === 'paid' ? { paymentIntentId: q.paymentIntentId || null, amount: num(q.amount), tip: num(q.tip), tipAllocations: q.tipAllocations || null, ...(q.splitPendingId ? { share: true } : {}) } : {}), at: now() };
}

/** Before a manager records or discards a sale: any client-screen payment still open for it is closed first (one that
 *  went through goes on the sale), so the client can't pay for it after it's been settled another way. */
export async function closeScreenPaymentsFor(db: any, tenantId: string, pendingId: string): Promise<number> {
  const snap = await db.collection('clientScreens').where('tenantId', '==', tenantId).get().catch(() => ({ docs: [] as any[] }));
  let paid = 0;
  for (const d of snap.docs) {
    const s: any = d.data() || {}; const q = s.request;
    if (!q || q.kind !== 'pay' || q.answeredAt || (String(q.pendingId || '') !== pendingId && String(q.splitPendingId || '') !== pendingId)) continue;
    const r = await closeOpenPayment(db, s, 'a manager settled the sale');
    if (r === 'paid') paid++;
    await d.ref.update({ request: null, phase: 'ticket', response: closedAnswer(q, r), updatedAt: now() }).catch(() => {});
  }
  return paid;
}
