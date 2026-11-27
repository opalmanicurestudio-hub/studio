// src/lib/payroll-bank.ts — PAYROLL BOOKED ONCE, when payday was recorded before the payroll company's withdrawals reach
// the bank (the other way round is lib/payday-record). A payroll company takes the employees' pay in one or more
// withdrawals (their take-home pay, then the taxes held back and the employer's own taxes). Payday booked their pay
// already, so each withdrawal is matched against it until it's used up, and only what's beyond it is booked: the
// employer's payroll taxes and the company's fees.
//   On each payday line: bankCover = { [bank line id]: cents } (so a check run again never counts a withdrawal twice).
import { datedFor } from './books-close';
import { bankWindow } from './payday-record';
const DAY = 86400000;
const dayMs = (d: string) => Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`);
const cents = (t: any) => Math.round((Number(t?.amount) || 0) * 100);

/** A payday line a payroll company's withdrawal can be matched to: the employees' pay (never cash tips taken home,
 *  contractors or set-asides), and, when payroll is run in ClarityFlow, the employer's payroll taxes payday booked (a
 *  tax payment booked as payroll a few days after payday is that money, not more of it), in these books. */
export const coverable = (t: any, context = 'Business') => !!t?.paydayPeriod && /^payroll( taxes)?$/i.test(String(t?.category || '')) && String(t?.paymentMethod || '') === 'Distribution'
  && (t?.context || 'Business') === context && (t?.type || 'expense') === 'expense' && t?.voided !== true;
/** What's left of a payday line to match: nothing once it's matched in full. */
export const leftOf = (t: any, btId?: string) => (t?.reconciled && !(btId && t?.bankCover?.[btId] != null) ? 0
  : Math.max(0, cents(t) - Object.entries(t?.bankCover || {}).filter(([k]) => k !== btId).reduce((n, [, v]) => n + (Number(v) || 0), 0)));

export type CoverPlan = { period: string; periods: string[]; parts: { id: string; cents: number; full: boolean }[]; covered: number; extra: number };

/** Which recorded paydays a payroll company's withdrawal (outflow, `amountCents`, on `date`) belongs to, and how much of
 *  it their pay covers. Paydays recorded from three weeks before the withdrawal to ten days after it, with pay left to
 *  match, are used nearest first (the older first when as near), one after another until the withdrawal is used up: a
 *  few dollars left on an earlier payday never sends the rest of the next one's pay to payroll taxes. What's beyond all
 *  of them is extra. Null: none, so it's booked as it is. */
export function planPayrollCover(ledger: any[], bank: { id: string; amountCents: number; date: string; context?: string }, tenant?: any): CoverPlan | null {
  const at = dayMs(bank.date); const ctx = bank.context || 'Business';
  const pools = new Map<string, any[]>();
  // (With the business's pay periods: only a payday whose own withdrawals fall on that day, from a few days before its
  // period ends to a few days after its payday. A withdrawal for the next payday, before that one is recorded, is never
  // matched to what's left of the one before: it's booked from the bank, and recording the next payday claims it.)
  const own = (t: any) => { if (!tenant || !/^\d{4}-\d{2}-\d{2}$/.test(String(t.paydayFrom || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(t.paydayTo || ''))) return null;
    const w = bankWindow(tenant, String(t.paydayFrom), String(t.paydayTo)); return { first: dayMs(w.first), last: dayMs(w.last) + 5 * DAY }; };
  for (const t of ledger) {
    if (!coverable(t, ctx)) continue;
    const w = own(t); const d = dayMs(t.date);
    if (w ? !(at >= w.first && at <= w.last) : !(d >= at - 21 * DAY && d <= at + 10 * DAY)) continue;
    const k = String(t.paydayPeriod); (pools.get(k) || pools.set(k, []).get(k)!).push(t);
  }
  const order = [...pools.entries()].map(([period, lines]) => ({ period, lines: lines.sort((a, b) => String(a.id).localeCompare(String(b.id))),
    left: lines.reduce((n, t) => n + leftOf(t, bank.id), 0), gap: Math.min(...lines.map((t) => Math.abs(dayMs(t.date) - at))) }))
    .filter((p) => p.left > 0).sort((a, b) => a.gap - b.gap || a.period.localeCompare(b.period));
  if (!order.length) return null;
  let want = bank.amountCents; const parts: CoverPlan['parts'] = []; const periods: string[] = [];
  for (const pool of order) {
    if (want <= 0) break;
    for (const t of pool.lines) { if (want <= 0) break; const l = leftOf(t, bank.id); if (l <= 0) continue; const take = Math.min(l, want); want -= take; parts.push({ id: String(t.id), cents: take, full: take === l }); if (!periods.includes(pool.period)) periods.push(pool.period); }
  }
  if (!parts.length) return null;
  const covered = bank.amountCents - want;
  return { period: periods[0], periods, parts, covered, extra: want };
}

const addDays = (d: string, n: number) => new Date(dayMs(d) + n * DAY).toISOString().slice(0, 10);

/** Matches a payroll company's withdrawal to a recorded payday, reading payday's lines as they are now (never a copy
 *  read earlier: payday may have been recorded a moment ago), in one step: the pay it covers marked on payday's lines,
 *  what's beyond it booked as payroll taxes (paydiff_{bank line}), and, when `write` is set, the bank line marked
 *  matched (the Bank screen's Book; the sync writes its own record). Null: no recorded payday to match it to, so it's
 *  booked as it is. 'sorted': the bank line was sorted meanwhile. */
export async function coverWithPayday(db: any, tenantId: string, biz: any, b: { id: string; amountCents: number; date: string; context?: string; name: string },
  nowIso: string, opts: { write?: boolean } = {}): Promise<{ plan: CoverPlan; diffId: string | null } | null | 'sorted'> {
  const T = `tenants/${tenantId}`;
  const fresh = (await db.collection(`${T}/transactions`).where('paydayTo', '>=', addDays(b.date, -40)).limit(500).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const first = planPayrollCover(fresh, b, biz); if (!first) return null;
  // (Every payday line it could be matched to, read again in the step itself: one matched meanwhile counts as it is now.)
  const poolIds = fresh.filter((t: any) => coverable(t, b.context || 'Business')).map((t: any) => String(t.id));
  return db.runTransaction(async (tx: any) => {
    const btRef = db.doc(`${T}/bankTransactions/${b.id}`);
    if (opts.write) { const cur: any = (await tx.get(btRef)).data(); if (!cur || cur.status !== 'unmatched' || cur.pending) return 'sorted' as const; }
    const refs = poolIds.map((id: string) => db.doc(`${T}/transactions/${id}`));
    const pool = (await Promise.all(refs.map((r: any) => tx.get(r)))).filter((d: any) => d.exists).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const plan = planPayrollCover(pool, b, biz); if (!plan) return null;
    for (const x of plan.parts) tx.set(db.doc(`${T}/transactions/${x.id}`), { bankCover: { [b.id]: x.cents }, ...(x.full ? { reconciled: true, reconciledAt: nowIso, bankTransactionId: b.id } : {}) }, { merge: true });
    let diffId: string | null = null;
    if (plan.extra > 0) {
      // (Beyond the pay payday booked: the employer's payroll taxes and the company's fees.)
      diffId = `paydiff_${String(b.id).replace(/[^A-Za-z0-9_-]/g, '')}`;
      tx.set(db.doc(`${T}/transactions/${diffId}`), {
        id: diffId, type: 'expense', context: b.context || 'Business', taxBucket: 'payroll', category: 'Payroll Taxes', amount: plan.extra / 100,
        description: `${b.name}: payroll taxes and fees, beyond the pay booked on payday`, clientOrVendor: b.name,
        ...datedFor(biz, `${b.date}T12:00:00.000Z`), paymentMethod: 'Bank feed', hasReceipt: false, reconciled: true, reconciledAt: nowIso,
        bankTransactionId: b.id, differenceFor: plan.parts[0].id, autoCategorized: true, sortedBy: 'bank', tenantId, createdAt: nowIso,
      });
    }
    if (opts.write) tx.set(btRef, { status: 'matched', matchedBy: 'payroll', payrollPeriod: plan.period, payrollCoverCents: plan.covered, matchedTxnId: plan.parts[0].id,
      ...(plan.parts.length > 1 ? { matchedTxnIds: plan.parts.map((x) => x.id) } : {}), ...(diffId ? { diffTxnId: diffId } : {}), resolvedAt: nowIso }, { merge: true });
    return { plan, diffId };
  });
}

/** Whether a payroll company's withdrawal would be matched to a recorded payday now (nothing written). */
export async function paydayPlanFor(db: any, tenantId: string, biz: any, b: { id: string; amountCents: number; date: string; context?: string }): Promise<CoverPlan | null> {
  const fresh = (await db.collection(`tenants/${tenantId}/transactions`).where('paydayTo', '>=', addDays(b.date, -40)).limit(500).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  return planPayrollCover(fresh, b, biz);
}
