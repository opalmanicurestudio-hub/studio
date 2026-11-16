// src/lib/plate-extras.ts — SET ONCE, COUNTED EVERYWHERE (design canvas "Food numbers": What a plate really costs). What
// goes out with food and drink but isn't in any one recipe: a box for a main to go, a bag for an order to go, a lid and
// sugar with every hot drink, bread and butter for each guest at a table. The business sets each once; then it's costed
// on every plate (lib/food-cost plateCost) and taken off stock as it's used: at the counter and drive-thru when an order
// goes to the kitchen (lib/counter-server), at a table when its first dish comes up (api/kitchen). Never what stops a
// sale: a box that's run out is taken off as far as there is, and the order still goes.
//   Kept on the business: tenants/{t}.foodCost.extras = [{ id, itemId, name, amount, measure, per, when, sections }]
//     per      'item'  each menu item sold (in `sections` only, when it names some: a box for each main)
//              'order' once an order (a bag to go, napkins)
//              'guest' each guest at a table (bread and butter)
//     when     'togo', 'here' or 'any' (a guest at a table is always here)
//   and what card payments cost: tenants/{t}.foodCost.cardFeePct (2.9 unless the business set its own).
// Pure: the same on the server and every screen.
import type { RecipeLine } from '@/lib/menu-stock';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export type Per = 'item' | 'order' | 'guest';
export type When = 'togo' | 'here' | 'any';
export type Mode = 'togo' | 'here';
export type Extra = { id: string; itemId: string; name: string; amount: number; measure: string; per: Per; when: When; sections: string[] };
export const MAX_EXTRAS = 30, MAX_SECTIONS = 20;
export const DEFAULT_CARD_FEE = 2.9, CARD_FEE_MAX = 10;

/** The extras as kept, cleaned (anything malformed left out). */
export function cleanExtras(v: unknown): Extra[] {
  const out: Extra[] = [];
  for (const e of (Array.isArray(v) ? v : []).slice(0, MAX_EXTRAS)) {
    const itemId = String((e as any)?.itemId || ''); const amount = Math.round(num((e as any)?.amount) * 1000) / 1000;
    if (!ID.test(itemId) || !(amount > 0) || amount > 10000) continue;
    const per: Per = (e as any)?.per === 'order' ? 'order' : (e as any)?.per === 'guest' ? 'guest' : 'item';
    const w = (e as any)?.when; const when: When = per === 'guest' ? 'here' : w === 'togo' || w === 'here' ? w : 'any';
    // Its own id, kept as it was; one with none (or the same as one before it) gets the next free one.
    let id = /^[A-Za-z0-9_-]{1,40}$/.test(String((e as any)?.id || '')) ? String((e as any).id) : '';
    for (let n = out.length + 1; !id || out.some((o) => o.id === id); n++) id = `x${n}`;
    const sections = per === 'item' ? Array.from(new Set((Array.isArray((e as any)?.sections) ? (e as any).sections : []).map((s: unknown) => words(s, 40)).filter(Boolean))).slice(0, MAX_SECTIONS) as string[] : [];
    out.push({ id, itemId, name: words((e as any)?.name, 80) || 'Item', amount, measure: words((e as any)?.measure, 20) || 'each', per, when, sections });
  }
  return out;
}
export const extrasOf = (tenant: any): Extra[] => cleanExtras(tenant?.foodCost?.extras);
/** What card payments cost the business, as a share of what's charged (2.9% unless it set its own). */
export function cardFeeOf(tenant: any): number {
  const v = num(tenant?.foodCost?.cardFeePct); return tenant?.foodCost?.cardFeePct !== undefined && tenant?.foodCost?.cardFeePct !== null && v >= 0 && v <= CARD_FEE_MAX ? v : DEFAULT_CARD_FEE;
}
/** A card fee as typed (a percent, 0 to 10, to a hundredth), or null. */
export function cleanCardFee(v: unknown): number | null {
  const s = String(v ?? '').replace('%', '').trim(); if (!s) return null;
  const n = Number(s); return Number.isFinite(n) && n >= 0 && n <= CARD_FEE_MAX ? Math.round(n * 100) / 100 : null;
}

/** For here or to go: the drive-thru and an order placed ahead are always to go; at the counter or a kiosk, as the order
 *  says (for here unless it's marked to go). */
export function modeOf(channel: unknown, toGo?: unknown): Mode {
  if (channel === 'drive-thru' || channel === 'ahead') return 'togo';
  return toGo === true ? 'togo' : 'here';
}
const applies = (e: Extra, mode: Mode) => e.when === 'any' || e.when === mode;
/** The menu section an item is in (its category on the Menu page). */
export const sectionOf = (item: any) => words(item?.category || item?.department, 40);
const line = (e: Extra, times = 1): RecipeLine => ({ id: e.itemId, name: e.name, quantityUsed: Math.round(e.amount * times * 1000) / 1000, unit: e.measure, amount: Math.round(e.amount * times * 1000) / 1000, measure: e.measure });

/** What goes out with one of this menu item, for here or to go (a box for a main to go), as recipe lines. */
export function itemExtras(extras: Extra[], item: any, mode: Mode): RecipeLine[] {
  const sec = sectionOf(item).toLowerCase();
  return extras.filter((e) => e.per === 'item' && applies(e, mode) && (!e.sections.length || e.sections.some((s) => s.toLowerCase() === sec))).map((e) => line(e));
}
/** What goes out once with an order (a bag to go). */
export const orderExtras = (extras: Extra[], mode: Mode): RecipeLine[] => extras.filter((e) => e.per === 'order' && applies(e, mode)).map((e) => line(e));
/** What goes out for the guests at a table (bread and butter for each). */
export const guestExtras = (extras: Extra[], guests: number): RecipeLine[] => (guests > 0 ? extras.filter((e) => e.per === 'guest').map((e) => line(e, Math.min(50, Math.floor(guests)))) : []);

/** An extra in words: "for each item in Mains to go", "for each order to go", "for each guest at a table". */
export function extraWords(e: Extra): string {
  const when = e.when === 'togo' ? ' to go' : e.when === 'here' && e.per !== 'guest' ? ' for here' : '';
  if (e.per === 'guest') return 'for each guest at a table';
  if (e.per === 'order') return `for each order${when}`;
  return `for each ${e.sections.length ? `item in ${e.sections.join(' or ')}` : 'item'}${when}`;
}
