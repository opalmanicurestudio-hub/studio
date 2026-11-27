// src/lib/payroll-owed.ts — PAYROLL TAXES OWED AND PAID, when payroll is run in ClarityFlow (Money › Payday, design board
// "Payroll run in ClarityFlow", round 2, A). Each payday recorded keeps what it owes and when (lib/payday-record:
// run.taxes.owed, run.taxes.due); this puts them together the way they're paid:
//   The IRS: one deposit per due date (each month's paydays together, by the 15th of the next month; or each payday's
//   own, twice a week).
//   The state's income tax: the same, by North Carolina's NC-5 schedule (another state's paydays, by month).
//   State unemployment: each quarter. Federal unemployment: each quarter once what's owed for the year passes $500,
//   otherwise it carries over, to Form 940 in January.
//   Other payroll taxes the business added: each quarter.
// Payments are kept as payroll runs of their own (payrollRuns/taxpay_{key}, kind 'taxpayment', each payment toward it a
// part: only the server writes them, api/payroll/taxes and the bank sync). A bank payment for what was owed at the time
// settles it (`covers`), a cent or a dollar either way; a payday recorded later that adds to it leaves the rest to pay.
// And the numbers for the quarter's forms, line by line: Form 941, NC-5 and
// NCUI 101 (each person's wages, never a Social Security number: those go on the form itself).
import { payDateOf, afterQuarter, quarterWords, setupOf, payrollStateOf, stateFilingOf, businessDaysAfter, dueDates } from './payroll-taxes';
import { stateSpec } from './state-payroll';
import { tablesFor, suiOf } from './withholding';
import { priorOf, priorQuarterPart, priorQuarter } from './payroll-prior';

export type Agency = 'irs' | 'state' | 'sui' | 'futa' | 'other';
export type TaxPayment = { key: string; amount: number; paidOn: string; bankTransactionId?: string | null; recordedAt?: string;
  /** What it was owed when a bank payment settled it (a payment a little short or over still settles it). */
  covers?: number; parts?: { amount: number; paidOn: string; source: string; bankTransactionId?: string | null }[] };
export type OwedItem = {
  key: string; agency: Agency; name: string; amount: number; due: string | null;
  /** The paydays in it (their periods). */
  paydays: string[];
  /** More paydays can still be added to it (its month or quarter isn't over). */
  open: boolean;
  /** Federal unemployment under $500 so far this year: not paid on its own, it carries over. */
  carries?: boolean;
  paid: TaxPayment | null;
  /** What's still to pay: all of it, or what a payday recorded late added after it was paid. */
  left: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (d: string) => MONTH[Number(d.slice(5, 7)) - 1] || '';
const dayWords = (d: string) => `${monthName(d)} ${Number(d.slice(8, 10))}`;
const qOf = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3);
const qKey = (d: string) => `${d.slice(0, 4)}q${qOf(d) + 1}`;
const quarterEnd = (d: string) => { const y = Number(d.slice(0, 4)), q = qOf(d); return new Date(Date.UTC(y, q * 3 + 3, 0, 12)).toISOString().slice(0, 10); };
const monthEnd = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0, 12)).toISOString().slice(0, 10);

/** State unemployment on the old payroll's part of the quarter it stopped in (lib/payroll-prior): each person's wages
 *  up to the year's limit, less what was paid before that quarter began, at the business's rate. */
function priorSui(pr: any, tenant: any) {
  if (!pr) return null; const at = priorQuarter(pr); const pp = priorQuarterPart(pr, at.year, at.q, tablesFor(at.year).t.ss.base); if (!pp) return null;
  const sui = suiOf(payrollStateOf(tenant), setupOf(tenant), at.year);
  const rows = pp.rows.filter((x) => x.wages > 0).map((x) => ({ ...x, taxable: sui.base == null ? x.wages : r2(Math.min(x.wages, Math.max(0, sui.base - x.before))) }));
  return { year: at.year, q: at.q, through: String(pr.lastPayDate), rows, due: r2(rows.reduce((n, x) => n + x.taxable * sui.rate / 100, 0)), paid: pr.suiPaid === true };
}

