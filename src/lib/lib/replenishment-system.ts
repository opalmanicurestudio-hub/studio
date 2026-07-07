/**
 * Replenishment & Staff Allocation System
 * -----------------------------------------
 * Extends the existing InventoryItem model (totalStock, batches,
 * partialContainerSize/Uses, costingMethod) with staff custody tracking,
 * bulk station allocations, and manager-gated replenishment that
 * atomically deducts from main stock.
 */

import { type InventoryItem } from '@/lib/data';
import { safeNumber } from '@/lib/utils';
import { isPast, parseISO } from 'date-fns';

// ---------- New types ----------

export type TrackingMode = 'serialized' | 'bulk';

/** A single physical, individually tracked piece of equipment (e.g. Shears #1) */
export interface AssetUnit {
  id: string;
  itemId: string; // links back to InventoryItem (the "shears" product record)
  serial: string; // human-readable, printed on the fixed label
  status: 'active' | 'damaged' | 'missing' | 'retired';
  assignedToStaffId: string | null;
  lastScannedAt: string | null;
  lastScannedByStaffId: string | null;
  conditionNotes?: string;
}

export interface AssetScanEvent {
  id: string;
  assetUnitId: string;
  staffId: string;
  action: 'checked_out' | 'checked_in' | 'reported_damaged' | 'reported_missing';
  timestamp: string;
  note?: string;
}

/** Quantity of a bulk consumable currently sitting at a staff's station */
export interface StationAllocation {
  itemId: string;
  staffId: string;
  stationId: string;
  quantity: number;
}

/** Manager-gated request to top up a station's bulk allocation */
export interface ReplenishmentRequest {
  id: string;
  itemId: string;
  staffId: string;
  stationId: string;
  quantityRequested: number;
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string;
  approvedByStaffId?: string;
  approvedAt?: string;
  deniedReason?: string;
}

export interface StockDeductionResult {
  success: boolean;
  deductedFromTotalStock: number; // whole units pulled from totalStock
  updatedTotalStock: number;
  updatedPartialContainerSize?: number;
  updatedPartialContainerUses?: number;
  updatedBatches?: InventoryItem['batches'];
  error?: string;
}

// ---------- Core deduction logic ----------

/**
 * Deducts `quantity` from an item's main stock, respecting its costingMethod
 * (whole-unit, size-based partial container, or uses-based partial container)
 * and depleting batches FIFO by expiration date where applicable.
 *
 * This does NOT mutate `item` — it returns the new values so the caller
 * can persist them inside the same transaction as the replenishment approval.
 */
