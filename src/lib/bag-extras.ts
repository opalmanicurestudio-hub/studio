// src/lib/bag-extras.ts — THE EXTRAS IN THE BAG, TICKED AS THEY GO IN (pure; design board "The extras in the bag, and
// what got caught", A: made from each order). Bags and item stickers are scanned before a to-go order is handed over
// (lib/food-bags, lib/item-stickers); what can't carry a code (a dip, a straw, napkins) is ticked instead:
//   - The list is made from the order: each dip or sauce the guest picked, from the choices the business says go in the
//     bag on their own (by the choice's name: Dips, Sauces), counted; and the business's own extras it says to tick in
//     (lib/plate-extras, the ones costed on Food cost: a straw for each cold drink, napkins with each order to go), with
//     their counts.
//   - Each is tapped as it goes in, on the same screen as the scan; the handover waits for them as for a bag, and a
//     manager's PIN that lets an order go without its scan covers them too. With the scan off, or for here, none.
//   - The same list prints on the first bag's label, to read.
//   tenants/{t}.bagCheck = { off, groups: [choice names], extras: [extra ids] }
//   tenants/{t}/counterOrders/{id}.extrasIn = [key…]  ("c:ranch_2000", "x:x2_1000": what's been ticked in, and how many)
import { bagCheckOn, bagLinesOf } from '@/lib/food-bags';
import { goesOut } from '@/lib/item-stickers';
import { extrasOf } from '@/lib/plate-extras';

export type BagExtra = { k: string; name: string; n: number | null };
export const MAX_BAG_GROUPS = 12, MAX_BAG_EXTRAS = 20;
/** A ticked extra's key: "c:" a guest's pick, by its name; "x:" one of the business's extras, by its id; then how many
 *  ("c:ranch_2"), so a tick for 2 doesn't stand for the 3 there are after a change. */
export const EXTRA_KEY = /^[cx]:[a-z0-9-]{1,58}_\d{1,7}$/;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const low = (v: unknown) => words(v, 60).toLowerCase();
// A short mark of the exact text (FNV-1a), so two names that read the same as plain letters stay two.
const mark = (v: string) => { let h = 0x811c9dc5; for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36).slice(0, 6); };
/** A name or id in plain letters for a key; with a mark of the original when that changed it (accents, other letters,
 *  and for an id its case), so "Salsa" and "Salsa!" or ids "X1" and "x1" never tick each other. A name's case doesn't
 *  count: "Ranch" picked on two items is one line. */
const slug = (v: unknown, exact = false) => {
  const w = words(v, 60); const raw = exact ? w : w.toLowerCase(); const s = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s && s === raw ? s.slice(0, 58) : `${s.slice(0, 50) || 'x'}-${mark(raw)}`;
};
/** An extra's amount is a count only in a counting measure ("each"); in oz, g or ml, each one is one. */
const COUNTED = /^(each|ea|unit|units|pc|pcs|piece|pieces|count|ct)$/i;
const perOne = (amount: number, measure: string) => (COUNTED.test(String(measure || 'each').trim()) ? amount : 1);

/** What the business ticks into the bag, as kept: the choices (by name) whose picks go in on their own, and its own
 *  extras (by id; only ones still set, and never one for a guest at a table). */
export function bagExtrasSetOf(tenant: any): { groups: string[]; extras: string[] } {
  const c = tenant?.bagCheck || {};
  const groups = cleanBagGroups(c.groups) || [];
  const ids = new Set(extrasOf(tenant).filter((e) => e.per !== 'guest').map((e) => e.id));
  const extras = (Array.isArray(c.extras) ? c.extras : []).map(String).filter((id: string) => ids.has(id)).slice(0, MAX_BAG_EXTRAS);
  return { groups, extras: Array.from(new Set<string>(extras)) };
}
/** Choice names as a manager picked them: each a name, once (whatever its case), and only so many; null when it isn't
 *  a list. */
export function cleanBagGroups(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = []; const seen = new Set<string>();
  for (const x of v) { const w = words(x, 40); if (w && !seen.has(w.toLowerCase())) { seen.add(w.toLowerCase()); out.push(w); } }
  return out.slice(0, MAX_BAG_GROUPS);
}