/** The paydays recorded with their taxes worked out here. */
export const taxedRuns = (runs: any[]) => (runs || []).filter((r) => r?.kind === 'payday' && r.taxes?.owed && r.runBy === 'clarityflow');
export const paymentsOf = (runs: any[]): Record<string, TaxPayment> => Object.fromEntries((runs || []).filter((r) => r?.kind === 'taxpayment' && r.key && r.voided !== true)
  .map((r) => { const parts = Array.isArray(r.parts) ? r.parts : [{ amount: Number(r.amount) || 0, paidOn: String(r.paidOn || ''), source: String(r.source || 'hand'), bankTransactionId: r.bankTransactionId || null }];
    const bank = parts.find((x: any) => x.bankTransactionId);
    return [String(r.key), { key: String(r.key), amount: Number(r.amount) || 0, paidOn: String(r.paidOn || ''), bankTransactionId: bank?.bankTransactionId || null, recordedAt: r.recordedAt, covers: Number(r.covers) || 0, parts }]; }));

/** Everything the recorded paydays owe, grouped the way it's paid, with what's been paid. `stateName`: "North Carolina". */
export function owedItems(runs: any[], tenant: any, today: string, stateName = 'State'): OwedItem[] {
  const paid = paymentsOf(runs);
  const groups = new Map<string, OwedItem>();
  const put = (key: string, agency: Agency, name: string, due: string | null, amount: number, payday: string, open: boolean) => {
    if (!(amount > 0)) return;
    const g = groups.get(key) || { key, agency, name, amount: 0, due, paydays: [], open, paid: null, left: 0 };
    g.amount = r2(g.amount + amount); if (!g.paydays.includes(payday)) g.paydays.push(payday); g.open = g.open || open; groups.set(key, g);
  };
  const futa = new Map<string, { amount: number; paydays: string[] }>();   // by quarter ("2026q4")
  const setup = setupOf(tenant); const spec = stateSpec(payrollStateOf(tenant));
  const progOf = (id: string) => (spec?.programs || []).find((x) => x.id === id.replace(/_er$/, ''));
  // (New York's, held until what's unpaid reaches $700: worked out after, payday by payday in order.)
  const nyQueue: { d: string; k: string; amount: number; tax: string; days: number }[] = [];
  for (const run of [...taxedRuns(runs)].sort((a, b) => payDateOf(a, tenant).localeCompare(payDateOf(b, tenant)))) {
    const d = payDateOf(run, tenant); if (!d) continue; const o = run.taxes.owed || {}; const due = run.taxes.due || {}; const k = String(run.periodKey || d);
    // (How each was to be paid, kept with the payday; a payday kept before that, by the settings now.)
    const sched = run.taxes.schedule || { irs: setup.federalDeposits === 'semiweekly' ? 'semiweekly' : 'monthly', state: stateFilingOf(tenant) };
    const semi = sched.irs === 'semiweekly';
    put(`irs_${due.irs || d.slice(0, 7)}`, 'irs', semi ? `IRS, payday of ${dayWords(d)}` : `IRS, ${monthName(d)}’s paydays`, due.irs || null, Number(o.irs) || 0, k, !semi && today <= monthEnd(d));
    // State income tax, by how often it's filed; a program the state collects with it (California's SDI, Rhode Island's
    // TDI) is in the same payment, so it's in the same item.
    const withWh = (o.other || []).filter((x: any) => progOf(String(x.id))?.paid === 'withholding');
    const stAmount = r2((Number(o.state) || 0) + withWh.reduce((n: number, x: any) => n + (Number(x.amount) || 0), 0));
    if (stAmount > 0) {
      const st = sched.state; const tax = `${stateName} ${withWh.length ? `income tax and ${[...new Set(withWh.map((x: any) => progOf(String(x.id))!.short || 'disability insurance'))].join(' and ')}` : 'income tax'}`;
      if (st === 'ny5' || st === 'ny3') nyQueue.push({ d, k, amount: stAmount, tax, days: st === 'ny3' ? 3 : 5 });
      else if (st === 'quarterly') put(`state_${due.state}`, 'state', `${tax}, ${quarterWords(d)}`, due.state || null, stAmount, k, today <= quarterEnd(d));
      else if (st === 'semiweekly') put(`state_${due.state}`, 'state', `${tax}, payday of ${dayWords(d)}`, due.state || null, stAmount, k, false);
      else if (st === 'semimonthly') { const early = Number(d.slice(8, 10)) <= 15;
        put(`state_${due.state || d.slice(0, 7)}`, 'state', `${tax}, ${monthName(d)} ${early ? '1 to 15' : `16 to ${Number(monthEnd(d).slice(8, 10))}`}`, due.state || null, stAmount, k, today <= (early ? `${d.slice(0, 8)}15` : monthEnd(d))); }
      else if (st === 'annually') put(`state_${d.slice(0, 4)}`, 'state', `${tax}, ${d.slice(0, 4)}`, due.state || null, stAmount, k, today <= `${d.slice(0, 4)}-12-31`);
      else put(`state_${due.state || d.slice(0, 7)}`, 'state', `${tax}, ${monthName(d)}`, due.state || null, stAmount, k, today <= monthEnd(d));
    }
    // State unemployment for the quarter, with what's paid on the same report and payment (an employee's share, New
    // Jersey's disability and family leave, Oregon's transit tax, Rhode Island's TDI).
    const withUi = (o.other || []).filter((x: any) => progOf(String(x.id))?.paid === 'ui');
    const uiNames = [...new Set(withUi.map((x: any) => progOf(String(x.id))!.short || progOf(String(x.id))!.name))];
    put(`sui_${qKey(d)}`, 'sui', `${stateName} unemployment${uiNames.length ? ` and ${uiNames.join(' and ')}` : ''}, ${quarterWords(d)}`, afterQuarter(d),
      r2((Number(o.sui) || 0) + withUi.reduce((n: number, x: any) => n + (Number(x.amount) || 0), 0)), k, today <= quarterEnd(d));
    // (The state's other programs: a quarterly report of their own, those on one report together; or to an insurance
    // company; the employee's part and the business's together. One the business added: when it's filed.)
    for (const x of o.other || []) {
      const pg = progOf(String(x.id)); if (pg?.paid === 'withholding' || pg?.paid === 'ui') continue;
      const id = String(pg ? pg.group || pg.id : x.id).replace(/[^A-Za-z0-9]/g, '');
      const together = pg?.group ? (spec?.programs || []).filter((q) => q.group === pg.group).map((q) => q.name) : null;
      put(`other_${id}_${qKey(d)}`, 'other', `${together ? together.join(' and ') : pg ? pg.name : x.name}, ${quarterWords(d)}${pg?.paid === 'carrier' ? ', to your insurance company' : ''}`, pg?.paid === 'quarterly' ? afterQuarter(d) : null, Number(x.amount) || 0, k, today <= quarterEnd(d));
    }
    if (Number(o.futa) > 0) { const f = futa.get(qKey(d)) || { amount: 0, paydays: [] }; f.amount = r2(f.amount + Number(o.futa)); f.paydays.push(k); futa.set(qKey(d), f); }
  }
  // New York: what's unpaid builds up, payday by payday, within the quarter; the payday that brings it to $700 or more
  // makes it all due 5 business days later (3, for a business that withheld $15,000 or more last year). What's left at
  // the quarter's end is paid with the NYS-45.
  const acc = new Map<string, { amount: number; parts: { k: string; amount: number }[] }>();
  for (const x of nyQueue) {
    const qk = qKey(x.d); const a = acc.get(qk) || { amount: 0, parts: [] }; a.amount = r2(a.amount + x.amount); a.parts.push({ k: x.k, amount: x.amount }); acc.set(qk, a);
    if (a.amount >= 700) { const due = businessDaysAfter(x.d, x.days); for (const pt of a.parts) put(`state_${due}`, 'state', `${x.tax}, through the payday of ${dayWords(x.d)}`, due, pt.amount, pt.k, false); acc.delete(qk); }
  }
  for (const [qk, a] of acc) { const last = nyQueue.filter((x) => qKey(x.d) === qk).pop()!;
    for (const pt of a.parts) put(`state_${qk}`, 'state', `${last.tax}, ${quarterWords(last.d)}, with the NYS-45`, afterQuarter(last.d), pt.amount, pt.k, today <= quarterEnd(last.d)); }
  // The old payroll's part of the quarter it stopped in (lib/payroll-prior):
  //   - its state unemployment is paid with that quarter's wage report, so it's in that quarter's, unless it paid it;
  //   - what it owed the IRS and the state for its part but didn't deposit is still owed, due when it was;
  //   - its federal unemployment not paid yet counts toward the year's $500.
  for (const pr of (runs || []).filter((r) => r?.kind === 'prior' && Array.isArray(r.people))) {
    const at = priorQuarter(pr); const qEndDay = new Date(Date.UTC(at.year, at.q * 3, 0, 12)).toISOString().slice(0, 10); const pk = `prior_${at.year}`;
    const ps = priorSui(pr, tenant);
    if (ps && !ps.paid && ps.due > 0) { const key = `sui_${ps.year}q${ps.q}`; put(key, 'sui', groups.get(key)?.name || `${stateName} unemployment, ${quarterWords(qEndDay)}`, afterQuarter(qEndDay), ps.due, pk, today <= qEndDay); }
    const pp = priorQuarterPart(pr, at.year, at.q, tablesFor(at.year).t.ss.base); const dd = dueDates(String(pr.lastPayDate), tenant);
    if (pp && pp.owed - pp.deposited >= 0.01) put(`irs_${pk}`, 'irs', `IRS, what your old payroll didn’t deposit`, dd.irs || null, r2(pp.owed - pp.deposited), pk, false);
    if (pp && pp.state - pp.stateDeposited >= 0.01) put(`state_${pk}`, 'state', `${stateName} income tax your old payroll didn’t pay`, dd.state || afterQuarter(qEndDay), r2(pp.state - pp.stateDeposited), pk, false);
    const futaOwed = r2((pr.people as any[]).reduce((n, x) => n + Math.min(7000, Number(x?.wages) || 0) * 0.006, 0));
    const unpaid = r2(Math.max(0, futaOwed - (Number(pr.futaPaid) || 0)));
    if (unpaid > 0) { const fk = `${at.year}q${at.q}`; const f = futa.get(fk) || { amount: 0, paydays: [] }; f.amount = r2(f.amount + unpaid); f.paydays.push(pk); futa.set(fk, f); }
  }
  // Federal unemployment: paid for a quarter once the year's unpaid total passes $500; otherwise it carries over to the
  // next, and the fourth quarter's is paid with Form 940. A quarter still going shows what's built up so far.
  for (const year of [...new Set([...futa.keys()].map((k) => k.slice(0, 4)))].sort()) {
    let carry = 0; let carried: string[] = [];
    for (let q = 1; q <= 4; q++) {
      const f = futa.get(`${year}q${q}`); if (f) { carry = r2(carry + f.amount); carried = [...carried, ...f.paydays]; }
      if (!carry) continue;
      const qEndDay = new Date(Date.UTC(Number(year), q * 3, 0, 12)).toISOString().slice(0, 10); const open = today <= qEndDay;
      if (!open && carry <= 500 && q < 4) continue;   // (carries over)
      const carries = carry <= 500 && q < 4;
      const name = carries ? `Federal unemployment, ${year} so far` : q === 4 && carry <= 500 ? `Federal unemployment, ${year}, with Form 940` : `Federal unemployment, ${quarterWords(qEndDay)}`;
      groups.set(`futa_${year}q${q}`, { key: `futa_${year}q${q}`, agency: 'futa', name, amount: carry, due: afterQuarter(qEndDay), paydays: carried, open, ...(carries ? { carries: true } : {}), paid: null, left: 0 });
      if (open) break;
      carry = 0; carried = [];
    }
  }
  const out = [...groups.values()];
  for (const g of out) { g.paid = paid[g.key] || null; g.left = r2(Math.max(0, g.amount - Math.max(g.paid?.amount || 0, g.paid?.covers || 0))); }
  return out.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || a.key.localeCompare(b.key));
}

