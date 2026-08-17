'use client';

// ─── Inventory Exceptions: the spine ─────────────────────────────────────────
// Every unit that leaves the business without producing its expected value
// gets ONE record here — the spec's core principle: inventory never simply
// disappears as an adjustment. An exception carries the full triple:
//
//   landed cost   — what the unit actually cost (the only number that ever
//                   reaches the accounting ledger; the writers that put it
//                   there link back via ledgerTxnId so the same loss can
//                   never be recognised twice)
//   retail value  — what it would have sold for (analytics, never a deduction)
//   lost margin   — retail minus landed (analytics)
//
// plus the reason (from the taxonomy below), the responsible party, links to
// the order/return/claim it came from, and a recovery stamp that Round N2's
// Recovery Queue will advance. Deterministic ids make every writer
// idempotent: the same source event can fire twice and produce one record.

import {
  collection, doc, getDoc, runTransaction, setDoc, type Firestore,
} from 'firebase/firestore';

// ─── Reason taxonomy (spec's codes, grouped) ─────────────────────────────────

export const EXCEPTION_REASONS = {
  customer: {
    return_opened: 'Customer return — opened, non-resellable',
    return_damaged: 'Customer return — damaged',
    return_contaminated: 'Customer return — contaminated/disposed',
    refused_delivery: 'Customer refused delivery',
    reported_missing: 'Customer reported missing item',
    reported_damaged: 'Customer reported damaged item',
    reported_leaking: 'Customer reported leaking product',
    wrong_quantity: 'Customer received incorrect quantity',
    refund_without_return: 'Customer refund without return',
  },
  carrier: {
    carrier_lost: 'Carrier lost shipment',
    carrier_damaged: 'Carrier damaged shipment',
    carrier_destroyed: 'Carrier destroyed shipment',
    carrier_returned: 'Carrier returned shipment',
    delivery_exception: 'Delivery exception',
    stolen_after_delivery: 'Package stolen after delivery',
    tracking_discrepancy: 'Tracking discrepancy',
  },
  supplier: {
    supplier_defect: 'Supplier defect',
    supplier_shortage: 'Supplier shortage',
    supplier_wrong_product: 'Supplier sent wrong product',
    inbound_damage: 'Damaged during inbound shipping',
    manufacturing_defect: 'Manufacturing defect',
  },
  internal: {
    warehouse_damage: 'Warehouse damage',
    picking_damage: 'Picking damage',
    packing_damage: 'Packing damage',
    employee_damage: 'Employee damage',
    count_discrepancy: 'Inventory count discrepancy',
    missing_inventory: 'Missing inventory',
    theft_shrinkage: 'Theft / shrinkage',
    sample_tester: 'Sample / tester',
    quality_testing: 'Quality-control testing',
    internal_use: 'Internal use',
    promo_giveaway: 'Promotional giveaway',
    expired: 'Expired inventory',
    obsolete: 'Obsolete inventory',
    recall: 'Product recall',
    packaging_failure: 'Packaging failure / leakage',
    environmental: 'Temperature / environmental damage',
    wrong_item_shipped: 'Wrong product shipped',
  },
} as const;

export type ExceptionGroup = keyof typeof EXCEPTION_REASONS;
export type ExceptionReason = {
  [G in ExceptionGroup]: keyof (typeof EXCEPTION_REASONS)[G]
}[ExceptionGroup];

export function reasonGroup(reason: string): ExceptionGroup {
  for (const g of Object.keys(EXCEPTION_REASONS) as ExceptionGroup[]) {
    if (reason in EXCEPTION_REASONS[g]) return g;
  }
  return 'internal';
}
export function reasonLabel(reason: string): string {
  const g = reasonGroup(reason);
  return (EXCEPTION_REASONS[g] as Record<string, string>)[reason] || reason;
}

/** Reasons where someone other than the business may owe money — Round N2's
 *  Recovery Queue starts from these. Customer returns are not recoverable;
 *  carrier and supplier losses are. */
const RECOVERY_CANDIDATES = new Set<string>([
  'carrier_lost', 'carrier_damaged', 'carrier_destroyed', 'stolen_after_delivery',
  'supplier_defect', 'supplier_shortage', 'supplier_wrong_product',
  'inbound_damage', 'manufacturing_defect',
]);

// ─── The triple ──────────────────────────────────────────────────────────────

export function exceptionTriple(args: {
  qty: number;
  costPerUnitDollars?: number | null;   // inventory item.costPerUnit (dollars)
  retailPerUnitCents?: number | null;   // the sale's unitPriceCents when known
}): { landedCostCents: number; retailCents: number; marginCents: number; costed: boolean } {
  const qty = Math.max(0, Number(args.qty) || 0);
  const perCost = Math.round(((Number(args.costPerUnitDollars) || 0)) * 100);
  const perRetail = Math.max(0, Number(args.retailPerUnitCents) || 0);
  const landedCostCents = perCost * qty;
  const retailCents = perRetail * qty;
  return {
    landedCostCents,
    retailCents,
    marginCents: Math.max(0, retailCents - landedCostCents),
    costed: perCost > 0,
  };
}

