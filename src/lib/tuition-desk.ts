// src/lib/tuition-desk.ts — TUITION AT THE DESK (server). Through the shared checkout (till, receipt, Today's sales, split,
// void). The Academy's tuition ledger is append-only and audited, so a desk payment ADDS a payment entry (through the
// Academy's own ledger()), and a void ADDS a refund entry with the reason — nothing is ever edited or deleted.
// Only enrolled plans (active / past due) — a down payment also enrols the student and saves their autopay card, so it
// stays on their application link.
import { ledger, planBalance } from '@/lib/academy-admissions';
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const OPEN = ['active', 'past_due'];
const addInterval = (iso: string, interval: string) => { const d = new Date(iso); if (interval === 'biweekly') d.setDate(d.getDate() + 14); else d.setMonth(d.getMonth() + 1); return d.toISOString(); };

export async function tuitionAccount(db: any, tenantId: string, planId: string) {
  const p: any = (await db.doc(`tenants/${tenantId}/tuitionPlans/${planId}`).get()).data(); if (!p) return null;
  const { balanceCents } = await planBalance(tenantId, planId);
  const prog: any = p.programId ? ((await db.doc(`tenants/${tenantId}/programs/${p.programId}`).get()).data() || {}) : {};
  return { plan: { id: planId, ...p }, name: p.name || 'Student', program: prog.name || prog.title || 'Program', balanceCents: Math.max(0, balanceCents), open: OPEN.includes(String(p.status || '')) };
}

/** After the sale is saved: the payment goes on the student's tuition ledger, and the plan moves on like an online payment. */
export async function applyTuitionPayment(db: any, tenantId: string, acct: any, o: { amountCents: number; method: string; receiptId: string; by: string }) {
  const p = acct.plan; const ref = db.doc(`tenants/${tenantId}/tuitionPlans/${p.id}`);
  const isInstalment = num(p.installmentCents) > 0 && o.amountCents >= num(p.installmentCents) && num(p.installmentsPaid) < num(p.installmentsTotal);
  await ledger(tenantId, p.id, p.studentId, 'payment', o.amountCents, isInstalment ? `Instalment ${num(p.installmentsPaid) + 1} of ${num(p.installmentsTotal)} (paid at the front desk — ${o.method.replace(/_/g, ' ')})` : `Paid at the front desk — ${o.method.replace(/_/g, ' ')}`, o.by, o.receiptId);
  const before = { status: p.status || null, installmentsPaid: num(p.installmentsPaid), nextDueAt: p.nextDueAt || null };
  const { balanceCents } = await planBalance(tenantId, p.id);
  if (balanceCents <= 0) await ref.set({ status: 'paid', nextDueAt: null, failures: 0, lastError: null }, { merge: true });
  else if (isInstalment) { const paid = num(p.installmentsPaid) + 1; await ref.set({ installmentsPaid: paid, status: 'active', failures: 0, lastError: null, nextDueAt: paid >= num(p.installmentsTotal) ? null : addInterval(p.nextDueAt || new Date().toISOString(), p.interval || 'month') }, { merge: true }); }
  else await ref.set({ status: p.status === 'past_due' ? 'active' : p.status, failures: 0, lastError: null }, { merge: true });
  return { planId: p.id, studentId: p.studentId, amountCents: o.amountCents, before };
}

/** A void ADDS a refund entry (the ledger is never edited) and puts the plan back where it was. */
export async function reverseTuitionPayment(db: any, tenantId: string, x: any, reason: string, by: string) {
  await ledger(tenantId, x.planId, x.studentId, 'refund', num(x.amountCents), `Front-desk payment voided — ${reason}`, by, null);
  if (x.before) await db.doc(`tenants/${tenantId}/tuitionPlans/${x.planId}`).set({ status: x.before.status, installmentsPaid: x.before.installmentsPaid, nextDueAt: x.before.nextDueAt }, { merge: true });
}
export { OPEN as TUITION_OPEN };
