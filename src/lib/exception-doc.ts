// ─── src/lib/exception-doc.ts ────────────────────────────────────────────────
// THE LOSS RECORD'S PURE PARTS, shared by the screens and the server: the reason taxonomy, the cost triple, the record
// itself (buildExceptionDoc), the recovery figures, and the carriers' typical claim windows. lib/inventory-exceptions
// (browser) re-exports all of it next to the functions that write to the database.

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
export const RECOVERY_CANDIDATES = new Set<string>([
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
  /** What the label purchase actually insured (0 = rode uninsured); null =
   *  unknown/legacy. The File-claim form and analytics both read this. */
  insuredCents?: number | null;
  shippedAt?: string | null;
  /** When the carrier marked it delivered, for a box gone from the porch (its claim window counts from then). */
  deliveredAt?: string | null;
  responsibleParty: 'customer' | 'carrier' | 'supplier' | 'internal' | 'unknown';
  /** The ledger transaction that recognised the landed cost, when one was
   *  written — the anti-double-deduction link. Absent = not yet ledgered. */
  ledgerTxnId?: string | null;
  note?: string | null;
  photoUrls?: string[];
  recordedBy: { id: string; name: string };
  source: 'returns_desk' | 'claims_desk' | 'manual' | 'carrier_watch';
  flags?: string[];
  duplicateOfId?: string | null;
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
    insuredCents: input.insuredCents ?? null,
    shippedAt: input.shippedAt || null,
    deliveredAt: input.deliveredAt || null,
    responsibleParty: input.responsibleParty,
    ledgerTxnId: input.ledgerTxnId || null,
    note: input.note ? String(input.note).slice(0, 600) : null,
    photoUrls: Array.isArray(input.photoUrls) ? input.photoUrls.slice(0, 8) : [],
    recordedBy: { id: input.recordedBy.id, name: input.recordedBy.name },
    source: input.source,
    flags: Array.isArray(input.flags) ? input.flags : [],
    duplicateOfId: input.duplicateOfId || null,
    recovery: {
      status: RECOVERY_CANDIDATES.has(input.reason) ? 'candidate' : 'none',
      claimAmountCents: 0,
      recoveredCents: 0,
    },
    accountingStatus: input.ledgerTxnId ? 'ledgered' : 'recorded',
  };
}

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

// ─── Round N5: claims without friction ───────────────────────────────────────
// Filing a carrier claim means knowing three things nobody remembers under
// pressure: whether the package was insured, how long the window is, and
// where the form lives. The windows below are the carriers' TYPICAL US
// domestic limits — stated as defaults the shop can override, never as legal
// advice; services differ, so the UI always says "verify for your service".

export interface ClaimWindow { days: number; url: string; label: string }

const CLAIM_WINDOWS: { match: RegExp; win: ClaimWindow }[] = [
  { match: /usps/i, win: { days: 60, url: 'https://www.usps.com/help/claims.htm', label: 'USPS claims' } },
  { match: /ups/i, win: { days: 60, url: 'https://www.ups.com/us/en/support/file-a-claim', label: 'UPS claims' } },
  { match: /fedex/i, win: { days: 60, url: 'https://www.fedex.com/en-us/customer-support/claims.html', label: 'FedEx claims' } },
  { match: /dhl/i, win: { days: 30, url: 'https://www.dhl.com/us-en/home/customer-service.html', label: 'DHL claims' } },
];
const DEFAULT_WINDOW: ClaimWindow = { days: 30, url: '', label: 'your carrier\u2019s claim portal' };

export function claimWindowFor(carrier?: string | null): ClaimWindow {
  const c = String(carrier || '');
  for (const { match, win } of CLAIM_WINDOWS) if (match.test(c)) return win;
  return DEFAULT_WINDOW;
}

/** Deadline suggestion: ship date + the carrier's typical window. Null when
 *  the ship date is unknown — a guessed deadline is worse than none. */
export function suggestedDeadline(shippedAt?: string | null, carrier?: string | null): string | null {
  const t = shippedAt ? Date.parse(String(shippedAt)) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t + claimWindowFor(carrier).days * 86400000).toISOString();
}
