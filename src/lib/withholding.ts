// src/lib/withholding.ts — TAXES ON A PAYCHECK, worked out in ClarityFlow (when the business runs payroll here, not
// through Gusto or another payroll company: Settings > Payroll). For one employee and one payday: federal income tax
// from their W-4 (IRS Publication 15-T, the percentage method for automated payroll), Social Security and Medicare,
// state income tax (every state's own 2026 formula, from the person's state form: lib/state-payroll), the state's
// disability and paid leave programs and any other payroll tax the business adds, and the employer's own share: Social
// Security, Medicare, federal and state unemployment. Pure: the Payday screen and the server (lib/payday-record) both
// run it, from the same inputs, so the screen and the books always agree.
//
// Tables are by year. A year with no tables yet uses the latest and says so (`stale`): add the new year's figures here
// each January (Publication 15-T, the Social Security wage base; each state's in lib/state-payroll).
//
// Never needs or keeps a Social Security number: the business adds those when it files.

import { STATES, STATE_LIST, stateSpec, stateTaxFor, programAmounts, supplementalStateTax, type StateFormIn } from './state-payroll';

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
/** What the person wrote on their state's own form (California's DE 4, New York's IT-2104…): lib/state-payroll. */
export type StateForm = StateFormIn;
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
  stateFiling?: 'monthly' | 'quarterly' | 'semiweekly' | 'semimonthly' | 'annually';
  /** State unemployment: the business's own rate (%) and the wages it's on, each person, a year. */
  suiRate?: number | null; suiWageBase?: number | null;
  /** A state not built in: a percentage of wages for state income tax, unless a person has their own. */
  statePct?: number | null;
  other?: OtherTax[];
  /** The state's own programs (paid leave, disability insurance: lib/state-payroll), as the business pays them: one
   *  turned off (not covered, or a size that's exempt), or a rate of its own (the employee's part, the business's). */
  programs?: Record<string, { off?: boolean; employee?: number | null; employer?: number | null }>;
  /** The day of the month state withholding is due, when the state's letter says another day than usual. */
  stateDueDay?: number | null;
  /** Employees on payroll, when the business says (some states' programs depend on it); else each payday's count. */
  teamSize?: number | null;
};

/** What's been taxed for this person so far this year (from the paydays already recorded). */
export type YearToDate = { ssWages: number; medicareWages: number; futaWages: number; suiWages: number; other?: Record<string, number>;
  /** Bonuses paid so far this year (the federal 37% past $1,000,000). */
  supplemental?: number;
  /** What each program has taken from them so far (New York's paid family leave stops at a yearly most). */
  taken?: Record<string, number>;
  /** Federal income tax withheld from regular pay this year (a bonus can be taxed at the flat 22% only once some has). */
  fedWithheld?: number;
  /** Their last regular paycheck this year: its wages and the federal and state income tax taken from it (a bonus by
   *  the aggregate method). */
  last?: { wages: number; federal: number; state: number } };
export const EMPTY_YTD: YearToDate = { ssWages: 0, medicareWages: 0, futaWages: 0, suiWages: 0, other: {} };

type Row = [number, number, number];   // at least, tentative amount, rate on the excess
type Year = {
  line1g: { married: number; other: number }; allowance: number;
  standard: Record<FilingStatus, Row[]>; checkbox: Record<FilingStatus, Row[]>;
  ss: { rate: number; base: number }; medicare: { rate: number; addl: number; over: number }; futa: { rate: number; base: number };
};

// 2026: Publication 15-T (2026), Worksheet 1A and the Annual Percentage Method Tables for automated payroll; Social
// Security wage base $184,500. (Each state's: lib/state-payroll.)
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
};
const YEARS: Record<number, Year> = { 2026: Y2026 };
const LATEST = Math.max(...Object.keys(YEARS).map(Number));
export const TABLES_YEAR = LATEST;
export const tablesFor = (year: number) => ({ t: YEARS[year] || YEARS[LATEST], stale: !YEARS[year] });

/** States with no income tax on wages. */
export const NO_WAGE_TAX = STATE_LIST.filter((x) => STATES[x.code].noTax).map((x) => x.code as string);
/** States whose own withholding is worked out here: all 50 and DC. */
export const BUILT_IN_STATES = STATE_LIST.filter((x) => !!STATES[x.code].calc).map((x) => x.code as string);
export type StateHow = 'none' | 'built_in' | 'percent' | 'missing';
export const stateHow = (state: string | null | undefined, setup?: PayrollTaxSetup | null, form?: StateForm | null): StateHow => {
  const s = String(state || '').toUpperCase();
  if (NO_WAGE_TAX.includes(s)) return 'none';
  if (BUILT_IN_STATES.includes(s)) return 'built_in';
  return (num(form?.pct) > 0 || num(setup?.statePct) > 0) ? 'percent' : 'missing';
};
/** State unemployment for these wages: the business's own rate (its state letter), else the state's rate for a new
 *  business; the state's yearly wage limit, unless the business set another. A state whose new-business rate depends on
 *  the industry has none until the business puts its own in. */
