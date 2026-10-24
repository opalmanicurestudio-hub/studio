// src/lib/order-events.ts — EVERY KIND OF STEP ON AN ORDER, IN ONE LIST, with what each means in words. Every event an
// order's history holds is one of these (lib/retail-orders ORDER_EVENT_TYPES); the staff timeline reads them through
// eventWords, and the customer's order page will show only the ones marked `customer` (the steps that happened to their
// order, never the team's notes). A type that isn't described here won't compile, so names can't drift.
//
// Repeats: a step that can arrive more than once (a carrier update, a customer's tap, a retried message) is written with
// a key (eventIdFor), so the same step with the same key is one event however often it comes.
import type { OrderEventType } from './retail-orders';

type Tone = 'ok' | 'warn' | 'plain';
type Info = { customer: boolean; words: (m: any, by: string) => { text: string; tone: Tone } };
const money = (c: number) => `$${(Math.max(0, Number(c) || 0) / 100).toFixed(2)}`;

export const EVENT_INFO: Record<OrderEventType, Info> = {
  placed: { customer: true, words: () => ({ text: 'Order placed', tone: 'plain' }) },
  payment_confirmed: { customer: true, words: (m) => ({ text: m.text ? String(m.text) : 'Paid', tone: 'plain' }) },
  stock_reserved: { customer: false, words: () => ({ text: 'Items set aside on the shelf', tone: 'plain' }) },
  batch_claimed: { customer: true, words: (_m, by) => ({ text: `Packing started${by}`, tone: 'plain' }) },
  batch_released: { customer: false, words: (_m, by) => ({ text: `Put back in the queue${by}`, tone: 'plain' }) },
  batch_auto_released: { customer: false, words: () => ({ text: 'Put back in the queue (no one was on it)', tone: 'plain' }) },
  item_scanned: { customer: true, words: (m, by) => ({ text: `${m.via === 'tap' ? 'Ticked' : 'Scanned'} into the box (${m.qtyScanned}/${m.qtyOrdered})${by}`, tone: 'plain' }) },
  scan_mismatch: { customer: false, words: (_m, by) => ({ text: `Wrong item scanned${by}`, tone: 'warn' }) },
  line_shorted: { customer: true, words: (m, by) => ({ text: `Marked missing${m.reason ? `: ${m.reason}` : ''}${by}`, tone: 'warn' }) },
  line_reopened: { customer: true, words: (_m, by) => ({ text: `Missing item found after all${by}`, tone: 'ok' }) },
  pick_complete: { customer: true, words: () => ({ text: 'Everything is in', tone: 'ok' }) },
  packed: { customer: true, words: (_m, by) => ({ text: `Packed${by}`, tone: 'ok' }) },
  label_generated: { customer: false, words: (m) => ({ text: `${m.carrier ? `${m.carrier} ` : ''}label${m.trackingNumber ? ` · ${m.trackingNumber}` : ''}`, tone: 'plain' }) },
  label_scan_verified: { customer: false, words: (_m, by) => ({ text: `Label checked onto its box${by}`, tone: 'ok' }) },
  marked_ready: { customer: true, words: (_m, by) => ({ text: `Ready for pickup${by}`, tone: 'ok' }) },
  customer_arrived: { customer: true, words: (m) => ({ text: `Customer arrived${m.spotOrVehicle ? ` · ${m.spotOrVehicle}` : ''}`, tone: 'plain' }) },
  handoff_scanned: { customer: true, words: (_m, by) => ({ text: `Pickup code scanned${by}`, tone: 'ok' }) },
  shipped: { customer: true, words: (m, by) => ({ text: `Shipped${m.carrier ? ` with ${m.carrier}` : ''}${m.trackingNumber ? ` · ${m.trackingNumber}` : ''}${by}`, tone: 'ok' }) },
  manifested: { customer: false, words: (_m, by) => ({ text: `On the day’s USPS form${by}`, tone: 'plain' }) },
  completed: { customer: true, words: (m, by) => ({ text: m.text ? String(m.text) : `Completed${by}`, tone: 'ok' }) },
  cancelled: { customer: true, words: (m, by) => ({ text: `Canceled${m.reason ? `: ${m.reason}` : ''}${by}`, tone: 'warn' }) },
  refund_issued: { customer: true, words: (m, by) => ({ text: `Refund of ${money(m.amountCents)} sent${by}`, tone: 'ok' }) },
  return_opened: { customer: true, words: (_m, by) => ({ text: `Return started${by}`, tone: 'plain' }) },
  return_resolved: { customer: true, words: (m, by) => ({ text: `Return settled${m.resolution ? ` (${String(m.resolution).replace(/_/g, ' ')})` : ''}${by}`, tone: 'ok' }) },
  replacement_created: { customer: true, words: (_m, by) => ({ text: `Replacement on its way${by}`, tone: 'ok' }) },
  backorder_split: { customer: true, words: () => ({ text: 'Part of it will come later, when it’s back in stock', tone: 'plain' }) },
  address_updated: { customer: true, words: (_m, by) => ({ text: `Delivery address changed${by}`, tone: 'plain' }) },
  held_for_review: { customer: false, words: (m, by) => ({ text: `Held for review${m.reason ? `: ${m.reason}` : ''}${by}`, tone: 'warn' }) },
  hold_released: { customer: false, words: (_m, by) => ({ text: `Released from review${by}`, tone: 'ok' }) },
  override: { customer: false, words: (m, by) => ({ text: `${m.rule === 'handoff_without_scan' ? 'Handed over without the pickup code' : 'Rule set aside'}${m.reason ? `: ${m.reason}` : ''}${by}`, tone: 'warn' }) },
  note: { customer: false, words: (m) => ({ text: String(m.text || 'Note'), tone: 'plain' }) },
};

/** Names older events were written with, read as the one name they mean now. */
export const OLD_NAMES: Record<string, OrderEventType> = { paid: 'payment_confirmed', order_cancelled: 'cancelled', ready: 'marked_ready', arrived: 'customer_arrived' };

export const eventTypeOf = (t: any): OrderEventType | null => {
  const s = String(t || ''); return (EVENT_INFO as any)[s] ? (s as OrderEventType) : OLD_NAMES[s] || null;
};

/** A timeline row from an order event, in plain words. */
export function eventWords(e: any): { text: string; tone: Tone } {
  const m = e?.meta || {}; const by = e?.actorName ? ` · ${e.actorName}` : '';
  const t = eventTypeOf(e?.type);
  if (!t) return { text: String(m.text || String(e?.type || '').replace(/_/g, ' ')), tone: 'plain' };
  return EVENT_INFO[t].words(m, by);
}

/** Whether a customer may see this event on their order page: a real step of their order, never the team's notes. */
export const customerSees = (e: any): boolean => { const t = eventTypeOf(e?.type); return !!t && EVENT_INFO[t].customer; };

/** The id for an event that can arrive more than once: the same step with the same key is one event. */
export function eventIdFor(type: OrderEventType, key: string): string {
  const k = String(key || '').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120);
  return `${type}-${k}`;
}
