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

const METHOD: Record<string, string> = { cash: 'cash', card: 'card', split: 'split', gift_card: 'gift_card', store_credit: 'store_credit' };

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
  const refundCents = o?.refundedAt ? Math.max(0, Math.round(num(o?.refundedCents))) : Math.max(0, Math.round(num(o?.refundCents)));
  // (Money given back at the counter after it was paid, each with why: lib/counter-refund-server.)
  const counterRefunds: { cents: number; reason: string | null }[] = !o?.refundedAt && Array.isArray(o?.refunds) ? o.refunds.map((f: any) => ({ cents: Math.max(0, Math.round(num(f?.cents))), reason: clip(f?.reason, 80) || null })).filter((f: any) => f.cents > 0) : [];
  const voided = o?.status === 'voided' || (refundCents > 0 && refundCents >= Math.round(total * 100));
  const method = METHOD[String(o?.payMethod || '')] || 'card';
  const channel = String(o?.channel || 'counter');
  return {
    id: counterReceiptId(orderId), source: 'counter', counterOrderId: orderId, viewKey: o?.receiptKey || null,
    orderNumber: clip(o?.number, 16) || null, channel, channelName: (CHANNEL_NAME as any)[channel] || 'Counter',
    toGo: o?.toGo === true, date: String(o?.paidAt || ''), clientName: clip(o?.guestName, 40) || null,
    cashierName: clip(typeof o?.paidBy === 'string' ? o.paidBy : o?.paidBy?.name, 40) || null,
    paymentMethod: method, subtotal: items, tax, taxLabel: clip(o?.taxLabel, 40) || 'Sales tax', tip, total,
    // (A reward and the business's discount each by name: lib/counter-points, lib/counter-money.)
    discount, discounts: (() => {
      const out: { label: string; amount: number }[] = [];
      const rw = o?.reward ? r2(Math.max(0, num(o.reward.cents)) / 100) : 0; const md = o?.markdown ? r2(Math.max(0, num(o.markdown.cents)) / 100) : 0;
      if (rw > 0) out.push({ label: 'Reward', amount: rw });
      if (md > 0) out.push({ label: clip(o.markdown.label, 40) || 'Discount', amount: md });
      if (!out.length && discount > 0) out.push({ label: o?.reward ? 'Reward' : 'Discount', amount: discount });
      return out;
    })(),
    keptChange: o?.keptChange === true,
    amountTendered: method === 'cash' && o?.cashTendered != null ? r2(num(o.cashTendered)) : null,
    change: method === 'cash' && o?.changeGiven != null ? r2(num(o.changeGiven)) : null,
    detail: {
      lines, fees: fee > 0 ? [{ label: 'Delivery', amount: fee }] : [],
      // (With a gift card or store credit, or a split bill's shares, each part as it was paid: lib/counter-money.)
      payments: Array.isArray(o?.payments) && o.payments.length
        ? o.payments.map((p: any) => ({ method: String(p.method || 'card'), amount: r2(num(p.amount)), ...(p.method === 'gift_card' ? { label: `Gift card ${clip(p.code, 12)}`.trim() } : p.method === 'store_credit' ? { label: 'Store credit' }
          : p.part === true ? { label: p.method === 'cash' ? 'Cash, a share' : 'Card, a share' } : {}) }))
        : [{ method, amount: r2(total - tip), tip }],
    },
    refunds: counterRefunds.length ? counterRefunds : refundCents > 0 ? [{ cents: refundCents, reason: o?.ahead?.delivery?.state === 'refunded' ? 'Delivery refunded' : clip(o?.voidReason, 80) || null }] : [],
    voided, voidedAt: voided ? String(o?.voidedAt || o?.refundedAt || o?.lastRefundAt || '') || null : null, voidReason: voided ? clip(o?.voidReason, 120) || (refundCents ? 'Refunded' : null) : null,
    voidRefunded: voided && refundCents > 0, locationId: o?.locationId || null,
    // (Cash walked down the line into a person's pouch: never the drawer's.)
    inPouch: o?.cashInPouch === true,
  };
}

/** Today's sales row for a counter order (as the front desk's receipts list them). */
export function counterSaleRow(o: any, orderId: string): any {
  const r = counterReceipt(o, orderId);
  // (Part of it refunded: what was kept.)
  const kept = r.voided ? r.total : r2(r.total - r.refunds.reduce((n: number, f: any) => n + (Number(f.cents) || 0), 0) / 100);
  const split = r.detail.payments.length > 1 || r.detail.payments.some((p: any) => p.method === 'gift_card' || p.method === 'store_credit');
  return { id: r.id, source: 'counter', orderNumber: r.orderNumber, channelName: r.channelName, date: r.date, total: kept, tip: r.tip, clientName: r.clientName, clientId: null, paidBy: null,
    paymentMethod: split ? 'split' : r.paymentMethod, payments: split ? r.detail.payments.map((p: any) => ({ method: p.method, amount: p.amount, tip: 0, payerName: null })) : null, voided: r.voided, voidReason: r.voidReason };
}
