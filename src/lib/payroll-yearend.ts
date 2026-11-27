// src/lib/payroll-yearend.ts — THE YEAR'S PAYROLL FORMS (Money › Payday › Payroll taxes › Year-end forms; design board
// "Year end", option A). From the year's paydays recorded in ClarityFlow, and pay from before ClarityFlow
// (lib/payroll-prior): each employee's W-2, box by box; the W-3 that sends them to Social Security; Form 940, federal
// unemployment for the year; the state's own year-end reconciliation (North Carolina's NC-3, California's DE 9…, by
// lib/state-payroll filing.annual); and a 1099-NEC for each contractor paid $2,000 or more ($600 before 2026). For
// printing, copying onto the forms, or handing to an accountant. From 2026 a W-2 also says each person's tips (box 12
// code TP, cash and card, with the occupation they were received in, box 14b: lib/tipped-occupations) and the overtime
// the federal law requires (code TT, the "half" of time and a half: lib/pay-period), for the new tax deductions on them. Social Security numbers, the EIN and contractors' tax
// ID numbers go on the forms themselves: ClarityFlow never keeps them.
import { payDateOf, payrollStateOf, setupOf, nextBusinessDay, CREDIT_REDUCTION } from './payroll-taxes';
import { stateSpec } from './state-payroll';
import { tablesFor } from './withholding';
import { priorOf } from './payroll-prior';
import { owedItems, paymentsOf } from './payroll-owed';
import { ttocsOf } from './tipped-occupations';
/** The first year the W-2 has codes TP and TT and box 14b. */
export const TIPS_OT_FROM = 2026;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const n = (v: any) => Number(v) || 0;
/** W-2s, the W-3, 1099-NECs and most states' reconciliations: January 31, or the next business day. */
export const yearEndDue = (year: number) => nextBusinessDay(`${year + 1}-01-31`);
/** A contractor's 1099-NEC: $2,000 or more paid in the year from 2026, $600 before. */
export const necThreshold = (year: number) => (year >= 2026 ? 2000 : 600);

/** The year's paydays recorded with taxes worked out here (regular and between paydays). */
const yearRuns = (runs: any[], tenant: any, year: number) => (runs || []).filter((r) => r?.kind === 'payday' && r.runBy === 'clarityflow' && payDateOf(r, tenant).slice(0, 4) === String(year));

export type W2 = {
  staffId: string; name: string; paydays: number;
  b1: number; b2: number; b3: number; b4: number; b5: number; b6: number; b7: number;
  /** Box 12: A and B, Social Security and Medicare on tips that couldn't be withheld; D, retirement taken before taxes. */
  b12: { code: string; label: string; amount: number }[];
  /** Box 13, retirement plan. */
  b13: boolean;
  /** Box 14 (14a from 2026), other: the state's programs taken from pay (California's SDI, New Jersey's family leave…). */
  b14: { label: string; amount: number }[];
  /** Box 14b from 2026: the occupation code the tips in code TP were received in, when there are any (empty: not picked
   *  yet, and the business's kind doesn't suggest one). */
  b14b: string[];
  /** Paydays this year recorded before each person's overtime was kept (not pay between paydays): code TT leaves out any
   *  overtime in them until it's worked out again from the time clock (api/payroll/forms 'otBackfill'). */
  otNotKept: number;
  /** The part of code TT from weeks a commissioned person may be exempt from federal overtime (section 7(i)). */
  ttMaybeExempt: number;
  /** Paydays whose overtime, worked out again later from the time clock, came out at different pay than was recorded (a
   *  rate change or an edit since): no TT from them, for the accountant to check. */
  otUnsure: number;
  /** Boxes 15 to 17. */
  state: { code: string; name: string; wages: number; tax: number } | null;
  /** Boxes 18 to 20: the city's or county's part (`withState`: paid with the state's), and taxes the business added. */
  locals: { name: string; wages: number; tax: number; withState?: boolean }[];
  /** It includes pay from before ClarityFlow: its box 12 and 14 amounts are on the old payroll's report. */
  prior: boolean;
};

