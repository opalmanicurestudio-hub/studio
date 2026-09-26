// src/lib/academy-assign.ts
//
// ASSIGNING WORK — tenants/{t}/assigned/{id}
//   what      one or more lessons in a course (quiz, game, assignment, reading…)
//   who       audience.type: 'course' (everyone enrolled) · 'program' · 'cohort'
//             · 'group' (tenants/{t}/studentGroups) · 'students' (chosen people)
//             — worked out LIVE per student, so later joiners get it too
//   when      dueAt (optional) · note
//   review    condition { lessonId, below } — only for students whose best quiz
//             score on that lesson is under the mark (automatic re-teaching)
// Done = the student has completed every assigned lesson (no separate tick to fake).
// Students only ever receive work from courses they're enrolled in.

import { getAdminDb } from '@/lib/firebase-admin';

export interface Assignment { id: string; title: string; courseId: string; lessonIds: string[]; audience: { type: string; ids: string[] }; dueAt: string | null; note: string | null; condition: { lessonId: string; below: number } | null; createdAt: string; createdBy: string; remindedAt?: string | null }

/** Everything that decides which assignments a student gets. */
export async function studentContext(tenantId: string, studentId: string) {
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const st = ((await db.doc(`${T}/students/${studentId}`).get()).data() as any) || {};
  const [enr, pe, adm, groups] = await Promise.all([
    db.collection(`${T}/enrollments`).where('studentId', '==', studentId).limit(200).get(),
    db.collection(`${T}/programEnrollments`).where('studentId', '==', studentId).limit(20).get(),
    st.email ? db.collection(`${T}/admissions`).where('email', '==', st.email).limit(10).get() : Promise.resolve(null),
    db.collection(`${T}/studentGroups`).where('studentIds', 'array-contains', studentId).limit(100).get(),
  ]);
  const enrollments = new Map<string, any>(enr.docs.map((d: any) => [(d.data() as any).courseId, d.data()]));
  return {
    student: st, enrollments,
    programIds: new Set(pe.docs.map((d: any) => (d.data() as any).programId)),
    cohortIds: new Set((adm?.docs || []).map((d: any) => (d.data() as any).cohortId).filter(Boolean)),
    groupIds: new Set(groups.docs.map((d: any) => d.id)),
  };
}

export function appliesTo(a: Assignment, ctx: Awaited<ReturnType<typeof studentContext>>, studentId: string) {
  const e = ctx.enrollments.get(a.courseId); if (!e) return false;
  const ids = a.audience?.ids || [];
  const t = a.audience?.type;
  const inAudience = t === 'course' ? true : t === 'program' ? ids.some((x) => ctx.programIds.has(x)) : t === 'cohort' ? ids.some((x) => ctx.cohortIds.has(x)) : t === 'group' ? ids.some((x) => ctx.groupIds.has(x)) : t === 'students' ? ids.includes(studentId) : false;
  if (!inAudience) return false;
  if (a.condition?.lessonId) { const q = e.quiz?.[a.condition.lessonId]; if (!q || !(q.attempts || []).length) return false; if ((q.best ?? 0) >= a.condition.below) return false; }
  return true;
}
export const doneBy = (a: Assignment, e: any) => a.lessonIds.length > 0 && a.lessonIds.every((id) => !!e?.progress?.[id]);

