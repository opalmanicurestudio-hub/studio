// src/lib/menu-choices.ts — CHOICES ON A MENU ITEM (pure; the same on the server and every screen): a size, a milk,
// extras, "no onions", each with its own price (more, less, or nothing). An item keeps its groups on its own record
// (inventory item `choices`), the business edits them with the item, and the guest picks them where they order.
//   A group is "pick one" (a size: exactly one when it's required, at most one when it isn't) or "pick any" (extras, up
//   to a most). An option can be sold out tonight (the kitchen's "Sold out" switch), and is then shown but not picked.
// The server never takes a price from a browser: priceChoices() works out what was picked from the item itself, refuses
// anything that isn't on it, and gives back the lines kept on the order (so a later menu change never rewrites what
// someone ordered), the amount they add, and the words the kitchen reads ("Large, oat milk, extra shot").

export type ChoiceOption = { id: string; name: string; price: number; soldOut: boolean; itemId?: string;
  /** Sold out at this location only, or everywhere (with more than one location: outWhere). */ outWhere?: 'here' | 'everywhere';
  /** In a choice from a set: which of the set's options it is, when the item kept its own id for it. */ setOption?: string };
export type ChoiceGroup = { id: string; name: string; pick: 'one' | 'any'; required: boolean; max: number; options: ChoiceOption[];
  /** From a choice set (lib/choice-sets): the same on every item it's on, changed in one place. */ setId?: string };
export type PickedChoice = { groupId: string; group: string; optionId: string; option: string; price: number };
export type Picks = Record<string, string[]>;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_GROUPS = 8, MAX_OPTIONS = 20;

/** Sold out right now: switched off, and not past the time it comes back on its own (the next morning, so "sold out
 *  tonight" never hides it tomorrow; lib/menu-server sets the time). With more than one location, `here`: also sold out
 *  at that location only (`outAt`: each location's own time it comes back; design board "Sold out here or everywhere"). */
export function outNow(x: any, now = Date.now(), here: string | null = null): boolean {
  return outWhere(x, here, now) !== null;
}
/** Where it's sold out: every location, this one only, or not at all. */
export function outWhere(x: any, here: string | null = null, now = Date.now()): 'everywhere' | 'here' | null {
  if (x?.soldOut === true) { const until = Date.parse(String(x?.soldOutUntil || '')); if (!Number.isFinite(until) || until > now) return 'everywhere'; }
  if (here && x?.outAt && typeof x.outAt === 'object') { const u = Date.parse(String(x.outAt[here] || '')); if (Number.isFinite(u) && u > now) return 'here'; }
  return null;
}
/** Out until switched back on (kept as a time, far off). */
export const UNTIL_BACK = '9999-12-31T00:00:00.000Z';
/** Each location's own sold out, as kept: only those still on (one past its time is dropped). */
export function outAtOf(x: any, now = Date.now()): Record<string, string> {
  const out: Record<string, string> = {};
  if (x?.outAt && typeof x.outAt === 'object') for (const [k, v] of Object.entries(x.outAt)) { const u = Date.parse(String(v || '')); if (/^[A-Za-z0-9_-]{1,160}$/.test(k) && Number.isFinite(u) && u > now) out[k] = String(v); }
  return out;
}
/**
 * The sold-out fields after a switch (lib/menu-server, lib/choice-sets-server). `here` with `everywhere` false: at that
 * location only. Back on at one location when it was out everywhere: back there, still out at the others (`others`: the
 * business's locations), each until it was going to come back.
 */
export function outPatch(x: any, o: { out: boolean; here: string | null; everywhere: boolean; until: string | null; by?: string | null; others: string[]; now?: number }): Record<string, any> {
  const now = o.now ?? Date.now(); const outAt = outAtOf(x, now);
  const all = o.everywhere || !o.here;
  // (A location's own with no time it comes back: until it's switched back, as one out everywhere with none.)
  if (o.out) return all ? { soldOut: true, soldOutUntil: o.until, soldOutBy: o.by ?? null, outAt: {} } : { outAt: { ...outAt, [o.here as string]: String(o.until || UNTIL_BACK) } };
  if (all) return { soldOut: false, soldOutUntil: null, soldOutBy: null, outAt: {} };
  const next = { ...outAt }; delete next[o.here as string];
  if (outWhere(x, null, now) === 'everywhere') {
    const until = String(x?.soldOutUntil || o.until || UNTIL_BACK);
    for (const id of o.others) if (id !== o.here) next[id] = until;
    return { soldOut: false, soldOutUntil: null, soldOutBy: null, outAt: next };
  }
  return { outAt: next };
}
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const cents = (v: unknown) => { const x = Math.round(Number(v) * 100) / 100; return Number.isFinite(x) ? Math.max(-1000, Math.min(1000, x)) : 0; };
export const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

/** An item's groups, cleaned: what a screen shows and what the server prices against. Anything malformed is left out.
 *  `withSets`: also which choice set a group comes from (lib/choice-sets), for the team's screens and the server; a
 *  guest's menu doesn't carry it. */
