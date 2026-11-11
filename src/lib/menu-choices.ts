// src/lib/menu-choices.ts — CHOICES ON A MENU ITEM (pure; the same on the server and every screen): a size, a milk,
// extras, "no onions", each with its own price (more, less, or nothing). An item keeps its groups on its own record
// (inventory item `choices`), the business edits them with the item, and the guest picks them where they order.
//   A group is "pick one" (a size: exactly one when it's required, at most one when it isn't) or "pick any" (extras, up
//   to a most). An option can be sold out tonight (the kitchen's "Sold out" switch), and is then shown but not picked.
// The server never takes a price from a browser: priceChoices() works out what was picked from the item itself, refuses
// anything that isn't on it, and gives back the lines kept on the order (so a later menu change never rewrites what
// someone ordered), the amount they add, and the words the kitchen reads ("Large, oat milk, extra shot").

export type ChoiceOption = { id: string; name: string; price: number; soldOut: boolean };
export type ChoiceGroup = { id: string; name: string; pick: 'one' | 'any'; required: boolean; max: number; options: ChoiceOption[] };
export type PickedChoice = { groupId: string; group: string; optionId: string; option: string; price: number };
export type Picks = Record<string, string[]>;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_GROUPS = 8, MAX_OPTIONS = 20;

/** Sold out right now: switched off, and not past the time it comes back on its own (the next morning, so "sold out
 *  tonight" never hides it tomorrow; lib/menu-server sets the time). */
export function outNow(x: any, now = Date.now()): boolean {
  if (x?.soldOut !== true) return false;
  const until = Date.parse(String(x?.soldOutUntil || ''));
  return !Number.isFinite(until) || until > now;
}
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const cents = (v: unknown) => { const x = Math.round(Number(v) * 100) / 100; return Number.isFinite(x) ? Math.max(-1000, Math.min(1000, x)) : 0; };
export const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

/** An item's groups, cleaned: what a screen shows and what the server prices against. Anything malformed is left out. */
export function choiceGroups(item: any): ChoiceGroup[] {
  const raw = Array.isArray(item?.choices) ? item.choices : [];
  const out: ChoiceGroup[] = [];
  const seenG = new Set<string>();
  for (const g of raw.slice(0, MAX_GROUPS)) {
    const id = String(g?.id || ''); const name = words(g?.name, 40);
    if (!ID.test(id) || !name || seenG.has(id)) continue;
    seenG.add(id);
    const seenO = new Set<string>();
    const options: ChoiceOption[] = [];
    for (const o of (Array.isArray(g?.options) ? g.options : []).slice(0, MAX_OPTIONS)) {
      const oid = String(o?.id || ''); const oname = words(o?.name, 40);
      if (!ID.test(oid) || !oname || seenO.has(oid)) continue;
      seenO.add(oid); options.push({ id: oid, name: oname, price: cents(o?.price), soldOut: outNow(o) });
    }
    if (!options.length) continue;
    const pick: 'one' | 'any' = g?.pick === 'any' ? 'any' : 'one';
    const max = pick === 'one' ? 1 : Math.max(1, Math.min(options.length, Math.floor(Number(g?.max)) || options.length));
    out.push({ id, name, pick, required: pick === 'one' ? g?.required !== false : g?.required === true, max, options });
  }
  return out;
}

/** Is the whole item off tonight? (The kitchen's one-tap "Sold out".) */
export const itemSoldOut = (item: any) => outNow(item);

/** Can it be ordered at all right now: not sold out, and every choice they must make still has something left. */
export function orderable(item: any): boolean {
  if (itemSoldOut(item)) return false;
  return choiceGroups(item).every((g) => !g.required || g.options.some((o) => !o.soldOut));
}

/** What a guest sees first when nothing's picked: the plain price, or "from" the cheapest a required choice allows. */
export function startingPrice(item: any): { price: number; from: boolean } {
  const base = cents(item?.price);
  let low = base; let varies = false;
  for (const g of choiceGroups(item)) {
    const prices = g.options.filter((o) => !o.soldOut).map((o) => o.price);
    if (!prices.length) continue;
    if (new Set(prices).size > 1 || prices[0] !== 0) varies = true;
    if (g.required && g.pick === 'one') low += Math.min(...prices);
  }
  return { price: Math.max(0, Math.round(low * 100) / 100), from: varies };
}

/** The choices a group starts with: the first option still available, for a required "pick one" (a size defaults to the
 *  first listed); nothing otherwise. */
export function defaultPicks(item: any): Picks {
  const out: Picks = {};
  for (const g of choiceGroups(item)) if (g.required && g.pick === 'one') { const o = g.options.find((x) => !x.soldOut); if (o) out[g.id] = [o.id]; }
  return out;
}

/** What these picks come to, checked against the item: the lines kept on the order, what they add to the price, and
 *  the kitchen's words. Refuses a required group left empty, too many in a group, an option that isn't on the item, and
 *  one that's sold out. */
export function priceChoices(item: any, picks: unknown): { ok: true; lines: PickedChoice[]; extra: number; text: string } | { ok: false; error: string } {
  const groups = choiceGroups(item);
  const given: Picks = picks && typeof picks === 'object' && !Array.isArray(picks) ? picks as Picks : {};
  for (const k of Object.keys(given)) if (!groups.some((g) => g.id === k)) return { ok: false, error: 'That choice isn’t on this item any more. Please choose again.' };
  const lines: PickedChoice[] = [];
  for (const g of groups) {
    const ids = Array.from(new Set((Array.isArray(given[g.id]) ? given[g.id] : []).map(String)));
    if (ids.some((id) => !g.options.some((o) => o.id === id))) return { ok: false, error: 'That choice isn’t on this item any more. Please choose again.' };
    if (g.required && ids.length === 0) return { ok: false, error: `Choose a ${g.name.toLowerCase()}.` };
    if (ids.length > g.max) return { ok: false, error: g.pick === 'one' ? `Choose one ${g.name.toLowerCase()}.` : `Choose up to ${g.max} ${g.name.toLowerCase()}.` };
    for (const o of g.options) {   // in the menu's own order, so the kitchen always reads them the same way
      if (!ids.includes(o.id)) continue;
      if (o.soldOut) return { ok: false, error: `${o.name} is sold out right now.` };
      lines.push({ groupId: g.id, group: g.name, optionId: o.id, option: o.name, price: o.price });
    }
  }
  const extra = Math.round(lines.reduce((s, l) => s + l.price, 0) * 100) / 100;
  return { ok: true, lines, extra, text: choicesText(lines) };
}

/** The words for an order's choices, as the kitchen reads them: "Large, Oat, Extra shot". */
export function choicesText(lines: { option: string }[] | null | undefined): string {
  return (Array.isArray(lines) ? lines : []).map((l) => words(l?.option, 40)).filter(Boolean).join(', ');
}

/** The groups as the business edits them, cleaned for saving (ids made where missing, empties dropped). */
export function cleanForSave(groups: unknown, newId: () => string): ChoiceGroup[] {
  const raw = (Array.isArray(groups) ? groups : []).map((g: any) => ({
    ...g, id: ID.test(String(g?.id || '')) ? g.id : newId(),
    options: (Array.isArray(g?.options) ? g.options : []).map((o: any) => ({ ...o, id: ID.test(String(o?.id || '')) ? o.id : newId() })),
  }));
  return choiceGroups({ choices: raw });
}
