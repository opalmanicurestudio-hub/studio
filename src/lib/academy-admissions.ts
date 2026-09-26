// src/lib/academy-admissions.ts
//
// ADMISSIONS, ENROLMENT AND TUITION — the business side of a licensed school.
//
//   admissions/{id}        one applicant: stage, program, cohort, documents,
//                          agreement, tuition, notes, full history
//                          stages: inquiry → tour → applied → documents →
//                                  agreement → enrolled   (or declined / withdrawn)
//   cohorts/{id}           a program's start: date, capacity, waitlist
//   tuitionPlans/{pid_sid} the student's plan: totals, down payment,
//                          instalments, autopay card, next due, status
//   tuitionEntries/{id}    the ledger — charges, payments, refunds,
//                          adjustments — never edited, only added to
//
// The applicant gets a private link (their "application"): upload documents,
// e-sign the enrolment agreement (the exact text they signed is kept with a
// fingerprint, time, IP and device), and pay the down payment — which saves
// their card for autopay instalments on the school's own Stripe account.
// Every step is written to the academy audit log.
//
// Refunds on withdrawal follow the school's own policy (set per program to
// match its state's refund rules); the calculation shows every step.

import { createHash, randomBytes } from 'crypto';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { appendAudit } from '@/lib/academy-compliance';
import { enrollInProgram } from '@/lib/academy-school';

export const STAGES = ['inquiry', 'tour', 'applied', 'documents', 'agreement', 'enrolled', 'declined', 'withdrawn'] as const;
export type Stage = typeof STAGES[number];
export const DEFAULT_DOCS = ['Photo ID', 'High school diploma or GED', 'Proof of age'];
export const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
export const money = (c: number) => `$${(Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface Tuition { tuitionCents: number; registrationFeeCents: number; kitCents: number; downPaymentCents: number; installments: number; interval: 'month' | 'biweekly' }
export interface RefundPolicy { cancelDays: number; registrationNonRefundable: boolean; kitNonRefundable: boolean; tiers: { upToPct: number; keepPct: number }[] }
export const DEFAULT_REFUND: RefundPolicy = { cancelDays: 3, registrationNonRefundable: true, kitNonRefundable: true,
  tiers: [{ upToPct: 10, keepPct: 10 }, { upToPct: 25, keepPct: 25 }, { upToPct: 50, keepPct: 50 }, { upToPct: 100, keepPct: 100 }] };

/** A new private application link for an applicant. */
export async function issueApplicationLink(tenantId: string, admissionId: string) {
  const token = randomBytes(24).toString('base64url');
  await getAdminDb().doc(`tenants/${tenantId}/admissions/${admissionId}`).set({ appTokenHash: sha(token), appTokenAt: new Date().toISOString() }, { merge: true });
  return token;
}
export async function admissionByToken(tenantId: string, token: string) {
  if (!token) return null;
  const s = await getAdminDb().collection(`tenants/${tenantId}/admissions`).where('appTokenHash', '==', sha(token)).limit(1).get();
  return s.empty ? null : { id: s.docs[0].id, ref: s.docs[0].ref, ...(s.docs[0].data() as any) };
}

export async function setStage(tenantId: string, admissionId: string, stage: Stage, by: string, note?: string) {
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/admissions/${admissionId}`);
  const a = ((await ref.get()).data() as any) || null;
  if (!a) throw new Error('Applicant not found.');
  if (a.stage === stage) return;
  await ref.set({ stage, updatedAt: new Date().toISOString(), history: [...(a.history || []), { stage, at: new Date().toISOString(), by, note: note || null }] }, { merge: true });
  await appendAudit(tenantId, { type: 'admissions.stage', by, summary: `${a.name}: ${a.stage} → ${stage}${note ? ` (${note})` : ''}`, data: { admissionId } });
}

