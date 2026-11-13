import { shrinkStock } from './retail-orders';
import { deliveryFrom, followUpDelivery } from './delivery-plan';
import { failReason, proofNeeded, type FailCode } from './delivery-run';
import { taxShareCents } from './restocking';
import {
  type Firestore, collection, doc, getDoc, getDocs, limit, query, runTransaction, where,
} from '@/lib/fs-any';
import { nanoid } from 'nanoid';

import {
  BATCH_CLAIM_TIMEOUT_MIN, MAX_SHIP_ORDERS_PER_BATCH, STAGE_LABELS,
  applyPackScan, applyBoxScan, isPackComplete,
  applyScan, buildEvent, canAdvance, depleteBatchesFIFO, fulfilledQty,
  isClaimStale, isPickComplete, lineMatchesScan, parseOrderQr, queuePriority, shortLine,
  type FulfillmentBatch, type FulfilmentPolicy, type InventoryBatchRef, type OrderEventType,
  type RetailOrder, type ShortResolution,
} from '@/lib/retail-orders';
import { buildEntry } from '@/lib/stock-ledger';
import { effectiveUnitCents } from '@/lib/retail-swap';
import { labelDoubt, labelHolderId } from '@/lib/label-doubt';
import { cancelWithFollowUps, followUpCancelCents, followUpLabel, heldUnits, isFollowUp, lineFor, taxBasisOf } from '@/lib/order-family';
import { resolveOrderScan, scanMissMessage, type ScanResolution } from '@/lib/scan-resolve';
import { handoffRecord, pinKeyOf, pinMatches, PIN_TRIES, type HandoffMethod } from '@/lib/pickup-pass';
import { lineCounts, tappedLines, type Approval } from '@/lib/scan-rule';
import { bagsToLoad, bagsToScan, bagsToShelve, clampBags, goesInBags, parseBagCode, parseSpot } from '@/lib/bag-tag';
import { checkBagCode } from '@/lib/order-qr';
import { pickForSpot, spotDue, spotLines, spotMistakes } from '@/lib/spot-check';

// ─── src/lib/retail-fulfill.ts ────────────────────────────────────────────────
// The fulfillment steps. They run on the server (api/retail/fulfil, with the
// person's role checked first; screens call them through lib/fulfil-client).
// Every state change runs in a TRANSACTION with the engine's guards re-checked
// against fresh data, so two phones acting at once can never double-claim,
// double-scan, or double-deplete. Every action appends its audit event in the
// same atomic write. Written against lib/fs-any, so the same code runs on the
// server's database.

export interface Actor { id: string; name: string; }

/** What happens after a step commits, outside its transaction (a retried transaction must never send twice): the
 *  customer's messages, renters' shares and the order's tip. The server (api/retail/fulfil) sets these; until then
 *  nothing is sent, and the nightly and five-minute jobs catch up on shares and tips. */
export type FulfilEffects = {
  curbside: (tenantId: string, orderId: string, moment: 'ready' | 'out' | 'staff_escalation') => void;
  short: (tenantId: string, orderId: string, lineId: string) => void;
  renterCredits: (tenantId: string, order: any) => void;
  tip: (tenantId: string, order: any) => void;
};
const NONE: FulfilEffects = { curbside: () => {}, short: () => {}, renterCredits: () => {}, tip: () => {} };
let effects: FulfilEffects = NONE;
export function setFulfilEffects(e: Partial<FulfilEffects>): void { effects = { ...NONE, ...e }; }
const syncRenterCredits = (t: string, o: any) => { try { effects.renterCredits(t, o); } catch { /* the nightly job catches up */ } };
const shareOrderTipSoon = (t: string, o: any) => { try { effects.tip(t, o); } catch { /* the five-minute job catches up */ } };

/** Firestore rejects `undefined` anywhere in a payload ("invalid data …
 * in field meta"). Every event/correction is scrubbed here so no code path
 * can ever hand the database an undefined again. */
const clean = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const orderCol = (fs: Firestore, t: string) => collection(fs, `tenants/${t}/retailOrders`);
const batchCol = (fs: Firestore, t: string) => collection(fs, `tenants/${t}/fulfillmentBatches`);
const invDoc = (fs: Firestore, t: string, id: string) => doc(fs, `tenants/${t}/inventory`, id);

function evPayloadRaw(type: OrderEventType, actor: Actor, meta?: Record<string, string | number | boolean>) {
  return { id: `ev-${nanoid(10)}`, ...buildEvent(type, actor.id, actor.name, meta) };
}

const evPayload = (...args: Parameters<typeof evPayloadRaw>) => clean(evPayloadRaw(...args));

function correctionRaw(
  productId: string, unit: string, change: number, reason: string, orderId: string, actor: Actor
) {
  return {
    productId, change, unit, reason,
    date: new Date().toISOString(),
    orderId, actorId: actor.id, actorName: actor.name, source: 'retail_engine',
  };
}

const correction = (...args: Parameters<typeof correctionRaw>) => clean(correctionRaw(...args));

/* ════════════════════════════════════════════════════════════════════════════
 * TAKE NEXT — atomic batch claim
 * ════════════════════════════════════════════════════════════════════════════ */

export async function claimNextBatch(
  fs: Firestore, tenantId: string, actor: Actor, maxOrders?: number, policy?: FulfilmentPolicy,
): Promise<{ batchId: string; orderIds: string[] } | { error: string }> {
  const snap = await getDocs(query(orderCol(fs, tenantId), where('stage', '==', 'paid')));
  const nowMs = Date.now();
  const candidates = snap.docs
    .map((d: any) => ({ ...(d.data() as RetailOrder), id: d.id as string }))
    .filter((o: RetailOrder & { id: string }) => !o.batchId && !(o as any).waveId && o.holdUntilRestock !== true && (o as any).holdForReview !== true)   // a wave order is already in someone's tote; a held order waits for a manager
    // The shop's own due times (its shipping schedule and clock), so "next" here is the order the board shows first.
    // Each order's place is worked out once, then sorted.
    .map((o: RetailOrder & { id: string }) => ({ o, p: queuePriority(o, policy, nowMs) }))
    .sort((a: { p: number }, b: { p: number }) => a.p - b.p)
    .map((x: { o: RetailOrder & { id: string } }) => x.o);

  if (candidates.length === 0) return { error: 'The queue is empty. There are no orders to pick.' };

  // Wave composition: ASAP orders pick solo; ship orders batch together.
  const head = candidates[0];
  const wave = head.method === 'ship'
    ? candidates.filter((o: RetailOrder) => o.method === 'ship').slice(0, Math.max(1, Math.min(MAX_SHIP_ORDERS_PER_BATCH, maxOrders ?? MAX_SHIP_ORDERS_PER_BATCH)))
    : [head];

  const batchRef = doc(batchCol(fs, tenantId));
  const now = new Date().toISOString();

  try {
    const claimed = await runTransaction(fs, async (txn) => {
      const refs = wave.map((o: RetailOrder & { id: string }) => doc(orderCol(fs, tenantId), o.id));
      const fresh = await Promise.all(refs.map((r: any) => txn.get(r)));
      const still = fresh
        .map((s, i) => ({ snap: s, ref: refs[i] }))
        .filter(({ snap }) => snap.exists() && (snap.data() as RetailOrder).stage === 'paid' && !(snap.data() as RetailOrder).batchId);

      if (still.length === 0) return [] as string[];

      const batchDoc: FulfillmentBatch = {
        id: batchRef.id, tenantId,
        orderIds: still.map(({ snap }) => snap.id),
        phase: 'pick',
        assignedTo: actor.id, assignedToName: actor.name,
        claimedAt: now, active: true,
      };
      txn.set(batchRef, JSON.parse(JSON.stringify(batchDoc)));

      for (const { snap, ref } of still) {
        // Who's on it, on the order itself, so every screen (and the staff portal) can show it and find it.
        txn.update(ref, { stage: 'picking', batchId: batchRef.id, claimedBy: actor.id, claimedByName: actor.name, claimedAt: now });
        txn.set(doc(collection(ref, 'events')), evPayload('batch_claimed', actor, {
          batchId: batchRef.id, waveSize: still.length,
        }));
      }
      return still.map(({ snap }) => snap.id);
    });

    if (claimed.length === 0) return { error: 'Another team member has already claimed that order. Please tap Take Next again.' };
    return { batchId: batchRef.id, orderIds: claimed };
  } catch (e: any) {
    return { error: e?.message || 'We could not claim that order. Please try again.' };
  }
}

/**
 * Claim ONE specific order (scan-to-claim): scanning an item that belongs to
 * a queue order claims that order and keeps moving — the shelf walk IS the
 * workflow, no Take Next detour. Same race-safety as claimNextBatch: the
 * stage and batchId are re-verified inside the transaction, so two phones
 * scanning the same product resolve to exactly one winner.
 */
export async function claimSpecificOrder(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor
): Promise<{ batchId: string } | { error: string }> {
  const batchRef = doc(batchCol(fs, tenantId));
  const now = new Date().toISOString();
  try {
    const ok = await runTransaction(fs, async (txn) => {
      const ref = doc(orderCol(fs, tenantId), orderId);
      const snap = await txn.get(ref);
      if (!snap.exists()) return false;
      const o = snap.data() as RetailOrder;
      if (o.stage !== 'paid' || o.batchId || o.holdUntilRestock === true || (o as any).holdForReview === true) return false;   // held orders wait for a manager

      const batchDoc: FulfillmentBatch = {
        id: batchRef.id, tenantId,
        orderIds: [orderId],
        phase: 'pick',
        assignedTo: actor.id, assignedToName: actor.name,
        claimedAt: now, active: true,
      };
      txn.set(batchRef, JSON.parse(JSON.stringify(batchDoc)));
      txn.update(ref, { stage: 'picking', batchId: batchRef.id, claimedBy: actor.id, claimedByName: actor.name, claimedAt: now });
      txn.set(doc(collection(ref, 'events')), evPayload('batch_claimed', actor, {
        batchId: batchRef.id, waveSize: 1, scanToClaim: true,
      }));
      return true;
    });
    if (!ok) return { error: 'Another team member has already claimed that order.' };
    return { batchId: batchRef.id };
  } catch (e: any) {
    return { error: e?.message || 'We could not claim that order.' };
  }
}

/**
 * Take over an order someone else is packing (or picked at the shelf and left at the bench): it moves out of their
 * batch into one of yours, with every count kept, and the record says who took it from whom. Re-checked inside the
 * transaction, so two people can't both take it.
 */
