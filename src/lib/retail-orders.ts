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

// The engine's ONE import, and it is also pure: every "by this date" in here
// is a calendar day, and a calendar day only becomes an instant once you know
// whose clock is being read. Deciding that inline is how a shop ends up late
// on an order it shipped on time.
import { codeForm, gtinValid } from './code-form';
import { effectiveUnitCents } from './retail-swap';
import { taxShareCents } from './restocking';
import { filesOf } from './digital-product';
import { deadlineAt } from './tenant-time';
import { promiseCarrier, promiseFor, scheduleFrom, type ShipSchedule } from './ship-promise';

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
  'completed',   // terminal success: handed over (pickup), or delivered (ship)
  'cancelled',   // terminal: refunded, reservations released
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
  placed:     ['paid', 'completed', 'cancelled'],       // 'completed' = a download-only order, done once paid
  paid:       ['picking', 'cancelled'],
  picking:    ['packed', 'paid', 'cancelled'],          // 'paid' = batch released back to queue
  packed:     ['ready', 'shipped', 'cancelled'],         // a curbside customer already outside: ready, and straight to arrived (markReady)
  ready:      ['arrived', 'completed', 'shipped', 'cancelled'],
  arrived:    ['completed'],
  shipped:    ['completed'],
  completed:  [],
  cancelled:  [],
};

export const TERMINAL_STAGES: OrderStage[] = ['completed', 'cancelled'];

/* ════════════════════════════════════════════════════════════════════════════
 * INVENTORY BRIDGE  (existing tenants/{tid}/inventory items, type 'retail')
 * ════════════════════════════════════════════════════════════════════════════ */

/** Shape of a batch on an existing InventoryItem. Sold earliest-expiry first, then oldest first. The receiving
 *  screens write `expirationDate`; `expiryDate` is the older spelling, read for safety. */
export interface InventoryBatchRef {
  id: string;
  stock: number;
  costPerUnit: number;
  receivedDate: string;
  expiryDate?: string;
  expirationDate?: string;
  lot?: string;
}

export const batchExpiry = (b: { expirationDate?: any; expiryDate?: any }): number => {
  const v = b.expirationDate ?? b.expiryDate; if (!v) return Infinity;
  const t = typeof v === 'object' && typeof v.toDate === 'function' ? v.toDate().getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : Infinity;
};

/** Units in batches that are past their expiry date. They stay in stock for the record but are never sold online. */
export function expiredUnits(item: { batches?: any[] }, now = Date.now()): number {
  return (item.batches || []).reduce((a: number, b: any) => a + (batchExpiry(b) < now ? Math.max(0, Number(b.stock) || 0) : 0), 0);
}

/**
 * OPTIONAL fields the retail engine reads/writes on existing InventoryItem
 * docs. All optional — no migration needed; absent means the default noted.
 */
