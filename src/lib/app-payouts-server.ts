// src/lib/app-payouts-server.ts — DELIVERY APP PAYOUTS, CHECKED AGAINST THE ORDERS (server; lib/app-orders is the rules;
// design board "App orders in the books at the app's price"). Read by api/apps/payouts for the Money page.
// - Each app order picked up adds to its app's week (Monday to Sunday, the business's day): how many orders, what they
//   came to on the app, the app's share, and what should come in the payout (lib/counter-server payOrder).
// - A manager enters what the app paid for a week: it matches (within a cent an order, for the app's rounding), or it's
//   short or over (a refund the app gave a guest comes out of its payout: short). A difference can be booked once as an
//   app adjustment, so the books match the bank; an order picked up after that is counted in the next week.
// - Only for an app whose share is set (Menu, Delivery apps): without it, what should come in can't be told.
//   tenants/{t}/private/appWeek_{app}_{week} = { app, label, week, orders, grossCents, feeCents, payoutCents,
//     paidCents?, paidAt?, paidBy?, adjustedAt?, adjustedCents?, adjustedBy? }  (read and written by the server only)
import { APPS, appMoneyFrom, appOrdersOf, appWeekId, payoutWeek } from '@/lib/app-orders';
import { tonight, addDays } from '@/lib/night-close-server';

type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });
const APP_CODES = ['doordash', 'ubereats', 'grubhub', 'other'];
const WEEK = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;
/** How many weeks back the Money page shows. */
export const PAYOUT_WEEKS = 6;
/** Within this of what the orders come to, a payout matches (the app's own rounding: a cent an order, at least five). */
export const matchWithin = (orders: number) => Math.max(5, Math.round(orders));

export type PayoutWeek = { app: string; label: string; week: string; weekEnd: string; orders: number; grossCents: number; feeCents: number; payoutCents: number;
  paidCents: number | null; paidAt: string | null; diffCents: number | null; status: 'open' | 'waiting' | 'matches' | 'short' | 'over'; adjustedCents: number | null };

function statusOf(x: any, thisWeek: string): PayoutWeek['status'] {
  if (x.paidCents === null || x.paidCents === undefined) return x.week >= thisWeek ? 'open' : 'waiting';
  const d = Math.round(num(x.paidCents)) - Math.round(num(x.payoutCents));
  return Math.abs(d) <= matchWithin(num(x.orders)) ? 'matches' : d < 0 ? 'short' : 'over';
}

function view(x: any, app: string, label: string, week: string, thisWeek: string): PayoutWeek {
  const paid = x.paidCents === null || x.paidCents === undefined ? null : Math.round(num(x.paidCents));
  return { app, label: String(x.label || label), week, weekEnd: addDays(week, 6), orders: Math.round(num(x.orders)), grossCents: Math.round(num(x.grossCents)), feeCents: Math.round(num(x.feeCents)),
    payoutCents: Math.round(num(x.payoutCents)), paidCents: paid, paidAt: x.paidAt || null, diffCents: paid === null ? null : paid - Math.round(num(x.payoutCents)),
    status: statusOf({ ...x, week }, thisWeek), adjustedCents: x.adjustedAt ? Math.round(num(x.adjustedCents)) : null };
}

/** The business's apps (the ones it takes orders from, and any it took orders from before), by name. */
function appsOf(tenant: any): { code: string; label: string }[] {
  const on = appOrdersOf(tenant).apps.map((a) => ({ code: String(a.code), label: a.label }));
  const listed = new Set(on.map((a) => a.code));
  const rest = APPS.filter((a) => !listed.has(a.code)).map((a) => ({ code: a.code as string, label: a.label }));
  return [...on, ...rest, ...(listed.has('other') ? [] : [{ code: 'other', label: String(tenant?.appOrders?.otherName || 'Another app') }])];
}

/** The last few weeks from each app, newest first: only weeks with orders (or a payout entered), from apps whose share
 *  is set (without it, what should come in can't be told). `needsShare`: apps with orders whose share isn't set yet. */
