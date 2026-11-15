// src/lib/recipe-stock-server.ts — WHAT A MADE DISH USES UP, inside a save (the server). A menu item made from a recipe
// (lib/menu-stock recipeOf) uses up its ingredients once it's made: a table's, the desk's or an event's ticket when the
// kitchen marks it ready or served (api/kitchen), a held batch's portions as they go out or are thrown out, a started
// dish voided or made again (api/tab). Each is recorded on the stock history with why, so the next count can say how
// much more went than was made (lib/food-cost). An ingredient that isn't counted yet (lib/menu-stock ingredientLeft
// null: a starter ingredient before its first count or delivery, or one put away) is left alone, so its first count is
// where its history starts. Reads come first, then writes, as a transaction needs.
import { recipeOf, ingredientLeft } from '@/lib/menu-stock';
import { moveStock } from '@/lib/usage';
import { buildEntry } from '@/lib/stock-ledger';
import { ledgerUnit } from '@/lib/food-cost';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export type PartTake = { ref: any; data: any; qty: number };

/** Reads, inside the caller's transaction, the counted ingredients `qty` of a menu item uses. [] for an item with no
 *  recipe (a can of soda is taken off when it's sold, never here). `item`: the item, when the caller has read it. */
export async function readRecipeParts(tx: any, db: any, T: string, itemId: string, qty: number, item?: any): Promise<PartTake[]> {
  if (!ID.test(String(itemId || '')) || !(qty > 0)) return [];
  const x = item !== undefined ? item : (await tx.get(db.doc(`${T}/inventory/${itemId}`))).data();
  const lines = recipeOf(x, itemId); if (!lines.length) return [];
  const refs = lines.map((l) => db.doc(`${T}/inventory/${l.id}`));
  const snaps = await Promise.all(refs.map((r) => tx.get(r)));
  const out: PartTake[] = [];
  lines.forEach((l, i) => { const d = snaps[i].data(); if (d && ingredientLeft(d) !== null) out.push({ ref: refs[i], data: d, qty: Math.round(l.quantityUsed * qty * 1000) / 1000 }); });
  return out;
}

/** Parts read for several items at once, one per ingredient (two items that share milk take both amounts, in one write). */
export function mergeParts(parts: PartTake[]): PartTake[] {
  const by = new Map<string, PartTake>();
  for (const p of parts) { const cur = by.get(p.ref.id); if (cur) cur.qty = Math.round((cur.qty + p.qty) * 1000) / 1000; else by.set(p.ref.id, { ...p }); }
  return Array.from(by.values());
}

/** Takes what was read off stock and records each on the history (`used`, or `spoiled` for waste). A part with no size
 *  or uses set is left as it is (lib/usage moveStock). Returns how many moved. */
export function takeParts(tx: any, db: any, T: string, parts: PartTake[], o: { type: 'used' | 'spoiled'; reason: string; actorId: string; actorName: string; ref: { kind: 'order' | 'formula'; id: string } }): number {
  let n = 0;
  for (const p of parts) {
    const m = moveStock(p.data, p.qty); if (m.notCounted) continue;
    tx.set(p.ref, m.patch, { merge: true });
    tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: p.ref.id, type: o.type, delta: -p.qty, unit: ledgerUnit(p.data), reason: o.reason.slice(0, 200), actorId: o.actorId, actorName: o.actorName, ref: o.ref }));
    n++;
  }
  return n;
}
