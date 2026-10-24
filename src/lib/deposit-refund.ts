// src/lib/deposit-refund.ts — A BOOKING'S DEPOSIT GOES BACK TO THE CARD, ONCE (server). Used by the booking's own
// "Refund deposit" (api/stripe/deposit-refund), by a cancellation the business made (api/stripe/studio-cancel-refund,
// and the refunds waiting to be sent, api/deposits/refund-queue) and by Money when the line being refunded is a
// deposit (lib/money-refund). What's left on the deposit (lib/credit-pools) goes back, and the deposit is closed in the
// same moves, so it can't also come off their next bill:
//   1. claimed: the deposit is set to 'refunding' in one step, only while it's still there to use (a checkout using it
//      at the same moment is told it's gone; two refund taps send one refund);
//   2. refunded through Stripe under one key for this deposit and amount, so a retry replays the same refund (and a
//      refund Stripe already has for this deposit, from an earlier try, is recorded rather than sent again);
//   3. recorded: closed as 'refunded', the refund is in the books as a return (named after the deposit), and the
//      booking says so when there is one (a walk-in's deposit has no booking to mark).
// Stripe saying no gives the deposit back to use. No answer from Stripe leaves it 'refunding': the next try sends the
// same refund under the same key, and is recorded once.
import { creditLeftCents, isDepositCredit } from '@/lib/credit-pools';
import { stripeRefused as saidNo } from '@/lib/stripe-said-no';

const safe = (s: any) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);

export type DepositRefund = { ok: true; refundId: string; amount: number; already?: boolean } | { ok: false; error: string; status: number; unknown?: boolean };

export type DepositRefundOptions = {
  by?: string | null; saleLineId?: string | null;
  /** The booking it's refunded for (marked when it exists), the reason, and what else Stripe keeps with the refund. */
  appointmentId?: string | null; reason?: string | null; metadata?: Record<string, string>; note?: string | null;
};

const okId = (v: any) => (/^[A-Za-z0-9_-]{1,160}$/.test(String(v || '')) ? String(v) : null);

