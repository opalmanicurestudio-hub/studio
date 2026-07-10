/**
 * Staff Replenishment & Custody System
 * -------------------------------------
 * Extends the existing InventoryItem model (totalStock, batches, size,
 * estimatedUses, partialContainerSize/Uses, costingMethod) with staff
 * custody tracking (serialized equipment), bulk station allocations, and
 * manager-gated replenishment that atomically deducts from main stock.
 *
 * Integration notes:
 * - Reuses your existing `stockCorrections` collection as the audit log
 *   (same pattern as "Manual Use Log" / "Write-off: ..."), rather than a
 *   parallel log table. See stockCorrection returned by each function.
 * - Reuses Staff.role ('admin' | 'owner') for the manager-approval gate,
 *   same pattern as handleUnlockVault in ProductDetailPage.
 * - Reuses Location as the "station" concept — StationAllocation.stationId
 *   points directly at Location.id.
 * - Add `trackingMode?: 'serialized' | 'bulk'` to InventoryItem in
 *   lib/data.ts. Undefined = legacy item, not yet migrated; fall back to
 *   the old direct-deduction behavior (handleLogUseConfirm) for these.
 */

import { type InventoryItem, type Staff, type StockCorrection } from '@/lib/data';
import { safeNumber } from '@/lib/utils';
import { nanoid } from 'nanoid';

// ---------- New types (add alongside RefreshmentRequest in lib/data.ts) ----------

export type TrackingMode = 'serialized' | 'bulk';

/** A single physical, individually tracked piece of equipment (e.g. Shears #1) */
export type AssetUnit = {
  id: string;
  tenantId: string;
  itemId: string; // InventoryItem.id
  serial: string; // printed on the fixed label — never reprinted on reassignment
  status: 'active' | 'damaged' | 'missing' | 'retired';
  assignedToStaffId: string | null;
  lastScannedAt: string | null;
  lastScannedByStaffId: string | null;
  conditionNotes?: string;
};

export type AssetScanEvent = {
  id: string;
  tenantId: string;
  assetUnitId: string;
  staffId: string;
  action: 'checked_out' | 'checked_in' | 'reported_damaged' | 'reported_missing';
  timestamp: string;
  note?: string;
};

/** Quantity of a bulk consumable currently sitting at a staff member's station */
export type StationAllocation = {
  id: string;
  tenantId: string;
  itemId: string; // InventoryItem.id
  staffId: string;
  stationId: string; // Location.id
  quantity: number;
};

/**
 * Manager-gated request to top up a station's bulk allocation.
 * Same shape/spirit as RefreshmentRequest but for staff, not guests.
 */
export type StaffReplenishmentRequest = {
  id: string;
  tenantId: string;
  itemId: string;
  itemName: string;
  staffId: string;
  staffName: string;
  stationId: string;
  quantityRequested: number;
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string;
  approvedByStaffId?: string;
  approvedAt?: string;
  deniedReason?: string;
};

/**
 * Created whenever a station runs short mid-service and the shortfall was
 * pulled directly from main stock. Stays unresolved until a manager
 * reviews it; unresolved flags block that staff member's next
 * replenishment approval (see getUnresolvedOverflowsForStaff).
 */
export type OverflowEvent = {
  id: string;
  tenantId: string;
  itemId: string;
  staffId: string;
  stationId: string;
  quantityOverflowed: number;
  timestamp: string;
  resolved: boolean;
  resolvedByStaffId?: string;
  resolvedAt?: string;
  resolutionNote?: string; // e.g. "legit high demand", "damaged product", "investigate"
};

export type StockDeductionResult = {
  success: boolean;
  deductedFromTotalStock: number;
  updatedTotalStock: number;
  updatedPartialContainerSize?: number;
  updatedPartialContainerUses?: number;
  updatedBatches?: InventoryItem['batches'];
  error?: string;
};

// ---------- Permission helper (matches handleUnlockVault's pattern) ----------

export function isManager(staff: Staff): boolean {
  return staff.role === 'admin' || staff.role === 'owner';
}

// ---------- Core deduction logic (main stock only — never touches allocations) ----------

/**
 * Deducts `quantity` from an item's main stock, respecting its costingMethod
 * (whole-unit, size-based partial container via item.size, or uses-based
 * partial container via item.estimatedUses) and depleting batches FIFO by
 * expiration date where applicable.
 *
 * Does NOT mutate `item` — returns new values so the caller persists them
 * inside the same Firestore transaction as the approval/usage write.
 */
