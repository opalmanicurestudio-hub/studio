// src/lib/scale-label.ts — SCALE LABELS (pure; design board "Scale labels"; lib/counter-scan-server, the Menu page). Beans,
// cookies or deli weighed and bagged ahead, with the scale's sticker on: its barcode starts with a 2 (kept for a shop's
// own scale), then the item's number on the scale (its PLU, five digits), then the weight or the price, then a check
// digit. Scanned at the counter or the window, it's the item at that weight (priced from the menu) or at that price.
// - 12 digits (UPC, the US): 2, the item's five digits, five more, the check digit. A price with four digits (up to
//   $99.99) has a digit before it the scale checks its price with; it's passed over here (the check digit at the end
//   still catches a misread).
// - 13 digits (EAN): 2 and one more digit, the item's five digits, five more, the check digit.
// - A weight is in the scale's unit: hundredths of a pound or an ounce, thousandths of a kilogram, whole grams.
// Off until the business turns it on. A code already on an item (lib/code-index) always scans as that item first.
import { gtinValid } from '@/lib/code-form';
import { WEIGHT_UNITS, weightText, type WeightUnit } from '@/lib/menu-weight';

export type ScaleHolds = 'weight' | 'price4' | 'price5';
export type ScaleSet = { on: boolean; holds: ScaleHolds; digits: 12 | 13; unit: WeightUnit };
export const SCALE_HOLDS: ScaleHolds[] = ['weight', 'price4', 'price5'];
export const SCALE_OFF: ScaleSet = { on: false, holds: 'weight', digits: 12, unit: 'lb' };
/** Places a weight on a sticker has, by the scale's unit. */
const PLACES: Record<WeightUnit, number> = { lb: 2, oz: 2, kg: 3, g: 0 };

/** The business's scale labels as set (off, and the usual US sticker, until set). */
export function scaleSetOf(tenant: any): ScaleSet {
  const s = tenant?.scaleLabels; if (!s || typeof s !== 'object') return SCALE_OFF;
  return { on: s.on === true, holds: (SCALE_HOLDS as string[]).includes(s.holds) ? s.holds : 'weight', digits: Number(s.digits) === 13 ? 13 : 12,
    unit: (WEIGHT_UNITS as string[]).includes(s.unit) ? s.unit : 'lb' };
}

/** An item's number on the scale: one to five digits, kept as five ("42" is 00042); null when it isn't one. */
export function cleanScaleNo(v: unknown): string | null {
  const s = String(v ?? '').replace(/\s+/g, '');
  if (!/^\d{1,5}$/.test(s)) return null;
  const p = s.padStart(5, '0'); return p === '00000' ? null : p;
}

export type ScaleRead = { itemNo: string; code: string } & ({ cents: number } | { weight: number; unit: WeightUnit });

/** What a scanned sticker says, by how the business's scale prints: null when it isn't one of its stickers. */
export function readScaleLabel(raw: unknown, set: ScaleSet): ScaleRead | null {
  if (!set.on) return null;
  const s = String(raw ?? '').trim();
  if (!/^[\d\s-]+$/.test(s)) return null;
  let d = s.replace(/[\s-]/g, '');
  // (A 12-digit sticker some scanners send with a 0 in front, as 13.)
  if (set.digits === 12 && d.length === 13 && d[0] === '0') d = d.slice(1);
  if (d.length !== set.digits || d[0] !== '2' || !gtinValid(d)) return null;
  const at = set.digits === 12 ? 1 : 2;
  const itemNo = d.slice(at, at + 5), value = d.slice(at + 5, at + 10);
  if (itemNo === '00000') return null;
  if (set.holds === 'weight') {
    const weight = Number(value) / 10 ** PLACES[set.unit];
    return weight > 0 ? { itemNo, code: d, weight, unit: set.unit } : null;
  }
  // (Four price digits: the first of the five is the scale's own check on the price.)
  const cents = Number(set.holds === 'price4' ? value.slice(1) : value);
  return cents > 0 ? { itemNo, code: d, cents } : null;
}

/** How the business's sticker reads, in a few words, for the Menu page. */
export function scaleWords(set: ScaleSet): string {
  if (!set.on) return 'Off';
  const what = set.holds === 'weight' ? `the weight, in ${set.unit}` : set.holds === 'price4' ? 'the price, up to $99.99' : 'the price, up to $999.99';
  return `On: ${set.digits} digits, with ${what}`;
}

/** What the screen says once a scan is on the order: a sticker's weight or price, or how many of a code. */
export function scanAddedWords(d: { name?: string; pack?: number; label?: boolean; line?: { unitPrice?: number; weight?: { amount: number; unit: WeightUnit } | null; label?: { kind: string } | null } | null }): string {
  const name = String(d?.name || 'It'); const l = d?.line;
  if (d?.label && l?.weight) return l.label?.kind === 'price' ? `${name}, $${Number(l.unitPrice || 0).toFixed(2)} on its label, added.` : `${name}, ${weightText(l.weight.amount, l.weight.unit)}, added from its label.`;
  return `${name}${Number(d?.pack) > 1 ? ` × ${d.pack}` : ''} added.`;
}
