// src/lib/retail-money.ts — WHAT THE CARD ACTUALLY PAID on an online order. Store credit and gift cards lower the card
// charge, so a refund to the card can never be more than this. Orders paid since chargedCents was recorded use it;
// older ones work it out the same way the payment step checks the amount.
export function cardPaidCents(o: any): number {
  if (o?.chargedCents != null && Number.isFinite(Number(o.chargedCents))) return Math.max(0, Math.round(Number(o.chargedCents)));
  const total = Math.max(0, Number(o?.totalCents) || 0);
  if (o?.taxMode === 'stripe') return total;   // already Stripe's own post-discount total
  return Math.max(0, total - Math.max(0, Number(o?.storeCreditRequestedCents) || 0) - Math.max(0, Number(o?.giftCardCents) || 0));
}

/** Card money still refundable: what was charged, less what's been refunded or is already queued. */
export function cardRefundableCents(o: any): number {
  return Math.max(0, cardPaidCents(o) - Math.max(0, Number(o?.refundedCents) || 0));
}
