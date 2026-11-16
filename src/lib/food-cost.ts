// src/lib/food-cost.ts — FOOD COST (design canvas "Food cost"; api/food-cost; the page at /food-cost; the Menu page's cost
// lines). What each menu item costs to make from its recipe at today's ingredient costs, as a share of its price; what the
// food and drink sold over a stretch cost to make, day by day; what the counts found against what was sold (each count's
// difference, from the stock history: everything sold, made and logged as waste is already taken off, so what a count
// finds missing is what nothing accounts for); and what was thrown away. Pure.
//   A recipe line costs what it takes off stock (lib/kitchen-units stockNeed: its kitchen measure turned into what the
//   ingredient is counted in, more for what trimming and cooking lose), at what one of the ingredient costs: a prep
//   recipe's from its own recipe at today's costs (lib/prep-recipes). A choice that changes the recipe (lib/choice-recipe)
//   costs the difference it makes.
//   What a plate really costs (lib/plate-extras): its recipe, what goes out with it set once (a box to go), and what the
//   card payment costs, at a table and to go; and so what it keeps.
import { recipeOf, type RecipeLine } from '@/lib/menu-stock';
import { costGap, unitCost, unitLabel } from '@/lib/product-cost';
import { suggestPrice } from '@/lib/food-starters';
import { hasYield, stockNeed, yieldOf } from '@/lib/kitchen-units';
import { prepOf } from '@/lib/prep-recipes';
import { madeWith, optionChanges } from '@/lib/choice-recipe';
import { choiceGroups, type Picks } from '@/lib/menu-choices';
import { guestExtras, itemExtras, orderExtras, type Extra, type Mode } from '@/lib/plate-extras';

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** The share of its price an item should cost to make, as the business set it (30% unless it said otherwise). */
export const DEFAULT_TARGET = 0.3, TARGET_MIN = 0.1, TARGET_MAX = 0.6;
export function targetOf(tenant: any): number {
  const v = Number(tenant?.foodCost?.target);
  return Number.isFinite(v) && v >= TARGET_MIN && v <= TARGET_MAX ? Math.round(v * 100) / 100 : DEFAULT_TARGET;
}
/** A target as typed (a percent, 10 to 60), or null. */
export function cleanTarget(v: unknown): number | null {
  const n = Number(String(v ?? '').replace('%', '').trim()); if (!Number.isFinite(n)) return null;
  const f = n > 1 ? n / 100 : n;
  return f >= TARGET_MIN && f <= TARGET_MAX ? Math.round(f * 100) / 100 : null;
}

export type CostLine = { id: string; name: string; amount: number; unit: string; cost: number | null; typical: boolean; why: string | null;
  /** The share of what's bought that's served, when trimming or cooking lose some (lib/kitchen-units). */
  usable?: number | null;
  /** A prep recipe made in batches (lib/prep-recipes). */
  prep?: boolean };
/** What a choice adds to the price, what it adds to the cost, and what's left of it (lib/choice-recipe). */
export type OptionCost = { groupId: string; optionId: string; group: string; option: string; price: number; cost: number | null; keeps: number | null; changes: boolean;
  /** It barely pays for itself: it keeps under a fifth of what it charges, or costs more than it charges. */
  thin: boolean };

/** What one of an ingredient costs, in what it's counted in: a prep recipe's from its own recipe at today's ingredient
 *  costs (a prep inside a prep too, one level), else what Inventory has. Null when it isn't known. */
