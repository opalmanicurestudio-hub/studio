// src/lib/state-payroll.ts — EVERY STATE'S PAYROLL TAXES, for payroll run in ClarityFlow (lib/withholding works out a
// paycheck; this is what each state asks for). All 50 states and DC: state income tax withholding from the state's own
// 2026 formula and its own employee form (California's DE 4, New York's IT-2104, Georgia's G-4…, or the federal W-4
// where the state uses it), with the county or city tax a state collects with it (Maryland's counties, Indiana's
// counties, New York City and Yonkers); the state's bonus rate; unemployment (the 2026 wage limit and the rate for a new
// business, which the business's own rate from its state letter replaces); the programs paid through payroll (disability
// insurance and paid leave, an employee's share of unemployment, Oregon's transit tax); and how withholding is filed and
// paid (the state's form names, how often, the day it's due) and the names its payments show under at the bank.
//
// Sources, 2026: each state's employer withholding guide, as published for payroll systems (the National Finance
// Center's state formula bulletins, checked against the state's own guide where they differ: New York NYS-50-T-NYS and
// -NYC and -Y, New Jersey's withholding tables, South Carolina WH-1603F, Virginia's employer instructions, Wisconsin
// W-166, Iowa's 2026 formula, Connecticut's Circular CT, Oregon's 150-206-436); unemployment wage limits from the
// states' 2026 notices (as gathered by Equifax), new-business rates as the states publish them; paid leave and
// disability rates from the states' 2026 notices. Each January: check every state for the new year (`YEAR`).
//
// Pure: no Firebase. A state's tax is worked out for the year (wages × paydays a year) and divided by the paydays, as the
// states' own formulas do, then rounded the way the state says.

export const STATE_TABLES_YEAR = 2026;

export type StateCode = 'AL' | 'AK' | 'AZ' | 'AR' | 'CA' | 'CO' | 'CT' | 'DE' | 'DC' | 'FL' | 'GA' | 'HI' | 'ID' | 'IL' | 'IN' | 'IA' | 'KS' | 'KY' | 'LA' | 'ME' | 'MD' | 'MA'
  | 'MI' | 'MN' | 'MS' | 'MO' | 'MT' | 'NE' | 'NV' | 'NH' | 'NJ' | 'NM' | 'NY' | 'NC' | 'ND' | 'OH' | 'OK' | 'OR' | 'PA' | 'RI' | 'SC' | 'SD' | 'TN' | 'TX' | 'UT' | 'VT' | 'VA'
  | 'WA' | 'WV' | 'WI' | 'WY';

/** What a person wrote on their state's form. Which of these a state asks for is its `form.fields`. */
export type StateFormIn = {
  /** The state's own filing status (its `form.statuses`); for a state that uses the federal W-4, the W-4's. */
  status?: string;
  /** Allowances or exemptions, as the state's form calls them. */
  allowances?: number;
  /** A second count the form asks for: California's additional allowances, Illinois's line 2, Indiana's and Georgia's
   *  dependents, Virginia's age 65 or blind exemptions, Massachusetts's blind exemptions. */
  additional?: number;
  /** Arizona: the percentage chosen on the A-4. */
  rate?: number;
  /** New Jersey's rate table (A to E), Connecticut's withholding code (A to F), Iowa's deduction letter. */
  code?: string;
  /** Maryland and Indiana: the county; New York: 'nyc', 'yonkers' or 'yonkers_nonresident'. */
  local?: string;
  /** Colorado's DR 0004 line 2 (a year), Mississippi's exemption total (a year). */
  amount?: number;
  /** West Virginia: two or more earners. Massachusetts: head of household. Nebraska: approved for lower withholding. */
  flag?: boolean;
  /** Taken off each paycheck's state tax (Connecticut's line 3, Louisiana's reduction). */
  reduce?: number;
  /** Extra withheld each paycheck. */
  extra?: number;
  /** Claimed exempt on the state's form (where the state allows it). */
  exempt?: boolean;
  /** A state not built in: a percentage of wages. (Every state is built in; kept for forms saved before.) */
  pct?: number;
  /** The state this form is for ("GA"): a form kept from another state, or from before the state was built in, isn't
   *  used. */
  state?: string;
};

export type StateField = 'status' | 'allowances' | 'additional' | 'rate' | 'code' | 'local' | 'amount' | 'flag' | 'reduce' | 'extra' | 'exempt';
export type Choice = { v: string; label: string };
export type StateFormSpec = {
  /** The form's name: "DE 4", "IT-2104", or "W-4" for a state that uses the federal form. */
  name: string;
  /** The state reads the federal W-4's filing status (and nothing of its own). */
  federal?: boolean;
  fields: StateField[];
  statuses?: Choice[];
  /** What each field is called on this state's form. */
  labels?: Partial<Record<StateField, string>>;
  codes?: Choice[]; locals?: Choice[]; rates?: number[];
  /** What's used when no form is on file. */
  none: string;
};
export type ProgramSpec = {
  id: string; name: string;
  /** Its short name, when it's paid with state withholding ("SDI"). */
  short?: string;
  /** Rates in percent. `employee`: the most that may be taken from pay (the business can pay it instead). */
  employee?: number; employer?: number;
  /** Wages it's on, each person, a year (null: all wages). */
  base?: number | null;
  /** The most taken from a person a week (New York's disability insurance) or a year. */
  weeklyMax?: number; yearlyMax?: number;
  /** Paid with state withholding (in the same payment), with the state's unemployment (the same report and payment),
   *  on a quarterly report of its own, or to an insurance company. */
  paid: 'quarterly' | 'withholding' | 'ui' | 'carrier';
  /** Programs on one report and one payment together ("wa_leave"). */
  group?: string;
  /** By the number of employees: the first tier the business is under applies (off: not covered at that size). */
  tiers?: { below: number; employee?: number; employer?: number; off?: boolean }[];
  /** Off until the business turns it on (its rate depends on its own policy). */
  defaultOff?: boolean;
  note?: string;
};
/** How often state withholding is paid. 'weekly': by the Wednesday after the week. 'ny5'/'ny3': New York's, within 5 (or,
 *  with $15,000 or more withheld last year, 3) business days of the payday that brings what's unpaid to $700, the rest
 *  with the quarter's NYS-45. */
export type Freq = 'monthly' | 'quarterly' | 'semiweekly' | 'semimonthly' | 'annually' | 'weekly' | 'ny5' | 'ny3';
export type StateSpec = {
  code: StateCode; name: string;
  /** No income tax on wages. */
  noTax?: boolean;
  form?: StateFormSpec;
  /** A year's tax, before dividing by the paydays. */
  calc?: (x: CalcIn) => number;
  /** How the paycheck's amount is rounded: to the dollar, up to the dollar, or to the cent. */
  round?: 'dollar' | 'up';
  /** Bonuses (supplemental wages): a flat percent, or worked out like a regular paycheck. */
  supplemental: number | 'regular';
  sui: { base: number; newRate: number | null; agency: string; report: string;
    /** Paid to the state's revenue department (Oregon's combined report), or either, by the bank's payee name. */
    paidTo?: 'revenue' | 'either';
    /** What the rate from the state's letter should include. */
    note?: string };
  programs?: ProgramSpec[];
  filing?: { agency: string; deposit: string; quarterly: string; annual: string | null; annualDue: string; monthlyDue: number | 'last'; frequencies: Freq[];
    /** The day of the month after the quarter a quarterly return is due, when it isn't the last. */
    quarterlyDue?: number;
    /** Twice a month: the 25th and the 10th of the next month (mid), 3 banking days after each half (plus3), or the 20th
     *  and the 5th of the next month (id). */
    semimonthly?: 'mid' | 'plus3' | 'id' };
  /** Words its payments show under at the bank: income tax withheld, and unemployment. */
  bank: { revenue: string; ui: string };
  /** City or county taxes in the state that aren't collected with its own (added under Other payroll taxes). */
  localNote?: string;
};
export type CalcIn = {
  annual: number; periods: number; f: StateFormIn;
  /** The federal W-4's status (single, married, hoh), for a state that uses it. */
  fedStatus: 'single' | 'married' | 'hoh';
  /** This paycheck's federal income tax, a year (Alabama and Oregon take it off first). */
  fedAnnual: number;
  /** Social Security and Medicare on this paycheck, and so far this year (Massachusetts takes up to $2,000 off). */
  ficaNow: number; ficaYtd: number;
};

// ── Helpers ──
type Row = [over: number, base: number, rate: number];   // tax = base + rate% × (x − over)
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const n0 = (v: any) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const cnt = (v: any) => Math.max(0, Math.floor(n0(v)));
const brk = (rows: Row[], x: number) => { if (!(x > 0)) return 0; let r = rows[0]; for (const row of rows) if (x > row[0]) r = row; return r[1] + (r[2] / 100) * (x - r[0]); };
const ST: Choice[] = [{ v: 'single', label: 'Single' }, { v: 'married', label: 'Married' }];
const ST3: Choice[] = [{ v: 'single', label: 'Single, or married filing separately' }, { v: 'married', label: 'Married filing jointly' }, { v: 'hoh', label: 'Head of household' }];
const XE: StateField[] = ['extra', 'exempt'];
const QTR = 'quarterly' as const;

// ── Local taxes collected with the state's ──
export const MD_COUNTIES: Choice[] = [
  ['allegany', 'Allegany', 3.2], ['anne_arundel', 'Anne Arundel', 0], ['baltimore_county', 'Baltimore County', 3.2], ['baltimore_city', 'Baltimore City', 3.2], ['calvert', 'Calvert', 3.2],
  ['caroline', 'Caroline', 3.2], ['carroll', 'Carroll', 3.03], ['cecil', 'Cecil', 2.74], ['charles', 'Charles', 3.03], ['dorchester', 'Dorchester', 3.3], ['frederick', 'Frederick', 0],
  ['garrett', 'Garrett', 2.65], ['harford', 'Harford', 3.06], ['howard', 'Howard', 3.2], ['kent', 'Kent', 3.3], ['montgomery', 'Montgomery', 3.2], ['prince_georges', 'Prince George’s', 3.2],
  ['queen_annes', 'Queen Anne’s', 3.2], ['st_marys', 'St. Mary’s', 3.2], ['somerset', 'Somerset', 3.2], ['talbot', 'Talbot', 2.4], ['washington', 'Washington', 2.95],
  ['wicomico', 'Wicomico', 3.2], ['worcester', 'Worcester', 2.25], ['nonresident', 'Lives outside Maryland', 2.25],
].map(([v, label]) => ({ v: String(v), label: String(label) }));
const MD_RATE: Record<string, number> = Object.fromEntries([['allegany', 3.2], ['baltimore_county', 3.2], ['baltimore_city', 3.2], ['calvert', 3.2], ['caroline', 3.2], ['carroll', 3.03],
  ['cecil', 2.74], ['charles', 3.03], ['dorchester', 3.3], ['garrett', 2.65], ['harford', 3.06], ['howard', 3.2], ['kent', 3.3], ['montgomery', 3.2], ['prince_georges', 3.2],
  ['queen_annes', 3.2], ['st_marys', 3.2], ['somerset', 3.2], ['talbot', 2.4], ['washington', 2.95], ['wicomico', 3.2], ['worcester', 2.25], ['nonresident', 2.25]]);
