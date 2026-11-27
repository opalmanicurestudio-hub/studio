// Checks payroll taxes owed and paid, and the quarter's forms, when payroll is run in ClarityFlow (lib/payroll-owed;
// design board "Payroll run in ClarityFlow", round 2):
//   The paydays' taxes are put together the way they're paid: the IRS by each month's paydays (by the 15th of the next)
//   or each payday's own (twice a week), North Carolina's NC-5 the same (December's by January 31, or each quarter),
//   state unemployment each quarter, federal unemployment each quarter once the year's unpaid total passes $500 (else it
//   carries over, to Form 940). One still building up says so and can't be marked paid yet.
//   "I paid it" and taking it back (api/payroll/taxes, payroll roles only, nothing booked), and paying the rest when a
//   payday recorded later adds to one; a bank payment for what one has left marks it paid on its own, to whom it's owed
//   (lib/plaid-sync), settling it within a dollar, and the mark goes if that line is sorted as something else.
//   From January 1 of last year on, so in January last year's fourth quarter and federal unemployment are all there.
//   Reminders three days before, on the day and the day after, once each (the rest once more), to the owner's own team
//   record (cron/payroll-draft).
//   Form 941 line by line (line 1 by the pay period with the 12th, tips apart, the extra Medicare's own wages, rounding,
//   what couldn't be withheld, paid this quarter, line 16 by the $2,500 rule and how often it's paid), NC-5 and NCUI
//   101 (each person's wages over the yearly limit), with no Social Security number or EIN anywhere.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/payroll-owed.verify.ts
import fs from 'fs';
import { makeDb, check, failures } from './fake-db';
import { recordPayday, cleanPayday } from '../../src/lib/payday-record';
import { owedItems, form941, formNC5, formNCUI101, remindersDue, paymentsOf } from '../../src/lib/payroll-owed';
import { owedRunsFrom } from '../../src/lib/payroll-taxes';
import { dropBankTaxMark } from '../../src/lib/payroll-tax-marks';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const base = { timezone: 'America/New_York', workweekStartsOn: 1, payroll: { cadence: 'bi-weekly', periodAnchor: '2026-11-02', paydayAfterDays: 4 }, taxState: 'NC' };
const forms: any = { jo: { federal: { status: 'single' }, state: { status: 'single' } }, rae: { federal: { status: 'married', dependents: 2000 }, state: { status: 'married' } } };
const day = (from: string, to: string, people: any[]) => cleanPayday({ periodKey: `${from}_${to}`, from, to, setAsides: [], people }) as any;
const jo = (amount: number, tips = 0) => ({ staffId: 'jo', name: 'Jo Park', amount, cash: 0, contractor: false, tips });
const rae = (amount: number, cash: number, tips = 0) => ({ staffId: 'rae', name: 'Rae Lin', amount, cash, contractor: false, tips });

