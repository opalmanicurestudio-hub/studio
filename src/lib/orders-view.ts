// src/lib/orders-view.ts — HOW THE ORDERS SCREEN SORTS AND DESCRIBES ONLINE ORDERS. Pure: no reads, no writes, so the
// phone list, the computer list, the order sheet and Klair all say the same thing about an order.
//   Tabs: To pack (paid, being packed) · Ready (on the shelf, outside, packed and waiting to ship) · Done.
//   "Needs you": the few things a person has to decide, each pointing at one order.
import { fulfilmentPolicy, slaFor } from '@/lib/retail-orders';
import { eventWords } from './order-events';
import { dayKey, formatShortDay, formatTime } from '@/lib/tenant-time';
import { voidedSlots } from '@/lib/label-boxes';
import { labelDoubt, trailStatus } from '@/lib/label-doubt';
import { carrierName } from '@/lib/ship-promise';
import { methodWords } from '@/lib/order-method';
import { tagText } from '@/lib/order-tags';

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

/** "Ship", "Pickup", "Curbside" (or "Drive-through" when the shop runs curbside as a lane), "Download" (lib/order-method). */
export const methodLabel = (m: any, rs?: any) => methodWords(m, rs).short;

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

/** 'today', 'tomorrow' or 'Fri, Oct 23', on the shop's clock. */
function dayWord(dueMs: number, now: number, tz: string): string {
  const d = dayKey(new Date(dueMs), tz);
  if (d === dayKey(new Date(now), tz)) return 'today';
  if (d === dayKey(new Date(now + 864e5), tz)) return 'tomorrow';
  return formatShortDay(new Date(dueMs), tz);
}

/** One short line for when it's due, and whether it's late. Days and times are read on the shop's clock (the order's
 *  promise carries it; `timeZone` covers older orders), never the phone's. */
export function dueLine(o: any, retailSettings: any, now = Date.now(), timeZone?: string | null): { text: string; late: boolean } {
  const st = String(o?.stage || '');
  const tz = String(o?.promise?.timeZone || timeZone || 'UTC');
  if (st === 'arrived') return { text: 'Outside now', late: true };
  // Orders that have gone (opened from Needs you, or the Done tab): when, not how late.
  if (st === 'shipped') { const t = ms(o.completedAt); return { text: t ? `Shipped ${formatShortDay(new Date(t), tz).replace(/^\w+, /, '')}` : 'Shipped', late: false }; }
  if (st === 'completed') return { text: 'Done', late: false };
  if (st === 'cancelled') return { text: 'Canceled', late: false };
  // A delivery on the shelf waits for its driver: where it is, and when it has to go.
  if (st === 'ready' && o.method === 'delivery') {
    const d = o.delivery || {};
    if (d.status === 'out') return { text: `Out with ${String(d.driverName || 'a driver').split(' ')[0]}`, late: false };
    if (d.status === 'failed') return { text: 'Brought back', late: true };
    const end = ms(d.window?.end) || ms(d.asap?.by);
    if (end && end < now) return { text: 'Missed its delivery time', late: true };
    const go = ms(d.readyBy);
    return { text: go ? `Goes out ${dayWord(go, now, tz)}${formatTime(new Date(go), tz) ? ` ${formatTime(new Date(go), tz)}` : ''}` : 'Waiting for a driver', late: false };
  }
  if (st === 'ready') {
    const since = ms(o.readyAt);
    const days = since ? Math.floor((now - since) / 864e5) : 0;
    return days >= 2 ? { text: `Waiting ${days} days`, late: true } : { text: o.shelfSlot ? `Shelf ${o.shelfSlot}` : 'On the shelf', late: false };
  }
  if (o.holdUntilRestock === true) return { text: 'Waiting on stock', late: false };
  const sla = slaFor(o, fulfilmentPolicy(retailSettings || {}, tz), now);
  if (!Number.isFinite(sla.dueAtMs)) return { text: methodLabel(o.method), late: false };
  const labeled = !!(o.labelUrl || o.shippoTransactionId || o.trackingNumber);
  // A packed box with its label is on its way out: an unscanned label is the morning check's job, not a late order.
  if (st === 'packed' && o.method === 'ship' && labeled) return { text: `Label bought · ships ${dayWord(sla.dueAtMs, now, tz)}`, late: false };
  const lateText = (mins: number) => { const m = Math.max(1, Math.round(mins)); return m < 90 ? `${m} min late` : m < 36 * 60 ? `${Math.round(m / 60)} hours late` : `${Math.round(m / 1440)} days late`; };
  if (sla.state === 'late') return { text: st === 'packed' && o.method === 'ship' ? `Needs a label · ${lateText(-sla.minutesRemaining)}` : lateText(-sla.minutesRemaining), late: true };
  if (o.method === 'ship') return { text: st === 'packed' ? `Needs a label · ships ${dayWord(sla.dueAtMs, now, tz)}` : `Ships ${dayWord(sla.dueAtMs, now, tz)}`, late: false };
  const day = dayWord(sla.dueAtMs, now, tz);
  return { text: day === 'today' ? `Due ${formatTime(new Date(sla.dueAtMs), tz)}` : `${day === 'tomorrow' ? 'Tomorrow' : day} ${formatTime(new Date(sla.dueAtMs), tz)}`, late: false };
}