// ── The quarter's forms ──
export type FormLine = { line: string; label: string; detail?: string; amount: number; count?: boolean };
const inQuarter = (d: string, year: number, q: number) => d.slice(0, 4) === String(year) && qOf(d) === q - 1;
const peopleOf = (runs: any[], tenant: any, year: number, q: number) => taxedRuns(runs).filter((r) => inQuarter(payDateOf(r, tenant), year, q))
  .flatMap((r) => (r.people || []).filter((p: any) => p.taxes && !p.contractor).map((p: any) => ({ run: r, p, d: payDateOf(r, tenant) })));

/** Form 941 for a quarter, line by line, from the paydays paid in it. */
export function form941(runs: any[], tenant: any, year: number, q: number, withPrior = true): { lines: FormLine[]; months: number[]; paydays: number; total: number; prior: { through: string; deposited: number } | null;
  /** The old payroll company files this quarter's returns (it's given these numbers for the paydays recorded here). */
  oldFiles: boolean } {
  const rows = peopleOf(runs, tenant, year, q); const sum = (f: (x: any) => number) => r2(rows.reduce((n, x) => n + (f(x) || 0), 0));
  // (The part of the quarter the old payroll paid, when it switched in this quarter: lib/payroll-prior. Deposited by it.)
  const pr = priorOf(runs, year); const pp = priorQuarterPart(pr, year, q, tablesFor(year).t.ss.base);
  // Line 1: everyone paid for the pay period that includes the 12th of the quarter's last month, whenever it was paid.
  const m3 = String(q * 3).padStart(2, '0'); const twelfth = `${year}-${m3}-12`;
  const onTheTwelfth = new Set([...taxedRuns(runs).filter((r) => String(r.from || '') <= twelfth && twelfth <= String(r.to || ''))
    .flatMap((r) => (r.people || []).filter((p: any) => p.taxes && !p.contractor && Number(p.taxes.gross) > 0).map((p: any) => p.staffId)),
    ...(pp && pr && pr.lastPayDate >= twelfth ? pp.rows.filter((x) => x.wages > 0).map((x) => x.staffId) : [])]).size;
  const T = (x: any) => x.p.taxes; const n = (v: any) => Number(v) || 0;
  const wages = r2(sum((x) => n(T(x).wages?.federal)) + (pp?.fedWages || 0)); const fed = r2(sum((x) => n(T(x).employee?.federal)) + (pp?.federal || 0));
  const ssTips = r2(sum((x) => Math.min(n(x.p.tips), n(T(x).wages?.socialSecurity))) + (pp?.ssTips || 0));
  const ss = r2(sum((x) => n(T(x).wages?.socialSecurity)) + (pp?.ssWages || 0) - ssTips); const med = r2(sum((x) => n(T(x).wages?.medicare)) + (pp?.medWages || 0));
  // (A payday kept before the wages were kept with it: worked back from the tax.)
  const addlWages = r2(sum((x) => (T(x).wages?.additionalMedicare != null ? n(T(x).wages.additionalMedicare) : n(T(x).employee?.additionalMedicare) / 0.009)) + (pp?.addlWages || 0));
  const l5a = r2(ss * 0.124), l5b = r2(ssTips * 0.124), l5c = r2(med * 0.029), l5d = r2(addlWages * 0.009); const l5e = r2(l5a + l5b + l5c + l5d);
  const l6 = r2(fed + l5e);
  const actual = r2(sum((x) => n(T(x).employee?.socialSecurity) + n(T(x).short?.socialSecurity) + n(T(x).employer?.socialSecurity) + n(T(x).employee?.medicare) + n(T(x).employee?.additionalMedicare) + n(T(x).short?.medicare) + n(T(x).employer?.medicare))
    + (pp ? pp.ss + pp.medicare + pp.employer : 0));
  const l7 = r2(actual - l5e); const l9 = r2(-sum((x) => n(T(x).short?.socialSecurity) + n(T(x).short?.medicare)));
  const l10 = r2(l6 + l7 + l9);
  const paid = paymentsOf(runs); const items = owedItems(runs, tenant, '9999-12-31');
  const l13 = r2(items.filter((i) => i.agency === 'irs' && i.paydays.some((k) => (pp && k === `prior_${year}`) || taxedRuns(runs).some((r) => String(r.periodKey) === k && inQuarter(payDateOf(r, tenant), year, q)))).reduce((s, i) => s + (paid[i.key]?.amount || 0), 0)
    + (pp?.deposited || 0));
  const months = [0, 1, 2].map((i) => { const mm = String((q - 1) * 3 + i + 1).padStart(2, '0');
    return r2(taxedRuns(runs).filter((r) => payDateOf(r, tenant).slice(0, 7) === `${year}-${mm}`).reduce((s, r) => s + n(r.taxes.owed?.irs), 0)); });
  // (The old payroll's part: all in the quarter's first month when it stopped then, else split by month from its reports.)
  const lastM = pp && pr ? (Number(pr.lastPayDate.slice(5, 7)) - 1) % 3 : -1; const priorOwed = pp ? pp.owed : 0;
  if (pp && lastM === 0) months[0] = r2(months[0] + priorOwed);
  const priorWords = pp && pr && lastM > 0 ? `, plus $${priorOwed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} your old payroll owed from ${MONTH[(q - 1) * 3]} to ${MONTH[(q - 1) * 3 + lastM]}: split it by month from its reports` : '';
  const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // Line 16: under $2,500 this quarter, or last quarter (when its paydays are here), no month by month; paying twice a
  // week, Schedule B, payday by payday; otherwise what was owed each month.
  // (Last quarter counts only when ClarityFlow ran all of it: a payday recorded here before it began.)
  const py = q === 1 ? year - 1 : year, pq = q === 1 ? 4 : q - 1; const pStart = `${py}-${String((pq - 1) * 3 + 1).padStart(2, '0')}-01`;
  const wholeBefore = withPrior && taxedRuns(runs).some((r) => { const d = payDateOf(r, tenant); return !!d && d < pStart; });
  const before = wholeBefore ? form941(runs, tenant, py, pq, false) : null;
  const small = l10 < 2500 || (!!before && before.total < 2500);
  const setup = setupOf(tenant); const qRuns = taxedRuns(runs).filter((r) => inQuarter(payDateOf(r, tenant), year, q));
  const semi = qRuns.some((r) => (r.taxes.schedule?.irs || (setup.federalDeposits === 'semiweekly' ? 'semiweekly' : 'monthly')) === 'semiweekly');
  const byDay = [...(pp && pr ? [`your old payroll’s paydays through ${dayWords(pr.lastPayDate)} ${money(priorOwed)} (each payday’s is on its reports)`] : []),
    ...[...qRuns].sort((a, b) => payDateOf(a, tenant).localeCompare(payDateOf(b, tenant))).map((r) => `${dayWords(payDateOf(r, tenant))} ${money(n(r.taxes.owed?.irs))}`)];
  const l16: FormLine = small
    ? { line: '16', label: 'Check the first box: no month-by-month amounts', detail: l10 < 2500 ? 'Under $2,500 this quarter.' : 'Under $2,500 last quarter.', amount: l10 }
    : semi ? { line: '16', label: 'Paid twice a week: check the third box and fill in Schedule B', detail: `What each payday owed: ${byDay.join(', ')}`, amount: l10 }
    : { line: '16', label: 'Owed each month', detail: `${months.map((v, i) => `${MONTH[(q - 1) * 3 + i]} ${money(v)}`).join(', ')}${priorWords}${before ? '' : '. If last quarter’s Form 941 was under $2,500, check the first box instead'}`, amount: r2(months[0] + months[1] + months[2] + (lastM > 0 ? priorOwed : 0)) };
  const lines: FormLine[] = [
    { line: '1', label: `People paid for the pay period that includes ${MONTH[q * 3 - 1]} 12`, amount: onTheTwelfth, count: true },
    { line: '2', label: 'Wages, tips and other pay', amount: wages },
    { line: '3', label: 'Federal income tax withheld', amount: fed },
    { line: '5a', label: 'Social Security wages', detail: `${money(ss)} × 12.4%`, amount: l5a },
    { line: '5b', label: 'Social Security tips', detail: `${money(ssTips)} × 12.4%`, amount: l5b },
    { line: '5c', label: 'Medicare wages and tips', detail: `${money(med)} × 2.9%`, amount: l5c },
    ...(l5d ? [{ line: '5d', label: 'Wages for the extra Medicare tax', detail: `${money(r2(addlWages))} × 0.9%`, amount: l5d }] : []),
    { line: '5e', label: 'Social Security and Medicare in all', amount: l5e },
    { line: '6', label: 'Taxes before adjustments', amount: l6 },
    { line: '7', label: 'Rounding (fractions of cents)', ...(pp && Math.abs(l7) > 5 ? { detail: 'More than rounding: check your old payroll’s Social Security and Medicare against its report' } : {}), amount: l7 },
    ...(l9 ? [{ line: '9', label: 'Social Security and Medicare on tips that couldn’t be withheld', amount: l9 }] : []),
    { line: '10', label: 'Total taxes', amount: l10 },
    { line: '12', label: 'Total taxes after credits', amount: l10 },
    { line: '13', label: 'Paid this quarter', ...(pp && pr ? { detail: `${money(pp.deposited)} of it deposited by your old payroll, through ${dayWords(pr.lastPayDate)}` } : {}), amount: l13 },
    { line: l10 >= l13 ? '14' : '15', label: l10 >= l13 ? 'Still to pay' : 'Paid more than owed', amount: r2(Math.abs(l10 - l13)) },
    l16,
  ];
  const oldFiles = !!pr?.oldFiles && priorQuarter(pr).year === year && priorQuarter(pr).q === q;
  return { lines, months, paydays: new Set(rows.map((x) => x.run.periodKey)).size, total: l10, prior: pp && pr ? { through: pr.lastPayDate, deposited: pp.deposited } : null, oldFiles };
}