export interface RetailInventoryFields {
  stockReserved?: number;      // held by paid, unfulfilled online orders (default 0)
  showOnline?: boolean;        // listed on the public storefront (default false)
  barcode?: string;            // physical UPC/Code-128; falls back to sku
  optionGroups?: OptionGroup[]; // buyer choices; a choice may BE another item (a variant)
  casePack?: number;           // units per sealed wholesale case (>1 enables case scanning)
  caseBarcode?: string;        // the case carton's own code (ITF-14/UPC)
  palletPack?: number;         // CASES per pallet or master carton (not units)
  palletBarcode?: string;      // the pallet label's own code (SSCC/ITF-14)
  digital?: boolean;           // nothing physical ships — delivered by link on payment
  digitalUrl?: string;         // the delivery destination (course, PDF, download page)
  digitalFilePath?: string;    // private storage path (never a public URL)
  digitalFileName?: string;    // what the buyer sees it called
  digitalAccessDays?: number;  // 0/absent = access for good; N = N days from purchase
  onlineDescription?: string;  // storefront copy (name/msrp come from the item)
  imageUrls?: string[];
  lowStockThreshold?: number;
  allowBackorder?: boolean;    // default false
  preorder?: boolean;          // sellable before stock exists, with a promised date
  preorderEtaAt?: string;      // ISO date the shop promises to ship by
  leadDays?: { min: number; max: number } | null; // made to order: business days to ship, instead of the usual time
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

/** What the ONLINE shop may sell: sellable stock minus the units the shop keeps back for in-store customers. */
export function onlineSellable(item: Pick<SellableItem, 'totalStock' | 'stockReserved'> & { storeHoldback?: number }): number {
  return sellableStock(item) - Math.max(0, Math.floor(Number((item as any).storeHoldback) || 0)) - expiredUnits(item as any);
}

/**
 * WHY an item isn't in the shop — the same four rules isStorefrontVisible
 * enforces, but as reasons a person can act on.
 *
 * The rules lived only inside a boolean, so Inventory could show a perfectly
 * healthy-looking product that silently never appeared online and say nothing
 * about it. A gate that can refuse without explaining is a gate that makes
 * people distrust the system. Same source of truth, two shapes: the boolean
 * for the server, the reasons for the human.
 */
export type PreorderState = {
  isPreorder: boolean;
  open: boolean;
  reason: 'ok' | 'closed' | 'sold_out' | 'not_preorder';
  closesAt: string | null;
  etaAt: string | null;
  remaining: number | null;
};

/**
 * Is this pre-order still joinable? Two independent doors close a run — the
 * CUTOFF (a date, so the shop can place its supplier order) and the CAP (a
 * quantity, so a limited run can't be oversold). Either one closing is
 * enough, and both are re-checked server-side at checkout: a storefront that
 * merely hides the button is not a rule.
 *
 * The cutoff includes the whole day it names — someone ordering at 11pm on
 * the last day joined the run, which is what "closes March 3" means to a
 * human reading it.
 */
export function preorderState(item: {
  preorder?: boolean; preorderEtaAt?: string; preorderClosesAt?: string;
  preorderLimit?: number; preorderSold?: number;
}, timeZone?: string | null): PreorderState {
  if (item.preorder !== true) {
    return { isPreorder: false, open: false, reason: 'not_preorder', closesAt: null, etaAt: null, remaining: null };
  }
  const closesAt = item.preorderClosesAt || null;
  const etaAt = item.preorderEtaAt || null;
  const limit = Math.max(0, Math.floor(Number(item.preorderLimit) || 0));
  const sold = Math.max(0, Math.floor(Number(item.preorderSold) || 0));
  const remaining = limit > 0 ? Math.max(0, limit - sold) : null;

  if (closesAt) {
    // "Closes March 3" includes the whole of March 3 ON THE SHOP'S CLOCK.
    // This used to build the instant with a bare string, which JavaScript
    // reads in whatever zone the code happens to be running in — so the same
    // run closed at 7pm Eastern on Vercel and at midnight in the browser.
    const end = Date.parse(String(deadlineAt(closesAt, timeZone) || ''));
    if (Number.isFinite(end) && end < Date.now()) {
      return { isPreorder: true, open: false, reason: 'closed', closesAt, etaAt, remaining };
    }
  }
  if (remaining !== null && remaining <= 0) {
    return { isPreorder: true, open: false, reason: 'sold_out', closesAt, etaAt, remaining: 0 };
  }
  return { isPreorder: true, open: true, reason: 'ok', closesAt, etaAt, remaining };
}

export function storefrontBlockers(item: Partial<SellableItem> & { type?: string; status?: string }): string[] {
  const reasons: string[] = [];
  if (item.type !== 'retail') reasons.push('Not a retail product');
  if (item.status === 'archived') reasons.push('Archived');
  if (item.showOnline !== true) reasons.push('Show online is off');
  if (!((item.msrp ?? 0) > 0)) reasons.push('No price set');
  if (!hasDigitalContent(item)) reasons.push('A download with no file or link yet');
  return reasons;
}

export function isStorefrontVisible(item: SellableItem): boolean {
  return (
    item.type === 'retail' &&
    item.status !== 'archived' &&
    item.showOnline === true &&
    (item.msrp ?? 0) > 0 &&
    hasDigitalContent(item)
  );
}

/** A download has something to give its buyer: a file or a link (lib/digital-product). Anything else passes. */
function hasDigitalContent(item: any): boolean {
  if (item?.digital !== true || item?.digitalReady === true) return true;
  return filesOf(item).length > 0 || !!String(item?.digitalUrl || '').trim();
}

/** Prices are stored in dollars; the engine works in cents (Stripe-safe). */
export function listingPriceCents(
  item: Pick<SellableItem, 'msrp' | 'wholesalePriceDollars'>,
  tier: PriceTier = 'retail'
): number {
  // A wholesale price of 0 (or none) isn't a price: the retail one stands.
  const dollars = tier === 'wholesale'
    ? (Number(item.wholesalePriceDollars) > 0 ? Number(item.wholesalePriceDollars) : Number(item.msrp) || 0)
    : Number(item.msrp) || 0;
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
  qty: number,
  now = Date.now()
): { batches: InventoryBatchRef[]; depleted: number; shortfall: number; cogsCents: number; taken: { batchId: string; lot: string; expirationDate: string; qty: number }[] } {
  // Earliest expiry first (expired batches last, since they shouldn't be sold), then oldest received.
  const rank = (b: InventoryBatchRef) => { const e = batchExpiry(b); return e < now ? Infinity : Number.isFinite(e) ? e : 8.64e15; };
  const sorted = [...(batches ?? [])]
    .map((b) => ({ ...b }))
    .sort((a, b) => rank(a) - rank(b) || new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());

  let remaining = qty;
  let cogsCents = 0;
  const taken: { batchId: string; lot: string; expirationDate: string; qty: number }[] = [];
  for (const batch of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(batch.stock, remaining);
    if (take <= 0) continue;
    batch.stock -= take;
    remaining -= take;
    cogsCents += Math.round(take * (batch.costPerUnit ?? 0) * 100);
    const exp = batchExpiry(batch);
    taken.push({ batchId: batch.id, lot: String(batch.lot || ''), expirationDate: Number.isFinite(exp) ? new Date(exp).toISOString().slice(0, 10) : '', qty: take });
  }

  return { batches: sorted, depleted: qty - remaining, shortfall: remaining, cogsCents, taken };
}

/** Stock that turned out not to be there (a short, a swap's missing item): take it out of the batches as well as the
 *  total, so the next sale (which recounts the total from the batches) can't quietly put it back. */
export function shrinkStock(item: { totalStock?: number; batches?: any[] }, qty: number): { totalStock: number; batches?: InventoryBatchRef[] } {
  const total = Math.max(0, (Number(item.totalStock) || 0) - qty);
  if (!Array.isArray(item.batches) || item.batches.length === 0) return { totalStock: total };
  const { batches } = depleteBatchesFIFO(item.batches as InventoryBatchRef[], qty);
  return { totalStock: batches.reduce((a, b) => a + (Number(b.stock) || 0), 0), batches: JSON.parse(JSON.stringify(batches)) };
}

/** Units coming back to the shelf (a voided sale): they go back into the batch a sale would have taken them from. */
export function returnToBatches(batches: InventoryBatchRef[] | undefined, qty: number, now = Date.now()): InventoryBatchRef[] | null {
  if (!Array.isArray(batches) || !batches.length || qty <= 0) return null;
  const copy = batches.map((b) => ({ ...b }));
  const live = copy.filter((b) => batchExpiry(b) >= now);
  const pool = live.length ? live : copy;
  const target = [...pool].sort((a, b) => batchExpiry(a) - batchExpiry(b) || new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime())[0];
  target.stock = (Number(target.stock) || 0) + qty;
  return copy;
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
  category: 'Retail' | 'Spoilage' | 'Refunds';
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
    category: 'Refunds',
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

export interface OptionChoice {
  id: string;
  label: string;
  deltaCents: number;
  /**
   * The inventory item this choice IS.
   *
   * The distinction that decides whether stock can ever be right: an option
   * that consumes its own units on its own shelf (15ml vs 30ml, shade 04 vs
   * shade 07) is a PRODUCT, and must be counted as one. An option that only
   * changes the price of the same physical thing (gift wrap, engraving) is
   * decoration and needs no stock of its own.
   *
   * When set, this choice's stock, SKU and barcode come from that item, and
   * buying it decrements THAT item — so "sold out in 30ml" becomes something
   * the system can know instead of something the shelf knows and the app
   * doesn't. Absent = decoration, as before.
   */
  variantProductId?: string;
}
export interface OptionGroup { id: string; name: string; choices: OptionChoice[]; }

/* Which product a set of choices sells, what it costs and how many a listing has, and which products the shop lists on
 * their own, are worked out in one place for the shop, checkout, the desk and the codes check: lib/variants. */

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
          const [label, price, variantId] = c.split(':');
          if (!label || !label.trim()) return null;
          return {
            id: `c${gi}-${ci}`,
            label: label.trim(),
            deltaCents: Math.round((Number(String(price || '0').trim()) || 0) * 100),
            ...(variantId && variantId.trim() ? { variantProductId: variantId.trim() } : {}),
          };
        })
        .filter(Boolean) as OptionChoice[];
      return choices.length > 0 ? [{ id: `g${gi}`, name: name.trim(), choices }] : [];
    })
    .slice(0, 6);
}

