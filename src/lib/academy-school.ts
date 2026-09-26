// src/lib/academy-school.ts
//
// A LICENSED SCHOOL ON CLARITYFLOW — programs, students and the student salon.
//
// (Selling online classes needs none of this: the Academy works in "Online
// courses" mode on its own. A school switches to "Licensed school" mode.)
//
//   programs/{id}                   e.g. "Nail Technology — 600 hours": hours
//                                   required, SERVICE requirements (e.g. 25
//                                   pedicures, mapped to clinic services),
//                                   a check-off rubric, linked theory courses
//   programEnrollments/{pid}_{sid}  one student in one program: status, start
//                                   date, their clinic provider id, service counts
//   clinicCheckoffs/{appointmentId} an instructor's sign-off of one clinic
//                                   service: rubric scores, photos, pass/redo
//
// Students become BOOKABLE PROVIDERS in the student salon: a staff record
// marked isStudent (never billed as team, never paid commission), added to
// their program's clinic services, using the school's opening hours. The
// booking page, planner and checkout then work exactly as they do today.
// A clinic service can't be marked completed until an instructor has signed
// it off (enforced by the database rules and by checkout); it only COUNTS
// toward the student's requirements when it passes.

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { upsertStudent, enroll } from '@/lib/academy';
import { appendAudit } from '@/lib/academy-compliance';

export interface Requirement { key: string; label: string; count: number; serviceIds: string[] }
export interface Rubric { criteria: { label: string }[]; passAvg: number }
export const DEFAULT_RUBRIC: Rubric = { criteria: [{ label: 'Sanitation & safety' }, { label: 'Technique' }, { label: 'Finish & shape' }, { label: 'Client care' }, { label: 'Time management' }], passAvg: 3 };
export const keyOf = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'service';

/** Enrol a student in a program: record, clinic provider, theory courses. */
export async function enrollInProgram(opts: { tenantId: string; programId: string; email: string; name: string; startDate?: string | null; by: string }) {
  const db = getAdminDb();
  const p = ((await db.doc(`tenants/${opts.tenantId}/programs/${opts.programId}`).get()).data() as any) || null;
  if (!p) throw new Error('Program not found.');
  const studentId = await upsertStudent(opts.tenantId, opts.email, opts.name);
  const ref = db.doc(`tenants/${opts.tenantId}/programEnrollments/${opts.programId}_${studentId}`);
  const cur = ((await ref.get()).data() as any) || null;
  if (cur && cur.status === 'active') return { studentId, staffId: cur.staffId, already: true };

  // A clinic provider record for the student (reused if they return).
  let staffId: string = cur?.staffId || '';
  if (!staffId) {
    const sRef = db.collection(`tenants/${opts.tenantId}/staff`).doc();
    staffId = sRef.id;
    await sRef.set({ id: staffId, tenantId: opts.tenantId, name: opts.name, email: opts.email.trim().toLowerCase(), role: 'staff', isStudent: true, studentId, programId: opts.programId,
      tipPolicy: p.tipPolicy || 'school', employmentModel: 'employee', decisionAuthority: 'none', payStructure: 'hourly', hourlyRate: 0, commissionRate: 0, retailCommissionRate: 0, avatarUrl: '', status: 'active',
      bio: `Student — ${p.name}`, createdAt: new Date().toISOString() });
  } else {
    await db.doc(`tenants/${opts.tenantId}/staff/${staffId}`).set({ status: 'active', tipPolicy: p.tipPolicy || 'school' }, { merge: true });
  }
  await ref.set({ id: ref.id, programId: opts.programId, studentId, staffId, email: opts.email.trim().toLowerCase(), name: opts.name, status: 'active',
    startDate: opts.startDate || new Date().toISOString().slice(0, 10), serviceCounts: cur?.serviceCounts || {}, checkoffs: cur?.checkoffs || 0,
    createdAt: cur?.createdAt || new Date().toISOString(), statusHistory: [...(cur?.statusHistory || []), { status: 'active', at: new Date().toISOString(), by: opts.by }] }, { merge: true });
  await syncStudentServices(opts.tenantId, p, { ...(cur || {}), staffId, status: 'active', evaluations: cur?.evaluations || {} });
  await dueBoardForm(opts.tenantId, p, { studentId, name: opts.name }, 'enrollment', ref.id);
  for (const cid of p.courseIds || []) { try { await enroll({ tenantId: opts.tenantId, courseId: cid, email: opts.email, name: opts.name, paidCents: 0 }); } catch { /* course may be gone */ } }
  await appendAudit(opts.tenantId, { type: 'program.enrolled', studentId, by: opts.by, summary: `${opts.name} enrolled in ${p.name}${opts.startDate ? ` (starts ${opts.startDate})` : ''}`, data: { programId: opts.programId, staffId } });
  return { studentId, staffId, already: false };
}