/** A student's to-do list (for the portal). */
export async function todoFor(tenantId: string, studentId: string) {
  const db = getAdminDb();
  const ctx = await studentContext(tenantId, studentId);
  const courseIds = [...ctx.enrollments.keys()];
  if (!courseIds.length) return [];
  const out: any[] = [];
  for (let i = 0; i < courseIds.length; i += 10) {
    const q = await db.collection(`tenants/${tenantId}/assigned`).where('courseId', 'in', courseIds.slice(i, i + 10)).limit(500).get();
    for (const d of q.docs) {
      const a = { id: d.id, ...(d.data() as any) } as Assignment;
      if (!appliesTo(a, ctx, studentId)) continue;
      const e = ctx.enrollments.get(a.courseId);
      const left = a.lessonIds.filter((id) => !e?.progress?.[id]);
      const c = ((await db.doc(`tenants/${tenantId}/courses/${a.courseId}`).get()).data() as any) || {};
      out.push({ id: a.id, title: a.title, note: a.note, dueAt: a.dueAt, review: !!a.condition, courseTitle: c.title, courseSlug: c.slug, nextLessonId: left[0] || a.lessonIds[0],
        done: left.length === 0, total: a.lessonIds.length, finished: a.lessonIds.length - left.length, overdue: !!a.dueAt && left.length > 0 && new Date(a.dueAt).getTime() < Date.now() });
    }
  }
  return out.sort((x, y) => Number(x.done) - Number(y.done) || String(x.dueAt || '9').localeCompare(String(y.dueAt || '9')));
}

/** Who an assignment is for, with their progress (instructor view). */
export async function progressFor(tenantId: string, a: Assignment) {
  const db = getAdminDb();
  const enr = await db.collection(`tenants/${tenantId}/enrollments`).where('courseId', '==', a.courseId).limit(2000).get();
  const rows: any[] = [];
  for (const d of enr.docs) {
    const e = d.data() as any; if (!e.studentId) continue;
    const ctx = await studentContext(tenantId, e.studentId);
    if (!appliesTo(a, ctx, e.studentId)) continue;
    rows.push({ studentId: e.studentId, name: ctx.student.name || e.email, email: e.email, language: ctx.student.language || 'en', done: doneBy(a, e), finished: a.lessonIds.filter((id) => e.progress?.[id]).length });
  }
  return rows.sort((x, y) => Number(x.done) - Number(y.done) || String(x.name).localeCompare(String(y.name)));
}

/** Email students who haven't finished — in each student's own language. */
export async function nudge(tenantId: string, a: Assignment, onlyIds?: string[]) {
  const db = getAdminDb();
  const [t, c] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`tenants/${tenantId}/courses/${a.courseId}`).get()]);
  const school = (t.data() as any)?.name || 'your academy'; const course = (c.data() as any) || {};
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://clarityflow.app';
  const { sendEmail } = await import('@/lib/academy-journey');
  const { translateTexts } = await import('@/lib/translate');
  let sent = 0;
  for (const r of await progressFor(tenantId, a)) {
    if (r.done || (onlyIds && !onlyIds.includes(r.studentId))) continue;
    let subject = `Reminder: ${a.title}${a.dueAt ? ` — due ${new Date(a.dueAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}`;
    let body = `Hi ${String(r.name || '').split(' ')[0] || 'there'},\n\n“${a.title}” in ${course.title || 'your course'} is waiting for you (${r.finished} of ${a.lessonIds.length} done).${a.note ? `\n\n${a.note}` : ''}\n\n${origin}/learn/${tenantId}/my\n\n— ${school}`;
    if (r.language && r.language !== 'en') { try { [subject, body] = await translateTexts(tenantId, [subject, body], r.language); } catch { /* English */ } }
    try { await sendEmail(r.email, subject, body); sent++; } catch { /* skip */ }
  }
  return sent;
}

/** Daily: remind about work due within the next day (once per assignment). */
export async function remindDueSoon() {
  const db = getAdminDb(); let reminded = 0;
  const tenants = await db.collection('tenants').select('name').limit(2000).get();
  const soon = new Date(Date.now() + 36 * 3600000).toISOString(), now = new Date().toISOString();
  for (const t of tenants.docs) {
    const q = await db.collection(`tenants/${t.id}/assigned`).where('dueAt', '>=', now).where('dueAt', '<=', soon).limit(200).get().catch(() => null);
    for (const d of q?.docs || []) {
      const a = { id: d.id, ...(d.data() as any) } as Assignment; if (a.remindedAt) continue;
      await d.ref.set({ remindedAt: now }, { merge: true });
      reminded += await nudge(t.id, a).catch(() => 0);
    }
  }
  return reminded;
}
