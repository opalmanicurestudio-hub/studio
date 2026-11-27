// Checks a renter's tax set-aside in their portal (Money, Your business, Taxes to set aside; included in rent;
// api/portal/renter-taxes, lib/renter-taxes, lib/renter-earned, components/rent/RenterTaxes):
//   Self-employment tax: 15.3% of 92.35% of the net (12.4% up to the Social Security wage base, $184,500 for 2026; 2.9%
//   on all), none under $400. Federal income tax from 2026's brackets and standard deduction for how they file, after
//   half the self-employment tax and the 20% deduction for business income, on top of the household's other income.
//   State at a typical rate for their state. The four due dates (the 15th, moved past weekends and holidays) and the
//   year being paid toward until January 15. Each date asks for the tax on what's been earned so far, annualized the
//   IRS's way, less what they paid; last year's tax in four parts also avoids a penalty. What they earn through
//   ClarityFlow (the same reading as Earnings and expenses) and tips the front desk collected for them, less their
//   write-offs by month. Their answers and payments kept privately with their log. A later year uses the latest figures
//   and says so.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renter-taxes.verify.ts
import fs from 'fs';
import Module from 'module';
import { createHash } from 'crypto';
import { makeDb, check, failures } from './fake-db';
import { seTaxOf, incomeTaxOf, taxOn, dueDay, quartersOf, planYearOf, taxPlan, tableFor, cleanTaxSettings, cleanTaxPayment } from '../../src/lib/renter-taxes';
import { writeOffsByMonth, deskTipsByMonth, shopSalesByMonth } from '../../src/lib/renter-write-offs';
import { monthlyDays } from '../../src/lib/renter-earned';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const db = makeDb();
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/here-server') return { bizLocationsOf: async () => [] };
  if (request === '@/lib/geocode-server') return { geocode: async () => null, reverseGeocode: async () => null, preciseEnough: () => false };
  if (request === '@/lib/route-server') return { roadLegs: async () => null };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