export const allServiceIds = (p: any): string[] => Array.from(new Set((p.requirements || []).flatMap((r: Requirement) => r.serviceIds || [])));

/**
 * Which clinic services this student may be booked for. Programs with state
 * evaluations (e.g. North Carolina): nothing until every infection-control /
 * blood-exposure evaluation is passed; then each service whose required
 * evaluation (if any) is passed. Programs without evaluations: everything.
 */
export function allowedServiceIds(p: any, e: any): string[] {
  const evals: any[] = p.evaluations || [];
  if (!evals.length) return allServiceIds(p);
  const passed = (key: string) => !!e?.evaluations?.[key]?.passed;
  if (!evals.filter((x) => x.infection).every((x) => passed(x.key))) return [];
  const out = new Set<string>();
  for (const r of (p.requirements || []) as Requirement[]) {
    const gatedBy = evals.filter((x) => (x.gates || []).includes(r.key));
    if (gatedBy.every((x) => passed(x.key))) (r.serviceIds || []).forEach((id) => out.add(id));
  }
  return [...out];
}

/** Put the student on exactly the services they're cleared for (and off the rest). */
export async function syncStudentServices(tenantId: string, p: any, e: any) {
  if (!e?.staffId) return;
  const allowed = e.status === 'active' ? allowedServiceIds(p, e) : [];
  const all = allServiceIds(p);
  await setClinicServices(tenantId, e.staffId, allowed, true);
  await setClinicServices(tenantId, e.staffId, all.filter((x) => !allowed.includes(x)), false);
}

/** Record a mannequin / infection-control evaluation — every attempt kept. */
export async function recordEvaluation(opts: { tenantId: string; enrollmentId: string; key: string; score: number; notes?: string; by: string }) {
  const db = getAdminDb();
  const ref = db.doc(`tenants/${opts.tenantId}/programEnrollments/${opts.enrollmentId}`);
  const e = ((await ref.get()).data() as any) || null;
  if (!e) throw new Error('Student not found.');
  const p = ((await db.doc(`tenants/${opts.tenantId}/programs/${e.programId}`).get()).data() as any) || {};
  const ev = (p.evaluations || []).find((x: any) => x.key === opts.key);
  if (!ev) throw new Error('Unknown evaluation.');
  // NC order: infection-control evaluations are taken in sequence.
  if (ev.infection) { const seq = (p.evaluations || []).filter((x: any) => x.infection); const i = seq.findIndex((x: any) => x.key === opts.key); const before = seq.slice(0, i).find((x: any) => !e.evaluations?.[x.key]?.passed); if (before) throw new Error(`Pass “${before.label}” first — these are taken in order.`); }
  const score = Math.max(0, Math.min(100, Math.round(Number(opts.score) || 0)));
  const passed = score >= (ev.passPct || 70);
  const at = new Date().toISOString();
  const prev = e.evaluations?.[opts.key] || { attempts: [] };
  const rec = { passed: prev.passed || passed, score: passed ? score : prev.score ?? score, at: passed ? at : prev.at || null, by: passed ? opts.by : prev.by || null, attempts: [...(prev.attempts || []), { at, score, passed, by: opts.by, notes: opts.notes || null }] };
  await ref.set({ evaluations: { [opts.key]: rec } }, { merge: true });
  await appendAudit(opts.tenantId, { type: passed ? 'evaluation.passed' : 'evaluation.failed', studentId: e.studentId, by: opts.by, summary: `${e.name} — ${ev.label}: ${score}% ${passed ? 'PASSED' : `not passed (needs ${ev.passPct}%)`}${opts.notes ? ` · ${opts.notes}` : ''}`, data: { enrollmentId: opts.enrollmentId, key: opts.key, score } });
  await syncStudentServices(opts.tenantId, p, { ...e, evaluations: { ...(e.evaluations || {}), [opts.key]: rec } });
  return { passed, score };
}