function mdCounty(county: string | undefined, married: boolean, taxable: number): number {
  if (!(taxable > 0)) return 0;
  if (county === 'anne_arundel') return married ? brk([[0, 0, 2.7], [75000, 2025, 2.94], [480000, 13932, 3.2]], taxable) : brk([[0, 0, 2.7], [50000, 1350, 2.94], [400000, 11640, 3.2]], taxable);
  if (county === 'frederick') { const t = married ? [[25000, 2.25], [100000, 2.75], [250000, 2.96]] : [[25000, 2.25], [50000, 2.75], [150000, 2.96]]; const rate = (t.find(([hi]) => taxable <= hi) || [0, 3.2])[1]; return taxable * rate / 100; }
  return taxable * (MD_RATE[county || ''] ?? 3.2) / 100;   // (No county picked: the most common rate, 3.2%.)
}
const IN_RATES: [string, number][] = [['Adams', 1.6], ['Allen', 1.59], ['Bartholomew', 1.75], ['Benton', 1.79], ['Blackford', 2.5], ['Boone', 1.71], ['Brown', 2.5234], ['Carroll', 2.4733],
  ['Cass', 2.95], ['Clark', 2], ['Clay', 2.35], ['Clinton', 2.65], ['Crawford', 1.65], ['Daviess', 1.5], ['Dearborn', 1.4], ['Decatur', 2.45], ['DeKalb', 2.13], ['Delaware', 1.5], ['Dubois', 1.2],
  ['Elkhart', 2], ['Fayette', 2.82], ['Floyd', 1.89], ['Fountain', 2.1], ['Franklin', 1.7], ['Fulton', 2.88], ['Gibson', 1.3], ['Grant', 2.75], ['Greene', 2.35], ['Hamilton', 1.1], ['Hancock', 1.94],
  ['Harrison', 1], ['Hendricks', 1.7], ['Henry', 2.02], ['Howard', 2.35], ['Huntington', 1.95], ['Jackson', 2.1], ['Jasper', 2.864], ['Jay', 2.5], ['Jefferson', 1.03], ['Jennings', 2.5],
  ['Johnson', 1.4], ['Knox', 1.7], ['Kosciusko', 1], ['LaGrange', 1.65], ['Lake', 1.5], ['LaPorte', 1.45], ['Lawrence', 1.75], ['Madison', 2.25], ['Marion', 2.02], ['Marshall', 1.25],
  ['Martin', 2.5], ['Miami', 2.54], ['Monroe', 2.14], ['Montgomery', 2.65], ['Morgan', 2.72], ['Newton', 1], ['Noble', 1.75], ['Ohio', 2], ['Orange', 1.75], ['Owen', 2.5], ['Parke', 2.65],
  ['Perry', 1.4], ['Pike', 1.2], ['Porter', 0.5], ['Posey', 1.45], ['Pulaski', 2.85], ['Putnam', 2.3], ['Randolph', 3], ['Ripley', 2.38], ['Rush', 2.15], ['St. Joseph', 1.75], ['Scott', 2.16],
  ['Shelby', 1.7], ['Spencer', 0.8], ['Starke', 1.71], ['Steuben', 1.99], ['Sullivan', 1.7], ['Switzerland', 1.45], ['Tippecanoe', 1.28], ['Tipton', 2.6], ['Union', 2.75], ['Vanderburgh', 1.25],
  ['Vermillion', 1.5], ['Vigo', 2], ['Wabash', 2.9], ['Warren', 2.12], ['Warrick', 1], ['Washington', 2], ['Wayne', 1.25], ['Wells', 2.1], ['White', 2.32], ['Whitley', 1.6829]];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '_');
export const IN_COUNTIES: Choice[] = IN_RATES.map(([n]) => ({ v: slug(n), label: n }));
const IN_RATE: Record<string, number> = Object.fromEntries(IN_RATES.map(([n, r]) => [slug(n), r]));

// ── Connecticut's tables (Circular CT): exemption, phase-out add-back, recapture, credit ──
const ctSteps = (x: number, from: number, step: number, add: number, max: number) => (x <= from ? 0 : Math.min(max, Math.ceil((x - from) / step) * add));
function ctRecapture(code: string, s: number): number {
  // In steps: so much for each part of a band (of $5,000, $8,000 or $10,000) over its start, then a level, then the next band.
  if (code === 'B') { if (s <= 168000) return 0; if (s <= 240000) return Math.ceil((s - 168000) / 8000) * 40; if (s <= 320000) return 400; if (s <= 552000) return 540 + (Math.ceil((s - 320000) / 8000) - 1) * 140; if (s <= 800000) return 4600; return Math.min(5320, 4600 + Math.ceil((s - 800000) / 8000) * 80); }
  if (code === 'C') { if (s <= 210000) return 0; if (s <= 300000) return Math.ceil((s - 210000) / 10000) * 50; if (s <= 400000) return 500; if (s <= 690000) return 680 + (Math.ceil((s - 400000) / 10000) - 1) * 180; if (s <= 1000000) return 5900; return Math.min(6800, 5900 + Math.ceil((s - 1000000) / 10000) * 100); }
  if (s <= 105000) return 0; if (s <= 150000) return Math.ceil((s - 105000) / 5000) * 25; if (s <= 200000) return 250; if (s <= 345000) return 340 + (Math.ceil((s - 200000) / 5000) - 1) * 90; if (s <= 500000) return 2950;
  return Math.min(3400, 2950 + Math.ceil((s - 500000) / 5000) * 50);
}
// Credit decimals by annual salary: [from, to, decimal], then one point less each $500 up to the end.
const CT_CREDIT: Record<string, { rows: [number, number, number][]; tailFrom: number; tailTo: number }> = {
  A: { rows: [[12000, 15000, .75], [15000, 15500, .70], [15500, 16000, .65], [16000, 16500, .60], [16500, 17000, .55], [17000, 17500, .50], [17500, 18000, .45], [18000, 18500, .40], [18500, 20000, .35], [20000, 20500, .30], [20500, 21000, .25], [21000, 21500, .20], [21500, 25000, .15], [25000, 25500, .14], [25500, 26000, .13], [26000, 26500, .12], [26500, 27000, .11], [27000, 48000, .10]], tailFrom: 48000, tailTo: 52500 },
  B: { rows: [[19000, 24000, .75], [24000, 24500, .70], [24500, 25000, .65], [25000, 25500, .60], [25500, 26000, .55], [26000, 26500, .50], [26500, 27000, .45], [27000, 27500, .40], [27500, 34000, .35], [34000, 34500, .30], [34500, 35000, .25], [35000, 35500, .20], [35500, 44000, .15], [44000, 44500, .14], [44500, 45000, .13], [45000, 45500, .12], [45500, 46000, .11], [46000, 74000, .10]], tailFrom: 74000, tailTo: 78500 },
  C: { rows: [[24000, 30000, .75], [30000, 30500, .70], [30500, 31000, .65], [31000, 31500, .60], [31500, 32000, .55], [32000, 32500, .50], [32500, 33000, .45], [33000, 33500, .40], [33500, 40000, .35], [40000, 40500, .30], [40500, 41000, .25], [41000, 41500, .20], [41500, 50000, .15], [50000, 50500, .14], [50500, 51000, .13], [51000, 51500, .12], [51500, 52000, .11], [52000, 96000, .10]], tailFrom: 96000, tailTo: 100500 },
  F: { rows: [[15000, 18800, .75], [18800, 19300, .70], [19300, 19800, .65], [19800, 20300, .60], [20300, 20800, .55], [20800, 21300, .50], [21300, 21800, .45], [21800, 22300, .40], [22300, 25000, .35], [25000, 25500, .30], [25500, 26000, .25], [26000, 26500, .20], [26500, 31300, .15], [31300, 31800, .14], [31800, 32300, .13], [32300, 32800, .12], [32800, 33300, .11], [33300, 60000, .10]], tailFrom: 60000, tailTo: 64500 },
};
function ctCredit(code: string, s: number): number {
  const t = CT_CREDIT[code]; if (!t) return 0;
  for (const [from, to, d] of t.rows) if (s > from && s <= to) return d;
  if (s > t.tailFrom && s <= t.tailTo) return Math.max(0, Math.round((0.10 - Math.ceil((s - t.tailFrom) / 500) * 0.01) * 100) / 100);
  return 0;
}
function ctTax(code: string, s: number): number {
  if (code === 'E') return 0;
  const ex = code === 'A' ? Math.max(0, 12000 - Math.ceil(Math.max(0, s - 24000) / 1000) * 1000) : code === 'B' ? Math.max(0, 19000 - Math.ceil(Math.max(0, s - 38000) / 1000) * 1000)
    : code === 'C' ? Math.max(0, 24000 - Math.ceil(Math.max(0, s - 48000) / 1000) * 1000) : code === 'F' ? Math.max(0, 15000 - Math.ceil(Math.max(0, s - 30000) / 1000) * 1000) : 0;
  const ti = Math.max(0, s - ex); if (!(ti > 0)) return 0;
  const B: Record<string, Row[]> = {
    A: [[0, 0, 2], [10000, 200, 4.5], [50000, 2000, 5.5], [100000, 4750, 6], [200000, 10750, 6.5], [250000, 14000, 6.9], [500000, 31250, 6.99]],
    B: [[0, 0, 2], [16000, 320, 4.5], [80000, 3200, 5.5], [160000, 7600, 6], [320000, 17200, 6.5], [400000, 22400, 6.9], [800000, 50000, 6.99]],
    C: [[0, 0, 2], [20000, 400, 4.5], [100000, 4000, 5.5], [200000, 9500, 6], [400000, 21500, 6.5], [500000, 28000, 6.9], [1000000, 62500, 6.99]],
  };
  const g = brk(B[code === 'B' || code === 'C' ? code : 'A'], ti);
  const add = code === 'B' ? ctSteps(ti, 78500, 4000, 40, 400) : code === 'C' ? ctSteps(ti, 100500, 5000, 50, 500) : code === 'F' ? ctSteps(ti, 56500, 5000, 25, 250) : ctSteps(ti, 50250, 2500, 25, 250);
  const rec = ctRecapture(code === 'B' || code === 'C' ? code : 'A', s);
  const total = g + add + rec; return Math.max(0, total - total * ctCredit(code === 'D' ? '' : code, s));
}

// ── Arkansas: truncated to the $100 below and $50 added (under $100,001), the table's "less" amount, credits ──
function arTax(annual: number, ex: number): number {
  let net = Math.max(0, annual - 2470); if (net < 100001) net = Math.floor(net / 100) * 100 + 50;
  const rows: [number, number, number][] = [[0, 0, 0], [5600, 2, 111.98], [11200, 3, 223.97], [16000, 3.4, 287.97], [26400, 3.7, 367.16]];
  let rate = 0, less = 0; for (const [over, r, l] of rows) if (net > over) { rate = r; less = l; }
  if (net > 94701) less = net > 97601 ? 79.90 : r2(369.90 - 10 * Math.floor((net - 94701) / 100));
  const gross = Math.round(Math.max(0, net * rate / 100 - less));
  return Math.max(0, gross - 29 * ex);
}

// ── Oregon: the federal tax off first (up to a limit that phases out), then the table, less $263 an allowance ──
function orTax(x: CalcIn): number {
  const married = x.f.status === 'married'; const allow = cnt(x.f.allowances); const big = married || allow >= 3; const a = x.annual;
  const capAt = (lo: number) => (a < lo ? 8750 : a < lo + (married ? 10000 : 5000) ? 7000 : a < lo + (married ? 20000 : 10000) ? 5250 : a < lo + (married ? 30000 : 15000) ? 3500 : a < lo + (married ? 40000 : 20000) ? 1750 : 0);
  const base = Math.max(0, a - Math.min(x.fedAnnual, capAt(married ? 250000 : 125000)) - (big ? 5820 : 2910));
  const t = a < 50000
    ? (big ? (base < 9100 ? 263 + base * 0.0475 : base < 22800 ? 695 + (base - 9100) * 0.0675 : 1620 + (base - 22800) * 0.0875)
      : (base < 4550 ? 263 + base * 0.0475 : base < 11400 ? 479 + (base - 4550) * 0.0675 : 941 + (base - 11400) * 0.0875))
    : (big ? (base < 250000 ? 1357 + (base - 22800) * 0.0875 : 21237 + (base - 250000) * 0.099)
      : (base < 125000 ? 678 + (base - 11400) * 0.0875 : 10618 + (base - 125000) * 0.099));
  const less = married ? (a > 200000 ? Math.min(allow, 2) : 0) : (a > 100000 ? Math.min(allow, 1) : 0);
  return Math.max(0, t - 263 * Math.max(0, allow - less));
}