/** Each employee's W-2 for the year, sorted by name. */
export function w2sFor(runs: any[], tenant: any, year: number): W2[] {
  const code = payrollStateOf(tenant); const spec = stateSpec(code); const ssBase = tablesFor(year).t.ss.base;
  const progs = new Map((spec?.programs || []).map((p) => [p.id, p]));
  const added = new Map((setupOf(tenant).other || []).map((o: any) => [String(o?.id || ''), String(o?.name || 'City tax')]));
  const by = new Map<string, W2 & { _12: Record<string, number>; _14: Record<string, number>; _loc: Record<string, { wages: number; tax: number; withState?: boolean }>; _stW: number; _stT: number }>();
  const get = (id: string, name: string) => { let w = by.get(id);
    if (!w) { w = { staffId: id, name, paydays: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0, b7: 0, b12: [], b13: false, b14: [], b14b: [], otNotKept: 0, ttMaybeExempt: 0, otUnsure: 0, state: null, locals: [], prior: false, _12: {}, _14: {}, _loc: {}, _stW: 0, _stT: 0 }; by.set(id, w); }
    return w; };
  for (const run of yearRuns(runs, tenant, year)) for (const p of run.people || []) {
    const t = p?.taxes; if (!p?.staffId || p.contractor || !t) continue;
    const w = get(String(p.staffId), String(p.name || 'Team member')); w.paydays++;
    const wg = t.wages || {}, e = t.employee || {}, sh = t.short || {};
    const ss = n(wg.socialSecurity); const tips = Math.min(n(p.tips), ss);
    w.b1 += n(wg.federal); w.b2 += n(e.federal); w.b3 += ss - tips; w.b7 += tips; w.b4 += n(e.socialSecurity); w.b5 += n(wg.medicare); w.b6 += n(e.medicare) + n(e.additionalMedicare);
    // (Codes A and B are for tips only: what couldn't be withheld on cash tips taken home, never more than their share.)
    const inHand = n(t.inHand);
    if (inHand > 0 && n(sh.socialSecurity)) w._12.A = (w._12.A || 0) + Math.min(n(sh.socialSecurity), r2(Math.min(inHand, ss) * 0.062));
    if (inHand > 0 && n(sh.medicare)) w._12.B = (w._12.B || 0) + Math.min(n(sh.medicare), r2(inHand * 0.0145));
    if (n(t.pretax?.retirement)) w._12.D = (w._12.D || 0) + n(t.pretax.retirement);
    // (From 2026: every tip reported, cash and card, and the overtime the law requires, kept on paydays from December 2026.)
    if (year >= TIPS_OT_FROM) { if (n(p.tips) > 0) w._12.TP = (w._12.TP || 0) + n(p.tips); if (n(p.otQualified) > 0) w._12.TT = (w._12.TT || 0) + n(p.otQualified); w.ttMaybeExempt += n(p.otMaybeExempt); if (!run.otKept && !run.offCycle) w.otNotKept++; if (Array.isArray(run.otUnsure) && run.otUnsure.includes(String(p.staffId))) w.otUnsure++; }
    const local = n(e.stateLocal);
    if (t.stateHow !== 'none') { w._stW += n(wg.state ?? wg.federal); w._stT += n(e.state) - local; }
    if (local > 0) { const k = String(e.localName || 'Local'); const l = w._loc[k] || { wages: 0, tax: 0, withState: true }; l.wages += n(wg.state ?? wg.federal); l.tax += local; w._loc[k] = l; }
    for (const o of e.other || []) {
      const pg = progs.get(String(o?.id || ''));
      if (pg) { const k = pg.short || pg.name; w._14[k] = (w._14[k] || 0) + n(o.amount); }
      else if (added.has(String(o?.id || ''))) { const k = added.get(String(o.id))!; const l = w._loc[k] || { wages: 0, tax: 0 }; l.wages += n(o.wages); l.tax += n(o.amount); w._loc[k] = l; }
    }
  }
  // (Pay from before ClarityFlow this year: its wages and each tax withheld.)
  const pr = priorOf(runs, year);
  for (const x of pr?.people || []) {
    const w = get(String(x.staffId), String(x.name || 'Team member')); w.prior = true;
    const fed = n(x.fedWages ?? x.wages); const ssW = Math.min(n(x.wages), ssBase); const tips = Math.min(n(x.tips), ssW);
    w.b1 += fed; w.b2 += n(x.federal); w.b3 += ssW - tips; w.b7 += tips; w.b4 += n(x.ss); w.b5 += n(x.wages); w.b6 += n(x.medicare);
    if (year >= TIPS_OT_FROM && n(x.tips) > 0) w._12.TP = (w._12.TP || 0) + n(x.tips);
    if (spec && !spec.noTax) { w._stW += fed; w._stT += n(x.state); }
  }
  const LABEL: Record<string, string> = { A: 'Social Security on tips that couldn’t be withheld', B: 'Medicare on tips that couldn’t be withheld', D: 'Retirement taken out before taxes (401(k); your plan’s own code if it’s another kind)',
    TP: 'Tips reported to you, cash and card', TT: 'Overtime the law requires: the half of time and a half, for hours past 40 a week' };
  return [...by.values()].map(({ _12, _14, _loc, _stW, _stT, ...w }) => ({
    ...w, b1: r2(w.b1), b2: r2(w.b2), b3: r2(w.b3), b4: r2(w.b4), b5: r2(w.b5), b6: r2(w.b6), b7: r2(w.b7),
    b12: Object.entries(_12).filter(([, v]) => v > 0).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ code: k, label: LABEL[k], amount: r2(v) })),
    b13: (_12.D || 0) > 0,
    b14: Object.entries(_14).filter(([, v]) => v > 0).map(([k, v]) => ({ label: k, amount: r2(v) })),
    b14b: (_12.TP || 0) > 0 ? ttocsOf(tenant, w.staffId) : [],
    otNotKept: year >= TIPS_OT_FROM ? w.otNotKept : 0, ttMaybeExempt: r2(w.ttMaybeExempt), otUnsure: year >= TIPS_OT_FROM ? w.otUnsure : 0,
    state: spec && !spec.noTax && (_stW > 0 || _stT > 0) ? { code: spec.code, name: spec.name, wages: r2(_stW), tax: r2(_stT) } : null,
    locals: Object.entries(_loc).map(([k, v]) => ({ name: k, wages: r2(v.wages), tax: r2(v.tax), ...(v.withState ? { withState: true } : {}) })),
  })).filter((w) => w.b1 > 0 || w.b5 > 0 || w.b2 > 0).sort((a, b) => a.name.localeCompare(b.name));
}

