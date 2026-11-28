// src/lib/books-close-server.ts — CLOSING A MONTH (server; lib/books-close is the rules; design board "Closing a
// month", option A). What's still open in a month before it's closed, closing it (and every month before it), and the
// owner reopening the last one closed, with a reason. Read and written through api/money/close.
//   tenants/{t}.booksClose                — what's closed (lib/books-close; firestore.rules keeps lines in it as they are)
//   tenants/{t}/private/booksClose        = { stack: [{ month, prev, at, by }], log: [{ kind, month, at, by, reason? }] }
import { booksSummary, isTeamPay } from './books-summary';
import type { MonthStatement } from './report-builders';
import { closeOf, closeThrough, monthAfter, monthDays, monthName } from './books-close';
import { lineDay } from './sales-tax-report';
import { filingOf, periodKeyFor, periodOf } from './sales-tax-filing';
import { posTaxOf } from './pos-tax';
import { todayIn, tenantTimeZone, addDays } from './tenant-time';

type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (n: number) => `$${(Math.round(Math.abs(n) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTH = /^\d{4}-\d{2}$/;

export type CloseCheck = { id: string; ok: boolean; info?: boolean; title: string; detail: string; href?: string };
export type MonthView = { month: string; label: string; ended: boolean; closed: boolean; checks: CloseCheck[]; figures: { netSales: number; costs: number; profit: number } };

/** The month to close next: the one after the last closed, once it's over; else the last month that's over. */
export function nextToClose(tenant: any, today: string): string {
  const c = closeOf(tenant); const last = monthAfter(today.slice(0, 7), -1);
  return c && c.through < last ? monthAfter(c.through) : last;
}

/** What's still open in a month, and its figures. */
export async function monthView(db: any, tenantId: string, tenant: any, m: string, now = Date.now()): Promise<MonthView> {
  const T = `tenants/${tenantId}`; const tz = tenantTimeZone(tenant); const today = todayIn(tz, new Date(now));
  const { start, end } = monthDays(m); const { openFrom } = closeThrough(tenant, m);
  const c = closeOf(tenant); const closed = !!c && c.through >= m;
  const snap = await db.collection(`${T}/transactions`).where('date', '>=', addDays(start, -1)).where('date', '<', addDays(end, 2)).get();
  const lines = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((t: any) => { const d = lineDay(t, tz); return d >= start && d <= end; });
  const s = booksSummary(lines, { businessOnly: true });
  const checks: CloseCheck[] = [];
  // Bank lines from the month still waiting in the inbox (one still pending at the bank can't be sorted yet: said, not
  // counted against the month), sorted at the top of Books.
  const waiting = ((await db.collection(`${T}/bankTransactions`).where('status', '==', 'unmatched').limit(3000).get().catch(() => ({ docs: [] as any[] }))).docs as any[])
    .map((d: any) => d.data() || {}).filter((b: any) => { const d = String(b.date || '').slice(0, 10); return d >= start && d <= end; });
  const bank = waiting.filter((b: any) => !b.pending); const stillPending = waiting.length - bank.length;
  checks.push(bank.length ? { id: 'bank', ok: false, title: `${bank.length} bank line${bank.length === 1 ? '' : 's'} still to sort`, detail: 'Each has a category picked, waiting at the top of Books', href: '/money?tab=bank' }
    : { id: 'bank', ok: true, title: 'Every bank line is sorted', detail: stillPending ? `Matched or booked. ${stillPending} still pending at the bank.` : 'Matched or booked' });
  // Checks and desk sales with money taken but never closed (lib/night-close-server): not in the books until they are.
  const taken = (pc: any) => String(pc.status) === 'paid_waiting' ? Math.round(num(pc.paidCents))
    : Math.round((Array.isArray(pc.tenders) ? pc.tenders : []).filter((x: any) => x && !x.refundedAt).reduce((n: number, x: any) => n + num(x.amount) + num(x.tip), 0) * 100);
  const open = ((await db.collection(`${T}/pendingCheckouts`).where('status', 'in', ['partial', 'paid_waiting']).limit(300).get().catch(() => ({ docs: [] as any[] }))).docs as any[])
    .map((d: any) => d.data() || {}).filter((pc: any) => taken(pc) > 0 && String(pc.createdAt || pc.updatedAt || '') < openFrom);
  if (open.length) checks.push({ id: 'checks', ok: false, title: `${open.length} check${open.length === 1 ? ' was' : 's were'} paid but never closed`, detail: `${money(open.reduce((n: number, pc: any) => n + taken(pc), 0) / 100)} isn’t in ${monthName(m, false)}’s sales until ${open.length === 1 ? 'it is' : 'they are'}`, href: '/pos' });
  else checks.push({ id: 'checks', ok: true, title: 'Every check with money taken is closed', detail: 'All in the books' });
  // Drawers still open from the month.
  const tills = ((await db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(200).get().catch(() => ({ docs: [] as any[] }))).docs as any[])
    .map((d: any) => d.data() || {}).filter((x: any) => String(x.openedAt || '') < openFrom);
  checks.push(tills.length ? { id: 'drawers', ok: false, title: `${tills.length} drawer${tills.length === 1 ? ' is' : 's are'} still open`, detail: 'Count and close them, so their cash is in the books', href: '/pos' }
    : { id: 'drawers', ok: true, title: 'Every drawer is counted and closed', detail: 'All of the month’s cash is in' });
  // Delivery app weeks of the month still waiting on their payout.
  if (tenant?.appOrders) {
    const AP = await import('./app-payouts-server');
    const r = await AP.payoutWeeks(db, tenantId, tenant, now).catch(() => ({ weeks: [] as any[] }));
    const waiting = (r.weeks || []).filter((w: any) => w.weekEnd >= start && w.weekEnd <= end && w.status === 'waiting');
    checks.push(waiting.length ? { id: 'apps', ok: false, title: `${waiting.length} delivery app week${waiting.length === 1 ? '' : 's'} still waiting on ${waiting.length === 1 ? 'its' : 'their'} payout`, detail: 'Its orders are in the books; what the app paid isn’t checked yet', href: '/money' }
      : { id: 'apps', ok: true, title: 'Delivery app weeks are paid', detail: 'Every week of the month checked' });
  }
  // Lines without a category.
  checks.push(s.unsorted.count ? { id: 'unsorted', ok: false, title: `${s.unsorted.count} line${s.unsorted.count === 1 ? '' : 's'} without a category`, detail: `${money(s.unsorted.amount)} the reports can’t place yet`, href: '/money' }
    : { id: 'unsorted', ok: true, title: 'Nothing is waiting for a category', detail: `Every line in ${monthName(m, false)} is sorted` });
  // Sales tax, when its period ends with this month (lib/sales-tax-filing): for the record, never in the way.
  if (!posTaxOf(tenant).unset) {
    const f = filingOf(tenant); const p = periodOf(periodKeyFor(end, f.every), f.dueDay);
    if (p && p.end === end) {
      const paid: any = (await db.doc(`${T}/private/salesTaxPaid_${p.key}`).get()).data();
      checks.push(paid?.at ? { id: 'salestax', ok: true, info: true, title: `Sales tax for ${p.label}`, detail: Number(paid.cents) > 0 ? `Recorded as paid: ${money(Number(paid.cents) / 100)}` : 'Filed, nothing to pay' }
        : { id: 'salestax', ok: false, info: true, title: `Sales tax for ${p.label}`, detail: `Due ${p.dueLabel}. Not recorded as paid yet`, href: '/settings?tab=payments#sales-tax' });
    }
  }
  const costs = s.cogs + s.netFees + s.operatingExpenses;
  return { month: m, label: monthName(m), ended: today > end, closed, checks, figures: { netSales: s.netSales, costs: Math.round(costs * 100) / 100, profit: s.net } };
}

/** The months around now: the one to close, the last few closed, and this one. */
export async function closeOverview(db: any, tenantId: string, tenant: any, want?: unknown, now = Date.now()) {
  const tz = tenantTimeZone(tenant); const today = todayIn(tz, new Date(now)); const c = closeOf(tenant);
  const m = typeof want === 'string' && MONTH.test(want) ? want : nextToClose(tenant, today);
  if (m > today.slice(0, 7)) return fail('That month hasn’t started yet.', 400);
  const view = await monthView(db, tenantId, tenant, m, now);
  const log: any[] = ((await db.doc(`tenants/${tenantId}/private/booksClose`).get()).data() || {}).log || [];
  const closedAt = (mm: string) => [...log].reverse().find((x: any) => x.kind === 'close' && x.month >= mm) || null;
  const months = [0, -1, -2, -3].map((i) => monthAfter(today.slice(0, 7), i)).map((mm) => {
    const isClosed = !!c && c.through >= mm; const by = isClosed ? closedAt(mm) : null;
    return { month: mm, label: monthName(mm, false), current: mm === today.slice(0, 7), closed: isClosed, at: by?.at || null, by: by?.by || null };
  });
  return { ok: true as const, view, months, through: c?.through || null, today };
}

/** Closed: this month and every one before it. Not before it's over; never one that's closed already. */
export async function closeMonth(db: any, tenantId: string, tenant: any, m: unknown, by: string, now = Date.now()) {
  if (typeof m !== 'string' || !MONTH.test(m)) return fail('Which month?', 400);
  const today = todayIn(tenantTimeZone(tenant), new Date(now));
  if (today <= monthDays(m).end) return fail(`${monthName(m, false)} isn’t over yet.`, 409);
  const nowIso = new Date(now).toISOString(); const T = `tenants/${tenantId}`;
  return db.runTransaction(async (tx: any) => {
    const t: any = (await tx.get(db.doc(T))).data() || {};
    const cur = closeOf(t);
    if (cur && cur.through >= m) return { ok: true as const, already: true, through: cur.through };
    const pRef = db.doc(`${T}/private/booksClose`); const p: any = (await tx.get(pRef)).data() || {};
    const next = closeThrough(t, m);
    tx.set(db.doc(T), { booksClose: { ...next, at: nowIso, by } }, { merge: true });
    tx.set(pRef, { stack: [...(Array.isArray(p.stack) ? p.stack : []), { month: m, prev: cur?.through || null, at: nowIso, by }].slice(-60),
      log: [...(Array.isArray(p.log) ? p.log : []), { kind: 'close', month: m, at: nowIso, by }].slice(-200) }, { merge: true });
    return { ok: true as const, through: m };
  });
}

/** Reopened by the owner: the last month closed, back to what was closed before it. A reason is kept on the record. */
export async function reopenMonth(db: any, tenantId: string, by: string, reason: unknown, now = Date.now()) {
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) return fail('Say why it’s being reopened. It’s kept on the record.', 400);
  const nowIso = new Date(now).toISOString(); const T = `tenants/${tenantId}`;
  return db.runTransaction(async (tx: any) => {
    const t: any = (await tx.get(db.doc(T))).data() || {};
    const cur = closeOf(t); if (!cur) return fail('No month is closed.', 409);
    const pRef = db.doc(`${T}/private/booksClose`); const p: any = (await tx.get(pRef)).data() || {};
    const stack: any[] = Array.isArray(p.stack) ? [...p.stack] : [];
    const top = stack.length && stack[stack.length - 1].month === cur.through ? stack.pop() : null;
    const prev = top ? top.prev : monthAfter(cur.through, -1);
    tx.set(db.doc(T), { booksClose: prev ? { ...closeThrough(t, prev), at: nowIso, by } : null }, { merge: true });
    tx.set(pRef, { stack, log: [...(Array.isArray(p.log) ? p.log : []), { kind: 'reopen', month: cur.through, at: nowIso, by, reason: why }].slice(-200) }, { merge: true });
    return { ok: true as const, reopened: cur.through, through: prev };
  });
}

/** A closed month's statement (the Reports tab's Closed months; lib/report-builders buildMonthStatementHtml): its
 *  figures, its sales tax, how its bank lines were sorted (the owner's only), what's held, and every correction made
 *  to one of its lines after it closed. */
export async function monthStatement(db: any, tenantId: string, tenant: any, m: unknown, owner: boolean): Promise<({ ok: true } & MonthStatement) | Fail> {
  if (typeof m !== 'string' || !MONTH.test(m)) return fail('Which month?', 400);
  const c = closeOf(tenant); if (!c || c.through < m) return fail(`${monthName(m)} isn’t closed yet.`, 409);
  const T = `tenants/${tenantId}`; const tz = tenantTimeZone(tenant); const { start, end } = monthDays(m);
  const snap = await db.collection(`${T}/transactions`).where('date', '>=', addDays(start, -1)).where('date', '<', addDays(end, 2)).get();
  const lines = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((t: any) => { const d = lineDay(t, tz); return d >= start && d <= end; });
  const s = booksSummary(lines, { businessOnly: true });
  const pay = s.byCategory.opex.filter(([k]) => isTeamPay(k)).reduce((n, [, v]) => n + v, 0);
  const by = closedBy(((await db.doc(`${T}/private/booksClose`).get()).data() || {}).stack, m);
  // Sales tax: the return its month ends, when it ends with this one.
  let period: MonthStatement['tax']['period'] = null;
  if (!posTaxOf(tenant).unset) {
    const f = filingOf(tenant); const p = periodOf(periodKeyFor(end, f.every), f.dueDay);
    if (p && p.end === end) { const paid: any = (await db.doc(`${T}/private/salesTaxPaid_${p.key}`).get()).data(); period = { label: p.label, due: p.dueLabel, paid: !!paid?.at }; }
  }
  // The bank (the owner's to see).
  let bank: MonthStatement['bank'] = null;
  if (owner) {
    const b = ((await db.collection(`${T}/bankTransactions`).where('date', '>=', start).where('date', '<=', end).limit(5000).get().catch(() => ({ docs: [] as any[] }))).docs as any[]).map((d: any) => d.data() || {}).filter((x: any) => !['cleared'].includes(String(x.status)));
    bank = { total: b.length, sorted: b.filter((x: any) => x.status !== 'unmatched').length, waiting: b.filter((x: any) => x.status === 'unmatched').length };
  }
  // Corrections made after it closed, to one of its lines (components/money/BooksScreen correctionFor).
  const ids = new Set(lines.map((t: any) => String(t.id)));
  // (One field asked for, so it needs no index of its own; corrections are few.)
  const fixes = ((await db.collection(`${T}/transactions`).where('paymentMethod', '==', 'Correction').limit(2000).get().catch(() => ({ docs: [] as any[] }))).docs as any[])
    .map((d: any) => d.data() || {}).filter((t: any) => t.correctionOf && ids.has(String(t.correctionOf)));
  const corrections = fixes.map((t: any) => ({ date: String(t.date || ''), description: String(t.description || 'A correction'), amount: Math.round(Number(t.amount) * 100) / 100 * (t.type === 'reversal' ? -1 : 1), by: String(t.enteredBy || '') }))
    .sort((a: any, b: any) => a.date.localeCompare(b.date));
  const costs = s.cogs + s.netFees + s.operatingExpenses;
  return { ok: true as const, month: m, label: monthName(m), start, end, closedAt: by?.at || c.at || null, closedBy: by?.by || c.by || null,
    figures: { sales: s.sales, returns: s.returns, discounts: s.discounts, netSales: s.netSales, tips: s.tips, otherIncome: s.otherIncome, cogs: s.cogs, fees: s.netFees,
      teamPay: Math.round(pay * 100) / 100, otherCosts: Math.round((s.operatingExpenses - pay) * 100) / 100, costs: Math.round(costs * 100) / 100, profit: s.net },
    tax: { collected: s.taxCollected, givenBack: s.taxRefunded, owed: s.taxOwed, paid: s.taxPaid, period },
    bank, held: { giftCards: s.giftCardsSold, renters: s.heldForRenters }, corrections };
}

/** Who closed a month and when: the close that covered it, from the closes still standing (each covers the months after
 *  the one closed before it, up to its own; a reopened month's close is gone from the stack). */
export function closedBy(stack: unknown, m: string): { at: string; by: string } | null {
  const st: any[] = Array.isArray(stack) ? stack : [];
  const e = st.find((x: any) => (!x.prev || String(x.prev) < m) && m <= String(x.month));
  return e ? { at: String(e.at || ''), by: String(e.by || '') } : null;
}

/** The months that are closed, newest first, with who closed each and when: the last twelve, never before the business
 *  began. */
export async function closedMonths(db: any, tenantId: string, tenant: any) {
  const c = closeOf(tenant); if (!c) return { ok: true as const, months: [] as any[] };
  const stack = ((await db.doc(`tenants/${tenantId}/private/booksClose`).get()).data() || {}).stack;
  const began = (() => { const v = tenant?.createdAt; const d = v?.toDate ? v.toDate() : v ? new Date(v) : null; return d && Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 7) : ''; })();
  const months: { month: string; label: string; at: string | null; by: string | null }[] = [];
  for (let mm = c.through, i = 0; i < 12 && (!began || mm >= began); i++, mm = monthAfter(mm, -1)) {
    const e = closedBy(stack, mm);
    months.push({ month: mm, label: monthName(mm), at: e?.at || null, by: e?.by || null });
  }
  return { ok: true as const, months };
}
