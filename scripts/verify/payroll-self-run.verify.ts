// Checks payroll run in ClarityFlow, without Gusto (Settings > Payroll; design board "Payroll run in ClarityFlow"):
//   Nothing changes for a business until it picks ClarityFlow (Payday asks once, the owner answers). Recording payday
//   (api/payroll/record, lib/payday-record) works each employee's taxes out again on the server, from their tax forms
//   (staffPay) and the paydays already recorded this year, never the screen's figures. The books get one more line, the
//   employer's payroll taxes, never naming anyone; the payroll run keeps each person's taxes, take-home, how they were
//   paid and the check number, and what the payday owes and when. Contractors have nothing withheld. With Gusto, or
//   another payroll company, nothing changes.
//   A payroll tax payment booked from the bank a few days after payday is matched to that line, not booked twice; one
//   sorted as Payroll Tax Deposit is never an expense.
//   Each pay stub has the taxes withheld, the take-home and the year so far, from the payday recorded, or worked out
//   until it is.
//   Payday shows each person's take-home, the taxes under it and how they're paid; the tax forms dialog never asks for
//   a Social Security number; the Payroll settings page sets who runs payroll and the state's rates.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/payroll-self-run.verify.ts
import fs from 'fs';
import { makeDb, check, failures } from './fake-db';
import { recordPayday, cleanPayday } from '../../src/lib/payday-record';
import { coverable, planPayrollCover } from '../../src/lib/payroll-bank';
import { paydayTaxes, ytdFrom, stubTaxes, runByOf } from '../../src/lib/payroll-taxes';
import { CATEGORY_LIBRARY } from '../../src/lib/categories';
import { PAY_FIELDS } from '../../src/lib/staff-pay';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const tenant = { timezone: 'America/New_York', workweekStartsOn: 1, payroll: { cadence: 'bi-weekly', periodAnchor: '2026-11-02', paydayAfterDays: 4 }, taxState: 'NC', payrollTax: { runBy: 'clarityflow' } };
const forms: any = { jo: { federal: { status: 'single' }, state: { status: 'single' } }, rae: { federal: { status: 'married', dependents: 2000 }, state: { status: 'married' } } };
const before = { kind: 'payday', periodKey: '2026-11-02_2026-11-15', from: '2026-11-02', to: '2026-11-15', payDate: '2026-11-19', recordedAt: '2026-11-18T16:00:00.000Z',
  people: [{ staffId: 'jo', paid: 6500, cashTips: 0, taxes: { gross: 6500, employeeTotal: 900, takeHome: 5600, wages: { socialSecurity: 6500, medicare: 6500, futa: 6500, sui: 6500 }, employee: { federal: 400, socialSecurity: 403, medicare: 94.25, additionalMedicare: 0, state: 2.75, other: [] }, stateHow: 'built_in' } }] };
const good = { periodKey: '2026-11-16_2026-11-29', from: '2026-11-16', to: '2026-11-29', setAsides: [],
  people: [{ staffId: 'jo', name: 'Jo Park', amount: 1780.5, cash: 0, contractor: false, method: 'check', checkNo: '1042', tips: 412.5 },
    { staffId: 'rae', name: 'Rae Lin', amount: 1506, cash: 120, contractor: false, method: 'transfer', checkNo: '77', tips: 386 },
    { staffId: 'lee', name: 'Lee Shaw', amount: 900, cash: 0, contractor: true, method: 'transfer' }] };
const now = '2026-12-02T15:00:00.000Z';

