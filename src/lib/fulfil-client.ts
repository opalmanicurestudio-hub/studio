'use client';
// src/lib/fulfil-client.ts — THE ORDER STEPS, ASKED OF THE SERVER (api/retail/fulfil). The same names and answers as
// the steps themselves (lib/retail-fulfill, lib/retail-returns, lib/waves), so a screen reads the same; the server
// does the step, with the person's role checked and who did it taken from their sign-in. A browser can't change an
// order's stage or items itself (firestore.rules).
import { staffAuthHeader } from './staff-fetch';
import type { Actor } from './retail-fulfill';
import type { FulfillmentBatch, FulfilmentPolicy, ShortResolution, ReturnDisposition } from './retail-orders';

export type { Actor } from './retail-fulfill';
type Ans = { ok: boolean; message: string; [k: string]: any };
const OFFLINE = 'That didn’t reach the shop’s server. Check the connection and try again.';

async function step<T = Ans>(tenantId: string, action: string, args: Record<string, any> = {}): Promise<T> {
  try {
    const r = await fetch('/api/retail/fulfil', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, action, ...args }) });
    const j: any = await r.json().catch(() => null);
    if (j && typeof j === 'object') return { ok: r.ok && j.ok !== false, ...j, message: String(j.message || j.error || (r.ok ? '' : OFFLINE)) } as any;
    return { ok: false, message: OFFLINE } as any;
  } catch { return { ok: false, message: OFFLINE } as any; }
}
const errOf = (r: any) => ({ error: r.message || 'That didn’t go through. Try again.' });

