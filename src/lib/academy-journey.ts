// src/lib/academy-journey.ts
//
// THE STUDENT JOURNEY (licensed schools).
//
//   Risk          nightly score 0–100 for every active student, WITH REASONS:
//                 no online learning lately, no clock-in lately, attendance
//                 below the program's minimum, tuition past due, low quiz
//                 average, behind on required services, flagged punches,
//                 missed attention checks. ok < 25 ≤ watch < 50 ≤ high.
//   SAP           satisfactory academic progress: at each hour checkpoint the
//                 school sets, attendance %, quiz average and practical
//                 average are checked against its minimums →
//                 satisfactory / warning / probation. Recorded + audited.
//   Journey       license exam (date, result, number) and placement (hired /
//                 renting / self-employed, where) on the program enrolment.
//   Outcomes      completion, licensure and placement rates; applicants and
//                 enrolments by source.
//   Messages      one thread per student with the school; announcements to
//                 everyone, a program or a cohort. Emailed both ways.
//
// Attendance % = hours completed ÷ hours scheduled so far (the program's
// scheduled hours per week × weeks since starting). Rules vary by state and
// accreditor — the thresholds are the school's settings.

import { getAdminDb } from '@/lib/firebase-admin';
import { appendAudit } from '@/lib/academy-compliance';
import { programProgress } from '@/lib/academy-school';
import { resolveFromAddress } from '@/lib/notify';

export interface SapPolicy { checkpoints: number[]; minAttendancePct: number; minQuizAvg: number; minPracticalAvg: number }
export const DEFAULT_SAP: SapPolicy = { checkpoints: [150, 300, 450], minAttendancePct: 67, minQuizAvg: 70, minPracticalAvg: 3 };
const DAY = 86400000;

export async function sendEmail(to: string, subject: string, text: string) {
  if (!process.env.RESEND_API_KEY || !to) return false;
  try { const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: resolveFromAddress(), to, subject, text }) }); return r.ok; } catch { return false; }
}

/** Everything the risk score and SAP need about one student. */
async function signals(tenantId: string, e: any, p: any) {
  const db = getAdminDb();
  const since14 = new Date(Date.now() - 14 * DAY).toISOString();
  const [courseEnr, att, plan, checks, sess] = await Promise.all([
    db.collection(`tenants/${tenantId}/enrollments`).where('studentId', '==', e.studentId).limit(100).get(),
    db.collection(`tenants/${tenantId}/attendance`).where('studentId', '==', e.studentId).limit(5000).get(),
    db.doc(`tenants/${tenantId}/tuitionPlans/${e.programId}_${e.studentId}`).get(),
    db.collection(`tenants/${tenantId}/clinicCheckoffs`).where('studentId', '==', e.studentId).limit(2000).get(),
    db.collection(`tenants/${tenantId}/learningSessions`).where('studentId', '==', e.studentId).limit(2000).get().catch(() => null),
  ]);
  const ce = courseEnr.docs.map((d: any) => d.data() as any).filter((x: any) => !p.courseIds?.length || p.courseIds.includes(x.courseId));
  const lastOnline = ce.map((x: any) => x.lastActiveAt).filter(Boolean).sort().pop() || null;
  const quizBests = ce.flatMap((x: any) => Object.values(x.quiz || {}).map((q: any) => q.best)).filter((v: any) => typeof v === 'number');
  const punches = att.docs.map((d: any) => d.data() as any);
  const lastIn = punches.map((x: any) => x.clockInAt).filter(Boolean).sort().pop() || null;
  const flagged14 = punches.filter((x: any) => x.status === 'flagged' && String(x.clockInAt) >= since14).length;
  const pr = checks.docs.map((d: any) => (d.data() as any).avg).filter((v: any) => typeof v === 'number');
  const s14 = (sess?.docs || []).map((d: any) => d.data() as any).filter((x: any) => String(x.startedAt) >= since14);
  const issued = s14.reduce((n: number, s: any) => n + (s.checksIssued || 0), 0), missed = s14.reduce((n: number, s: any) => n + (s.checksMissed || 0), 0);
  const prog = await programProgress(tenantId, `${e.programId}_${e.studentId}`);
  const start = new Date(e.startDate || e.createdAt || Date.now()).getTime();
  const weeks = Math.max(0, (Date.now() - start) / (7 * DAY));
  const scheduled = p.scheduledHoursPerWeek ? weeks * p.scheduledHoursPerWeek : null;
  const hours = prog?.hours?.total || 0;
  return {
    lastOnline, lastIn, flagged14, quizAvg: quizBests.length ? Math.round(quizBests.reduce((a: number, b: number) => a + b, 0) / quizBests.length) : null,
    practicalAvg: pr.length ? Math.round((pr.reduce((a: number, b: number) => a + b, 0) / pr.length) * 10) / 10 : null,
    missedPct: issued ? Math.round((missed / issued) * 100) : null, tuition: (plan.data() as any) || null, hours, scheduled,
    attendancePct: scheduled && scheduled > 1 ? Math.min(100, Math.round((hours / scheduled) * 100)) : null,
    requirementsPct: prog?.requirementsPct ?? null, weeks, prog,
  };
}

