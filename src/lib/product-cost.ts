// src/lib/product-cost.ts — pure helpers about an inventory item's cost per use (safe on screens and the server).
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** How many uses / ml / g a container holds, by its costing method (1 = priced per item). */
export const containerSize = (it: any) => (it?.costingMethod === 'uses' ? n(it.estimatedUses) : it?.costingMethod === 'size' ? n(it.size) : 1) || 1;
/** Can this item's cost be counted per use? null when fine, else a short reason — shared by the item page, the service
 *  recipe and the restocking fund so they always agree. */
export function costGap(it: any): string | null {
  if (!it) return 'not found';
  if (!(n(it.costPerUnit) > 0)) return 'no cost';
  if (it.costingMethod === 'size' && !(n(it.size) > 0)) return 'no container size';
  if (it.costingMethod === 'uses' && !(n(it.estimatedUses) > 0)) return 'no number of uses';
  if (!it.costingMethod && /ml|g|oz/i.test(String(it.useUnit || ''))) return 'no container size or uses';
  return null;
}
