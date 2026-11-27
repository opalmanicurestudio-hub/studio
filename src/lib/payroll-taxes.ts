// src/lib/payroll-taxes.ts — PAYROLL RUN IN CLARITYFLOW: who runs payroll, how often it's paid, what each person has
// been taxed on so far this year, and when each payday's taxes are due. lib/withholding works out the taxes on one
// paycheck; this puts a payday's together, for the Payday screen and the server alike.
import { periodOf, periodSettings, todayIn } from './pay-periods';
import { stateSpec, type Freq } from './state-payroll';
import { withholdingFor, owedOf, EMPTY_YTD, type PayrollTaxSetup, type TaxForms, type Withholding, type YearToDate, type Owed } from './withholding';

export type RunBy = 'clarityflow' | 'gusto' | 'company';
/** Who runs payroll, as the business chose it (Settings > Payroll, or asked once on Payday). Until it's chosen: Gusto
 *  when it's connected, otherwise a payroll company, so nothing about a business's payroll changes until it says so. */
export function runByOf(tenant: any): RunBy {
  const set = tenant?.payrollTax?.runBy;
  if (set === 'clarityflow' || set === 'gusto' || set === 'company') return set;
  return tenant?.gusto?.connected ? 'gusto' : 'company';
}
/** Has the business said who runs its payroll? (Payday asks once when it hasn't and Gusto isn't connected.) */
export const runByChosen = (tenant: any) => ['clarityflow', 'gusto', 'company'].includes(String(tenant?.payrollTax?.runBy || ''));
export const setupOf = (tenant: any): PayrollTaxSetup => (tenant?.payrollTax && typeof tenant.payrollTax === 'object' ? tenant.payrollTax : {});
/** The state payroll is taxed in: the one picked for taxes, or the one in the pay rules. */
/** FUTA credit reduction by year and state, percent (a state that hasn't repaid its federal loans): paid with Form 940,
 *  on Schedule A. The Department of Labor names them each November. */
export const CREDIT_REDUCTION: Record<number, Record<string, number>> = { 2025: { CA: 1.2 }, 2026: { CA: 1.5 } };
export const payrollStateOf = (tenant: any): string | null => { const s = String(tenant?.taxState || tenant?.payRules?.state || '').toUpperCase(); return /^[A-Z]{2}$/.test(s) ? s : null; };
/** Paydays a year: 52 weekly, 26 every two weeks, 12 monthly. */
export const periodsPerYear = (tenant: any): number => ({ weekly: 52, monthly: 12 } as Record<string, number>)[periodSettings(tenant).cadence] || 26;

/** The day a recorded payday was paid: its own, or, for one before this was kept, the payday of its pay period (or the
 *  day it was recorded, for dates picked by hand). Taxes belong to the year it's paid in. */
export function payDateOf(run: any, tenant: any): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(run?.payDate || ''))) return String(run.payDate);
  const from = String(run?.from || ''), to = String(run?.to || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && tenant) { const p = periodOf(tenant, from); if (p.from === from && p.to === to) return p.payday; }
  // (The day it was recorded, in the business's own time zone: a payday recorded late on December 31 is that year's.)
  const at = Date.parse(String(run?.recordedAt || ''));
  return Number.isFinite(at) ? (tenant ? todayIn(tenant, at) : new Date(at).toISOString().slice(0, 10)) : '';
}
/** The paydays recorded from the November before `year` on (the query Payday, the server and pay stubs use for the
 *  year so far: any payday paid in `year` was recorded then). */
export const yearRunsFrom = (year: number) => `${year - 1}-11-01`;
/** The paydays and payroll tax payments for what's owed and the forms: from January 1 of the year before `year` on, so
 *  in January last year's fourth quarter, its federal unemployment and its year-end forms are all there. */