/** The agreement text for one applicant — placeholders filled from their plan. */
export function renderAgreement(template: string, v: { student: string; program: string; school: string; start: string; tuition: Tuition; refund: RefundPolicy; totalHours?: number | null }) {
  const t = v.tuition; const total = t.tuitionCents + t.registrationFeeCents + t.kitCents;
  const inst = t.installments > 0 ? Math.round((total - t.downPaymentCents) / t.installments) : 0;
  const plan = t.installments > 0 ? `${money(t.downPaymentCents)} down, then ${t.installments} ${t.interval === 'biweekly' ? 'bi-weekly' : 'monthly'} payments of about ${money(inst)}` : `${money(total)} in full`;
  const refund = `Cancel within ${v.refund.cancelDays} days of signing for a full refund${v.refund.registrationNonRefundable ? ' (except the registration fee)' : ''}. After starting, the school keeps: ${v.refund.tiers.map((x) => `${x.keepPct}% of tuition if withdrawing by ${x.upToPct}% of the program`).join('; ')}.${v.refund.kitNonRefundable ? ' Kits issued are not refundable.' : ''}`;
  const fill: Record<string, string> = { student: v.student, program: v.program, school: v.school, start: v.start, hours: v.totalHours ? String(v.totalHours) : '—',
    tuition: money(t.tuitionCents), registration: money(t.registrationFeeCents), kit: money(t.kitCents), total: money(total), plan, refundPolicy: refund };
  return String(template || DEFAULT_AGREEMENT).replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k] ?? `{{${k}}}`);
}
export const DEFAULT_AGREEMENT = `ENROLMENT AGREEMENT

Student: {{student}}
School: {{school}}
Program: {{program}} ({{hours}} hours)
Start date: {{start}}

Tuition: {{tuition}}
Registration fee: {{registration}}
Kit: {{kit}}
Total: {{total}}
Payment plan: {{plan}}

Refund policy: {{refundPolicy}}

The student agrees to follow the school's attendance, conduct and safety policies, and understands that hours and services are recorded electronically and may be reported to the state licensing board.

By signing, the student confirms they have read and understood this agreement.`;

/** Build the plan and its ledger charges when the agreement is signed. */
export async function createTuitionPlan(opts: { tenantId: string; programId: string; studentId: string; email: string; name: string; admissionId: string; tuition: Tuition; by: string }) {
  const db = getAdminDb();
  const t = opts.tuition;
  const id = `${opts.programId}_${opts.studentId}`;
  const ref = db.doc(`tenants/${opts.tenantId}/tuitionPlans/${id}`);
  if ((await ref.get()).exists) return id;
  const total = t.tuitionCents + t.registrationFeeCents + t.kitCents;
  const installmentCents = t.installments > 0 ? Math.round((total - t.downPaymentCents) / t.installments) : 0;
  await ref.set({ id, programId: opts.programId, studentId: opts.studentId, email: opts.email, name: opts.name, admissionId: opts.admissionId, totalCents: total, downPaymentCents: Math.min(total, t.downPaymentCents || total),
    installmentCents, installmentsTotal: t.installments, installmentsPaid: 0, interval: t.interval, nextDueAt: null, status: 'awaiting_down_payment', autopay: false, failures: 0, createdAt: new Date().toISOString() });
  for (const [desc, amt] of [['Tuition', t.tuitionCents], ['Registration fee', t.registrationFeeCents], ['Kit', t.kitCents]] as [string, number][]) if (amt > 0) await ledger(opts.tenantId, id, opts.studentId, 'charge', amt, desc, opts.by);
  return id;
}

