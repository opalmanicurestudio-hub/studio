// src/lib/choice-sets.ts — CHOICE SETS: SET ONCE, USE EVERYWHERE (design canvas "Food numbers": Choice sets). Milk,
// Syrups, Espresso shots, Bread, Leave out: made once and turned on for each item that has it. A set is the same on
// every item it's on, so oat milk's price changes in one place for every drink, and oat milk sold out is sold out on all
// of them. Kept in tenants/{t}/choiceSets/{id} (lib/choice-sets-server, api/menu); each item carries its own copy as one
// of its choices (inventory item `choices`, a group with `setId`), so every menu, order and kitchen screen reads items
// exactly as before.
//   Three kinds, so nobody has to think about the settings:
//     one       Pick one: a size, a milk, the bread. One is always picked (unless it's optional); it starts on the first.
//     addons    Add-ons: an extra shot, syrups, avocado. Each adds to the price; up to so many.
//     leaveout  Leave out: no onions, sauce on the side. Free.
//   Each option can change the recipe (lib/choice-recipe): use more of something, use something instead, leave
//   something out. On each item only what fits its own recipe is kept (oat instead of whole milk does nothing on a drink
//   with no milk).
// Pure.
import { cleanChanges, type ChoiceChange } from '@/lib/choice-recipe';
import { MAX_OPTIONS } from '@/lib/menu-choices';

export type SetKind = 'one' | 'addons' | 'leaveout';
export type SetOption = { id: string; name: string; price: number; soldOut: boolean; soldOutUntil?: string | null; changes?: ChoiceChange[] };
export type ChoiceSet = { id: string; name: string; kind: SetKind; required: boolean; max: number; options: SetOption[] };
export const SET_KINDS: { id: SetKind; label: string; words: string }[] = [
  { id: 'one', label: 'Pick one', words: 'A size, a milk, the bread. One is always picked; it starts on the first.' },
  { id: 'addons', label: 'Add-ons', words: 'An extra shot, syrups, avocado. Each adds to the price; set how many.' },
  { id: 'leaveout', label: 'Leave out', words: 'No onions, sauce on the side. Free, and the ticket says it plainly.' },
];
export const MAX_SETS = 60;
const OID = /^[A-Za-z0-9_-]{1,40}$/;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const cents = (v: unknown) => { const x = Math.round(Number(v) * 100) / 100; return Number.isFinite(x) ? Math.max(-1000, Math.min(1000, x)) : NaN; };

/** A set as the business typed it, cleaned (ids kept, new ones made), or what's wrong with it. */
export function cleanSet(raw: any, newId: () => string): Omit<ChoiceSet, 'id'> | { error: string } {
  const name = words(raw?.name, 40); if (!name) return { error: 'Give the set a name, like Milk or Syrups.' };
  const kind: SetKind = raw?.kind === 'addons' ? 'addons' : raw?.kind === 'leaveout' ? 'leaveout' : 'one';
  const given = (Array.isArray(raw?.options) ? raw.options : []).filter((o: any) => words(o?.name, 40));
  if (!given.length) return { error: 'Add at least one option, with a name.' };
  if (given.length > MAX_OPTIONS) return { error: `Up to ${MAX_OPTIONS} options in a set.` };
  const seen = new Set<string>(); const options: SetOption[] = [];
  for (const o of given) {
    let id = OID.test(String(o?.id || '')) ? String(o.id) : newId(); if (seen.has(id)) id = newId(); seen.add(id);
    const price = kind === 'leaveout' ? 0 : cents(o?.price === '' || o?.price === undefined || o?.price === null ? 0 : o.price);
    if (Number.isNaN(price)) return { error: `What does ${words(o.name, 40)} add? Type an amount, like 0.75, or leave it at 0.` };
    const changes = cleanChanges(o?.changes);
    options.push({ id, name: words(o.name, 40), price, soldOut: o?.soldOut === true, ...(o?.soldOutUntil ? { soldOutUntil: String(o.soldOutUntil) } : {}), ...(changes.length ? { changes } : {}) });
  }
  const required = kind === 'one' ? raw?.required !== false : false;
  const max = kind === 'one' ? 1 : kind === 'leaveout' ? options.length : Math.max(1, Math.min(options.length, Math.floor(Number(raw?.max)) || options.length));
  return { name, kind, required, max, options };
}

