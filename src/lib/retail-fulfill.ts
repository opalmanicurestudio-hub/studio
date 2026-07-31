'use client';

import {
  Firestore, collection, doc, getDocs, limit, query, runTransaction, where,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';

import {
  BATCH_CLAIM_TIMEOUT_MIN, MAX_SHIP_ORDERS_PER_BATCH, STAGE_LABELS,
  applyScan, buildEvent, canAdvance, depleteBatchesFIFO, fulfilledQty,
  isClaimStale, isPickComplete, parseOrderQr, queuePriority, shortLine,
  type FulfillmentBatch, type InventoryBatchRef, type OrderEventType,
  type RetailOrder, type ShortResolution,
} from '@/lib/retail-orders';

// ─── src/lib/retail-fulfill.ts ────────────────────────────────────────────────
// Client-side fulfillment actions for the board. Every state change runs in a
// Firestore TRANSACTION with the engine's guards re-checked against fresh
// data, so two phones acting at once can never double-claim, double-scan, or
// double-deplete. Every action appends its audit event in the same atomic
// write. Uses the client SDK (like the inventory page) — no new auth layer.

export interface Actor { id: string; name: string; }

const orderCol = (fs: Firestore, t: string) => collection(fs, `tenants/${t}/retailOrders`);
const batchCol = (fs: Firestore, t: string) => collection(fs, `tenants/${t}/fulfillmentBatches`);
const invDoc = (fs: Firestore, t: string, id: string) => doc(fs, `tenants/${t}/inventory`, id);

function evPayload(type: OrderEventType, actor: Actor, meta?: Record<string, string | number | boolean>) {
  return { id: `ev-${nanoid(10)}`, ...buildEvent(type, actor.id, actor.name, meta) };
}

function correction(
  productId: string, unit: string, change: number, reason: string, orderId: string, actor: Actor
) {
  return {
    productId, change, unit, reason,
    date: new Date().toISOString(),
    orderId, actorId: actor.id, actorName: actor.name, source: 'retail_engine',
  };
}

/* ════════════════════════════════════════════════════════════════════════════
 * TAKE NEXT — atomic batch claim
 * ════════════════════════════════════════════════════════════════════════════ */

export async function claimNextBatch(
  fs: Firestore, tenantId: string, actor: Actor
): Promise<{ batchId: string; orderIds: string[] } | { error: string }> {
  const snap = await getDocs(query(orderCol(fs, tenantId), where('stage', '==', 'paid')));
  const candidates = snap.docs
    .map((d: any) => ({ ...(d.data() as RetailOrder), id: d.id as string }))
    .filter((o: RetailOrder & { id: string }) => !o.batchId && o.holdUntilRestock !== true)
    .sort((a: RetailOrder, b: RetailOrder) => queuePriority(a) - queuePriority(b));

  if (candidates.length === 0) return { error: 'The queue is empty — nothing to pick.' };

  // Wave composition: ASAP orders pick solo; ship orders batch together.
  const head = candidates[0];
  const wave = head.method === 'ship'
    ? candidates.filter((o: RetailOrder) => o.method === 'ship').slice(0, MAX_SHIP_ORDERS_PER_BATCH)
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
        txn.update(ref, { stage: 'picking', batchId: batchRef.id });
        txn.set(doc(collection(ref, 'events')), evPayload('batch_claimed', actor, {
          batchId: batchRef.id, waveSize: still.length,
        }));
      }
      return still.map(({ snap }) => snap.id);
    });

    if (claimed.length === 0) return { error: 'Someone grabbed that order first — tap Take Next again.' };
    return { batchId: batchRef.id, orderIds: claimed };
  } catch (e: any) {
    return { error: e?.message || 'Could not claim — try again.' };
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
        txn.update(refs[i], { stage: 'paid', batchId: null });
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

export async function recordItemScan(
  fs: Firestore, tenantId: string, orderId: string, scannedValue: string, actor: Actor
): Promise<{ ok: boolean; message: string; pickComplete?: boolean }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = oSnap.data() as RetailOrder;
      if (order.stage !== 'picking') {
        return { ok: false, message: `Order is ${STAGE_LABELS[order.stage]} — scanning is closed.` };
      }

      const { result, lines } = applyScan(order.lines, scannedValue);
      if (!result.ok) {
        txn.set(doc(collection(oRef, 'events')),
          evPayload('scan_mismatch', actor, { scannedValue: scannedValue.slice(0, 80), code: result.code }));
        return { ok: false, message: result.message };
      }

      txn.update(oRef, { lines: JSON.parse(JSON.stringify(lines)) });
      txn.set(doc(collection(oRef, 'events')), evPayload('item_scanned', actor, {
        lineId: result.lineId, qtyScanned: result.qtyScanned, qtyOrdered: result.qtyOrdered,
      }));
      if (result.pickComplete) {
        txn.set(doc(collection(oRef, 'events')), evPayload('pick_complete', actor));
      }
      return {
        ok: true,
        message: `${result.qtyScanned}/${result.qtyOrdered}`,
        pickComplete: result.pickComplete,
      };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Scan failed — try again.' };
  }
}

