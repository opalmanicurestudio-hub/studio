// Checks pay between paydays and pay from before ClarityFlow (payroll run in ClarityFlow; design boards "Pay a bonus"
// and "Pay from before ClarityFlow"):
//   A bonus is taxed at the bonus rates: federal income tax at 22% once some was withheld from the person's regular pay
//   this year (37% on bonuses over $1,000,000 in the year), else with their last regular paycheck; the state's own bonus
//   rate with its county or city part, or, where the state has none, with their last regular paycheck; Social Security,
//   Medicare and unemployment as always. No retirement or health comes out of it. It's recorded on its own day
//   and key (api/payroll/record, lib/payday-record), any number of times, never standing in for a regular payday's
//   dates, and only when payroll is run in ClarityFlow. It counts in the person's year.
//   Pay from before ClarityFlow (api/payroll/prior, lib/payroll-prior) counts toward every wage limit, puts the old
//   payroll's part of that quarter on its forms as already paid, shows on pay stubs, and never adds to what's owed.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/payroll-bonus.verify.ts
import fs from 'fs';
import { makeDb, check, failures } from './fake-db';
import { recordPayday, cleanPayday } from '../../src/lib/payday-record';
import { paydayTaxes, ytdFrom, stubTaxes, teamOnLastPayday } from '../../src/lib/payroll-taxes';
import { supplementalFederal, withholdingFor, federalIncomeTax } from '../../src/lib/withholding';
import { supplementalStateTax, stateTaxFor, supplementalRate } from '../../src/lib/state-payroll';
import { cleanPrior, priorOf, priorQuarterPart } from '../../src/lib/payroll-prior';
import { form941, formStateWithholding, formStateWageReport, owedItems } from '../../src/lib/payroll-owed';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const tenant = { timezone: 'America/New_York', workweekStartsOn: 1, payroll: { cadence: 'bi-weekly', periodAnchor: '2026-11-02', paydayAfterDays: 4 }, taxState: 'NC', payrollTax: { runBy: 'clarityflow' } };
const forms: any = { jo: { federal: { status: 'single' }, state: { state: 'NC', status: 'single' } }, rae: { federal: { status: 'married', dependents: 2000 }, state: { state: 'NC', status: 'married' } } };
const now = '2026-11-26T15:00:00.000Z';
// (Jo's regular payday before: $1,500, $120 federal and $50 North Carolina withheld.)
const before = { kind: 'payday', runBy: 'clarityflow', periodKey: '2026-10-19_2026-11-01', from: '2026-10-19', to: '2026-11-01', payDate: '2026-11-05', recordedAt: '2026-11-04T15:00:00.000Z',
  people: [{ staffId: 'jo', name: 'Jo Park', paid: 1500, cashTips: 0, taxes: { gross: 1500, wages: { federal: 1500, socialSecurity: 1500, medicare: 1500, futa: 1500, sui: 1500 },
    employee: { federal: 120, socialSecurity: 93, medicare: 21.75, additionalMedicare: 0, state: 50, other: [] }, employer: { other: [] } } }], taxes: { owed: { irs: 0 } } };
const bonus = (date: string, id: string, extra: any = {}) => ({ periodKey: `bonus_${date}_${id}`, offCycle: { date, supplemental: true },
  people: [{ staffId: 'jo', name: 'Jo Park', amount: 500, cash: 0, contractor: false, method: 'check', checkNo: '1043' }], ...extra });

