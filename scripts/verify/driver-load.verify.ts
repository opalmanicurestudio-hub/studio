// Checks drivers shared by hot food and shop delivery, and slowing new deliveries down (design board "Drivers shared, and
// a pause for busy nights"; lib/driver-load, lib/driver-load-server).
// - Each hot delivery keeps a driver out from when it should leave, there and back with a few minutes at the door; shop
//   runs out with a driver keep them until their route has them back. A time is offered only when a driver on the
//   schedule is free for the whole trip; with nobody on the schedule as a driver, there's no limit.
// - Paused or more minutes added from the counter: over by itself.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/driver-load.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';

(async () => {
  const L = await import('../../src/lib/driver-load');
  const t0 = Date.parse('2026-11-20T18:00:00Z'); const m = (n: number) => t0 + n * 60000; const iso = (n: number) => new Date(m(n)).toISOString();
  console.log('the rules');
  const trip = L.hotTrip(m(0), 10);
  check('a hot delivery keeps a driver out there and back, with a few minutes at the door', trip.from === m(0) && trip.to === m(25));
  const one = () => 1; const none = () => null;
  check('free through a whole trip: the fewest free at any moment of it', L.freeThrough(one, [trip], m(10), m(35)) === 0 && L.freeThrough(one, [trip], m(25), m(50)) === 1 && L.freeThrough(() => 2, [trip], m(10), m(35)) === 1);
  const d = L.drivableTimes([iso(15), iso(30)], 10, one, [trip]);
  check('the times a driver can make: one leaving while the only driver is out is full', d.ok.join() === iso(30) && d.full.join() === iso(15), d);
  check('with nobody on the schedule as a driver: every time, as before', L.drivableTimes([iso(15)], 10, none, [trip]).ok.length === 1);
  const sh = (t: number) => (t < m(60) ? 1 : 0);
  check('a driver going off shift partway through the trip can’t take it', L.drivableTimes([iso(40)], 10, sh, []).full.length === 1);
  let s = L.deliveryNowOf({ deliveryNow: { pausedUntil: iso(30), by: 'Ana' } }, m(0));
  check('paused until a time; over by itself', s.paused && s.until === iso(30) && s.by === 'Ana' && !L.deliveryNowOf({ deliveryNow: { pausedUntil: iso(30) } }, m(31)).paused);
  s = L.deliveryNowOf({ deliveryNow: { extraMin: 15, extraUntil: iso(60) } }, m(0));
  check('…minutes added, for a while; only the choices', s.extraMin === 15 && L.deliveryNowOf({ deliveryNow: { extraMin: 15, extraUntil: iso(60) } }, m(61)).extraMin === 0 && L.deliveryNowOf({ deliveryNow: { extraMin: 45, extraUntil: iso(60) } }, m(0)).extraMin === 0);

  console.log('the drivers now');
  const now = Date.now(); const day = new Date(now).toISOString().slice(0, 10);
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { deliveryPlan: { on: true, drivers: ['d1', 'd2'] } } });
  const DL = await import('../../src/lib/driver-load-server');
  let r = await DL.driverLoad(db, 't1', await (await db.doc(T).get()).data(), now);
  check('no shifts for the drivers today: no limit', r.onNow === null && r.onShift(now) === null && r.trips.length === 0, r);
  const hm = (t: number) => new Date(t).toISOString().slice(11, 16);
  await db.doc(`${T}/shifts/s1`).set({ date: day, staffId: 'd1', startTime: hm(now - 3600e3 > Date.parse(`${day}T00:00:00Z`) ? now - 3600e3 : Date.parse(`${day}T00:00:00Z`)), endTime: '23:59', status: 'published', kind: 'work' });
  await db.doc(`${T}/shifts/s2`).set({ date: day, staffId: 'x9', startTime: '00:00', endTime: '23:59', kind: 'work' });
  const slot = new Date(Math.ceil((now + 10 * 60000) / 300000) * 300000).toISOString();
  await db.doc(`${T}/counterOrders/h1`).set({ day, status: 'sent', paidAt: new Date(now).toISOString(), ahead: { way: 'delivery', slot, delivery: { state: 'waiting', driveMin: 12 } } });
  await db.doc(`${T}/counterOrders/h2`).set({ day, status: 'building', paidAt: null, ahead: { way: 'delivery', slot, delivery: { state: 'waiting', driveMin: 12 } } });
  await db.doc(`${T}/counterOrders/h3`).set({ day, status: 'done', paidAt: new Date(now).toISOString(), ahead: { way: 'delivery', slot, delivery: { state: 'out', outAt: new Date(now - 5 * 60000).toISOString(), driverId: 'd2', driverName: 'Rio', driveMin: 8 } } });
  await db.doc(`${T}/retailOrders/o1`).set({ delivery: { status: 'out', driverId: 'd2', outAt: new Date(now - 10 * 60000).toISOString() } });
  await db.doc(`${T}/private/route_d2`).set({ view: { backAt: new Date(now + 40 * 60000).toISOString() } });
  DL.forgetDriverLoad('t1');
  r = await DL.driverLoad(db, 't1', await (await db.doc(T).get()).data(), now);
  const d2 = r.trips.find((t: any) => t.from <= now && t.to > now);
  check('on the schedule as drivers: only the drivers (not anyone else on shift)', r.onNow === 1, r.onNow);
  check('hot food paid and waiting to leave keeps a driver from its leave time; one not paid doesn’t', r.trips.filter((t: any) => t.hot && t.from === Date.parse(slot)).length === 1, r.trips);
  check('free drivers are counted one by one: Rio out (not on the schedule) takes nobody’s place; hot food not given to anyone yet takes one', L.freeAt(r.onShift(now)!, r.trips, now) === 1 && L.freeAt(r.onShift(Date.parse(slot) + 60000)!, r.trips, Date.parse(slot) + 60000) === 0, r.trips);
  check('…someone the counter typed by name is out, but takes no driver’s place', L.freeAt(['d1'], [{ from: now - 1, to: now + 60000, counts: false }], now) === 1 && L.freeAt(['d1'], [{ from: now - 1, to: now + 60000, driverId: 'd1' }], now) === 0);
  check('a driver out with hot food and shop stops counts once, until their route has them back (shop delivery counts that run itself)', r.outNow === 1 && r.hotOutNow === 0 && !!d2 && d2.to === now + 40 * 60000 && r.backAt === new Date(now + 40 * 60000).toISOString(), { trips: r.trips, outNow: r.outNow });

  console.log('being paid for, and who counts');
  const ago = (min: number) => new Date(now - min * 60000).toISOString();
  await db.doc(`${T}/counterOrders/p1`).set({ day, status: 'building', paidAt: null, createdAt: ago(2), ahead: { way: 'delivery', state: 'awaiting_pay', checkout: 'k1', slot, delivery: { state: 'waiting', driveMin: 12 } } });
  await db.doc(`${T}/counterOrders/p2`).set({ day, status: 'building', paidAt: null, createdAt: ago(40), ahead: { way: 'delivery', state: 'awaiting_pay', checkout: 'k2', slot, delivery: { state: 'waiting', driveMin: 12 } } });
  await db.doc(`${T}/counterOrders/h4`).set({ day, status: 'done', paidAt: ago(1), ahead: { way: 'delivery', slot, delivery: { state: 'out', outAt: ago(3), driverId: 'd1', driveMin: 10 } } });
  await db.doc(`${T}/counterOrders/h5`).set({ day, status: 'done', paidAt: ago(1), ahead: { way: 'delivery', slot, delivery: { state: 'out', outAt: ago(3), driverId: 'z7', driveMin: 10 } } });
  DL.forgetDriverLoad('t1');
  const T0 = await (await db.doc(T).get()).data();
  r = await DL.driverLoad(db, 't1', T0, now);
  const atSlot = (x: any) => x.trips.filter((t: any) => t.hot && t.from === Date.parse(slot)).length;
  check('an order being paid for in the last few minutes holds a driver too (two guests can’t both take the last one); one left unpaid longer doesn’t', atSlot(r) === 2, r.trips);
  const mine = await DL.driverLoad(db, 't1', T0, now, { skipCheckout: 'k1' });
  check('…never the guest’s own earlier try, read afresh', atSlot(mine) === 1);
  check('hot food out with only hot food on it counts for shop delivery; with one who isn’t a listed driver, not', r.hotOutNow === 1 && r.trips.some((t: any) => t.driverId === 'z7' && t.counts === false), { hotOutNow: r.hotOutNow, trips: r.trips });

  console.log('each driver, for the counter');
  check('out with what they have, back about when (one on the list but off the schedule, out too)', r.drivers.length === 2 && r.drivers.every((x: any) => x.state === 'out' && !!x.backAt), r.drivers);
  const w = new Date(now); const wallMin = w.getUTCHours() * 60 + w.getUTCMinutes();
  await db.doc(`tenants/t3`).set({ name: 'Bay', timezone: 'UTC', retailSettings: { deliveryPlan: { on: true, drivers: ['e1', 'e2', 'e3'] } } });
  await db.doc(`tenants/t3/shifts/a`).set({ date: day, staffId: 'e1', startTime: '00:00', endTime: '23:59', kind: 'work' });
  if (wallMin < 1380) await db.doc(`tenants/t3/shifts/b`).set({ date: day, staffId: 'e2', startTime: hm(now + 30 * 60000), endTime: '23:59', kind: 'work' });
  const r3 = await DL.driverLoad(db, 't3', await (await db.doc('tenants/t3').get()).data(), now);
  const e2 = r3.drivers.find((x: any) => x.id === 'e2');
  check('…here and free; on later today (when); one off today isn’t listed', r3.drivers.find((x: any) => x.id === 'e1')?.state === 'free' && !r3.drivers.some((x: any) => x.id === 'e3') && (wallMin >= 1380 || (e2?.state === 'later' && Math.abs(Date.parse(String(e2.onAt)) - (now + 30 * 60000)) < 61000)), r3.drivers);

  console.log('the screens and the steps');
  const fs = await import('fs'); const src = (p: string) => fs.readFileSync(p, 'utf8');
  const ahead = src('src/lib/counter-ahead.ts'); const shop = src('src/lib/delivery-server.ts'); const desk = src('src/components/drive-thru/Deliveries.tsx'); const order = src('src/app/order/[tenantId]/page.tsx'); const api = src('src/app/api/counter/route.ts');
  check('ordering ahead: only drivable times, paused refused, added minutes, re-checked when placed', /drivableTimes\(leave, r\.driveMin, load\.onShift, load\.trips\)/.test(ahead) && /'paused'/.test(ahead) && /'no_driver'/.test(ahead) && /forgetDriverLoad\(tenantId\)/.test(ahead) && /pickupDelayMin\(pace\) \+ slowMin/.test(ahead));
  check('shop delivery within the hour: hot food out counts, and a pause stops it', /out \+ hotOut/.test(shop) && /slow\.paused && asap0\.ok/.test(shop));
  check('the counter: drivers on now, Slow it down (add time, pause), back to normal', /Slow it down/.test(desk) && /Pause for today/.test(desk) && /Take orders again/.test(desk) && /drivers on now|driver' : 'drivers'} on now/.test(desk) && /action === 'deliverySlow'/.test(api));
  check('the guest’s page: times marked full when no driver can make them, and the pause said', /No driver free/.test(order) && /our drivers are out then/.test(order) && /try again after/.test(order));
  check('house style', ![desk].some((x) => /\buppercase\b|font-black/.test(x)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