export async function refundDepositCredit(db: any, tenantId: string, creditId: string, stripe: any, o: DepositRefundOptions = {}): Promise<DepositRefund> {
  const T = `tenants/${tenantId}`;
  const creditRef = db.doc(`${T}/depositCredits/${safe(creditId)}`);
  const tenant: any = (await db.doc(T).get()).data() || {};
  const acct = tenant.stripeAccountId || tenant.stripeConnectAccountId;
  if (!acct) return { ok: false, error: 'This business has no connected payment account.', status: 400 };
  const now = new Date().toISOString();

  // 1. The claim.
  const claim: any = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(creditRef); const c: any = s.exists ? { ...(s.data() || {}), id: s.id } : null;
    if (!c) return { error: 'Deposit not found.', status: 404 };
    if (c.status === 'refunded') return { already: true, refundId: String(c.stripeRefundId || ''), amount: (Number(c.refundedCents) || 0) / 100 };
    if (!isDepositCredit(c)) return { error: 'That isn’t a booking deposit.', status: 409 };
    if (!c.stripePaymentIntentId) return { error: 'No card payment is on file for this deposit.', status: 400 };
    if (c.status === 'refunding') return { cents: Number(c.refundingCents) || 0, credit: c };   // an earlier try's: the same refund again
    if (c.status !== 'available') return { error: `This deposit is ${String(c.status || 'not available')}, so it can’t be refunded.`, status: 409 };
    const cents = creditLeftCents(c);
    if (!(cents > 0)) return { error: 'Nothing is left on this deposit to refund.', status: 400 };
    tx.set(creditRef, { status: 'refunding', refundingCents: cents, refundingAt: now, refundingBy: o.by || null, refundingForAppointmentId: okId(o.appointmentId) }, { merge: true });
    return { cents, credit: c };
  });
  if (claim.error) return { ok: false, error: claim.error, status: claim.status };
  if (claim.already) return { ok: true, refundId: claim.refundId, amount: claim.amount, already: true };
  const c = claim.credit; const cents = Number(claim.cents) || 0;

  // 2. The refund (one key for this deposit and amount). One Stripe already has for this deposit — an earlier try that
  //    went through without an answer, under an older key, or a cancellation's refund made before this one place
  //    existed — is the refund: recorded, never sent again.
  const apId = okId(o.appointmentId) || okId(c.refundingForAppointmentId);
  let refund: any = null;
  try {
    const l: any = await stripe.refunds.list({ payment_intent: String(c.stripePaymentIntentId), limit: 100 }, { stripeAccount: acct });
    const live = (Array.isArray(l?.data) ? l.data : []).filter((x: any) => x && !['failed', 'canceled'].includes(String(x.status || '')));
    refund = live.find((x: any) => String(x.metadata?.depositCreditId || '') === String(c.id)) || null;
    if (!refund) {
      const forBooking = [apId, okId(c.sourceAppointmentId)].filter(Boolean) as string[];
      for (const x of live.filter((y: any) => y.metadata?.disposition === 'refund' && !y.metadata?.depositCreditId && Number(y.amount) === cents && forBooking.includes(String(y.metadata?.appointmentId || '')))) {
        // …only if no other deposit was closed with it.
        const taken = await db.collection(`${T}/depositCredits`).where('stripeRefundId', '==', String(x.id)).limit(2).get();
        if (!taken.docs.some((d: any) => d.id !== c.id)) { refund = x; break; }
      }
    }
  } catch { /* asked for below, under the deposit's own key */ }
  if (!refund) try {
    refund = await stripe.refunds.create({ payment_intent: String(c.stripePaymentIntentId), amount: cents, reason: 'requested_by_customer',
      metadata: { ...(o.metadata || {}), tenantId, depositCreditId: String(c.id), ...(apId ? { appointmentId: apId } : {}), origin: 'app' } },
      { stripeAccount: acct, idempotencyKey: `deposit_refund_${safe(c.id)}_${cents}` });
  } catch (e: any) {
    const refused = saidNo(e);
    if (refused) await db.runTransaction(async (tx: any) => { const s = await tx.get(creditRef); if ((s.data() || {}).status === 'refunding') tx.set(creditRef, { status: 'available', refundingCents: null, refundingAt: null, refundingForAppointmentId: null }, { merge: true }); }).catch(() => {});
    return { ok: false, error: refused ? `Stripe: ${e?.raw?.message || e?.message || 'the refund was refused.'}` : 'Stripe didn’t answer, so the refund may or may not have gone through. Try again in a moment: it won’t refund twice.', status: 502, ...(refused ? {} : { unknown: true }) };
  }

  // 3. The record.
  const lineRef = db.doc(`${T}/transactions/deposit_refund__${safe(c.id)}`);
  const apRef = apId ? db.doc(`${T}/appointments/${apId}`) : null;
  await db.runTransaction(async (tx: any) => {
    const s = await tx.get(creditRef); const cur: any = s.data() || {};
    const sale = o.saleLineId ? await tx.get(db.doc(`${T}/transactions/${safe(o.saleLineId)}`)) : null;
    const ap = apRef ? await tx.get(apRef) : null;
    if (cur.status === 'refunded') return;
    tx.set(creditRef, { status: 'refunded', refundedAt: now, refundedCents: cents, stripeRefundId: refund.id, refundingCents: null, refundingAt: null,
      ...(apId ? { refundedFromAppointmentId: apId } : {}) }, { merge: true });
    tx.set(lineRef, {
      id: lineRef.id, date: now, description: `Deposit refund — ${c.serviceName || 'Service'} — ${c.clientName || 'Client'}`,
      clientOrVendor: c.clientName || 'Client', clientId: c.clientId || null, type: 'expense', context: 'Business',
      // One category for every refund, a return in the books (lib/books-summary); no sales tax was on a deposit.
      category: 'Refunds', taxBucket: 'refund', refundKind: 'deposit', taxRefunded: 0, amount: cents / 100, paymentMethod: 'Card (Stripe)',
      reversalOf: c.ledgerSourceId || null, appointmentId: apId || c.sourceAppointmentId || null, stripeRefundId: refund.id, stripePaymentIntentId: c.stripePaymentIntentId, hasReceipt: false, tenantId,
      ...(o.reason ? { reason: String(o.reason).slice(0, 300) } : {}), ...(o.note ? { notes: String(o.note).slice(0, 500) } : {}),
    }, { merge: true });
    // Refunded from Money: the deposit's own line says so, so it isn't refunded again from there.
    if (sale?.exists && !(sale.data() || {}).refundedAt) tx.set(sale.ref, { refundedAt: now, refundTransactionId: lineRef.id }, { merge: true });
    // The booking it was refunded for says so (a walk-in's id, or a booking since removed, has nothing to mark).
    if (ap?.exists) tx.set(apRef, { depositRefunded: true, depositRefundedAt: now, depositRefundedAmountCents: cents, depositStripeRefundId: refund.id, depositDisposition: 'refunded' }, { merge: true });
  });
  return { ok: true, refundId: String(refund.id), amount: cents / 100 };
}

