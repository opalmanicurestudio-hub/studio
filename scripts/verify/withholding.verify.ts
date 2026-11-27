// Checks the taxes on a paycheck when payroll is run in ClarityFlow (lib/withholding, lib/payroll-taxes), against the
// IRS's Publication 15-T (2026, Worksheet 1A and the annual percentage method tables) and North Carolina's NC-30 (2026),
// each figure worked by hand:
//   Federal income tax for a 2020-or-later W-4 (each filing status, the step 2 box, steps 3 and 4), a 2019-or-earlier
//   one (allowances), and exempt. Social Security to its wage base, Medicare, and the extra 0.9% past $200,000.
//   Federal and state unemployment to their wage bases. North Carolina's tax, a state with none, a state at the
//   business's percentage, and a state with nothing set (flagged). Before-tax deductions. A paycheck too small for its
//   taxes (cash tips taken home): Social Security and Medicare first, the rest short and said so.
//   What a payday owes the IRS and the state; when each is due (monthly and twice-a-week deposits, holidays, weekends).
//   What each person has been taxed on so far this year, from the paydays recorded.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/withholding.verify.ts
import { check, failures } from './fake-db';
import { withholdingFor, federalIncomeTax, stateIncomeTax, owedOf, cleanTaxForms, stateHow } from '../../src/lib/withholding';
import { dueDates, federalHolidays, ytdFrom, paydayTaxes, payDateOf, runByOf, runByChosen, periodsPerYear } from '../../src/lib/payroll-taxes';

const Y = 2026;
console.log('Federal income tax');
check('single, nothing else claimed, every two weeks: $1,780.50 → $129.81', federalIncomeTax(1780.5, 26, { status: 'single' }, Y) === 129.81, federalIncomeTax(1780.5, 26, { status: 'single' }, Y));
check('no W-4 at all is the same as single with nothing claimed', federalIncomeTax(1780.5, 26, null, Y) === 129.81);
check('married filing jointly with $2,000 for dependents: $1,626 → nothing', federalIncomeTax(1626, 26, { status: 'married', dependents: 2000 }, Y) === 0);
check('the step 2 box (two jobs), single: $2,000 → $270.19', federalIncomeTax(2000, 26, { status: 'single', multipleJobs: true }, Y) === 270.19, federalIncomeTax(2000, 26, { status: 'single', multipleJobs: true }, Y));
check('head of household, weekly: $1,000 → $57.46', federalIncomeTax(1000, 52, { status: 'hoh' }, Y) === 57.46, federalIncomeTax(1000, 52, { status: 'hoh' }, Y));
check('steps 4(a), 4(b) and 4(c): $1,500 with $5,200 other income, $2,600 deductions, $20 extra → $128.15', federalIncomeTax(1500, 26, { status: 'single', otherIncome: 5200, deductions: 2600, extra: 20 }, Y) === 128.15, federalIncomeTax(1500, 26, { status: 'single', otherIncome: 5200, deductions: 2600, extra: 20 }, Y));
check('a 2019 W-4, married, 3 allowances, twice a month: $3,000 → $178.33', federalIncomeTax(3000, 24, { form: 'pre2020', status: 'married', allowances: 3 }, Y) === 178.33, federalIncomeTax(3000, 24, { form: 'pre2020', status: 'married', allowances: 3 }, Y));
check('the top bracket: single, monthly $80,000 → $26,840.22', federalIncomeTax(80000, 12, { status: 'single' }, Y) === Math.round(((192979.25 + (960000 - 8600 - 648100) * 0.37) / 12) * 100) / 100);
check('exempt: no federal income tax', federalIncomeTax(1780.5, 26, { status: 'single', exempt: true }, Y) === 0);

