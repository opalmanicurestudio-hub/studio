// Checks the year's payroll forms (Money › Payday › Payroll taxes › Year-end forms; design board "Year end", A):
//   Each employee's W-2 from the year's paydays recorded in ClarityFlow and pay from before it: tips in box 7, not box
//   3; retirement before taxes in box 12 (D) with box 13 checked; tips that couldn't be withheld on in box 12 (A, B);
//   the state's programs in box 14; New York City's, Yonkers's or an Indiana county's part of the state's tax, and a
//   city tax the business added, in boxes 18 to 20. The W-3 is their totals. Form 940: everything paid, what's over
//   each person's $7,000, 0.6% on the rest, California's 1.5% credit reduction for 2026 (also in what's owed), what was
//   paid, and each quarter's when it's over $500. The state's year-end reconciliation. A 1099-NEC for each contractor
//   paid $2,000 or more ($600 before 2026). All due February 1, 2027 (January 31 is a Sunday). Nothing asks for a
//   Social Security number or an EIN.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/payroll-yearend.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';
import { w2sFor, w3For, form940, stateAnnual, form1099s, yearEndDue, necThreshold } from '../../src/lib/payroll-yearend';
import { paydayTaxes } from '../../src/lib/payroll-taxes';
import { keepOf, withholdingFor } from '../../src/lib/withholding';
import { owedItems } from '../../src/lib/payroll-owed';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const T = (state: string, extra: any = {}) => ({ timezone: 'America/New_York', payroll: { cadence: 'bi-weekly', periodAnchor: '2026-01-05', paydayAfterDays: 4 }, taxState: state, payrollTax: { runBy: 'clarityflow', ...extra } });
const forms: any = { jo: { federal: { status: 'single' }, state: { state: 'NC', status: 'single' }, pretax: { retirement: 100 } }, rae: { federal: { status: 'married' }, state: { state: 'NC', status: 'married' } } };
// (Paydays: Jo $3,000 with $400 in tips and $100 to retirement; Rae $2,500 with $900 in tips taken home in cash.)
const run = (tenant: any, d: string, k: string, ppl: { id: string; name: string; gross: number; tips: number; inHand?: number }[], f = forms, contractors: any[] = []) => {
  const t = paydayTaxes({ tenant, payDate: d, forms: f, ytd: {}, people: ppl.map((x) => ({ staffId: x.id, gross: x.gross, inHand: x.inHand || 0 })) });
  return { kind: 'payday', runBy: 'clarityflow', periodKey: k, payDate: d, from: d, to: d, recordedAt: `${d}T15:00:00Z`,
    people: [...ppl.map((x) => ({ staffId: x.id, name: x.name, paid: x.gross - (x.inHand || 0), cashTips: x.inHand || 0, tips: x.tips, taxes: keepOf(t.by[x.id]), takeHome: t.by[x.id].takeHome })), ...contractors],
    taxes: { owed: t.owed, due: {}, schedule: { irs: 'monthly', state: 'monthly' } } };
};

