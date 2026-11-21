// Checks delivery app orders keyed in at the counter, and the pickup shelf (design board "Delivery app orders";
// lib/app-orders, lib/app-orders-server, api/counter appStart / appSend / appCancel and move gone, lib/counter-server
// payOrder 'app', lib/ready-board, api/menu 'apps').
// - Turned on by a manager on the Menu page: which apps (and another by name), the shelf's spots.
// - Rung in at the counter from the same menu; sent with the app and its code (once a day), to go, ready for the
//   courier, with the next free shelf spot; no sales tax added (the app collects it).
// - The kitchen ticket and the ready board say the app, the code and the spot.
// - Picked up by the courier: in the books as that app's sale (no tax line, nothing in the drawer); never paid by cash or
//   card at the counter.
// - Cancelled on the app: voided, what the kitchen hadn't started put back, nothing in the books, the code free again;
//   anyone before the kitchen starts on it, a manager's okay after. A manager's void does the same for the shelf and code.
// - The code and the shelf spot are taken together and let go if the kitchen can't take it; a spot being sent is taken.
// - The night after: old codes cleared, and an order still waiting from an earlier day told to the managers once.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/app-orders.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') { class StripeMock { paymentIntents = { create: async () => ({ id: 'pi_x' }), retrieve: async () => ({ id: 'pi_x' }) }; refunds = { create: async () => ({}) }; } return Object.assign(StripeMock, { default: StripeMock }); }
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const A = await import('../../src/lib/app-orders');
  console.log('the rules');
  check('the apps: the business’s picks, in order, and another by its name', JSON.stringify(A.appOrdersOf({ appOrders: { on: true, apps: ['grubhub', 'doordash', 'other'], otherName: '  Local  Eats ' } }).apps) === JSON.stringify([{ code: 'doordash', label: 'DoorDash' }, { code: 'grubhub', label: 'Grubhub' }, { code: 'other', label: 'Local Eats' }]));
  check('…off, or with no app picked, is off; the shelf 8 spots unless one of the choices', !A.appOrdersOf({ appOrders: { on: true, apps: [] } }).on && !A.appOrdersOf({ appOrders: { on: false, apps: ['doordash'] } }).on && A.appOrdersOf({ appOrders: { on: true, apps: ['doordash'], shelves: 5 } }).shelves === 8 && A.appOrdersOf({ appOrders: { shelves: 12 } }).shelves === 12);
  check('an app’s order code: tidied to letters, numbers and dashes', A.cleanAppCode(' #4f2a ') === '4F2A' && A.cleanAppCode('ab-12') === 'AB-12' && A.cleanAppCode('x') === null && A.cleanAppCode('4F2A!') === null && A.cleanAppCode('ABCDEFGHIJKLM') === null);
  check('the next free shelf spot (none when every spot is taken)', A.freeShelf(['A1', 'A3'], 4) === 'A2' && A.freeShelf(['A1', 'A2'], 2) === null && A.freeShelf([], 4) === 'A1');
  check('when the courier is due: now or in 10, 20 or 30 minutes', A.courierDue(0, 10) === new Date(600000).toISOString() && A.courierDue(0, 0) === new Date(0).toISOString() && A.courierDue(0, 15) === null);

  await db.doc(T).set({ name: 'Corner Cafe', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', job: 'manager' });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Food', price: 11.5, totalStock: 50, makeSeconds: 300, station: 'Grill' });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 5.5, totalStock: 40, makeSeconds: 120, station: 'Fryer' });
  const { POST } = await import('../../src/app/api/counter/route');
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  const P = (b: any) => POST(req({ tenantId: 't1', channel: 'counter', ...b }));
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b }));

  console.log('turning it on');
  let r: any = await P({ action: 'appStart', carKey: 'a0' });
  check('off: no app orders at the counter', r.status === 409 && /aren’t on/.test(r.body.error), r.body);
  r = await Mn({ action: 'apps', on: true });
  check('on needs an app picked first', r.status === 400 && /at least one app/.test(r.body.error), r.body);
  r = await Mn({ action: 'apps', apps: ['other'] });
  check('another app needs its name', r.status === 400 && /other app’s name/.test(r.body.error), r.body);
  r = await Mn({ action: 'apps', apps: ['doordash', 'ubereats', 'zoom'] });
  check('only the apps on the list', r.status === 400, r.body);
  manager = false; r = await Mn({ action: 'apps', on: true, apps: ['doordash'] }); manager = true;
  check('only a manager sets it up', r.status === 403, r.body);
  r = await Mn({ action: 'apps', on: true, apps: ['doordash', 'ubereats'], shelves: 4 });
  check('on, with DoorDash and Uber Eats and a 4-spot shelf', r.body.ok && r.body.apps.on && r.body.apps.apps.join() === 'doordash,ubereats' && r.body.apps.shelves === 4, r.body);
  r = await Mn({ action: 'list' });
  check('…the Menu page reads it back', r.body.apps?.on === true && r.body.apps.shelves === 4, r.body.apps);
  let lane: any = (await P({ action: 'lane' })).body;
  check('…the counter is offered the apps', JSON.stringify(lane.apps) === JSON.stringify([{ code: 'doordash', label: 'DoorDash' }, { code: 'ubereats', label: 'Uber Eats' }]), lane.apps);
  r = await POST(req({ tenantId: 't1', action: 'appStart', carKey: 'dt' }));
  check('only at the counter (not the drive-thru’s screen)', r.status === 409, r.body);

  console.log('rung in and sent');
  r = await P({ action: 'appStart', carKey: 'a1' }); const a1 = r.body;
  check('an app order: a counter order, marked as the app’s', r.body.ok && /^C\d+$/.test(a1.number) && (await get(`${T}/counterOrders/${a1.orderId}`)).app?.state === 'taking', r.body);
  await P({ action: 'add', orderId: a1.orderId, itemId: 'burger', quantity: 2, tapKey: 't1' });
  await P({ action: 'add', orderId: a1.orderId, itemId: 'fries', tapKey: 't2' });
  await P({ action: 'name', orderId: a1.orderId, name: 'Maya J' });
  r = await P({ action: 'appSend', orderId: a1.orderId, app: 'grubhub', code: '4F2A', courierIn: 10 });
  const noApp = r;
  r = await P({ action: 'appSend', orderId: a1.orderId, app: 'doordash', code: '!', courierIn: 10 });
  const noCode = r;
  r = await P({ action: 'appSend', orderId: a1.orderId, app: 'doordash', code: '4F2A', courierIn: 15 });
  check('the app, a code and a courier time from the choices are needed', noApp.status === 400 && noCode.status === 400 && r.status === 400, [noApp.body, noCode.body, r.body]);
  const before = Date.now();
  r = await P({ action: 'appSend', orderId: a1.orderId, app: 'doordash', code: '#4f2a', courierIn: 10 });
  const o1 = await get(`${T}/counterOrders/${a1.orderId}`); const car1 = await get(`${T}/driveThruCars/${a1.carId}`);
  check('sent: to the kitchen to go, ready for the courier, shelf A1', r.body.ok && r.body.name === 'DoorDash 4F2A' && r.body.shelf === 'A1' && o1.status === 'sent' && o1.toGo === true && o1.app.state === 'waiting' && o1.app.code === '4F2A'
    && Math.abs(Date.parse(o1.dueAt) - (before + 600000)) < 5000, { body: r.body, app: o1.app, due: o1.dueAt });
  check('…no sales tax added: the app collects it', o1.subtotal === 28.5 && o1.tax === 0 && o1.total === 28.5, { s: o1.subtotal, t: o1.tax, total: o1.total });
  check('…waiting at the counter for its courier, not for payment', car1.stage === 'pickup' && car1.app?.code === '4F2A' && !o1.paidAt, car1);
  const t1 = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === a1.orderId);
  check('…the kitchen ticket says the app, the code and the shelf spot', t1.length === 2 && t1.every((t: any) => t.stationName === 'DoorDash 4F2A, shelf A1'), t1.map((t: any) => t.stationName));
  check('…nothing in the books yet', !(await get(`${T}/transactions/counter_${a1.orderId}`)));
  r = await P({ action: 'appSend', orderId: a1.orderId, app: 'doordash', code: '4F2A', courierIn: 10 });
  check('…tapped again: the same order', r.body.ok && r.body.already === true, r.body);
  check('…its code kept for the day, where only the server reads it', (await get(`${T}/private/appCode_${o1.day}_doordash_4F2A`))?.orderId === a1.orderId && !(await get(`${T}/appOrderCodes/${o1.day}_doordash_4F2A`)));
  r = await P({ action: 'appStart', carKey: 'a2' }); const a2 = r.body;
  await P({ action: 'add', orderId: a2.orderId, itemId: 'fries', tapKey: 't3' });
  r = await P({ action: 'appSend', orderId: a2.orderId, app: 'doordash', code: '4F2A', courierIn: 0 });
  check('the same DoorDash code again today: said, as the order it already is', r.status === 409 && new RegExp(`DoorDash 4F2A is already in, as ${a1.number}`).test(r.body.error), r.body);
  r = await P({ action: 'appSend', orderId: a2.orderId, app: 'ubereats', code: '4F2A', courierIn: 0 });
  check('…the same code from another app is its own order, on the next spot', r.body.ok && r.body.shelf === 'A2' && r.body.name === 'Uber Eats 4F2A', r.body);
  r = await P({ action: 'paid', orderId: a1.orderId, method: 'cash' });
  check('an app order isn’t paid by cash or card at the counter', r.status === 409 && /paid on the app/.test(r.body.error), r.body);

  console.log('the counter and the ready board');
  lane = (await P({ action: 'lane' })).body;
  const v1 = lane.orders[a1.orderId];
  check('the counter: the app, the code, its spot and when the courier is due', v1.app?.label === 'DoorDash' && v1.app.code === '4F2A' && v1.app.shelf === 'A1' && !!v1.app.courierAt && lane.cars.some((c: any) => c.id === a1.carId && c.stage === 'pickup'), v1.app);
  for (const t of t1) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'ready', readyAt: new Date().toISOString() }, { merge: true });
  const rb: any = (await P({ action: 'readyBoard' })).body;
  const onBoard = rb.ready.find((x: any) => x.number === '4F2A');
  check('the ready board: the app, its code and its shelf spot, for the courier (the other one being made)', onBoard?.app === 'DoorDash' && onBoard.shelf === 'A1' && onBoard.name === 'Maya' && rb.making.some((x: any) => x.app === 'Uber Eats' && x.number === '4F2A' && x.shelf === 'A2'), rb);

  console.log('picked up');
  r = await P({ action: 'move', carId: a1.carId, to: 'gone' });
  const o1b = await get(`${T}/counterOrders/${a1.orderId}`); const sale = await get(`${T}/transactions/counter_${a1.orderId}`);
  check('handed to the courier: done, paid on the app', r.body.ok && o1b.status === 'done' && o1b.payMethod === 'app' && !!o1b.paidAt && o1b.app.state === 'picked', { r: r.body, o: o1b.app, pm: o1b.payMethod });
  check('…in the books as DoorDash’s sale, with no tax line and nothing in the drawer', sale?.amount === 28.5 && sale.paymentMethod === 'app' && sale.appName === 'DoorDash' && sale.appOrderCode === '4F2A' && sale.clientOrVendor === 'DoorDash' && /paid out by the app/.test(sale.description)
    && !(await get(`${T}/transactions/counter_${a1.orderId}_tax`)) && !o1b.tillId, sale);
  r = await P({ action: 'move', carId: a1.carId, to: 'gone' });
  check('…tapped again: booked once', r.body.ok && (await all(`${T}/transactions`)).filter((t: any) => t.orderId === a1.orderId).length === 1);
  r = await P({ action: 'appCancel', orderId: a1.orderId });
  check('…and can’t be cancelled once it’s picked up', r.status === 409, r.body);

  console.log('cancelled on the app');
  // Ana at the counter isn't a manager now; Lee works here, and Rosa is a manager.
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'staff', isActive: true });
  await db.doc(`${T}/staff/lee`).set({ name: 'Lee Park', role: 'staff', isActive: true, pin: '2468' });
  await db.doc(`${T}/staff/rosa`).set({ name: 'Rosa Diaz', role: 'manager', isActive: true, pin: '1357' });
  const stockBefore = (await get(`${T}/inventory/fries`)).totalStock;
  r = await P({ action: 'appCancel', orderId: a2.orderId });
  const o2 = await get(`${T}/counterOrders/${a2.orderId}`);
  check('cancelled: voided, what the kitchen hadn’t started put back, nothing in the books', r.body.ok && r.body.name === 'Uber Eats 4F2A' && o2.status === 'voided' && o2.app.state === 'cancelled' && (await get(`${T}/inventory/fries`)).totalStock === stockBefore + 1
    && !(await get(`${T}/transactions/counter_${a2.orderId}`)), { r: r.body, st: o2.status });
  check('…by anyone at the counter while the kitchen hadn’t started on it; its code free again', !r.body.approvedBy && !(await get(`${T}/private/appCode_${o2.day}_ubereats_4F2A`)));
  r = await P({ action: 'appCancel', orderId: a2.orderId });
  check('…tapped again: nothing twice', r.body.ok && r.body.already === true, r.body);
  const made = async (key: string, code: string) => {
    const x: any = (await P({ action: 'appStart', carKey: key })).body;
    await P({ action: 'add', orderId: x.orderId, itemId: 'burger', tapKey: `${key}b` });
    await P({ action: 'appSend', orderId: x.orderId, app: 'doordash', code, courierIn: 10 });
    return x;
  };
  const a3 = await made('a3', 'M3'); const t3 = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === a3.orderId);
  for (const t of t3) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'in_progress' }, { merge: true });
  r = await P({ action: 'appCancel', orderId: a3.orderId });
  check('once the kitchen started on it (food would go to waste with no sale): a manager’s okay is asked for', r.status === 403 && r.body.needsManager === true && (await get(`${T}/counterOrders/${a3.orderId}`)).status === 'sent', r.body);
  r = await P({ action: 'appCancel', orderId: a3.orderId, pin: '2468' });
  check('…a PIN that isn’t a manager’s is said', r.status === 403 && r.body.needsManager === true && /manager’s PIN/.test(r.body.error) && (await get(`${T}/counterOrders/${a3.orderId}`)).status === 'sent', r.body);
  r = await P({ action: 'appCancel', orderId: a3.orderId, pin: '1357' });
  const o3 = await get(`${T}/counterOrders/${a3.orderId}`);
  check('…with a manager’s PIN: taken off, the burger counted as waste, okayed by Rosa', r.body.ok && r.body.wasted === 1 && r.body.approvedBy === 'Rosa Diaz' && o3.status === 'voided' && o3.app.state === 'cancelled' && !(await get(`${T}/private/appCode_${o3.day}_doordash_M3`)), r.body);
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', job: 'manager' });
  const a4 = await made('a4', 'V1');
  r = await P({ action: 'void', orderId: a4.orderId, reason: 'Rung in twice' });
  const o4 = await get(`${T}/counterOrders/${a4.orderId}`);
  check('a manager’s void of an app order: off the shelf, and its code can go in again', r.body.ok && o4.app.state === 'cancelled' && !(await get(`${T}/private/appCode_${o4.day}_doordash_V1`)), { r: r.body, app: o4.app });
  const a4b = await made('a4b', 'V1');
  check('…the same code again: in', (await get(`${T}/counterOrders/${a4b.orderId}`)).status === 'sent');
  await P({ action: 'appCancel', orderId: a4b.orderId });

  console.log('sending');
  const a5: any = (await P({ action: 'appStart', carKey: 'a5' })).body;
  await P({ action: 'add', orderId: a5.orderId, itemId: 'burger', tapKey: 'a5b' });
  const burgers = (await get(`${T}/inventory/burger`)).totalStock;
  await db.doc(`${T}/inventory/burger`).set({ totalStock: 0 }, { merge: true });
  r = await P({ action: 'appSend', orderId: a5.orderId, app: 'doordash', code: 'K5', courierIn: 10 });
  const o5 = await get(`${T}/counterOrders/${a5.orderId}`);
  check('the kitchen can’t take it (ran out): said, and its code and shelf spot let go', r.status === 409 && /ran out/.test(r.body.error) && o5.status === 'building' && o5.app.state === 'taking' && !o5.app.shelf && !o5.app.claimId && !o5.app.code && !(await get(`${T}/private/appCode_${o5.day}_doordash_K5`)), { r: r.body, app: o5.app });
  await db.doc(`${T}/inventory/burger`).set({ totalStock: burgers }, { merge: true });
  await db.doc(`${T}/counterOrders/x-sending`).set({ day: o5.day, status: 'building', app: { state: 'sending', shelf: 'A1', code: 'Q9' } });
  r = await P({ action: 'appSend', orderId: a5.orderId, app: 'doordash', code: 'K6', courierIn: 10 });
  check('…sent again: a spot another tablet is sending to is taken (A2, not A1)', r.body.ok && r.body.shelf === 'A2', r.body);
  await db.doc(`${T}/counterOrders/x-sending`).delete();
  // (Sent to the kitchen, but its last step never finished: still 'sending', the car not at pickup.)
  await db.doc(`${T}/counterOrders/${a5.orderId}`).set({ app: { state: 'sending' } }, { merge: true });
  await db.doc(`${T}/driveThruCars/${a5.carId}`).set({ stage: 'speaker' }, { merge: true });
  r = await P({ action: 'appSend', orderId: a5.orderId, app: 'doordash', code: 'K6', courierIn: 10 });
  const other = await P({ action: 'appSend', orderId: a5.orderId, app: 'ubereats', code: 'K6', courierIn: 10 });
  check('…the same code with another app on a sent order: refused', other.status === 409 && /went to the kitchen already/.test(other.body.error), other.body);
  check('…a send whose last step didn’t finish is finished when tapped again', r.body.ok && r.body.already === true && (await get(`${T}/counterOrders/${a5.orderId}`)).app.state === 'waiting' && (await get(`${T}/driveThruCars/${a5.carId}`)).stage === 'pickup', r.body);
  await P({ action: 'appCancel', orderId: a5.orderId });

  console.log('the shelf');
  const sent: string[] = [];
  for (let i = 0; i < 5; i++) {
    const s0: any = (await P({ action: 'appStart', carKey: `s${i}` })).body;
    await P({ action: 'add', orderId: s0.orderId, itemId: 'fries', tapKey: `f${i}` });
    const s1: any = (await P({ action: 'appSend', orderId: s0.orderId, app: 'ubereats', code: `S${i}X`, courierIn: 20 })).body;
    sent.push(String(s1.shelf));
  }
  check('spots in turn while they’re taken (A1 is free again once its courier came); none when the shelf is full', sent.join() === 'A1,A2,A3,A4,null', sent);

  console.log('the night after');
  const { appNightly } = await import('../../src/lib/app-orders-server');
  const tn = await get(T);
  let n: any = await appNightly(db, 't1', tn, Date.now());
  check('the same night: nothing told (they’re today’s)', n.told === 0, n);
  n = await appNightly(db, 't1', tn, Date.now() + 86400000);
  const notes = await all(`${T}/notifications`);
  check('the next night: the managers told about the orders still waiting, once', n.told === 5 && (await all(`${T}/counterOrders`)).filter((o: any) => o.app?.toldAt).length === 5, { n, notes: notes.length });
  n = await appNightly(db, 't1', tn, Date.now() + 86400000);
  check('…not told twice', n.told === 0, n);
  n = await appNightly(db, 't1', tn, Date.now() + 3 * 86400000);
  check('codes from days ago cleared', n.cleared > 0 && !(await all(`${T}/private`)).some((d: any) => d.appCodeDay), n);

  console.log('the screens');
  const page = src('src/app/(app)/counter/page.tsx'); const card = src('src/components/menu/AppOrdersCard.tsx'); const board = src('src/app/drive-thru/[tenantId]/ready/page.tsx');
  check('the counter: App order, which app, the code, when the courier gets here, sent paid on the app', /App order/.test(page) && /Order code on the app/.test(page) && /Courier gets here/.test(page) && /Send to the kitchen, paid on the app/.test(page) && /action: 'appStart'/.test(page) && /The app collects it/.test(page));
  check('…waiting: picked up by the courier, or cancelled on the app (asked once more; a manager’s PIN when asked for)', /Picked up by the courier/.test(page) && /Cancelled on the app/.test(page) && /Courier about/.test(page) && /Yes, it’s cancelled/.test(page) && /Keep it/.test(page) && /setAppPin\(o\)/.test(page));
  check('…a courier who’s late is shown, to check the app', /courierLate\(o\.app\.courierAt, now\)/.test(page) && /The courier was due/.test(page));
  check('the Menu page’s settings, and the ready board’s shelf spot', /Delivery apps/.test(card) && /Spots on the pickup shelf/.test(card) && /Shelf \$\{r\.shelf\}/.test(board));
  check('the new screens keep the house style', ![page, card].some((s) => /\buppercase\b|font-black/.test(s)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
