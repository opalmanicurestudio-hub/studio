// Checks payroll gives one right number everywhere (the payroll audit, round 1):
//   One set of pay periods: Payday opens on the period being paid (the one that ended, until its payday passes), its arrows
//   move a whole period, and the draft is built for the period that ended last, once, the same dates as the stubs.
//   Approved pay corrections are in what Payday pays, the draft and what Gusto is sent, as they are on the stub.
//   A contractor is paid what they earned: no overtime or minimum-wage top-up, no employer payroll taxes, booked as
//   contract labor, never sent to the employee payroll.
//   Cash tips taken home the same day (when the business pays them that way) aren't paid again on payday: they're
//   reported to payroll as cash tips, and booked as the cash that left the till.
//   Gusto is only sent to the open payroll that covers the period; never another one in its place.
//   What came in is the books' own reading (never sales tax), for Payday and the draft alike.
//   Recording payday says it doesn't withhold or file anyone's taxes.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/payroll-one-number.verify.ts
import fs from 'fs';
import { makeDb, check, failures } from './fake-db';
import { periodPay, paidOnPayday, payrollFields } from '../../src/lib/pay-period';
import { periodOf, periodToPay, periodBefore, periodAfter, recentPeriods, periodRange, cadenceWords } from '../../src/lib/pay-periods';
import { buildPayrollDraft, runPayrollGates } from '../../src/lib/payroll-draft';
import { buildStatement } from '../../src/lib/pay-statement';
import { sessionsFrom } from '../../src/lib/timeclock';
import { estimateEmployerPayrollTax, getStateProfile } from '../../src/lib/state-tax-profiles';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const tz = 'America/New_York'; const at = (d: string, hm: string) => new Date(`${d}T${hm}:00-05:00`).toISOString();
const P = (staffId: string, type: string, d: string, hm: string) => ({ staffId, type, timestamp: at(d, hm), timesheetStatus: 'approved' });
// Monday to Friday, November 16 to 20, 8 to 5: 45 hours.
const week = (staffId: string) => ['16', '17', '18', '19', '20'].flatMap((d) => [P(staffId, 'clock_in', `2026-11-${d}`, '08:00'), P(staffId, 'clock_out', `2026-11-${d}`, '17:00')]);
const tenant = { timezone: tz, workweekStartsOn: 1, payroll: { cadence: 'bi-weekly', periodAnchor: '2026-11-02', paydayAfterDays: 4 }, payRules: { state: 'GA' } };
const ana = { id: 'a', name: 'Ana', payStructure: 'hourly', hourlyRate: 15, employmentType: 'w2_employee', gustoEmployeeId: 'g-a' };
const cy = { id: 'c', name: 'Cy', payStructure: 'hourly', hourlyRate: 20, employmentType: 'contractor' };
const tip = (amount: number, method: string, d = '2026-11-18') => ({ id: `tip${amount}`, type: 'income', category: 'Tips', amount, staffId: 'a', paymentMethod: method, date: at(d, '12:00') });