export async function ledger(tenantId: string, planId: string, studentId: string, type: 'charge' | 'payment' | 'refund' | 'adjustment', amountCents: number, desc: string, by: string, ref?: string | null) {
  const db = getAdminDb();
  const r = db.collection(`tenants/${tenantId}/tuitionEntries`).doc();
  await r.set({ id: r.id, planId, studentId, type, amountCents: Math.round(amountCents), desc, by, ref: ref || null, at: new Date().toISOString() });
  await appendAudit(tenantId, { type: `tuition.${type}`, studentId, by, summary: `${type[0].toUpperCase()}${type.slice(1)} ${money(amountCents)} — ${desc}`, data: { planId, entryId: r.id, ref: ref || null } });
}
export async function planBalance(tenantId: string, planId: string) {
  const s = await getAdminDb().collection(`tenants/${tenantId}/tuitionEntries`).where('planId', '==', planId).limit(2000).get();
  const entries = s.docs.map((d: any) => d.data() as any).sort((a: any, b: any) => String(a.at).localeCompare(String(b.at)));
  const charged = entries.filter((e: any) => e.type === 'charge').reduce((n: number, e: any) => n + e.amountCents, 0) + entries.filter((e: any) => e.type === 'adjustment').reduce((n: number, e: any) => n + e.amountCents, 0);
  const paid = entries.filter((e: any) => e.type === 'payment').reduce((n: number, e: any) => n + e.amountCents, 0) - entries.filter((e: any) => e.type === 'refund').reduce((n: number, e: any) => n + e.amountCents, 0);
  return { entries, chargedCents: charged, paidCents: paid, balanceCents: charged - paid };
}

const addInterval = (iso: string, interval: 'month' | 'biweekly') => { const d = new Date(iso); if (interval === 'biweekly') d.setDate(d.getDate() + 14); else d.setMonth(d.getMonth() + 1); return d.toISOString(); };

/** After the down payment clears: record it, save the card, schedule instalments, enrol. */
export async function completeDownPayment(tenantId: string, session: any) {
  if (session?.metadata?.type !== 'academy_tuition' || session.payment_status !== 'paid') return null;
  const db = getAdminDb();
  const planId = String(session.metadata.planId);
  const ref = db.doc(`tenants/${tenantId}/tuitionPlans/${planId}`);
  const p = ((await ref.get()).data() as any) || null;
  if (!p) return null;
  if (p.downPaidAt) return { planId, already: true };
  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  let paymentMethodId: string | null = null;
  try { if (session.payment_intent) { const pi = await stripe().paymentIntents.retrieve(String(session.payment_intent), {}, { stripeAccount: t.stripeAccountId }); paymentMethodId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id || null; } } catch { /* keep going */ }
  const now = new Date().toISOString();
  await ledger(tenantId, planId, p.studentId, 'payment', Number(session.amount_total) || p.downPaymentCents, 'Down payment', 'student', session.payment_intent || session.id);
  const more = p.installmentsTotal > 0;
  await ref.set({ downPaidAt: now, customerId: session.customer || null, paymentMethodId, autopay: more && !!paymentMethodId, status: more ? 'active' : 'paid', nextDueAt: more ? addInterval(now, p.interval) : null }, { merge: true });
  // Paying the down payment completes admission → enrolled in the program.
  const a = ((await db.doc(`tenants/${tenantId}/admissions/${p.admissionId}`).get()).data() as any) || {};
  await enrollInProgram({ tenantId, programId: p.programId, email: p.email, name: p.name, startDate: a.startDate || null, by: 'admissions' });
  await setStage(tenantId, p.admissionId, 'enrolled', 'system', 'Down payment received');
  return { planId, already: false };
}

