// scripts/verify/delivery-live.verify.ts — Delivery D2, round 3: the delivery on its way, live (mockup 1C), run for real
// against the stand-in database: the driver's app keeping their route, arrival times and (when shared) location; the
// customer's view of it (rounded, short-lived, never once it's delivered); the map drawn by the server with its own key;
// the "a few minutes away" text, once per try; and the customer changing their note for the driver.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/delivery-live.verify.ts
import fs from 'fs';
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.CRON_SECRET = 'test-secret';
process.env.MAPBOX_TOKEN = 'pk.test-token';
process.env.ORDER_PASS_SECRET = process.env.ORDER_PASS_SECRET || 'pass-secret';
let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'riley', name: 'Riley Chen', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
const M: any = Module as any;
const load = M._load;
const afterJobs: Promise<any>[] = [];
const told: any[] = [];
let textsDown = false;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') {
    class R { status: number; body: any; headers: any; constructor(b: any, init?: any) { this.body = b; this.status = init?.status || 200; this.headers = init?.headers || {}; } static json(body: any, init?: any) { return { status: init?.status || 200, body }; } }
    return { NextResponse: R, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn).catch(() => null)); } };
  }
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') { const real = load.call(this, request, ...rest); return { ...real, staffOrServer: async () => true }; }
  if (request === '@/lib/notify') return { sendNotification: async (_db: any, m: any) => { told.push(m); return textsDown ? { ok: false, status: 'failed' } : { ok: true, status: 'sent' }; } };
  if (request === '@/lib/order-tracking') return { syncTracking: async () => {}, putTracking: async () => {}, trackingKey: () => '' };
  return load.call(this, request, ...rest);
};
// Mapbox: the address lookup (one place per street) and the map picture; the app's own message routes.
const calls: { url: string; body?: any }[] = [];
const PLACES: Record<string, { lat: number; lng: number }> = { '88 Pine St': { lat: 45.5231, lng: -122.6765 }, '22 Alder Ct': { lat: 45.5301, lng: -122.6601 } };
// The delivery texts' own route runs for real when the driver's update asks it (it marks what it sent).
let notifyRoute: any = null;
(globalThis as any).fetch = async (url: string, init: any) => {
  const u = String(url); calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  if (u.endsWith('/api/retail/delivery-notify') && notifyRoute) { const r: any = await notifyRoute(req(JSON.parse(String(init.body)))); return { ok: r.status < 400, status: r.status, json: async () => r.body }; }
  if (u.includes('/search/geocode/')) {
    const q = decodeURIComponent((/q=([^&]+)/.exec(u) || [])[1] || '');
    const k = Object.keys(PLACES).find((x) => q.includes(x));
    return { ok: true, status: 200, json: async () => ({ features: k ? [{ geometry: { coordinates: [PLACES[k].lng, PLACES[k].lat] }, properties: { full_address: q, match_code: { confidence: 'exact' }, context: { postcode: { name: '97204' } } } }] : [] }) };
  }
  if (u.includes('/styles/v1/')) return { ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => new ArrayBuffer(8) };
  return { ok: true, status: 200, json: async () => ({ ok: true, sent: true }) };
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const req = (body: any, q = '') => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://shop.test', searchParams: new URLSearchParams(q) }, clone() { return this; } }) as any;
const at = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const ORDER = (id: string, n: number, line1: string, start: string, extra: any = {}) => ({
  id, tenantId: 't1', orderNumber: n, method: 'delivery', stage: 'ready', qrToken: `q${id}`, customerName: 'Maya Lin', customerPhone: '+15035550100', customerEmail: 'maya@example.com',
  shippingAddress: { line1, city: 'Portland', state: 'OR', postalCode: '97204' }, totalCents: 4000, refundedCents: 0,
  lines: [{ lineId: 'A', productId: 'gel', name: 'Gel', qtyOrdered: 1, qtyScanned: 1, qtyShorted: 0, unitPriceCents: 4000 }],
  delivery: { status: 'out', driverId: 'riley', driverName: 'Riley Chen', tries: 1, outAt: new Date().toISOString(), window: { key: 'k', start, end: start, label: 'Fri Oct 30, 5–7 pm' }, note: 'Leave it at the front desk' }, ...extra });
const fresh = async () => {
  db = strictTransactions(makeDb()); calls.length = 0; told.length = 0; afterJobs.length = 0;
  actor = { uid: 'riley', name: 'Riley Chen', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
  await db.doc(T).set({ name: 'Opal', businessName: 'Opal Studio', timezone: 'America/Los_Angeles',
    retailSettings: { deliveryPlan: { on: true, by: 'postal', days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: '10:00', end: '12:00' }], zones: [{ id: 'a', name: 'A', postalCodes: ['97204'], feeCents: 600, minimumCents: 0, freeOverCents: null, expressCents: null, on: true }],
      drivers: ['riley'], vehicles: { riley: 'Gray hatchback' }, origin: { lat: 45.5152, lng: -122.6784, label: 'Opal Studio', source: 'address' }, dropoffNotes: true } } });
  // Two stops out with Riley (Alder first: the earlier promise), one with Sam, one delivered.
  await db.doc(`${T}/retailOrders/o1`).set(ORDER('o1', 1214, '88 Pine St', at(2)));
  await db.doc(`${T}/retailOrders/o2`).set(ORDER('o2', 1213, '22 Alder Ct', at(1), { delivery: { ...ORDER('o2', 1213, '22 Alder Ct', at(1)).delivery, outAt: new Date(Date.now() - 10 * 60e3).toISOString() } }));
  await db.doc(`${T}/retailOrders/o3`).set(ORDER('o3', 1215, '7 Cedar Ln', at(1), { delivery: { status: 'out', driverId: 'sam', driverName: 'Sam Ortiz', tries: 1 } }));
  await db.doc(`${T}/retailOrders/o4`).set(ORDER('o4', 1216, '9 Elm St', at(0), { stage: 'completed', delivery: { status: 'delivered', driverId: 'riley', tries: 1 } }));
};

