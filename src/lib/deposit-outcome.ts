// src/lib/deposit-outcome.ts — WHAT HAPPENS TO A BOOKING'S DEPOSIT WHEN IT'S CANCELLED OR MISSED (server).
// One place for every cancellation path (the client's own link, the front desk, a confirmed no-show): the booking's
// deposit (lib/credit-pools: never store credit) is
//   kept      — the shop keeps it. It was counted as a sale when it was paid, so the line written here names it (for
//               the team's no-show share, lib/commission) without counting it again (alreadyCounted, lib/books-summary);
//   rolled    — it stays as credit for their next visit, until the policy's expiry;
//   to refund — waiting for someone allowed to send refunds (never sent automatically from here).
// In one step, once: the deposit must still be there to use, the booking is marked settled in the same step, and every
// record is named after the booking, so a retry, a second tap or the five-minute job does nothing more.
import { creditLeftCents, isDepositCredit, pickDeposit } from '@/lib/credit-pools';
import { resolveDepositPolicy, rolloverExpiryISO } from '@/lib/deposit-policy';

export type DepositOutcome = 'forfeit' | 'rollover' | 'refund_pending';
export type Settled = { outcome: DepositOutcome; amount: number; creditId: string } | { none: true } | { already: true };

const safe = (s: any) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const expired = (c: any) => !!c?.expiresAt && Date.parse(String(c.expiresAt)) <= Date.now();

/** The deposit a cancelled booking holds (or one carried over to it), from what's available for the client. */
async function findDeposit(db: any, tenantId: string, appointmentId: string, ap: any, opts: { creditId?: string | null; clientEmail?: string | null }) {
  const col = db.collection(`tenants/${tenantId}/depositCredits`);
  let docs: any[] = [];
  if (ap?.clientId) docs = (await col.where('status', '==', 'available').where('clientId', '==', String(ap.clientId)).get()).docs;
  const email = String(opts.clientEmail || ap?.clientEmail || '').toLowerCase().trim();
  if (!docs.length && email) docs = (await col.where('status', '==', 'available').where('clientEmail', '==', email).get()).docs;
  const candidates = docs.map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() || {}) })).filter((c: any) => !expired(c) && isDepositCredit(c));
  return (opts.creditId && candidates.find((c: any) => c.id === opts.creditId))
    || pickDeposit(candidates, [appointmentId], () => true)
    || pickDeposit(candidates.filter((c: any) => c.rolledOver === true), [], () => false)
    || null;
}

