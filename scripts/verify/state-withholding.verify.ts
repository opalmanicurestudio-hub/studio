// Checks every state's payroll taxes (lib/state-payroll), as payroll run in ClarityFlow works them out:
//   Each of the 41 states with an income tax on wages, and DC, worked out from that state's own 2026 formula for a
//   person on its own form (a status, allowances, dependents, a county or city where it applies), at $2,000 and
//   $8,000 a paycheck, every two weeks. The expected figures come from a second, separate working of the same formulas
//   (written from the states' guides, not from this code), so a number copied wrong in either shows up here.
//   The 9 states with no income tax on wages take none. Every state has its unemployment wage limit, its agency and
//   wage report, and (with an income tax) its form, filing frequencies and due day. The programs paid through payroll:
//   California's SDI on all wages, New York's paid family leave stopping at its yearly most, Washington's paid leave
//   at its wage limit, one turned off in Settings. Due dates by state and frequency. Nothing asks for a Social
//   Security number.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/state-withholding.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';
import { stateTaxFor, STATES, STATE_LIST, programAmounts, stateSpec } from '../../src/lib/state-payroll';
import { withholdingFor } from '../../src/lib/withholding';
import { dueDates } from '../../src/lib/payroll-taxes';
import { owedItems } from '../../src/lib/payroll-owed';

const REF: Record<string, Record<string, number>> = {"2000": {"AL": 79.81, "AZ": 50.0, "AR": 54.15, "CA": 11.18, "CO": 79.0, "DE": 84.97, "DC": 93.12, "GA": 51.82, "HI": 93.52, "ID": 40.0, "IL": 91.53, "IN": 94.62, "IA": 44.42, "KS": 46.24, "KY": 65.48, "LA": 31.2, "ME": 78.0, "MD": 129.03, "MA": 81.97, "MI": 65.71, "MN": 54.94, "MS": 50.0, "MO": 43.0, "MT": 65.0, "NE": 44.14, "NJ": 34.62, "NM": 50.22, "NY": 147.86, "NC": 44.0, "ND": 0.0, "OH": 45.13, "OK": 69.0, "OR": 125.3, "PA": 61.4, "RI": 73.56, "SC": 59.69, "UT": 89.0, "VT": 54.99, "VA": 83.69, "WV": 59.0, "WI": 83.97, "CT": 73.04}, "8000": {"AL": 315.19, "AZ": 200.0, "AR": 287.19, "CA": 455.27, "CO": 343.0, "DE": 476.42, "DC": 590.35, "GA": 351.22, "HI": 558.23, "ID": 358.0, "IL": 388.53, "IN": 392.82, "IA": 272.42, "KS": 377.7, "KY": 275.48, "LA": 216.6, "ME": 537.0, "MD": 612.9, "MA": 359.02, "MI": 320.71, "MN": 450.67, "MS": 290.0, "MO": 325.0, "MT": 400.0, "NE": 316.81, "NJ": 385.38, "NM": 338.05, "NY": 793.42, "NC": 289.0, "ND": 113.0, "OH": 241.45, "OK": 339.0, "OR": 713.34, "PA": 245.6, "RI": 356.42, "SC": 414.38, "UT": 356.0, "VT": 470.06, "VA": 428.69, "WV": 332.0, "WI": 410.54, "CT": 459.62}};
// The person in each state, on that state's own form.
const F: Record<string, any> = {
  AL: { status: 'single', additional: 1 }, AZ: { rate: 2.5 }, AR: { allowances: 2 }, CA: { status: 'married', allowances: 2, additional: 1 }, CO: {},
  CT: { code: 'F' }, DE: { status: 'single', allowances: 1 }, DC: { allowances: 2 }, GA: { status: 'single', allowances: 2 }, HI: { status: 'single', allowances: 1 },
  ID: { status: 'married' }, IL: { allowances: 1, additional: 1 }, IN: { allowances: 1, additional: 1, local: 'marion' }, IA: { code: 'B', allowances: 2 },
  KS: { status: 'married', allowances: 3 }, KY: {}, LA: { status: 'married', allowances: 2 }, ME: { status: 'single', allowances: 1 },
  MD: { status: 'married', allowances: 2, local: 'montgomery' }, MA: { allowances: 2 }, MI: { allowances: 2 }, MN: { status: 'married', allowances: 2 },
  MS: { status: 'single', additional: 1 }, MO: { status: 'hoh' }, MT: { status: 'single' }, NE: { status: 'married', allowances: 4 }, NJ: { status: 'married', allowances: 2 },
  NM: {}, NY: { status: 'single', allowances: 1, local: 'nyc' }, NC: { status: 'hoh', allowances: 2 }, ND: {}, OH: { allowances: 1 }, OK: { status: 'single', allowances: 1 },
  OR: { status: 'single', allowances: 1 }, PA: {}, RI: { allowances: 1 }, SC: { allowances: 2 }, UT: {}, VT: { status: 'single', allowances: 1 }, VA: { allowances: 1 },
  WV: { allowances: 1 }, WI: { status: 'married', allowances: 2 },
};
const FED: Record<string, any> = { NM: 'hoh' };