// ─── The record ──────────────────────────────────────────────────────────────

export interface InventoryExceptionInput {
  /** Deterministic id from the source event (e.g. ret-{returnId}-{lineId},
   *  claim-{claimId}) — the idempotence and double-count guard in one. */
  dedupeId: string;
  reason: string;
  qty: number;
  productId?: string | null;
  sku?: string | null;
  name: string;
  costPerUnitDollars?: number | null;
  retailPerUnitCents?: number | null;
  orderId?: string | null;
  orderNumber?: number | null;
  returnId?: string | null;
  claimId?: string | null;
  replacementOrderId?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  responsibleParty: 'customer' | 'carrier' | 'supplier' | 'internal' | 'unknown';
  /** The ledger transaction that recognised the landed cost, when one was
   *  written — the anti-double-deduction link. Absent = not yet ledgered. */
  ledgerTxnId?: string | null;
  note?: string | null;
  photoUrls?: string[];
  recordedBy: { id: string; name: string };
  source: 'returns_desk' | 'claims_desk' | 'manual';
}

export function buildExceptionDoc(input: InventoryExceptionInput, tenantId: string) {
  const triple = exceptionTriple(input);
  return {
    id: input.dedupeId,
    tenantId,
    at: new Date().toISOString(),
    reason: input.reason,
    reasonGroup: reasonGroup(input.reason),
    qty: Math.max(0, Number(input.qty) || 0),
    productId: input.productId || null,
    sku: input.sku || null,
    name: String(input.name || 'Item').slice(0, 160),
    landedCostCents: triple.landedCostCents,
    retailCents: triple.retailCents,
    marginCents: triple.marginCents,
    costed: triple.costed,
    orderId: input.orderId || null,
    orderNumber: input.orderNumber ?? null,
    returnId: input.returnId || null,
    claimId: input.claimId || null,
    replacementOrderId: input.replacementOrderId || null,
    trackingNumber: input.trackingNumber || null,
    carrier: input.carrier || null,
    responsibleParty: input.responsibleParty,
    ledgerTxnId: input.ledgerTxnId || null,
    note: input.note ? String(input.note).slice(0, 600) : null,
    photoUrls: Array.isArray(input.photoUrls) ? input.photoUrls.slice(0, 8) : [],
    recordedBy: { id: input.recordedBy.id, name: input.recordedBy.name },
    source: input.source,
    recovery: {
      status: RECOVERY_CANDIDATES.has(input.reason) ? 'candidate' : 'none',
      claimAmountCents: 0,
      recoveredCents: 0,
    },
    accountingStatus: input.ledgerTxnId ? 'ledgered' : 'recorded',
  };
}

/** Write an exception outside a transaction (claims desk, manual). Skips
 *  cleanly if the deterministic id already exists — a re-fired source event
 *  produces exactly one record. */
export async function recordInventoryException(
  fs: Firestore, tenantId: string, input: InventoryExceptionInput,
): Promise<{ ok: boolean; created: boolean; message?: string }> {
  try {
    const ref = doc(collection(fs, `tenants/${tenantId}/inventoryExceptions`), input.dedupeId);
    const existing = await getDoc(ref);
    if (existing.exists()) return { ok: true, created: false };
    await setDoc(ref, JSON.parse(JSON.stringify(buildExceptionDoc(input, tenantId))));
    return { ok: true, created: true };
  } catch (e: any) {
    return { ok: false, created: false, message: e?.message || 'Could not record the exception.' };
  }
}


// ─── Round N2: the Recovery Queue lifecycle ──────────────────────────────────
// A carrier or supplier loss is money someone else may owe. The lifecycle is
// deliberately small and every transition is APPENDED to recovery.events —
// offsets never erase, exactly like the order event log. Recovered money
// writes a ledger INCOME line ('Loss recovery') that stands NEXT TO the
// original Spoilage expense, never instead of it: the loss happened, the
// reimbursement happened, and the books show both. netLoss = landed −
// recovered is computed truth, not a stored opinion.

export type RecoveryStatus = 'none' | 'candidate' | 'filed' | 'approved' | 'denied' | 'abandoned' | 'paid';
export type RecoveryAction = 'file' | 'approve' | 'deny' | 'abandon' | 'payment';

const RECOVERY_TRANSITIONS: Record<RecoveryAction, RecoveryStatus[]> = {
  file: ['candidate'],
  approve: ['filed'],
  deny: ['filed', 'approved'],
  abandon: ['candidate', 'filed'],
  payment: ['filed', 'approved', 'paid'], // partial payments accumulate
};

