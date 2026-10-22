'use client';
// src/lib/orders-flow.ts — WHAT THE ORDERS SCREEN DOES WHEN YOU TAP. Each step uses the fulfilment engine
// (lib/retail-fulfill) and then does the follow-up a person would otherwise forget: shelf spot, customer message.
// Returns { ok, message } so every screen (and Klair later) reports the same way.
import { type Firestore, doc, updateDoc } from 'firebase/firestore';
import {
  claimSpecificOrder, markPacked, markReady, notifyCurbside, recordItemScan, recordLineTap, resolveShortLine,
  releaseBatch, undoLineCount, markBringingOut, handoffByScan, handoffWithoutScan, markShipped, cancelOrder, releaseBackorder, type Actor,
} from '@/lib/retail-fulfill';
import { nextFreeSlot } from '@/lib/orders-view';
import { staffAuthHeader } from '@/lib/staff-fetch';

export type Result = { ok: boolean; message: string };

/** Start packing: claims a waiting order for this person (an order already being packed just opens). */
export async function startPacking(fs: Firestore, t: string, o: any, actor: Actor): Promise<Result> {
  if (o.stage === 'picking' || o.stage === 'packed') return { ok: true, message: 'Packing' };
  if (o.stage !== 'paid') return { ok: false, message: 'This order isn’t waiting to be packed.' };
  if (o.holdForReview === true) return { ok: false, message: 'This order is held for review. Decide on it first.' };
  if (o.holdUntilRestock === true) return { ok: false, message: 'This order is waiting on stock. Release it from its page once the items are on the shelf.' };
  const r = await claimSpecificOrder(fs, t, o.id, actor);
  return 'error' in r ? { ok: false, message: r.error } : { ok: true, message: 'Packing' };
}

export async function scanInto(fs: Firestore, t: string, orderId: string, value: string, actor: Actor) {
  return recordItemScan(fs, t, orderId, value, actor);
}
export async function tapInto(fs: Firestore, t: string, orderId: string, lineId: string, actor: Actor) {
  return recordLineTap(fs, t, orderId, lineId, actor);
}

export async function undoTick(fs: Firestore, t: string, orderId: string, lineId: string, actor: Actor) {
  return undoLineCount(fs, t, orderId, lineId, actor);
}

/** A backorder waiting on stock goes into the packing queue (lib/retail-fulfill releaseBackorder). Without `anyway`,
 *  only when everything it needs is on the shelf; the answer says what's short, so the screen can ask first. */
export async function releaseHeld(fs: Firestore, t: string, o: any, actor: Actor, anyway = false) {
  return releaseBackorder(fs, t, o.id, actor, { onlyIfCovered: !anyway });
}

/** Put it down: stops packing and returns the order to the queue for anyone. */
export async function stopPacking(fs: Firestore, t: string, o: any, batch: any, actor: Actor): Promise<Result> {
  if (!batch) return { ok: true, message: 'Saved' };
  await releaseBatch(fs, t, batch, 'manual', actor);
  return { ok: true, message: 'Put back in the queue' };
}

/** Something's missing: refund it now, or send it when it's back. The customer is told either way. */
export async function markMissing(fs: Firestore, t: string, orderId: string, lineId: string, how: 'refund' | 'backorder', reason: string, actor: Actor): Promise<Result> {
  return resolveShortLine(fs, t, orderId, lineId, reason || 'Not on the shelf', how, actor);
}

/** Everything is in. Pickup and curbside orders go straight to the shelf with a spot, and the customer is told.
 *  Ship orders stay packed, ready for a label. */