export function suiOf(state: string | null | undefined, setup: PayrollTaxSetup | null | undefined, year: number): { rate: number; base: number | null } {
  void year; const spec = stateSpec(state);
  const rate = setup?.suiRate != null && Number.isFinite(Number(setup.suiRate)) ? Math.max(0, Math.min(20, Number(setup.suiRate))) : spec?.sui.newRate ?? 0;
  const base = setup?.suiWageBase != null && Number(setup.suiWageBase) > 0 ? Number(setup.suiWageBase) : spec?.sui.base ?? null;
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

/** Federal income tax on a bonus (Publication 15, supplemental wages): 22%, and 37% on any part of the year's bonuses
 *  over $1,000,000, which applies even on an exempt W-4. Extra withholding from step 4(c) isn't added. */
export function supplementalFederal(wages: number, f: FederalForm | null | undefined, soFar: number): number {
  if (!(wages > 0)) return 0;
  const over = Math.max(0, Math.min(wages, soFar + wages - 1000000));
  return r2((f?.exempt ? 0 : (wages - over) * 0.22) + over * 0.37);
}

/** State income tax for one paycheck: the state's own formula (lib/state-payroll), or, with no state built in, a
 *  percentage. `ctx`: the federal W-4's status and this paycheck's federal tax (states that use them), and Social
 *  Security and Medicare on it and so far (Massachusetts). */
export function stateIncomeTax(wages: number, periods: number, state: string | null | undefined, s: StateForm | null | undefined, setup: PayrollTaxSetup | null | undefined, year: number,
  ctx: { fedStatus?: FilingStatus; fedPerPeriod?: number; ficaNow?: number; ficaYtd?: number } = {}): number {
  void year; if (!(wages > 0)) return 0;
  const code = String(state || '').toUpperCase();
  if (NO_WAGE_TAX.includes(code)) return 0;
  if (BUILT_IN_STATES.includes(code)) return stateTaxFor(code, { wages, periods, f: s, ...ctx });
  if (s?.exempt) return 0;
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
  flags: ('no_w4' | 'no_state_form' | 'exempt' | 'short' | 'stale_tables' | 'state_missing' | 'county_missing' | 'sui_rate_missing' | 'team_size_missing')[];
};

export type WithholdingInput = {
  year: number; periods: number; gross: number; inHand?: number;
  forms?: TaxForms | null; state?: string | null; setup?: PayrollTaxSetup | null; ytd?: YearToDate | null;
  /** Employees on this payday (for programs that depend on the business's size, unless Settings says). */
  teamSize?: number | null;
  /** A bonus, or other pay apart from a regular paycheck, taxed at the bonus rates: federal income tax at 22% (37% on
   *  what's over $1,000,000 of bonuses in the year), the state's own bonus rate. Social Security, Medicare and the
   *  rest as always. */
  supplemental?: boolean;
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
    federal: !i.supplemental ? federalIncomeTax(federalWages, periods, forms.federal, i.year)
      // (A bonus: the flat 22% once income tax has been withheld from their regular pay this year; until then the
      // aggregate method, on it and their last regular paycheck together, less what that paycheck had taken.)
      : num(ytd.fedWithheld) > 0 || num(ytd.supplemental) + federalWages > 1000000 ? supplementalFederal(federalWages, forms.federal, num(ytd.supplemental))
      : ytd.last && ytd.last.wages > 0 ? r2(Math.max(0, federalIncomeTax(ytd.last.wages + federalWages, periods, forms.federal, i.year) - num(ytd.last.federal)))
      : federalIncomeTax(federalWages, periods, forms.federal, i.year),
    state: 0,
  };
  // (The person's state form, when it's this state's: one from another state, or saved before this state was built in,
  // is as none. A North Carolina form from before forms named their state is North Carolina's.)
  const stCode = String(i.state || '').toUpperCase(); const fs = forms.state;
  const stateOnFile = !!fs && (fs.state ? fs.state === stCode : stCode === 'NC' && !(Number(fs.pct) > 0));
  const stateForm = BUILT_IN_STATES.includes(stCode) ? (stateOnFile ? fs : null) : fs;
  want.state = i.supplemental && BUILT_IN_STATES.includes(stCode) ? supplementalStateTax(stCode, federalWages, periods, stateForm, status(forms.federal?.status),
      ytd.last ? { wages: num(ytd.last.wages), tax: num(ytd.last.state), fedPerPeriod: r2(num(ytd.last.federal) + want.federal) } : null)
    : stateIncomeTax(federalWages, periods, i.state, stateForm, i.setup, i.year, { fedStatus: status(forms.federal?.status), fedPerPeriod: want.federal,
      ficaNow: r2(want.socialSecurity + want.medicare), ficaYtd: r2(ytd.ssWages * t.ss.rate + ytd.medicareWages * t.medicare.rate) });
  const otherEmp: OtherAmount[] = []; const otherEr: OtherAmount[] = [];
  for (const o of (i.setup?.other || []).slice(0, 8)) {
    const rate = Math.max(0, Math.min(20, num(o.rate))); if (!o.id || !rate) continue;
    const w = r2(under(ficaWages, num(ytd.other?.[o.id]), o.wageBase && o.wageBase > 0 ? o.wageBase : null));
    const amount = r2(w * rate / 100);
    const item = { id: String(o.id).slice(0, 40), name: String(o.name || 'Payroll tax').slice(0, 60), amount, wages: w };
    (o.who === 'employer' ? otherEr : otherEmp).push(item);
  }
  // The state's own programs (paid leave, disability insurance, an employee's share of unemployment), as the business
  // set them: the employee's part (id) and the business's (id_er), each toward its own yearly limit.
  // (The business's size: what Settings says, else this payday's employees; small, the usual, when neither is known.)
  const size = num(i.setup?.teamSize) > 0 ? num(i.setup?.teamSize) : num(i.teamSize) > 0 ? num(i.teamSize) : 1;
  for (const pg of stateSpec(i.state)?.programs || []) {
    const ov = i.setup?.programs?.[pg.id] || undefined;
    const a = programAmounts(pg, ficaWages, num(ytd.other?.[pg.id] ?? ytd.other?.[`${pg.id}_er`]), num(ytd.taken?.[pg.id]), periods,
      ov ? { ...(typeof ov.off === 'boolean' ? { off: ov.off } : {}), ...(ov.employee != null ? { employee: num(ov.employee) } : {}), ...(ov.employer != null ? { employer: num(ov.employer) } : {}) } : undefined, size);
    if (a.employee > 0) otherEmp.push({ id: pg.id, name: pg.name, amount: a.employee, wages: a.wages });
    if (a.employer > 0) otherEr.push({ id: `${pg.id}_er`, name: pg.name, amount: a.employer, wages: a.wages });
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
  // (Only a state whose own form changes the tax: not one that reads the federal W-4, or has nothing to fill in.)
  const sf = stateSpec(i.state)?.form; const needsForm = !!sf && !sf.federal && sf.fields.some((k) => !['extra', 'exempt', 'reduce'].includes(k));
  if (how === 'built_in' && needsForm && !stateOnFile) flags.push('no_state_form');
  // (A county the state's tax needs, Indiana's or Maryland's, not picked; unemployment with no rate to use; programs
  // that depend on the business's size, with no size in Settings: each payday's count is used meanwhile.)
  if (how === 'built_in' && stateOnFile && (stCode === 'IN' || stCode === 'MD') && !fs?.local) flags.push('county_missing');
  if (stateSpec(i.state) && !(sui.rate > 0)) flags.push('sui_rate_missing');
  if ((stateSpec(i.state)?.programs || []).some((p) => p.tiers?.length) && !(num(i.setup?.teamSize) > 0)) flags.push('team_size_missing');
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
    // (Each state's own form: its fields, lib/state-payroll. Only what's set is kept.)
    const s = v.state; const pct = Number(s.pct); const c99 = (x: any) => Math.max(0, Math.min(99, Math.floor(Number(x) || 0)));
    const word = (x: any, re: RegExp) => (typeof x === 'string' && re.test(x) ? x : undefined);
    const st: StateForm = { allowances: c99(s.allowances), extra: money(s.extra, 10000), exempt: s.exempt === true };
    const sw = word(s.status, /^[a-z_]{1,20}$/); if (sw) st.status = sw;
    if (Number(s.additional) > 0) st.additional = c99(s.additional);
    if ([0.5, 1, 1.5, 2, 2.5, 3, 3.5].includes(Number(s.rate))) st.rate = Number(s.rate);
    const cw = word(s.code, /^[A-F]$/); if (cw) st.code = cw;
    const lw = word(s.local, /^[a-z_]{1,40}$/); if (lw) st.local = lw;
    if (money(s.amount, 1000000)) st.amount = money(s.amount, 1000000);
    if (s.flag === true) st.flag = true;
    if (money(s.reduce, 10000)) st.reduce = money(s.reduce, 10000);
    if (Number.isFinite(pct) && pct > 0) st.pct = Math.min(20, Math.round(pct * 1000) / 1000);
    const code = word(s.state, /^[A-Z]{2}$/); if (code) st.state = code;
    out.state = st;
  }
  const retirement = money(v?.pretax?.retirement, 100000), health = money(v?.pretax?.health, 100000);
  if (retirement || health) out.pretax = { retirement, health };
  if (['transfer', 'check', 'cash'].includes(v?.payMethod)) out.payMethod = v.payMethod;
  return out;
}
