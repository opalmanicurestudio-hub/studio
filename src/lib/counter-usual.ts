// src/lib/counter-usual.ts — THEIR USUAL (pure; design board "Their usual"; lib/counter-usual-server, the rewards row at
// the counter and the window). What a regular gets, item and choices together, counted from their paid orders with their
// rewards code: kept on their record as a small tally (the most-ordered few), and shown to staff as up to three to add in
// one tap. Only menu items, as they were picked: never something rung in that isn't on the menu, a gift card, or a
// weighing (each is weighed again).
import { picksOf, type Picks } from '@/lib/menu-choices';

export type UsualEntry = { itemId: string; name: string; picks: Picks; choicesText: string | null; n: number; last: string };
/** How many different things are kept on their record (the least ordered, oldest, go first). */
export const USUAL_KEEP = 15;
/** Ordered at least this many times to count as their usual; up to this many are shown. */
export const USUAL_MIN = 2, USUAL_SHOW = 3;

const ID = /^[A-Za-z0-9_-]{1,160}$/;
/** One thing as they get it: the item and its picks, the same however they were picked. */
export function usualKey(itemId: string, picks: Picks): string {
  const p = Object.keys(picks).sort().map((g) => `${g}:${[...(picks[g] || [])].sort().join('+')}`).join(',');
  return `${itemId}|${p}`.slice(0, 300);
}
/** Each kind of thing on a paid order that counts (once an order, however many of it). */
export function usualFrom(lines: any[] | null | undefined): { key: string; itemId: string; name: string; picks: Picks; choicesText: string | null }[] {
  const out = new Map<string, { key: string; itemId: string; name: string; picks: Picks; choicesText: string | null }>();
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!l || l.oneOff || l.giftCard || l.weight || !ID.test(String(l.itemId || ''))) continue;
    const picks = picksOf(l.choices); const key = usualKey(String(l.itemId), picks);
    if (!out.has(key)) out.set(key, { key, itemId: String(l.itemId), name: String(l.name || 'Item').slice(0, 80), picks, choicesText: l.choicesText ? String(l.choicesText).slice(0, 160) : null });
  }
  return Array.from(out.values());
}
/** Their tally with one more paid order added: each thing on it once more, the newest wording kept, the few kept. */
export function usualAdd(tally: Record<string, UsualEntry> | null | undefined, lines: any[] | null | undefined, at: string): Record<string, UsualEntry> {
  const next: Record<string, UsualEntry> = { ...(tally && typeof tally === 'object' ? tally : {}) };
  for (const x of usualFrom(lines)) { const was = next[x.key]; next[x.key] = { itemId: x.itemId, name: x.name, picks: x.picks, choicesText: x.choicesText, n: Math.round(Number(was?.n) || 0) + 1, last: at }; }
  const keep = Object.entries(next).sort((a, b) => b[1].n - a[1].n || String(b[1].last).localeCompare(String(a[1].last))).slice(0, USUAL_KEEP);
  return Object.fromEntries(keep);
}
/** Their usual: ordered at least twice, the most ordered first (then the latest). */
export function usualTop(tally: Record<string, UsualEntry> | null | undefined, max = 5): UsualEntry[] {
  return Object.values(tally && typeof tally === 'object' ? tally : {}).filter((e) => e && ID.test(String(e.itemId)) && Math.round(Number(e.n) || 0) >= USUAL_MIN)
    .sort((a, b) => b.n - a.n || String(b.last).localeCompare(String(a.last))).slice(0, max)
    .map((e) => ({ itemId: String(e.itemId), name: String(e.name || 'Item'), picks: e.picks && typeof e.picks === 'object' ? e.picks : {}, choicesText: e.choicesText || null, n: Math.round(Number(e.n) || 0), last: String(e.last || '') }));
}
/** How one reads on the row: "Oat latte, Large, Extra shot". */
export const usualWords = (e: Pick<UsualEntry, 'name' | 'choicesText'>) => `${e.name}${e.choicesText ? `, ${e.choicesText}` : ''}`;