console.log('Social Security, Medicare, unemployment');
const base = { year: Y, periods: 26, state: 'NC', setup: {} };
const jo = withholdingFor({ ...base, gross: 1780.5, forms: { federal: { status: 'single' }, state: { status: 'single' } } });
check('Social Security 6.2% and Medicare 1.45%, each side', jo.employee.socialSecurity === 110.39 && jo.employee.medicare === 25.82 && jo.employer.socialSecurity === 110.39 && jo.employer.medicare === 25.82, jo);
check('North Carolina: single, no allowances → $53, to the dollar', jo.employee.state === 53, jo.employee.state);
check('take-home: $1,780.50 less $319.02 = $1,461.48', jo.employeeTotal === 319.02 && jo.takeHome === 1461.48, jo);
check('a new employee: federal unemployment 0.6% and North Carolina’s 1% on all of it', jo.employer.futa === 10.68 && jo.employer.sui === 17.81, jo.employer);
const capped = withholdingFor({ ...base, gross: 1000, ytd: { ssWages: 184000, medicareWages: 199500, futaWages: 6800, suiWages: 34000 } });
check('Social Security stops at the $184,500 wage base: $31.00 on the last $500', capped.employee.socialSecurity === 31 && capped.employer.socialSecurity === 31 && capped.wages.socialSecurity === 500, capped);
check('Medicare on all of it, and 0.9% more on what’s past $200,000 (employee only)', capped.employee.medicare === 14.5 && capped.employee.additionalMedicare === 4.5 && capped.employer.medicare === 14.5, capped);
check('federal unemployment stops at $7,000, North Carolina’s at $34,200', capped.employer.futa === 1.2 && capped.employer.sui === 2, capped.employer);
const own = withholdingFor({ ...base, gross: 1000, setup: { suiRate: 2.5, suiWageBase: 40000 }, ytd: { ssWages: 0, medicareWages: 0, futaWages: 0, suiWages: 34000 } });
check('the business’s own unemployment rate and wage base', own.employer.sui === 25, own.employer.sui);

console.log('State income tax');
check('North Carolina, head of household, 2 allowances, monthly $4,000 → $81', stateIncomeTax(4000, 12, 'NC', { status: 'hoh', allowances: 2 }, {}, Y) === 81, stateIncomeTax(4000, 12, 'NC', { status: 'hoh', allowances: 2 }, {}, Y));
check('North Carolina, married uses the same $12,750 as single, plus extra', stateIncomeTax(1780.5, 26, 'NC', { status: 'married', extra: 10 }, {}, Y) === 63);
check('Texas: no income tax on wages', stateIncomeTax(1780.5, 26, 'TX', null, {}, Y) === 0 && stateHow('TX') === 'none');
check('Pennsylvania at the business’s 3.07%', stateIncomeTax(1000, 26, 'PA', null, { statePct: 3.07 }, Y) === 30.7 && stateHow('PA', { statePct: 3.07 }) === 'percent');
check('a person’s own percentage wins over the business’s', stateIncomeTax(1000, 26, 'PA', { pct: 4 }, { statePct: 3.07 }, Y) === 40);
const ga = withholdingFor({ ...base, state: 'GA', gross: 1000 });
check('a state with nothing set: none taken out, and said so', ga.employee.state === 0 && ga.flags.includes('state_missing') && ga.stateHow === 'missing', ga.flags);
check('no W-4 and no NC-4 are both said', jo.flags.length === 0 && withholdingFor({ ...base, gross: 500 }).flags.includes('no_w4') && withholdingFor({ ...base, gross: 500 }).flags.includes('no_state_form'));

console.log('Before-tax deductions, and a paycheck too small');
const pre = withholdingFor({ ...base, gross: 2000, forms: { federal: { status: 'single' }, state: {}, pretax: { retirement: 100, health: 50 } } });
check('retirement comes off income tax wages only; health off Social Security and Medicare too', pre.wages.federal === 1850 && pre.wages.socialSecurity === 1950 && pre.employee.socialSecurity === 120.9 && pre.employee.medicare === 28.28, pre.wages);
check('take-home is after them', pre.check === 1850 && pre.takeHome === Math.round((1850 - pre.employeeTotal) * 100) / 100);
const tiny = withholdingFor({ ...base, gross: 1000, inHand: 980, forms: { federal: { status: 'single' }, state: {} } });
check('cash tips taken home are taxed, but only the $20 in the paycheck can be taken: Social Security first', tiny.check === 20 && tiny.employee.socialSecurity === 20 && tiny.employee.medicare === 0 && tiny.takeHome === 0, tiny);
check('what couldn’t be taken is kept and flagged', tiny.short.socialSecurity === 42 && tiny.short.medicare === 14.5 && tiny.flags.includes('short'), tiny.short);
check('the employer’s share is owed in full all the same', tiny.employer.socialSecurity === 62 && tiny.employer.medicare === 14.5);