/** North Carolina's NC-5 for the quarter: what was withheld each month, and paid. */
export function formStateWithholding(runs: any[], tenant: any, year: number, q: number) {
  const spec = stateSpec(payrollStateOf(tenant)); const name = spec?.name || 'State'; const form = spec?.filing?.quarterly || 'the state’s return';
  const paid = paymentsOf(runs); const items = owedItems(runs, tenant, '9999-12-31', name).filter((i) => i.agency === 'state');
  // (What the state collects with its income tax, California's SDI, on lines of its own.)
  const wh = (spec?.programs || []).filter((x) => x.paid === 'withholding');
  const month = (i: number) => { const mm = String((q - 1) * 3 + i + 1).padStart(2, '0'); return taxedRuns(runs).filter((r) => payDateOf(r, tenant).slice(0, 7) === `${year}-${mm}`); };
  const lines: FormLine[] = [0, 1, 2].map((i) => ({ line: MONTH[(q - 1) * 3 + i], label: `${name} income tax withheld`, amount: r2(month(i).reduce((s, r) => s + (Number(r.taxes.owed?.state) || 0), 0)) }));
  const progLines: FormLine[] = wh.map((pg) => ({ line: pg.short || pg.name, label: `${pg.name} withheld`, amount: r2([0, 1, 2].flatMap(month).reduce((s, r) => s + (r.taxes.owed?.other || []).filter((x: any) => String(x.id).replace(/_er$/, '') === pg.id).reduce((n: number, x: any) => n + (Number(x.amount) || 0), 0), 0)) }));
  // (The old payroll's part of the quarter, when it switched in it: withheld and paid by it. lib/payroll-prior.)
  const pr = priorOf(runs, year); const pp = priorQuarterPart(pr, year, q, tablesFor(year).t.ss.base);
  if (pp && pr && pp.state > 0) lines.unshift({ line: 'Earlier', label: `${name} income tax your old payroll withheld, through ${dayWords(pr.lastPayDate)}`, amount: pp.state });
  const total = r2(lines.reduce((s, l) => s + l.amount, 0));
  const keys = new Set([...taxedRuns(runs).filter((r) => inQuarter(payDateOf(r, tenant), year, q)).map((r) => String(r.periodKey)), ...(pp ? [`prior_${year}`] : [])]);
  const paidQ = r2(items.filter((i) => i.paydays.some((k) => keys.has(k))).reduce((s, i) => s + (paid[i.key]?.amount || 0), 0) + (pp?.stateDeposited || 0));
  return { lines: [...lines, { line: 'Quarter', label: 'Withheld in all', amount: total }, ...progLines,
    { line: 'Paid', label: `Paid with ${form}`, ...(pp && pp.stateDeposited > 0 ? { detail: `$${pp.stateDeposited.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of it paid by your old payroll` } : {}), amount: paidQ }], total, form, name };
}
/** North Carolina's NC-5 for the quarter (formStateWithholding, kept by its name). */
export const formNC5 = formStateWithholding;