export async function takeOverOrder(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  const newRef = doc(batchCol(fs, tenantId));
  const now = new Date().toISOString();
  try {
    return await runTransaction(fs, async (txn) => {
      const ref = doc(orderCol(fs, tenantId), orderId);
      const snap = await txn.get(ref);
      if (!snap.exists()) return { ok: false, message: 'Order not found.' };
      const o = snap.data() as RetailOrder & Record<string, any>;
      if (o.stage !== 'picking') return { ok: false, message: 'This order isn’t being packed any more.' };
      if (o.claimedBy === actor.id) return { ok: true, message: 'You’re packing it.' };
      // A wave order is packed from its tote without a batch of its own (lib/waves): only who's packing it changes, so it
      // never goes back to the queue on a claim timer and out of its wave.
      if (o.waveId) {
        txn.update(ref, { claimedBy: actor.id, claimedByName: actor.name, claimedAt: now });
        txn.set(doc(collection(ref, 'events')), evPayload('note', actor, { kind: 'taken_over', from: o.claimedByName || null, text: `Took over packing${o.claimedByName ? ` from ${o.claimedByName}` : ''}` }));
        return { ok: true, message: 'You’re packing it now.' };
      }
      const oldRef = o.batchId ? doc(batchCol(fs, tenantId), String(o.batchId)) : null;
      const oldSnap = oldRef ? await txn.get(oldRef) : null;
      if (oldRef && oldSnap?.exists()) {
        const rest = ((oldSnap.data() as FulfillmentBatch).orderIds || []).filter((id) => id !== orderId);
        txn.update(oldRef, rest.length ? { orderIds: rest } : { orderIds: rest, active: false, releasedAt: now, releaseType: 'taken_over' });
      }
      const batchDoc: FulfillmentBatch = { id: newRef.id, tenantId, orderIds: [orderId], phase: 'pack', assignedTo: actor.id, assignedToName: actor.name, claimedAt: now, active: true } as any;
      txn.set(newRef, JSON.parse(JSON.stringify(batchDoc)));
      txn.update(ref, { batchId: newRef.id, claimedBy: actor.id, claimedByName: actor.name, claimedAt: now });
      txn.set(doc(collection(ref, 'events')), evPayload('note', actor, { kind: 'taken_over', from: o.claimedByName || null, text: `Took over packing${o.claimedByName ? ` from ${o.claimedByName}` : ''}` }));
      return { ok: true, message: 'You’re packing it now.' };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'That didn’t go through. Try again.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * RELEASE + AUTO-RELEASE SWEEP
 * ════════════════════════════════════════════════════════════════════════════ */

export async function releaseBatch(
  fs: Firestore, tenantId: string, batch: FulfillmentBatch, type: 'manual' | 'auto', actor: Actor
): Promise<void> {
  await runTransaction(fs, async (txn) => {
    const bRef = doc(batchCol(fs, tenantId), batch.id);
    const bSnap = await txn.get(bRef);
    if (!bSnap.exists() || bSnap.data().active !== true) return;

    const refs = batch.orderIds.map((id) => doc(orderCol(fs, tenantId), id));
    const snaps = await Promise.all(refs.map((r) => txn.get(r)));

    txn.update(bRef, { active: false, releasedAt: new Date().toISOString(), releaseType: type });
    snaps.forEach((s, i) => {
      if (s.exists() && (s.data() as RetailOrder).stage === 'picking') {
        txn.update(refs[i], { stage: 'paid', batchId: null, claimedBy: null, claimedByName: null, claimedAt: null });
        txn.set(doc(collection(refs[i], 'events')),
          evPayload(type === 'auto' ? 'batch_auto_released' : 'batch_released', actor, { batchId: batch.id }));
      }
    });
  });
}

/** Any open board calls this on load + every minute. Scales from solo to team. */
export async function sweepStaleClaims(fs: Firestore, tenantId: string): Promise<number> {
  const snap = await getDocs(query(batchCol(fs, tenantId), where('active', '==', true)));
  const stale = snap.docs
    .map((d: any) => ({ ...(d.data() as FulfillmentBatch), id: d.id as string }))
    .filter((b: FulfillmentBatch) => isClaimStale(b));
  for (const b of stale) {
    await releaseBatch(fs, tenantId, b, 'auto', { id: 'system', name: `Auto (${BATCH_CLAIM_TIMEOUT_MIN}m idle)` });
  }
  return stale.length;
}

/* ════════════════════════════════════════════════════════════════════════════
 * PICKING — scan gate + shortline
 * ════════════════════════════════════════════════════════════════════════════ */

export type ScanAnswer = { ok: boolean; message: string; pickComplete?: boolean; packComplete?: boolean; lineId?: string; name?: string; miss?: ScanResolution['kind'];
  /** A scan at the box: picked and into the box at once, or (second scan) an item picked at the shelf checked in, or a
   *  unit ticked by hand before the shop scanned every item, confirmed (nothing more is counted). */
  kind?: 'picked' | 'checked' | 'confirmed' };

/** Works a scan out against the products' current records when the order's own codes don't match (lib/scan-resolve):
 *  a barcode added after the order was placed, another code the product carries, a test order, a duplicate label, a
 *  parent product's code. Best-effort: the order's own codes are always checked in the transaction. */
async function resolveFirst(fs: Firestore, tenantId: string, orderId: string, scannedValue: string, packCheck: boolean | 'box'): Promise<ScanResolution | null> {
  try {
    const pre = await getDoc(doc(orderCol(fs, tenantId), orderId));
    if (!pre.exists()) return null;
    return await resolveOrderScan(fs, tenantId, ((pre.data() as RetailOrder).lines || []) as any, scannedValue, packCheck);
  } catch { return null; }
}

export async function recordItemScan(
  fs: Firestore, tenantId: string, orderId: string, scannedValue: string, actor: Actor, opts: { confirmTaps?: boolean } = {}
): Promise<ScanAnswer> {
  const found = await resolveFirst(fs, tenantId, orderId, scannedValue, false);
  const hint = found?.kind === 'line' ? found.hint : null;
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = oSnap.data() as RetailOrder;
      if (order.stage !== 'picking') {
        return { ok: false, message: `This order is ${STAGE_LABELS[order.stage]}, so scanning is closed.` };
      }

      const { result, lines } = applyScan(order.lines, scannedValue, hint);
      // Every unit of it already counted, some ticked by hand before the shop scanned every item: this scan confirms one
      // of those (lib/scan-rule), as at the box. Nothing more is counted.
      if (!result.ok && opts.confirmTaps && result.code === 'over_scan') {
        const ti = order.lines.findIndex((l) => (hint?.lineId ? l.lineId === hint.lineId : lineMatchesScan(l, scannedValue)) && lineCounts(l).tapped > 0);
        if (ti >= 0) {
          const t0 = order.lines[ti];
          txn.update(oRef, { lines: JSON.parse(JSON.stringify(order.lines.map((l, i) => (i === ti ? { ...l, qtyTapped: Math.max(0, (Number(l.qtyTapped) || 0) - 1) } : l)))) });
          txn.set(doc(collection(oRef, 'events')), evPayload('item_scanned', actor, { lineId: t0.lineId, qtyScanned: t0.qtyScanned, qtyOrdered: t0.qtyOrdered, phase: (order as any).waveId ? 'pack' : 'pick', confirmedTap: true }));
          return { ok: true, message: 'Confirmed by scan', lineId: t0.lineId, name: t0.name, kind: 'confirmed', pickComplete: isPickComplete(order.lines) };
        }
      }
      if (!result.ok) {
        txn.set(doc(collection(oRef, 'events')),
          evPayload('scan_mismatch', actor, {
            scannedValue: scannedValue.slice(0, 80), code: result.code,
            phase: order.waveId ? 'pack' : 'pick',
          }));
        // Not on the order: say which product it is, or that no product has the code yet.
        const message = result.code === 'unknown_sku' && found ? scanMissMessage(found, scannedValue, order.lines as any) : result.message;
        return { ok: false, message, miss: result.code === 'unknown_sku' ? (found?.kind || 'unknown') : undefined };
      }

      txn.update(oRef, { lines: JSON.parse(JSON.stringify(lines)) });
      // PHASE STAMP. There is one scan counter per line, and where it gets
      // filled depends on the route the order took: the board's scanner during
      // ad-hoc picking, or the pack bench after a wave was ticked off a sheet.
      // Without recording which, the audit trail cannot answer "was this
      // verified at the shelf or at the box" — and the KPI derivation cannot
      // tell a picker's work from a packer's.
      txn.set(doc(collection(oRef, 'events')), evPayload('item_scanned', actor, {
        lineId: result.lineId, qtyScanned: result.qtyScanned, qtyOrdered: result.qtyOrdered,
        phase: order.waveId ? 'pack' : 'pick',
        ...(hint ? { matchedBy: (found as any).via } : {}),
      }));
      if (result.pickComplete) {
        txn.set(doc(collection(oRef, 'events')), evPayload('pick_complete', actor));
      }
      return {
        ok: true,
        message: `${result.qtyScanned}/${result.qtyOrdered}`,
        pickComplete: result.pickComplete,
        lineId: result.lineId,
        name: result.name,
      };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'The scan did not go through. Please try again.' };
  }
}

/**
 * A scan AT THE BOX, on the order's packing screen (lib/retail-orders applyBoxScan): the unit counts as picked and as in
 * the box, so an order packed this way is never asked for a second scan. With the shop's second scan on (`secondScan`),
 * an item picked at the shelf is checked into the box by the same scan. Same event discipline as a pick scan; the
 * record says it was at the box.
 */
export async function recordBoxScan(
  fs: Firestore, tenantId: string, orderId: string, scannedValue: string, actor: Actor, opts: { secondScan?: boolean; confirmTaps?: boolean } = {}
): Promise<ScanAnswer> {
  const secondScan = opts.secondScan === true;
  // With the second scan on, the code is worked out against lines still to pick and lines still to check in.
  const found = await resolveFirst(fs, tenantId, orderId, scannedValue, secondScan ? 'box' : false);
  const hint = found?.kind === 'line' ? found.hint : null;
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = oSnap.data() as RetailOrder;
      if (order.stage !== 'picking') return { ok: false, message: `This order is ${STAGE_LABELS[order.stage]}, so scanning is closed.` };
      const { result, lines } = applyBoxScan(order.lines, scannedValue, hint, secondScan);
      // Every unit of it already counted, some ticked by hand before the shop scanned every item: this scan confirms one
      // of those (lib/scan-rule). Nothing more is counted.
      if (!result.ok && opts.confirmTaps && (result.code === 'over_scan' || result.code === 'line_closed')) {
        const ti = order.lines.findIndex((l) => (hint?.lineId ? l.lineId === hint.lineId : lineMatchesScan(l, scannedValue)) && lineCounts(l).tapped > 0);
        if (ti >= 0) {
          const t0 = order.lines[ti];
          const confirmed = order.lines.map((l, i) => (i === ti ? { ...l, qtyTapped: Math.max(0, (Number(l.qtyTapped) || 0) - 1) } : l));
          txn.update(oRef, { lines: JSON.parse(JSON.stringify(confirmed)) });
          txn.set(doc(collection(oRef, 'events')), evPayload('item_scanned', actor, { lineId: t0.lineId, qtyScanned: t0.qtyScanned, qtyOrdered: t0.qtyOrdered, phase: 'pack', atBox: true, confirmedTap: true }));
          return { ok: true, message: 'Confirmed by scan', lineId: t0.lineId, name: t0.name, kind: 'confirmed', pickComplete: isPickComplete(order.lines), packComplete: isPackComplete(order.lines) };
        }
      }
      if (!result.ok) {
        txn.set(doc(collection(oRef, 'events')), evPayload('scan_mismatch', actor, { scannedValue: scannedValue.slice(0, 80), code: result.code, phase: 'pack', atBox: true }));
        const message = result.code === 'unknown_sku' && found ? scanMissMessage(found, scannedValue, order.lines as any) : result.message;
        return { ok: false, message, miss: result.code === 'unknown_sku' ? (found?.kind || 'unknown') : undefined };
      }
      // With the second scan on, a unit ticked by hand (before the shop scanned every item) checked into the box by this
      // scan is confirmed by it too: one scan, not two.
      const confirming = opts.confirmTaps === true && result.kind === 'checked' && lines.some((l) => l.lineId === result.lineId && lineCounts(l).tapped > 0);
      const saved = confirming ? lines.map((l) => (l.lineId === result.lineId ? { ...l, qtyTapped: Math.max(0, (Number(l.qtyTapped) || 0) - 1) } : l)) : lines;
      txn.update(oRef, { lines: JSON.parse(JSON.stringify(saved)) });
      txn.set(doc(collection(oRef, 'events')), evPayload('item_scanned', actor, {
        lineId: result.lineId, qtyScanned: result.qtyScanned, qtyOrdered: result.qtyOrdered,
        phase: result.kind === 'checked' ? 'pack_check' : (order as any).waveId ? 'pack' : 'pick', atBox: true,
        ...(hint ? { matchedBy: (found as any).via } : {}), ...(confirming ? { confirmedTap: true } : {}),
      }));
      const wasPicked = isPickComplete(order.lines);
      if (result.pickComplete && !wasPicked) txn.set(doc(collection(oRef, 'events')), evPayload('pick_complete', actor));
      if (secondScan && result.packComplete && !isPackComplete(order.lines)) txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, { text: 'Every unit is in the box, checked by scan' }));
      return { ok: true, message: `${result.qtyScanned}/${result.qtyOrdered}`, pickComplete: result.pickComplete, packComplete: result.packComplete, lineId: result.lineId, name: result.name, kind: result.kind };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'The scan did not go through. Please try again.' };
  }
}

/** Tap-to-pack: one unit of one line counted by hand, for shops that don't scan every item. Same guards and timeline as
 *  a scan, marked as a tap on the line (qtyTapped) and in the record, so neither says it was scanned. While the shop
 *  scans every item (lib/scan-rule, read by the server), a tap counts nothing, whatever screen sent it. */
export async function recordLineTap(
  fs: Firestore, tenantId: string, orderId: string, lineId: string, actor: Actor, opts: { scanRequired?: boolean } = {}
): Promise<{ ok: boolean; message: string; pickComplete?: boolean }> {
  if (opts.scanRequired) return { ok: false, message: 'Every item is scanned here. Scan it, or tap it for help if it won’t scan.' };
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = oSnap.data() as RetailOrder;
      if (order.stage !== 'picking') return { ok: false, message: `This order is ${STAGE_LABELS[order.stage]}, so packing is closed.` };
      const idx = order.lines.findIndex((l) => l.lineId === lineId);
      if (idx < 0) return { ok: false, message: 'That item isn’t on this order.' };
      const line = order.lines[idx];
      if (['shorted', 'refunded', 'backordered'].includes(line.status)) return { ok: false, message: `${line.name} was marked missing. Undo that first.` };
      if (line.qtyScanned >= line.qtyOrdered) return { ok: false, message: `All ${line.qtyOrdered} ${line.name} are already in.` };
      const lines = order.lines.map((l, i) => i === idx ? { ...l, qtyScanned: l.qtyScanned + 1, qtyTapped: (Number(l.qtyTapped) || 0) + 1 } : l);
      const complete = isPickComplete(lines);
      txn.update(oRef, { lines: JSON.parse(JSON.stringify(lines)) });
      txn.set(doc(collection(oRef, 'events')), evPayload('item_scanned', actor, { lineId, qtyScanned: line.qtyScanned + 1, qtyOrdered: line.qtyOrdered, phase: 'pick', via: 'tap' }));
      if (complete) txn.set(doc(collection(oRef, 'events')), evPayload('pick_complete', actor));
      return { ok: true, message: `${line.qtyScanned + 1}/${line.qtyOrdered}`, pickComplete: complete };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'That didn’t save. Try again.' };
  }
}

/** AN ITEM THAT WON'T SCAN, APPROVED (lib/scan-rule). One unit of one line counted without a scan, by the person whose
 *  PIN the server checked (`approver`, who may not be the person packing), with one of the reasons. On the packing
 *  screen it counts as picked and in the box, as a scan at the box does; with the second scan on, a unit already picked
 *  at the shelf is approved into the box instead. Kept on the line (qtyApproved, approvals) and in the record as a rule
 *  set aside, with who approved it and why. One unit per approval: two of the same take two. */