/** The W-3: the W-2s' totals, sent with them to Social Security. */
export function w3For(w2s: W2[]) {
  const s = (f: (w: W2) => number) => r2(w2s.reduce((t, w) => t + f(w), 0));
  return { count: w2s.length, b1: s((w) => w.b1), b2: s((w) => w.b2), b3: s((w) => w.b3), b4: s((w) => w.b4), b5: s((w) => w.b5), b6: s((w) => w.b6), b7: s((w) => w.b7),
    /** Box 12a: retirement taken out before taxes, all codes D and the like. */
    b12a: s((w) => w.b12.filter((x) => x.code === 'D').reduce((t, x) => t + x.amount, 0)),
    state: w2s.some((w) => w.state) ? { wages: s((w) => w.state?.wages || 0), tax: s((w) => w.state?.tax || 0) } : null,
    local: w2s.some((w) => w.locals.length) ? { wages: s((w) => w.locals.reduce((t, l) => t + l.wages, 0)), tax: s((w) => w.locals.reduce((t, l) => t + l.tax, 0)) } : null };
}

export type FormLine = { line: string; label: string; detail?: string; amount: number; count?: boolean };
const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Form 940 for the year: everything paid to employees, what's over each person's $7,000, federal unemployment on the
 *  rest at 0.6% (and a credit reduction state's Schedule A), what's been paid, and, over $500, what was owed each quarter. */
export function form940(runs: any[], tenant: any, year: number): { lines: FormLine[]; total: number; due: string } {
  const code = payrollStateOf(tenant) || '';
  const per = new Map<string, { pay: number; exempt: number; byQ: number[] }>();
  const at = (id: string) => { let x = per.get(id); if (!x) { x = { pay: 0, exempt: 0, byQ: [0, 0, 0, 0] }; per.set(id, x); } return x; };
  const qOf = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3);
  // (Paid each quarter, in order, so the $7,000 falls where it was reached.)
  const rows: { id: string; d: string; pay: number; exempt: number }[] = [];
  for (const run of yearRuns(runs, tenant, year)) for (const p of run.people || []) {
    if (!p?.staffId || p.contractor || !p.taxes) continue;
    rows.push({ id: String(p.staffId), d: payDateOf(run, tenant), pay: n(p.taxes.gross), exempt: Math.min(n(p.taxes.gross), n(p.taxes.pretax?.health)) });
  }
  const pr = priorOf(runs, year);
  // (Pay from before ClarityFlow: what came before its last quarter in January to March, the rest in its last quarter.)
  for (const x of pr?.people || []) { const before = Math.max(0, n(x.wages) - n(x.q?.wages)); const last = String(pr!.lastPayDate);
    if (before > 0) rows.push({ id: String(x.staffId), d: `${year}-01-01`, pay: before, exempt: 0 });
    if (n(x.q?.wages) > 0) rows.push({ id: String(x.staffId), d: last, pay: n(x.q.wages), exempt: 0 }); }
  rows.sort((a, b) => a.d.localeCompare(b.d));
  const base = tablesFor(year).t.futa.base; const rate = tablesFor(year).t.futa.rate;
  for (const r of rows) { const x = at(r.id); const taxableBefore = Math.max(0, Math.min(base, x.pay - x.exempt));
    x.pay += r.pay; x.exempt += r.exempt; const taxableNow = Math.max(0, Math.min(base, x.pay - x.exempt)); x.byQ[qOf(r.d)] += taxableNow - taxableBefore; }
  const people = [...per.values()];
  const l3 = r2(people.reduce((t, x) => t + x.pay, 0)); const l4 = r2(people.reduce((t, x) => t + x.exempt, 0));
  const l5 = r2(people.reduce((t, x) => t + Math.max(0, x.pay - x.exempt - base), 0)); const l6 = r2(l4 + l5); const l7 = r2(l3 - l6);
  const l8 = r2(l7 * rate);
  const cr = CREDIT_REDUCTION[year]?.[code] || 0; const l11 = r2(l7 * cr / 100);
  const l12 = r2(l8 + l11);
  // (Paid: federal unemployment marked paid for the year's quarters, the credit reduction's, and the old payroll's.)
  const paid = paymentsOf(runs);
  const l13 = r2(Object.values(paid).filter((p) => new RegExp(`^futa_(cr_)?${year}`).test(p.key)).reduce((t, p) => t + p.amount, 0) + n(pr?.futaPaid));
  const qTaxable = [0, 1, 2, 3].map((q) => r2(people.reduce((t, x) => t + x.byQ[q], 0)));
  const qLiab = qTaxable.map((v, q) => r2(v * rate + (q === 3 ? l11 : 0)));
  const lines: FormLine[] = [
    { line: '1a', label: 'State you paid unemployment in', detail: code || 'Pick your state in Settings', amount: 0, count: true },
    { line: '3', label: 'Everything paid to employees', detail: 'Wages and tips, before anything was taken out', amount: l3 },
    { line: '4', label: 'Pay exempt from it', detail: l4 ? 'Health coverage taken out before taxes (check 4a, fringe benefits)' : undefined, amount: l4 },
    { line: '5', label: 'Pay over each person’s $7,000', amount: l5 },
    { line: '6', label: 'Line 4 and line 5', amount: l6 },
    { line: '7', label: 'Pay federal unemployment is on', amount: l7 },
    { line: '8', label: 'Federal unemployment', detail: `${money(l7)} × 0.6%`, amount: l8 },
    ...(l11 ? [{ line: '11', label: 'Credit reduction (Schedule A)', detail: `${money(l7)} × ${cr}%: ${stateSpec(code)?.name || code} hasn’t repaid its federal loans`, amount: l11 }] : []),
    { line: '12', label: 'Federal unemployment for the year', amount: l12 },
    { line: '13', label: 'Paid for the year', ...(n(pr?.futaPaid) ? { detail: `${money(n(pr!.futaPaid))} of it by your old payroll` } : {}), amount: l13 },
    { line: l12 >= l13 ? '14' : '15', label: l12 >= l13 ? 'Still to pay' : 'Paid more than owed', amount: r2(Math.abs(l12 - l13)) },
    ...(l12 > 500 ? qLiab.map((v, q) => ({ line: `16${'abcd'[q]}`, label: `Owed for ${['January to March', 'April to June', 'July to September', 'October to December'][q]}`, ...(q === 0 && pr ? { detail: 'Your old payroll’s part is in its quarters: check them against its reports' } : {}), amount: v }))
      : []),
  ];
  return { lines, total: l12, due: yearEndDue(year) };
}