// ── New York: State, New York City and Yonkers ──
function nyState(annual: number, married: boolean, allow: number): number {
  const net = Math.max(0, annual - (married ? 7950 : 7400) - 1000 * allow);
  if (net >= (married ? 2155350 : 1077550)) return net * (net >= 25000000 ? 0.117 : net >= 5000000 ? 0.111 : 0.1045);
  return brk(married
    ? [[0, 0, 3.9], [8500, 332, 4.4], [11700, 472, 5.15], [13900, 586, 5.4], [80650, 4190, 5.9], [96800, 5143, 6.57], [107650, 5855, 7.07], [157650, 9388, 8.01], [211550, 13708, 6.4], [323200, 20854, 13.49], [373200, 27600, 7.35], [1077550, 79369, 7.65]]
    : [[0, 0, 3.9], [8500, 332, 4.4], [11700, 472, 5.15], [13900, 586, 5.4], [80650, 4190, 5.9], [96800, 5143, 7.03], [107650, 5906, 7.53], [157650, 9673, 6.4], [215400, 13369, 11.44], [265400, 19091, 7.35]], net);
}
const nycTax = (annual: number, married: boolean, allow: number) => brk([[0, 0, 2.05], [8000, 164, 2.8], [8700, 184, 3.25], [15000, 388, 3.95], [25000, 783, 4.15], [60000, 2236, 4.25]], Math.max(0, annual - (married ? 5500 : 5000) - 1000 * allow));

