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
};

/** The credit document for a deposit paid by card (for a route that writes the booking in the same step). */
export function cardDepositCredit(tenantId: string, appointmentId: string, ap: any, d: CardDeposit, now = new Date().toISOString()) {
  const id = depositCreditId(d.paymentIntentId);
  return { id, data: {
    id, tenantId, clientId: ap?.clientId || null, clientEmail: lower(ap?.clientEmail || d.clientEmail), clientName: ap?.clientName || 'Guest',
    amountCents: c0(d.cents), status: 'available', sourceAppointmentId: appointmentId, serviceName: ap?.serviceName || null,
    createdAt: now, via: d.via, stripePaymentIntentId: String(d.paymentIntentId), stripeChargeId: d.chargeId || null,
  } };
}

export type DepositRecorded =
  | { ok: true; already: boolean; status: string; released: boolean; creditId: string }
  | { ok: false; error: string };

/** Records a deposit charged to a saved card: the visit is marked paid and the credit added, once. A booking released
 *  before the payment went through stays released and is flagged, since its time may be taken. */
export async function recordCardDeposit(db: any, tenantId: string, appointmentId: string, d: CardDeposit): Promise<DepositRecorded> {
  const cents = c0(d.cents);
  const pi = String(d.paymentIntentId || '').trim();
  if (!pi || cents <= 0) return { ok: false, error: 'There’s no card payment to record.' };
  const T = `tenants/${tenantId}`;
  const aRef = db.doc(`${T}/appointments/${appointmentId}`);
  const cRef = db.doc(`${T}/depositCredits/${depositCreditId(pi)}`);
  return db.runTransaction(async (tx: any): Promise<DepositRecorded> => {
    const as = await tx.get(aRef);
    const cs = await tx.get(cRef);
    if (!as?.exists) return { ok: false, error: 'That booking wasn’t found.' };
    const ap: any = as.data() || {};
    const released = ap.status === 'cancelled';
    const waiting = ap.status === 'pending_payment' || ap.status === 'deposit_pending';
    const next = released ? 'cancelled' : d.status || (waiting ? 'confirmed' : String(ap.status || 'confirmed'));
    // Recorded already (a retry, a second tap): nothing more is added.
    if (cs?.exists) return { ok: true, already: true, status: String(ap.status || next), released, creditId: cRef.id };
    const now = new Date().toISOString();
    tx.set(aRef, {
      status: next, depositStatus: 'paid', depositPaidAt: now, depositAmountCents: cents, depositPaidVia: d.via,
      depositStripePaymentIntentId: pi, paymentDueAt: null, depositDeskHold: null, depositChargeLock: null,
      ...(ap.needsAttention === 'deposit_unpaid' && !released ? { needsAttention: null } : {}),
      ...(released ? { needsAttention: 'deposit_paid_after_hold_released', needsAttentionAt: now } : {}),
      ...(d.extra || {}),
    }, { merge: true });
    if (ap.checkInToken) tx.set(db.doc(`appointmentCheckIns/${ap.checkInToken}`), { status: next, depositStatus: 'paid' }, { merge: true });
    tx.set(cRef, cardDepositCredit(tenantId, appointmentId, ap, { ...d, cents, paymentIntentId: pi }, now).data);
    return { ok: true, already: false, status: next, released, creditId: cRef.id };
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
