// src/lib/kitchen-units.ts — HOW A KITCHEN MEASURES, AND HOW MUCH OF WHAT'S BOUGHT CAN BE SERVED (design canvas "Food
// numbers": Yields, and Choices and units). Pure: the same on the server and every screen.
// Units: a recipe says what the cook measures (2 tbsp of olive oil, 6 oz of salmon) and the amount is turned into what
// the ingredient is counted in (the ml of a 3 L tin, the g of a 10 lb case). Weight turns into weight and volume into
// volume. Something counted one by one (a lemon) turns into a measure only once the business says what one gives (about
// 45 ml of juice); and something bought by weight can be used "1 each" once it says what one weighs.
// Yields: what's usable after trimming, and what's lost in cooking when a recipe weighs it cooked. A 6 oz portion of a
// fish that's 65% usable takes 9.2 oz off the case, and costs that much. Kept on the ingredient as usablePct and
// cookLossPct; one with neither is all usable.
import { unitLabel, unitCost } from '@/lib/product-cost';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type Dim = 'weight' | 'volume' | 'count';
const WEIGHT: Record<string, number> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
const VOLUME: Record<string, number> = { ml: 1, L: 1000, tsp: 4.92892159375, tbsp: 14.78676478125, 'fl oz': 29.5735295625, cup: 236.5882365, pt: 473.176473, qt: 946.352946, gal: 3785.411784 };
/** The measures a recipe can use, as they're written, smallest first in each kind. */
export const WEIGHTS = ['g', 'oz', 'lb', 'kg'];
export const VOLUMES = ['ml', 'tsp', 'tbsp', 'fl oz', 'cup', 'pt', 'qt', 'L', 'gal'];
const SAY: [RegExp, string][] = [
  [/^(g|gr|grams?|gm)$/, 'g'], [/^(kg|kgs|kilos?|kilograms?)$/, 'kg'], [/^(oz|ozs|ounces?)$/, 'oz'], [/^(lb|lbs|pounds?|#)$/, 'lb'],
  [/^(ml|mls|millilit(er|re)s?|cc)$/, 'ml'], [/^(l|lit(er|re)s?|ltr)$/, 'L'], [/^(tsp|tsps|teaspoons?|t)$/, 'tsp'], [/^(tbsp|tbsps|tbs|tablespoons?)$/, 'tbsp'],
  [/^(fl ?oz|fluid ?ounces?)$/, 'fl oz'], [/^(cups?|c)$/, 'cup'], [/^(pt|pints?)$/, 'pt'], [/^(qt|qts|quarts?)$/, 'qt'], [/^(gal|gals|gallons?)$/, 'gal'],
];

/** A unit as written, made one of ours: "grams" is g, "Tbsp" is tbsp, "liter" is L. Null when it isn't a weight or a
 *  volume (bags, slices, each). */
export function canonUnit(u: unknown): string | null {
  const t = String(u ?? '').trim(); if (!t) return null;
  if (t === 'T' || t === 'Tbsp' || t === 'TBSP') return 'tbsp';
  const s = t.toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ');
  for (const [re, c] of SAY) if (re.test(s)) return c;
  return null;
}
export function dimOf(u: unknown): Dim { const c = canonUnit(u); return c && c in WEIGHT ? 'weight' : c && c in VOLUME ? 'volume' : 'count'; }
/** An amount in one weight (or volume) as another; null across kinds (grams aren't millilitres without knowing more). */
export function convert(amount: number, from: unknown, to: unknown): number | null {
  const a = canonUnit(from), b = canonUnit(to); if (!a || !b) return null;
  if (a in WEIGHT && b in WEIGHT) return (amount * WEIGHT[a]) / WEIGHT[b];
  if (a in VOLUME && b in VOLUME) return (amount * VOLUME[a]) / VOLUME[b];
  return null;
}
/** "each", "units" and nothing all mean counted one by one. */
const isEach = (u: unknown) => { const s = String(u ?? '').trim().toLowerCase(); return !s || s === 'each' || s === 'unit' || s === 'units'; };
/** Two units the same, as written or as one of ours. */
export function sameUnit(a: unknown, b: unknown): boolean {
  if (isEach(a) && isEach(b)) return true;
  const ca = canonUnit(a), cb = canonUnit(b);
  return ca && cb ? ca === cb : String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

// ── WHAT ONE GIVES ──
export type PerEach = { amount: number; unit: string };
/** What one of something gives (a lemon, about 45 ml of juice; an onion, about 230 g), as the business set it. */
export function perEachOf(part: any): PerEach | null {
  const p = part?.perEach; const a = num(p?.amount); const u = canonUnit(p?.unit);
  return a > 0 && a < 100000 && u ? { amount: r3(a), unit: u } : null;
}
export function cleanPerEach(v: any): PerEach | null | 'bad' {
  if (v === null || v === undefined || v === '') return null;
  const a = num(v?.amount); const u = canonUnit(v?.unit);
  if (!(a > 0) || a >= 100000 || !u) return 'bad';
  return { amount: r3(a), unit: u };
}

// ── YIELDS ──
export const USABLE_MIN = 5, COOK_LOSS_MAX = 90;
/** The share usable after trimming (0.05 to 1; 1 when not set). */
export function usableOf(part: any): number { const v = num(part?.usablePct); return v >= USABLE_MIN && v < 100 ? v / 100 : 1; }
/** The share lost in cooking, when a recipe weighs it cooked (0 to 0.9; 0 when not set). */
export function cookLossOf(part: any): number { const v = num(part?.cookLossPct); return v > 0 && v <= COOK_LOSS_MAX ? v / 100 : 0; }
/** What share of what's bought ends up on the plate: usable after trimming, less what cooking takes. */
export function yieldOf(part: any): number { return Math.max(0.01, usableOf(part) * (1 - cookLossOf(part))); }
export const hasYield = (part: any) => yieldOf(part) < 0.9995;
/** A share typed as a percent (65, "65%"), kept to a whole percent within its limits; null when it isn't one; '' when
 *  it's cleared (all usable, or nothing lost). */
export function cleanPct(v: unknown, min: number, max: number): number | null | '' {
  const s = String(v ?? '').replace('%', '').trim(); if (s === '') return '';
  const n = Number(s); if (!Number.isFinite(n)) return null;
  const r = Math.round(n); return r >= min && r <= max ? r : null;
}
/** A yield measured: what it weighed as it came in, and after trimming. */
export function measuredYield(asBought: number, trimmed: number): number | null {
  if (!(asBought > 0) || !(trimmed > 0) || trimmed > asBought) return null;
  return Math.max(USABLE_MIN, Math.min(100, Math.round((trimmed / asBought) * 100)));
}
/** Common yields to start from. Every kitchen and supplier differs: the business weighs its own. */
export const TYPICAL_YIELDS: { name: string; kind: 'trim' | 'cook'; pct: number; words: string }[] = [
  { name: 'Yellow onion', kind: 'trim', pct: 90, words: 'about 90% usable' },
  { name: 'Romaine', kind: 'trim', pct: 75, words: 'about 75% usable' },
  { name: 'Pineapple', kind: 'trim', pct: 50, words: 'about 50% usable' },
  { name: 'Whole salmon, to fillets', kind: 'trim', pct: 62, words: '60 to 65% usable' },
  { name: 'Brisket, smoked', kind: 'cook', pct: 42, words: 'loses 40 to 45%' },
  { name: 'Burger patty, cooked', kind: 'cook', pct: 25, words: 'loses about 25%' },
];

// ── A RECIPE LINE, IN WHAT THE INGREDIENT IS COUNTED IN ──
export type Measured = { quantityUsed: number; unit?: string; amount?: number; measure?: string };
/** The measures a recipe line can use for an ingredient: what it's counted in first, then the same kind of measure,
 *  and "each" or a measure once the business has said what one gives. */
export function measuresFor(part: any): string[] {
  const u = unitLabel(part); const cu = canonUnit(u); const pe = perEachOf(part);
  const kind = (c: string) => (c in WEIGHT ? WEIGHTS : VOLUMES);
  if (cu) return Array.from(new Set([u, ...kind(cu).filter((m) => m !== cu), ...(pe ? ['each'] : [])]));
  return Array.from(new Set([u, ...(pe ? kind(pe.unit) : [])]));
}
/** An amount in a measure, as what the ingredient is counted in; null when it can't be turned into that. */
export function toStockUnits(amount: number, measure: unknown, part: any): number | null {
  if (!(amount > 0)) return null;
  const u = unitLabel(part);
  if (measure === undefined || measure === null || measure === '' || sameUnit(measure, u)) return amount;
  const cu = canonUnit(u), cm = canonUnit(measure), pe = perEachOf(part);
  if (cu && cm) return convert(amount, cm, cu);
  // Bought by weight or volume, used one at a time ("1 onion"): what one weighs.
  if (cu && isEach(measure) && pe) { const one = convert(pe.amount, pe.unit, cu); return one === null ? null : amount * one; }
  // Counted one by one, measured in the recipe ("45 ml of lemon juice"): how many that takes.
  if (!cu && cm && pe) { const inPe = convert(amount, cm, pe.unit); return inPe === null ? null : inPe / pe.amount; }
  return null;
}
/** How much of the ingredient a recipe line uses, in what it's counted in, before its yield. A line written in a measure
 *  is turned again from what was written (so a lemon's juice set later counts); else its saved amount. */
export function lineAmount(line: Measured, part: any): number {
  const q = Math.max(0, num(line?.quantityUsed));
  if (!part || !line?.measure || !(num(line.amount) > 0)) return q;
  const v = toStockUnits(num(line.amount), line.measure, part);
  return v === null ? q : v;
}
/** What a recipe line takes off stock: its amount, more for what trimming and cooking lose. */
export function stockNeed(line: Measured, part: any): number { return part ? lineAmount(line, part) / yieldOf(part) : Math.max(0, num(line?.quantityUsed)); }
/** What one of what's served costs (an oz of salmon as served, not as bought); null when its cost isn't known. */
export function servedUnitCost(part: any): number | null { const u = unitCost(part); return u === null ? null : u / yieldOf(part); }

/** An amount in its measure, in words: "2 tbsp", "6 oz", "1.5 L", "3 each". */
export function measureWords(amount: number, measure: string): string {
  const v = Math.round(amount * 100) / 100; const s = v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return isEach(measure) ? `${s}${measure && measure !== 'each' ? ` ${measure}` : ''}` : `${s} ${measure}`;
}
/** A share as a whole percent, "65%". */
export const pctWords = (f: number) => `${Math.round(f * 100)}%`;
