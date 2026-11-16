// src/lib/menu-stock.ts — CAN A MENU ITEM BE MADE RIGHT NOW? (server and screens). An item made from a recipe (a burger:
// a bun, a patty, two slices of cheese) is counted by what goes into it: it's available while every counted ingredient has
// enough for one, each one sold takes its ingredients off, and the item's own count isn't used. An item with no recipe (a
// bottled drink, a cookie bought in) is counted by itself, as before. An ingredient that can't be counted (counted by
// uses or by amount with no number set in Inventory) never holds an item back.
// The recipe is kept on the item as `formula` (what the kitchen screen shows and lib/counter-server takes off stock):
// [{ id, name, quantityUsed, unit, amount?, measure? }], set on the Menu page (api/menu 'save'): quantityUsed is in what the
// ingredient is counted in; a line written in a kitchen measure (2 tbsp, 6 oz) keeps what was written too, so it's turned
// again if the ingredient's measure changes (lib/kitchen-units). What a line takes off stock adds what trimming and
// cooking lose (lib/kitchen-units stockNeed): 6 oz of salmon that's 65% usable takes 9.2 oz.
import { usesLeft, unitLabel } from '@/lib/product-cost';
import { stockNeed } from '@/lib/kitchen-units';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export const MAX_RECIPE_LINES = 20;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export type RecipeLine = { id: string; name: string; quantityUsed: number; unit: string; amount?: number; measure?: string };
export type MenuStock = { inStock: boolean; short: string | null; canMake: number | null; byRecipe: boolean };

/** An item's recipe, cleaned: one line per ingredient (amounts of one listed twice added together), never itself. */
export function recipeOf(item: any, itemId?: string): RecipeLine[] {
  const out: RecipeLine[] = [];
  for (const f of Array.isArray(item?.formula) ? item.formula : []) {
    const id = String(f?.id || ''); const q = num(f?.quantityUsed);
    if (!ID.test(id) || id === itemId || !(q > 0)) continue;
    const a = num(f?.amount); const m = String(f?.measure || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    const same = out.find((l) => l.id === id);
    // One listed twice: the two added up, in what it's counted in, kept as written in that measure (so it's still turned
    // again if the ingredient's measure changes).
    if (same) { same.quantityUsed = Math.round((same.quantityUsed + q) * 1000) / 1000; same.amount = same.quantityUsed; same.measure = same.unit; continue; }
    if (out.length >= MAX_RECIPE_LINES) break;
    out.push({ id, name: String(f?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Ingredient', quantityUsed: Math.round(q * 1000) / 1000, unit: String(f?.unit || '').slice(0, 20) || 'each',
      ...(a > 0 && m ? { amount: Math.round(a * 1000) / 1000, measure: m } : {}) });
  }
  return out;
}
export const hasRecipe = (item: any, itemId?: string) => recipeOf(item, itemId).length > 0;
/** Offered to guests and sold: on the menu, and never a starter menu item still at no price (lib/food-starters), however
 *  it was switched on. */
export const offeredOnMenu = (item: any) => !!item && item.showInConcierge !== false && !(item.createdVia === 'food-starter' && !(Number(item.price) > 0));

/** How much of an ingredient is left, in what a recipe uses of it (each, uses, ml...); null when it can't be counted. */
export function ingredientLeft(part: any): number | null {
  if (!part || part.archived === true || part.status === 'archived') return null;
  // Not counted yet (a starter ingredient before its first count or delivery, lib/food-starters): never holds an item back.
  if (part.countStock === false) return null;
  // A menu item made from its own recipe has no count of its own to go by.
  if (part.type === 'refreshment' && recipeOf(part).length) return null;
  return usesLeft(part);
}
/** What a recipe line is measured in, for an ingredient as Inventory counts it. */
export const ingredientUnit = (part: any) => unitLabel(part);

/** Whether the item can be made now, and if not, the first ingredient that's run short (or nothing, when it's its own
 *  count that's at none). `canMake`: how many could be made from what's counted (null: nothing counted). `parts`: the
 *  ingredients by id, as read. */
export function stockOf(item: any, itemId: string, parts: Map<string, any>, lines?: RecipeLine[]): MenuStock {
  // A combo has no count of its own: it's made from its parts, each counted as itself (lib/menu-server readMenu).
  if (item?.combo === true) return { inStock: true, short: null, canMake: null, byRecipe: false };
  // `lines`: what's made for a guest's choices (lib/choice-recipe madeWith), when it's asked for those.
  const recipe = lines || recipeOf(item, itemId);
  if (!recipe.length) { const own = num(item?.totalStock); return { inStock: own > 0, short: null, canMake: Math.max(0, Math.floor(own)), byRecipe: false }; }
  let canMake: number | null = null; let short: string | null = null;
  for (const [id, need] of needsOf(recipe, parts)) {
    const p = parts.get(id); const left = ingredientLeft(p); if (left === null || !(need > 0)) continue;
    const n = Math.floor(left / need + 1e-9);
    if (canMake === null || n < canMake) canMake = n;
    if (n < 1 && !short) short = String(p?.name || recipe.find((l) => l.id === id)?.name || 'an ingredient').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  return { inStock: canMake === null || canMake >= 1, short, canMake, byRecipe: true };
}

/** What one made takes of each ingredient, in what it's counted in, with what trimming and cooking lose (lib/kitchen-units
 *  stockNeed): an ingredient on two lines (the milk, and the extra milk a large adds) once, added up. */
export function needsOf(lines: RecipeLine[], parts: Map<string, any>): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) { const need = stockNeed(l, parts.get(l.id)); if (need > 0) m.set(l.id, Math.round(((m.get(l.id) || 0) + need) * 1000) / 1000); }
  return m;
}

/** Every ingredient id the given items' recipes use, that isn't one of the items themselves (those are read already). */
export function ingredientIds(items: { id: string; i: any }[]): string[] {
  const have = new Set(items.map((x) => x.id)); const ids = new Set<string>();
  for (const x of items) for (const l of recipeOf(x.i, x.id)) if (!have.has(l.id)) ids.add(l.id);
  return Array.from(ids).slice(0, 400);
}

/** Words for an item that can't be made right now: switched off, an ingredient run out, or none of it left. */
export function outWords(m: { soldOut: boolean; inStock: boolean; short?: string | null }): string | null {
  if (m.soldOut) return 'Sold out';
  if (m.inStock) return null;
  return m.short ? `Out of ${m.short}` : 'None in stock';
}
