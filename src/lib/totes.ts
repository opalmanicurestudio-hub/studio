// src/lib/totes.ts — NUMBERED TOTES FOR PICKING SEVERAL ORDERS AT ONCE. A shop prints a reusable set of tote tags
// (TOTE-01 … TOTE-24, each a barcode). When someone takes a batch, they scan an empty tote for each order; from then
// on every item scan says which tote it goes in, and at the bench scanning the tote opens that order. A tote is busy
// while its order is still being picked; once the order is boxed, the tote is free again.
//
// Also here: matching a scanned shipping-label barcode to its order, so the right label goes on the right box.
// Carrier barcodes often wrap the tracking number (USPS adds a 420 + ZIP prefix), so the match is "ends with".
import { arrayUnion, collection, doc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { liveTracking } from './label-boxes';

export const MAX_TOTES = 99;

export function toteCode(n: number): string {
  return `TOTE-${String(Math.max(1, Math.min(MAX_TOTES, Math.floor(n)))).padStart(2, '0')}`;
}

export function parseTote(raw: unknown): number | null {
  const m = String(raw ?? '').trim().toUpperCase().match(/^(?:TOTE|T)[\s_-]?0*(\d{1,2})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= MAX_TOTES ? n : null;
}

export function toteBusy(orders: any[], n: number, exceptOrderId?: string): any | null {
  return orders.find((o) => o.id !== exceptOrderId && o.stage === 'picking' && Number(o.toteNo) === n) || null;
}

export function needsTote(o: any): boolean {
  return o.stage === 'picking' && !(Number(o.toteNo) > 0) && o.toteSkipped !== true;
}

export async function assignTote(fs: Firestore, tenantId: string, order: any, n: number, all: any[], actor: { id: string; name: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const busy = toteBusy(all, n, order.id);
  if (busy) return { ok: false, message: `Tote ${n} already holds #${String(busy.orderNumber ?? '').padStart(4, '0')}. Use an empty one.` };
  await updateDoc(doc(fs, `tenants/${tenantId}/retailOrders`, order.id), { toteNo: n, toteAt: new Date().toISOString(), toteBy: actor.id });
  return { ok: true };
}

export async function skipTotes(fs: Firestore, tenantId: string, orders: any[]): Promise<void> {
  await Promise.all(orders.map((o) => updateDoc(doc(fs, `tenants/${tenantId}/retailOrders`, o.id), { toteSkipped: true })));
}

const digits = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

export function looksLikeTracking(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  // A product's or an order's own code (clarityflow://…) is never a label, however long it is.
  if (s.includes('://')) return false;
  const d = digits(s);
  if (/^1Z[0-9A-Z]{16}$/.test(d)) return true;
  // Long and mostly numbers (USPS, FedEx, DHL's GM… numbers); a long SKU of words isn't one.
  return d.length >= 18 && d.replace(/[^0-9]/g, '').length >= 14;
}

export function labelMatchesOrder(scanned: unknown, order: any): boolean {
  const s = digits(scanned);
  const nums = labelBoxes(order).map(digits);
  return nums.some((t) => s === t || s.endsWith(t));
}

export function orderForLabel(scanned: unknown, orders: any[]): any | null {
  return orders.find((o) => labelMatchesOrder(scanned, o)) || null;
}

// An order's tote, whether set in the staff portal (toteNo) or dealt by a wave (waveTote).
export function toteOf(o: any): number {
  return Number(o?.toteNo) > 0 ? Number(o.toteNo) : Number(o?.waveTote) > 0 ? Number(o.waveTote) : 0;
}

// The order code printed on packing slips (clarityflow://order/<code>): opens that order anywhere a scan is taken.
export function orderFromSlipScan(raw: unknown, orders: any[]): any | null {
  const m = String(raw ?? '').trim().match(/^clarityflow:\/\/order\/(.+)$/i);
  if (!m) return null;
  return orders.find((o) => (o.qrToken && o.qrToken === m[1]) || o.id === m[1]) || null;
}

// Orders with a tote, a label to check, or a slip code — what a bench scan can mean before it's read as an item.
export function benchScanTarget(raw: unknown, orders: any[]): { kind: 'tote' | 'slip' | 'label'; order: any; tote?: number } | { kind: 'foreignLabel' } | null {
  const t = parseTote(raw);
  if (t) { const o = orders.find((x) => toteOf(x) === t && ['picking', 'packed'].includes(String(x.stage))); return o ? { kind: 'tote', order: o, tote: t } : null; }
  const slip = orderFromSlipScan(raw, orders);
  if (slip) return { kind: 'slip', order: slip };
  const labeled = orders.filter((o) => o.trackingNumber && ['packed', 'shipped'].includes(String(o.stage)));
  const l = orderForLabel(raw, labeled);
  if (l) return { kind: 'label', order: l };
  if (looksLikeTracking(raw) && labeled.length) return { kind: 'foreignLabel' };
  return null;
}

/** Every box's tracking number on an order (one label per box). A box whose label was voided (lib/label-boxes) isn't
 *  one: its old label must not pass the bench check, and the box counts again once it has its new one. */
export function labelBoxes(order: any): string[] {
  return liveTracking(order).filter((t) => digits(t).length >= 8);
}

/** Which box a scanned label is (its tracking number), or null. */
export function boxForLabel(scanned: unknown, order: any): string | null {
  const s = digits(scanned);
  return labelBoxes(order).find((t) => { const d = digits(t); return s === d || s.endsWith(d); }) || null;
}

/** How many of an order's box labels have been scanned, of how many. */
export function labelProgress(order: any): { checked: number; total: number } {
  const all = labelBoxes(order); const done = new Set((Array.isArray(order?.labelsChecked) ? order.labelsChecked : []).map(String));
  return { checked: all.filter((t) => done.has(t)).length || (order?.labelCheckedAt && all.length <= 1 ? 1 : 0), total: Math.max(1, all.length) };
}

/**
 * A box's label was scanned and matches. Each box is ticked off; the order counts as label-checked once every box's
 * label has been scanned (one box: the first scan). Stamped on the order and its history for the numbers screen.
 */
export async function markLabelChecked(fs: Firestore, tenantId: string, order: any, actor: { id: string; name: string }, scanned?: unknown): Promise<{ checked: number; total: number; done: boolean }> {
  const at = new Date().toISOString();
  const ref = doc(fs, `tenants/${tenantId}/retailOrders`, order.id);
  const all = labelBoxes(order);
  const box = (scanned != null ? boxForLabel(scanned, order) : null) || all[0] || String(order.trackingNumber || '');
  const done = new Set([...(Array.isArray(order?.labelsChecked) ? order.labelsChecked.map(String) : []), box].filter(Boolean));
  const checked = all.length ? all.filter((t) => done.has(t)).length : 1; const total = Math.max(1, all.length);
  const complete = checked >= total;
  await updateDoc(ref, { labelsChecked: arrayUnion(box), ...(complete ? { labelCheckedAt: at, labelCheckedBy: actor.id, labelCheckedByName: actor.name } : {}) });
  const ev = doc(collection(ref, 'events'));
  await setDoc(ev, { id: ev.id, type: 'label_scan_verified', at, actorId: actor.id, actorName: actor.name, meta: { trackingNumber: box, box: checked, boxes: total } }).catch(() => {});
  return { checked, total, done: complete };
}
