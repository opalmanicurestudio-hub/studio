// src/lib/orders-view.ts — HOW THE ORDERS SCREEN SORTS AND DESCRIBES ONLINE ORDERS. Pure: no reads, no writes, so the
// phone list, the computer list, the order sheet and Klair all say the same thing about an order.
//   Tabs: To pack (paid, being packed) · Ready (on the shelf, outside, packed and waiting to ship) · Done.
//   "Needs you": the few things a person has to decide, each pointing at one order.
import { fulfilmentPolicy, slaFor } from '@/lib/retail-orders';

export type OrdersTab = 'pack' | 'ready' | 'done';
export const ACTIVE_STAGES = ['paid', 'picking', 'packed', 'ready', 'arrived'];

const ms = (v: any) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
export const orderNum = (o: any) => (o?.isTest ? 'Test' : typeof o?.orderNumber === 'number' && o.orderNumber > 0 ? `#${String(o.orderNumber).padStart(4, '0')}` : 'Draft');
export const firstName = (n: any) => String(n || '').trim().split(/\s+/)[0] || 'Customer';
export const money = (c: number) => `$${(Math.round(Number(c) || 0) / 100).toFixed(2)}`;

export function tabOf(o: any): OrdersTab {
  const st = String(o?.stage || '');
  if (st === 'paid' || st === 'picking') return 'pack';
  if (st === 'packed') return o.method === 'ship' ? 'ready' : 'pack';
  if (st === 'ready' || st === 'arrived') return 'ready';
  return 'done';
}

export const methodLabel = (m: any) => (m === 'curbside' ? 'Curbside' : m === 'ship' ? 'Ship' : m === 'digital' ? 'Download' : 'Pickup');

/** Units the order still needs in the box, and how many are in. Digital and missing lines don't count. */
export function packProgress(o: any): { done: number; total: number; missing: number } {
  let done = 0, total = 0, missing = 0;
  for (const l of o?.lines || []) {
    if (l.digital === true) continue;
    if (['shorted', 'refunded', 'backordered'].includes(l.status)) { missing += Number(l.qtyShorted) || 0; continue; }
    total += Number(l.qtyOrdered) || 0; done += Math.min(Number(l.qtyScanned) || 0, Number(l.qtyOrdered) || 0);
  }
  return { done, total, missing };
}
export const itemCount = (o: any) => (o?.lines || []).reduce((a: number, l: any) => a + (Number(l.qtyOrdered) || 0), 0);

