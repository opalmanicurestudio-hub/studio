// ─── src/lib/shopper-insights.ts ──────────────────────────────────────────────
// New vs returning, and milestones — both DERIVED, nothing stored.
//
// The Shoppers page already answers "how many of my customers are repeat
// customers." That is a snapshot of people. It cannot answer the question you
// actually run a shop on: is new-customer revenue growing, or am I just
// selling more to the same faces? That needs each ORDER labelled with where it
// fell in that customer's history, which is what ordinalsByOrder() does.
//
// Everything here recomputes from retailOrders on every read. No new field, no
// migration, no backfill — it works on every order already in the database and
// cannot drift out of sync with the orders it describes.
//
// ONE HONEST LIMIT, worth knowing before you trust a number: ordinals are only
// correct if the orders you pass in cover the customer's WHOLE history. The
// Shoppers page loads the last 1,000 orders, which is the full history at
// current volume. If a caller ever windows to "last 90 days", a customer whose
// first order was two years ago will be counted as new. windowSafe() below
// tells you whether that risk applies to the set you actually have.

export interface InsightOrderLike {
  id?: string;
  customerEmail?: string;
  placedAt?: string;
  stage?: string;
  totalCents?: number;
  refundedCents?: number;
}

/** Carts that never became sales. Same rule the Shoppers page uses. */
const NOT_A_SALE = ['placed', 'cancelled'];

const isSale = (o: InsightOrderLike) => !NOT_A_SALE.includes(String(o?.stage || ''));
const emailOf = (o: InsightOrderLike) => String(o?.customerEmail || '').trim().toLowerCase();
const netCents = (o: InsightOrderLike) =>
  Math.max(0, (Number(o?.totalCents) || 0) - (Number(o?.refundedCents) || 0));

/**
 * orderId → 1-based position in that customer's history.
 * 1 means this was their first order ever; anything above 1 is a return visit.
 */
