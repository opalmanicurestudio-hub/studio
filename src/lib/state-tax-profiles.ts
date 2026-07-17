// src/lib/state-tax-profiles.ts
//
// State tax profiles for the Money Hub's Payday allocation engine.
//
// ⚠️ PLANNING ESTIMATES ONLY — NOT TAX ADVICE.
// State income tax rates are 2026 figures (source: Tax Foundation,
// "State Individual Income Tax Rates and Brackets, 2026").
// `effectiveStateRate` is a rough mid-band effective rate for a small
// studio owner (graduated states tax below their top rate at typical
// incomes). `sutaNewEmployerPct` is an approximate new-employer state
// unemployment rate — these change yearly and vary by employer history.
// Always confirm final numbers with your accountant.

export type StateTaxType = 'none' | 'flat' | 'graduated';

export type StateTaxProfile = {
  code: string;
  name: string;
  taxType: StateTaxType;
  /** Flat rate, or top marginal rate for graduated states (%) */
  stateRate: number;
  /** Rough effective rate for a typical small-business owner (%) */
  effectiveStateRate: number;
  /** Suggested Profit First "Tax" bucket allocation (%) — covers federal
   *  income tax + self-employment tax (~15% base) + state effective rate */
  suggestedTaxPct: number;
  /** Approximate new-employer SUTA rate (%) */
  sutaNewEmployerPct: number;
  /** FICA employer share 7.65% + FUTA 0.6% + SUTA — total employer payroll tax (%) */
  employerPayrollTaxPct: number;
  note?: string;
};

const FICA_EMPLOYER = 7.65;
const FUTA = 0.6;
const FEDERAL_SE_BASE = 15; // Profit First baseline for federal income + SE tax

const p = (
  code: string, name: string, taxType: StateTaxType,
  stateRate: number, effectiveStateRate: number, sutaNewEmployerPct: number,
  note?: string,
): StateTaxProfile => ({
  code, name, taxType, stateRate, effectiveStateRate, sutaNewEmployerPct,
  suggestedTaxPct: Math.min(30, Math.max(15, Math.round(FEDERAL_SE_BASE + effectiveStateRate))),
  employerPayrollTaxPct: Number((FICA_EMPLOYER + FUTA + sutaNewEmployerPct).toFixed(2)),
  note,
});

export const STATE_TAX_PROFILES: Record<string, StateTaxProfile> = {
  // ── No wage income tax ──
  AK: p('AK', 'Alaska',        'none', 0, 0, 1.66),
  FL: p('FL', 'Florida',       'none', 0, 0, 2.70),
  NV: p('NV', 'Nevada',        'none', 0, 0, 2.95, 'Nevada levies a payroll-based Commerce/MBT tax on larger employers.'),
  NH: p('NH', 'New Hampshire', 'none', 0, 0, 1.70),
  SD: p('SD', 'South Dakota',  'none', 0, 0, 1.20),
  TN: p('TN', 'Tennessee',     'none', 0, 0, 2.70),
  TX: p('TX', 'Texas',         'none', 0, 0, 2.70),
  WA: p('WA', 'Washington',    'none', 0, 0, 1.25, 'WA taxes capital gains only, not wages; note WA Cares & PFML payroll premiums.'),
  WY: p('WY', 'Wyoming',       'none', 0, 0, 1.00),

  // ── Flat tax ──
  AZ: p('AZ', 'Arizona',        'flat', 2.50, 2.50, 2.00),
  CO: p('CO', 'Colorado',       'flat', 4.40, 4.40, 1.70),
  GA: p('GA', 'Georgia',        'flat', 5.19, 5.19, 2.64),
  ID: p('ID', 'Idaho',          'flat', 5.30, 5.30, 1.00),
  IL: p('IL', 'Illinois',       'flat', 4.95, 4.95, 3.95),
  IN: p('IN', 'Indiana',        'flat', 2.95, 2.95, 2.50, 'Indiana counties add a local income tax (~0.5–3%).'),
  IA: p('IA', 'Iowa',           'flat', 3.80, 3.80, 1.00),
  KY: p('KY', 'Kentucky',       'flat', 3.50, 3.50, 2.70, 'Some KY cities/counties levy occupational license taxes.'),
  LA: p('LA', 'Louisiana',      'flat', 3.00, 3.00, 1.20),
  MI: p('MI', 'Michigan',       'flat', 4.25, 4.25, 2.70, 'Several MI cities (e.g. Detroit) add a local income tax.'),
  MS: p('MS', 'Mississippi',    'flat', 4.00, 4.00, 1.00),
  NC: p('NC', 'North Carolina', 'flat', 3.99, 3.99, 1.00,
       'NC is a flat 3.99% for 2026 (down from 4.25% in 2025). Nail/beauty services are generally NOT subject to NC sales tax, but retail product sales are.'),
  OH: p('OH', 'Ohio',           'flat', 2.75, 2.75, 2.70, 'Ohio municipalities add local income taxes (~1–3%).'),
  PA: p('PA', 'Pennsylvania',   'flat', 3.07, 3.07, 3.82, 'PA municipalities add a local earned income tax (~1–3.9%).'),
  UT: p('UT', 'Utah',           'flat', 4.50, 4.50, 1.40),

  // ── Graduated ──
  AL: p('AL', 'Alabama',       'graduated',  5.00, 4.50, 2.70),
  AR: p('AR', 'Arkansas',      'graduated',  3.90, 3.40, 1.90),
  CA: p('CA', 'California',    'graduated', 13.30, 6.00, 3.40, 'CA also levies ETT and SDI payroll items.'),
  CT: p('CT', 'Connecticut',   'graduated',  6.99, 5.50, 2.50),
  DE: p('DE', 'Delaware',      'graduated',  6.60, 5.20, 1.20),
  HI: p('HI', 'Hawaii',        'graduated', 11.00, 7.00, 3.00),
  KS: p('KS', 'Kansas',        'graduated',  5.58, 5.20, 2.70),
  ME: p('ME', 'Maine',         'graduated',  7.15, 6.00, 2.24),
  MD: p('MD', 'Maryland',      'graduated',  6.50, 4.75, 2.60, 'MD counties add a mandatory local income tax (~2.25–3.2%).'),
  MA: p('MA', 'Massachusetts', 'graduated',  9.00, 5.00, 2.13, '5% flat plus 4% surtax on income over ~$1M.'),
  MN: p('MN', 'Minnesota',     'graduated',  9.85, 6.50, 1.00),
  MO: p('MO', 'Missouri',      'graduated',  4.70, 4.20, 2.38, 'KC and St. Louis add a 1% earnings tax.'),
  MT: p('MT', 'Montana',       'graduated',  5.65, 5.00, 1.30),
  NE: p('NE', 'Nebraska',      'graduated',  4.55, 4.20, 1.25),
  NJ: p('NJ', 'New Jersey',    'graduated', 10.75, 5.50, 2.80),
  NM: p('NM', 'New Mexico',    'graduated',  5.90, 4.70, 1.00),
  NY: p('NY', 'New York',      'graduated', 10.90, 5.90, 4.10, 'NYC residents add ~3–3.9% local income tax; NYC salon services are sales-taxable.'),
  ND: p('ND', 'North Dakota',  'graduated',  2.50, 1.80, 1.00),
  OK: p('OK', 'Oklahoma',      'graduated',  4.50, 4.30, 1.50),
  OR: p('OR', 'Oregon',        'graduated',  9.90, 8.00, 2.40, 'Portland metro adds local income taxes.'),
  RI: p('RI', 'Rhode Island',  'graduated',  5.99, 4.50, 1.20),
  SC: p('SC', 'South Carolina','graduated',  6.00, 5.00, 0.50),
  VT: p('VT', 'Vermont',       'graduated',  8.75, 6.00, 1.00),
  VA: p('VA', 'Virginia',      'graduated',  5.75, 5.30, 2.50),
  WV: p('WV', 'West Virginia', 'graduated',  4.82, 4.50, 2.70),
  WI: p('WI', 'Wisconsin',     'graduated',  7.65, 5.50, 3.05),
  DC: p('DC', 'Washington, DC','graduated', 10.75, 7.00, 2.70),
};

