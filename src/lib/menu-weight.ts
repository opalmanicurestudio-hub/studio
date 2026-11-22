// src/lib/menu-weight.ts — SOLD BY WEIGHT (pure; design board "Sold by weight"; lib/counter-orders lineFor,
// components/pos/CounterWeight, the Menu page). Coffee beans by the pound, cookies by the ounce, chocolate by the gram:
// the item's price is per unit of weight, the counter types what the scale reads, and the line's price is the weight
// times that, to the cent (its choices' extras once, on top). Stock counted in a unit of weight comes off in its own unit.
// Only the counter and the window ring one in: it has to be weighed (the kiosk, ordering ahead and the voice leave it off).

export type WeightUnit = 'lb' | 'oz' | 'kg' | 'g';
export const WEIGHT_UNITS: WeightUnit[] = ['lb', 'oz', 'kg', 'g'];
const GRAMS: Record<WeightUnit, number> = { lb: 453.59237, oz: 28.349523125, kg: 1000, g: 1 };
/** The most one weighing can be, by unit (about 50 lb). */
const MAX: Record<WeightUnit, number> = { lb: 50, oz: 800, kg: 25, g: 25000 };
/** Places a weight is kept to: two (three for kilograms, none for grams). */
const PLACES: Record<WeightUnit, number> = { lb: 2, oz: 2, kg: 3, g: 0 };
/** Quick weights offered for each unit. */
export const QUICK: Record<WeightUnit, { label: string; amount: number }[]> = {
  lb: [{ label: '¼ lb', amount: 0.25 }, { label: '½ lb', amount: 0.5 }, { label: '1 lb', amount: 1 }, { label: '2 lb', amount: 2 }],
  oz: [{ label: '2 oz', amount: 2 }, { label: '4 oz', amount: 4 }, { label: '8 oz', amount: 8 }, { label: '12 oz', amount: 12 }],
  kg: [{ label: '¼ kg', amount: 0.25 }, { label: '½ kg', amount: 0.5 }, { label: '1 kg', amount: 1 }, { label: '2 kg', amount: 2 }],
  g: [{ label: '100 g', amount: 100 }, { label: '250 g', amount: 250 }, { label: '500 g', amount: 500 }, { label: '1000 g', amount: 1000 }],
};

const unitOk = (u: unknown): WeightUnit | null => (WEIGHT_UNITS as string[]).includes(String(u)) ? (u as WeightUnit) : null;
/** The unit an item is sold by, or null when it isn't sold by weight. */
export function byWeightOf(item: any): WeightUnit | null { return item?.byWeight && typeof item.byWeight === 'object' ? unitOk(item.byWeight.unit) : null; }

/** A unit of weight as an inventory item counts it ("lbs", "pounds", "grams"…), or null for one that isn't a weight. */
export function massUnitOf(v: unknown): WeightUnit | null {
  const k = String(v ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (['lb', 'lbs', 'pound', 'pounds'].includes(k)) return 'lb';
  if (['oz', 'ounce', 'ounces'].includes(k)) return 'oz';
  if (['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'].includes(k)) return 'kg';
  if (['g', 'gram', 'grams', 'gr'].includes(k)) return 'g';
  return null;
}
/** `amount` of `from` in `to`. */
export const convertWeight = (amount: number, from: WeightUnit, to: WeightUnit) => (amount * GRAMS[from]) / GRAMS[to];

/** A weight typed or read, kept to its unit's places: more than nothing, up to the most one weighing can be. */
export function cleanWeight(v: unknown, unit: WeightUnit): number | null {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return null;
  const f = 10 ** PLACES[unit]; const r = Math.round(n * f) / f;
  return r > 0 && r <= MAX[unit] ? r : null;
}
/** "0.75 lb", "250 g". */
export const weightText = (amount: number, unit: WeightUnit) => `${Number(Number(amount).toFixed(PLACES[unit]))} ${unit}`;
/** "$18.00/lb". */
export const perText = (price: number, unit: WeightUnit) => `$${(Math.round(Number(price) * 100) / 100).toFixed(2)}/${unit}`;

/** What it comes off stock as: the weight in the item's own unit of weight, or as it is when its stock isn't a weight. */
export function stockAmountOf(amount: number, unit: WeightUnit, item: any): number {
  const m = massUnitOf(item?.unit);
  return Math.round((m && m !== unit ? convertWeight(amount, unit, m) : amount) * 1000) / 1000;
}

/** How much of a line comes off stock: a weighed line's weight in the item's unit, else how many. */
export const unitsOf = (l: { quantity: number; weight?: { stock?: number } | null }) => (l?.weight && Number.isFinite(Number(l.weight.stock)) ? Number(l.weight.stock) : Number(l?.quantity) || 0);