// ── Every state ──
const S: StateSpec[] = [
  { code: 'AL', localNote: 'Some Alabama cities, such as Birmingham, charge an occupational tax: add yours.', name: 'Alabama', supplemental: 5,
    form: { name: 'A-4', fields: ['status', 'additional', 'extra'], none: 'No personal exemption, no dependents', labels: { additional: 'Dependents' },
      statuses: [{ v: 'zero', label: 'No personal exemption (0)' }, { v: 'single', label: 'Single (S)' }, { v: 'mfs', label: 'Married filing separately (MS)' }, { v: 'married', label: 'Married (M)' }, { v: 'hoh', label: 'Head of family (H)' }] },
    calc: (x) => {
      const a = x.annual; const st = x.f.status || 'zero'; const steps = (top: number, low: number, from: number, step: number, width: number) => (a <= from ? top : Math.max(low, top - Math.ceil((a - from) / width) * step));
      const std = st === 'married' ? steps(8500, 5000, 25999.99, 175, 500) : st === 'hoh' ? steps(5200, 2500, 25999.99, 135, 500) : st === 'mfs' ? steps(4250, 2500, 12999.99, 88, 250) : steps(3000, 2500, 25999.99, 25, 500);
      const personal = st === 'zero' ? 0 : st === 'married' || st === 'hoh' ? 3000 : 1500;
      const dep = cnt(x.f.additional) * (a <= 50000 ? 1000 : a <= 100000 ? 500 : 300);
      const ti = Math.max(0, a - std - x.fedAnnual - personal - dep);
      return st === 'married' ? brk([[0, 0, 2], [1000, 20, 4], [6000, 220, 5]], ti) : brk([[0, 0, 2], [500, 10, 4], [3000, 110, 5]], ti);
    },
    sui: { base: 8000, newRate: 2.7, agency: 'Alabama Department of Labor', report: 'UC-CR4' },
    filing: { agency: 'Alabama Department of Revenue', deposit: 'A-6', quarterly: 'A-1', annual: 'A-3', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'annually'] },
    bank: { revenue: 'AL(ABAMA)? (DEPT? OF )?REV|ALDOR|MY ALABAMA TAXES', ui: 'AL(ABAMA)? (DEPT? OF )?LABOR|ADOL' } },
  { code: 'AK', name: 'Alaska', noTax: true, supplemental: 0,
    sui: { base: 54200, newRate: 1.0, agency: 'Alaska Department of Labor', report: 'TQ01C' },
    programs: [{ id: 'ak_ui_ee', name: 'Alaska unemployment, employee share', short: 'the employee share', employee: 0.5, base: 54200, paid: 'ui' }],
    bank: { revenue: '^$', ui: 'ALASKA (DEPT? OF )?LABOR|AK DOL' } },
  { code: 'AZ', name: 'Arizona', supplemental: 'regular',
    form: { name: 'A-4', fields: ['rate', 'extra', 'exempt'], rates: [0.5, 1, 1.5, 2, 2.5, 3, 3.5], none: '2.0% of wages', labels: { rate: 'Percentage of wages' } },
    calc: (x) => x.annual * (n0(x.f.rate) > 0 ? Math.min(3.5, n0(x.f.rate)) : 2) / 100,
    sui: { base: 8000, newRate: 2.0, agency: 'Arizona Department of Economic Security', report: 'UC-018' },
    filing: { agency: 'Arizona Department of Revenue', deposit: 'A1-WP', quarterly: 'A1-QRT', annual: 'A1-R', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'semiweekly', 'quarterly'] },
    bank: { revenue: 'AZ(DOR)? DEPT? OF REV|ARIZONA (DEPT? OF )?REV|AZTAXES', ui: 'AZ ?DES|ARIZONA DES|ARIZONA (DEPT? OF )?ECON' } },
  { code: 'AR', name: 'Arkansas', supplemental: 3.7,
    form: { name: 'AR4EC', fields: ['allowances', 'extra', 'exempt'], none: 'No exemptions', labels: { allowances: 'Exemptions' } },
    calc: (x) => arTax(x.annual, cnt(x.f.allowances)),
    sui: { base: 7000, newRate: 2.0, agency: 'Arkansas Division of Workforce Services', report: 'DWS-ARK-209B' },
    filing: { agency: 'Arkansas Department of Finance and Administration', deposit: 'AR941M', quarterly: 'AR941M', annual: 'AR-3MAR', annualDue: '02-28', monthlyDue: 15, frequencies: ['monthly'] },
    bank: { revenue: 'ARKANSAS (DFA|DEPT? OF FIN)|AR DFA|ATAP', ui: 'ARKANSAS (DWS|WORKFORCE)|AR DWS' } },
  { code: 'CA', name: 'California', supplemental: 6.6,
    form: { name: 'DE 4', fields: ['status', 'allowances', 'additional', 'extra', 'exempt'], none: 'Single, no allowances', statuses: ST3,
      labels: { allowances: 'Regular allowances', additional: 'Additional allowances for estimated deductions' } },
    calc: (x) => {
      const st = x.f.status === 'married' ? 'married' : x.f.status === 'hoh' ? 'hoh' : 'single'; const reg = cnt(x.f.allowances); const two = st === 'hoh' || (st === 'married' && reg >= 2);
      if (x.annual <= (two ? 37791 : 18896)) return 0;
      const ti = Math.max(0, x.annual - 1000 * cnt(x.f.additional) - (two ? 11412 : 5706));
      const rows: Record<string, Row[]> = {
        single: [[0, 0, 1.1], [11079, 121.87, 2.2], [26264, 455.94, 4.4], [41452, 1124.21, 6.6], [57542, 2186.15, 8.8], [72724, 3522.17, 10.23], [371479, 34084.81, 11.33], [445771, 42502.09, 12.43], [742953, 79441.81, 13.53], [1000000, 114220.27, 14.63]],
        married: [[0, 0, 1.1], [22158, 243.74, 2.2], [52528, 911.88, 4.4], [82904, 2248.42, 6.6], [115084, 4372.30, 8.8], [145448, 7044.33, 10.23], [742958, 68169.60, 11.33], [891542, 85004.17, 12.43], [1000000, 98485.50, 13.53], [1485906, 164228.58, 14.63]],
        hoh: [[0, 0, 1.1], [22173, 243.90, 2.2], [52530, 911.75, 4.4], [67716, 1579.93, 6.6], [83805, 2641.80, 8.8], [98990, 3978.08, 10.23], [505208, 45534.18, 11.33], [606251, 56982.35, 12.43], [1000000, 105925.35, 13.53], [1010417, 107334.77, 14.63]],
      };
      return Math.max(0, brk(rows[st], ti) - 168.30 * reg);
    },
    sui: { base: 7000, newRate: 3.4, agency: 'California EDD', report: 'DE 9C', note: 'with the 0.1% employment training tax (ETT)' },
    programs: [{ id: 'ca_sdi', name: 'California State Disability Insurance (SDI)', short: 'SDI', employee: 1.3, base: null, paid: 'withholding' }],
    filing: { agency: 'California EDD', deposit: 'DE 88', quarterly: 'DE 9', annual: null, annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'semiweekly', 'quarterly'] },
    bank: { revenue: 'EDD|EMPLOYMENT DEVELOPMENT|CA EDD|CALIF? EDD', ui: 'EDD|EMPLOYMENT DEVELOPMENT' } },
  { code: 'CO', localNote: 'Denver, Aurora and a few other cities charge a monthly occupational privilege tax: add yours.', name: 'Colorado', supplemental: 4.4, round: 'dollar',
    form: { name: 'DR 0004', federal: true, fields: ['amount', 'extra', 'exempt'], none: 'By the federal W-4’s status', labels: { amount: 'Line 2: the Colorado allowance, a year (leave empty without a DR 0004)' } },
    calc: (x) => Math.max(0, x.annual - (n0(x.f.amount) > 0 ? n0(x.f.amount) : x.fedStatus === 'married' ? 11000 : 5500)) * 0.044,
    sui: { base: 30600, newRate: 3.05, agency: 'Colorado Department of Labor and Employment', report: 'UITR-1' },
    programs: [{ id: 'co_famli', name: 'Colorado FAMLI paid leave', employee: 0.44, employer: 0.44, base: 184500, paid: QTR, tiers: [{ below: 10, employee: 0.44, employer: 0 }], note: 'With 9 or fewer employees, only the employee half is paid.' }],
    filing: { agency: 'Colorado Department of Revenue', deposit: 'DR 1094', quarterly: 'DR 1094', annual: 'DR 1093', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly'] },
    bank: { revenue: 'COLORADO (DEPT? OF )?REV|CO DOR|REVENUE ONLINE', ui: 'CDLE|COLORADO (DEPT? OF )?LABOR|MYUI EMPLOYER|FAMLI' } },
  { code: 'CT', name: 'Connecticut', supplemental: 'regular',
    form: { name: 'CT-W4', fields: ['code', 'reduce', 'extra'], none: '6.99% of all wages, until a CT-W4 is on file', labels: { code: 'Withholding code', reduce: 'Line 3: less each paycheck' },
      codes: [{ v: 'A', label: 'A: married filing separately, or single with a spouse’s income' }, { v: 'B', label: 'B: head of household' }, { v: 'C', label: 'C: married filing jointly' }, { v: 'D', label: 'D: no exemption' }, { v: 'E', label: 'E: no withholding needed' }, { v: 'F', label: 'F: single' }] },
    calc: (x) => (x.f.code ? ctTax(String(x.f.code), x.annual) : x.annual * 0.0699),
    sui: { base: 27000, newRate: 1.9, agency: 'Connecticut Department of Labor', report: 'UC-2' },
    programs: [{ id: 'ct_pfml', name: 'Connecticut Paid Leave', employee: 0.5, base: 184500, paid: QTR }],
    filing: { agency: 'Connecticut Department of Revenue Services', deposit: 'CT-WH', quarterly: 'CT-941', annual: 'CT-W3', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'weekly'] },
    bank: { revenue: 'CT (DEPT? OF )?REV|CT DRS|CONNECTICUT (DRS|DEPT? OF REV)|MYCONNECTICUT', ui: 'CT DOL|CONNECTICUT (DOL|DEPT? OF LABOR)|CT PAID LEAVE' } },
  { code: 'DE', localNote: 'Wilmington taxes earnings at 1.25%: add it if your team works there.', name: 'Delaware', supplemental: 'regular',
    form: { name: 'DE W-4', fields: ['status', 'allowances', 'extra', 'exempt'], none: 'Single, no exemptions', labels: { allowances: 'Exemptions' },
      statuses: [{ v: 'single', label: 'Single' }, { v: 'married', label: 'Married filing jointly' }, { v: 'mfs', label: 'Married filing separately' }] },
    calc: (x) => Math.max(0, brk([[0, 0, 0], [2000, 0, 2.2], [5000, 66, 3.9], [10000, 261, 4.8], [20000, 741, 5.2], [25000, 1001, 5.55], [60000, 2943.50, 6.6]], Math.max(0, x.annual - (x.f.status === 'married' ? 6500 : 3250))) - 110 * cnt(x.f.allowances)),
    sui: { base: 14500, newRate: 1.0, agency: 'Delaware Department of Labor', report: 'UC-8' },
    programs: [{ id: 'de_pfml', name: 'Delaware Paid Leave', employee: 0.4, employer: 0.4, base: 184500, paid: QTR, tiers: [{ below: 10, off: true }, { below: 25, employee: 0.16, employer: 0.16 }], note: 'Nine or fewer employees: not covered. 10 to 24: parental leave only (0.32% in all).' }],
    filing: { agency: 'Delaware Division of Revenue', deposit: 'WTH', quarterly: 'WTH', annual: 'W-3', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly'] },
    bank: { revenue: 'DELAWARE (DIV(ISION)? OF )?REV|DE DOR', ui: 'DELAWARE (DEPT? OF )?LABOR|DE DOL' } },
  { code: 'DC', name: 'District of Columbia', supplemental: 'regular',
    form: { name: 'D-4', fields: ['allowances', 'extra', 'exempt'], none: 'No allowances' },
    calc: (x) => brk([[0, 0, 4], [10000, 400, 6], [40000, 2200, 6.5], [60000, 3500, 8.5], [250000, 19650, 9.25], [500000, 42775, 9.75], [1000000, 91525, 10.75]], Math.max(0, x.annual - 4300 * cnt(x.f.allowances))),
    sui: { base: 9000, newRate: 2.7, agency: 'DC Department of Employment Services', report: 'UC-30' },
    programs: [{ id: 'dc_pfl', name: 'DC Paid Family Leave', employer: 0.75, base: null, paid: QTR }],
    filing: { agency: 'DC Office of Tax and Revenue', deposit: 'FR-900M', quarterly: 'FR-900Q', annual: 'FR-900A', annualDue: '01-31', monthlyDue: 20, frequencies: ['monthly', 'quarterly', 'annually'], quarterlyDue: 20 },
    bank: { revenue: 'DC (OTR|TREAS)|D\\.?C\\.? OFFICE OF TAX|MYTAX ?DC', ui: 'DC DOES|DEPT? OF EMPLOYMENT SERV' } },
  { code: 'FL', name: 'Florida', noTax: true, supplemental: 0, sui: { base: 7000, newRate: 2.7, agency: 'Florida Department of Revenue', report: 'RT-6' }, bank: { revenue: '^$', ui: 'FL(ORIDA)? (DEPT? OF )?REV|FLDOR' } },
  { code: 'GA', name: 'Georgia', supplemental: 'regular',
    form: { name: 'G-4', fields: ['status', 'allowances', 'extra', 'exempt'], none: 'Single, no allowances', labels: { allowances: 'Dependents and additional allowances' },
      statuses: [{ v: 'single', label: 'Single, or head of household' }, { v: 'mfs', label: 'Married filing separately, or jointly with both working' }, { v: 'married', label: 'Married filing jointly, one working' }] },
    calc: (x) => Math.max(0, x.annual - (x.f.status === 'married' ? 30000 : 15000) - 5000 * cnt(x.f.allowances)) * 0.0499,
    sui: { base: 9500, newRate: 2.7, agency: 'Georgia Department of Labor', report: 'DOL-4N' },
    filing: { agency: 'Georgia Department of Revenue', deposit: 'GA-V', quarterly: 'G-7', annual: 'G-1003', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'semiweekly', 'quarterly'] },
    bank: { revenue: 'GA(DOR| DEPT? OF REV)|GEORGIA (DEPT? OF )?REV|GTC', ui: 'GA DOL|GEORGIA (DEPT? OF )?LABOR' } },
  { code: 'HI', name: 'Hawaii', supplemental: 'regular',
    form: { name: 'HW-4', fields: ['status', 'allowances', 'extra'], none: 'Single, no allowances', statuses: [{ v: 'single', label: 'Single, or head of household' }, { v: 'married', label: 'Married' }, { v: 'disabled', label: 'Certified disabled person' }] },
    calc: (x) => (x.f.status === 'disabled' ? 0 : brk(x.f.status === 'married'
      ? [[0, 0, 1.4], [19200, 269, 3.2], [28800, 576, 5.5], [38400, 1104, 6.4], [48000, 1718, 6.8], [72000, 3350, 7.2], [96000, 5078, 7.6], [250000, 16782, 7.9]]
      : [[0, 0, 1.4], [9600, 134, 3.2], [14400, 288, 5.5], [19200, 552, 6.4], [24000, 859, 6.8], [36000, 1675, 7.2], [48000, 2539, 7.6], [125000, 8391, 7.9]], Math.max(0, x.annual - 1144 * cnt(x.f.allowances) - 4350))),
    sui: { base: 64500, newRate: 2.4, agency: 'Hawaii Department of Labor', report: 'UC-B6' },
    programs: [{ id: 'hi_tdi', name: 'Hawaii temporary disability (employee part)', employee: 0.5, weeklyMax: 7.5, base: null, paid: 'carrier', defaultOff: true, note: 'Up to half your policy’s premium, and never more than 0.5% of pay or $7.50 a week: turn it on with the rate from your policy.' }],
    filing: { agency: 'Hawaii Department of Taxation', deposit: 'HW-14', quarterly: 'HW-14', annual: 'HW-3', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'semiweekly'], quarterlyDue: 15 },
    bank: { revenue: 'HAWAII (DEPT? OF )?TAX|HI DOTAX|HITAX', ui: 'HAWAII (DLIR|DEPT? OF LABOR)|HI DLIR' } },
  { code: 'ID', name: 'Idaho', supplemental: 5.3, round: 'dollar',
    form: { name: 'ID W-4', fields: ['status', 'extra', 'exempt'], none: 'Single', statuses: ST },
    calc: (x) => Math.max(0, x.annual - (x.f.status === 'married' ? 32200 : 16100)) * 0.053,
    sui: { base: 58300, newRate: 1.0, agency: 'Idaho Department of Labor', report: 'TAX020' },
    filing: { agency: 'Idaho State Tax Commission', deposit: '910', quarterly: '910', annual: '967', annualDue: '01-31', monthlyDue: 20, frequencies: ['monthly', 'quarterly', 'semimonthly', 'annually'], semimonthly: 'id' },
    bank: { revenue: 'IDAHO (STATE )?TAX|ID STC|TAP IDAHO', ui: 'IDAHO (DEPT? OF )?LABOR|ID DOL' } },
  { code: 'IL', name: 'Illinois', supplemental: 4.95,
    form: { name: 'IL-W-4', fields: ['allowances', 'additional', 'extra', 'exempt'], none: 'No allowances', labels: { allowances: 'Line 1: basic allowances', additional: 'Line 2: additional allowances' } },
    calc: (x) => Math.max(0, x.annual - 2925 * cnt(x.f.allowances) - 1000 * cnt(x.f.additional)) * 0.0495,
    sui: { base: 14250, newRate: 3.35, agency: 'Illinois Department of Employment Security', report: 'UI-3/40' },
    filing: { agency: 'Illinois Department of Revenue', deposit: 'IL-501', quarterly: 'IL-941', annual: null, annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'semiweekly'] },
    bank: { revenue: 'IL(LINOIS)? (DEPT? OF )?REV|IDOR|MYTAX ?ILLINOIS', ui: 'IDES|ILLINOIS (DEPT? OF )?EMPLOYMENT' } },
  { code: 'IN', name: 'Indiana', supplemental: 2.95,
    form: { name: 'WH-4', fields: ['allowances', 'additional', 'local', 'extra'], none: 'No exemptions, no county', locals: IN_COUNTIES, labels: { allowances: 'Personal exemptions', additional: 'Dependent exemptions', local: 'County lived in on January 1 (or worked in, living out of state)' } },
    calc: (x) => { const ti = Math.max(0, x.annual - 1000 * cnt(x.f.allowances) - 1500 * cnt(x.f.additional)); return ti * (2.95 + (IN_RATE[x.f.local || ''] || 0)) / 100; },
    sui: { base: 9500, newRate: 2.5, agency: 'Indiana Department of Workforce Development', report: 'UC-1/UC-5A' },
    filing: { agency: 'Indiana Department of Revenue', deposit: 'WH-1', quarterly: 'WH-1', annual: 'WH-3', annualDue: '01-31', monthlyDue: 20, frequencies: ['monthly', 'quarterly', 'annually'] },
    bank: { revenue: 'INDIANA (DEPT? OF )?REV|IN DOR|INTIME', ui: 'INDIANA (DWD|WORKFORCE)|IN DWD|UPLINK' } },
  { code: 'IA', name: 'Iowa', supplemental: 3.8,
    form: { name: 'IA W-4', fields: ['code', 'allowances', 'extra', 'exempt'], none: 'Letter A, no allowances', labels: { code: 'Filing status', allowances: 'Allowances' },
      codes: [{ v: 'A', label: 'Single, or married with a spouse who earns' }, { v: 'B', label: 'Head of household' }, { v: 'C', label: 'Married filing jointly, spouse doesn’t earn' }] },
    calc: (x) => Math.max(0, Math.max(0, x.annual - (x.f.code === 'C' ? 26000 : x.f.code === 'B' ? 19500 : 13000)) * 0.038 - 40 * cnt(x.f.allowances)),
    sui: { base: 20400, newRate: 1.0, agency: 'Iowa Workforce Development', report: '65-5300' },
    filing: { agency: 'Iowa Department of Revenue', deposit: '44-095', quarterly: '44-095', annual: 'VSP', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'semimonthly', 'quarterly'] },
    bank: { revenue: 'IOWA (DEPT? OF )?REV|IA DOR|GOVCONNECT ?IOWA', ui: 'IOWA WORKFORCE|IWD' } },
  { code: 'KS', name: 'Kansas', supplemental: 5,
    form: { name: 'K-4', fields: ['status', 'allowances', 'extra', 'exempt'], none: 'Single, no allowances', statuses: [{ v: 'single', label: 'Single, or head of household' }, { v: 'married', label: 'Married' }] },
    calc: (x) => {
      const m = x.f.status === 'married'; const a = cnt(x.f.allowances); const personal = m ? (a >= 2 ? 18320 : a === 1 ? 9160 : 0) : (a >= 1 ? 9160 : 0);
      const ti = Math.max(0, x.annual - personal - 2320 * Math.max(0, a - (m ? 2 : 1)));
      return m ? brk([[0, 0, 0], [8240, 0, 5.2], [54240, 2392, 5.58]], ti) : brk([[0, 0, 0], [3605, 0, 5.2], [26605, 1196, 5.58]], ti);
    },
    sui: { base: 15100, newRate: 1.75, agency: 'Kansas Department of Labor', report: 'K-CNS 100' },
    filing: { agency: 'Kansas Department of Revenue', deposit: 'KW-5', quarterly: 'KW-5', annual: 'KW-3', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'semimonthly', 'annually'] },
    bank: { revenue: 'KANSAS (DEPT? OF )?REV|KS DOR|KDOR', ui: 'KANSAS (DEPT? OF )?LABOR|KDOL' } },
  { code: 'KY', localNote: 'Kentucky cities and counties charge an occupational license tax: add yours.', name: 'Kentucky', supplemental: 3.5,
    form: { name: 'K-4', fields: ['extra', 'exempt'], none: 'The standard deduction' },
    calc: (x) => Math.max(0, x.annual - 3360) * 0.035,
    sui: { base: 12000, newRate: 2.7, agency: 'Kentucky Office of Unemployment Insurance', report: 'UI-3' },
    filing: { agency: 'Kentucky Department of Revenue', deposit: 'K-1', quarterly: 'K-1', annual: 'K-5', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'semimonthly', 'annually'] },
    bank: { revenue: 'KY (DEPT? OF )?REV|KENTUCKY (DEPT? OF )?REV|KY STATE TREAS', ui: 'KY (OUI|UI)|KENTUCKY UNEMPLOYMENT|KY OFFICE OF UNEMP' } },
  { code: 'LA', name: 'Louisiana', supplemental: 3.09,
    form: { name: 'L-4', fields: ['status', 'allowances', 'reduce', 'extra', 'exempt'], none: 'Single, no standard deduction claimed', statuses: [{ v: 'single', label: 'Single' }, { v: 'married', label: 'Married, or head of household' }],
      labels: { allowances: 'Standard deductions claimed (0, 1 or 2)', reduce: 'Less each paycheck' } },
    calc: (x) => { const c = cnt(x.f.allowances); const sd = c <= 0 ? 0 : x.f.status === 'married' && c >= 2 ? 25750 : 12875; return Math.max(0, x.annual - sd) * 0.0309; },
    sui: { base: 7000, newRate: null, agency: 'Louisiana Workforce Commission', report: 'LWC ES-4' },
    filing: { agency: 'Louisiana Department of Revenue', deposit: 'L-1', quarterly: 'L-1', annual: 'L-3', annualDue: '01-31', monthlyDue: 'last', frequencies: ['monthly', 'quarterly', 'semimonthly'] },
    bank: { revenue: 'LA(\\.)? (DEPT? OF )?REV|LOUISIANA (DEPT? OF )?REV|LDR', ui: 'LWC|LOUISIANA WORKFORCE' } },
  { code: 'ME', name: 'Maine', supplemental: 5, round: 'dollar',
    form: { name: 'W-4ME', fields: ['status', 'allowances', 'extra', 'exempt'], none: 'Single, no allowances', statuses: ST },
    calc: (x) => {
      const m = x.f.status === 'married'; const a = x.annual;
      const std = m ? (a <= 204550 ? 28550 : a < 354550 ? ((354550 - a) / 150000) * 28550 : 0) : (a <= 102250 ? 12850 : a < 177250 ? ((177250 - a) / 75000) * 12850 : 0);
      const ti = Math.max(0, a - std - 5300 * cnt(x.f.allowances));
      return brk(m ? [[0, 0, 5.8], [54850, 3181, 6.75], [129750, 8237, 7.15], [1500000, 106210, 9.15]] : [[0, 0, 5.8], [27400, 1589, 6.75], [64850, 4117, 7.15], [1000000, 70980, 9.15]], ti);
    },
    sui: { base: 12000, newRate: 2.54, agency: 'Maine Department of Labor', report: 'ME UC-1' },
    programs: [{ id: 'me_pfml', name: 'Maine Paid Family and Medical Leave', employee: 0.5, employer: 0.5, base: 184500, paid: QTR, tiers: [{ below: 15, employee: 0.5, employer: 0 }], note: 'Fewer than 15 employees: 0.5% in all, which may all come from pay.' }],
    filing: { agency: 'Maine Revenue Services', deposit: '900ME', quarterly: '941ME', annual: 'W-3ME', annualDue: '02-28', monthlyDue: 15, frequencies: ['quarterly', 'semiweekly'] },
    bank: { revenue: 'MAINE REV|ME REVENUE|MAINE REVENUE SERV', ui: 'MAINE (DEPT? OF )?LABOR|ME DOL|MAINE PFML' } },
  { code: 'MD', name: 'Maryland', supplemental: 6.5,
    form: { name: 'MW507', fields: ['status', 'allowances', 'local', 'extra', 'exempt'], none: 'Single, no exemptions', locals: MD_COUNTIES, labels: { allowances: 'Exemptions', local: 'County lived in' },
      statuses: [{ v: 'single', label: 'Single, or married filing separately' }, { v: 'married', label: 'Married filing jointly, or head of household' }] },
    calc: (x) => {
      if (x.annual < 5000) return 0; const m = x.f.status === 'married';
      const ti = Math.max(0, x.annual - 3400 - 3200 * cnt(x.f.allowances));
      const state = brk(m ? [[0, 0, 4.75], [150000, 7125, 5], [175000, 8375, 5.25], [225000, 11000, 5.5], [300000, 15125, 5.75], [600000, 32375, 6.25], [1200000, 69875, 6.5]]
        : [[0, 0, 4.75], [100000, 4750, 5], [125000, 6000, 5.25], [150000, 7312.5, 5.5], [250000, 12812.5, 5.75], [500000, 27187.5, 6.25], [1000000, 58437.5, 6.5]], ti);
      return state + mdCounty(x.f.local, m, ti);
    },
    sui: { base: 8500, newRate: 2.6, agency: 'Maryland Division of Unemployment Insurance', report: 'quarterly wage report' },
    filing: { agency: 'Comptroller of Maryland', deposit: 'MW506', quarterly: 'MW506', annual: 'MW508', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'semiweekly', 'annually'] },
    bank: { revenue: 'COMPTROLLER OF (THE TREAS(URY)? )?MARYLAND|COMPTROLLER OF MD|MD COMPTROLLER', ui: 'MD (DOL|LABOR)|MARYLAND (DEPT? OF )?LABOR|MD DUI|BEACON' } },
  { code: 'MA', name: 'Massachusetts', supplemental: 5,
    form: { name: 'M-4', fields: ['allowances', 'flag', 'additional', 'extra', 'exempt'], none: 'No exemptions', labels: { allowances: 'Exemptions', flag: 'Head of household', additional: 'Blind exemptions (them, or a spouse)' } },
    calc: (x) => {
      const e = cnt(x.f.allowances); if (e >= 1 && x.annual < 8000) return 0;
      const fica = Math.min(x.ficaNow, Math.max(0, 2000 - x.ficaYtd)) * x.periods;
      const ti = Math.max(0, x.annual - fica - (e === 0 ? 0 : e === 1 ? 4400 : 1000 * e + 3400));
      const t = ti > 1107750 ? 55387.5 + (ti - 1107750) * 0.09 : ti * 0.05;
      return Math.max(0, t - (x.f.flag ? 120 : 0) - 110 * cnt(x.f.additional));
    },
    sui: { base: 15000, newRate: 2.42, agency: 'Massachusetts Department of Unemployment Assistance', report: 'quarterly employment and wage detail report', note: 'with the workforce training fund (0.056%)' },
    programs: [{ id: 'ma_pfml', name: 'Massachusetts Paid Family and Medical Leave', employee: 0.46, employer: 0.42, base: 184500, paid: QTR, tiers: [{ below: 25, employee: 0.46, employer: 0 }], note: 'Under 25 employees: 0.46%, all from pay. 25 or more: 0.88% in all, the business pays 0.42%.' }],
    filing: { agency: 'Massachusetts Department of Revenue', deposit: 'M-941', quarterly: 'M-941', annual: 'M-3', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'annually'] },
    bank: { revenue: 'MASS(ACHUSETTS)? (DEPT? OF )?REV|MA DOR|MASSTAXCONNECT', ui: 'MASS(ACHUSETTS)? DUA|MA DUA|MA PFML|DFML' } },
  { code: 'MI', localNote: 'Some Michigan cities, such as Detroit, Grand Rapids and Lansing, tax income: add yours.', name: 'Michigan', supplemental: 4.25,
    form: { name: 'MI-W4', fields: ['allowances', 'extra', 'exempt'], none: 'No exemptions', labels: { allowances: 'Exemptions' } },
    calc: (x) => Math.max(0, x.annual - 5900 * cnt(x.f.allowances)) * 0.0425,
    sui: { base: 9000, newRate: 2.7, agency: 'Michigan Unemployment Insurance Agency', report: 'UIA 1028' },
    filing: { agency: 'Michigan Department of Treasury', deposit: '5080', quarterly: '5080', annual: '5081', annualDue: '02-28', monthlyDue: 20, frequencies: ['monthly', 'quarterly'], quarterlyDue: 20 },
    bank: { revenue: 'MI(CHIGAN)? (DEPT? OF )?TREAS|STATE OF MICHIGAN TREAS|MTO', ui: 'MI(CHIGAN)? UIA|UNEMPLOYMENT INS(URANCE)? AGENCY' } },
  { code: 'MN', name: 'Minnesota', supplemental: 6.25,
    form: { name: 'W-4MN', fields: ['status', 'allowances', 'extra', 'exempt'], none: 'Single, no allowances', statuses: ST },
    calc: (x) => brk(x.f.status === 'married' ? [[0, 0, 0], [14700, 0, 5.35], [63400, 2605.45, 6.8], [208180, 12450.49, 7.85], [352630, 23789.82, 9.85]]
      : [[0, 0, 0], [4700, 0, 5.35], [38010, 1782.09, 6.8], [114130, 6958.25, 7.85], [207850, 14315.27, 9.85]], Math.max(0, x.annual - 5300 * cnt(x.f.allowances))),
    sui: { base: 44000, newRate: null, agency: 'Minnesota Unemployment Insurance (DEED)', report: 'wage detail report' },
    programs: [{ id: 'mn_pfml', name: 'Minnesota Paid Leave', employee: 0.44, employer: 0.44, base: 184500, paid: QTR, tiers: [{ below: 31, employee: 0.33, employer: 0.33 }], note: 'A small employer (30 or fewer, with average pay under 150% of the state’s) pays 0.66% in all, up to half from pay.' }],
    filing: { agency: 'Minnesota Department of Revenue', deposit: 'withholding deposit', quarterly: 'quarterly return', annual: 'annual reconciliation', annualDue: '02-28', monthlyDue: 15, frequencies: ['monthly', 'semiweekly', 'quarterly', 'annually'] },
    bank: { revenue: 'MN (DEPT? OF )?REV|MINNESOTA (DEPT? OF )?REV|MN REVENUE', ui: 'MN (DEED|UI)|MINNESOTA (DEED|UNEMPLOYMENT)|MN PAID LEAVE' } },
  { code: 'MS', name: 'Mississippi', supplemental: 4, round: 'dollar',
    form: { name: '89-350', fields: ['status', 'additional', 'extra', 'exempt'], none: 'Single, no exemptions', labels: { additional: 'Dependents' },
      statuses: [{ v: 'single', label: 'Single' }, { v: 'married', label: 'Married, spouse not working' }, { v: 'mbw', label: 'Married, both working' }, { v: 'hoh', label: 'Head of family' }] },
    calc: (x) => {
      const st = x.f.status; const std = st === 'married' ? 4600 : st === 'hoh' ? 3400 : 2300; const ex = st === 'married' || st === 'mbw' ? 12000 : st === 'hoh' ? 9500 : st === 'single' ? 6000 : 0;
      return Math.max(0, x.annual - std - ex - 1500 * cnt(x.f.additional) - 10000) * 0.04;
    },
    sui: { base: 14000, newRate: 1.0, agency: 'Mississippi Department of Employment Security', report: 'UI-2/3' },
    filing: { agency: 'Mississippi Department of Revenue', deposit: '89-105', quarterly: '89-105', annual: '89-140', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'annually'] },
    bank: { revenue: 'MS (DEPT? OF )?REV|MISSISSIPPI (DEPT? OF )?REV|TAP MS', ui: 'MDES|MISSISSIPPI (DEPT? OF )?EMPLOYMENT' } },
  { code: 'MO', localNote: 'Kansas City and St. Louis tax earnings at 1%: add it if your team works there.', name: 'Missouri', supplemental: 4.7, round: 'dollar',
    form: { name: 'MO W-4', fields: ['status', 'extra', 'exempt'], none: 'Single',
      statuses: [{ v: 'single', label: 'Single, married filing separately, or married with a spouse who works' }, { v: 'married', label: 'Married, spouse doesn’t work' }, { v: 'hoh', label: 'Head of household' }] },
    calc: (x) => brk([[0, 0, 0], [1348, 0, 2], [2696, 27, 2.5], [4044, 61, 3], [5392, 101, 3.5], [6740, 148, 4], [8088, 202, 4.5], [9436, 263, 4.7]],
      Math.max(0, x.annual - (x.f.status === 'married' ? 32200 : x.f.status === 'hoh' ? 24150 : 16100))),
    sui: { base: 9000, newRate: 2.376, agency: 'Missouri Division of Employment Security', report: 'MODES-4' },
    filing: { agency: 'Missouri Department of Revenue', deposit: 'MO-941', quarterly: 'MO-941', annual: 'MO W-3', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'annually'] },
    bank: { revenue: 'MO(\\.)? (DEPT? OF )?REV|MISSOURI (DEPT? OF )?REV|MODOR', ui: 'MO DES|MISSOURI (DIV(ISION)? OF )?EMPLOYMENT' } },
  { code: 'MT', name: 'Montana', supplemental: 5, round: 'up',
    form: { name: 'MW-4', fields: ['status', 'extra'], none: 'Single',
      statuses: [{ v: 'single', label: 'Single, married filing separately, or married filing jointly with both working' }, { v: 'married', label: 'Married filing jointly, or surviving spouse' }, { v: 'hoh', label: 'Head of household' }] },
    calc: (x) => (x.f.status === 'married' ? brk([[0, 0, 0], [32200, 0, 4.7], [127200, 4465, 5.65]], x.annual) : x.f.status === 'hoh' ? brk([[0, 0, 0], [24150, 0, 4.7], [95400, 3349, 5.65]], x.annual) : brk([[0, 0, 0], [16100, 0, 4.7], [63600, 2233, 5.65]], x.annual)),
    sui: { base: 47300, newRate: null, agency: 'Montana Department of Labor and Industry', report: 'UI-5' },
    filing: { agency: 'Montana Department of Revenue', deposit: 'MW-1', quarterly: 'MW-1', annual: 'MW-3', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'semiweekly', 'annually'] },
    bank: { revenue: 'MONTANA (DEPT? OF )?REV|MT DOR|TAP MONTANA', ui: 'MONTANA (DLI|DEPT? OF LABOR)|MT DLI|MONTANA UI' } },
  { code: 'NE', name: 'Nebraska', supplemental: 3.5,
    form: { name: 'W-4N', fields: ['status', 'allowances', 'flag', 'extra', 'exempt'], none: 'Single, no allowances', statuses: [{ v: 'single', label: 'Single, or head of household' }, { v: 'married', label: 'Married' }],
      labels: { flag: 'Approved by Nebraska for lower withholding' } },
    calc: (x) => {
      const m = x.f.status === 'married'; const rows: Row[] = m ? [[0, 0, 0], [8190, 0, 2.26], [13010, 108.93, 3.22], [32400, 733.29, 4.21], [50400, 1491.09, 4.35], [62530, 2018.75, 4.48], [82920, 2932.22, 4.6]]
        : [[0, 0, 0], [3430, 0, 2.26], [6710, 74.13, 3.22], [21810, 560.35, 4.21], [31610, 972.93, 4.35], [40130, 1343.55, 4.48], [75370, 2922.3, 4.6]];
      const tax = (a: number) => brk(rows, Math.max(0, x.annual - 2440 * a)); const a = cnt(x.f.allowances); const t = tax(a);
      return x.f.flag || a <= (m ? 2 : 1) ? t : Math.max(t, 0.5 * tax(m ? 2 : 1));
    },
    sui: { base: 9000, newRate: 1.25, agency: 'Nebraska Department of Labor', report: 'UI-11T' },
    filing: { agency: 'Nebraska Department of Revenue', deposit: '501N', quarterly: '941N', annual: 'W-3N', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'annually'] },
    bank: { revenue: 'NEBRASKA (DEPT? OF )?REV|NE DOR', ui: 'NEBRASKA (DEPT? OF )?LABOR|NE DOL' } },
  { code: 'NV', name: 'Nevada', noTax: true, supplemental: 0, sui: { base: 43700, newRate: 2.95, agency: 'Nevada Employment Security Division', report: 'NUCS-4072' }, bank: { revenue: '^$', ui: 'NV(ADA)? (ESD|EMPLOYMENT SEC)' } },
  { code: 'NH', name: 'New Hampshire', noTax: true, supplemental: 0, sui: { base: 14000, newRate: 1.7, agency: 'New Hampshire Employment Security', report: 'NHES-0002' }, bank: { revenue: '^$', ui: 'NHES|NEW HAMPSHIRE EMPLOYMENT' } },
  { code: 'NJ', localNote: 'Newark charges businesses a payroll tax: add it if you’re there.', name: 'New Jersey', supplemental: 'regular',
    form: { name: 'NJ-W4', fields: ['status', 'code', 'allowances', 'extra', 'exempt'], none: 'Rate table A, no allowances',
      statuses: [{ v: 'single', label: 'Single, or married filing separately' }, { v: 'married', label: 'Married filing jointly, head of household, or surviving spouse' }],
      codes: [{ v: '', label: 'By filing status' }, { v: 'A', label: 'A' }, { v: 'B', label: 'B' }, { v: 'C', label: 'C' }, { v: 'D', label: 'D' }, { v: 'E', label: 'E' }], labels: { code: 'Rate table (line 3)' } },
    calc: (x) => {
      const t = x.f.code && 'ABCDE'.includes(x.f.code) ? x.f.code : x.f.status === 'married' ? 'B' : 'A';
      const R: Record<string, Row[]> = {
        A: [[0, 0, 1.5], [20000, 300, 2], [35000, 600, 3.9], [40000, 795, 6.1], [75000, 2930, 7], [500000, 32680, 9.9], [1000000, 82180, 11.8]],
        B: [[0, 0, 1.5], [20000, 300, 2], [50000, 900, 2.7], [70000, 1440, 3.9], [80000, 1830, 6.1], [150000, 6100, 7], [500000, 30600, 9.9], [1000000, 80100, 11.8]],
        C: [[0, 0, 1.5], [20000, 300, 2.3], [40000, 760, 2.8], [50000, 1040, 3.5], [60000, 1390, 5.6], [150000, 6430, 6.6], [500000, 29530, 9.9], [1000000, 79030, 11.8]],
        D: [[0, 0, 1.5], [20000, 300, 2.7], [40000, 840, 3.4], [50000, 1180, 4.3], [60000, 1610, 5.6], [150000, 6650, 6.5], [500000, 29400, 9.9], [1000000, 78900, 11.8]],
        E: [[0, 0, 1.5], [20000, 300, 2], [35000, 600, 5.8], [100000, 4370, 6.5], [500000, 30370, 9.9], [1000000, 79870, 11.8]],
      };
      return brk(R[t], Math.max(0, x.annual - 1000 * cnt(x.f.allowances)));
    },
    sui: { base: 44800, newRate: 2.8, agency: 'New Jersey Department of Labor', report: 'WR-30' },
    programs: [
      { id: 'nj_ui_ee', name: 'New Jersey unemployment, employee share', short: 'the employee share', employee: 0.425, base: 44800, paid: 'ui' },
      { id: 'nj_tdi', name: 'New Jersey disability insurance', short: 'disability', employee: 0.19, base: 171100, paid: 'ui' },
      { id: 'nj_fli', name: 'New Jersey family leave insurance', short: 'family leave', employee: 0.23, base: 171100, paid: 'ui' },
      { id: 'nj_tdi_er', name: 'New Jersey disability insurance, employer', short: 'disability', employer: 0.5, base: 44800, paid: 'ui', note: 'The rate on your state notice.' },
    ],
    filing: { agency: 'New Jersey Division of Taxation', deposit: 'NJ-500', quarterly: 'NJ-927', annual: 'NJ-W-3', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'weekly'], quarterlyDue: 30 },
    bank: { revenue: 'NJ (DIV(ISION)? OF )?TAX|NEW JERSEY (DIV(ISION)? OF )?TAX|NJ TREAS', ui: 'NJ (DOL|LABOR)|NEW JERSEY (DEPT? OF )?LABOR|NJ LWD' } },
  { code: 'NM', name: 'New Mexico', supplemental: 5.9,
    form: { name: 'W-4', federal: true, fields: [], none: 'By the federal W-4’s status' },
    calc: (x) => {
      const st = x.f.status || x.fedStatus; const zero = st === 'married' ? 16100 : st === 'hoh' ? 12075 : 8050; const ti = Math.max(0, x.annual - zero);
      return st === 'single' ? brk([[0, 0, 1.5], [5500, 82.5, 3.2], [16500, 434.5, 4.3], [33500, 1165.5, 4.7], [66500, 2716.5, 4.9], [210000, 9748, 5.9]], ti)
        : brk([[0, 0, 1.5], [8000, 120, 3.2], [25000, 664, 4.3], [50000, 1739, 4.7], [100000, 4089, 4.9], [315000, 14624, 5.9]], ti);
    },
    sui: { base: 34800, newRate: 1.0, agency: 'New Mexico Department of Workforce Solutions', report: 'ES-903A' },
    filing: { agency: 'New Mexico Taxation and Revenue Department', deposit: 'CRS (TRD-41414)', quarterly: 'CRS (TRD-41414)', annual: 'RPD-41072', annualDue: '01-31', monthlyDue: 25, frequencies: ['monthly', 'quarterly'] },
    bank: { revenue: 'NM (TAX(ATION)?|TRD)|NEW MEXICO TAX|TAP NM', ui: 'NM (DWS|WORKFORCE)|NEW MEXICO WORKFORCE' } },
  { code: 'NY', name: 'New York', supplemental: 11.7,
    form: { name: 'IT-2104', fields: ['status', 'allowances', 'local', 'extra', 'exempt'], none: 'Single, no allowances',
      statuses: [{ v: 'single', label: 'Single, or head of household' }, { v: 'married', label: 'Married' }],
      locals: [{ v: '', label: 'Lives elsewhere in New York State' }, { v: 'nyc', label: 'Lives in New York City' }, { v: 'yonkers', label: 'Lives in Yonkers' }, { v: 'yonkers_nonresident', label: 'Works in Yonkers, lives elsewhere' }],
      labels: { local: 'Where they live' } },
    calc: (x) => {
      const m = x.f.status === 'married'; const a = cnt(x.f.allowances); const state = nyState(x.annual, m, a);
      return state + (x.f.local === 'nyc' ? nycTax(x.annual, m, a) : x.f.local === 'yonkers' ? state * 0.1675 : x.f.local === 'yonkers_nonresident' ? x.annual * 0.005 : 0);
    },
    sui: { base: 17600, newRate: 4.1, agency: 'New York State Department of Labor', report: 'NYS-45', paidTo: 'either', note: 'with the 0.075% re-employment service fund' },
    programs: [
      { id: 'ny_dbl', name: 'New York disability insurance', employee: 0.5, weeklyMax: 0.6, base: null, paid: 'carrier', note: 'Paid to your insurance company.' },
      { id: 'ny_pfl', name: 'New York Paid Family Leave', employee: 0.432, yearlyMax: 411.91, base: null, paid: 'carrier', note: 'Paid to your insurance company.' },
    ],
    filing: { agency: 'New York State Department of Taxation and Finance', deposit: 'NYS-1', quarterly: 'NYS-45', annual: null, annualDue: '01-31', monthlyDue: 15, frequencies: ['ny5', 'ny3'] },
    bank: { revenue: 'NYS (DTF|TAX)|NY(S)? DEPT? (OF )?TAX|NEW YORK STATE TAX|NYS WITHHOLDING', ui: 'NYS (DOL|LABOR)|NY(S)? DEPT? OF LABOR' } },
  { code: 'NC', name: 'North Carolina', supplemental: 4.09, round: 'dollar',
    form: { name: 'NC-4', fields: ['status', 'allowances', 'extra', 'exempt'], none: 'Single, no allowances', statuses: [{ v: 'single', label: 'Single, or married filing separately' }, { v: 'married', label: 'Married filing jointly, or surviving spouse' }, { v: 'hoh', label: 'Head of household' }] },
    calc: (x) => Math.max(0, x.annual - (x.f.status === 'hoh' ? 19125 : 12750) - 2500 * cnt(x.f.allowances)) * 0.0409,
    sui: { base: 34200, newRate: 1.0, agency: 'North Carolina Division of Employment Security', report: 'NCUI 101' },
    filing: { agency: 'North Carolina Department of Revenue', deposit: 'NC-5', quarterly: 'NC-5', annual: 'NC-3', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'semiweekly'] },
    bank: { revenue: 'NC (DEPT? OF )?REV|NCDOR|NORTH CAROLINA (DEPT? OF )?REV', ui: 'NC ?DES|NORTH CAROLINA (DIV(ISION)? OF )?EMPLOYMENT|EMPLOYMENT SECURITY' } },
  { code: 'ND', name: 'North Dakota', supplemental: 1.5, round: 'dollar',
    form: { name: 'W-4', federal: true, fields: [], none: 'By the federal W-4’s status' },
    calc: (x) => { const st = x.f.status || x.fedStatus; return st === 'married' ? brk([[0, 0, 0], [57500, 0, 1.95], [168525, 2164.99, 2.5]], x.annual) : st === 'hoh' ? brk([[0, 0, 0], [78475, 0, 1.95], [289675, 4118.4, 2.5]], x.annual) : brk([[0, 0, 0], [57625, 0, 1.95], [258450, 3916.09, 2.5]], x.annual); },
    sui: { base: 46600, newRate: 1.0, agency: 'Job Service North Dakota', report: 'SFN 41263' },
    filing: { agency: 'North Dakota Office of State Tax Commissioner', deposit: '306', quarterly: '306', annual: '307', annualDue: '01-31', monthlyDue: 15, frequencies: ['quarterly', 'monthly'] },
    bank: { revenue: 'ND (STATE )?TAX|NORTH DAKOTA (STATE )?TAX', ui: 'JOB SERVICE (ND|NORTH DAKOTA)' } },
  { code: 'OH', localNote: 'Ohio cities and school districts tax income too: add the one where your team works, at its rate.', name: 'Ohio', supplemental: 2.75,
    form: { name: 'IT-4', fields: ['allowances', 'extra', 'exempt'], none: 'No exemptions', labels: { allowances: 'Exemptions' } },
    calc: (x) => brk([[0, 0, 1.6], [26050, 416.8, 2.99], [100000, 2627.91, 3.4]], Math.max(0, x.annual - 650 * cnt(x.f.allowances))),
    sui: { base: 9000, newRate: 2.85, agency: 'Ohio Department of Job and Family Services', report: 'JFS-20125' },
    filing: { agency: 'Ohio Department of Taxation', deposit: 'IT-501', quarterly: 'IT-942', annual: 'IT-941', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly'] },
    bank: { revenue: 'OH(IO)? (DEPT? OF )?TAX|OHIO TREAS|ODT', ui: 'ODJFS|OHIO (DEPT? OF )?JOB' } },
  { code: 'OK', name: 'Oklahoma', supplemental: 4.5, round: 'dollar',
    form: { name: 'OK-W-4', fields: ['status', 'allowances', 'extra', 'exempt'], none: 'Single, no allowances', statuses: [{ v: 'single', label: 'Single, or head of household' }, { v: 'married', label: 'Married' }] },
    calc: (x) => brk(x.f.status === 'married' ? [[0, 0, 0], [20200, 0, 2.5], [22500, 57.5, 3.5], [27100, 218.5, 4.5]] : [[0, 0, 0], [10100, 0, 2.5], [11250, 28.75, 3.5], [13550, 109.25, 4.5]], Math.max(0, x.annual - 1000 * cnt(x.f.allowances))),
    sui: { base: 25000, newRate: 1.5, agency: 'Oklahoma Employment Security Commission', report: 'OES-3' },
    filing: { agency: 'Oklahoma Tax Commission', deposit: 'WTH-10004', quarterly: 'WTH-10001', annual: null, annualDue: '01-31', monthlyDue: 20, frequencies: ['monthly', 'quarterly', 'semiweekly'], quarterlyDue: 20 },
    bank: { revenue: 'OK(LA(HOMA)?)? TAX COMM|OTC|OKTAP', ui: 'OESC|OKLAHOMA EMPLOYMENT' } },
  { code: 'OR', localNote: 'TriMet and Lane County transit taxes are paid by the business: add yours if you’re in their area. The Workers’ Benefit Fund is by the hour worked, so it isn’t worked out here: pay it with your OQ.', name: 'Oregon', supplemental: 8,
    form: { name: 'OR-W-4', fields: ['status', 'allowances', 'extra', 'exempt'], none: 'Single, no allowances', statuses: ST },
    calc: (x) => orTax(x),
    sui: { base: 56700, newRate: 2.4, agency: 'Oregon Employment Department', report: 'OQ', paidTo: 'revenue' },
    programs: [
      { id: 'or_transit', name: 'Oregon statewide transit tax', short: 'transit tax', employee: 0.1, base: null, paid: 'ui' },
      { id: 'or_pfml', name: 'Paid Leave Oregon', employee: 0.6, employer: 0.4, base: 184500, paid: QTR, tiers: [{ below: 25, employee: 0.6, employer: 0 }], note: 'Under 25 employees: no employer part.' },
    ],
    filing: { agency: 'Oregon Department of Revenue', deposit: 'OTC', quarterly: 'OQ', annual: 'WR', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'semiweekly', 'quarterly'] },
    bank: { revenue: 'OR(EGON)? (DEPT? OF )?REV|OR DOR|REVENUE ONLINE', ui: 'OR(EGON)? EMPLOYMENT|OED|PAID LEAVE OREGON|FRANCES' } },
  { code: 'PA', localNote: 'Pennsylvania’s local earned income tax and local services tax: add yours, at the rate where each person lives or works.', name: 'Pennsylvania', supplemental: 3.07,
    form: { name: '', fields: ['extra'], none: '3.07% of wages' },
    calc: (x) => x.annual * 0.0307,
    sui: { base: 10000, newRate: 3.822, agency: 'Pennsylvania Office of Unemployment Compensation', report: 'UC-2' },
    programs: [{ id: 'pa_uc_ee', name: 'Pennsylvania unemployment, employee share', short: 'the employee share', employee: 0.07, base: null, paid: 'ui' }],
    filing: { agency: 'Pennsylvania Department of Revenue', deposit: 'PA-501', quarterly: 'PA-W3', annual: 'REV-1667', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'semimonthly', 'semiweekly', 'quarterly'], semimonthly: 'plus3' },
    bank: { revenue: 'PA (DEPT? OF )?REV|PENNSYLVANIA (DEPT? OF )?REV|PA REVENUE|MYPATH', ui: 'PA (UC|DLI)|PENNSYLVANIA (UC|LABOR)|PA LABOR' } },
  { code: 'RI', name: 'Rhode Island', supplemental: 5.99,
    form: { name: 'RI W-4', fields: ['allowances', 'extra', 'exempt'], none: 'No allowances' },
    calc: (x) => brk([[0, 0, 3.75], [82050, 3076.88, 4.75], [186450, 8035.88, 5.99]], Math.max(0, x.annual - (x.annual > 290800 ? 0 : 1000 * cnt(x.f.allowances)))),
    sui: { base: 30800, newRate: 1.21, agency: 'Rhode Island Department of Labor and Training', report: 'TX-17', paidTo: 'either' },
    programs: [{ id: 'ri_tdi', name: 'Rhode Island temporary disability insurance', short: 'TDI', employee: 1.1, base: 100000, paid: 'ui' }],
    filing: { agency: 'Rhode Island Division of Taxation', deposit: 'RI-941', quarterly: 'RI-941', annual: 'RI-W3', annualDue: '01-31', monthlyDue: 20, frequencies: ['monthly', 'quarterly'] },
    bank: { revenue: 'RI (DIV(ISION)? OF )?TAX|RHODE ISLAND (DIV(ISION)? OF )?TAX', ui: 'RI (DLT|DEPT? OF LABOR)|RHODE ISLAND (DLT|LABOR)' } },
  { code: 'SC', name: 'South Carolina', supplemental: 'regular',
    form: { name: 'SC W-4', fields: ['allowances', 'extra', 'exempt'], none: 'No allowances' },
    calc: (x) => { const a = cnt(x.f.allowances); const ti = Math.max(0, x.annual - (a > 0 ? Math.min(x.annual * 0.1, 7500) + 5000 * a : 0)); return ti <= 3640 ? 0 : ti < 18230 ? ti * 0.03 - 109.2 : ti * 0.06 - 656.1; },
    sui: { base: 14000, newRate: 1.06, agency: 'South Carolina Department of Employment and Workforce', report: 'UCE-101' },
    filing: { agency: 'South Carolina Department of Revenue', deposit: 'WH-1601', quarterly: 'WH-1605', annual: 'WH-1606', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly'] },
    bank: { revenue: 'SC (DEPT? OF )?REV|SCDOR|SOUTH CAROLINA (DEPT? OF )?REV|MYDORWAY', ui: 'SC ?DEW|SOUTH CAROLINA (DEW|EMPLOYMENT)' } },
  { code: 'SD', name: 'South Dakota', noTax: true, supplemental: 0, sui: { base: 15000, newRate: 1.2, agency: 'South Dakota Department of Labor', report: 'quarterly contribution report' }, bank: { revenue: '^$', ui: 'S(OUTH )?D(AKOTA)? (DEPT? OF )?LABOR|SD DLR' } },
  { code: 'TN', name: 'Tennessee', noTax: true, supplemental: 0, sui: { base: 7000, newRate: 2.7, agency: 'Tennessee Department of Labor', report: 'LB-0456' }, bank: { revenue: '^$', ui: 'TN (DEPT? OF )?LABOR|TENNESSEE (DEPT? OF )?LABOR|JOBS4TN' } },
  { code: 'TX', name: 'Texas', noTax: true, supplemental: 0, sui: { base: 9000, newRate: 2.7, agency: 'Texas Workforce Commission', report: 'C-3' }, bank: { revenue: '^$', ui: 'TWC|TEXAS WORKFORCE' } },
  { code: 'UT', name: 'Utah', supplemental: 4.45,
    form: { name: 'W-4', federal: true, fields: [], none: 'By the federal W-4’s status' },
    calc: (x) => { const m = (x.f.status || x.fedStatus) === 'married'; const allow = Math.max(0, (m ? 970 : 485) - 0.013 * Math.max(0, x.annual - (m ? 18696 : 9348))); return Math.max(0, x.annual * 0.0445 - allow); },
    sui: { base: 50700, newRate: 1.2, agency: 'Utah Department of Workforce Services', report: 'Form 3H' },
    filing: { agency: 'Utah State Tax Commission', deposit: 'TC-941', quarterly: 'TC-941', annual: 'TC-941R', annualDue: '01-31', monthlyDue: 'last', frequencies: ['quarterly', 'monthly', 'annually'] },
    bank: { revenue: 'UT(AH)? (STATE )?TAX|UTAH TAX COMM|TAP UTAH', ui: 'UTAH (DWS|WORKFORCE)|UT DWS' } },
  { code: 'VT', name: 'Vermont', supplemental: 6.6,
    form: { name: 'W-4VT', fields: ['status', 'allowances', 'extra', 'exempt'], none: 'Single, no allowances', statuses: [{ v: 'single', label: 'Single, or head of household' }, { v: 'married', label: 'Married' }] },
    calc: (x) => brk(x.f.status === 'married' ? [[0, 0, 0], [11775, 0, 3.35], [96475, 2837.45, 6.6], [216525, 10760.75, 7.6], [323825, 18915.55, 8.75]]
      : [[0, 0, 0], [3925, 0, 3.35], [54675, 1700.13, 6.6], [126775, 6458.73, 7.6], [260225, 16600.93, 8.75]], Math.max(0, x.annual - 5400 * cnt(x.f.allowances))),
    sui: { base: 15400, newRate: 1.0, agency: 'Vermont Department of Labor', report: 'C-101' },
    filing: { agency: 'Vermont Department of Taxes', deposit: 'WH-431', quarterly: 'WH-431', annual: 'WH-434', annualDue: '01-31', monthlyDue: 25, frequencies: ['monthly', 'quarterly', 'semiweekly'], quarterlyDue: 25 },
    bank: { revenue: 'VT (DEPT? OF )?TAX|VERMONT (DEPT? OF )?TAX|MYVTAX', ui: 'VT (DOL|LABOR)|VERMONT (DEPT? OF )?LABOR' } },
  { code: 'VA', name: 'Virginia', supplemental: 5.75,
    form: { name: 'VA-4', fields: ['allowances', 'additional', 'extra', 'exempt'], none: 'No exemptions', labels: { allowances: 'Personal exemptions', additional: 'Age 65 and blind exemptions' } },
    calc: (x) => brk([[0, 0, 2], [3000, 60, 3], [5000, 120, 5], [17000, 720, 5.75]], Math.max(0, x.annual - 8750 - 930 * cnt(x.f.allowances) - 800 * cnt(x.f.additional))),
    sui: { base: 8000, newRate: 2.5, agency: 'Virginia Employment Commission', report: 'VEC FC-20/21' },
    filing: { agency: 'Virginia Department of Taxation', deposit: 'VA-5', quarterly: 'VA-5', annual: 'VA-6', annualDue: '01-31', monthlyDue: 25, frequencies: ['monthly', 'quarterly', 'semiweekly'] },
    bank: { revenue: 'VA (DEPT? OF )?TAX|VIRGINIA (DEPT? OF )?TAX|VA TAX', ui: 'VEC|VIRGINIA EMPLOYMENT' } },
  { code: 'WA', localNote: 'Washington’s L&I workers’ compensation is by the hour worked, so it isn’t worked out here: pay it with your L&I quarterly report.', name: 'Washington', noTax: true, supplemental: 0, sui: { base: 78200, newRate: null, agency: 'Washington Employment Security Department', report: 'quarterly tax and wage report' },
    programs: [
      { id: 'wa_pfml', name: 'Washington Paid Family and Medical Leave', employee: 0.8072, employer: 0.3228, base: 184500, paid: QTR, group: 'wa_leave', tiers: [{ below: 50, employee: 0.8072, employer: 0 }], note: 'With 50 or more employees, the business also pays 0.3228%.' },
      { id: 'wa_cares', name: 'WA Cares Fund', employee: 0.58, base: null, paid: QTR, group: 'wa_leave', note: 'Not for anyone with an approved exemption letter.' },
    ],
    bank: { revenue: '^$', ui: 'WA(SHINGTON)? (ESD|EMPLOYMENT SEC)|PAID LEAVE|WA CARES' } },
  { code: 'WV', localNote: 'Some West Virginia cities charge a weekly service fee: add yours.', name: 'West Virginia', supplemental: 'regular', round: 'dollar',
    form: { name: 'IT-104', fields: ['allowances', 'flag', 'extra', 'exempt'], none: 'No exemptions, one earner', labels: { allowances: 'Exemptions', flag: 'Two or more earners in the household' } },
    calc: (x) => brk(x.f.flag ? [[0, 0, 2.11], [7500, 158.25, 2.81], [18750, 474.38, 3.16], [30000, 829.88, 4.22], [45000, 1462.88, 4.58]]
      : [[0, 0, 2.11], [10000, 211, 2.81], [25000, 632.5, 3.16], [40000, 1106.5, 4.22], [60000, 1950.5, 4.58]], Math.max(0, x.annual - 2000 * cnt(x.f.allowances))),
    sui: { base: 9500, newRate: 2.7, agency: 'WorkForce West Virginia', report: 'WVUC-A-154' },
    filing: { agency: 'West Virginia Tax Division', deposit: 'IT-101V', quarterly: 'IT-101Q', annual: 'IT-103', annualDue: '01-31', monthlyDue: 15, frequencies: ['monthly', 'quarterly', 'annually'] },
    bank: { revenue: 'W(EST )?V(IRGINIA)? (STATE )?TAX|WV TAX|MYTAXES', ui: 'WORKFORCE (WV|WEST VIRGINIA)' } },
  { code: 'WI', name: 'Wisconsin', supplemental: 'regular',
    form: { name: 'WT-4', fields: ['status', 'allowances', 'extra', 'exempt'], none: 'Single, no exemptions', labels: { allowances: 'Exemptions' }, statuses: ST },
    calc: (x) => {
      const a = x.annual; const m = x.f.status === 'married';
      const std = m ? (a < 25727 ? 9461 : a < 73032 ? Math.max(0, 9461 - 0.2 * (a - 25727)) : 0) : (a < 17780 ? 6702 : a < 73630 ? Math.max(0, 6702 - 0.12 * (a - 17780)) : 0);
      return brk([[0, 0, 3.54], [12760, 451.7, 4.65], [25520, 1045.04, 5.3], [280950, 14582.83, 7.65]], Math.max(0, a - std - 400 * cnt(x.f.allowances)));
    },
    sui: { base: 14000, newRate: 3.05, agency: 'Wisconsin Department of Workforce Development', report: 'UCT-101' },
    filing: { agency: 'Wisconsin Department of Revenue', deposit: 'WT-6', quarterly: 'WT-6', annual: 'WT-7', annualDue: '01-31', monthlyDue: 'last', frequencies: ['monthly', 'quarterly', 'annually'] },
    bank: { revenue: 'WI(SCONSIN)? (DEPT? OF )?REV|WI DOR|MY TAX ACCOUNT', ui: 'WI(SCONSIN)? (DWD|UI)|WORKFORCE DEV' } },
  { code: 'WY', name: 'Wyoming', noTax: true, supplemental: 0, sui: { base: 33800, newRate: 1.69, agency: 'Wyoming Department of Workforce Services', report: 'quarterly summary report' }, bank: { revenue: '^$', ui: 'WY(OMING)? (DWS|WORKFORCE)' } },
];

