// src/lib/academy-live.ts
//
// LIVE CLASS 2.0 — a class students join on their phones (in the room or at home).
//
//   Activities the instructor sends (one at a time):
//     quiz        multiple choice, optional timer — faster right answers earn
//                 more points (500–1000); leaderboard + room-vs-home teams
//     poll        multiple choice, no right answer
//     word        word cloud — a word or short phrase each
//     rate        "rate this set": a photo, students score 1–5, then the
//                 instructor's score is revealed (trains a professional eye)
//     tap         "tap the photo": students tap where they'd file / what's wrong;
//                 optional target circle revealed at the end
//     confidence  🟢 got it · 🟡 almost · 🔴 lost
//     exit        exit ticket: up to 5 questions at the end → saved to the
//                 course gradebook
//   Always on: the room's pulse (each student's 🟢🟡🔴 and "too fast"), and an
//   anonymous question queue with upvotes.
//   Minutes: the SERVER credits time only while a student's class page is open
//   and visible (≤35 s per check-in, gaps under 75 s). Recorded at the end.

import { randomInt, randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { appendAudit } from '@/lib/academy-compliance';
import { mediaUrl } from '@/lib/academy';

export const KINDS = ['quiz', 'poll', 'word', 'rate', 'tap', 'confidence', 'exit'] as const;
export const newJoinCode = () => String(randomInt(100000, 999999));
const S = (t: string, id: string) => getAdminDb().doc(`tenants/${t}/liveSessions/${id}`);

export async function findLive(tenantId: string, code: string) {
  const s = await getAdminDb().collection(`tenants/${tenantId}/liveSessions`).where('code', '==', String(code || '').trim()).where('status', '==', 'live').limit(1).get();
  return s.empty ? null : { id: s.docs[0].id, ...(s.docs[0].data() as any) };
}

/** What a student may see of the current activity (no answers until revealed). */
async function publicActivity(q: any) {
  if (!q) return null;
  const image = q.imagePath ? await mediaUrl(q.imagePath, 60) : null;
  return { id: q.id, kind: q.kind || 'quiz', q: q.q, options: q.options || null, open: q.open, reveal: q.reveal, endsAt: q.endsAt || null, image,
    correct: q.reveal ? q.correct ?? null : null, instructorRating: q.reveal ? q.instructorRating ?? null : null, target: q.reveal ? q.target ?? null : null,
    questions: q.kind === 'exit' ? (q.questions || []).map((x: any) => ({ q: x.q, options: x.options })) : null };
}

/** A student's check-in: credit time (server clock), pulse, and what to show. */
export async function studentBeat(tenantId: string, sessionId: string, student: { id: string; email: string; name: string | null }, visible: boolean, extra?: { team?: string | null; pulse?: string | null; fast?: boolean | null }) {
  const ref = S(tenantId, sessionId);
  const s = ((await ref.get()).data() as any) || null;
  if (!s) return null;
  const pRef = ref.collection('participants').doc(student.id);
  const p = ((await pRef.get()).data() as any) || null;
  const now = Date.now(); const iso = new Date(now).toISOString();
  const mood: any = {};
  if (extra?.team && ['room', 'home'].includes(extra.team)) mood.team = extra.team;
  if (extra?.pulse && ['green', 'yellow', 'red'].includes(extra.pulse)) mood.pulse = extra.pulse;
  if (extra?.fast != null) mood.fast = !!extra.fast;
  if (s.status === 'live') {
    if (!p) await pRef.set({ studentId: student.id, email: student.email, name: student.name, joinedAt: iso, lastSeenAt: iso, lastCreditAt: iso, creditedSec: 0, team: 'room', ...mood });
    else {
      const gap = (now - new Date(p.lastCreditAt || p.lastSeenAt).getTime()) / 1000;
      const patch: any = { lastSeenAt: iso, leftAt: null, ...mood };
      if (gap >= 20) { patch.lastCreditAt = iso; if (visible && gap <= 75) patch.creditedSec = (p.creditedSec || 0) + Math.min(gap, 35); }
      await pRef.set(patch, { merge: true });
    }
  }
  const q = s.current || null;
  const mine = q ? (((await ref.collection('answers').doc(`${q.id}_${student.id}`).get()).data() as any) || null) : null;
  const me = { ...(p || {}), ...mood };
  return { status: s.status, title: s.title, activity: await publicActivity(q), mine: mine ? { choice: mine.choice ?? null, text: mine.text ?? null, rating: mine.rating ?? null, x: mine.x ?? null, y: mine.y ?? null, choices: mine.choices ?? null, points: q?.reveal ? mine.points || 0 : null, score: q?.reveal ? mine.score ?? null : null } : null,
    minutes: Math.floor(((p?.creditedSec) || 0) / 60), team: me.team || 'room', pulse: me.pulse || null, fast: !!me.fast };
}

/** A student's answer to the current activity (shape depends on the kind). */
export async function studentAnswer(tenantId: string, sessionId: string, studentId: string, questionId: string, a: any) {
  const ref = S(tenantId, sessionId);
  const s = ((await ref.get()).data() as any) || null;
  const q = s?.current;
  if (!s || s.status !== 'live' || !q || q.id !== questionId || !q.open) throw new Error('That activity has closed.');
  if (q.endsAt && Date.now() > new Date(q.endsAt).getTime() + 1500) throw new Error('Time’s up!');
  const kind = q.kind || 'quiz';
  const doc: any = { questionId, studentId, kind, at: new Date().toISOString() };
  if (kind === 'quiz' || kind === 'poll' || kind === 'confidence') {
    const n = Number(a.choice); const opts = kind === 'confidence' ? 3 : (q.options || []).length;
    if (!Number.isInteger(n) || n < 0 || n >= opts) throw new Error('Choose an answer.');
    doc.choice = n;
    if (kind === 'quiz' && q.correct != null) {
      // Speed points: 1000 for an instant right answer, down to 500 at the buzzer (500 flat without a timer).
      const elapsed = (Date.now() - new Date(q.at).getTime()) / 1000; const T = Number(q.timerSec) || 0;
      doc.points = n === q.correct ? (T ? Math.round(500 + 500 * Math.max(0, 1 - elapsed / T)) : 500) : 0;
    }
  } else if (kind === 'word') {
    const t = String(a.text || '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, '').replace(/\s+/g, ' ').slice(0, 40);
    if (!t) throw new Error('Type a word.'); doc.text = t;
  } else if (kind === 'rate') {
    const r = Math.round(Number(a.rating)); if (!(r >= 1 && r <= 5)) throw new Error('Choose 1–5.'); doc.rating = r;
  } else if (kind === 'tap') {
    const x = Number(a.x), y = Number(a.y); if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) throw new Error('Tap the photo.'); doc.x = Math.round(x * 10) / 10; doc.y = Math.round(y * 10) / 10;
  } else if (kind === 'exit') {
    const qs = q.questions || []; const ch = (Array.isArray(a.choices) ? a.choices : []).map((x: any) => Number(x));
    if (ch.length !== qs.length || ch.some((x: number, i: number) => !Number.isInteger(x) || x < 0 || x >= qs[i].options.length)) throw new Error('Answer every question.');
    doc.choices = ch; doc.score = Math.round((ch.filter((x: number, i: number) => x === qs[i].answer).length / Math.max(1, qs.length)) * 100);
  }
  await ref.collection('answers').doc(`${questionId}_${studentId}`).set(doc);
}

/** Anonymous question queue (names shown to the instructor only). */
export async function askQuestion(tenantId: string, sessionId: string, student: any, text: string) {
  const t = String(text || '').trim().slice(0, 300); if (!t) throw new Error('Type your question.');
  const r = S(tenantId, sessionId).collection('queue').doc();
  await r.set({ id: r.id, text: t, studentId: student.id, name: student.name || student.email, votes: [student.id], answered: false, at: new Date().toISOString() });
}
export async function upvote(tenantId: string, sessionId: string, studentId: string, qid: string) {
  const r = S(tenantId, sessionId).collection('queue').doc(qid); const d = ((await r.get()).data() as any) || null; if (!d) return;
  const votes: string[] = d.votes || []; await r.set({ votes: votes.includes(studentId) ? votes.filter((x) => x !== studentId) : [...votes, studentId] }, { merge: true });
}
export async function markAnswered(tenantId: string, sessionId: string, qid: string) { await S(tenantId, sessionId).collection('queue').doc(qid).set({ answered: true }, { merge: true }); }
export async function queueFor(tenantId: string, sessionId: string, viewerId?: string | null, withNames = false) {
  const s = await S(tenantId, sessionId).collection('queue').limit(200).get();
  return s.docs.map((d: any) => d.data() as any).map((x: any) => ({ id: x.id, text: x.text, votes: (x.votes || []).length, mine: viewerId ? (x.votes || []).includes(viewerId) : false, answered: !!x.answered, ...(withNames ? { name: x.name } : {}) }))
    .sort((a: any, b: any) => Number(a.answered) - Number(b.answered) || b.votes - a.votes);
}

/** Everything the instructor's screen shows, live. */
export async function sessionState(tenantId: string, sessionId: string) {
  const ref = S(tenantId, sessionId);
  const s = ((await ref.get()).data() as any) || null;
  if (!s) return null;
  const q = s.current || null;
  const [parts, answers, allAns] = await Promise.all([ref.collection('participants').limit(500).get(), q ? ref.collection('answers').where('questionId', '==', q.id).limit(1000).get() : Promise.resolve(null), ref.collection('answers').limit(10000).get()]);
  const now = Date.now();
  const P = parts.docs.map((d: any) => d.data() as any);
  const here = P.filter((p: any) => now - new Date(p.lastSeenAt).getTime() < 45000);
  const A = (answers?.docs || []).map((d: any) => d.data() as any);
  const kind = q?.kind || 'quiz';
  const results: any = { answered: A.length };
  // No activity sent yet (a class that has just started): nothing to tally.
  if (!q) { /* results stay empty */ }
  else if (['quiz', 'poll'].includes(kind)) results.counts = (q.options || []).map((_: any, i: number) => A.filter((x: any) => x.choice === i).length);
  if (kind === 'confidence') results.counts = [0, 1, 2].map((i) => A.filter((x: any) => x.choice === i).length);
  if (kind === 'word') { const f: Record<string, number> = {}; A.forEach((x: any) => { f[x.text] = (f[x.text] || 0) + 1; }); results.words = Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w, n]) => ({ w, n })); }
  if (kind === 'rate') { const r = A.map((x: any) => x.rating); results.avg = r.length ? Math.round((r.reduce((a: number, b: number) => a + b, 0) / r.length) * 10) / 10 : null; results.dist = [1, 2, 3, 4, 5].map((n) => r.filter((x: number) => x === n).length); }
  if (kind === 'tap') results.points = A.slice(0, 400).map((x: any) => ({ x: x.x, y: x.y }));
  if (kind === 'exit') { const sc = A.map((x: any) => x.score); results.avg = sc.length ? Math.round(sc.reduce((a: number, b: number) => a + b, 0) / sc.length) : null; results.perQuestion = (q.questions || []).map((qq: any, i: number) => A.filter((x: any) => x.choices?.[i] === qq.answer).length); }
  // Points and teams (quiz answers across the whole class).
  const pts: Record<string, number> = {}; allAns.docs.forEach((d: any) => { const x = d.data() as any; if (x.points) pts[x.studentId] = (pts[x.studentId] || 0) + x.points; });
  const board = P.map((p: any) => ({ name: p.name || p.email, team: p.team || 'room', points: pts[p.studentId] || 0 })).sort((a: any, b: any) => b.points - a.points);
  const teams = { room: board.filter((x: any) => x.team === 'room').reduce((n: number, x: any) => n + x.points, 0), home: board.filter((x: any) => x.team === 'home').reduce((n: number, x: any) => n + x.points, 0) };
  const pulse = { green: here.filter((p: any) => p.pulse === 'green').length, yellow: here.filter((p: any) => p.pulse === 'yellow').length, red: here.filter((p: any) => p.pulse === 'red').length, fast: here.filter((p: any) => p.fast).length };
  return { session: { id: sessionId, ...s, current: q ? { ...q, image: q.imagePath ? await mediaUrl(q.imagePath, 60) : null } : null },
    people: P.map((p: any) => ({ name: p.name || p.email, email: p.email, team: p.team || 'room', here: now - new Date(p.lastSeenAt).getTime() < 45000, minutes: Math.floor((p.creditedSec || 0) / 60), pulse: p.pulse || null })).sort((a: any, b: any) => Number(b.here) - Number(a.here) || String(a.name).localeCompare(String(b.name))),
    here: here.length, results, board: board.slice(0, 10), teams, pulse, queue: await queueFor(tenantId, sessionId, null, true) };
}