/** Board forms owed (e.g. NC enrolment within 15 days) — created automatically. */
export async function dueBoardForm(tenantId: string, p: any, e: any, trigger: string, enrollmentId: string) {
  const f = (p.boardForms || []).find((x: any) => x.trigger === trigger);
  if (!f) return;
  const ref = getAdminDb().doc(`tenants/${tenantId}/boardForms/${enrollmentId}_${f.key}`);
  if ((await ref.get()).exists) return;
  const due = new Date(); due.setDate(due.getDate() + (f.dueDays || 30));
  await ref.set({ id: ref.id, enrollmentId, studentId: e.studentId, name: e.name, form: f.key, label: f.label, trigger, status: 'due', createdAt: new Date().toISOString(), dueAt: due.toISOString() });
}

/** Add or remove a student provider on the program's clinic services. */
export async function setClinicServices(tenantId: string, staffId: string, serviceIds: string[], on: boolean) {
  const db = getAdminDb();
  for (const sid of serviceIds) {
    try { await db.doc(`tenants/${tenantId}/services/${sid}`).set({ staffIds: on ? FieldValue.arrayUnion(staffId) : FieldValue.arrayRemove(staffId) }, { merge: true }); } catch { /* service removed */ }
  }
}

/** Status changes (leave of absence, withdrawn, graduated, back to active) — kept as history. */
export async function setProgramStatus(opts: { tenantId: string; enrollmentId: string; status: 'active' | 'loa' | 'withdrawn' | 'graduated'; reason?: string; by: string }) {
  const db = getAdminDb();
  const ref = db.doc(`tenants/${opts.tenantId}/programEnrollments/${opts.enrollmentId}`);
  const e = ((await ref.get()).data() as any) || null;
  if (!e) throw new Error('Not found.');
  const p = ((await db.doc(`tenants/${opts.tenantId}/programs/${e.programId}`).get()).data() as any) || {};
  const at = new Date().toISOString();
  await ref.set({ status: opts.status, statusHistory: [...(e.statusHistory || []), { status: opts.status, at, by: opts.by, reason: opts.reason || null }], ...(opts.status === 'graduated' ? { graduatedAt: at } : {}), ...(opts.status === 'withdrawn' ? { withdrawnAt: at } : {}) }, { merge: true });
  // Only active students take clinic bookings — and only what they're cleared for.
  await syncStudentServices(opts.tenantId, p, { ...e, status: opts.status });
  if (opts.status === 'withdrawn' || opts.status === 'graduated') await dueBoardForm(opts.tenantId, p, e, opts.status === 'withdrawn' ? 'withdrawal' : 'graduation', opts.enrollmentId);
  await db.doc(`tenants/${opts.tenantId}/staff/${e.staffId}`).set({ status: opts.status === 'active' ? 'active' : 'archived' }, { merge: true });
  await appendAudit(opts.tenantId, { type: 'program.status', studentId: e.studentId, by: opts.by, summary: `${e.name}: ${e.status} → ${opts.status}${opts.reason ? ` (${opts.reason})` : ''}`, data: { enrollmentId: opts.enrollmentId } });
}

