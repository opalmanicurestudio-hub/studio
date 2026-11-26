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

const dayMs = (d: string) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);

/** A payout from an app landing in the bank (lib/plaid-sync). Its orders are in the books already, so nothing is booked:
 *  it's added to the oldest of the app's last few weeks it fits in (apps pay a week at once, a day at a time, or early
 *  with Fast Pay), and that week's paid amount is filled in once the bank's payouts for it add up to what its orders
 *  came to, so a week paid in pieces never shows short partway. A figure a manager typed is never replaced. The same bank
 *  line twice changes nothing. Returns the week it went to, or null when it fits none (it then waits for the owner). */
export async function bankPayout(db: any, tenantId: string, tenant: any, app: string, cents: number, bankLineId: string, bankDay: string, now = Date.now(), unwritten: Set<string> = new Set()): Promise<{ week: string; bankCents: number; payoutCents: number; late?: boolean; bumped?: string[] } | null> {
  if (!APP_CODES.includes(String(app)) || !(cents > 0)) return null;
  const thisWeek = payoutWeek(tonight(tenant, new Date(now)));
  // Weeks it could be for: started by the day it came in, ended no more than three weeks before. The week of the day
  // before it came in first (an app pays the day after, or the week after), then older weeks, nearest first, then newer.
  const cands = Array.from({ length: PAYOUT_WEEKS }, (_, i) => addDays(thisWeek, -7 * i))
    .filter((w) => dayMs(bankDay) >= dayMs(w) && dayMs(bankDay) - dayMs(addDays(w, 6)) <= 21 * 86400000);
  const anchor = payoutWeek(addDays(String(bankDay).slice(0, 10), -1));
  const order = [...cands.filter((w) => w === anchor), ...cands.filter((w) => w < anchor), ...cands.filter((w) => w > anchor).reverse()];
  const nowIso = new Date(now).toISOString();
  // Room on a week for this line (a week whose difference was booked only takes what makes up that difference exactly).
  const fitOf = (x: any) => {
    if (!x || num(x.orders) <= 0) return null;
    const total = Math.round(num(x.bankCents)) + Math.round(cents); const payoutCents = Math.round(num(x.payoutCents)); const within = matchWithin(num(x.orders));
    const exact = Math.abs(total - payoutCents) <= within;
    return total > payoutCents + within || (x.adjustedAt && !exact) ? null : { total, payoutCents, within, exact };
  };
  // A week this line pays off on its own while something smaller from the app took part of its room first (a credit,
  // a refund on her own order): the payout takes the week, and what was on it goes back to her to sort.
  // (Only while the week is still owed more than what's on it, and what's on it is less than this line: never a payout
  // already there.)
  const aloneOf = (x: any) => !!x && num(x.orders) > 0 && !x.adjustedAt && Math.round(num(x.bankCents)) > 0
    && Math.round(num(x.bankCents)) < Math.round(num(x.payoutCents)) - matchWithin(num(x.orders)) && Math.round(num(x.bankCents)) < Math.round(cents)
    && Math.abs(Math.round(cents) - Math.round(num(x.payoutCents))) <= matchWithin(num(x.orders));
  const snaps = await Promise.all(order.map(async (w) => ({ w, x: (await ref(db, tenantId, app, w).get()).data() })));
  // The same line twice: the week it went to.
  const seen = snaps.find((s) => Array.isArray(s.x?.bankLines) && s.x.bankLines.includes(bankLineId));
  if (seen) return { week: seen.w, bankCents: Math.round(num(seen.x.bankCents)), payoutCents: Math.round(num(seen.x.payoutCents)), ...(seen.x.adjustedAt ? { late: true } : {}) };
  // The week of the day before first, if it pays it off (with what's on it, or on its own); then a week it pays off
  // exactly (a weekly payout, or the rest of one), then one it pays off on its own, else the first with room (a day's
  // payout).
  const first = snaps.find((s) => s.w === anchor && (fitOf(s.x)?.exact || aloneOf(s.x)));
  const pick = first || snaps.find((s) => fitOf(s.x)?.exact) || snaps.find((s) => aloneOf(s.x)) || snaps.find((s) => fitOf(s.x));
  if (!pick) return null;
  const r = ref(db, tenantId, app, pick.w);
  return db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(r)).data();
    const lines: string[] = Array.isArray(x?.bankLines) ? x.bankLines : [];
    if (lines.includes(bankLineId)) return { week: pick.w, bankCents: Math.round(num(x.bankCents)), payoutCents: Math.round(num(x.payoutCents)), ...(x.adjustedAt ? { late: true } : {}) };
    const typed = x && x.paidCents !== undefined && x.paidCents !== null && x.paidBy !== 'Bank feed';
    const f = fitOf(x);
    if (!f?.exact && aloneOf(x)) {
      const bumped = lines.filter((id) => id !== bankLineId);
      // (Lines this sync hasn't written yet are left to it: it changes them before they're written.)
      for (const id of bumped) if (!unwritten.has(id)) tx.set(db.doc(`tenants/${tenantId}/bankTransactions/${id}`), bumpedLine(), { merge: true });
      tx.set(r, { bankCents: Math.round(cents), bankLines: [bankLineId], ...(!typed ? { paidCents: Math.round(cents), paidAt: nowIso, paidBy: 'Bank feed' } : {}) }, { merge: true });
      return { week: pick.w, bankCents: Math.round(cents), payoutCents: Math.round(num(x.payoutCents)), bumped };
    }
    if (!f) return null;
    // A week whose difference was booked already: what came in is kept on it, and nothing else changes (the line
    // waits for her, as making up that difference).
    if (x.adjustedAt) { tx.set(r, { bankCents: f.total, bankLines: [...lines, bankLineId].slice(-60) }, { merge: true }); return { week: pick.w, bankCents: f.total, payoutCents: f.payoutCents, late: true }; }
    tx.set(r, { bankCents: f.total, bankLines: [...lines, bankLineId].slice(-60), ...(f.exact && !typed ? { paidCents: f.total, paidAt: nowIso, paidBy: 'Bank feed' } : {}) }, { merge: true });
    return { week: pick.w, bankCents: f.total, payoutCents: f.payoutCents };
  });
}