export async function approveLineUnit(
  fs: Firestore, tenantId: string, orderId: string, lineId: string, actor: Actor,
  approver: { id: string; name: string }, reason: string, opts: { secondScan?: boolean } = {}
): Promise<{ ok: boolean; message: string; kind?: 'picked' | 'checked'; pickComplete?: boolean; packComplete?: boolean; lineId?: string; name?: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = oSnap.data() as RetailOrder;
      if (order.stage !== 'picking') return { ok: false, message: `This order is ${STAGE_LABELS[order.stage]}, so packing is closed.` };
      const idx = order.lines.findIndex((l) => l.lineId === lineId);
      if (idx < 0) return { ok: false, message: 'That item isn’t on this order.' };
      const line = order.lines[idx];
      if (line.digital === true) return { ok: false, message: `${line.name} is a download. There’s nothing to pack.` };
      const owed = Math.max(0, line.qtyOrdered - (line.qtyShorted || 0));
      const closed = ['shorted', 'refunded', 'backordered'].includes(line.status);
      // A unit still to pick is picked and put in the box; with the second scan on, a unit picked at the shelf goes in.
      const kind: 'picked' | 'checked' | null = !closed && line.qtyScanned < line.qtyOrdered ? 'picked'
        : opts.secondScan && !(order as any).waveId && (line.qtyPacked || 0) < owed ? 'checked' : null;
      if (!kind) return { ok: false, message: owed <= 0 ? `${line.name} was marked missing. Undo that first.` : `All ${owed} ${line.name} are already in.` };
      const at = new Date().toISOString();
      const approval: Approval = { by: String(approver.name || 'A manager').slice(0, 60), byId: String(approver.id || '').slice(0, 160), reason: String(reason).slice(0, 60), at, phase: kind === 'checked' ? 'check' : 'pick' };
      const lines = order.lines.map((l, i) => {
        if (i !== idx) return l;
        // Counted without any scan ('picked'), or a unit scanned at the shelf approved into the box ('checked'): that one
        // was still scanned once, so it's kept apart (qtyApprovedIn) and evidence still counts it as scanned.
        return {
          ...l,
          qtyScanned: kind === 'picked' ? l.qtyScanned + 1 : l.qtyScanned,
          qtyPacked: Math.min(owed, (l.qtyPacked || 0) + 1),
          ...(kind === 'picked' ? { qtyApproved: (Number(l.qtyApproved) || 0) + 1 } : { qtyApprovedIn: (Number(l.qtyApprovedIn) || 0) + 1 }),
          approvals: [...(Array.isArray(l.approvals) ? l.approvals : []), approval].slice(-Math.max(1, 2 * l.qtyOrdered)),
        };
      });
      txn.update(oRef, { lines: JSON.parse(JSON.stringify(lines)) });
      txn.set(doc(collection(oRef, 'events')), evPayload('override', actor, {
        rule: 'unit_approved', lineId, name: String(line.name || '').slice(0, 80), reason: approval.reason,
        approvedBy: approval.by, approvedById: approval.byId, phase: kind === 'checked' ? 'pack_check' : 'pick',
      }));
      const pickComplete = isPickComplete(lines);
      if (pickComplete && !isPickComplete(order.lines)) txn.set(doc(collection(oRef, 'events')), evPayload('pick_complete', actor));
      const u = lines[idx];
      return { ok: true, message: `${kind === 'checked' ? u.qtyPacked : u.qtyScanned}/${owed}`, kind, pickComplete, packComplete: isPackComplete(lines), lineId, name: line.name };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'That didn’t save. Try again.' };
  }
}

/** Undo one tick or scan on a line (a slip of the finger). Only while the order is still being packed. `via` says how
 *  the unit was counted (a scan, a tap, an approval), so the line's record of it comes off too. */
export async function undoLineCount(
  fs: Firestore, tenantId: string, orderId: string, lineId: string, actor: Actor, what: 'scan' | 'box' | 'check' = 'scan',
  via: 'scan' | 'tap' | 'approve' = 'scan'
): Promise<{ ok: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = oSnap.data() as RetailOrder;
      if (order.stage !== 'picking') return { ok: false, message: 'Packing is already finished for this order.' };
      const idx = order.lines.findIndex((l) => l.lineId === lineId);
      // What's taken back: a counted unit (scan), a unit counted at the box (picked and in the box), or a unit's check
      // into the box (second scan) only.
      if (idx < 0 || (what === 'check' ? (order.lines[idx].qtyPacked || 0) <= 0 : order.lines[idx].qtyScanned <= 0)) return { ok: false, message: 'Nothing to undo.' };
      const l0 = order.lines[idx];
      const list = (Array.isArray(l0.approvals) ? l0.approvals : []) as Approval[];
      const last = list[list.length - 1];
      // An approval or a tap is taken back only as what it was, so an undo can never leave a unit counted with its
      // approval gone, or its tick gone and still counted (lib/scan-rule). The line says what's there, not the request.
      if (via === 'approve') {
        const phase = last?.phase === 'check' ? 'check' : 'pick';
        const has = phase === 'check' ? Number(l0.qtyApprovedIn) || 0 : Number(l0.qtyApproved) || 0;
        if (!last || has <= 0 || what === 'scan' || (what === 'check') !== (phase === 'check')) return { ok: false, message: 'Nothing to undo.' };
      }
      if (via === 'tap' && (what !== 'scan' || (Number(l0.qtyTapped) || 0) <= 0)) return { ok: false, message: 'Nothing to undo.' };
      const lines = order.lines.map((l, i) => {
        if (i !== idx) return l;
        const next: any = {
          ...l,
          ...(what !== 'check' ? { qtyScanned: l.qtyScanned - 1 } : {}),
          ...(what !== 'scan' ? { qtyPacked: Math.max(0, (l.qtyPacked || 0) - 1) } : {}),
        };
        if (via === 'tap') next.qtyTapped = Math.max(0, (Number(l.qtyTapped) || 0) - 1);
        if (via === 'approve') {
          if (what === 'check') next.qtyApprovedIn = Math.max(0, (Number(l.qtyApprovedIn) || 0) - 1);
          else next.qtyApproved = Math.max(0, (Number(l.qtyApproved) || 0) - 1);
          next.approvals = list.slice(0, -1);
        }
        // Never more approved or ticked than there are units counted.
        const scanned = Number(next.qtyScanned) || 0; const packed = Number(next.qtyPacked) || 0;
        if ((Number(next.qtyApproved) || 0) > scanned) next.qtyApproved = scanned;
        if ((Number(next.qtyApprovedIn) || 0) > packed) next.qtyApprovedIn = packed;
        if ((Number(next.qtyTapped) || 0) > scanned - (Number(next.qtyApproved) || 0)) next.qtyTapped = Math.max(0, scanned - (Number(next.qtyApproved) || 0));
        const keep = (Number(next.qtyApproved) || 0) + (Number(next.qtyApprovedIn) || 0);
        if (Array.isArray(next.approvals) && next.approvals.length > keep) next.approvals = next.approvals.slice(next.approvals.length - keep);
        return next;
      });
      txn.update(oRef, { lines: JSON.parse(JSON.stringify(lines)) });
      txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, { kind: 'count_undone', lineId, text: via === 'approve' ? `Took back the approval for one ${order.lines[idx].name}` : `Took one ${order.lines[idx].name} back out` }));
      return { ok: true, message: 'Undone' };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'That didn’t save. Try again.' };
  }
}

/**
 * Shelf discrepancy: fewer units physically exist than the order needs.
 * Corrects shelf truth (totalStock down), releases the hold for the missing
 * units, marks the line, and either queues a refund (pendingRefundCents — the
 * board surfaces it until executed in Stripe) or parks a backorder child
 * order that re-enters the queue when you release it after restocking.
 */
/**
 * Tell the customer, without making the picker think about it.
 *
 * Fired AFTER the transaction commits, never inside it — Firestore retries a
 * contended transaction, and a fetch in the retried body would send the same
 * apology two or three times. The route is idempotent per line as well, so
 * both ends hold that line.
 *
 * Deliberately un-awaited and never thrown: the short is already true in the
 * database. A dead network or an unconfigured mail key must not turn a
 * successful short into an error the picker has to interpret at the shelf.
 */
export function notifyCurbside(tenantId: string, orderId: string, moment: 'ready' | 'out' | 'staff_escalation'): void {
  try { effects.curbside(tenantId, orderId, moment); } catch { /* the board banner is still true */ }
}

function notifyCustomerOfShort(tenantId: string, orderId: string, lineId: string): void {
  try { effects.short(tenantId, orderId, lineId); } catch { /* best effort by design */ }
}

export async function resolveShortLine(
  fs: Firestore, tenantId: string, orderId: string, lineId: string,
  reason: string, resolution: ShortResolution, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  try {
    const shortResult = await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };
      if (order.stage !== 'picking') return { ok: false, message: 'Only picking orders can short a line.' };

      const target = order.lines.find((l) => l.lineId === lineId);
      if (!target) return { ok: false, message: 'Line not found.' };

      const iRef = invDoc(fs, tenantId, target.productId);
      const iSnap = await txn.get(iRef);

      const { lines, qtyShorted, refundCents } = shortLine(order.lines, lineId, reason, resolution);

      if (iSnap.exists()) {
        const item = iSnap.data() as any;
        txn.update(iRef, {
          ...shrinkStock(item, qtyShorted),
          stockReserved: Math.max(0, (item.stockReserved || 0) - qtyShorted),
        });
        txn.set(doc(collection(fs, `tenants/${tenantId}/stockCorrections`)),
          correction(target.productId, item.unit || 'units', -qtyShorted,
            `Shelf short during pick: ${reason} (Order #${order.orderNumber})`, orderId, actor));
      }

      // A backorder is its own order; the line it came from links to it, and the order lists it, so anyone looking at
      // either can find the other (lib/order-tags).
      const childRef = resolution === 'backorder' ? doc(orderCol(fs, tenantId)) : null;
      const linked = childRef ? lines.map((l: any) => (l.lineId === lineId ? { ...l, backorderOrderId: childRef.id } : l)) : lines;
      const orderUpdate: Record<string, unknown> = { lines: JSON.parse(JSON.stringify(linked)) };
      if (childRef) orderUpdate.backorderOrderIds = [...(Array.isArray((order as any).backorderOrderIds) ? (order as any).backorderOrderIds : []), childRef.id];
      if (resolution === 'refund') {
        // The tax paid on the missing items goes back too.
        orderUpdate.pendingRefundCents = (order.pendingRefundCents || 0) + refundCents + taxShareCents(order as any, refundCents);
      }
      txn.update(oRef, orderUpdate);
      txn.set(doc(collection(oRef, 'events')), evPayload('line_shorted', actor, {
        lineId, qtyShorted, reason, resolution,
      }));

      if (resolution === 'backorder' && childRef) {
        const child = {
          id: childRef.id, tenantId,
          orderNumber: order.orderNumber, // shares the customer-facing number
          stage: 'paid', method: order.method, priceTier: order.priceTier || 'retail', ...(order.priceTier === 'wholesale' ? { wholesaleAccountId: order.wholesaleAccountId || null, ...(order.wholesaleDiscountPct != null ? { wholesaleDiscountPct: order.wholesaleDiscountPct } : {}) } : {}),
          businessName: order.businessName || '', poNumber: order.poNumber || '',
          // Each unit keeps the price paid for it, and the order the tax figures it was paid with (lib/order-family).
          lines: [{
            ...lineFor(target, qtyShorted), lineId: `line-${nanoid(8)}`,
            // Fresh counts: what was refunded or put right on the first order's line was for those units, not these.
            qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, qtyRefunded: 0, qtyClaimed: 0, status: 'pending', shortReason: '',
          }],
          subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0, totalCents: 0,
          taxBasis: taxBasisOf(order),
          customerName: order.customerName, customerEmail: order.customerEmail,
          customerPhone: order.customerPhone || '',
          shippingAddress: order.shippingAddress || null,
          ...((order as any).method === 'delivery' && (order as any).delivery ? { delivery: followUpDelivery((order as any).delivery) } : {}),
          parentOrderId: orderId, holdUntilRestock: true,
          // Part of a replacement for a lost parcel: still one, so it isn't refunded on its own and nothing comes back
          // for it if the first parcel turns up (lib/order-family).
          ...((order as any).replacementFor === 'lost_in_transit' ? { replacementFor: 'lost_in_transit', lostParcelOrderId: (order as any).lostParcelOrderId || (order as any).parentOrderId || null } : {}),
          qrToken: order.qrToken || null, // same customer QR completes the backorder
          ...((order as any).collector?.name ? { collector: (order as any).collector } : {}), // and whoever they named collects it
          placedAt: new Date().toISOString(), paidAt: order.paidAt || new Date().toISOString(),
        };
        txn.set(childRef, JSON.parse(JSON.stringify(child)));
        txn.set(doc(collection(oRef, 'events')), evPayload('backorder_split', actor, { childOrderId: childRef.id }));
      }

      return {
        ok: true,
        message: resolution === 'refund'
          ? `Shorted ${qtyShorted}. A refund of $${(refundCents / 100).toFixed(2)} has been queued.`
          : `Shorted ${qtyShorted}. A backorder has been created and will be held until the item is restocked.`,
      };
    });

    if (shortResult.ok) notifyCustomerOfShort(tenantId, orderId, lineId);
    return shortResult;
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not short the line.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * PACKED → READY (with early-arrival auto-advance)
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Persist one PACK-verification scan (the second scan). Same event ledger
 * discipline as pick scans: mismatches recorded, phase stamped
 * 'pack_check', completion celebrated once.
 */
