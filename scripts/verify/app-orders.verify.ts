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
  check('the apps: the business’s picks, in order, and another by its name', JSON.stringify(A.appOrdersOf({ appOrders: { on: true, apps: ['grubhub', 'doordash', 'other'], otherName: '  Local  Eats ' } }).apps.map((x) => ({ code: x.code, label: x.label }))) === JSON.stringify([{ code: 'doordash', label: 'DoorDash' }, { code: 'grubhub', label: 'Grubhub' }, { code: 'other', label: 'Local Eats' }]));
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
  check('…the counter is offered the apps', JSON.stringify(lane.apps.map((x: any) => ({ code: x.code, label: x.label }))) === JSON.stringify([{ code: 'doordash', label: 'DoorDash' }, { code: 'ubereats', label: 'Uber Eats' }]), lane.apps);
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
  check('…its code kept for the day, where only the server reads it', (await get(`${T}/private/${o1.app.claimId}`))?.orderId === a1.orderId && /^appCode_\d{4}-\d{2}-\d{2}_doordash_4F2A$/.test(o1.app.claimId) && !(await get(`${T}/appOrderCodes/${o1.day}_doordash_4F2A`)));
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

  console.log('the money: the app’s price, its share, the tax, and the week’s payout');
  check('the rules: the menu plus the app’s difference, its share of that, the tax only when the business pays it', (() => {
    const b = A.appBooks(1200, { markupPct: 15, feePct: 15, appPaysTax: true }, (d) => d * 0.1);
    const t = A.appBooks(1000, { markupPct: 0, feePct: 20, appPaysTax: false }, (d) => Math.round(d * 0.1 * 100) / 100);
    return b.appCents === 1380 && b.feeCents === 207 && b.taxCents === 0 && b.payoutCents === 1173 && t.appCents === 1000 && t.taxCents === 100 && t.feeCents === 200 && t.payoutCents === 900;
  })());
  check('…the payout week is Monday to Sunday', A.payoutWeek('2026-11-16') === '2026-11-16' && A.payoutWeek('2026-11-22') === '2026-11-16' && A.payoutWeek('2026-11-23') === '2026-11-23');
  r = await Mn({ action: 'apps', money: { app: 'doordash', markupPct: 12 } });
  const r2: any = await Mn({ action: 'apps', money: { app: 'doordash', feePct: 55 } });
  check('settings: only the price choices, and a share up to 40%', r.status === 400 && r2.status === 400, [r.body, r2.body]);
  r = await Mn({ action: 'apps', money: { app: 'doordash', markupPct: 15, feePct: 15 } });
  await Mn({ action: 'apps', money: { app: 'ubereats', feePct: 20, appPaysTax: false } });
  const menuNow: any = (await Mn({ action: 'list' })).body.apps;
  check('…saved, and read back for each app', r.body.ok && menuNow.money.doordash.markupPct === 15 && menuNow.money.doordash.feePct === 15 && menuNow.money.doordash.appPaysTax === true && menuNow.money.ubereats.appPaysTax === false && menuNow.money.ubereats.feePct === 20 && menuNow.money.grubhub.feePct === null, menuNow.money);
  r = await P({ action: 'appStart', carKey: 'm1' }); const m1 = r.body;
  await P({ action: 'add', orderId: m1.orderId, itemId: 'burger', quantity: 2, tapKey: 'm1a' });
  await P({ action: 'appSend', orderId: m1.orderId, app: 'doordash', code: 'MD1', courierIn: 0 });
  const om1 = await get(`${T}/counterOrders/${m1.orderId}`);
  lane = (await P({ action: 'lane' })).body;
  check('sent: what it comes to on DoorDash is worked out and kept, and the counter shows it', om1.app.money.appCents === 2645 && om1.app.money.feeCents === 397 && om1.app.money.payoutCents === 2248 && om1.total === 23 && lane.orders?.[m1.orderId]?.app?.money?.appCents === 2645, { money: om1.app.money, view: lane.orders?.[m1.orderId]?.app });
  await P({ action: 'move', carId: m1.carId, to: 'gone' });
  const s1: any = await get(`${T}/transactions/counter_${m1.orderId}`); const f1: any = await get(`${T}/transactions/counter_${m1.orderId}_appfee`);
  check('picked up: the sale at DoorDash’s price, its share an expense line of its own, no tax', s1?.amount === 26.45 && s1.appPayoutCents === 2248 && f1?.type === 'expense' && f1.amount === 3.97 && f1.category === 'Delivery App Fees' && f1.clientOrVendor === 'DoorDash' && !(await get(`${T}/transactions/counter_${m1.orderId}_tax`)), { s1, f1 });
  r = await P({ action: 'appStart', carKey: 'm2' }); const m2 = r.body;
  await P({ action: 'add', orderId: m2.orderId, itemId: 'burger', tapKey: 'm2a' });
  await P({ action: 'appSend', orderId: m2.orderId, app: 'ubereats', code: 'MU1', courierIn: 0 });
  await P({ action: 'move', carId: m2.carId, to: 'gone' });
  const s2: any = await get(`${T}/transactions/counter_${m2.orderId}`); const t2: any = await get(`${T}/transactions/counter_${m2.orderId}_tax`); const f2: any = await get(`${T}/transactions/counter_${m2.orderId}_appfee`);
  check('an app that doesn’t pay the tax: the business’s tax booked with the sale, and the share', s2?.amount === 11.5 && t2?.amount === 1.15 && t2.category === 'Tax Collected' && /yours to pay/.test(t2.description) && f2?.amount === 2.3, { s2, t2, f2 });
  const P2 = await import('../../src/lib/app-payouts-server');
  // (Grubhub, with no share set: its weeks wait for one.)
  await Mn({ action: 'apps', apps: ['doordash', 'ubereats', 'grubhub'] });
  r = await P({ action: 'appStart', carKey: 'm3' }); const m3 = r.body;
  await P({ action: 'add', orderId: m3.orderId, itemId: 'burger', tapKey: 'm3a' });
  await P({ action: 'appSend', orderId: m3.orderId, app: 'grubhub', code: 'MG1', courierIn: 0 });
  await P({ action: 'move', carId: m3.carId, to: 'gone' });
  const { POST: PAY } = await import('../../src/app/api/apps/payouts/route');
  const Pay = (b: any) => PAY(req({ tenantId: 't1', ...b }));
  const wk = A.payoutWeek(new Date().toISOString().slice(0, 10));
  let pl: any = (await Pay({ action: 'list' })).body;
  const dd = pl.weeks.find((w: any) => w.app === 'doordash' && w.week === wk); const ue = pl.weeks.find((w: any) => w.app === 'ubereats' && w.week === wk);
  check('the week’s payouts: each app’s orders, what they came to, its share, and what should come in', !!dd && dd.payoutCents >= 2248 && dd.orders >= 1 && dd.status === 'open' && ue?.payoutCents === 1150 + 115 - 230 && ue.orders === 1, pl.weeks);
  check('…an app whose share isn’t set isn’t checked (the page says to set it)', !pl.weeks.some((w: any) => w.app === 'grubhub') && pl.needsShare.join() === 'Grubhub', pl.needsShare);
  r = await Pay({ action: 'paid', app: 'ubereats', week: wk, cents: 985 });
  check('a payout entered: short of what the orders came to', r.body.ok && r.body.week.status === 'short' && r.body.week.diffCents === -50, r.body);
  r = await Pay({ action: 'adjust', app: 'ubereats', week: wk });
  const adj: any = await get(`${T}/transactions/appadj_ubereats_${wk}`);
  check('…the difference booked once, as an app adjustment', r.body.ok && adj?.type === 'expense' && adj.amount === 0.5 && adj.category === 'Delivery App Adjustments' && r.body.week.adjustedCents === -50, { body: r.body, adj });
  r = await Pay({ action: 'adjust', app: 'ubereats', week: wk });
  const r3: any = await Pay({ action: 'paid', app: 'ubereats', week: wk, cents: 1035 });
  check('…asked again: as it was; and what came in can’t change after', r.body.ok && r.body.already === true && r3.status === 409, [r.body, r3.body]);
  r = await P({ action: 'appStart', carKey: 'm4' }); const m4 = r.body;
  await P({ action: 'add', orderId: m4.orderId, itemId: 'burger', tapKey: 'm4a' });
  await P({ action: 'appSend', orderId: m4.orderId, app: 'ubereats', code: 'MU2', courierIn: 0 });
  await P({ action: 'move', carId: m4.carId, to: 'gone' });
  const nextWk = new Date(Date.parse(`${wk}T12:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10);
  check('…an order picked up after its week was booked counts in the next week', (await get(`${T}/private/appWeek_ubereats_${wk}`)).orders === 1 && (await get(`${T}/private/appWeek_ubereats_${nextWk}`))?.orders === 1 && (await get(`${T}/transactions/counter_${m4.orderId}`)).appWeek === nextWk);
  r = await Pay({ action: 'paid', app: 'other', week: wk, cents: 100 });
  const r4: any = await Pay({ action: 'paid', app: 'ubereats', week: '2026-11-17', cents: 100 });
  check('…only a week with orders, and only a Monday', r.status === 404 && r4.status === 400, [r.body, r4.body]);
  actor.isManager = false; r = await Pay({ action: 'list' }); actor.isManager = true;
  check('payouts are the managers’', r.status === 403, r.body);
  check('…matched within a cent an order (the app’s rounding)', P2.matchWithin(3) === 5 && P2.matchWithin(40) === 40);

  console.log('sold out on the apps too');
  check('the rules: sold out here is to mark on each app not done yet (an ingredient running low isn’t asked about); back here, to turn on where it was marked', (() => {
    const apps = [{ code: 'doordash', label: 'DoorDash' }, { code: 'ubereats', label: 'Uber Eats' }];
    const t = A.appSoldOutTodo([{ id: 'a', name: 'Burger', soldOut: true, appOut: { doordash: 'x' } }, { id: 'b', name: 'Fries', soldOut: false, inStock: false }, { id: 'c', name: 'Bowl', soldOut: false, appOut: { ubereats: 'x' } }, { id: 'd', name: 'Tea', soldOut: false }, { id: 'e', name: 'Off', soldOut: true, onMenu: false }], apps);
    return t.length === 2 && t[0].id === 'a' && t[0].apps.map((x) => x.code).join() === 'ubereats' && t[1].id === 'c' && !t[1].out && t[1].apps.map((x) => x.code).join() === 'ubereats';
  })());
  r = await Mn({ action: 'soldout', itemId: 'fries', out: true });
  lane = (await P({ action: 'lane' })).body;
  const so = (lane.appSoldOut || []).find((x: any) => x.id === 'fries');
  check('sold out here: the counter is asked to mark it on each app', r.body.ok && so?.out === true && so.apps.map((x: any) => x.code).join() === 'doordash,ubereats,grubhub', lane.appSoldOut);
  r = await P({ action: 'appSoldOut', itemId: 'fries', app: 'doordash', out: true });
  const rX: any = await P({ action: 'appSoldOut', itemId: 'fries', app: 'zoom', out: true });
  lane = (await P({ action: 'lane' })).body;
  check('…each app ticked once, as it’s done (only the business’s apps)', r.body.ok && rX.status === 400 && (lane.appSoldOut || []).find((x: any) => x.id === 'fries')?.apps.map((x: any) => x.code).join() === 'ubereats,grubhub', lane.appSoldOut);
  await P({ action: 'appSoldOut', itemId: 'fries', app: 'ubereats', out: true }); await P({ action: 'appSoldOut', itemId: 'fries', app: 'grubhub', out: true });
  lane = (await P({ action: 'lane' })).body;
  check('…every app done: the reminder goes', !(lane.appSoldOut || []).some((x: any) => x.id === 'fries'), lane.appSoldOut);
  await Mn({ action: 'soldout', itemId: 'fries', out: false });
  lane = (await P({ action: 'lane' })).body;
  const back = (lane.appSoldOut || []).find((x: any) => x.id === 'fries');
  check('back here: turn it back on, on each app it was marked out on', back?.out === false && back.apps.length === 3, back);
  for (const a of ['doordash', 'ubereats', 'grubhub']) await P({ action: 'appSoldOut', itemId: 'fries', app: a, out: false });
  lane = (await P({ action: 'lane' })).body;
  check('…all back on: nothing to do', !(lane.appSoldOut || []).length && !Object.keys((await get(`${T}/inventory/fries`)).appOut || {}).length, { todo: lane.appSoldOut, appOut: (await get(`${T}/inventory/fries`)).appOut });

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
  check('…by anyone at the counter while the kitchen hadn’t started on it; its code free again', !r.body.approvedBy && !(await get(`${T}/private/${o2.app.claimId}`)));
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
  check('…with a manager’s PIN: taken off, the burger counted as waste, okayed by Rosa', r.body.ok && r.body.wasted === 1 && r.body.approvedBy === 'Rosa Diaz' && o3.status === 'voided' && o3.app.state === 'cancelled' && !(await get(`${T}/private/${o3.app.claimId}`)), r.body);
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', job: 'manager' });
  const a4 = await made('a4', 'V1');
  r = await P({ action: 'void', orderId: a4.orderId, reason: 'Rung in twice' });
  const o4 = await get(`${T}/counterOrders/${a4.orderId}`);
  check('a manager’s void of an app order: off the shelf, and its code can go in again', r.body.ok && o4.app.state === 'cancelled' && !(await get(`${T}/private/${o4.app.claimId}`)), { r: r.body, app: o4.app });
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
  check('the kitchen can’t take it (ran out): said, and its code and shelf spot let go', r.status === 409 && /ran out/.test(r.body.error) && o5.status === 'building' && o5.app.state === 'taking' && !o5.app.shelf && !o5.app.claimId && !o5.app.code && (await all(`${T}/private`)).every((c: any) => c.orderId !== a5.orderId), { r: r.body, app: o5.app });
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
  // (One from before midnight still on the shelf: its spot stays taken after it.)
  const calDay = new Date().toISOString().slice(0, 10); const yDay = new Date(Date.parse(`${calDay}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
  await db.doc(`${T}/counterOrders/x-late`).set({ day: yDay, status: 'sent', app: { state: 'waiting', shelf: 'A1', code: 'Z9' } });
  const a6: any = (await P({ action: 'appStart', carKey: 'a6' })).body;
  await P({ action: 'add', orderId: a6.orderId, itemId: 'fries', tapKey: 'a6f' });
  r = await P({ action: 'appSend', orderId: a6.orderId, app: 'doordash', code: 'L6', courierIn: 10 });
  check('after midnight: a spot taken by last night’s order stays taken', r.body.ok && r.body.shelf === 'A2', r.body);
  await db.doc(`${T}/counterOrders/x-late`).delete(); await P({ action: 'appCancel', orderId: a6.orderId });

  console.log('the shelf');
  const sent: string[] = [];
  for (let i = 0; i < 5; i++) {
    const s0: any = (await P({ action: 'appStart', carKey: `s${i}` })).body;
    await P({ action: 'add', orderId: s0.orderId, itemId: 'fries', tapKey: `f${i}` });
    const s1: any = (await P({ action: 'appSend', orderId: s0.orderId, app: 'ubereats', code: `S${i}X`, courierIn: 20 })).body;
    sent.push(String(s1.shelf));
  }
  check('spots in turn while they’re taken (A1 is free again once its courier came); none when the shelf is full', sent.join() === 'A1,A2,A3,A4,null', sent);

  console.log('fixing the code');
  const fx = (await all(`${T}/counterOrders`)).find((o: any) => o.app?.code === 'S1X');
  r = await P({ action: 'appCode', orderId: fx.id, app: 'ubereats', code: 'S2X' });
  check('fixed to a code already in: said, nothing changed', r.status === 409 && /Uber Eats S2X is already in/.test(r.body.error) && (await get(`${T}/counterOrders/${fx.id}`)).app.code === 'S1X', r.body);
  r = await P({ action: 'appCode', orderId: fx.id, app: 'doordash', code: ' #s1y ' });
  const fx2 = await get(`${T}/counterOrders/${fx.id}`); const fxT = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === fx.id);
  check('fixed: the right app and code on the order, its kitchen ticket and the shelf spot kept', r.body.ok && r.body.was === 'Uber Eats S1X' && r.body.name === 'DoorDash S1Y' && fx2.app.code === 'S1Y' && fx2.app.app === 'doordash' && fx2.app.label === 'DoorDash' && fx2.app.shelf === fx.app.shelf
    && fxT.every((t: any) => t.stationName === `DoorDash S1Y, shelf ${fx.app.shelf}`), { r: r.body, app: fx2.app, t: fxT.map((t: any) => t.stationName) });
  check('…the old code free again, the new one taken', !(await get(`${T}/private/${fx.app.claimId}`)) && (await get(`${T}/private/${fx2.app.claimId}`))?.orderId === fx.id && (await get(`${T}/driveThruCars/${fx.carId}`)).app.code === 'S1Y');
  r = await P({ action: 'appSend', orderId: (await P({ action: 'appStart', carKey: 'fx' })).body.orderId, app: 'ubereats', code: 'S1X', courierIn: 10 });
  check('…so the old code can go in for another order', r.status !== 409 || !/already in/.test(r.body.error), r.body);
  r = await P({ action: 'appCode', orderId: a1.orderId, app: 'doordash', code: 'ZZ1' });
  check('…not once it’s picked up', r.status === 409 && /picked up already/.test(r.body.error), r.body);

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
  check('…Fix the code on a sent app order', /Fix the code/.test(page) && /Save the code/.test(page) && /action: 'appCode'/.test(page));
  check('…a courier who’s late is shown, to check the app', /courierLate\(o\.app\.courierAt, now\)/.test(page) && /The courier was due/.test(page));
  check('the Menu page’s settings, and the ready board’s shelf spot', /Delivery apps/.test(card) && /Spots on the pickup shelf/.test(card) && /Shelf \$\{r\.shelf\}/.test(board));
  const payCard = src('src/components/money/AppPayoutsCard.tsx'); const money = src('src/app/(app)/money/page.tsx');
  check('each app’s prices, share and tax on the Menu page; its price at the counter; the payouts on the Money page', /Your prices on \{label\}/.test(card) && /What \{label\} keeps/.test(card) && /collects and pays the sales tax/.test(card) && /On \{order\.app\.label\}/.test(page) && /<AppPayoutsCard tenantId=/.test(money) && /as an app adjustment/.test(payCard) && /Check it/.test(payCard));
  const soCard = src('src/components/drive-thru/AppSoldOut.tsx');
  check('the counter: on the delivery apps, each app’s button', /<AppSoldOut rows=/.test(page) && /On the delivery apps/.test(soCard) && /Sold out on \$\{a\.label\}/.test(soCard) && /Back on, on \$\{a\.label\}/.test(soCard));
  check('the new screens keep the house style', ![page, card, payCard, soCard].some((s) => /\buppercase\b|font-black/.test(s)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