export const STATES: Record<string, StateSpec> = Object.fromEntries(S.map((s) => [s.code, s]));
export const STATE_LIST: { code: StateCode; name: string }[] = S.map((s) => ({ code: s.code, name: s.name })).sort((a, b) => a.name.localeCompare(b.name));
export const stateSpec = (code: string | null | undefined): StateSpec | null => STATES[String(code || '').toUpperCase()] || null;
export const noWageTax = (code: string | null | undefined) => !!stateSpec(code)?.noTax;

/** One paycheck's state income tax (and the county or city tax collected with it), from what the person wrote on the
 *  state's form; extra withholding and a per-paycheck reduction included; rounded the way the state says. */
export function stateTaxFor(code: string | null | undefined, input: { wages: number; periods: number; f: StateFormIn | null | undefined; fedStatus?: 'single' | 'married' | 'hoh'; fedPerPeriod?: number; ficaNow?: number; ficaYtd?: number }): number {
  const spec = stateSpec(code); const f = input.f || {};
  if (!spec || spec.noTax || !spec.calc || !(input.wages > 0)) return 0;
  if (f.exempt && spec.form?.fields.includes('exempt')) return 0;
  const p = input.periods;
  const annualTax = spec.calc({ annual: input.wages * p, periods: p, f, fedStatus: input.fedStatus || 'single', fedAnnual: n0(input.fedPerPeriod) * p, ficaNow: n0(input.ficaNow), ficaYtd: n0(input.ficaYtd) });
  let per = Math.max(0, annualTax / p);
  per = spec.round === 'dollar' ? Math.round(per) : spec.round === 'up' ? Math.ceil(per - 1e-9) : r2(per);
  per = Math.max(0, per - n0(f.reduce));
  const extra = n0(f.extra);
  return r2(per + (spec.round ? Math.round(extra) : extra));
}