export async function finishPacking(fs: Firestore, t: string, o: any, all: any[], actor: Actor, rs: any): Promise<Result & { slot?: string }> {
  const p = await markPacked(fs, t, o.id, actor, { requirePackScan: rs?.requirePackScan === true });
  if (!p.ok) return p;
  if (o.method === 'ship') return { ok: true, message: 'Packed. Ready for a label.' };
  const r: any = await markReady(fs, t, o.id, actor);
  if (!r.ok) return { ok: true, message: `Packed. ${r.message}` };
  const slot = nextFreeSlot(all.filter((x) => x.id !== o.id));
  try { await updateDoc(doc(fs, `tenants/${t}/retailOrders`, o.id), { shelfSlot: slot }); } catch { /* a missing spot is cosmetic */ }
  if (o.method === 'curbside') { if (r.notifyReady) notifyCurbside(t, o.id, 'ready'); }
  else void tellReady(t, o.id);
  return { ok: true, message: `Ready. Put it on shelf ${slot}.`, slot };
}

/** Counter pickup: tell the customer it's ready (the curbside text only covers curbside). */
export async function tellReady(t: string, orderId: string): Promise<void> {
  try { await fetch('/api/retail/ready-notify', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId: t, orderId }) }); } catch { /* the order page shows it either way */ }
}

export async function bringingOut(fs: Firestore, t: string, o: any, actor: Actor, photo?: string): Promise<Result> {
  const r = await markBringingOut(fs, t, o.id, actor, photo);
  if (r.ok) notifyCurbside(t, o.id, 'out');
  return r;
}

export { syncRenterCredits } from './renter-credit-client';

export async function handOver(fs: Firestore, t: string, o: any, actor: Actor, via: { scan?: string; verifiedBy?: string }): Promise<Result> {
  return via.scan ? handoffByScan(fs, t, via.scan, actor) : handoffWithoutScan(fs, t, o.id, via.verifiedBy || 'Checked name and phone', actor);
}

export async function shipIt(fs: Firestore, t: string, o: any, actor: Actor, tracking: { carrier?: string; number?: string; url?: string; extraNumbers?: string[] }): Promise<Result> {
  const r = await markShipped(fs, t, o.id, tracking, actor);
  // Tracking typed from a label bought elsewhere: the carrier won't tell the customer, so we do.
  if (r.ok && !o.shippoTransactionId && (tracking.number || o.trackingNumber)) {
    try { await fetch('/api/retail/shipped-notify', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId: t, orderId: o.id }) }); } catch { /* the order page shows tracking either way */ }
  }
  return r;
}

export async function cancelIt(fs: Firestore, t: string, o: any, actor: Actor, reason: string): Promise<Result> {
  const r = await cancelOrder(fs, t, o.id, actor, reason);
  if (!r.ok) return r;
  // Gift card and store credit used on the order go back to the customer (lib/cancel-restore).
  if ((Number(o.giftCardCents) || 0) > 0 || (Number(o.storeCreditRequestedCents) || 0) > 0) {
    try { await fetch('/api/retail/cancel-restore', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId: t, orderId: o.id }) }); } catch { /* the nightly check catches up */ }
  }
  // A label already bought for it: voided now, so the postage comes back. If this person can't void labels, the
  // morning check does it (lib/label-sweep).
  if (o.shippoTransactionId && o.qrToken) {
    let voided = false; let refused = '';
    try {
      const v = await fetch('/api/retail/shipping-label', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId: t, orderId: o.id, qrToken: o.qrToken, action: 'void', auto: true }) });
      voided = v.ok; if (!v.ok) refused = String((await v.json().catch(() => ({})))?.refused || '');
    } catch { /* overnight */ }
    // Why it wasn't voided decides what happens next: shared and USPS-form labels are never voided automatically.
    const after = voided ? 'Its label was voided, so the postage comes back.'
      : refused === 'shared' ? 'Its label also covers other orders in the same box, so it wasn’t voided.'
      : refused === 'form' ? 'Its label is on a USPS form, so it wasn’t voided. If the box didn’t go out, void the label from the order.'
      : refused === 'moving' ? 'The carrier has already scanned its box, so the label can’t be voided.'
      : 'Its label will be checked overnight and voided if it was never used.';
    return { ...r, message: `${r.message} ${after}` };
  }
  return r;
}
