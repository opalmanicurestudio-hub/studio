// Checks Records, a month at a time (round 35, design canvas "Food numbers": Records):
// - lib/records: months and their days, dollars and signatures as typed, when a month's cash tips are due, tips against
//   8% of sales, spreadsheet files that are safe to open
// - lib/records-server and api/records: each night (the kept close, or worked out again), sales tax, tips by person and
//   what each declared, the shelf's value now and as kept for a month (once on the 1st), purchases by supplier, comps
//   and voids by person; the files; managers only
// - cash tips declared: anyone on the team, for this month or last, signed, again keeping the earlier copy
// - the screens: Records, the staff portal's Cash tips, the sidebar, the nightly run
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/records.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb()); const audits: any[] = [];
let manager = true; let uid = 'm1'; let owner = true; let caps: string[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') { class StripeMock { paymentIntents = { create: async () => ({ id: 'pi_x' }) }; } return Object.assign(StripeMock, { default: StripeMock }); }
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { uid, name: uid === 'm1' ? 'Ana Ruiz' : 'Sam Ortiz', isManager: manager, isTenantOwner: owner, caps } }),
    requireCan: async () => ({ actor: { uid } }),
  });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_d: any, _t: string, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const near = (a: any, b: number, e = 0.005) => typeof a === 'number' && Math.abs(a - b) <= e;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const RL = await import('../../src/lib/records');

  console.log('months, money and signatures');
  check('a month as typed, or not', RL.cleanMonth('2026-10') === '2026-10' && RL.cleanMonth('2026-13') === null && RL.cleanMonth('Oct') === null);
  check('the month’s days, up to today in the month in progress; none for one to come', RL.monthDays('2026-02', '2026-11-16').length === 28 && RL.monthDays('2026-11', '2026-11-16').length === 16 && RL.monthDays('2026-12', '2026-11-16').length === 0);
  check('the month before, across a year; the last twelve, newest first', RL.prevMonth('2026-01') === '2025-12' && RL.recentMonths('2026-11-16').length === 12 && RL.recentMonths('2026-11-16')[0] === '2026-11' && RL.recentMonths('2026-11-16')[11] === '2025-12');
  check('in words', RL.monthWords('2026-10') === 'October 2026');
  check('dollars as typed, to the cent; nonsense isn’t', RL.cleanDollars('$1,212.50') === 121250 && RL.cleanDollars('') === 0 && RL.cleanDollars('12.345') === null && RL.cleanDollars('-5') === null && RL.cleanDollars('abc') === null);
  check('a signature is a name typed', RL.cleanSignature('  Sam   Ortiz ') === 'Sam Ortiz' && RL.cleanSignature('x') === null && RL.cleanSignature('1234') === null);
  check('cash tips are due by the 10th of the next month; this month and last can be declared', RL.declareBy('2026-10') === '2026-11-10' && RL.declareBy('2026-12') === '2027-01-10' && RL.declarable('2026-10', '2026-11-16') && RL.declarable('2026-11', '2026-11-16') && !RL.declarable('2026-09', '2026-11-16'));
  const tc = RL.tipCheck(10000, 600, 150);
  check('tips against sales: $750 on $10,000 is 7.5%, $50 short of 8%', near(tc.pct, 0.075) && tc.shortfall === 50 && tc.under && !RL.tipCheck(10000, 900, 0).under && RL.tipCheck(0, 5, 5).pct === null);
  const csv = RL.toCsv(['Name', 'Amount'], [['=HYPERLINK("x")', -5], ['Smith, "Jo"', 12.345], [null, 0]]);
  check('…a value led by a control character is kept as text too; numbers keep their precision', RL.toCsv(['a'], [['\r=1+1'], [0.0125]]).split('\r\n')[1] === `'  =1+1`.replace('  ', ' ') && RL.toCsv(['a'], [[0.0125]]).split('\r\n')[1] === '0.0125', RL.toCsv(['a'], [['\r=1+1']]));
  check('a month’s stock value can be kept from today’s shelf this month, and last month until the 10th', RL.keepable('2026-11', '2026-11-16') && RL.keepable('2026-10', '2026-11-10') && !RL.keepable('2026-10', '2026-11-11') && !RL.keepable('2026-09', '2026-11-02'));
  check('a spreadsheet that’s safe to open: a cell that looks like a formula stays text, numbers stay numbers, quotes and commas held', csv.split('\r\n')[1] === `"'=HYPERLINK(""x"")",-5` && csv.split('\r\n')[2] === '"Smith, ""Jo""",12.345' && csv.split('\r\n')[3] === ',0', csv);

  console.log('the month');
  const now = new Date(); const month = now.toISOString().slice(0, 7); const prev = RL.prevMonth(month);
  const dayOf = (n: number) => `${prev}-${String(n).padStart(2, '0')}`;
  const at = (d: string, h = 18) => `${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
  await db.doc(T).set({ name: 'North Loft', timezone: 'UTC', userId: 'm1', modules: { hospitality: true } });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', isActive: true });
  await db.doc(`${T}/staff/s1`).set({ name: 'Sam Ortiz', role: 'staff', isActive: true });
  await db.doc(`${T}/staff/s2`).set({ name: 'Lee Park', role: 'staff', isActive: true });
  // Night 3 closed and kept; night 5 sold but never closed.
  await db.doc(`${T}/nightCloses/${dayOf(3)}`).set({ day: dayOf(3), status: 'closed', closedAt: at(dayOf(3), 23), closedBy: 'Ana Ruiz', report: { sales: { total: 1000, taken: 1150, tax: 80, tips: 70, refunds: 0, count: 40 }, comps: { total: 24 }, voids: { total: 9 }, drawers: [{ overShort: -2.5 }] } });
  // Night 5's sale at the desk: a burger ($140 of it) and a bottle of shampoo ($60, not food or drink); night 3's food came
  // from the counter.
  await db.doc(`${T}/receipts/rc5`).set({ date: at(dayOf(5)), subtotal: 200, total: 236, tax: 16, tip: 20, paymentMethod: 'Card',
    detail: { lines: [{ kind: 'product', label: 'Burger', amount: 140 }, { kind: 'product', label: 'Shampoo', amount: 60 }] }, reversal: { products: [{ id: 'burger', name: 'Burger' }, { id: 'shampoo', name: 'Shampoo' }] } });
  await db.doc(`${T}/counterOrders/co3`).set({ paidAt: at(dayOf(3), 12), status: 'paid', subtotal: 1060, total: 1140, tax: 80, payMethod: 'card' });
  await db.doc(`${T}/counterOrders/co3s`).set({ paidAt: at(dayOf(3), 13), status: 'paid', subtotal: 14, total: 14, staffMeal: { for: 'Sam' } });
  // Tips: Sam took card and cash tips, Lee cash only.
  await db.doc(`${T}/transactions/t1`).set({ category: 'Tips', type: 'income', date: at(dayOf(3)), staffId: 's1', tipAmount: 60, paymentMethod: 'Card' });
  await db.doc(`${T}/transactions/t2`).set({ category: 'Tips', type: 'income', date: at(dayOf(3)), staffId: 's1', tipAmount: 30, paymentMethod: 'Cash' });
  await db.doc(`${T}/transactions/t3`).set({ category: 'Tips', type: 'income', date: at(dayOf(5)), staffId: 's2', tipAmount: 25, paymentMethod: 'Cash' });
  // Stock: 2 cases of patties and an open one, milk half a gallon, a menu dish (made from its recipe) and equipment.
  await db.doc(`${T}/inventory/patties`).set({ name: 'Beef patties', type: 'professional', costingMethod: 'uses', estimatedUses: 40, useUnit: 'each', costPerUnit: 40, totalStock: 2, partialContainerUses: 20, status: 'active' });
  await db.doc(`${T}/inventory/milk`).set({ name: 'Whole milk', type: 'professional', costingMethod: 'size', size: 3785, unit: 'ml', costPerUnit: 4, totalStock: 0, partialContainerSize: 1892.5, status: 'active', typicalCost: true });
  await db.doc(`${T}/inventory/burger`).set({ name: 'Burger', type: 'refreshment', price: 14, costPerUnit: 3, totalStock: 50, formula: [{ id: 'patties', quantityUsed: 1 }], status: 'active' });
  await db.doc(`${T}/inventory/grill`).set({ name: 'Grill', type: 'equipment', costPerUnit: 4000, totalStock: 1, status: 'active' });
  await db.doc(`${T}/inventory/gone`).set({ name: 'Old syrup', type: 'professional', costPerUnit: 9, totalStock: 4, status: 'archived', archived: true });
  // Orders received, one with its invoice; and comps and voids.
  await db.doc(`${T}/orders/o1`).set({ number: '0001', supplier: 'Metro Meats', receivedAt: at(dayOf(4), 9), invoiceUrl: 'https://x/inv.pdf', items: [{ productId: 'patties', quantity: 2, receivedQuantity: 2, costPerUnit: 40 }] });
  await db.doc(`${T}/orders/o2`).set({ number: '0002', supplier: '=Dairy Co', receivedAt: at(dayOf(6), 9), items: [{ productId: 'milk', quantity: 3, receivedQuantity: 2, costPerUnit: 4.25 }, { productId: 'x', quantity: 1, receivedQuantity: 0, costPerUnit: 9 }] });
  await db.doc(`${T}/orders/o3`).set({ number: '0003', supplier: 'Metro Meats', receivedAt: at(`${month}-01`, 9), items: [{ productId: 'patties', quantity: 1, receivedQuantity: 1, costPerUnit: 41 }] });
  await db.doc(`${T}/approvals/a1`).set({ day: dayOf(3), kind: 'comp', used: true, amount: 18, askedBy: 'Dev Shah' });
  await db.doc(`${T}/approvals/a2`).set({ day: dayOf(3), kind: 'comp', used: true, amount: 6, askedBy: 'Dev Shah' });
  await db.doc(`${T}/approvals/a3`).set({ day: dayOf(5), kind: 'void_item', used: true, amount: 9, askedBy: 'Sam Ortiz' });
  await db.doc(`${T}/approvals/a4`).set({ day: dayOf(5), kind: 'comp', used: false, amount: 50, askedBy: 'Sam Ortiz' });

  const { POST } = await import('../../src/app/api/records/route');
  const R = (b: any) => POST(req({ tenantId: 't1', ...b }));
  manager = false; uid = 's1';
  check('the month’s records are a manager’s', (await R({ action: 'month', month: prev })).status === 403 && (await R({ action: 'csv', month: prev, kind: 'tips' })).status === 403); manager = true; uid = 'm1';
  let r: any = await R({ action: 'month', month: prev });
  const b = r.body;
  check('every day of last month; night 3 as it was closed and kept, night 5 worked out again from its sale', b.ok && b.days === RL.monthDays(prev, '9999-12-31').length && b.nights.find((n: any) => n.day === dayOf(3)).sales === 1000 && b.nights.find((n: any) => n.day === dayOf(3)).closed
    && b.nights.find((n: any) => n.day === dayOf(5)).sales === 200 && b.nights.find((n: any) => n.day === dayOf(5)).tax === 16 && !b.nights.find((n: any) => n.day === dayOf(5)).closed, b.nights?.filter((n: any) => n.count));
  check('…one night closed, and the one with sales that wasn’t is said', b.closes.closed === 1 && JSON.stringify(b.closes.open) === JSON.stringify([dayOf(5)]), b.closes);
  check('sales $1,200 and sales tax $96 for the month', b.sales.total === 1200 && b.sales.tax === 96, b.sales);
  const sam = b.tips.people.find((p: any) => p.staffId === 's1'); const lee = b.tips.people.find((p: any) => p.staffId === 's2');
  check('tips by person: Sam $60 on cards and $30 cash, Lee $25 cash; nobody has declared yet', near(sam?.chargedCents, 6000) && near(sam?.cashCents, 3000) && near(lee?.cashCents, 2500) && !sam.declared && !lee.declared && b.tips.people.every((p: any) => p.due), b.tips.people);
  check('tips against food and drink sales ($1,060 at the counter and the $140 burger, not the shampoo or a staff meal): $60 on cards is 5%, $36 short of 8% (cash counts once it’s declared)', b.tips.check.sales === 1200 && near(b.tips.check.pct, 0.05) && b.tips.check.shortfall === 36 && b.tips.check.under, b.tips.check);
  const cache = (await db.collection(`${T}/recordsNights`).get()).docs.map((d: any) => d.id);
  check('only the night with sales that wasn’t closed is worked out again, and kept for the next look', JSON.stringify(cache) === JSON.stringify([dayOf(5)]), cache);
  await db.doc(`${T}/recordsNights/${dayOf(5)}`).set({ row: { ...(await get(`${T}/recordsNights/${dayOf(5)}`)).row, sales: 201 } }, { merge: true });
  check('…opened again, the kept one is used', (await R({ action: 'month', month: prev })).body.nights.find((n: any) => n.day === dayOf(5)).sales === 201);
  await db.doc(`${T}/recordsNights/${dayOf(5)}`).delete();
  // Patties: 2 cases and 20 of 40 at $40 a case is $100; milk: half a gallon at $4 is $2 (at a typical price).
  check('what’s on the shelf at what you pay: patties and milk, not the dish made from its recipe, the grill or what’s put away', b.stock.now === 102 && b.stock.nowTypical === 2 && b.stock.lines === 2 && b.stock.kept === null, b.stock);
  check('purchases: 2 deliveries from 2 suppliers in the month (the 1st of this one is next month’s), what came of each', b.purchases.list.length === 2 && b.purchases.total === 88.5 && b.purchases.bySupplier[0].supplier === 'Metro Meats' && b.purchases.bySupplier.find((x: any) => x.supplier === '=Dairy Co').total === 8.5 && b.purchases.list.filter((p: any) => p.invoice).length === 1, b.purchases);
  check('comps and voids by who asked: Dev $24 comped, Sam $9 voided (an approval never used isn’t counted)', b.adjustments[0].name === 'Dev Shah' && b.adjustments[0].comps === 24 && b.adjustments[0].compCount === 2 && b.adjustments.find((a: any) => a.name === 'Sam Ortiz').voids === 9 && b.adjustments.find((a: any) => a.name === 'Sam Ortiz').comps === 0, b.adjustments);
  check('a month still to come is said', (await R({ action: 'month', month: '2099-01' })).status === 400);

  console.log('the files');
  r = await R({ action: 'csv', month: prev, kind: 'nights' });
  check('nightly closes, a row a day', r.body.ok && r.body.name === `north-loft-nightly-closes-${prev}.csv` && r.body.csv.startsWith('Day,Closed,Closed by,Sales,Sales tax') && r.body.csv.includes(`${dayOf(3)},Yes,Ana Ruiz,1000,80,70,1150,0,24,9,-2.5`) && r.body.csv.includes(`${dayOf(5)},No,,200,16,20`), r.body.csv?.split('\r\n').slice(0, 6));
  r = await R({ action: 'csv', month: prev, kind: 'purchases' });
  check('orders received, a supplier named like a formula kept as text', r.body.ok && r.body.name.includes('orders-received') && r.body.csv.includes(`'=Dairy Co`) && r.body.csv.includes('Metro Meats,0001,1,80,Yes'), r.body.csv);
  r = await R({ action: 'csv', month: prev, kind: 'stock' });
  check('the shelf, item by item, as of when', r.body.ok && r.body.csv.startsWith('As of,Item') && r.body.csv.includes('(now),Beef patties,100,each,1,100,') && r.body.csv.includes('Whole milk'), r.body.csv);
  r = await R({ action: 'csv', month: prev, kind: 'adjustments' });
  check('comps and voids', r.body.ok && r.body.csv.includes('Dev Shah,2,24,0,0,0'), r.body.csv);
  check('a record that isn’t one', (await R({ action: 'csv', month: prev, kind: 'secrets' })).status === 400);

  console.log('cash tips declared');
  manager = false; uid = 's1';
  r = await R({ action: 'mine' });
  const mPrev = r.body.months?.find((m: any) => m.month === prev);
  check('Sam sees this month and last, with the cash the till has of his, due by the 10th', r.body.ok && r.body.name === 'Sam Ortiz' && r.body.months.length === 2 && mPrev.recordedCashCents === 3000 && mPrev.took === true && mPrev.by === RL.declareBy(prev) && mPrev.declared === null, r.body);
  r = await R({ action: 'declare', month: RL.prevMonth(prev), cash: '40', signedName: 'Sam Ortiz' });
  check('a month too long ago is a manager’s to sort out', r.status === 400 && /Ask a manager/.test(r.body.error));
  r = await R({ action: 'declare', month: prev, cash: 'lots', signedName: 'Sam Ortiz' });
  check('…an amount in dollars', r.status === 400 && /dollars/.test(r.body.error));
  r = await R({ action: 'declare', month: prev, cash: '42.50', signedName: ' ' });
  check('…signed with a name', r.status === 400 && /sign/.test(r.body.error));
  r = await R({ action: 'declare', month: prev, cash: '42.50', paidOut: '5', signedName: 'Sam Ortiz' });
  const d1: any = await get(`${T}/tipDeclarations/s1_${prev}`);
  check('declared: $42.50 (more than the till saw: cash handed to him counts), $5 paid out, signed, with what the till had', r.body.ok && d1.cashCents === 4250 && d1.paidOutCents === 500 && d1.recordedCashCents === 3000 && d1.signedName === 'Sam Ortiz' && d1.name === 'Sam Ortiz' && d1.staffId === 's1' && Array.isArray(d1.earlier) && d1.earlier.length === 0, d1);
  r = await R({ action: 'declare', month: prev, cash: '45', signedName: 'Sam Ortiz' });
  const d2: any = await get(`${T}/tipDeclarations/s1_${prev}`);
  check('…changed: the new one stands, the earlier copy kept with it, on the audit trail', r.body.ok && d2.cashCents === 4500 && d2.earlier.length === 1 && d2.earlier[0].cashCents === 4250 && audits.some((a) => a.action === 'records.tips_declared' && /\$45\.00 .*changed from \$42\.50/.test(a.summary)), d2);
  uid = 'nobody';
  check('someone not on the team can’t declare', (await R({ action: 'declare', month: prev, cash: '1', signedName: 'X Y' })).status === 403);
  manager = true; uid = 'm1';
  r = await R({ action: 'month', month: prev });
  check('…shown as changed', r.body.tips.people.find((p: any) => p.staffId === 's1').declared.changed === true);
  check('on Records: Sam declared $45, Lee not yet; tips against sales now counts his cash: $105 is 8.75%, nothing short', r.body.tips.people.find((p: any) => p.staffId === 's1').declared.cashCents === 4500 && !r.body.tips.people.find((p: any) => p.staffId === 's2').declared && r.body.tips.people[0].staffId === 's2'
    && near(r.body.tips.check.pct, 0.0875) && !r.body.tips.check.under, r.body.tips);
  r = await R({ action: 'csv', month: prev, kind: 'declared' });
  check('the signed copies as a file', r.body.ok && r.body.csv.includes(`Sam Ortiz,${prev},45,0,30,Sam Ortiz`), r.body.csv);

  console.log('the reports');
  const KIT = await import('../../src/lib/report-kit');
  check('a cell as the page shows it: money to the cent with a real minus, a day and a month in words, counts whole', KIT.cellText({ label: 'x', kind: 'money' }, -12.5) === '−$12.50' && KIT.cellText({ label: 'x', kind: 'money' }, 1234) === '$1,234.00'
    && KIT.cellText({ label: 'x', kind: 'date' }, '2026-10-03') === 'Oct 3' && KIT.cellText({ label: 'x', kind: 'month' }, '2026-10') === 'October 2026' && KIT.cellText({ label: 'x', kind: 'count' }, 1234.4) === '1,234' && KIT.cellText({ label: 'x', kind: 'date' }, 'Not yet') === 'Not yet' && KIT.cellText({ label: 'x', kind: 'money' }, '') === '');
  check('a big number reads whole, a small one to the cent; a change in words', KIT.kpiDollars(55472.4) === '$55,472' && KIT.kpiDollars(412.5) === '$412.50' && KIT.changeWords(106, 100, 'September')?.text === 'Up 6% on September.' && KIT.changeWords(97, 100, 'September')?.text === 'Down 3% on September.' && KIT.changeWords(100.4, 100, 'September')?.text === 'About the same as September.' && KIT.changeWords(5, 0, 'September') === null);
  check('the totals row adds the columns marked, to the cent; the spreadsheet has no totals row', JSON.stringify(KIT.totalsOf([{ label: 'A', kind: 'text' }, { label: 'B', kind: 'money', total: true }, { label: 'C', kind: 'text' }], [['x', 0.1, 'a'], ['y', 0.2, 'b']], 'All')) === JSON.stringify(['All', 0.3, null])
    && KIT.reportCsv({ columns: [{ label: 'A', kind: 'text' }, { label: 'B', kind: 'money' }], rows: [['x', 1.5]] }) === 'A,B\r\nx,1.5\r\n');
  const report = async (kind: string) => { const x = await R({ action: 'report', month: prev, kind }); const c = await R({ action: 'csv', month: prev, kind }); return { rep: x.body.report, ok: x.body.ok && c.body.ok, csv: c.body.csv as string, today: x.body.today }; };
  let rp = await report('nights');
  const tax = rp.rep?.kpis.find((k: any) => k.label === 'Sales tax collected');
  check('nightly closes as a report: what it is; sales $1,200, the best night $1,000, $96 of tax', rp.ok && /Your accountant uses it/.test(rp.rep.what) && rp.rep.kpis[0].value === '$1,200' && rp.rep.kpis.find((k: any) => k.label === 'Best night').value === '$1,000' && tax.value === '$96.00' && rp.today, rp.rep?.kpis);
  check('…worth a look: the night with sales that wasn’t closed, with where to close it', rp.rep.notes[0].tone === 'warn' && rp.rep.notes[0].text.includes(KIT.dayWords(dayOf(5))) && /wasn’t closed/.test(rp.rep.notes[0].text) && rp.rep.notes[0].href === '/close', rp.rep.notes);
  check('…the picture: a bar a day, that night amber and named in the legend, the average marked', rp.rep.chart.bars.length === RL.monthDays(prev, rp.today).length && rp.rep.chart.bars[4].tone === 'warn' && rp.rep.chart.bars[2].value === 1000 && rp.rep.chart.legend.some((l: any) => l.label === 'Not closed') && rp.rep.chart.avg.value === 600, rp.rep.chart.avg);
  check('…the table: a row a day with the month’s totals; the spreadsheet is the same table, the same columns', rp.rep.rows.length === rp.rep.chart.bars.length && rp.rep.totals[3] === 1200 && rp.rep.totals[4] === 96 && rp.csv === KIT.reportCsv(rp.rep) && rp.csv.split('\r\n')[0] === rp.rep.columns.map((c: any) => c.label).join(',') && rp.rep.file === `north-loft-nightly-closes-${prev}.csv`);
  check('…and how to read it', rp.rep.glossary.length >= 3 && rp.rep.glossary.some(([t]: any) => t === 'Drawers'));
  check('…the month’s sales kept by day once it’s over (for next month’s comparison); the spreadsheet alone reads nothing more', JSON.stringify((await get(`${T}/recordsNights/${prev}`))?.byDay?.slice(0, 5)) === JSON.stringify([0, 0, 1000, 0, 200]));
  await db.doc(`${T}/recordsNights/${RL.prevMonth(prev)}`).delete();
  await R({ action: 'csv', month: prev, kind: 'nights' }); await R({ action: 'csv', month: prev, kind: 'adjustments' });
  check('…a spreadsheet works out no comparison', !(await get(`${T}/recordsNights/${RL.prevMonth(prev)}`)));
  const cur = (await R({ action: 'report', month, kind: 'nights' })).body.report; const nDays = RL.monthDays(month, rp.today).length;
  check('this month so far is set against the same days of last month (the days already done), never the whole of it', nDays < 6 || new RegExp(`on the first ${nDays - 1} days of ${RL.monthWords(prev).split(' ')[0]}`).test(cur.kpis[0].note), cur.kpis[0].note);
  rp = await report('declared');
  check('the average night is over the nights with sales', (await R({ action: 'report', month: prev, kind: 'nights' })).body.report.kpis[1].value === '$600.00');
  check('cash tips declared: Sam signed, Lee not yet ($25 in cash), 1 of 2 declared', rp.ok && rp.rep.kpis[0].value === '1 of 2' && rp.rep.rows.some((r: any) => r[0] === 'Lee Park' && r[6] === 'Not yet' && r[4] === 25) && rp.rep.notes.some((n: any) => /Lee Park hasn’t declared/.test(n.text)) && rp.csv.includes('Lee Park') && rp.rep.columns[1].kind === 'month', rp.rep?.rows);
  rp = await report('tips');
  check('tips by person: what they came to, on cards, against food and drink sales (8.75%, over 8%)', rp.ok && rp.rep.kpis[0].value === '$115.00' && rp.rep.kpis.find((k: any) => /Against/.test(k.label)).value === '8.8%' && rp.rep.kpis.find((k: any) => /Against/.test(k.label)).tone === 'ok' && rp.rep.rows.length === 2, rp.rep?.kpis);
  rp = await report('stock');
  check('what one costs reads to the fraction of a cent', KIT.cellText({ label: 'x', kind: 'price' }, 0.0125) === '$0.0125' && KIT.cellText({ label: 'x', kind: 'price' }, 4) === '$4.00');
  check('stock value: $102 on the shelf now (nothing kept for that month, said), the value by item', rp.ok && rp.rep.kpis[0].value === '$102.00' && rp.rep.kpis[0].tone === 'warn' && rp.rep.notes.some((n: any) => /No stock value was kept/.test(n.text)) && rp.rep.totals[5] === 102, rp.rep?.kpis);
  rp = await report('purchases');
  check('purchases: $88.50 on 2 orders from 2 suppliers, with whether each invoice is attached', rp.ok && rp.rep.kpis[0].value === '$88.50' && rp.rep.kpis[1].value === '2' && /of 2/.test(rp.rep.kpis[2].value) && rp.rep.chart?.bars.length === 2, rp.rep?.kpis);
  rp = await report('adjustments');
  check('comps and voids: $24 comped, $9 voided, 2.8% of sales, Dev the most', rp.ok && rp.rep.kpis[0].value === '$24.00' && rp.rep.kpis[1].value === '$9.00' && rp.rep.kpis[2].value === '2.8%' && rp.rep.kpis[3].value === 'Dev' && rp.rep.columns[2].label === 'Comped (dollars)', rp.rep?.kpis);
  check('a report that isn’t one, or a month to come, is said; reports are a manager’s', (await R({ action: 'report', month: prev, kind: 'secrets' })).status === 400 && (await R({ action: 'report', month: '2099-01', kind: 'nights' })).status === 400
    && await (async () => { manager = false; const x = (await R({ action: 'report', month: prev, kind: 'nights' })).status === 403; manager = true; return x; })());

  console.log('the profit and loss');
  const pp = RL.prevMonth(prev); const money = (id: string, x: any) => db.doc(`${T}/transactions/${id}`).set({ id, ...x });
  await money('pp1', { type: 'income', category: 'Services', amount: 100, date: `${pp}-03T15:00:00.000Z` });
  await money('pp2', { type: 'income', category: 'Services', amount: 900, date: `${pp}-10T15:00:00.000Z` });
  await money('pp3', { type: 'expense', category: 'Rent', amount: 400, date: `${pp}-01T15:00:00.000Z` });
  await money('t1', { type: 'income', category: 'Services', amount: 1000, date: `${prev}-05T15:00:00.000Z` });
  await money('t2', { type: 'income', category: 'Retail', amount: 200, date: `${prev}-06T15:00:00.000Z` });
  await money('t3', { type: 'income', category: 'Tax Collected', amount: 80, date: `${prev}-06T15:00:00.000Z` });
  await money('t4', { type: 'expense', category: 'Rent', amount: 600, date: `${prev}-01T15:00:00.000Z` });
  await money('t5', { type: 'expense', category: 'Supplies', amount: 150, date: `${prev}-08T15:00:00.000Z` });
  await money('t6', { type: 'expense', category: 'Processing Fee', amount: 30, date: `${prev}-09T15:00:00.000Z` });
  await money('t7', { type: 'reversal', reversalOf: 'pp1', category: 'Refunds', amount: 100, taxRefunded: 8, date: `${prev}-11T15:00:00.000Z` });
  await money('t8', { type: 'expense', category: 'Rent', amount: 50, context: 'Personal', date: `${prev}-12T15:00:00.000Z` });
  await money('t9', { type: 'expense', category: 'Distribution', amount: 300, date: `${prev}-13T15:00:00.000Z` });
  await money('t10', { type: 'income', category: 'Services', amount: 50, date: `${prev}-12` });
  r = await R({ action: 'report', month: prev, kind: 'pnl' }); const pl = r.body.report; const kv = (l: string) => pl?.kpis.find((k: any) => k.label === l);
  const lastWord = RL.monthWords(pp).split(' ')[0];
  check('the profit and loss: net sales (a refund of last month’s sale comes off, its tax off the tax owed), gross profit, expenses, what’s left, the tax to pay', r.body.ok && kv('Net sales')?.value === '$1,158' && /^Up 16% on /.test(kv('Net sales')?.note || '')
    && kv('Gross profit')?.value === '$1,008' && kv('Expenses')?.value === '$630.00' && /Rent, \$600\.00/.test(kv('Expenses')?.note || '') && kv('Net profit')?.value === '$378.00' && kv('Net profit')?.tone === 'ok' && kv('Sales tax to pay')?.value === '$72.00', pl?.kpis);
  const rowOf = (name: string) => pl.rows.find((x: any) => x[0] === name);
  check('…the statement, line by line, against last month: a day kept as a date counts, a Personal line doesn’t, draws aren’t an expense', JSON.stringify(rowOf('Services')) === JSON.stringify(['Services', 'Income', 1050, 1000, 50])
    && JSON.stringify(rowOf('Rent')) === JSON.stringify(['Rent', 'Expenses', 600, 400, 200]) && JSON.stringify(rowOf('Net profit')) === JSON.stringify(['Net profit', 'Profit', 378, 600, -222])
    && rowOf('Less refunds and returns')?.[2] === -92 && rowOf('Owner draws and transfers')?.[2] === 300 && rowOf('Sales tax to pay the state')?.[2] === 72 && pl.columns[3].label === lastWord && pl.totals === null
    && pl.strong.map((i: number) => pl.rows[i][0]).join('|') === 'Sales|Net sales|Total income|Gross profit|Total expenses|Net profit' && pl.rowsShown >= pl.rows.length, pl?.rows);
  check('…worth a look: an expense that jumped, and the Personal line left out', pl.notes.some((n: any) => n.text === `Rent was $600.00, up $200.00 on ${lastWord}.`) && pl.notes.some((n: any) => /1 line marked Personal is left out/.test(n.text)), pl.notes);
  r = await R({ action: 'csv', month: prev, kind: 'pnl' });
  check('…its spreadsheet is the statement', r.body.ok && r.body.csv.startsWith(`Line,Part,${RL.monthWords(prev).split(' ')[0]},${lastWord},Change`) && /\r\nServices,Income,1050,1000,50\r\n/.test(r.body.csv) && /-profit-and-loss-\d{4}-\d{2}\.csv$/.test(r.body.name), r.body);
  owner = false;
  check('…only for those whose role shows the business’s numbers', (await R({ action: 'report', month: prev, kind: 'pnl' })).status === 403 && (await R({ action: 'csv', month: prev, kind: 'pnl' })).status === 403
    && (await R({ action: 'month', month: prev })).body.seesMoney === false && await (async () => { caps = ['money.view']; const ok = (await R({ action: 'report', month: prev, kind: 'pnl' })).body.ok; caps = []; return ok; })());
  owner = true;
  const RSV = await import('../../src/lib/records-server'); const NC = await import('../../src/lib/night-close-server');
  const ny = { timezone: 'America/New_York' }; const nov = RSV.monthBounds(ny, RL.monthDays('2026-11', '2026-12-15'))!;
  const inNov = (v: string) => { const t = RSV.lineTime(v, ny); return t >= Date.parse(nov.start) && t < Date.parse(nov.end); };
  check('…a line typed as a day (or a time with no zone) is that business day wherever the business is: the 1st starts the month, the 1st of the next doesn’t', inNov('2026-11-01') && inNov('2026-11-30') && !inNov('2026-12-01') && !inNov('2026-10-31')
    && inNov('2026-11-01T09:00:00') && NC.tonight(ny, new Date(RSV.lineTime('2026-11-01', ny))) === '2026-11-01' && RSV.lineTime('2026-11-01T02:00:00.000Z', ny) === Date.parse('2026-11-01T02:00:00.000Z'), nov);

  console.log('the shelf’s value, kept');
  r = await R({ action: 'keepStock', month });
  const kept: any = await get(`${T}/stockValues/${month}`);
  check('a manager keeps today’s as this month’s value, item by item', r.body.ok && r.body.total === 102 && kept.total === 102 && kept.by === 'Ana Ruiz' && kept.auto === false && kept.lines.length === 2 && kept.count === 2);
  await db.doc(`${T}/inventory/patties`).set({ totalStock: 3 }, { merge: true });
  r = await R({ action: 'keepStock', month });
  const kept2: any = await get(`${T}/stockValues/${month}`);
  check('…kept again after a recount: the new value stands, the one it replaced kept with it', kept2.total === 142 && kept2.earlier.length === 1 && kept2.earlier[0].total === 102, kept2);
  const lastOk = RL.keepable(prev, (await import('../../src/lib/night-close-server')).tonight({ timezone: 'UTC' }));
  r = await R({ action: 'keepStock', month: prev });
  check(lastOk ? 'last month’s can still be kept until the 10th' : 'past the 10th, last month’s can’t be kept from today’s shelf: said why', lastOk ? r.body.ok : r.status === 409 && /too late/.test(r.body.error), r.body);
  check('…and a month long gone never', (await R({ action: 'keepStock', month: RL.prevMonth(prev) })).status === 409);
  const RS = await import('../../src/lib/records-server');
  await db.doc(`${T}/inventory/patties`).set({ totalStock: 5 }, { merge: true });
  const auto = await RS.keepStockValue(db, 't1', month, 'Kept automatically', true);
  check('the automatic one never replaces one a manager kept', auto.kept === false && (await get(`${T}/stockValues/${month}`)).total === 142);
  r = await R({ action: 'month', month });
  check('…and Records shows it as kept, by whom', r.body.stock.kept.total === 142 && r.body.stock.kept.by === 'Ana Ruiz' && r.body.stock.now === 222 && r.body.stock.keepable === true, r.body.stock);
  r = await R({ action: 'csv', month, kind: 'stock' });
  check('…the file says as of when it was kept', r.body.csv.split('\r\n')[1].startsWith(kept2.at.slice(0, 10)), r.body.csv.split('\r\n')[1]);
  check('the nightly run keeps last month’s only on the business’s first days of a month', /stockSnapshotSweep/.test(src('src/app/api/cron/nightly/route.ts')) && /> 3\) return false/.test(src('src/lib/records-server.ts')));

  console.log('the screens');
  const view = src('src/components/reports/ReportView.tsx'); const rpage = src('src/app/(app)/records/[kind]/page.tsx'); const recs = src('src/app/(app)/records/page.tsx');
  check('every record opens as a report from Records, beside its spreadsheet', /href=\{`\/records\/\$\{kind\}\?month=/.test(recs) && />CSV</.test(recs.replace(/\{busy === kind \? 'Getting it…' : 'CSV'\}/, '>CSV<')) && /action: 'report'/.test(rpage) && /action: 'csv'/.test(rpage));
  check('…the report: what it is, the numbers, a picture, worth a look, in detail, how to read it; printed whole with the business and page numbers at the foot', /What this is:/.test(view) && /aria-label="The numbers that matter"/.test(view) && /<BarChart chart=/.test(view) && />Worth a look</.test(view) && />In detail</.test(view) && /How to read it/.test(view)
    && /Print or save as PDF/.test(view) && /Download spreadsheet \(CSV\)/.test(view) && /counter\(pages\)/.test(view) && /so no name can end the style/.test(view) && /\.replace\(\/\[\^\\p\{L\}\\p\{N\} \.,'&\(\)-\]\/gu, ''\)/.test(view) && /hidden print:table-row/.test(view) && /print:overflow-visible/.test(view));
  check('…the chart: thin bars rounded at the top, a hairline grid, a value on hover, every number in the table', /Math\.min\(24/.test(view) && /onMouseEnter=\{\(\) => setHover\(i\)\}/.test(view) && /Every value is in the table below/.test(view) && /ResizeObserver/.test(view));
  check('…in the app’s own words and look', !/uppercase|font-black|\{\/\*| · /.test(view + rpage) && !/[\u{1F300}-\u{1FAFF}]/u.test(view + rpage) && /min-h-\[44px\]/.test(view) && /bg-\[#fff\]/.test(view));
  const files = ['src/app/(app)/records/page.tsx', 'src/components/visit/DeclareTips.tsx'];
  const bad = files.filter((f) => /\{\/\*/.test(src(f)) || /\buppercase\b/.test(src(f)) || /font-black/.test(src(f)) || / · /.test(src(f)) || /contact us|call us/i.test(src(f)));
  check('no JSX comments, capitals, heavy type or dots between words', bad.length === 0, bad);
  const lowTap = files.filter((f) => /min-h-\[(3\d|[12]\d)px\]|h-(8|9|10) w-(8|9|10)\b/.test(src(f)));
  check('every control is a 44px target', lowTap.length === 0, lowTap);
  const pg = src('src/app/(app)/records/page.tsx');
  check('Records: money, people and stock; what’s left to finish; each record downloaded or opened', /To finish for/.test(pg) && /Cash tips declared/.test(pg) && /Tips against sales/.test(pg) && /Orders received, by supplier/.test(pg) && /action: 'csv'/.test(pg) && /openBtn\('\/money'\)/.test(pg) && /dlBtn\('pnl'\)/.test(pg) && /r\.seesMoney === false/.test(pg));
  check('in the sidebar with Money; the staff portal’s pay tab has Cash tips', /href: '\/records'/.test(src('src/components/shared/AppSidebar.tsx')) && /<DeclareTips/.test(src('src/app/staff-portal/[tenantId]/StaffPortalPage.tsx')));
  check('never a tax number on a declaration', !/\bssn\b|social security|\btaxId\b/i.test(src('src/app/api/records/route.ts')) && !/\bssn\b|social security/i.test(src('src/components/visit/DeclareTips.tsx')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