/** One short line for when it's due, and whether it's late. */
export function dueLine(o: any, retailSettings: any, now = Date.now()): { text: string; late: boolean } {
  const st = String(o?.stage || '');
  if (st === 'arrived') return { text: 'Outside now', late: true };
  // Orders that have gone (opened from Needs you, or the Done tab): when, not how late.
  if (st === 'shipped') { const t = ms(o.completedAt); return { text: t ? `Shipped ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Shipped', late: false }; }
  if (st === 'completed' || st === 'handed_off') return { text: 'Done', late: false };
  if (st === 'cancelled' || st === 'refunded') return { text: 'Cancelled', late: false };
  if (st === 'ready') {
    const since = ms(o.readyAt);
    const days = since ? Math.floor((now - since) / 864e5) : 0;
    return days >= 2 ? { text: `Waiting ${days} days`, late: true } : { text: o.shelfSlot ? `Shelf ${o.shelfSlot}` : 'On the shelf', late: false };
  }
  if (st === 'packed' && o.method === 'ship') return { text: o.labelUrl ? 'Label bought' : 'Needs a label', late: false };
  if (o.holdUntilRestock === true) return { text: 'Waiting on stock', late: false };
  const sla = slaFor(o, fulfilmentPolicy(retailSettings || {}), now);
  if (sla.state === 'late') { const m = Math.max(1, Math.round(-sla.minutesRemaining)); return { text: m < 90 ? `${m} min late` : m < 36 * 60 ? `${Math.round(m / 60)} hours late` : `${Math.round(m / 1440)} days late`, late: true }; }
  const due = new Date(sla.dueAtMs);
  const sameDay = new Date(now).toDateString() === due.toDateString();
  const tomorrow = new Date(now + 864e5).toDateString() === due.toDateString();
  if (o.method === 'ship') return { text: sameDay ? 'Ships today' : tomorrow ? 'Ships tomorrow' : `Ships ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, late: false };
  return { text: sameDay ? `Due ${due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : due.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }), late: false };
}

/** Packing order: late first, then soonest due. */
export function packQueue(orders: any[], retailSettings: any, now = Date.now()) {
  const pol = fulfilmentPolicy(retailSettings || {});
  return orders.filter((o) => tabOf(o) === 'pack' && o.holdUntilRestock !== true && o.holdForReview !== true)
    .map((o) => ({ o, d: slaFor(o, pol, now).dueAtMs || 0 }))
    .sort((a, b) => a.d - b.d).map((x) => x.o);
}

export interface NeedItem { key: string; orderId: string; kind: 'outside' | 'refund' | 'missing' | 'backorder' | 'uncollected' | 'held' | 'address' | 'unconfirmed' | 'label'; text: string }
/** The few things a person has to decide, most urgent first. */
export function needsYou(orders: any[], now = Date.now(), staleHours = 48): NeedItem[] {
  const out: NeedItem[] = [];
  for (const o of orders) {
    const who = firstName(o.customerName);
    if (o.stage === 'arrived') out.push({ key: `${o.id}-out`, orderId: o.id, kind: 'outside', text: `${who} is outside${o.curbside?.spotOrVehicle ? ` in ${o.curbside.spotOrVehicle}` : ''}` });
    if (o.holdForReview === true && ['paid'].includes(o.stage)) out.push({ key: `${o.id}-held`, orderId: o.id, kind: 'held', text: `${who}’s order is held for review` });
    if ((Number(o.pendingRefundCents) || 0) > 0) out.push({ key: `${o.id}-ref`, orderId: o.id, kind: 'refund', text: `Refund ${money(o.pendingRefundCents)} to send to ${who}` });
    // The address (lib/address-flow): a change waiting for the team, or a question the customer hasn't answered in a day.
    if (['waiting', 'approving'].includes(String(o.addressRequest?.status)) && ['placed', 'paid', 'picking', 'packed'].includes(o.stage)) out.push({ key: `${o.id}-addr`, orderId: o.id, kind: 'address', text: o.labelUrl || o.shippoTransactionId ? `${who} changed the address after the label was bought` : `${who} asked to change the address` });
    if (o.addressConfirm?.status === 'waiting' && ['paid', 'picking', 'packed'].includes(o.stage) && ms(o.addressConfirm.askedAt) && now - ms(o.addressConfirm.askedAt) > 24 * 3600e3) out.push({ key: `${o.id}-conf`, orderId: o.id, kind: 'unconfirmed', text: `${who} hasn’t confirmed the address yet` });
    // A label nobody has scanned for days (lib/label-sweep): find the box, or void the label and get the postage back.
    if (o.labelUnscannedOpen === true && o.shippoTransactionId && ['packed', 'shipped'].includes(o.stage)) out.push({ key: `${o.id}-lbl`, orderId: o.id, kind: 'label', text: o.stage === 'shipped' ? `The carrier hasn’t scanned ${who}’s box` : `${who}’s label hasn’t been used` });
    if (o.stage === 'paid' && o.holdUntilRestock === true) out.push({ key: `${o.id}-bo`, orderId: o.id, kind: 'backorder', text: `${who}’s order is waiting on stock` });
    if (o.stage === 'ready' && ms(o.readyAt) && now - ms(o.readyAt) > staleHours * 3600e3) out.push({ key: `${o.id}-unc`, orderId: o.id, kind: 'uncollected', text: `${who} hasn’t collected their order` });
  }
  const rank: Record<string, number> = { outside: 0, held: 1, address: 2, refund: 3, missing: 4, uncollected: 5, unconfirmed: 6, label: 7, backorder: 8 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** Search by name, order number, email, phone ending or item name. */
export function matchesSearch(o: any, q: string): boolean {
  const s = q.trim().toLowerCase().replace(/^#/, ''); if (!s) return true;
  const digits = s.replace(/\D/g, '');
  if (digits && String(o.orderNumber || '').padStart(4, '0').includes(digits)) return true;
  if (String(o.customerName || '').toLowerCase().includes(s)) return true;
  if (String(o.customerEmail || '').toLowerCase().includes(s)) return true;
  if (digits.length >= 4 && String(o.customerPhone || '').replace(/\D/g, '').endsWith(digits)) return true;
  return (o.lines || []).some((l: any) => String(l.name || '').toLowerCase().includes(s));
}

/** The lowest free pickup shelf spot (A1 to F12), counting everything already on the shelf or waiting outside. */
export function nextFreeSlot(orders: any[]): string {
  const taken = new Set(orders.filter((o) => ['ready', 'arrived'].includes(String(o.stage))).map((o) => String(o.shelfSlot || '').trim().toUpperCase()).filter(Boolean));
  for (const row of ['A', 'B', 'C', 'D', 'E', 'F']) for (let n = 1; n <= 12; n++) { const s = `${row}${n}`; if (!taken.has(s)) return s; }
  return 'Overflow';
}

/** One person does the packing? Then the screen leads with the next order and hides team tools. */
export function soloShop(staff: any[], perms: (m: any) => { canPick: boolean }): boolean {
  return (staff || []).filter((m) => m && m.archived !== true && perms(m).canPick).length <= 1;
}

/** A timeline row from an order event, in plain words. */
export function eventLine(e: any): { text: string; tone: 'ok' | 'warn' | 'plain' } {
  const m = e?.meta || {};
  const by = e?.actorName ? ` · ${e.actorName}` : '';
  switch (e?.type) {
    case 'payment_confirmed': return { text: 'Paid', tone: 'plain' };
    case 'batch_claimed': return { text: `Packing started${by}`, tone: 'plain' };
    case 'item_scanned': return { text: `${m.via === 'tap' ? 'Ticked' : 'Scanned'} into the box (${m.qtyScanned}/${m.qtyOrdered})${by}`, tone: 'plain' };
    case 'pick_complete': return { text: 'Everything is in', tone: 'ok' };
    case 'packed': return { text: `Packed${by}`, tone: 'ok' };
    case 'ready': return { text: `Ready for pickup${by}`, tone: 'ok' };
    case 'arrived': return { text: 'Customer arrived', tone: 'plain' };
    case 'handed_off': return { text: `Handed over${by}`, tone: 'ok' };
    case 'shipped': case 'label_generated': return { text: `${m.carrier ? `${m.carrier} ` : ''}label${m.trackingNumber ? ` · ${m.trackingNumber}` : ''}`, tone: 'plain' };
    case 'line_shorted': return { text: `Marked missing${m.reason ? `: ${m.reason}` : ''}${by}`, tone: 'warn' };
    case 'refund_issued': return { text: `Refund of ${money(Number(m.amountCents) || 0)} sent${by}`, tone: 'ok' };
    case 'order_cancelled': return { text: `Cancelled${m.reason ? `: ${m.reason}` : ''}${by}`, tone: 'warn' };
    case 'scan_mismatch': return { text: `Wrong item scanned${by}`, tone: 'warn' };
    case 'batch_released': case 'batch_auto_released': return { text: `Put back in the queue${by}`, tone: 'plain' };
    default: return { text: String(m.text || String(e?.type || '').replace(/_/g, ' ')), tone: 'plain' };
  }
}