export function deductMainStock(item: InventoryItem, quantity: number): StockDeductionResult {
  if (quantity <= 0) {
    return {
      success: false,
      deductedFromTotalStock: 0,
      updatedTotalStock: safeNumber(item.totalStock),
      error: 'Quantity must be greater than zero.',
    };
  }

  const currentTotalStock = safeNumber(item.totalStock);

  // --- Size-based partial container (e.g. ml poured from a bulk bottle) ---
  if (item.costingMethod === 'size') {
    let remaining = quantity;
    let partial = safeNumber(item.partialContainerSize);
    let unitsOpened = 0;
    const containerSize = safeNumber(item.size) || partial || 0;

    if (partial > 0) {
      const used = Math.min(partial, remaining);
      partial -= used;
      remaining -= used;
    }

    let stockLeft = currentTotalStock;
    while (remaining > 0) {
      if (stockLeft <= 0) {
        return {
          success: false,
          deductedFromTotalStock: unitsOpened,
          updatedTotalStock: currentTotalStock - unitsOpened,
          error: `Insufficient stock: need ${remaining} more ${item.unit || 'ml'} but no sealed units remain.`,
        };
      }
      stockLeft -= 1;
      unitsOpened += 1;
      const used = Math.min(containerSize, remaining);
      partial = containerSize - used;
      remaining -= used;
    }

    return {
      success: true,
      deductedFromTotalStock: unitsOpened,
      updatedTotalStock: currentTotalStock - unitsOpened,
      updatedPartialContainerSize: partial,
    };
  }

  // --- Uses-based partial container (e.g. 40 uses per container) ---
  if (item.costingMethod === 'uses') {
    let remaining = quantity;
    let partial = safeNumber(item.partialContainerUses);
    let unitsOpened = 0;
    const usesPerContainer = safeNumber(item.estimatedUses) || partial || 0;

    if (partial > 0) {
      const used = Math.min(partial, remaining);
      partial -= used;
      remaining -= used;
    }

    let stockLeft = currentTotalStock;
    while (remaining > 0) {
      if (stockLeft <= 0) {
        return {
          success: false,
          deductedFromTotalStock: unitsOpened,
          updatedTotalStock: currentTotalStock - unitsOpened,
          error: `Insufficient stock: need ${remaining} more ${item.useUnit || 'uses'} but no sealed units remain.`,
        };
      }
      stockLeft -= 1;
      unitsOpened += 1;
      const used = Math.min(usesPerContainer, remaining);
      partial = usesPerContainer - used;
      remaining -= used;
    }

    return {
      success: true,
      deductedFromTotalStock: unitsOpened,
      updatedTotalStock: currentTotalStock - unitsOpened,
      updatedPartialContainerUses: partial,
    };
  }

  // --- Whole-unit items with expiration batches: deplete FIFO ---
  const batches = item.batches ?? []; // guard — batches has been missing on some docs
  if (batches.length > 0) {
    if (currentTotalStock < quantity) {
      return {
        success: false,
        deductedFromTotalStock: 0,
        updatedTotalStock: currentTotalStock,
        error: `Insufficient stock: requested ${quantity}, only ${currentTotalStock} available.`,
      };
    }

    const sorted = [...batches].sort((a, b) => {
      const aTime = a.expirationDate ? new Date(a.expirationDate).getTime() : Infinity;
      const bTime = b.expirationDate ? new Date(b.expirationDate).getTime() : Infinity;
      return aTime - bTime;
    });

    let remaining = quantity;
    const updatedBatches = sorted.map((batch) => {
      if (remaining <= 0) return batch;
      const take = Math.min(batch.stock, remaining);
      remaining -= take;
      return { ...batch, stock: batch.stock - take };
    });

    if (remaining > 0) {
      return {
        success: false,
        deductedFromTotalStock: 0,
        updatedTotalStock: currentTotalStock,
        error: 'Batch stock does not reconcile with totalStock — reconcile inventory before approving.',
      };
    }

    return {
      success: true,
      deductedFromTotalStock: quantity,
      updatedTotalStock: currentTotalStock - quantity,
      updatedBatches,
    };
  }

  // --- Simple whole-unit item, no batches ---
  if (currentTotalStock < quantity) {
    return {
      success: false,
      deductedFromTotalStock: 0,
      updatedTotalStock: currentTotalStock,
      error: `Insufficient stock: requested ${quantity}, only ${currentTotalStock} available.`,
    };
  }

  return {
    success: true,
    deductedFromTotalStock: quantity,
    updatedTotalStock: currentTotalStock - quantity,
  };
}