export async function settleCancelledDeposit(db: any, tenantId: string, o: {
  appointmentId: string; outcome: DepositOutcome; reason: string; trigger: 'client_cancel' | 'no_show' | 'front_desk';
  by: string; creditId?: string | null; clientEmail?: string | null; policy?: any;
}): Promise<Settled> {
  const T = `tenants/${tenantId}`;
  const aRef = db.doc(`${T}/appointments/${o.appointmentId}`);
  const a0 = await aRef.get();
  const ap: any = a0.exists ? a0.data() || {} : null;
  if (!ap) return { none: true };
  if (ap.depositSettledAt) return { already: true };
  const found: any = await findDeposit(db, tenantId, o.appointmentId, ap, { creditId: o.creditId, clientEmail: o.clientEmail });
  const tenant: any = o.outcome === 'rollover' && !o.policy ? ((await db.doc(T).get()).data() || {}) : null;
  const policy = o.policy || (tenant ? resolveDepositPolicy(tenant) : null);
  const now = new Date().toISOString();

  const res: Settled = await db.runTransaction(async (tx: any) => {
    const as = await tx.get(aRef); const a: any = as.data() || {};
    if (a.depositSettledAt) return { already: true } as Settled;
    const cs = found ? await tx.get(found.ref) : null; const c: any = cs?.exists ? { ...(cs.data() || {}), id: found.id } : null;
    // Nothing to settle (no deposit, or it was used or refunded meanwhile): the booking is marked, so it isn't looked at again.
    if (!c || c.status !== 'available' || !isDepositCredit(c) || creditLeftCents(c) <= 0) {
      tx.set(aRef, { depositSettledAt: now, depositDisposition: a.depositDisposition || 'none' }, { merge: true });
      return { none: true } as Settled;
    }
    const cents = creditLeftCents(c); const amount = cents / 100;
    const decisionRef = db.doc(`${T}/depositDecisions/${safe(c.id)}_${safe(o.appointmentId)}`);
    const decision = { id: decisionRef.id, tenantId, creditId: c.id, appointmentId: o.appointmentId, clientId: a.clientId || null,
      clientName: a.clientName || c.clientName || 'Client', trigger: o.trigger, reason: o.reason, amountDollars: amount, decidedAt: now, decidedBy: o.by };
    if (o.outcome === 'forfeit') {
      tx.set(found.ref, { status: 'forfeited', forfeitedAt: now, forfeitedFromAppointmentId: o.appointmentId, lastDecisionReason: o.reason }, { merge: true });
      const lineRef = db.doc(`${T}/transactions/depositkept_${safe(c.id)}`);
      tx.set(lineRef, {
        id: lineRef.id, tenantId, appointmentId: o.appointmentId, clientId: a.clientId || null, clientName: a.clientName || c.clientName || 'Client',
        clientOrVendor: a.clientName || c.clientName || 'Client', staffId: a.staffId || null,
        date: now, type: 'income', context: 'Business', category: o.trigger === 'no_show' ? 'No-Show Revenue' : 'Cancellation Revenue',
        amount, amountCents: cents, paymentMethod: 'Deposit', hasReceipt: false, alreadyCounted: true, depositCreditId: c.id,
        description: o.trigger === 'no_show' ? 'Deposit kept — no-show' : 'Deposit kept — late cancellation',
        notes: 'Counted as a sale when the deposit was paid; this line names it, without counting it again.',
      });
      tx.set(decisionRef, { ...decision, outcome: 'forfeit' });
      tx.set(aRef, { depositSettledAt: now, depositForfeited: true, depositForfeitedAt: now, depositForfeitedReason: o.reason, depositDisposition: 'forfeited' }, { merge: true });
      return { outcome: 'forfeit', amount, creditId: c.id } as Settled;
    }
    if (o.outcome === 'rollover') {
      tx.set(found.ref, { status: 'available', rolledOver: true, rolledOverAt: now, rolledOverFromAppointmentId: o.appointmentId,
        expiresAt: policy ? rolloverExpiryISO(policy) : null, lastDecisionReason: o.reason }, { merge: true });
      tx.set(decisionRef, { ...decision, outcome: 'rollover' });
      tx.set(aRef, { depositSettledAt: now, depositDisposition: 'rolled_over', depositDispositionAt: now }, { merge: true });
      return { outcome: 'rollover', amount, creditId: c.id } as Settled;
    }
    tx.set(decisionRef, { ...decision, outcome: 'refund_pending' });
    tx.set(aRef, { depositSettledAt: now, depositDisposition: 'refund_pending', depositDispositionAt: now }, { merge: true });
    return { outcome: 'refund_pending', amount, creditId: c.id } as Settled;
  });

  // A refund waiting: the owners hear about it (once: each note is named after the decision).
  if ('outcome' in res && res.outcome === 'refund_pending') {
    try {
      const admins = await db.collection(`${T}/staff`).where('role', 'in', ['admin', 'owner']).get();
      for (const d of admins.docs) {
        const n = db.doc(`${T}/notifications/depositrefund_${safe(res.creditId)}_${safe(o.appointmentId)}_${safe(d.id)}`);
        await n.set({ id: n.id, userId: d.id, type: 'deposit_refund_pending', appointmentId: o.appointmentId, resolved: false, read: false, createdAt: now, link: `/clients/${ap.clientId || ''}`,
          message: `Action needed: ${ap.clientName || 'A client'} cancelled with advance notice. Their $${res.amount.toFixed(2)} deposit is ready to be refunded.` });
      }
    } catch { /* the decision is recorded; the deposit list shows it */ }
  }
  return res;
}

/** The outcome a cancellation's plan names, in this module's words. */
export function outcomeOf(plan: string | null | undefined, late: boolean): DepositOutcome {
  if (plan === 'rollover' || plan === 'store_credit') return 'rollover';
  if (plan === 'forfeit' || plan === 'applied') return 'forfeit';
  if (plan === 'refund') return 'refund_pending';
  return late ? 'forfeit' : 'refund_pending';
}