(async () => {
  console.log('Federal income tax on a bonus');
  check('22% of it', supplementalFederal(500, { status: 'single' } as any, 0) === 110);
  check('37% on what’s over $1,000,000 of bonuses this year', supplementalFederal(500, null, 999800) === 155);
  check('claimed exempt: none, except the 37% part, which applies anyway', supplementalFederal(500, { exempt: true } as any, 0) === 0 && supplementalFederal(500, { exempt: true } as any, 1000000) === 185);
  const wf = (ytd: any) => withholdingFor({ year: 2026, periods: 26, gross: 500, forms: forms.jo, state: 'NC', supplemental: true, ytd: { ssWages: 0, medicareWages: 0, futaWages: 0, suiWages: 0, ...ytd } }).employee.federal;
  check('only once income tax was withheld from their regular pay this year; else with their last regular paycheck', wf({ fedWithheld: 120 }) === 110
    && wf({ last: { wages: 1500, federal: 120, state: 50 } }) === Math.round((federalIncomeTax(2000, 26, forms.jo.federal, 2026) - 120) * 100) / 100 && wf({}) === federalIncomeTax(500, 26, forms.jo.federal, 2026), [wf({ last: { wages: 1500, federal: 120, state: 50 } }), wf({})]);

  console.log('State income tax on a bonus');
  check('North Carolina: 4.09%', supplementalStateTax('NC', 500, 26, { state: 'NC' } as any) === 20.45 && supplementalRate('NC') === 4.09);
  check('Maryland: 6.5%, and the county’s part (3.2% when no county is on the form)', supplementalStateTax('MD', 1200, 26, {} as any) === 116.4 && supplementalStateTax('MD', 1000, 26, { local: 'kent' } as any) === 98);
  check('New York City: the state’s 11.7% and the city’s 4.25%', supplementalStateTax('NY', 1000, 26, { local: 'nyc' } as any) === 159.5 && supplementalStateTax('NY', 1000, 26, {} as any) === 117);
  check('California: bonuses at 10.23% (other pay apart from wages is 6.6%)', supplementalStateTax('CA', 1000, 26, { state: 'CA' } as any) === 102.3);
  check('Georgia: at its income tax rate, 4.99%', supplementalStateTax('GA', 500, 26, { state: 'GA', status: 'single' } as any) === 24.95);
  const njf: any = { state: 'NJ', status: 'single' };
  check('a state with no bonus rate (New Jersey): on it and the last regular paycheck together, less what that paycheck took', supplementalRate('NJ') === null
    && supplementalStateTax('NJ', 500, 26, njf, 'single', { wages: 1500, tax: stateTaxFor('NJ', { wages: 1500, periods: 26, f: njf }) }) === Math.round((stateTaxFor('NJ', { wages: 2000, periods: 26, f: njf }) - stateTaxFor('NJ', { wages: 1500, periods: 26, f: njf })) * 100) / 100
    && supplementalStateTax('NJ', 500, 26, njf, 'single', { wages: 1500, tax: stateTaxFor('NJ', { wages: 1500, periods: 26, f: njf }) }) > stateTaxFor('NJ', { wages: 500, periods: 26, f: njf }));
  check('…or, with no regular paycheck yet, as a paycheck of its own', supplementalStateTax('NJ', 500, 26, njf) === stateTaxFor('NJ', { wages: 500, periods: 26, f: { ...njf, extra: 0, reduce: 0 } }));
  check('no income tax (Texas): none', supplementalStateTax('TX', 1000, 26, {} as any) === 0);

  console.log('The bonus itself');
  const w = withholdingFor({ year: 2026, periods: 26, gross: 500, forms: forms.jo, state: 'NC', supplemental: true, ytd: { ssWages: 1500, medicareWages: 1500, futaWages: 1500, suiWages: 1500, fedWithheld: 120 } });
  check('Jo’s $500 bonus: $110 federal, $31 Social Security, $7.25 Medicare, $20.45 North Carolina, $331.30 home', w.employee.federal === 110 && w.employee.socialSecurity === 31 && w.employee.medicare === 7.25 && w.employee.state === 20.45 && w.takeHome === 331.3, w.employee);
  const withHealth = { ...forms.jo, pretax: { retirement: 50, health: 40 } };
  const off = paydayTaxes({ tenant, payDate: '2026-11-20', forms: { jo: withHealth }, ytd: {}, people: [{ staffId: 'jo', gross: 500, inHand: 0 }], offCycle: true, supplemental: true }).by.jo;
  const reg = paydayTaxes({ tenant, payDate: '2026-11-20', forms: { jo: withHealth }, ytd: {}, people: [{ staffId: 'jo', gross: 500, inHand: 0 }] }).by.jo;
  check('no retirement or health comes out of it (they come out of each regular paycheck)', off.pretax.retirement === 0 && off.pretax.health === 0 && reg.pretax.health === 40);

  console.log('What Payday sends for a bonus');
  const ok: any = cleanPayday(bonus('2026-11-20', 'k3x9q2'));
  check('its own day and key, no set-asides', ok.offCycle?.date === '2026-11-20' && ok.offCycle.supplemental === true && ok.periodKey === 'bonus_2026-11-20_k3x9q2' && ok.from === '2026-11-20' && !ok.setAsides.length, ok);
  check('a key that isn’t for that day is refused', typeof cleanPayday(bonus('2026-11-20', 'k3x9q2', { periodKey: 'bonus_2026-11-21_k3x9q2' })) === 'string' && typeof cleanPayday(bonus('2026-11-20', 'k3x9q2', { periodKey: '2026-11-16_2026-11-29' })) === 'string');
  check('no day, refused', typeof cleanPayday(bonus('2026-11-20', 'k3x9q2', { offCycle: { date: 'soon', supplemental: true } })) === 'string');
  check('“like a regular paycheck” is kept', (cleanPayday(bonus('2026-11-20', 'k3x9q2', { offCycle: { date: '2026-11-20', supplemental: false } })) as any).offCycle.supplemental === false);

  console.log('Recording a bonus');
  const db = makeDb(); await db.doc('tenants/t1').set(tenant); await db.doc('tenants/t1/payrollRuns/payday_2026-10-19_2026-11-01').set(before);
  const r1: any = await recordPayday(db, 't1', tenant, ok, { id: 'mgr', name: 'Mo' }, now, forms);
  const run1: any = (await db.doc('tenants/t1/payrollRuns/payday_bonus_2026-11-20_k3x9q2').get()).data();
  check('recorded at the bonus rates', r1.ok && run1?.offCycle === true && run1.supplemental === true && run1.payDate === '2026-11-20' && run1.people[0].taxes.employee.federal === 110 && run1.people[0].checkNo === '1043', r1);
  const lines = (await db.collection('tenants/t1/transactions').get()).docs.map((d: any) => d.data());
  check('its lines say pay between paydays, carry no payday dates, and are dated the day it was paid', lines.length > 0 && lines.every((t: any) => t.offCycle === true && !t.paydayFrom && !t.paydayTo && /^Pay between paydays/.test(t.description) && String(t.date).startsWith('2026-11-20')), lines.map((t: any) => [t.description, t.date]));
  const r2: any = await recordPayday(db, 't1', tenant, ok, {}, now, forms);
  check('the same one twice isn’t booked twice, and says so for pay between paydays', !r2.ok && r2.status === 409 && r2.error === 'This pay is already in your books.', r2);
  const r3: any = await recordPayday(db, 't1', tenant, cleanPayday(bonus('2026-11-20', 'z8y7x6')) as any, {}, now, forms);
  check('another bonus the same day is its own', r3.ok);
  const reg2: any = await recordPayday(db, 't1', tenant, cleanPayday({ periodKey: '2026-11-16_2026-11-29', from: '2026-11-16', to: '2026-11-29', setAsides: [],
    people: [{ staffId: 'jo', name: 'Jo Park', amount: 1780.5, cash: 0, contractor: false }] }) as any, {}, now, forms);
  check('a bonus never blocks the regular payday for those dates', reg2.ok, reg2);
  const runs = (await db.collection('tenants/t1/payrollRuns').get()).docs.map((d: any) => d.data());
  const y = ytdFrom(runs, tenant, 2026);
  check('it counts in Jo’s year: wages, and bonuses so far for the 37% rule; the last regular paycheck is the regular payday', y.jo.ssWages === 4280.5 && y.jo.supplemental === 1000 && y.jo.last?.wages === 1780.5 && y.jo.fedWithheld! > 120, y.jo);
  check('the business’s size for a bonus comes from the last regular payday, never another bonus', teamOnLastPayday(runs, tenant, 2026) === 1 && teamOnLastPayday(runs.filter((r: any) => r.offCycle), tenant, 2026) === null);
  const back = ytdFrom(runs, tenant, 2026, undefined, '2026-11-10');
  check('a bonus dated back counts only what was paid by its day, and that day’s last regular paycheck', back.jo.ssWages === 1500 && back.jo.last?.wages === 1500 && !back.jo.supplemental
    && teamOnLastPayday(runs, tenant, 2026, '2026-11-10') === 1 && teamOnLastPayday(runs, tenant, 2026, '2026-11-01') === null, back.jo);
  // (A bonus the bank booked as payroll before it was recorded: that payment, not a second.)
  const bk = makeDb(); await bk.doc('tenants/t1').set(tenant); await bk.doc('tenants/t1/payrollRuns/payday_2026-10-19_2026-11-01').set(before);
  await bk.doc('tenants/t1/transactions/bt_jo').set({ id: 'bt_jo', type: 'expense', category: 'Payroll', paymentMethod: 'Bank feed', amount: 331.3, context: 'Business', date: '2026-11-21T12:00:00.000Z' });
  await bk.doc('tenants/t1/bankTransactions/b1').set({ direction: 'out', date: '2026-11-21', status: 'auto_categorized', matchedTxnId: 'bt_jo', amount: 331.3 });
  const rb: any = await recordPayday(bk, 't1', tenant, cleanPayday(bonus('2026-11-20', 'cccccc')) as any, {}, now, forms);
  const team = (await bk.doc('tenants/t1/transactions/payday_bonus_2026-11-20_cccccc_team').get()).data(); const claimed = (await bk.doc('tenants/t1/transactions/bt_jo').get()).data();
  check('a bonus the bank already booked as payroll is that payment, not a second', rb.ok && rb.viaBankCents === 33130 && team?.amount === 168.7 && claimed?.paydayPeriod === 'bonus_2026-11-20_cccccc', [rb.viaBankCents, team?.amount, claimed]);
  const far: any = await recordPayday(db, 't1', tenant, cleanPayday(bonus('2027-02-01', 'aaaaaa')) as any, {}, now, forms);
  const old: any = await recordPayday(db, 't1', tenant, cleanPayday(bonus('2024-12-20', 'aaaaaa')) as any, {}, now, forms);
  check('a day more than a month ahead, or before last January, is refused', !far.ok && far.status === 400 && !old.ok && old.status === 400);
  const route = src('src/app/api/payroll/record/route.ts');
  check('the route takes a bonus only when payroll is run in ClarityFlow', /if \(input\.offCycle && runByOf\(tenant\) !== 'clarityflow'\) return NextResponse\.json\(\{ ok: false/.test(route));
  const cos = makeDb(); const t2 = { ...tenant, payrollTax: { runBy: 'company' } }; await cos.doc('tenants/t1').set(t2);
  const rc: any = await recordPayday(cos, 't1', t2, cleanPayday(bonus('2026-11-20', 'bbbbbb')) as any, {}, now, forms);
  check('…and the books take it without taxes otherwise (the route is what refuses it)', rc.ok && !rc.taxes);

  console.log('The bonus screen');
  const dlg = src('src/components/money/BonusDialog.tsx'); const screen = src('src/components/money/PaydayScreen.tsx'); const page = src('src/app/(app)/money/page.tsx');
  check('worked out as the server will: off-cycle, bonus rates, the last regular payday’s team', /paydayTaxes\(\{[\s\S]*?offCycle: true, supplemental: how === 'bonus', teamSize: teamOnLastPayday/.test(dlg));
  check('Payday offers it only when payroll is run here, once the business has agreed to how it works', /\{self && p\.onBonus && /.test(screen) && /onBonus=\{selfRunOn && termsOk && !adjustmentsError \?/.test(page));
  check('never asks for a Social Security number', !/\bssn\b|social security number/i.test(dlg));
  check('house style', !/className="[^"]*uppercase/.test(dlg) && !/ · /.test(dlg) && !/>[^<{}]*[A-Za-z]'[A-Za-z][^<{}]*</.test(dlg) && !/\{\/\*/.test(dlg));

  console.log('Pay from before ClarityFlow: what Settings sends');
  const P = (x: any = {}) => ({ staffId: 'jo', name: 'Jo Park', wages: 20640, tips: 4950, federal: 1482.1, ss: 1279.68, medicare: 299.28, state: 618,
    q: { wages: 5160, tips: 1240, federal: 370.52, ss: 319.92, medicare: 74.82, state: 154.5 }, ...x });
  const good: any = cleanPrior({ lastPayDate: '2026-06-26', people: [P(), { staffId: 'kim', name: 'Kim', q: {} }], futaPaid: 126 }, '2026-11-26');
  check('kept, for the year of the last payday; someone with nothing is left out', typeof good === 'object' && good.year === 2026 && good.people.length === 1 && good.futaPaid === 126, good);
  check('since the quarter began can’t be more than the year', /more than for the year/.test(String(cleanPrior({ lastPayDate: '2026-06-26', people: [P({ q: { wages: 30000 } })] }, '2026-11-26'))));
  check('tips can’t be more than wages and tips', typeof cleanPrior({ lastPayDate: '2026-06-26', people: [P({ tips: 30000 })] }, '2026-11-26') === 'string');
  check('a last payday after today, or before last year, is refused', typeof cleanPrior({ lastPayDate: '2026-12-01', people: [] }, '2026-11-26') === 'string' && typeof cleanPrior({ lastPayDate: '2024-12-20', people: [] }, '2026-11-26') === 'string');
  check('amounts that aren’t numbers are refused', typeof cleanPrior({ lastPayDate: '2026-06-26', people: [P({ federal: 'lots' })] }, '2026-11-26') === 'string');

  console.log('…in the year so far');
  const prior = { kind: 'prior', ...good, recordedAt: '2026-07-01T12:00:00Z' };
  const yp = ytdFrom([prior], tenant, 2026);
  check('every wage limit counts it', yp.jo.ssWages === 20640 && yp.jo.futaWages === 20640 && yp.jo.suiWages === 20640);
  check('…and only for its own year', !ytdFrom([prior], tenant, 2027).jo);
  const big = { kind: 'prior', year: 2026, lastPayDate: '2026-06-26', futaPaid: 0, people: [{ staffId: 'jo', name: 'Jo', wages: 184000, tips: 0, federal: 0, ss: 0, medicare: 0, state: 0, q: { wages: 0, tips: 0, federal: 0, ss: 0, medicare: 0, state: 0 } }] };
  const wb = paydayTaxes({ tenant, payDate: '2026-12-03', forms, ytd: ytdFrom([big], tenant, 2026), people: [{ staffId: 'jo', gross: 1000, inHand: 0 }] }).by.jo;
  check('Social Security stops at its $184,500 limit: on $500 of the next $1,000', wb.wages.socialSecurity === 500 && wb.employee.socialSecurity === 31 && wb.employer.futa === 0 && wb.employer.sui === 0, wb.wages);

  console.log('…on that quarter’s forms');
  const f2 = form941([prior], tenant, 2026, 2); const L = (f: any, n: string) => f.lines.find((l: any) => l.line === n);
  const pp = priorQuarterPart(priorOf([prior], 2026), 2026, 2, 184500)!;
  check('Form 941 has the old payroll’s part of the quarter', L(f2, '2').amount === 5160 && L(f2, '3').amount === 370.52 && L(f2, '5b').detail.startsWith('$1,240.00') && L(f2, '5c').detail.startsWith('$5,160.00'), f2.lines.slice(0, 6));
  check('…counted as deposited, so nothing is still to pay on it', L(f2, '13').amount === pp.deposited && /deposited by your old payroll, through June 26/.test(L(f2, '13').detail) && Math.abs(L(f2, '10').amount - L(f2, '13').amount) < 0.05, [L(f2, '10'), L(f2, '13')]);
  check('…with a quarter it stopped in the third month split by month from its reports', /your old payroll owed from April to June: split it by month/.test(L(f2, '16').detail) || /first box/.test(L(f2, '16').label), L(f2, '16'));
  check('other quarters’ forms are as before', form941([prior], tenant, 2026, 1).lines.find((l: any) => l.line === '2')!.amount === 0 && !form941([prior], tenant, 2026, 3).prior);
  const st = formStateWithholding([prior], tenant, 2026, 2);
  check('the state’s return has what the old payroll withheld, and paid', st.lines.some((l: any) => l.line === 'Earlier' && l.amount === 154.5) && st.lines.find((l: any) => l.line === 'Paid')!.amount === 154.5 && st.total === 154.5, st.lines);
  const ui = formStateWageReport([prior], tenant, 2026, 2);
  check('the wage report has each person’s wages from it, and what unemployment is on', ui.people[0]?.gross === 5160 && ui.people[0].taxable === 5160 && ui.prior?.due === 51.6, ui);
  const own = owedItems([prior], tenant, '2026-11-26');
  check('what’s owed: its federal and state taxes stay paid, its part of the quarter’s unemployment is added (paid with the wage report)', own.length === 1 && own[0].key === 'sui_2026q2' && own[0].amount === 51.6, own);
  const short = owedItems([{ ...prior, deposits: { irs: 500, state: 100 } }], tenant, '2026-11-26');
  const pq = priorQuarterPart(priorOf([prior], 2026), 2026, 2, 184500)!;
  const si = short.find((i) => i.key === 'irs_prior_2026'), ss2 = short.find((i) => i.key === 'state_prior_2026');
  check('what it didn’t deposit is still owed, due when it was (July 15 for June’s paydays), and late', si?.amount === Math.round((pq.owed - 500) * 100) / 100 && si?.due === '2026-07-15' && si.left === si.amount
    && ss2?.amount === 54.5 && !!ss2?.due, [si, ss2]);
  const f941s = form941([{ ...prior, deposits: { irs: 500, state: 100 } }, { kind: 'taxpayment', key: 'irs_prior_2026', amount: si!.amount, paidOn: '2026-11-20', recordedAt: '2026-11-20T12:00:00Z' }], tenant, 2026, 2);
  check('…and once that’s paid, the quarter’s Form 941 has it as paid', Math.abs(f941s.lines.find((l: any) => l.line === '13')!.amount - pq.owed) < 0.01, f941s.lines.find((l: any) => l.line === '13'));
  const fu = owedItems([{ ...prior, futaPaid: 0 }], tenant, '2026-11-26').find((i) => i.agency === 'futa');
  check('its federal unemployment not paid yet counts toward the year’s $500', fu?.amount === 42 && fu.paydays.includes('prior_2026'), fu);
  check('when the old payroll company files that quarter, the forms here say so', form941([{ ...prior, oldFiles: true }], tenant, 2026, 2).oldFiles === true && !form941([prior], tenant, 2026, 2).oldFiles);
  check('…unless it paid that', owedItems([{ ...prior, suiPaid: true }], tenant, '2026-11-26').length === 0 && formStateWageReport([{ ...prior, suiPaid: true }], tenant, 2026, 2).prior?.paid === true);
  const dep = form941([{ ...prior, deposits: { irs: 500, state: 100 } }], tenant, 2026, 2);
  check('what it deposited, as put in: a last month it didn’t pay is still to pay', L(dep, '13').amount === 500 && Math.abs(L(dep, '14').amount - (L(dep, '10').amount - 500)) < 0.01 && L(dep, '14').label === 'Still to pay' && formStateWithholding([{ ...prior, deposits: { irs: 500, state: 100 } }], tenant, 2026, 2).lines.find((l: any) => l.line === 'Paid')!.amount === 100, [L(dep, '13'), L(dep, '14')]);
  check('when the old payroll company files that quarter itself, its part stays off the forms here, and off what’s owed', !form941([{ ...prior, oldFiles: true }], tenant, 2026, 2).prior && L(form941([{ ...prior, oldFiles: true }], tenant, 2026, 2), '2').amount === 0 && owedItems([{ ...prior, oldFiles: true }], tenant, '2026-11-26').length === 0
    && ytdFrom([{ ...prior, oldFiles: true }], tenant, 2026).jo.ssWages === 20640);
  const fw: any = cleanPrior({ lastPayDate: '2026-06-26', people: [P({ fedWages: 19640, q: { ...P().q, fedWages: 4900 } })] }, '2026-11-26');
  check('federal wages, when retirement or health came out before taxes, go on line 2; Social Security and Medicare stay on all of it', fw.people[0].fedWages === 19640
    && L(form941([{ ...fw, kind: 'prior' }], tenant, 2026, 2), '2').amount === 4900 && L(form941([{ ...fw, kind: 'prior' }], tenant, 2026, 2), '5c').detail.startsWith('$5,160.00'));
  check('…never more than wages and tips', typeof cleanPrior({ lastPayDate: '2026-06-26', people: [P({ fedWages: 30000 })] }, '2026-11-26') === 'string');
  const off7 = form941([{ ...prior, people: [P({ q: { ...P().q, ss: 250 } })] }], tenant, 2026, 2);
  check('amounts that don’t match their wages show on line 7 as more than rounding', /More than rounding/.test(L(off7, '7').detail || ''), L(off7, '7'));
  const yPrior = ytdFrom([prior], tenant, 2026);
  check('its federal tax withheld lets a bonus be taxed at the flat 22%', yPrior.jo.fedWithheld === 1482.1);

  console.log('…on pay stubs');
  const stub = stubTaxes({ tenant, staffId: 'jo', periodKey: '2026-11-16_2026-11-29', payDate: '2026-12-03', runs: [prior], forms: forms.jo, gross: 1000, inHand: 0, stateName: 'North Carolina' });
  const fed = stub.lines.find((l) => l.key === 'federal')!;
  check('the year so far has its pay and each tax withheld, and says through when', stub.prior === '2026-06-26' && Math.abs(fed.ytd - (fed.amount + 1482.1)) < 0.01 && stub.ytd.earned === 21640, [fed, stub.ytd]);

  console.log('…saved only by the server');
  const pr = src('src/app/api/payroll/prior/route.ts');
  check('checked, then written to payrollRuns/prior_{year}, for anyone who runs payroll', /requireCan\(req, tenantId, 'money\.payroll'\)/.test(pr) && /cleanPrior\(b, todayIn\(tenant\)\)/.test(pr) && /payrollRuns\/prior_\$\{input\.year\}/.test(pr));
  const rules = src('firestore.rules');
  check('the app itself can’t write it', /match \/tenants\/\{tenantId\}\/payrollRuns\/\{runId\} \{[\s\S]*?allow write: if false;/.test(rules));
  const set = src('src/app/(app)/settings/page.tsx'); const pd = src('src/components/settings/PriorPayDialog.tsx');
  check('Settings, Payroll has it when payroll is run here', /\{runBy === 'clarityflow' && tenantId && <PriorPayRow /.test(set));
  check('the form never asks for a Social Security number, and keeps the house style', !/\bssn\b|social security number/i.test(pd) && !/className="[^"]*uppercase/.test(pd) && !/ · /.test(pd) && !/\{\/\*/.test(pd));

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nAll passed');
})();
