// Checks the tip credit estimate on the Write-offs tab (IRS Form 8846; lib/tip-credit, api/writeoffs, lib/payday-record):
//   Food and drink count tips above a $5.15 minimum wage top-up; nail, hair, esthetics, barber and spa services (from
//   2025) above $7.25. The test is month by month, each person's pay without tips against their hours; a month without
//   hours counts every tip (the most it could be). Contractors never count. Tips past the Social Security wage base count
//   for Medicare only. Paydays keep each person's hours from now on. Only the owner and anyone who runs payroll see it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/tip-credit.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';
import { tipCreditEstimate, tipCreditKind, BEAUTY_MIN_WAGE, FOOD_MIN_WAGE } from '../../src/lib/tip-credit';
import { cleanPayday } from '../../src/lib/payday-record';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const run = (payDate: string, people: any[]) => ({ kind: 'payday', payDate, people });

console.log('Which tips count');
check('nails, hair, lashes, barbering, beauty, spa and med spa count as beauty services; food and drink as food; a tattoo studio, a shop or one not placed don’t',
  ['nails', 'hair', 'lash', 'barber', 'beauty', 'spa', 'medspa'].every((n) => tipCreditKind({ niche: n }) === 'beauty') && tipCreditKind({ niche: 'hospitality' }) === 'food'
  && [{ niche: 'tattoo' }, { niche: 'shop' }, { niche: 'general' }].every((t) => tipCreditKind(t) === null) && BEAUTY_MIN_WAGE === 7.25 && FOOD_MIN_WAGE === 5.15);
check('beauty services from 2025 on; nothing when the business’s tips don’t count', tipCreditEstimate([run('2024-03-13', [{ staffId: 'a', tips: 100, paid: 900, hours: 40 }])], 2024, 'beauty') === null
  && tipCreditEstimate([], 2026, null) === null && tipCreditEstimate([run('2024-03-13', [{ staffId: 'a', tips: 100, paid: 900, hours: 40 }])], 2024, 'food') !== null);

console.log('How much');
const runs = [
  run('2026-03-13', [{ staffId: 'a', tips: 500, paid: 1500, hours: 80 }, { staffId: 'b', tips: 300, paid: 600, hours: 70 }, { staffId: 'c', tips: 200, paid: 1200, contractor: true }]),
  run('2026-03-27', [{ staffId: 'a', tips: 100, paid: 500 }]),
  run('2025-12-26', [{ staffId: 'a', tips: 999, paid: 2000, hours: 80 }]),
  { kind: 'taxpayment', payDate: '2026-03-30' },
];
const c = tipCreditEstimate(runs, 2026, 'beauty')!;
// (a, March: $600 in tips, a payday without hours, so all of it; b: $300 less the $207.50 that tops $300 of pay up to
// 70 hours at $7.25; c a contractor; last year's payday not counted.)
check('7.65% of the tips above the minimum wage top-up, month by month; a month without hours counts every tip', c.creditCents === Math.round((600 * 0.0765 + 92.5 * 0.0765) * 100) && c.tipsCents === 90000 && c.creditableCents === 69250, c);
check('who and how many paydays: contractors left out, one payday without hours said', c.people === 2 && c.paydays === 2 && c.noHours === 1 && c.minWage === 7.25);
const f = tipCreditEstimate([run('2026-05-15', [{ staffId: 'e', tips: 200, paid: 600, hours: 100 }])], 2026, 'food')!;
check('food and drink: the top-up is to $5.15 an hour', f.creditCents === Math.round(85 * 0.0765 * 100) && f.minWage === 5.15, f);
const big = tipCreditEstimate([run('2026-01-30', [{ staffId: 'd', tips: 1000, paid: 190000 - 1000 + 0, taxes: { gross: 190000 } }])], 2026, 'beauty')!;
check('tips past the Social Security wage base count for Medicare only', big.creditCents === 1450, big);
const pr = tipCreditEstimate([{ kind: 'prior', year: 2026, people: [{ staffId: 'g', wages: 184000, tips: 300 }] }, run('2026-11-13', [{ staffId: 'g', tips: 1000, paid: 1000 }])], 2026, 'beauty')!;
check('pay from before ClarityFlow counts toward the wage base; its tips are said to be left out', pr.creditCents === Math.round((500 * 0.0765 + 500 * 0.0145) * 100) && pr.priorTips === true, pr);

console.log('Paydays keep the hours');
const clean: any = cleanPayday({ periodKey: '2026-03-01_2026-03-14', from: '2026-03-01', to: '2026-03-14', people: [{ staffId: 'a', name: 'Ana', amount: 900, cash: 0, tips: 120, hours: 72.5 }, { staffId: 'b', name: 'Bo', amount: 400, cash: 0, hours: 99999 }], setAsides: [] });
check('each person’s hours, when known and sensible', typeof clean === 'object' && clean.people[0].hours === 72.5 && clean.people[1].hours === undefined, clean);
check('Payday sends the hours when the time clock has them, and the record keeps them', /\.\.\.\(!o\.noHours && Number\(o\.hours\) > 0 \? \{ hours: /.test(src('src/app/(app)/money/page.tsx'))
  && /\.\.\.\(p\.hours \? \{ hours: p\.hours \} : \{\}\)/.test(src('src/lib/payday-record.ts')));

console.log('Who sees it');
const route = src('src/app/api/writeoffs/route.ts');
check('the owner and anyone who runs payroll only; read from the year’s paydays', /const seesPay = !!a\.isTenantOwner \|\| \(Array\.isArray\(a\.caps\) && a\.caps\.includes\('money\.payroll'\)\)/.test(route)
  && /const runsCol = db\.collection\(`tenants\/\$\{tenantId\}\/payrollRuns`\)/.test(route) && /seesPay && kind \? runsCol\.where\('payDate', '>=', `\$\{year\}-01-01`\)/.test(route)
  && /seesPay && kind \? runsCol\.where\('to', '>=', `\$\{year\}-01-01`\)/.test(route) && /seesPay && kind \? runsCol\.where\('kind', '==', 'prior'\)/.test(route));
const screen = src('src/components/money/WriteOffsScreen.tsx');
check('on the tab: an estimate, a credit off the tax, and the same amount off the payroll tax deduction', /Tip credit \(Form 8846\), an estimate/.test(screen) && /comes back as a credit off the tax itself/.test(screen) && /takes the same amount off the payroll tax deduction/.test(screen));

console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exit(failures ? 1 : 0);