/** The deposit a deposit's line in the books was paid for (its own booking, its own payment). */
export async function depositForLine(db: any, tenantId: string, x: any): Promise<string | null> {
  const col = db.collection(`tenants/${tenantId}/depositCredits`);
  if (x?.depositCreditId) return String(x.depositCreditId);
  const tries: [string, any][] = [];
  if (x?.checkoutSessionId) tries.push(['checkoutSessionId', String(x.checkoutSessionId)]);
  if (x?.stripePaymentIntentId) tries.push(['stripePaymentIntentId', String(x.stripePaymentIntentId)]);
  if (x?.stripeChargeId) tries.push(['stripeChargeId', String(x.stripeChargeId)]);
  for (const [k, v] of tries) {
    const q = await col.where(k, '==', v).limit(5).get();
    const hit = q.docs.find((d: any) => isDepositCredit({ ...(d.data() || {}) }) && (!x?.appointmentId || String((d.data() || {}).sourceAppointmentId || '') === String(x.appointmentId)));
    if (hit) return hit.id;
  }
  return null;
}

/** A line in the books that is a booking's deposit. */
export const isDepositLine = (x: any) => ['retainers', 'deposits', 'deposit'].includes(String(x?.category || '').trim().toLowerCase()) && String(x?.type || 'income').toLowerCase() === 'income';

/** The five-minute check: a deposit left 'refunding' (Stripe's answer was lost and nobody asked again) is finished by
 *  the same steps: a refund Stripe already has for it is recorded; one it never got is sent under the same key, as the
 *  person who asked for it meant; Stripe saying no gives the deposit back to use. Deposits set aside by undoing a
 *  booking are left to that (lib/undo-booking). Two runs at once finish each once (the refund has one key, and the record
 *  is written once). */
export async function settleStuckDepositRefunds(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ checked: number; recorded: number; released: number; waiting: number }> {
  const out = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  if (!tenant?.stripeAccountId && !tenant?.stripeConnectAccountId) return out;
  const now = o.now ?? Date.now();
  const snap = await db.collection(`tenants/${tenantId}/depositCredits`).where('status', '==', 'refunding').limit(50).get().catch(() => ({ docs: [] as any[] }));
  let stripe = o.stripe;
  for (const d of snap.docs) {
    const c: any = d.data() || {};
    if (String(c.refundingFor || '').startsWith('undo_')) continue;
    if (now - (Date.parse(String(c.refundingAt || '')) || now) < 15 * 60000) continue;
    // Taken over in one step, so two runs at once don't both send it (the second would find the key still in use).
    const mine = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(d.ref)).data() || {};
      if (cur.status !== 'refunding' || String(cur.refundingFor || '').startsWith('undo_')) return false;
      if (cur.settlingAt && now - (Date.parse(String(cur.settlingAt)) || 0) < 5 * 60000) return false;
      tx.set(d.ref, { settlingAt: new Date(now).toISOString() }, { merge: true }); return true;
    }).catch(() => false);
    if (!mine) continue;
    out.checked++;
    if (!stripe) { const S = (await import('stripe')).default; stripe = new S(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }); }
    await refundDepositCredit(db, tenantId, d.id, stripe, { by: 'Automatic check', appointmentId: c.refundingForAppointmentId || null }).catch(() => null);
    // Where it got to: refunded and recorded, given back to use (Stripe said no), or still waiting on Stripe.
    await d.ref.set({ settlingAt: null }, { merge: true }).catch(() => {});
    const st = String(((await d.ref.get()).data() || {}).status || '');
    if (st === 'refunded') out.recorded++; else if (st === 'refunding') out.waiting++; else out.released++;
  }
  return out;
}