export function partUnitCost(part: any, parts: Map<string, any>, depth = 0): number | null {
  const p = prepOf(part);
  // Worked out live when everything in it has a cost; else what it cost when it was last saved or made.
  if (p && depth < 2) { const b = linesCost(recipeOf(part), parts, depth + 1); if (b.cost !== null) return b.cost / p.makes; }
  return unitCost(part);
}
/** What some recipe lines cost, line by line; null while any of them has no cost (gaps say which, and why). */
export function linesCost(recipe: RecipeLine[], parts: Map<string, any>, depth = 0): { lines: CostLine[]; cost: number | null; gaps: { name: string; why: string }[]; typical: boolean } {
  const lines: CostLine[] = recipe.map((l) => {
    const p = parts.get(l.id); const u = p ? partUnitCost(p, parts, depth) : null; const prep = !!prepOf(p);
    const typical = p?.typicalCost === true || (prep && depth < 2 && linesCost(recipeOf(p), parts, depth + 1).typical);
    const why = !p ? 'not in Inventory any more' : u !== null ? null : prep ? 'an ingredient in its recipe has no cost yet' : costGap(p) || 'no cost';
    return { id: l.id, name: String(p?.name || l.name), amount: l.measure && Number(l.amount) > 0 ? Number(l.amount) : l.quantityUsed, unit: l.measure && Number(l.amount) > 0 ? l.measure : p ? unitLabel(p) : l.unit,
      cost: u === null ? null : r4(u * stockNeed(l, p)), typical, why, usable: p && hasYield(p) ? Math.round(yieldOf(p) * 1000) / 1000 : null, prep };
  });
  const gaps = lines.filter((l) => l.cost === null).map((l) => ({ name: l.name, why: l.why || 'no cost' }));
  return { lines, cost: gaps.length ? null : r4(lines.reduce((s, l) => s + (l.cost || 0), 0)), gaps, typical: lines.some((l) => l.typical) };
}
/** What one costs to make for these choices (a large oat latte); null while any part has no cost. */
export function costWith(id: string, item: any, parts: Map<string, any>, picks?: Picks | null): number | null {
  const lines = madeWith(item, id, picks);
  if (lines.length) return linesCost(lines, parts).cost;
  const u = unitCost({ ...item, costingMethod: null, useUnit: null }); return u === null ? null : r4(u);
}
/** Each choice that charges something or changes the recipe: what it adds to the cost against the item as it comes, and
 *  what it keeps. */
export function optionCosts(id: string, item: any, parts: Map<string, any>, baseCost: number | null): OptionCost[] {
  const changes = optionChanges(item); const out: OptionCost[] = [];
  for (const g of choiceGroups(item)) for (const o of g.options) {
    const key = `${g.id}/${o.id}`; const ch = changes.has(key);
    if (o.itemId || (!ch && !(o.price !== 0))) continue;
    const withIt = ch ? costWith(id, item, parts, { [g.id]: [o.id] }) : baseCost;
    const cost = withIt === null || baseCost === null ? null : r2(withIt - baseCost);
    const keeps = cost === null ? null : r2(o.price - cost);
    out.push({ groupId: g.id, optionId: o.id, group: g.name, option: o.name, price: o.price, cost, keeps, changes: ch,
      thin: keeps !== null && ((o.price > 0 && keeps < o.price * 0.2) || (o.price <= 0 && keeps <= -0.25)) });
  }
  return out;
}
/** What a plate really costs, at a table or to go: its recipe, what goes out with it (lib/plate-extras), and the card
 *  fee on its price (on the share paid by card); what that leaves. What goes out once an order or once a guest (a bag to
 *  go, bread and butter at a table) is counted as if this were all that was ordered (`once`): shared over more, it's
 *  less. Null while any part of it has no cost. */
export type PlateCost = { mode: Mode; recipe: number | null; extras: CostLine[]; once: (CostLine & { per: 'order' | 'guest' })[]; extrasCost: number | null; cardFee: number; cardPct: number; cardShare: number; total: number | null; share: number | null; keeps: number | null };
export function plateCost(item: any, parts: Map<string, any>, recipe: number | null, extras: Extra[], mode: Mode, cardPct: number, cardShare = 1): PlateCost {
  const price = Math.max(0, num(item?.price)); const ex = linesCost(itemExtras(extras, item, mode), parts);
  const byOrder = orderExtras(extras, mode); const once = linesCost([...byOrder, ...(mode === 'here' ? guestExtras(extras, 1) : [])], parts);
  const extrasCost = ex.cost === null || once.cost === null ? null : r2(ex.cost + once.cost);
  const share = Math.max(0, Math.min(1, cardShare)); const cardFee = r2(price * (Math.max(0, cardPct) / 100) * share);
  const total = recipe === null || extrasCost === null ? null : r2(recipe + extrasCost + cardFee);
  return { mode, recipe, extras: ex.lines, once: once.lines.map((l, i) => ({ ...l, per: i < byOrder.length ? 'order' as const : 'guest' as const })), extrasCost, cardFee, cardPct, cardShare: share, total, share: total !== null && price > 0 ? total / price : null, keeps: total !== null ? r2(price - total) : null };
}

