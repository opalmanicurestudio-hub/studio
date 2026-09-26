// src/app/api/academy/admissions/route.ts
//
// ADMISSIONS & TUITION — owners and managers (money and personal documents,
// so not instructors).
//   board · create · get · stage · note · send-link · doc-verify · set-start
//   countersign · cohort-save · cohort-assign
//   tuition · ledger-add · refund-quote · withdraw

import { deviceAllowed } from '@/lib/approved-devices';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { appendAudit } from '@/lib/academy-compliance';
import { setProgramStatus, programProgress } from '@/lib/academy-school';
import { studentIdFor } from '@/lib/academy';
import { STAGES, DEFAULT_DOCS, DEFAULT_REFUND, issueApplicationLink, setStage, ledger, planBalance, refundCalc, money, type Stage } from '@/lib/academy-admissions';
import { resolveFromAddress } from '@/lib/notify';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function email(to: string, subject: string, text: string) {
  if (!process.env.RESEND_API_KEY || !to) return false;
  try { const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: resolveFromAddress(), to, subject, text }) }); return r.ok; } catch { return false; }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager && !auth.actor.isTenantOwner) return NextResponse.json({ ok: false, error: 'Admissions and tuition are for owners and managers.' }, { status: 403 });
  { const dv = await deviceAllowed(tenantId, req); if (!dv.ok) return NextResponse.json({ ok: false, error: dv.error, deviceBlocked: true }, { status: 403 }); }
  const db = getAdminDb();
  const who = auth.actor.name || auth.actor.uid;
  const now = new Date().toISOString();
  const tSnap = await db.doc(`tenants/${tenantId}`).get();
  const t = (tSnap.data() as any) || {};
  const origin = linkOrigin(t, req.nextUrl.origin);
  const aRef = (id: any) => db.doc(`tenants/${tenantId}/admissions/${String(id || '')}`);

  try {
    if (b.action === 'board') {
      const [adm, cohorts, progs] = await Promise.all([db.collection(`tenants/${tenantId}/admissions`).limit(2000).get(), db.collection(`tenants/${tenantId}/cohorts`).limit(200).get(), db.collection(`tenants/${tenantId}/programs`).limit(100).get()]);
      const cs = cohorts.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
      const all = adm.docs.map((d: any) => { const a = d.data() as any; return { id: d.id, name: a.name, email: a.email, phone: a.phone || null, programId: a.programId, cohortId: a.cohortId || null, stage: a.stage, source: a.source || null, createdAt: a.createdAt, updatedAt: a.updatedAt || a.createdAt, waitlisted: !!a.waitlisted,
        docsDone: Object.values(a.documents || {}).filter((x: any) => x.status === 'verified').length, docsTotal: (a.requiredDocs || []).length, signed: !!a.agreement?.signedAt }; });
      for (const c of cs) (c as any).enrolled = all.filter((a: any) => a.cohortId === c.id && a.stage === 'enrolled').length;
      return NextResponse.json({ ok: true, stages: STAGES, admissions: all, cohorts: cs, programs: progs.docs.map((d: any) => { const p = d.data() as any; return { id: d.id, name: p.name, tuition: p.tuition || null }; }) });
    }

    if (b.action === 'create') {
      const name = String(b.name || '').trim().slice(0, 80), mail = String(b.email || '').trim().toLowerCase();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return NextResponse.json({ ok: false, error: 'A name and email are needed.' }, { status: 400 });
      const p = ((await db.doc(`tenants/${tenantId}/programs/${String(b.programId || '')}`).get()).data() as any) || null;
      if (!p) return NextResponse.json({ ok: false, error: 'Choose a program.' }, { status: 400 });
      const ref = db.collection(`tenants/${tenantId}/admissions`).doc();
      await ref.set({ id: ref.id, name, email: mail, phone: String(b.phone || '').slice(0, 30) || null, programId: b.programId, stage: 'inquiry', source: String(b.source || 'added by staff').slice(0, 80),
        requiredDocs: p.requiredDocs?.length ? p.requiredDocs : DEFAULT_DOCS, documents: {}, notes: b.note ? [{ at: now, by: who, text: String(b.note).slice(0, 1000) }] : [], createdAt: now, updatedAt: now, history: [{ stage: 'inquiry', at: now, by: who }] });
      await appendAudit(tenantId, { type: 'admissions.created', by: who, summary: `New inquiry: ${name} (${p.name})`, data: { admissionId: ref.id } });
      return NextResponse.json({ ok: true, id: ref.id });
    }

    if (b.action === 'get') {
      const a = ((await aRef(b.id).get()).data() as any) || null;
      if (!a) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      const p = ((await db.doc(`tenants/${tenantId}/programs/${a.programId}`).get()).data() as any) || {};
      const planId = `${a.programId}_${studentIdFor(a.email)}`;
      const plan = ((await db.doc(`tenants/${tenantId}/tuitionPlans/${planId}`).get()).data() as any) || null;
      const bal = plan ? await planBalance(tenantId, planId) : null;
      const { appTokenHash, ...safe } = a;
      return NextResponse.json({ ok: true, admission: { id: b.id, ...safe, hasLink: !!appTokenHash }, program: { id: a.programId, name: p.name, tuition: p.tuition || null, refundPolicy: p.refundPolicy || DEFAULT_REFUND, totalHours: p.totalHours || null }, plan, balance: bal });
    }

    if (b.action === 'stage') {
      if (!STAGES.includes(b.stage)) return NextResponse.json({ ok: false, error: 'Unknown stage.' }, { status: 400 });
      if (b.stage === 'enrolled') return NextResponse.json({ ok: false, error: 'Students become enrolled when their agreement is signed and down payment made (or use Programs → Enrol to enrol directly).' }, { status: 400 });
      if (['declined', 'withdrawn'].includes(b.stage) && !String(b.note || '').trim()) return NextResponse.json({ ok: false, error: 'A reason is required — it’s kept on the record.' }, { status: 400 });
      await setStage(tenantId, String(b.id), b.stage as Stage, who, String(b.note || '').slice(0, 300) || undefined);
      return NextResponse.json({ ok: true });
    }

    if (b.action === 'note') {
      const a = ((await aRef(b.id).get()).data() as any) || null; const text = String(b.text || '').trim().slice(0, 1000);
      if (!a || !text) return NextResponse.json({ ok: false, error: 'Nothing to add.' }, { status: 400 });
      await aRef(b.id).set({ notes: [...(a.notes || []), { at: now, by: who, text }], updatedAt: now }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (b.action === 'send-link') {
      const a = ((await aRef(b.id).get()).data() as any) || null;
      if (!a) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      const token = await issueApplicationLink(tenantId, String(b.id));
      const link = `${origin}/learn/${tenantId}/application/${token}`;
      if (['inquiry', 'tour'].includes(a.stage)) await setStage(tenantId, String(b.id), 'applied', who, 'Application link sent');
      const sent = await email(a.email, `Your application — ${t.name || 'our academy'}`, `Hi ${String(a.name).split(' ')[0]},\n\nHere’s your private application page. You can upload your documents, read and sign your enrolment agreement, and make your down payment there:\n\n${link}\n\nKeep this link private. Any questions, just reply.\n\n— ${t.name || 'The academy'}`);
      return NextResponse.json({ ok: true, link, emailed: sent });
    }

    if (b.action === 'doc-verify') {
      const a = ((await aRef(b.id).get()).data() as any) || null; const key = String(b.docKey || '');
      if (!a?.documents?.[key]) return NextResponse.json({ ok: false, error: 'No document uploaded for that yet.' }, { status: 400 });
      const verified = !!b.verified, reason = String(b.reason || '').trim().slice(0, 300);
      if (!verified && !reason) return NextResponse.json({ ok: false, error: 'Say why it can’t be accepted — the applicant sees this.' }, { status: 400 });
      await aRef(b.id).set({ documents: { [key]: { ...a.documents[key], status: verified ? 'verified' : 'rejected', reason: verified ? null : reason, checkedBy: who, checkedAt: now } }, updatedAt: now }, { merge: true });
      await appendAudit(tenantId, { type: verified ? 'admissions.doc_verified' : 'admissions.doc_rejected', by: who, summary: `${a.name}: ${key} ${verified ? 'verified' : `rejected — ${reason}`}`, data: { admissionId: b.id, sha256: a.documents[key].sha256 || null } });
      return NextResponse.json({ ok: true });
    }

    if (b.action === 'set-start') {
      await aRef(b.id).set({ startDate: String(b.startDate || '').slice(0, 10) || null, updatedAt: now }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (b.action === 'countersign') {
      const a = ((await aRef(b.id).get()).data() as any) || null;
      if (!a?.agreement?.signedAt) return NextResponse.json({ ok: false, error: 'The student hasn’t signed yet.' }, { status: 400 });
      await aRef(b.id).set({ agreement: { ...a.agreement, countersignedBy: who, countersignedAt: now } }, { merge: true });
      await appendAudit(tenantId, { type: 'admissions.countersigned', by: who, summary: `Enrolment agreement for ${a.name} countersigned`, data: { admissionId: b.id, sha256: a.agreement.sha256 } });
      return NextResponse.json({ ok: true });
    }

    if (b.action === 'cohort-save') {
      const c = b.cohort || {};
      const ref = c.id ? db.doc(`tenants/${tenantId}/cohorts/${String(c.id)}`) : db.collection(`tenants/${tenantId}/cohorts`).doc();
      await ref.set({ id: ref.id, programId: String(c.programId || ''), name: String(c.name || '').slice(0, 80) || 'Cohort', startDate: String(c.startDate || '').slice(0, 10) || null, capacity: Math.max(0, Number(c.capacity) || 0) || null, schedule: String(c.schedule || '').slice(0, 200) || null, updatedAt: now }, { merge: true });
      return NextResponse.json({ ok: true, id: ref.id });
    }

    if (b.action === 'cohort-assign') {
      const c = ((await db.doc(`tenants/${tenantId}/cohorts/${String(b.cohortId || '')}`).get()).data() as any) || null;
      if (!c) return NextResponse.json({ ok: false, error: 'Cohort not found.' }, { status: 404 });
      const taken = (await db.collection(`tenants/${tenantId}/admissions`).where('cohortId', '==', b.cohortId).limit(1000).get()).docs.filter((d: any) => d.id !== b.id && !['declined', 'withdrawn'].includes((d.data() as any).stage)).length;
      const waitlisted = !!c.capacity && taken >= c.capacity;
      await aRef(b.id).set({ cohortId: b.cohortId, startDate: c.startDate || null, waitlisted, updatedAt: now }, { merge: true });
      return NextResponse.json({ ok: true, waitlisted });
    }

    if (b.action === 'tuition') {
      const s = await db.collection(`tenants/${tenantId}/tuitionPlans`).limit(2000).get();
      const plans = [];
      for (const d of s.docs) { const p = d.data() as any; const bal = await planBalance(tenantId, d.id); plans.push({ id: d.id, name: p.name, email: p.email, status: p.status, autopay: !!p.autopay, nextDueAt: p.nextDueAt || null, installments: `${p.installmentsPaid || 0}/${p.installmentsTotal || 0}`, balanceCents: bal.balanceCents, paidCents: bal.paidCents, failures: p.failures || 0, lastError: p.lastError || null }); }
      plans.sort((a: any, c: any) => (c.status === 'past_due' ? 1 : 0) - (a.status === 'past_due' ? 1 : 0) || c.balanceCents - a.balanceCents);
      return NextResponse.json({ ok: true, plans, totals: { outstandingCents: plans.reduce((n, p) => n + Math.max(0, p.balanceCents), 0), pastDue: plans.filter((p) => p.status === 'past_due').length } });
    }

    if (b.action === 'ledger-add') {
      const type = ['payment', 'adjustment', 'refund'].includes(b.type) ? b.type : null;
      const amount = Math.round(Number(b.amountCents) || 0), desc = String(b.desc || '').trim().slice(0, 200);
      if (!type || !amount || !desc) return NextResponse.json({ ok: false, error: 'Type, amount and a description are needed.' }, { status: 400 });
      const p = ((await db.doc(`tenants/${tenantId}/tuitionPlans/${String(b.planId || '')}`).get()).data() as any) || null;
      if (!p) return NextResponse.json({ ok: false, error: 'Plan not found.' }, { status: 404 });
      await ledger(tenantId, String(b.planId), p.studentId, type, amount, desc, who);
      return NextResponse.json({ ok: true });
    }

    if (b.action === 'refund-quote' || b.action === 'withdraw') {
      const planId = String(b.planId || '');
      const p = ((await db.doc(`tenants/${tenantId}/tuitionPlans/${planId}`).get()).data() as any) || null;
      if (!p) return NextResponse.json({ ok: false, error: 'Plan not found.' }, { status: 404 });
      const prog = ((await db.doc(`tenants/${tenantId}/programs/${p.programId}`).get()).data() as any) || {};
      const a = ((await db.doc(`tenants/${tenantId}/admissions/${p.admissionId}`).get()).data() as any) || {};
      const bal = await planBalance(tenantId, planId);
      const prg = await programProgress(tenantId, planId);
      const pct = b.pctComplete != null && b.pctComplete !== '' ? Number(b.pctComplete) : (prg?.hours?.pct ?? 0);
      const q = refundCalc({ tuition: prog.tuition || { tuitionCents: 0, registrationFeeCents: 0, kitCents: 0, downPaymentCents: 0, installments: 0, interval: 'month' }, policy: prog.refundPolicy || DEFAULT_REFUND, paidCents: bal.paidCents, pctComplete: pct, signedAt: a.agreement?.signedAt || null, startedAt: a.startDate || null });
      if (b.action === 'refund-quote') return NextResponse.json({ ok: true, quote: q, pctComplete: pct, paidCents: bal.paidCents });
      const reason = String(b.reason || '').trim();
      if (!reason) return NextResponse.json({ ok: false, error: 'A reason is required.' }, { status: 400 });
      await db.doc(`tenants/${tenantId}/tuitionPlans/${planId}`).set({ status: 'cancelled', autopay: false, nextDueAt: null, withdrawnAt: now }, { merge: true });
      const keptAdj = q.keepCents - bal.chargedCents;   // close the balance to what the policy keeps
      if (keptAdj !== 0) await ledger(tenantId, planId, p.studentId, 'adjustment', keptAdj, `Withdrawal: charges reduced to ${money(q.keepCents)} under the refund policy`, who);
      if (b.recordRefund && q.refundCents > 0) await ledger(tenantId, planId, p.studentId, 'refund', q.refundCents, `Refund due on withdrawal (issue it from Stripe or by cheque)`, who);
      try { await setProgramStatus({ tenantId, enrollmentId: planId, status: 'withdrawn', reason, by: who }); } catch { /* not enrolled yet */ }
      if (p.admissionId) { try { await setStage(tenantId, p.admissionId, 'withdrawn', who, reason); } catch { /* ignore */ } }
      await appendAudit(tenantId, { type: 'tuition.withdrawal', studentId: p.studentId, by: who, summary: `${p.name} withdrew at ${pct}% — school keeps ${money(q.keepCents)}; ${q.refundCents ? `refund due ${money(q.refundCents)}` : q.owedCents ? `student owes ${money(q.owedCents)}` : 'nothing owed either way'}. Reason: ${reason}`, data: { planId, steps: q.steps } });
      return NextResponse.json({ ok: true, quote: q });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