export function optionGroupsToText(groups: OptionGroup[] | undefined): string {
  // Round-trips variantProductId too, so opening and saving the editor can
  // never silently drop the link between a choice and its shelf.
  return (groups || [])
    .map((g) => `${g.name} | ${g.choices.map((c) => {
      const price = c.deltaCents ? (c.deltaCents / 100).toFixed(2) : '0';
      return c.variantProductId ? `${c.label}:${price}:${c.variantProductId}` : `${c.label}:${price}`;
    }).join(', ')}`)
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
  casePack?: number;           // units per sealed case (snapshot; >1 enables case scanning)
  caseBarcode?: string;        // the CASE's own code (ITF-14/UPC on the carton)
  palletPack?: number;         // CASES per pallet (snapshot)
  palletBarcode?: string;      // the pallet label's own code (snapshot)
  codes?: string[];            // the product's other unit codes at checkout: UPC / GTIN / EAN / extra barcodes (snapshot)
  testOfProductId?: string;    // a test order's line: the real product it stands for (its codes scan; no stock moves)
  listingId?: string;          // sold as a variant: the listing it was chosen on (productId is the variant, lib/variants)
  choices?: Record<string, string>; // the choice taken in each of the listing's groups, by group id (optionsLabel has their words)
  qtyPacked?: number;          // second-scan count at the box (pack verification)
  digital?: boolean;           // snapshot: this line needs no picking, packing, or postage
  digitalUrl?: string;         // snapshot of the delivery link at purchase time
  digitalAccessDays?: number;  // snapshot of the access window SOLD (later policy changes never shorten it)
  preorder?: boolean;          // bought before stock existed
  preorderEtaAt?: string;      // the date promised AT PURCHASE — the promise that binds
  leadDays?: { min: number; max: number }; // made to order, as sold: the ship-by date counted from it
}

export type ShortResolution = 'refund' | 'backorder';

/** The product's other unit codes (UPC, GTIN, EAN, extra barcodes), beyond its barcode and SKU, kept on the line so
 *  any of them scans at the bench. */
function extraCodes(item: any): { codes?: string[] } {
  const have = new Set([String(item?.barcode ?? '').trim(), String(item?.sku ?? '').trim()]);
  const list = [item?.upc, item?.gtin, item?.ean, ...(Array.isArray(item?.barcodes) ? item.barcodes : [])]
    .map((c) => String(c ?? '').trim()).filter((c) => c && !have.has(c));
  const codes = [...new Set(list)].slice(0, 10);
  return codes.length ? { codes } : {};
}

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
    ...(Number(item.casePack) > 1 ? { casePack: Math.floor(Number(item.casePack)) } : {}),
    ...(item.caseBarcode ? { caseBarcode: String(item.caseBarcode) } : {}),
    ...(Number(item.palletPack) > 1 ? { palletPack: Math.floor(Number(item.palletPack)) } : {}),
    ...(item.palletBarcode ? { palletBarcode: String(item.palletBarcode) } : {}),
    ...extraCodes(item),
    ...(item.preorder === true ? {
      preorder: true,
      ...(item.preorderEtaAt ? { preorderEtaAt: String(item.preorderEtaAt) } : {}),
    } : {}),
    // Made to order travels with the line as sold, so a later change to the product can't move this order's date.
    ...(item.digital !== true && Number(item.leadDays?.max) > 0 ? {
      leadDays: { min: Math.max(1, Math.floor(Number(item.leadDays?.min) || Number(item.leadDays?.max))), max: Math.floor(Number(item.leadDays?.max)) },
    } : {}),
    ...(item.digital === true ? {
      digital: true,
      ...(item.digitalUrl ? { digitalUrl: String(item.digitalUrl) } : {}),
      ...(Number(item.digitalAccessDays) > 0 ? { digitalAccessDays: Math.floor(Number(item.digitalAccessDays)) } : {}),
    } : {}),
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
  /** They tapped "on my way" — the shop can start moving before they park. */
  onWayAt?: string;
  /** Minutes away when they said so. From a one-time location share if they
   *  allowed it, otherwise their own estimate. Never treated as a promise. */
  etaMinutes?: number;
  /** How the check-in happened, so a person can tell a scanned sign from a
   *  typed guess from a phone that decided it was close enough. */
  checkInSource?: 'manual' | 'sign_qr' | 'geo_auto';
  /** Distance in metres at auto-check-in — evidence, not a claim. */
  arrivedAccuracyM?: number;
  /** Someone set off with the order — the customer sees this, the board
   *  keeps counting, and the gap between this and handoff is how long the
   *  walk actually takes. */
  bringingOutAt?: string;
  bringingOutBy?: string;
  /**
   * "Please bring it to my window — I can't come in."
   *
   * For some people curbside is not convenience, it is ACCESS: a wheelchair
   * in the boot, a sleeping baby, a bad day. This flag is set by the customer
   * and shown to staff FIRST, above everything else on the card, because a
   * note nobody reads until after they have called the person inside is not
   * an accommodation.
   */
  bringToVehicle?: boolean;
  /** Their own words — "silver Civic, I'll wave", "please knock, I'm deaf". */
  accessNote?: string;
}

/**
 * How long someone has been waiting outside, in whole minutes.
 *
 * The number that turns "did anyone go out?" into something a person can see
 * from across the room. Returns null when they haven't arrived — an order
 * nobody is waiting on shouldn't be shown a clock.
 */
/**
 * Orders that belong to the same trip.
 *
 * A mother and daughter both order; one car comes. The board shows two
 * arrivals, someone walks out twice, and the second trip finds an empty
 * space. Matching on the phone number they gave — the one thing a shared
 * trip actually shares — lets the board say "2 orders, one car" and send a
 * person out once.
 *
 * Deliberately phone-only: matching on surname would group strangers, and
 * matching on address would group flatmates who came separately.
 */
export function groupBySamePickup<T extends { id: string; customerPhone?: string; customerName?: string; curbside?: CurbsideInfo }>(
  orders: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const o of orders) {
    const digits = String(o.customerPhone || '').replace(/\D/g, '');
    const key = digits.length >= 7 ? `p:${digits.slice(-10)}` : `o:${o.id}`;
    const list = groups.get(key) || [];
    list.push(o);
    groups.set(key, list);
  }
  return groups;
}

