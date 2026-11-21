// Checks each store's own drivers and lists (design board "Each store runs on its own", part 2; lib/driver-load-server
// driversAt / driverLoad at, lib/delivery-server deliveryFor store, lib/shop-stores-server storeDelivery, api/retail/checkout,
// lib/food-delivery-server foodDrivers / foodRun, lib/route-server routeFor, components/orders OrdersApp, staff-portal
// DeliveriesTab).
// - Who works where: each person's locations (none set: every location). A store's drivers are those who work there.
// - Hot food: each location's drivers, its own food to leave, and runs out with its drivers or from there.
// - Shop delivery: each store's delivery times fill with its own orders and its own drivers on the schedule; placing one
//   counts that store's orders only.
// - The counter lists its own location's drivers; a driver's tab shows what's ready at the stores they work at; a
//   driver's route starts at the store its stops go out from. Orders shows each store's own, with Every store.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/stores-drivers.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '+18325550100';
const db: any = strictTransactions(makeDb());
let geoNow: any = { lat: 39.95, lng: -75.0, label: '9 Harbor Ct', postal: '08077', confidence: 'exact' }; const geoAsks: string[] = [];
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const texts: { to: string; body: string }[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('twilio')) { const p = new URLSearchParams(String(init?.body || '')); texts.push({ to: String(p.get('To')), body: String(p.get('Body')) }); }
  return { ok: true, status: 201, json: async () => ({ sid: `SM${texts.length}` }) };
};
const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), n: 0, refunds: [] as any[], refundKeys: new Map<string, any>(), failIn: 0 };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, status: 'requires_payment_method', metadata: { ...p.metadata }, amount_received: 0, client_secret: `${id}_secret`, account: o?.stripeAccount };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); return clone(pi);
    },
    retrieve: async (id: string) => clone(S.pis.get(id)),
    cancel: async (id: string) => { const pi = S.pis.get(id); pi.status = 'canceled'; return clone(pi); },
  };
  refunds = { create: async (p: any, o: any) => {
    if (o?.idempotencyKey && S.refundKeys.has(o.idempotencyKey)) return S.refundKeys.get(o.idempotencyKey);
    if (S.failIn > 0 && --S.failIn === 0) throw Object.assign(new Error('The card company said no.'), { type: 'StripeInvalidRequestError' });
    const r = { id: `re_${S.refunds.length + 1}`, status: 'succeeded', amount: p.amount, payment_intent: p.payment_intent }; S.refunds.push(r); if (o?.idempotencyKey) S.refundKeys.set(o.idempotencyKey, r); return r;
  }, list: async () => ({ data: [] }) };
}
const paid = (piId: string) => { const pi = S.pis.get(piId); pi.status = 'succeeded'; pi.amount_received = pi.amount; };

