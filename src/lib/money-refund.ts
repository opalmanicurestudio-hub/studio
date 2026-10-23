// src/lib/money-refund.ts — send a sale's refund back to the client's card (server).
// Finds the card payment behind a sale (on the transaction, or on the receipt for
// the same checkout) and refunds the amount on the business's connected account.
// Split payments are refunded card by card until the amount is covered. Once per sale: the refund is claimed on the
// sale before Stripe is asked, each card's refund has one key for the sale (so a retry replays it, and a retry asking a
// different amount is refused by Stripe rather than sent again), and what went back is kept on the sale, so a try
// after an earlier one whose record didn't save finds it (Stripe is asked, by the sale's name on the refund).
// A booking's deposit is refunded as a deposit (lib/deposit-refund): its credit is closed in the same moves.
import { refundAmount } from '@/lib/stripe-refund';

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export type CardRefund = { ok: true; card: false } | { ok: true; card: true; refundedCents: number; shortCents: number; deposit?: boolean; already?: boolean } | { ok: false; error: string; status: number };

export async function refundSaleToCard(db: any, tenantId: string, tenant: any, transactionId: string, want: number, byName: string | null): Promise<CardRefund> {
  const T = `tenants/${tenantId}`; const xRef = db.doc(`${T}/transactions/${transactionId}`); const xSnap = await xRef.get();
  if (!xSnap.exists) return { ok: false, error: 'That sale wasn’t found.', status: 404 };
  const x: any = xSnap.data();
  if (x.refundedAt || x.voided) return { ok: false, error: 'This sale was already refunded.', status: 409 };
  // An online order is refunded on the order (api/retail/refund), so its items, its sales tax and the customer's email
  // all follow; a refund from here would miss them.
  if (x.retailOrderId) return { ok: false, error: 'This is an online order. Refund it from the order in Orders, so the items, the sales tax and the customer’s email all follow.', status: 409 };
  // A booking's deposit: refunded as a deposit, so its credit is closed and it can't also come off their next bill.
  const { isDepositLine, depositForLine, refundDepositCredit } = await import('@/lib/deposit-refund');
  if (isDepositLine(x) && String(x.paymentMethod || '').toLowerCase() !== 'cash') {
    const creditId = await depositForLine(db, tenantId, x);
    if (!creditId) return { ok: false, error: 'This is a booking deposit, but its deposit record can’t be found. Refund it from the booking.', status: 409 };
    const c: any = (await db.doc(`${T}/depositCredits/${creditId}`).get()).data() || {};
    const { creditLeftCents } = await import('@/lib/credit-pools');
    const left = c.status === 'available' ? creditLeftCents(c) : 0;
    if (c.status === 'available' && Math.round(want) !== left) return { ok: false, error: left > 0 ? `A deposit goes back whole: $${(left / 100).toFixed(2)} is left on this one.` : 'Nothing is left on this deposit to refund.', status: 409 };
    const Stripe = (await import('stripe')).default;
    const r = await refundDepositCredit(db, tenantId, creditId, new Stripe(String(process.env.STRIPE_SECRET_KEY || ''), { apiVersion: '2024-06-20' as any }), { by: byName, saleLineId: transactionId });
    if (!r.ok) return r;
    return { ok: true, card: true, deposit: true, refundedCents: Math.round(r.amount * 100), shortCents: 0, ...(r.already ? { already: true } : {}) };
  }
  // A deposit paid in cash, refunded from the till: its credit is closed here (the till and the books are the page's).
  if (isDepositLine(x)) {
    const creditId = await depositForLine(db, tenantId, x);
    if (creditId) {
      const { creditLeftCents } = await import('@/lib/credit-pools');
      const cRef = db.doc(`${T}/depositCredits/${creditId}`);
      const closed: any = await db.runTransaction(async (tx: any) => {
        const c: any = (await tx.get(cRef)).data() || {};
        if (c.status !== 'available') return { error: c.status === 'refunded' ? 'This deposit was already refunded.' : `This deposit is ${String(c.status || 'not available')}, so it can’t be refunded.` };
        const left = creditLeftCents(c);
        if (Math.round(want) !== left) return { error: left > 0 ? `A deposit goes back whole: $${(left / 100).toFixed(2)} is left on this one.` : 'Nothing is left on this deposit to refund.' };
        tx.set(cRef, { status: 'refunded', refundedAt: new Date().toISOString(), refundedCents: left, refundedVia: 'cash', refundedBy: byName || null }, { merge: true });
        return { ok: true };
      });
      if (closed.error) return { ok: false, error: closed.error, status: 409 };
    }
    return { ok: true, card: false };
  }
  if (String(x.paymentMethod || '').toLowerCase() === 'cash') return { ok: true, card: false };
  let cards: { pi: string; cents: number }[] = [];
  if (x.stripePaymentIntentId) cards = [{ pi: String(x.stripePaymentIntentId), cents: Math.round((num(x.amount) + num(x.tipAmount)) * 100) }];
  else if (x.checkoutSessionId) {
    const rs = await db.collection(`${T}/receipts`).where('checkoutSessionId', '==', String(x.checkoutSessionId)).limit(1).get();
    const r: any = rs.empty ? null : rs.docs[0].data();
    if (r && Array.isArray(r.payments) && r.payments.length) cards = r.payments.filter((p: any) => p.stripePaymentIntentId && !p.refundedAt).map((p: any) => ({ pi: String(p.stripePaymentIntentId), cents: Math.round((num(p.amount) + num(p.tip)) * 100) }));
    else if (r?.stripePaymentIntentId) cards = [{ pi: String(r.stripePaymentIntentId), cents: Math.round(num(r.total) * 100) }];
  }
  if (!cards.length) return { ok: true, card: false };
  const acct = tenant.stripeAccountId || tenant.stripeConnectAccountId || null;
  // Sent to the card before (an earlier try, its record not saved yet): that refund stands, and nothing more goes.
  const priorOf = (v: any) => (Array.isArray(v?.cardRefunds) ? v.cardRefunds : []).reduce((s: number, d: any) => s + Math.round(num(d?.cents)), 0);
  if (priorOf(x) > 0) return { ok: true, card: true, refundedCents: priorOf(x), shortCents: Math.max(0, Math.round(want) - priorOf(x)), already: true };
  // Claimed on the sale first: a second tap while this one is going is told so.
  const claim: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(xRef)).data() || {};
    if (cur.refundedAt || cur.voided) return { error: 'This sale was already refunded.', status: 409 };
    if (priorOf(cur) > 0) return { prior: priorOf(cur) };
    if (cur.cardRefundClaim?.at && Date.now() - (Date.parse(String(cur.cardRefundClaim.at)) || 0) < 120000) return { error: 'A refund for this sale is already being sent. Give it a moment.', status: 409 };
    tx.set(xRef, { cardRefundClaim: { at: new Date().toISOString(), cents: Math.round(want), by: byName || null } }, { merge: true });
    return { stale: cur.cardRefundClaim || null };
  });
  if (claim.error) return { ok: false, error: claim.error, status: claim.status };
  if (claim.prior) return { ok: true, card: true, refundedCents: claim.prior, shortCents: Math.max(0, Math.round(want) - claim.prior), already: true };
  // An earlier try that was cut off after asking Stripe: its refund is found by the sale's name on it, never sent again.
  if (claim.stale) {
    try {
      const Stripe = (await import('stripe')).default; const stripe: any = new Stripe(String(process.env.STRIPE_SECRET_KEY || ''), { apiVersion: '2024-06-20' as any });
      const found: { pi: string; cents: number; refundId?: string }[] = [];
      for (const c of cards) { const l: any = await stripe.refunds.list({ payment_intent: c.pi, limit: 100 }, { stripeAccount: acct });
        for (const r of l?.data || []) if (r?.metadata?.moneyRefundOf === transactionId && !['failed', 'canceled'].includes(String(r.status || ''))) found.push({ pi: c.pi, cents: Number(r.amount) || 0, refundId: r.id }); }
      if (found.length) {
        await xRef.set({ cardRefunds: found.map((d) => ({ ...d, at: new Date().toISOString(), by: byName })), cardRefundClaim: null }, { merge: true });
        const got = found.reduce((s, d) => s + d.cents, 0);
        return { ok: true, card: true, refundedCents: got, shortCents: Math.max(0, Math.round(want) - got), already: true };
      }
    } catch { return { ok: false, error: 'Stripe couldn’t be checked for an earlier try at this refund. Try again in a moment.', status: 502 }; }
  }
  let left = Math.round(want); const done: { pi: string; cents: number; refundId?: string }[] = [];
  for (const c of cards) {
    if (left <= 0) break;
    const cents = Math.min(left, c.cents || left);
    const r = await refundAmount(acct, c.pi, cents, `money-refund-${transactionId}-${c.pi}`, { moneyRefundOf: transactionId });
    if (!r.ok) {
      if (!done.length) { await xRef.set({ cardRefundClaim: null }, { merge: true }).catch(() => {}); return { ok: false, error: r.error || 'The card refund didn’t go through.', status: 502 }; }
      break;
    }
    done.push({ pi: c.pi, cents, refundId: r.id }); left -= cents;
  }
  const refunded = done.reduce((s, d) => s + d.cents, 0);
  if (refunded > 0 && x.checkoutSessionId) { try { const { reverseSale } = await import('@/lib/loyalty-server'); await reverseSale(db, tenantId, { saleId: String(x.checkoutSessionId), refundCents: refunded, refundId: `c${transactionId}`, by: byName || 'Refund' }); } catch { /* best effort */ } }
  await xRef.set({ cardRefunds: done.map((d) => ({ ...d, at: new Date().toISOString(), by: byName })), cardRefundClaim: null }, { merge: true }).catch(() => {});
  return { ok: true, card: true, refundedCents: refunded, shortCents: Math.max(0, Math.round(want) - refunded) };
}

// The visit's sale — the one a Making it right refund goes back against.
export async function saleForVisit(db: any, tenantId: string, appointmentId: string) {
  if (!appointmentId) return null;
  const qs = await db.collection(`tenants/${tenantId}/transactions`).where('appointmentId', '==', appointmentId).get();
  const rows = qs.docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((t: any) => t.type !== 'reversal' && t.type !== 'expense' && !t.refundedAt && !t.voided && num(t.amount) > 0);
  rows.sort((a: any, b: any) => num(b.amount) - num(a.amount));
  return rows[0] || null;
}
