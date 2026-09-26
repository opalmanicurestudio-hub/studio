// src/lib/academy-live.ts
//
// LIVE CLASS MODE — for hybrid and in-person classes.
//   liveSessions/{id}                   title, 6-digit join code, status, the
//                                       current question, question history
//   liveSessions/{id}/participants/{sid} joined/last seen, credited seconds
//   liveSessions/{id}/answers/{qid_sid}  one answer per question per student
//   liveAttendance/{sessionId_sid}      written when the class ends: minutes
//                                       attended (counts as online hours)
//
// Students join on their own signed-in phone with the code or QR. Their
// screen checks in every few seconds; the SERVER credits time only while the
// class page is open and visible, at most 35s per check-in, only for gaps
// under 75s (a sleeping phone earns nothing).

import { randomInt } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { appendAudit } from '@/lib/academy-compliance';

export const newJoinCode = () => String(randomInt(100000, 999999));
const S = (t: string, id: string) => getAdminDb().doc(`tenants/${t}/liveSessions/${id}`);

export async function findLive(tenantId: string, code: string) {
  const s = await getAdminDb().collection(`tenants/${tenantId}/liveSessions`).where('code', '==', String(code || '').trim()).where('status', '==', 'live').limit(1).get();
  return s.empty ? null : { id: s.docs[0].id, ...(s.docs[0].data() as any) };
}

/** A student's check-in: credit time (server clock) and return what they should see. */
export async function studentBeat(tenantId: string, sessionId: string, student: { id: string; email: string; name: string | null }, visible: boolean) {
  const ref = S(tenantId, sessionId);
  const s = ((await ref.get()).data() as any) || null;
  if (!s) return null;
  const pRef = ref.collection('participants').doc(student.id);
  const p = ((await pRef.get()).data() as any) || null;
  const now = Date.now(); const iso = new Date(now).toISOString();
  if (s.status === 'live') {
    if (!p) await pRef.set({ studentId: student.id, email: student.email, name: student.name, joinedAt: iso, lastSeenAt: iso, lastCreditAt: iso, creditedSec: 0 });
    else {
      const gap = (now - new Date(p.lastCreditAt || p.lastSeenAt).getTime()) / 1000;
      const patch: any = { lastSeenAt: iso, leftAt: null };
      if (gap >= 20) { patch.lastCreditAt = iso; if (visible && gap <= 75) patch.creditedSec = (p.creditedSec || 0) + Math.min(gap, 35); }
      await pRef.set(patch, { merge: true });
    }
  }
  const q = s.current || null;
  let mine: number | null = null;
  if (q) { const a = ((await ref.collection('answers').doc(`${q.id}_${student.id}`).get()).data() as any) || null; mine = a ? a.choice : null; }
  return { status: s.status, title: s.title, question: q ? { id: q.id, q: q.q, options: q.options, open: q.open, reveal: q.reveal, correct: q.reveal ? q.correct ?? null : null } : null, mine, minutes: Math.floor(((p?.creditedSec) || 0) / 60) };
}

export async function studentAnswer(tenantId: string, sessionId: string, studentId: string, questionId: string, choice: number) {
  const ref = S(tenantId, sessionId);
  const s = ((await ref.get()).data() as any) || null;
  if (!s || s.status !== 'live' || !s.current || s.current.id !== questionId || !s.current.open) throw new Error('That question has closed.');
  if (!Number.isInteger(choice) || choice < 0 || choice >= s.current.options.length) throw new Error('Choose an answer.');
  await ref.collection('answers').doc(`${questionId}_${studentId}`).set({ questionId, studentId, choice, at: new Date().toISOString() });
}

/** Live results for the instructor's screen. */
export async function sessionState(tenantId: string, sessionId: string) {
  const ref = S(tenantId, sessionId);
  const s = ((await ref.get()).data() as any) || null;
  if (!s) return null;
  const [parts, answers] = await Promise.all([ref.collection('participants').limit(500).get(), s.current ? ref.collection('answers').where('questionId', '==', s.current.id).limit(500).get() : Promise.resolve(null)]);
  const now = Date.now();
  const people = parts.docs.map((d: any) => d.data() as any).map((p: any) => ({ name: p.name || p.email, email: p.email, here: now - new Date(p.lastSeenAt).getTime() < 45000, minutes: Math.floor((p.creditedSec || 0) / 60) }));
  const counts = s.current ? s.current.options.map((_: any, i: number) => answers!.docs.filter((d: any) => (d.data() as any).choice === i).length) : [];
  return { session: { id: sessionId, ...s }, people: people.sort((a: any, b: any) => Number(b.here) - Number(a.here) || String(a.name).localeCompare(String(b.name))), here: people.filter((p: any) => p.here).length, counts, answered: counts.reduce((n: number, x: number) => n + x, 0) };
}

/** End the class: freeze minutes, score answers, write attendance + audit. */
export async function endSession(tenantId: string, sessionId: string, by: string) {
  const db = getAdminDb(); const ref = S(tenantId, sessionId);
  const s = ((await ref.get()).data() as any) || null;
  if (!s) throw new Error('Not found.');
  if (s.status === 'ended') return { participants: s.summary?.participants || 0 };
  const at = new Date().toISOString();
  const [parts, answers] = await Promise.all([ref.collection('participants').limit(500).get(), ref.collection('answers').limit(10000).get()]);
  const correctBy: Record<string, { right: number; total: number }> = {};
  const qs = new Map<string, any>((s.questions || []).map((q: any) => [q.id, q]));
  for (const d of answers.docs) { const a = d.data() as any; const q = qs.get(a.questionId); const r = correctBy[a.studentId] = correctBy[a.studentId] || { right: 0, total: 0 }; r.total++; if (q && q.correct != null && q.correct === a.choice) r.right++; }
  let total = 0;
  for (const d of parts.docs) {
    const p = d.data() as any; const minutes = Math.floor((p.creditedSec || 0) / 60); total += minutes;
    await db.doc(`tenants/${tenantId}/liveAttendance/${sessionId}_${p.studentId}`).set({ sessionId, studentId: p.studentId, email: p.email, name: p.name || null, title: s.title, programId: s.programId || null, courseId: s.courseId || null,
      joinedAt: p.joinedAt, endedAt: at, minutes, answers: correctBy[p.studentId] || { right: 0, total: 0 } });
  }
  await ref.set({ status: 'ended', endedAt: at, current: s.current ? { ...s.current, open: false } : null, summary: { participants: parts.size, minutes: total } }, { merge: true });
  await appendAudit(tenantId, { type: 'live.ended', by, summary: `Live class “${s.title}” ended — ${parts.size} student${parts.size === 1 ? '' : 's'}, ${total} verified minutes in total, ${(s.questions || []).length} questions`, data: { sessionId } });
  return { participants: parts.size };
}
