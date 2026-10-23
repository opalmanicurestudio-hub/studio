// src/lib/deposit-record.ts — A DEPOSIT CHARGED TO A SAVED CARD IS RECORDED BY THE SERVER, ONCE. It marks the visit paid
// (confirming a booking that was waiting on it) and adds the deposit's credit, the amount that comes off the bill at
// checkout, in one step. The credit is named after the card payment, so a retry, a second tap or a second device can
// never add it twice, and it carries the payment so the deposit can be refunded to the card. Every route that charges a
// deposit to a saved card records it this way: the desk (api/appointments/desk-deposit), approvals and group bookings
// (api/appointments/decide, party), instant and phone bookings (lib/booking/create-booking, api/voice/create-booking)
// and the nightly retry (lib/retail-sweeps). Nothing in a browser writes deposit credit. Server only.

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));
const lower = (v: any) => String(v || '').toLowerCase().trim();

/** The credit for a deposit paid by card: one per card payment. */
export const depositCreditId = (paymentIntentId: string) => `deposit_${String(paymentIntentId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)}`;

export type CardDeposit = {
  /** The deposit itself (not a balance taken in the same charge). */
  cents: number;
  paymentIntentId: string;
  chargeId?: string | null;
  /** How it was taken: 'card_on_file', 'approval', 'instant_booking', … */
  via: string;
  /** What the booking becomes; by default it's confirmed when it was waiting on the deposit. */
  status?: string;
  /** For a booking whose record has no email: the client's, so the credit can be found by email too. */
  clientEmail?: string | null;
  /** More fields for the booking. */
  extra?: Record<string, any>;
  /** The money coming in, for a payment nothing else records (a deposit taken on the shop's card reader): written with
   *  the credit, once, under its own name. */
  income?: { id: string; data: Record<string, any> } | null;
  /** A second payment for a deposit already paid another way (decided here, with the booking as it is now): its credit
   *  and income are kept, since the money came in, the booking keeps its record of the first payment, and it's flagged. */
  keepFirst?: boolean;
  /** The whole payment, when it may also carry a balance collected with the deposit (lib/balance-with-deposit). The split
   *  is decided here, in the same step, from the booking as it is now, so two recorders can't count the balance twice:
   *  the balance part clears what the client owes and is booked as a fee payment (under `balance.id`), and everything
   *  else is the deposit's credit. */
  received?: number;
  balance?: { id: string; method: string };
};

/** The credit document for a deposit paid by card (for a route that writes the booking in the same step). */
export function cardDepositCredit(tenantId: string, appointmentId: string, ap: any, d: CardDeposit, now = new Date().toISOString()) {
  const id = depositCreditId(d.paymentIntentId);
  return { id, data: {
    id, tenantId, kind: 'deposit', clientId: ap?.clientId || null, clientEmail: lower(ap?.clientEmail || d.clientEmail), clientName: ap?.clientName || 'Guest',
    amountCents: c0(d.cents), status: 'available', sourceAppointmentId: appointmentId, serviceName: ap?.serviceName || null,
    createdAt: now, via: d.via, stripePaymentIntentId: String(d.paymentIntentId), stripeChargeId: d.chargeId || null,
  } };
}

export type DepositRecorded =
  | { ok: true; already: boolean; status: string; released: boolean; creditId: string; twice?: boolean; cents?: number; balanceCents?: number }
  | { ok: false; error: string };

/** Records a deposit charged to a saved card: the visit is marked paid and the credit added, once. A booking released
 *  before the payment went through stays released and is flagged, since its time may be taken. */
