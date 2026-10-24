// src/lib/order-tags.ts — WHAT AN ORDER IS, AT A GLANCE (pure; the list, the order, the slips and the customer's page
// read it):
//   status    — one clear word for where it is: "To pack", "Waiting on stock", "Packing", "Ready for pickup",
//               "Shipped", "Delivered", "Picked up", "Canceled"…
//   payment   — how it stands with the money: paid (and how), paid on another order, a refund waiting or on its way,
//               partly refunded, refunded, not paid
//   tags      — what's worth knowing besides: wholesale, a gift, a pre-order, a backorder (and which order it's for),
//               part of it on backorder, sent later, a replacement, shipping with another order, a rush, a test, a tip;
//               and the shop's own tags (order.tags), which the team adds and takes off
//   backorder — for an order made because items were short: the order it's for, and whether it's waiting on stock;
//               for the order it came from: the follow-up orders still to come
// Tags marked onSlip are printed on the packing slip.
import { isFollowUp } from '@/lib/order-family';
import { methodWords } from '@/lib/order-method';

export type Tone = 'ok' | 'warn' | 'bad' | '';
export type OrderTag = { id: string; label: string; tone?: Tone; system: boolean; onSlip: boolean };
export type Said = { label: string; tone: Tone };

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));
const money = (c: number) => `$${(c0(c) / 100).toFixed(2)}`;
const num = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;

/** Where the order is, in one phrase. */
export function orderStatus(o: any): Said {
  const s = String(o?.stage || '');
  const ship = o?.method === 'ship';
  if (s === 'placed') return { label: 'Not paid yet', tone: 'warn' };
  if (s === 'paid') return o?.holdUntilRestock ? { label: 'Waiting on stock', tone: 'warn' } : o?.holdForReview ? { label: 'Held for review', tone: 'warn' } : { label: 'To pack', tone: '' };
  if (s === 'picking') return { label: 'Packing', tone: '' };
  if (s === 'packed') return ship ? (o?.labelUrl || o?.shippoTransactionId || o?.trackingNumber ? { label: 'Labeled, ready to ship', tone: '' } : { label: 'Packed, needs a label', tone: '' }) : { label: 'Packed', tone: '' };
  if (s === 'ready') return { label: `Ready for ${methodWords(o?.method).short === 'Pickup' ? 'pickup' : methodWords(o?.method).short.toLowerCase()}`, tone: 'ok' };
  if (s === 'arrived') return { label: 'Outside now', tone: 'warn' };
  if (s === 'shipped') return { label: 'Shipped', tone: 'ok' };
  if (s === 'completed') return ship ? (o?.deliveredAt ? { label: 'Delivered', tone: 'ok' } : { label: 'Shipped', tone: 'ok' }) : o?.method === 'digital' ? { label: 'Delivered', tone: 'ok' } : { label: 'Picked up', tone: 'ok' };
  if (s === 'cancelled') return { label: 'Canceled', tone: '' };
  if (s === 'refunded') return { label: 'Refunded', tone: '' };
  return { label: s ? s[0].toUpperCase() + s.slice(1) : 'Order', tone: '' };
}

/** How it stands with the money. */
export function paymentStatus(o: any): Said {
  if (String(o?.stage || '') === 'placed') return { label: 'Not paid', tone: 'warn' };
  const total = c0(o?.totalCents);
  const back = c0(o?.refundedCents) + c0(o?.refundedOtherCents);
  const pending = c0(o?.pendingRefundCents);
  const sending = o?.refundInFlight && Date.parse(String(o.refundInFlight.at || '')) > Date.now() - 5 * 60000;
  if (sending) return { label: 'Refund being sent', tone: 'warn' };
  if (pending) return { label: `Refund of ${money(pending)} waiting`, tone: 'warn' };
  if (isFollowUp(o) && !total) return { label: back ? `Paid on the first order · ${money(back)} refunded` : 'Paid on the first order', tone: '' };
  if (total && back >= total) return { label: 'Refunded', tone: '' };
  if (back) return { label: `Paid · ${money(back)} refunded`, tone: '' };
  const gift = c0(o?.giftCardCents); const credit = c0(o?.creditAppliedCents ?? o?.storeCreditRequestedCents); const card = c0(o?.chargedCents);
  const ways = [card ? 'card' : '', gift ? 'gift card' : '', credit ? 'store credit' : ''].filter(Boolean);
  if (ways.length === 1 && ways[0] !== 'card') return { label: `Paid by ${ways[0]}`, tone: '' };
  if (ways.length > 1) return { label: `Paid by ${ways.join(' and ')}`, tone: '' };
  return { label: 'Paid', tone: '' };
}