export async function claimNextBatch(_fs: any, tenantId: string, _actor: Actor, maxOrders?: number, policy?: FulfilmentPolicy): Promise<{ batchId: string; orderIds: string[] } | { error: string }> {
  const r: any = await step(tenantId, 'claimNext', { maxOrders, policy });
  return r.batchId ? { batchId: r.batchId, orderIds: r.orderIds || [] } : errOf(r);
}
export async function claimSpecificOrder(_fs: any, tenantId: string, orderId: string, _actor: Actor): Promise<{ batchId: string } | { error: string }> {
  const r: any = await step(tenantId, 'claimOrder', { orderId });
  return r.batchId ? { batchId: r.batchId } : errOf(r);
}
export const takeOverOrder = (_fs: any, tenantId: string, orderId: string, _actor: Actor) => step(tenantId, 'takeOver', { orderId });
/** Throws when it didn't go through, as before, so the screen says so. */
export async function releaseBatch(_fs: any, tenantId: string, batch: FulfillmentBatch, _type: 'manual' | 'auto', _actor: Actor): Promise<void> {
  const r = await step(tenantId, 'releaseBatch', { batchId: batch?.id }); if (!r.ok) throw new Error(r.message);
}
export async function sweepStaleClaims(_fs: any, tenantId: string): Promise<number> {
  const r: any = await step(tenantId, 'sweepStale'); return Number(r.released) || 0;
}
export const recordItemScan = (_fs: any, tenantId: string, orderId: string, value: string, _actor: Actor) => step(tenantId, 'scanItem', { orderId, value });
export const recordBoxScan = (_fs: any, tenantId: string, orderId: string, value: string, _actor: Actor, opts: { secondScan?: boolean } = {}) => step(tenantId, 'scanBox', { orderId, value, secondScan: opts.secondScan === true });
export const recordPackScan = (_fs: any, tenantId: string, orderId: string, value: string, _actor: Actor) => step(tenantId, 'scanPack', { orderId, value });
export const recordLineTap = (_fs: any, tenantId: string, orderId: string, lineId: string, _actor: Actor) => step(tenantId, 'tapLine', { orderId, lineId });
export const undoLineCount = (_fs: any, tenantId: string, orderId: string, lineId: string, _actor: Actor, what: 'scan' | 'box' | 'check' = 'scan') => step(tenantId, 'undoCount', { orderId, lineId, what });
export const resolveShortLine = (_fs: any, tenantId: string, orderId: string, lineId: string, reason: string, resolution: ShortResolution, _actor: Actor) => step(tenantId, 'shortLine', { orderId, lineId, reason, resolution });
export const reopenShortedLine = (_fs: any, tenantId: string, orderId: string, lineId: string, _actor: Actor) => step(tenantId, 'reopenLine', { orderId, lineId });
/** The shop's second scan is read by the server itself. */
export const markPacked = (_fs: any, tenantId: string, orderId: string, _actor: Actor, _opts?: { requirePackScan?: boolean }) => step(tenantId, 'markPacked', { orderId });
export const markReady = (_fs: any, tenantId: string, orderId: string, _actor: Actor) => step<Ans & { autoArrived?: boolean; notifyReady?: boolean }>(tenantId, 'markReady', { orderId });
/** The team member's photo is read by the server from their staff record. */
export const markBringingOut = (_fs: any, tenantId: string, orderId: string, _actor: Actor, _photo?: string) => step(tenantId, 'bringingOut', { orderId });
export const handoffByScan = (_fs: any, tenantId: string, value: string, _actor: Actor, orderId?: string) => step<Ans & { orderNumber?: number; collector?: string | null }>(tenantId, 'handoffScan', { value, ...(orderId ? { orderId } : {}) });
/** Handed over by the 4-digit code the person says (checked on the server, lib/pickup-pass). */
export const handoffByPin = (tenantId: string, orderId: string, pin: string) => step<Ans & { orderNumber?: number; collector?: string | null; locked?: boolean }>(tenantId, 'handoffPin', { orderId, pin });
export const handoffWithoutScan = (_fs: any, tenantId: string, orderId: string, verifiedBy: string, _actor: Actor) => step(tenantId, 'handoffNoScan', { orderId, verifiedBy });
/** Local delivery (lib/retail-fulfill): out with the person signed in as the driver, delivered, or brought back. */
export const markOutForDelivery = (tenantId: string, orderId: string) => step(tenantId, 'deliveryOut', { orderId });
export const markDelivered = (tenantId: string, orderId: string) => step(tenantId, 'deliveryDone', { orderId });
export const markDeliveryFailed = (tenantId: string, orderId: string, reason: string) => step(tenantId, 'deliveryFailed', { orderId, reason });
export const splitReadyFromWaiting = (_fs: any, tenantId: string, orderId: string, _actor: Actor) => step<Ans & { childOrderId?: string }>(tenantId, 'splitReady', { orderId });
export const releaseBackorder = (_fs: any, tenantId: string, orderId: string, _actor: Actor, opts: { onlyIfCovered?: boolean } = {}) => step<Ans & { short?: { productId: string; name: string; have: number; need: number }[] }>(tenantId, 'releaseBackorder', { orderId, onlyIfCovered: opts.onlyIfCovered !== false });
export async function releaseCoverableBackorders(_fs: any, tenantId: string, received: { productId: string; qty: number }[], _actor: Actor): Promise<{ released: any[] }> {
  const r: any = await step(tenantId, 'releaseCovered', { received });
  return { released: Array.isArray(r.released) ? r.released : [] };
}
export const markShipped = (_fs: any, tenantId: string, orderId: string, tracking: { carrier?: string; number?: string; url?: string; extraNumbers?: string[] }, _actor: Actor) => step(tenantId, 'markShipped', { orderId, tracking });
export const cancelOrder = (_fs: any, tenantId: string, orderId: string, _actor: Actor, reason?: string) => step(tenantId, 'cancel', { orderId, reason });
export async function setWaveStatus(_fs: any, tenantId: string, waveId: string, status: 'picking' | 'packing' | 'done' | 'cancelled', _actor?: Actor): Promise<void> {
  const r = await step(tenantId, 'waveStatus', { waveId, status }); if (!r.ok) throw new Error(r.message);
}
export const receiveReturnLine = (_fs: any, tenantId: string, ret: { id: string }, lineId: string, disposition: ReturnDisposition, _actor: Actor) => step<Ans & { allReceived?: boolean }>(tenantId, 'receiveReturnLine', { returnId: ret.id, lineId, disposition });
/** A return opened at the desk (worked out and saved on the server, lib/retail-returns). */
export const openReturn = (_fs: any, tenantId: string, order: { id: string }, selections: { lineId: string; qty: number; reason: string }[], resolution: string, notes: string, _actor: Actor) => step<Ans & { returnId?: string }>(tenantId, 'openReturn', { orderId: order.id, selections, resolution, notes });
/** Asking the customer for more about a report; they're told from the server. */
export const requestClaimInfo = (tenantId: string, claimId: string, text: string) => step(tenantId, 'requestClaimInfo', { claimId, text });
export const resolveReturn = (_fs: any, tenantId: string, ret: { id: string }, _actor: Actor) => step<Ans & { refundQueuedCents?: number; orderQrToken?: string }>(tenantId, 'resolveReturn', { returnId: ret.id });
export const decideClaim = (tenantId: string, claimId: string, approve: boolean, o: { cents?: number | null; declineWhy?: string } = {}) => step<Ans & { cents?: number }>(tenantId, 'decideClaim', { claimId, approve, cents: o.cents ?? null, declineWhy: o.declineWhy || '' });

/** The curbside text for a moment the board sees first (a customer waiting too long: the shop's own number is told). */
export function notifyCurbside(tenantId: string, orderId: string, moment: 'ready' | 'out' | 'staff_escalation'): void {
  if (typeof window === 'undefined') return;
  void (async () => { try { await fetch('/api/retail/curbside-notify', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId, moment }), keepalive: true }); } catch { /* the board banner is still true */ } })();
}