/** Charge one plan's next instalment now (autopay, or right after a card update). */
export async function chargePlan(tenantId: string, stripeAccountId: string, ref: any, p: any) {
  const { balanceCents } = await planBalance(tenantId, ref.id);
  const amount = Math.min(balanceCents, p.installmentsPaid + 1 >= p.installmentsTotal ? balanceCents : p.installmentCents);
  if (amount <= 0) { await ref.set({ status: 'paid', nextDueAt: null }, { merge: true }); return { ok: true, amount: 0 }; }
  try {
    const pi = await stripe().paymentIntents.create({ amount, currency: 'usd', customer: p.customerId, payment_method: p.paymentMethodId, off_session: true, confirm: true,
      description: `Tuition instalment ${p.installmentsPaid + 1} of ${p.installmentsTotal}`, metadata: { type: 'academy_tuition_installment', planId: ref.id } }, { stripeAccount: stripeAccountId, idempotencyKey: `tuition_${ref.id}_${p.installmentsPaid + 1}_${(p.failures || 0)}_${p.paymentMethodId}` });
    if (pi.status !== 'succeeded') throw new Error(pi.status);
    await ledger(tenantId, ref.id, p.studentId, 'payment', amount, `Instalment ${p.installmentsPaid + 1} of ${p.installmentsTotal} (autopay)`, 'autopay', pi.id);
    const paid = p.installmentsPaid + 1;
    await ref.set({ installmentsPaid: paid, failures: 0, lastError: null, lastAttemptAt: new Date().toISOString(), status: paid >= p.installmentsTotal ? 'paid' : 'active', nextDueAt: paid >= p.installmentsTotal ? null : addInterval(p.nextDueAt || new Date().toISOString(), p.interval) }, { merge: true });
    return { ok: true, amount };
  } catch (e: any) {
    await ref.set({ status: 'past_due', failures: (p.failures || 0) + 1, lastAttemptAt: new Date().toISOString(), lastError: String(e?.message || e).slice(0, 200) }, { merge: true });
    await appendAudit(tenantId, { type: 'tuition.failed', studentId: p.studentId, by: 'autopay', summary: `Instalment ${p.installmentsPaid + 1} of ${p.installmentsTotal} failed for ${p.name}: ${String(e?.message || e).slice(0, 120)}`, data: { planId: ref.id } });
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Daily: charge instalments that are due, on the card saved at the down payment. */
export async function chargeDueInstallments() {
  const db = getAdminDb();
  const tenants = await db.collection('tenants').select('stripeAccountId', 'name', 'modules').limit(1000).get();
  const now = Date.now(); let charged = 0, failed = 0;
  for (const tDoc of tenants.docs) {
    const t = tDoc.data() as any; if (!t.stripeAccountId || t.modules?.academy === false) continue;
    const due = await db.collection(`tenants/${tDoc.id}/tuitionPlans`).where('status', 'in', ['active', 'past_due']).limit(1000).get().catch(() => null);
    for (const d of due?.docs || []) {
      const p = d.data() as any;
      if (!p.autopay || !p.nextDueAt || new Date(p.nextDueAt).getTime() > now || p.installmentsPaid >= p.installmentsTotal) continue;
      if (p.lastAttemptAt && now - new Date(p.lastAttemptAt).getTime() < 3 * 86400000) continue;   // retry every 3 days
      const r = await chargePlan(tDoc.id, t.stripeAccountId, d.ref, p);
      if (r.ok) charged++; else failed++;
    }
  }
  return { charged, failed };
}

/** What's coming: the remaining instalments with dates and amounts. */
export function upcomingPayments(p: any, balanceCents: number) {
  const out: { n: number; dueAt: string; amountCents: number }[] = [];
  let left = balanceCents; let due = p.nextDueAt;
  for (let n = p.installmentsPaid + 1; n <= p.installmentsTotal && left > 0 && due; n++) {
    const amt = n === p.installmentsTotal ? left : Math.min(left, p.installmentCents);
    out.push({ n, dueAt: due, amountCents: amt }); left -= amt; due = addInterval(due, p.interval);
  }
  return out;
}

/** A student pays now — the next instalment or the whole balance (Stripe Checkout). */
export async function studentPaySession(opts: { tenantId: string; stripeAccountId: string; planId: string; what: 'next' | 'balance'; origin: string; returnPath: string }) {
  const db = getAdminDb();
  const p = ((await db.doc(`tenants/${opts.tenantId}/tuitionPlans/${opts.planId}`).get()).data() as any) || null;
  if (!p) throw new Error('No tuition plan.');
  const { balanceCents } = await planBalance(opts.tenantId, opts.planId);
  if (balanceCents <= 0) throw new Error('Nothing is owed — you’re all paid up.');
  const amount = opts.what === 'balance' ? balanceCents : Math.min(balanceCents, p.installmentCents || balanceCents);
  const session = await stripe().checkout.sessions.create({
    mode: 'payment', payment_method_types: ['card'], ...(p.customerId ? { customer: p.customerId } : { customer_email: p.email, customer_creation: 'always' }),
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, product_data: { name: opts.what === 'balance' ? 'Tuition — remaining balance' : `Tuition — instalment ${p.installmentsPaid + 1} of ${p.installmentsTotal}` } } }],
    payment_intent_data: { metadata: { type: 'academy_tuition_payment', planId: opts.planId, what: opts.what } },
    metadata: { type: 'academy_tuition_payment', planId: opts.planId, what: opts.what },
    success_url: `${opts.origin}${opts.returnPath}${opts.returnPath.includes('?') ? '&' : '?'}paid={CHECKOUT_SESSION_ID}`, cancel_url: `${opts.origin}${opts.returnPath}`,
  } as any, { stripeAccount: opts.stripeAccountId });
  return session.url as string;
}