export function recoveryNetLossCents(exc: { landedCostCents?: number; recovery?: { recoveredCents?: number } }): number {
  return Math.max(0, (Number(exc.landedCostCents) || 0) - (Number(exc.recovery?.recoveredCents) || 0));
}

export function deadlineState(exc: any, now = Date.now()): 'none' | 'ok' | 'soon' | 'overdue' {
  const d = exc?.recovery?.deadlineAt ? Date.parse(String(exc.recovery.deadlineAt)) : NaN;
  if (!Number.isFinite(d)) return 'none';
  if (exc?.recovery?.status !== 'filed') return 'none';
  if (d < now) return 'overdue';
  if (d - now < 7 * 86400000) return 'soon';
  return 'ok';
}

export async function advanceRecovery(
  fs: Firestore, tenantId: string, excId: string,
  action: RecoveryAction,
  payload: { amountCents?: number; refNumber?: string; deadlineAt?: string | null; note?: string },
  actor: { id: string; name: string },
): Promise<{ ok: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const ref = doc(collection(fs, `tenants/${tenantId}/inventoryExceptions`), excId);
      const snap = await txn.get(ref);
      if (!snap.exists()) return { ok: false, message: 'Exception not found.' };
      const exc = snap.data() as any;
      const rec = { ...(exc.recovery || { status: 'none', claimAmountCents: 0, recoveredCents: 0 }) };
      const from: RecoveryStatus = rec.status || 'none';

      if (!RECOVERY_TRANSITIONS[action].includes(from)) {
        return { ok: false, message: `Can't ${action} a ${String(from).replace('_', ' ')} recovery.` };
      }

      const now = new Date().toISOString();
      const events = Array.isArray(rec.events) ? [...rec.events] : [];
      const note = payload.note ? String(payload.note).slice(0, 400) : null;

      if (action === 'file') {
        const amount = Math.max(0, Math.round(Number(payload.amountCents) || 0)) || (Number(exc.landedCostCents) || 0);
        rec.status = 'filed';
        rec.claimAmountCents = amount;
        rec.refNumber = payload.refNumber ? String(payload.refNumber).slice(0, 60) : null;
        rec.filedAt = now;
        rec.deadlineAt = payload.deadlineAt || null;
        events.push({ at: now, by: actor.name, action: 'file', amountCents: amount, ...(rec.refNumber ? { refNumber: rec.refNumber } : {}), ...(note ? { note } : {}) });
      } else if (action === 'approve') {
        rec.status = 'approved';
        events.push({ at: now, by: actor.name, action: 'approve', ...(note ? { note } : {}) });
      } else if (action === 'deny') {
        rec.status = 'denied';
        events.push({ at: now, by: actor.name, action: 'deny', ...(note ? { note } : {}) });
      } else if (action === 'abandon') {
        rec.status = 'abandoned';
        events.push({ at: now, by: actor.name, action: 'abandon', ...(note ? { note } : {}) });
      } else if (action === 'payment') {
        const amount = Math.max(0, Math.round(Number(payload.amountCents) || 0));
        if (amount <= 0) return { ok: false, message: 'Enter the amount that actually arrived.' };
        rec.recoveredCents = Math.max(0, Number(rec.recoveredCents) || 0) + amount;
        rec.status = 'paid';
        rec.lastPaymentAt = now;
        events.push({ at: now, by: actor.name, action: 'payment', amountCents: amount, ...(note ? { note } : {}) });

        /* The income line — the offset that never erases. Linked both ways
         * so reconciliation can pair every recovery with its loss. */
        const txnRef = doc(collection(fs, `tenants/${tenantId}/transactions`));
        txn.set(txnRef, {
          id: txnRef.id, date: now,
          description: `Loss recovery: ${exc.name}${exc.orderNumber != null ? ` (Order #${String(exc.orderNumber).padStart(4, '0')})` : ''}${rec.refNumber ? ` · ref ${rec.refNumber}` : ''}`,
          clientOrVendor: exc.carrier || (exc.responsibleParty === 'supplier' ? 'Supplier' : 'Carrier'),
          type: 'income', context: 'Business',
          category: 'Loss recovery', taxBucket: 'income',
          amount: amount / 100, paymentMethod: 'External', hasReceipt: false,
          inventoryExceptionId: excId, tenantId,
        });
        rec.lastRecoveryTxnId = txnRef.id;
      }

      rec.events = events;
      txn.update(ref, { recovery: JSON.parse(JSON.stringify(rec)) });
      const netAfter = Math.max(0, (Number(exc.landedCostCents) || 0) - (Number(rec.recoveredCents) || 0));
      return {
        ok: true,
        message: action === 'payment'
          ? `$${((Number(payload.amountCents) || 0) / 100).toFixed(2)} recorded — net loss now $${(netAfter / 100).toFixed(2)}`
          : action === 'file' ? 'Claim filed — the deadline clock is running'
          : `Recovery ${rec.status}`,
      };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not update the recovery.' };
  }
}
