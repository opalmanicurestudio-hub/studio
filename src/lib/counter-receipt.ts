// src/lib/counter-receipt.ts — A COUNTER ORDER'S RECEIPT (design board "Receipts at the counter"; pure). A paid order from
// the counter, the drive-thru, the kiosk or ordering ahead is its own record of the sale, so its receipt is built from it
// whenever it's asked for (never kept a second time: the night's close, the month's records and food cost read the
// orders themselves). It comes out in the shape the front desk's receipts have, so the receipt page, sending it and
// Today's sales treat both the same; and as a slip for the receipt printer (lib/printing receiptDoc).
import { CHANNEL_NAME } from './counter-orders';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const COUNTER_RECEIPT = /^co_([A-Za-z0-9_-]{1,120})$/;
export const counterReceiptId = (orderId: string) => `co_${orderId}`;

/** A counter order that has a receipt: paid (not a staff meal, which takes no money, nor a delivery app's order: the app
 *  gives its customer the receipt, at the app's prices). One refunded or cancelled after it was paid keeps its receipt,
 *  marked so (counterReceipt). */
export const hasReceipt = (o: any) => !!o?.paidAt && o.payMethod !== 'staff' && o.payMethod !== 'app';

const METHOD: Record<string, string> = { cash: 'cash', card: 'card' };

/** The order as a receipt (the front desk's shape), with the key its private page asks for. */
export function counterReceipt(o: any, orderId: string): any {
  const lines = (Array.isArray(o?.lines) ? o.lines : []).map((l: any) => {
    const qty = Math.max(1, Math.floor(num(l.quantity)) || 1); const unit = r2(num(l.unitPrice));
    const extra = clip(l.choicesText, 120);
    return { kind: 'item', label: `${clip(l.name, 80) || 'Item'}${extra ? ` (${extra})` : ''}`, qty, unit, amount: r2(unit * qty) };
  });
  const items = r2(lines.reduce((s: number, l: any) => s + l.amount, 0));
  const discount = r2(Math.max(0, num(o?.discount)));
  const fee = r2(Math.max(0, num(o?.deliveryFee)));
  const tip = r2(Math.max(0, num(o?.tipCents)) / 100);
  const tax = r2(Math.max(0, num(o?.tax)));
  // (What was charged: a delivery's tip is already in the order's total, lib/food-delivery withDeliveryFee.)
  const total = r2(num(o?.total));
  // Refunded after it was paid (ordering ahead cancelled, a delivery that couldn't be made: lib/ahead-days-server,
  // lib/food-delivery-settle-server): all of it, or part (a delivery's fee kept).
  const refundCents = o?.refundedAt ? Math.max(0, Math.round(num(o?.refundedCents))) : 0;
  const voided = o?.status === 'voided' || (refundCents > 0 && refundCents >= Math.round(total * 100));
  const method = METHOD[String(o?.payMethod || '')] || 'card';
  const channel = String(o?.channel || 'counter');
  return {
    id: counterReceiptId(orderId), source: 'counter', counterOrderId: orderId, viewKey: o?.receiptKey || null,
    orderNumber: clip(o?.number, 16) || null, channel, channelName: (CHANNEL_NAME as any)[channel] || 'Counter',
    toGo: o?.toGo === true, date: String(o?.paidAt || ''), clientName: clip(o?.guestName, 40) || null,
    cashierName: clip(typeof o?.paidBy === 'string' ? o.paidBy : o?.paidBy?.name, 40) || null,
    paymentMethod: method, subtotal: items, tax, taxLabel: clip(o?.taxLabel, 40) || 'Sales tax', tip, total,
    discount, discounts: discount > 0 ? [{ label: o?.reward ? 'Reward' : 'Discount', amount: discount }] : [],
    amountTendered: method === 'cash' && o?.cashTendered != null ? r2(num(o.cashTendered)) : null,
    change: method === 'cash' && o?.changeGiven != null ? r2(num(o.changeGiven)) : null,
    detail: {
      lines, fees: fee > 0 ? [{ label: 'Delivery', amount: fee }] : [],
      payments: [{ method, amount: r2(total - tip), tip }],
    },
    refunds: refundCents > 0 ? [{ cents: refundCents, reason: o?.ahead?.delivery?.state === 'refunded' ? 'Delivery refunded' : clip(o?.voidReason, 80) || null }] : [],
    voided, voidedAt: voided ? String(o?.voidedAt || o?.refundedAt || '') || null : null, voidReason: voided ? clip(o?.voidReason, 120) || (refundCents ? 'Refunded' : null) : null,
    voidRefunded: voided && refundCents > 0, locationId: o?.locationId || null,
  };
}

/** Today's sales row for a counter order (as the front desk's receipts list them). */
export function counterSaleRow(o: any, orderId: string): any {
  const r = counterReceipt(o, orderId);
  // (Part of it refunded: what was kept.)
  const kept = r.voided ? r.total : r2(r.total - (r.refunds[0]?.cents || 0) / 100);
  return { id: r.id, source: 'counter', orderNumber: r.orderNumber, channelName: r.channelName, date: r.date, total: kept, tip: r.tip, clientName: r.clientName, clientId: null, paidBy: null,
    paymentMethod: r.paymentMethod, payments: null, voided: r.voided, voidReason: r.voidReason };
}