(async () => {
  console.log('W-2s');
  const nc = T('NC');
  const runs = [
    run(nc, '2026-03-12', 'a', [{ id: 'jo', name: 'Jo Park', gross: 3000, tips: 400 }, { id: 'rae', name: 'Rae Lin', gross: 2500, tips: 900, inHand: 900 }], forms, [{ staffId: 'lee', name: 'Lee Shaw', paid: 1500, contractor: true }]),
    run(nc, '2026-08-13', 'b', [{ id: 'jo', name: 'Jo Park', gross: 3000, tips: 400 }], forms, [{ staffId: 'lee', name: 'Lee Shaw', paid: 400, cashTips: 150, contractor: true }, { staffId: 'max', name: 'Max Ortiz', paid: 650, contractor: true }]),
  ];
  const w2 = w2sFor(runs, nc, 2026); const jo = w2.find((w) => w.staffId === 'jo')!; const rae = w2.find((w) => w.staffId === 'rae')!;
  const a = runs[0].people[0].taxes, b = runs[1].people[0].taxes;
  check('one for each employee, never a contractor', w2.length === 2 && !w2.some((w) => w.staffId === 'lee'));
  check('box 1: wages and tips, less retirement taken out before taxes', jo.b1 === 5800 && rae.b1 === 2500, [jo.b1, rae.b1]);
  check('boxes 3 and 7: tips in box 7, not in box 3', jo.b3 === 5200 && jo.b7 === 800 && rae.b3 === 1600 && rae.b7 === 900, [jo.b3, jo.b7, rae.b3, rae.b7]);
  check('boxes 2, 4 and 6: what was withheld', jo.b2 === Math.round((a.employee.federal + b.employee.federal) * 100) / 100 && jo.b4 === Math.round((a.employee.socialSecurity + b.employee.socialSecurity) * 100) / 100 && jo.b5 === 6000);
  check('box 12 D and box 13: retirement taken out before taxes', jo.b12.some((x) => x.code === 'D' && x.amount === 200) && jo.b13 && !rae.b13);
  check('boxes 16 and 17: the state’s wages and tax', jo.state?.code === 'NC' && jo.state.wages === 5800 && jo.state.tax === Math.round((a.employee.state + b.employee.state) * 100) / 100, jo.state);
  const short = run(nc, '2026-04-09', 'c', [{ id: 'rae', name: 'Rae Lin', gross: 1000, tips: 990, inHand: 990 }]);
  const rs = w2sFor([short], nc, 2026)[0];
  check('box 12 A and B: Social Security and Medicare on tips that couldn’t be withheld', rs.b12.some((x) => x.code === 'A' && x.amount > 0) && rs.b12.some((x) => x.code === 'B' && x.amount > 0), rs.b12);

  console.log('…the state’s programs and city taxes');
  const nj = T('NJ'); const njf = { jo: { federal: { status: 'single' }, state: { state: 'NJ', status: 'single' } } };
  const njw = w2sFor([run(nj, '2026-03-12', 'a', [{ id: 'jo', name: 'Jo Park', gross: 3000, tips: 0 }], njf)], nj, 2026)[0];
  check('box 14: New Jersey’s programs taken from pay', njw.b14.length >= 1 && njw.b14.every((x) => x.amount > 0), njw.b14);
  const ny = T('NY'); const nyf = { jo: { federal: { status: 'single' }, state: { state: 'NY', status: 'single', local: 'nyc' } } };
  const w = withholdingFor({ year: 2026, periods: 26, gross: 3000, forms: nyf.jo as any, state: 'NY' });
  check('New York City’s part of the state’s tax is kept apart', (w.employee.stateLocal || 0) > 0 && w.employee.localName === 'NYC' && w.employee.stateLocal! < w.employee.state, w.employee);
  const nyw = w2sFor([run(ny, '2026-03-12', 'a', [{ id: 'jo', name: 'Jo Park', gross: 3000, tips: 0 }], nyf)], ny, 2026)[0];
  check('…box 17 is the state’s alone; boxes 18 to 20 are New York City’s', nyw.state!.tax === Math.round((w.employee.state - w.employee.stateLocal!) * 100) / 100 && nyw.locals[0]?.name === 'NYC' && nyw.locals[0].tax === w.employee.stateLocal && nyw.locals[0].wages === 3000, nyw);
  const inn = withholdingFor({ year: 2026, periods: 26, gross: 3000, forms: { federal: { status: 'single' }, state: { state: 'IN', local: 'marion' } } as any, state: 'IN' });
  check('…and an Indiana county’s, named', (inn.employee.stateLocal || 0) > 0 && inn.employee.localName === 'Marion', inn.employee);
  const city = T('KY', { other: [{ id: 'lex', name: 'Lexington occupational tax', rate: 2.25, who: 'employee' }] });
  const cw = w2sFor([run(city, '2026-03-12', 'a', [{ id: 'jo', name: 'Jo Park', gross: 3000, tips: 0 }], { jo: { federal: { status: 'single' }, state: { state: 'KY' } } })], city, 2026)[0];
  check('…a city tax the business added, in boxes 18 to 20', cw.locals.some((l) => l.name === 'Lexington occupational tax' && l.tax === 67.5 && !l.withState), cw.locals);

  console.log('…with pay from before ClarityFlow');
  const prior = { kind: 'prior', year: 2026, lastPayDate: '2026-02-26', futaPaid: 42, people: [{ staffId: 'jo', name: 'Jo Park', wages: 7000, tips: 500, fedWages: 6800, federal: 600, ss: 434, medicare: 101.5, state: 250, q: { wages: 7000, tips: 500, federal: 600, ss: 434, medicare: 101.5, state: 250 } }] };
  const jp = w2sFor([...runs, prior], nc, 2026).find((x) => x.staffId === 'jo')!;
  check('every box has its part, and says box 12 and 14 amounts are on the old payroll’s report', jp.b1 === 12600 && jp.b2 === jo.b2 + 600 && jp.b7 === 1300 && jp.b3 === 11700 && jp.b5 === 13000 && jp.state!.wages === 12600 && jp.prior, [jp.b1, jp.b3, jp.b7]);

  console.log('W-3');
  const w3 = w3For(w2);
  check('the W-2s’ totals', w3.count === 2 && w3.b1 === 8300 && w3.b7 === 1700 && w3.b12a === 200 && w3.state?.wages === 8300);

  console.log('Form 940');
  const f = form940(runs, nc, 2026); const L = (n: string) => f.lines.find((l) => l.line === n)!;
  check('everything paid, what’s over each person’s $7,000, 0.6% on the rest', L('3').amount === 8500 && L('5').amount === 0 && L('7').amount === 8500 && L('8').amount === 51 && f.total === 51, f.lines.slice(0, 8));
  check('under $500: no quarter by quarter', !f.lines.some((l) => l.line.startsWith('16')));
  const big = [run(nc, '2026-02-12', 'x', [{ id: 'jo', name: 'Jo', gross: 9000, tips: 0 }, { id: 'rae', name: 'Rae', gross: 9000, tips: 0 }]), ...Array.from({ length: 12 }, (_, i) => run(nc, `2026-${String(i % 3 * 3 + 3).padStart(2, '0')}-1${i % 9}`, `y${i}`, [{ id: `p${i}`, name: `P${i}`, gross: 8000, tips: 0 }]))];
  const fb = form940(big, nc, 2026); const q = fb.lines.filter((l) => l.line.startsWith('16'));
  check('over $500: what was owed each quarter, adding up to the year’s', fb.total > 500 && q.length === 4 && Math.abs(q.reduce((t, l) => t + l.amount, 0) - fb.total) < 0.02, [fb.total, q.map((l) => l.amount)]);
  const fp = form940([...runs, prior], nc, 2026);
  check('pay from before ClarityFlow counts, and what the old payroll paid', fp.lines.find((l) => l.line === '3')!.amount === 15500 && fp.lines.find((l) => l.line === '7')!.amount === 9500 && fp.lines.find((l) => l.line === '13')!.amount === 42);
  const ca = T('CA'); const caf = { jo: { federal: { status: 'single' }, state: { state: 'CA', status: 'single' } } };
  const caRuns = [run(ca, '2026-03-12', 'a', [{ id: 'jo', name: 'Jo', gross: 9000, tips: 0 }], caf)];
  const fc = form940(caRuns, ca, 2026);
  check('California’s 1.5% credit reduction for 2026 (Schedule A)', fc.lines.find((l) => l.line === '11')?.amount === 105 && fc.total === 147, fc.lines);
  const cr = owedItems(caRuns, ca, '2026-11-26').find((i) => i.key === 'futa_cr_2026');
  check('…in what’s owed, due with Form 940', cr?.amount === 105 && cr.due === '2027-02-01' && cr.agency === 'futa', cr);
  check('…and nowhere else', !owedItems(runs, nc, '2026-11-26').some((i) => i.key.startsWith('futa_cr')));

  console.log('The state’s year-end form');
  const st = stateAnnual(runs, nc, 2026, w2)!;
  check('North Carolina’s NC-3: the W-2s, what they withheld, due February 1', st.form === 'NC-3' && st.due === '2027-02-01' && st.lines[0].amount === 2 && st.lines.find((l) => l.line === 'Withheld')!.amount === Math.round(w2.reduce((t, x) => t + (x.state?.tax || 0), 0) * 100) / 100, st);
  check('none for a state without income tax', stateAnnual(runs, T('TX'), 2026, []) === null);

  console.log('1099-NEC');
  const nec = form1099s(runs, nc, 2026);
  check('each contractor paid through Payday, cash included; due at $2,000 or more from 2026', nec.find((x) => x.staffId === 'lee')?.amount === 2050 && nec.find((x) => x.staffId === 'lee')!.due && !nec.find((x) => x.staffId === 'max')!.due && necThreshold(2025) === 600, nec);
  check('all due February 1, 2027: January 31 is a Sunday', yearEndDue(2026) === '2027-02-01' && yearEndDue(2027) === '2028-01-31');

  console.log('On Payday');
  const page = src('src/app/(app)/money/page.tsx'); const dlg = src('src/components/money/YearEndDialog.tsx'); const screen = src('src/components/money/PaydayScreen.tsx');
  check('from November to April: the year ending, then the year just over', /return m >= 11 \? y : m <= 4 \? y - 1 : null;/.test(page) && /o\?\.yearEnd && /.test(screen));
  check('never asks for a Social Security number or an EIN: they’re written on the forms', !/<input/.test(dlg) && /ClarityFlow never keeps them/.test(dlg));
  check('house style', !/className="[^"]*uppercase/.test(dlg) && !/ · /.test(dlg) && !/>[^<{}]*[A-Za-z]'[A-Za-z][^<{}]*</.test(dlg) && !/\{\/\*/.test(dlg));

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nAll passed');
})();
