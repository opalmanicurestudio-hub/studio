// src/lib/price-creep.ts — PRICES THAT MOVED (design canvas "Food numbers": This week's numbers). What a business pays
// for an ingredient creeps up a delivery at a time, and a dish priced at 30% last spring is 36% now without anyone
// changing it. Each delivery keeps what it cost (Inventory's batches: received from an order, a quick receive or the
// stock page, at its cost a container); this compares the last one with the one before, and says which dishes and
// choices that moved: a dish pushed over the business's aim (and the price that brings it back), or a choice that no
// longer pays for itself.
//   moveOf     an ingredient's price in a stretch: what it was before (the last delivery before the stretch, else the
//              first in it), what it is now (the last in it), by 5% or more either way
//   effectsOf  what that one change did to each menu item and choice, everything else as it is
// Pure: the server (api/food-cost, api/ordering) and the screens work it out the same way.
import { itemCost, type ItemCost } from '@/lib/food-cost';

export const MOVE_MIN = 0.05;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export type Delivery = { id: string; at: string; cost: number };
/** What each delivery of it cost a container, oldest first. A count that found more than was on record isn't a delivery,
 *  nor is a batch with no cost or date, one put away at a typical price before the business said what it pays (marked
 *  `typical`), or one dated more than a day ahead (a device's clock that was wrong). */
export function deliveriesOf(item: any, now = Date.now()): Delivery[] {
  return (Array.isArray(item?.batches) ? item.batches : [])
    .filter((b: any) => { const t = Date.parse(String(b?.receivedDate || '')); return num(b?.costPerUnit) > 0 && !Number.isNaN(t) && t <= now + 864e5 && b?.typical !== true && b?.note !== 'Found in a count' && !String(b?.id || '').startsWith('count-'); })
    .map((b: any) => ({ id: String(b.id || ''), at: new Date(String(b.receivedDate)).toISOString(), cost: r2(num(b.costPerUnit)) }))
    .sort((a: Delivery, b: Delivery) => a.at.localeCompare(b.at));
}

export type Move = {
  id: string; name: string;
  /** What it's bought in ("case"), or '' when it isn't said. */
  container: string;
  from: number; to: number;
  /** The change, as a share of what it was (0.12 is 12% more). */
  pct: number; up: boolean;
  /** The delivery it changed on, and the latest one. */
  at: string; batchId: string;
  /** What the business's costs use for it now (Inventory's cost), when it isn't what the last delivery cost: set by hand
   *  since, or a delivery put away without typing its new price. */
  live: number | null;
};
/** What happened to an ingredient's price in a stretch [start, end): null unless it moved by 5% or more. */
export function moveOf(id: string, item: any, start: string, end?: string): Move | null {
  const all = deliveriesOf(item).filter((d) => !end || d.at < end);
  const inside = all.filter((d) => d.at >= start); if (!inside.length) return null;
  const before = all.filter((d) => d.at < start);
  const from = before.length ? before[before.length - 1].cost : inside[0].cost;
  const last = inside[inside.length - 1]; const to = last.cost;
  if (!(from > 0)) return null;
  const pct = (to - from) / from; if (Math.abs(pct) < MOVE_MIN - 1e-9) return null;
  // The delivery it changed on: the first in the stretch at more (or less) than it was by that much.
  const turned = inside.find((d) => Math.abs((d.cost - from) / from) >= MOVE_MIN - 1e-9) || last;
  return { id, name: String(item?.name || 'Ingredient').replace(/\s+/g, ' ').trim().slice(0, 80), container: String(item?.container || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    from, to, pct: Math.round(pct * 10000) / 10000, up: pct > 0, at: turned.at, batchId: last.id, live: Math.abs(r2(num(item?.costPerUnit)) - to) >= 0.01 ? r2(num(item?.costPerUnit)) : null };
}

export type DishHit = {
  id: string; name: string; price: number;
  before: number; after: number; shareBefore: number | null; shareAfter: number | null;
  /** Over the aim now, and not before. */
  crossed: boolean; over: boolean;
  /** The price that brings it back to the aim (lib/food-starters suggestPrice), when it's over. */
  fix: number | null;
};
export type OptionHit = { itemId: string; item: string; groupId: string; optionId: string; option: string; charges: number; costBefore: number; costAfter: number; keeps: number; thin: boolean };

/** A dish this change hurt: pushed over the aim, or further over it by two points or more. */
export const hurtBy = (d: DishHit) => d.crossed || (d.over && d.shareAfter !== null && d.shareBefore !== null && d.shareAfter - d.shareBefore >= 0.02 - 1e-9);

/** What one ingredient's change did, from what it cost to what it costs on the last delivery, everything else as it is
 *  now: each menu item whose cost to make moved (a cent or more), the ones pushed over the aim first; and each choice
 *  that changes the recipe and now barely pays for itself. */
export function effectsOf(move: Move, all0: Map<string, any>, menu: [string, any][], target: number): { dishes: DishHit[]; options: OptionHit[] } {
  const cur = all0.get(move.id);
  const all = new Map(all0); const was = new Map(all0);
  if (cur) { all.set(move.id, { ...cur, costPerUnit: move.to }); was.set(move.id, { ...cur, costPerUnit: move.from }); }
  const dishes: DishHit[] = []; const options: OptionHit[] = [];
  for (const [id, x] of menu) {
    const a: ItemCost = itemCost(id, x, all, target); const b: ItemCost = itemCost(id, x, was, target);
    if (a.cost !== null && b.cost !== null && Math.abs(a.cost - b.cost) >= 0.005) {
      dishes.push({ id, name: a.name, price: a.price, before: r2(b.cost), after: r2(a.cost), shareBefore: b.share, shareAfter: a.share, crossed: a.over && !b.over, over: a.over, fix: a.fix });
    }
    for (const o of a.options || []) {
      const ob = (b.options || []).find((y) => y.groupId === o.groupId && y.optionId === o.optionId);
      if (!ob || o.cost === null || ob.cost === null || o.keeps === null || Math.abs(o.cost - ob.cost) < 0.005) continue;
      if (o.thin && (!ob.thin || o.keeps < 0)) options.push({ itemId: id, item: a.name, groupId: o.groupId, optionId: o.optionId, option: o.option, charges: o.price, costBefore: r2(ob.cost), costAfter: r2(o.cost), keeps: r2(o.keeps), thin: o.thin });
    }
  }
  dishes.sort((p, q) => Number(q.crossed) - Number(p.crossed) || ((q.shareAfter || 0) - (q.shareBefore || 0)) - ((p.shareAfter || 0) - (p.shareBefore || 0)) || p.name.localeCompare(q.name));
  return { dishes, options };
}

/** The change in words: "up 12%, $38.40 to $43.00 a case". */
export function moveWords(m: Move): string {
  const $ = (n: number) => `$${n.toFixed(2)}`;
  return `${m.up ? 'up' : 'down'} ${Math.round(Math.abs(m.pct) * 100)}%, ${$(m.from)} to ${$(m.to)}${m.container ? ` a ${m.container}` : ''}`;
}