/** A bank line from an app that was on a week until that week's payout came in whole: back to her, to sort (money from
 *  the app that isn't a payout, such as a credit). */
export function bumpedLine() {
  return { status: 'unmatched', matchedAppWeek: null, hint: 'From the delivery app, but not part of a payout (its week was paid in full). A credit or a refund?', suggestedCategory: 'Delivery App Adjustments', suggestedTaxBucket: 'adjustment', suggestedType: 'income' };
}

/** Weeks the bank paid only part of, ten days after they ended (an app pays within a few days): what came in is filled
 *  in, so the Money page shows the week short and the difference can be booked. Never over a figure a manager typed. */
export async function settleBankWeeks(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<number> {
  const thisWeek = payoutWeek(tonight(tenant, new Date(now)));
  const today = tonight(tenant, new Date(now)); const nowIso = new Date(now).toISOString(); let n = 0;
  for (const a of appsOf(tenant)) for (let i = 1; i < PAYOUT_WEEKS; i++) {
    const w = addDays(thisWeek, -7 * i);
    if (dayMs(today) - dayMs(addDays(w, 6)) < 10 * 86400000) continue;
    const r = ref(db, tenantId, a.code, w);
    const done = await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(r)).data();
      // (Under half of it: more is likely still to come, or it isn't the payout at all. It waits, never shown short.)
      if (!x || x.adjustedAt || !(num(x.bankCents) > 0) || (x.paidCents !== undefined && x.paidCents !== null) || num(x.bankCents) * 2 < num(x.payoutCents)) return false;
      tx.set(r, { paidCents: Math.round(num(x.bankCents)), paidAt: nowIso, paidBy: 'Bank feed' }, { merge: true }); return true;
    }).catch(() => false);
    if (done) n++;
  }
  return n;
}