(async () => {
  const runsOf = async (db: any) => (await db.collection('tenants/t1/payrollRuns').get()).docs.map((d: any) => d.data());
  console.log('What’s owed, the way it’s paid (monthly)');
  const t: any = { ...base, payrollTax: { runBy: 'clarityflow' } };
  const db = makeDb(); await db.doc('tenants/t1').set(t);
  // Paydays November 5 and 19, and December 3 (Rae's $120 in cash tips taken home on the last).
  await recordPayday(db, 't1', t, day('2026-10-19', '2026-11-01', [jo(1600, 300)]), {}, '2026-11-05T15:00:00.000Z', forms);
  await recordPayday(db, 't1', t, day('2026-11-02', '2026-11-15', [jo(1700, 350)]), {}, '2026-11-19T15:00:00.000Z', forms);
  await recordPayday(db, 't1', t, day('2026-11-16', '2026-11-29', [jo(1780.5, 412.5), rae(1506, 120, 386)]), {}, '2026-12-03T15:00:00.000Z', forms);
  let runs = await runsOf(db);
  const owed = (r: any[]) => r.filter((x) => x.kind === 'payday').reduce((m: any, x: any) => { for (const [k, v] of Object.entries(x.taxes.owed)) if (typeof v === 'number') m[k] = Math.round(((m[k] || 0) + v) * 100) / 100; return m; }, {});
  const items = owedItems(runs, t, '2026-12-05', 'North Carolina'); const by = (k: string) => items.find((i) => i.key === k);
  const nov = runs.filter((r: any) => r.kind === 'payday' && r.payDate?.startsWith('2026-11'));
  check('the IRS: November’s two paydays together, by December 15', by('irs_2026-12-15')?.amount === owed(nov).irs && by('irs_2026-12-15')?.paydays.length === 2 && by('irs_2026-12-15')?.name === 'IRS, November’s paydays' && !by('irs_2026-12-15')?.open, by('irs_2026-12-15'));
  check('…December’s so far, by January 15, still adding up', by('irs_2027-01-15')?.open === true && by('irs_2027-01-15')?.name === 'IRS, December’s paydays');
  check('North Carolina: November’s by December 15; December’s by January 31 (a Sunday, so February 1)', by('state_2026-12-15')?.amount === owed(nov).state && !!by('state_2027-02-01'), items.map((i) => i.key));
  check('state unemployment for October to December, by February 1', by('sui_2026q4')?.due === '2027-02-01' && by('sui_2026q4')?.open === true);
  check('federal unemployment under $500 for the year: it carries over, never asked for on its own', items.filter((i) => i.agency === 'futa').every((i) => i.carries || i.name.includes('Form 940')), items.filter((i) => i.agency === 'futa'));
  check('they’re in order of when they’re due', items.map((i) => i.due || '9').join() === [...items].map((i) => i.due || '9').sort().join());

  console.log('Twice a week, quarterly');
  const t2: any = { ...base, payrollTax: { runBy: 'clarityflow', federalDeposits: 'semiweekly', stateFiling: 'quarterly' } };
  const db2 = makeDb(); await db2.doc('tenants/t1').set(t2);
  await recordPayday(db2, 't1', t2, day('2026-11-02', '2026-11-15', [jo(1700)]), {}, '2026-11-19T15:00:00.000Z', forms);
  await recordPayday(db2, 't1', t2, day('2026-11-16', '2026-11-29', [jo(1780.5)]), {}, '2026-12-03T15:00:00.000Z', forms);
  const items2 = owedItems(await runsOf(db2), t2, '2026-12-05', 'North Carolina');
  check('the IRS twice a week: each payday its own, by the Wednesday after', items2.some((i) => i.key === 'irs_2026-11-25' && i.name === 'IRS, payday of November 19') && items2.some((i) => i.key === 'irs_2026-12-09'), items2.map((i) => i.key));
  check('North Carolina each quarter: both paydays together, by February 1', items2.filter((i) => i.agency === 'state').length === 1 && items2.find((i) => i.agency === 'state')?.due === '2027-02-01' && items2.find((i) => i.agency === 'state')?.name === 'North Carolina income tax, October to December');

  console.log('Federal unemployment over the year');
  const futaRun = (periodKey: string, payDate: string, futa: number) => ({ kind: 'payday', runBy: 'clarityflow', periodKey, payDate, from: payDate, to: payDate, people: [], taxes: { owed: { irs: 0, state: 0, sui: 0, futa, other: [] }, due: {} } });
  const fr = [futaRun('a', '2026-02-10', 300), futaRun('b', '2026-05-10', 250), futaRun('c', '2026-08-10', 100)];
  const fi = owedItems(fr, base, '2026-08-20').filter((i) => i.agency === 'futa');
  check('$300 in the first quarter carries; with $250 more it passes $500: paid for the second quarter, by July 31', fi.find((i) => i.key === 'futa_2026q2')?.amount === 550 && fi.find((i) => i.key === 'futa_2026q2')?.due === '2026-07-31' && !fi.some((i) => i.key === 'futa_2026q1'), fi);
  check('…and the third quarter’s starts again, carrying for now', fi.find((i) => i.key === 'futa_2026q3')?.amount === 100 && fi.find((i) => i.key === 'futa_2026q3')?.carries === true);

  console.log('Paid');
  const pay = { kind: 'taxpayment', key: 'irs_2026-12-15', amount: by('irs_2026-12-15')!.amount, paidOn: '2026-12-10', recordedAt: '2026-12-10T12:00:00Z', source: 'hand' };
  const items3 = owedItems([...runs, pay], t, '2026-12-11', 'North Carolina');
  check('a payment marks its own one paid, and only it', items3.find((i) => i.key === 'irs_2026-12-15')?.paid?.paidOn === '2026-12-10' && items3.filter((i) => i.paid).length === 1 && paymentsOf([pay])['irs_2026-12-15']?.amount === pay.amount);
  const short = { ...pay, amount: Math.round((pay.amount - 50) * 100) / 100 };
  const part = owedItems([...runs, short], t, '2026-12-16', 'North Carolina').find((i) => i.key === 'irs_2026-12-15')!;
  check('paid in part (a payday recorded late added to it): the rest is still to pay, and reminded', part.left === 50 && remindersDue([part], '2026-12-16').some((r) => r.key === 'irs_2026-12-15_rest' && /\$50\.00 still to pay/.test(r.body)), part);
  check('…shown as the rest on Payday, and it can be paid too: a second payment adds to the first', /name: i\.paid \? `\$\{i\.name\}, the rest` : i\.name, amount: i\.left/.test(src('src/app/(app)/money/page.tsx'))
    && /payable: !i\.open && !i\.carries \}/.test(src('src/app/(app)/money/page.tsx')) && /add: !!owedList\.find\(\(i\) => i\.key === key\)\?\.paid/.test(src('src/app/(app)/money/page.tsx')));
  const two = { ...short, parts: [{ amount: short.amount, paidOn: '2026-12-10', source: 'hand' }, { amount: 50, paidOn: '2026-12-16', source: 'hand' }], amount: pay.amount };
  check('…both payments together pay it', owedItems([...runs, two], t, '2026-12-17', 'North Carolina').find((i) => i.key === 'irs_2026-12-15')?.left === 0);
  check('the rest is reminded once, apart from the first reminders', remindersDue([part], '2026-12-16', { 'irs_2026-12-15_late': 'x' }).length === 1 && remindersDue([part], '2026-12-16', { 'irs_2026-12-15_rest_late': 'x' }).length === 0);
  const owedIrs = by('irs_2026-12-15')!.amount;
  const bankShort = { kind: 'taxpayment', key: 'irs_2026-12-15', amount: Math.round((owedIrs - 0.4) * 100) / 100, covers: owedIrs, paidOn: '2026-12-11', recordedAt: '2026-12-11T12:00:00Z', source: 'bank', bankTransactionId: 'b9', parts: [{ amount: Math.round((owedIrs - 0.4) * 100) / 100, paidOn: '2026-12-11', source: 'bank', bankTransactionId: 'b9' }] };
  check('a bank payment 40 cents short of what it owed then settles it', owedItems([...runs, bankShort], t, '2026-12-16', 'North Carolina').find((i) => i.key === 'irs_2026-12-15')?.left === 0);
  const lateDay = { ...runs.find((r: any) => r.kind === 'payday' && r.payDate === '2026-11-19'), periodKey: 'late', taxes: { ...runs.find((r: any) => r.kind === 'payday' && r.payDate === '2026-11-19').taxes, owed: { irs: 100, state: 0, sui: 0, futa: 0, other: [] } } };
  check('…and a payday recorded after it adds what’s still to pay', owedItems([...runs, bankShort, lateDay], t, '2026-12-16', 'North Carolina').find((i) => i.key === 'irs_2026-12-15')?.left === 100);
  const route = src('src/app/api/payroll/taxes/route.ts');
  check('"I paid it" and taking it back: payroll roles only, a known payroll tax, a real day, kept as a payroll run, nothing booked',
    (route.match(/requireCan\(req, tenantId, 'money\.payroll'\)/g) || []).length === 2 && /const KEY = \/\^\(irs\|state\|sui\|futa\|other\)_/.test(route)
    && /payrollRuns\/taxpay_\$\{key\}`\)/.test(route) && /tx\.set\(ref, \{ kind: 'taxpayment', key, amount, paidOn/.test(route) && /b\?\.add === true/.test(route) && /parts: all/.test(route) && !/transactions/.test(route) && /logAuditAdmin/.test(route));
  const sync = src('src/lib/plaid-sync.ts');
  check('a bank payment for what one has left marks it paid, from the bank, within a dollar', /if \(deposit === 'paid'\) \{/.test(sync) && /fits\.length === 1/.test(sync) && /Math\.abs\(Math\.round\(i\.left \* 100\) - cents\) <= 100/.test(sync)
    && /owedOpen = owedItems\(all, tenantDoc, '9999-12-31'\)\.filter\(\(i\) => i\.left >= 0\.01 && !i\.carries\)/.test(sync) && /covers: it\.amount, parts/.test(sync) && /\.\.\.\(taxPayKey \? \{ taxPayKey \} : \{\}\)/.test(sync));
  check('…to whom it’s owed: the IRS for federal, the Department of Revenue for income tax, Employment Security for unemployment',
    /\? \['irs', 'futa'\] : \/REVENUE\|NCDOR\/\.test\(payee\) \? \['state'\] : \/EMPLOYMENT SECURITY\|NCDES\|UNEMPLOYMENT\/\.test\(payee\) \? \['sui'\] : \['state', 'sui'\]/.test(sync));
  // The bank line sorted as something else: the mark goes; a hand payment with it stays.
  const mdb = makeDb();
  await mdb.doc('tenants/t1/payrollRuns/taxpay_irs_2026-12-15').set({ kind: 'taxpayment', key: 'irs_2026-12-15', amount: 150, covers: 140, paidOn: '2026-12-11', source: 'mixed', bankTransactionId: 'b9',
    parts: [{ amount: 50, paidOn: '2026-12-02', source: 'hand' }, { amount: 100, paidOn: '2026-12-11', source: 'bank', bankTransactionId: 'b9' }] });
  await mdb.doc('tenants/t1/bankTransactions/b9').set({ taxPayKey: 'irs_2026-12-15' });
  const dropped = await dropBankTaxMark(mdb, 't1', 'b9', 'irs_2026-12-15');
  const after: any = (await mdb.doc('tenants/t1/payrollRuns/taxpay_irs_2026-12-15').get()).data();
  check('a bank line sorted as something else: its payment comes off, the one marked by hand stays, and it no longer settles it', dropped && after?.amount === 50 && after.parts.length === 1 && !after.covers && after.bankTransactionId === null && (await mdb.doc('tenants/t1/bankTransactions/b9').get()).data()?.taxPayKey === null, after);
  await mdb.doc('tenants/t1/payrollRuns/taxpay_sui_2026q4').set({ kind: 'taxpayment', key: 'sui_2026q4', amount: 30, paidOn: '2026-12-11', source: 'bank', bankTransactionId: 'b8' });
  await dropBankTaxMark(mdb, 't1', 'b8', 'sui_2026q4');
  check('…one the bank alone marked is unmarked', !(await mdb.doc('tenants/t1/payrollRuns/taxpay_sui_2026q4').get()).exists);
  const plaidRoute = src('src/app/api/plaid/route.ts');
  check('…when it’s ignored, matched to lines that aren’t payday’s payroll taxes, booked or changed to another category',
    (plaidRoute.match(/dropBankTaxMark\(db, tenantId, /g) || []).length === 5 && /finalCategory !== 'Payroll Tax Deposit'\) await dropBankTaxMark/.test(plaidRoute) && /bt\.category !== 'Payroll Tax Deposit'\) await dropBankTaxMark/.test(plaidRoute)
    && /!\/\^payroll tax\(es\| deposit\)\$\/i\.test\(category\)\) await dropBankTaxMark/.test(plaidRoute));
  console.log('January');
  check('what’s owed and the forms are read from January 1 of last year: Payday, the bank sync and the reminders', owedRunsFrom(2027) === '2026-01-01'
    && /where\('recordedAt', '>=', owedRunsFrom\(runsYear\)\), limit\(1500\)/.test(src('src/app/(app)/money/page.tsx')) && /owedRunsFrom\(Number\(todayIn\(tenantDoc\)\.slice\(0, 4\)\)\)/.test(sync)
    && /owedRunsFrom\(Number\(today\.slice\(0, 4\)\)\)/.test(src('src/app/api/cron/payroll-draft/route.ts')));
  const jan = owedItems(runs, t, '2027-01-20', 'North Carolina');
  check('…so in January, October to December’s unemployment and North Carolina’s December are still there to pay', !!jan.find((i) => i.key === 'sui_2026q4' && !i.open) && !!jan.find((i) => i.key === 'state_2027-02-01' && !i.open), jan.map((i) => i.key));

  console.log('Reminders');
  const due = remindersDue(items, '2026-12-12');
  check('three days before: November’s IRS and North Carolina payments, not December’s still adding up, not unemployment carrying over', due.length === 2 && due.every((r) => r.stage === 'soon') && due.some((r) => r.key === 'irs_2026-12-15') && /EFTPS/.test(due.find((r) => r.key === 'irs_2026-12-15')!.body), due);
  check('…once', remindersDue(items, '2026-12-12', { 'irs_2026-12-15_soon': 'x', 'state_2026-12-15_soon': 'x' }).length === 0);
  check('on the day, and the day after', remindersDue(items, '2026-12-15').every((r) => r.stage === 'today') && remindersDue(items, '2026-12-16').some((r) => r.stage === 'late' && /was due December 15/.test(r.title)));
  check('never for one marked paid', !remindersDue(items3, '2026-12-15').some((r) => r.key === 'irs_2026-12-15'));
  const cron = src('src/app/api/cron/payroll-draft/route.ts');
  check('the daily run sends them to the owner’s own team record, once each', /where\('payrollTax\.runBy', '==', 'clarityflow'\)/.test(cron) && /private\/payrollTaxReminders/.test(cron) && /const ownerId = await ensureOwnerTeamMember\(db, tenantId\)/.test(cron) && /userId: ownerId,/.test(cron) && /message: `\$\{r\.title\}\. \$\{r\.body\}`/.test(cron));

  console.log('Form 941, NC-5 and NCUI 101');
  const q4 = runs.filter((r: any) => r.kind === 'payday');
  const f = form941(runs, t, 2026, 4); const L = (n: string) => f.lines.find((l) => l.line === n)?.amount ?? NaN;
  const ppl = q4.flatMap((r: any) => r.people.filter((p: any) => p.taxes));
  const sum = (fn: (p: any) => number) => Math.round(ppl.reduce((s: number, p: any) => s + fn(p), 0) * 100) / 100;
  check('line 1: people paid for the pay period with December 12 in it (none yet)', L('1') === 0);
  check('line 2 and 3: wages and federal income tax withheld', L('2') === sum((p) => p.taxes.wages.federal) && L('3') === sum((p) => p.taxes.employee.federal));
  check('5a and 5b: tips apart from wages, each at 12.4%', L('5b') === Math.round(sum((p) => p.tips) * 0.124 * 100) / 100 && L('5a') === Math.round((sum((p) => p.taxes.wages.socialSecurity) - sum((p) => p.tips)) * 0.124 * 100) / 100);
  check('line 10 is what the paydays owe the IRS, rounding on line 7', L('10') === owed(q4).irs && Math.abs(L('7')) < 0.1, [L('10'), owed(q4).irs, L('7')]);
  check('line 16: each month', f.months[1] === owed(nov).irs && f.months[2] === owed(q4.filter((r: any) => r.payDate.startsWith('2026-12'))).irs);
  check('…under $2,500 for the quarter: the first box, no month by month', L('10') < 2500 ? /first box/.test(f.lines.find((l) => l.line === '16')!.label) : true, f.lines.find((l) => l.line === '16'));
  const qRun = (k: string, payDate: string, from: string, to: string, irs: number, sched = 'monthly', extra: any = {}) => ({ kind: 'payday', runBy: 'clarityflow', periodKey: k, payDate, from, to,
    taxes: { owed: { irs, state: 0, sui: 0, futa: 0, other: [] }, due: {}, schedule: { irs: sched, state: 'monthly' } },
    people: [{ staffId: `p${k}`, name: 'P', taxes: { gross: 5000, wages: { federal: 5000, socialSecurity: 5000, medicare: 5000, ...(extra.addl != null ? { additionalMedicare: extra.addl } : {}) }, employee: { federal: irs - 765, socialSecurity: 310, medicare: 72.5, additionalMedicare: extra.addlTax || 0 }, employer: { socialSecurity: 310, medicare: 72.5 } } }] });
  const big941 = [qRun('s1', '2026-09-10', '2026-08-24', '2026-09-06', 1500), qRun('s2', '2026-09-24', '2026-09-07', '2026-09-20', 1500), qRun('d1', '2026-10-08', '2026-09-21', '2026-10-04', 1600), qRun('d2', '2026-11-05', '2026-10-19', '2026-11-01', 1700)];
  const g = form941(big941, base, 2026, 4); const g16 = g.lines.find((l) => l.line === '16')!;
  check('$2,500 or more, last quarter too, paid monthly: what was owed each month', g16.label === 'Owed each month' && /October \$1,600\.00, November \$1,700\.00, December \$0\.00/.test(String(g16.detail)), g16);
  const gs = form941(big941.map((r: any) => ({ ...r, taxes: { ...r.taxes, schedule: { irs: 'semiweekly' } } })), base, 2026, 4).lines.find((l) => l.line === '16')!;
  check('…paid twice a week: Schedule B, payday by payday', /Schedule B/.test(gs.label) && /October 8 \$1,600\.00, November 5 \$1,700\.00/.test(String(gs.detail)), gs);
  const small = form941([qRun('s0', '2026-09-10', '2026-08-24', '2026-09-06', 900), ...big941.slice(2)], base, 2026, 4).lines.find((l) => l.line === '16')!;
  check('…under $2,500 last quarter: the first box', /first box/.test(small.label) && /last quarter/.test(String(small.detail)), small);
  const late12 = [big941[1], qRun('o1', '2026-10-02', '2026-09-07', '2026-09-20', 900)];
  check('line 1: the pay period with September 12 in it counts for July to September, one paid in October too', form941(late12, base, 2026, 3).lines.find((l) => l.line === '1')?.amount === 2 && form941(late12, base, 2026, 4).lines.find((l) => l.line === '1')?.amount === 0, form941(late12, base, 2026, 3).lines[0]);
  const addl = form941([qRun('a1', '2026-11-05', '2026-10-19', '2026-11-01', 1700, 'monthly', { addl: 1234.56, addlTax: 11.11 })], base, 2026, 4).lines.find((l) => l.line === '5d');
  check('5d: the extra Medicare on its own wages, kept with each paycheck', addl?.amount === 11.11 && /\$1,234\.56 × 0\.9%/.test(String(addl?.detail)), addl);
  const fPaid = form941([...runs, pay], t, 2026, 4);
  check('line 13: paid this quarter; 14: still to pay', fPaid.lines.find((l) => l.line === '13')?.amount === pay.amount && fPaid.lines.find((l) => l.line === '14')?.amount === Math.round((L('10') - pay.amount) * 100) / 100);
  const nc5 = formNC5(runs, t, 2026, 4);
  check('NC-5: November and December withheld, and the quarter', nc5.lines.find((l) => l.line === 'November')?.amount === owed(nov).state && nc5.total === owed(q4).state);
  const big = [{ kind: 'payday', runBy: 'clarityflow', periodKey: 'x', payDate: '2026-11-19', from: '2026-11-02', to: '2026-11-15', taxes: { owed: { irs: 1 } }, people: [{ staffId: 'z', name: 'Zee', taxes: { gross: 5000, wages: { medicare: 5000, sui: 1200, federal: 5000, socialSecurity: 5000 }, employer: { sui: 12 }, employee: {} } }] }];
  const ncui = formNCUI101(big, base, 2026, 4);
  check('NCUI 101: each person’s wages, what’s over the yearly limit, what it’s on, and what’s due', ncui.people[0]?.gross === 5000 && ncui.people[0]?.excess === 3800 && ncui.people[0]?.taxable === 1200 && ncui.due === 12);

  console.log('On Payday');
  const screen = src('src/components/money/PaydayScreen.tsx'), page = src('src/app/(app)/money/page.tsx'), dlg = src('src/components/money/PayrollFormsDialog.tsx');
  check('one Payroll taxes card: this payday’s, what’s to pay, what’s paid, the forms', /aria-label="Payroll taxes"/.test(screen) && /From this payday, once it’s recorded/.test(screen) && />To pay</.test(screen) && />Paid</.test(screen) && /See the numbers/.test(screen));
  check('"I paid it" only for one that can be (not still adding up, not carrying over), with the amount and the day; "Not paid" for any marked paid, by hand or matched to the wrong bank payment',
    /x\.payable && o\.onPaid && !open \?/.test(screen) && /payable: !i\.open && !i\.carries/.test(page) && /x\.undo && o\.onUnpaid \?/.test(screen) && /amount: i\.paid!\.amount, undo: true,/.test(page) && /type="date" value=\{on\} max=\{o\.today\}/.test(screen));
  check('one still adding up with no due date says when it’s due', /i\.open \? `\$\{i\.due \? `Due \$\{on\(i\.due\)\}` : 'Due when it’s filed'\}\. Still adding up/.test(page));
  check('the forms open on the quarter to file (in January, October to December), due by the IRS’s own day, a weekend moved on', /\(m - 1\) % 3 === 0 \? \(q === 1 \? \{ year: y - 1, q: 4 \}/.test(dlg) && /afterQuarter\(qEnd\)/.test(dlg) && !/const DUE = /.test(dlg));
  check('the forms: 941 always, NC-5 and NCUI 101 for North Carolina, a quarter at a time, to print or download', /\['941', \.\.\.\(p\.nc \? \['nc5', 'ncui'\] : \[\]\)\]/.test(dlg) && /aria-label="The quarter before"/.test(dlg) && /downloadCsv\(/.test(dlg) && /printPage\(/.test(dlg)
    && /nc=\{taxState === 'NC'\}/.test(page));
  check('never a Social Security number or EIN asked for', !/<input/.test(dlg) && /ClarityFlow never keeps them/.test(dlg));
  check('house style', !/className="[^"]*uppercase/.test(dlg + screen) && !/ · /.test(dlg) && !/>[^<{}]*[A-Za-z]'[A-Za-z][^<{}]*</.test(dlg + screen));

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nAll passed');
})();