/** The state's quarterly unemployment wage report (North Carolina's NCUI 101, California's DE 9C…): each person's wages
 *  this quarter, what's over the year's wage limit, what unemployment is on, and the contributions due. */
export function formStateWageReport(runs: any[], tenant: any, year: number, q: number) {
  const rows = peopleOf(runs, tenant, year, q); const by = new Map<string, { name: string; gross: number; taxable: number }>();
  for (const x of rows) { const cur = by.get(x.p.staffId) || { name: String(x.p.name || 'Team member'), gross: 0, taxable: 0 };
    cur.gross = r2(cur.gross + (Number(x.p.taxes.wages?.medicare) || 0)); cur.taxable = r2(cur.taxable + (Number(x.p.taxes.wages?.sui) || 0)); by.set(x.p.staffId, cur); }
  // (The old payroll's part of the quarter, when it switched in it: on the report too, at the business's rate, and over
  // the year's limit from what it paid before the quarter began. lib/payroll-prior.)
  const ps0 = priorSui(priorOf(runs, year), tenant); const ps = ps0 && ps0.year === year && ps0.q === q ? ps0 : null; const priorDue = ps?.due || 0;
  for (const x of ps?.rows || []) {
    const cur = by.get(x.staffId) || { name: x.name, gross: 0, taxable: 0 };
    cur.gross = r2(cur.gross + x.wages); cur.taxable = r2(cur.taxable + x.taxable); by.set(x.staffId, cur); }
  const people = [...by.values()].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ ...p, excess: r2(p.gross - p.taxable) }));
  const due = r2(rows.reduce((s, x) => s + (Number(x.p.taxes.employer?.sui) || 0), 0) + priorDue);
  const t = (k: 'gross' | 'taxable' | 'excess') => r2(people.reduce((s, p) => s + p[k], 0));
  return { people, totals: { gross: t('gross'), taxable: t('taxable'), excess: t('excess') }, due, form: stateSpec(payrollStateOf(tenant))?.sui.report || 'wage report',
    prior: ps ? { through: ps.through, due: priorDue, paid: ps.paid } : null };
}
export const formNCUI101 = formStateWageReport;