export async function computeRisk(tenantId: string, e: any, p: any) {
  const s = await signals(tenantId, e, p);
  const sap: SapPolicy = { ...DEFAULT_SAP, ...(p.sap || {}) };
  const reasons: { text: string; points: number }[] = [];
  const days = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null);
  const add = (cond: boolean, points: number, text: string) => { if (cond) reasons.push({ text, points }); };
  const started = s.weeks >= 1;
  const dOn = days(s.lastOnline), dIn = days(s.lastIn);
  add(started && !!p.courseIds?.length && (dOn == null || dOn >= 10), 20, dOn == null ? 'Hasn’t started online learning' : `No online learning for ${dOn} days`);
  add(started && !!p.requiredInPersonHours && (dIn == null || dIn >= 7), 25, dIn == null ? 'Hasn’t clocked in yet' : `No clock-in for ${dIn} days`);
  add(s.attendancePct != null && s.attendancePct < sap.minAttendancePct, 20, `Attendance ${s.attendancePct}% (minimum ${sap.minAttendancePct}%)`);
  add(s.tuition?.status === 'past_due', 20, `Tuition payment failed${s.tuition?.failures > 1 ? ` ${s.tuition.failures} times` : ''}`);
  add(s.quizAvg != null && s.quizAvg < sap.minQuizAvg, 10, `Quiz average ${s.quizAvg}% (minimum ${sap.minQuizAvg}%)`);
  if (p.totalHours && p.scheduledHoursPerWeek && s.requirementsPct != null) {
    const expected = Math.min(100, Math.round((s.weeks / (p.totalHours / p.scheduledHoursPerWeek)) * 100));
    add(expected - s.requirementsPct >= 20, 15, `Behind on required services (${s.requirementsPct}% done, ~${expected}% expected by now)`);
  }
  add(s.flagged14 > 0, 10, `${s.flagged14} flagged attendance record${s.flagged14 === 1 ? '' : 's'} in the last 2 weeks`);
  add(s.missedPct != null && s.missedPct >= 30, 10, `Missed ${s.missedPct}% of attention checks lately`);
  const score = Math.min(100, reasons.reduce((n, r) => n + r.points, 0));
  return { score, level: score >= 50 ? 'high' : score >= 25 ? 'watch' : 'ok', reasons: reasons.sort((a, b) => b.points - a.points).map((r) => r.text), at: new Date().toISOString(), signals: { attendancePct: s.attendancePct, quizAvg: s.quizAvg, practicalAvg: s.practicalAvg, hours: s.hours, requirementsPct: s.requirementsPct } };
}

/** Evaluate any SAP checkpoints the student has reached and not yet had. */
export async function evaluateSap(tenantId: string, ref: any, e: any, p: any, by = 'system') {
  const sap: SapPolicy = { ...DEFAULT_SAP, ...(p.sap || {}) };
  const s = await signals(tenantId, e, p);
  const done = new Set((e.sap || []).map((x: any) => x.checkpoint));
  const out: any[] = [];
  let prev = (e.sap || []).slice(-1)[0]?.result || 'satisfactory';
  for (const cp of [...sap.checkpoints].sort((a, b) => a - b)) {
    if (done.has(cp) || s.hours < cp) continue;
    const fails: string[] = [];
    if (s.attendancePct != null && s.attendancePct < sap.minAttendancePct) fails.push(`attendance ${s.attendancePct}% < ${sap.minAttendancePct}%`);
    if (s.quizAvg != null && s.quizAvg < sap.minQuizAvg) fails.push(`quiz average ${s.quizAvg}% < ${sap.minQuizAvg}%`);
    if (s.practicalAvg != null && s.practicalAvg < sap.minPracticalAvg) fails.push(`practical average ${s.practicalAvg} < ${sap.minPracticalAvg}`);
    const result = !fails.length ? 'satisfactory' : prev === 'satisfactory' ? 'warning' : 'probation';
    const ev = { checkpoint: cp, at: new Date().toISOString(), hours: s.hours, attendancePct: s.attendancePct, quizAvg: s.quizAvg, practicalAvg: s.practicalAvg, result, fails, by };
    out.push(ev); prev = result;
    await appendAudit(tenantId, { type: 'sap.evaluated', studentId: e.studentId, by, summary: `${e.name} — ${cp}-hour progress check: ${result.toUpperCase()}${fails.length ? ` (${fails.join('; ')})` : ''}`, data: ev });
  }
  if (out.length) await ref.set({ sap: [...(e.sap || []), ...out] }, { merge: true });
  return out;
}

