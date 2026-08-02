/**
 * retail-orders.ts  (v2 — bridged to the existing inventory system)
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for the ClarityFlow retail ordering engine.
 *
 * Everything here is PURE — no Firestore, no React, no side effects — so it is
 * safe to import from API routes, server components, and 'use client' files.
 *
 * The retail catalog is NOT a new collection. Storefront listings are the
 * existing `tenants/{tenantId}/inventory` items with `type: 'retail'`.
 * The engine adds only OPTIONAL fields to those docs (backward compatible)
 * and writes to the ledgers that already exist:
 *
 *   tenants/{tenantId}/inventory/{itemId}          (+ stockReserved, showOnline, …)
 *   tenants/{tenantId}/stockCorrections            (existing stock ledger)
 *   tenants/{tenantId}/transactions                (existing money ledger)
 *   tenants/{tenantId}/retailOrders/{orderId}                    (new)
 *   tenants/{tenantId}/retailOrders/{orderId}/events/{eventId}   (new, append-only)
 *   tenants/{tenantId}/fulfillmentBatches/{batchId}              (new)
 *   tenants/{tenantId}/retailReturns/{returnId}                  (new)
 */

/* ════════════════════════════════════════════════════════════════════════════
 * STAGES & TRANSITIONS
 * ════════════════════════════════════════════════════════════════════════════ */

export const ORDER_STAGES = [
  'placed',      // checkout created, awaiting payment confirmation
  'paid',        // Stripe webhook confirmed; stock reserved; in queue
  'picking',     // claimed in a batch; items being scanned
  'packed',      // every line fully scanned or explicitly shorted
  'ready',       // pickup orders: on the ready shelf / label printed for ship
  'arrived',     // curbside only: customer checked in "I'm here"
  'shipped',     // ship orders: carrier label scanned onto box
  'handed_off',  // pickup: customer QR scanned at counter/car
  'completed',   // terminal success
  'cancelled',   // terminal: refunded, reservations released
  'refunded',    // terminal: post-completion full refund (via return flow)
] as const;

export type OrderStage = (typeof ORDER_STAGES)[number];

export const FULFILLMENT_METHODS = ['counter', 'curbside', 'in_store', 'ship'] as const;
export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number];

/**
 * Pricing tiers. 'retail' is the public storefront price (msrp).
 * 'wholesale' is for B2B buyers (other businesses, students, pros) who unlock the
 * shop with the tenant's wholesale access code; prices come from
 * wholesalePriceDollars with msrp as the fallback.
 */
export const PRICE_TIERS = ['retail', 'wholesale'] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

/**
 * Legal stage transitions. Any transition not listed here is rejected.
 * Method-specific branches (curbside vs ship) are enforced in canAdvance().
 */
export const LEGAL_TRANSITIONS: Record<OrderStage, OrderStage[]> = {
  placed:     ['paid', 'cancelled'],
  paid:       ['picking', 'cancelled'],
  picking:    ['packed', 'paid', 'cancelled'],          // 'paid' = batch released back to queue
  packed:     ['ready', 'cancelled'],                   // cancel after packed requires restock scan
  ready:      ['arrived', 'shipped', 'handed_off', 'cancelled'],
  arrived:    ['handed_off'],
  shipped:    ['completed'],
  handed_off: ['completed'],
  completed:  ['refunded'],
  cancelled:  [],
  refunded:   [],
};

export const TERMINAL_STAGES: OrderStage[] = ['completed', 'cancelled', 'refunded'];

/* ════════════════════════════════════════════════════════════════════════════
 * INVENTORY BRIDGE  (existing tenants/{tid}/inventory items, type 'retail')
 * ════════════════════════════════════════════════════════════════════════════ */

/** Shape of a batch on an existing InventoryItem (FIFO by receivedDate). */
export interface InventoryBatchRef {
  id: string;
  stock: number;
  costPerUnit: number;
  receivedDate: string;
  expiryDate?: string;
}

/**
 * OPTIONAL fields the retail engine reads/writes on existing InventoryItem
 * docs. All optional — no migration needed; absent means the default noted.
 */
