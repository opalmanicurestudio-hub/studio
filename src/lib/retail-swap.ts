// src/lib/retail-swap.ts — WHEN SOMETHING ISN'T THERE: SWAP OR REFUND. At checkout the customer says what they want
// if an item turns out to be out of stock: a refund (the default, and what happens when they say nothing), a similar
// item chosen by the shop, or to be asked first. At packing, a swap closes the missing line and adds the replacement
// as its own line. Prices never change on a line: the replacement carries its own price, and when it costs more the
// difference is a discount on that line, so the customer never pays more. When it costs less, the difference (with
// its tax) goes back to them. Pure, so the client and the server apply a swap identically.
import { taxShareCents } from './restocking';

export type IfUnavailable = 'refund' | 'similar' | 'ask';
export const IF_UNAVAILABLE: { id: IfUnavailable; label: string; note: string }[] = [
  { id: 'refund', label: 'Refund it', note: 'You get your money back for that item.' },
  { id: 'similar', label: 'Swap for something similar', note: 'We pick a close match. Never more than you paid.' },
  { id: 'ask', label: 'Ask me first', note: 'We text you a suggestion. No answer means a refund.' },
];
export const normaliseIfUnavailable = (v: unknown): IfUnavailable => (v === 'similar' || v === 'ask' ? v : 'refund');

/** How long a customer has to answer before it falls back to a refund. */
export const SWAP_ANSWER_HOURS = 2;

export interface SwapItem { productId: string; name: string; unitPriceCents: number; sku?: string; barcode?: string; optionsLabel?: string; imageUrl?: string }

export function swapLines(order: { lines: any[]; subtotalCents?: number; taxCents?: number }, lineId: string, sub: SwapItem, newLineId: string): { lines: any[]; qty: number; refundCents: number; newLine: any } {
  const idx = order.lines.findIndex((l) => l.lineId === lineId);
  if (idx === -1) throw new Error('That item isn’t on this order.');
  const line = order.lines[idx];
  const qty = (Number(line.qtyOrdered) || 0) - (Number(line.qtyScanned) || 0) - (Number(line.qtyShorted) || 0);
  if (qty <= 0) throw new Error('Nothing left to swap on that item.');
  // What each unit was paid, after any promo code: never more back than that, and never more charged.
  const orig = effectiveUnitCents(line); const price = Math.max(0, Math.round(Number(sub.unitPriceCents) || 0));
  const closed = { ...line, qtyShorted: (Number(line.qtyShorted) || 0) + qty, status: 'refunded', shortReason: 'Swapped', swappedToLineId: newLineId, swappedToName: sub.name };
  const newLine = {
    lineId: newLineId, productId: sub.productId, sku: sub.sku || '', barcode: sub.barcode || '', name: sub.name, optionsLabel: sub.optionsLabel || '',
    unitPriceCents: price, qtyOrdered: qty, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending',
    swapForLineId: lineId, swapForName: line.name, lineDiscountCents: Math.max(0, price - orig) * qty,
  };
  const diff = Math.max(0, orig - price) * qty;
  const lines = [...order.lines.slice(0, idx), closed, ...order.lines.slice(idx + 1), newLine];
  return { lines, qty, refundCents: diff + taxShareCents(order, diff), newLine };
}

/** What a line really cost the customer per unit, after any line discount and its share of a promo code (lib/promo-codes). */
export function effectiveUnitCents(l: { unitPriceCents?: number; qtyOrdered?: number; lineDiscountCents?: number; promoCents?: number; unitPaidCents?: number }): number {
  // A line on an order made from another one (a backorder, a replacement) carries what each unit was paid on the first
  // order, worked out there with that line's own quantity (lib/order-family lineFor).
  if (l.unitPaidCents != null && Number.isFinite(Number(l.unitPaidCents))) return Math.max(0, Math.round(Number(l.unitPaidCents)));
  const q = Math.max(1, Number(l.qtyOrdered) || 1);
  return Math.max(0, (Number(l.unitPriceCents) || 0) - Math.round(((Number(l.lineDiscountCents) || 0) + (Number(l.promoCents) || 0)) / q));
}

/** Close matches for a missing item: in stock, same category if it has one, nearest price first, not dearer than
 *  half again. */
export function similarItems(inventory: any[], line: { productId: string; unitPriceCents?: number }, max = 6): SwapItem[] {
  const me = inventory.find((i) => i.id === line.productId) || {};
  const price = Number(line.unitPriceCents) || 0;
  const priceOf = (i: any) => Math.round((Number(i.msrp) || 0) * 100);
  const free = (i: any) => (Number(i.totalStock) || 0) - (Number(i.stockReserved) || 0);
  return inventory
    .filter((i) => i.id !== line.productId && i.showOnline === true && i.status !== 'archived' && free(i) > 0 && priceOf(i) > 0)
    .filter((i) => !me.category || i.category === me.category)
    .filter((i) => !price || priceOf(i) <= price * 1.5)
    .sort((a, b) => Math.abs(priceOf(a) - price) - Math.abs(priceOf(b) - price))
    .slice(0, max)
    .map((i) => ({ productId: i.id, name: String(i.name || 'Item'), unitPriceCents: priceOf(i), sku: i.sku || '', barcode: i.barcode || '', imageUrl: (Array.isArray(i.imageUrls) && i.imageUrls[0]) || i.imageUrl || '' }));
}

/** A YES/NO text reply about a swap. */
export function swapReply(body: string): 'yes' | 'no' | null {
  const t = String(body || '').trim().toLowerCase().replace(/[^a-z ]/g, '').trim();
  if (/^(y|yes|yeah|yep|ok|okay|sure|swap|yes please)$/.test(t)) return 'yes';
  if (/^(n|no|nope|refund|no thanks|no thank you)$/.test(t)) return 'no';
  return null;
}
