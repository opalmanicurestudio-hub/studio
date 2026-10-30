// src/lib/refund-tax.ts — THE SALES TAX INSIDE A REFUND (pure). A refund of items gives back the tax that was paid on
// them, so the tax the shop owes comes down by that much: each refund line in the books carries its tax part
// (taxRefunded), and the books lower the tax collected by it (lib/books-summary).
// The tax part is the order's own rate on what comes back: the tax as a share of what was taxed (the items after any
// promo code, plus their tax). That's exact for items given back with their tax (a short, a cancelled item, a swap),
// and for a whole order it comes to all of the order's tax. Never more than the order's tax not yet given back, and
// nothing for a refund of shipping alone. An order made from another one (a backorder, a replacement) has no tax of
// its own: the tax figures are the order it was paid on (its taxBasis).

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));

type TaxFigures = { subtotalCents?: number; taxCents?: number; discountCents?: number; promo?: { cents?: number } | null; taxBasis?: any; refundedTaxCents?: number };

/** The figures the order's tax was worked out from: its own, or (for an order made from another) its taxBasis. */
export function taxFigures(o: TaxFigures | null | undefined): { taxedCents: number; taxCents: number } {
  const own = c0(o?.subtotalCents) > 0 || c0(o?.taxCents) > 0;
  const b: any = own || !o?.taxBasis ? o : o.taxBasis;
  const promo = c0(b?.discountCents ?? b?.promo?.cents);
  return { taxedCents: Math.max(0, c0(b?.subtotalCents) - promo), taxCents: c0(b?.taxCents) };
}

/** The tax part of a refund of `cents` on this order (the order paid on, for a follow-up). `refundedTaxCents` is what
 *  earlier refunds already gave back; `shippingOnly` refunds give back no tax. */
export function refundTaxPart(o: TaxFigures | null | undefined, cents: number, opts: { refundedTaxCents?: number; shippingOnly?: boolean } = {}): number {
  if (opts.shippingOnly) return 0;
  const { taxedCents, taxCents } = taxFigures(o);
  if (taxCents <= 0 || taxedCents <= 0 || c0(cents) <= 0) return 0;
  const left = Math.max(0, taxCents - c0(opts.refundedTaxCents ?? o?.refundedTaxCents));
  return Math.min(left, Math.round((c0(cents) * taxCents) / (taxedCents + taxCents)));
}

/** Splits a refund's tax part over its lines (the card part, then the gift card or store credit part), in proportion. */
export function splitTax(taxCents: number, parts: number[]): number[] {
  const total = parts.reduce((s, p) => s + c0(p), 0); const t = c0(taxCents);
  if (!total || !t) return parts.map(() => 0);
  let given = 0;
  return parts.map((p, i) => { if (i === parts.length - 1) return Math.max(0, t - given); const x = Math.round((t * c0(p)) / total); given += x; return x; });
}

/** What has gone back on an order so far, every way: to the card, and onto the gift card or as store credit (by a
 *  refund, or when a cancelled order gave back what it was paid with that way: nonCardRestored, lib/non-card-back). */
export function backSoFarCents(o: { refundedCents?: number; refundedOtherCents?: number; nonCardRestored?: { giftCents?: number; creditCents?: number } | null } | null | undefined): number {
  const nonCard = c0(o?.nonCardRestored?.giftCents) + c0(o?.nonCardRestored?.creditCents);
  return c0(o?.refundedCents) + Math.max(c0(o?.refundedOtherCents), nonCard);
}

/** The tip inside a refund. A refund gives back the items, the shipping and the tax first, and the tip only once those
 *  have all gone back (a cancelled order, a refund of everything). The tip isn't the shop's sale, so the books take it
 *  out of the refund: off the team's tips if it had been shared with them (lib/order-tips), or nowhere if it hadn't
 *  been booked yet. A delivery fee kept on a cancellation (deliveryFeeKeptCents) isn't waiting to come back first. `backBeforeCents` is what earlier refunds gave back in all (card and gift card or store credit). */
export function refundTipPart(o: { tipCents?: number; totalCents?: number; refundedTipCents?: number; refundedCents?: number; refundedOtherCents?: number; nonCardRestored?: { giftCents?: number; creditCents?: number } | null; deliveryFeeKeptCents?: number } | null | undefined, cents: number, opts: { backBeforeCents?: number } = {}): number {
  const tip = c0(o?.tipCents); if (!tip || c0(cents) <= 0) return 0;
  const tipBack = Math.min(tip, c0(o?.refundedTipCents));
  // A delivery fee the shop keeps when a cancelled delivery failed on the customer's side (lib/delivery-retry) never
  // comes back, so the tip is reached without it.
  const nonTipTotal = Math.max(0, c0(o?.totalCents) - tip - c0(o?.deliveryFeeKeptCents));
  const backBefore = c0(opts.backBeforeCents ?? backSoFarCents(o));
  const nonTipLeft = Math.max(0, nonTipTotal - Math.max(0, backBefore - tipBack));
  return Math.min(tip - tipBack, Math.max(0, c0(cents) - nonTipLeft));
}