export async function recordPackScan(
  fs: Firestore, tenantId: string, orderId: string, scannedValue: string, actor: Actor
): Promise<ScanAnswer> {
  const found = await resolveFirst(fs, tenantId, orderId, scannedValue, true);
  const hint = found?.kind === 'line' ? found.hint : null;
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) throw new Error('Order not found.');
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };
      const { result, lines } = applyPackScan(order.lines, scannedValue, hint);
      if (!result.ok) {
        txn.set(doc(collection(oRef, 'events')),
          evPayload('scan_mismatch', actor, {
            scannedValue: scannedValue.slice(0, 80), code: result.code, phase: 'pack_check',
          }));
        const message = result.code === 'unknown_sku' && found ? scanMissMessage(found, scannedValue, order.lines as any) : result.message;
        return { ok: false, message, miss: result.code === 'unknown_sku' ? (found?.kind || 'unknown') : undefined };
      }
      txn.update(oRef, { lines: JSON.parse(JSON.stringify(lines)) });
      txn.set(doc(collection(oRef, 'events')), evPayload('item_scanned', actor, {
        lineId: result.lineId, qtyScanned: result.qtyScanned, qtyOrdered: result.qtyOrdered,
        phase: 'pack_check',
      }));
      if (result.pickComplete) {
        txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, { text: 'Pack check complete \u2014 every unit verified into the box' }));
      }
      return { ok: true, message: `Pack check ${result.qtyScanned}/${result.qtyOrdered}`, packComplete: result.pickComplete, lineId: result.lineId, name: result.name };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not record the pack scan.' };
  }
}

export async function markPacked(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor,
  opts?: { requirePackScan?: boolean; requireScan?: boolean; bags?: number; spotEvery?: number; roll?: number }
): Promise<{ ok: boolean; message: string; spotCheck?: boolean }> {
  let picked = false;
  try {
    const batchId = await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) throw new Error('Order not found.');
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };

      const guard = canAdvance(order, 'packed');
      if (!guard.ok) throw new Error(guard.reason);

      // SECOND-SCAN GATE (merchant setting). Only for orders whose pick
      // scan happened at the shelf — a wave order's single scan already
      // happens AT the bench (phase 'pack'), so demanding another pass
      // would be labor without information.
      if (opts?.requirePackScan && !(order as any).waveId && !isPackComplete(order.lines)) {
        throw new Error('Pack check required \u2014 scan every item again as it goes into the box.');
      }
      // EVERY ITEM SCANNED (lib/scan-rule): a unit ticked by hand (before the shop scanned every item) is scanned to
      // confirm it before the order is finished, whatever screen finishes it.
      const ticked = opts?.requireScan ? tappedLines(order.lines) : [];
      if (ticked.length) {
        const units = ticked.reduce((a, l) => a + lineCounts(l).tapped, 0);
        throw new Error(`${ticked.length === 1 ? ticked[0].name : `${ticked.length} items`} ${units === 1 ? 'was' : 'were'} ticked by hand, not scanned. Scan ${units === 1 ? 'it' : 'each one'} to confirm, then finish.`);
      }

      // How many bags it went into (lib/bag-tag): each gets a tag, and each is scanned at handover.
      const bagCount = goesInBags(order) ? clampBags(opts?.bags ?? (order as any).bagCount ?? 1) : null;
      // A SPOT CHECK (lib/spot-check): 1 in so many orders, picked as it's packed, is scanned again by someone else before
      // it goes any further.
      picked = pickForSpot(order, Number(opts?.spotEvery) || 0, Number.isFinite(opts?.roll) ? Number(opts?.roll) : Math.random());
      const now = new Date().toISOString();
      txn.update(oRef, { stage: 'packed', packedAt: now, ...(bagCount ? { bagCount } : {}),
        ...(picked ? { spotCheck: { due: true, pickedAt: now, packedById: actor.id, packedByName: actor.name, counts: {}, missing: {}, wrong: 0 } } : {}) });
      txn.set(doc(collection(oRef, 'events')), evPayload('packed', actor, bagCount && bagCount > 1 ? { bags: bagCount } : undefined));
      if (picked) txn.set(doc(collection(oRef, 'events')), evPayload('spot_check', actor, { result: 'picked', packedById: actor.id, packedBy: actor.name }));
      return order.batchId || null;
    });

    // Close the batch when every order in it has moved past picking.
    if (batchId) {
      const bRef = doc(batchCol(fs, tenantId), batchId);
      await runTransaction(fs, async (txn) => {
        const bSnap = await txn.get(bRef);
        if (!bSnap.exists() || bSnap.data().active !== true) return;
        const b = bSnap.data() as FulfillmentBatch;
        const snaps = await Promise.all(b.orderIds.map((id) => txn.get(doc(orderCol(fs, tenantId), id))));
        const anyStillPicking = snaps.some((s) => s.exists() && (s.data() as RetailOrder).stage === 'picking');
        if (!anyStillPicking) {
          txn.update(bRef, { active: false, completedAt: new Date().toISOString(), releaseType: 'completed' });
        }
      });
    }
    return { ok: true, message: picked ? 'Packed. Picked for a spot check: someone else scans it before it goes out.' : 'Packed', ...(picked ? { spotCheck: true } : {}) };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not mark packed.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * SPOT CHECKS — a second person scans a packed order again (lib/spot-check)
 * ════════════════════════════════════════════════════════════════════════════
 * Someone other than its packer scans every unit. A wrong or extra item is taken out and counted as a mistake; an item
 * that was missing is marked missing, put in and scanned. Once every unit is counted it's done: passed, or fixed with
 * its mistakes kept on the order (and counted for its packer on How it's going). A manager's PIN can let it go unchecked.
 */
type SpotAnswer = { ok: boolean; message: string; left?: number; lineId?: string; mistake?: boolean };
const spotGate = (order: any, actor: Actor): string | null => {
  if (!spotDue(order)) return 'This order isn’t waiting for a spot check.';
  if (order.stage !== 'packed') return `This order is ${STAGE_LABELS[order.stage as keyof typeof STAGE_LABELS] || order.stage}.`;
  if (String(order.spotCheck?.packedById || '') === actor.id) return 'Someone other than its packer checks it. Ask a teammate, or a manager can let it go with their PIN.';
  return null;
};

export async function recordSpotScan(fs: Firestore, tenantId: string, orderId: string, scannedValue: string, actor: Actor): Promise<SpotAnswer> {
  const found = await resolveFirst(fs, tenantId, orderId, scannedValue, false);
  const hint = found?.kind === 'line' ? found.hint : null;
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order: any = { ...(oSnap.data() as RetailOrder), id: orderId };
      const bad = spotGate(order, actor); if (bad) return { ok: false, message: bad };
      const lines = spotLines(order);
      const match = (order.lines || []).find((l: any) => (hint?.lineId ? l.lineId === hint.lineId : lineMatchesScan(l, scannedValue)) && lines.some((x) => x.lineId === l.lineId));
      const sc = order.spotCheck || {};
      const code = scannedValue.trim().slice(0, 80); const nowMs = Date.now();
      const wrong = (message: string): SpotAnswer => {
        // The same wrong item read twice in a row (a scanner's double read) is one mistake.
        if (sc.lastWrong?.code === code && nowMs - (Date.parse(String(sc.lastWrong?.at || '')) || 0) < 4000) return { ok: false, message: 'Already counted. Take it out of the bag.' };
        txn.update(oRef, { 'spotCheck.wrong': (Number(sc.wrong) || 0) + 1, 'spotCheck.lastWrong': { code, at: new Date(nowMs).toISOString() } } as any);
        txn.set(doc(collection(oRef, 'events')), evPayload('scan_mismatch', actor, { scannedValue: scannedValue.slice(0, 80), code: 'spot_check', phase: 'spot' }));
        return { ok: false, mistake: true, left: spotLines({ ...order }).reduce((a, l) => a + Math.max(0, l.need - l.got), 0), message };
      };
      if (!match) return wrong('That isn’t on this order. Take it out of the bag: it’s counted as a mistake.');
      const row = lines.find((x) => x.lineId === match.lineId)!;
      if (row.got >= row.need) return wrong(`That’s one more ${row.name} than the order has. Take it out: it’s counted as a mistake.`);
      txn.update(oRef, { [`spotCheck.counts.${match.lineId}`]: row.got + 1 } as any);
      const left = lines.reduce((a, l) => a + Math.max(0, l.need - l.got), 0) - 1;
      return { ok: true, lineId: match.lineId, left, message: left > 0 ? `${row.name}. ${left} more to scan.` : 'Every item scanned. Finish the check.' };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'That scan didn’t go through.' };
  }
}

/** An item that wasn't in the bag: a mistake kept for its packer. It's put in, then scanned like the rest. */
export async function markSpotMissing(fs: Firestore, tenantId: string, orderId: string, lineId: string, actor: Actor): Promise<SpotAnswer> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order: any = { ...(oSnap.data() as RetailOrder), id: orderId };
      const bad = spotGate(order, actor); if (bad) return { ok: false, message: bad };
      const row = spotLines(order).find((x) => x.lineId === lineId);
      if (!row) return { ok: false, message: 'That item isn’t on this order.' };
      if (row.got + row.missing >= row.need) return { ok: false, message: `Every ${row.name} is already counted.` };
      txn.update(oRef, { [`spotCheck.missing.${lineId}`]: row.missing + 1 } as any);
      return { ok: true, mistake: true, lineId, message: `Counted as missing. Put one in, then scan it.` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'That didn’t go through.' };
  }
}

/** Done: every unit scanned (or let go on a manager's PIN). The order can go on: to the shelf, the van or its label. */
export async function finishSpotCheck(fs: Firestore, tenantId: string, orderId: string, actor: Actor, approvedBy?: { id: string; name: string } | null): Promise<SpotAnswer & { result?: string; method?: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order: any = { ...(oSnap.data() as RetailOrder), id: orderId };
      if (approvedBy && String(order.spotCheck?.packedById || '') === approvedBy.id) return { ok: false, message: 'The person who packed it can’t let it go unchecked. Ask another manager.' };
      const bad = approvedBy ? (!spotDue(order) ? 'This order isn’t waiting for a spot check.' : order.stage !== 'packed' ? 'This order has moved on.' : null) : spotGate(order, actor);
      if (bad) return { ok: false, message: bad };
      const left = spotLines(order).reduce((a, l) => a + Math.max(0, l.need - l.got), 0);
      if (left > 0 && !approvedBy) return { ok: false, left, message: `${left} more to scan. One that isn’t there: mark it missing, put it in and scan it.` };
      const m = spotMistakes(order);
      // Nothing left in it to check (every item refunded or sent later since it was packed): closed, not counted as a check.
      const result = !spotLines(order).length ? 'empty' : approvedBy && left > 0 ? 'skipped' : m.wrong + m.missing > 0 ? 'fixed' : 'passed';
      const now = new Date().toISOString();
      txn.update(oRef, { 'spotCheck.due': false, 'spotCheck.doneAt': now, 'spotCheck.byId': actor.id, 'spotCheck.byName': actor.name, 'spotCheck.result': result,
        ...(approvedBy ? { 'spotCheck.approvedById': approvedBy.id, 'spotCheck.approvedBy': approvedBy.name } : {}) } as any);
      txn.set(doc(collection(oRef, 'events')), evPayload('spot_check', actor, clean({ result, wrong: m.wrong, missing: m.missing, packedById: String(order.spotCheck?.packedById || ''), packedBy: String(order.spotCheck?.packedByName || ''), ...(approvedBy ? { approvedBy: approvedBy.name, approvedById: approvedBy.id } : {}) }) as any));
      return { ok: true, result, method: String(order.method || ''), message: result === 'empty' ? 'Nothing left in it to check, so the check is closed.' : result === 'passed' ? 'Spot check passed.' : result === 'fixed' ? `Fixed: ${[m.wrong ? `${m.wrong} wrong or extra` : '', m.missing ? `${m.missing} missing` : ''].filter(Boolean).join(' and ')}. It’s kept on the order.` : 'Let go without the check, on a manager’s PIN.' };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'That didn’t go through.' };
  }
}

export async function markReady(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor
): Promise<{ ok: boolean; message: string; autoArrived?: boolean }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };

      const guard = canAdvance(order, 'ready');
      if (!guard.ok) return { ok: false, message: guard.reason };

      const now = new Date().toISOString();
      const customerWaiting = order.method === 'curbside' && !!order.curbside?.arrivedAt;

      txn.update(oRef, { stage: customerWaiting ? 'arrived' : 'ready', readyAt: now });
      txn.set(doc(collection(oRef, 'events')), evPayload('marked_ready', actor, order.method === 'delivery' ? { forDelivery: true } : undefined));
      if (customerWaiting) {
        txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, {
          text: 'Customer arrived early — auto-advanced to Arrived',
        }));
      }
      return {
        ok: true, autoArrived: customerWaiting,
        message: customerWaiting ? 'The customer is already waiting outside. Please bring the order out now.' : order.method === 'delivery' ? 'The order is on the ready shelf, waiting for its driver.' : 'The order is on the ready shelf.',
        // Text a curbside customer who is NOT already outside: they may still
        // be at home, and "it's ready" is the message that starts the trip.
        notifyReady: order.method === 'curbside' && !customerWaiting,
      };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not mark ready.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * HANDOFF & SHIP — the sale conversion (FIFO depletion happens HERE)
 * ════════════════════════════════════════════════════════════════════════════ */

