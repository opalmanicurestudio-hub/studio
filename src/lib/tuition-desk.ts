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

/** After the sale is saved: the payment goes on the student's tuition ledger, and the plan moves on like an online payment.
 *  Paying MORE than one instalment works like rent: by default the extra covers the NEXT instalments (the schedule moves
 *  forward; a part-instalment carries over as `prepaidCents`, which autopay takes off its next charge). Or, if the
 *  student prefers, it pays the balance down and the plan simply finishes sooner (`apply: 'paydown'`). */
export async function applyTuitionPayment(db: any, tenantId: string, acct: any, o: { amountCents: number; method: string; receiptId: string; by: string; apply?: 'ahead' | 'paydown' }) {
  const p = acct.plan; const ref = db.doc(`tenants/${tenantId}/tuitionPlans/${p.id}`);
  const inst = num(p.installmentCents); const remainingInst = Math.max(0, num(p.installmentsTotal) - num(p.installmentsPaid)); const prepaidBefore = num(p.prepaidCents);
  const ahead = o.apply !== 'paydown' && inst > 0 && remainingInst > 0;
  const covered = ahead ? Math.min(remainingInst, Math.floor((o.amountCents + prepaidBefore) / inst)) : 0;
  const carry = ahead && covered < remainingInst ? (o.amountCents + prepaidBefore) - covered * inst : 0;
  const how = ahead ? (covered > 1 ? `covers instalments ${num(p.installmentsPaid) + 1}–${num(p.installmentsPaid) + covered} of ${num(p.installmentsTotal)}` : covered === 1 ? `instalment ${num(p.installmentsPaid) + 1} of ${num(p.installmentsTotal)}` : 'toward the next instalment')
    : 'paying down the balance';
  await ledger(tenantId, p.id, p.studentId, 'payment', o.amountCents, `Paid at the front desk — ${how} (${o.method.replace(/_/g, ' ')})`, o.by, o.receiptId, { inBooks: true });
  const before = { status: p.status || null, installmentsPaid: num(p.installmentsPaid), nextDueAt: p.nextDueAt || null, prepaidCents: prepaidBefore };
  const { balanceCents } = await planBalance(tenantId, p.id);
  if (balanceCents <= 0) await ref.set({ status: 'paid', nextDueAt: null, prepaidCents: 0, failures: 0, lastError: null }, { merge: true });
  else if (ahead) {
    let next = p.nextDueAt || new Date().toISOString(); for (let k = 0; k < covered; k++) next = addInterval(next, p.interval);
    const paid = num(p.installmentsPaid) + covered;
    await ref.set({ installmentsPaid: paid, prepaidCents: carry, status: 'active', failures: 0, lastError: null, nextDueAt: paid >= num(p.installmentsTotal) ? null : next }, { merge: true });
  } else await ref.set({ status: p.status === 'past_due' ? 'active' : p.status, failures: 0, lastError: null }, { merge: true });
  return { planId: p.id, studentId: p.studentId, amountCents: o.amountCents, before, covered, carryCents: carry, apply: ahead ? 'ahead' : 'paydown' };
}

/** A void ADDS a refund entry (the ledger is never edited) and puts the plan back where it was. */
export async function reverseTuitionPayment(db: any, tenantId: string, x: any, reason: string, by: string) {
  await ledger(tenantId, x.planId, x.studentId, 'refund', num(x.amountCents), `Front-desk payment voided — ${reason}`, by, null, { inBooks: true });   // the void already reversed it in the books
  if (x.before) await db.doc(`tenants/${tenantId}/tuitionPlans/${x.planId}`).set({ status: x.before.status, installmentsPaid: x.before.installmentsPaid, nextDueAt: x.before.nextDueAt, prepaidCents: num(x.before.prepaidCents) }, { merge: true });
}
export { OPEN as TUITION_OPEN };
