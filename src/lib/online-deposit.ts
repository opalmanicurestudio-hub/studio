// src/lib/online-deposit.ts — A DEPOSIT PAID ONLINE IS RECORDED ONCE (server). The booking page's payment and a
// booking's pay link both end here (the connected accounts webhook, lib/connect-webhook). The booking is marked paid,
// and the deposit's credit (what comes off the bill at the visit) and its income line are written in the same step,
// each named after the payment, so a notice Stripe sends twice, or two at the same moment, records it once.
// A second payment for a deposit already paid another way is kept (the money came in, so its credit and income are
// written) and the booking is flagged for someone to refund one of them; it is never dropped from the books.
// A balance the client owed, collected with the deposit (lib/balance-with-deposit), clears in the same step: the
// client's balance comes down and it's in the books as a fee paid, so a notice retried after a failure can't miss it.
import { splitPaid } from '@/lib/balance-with-deposit';
import { depositCreditId } from '@/lib/deposit-record';

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));
const safe = (s: any) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);

/** The income line for a deposit paid online: one per payment page. */
export const onlineDepositIncomeId = (sessionId: string) => `deposit_in_${safe(sessionId)}`;
/** The owed balance collected with it, when there was one. */
export const onlineBalanceIncomeId = (sessionId: string) => `deposit_bal_${safe(sessionId)}`;
/** The deposit's credit: named after the card payment (as a deposit charged to a saved card is), else the page. */
export const onlineDepositCreditId = (paymentIntentId: string | null | undefined, sessionId: string) =>
  paymentIntentId ? depositCreditId(paymentIntentId) : `deposit_cs_${safe(sessionId)}`;

export type OnlineDeposit = {
  appointmentId: string;
  sessionId: string;
  paymentIntentId?: string | null;
  chargeId?: string | null;
  /** Everything the page took: the deposit, and any balance the client owed that was collected with it. */
  paidCents: number;
  /** How it was paid, for the record ('online booking', 'pay link'). */
  via: string;
  serviceName?: string | null;
  clientEmail?: string | null;
  clientName?: string | null;
  /** Statuses that become 'confirmed' once it's paid (a booking waiting on its deposit). */
  confirmFrom?: string[];
};

export type OnlineDepositResult =
  | { already: true }
  | { already: false; cents: number; balanceCents: number; twice: boolean; released: boolean; status: string; booking: any };