function convertSaleInTxn(
  txn: any, fs: Firestore, tenantId: string,
  order: RetailOrder & { id: string }, itemSnaps: { ref: any; snap: any }[], actor: Actor
) {
  // Which lots went out on each line, so a recall can find every customer who got one.
  const saleLots: Record<string, { lot: string; expirationDate: string; qty: number }[]> = {};
  const lotKeys: string[] = [];
  order.lines.forEach((line, i) => {
    const qty = fulfilledQty(line);
    const { snap, ref } = itemSnaps[i];
    // Digital lines have no shelf stock to move.
    if (qty <= 0 || !snap.exists() || (line as any).digital === true) return;
    const item = snap.data() as any;
    // Pre-order lines were never held in stockReserved (they count against the pre-order run), so only the shelf moves.
    const heldQty = (line as any).preorder === true ? 0 : qty;
    const { batches, taken } = depleteBatchesFIFO(item.batches as InventoryBatchRef[], qty);
    const withLot = taken.filter((t) => t.lot || t.expirationDate).map(({ lot, expirationDate, qty: q }) => ({ lot, expirationDate, qty: q }));
    if (withLot.length) { saleLots[line.lineId] = withLot; withLot.forEach((t) => { if (t.lot) lotKeys.push(`${line.productId}|${t.lot}`); }); }
    const newTotal = batches.reduce((a, b) => a + b.stock, 0);
    txn.update(ref, {
      batches: JSON.parse(JSON.stringify(batches)),
      totalStock: newTotal,
      stockReserved: Math.max(0, (item.stockReserved || 0) - heldQty),
    });
    txn.set(doc(collection(fs, `tenants/${tenantId}/stockCorrections`)),
      correction(line.productId, item.unit || 'units', -qty,
        `Online order fulfilled (Order #${order.orderNumber})`, order.id, actor));
    txn.set(doc(collection(fs, `tenants/${tenantId}/stockCorrections`)), buildEntry({
      productId: line.productId,
      type: 'released',
      field: 'stockReserved',
      delta: -heldQty,
      unit: item.unit || 'units',
      reason: `Hold released \u2014 order fulfilled (Order #${order.orderNumber})`,
      actorId: actor.id,
      actorName: actor.name,
      ref: { kind: 'order', id: order.id },
      balanceAfter: Math.max(0, (item.stockReserved || 0) - heldQty),
    }));
  });
  if (Object.keys(saleLots).length) txn.update(doc(orderCol(fs, tenantId), order.id), { saleLots, lotKeys: [...new Set(lotKeys)] });
}

async function readOrderItems(txn: any, fs: Firestore, tenantId: string, order: RetailOrder) {
  return Promise.all(order.lines.map(async (l) => {
    const ref = invDoc(fs, tenantId, l.productId);
    return { ref, snap: await txn.get(ref) };
  }));
}

/**
 * "We're bringing it out."
 *
 * The missing half of a conversation. The customer told us they arrived and
 * then heard nothing — so they wonder whether the tap worked, whether anyone
 * saw it, whether to go inside. One tap here closes that loop, and it is
 * deliberately NOT a stage change: nothing has been handed over yet, so the
 * order must stay exactly where it is on the board. It records who set off
 * and when, which is also the number that tells you later how long the walk
 * really takes.
 *
 * Idempotent: tapping twice tells the customer once.
 */
export async function markBringingOut(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor, actorPhotoUrl?: string
): Promise<{ ok: boolean; message: string; notify?: { phone: string; orderNumber: number; spot: string } }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = oSnap.data() as RetailOrder;
      if ((order as any).method === 'delivery') return { ok: false, message: 'This is a delivery. Send it out from its Delivery tab.' };
      if (!['ready', 'arrived'].includes(String(order.stage))) {
        return { ok: false, message: 'This order is not waiting to go out.' };
      }
      if ((order.curbside as any)?.bringingOutAt) {
        return { ok: true, message: 'The customer has already been told someone is on the way.' };
      }
      txn.update(oRef, {
        curbside: {
          ...(order.curbside || {}),
          bringingOutAt: new Date().toISOString(),
          bringingOutBy: actor.name || 'Staff',
          bringingOutPhoto: actorPhotoUrl || null,
        },
      });
      txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, {
        text: 'Heading out to the customer',
      }));
      return {
        ok: true,
        message: 'The customer has been told you are on the way out.',
        notify: {
          phone: order.customerPhone || '',
          orderNumber: order.orderNumber,
          spot: (order.curbside as any)?.spotOrVehicle || '',
        },
      };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not send that.' };
  }
}

/** The handoff, in one step with the order: stock out of the shelf, the order completed, and who handed it over, who
 *  collected it and how it was checked recorded on the order and its history (lib/pickup-pass). */
function completeHandoff(txn: any, fs: Firestore, tenantId: string, oRef: any, order: RetailOrder & { id: string }, itemSnaps: any[], actor: Actor, method: HandoffMethod, check?: string, bags = 0, bagApproval?: { id: string; name: string } | null) {
  convertSaleInTxn(txn, fs, tenantId, order, itemSnaps, actor);
  const handoff = { ...handoffRecord(order, actor, method, check), ...(bags ? { bagsScanned: bags } : {}) };
  txn.update(oRef, clean({ stage: 'completed', completedAt: handoff.at, handoff }));
  const meta = clean({ method, collectedBy: handoff.collectedBy, ...(handoff.collectedBy === 'someone_else' ? { collectorName: handoff.collectorName || '' } : {}), ...(bags ? { bagsScanned: bags } : {}) }) as any;
  // Bags handed over without every tag scanned, on a manager's PIN (lib/bag-tag): kept with who approved it.
  if (bagApproval) txn.set(doc(collection(oRef, 'events')), evPayload('override', actor, { rule: 'bags_approved', approvedBy: String(bagApproval.name || '').slice(0, 60), approvedById: String(bagApproval.id || '').slice(0, 160), bags: Number((order as any).bagCount) || 0 }));
  if (method === 'checked') txn.set(doc(collection(oRef, 'events')), evPayload('override', actor, { rule: 'handoff_without_scan', reason: `Identity verified: ${check || 'checked'}`.slice(0, 140), ...meta }));
  else txn.set(doc(collection(oRef, 'events')), evPayload('handoff_scanned', actor, meta));
  txn.set(doc(collection(oRef, 'events')), evPayload('completed', actor, meta));
  return handoff;
}

/** EVERY BAG SCANNED (lib/bag-tag): while the shop scans bags at handover, an order finished in bags is handed over only
 *  once each of its bags' tags was scanned (signed codes, checked here). Checked before the customer's code, so a missing
 *  bag never costs them a try at it. Null when it's fine; otherwise what's still to scan. */
export type BagOpts = { bags?: string[]; requireBags?: boolean; bagApprovedBy?: { id: string; name: string } | null };
function missingBags(tenantId: string, order: any, orderId: string, opts: BagOpts, need = opts.requireBags ? bagsToScan(order, {}) : 0): { need: number; message: string } | null {
  if (!need || opts.bagApprovedBy) return null;
  const got = new Set((Array.isArray(opts.bags) ? opts.bags : []).slice(0, 40).map((c) => checkBagCode(tenantId, orderId, String(c))).filter((n): n is number => n !== null && n <= need));
  const left = Array.from({ length: need }, (_, i) => i + 1).filter((n) => !got.has(n));
  if (!left.length) return null;
  return { need, message: need === 1 ? 'Scan the bag first.' : left.length === need ? `Scan all ${need} bags first.` : `Scan every bag first: bag ${left.join(', ')} of ${need} still to scan.` };
}
const bagsDone = (order: any, opts: BagOpts) => (opts.requireBags && !opts.bagApprovedBy ? bagsToScan(order, {}) : 0);
const bagApproval = (order: any, opts: BagOpts) => (opts.requireBags && opts.bagApprovedBy && bagsToScan(order, {}) ? opts.bagApprovedBy : null);

/** Handed over by the QR code on their phone. The parts of an order split for a back-ordered item share its code: the
 *  part this screen has open, or else the one part that's ready, is the one handed over. */
export async function handoffByScan(
  fs: Firestore, tenantId: string, scannedValue: string, actor: Actor, opts: { orderId?: string } & BagOpts = {}
): Promise<{ ok: boolean; message: string; orderNumber?: number; orderId?: string; collector?: string | null; needBags?: boolean }> {
  // A bag's tag is never the customer's code (lib/bag-tag): scanning the bag alone hands nothing over.
  if (parseBagCode(scannedValue)) return { ok: false, message: 'That’s a bag tag. Now scan the code on their phone.' };
  const token = parseOrderQr(scannedValue) ?? scannedValue.trim();
  const match = await getDocs(query(orderCol(fs, tenantId), where('qrToken', '==', token), limit(10)));
  if (match.empty) return { ok: false, message: 'Not a valid pickup code for this shop.' };
  const parts = match.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const waiting = parts.filter((o: any) => ['ready', 'arrived'].includes(String(o.stage)));
  let orderId = '';
  if (opts.orderId) {
    if (!parts.some((o: any) => o.id === opts.orderId)) return { ok: false, message: 'That code is for a different order. Check the name on their phone.' };
    orderId = opts.orderId;
  } else if (waiting.length === 1) orderId = waiting[0].id;
  else if (waiting.length > 1) return { ok: false, message: `This code is for ${waiting.length} parts of an order that are ready. Open the order to hand over each part.` };
  else orderId = parts[0].id;
  try {
    const done: any = await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };

      if ((order as any).method === 'delivery') return { ok: false, message: `Order #${order.orderNumber} is a delivery. Mark it delivered from its Delivery tab.` };
      if (!['ready', 'arrived'].includes(order.stage) || !canAdvance(order, 'completed').ok) {
        return {
          ok: false,
          message: `Order #${order.orderNumber} is ${STAGE_LABELS[order.stage]}, so it cannot be handed off yet.`,
        };
      }
      const miss = missingBags(tenantId, order, orderId, opts);
      if (miss) return { ok: false, needBags: true, message: miss.message };

      const itemSnaps = await readOrderItems(txn, fs, tenantId, order);
      const h = completeHandoff(txn, fs, tenantId, oRef, order, itemSnaps, actor, 'qr', undefined, bagsDone(order, opts), bagApproval(order, opts));
      return { ok: true, message: `Order #${order.orderNumber} — ${order.customerName}`, orderNumber: order.orderNumber, orderId, order, collector: h.collectedBy === 'someone_else' ? h.collectorName : null };
    });
    // Renters' shares of what just went out go onto their rent accounts (lib/renter-sales).
    if (done?.ok && done.order) { syncRenterCredits(tenantId, done.order); shareOrderTipSoon(tenantId, done.order); }
    if (done && typeof done === 'object') delete done.order;
    return done;
  } catch (e: any) {
    return { ok: false, message: e?.message || 'The handoff did not go through. Please try again.' };
  }
}

/** Handed over by the 4-digit code the person says (lib/pickup-pass). A wrong code counts a try; after a few in a row
 *  the code stops working for this order, and the QR code or a check of their name and phone is the way. */
export async function handoffByPin(
  fs: Firestore, tenantId: string, orderId: string, said: string, actor: Actor, opts: BagOpts = {}
): Promise<{ ok: boolean; message: string; orderNumber?: number; orderId?: string; collector?: string | null; locked?: boolean; needBags?: boolean }> {
  try {
    const done: any = await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = { ...(oSnap.data() as RetailOrder), id: orderId } as any;
      if (order.method === 'delivery') return { ok: false, message: `Order #${order.orderNumber} is a delivery. Mark it delivered from its Delivery tab.` };
      if (!['ready', 'arrived'].includes(order.stage) || !canAdvance(order, 'completed').ok) {
        return { ok: false, message: `Order #${order.orderNumber} is ${STAGE_LABELS[order.stage as keyof typeof STAGE_LABELS]}, so it cannot be handed off yet.` };
      }
      const miss = missingBags(tenantId, order, orderId, opts);
      if (miss) return { ok: false, needBags: true, message: miss.message };
      const tries = Math.max(0, Number(order.pinTries) || 0);
      if (tries >= PIN_TRIES) return { ok: false, locked: true, message: 'The code was wrong too many times, so it no longer works for this order. Scan the QR code on their phone, or check their name and phone.' };
      if (!pinMatches(tenantId, pinKeyOf(order, orderId), said)) {
        txn.update(oRef, { pinTries: tries + 1 });
        const left = PIN_TRIES - tries - 1;
        if (left <= 0) txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, { text: 'Pickup code wrong too many times; it no longer works for this order' }));
        return { ok: false, locked: left <= 0, message: left > 0 ? `That code doesn’t match order #${order.orderNumber}. Ask them to check their order page.` : 'That code doesn’t match, and it no longer works for this order. Scan the QR code on their phone, or check their name and phone.' };
      }
      const itemSnaps = await readOrderItems(txn, fs, tenantId, order);
      const h = completeHandoff(txn, fs, tenantId, oRef, order, itemSnaps, actor, 'pin', undefined, bagsDone(order, opts), bagApproval(order, opts));
      return { ok: true, message: `Order #${order.orderNumber} — ${order.customerName}`, orderNumber: order.orderNumber, orderId, order, collector: h.collectedBy === 'someone_else' ? h.collectorName : null };
    });
    if (done?.ok && done.order) { syncRenterCredits(tenantId, done.order); shareOrderTipSoon(tenantId, done.order); }
    if (done && typeof done === 'object') delete done.order;
    return done;
  } catch (e: any) {
    return { ok: false, message: e?.message || 'The handoff did not go through. Please try again.' };
  }
}