// ── Reminders ──
export type TaxReminder = { key: string; stage: 'soon' | 'today' | 'late'; title: string; body: string };
/** The reminders due today for payroll taxes not marked paid: three days before each is due, on the day, and the day
 *  after. Never for one still building up (its month or quarter isn't over) or federal unemployment carrying over.
 *  `sent`: the ones sent already ("{key}_{stage}"). */
export function remindersDue(items: OwedItem[], today: string, sent: Record<string, any> = {}): TaxReminder[] {
  const days = (d: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const out: TaxReminder[] = [];
  for (const i of items) {
    if (i.left < 0.01 || i.carries || i.open || !i.due) continue;
    const n = days(i.due); const stage = n === 0 ? 'today' : n > 0 && n <= 3 ? 'soon' : n < 0 && n >= -7 ? 'late' : null;
    const k = i.paid ? `${i.key}_rest` : i.key;
    if (!stage || sent[`${k}_${stage}`]) continue;
    const how = i.agency === 'irs' || i.agency === 'futa' ? 'Pay it through EFTPS.gov or your IRS business tax account' : i.agency === 'other' ? 'Pay it where you file it' : 'Pay it on your state’s website';
    out.push({ key: k, stage,
      title: stage === 'today' ? `${i.name}: due today` : stage === 'soon' ? `${i.name}: due ${dayWords(i.due)}` : `${i.name}: was due ${dayWords(i.due)}`,
      body: `${usd(i.left)}${i.paid ? ` still to pay, after ${usd(i.paid.amount)} paid` : ''}. ${how}, then mark it paid on Payday, or it’s marked when your bank shows the payment.` });
  }
  return out;
}
