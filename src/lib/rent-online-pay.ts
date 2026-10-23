// src/lib/rent-online-pay.ts — RENT PAID ONLINE, RECORDED ONCE (server).
// A renter pays an invoice on a Stripe page on the platform's own account (api/portal/renter, pay-invoice). Whichever
// comes first records it — their return to the portal (confirm-invoice), a later tap on Pay, or Stripe's own notice
// (api/stripe/billing-webhook) — and the others find it done:
//   - the rent's line and its Stripe fee (named after the page) and the invoice marked paid, in one step;
//   - money that came in but isn't owed (the invoice was already paid — another page, the desk, autopay — or isn't open
//     any more, or the part of a payment that's more than was owed) goes back to the card: written on the invoice first
//     (two notices at the same moment refund it once), refunded under one key for that payment and amount, and the
//     studio is told. If Stripe says no, it stays on the invoice for the studio, and the note says so; if Stripe doesn't
//     answer, the next notice or return sends the same refund again.
// A page whose bank payment is still clearing is recorded only once Stripe says the money arrived.
import { logAuditAdmin } from '@/lib/audit';

export type RentPaid = { missing?: boolean; already?: boolean; paidCents?: number; refundedCents?: number; extra?: boolean; refunded?: boolean; message?: string };

const usd = (c: number) => `$${(Math.round(c) / 100).toFixed(2)}`;
const sidKey = (s: any) => String(s || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 120);
const piOf = (s: any): string | null => (typeof s?.payment_intent === 'string' ? s.payment_intent : s?.payment_intent?.id || null);
const refusedByStripe = (e: any) => ['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError'].includes(String(e?.type || ''));

/** A finished page whose money hasn't arrived: still clearing (a bank debit takes days), failed (a new page can be
 *  made), or unknown (Stripe didn't answer — ask again). */
export async function pageClearing(stripe: any, cs: any): Promise<'clearing' | 'failed' | 'unknown'> {
  const id = piOf(cs); if (!id) return 'failed';
  try {
    const pi: any = await stripe.paymentIntents.retrieve(String(id));
    return ['requires_payment_method', 'canceled'].includes(String(pi?.status || '')) ? 'failed' : 'clearing';
  } catch { return 'unknown'; }
}

