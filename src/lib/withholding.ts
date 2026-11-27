// src/lib/withholding.ts — TAXES ON A PAYCHECK, worked out in ClarityFlow (when the business runs payroll here, not
// through Gusto or another payroll company: Settings > Payroll). For one employee and one payday: federal income tax
// from their W-4 (IRS Publication 15-T, the percentage method for automated payroll), Social Security and Medicare,
// state income tax (North Carolina's NC-30 built in, the states with no wage income tax known, any other state at a
// percentage the business sets), any other payroll tax the business adds, and the employer's own share: Social
// Security, Medicare, federal and state unemployment. Pure: the Payday screen and the server (lib/payday-record) both
// run it, from the same inputs, so the screen and the books always agree.
//
// Tables are by year. A year with no tables yet uses the latest and says so (`stale`): add the new year's figures here
// each January (Publication 15-T, the Social Security wage base, NC-30).
//
// Never needs or keeps a Social Security number: the business adds those when it files.

export type FilingStatus = 'single' | 'married' | 'hoh';
/** What the employee wrote on their W-4. 2020 and later: steps 1(c) to 4(c). 2019 or earlier: status and allowances. */
export type FederalForm = {
  form?: '2020' | 'pre2020';
  /** Single (or married filing separately), married filing jointly, head of household. A 2019-or-earlier "married, but
   *  withhold at the higher single rate" is single. */
  status?: FilingStatus;
  /** Step 2(c): two jobs, or a spouse who works. */
  multipleJobs?: boolean;
  /** Step 3: the credit for dependents, a year. */
  dependents?: number;
  /** Step 4(a): other income, a year. */
  otherIncome?: number;
  /** Step 4(b): deductions, a year. */
  deductions?: number;
  /** Step 4(c): extra withheld each paycheck. */
  extra?: number;
  /** "Exempt" written on the form: no federal income tax withheld (Social Security and Medicare still are). */
  exempt?: boolean;
  /** 2019 or earlier: the allowances claimed. */
  allowances?: number;
};
/** The state's own form (North Carolina's NC-4), or, for a state not built in, a percentage of wages. */
export type StateForm = { status?: FilingStatus; allowances?: number; extra?: number; exempt?: boolean; pct?: number };
/** Everything about one person's payroll taxes, kept with their pay (tenants/{t}/staffPay/{id}.taxForms). */
export type TaxForms = {
  federal?: FederalForm | null; state?: StateForm | null;
  /** Taken out before taxes, each paycheck: a retirement plan (401(k)-type: not before Social Security and Medicare) and
   *  health insurance through a cafeteria plan (section 125: before all of them). */
  pretax?: { retirement?: number; health?: number } | null;
  /** How they're paid, unless picked otherwise on payday. */
  payMethod?: PayMethod;
  updatedAt?: string;
};
export type PayMethod = 'transfer' | 'check' | 'cash';

/** Another payroll tax the business adds (a city or county tax, a state paid-leave program), at a rate of wages. */
export type OtherTax = { id: string; name: string; rate: number; who: 'employee' | 'employer'; wageBase?: number | null };
/** The business's payroll tax setup (tenant.payrollTax). */
export type PayrollTaxSetup = {
  /** Who runs payroll: ClarityFlow (taxes worked out here), Gusto, or another payroll company. */
  runBy?: 'clarityflow' | 'gusto' | 'company';
  /** How often the IRS deposits are made (the IRS's letter says which). */
  federalDeposits?: 'monthly' | 'semiweekly';
  /** How often state withholding is filed. */
  stateFiling?: 'monthly' | 'quarterly' | 'semiweekly';
  /** State unemployment: the business's own rate (%) and the wages it's on, each person, a year. */
  suiRate?: number | null; suiWageBase?: number | null;
  /** A state not built in: a percentage of wages for state income tax, unless a person has their own. */
  statePct?: number | null;
  other?: OtherTax[];
};

/** What's been taxed for this person so far this year (from the paydays already recorded). */
export type YearToDate = { ssWages: number; medicareWages: number; futaWages: number; suiWages: number; other?: Record<string, number> };
export const EMPTY_YTD: YearToDate = { ssWages: 0, medicareWages: 0, futaWages: 0, suiWages: 0, other: {} };

