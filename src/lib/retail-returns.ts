'use client';

import {
  Firestore, collection, doc, getDocs, limit, query, runTransaction, where,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';

import {
  buildEvent, isReturnReceivable, parseOrderQr, returnRefundCents,
  type OrderEventType, type RetailOrder, type RetailReturn, type ReturnDisposition,
  type ReturnLine, type ReturnReason, type ReturnResolution,
} from '@/lib/retail-orders';
import { canReturnLine } from '@/lib/return-eligibility';

// ─── src/lib/retail-returns.ts ────────────────────────────────────────────────
// RMA action layer. Same rules as fulfillment: every mutation is a Firestore
// transaction, every step appends its audit event, and the two catastrophic
// return failure modes are structurally impossible:
//   1. Damaged goods can never re-enter sellable stock — restock vs write-off
//      is a per-line SCANNED disposition, and resolve is blocked until every
//      line has one (isReturnReceivable).
//   2. Promised refunds can't be forgotten — resolve(refund) adds to the
//      order's pendingRefundCents, which the board's amber banner surfaces
//      until someone executes it in Stripe and taps "Mark refunded".

export interface Actor { id: string; name: string; }

const orderCol = (fs: Firestore, t: string) => collection(fs, `tenants/${t}/retailOrders`);
const returnCol = (fs: Firestore, t: string) => collection(fs, `tenants/${t}/retailReturns`);
const invDoc = (fs: Firestore, t: string, id: string) => doc(fs, `tenants/${t}/inventory`, id);

function evPayload(type: OrderEventType, actor: Actor, meta?: Record<string, string | number | boolean>) {
  return { id: `ev-${nanoid(10)}`, ...buildEvent(type, actor.id, actor.name, meta) };
}

export type ReturnDoc = RetailReturn & { id: string };
export type ReturnableOrder = RetailOrder & { id: string };

/* ════════════════════════════════════════════════════════════════════════════
 * LOOKUP — scan the customer's QR or type the order number
 * ════════════════════════════════════════════════════════════════════════════ */

const RETURNABLE_STAGES = ['completed', 'shipped', 'handed_off'];

export async function findReturnableOrder(
  fs: Firestore, tenantId: string, key: string
): Promise<{ order?: ReturnableOrder; error?: string }> {
  const raw = key.trim();
  const token = parseOrderQr(raw);

  if (token || raw.includes('.')) {
    const snap = await getDocs(query(orderCol(fs, tenantId), where('qrToken', '==', token ?? raw), limit(1)));
    if (snap.empty) return { error: 'No order matches that code.' };
    const order = { ...(snap.docs[0].data() as RetailOrder), id: snap.docs[0].id };
    if (!RETURNABLE_STAGES.includes(order.stage)) {
      return { error: `Order #${order.orderNumber} hasn't been fulfilled yet — nothing to return.` };
    }
    return { order };
  }

  const num = parseInt(raw.replace(/^#/, ''), 10);
  if (!Number.isFinite(num)) return { error: 'Scan the pickup QR or enter an order number.' };
  const snap = await getDocs(query(orderCol(fs, tenantId), where('orderNumber', '==', num)));
  const match = snap.docs
    .map((d: any) => ({ ...(d.data() as RetailOrder), id: d.id as string }))
    .find((o: ReturnableOrder) => RETURNABLE_STAGES.includes(o.stage));
  if (!match) return { error: `No fulfilled order #${num} found.` };
  return { order: match };
}

/* ════════════════════════════════════════════════════════════════════════════
 * OPEN
 * ════════════════════════════════════════════════════════════════════════════ */

export interface ReturnSelection { lineId: string; qty: number; reason: ReturnReason; }

export async function openReturn(
  fs: Firestore, tenantId: string, order: ReturnableOrder,
  selections: ReturnSelection[], resolution: ReturnResolution, notes: string, actor: Actor
): Promise<{ ok: boolean; message: string; returnId?: string }> {
  if (selections.length === 0 || selections.every((s) => s.qty <= 0)) {
    return { ok: false, message: 'Pick at least one item to return.' };
  }

  const lines: ReturnLine[] = [];
  for (const sel of selections.filter((s) => s.qty > 0)) {
    const orig = order.lines.find((l) => l.lineId === sel.lineId);
    if (!orig) return { ok: false, message: 'Line not found on the order.' };
    const returnable = orig.qtyOrdered - orig.qtyShorted - orig.qtyReturned;
    if (sel.qty > returnable) {
      return { ok: false, message: `Only ${returnable} of ${orig.name} can still be returned.` };
    }
    // FINAL SALE. Checked here and not only in the UI, because a screen that
    // hides a button is not a rule — the storefront, the returns board and
    // anything built later all come through this function. A fault reason
    // (damaged, defective, wrong item) passes regardless: final sale means no
    // returns for a change of mind, not no recourse when the shop got it
    // wrong, and telling someone otherwise about a wrong item is how a return
    // becomes a chargeback.
    const eligible = canReturnLine(orig as any, sel.reason);
    if (!eligible.allowed) {
      return { ok: false, message: eligible.message || `${orig.name} cannot be returned.` };
    }
    lines.push({ lineId: orig.lineId, sku: orig.sku, name: orig.name, qty: sel.qty, reason: sel.reason });
  }

  const retRef = doc(returnCol(fs, tenantId));
  const now = new Date().toISOString();
  const refundCents = resolution === 'refund' ? returnRefundCents(order, lines) : 0;
  const creditCents = resolution === 'store_credit' ? returnRefundCents(order, lines) : 0;

  try {
    await runTransaction(fs, async (txn) => {
      const ret: RetailReturn = {
        id: retRef.id, tenantId, orderId: order.id, orderNumber: order.orderNumber,
        lines, resolution, status: 'open', photoUrls: [],
        refundCents: refundCents || undefined, storeCreditCents: creditCents || undefined,
        openedBy: actor.name, openedAt: now, notes: notes || undefined,
      };
      txn.set(retRef, JSON.parse(JSON.stringify(ret)));
      txn.set(doc(collection(doc(orderCol(fs, tenantId), order.id), 'events')),
        evPayload('return_opened', actor, { returnId: retRef.id, units: lines.reduce((a, l) => a + l.qty, 0) }));
    });
    return { ok: true, message: `Return opened for order #${order.orderNumber}`, returnId: retRef.id };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not open the return.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * RECEIVE — scan-verified disposition per line
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Apply a disposition to a scanned line. Inventory truth:
 *   restock  → units go back on the shelf: new FIFO batch at the item's
 *              current cost + stockCorrection (+qty)
 *   write_off → units were already deducted at sale and never re-enter stock:
 *              NO stock change; a Spoilage expense records the loss
 * Also increments qtyReturned on the original order line.
 */
export async function receiveReturnLine(
  fs: Firestore, tenantId: string, ret: ReturnDoc, lineId: string,
  disposition: ReturnDisposition, actor: Actor
): Promise<{ ok: boolean; allReceived?: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const rRef = doc(returnCol(fs, tenantId), ret.id);
      const rSnap = await txn.get(rRef);
      if (!rSnap.exists()) return { ok: false, message: 'Return not found.' };
      const fresh = rSnap.data() as RetailReturn;
      if (fresh.status === 'resolved' || fresh.status === 'rejected') {
        return { ok: false, message: 'This return is already closed.' };
      }
      const line = fresh.lines.find((l) => l.lineId === lineId);
      if (!line) return { ok: false, message: 'Line not found on the return.' };
      if (line.disposition) return { ok: false, message: `${line.name} already dispositioned (${line.disposition}).` };

      const oRef = doc(orderCol(fs, tenantId), fresh.orderId);
      const oSnap = await txn.get(oRef);
      const order = oSnap.exists() ? (oSnap.data() as RetailOrder) : null;
      const origLine = order?.lines.find((l) => l.lineId === lineId);

      const iRef = origLine ? invDoc(fs, tenantId, origLine.productId) : null;
      const iSnap = iRef ? await txn.get(iRef) : null;

      const now = new Date().toISOString();

      if (disposition === 'restock' && iRef && iSnap?.exists()) {
        const item = iSnap.data() as any;
        const batches = [...(item.batches || []), {
          id: `batch-${nanoid()}`, stock: line.qty,
          costPerUnit: item.costPerUnit || 0, receivedDate: now,
        }];
        txn.update(iRef, {
          batches: JSON.parse(JSON.stringify(batches)),
          totalStock: batches.reduce((a: number, b: any) => a + (b.stock || 0), 0),
        });
        txn.set(doc(collection(fs, `tenants/${tenantId}/stockCorrections`)), {
          productId: origLine!.productId, date: now, change: line.qty,
          unit: item.unit || 'units',
          reason: `Return restocked (Order #${fresh.orderNumber})`,
          orderId: fresh.orderId, returnId: ret.id,
          actorId: actor.id, actorName: actor.name, source: 'retail_engine',
        });
      }

      if (['write_off', 'damaged', 'dispose'].includes(disposition) && origLine) {
        const costCents = Math.round(((iSnap?.exists() ? (iSnap.data() as any).costPerUnit : 0) || 0) * 100) * line.qty;
        const txnRef = doc(collection(fs, `tenants/${tenantId}/transactions`));
        txn.set(txnRef, {
          id: txnRef.id, date: now,
          description: `Return ${disposition === 'dispose' ? 'disposal' : disposition === 'damaged' ? 'damage write-off' : 'write-off'}: ${line.qty} x ${line.name} (Order #${fresh.orderNumber})`,
          clientOrVendor: 'Internal', type: 'expense', context: 'Business',
          category: 'Spoilage', taxBucket: 'expense',
          amount: costCents / 100, paymentMethod: 'Internal', hasReceipt: false,
          retailOrderId: fresh.orderId, retailReturnId: ret.id, tenantId,
        });
      }

      const updatedLines = fresh.lines.map((l) =>
        l.lineId === lineId ? { ...l, disposition, dispositionScannedAt: now } : l
      );
      const allReceived = updatedLines.every((l) => !!l.disposition);
      txn.update(rRef, { lines: JSON.parse(JSON.stringify(updatedLines)), status: 'received' });

      if (order && origLine) {
        const newLines = order.lines.map((l) => {
          if (l.lineId !== lineId) return l;
          const qtyReturned = (l.qtyReturned || 0) + line.qty;
          const fullyReturned = qtyReturned >= l.qtyOrdered - l.qtyShorted;
          return { ...l, qtyReturned, status: fullyReturned ? ('returned' as const) : l.status };
        });
        txn.update(oRef, { lines: JSON.parse(JSON.stringify(newLines)) });
      }

      return { ok: true, allReceived, message: `${line.name}: ${disposition === 'restock' ? 'back in stock' : 'written off'}${allReceived ? ' \u2014 that was the last item' : ''}` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not receive the line.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * RESOLVE — refund / replacement / store credit
 * ════════════════════════════════════════════════════════════════════════════ */

export async function resolveReturn(
  fs: Firestore, tenantId: string, ret: ReturnDoc, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  let issuedCreditId: string | null = null;
  try {
    const result = await runTransaction(fs, async (txn) => {
      const rRef = doc(returnCol(fs, tenantId), ret.id);
      const rSnap = await txn.get(rRef);
      if (!rSnap.exists()) return { ok: false, message: 'Return not found.' };
      const fresh = { ...(rSnap.data() as RetailReturn), id: ret.id };
      if (fresh.status === 'resolved') return { ok: false, message: 'Already resolved.' };

      const gate = isReturnReceivable(fresh);
      if (!gate.ok) return { ok: false, message: gate.reason };

      const oRef = doc(orderCol(fs, tenantId), fresh.orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Original order missing.' };
      const order = { ...(oSnap.data() as RetailOrder), id: fresh.orderId };

      const now = new Date().toISOString();
      let summary = '';

      /* THE LABEL SETTLES HERE. If the policy deducted return shipping, it
       * comes off the money now — and by the time a return is being resolved
       * the label was demonstrably USED (the items arrived on it), so the
       * Shippo billed-on-scan economics and the deduction agree. If the shop
       * paid, the label cost becomes a real Shipping expense so the return
       * tells the whole P&L truth (item cost is already Spoilage per line;
       * Stripe fees are exact-tracked by the charge webhooks). */
      const labelDeduct = Math.max(0, Number((fresh as any).labelDeductCents) || 0);
      const labelCost = Math.max(0, Number((fresh as any).labelCostCents) || 0);
      const unitsBack = fresh.lines.reduce((a, l) => a + (l.disposition ? l.qty : 0), 0);

      if (labelCost > 0 && labelDeduct === 0) {
        const shipTxnRef = doc(collection(fs, `tenants/${tenantId}/transactions`));
        txn.set(shipTxnRef, {
          id: shipTxnRef.id, date: now,
          description: `Return shipping label (Order #${fresh.orderNumber})`,
          clientOrVendor: (fresh as any).labelCarrier || 'Carrier',
          type: 'expense', context: 'Business', category: 'Shipping', taxBucket: 'expense',
          amount: labelCost / 100, paymentMethod: 'Shippo', hasReceipt: false,
          retailOrderId: fresh.orderId, retailReturnId: ret.id, tenantId,
        });
      }

      if (fresh.resolution === 'refund') {
        const gross = fresh.refundCents || 0;
        const cents = Math.max(0, gross - labelDeduct);
        txn.update(oRef, { pendingRefundCents: (order.pendingRefundCents || 0) + cents });
        summary = `Refund of $${(cents / 100).toFixed(2)} queued${labelDeduct ? ` ($${(labelDeduct / 100).toFixed(2)} return shipping deducted)` : ''} — execute in Stripe, then Mark refunded on the board`;
      }

      if (fresh.resolution === 'store_credit') {
        const gross = fresh.storeCreditCents || 0;
        const cents = Math.max(0, gross - labelDeduct);
        const creditRef = doc(collection(fs, `tenants/${tenantId}/depositCredits`));
        issuedCreditId = creditRef.id;
        txn.set(creditRef, {
          id: creditRef.id, tenantId,
          clientId: order.clientId || null,
          clientEmail: (order.customerEmail || '').toLowerCase().trim(),
          clientName: order.customerName || 'Guest',
          amountCents: cents, status: 'available',
          sourceRetailReturnId: ret.id, createdAt: now,
        });
        summary = `$${(cents / 100).toFixed(2)} store credit issued${labelDeduct ? ` ($${(labelDeduct / 100).toFixed(2)} return shipping deducted)` : ''} — spendable at POS checkout`;
      }

      if (fresh.resolution === 'replacement') {
        const childRef = doc(orderCol(fs, tenantId));
        const replLines = fresh.lines
          .filter((l) => l.disposition) // every unit was verified
          .map((l) => {
            const orig = order.lines.find((x) => x.lineId === l.lineId)!;
            return {
              ...orig, lineId: `line-${nanoid(8)}`, qtyOrdered: l.qty,
              qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending', shortReason: '',
            };
          });
        txn.set(childRef, JSON.parse(JSON.stringify({
          id: childRef.id, tenantId, orderNumber: order.orderNumber,
          stage: 'paid', method: order.method, priceTier: order.priceTier || 'retail',
          businessName: order.businessName || '', poNumber: order.poNumber || '',
          lines: replLines,
          subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0, totalCents: 0,
          customerName: order.customerName, customerEmail: order.customerEmail,
          customerPhone: order.customerPhone || '',
          shippingAddress: order.shippingAddress || null,
          parentOrderId: order.id, isReplacement: true,
          qrToken: order.qrToken || null,
          placedAt: now, paidAt: now,
        })));
        txn.set(doc(collection(oRef, 'events')), evPayload('replacement_created', actor, { childOrderId: childRef.id }));
        summary = 'Replacement order created — it goes through the same scan gates';
      }

      txn.update(rRef, { status: 'resolved', resolvedBy: actor.name, resolvedAt: now });
      txn.set(oRef, {
        returnSummary: {
          returnId: ret.id, resolution: fresh.resolution, resolvedAt: now,
          unitsReturned: unitsBack,
          refundCents: fresh.resolution === 'refund' ? Math.max(0, (fresh.refundCents || 0) - labelDeduct) : 0,
          creditCents: fresh.resolution === 'store_credit' ? Math.max(0, (fresh.storeCreditCents || 0) - labelDeduct) : 0,
          labelDeductCents: labelDeduct,
        },
      }, { merge: true });
      txn.set(doc(collection(oRef, 'events')),
        evPayload('return_resolved', actor, { returnId: ret.id, resolution: fresh.resolution }));

      return { ok: true, message: summary || 'Return resolved' };
    });

    /* THE CUSTOMER FINDS OUT — every arm, one email. return-notify tells
     * them their items were received and exactly what happened: refund amount
     * on its way, credit issued with their new balance (it claims the
     * credit's grantEmailAt itself, so the grant email never doubles), or the
     * replacement shipment that's now in the queue. Fire-and-forget: the
     * resolution is committed either way, and the route dedupes on the
     * return doc so a retry can't double-send. */
    if (result.ok) {
      void fetch('/api/retail/return-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, returnId: ret.id }),
      }).catch(() => undefined);
    }
    return result;
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not resolve the return.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * REFUND CLOSURE — the board's "Mark refunded" action
 * ════════════════════════════════════════════════════════════════════════════ */

/** After executing the refund in Stripe, close the loop on the order. */
export async function markRefundExecuted(
  fs: Firestore, tenantId: string, orderId: string, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const oRef = doc(orderCol(fs, tenantId), orderId);
      const oSnap = await txn.get(oRef);
      if (!oSnap.exists()) return { ok: false, message: 'Order not found.' };
      const order = oSnap.data() as RetailOrder;
      const cents = order.pendingRefundCents || 0;
      if (cents <= 0) return { ok: false, message: 'No refund pending on this order.' };

      txn.update(oRef, {
        pendingRefundCents: 0,
        refundedCents: (order.refundedCents || 0) + cents,
      });
      txn.set(doc(collection(oRef, 'events')), evPayload('refund_issued', actor, {
        amountCents: cents, scope: cents >= order.totalCents ? 'full' : 'partial',
      }));

      const txnRef = doc(collection(fs, `tenants/${tenantId}/transactions`));
      txn.set(txnRef, {
        id: txnRef.id, date: new Date().toISOString(),
        description: `Refund executed — Order #${order.orderNumber}`,
        clientOrVendor: order.customerName || 'Guest',
        type: 'expense', context: 'Business', category: 'Refund', taxBucket: 'refund',
        amount: cents / 100, paymentMethod: 'Card (Online)', hasReceipt: true,
        retailOrderId: orderId, tenantId,
      });
      return { ok: true, message: `$${(cents / 100).toFixed(2)} refund recorded` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not record the refund.' };
  }
}