export function deductMainStock(
  item: InventoryItem,
  quantity: number
): StockDeductionResult {
  if (quantity <= 0) {
    return {
      success: false,
      deductedFromTotalStock: 0,
      updatedTotalStock: safeNumber(item.totalStock),
      error: 'Quantity must be greater than zero.',
    };
  }

  const currentTotalStock = safeNumber(item.totalStock);

  // --- Size-based partial container items (e.g. ml poured from a bulk bottle) ---
  if (item.costingMethod === 'size') {
    let remaining = quantity;
    let partial = safeNumber(item.partialContainerSize);
    let unitsOpened = 0;
    const containerSize = safeNumber((item as any).containerSize) || partial || 0;

    // Use up the currently open container first
    if (partial > 0) {
      const used = Math.min(partial, remaining);
      partial -= used;
      remaining -= used;
    }

    // Crack open new whole units from totalStock as needed
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
      const freshAmount = containerSize; // size of a newly opened unit
      const used = Math.min(freshAmount, remaining);
      partial = freshAmount - used;
      remaining -= used;
    }

    return {
      success: true,
      deductedFromTotalStock: unitsOpened,
      updatedTotalStock: currentTotalStock - unitsOpened,
      updatedPartialContainerSize: partial,
    };
  }

  // --- Uses-based partial container items (e.g. 40 uses per container) ---
  if (item.costingMethod === 'uses') {
    let remaining = quantity;
    let partial = safeNumber(item.partialContainerUses);
    let unitsOpened = 0;
    const usesPerContainer = safeNumber((item as any).usesPerContainer) || partial || 0;

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

  // --- Whole-unit items with expiration batches: deplete FIFO by expiration ---
  if (item.batches && item.batches.length > 0) {
    if (currentTotalStock < quantity) {
      return {
        success: false,
        deductedFromTotalStock: 0,
        updatedTotalStock: currentTotalStock,
        error: `Insufficient stock: requested ${quantity}, only ${currentTotalStock} available.`,
      };
    }

    const sortedBatches = [...item.batches].sort((a, b) => {
      const aTime = a.expirationDate ? parseISO(a.expirationDate).getTime() : Infinity;
      const bTime = b.expirationDate ? parseISO(b.expirationDate).getTime() : Infinity;
      return aTime - bTime;
    });

    let remaining = quantity;
    const updatedBatches = sortedBatches.map((batch) => {
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

// ---------- Approval flow ----------

export interface ApproveReplenishmentParams {
  request: ReplenishmentRequest;
  item: InventoryItem;
  currentAllocation: StationAllocation | null;
  approvedByStaffId: string;
  /** Pass this staff member's unresolved overflow events — approval is blocked if any exist. */
  unresolvedOverflows?: OverflowEvent[];
}

export interface ApproveReplenishmentResult {
  success: boolean;
  updatedItem?: Partial<InventoryItem>;
  updatedAllocation?: StationAllocation;
  updatedRequest: ReplenishmentRequest;
  error?: string;
}

/**
 * Approves a replenishment request and atomically:
 *   1. Deducts the requested quantity from main stock (respecting costing method)
 *   2. Increases the staff's station allocation
 *   3. Marks the request approved with an audit trail (who/when)
 *
 * IMPORTANT: Persist `updatedItem`, `updatedAllocation`, and `updatedRequest`
 * together in a single DB transaction (e.g. a Firestore batch/transaction).
 * Never write the allocation increase without the stock deduction succeeding,
 * and never mark the request approved unless both writes commit.
 */
export function approveReplenishment(
  params: ApproveReplenishmentParams
): ApproveReplenishmentResult {
  const { request, item, currentAllocation, approvedByStaffId, unresolvedOverflows } = params;

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
      error: `Cannot approve: ${request.staffId} has ${unresolvedOverflows.length} unresolved overflow flag(s). Resolve them first.`,
    };
  }

  const deduction = deductMainStock(item, request.quantityRequested);

  if (!deduction.success) {
    // Do not approve — surface the stock shortfall to the manager.
    return {
      success: false,
      updatedRequest: request,
      error: deduction.error,
    };
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
        itemId: request.itemId,
        staffId: request.staffId,
        stationId: request.stationId,
        quantity: request.quantityRequested,
      };

  const updatedRequest: ReplenishmentRequest = {
    ...request,
    status: 'approved',
    approvedByStaffId,
    approvedAt: new Date().toISOString(),
  };

  return {
    success: true,
    updatedItem,
    updatedAllocation,
    updatedRequest,
  };
}

/** Manager denies a request — no stock movement, just an audit trail. */
export function denyReplenishment(
  request: ReplenishmentRequest,
  reason: string
): ReplenishmentRequest {
  return {
    ...request,
    status: 'denied',
    deniedReason: reason,
    approvedAt: new Date().toISOString(),
  };
}

// ---------- Service usage: deduct from staff float, not main stock ----------

/**
 * Logged whenever a station runs short during service and the shortfall
 * had to be pulled directly from main stock. Stays "unresolved" until a
 * manager reviews it — and unresolved flags block that staff member's
 * next replenishment approval.
 */
export interface OverflowEvent {
  id: string;
  itemId: string;
  staffId: string;
  stationId: string;
  quantityOverflowed: number;
  timestamp: string;
  resolved: boolean;
  resolvedByStaffId?: string;
  resolvedAt?: string;
  resolutionNote?: string; // e.g. "legit high demand", "damaged product", "investigate"
}

export interface LogServiceUsageResult {
  success: boolean;
  updatedAllocation: StationAllocation;
  updatedItem?: Partial<InventoryItem>; // only set if overflow pulled from main stock
  overflowEvent?: OverflowEvent;
  error?: string;
}

/**
 * Deducts consumed product for a completed service from the staff's
 * station allocation first. If the station doesn't have enough, the
 * shortfall is pulled directly from main stock (service is never blocked)
 * and an OverflowEvent is created for manager review.
 */
export function logServiceUsage(params: {
  item: InventoryItem;
  allocation: StationAllocation;
  quantityUsed: number;
}): LogServiceUsageResult {
  const { item, allocation, quantityUsed } = params;

  if (quantityUsed <= 0) {
    return {
      success: false,
      updatedAllocation: allocation,
      error: 'quantityUsed must be greater than zero.',
    };
  }

  // Enough in the station float — simple case, main stock untouched.
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
    // Even main stock can't cover it — this is a hard stop worth surfacing loudly,
    // since it means real inventory (not just the station float) is out.
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
    id: crypto.randomUUID(),
    itemId: item.id,
    staffId: allocation.staffId,
    stationId: allocation.stationId,
    quantityOverflowed: shortfall,
    timestamp: new Date().toISOString(),
    resolved: false,
  };

  return {
    success: true,
    updatedAllocation,
    updatedItem,
    overflowEvent,
  };
}

/**
 * Gate used in the manager's approval queue: a staff member with any
 * unresolved overflow events must have them addressed before their next
 * replenishment request can be approved.
 */
export function getUnresolvedOverflowsForStaff(
  overflowEvents: OverflowEvent[],
  staffId: string
): OverflowEvent[] {
  return overflowEvents.filter((e) => e.staffId === staffId && !e.resolved);
}

/** Manager resolves an overflow flag — required before approving that staff's next request. */
export function resolveOverflowEvent(
  event: OverflowEvent,
  resolvedByStaffId: string,
  resolutionNote: string
): OverflowEvent {
  return {
    ...event,
    resolved: true,
    resolvedByStaffId,
    resolvedAt: new Date().toISOString(),
    resolutionNote,
  };
}

// ---------- Asset custody (serialized items) ----------

/** Records a scan event and updates the unit's assignment/status accordingly. */
export function recordAssetScan(
  unit: AssetUnit,
  event: Omit<AssetScanEvent, 'id' | 'timestamp'>
): { updatedUnit: AssetUnit; scanEvent: AssetScanEvent } {
  const scanEvent: AssetScanEvent = {
    ...event,
    id: crypto.randomUUID(),
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