type Row = [number, number, number];   // at least, tentative amount, rate on the excess
type Year = {
  line1g: { married: number; other: number }; allowance: number;
  standard: Record<FilingStatus, Row[]>; checkbox: Record<FilingStatus, Row[]>;
  ss: { rate: number; base: number }; medicare: { rate: number; addl: number; over: number }; futa: { rate: number; base: number };
  nc: { rate: number; deduction: Record<FilingStatus, number>; allowance: number; suiBase: number; suiNew: number };
};

// 2026: Publication 15-T (2026), Worksheet 1A and the Annual Percentage Method Tables for automated payroll; Social
// Security wage base $184,500; NC-30 (2026): 3.99% plus 0.1%, standard deductions $12,750 (single and married) and
// $19,125 (head of household), $2,500 an allowance; North Carolina unemployment on the first $34,200, 1% for a new
// employer.
const Y2026: Year = {
  line1g: { married: 12900, other: 8600 }, allowance: 4300,
  standard: {
    married: [[0, 0, 0], [19300, 0, 0.10], [44100, 2480, 0.12], [120100, 11600, 0.22], [230700, 35932, 0.24], [422850, 82048, 0.32], [531750, 116896, 0.35], [788000, 206583.5, 0.37]],
    single: [[0, 0, 0], [7500, 0, 0.10], [19900, 1240, 0.12], [57900, 5800, 0.22], [113200, 17966, 0.24], [209275, 41024, 0.32], [263725, 58448, 0.35], [648100, 192979.25, 0.37]],
    hoh: [[0, 0, 0], [15550, 0, 0.10], [33250, 1770, 0.12], [83000, 7740, 0.22], [121250, 16155, 0.24], [217300, 39207, 0.32], [271750, 56631, 0.35], [656150, 191171, 0.37]],
  },
  checkbox: {
    married: [[0, 0, 0], [16100, 0, 0.10], [28500, 1240, 0.12], [66500, 5800, 0.22], [121800, 17966, 0.24], [217875, 41024, 0.32], [272325, 58448, 0.35], [400450, 103291.75, 0.37]],
    single: [[0, 0, 0], [8050, 0, 0.10], [14250, 620, 0.12], [33250, 2900, 0.22], [60900, 8983, 0.24], [108938, 20512, 0.32], [136163, 29224, 0.35], [328350, 96489.63, 0.37]],
    hoh: [[0, 0, 0], [12075, 0, 0.10], [20925, 885, 0.12], [45800, 3870, 0.22], [64925, 8077.5, 0.24], [112950, 19603.5, 0.32], [140175, 28315.5, 0.35], [332375, 95585.5, 0.37]],
  },
  ss: { rate: 0.062, base: 184500 }, medicare: { rate: 0.0145, addl: 0.009, over: 200000 }, futa: { rate: 0.006, base: 7000 },
  nc: { rate: 0.0409, deduction: { single: 12750, married: 12750, hoh: 19125 }, allowance: 2500, suiBase: 34200, suiNew: 1 },
};
const YEARS: Record<number, Year> = { 2026: Y2026 };
const LATEST = Math.max(...Object.keys(YEARS).map(Number));
export const TABLES_YEAR = LATEST;
export const tablesFor = (year: number) => ({ t: YEARS[year] || YEARS[LATEST], stale: !YEARS[year] });