/** Lost-phone fallback. Same conversion, but logged as an override. */
export async function handoffWithoutScan(
  fs: Firestore, tenantId: string, orderId: string, verifiedBy: string, actor: Actor, opts: BagOpts = {}
): Promise<{ ok: boolean; message: string; needBags?: boolean }> {
  try {
    const done: any = await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };
      if ((order as any).method === 'delivery') return { ok: false, message: `Order #${order.orderNumber} is a delivery. Mark it delivered from its Delivery tab.` };
      if (!['ready', 'arrived'].includes(order.stage) || !canAdvance(order, 'completed').ok) {
        return { ok: false, message: `This order is ${STAGE_LABELS[order.stage]} and is not ready for handoff.` };
      }
      const miss = missingBags(tenantId, order, orderId, opts);
      if (miss) return { ok: false, needBags: true, message: miss.message };

      const itemSnaps = await readOrderItems(txn, fs, tenantId, order);
      const h = completeHandoff(txn, fs, tenantId, oRef, order, itemSnaps, actor, 'checked', verifiedBy, bagsDone(order, opts), bagApproval(order, opts));
      return { ok: true, message: `Order #${order.orderNumber} handed off (no scan — logged)`, order, collector: h.collectedBy === 'someone_else' ? h.collectorName : null };
    });
    // Renters' shares of what just went out go onto their rent accounts (lib/renter-sales).
    if (done?.ok && done.order) { syncRenterCredits(tenantId, done.order); shareOrderTipSoon(tenantId, done.order); }
    if (done && typeof done === 'object') delete done.order;
    return done;
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Handoff failed.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * PUT AWAY — the bags scanned onto their spot on the ready shelf (lib/bag-tag)
 * ════════════════════════════════════════════════════════════════════════════
 * An order finished in bags waits on the ready shelf, for its customer or its driver. Putting it away is scanning each
 * of its bags (their signed codes, checked here) and then the spot's label, so the shelf says where every bag is and a
 * bag on the wrong spot is caught as it's put there (Walmart's pickup shelf works this way). There's no skipping it with a
 * PIN: a tag that won't scan is reprinted. Done again, it moves the order to the new spot.
 */
export async function recordPutAway(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor, opts: { bags?: string[]; spot?: string },
): Promise<{ ok: boolean; message: string; needBags?: boolean; spot?: string }> {
  const spot = parseSpot(String(opts.spot || ''));
  if (!spot) return { ok: false, message: 'Scan the label on the shelf spot.' };
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order: any = { ...(oSnap.data() as RetailOrder), id: orderId };
      if (!['ready', 'arrived'].includes(String(order.stage))) return { ok: false, message: order.stage === 'completed' ? 'This order has been handed over.' : `This order is ${STAGE_LABELS[order.stage as keyof typeof STAGE_LABELS] || order.stage}, not on the ready shelf.` };
      if (order.method === 'delivery' && order.delivery?.status === 'out') return { ok: false, message: 'This order is out for delivery.' };
      const need = bagsToShelve(order, {});
      if (!need) return { ok: false, message: 'This order’s bags have no tags to scan. Put it on the shelf as it is.' };
      const miss = missingBags(tenantId, order, orderId, { bags: opts.bags, requireBags: true }, need);
      if (miss) return { ok: false, needBags: true, message: miss.message };
      const now = new Date().toISOString();
      txn.update(oRef, clean({ shelfSlot: spot, putAway: { at: now, byId: actor.id, byName: actor.name, spot, bags: need } }) as any);
      txn.set(doc(collection(oRef, 'events')), evPayload('put_away', actor, { shelf: spot, bags: need }));
      return { ok: true, spot, message: `#${String(order.orderNumber ?? '').padStart(4, '0')} is on shelf ${spot}.` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not put it away.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * LOCAL DELIVERY — out with a driver, delivered, or brought back (lib/delivery-plan)
 * ════════════════════════════════════════════════════════════════════════════
 * A delivery order is picked and packed like any other, then waits on the ready shelf for its driver. Going out
 * isn't a stage change (it's still the shop's until it's delivered, and can't be canceled while it's out); delivering
 * it is the sale, as handing over is for pickup. One brought back waits on the shelf again for another try.
 */

/** The bags still to scan into the van for this delivery, in words; null when it can go (checked again in the step). */
export function vanBagsMissing(tenantId: string, order: any, orderId: string, opts: BagOpts): string | null {
  const miss = missingBags(tenantId, order, orderId, opts, opts.requireBags ? bagsToLoad(order, {}) : 0);
  return miss ? miss.message.replace(' first', ' into the van first') : null;
}

export async function markOutForDelivery(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor, opts: BagOpts = {},
): Promise<{ ok: boolean; message: string; tries?: number; needBags?: boolean }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order: any = { ...(oSnap.data() as RetailOrder), id: orderId };
      if (order.method !== 'delivery') return { ok: false, message: 'Only a delivery order goes out for delivery.' };
      const st = String(order.delivery?.status || 'waiting');
      if (st === 'out') return { ok: true, message: `Already out with ${order.delivery?.driverName || 'a driver'}.` };
      if (st === 'delivered' || order.stage === 'completed') return { ok: false, message: 'This order has been delivered.' };
      // The customer is paying for another try right now (lib/delivery-retry-server), so they don't pay for a try that's
      // already happening. The server closes a page left open for a few minutes before it gets here (api/retail/fulfil).
      const rp = order.delivery?.retryPay;
      if (rp?.status === 'awaiting_payment' && Date.now() - (Date.parse(String(rp.at || '')) || 0) < 35 * 60000) {
        return { ok: false, message: `${String(order.customerName || 'The customer').split(' ')[0]} is paying for another try right now. Give it a few minutes, then send it out.` };
      }
      // Packed and not yet on the shelf counts as ready: it's going straight out the door.
      if (order.stage === 'packed') {
        const g = canAdvance(order, 'ready'); if (!g.ok) return { ok: false, message: g.reason };
      } else if (order.stage !== 'ready') return { ok: false, message: `This order is ${STAGE_LABELS[order.stage as keyof typeof STAGE_LABELS] || order.stage}. Pack it first.` };
      // Every bag scanned into the van (lib/bag-tag), each time it goes out: a bag left on the shelf is caught here, not
      // at the customer's door. A tag that won't scan goes out on the PIN of someone the shop lets approve.
      const load = opts.requireBags ? bagsToLoad(order, {}) : 0;
      const miss = vanBagsMissing(tenantId, order, orderId, opts);
      if (miss) return { ok: false, needBags: true, message: miss };
      const loaded = load && !opts.bagApprovedBy ? load : 0;
      const now = new Date().toISOString();
      const tries = (Number(order.delivery?.tries) || 0) + 1;
      txn.update(oRef, clean({
        ...(order.stage === 'packed' ? { stage: 'ready', readyAt: now } : {}),
        'delivery.status': 'out', 'delivery.outAt': now, 'delivery.driverId': actor.id, 'delivery.driverName': actor.name, 'delivery.tries': tries,
        // Each try starts fresh: no wait at the door, no stop skipped for later.
        'delivery.doorAt': null, 'delivery.doorCode': null, 'delivery.skippedAt': null,
        'delivery.bagsLoaded': loaded || null,
        // Off the shelf: brought back, it's put away again.
        putAway: null,
      }) as any);
      if (order.stage === 'packed') txn.set(doc(collection(oRef, 'events')), evPayload('marked_ready', actor, { forDelivery: true }));
      if (load && opts.bagApprovedBy) txn.set(doc(collection(oRef, 'events')), evPayload('override', actor, { rule: 'bags_approved', at: 'van', approvedBy: String(opts.bagApprovedBy.name || '').slice(0, 60), approvedById: String(opts.bagApprovedBy.id || '').slice(0, 160), bags: load }));
      txn.set(doc(collection(oRef, 'events')), evPayload('out_for_delivery', actor, { driver: actor.name, ...(tries > 1 ? { attempt: tries } : {}), ...(loaded ? { bags: loaded } : {}) }));
      return { ok: true, tries, message: tries > 1 ? `Out again with ${actor.name.split(' ')[0]}.` : `Out for delivery with ${actor.name.split(' ')[0]}.` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not mark it out for delivery.' };
  }
}

/** What the driver brings to "Delivered": the photo they took, whether it was left rather than handed over (and where),
 *  the customer's delivery code, and (back office only) a manager marking it without the proof the shop asks for. */
export type DeliveredProof = { photoUrl?: string | null; left?: boolean; where?: string; pin?: string; override?: boolean; manager?: boolean };

/** Only the person who has a delivery (or a manager) marks how it went. */
const notTheDriver = (order: any) => `This delivery is with ${String(order.delivery?.driverName || 'another driver').split(' ')[0]}. They mark how it went, or a manager can.`;

/**
 * A photo the server stored for this order's delivery (api/retail/delivery-photo), never a link from elsewhere: the
 * storage service's own address, and the object filed under this shop's delivery photos for this order.
 */
export function deliveryPhotoOk(tenantId: string, orderId: string, url: unknown): boolean {
  if (typeof url !== 'string' || url.length > 1200) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'firebasestorage.googleapis.com' || u.username || u.password || u.port) return false;
    const m = /^\/v0\/b\/[^/]+\/o\/([^/]+)$/.exec(u.pathname);
    if (!m) return false;
    const object = decodeURIComponent(m[1]);
    const dir = `tenants/${tenantId}/delivery-photos/${orderId}/`;
    return object.startsWith(dir) && /^[A-Za-z0-9._-]{1,120}$/.test(object.slice(dir.length));
  } catch { return false; }
}

export async function markDelivered(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor, proof: DeliveredProof = {},
): Promise<{ ok: boolean; message: string; needs?: 'photo' | 'pin'; locked?: boolean }> {
  try {
    const done: any = await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order: any = { ...(oSnap.data() as RetailOrder), id: orderId };
      if (order.method !== 'delivery') return { ok: false, message: 'Only a delivery order is delivered.' };
      if (order.stage === 'completed') return { ok: true, message: 'Already delivered.' };
      if (order.delivery?.status !== 'out') return { ok: false, message: 'Mark it out for delivery first.' };
      if (proof.manager !== true && String(order.delivery?.driverId || '') !== actor.id) return { ok: false, message: notTheDriver(order) };
      if (order.stage !== 'ready' || !canAdvance(order, 'completed').ok) return { ok: false, message: `This order is ${STAGE_LABELS[order.stage as keyof typeof STAGE_LABELS] || order.stage}, so it can’t be marked delivered.` };
      // The proof the shop asks for at the door (lib/delivery-run): a manager can mark it without, and it says so.
      const tSnap = await txn.get(doc(fs, `tenants/${tenantId}`));
      const plan = deliveryFrom(((tSnap.exists() ? tSnap.data() : {}) as any)?.retailSettings);
      const left = proof.left === true;
      const need = proofNeeded(order, plan, left);
      // Only a photo the photo route stored for this order (kept on it, server-only), never a link typed in.
      const issued: string[] = Array.isArray(order.delivery?.photos) ? order.delivery.photos : [];
      const photo = deliveryPhotoOk(tenantId, orderId, proof.photoUrl) && issued.includes(String(proof.photoUrl)) ? String(proof.photoUrl) : null;
      const skip = proof.override === true;
      if (need.photo && !photo && !skip) return { ok: false, needs: 'photo', message: left ? 'Take a photo of where you left it first.' : 'Take a photo of the delivery first.' };
      let pinOk = false;
      if (need.pin && !skip) {
        const tries = Math.max(0, Number(order.pinTries) || 0);
        if (tries >= PIN_TRIES) return { ok: false, locked: true, message: 'The code was wrong too many times, so it no longer works. Ask the shop to mark it delivered.' };
        const said = String(proof.pin || '').replace(/\D/g, '').slice(0, 12);
        if (!said) return { ok: false, needs: 'pin', message: 'Ask them for the delivery code on their order page.' };
        if (!pinMatches(tenantId, pinKeyOf(order, orderId), said)) {
          txn.update(oRef, { pinTries: tries + 1 });
          const leftTries = PIN_TRIES - tries - 1;
          if (leftTries <= 0) txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, { text: 'Delivery code wrong too many times; it no longer works for this order' }));
          return { ok: false, needs: 'pin', locked: leftTries <= 0, message: leftTries > 0 ? 'That code doesn’t match. Ask them to check their order page.' : 'That code doesn’t match, and it no longer works. Ask the shop to mark it delivered.' };
        }
        pinOk = true;
      }
      const itemSnaps = await readOrderItems(txn, fs, tenantId, order);
      convertSaleInTxn(txn, fs, tenantId, order, itemSnaps, actor);
      const now = new Date().toISOString();
      const where = String(proof.where || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      txn.update(oRef, clean({
        stage: 'completed', completedAt: now, deliveredAt: now, 'delivery.status': 'delivered', 'delivery.deliveredAt': now, 'delivery.deliveredById': actor.id, 'delivery.deliveredByName': actor.name,
        'delivery.handedTo': left ? 'left' : 'customer', 'delivery.leftWhere': left ? (where || String(order.delivery?.note || '').slice(0, 120) || null) : null,
        'delivery.photoUrl': photo, 'delivery.codeChecked': pinOk || null,
        ...(skip && (need.photo && !photo || need.pin) ? { 'delivery.proofSkippedBy': actor.name } : {}),
      }) as any);
      txn.set(doc(collection(oRef, 'events')), evPayload('delivered', actor, { ...(left ? { left: true } : {}), ...(photo ? { photo: true } : {}), ...(pinOk ? { code: true } : {}) }));
      if (skip && ((need.photo && !photo) || need.pin)) txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, { text: `Marked delivered without the ${[need.photo && !photo ? 'photo' : '', need.pin ? 'delivery code' : ''].filter(Boolean).join(' or ')} the shop asks for` }));
      txn.set(doc(collection(oRef, 'events')), evPayload('completed', actor, { method: 'delivered' }));
      return { ok: true, message: `Order #${order.orderNumber} delivered.`, order: { ...order, stage: 'completed', completedAt: now } };
    });
    if (done?.ok && done.order) { syncRenterCredits(tenantId, done.order); shareOrderTipSoon(tenantId, done.order); }
    if (done && typeof done === 'object') delete done.order;
    return done;
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not mark it delivered.' };
  }
}

