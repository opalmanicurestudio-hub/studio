// src/lib/ordering.ts — WHAT TO ORDER, AND RECEIVING IT (design canvas "Ordering"; api/ordering; the page at
// /inventory/ordering). For each supplier, what to order so the shelf lasts until the next order: from how much of each
// thing went over the last two weeks (the stock history: sold, used in a recipe or a service, thrown away), how long it
// takes to come, what's on the shelf and what's already on its way. Or, for something the business keeps a set amount
// of (two bags of lemons), back up to that. Rounded up to whole containers, and never below the supplier's minimum. An
// order is copied into a text or an email the way the business already orders, and when it comes in, one tap puts it all
// on the shelf at its costs. Pure.
import { perContainer, usesLeft } from '@/lib/product-cost';
import { recipeOf } from '@/lib/menu-stock';
import { variantIdsOf } from '@/lib/variants';
import { amountWords, ledgerUnit } from '@/lib/food-cost';

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** How many days an order should last (7 unless the business says otherwise, 1 to 30). */
export const DEFAULT_COVER_DAYS = 7, COVER_MIN = 1, COVER_MAX = 30;
export const coverDaysOf = (t: any) => { const v = Math.round(num(t?.ordering?.coverDays)); return v >= COVER_MIN && v <= COVER_MAX ? v : DEFAULT_COVER_DAYS; };
/** How far back what was used is looked at. */
export const LOOKBACK_DAYS = 14;
export const SUPPLIER_MAX = 80;
export const NO_SUPPLIER = '';
export const cleanSupplier = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, SUPPLIER_MAX);
export const supplierKey = (v: unknown) => cleanSupplier(v).toLowerCase();

/** Something that's ordered: counted, not equipment, not put away, not a menu item made from its own recipe, not a
 *  product counted by its variants (each variant is ordered itself). */
export function orderable(id: string, x: any): boolean {
  if (!x || x.archived === true || x.status === 'archived') return false;
  if (x.type === 'equipment' || x.type === 'overhead') return false;
  if (x.type === 'refreshment' && recipeOf(x, id).length) return false;
  if (variantIdsOf(x).length) return false;
  return true;
}
/** Not counted yet (a starter ingredient before its first count or delivery): nothing to work from. */
export const notCounted = (x: any) => x?.countStock === false;