console.log('Other payroll taxes the business adds');
const loc = withholdingFor({ ...base, gross: 1000, setup: { other: [{ id: 'eit', name: 'City earned income tax', rate: 1, who: 'employee' }, { id: 'pfl', name: 'Paid leave', rate: 0.5, who: 'employer', wageBase: 1200 }] }, ytd: { ssWages: 0, medicareWages: 0, futaWages: 0, suiWages: 0, other: { pfl: 1000 } } });
check('an employee’s 1% city tax, and an employer’s 0.5% to its own wage base', loc.employee.other[0]?.amount === 10 && loc.employer.other[0]?.amount === 1 && loc.employer.other[0]?.wages === 200, loc);

console.log('What a payday owes');
const owed = owedOf([jo, capped]);
check('the IRS: income tax withheld and both shares of Social Security and Medicare', owed.irs === Math.round((jo.employee.federal + 2 * (110.39 + 25.82) + capped.employee.federal + 2 * (31 + 14.5) + 4.5) * 100) / 100, owed);
check('the state, state unemployment and federal unemployment, apart', owed.state === jo.employee.state + capped.employee.state && owed.sui === Math.round((17.81 + 2) * 100) / 100 && owed.futa === Math.round((10.68 + 1.2) * 100) / 100);
const tenant = { timezone: 'America/New_York', payroll: { cadence: 'bi-weekly', periodAnchor: '2026-11-02', paydayAfterDays: 4 }, taxState: 'NC', payrollTax: {} };
const run = paydayTaxes({ tenant, payDate: '2026-12-03', people: [{ staffId: 'jo', gross: 1780.5, inHand: 0 }, { staffId: 'lee', gross: 900, inHand: 0, contractor: true }], forms: { jo: { federal: { status: 'single' }, state: {} } }, ytd: {} });
check('contractors have nothing worked out', !run.by.lee && run.by.jo?.takeHome === 1461.48 && run.takeHome === 1461.48, run);
check('paydays a year from the pay periods', periodsPerYear(tenant) === 26 && periodsPerYear({ payroll: { cadence: 'weekly' } }) === 52 && periodsPerYear({ payroll: { cadence: 'monthly' } }) === 12);

console.log('When it’s due');
check('federal holidays, observed: July 4 on a Saturday is the Friday', federalHolidays(2026).includes('2026-07-03') && federalHolidays(2026).includes('2026-11-26') && federalHolidays(2026).includes('2026-01-19'));
const d = dueDates('2026-12-03', tenant);
check('monthly: the IRS by the 15th of the next month; North Carolina’s December by January 31 (a Sunday, so Monday)', d.irs === '2027-01-15' && d.state === '2027-02-01', d);
check('North Carolina monthly, any other month: the 15th of the next', dueDates('2026-11-19', tenant).state === '2026-12-15');
check('North Carolina twice a week, as the IRS', dueDates('2026-12-03', { ...tenant, payrollTax: { stateFiling: 'semiweekly' } }).state === '2026-12-09');
check('unemployment: the end of the month after the quarter, a Sunday moves to Monday', d.sui === '2027-02-01' && d.futa === '2027-02-01', d);
check('a 15th on a Sunday moves to the Monday', dueDates('2026-02-20', tenant).irs === '2026-03-16');
const semi = { ...tenant, payrollTax: { federalDeposits: 'semiweekly', stateFiling: 'quarterly' } };
check('twice a week: a Thursday payday by the next Wednesday', dueDates('2026-12-03', semi).irs === '2026-12-09');
check('twice a week: a Tuesday payday by the Friday', dueDates('2026-12-01', semi).irs === '2026-12-04');
check('twice a week: Thanksgiving in the three days moves it to Monday', dueDates('2026-11-24', semi).irs === '2026-11-30', dueDates('2026-11-24', semi));
check('North Carolina quarterly: the end of the month after the quarter', dueDates('2026-12-03', semi).state === '2027-02-01');
check('another state’s own dates aren’t known here', dueDates('2026-12-03', { ...tenant, taxState: 'GA' }).state === null);

