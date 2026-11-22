// src/lib/recipe-stock-server.ts — WHAT A MADE DISH USES UP, inside a save (the server). A menu item made from a recipe
// (lib/menu-stock recipeOf) uses up its ingredients once it's made: a table's, the desk's or an event's ticket when the
// kitchen marks it ready or served (api/kitchen), a held batch's portions as they go out or are thrown out, a started
// dish voided or made again (api/tab). Each is recorded on the stock history with why, so the next count can say how
// much more went than was made (lib/food-cost). An ingredient that isn't counted yet (lib/menu-stock ingredientLeft
// null: a starter ingredient before its first count or delivery, or one put away) is left alone, so its first count is
// where its history starts. Reads come first, then writes, as a transaction needs.
//   What's taken is what's made: the recipe with the guest's choices (lib/choice-recipe: oat milk instead of whole, an
//   extra shot), each line in what its ingredient is counted in, with what trimming and cooking lose (lib/kitchen-units).
import { ingredientLeft, needsOf } from '@/lib/menu-stock';
import { madeWith } from '@/lib/choice-recipe';
import type { RecipeLine } from '@/lib/menu-stock';
import { picksOf, type Picks } from '@/lib/menu-choices';
import { moveStock } from '@/lib/usage';
import { buildEntry } from '@/lib/stock-ledger';
import { ledgerUnit } from '@/lib/food-cost';
import { storeFollowNested } from '@/lib/store-stock';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
/** `extra`: how much of `qty` is what goes out with it, set once (a box to go, lib/plate-extras), recorded apart. */
export type PartTake = { ref: any; data: any; qty: number; extra?: number };

/** Reads, inside the caller's transaction, the counted ingredients `qty` of a menu item uses. [] for an item with no
 *  recipe (a can of soda is taken off when it's sold, never here). `item`: the item, when the caller has read it.
 *  `choices`: what the guest picked, as kept on the ticket (its choice lines, or picks). */
export async function readRecipeParts(tx: any, db: any, T: string, itemId: string, qty: number, item?: any, choices?: unknown, extrasFor?: (x: any) => RecipeLine[]): Promise<PartTake[]> {
  if (!ID.test(String(itemId || '')) || !(qty > 0)) return [];
  const x = item !== undefined ? item : (await tx.get(db.doc(`${T}/inventory/${itemId}`))).data();
  // `extrasFor`: what goes out with one, set once (lib/plate-extras), for an item with a recipe or without.
  const lines = madeWith(x, itemId, picksFrom(choices)); const extra = x && extrasFor ? extrasFor(x) : [];
  if (!lines.length && !extra.length) return [];
  const ids = Array.from(new Set([...lines, ...extra].map((l) => l.id))).filter((id) => ID.test(id));
  const refs = ids.map((id) => db.doc(`${T}/inventory/${id}`));
  const snaps = await Promise.all(refs.map((r) => tx.get(r)));
  const parts = new Map<string, any>(); ids.forEach((id, i) => { const d = snaps[i].data(); if (d) parts.set(id, d); });
  return partTakes(needsOf(lines, parts), needsOf(extra, parts), parts, refs, ids, qty);
}
/** One take per ingredient: what the recipe uses and what goes out with it added up (one write), the second kept apart. */
export function partTakes(recipe: Map<string, number>, extra: Map<string, number>, parts: Map<string, any>, refs: any[], ids: string[], qty: number): PartTake[] {
  const out: PartTake[] = [];
  for (const id of Array.from(new Set([...recipe.keys(), ...extra.keys()]))) {
    const d = parts.get(id); if (!d || ingredientLeft(d) === null) continue;
    const r = Math.round((recipe.get(id) || 0) * qty * 1000) / 1000, e = Math.round((extra.get(id) || 0) * qty * 1000) / 1000;
    if (r + e > 0) out.push({ ref: refs[ids.indexOf(id)], data: d, qty: Math.round((r + e) * 1000) / 1000, ...(e > 0 ? { extra: e } : {}) });
  }
  return out;
}
/** Picks from what a ticket or a sale line kept: its choice lines ([{ groupId, optionId }]) or its picks. */
export function picksFrom(v: unknown): Picks | null {
  if (!v) return null;
  if (Array.isArray(v)) return picksOf(v);
  return typeof v === 'object' ? (v as Picks) : null;
}

/** Parts read for several items at once, one per ingredient (two items that share milk take both amounts, in one write). */
export function mergeParts(parts: PartTake[]): PartTake[] {
  const by = new Map<string, PartTake>();
  for (const p of parts) { const cur = by.get(p.ref.id); if (cur) { cur.qty = Math.round((cur.qty + p.qty) * 1000) / 1000; if (p.extra) cur.extra = Math.round(((cur.extra || 0) + p.extra) * 1000) / 1000; } else by.set(p.ref.id, { ...p }); }
  return Array.from(by.values());
}

/** Takes what was read off stock and records each on the history (`used`, or `spoiled` for waste). A part with no size
 *  or uses set is left as it is (lib/usage moveStock). Returns how many moved. `at`: with more than one location, where
 *  it was made: off that location's own number too, for a part counted there (lib/store-stock). */
export function takeParts(tx: any, db: any, T: string, parts: PartTake[], o: { type: 'used' | 'spoiled'; reason: string; actorId: string; actorName: string; ref: { kind: 'order' | 'formula'; id: string }; at?: string | null }): number {
  let n = 0;
  for (const p of parts) {
    const m = moveStock(p.data, p.qty); if (m.notCounted) continue;
    tx.set(p.ref, { ...m.patch, ...(o.at ? storeFollowNested(p.data, o.at, m.patch.totalStock) : {}) }, { merge: true });
    // What goes out with it (a box, a lid) on a line of its own, marked, so a report can tell it from the recipe.
    // (Only what was there is counted as going out with it: run out of boxes, and the boxes not given aren't costed.)
    const own = Math.round((p.qty - (p.extra || 0)) * 1000) / 1000; const extra = p.extra ? Math.max(0, Math.round((p.extra - m.shortfall) * 1000) / 1000) : 0;
    if (own > 0) tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: p.ref.id, type: o.type, delta: -own, unit: ledgerUnit(p.data), reason: o.reason.slice(0, 200), actorId: o.actorId, actorName: o.actorName, ref: o.ref, ...(o.at ? { storeId: o.at } : {}) }));
    if (extra > 0) tx.set(db.collection(`${T}/stockCorrections`).doc(), { ...buildEntry({ productId: p.ref.id, type: o.type, delta: -extra, unit: ledgerUnit(p.data), reason: `${o.reason.slice(0, 160)}: what goes out with it`, actorId: o.actorId, actorName: o.actorName, ref: o.ref, ...(o.at ? { storeId: o.at } : {}) }), extra: true });
    n++;
  }
  return n;
}