/** How many OTHER orders are waiting on the same trip. */
export function samePickupCount<T extends { id: string; customerPhone?: string }>(order: T, all: T[]): number {
  const digits = String(order.customerPhone || '').replace(/\D/g, '');
  if (digits.length < 7) return 0;
  const tail = digits.slice(-10);
  return all.filter((o) => o.id !== order.id && String(o.customerPhone || '').replace(/\D/g, '').slice(-10) === tail).length;
}

/**
 * The same clock, for a guest in a chair.
 *
 * A lounge request has exactly the curbside problem in a different room: the
 * guest asks for something, hears nothing, and cannot tell whether anyone saw
 * it. They are also stuck — a person mid-service can't go and check. So the
 * wait matters MORE here, not less, and it deserves the same escalating
 * treatment rather than a list nobody is watching.
 */
export function requestWaitMinutes(
  request: { requestedAt?: string; status?: string },
  now: Date = new Date(),
): number | null {
  if (['delivered', 'cancelled', 'done'].includes(String(request.status || ''))) return null;
  const t = Date.parse(String(request.requestedAt || ''));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 60000));
}

/** Minutes after which a waiting guest deserves more than a list entry. */
export const LOUNGE_ESCALATE_MIN = 6;

/**
 * Anyone still waiting to be served.
 *
 * The closing-time failure: the last person locks up while a car is still in
 * the bay and a guest is still expecting a drink. Nobody is malicious — the
 * waiting people are on two different screens, and neither is the one you
 * look at on the way out. This gathers both into one answer so a shop can ask
 * "is anyone still out there?" and get a number rather than a feeling.
 */
export function stillWaiting(
  orders: { id: string; orderNumber?: number; stage?: string; customerName?: string; curbside?: CurbsideInfo }[],
  requests: { id: string; status?: string; requestedAt?: string; clientName?: string; itemName?: string }[],
  now: Date = new Date(),
): {
  curbside: { id: string; label: string; waitedMin: number }[];
  lounge: { id: string; label: string; waitedMin: number }[];
  total: number;
} {
  const curbside = orders
    .filter((o) => o.stage === 'arrived' && !!o.curbside?.arrivedAt)
    .map((o) => ({
      id: o.id,
      label: `#${String(o.orderNumber ?? '').padStart(4, '0')}${o.customerName ? ` · ${o.customerName}` : ''}${o.curbside?.spotOrVehicle ? ` · ${o.curbside.spotOrVehicle}` : ''}`,
      waitedMin: curbsideWaitMinutes(o, now) ?? 0,
    }))
    .sort((a, b) => b.waitedMin - a.waitedMin);

  const lounge = requests
    .filter((r) => !['delivered', 'cancelled'].includes(String(r.status || '')))
    .map((r) => ({
      id: r.id,
      label: `${r.clientName || 'Guest'}${r.itemName ? ` · ${r.itemName}` : ''}`,
      waitedMin: requestWaitMinutes(r, now) ?? 0,
    }))
    .sort((a, b) => b.waitedMin - a.waitedMin);

  return { curbside, lounge, total: curbside.length + lounge.length };
}

/**
 * How long people actually waited, from what was already recorded.
 *
 * Three timestamps already exist on every served order — arrived, someone set
 * off, handed over — so the report costs nothing to collect and answers the
 * only question that matters: are we getting slower? Median as well as
 * average, because one forgotten car shouldn't make a good week look bad.
 */
export function curbsideWaitStats(
  orders: { curbside?: CurbsideInfo; completedAt?: string; handedOffAt?: string }[],
): { served: number; medianMin: number | null; averageMin: number | null; worstMin: number | null; neverCollected: number } {
  const waits: number[] = [];
  let neverCollected = 0;
  for (const o of orders) {
    const arrived = Date.parse(String(o.curbside?.arrivedAt || ''));
    if (!Number.isFinite(arrived)) continue;
    if ((o.curbside as any)?.staleFlaggedAt) neverCollected += 1;
    const done = Date.parse(String(o.handedOffAt || o.completedAt || o.curbside?.bringingOutAt || ''));
    if (!Number.isFinite(done) || done < arrived) continue;
    waits.push(Math.round((done - arrived) / 60000));
  }
  if (waits.length === 0) return { served: 0, medianMin: null, averageMin: null, worstMin: null, neverCollected };
  const sorted = [...waits].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    served: waits.length,
    medianMin: sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2),
    averageMin: Math.round(waits.reduce((a, b) => a + b, 0) / waits.length),
    worstMin: sorted[sorted.length - 1],
    neverCollected,
  };
}

export function curbsideWaitMinutes(order: { curbside?: CurbsideInfo }, now: Date = new Date()): number | null {
  const at = order.curbside?.arrivedAt;
  if (!at) return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 60000));
}

/**
 * Straight-line distance in metres (haversine).
 *
 * Deliberately simple: this is used to decide "are they in the car park",
 * not to navigate. Road distance would be more accurate and would cost an
 * API call per position update, which is the wrong trade for a 100m question.
 */
export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Metres within which "they're here" is true enough to act on. */
export const CURBSIDE_GEOFENCE_M = 100;

/**
 * A rough drive-time estimate from a straight-line distance.
 *
 * Honest about what it is: distance ÷ an average town speed, with a floor of
 * one minute and a cap of an hour. It exists so the shop can start packing at
 * roughly the right moment, not to be right to the minute — which is why the
 * customer is always shown "about N minutes" and can override it.
 */
export function roughEtaMinutes(metres: number, kmh = 30): number {
  const minutes = (metres / 1000) / kmh * 60;
  return Math.max(1, Math.min(60, Math.round(minutes * 1.3)));
}