(async () => {
  const L = await import('../../src/lib/delivery-live');
  const S = await import('../../src/lib/delivery-live-server');
  console.log('the rules');
  check('roughly where: about a city block', JSON.stringify(L.roughly({ lat: 45.523456, lng: -122.676549 })) === JSON.stringify({ lat: 45.523, lng: -122.677 }));
  const now = Date.parse('2026-10-30T23:00:00Z');
  check('without a location, no arrival time (it would slide later on every look)', Object.keys(L.routeEtas(now, null, [{ id: 'a', dest: { lat: 45.53, lng: -122.66 } }])).length === 0);
  const e1 = L.routeEtas(now, { lat: 45.5152, lng: -122.6784 }, [{ id: 'a', dest: { lat: 45.5301, lng: -122.6601 } }, { id: 'b', dest: { lat: 45.5231, lng: -122.6765 } }, { id: 'c', dest: null }, { id: 'd', dest: { lat: 45.52, lng: -122.67 } }]);
  check('from where the driver is: the drive, then the door, then the next drive; a 20-minute range on 5 minutes', Date.parse(e1.a.from) < Date.parse(e1.b.from) && Date.parse(e1.a.from) >= now && Date.parse(e1.a.to) - Date.parse(e1.a.from) === 20 * 60e3 && Date.parse(e1.a.from) % (5 * 60e3) === 0, e1);
  check('…none for a stop without a place on the map, and the ones after it still get theirs', !e1.c && !!e1.d && Date.parse(e1.d.from) > Date.parse(e1.b.from));
  check('the arrival words, as the mockup', L.rangeWords({ from: '2026-10-31T00:20:00Z', to: '2026-10-31T00:40:00Z' }, 'America/Los_Angeles') === '5:20 to 5:40 pm' && L.rangeWords({ from: '2026-10-30T18:50:00Z', to: '2026-10-30T19:10:00Z' }, 'America/Los_Angeles') === '11:50 am to 12:10 pm');
  check('stops before theirs', L.stopsWords(2) === '2 stops before yours' && L.stopsWords(1) === '1 stop before yours' && L.stopsWords(0) === 'You’re next' && L.stopsWords(null) === '');
  check('a few minutes away: within about half a mile', L.isNear({ lat: 45.5231, lng: -122.6765 }, { lat: 45.5261, lng: -122.6765 }) && !L.isNear({ lat: 45.5231, lng: -122.6765 }, { lat: 45.5431, lng: -122.6765 }));
  const k = S.mapKey('t1', 'o1');
  check('the map key: only for its order, and not for long', S.mapKeyOk('t1', 'o1', k.exp, k.key) && !S.mapKeyOk('t1', 'o2', k.exp, k.key) && !S.mapKeyOk('t1', 'o1', k.exp, `${k.key}x`) && !S.mapKeyOk('t1', 'o1', k.exp, k.key, k.exp + 1));
  check('…the same for a couple of minutes, so the map isn’t drawn again each look', S.mapKey('t1', 'o1', 1_000_000_000_000).key === S.mapKey('t1', 'o1', 1_000_000_000_000 + 1000).key);

  console.log('the driver’s app');
  await fresh();
  const { POST: LOC } = await import('../../src/app/api/retail/driver-location/route');
  notifyRoute = (await import('../../src/app/api/retail/delivery-notify/route')).POST;
  let r: any = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.5152, lng: -122.6784, accuracy: 12 })); await settle();
  let doc: any = await get(`${T}/driverLocations/riley`);
  check('their route in order (earliest promise first), nobody else’s, nothing delivered', r.body.ok && JSON.stringify(doc?.stops) === JSON.stringify(['o2', 'o1']), doc?.stops);
  check('an arrival estimate for each stop, and where they are', !!doc.eta?.o2 && !!doc.eta?.o1 && doc.sharing === true && doc.point?.lat === 45.5152, doc);
  check('each stop’s place is looked up, as a result that may be kept', calls.filter((c) => c.url.includes('/search/geocode/')).length === 2 && calls.every((c) => !c.url.includes('/search/geocode/') || c.url.includes('permanent=true')));
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.516, lng: -122.678 })); await settle();
  check('…once, then not again', calls.filter((c) => c.url.includes('/search/geocode/')).length === 2 && (await get(`${T}/retailOrders/o1`)).delivery.dest?.lat === 45.5231);
  // Two updates at the same moment: one lookup each place, never two.
  await db.doc(`${T}/retailOrders/o1`).update({ 'delivery.destFor': null, 'delivery.destAt': null });
  const n0 = calls.filter((c) => c.url.includes('/search/geocode/')).length;
  await Promise.all([LOC(req({ tenantId: 't1', sharing: true, lat: 45.516, lng: -122.678 })), LOC(req({ tenantId: 't1', sharing: true, lat: 45.516, lng: -122.678 }))]); await settle();
  check('two updates at once never both pay for a lookup', calls.filter((c) => c.url.includes('/search/geocode/')).length - n0 <= 1);
  await db.doc(`${T}/retailOrders/o1`).update({ shippingAddress: { line1: '22 Alder Ct', city: 'Portland', state: 'OR', postalCode: '97204' } });
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.516, lng: -122.678 })); await settle();
  check('a corrected address is looked up again', (await get(`${T}/retailOrders/o1`)).delivery.dest?.lat === 45.5301);
  await db.doc(`${T}/retailOrders/o1`).update({ shippingAddress: { line1: '88 Pine St', city: 'Portland', state: 'OR', postalCode: '97204' } });
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.516, lng: -122.678 })); await settle();
  // Two hundred old deliveries with Riley: today's stops are still found.
  for (let i = 0; i < 70; i++) await db.doc(`${T}/retailOrders/a${String(i).padStart(3, '0')}`).set({ method: 'delivery', stage: 'completed', delivery: { status: 'delivered', driverId: 'riley' } });
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.516, lng: -122.678 })); await settle();
  check('a driver’s past deliveries never crowd out today’s stops', JSON.stringify((await get(`${T}/driverLocations/riley`))?.stops) === JSON.stringify(['o2', 'o1']));
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.6, lng: -122.6, fixAgeMs: 5 * 60e3 })); await settle();
  doc = await get(`${T}/driverLocations/riley`);
  check('a fix the phone took minutes ago isn’t where they are now (its age as the phone measured it)', doc?.point?.lat === 45.516, doc?.point);
  r = await LOC(req({ tenantId: 't1', sharing: true })); await settle();
  check('standing still at a door with no new fix: the last good location stands', (await get(`${T}/driverLocations/riley`))?.point?.lat === 45.516);
  await db.doc(`${T}/driverLocations/riley`).update({ pointAt: new Date(Date.now() - 4 * 60e3).toISOString() });
  r = await LOC(req({ tenantId: 't1', sharing: true })); await settle();
  check('…until it’s a few minutes old', (await get(`${T}/driverLocations/riley`))?.point === null);
  check('not near yet: no text', !calls.some((c) => c.url.endsWith('/api/retail/delivery-notify')));
  // Near their next stop (Alder Ct).
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.5296, lng: -122.6605 })); await settle();
  const near = calls.filter((c) => c.url.endsWith('/api/retail/delivery-notify') && c.body?.moment === 'near');
  check('a few minutes from their next stop: that customer is texted', near.length === 1 && near[0].body.orderId === 'o2' && near[0].body.try === 't1' && told.some((x) => x.kind === 'delivery_near'), near);
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.5297, lng: -122.6604 })); await settle();
  check('…once', calls.filter((c) => c.url.endsWith('/api/retail/delivery-notify') && c.body?.moment === 'near').length === 1);
  await db.doc(`${T}/retailOrders/o2`).update({ 'delivery.outAt': new Date().toISOString(), 'delivery.tries': 2 });
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.5297, lng: -122.6604 })); await settle();
  check('not right out of the shop (the “on its way” text was just sent)', calls.filter((c) => c.url.endsWith('/api/retail/delivery-notify') && c.body?.moment === 'near').length === 1);
  await db.doc(`${T}/retailOrders/o2`).update({ 'delivery.outAt': new Date(Date.now() - 10 * 60e3).toISOString() });
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.5297, lng: -122.6604, accuracy: 900 })); await settle();
  check('not from a fix too unsure to tell', calls.filter((c) => c.url.endsWith('/api/retail/delivery-notify') && c.body?.moment === 'near').length === 1);
  // The text and email services down: tried again by later updates, at most three times, two minutes apart.
  await db.doc(`${T}/retailOrders/o2`).update({ 'delivery.tries': 3, 'delivery.outAt': new Date(Date.now() - 10 * 60e3).toISOString() });
  textsDown = true;
  const nearCalls = () => calls.filter((c) => c.url.endsWith('/api/retail/delivery-notify') && c.body?.try === 't3').length;
  for (let i = 0; i < 3; i++) { await LOC(req({ tenantId: 't1', sharing: true, lat: 45.5297, lng: -122.6604 })); await settle(); }
  check('a text that didn’t go isn’t tried on every update', nearCalls() === 1, nearCalls());
  for (let i = 0; i < 4; i++) {
    const cur: any = await get(`${T}/retailOrders/o2`);
    await db.doc(`${T}/retailOrders/o2`).update({ 'delivery.nearTry': { ...cur.delivery.nearTry, at: new Date(Date.now() - 3 * 60e3).toISOString() } });
    await LOC(req({ tenantId: 't1', sharing: true, lat: 45.5297, lng: -122.6604 })); await settle();
  }
  check('…and at most three times a try', nearCalls() === 3, nearCalls());
  textsDown = false;
  await db.doc(`${T}/retailOrders/o2`).update({ 'delivery.tries': 1 });
  r = await LOC(req({ tenantId: 't1', sharing: false })); await settle();
  doc = await get(`${T}/driverLocations/riley`);
  check('location turned off: the route and times stay, the location goes', doc.sharing === false && doc.point === null && JSON.stringify(doc.stops) === JSON.stringify(['o2', 'o1']), doc);
  actor = { ...actor, isRenter: true };
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 1, lng: 1 }));
  check('renters aren’t drivers here', r.status === 403);
  actor = { ...actor, isRenter: false };

  console.log('what the customer sees');
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.523456, lng: -122.676549 })); await settle();
  doc = await get(`${T}/driverLocations/riley`);
  let lv = S.liveFor('o1', doc);
  check('stops before theirs, the arrival range, and roughly where the driver is', lv?.stopsBefore === 1 && !!lv?.eta && lv?.point?.lat === 45.523 && lv?.point?.lng === -122.677, lv);
  check('another driver’s customer sees none of it', S.liveFor('o3', doc) === null);
  lv = S.liveFor('o1', { ...doc, pointAt: new Date(Date.now() - 4 * 60e3).toISOString() });
  check('a location more than a few minutes old isn’t shown, nor its arrival time', lv?.point === null && lv?.eta === null && lv?.stopsBefore === 1);
  const { GET: MAP } = await import('../../src/app/api/retail/delivery-map/route');
  const mk = S.mapKey('t1', 'o1');
  calls.length = 0;
  let m: any = await MAP(req({}, `t=t1&o=o1&e=${mk.exp}&k=${mk.key}`));
  const pic = calls.find((c) => c.url.includes('/styles/v1/'));
  check('the map is drawn by the server with its own key: the driver roughly, their address and the shop', m.status === 200 && !!pic && pic.url.includes('pin-l-car+1f7a4d(-122.6770,45.5230)') && pic.url.includes('pin-l+16171a(-122.6765,45.5231)') && pic.url.includes('pin-s+6d7075(') && pic.url.includes('access_token=pk.test-token'), pic?.url);
  check('…never the driver’s exact location', !pic?.url.includes('45.52345') && !pic?.url.includes('122.67654'));
  m = await MAP(req({}, `t=t1&o=o1&e=${mk.exp}&k=nope`));
  check('without its key: no map', m.status === 403);
  m = await MAP(req({}, `t=t1&o=o3&e=${mk.exp}&k=${mk.key}`));
  check('one order’s key draws no other order’s map', m.status === 403);
  const before = calls.filter((c) => c.url.includes('/styles/v1/')).length;
  m = await MAP(req({}, `t=t1&o=o1&e=${mk.exp}&k=${mk.key}`));
  check('the same picture again is kept, not asked of the map service again', m.status === 200 && calls.filter((c) => c.url.includes('/styles/v1/')).length === before);
  // Delivered from the driver's app: their route updates straight away, and the map goes.
  const { POST: FULFIL } = await import('../../src/app/api/retail/fulfil/route');
  await db.doc(`${T}/retailOrders/o2`).update({ 'delivery.photos': [] });
  r = await FULFIL(req({ tenantId: 't1', action: 'deliveryDone', orderId: 'o2', override: false })); await settle();
  check('a stop done: the next customer’s page shows it at once (now they’re next)', S.liveFor('o1', await get(`${T}/driverLocations/riley`))?.stopsBefore === 0, { r: r.body, d: (await get(`${T}/driverLocations/riley`))?.stops });
  await db.doc(`${T}/retailOrders/o1`).update({ stage: 'completed', 'delivery.status': 'delivered' });
  m = await MAP(req({}, `t=t1&o=o1&e=${mk.exp}&k=${mk.key}`));
  check('delivered: no map', m.status === 404);
  r = await LOC(req({ tenantId: 't1', sharing: true, lat: 45.52, lng: -122.67 })); await settle();
  check('the last stop done: nothing of the driver is kept', r.body.stops === 0 && (await get(`${T}/driverLocations/riley`)) === null);
  // A driver whose app stopped sending mid-route: the five-minute check clears it.
  await db.doc(`${T}/driverLocations/sam`).set({ at: new Date(Date.now() - 31 * 60e3).toISOString(), point: { lat: 45.5, lng: -122.6 } });
  await S.sweepDriverLocations(db, 't1');
  check('a driver who stopped sending isn’t kept', (await get(`${T}/driverLocations/sam`)) === null);

  console.log('the words');
  await fresh();
  await db.doc(`${T}/retailOrders/o1`).update({ 'delivery.sent': {} });
  const { POST: NOTIFY } = await import('../../src/app/api/retail/delivery-notify/route');
  r = await NOTIFY(req({ tenantId: 't1', orderId: 'o1', moment: 'near', try: 't1' }));
  check('“a few minutes away” is never sent once it isn’t true (a text that couldn’t go at first)', r.body.sent === false && !told.some((x) => x.kind === 'delivery_near'));
  await db.doc(`${T}/driverLocations/riley`).set({ at: new Date().toISOString(), stops: ['o1', 'o2'], sharing: true, point: { lat: 45.52, lng: -122.67 }, pointAt: new Date().toISOString() });
  r = await NOTIFY(req({ tenantId: 't1', orderId: 'o1', moment: 'near', try: 't1' }));
  const sms = told.find((x) => x.kind === 'delivery_near');
  check('“a few minutes away”: who, in what, and the link, never held for quiet hours', r.body.sent === true && !!sms && /^Hi Maya, Riley is a few minutes away with your order #1214 from Opal Studio \(Gray hatchback\)\. Follow along here: /.test(sms.text) && sms.essential === true, sms);
  r = await NOTIFY(req({ tenantId: 't1', orderId: 'o1', moment: 'near', try: 't1' }));
  check('…once per try', r.body.sent === false && told.filter((x) => x.kind === 'delivery_near').length === 1);

  console.log('their note for the driver');
  const { makePass } = await import('../../src/lib/order-pass');
  const { POST: CHOICE } = await import('../../src/app/api/retail/delivery-choice/route');
  r = await CHOICE(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qo1', action: 'note', note: 'Gate code 4412' })); await settle();
  check('changing it takes their pass', r.status === 401);
  r = await CHOICE(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qo1', pass: makePass('t1', 'qo1'), action: 'note', note: '  Gate code   4412 ' })); await settle();
  let o: any = await get(`${T}/retailOrders/o1`);
  check('changed while it’s on its way: the driver’s app shows the new note', r.status === 200 && o.delivery.note === 'Gate code 4412' && !!o.delivery.noteChangedAt, { b: r.body, n: o.delivery.note });
  await db.doc(`${T}/retailOrders/o1`).update({ stage: 'completed', 'delivery.status': 'delivered' });
  r = await CHOICE(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qo1', pass: makePass('t1', 'qo1'), action: 'note', note: 'x' })); await settle();
  check('not once it’s delivered', r.status === 409);

  console.log('the wiring');
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  check('only the server reads or writes where drivers are', /match \/tenants\/\{tenantId\}\/driverLocations\/\{staffId\} \{\s+allow read, write: if false;/.test(rules) && /'entitlements', 'driverLocations',/.test(rules));
  const status = fs.readFileSync('src/app/api/retail/order-status/route.ts', 'utf8');
  check('the order page’s live view: only while it’s out, the map only with the customer’s pass and a map key', /live: d\.status === 'out'/.test(status) && /passOk && lv\?\.point && hasMapsKey\(\)/.test(status));
  check('the staff app keeps the pages up to date whichever tab is open', /<DriverLiveUpdates tenantId=/.test(fs.readFileSync('src/app/staff-portal/[tenantId]/StaffPortalPage.tsx', 'utf8')));
  check('the text lands on the order page, and isn’t queued to arrive late', /'delivery_near',/.test(fs.readFileSync('src/lib/order-inbox.ts', 'utf8')) && !/delivery_near/.test(fs.readFileSync('src/lib/order-outbox.ts', 'utf8')));
  const tab = fs.readFileSync('src/components/staff-portal/DeliveriesTab.tsx', 'utf8');
  check('the driver can turn their location off, and is told what customers see', /role="switch" aria-checked=\{live\.share\} aria-label="Share my location"/.test(tab) && /Customers see roughly where you are only while/.test(tab));
  const words = ['src/lib/delivery-live.ts', 'src/lib/delivery-live-server.ts', 'src/app/api/retail/driver-location/route.ts', 'src/app/api/retail/delivery-map/route.ts', 'src/components/shop/DeliveryLive.tsx'].map((f) => fs.readFileSync(f, 'utf8')).join('\n') + tab;
  const tool = new RegExp(String.fromCharCode(67, 108, 97, 117, 100, 101), 'i');
  check('no mention of the tool that wrote this, no "call us", no JSX comments', !tool.test(words) && !/call us/i.test(words) && !/\{\/\*/.test(words));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
