// src/lib/floor-word.ts — WHAT THE KITCHEN TELLS THE FLOOR (design canvas "The bar and the pass"; lib/floor-word-server,
// api/kitchen 'floorNote', and My tables and the host stand, which show it). Two things:
//   - tonight's 86 list: what's sold out, a choice that's run out ("Oysters: no more mignonette"), and a counted dish
//     that's nearly gone ("Fish of the day: 3 left"), from the menu and tonight's counts, so it's never typed twice
//   - the kitchen's message ("Fish is 10 minutes out. Push the pasta."), until the kitchen clears it, or for 3 hours
// Pure.
import { outNow } from '@/lib/menu-choices';
import type { CountRow } from '@/lib/dish-counts';

export const NOTE_MAX = 140;
export const NOTE_HOURS = 3;
/** A counted dish shows on the 86 list once this few are left. */
export const LOW_LEFT = 3;
const MAX_LIST = 24;

export type EightySix = { id: string; name: string; out: boolean; choices: string[]; left: number | null };
export type FloorNote = { text: string; by: string; at: string };
export type FloorWord = { eightySix: EightySix[]; note: FloorNote | null };

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Tonight's 86 list from the menu items and tonight's counts: sold out first, then a choice run out, then nearly gone. */
export function eightySixOf(items: { id: string; x: any }[], rows: CountRow[], now = Date.now(), at: string | null = null): EightySix[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: EightySix[] = [];
  for (const { id, x } of items) {
    const name = clip(x?.name, 60); if (!name) continue;
    // (At a location, with more than one: sold out there, or everywhere.)
    const gone = outNow(x, now, at) || !!byId.get(id)?.soldOut;
    const choices: string[] = gone ? [] : (Array.isArray(x?.choices) ? x.choices : []).flatMap((g: any) => (Array.isArray(g?.options) ? g.options : []).filter((o: any) => outNow(o, now, at)).map((o: any) => clip(o?.name, 40)).filter(Boolean));
    const r = byId.get(id);
    const left = !gone && r && r.left > 0 && r.left <= LOW_LEFT ? r.left : null;
    if (gone || choices.length || left !== null) out.push({ id, name, out: gone, choices: Array.from(new Set(choices)).slice(0, 6), left });
  }
  const rank = (e: EightySix) => (e.out ? 0 : e.choices.length ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, MAX_LIST);
}

/** The 86 list in a line: "Short rib, Key lime pie. Oysters: no more mignonette. Fish of the day: 3 left". */
export function eightySixWords(list: EightySix[]): string {
  const out = list.filter((e) => e.out).map((e) => e.name);
  const parts = [out.join(', ')];
  for (const e of list.filter((x) => !x.out && x.choices.length)) parts.push(`${e.name}: no more ${e.choices.join(' or ').toLowerCase()}`);
  for (const e of list.filter((x) => !x.out && !x.choices.length && x.left !== null)) parts.push(`${e.name}: ${e.left} left`);
  return parts.filter(Boolean).join('. ');
}

/** The kitchen's message as typed: a few words, never empty. */
export function cleanNote(raw: unknown): { text: string } | { error: string } {
  const text = clip(raw, NOTE_MAX);
  if (!text) return { error: 'What should the floor know?' };
  return { text };
}

/** The message as the floor sees it: until the kitchen clears it, or for 3 hours. */
export function noteNow(raw: any, now = Date.now()): FloorNote | null {
  if (!raw || raw.clearedAt || !raw.text) return null;
  const at = Date.parse(String(raw.at || '')); if (!Number.isFinite(at) || now - at > NOTE_HOURS * 3600000) return null;
  return { text: clip(raw.text, NOTE_MAX), by: clip(raw.by, 40) || 'The kitchen', at: String(raw.at) };
}