/**
 * Brought back to the shop: why (one of the reasons a driver picks, lib/delivery-run, or words from the back office),
 * and whose side it was on, which decides whether a second try is charged.
 */
export async function markDeliveryFailed(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor, reason: string, code?: FailCode | null, manager = false,
): Promise<{ ok: boolean; message: string; tries?: number }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order: any = { ...(oSnap.data() as RetailOrder), id: orderId };
      if (order.method !== 'delivery') return { ok: false, message: 'Only a delivery order can be brought back.' };
      if (order.stage !== 'ready') return { ok: false, message: `This order is ${STAGE_LABELS[order.stage as keyof typeof STAGE_LABELS] || order.stage}.` };
      if (order.delivery?.status !== 'out') return { ok: false, message: order.delivery?.status === 'failed' ? 'Already back at the shop.' : 'It isn’t out for delivery.' };
      if (!manager && String(order.delivery?.driverId || '') !== actor.id) return { ok: false, message: notTheDriver(order) };
      const r = failReason(code || order.delivery?.doorCode);
      const why = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 140) || r?.label || 'Something else';
      const now = new Date().toISOString();
      txn.update(oRef, clean({ 'delivery.status': 'failed', 'delivery.failedAt': now, 'delivery.failReason': why, 'delivery.failedById': actor.id,
        'delivery.failCode': r?.code || 'other', 'delivery.failCause': r?.cause || 'shop', 'delivery.skippedAt': null }) as any);
      txn.set(doc(collection(oRef, 'events')), evPayload('delivery_failed', actor, { reason: why }));
      return { ok: true, tries: Math.max(1, Number(order.delivery?.tries) || 1), message: 'Back on the ready shelf. Send it out again when there’s a driver, or talk to the customer.' };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not record that.' };
  }
}

/**
 * At the door and can't deliver yet: what happened, kept on the try (the customer is told and has a few minutes to
 * answer before the driver chooses). Once per try; picking another reason only changes the reason.
 */
export async function markAtDoor(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor, code: FailCode,
): Promise<{ ok: boolean; message: string; first?: boolean; doorAt?: string; tries?: number }> {
  const r = failReason(code); if (!r) return { ok: false, message: 'Choose what happened.' };
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order: any = oSnap.data();
      if (order.method !== 'delivery' || order.delivery?.status !== 'out') return { ok: false, message: 'It isn’t out for delivery.' };
      if (String(order.delivery?.driverId || '') !== actor.id) return { ok: false, message: `This delivery is with ${String(order.delivery?.driverName || 'another driver').split(' ')[0]}.` };
      const first = !order.delivery?.doorAt;
      const doorAt = order.delivery?.doorAt || new Date().toISOString();
      txn.update(oRef, clean({ 'delivery.doorAt': doorAt, 'delivery.doorCode': r.code }) as any);
      if (first) txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, { text: `At the door and couldn’t deliver yet: ${r.label.toLowerCase()}. ${String(order.customerName || 'The customer').split(' ')[0]} was messaged.` }));
      return { ok: true, first, doorAt, tries: Math.max(1, Number(order.delivery?.tries) || 1), message: first ? 'They’ve been messaged.' : 'Updated.' };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not record that.' };
  }
}

/** Go to the next stop and come back to this one: it moves to the end of the driver's route (lib/delivery-run). */
export async function markDeliverySkip(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor,
): Promise<{ ok: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order: any = oSnap.data();
      if (order.method !== 'delivery' || order.delivery?.status !== 'out') return { ok: false, message: 'It isn’t out for delivery.' };
      if (String(order.delivery?.driverId || '') !== actor.id) return { ok: false, message: `This delivery is with ${String(order.delivery?.driverName || 'another driver').split(' ')[0]}.` };
      txn.update(oRef, { 'delivery.skippedAt': new Date().toISOString() } as any);
      txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, { text: 'Went on to the next stop, coming back to this one' }));
      return { ok: true, message: 'Moved to the end of your route.' };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not record that.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * CANCEL — close an order before it leaves the building
 * ════════════════════════════════════════════════════════════════════════════
 * Allowed until the goods are gone (not shipped / handed off / completed).
 * Releases the stock reservation for every still-open unit so shelves free
 * up instantly, and if money was taken, queues the amount as a pending
 * refund — the same banner + "Mark refunded" flow used everywhere else.
 */

/* ════════════════════════════════════════════════════════════════════════════
 * REOPEN A SHORTED LINE — the "I shorted it by mistake" undo
 * ════════════════════════════════════════════════════════════════════════════
 * Shelf-shorting wrote the units off and (for refund shorts) queued money
 * back to the customer. Reopening reverses all of it: stock and reservation
 * restored, the queued refund for those units withdrawn, the line back to
 * scannable. Backorder shorts are blocked until the child order is cancelled
 * (otherwise the same units would ship twice).
 */

export async function reopenShortedLine(
  fs: Firestore, tenantId: string, orderId: string, lineId: string, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = oSnap.data() as RetailOrder;
      if (order.stage !== 'picking') return { ok: false, message: 'Only picking orders can reopen a line.' };

      const line = order.lines.find((l) => l.lineId === lineId);
      if (!line) return { ok: false, message: 'Line not found.' };
      if ((line.qtyShorted || 0) <= 0) return { ok: false, message: `${line.name} is not shorted.` };
      if (line.status === 'backordered') {
        return { ok: false, message: `${line.name} has been moved to a backorder. Please cancel that order in the Queue first, then reopen this line.` };
      }

      const qty = line.qtyShorted;
      const iRef = invDoc(fs, tenantId, line.productId);
      const iSnap = await txn.get(iRef);
      if (iSnap.exists()) {
        const item = iSnap.data() as any;
        txn.update(iRef, {
          totalStock: (Number(item.totalStock) || 0) + qty,
          stockReserved: (Number(item.stockReserved) || 0) + qty,
        });
        txn.set(doc(collection(fs, `tenants/${tenantId}/stockCorrections`)),
          correction(line.productId, item.unit || 'units', qty,
            `Short reversed (Order #${order.orderNumber})`, orderId, actor));
      }

      // What shorting it queued: what was actually paid, after any promo code, and the tax on it.
      const itemsBack = qty * effectiveUnitCents(line as any);
      const refundBack = itemsBack + taxShareCents(order as any, itemsBack);
      const lines = order.lines.map((l) => l.lineId !== lineId ? l : ({
        ...l, qtyShorted: 0, shortReason: '',
        status: l.qtyScanned >= l.qtyOrdered ? ('picked' as const) : ('pending' as const),
      }));

      txn.update(oRef, JSON.parse(JSON.stringify({
        lines,
        pendingRefundCents: Math.max(0, (order.pendingRefundCents || 0) - refundBack),
      })));
      txn.set(doc(collection(oRef, 'events')), evPayload('line_reopened', actor, { lineId, qty }));

      return { ok: true, message: `${line.name} has been reopened and is ready to scan.` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not reopen.' };
  }
}

/** The orders made from this one, at any depth (a few at most), by id: a transaction can read them but not search. */
async function followUpIdsOf(fs: Firestore, tenantId: string, rootId: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const s = await getDocs(query(orderCol(fs, tenantId), where('parentOrderId', '==', id), limit(20)));
      for (const d of s.docs) if (!seen.has(d.id)) { seen.add(d.id); out.push(d.id); next.push(d.id); }
    }
    frontier = next;
  }
  return out;
}

export async function cancelOrder(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor, reason?: string
): Promise<{ ok: boolean; message: string }> {
  try {
    // Orders made from this one (a backorder, pre-order items sent later) are found first and cancelled with it. For an
    // order made from another, the orders made from the one it was paid on are found instead, so what it gives back is
    // worked out from what that whole family still holds.
    let rootId = orderId;
    try {
      let cur: any = (await getDoc(doc(orderCol(fs, tenantId), orderId))).data();
      for (let i = 0; i < 4 && cur && isFollowUp(cur) && cur.parentOrderId; i++) { rootId = String(cur.parentOrderId); cur = (await getDoc(doc(orderCol(fs, tenantId), rootId))).data(); }
    } catch { rootId = orderId; }
    const famIds = await followUpIdsOf(fs, tenantId, rootId);
    return await runTransaction(fs, async (txn) => {
      const orderRef = doc(orderCol(fs, tenantId), orderId);
      const snap = await txn.get(orderRef);
      if (!snap.exists()) return { ok: false, message: 'Order not found.' };
      const order = snap.data() as RetailOrder;

      if (['shipped', 'completed'].includes(order.stage)) {
        return { ok: false, message: `Order #${order.orderNumber} has already been ${order.stage.replace('_', ' ')}. Please handle it as a return instead.` };
      }
      if (['cancelled'].includes(order.stage)) {
        return { ok: false, message: `#${order.orderNumber} is already ${order.stage}.` };
      }
      // A delivery out with its driver is in the van: it's delivered or brought back before anything else.
      if ((order as any).method === 'delivery' && (order as any).delivery?.status === 'out') {
        return { ok: false, message: `#${order.orderNumber} is out for delivery. Mark it delivered or brought back first.` };
      }

      const read = async (id: string) => {
        if (!id) return null;
        const s = await txn.get(doc(orderCol(fs, tenantId), id));
        return s.exists() ? { ...(s.data() as any), id } : null;
      };
      // An order made from another one (a backorder, a replacement: lib/order-family) has no payment of its own: what
      // the customer paid for its items goes back to the card they used on the order it came from, on top of anything
      // already queued on it. The orders above it are read first: nothing comes back when the order paid on has already
      // given everything back, or for a replacement for a parcel that was delivered after all, and an older follow-up
      // takes its prices and tax figures from the order that was paid.
      const follow = isFollowUp(order);
      let parent: any = null; let payer: any = null; const chain: any[] = [];
      if (follow) {
        parent = await read(String((order as any).parentOrderId || ''));
        payer = parent; if (parent) chain.push(parent);
        for (let i = 0; i < 3 && payer && isFollowUp(payer); i++) { payer = await read(String(payer.parentOrderId || '')); if (payer) chain.push(payer); }
        if (payer && isFollowUp(payer)) payer = null;
      }
      // The order the customer paid on: its follow-ups that haven't gone out are cancelled with it, and its card gets
      // back what it hasn't had back across all of them, so nothing is refunded twice. For a follow-up, the same family,
      // as it is now (this order included).
      const famAll = (await Promise.all(famIds.map((id) => (id === orderId ? Promise.resolve({ ...(order as any), id: orderId }) : read(id))))).filter(Boolean) as any[];
      const fam = follow ? [] : famAll;
      const plan = follow ? null : cancelWithFollowUps({ ...order, id: orderId }, fam);
      const going: any[] = [{ ...order, id: orderId }, ...(plan?.cancel || [])];

      // Reads before writes: the stock each of them is holding (lib/order-family heldUnits).
      const releases = new Map<string, number>();
      for (const g of going) for (const [pid, q] of heldUnits(g)) releases.set(pid, (releases.get(pid) || 0) + q);
      const itemSnaps: { ref: any; qty: number; snap: any }[] = [];
      for (const [pid, qty] of releases) {
        const ref = doc(fs, `tenants/${tenantId}/inventory`, pid);
        itemSnaps.push({ ref, qty, snap: await txn.get(ref) });
      }

      for (const { ref, qty, snap: itemSnap } of itemSnaps) {
        if (!itemSnap.exists()) continue;
        const item = itemSnap.data() as any;
        txn.update(ref, { stockReserved: Math.max(0, (Number(item.stockReserved) || 0) - qty) });
        txn.set(doc(collection(fs, `tenants/${tenantId}/stockCorrections`)), buildEntry({
          productId: String(ref.id),
          type: 'released',
          field: 'stockReserved',
          delta: -qty,
          unit: item.unit || 'units',
          reason: `Hold released \u2014 order cancelled (Order #${order.orderNumber})`,
          actorId: actor.id,
          actorName: actor.name,
          ref: { kind: 'order', id: orderId },
          balanceAfter: Math.max(0, (Number(item.stockReserved) || 0) - qty),
        }));
      }

      const paidSomething = order.stage !== 'placed';
      const already = Number((order as any).pendingRefundCents) || 0;
      const lostParcel = (order as any).lostParcelOrderId ? chain.find((x: any) => x.id === String((order as any).lostParcelOrderId)) || null : null;
      const pending = follow ? followUpCancelCents(order, parent, payer, payer && rootId === payer.id ? famAll : undefined, lostParcel) : paidSomething ? plan!.pendingCents : 0;
      const now = new Date().toISOString();

      txn.update(orderRef, JSON.parse(JSON.stringify({
        stage: 'cancelled',
        cancelledAt: now,
        cancelReason: reason || '',
        // A paid order's card gets back everything it hasn't had back yet, which covers anything already queued.
        pendingRefundCents: follow ? already + pending : Math.max(pending, already),
        batchId: null,
        claimedBy: null,
        claimedByName: null,
      })));
      txn.set(doc(collection(orderRef, 'events')), evPayload('cancelled', actor, {
        reason: reason || '', pendingRefundCents: pending,
      }));
      // Its follow-ups go with it. Anything already queued on one stays queued; their items are in this order's refund.
      for (const f of plan?.cancel || []) {
        const fRef = doc(orderCol(fs, tenantId), String(f.id));
        txn.update(fRef, JSON.parse(JSON.stringify({
          stage: 'cancelled', cancelledAt: now,
          cancelReason: `Cancelled with order #${order.orderNumber}${reason ? `: ${reason}` : ''}`,
          batchId: null, claimedBy: null, claimedByName: null,
        })));
        txn.set(doc(collection(fRef, 'events')), evPayload('cancelled', actor, {
          reason: `Cancelled with order #${order.orderNumber}`, pendingRefundCents: 0,
        }));
      }

      const n = (plan?.cancel || []).length;
      const withThem = n === 1 ? `, with ${followUpLabel(plan!.cancel[0])}` : n > 1 ? `, with the ${n} orders made from it` : '';
      return {
        ok: true,
        message: pending > 0
          ? `Order #${order.orderNumber} has been cancelled${withThem}. A refund of $${(pending / 100).toFixed(2)} has been queued.`
          : `Order #${order.orderNumber} has been cancelled${withThem}.`,
      };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not cancel.' };
  }
}

export async function markShipped(
  fs: Firestore, tenantId: string, orderId: string,
  tracking: { carrier?: string; number?: string; url?: string; extraNumbers?: string[] }, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  try {
    const done: any = await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };

      const guard = canAdvance(order, 'shipped');
      if (!guard.ok) return { ok: false, message: guard.reason };
      // The customer asked for a different address (lib/address-flow): it can't go out until someone answers that.
      if (['waiting', 'approving'].includes(String((order as any).addressRequest?.status))) return { ok: false, message: `${String(order.customerName || 'The customer').split(' ')[0]} asked to change the address. Answer that on the order before it goes out.` };
      // A label that may no longer work (lib/label-doubt). An order in another order's box carries a copy of that order's
      // label, so it's that order's label that's checked.
      const holderId = labelHolderId(order);
      const holder: any = holderId ? ((await txn.get(doc(orderCol(fs, tenantId), holderId))).data() || null) : order;
      const doubt = holder ? labelDoubt(holder) : null;
      // A box whose label was voided (lib/label-boxes) needs its new label first, so it never leaves on the old one.
      if (doubt === 'relabel') return { ok: false, message: holderId ? 'A box in the shipment this order shares has a voided label. Sort it out on that order before it goes out.' : 'One of these boxes has a voided label. Buy its new label on the ship sheet, or take that box off the order, before it goes out.' };
      if (doubt) return { ok: false, message: holderId ? 'Voiding the label this box shares with another order didn’t finish, so it may no longer work. Sort it out on that order before it goes out.' : 'Voiding this label didn’t finish, so it may no longer work. Void it again on the ship sheet and buy a new one before it goes out.' };
      // A tracking number from a label that was voided (lib/label-void) would send the customer a dead link.
      const voidedNums: string[] = Array.isArray((order as any).voidedTracking) ? (order as any).voidedTracking.map(String) : [];
      if (voidedNums.length && [tracking.number, ...(tracking.extraNumbers || [])].some((n) => n && voidedNums.includes(String(n).trim()))) return { ok: false, message: 'That label was voided. Buy a new one before it goes out.' };

      const itemSnaps = await readOrderItems(txn, fs, tenantId, order);
      convertSaleInTxn(txn, fs, tenantId, order, itemSnaps, actor);

      txn.update(oRef, {
        stage: 'shipped',
        completedAt: new Date().toISOString(),
        // A label bought earlier (bulk or a reopened dialog) keeps its tracking when nothing new was typed.
        trackingNumber: tracking.number || order.trackingNumber || null,
        trackingUrl: tracking.url || order.trackingUrl || null,
        carrier: tracking.carrier || order.carrier || null,
        // More boxes, typed from labels bought elsewhere: one tracking number per box.
        ...(tracking.extraNumbers && tracking.extraNumbers.length ? { extraTrackingNumbers: tracking.extraNumbers.slice(0, 9), packageCount: 1 + Math.min(9, tracking.extraNumbers.length) } : {}),
      });
      if (tracking.number) {
        txn.set(doc(collection(oRef, 'events')), evPayload('label_generated', actor, {
          carrier: tracking.carrier || 'unknown', trackingNumber: tracking.number,
        }));
      }
      txn.set(doc(collection(oRef, 'events')), evPayload('shipped', actor));
      return { ok: true, message: `Order #${order.orderNumber} shipped`, order };
    });
    // Renters' shares of what just went out go onto their rent accounts (lib/renter-sales).
    if (done?.ok && done.order) { syncRenterCredits(tenantId, done.order); shareOrderTipSoon(tenantId, done.order); }
    if (done && typeof done === 'object') delete done.order;
    return done;
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not mark shipped.' };
  }
}