// ---------- Replenishment approval flow ----------

export type ApproveReplenishmentParams = {
  request: StaffReplenishmentRequest;
  item: InventoryItem;
  currentAllocation: StationAllocation | null;
  approvingManager: Staff;
  /** Unresolved overflow events for request.staffId — approval blocked if any exist. */
  unresolvedOverflows?: OverflowEvent[];
};

export type ApproveReplenishmentResult = {
  success: boolean;
  updatedItem?: Partial<InventoryItem>;
  updatedAllocation?: StationAllocation;
  updatedRequest: StaffReplenishmentRequest;
  /** Write this into stockCorrections, same pattern as write-offs/manual use logs. */
  stockCorrection?: Omit<StockCorrection, 'id'>;
  error?: string;
};

/**
 * Approves a replenishment request and atomically:
 *   1. Deducts the requested quantity from main stock
 *   2. Increases the staff's station allocation
 *   3. Marks the request approved with an audit trail
 *   4. Produces a stockCorrections entry consistent with your existing ledger
 *
 * Persist updatedItem / updatedAllocation / updatedRequest / stockCorrection
 * together in a single Firestore transaction or writeBatch — never write
 * the allocation increase without the stock deduction succeeding.
 */
export function approveReplenishment(params: ApproveReplenishmentParams): ApproveReplenishmentResult {
  const { request, item, currentAllocation, approvingManager, unresolvedOverflows } = params;

  if (!isManager(approvingManager)) {
    return {
      success: false,
      updatedRequest: request,
      error: 'Only admin or owner roles can approve replenishment requests.',
    };
  }

  if (request.status !== 'pending') {
    return {
      success: false,
      updatedRequest: request,
      error: `Request is already ${request.status}; cannot approve again.`,
    };
  }

  if (unresolvedOverflows && unresolvedOverflows.length > 0) {
    return {
      success: false,
      updatedRequest: request,
      error: `Cannot approve: ${request.staffName} has ${unresolvedOverflows.length} unresolved overflow flag(s). Resolve them first.`,
    };
  }

  const deduction = deductMainStock(item, request.quantityRequested);

  if (!deduction.success) {
    return { success: false, updatedRequest: request, error: deduction.error };
  }

  const updatedItem: Partial<InventoryItem> = {
    totalStock: deduction.updatedTotalStock,
    ...(deduction.updatedPartialContainerSize !== undefined && {
      partialContainerSize: deduction.updatedPartialContainerSize,
    }),
    ...(deduction.updatedPartialContainerUses !== undefined && {
      partialContainerUses: deduction.updatedPartialContainerUses,
    }),
    ...(deduction.updatedBatches !== undefined && { batches: deduction.updatedBatches }),
  };

  const updatedAllocation: StationAllocation = currentAllocation
    ? { ...currentAllocation, quantity: currentAllocation.quantity + request.quantityRequested }
    : {
        id: `alloc-${nanoid()}`,
        tenantId: request.tenantId,
        itemId: request.itemId,
        staffId: request.staffId,
        stationId: request.stationId,
        quantity: request.quantityRequested,
      };

  const updatedRequest: StaffReplenishmentRequest = {
    ...request,
    status: 'approved',
    approvedByStaffId: approvingManager.id,
    approvedAt: new Date().toISOString(),
  };

  const stockCorrection: Omit<StockCorrection, 'id'> = {
    productId: request.itemId,
    date: new Date().toISOString(),
    change: -request.quantityRequested,
    unit: item.unit || item.useUnit || 'units',
    reason: `Replenished to ${request.staffName}'s station, approved by ${approvingManager.name}`,
  };

  return { success: true, updatedItem, updatedAllocation, updatedRequest, stockCorrection };
}

/** Manager denies a request — no stock movement, just an audit trail. */
export function denyReplenishment(
  request: StaffReplenishmentRequest,
  denyingManager: Staff,
  reason: string
): StaffReplenishmentRequest {
  return {
    ...request,
    status: 'denied',
    approvedByStaffId: denyingManager.id,
    approvedAt: new Date().toISOString(),
    deniedReason: reason,
  };
}