/** The state's year-end reconciliation (spec.filing.annual): the W-2s, what they withheld, and what was paid. */
export function stateAnnual(runs: any[], tenant: any, year: number, w2s: W2[]): { form: string; due: string; lines: FormLine[] } | null {
  const spec = stateSpec(payrollStateOf(tenant)); if (!spec || spec.noTax || !spec.filing?.annual) return null;
  const withState = w2s.filter((w) => w.state); const local = r2(w2s.reduce((t, w) => t + w.locals.filter((l) => l.withState).reduce((s, l) => s + l.tax, 0), 0));
  const withheld = r2(withState.reduce((t, w) => t + (w.state?.tax || 0), 0) + local);
  // (Paid: state income tax marked paid for the year's paydays, and what the old payroll paid.)
  const paid = paymentsOf(runs); const keys = new Set(yearRuns(runs, tenant, year).map((r) => String(r.periodKey)));
  const items = owedItems(runs, tenant, '9999-12-31', spec.name).filter((i) => i.agency === 'state' && i.paydays.some((k) => keys.has(k) || k === `prior_${year}`));
  const pr = priorOf(runs, year);
  const priorPaid = pr ? r2((pr.people || []).reduce((t, x) => t + n(x.state), 0) - (pr.deposits?.state != null && !pr.oldFiles ? Math.max(0, (pr.people || []).reduce((t, x) => t + n(x.q?.state), 0) - n(pr.deposits.state)) : 0)) : 0;
  const paidYear = r2(items.reduce((t, i) => t + (paid[i.key]?.amount || 0), 0) + priorPaid);
  const [mm, dd] = String(spec.filing.annualDue || '01-31').split('-');
  return { form: spec.filing.annual, due: nextBusinessDay(`${year + 1}-${mm}-${dd}`), lines: [
    { line: 'W-2s', label: `W-2s with ${spec.name} wages`, amount: withState.length, count: true },
    { line: 'Wages', label: `${spec.name} wages on them`, amount: r2(withState.reduce((t, w) => t + (w.state?.wages || 0), 0)) },
    { line: 'Withheld', label: `${spec.name} income tax withheld`, ...(local ? { detail: `With ${money(local)} of city or county tax collected with it` } : {}), amount: withheld },
    { line: 'Paid', label: 'Paid for the year', ...(priorPaid ? { detail: `${money(priorPaid)} of it by your old payroll` } : {}), amount: paidYear },
    { line: withheld >= paidYear ? 'Due' : 'Over', label: withheld >= paidYear ? 'Still to pay' : 'Paid more than withheld', amount: r2(Math.abs(withheld - paidYear)) },
  ] };
}

export type Nec = { staffId: string; name: string; amount: number; due: boolean };
/** Each contractor paid through Payday in the year, and whether a 1099-NEC is due. */
export function form1099s(runs: any[], tenant: any, year: number): Nec[] {
  const by = new Map<string, Nec>();
  for (const run of (runs || []).filter((r) => r?.kind === 'payday' && payDateOf(r, tenant).slice(0, 4) === String(year))) for (const p of run.people || []) {
    if (!p?.staffId || !p.contractor) continue;
    const x = by.get(String(p.staffId)) || { staffId: String(p.staffId), name: String(p.name || 'Contractor'), amount: 0, due: false };
    x.amount = r2(x.amount + Math.max(0, n(p.paid)) + n(p.cashTips)); by.set(x.staffId, x);
  }
  return [...by.values()].map((x) => ({ ...x, due: x.amount >= necThreshold(year) })).sort((a, b) => b.amount - a.amount);
}