export type ItemCost = {
  id: string; name: string; price: number;
  /** What one costs to make; null while any part has no cost (see gaps). */
  cost: number | null;
  /** Made from a recipe (else a bought item sold as it is, a can or a bottle, at what one costs). */
  byRecipe: boolean; lines: CostLine[];
  /** Any part still at a typical price (lib/food-starters), not what the business pays. */
  typical: boolean;
  /** Parts with no cost yet, and why. */
  gaps: { name: string; why: string }[];
  /** Ingredients the starter menu couldn't put in its recipe (measured another way here): add them to the recipe. */
  missing: string[];
  share: number | null; target: number; over: boolean;
  /** The price (to the quarter) that brings it to the target, when it's over. */
  fix: number | null;
  /** The part that costs the most, when there's more than one. */
  biggest: CostLine | null;
  needsPrice: boolean;
  /** Its choices that charge something or change the recipe, each with what it costs and keeps. */
  options: OptionCost[];
  /** What a plate really costs at a table and to go, when the business's extras and card fee are given. */
  plates?: { here: PlateCost; togo: PlateCost };
};

/** One menu item's cost to make, from its recipe and each part as Inventory has it (`parts` by id). */
export function itemCost(id: string, item: any, parts: Map<string, any>, target: number, plate?: { extras: Extra[]; cardPct: number; cardShare?: number }): ItemCost {
  const recipe = recipeOf(item, id);
  const price = Math.max(0, num(item?.price));
  let lines: CostLine[] = []; let cost: number | null; let typical: boolean; const gaps: { name: string; why: string }[] = [];
  if (recipe.length) {
    const c = linesCost(recipe, parts);
    lines = c.lines; gaps.push(...c.gaps); cost = c.cost; typical = c.typical;
  } else {
    // Sold as it comes (a bottle, a can): what one costs.
    const u = unitCost({ ...item, costingMethod: null, useUnit: null });
    cost = u === null ? null : r4(u);
    if (cost === null) gaps.push({ name: String(item?.name || 'This item'), why: 'no cost, and no recipe' });
    typical = item?.typicalCost === true;
  }
  const share = cost !== null && price > 0 ? cost / price : null;
  const over = share !== null && share > target + 0.0005;
  const costed = lines.filter((l) => l.cost !== null).sort((a, b) => (b.cost || 0) - (a.cost || 0));
  return {
    id, name: String(item?.name || 'Item'), price, cost, byRecipe: recipe.length > 0, lines, typical, gaps,
    missing: (Array.isArray(item?.recipeGaps) ? item.recipeGaps : []).map(String).filter(Boolean).slice(0, 10),
    share, target, over, fix: over && cost !== null ? suggestPrice(cost, target) : null,
    biggest: costed.length > 1 ? costed[0] : null, needsPrice: !(price > 0), options: optionCosts(id, item, parts, cost),
    ...(plate ? { plates: { here: plateCost(item, parts, cost, plate.extras, 'here', plate.cardPct, plate.cardShare), togo: plateCost(item, parts, cost, plate.extras, 'togo', plate.cardPct, plate.cardShare) } } : {}),
  };
}

/** Food and drink sold: one line of a sale (`amount` is what it was sold for, all `qty` of it). */
export type SoldLine = { itemId: string; qty: number; amount: number; at: string;
  /** What one cost to make with the choices it was sold with (lib/food-cost costWith), when they change the recipe. */
  each?: number | null };