/** Backorder tray: release a parked child order into the live queue. */
/**
 * SHIP WHAT'S READY. A mixed cart — gel in stock, pre-order kit that lands in
 * six weeks — currently waits for the slowest item, which is the wrong
 * default: the customer paid for the gel today.
 *
 * This splits the order in two, reusing the child-order machinery the
 * backorder flow already proved: the WAITING lines move to a child order
 * (parked, same customer QR, same order number) and the parent keeps only
 * what can go now, so the bench works a normal, complete job. When the
 * pre-order lands, releasing the child puts it back in the queue exactly
 * like a restocked backorder.
 *
 * Deliberately manual: shipping twice costs postage, and only the shop can
 * decide whether that's worth it for this order. Nothing here charges the
 * customer more.
 */
export async function splitReadyFromWaiting(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor
): Promise<{ ok: boolean; message: string; childOrderId?: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };
      if (!['paid', 'picking'].includes(String(order.stage))) {
        return { ok: false, message: 'Only a paid or picking order can be split.' };
      }
      if ((order as any).parentOrderId) {
        return { ok: false, message: 'This is already a split shipment.' };
      }

      const waiting = (order.lines || []).filter((l: any) =>
        l.preorder === true && !['refunded', 'cancelled'].includes(String(l.status)));
      const ready = (order.lines || []).filter((l: any) => !waiting.includes(l));
      if (waiting.length === 0) return { ok: false, message: 'Nothing on this order is waiting.' };
      if (ready.length === 0) return { ok: false, message: 'Every item on this order is still waiting, so there is nothing to ship yet.' };

      const childRef = doc(orderCol(fs, tenantId));
      const child = {
        id: childRef.id, tenantId,
        orderNumber: order.orderNumber,
        stage: 'paid', method: order.method, priceTier: order.priceTier || 'retail', ...(order.priceTier === 'wholesale' ? { wholesaleAccountId: order.wholesaleAccountId || null, ...(order.wholesaleDiscountPct != null ? { wholesaleDiscountPct: order.wholesaleDiscountPct } : {}) } : {}),
        businessName: order.businessName || '', poNumber: order.poNumber || '',
        lines: waiting.map((l: any) => ({
          ...l, lineId: `line-${nanoid(8)}`, qtyScanned: 0, qtyPacked: 0, status: 'pending',
        })),
        subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0, totalCents: 0,
        taxBasis: taxBasisOf(order),
        customerName: order.customerName, customerEmail: order.customerEmail,
        customerPhone: order.customerPhone || '',
        shippingAddress: order.shippingAddress || null,
        ...((order as any).method === 'delivery' && (order as any).delivery ? { delivery: followUpDelivery((order as any).delivery) } : {}),
        parentOrderId: orderId, holdUntilRestock: true,
        ...((order as any).replacementFor === 'lost_in_transit' ? { replacementFor: 'lost_in_transit', lostParcelOrderId: (order as any).lostParcelOrderId || (order as any).parentOrderId || null } : {}),
        hasPreorder: true,
        shipPromiseAt: (order as any).shipPromiseAt || null,
        qrToken: order.qrToken || null,
        ...((order as any).collector?.name ? { collector: (order as any).collector } : {}),
        placedAt: new Date().toISOString(), paidAt: order.paidAt || new Date().toISOString(),
      };
      txn.set(childRef, JSON.parse(JSON.stringify(child)));
      txn.update(oRef, { lines: JSON.parse(JSON.stringify(ready)), splitChildOrderId: childRef.id, backorderOrderIds: [...(Array.isArray((order as any).backorderOrderIds) ? (order as any).backorderOrderIds : []), childRef.id] });
      txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, {
        text: `Split shipment \u2014 ${ready.length} item(s) ship now, ${waiting.length} pre-order item(s) follow when they land`,
      }));
      return { ok: true, message: `Order split: ${ready.length} ready to ship now, ${waiting.length} to follow.`, childOrderId: childRef.id };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not split the order.' };
  }
}

/** The shelf units a backorder needs, by product: each open unit of its physical items. */
function backorderNeeds(o: any): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of Array.isArray(o?.lines) ? o.lines : []) {
    if (!l || l.digital === true || !l.productId) continue;
    const q = Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0));
    if (q > 0) m.set(String(l.productId), (m.get(String(l.productId)) || 0) + q);
  }
  return m;
}

/** What's free on the shelf for a product: on hand, less what paid orders are holding. */
const freeUnits = (it: any): number => Math.max(0, (Number(it?.totalStock) || 0) - (Number(it?.stockReserved) || 0));

/**
 * A backorder waiting for stock goes into the packing queue. It held no stock while it waited; released, it takes its
 * units like any paid order. `onlyIfCovered`: release it only when everything it needs is free on the shelf, checked
 * in the same transaction (the automatic release); without it, someone has decided to send it (the team's Release).
 * Either way the answer says what's short, so the screen can ask before releasing an order that can't be packed yet.
 */
export async function releaseBackorder(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor, opts: { onlyIfCovered?: boolean } = {}
): Promise<{ ok: boolean; message: string; short?: { productId: string; name: string; have: number; need: number }[] }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const child = oSnap.data() as RetailOrder;
      if (child.holdUntilRestock !== true) {
        return { ok: false, message: 'This order isn’t waiting on stock any more.' };
      }
      if (!['paid'].includes(String(child.stage))) return { ok: false, message: 'This order has already moved on.' };
      // Each product once, however many lines it's on, so two lines of one product both take their units.
      const needs = backorderNeeds(child);
      const reads = await Promise.all([...needs].map(async ([pid, q]) => ({ pid, q, ref: invDoc(fs, tenantId, pid), snap: await txn.get(invDoc(fs, tenantId, pid)) })));
      const nameOf = (pid: string) => String((child.lines || []).find((l: any) => String(l.productId) === pid)?.name || 'item');
      const short = reads.filter(({ q, snap }) => freeUnits(snap.exists() ? snap.data() : null) < q)
        .map(({ pid, q, snap }) => ({ productId: pid, name: nameOf(pid), have: freeUnits(snap.exists() ? snap.data() : null), need: q }));
      const shortText = short.map((x) => `${x.have} of ${x.need} ${x.name}`).join(', ');
      if (opts.onlyIfCovered && short.length) return { ok: false, short, message: `Not all on the shelf yet: ${shortText}.` };
      for (const { q, ref, snap } of reads) {
        if (!snap.exists()) continue;
        const it = snap.data() as any;
        txn.update(ref, { stockReserved: (Number(it.stockReserved) || 0) + q });
      }
      // Due times count from here, not from the original payment (lib/retail-orders workStartedAt).
      txn.update(oRef, { holdUntilRestock: false, releasedAt: new Date().toISOString() });
      txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, { text: short.length ? `Backorder released to the queue, though only ${shortText} on the shelf` : 'Backorder released to the queue' }));
      return { ok: true, short, message: short.length ? `Released. Only ${shortText} on the shelf, so it may come up short when it’s packed.` : 'Released. It’s in the packing queue now.' };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not release.' };
  }
}

/**
 * Stock came in → backorders go out. Called after stock commits (the receive dialogs, a return checked back onto the
 * shelf): every backorder waiting for one of those products is released, oldest first, when everything it needs is
 * free on the shelf now (what's on hand less what paid orders are holding), not just what this delivery brought, so
 * two deliveries that together cover it release it. All of it or none: a release that comes up short at the bench is
 * motion, not progress. Best-effort by design: a failure here never touches the stock that already committed, and the
 * order's own Release stays the human override either way.
 */
export async function releaseCoverableBackorders(
  fs: Firestore,
  tenantId: string,
  received: { productId: string; qty: number }[],
  actor: Actor
): Promise<{ released: { orderId: string; orderNumber: number | null; units: number }[] }> {
  const released: { orderId: string; orderNumber: number | null; units: number }[] = [];
  try {
    const touched = new Set(received.filter((r) => r.productId && Number(r.qty) > 0).map((r) => String(r.productId)));
    if (touched.size === 0) return { released };

    const heldSnap = await getDocs(query(orderCol(fs, tenantId), where('holdUntilRestock', '==', true), limit(200)));
    const held = heldSnap.docs
      .map((d) => ({ ...(d.data() as RetailOrder), id: d.id }))
      .filter((o) => o.stage === 'paid' && [...backorderNeeds(o).keys()].some((p) => touched.has(p)))
      .sort((a, b) => String(a.placedAt || '').localeCompare(String(b.placedAt || '')));
    if (!held.length) return { released };

    const free = new Map<string, number>();
    for (const pid of new Set(held.flatMap((o) => [...backorderNeeds(o).keys()]))) {
      const s = await getDoc(invDoc(fs, tenantId, pid));
      free.set(pid, freeUnits(s.exists() ? s.data() : null));
    }
    for (const child of held) {
      const needs = backorderNeeds(child);
      if (!needs.size || [...needs].some(([pid, q]) => (free.get(pid) || 0) < q)) continue;
      const res = await releaseBackorder(fs, tenantId, child.id, actor, { onlyIfCovered: true });
      if (!res.ok) continue;
      for (const [pid, q] of needs) free.set(pid, (free.get(pid) || 0) - q);
      released.push({ orderId: child.id, orderNumber: child.orderNumber ?? null, units: [...needs.values()].reduce((a, b) => a + b, 0) });
    }
  } catch (e) {
    console.warn('[retail-fulfill] backorder auto-release skipped:', (e as any)?.message);
  }
  return { released };
}