export async function payoutWeeks(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<{ weeks: PayoutWeek[]; needsShare: string[] }> {
  const thisWeek = payoutWeek(tonight(tenant, new Date(now)));
  const weeks = Array.from({ length: PAYOUT_WEEKS }, (_, i) => addDays(thisWeek, -7 * i));
  const apps = appsOf(tenant);
  const keys = apps.flatMap((a) => weeks.map((w) => ({ a, w })));
  const snaps = await db.getAll(...keys.map((k) => db.doc(`tenants/${tenantId}/private/${appWeekId(k.a.code, k.w)}`)));
  const rows = keys.map((k, i) => ({ k, x: snaps[i]?.exists ? snaps[i].data() || {} : null })).filter((r) => r.x && (num(r.x.orders) > 0 || r.x.paidCents !== undefined));
  const shareSet = (code: string) => appMoneyFrom(tenant?.appOrders?.money?.[code]).feePct !== null;
  return {
    weeks: rows.filter((r) => shareSet(r.k.a.code) || r.x.paidCents !== undefined).map((r) => view(r.x, r.k.a.code, r.k.a.label, r.k.w, thisWeek))
      .sort((p, q) => q.week.localeCompare(p.week) || apps.findIndex((a) => a.code === p.app) - apps.findIndex((a) => a.code === q.app)),
    needsShare: Array.from(new Set(rows.filter((r) => !shareSet(r.k.a.code)).map((r) => r.k.a.label))),
  };
}

const ref = (db: any, tenantId: string, app: string, week: string) => db.doc(`tenants/${tenantId}/private/${appWeekId(app, week)}`);
const checkKey = (app: unknown, week: unknown): Fail | null => (!APP_CODES.includes(String(app)) ? fail('Which app?', 400) : !WEEK.test(String(week)) || payoutWeek(String(week)) !== String(week) ? fail('Which week?', 400) : null);

/** What the app paid for a week, as a manager entered it (changed until a difference is booked). */
export async function payoutPaid(db: any, tenantId: string, tenant: any, app: unknown, week: unknown, cents: unknown, by: string, now = Date.now()): Promise<{ ok: true; week: PayoutWeek } | Fail> {
  const bad = checkKey(app, week); if (bad) return bad;
  const c = Math.round(Number(cents));
  if (!Number.isFinite(c) || c < 0 || c > 100_000_000) return fail('Type what came in, in dollars.', 400);
  const r = ref(db, tenantId, String(app), String(week)); const thisWeek = payoutWeek(tonight(tenant, new Date(now)));
  return db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(r)).data();
    if (!x || num(x.orders) <= 0) return fail('No orders from that app that week.', 404);
    if (x.adjustedAt) return fail('The difference for that week was booked already.', 409);
    tx.set(r, { paidCents: c, paidAt: new Date(now).toISOString(), paidBy: String(by || '').slice(0, 60) }, { merge: true });
    return { ok: true as const, week: view({ ...x, paidCents: c, paidAt: new Date(now).toISOString() }, String(app), String(x.label || ''), String(week), thisWeek) };
  });
}

/** A payout that doesn't match, its difference booked once as an app adjustment: less than the orders came to is an
 *  expense, more is income. */
export async function payoutAdjust(db: any, tenantId: string, tenant: any, app: unknown, week: unknown, by: string, now = Date.now()): Promise<{ ok: true; already?: boolean; cents: number; week: PayoutWeek } | Fail> {
  const bad = checkKey(app, week); if (bad) return bad;
  const r = ref(db, tenantId, String(app), String(week)); const thisWeek = payoutWeek(tonight(tenant, new Date(now)));
  const lineRef = db.doc(`tenants/${tenantId}/transactions/appadj_${String(app)}_${String(week)}`);
  const nowIso = new Date(now).toISOString();
  return db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(r)).data();
    if (!x) return fail('No orders from that app that week.', 404);
    if (x.adjustedAt) return { ok: true as const, already: true, cents: Math.round(num(x.adjustedCents)), week: view(x, String(app), String(x.label || ''), String(week), thisWeek) };
    if (x.paidCents === undefined || x.paidCents === null) return fail('Enter what came in first.', 409);
    const d = Math.round(num(x.paidCents)) - Math.round(num(x.payoutCents));
    if (Math.abs(d) <= matchWithin(num(x.orders))) return fail('It matches: nothing to book.', 409);
    const label = String(x.label || 'The app');
    tx.set(lineRef, { id: lineRef.id, tenantId, date: nowIso, createdAt: nowIso, type: d < 0 ? 'expense' : 'income', context: 'Business', category: 'Delivery App Adjustments', taxBucket: 'adjustment',
      amount: Math.abs(d) / 100, clientOrVendor: label, paymentMethod: 'Deducted from payout', hasReceipt: false, appKey: String(app), appWeek: String(week), by: String(by || '').slice(0, 60),
      description: `${label} payout, week of ${String(week)}: ${money(d)} ${d < 0 ? 'less' : 'more'} than its orders came to` });
    tx.set(r, { adjustedAt: nowIso, adjustedCents: d, adjustedBy: String(by || '').slice(0, 60) }, { merge: true });
    return { ok: true as const, cents: d, week: view({ ...x, adjustedAt: nowIso, adjustedCents: d }, String(app), label, String(week), thisWeek) };
  });
}
