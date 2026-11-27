// Checks sales tax from start to finish (design board "Sales tax: settings, the filing report and checkout"):
//   lib/pos-tax          — nothing is added until it's set (no 7% default); a location's own rates
//   lib/checkout-calc    — the desk works it out at its location
//   lib/counter-orders   — the counter, the kiosk and ordering ahead, at the order's location, keeping the rate and what was taxed
//   lib/sales-tax-filing — periods, the day each is due, the reminder
//   lib/sales-tax-report — what the return asks for, by location, the online shop on its own line
//   lib/sales-tax-server — the report from the books, recording the payment once, the reminder until it's paid
//   lib/setup-guide      — the step, done once the rates are saved
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/sales-tax.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, strictTransactions, FV, check, failures } from './fake-db';

const db: any = strictTransactions(makeDb());
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  return load.call(this, request, ...rest);
};
const get = async (p: string) => (await db.doc(p).get()).data() || null;

(async () => {
  const PT = await import('../../src/lib/pos-tax');
  const CC = await import('../../src/lib/checkout-calc');
  const CO = await import('../../src/lib/counter-orders');
  const F = await import('../../src/lib/sales-tax-filing');
  const R = await import('../../src/lib/sales-tax-report');
  const RB = await import('../../src/lib/report-builders');
  const SG = await import('../../src/lib/setup-guide');

  console.log('what’s added at checkout');
  const unset = { name: 'North Loft', salesTax: { configured: false, startsUnset: true } };
  check('a new business has no sales tax added until it sets it (no 7% guess), and checkout says it isn’t set up',
    PT.posTaxAmount(unset, { services: 100, products: 100 }) === 0 && PT.posTaxOf(unset).unset && PT.posTaxLabel(unset) === 'Sales tax (not set up yet)');
  const old = { name: 'Harbor' };
  check('a business from before keeps the 7% it always charged until its owner saves the rates, so it never stops collecting tax it owes',
    PT.posTaxAmount(old, { services: 100, products: 100 }) === 14 && PT.posTaxOf(old).legacy && !PT.posTaxOf(old).unset && PT.posTaxLabel(old) === 'Sales tax (7%, check your tax settings)');
  const shopOnly = { salesTax: { configured: false, startsUnset: true }, retailSettings: { taxRatePercent: 6 } };
  check('a new business that set its shop’s rate has it on products at checkout too', PT.posTaxAmount(shopOnly, { services: 100, products: 100 }) === 6 && !PT.posTaxOf(shopOnly).unset);
  const signup = fs.readFileSync('src/app/api/signup/route.ts', 'utf8');
  check('a business signing up starts with sales tax not set', /salesTax: \{ configured: false, startsUnset: true \}/.test(signup));
  const set = { name: 'North Loft', retailSettings: { taxRatePercent: 8.25 }, salesTax: { configured: true, servicesTaxed: false, byLocation: { east: { productsPct: 6.25, servicesTaxed: true, servicesPct: 6.25 } } } };
  check('set: products at the business’s rate, services only when they’re taxed', PT.posTaxAmount(set, { services: 100, products: 100 }) === 8.25 && PT.posTaxLabel(set) === 'Sales tax (8.25% on products, services not taxed)');
  check('a location with its own rates uses them, services too when they’re taxed there', PT.posTaxAmount(set, { services: 100, products: 100 }, 'east') === 12.5 && PT.posTaxOf(set, 'east').atLocation
    && PT.posTaxAmount(set, { services: 0, products: 100 }, 'west') === 8.25);
  const zero = { salesTax: { configured: true, servicesTaxed: false }, retailSettings: { taxRatePercent: 0 } };
  check('0% saved is set, not “not set up”', !PT.posTaxOf(zero).unset && PT.posTaxLabel(zero) === 'Sales tax (none)');
  const calc: any = CC.computeCheckout({ tenant: set, taxAt: 'east', visits: [], staff: [], redeemedOffer: null, waivedIds: [], items: [{ id: 'i1', type: 'product', name: 'Oil', price: 20, quantity: 1 } as any], fees: [], discounts: [], client: null, memberships: [], tip: 0, storeCredit: 0 });
  check('the desk works it out at its own location, and says what was taxed', calc.tax === 1.25 && calc.taxableProducts === 20 && /6.25%/.test(calc.taxLabel), { tax: calc.tax, label: calc.taxLabel, tp: calc.taxableProducts });
  const line = (p: number, extra: any = {}) => ({ lineId: 'l1', itemId: 'm1', name: 'Latte', quantity: 1, unitPrice: p, choices: [], choicesText: null, makeSeconds: 60, ...extra });
  const tot: any = CO.totalsOf(set, [line(10), line(5, { lineId: 'l2', untaxed: true })] as any, 0, 'east');
  check('the counter works it out at the order’s location, and keeps the rate and what was taxed for its books line', tot.tax === 0.63 && tot.taxPct === 6.25 && tot.taxedAmount === 10, tot);
  check('…nothing at a business that hasn’t set it', CO.totalsOf(unset, [line(10)] as any).tax === 0);

  console.log('when it’s due');
  const oct = F.periodOf('2026-10', 20)!, q4 = F.periodOf('2026-Q4', 31)!, yr = F.periodOf('2026', 20)!;
  check('a month is due on its day of the month after', oct.start === '2026-10-01' && oct.end === '2026-10-31' && oct.due === '2026-11-20' && oct.label === 'October 2026');
  check('three months: due the month after they end, on the last day when the month is shorter', q4.start === '2026-10-01' && q4.end === '2026-12-31' && q4.due === '2027-01-31'
    && F.periodOf('2026-Q4', 30)!.due === '2027-01-30' && F.periodOf('2027-Q4', 31)!.due === '2028-01-31' && F.periodOf('2027-Q1', 31)!.due === '2027-04-30');
  check('a year is due in January', yr.start === '2026-01-01' && yr.end === '2026-12-31' && yr.due === '2027-01-20');
  const fm = F.filingOf({ salesTax: { filing: { every: 'month', dueDay: 20, remind: true } } });
  check('the last period that ended is the one to file', F.lastEnded('2026-11-14', fm).key === '2026-10' && F.lastEnded('2027-01-05', F.filingOf({ salesTax: { filing: { every: 'quarter' } } })).key === '2026-Q4'
    && F.previousPeriod('2026-01', 'month') === '2025-12' && F.nextPeriod('2026-12', 'month') === '2027-01' && F.nextPeriod('2026-Q4', 'quarter') === '2027-Q1');
  check('the reminder shows from a week before it’s due until it’s paid, and only when wanted', !F.remindNow('2026-11-12', oct, fm, false) && F.remindNow('2026-11-13', oct, fm, false) && F.remindNow('2026-11-25', oct, fm, false)
    && !F.remindNow('2026-11-14', oct, fm, true) && !F.remindNow('2026-11-14', oct, { ...fm, remind: false }, false));
  check('…saying what and when', F.reminderText('2026-11-14', oct, 39390) === 'October’s sales tax, $393.90, is due November 20' && F.reminderText('2026-11-21', oct, 39390) === 'October’s sales tax, $393.90, was due November 20'
    && F.reminderText('2026-11-14', oct, 0) === 'October’s sales tax return, with nothing to pay, is due November 20');

  console.log('the report, for filing');
  const places = [{ id: 'main', name: 'North Loft', address: '212 Market Street' }, { id: 'east', name: 'North Loft East', address: '40 Ridge Road' }];
  const d = (day: number) => `2026-10-${String(day).padStart(2, '0')}T15:00:00.000Z`;
  const txns = [
    { id: 's1', type: 'income', category: 'Service Revenue', taxBucket: 'revenue', amount: 900, date: d(3) },
    { id: 's2', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 300, date: d(3), locationId: 'main' },
    { id: 't2', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 24.75, date: d(3), taxRates: { productsPct: 8.25, servicesPct: 0 }, taxedAmount: 300, taxLocationId: 'main' },
    { id: 's3', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 100, date: d(9) },
    { id: 't3', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 6.25, date: d(9), taxRates: { productsPct: 6.25, servicesPct: 0 }, taxedAmount: 100, taxLocationId: 'east' },
    { id: 's4', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 50, date: d(12), retailOrderId: 'o1' },
    { id: 't4', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 4.12, date: d(12), retailOrderId: 'o1', taxMode: 'flat', taxLocationId: 'online', taxedAmount: 50 },
    { id: 's5', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 80, date: d(14) },
    { id: 't5', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 6.6, date: d(14), taxLocationId: 'main' },   // from before a line kept what it was on
    { id: 'w1', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 400, date: d(20), retailOrderId: 'o2', taxFree: true },
    { id: 'r1', type: 'expense', category: 'Refunds', taxBucket: 'refund', amount: 32.48, taxRefunded: 2.48, date: d(22), reversalOf: 's2' },
    { id: 'v3', type: 'reversal', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 1.25, reversalOf: 't3', date: d(10) },
    { id: 'a1', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 60, appKey: 'doordash', date: d(15) },
    // (9 pm on October 31 in New York is November 1 by the clock in London: October's. 10 pm on September 30 isn't.)
    { id: 'z1', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 60, date: '2026-11-01T01:00:00.000Z', locationId: 'main' },
    { id: 'z1t', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 5, date: '2026-11-01T01:00:00.000Z', taxRates: { productsPct: 8.25, servicesPct: 0 }, taxedAmount: 60, taxLocationId: 'main' },
    { id: 'z0', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 40, date: '2026-10-01T02:00:00.000Z', locationId: 'main' },
    { id: 'z0t', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 3, date: '2026-10-01T02:00:00.000Z', taxLocationId: 'main' },
    { id: 'g1', type: 'income', category: 'Gift Card Sales', taxBucket: 'transfer', amount: 100, date: d(22) },
    { id: 'x1', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 9, date: '2026-11-02T15:00:00.000Z', taxLocationId: 'main' },
  ];
  const setNY = { ...set, timezone: 'America/New_York' };
  const rep = R.salesTaxReport(txns, setNY, places, oct, { lookup: txns });
  const main = rep.places.find((p) => p.id === 'main'), east = rep.places.find((p) => p.id === 'east'), online = rep.places.find((p) => p.id === 'online');
  check('all sales are the period’s net sales, by the business’s own days (a refund comes off; gift cards sold and tax aren’t sales)', rep.allSales === 1920, rep);
  check('what was collected, given back on refunds and voids and to pay are the books’ own figures (nothing from another month)', rep.collected === 46.72 && rep.givenBack === 3.73 && rep.toPay === 42.99, rep);
  check('taxable sales add up what each tax line was worked out on, less refunds and voids; a line from before is worked out from its rate', rep.taxable === 539.94 && rep.estimated === true && main?.taxable === 409.94 && east?.taxable === 80, rep.places);
  check('sales to resellers and through apps that collect the tax are on their own lines; the rest that wasn’t taxed is the difference', rep.taxFree === 400 && rep.viaApps === 60 && rep.notTaxed === 920.06, rep);
  check('by location: each with its rate, its taxable sales and tax to pay after refunds, adding up to what’s owed; the online shop on its own line', main?.rate === '8.25%' && main?.tax === 33.87 && east?.rate === '6.25%' && east?.tax === 5
    && online?.name === 'Online shop' && online?.tax === 4.12 && rep.places.length === 3 && Math.round(rep.places.reduce((x, p) => x + p.tax, 0) * 100) === 4299, rep.places);
  const legacyLine = R.salesTaxReport([{ id: 'q1', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 7, description: 'Sales tax (7% — check your tax settings)', date: d(5) }], setNY, [places[0]], oct, {});
  check('a line from before is worked out at the rate it was charged, from its label', legacyLine.taxable === 100 && legacyLine.estimated, legacyLine);
  const offLine = R.salesTaxReport([{ id: 'p1', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 200, date: d(5), locationId: 'east' },
    { id: 'p1t', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 12.5, taxRates: { productsPct: 6.25, servicesPct: 0 }, taxedAmount: 200, taxLocationId: 'east', date: d(5) },
    { id: 'p2', type: 'expense', category: 'Refunds', taxBucket: 'refund', amount: 106.25, taxRefunded: 6.25, description: '50% back, Oil', reversalOf: 'p1', locationId: 'main', date: d(6) }], setNY, places, oct, {});
  const offEast = offLine.places.find((p) => p.id === 'east'), offMain = offLine.places.find((p) => p.id === 'main');
  check('a refund comes off where the sale was made, at that place’s rate (never a percentage in its own description)', offEast?.taxable === 100 && offEast?.tax === 6.25 && offMain?.taxable === 0 && offMain?.tax === 0, offLine.places);
  const one = R.salesTaxReport(txns.filter((t) => t.taxLocationId !== 'east' && t.id !== 'v3'), setNY, [places[0]], oct, { lookup: txns });
  check('with one location, its sales are under it', one.places[0].name === 'North Loft' && one.places[0].tax === 33.87, one.places);
  const html = RB.buildSalesTaxHtml(rep, { shopName: 'North Loft', paid: { at: '2026-11-18T15:00:00.000Z', cents: 3924 } });
  check('the printed report says what the return asks for, by location, and when it was paid', /What your return asks for/.test(html) && /Taxable sales/.test(html) && /North Loft East/.test(html) && /Recorded as paid November 18, 2026/.test(html) && /Due November 20/.test(html) && !/booth|salon/i.test(html));

  console.log('from the books, and paying it');
  const S = await import('../../src/lib/sales-tax-server');
  const tenant = { name: 'North Loft', timezone: 'America/Chicago', retailSettings: { taxRatePercent: 8.25 }, salesTax: { configured: true, filing: { every: 'month', dueDay: 20, remind: true } } };
  await db.doc('tenants/t1').set(tenant);
  for (const t of txns) await db.doc(`tenants/t1/transactions/${t.id}`).set(t);
  const at = Date.parse('2026-11-15T18:00:00Z');
  const v: any = await S.salesTaxView(db, 't1', tenant, undefined, at);
  check('the view is the last period that ended, from the books (a day either side read, kept to the business’s own days)', v.ok && v.report.period.key === '2026-10' && v.report.toPay === 42.99 && v.paid === null, v.report);
  const rem: any = await S.taxReminder(db, 't1', tenant, at);
  check('within a week of the day it’s due, the reminder says so with the amount', rem?.text === 'October’s sales tax, $42.99, is due November 20' && rem?.cents === 4299, rem);
  check('…not more than a week before, not when it isn’t wanted, and not before tax is set up', (await S.taxReminder(db, 't1', tenant, Date.parse('2026-11-05T18:00:00Z'))) === null
    && (await S.taxReminder(db, 't1', { ...tenant, salesTax: { ...tenant.salesTax, filing: { every: 'month', dueDay: 20, remind: false } } }, at)) === null
    && (await S.taxReminder(db, 't1', { name: 'x', salesTax: { configured: false, startsUnset: true } }, at)) === null);
  const st1: any = await S.taxStatus(db, 't1', tenant, at);
  check('the Money page’s one call: the reminder and what the last period still owes', st1.reminder?.cents === 4299 && st1.owed?.cents === 4299 && st1.owed?.label === 'October 2026' && st1.owed?.due === 'November 20', st1);
  await db.doc('tenants/t1/transactions/late1').set({ id: 'late1', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 10, date: '2026-10-20T15:00:00.000Z' });
  const st2: any = await S.taxStatus(db, 't1', tenant, at + 3600000);
  const st3: any = await S.taxStatus(db, 't1', tenant, at + 7 * 3600000);
  check('…its figure kept a few hours, so opening the page doesn’t read months of books each time, then worked out again', st2.owed?.cents === 4299 && st3.owed?.cents === 5299, [st2.owed, st3.owed]);
  await db.doc('tenants/t1/transactions/late1').set({ amount: 0 }, { merge: true });
  await db.doc('tenants/t1/private/salesTaxOwed_2026-10').set({ at: '2000-01-01T00:00:00.000Z' }, { merge: true });
  check('…nothing added up before tax is set up', JSON.stringify(await S.taxStatus(db, 't1', { name: 'x', salesTax: { configured: false, startsUnset: true } }, at)) === JSON.stringify({ reminder: null, owed: null, unset: true }));
  const early: any = await S.markTaxPaid(db, 't1', tenant, '2026-11', 100, 'Jo', at);
  check('a period that isn’t over can’t be recorded as paid', !early.ok && /isn’t over yet/.test(early.error));
  const paid: any = await S.markTaxPaid(db, 't1', tenant, '2026-10', 4299, 'Jo', at);
  const pl: any = await get('tenants/t1/transactions/salestax_2026-10');
  check('recording it paid puts the payment in the books as sales tax paid (it settles what was owed, never an expense)', paid.ok && pl?.category === 'Sales Tax Paid' && pl?.taxBucket === 'tax_remitted' && pl?.amount === 42.99
    && (await import('../../src/lib/books-summary')).effectOf(pl).side === 'taxpaid', pl);
  const again: any = await S.markTaxPaid(db, 't1', tenant, '2026-10', 5000, 'Jo', at);
  check('…once: recording it again changes nothing', again.ok && again.already && (await get('tenants/t1/transactions/salestax_2026-10'))?.amount === 42.99);
  const paidStatus: any = await S.taxStatus(db, 't1', tenant, at);
  check('…and the reminder stops, and nothing is owed or added up (it says the period is paid)', paidStatus.reminder === null && paidStatus.owed === null && paidStatus.last?.paid === true && paidStatus.last?.period === '2026-10' && (await S.taxReminder(db, 't1', tenant, at)) === null && (await S.salesTaxView(db, 't1', tenant, '2026-10', at) as any).paid?.cents === 4299);
  await db.doc('tenants/t1/transactions/salestax_2026-10').set({ reconciled: true, bankTransactionId: 'b1' }, { merge: true });
  const noUndo: any = await S.unmarkTaxPaid(db, 't1', '2026-10');
  check('a payment matched to the bank isn’t taken back here', !noUndo.ok && /matched to your bank/.test(noUndo.error));
  await db.doc('tenants/t1/transactions/salestax_2026-10').set({ reconciled: false, bankTransactionId: null }, { merge: true });
  const undo: any = await S.unmarkTaxPaid(db, 't1', '2026-10');
  check('one recorded by mistake is taken back, with its line', undo.ok && (await get('tenants/t1/transactions/salestax_2026-10')) === null && (await get('tenants/t1/private/salesTaxPaid_2026-10')) === null);

  // Nothing to pay: still a return due, filed with nothing in the books.
  const quiet = { ...tenant, name: 'Quiet' };
  await db.doc('tenants/t2').set(quiet);
  const qr: any = await S.taxReminder(db, 't2', quiet, at);
  check('with nothing to pay, the return is still due and the reminder says so', qr?.text === 'October’s sales tax return, with nothing to pay, is due November 20' && qr?.cents === 0, qr);
  const qf: any = await S.markTaxPaid(db, 't2', quiet, '2026-10', 0, 'Jo', at);
  check('…filed with nothing to pay: recorded, with nothing in the books, and the reminder stops', qf.ok && qf.paid.cents === 0 && (await get('tenants/t2/transactions/salestax_2026-10')) === null && (await S.taxReminder(db, 't2', quiet, at)) === null);
  check('a business that charges no sales tax at all isn’t reminded', (await S.taxReminder(db, 't3', { ...tenant, retailSettings: { taxRatePercent: 0 }, salesTax: { ...tenant.salesTax, servicesTaxed: false } }, at)) === null);

  console.log('setting it up');
  const steps = (t: any) => SG.guideSteps(t, { livePriced: 0, teamCount: 1 } as any);
  check('the setup guide has a sales tax step, done once the rates are saved', steps({}).some((s: any) => s.id === 'salestax' && !s.done) && steps({ salesTax: { configured: true } }).some((s: any) => s.id === 'salestax' && s.done)
    && SG.guideSteps({ business: { kind: 'food' }, businessType: 'restaurant' }, { livePriced: 0, teamCount: 1 } as any).some((s: any) => s.id === 'salestax'));
  const files = ['src/components/settings/SalesTaxCard.tsx', 'src/components/money/MoneyOverview.tsx'].map((f) => fs.readFileSync(f, 'utf8'));
  check('the Money page says when sales tax is due, under Needs you', /call\('status'\)/.test(files[1]) && /settings\?tab=payments#sales-tax/.test(files[1]));
  check('the new screens keep the house style', files.every((s) => !/\buppercase\b|font-black|\{\/\*| · |[Cc]all us|[Cc]ontact us|\b(salon|stylist|booth|chair|studio)\b/.test(s)));
  const hub = fs.readFileSync('src/components/pos/CheckoutHub.tsx', 'utf8');
  check('checkout says when sales tax isn’t set up, with the way to set it for a manager', /Sales tax isn’t set up yet/.test(hub) && /settings\?tab=payments#sales-tax/.test(hub));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