(async () => {
  console.log('one set of pay periods');
  const noon = (d: string) => Date.parse(`${d}T17:00:00Z`);
  const p = periodOf(tenant, '2026-11-26');
  check('a period: two weeks from the anchor, paid four days after it ends', p.from === '2026-11-16' && p.to === '2026-11-29' && p.payday === '2026-12-03', p);
  check('Payday opens on the period being paid: the one that ended, until two days after its payday',
    periodToPay(tenant, noon('2026-11-18')).from === '2026-11-02' && periodToPay(tenant, noon('2026-11-21')).from === '2026-11-02' && periodToPay(tenant, noon('2026-11-22')).from === '2026-11-16',
    [periodToPay(tenant, noon('2026-11-21')), periodToPay(tenant, noon('2026-11-22'))]);
  const payOnLastDay = { ...tenant, payroll: { ...tenant.payroll, paydayAfterDays: 0 } };
  check('…so a payday on the period’s last day still opens on it the morning after', periodToPay(payOnLastDay, noon('2026-11-30')).from === '2026-11-16' && periodToPay(payOnLastDay, noon('2026-12-02')).from === '2026-11-30', periodToPay(payOnLastDay, noon('2026-11-30')));
  check('the arrows move a whole period', periodBefore(tenant, p).from === '2026-11-02' && periodAfter(tenant, p).from === '2026-11-30' && periodAfter(tenant, p).to === '2026-12-13');
  check('how often, in words', cadenceWords(tenant) === 'every two weeks' && cadenceWords({ payroll: { cadence: 'weekly' } }) === 'every week' && cadenceWords({ payroll: { cadence: 'monthly' } }) === 'every month');
  const ended = recentPeriods(tenant, 2, noon('2026-11-30'))[1];
  check('the draft is for the period that ended last', ended.from === '2026-11-16' && ended.to === '2026-11-29', ended);
  const r = periodRange(tenant, p);
  check('…covering the business’s own days, midnight to midnight', r.fromIso === '2026-11-16T05:00:00.000Z' && r.toIso === '2026-11-30T04:59:59.999Z', r);

  console.log('contractors and cash tips');
  const sessions = sessionsFrom([...week('a'), ...week('c')] as any, { timeZone: tz, now: noon('2026-11-26') } as any);
  const pay = (member: any, t: any = tenant, txns: any[] = []) => periodPay({ member, from: r.fromIso, to: r.toIso, incomeTxns: txns, services: [], tenant: t, sessions });
  const la = pay(ana), lc = pay(cy);
  check('an employee: 45 hours, 5 of them overtime at time and a half', la.hours === 45 && la.overtimeHours === 5 && la.hourlyPay === 712.5 && !la.contractor, la);
  check('a contractor: 45 hours at their rate, no overtime', lc.contractor && lc.hours === 45 && lc.overtimeHours === 0 && lc.overtimePremium === 0 && lc.hourlyPay === 900 && lc.total === 900, lc);
  const cheap = pay({ ...cy, hourlyRate: 3 });
  check('…and no minimum-wage top-up', cheap.minWageTopUp === 0 && cheap.total === 135, cheap);
  const tips = [tip(40, 'Cash'), tip(60, 'Card')];
  const paycheck = pay(ana, tenant, tips), sameDay = pay(ana, { ...tenant, payRules: { ...tenant.payRules, cashTips: 'same_day' } }, tips);
  check('cash tips paid on the paycheck (the default): all of it is paid on payday', paycheck.tips === 100 && paycheck.cashTips === 40 && paycheck.tipsInHand === 0 && paidOnPayday(paycheck) === paycheck.total, paycheck);
  check('cash tips taken home the same day: what they earned is the same, and the cash isn’t paid again',
    sameDay.total === paycheck.total && sameDay.tipsInHand === 40 && paidOnPayday(sameDay) === Math.round((sameDay.total - 40) * 100) / 100, { total: sameDay.total, paid: paidOnPayday(sameDay) });
  const f = payrollFields(sameDay);
  check('…reported to payroll as cash tips, the rest as paycheck tips', f.tips === 60 && f.cashTips === 40, f);
  const st = buildStatement({ member: cy, from: '2026-11-16', to: '2026-11-29', incomeTxns: [], services: [], tenant, punches: week('c') });
  const st2 = buildStatement({ member: ana, from: '2026-11-16', to: '2026-11-29', incomeTxns: tips, services: [], tenant: { ...tenant, payRules: { ...tenant.payRules, cashTips: 'same_day' } }, punches: week('a') });
  check('the pay statement says so', st.notes.some((n) => /Paid as a contractor/.test(n)) && st2.notes.some((n) => /\$40\.00 of your tips were cash you took home/.test(n)), [st.notes, st2.notes]);

  console.log('the payroll draft');
  const db = makeDb();
  await db.doc('tenants/t1').set({ ...tenant, payRules: { ...tenant.payRules, cashTips: 'same_day' } });
  await db.doc('tenants/t1/staff/a').set(ana); await db.doc('tenants/t1/staff/c').set(cy);
  for (const x of [...week('a'), ...week('c')]) await db.collection('tenants/t1/activityLogs').add(x);
  const lines = [
    ...tips,
    { id: 's1', type: 'income', category: 'Service Revenue', amount: 1000, date: at('2026-11-19', '12:00') },
    { id: 's2', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 80, date: at('2026-11-19', '12:00') },
    { id: 'e1', type: 'expense', category: 'Payroll', taxBucket: 'payroll', amount: 200, date: at('2026-11-21', '12:00') },
    { id: 'e2', type: 'expense', category: 'Contract Labor', amount: 100, date: at('2026-11-21', '12:00') },
  ];
  for (const t of lines) await db.doc(`tenants/t1/transactions/${t.id}`).set(t);
  await db.doc('tenants/t1/payAdjustments/j1').set({ staffId: 'a', amountCents: 2500, date: at('2026-11-24', '10:00') });
  await db.doc('tenants/t1/payAdjustments/j2').set({ staffId: 'a', amountCents: 9900, date: at('2026-12-01', '10:00') });
  const d = await buildPayrollDraft(db, 't1', new Date(r.fromIso), new Date(r.toIso));
  const da = d.lines.find((l) => l.staffId === 'a')!, dc = d.lines.find((l) => l.staffId === 'c')!;
  check('an approved correction dated in the period is added (one dated after it waits)', da.adjustments === 25 && da.earned === 837.5 && da.total === 797.5, da);
  check('…the cash tips taken home aren’t paid again, and are reported as cash tips', da.cashTips === 40 && da.tips === 60, da);
  check('the contractor is marked as one, with no overtime', dc.contractor === true && dc.overtimeHours === 0 && dc.total === 900, dc);
  check('what’s paid in all: what each person is paid on payday', d.grossTotal === 1697.5, d.grossTotal);
  const est = Number(estimateEmployerPayrollTax(837.5, getStateProfile('GA')).toFixed(2));
  check('employer payroll taxes on employees’ wages only (cash tips included), never a contractor’s', d.estimatedEmployerTaxes === est && est > 0, { got: d.estimatedEmployerTaxes, est });
  check('the state comes from the pay rules when no tax state is set', d.stateCode === 'GA', d.stateCode);
  check('what came in is the books’ own reading: never the sales tax; pay already booked added back, contract labor stays a cost', d.periodNetIncome === 1000, d.periodNetIncome);
  const g = runPayrollGates(d).gates.find((x) => x.key === 'all_matched')!;
  check('“every employee matched to Gusto” counts employees, never contractors', g.passed === true, g);

  console.log('the draft each pay period');
  const cron = src('src/app/api/cron/payroll-draft/route.ts');
  check('the draft is for the business’s own period that ended last, built once, over its own days',
    /const ended = recentPeriods\(tenant, 2, now\.getTime\(\)\)\[1\];/.test(cron) && /payroll\.lastDraftKey === ended\.from/.test(cron)
    && /const \{ fromIso, toIso \} = periodRange\(tenant, ended\);/.test(cron) && /periodKey: ended\.from, payday: ended\.payday/.test(cron) && /lastDraftKey: ended\.from/.test(cron)
    && !/CADENCE_DAYS|lastPeriod\(/.test(cron));
  check('the note says what’s ready in plain words', /title: 'A payroll draft is ready'/.test(cron) && /Open Payday to look it over and approve it\./.test(cron) && !/—/.test(cron.slice(cron.indexOf('title:'), cron.indexOf('draftId:'))));

  console.log('Gusto');
  const gusto = src('src/app/api/gusto/payroll/route.ts');
  check('contractors are refused, never sent to the employee payroll', /if \(draft\.lines\.some\(\(l: any\) => l\.contractor\)\) return NextResponse\.json\(\{ status: 'failed', error: 'Contractors aren’t on the employee payroll/.test(gusto)
    && gusto.indexOf('l.contractor') < gusto.indexOf('/payrolls?processing_statuses=unprocessed'));
  check('only the open payroll covering the period’s last day is filled in; never another one in its place',
    /const endDay = String\(draft\.periodEndDay \|\| draft\.periodEnd \|\| ''\)\.slice\(0, 10\);/.test(gusto) && /const target = list\.find\(covers\);\s+if \(!target\) \{/.test(gusto) && !/list\[0\]|\|\| list\./.test(gusto));
  check('cash tips taken home go to Gusto as cash tips (added on the person’s own job when Gusto’s payroll has no line for them)', /'cash tips': line\.cashTips \|\| 0/.test(gusto) && /'paycheck tips': line\.tips/.test(gusto)
    && /amount: dollars\(amt\), \.\.\.\(job \? \{ job_uuid: job \} : \{\}\)/.test(gusto));

  console.log('the Payday tab');
  const page = src('src/app/(app)/money/page.tsx'); const tab = page.slice(page.indexOf('const PaydayTab'), page.indexOf('// ─── BillsTab'));
  check('it opens on the period being paid, from the business’s own pay periods', /periodToPay\(selectedTenant/.test(tab) && /periodBefore\(selectedTenant/.test(tab) && /periodAfter\(selectedTenant/.test(tab) && /periodRange\(selectedTenant/.test(tab));
  check('approved corrections dated in these dates are read and added to what’s paid', /collection\(firestore, 'tenants', tenantId, 'payAdjustments'\), where\('date', '>=', fromIso\), where\('date', '<=', toIso\)/.test(tab)
    && /amount: Math\.round\(\(paidOnPayday\(l\) \+ adj\) \* 100\) \/ 100/.test(tab) && /earned: Math\.round\(\(l\.total \+ adj\) \* 100\) \/ 100/.test(tab) && /bonus: Math\.round\(\(f\.bonus \+ adj\) \* 100\) \/ 100/.test(tab));
  check('employer taxes are on employees’ wages only', /const employerTaxes = estimateEmployerPayrollTax\(employeeWages, stateProfile\)/.test(tab) && /staffObligations\.filter\(\(o\) => !o\.contractor\)\.reduce\(\(sum, o\) => sum \+ o\.earned, 0\)/.test(tab));
  const rec = src('src/lib/payday-record.ts');
  check('recording payday books contractors as contract labor, and cash tips taken home as the cash that left the till',
    /category: 'Contract Labor', taxBucket: 'operating_cost'/.test(rec) && /`paydaycash_\$\{periodKey\}`/.test(rec) && /paymentMethod: 'Cash'/.test(rec)
    && /contractor: !!o\.contractor/.test(tab) && /cash: cashLineOf\(o\)/.test(tab));
  check('Gusto is sent employees with pay only, with the period’s last day and the cash tips', /const payees = employees\.filter\(o => o\.earned > 0\);/.test(tab) && /lines: payees\.map\(o => \(\{/.test(tab)
    && /periodEndDay: dayTo/.test(tab) && /cashTips: Number\(\(o\.cashTips \|\| 0\)\.toFixed\(2\)\)/.test(tab) && /result\.status === 'synced_not_submitted'/.test(tab));
  const screen = src('src/components/money/PaydayScreen.tsx');
  check('cash tips taken home come off what’s left after payday, and the books get them once, never more than the person earned',
    /const left = Math\.round\(\(p\.cameIn - payday - cashOut - billsTotal\) \* 100\) \/ 100;/.test(screen) && /label="Cash tips taken home"/.test(screen)
    && /const cashLineOf = \(o: \{ tipsInHand\?: number; earned: number \}\) => Math\.round\(Math\.min\(Number\(o\.tipsInHand\) \|\| 0, Math\.max\(0, o\.earned\)\) \* 100\) \/ 100;/.test(tab)
    && /cash = \(p: PaydayPerson\) => r2\(Math\.min\(p\.cash, Math\.max\(0, p\.amount \+ p\.cash\)\)\)/.test(rec) && /cashTipsOut=\{cashTipsOut\}/.test(tab));
  check('when the approved corrections can’t be read, payday isn’t recorded or sent without them, and the screen says why',
    /error: adjustmentsError \} = useCollection/.test(tab) && /if \(!firestore \|\| !tenantId \|\| recorded \|\| adjustmentsError\) return;/.test(tab) && /if \(payees\.length === 0 \|\| !tenantId \|\| adjustmentsError\) return;/.test(tab)
    && /blocked=\{adjustmentsError \? 'Approved pay corrections couldn’t be read/.test(tab) && /disabled=\{\(p\.setAside <= 0 && !p\.team\.length\) \|\| p\.recording \|\| !!p\.blocked\}/.test(screen) && /p\.sendingToGusto \|\| !!p\.blocked\}/.test(screen));
  check('recording payday says it doesn’t withhold or file anyone’s taxes', /It doesn’t withhold or file anyone’s taxes: for employees, a payroll company does that\./.test(screen));
  check('a contractor is shown as one, and their share of the team’s pay is named', />Contractor</.test(screen) && /of it to \$\{contractors === 1 \? 'a contractor'/.test(screen));
  const settings = src('src/app/(app)/settings/page.tsx');
  check('the business says how cash tips are paid (on the paycheck, or taken home the same day)', /pr\.cashTips === 'same_day'/.test(settings) && /set\(\{ cashTips: e\.target\.value \}\)/.test(settings) && /Taken home the same day/.test(settings));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
