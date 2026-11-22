// Checks ordering (L20 round 14, design canvas "Ordering"): lib/ordering (what to order of each thing, by supplier, from
// what went over the last two weeks, what's on the shelf and on its way, a set amount to keep, the supplier's minimum;
// a delivery's lines), api/ordering (the plan; an order placed as Inventory's own purchase orders and booked the same
// way; one-tap receiving, receiving with changes, the rest still to come; cancelling; who it's from, a set amount, how
// many days), and the screens.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ordering.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { ...actor, isManager: manager } }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

const MILK = { name: 'Whole milk', type: 'professional', costingMethod: 'size', size: 3785, unit: 'ml', costPerUnit: 4.5, totalStock: 1, partialContainerSize: 1000, container: '1 gallon', supplier: 'Northside Dairy', batches: [] };
const AVO = { name: 'Avocados', type: 'professional', costPerUnit: 30, totalStock: 1, container: 'case of 24', supplier: 'Valley Produce', leadTimeDays: 1, batches: [] };
const LEMON = { name: 'Lemons', type: 'professional', costPerUnit: 6, totalStock: 0, container: 'bag', supplier: 'valley produce ', parLevel: 2, batches: [] };
const CUPS = { name: 'Paper cups, 12 oz', type: 'professional', costPerUnit: 40, totalStock: 2, container: 'case of 1000', moq: 3, supplier: 'Cup Co', batches: [] };
const BEANS = { name: 'Espresso beans', type: 'professional', costingMethod: 'size', size: 2268, unit: 'g', costPerUnit: 38, totalStock: 2, partialContainerSize: 0, container: '5 lb bag', supplier: '', typicalCost: true, batches: [] };
const BREAD = { name: 'Sourdough', type: 'professional', costingMethod: 'uses', estimatedUses: 16, useUnit: 'slices', costPerUnit: 6, totalStock: 0, countStock: false, typicalCost: true, container: 'loaf, 16 slices', batches: [] };
const LATTE = { name: 'Latte', type: 'refreshment', price: 5, formula: [{ id: 'milk', quantityUsed: 240 }] };
const SODA = { name: 'Sparkling water', type: 'refreshment', price: 2.5, costPerUnit: 0.6, totalStock: 30, stockReserved: 0, container: 'case of 24', supplier: 'Valley Produce', batches: [] };
const DRYER = { name: 'Dryer', type: 'equipment', supplier: 'Valley Produce' };
async function seed() {
  await db.doc(T).set({ id: 't1', name: 'Linden Café' });
  for (const [id, x] of Object.entries({ milk: MILK, avo: AVO, lemon: LEMON, cups: CUPS, beans: BEANS, bread: BREAD, latte: LATTE, soda: SODA, dryer: DRYER })) await db.doc(`${T}/inventory/${id}`).set({ id, ...x });
  // Two weeks: milk 3,785 ml a week (about 540 ml a day), avocados 28 a... counted by the case: 7 cases in 14 days.
  const mv = (id: string, productId: string, type: string, change: number, date: string) => db.doc(`${T}/stockCorrections/${id}`).set({ productId, type, change, date });
  await mv('m1', 'milk', 'used', -3785, ago(13)); await mv('m2', 'milk', 'used', -3785, ago(6)); await mv('m3', 'milk', 'received', 7570, ago(5)); await mv('m4', 'milk', 'counted', -200, ago(2));
  await mv('a1', 'avo', 'used', -4, ago(12)); await mv('a2', 'avo', 'spoiled', -1, ago(8)); await mv('a3', 'avo', 'used', -2, ago(3));
  await mv('s1', 'soda', 'sold', -14, ago(10)); await mv('s2', 'soda', 'returned', 2, ago(4));
  await mv('b1', 'beans', 'used', -2268, ago(7)); await mv('old', 'avo', 'used', -500, ago(40));
}