export interface RetailOrder {
  id: string;
  tipCents?: number;
  pickupAt?: string;
  tenantId: string;
  orderNumber: number;         // human-friendly sequential per tenant (e.g. 1042)
  stage: OrderStage;
  method: FulfillmentMethod;
  priceTier: PriceTier;        // 'retail' | 'wholesale'
  businessName?: string;       // B2B/wholesale orders
  wholesaleAccountId?: string; // set when a per-account code was used
  wholesaleDiscountPct?: number; // the account's extra discount when the order was placed (a swap is priced the same way)
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

// Every kind of step an order's history holds, each described once in lib/order-events (EVENT_INFO).
export const ORDER_EVENT_TYPES = [
  'placed',
  'payment_confirmed',
  'stock_reserved',
  'batch_claimed',
  'batch_released',            // manual release back to queue
  'batch_auto_released',       // claim timed out
  'item_scanned',              // meta: { sku, lineId, qtyScanned, qtyOrdered }
  'scan_mismatch',             // meta: { scannedValue } — code not on order / over-scan
  'line_shorted',
  'line_reopened',              // meta: { lineId, qtyShorted, reason, resolution }
  'pick_complete',
  'packed',
  'label_generated',           // meta: { carrier?, trackingNumber? }
  'label_scan_verified',       // the label's barcode scanned onto the right box
  'marked_ready',
  'customer_arrived',          // meta: { spotOrVehicle }
  'handoff_scanned',           // customer QR verified at counter/car
  'shipped',
  'manifested',                // meta: { manifestId, carrier } — on the day's USPS form
  'completed',
  'cancelled',
  'refund_issued',             // meta: { amountCents, stripeRefundId, scope: 'full'|'partial' }
  'return_opened',             // meta: { returnId }
  'return_resolved',           // meta: { returnId, resolution }
  'replacement_created',       // meta: { childOrderId }
  'backorder_split',           // meta: { childOrderId, lineIds }
  'address_updated',           // meta: { from, to } — by the team, or the customer with a code
  'held_for_review',           // meta: { reason } — a manager holds it before packing
  'hold_released',
  'override',                  // meta: { rule, reason } — manager PIN bypass; always logged
  'message_failed',            // meta: { what, tries, why } — a step's message didn't reach the customer (lib/order-outbox)
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
/* ════════════════════════════════════════════════════════════════════════════
 * PROMISES — first in, first out, unless something is actually due sooner
 * ════════════════════════════════════════════════════════════════════════════
 * Two fairness rules people can feel:
 *
 *   1. Orders are worked in the order they arrived. Anything else — picking
 *      the small one, the familiar name, the one on top — is how a Tuesday
 *      order ships on Friday.
 *   2. Except when a promise is closer. Somebody who asked for 4pm pickup
 *      beats a shipment placed an hour earlier, because only one of them has
 *      a person standing at a counter.
 *
 * So every order gets a DUE TIME, derived from what it is, and the queue is
 * ordered by that. Age breaks ties, which keeps it FIFO whenever promises
 * are equal — the common case.
 */

export interface FulfilmentPolicy {
  /** Minutes to get a pickup/curbside order ready. */
  prepMinutes: number;
  /** Hours to get a shipment packed and labelled, for a shop with no schedule to go by. */
  shipHours: number;
  /** Minutes before a due time that an order starts showing as "due soon". */
  warnMinutes: number;
  /** The shop's shipping schedule (lib/ship-promise): a shipped order with no stored promise is due by the ship-by
   *  day it would have been given, at that day's last pickup. */
  schedule?: ShipSchedule;
  /** The shop's clock, for those days. */
  timeZone?: string;
}

export const DEFAULT_POLICY: FulfilmentPolicy = {
  prepMinutes: 30,
  shipHours: 24,
  warnMinutes: 15,
};

export function fulfilmentPolicy(retailSettings: any, timeZone?: string | null): FulfilmentPolicy {
  const rs = retailSettings || {};
  return {
    prepMinutes: Math.max(1, Math.floor(Number(rs.prepMinutes) || DEFAULT_POLICY.prepMinutes)),
    shipHours: Math.max(1, Math.floor(Number(rs.shipProcessingHours) || DEFAULT_POLICY.shipHours)),
    warnMinutes: Math.max(1, Math.floor(Number(rs.slaWarnMinutes) || DEFAULT_POLICY.warnMinutes)),
    schedule: scheduleFrom(rs),
    ...(timeZone ? { timeZone: String(timeZone) } : {}),
  };
}

/**
 * When the work on an order could start: payment, or, for a backorder or split shipment, the moment it was released
 * to be packed. A backorder split off months after payment used to count from the parent's payment, so it was late
 * the moment it was created.
 */
export function workStartedAt(order: any): string | null {
  return order?.releasedAt || (order?.parentOrderId ? order?.placedAt : null) || order?.paidAt || order?.placedAt || null;
}

/** When the customer was told (or reasonably expects) this to be done. */
export function dueAt(order: RetailOrder, policy: FulfilmentPolicy = DEFAULT_POLICY): number {
  const started = new Date(workStartedAt(order) ?? Date.now()).getTime();
  // An unreadable stamp counts from now rather than making every date after it unreadable too.
  const placed = Number.isFinite(started) ? started : Date.now();

  // An explicit promise always wins — it is what the customer was shown.
  if (order.promiseAt) {
    const t = new Date(order.promiseAt).getTime();
    if (Number.isFinite(t)) return t;
  }

  // "Wants it in ~30 min" from the storefront's pickup picker.
  const wanted = String((order as any).pickupAt || '').trim();
  const m = wanted.match(/(\d+)\s*min/i);
  if (m) return placed + Number(m[1]) * 60_000;
  if (/hour/i.test(wanted)) return placed + 60 * 60_000;

  if (order.method === 'ship') {
    // No stored promise (an order from before the schedule, or a backorder released to be packed): due by the
    // ship-by day the schedule gives the moment work could start, at that day's last pickup.
    if (policy.schedule && Number.isFinite(placed)) {
      const p = promiseFor({
        at: placed, timeZone: String((order as any).promise?.timeZone || policy.timeZone || 'UTC'), schedule: policy.schedule,
        lines: (order.lines || []) as any, carrier: promiseCarrier(order),
      });
      const t = Date.parse(p.shipByAt);
      if (Number.isFinite(t)) return t;
    }
    return placed + policy.shipHours * 3_600_000;
  }
  return placed + policy.prepMinutes * 60_000;
}

export type SlaState = 'ontime' | 'due' | 'late';

export interface SlaInfo {
  dueAtMs: number;
  minutesRemaining: number;   // negative once overdue
  state: SlaState;
  label: string;              // "due in 12m" / "18m late" / "1h 5m left"
  waitedMinutes: number;      // how long since it was paid for
}

function human(mins: number): string {
  const a = Math.abs(Math.round(mins));
  if (a < 60) return `${a}m`;
  const h = Math.floor(a / 60);
  const r = a % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function slaFor(
  order: RetailOrder,
  policy: FulfilmentPolicy = DEFAULT_POLICY,
  now: number = Date.now()
): SlaInfo {
  const due = dueAt(order, policy);
  const minutesRemaining = (due - now) / 60_000;
  const placed = new Date(order.paidAt ?? order.placedAt ?? now).getTime();
  const state: SlaState =
    minutesRemaining < 0 ? 'late' : minutesRemaining <= policy.warnMinutes ? 'due' : 'ontime';
  return {
    dueAtMs: due,
    minutesRemaining,
    state,
    waitedMinutes: Math.max(0, (now - placed) / 60_000),
    label:
      state === 'late' ? `${human(minutesRemaining)} late`
      : state === 'due' ? `due in ${human(minutesRemaining)}`
      : `${human(minutesRemaining)} left`,
  };
}

/**
 * Queue order. Lower sorts first.
 *
 * Due time is the spine — but a shipment that has been sitting for hours
 * must never be leapfrogged forever by a stream of fresh pickups, so an
 * order that is already LATE is pulled to the front regardless of method.
 * Age breaks every tie, which makes the default behaviour plain FIFO.
 */
export function queuePriority(
  order: RetailOrder,
  policy: FulfilmentPolicy = DEFAULT_POLICY,
  now: number = Date.now()
): number {
  const sla = slaFor(order, policy, now);
  const placed = new Date(order.paidAt ?? order.placedAt ?? now).getTime();

  // Late work first, oldest of the late ones leading.
  if (sla.state === 'late') return -1e15 + placed;

  // Otherwise: soonest due, then oldest. The tiny placed-time fraction only
  // ever breaks an exact tie — it is far smaller than one millisecond of due
  // time, so it can never reorder genuinely different promises.
  return sla.dueAtMs + placed / 1e13;
}

/* ════════════════════════════════════════════════════════════════════════════
 * SCAN ENGINE  (100% accuracy gates)
 * ════════════════════════════════════════════════════════════════════════════ */

export type ScanResult =
  | { ok: true; lineId: string; name?: string; qtyScanned: number; qtyOrdered: number; pickComplete: boolean; caseCounted?: number }
  | { ok: false; code: 'unknown_sku' | 'over_scan' | 'line_closed'; message: string };

/**
 * Apply one scan during picking. Accepts a physical barcode, a SKU, or a
 * clarityflow://product/{id} label (the scheme the inventory page already
 * prints). Pure: returns the result and the updated lines array; the caller
 * persists inside a transaction and appends the item_scanned or
 * scan_mismatch event.
 */
/**
 * The ways a code may be written in a product's record, for a database lookup that can only match exactly: as typed,
 * upper case, in the one form (lib/code-form), and a retail barcode's 8, 12, 13 and 14 digit renderings (a phone often
 * reads a UPC-A as EAN-13, with a leading 0). Whether a found record really carries the code is then decided by
 * codesMatch.
 */
export function codeVariants(value: string): Set<string> {
  const out = new Set<string>();
  const raw = String(value || '').trim();
  if (!raw) return out;
  out.add(raw);
  out.add(raw.toUpperCase());
  const one = codeForm(raw);
  if (one) out.add(one);
  if (/^\d{14}$/.test(one) && gtinValid(one)) {
    const short = one.replace(/^0+/, '');
    for (const n of [8, 12, 13, 14]) if (short.length <= n) out.add(short.padStart(n, '0'));
    if (short.length === 11) out.add(short);   // a UPC-A typed without its small first digit
  }
  return out;
}

/** Are these the same code? Compared in the one form every scanner and the code index use (lib/code-form): letter
 *  case, spaces and the way a retail barcode is printed don't matter; NP-000123 and AB-000123 are two codes. */
export function codesMatch(a: string, b: string): boolean {
  const x = codeForm(a);
  return !!x && x === codeForm(b);
}

/** Does a scan match this line, as the line was sold: the product's label, its id, or any of its codes. */
export function lineMatchesScan(l: OrderLine, raw: string): boolean {
  const t = raw.trim();
  const qr = parseProductQr(t);
  if (qr !== null) return l.productId === qr || (!!l.testOfProductId && l.testOfProductId === qr) || l.productId === `test-${qr}`;
  const pid = String(l.productId || '');
  return pid === t || pid.toLowerCase() === t.toLowerCase() ||
    codesMatch(l.barcode, t) || codesMatch(l.sku, t) ||
    (!!l.caseBarcode && codesMatch(l.caseBarcode, t)) ||
    (!!l.palletBarcode && codesMatch(l.palletBarcode, t)) ||
    (Array.isArray(l.codes) && l.codes.some((c) => codesMatch(c, t)));
}

/** A scan already worked out against the product's current record (lib/scan-resolve): which line it's for, and the
 *  product's current case and pallet codes, so a case code added after the order was placed still counts a case. */
export type ScanHint = { lineId: string; identity?: { casePack?: number; caseBarcode?: string; palletPack?: number; palletBarcode?: string } };

export function applyScan(lines: OrderLine[], scannedValue: string, hint?: ScanHint | null): {
  result: ScanResult;
  lines: OrderLine[];
} {
  const raw = scannedValue.trim();
  const matches = (l: OrderLine) => (hint?.lineId ? l.lineId === hint.lineId : lineMatchesScan(l, raw));
  // One product can be on two lines (different options). Fill the first line still waiting for units.
  const firstOpen = lines.findIndex((l) => matches(l) && !['shorted', 'refunded', 'backordered'].includes(l.status) && l.qtyScanned < l.qtyOrdered);
  const idx = firstOpen >= 0 ? firstOpen : lines.findIndex(matches);

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

  // A scan of the CASE code counts a sealed case's worth of units in one
  // beep — the spec's rule: verify 20 cases, not 500 bottles. The last case
  // never overshoots: it counts exactly the units still owed.
  const remaining = line.qtyOrdered - line.qtyScanned;
  const resolved = scanUnitsFor({ ...line, ...(hint?.identity || {}) }, raw, remaining);
  const isCaseScan = resolved.tier !== 'unit';
  const increment = resolved.units;

  const updatedLine: OrderLine = {
    ...line,
    qtyScanned: line.qtyScanned + increment,
    status: line.qtyScanned + increment === line.qtyOrdered ? 'picked' : 'pending',
  };
  const nextLines = [...lines.slice(0, idx), updatedLine, ...lines.slice(idx + 1)];

  return {
    result: {
      ok: true,
      lineId: line.lineId,
      name: line.name,
      qtyScanned: updatedLine.qtyScanned,
      qtyOrdered: line.qtyOrdered,
      pickComplete: isPickComplete(nextLines),
      ...(isCaseScan ? { caseCounted: increment } : {}),
    },
    lines: nextLines,
  };
}

/**
 * THE PHYSICAL HIERARCHY, resolved in ONE place: unit -> case -> pallet.
 *
 * A pallet label is worth its cases, a case label is worth its units, a unit
 * code is worth one. Picking, pack-checking and receiving all ask this
 * function rather than repeating the arithmetic, because three copies of a
 * multiplier is three places for a miscount to hide. `remaining` caps every
 * answer, which is what stops a pallet beep on a 3-unit line from inventing
 * 144 units.
 */
export function scanUnitsFor(
  identity: { casePack?: number; caseBarcode?: string; palletPack?: number; palletBarcode?: string },
  raw: string,
  remaining: number,
): { units: number; tier: 'unit' | 'case' | 'pallet' } {
  const casePack = Math.max(0, Math.floor(Number(identity.casePack) || 0));
  const palletPack = Math.max(0, Math.floor(Number(identity.palletPack) || 0));
  const cap = Math.max(0, Math.floor(remaining));

  if (palletPack > 1 && casePack > 1 && identity.palletBarcode && codesMatch(identity.palletBarcode, raw)) {
    const units = casePack * palletPack;
    return { units: cap > 0 ? Math.min(units, cap) : units, tier: 'pallet' };
  }
  if (casePack > 1 && identity.caseBarcode && codesMatch(identity.caseBarcode, raw)) {
    return { units: cap > 0 ? Math.min(casePack, cap) : casePack, tier: 'case' };
  }
  return { units: 1, tier: 'unit' };
}

/** Units on a full pallet, or null when the product isn't palletised. */
export function unitsPerPallet(identity: { casePack?: number; palletPack?: number }): number | null {
  const c = Math.max(0, Math.floor(Number(identity.casePack) || 0));
  const p = Math.max(0, Math.floor(Number(identity.palletPack) || 0));
  return c > 1 && p > 1 ? c * p : null;
}

/**
 * SECOND SCAN — pack verification. The pick scan proved the item left the
 * shelf; this proves it entered the BOX. Its own counter (qtyPacked), same
 * matching rules (QR / barcode / SKU / case code), bounded by what the
 * order actually owes after shorts. Only meaningful for orders whose pick
 * scan happened at the shelf — wave orders already scan AT the bench, and
 * a third pass would be labor without information.
 */
/**
 * When a digital line's access ends — null means never. The window is read
 * from the LINE, not the item: what was sold is what's honoured, so raising
 * or lowering the policy later can't retroactively shorten someone's access.
 * The clock starts at payment (paidAt), falling back to when the order was
 * placed, so a missing timestamp can never silently mean "expired".
 */
export function digitalAccessEndsAt(line: OrderLine, paidAt?: string | null, placedAt?: string | null): string | null {
  const days = Number(line.digitalAccessDays) || 0;
  if (days <= 0) return null;
  const start = Date.parse(String(paidAt || placedAt || '')) || Date.now();
  return new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * THE PROMISE CLOCK (FTC Mail, Internet, or Telephone Order Merchandise Rule).
 *
 * The rule in plain terms: when a shop takes money for something it hasn't
 * shipped, it must ship by the date it promised — or, if it promised no
 * date, within 30 days. If it can't, it owes the buyer a notice with a
 * revised date AND a plain way to cancel for a full refund. The buyer's
 * silence is NOT consent to wait.
 *
 * So the promise is computed from what was actually sold: the latest
 * pre-order date on the order if there is one, otherwise 30 days from
 * payment. Stored per order at checkout, but derived here too so old orders
 * and re-reads agree.
 */
export const FTC_DEFAULT_PROMISE_DAYS = 30;

export function shipPromiseAt(
  lines: OrderLine[],
  paidAt?: string | null,
  placedAt?: string | null,
  timeZone?: string | null,
): string | null {
  const start = Date.parse(String(paidAt || placedAt || ''));
  if (!Number.isFinite(start)) return null;
  // A promised date is a DEADLINE: the shop has until the end of that day on
  // its own clock. Parsing '2026-03-03' directly gives UTC midnight, which is
  // 7pm on March 2 in Eastern — so an order was judged late, and the buyer
  // handed the FTC's unconditional cancel right, a day early.
  const etas = lines
    .filter((l) => l.preorder === true && l.preorderEtaAt)
    .map((l) => Date.parse(String(deadlineAt(l.preorderEtaAt, timeZone) || '')))
    .filter((n) => Number.isFinite(n));
  if (etas.length > 0) return new Date(Math.max(...etas)).toISOString();
  return new Date(start + FTC_DEFAULT_PROMISE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Past the promised date with nothing shipped or handed over yet. A box with its label bought counts as on its way
 *  out: the promise is now the ship-by day itself, and a box the carrier collected but nobody marked shipped must not
 *  read as late, with a refund button, at midnight. Unless the morning check has found the carrier never scanned it
 *  (lib/label-sweep): then it is late like any other. */
export function isPromiseLate(
  order: { stage: string; lines: OrderLine[]; paidAt?: string | null; placedAt?: string | null; shipPromiseAt?: string | null },
  timeZone?: string | null,
): boolean {
  if (!['paid', 'picking', 'packed', 'ready'].includes(String(order.stage))) return false;
  const o = order as any;
  if ((o.trackingNumber || o.shippoTransactionId || o.labelFromOrderId || o.shippedWithOrderId) && o.labelUnscannedOpen !== true) return false;
  // The stored promise always wins: it is what the customer was actually
  // shown. Only an order written before that field existed falls through to
  // the derivation, and that one needs the zone to land on the right day.
  const promise = order.shipPromiseAt || shipPromiseAt(order.lines || [], order.paidAt, order.placedAt, timeZone);
  return !!promise && Date.parse(promise) < Date.now();
}

/**
 * A delay notice has gone out (by hand, automatically, or for a pre-order run): the notice offered a full refund, so
 * the customer can cancel online until it ships, whatever the shop's cancelling policy says.
 */
export function delayNotified(order: { notifiedForPromiseAt?: string | null; promiseRevisions?: number | null }): boolean {
  return !!order?.notifiedForPromiseAt || (Number(order?.promiseRevisions) || 0) > 0;
}

/** True when NOTHING on the order needs picking, packing, or postage. */
export function isDigitalOnlyOrder(lines: OrderLine[]): boolean {
  return lines.length > 0 && lines.every((l) => l.digital === true);
}

/** Physical lines only — what the floor actually handles. */
export function physicalLines(lines: OrderLine[]): OrderLine[] {
  return lines.filter((l) => l.digital !== true);
}

/** Every unit going out is in the box. A line marked refunded or sent later for the units that went missing still ships
 *  the ones picked before (qtyOrdered - qtyShorted), so those are counted in too. */
export function isPackComplete(lines: OrderLine[]): boolean {
  return lines.every((l) =>
    l.digital === true ||
    (l.qtyPacked || 0) >= Math.max(0, l.qtyOrdered - (l.qtyShorted || 0))
  );
}

export function applyPackScan(lines: OrderLine[], scannedValue: string, hint?: ScanHint | null): {
  result: ScanResult;
  lines: OrderLine[];
} {
  const raw = scannedValue.trim();
  const matchesPack = (l: OrderLine) => (hint?.lineId ? l.lineId === hint.lineId : lineMatchesScan(l, raw));
  const firstOpenPack = lines.findIndex((l) => matchesPack(l) && (l.qtyPacked || 0) < l.qtyOrdered - (l.qtyShorted || 0));
  const idx = firstOpenPack >= 0 ? firstOpenPack : lines.findIndex(matchesPack);
  if (idx === -1) {
    return { result: { ok: false, code: 'unknown_sku', message: `Scanned code "${raw}" is not on this order.` }, lines };
  }
  const line = lines[idx];
  const owed = line.qtyOrdered - (line.qtyShorted || 0);
  // Refunded or sent later in full: nothing of it goes in the box. Part of it: the units picked before still do.
  if (['refunded', 'backordered'].includes(line.status) && owed <= 0) {
    return { result: { ok: false, code: 'line_closed', message: `${line.name} was ${line.status} — it doesn't go in the box.` }, lines };
  }
  if ((line.qtyPacked || 0) >= owed) {
    return { result: { ok: false, code: 'over_scan', message: `${line.name} already has all ${owed} pack-checked.` }, lines };
  }
  const remaining = owed - (line.qtyPacked || 0);
  const resolved = scanUnitsFor({ ...line, ...(hint?.identity || {}) }, raw, remaining);
  const isCaseScan = resolved.tier !== 'unit';
  const increment = resolved.units;
  const updatedLine: OrderLine = { ...line, qtyPacked: (line.qtyPacked || 0) + increment };
  const nextLines = [...lines.slice(0, idx), updatedLine, ...lines.slice(idx + 1)];
  return {
    result: {
      ok: true,
      lineId: line.lineId,
      name: line.name,
      qtyScanned: updatedLine.qtyPacked as number,
      qtyOrdered: owed,
      pickComplete: isPackComplete(nextLines),
      ...(isCaseScan ? { caseCounted: increment } : {}),
    },
    lines: nextLines,
  };
}

/**
 * A scan AT THE BOX (the packing screen): the unit goes into the box as it's counted, so it counts as picked and as in
 * the box at once (qtyScanned and qtyPacked). With the shop's second scan on, a scan of an item already picked at the
 * shelf is that unit's check into the box (applyPackScan); without it, a fully counted item says so, as a pick does.
 * Pure. `kind` says which it was, so it can be undone exactly.
 */
export function applyBoxScan(lines: OrderLine[], scannedValue: string, hint: ScanHint | null | undefined, secondScan: boolean): {
  result: ScanResult & { kind?: 'picked' | 'checked'; packComplete?: boolean };
  lines: OrderLine[];
} {
  const pick = applyScan(lines, scannedValue, hint);
  if (pick.result.ok) {
    const r = pick.result;
    const nextLines = pick.lines.map((l) => {
      if (l.lineId !== r.lineId) return l;
      const before = lines.find((x) => x.lineId === l.lineId);
      const inc = Math.max(0, l.qtyScanned - (before?.qtyScanned || 0));
      const owed = Math.max(0, l.qtyOrdered - (l.qtyShorted || 0));
      return { ...l, qtyPacked: Math.min(owed, (l.qtyPacked || 0) + inc) };
    });
    return { result: { ...r, kind: 'picked', packComplete: isPackComplete(nextLines) }, lines: nextLines };
  }
  // Picked already (or the rest of it went missing): its units picked before are checked into the box.
  if (secondScan && (pick.result.code === 'over_scan' || pick.result.code === 'line_closed')) {
    const check = applyPackScan(lines, scannedValue, hint);
    if (check.result.ok) return { result: { ...check.result, kind: 'checked', pickComplete: isPickComplete(check.lines), packComplete: check.result.pickComplete }, lines: check.lines };
    return { result: check.result, lines };
  }
  return { result: pick.result, lines };
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
    refundCents: resolution === 'refund' ? qtyShorted * effectiveUnitCents(line as any) : 0,   // what was paid, after any promo code
  };
}

/** Every line is either fully scanned or explicitly resolved. Nothing silent. */
export function isPickComplete(lines: OrderLine[]): boolean {
  return lines.every(
    (l) =>
      l.digital === true ||
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

    case 'completed':
      // A ship order completes when the carrier delivers it (from shipped); a pickup order when it's handed over.
      // Straight from placed only for a download-only order (done once paid).
      if (order.stage === 'placed' && !((order.lines || []).length > 0 && (order.lines || []).every((l: any) => l?.digital === true))) {
        return { ok: false, reason: 'Only a download-only order is completed when it’s paid.' };
      }
      if (order.method === 'ship' && order.stage !== 'shipped' && order.stage !== 'placed') {
        return { ok: false, reason: 'A ship order is completed by its delivery, not handed over.' };
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
  if (['arrived', 'shipped'].includes(order.stage)) {
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
export type ReturnDisposition = 'restock' | 'open_box' | 'quarantine' | 'damaged' | 'dispose' | 'write_off';

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
  status: 'open' | 'received' | 'resolved' | 'rejected' | 'cancelled';   // cancelled: closed, never came back (lib/return-close)
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

/** Item price plus the tax that was paid on those items. */
export function returnRefundCents(order: RetailOrder, lines: ReturnLine[]): number {
  const items = lines.reduce((sum, rl) => {
    const orig = order.lines.find((l) => l.lineId === rl.lineId);
    return sum + (orig ? rl.qty * effectiveUnitCents(orig as any) : 0);
  }, 0);
  return items + taxShareCents(order as any, items);
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
  completed: 'Completed',
  cancelled: 'Canceled',
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
