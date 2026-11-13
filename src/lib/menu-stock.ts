// src/lib/menu-stock.ts — CAN A MENU ITEM BE MADE RIGHT NOW? (server and screens). An item made from a recipe (a burger:
// a bun, a patty, two slices of cheese) is counted by what goes into it: it's available while every counted ingredient has
// enough for one, each one sold takes its ingredients off, and the item's own count isn't used. An item with no recipe (a
// bottled drink, a cookie bought in) is counted by itself, as before. An ingredient that can't be counted (counted by
// uses or by amount with no number set in Inventory) never holds an item back.
// The recipe is kept on the item as `formula` (what the kitchen screen shows and lib/counter-server takes off stock):
// [{ id, name, quantityUsed, unit }], set on the Menu page (api/menu 'save').
import { usesLeft, unitLabel } from '@/lib/product-cost';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export const MAX_RECIPE_LINES = 20;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export type RecipeLine = { id: string; name: string; quantityUsed: number; unit: string };
export type MenuStock = { inStock: boolean; short: string | null; canMake: number | null; byRecipe: boolean };

/** An item's recipe, cleaned: one line per ingredient (amounts of one listed twice added together), never itself. */
export function recipeOf(item: any, itemId?: string): RecipeLine[] {
  const out: RecipeLine[] = [];
  for (const f of Array.isArray(item?.formula) ? item.formula : []) {
    const id = String(f?.id || ''); const q = num(f?.quantityUsed);
    if (!ID.test(id) || id === itemId || !(q > 0)) continue;
    const same = out.find((l) => l.id === id);
    if (same) { same.quantityUsed = Math.round((same.quantityUsed + q) * 1000) / 1000; continue; }
    if (out.length >= MAX_RECIPE_LINES) break;
    out.push({ id, name: String(f?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Ingredient', quantityUsed: Math.round(q * 1000) / 1000, unit: String(f?.unit || '').slice(0, 20) || 'each' });
  }
  return out;
}
export const hasRecipe = (item: any, itemId?: string) => recipeOf(item, itemId).length > 0;

/** How much of an ingredient is left, in what a recipe uses of it (each, uses, ml...); null when it can't be counted. */
export function ingredientLeft(part: any): number | null {
  if (!part || part.archived === true || part.status === 'archived') return null;
  // A menu item made from its own recipe has no count of its own to go by.
  if (part.type === 'refreshment' && recipeOf(part).length) return null;
  return usesLeft(part);
}
/** What a recipe line is measured in, for an ingredient as Inventory counts it. */
export const ingredientUnit = (part: any) => unitLabel(part);

/** Whether the item can be made now, and if not, the first ingredient that's run short (or nothing, when it's its own
 *  count that's at none). `canMake`: how many could be made from what's counted (null: nothing counted). `parts`: the
 *  ingredients by id, as read. */
export function stockOf(item: any, itemId: string, parts: Map<string, any>): MenuStock {
  const recipe = recipeOf(item, itemId);
  if (!recipe.length) { const own = num(item?.totalStock); return { inStock: own > 0, short: null, canMake: Math.max(0, Math.floor(own)), byRecipe: false }; }
  let canMake: number | null = null; let short: string | null = null;
  for (const l of recipe) {
    const p = parts.get(l.id); const left = ingredientLeft(p); if (left === null) continue;
    const n = Math.floor(left / l.quantityUsed + 1e-9);
    if (canMake === null || n < canMake) canMake = n;
    if (n < 1 && !short) short = String(p?.name || l.name || 'an ingredient').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  return { inStock: canMake === null || canMake >= 1, short, canMake, byRecipe: true };
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