export function choiceGroups(item: any, withSets = false, here: string | null = null): ChoiceGroup[] {
  const raw = Array.isArray(item?.choices) ? item.choices : [];
  const out: ChoiceGroup[] = [];
  const seenG = new Set<string>();
  for (const g of raw.slice(0, MAX_GROUPS)) {
    const id = String(g?.id || ''); const name = words(g?.name, 40);
    if (!ID.test(id) || !name || seenG.has(id)) continue;
    seenG.add(id);
    const setId = withSets && typeof g?.setId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(g.setId) ? g.setId : null;
    const seenO = new Set<string>();
    const options: ChoiceOption[] = [];
    for (const o of (Array.isArray(g?.options) ? g.options : []).slice(0, MAX_OPTIONS)) {
      const oid = String(o?.id || ''); const oname = words(o?.name, 40);
      if (!ID.test(oid) || !oname || seenO.has(oid)) continue;
      // An option that is another menu item (a combo's side or drink): made and counted as that item (lib/counter-orders).
      const itemId = typeof o?.itemId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(o.itemId) ? o.itemId : null;
      const setOption = setId && ID.test(String(o?.setOption || '')) && String(o.setOption) !== oid ? String(o.setOption) : null;
      const w = outWhere(o, here);
      seenO.add(oid); options.push({ id: oid, name: oname, price: cents(o?.price), soldOut: w !== null, ...(w && here ? { outWhere: w } : {}), ...(itemId ? { itemId } : {}), ...(setOption ? { setOption } : {}) });
    }
    if (!options.length) continue;
    const pick: 'one' | 'any' = g?.pick === 'any' ? 'any' : 'one';
    const max = pick === 'one' ? 1 : Math.max(1, Math.min(options.length, Math.floor(Number(g?.max)) || options.length));
    out.push({ id, name, pick, required: pick === 'one' ? g?.required !== false : g?.required === true, max, options, ...(setId ? { setId } : {}) });
  }
  return out;
}

/** Is the whole item off tonight? (The kitchen's one-tap "Sold out"; `here`: at that location too.) */
export const itemSoldOut = (item: any, here: string | null = null) => outNow(item, Date.now(), here);

/** Can it be ordered at all right now: not sold out, and every choice they must make still has something left. */
export function orderable(item: any, here: string | null = null): boolean {
  if (itemSoldOut(item, here)) return false;
  return choiceGroups(item, false, here).every((g) => !g.required || g.options.some((o) => !o.soldOut));
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
export function priceChoices(item: any, picks: unknown, here: string | null = null): { ok: true; lines: PickedChoice[]; extra: number; text: string } | { ok: false; error: string } {
  const groups = choiceGroups(item, false, here);
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
  return choiceGroups({ choices: raw }, true);
}

/** Whether an item has any choices to make. */
export const hasChoices = (item: any) => choiceGroups(item).length > 0;

/** Picks as kept on an order line: each group's option ids, nothing else. */
export function cleanPicks(v: unknown): Picks {
  const out: Picks = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [g, ids] of Object.entries(v as Record<string, unknown>).slice(0, MAX_GROUPS)) {
    if (!ID.test(g) || !Array.isArray(ids)) continue;
    const list = Array.from(new Set(ids.map(String).filter((x) => ID.test(x)))).slice(0, MAX_OPTIONS);
    if (list.length) out[g] = list;
  }
  return out;
}

/** One key for a set of picks: the same choices in any order are the same line. */
export function picksKey(picks: unknown): string {
  const p = cleanPicks(picks);
  return Object.keys(p).sort().map((g) => `${g}:${[...p[g]].sort().join('+')}`).join('|');
}

/** What something already ordered comes to now, from the menu as it is: like priceChoices, but a choice that has sold
 *  out since it was ordered still counts (it was made before it ran out). */
export function settleChoices(item: any, picks: unknown) {
  const raw = Array.isArray(item?.choices) ? item.choices : [];
  return priceChoices({ choices: raw.map((g: any) => ({ ...g, options: (Array.isArray(g?.options) ? g.options : []).map((o: any) => ({ ...o, soldOut: false })) })) }, picks);
}

/** The picks behind lines kept on an order (each line's group and option). */
export function picksOf(lines: unknown): Picks {
  const out: Picks = {};
  for (const l of (Array.isArray(lines) ? lines : []).slice(0, 40)) {
    const g = String((l as any)?.groupId || ''); const o = String((l as any)?.optionId || '');
    if (ID.test(g) && ID.test(o)) out[g] = Array.from(new Set([...(out[g] || []), o]));
  }
  return out;
}

/** The choices on a line already ordered (a table's tab line): priced from the menu as it is now, sold out since or
 *  not; a choice since taken off the menu goes at what it was when it was ordered. Null when it has none. */
export function lineChoices(item: any, line: any): { extra: number; text: string; lines: PickedChoice[] } | null {
  const kept: PickedChoice[] = Array.isArray(line?.choices) ? line.choices : [];
  const fromPicks = cleanPicks(line?.picks);
  const picks = Object.keys(fromPicks).length ? fromPicks : picksOf(kept);
  if (!Object.keys(picks).length) return null;
  const r = settleChoices(item, picks);
  if (r.ok) return { extra: r.extra, text: r.text, lines: r.lines };
  const lines = kept.filter((l) => l && ID.test(String(l.groupId || '')) && ID.test(String(l.optionId || ''))).slice(0, 40)
    // What the line kept was written by a team member's screen: never less than nothing.
    .map((l) => ({ groupId: String(l.groupId), group: words(l.group, 40), optionId: String(l.optionId), option: words(l.option, 40), price: Math.max(0, cents(l.price)) }));
  return { extra: Math.round(lines.reduce((s, l) => s + l.price, 0) * 100) / 100, text: choicesText(lines), lines };
}