/** How much one container holds, in what the stock history measures (1 for something counted by the unit). */
export const perOf = (x: any) => (x?.costingMethod === 'uses' || x?.costingMethod === 'size' ? perContainer(x) || 0 : 1);
/** What's on the shelf now, in what the stock history measures; for a product sold online, less what paid orders hold. */
export function onHandOf(x: any): number {
  if (x?.costingMethod === 'uses' || x?.costingMethod === 'size') return Math.max(0, usesLeft(x) ?? 0);
  return Math.max(0, num(x?.totalStock) - Math.max(0, num(x?.stockReserved)));
}
/** What a container is called, for an order ("case of 24", "5 lb bag"), or nothing for one counted by the unit. */
export const containerOf = (x: any) => String(x?.container || '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** A movement on the stock history (lib/stock-ledger). */
export type Movement = { productId: string; type: string; change: number; date: string; unit?: string; storeId?: string };
/** What went of each thing a day, in what its history measures: sold, used and thrown away over the stretch since
 *  `since` (`days` long), less what came back (a voided order, a return). Received and counted don't count. `perFor`:
 *  how much one container holds, for a sale recorded in whole units of something measured by the dose. */
export function usedPerDay(moves: Movement[], since: string, days: number, perFor?: (productId: string) => number): Map<string, number> {
  const sum = new Map<string, number>();
  for (const m of moves) {
    const type = String(m.type); if (String(m.date) < since) continue;
    const c = num(m.change); const id = String(m.productId);
    const scale = type === 'sold' && (!m.unit || m.unit === 'units') && perFor ? Math.max(1, perFor(id) || 1) : 1;
    if (['sold', 'used', 'spoiled'].includes(type) && c < 0) sum.set(id, (sum.get(id) || 0) - c * scale);
    else if (type === 'returned' && c > 0) sum.set(id, (sum.get(id) || 0) - c);
  }
  const out = new Map<string, number>(); const d = Math.max(1, days);
  for (const [k, v] of sum) if (v > 0) out.set(k, v / d);
  return out;
}
/** How many days the history covers: two weeks, or less for a business newer than that (from when it started), or what
 *  was read when the read was cut short (from its oldest movement). Never less than a day. */
export function spanDays(nowIso: string, since: string, o: { startedAt?: string | null; oldestRead?: string | null; cut?: boolean } = {}): number {
  let from = since;
  const started = String(o.startedAt || ''); if (started && Number.isFinite(Date.parse(started)) && started > from) from = started;
  if (o.cut && o.oldestRead && o.oldestRead > from) from = o.oldestRead;
  return Math.max(1, (Date.parse(nowIso) - Date.parse(from)) / 86400000);
}

export type Suggestion = {
  id: string; name: string; supplier: string; container: string; unit: string;
  /** In what the history measures: what's on the shelf, what went a day, what's on its way. */
  onHand: number; perDay: number; onOrder: number;
  /** How many days what's here (and on its way) lasts; null when nothing has gone. */
  daysLeft: number | null;
  /** Containers to order (whole, at least the supplier's minimum when there's any to order). */
  suggest: number; par: number | null; moq: number; lead: number;
  /** What one container costs, and whether that's a typical price, not what the business pays. */
  cost: number; typical: boolean;
  why: string;
};

/** What to order of one thing. `perDay` and `onOrder` in what its history measures; `cover`: days the order should
 *  last. A set amount to keep (parLevel, in containers) is ordered back up to; otherwise enough for the days it takes
 *  to come (leadTimeDays) and `cover` days more, less what's here and on its way. For one store (lib/ordering-store):
 *  `at.onHand` and `at.par` are that store's own, and the reasons say "here". */
export function suggestFor(id: string, x: any, perDay: number, onOrder: number, cover: number, at?: { onHand: number; par: number | null }): Suggestion {
  const per = perOf(x) || 1; const unit = ledgerUnit(x);
  const onHand = at ? Math.max(0, at.onHand) : onHandOf(x); const par = at ? (at.par !== null && at.par > 0 ? at.par : null) : num(x?.parLevel) > 0 ? num(x.parLevel) : null;
  const here = at ? ' here' : '';
  const lead = Math.max(0, Math.min(60, Math.round(num(x?.leadTimeDays)))); const moq = Math.max(0, Math.round(num(x?.moq)));
  const have = onHand + Math.max(0, onOrder);
  const need = par !== null ? par * per - have : perDay * (lead + cover) - have;
  let suggest = need > per * 0.05 ? Math.ceil(need / per - 1e-6) : 0;
  if (suggest > 0 && moq > suggest) suggest = moq;
  const daysLeft = perDay > 0 ? Math.floor(have / perDay) : null;
  const dose = x?.costingMethod === 'uses' || x?.costingMethod === 'size';
  const left = (n: number) => (dose ? amountWords(n, unit) : `${Math.round(n * 10) / 10}`);
  const why = [
    par !== null ? `You keep ${par}${here || ' on hand'}` : perDay > 0 ? `About ${left(perDay)} a day${here}` : `Nothing used${here} in the last two weeks`,
    `${left(onHand)} left`,
    onOrder > 0 ? `${left(onOrder)} on its way${here}` : '',
    suggest === 0 && daysLeft !== null && par === null ? `enough for ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}` : '',
  ].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()) + '.';
  return { id, name: String(x?.name || 'Item'), supplier: cleanSupplier(x?.supplier), container: containerOf(x), unit, onHand: r2(onHand), perDay: r2(perDay), onOrder: r2(onOrder),
    daysLeft, suggest, par, moq, lead, cost: Math.max(0, num(x?.costPerUnit)), typical: x?.typicalCost === true, why };
}

export type SupplierPlan = { name: string; key: string; lines: Suggestion[]; total: number };
/** Every orderable thing, by supplier (the business's own spelling; those with none apart, last). The ones to order
 *  first in each, then the rest by name. */
export function planBySupplier(items: Suggestion[]): SupplierPlan[] {
  const by = new Map<string, SupplierPlan>();
  for (const s of items) {
    const k = supplierKey(s.supplier); const cur = by.get(k) || { name: s.supplier, key: k, lines: [], total: 0 };
    cur.lines.push(s); cur.total = r2(cur.total + s.suggest * s.cost); by.set(k, cur);
  }
  for (const p of by.values()) p.lines.sort((a, b) => Number(b.suggest > 0) - Number(a.suggest > 0) || a.name.localeCompare(b.name));
  return Array.from(by.values()).sort((a, b) => Number(a.key === '') - Number(b.key === '') || Number(b.lines.some((l) => l.suggest > 0)) - Number(a.lines.some((l) => l.suggest > 0)) || a.name.localeCompare(b.name));
}

/** An order to a supplier, as Inventory's purchase orders keep it (tenants/{t}/orders, lib/data Order): what was ordered
 *  of each product and at what cost, and what has come in of it. An order made here carries its number, who ordered it,
 *  and each line's container too. */
export type OrderItem = { productId: string; productName: string; quantity: number; costPerUnit: number; receivedQuantity?: number; container?: string; typical?: boolean };
export type SupplyOrder = { id: string; supplier: string; orderDate: string; status: 'Draft' | 'Placed' | 'Shipped' | 'Partially Received' | 'Received' | 'Cancelled'; items: OrderItem[];
  number?: string; orderedBy?: string; source?: string; notes?: string; receivedAt?: string | null; receivedBy?: string | null;
  /** Ordered for one store (lib/ordering-store): where it's going, and where it's put away unless it came to another. */
  storeId?: string; storeName?: string };