/** Record a student's own payment (return page or webhook — safe to run twice). */
export async function completeStudentPayment(tenantId: string, session: any) {
  if (session?.metadata?.type !== 'academy_tuition_payment' || session.payment_status !== 'paid') return null;
  const db = getAdminDb();
  const marker = db.doc(`tenants/${tenantId}/tuitionPayments/${session.id}`);
  if ((await marker.get()).exists) return { already: true };
  await marker.set({ at: new Date().toISOString(), planId: session.metadata.planId });
  const ref = db.doc(`tenants/${tenantId}/tuitionPlans/${session.metadata.planId}`);
  const p = ((await ref.get()).data() as any) || null;
  if (!p) return null;
  const amount = Number(session.amount_total) || 0;
  await ledger(tenantId, ref.id, p.studentId, 'payment', amount, session.metadata.what === 'balance' ? 'Paid remaining balance (online)' : `Instalment ${p.installmentsPaid + 1} of ${p.installmentsTotal} (paid online)`, 'student', session.payment_intent || session.id);
  const { balanceCents } = await planBalance(tenantId, ref.id);
  if (balanceCents <= 0) await ref.set({ status: 'paid', nextDueAt: null, failures: 0, lastError: null }, { merge: true });
  else if (session.metadata.what === 'next') { const paid = p.installmentsPaid + 1; await ref.set({ installmentsPaid: paid, status: 'active', failures: 0, lastError: null, nextDueAt: paid >= p.installmentsTotal ? null : addInterval(p.nextDueAt || new Date().toISOString(), p.interval) }, { merge: true }); }
  else await ref.set({ status: p.status === 'past_due' ? 'active' : p.status, failures: 0, lastError: null }, { merge: true });
  return { already: false };
}

/** Update the autopay card (Stripe Checkout in "setup" mode — no charge). */
export async function cardUpdateSession(opts: { tenantId: string; stripeAccountId: string; planId: string; origin: string; returnPath: string }) {
  const db = getAdminDb();
  const ref = db.doc(`tenants/${opts.tenantId}/tuitionPlans/${opts.planId}`);
  const p = ((await ref.get()).data() as any) || null;
  if (!p) throw new Error('No tuition plan.');
  let customer = p.customerId;
  if (!customer) { const c = await stripe().customers.create({ email: p.email, name: p.name }, { stripeAccount: opts.stripeAccountId }); customer = c.id; await ref.set({ customerId: customer }, { merge: true }); }
  const session = await stripe().checkout.sessions.create({ mode: 'setup', customer, payment_method_types: ['card'], currency: 'usd',
    metadata: { type: 'academy_card_update', planId: opts.planId }, setup_intent_data: { metadata: { type: 'academy_card_update', planId: opts.planId } },
    success_url: `${opts.origin}${opts.returnPath}${opts.returnPath.includes('?') ? '&' : '?'}card={CHECKOUT_SESSION_ID}`, cancel_url: `${opts.origin}${opts.returnPath}` } as any, { stripeAccount: opts.stripeAccountId });
  return session.url as string;
}

