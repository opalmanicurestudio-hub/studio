// src/lib/food-cost.ts — FOOD COST (design canvas "Food cost"; api/food-cost; the page at /food-cost; the Menu page's cost
// lines). What each menu item costs to make from its recipe at today's ingredient costs, as a share of its price; what the
// food and drink sold over a stretch cost to make, day by day; what the counts found against what was sold (each count's
// difference, from the stock history: everything sold, made and logged as waste is already taken off, so what a count
// finds missing is what nothing accounts for); and what was thrown away. Pure.
import { recipeOf } from '@/lib/menu-stock';
import { costGap, unitCost, unitLabel } from '@/lib/product-cost';
import { suggestPrice } from '@/lib/food-starters';

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

export type CostLine = { id: string; name: string; amount: number; unit: string; cost: number | null; typical: boolean; why: string | null };
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
};

/** One menu item's cost to make, from its recipe and each part as Inventory has it (`parts` by id). */
export function itemCost(id: string, item: any, parts: Map<string, any>, target: number): ItemCost {
  const recipe = recipeOf(item, id);
  const price = Math.max(0, num(item?.price));
  let lines: CostLine[] = []; let cost: number | null; let typical: boolean; const gaps: { name: string; why: string }[] = [];
  if (recipe.length) {
    lines = recipe.map((l) => {
      const p = parts.get(l.id); const u = p ? unitCost(p) : null;
      return { id: l.id, name: String(p?.name || l.name), amount: l.quantityUsed, unit: p ? unitLabel(p) : l.unit, cost: u === null ? null : r4(u * l.quantityUsed), typical: p?.typicalCost === true, why: p ? costGap(p) : 'not in Inventory any more' };
    });
    for (const l of lines) if (l.cost === null) gaps.push({ name: l.name, why: l.why || 'no cost' });
    cost = gaps.length ? null : r4(lines.reduce((s, l) => s + (l.cost || 0), 0));
    typical = lines.some((l) => l.typical);
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
    biggest: costed.length > 1 ? costed[0] : null, needsPrice: !(price > 0),
  };
}

/** Food and drink sold: one line of a sale (`amount` is what it was sold for, all `qty` of it). */
export type SoldLine = { itemId: string; qty: number; amount: number; at: string };
export type DayRow = { day: string; sold: number; cost: number; share: number | null };
export type ItemSold = { id: string; name: string; qty: number; sold: number; cost: number | null };
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
  const byDay = new Map(days.map((d) => [d, { sold: 0, cost: 0 }]));
  const byItem = new Map<string, ItemSold>();
  let sold = 0, covered = 0, cost = 0, uncovered = 0; const uncoveredItems = new Set<string>();
  for (const l of lines) {
    const qty = num(l.qty), amount = Math.max(0, num(l.amount)); if (!(qty > 0)) continue;
    const c = costs.get(l.itemId); const each = c?.cost ?? null;
    sold += amount;
    const it = byItem.get(l.itemId) || { id: l.itemId, name: c?.name || 'An item no longer on the menu', qty: 0, sold: 0, cost: each === null ? null : 0 };
    it.qty += qty; it.sold = r2(it.sold + amount); byItem.set(l.itemId, it);
    if (each === null) { uncovered += amount; uncoveredItems.add(it.name); continue; }
    covered += amount; cost += each * qty; it.cost = r2((it.cost || 0) + each * qty);
    const d = byDay.get(dayOf(l.at)); if (d) { d.sold += amount; d.cost += each * qty; }
  }
  return {
    sold: r2(sold), covered: r2(covered), cost: r2(cost), share: covered > 0 ? cost / covered : null,
    uncovered: r2(uncovered), uncoveredItems: Array.from(uncoveredItems).slice(0, 8),
    days: days.map((day) => { const d = byDay.get(day)!; return { day, sold: r2(d.sold), cost: r2(d.cost), share: d.sold > 0 ? d.cost / d.sold : null }; }),
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
