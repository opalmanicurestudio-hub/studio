// src/lib/choice-recipe.ts — CHOICES THAT CHANGE WHAT'S MADE (design canvas "Food numbers": Choices and units). Oat milk,
// a large or an extra shot is charged for; each can change the recipe too, so the cost and the stock follow what's made:
//   add   — uses more of something: an extra shot adds 9 g of beans, a large adds 120 ml of milk
//   swap  — uses one thing instead of another: oat milk instead of whole, a 16 oz cup instead of a 12 oz one
//   out   — leaves something out: no onions
// Kept on each option of the item's own choices (`changes`), never sent to guests' menus (lib/menu-choices choiceGroups
// leaves them off). Applied in the menu's own order: what's added first, then what's swapped (a large oat latte is 360
// ml of oat milk), then what's left out. Pure: the same on the server and every screen.
import { recipeOf, type RecipeLine } from '@/lib/menu-stock';
import { cleanPicks, type Picks } from '@/lib/menu-choices';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const OID = /^[A-Za-z0-9_-]{1,40}$/;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const MAX_CHANGES = 4;

export type ChoiceChange =
  | { kind: 'add'; id: string; name: string; amount: number; measure: string }
  | { kind: 'swap'; from: string; fromName: string; to: string; toName: string }
  | { kind: 'out'; id: string; name: string };

/** One option's changes, cleaned (anything malformed left out, at most four). */
export function cleanChanges(v: unknown): ChoiceChange[] {
  const out: ChoiceChange[] = [];
  for (const c of (Array.isArray(v) ? v : []).slice(0, MAX_CHANGES)) {
    const k = String((c as any)?.kind || '');
    if (k === 'add') { const id = String((c as any).id || ''); const a = Math.round(num((c as any).amount) * 1000) / 1000; if (ID.test(id) && a > 0 && a <= 10000) out.push({ kind: 'add', id, name: words((c as any).name, 80) || 'Ingredient', amount: a, measure: words((c as any).measure, 20) || 'each' }); }
    else if (k === 'swap') { const from = String((c as any).from || ''), to = String((c as any).to || ''); if (ID.test(from) && ID.test(to) && from !== to) out.push({ kind: 'swap', from, fromName: words((c as any).fromName, 80) || 'Ingredient', to, toName: words((c as any).toName, 80) || 'Ingredient' }); }
    else if (k === 'out') { const id = String((c as any).id || ''); if (ID.test(id)) out.push({ kind: 'out', id, name: words((c as any).name, 80) || 'Ingredient' }); }
  }
  return out;
}

/** Every option's changes on an item, by "group/option". */
export function optionChanges(item: any): Map<string, ChoiceChange[]> {
  const m = new Map<string, ChoiceChange[]>();
  for (const g of Array.isArray(item?.choices) ? item.choices : []) for (const o of Array.isArray(g?.options) ? g.options : []) {
    const gid = String(g?.id || ''), oid = String(o?.id || ''); if (!OID.test(gid) || !OID.test(oid)) continue;
    const ch = cleanChanges(o?.changes); if (ch.length) m.set(`${gid}/${oid}`, ch);
  }
  return m;
}
export const changesRecipe = (item: any) => optionChanges(item).size > 0;

/** What's made for these picks: the item's recipe with each picked option's changes, in the menu's own order (adds,
 *  then swaps, then what's left out). A line can appear twice (the milk, and the extra milk a large adds): each is taken
 *  on its own, and lib/food-cost and lib/menu-stock add them up by ingredient. */
export function madeWith(item: any, itemId: string | undefined, picks?: Picks | null): RecipeLine[] {
  const base = recipeOf(item, itemId);
  const p = cleanPicks(picks || {}); if (!Object.keys(p).length) return base;
  const all = optionChanges(item); const picked: ChoiceChange[] = [];
  for (const g of Array.isArray(item?.choices) ? item.choices : []) for (const o of Array.isArray(g?.options) ? g.options : [])
    if ((p[String(g?.id)] || []).includes(String(o?.id))) picked.push(...(all.get(`${g.id}/${o.id}`) || []));
  if (!picked.length) return base;
  let lines: RecipeLine[] = base.map((l) => ({ ...l }));
  for (const c of picked) if (c.kind === 'add' && c.id !== itemId) lines.push({ id: c.id, name: c.name, quantityUsed: c.amount, unit: c.measure, amount: c.amount, measure: c.measure });
  for (const c of picked) if (c.kind === 'swap' && c.to !== itemId) lines = lines.map((l) => (l.id !== c.from ? l
    // The same amount of the other one: written in what the first was measured in, turned into the other's (lib/kitchen-units).
    : { id: c.to, name: c.toName, quantityUsed: l.quantityUsed, unit: l.unit, amount: l.measure ? l.amount : l.quantityUsed, measure: l.measure || l.unit }));
  for (const c of picked) if (c.kind === 'out') lines = lines.filter((l) => l.id !== c.id);
  return lines;
}

/** Every ingredient an item's choices can use that its recipe doesn't (what to read to cost or take them). */
export function changeIds(item: any): string[] {
  const s = new Set<string>();
  for (const ch of optionChanges(item).values()) for (const c of ch) { if (c.kind === 'add') s.add(c.id); if (c.kind === 'swap') s.add(c.to); }
  return Array.from(s);
}

/** A change in words: "Adds 9 g Espresso beans", "Oat milk instead of Whole milk", "Leaves out Onion". */
export function changeWords(c: ChoiceChange): string {
  if (c.kind === 'add') return `Adds ${Math.round(c.amount * 100) / 100} ${c.measure === 'each' ? '' : `${c.measure} `}${c.name}`.replace(/\s+/g, ' ');
  if (c.kind === 'swap') return `${c.toName} instead of ${c.fromName}`;
  return `Leaves out ${c.name}`;
}