/** "4 napkins"-style count: a whole number of them, or none to say (half a roll of something reads as its name alone). */
const whole = (n: number) => (Number.isFinite(n) && n >= 1 && Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : null);

/** What goes in this order's bag besides what's made: none for here, or when the business ticks nothing in. */
export function extrasFor(order: any, tenant: any): BagExtra[] {
  if (!goesOut(order)) return [];
  const set = bagExtrasSetOf(tenant); if (!set.groups.length && !set.extras.length) return [];
  const lines = bagLinesOf(order).filter((l: any) => !l.cancelled);
  const groups = new Set(set.groups.map((g) => g.toLowerCase()));
  const out = new Map<string, { name: string; n: number }>();
  const add = (k: string, name: string, n: number) => { if (!(n > 0)) return; const was = out.get(k); out.set(k, { name: was?.name || name, n: (was?.n || 0) + n }); };
  for (const l of lines) {
    const q = Math.max(1, Math.floor(Number(l.quantity)) || 1);
    for (const c of Array.isArray(l.choices) ? l.choices : []) if (groups.has(low(c?.group)) && words(c?.option, 40)) add(`c:${slug(c.option)}`, words(c.option, 40), q);
  }
  for (const e of extrasOf(tenant)) {
    if (!set.extras.includes(e.id) || e.per === 'guest' || e.when === 'here') continue;
    const each = perOne(e.amount, e.measure);
    if (e.per === 'order') { if (lines.length) add(`x:${slug(e.id, true)}`, e.name, each); continue; }
    const secs = e.sections.map((s) => s.toLowerCase());
    const n = lines.reduce((sum: number, l: any) => sum + (!secs.length || secs.includes(low(l.section)) ? Math.max(1, Math.floor(Number(l.quantity)) || 1) * each : 0), 0);
    add(`x:${slug(e.id, true)}`, e.name, n);
  }
  return Array.from(out.entries()).slice(0, MAX_BAG_EXTRAS).map(([k, v]) => ({ k: `${k}_${Math.min(9999999, Math.round(v.n * 1000))}`, name: v.name, n: whole(v.n) }));
}

/** "2 Ranch", "Napkins": an extra as it's ticked and printed. */
export const extraLabel = (x: { name: string; n: number | null }) => (x.n && x.n > 1 ? `${x.n} ${x.name}` : x.name);
/** A key without its count: the same extra, however many. */
export const extraBase = (k: string) => k.replace(/_\d+$/, '');
/** What's been ticked in on this order. */
export const tickedOf = (order: any): string[] => Array.from(new Set<string>((Array.isArray(order?.extrasIn) ? order.extrasIn : []).map(String).filter((k: string) => EXTRA_KEY.test(k)))).slice(0, 40);

/** The extras checked before this order is handed over (each with whether it's in): none with the scan off, for here,
 *  or when a manager let it go without. */
export function extrasToTick(order: any, tenant: any): { k: string; name: string; done: boolean }[] {
  if (!bagCheckOn(tenant) || order?.bags?.skipped) return [];
  const done = new Set(tickedOf(order));
  return extrasFor(order, tenant).map((x) => ({ k: x.k, name: extraLabel(x), done: done.has(x.k) }));
}
/** The extras still to go in before it's handed over. */
export const extrasLeft = (order: any, tenant: any) => extrasToTick(order, tenant).filter((x) => !x.done);

/** "1 BBQ and napkins", "4 extras". */
export function extrasWords(left: { name: string }[]): string {
  if (left.length > 3) return `${left.length} extras`;
  return left.length <= 1 ? (left[0]?.name || '') : `${left.slice(0, -1).map((x) => x.name).join(', ')} and ${left[left.length - 1].name}`;
}
/** What the first bag's label says goes in too: "2 Ranch, 1 BBQ, 2 Straws, Napkins", or null. */
export function extrasLine(order: any, tenant: any): string | null {
  const all = extrasFor(order, tenant); return all.length ? all.map(extraLabel).join(', ').slice(0, 200) : null;
}