/** Nightly: risk for every active student; SAP checkpoints; Monday digest to the school. */
export async function sweepJourney() {
  const db = getAdminDb();
  const tenants = await db.collection('tenants').select('modules', 'academy', 'name', 'userId').limit(1000).get();
  for (const t of tenants.docs) {
    const tv = t.data() as any; if (tv.modules?.academy === false || tv.academy?.mode !== 'school') continue;
    const [enr, progs] = await Promise.all([db.collection(`tenants/${t.id}/programEnrollments`).where('status', '==', 'active').limit(2000).get(), db.collection(`tenants/${t.id}/programs`).limit(100).get()]);
    const P = new Map(progs.docs.map((d: any) => [d.id, d.data() as any]));
    const high: string[] = [];
    for (const d of enr.docs) {
      const e = d.data() as any; const p = P.get(e.programId) || {};
      try {
        const r = await computeRisk(t.id, e, p);
        await d.ref.set({ risk: r }, { merge: true });
        if (r.level === 'high') high.push(`• ${e.name}: ${r.reasons.slice(0, 2).join('; ')}`);
        const evs = await evaluateSap(t.id, d.ref, e, p);
        for (const ev of evs.filter((x) => x.result !== 'satisfactory')) high.push(`• ${e.name}: ${ev.checkpoint}-hour progress check — ${ev.result}`);
      } catch { /* next student */ }
    }
    if (new Date().getUTCDay() === 1 && high.length && tv.userId) {
      try {
        const { getAdminAuth } = await import('@/lib/firebase-admin');
        const owner = (await getAdminAuth().getUser(tv.userId)).email || '';
        await sendEmail(owner, `Students who need attention — ${tv.name || 'your academy'}`, `Good morning,\n\nThese students need a check-in this week:\n\n${high.join('\n')}\n\nSee everyone in Academy → Students.\n\n— ClarityFlow`);
      } catch { /* no owner email */ }
    }
  }
}

/** Completion, licensure and placement rates; leads by source. */
export async function outcomes(tenantId: string, programId?: string | null) {
  const db = getAdminDb();
  const [enr, adm] = await Promise.all([db.collection(`tenants/${tenantId}/programEnrollments`).limit(5000).get(), db.collection(`tenants/${tenantId}/admissions`).limit(5000).get()]);
  const E = enr.docs.map((d: any) => d.data() as any).filter((e: any) => !programId || e.programId === programId);
  const graduated = E.filter((e: any) => e.status === 'graduated');
  const withdrawn = E.filter((e: any) => e.status === 'withdrawn');
  const tookExam = graduated.filter((e: any) => e.journey?.license?.result);
  const passed = graduated.filter((e: any) => e.journey?.license?.result === 'passed');
  const placed = graduated.filter((e: any) => ['hired', 'renting', 'self_employed'].includes(e.journey?.placement?.status));
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  const bySource: Record<string, { applicants: number; enrolled: number }> = {};
  for (const d of adm.docs) { const a = d.data() as any; if (programId && a.programId !== programId) continue; const k = a.source || 'unknown'; const r = bySource[k] = bySource[k] || { applicants: 0, enrolled: 0 }; r.applicants++; if (a.stage === 'enrolled') r.enrolled++; }
  return {
    counts: { active: E.filter((e: any) => e.status === 'active').length, loa: E.filter((e: any) => e.status === 'loa').length, graduated: graduated.length, withdrawn: withdrawn.length, tookExam: tookExam.length, licensed: passed.length, placed: placed.length },
    rates: { completion: pct(graduated.length, graduated.length + withdrawn.length), licensure: pct(passed.length, tookExam.length), placement: pct(placed.length, graduated.length) },
    placementBreakdown: { hired: placed.filter((e: any) => e.journey.placement.status === 'hired').length, renting: placed.filter((e: any) => e.journey.placement.status === 'renting').length, self_employed: placed.filter((e: any) => e.journey.placement.status === 'self_employed').length },
    bySource: Object.entries(bySource).map(([source, v]) => ({ source, ...v, conversion: pct(v.enrolled, v.applicants) })).sort((a, b) => b.applicants - a.applicants),
  };
}

// ── Messages & announcements ─────────────────────────────────────────────
export async function postMessage(opts: { tenantId: string; studentId: string; from: 'student' | 'school'; by: string; text: string; studentEmail?: string | null; studentName?: string | null }) {
  const db = getAdminDb();
  const text = String(opts.text || '').trim().slice(0, 4000);
  if (!text) throw new Error('Write a message first.');
  const tRef = db.doc(`tenants/${opts.tenantId}/academyThreads/${opts.studentId}`);
  const cur = ((await tRef.get()).data() as any) || {};
  const at = new Date().toISOString();
  await tRef.collection('messages').add({ from: opts.from, by: opts.by, text, at });
  await tRef.set({ studentId: opts.studentId, email: opts.studentEmail || cur.email || null, name: opts.studentName || cur.name || null, lastAt: at, lastText: text.slice(0, 140), lastFrom: opts.from,
    unreadSchool: opts.from === 'student' ? (cur.unreadSchool || 0) + 1 : 0, unreadStudent: opts.from === 'school' ? (cur.unreadStudent || 0) + 1 : cur.unreadStudent || 0 }, { merge: true });
  return { at };
}
