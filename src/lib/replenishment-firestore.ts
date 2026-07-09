/**
 * Firestore Transaction Wrapper for Staff Replenishment
 * --------------------------------------------------------
 * This is the ONLY file that should call runTransaction/writeBatch for the
 * staff custody & replenishment system. Everything here delegates the
 * actual business logic to lib/replenishment-system.ts (pure functions,
 * no Firestore) and only handles: reading current state, calling the pure
 * function, and committing every resulting write atomically.
 *
 * Path: lib/replenishment-firestore.ts
 */

import {
  runTransaction,
  doc,
  collection,
  Firestore,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';
import {
  type InventoryItem,
  type Staff,
  type StockCorrection,
  type AssetUnit,
  type AssetScanEvent,
  type StationAllocation,
  type StaffReplenishmentRequest,
  type OverflowEvent,
} from '@/lib/data';
import {
  approveReplenishment,
  denyReplenishment,
  logServiceUsage,
  getUnresolvedOverflowsForStaff,
  resolveOverflowEvent as resolveOverflowEventPure,
  recordAssetScan,
  isManager,
} from '@/lib/replenishment-system';

// ---------- Submitting a request (staff-facing) ----------

/**
 * Solo providers have no one else to approve their own requests — the
 * approval queue becomes pointless friction, not a safeguard, when the
 * requester and the only possible approver are the same person. Rather
 * than a separate code path, solo tenants auto-approve through the exact
 * same approveReplenishment() logic — same validation, same stock
 * deduction, same stockCorrection audit entry — just without a human
 * waiting in a queue first.
 */
export function shouldAutoApprove(tenant: { subscriptionTier?: string }): boolean {
  return tenant.subscriptionTier === 'solo';
}

/**
 * Staff member submits a replenishment request. No stock movement here —
 * just creates the pending request document. A plain write, not a
 * transaction, since nothing else is read/written alongside it.
 *
 * If the tenant is solo-tier, call approveReplenishmentRequestTx()
 * immediately after this returns, using the requester themself as the
 * approvingManager — see submitAndAutoApproveIfSolo() below for the
 * combined helper.
 */
export async function submitReplenishmentRequest(
  firestore: Firestore,
  tenantId: string,
  params: {
    itemId: string;
    itemName: string;
    staffId: string;
    staffName: string;
    stationId: string;
    quantityRequested: number;
  }
): Promise<StaffReplenishmentRequest> {
  const request: StaffReplenishmentRequest = {
    id: `replreq-${nanoid()}`,
    tenantId,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    ...params,
  };

  const ref = doc(firestore, 'tenants', tenantId, 'staffReplenishmentRequests', request.id);
  await import('firebase/firestore').then(({ setDoc }) => setDoc(ref, request));
  return request;
}

// ---------- Approving a request (manager-facing) ----------

export type ApproveResult = { success: true } | { success: false; error: string };

/**
 * Atomically: reads the request/item/allocation/overflow state, calls the
 * pure approveReplenishment() logic, and commits every resulting write
 * (item, allocation, request, stockCorrection) in one transaction. If
 * anything fails validation (not pending, unresolved overflows, insufficient
 * stock, not a manager), NOTHING is written — the transaction throws before
 * any commit.
 */
export async function approveReplenishmentRequestTx(
  firestore: Firestore,
  tenantId: string,
  requestId: string,
  approvingManager: Staff,
  /**
   * This staff member's unresolved OverflowEvents, computed by the caller
   * BEFORE calling this function (e.g. filter InventoryContext's
   * `overflowEvents` client-side) — Firestore transactions cannot run
   * arbitrary queries, only get()s on known doc refs, so this can't be
   * fetched from inside the transaction itself.
   */
  unresolvedOverflows: OverflowEvent[]
): Promise<ApproveResult> {
  try {
    await runTransaction(firestore, async (tx) => {
      const requestRef = doc(firestore, 'tenants', tenantId, 'staffReplenishmentRequests', requestId);
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists()) throw new Error('Replenishment request not found.');
      const request = requestSnap.data() as StaffReplenishmentRequest;

      const itemRef = doc(firestore, 'tenants', tenantId, 'inventory', request.itemId);
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists()) throw new Error('Inventory item not found.');
      const item = itemSnap.data() as InventoryItem;

      // Find any existing allocation for this staff+item+station. Since
      // Firestore transactions can't run arbitrary queries, the allocation
      // doc id is deterministic: alloc-{staffId}-{itemId}-{stationId}.
      const allocationId = `alloc-${request.staffId}-${request.itemId}-${request.stationId}`;
      const allocationRef = doc(firestore, 'tenants', tenantId, 'stationAllocations', allocationId);
      const allocationSnap = await tx.get(allocationRef);
      const currentAllocation = allocationSnap.exists() ? (allocationSnap.data() as StationAllocation) : null;

      const result = approveReplenishment({
        request,
        item,
        currentAllocation,
        approvingManager,
        unresolvedOverflows,
      });

      if (!result.success) {
        throw new Error(result.error || 'Approval failed.');
      }

      tx.update(itemRef, result.updatedItem as any);
      tx.set(allocationRef, result.updatedAllocation as any);
      tx.update(requestRef, result.updatedRequest as any);

      if (result.stockCorrection) {
        const correctionRef = doc(collection(firestore, 'tenants', tenantId, 'stockCorrections'));
        tx.set(correctionRef, { id: correctionRef.id, ...result.stockCorrection } as StockCorrection);
      }
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Unknown error approving replenishment.' };
  }
}

/**
 * Fetch this staff member's unresolved overflow events BEFORE calling
 * approveReplenishmentRequestTx, since transactions can't run queries.
 * Pass the result in via the caller's own query (e.g. from InventoryContext's
 * `overflowEvents` array, filtered client-side) rather than re-fetching here.
 */
export function getUnresolvedOverflowsForStaffLive(
  allOverflowEvents: OverflowEvent[],
  staffId: string
): OverflowEvent[] {
  return getUnresolvedOverflowsForStaff(allOverflowEvents, staffId);
}

/** Manager denies a request — simple update, no transaction needed (single doc write). */
export async function denyReplenishmentRequestTx(
  firestore: Firestore,
  tenantId: string,
  request: StaffReplenishmentRequest,
  denyingManager: Staff,
  reason: string
): Promise<ApproveResult> {
  if (!isManager(denyingManager)) {
    return { success: false, error: 'Only admin or owner roles can deny replenishment requests.' };
  }
  try {
    const updated = denyReplenishment(request, denyingManager, reason);
    const { updateDoc } = await import('firebase/firestore');
    const ref = doc(firestore, 'tenants', tenantId, 'staffReplenishmentRequests', request.id);
    await updateDoc(ref, updated as any);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Unknown error denying replenishment.' };
  }
}

// ---------- Logging service usage (deducts from station float) ----------

export type LogUsageResult = { success: true } | { success: false; error: string };

/**
 * Atomically deducts consumed product from the staff's station allocation
 * (falling back to main stock + an OverflowEvent if the station is short).
 * Call this from checkout/service-completion for items with
 * trackingMode === 'bulk'. For items without trackingMode set, keep using
 * the existing handleLogUseConfirm direct-deduction path instead — this
 * function assumes an allocation document already exists.
 */
export async function logServiceUsageTx(
  firestore: Firestore,
  tenantId: string,
  params: {
    itemId: string;
    staffId: string;
    stationId: string;
    staffName: string;
    quantityUsed: number;
  }
): Promise<LogUsageResult> {
  try {
    await runTransaction(firestore, async (tx) => {
      const itemRef = doc(firestore, 'tenants', tenantId, 'inventory', params.itemId);
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists()) throw new Error('Inventory item not found.');
      const item = itemSnap.data() as InventoryItem;

      const allocationId = `alloc-${params.staffId}-${params.itemId}-${params.stationId}`;
      const allocationRef = doc(firestore, 'tenants', tenantId, 'stationAllocations', allocationId);
      const allocationSnap = await tx.get(allocationRef);
      if (!allocationSnap.exists()) {
        throw new Error('No station allocation found — staff must be replenished before use can be logged.');
      }
      const allocation = allocationSnap.data() as StationAllocation;

      const result = logServiceUsage({
        item,
        allocation,
        staffName: params.staffName,
        quantityUsed: params.quantityUsed,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to log service usage.');
      }

      tx.update(allocationRef, result.updatedAllocation as any);

      if (result.updatedItem) {
        tx.update(itemRef, result.updatedItem as any);
      }

      if (result.overflowEvent) {
        const overflowRef = doc(firestore, 'tenants', tenantId, 'overflowEvents', result.overflowEvent.id);
        tx.set(overflowRef, result.overflowEvent as any);
      }

      if (result.stockCorrection) {
        const correctionRef = doc(collection(firestore, 'tenants', tenantId, 'stockCorrections'));
        tx.set(correctionRef, { id: correctionRef.id, ...result.stockCorrection } as StockCorrection);
      }
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Unknown error logging service usage.' };
  }
}

// ---------- Resolving overflow flags (manager-facing) ----------

export async function resolveOverflowEventTx(
  firestore: Firestore,
  tenantId: string,
  event: OverflowEvent,
  resolvingManager: Staff,
  resolutionNote: string
): Promise<ApproveResult> {
  if (!isManager(resolvingManager)) {
    return { success: false, error: 'Only admin or owner roles can resolve overflow flags.' };
  }
  try {
    const updated = resolveOverflowEventPure(event, resolvingManager, resolutionNote);
    const { updateDoc } = await import('firebase/firestore');
    const ref = doc(firestore, 'tenants', tenantId, 'overflowEvents', event.id);
    await updateDoc(ref, updated as any);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Unknown error resolving overflow event.' };
  }
}

// ---------- Asset custody (serialized items) ----------

export async function recordAssetScanTx(
  firestore: Firestore,
  tenantId: string,
  unit: AssetUnit,
  event: Omit<AssetScanEvent, 'id' | 'timestamp' | 'tenantId'>
): Promise<ApproveResult> {
  try {
    const { updatedUnit, scanEvent } = recordAssetScan(unit, event);
    const scanEventWithTenant: AssetScanEvent = { ...scanEvent, tenantId };

    const { writeBatch } = await import('firebase/firestore');
    const batch = writeBatch(firestore);
    const unitRef = doc(firestore, 'tenants', tenantId, 'assetUnits', unit.id);
    const scanRef = doc(firestore, 'tenants', tenantId, 'assetScanEvents', scanEvent.id);
    batch.update(unitRef, updatedUnit as any);
    batch.set(scanRef, scanEventWithTenant as any);
    await batch.commit();

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Unknown error recording asset scan.' };
  }
}

/** Creates a brand-new serialized AssetUnit (e.g. onboarding "Shears #3"). */
export async function createAssetUnit(
  firestore: Firestore,
  tenantId: string,
  params: { itemId: string; serial: string }
): Promise<AssetUnit> {
  const unit: AssetUnit = {
    id: `asset-${nanoid()}`,
    tenantId,
    itemId: params.itemId,
    serial: params.serial,
    status: 'active',
    assignedToStaffId: null,
    lastScannedAt: null,
    lastScannedByStaffId: null,
  };
  const { setDoc } = await import('firebase/firestore');
  const ref = doc(firestore, 'tenants', tenantId, 'assetUnits', unit.id);
  await setDoc(ref, unit);
  return unit;
}