(async () => {
  console.log('Who runs payroll');
  const { payrollTax: _p, ...unset } = tenant as any;
  check('picked: ClarityFlow; nothing picked: a payroll company (Gusto when it’s connected), so an existing business sees no change', runByOf(tenant) === 'clarityflow' && runByOf(unset) === 'company' && runByOf({ ...unset, gusto: { connected: true } }) === 'gusto');
  const d0 = makeDb(); await d0.doc('tenants/t1').set(unset);
  const r0: any = await recordPayday(d0, 't1', unset, cleanPayday(good) as any, {}, now, forms);
  check('…and recording payday for it books no taxes', r0.ok && !r0.taxes && !(await d0.collection('tenants/t1/transactions').get()).docs.some((x: any) => x.id.startsWith('paydaytax_')));

  console.log('What Payday sends');
  const input: any = cleanPayday(good);
  check('how each person is paid is kept, a check number only for a check', input.people[0].method === 'check' && input.people[0].checkNo === '1042' && input.people[1].method === 'transfer' && !input.people[1].checkNo && input.people[0].tips === 412.5, input.people);
  check('a made-up way of paying is dropped', !(cleanPayday({ ...good, people: [{ ...good.people[0], method: 'wire' }] }) as any).people[0].method);

  console.log('Recording payday');
  const db = makeDb();
  await db.doc('tenants/t1').set(tenant);
  await db.doc('tenants/t1/payrollRuns/payday_2026-11-02_2026-11-15').set(before);
  const r: any = await recordPayday(db, 't1', tenant, input, { id: 'mgr', name: 'Mo' }, now, forms);
  const all = (await db.collection('tenants/t1/transactions').get()).docs.map((d: any) => d.data());
  const k = '2026-11-16_2026-11-29'; const line = (id: string) => all.find((t: any) => t.id === id);
  const expect = paydayTaxes({ tenant, payDate: '2026-12-03', forms, ytd: ytdFrom([before], tenant, 2026, k),
    people: [{ staffId: 'jo', gross: 1780.5, inHand: 0 }, { staffId: 'rae', gross: 1626, inHand: 120 }] });
  check('recorded, with the taxes', r.ok === true && r.taxes?.employer === expect.employerTotal && r.taxes?.employee === expect.employeeTotal, r);
  check('the team’s pay is booked as before (taxes withheld are part of it)', line(`payday_${k}_team`)?.amount === 3286.5 && line(`paydaycash_${k}`)?.amount === 120 && line(`payday_${k}_contractors`)?.amount === 900);
  const tax = line(`paydaytax_${k}`);
  check('one more line: the employer’s payroll taxes, worked out on the server', tax?.amount === expect.employerTotal && tax?.category === 'Payroll Taxes' && tax?.paymentMethod === 'Distribution' && tax?.paydayPeriod === k, tax);
  check('…naming nobody', all.every((t: any) => !t.staffId && !/Jo|Rae|Lee/.test(`${t.description} ${t.clientOrVendor}`)), all.map((t: any) => t.description));
  check('what Jo’s been taxed on this year counts: federal unemployment only on the last $500 of the $7,000', expect.by.jo.employer.futa === 3 && expect.by.rae.employer.futa === 9.76, [expect.by.jo.employer, expect.by.rae.employer]);
  const run: any = (await db.doc(`tenants/t1/payrollRuns/payday_${k}`).get()).data();
  const jo = run.people.find((p: any) => p.staffId === 'jo'), rae = run.people.find((p: any) => p.staffId === 'rae'), lee = run.people.find((p: any) => p.staffId === 'lee');
  check('the run keeps each employee’s taxes and take-home: Jo $1,461.48, Rae $1,335.61', jo?.takeHome === 1461.48 && rae?.takeHome === 1335.61 && jo.taxes.employee.state === 53 && rae.taxes.inHand === 120, [jo, rae]);
  check('…how each was paid, and the check number', jo.method === 'check' && jo.checkNo === '1042' && rae.method === 'transfer' && !rae.checkNo && lee.method === 'transfer');
  check('a contractor has nothing worked out', !lee.taxes && !lee.takeHome);
  check('the run says when it was paid, who runs payroll, what it owes and when', run.payDate === '2026-12-03' && run.runBy === 'clarityflow' && run.taxes?.owed?.irs === expect.owed.irs && run.taxes?.due?.irs === '2027-01-15' && run.taxes?.due?.state === '2027-02-01', run.taxes);

  console.log('With Gusto or another payroll company, nothing changes');
  for (const t of [{ ...tenant, payrollTax: { runBy: 'company' } }, { ...tenant, payrollTax: {}, gusto: { connected: true } }] as any[]) {
    const d2 = makeDb(); await d2.doc('tenants/t1').set(t);
    const r2: any = await recordPayday(d2, 't1', t, input, {}, now, forms);
    const lines = (await d2.collection('tenants/t1/transactions').get()).docs.map((x: any) => x.data());
    const run2: any = (await d2.doc(`tenants/t1/payrollRuns/payday_${k}`).get()).data();
    check(`${t.gusto ? 'Gusto' : 'a payroll company'}: no employer tax line, no taxes kept`, r2.ok && !r2.taxes && !lines.some((x: any) => x.id === `paydaytax_${k}`) && !run2.taxes && !run2.people.some((p: any) => p.taxes));
  }
  const route = src('src/app/api/payroll/record/route.ts');
  check('the route reads each employee’s tax forms from their pay, only when payroll is run here', /if \(runByOf\(tenant\) === 'clarityflow'\) \{[\s\S]*?staffPay\/\$\{id\}[\s\S]*?taxForms/.test(route) && /recordPayday\(db, tenantId, tenant, input, \{[^}]*\}, new Date\(\)\.toISOString\(\), forms\)/.test(route));

  console.log('Payroll taxes in the bank');
  check('the employer tax line payday booked can be matched; set-asides and cash tips still can’t', coverable(tax) && !coverable(line(`paydaycash_${k}`)) && !coverable({ ...tax, paymentMethod: 'Internal Transfer' }));
  const plan = planPayrollCover(all, { id: 'bt1', amountCents: Math.round((3286.5 + expect.employerTotal) * 100), date: '2026-12-04' }, tenant);
  check('a payroll payment a day after payday covering the pay and the employer taxes is matched to both: nothing booked twice', plan?.covered === Math.round((3286.5 + expect.employerTotal) * 100) && plan?.extra === 0, plan);
  const dep = CATEGORY_LIBRARY.find((c) => c.name === 'Payroll Tax Deposit'), ded = CATEGORY_LIBRARY.find((c) => c.name === 'Payroll Deductions Paid');
  check('Payroll Tax Deposit and Payroll Deductions Paid: in the pickers, never an expense', !!dep && dep.taxBucket === 'transfer' && !dep.system && !!ded && ded.taxBucket === 'transfer');
  const sync = src('src/lib/plaid-sync.ts');
  check('the bank suggests Payroll Tax Deposit for an IRS payment, or a state one for what paydays owe it, and a payee rule never books it as a second expense',
    /const selfRun = runByOf\(tenantDoc\) === 'clarityflow'/.test(sync) && /USATAXPYMT\|EFTPS/.test(sync) && /near\(irsOwed\) \? 'paid' : 'maybe'/.test(sync) && /&& near\(stateOwed\) \? 'paid' : null/.test(sync) && /deposit === 'maybe' \? \{ hint: 'A payment to the IRS\. Payroll taxes\?/.test(sync)
    && /if \(deposit\) sugg = \{ category: 'Payroll Tax Deposit'/.test(sync) && /&& !\(deposit && rule\.category !== 'Payroll Tax Deposit'\)/.test(sync));
  const RB = await import('../../src/lib/report-builders');
  const reg = RB.payrollCsv(all as any, [], { code: 'NC', employerPayrollTaxPct: 9.25 }, [run]);
  check('the payroll register: each person’s withheld and take-home, and the employer taxes in the books (not an estimate)', reg[0].join('|') === 'Person|Payouts|Paid|Withheld|Take-home' && reg.some((r: any) => r[0] === 'Jo Park' && r[4] === 1461.48)
    && reg[reg.length - 1][0] === 'Employer payroll taxes, in your books' && reg[reg.length - 1][2] === expect.employerTotal, reg);
  // (A payroll company's tax withdrawal claimed for a payday: only what it came to beyond the employees' pay is the employer's.)
  const co = [{ id: 'payday_k_team', category: 'Payroll', type: 'expense', amount: 0.01, paydayPeriod: 'k', paymentMethod: 'Distribution' },
    { id: 'bank_net', category: 'Payroll', type: 'expense', amount: 1560, paydayPeriod: 'k', paymentMethod: 'Bank feed' }, { id: 'bank_tax', category: 'Payroll Taxes', type: 'expense', amount: 593, paydayPeriod: 'k', paymentMethod: 'Bank feed' }];
  const coRun = { kind: 'payday', periodKey: 'k', people: [{ staffId: 'x', paid: 2000 }], employeesTotal: 2000, viaBankCents: 215300 };
  const er = RB.employerTaxesOf(co as any, 2000, 9.25, [coRun]);
  check('…a payroll company’s whole tax withdrawal isn’t counted as the employer’s: only $153 of $593 is', er.booked && er.amount === 153, er);
  const undone = RB.employerTaxesOf([...all, { id: 'rev1', type: 'reversal', category: 'Payroll Taxes', amount: tax.amount, reversalOf: tax.id }] as any, 3286.5, 9.25, [run]);
  check('…and payday’s employer taxes, undone, come back off', undone.amount === 0, undone);
  const two = RB.employerTaxesOf([...co.map((x) => ({ ...x, category: x.id === 'bank_tax' ? 'Payroll' : x.category })), { id: 'paydaytax_j', category: 'Payroll Taxes', type: 'expense', amount: 153, paydayPeriod: 'j', paymentMethod: 'Distribution' }] as any, 4000, 9.25, [coRun]);
  check('…a payday whose withdrawals were sorted as payroll counts its employer share too, beside one recorded first', two.amount === 306, two);

  console.log('On the pay stub');
  const runs = [before, run];
  const s1 = stubTaxes({ tenant, staffId: 'jo', periodKey: k, payDate: '2026-12-03', runs, forms: forms.jo, gross: 1780.5, inHand: 0, stateName: 'North Carolina' });
  check('from the payday recorded: each tax, the take-home, how it was paid', s1.recorded && s1.takeHome === 1461.48 && s1.method === 'check' && s1.checkNo === '1042' && s1.lines.map((l) => l.label).join('|') === 'Federal income tax|Social Security|Medicare|North Carolina income tax', s1);
  check('…and the year so far', s1.ytd.earned === 8280.5 && s1.lines.find((l) => l.key === 'ss')?.ytd === Math.round((403 + 110.39) * 100) / 100 && s1.ytd.takeHome === Math.round((5600 + 1461.48) * 100) / 100, s1.ytd);
  const s2 = stubTaxes({ tenant, staffId: 'jo', periodKey: '2026-11-30_2026-12-13', payDate: '2026-12-17', runs, forms: forms.jo, gross: 1000, inHand: 0, stateName: 'North Carolina' });
  check('a payday not recorded yet: worked out from the forms, and said so', !s2.recorded && s2.withheld > 0 && s2.ytd.earned === Math.round((6500 + 1780.5 + 1000) * 100) / 100, s2);
  const stub = src('src/lib/pay-stub.ts');
  check('a stub saved before payday was recorded takes the recorded taxes once it is', /if \(s\?\.taxes && !s\.taxes\.recorded\)/.test(stub) && /if \(t\?\.recorded\) \{ await ref\.set\(\{ taxes:/.test(stub));
  check('the stub on screen and as a PDF show them', /aria-label="Taxes and take-home"/.test(src('src/components/pay/PayStubView.tsx')) && /Taxes withheld/.test(src('src/lib/pay-stub-pdf.ts')));

  console.log('Payday, the tax forms and the settings');
  const screen = src('src/components/money/PaydayScreen.tsx'), page = src('src/app/(app)/money/page.tsx');
  check('each person: takes home, of what they earned, and what’s withheld under it', /Takes home<\/span>/.test(screen) && /of \{usd\(tx\.gross\)\} earned/.test(screen) && /Withheld \{usd\(t\.employeeTotal\)\}/.test(screen));
  check('no W-4 on file: said plainly, with Add W-4 for a manager', /No W-4 on file\. Taxed as single until one is added, as the IRS requires\./.test(screen) && /add: 'Add W-4'/.test(screen) && /onForms: canEditForms \?/.test(page));
  check('how each person is paid, and a check number for a check', /aria-label=\{`How \$\{name\} is paid`\}/.test(screen) && /m\.method === 'check' && <label/.test(screen) && /method: m\.method, \.\.\.\(m\.method === 'check' && m\.checkNo/.test(page));
  check('the payroll taxes to pay later, each with when it’s due', /Payroll taxes to pay later/.test(screen) && /Due \$\{on\(due\.irs\)\}/.test(page) && /Form NC-5\. Due/.test(page));
  check('no Connect Gusto while ClarityFlow runs payroll, and the way to change that', /\{runBy === 'gusto' && <div className="mt-3 flex flex-wrap items-center gap-2">/.test(screen) && /Use Gusto or another payroll company instead/.test(screen)
    && /gustoSlot=\{gusto\.connected && runBy === 'gusto' \?/.test(page));
  check('Payday asks once who works out the taxes, and only the owner answers', /Who works out your team’s payroll taxes\?/.test(screen) && /askRunBy=\{selectedTenant && !runByChosen\(selectedTenant\) && !gusto\.connected \?/.test(page)
    && /String\(payRole \|\| ''\)\.toLowerCase\(\) === 'owner'/.test(page) && /'payrollTax\.runBy': v/.test(page) && /The owner picks this in Settings, Payroll\./.test(screen));
  check('tax forms are kept off the staff record the team reads, by the rules too', /'overtimeExempt', 'overtimeNonExempt', 'taxForms'\]/.test(src('firestore.rules')));
  check('Payday works the taxes out the same way the server does', /paydayTaxes\(\{ tenant: selectedTenant, payDate, forms, ytd: ytdFrom\(yearRuns \|\| \[\], selectedTenant, taxYear, periodKey\)/.test(page));
  const dlg = src('src/components/staff/TaxFormsDialog.tsx');
  check('the tax forms: W-4 steps, NC-4, before-tax plans, how they’re paid', /Filing status \(step 1c\)/.test(dlg) && /step 2c/.test(dlg) && /from their NC-4/.test(dlg) && /Retirement plan/.test(dlg) && /Bank transfer/.test(dlg));
  check('…and never a Social Security number or tax ID asked for', !/<input[^>]*(ssn|social|taxId|ein)/i.test(dlg) && /never asks for or keeps Social Security numbers/.test(dlg));
  check('tax forms live with pay, where only managers and the person read them', (PAY_FIELDS as readonly string[]).includes('taxForms') && /'taxForms'\]/.test(src('src/firebase/firestore/pay-overlay.ts')));
  const set = src('src/app/(app)/settings/page.tsx');
  check('Settings, Payroll: who runs it, the IRS schedule, the state’s rates, other payroll taxes', /value: 'payroll',\s+label: 'Payroll'/.test(set) && /How often you pay the IRS/.test(set) && /Your state unemployment rate/.test(set) && /Other payroll taxes/.test(set) && !/payroll: 'team'/.test(src('src/lib/modules.ts')) && /value: 'semiweekly', label: 'Twice a week'/.test(set));
  const all3 = [screen, dlg, set.slice(set.indexOf('value="payroll"'), set.indexOf('</Tabs>'))].join('\n');
  check('house style: no shouting labels, no dots between words, real apostrophes', !/className="[^"]*uppercase/.test(all3) && !/ · /.test(all3) && !/>[^<{}]*[A-Za-z]'[A-Za-z][^<{}]*</.test(all3));

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nAll passed');
})();
