// src/lib/academy-admissions.ts
//
// ADMISSIONS, ENROLMENT AND TUITION — the business side of a licensed school.
//
//   admissions/{id}        one applicant: stage, program, cohort, documents,
//                          agreement, tuition, notes, full history
//                          stages: inquiry → tour → applied → review → (a person
//                                  decides) offer → accepted → agreement → enrolled
//                                  (or waitlist / declined = not accepted / withdrawn)
//                                  — see academy-decisions.ts. 'documents' is the
//                                  older name for review.
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
//
// Every payment is recorded once, however it arrives — the student's return
// page and Stripe's notice often come at the same moment:
//   - a Checkout payment is claimed first, on tuitionPayments/{checkout page}
//     (a card update on tuitionCardUpdates/{checkout page}); only the request
//     that claims it goes on, and a claim left by a try that stopped part way is
//     finished by the next one;
//   - its tuition entry is named after the page (an instalment charged here,
//     after its payment), and its line in the books after the entry;
//   - the plan moves on once per payment, in one step read fresh.

import { createHash, randomBytes } from 'crypto';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { appendAudit } from '@/lib/academy-compliance';
import { enrollInProgram } from '@/lib/academy-school';
import { stripeRefused as saidNo } from '@/lib/stripe-said-no';

export const STAGES = ['inquiry', 'tour', 'applied', 'documents', 'review', 'offer', 'accepted', 'waitlist', 'agreement', 'enrolled', 'declined', 'withdrawn'] as const;
export type Stage = typeof STAGES[number];
export const DEFAULT_DOCS = ['Photo ID', 'High school diploma or GED', 'Proof of age'];
export const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
export const money = (c: number) => `$${(Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safeId = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 140);
const piOf = (s: any): string | null => (typeof s?.payment_intent === 'string' ? s.payment_intent : s?.payment_intent?.id || null);
// A claim older than this belongs to a try that stopped; the next one finishes it.
const CLAIM_MS = 2 * 60000;
const fresh = (at: any) => !!at && Date.now() - (Date.parse(String(at)) || 0) < CLAIM_MS;

export interface Tuition { tuitionCents: number; registrationFeeCents: number; kitCents: number; downPaymentCents: number; installments: number; interval: 'month' | 'biweekly' }
export interface RefundPolicy { cancelDays: number; registrationNonRefundable: boolean; kitNonRefundable: boolean; tiers: { upToPct: number; keepPct: number }[] }
export const DEFAULT_REFUND: RefundPolicy = { cancelDays: 3, registrationNonRefundable: true, kitNonRefundable: true,
  tiers: [{ upToPct: 10, keepPct: 10 }, { upToPct: 25, keepPct: 25 }, { upToPct: 50, keepPct: 50 }, { upToPct: 100, keepPct: 100 }] };

/** A new private application link for an applicant. */
export async function issueApplicationLink(tenantId: string, admissionId: string) {
  // A new link is ADDED to the last few, so links already emailed keep working.
  const token = randomBytes(24).toString('base64url');
  const ref = getAdminDb().doc(`tenants/${tenantId}/admissions/${admissionId}`);
  const a = ((await ref.get()).data() as any) || {};
  const hashes = [...(a.appTokenHashes || (a.appTokenHash ? [a.appTokenHash] : [])), sha(token)].slice(-5);
  await ref.set({ appTokenHash: sha(token), appTokenHashes: hashes, appTokenAt: new Date().toISOString() }, { merge: true });
  return token;
}
export async function admissionByToken(tenantId: string, token: string) {
  if (!token) return null;
  const col = getAdminDb().collection(`tenants/${tenantId}/admissions`);
  let s = await col.where('appTokenHashes', 'array-contains', sha(token)).limit(1).get();
  if (s.empty) s = await col.where('appTokenHash', '==', sha(token)).limit(1).get();   // links issued before multi-link
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
  // Scholarships awarded before the student signed are credited now.
  try { const { applyPendingAwards } = await import('@/lib/academy-funding'); await applyPendingAwards(opts.tenantId, opts.email); } catch { /* staff can apply it from Funding */ }
  return id;
}

export async function ledger(tenantId: string, planId: string, studentId: string, type: 'charge' | 'payment' | 'refund' | 'adjustment', amountCents: number, desc: string, by: string, ref?: string | null, opts?: { inBooks?: boolean; id?: string }) {
  const db = getAdminDb();
  // Named after what it records when the caller knows it (a payment's Checkout page, or the charge), so the same payment
  // arriving twice is one entry: the second finds it there. Anything else gets an entry of its own.
  const r = opts?.id ? db.doc(`tenants/${tenantId}/tuitionEntries/${safeId(opts.id)}`) : db.collection(`tenants/${tenantId}/tuitionEntries`).doc();
  const entry = { id: r.id, planId, studentId, type, amountCents: Math.round(amountCents), desc, by, ref: ref || null, at: new Date().toISOString() };
  const toBooks = (e: any) => ((type === 'payment' || type === 'refund') && !opts?.inBooks
    ? tuitionToBooks(tenantId, r.id, { planId, type, amountCents: e.amountCents, desc: e.desc, by: e.by, ref: e.ref || null, at: e.at }).catch((x) => console.error('[tuition→books]', x)) : Promise.resolve(false));
  if (opts?.id) {
    try { await r.create(entry); }
    catch (e) {
      const had = await r.get(); if (!had.exists) throw e;
      // Recorded already: only its line in the books is checked (a try that stopped before writing it).
      await toBooks(had.data() || entry);
      return { id: r.id, already: true };
    }
  } else await r.set(entry);
  await appendAudit(tenantId, { type: `tuition.${type}`, studentId, by, summary: `${type[0].toUpperCase()}${type.slice(1)} ${money(amountCents)} — ${desc}`, data: { planId, entryId: r.id, ref: ref || null } });
  // THE BUSINESS'S BOOKS: tuition money in (and back out) also lands in the general ledger as Tuition income / Tuition
  // Refunds — one line per tuition entry (its id), so it can't be counted twice. Desk payments and desk voids pass
  // inBooks: true — the checkout has already recorded those.
  await toBooks(entry);
  return { id: r.id, already: false };
}
/** One tuition entry → one line in the business's books (idempotent: the line's id is the entry's id). */
export async function tuitionToBooks(tenantId: string, entryId: string, e: { planId: string; type: string; amountCents: number; desc: string; by: string; ref: string | null; at: string }) {
  const db = getAdminDb(); const { buildLedgerEntry, ledgerEntryId } = await import('@/lib/ledger');
  const id = ledgerEntryId('academy_tuition', entryId); const ref = db.doc(`tenants/${tenantId}/transactions/${id}`);
  if ((await ref.get()).exists) return false;
  const p: any = ((await db.doc(`tenants/${tenantId}/tuitionPlans/${e.planId}`).get()).data() as any) || {};
  const pay = e.type === 'payment';
  const entry = buildLedgerEntry({ source: 'academy_tuition', sourceId: entryId, amountCents: Math.abs(Math.round(e.amountCents)), category: pay ? 'Tuition' : 'Tuition Refunds', type: pay ? 'income' : 'expense',
    description: `${pay ? 'Tuition' : 'Tuition refund'} — ${p.name || 'Student'} — ${e.desc}`, clientOrVendor: p.name || undefined, date: e.at,
    paymentMethod: ['autopay', 'student'].includes(e.by) || /online|autopay/i.test(e.desc) ? 'Card (Stripe)' : 'Other', stripePaymentIntentId: e.ref && /^(pi_|cs_)/.test(e.ref) ? e.ref : null } as any);
  await ref.set({ ...entry, id, tuitionEntryId: entryId, planId: e.planId });
  return true;
}
export async function planBalance(tenantId: string, planId: string) {
  const s = await getAdminDb().collection(`tenants/${tenantId}/tuitionEntries`).where('planId', '==', planId).limit(2000).get();
  const entries = s.docs.map((d: any) => d.data() as any).sort((a: any, b: any) => String(a.at).localeCompare(String(b.at)));
  const charged = entries.filter((e: any) => e.type === 'charge').reduce((n: number, e: any) => n + e.amountCents, 0) + entries.filter((e: any) => e.type === 'adjustment').reduce((n: number, e: any) => n + e.amountCents, 0);
  const paid = entries.filter((e: any) => e.type === 'payment').reduce((n: number, e: any) => n + e.amountCents, 0) - entries.filter((e: any) => e.type === 'refund').reduce((n: number, e: any) => n + e.amountCents, 0);
  return { entries, chargedCents: charged, paidCents: paid, balanceCents: charged - paid };
}

const addInterval = (iso: string, interval: 'month' | 'biweekly') => { const d = new Date(iso); if (interval === 'biweekly') d.setDate(d.getDate() + 14); else d.setMonth(d.getMonth() + 1); return d.toISOString(); };

/** A Checkout payment, claimed once on a record named after its page. 'go' only for the request that claimed it (or
 *  that finishes a claim a stopped try left behind). For a new claim, `decide` can say it was recorded already, name
 *  what kind of payment it is, or mark the plan in the same step. */
async function claimCheckout(db: any, payRef: any, planRef: any, rec: any, decide?: (plan: any) => { already?: boolean; kind?: string; planSet?: any } | null) {
  const now = new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const m = await tx.get(payRef); const ps = await tx.get(planRef);
    if (!ps.exists) return { none: true };
    const plan: any = ps.data() || {};
    if (m.exists) {
      const x: any = m.data() || {};
      // Recorded already — or by the version before this one, which kept only this mark.
      if (x.doneAt || !x.claimAt) return { already: true, plan };
      if (fresh(x.claimAt)) return { busy: true, plan };
      tx.set(payRef, { claimAt: now }, { merge: true });
      return { go: true, plan, mark: x, resumed: true };
    }
    const d = decide ? decide(plan) : null;
    if (d?.already) return { already: true, plan };
    const mark = { ...rec, kind: d?.kind || rec.kind, claimAt: now, at: now };
    tx.create(payRef, mark);
    if (d?.planSet) tx.set(planRef, d.planSet, { merge: true });
    return { go: true, plan, mark };
  });
}

/** After the down payment clears: record it, save the card, schedule instalments, enrol — once (see the header). A
 *  down payment paid a second time (two payment pages) is counted toward the balance, once, and doesn't enrol again. */
export async function completeDownPayment(tenantId: string, session: any) {
  if (session?.metadata?.type !== 'academy_tuition' || session.payment_status !== 'paid') return null;
  const db = getAdminDb();
  const planId = String(session.metadata.planId);
  const ref = db.doc(`tenants/${tenantId}/tuitionPlans/${planId}`);
  const payRef = db.doc(`tenants/${tenantId}/tuitionPayments/${safeId(session.id)}`);
  const cents = Number(session.amount_total) || 0; const pi = piOf(session); const now = new Date().toISOString();
  const claim: any = await claimCheckout(db, payRef, ref, { kind: 'down_payment', planId, sessionId: String(session.id), cents, paymentIntentId: pi }, (plan) => {
    // Recorded before payments were claimed this way (only the plan says so): never recorded again.
    if (plan.downPaidAt && !plan.downPaidSessionId) return { already: true };
    if (plan.downPaidAt && plan.downPaidSessionId !== session.id) return { kind: 'down_payment_again' };
    // The first: the plan says which page paid it, in the same step, so a second page paid at the same moment is
    // known to be the second.
    return { planSet: { downPaidAt: now, downPaidSessionId: String(session.id) } };
  });
  if (claim.none) return null;
  if (claim.already || claim.busy) return { planId, already: true };
  const p = claim.plan;
  if (claim.mark?.kind === 'down_payment_again') {
    await ledger(tenantId, planId, p.studentId, 'payment', cents, 'Down payment paid a second time (online) — counted toward the balance', 'student', pi || session.id, { id: `pay_${session.id}` });
    await payRef.set({ doneAt: new Date().toISOString() }, { merge: true });
    return { planId, already: false, second: true };
  }
  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  let paymentMethodId: string | null = null;
  try { if (pi) { const x = await stripe().paymentIntents.retrieve(String(pi), {}, { stripeAccount: t.stripeAccountId }); paymentMethodId = typeof x.payment_method === 'string' ? x.payment_method : x.payment_method?.id || null; } } catch { /* keep going */ }
  await ledger(tenantId, planId, p.studentId, 'payment', cents || p.downPaymentCents, 'Down payment', 'student', pi || session.id, { id: `pay_${session.id}` });
  const more = p.installmentsTotal > 0;
  const paidAt = claim.resumed ? (p.downPaidAt || now) : now;
  await ref.set({ downPaidAt: paidAt, downPaidSessionId: String(session.id), customerId: session.customer || null, paymentMethodId, autopay: more && !!paymentMethodId, status: more ? 'active' : 'paid', nextDueAt: more ? addInterval(paidAt, p.interval) : null }, { merge: true });
  // Paying the down payment completes admission → enrolled in the program.
  const a = ((await db.doc(`tenants/${tenantId}/admissions/${p.admissionId}`).get()).data() as any) || {};
  await enrollInProgram({ tenantId, programId: p.programId, email: p.email, name: p.name, startDate: a.startDate || null, by: 'admissions' });
  await setStage(tenantId, p.admissionId, 'enrolled', 'system', 'Down payment received');
  await payRef.set({ doneAt: new Date().toISOString() }, { merge: true });
  return { planId, already: false };
}

const refusedByStripe = (e: any) => saidNo(e);

/** Charge one plan's next instalment now (autopay, or right after a card update) — once, however often it's asked:
 *  the instalment is claimed on the plan first (the daily run and a card update at the same moment send one charge),
 *  charged under one key for the instalment, try and card, and recorded once, named after its payment; the plan moves
 *  on once for that payment. Stripe saying no marks it past due. No answer leaves the claim: the next try looks for
 *  that payment at Stripe and records it, or sends the same charge again — never a second. */
export async function chargePlan(tenantId: string, stripeAccountId: string, ref: any, p: any) {
  const db = getAdminDb();
  const { balanceCents } = await planBalance(tenantId, ref.id);
  const base = Math.min(balanceCents, p.installmentsPaid + 1 >= p.installmentsTotal ? balanceCents : p.installmentCents);
  if (base <= 0) { await ref.set({ status: 'paid', nextDueAt: null, prepaidCents: 0 }, { merge: true }); return { ok: true, amount: 0 }; }
  // Part of this instalment was paid ahead at the front desk → charge only the rest (or nothing, and move on).
  const prepaid = Math.max(0, Number(p.prepaidCents) || 0); const amount = Math.max(0, base - prepaid);
  if (amount <= 0) { const paid = p.installmentsPaid + 1;
    await ref.set({ installmentsPaid: paid, prepaidCents: prepaid - base, failures: 0, lastError: null, status: paid >= p.installmentsTotal ? 'paid' : 'active', nextDueAt: paid >= p.installmentsTotal ? null : addInterval(p.nextDueAt || new Date().toISOString(), p.interval) }, { merge: true });
    return { ok: true, amount: 0, coveredByPrepaid: true }; }
  const n = (Number(p.installmentsPaid) || 0) + 1; const now = new Date().toISOString();
  // 1. The claim, for this instalment. A claim a stopped try left is the same charge again (its amount, card and key).
  const claim: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if ((Number(cur.installmentsPaid) || 0) >= n) return { moved: true };   // paid meanwhile
    const c = cur.chargeClaim;
    if (c && Number(c.n) === n) {
      if (fresh(c.at)) return { busy: true };
      tx.set(ref, { chargeClaim: { ...c, at: now } }, { merge: true });
      return { c, retry: true };
    }
    const pm = String(p.paymentMethodId || '');
    const c2 = { n, at: now, since: now, amount, pm, customer: String(p.customerId || ''), key: `tuition_${ref.id}_${n}_${(p.failures || 0)}_${pm}` };
    tx.set(ref, { chargeClaim: c2 }, { merge: true });
    return { c: c2 };
  });
  if (claim.moved) return { ok: true, amount: 0, already: true };
  if (claim.busy) return { ok: false, error: 'This instalment is being charged already.', busy: true };
  const c = claim.c;
  // 2. The charge.
  let pi: any = null;
  if (claim.retry) {
    // The last try got no answer: a payment Stripe has for it is the one (recorded, never sent again).
    try {
      const l: any = await stripe().paymentIntents.list({ customer: c.customer, limit: 20 }, { stripeAccount: stripeAccountId });
      pi = (Array.isArray(l?.data) ? l.data : []).find((x: any) => x?.metadata?.planId === ref.id && x?.metadata?.type === 'academy_tuition_installment' && x?.status === 'succeeded'
        && Number(x.amount) === Number(c.amount) && (Number(x.created) || 0) * 1000 >= (Date.parse(String(c.since || c.at)) || 0) - 60000) || null;
    } catch { /* asked for below, under the same key */ }
  }
  try {
    if (!pi) pi = await stripe().paymentIntents.create({ amount: c.amount, currency: 'usd', customer: c.customer, payment_method: c.pm, off_session: true, confirm: true,
      description: `Tuition instalment ${n} of ${p.installmentsTotal}`, metadata: { type: 'academy_tuition_installment', planId: ref.id } }, { stripeAccount: stripeAccountId, idempotencyKey: c.key });
    if (pi.status !== 'succeeded') throw Object.assign(new Error(pi.status), { type: ['requires_payment_method', 'canceled', 'requires_action'].includes(String(pi.status)) ? 'StripeCardError' : 'StillGoing' });
  } catch (e: any) {
    if (!refusedByStripe(e)) {
      // No answer (it may have gone through): not a failure, and not past due. The claim stays for the next try.
      await ref.set({ lastAttemptAt: now }, { merge: true });
      return { ok: false, error: 'Stripe didn’t answer, so the charge may or may not have gone through. It’s checked again on the next try: it won’t charge twice.', unknown: true };
    }
    const msg = String(e?.raw?.message || e?.message || e).slice(0, 200);
    await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {};
      if (cur.chargeClaim?.key !== c.key) return;
      tx.set(ref, { chargeClaim: FieldValue.delete(), status: 'past_due', failures: (Number(cur.failures) || 0) + 1, lastAttemptAt: now, lastError: msg }, { merge: true });
    });
    await appendAudit(tenantId, { type: 'tuition.failed', studentId: p.studentId, by: 'autopay', summary: `Instalment ${n} of ${p.installmentsTotal} failed for ${p.name}: ${msg.slice(0, 120)}`, data: { planId: ref.id } });
    return { ok: false, error: msg };
  }
  // 3. The record, once: named after the payment; the plan moves on once for it.
  try {
    await ledger(tenantId, ref.id, p.studentId, 'payment', c.amount, `Instalment ${n} of ${p.installmentsTotal} (autopay)`, 'autopay', pi.id, { id: `pay_${pi.id}` });
    await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {};
      if (cur.lastPaidPaymentIntentId === pi.id) return;
      const paid = (Number(cur.installmentsPaid) || 0) + 1; const total = Number(cur.installmentsTotal ?? p.installmentsTotal) || 0;
      tx.set(ref, { installmentsPaid: paid, prepaidCents: 0, failures: 0, lastError: null, lastAttemptAt: now, lastPaidPaymentIntentId: pi.id, chargeClaim: FieldValue.delete(),
        status: paid >= total ? 'paid' : 'active', nextDueAt: paid >= total ? null : addInterval(cur.nextDueAt || p.nextDueAt || now, cur.interval || p.interval) }, { merge: true });
    });
  } catch (e: any) {
    // Charged, but not written down yet: the claim stays, and the next try finds this payment and records it.
    console.error('[tuition] charged but not recorded yet', e?.message);
    return { ok: false, error: 'The instalment was charged but couldn’t be recorded yet. It’s recorded on the next try.', unknown: true };
  }
  return { ok: true, amount: c.amount };
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
      // Retry every 3 days — except a charge that got no answer, which is checked on the next run.
      if (p.lastAttemptAt && now - new Date(p.lastAttemptAt).getTime() < 3 * 86400000 && !p.chargeClaim) continue;
      const r = await chargePlan(tDoc.id, t.stripeAccountId, d.ref, p);
      if (r.ok) charged++; else failed++;
    }
  }
  return { charged, failed };
}

/** What's coming: the remaining instalments with dates and amounts. */
export function upcomingPayments(p: any, balanceCents: number) {
  const out: { n: number; dueAt: string; amountCents: number }[] = [];
  let left = balanceCents; let due = p.nextDueAt; let ahead = Math.max(0, Number(p.prepaidCents) || 0);   // paid ahead comes off the next one
  for (let n = p.installmentsPaid + 1; n <= p.installmentsTotal && left > 0 && due; n++) {
    const amt = n === p.installmentsTotal ? left : Math.min(left, Math.max(0, p.installmentCents - ahead)); ahead = 0;
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

/** Record a student's own payment (return page or webhook, often at the same moment) — once (see the header). */
export async function completeStudentPayment(tenantId: string, session: any) {
  if (session?.metadata?.type !== 'academy_tuition_payment' || session.payment_status !== 'paid') return null;
  const db = getAdminDb();
  const planId = String(session.metadata.planId);
  const payRef = db.doc(`tenants/${tenantId}/tuitionPayments/${safeId(session.id)}`);
  const ref = db.doc(`tenants/${tenantId}/tuitionPlans/${planId}`);
  const amount = Number(session.amount_total) || 0; const pi = piOf(session);
  const claim: any = await claimCheckout(db, payRef, ref, { kind: 'student_payment', planId, sessionId: String(session.id), cents: amount, paymentIntentId: pi, what: session.metadata.what || null });
  if (claim.none) return null;
  if (claim.already || claim.busy) return { already: true };
  const p = claim.plan;
  await ledger(tenantId, ref.id, p.studentId, 'payment', amount, session.metadata.what === 'balance' ? 'Paid remaining balance (online)' : `Instalment ${p.installmentsPaid + 1} of ${p.installmentsTotal} (paid online)`, 'student', pi || session.id, { id: `pay_${session.id}` });
  const { balanceCents } = await planBalance(tenantId, ref.id);
  // The plan moves on once for this payment, read fresh in one step (another payment at the same moment isn't lost).
  await db.runTransaction(async (tx: any) => {
    const m: any = (await tx.get(payRef)).data() || {}; const cur: any = (await tx.get(ref)).data() || {};
    if (m.planMovedAt) return;
    const done = { planMovedAt: new Date().toISOString(), doneAt: new Date().toISOString() };
    if (balanceCents <= 0) tx.set(ref, { status: 'paid', nextDueAt: null, failures: 0, lastError: null }, { merge: true });
    else if (session.metadata.what === 'next') { const paid = (Number(cur.installmentsPaid) || 0) + 1; tx.set(ref, { installmentsPaid: paid, status: 'active', failures: 0, lastError: null, nextDueAt: paid >= (Number(cur.installmentsTotal) || 0) ? null : addInterval(cur.nextDueAt || new Date().toISOString(), cur.interval) }, { merge: true }); }
    else tx.set(ref, { status: cur.status === 'past_due' ? 'active' : cur.status, failures: 0, lastError: null }, { merge: true });
    tx.set(payRef, done, { merge: true });
  });
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

/** Save the new card; if a payment had failed, try it again straight away — once per card-update page (the return
 *  page and Stripe's notice arrive together): the page is claimed first, and the retried charge is chargePlan's own. */
export async function completeCardUpdate(tenantId: string, stripeAccountId: string, session: any) {
  if (session?.metadata?.type !== 'academy_card_update' || session.status !== 'complete') return null;
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/tuitionPlans/${session.metadata.planId}`);
  if (!(await ref.get()).exists) return null;
  const si = await stripe().setupIntents.retrieve(String(session.setup_intent), {}, { stripeAccount: stripeAccountId });
  const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
  if (!pm) return null;
  const markRef = db.doc(`tenants/${tenantId}/tuitionCardUpdates/${safeId(session.id)}`);
  const claim: any = await claimCheckout(db, markRef, ref, { kind: 'card_update', planId: String(session.metadata.planId), sessionId: String(session.id), paymentMethodId: pm });
  if (claim.none) return null;
  if (claim.already || claim.busy) return { already: true, retried: null };
  const p = claim.plan;
  // The card the plan already has: nothing to change (and, as before, nothing retried).
  if (p.paymentMethodId === pm && !claim.resumed) { await markRef.set({ doneAt: new Date().toISOString() }, { merge: true }); return { already: true, retried: null }; }
  if (p.paymentMethodId !== pm) {
    await ref.set({ paymentMethodId: pm, autopay: p.installmentsTotal > p.installmentsPaid, cardUpdatedAt: new Date().toISOString() }, { merge: true });
    await appendAudit(tenantId, { type: 'tuition.card_updated', studentId: p.studentId, by: p.email, summary: `${p.name} updated their autopay card`, data: { planId: ref.id } });
  }
  let retried: any = null;
  if (p.status === 'past_due') retried = await chargePlan(tenantId, stripeAccountId, ref, { ...p, paymentMethodId: pm });
  await markRef.set({ doneAt: new Date().toISOString() }, { merge: true });
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