const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() || {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  if (request === '@/lib/geocode-server' || /\/src\/lib\/geocode-server(\.ts)?$/.test(request)) {
    const real = load.call(this, request, ...rest);
    return fake(request, { ...real, hasMapsKey: () => true, geocode: async (a: string) => { geoAsks.push(a); return typeof geoNow === 'function' ? geoNow(a) : geoNow; } });
  }
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  if (request === '@/lib/location-allowance' || /\/src\/lib\/location-allowance(\.ts)?$/.test(request)) return fake(request, { locationAllowance: async () => ({ canAdd: true, extraMonthly: 0 }) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const PLAN = { on: true, by: 'distance', origin: { lat: 39.9, lng: -75.0, label: 'Main St', source: 'location' }, zones: [{ id: 'near', name: 'Near', upToMiles: 6, feeCents: 399, minimumCents: 1000 }], days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: '00:00', end: '23:59' }] };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const allWeek = (start: string, end: string) => Object.fromEntries(DAYS.map((d) => [d, { enabled: true, start, end }]));
const closedWeek = Object.fromEntries(DAYS.map((d) => [d, { enabled: false, start: '9:00 AM', end: '5:00 PM' }]));



(async () => {
  const HS = await import('../../src/lib/here-server');
  const DL = await import('../../src/lib/driver-load-server');
  const DS = await import('../../src/lib/delivery-server');
  const SS = await import('../../src/lib/shop-stores-server');
  const FD = await import('../../src/lib/food-delivery-server');
  const RS = await import('../../src/lib/route-server');
  const TT = await import('../../src/lib/tenant-time');
  const { POST: CHECKOUT } = await import('../../src/app/api/retail/checkout/route');
  const { POST: QUOTE } = await import('../../src/app/api/retail/delivery-quote/route');
  const src = (p: string) => readFileSync(p, 'utf8');

  const now = Date.now(); const today = TT.todayIn('Etc/UTC', new Date(now));
  const PLAN = { on: true, by: 'distance', origin: { lat: 39.9, lng: -75.0, label: 'Main St', source: 'location' }, zones: [{ id: 'near', name: 'Near', upToMiles: 6, feeCents: 399, minimumCents: 1000 }], days: [0, 1, 2, 3, 4, 5, 6],
    slots: [{ start: '00:00', end: '23:59' }], perWindow: 1, daysAhead: 3, drivers: ['rio', 'sam', 'ana'], perDriver: null, asap: { on: false } };
  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, retailSettings: { taxRatePercent: 0, deliveryPlan: PLAN }, salesTax: { configured: true }, publicOrigin: 'https://app.test' });
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true, address: '1 Main St, Riverton', coordinates: { lat: 39.9, lng: -75.0 } });
  await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true, address: '88 Harbor Rd, Riverton', coordinates: { lat: 39.96, lng: -75.0 } });
  await db.doc(`${T}/staff/rio`).set({ name: 'Rio Diaz', role: 'staff', locationIds: ['harbor'] });
  await db.doc(`${T}/staff/sam`).set({ name: 'Sam Lee', role: 'staff', locationIds: ['main'] });
  await db.doc(`${T}/staff/ana`).set({ name: 'Ana Ruiz', role: 'staff' });
  HS.forgetLocations('t1');

  console.log('who works where');
  const atH = await DL.driversAt(db, 't1', ['rio', 'sam', 'ana'], 'harbor'); const atM = await DL.driversAt(db, 't1', ['rio', 'sam', 'ana'], 'main');
  check('a store’s drivers: the ones who work there, and anyone set to no location in particular', atH.join() === 'rio,ana' && atM.join() === 'sam,ana' && (await DL.driversAt(db, 't1', ['rio', 'sam'], null)).join() === 'rio,sam', [atH, atM]);
  const fdH = (await FD.foodDrivers(db, 't1', await get(T), now, 'harbor')).map((d: any) => d.id).join(); const fdAll = (await FD.foodDrivers(db, 't1', await get(T), now)).map((d: any) => d.id).join();
  check('the counter at Harbor Rd lists its own drivers to send', fdH === 'rio,ana' && fdAll === 'rio,sam,ana', [fdH, fdAll]);

  console.log('hot food, each location’s drivers');
  for (const [id, st] of [['rio', '00:00'], ['sam', '00:00'], ['ana', '00:00']]) await db.doc(`${T}/shifts/s_${id}`).set({ staffId: id, date: today, startTime: st, endTime: '23:59', status: 'published', kind: 'work' });
  const out = (id: string, loc: string, driver: string | null) => db.doc(`${T}/counterOrders/${id}`).set({ channel: 'ahead', status: 'done', day: today, locationId: loc, paidAt: new Date(now - 60000).toISOString(),
    ahead: { way: 'delivery', state: 'paid', delivery: { state: 'out', outAt: new Date(now - 5 * 60000).toISOString(), driveMin: 20, ...(driver ? { driverId: driver, driverName: driver } : {}) } } });
  await out('h1', 'main', 'sam'); await out('h2', 'main', 'ana');
  DL.forgetDriverLoad('t1');
  const lH = await DL.driverLoad(db, 't1', await get(T), now, { at: 'harbor' }); const lM = await DL.driverLoad(db, 't1', await get(T), now, { at: 'main' });
  const st = (l: any, id: string) => l.drivers.find((d: any) => d.id === id)?.state;
  check('Harbor Rd: its drivers only; Ana (every store) is out with Main St’s food, so out here too; Rio free', lH.drivers.map((d: any) => d.id).sort().join() === 'ana,rio' && st(lH, 'ana') === 'out' && st(lH, 'rio') === 'free' && lH.onNow === 2 && lH.outNow === 1, { d: lH.drivers, on: lH.onNow, out: lH.outNow });
  check('Main St: Sam and Ana both out', st(lM, 'sam') === 'out' && st(lM, 'ana') === 'out' && lM.outNow === 2, lM.drivers);

  console.log('shop delivery, each store’s times');
  const addr = { line1: '9 Harbor Ct', city: 'Riverton', state: 'NJ', postalCode: '08077' };
  geoNow = { lat: 39.955, lng: -75.0, label: '9 Harbor Ct', postal: '08077', confidence: 'exact' };
  const stores = (await SS.shopStoresOf(db, 't1')).stores;
  const viaH = await SS.storeDelivery(db, 't1', await get(T), addr, { itemsCents: 5000, now }, stores);
  const win = viaH.v.ok ? viaH.v.windows.find((w: any) => !w.full)?.key : null;
  check('a delivery near Harbor Rd: from there, with its own times', viaH.v.ok && viaH.from?.id === 'harbor' && !!win, { ok: viaH.v.ok, from: viaH.from?.id });
  await db.doc(`${T}/retailOrders/x1`).set({ id: 'x1', method: 'delivery', stage: 'paid', paidAt: new Date().toISOString(), placedAt: new Date().toISOString(), deliveryWindowKey: win, locationId: 'main', delivery: { status: 'waiting' } });
  const h2 = await SS.storeDelivery(db, 't1', await get(T), addr, { itemsCents: 5000, now }, stores);
  const wH = h2.v.ok ? h2.v.windows.find((w: any) => w.key === win) : null;
  const m2 = await DS.deliveryFor(db, 't1', await get(T), addr, { itemsCents: 5000, now, origin: { lat: 39.9, lng: -75.0 }, store: 'main' });
  const wM = m2.ok ? m2.windows.find((w: any) => w.key === win) : null;
  check('…a Main St delivery in that time fills Main St’s, not Harbor Rd’s (one a time each)', wH?.full === false && wM?.full === true, [wH, wM]);
  await db.doc(`${T}/retailOrders/x1`).delete();

  console.log('placing a shop delivery counts that store’s own');
  await db.doc(`${T}/inventory/p1`).set({ name: 'Candle', msrp: 50, retailPriceCents: 5000, price: 50, totalStock: 100, stockReserved: 0, showOnline: true, status: 'active', type: 'retail' });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'ABCD-EFGH', codeKey: 'ABCDEFGH', balanceCents: 10000000, status: 'active', holds: {}, history: [] });
  let k = 0; const ck = () => `deliverkey-${String(++k).padStart(8, '0')}`;
  const buy = (x: any) => CHECKOUT(req({ tenantId: 't1', items: [{ productId: 'p1', qty: 1 }], method: 'delivery', customer: { name: 'Maya Chen', email: 'maya@example.com', phone: '8325550150' }, giftCode: 'ABCD-EFGH', checkoutKey: ck(),
    shippingAddress: { ...addr, name: '', country: 'US' }, deliveryWindowKey: win, ...x })) as any;
  await db.doc(`${T}/retailOrders/x2`).set({ id: 'x2', method: 'delivery', stage: 'paid', paidAt: new Date().toISOString(), placedAt: new Date().toISOString(), deliveryWindowKey: win, locationId: 'main', delivery: { status: 'waiting' } });
  const r1: any = await buy({ deliveryFrom: 'harbor' });
  const r2: any = await buy({ deliveryFrom: 'harbor' });
  check('a Main St order already in that time doesn’t fill Harbor Rd’s; Harbor Rd’s own one does', r1.status === 200 && r2.status === 409 && r2.body.deliveryFull === true, [r1.status, r1.body?.error, r2.status, r2.body?.error]);
  await db.doc(`${T}/retailOrders/x2`).delete();

  console.log('a driver’s tab and route');
  await db.doc(`${T}/counterOrders/h1`).delete(); await db.doc(`${T}/counterOrders/h2`).delete();
  const wait = (id: string, loc: string) => db.doc(`${T}/counterOrders/${id}`).set({ channel: 'ahead', status: 'building', day: today, locationId: loc, number: id, paidAt: new Date().toISOString(),
    ahead: { way: 'delivery', state: 'paid', slot: new Date(now + 30 * 60000).toISOString(), delivery: { state: 'waiting', driveMin: 10, address: addr, arriveAt: new Date(now + 40 * 60000).toISOString() } } });
  await wait('w1', 'main'); await wait('w2', 'harbor');
  const runRio = (await FD.foodRun(db, 't1', await get(T), 'rio', now + 1)).map((r: any) => r.orderId).sort().join();
  const runAna = (await FD.foodRun(db, 't1', await get(T), 'ana', now + 4000)).map((r: any) => r.orderId).sort().join();
  check('Rio (Harbor Rd) sees Harbor Rd’s to take; Ana (every store) sees both', runRio === 'w2' && runAna === 'w1,w2', [runRio, runAna]);
  await db.doc(`${T}/counterOrders/w2`).set({ ahead: { delivery: { state: 'out', driverId: 'rio', driverName: 'Rio', outAt: new Date().toISOString(), dest: { lat: 39.955, lng: -75.0 }, destFor: ['9 Harbor Ct', '', 'Riverton', 'NJ', '08077'].map((x) => x.toLowerCase()).join('|'), destAt: new Date().toISOString() } } }, { merge: true });
  const view: any = await RS.routeFor(db, 't1', await get(T), 'rio', { now });
  check('Rio’s route starts from Harbor Rd, where his stop goes out from', !!view && /origin=88\+Harbor\+Rd/.test(String(view.link || '')), view?.link);

  console.log('a location none of the drivers works at');
  await db.doc(`${T}/staff/ana`).update({ locationIds: ['main'] }); await db.doc(`${T}/staff/rio`).update({ locationIds: ['main'] }); DL.forgetDriverLoad('t1');
  const lNone = await DL.driverLoad(db, 't1', await get(T), now, { at: 'harbor' });
  const viaNone = await SS.storeDelivery(db, 't1', await get(T), addr, { itemsCents: 5000, now }, (await SS.shopStoresOf(db, 't1')).stores);
  check('hot food: nobody on there, ever (never “no limit”); the shop: it doesn’t deliver, the next nearest does', lNone.onNow === 0 && Array.isArray(lNone.onShift(now)) && lNone.onShift(now)!.length === 0 && viaNone.v.ok && viaNone.from?.id === 'main', { on: lNone.onNow, from: viaNone.from?.id, ok: viaNone.v.ok });
  const CA = await import('../../src/lib/counter-ahead');
  const fq: any = await CA.deliveryQuote(db, 't1', { ...(await get(T)), orderAhead: { on: true, delivery: true }, foodDelivery: { on: true } }, addr, 5000, null, now, null);
  check('…ordering ahead quotes from a location with drivers', !fq.ok || fq.from?.id !== 'harbor', fq);
  await db.doc(`${T}/staff/ana`).update({ locationIds: [] }); await db.doc(`${T}/staff/rio`).update({ locationIds: ['harbor'] }); DL.forgetDriverLoad('t1');
  check('a driver entry that isn’t a team member’s id is kept (working everywhere)', (await DL.driversAt(db, 't1', ['rio', 'old driver'], 'main')).join() === 'old driver', 0);

  console.log('the screens');
  check('Orders: each store’s own, with Every store', /Every store/.test(src('src/components/orders/OrdersApp.tsx')) && /allOrders\.filter\(\(o\) => atHere\(o, atStore\)\)/.test(src('src/components/orders/OrdersApp.tsx')));
  check('a driver’s Deliveries tab: ready to take at the stores they work at', /worksAt\(staffMember, String\(o\.locationId\)\)/.test(src('src/components/staff-portal/DeliveriesTab.tsx')));
  check('the counter: its own location’s drivers and load', /driverLoad\(db, tenantId, tenant, now\.getTime\(\), \{ at: here \}\)/.test(src('src/app/api/counter/route.ts')) && /foodDrivers\(db, tenantId, tenant, now\.getTime\(\), here\)/.test(src('src/app/api/counter/route.ts')));
  check('ordering ahead: the drivers of the location it goes from', /driverLoad\(db, tenantId, tenant, now, \{ skipCheckout: key, at: ep\?\.id \?\? null \}\)/.test(src('src/lib/counter-ahead.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
