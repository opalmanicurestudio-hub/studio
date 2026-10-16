// src/lib/link-views.ts — WHEN A CLIENT OPENED ONE OF THEIR LINKS. Every client page reached from a message (the visit
// link, before your visit, aftercare, how was your visit) records the first and latest time it was opened and how many
// times, on the visit: linkViews.{kind} = { first, last, count }. A text can't report that it was read; an opened link
// can. Pages viewed by the team from inside the app (?by=desk) are not counted.
import { FieldValue } from 'firebase-admin/firestore';

export type LinkKind = 'visit' | 'before' | 'aftercare' | 'feedback';
export const LINK_WORDS: Record<LinkKind, string> = {
  visit: 'their visit link', before: 'Before your visit', aftercare: 'their aftercare', feedback: 'How was your visit?',
};

/** The fields to write for one open. Pure, so it can be tested. */
export function viewPatch(existing: any, kind: LinkKind, at: string) {
  const cur = existing?.linkViews?.[kind] || {};
  return { first: cur.first || at, last: at };
}

/** Record that the client opened a link. Never throws: a missed stamp must not break the client's page. */
export async function stampLinkView(ref: any, existing: any, kind: LinkKind, opts: { staff?: boolean } = {}) {
  if (opts.staff || !ref) return;
  try {
    const at = new Date().toISOString(); const p = viewPatch(existing, kind, at);
    await ref.set({ linkViews: { [kind]: { ...p, count: FieldValue.increment(1) } } }, { merge: true });
  } catch { /* best effort */ }
}