/** Everything about one student's program progress. */
export async function programProgress(tenantId: string, enrollmentId: string) {
  const db = getAdminDb();
  const e = ((await db.doc(`tenants/${tenantId}/programEnrollments/${enrollmentId}`).get()).data() as any) || null;
  if (!e) return null;
  const p = ((await db.doc(`tenants/${tenantId}/programs/${e.programId}`).get()).data() as any) || {};
  const [courseEnr, att, live] = await Promise.all([
    db.collection(`tenants/${tenantId}/enrollments`).where('studentId', '==', e.studentId).limit(200).get(),
    db.collection(`tenants/${tenantId}/attendance`).where('studentId', '==', e.studentId).limit(5000).get(),
    db.collection(`tenants/${tenantId}/liveAttendance`).where('studentId', '==', e.studentId).limit(2000).get(),
  ]);
  const liveMin = live.docs.map((d: any) => d.data() as any).filter((x: any) => !x.programId || x.programId === e.programId).reduce((n: number, x: any) => n + (x.minutes || 0), 0);
  const L = p.limits || null;
  const onlineSec = courseEnr.docs.map((d: any) => d.data() as any).filter((x: any) => !p.courseIds?.length || p.courseIds.includes(x.courseId)).reduce((n: number, x: any) => n + (x.onlineSec || 0), 0);
  // In-school minutes; with state limits, capped per day and per week (online is additional).
  const counted = att.docs.map((d: any) => d.data() as any).filter((x: any) => ['closed', 'approved'].includes(x.status));
  let inMin = counted.reduce((n: number, x: any) => n + (x.minutes || 0), 0);
  const notes: string[] = [];
  if (L) {
    const byDay: Record<string, number> = {};
    for (const x of counted) { const dk = String(x.clockInAt).slice(0, 10); byDay[dk] = (byDay[dk] || 0) + (x.minutes || 0); }
    let overDay = 0; const byWeek: Record<string, number> = {};
    for (const [dk, m] of Object.entries(byDay)) { const c = Math.min(m, L.dailyCapHours * 60); overDay += m - c; const d = new Date(dk + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const wk = d.toISOString().slice(0, 10); byWeek[wk] = (byWeek[wk] || 0) + c; }
    let overWeek = 0, total = 0;
    for (const m of Object.values(byWeek)) { const c = Math.min(m, L.weeklyCapHours * 60); overWeek += m - c; total += c; }
    inMin = total;
    if (overDay > 0) notes.push(`${(overDay / 60).toFixed(2)} h over the ${L.dailyCapHours}-hour daily limit not counted`);
    if (overWeek > 0) notes.push(`${(overWeek / 60).toFixed(2)} h over the ${L.weeklyCapHours}-hour weekly limit not counted`);
  }
  const reqs = (p.requirements || []).map((r: Requirement) => ({ key: r.key, label: r.label, required: r.count, done: e.serviceCounts?.[r.key] || 0 }));
  const q = (h: number) => (L?.quarterHour ? Math.floor(h * 4) / 4 : Math.round(h * 10) / 10);   // NC: no more than the nearest quarter hour
  let onlineRaw = onlineSec / 3600 + liveMin / 60;
  if (L && p.totalHours) { const cap = (p.totalHours * L.onlineMaxPct) / 100; if (onlineRaw > cap) { notes.push(`${(onlineRaw - cap).toFixed(2)} h of online learning over the ${L.onlineMaxPct}% limit (${cap} h) not counted`); onlineRaw = cap; } }
  const onlineH = q(onlineRaw), inH = q(inMin / 60);
  const hoursDone = onlineH + inH;
  return {
    enrollment: e, program: { id: e.programId, name: p.name, totalHours: p.totalHours || null, requiredOnlineHours: p.requiredOnlineHours || null, requiredInPersonHours: p.requiredInPersonHours || null },
    hours: { notes, online: onlineH, live: Math.round((liveMin / 60) * 10) / 10, inPerson: inH, total: L?.quarterHour ? hoursDone : Math.round(hoursDone * 10) / 10, pct: p.totalHours ? Math.min(100, Math.round((hoursDone / p.totalHours) * 100)) : null },
    requirements: reqs, requirementsPct: reqs.length ? Math.round((reqs.reduce((n: number, r: any) => n + Math.min(r.done, r.required), 0) / Math.max(1, reqs.reduce((n: number, r: any) => n + r.required, 0))) * 100) : null,
  };
}