// ---------- Service usage: deduct from staff float, not main stock ----------

export type LogServiceUsageResult = {
  success: boolean;
  updatedAllocation: StationAllocation;
  updatedItem?: Partial<InventoryItem>; // only set if overflow pulled from main stock
  overflowEvent?: OverflowEvent;
  stockCorrection?: Omit<StockCorrection, 'id'>; // only set if overflow occurred
  error?: string;
};

/**
 * Deducts consumed product for a completed service from the staff's
 * station allocation first. If the station doesn't have enough, the
 * shortfall is pulled directly from main stock (the service is never
 * blocked) and an OverflowEvent + stockCorrection entry are created for
 * manager review.
 */
export function logServiceUsage(params: {
  item: InventoryItem;
  allocation: StationAllocation;
  staffName: string;
  quantityUsed: number;
}): LogServiceUsageResult {
  const { item, allocation, staffName, quantityUsed } = params;

  if (quantityUsed <= 0) {
    return { success: false, updatedAllocation: allocation, error: 'quantityUsed must be greater than zero.' };
  }

  // Station float covers it — main stock untouched.
  if (allocation.quantity >= quantityUsed) {
    return {
      success: true,
      updatedAllocation: { ...allocation, quantity: allocation.quantity - quantityUsed },
    };
  }

  // Station is short — drain what's left locally, pull the rest from main.
  const shortfall = quantityUsed - allocation.quantity;
  const deduction = deductMainStock(item, shortfall);

  if (!deduction.success) {
    return {
      success: false,
      updatedAllocation: allocation,
      error: `Station and main stock both insufficient: ${deduction.error}`,
    };
  }

  const updatedAllocation: StationAllocation = { ...allocation, quantity: 0 };

  const updatedItem: Partial<InventoryItem> = {
    totalStock: deduction.updatedTotalStock,
    ...(deduction.updatedPartialContainerSize !== undefined && {
      partialContainerSize: deduction.updatedPartialContainerSize,
    }),
    ...(deduction.updatedPartialContainerUses !== undefined && {
      partialContainerUses: deduction.updatedPartialContainerUses,
    }),
    ...(deduction.updatedBatches !== undefined && { batches: deduction.updatedBatches }),
  };

  const overflowEvent: OverflowEvent = {
    id: `overflow-${nanoid()}`,
    tenantId: allocation.tenantId,
    itemId: item.id,
    staffId: allocation.staffId,
    stationId: allocation.stationId,
    quantityOverflowed: shortfall,
    timestamp: new Date().toISOString(),
    resolved: false,
  };

  const stockCorrection: Omit<StockCorrection, 'id'> = {
    productId: item.id,
    date: new Date().toISOString(),
    change: -shortfall,
    unit: item.unit || item.useUnit || 'units',
    reason: `Overflow: ${staffName}'s station ran short, pulled from main stock`,
  };

  return { success: true, updatedAllocation, updatedItem, overflowEvent, stockCorrection };
}

/**
 * Gate used in the manager's approval queue: a staff member with any
 * unresolved overflow events must have them addressed before their next
 * replenishment request can be approved.
 */
export function getUnresolvedOverflowsForStaff(overflowEvents: OverflowEvent[], staffId: string): OverflowEvent[] {
  return overflowEvents.filter((e) => e.staffId === staffId && !e.resolved);
}

/** Manager resolves an overflow flag — required before approving that staff's next request. */
export function resolveOverflowEvent(
  event: OverflowEvent,
  resolvingManager: Staff,
  resolutionNote: string
): OverflowEvent {
  return {
    ...event,
    resolved: true,
    resolvedByStaffId: resolvingManager.id,
    resolvedAt: new Date().toISOString(),
    resolutionNote,
  };
}

// ---------- Low-float alerts (proactive, before a station hits zero) ----------

export type LowFloatAlert = {
  allocation: StationAllocation;
  itemName: string;
  percentRemaining: number;
};

/**
 * Flags station allocations that have dropped below `thresholdPercent` of
 * their last-known replenished amount. Call this on a schedule (or whenever
 * allocations update) to notify staff BEFORE they run dry mid-service,
 * turning most overflow events into ordinary replenishment requests instead.
 *
 * `lastReplenishedAmount` should be the quantity from that staff member's
 * most recent approved StaffReplenishmentRequest for this item — pass a map
 * built from your staffReplenishmentRequests collection, since
 * StationAllocation itself doesn't track its own history.
 */
