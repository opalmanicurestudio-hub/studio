// Checks what goes out with food and drink, staff meals, and what a plate really costs (round 33, design canvas "Food
// numbers": What a plate really costs):
// - lib/plate-extras: what's set once (a box for a main to go, a bag for an order to go, bread for each guest at a table),
//   kept clean; for here or to go by channel; in words
// - lib/food-cost plateCost: a plate at a table and to go, with its yield, what goes out with it, and the card fee
// - stock: the counter takes what goes out with each item and each order as it's sent, by for here or to go, never
//   stopping an order; a void puts a line's back; a table's bread for each guest goes once a visit, with the first dish
// - staff meals: settled with no money, for a named person, left out of the night's sales and of what was sold, and
//   counted apart on Food cost
// - api/food-cost: 'extras' and 'cardFee', checked against the stock; the report's plates, staff meals and what went out
// - the screens: the Food cost card and sheet, the plate, the staff meals, and the counter's for here or to go
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/plate-extras.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') { class StripeMock { paymentIntents = { create: async () => ({ id: 'pi_x' }) }; } return Object.assign(StripeMock, { default: StripeMock }); }
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor: { ...actor, isManager: manager, role: manager ? 'manager' : 'staff' }, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { ...actor, isManager: manager } }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const near = (a: any, b: number, e = 0.005) => typeof a === 'number' && Math.abs(a - b) <= e;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const PX = await import('../../src/lib/plate-extras');
  const FC = await import('../../src/lib/food-cost');
  const PC = await import('../../src/lib/product-cost');
  const left = async (id: string) => PC.usesLeft(await get(`${T}/inventory/${id}`));

  // Stock as Inventory keeps it: a striploin portion at $6.80, fries by the gram, and what goes out with food.
  const each = (name: string, cost100: number, stock = 1) => ({ name, type: 'professional', costingMethod: 'uses', estimatedUses: 100, useUnit: 'each', costPerUnit: cost100, totalStock: stock, partialContainerUses: 0, countStock: true });
  const striploin = { name: 'Striploin portions', type: 'professional', costingMethod: 'uses', estimatedUses: 10, useUnit: 'each', costPerUnit: 68, totalStock: 3, partialContainerUses: 0, countStock: true };
  const fries = { name: 'Fries', type: 'professional', costingMethod: 'size', size: 1000, unit: 'g', costPerUnit: 6.2, totalStock: 5, partialContainerSize: 0, countStock: true };
  const coffee = { name: 'Coffee beans', type: 'professional', costingMethod: 'size', size: 1000, unit: 'g', costPerUnit: 20, totalStock: 2, partialContainerSize: 0, countStock: true };
  const stock: Record<string, any> = { striploin, fries, coffee, box: each('Takeout boxes', 48), sauce: each('Sauce cups', 20), bag: each('Paper bags', 12), napkins: each('Napkins', 12), bread: each('Bread and butter', 38), lids: each('Hot cup lids', 6) };
  const steak = { type: 'refreshment', name: 'Steak frites', price: 24, category: 'Mains', formula: [{ id: 'striploin', name: 'Striploin portions', quantityUsed: 1, unit: 'each' }, { id: 'fries', name: 'Fries', quantityUsed: 100, unit: 'g' }] };
  const drip = { type: 'refreshment', name: 'Drip coffee', price: 3, category: 'Coffee', formula: [{ id: 'coffee', name: 'Coffee beans', quantityUsed: 15, unit: 'g' }] };
  const parts = new Map<string, any>([...Object.entries(stock), ['steak', steak], ['drip', drip]]);

  console.log('set once');
  const raw = [
    { itemId: 'box', name: 'x', amount: 1, measure: 'each', per: 'item', when: 'togo', sections: ['Mains', 'Mains', ''] },
    { id: 'sauce1', itemId: 'sauce', amount: 1, measure: 'each', per: 'item', when: 'togo', sections: [] },
    { itemId: 'bag', amount: 1, measure: 'each', per: 'order', when: 'togo', sections: ['Mains'] },
    { itemId: 'napkins', amount: 1, measure: 'each', per: 'order', when: 'togo' },
    { itemId: 'bread', amount: 1, measure: 'each', per: 'guest', when: 'togo' },
    { itemId: 'bad id!', amount: 1 }, { itemId: 'box', amount: 0 }, { id: 'sauce1', itemId: 'lids', amount: 1, measure: 'each', per: 'item', when: 'here', sections: ['Coffee'] },
  ];
  const ex = PX.cleanExtras(raw);
  check('kept clean: the malformed left out, sections once and only for each item, a guest always at a table', ex.length === 6 && JSON.stringify(ex[0].sections) === '["Mains"]' && ex[2].sections.length === 0 && ex[4].when === 'here' && ex[4].per === 'guest', ex);
  check('…each with its own id: one with none, or the same as one before it, gets the next free one', new Set(ex.map((e) => e.id)).size === ex.length && ex[1].id === 'sauce1' && ex[5].id !== 'sauce1', ex.map((e) => e.id));
  check('card fees: 2.9% unless set; typed as a percent, 0 to 10', PX.cardFeeOf({}) === 2.9 && PX.cardFeeOf({ foodCost: { cardFeePct: 0 } }) === 0 && PX.cardFeeOf({ foodCost: { cardFeePct: 40 } }) === 2.9
    && PX.cleanCardFee('2.75%') === 2.75 && PX.cleanCardFee('11') === null && PX.cleanCardFee('') === null && PX.cleanCardFee('abc') === null);
  check('the drive-thru and orders placed ahead are always to go; the counter as the order says', PX.modeOf('drive-thru') === 'togo' && PX.modeOf('ahead', false) === 'togo' && PX.modeOf('counter', true) === 'togo' && PX.modeOf('counter') === 'here' && PX.modeOf('kiosk', 'yes') === 'here');
  const ids = (ls: any[]) => ls.map((l) => l.id).sort().join();
  check('a main to go takes a box and a sauce cup; a coffee to go only the sauce cup; a coffee for here its lid', ids(PX.itemExtras(ex, steak, 'togo')) === 'box,sauce' && ids(PX.itemExtras(ex, drip, 'togo')) === 'sauce' && ids(PX.itemExtras(ex, drip, 'here')) === 'lids' && ids(PX.itemExtras(ex, steak, 'here')) === '');
  check('an order to go takes a bag and napkins; a table of 3 takes 3 bread, 50 at most', ids(PX.orderExtras(ex, 'togo')) === 'bag,napkins' && PX.orderExtras(ex, 'here').length === 0 && PX.guestExtras(ex, 3)[0].quantityUsed === 3 && PX.guestExtras(ex, 400)[0].quantityUsed === 50 && PX.guestExtras(ex, 0).length === 0);
  check('in words', PX.extraWords(ex[0]) === 'for each item in Mains to go' && PX.extraWords(ex[3]) === 'for each order to go' && PX.extraWords(ex[4]) === 'for each guest at a table' && PX.extraWords(ex[5]) === 'for each item in Coffee for here' && PX.extraWords({ ...ex[1], when: 'any' }) === 'for each item');

  console.log('what a plate really costs');
  const design = PX.cleanExtras([
    { itemId: 'bread', amount: 1, measure: 'each', per: 'guest' }, { itemId: 'box', amount: 1, measure: 'each', per: 'item', when: 'togo', sections: ['Mains'] },
    { itemId: 'sauce', amount: 1, measure: 'each', per: 'item', when: 'togo' }, { itemId: 'bag', amount: 1, measure: 'each', per: 'order', when: 'togo' }, { itemId: 'napkins', amount: 1, measure: 'each', per: 'order', when: 'togo' },
  ]);
  const sc = FC.itemCost('steak', steak, parts, 0.3, { extras: design, cardPct: 2.9 });
  const here = sc.plates!.here, togo = sc.plates!.togo;
  check('steak frites from the recipe: $7.42', near(sc.cost, 7.42), sc.cost);
  check('at a table: bread and butter $0.38 and a $0.70 card fee: costs $8.50, 35% of $24, keeps $15.50', near(here.total, 8.5) && near(here.cardFee, 0.7) && here.once.length === 1 && here.once[0].per === 'guest' && near(here.once[0].cost, 0.38) && Math.round(here.share! * 100) === 35 && near(here.keeps, 15.5), here);
  check('to go: box, sauce cup, bag and napkins, $0.92: costs $9.04, 38%, keeps $14.96', near(togo.extrasCost, 0.92) && togo.extras.length === 2 && togo.once.length === 2 && togo.once.every((l) => l.per === 'order') && near(togo.total, 9.04) && Math.round(togo.share! * 100) === 38 && near(togo.keeps, 14.96), togo);
  const half = FC.plateCost(steak, parts, 7.42, design, 'here', 2.9, 0.5);
  check('half the sales paid by card: half the fee', near(half.cardFee, 0.35) && half.cardShare === 0.5);
  const gap = FC.plateCost(steak, new Map([...parts].filter(([k]) => k !== 'box')), 7.42, design, 'togo', 2.9);
  check('something that goes out with no cost (not in stock any more): the plate’s cost isn’t known, not under-counted', gap.total === null && gap.share === null && gap.extras.some((l) => l.id === 'box' && l.cost === null));
  check('…and without the plate asked for, an item’s cost is as before', FC.itemCost('steak', steak, parts, 0.3).plates === undefined);

  console.log('saving them');
  await db.doc(T).set({ name: 'North Loft', timezone: 'UTC', kitchenSettings: { stations: ['Grill'] }, modules: { hospitality: true }, foodCost: { target: 0.3 } });
  for (const [id, x] of Object.entries(stock)) await db.doc(`${T}/inventory/${id}`).set({ id, status: 'active', isActive: true, ...x });
  await db.doc(`${T}/inventory/steak`).set({ id: 'steak', status: 'active', isActive: true, showInConcierge: true, ...steak });
  await db.doc(`${T}/inventory/drip`).set({ id: 'drip', status: 'active', isActive: true, showInConcierge: true, ...drip });
  const { POST: fcApi } = await import('../../src/app/api/food-cost/route');
  const X = (extras: any) => fcApi(req({ tenantId: 't1', action: 'extras', extras }));
  let r: any = await X('box');
  check('the list, or said', r.status === 400);
  r = await X([{ itemId: 'box', amount: 0, measure: 'each' }]);
  check('one that isn’t complete is said, not dropped', r.status === 400 && /isn’t complete/.test(r.body.error), r.body);
  r = await X([{ itemId: 'gone', amount: 1, measure: 'each' }]);
  check('…one not in the stock', r.status === 409 && /isn’t in your stock/.test(r.body.error), r.body);
  r = await X([{ itemId: 'box', amount: 100, measure: 'ml' }]);
  check('…one that can’t be worked out in that measure (a box in ml), with what it can be', r.status === 400 && /counted in/.test(r.body.error) && /each/.test(r.body.error), r.body);
  manager = false; check('…set by a manager', (await X([])).status === 403 && (await fcApi(req({ tenantId: 't1', action: 'cardFee', pct: 3 }))).status === 403); manager = true;
  const setList = [
    { itemId: 'box', name: 'whatever', amount: 1, measure: 'each', per: 'item', when: 'togo', sections: ['Mains'] }, { itemId: 'sauce', amount: 1, measure: 'each', per: 'item', when: 'togo' },
    { itemId: 'bag', amount: 1, measure: 'each', per: 'order', when: 'togo' }, { itemId: 'napkins', amount: 1, measure: 'each', per: 'order', when: 'any' },
    { itemId: 'bread', amount: 1, measure: 'each', per: 'guest' },
  ];
  r = await X(setList);
  const saved = (await get(T)).foodCost;
  check('saved: five, each named as it is in the stock', r.body.ok && saved.extras.length === 5 && saved.extras[0].name === 'Takeout boxes' && saved.extrasSetBy === 'Ana Ruiz' && saved.target === 0.3, saved);
  r = await fcApi(req({ tenantId: 't1', action: 'cardFee', pct: '12' }));
  check('card fees over 10% are said', r.status === 400 && /0% to 10%/.test(r.body.error));
  r = await fcApi(req({ tenantId: 't1', action: 'cardFee', pct: '2.9%' }));
  check('…2.9% saved', r.body.ok && (await get(T)).foodCost.cardFeePct === 2.9 && (await get(T)).foodCost.extras.length === 5);

  console.log('the counter');
  const { POST: counter } = await import('../../src/app/api/counter/route');
  const P = (b: any) => counter(req({ tenantId: 't1', channel: 'counter', ...b }));
  const lane = (await P({ action: 'lane' })).body;
  check('the counter asks for here or to go, now that something goes out only to go', lane.ok && lane.askToGo === true, { ok: lane.ok, err: lane.error, ask: lane.askToGo });
  const order = async (key: string, lines: [string, number][]) => { const o = (await P({ action: 'car', carKey: key })).body; for (const [itemId, quantity] of lines) await P({ action: 'add', orderId: o.orderId, itemId, quantity, tapKey: `${key}${itemId}` }); return o; };
  const before: Record<string, number | null> = {}; for (const id of Object.keys(stock)) before[id] = await left(id);
  const o1 = await order('k1', [['steak', 2], ['drip', 1]]);
  r = await P({ action: 'send', orderId: o1.orderId, toGo: true });
  const d1: Record<string, number> = {}; for (const id of Object.keys(stock)) d1[id] = Math.round(((before[id] || 0) - ((await left(id)) || 0)) * 1000) / 1000;
  check('two steaks and a coffee to go: 2 boxes (mains only), 3 sauce cups, a bag and napkins; no bread', r.body.ok && d1.box === 2 && d1.sauce === 3 && d1.bag === 1 && d1.napkins === 1 && d1.bread === 0 && d1.striploin === 2 && d1.fries === 200, { b: r.body, d1 });
  const ord1: any = await get(`${T}/counterOrders/${o1.orderId}`);
  const led1 = (await all(`${T}/stockCorrections`)).filter((e: any) => e.refId === o1.orderId);
  check('…the order is to go, keeps the bag and napkins, and each line keeps its own (a void puts them back)', ord1.toGo === true && ord1.extrasTaken?.bag === 1 && ord1.extrasTaken?.napkins === 1 && Object.values(ord1.stockTaken).some((t: any) => t.parts?.box === 2 && t.parts?.striploin === 2), { toGo: ord1.toGo, ex: ord1.extrasTaken, st: ord1.stockTaken });
  check('…on the stock history on lines of their own, marked, apart from the recipe', led1.filter((e: any) => e.extra === true).map((e: any) => e.productId).sort().join() === 'bag,box,napkins,sauce' && led1.some((e: any) => e.productId === 'striploin' && !e.extra && e.change === -2) && led1.filter((e: any) => e.extra).every((e: any) => /what goes out with it/.test(e.reason) && e.type === 'used'), led1);
  const b2: Record<string, number | null> = {}; for (const id of Object.keys(stock)) b2[id] = await left(id);
  const o2 = await order('k2', [['steak', 1]]);
  r = await P({ action: 'send', orderId: o2.orderId });
  const d2: Record<string, number> = {}; for (const id of Object.keys(stock)) d2[id] = Math.round(((b2[id] || 0) - ((await left(id)) || 0)) * 1000) / 1000;
  check('a steak for here: napkins (both), no box, sauce or bag', r.body.ok && d2.napkins === 1 && d2.box === 0 && d2.sauce === 0 && d2.bag === 0 && (await get(`${T}/counterOrders/${o2.orderId}`)).toGo === false, d2);
  await db.doc(`${T}/inventory/box`).set({ totalStock: 0, partialContainerUses: 0 }, { merge: true });
  const o3 = await order('k3', [['steak', 1]]);
  r = await P({ action: 'send', orderId: o3.orderId, toGo: true });
  const ord3: any = await get(`${T}/counterOrders/${o3.orderId}`); const led3 = (await all(`${T}/stockCorrections`)).filter((e: any) => e.refId === o3.orderId && e.extra);
  check('out of boxes: the order still goes (what goes out with it never stops a sale)', r.body.ok && ord3.status === 'sent', r.body);
  check('…and the box that wasn’t there isn’t counted as going out, nor kept for a void', !led3.some((e: any) => e.productId === 'box') && led3.some((e: any) => e.productId === 'sauce') && Object.values(ord3.stockTaken).every((t: any) => !t.parts?.box && !t.extras?.box), { led3, st: ord3.stockTaken });
  const CS = await import('../../src/lib/counter-server');
  r = await CS.voidOrder(db, 't1', o3.orderId, 'Drove off', { id: 'm1', name: 'Ana Ruiz' } as any);
  check('…so a void doesn’t put back boxes that never came off', (r as any).ok && (await left('box')) === 0, await get(`${T}/inventory/box`));
  await db.doc(`${T}/inventory/box`).set({ totalStock: 1, partialContainerUses: 0 }, { merge: true });
  const o4 = await order('k4', [['steak', 1]]);
  await P({ action: 'send', orderId: o4.orderId, toGo: true });
  const boxBefore = await left('box'); const bagBefore = await left('bag');
  r = await CS.voidOrder(db, 't1', o4.orderId, 'Drove off', { id: 'm1', name: 'Ana Ruiz' } as any);
  const back4 = (await all(`${T}/stockCorrections`)).filter((e: any) => e.refId === o4.orderId && e.type === 'returned');
  check('a void before the kitchen starts puts the box back with the steak', (r as any).ok && near(((await left('box')) || 0) - (boxBefore || 0), 1), { r, boxBefore, after: await left('box') });
  check('…what goes out with it back on lines of their own, marked as they were taken; none of it made, so the bag and napkins too', back4.filter((e: any) => e.extra === true).map((e: any) => `${e.productId}${e.change}`).sort().join() === 'bag1,box1,napkins1,sauce1' && back4.some((e: any) => e.productId === 'striploin' && !e.extra && e.change === 1) && near(((await left('bag')) || 0) - (bagBefore || 0), 1), back4);

  console.log('staff meals');
  // Ana is signed in at the counter, not a manager; Lee and Rosa work here, and Rosa is a manager.
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'staff', isActive: true });
  await db.doc(`${T}/staff/lee`).set({ name: 'Lee Park', role: 'staff', isActive: true, pin: '2468' });
  await db.doc(`${T}/staff/rosa`).set({ name: 'Rosa Diaz', role: 'manager', isActive: true, pin: '1357' });
  const o5 = await order('k5', [['steak', 1]]);
  await P({ action: 'send', orderId: o5.orderId });
  r = await P({ action: 'staffMeal', orderId: o5.orderId, for: 'Sam' });
  check('a staff meal writes the order off, so it’s a manager’s: asked for', r.status === 403 && r.body.needsManager === true && !(await get(`${T}/counterOrders/${o5.orderId}`)).paidAt, r.body);
  r = await P({ action: 'staffMeal', orderId: o5.orderId, for: 'Sam', pin: '9999' });
  check('…a wrong PIN is said', r.status === 403 && /isn’t right/.test(r.body.error), r.body);
  r = await P({ action: 'staffMeal', orderId: o5.orderId, for: 'Sam', pin: '2468' });
  check('…a PIN that isn’t a manager’s is said', r.status === 403 && r.body.needsManager === true && /manager’s PIN/.test(r.body.error) && !(await get(`${T}/counterOrders/${o5.orderId}`)).paidAt, r.body);
  r = await P({ action: 'staffMeal', orderId: o5.orderId, for: '  ', pin: '1357' });
  check('…who it’s for, by name', r.status === 400 && /Who is it for/.test(r.body.error));
  r = await P({ action: 'staffMeal', orderId: o5.orderId, for: 'Sam', pin: '1357' });
  const s5: any = await get(`${T}/counterOrders/${o5.orderId}`); const car5: any = await get(`${T}/driveThruCars/${o5.carId}`);
  check('rung in for Sam with Rosa’s PIN: settled with no money, at Ana’s counter, waiting to be handed over', r.body.ok && r.body.for === 'Sam' && r.body.approvedBy === 'Rosa Diaz' && s5.payMethod === 'staff' && !!s5.paidAt && s5.staffMeal.for === 'Sam' && s5.staffMeal.by === 'Ana Ruiz' && s5.staffMeal.approvedBy === 'Rosa Diaz' && car5.stage === 'pickup', { b: r.body, s5, stage: car5?.stage });
  await db.doc(`${T}/staff/m1`).set({ role: 'manager' }, { merge: true });
  const o6 = await order('k6', [['drip', 1]]);
  r = await P({ action: 'staffMeal', orderId: o6.orderId, for: 'Sam' });
  check('a manager signed in goes straight through; not before it’s sent to the kitchen', r.status === 409 && /Send the order/.test(r.body.error), r.body);
  await CS.voidOrder(db, 't1', o6.orderId, 'x', { id: 'm1', name: 'Ana Ruiz' } as any).catch(() => null); await P({ action: 'cancel', orderId: o6.orderId });
  check('…no sale or tax booked', !(await get(`${T}/transactions/counter_${o5.orderId}`)) && !(await get(`${T}/transactions/counter_${o5.orderId}_tax`)));
  r = await P({ action: 'staffMeal', orderId: o5.orderId, for: 'Lee' });
  check('…once: again says so, still Sam’s', r.body.ok && r.body.already === true && r.body.for === 'Sam' && (await get(`${T}/counterOrders/${o5.orderId}`)).staffMeal.for === 'Sam');
  const p1 = await CS.payOrder(db, 't1', o1.orderId, { method: 'card', by: 'Ana Ruiz' });
  const p2 = await CS.payOrder(db, 't1', o2.orderId, { method: 'cash', by: 'Ana Ruiz' });
  r = await P({ action: 'staffMeal', orderId: o1.orderId, for: 'Sam' });
  check('…never one that’s paid', (p1 as any).ok && (p2 as any).ok && r.status === 409 && /paid already/.test(r.body.error), r.body);
  check('the night’s sales leave staff meals out', /o\.paidAt && !o\.staffMeal/.test(src('src/lib/night-close-server.ts')));

  console.log('a table');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Grill' }))).body.key;
  await db.doc(`${T}/appointments/v1`).set({ id: 'v1', isTable: true, partySize: 3, status: 'seated' });
  const now = new Date().toISOString();
  await db.doc(`${T}/kdsTickets/tk1`).set({ id: 'tk1', source: 'tab', visitId: 'v1', menuItemId: 'steak', menuItemName: 'Steak frites', quantity: 1, status: 'pending', createdAt: now });
  await db.doc(`${T}/kdsTickets/tk2`).set({ id: 'tk2', source: 'tab', visitId: 'v1', menuItemId: 'drip', menuItemName: 'Drip coffee', quantity: 1, status: 'pending', createdAt: now });
  const tb: Record<string, number | null> = {}; for (const id of Object.keys(stock)) tb[id] = await left(id);
  r = await kitchen(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'tk1', step: 'ready' }));
  const t1d: Record<string, number> = {}; for (const id of Object.keys(stock)) t1d[id] = Math.round(((tb[id] || 0) - ((await left(id)) || 0)) * 1000) / 1000;
  check('a table of 3’s first dish up: 3 bread and butter and napkins for the table, with the steak; no box', r.body.ok && t1d.bread === 3 && t1d.napkins === 1 && t1d.box === 0 && t1d.striploin === 1 && !!(await get(`${T}/appointments/v1`)).extrasTakenAt, { b: r.body, t1d });
  r = await kitchen(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'tk2', step: 'ready' }));
  check('…the next dish takes only its own: the table’s are once a visit', r.body.ok && near((tb.bread || 0) - ((await left('bread')) || 0), 3) && near((tb.napkins || 0) - ((await left('napkins')) || 0), 1) && near((tb.coffee || 0) - ((await left('coffee')) || 0), 15));
  check('…marked on the stock history', (await all(`${T}/stockCorrections`)).some((e: any) => e.productId === 'bread' && e.extra === true && e.change === -3));

  console.log('the report');
  r = await fcApi(req({ tenantId: 't1', action: 'report', period: 'week' }));
  const rs = r.body; const st = rs.items?.find((x: any) => x.id === 'steak');
  check('what was sold leaves the staff meal out: 3 steaks and a coffee, paid', rs.ok && rs.report.items.find((x: any) => x.id === 'steak')?.qty === 3 && near(rs.report.sold, 24 * 3 + 3, 0.01), rs.report);
  check('staff meals apart: one, for Sam, at what it cost to make', rs.staffMeals.count === 1 && rs.staffMeals.by[0].for === 'Sam' && near(rs.staffMeals.cost, 7.42) && rs.staffMeals.unknown === 0, rs.staffMeals);
  check('card share from what was paid: the card order of the two', near(rs.cardShare, 51 / 75, 0.002) && rs.cardPct === 2.9, { share: rs.cardShare });
  check('each plate at a table and to go, the fee on that share', near(st?.plates?.here?.cardFee, Math.round(24 * 0.029 * rs.cardShare * 100) / 100) && near(st.plates.togo.extrasCost, 0.48 + 0.2 + 0.12 + 0.12) && near(st.plates.here.extrasCost, 0.38 + 0.12), st?.plates);
  const usedCost = rs.extrasUsed?.cost;
  // Two steaks and a coffee to go $1.80, a steak for here $0.12, the two voided all put back, Sam's napkins $0.12, the
  // table's bread and napkins $1.26.
  check('what went out with orders, as taken off stock, less what a void put back: $3.30', near(usedCost, 3.3, 0.01) && rs.extrasUsed.unknown === 0, { usedCost, list: rs.extras?.map((e: any) => [e.name, e.cost]) });
  check('…the list as set, each with what one costs and in words', rs.extras.length === 5 && near(rs.extras[0].cost, 0.48) && rs.extras[4].words === 'for each guest at a table');

  console.log('the screens');
  const files = ['src/components/food/PlateExtras.tsx', 'src/app/(app)/food-cost/page.tsx', 'src/app/(app)/counter/page.tsx'];
  const bad = files.filter((f) => /\{\/\*/.test(src(f)) || /\buppercase\b/.test(src(f)) || /font-black/.test(src(f)) || / · /.test(src(f)) || /contact us|call us/i.test(src(f)));
  check('no JSX comments, capitals, heavy type or dots between words', bad.length === 0, bad);
  const lowTap = files.filter((f) => /min-h-\[(3\d|[12]\d)px\]|h-(8|9|10) w-(8|9|10)\b/.test(src(f)));
  check('every control is a 44px target', lowTap.length === 0, lowTap);
  const fc = src('src/app/(app)/food-cost/page.tsx'), ctr = src('src/app/(app)/counter/page.tsx'), pe = src('src/components/food/PlateExtras.tsx');
  check('Food cost: the card, the plate at a table and to go, the staff meals', /<PlateExtras/.test(fc) && /What a plate really costs/.test(fc) && />At a table</.test(fc) && />To go</.test(fc) && /Staff meals/.test(fc));
  check('the sheet: picked from the stock, for each item, order or guest, to go or for here, by section, and card fees', /action: 'ingredients'/.test(pe) && /Each guest at a table/.test(pe) && /For here/.test(pe) && /Only with items in/.test(pe) && /action: 'cardFee'/.test(pe) && /role="dialog"/.test(pe));
  check('the counter: for here or to go only when it matters, sent with the order; Staff meal with who it’s for', /lane\?\.askToGo && <div role="radiogroup"/.test(ctr) && /\.\.\.\(lane\?\.askToGo \? \{ toGo \} : \{\}\)/.test(ctr) && /action: 'staffMeal'/.test(ctr) && /Who it’s for/.test(ctr)
    && /<PinPad check=\{staffPinCheck\}/.test(ctr) && /setStaffFor\(''\)/.test(ctr) && /can’t be undone/.test(ctr));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