export const owedRunsFrom = (year: number) => `${year - 1}-01-01`;
/** The payday for these dates: the pay period's own, or the day it's recorded for dates picked by hand. */
export function payDateFor(tenant: any, from: string, to: string, today: string): string {
  const p = periodOf(tenant, from); return p.from === from && p.to === to ? p.payday : today;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** What each person has been taxed on so far in `year`, from the paydays recorded (payrollRuns, kind 'payday'), not
 *  counting the one for `skipPeriod`. A payday recorded before taxes were worked out here counts what was paid. */
/** `through`: pay between paydays dated back, so only what was paid by then counts (in order, toward each limit). */
export function ytdFrom(runs: any[], tenant: any, year: number, skipPeriod?: string, through?: string): Record<string, YearToDate> {
  const by: Record<string, YearToDate> = {};
  // (Pay from before ClarityFlow this year, lib/payroll-prior: counts toward every wage limit, the state's programs and
  // the taxes the business added, and its federal tax withheld lets a bonus be taxed at the flat rate.)
  const ids = [...(stateSpec(payrollStateOf(tenant))?.programs || []).flatMap((pg) => [pg.id, `${pg.id}_er`]), ...(setupOf(tenant).other || []).map((o) => String(o?.id || '')).filter(Boolean)];
  const lastOn: Record<string, string> = {};
  for (const run of runs || []) {
    if (run?.kind === 'prior' && Number(run.year) === year && Array.isArray(run.people)) {
      for (const p of run.people) { const wages = Number(p?.wages) || 0; if (!p?.staffId || !(wages > 0)) continue;
        const y = by[p.staffId] || (by[p.staffId] = { ...EMPTY_YTD, other: {}, taken: {} });
        y.ssWages = r2(y.ssWages + wages); y.medicareWages = r2(y.medicareWages + wages); y.futaWages = r2(y.futaWages + wages); y.suiWages = r2(y.suiWages + wages);
        y.fedWithheld = r2((y.fedWithheld || 0) + (Number(p.federal) || 0));
        for (const id of ids) y.other![id] = r2((y.other![id] || 0) + wages); }
      continue;
    }
    if (run?.kind !== 'payday' || (skipPeriod && run.periodKey === skipPeriod)) continue;
    const d = payDateOf(run, tenant); if (d.slice(0, 4) !== String(year) || (through && d > through)) continue;
    for (const p of run.people || []) {
      if (!p?.staffId || p.contractor) continue;
      const y = by[p.staffId] || (by[p.staffId] = { ...EMPTY_YTD, other: {}, taken: {} });
      const w = p.taxes?.wages; const gross = r2((Number(p.paid) || 0) + (Number(p.cashTips) || 0));
      // (Regular pay: the federal tax withheld from it, and the last regular paycheck, for a bonus.)
      if (!run.offCycle && p.taxes?.employee) {
        y.fedWithheld = r2((y.fedWithheld || 0) + (Number(p.taxes.employee.federal) || 0));
        if (w && Number(w.federal) > 0 && d >= (lastOn[p.staffId] || '')) { lastOn[p.staffId] = d; y.last = { wages: Number(w.federal) || 0, federal: Number(p.taxes.employee.federal) || 0, state: Number(p.taxes.employee.state) || 0 }; }
      }
      y.ssWages = r2(y.ssWages + (w ? Number(w.socialSecurity) || 0 : gross));
      y.medicareWages = r2(y.medicareWages + (w ? Number(w.medicare) || 0 : gross));
      y.futaWages = r2(y.futaWages + (w ? Number(w.futa) || 0 : gross));
      y.suiWages = r2(y.suiWages + (w ? Number(w.sui) || 0 : gross));
      for (const o of [...(p.taxes?.employee?.other || []), ...(p.taxes?.employer?.other || [])]) if (o?.id) y.other![o.id] = r2((y.other![o.id] || 0) + (Number(o.wages) || gross));
      for (const o of p.taxes?.employee?.other || []) if (o?.id) y.taken![o.id] = r2((y.taken![o.id] || 0) + (Number(o.amount) || 0));
      if (run.supplemental) y.supplemental = r2((y.supplemental || 0) + (w ? Number(w.federal) || 0 : gross));
    }
  }
  return by;
}

export type PaydayPersonIn = { staffId: string; gross: number; inHand: number; contractor?: boolean };
/** Employees on the latest regular payday this year (a bonus's programs that depend on the business's size). */
export const teamOnLastPayday = (runs: any[], tenant: any, year: number, through?: string): number | null => {
  const last = (runs || []).filter((r) => r?.kind === 'payday' && !r.offCycle && payDateOf(r, tenant).slice(0, 4) === String(year) && (!through || payDateOf(r, tenant) <= through)).sort((a, b) => payDateOf(b, tenant).localeCompare(payDateOf(a, tenant)))[0];
  return last ? (last.people || []).filter((p: any) => !p.contractor && (Number(p.paid) || 0) + (Number(p.cashTips) || 0) > 0).length || null : null;
};
/** Every employee's taxes for one payday, and what the payday owes. `offCycle`: pay between paydays, with no
 *  retirement or health taken out of it (those come out of each regular paycheck); `supplemental`: taxed at the bonus
 *  rates; `teamSize`: the business's employees, when it isn't this payday's count (a bonus to one person). */
export function paydayTaxes(input: { tenant: any; payDate: string; people: PaydayPersonIn[]; forms: Record<string, TaxForms | null | undefined>; ytd: Record<string, YearToDate>; offCycle?: boolean; supplemental?: boolean; teamSize?: number | null }):
  { by: Record<string, Withholding>; owed: Owed; employeeTotal: number; employerTotal: number; takeHome: number; pretax: number } {
  const year = Number(input.payDate.slice(0, 4)) || new Date().getFullYear();
  const periods = periodsPerYear(input.tenant); const state = payrollStateOf(input.tenant); const setup = setupOf(input.tenant);
  const by: Record<string, Withholding> = {};
  for (const p of input.people) {
    if (p.contractor || !(p.gross > 0)) continue;
    const f = input.forms[p.staffId] || null;
    by[p.staffId] = withholdingFor({ year, periods, gross: p.gross, inHand: p.inHand, forms: f && input.offCycle ? { ...f, pretax: null } : f, state, setup, ytd: input.ytd[p.staffId] || null,
      teamSize: input.teamSize || input.people.filter((x) => !x.contractor && x.gross > 0).length, supplemental: !!input.supplemental });
  }
  const list = Object.values(by); const sum = (f: (w: Withholding) => number) => r2(list.reduce((n, w) => n + f(w), 0));
  return { by, owed: owedOf(list), employeeTotal: sum((w) => w.employeeTotal), employerTotal: sum((w) => w.employerTotal), takeHome: sum((w) => w.takeHome), pretax: sum((w) => w.pretax.retirement + w.pretax.health) };
}

// ── When it's due ──
const DAY = 86400000;
const ms = (d: string) => Date.parse(`${d}T12:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
const dow = (d: string) => new Date(ms(d)).getUTCDay();
const lastOfMonth = (y: number, m: number) => iso(Date.UTC(y, m + 1, 0, 12));   // m 0-based
const nth = (y: number, m: number, weekday: number, n: number) => { const first = new Date(Date.UTC(y, m, 1, 12)).getUTCDay(); return iso(Date.UTC(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7, 12)); };
const lastWeekday = (y: number, m: number, weekday: number) => { const last = ms(lastOfMonth(y, m)); const back = (new Date(last).getUTCDay() - weekday + 7) % 7; return iso(last - back * DAY); };
/** Federal holidays in a year, on the day they're observed (a Saturday's on the Friday, a Sunday's on the Monday). */
export function federalHolidays(y: number): string[] {
  const obs = (d: string) => (dow(d) === 6 ? addDays(d, -1) : dow(d) === 0 ? addDays(d, 1) : d);
  const fixed = (m: number, day: number) => obs(iso(Date.UTC(y, m, day, 12)));
  return [fixed(0, 1), nth(y, 0, 1, 3), nth(y, 1, 1, 3), lastWeekday(y, 4, 1), fixed(5, 19), fixed(6, 4), nth(y, 8, 1, 1), nth(y, 9, 1, 2), fixed(10, 11), nth(y, 10, 4, 4), fixed(11, 25)];
}
const businessDay = (d: string) => dow(d) !== 0 && dow(d) !== 6 && !federalHolidays(Number(d.slice(0, 4))).includes(d);
/** A due date on a weekend or holiday moves to the next business day. */
export const nextBusinessDay = (d: string) => { let x = d; for (let i = 0; i < 10 && !businessDay(x); i++) x = addDays(x, 1); return x; };
/** The day `n` business days after `d`. */
export const businessDaysAfter = (d: string, n: number) => { let x = d; for (let k = 0; k < n; ) { x = addDays(x, 1); if (businessDay(x)) k++; } return x; };
const fifteenthAfter = (d: string) => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); return nextBusinessDay(iso(Date.UTC(y, m, 15, 12))); };
/** Twice-a-week deposits: the Wednesday after a Wednesday to Friday payday, the Friday after a Saturday to Tuesday one,
 *  with at least three business days in between. */
const semiweeklyDue = (payDate: string) => { const w = dow(payDate); const to = w >= 3 && w <= 5 ? 3 : 5; let d = addDays(payDate, ((to - w + 7) % 7) || 7);
  let n = 0; for (let x = addDays(payDate, 1); x <= d; x = addDays(x, 1)) if (businessDay(x)) n++; while (n < 3) { d = addDays(d, 1); if (businessDay(d)) n++; } return nextBusinessDay(d); };
const quarterEnd = (d: string) => { const y = Number(d.slice(0, 4)), q = Math.floor((Number(d.slice(5, 7)) - 1) / 3); return { y, q }; };
/** The last day of the month after the payday's quarter (quarterly reports and deposits). */
export const afterQuarter = (d: string) => { const { y, q } = quarterEnd(d); const m = q * 3 + 3; return nextBusinessDay(lastOfMonth(y + Math.floor(m / 12), m % 12)); };
/** The quarter a day is in, in words: "October to December". */
export const quarterWords = (d: string) => ['January to March', 'April to June', 'July to September', 'October to December'][quarterEnd(d).q];

export type DueDates = { irs: string; state: string | null; sui: string; futa: string };
/** How often the business files state withholding: what it picked (its state's letter says), if the state has that,
 *  else the state's usual. Null for a state with no income tax on wages. */
export function stateFilingOf(tenant: any): Freq | null {
  const spec = stateSpec(payrollStateOf(tenant)); if (!spec?.filing || spec.noTax) return null;
  const f = setupOf(tenant).stateFiling as Freq | undefined; return f && spec.filing.frequencies.includes(f) ? f : spec.filing.frequencies[0];
}
/** The day of the month the state's monthly withholding is due: the business's own (its letter), else the state's. */
export const stateDueDayOf = (tenant: any): number | 'last' => { const d = Number(setupOf(tenant).stateDueDay); return d >= 1 && d <= 31 ? Math.floor(d) : stateSpec(payrollStateOf(tenant))?.filing?.monthlyDue ?? 15; };
/** Twice a month, by the state's rule: the 25th for the 1st to the 15th and the 10th of the next month for the rest (mid);
 *  3 banking days after the 15th and after the month's end (plus3); the 20th and the 5th of the next month (id). */
const semimonthlyDue = (d: string, rule: 'mid' | 'plus3' | 'id') => {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); const early = Number(d.slice(8, 10)) <= 15;
  if (rule === 'plus3') return businessDaysAfter(early ? iso(Date.UTC(y, m - 1, 15, 12)) : lastOfMonth(y, m - 1), 3);
  if (rule === 'id') return early ? nextBusinessDay(iso(Date.UTC(y, m - 1, 20, 12))) : dayOfNextMonth(d, 5);
  return early ? nextBusinessDay(iso(Date.UTC(y, m - 1, 25, 12))) : dayOfNextMonth(d, 10);
};
const dayOfNextMonth = (d: string, day: number | 'last') => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); const last = lastOfMonth(y + Math.floor(m / 12), m % 12);
  return nextBusinessDay(day === 'last' ? last : iso(Math.min(ms(last), Date.UTC(y + Math.floor(m / 12), m % 12, day, 12)))); };
/** When a payday's taxes are due. The IRS: by the 15th of the next month (monthly deposits), or twice a week
 *  (semiweeklyDue). The state's income tax, by how often the business files it (lib/state-payroll, each state's):
 *  monthly, by the state's day of the next month (North Carolina's December by January 31, G.S. 105-163.6); quarterly,
 *  the end of the month after the quarter (or the state's own day then); twice a week, as the IRS; twice a month, the
 *  25th for the 1st to the 15th and the 10th of the next month for the rest; once a year, January 31. Unemployment:
 *  the end of the month after the quarter. A weekend or holiday moves to the next business day. */
export function dueDates(payDate: string, tenant: any): DueDates {
  const setup = setupOf(tenant); const state = payrollStateOf(tenant); const spec = stateSpec(state); const freq = stateFilingOf(tenant);
  const irs = setup.federalDeposits === 'semiweekly' ? semiweeklyDue(payDate) : fifteenthAfter(payDate);
  const y = Number(payDate.slice(0, 4)), m = Number(payDate.slice(5, 7));
  const qDay = spec?.filing?.quarterlyDue; const quarterly = () => { if (!qDay) return afterQuarter(payDate); const { y: qy, q } = quarterEnd(payDate); const mm = q * 3 + 3; return nextBusinessDay(iso(Date.UTC(qy + Math.floor(mm / 12), mm % 12, qDay, 12))); };
  const st = !freq ? null
    : freq === 'quarterly' ? quarterly()
    : freq === 'semiweekly' ? semiweeklyDue(payDate)
    : freq === 'semimonthly' ? semimonthlyDue(payDate, spec?.filing?.semimonthly || 'mid')
    : freq === 'weekly' ? nextBusinessDay(addDays(payDate, 10 - dow(payDate)))
    // (New York: by 5 or 3 business days after the payday that brings what's unpaid to $700, worked out across paydays in
    // lib/payroll-owed; until then, with the quarter's NYS-45.)
    : freq === 'ny5' || freq === 'ny3' ? afterQuarter(payDate)
    : freq === 'annually' ? nextBusinessDay(iso(Date.UTC(y + 1, 0, 31, 12)))
    : state === 'NC' && m === 12 && !Number(setup.stateDueDay) ? nextBusinessDay(lastOfMonth(y + 1, 0)) : dayOfNextMonth(payDate, stateDueDayOf(tenant));
  return { irs, state: st, sui: afterQuarter(payDate), futa: afterQuarter(payDate) };
}

// ── On a pay stub ──
export type StubTaxes = {
  /** From the payday recorded (final), or worked out now until it's recorded. */
  recorded: boolean; payDate: string;
  earned: number; inHand: number; pretax: number;
  lines: { key: string; label: string; amount: number; ytd: number }[];
  withheld: number; takeHome: number; short: number;
  ytd: { earned: number; withheld: number; takeHome: number };
  method?: string; checkNo?: string;
  /** The year so far includes pay from before ClarityFlow through this day (lib/payroll-prior): its earnings and taxes,
   *  not its take-home, which is on the old pay stubs. */
  prior?: string;
};
const linesOf = (w: any, stateName: string) => {
  const e = w?.employee || {}; const out: { key: string; label: string; amount: number }[] = [
    { key: 'federal', label: 'Federal income tax', amount: Number(e.federal) || 0 },
    { key: 'ss', label: 'Social Security', amount: Number(e.socialSecurity) || 0 },
    { key: 'medicare', label: 'Medicare', amount: r2((Number(e.medicare) || 0) + (Number(e.additionalMedicare) || 0)) },
  ];
  if (w?.stateHow !== 'none') out.push({ key: 'state', label: `${stateName || 'State'} income tax`, amount: Number(e.state) || 0 });
  for (const o of e.other || []) out.push({ key: `o_${o.id}`, label: String(o.name || 'Payroll tax'), amount: Number(o.amount) || 0 });
  return out;
};
/** One person's taxes for a pay stub, and the year so far: from the payday recorded for these dates, or, until it's
 *  recorded, worked out from their forms the same way Payday does. */
export function stubTaxes(input: { tenant: any; staffId: string; periodKey: string; payDate: string; runs: any[]; forms: TaxForms | null | undefined; gross: number; inHand: number; stateName: string }): StubTaxes {
  const { tenant, staffId, periodKey } = input;
  const mine = (run: any) => (run?.people || []).find((x: any) => x?.staffId === staffId && x.taxes);
  const own = (input.runs || []).find((r: any) => r?.kind === 'payday' && r.periodKey === periodKey);
  const kept = own ? mine(own) : null;
  const payDate = own ? payDateOf(own, tenant) : input.payDate; const year = payDate.slice(0, 4);
  const w: any = kept ? kept.taxes : paydayTaxes({ tenant, payDate, forms: { [staffId]: input.forms || null }, ytd: ytdFrom(input.runs, tenant, Number(year), periodKey),
    people: [{ staffId, gross: input.gross, inHand: input.inHand }] }).by[staffId];
  const lines = linesOf(w, input.stateName);
  const ytdLines: Record<string, number> = Object.fromEntries(lines.map((l) => [l.key, l.amount]));
  let earned = Number(w?.gross) || 0, withheld = Number(w?.employeeTotal) || 0, takeHome = Number(w?.takeHome) || 0;
  for (const run of input.runs || []) {
    if (run?.kind !== 'payday' || run.periodKey === periodKey) continue;
    const d = payDateOf(run, tenant); if (d.slice(0, 4) !== year || d > payDate) continue;
    const x = mine(run); if (!x) continue;
    earned += Number(x.taxes.gross) || 0; withheld += Number(x.taxes.employeeTotal) || 0; takeHome += Number(x.taxes.takeHome) || 0;
    for (const l of linesOf(x.taxes, input.stateName)) if (l.key in ytdLines) ytdLines[l.key] += l.amount;
  }
  // (Pay from before ClarityFlow this year: its earnings and each tax withheld.)
  const pr = (input.runs || []).find((r: any) => r?.kind === 'prior' && String(r.year) === year && Array.isArray(r.people) && String(r.lastPayDate || '') <= payDate);
  const px = pr ? pr.people.find((x: any) => x?.staffId === staffId) : null;
  if (px) {
    earned += Number(px.wages) || 0;
    const add: Record<string, number> = { federal: Number(px.federal) || 0, ss: Number(px.ss) || 0, medicare: Number(px.medicare) || 0, state: Number(px.state) || 0 };
    for (const k of Object.keys(add)) { if (k in ytdLines) ytdLines[k] += add[k]; withheld += add[k]; }
  }
  const s = w?.short || {};
  return {
    recorded: !!kept, payDate, earned: Number(w?.gross) || 0, inHand: Number(w?.inHand) || 0, pretax: r2((Number(w?.pretax?.retirement) || 0) + (Number(w?.pretax?.health) || 0)),
    lines: lines.map((l) => ({ ...l, ytd: r2(ytdLines[l.key]) })), withheld: Number(w?.employeeTotal) || 0, takeHome: Number(w?.takeHome) || 0,
    short: r2((Number(s.socialSecurity) || 0) + (Number(s.medicare) || 0) + (Number(s.federal) || 0) + (Number(s.state) || 0)),
    ytd: { earned: r2(earned), withheld: r2(withheld), takeHome: r2(takeHome) },
    ...(kept?.method ? { method: String(kept.method) } : {}), ...(kept?.checkNo ? { checkNo: String(kept.checkNo) } : {}),
    ...(px ? { prior: String(pr.lastPayDate) } : {}),
  };
}