/**
 * Shelf discrepancy: fewer units physically exist than the order needs.
 * Corrects shelf truth (totalStock down), releases the hold for the missing
 * units, marks the line, and either queues a refund (pendingRefundCents — the
 * board surfaces it until executed in Stripe) or parks a backorder child
 * order that re-enters the queue when you release it after restocking.
 */
export async function resolveShortLine(
  fs: Firestore, tenantId: string, orderId: string, lineId: string,
  reason: string, resolution: ShortResolution, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
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
          totalStock: Math.max(0, (item.totalStock || 0) - qtyShorted),
          stockReserved: Math.max(0, (item.stockReserved || 0) - qtyShorted),
        });
        txn.set(doc(collection(fs, `tenants/${tenantId}/stockCorrections`)),
          correction(target.productId, item.unit || 'units', -qtyShorted,
            `Shelf short during pick: ${reason} (Order #${order.orderNumber})`, orderId, actor));
      }

      const orderUpdate: Record<string, unknown> = { lines: JSON.parse(JSON.stringify(lines)) };
      if (resolution === 'refund') {
        orderUpdate.pendingRefundCents = (order.pendingRefundCents || 0) + refundCents;
      }
      txn.update(oRef, orderUpdate);
      txn.set(doc(collection(oRef, 'events')), evPayload('line_shorted', actor, {
        lineId, qtyShorted, reason, resolution,
      }));

      if (resolution === 'backorder') {
        const childRef = doc(orderCol(fs, tenantId));
        const child = {
          id: childRef.id, tenantId,
          orderNumber: order.orderNumber, // shares the customer-facing number
          stage: 'paid', method: order.method, priceTier: order.priceTier || 'retail',
          businessName: order.businessName || '', poNumber: order.poNumber || '',
          lines: [{
            ...target, lineId: `line-${nanoid(8)}`, qtyOrdered: qtyShorted,
            qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending', shortReason: '',
          }],
          subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0, totalCents: 0,
          customerName: order.customerName, customerEmail: order.customerEmail,
          customerPhone: order.customerPhone || '',
          shippingAddress: order.shippingAddress || null,
          parentOrderId: orderId, holdUntilRestock: true,
          qrToken: order.qrToken || null, // same customer QR completes the backorder
          placedAt: new Date().toISOString(), paidAt: order.paidAt || new Date().toISOString(),
        };
        txn.set(childRef, JSON.parse(JSON.stringify(child)));
        txn.set(doc(collection(oRef, 'events')), evPayload('backorder_split', actor, { childOrderId: childRef.id }));
      }

      return {
        ok: true,
        message: resolution === 'refund'
          ? `Shorted ${qtyShorted} — refund of $${(refundCents / 100).toFixed(2)} queued`
          : `Shorted ${qtyShorted} — backorder created, parked until restock`,
      };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not short the line.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * PACKED → READY (with early-arrival auto-advance)
 * ════════════════════════════════════════════════════════════════════════════ */

export async function markPacked(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  try {
    const batchId = await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) throw new Error('Order not found.');
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };

      const guard = canAdvance(order, 'packed');
      if (!guard.ok) throw new Error(guard.reason);

      txn.update(oRef, { stage: 'packed', packedAt: new Date().toISOString() });
      txn.set(doc(collection(oRef, 'events')), evPayload('packed', actor));
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
    return { ok: true, message: 'Packed' };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not mark packed.' };
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
      txn.set(doc(collection(oRef, 'events')), evPayload('marked_ready', actor));
      if (customerWaiting) {
        txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, {
          text: 'Customer arrived early — auto-advanced to Arrived',
        }));
      }
      return {
        ok: true, autoArrived: customerWaiting,
        message: customerWaiting ? 'Customer is already outside — take it out!' : 'On the ready shelf',
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
  order.lines.forEach((line, i) => {
    const qty = fulfilledQty(line);
    const { snap, ref } = itemSnaps[i];
    if (qty <= 0 || !snap.exists()) return;
    const item = snap.data() as any;
    const { batches } = depleteBatchesFIFO(item.batches as InventoryBatchRef[], qty);
    const newTotal = batches.reduce((a, b) => a + b.stock, 0);
    txn.update(ref, {
      batches: JSON.parse(JSON.stringify(batches)),
      totalStock: newTotal,
      stockReserved: Math.max(0, (item.stockReserved || 0) - qty),
    });
    txn.set(doc(collection(fs, `tenants/${tenantId}/stockCorrections`)),
      correction(line.productId, item.unit || 'units', -qty,
        `Online order fulfilled (Order #${order.orderNumber})`, order.id, actor));
  });
}

