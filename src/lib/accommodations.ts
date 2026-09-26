// src/lib/accommodations.ts
//
// ACCOMMODATIONS — students/{id}.accommodations (set by the school, staff only)
//   extraTime   1 · 1.25 · 1.5 · 2 — stretches timed things on the SERVER's say-so
//               (practice exams, speed-round games)
//   largeText · dyslexia (readable font + spacing) · highContrast · reducedMotion
//   audioFirst  read-aloud buttons on every text block and quiz question
//   note        private, for instructors only — never sent to the student
// students/{id}.a11y — the student's own Aa choices, so they follow them to any
// device. Accommodations set the starting point; students can still adjust.

export const EXTRA = [1, 1.25, 1.5, 2];
export function cleanAcc(a: any) {
  return { extraTime: EXTRA.includes(Number(a?.extraTime)) ? Number(a.extraTime) : 1, largeText: !!a?.largeText, dyslexia: !!a?.dyslexia, highContrast: !!a?.highContrast, reducedMotion: !!a?.reducedMotion, audioFirst: !!a?.audioFirst, note: String(a?.note || '').slice(0, 1000) || null };
}
/** What the student's pages use (never includes the private note). */
export function effectiveA11y(st: any) {
  const acc = st?.accommodations || {}; const own = st?.a11y || {};
  const base = { size: acc.largeText ? 2 : 0, contrast: !!acc.highContrast, readable: !!acc.dyslexia, still: !!acc.reducedMotion };
  return { prefs: { ...base, ...own }, extraTime: EXTRA.includes(Number(acc.extraTime)) ? Number(acc.extraTime) : 1, audioFirst: !!acc.audioFirst, hasAccommodations: !!(acc.largeText || acc.highContrast || acc.dyslexia || acc.reducedMotion || acc.audioFirst || Number(acc.extraTime) > 1) };
}