/** A day: what sold with a cost to make known, what that cost, its share; and everything sold that day (`all`). */
export type DayRow = { day: string; sold: number; cost: number; share: number | null; all: number };
/** An item: how many sold, for how much, and of that, what sold with a cost known (`covered`) and what it cost. */
export type ItemSold = { id: string; name: string; qty: number; sold: number; cost: number | null; covered: number };
export type PeriodCost = {
  /** Everything sold, and the part of it whose cost to make is known. */
  sold: number; covered: number; cost: number; share: number | null;
  /** Sold with no cost known (no recipe or no costs yet), left out of the share. */
  uncovered: number; uncoveredItems: string[];
  days: DayRow[]; items: ItemSold[];
};

/** What the food and drink sold over a stretch cost to make, in all and day by day (`days`: each day of the stretch, in
 *  order; `dayOf`: the business day a sale belongs to). Items not on the menu now are counted at their last cost known. */
export function periodCost(lines: SoldLine[], costs: Map<string, ItemCost>, days: string[], dayOf: (iso: string) => string): PeriodCost {
  const byDay = new Map(days.map((d) => [d, { sold: 0, cost: 0, all: 0 }]));
  const byItem = new Map<string, ItemSold>();
  let sold = 0, covered = 0, cost = 0, uncovered = 0; const uncoveredItems = new Set<string>();
  for (const l of lines) {
    const qty = num(l.qty), amount = Math.max(0, num(l.amount)); if (!(qty > 0)) continue;
    const c = costs.get(l.itemId); const each = l.each !== undefined ? l.each : c?.cost ?? null;
    sold += amount;
    const it = byItem.get(l.itemId) || { id: l.itemId, name: c?.name || 'An item no longer on the menu', qty: 0, sold: 0, cost: each === null ? null : 0, covered: 0 };
    it.qty += qty; it.sold = r2(it.sold + amount); byItem.set(l.itemId, it);
    const d = byDay.get(dayOf(l.at)); if (d) d.all += amount;
    if (each === null) { uncovered += amount; uncoveredItems.add(it.name); continue; }
    covered += amount; cost += each * qty; it.cost = r2((it.cost || 0) + each * qty); it.covered = r2(it.covered + amount);
    if (d) { d.sold += amount; d.cost += each * qty; }
  }
  return {
    sold: r2(sold), covered: r2(covered), cost: r2(cost), share: covered > 0 ? cost / covered : null,
    uncovered: r2(uncovered), uncoveredItems: Array.from(uncoveredItems).slice(0, 8),
    days: days.map((day) => { const d = byDay.get(day)!; return { day, sold: r2(d.sold), cost: r2(d.cost), share: d.sold > 0 ? d.cost / d.sold : null, all: r2(d.all) }; }),
    items: Array.from(byItem.values()).sort((a, b) => b.sold - a.sold),
  };
}

/** A count on the stock history (a 'counted' movement): how far off the record it was, in what the history measures the
 *  ingredient in. `baseline`: its first count (it wasn't counted before), where its history starts. */
export type CountEntry = { productId: string; date: string; change: number; baseline?: boolean };
export type CountRow = { id: string; name: string; unit: string; change: number; value: number | null; last: string; first: boolean; typical: boolean };

/** What the counts in a stretch found, per ingredient: the differences added up (negative: more gone than sold), what
 *  that's worth at its cost, and when it was last counted. An ingredient counted at what the record said, with nothing
 *  written down for it (`countedAt`: its last count, when in the stretch), matches. Biggest loss first. */