(async () => {
  console.log('The year’s tax');
  check('self-employment tax: 15.3% of 92.35% of $40,000; none under $400; Social Security stops at the wage base', seTaxOf(4000000, 2026) === Math.round(36940 * 100 * 0.153) && seTaxOf(40000, 2026) === 0
    && seTaxOf(30000000, 2026) === Math.round(18450000 * 0.124 + 30000000 * 0.9235 * 0.029));
  // ($40,000 single: less half the SE tax $2,825.91 is $37,174.09; less the $16,100 standard deduction, $21,074.09; the
  // 20% deduction is capped at 20% of that, $4,214.82; $16,859.27 taxed: $1,240 + 12% of $4,459.27.)
  check('federal income tax: brackets, standard deduction, half the SE tax, the 20% deduction for business income', incomeTaxOf(4000000, 0, 'single', 2026) === 177511, incomeTaxOf(4000000, 0, 'single', 2026));
  check('on top of other household income: taxed at the household’s rate', incomeTaxOf(4000000, 9000000, 'joint', 2026) > incomeTaxOf(4000000, 0, 'joint', 2026) && incomeTaxOf(0, 9000000, 'joint', 2026) === 0);
  // ($400,000 single: past the $276,750 end of the phase-in, so no 20% deduction; $230,000: partly.)
  const noQbi = (net: number) => { const adj = net - seTaxOf(net, 2026) / 2; const ti = (adj - 1610000) / 100; let tax = 0, low = 0; for (const [up, r] of [[12400, .1], [50400, .12], [105700, .22], [201775, .24], [256225, .32], [640600, .35], [Infinity, .37]] as [number, number][]) { if (ti <= low) break; tax += (Math.min(ti, up) - low) * r; low = up; } return Math.round(tax * 100); };
  check('the 20% deduction for business income shrinks across the phase-in range, to nothing past it', incomeTaxOf(40000000, 0, 'single', 2026) === noQbi(40000000) && incomeTaxOf(23000000, 0, 'single', 2026) < noQbi(23000000) && incomeTaxOf(23000000, 0, 'single', 2026) > noQbi(23000000) - 0.2 * (23000000 - seTaxOf(23000000, 2026) / 2) * 0.24);
  const t = taxOn(4000000, { otherCents: 0, filing: 'single', statePct: 4.5, year: 2026 });
  check('state at their state’s rate on the net less half the SE tax; IRS is SE plus federal', t.state === Math.round((4000000 - 565182 / 2) * 0.045) && t.irs === t.se + t.federal && t.total === t.irs + t.state, t);
  check('a year not in yet uses the latest figures and says so', tableFor(2027).stale && tableFor(2027).year === 2026 && !tableFor(2026).stale);

  console.log('The dates');
  check('the 15th of April, June, September and next January, moved past a weekend or a holiday', quartersOf(2026).map((q) => q.due).join() === '2026-04-15,2026-06-15,2026-09-15,2027-01-15'
    && dueDay(2022, 4) === '2022-04-18' && dueDay(2028, 1) === '2028-01-18' && dueDay(2027, 4) === '2027-04-15');
  check('paying toward last year until its January payment has passed', planYearOf('2027-01-15') === 2026 && planYearOf('2027-01-16') === 2027 && planYearOf('2026-11-27') === 2026);

  console.log('The plan');
  const e: any = {}, w: any = {}; for (let m = 1; m <= 11; m++) { e[`2026-${String(m).padStart(2, '0')}`] = 500000; w[`2026-${String(m).padStart(2, '0')}`] = 160000; }
  const p = taxPlan({ year: 2026, today: '2026-11-27', earnedByMonth: e, writeOffsByMonth: w, outsideCents: 0, otherCents: 0, filing: 'single', statePct: 4.5, lastYearTaxCents: 800000, payments: [{ id: 'a', date: '2026-04-10', cents: 150000, to: 'irs' }] });
  const q1 = p.quarters[0];
  check('each date: the tax on what’s been earned through its months, annualized (times 4 for March), a quarter of it', q1.netCents === 1020000 && q1.irsDueSoFar === Math.round(taxOn(4080000, { otherCents: 0, filing: 'single', statePct: 4.5, year: 2026 }).irs * 0.25), q1);
  check('less what they paid by then; past dates, the next one and later', q1.irsCents === q1.irsDueSoFar - 150000 && p.quarters.slice(0, 3).every((q) => q.when === 'past') && p.next?.q === 4 && p.next.when === 'now');
  check('last year’s tax in four parts, less what’s paid', p.quarters[3].safeCents === 800000 - 150000 && q1.safeCents === 200000 - 150000);
  const hi = taxPlan({ year: 2026, today: '2026-11-27', earnedByMonth: e, writeOffsByMonth: w, outsideCents: 0, otherCents: 0, filing: 'single', statePct: 4.5, lastYearTaxCents: 800000, lastYearHigh: true, payments: [] });
  check('110% of last year’s tax when last year’s income was over $150,000', hi.quarters[0].safeCents === 220000 && hi.quarters[3].safeCents === 880000);
  check('so far, and at this pace: how much of each dollar to keep back', p.soFar.netCents === 3740000 && p.pace.netCents === Math.round(3740000 * 12 / 11) && p.pace.perDollar > 0.2 && p.pace.perDollar < 0.25, p.pace);
  const out = taxPlan({ year: 2026, today: '2026-05-10', earnedByMonth: { '2026-02': 300000 }, writeOffsByMonth: {}, outsideCents: 200000, otherCents: 0, filing: 'single', statePct: 0, lastYearTaxCents: null, payments: [] });
  check('income from outside ClarityFlow counts from the period it’s said in on', out.quarters[0].netCents === 300000 && out.quarters[1].netCents === 500000 && out.soFar.inCents === 500000);

  console.log('What they send');
  check('how they file, their state, amounts in dollars kept in cents; nonsense refused', (cleanTaxSettings({ filing: 'joint', state: 'nc', other: '52,000', outside: '', lastYearTax: '$3,100.50' }) as any).s.otherCents === 5200000
    && (cleanTaxSettings({ lastYearTax: '' }) as any).s.lastYearTaxCents === null && !cleanTaxSettings({ filing: 'married' }).ok && !cleanTaxSettings({ state: 'Carolina' }).ok && !cleanTaxSettings({ other: 'lots' }).ok);
  check('a payment: a day this year or last, up to today; an amount; the IRS or the state', cleanTaxPayment({ date: '2026-04-10', amount: '850', to: 'irs' }, '2026-11-27').ok && !cleanTaxPayment({ date: '2026-12-01', amount: '850', to: 'irs' }, '2026-11-27').ok
    && !cleanTaxPayment({ date: '2026-04-10', amount: '850', to: 'city' }, '2026-11-27').ok);

  console.log('By month');
  const Y = 2026;
  const wm = writeOffsByMonth([{ id: 'c1', renterId: 'r1', date: '2026-03-05', cents: 8000, category: 'Meals' }, { id: 'c2', renterId: 'r1', date: '2026-03-09', cents: 12000, category: 'Supplies' }],
    [{ id: 'p1', type: 'income', category: 'Booth Rent', amount: 800, date: '2026-03-01' }, { id: 'u1', type: 'reversal', reversalOf: 'p1', amount: 800, date: '2026-04-01' }],
    [{ id: 'l1', type: 'desk_offset', status: 'paid', amountCents: -5000, appliedCents: 5000, lastAppliedAt: '2026-05-02T00:00:00Z' }],
    [{ kind: 'trip', use: 'business', day: '2026-03-20', tenths: 100 }, { kind: 'trip', use: 'commute', day: '2026-03-20', tenths: 100 }], Y);
  check('write-offs by month: costs that count, rent (an undo in its own month), credit used, business miles at the rate', wm['2026-03'] === 4000 + 12000 + 80000 + 725 && wm['2026-04'] === -80000 && wm['2026-05'] === 5000, wm);
  check('a monthly membership: each month it ran, on its day (the month’s last when shorter), up to today, before it ended', monthlyDays('2026-01-31', '2026-01-01', '2027-01-01', '2026-04-15', null).join() === '2026-01-31,2026-02-28,2026-03-31'
    && monthlyDays('2025-11-10', '2026-01-01', '2027-01-01', '2026-12-31', '2026-03-10').join() === '2026-01-10,2026-02-10');
  check('their share of online shop sales, by month', shopSalesByMonth([{ type: 'retail_sale_credit', status: 'paid', amountCents: -2400, date: '2026-05-02T10:00:00Z' }, { type: 'retail_sale_credit', status: 'voided', amountCents: 0, date: '2026-05-02' }], Y)['2026-05'] === 2400);
  check('tips the front desk collected, by month', deskTipsByMonth([{ type: 'desk_collected', kind: 'tip', amountCents: 1200, date: '2026-02-03' }, { type: 'desk_collected', kind: 'service', amountCents: 9000, date: '2026-02-03' }], Y)['2026-02'] === 1200);

  console.log('The route');
  await db.doc('tenants/t1').set({ name: 'North Loft', timezone: 'America/New_York', taxState: 'NC' });
  await db.doc('tenants/t1/private/renterSessions').set({ [sha('tok-ana')]: { renterId: 'r1', name: 'Ana', expiresAt: Date.now() + 3600e3 }, [sha('tok-bo')]: { renterId: 'r2', name: 'Bo', expiresAt: Date.now() + 3600e3 } });
  await db.doc('tenants/t1/renters/r1').set({ firstName: 'Ana', lastName: 'Ruiz' });
  await db.doc('tenants/t1/staff/s1').set({ name: 'Ana Ruiz', renterId: 'r1', isRenter: true });
  const PY = planYearOf(new Date().toISOString().slice(0, 10));
  await db.doc('tenants/t1/appointments/a1').set({ staffId: 's1', isRenterBooking: true, status: 'completed', startTime: `${PY}-03-04T15:00:00.000Z`, renterServicePrice: 65 });
  await db.doc('tenants/t1/appointments/a2').set({ staffId: 's1', isRenterBooking: true, status: 'cancelled', startTime: `${PY}-03-05T15:00:00.000Z`, renterServicePrice: 65 });
  await db.doc('tenants/t1/renterPackagePurchases/k1').set({ staffId: 's1', purchasedAt: `${PY}-04-02T15:00:00.000Z`, amountCents: 20000 });
  await db.doc('tenants/t1/rentLedger/l1').set({ renterId: 'r1', type: 'desk_collected', kind: 'tip', amountCents: 1500, date: `${PY}-03-04` });
  await db.doc('tenants/t1/renterMemberSubscriptions/m1').set({ staffId: 's1', startedAt: `${PY}-01-20T12:00:00.000Z`, priceCents: 4000, status: 'active', endedAt: `${PY}-03-25T00:00:00.000Z` });
  await db.doc('tenants/t1/renterMemberSubscriptions/m2').set({ staffId: 's1', startedAt: `${PY}-04-05T12:00:00.000Z`, priceCents: 1000, status: 'active', cancelAtPeriodEnd: true, cancelRequestedAt: `${PY}-05-20T12:00:00.000Z` });
  await db.doc('tenants/t1/renterMemberSubscriptions/m3').set({ staffId: 's1', startedAt: `${PY}-04-05T12:00:00.000Z`, priceCents: 777, status: 'incomplete' });
  await db.doc('tenants/t1/renterExpenses/x1').set({ id: 'x1', renterId: 'r1', date: `${PY}-03-06`, cents: 4000, category: 'Supplies' });
  await db.doc('tenants/t1/renterExpenses/x2').set({ id: 'x2', renterId: 'r2', date: `${PY}-03-06`, cents: 99000, category: 'Supplies' });
  const POST: (r: any) => Promise<any> = (await import('../../src/app/api/portal/renter-taxes/route')).POST as any;
  const req = (body: any, token = 'tok-ana') => ({ json: async () => ({ tenantId: 't1', token, ...body }), headers: { get: () => null } }) as any;
  let r: any = await POST(req({ action: 'list' }, 'nope'));
  check('no session: asked to sign in again', r.status === 401);
  r = await POST(req({ action: 'list' }));
  check('earned through ClarityFlow (completed visits at their price, package sales, a membership each month it ran, not after a cancel at the period’s end, not one never paid) and front-desk tips, by month; their own costs only', r.status === 200 && r.body.earnedByMonth[`${PY}-03`] === 6500 + 1500 + 4000 && r.body.earnedByMonth[`${PY}-04`] === 20000 + 1000 && r.body.earnedByMonth[`${PY}-05`] === 1000 && !r.body.earnedByMonth[`${PY}-06`] && r.body.earnedByMonth[`${PY}-01`] === 4000 && r.body.earnedByMonth[`${PY}-02`] === 4000
    && r.body.writeOffsByMonth[`${PY}-03`] === 4000, r.body);
  check('their state from the business’s until they say, at a typical rate', r.body.settings.state === 'NC' && r.body.settings.statePct > 0 && r.body.settings.filing === 'single');
  r = await POST(req({ action: 'settings', filing: 'head', state: 'TX', outside: '1,200' }));
  r = await POST(req({ action: 'pay', date: `${PY}-04-10`, amount: '300', to: 'irs' }));
  const kept: any = (await db.doc(`tenants/t1/private/renter_r1/taxes/${PY}`).get()).data();
  check('what they say and pay, kept privately with their log', kept.filing === 'head' && kept.state === 'TX' && kept.outsideCents === 120000 && kept.payments.length === 1 && kept.payments[0].cents === 30000);
  r = await POST(req({ action: 'list' }));
  check('a state without income tax says so', r.body.settings.stateType === 'none' && r.body.settings.statePct === 0);
  r = await POST(req({ action: 'list' }, 'tok-bo'));
  check('another renter’s are their own', r.body.payments.length === 0 && r.body.settings.filing === 'single' && !r.body.earnedByMonth[`${PY}-03`]);
  r = await POST(req({ action: 'unpay', id: kept.payments[0].id }, 'tok-bo'));
  check('another renter can’t take a payment off', r.status === 404);
  r = await POST(req({ action: 'unpay', id: kept.payments[0].id }));
  check('their own payment taken off', r.status === 200 && (await db.doc(`tenants/t1/private/renter_r1/taxes/${PY}`).get()).data().payments.length === 0);

  const tr = src('src/app/api/portal/renter-taxes/route.ts');
  check('until April 15, last year’s payments are listed and can be taken off', /lastYearPayments: today <= dueDay\(year, 4\)/.test(tr) && /const uRef = Number\(b\.forYear\) === year - 1 && today <= dueDay\(year, 4\)/.test(tr)
    && /action: 'unpay', id: p\.id, forYear: g\.y/.test(src('src/components/rent/RenterTaxes.tsx')));
  check('payments saved and taken off in a transaction; until April 15 one can be for last year', (tr.match(/db\.runTransaction/g) || []).length === 2 && /Number\(b\.forYear\) === year - 1 && today <= dueDay\(year, 4\)/.test(tr));

  console.log('Where it is');
  const PM = await import('../../src/components/rent/portal-map');
  const base = { booksHere: false, hasRenter: true, hasLease: true, swapsOn: false };
  check('Money, Your business, Taxes to set aside: for anyone with a renter record', PM.viewAllowed('taxes', base) && !PM.viewAllowed('taxes', { ...base, hasRenter: false }) && PM.placeRows('money', base).some((g: any) => g.views.includes('taxes')));
  const page = src('src/app/rent/[tenantId]/page.tsx'); const screen = src('src/components/rent/RenterTaxes.tsx'); const route = src('src/app/api/portal/renter/route.ts');
  check('the portal opens it with their session; the screen says it’s an estimate and their accountant works out what they owe', /case 'taxes': return <RenterTaxes tenantId=\{tenantId\} token=\{token\} \/>/.test(page)
    && /An estimate to set money aside by, not your tax bill: your accountant works out what you owe\./.test(screen) && /href="https:\/\/www\.irs\.gov\/payments"/.test(screen));
  check('Earnings and expenses reads what they earned the same way', /const \{ visits, packages \} = await renterEarned\(db, tenantId, String\(session\.renterId \|\| ''\), from, to\);/.test(route) && /renterAppointments\(db, tenantId, ids, fromIso, toIso\)/.test(route));
  check('the yearly tables task covers these figures', /renter-taxes/.test(src('src/lib/renter-taxes.ts')) && /Payroll and tax tables yearly update/.test(src('src/lib/renter-taxes.ts')));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
