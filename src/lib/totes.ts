// src/lib/totes.ts — NUMBERED TOTES FOR PICKING SEVERAL ORDERS AT ONCE. A shop prints a reusable set of tote tags
// (TOTE-01 … TOTE-24, each a barcode). When someone takes a batch, they scan an empty tote for each order; from then
// on every item scan says which tote it goes in, and at the bench scanning the tote opens that order. A tote is busy
// while its order is still being picked; once the order is boxed, the tote is free again.
//
// Also here: matching a scanned shipping-label barcode to its order, so the right label goes on the right box.
// Carrier barcodes often wrap the tracking number (USPS adds a 420 + ZIP prefix), so the match is "ends with".
import { doc, updateDoc, type Firestore } from 'firebase/firestore';

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
  const d = digits(raw);
  return d.length >= 18 || /^1Z[0-9A-Z]{16}$/.test(d);
}

export function labelMatchesOrder(scanned: unknown, order: any): boolean {
  const s = digits(scanned);
  const nums = [order?.trackingNumber, ...(Array.isArray(order?.extraTrackingNumbers) ? order.extraTrackingNumbers : [])].map(digits).filter((t) => t.length >= 8);
  return nums.some((t) => s === t || s.endsWith(t));
}

export function orderForLabel(scanned: unknown, orders: any[]): any | null {
  return orders.find((o) => labelMatchesOrder(scanned, o)) || null;
}