export function countRows(entries: CountEntry[], parts: Map<string, any>, countedAt: Map<string, string> = new Map()): CountRow[] {
  const m = new Map<string, { change: number; last: string; real: boolean }>();
  for (const e of entries) {
    const id = String(e.productId || ''); if (!id || !parts.has(id)) continue;
    const cur = m.get(id) || { change: 0, last: '', real: false };
    if (!e.baseline) { cur.change += num(e.change); cur.real = true; }
    if (String(e.date) > cur.last) cur.last = String(e.date);
    m.set(id, cur);
  }
  for (const [id, at] of countedAt) if (!m.has(id) && parts.has(id)) m.set(id, { change: 0, last: at, real: true });
  const rows: CountRow[] = [];
  for (const [id, x] of m) {
    const p = parts.get(id); const u = unitCost(p);
    const change = Math.round(x.change * 1000) / 1000;
    // The history and the cost per use share a measure (uses, ml or g; or whole units), so the difference is priced as is.
    rows.push({ id, name: String(p?.name || 'Ingredient'), unit: ledgerUnit(p), change, value: u === null ? null : r2(-change * u), last: x.last, first: !x.real, typical: p?.typicalCost === true });
  }
  return rows.sort((a, b) => (Number(a.first) - Number(b.first)) || (Number(a.value === null) - Number(b.value === null)) || ((b.value || 0) - (a.value || 0)) || a.name.localeCompare(b.name));
}
/** What the stock history measures an ingredient in (as a count records it, lib/stock-count): uses, ml or g, or whole
 *  units (a bottle whose size is in oz is still counted by the bottle). */
export const ledgerUnit = (d: any) => (d?.costingMethod === 'uses' ? String(d.useUnit || 'uses') : d?.costingMethod === 'size' ? String(d.unit || 'ml') : 'units');

/** An amount in words, "12 L", "500 g", "3 units". */
export function amountWords(qty: number, unit: string): string {
  const q = Math.abs(qty); const u = String(unit || '').trim();
  const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (/^ml$/i.test(u) && q >= 1000) return `${fmt(q / 1000)} L`;
  if (/^g$/i.test(u) && q >= 1000) return `${fmt(q / 1000)} kg`;
  if (!u || u === 'each' || u === 'units') return `${fmt(q)} ${q === 1 ? 'unit' : 'units'}`;
  return `${fmt(q)} ${u}`;
}
/** What a count found, in words. */
export function countWords(r: Pick<CountRow, 'change' | 'unit' | 'first'>): string {
  if (r.first) return 'First count';
  if (Math.abs(r.change) < 0.0005) return 'Matches';
  return r.change < 0 ? `${amountWords(r.change, r.unit)} more gone than sold` : `${amountWords(r.change, r.unit)} more on the shelf than expected`;
}

/** What was thrown away: remakes and voids at a table after the kitchen started (their waste, as recorded with each),
 *  counter and drive-thru orders voided after they were made (`voided`: what was made, by item), and held batches past
 *  their time (their portions), each at what it costs to make. */
export type Waste = { total: number; remakes: number; voids: number; batches: number };
export function wasteOf(adjustments: { kind: string; wasteCost?: number | null }[], tossed: { itemId: string; qty: number }[], costs: Map<string, ItemCost>, voided: { itemId: string; qty: number }[] = []): Waste {
  let remakes = 0, voids = 0, batches = 0;
  const at = (itemId: string, qty: number) => { const c = costs.get(itemId)?.cost; return c !== null && c !== undefined ? c * Math.max(0, num(qty)) : 0; };
  for (const a of adjustments) { const w = Math.max(0, num(a.wasteCost)); if (a.kind === 'remake') remakes += w; else if (a.kind === 'void_item') voids += w; }
  for (const v of voided) voids += at(v.itemId, v.qty);
  for (const t of tossed) batches += at(t.itemId, t.qty);
  return { total: r2(remakes + voids + batches), remakes: r2(remakes), voids: r2(voids), batches: r2(batches) };
}

/** The stretch a report covers: this week so far (from Monday), last week, or the last 30 days, as business days. */
export type Period = 'week' | 'last' | '30';
export const PERIODS: { value: Period; label: string }[] = [{ value: 'week', label: 'This week' }, { value: 'last', label: 'Last week' }, { value: '30', label: '30 days' }];
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function periodDays(period: Period, today: string): string[] {
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;   // Monday 0
  const [from, to] = period === 'last' ? [addDays(today, -dow - 7), addDays(today, -dow - 1)] : period === '30' ? [addDays(today, -29), today] : [addDays(today, -dow), today];
  const out: string[] = []; for (let d = from; d <= to && out.length < 31; d = addDays(d, 1)) out.push(d);
  return out;
}
export const cleanPeriod = (v: unknown): Period => (v === 'last' || v === '30' ? v : 'week');
