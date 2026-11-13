// Checks the drive-thru (L21, part one): api/counter, the kitchen screen's timing and holding (api/kitchen, lib/kitchen,
// lib/holding), the menu's kitchen timing (api/menu), and the pages.
// - The lane: a tablet set up once (kind drive-thru) works on its own key; a car tapped in twice is one car; numbers go
//   B1, B2 by the day; every line is priced from the menu with its choices and the business's sales tax; one tap is one
//   change however often it's sent; a sold-out item or choice can't be added or sent; sending makes one kitchen ticket a
//   line with a time it must be ready by (the lane's target, never sooner than the slowest item takes); stock is taken
//   once; paying books the sale and its tax once, cash into the one open drawer with the change; handing over needs
//   payment; a car parked forward keeps its spot; a car that left without ordering isn't a served time.
// - The order board shows only the order at the speaker, and nothing about anyone else.
// - The kitchen works drive-thru first, then whatever is due soonest; "By order" keeps an order together.
// - Holding: a batch lasts the menu's time; a ticket made from it takes from it once; nothing past its time is taken
//   from; throwing one out is counted.
// - The pages read and act only through the server and keep the writing rules.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/drive-thru.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

let db: any = strictTransactions(makeDb());
let manager = true;
let signedIn = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, _t: any, level: string) => (!signedIn ? { deny: { status: 401, body: { ok: false, error: 'Please sign in again.' } } }
      : level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
let passOfM: () => Promise<string> = async () => '';
const num0 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

(async () => {
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  const K = await import('../../src/lib/kitchen');
  const H = await import('../../src/lib/holding');
  const C = await import('../../src/lib/counter-orders');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc('tenants/t2').set({ name: 'Other place', timezone: 'UTC' });
  await db.doc(`${T}/inventory/bun`).set({ type: 'retail', name: 'Buns', totalStock: 100, unit: 'units' });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Food', price: 6, totalStock: 50, makeSeconds: 300, formula: [{ id: 'bun', name: 'Bun', quantityUsed: 1, unit: 'units' }], choices: [
    { id: 'add', name: 'Add', pick: 'any', required: false, max: 3, options: [{ id: 'ch', name: 'Cheese', price: 1 }, { id: 'bc', name: 'Bacon', price: 1.5 }] }] });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 2.5, totalStock: 100, makeSeconds: 60, holdMinutes: 7, batchSize: 8 });
  await db.doc(`${T}/inventory/shake`).set({ type: 'refreshment', name: 'Shake', category: 'Drinks', price: 4, totalStock: 20, choices: [
    { id: 'fl', name: 'Flavor', pick: 'one', required: true, options: [{ id: 'v', name: 'Vanilla', price: 0 }, { id: 's', name: 'Strawberry', price: 0 }] }] });
  await db.doc(`${T}/inventory/pie`).set({ type: 'refreshment', name: 'Pie', category: 'Sides', price: 2, totalStock: 10, soldOut: true });

  console.log('setting the lane tablet up');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const bkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Order board', kind: 'drive-thru-board' }))).body.key;
  const kkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Grill', kind: 'kitchen' }))).body.key;
  await db.doc(T).set({ kitchenSettings: { loungeOrdersMadeBy: null } }, { merge: true });
  check('a drive-thru tablet is set up like the kitchen screen', typeof key === 'string' && key.length === 64 && typeof bkey === 'string' && typeof kkey === 'string');
  manager = false; signedIn = false;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b }));
  let r: any = await P({ action: 'lane' });
  check('it opens the lane on its own key, with nobody signed in: the menu, no cars, the 3:30 target', r.status === 200 && r.body.ok && r.body.cars.length === 0 && r.body.stats.target === 210 && r.body.menu.some((m: any) => m.id === 'fries'), r.body);
  r = await POST(req({ tenantId: 't2', key, action: 'lane' }));
  const noKey: any = await POST(req({ tenantId: 't1', action: 'lane' }));
  check('…only for its own business, and never with no key and nobody signed in', r.status === 401 && noKey.status === 401, [r.body, noKey.body]);
  const kOnLane: any = await POST(req({ tenantId: 't1', key: kkey, action: 'lane' }));
  const bOnLane: any = await POST(req({ tenantId: 't1', key: bkey, action: 'car' }));
  const bOnBoard: any = await POST(req({ tenantId: 't1', key: bkey, action: 'board' }));
  const lOnKitchen: any = await kitchen(req({ tenantId: 't1', key, action: 'tickets' }));
  const bOnKitchen: any = await kitchen(req({ tenantId: 't1', key: bkey, action: 'tickets' }));
  check('each key does only its own screen’s job: a kitchen key can’t work the lane, the order board’s key only shows the board, and a lane key can’t move kitchen tickets',
    kOnLane.status === 401 && bOnLane.status === 401 && bOnBoard.status === 200 && lOnKitchen.status === 401 && bOnKitchen.status === 401, [kOnLane.body, bOnLane.body, bOnBoard.body, lOnKitchen.body, bOnKitchen.body]);

  console.log('a car, its order, and the kitchen');
  r = await P({ action: 'car', carKey: 'carkey-0001' });
  const car1 = r.body;
  const again: any = await P({ action: 'car', carKey: 'carkey-0001' });
  check('a car at the speaker gets B1 and an empty order; the same tap sent twice is the same car', car1.ok && car1.number === 'B1' && again.body.carId === car1.carId && again.body.already === true && (await all(`${T}/driveThruCars`)).length === 1, [car1, again.body]);
  r = await P({ action: 'add', orderId: car1.orderId, itemId: 'burger', choices: { add: ['ch'] }, quantity: 2, tapKey: 'tap-00000001' });
  check('a burger with cheese, priced from the menu (6 + 1) for two', r.body.ok && r.body.order.lines.length === 1 && r.body.order.lines[0].unitPrice === 7 && r.body.order.lines[0].quantity === 2 && r.body.order.lines[0].choicesText === 'Cheese', r.body);
  r = await P({ action: 'add', orderId: car1.orderId, itemId: 'burger', choices: { add: ['ch'] }, quantity: 2, tapKey: 'tap-00000001' });
  check('…the same tap sent again changes nothing', r.body.order.lines[0].quantity === 2, r.body);
  r = await P({ action: 'add', orderId: car1.orderId, itemId: 'fries', tapKey: 'tap-00000002' });
  r = await P({ action: 'add', orderId: car1.orderId, itemId: 'fries', tapKey: 'tap-00000003' });
  check('the same thing again is one line with more of it; sales tax at the business’s rate (10% of 19)', r.body.order.lines.length === 2 && r.body.order.lines[1].quantity === 2 && r.body.order.subtotal === 19 && r.body.order.tax === 1.9 && r.body.order.total === 20.9, r.body);
  r = await P({ action: 'add', orderId: car1.orderId, itemId: 'pie', tapKey: 'tap-00000004' });
  const r2: any = await P({ action: 'add', orderId: car1.orderId, itemId: 'shake', choices: {}, tapKey: 'tap-00000005' });
  check('a sold-out item can’t be added, nor one with a choice left out', r.status === 400 && /sold out/.test(r.body.error) && r2.status === 400 && /Choose a flavor/.test(r2.body.error), [r.body, r2.body]);
  r = await P({ action: 'add', orderId: car1.orderId, itemId: 'shake', choices: { fl: ['s'] }, tapKey: 'tap-00000006' });
  // The strawberry runs out after it's on the order: sending is refused until that line is changed.
  await db.doc(`${T}/inventory/shake`).set({ choices: [{ id: 'fl', name: 'Flavor', pick: 'one', required: true, options: [{ id: 'v', name: 'Vanilla', price: 0 }, { id: 's', name: 'Strawberry', price: 0, soldOut: true }] }] }, { merge: true });
  r = await P({ action: 'send', orderId: car1.orderId });
  check('a choice that sold out after it was ordered stops the send, with the line named', r.status === 409 && /Shake: Strawberry is sold out/.test(r.body.error) && (await get(`${T}/counterOrders/${car1.orderId}`)).status === 'building', r.body);
  const shakeLine = (await get(`${T}/counterOrders/${car1.orderId}`)).lines.find((l: any) => l.itemId === 'shake');
  await P({ action: 'remove', orderId: car1.orderId, lineId: shakeLine.lineId, tapKey: 'tap-00000007' });
  const early: any = await P({ action: 'paid', orderId: car1.orderId, method: 'card' });
  check('nothing is paid before the order goes to the kitchen', early.status === 409, early.body);
  const t0 = Date.now();
  r = await P({ action: 'send', orderId: car1.orderId });
  const tix = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === car1.orderId);
  const due = Date.parse(r.body.dueAt);
  check('sent: one ticket a line, each named for the car, due by the slowest item (the burger’s 5:00 beats the 3:30 target)', r.body.ok && tix.length === 2 && tix.every((t: any) => t.channel === 'drive-thru' && t.orderNumber === 'B1' && t.dueAt === r.body.dueAt && t.status === 'pending')
    && Math.abs(due - (t0 + 300000)) < 5000, { body: r.body, tix });
  check('…stock taken once: the fries by their own count (with a line in the stock ledger), the burger by its recipe, never its own count', (await get(`${T}/inventory/burger`)).totalStock === 50 && (await get(`${T}/inventory/fries`)).totalStock === 98 && (await all(`${T}/stockCorrections`)).filter((x: any) => x.refId === car1.orderId && x.type === 'sold').length === 1
    && JSON.stringify((await get(`${T}/counterOrders/${car1.orderId}`)).itemsTaken) === '["fries"]');
  check('…and what the recipe uses (a bun a burger), as the lounge does', (await get(`${T}/inventory/bun`)).totalStock === 98 && (await all(`${T}/stockCorrections`)).some((x: any) => x.refId === car1.orderId && x.type === 'used' && x.productId === 'bun' && x.change === -2));
  r = await P({ action: 'send', orderId: car1.orderId });
  check('…sent again: nothing more (no second tickets or stock)', r.body.already === true && (await all(`${T}/kdsTickets`)).length === 2 && (await get(`${T}/inventory/fries`)).totalStock === 98 && (await get(`${T}/inventory/bun`)).totalStock === 98, r.body);
  check('…and the car moves on to pay', (await get(`${T}/driveThruCars/${car1.carId}`)).stage === 'pay');
  r = await P({ action: 'add', orderId: car1.orderId, itemId: 'fries', tapKey: 'tap-00000008' });
  check('a sent order can’t be changed from the lane', r.status === 409, r.body);

  console.log('the window');
  await db.doc(`${T}/tillSessions/d1`).set({ status: 'open', expectedCash: 100, totalCashSales: 0 });
  r = await P({ action: 'paid', orderId: car1.orderId, method: 'cash', tendered: 20 });
  check('cash less than the total is refused', r.status === 400 && /less than the total/.test(r.body.error), r.body);
  r = await P({ action: 'paid', orderId: car1.orderId, method: 'cash', tendered: 50 });
  const o1 = await get(`${T}/counterOrders/${car1.orderId}`);
  check('paid in cash: change worked out, into the open drawer, with what was handed over kept', r.body.ok && r.body.change === 29.1 && r.body.inDrawer === true && o1.cashTendered === 50 && o1.changeGiven === 29.1
    && (await get(`${T}/tillSessions/d1`)).expectedCash === 120.9, { body: r.body, o1 });
  const sale = await get(`${T}/transactions/counter_${car1.orderId}`); const tax = await get(`${T}/transactions/counter_${car1.orderId}_tax`);
  check('…the sale and its tax in the books, apart', sale?.amount === 19 && sale.type === 'income' && tax?.amount === 1.9 && tax.category === 'Tax Collected', [sale, tax]);
  r = await P({ action: 'paid', orderId: car1.orderId, method: 'card' });
  check('…paid again (another tablet, or a lost answer): nothing more, and it says how it was paid and the change given', r.body.already === true && r.body.payMethod === 'cash' && r.body.change === 29.1 && (await get(`${T}/tillSessions/d1`)).expectedCash === 120.9, r.body);
  check('…and the car moves on to the window', (await get(`${T}/driveThruCars/${car1.carId}`)).stage === 'pickup');
  r = await P({ action: 'move', carId: car1.carId, to: 'forward', spot: '2' });
  const back: any = await P({ action: 'move', carId: car1.carId, to: 'pickup' });
  check('a car only ever moves forward along the lane', back.body.already === true && (await get(`${T}/driveThruCars/${car1.carId}`)).stage === 'forward', back.body);
  check('pulled forward to a spot, so the cars behind keep moving', (await get(`${T}/driveThruCars/${car1.carId}`)).stage === 'forward' && (await get(`${T}/driveThruCars/${car1.carId}`)).spot === '2');
  r = await P({ action: 'lane' });
  const lo = r.body.orders[car1.orderId];
  check('the lane shows the order, the kitchen still making it, and the spot', lo.kitchen === 'making' && lo.ticketCount === 2 && lo.readyCount === 0 && r.body.cars[0].spot === '2', lo);
  r = await P({ action: 'move', carId: car1.carId, to: 'gone' });
  const left = await all(`${T}/kdsTickets`);
  check('handed over: the car is gone, the order done, and whatever the kitchen hadn’t marked served is now', r.body.ok && (await get(`${T}/driveThruCars/${car1.carId}`)).stage === 'gone' && (await get(`${T}/counterOrders/${car1.orderId}`)).status === 'done' && left.every((t: any) => t.status === 'delivered'), left);

  console.log('a car that leaves, an unpaid order, the stats');
  const car2 = (await P({ action: 'car', carKey: 'carkey-0002' })).body;
  check('the next car is B2', car2.number === 'B2', car2);
  r = await P({ action: 'cancel', orderId: car2.orderId });
  check('a car that left without ordering: its order dropped and it’s out of the lane', r.body.ok && (await get(`${T}/driveThruCars/${car2.carId}`)).left === true);
  const car3 = (await P({ action: 'car', carKey: 'carkey-0003' })).body;
  await P({ action: 'add', orderId: car3.orderId, itemId: 'fries', tapKey: 'tap-00000009' });
  await P({ action: 'send', orderId: car3.orderId });
  r = await P({ action: 'move', carId: car3.carId, to: 'gone' });
  check('an order sent but not paid can’t be handed over', r.status === 409 && /Take payment/.test(r.body.error), r.body);

  r = await P({ action: 'lane' });
  check('today’s numbers: one car served (the one that left doesn’t count), and where its time went', r.body.stats.servedToday === 1 && typeof r.body.stats.average === 'number' && r.body.stats.ordering !== undefined && r.body.cars.length === 1, r.body.stats);

  console.log('the order board');
  const car4 = (await P({ action: 'car', carKey: 'carkey-0004' })).body;
  await P({ action: 'add', orderId: car4.orderId, itemId: 'burger', choices: { add: ['bc'] }, tapKey: 'tap-00000010' });
  r = await P({ action: 'board' });
  check('the board shows the order at the speaker as it’s taken: names, choices, prices, the total', r.body.ok && r.body.order.number === 'B4' && r.body.order.lines[0].name === 'Burger' && r.body.order.lines[0].choicesText === 'Bacon' && r.body.order.total === 8.25 && r.body.order.sent === false, r.body);
  check('…and nothing about anyone else (no other car, no ids, no staff)', !/B3|carId|orderId|takenBy|Ana/.test(JSON.stringify(r.body)), r.body);
  r = await POST(req({ tenantId: 't1', key: bkey, action: 'board' }));
  check('the board’s own key shows the same', r.body.order?.number === 'B4', r.body);
  await db.doc(`${T}/counterOrders/${car4.orderId}`).set({ updatedAt: new Date(Date.now() - 11 * 60000).toISOString() }, { merge: true });
  r = await P({ action: 'board' });
  check('an order nobody has touched for 10 minutes is never shown to the next car', r.body.order === null, r.body);

  console.log('the kitchen');
  await db.doc(`${T}/kdsTickets/lounge1`).set({ id: 'lounge1', source: 'pos', menuItemName: 'Tea', status: 'pending', createdAt: new Date(Date.now() - 600000).toISOString() });
  r = await kitchen(req({ action: 'tickets', tenantId: 't1', key: kkey }));
  const waiting = r.body.tickets.filter((t: any) => t.status === 'pending').sort(K.kitchenOrder);
  check('the kitchen screen gets each ticket’s order number, kind and time; drive-thru is worked first, even ahead of an older desk order', waiting[0].channel === 'drive-thru' && waiting[0].orderNumber === 'B3' && !!waiting[0].dueAt && waiting[waiting.length - 1].id === 'lounge1', waiting.map((t: any) => t.id));
  const grouped = K.groupTickets(r.body.tickets, 'order');
  check('“By order” keeps an order together, named for the car', grouped.some((g: any) => g.label === 'Drive-thru B3'), grouped.map((g: any) => g.label));
  check('…what’s held, and what can be: fries, a batch of 8 for 7 minutes', r.body.holds.length === 0 && r.body.holdable.length === 1 && r.body.holdable[0].id === 'fries' && r.body.holdable[0].batchSize === 8 && r.body.holdable[0].holdMinutes === 7, r.body.holdable);

  console.log('holding');
  r = await kitchen(req({ action: 'hold', tenantId: 't1', key: kkey, itemId: 'fries' }));
  const bin = r.body.bin;
  check('a batch of fries started: 8, good for 7 minutes', r.body.ok && bin.quantity === 8 && Math.abs(Date.parse(bin.expiresAt) - Date.parse(bin.startedAt) - 420000) < 1000, r.body);
  r = await kitchen(req({ action: 'hold', tenantId: 't1', key: kkey, itemId: 'burger' }));
  check('…only for something the menu says is held', r.status === 404, r.body);
  const friesTicket = (await all(`${T}/kdsTickets`)).find((t: any) => t.orderId === car3.orderId);
  r = await kitchen(req({ action: 'fromHold', tenantId: 't1', key: kkey, col: 'kdsTickets', id: friesTicket.id, binId: bin.id }));
  check('a ticket made from the batch: one taken from it, and the ticket ready', r.body.ok && r.body.left === 7 && (await get(`${T}/kdsTickets/${friesTicket.id}`)).status === 'ready' && (await get(`${T}/holdingBins/${bin.id}`)).quantity === 7, r.body);
  r = await kitchen(req({ action: 'fromHold', tenantId: 't1', key: kkey, col: 'kdsTickets', id: friesTicket.id, binId: bin.id }));
  check('…tapped again: nothing more taken', r.body.already === true && (await get(`${T}/holdingBins/${bin.id}`)).quantity === 7, r.body);
  await db.doc(`${T}/holdingBins/${bin.id}`).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }, { merge: true });
  r = await kitchen(req({ action: 'holdUse', tenantId: 't1', key: kkey, binId: bin.id, quantity: 1 }));
  check('nothing is taken from a batch past its time', r.status === 409 && /past its holding time/.test(r.body.error), r.body);
  r = await kitchen(req({ action: 'holdToss', tenantId: 't1', key: kkey, binId: bin.id }));
  const tossed = await get(`${T}/holdingBins/${bin.id}`);
  r = await kitchen(req({ action: 'tickets', tenantId: 't1', key: kkey }));
  check('thrown out: kept with how many, and counted in the day’s waste', tossed.status === 'tossed' && tossed.tossedQty === 7 && r.body.tossedToday === 7 && r.body.holds.length === 0, [tossed, r.body.tossedToday]);
  const nowMs = Date.now();
  const bins = [{ itemId: 'fries', quantity: 2, startedAt: new Date(nowMs - 60000).toISOString(), expiresAt: new Date(nowMs + 60000).toISOString(), status: 'held' as const },
    { itemId: 'fries', quantity: 8, startedAt: new Date(nowMs - 30000).toISOString(), expiresAt: new Date(nowMs + 400000).toISOString(), status: 'held' as const }];
  check('the batch to take from is the oldest still in time that has enough', H.binFor(bins, 'fries', 1, nowMs) === bins[0] && H.binFor(bins, 'fries', 3, nowMs) === bins[1] && H.binFor(bins, 'fries', 9, nowMs) === null);
  check('…and a batch says when it’s nearly done, then to throw it out', H.binState(bins[0], nowMs).state === 'soon' && H.binState(bins[1], nowMs).state === 'fresh' && H.binState(bins[0], nowMs + 61000).state === 'expired');
  check('a ticket’s time counts down, then says how far over it is', C.timeLeft(nowMs + 72000, nowMs).text === '1:12 left' && C.timeLeft(nowMs - 40000, nowMs).text === '0:40 over');

  console.log('voids, and stock');
  const car7 = (await P({ action: 'car', carKey: 'carkey-0007' })).body;
  await P({ action: 'add', orderId: car7.orderId, itemId: 'fries', tapKey: 'tap-00000030' });
  await P({ action: 'send', orderId: car7.orderId });
  const c3t = (await all(`${T}/kdsTickets`)).find((t: any) => t.orderId === car7.orderId);
  r = await kitchen(req({ action: 'act', tenantId: 't1', key: kkey, col: 'kdsTickets', id: c3t.id, step: 'cancel' }));
  check('the kitchen can’t cancel one ticket of a drive-thru order (it’s voided on the lane, as a whole)', r.status === 409 && /Void it on the drive-thru screen/.test(r.body.error), r.body);
  r = await P({ action: 'void', orderId: car7.orderId, reason: 'Drove off without paying' });
  check('the car drove off: voiding needs a manager’s PIN', r.status === 403 && r.body.needsManager === true, r.body);
  await db.doc(`${T}/staff/s9`).set({ name: 'Kai Park', role: 'stylist', isActive: true });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  const crew = null;
  const passOf = async (id: string, name: string) => { const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex'); const h = createHash('sha256').update(key).digest('hex');
    await db.doc(`kitchenScreens/${h}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id, name, exp: Date.now() + 3600000 } } }, { merge: true }); return pass; };
  passOfM = () => passOf('m9', 'Mo Diaz');
  r = await P({ action: 'void', orderId: car7.orderId, reason: 'Drove off without paying', staffPass: await passOf('s9', 'Kai Park') });
  check('…a team member who isn’t a manager can’t', r.status === 403 && r.body.needsManager === true, r.body);
  const friesBefore = (await get(`${T}/inventory/fries`)).totalStock;
  r = await P({ action: 'void', orderId: car7.orderId, reason: 'Drove off without paying', staffPass: await passOf('m9', 'Mo Diaz') });
  const v3 = await get(`${T}/counterOrders/${car7.orderId}`);
  check('…a manager voids it: kept with who and why, the car out of the lane, the kitchen stopped, and the fries not yet started back on the shelf',
    r.body.ok && r.body.returned === 1 && v3.status === 'voided' && v3.voidedBy === 'Mo Diaz' && v3.voidReason === 'Drove off without paying' && (await get(`${T}/driveThruCars/${car7.carId}`)).stage === 'gone'
    && (await get(`${T}/kdsTickets/${c3t.id}`)).status === 'cancelled' && (await get(`${T}/inventory/fries`)).totalStock === friesBefore + 1, { body: r.body, v3 });
  r = await P({ action: 'paid', orderId: car7.orderId, method: 'card' });
  check('…and a voided order can’t then be paid', r.status === 409, r.body);
  void crew;
  // Not enough left for the order: refused at sending, never sold below nothing.
  const car5 = (await P({ action: 'car', carKey: 'carkey-0005' })).body;
  await db.doc(`${T}/inventory/fries`).set({ totalStock: 1 }, { merge: true });
  await P({ action: 'add', orderId: car5.orderId, itemId: 'fries', quantity: 2, tapKey: 'tap-00000020' });
  r = await P({ action: 'send', orderId: car5.orderId });
  check('more than there is in stock is refused at sending, with how many are left', r.status === 409 && /Only 1 Fries left/.test(r.body.error), r.body);
  await db.doc(`${T}/inventory/fries`).set({ totalStock: 90 }, { merge: true });
  await P({ action: 'cancel', orderId: car5.orderId });
  const f5 = (await get(`${T}/inventory/fries`)).totalStock;
  r = await P({ action: 'void', orderId: car5.orderId, reason: 'Ordered by mistake', staffPass: await passOf('m9', 'Mo Diaz') });
  check('voiding an order that never went to the kitchen puts nothing back (it never took any)', r.body.ok && r.body.already === true && (await get(`${T}/inventory/fries`)).totalStock === f5, r.body);

  console.log('the menu’s kitchen timing');
  manager = true; signedIn = true;
  r = await menuApi(req({ action: 'save', tenantId: 't1', itemId: 'fries', item: { name: 'Fries', section: 'Sides', price: 2.5, choices: [], makeSeconds: 90, holdMinutes: 10, batchSize: 12 } }));
  check('a manager sets how long it takes to make, and that it’s held 10 minutes in batches of 12', r.body.ok && r.body.item.makeSeconds === 90 && r.body.item.holdMinutes === 10 && r.body.item.batchSize === 12, r.body);
  r = await menuApi(req({ action: 'save', tenantId: 't1', itemId: 'fries', item: { name: 'Fries', section: 'Sides', price: 2.5, choices: [], makeSeconds: 5 } }));
  check('…a make time under 10 seconds is refused', r.status === 400, r.body);
  r = await menuApi(req({ action: 'targets', tenantId: 't1', targets: { 'drive-thru': 180 } }));
  const tl: any = await menuApi(req({ action: 'list', tenantId: 't1' }));
  check('the drive-thru’s target set to 3:00, and the others kept', r.body.ok && r.body.targets['drive-thru'] === 180 && tl.body.targets.counter === 300, [r.body, tl.body.targets]);
  r = await menuApi(req({ action: 'targets', tenantId: 't1', targets: { 'drive-thru': 20 } }));
  check('…never under a minute', r.status === 400 && (await get(T)).kitchenSettings.targets['drive-thru'] === 180, r.body);
  manager = false;
  r = await menuApi(req({ action: 'targets', tenantId: 't1', targets: { 'drive-thru': 120 } }));
  check('…only a manager sets it', r.status === 403);

  console.log('recipes: a made-to-order item is counted by its ingredients');
  manager = true; signedIn = true;
  await db.doc(`${T}/inventory/patty`).set({ type: 'professional', name: 'Patties', totalStock: 3, unit: 'units' });
  await db.doc(`${T}/inventory/grill`).set({ type: 'equipment', name: 'Grill', totalStock: 1 });
  await db.doc(`${T}/inventory/sauce`).set({ type: 'professional', name: 'Sauce', totalStock: 0, costingMethod: 'size', containerSize: 0 });
  await db.doc(`${T}/inventory/wrap`).set({ type: 'refreshment', name: 'Wrap', category: 'Food', price: 7, totalStock: 0 });
  await db.doc(`${T}/inventory/oldbun`).set({ type: 'retail', name: 'Old buns', totalStock: 40, archived: true });
  let ml: any = await menuApi(req({ action: 'list', tenantId: 't1' }));
  let wrapM = ml.body.menu.find((m: any) => m.id === 'wrap');
  check('an item with no recipe and none of its own is “None in stock”', wrapM && wrapM.inStock === false && wrapM.short === null && wrapM.byRecipe === false && (await import('../../src/lib/menu-stock')).outWords(wrapM) === 'None in stock', wrapM);
  r = await menuApi(req({ action: 'ingredients', tenantId: 't1' }));
  const ingIds = (r.body.ingredients || []).map((x: any) => x.id);
  check('what a recipe can use: the business’s stock with what’s left, never equipment, an archived item, or cost', r.body.ok && ingIds.includes('patty') && ingIds.includes('bun') && !ingIds.includes('grill') && !ingIds.includes('oldbun')
    && r.body.ingredients.find((x: any) => x.id === 'patty').left === 3 && !JSON.stringify(r.body).includes('cost'), r.body);
  const wrapSave = (recipe: any) => menuApi(req({ action: 'save', tenantId: 't1', itemId: 'wrap', item: { name: 'Wrap', section: 'Food', price: 7, choices: [], recipe } }));
  r = await wrapSave([{ id: 'patty', quantityUsed: 1 }, { id: 'bun', quantityUsed: 2 }, { id: 'patty', quantityUsed: 0.5 }]);
  const wrapDoc = await get(`${T}/inventory/wrap`);
  check('a manager gives it a recipe: one line an ingredient (the same one twice is added up), named and measured from stock', r.body.ok && wrapDoc.formula.length === 2 && wrapDoc.formula[0].id === 'patty' && wrapDoc.formula[0].quantityUsed === 1.5
    && wrapDoc.formula[0].name === 'Patties' && wrapDoc.formula[0].unit === 'each' && r.body.recipe.length === 2, { body: r.body, f: wrapDoc.formula });
  check('…and it’s available with none of its own: enough for 2 (3 patties at 1.5 each)', r.body.item.inStock === true && r.body.item.byRecipe === true && r.body.item.canMake === 2, r.body.item);
  ml = await menuApi(req({ action: 'list', tenantId: 't1' }));
  check('the menu list gives each item’s recipe for the editor', ml.body.recipes.wrap?.length === 2 && ml.body.recipes.burger?.length === 1, ml.body.recipes);
  for (const [bad, why] of [[[{ id: 'grill', quantityUsed: 1 }], 'equipment'], [[{ id: 'wrap', quantityUsed: 1 }], 'itself'], [[{ id: 'burger', quantityUsed: 1 }], 'a menu item with its own recipe'],
    [[{ id: 'nope', quantityUsed: 1 }], 'something not in stock'], [[{ id: 'patty', quantityUsed: 0 }], 'no amount'], [Array.from({ length: 21 }, (_, k) => ({ id: `p${k}`, quantityUsed: 1 })), 'more than 20 lines']] as [any, string][]) {
    r = await wrapSave(bad);
    check(`a recipe with ${why} is refused, and the recipe kept as it was`, (r.status === 400 || r.status === 409) && (await get(`${T}/inventory/wrap`)).formula.length === 2, r.body);
  }
  manager = false;
  r = await wrapSave([]);
  check('…only a manager changes a recipe', r.status === 403 && (await get(`${T}/inventory/wrap`)).formula.length === 2);
  manager = true;
  r = await menuApi(req({ action: 'save', tenantId: 't1', itemId: 'wrap', item: { name: 'Wrap', section: 'Food', price: 7.5, choices: [] } }));
  check('saving without the recipe leaves it as it is', r.body.ok && (await get(`${T}/inventory/wrap`)).formula.length === 2 && r.body.item.price === 7.5, r.body);
  const carR = (await P({ action: 'car', carKey: 'carkey-0021' })).body;
  await P({ action: 'add', orderId: carR.orderId, itemId: 'wrap', quantity: 3, tapKey: 'tap-00000041' });
  r = await P({ action: 'send', orderId: carR.orderId });
  check('more than the ingredients make is refused at sending, naming the one that’s short', r.status === 409 && /Not enough Patties for this order \(3 each left\)/.test(r.body.error), r.body);
  await P({ action: 'qty', orderId: carR.orderId, lineId: (await get(`${T}/counterOrders/${carR.orderId}`)).lines[0].lineId, quantity: 1, tapKey: 'tap-00000042' });
  r = await P({ action: 'send', orderId: carR.orderId });
  const afterR = await get(`${T}/counterOrders/${carR.orderId}`);
  check('one wrap goes: its ingredients taken (1.5 patties, 2 buns), its own count left alone', r.body.ok && (await get(`${T}/inventory/patty`)).totalStock === 1.5 && (await get(`${T}/inventory/wrap`)).totalStock === 0
    && JSON.stringify(afterR.itemsTaken) === '[]', { body: r.body, patty: await get(`${T}/inventory/patty`), o: afterR });
  let laneR: any = await P({ action: 'lane' });
  let wrapL = laneR.body.menu.find((m: any) => m.id === 'wrap');
  check('…and with 1.5 patties left, one more can be made: the lane shows it', wrapL.inStock === true && wrapL.canMake === 1, wrapL);
  await db.doc(`${T}/inventory/patty`).set({ totalStock: 1 }, { merge: true });
  laneR = await P({ action: 'lane' });
  wrapL = laneR.body.menu.find((m: any) => m.id === 'wrap');
  check('an ingredient run short: the item is out, named for it (“Out of Patties”), not switched to sold out', wrapL.inStock === false && wrapL.soldOut === false && wrapL.short === 'Patties' && (await import('../../src/lib/menu-stock')).outWords(wrapL) === 'Out of Patties', wrapL);
  await db.doc(`${T}/inventory/patty`).set({ totalStock: 0, costingMethod: 'size', containerSize: 0 }, { merge: true });
  laneR = await P({ action: 'lane' });
  check('an ingredient that can’t be counted (no size set) never holds it back', laneR.body.menu.find((m: any) => m.id === 'wrap').inStock === true, laneR.body.menu.find((m: any) => m.id === 'wrap'));
  await db.doc(`${T}/inventory/patty`).set({ totalStock: 3, costingMethod: null, containerSize: null }, { merge: true });
  // A void puts back the ingredients, and only the counts that were taken.
  const pattyBefore = (await get(`${T}/inventory/patty`)).totalStock; const wrapBefore = (await get(`${T}/inventory/wrap`)).totalStock;
  r = await P({ action: 'void', orderId: carR.orderId, reason: 'Drove off without paying', staffPass: await passOfM() });
  check('voided before it was started: the patties back, and the wrap’s own count untouched (it was never taken)', r.body.ok && (await get(`${T}/inventory/patty`)).totalStock === pattyBefore + 1.5 && (await get(`${T}/inventory/wrap`)).totalStock === wrapBefore, { body: r.body, p: await get(`${T}/inventory/patty`), w: await get(`${T}/inventory/wrap`) });
  // An ingredient that's also sold on its own line (a bottled sauce): its own count and the recipe's share both come off,
  // in one step, and a void puts both back.
  await db.doc(`${T}/inventory/sauce2`).set({ type: 'refreshment', name: 'Hot sauce', category: 'Sides', price: 1, totalStock: 5, unit: 'units' });
  await db.doc(`${T}/inventory/taco`).set({ type: 'refreshment', name: 'Taco', category: 'Food', price: 4, totalStock: 0 });
  r = await menuApi(req({ action: 'save', tenantId: 't1', itemId: 'taco', item: { name: 'Taco', section: 'Food', price: 4, choices: [], recipe: [{ id: 'sauce2', quantityUsed: 1 }] } }));
  check('a menu item counted by itself can go into another’s recipe', r.body.ok && r.body.item.canMake === 5, r.body);
  r = await menuApi(req({ action: 'save', tenantId: 't1', itemId: 'sauce2', item: { name: 'Hot sauce', section: 'Sides', price: 1, choices: [], recipe: [{ id: 'bun', quantityUsed: 1 }] } }));
  check('…and then it can’t have a recipe of its own (it’s counted by itself)', r.status === 409 && /goes into Taco’s recipe/.test(r.body.error) && !(await get(`${T}/inventory/sauce2`)).formula, r.body);
  const carT = (await P({ action: 'car', carKey: 'carkey-0022' })).body;
  await P({ action: 'add', orderId: carT.orderId, itemId: 'taco', quantity: 3, tapKey: 'tap-00000051' });
  await P({ action: 'add', orderId: carT.orderId, itemId: 'sauce2', quantity: 3, tapKey: 'tap-00000052' });
  r = await P({ action: 'send', orderId: carT.orderId });
  check('3 tacos and 3 sauces need 6 sauces: with 5, it’s refused, naming the sauce', r.status === 409 && /Not enough Hot sauce for this order \(2 each left\)/.test(r.body.error) && (await get(`${T}/inventory/sauce2`)).totalStock === 5, r.body);
  await P({ action: 'qty', orderId: carT.orderId, lineId: (await get(`${T}/counterOrders/${carT.orderId}`)).lines[0].lineId, quantity: 2, tapKey: 'tap-00000053' });
  r = await P({ action: 'send', orderId: carT.orderId });
  const oT = await get(`${T}/counterOrders/${carT.orderId}`);
  const sauceLog = (await all(`${T}/stockCorrections`)).filter((x: any) => x.refId === carT.orderId && x.productId === 'sauce2');
  check('2 tacos and 3 sauces: all 5 sauces come off, logged as 3 sold and 2 used, each line’s take kept', r.body.ok && (await get(`${T}/inventory/sauce2`)).totalStock === 0
    && sauceLog.some((x: any) => x.type === 'sold' && x.change === -3) && sauceLog.some((x: any) => x.type === 'used' && x.change === -2)
    && oT.stockTaken[oT.lines[0].lineId].parts.sauce2 === 2 && oT.stockTaken[oT.lines[1].lineId].own === 3, { body: r.body, s: await get(`${T}/inventory/sauce2`), sauceLog, st: oT.stockTaken });
  r = await P({ action: 'void', orderId: carT.orderId, reason: 'Drove off without paying', staffPass: await passOfM() });
  check('…voided before it was started: all 5 back, logged as returned', r.body.ok && (await get(`${T}/inventory/sauce2`)).totalStock === 5
    && (await all(`${T}/stockCorrections`)).filter((x: any) => x.refId === carT.orderId && x.type === 'returned' && x.productId === 'sauce2').reduce((n: number, x: any) => n + x.change, 0) === 5, { body: r.body, s: await get(`${T}/inventory/sauce2`) });
  // An ingredient that's put away isn't counted, and isn't taken.
  await db.doc(`${T}/inventory/sauce2`).set({ archived: true }, { merge: true });
  laneR = await P({ action: 'lane' });
  check('an ingredient put away no longer holds an item back', laneR.body.menu.find((m: any) => m.id === 'taco')?.inStock === true, laneR.body.menu.find((m: any) => m.id === 'taco'));
  await db.doc(`${T}/inventory/sauce2`).set({ archived: false }, { merge: true });
  // Switched to sold out still wins, whatever the stock.
  await db.doc(`${T}/inventory/wrap`).set({ soldOut: true }, { merge: true });
  laneR = await P({ action: 'lane' });
  check('switched to sold out, it says “Sold out”', (await import('../../src/lib/menu-stock')).outWords(laneR.body.menu.find((m: any) => m.id === 'wrap')) === 'Sold out');
  await db.doc(`${T}/inventory/wrap`).set({ soldOut: false }, { merge: true });

  console.log('spots, a long line, and the slow part right now');
  manager = true; signedIn = true;
  r = await P({ action: 'lane' });
  check('four pull-forward spots until the business says otherwise, and the lane knows what a long line is', r.body.settings?.spots === 4 && r.body.stats.rushAt === 6 && typeof r.body.stats.recent?.count === 'number', [r.body.settings, r.body.stats]);
  r = await menuApi(req({ action: 'laneSettings', tenantId: 't1', spots: 6 }));
  const bad0: any = await menuApi(req({ action: 'laneSettings', tenantId: 't1', spots: 0 }));
  const bad9: any = await menuApi(req({ action: 'laneSettings', tenantId: 't1', spots: 9 }));
  const badT: any = await menuApi(req({ action: 'laneSettings', tenantId: 't1', spots: true }));
  check('a manager sets how many spots there are (1 to 8)', r.body.ok && (await get(T)).driveThru.spots === 6 && bad0.status === 400 && bad9.status === 400 && badT.status === 400, [r.body, bad0.body]);
  manager = false;
  r = await menuApi(req({ action: 'laneSettings', tenantId: 't1', spots: 2 }));
  check('…only a manager', r.status === 403 && (await get(T)).driveThru.spots === 6);
  signedIn = false;
  r = await P({ action: 'lane' });
  check('…and the lane offers that many', r.body.settings.spots === 6);
  // Three cars handed over in the last half hour, each waiting two minutes at the window.
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now() - (10 + i) * 60000; const at = (sec: number) => new Date(t0 + sec * 1000).toISOString();
    await db.doc(`${T}/driveThruCars/recent${i}`).set({ id: `recent${i}`, number: `R${i}`, stage: 'gone', arrivedAt: at(0), stageAt: { speaker: at(0), pay: at(40), pickup: at(70) }, goneAt: at(190), day: 'x' });
  }
  const carS = (await P({ action: 'car', carKey: 'carkey-spots' })).body;   // (a new car: today's numbers are worked out again)
  r = await P({ action: 'lane' });
  check('the last half hour on its own says which part is slow right now (here, at the window)', r.body.stats.recent.count >= 3 && r.body.stats.recent.atWindow > r.body.stats.recent.ordering && r.body.stats.recent.atWindow > r.body.stats.recent.toWindow, r.body.stats.recent);
  await P({ action: 'add', orderId: carS.orderId, itemId: 'fries', quantity: 1, tapKey: 'spots-tap-1' });
  await P({ action: 'send', orderId: carS.orderId });
  await P({ action: 'paid', orderId: carS.orderId, method: 'card' });
  r = await P({ action: 'move', carId: carS.carId, to: 'forward', spot: '7' });
  check('a spot the business doesn’t have is refused (the car stays where it is, so it’s never parked with no number)', r.status === 409 && /isn’t there anymore/.test(r.body.error) && (await get(`${T}/driveThruCars/${carS.carId}`)).stage === 'pickup', r.body);
  await db.doc(`${T}/driveThruCars/parked3`).set({ id: 'parked3', number: 'P3', stage: 'forward', spot: '3', arrivedAt: new Date().toISOString(), stageAt: {}, day: 'x' });
  r = await P({ action: 'move', carId: carS.carId, to: 'forward', spot: '3' });
  check('…and a spot another car is in is refused too (two tablets never park two cars in one spot)', r.status === 409 && /Spot 3 has car P3/.test(r.body.error) && (await get(`${T}/driveThruCars/${carS.carId}`)).stage === 'pickup', r.body);
  r = await P({ action: 'move', carId: carS.carId, to: 'forward', spot: '5' });
  check('…a free one is kept', r.body.ok && (await get(`${T}/driveThruCars/${carS.carId}`)).spot === '5', r.body);
  await db.doc(`${T}/driveThruCars/parkedOld`).set({ id: 'parkedOld', number: 'OLD', stage: 'forward', spot: '4', arrivedAt: new Date(Date.now() - 30 * 3600000).toISOString(), stageAt: {}, day: 'old' });
  const carU = (await P({ action: 'car', carKey: 'carkey-spots-2' })).body;
  await P({ action: 'add', orderId: carU.orderId, itemId: 'fries', quantity: 1, tapKey: 'spots-tap-2' });
  await P({ action: 'send', orderId: carU.orderId }); await P({ action: 'paid', orderId: carU.orderId, method: 'card' });
  r = await P({ action: 'move', carId: carU.carId, to: 'forward', spot: '4' });
  check('…and a car left parked from yesterday doesn’t hold its spot', r.body.ok && (await get(`${T}/driveThruCars/${carU.carId}`)).spot === '4', r.body);
  await db.doc(`${T}/driveThruCars/parkedOld`).set({ stage: 'gone', goneAt: new Date().toISOString(), left: true }, { merge: true });
  // A car left behind yesterday is still in the lane, but isn't part of a long line now.
  for (let i = 0; i < 6; i++) await db.doc(`${T}/driveThruCars/stale${i}`).set({ id: `stale${i}`, number: `S${i}`, stage: 'speaker', arrivedAt: new Date(Date.now() - 30 * 3600000).toISOString(), stageAt: {}, day: 'old' });
  r = await P({ action: 'lane' });
  check('cars left behind from yesterday don’t make the lane say it’s busy', r.body.stats.inLane >= 6 && r.body.stats.inLineNow < 6, [r.body.stats.inLane, r.body.stats.inLineNow]);
  for (let i = 0; i < 6; i++) await db.doc(`${T}/driveThruCars/stale${i}`).set({ stage: 'gone', goneAt: new Date().toISOString(), left: true }, { merge: true });

  console.log('taking orders in line');
  manager = true; signedIn = true;
  for (const c of await all(`${T}/driveThruCars`)) if (c.stage !== 'gone') await db.doc(`${T}/driveThruCars/${c.id}`).set({ stage: 'gone', goneAt: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  const atSpeaker = (await P({ action: 'car', carKey: 'carkey-spk-1' })).body;
  await P({ action: 'add', orderId: atSpeaker.orderId, itemId: 'fries', tapKey: 'tap-line-0' });
  r = await P({ action: 'car', carKey: 'carkey-line-1', inLine: true, looks: '  Red   SUV <b>' });
  const lc = r.body;
  const lcar = await get(`${T}/driveThruCars/${lc.carId}`);
  check('a car taken in line: marked so, with how it looks (cleaned)', r.body.ok && lcar.inLine === true && lcar.looks === 'Red SUV b' && lcar.stage === 'speaker', lcar);
  r = await P({ action: 'lane' });
  const lrow = r.body.cars.find((c: any) => c.id === lc.carId);
  check('…the lane shows it in line, by how it looks', lrow?.inLine === true && lrow.looks === 'Red SUV b', lrow);
  await P({ action: 'add', orderId: lc.orderId, itemId: 'fries', quantity: 2, tapKey: 'tap-line-1' });
  r = await POST(req({ tenantId: 't1', key: bkey, action: 'board' }));
  check('the order board by the speaker never shows a car ordering in line (it shows the car at the speaker)', r.body.order?.number === atSpeaker.number, r.body.order);
  r = await P({ action: 'looks', carId: lc.carId, looks: 'Blue Truck' });
  check('how it looks can be changed', r.body.ok && (await get(`${T}/driveThruCars/${lc.carId}`)).looks === 'Blue Truck', r.body);
  r = await P({ action: 'here', carId: lc.carId });
  check('“It’s here” waits until its order is with the kitchen (still being taken in line, it stays with that person)', r.status === 409 && (await get(`${T}/driveThruCars/${lc.carId}`)).inLine === true, r.body);
  await P({ action: 'send', orderId: lc.orderId });
  r = await P({ action: 'paid', orderId: lc.orderId, method: 'cash', tendered: 10, pouch: true });
  check('cash into a pouch needs the person’s PIN (it’s counted as theirs)', r.status === 403 && r.body.needsStaff === true, r.body);
  const kaiPass = await passOfM();
  const drawerBefore = (await get(`${T}/tillSessions/d1`))?.expectedCash;
  r = await P({ action: 'paid', orderId: lc.orderId, method: 'cash', tendered: 10, pouch: true, staffPass: kaiPass });
  const lo2 = await get(`${T}/counterOrders/${lc.orderId}`);
  check('paid in cash in line: into their pouch (not the drawer), with the change, and the car goes straight on to pick up', r.body.ok && r.body.inPouch === true && r.body.change === 4.5 && lo2.cashInPouch === true && lo2.cashWithId === 'm9'
    && (await get(`${T}/tillSessions/d1`))?.expectedCash === drawerBefore && (await get(`${T}/driveThruCars/${lc.carId}`)).stage === 'pickup', { body: r.body, lo2 });
  r = await P({ action: 'pouch', staffPass: kaiPass });
  check('their pouch today: what they took, and from how many orders', r.body.ok && r.body.total === 5.5 && r.body.count === 1 && r.body.name === 'Mo Diaz', r.body);
  r = await P({ action: 'pouch' });
  check('…nobody signed in: no pouch', r.body.ok && r.body.name === null && r.body.total === 0, r.body);
  // The windows don't see it until it gets there.
  const wkey2 = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window screen', kind: 'drive-thru-board' }))).body.key;
  const win = (at: string) => POST(req({ tenantId: 't1', key: wkey2, action: 'window', at }));
  await P({ action: 'send', orderId: atSpeaker.orderId });
  r = await win('one');
  check('paid in line, still back in the line: the window screen shows the car really at the window', r.body.show?.number === atSpeaker.number, r.body.show);
  r = await win('pickup');
  check('…and the pickup window doesn’t call it up yet', r.body.show === null, r.body.show);
  r = await P({ action: 'here', carId: lc.carId });
  const lcar2 = await get(`${T}/driveThruCars/${lc.carId}`);
  r = await win('pickup');
  check('“It’s here” at the window: now it’s a car at the window like any other', lcar2.inLine === false && lcar2.wasInLine === true && r.body.show?.number === lc.number && r.body.show.mode === 'paid', { lcar2, show: r.body.show });
  r = await P({ action: 'paid', orderId: atSpeaker.orderId, method: 'cash', tendered: 5, pouch: true, staffPass: kaiPass });
  check('a pouch is only for a car taken in line', r.status === 409 && /only for a car taken in line/.test(r.body.error), r.body);
  // Handed in: the pouch goes into the drawer, once.
  await db.doc(`${T}/tillSessions/d1`).set({ status: 'open' }, { merge: true });
  const drawerNow = num0((await get(`${T}/tillSessions/d1`)).expectedCash);
  r = await P({ action: 'handIn' });
  check('handing in needs the person’s PIN (it’s their pouch)', r.status === 403 && r.body.needsStaff === true, r.body);
  r = await P({ action: 'handIn', staffPass: kaiPass });
  const after = await get(`${T}/counterOrders/${lc.orderId}`);
  check('handed in: the pouch’s cash goes into the open drawer, once, and the pouch is empty', r.body.ok && r.body.handedIn === 5.5 && num0((await get(`${T}/tillSessions/d1`)).expectedCash) === drawerNow + 5.5
    && after.pouchOpen === false && after.tillId === 'd1' && (await P({ action: 'pouch', staffPass: kaiPass })).body.total === 0, { body: r.body, after });
  r = await P({ action: 'handIn', staffPass: kaiPass });
  check('…handed in again: nothing more', r.body.ok && r.body.count === 0 && num0((await get(`${T}/tillSessions/d1`)).expectedCash) === drawerNow + 5.5, r.body);

  console.log('the pages');
  {
    const lanePage = src('src/app/drive-thru/[tenantId]/page.tsx');
    check('each tablet can be set to its spot (taking orders, pay window, pickup window, runner) and opens on the car there', lanePage.includes('This screen is at') && lanePage.includes("['runner', 'Runner',") && lanePage.includes('const ROLE_STAGE') && lanePage.includes("role === 'runner' ? cars.filter((c) => c.stage === 'forward')"));
    check('a long line and the slow part right now are said on the lane; a spot that’s taken can’t be picked twice', lanePage.includes('Busy: {st.inLineNow ?? st.inLane} cars in the lane.') && lanePage.includes('Slower right now:') && lanePage.includes('aria-disabled={!!there}') && lanePage.includes('x.now >= x.day * 1.25'));
  }
  const lane = src('src/app/drive-thru/[tenantId]/page.tsx'), board = src('src/app/drive-thru/[tenantId]/board/page.tsx'), setup = src('src/components/drive-thru/ScreenSetup.tsx'), kds = src('src/app/kds/[tenantId]/page.tsx'), menuPage = src('src/app/(app)/menu/page.tsx'), pin = src('src/components/kitchen/PinPad.tsx');
  check('the lane and the board read no database themselves (only the server)', !/from ['"]firebase\/firestore|useCollection|getDocs|onSnapshot/.test(lane + board + setup));
  check('the lane: one tap for a car, choices on the shared picker, the order read back, card or cash with the change, pull forward to a spot', lane.includes("action: 'car', carKey") && lane.includes('<ChoicePicker') && lane.includes('readBack(order!.lines)')
    && lane.includes("paid('cash', cash)") && /move\('forward', s\)/.test(lane) && lane.includes('tapKey: keyFor(sig)'));
  check('a manager’s one-off PIN for a void is what’s sent, never replaced by whoever is working', lane.includes("JSON.stringify({ tenantId, key, ...(staff ? { staffPass: staff.pass } : {}), ...body })"));
  check('the board goes back to its welcome when it loses touch, rather than show an old order', /STALE_MS/.test(board) && board.includes('const o = fresh ? board?.order || null : null;'));
  check('the kitchen screen: drive-thru first, countdowns, by order, holding', kds.includes('.sort(kitchenOrder)') && kds.includes("['order', 'By order']") && kds.includes('<HoldingStrip') && kds.includes('Take from holding'));
  const ui = [lane, board, setup, pin, menuPage].join('\n');
  const strings = ui.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1|>[^<>{}\n]+</g)?.join('\n') || '';
  const banned = [['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join(''));
  check('writing rules: no all-caps, no emoji or check marks, no JSX comments, no business-type words, no tool names', !/\buppercase\b|font-black/.test(ui) && !/[\u{1F300}-\u{1FAFF}✓✔✅]/u.test(ui)
    && !/\{\/\*/.test(ui) && !/\b(studio|salon|stylist|booth|chair)s?\b/i.test(strings) && !new RegExp(banned.join('|'), 'i').test(ui), strings.match(/\b(studio|salon|stylist|booth|chair)s?\b/gi));
  check('buttons are 44px or more, and white is solid (never the see-through bg-white)', !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(ui) && !/\bbg-white\b/.test(lane + board + setup + pin));
  check('the drive-thru is in the menu of screens, and part of Lounge & hospitality', src('src/components/shared/AppSidebar.tsx').includes("href: '/drive-thru'") && src('src/lib/modules.ts').includes("'/drive-thru'"));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
