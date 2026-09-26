// src/lib/academy-study.ts
//
// MY LEARNING — the student's study tools.
//   notes     tenants/{t}/studyNotes/{id}: highlight (quoted text + colour) ·
//             note (quote + the student's words) · card (their own flashcard)
//   review    spaced repetition over flashcards from lessons they've COMPLETED
//             plus their own cards; state in tenants/{t}/studyState/{studentId}.
//             Again → back in 10 minutes · Hard/Good/Easy → days that grow with
//             each success. At most 20 new cards a day, so it never overwhelms.
//   glossary  every term across their courses (lesson flashcards + their cards),
//             translated into their language (cached per school — once per term)

import { getAdminDb } from '@/lib/firebase-admin';

export const COLORS = ['yellow', 'green', 'pink'];
const DAY = 86400000;

export function schedule(prev: any, grade: number, now = Date.now()) {
  const s = { iv: Number(prev?.iv) || 0, ease: Number(prev?.ease) || 2.5, reps: Number(prev?.reps) || 0 };
  if (grade <= 0) return { iv: 0, ease: Math.max(1.3, s.ease - 0.2), reps: 0, due: now + 10 * 60000 };
  let iv: number;
  if (grade === 1) iv = Math.max(1, Math.round(s.iv * 1.2) || 1);
  else if (grade === 2) iv = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.round(s.iv * s.ease);
  else iv = s.reps === 0 ? 3 : Math.round(s.iv * s.ease * 1.3) || 4;
  const ease = Math.min(3, Math.max(1.3, s.ease + (grade === 1 ? -0.15 : grade === 3 ? 0.15 : 0)));
  return { iv: Math.max(1, iv), ease, reps: s.reps + 1, due: now + Math.max(1, iv) * DAY };
}

/** All the student's cards: lesson flashcards (completed lessons) + their own. */
async function allCards(tenantId: string, studentId: string, onlyCompleted: boolean) {
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const enr = await db.collection(`${T}/enrollments`).where('studentId', '==', studentId).limit(100).get();
  const out: any[] = [];
  for (const d of enr.docs) {
    const e = d.data() as any; if (!e.courseId) continue;
    const c = ((await db.doc(`${T}/courses/${e.courseId}`).get()).data() as any) || {};
    const ls = await db.collection(`${T}/courses/${e.courseId}/lessons`).limit(500).get();
    for (const l of ls.docs) {
      const x = l.data() as any; if (onlyCompleted && !e.progress?.[l.id]) continue;
      (x.flashcards || []).forEach((f: any, i: number) => { if (f.front && f.back) out.push({ key: `L:${e.courseId}:${l.id}:${i}`, front: f.front, back: f.back, from: `${c.title || ''} · ${x.title || ''}`, courseSlug: c.slug, lessonId: l.id }); });
    }
  }
  const mine = await db.collection(`${T}/studyNotes`).where('studentId', '==', studentId).where('kind', '==', 'card').limit(1000).get();
  for (const d of mine.docs) { const n = d.data() as any; out.push({ key: `P:${d.id}`, front: n.front, back: n.back, from: n.lessonTitle ? `My card · ${n.lessonTitle}` : 'My card', courseSlug: n.courseSlug, lessonId: n.lessonId, mine: true }); }
  return out;
}

export async function reviewDeck(tenantId: string, studentId: string) {
  const db = getAdminDb();
  const [cards, st] = await Promise.all([allCards(tenantId, studentId, true), db.doc(`tenants/${tenantId}/studyState/${studentId}`).get()]);
  const state = ((st.data() as any) || {}).cards || {}; const now = Date.now();
  const due = cards.filter((c) => state[c.key] && state[c.key].due <= now).sort((a, b) => state[a.key].due - state[b.key].due);
  const today = new Date().toISOString().slice(0, 10);
  const newToday = Number(((st.data() as any) || {}).newOn?.[today] || 0);
  const fresh = cards.filter((c) => !state[c.key]).slice(0, Math.max(0, 20 - newToday));
  const learned = cards.filter((c) => state[c.key] && state[c.key].reps >= 3).length;
  return { cards: [...due, ...fresh].slice(0, 60).map((c) => ({ ...c, isNew: !state[c.key] })), total: cards.length, dueCount: due.length, newCount: fresh.length, learned };
}

export async function recordReview(tenantId: string, studentId: string, key: string, grade: number) {
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}/studyState/${studentId}`);
  return db.runTransaction(async (tx: any) => {
    const d = ((await tx.get(ref)).data() as any) || {};
    const prev = d.cards?.[key]; const today = new Date().toISOString().slice(0, 10);
    const next = schedule(prev, Math.max(0, Math.min(3, Math.round(grade))));
    tx.set(ref, { cards: { [key]: next }, ...(prev ? {} : { newOn: { [today]: Number(d.newOn?.[today] || 0) + 1 } }), updatedAt: new Date().toISOString() }, { merge: true });
    return next;
  });
}

export async function glossary(tenantId: string, studentId: string, lang: string | null) {
  const cards = await allCards(tenantId, studentId, false);
  const seen = new Map<string, any>();
  for (const c of cards) { const k = String(c.front).trim().toLowerCase(); if (k.length > 80 || /\?$/.test(String(c.front).trim())) continue; if (!seen.has(k)) seen.set(k, { term: String(c.front).trim(), meaning: String(c.back).trim(), from: c.from }); }
  const terms = [...seen.values()].sort((a, b) => a.term.localeCompare(b.term)).slice(0, 400);
  if (lang && lang !== 'en' && terms.length) {
    try { const { translateTexts } = await import('@/lib/translate'); const tr = await translateTexts(tenantId, terms.flatMap((t) => [t.term, t.meaning]), lang); terms.forEach((t, i) => { t.termTr = tr[i * 2]; t.meaningTr = tr[i * 2 + 1]; }); } catch { /* English only */ }
  }
  return terms;
}
