// src/lib/wait-line.ts — WAITING FROM ANYWHERE. Pure: the guest's own link (app/wait), the server behind it (api/wait)
// and the host stand all use it, so the place in line and the wait time a guest sees are the ones the host sees.
// - Settings: whether waiting guests get a link at all (off until the business turns it on), how long a table is held
//   after we text them, whether and how often they can ask for more time, and a drink while they wait (which drinks,
//   and whether the bar makes it when we text them or when they sit down).
// - Their place: the parties ahead of them who'd go to the same tables. Their wait: when the tables that fit them are
//   likely ready (lib/table-stage), in turn, so the third party in line for a four-top waits for the third one.
// - A drink while they wait: only from the drinks the business picked (no choices to make, not sold out), priced from
//   the menu on the server, and kept with the party until it goes on the table's tab (lib/floor-server).

import { turnFor, type FloorSettings } from '@/lib/table-stage';
import type { SeatTable } from '@/lib/seat-next';

export type DrinksWhen = 'seated' | 'ready';
export type WaitSettings = {
  /** Guests added with a mobile number get a text with their own link. */
  link: boolean;
  /** How long a table is held after we text them it's (nearly) ready. */
  holdMin: number;
  /** How many times they can ask for more time from their phone (0: not at all), and how long each time is. */
  moreTimes: number; moreMin: number;
  /** A drink while they wait, and when the bar makes it. */
  preorder: boolean; drinksWhen: DrinksWhen;
  /** Which menu sections they can pick from (none: everything in a drinks section). */
  sections: string[];
};
export const DEFAULT_WAIT: WaitSettings = { link: false, holdMin: 10, moreTimes: 1, moreMin: 10, preorder: false, drinksWhen: 'seated', sections: [] };
export const MAX_SECTIONS = 20;

const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const sectionKey = (v: unknown) => words(v, 60).toLowerCase();

export function waitSettingsOf(tenant: any): WaitSettings { return cleanWait(tenant?.hostingSettings?.wait); }
export function cleanWait(raw: any): WaitSettings {
  const out: WaitSettings = { ...DEFAULT_WAIT, sections: [] };
  const num = (k: 'holdMin' | 'moreTimes' | 'moreMin', lo: number, hi: number) => { const n = Math.round(Number(raw?.[k])); if (raw?.[k] !== undefined && raw?.[k] !== null && raw?.[k] !== '' && Number.isFinite(n) && n >= lo && n <= hi) out[k] = n; };
  if (typeof raw?.link === 'boolean') out.link = raw.link;
  if (typeof raw?.preorder === 'boolean') out.preorder = raw.preorder;
  if (raw?.drinksWhen === 'ready' || raw?.drinksWhen === 'seated') out.drinksWhen = raw.drinksWhen;
  num('holdMin', 3, 30); num('moreTimes', 0, 3); num('moreMin', 5, 30);
  const seen = new Set<string>();
  for (const x of Array.isArray(raw?.sections) ? raw.sections : []) { const w = words(x, 60); const k = sectionKey(w); if (w && !seen.has(k) && seen.size < MAX_SECTIONS) { seen.add(k); out.sections.push(w); } }
  return out;
}

// ── Their place in line, and how long ─────────────────────────────────────────────────────────────────────────────────
export type LineParty = { id: string; size: number; needs?: string[]; status: string; joinedAt: string | null; laterUntil?: string | null };
export type LinePlace = { place: number; ahead: number; minutes: number | null };

const ms = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : NaN; };
const suits = (t: SeatTable, p: LineParty) => t.capacity >= p.size && (p.needs || []).every((n) => t.tags.includes(n)) && (!t.heldFor || t.heldFor === p.id);

/** Where a waiting party is in line, and about how long until a table that fits them is ready. Parties ahead are the
 *  ones already told it's ready, then whoever joined earlier, who'd go to one of the same tables; someone who asked for
 *  more time goes behind everyone ready, until then. The wait comes from playing the line forward: each party ahead
 *  takes the table that suits them soonest (not a much bigger one when a closer fit is nearly ready), and that table
 *  comes round again after a usual stay and clearing. */
export function linePlace(party: LineParty, tables: SeatTable[], waiting: LineParty[], s: FloorSettings, now = Date.now()): LinePlace {
  const mine = tables.filter((t) => t.capacity > 0 && suits(t, party));
  const later = (p: LineParty) => { const t = ms(p.laterUntil); return Number.isFinite(t) && t > now ? t : 0; };
  const order = (p: LineParty) => (later(p) ? 2 : p.status === 'notified' ? 0 : 1);
  const queue = [...(Array.isArray(waiting) ? waiting : []).filter((p) => p && p.id !== party.id && ['waiting', 'notified'].includes(p.status)), party]
    .sort((a, b) => order(a) - order(b) || later(a) - later(b) || (ms(a.joinedAt) || 0) - (ms(b.joinedAt) || 0) || (a.id === party.id ? 1 : b.id === party.id ? -1 : 0));
  const at = queue.findIndex((p) => p.id === party.id);
  // A table held for them is theirs, whoever else is waiting.
  const ahead = mine.some((t) => t.heldFor === party.id) ? 0 : queue.slice(0, at).filter((p) => mine.some((t) => suits(t, p))).length;
  const free = tables.filter((t) => t.capacity > 0 && t.freeIn !== null).map((t) => ({ t, at: t.freeIn as number }));
  let minutes: number | null = null;
  for (const p of queue.slice(0, at + 1)) {
    const options = free.filter((a) => suits(a.t, p));
    if (!options.length) continue;
    // A table held for them is theirs; otherwise the soonest, counting a few minutes for each empty seat.
    const pick = options.find((a) => a.t.heldFor === p.id) || options.slice().sort((x, y) => (x.at + (x.t.capacity - p.size) * 2) - (y.at + (y.t.capacity - p.size) * 2) || x.t.capacity - y.t.capacity)[0];
    if (p.id === party.id) { minutes = Math.max(pick.at, later(p) ? Math.ceil((later(p) - now) / 60000) : 0); break; }
    pick.at += turnFor(p.size, s) + s.clearMin;
  }
  return { place: ahead + 1, ahead, minutes };
}

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const v = Math.max(0, Math.floor(n)); const t = v % 100;
  if (t >= 11 && t <= 13) return `${v}th`;
  const d = v % 10;
  return `${v}${d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}`;
}
export const placeWords = (p: LinePlace) => (p.ahead === 0 ? 'You’re next' : `${ordinal(p.place)} in line`);
/** "Any minute now", "About 8 minutes", "About 25 minutes" (rounded to five past ten minutes). */
export function minutesWords(m: number | null): string {
  if (m === null) return 'We’ll text you when it’s ready';
  if (m <= 2) return 'Any minute now';
  if (m < 10) return `About ${m} minutes`;
  return `About ${Math.round(m / 5) * 5} minutes`;
}