export interface RetailInventoryFields {
  stockReserved?: number;      // held by paid, unfulfilled online orders (default 0)
  showOnline?: boolean;        // listed on the public storefront (default false)
  barcode?: string;            // physical UPC/Code-128; falls back to sku
  onlineDescription?: string;  // storefront copy (name/msrp come from the item)
  imageUrls?: string[];
  lowStockThreshold?: number;
  allowBackorder?: boolean;    // default false
  wholesalePriceDollars?: number; // B2B price; falls back to msrp when absent
  wholesaleMinQty?: number;       // per-item minimum units for wholesale orders
  howToUse?: string;              // usage/instructions shown on the product page
  specs?: ProductSpec[];          // label/value spec rows
  documents?: ProductDocument[];  // MSDS/SDS, guides, certificates — any linked file
}

export interface ProductSpec { label: string; value: string; }
export interface ProductDocument { name: string; url: string; }

/** The slice of InventoryItem the engine needs (structural — no import cycle). */
export type SellableItem = RetailInventoryFields & {
  id: string;
  name: string;
  type: string;                // engine only sells 'retail'
  category?: string;
  sku?: string;
  msrp?: number;               // retail price in DOLLARS (existing convention)
  costPerUnit?: number;
  unit?: string;
  totalStock: number;
  status?: string;             // 'archived' hides everywhere
  batches?: InventoryBatchRef[];
};

/** Units a new order may sell right now. */
/** Units allotted out to stations/providers — not sellable online. */
export function allocatedUnits(item: any): number {
  const a = (item as any)?.allocations;
  if (!a || typeof a !== 'object') return 0;
  return Object.values(a).reduce((s: number, x: any) => s + (Number(x?.qty) || 0), 0);
}

export function sellableStock(item: Pick<SellableItem, 'totalStock' | 'stockReserved'>): number {
  const allocated = allocatedUnits(item);
  return item.totalStock - (item.stockReserved ?? 0) - allocated;
}

export function isStorefrontVisible(item: SellableItem): boolean {
  return (
    item.type === 'retail' &&
    item.status !== 'archived' &&
    item.showOnline === true &&
    (item.msrp ?? 0) > 0
  );
}

/** Prices are stored in dollars; the engine works in cents (Stripe-safe). */
export function listingPriceCents(
  item: Pick<SellableItem, 'msrp' | 'wholesalePriceDollars'>,
  tier: PriceTier = 'retail'
): number {
  const dollars = tier === 'wholesale'
    ? item.wholesalePriceDollars ?? item.msrp ?? 0
    : item.msrp ?? 0;
  return Math.round(dollars * 100);
}

/** Wholesale orders must meet each item's minimum quantity, when one is set. */
export function checkWholesaleMinimums(
  entries: { item: SellableItem; qty: number }[]
): GuardResult {
  const failing = entries.filter(
    (e) => (e.item.wholesaleMinQty ?? 0) > 0 && e.qty < (e.item.wholesaleMinQty as number)
  );
  if (failing.length > 0) {
    return {
      ok: false,
      reason: failing
        .map((e) => `${e.item.name}: minimum ${e.item.wholesaleMinQty} for wholesale`)
        .join('; '),
    };
  }
  return { ok: true };
}

export function isLowStock(item: SellableItem): boolean {
  return sellableStock(item) <= (item.lowStockThreshold ?? 0);
}

/**
 * FIFO batch depletion — mirrors the manual Log Sale logic exactly (sort by
 * receivedDate ascending, drain oldest first) so online and in-person sales
 * consume stock identically. Pure: returns new arrays, never mutates input.
 */