export function ordinalsByOrder(orders: InsightOrderLike[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const rows = (Array.isArray(orders) ? orders : []).filter((o) => isSale(o) && emailOf(o) && o?.id);

  const byEmail = new Map<string, InsightOrderLike[]>();
  for (const o of rows) {
    const k = emailOf(o);
    const list = byEmail.get(k);
    if (list) list.push(o); else byEmail.set(k, [o]);
  }

  for (const list of byEmail.values()) {
    // Oldest first. Ties break on id so the same input always yields the same
    // ordinals — two orders can share a timestamp on a bulk import.
    list.sort((a, b) => {
      const at = String(a.placedAt || '').localeCompare(String(b.placedAt || ''));
      return at !== 0 ? at : String(a.id).localeCompare(String(b.id));
    });
    list.forEach((o, i) => out.set(String(o.id), i + 1));
  }
  return out;
}

export interface MonthSplit {
  month: string;              // 'YYYY-MM'
  newOrders: number;
  returningOrders: number;
  newRevenueCents: number;
  returningRevenueCents: number;
}

/** Month-by-month new vs returning, oldest first. */
export function newVsReturningByMonth(orders: InsightOrderLike[] | null | undefined): MonthSplit[] {
  const ordinals = ordinalsByOrder(orders);
  const months = new Map<string, MonthSplit>();

  for (const o of Array.isArray(orders) ? orders : []) {
    if (!isSale(o) || !o?.id) continue;
    const month = String(o.placedAt || '').slice(0, 7);
    if (month.length !== 7) continue;

    const row = months.get(month) || {
      month, newOrders: 0, returningOrders: 0, newRevenueCents: 0, returningRevenueCents: 0,
    };
    const first = (ordinals.get(String(o.id)) ?? 1) === 1;
    if (first) { row.newOrders += 1; row.newRevenueCents += netCents(o); }
    else { row.returningOrders += 1; row.returningRevenueCents += netCents(o); }
    months.set(month, row);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface ShopTotals {
  orders: number;
  revenueCents: number;
  customers: number;
  repeatCustomers: number;
  newOrders: number;
  returningOrders: number;
  /** Share of ORDERS placed by someone who had ordered before. */
  returningOrderRate: number;
  /** Share of REVENUE from returning customers — usually the more useful one. */
  returningRevenueRate: number;
}

export function shopTotals(orders: InsightOrderLike[] | null | undefined): ShopTotals {
  const ordinals = ordinalsByOrder(orders);
  const rows = (Array.isArray(orders) ? orders : []).filter((o) => isSale(o) && o?.id);

  const perEmail = new Map<string, number>();
  let revenueCents = 0, newOrders = 0, returningOrders = 0;
  let newRev = 0, returningRev = 0;

  for (const o of rows) {
    const cents = netCents(o);
    revenueCents += cents;
    const k = emailOf(o);
    if (k) perEmail.set(k, (perEmail.get(k) || 0) + 1);
    if ((ordinals.get(String(o.id)) ?? 1) === 1) { newOrders += 1; newRev += cents; }
    else { returningOrders += 1; returningRev += cents; }
  }

  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  return {
    orders: rows.length,
    revenueCents,
    customers: perEmail.size,
    repeatCustomers: [...perEmail.values()].filter((n) => n > 1).length,
    newOrders,
    returningOrders,
    returningOrderRate: pct(returningOrders, rows.length),
    returningRevenueRate: pct(returningRev, newRev + returningRev),
  };
}

export interface Milestone {
  id: string;
  label: string;
  /** How far along, 0-1. */
  progress: number;
  reached: boolean;
  /** Plain-language nudge when not yet reached. */
  remaining: string;
}

const ORDER_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const REVENUE_STEPS = [100000, 500000, 1000000, 2500000, 5000000, 10000000]; // cents
const REPEAT_STEPS = [5, 10, 25, 50, 100, 250];

function ladder(
  idPrefix: string, value: number, steps: number[],
  label: (n: number) => string, remaining: (gap: number) => string
): { reached: Milestone[]; next: Milestone | null } {
  const reached = steps.filter((s) => value >= s).map((s) => ({
    id: `${idPrefix}-${s}`, label: label(s), progress: 1, reached: true, remaining: '',
  }));
  const nextStep = steps.find((s) => value < s);
  const prevStep = [...steps].reverse().find((s) => value >= s) || 0;
  const next = nextStep
    ? {
        id: `${idPrefix}-${nextStep}`,
        label: label(nextStep),
        progress: Math.min(1, Math.max(0, (value - prevStep) / (nextStep - prevStep))),
        reached: false,
        remaining: remaining(nextStep - value),
      }
    : null;
  return { reached, next };
}

export interface MilestoneReport {
  reached: Milestone[];
  next: Milestone[];
  /** The single closest one — what to put in front of her. */
  closest: Milestone | null;
  firstSaleAt: string;
  bestMonth: { month: string; revenueCents: number } | null;
}

export function milestones(orders: InsightOrderLike[] | null | undefined): MilestoneReport {
  const totals = shopTotals(orders);
  const rows = (Array.isArray(orders) ? orders : []).filter((o) => isSale(o));

  const o = ladder('orders', totals.orders, ORDER_STEPS,
    (n) => `${n.toLocaleString()} orders`, (gap) => `${gap.toLocaleString()} to go`);
  const r = ladder('revenue', totals.revenueCents, REVENUE_STEPS,
    (n) => `$${(n / 100).toLocaleString()} in sales`,
    (gap) => `$${(gap / 100).toLocaleString()} to go`);
  const c = ladder('repeat', totals.repeatCustomers, REPEAT_STEPS,
    (n) => `${n} repeat customers`, (gap) => `${gap} more to go`);

  const next = [o.next, r.next, c.next].filter(Boolean) as Milestone[];
  const closest = next.length
    ? next.reduce((best, m) => (m.progress > best.progress ? m : best))
    : null;

  const months = newVsReturningByMonth(orders);
  const bestMonth = months.length
    ? months
        .map((m) => ({ month: m.month, revenueCents: m.newRevenueCents + m.returningRevenueCents }))
        .reduce((best, m) => (m.revenueCents > best.revenueCents ? m : best))
    : null;

  const firstSaleAt = rows
    .map((x) => String(x.placedAt || ''))
    .filter(Boolean)
    .sort()[0] || '';

  return {
    reached: [...o.reached, ...r.reached, ...c.reached],
    next,
    closest,
    firstSaleAt,
    bestMonth,
  };
}

/**
 * Are the ordinals in this set trustworthy?
 *
 * False means the query was windowed and some customer's earlier orders are
 * outside it, so "new customer" counts will be overstated. Surface the warning
 * rather than quietly showing a wrong number.
 */
export function windowSafe(orders: InsightOrderLike[] | null | undefined, queryLimit: number): boolean {
  const n = (Array.isArray(orders) ? orders : []).length;
  return n < queryLimit;
}