const src0 = (f: string) => fs.readFileSync(f, 'utf8');
(async () => {
  console.log('Every state’s income tax, from its own formula');
  for (const W of [2000, 8000]) {
    const bad: string[] = [];
    for (const code of Object.keys(REF[String(W)])) {
      const got = stateTaxFor(code, { wages: W, periods: 26, f: F[code], fedStatus: FED[code] || 'single', fedPerPeriod: W === 2000 ? 200 : 1500, ficaNow: Math.round(W * 7.65) / 100, ficaYtd: 0 });
      if (Math.abs(got - REF[String(W)][code]) > 0.011) bad.push(`${code}: ${got} not ${REF[String(W)][code]}`);
    }
    check(`$${W.toLocaleString('en-US')} every two weeks: all ${Object.keys(REF[String(W)]).length - 1} states with an income tax, and DC, match the separate working`, !bad.length, bad);
  }
  // The states' own published worked examples (their 2026 guides), each to the cent the guide shows. (New York's and
  // California's guides work some by per-paycheck tables, rounded; the yearly working is within a few cents of them.)
  const ex = (code: string, wages: number, periods: number, f: any, want: number, within = 0.005) => { const got = stateTaxFor(code, { wages, periods, f }); return Math.abs(got - want) <= within ? '' : `${code} ${wages}×${periods}: ${got} not ${want}`; };
  const pub = [
    ex('CA', 2400, 24, { status: 'married', allowances: 4 }, 4.13), ex('CA', 4750, 12, { status: 'married', allowances: 4 }, 7.17), ex('CA', 1600, 26, { status: 'married', allowances: 2, additional: 1 }, 2.38),
    ex('SC', 750, 52, { allowances: 3 }, 10.58), ex('VA', 2649, 24, { allowances: 5 }, 109.48),
    ex('IA', 2100, 26, { code: 'A', allowances: 1 }, 59.26), ex('IA', 2100, 26, { code: 'C', allowances: 2 }, 38.72), ex('IA', 2100, 26, { code: 'B', allowances: 4 }, 45.15),
    ex('IA', 5000, 12, { code: 'A', allowances: 1 }, 145.50), ex('IA', 5000, 12, { code: 'C', allowances: 2 }, 101.00), ex('IA', 5000, 12, { code: 'B', allowances: 4 }, 114.92),
    ex('WI', 350, 52, { status: 'single', allowances: 1 }, 7.59), ex('WI', 500, 52, { status: 'single', allowances: 3 }, 14.34), ex('WI', 1000, 26, { status: 'married', allowances: 3 }, 22.08),
    ex('NY', 400, 52, { status: 'single', allowances: 3 }, 8.01, 0.05), ex('NY', 5000, 24, { status: 'single', allowances: 1 }, 258.51, 0.05), ex('NY', 50000, 12, { status: 'single', allowances: 3 }, 3576.63, 0.05),
    ex('NY', 400, 52, { status: 'married', allowances: 4 }, 6.69, 0.05), ex('NY', 50000, 12, { status: 'married', allowances: 3 }, 3622.09, 0.05),
  ].filter(Boolean);
  check('the states’ own worked examples: California (3), South Carolina, Virginia, Iowa (6), Wisconsin (3) and New York (5)', !pub.length, pub);
  check('the nine states with no income tax on wages take none', ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY'].every((c) => STATES[c].noTax && stateTaxFor(c, { wages: 5000, periods: 26, f: {} }) === 0));
  check('all 50 states and DC are here', STATE_LIST.length === 51);
  check('a state form claimed exempt takes none; a state that doesn’t allow exempt (Alabama, Indiana) still takes it',
    stateTaxFor('GA', { wages: 2000, periods: 26, f: { exempt: true } }) === 0 && stateTaxFor('AL', { wages: 2000, periods: 26, f: { status: 'single', exempt: true }, fedPerPeriod: 200 }) > 0 && stateTaxFor('IN', { wages: 2000, periods: 26, f: { exempt: true } }) > 0);
  check('with no form on file, each state’s own default: Connecticut 6.99% of everything, Arizona 2%, California single with none',
    stateTaxFor('CT', { wages: 1000, periods: 26, f: null }) === 69.9 && stateTaxFor('AZ', { wages: 1000, periods: 26, f: null }) === 20 && stateTaxFor('CA', { wages: 2000, periods: 26, f: null }) === stateTaxFor('CA', { wages: 2000, periods: 26, f: { status: 'single', allowances: 0 } }));
  check('rounded the way each state says: North Carolina to the dollar, Montana up to the dollar, extra included', stateTaxFor('NC', { wages: 1780.5, periods: 26, f: { status: 'married', extra: 10 } }) === 63
    && Number.isInteger(stateTaxFor('MT', { wages: 2345.67, periods: 26, f: { status: 'single' } })));
  check('New York City and Yonkers: a resident’s tax is added, a Yonkers worker who lives elsewhere pays 0.5%',
    stateTaxFor('NY', { wages: 2000, periods: 26, f: { status: 'single', allowances: 1, local: 'nyc' } }) > stateTaxFor('NY', { wages: 2000, periods: 26, f: { status: 'single', allowances: 1 } })
    && Math.abs(stateTaxFor('NY', { wages: 2000, periods: 26, f: { status: 'single', local: 'yonkers_nonresident' } }) - stateTaxFor('NY', { wages: 2000, periods: 26, f: { status: 'single' } }) - 10) < 0.02);

  console.log('Unemployment, filing and programs');
  const all = Object.values(STATES);
  check('every state: its unemployment wage limit, agency and wage report', all.every((s) => s.sui.base > 0 && !!s.sui.agency && !!s.sui.report));
  check('every state with an income tax: its form, how often it’s filed and when, and the agency', all.filter((s) => !s.noTax).every((s) => !!s.form && !!s.filing && s.filing.frequencies.length > 0 && (s.filing.monthlyDue === 'last' || (s.filing.monthlyDue >= 1 && s.filing.monthlyDue <= 31)) && !!s.calc));
  check('2026 wage limits: North Carolina $34,200, California $7,000, Washington $78,200, New Mexico $34,800, Tennessee $7,000',
    STATES.NC.sui.base === 34200 && STATES.CA.sui.base === 7000 && STATES.WA.sui.base === 78200 && STATES.NM.sui.base === 34800 && STATES.TN.sui.base === 7000);
  const ca = withholdingFor({ year: 2026, periods: 26, gross: 2000, forms: { federal: { status: 'single' }, state: { status: 'single' } }, state: 'CA', setup: {}, ytd: null });
  check('California: SDI 1.3% of all wages, from pay', ca.employee.other.some((o) => o.id === 'ca_sdi' && o.amount === 26));
  const nyPfl = STATES.NY.programs!.find((p) => p.id === 'ny_pfl')!;
  check('New York paid family leave stops at its yearly most', programAmounts(nyPfl, 5000, 0, 400, 26).employee === 11.91 && programAmounts(nyPfl, 5000, 0, 411.91, 26).employee === 0);
  const waP = STATES.WA.programs!.find((p) => p.id === 'wa_pfml')!;
  check('Washington paid leave only on wages under its limit', programAmounts(waP, 5000, 183000, 0, 26).wages === 1500);
  const off = withholdingFor({ year: 2026, periods: 26, gross: 2000, forms: {}, state: 'CA', setup: { programs: { ca_sdi: { off: true } } }, ytd: null });
  check('a program the business turns off in Settings isn’t taken', !off.employee.other.some((o) => o.id === 'ca_sdi'));
  check('Oregon’s statewide transit tax, 0.1%', withholdingFor({ year: 2026, periods: 26, gross: 1000, forms: {}, state: 'OR', setup: {}, ytd: null }).employee.other.some((o) => o.id === 'or_transit' && o.amount === 1));

  console.log('By the business’s size');
  const w = (state: string, teamSize: number, setup: any = {}) => withholdingFor({ year: 2026, periods: 26, gross: 2000, forms: {}, state, setup, ytd: null, teamSize });
  check('Delaware Paid Leave: none under 10 employees; parental leave only (0.16% each) from 10 to 24; all of it from 25',
    !w('DE', 5).employee.other.some((o) => o.id === 'de_pfml') && w('DE', 12).employee.other.find((o) => o.id === 'de_pfml')?.amount === 3.2 && w('DE', 30).employee.other.find((o) => o.id === 'de_pfml')?.amount === 8);
  check('Oregon, Maine, Colorado, Massachusetts, Washington: no business share under their size; Minnesota’s small rate',
    !w('OR', 5).employer.other.some((o) => o.id === 'or_pfml_er') && !!w('OR', 30).employer.other.some((o) => o.id === 'or_pfml_er') && !w('ME', 5).employer.other.some((o) => o.id === 'me_pfml_er')
    && !w('CO', 5).employer.other.some((o) => o.id === 'co_famli_er') && !w('MA', 5).employer.other.some((o) => o.id === 'ma_pfml_er') && !w('WA', 5).employer.other.some((o) => o.id === 'wa_pfml_er')
    && w('MN', 5).employee.other.find((o) => o.id === 'mn_pfml')?.amount === 6.6);
  check('the size in Settings wins over the payday’s count', !!w('OR', 5, { teamSize: 40 }).employer.other.some((o) => o.id === 'or_pfml_er'));
  check('Hawaii’s disability insurance is off until the business turns it on with its policy’s rate', !w('HI', 5).employee.other.some((o) => o.id === 'hi_tdi') && !!w('HI', 5, { programs: { hi_tdi: { off: false, employee: 0.3 } } }).employee.other.some((o) => o.id === 'hi_tdi' && o.amount === 6));

  console.log('Paid together');
  const t = (state: string, stateFiling?: string, stateDueDay?: number) => ({ taxState: state, payrollTax: { runBy: 'clarityflow', ...(stateFiling ? { stateFiling } : {}), ...(stateDueDay ? { stateDueDay } : {}) }, payroll: { cadence: 'bi-weekly', periodAnchor: '2026-11-02' }, timezone: 'America/New_York' });
  const run = (state: string, payDate: string, owed: any, period = payDate) => ({ kind: 'payday', runBy: 'clarityflow', periodKey: period, payDate, from: payDate, to: payDate, people: [], taxes: { owed, due: dueDates(payDate, t(state)), schedule: { irs: 'monthly', state: (t(state) as any).payrollTax.stateFiling || STATES[state].filing?.frequencies[0] || null } } });
  const nj = owedItems([run('NJ', '2026-11-19', { irs: 0, state: 50, sui: 30, futa: 0, other: [{ id: 'nj_ui_ee', name: 'x', amount: 4 }, { id: 'nj_tdi', name: 'x', amount: 2 }, { id: 'nj_fli', name: 'x', amount: 2.3 }, { id: 'nj_tdi_er', name: 'x', amount: 5 }] })], t('NJ'), '2026-11-20', 'New Jersey');
  check('New Jersey: unemployment, the employee share, disability and family leave are one item, as they’re one payment', nj.filter((i) => i.agency === 'sui').length === 1 && nj.find((i) => i.agency === 'sui')?.amount === 43.3 && !nj.some((i) => i.agency === 'other'), nj.map((i) => [i.name, i.amount]));
  const wa = owedItems([run('WA', '2026-11-19', { irs: 0, state: 0, sui: 10, futa: 0, other: [{ id: 'wa_pfml', name: 'x', amount: 16 }, { id: 'wa_cares', name: 'x', amount: 11.6 }] })], t('WA'), '2026-11-20', 'Washington');
  check('Washington: paid leave and WA Cares are one item', wa.filter((i) => i.agency === 'other').length === 1 && wa.find((i) => i.agency === 'other')?.amount === 27.6, wa.map((i) => [i.name, i.amount]));
  const ny = owedItems(['2026-10-08', '2026-10-22', '2026-11-05', '2026-11-19', '2026-12-03'].map((d) => run('NY', d, { irs: 0, state: 300, sui: 0, futa: 0, other: [] })), t('NY'), '2026-12-05', 'New York');
  check('New York: held until what’s unpaid reaches $700, then due 5 business days after that payday; the rest with the NYS-45',
    // (October 8 and 22, then November 5 brings it to $900: due 5 business days on, November 11 a holiday, so the 13th.
    // November 19 and December 3 come to $600: with the NYS-45.)
    ny.filter((i) => i.agency === 'state').length === 2 && ny.find((i) => i.key === 'state_2026-11-13')?.amount === 900 && ny.find((i) => i.key === 'state_2026q4')?.amount === 600, ny.map((i) => [i.key, i.amount]));

  console.log('What’s missing');
  const fl = (state: string, forms: any, setup: any = {}) => withholdingFor({ year: 2026, periods: 26, gross: 2000, forms, state, setup, ytd: null }).flags;
  const old = { status: 'single', allowances: 0, extra: 0, exempt: false, pct: 3 };   // (as round 1 kept a Georgia form)
  check('a state form saved before the state was built in, or for another state, is as none, so Payday asks for the real one',
    fl('GA', { federal: { status: 'single' }, state: old }).includes('no_state_form') && fl('GA', { federal: { status: 'single' }, state: { state: 'NC', status: 'single', allowances: 2 } }).includes('no_state_form')
    && !fl('GA', { federal: { status: 'single' }, state: { state: 'GA', status: 'single', allowances: 0 } }).includes('no_state_form') && !fl('NC', { federal: { status: 'single' }, state: { status: 'single', allowances: 1 } }).includes('no_state_form')
    && withholdingFor({ year: 2026, periods: 26, gross: 2000, forms: { state: { state: 'NC', status: 'single', allowances: 9 } }, state: 'GA', setup: {}, ytd: null }).employee.state === stateTaxFor('GA', { wages: 2000, periods: 26, f: null }));
  check('a state whose programs depend on size, with no size in Settings: said so', fl('DE', {}).includes('team_size_missing') && !fl('DE', {}, { teamSize: 4 }).includes('team_size_missing') && !fl('NC', {}).includes('team_size_missing'));
  check('no state form needed where the state reads the W-4 or has nothing to fill in (New Mexico, Pennsylvania)', !fl('NM', { federal: { status: 'single' } }).includes('no_state_form') && !fl('PA', { federal: { status: 'single' } }).includes('no_state_form'));
  check('Indiana or Maryland with no county: said so', fl('IN', { state: { state: 'IN', allowances: 1 } }).includes('county_missing') && !fl('IN', { state: { state: 'IN', allowances: 1, local: 'marion' } }).includes('county_missing'));
  check('no unemployment rate to use (Louisiana’s depends on the industry): said so, until one is in Settings', fl('LA', {}).includes('sui_rate_missing') && !fl('LA', {}, { suiRate: 1.5 }).includes('sui_rate_missing') && !fl('NC', {}).includes('sui_rate_missing'));
  const sync = src0('src/lib/plaid-sync.ts');
  check('a payee that’s both (California’s EDD), or a state whose unemployment goes to its revenue department: either one can match', /const rv = REV\.test\(n\), ui = UI\.test\(n\) \|\| \(rv && !!stSpec\?\.sui\.paidTo\);/.test(sync) && STATES.OR.sui.paidTo === 'revenue');

  console.log('When it’s due');
  check('Virginia monthly: the 25th of the next month', dueDates('2026-11-19', t('VA', 'monthly')).state === '2026-12-28' || dueDates('2026-11-19', t('VA', 'monthly')).state === '2026-12-25', dueDates('2026-11-19', t('VA', 'monthly')));
  check('Michigan quarterly: the 20th after the quarter; Utah monthly: the last day', dueDates('2026-11-19', t('MI', 'quarterly')).state === '2027-01-20' && dueDates('2026-11-19', t('UT', 'monthly')).state === '2026-12-31');
  check('the business’s own due day from its letter wins', dueDates('2026-11-19', t('GA', 'monthly', 20)).state === '2026-12-21');
  check('a state with no income tax: nothing due for it', dueDates('2026-11-19', t('TX')).state === null);
  check('weekly (Connecticut, New Jersey): by the Wednesday after the week', dueDates('2026-11-19', t('CT', 'weekly')).state === '2026-11-25');
  check('twice a month by the state’s rule: Pennsylvania 3 banking days after the half, Idaho the 20th, Kansas the 25th',
    dueDates('2026-11-05', t('PA', 'semimonthly')).state === '2026-11-18' && dueDates('2026-11-05', t('ID', 'semimonthly')).state === '2026-11-20' && dueDates('2026-11-05', t('KS', 'semimonthly')).state === '2026-11-25');
  check('North Carolina’s December still by January 31 (a Sunday, so February 1)', dueDates('2026-12-03', t('NC', 'monthly')).state === '2027-02-01');

  console.log('Screens');
  const src = (f: string) => fs.readFileSync(f, 'utf8');
  const dlg = src('src/components/staff/TaxFormsDialog.tsx'), set = src('src/app/(app)/settings/page.tsx'), forms = src('src/components/money/PayrollFormsDialog.tsx');
  check('the tax forms dialog asks for each state’s own fields, by its own names', /fieldLabel\(spec!, 'allowances'\)/.test(dlg) && /has\('local'\) && sf\.locals/.test(dlg) && /has\('code'\) && sf\.codes/.test(dlg) && !/NC-4/.test(dlg));
  check('Settings: how often each state is paid and the day it’s due, its unemployment rate and limit, its programs', /spec\.filing\.frequencies\.map/.test(set) && /Due each month by/.test(set) && /paid leave and disability programs/.test(set));
  check('the quarter’s forms by each state’s own names', /: spec\?\.filing\?\.quarterly \|\| 'State withholding'/.test(forms) && /: spec\?\.sui\.report \|\| 'Wage report'/.test(forms) && /\$\{spec!\.filing!\.quarterly\}, withholding/.test(forms));
  check('never a Social Security number asked for', !/\bssn\b|taxpayer id/i.test(dlg) && !/<input[^>]*social/i.test(dlg));

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nAll passed');
})();