/** Records a deposit paid online, once. null when the booking doesn't exist. */
export async function recordOnlineDeposit(db: any, tenantId: string, d: OnlineDeposit): Promise<OnlineDepositResult | null> {
  const T = `tenants/${tenantId}`;
  const aRef = db.doc(`${T}/appointments/${d.appointmentId}`);
  const cRef = db.doc(`${T}/depositCredits/${onlineDepositCreditId(d.paymentIntentId, d.sessionId)}`);
  const iRef = db.doc(`${T}/transactions/${onlineDepositIncomeId(d.sessionId)}`);
  return db.runTransaction(async (tx: any) => {
    const [as, cs, is] = await Promise.all([tx.get(aRef), tx.get(cRef), tx.get(iRef)]);
    if (!as?.exists) return null;
    if (cs?.exists || is?.exists) return { already: true };
    // The same payment recorded before credits and income were named after it (an income line carries its page).
    const prior = await tx.get(db.collection(`${T}/transactions`).where('checkoutSessionId', '==', String(d.sessionId)).limit(1));
    if (prior && !prior.empty) return { already: true };
    const ap: any = as.data() || {};
    const now = new Date().toISOString();
    const twice = ap.depositStatus === 'paid';
    // Without a client to clear a balance on, all of it is the deposit (kept as credit, never lost from the books).
    const split = twice || !ap.clientId ? { balanceCents: 0, depositCents: c0(d.paidCents) } : splitPaid(ap, c0(d.paidCents));
    const cents = c0(split.depositCents); const balanceCents = c0(split.balanceCents);
    const clientRef = balanceCents > 0 ? db.doc(`${T}/clients/${String(ap.clientId)}`) : null;
    const cl: any = clientRef ? ((await tx.get(clientRef))?.data?.() || {}) : null;
    // Paid after the hold ran out and the time was released: not revived (someone else may have the time), flagged.
    const released = ap.status === 'cancelled' || ap.status === 'canceled';
    const waiting = (d.confirmFrom || ['pending_payment', 'deposit_pending']).includes(String(ap.status || ''));
    const status = released ? String(ap.status) : waiting ? 'confirmed' : String(ap.status || 'confirmed');
    if (twice) {
      tx.set(aRef, { needsAttention: 'deposit_paid_twice', needsAttentionAt: now, depositSecondSessionId: String(d.sessionId) }, { merge: true });
    } else {
      tx.set(aRef, {
        status, depositStatus: 'paid', depositPaidAt: now, depositAmountCents: cents, depositPaidVia: d.via, paymentDueAt: null,
        stripeCheckoutSessionId: String(d.sessionId), stripeChargeId: d.chargeId || null,
        ...(d.paymentIntentId ? { depositStripePaymentIntentId: String(d.paymentIntentId) } : {}),
        ...(released ? { needsAttention: 'deposit_paid_after_hold_released', needsAttentionAt: now } : {}),
        ...(clientRef ? { balanceCollectedAt: now, balanceCollectedCents: balanceCents } : {}),
      }, { merge: true });
      if (ap.checkInToken) tx.set(db.doc(`appointmentCheckIns/${String(ap.checkInToken)}`), { status, depositStatus: 'paid' }, { merge: true });
    }
    const name = d.clientName || ap.clientName || 'Guest';
    if (clientRef) {
      const left = Math.max(0, Math.round((Number(cl.outstandingBalance) || 0) * 100 - balanceCents)) / 100;
      tx.set(clientRef, { outstandingBalance: left, ...(left <= 0 ? { unpaidFees: [] } : {}), balancePaidAt: now, balanceVersion: now }, { merge: true });
      const bRef = db.doc(`${T}/transactions/${onlineBalanceIncomeId(d.sessionId)}`);
      tx.set(bRef, {
        id: bRef.id, tenantId, date: now, description: 'Balance paid with a booking deposit', clientOrVendor: cl.name || name, clientId: ap.clientId,
        type: 'income', context: 'Business', category: 'Fee Recovery', amount: balanceCents / 100, paymentMethod: 'Online Checkout', hasReceipt: false,
        appointmentId: d.appointmentId, checkoutSessionId: String(d.sessionId), stripeChargeId: d.chargeId || null,
      });
    }
    tx.set(iRef, {
      id: iRef.id, tenantId, date: now, description: `Deposit — ${d.serviceName || ap.serviceName || ap.renterServiceName || 'Appointment'}`,
      clientOrVendor: name, clientId: ap.clientId || null, type: 'income', context: 'Business', category: 'Retainers', taxBucket: 'revenue',
      amount: cents / 100, paymentMethod: 'Online Checkout', hasReceipt: false, appointmentId: d.appointmentId, staffId: ap.staffId || null,
      checkoutSessionId: String(d.sessionId), stripeChargeId: d.chargeId || null, ...(twice ? { secondDepositPayment: true } : {}),
    });
    tx.set(cRef, {
      id: cRef.id, tenantId, kind: 'deposit', clientId: ap.clientId || null, clientEmail: String(ap.clientEmail || d.clientEmail || '').toLowerCase().trim(), clientName: name,
      amountCents: cents, status: 'available', sourceAppointmentId: d.appointmentId, serviceName: d.serviceName || ap.serviceName || null, createdAt: now, via: d.via,
      stripePaymentIntentId: d.paymentIntentId ? String(d.paymentIntentId) : null, stripeChargeId: d.chargeId || null, checkoutSessionId: String(d.sessionId),
    });
    return { already: false, cents, balanceCents, twice, released, status, booking: ap };
  });
}
