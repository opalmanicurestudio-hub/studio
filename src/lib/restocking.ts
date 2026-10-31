// src/lib/restocking.ts — RESTOCKING FEES BY CONDITION. The shop sets a percentage for each condition an item can come
// back in: as new (goes straight back on the shelf), opened (sellable as open box) and damaged by the customer. The fee
// is a share of the item price only, never tax or shipping, applies to refunds only, and is waived on the whole
// return when anything on it was the shop's fault (damaged in transit, defective, wrong item).
// Shops that set the older single percentage keep it for every condition until they set the three.

export type FeeBand = 'as_new' | 'opened' | 'damaged';
export const FEE_BANDS: { id: FeeBand; label: string; note: string }[] = [
  { id: 'as_new', label: 'Back as new', note: 'Unopened, goes straight back on the shelf.' },
  { id: 'opened', label: 'Opened', note: 'Used or opened, sold as open box or checked first.' },
  { id: 'damaged', label: 'Damaged by the customer', note: 'Can’t be sold again.' },
];
const SHOP_FAULT = new Set(['damaged_in_transit', 'defective', 'wrong_item']);
const clamp = (n: unknown) => Math.min(50, Math.max(0, Math.floor(Number(n) || 0)));

export function bandOf(disposition: string | undefined | null): FeeBand {
  if (disposition === 'restock') return 'as_new';
  if (disposition === 'open_box' || disposition === 'quarantine') return 'opened';
  return 'damaged';
}

export function feePctFor(pol: any, disposition: string | undefined | null): number {
  const m = pol?.restockingFees;
  if (m && typeof m === 'object') return clamp(m[bandOf(disposition)]);
  return clamp(pol?.restockingFeePct);
}

export function returnIsShopFault(lines: { reason?: string }[]): boolean {
  return lines.some((l) => SHOP_FAULT.has(String(l.reason || '')));
}

export interface FeeLine { lineId: string; pct: number; cents: number }

/** What a line really cost the customer per unit, after any line discount and its share of a promo code (lib/promo-codes). */
export function effectiveUnitCents(l: { unitPriceCents?: number; qtyOrdered?: number; lineDiscountCents?: number; promoCents?: number; unitPaidCents?: number }): number {
  // A line on an order made from another one (a backorder, a replacement) carries what each unit was paid on the first
  // order, worked out there with that line's own quantity (lib/order-family lineFor).
  if (l.unitPaidCents != null && Number.isFinite(Number(l.unitPaidCents))) return Math.max(0, Math.round(Number(l.unitPaidCents)));
  const q = Math.max(1, Number(l.qtyOrdered) || 1);
  return Math.max(0, (Number(l.unitPriceCents) || 0) - Math.round(((Number(l.lineDiscountCents) || 0) + (Number(l.promoCents) || 0)) / q));
}

/** The fee for a return: per line, the condition's percentage of what was paid for the item (its price after any
 *  promo code), never its tax. `shopFault`: the return was the shop's fault before only part of it came back (the
 *  waiver stays with both parts, lib/retail-returns trimReturn). */
export function restockingFee(orderLines: { lineId: string; unitPriceCents: number }[], lines: { lineId: string; qty: number; reason?: string; disposition?: string | null }[], pol: any, shopFault = false): { cents: number; lines: FeeLine[]; waived: boolean } {
  if (shopFault || returnIsShopFault(lines)) return { cents: 0, lines: [], waived: true };
  const out: FeeLine[] = [];
  for (const l of lines) {
    const orig = orderLines.find((o) => o.lineId === l.lineId); if (!orig) continue;
    const pct = feePctFor(pol, l.disposition);
    const cents = pct > 0 ? Math.round((Math.max(0, Number(l.qty) || 0) * effectiveUnitCents(orig as any) * pct) / 100) : 0;
    if (cents > 0) out.push({ lineId: l.lineId, pct, cents });
  }
  return { cents: out.reduce((a, x) => a + x.cents, 0), lines: out, waived: false };
}

type TaxFigures = { subtotalCents?: number; taxCents?: number; discountCents?: number };

/** The tax that went with these items, so a refund returns it too. */
export function taxShareCents(order: TaxFigures & { taxBasis?: TaxFigures | null }, itemCents: number): number {
  // An order made from another one (a backorder, a replacement: $0 of its own) carries the figures tax was worked out
  // from on the order the customer paid on (lib/order-family taxBasis), so its items' tax comes back the same way.
  const own = (Number(order.subtotalCents) || 0) > 0 || (Number(order.taxCents) || 0) > 0;
  const b: TaxFigures = own || !order.taxBasis ? order : order.taxBasis;
  // Tax was charged on the items after any promo code, so the share is worked out against that.
  const sub = (Number(b.subtotalCents) || 0) - Math.max(0, Number(b.discountCents) || 0); const tax = Number(b.taxCents) || 0;
  if (sub <= 0 || tax <= 0 || itemCents <= 0) return 0;
  return Math.min(tax, Math.round((itemCents * tax) / sub));
}