/** Save the new card; if a payment had failed, try it again straight away. */
export async function completeCardUpdate(tenantId: string, stripeAccountId: string, session: any) {
  if (session?.metadata?.type !== 'academy_card_update' || session.status !== 'complete') return null;
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/tuitionPlans/${session.metadata.planId}`);
  const p = ((await ref.get()).data() as any) || null;
  if (!p) return null;
  const si = await stripe().setupIntents.retrieve(String(session.setup_intent), {}, { stripeAccount: stripeAccountId });
  const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
  if (!pm) return null;
  if (p.paymentMethodId === pm) return { already: true, retried: null };
  await ref.set({ paymentMethodId: pm, autopay: p.installmentsTotal > p.installmentsPaid, cardUpdatedAt: new Date().toISOString() }, { merge: true });
  await appendAudit(tenantId, { type: 'tuition.card_updated', studentId: p.studentId, by: p.email, summary: `${p.name} updated their autopay card`, data: { planId: ref.id } });
  let retried: any = null;
  if (p.status === 'past_due') retried = await chargePlan(tenantId, stripeAccountId, ref, { ...p, paymentMethodId: pm });
  return { already: false, retried };
}

/**
 * What a withdrawing student owes, or is owed, under the program's policy.
 * pctComplete = share of the program's hours completed (or scheduled, if the
 * school's state uses scheduled hours — the school enters that figure).
 */
export function refundCalc(opts: { tuition: Tuition; policy: RefundPolicy; paidCents: number; pctComplete: number; signedAt?: string | null; startedAt?: string | null; now?: number }) {
  const { tuition: t, policy: p } = opts; const now = opts.now ?? Date.now();
  const steps: string[] = [];
  const withinCancel = !!opts.signedAt && (now - new Date(opts.signedAt).getTime()) <= p.cancelDays * 86400000 && (!opts.startedAt || new Date(opts.startedAt).getTime() > now);
  let keep = 0;
  if (withinCancel) {
    keep = p.registrationNonRefundable ? t.registrationFeeCents : 0;
    steps.push(`Cancelled within ${p.cancelDays} days of signing, before starting → full refund${p.registrationNonRefundable ? ` except the registration fee (${money(t.registrationFeeCents)})` : ''}.`);
  } else {
    const pct = Math.max(0, Math.min(100, opts.pctComplete));
    const tier = [...p.tiers].sort((a, b) => a.upToPct - b.upToPct).find((x) => pct <= x.upToPct) || { upToPct: 100, keepPct: 100 };
    const keepTuition = Math.round(t.tuitionCents * (tier.keepPct / 100));
    steps.push(`${pct.toFixed(1)}% of the program completed → falls in “up to ${tier.upToPct}%” → school keeps ${tier.keepPct}% of tuition = ${money(keepTuition)}.`);
    keep = keepTuition;
    if (p.registrationNonRefundable) { keep += t.registrationFeeCents; steps.push(`Registration fee kept: ${money(t.registrationFeeCents)}.`); }
    if (p.kitNonRefundable) { keep += t.kitCents; steps.push(`Kit kept: ${money(t.kitCents)}.`); }
  }
  const diff = opts.paidCents - keep;
  steps.push(`Paid so far ${money(opts.paidCents)} − school keeps ${money(keep)} = ${diff >= 0 ? `refund due to student ${money(diff)}` : `student still owes ${money(-diff)}`}.`);
  return { keepCents: keep, refundCents: Math.max(0, diff), owedCents: Math.max(0, -diff), steps };
}