(async () => {
  const O = await import('../../src/lib/ordering');
  console.log('what to order of one thing');
  check('how many days an order lasts: 7 unless the business set 1 to 30', O.coverDaysOf({}) === 7 && O.coverDaysOf({ ordering: { coverDays: 10 } }) === 10 && O.coverDaysOf({ ordering: { coverDays: 90 } }) === 7);
  check('what’s ordered: counted things, not equipment, a menu item made from a recipe, something put away or a product counted by its variants', O.orderable('milk', MILK) && O.orderable('soda', SODA) && !O.orderable('dryer', DRYER) && !O.orderable('latte', LATTE)
    && !O.orderable('x', { ...MILK, archived: true }) && !O.orderable('x', { ...MILK, status: 'archived' }) && O.notCounted(BREAD) && !O.notCounted(MILK));
  const since = ago(14);
  const rate = O.usedPerDay([{ productId: 'milk', type: 'used', change: -3785, date: ago(13) }, { productId: 'milk', type: 'received', change: 7570, date: ago(5) }, { productId: 'milk', type: 'counted', change: -200, date: ago(2) },
    { productId: 'avo', type: 'sold', change: -7, date: ago(3) }, { productId: 'avo', type: 'spoiled', change: -7, date: ago(3) }, { productId: 'avo', type: 'used', change: -50, date: ago(30) }, { productId: 'avo', type: 'returned', change: 3, date: ago(1) }], since, 14);
  check('what went a day: sold, used and thrown away over the stretch, less what came back; received, counted and older don’t count', Math.abs(rate.get('milk')! - 3785 / 14) < 0.01 && Math.abs(rate.get('avo')! - 11 / 14) < 1e-9);
  const back = O.usedPerDay([{ productId: 'a', type: 'sold', change: -10, date: ago(3) }, { productId: 'a', type: 'returned', change: 4, date: ago(2) }, { productId: 'b', type: 'returned', change: 5, date: ago(2) },
    { productId: 'm', type: 'sold', change: -2, date: ago(2), unit: 'units' }, { productId: 'm', type: 'used', change: -100, date: ago(2), unit: 'ml' }], since, 2, (id) => (id === 'm' ? 1000 : 1));
  check('…less what came back (a voided order, a return), never below none; a sale of whole bottles of something measured in ml counts its ml', back.get('a') === 3 && !back.has('b') && back.get('m') === 1050);
  const NOW = '2026-11-14T12:00:00.000Z', SINCE = '2026-10-31T12:00:00.000Z';
  check('the stretch: two weeks, even when it was quiet; since it started when that’s sooner; what was read when the read was cut short', O.spanDays(NOW, SINCE) === 14 && O.spanDays(NOW, SINCE, { oldestRead: '2026-11-14T08:00:00.000Z' }) === 14
    && O.spanDays(NOW, SINCE, { startedAt: '2026-11-10T12:00:00.000Z' }) === 4 && O.spanDays(NOW, SINCE, { oldestRead: '2026-11-12T12:00:00.000Z', cut: true }) === 2 && O.spanDays(NOW, SINCE, { startedAt: '2026-11-14T11:00:00.000Z' }) === 1);
  const milk = O.suggestFor('milk', MILK, 540, 0, 7);
  check('milk: about 540 ml a day for 7 days (3,780 ml) less the 4,785 ml here: nothing to order, and how long it lasts', milk.suggest === 0 && milk.onHand === 4785 && milk.daysLeft === 8 && milk.why === 'About 540 ml a day, 4.8 L left, enough for 8 days.', milk);
  const milk2 = O.suggestFor('milk', MILK, 900, 0, 7);
  check('…at 900 ml a day: 6,300 ml less 4,785 is 1,515 ml, so one gallon (whole containers, rounded up)', milk2.suggest === 1 && milk2.why === 'About 900 ml a day, 4.8 L left.');
  const milk3 = O.suggestFor('milk', MILK, 900, 3785, 7);
  check('…with a gallon already on its way: nothing more', milk3.suggest === 0 && /3\.8 L on its way/.test(milk3.why), milk3.why);
  const avo = O.suggestFor('avo', AVO, 0.5, 0, 7);
  check('avocados take a day to come: 8 days at half a case is 4, less the 1 here: 3 cases', avo.suggest === 3 && avo.lead === 1 && avo.why === 'About 0.5 a day, 1 left.', avo);
  const lemon = O.suggestFor('lemon', LEMON, 0, 0, 7);
  check('lemons: a set amount kept (2 bags), ordered back up to that', lemon.suggest === 2 && lemon.par === 2 && lemon.why === 'You keep 2 on hand, 0 left.');
  const cups = O.suggestFor('cups', CUPS, 0.5, 0, 7);
  check('cups: 1.5 cases needed, but the supplier’s minimum is 3', cups.suggest === 3 && cups.moq === 3);
  check('…nothing used and nothing kept: nothing to order, and it says so', O.suggestFor('x', { ...AVO, leadTimeDays: 0 }, 0, 0, 7).suggest === 0 && O.suggestFor('x', AVO, 0, 0, 7).why === 'Nothing used in the last two weeks, 1 left.');
  check('…a product sold online counts what paid orders hold as gone', O.onHandOf({ ...SODA, stockReserved: 6 }) === 24 && O.suggestFor('soda', { ...SODA, totalStock: 10, stockReserved: 6 }, 1, 0, 7).suggest === 3);
  const plan = O.planBySupplier([avo, lemon, O.suggestFor('soda', SODA, 1, 0, 7), milk, O.suggestFor('beans', BEANS, 300, 0, 7)]);
  check('by supplier, the business’s own spelling grouping “Valley Produce” and “valley produce ”; those to order first; no supplier last', plan.map((p) => p.name).join('|') === 'Valley Produce|Northside Dairy|'
    && plan[0].lines.map((l) => l.id).join() === 'avo,lemon,soda' && plan[0].total === 3 * 30 + 2 * 6 && plan[2].key === '' && plan[2].lines[0].id === 'beans', plan.map((p) => [p.name, p.lines.map((l) => `${l.id}:${l.suggest}`)]));

  console.log('an order, and what comes in');
  const order = { id: 'abcdefXYZ123', supplier: 'Valley Produce', orderDate: '', status: 'Placed' as const, items: [{ productId: 'avo', productName: 'Avocados', quantity: 3, costPerUnit: 30, container: 'case of 24' }, { productId: 'lemon', productName: 'Lemons', quantity: 2, costPerUnit: 6, receivedQuantity: 1, container: 'bag' }] };
  check('an order’s number is its id’s last six, as Inventory shows it; still to come is what hasn’t come', O.orderNumber(order.id) === 'XYZ123' && O.remainingOf(order.items[1]) === 1 && O.remainingOf({ quantity: 2, receivedQuantity: 5 }) === 0 && O.isOpen({ status: 'Partially Received' }) && !O.isOpen({ status: 'Draft' }));
  check('copied as words, ready for a text or an email', O.orderText('Linden Café', order, 'Sat, Nov 14') === 'Linden Café order #XYZ123 for Sat, Nov 14:\n3 × Avocados (case of 24)\n2 × Lemons (bag)');
  const all1 = O.cleanReceived(order, undefined)!;
  check('one tap: everything still to come, at the order’s costs', all1.map((l) => `${l.productId}:${l.qty}:${l.cost}`).join() === 'avo:3:30,lemon:1:6' && all1.every((l) => !l.typed));
  const twice = { items: [{ productId: 'avo', productName: 'Avocados', quantity: 2, costPerUnit: 30 }, { productId: 'avo', productName: 'Avocados', quantity: 3, costPerUnit: 30, receivedQuantity: 1 }] };
  const tw = O.cleanReceived(twice, undefined)!;
  check('the same product on two lines is put away once, all of it', tw.length === 1 && tw[0].qty === 4 && tw[0].remaining === 4);
  const spread = O.spreadReceived(twice.items, new Map([['avo', { qty: 5, cost: 30 }]]));
  check('…and what came fills the first line, then the next (one more than ordered on the last)', spread[0].receivedQuantity === 2 && spread[1].receivedQuantity === 4);
  check('what a delivery costs beyond what was booked: a different price, and more than was ordered', O.deliveryDiff([{ productId: 'a', qty: 12, cost: 30, was: 30, remaining: 10, typed: false }]) === 60
    && O.deliveryDiff([{ productId: 'a', qty: 3, cost: 28, was: 30, remaining: 4, typed: true }]) === -6 && O.deliveryDiff([{ productId: 'a', qty: 2, cost: 30, was: 30, remaining: 4, typed: false }]) === 0);
  const ed = O.cleanReceived(order, [{ itemId: 'avo', qty: 2, cost: '28.5' }, { itemId: 'lemon', qty: 0 }, { itemId: 'nope', qty: 4 }, { itemId: 'avo', qty: 9 }])!;
  check('edit first: what came and what it cost (a different cost is the business’s own); lines not on the order ignored', ed.length === 2 && ed[0].qty === 2 && ed[0].cost === 28.5 && ed[0].typed && ed[0].was === 30 && ed[1].qty === 0 && ed[1].cost === 6 && !ed[1].typed);
  check('…half a case, a negative or a $0 cost is refused', O.cleanReceived(order, [{ itemId: 'avo', qty: 1.5 }]) === null && O.cleanReceived(order, [{ itemId: 'avo', qty: -1 }]) === null && O.cleanReceived(order, [{ itemId: 'avo', qty: 1, cost: 0 }]) === null);

  console.log('the plan');
  await seed();
  const R = await import('../../src/app/api/ordering/route');
  await db.doc(`${T}/orders/old1`).set({ id: 'old1', supplier: 'Northside Dairy', orderDate: ago(1), status: 'Placed', items: [{ productId: 'milk', productName: 'Whole milk', quantity: 1, costPerUnit: 4.5 }] });
  await db.doc(`${T}/orders/done1`).set({ id: 'done1', supplier: 'Valley Produce', orderDate: ago(9), status: 'Received', items: [{ productId: 'avo', productName: 'Avocados', quantity: 9, costPerUnit: 30 }] });
  await db.doc(`${T}/orders/legacy`).set({ id: 'legacy', supplier: 'Cup Co', orderDate: ago(2), status: 'Shipped', items: [{ productId: 'cups', productName: 'Paper cups, 12 oz', quantity: 2, costPerUnit: 40, receivedQuantity: 1 }] });
  let r: any = await R.POST(req({ tenantId: 't1', action: 'plan' }));
  const p = r.body; const sup = (n: string) => p.plan.find((x: any) => x.name === n); const line = (n: string, id: string) => sup(n)?.lines.find((l: any) => l.id === id);
  check('each supplier’s things; equipment, menu items made from a recipe and things not counted yet aren’t suggested', r.body.ok && !!sup('Valley Produce') && !!sup('Northside Dairy') && !!sup('Cup Co') && !p.plan.some((x: any) => x.lines.some((l: any) => ['dryer', 'latte', 'bread'].includes(l.id))), p.plan.map((x: any) => x.name));
  check('…what went in the last two weeks (7 cases of avocados: half a case a day, for 8 days less the one here is 3)', line('Valley Produce', 'avo').perDay === 0.5 && line('Valley Produce', 'avo').suggest === 3, line('Valley Produce', 'avo'));
  check('…what’s on its way counts: the open milk order, and the part of an order still to come', line('Northside Dairy', 'milk').onOrder === 3785 && line('Cup Co', 'cups').onOrder === 1, { milk: line('Northside Dairy', 'milk'), cups: line('Cup Co', 'cups') });
  check('…no supplier yet apart, and the ones not counted yet named', p.plan[p.plan.length - 1].key === '' && p.plan[p.plan.length - 1].lines[0].id === 'beans' && p.uncounted.map((x: any) => x.id).join() === 'bread');
  check('…the orders still to come (placed, shipped, partly in), newest first, and the suppliers already used', p.orders.map((o: any) => o.id).join() === 'old1,legacy' && p.orders[0].number === 'OLD1' && p.suppliers.join('|') === 'Cup Co|Northside Dairy|Valley Produce' && p.coverDays === 7 && p.business === 'Linden Café', { orders: p.orders.map((o: any) => [o.id, o.number]), suppliers: p.suppliers });

  console.log('ordering');
  r = await R.POST(req({ tenantId: 't1', action: 'order', supplier: ' Valley  Produce ', lines: [{ itemId: 'avo', qty: 4 }, { itemId: 'lemon', qty: 2 }, { itemId: 'soda', qty: 0 }] }));
  const oid = r.body.order?.id; let o = await get(`${T}/orders/${oid}`);
  check('an order placed as Inventory’s own purchase orders: supplier, each line’s name, cost and container as they are now, who ordered it', r.body.ok && o.status === 'Placed' && o.supplier === 'Valley Produce' && o.items.length === 2 && o.items[0].productName === 'Avocados' && o.items[0].costPerUnit === 30 && o.items[0].container === 'case of 24' && o.orderedBy === 'Ana Ruiz' && o.number === O.orderNumber(oid), o);
  let tx = (await all(`${T}/transactions`)).filter((t: any) => t.relatedOrderId === oid);
  check('…booked as Inventory books an order: a supplies expense on account', tx.length === 1 && tx[0].type === 'expense' && tx[0].category === 'Supplies' && tx[0].amount === 132 && tx[0].paymentMethod === 'On Account' && tx[0].description === 'Purchase Order: Valley Produce');
  r = await R.POST(req({ tenantId: 't1', action: 'order', supplier: 'Valley Produce', lines: [{ itemId: 'dryer', qty: 1 }] }));
  const r2: any = await R.POST(req({ tenantId: 't1', action: 'order', supplier: '', lines: [{ itemId: 'avo', qty: 1 }] }));
  const r3: any = await R.POST(req({ tenantId: 't1', action: 'order', supplier: 'X', lines: [{ itemId: 'avo', qty: 1.5 }] }));
  const r4: any = await R.POST(req({ tenantId: 't1', action: 'order', supplier: 'X', lines: [{ itemId: 'avo', qty: 0 }] }));
  check('…not equipment, not without a supplier, whole numbers only, and something on it', r.status === 409 && r2.status === 400 && r3.status === 400 && r4.status === 400);
  r = await R.POST(req({ tenantId: 't1', action: 'plan' }));
  check('…the plan now counts it as on its way', r.body.plan.find((x: any) => x.name === 'Valley Produce').lines.find((l: any) => l.id === 'avo').suggest === 0);

  console.log('receiving');
  await db.doc(`${T}/inventory/lemon`).set({ costPerUnit: 6.5 }, { merge: true });
  const avoBefore = await get(`${T}/inventory/avo`);
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: oid }));
  o = await get(`${T}/orders/${oid}`); const avoAfter = await get(`${T}/inventory/avo`); const lemonAfter = await get(`${T}/inventory/lemon`);
  let rec = (await all(`${T}/stockCorrections`)).filter((e: any) => e.type === 'received' && e.refId === oid);
  check('one tap: all of it on the shelf, each line a batch at its cost, on the stock history, and the order received', r.body.ok && r.body.status === 'Received' && avoAfter.totalStock === avoBefore.totalStock + 4 && avoAfter.batches.length === 1 && avoAfter.batches[0].stock === 4 && avoAfter.batches[0].costPerUnit === 30
    && lemonAfter.totalStock === 2 && rec.length === 2 && rec.find((e: any) => e.productId === 'avo').change === 4 && rec[0].refKind === 'po' && o.status === 'Received' && o.items.every((i: any) => i.receivedQuantity === i.quantity) && o.receivedBy === 'Ana Ruiz', { body: r.body, o });
  check('…no money changes when it came as ordered', (await all(`${T}/transactions`)).filter((t: any) => t.relatedOrderId === oid).length === 1);
  check('…and a price changed since it was ordered isn’t put back to the order’s', lemonAfter.costPerUnit === 6.5 && lemonAfter.batches[0].costPerUnit === 6);
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: oid }));
  check('…a second tap changes nothing', r.body.ok && r.body.already === true && (await get(`${T}/inventory/avo`)).totalStock === avoAfter.totalStock);

  r = await R.POST(req({ tenantId: 't1', action: 'order', supplier: 'Northside Dairy', lines: [{ itemId: 'milk', qty: 4 }, { itemId: 'beans', qty: 1 }] }));
  const mid = r.body.order.id;
  const milkBefore = await get(`${T}/inventory/milk`);
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: mid, lines: [{ itemId: 'milk', qty: 3, cost: '4.65' }, { itemId: 'beans', qty: 1, cost: 42 }] }));
  o = await get(`${T}/orders/${mid}`); const milkAfter = await get(`${T}/inventory/milk`); const beansAfter = await get(`${T}/inventory/beans`);
  rec = (await all(`${T}/stockCorrections`)).filter((e: any) => e.type === 'received' && e.refId === mid);
  check('edit first: 3 of 4 gallons at $4.65: on the stock history in ml, so a count compares like with like', r.body.ok && r.body.status === 'Partially Received' && milkAfter.totalStock === milkBefore.totalStock + 3 && milkAfter.costPerUnit === 4.65
    && rec.find((e: any) => e.productId === 'milk').change === 3 * 3785 && rec.find((e: any) => e.productId === 'milk').unit === 'ml', { body: r.body, rec });
  check('…a cost typed in is what the business pays from now on (no longer typical)', beansAfter.costPerUnit === 42 && beansAfter.typicalCost === false && milkAfter.typicalCost === undefined);
  check('…the order is partly in, the rest still to come', o.status === 'Partially Received' && o.items.find((i: any) => i.productId === 'milk').receivedQuantity === 3 && o.items.find((i: any) => i.productId === 'milk').receivedCost === 4.65 && O.remainingOf(o.items.find((i: any) => i.productId === 'milk')) === 1);
  tx = (await all(`${T}/transactions`)).filter((t: any) => t.relatedOrderId === mid);
  check('…and it cost more than ordered, so the books are set right', tx.length === 2 && tx[1].type === 'expense' && Math.abs(tx[1].amount - (3 * 0.15 + 4)) < 0.001 && /cost more than ordered/.test(tx[1].description), tx);
  r = await R.POST(req({ tenantId: 't1', action: 'plan' }));
  check('…the plan counts the one gallon still to come', r.body.orders.some((x: any) => x.id === mid) && r.body.plan.find((x: any) => x.name === 'Northside Dairy').lines.find((l: any) => l.id === 'milk').onOrder === 3785 + 3785);
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: mid, expect: { milk: 4 }, lines: [{ itemId: 'milk', qty: 1 }] }));
  check('a screen that showed the order before part of it was put away is told to look again, not put away twice', r.status === 409 && /changed while you were looking/.test(r.body.error) && (await get(`${T}/orders/${mid}`)).items.find((i: any) => i.productId === 'milk').receivedQuantity === 3);
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: mid, lines: [{ itemId: 'milk', qty: 0 }] }));
  check('…nothing to put away is refused (cancel instead)', r.status === 400 && /Cancel the order/.test(r.body.error));
  r = await R.POST(req({ tenantId: 't1', action: 'cancel', orderId: mid }));
  o = await get(`${T}/orders/${mid}`); tx = (await all(`${T}/transactions`)).filter((t: any) => t.relatedOrderId === mid);
  check('the rest isn’t coming: the order is closed with what came, and what never came is given back', r.body.ok && o.status === 'Received' && /The rest didn’t come/.test(o.notes) && tx.length === 3 && tx[2].type === 'reversal' && tx[2].amount === 4.5);
  r = await R.POST(req({ tenantId: 't1', action: 'order', supplier: 'Cup Co', lines: [{ itemId: 'cups', qty: 3 }] }));
  const cid = r.body.order.id;
  r = await R.POST(req({ tenantId: 't1', action: 'cancel', orderId: cid }));
  tx = (await all(`${T}/transactions`)).filter((t: any) => t.relatedOrderId === cid);
  check('an order not coming at all: cancelled, and the whole of it given back', r.body.ok && (await get(`${T}/orders/${cid}`)).status === 'Cancelled' && tx.length === 2 && tx[1].type === 'reversal' && tx[1].amount === 120);
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: cid }));
  check('…and can’t then be received', r.body.already === true && (await get(`${T}/inventory/cups`)).totalStock === 2);
  r = await R.POST(req({ tenantId: 't1', action: 'order', supplier: 'Cup Co', lines: [{ itemId: 'cups', qty: 2 }] }));
  const over = r.body.order.id;
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: over, lines: [{ itemId: 'cups', qty: 3 }] }));
  tx = (await all(`${T}/transactions`)).filter((t: any) => t.relatedOrderId === over);
  check('more came than was ordered: on the shelf, and the extra booked', r.body.ok && r.body.status === 'Received' && tx.length === 2 && tx[1].type === 'expense' && tx[1].amount === 40 && (await get(`${T}/orders/${over}`)).items[0].receivedQuantity === 3);
  await db.doc(`${T}/orders/ghost`).set({ id: 'ghost', supplier: 'Cup Co', orderDate: ago(1), status: 'Placed', items: [{ productId: 'gone', productName: 'Lids', quantity: 2, costPerUnit: 9 }] });
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: 'ghost' }));
  check('an item deleted since it was ordered: says so, and the order can be closed', r.status === 400 && /Lids isn’t in Inventory any more/.test(r.body.error));
  const cupsBefore = (await get(`${T}/inventory/cups`)).totalStock;
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: 'legacy' }));
  check('an order made on Inventory’s Purchase orders tab is received here the same way (what’s still to come of it)', r.body.ok && (await get(`${T}/inventory/cups`)).totalStock === cupsBefore + 1 && (await get(`${T}/orders/legacy`)).status === 'Received');
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: 'nope' }));
  check('…an order that isn’t there says so', r.status === 404);
  await db.doc(`${T}/orders/startr`).set({ id: 'startr', supplier: 'Bakery', orderDate: ago(1), status: 'Placed', items: [{ productId: 'bread', productName: 'Sourdough', quantity: 2, costPerUnit: 6 }] });
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: 'startr' }));
  const bread = await get(`${T}/inventory/bread`);
  check('a delivery of something not counted yet starts its count', r.body.ok && bread.countStock === true && bread.totalStock === 2 && (await all(`${T}/stockCorrections`)).find((e: any) => e.refId === 'startr')?.change === 32);

  console.log('who it’s from, a set amount, how long an order lasts');
  r = await R.POST(req({ tenantId: 't1', action: 'supplier', itemId: 'beans', supplier: '  Bean  Roasters ' }));
  check('who the business buys something from', r.body.ok && (await get(`${T}/inventory/beans`)).supplier === 'Bean Roasters');
  const r5: any = await R.POST(req({ tenantId: 't1', action: 'supplier', itemId: 'beans', supplier: ' ' }));
  const r6: any = await R.POST(req({ tenantId: 't1', action: 'supplier', itemId: 'dryer', supplier: 'X' }));
  check('…a name is needed, and only for something that’s ordered', r5.status === 400 && r6.status === 404);
  r = await R.POST(req({ tenantId: 't1', action: 'par', itemId: 'avo', par: '3' }));
  check('a set amount to keep, and back to going by what’s used', r.body.ok && (await get(`${T}/inventory/avo`)).parLevel === 3 && (await R.POST(req({ tenantId: 't1', action: 'par', itemId: 'avo', par: null }))).body.ok && (await get(`${T}/inventory/avo`)).parLevel === null);
  check('…a number that isn’t one is refused', (await R.POST(req({ tenantId: 't1', action: 'par', itemId: 'avo', par: -2 }))).status === 400);
  r = await R.POST(req({ tenantId: 't1', action: 'cover', days: 10 }));
  check('how many days an order lasts (1 to 30)', r.body.ok && (await get(T)).ordering.coverDays === 10 && (await R.POST(req({ tenantId: 't1', action: 'cover', days: 45 }))).status === 400 && (await R.POST(req({ tenantId: 't1', action: 'plan' }))).body.coverDays === 10);
  manager = false;
  check('managers only', (await R.POST(req({ tenantId: 't1', action: 'plan' }))).status === 403); manager = true;

  console.log('the screens');
  const page = src('src/app/(app)/inventory/ordering/page.tsx'), inv = src('src/app/(app)/inventory/page.tsx');
  check('the page: on its way with one-tap Received and Edit first, each supplier’s order with steppers and Order these, copy the order, no supplier yet, not counted yet, a set amount', /On its way/.test(page) && /'Received'/.test(page) && /Edit first/.test(page)
    && /Order these/.test(page) && /Copy the order/.test(page) && /No supplier yet/.test(page) && /Not counted yet/.test(page) && page.includes("Keep a set number {forName ? `at ${forName}` : 'on hand'}") && /releaseCoverableBackorders/.test(page));
  check('…tap targets and the house words', !/uppercase|font-black|\{\/\*| · |[\u{1F300}-\u{1FAFF}]|call us|contact us/u.test(page) && (page.match(/min-h-\[44px\]|h-11 w-11/g) || []).length >= 6);
  check('Inventory’s own receive screen adds to the shelf (never works it out again from the batches, which a count or a sale may not have moved)', (() => { const recv = inv.slice(inv.indexOf('const handleReceiveStock'), inv.indexOf('batch.commit()', inv.indexOf('const handleReceiveStock'))); return /totalStock: increment\(item\.quantityReceived\)/.test(recv) && !/\.reduce\(\(acc, b\) => acc \+ b\.stock/.test(recv); })());
  check('…and so do its write-offs (one batch or several): the shelf count is never worked out again from the batches', /totalStock: increment\(-quantity\)/.test(inv) && /totalStock: increment\(-\(Number\(item\.stock\) \|\| 0\)\)/.test(inv) && !/\.reduce\(\(acc, b\) => acc \+ b\.stock, 0\)/.test(inv));
  check('an order received on Inventory’s own receive screen keeps what came of each line, so Ordering knows what’s still to come', /receivedQuantity: \(Number\(it\.receivedQuantity\) \|\| 0\) \+ \(came\.get\(it\.productId\) \|\| 0\)/.test(inv));
  check('in the menu after Manifest, from Purchase orders, and in Settings search', /href: '\/inventory\/ordering', icon: ShoppingCart/.test(src('src/components/shared/AppSidebar.tsx')) && /href="\/inventory\/ordering">What to order/.test(inv) && /id: 'ordering', title: 'Ordering'/.test(src('src/lib/settings-registry.ts')));

  check('two weeks is measured from the same moment as now (never a hair under fourteen days, which rounded an order up a case)', /const since = new Date\(Date\.parse\(now\) - LOOKBACK_DAYS \* 86400000\)/.test(src('src/app/api/ordering/route.ts'))
    && O.suggestFor('x', { totalStock: 1, leadTimeDays: 1 }, 7 / (14 - 1e-7), 0, 7).suggest === 3 && O.suggestFor('x', { totalStock: 1, leadTimeDays: 1 }, 0.5, 0, 7).suggest === 3);
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