export async function recordCardDeposit(db: any, tenantId: string, appointmentId: string, d: CardDeposit): Promise<DepositRecorded> {
  const split = d.received !== undefined && d.received !== null;
  const fixed = c0(d.cents);
  const pi = String(d.paymentIntentId || '').trim();
  if (!pi || (split ? c0(d.received) : fixed) <= 0) return { ok: false, error: 'There’s no card payment to record.' };
  const T = `tenants/${tenantId}`;
  const aRef = db.doc(`${T}/appointments/${appointmentId}`);
  const cRef = db.doc(`${T}/depositCredits/${depositCreditId(pi)}`);
  const iRef = d.income?.id ? db.doc(`${T}/transactions/${d.income.id}`) : null;
  return db.runTransaction(async (tx: any): Promise<DepositRecorded> => {
    const as = await tx.get(aRef);
    if (!as?.exists) return { ok: false, error: 'That booking wasn’t found.' };
    const ap: any = as.data() || {};
    // The split of a payment that may carry a balance, from the booking as it is now.
    const received = split ? c0(d.received) : 0;
    const owed = c0(ap.depositAmountCents);
    const balDue = split && d.balance && ap.clientId && !ap.balanceCollectedAt ? c0(ap.balanceCollectCents) : 0;
    const depPart = split ? (owed > 0 ? Math.min(owed, received) : received) : fixed;
    const balCents = balDue > 0 && received - depPart >= balDue ? balDue : 0;
    const cents = split ? received - balCents : fixed;
    const clRef = balCents > 0 ? db.doc(`${T}/clients/${ap.clientId}`) : null;
    const bRef = balCents > 0 && d.balance?.id ? db.doc(`${T}/transactions/${d.balance.id}`) : null;
    const cl = clRef ? await tx.get(clRef) : null;
    const bs = bRef ? await tx.get(bRef) : null;
    const cs = await tx.get(cRef);
    const is = iRef ? await tx.get(iRef) : null;
    // A card payment recorded for another booking is never moved onto this one.
    if (cs?.exists && String((cs.data() || {}).sourceAppointmentId || '') !== appointmentId) return { ok: false, error: 'That card payment is already recorded for another booking.' };
    const released = ap.status === 'cancelled';
    const waiting = ap.status === 'pending_payment' || ap.status === 'deposit_pending';
    const next = released ? 'cancelled' : d.status || (waiting ? 'confirmed' : String(ap.status || 'confirmed'));
    // Recorded already (a retry, a second tap): nothing more is added.
    if (cs?.exists) return { ok: true, already: true, status: String(ap.status || next), released, creditId: cRef.id, twice: String(ap.depositSecondPaymentIntentId || '') === pi, cents: c0((cs.data() || {}).amountCents) };
    const now = new Date().toISOString();
    // The balance part: what the client owes comes down, and it's in the books as the fee payment it is, once.
    const balanceWrites = () => {
      if (!(balCents > 0) || !clRef || !bRef || bs?.exists) return {};
      const c: any = cl?.data?.() || {};
      const left = Math.max(0, Math.round(((Number(c.outstandingBalance) || 0) * 100) - balCents)) / 100;
      tx.set(clRef, { outstandingBalance: left, ...(left <= 0 ? { unpaidFees: [] } : {}), balancePaidAt: now, balanceVersion: now }, { merge: true });
      tx.set(bRef, { id: bRef.id, tenantId, date: now, description: 'Balance paid with a booking deposit', clientOrVendor: c.name || ap.clientName || null, clientId: ap.clientId,
        type: 'income', context: 'Business', category: 'Fee Recovery', amount: balCents / 100, paymentMethod: d.balance?.method || 'Card', hasReceipt: false, appointmentId,
        ...(d.chargeId ? { stripeChargeId: d.chargeId } : {}) });
      return { balanceCollectedAt: now, balanceCollectedCents: balCents };
    };
    const income = () => { if (iRef && !is?.exists) tx.set(iRef, { ...(d.income?.data || {}), amount: cents / 100, id: iRef.id, tenantId, date: now }); };
    if (d.keepFirst && ap.depositStatus === 'paid' && String(ap.depositStripePaymentIntentId || '') !== pi) {
      const bal = balanceWrites();
      tx.set(aRef, { needsAttention: 'deposit_paid_twice', needsAttentionAt: now, depositSecondPaymentIntentId: pi, ...bal }, { merge: true });
      tx.set(cRef, cardDepositCredit(tenantId, appointmentId, ap, { ...d, cents, paymentIntentId: pi }, now).data);
      income();
      return { ok: true, already: false, status: String(ap.status || next), released, creditId: cRef.id, twice: true, cents, balanceCents: balCents };
    }
    const bal = balanceWrites();
    tx.set(aRef, { ...bal,
      status: next, depositStatus: 'paid', depositPaidAt: now, depositAmountCents: cents, depositPaidVia: d.via,
      depositStripePaymentIntentId: pi, paymentDueAt: null, depositDeskHold: null, depositChargeLock: null,
      ...(ap.needsAttention === 'deposit_unpaid' && !released ? { needsAttention: null } : {}),
      ...(released ? { needsAttention: 'deposit_paid_after_hold_released', needsAttentionAt: now } : {}),
      ...(d.extra || {}),
    }, { merge: true });
    if (ap.checkInToken) tx.set(db.doc(`appointmentCheckIns/${ap.checkInToken}`), { status: next, depositStatus: 'paid' }, { merge: true });
    tx.set(cRef, cardDepositCredit(tenantId, appointmentId, ap, { ...d, cents, paymentIntentId: pi }, now).data);
    income();
    return { ok: true, already: false, status: next, released, creditId: cRef.id, cents, balanceCents: balCents };
  });
}

/** As recordCardDeposit, tried twice; if the record still can't be saved, the visit is at least marked paid (as before
 *  this was kept) and the miss is logged, so the money is never left looking unpaid. */
export async function recordCardDepositSafely(db: any, tenantId: string, appointmentId: string, d: CardDeposit, fallback: Record<string, any>): Promise<DepositRecorded> {
  for (let i = 0; i < 2; i++) {
    try { const r = await recordCardDeposit(db, tenantId, appointmentId, d); if (r.ok) return r; if (i === 1) return r; }
    catch (e) { if (i === 1) console.error('[deposit-record] the deposit was charged but its credit wasn’t saved', { tenantId, appointmentId, paymentIntentId: d.paymentIntentId }, e); }
  }
  try { await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).set({ ...fallback, depositStripePaymentIntentId: d.paymentIntentId }, { merge: true }); } catch { /* logged above */ }
  return { ok: false, error: 'The card was charged, but the booking couldn’t be updated. Open it again: it won’t be charged twice.' };
}