export function getLowFloatAllocations(
  allocations: StationAllocation[],
  items: InventoryItem[],
  lastReplenishedAmounts: Map<string, number>, // key: `${staffId}-${itemId}`
  thresholdPercent: number = 20
): LowFloatAlert[] {
  const alerts: LowFloatAlert[] = [];

  for (const allocation of allocations) {
    const lastAmount = lastReplenishedAmounts.get(`${allocation.staffId}-${allocation.itemId}`);
    if (!lastAmount || lastAmount <= 0) continue;

    const percentRemaining = (allocation.quantity / lastAmount) * 100;
    if (percentRemaining <= thresholdPercent) {
      const item = items.find(i => i.id === allocation.itemId);
      alerts.push({
        allocation,
        itemName: item?.name || 'Unknown item',
        percentRemaining: Math.round(percentRemaining),
      });
    }
  }

  return alerts;
}

// ---------- Staff offboarding (reconcile float + force asset check-in) ----------

export type OffboardStaffResult = {
  /** Bulk allocations to zero out, with their quantity returned to main stock. */
  allocationsToReconcile: { allocation: StationAllocation; itemId: string; quantityReturned: number }[];
  /** Serialized units that must be force-checked-in (no longer assigned to this staff member). */
  assetsToCheckIn: AssetUnit[];
  /** One stockCorrection per reconciled allocation, for the audit trail. */
  stockCorrections: Omit<StockCorrection, 'id'>[];
};

/**
 * Computes what needs to happen when a staff member leaves: every bulk
 * allocation they're holding gets returned to main stock (their float
 * doesn't just vanish, uncounted), and every serialized asset assigned to
 * them gets force-checked-in so it isn't silently "owned" by someone no
 * longer employed.
 *
 * Does NOT mutate anything — returns what to write. Caller applies these
 * (increment each item's totalStock by quantityReturned, delete/zero the
 * allocation docs, update each AssetUnit's assignedToStaffId to null,
 * write the stockCorrections) inside a single Firestore batch/transaction.
 */
export function offboardStaff(
  staffId: string,
  staffName: string,
  allocations: StationAllocation[],
  assetUnits: AssetUnit[]
): OffboardStaffResult {
  const staffAllocations = allocations.filter(a => a.staffId === staffId && a.quantity > 0);
  const staffAssets = assetUnits.filter(u => u.assignedToStaffId === staffId);

  const allocationsToReconcile = staffAllocations.map(allocation => ({
    allocation,
    itemId: allocation.itemId,
    quantityReturned: allocation.quantity,
  }));

  const stockCorrections: Omit<StockCorrection, 'id'>[] = allocationsToReconcile.map(({ itemId, quantityReturned }) => ({
    productId: itemId,
    date: new Date().toISOString(),
    change: quantityReturned,
    unit: 'units',
    reason: `Reconciled from ${staffName}'s station on offboarding`,
  }));

  return {
    allocationsToReconcile,
    assetsToCheckIn: staffAssets,
    stockCorrections,
  };
}

// ---------- Asset custody (serialized items — shears, clippers, etc.) ----------

/** Records a scan event and updates the unit's assignment/status accordingly. */
export function recordAssetScan(
  unit: AssetUnit,
  event: Omit<AssetScanEvent, 'id' | 'timestamp'>
): { updatedUnit: AssetUnit; scanEvent: AssetScanEvent } {
  const scanEvent: AssetScanEvent = {
    ...event,
    id: `scan-${nanoid()}`,
    timestamp: new Date().toISOString(),
  };

  let updatedUnit: AssetUnit = {
    ...unit,
    lastScannedAt: scanEvent.timestamp,
    lastScannedByStaffId: event.staffId,
  };

  switch (event.action) {
    case 'checked_out':
      updatedUnit = { ...updatedUnit, assignedToStaffId: event.staffId, status: 'active' };
      break;
    case 'checked_in':
      updatedUnit = { ...updatedUnit, assignedToStaffId: null };
      break;
    case 'reported_damaged':
      updatedUnit = { ...updatedUnit, status: 'damaged', conditionNotes: event.note };
      break;
    case 'reported_missing':
      updatedUnit = { ...updatedUnit, status: 'missing', conditionNotes: event.note };
      break;
  }

  return { updatedUnit, scanEvent };
}
