// src/lib/order-books.ts — AN ONLINE ORDER IN THE BOOKS (pure). The lines an online order writes the moment it's paid,
// whatever paid for it (a card, store credit, a gift card, or a mix), so no sale is missing from revenue and no sales
// tax from the tax owed:
//   the sale              — the items, after any promo code ('Retail', revenue). The card payment's fee is matched to
//                           this line (it carries the charge).
//   shipping charged      — what the customer paid for shipping or delivery, on its own line ('Shipping Charged',
//                           revenue), beside what the labels cost ('Shipping', an expense), so each method's margin is
//                           real and shipping isn't counted as product sales.
//   sales tax collected   — held for the state ('Tax Collected'), never income.
// The tip isn't here: it's the team's, written for the people who fulfilled the order when they do (lib/order-tips).
// Every line is named after the order (osale_, oship_, otax_), so it can never be written twice. Amounts are what the
// order says it was sold for, never what the card was charged: store credit and gift cards pay for a sale, they don't
// make it smaller.

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));

export const saleLineId = (orderId: string) => `osale_${orderId}`;
export const shipLineId = (orderId: string) => `oship_${orderId}`;
export const taxLineId = (orderId: string) => `otax_${orderId}`;

export type Tenders = { cardCents: number; creditCents: number; giftCents: number };

/** What the order was sold for, by part. `taxCents` is the final tax (Stripe's own figure for Stripe Tax orders). */
export function orderParts(o: any): { itemsCents: number; promoCents: number; shippingCents: number; taxCents: number; tipCents: number; totalCents: number } {
  const promoCents = Math.min(c0(o?.subtotalCents), c0(o?.promo?.cents ?? o?.discountCents));
  const itemsCents = Math.max(0, c0(o?.subtotalCents) - promoCents);
  const shippingCents = c0(o?.shippingCents); const taxCents = c0(o?.taxCents); const tipCents = c0(o?.tipCents);
  return { itemsCents, promoCents, shippingCents, taxCents, tipCents, totalCents: itemsCents + shippingCents + taxCents + tipCents };
}

const tenderWords = (t: Tenders) => {
  const ways = [t.cardCents > 0 ? 'card' : '', t.creditCents > 0 ? 'store credit' : '', t.giftCents > 0 ? 'gift card' : ''].filter(Boolean);
  if (!ways.length || (ways.length === 1 && ways[0] === 'card')) return 'Online Checkout';
  return ways.length === 1 ? (ways[0] === 'store credit' ? 'Store credit' : 'Gift card') : `Online Checkout (${ways.join(' + ')})`;
};

/** The order's lines in the books, as { id, data } for writing in the step that marks it paid. */
export function orderBookLines(o: any, ctx: {
  tenantId: string; orderId: string; at: string; tenders: Tenders; clientId?: string | null;
  chargeId?: string | null; sessionId?: string | null; connAcct?: string | null;
}): { id: string; data: Record<string, any> }[] {
  const p = orderParts(o);
  const label = `Order #${String(o?.orderNumber ?? '').padStart(4, '0')}`;
  const who = o?.customerName || 'Guest';
  const base = {
    date: ctx.at, clientOrVendor: who, clientId: ctx.clientId || o?.clientId || null, context: 'Business', hasReceipt: false,
    retailOrderId: ctx.orderId, channel: 'online', method: String(o?.method || ''), tenantId: ctx.tenantId,
    ...(ctx.connAcct ? { stripeConnectedAccountId: ctx.connAcct } : {}),
  };
  const how = tenderWords(ctx.tenders);
  const out: { id: string; data: Record<string, any> }[] = [];
  out.push({ id: saleLineId(ctx.orderId), data: {
    ...base, id: saleLineId(ctx.orderId), type: 'income', category: 'Retail', taxBucket: 'revenue',
    description: `${o?.priceTier === 'wholesale' ? 'Wholesale Sale' : 'Online Retail Sale'} — ${label}${o?.poNumber ? ` (PO ${o.poNumber})` : ''}`,
    amount: p.itemsCents / 100, merchandiseSubtotal: p.itemsCents / 100, grossOrderTotal: p.totalCents / 100, shippingCollected: p.shippingCents / 100,
    ...(p.promoCents ? { promoCents: p.promoCents } : {}),
    paymentMethod: how, tenders: ctx.tenders,
    // The card payment this sale was paid with, so its processing fee is matched to it (lib/stripe-fee).
    ...(ctx.chargeId ? { stripeChargeId: ctx.chargeId } : {}), ...(ctx.sessionId ? { checkoutSessionId: ctx.sessionId } : {}),
  } });
  if (p.shippingCents > 0) out.push({ id: shipLineId(ctx.orderId), data: {
    ...base, id: shipLineId(ctx.orderId), type: 'income', category: 'Shipping Charged', taxBucket: 'revenue',
    description: `${o?.method === 'ship' ? 'Shipping' : 'Delivery'} charged — ${label}${o?.shippingService ? ` · ${o.shippingService}` : ''}`,
    amount: p.shippingCents / 100, paymentMethod: how,
  } });
  if (p.taxCents > 0) out.push({ id: taxLineId(ctx.orderId), data: {
    ...base, id: taxLineId(ctx.orderId), type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected',
    description: `Sales tax collected — ${label}`, amount: p.taxCents / 100, taxMode: o?.taxMode || 'flat', paymentMethod: how,
  } });
  return out;
}