/** What a set reads as in a list: "Pick one", "Add-ons, up to 3", "Leave out". */
export function setRule(s: Pick<ChoiceSet, 'kind' | 'required' | 'max' | 'options'>): string {
  if (s.kind === 'one') return s.required ? 'Pick one' : 'Pick one, or none';
  if (s.kind === 'leaveout') return 'Leave out, free';
  return s.max < s.options.length ? `Add-ons, up to ${s.max}` : 'Add-ons';
}
/** Its options in a line: "Whole, Oat +$0.75, Almond +$0.75". */
export const optionsLine = (s: Pick<ChoiceSet, 'options'>) => s.options.map((o) => (o.price ? `${o.name} ${o.price > 0 ? '+' : '−'}$${Math.abs(o.price).toFixed(2)}` : o.name)).join(', ');

/** The set as one of an item's choices (its own group id on that item): what every menu reads. The recipe changes are
 *  the set's; the server keeps on each item only those that fit its recipe. Each option keeps the id it already has on
 *  the item (`idOf`: the set's option id to the item's), since that's what its orders, tickets and past sales were kept
 *  with; one new to the item takes the set's id (or one like it, if the item already uses that id), and an option whose
 *  id isn't the set's says which of the set's it is (`setOption`). */
export function groupOfSet(s: ChoiceSet, groupId: string, changesFor?: (o: SetOption) => ChoiceChange[] | undefined, idOf?: Map<string, string>) {
  const mapped = new Set(s.options.map((o) => idOf?.get(o.id)).filter((x): x is string => !!x && OID.test(x))); const used = new Set<string>();
  return { id: groupId, setId: s.id, name: s.name, pick: s.kind === 'one' ? 'one' : 'any', required: s.required, max: s.max,
    options: s.options.map((o) => {
      let id = idOf?.get(o.id) || '';
      if (!OID.test(id) || used.has(id)) { id = o.id; let k = 2; while (used.has(id) || (mapped.has(id) && idOf?.get(o.id) !== id)) id = `${o.id.slice(0, 36)}_${k++}`; }
      used.add(id);
      const ch = changesFor ? changesFor(o) : o.changes;
      return { id, ...(id !== o.id ? { setOption: o.id } : {}), name: o.name, price: o.price, soldOut: o.soldOut === true, soldOutUntil: o.soldOutUntil || null, ...(ch && ch.length ? { changes: ch } : {}) };
    }) };
}
/** On an item, which of its ids each of a set's options has: the set's option id to the item's (from the group as kept). */
export function idsOnItem(g: any): Map<string, string> {
  const out = new Map<string, string>();
  for (const o of Array.isArray(g?.options) ? g.options : []) {
    const id = String(o?.id || ''); if (!OID.test(id)) continue;
    const so = OID.test(String(o?.setOption || '')) ? String(o.setOption) : id; if (!out.has(so)) out.set(so, id);
  }
  return out;
}
/** The sets an item's choices come from (kept on the item as `choiceSetIds`, so the items with a set are found at once). */
export const setIdsOf = (choices: unknown): string[] => Array.from(new Set((Array.isArray(choices) ? choices : []).map((g: any) => String(g?.setId || '')).filter((x) => /^[A-Za-z0-9_-]{1,160}$/.test(x)))).slice(0, 20);

/** The kind a group from an item reads as: pick one; add-ons; or, all free under a "leave out"-like name, leave out. */
export function kindOfGroup(g: { name: string; pick: string; options: { price: number }[] }): SetKind {
  if (g.pick === 'one') return 'one';
  return g.options.every((o) => !o.price) && /leave|without|\bno\b|hold|remove/i.test(g.name) ? 'leaveout' : 'addons';
}
/** Two items' groups are the same choice when their name, how they're picked and their options (names and prices, in
 *  order) match: such a choice can become one set. */
export function groupKey(g: { name: string; pick: string; required?: boolean; max?: number; options: { name: string; price: number }[] }): string {
  return JSON.stringify([words(g.name, 40).toLowerCase(), g.pick, g.pick === 'one' ? g.required !== false : g.max, g.options.map((o) => [words(o.name, 40).toLowerCase(), Math.round(Number(o.price) * 100)])]);
}