/** Start an activity. */
export async function sendActivity(tenantId: string, sessionId: string, a: any, image?: { path: string } | null) {
  const ref = S(tenantId, sessionId); const s = ((await ref.get()).data() as any) || {};
  const kind = (KINDS as readonly string[]).includes(a.kind) ? a.kind : 'quiz';
  const at = new Date();
  const cur: any = { id: randomBytes(5).toString('hex'), kind, q: String(a.q || '').slice(0, 300), open: true, reveal: false, at: at.toISOString() };
  if (['quiz', 'poll'].includes(kind)) { cur.options = (a.options || []).map((o: any) => String(o).trim().slice(0, 120)).filter(Boolean).slice(0, 6); if (cur.options.length < 2) throw new Error('Add at least two answers.'); if (kind === 'quiz' && Number.isInteger(a.correct) && a.correct >= 0 && a.correct < cur.options.length) cur.correct = a.correct; }
  if (kind === 'quiz' && Number(a.timerSec) > 0) { cur.timerSec = Math.min(120, Math.max(5, Number(a.timerSec))); cur.endsAt = new Date(at.getTime() + cur.timerSec * 1000).toISOString(); }
  if (kind === 'confidence') { cur.q = cur.q || 'How confident are you with this?'; cur.options = ['🟢 Got it', '🟡 Almost', '🔴 Lost']; }
  if (['rate', 'tap'].includes(kind)) { if (!image?.path) throw new Error('Add a photo.'); cur.imagePath = image.path; }
  if (kind === 'rate' && Number(a.instructorRating) >= 1) cur.instructorRating = Math.min(5, Math.round(Number(a.instructorRating)));
  if (kind === 'tap' && a.target && Number.isFinite(Number(a.target.x))) cur.target = { x: Number(a.target.x), y: Number(a.target.y), r: Math.min(40, Math.max(3, Number(a.target.r) || 10)) };
  if (kind === 'exit') { cur.q = cur.q || 'Exit ticket'; cur.questions = (a.questions || []).slice(0, 5).map((x: any) => ({ q: String(x.q || '').slice(0, 300), options: (x.options || []).map((o: any) => String(o).slice(0, 120)).filter(Boolean).slice(0, 4), answer: Math.max(0, Number(x.answer) || 0) })).filter((x: any) => x.q && x.options.length >= 2); if (!cur.questions.length) throw new Error('Add at least one question.'); }
  if (!cur.q && !['confidence', 'exit'].includes(kind)) throw new Error('Write the question or prompt.');
  await ref.set({ current: cur, activities: [...(s.activities || s.questions || []), { id: cur.id, kind, q: cur.q, options: cur.options || null, correct: cur.correct ?? null, questions: cur.questions || null, at: cur.at }] }, { merge: true });
}