/** For an order made from another one: what it is, the order it's for, and whether it's waiting on stock. */
export function followUpKind(o: any): { kind: 'backorder' | 'later' | 'replacement'; parentId: string; waiting: boolean; label: string } | null {
  if (!isFollowUp(o) || !o?.parentOrderId) return null;
  const parentId = String(o.parentOrderId);
  const waiting = o.holdUntilRestock === true && String(o.stage || '') === 'paid';
  if (o.isReplacement) return { kind: 'replacement', parentId, waiting, label: 'Replacement' };
  if (o.hasPreorder) return { kind: 'later', parentId, waiting, label: 'Sent later' };
  return { kind: 'backorder', parentId, waiting, label: 'Backorder' };
}

/** Units on this order still to come on a backorder of their own. */
export function unitsOnBackorder(o: any): number {
  return (o?.lines || []).filter((l: any) => l?.status === 'backordered').reduce((a: number, l: any) => a + c0(l.qtyShorted), 0);
}

/** The shop's own tags on an order, cleaned up. */
export function customTags(o: any): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of Array.isArray(o?.tags) ? o.tags : []) {
    const label = String(t || '').trim().replace(/\s+/g, ' ').slice(0, 30); const k = label.toLowerCase();
    if (label && !seen.has(k)) { seen.add(k); out.push(label); }
  }
  return out.slice(0, 12);
}

/** Every tag on the order: the ones it carries by itself, then the shop's own. */
export function orderTags(o: any, rs?: any): OrderTag[] {
  const out: OrderTag[] = [];
  const add = (id: string, label: string, onSlip: boolean, tone: Tone = '') => out.push({ id, label, tone, system: true, onSlip });
  void rs;
  if (o?.isTest) add('test', 'Test order', true);
  if (o?.priceTier === 'wholesale') add('wholesale', 'Wholesale', true);
  if (o?.gift) add('gift', 'Gift', true);
  const f = followUpKind(o);
  if (f) add(f.kind, f.label, true, f.waiting ? 'warn' : '');
  const bo = unitsOnBackorder(o);
  if (bo) add('part_backorder', `${bo} on backorder`, true, 'warn');
  if ((o?.lines || []).some((l: any) => l?.preorder === true) && !f) add('preorder', 'Pre-order', true);
  if (o?.shippedWithOrderId) add('together', 'Ships with another order', true);
  if (o?.rushAt) add('rush', 'Rush', true);
  if (c0(o?.tipCents)) add('tip', 'Tip', false);
  for (const t of customTags(o)) out.push({ id: `t:${t.toLowerCase()}`, label: t, tone: '', system: false, onSlip: true });
  return out;
}

/** The text a search matches tags by. */
export const tagText = (o: any) => orderTags(o).map((t) => t.label.toLowerCase()).join(' ');

/** When a backorder's stock is expected: the earliest open supplier order with its items still to arrive, or the date a
 *  pre-order item was promised. Null when nothing is on its way. */
export function restockExpected(o: any, supplyOrders: any[]): { at: string; from: string } | null {
  const want = new Set((o?.lines || []).filter((l: any) => l?.productId && l.digital !== true).map((l: any) => String(l.productId)));
  if (!want.size) return null;
  let best: { at: string; from: string } | null = null;
  const take = (at: any, from: string) => { const t = Date.parse(String(at || '')); if (!Number.isFinite(t)) return; if (!best || t < Date.parse(best.at)) best = { at: new Date(t).toISOString(), from }; };
  for (const so of supplyOrders || []) {
    if (!['Placed', 'Shipped', 'Partially Received'].includes(String(so?.status || ''))) continue;
    const coming = (so.items || []).some((it: any) => want.has(String(it?.productId || '')) && c0(it.quantity) > c0(it.receivedQuantity));
    if (coming) take(so.expectedArrivalDate, so.supplier ? `on order from ${so.supplier}` : 'on order');
  }
  for (const l of o?.lines || []) if (l?.preorder && l.preorderEtaAt) take(l.preorderEtaAt, 'the pre-order date');
  return best;
}

export { num as orderNumberText };
