// src/lib/balance-with-deposit.ts — A BALANCE COLLECTED WITH A BOOKING'S DEPOSIT (server).
// Unpaid-fee rule "Collected with the new booking's deposit": one payment secures the
// booking AND clears what the client owes. The money is split wherever it's paid
// (online checkout, card charged at the desk, paid at the desk):
//   • the BALANCE part clears the debt — a fee payment, never refundable;
//   • only the REST is the deposit — it follows the deposit rules (credit / refund).
// Idempotent: a retried payment notice never clears the balance twice.
import { logAuditAdmin } from '@/lib/audit';

/** How much of this booking's payment is the owed balance (still to be collected). */
export const balanceDueWith = (ap: any) => (ap?.balanceCollectedAt ? 0 : Math.max(0, Math.round(Number(ap?.balanceCollectCents) || 0)));

/** Split a payment for this booking into its balance part and its deposit part. */
export function splitPaid(ap: any, paidCents: number) {
  const balanceCents = Math.min(balanceDueWith(ap), Math.max(0, Math.round(paidCents)));
  return { balanceCents, depositCents: Math.max(0, Math.round(paidCents) - balanceCents) };
}

/** Clear the collected balance: client record, a fee-payment line, the booking, the log. */
export async function settleCollectedBalance(db: any, tenantId: string, appointmentId: string, balanceCents: number,
  meta: { paymentMethod: string; via: string; sessionId?: string | null; chargeId?: string | null; actorName?: string | null }) {
  if (!(balanceCents > 0)) return false;
  const T = `tenants/${tenantId}`;
  const aRef = db.doc(`${T}/appointments/${appointmentId}`);
  const done = await db.runTransaction(async (tx: any) => {
    const ap: any = (await tx.get(aRef)).data() || {};
    if (ap.balanceCollectedAt || !ap.clientId) return null;              // already cleared (retried notice)
    const cRef = db.doc(`${T}/clients/${ap.clientId}`);
    const c: any = (await tx.get(cRef)).data() || {};
    const left = Math.max(0, Math.round(((Number(c.outstandingBalance) || 0) * 100) - balanceCents)) / 100;
    const nowIso = new Date().toISOString();
    tx.set(cRef, { outstandingBalance: left, ...(left <= 0 ? { unpaidFees: [] } : {}), balancePaidAt: nowIso, balanceVersion: nowIso }, { merge: true });
    const txRef = db.collection(`${T}/transactions`).doc();
    tx.set(txRef, { id: txRef.id, tenantId, date: nowIso, description: 'Balance paid with a booking deposit', clientOrVendor: c.name || ap.clientName || null, clientId: ap.clientId,
      type: 'income', context: 'Business', category: 'Fee Recovery', amount: balanceCents / 100, paymentMethod: meta.paymentMethod, hasReceipt: false, appointmentId,
      ...(meta.sessionId ? { checkoutSessionId: meta.sessionId } : {}), ...(meta.chargeId ? { stripeChargeId: meta.chargeId } : {}) });
    tx.set(aRef, { balanceCollectedAt: nowIso, balanceCollectedCents: balanceCents }, { merge: true });
    return { name: c.name || ap.clientName || 'Client', clientId: ap.clientId };
  });
  if (done) await logAuditAdmin(db, tenantId, { action: 'balance.paid', targetType: 'client', targetId: done.clientId, amount: balanceCents / 100,
    summary: `${done.name} paid a $${(balanceCents / 100).toFixed(2)} balance with a booking deposit (${meta.via})`,
    actor: meta.actorName ? { type: 'user', name: meta.actorName } : { type: 'system', name: 'Payments' } } as any).catch(() => {});
  return !!done;
}