/** What a state program takes this paycheck: the employee's part and the business's, on the wages left under its limit. */
export function programAmounts(p: ProgramSpec, wages: number, soFar: number, takenSoFar: number, periods: number, override?: { employee?: number; employer?: number; off?: boolean }, teamSize?: number | null) {
  const tier = teamSize != null && teamSize > 0 ? (p.tiers || []).find((t) => teamSize < t.below) : undefined;
  if (override?.off ?? (p.defaultOff || tier?.off)) return { employee: 0, employer: 0, wages: 0 };
  p = tier ? { ...p, ...(tier.employee != null ? { employee: tier.employee } : {}), ...(tier.employer != null ? { employer: tier.employer } : {}) } : p;
  const w = p.base == null ? wages : Math.max(0, Math.min(wages, p.base - soFar));
  let ee = r2(w * (override?.employee ?? p.employee ?? 0) / 100); const er = r2(w * (override?.employer ?? p.employer ?? 0) / 100);
  if (p.weeklyMax != null) ee = Math.min(ee, r2(p.weeklyMax * 52 / periods));
  if (p.yearlyMax != null) ee = Math.max(0, Math.min(ee, r2(p.yearlyMax - takenSoFar)));
  return { employee: ee, employer: er, wages: r2(w) };
}

/** The bonus rate, when a state has one (a percent), else null (a bonus is taxed like a regular paycheck). */
export const supplementalRate = (code: string | null | undefined): number | null => { const s = stateSpec(code); return s && typeof s.supplemental === 'number' && !s.noTax ? s.supplemental : null; };
export const fieldLabel = (spec: StateSpec, k: StateField): string => spec.form?.labels?.[k] || ({ status: 'Filing status', allowances: 'Allowances', additional: 'Additional allowances', rate: 'Percentage', code: 'Code', local: 'County', amount: 'Amount', flag: 'Yes', reduce: 'Less each paycheck', extra: 'Extra withheld each paycheck', exempt: 'Claimed exempt' } as Record<StateField, string>)[k];