/** @deprecated Multi-tenant apps must not assume a state. Kept only for
 *  backward compatibility; new code should use GENERIC_US_PROFILE until
 *  the tenant explicitly selects their state. */
export const DEFAULT_STATE_CODE = 'NC';

/** Federal-only baseline used when a tenant hasn't picked their state yet.
 *  Never silently applies another state's numbers — the UI must prompt. */
export const GENERIC_US_PROFILE: StateTaxProfile = {
  code: 'US',
  name: 'United States — state not set',
  taxType: 'none',
  stateRate: 0,
  effectiveStateRate: 0,
  suggestedTaxPct: 15,
  sutaNewEmployerPct: 2.0,
  employerPayrollTaxPct: 10.25,
  note: 'Select your state for accurate tax and payroll estimates — this is a federal-only baseline.',
};

/** The tax year these rates were compiled for. State legislatures change
 *  rates almost every January (NC alone: 4.5% → 4.25% → 3.99% across
 *  2024–2026), so this library needs an annual refresh. The Payday tab
 *  shows a warning banner once the calendar year passes this vintage. */
export const RATES_VINTAGE = 2026;

export const ratesAreStale = (now: Date = new Date()): boolean =>
  now.getFullYear() > RATES_VINTAGE;

export const STATE_OPTIONS = Object.values(STATE_TAX_PROFILES)
  .sort((a, b) => a.name.localeCompare(b.name));

export const getStateProfile = (code?: string | null): StateTaxProfile =>
  STATE_TAX_PROFILES[(code || '').toUpperCase()] || STATE_TAX_PROFILES[DEFAULT_STATE_CODE];

/** Profit First split, with the Tax bucket driven by the state profile.
 *  Profit and OpEx stay fixed; Owner Comp absorbs the difference. */
export const suggestedAllocation = (profile: StateTaxProfile) => {
  const profit = 5;
  const opex = 30;
  const tax = profile.suggestedTaxPct;
  const ownerComp = Math.max(0, 100 - profit - opex - tax);
  return { profit, ownerComp, tax, opex };
};

/** Rough employer-side payroll tax on a gross payroll amount (FICA + FUTA + SUTA).
 *  Ignores wage-base caps — fine for per-period planning at studio scale. */
export const estimateEmployerPayrollTax = (grossPayroll: number, profile: StateTaxProfile): number =>
  Math.max(0, grossPayroll) * (profile.employerPayrollTaxPct / 100);