console.log('So far this year');
const runs = [
  { kind: 'payday', periodKey: '2026-11-02_2026-11-15', from: '2026-11-02', to: '2026-11-15', payDate: '2026-11-19', people: [{ staffId: 'jo', paid: 1000, cashTips: 0, taxes: { wages: { socialSecurity: 950, medicare: 950, futa: 950, sui: 950 } } }, { staffId: 'lee', paid: 900, contractor: true }] },
  { kind: 'payday', periodKey: '2026-10-19_2026-11-01', from: '2026-10-19', to: '2026-11-01', recordedAt: '2026-11-04T15:00:00Z', people: [{ staffId: 'jo', paid: 800, cashTips: 50 }] },
  { kind: 'payday', periodKey: '2025-12-15_2025-12-28', from: '2025-12-15', to: '2025-12-28', payDate: '2026-01-01', people: [{ staffId: 'jo', paid: 500 }] },
  { kind: 'payday', periodKey: '2025-12-01_2025-12-14', from: '2025-12-01', to: '2025-12-14', payDate: '2025-12-18', people: [{ staffId: 'jo', paid: 400 }] },
  { kind: 'gusto', payrollId: 'x', people: 3 },
];
const ytd = ytdFrom(runs, tenant, 2026);
check('paydays paid this year count (a late-December period paid in January too); last year’s, contractors and Gusto runs don’t', ytd.jo?.ssWages === 950 + 850 + 500 && !ytd.lee, ytd);
check('a payday recorded before taxes were kept counts what was paid, cash tips included', ytd.jo?.futaWages === 2300);
check('the payday being recorded isn’t counted twice', ytdFrom(runs, tenant, 2026, '2026-11-02_2026-11-15').jo?.ssWages === 1350);
check('a run’s pay date: its own, else its pay period’s payday', payDateOf(runs[0], tenant) === '2026-11-19' && payDateOf(runs[1], tenant) === '2026-11-05', payDateOf(runs[1], tenant));
check('…else the day it was recorded, in the business’s own time zone (late on December 31 is still December 31)', payDateOf({ from: '2026-12-20', to: '2026-12-29', recordedAt: '2027-01-01T03:30:00.000Z' }, tenant) === '2026-12-31');

console.log('Who runs payroll, and the forms as typed');
check('nothing changes until the business picks: a payroll company, or Gusto when it’s connected; ClarityFlow only when chosen', runByOf({}) === 'company' && runByOf({ gusto: { connected: true } }) === 'gusto' && runByOf({ payrollTax: { runBy: 'clarityflow' } }) === 'clarityflow'
  && !runByChosen({}) && !runByChosen({ gusto: { connected: true } }) && runByChosen({ payrollTax: { runBy: 'company' } }));
const cf = cleanTaxForms({ federal: { status: 'hoh', dependents: '2000', extra: -5, junk: 1 }, state: { allowances: 2.7, pct: 99 }, pretax: { retirement: 'x' }, payMethod: 'wire', ssn: '123' });
check('forms are cleaned: numbers in range, unknown fields and methods dropped, no tax numbers kept', cf.federal?.status === 'hoh' && cf.federal?.dependents === 2000 && cf.federal?.extra === 0 && !(cf.federal as any).junk && cf.state?.allowances === 2 && cf.state?.pct === 20 && !cf.pretax && !cf.payMethod && !(cf as any).ssn, cf);
check('a year without its own tables uses the latest and says so', withholdingFor({ ...base, year: 2027, gross: 500 }).flags.includes('stale_tables'));

if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nAll passed');
