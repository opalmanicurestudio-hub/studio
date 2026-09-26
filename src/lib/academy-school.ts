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
  await setClinicServices(opts.tenantId, staffId, allServiceIds(p), true);

  await ref.set({ id: ref.id, programId: opts.programId, studentId, staffId, email: opts.email.trim().toLowerCase(), name: opts.name, status: 'active',
    startDate: opts.startDate || new Date().toISOString().slice(0, 10), serviceCounts: cur?.serviceCounts || {}, checkoffs: cur?.checkoffs || 0,
    createdAt: cur?.createdAt || new Date().toISOString(), statusHistory: [...(cur?.statusHistory || []), { status: 'active', at: new Date().toISOString(), by: opts.by }] }, { merge: true });
  for (const cid of p.courseIds || []) { try { await enroll({ tenantId: opts.tenantId, courseId: cid, email: opts.email, name: opts.name, paidCents: 0 }); } catch { /* course may be gone */ } }
  await appendAudit(opts.tenantId, { type: 'program.enrolled', studentId, by: opts.by, summary: `${opts.name} enrolled in ${p.name}${opts.startDate ? ` (starts ${opts.startDate})` : ''}`, data: { programId: opts.programId, staffId } });
  return { studentId, staffId, already: false };
}

export const allServiceIds = (p: any): string[] => Array.from(new Set((p.requirements || []).flatMap((r: Requirement) => r.serviceIds || [])));

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
  // Only active students take clinic bookings.
  await setClinicServices(opts.tenantId, e.staffId, allServiceIds(p), opts.status === 'active');
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
  const onlineSec = courseEnr.docs.map((d: any) => d.data() as any).filter((x: any) => !p.courseIds?.length || p.courseIds.includes(x.courseId)).reduce((n: number, x: any) => n + (x.onlineSec || 0), 0);
  const inMin = att.docs.map((d: any) => d.data() as any).filter((x: any) => ['closed', 'approved'].includes(x.status)).reduce((n: number, x: any) => n + (x.minutes || 0), 0);
  const reqs = (p.requirements || []).map((r: Requirement) => ({ key: r.key, label: r.label, required: r.count, done: e.serviceCounts?.[r.key] || 0 }));
  const onlineH = Math.round((onlineSec / 3600 + liveMin / 60) * 10) / 10, inH = Math.round((inMin / 60) * 10) / 10;
  const hoursDone = onlineH + inH;
  return {
    enrollment: e, program: { id: e.programId, name: p.name, totalHours: p.totalHours || null, requiredOnlineHours: p.requiredOnlineHours || null, requiredInPersonHours: p.requiredInPersonHours || null },
    hours: { online: onlineH, live: Math.round((liveMin / 60) * 10) / 10, inPerson: inH, total: Math.round(hoursDone * 10) / 10, pct: p.totalHours ? Math.min(100, Math.round((hoursDone / p.totalHours) * 100)) : null },
    requirements: reqs, requirementsPct: reqs.length ? Math.round((reqs.reduce((n: number, r: any) => n + Math.min(r.done, r.required), 0) / Math.max(1, reqs.reduce((n: number, r: any) => n + r.required, 0))) * 100) : null,
  };
}