/** Record one paid page for this invoice, once (see the header). `cs` is the paid Checkout page. */
export async function recordRentPayment(db: any, stripe: any, tenantId: string, invoiceId: string, cs: any): Promise<RentPaid> {
  const invRef = db.doc(`tenants/${tenantId}/rentInvoices/${invoiceId}`);
  const inv: any = (await invRef.get()).data() || null;
  if (!inv) return { missing: true };
  const lease: any = inv.leaseId ? ((await db.doc(`tenants/${tenantId}/leases/${inv.leaseId}`).get()).data() || null) : null;
  const renter: any = lease?.renterId ? ((await db.doc(`tenants/${tenantId}/renters/${lease.renterId}`).get()).data() || null) : null;
  const renterName = `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim() || 'Renter';
  const due = String(inv.dueDate || '').slice(0, 10);
  const k = sidKey(cs.id); const pi = piOf(cs);

  // Money that came in but isn't owed, back to the card.
  const refundExtra = async (cents: number, why: 'paid_twice' | 'not_open' | 'overpaid') => {
    const at = new Date().toISOString();
    const what = why === 'overpaid' ? `the extra ${usd(cents)} you paid` : `your payment of ${usd(cents)}`;
    const lead = why === 'paid_twice' ? 'This invoice was already paid' : why === 'not_open' ? 'This invoice isn’t open any more' : 'Your rent is paid';
    const claim: any = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(invRef)).data() || {}; const e = cur.extraPayments?.[k] || null;
      if (e?.state === 'refunded') return { done: true };
      if (e?.state === 'refunding' && Date.now() - (Date.parse(String(e.claimAt || '')) || 0) < 2 * 60000) return { busy: true };
      tx.set(invRef, { extraPayments: { [k]: { sessionId: String(cs.id), paymentIntentId: pi, cents, why, state: 'refunding', claimAt: at, firstAt: e?.firstAt || at } } }, { merge: true });
      return { go: true };
    });
    if (claim.done) return { refunded: true, message: `${lead}, so ${what} was refunded to your card.` };
    if (claim.busy) return { refunded: false, message: `${lead}, so ${what} is being refunded to your card.` };
    let state: 'refunded' | 'refund_failed' | 'refunding' = 'refunding'; let refundId: string | null = null; let error = '';
    if (!pi || !(cents > 0)) { state = 'refund_failed'; error = 'No card payment was found to refund.'; }
    else {
      try {
        const rf: any = await stripe.refunds.create({ payment_intent: String(pi), amount: Math.round(cents), reason: 'requested_by_customer',
          metadata: { tenantId, invoiceId, kind: 'rent_refund', why, origin: 'app' } }, { idempotencyKey: `rent-${why}-${sidKey(pi)}-${Math.round(cents)}` });
        state = 'refunded'; refundId = rf?.id || null;
      } catch (e: any) {
        if (String(e?.code || e?.raw?.code || '') === 'charge_already_refunded') state = 'refunded';
        else if (refusedByStripe(e)) { state = 'refund_failed'; error = String(e?.raw?.message || e?.message || 'The refund was refused.').slice(0, 200); }
      }
    }
    await invRef.set({ extraPayments: { [k]: { state, ...(state === 'refunded' ? { refundedAt: new Date().toISOString(), refundId } : {}), ...(error ? { error } : {}) } } }, { merge: true });
    // The studio hears about it once per payment (the note is named after it, and says where it got to).
    const happened = why === 'paid_twice' ? `${renterName} paid their rent due ${due} a second time (${usd(cents)}).`
      : why === 'not_open' ? `${renterName} paid ${usd(cents)} for their rent due ${due}, which isn’t open any more.`
      : `${renterName} paid ${usd(cents)} more than their rent due ${due} needed.`;
    const nRef = db.doc(`tenants/${tenantId}/notifications/rent_extra_${k}`);
    await nRef.set({ id: nRef.id, userId: null, read: false, createdAt: new Date().toISOString(), type: 'rent_paid', link: '/rent',
      message: `${happened} ${state === 'refunded' ? 'It was refunded to their card automatically.' : state === 'refund_failed' ? `The automatic refund didn’t go through (${error}), so please refund it in Stripe.` : 'Stripe hasn’t confirmed the refund yet. Please check it in Stripe before refunding it by hand.'}` }).catch(() => {});
    return { refunded: state === 'refunded', message: state === 'refunded' ? `${lead}, so ${what} was refunded to your card.`
      : state === 'refunding' ? `${lead}, so ${what} is being refunded to your card.` : `${lead}. ${what.charAt(0).toUpperCase()}${what.slice(1)} will be refunded by the studio.` };
  };

  const paidNow = Math.round(Number(cs.amount_total) || 0);
  const lineRef = db.doc(`tenants/${tenantId}/transactions/rentpay_${k}`);
  const feeRef = db.doc(`tenants/${tenantId}/transactions/rentpayfee_${k}`);
  // Recorded before lines were named after the page: that line stands (found by its payment).
  const legacy = pi ? (await db.collection(`tenants/${tenantId}/transactions`).where('sourceId', '==', invoiceId).get()).docs
    .find((d: any) => (d.data() as any).type === 'income' && (d.data() as any).stripePaymentIntentId === pi) || null : null;
  // The paired Stripe fee, looked up first — fail-open, fee recording never blocks revenue.
  let feeCents = 0;
  if (!legacy && pi) {
    try { const p: any = await stripe.paymentIntents.retrieve(String(pi), { expand: ['latest_charge.balance_transaction'] }); feeCents = Number(p?.latest_charge?.balance_transaction?.fee) || 0; }
    catch { /* fee is informational */ }
  }
  const nowIso = new Date().toISOString();
  const out: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(invRef)).data() || {};
    const line = await tx.get(lineRef);
    if (line.exists || legacy || cur.paidSessionId === cs.id || (!!pi && cur.stripePaymentIntentId === pi)) {
      if (legacy && cur.status !== 'paid') tx.set(invRef, { status: 'paid', paidAt: nowIso, paidMethod: 'Card (Stripe)', paidLedgerEntryId: legacy.id, stripePaymentIntentId: pi, paidSessionId: cs.id }, { merge: true });
      return { already: true };
    }
    const owed = Math.max(0, (cur.amountCents || 0) + (cur.lateFeeCents || 0) - (cur.paidCents || 0));
    if (!['due', 'late'].includes(String(cur.status)) || owed <= 0) return { extra: paidNow, why: cur.status === 'paid' || owed <= 0 ? 'paid_twice' : 'not_open' };
    const take = Math.min(paidNow > 0 ? paidNow : owed, owed);
    tx.set(lineRef, {
      id: lineRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
      source: 'booth_rent', category: 'Booth Rent',
      amount: take / 100,
      description: `Booth rent — due ${due} (paid online)${cur.lateFeeCents > 0 ? ` · incl. $${(cur.lateFeeCents / 100).toFixed(2)} late fee` : ''}`,
      clientOrVendor: renterName, date: nowIso, paymentMethod: 'Card (Stripe)',
      hasReceipt: false, sourceId: invoiceId, checkoutSessionId: String(cs.id),
      stripePaymentIntentId: pi,
      tenantId, createdAt: nowIso,
    });
    if (feeCents > 0) tx.set(feeRef, {
      id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
      category: 'Processing Fee', amount: feeCents / 100,
      description: `Stripe fee — rent due ${due}`,
      clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
      hasReceipt: false, relatedTxnId: lineRef.id, sourceId: invoiceId, stripePaymentIntentId: pi, tenantId, createdAt: nowIso,
    });
    // Less than what's owed now (a late fee came on while they were paying): it counts toward the invoice, which stays
    // open for the rest.
    tx.set(invRef, take >= owed
      ? { status: 'paid', paidAt: nowIso, paidMethod: 'Card (Stripe)', paidAmountCents: take, paidLedgerEntryId: lineRef.id, stripePaymentIntentId: pi, paidSessionId: String(cs.id) }
      : { paidCents: (Number(cur.paidCents) || 0) + take, lastPaidOnlineAt: nowIso, updatedAt: nowIso }, { merge: true });
    return { take, over: Math.max(0, paidNow - take) };
  });
  if (out.already) return { already: true };
  if (out.extra) { const r = await refundExtra(out.extra, out.why); return { extra: true, refunded: r.refunded, message: r.message }; }
  let refundedCents = 0;
  if (out.over > 0) { const r = await refundExtra(out.over, 'overpaid'); if (r.refunded) refundedCents = out.over; }
  // Save the card on file to the RENTER doc (the single card store the studio's capped incidentals charge reads) so
  // incidentals can be charged off-session later. Best-effort — never blocks the receipt.
  try {
    if (lease?.renterId && pi) {
      const p: any = await stripe.paymentIntents.retrieve(String(pi));
      const pmId = p?.payment_method ? String(p.payment_method) : null;
      const custId = p?.customer ? String(p.customer) : (cs.customer ? String(cs.customer) : null);
      if (pmId) {
        let brand = 'card', last4 = '';
        try {
          const pm: any = await stripe.paymentMethods.retrieve(pmId);
          brand = pm?.card?.brand || 'card';
          last4 = pm?.card?.last4 || '';
        } catch { /* card summary is cosmetic */ }
        await db.doc(`tenants/${tenantId}/renters/${lease.renterId}`).set({
          stripeCustomerId: custId || renter?.stripeCustomerId || null,
          stripePaymentMethodId: pmId,
          cardOnFile: true,
          cardBrand: brand,
          cardLast4: last4,
          cardSetupAt: nowIso,
        }, { merge: true });
      }
    }
  } catch { /* card-on-file capture is best-effort */ }
  await logAuditAdmin(db, tenantId, {
    action: 'rent.paid_online', targetType: 'rentInvoice', targetId: invoiceId,
    summary: `${renterName} paid $${(out.take / 100).toFixed(2)} rent online (due ${due})`,
    amount: out.take / 100,
    actor: { type: 'user', name: renterName, role: 'renter', via: 'renter-portal' },
  });
  const payNotif = db.doc(`tenants/${tenantId}/notifications/rent_paid_${k}`);
  await payNotif.set({
    id: payNotif.id, userId: null, read: false, createdAt: nowIso,
    type: 'rent_paid', link: '/rent',
    message: `${renterName} has paid $${(out.take / 100).toFixed(2)} in rent online.`,
  });
  return { paidCents: out.take, ...(out.over > 0 ? { refundedCents } : {}) };
}