async function readOrderItems(txn: any, fs: Firestore, tenantId: string, order: RetailOrder) {
  return Promise.all(order.lines.map(async (l) => {
    const ref = invDoc(fs, tenantId, l.productId);
    return { ref, snap: await txn.get(ref) };
  }));
}

export async function handoffByScan(
  fs: Firestore, tenantId: string, scannedValue: string, actor: Actor
): Promise<{ ok: boolean; message: string; orderNumber?: number }> {
  const token = parseOrderQr(scannedValue) ?? scannedValue.trim();
  const match = await getDocs(query(orderCol(fs, tenantId), where('qrToken', '==', token), limit(1)));
  if (match.empty) return { ok: false, message: 'Not a valid pickup code for this shop.' };

  const orderId = match.docs[0].id;
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };

      if (!['ready', 'arrived'].includes(order.stage)) {
        return {
          ok: false,
          message: `Order #${order.orderNumber} is ${STAGE_LABELS[order.stage]} — it can't be handed off yet.`,
        };
      }

      const itemSnaps = await readOrderItems(txn, fs, tenantId, order);
      convertSaleInTxn(txn, fs, tenantId, order, itemSnaps, actor);

      const now = new Date().toISOString();
      txn.update(oRef, { stage: 'completed', completedAt: now });
      txn.set(doc(collection(oRef, 'events')), evPayload('handoff_scanned', actor));
      txn.set(doc(collection(oRef, 'events')), evPayload('completed', actor));
      return { ok: true, message: `Order #${order.orderNumber} — ${order.customerName}`, orderNumber: order.orderNumber };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Handoff failed — try again.' };
  }
}

/** Lost-phone fallback. Same conversion, but logged as an override. */
export async function handoffWithoutScan(
  fs: Firestore, tenantId: string, orderId: string, verifiedBy: string, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };
      if (!['ready', 'arrived'].includes(order.stage)) {
        return { ok: false, message: `Order is ${STAGE_LABELS[order.stage]} — not ready for handoff.` };
      }

      const itemSnaps = await readOrderItems(txn, fs, tenantId, order);
      convertSaleInTxn(txn, fs, tenantId, order, itemSnaps, actor);

      const now = new Date().toISOString();
      txn.update(oRef, { stage: 'completed', completedAt: now });
      txn.set(doc(collection(oRef, 'events')), evPayload('override', actor, {
        rule: 'handoff_without_scan', reason: `Identity verified: ${verifiedBy}`.slice(0, 140),
      }));
      txn.set(doc(collection(oRef, 'events')), evPayload('completed', actor));
      return { ok: true, message: `Order #${order.orderNumber} handed off (no scan — logged)` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Handoff failed.' };
  }
}

export async function markShipped(
  fs: Firestore, tenantId: string, orderId: string,
  tracking: { carrier?: string; number?: string; url?: string }, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = { ...(oSnap.data() as RetailOrder), id: orderId };

      const guard = canAdvance(order, 'shipped');
      if (!guard.ok) return { ok: false, message: guard.reason };

      const itemSnaps = await readOrderItems(txn, fs, tenantId, order);
      convertSaleInTxn(txn, fs, tenantId, order, itemSnaps, actor);

      txn.update(oRef, {
        stage: 'shipped',
        completedAt: new Date().toISOString(),
        trackingNumber: tracking.number || null,
        trackingUrl: tracking.url || null,
        carrier: tracking.carrier || null,
      });
      if (tracking.number) {
        txn.set(doc(collection(oRef, 'events')), evPayload('label_generated', actor, {
          carrier: tracking.carrier || 'unknown', trackingNumber: tracking.number,
        }));
      }
      txn.set(doc(collection(oRef, 'events')), evPayload('shipped', actor));
      return { ok: true, message: `Order #${order.orderNumber} shipped` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not mark shipped.' };
  }
}

/** Backorder tray: release a parked child order into the live queue. */
export async function releaseBackorder(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      if ((oSnap.data() as RetailOrder).holdUntilRestock !== true) {
        return { ok: false, message: 'Order is not on hold.' };
      }
      txn.update(oRef, { holdUntilRestock: false });
      txn.set(doc(collection(oRef, 'events')), evPayload('note', actor, { text: 'Backorder released to queue' }));
      return { ok: true, message: 'Released to the queue' };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not release.' };
  }
}