export function depleteBatchesFIFO(
  batches: InventoryBatchRef[] | undefined,
  qty: number
): { batches: InventoryBatchRef[]; depleted: number; shortfall: number; cogsCents: number } {
  const sorted = [...(batches ?? [])]
    .map((b) => ({ ...b }))
    .sort((a, b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());

  let remaining = qty;
  let cogsCents = 0;
  for (const batch of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(batch.stock, remaining);
    batch.stock -= take;
    remaining -= take;
    cogsCents += Math.round(take * (batch.costPerUnit ?? 0) * 100);
  }

  return { batches: sorted, depleted: qty - remaining, shortfall: remaining, cogsCents };
}

/* ── Stock ledger (existing stockCorrections collection) ──────────────────── */

export const INVENTORY_MOVEMENT_TYPES = [
  'reserve',          // paid order holds stock            (stockReserved +qty)
  'release',          // cancellation frees a hold         (stockReserved -qty)
  'sale',             // handoff/ship converts the hold    (totalStock -qty, stockReserved -qty)
  'short_adjustment', // picker found less on shelf        (totalStock corrected down)
  'restock',          // cancelled-packed items scanned back (totalStock +qty)
  'return_restock',   // sellable return scanned back      (totalStock +qty)
  'write_off',        // damaged/defective, NOT sellable   (totalStock -qty)
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

/**
 * Deltas a Firestore transaction must apply to the inventory doc for a given
 * movement. Keeps the math in exactly one place. NOTE: 'sale', 'restock',
 * 'return_restock', and 'write_off' must ALSO rewrite `batches` — use
 * depleteBatchesFIFO for sales; restocks append/refill a batch.
 */
export function movementDeltas(
  type: InventoryMovementType,
  qty: number
): { totalStock: number; stockReserved: number } {
  switch (type) {
    case 'reserve':           return { totalStock: 0,    stockReserved: qty };
    case 'release':           return { totalStock: 0,    stockReserved: -qty };
    case 'sale':              return { totalStock: -qty, stockReserved: -qty };
    case 'short_adjustment':  return { totalStock: -qty, stockReserved: 0 };
    case 'restock':           return { totalStock: qty,  stockReserved: 0 };
    case 'return_restock':    return { totalStock: qty,  stockReserved: 0 };
    case 'write_off':         return { totalStock: -qty, stockReserved: 0 };
  }
}

/**
 * Entry for the EXISTING tenants/{tid}/stockCorrections collection. Core
 * fields match what the inventory page already writes; the extras are
 * additive so existing reports keep working untouched.
 */
export interface StockCorrectionEntry {
  productId: string;
  date: string;
  change: number;              // signed, existing convention (+receive / -deplete)
  unit: string;
  reason: string;
  orderId?: string;
  returnId?: string;
  actorId?: string;
  actorName?: string;
  source?: 'retail_engine';
}

export function buildStockCorrection(
  item: Pick<SellableItem, 'id' | 'unit'>,
  type: InventoryMovementType,
  qty: number,
  reason: string,
  refs?: Pick<StockCorrectionEntry, 'orderId' | 'returnId' | 'actorId' | 'actorName'>
): StockCorrectionEntry {
  const { totalStock } = movementDeltas(type, qty);
  return {
    productId: item.id,
    date: new Date().toISOString(),
    change: totalStock,          // reservations don't touch shelf count → change 0
    unit: item.unit ?? 'units',
    reason,
    source: 'retail_engine',
    ...refs,
  };
}

/* ── Money ledger (existing transactions collection) ──────────────────────── */

/** Matches the transaction docs the inventory page already writes (dollars). */
export interface FinancialTransactionEntry {
  date: string;
  description: string;
  clientOrVendor: string;
  type: 'income' | 'expense';
  context: 'Business';
  category: 'Retail' | 'Spoilage' | 'Refund';
  amount: number;              // DOLLARS, existing convention
  paymentMethod: string;
  hasReceipt: boolean;
  receiptUrl?: string;
  relatedOrderId?: string;
  notes?: string;
}

export function buildRetailSaleTransaction(
  order: Pick<RetailOrder, 'id' | 'orderNumber' | 'customerName' | 'totalCents'>
): FinancialTransactionEntry {
  return {
    date: new Date().toISOString(),
    description: `Online Retail Sale: Order #${order.orderNumber}`,
    clientOrVendor: order.customerName,
    type: 'income',
    context: 'Business',
    category: 'Retail',
    amount: order.totalCents / 100,
    paymentMethod: 'Card (Online)',
    hasReceipt: true,
    relatedOrderId: order.id,
  };
}

export function buildRefundTransaction(
  order: Pick<RetailOrder, 'id' | 'orderNumber' | 'customerName'>,
  amountCents: number,
  scope: 'full' | 'partial'
): FinancialTransactionEntry {
  return {
    date: new Date().toISOString(),
    description: `${scope === 'full' ? 'Refund' : 'Partial refund'}: Order #${order.orderNumber}`,
    clientOrVendor: order.customerName,
    type: 'expense',
    context: 'Business',
    category: 'Refund',
    amount: amountCents / 100,
    paymentMethod: 'Card (Online)',
    hasReceipt: true,
    relatedOrderId: order.id,
  };
}

/** Damaged/defective return units — mirrors the damaged-on-arrival pattern. */
export function buildReturnWriteOffTransaction(
  order: Pick<RetailOrder, 'id' | 'orderNumber'>,
  itemName: string,
  qty: number,
  lossCents: number,
  receiptUrl?: string
): FinancialTransactionEntry {
  return {
    date: new Date().toISOString(),
    description: `Return write-off: ${qty} x ${itemName} (Order #${order.orderNumber})`,
    clientOrVendor: 'Internal',
    type: 'expense',
    context: 'Business',
    category: 'Spoilage',
    amount: lossCents / 100,
    paymentMethod: 'Internal',
    hasReceipt: !!receiptUrl,
    receiptUrl,
    relatedOrderId: order.id,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
 * QR / DEEP-LINK SCHEME  (extends the existing clarityflow:// scheme)
 * ════════════════════════════════════════════════════════════════════════════ */

export const PRODUCT_QR_PREFIX = 'clarityflow://product/';
export const ORDER_QR_PREFIX = 'clarityflow://order/';

/** Customer pickup QR value. Token is HMAC-signed server-side, never a raw id. */
export function buildOrderQrValue(signedToken: string): string {
  return `${ORDER_QR_PREFIX}${signedToken}`;
}

export function parseOrderQr(raw: string): string | null {
  const t = raw.trim();
  return t.startsWith(ORDER_QR_PREFIX) ? t.slice(ORDER_QR_PREFIX.length) : null;
}

export function parseProductQr(raw: string): string | null {
  const t = raw.trim();
  return t.startsWith(PRODUCT_QR_PREFIX) ? t.slice(PRODUCT_QR_PREFIX.length) : null;
}

/* ════════════════════════════════════════════════════════════════════════════
 * ORDER LINES
 * ════════════════════════════════════════════════════════════════════════════ */

export const LINE_STATUSES = [
  'pending',    // not yet picked
  'picked',     // qtyScanned === qtyOrdered
  'shorted',    // shelf discrepancy; qtyScanned < qtyOrdered, resolved below
  'refunded',   // shorted quantity refunded to customer
  'backordered',// shorted quantity split into a child order
  'returned',   // came back via RMA
] as const;

export type LineStatus = (typeof LINE_STATUSES)[number];

/* ── Modifiers (options) ──────────────────────────────────────────────────────
 * Per-item option groups: "Size | Small:0, Large:1.50" style. Options never
 * touch stock (same physical item) — they adjust the unit price and label
 * the order line so packing and receipts show exactly what was chosen.
 * The SERVER recomputes every delta from the item doc; client-sent prices
 * are never trusted.
 */

export interface OptionChoice { id: string; label: string; deltaCents: number; }
export interface OptionGroup { id: string; name: string; choices: OptionChoice[]; }

/** Parse editor lines like "Size | Small:0, Medium:0.50, Large:1" */
export function parseOptionGroups(text: string): OptionGroup[] {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, gi) => {
      const [name, rest] = line.split('|');
      if (!name || !rest) return [];
      const choices = rest.split(',')
        .map((c, ci) => {
          const [label, price] = c.split(':');
          if (!label || !label.trim()) return null;
          return {
            id: `c${gi}-${ci}`,
            label: label.trim(),
            deltaCents: Math.round((Number(String(price || '0').trim()) || 0) * 100),
          };
        })
        .filter(Boolean) as OptionChoice[];
      return choices.length > 0 ? [{ id: `g${gi}`, name: name.trim(), choices }] : [];
    })
    .slice(0, 6);
}

export function optionGroupsToText(groups: OptionGroup[] | undefined): string {
  return (groups || [])
    .map((g) => `${g.name} | ${g.choices.map((c) => `${c.label}${c.deltaCents ? `:${(c.deltaCents / 100).toFixed(2)}` : ':0'}`).join(', ')}`)
    .join('\n');
}

/** Resolve selections {groupId: choiceId} → { deltaCents, label } from the ITEM's groups. */
export function resolveOptions(
  groups: OptionGroup[] | undefined,
  selections: Record<string, string> | undefined
): { deltaCents: number; label: string } {
  if (!groups || groups.length === 0) return { deltaCents: 0, label: '' };
  let delta = 0;
  const parts: string[] = [];
  for (const g of groups) {
    const choiceId = selections?.[g.id];
    const choice = g.choices.find((c) => c.id === choiceId) || g.choices[0];
    if (!choice) continue;
    delta += choice.deltaCents;
    parts.push(choice.label);
  }
  return { deltaCents: delta, label: parts.join(' \u00b7 ') };
}

export interface OrderLine {
  lineId: string;
  optionsLabel?: string;              // stable per-line id (not array index)
  productId: string;           // the tenants/{tid}/inventory doc id
  sku: string;                 // snapshot ('' if the item has none)
  barcode: string;             // snapshot of barcode ?? sku
  name: string;                // snapshot at purchase time
  unitPriceCents: number;      // snapshot of msrp at purchase time, in cents
  qtyOrdered: number;
  qtyScanned: number;
  qtyShorted: number;          // portion resolved as refunded/backordered
  qtyReturned: number;
  status: LineStatus;
  shortReason?: string;
}

export type ShortResolution = 'refund' | 'backorder';

/** Build a line from a live inventory item at checkout time. */
export function buildOrderLine(
  item: SellableItem,
  qty: number,
  lineId: string,
  tier: PriceTier = 'retail',
  options?: { deltaCents: number; label: string }
): OrderLine {
  return {
    lineId,
    productId: item.id,
    sku: item.sku ?? '',
    barcode: item.barcode ?? item.sku ?? '',
    name: item.name,
    optionsLabel: options?.label || '',
    unitPriceCents: listingPriceCents(item, tier) + (options?.deltaCents || 0),
    qtyOrdered: qty,
    qtyScanned: 0,
    qtyShorted: 0,
    qtyReturned: 0,
    status: 'pending',
  };
}

/* ════════════════════════════════════════════════════════════════════════════
 * ORDERS
 * ════════════════════════════════════════════════════════════════════════════ */

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;             // ISO-3166 alpha-2, e.g. 'US'
  phone?: string;
}

export interface CurbsideInfo {
  arrivedAt?: string;
  spotOrVehicle?: string;      // "Spot 3" / "white Honda CR-V"
}

export interface RetailOrder {
  id: string;
  tenantId: string;
  orderNumber: number;         // human-friendly sequential per tenant (e.g. 1042)
  stage: OrderStage;
  method: FulfillmentMethod;
  priceTier: PriceTier;        // 'retail' | 'wholesale'
  businessName?: string;       // B2B/wholesale orders
  wholesaleAccountId?: string; // set when a per-account code was used
  poNumber?: string;           // buyer's purchase-order reference
  lines: OrderLine[];

  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  refundedCents: number;       // running total across partial refunds
  totalCents: number;

  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  clientId?: string;           // link to existing ClarityFlow client record

  shippingAddress?: ShippingAddress;   // required when method === 'ship'
  curbside?: CurbsideInfo;

  stripePaymentIntentId?: string;
  qrToken?: string;            // HMAC-signed pickup token (generated server-side)

  batchId?: string;            // current fulfillment batch claim, if any
  parentOrderId?: string;      // set on backorder-split children & replacements
  isReplacement?: boolean;     // $0 replacement order from an RMA

  pendingRefundCents?: number; // shorted-line refunds awaiting execution in Stripe
  holdUntilRestock?: boolean;  // backorder children parked out of the queue
  readyAt?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;

  promiseAt?: string;          // target ready time; drives queue priority
  placedAt: string;
  paidAt?: string;
  packedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

/* ════════════════════════════════════════════════════════════════════════════
 * AUDIT EVENTS  (append-only subcollection — never update, never delete)
 * ════════════════════════════════════════════════════════════════════════════ */

export const ORDER_EVENT_TYPES = [
  'placed',
  'payment_confirmed',
  'stock_reserved',
  'batch_claimed',
  'batch_released',            // manual release back to queue
  'batch_auto_released',       // claim timed out
  'item_scanned',              // meta: { sku, lineId, qtyScanned, qtyOrdered }
  'scan_mismatch',             // meta: { scannedValue } — code not on order / over-scan
  'line_shorted',              // meta: { lineId, qtyShorted, reason, resolution }
  'pick_complete',
  'packed',
  'packing_slip_printed',
  'label_generated',           // meta: { carrier?, trackingNumber? }
  'label_scan_verified',       // label barcode scanned onto the correct box
  'marked_ready',
  'customer_arrived',          // meta: { spotOrVehicle }
  'handoff_scanned',           // customer QR verified at counter/car
  'shipped',
  'completed',
  'cancel_requested',
  'restock_scanned',           // meta: { sku, lineId, qty } — packed-order cancel path
  'cancelled',
  'refund_issued',             // meta: { amountCents, stripeRefundId, scope: 'full'|'partial' }
  'return_opened',             // meta: { returnId }
  'return_resolved',           // meta: { returnId, resolution }
  'replacement_created',       // meta: { childOrderId }
  'backorder_split',           // meta: { childOrderId, lineIds }
  'override',                  // meta: { rule, reason } — manager PIN bypass; always logged
  'note',
] as const;

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export interface OrderEvent {
  id: string;
  type: OrderEventType;
  at: string;
  actorId: string;             // staff uid, 'system', or 'customer'
  actorName: string;
  meta?: Record<string, string | number | boolean>;
}

/** Convenience builder so every event is shaped identically. */
export function buildEvent(
  type: OrderEventType,
  actorId: string,
  actorName: string,
  meta?: OrderEvent['meta']
): Omit<OrderEvent, 'id'> {
  return { type, at: new Date().toISOString(), actorId, actorName, meta };
}

/* ════════════════════════════════════════════════════════════════════════════
 * FULFILLMENT BATCHES  (the turn system)
 * ════════════════════════════════════════════════════════════════════════════ */

export const BATCH_CLAIM_TIMEOUT_MIN = 20;
export const MAX_SHIP_ORDERS_PER_BATCH = 6;

export interface FulfillmentBatch {
  id: string;
  tenantId: string;
  orderIds: string[];
  phase: 'pick' | 'pack';
  assignedTo: string;
  assignedToName: string;
  claimedAt: string;
  active?: boolean;            // queryable open-claim flag; false once done/released
  completedAt?: string;
  releasedAt?: string;
  releaseType?: 'manual' | 'auto' | 'completed';
}

export function claimExpiresAt(claimedAtIso: string): Date {
  const d = new Date(claimedAtIso);
  return new Date(d.getTime() + BATCH_CLAIM_TIMEOUT_MIN * 60_000);
}

export function isClaimStale(batch: FulfillmentBatch, now: Date = new Date()): boolean {
  if (batch.completedAt || batch.releasedAt) return false;
  return now > claimExpiresAt(batch.claimedAt);
}

/**
 * Queue priority: lower number = picked sooner.
 * Curbside/counter ASAP orders beat ship orders; within a tier, promise time
 * then FIFO by paid time.
 */
export function queuePriority(order: RetailOrder): number {
  const tier =
    order.method === 'curbside' ? 0 :
    order.method === 'counter'  ? 1 :
    order.method === 'in_store' ? 2 : 3; // ship last
  const anchor = order.promiseAt ?? order.paidAt ?? order.placedAt;
  return tier * 1e13 + new Date(anchor).getTime();
}

/* ════════════════════════════════════════════════════════════════════════════
 * SCAN ENGINE  (100% accuracy gates)
 * ════════════════════════════════════════════════════════════════════════════ */

export type ScanResult =
  | { ok: true; lineId: string; qtyScanned: number; qtyOrdered: number; pickComplete: boolean }
  | { ok: false; code: 'unknown_sku' | 'over_scan' | 'line_closed'; message: string };

/**
 * Apply one scan during picking. Accepts a physical barcode, a SKU, or a
 * clarityflow://product/{id} label (the scheme the inventory page already
 * prints). Pure: returns the result and the updated lines array; the caller
 * persists inside a transaction and appends the item_scanned or
 * scan_mismatch event.
 */
/**
 * Canonical forms of a scanned/stored code for tolerant matching:
 *  - trimmed raw and uppercased (SKUs are case-insensitive in the real world)
 *  - digits-only form, with and without leading zeros — phones' native
 *    detectors often report UPC-A (12 digits) as EAN-13 with a leading 0,
 *    so "0123456789012" and "123456789012" must be treated as the same code.
 */
export function codeVariants(value: string): Set<string> {
  const out = new Set<string>();
  const raw = String(value || '').trim();
  if (!raw) return out;
  out.add(raw);
  out.add(raw.toUpperCase());
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 6) {
    out.add(digits);
    out.add(digits.replace(/^0+/, ''));
    if (digits.length === 12) out.add('0' + digits); // UPC-A as EAN-13
  }
  return out;
}

export function codesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const va = codeVariants(a);
  for (const v of codeVariants(b)) if (va.has(v)) return true;
  return false;
}

export function applyScan(lines: OrderLine[], scannedValue: string): {
  result: ScanResult;
  lines: OrderLine[];
} {
  const raw = scannedValue.trim();
  const productIdFromQr = parseProductQr(raw);

  const idx = lines.findIndex((l) =>
    productIdFromQr !== null
      ? l.productId === productIdFromQr
      : l.productId === raw ||
        l.productId.toLowerCase() === raw.toLowerCase() ||
        codesMatch(l.barcode, raw) || codesMatch(l.sku, raw)
  );

  if (idx === -1) {
    return {
      result: {
        ok: false,
        code: 'unknown_sku',
        message: `Scanned code "${raw}" is not on this order.`,
      },
      lines,
    };
  }

  const line = lines[idx];

  if (line.status === 'shorted' || line.status === 'refunded' || line.status === 'backordered') {
    return {
      result: {
        ok: false,
        code: 'line_closed',
        message: `${line.name} was marked ${line.status}; reopen the line before scanning.`,
      },
      lines,
    };
  }

  if (line.qtyScanned >= line.qtyOrdered) {
    return {
      result: {
        ok: false,
        code: 'over_scan',
        message: `${line.name} already has all ${line.qtyOrdered} scanned.`,
      },
      lines,
    };
  }

  const updatedLine: OrderLine = {
    ...line,
    qtyScanned: line.qtyScanned + 1,
    status: line.qtyScanned + 1 === line.qtyOrdered ? 'picked' : 'pending',
  };
  const nextLines = [...lines.slice(0, idx), updatedLine, ...lines.slice(idx + 1)];

  return {
    result: {
      ok: true,
      lineId: line.lineId,
      qtyScanned: updatedLine.qtyScanned,
      qtyOrdered: line.qtyOrdered,
      pickComplete: isPickComplete(nextLines),
    },
    lines: nextLines,
  };
}

/**
 * Mark a line (or part of it) shorted due to a shelf discrepancy.
 * Pure: caller persists, appends line_shorted event, writes the
 * short_adjustment stock correction, and (for 'refund') issues the
 * partial Stripe refund.
 */
export function shortLine(
  lines: OrderLine[],
  lineId: string,
  reason: string,
  resolution: ShortResolution
): { lines: OrderLine[]; qtyShorted: number; refundCents: number } {
  const idx = lines.findIndex((l) => l.lineId === lineId);
  if (idx === -1) throw new Error(`Line ${lineId} not found`);

  const line = lines[idx];
  const qtyShorted = line.qtyOrdered - line.qtyScanned;
  if (qtyShorted <= 0) throw new Error(`Line ${lineId} is fully scanned; nothing to short.`);

  const updated: OrderLine = {
    ...line,
    qtyShorted,
    status: resolution === 'refund' ? 'refunded' : 'backordered',
    shortReason: reason,
  };

  return {
    lines: [...lines.slice(0, idx), updated, ...lines.slice(idx + 1)],
    qtyShorted,
    refundCents: resolution === 'refund' ? qtyShorted * line.unitPriceCents : 0,
  };
}

/** Every line is either fully scanned or explicitly resolved. Nothing silent. */
export function isPickComplete(lines: OrderLine[]): boolean {
  return lines.every(
    (l) =>
      l.qtyScanned === l.qtyOrdered ||
      l.status === 'shorted' ||
      l.status === 'refunded' ||
      l.status === 'backordered'
  );
}

/** Lines that still have sellable quantity after shorting (for totals & slips). */
export function fulfilledQty(line: OrderLine): number {
  return line.qtyOrdered - line.qtyShorted;
}

/* ════════════════════════════════════════════════════════════════════════════
 * TRANSITION GUARDS
 * ════════════════════════════════════════════════════════════════════════════ */

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * The one gatekeeper. Every stage change — API route, board button, webhook —
 * must pass through this. UI buttons that would fail should render disabled
 * with the reason as the tooltip.
 */
export function canAdvance(order: RetailOrder, target: OrderStage): GuardResult {
  if (!LEGAL_TRANSITIONS[order.stage].includes(target)) {
    return { ok: false, reason: `Cannot go from ${order.stage} to ${target}.` };
  }

  switch (target) {
    case 'packed':
      if (!isPickComplete(order.lines)) {
        return { ok: false, reason: 'Every line must be fully scanned or explicitly shorted.' };
      }
      return { ok: true };

    case 'arrived':
      if (order.method !== 'curbside') {
        return { ok: false, reason: 'Only curbside orders can be marked arrived.' };
      }
      return { ok: true };

    case 'shipped':
      if (order.method !== 'ship') {
        return { ok: false, reason: 'Only ship orders can be shipped.' };
      }
      return { ok: true };

    case 'handed_off':
      if (order.method === 'ship') {
        return { ok: false, reason: 'Ship orders complete via shipped, not handoff.' };
      }
      return { ok: true };

    case 'cancelled':
      return canCancel(order);

    default:
      return { ok: true };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * CANCELLATION
 * ════════════════════════════════════════════════════════════════════════════ */

export function canCancel(order: RetailOrder): GuardResult {
  if (TERMINAL_STAGES.includes(order.stage)) {
    return { ok: false, reason: 'Order is already in a terminal state.' };
  }
  if (['arrived', 'shipped', 'handed_off'].includes(order.stage)) {
    return { ok: false, reason: 'Too late to cancel; open a return instead.' };
  }
  return { ok: true };
}

export interface CancellationPlan {
  refundCents: number;               // remaining balance to refund via Stripe
  releaseReservations: boolean;      // free stockReserved holds (paid+ stages)
  requiresRestockScan: boolean;      // packed orders: items must scan back in
  releaseBatch: boolean;             // free any active batch claim
}

/**
 * What a cancellation must do, given where the order is. The API route
 * executes this plan inside a transaction; 'cancelled' is only written after
 * every step (including restock scans, when required) has completed.
 */
export function cancellationPlan(order: RetailOrder): CancellationPlan {
  return {
    refundCents: order.stage === 'placed' ? 0 : order.totalCents - order.refundedCents,
    releaseReservations: order.stage !== 'placed',
    requiresRestockScan: order.stage === 'packed' || order.stage === 'ready',
    releaseBatch: order.batchId !== undefined,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
 * RETURNS / RMA  (defective, damaged, wrong item)
 * ════════════════════════════════════════════════════════════════════════════ */

export const RETURN_REASONS = [
  'damaged_in_transit',
  'defective',
  'wrong_item',
  'changed_mind',
  'other',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RETURN_RESOLUTIONS = ['refund', 'replacement', 'store_credit'] as const;
export type ReturnResolution = (typeof RETURN_RESOLUTIONS)[number];

/** Where each returned unit physically goes — nothing damaged re-enters stock. */
export type ReturnDisposition = 'restock' | 'write_off';

export interface ReturnLine {
  lineId: string;              // references the original OrderLine
  sku: string;
  name: string;
  qty: number;
  reason: ReturnReason;
  disposition?: ReturnDisposition;   // set at receiving scan
  dispositionScannedAt?: string;
}

export interface RetailReturn {
  id: string;
  tenantId: string;
  orderId: string;
  orderNumber: number;
  lines: ReturnLine[];
  resolution: ReturnResolution;
  status: 'open' | 'received' | 'resolved' | 'rejected';
  photoUrls: string[];         // evidence via existing document-upload infra
  refundCents?: number;
  storeCreditCents?: number;
  replacementOrderId?: string; // $0 order that re-enters the normal pipeline
  openedBy: string;
  openedAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  notes?: string;
}

export function returnRefundCents(order: RetailOrder, lines: ReturnLine[]): number {
  return lines.reduce((sum, rl) => {
    const orig = order.lines.find((l) => l.lineId === rl.lineId);
    return sum + (orig ? rl.qty * orig.unitPriceCents : 0);
  }, 0);
}

/** A return may only be resolved once every unit has a scanned disposition. */
export function isReturnReceivable(ret: RetailReturn): GuardResult {
  const missing = ret.lines.filter((l) => !l.disposition);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Scan a disposition (restock or write-off) for: ${missing
        .map((l) => l.name)
        .join(', ')}`,
    };
  }
  return { ok: true };
}

/* ════════════════════════════════════════════════════════════════════════════
 * DISPLAY HELPERS
 * ════════════════════════════════════════════════════════════════════════════ */

export const STAGE_LABELS: Record<OrderStage, string> = {
  placed: 'Awaiting Payment',
  paid: 'In Queue',
  picking: 'Picking',
  packed: 'Packed',
  ready: 'Ready',
  arrived: 'Customer Here',
  shipped: 'Shipped',
  handed_off: 'Picked Up',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const METHOD_LABELS: Record<FulfillmentMethod, string> = {
  counter: 'Counter Pickup',
  curbside: 'Curbside',
  in_store: 'In-Store',
  ship: 'Shipping',
};

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function orderDisplayNumber(order: Pick<RetailOrder, 'orderNumber'>): string {
  return `#${String(order.orderNumber).padStart(4, '0')}`;
}