/** End the class: freeze minutes, points, exit tickets → gradebook; audit. */
export async function endSession(tenantId: string, sessionId: string, by: string) {
  const db = getAdminDb(); const ref = S(tenantId, sessionId);
  const s = ((await ref.get()).data() as any) || null;
  if (!s) throw new Error('Not found.');
  if (s.status === 'ended') return { participants: s.summary?.participants || 0 };
  const at = new Date().toISOString();
  const [parts, answers] = await Promise.all([ref.collection('participants').limit(500).get(), ref.collection('answers').limit(10000).get()]);
  const A = answers.docs.map((d: any) => d.data() as any);
  const acts = new Map<string, any>((s.activities || s.questions || []).map((q: any) => [q.id, q]));
  let total = 0; const exit = [...acts.values()].filter((x: any) => x.kind === 'exit').pop();
  for (const d of parts.docs) {
    const p = d.data() as any; const minutes = Math.floor((p.creditedSec || 0) / 60); total += minutes;
    const mine = A.filter((x: any) => x.studentId === p.studentId);
    const quizzes = mine.filter((x: any) => (x.kind || 'quiz') === 'quiz' && acts.get(x.questionId)?.correct != null);
    const right = quizzes.filter((x: any) => x.choice === acts.get(x.questionId).correct).length;
    const ex = exit ? mine.find((x: any) => x.questionId === exit.id) : null;
    await db.doc(`tenants/${tenantId}/liveAttendance/${sessionId}_${p.studentId}`).set({ sessionId, studentId: p.studentId, email: p.email, name: p.name || null, title: s.title, programId: s.programId || null, courseId: s.courseId || null,
      joinedAt: p.joinedAt, endedAt: at, minutes, team: p.team || 'room', points: mine.reduce((n: number, x: any) => n + (x.points || 0), 0), answers: { right, total: quizzes.length }, exitScore: ex?.score ?? null });
    // Exit ticket → the course gradebook (as a live-class quiz).
    if (ex && s.courseId) {
      const eRef = db.doc(`tenants/${tenantId}/enrollments/${s.courseId}_${p.studentId}`);
      if ((await eRef.get()).exists) await eRef.set({ quiz: { [`live_${sessionId}`]: { best: ex.score, passed: ex.score >= 70, attempts: [{ at, score: ex.score, passed: ex.score >= 70 }], live: true, title: `Live: ${s.title}` } } }, { merge: true });
    }
  }
  await ref.set({ status: 'ended', endedAt: at, current: s.current ? { ...s.current, open: false } : null, summary: { participants: parts.size, minutes: total, activities: acts.size } }, { merge: true });
  await appendAudit(tenantId, { type: 'live.ended', by, summary: `Live class “${s.title}” ended — ${parts.size} student${parts.size === 1 ? '' : 's'}, ${total} verified minutes, ${acts.size} activit${acts.size === 1 ? 'y' : 'ies'}${exit ? ', exit ticket saved to the gradebook' : ''}`, data: { sessionId } });
  return { participants: parts.size };
}