/** Still to come: placed, on its way, or partly in. */
export const OPEN_STATUSES = ['Placed', 'Shipped', 'Partially Received'] as const;
export const isOpen = (o: Pick<SupplyOrder, 'status'>) => (OPEN_STATUSES as readonly string[]).includes(String(o?.status));
/** What's still to come of a line. */
export const remainingOf = (i: Pick<OrderItem, 'quantity' | 'receivedQuantity'>) => Math.max(0, Math.round(num(i.quantity)) - Math.max(0, Math.round(num(i.receivedQuantity))));
export const orderTotal = (lines: { qty: number; cost: number }[]) => r2(lines.reduce((s, l) => s + Math.max(0, num(l.qty)) * Math.max(0, num(l.cost)), 0));
/** An order's short number, as Inventory shows it (its id's last six). */
export const orderNumber = (id: string) => String(id || '').slice(-6).toUpperCase();

/** One line of an order in words: "3 × Avocados (case of 24)". */
export const lineWords = (i: Pick<OrderItem, 'productName' | 'container'>, qty: number) => `${qty} × ${i.productName}${i.container ? ` (${i.container})` : ''}`;
/** An order to copy into a text or an email, the way the business already orders. */
export function orderText(business: string, o: Pick<SupplyOrder, 'items' | 'id' | 'number' | 'storeName'>, dayWords: string): string {
  const n = o.number || orderNumber(o.id);
  return [`${business || 'Our'} order ${n ? `#${n} ` : ''}for ${dayWords}${o.storeName ? `, to ${o.storeName}` : ''}:`, ...o.items.filter((i) => num(i.quantity) > 0).map((i) => lineWords(i, Math.round(num(i.quantity))))].join('\n');
}

/** What a delivery's lines come to, one per product (an order with the same product on two lines is put away once).
 *  Without `given`, everything still to come at the order's costs; with it ("Edit first"), whole numbers 0 to 10,000
 *  and a cost of more than $0 (or the order's own). `remaining`: what was still to come of it, `was`: what the order
 *  said it costs. Lines not on the order are ignored; null when a number isn't one. */
export type ReceivedLine = { productId: string; qty: number; cost: number; was: number; remaining: number; typed: boolean };
export function cleanReceived(order: Pick<SupplyOrder, 'items'>, given: unknown): ReceivedLine[] | null {
  const items = (Array.isArray(order.items) ? order.items : []).filter((i) => i && typeof i.productId === 'string');
  const byId = new Map<string, { was: number; remaining: number }>();
  for (const i of items) { const cur = byId.get(i.productId); if (cur) cur.remaining += remainingOf(i); else byId.set(i.productId, { was: Math.max(0, num(i.costPerUnit)), remaining: remainingOf(i) }); }
  if (!Array.isArray(given)) return Array.from(byId.entries()).map(([productId, x]) => ({ productId, qty: x.remaining, cost: x.was, was: x.was, remaining: x.remaining, typed: false }));
  const out: ReceivedLine[] = []; const seen = new Set<string>();
  for (const g of given.slice(0, 200)) {
    const id = String(g?.itemId ?? g?.productId ?? ''); const x = byId.get(id); if (!x || seen.has(id)) continue;
    const qty = Number(g?.qty); if (!Number.isInteger(qty) || qty < 0 || qty > 10000) return null;
    const c = g?.cost === undefined || g?.cost === null || g?.cost === '' ? null : Math.round(Number(g.cost) * 100) / 100;
    if (c !== null && !(c > 0 && c <= 100000)) return null;
    seen.add(id); out.push({ productId: id, qty, cost: c ?? x.was, was: x.was, remaining: x.remaining, typed: c !== null && Math.abs(c - x.was) > 0.004 });
  }
  return out;
}
/** What a delivery costs beyond what was booked when it was ordered (each line's order cost for what was still to come
 *  of it): a different cost, and more than was ordered. Negative when it came in for less. */
export const deliveryDiff = (lines: ReceivedLine[]) => r2(lines.reduce((s, l) => s + l.qty * l.cost - Math.min(l.qty, l.remaining) * l.was, 0));
/** A delivery's quantities spread over the order's lines (the same product on two lines fills the first, then the next;
 *  more than was ordered goes on the last). */
export function spreadReceived<T extends OrderItem>(items: T[], got: Map<string, { qty: number; cost: number }>): T[] {
  const left = new Map(Array.from(got.entries()).map(([k, v]) => [k, v.qty]));
  const lastIdx = new Map<string, number>(); items.forEach((it, i) => lastIdx.set(it.productId, i));
  return items.map((it, i) => {
    const g = got.get(it.productId); if (!g) return it;
    const l = left.get(it.productId) || 0; const take = lastIdx.get(it.productId) === i ? l : Math.min(l, remainingOf(it));
    left.set(it.productId, l - take);
    return { ...it, receivedQuantity: Math.max(0, Math.round(num(it.receivedQuantity))) + take, ...(Math.abs(g.cost - num(it.costPerUnit)) > 0.004 ? { receivedCost: g.cost } : {}) };
  });
}