/** States with no income tax on wages. */
export const NO_WAGE_TAX = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY'];
/** States whose own withholding is worked out here (the rest: a percentage the business sets). */
export const BUILT_IN_STATES = ['NC'];
export type StateHow = 'none' | 'built_in' | 'percent' | 'missing';
export const stateHow = (state: string | null | undefined, setup?: PayrollTaxSetup | null, form?: StateForm | null): StateHow => {
  const s = String(state || '').toUpperCase();
  if (NO_WAGE_TAX.includes(s)) return 'none';
  if (BUILT_IN_STATES.includes(s)) return 'built_in';
  return (num(form?.pct) > 0 || num(setup?.statePct) > 0) ? 'percent' : 'missing';
};
/** State unemployment for these wages: the business's own rate, else the state's new-employer rate when it's built in. */
export function suiOf(state: string | null | undefined, setup: PayrollTaxSetup | null | undefined, year: number): { rate: number; base: number | null } {
  const { t } = tablesFor(year); const s = String(state || '').toUpperCase();
  const rate = setup?.suiRate != null && Number.isFinite(Number(setup.suiRate)) ? Math.max(0, Math.min(20, Number(setup.suiRate))) : s === 'NC' ? t.nc.suiNew : 0;
  const base = setup?.suiWageBase != null && Number(setup.suiWageBase) > 0 ? Number(setup.suiWageBase) : s === 'NC' ? t.nc.suiBase : null;
  return { rate, base };
}

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pos = (v: any) => Math.max(0, num(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const rowFor = (rows: Row[], wage: number) => { let r = rows[0]; for (const x of rows) if (wage >= x[0]) r = x; return r; };
const status = (s: any): FilingStatus => (s === 'married' || s === 'hoh' ? s : 'single');
/** Up to what's left of a yearly limit. */
const under = (amount: number, soFar: number, limit: number | null | undefined) => (limit == null ? amount : Math.max(0, Math.min(amount, limit - soFar)));

/** Federal income tax for one paycheck (Worksheet 1A). */
export function federalIncomeTax(wages: number, periods: number, f: FederalForm | null | undefined, year: number): number {
  if (!(wages > 0) || f?.exempt) return 0;
  const { t } = tablesFor(year); const st = status(f?.status); const annual = wages * periods;
  let adjusted: number; let rows: Row[];
  if (f?.form === 'pre2020') { adjusted = annual - Math.max(0, Math.floor(num(f.allowances))) * t.allowance; rows = t.standard[st]; }
  else {
    adjusted = annual + pos(f?.otherIncome) - (pos(f?.deductions) + (f?.multipleJobs ? 0 : st === 'married' ? t.line1g.married : t.line1g.other));
    rows = (f?.multipleJobs ? t.checkbox : t.standard)[st];
  }
  adjusted = Math.max(0, adjusted);
  const [at, base, rate] = rowFor(rows, adjusted);
  const perPeriod = (base + (adjusted - at) * rate) / periods;
  const afterCredits = f?.form === 'pre2020' ? perPeriod : Math.max(0, perPeriod - pos(f?.dependents) / periods);
  return r2(Math.max(0, afterCredits) + pos(f?.extra));
}

/** State income tax for one paycheck. */
export function stateIncomeTax(wages: number, periods: number, state: string | null | undefined, s: StateForm | null | undefined, setup: PayrollTaxSetup | null | undefined, year: number): number {
  if (!(wages > 0) || s?.exempt) return 0;
  const code = String(state || '').toUpperCase(); const { t } = tablesFor(year);
  if (NO_WAGE_TAX.includes(code)) return 0;
  if (code === 'NC') {
    // NC-30, the annualized method: rounded to the whole dollar.
    const net = Math.max(0, wages * periods - t.nc.deduction[status(s?.status)] - Math.max(0, Math.floor(num(s?.allowances))) * t.nc.allowance);
    return Math.round((net * t.nc.rate) / periods) + Math.round(pos(s?.extra));
  }
  const pct = num(s?.pct) > 0 ? num(s?.pct) : num(setup?.statePct);
  return pct > 0 ? r2(wages * Math.min(pct, 20) / 100 + pos(s?.extra)) : 0;
}

/** Another payroll tax on one paycheck: the wages it's on (toward its yearly limit) and the amount. */
export type OtherAmount = { id: string; name: string; amount: number; wages: number };
export type Withholding = {
  /** Everything earned this payday (tips included, cash tips already taken home included). */
  gross: number;
  /** The part of it already in their hands (cash tips taken home): taxed, but not in the paycheck. */
  inHand: number;
  pretax: { retirement: number; health: number };
  /** Wages each tax is on. */
  /** additionalMedicare: the wages this paycheck that are over the year's $200,000, the extra 0.9% Medicare is on. */
  wages: { federal: number; socialSecurity: number; medicare: number; additionalMedicare: number; state: number; futa: number; sui: number };
  employee: { federal: number; socialSecurity: number; medicare: number; additionalMedicare: number; state: number; other: OtherAmount[] };
  employeeTotal: number;
  employer: { socialSecurity: number; medicare: number; futa: number; sui: number; other: OtherAmount[] };
  employerTotal: number;
  /** What couldn't be taken out because the paycheck was too small (cash tips taken home, mostly). */
  short: { socialSecurity: number; medicare: number; federal: number; state: number };
  /** In the paycheck before taxes, and what they take home. */
  check: number; takeHome: number;
  /** How the state's tax was worked out, and what the screen should say. */
  stateHow: StateHow;
  flags: ('no_w4' | 'no_state_form' | 'exempt' | 'short' | 'stale_tables' | 'state_missing')[];
};

export type WithholdingInput = {
  year: number; periods: number; gross: number; inHand?: number;
  forms?: TaxForms | null; state?: string | null; setup?: PayrollTaxSetup | null; ytd?: YearToDate | null;
};

/** Every tax on one paycheck, and the take-home. */
export function withholdingFor(i: WithholdingInput): Withholding {
  const { t, stale } = tablesFor(i.year); const ytd = i.ytd || EMPTY_YTD; const forms = i.forms || {};
  const periods = [12, 24, 26, 52].includes(i.periods) ? i.periods : 26;
  const gross = r2(pos(i.gross)); const inHand = r2(Math.min(gross, pos(i.inHand)));
  // (Before taxes come out of what's in the paycheck, never more than it.)
  let room = r2(gross - inHand);
  const health = r2(Math.min(pos(forms.pretax?.health), room)); room = r2(room - health);
  const retirement = r2(Math.min(pos(forms.pretax?.retirement), room)); room = r2(room - retirement);
  const federalWages = r2(Math.max(0, gross - health - retirement)); const ficaWages = r2(Math.max(0, gross - health));
  const ssWages = r2(under(ficaWages, ytd.ssWages, t.ss.base));
  const futaWages = r2(under(ficaWages, ytd.futaWages, t.futa.base));
  const sui = suiOf(i.state, i.setup, i.year); const suiWages = r2(under(ficaWages, ytd.suiWages, sui.base));
  const addlWages = r2(Math.max(0, ytd.medicareWages + ficaWages - Math.max(t.medicare.over, ytd.medicareWages)));
  const want = {
    socialSecurity: r2(ssWages * t.ss.rate), medicare: r2(ficaWages * t.medicare.rate),
    additionalMedicare: r2(addlWages * t.medicare.addl),
    federal: federalIncomeTax(federalWages, periods, forms.federal, i.year),
    state: stateIncomeTax(federalWages, periods, i.state, forms.state, i.setup, i.year),
  };
  const otherEmp: OtherAmount[] = []; const otherEr: OtherAmount[] = [];
  for (const o of (i.setup?.other || []).slice(0, 8)) {
    const rate = Math.max(0, Math.min(20, num(o.rate))); if (!o.id || !rate) continue;
    const w = r2(under(ficaWages, num(ytd.other?.[o.id]), o.wageBase && o.wageBase > 0 ? o.wageBase : null));
    const amount = r2(w * rate / 100);
    const item = { id: String(o.id).slice(0, 40), name: String(o.name || 'Payroll tax').slice(0, 60), amount, wages: w };
    (o.who === 'employer' ? otherEr : otherEmp).push(item);
  }
  // (When the paycheck can't cover them all, the IRS's order: Social Security and Medicare first, then income tax.)
  const take = (n: number) => { const x = r2(Math.min(n, room)); room = r2(room - x); return x; };
  const ss = take(want.socialSecurity), med = take(want.medicare), addl = take(want.additionalMedicare), fed = take(want.federal), st = take(want.state);
  const other = otherEmp.map((o) => ({ ...o, amount: take(o.amount) }));
  const employee = { federal: fed, socialSecurity: ss, medicare: med, additionalMedicare: addl, state: st, other };
  const employeeTotal = r2(fed + ss + med + addl + st + other.reduce((n, o) => n + o.amount, 0));
  const employer = { socialSecurity: want.socialSecurity, medicare: want.medicare, futa: r2(futaWages * t.futa.rate), sui: r2(suiWages * sui.rate / 100), other: otherEr };
  const employerTotal = r2(employer.socialSecurity + employer.medicare + employer.futa + employer.sui + otherEr.reduce((n, o) => n + o.amount, 0));
  const short = { socialSecurity: r2(want.socialSecurity - ss), medicare: r2(want.medicare + want.additionalMedicare - med - addl), federal: r2(want.federal - fed), state: r2(want.state - st) };
  const how = stateHow(i.state, i.setup, forms.state);
  const flags: Withholding['flags'] = [];
  if (!forms.federal) flags.push('no_w4');
  if (how === 'built_in' && !forms.state) flags.push('no_state_form');
  if (forms.federal?.exempt) flags.push('exempt');
  if (short.socialSecurity + short.medicare + short.federal + short.state > 0) flags.push('short');
  if (stale) flags.push('stale_tables');
  if (how === 'missing') flags.push('state_missing');
  const check = r2(gross - inHand - health - retirement);
  return {
    gross, inHand, pretax: { retirement, health },
    wages: { federal: federalWages, socialSecurity: ssWages, medicare: ficaWages, additionalMedicare: addlWages, state: how === 'none' ? 0 : federalWages, futa: futaWages, sui: suiWages },
    employee, employeeTotal, employer, employerTotal, short, check, takeHome: r2(check - employeeTotal), stateHow: how, flags,
  };
}

/** What a payday owes, and to whom: the IRS (income tax withheld, both shares of Social Security and Medicare), the
 *  state (income tax withheld), state unemployment, federal unemployment, and any other tax the business added. */
export type Owed = { irs: number; state: number; sui: number; futa: number; other: { id: string; name: string; amount: number }[]; total: number };
export function owedOf(list: Withholding[]): Owed {
  const sum = (f: (w: Withholding) => number) => r2(list.reduce((n, w) => n + f(w), 0));
  const irs = sum((w) => w.employee.federal + w.employee.socialSecurity + w.employee.medicare + w.employee.additionalMedicare + w.employer.socialSecurity + w.employer.medicare);
  const by = new Map<string, { id: string; name: string; amount: number }>();
  for (const w of list) for (const o of [...w.employee.other, ...w.employer.other]) { const x = by.get(o.id) || { id: o.id, name: o.name, amount: 0 }; x.amount = r2(x.amount + o.amount); by.set(o.id, x); }
  const other = [...by.values()].filter((o) => o.amount > 0);
  const state = sum((w) => w.employee.state), sui = sum((w) => w.employer.sui), futa = sum((w) => w.employer.futa);
  return { irs, state, sui, futa, other, total: r2(irs + state + sui + futa + other.reduce((n, o) => n + o.amount, 0)) };
}

/** One paycheck's withholding, kept with the payday (payrollRuns) and the pay stub: the numbers, nothing else. */
export const keepOf = (w: Withholding) => ({ gross: w.gross, inHand: w.inHand, pretax: w.pretax, wages: w.wages, employee: w.employee, employeeTotal: w.employeeTotal,
  employer: w.employer, employerTotal: w.employerTotal, short: w.short, check: w.check, takeHome: w.takeHome, stateHow: w.stateHow, flags: w.flags });

/** A person's forms as typed on the tax forms dialog, checked: numbers in range, nothing else kept. */
export function cleanTaxForms(v: any): TaxForms {
  const money = (x: any, hi: number) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.round(n * 100) / 100) : 0; };
  const out: TaxForms = {};
  if (v?.federal) {
    const f = v.federal; const form = f.form === 'pre2020' ? 'pre2020' : '2020';
    out.federal = form === 'pre2020'
      ? { form, status: status(f.status), allowances: Math.max(0, Math.min(99, Math.floor(Number(f.allowances) || 0))), extra: money(f.extra, 10000), exempt: f.exempt === true }
      : { form, status: status(f.status), multipleJobs: f.multipleJobs === true, dependents: money(f.dependents, 100000), otherIncome: money(f.otherIncome, 10000000), deductions: money(f.deductions, 10000000), extra: money(f.extra, 10000), exempt: f.exempt === true };
  }
  if (v?.state) {
    const s = v.state; const pct = Number(s.pct);
    out.state = { status: status(s.status), allowances: Math.max(0, Math.min(99, Math.floor(Number(s.allowances) || 0))), extra: money(s.extra, 10000), exempt: s.exempt === true, ...(Number.isFinite(pct) && pct > 0 ? { pct: Math.min(20, Math.round(pct * 1000) / 1000) } : {}) };
  }
  const retirement = money(v?.pretax?.retirement, 100000), health = money(v?.pretax?.health, 100000);
  if (retirement || health) out.pretax = { retirement, health };
  if (['transfer', 'check', 'cash'].includes(v?.payMethod)) out.payMethod = v.payMethod;
  return out;
}