/** Packing order: any someone moved to the front ("Pack these first", lib/ship-day), then late first, then soonest due. */
export function packQueue(orders: any[], retailSettings: any, now = Date.now(), timeZone?: string | null) {
  const pol = fulfilmentPolicy(retailSettings || {}, timeZone);
  return orders.filter((o) => tabOf(o) === 'pack' && o.holdUntilRestock !== true && o.holdForReview !== true)
    .map((o) => ({ o, d: slaFor(o, pol, now).dueAtMs || 0, r: ms(o.rushAt) }))
    .sort((a, b) => Number(!!b.r) - Number(!!a.r) || (a.r && b.r ? a.r - b.r : 0) || a.d - b.d).map((x) => x.o);
}

export interface NeedItem { key: string; orderId: string; kind: 'outside' | 'refund' | 'missing' | 'backorder' | 'uncollected' | 'held' | 'address' | 'unconfirmed' | 'label' | 'voided' | 'late' | 'relabel' | 'refundDenied' | 'charge' | 'carrier' | 'unshipped'; text: string }
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
    // A label someone should look at (lib/label-sweep): nobody has scanned it for days, a void of it didn't finish, or a
    // cancelled order's label couldn't be voided automatically. Find the box, or void it and get the postage back.
    if (o.labelUnscannedOpen === true && o.shippoTransactionId && ['packed', 'shipped', 'cancelled'].includes(o.stage)) {
      const closed = ['cancelled'].includes(o.stage);
      out.push({ key: `${o.id}-lbl`, orderId: o.id, kind: 'label', text: o.labelUnscanned?.why === 'void_unfinished' ? `Voiding ${who}’s label didn’t finish`
        : closed ? `${who}’s canceled order still has a label` : o.stage === 'shipped' ? `The carrier hasn’t scanned ${who}’s box` : `${who}’s label hasn’t been used` });
    }
    if (o.voidedLabelMoving?.open === true) out.push({ key: `${o.id}-vlm`, orderId: o.id, kind: 'voided', text: (Number(o.voidedLabelMoving.voidedBoxes) || 0) + (Number(o.voidedLabelMoving.unconfirmedBoxes) || 0) > 0 ? `A box of ${who}’s went out while other labels were being voided`
      : o.voidedLabelMoving.unsure ? `A label being voided for ${who} was scanned by the carrier` : `A voided label for ${who} was scanned by the carrier` });
    // Labels (lib/label-boxes, lib/label-records): a box whose label was voided needs a new one; a refund Shippo turned
    // down (the box may have gone out); a carrier's later adjustment to the postage, for the record.
    if (o.relabelOpen === true && o.voidedLabelMoving?.open !== true && ['paid', 'picking', 'packed', 'shipped'].includes(o.stage) && voidedSlots(o).length && labelDoubt(o) === 'relabel') out.push({ key: `${o.id}-rlb`, orderId: o.id, kind: 'relabel', text: `A box of ${who}’s needs a new label` });
    if (o.labelRefundDenied?.open === true) out.push({ key: `${o.id}-rfd`, orderId: o.id, kind: 'refundDenied', text: `A label refund for ${who} was turned down` });
    if (o.labelCharge?.open === true) { const c = Number(o.labelCharge.cents) || 0; out.push({ key: `${o.id}-chg`, orderId: o.id, kind: 'charge', text: `${o.carrier || 'The carrier'} adjusted ${who}’s postage: ${c > 0 ? '+' : '−'}${money(Math.abs(c))}` }); }
    // A parcel the carrier is having trouble with (the shipping webhook, the nightly check): returned, failed, or quiet.
    // Once per box: an order riding in another order's box is left to that order.
    if (o.carrierIssue?.open === true && !o.shippedWithOrderId && !o.labelFromOrderId && !(o.carrierIssue.status === 'STALLED' && Date.parse(String(o.carrierIssue.snoozeUntil || '')) > now)) {
      const s = String(o.carrierIssue.status || '');
      out.push({ key: `${o.id}-car`, orderId: o.id, kind: 'carrier', text: s === 'RETURNED' ? `${who}’s parcel is going back to the sender` : s === 'STALLED' ? `${who}’s parcel hasn’t ${o.carrierIssue.unscanned === true ? 'been scanned' : 'moved'} in ${Math.max(1, Number(o.carrierIssue.quietDays) || 0)} days` : `${carrierName(o.carrier || o.carrierIssue.carrier) || 'The carrier'} couldn’t deliver ${who}’s parcel` });
    }
    // A box the carrier has scanned that nobody marked shipped: it sits as packed, and its customer isn't sent the
    // shipped message, until someone does.
    if (o.stage === 'packed' && o.method === 'ship' && !o.shippedWithOrderId && !o.labelFromOrderId && (['TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(trailStatus(o)) || !!o.labelSeenMoving)) {
      out.push({ key: `${o.id}-mov`, orderId: o.id, kind: 'unshipped', text: `${carrierName(o.carrier) || 'The carrier'} has ${who}’s parcel, but it isn’t marked shipped` });
    }
    if (o.stage === 'paid' && o.holdUntilRestock === true) out.push({ key: `${o.id}-bo`, orderId: o.id, kind: 'backorder', text: `${who}’s order is waiting on stock` });
    // Late (lib/late-notices): an order that missed its date and needs someone to decide what to tell the customer, or
    // one past the date its customer was promised with nothing shipped (they can cancel for a full refund now).
    if (['paid', 'picking', 'packed'].includes(o.stage) && !o.trackingNumber && !o.shippoTransactionId && !o.holdUntilRestock) {
      if (o.lateNeedsStaff?.open === true) out.push({ key: `${o.id}-late`, orderId: o.id, kind: 'late', text: o.lateNeedsStaff.why === 'held' ? `${who}’s held order missed its ship-by date` : `${who}’s order missed its new ship-by date` });
      else if (ms(o.shipPromiseAt) && ms(o.shipPromiseAt) < now) out.push({ key: `${o.id}-late`, orderId: o.id, kind: 'late', text: `${who}’s order is past the date they were promised` });
    }
    // A delivery isn't collected: one brought back, or still on the shelf after its delivery time, needs someone instead.
    if (o.method === 'delivery') {
      const d = o.delivery || {};
      if (o.stage === 'ready' && d.status === 'failed') out.push({ key: `${o.id}-back`, orderId: o.id, kind: 'uncollected', text: `${who}’s delivery was brought back${d.failReason ? `: ${String(d.failReason).toLowerCase()}` : ''}` });
      else if (['paid', 'picking', 'packed', 'ready'].includes(o.stage) && d.status !== 'out' && (ms(d.window?.end) || ms(d.asap?.by)) && (ms(d.window?.end) || ms(d.asap?.by)) < now) out.push({ key: `${o.id}-late`, orderId: o.id, kind: 'late', text: `${who}’s delivery missed its time` });
    } else if (o.stage === 'ready' && ms(o.readyAt) && now - ms(o.readyAt) > staleHours * 3600e3) out.push({ key: `${o.id}-unc`, orderId: o.id, kind: 'uncollected', text: `${who} hasn’t collected their order` });
  }
  const rank: Record<string, number> = { outside: 0, held: 1, late: 2, carrier: 3, address: 3, voided: 4, relabel: 4, refundDenied: 5, refund: 5, missing: 6, uncollected: 7, unconfirmed: 8, label: 9, unshipped: 9, backorder: 10, charge: 11 };
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
  if (tagText(o).includes(s)) return true;   // its tags, the shop's own and its own (lib/order-tags)
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

/** A timeline row from an order event, in plain words (each kind of step described once, lib/order-events). */
export const eventLine = eventWords;