// ── Asking for more time ──────────────────────────────────────────────────────────────────────────────────────────────
/** Whether they can ask for more time now, and until when. */
export function moreTime(p: { laterCount?: number; laterUntil?: string | null; status: string }, s: WaitSettings, now: number): { ok: true; until: string } | { ok: false; error: string } {
  if (!['waiting', 'notified'].includes(p.status)) return { ok: false, error: 'You’re not on the list any more.' };
  if (s.moreTimes <= 0) return { ok: false, error: 'Please talk to the host about more time.' };
  if ((Number(p.laterCount) || 0) >= s.moreTimes) return { ok: false, error: s.moreTimes === 1 ? 'You’ve already asked for more time once. Please talk to the host.' : 'You’ve asked for more time as often as we can hold. Please talk to the host.' };
  const from = Math.max(now, ms(p.laterUntil) || 0);
  return { ok: true, until: new Date(from + s.moreMin * 60000).toISOString() };
}

// ── A drink while they wait ───────────────────────────────────────────────────────────────────────────────────────────
export type PreorderLine = { itemId: string; name: string; price: number; qty: number; at: string };
export const MAX_PREORDER_LINES = 8;
export const MAX_PREORDER_QTY = 4;
export const MAX_PREORDER_TOTAL = 12;

/** Whether a menu item is one of the drinks guests can order while they wait: in a section the business picked (or any
 *  drinks section when none are picked), sold on its own (no choices to make), and priced. */
export function isWaitDrink(item: any, s: WaitSettings, isDrink: (x: any) => boolean): boolean {
  if (!item || item.isArchived === true || item.status === 'archived' || item.hasVariants || item.isBackbar || item.backbar) return false;
  if (Array.isArray(item.choices) && item.choices.length) return false;
  if (Array.isArray(item.optionGroups) && item.optionGroups.length) return false;
  if (['equipment', 'overhead'].includes(String(item.type || ''))) return false;
  if (s.sections.length) {
    const keys = new Set(s.sections.map(sectionKey));
    return [item.section, item.menuSection, item.category].some((x) => x && keys.has(sectionKey(x)));
  }
  return isDrink(item);
}

export const preorderCount = (lines: PreorderLine[] = []) => (Array.isArray(lines) ? lines : []).reduce((n, l) => n + (Number(l?.qty) || 0), 0);
export const preorderTotal = (lines: PreorderLine[] = []) => Math.round((Array.isArray(lines) ? lines : []).reduce((n, l) => n + (Number(l?.price) || 0) * (Number(l?.qty) || 0), 0) * 100) / 100;

/** One more of a drink on their order (the price from the menu, given by the server). */
export function addPreorder(lines: PreorderLine[], item: { id: string; name: string; price: number }, at: string): { ok: true; lines: PreorderLine[] } | { ok: false; error: string } {
  const cur = (Array.isArray(lines) ? lines : []).filter((l) => l && l.itemId && Number(l.qty) > 0).map((l) => ({ ...l }));
  if (preorderCount(cur) >= MAX_PREORDER_TOTAL) return { ok: false, error: `That’s ${MAX_PREORDER_TOTAL} drinks, as many as we take ahead. Order more at the table.` };
  const have = cur.find((l) => l.itemId === item.id);
  if (have) {
    if (have.qty >= MAX_PREORDER_QTY) return { ok: false, error: `That’s ${MAX_PREORDER_QTY} of those. Order more at the table.` };
    have.qty += 1; have.price = item.price; have.name = item.name;
  } else {
    if (cur.length >= MAX_PREORDER_LINES) return { ok: false, error: 'That’s as many different drinks as we take ahead. Order more at the table.' };
    cur.push({ itemId: item.id, name: words(item.name, 80), price: Math.round((Number(item.price) || 0) * 100) / 100, qty: 1, at });
  }
  return { ok: true, lines: cur };
}
/** One fewer of a drink on their order. */
export function removePreorder(lines: PreorderLine[], itemId: string): PreorderLine[] {
  return (Array.isArray(lines) ? lines : []).map((l) => (l && l.itemId === itemId ? { ...l, qty: (Number(l.qty) || 0) - 1 } : l)).filter((l) => l && Number(l.qty) > 0);
}
/** "Negroni, 2 Aperol spritz" */
export const preorderWords = (lines: PreorderLine[] = []) => (Array.isArray(lines) ? lines : []).filter((l) => l && l.qty > 0).map((l) => (l.qty > 1 ? `${l.qty} ${l.name}` : l.name)).join(', ');
