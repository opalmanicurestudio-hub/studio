// Checks curbside (lib/curbside, lib/curbside-server, api/curbside, curbside in ordering ahead, components/orders/
// CurbsideScreen).
// - One list: the shop's curbside orders and café orders placed ahead for curbside; outside first, longest wait first;
//   on the way; how many later.
// - Ordering ahead: curbside is a way to pick up once it's on; I'm here says where they are; the floor hears at once.
// - The runner: Bringing it out only once it's ready and they're here (their page says so, with a first name); Handed
//   over finishes it (the kitchen's tickets are served); renters can't.
// - On the way and pulling in: I'm on my way (about how far, what they're driving); checked in by their phone's location
//   once they pull in (where can come after); the runner sees which.
// - The screen and where it's reached.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/curbside.verify.tsx
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'runner1', name: 'Maria Lopez', role: 'staff', isManager: false };
let pushed = 0;
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: TENANT }) };
  if (request === '@/lib/push' || /\/src\/lib\/push(\.ts)?$/.test(request)) return fake(request, { pushNow: async () => { pushed++; } });
  return load.call(this, request, ...rest);
};

const TENANT: any = { name: 'North Pier', timezone: 'UTC', orderAhead: { on: true, curbside: true } };
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer x' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const L = await import('../../src/lib/curbside');
  const now = Date.parse('2026-11-19T20:00:00.000Z'); const ago = (m: number) => new Date(now - m * 60000).toISOString();

  console.log('one list');
  const shop = [
    { id: 's1', method: 'curbside', stage: 'arrived', curbside: { arrivedAt: ago(6), spotOrVehicle: 'Spot 3' } },
    { id: 's2', method: 'curbside', stage: 'packed', curbside: { onWayAt: ago(2), etaMinutes: 6 } },
    { id: 's3', method: 'curbside', stage: 'paid' },
    { id: 's4', method: 'counter', stage: 'arrived', curbside: { arrivedAt: ago(9) } },
    { id: 's5', method: 'ship', stage: 'packed' },
  ];
  const cafe: any[] = [{ kind: 'cafe', id: 'c1', hereAt: ago(2), state: 'making' }, { kind: 'cafe', id: 'c2', hereAt: null, at: '2026-11-19T21:15:00.000Z', state: 'later' }];
  const b = L.curbsideBoard(shop, cafe, now);
  check('outside: curbside only (a counter pickup isn’t), shop and café together, longest wait first', b.outside.map((r) => r.key).join() === 's:s1,c:c1', b.outside.map((r) => r.key));
  check('…on the way, and how many later with the next time', b.coming.map((r) => r.key).join() === 's:s2' && b.later.count === 2 && b.later.next === '2026-11-19T21:15:00.000Z', b);
  check('minutes waited', L.waitedMin(now - 6.5 * 60000, now) === 6 && L.waitedMin(now, now) === 0);
  const S = await import('../../src/lib/curbside-server');
  const fut = new Date(Date.now() + 3600000).toISOString();
  check('the kitchen: nothing to make is ready; all ready is ready; held for later; else being made', S.kitchenState([]) === 'ready' && S.kitchenState([{ status: 'ready' }, { status: 'cancelled' }]) === 'ready'
    && S.kitchenState([{ status: 'pending', holdUntil: fut }]) === 'later' && S.kitchenState([{ status: 'cooking' }, { status: 'ready' }]) === 'making');

  console.log('ordering ahead');
  const A = await import('../../src/lib/counter-ahead');
  check('curbside is a way to pick up only once it’s on', A.aheadOf({ orderAhead: { on: true, curbside: true } }).ways.join() === 'drive-thru,inside,curbside' && A.aheadOf({ orderAhead: { on: true } }).ways.join() === 'drive-thru,inside'
    && A.aheadOf({ orderAhead: { on: true, driveThru: false, inside: false, curbside: true } }).ways.join() === 'curbside');
  const menu = src('src/app/api/menu/route.ts');
  check('the Menu page saves it, and curbside alone is enough', /if \(typeof b\.curbside === 'boolean'\) patch\.curbside = b\.curbside;/.test(menu) && /next\.driveThru === false && next\.inside === false && next\.curbside !== true/.test(menu) && /curbside: a\.curbside === true/.test(menu));
  const created = new Date().toISOString(); const day = new Date().toISOString().slice(0, 10);
  const order = (id: string, extra: any = {}) => db.doc(`${T}/counterOrders/${id}`).set({ channel: 'ahead', day, number: id === 'o1' ? '58' : '59', guestName: 'Ana Ortiz', paidAt: created, createdAt: created, status: 'sent', total: 9.75,
    lines: [{ name: 'Latte', quantity: 1, unitPrice: 5.25 }, { name: 'Butter croissant', quantity: 1, unitPrice: 4.5 }], ahead: { way: 'curbside', code: '4821', state: 'paid' }, ...extra });
  await db.doc(T).set(TENANT);
  await order('o1'); await db.doc(`${T}/kdsTickets/k1`).set({ orderId: 'o1', status: 'cooking' }); await db.doc(`${T}/kdsTickets/k2`).set({ orderId: 'o1', status: 'ready' });
  let r: any = await A.aheadHere(db, 't1', 'o1', {});
  check('I’m here for curbside: where they are is asked for', !r.ok && r.code === 'where' && /Say where you are/.test(r.error) && !(await get(`${T}/counterOrders/o1`)).ahead.hereAt, r);
  r = await A.aheadHere(db, 't1', 'o1', { where: '  Blue Jeep,\n by the door ', note: 'Please knock' });
  let o: any = await get(`${T}/counterOrders/o1`);
  const notes = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());
  check('…kept, tidied, with what to know, and the floor hears at once', r.ok && o.ahead.curb.where === 'Blue Jeep, by the door' && o.ahead.curb.note === 'Please knock' && !!o.ahead.hereAt && o.ahead.curb.arrivedAt === o.ahead.hereAt
    && notes.length === 1 && notes[0].type === 'curbside_here' && notes[0].userId === null && notes[0].link === '/curbside' && notes[0].title === 'Ana is outside' && notes[0].message === 'Order 58 for curbside: Blue Jeep, by the door. Please knock' && pushed === 1, { o: o.ahead, notes });
  r = await A.aheadHere(db, 't1', 'o1', { where: 'Spot\u202e 4\u200b\u0085' });
  check('…saying it again only changes where, with invisible and control characters taken out (what to know is kept; no second alert)', r.ok && (await get(`${T}/counterOrders/o1`)).ahead.curb.where === 'Spot 4' && (await get(`${T}/counterOrders/o1`)).ahead.curb.note === 'Please knock' && (await db.collection(`${T}/notifications`).get()).docs.length === 1);
  let v: any = await A.aheadView(db, 't1', TENANT, 'o1');
  check('their page: where they said, nobody out yet (nothing they asked is shown back to them), and no location once they’re here', v.way === 'curbside' && v.here && JSON.stringify(v.curb) === JSON.stringify({ where: 'Spot 4', out: false, by: null, onWay: false, eta: null, found: false }) && v.geo === null, v);
  await order('o2', { ahead: { way: 'inside', code: '1111', state: 'paid' } });
  r = await A.aheadHere(db, 't1', 'o2', {});
  check('inside, I’m here needs nothing more', r.ok && !(await get(`${T}/counterOrders/o2`)).ahead.curb);

  console.log('the runner');
  const { POST } = await import('../../src/app/api/curbside/route');
  const C = (body: any) => POST(req({ tenantId: 't1', ...body }));
  await order('o3'); await db.doc(`${T}/kdsTickets/k3`).set({ orderId: 'o3', status: 'pending', holdUntil: fut });
  await order('o4', { status: 'done' }); await order('o5', { ahead: { way: 'curbside', state: 'canceled' } }); await order('o6', { paidAt: null });
  r = await C({ action: 'list' });
  const ids = r.body.cafe.map((x: any) => x.id).sort().join();
  const one = r.body.cafe.find((x: any) => x.id === 'o1');
  check('the list: paid curbside orders not handed over (not inside, done, cancelled or unpaid)', r.body.ok && ids === 'o1,o3' && r.body.on === true, r.body);
  check('…each with where, what, and the kitchen', one.where === 'Spot 4' && one.note === 'Please knock' && one.state === 'making' && one.items === 2 && one.summary === 'latte, butter croissant' && one.number === '58'
    && r.body.cafe.find((x: any) => x.id === 'o3').state === 'later' && r.body.cafe.find((x: any) => x.id === 'o3').hereAt === null, one);
  r = await C({ action: 'out', orderId: 'o1' });
  check('Bringing it out waits for the kitchen', r.status === 409 && /isn’t ready yet/.test(r.body.error), r.body);
  r = await C({ action: 'handed', orderId: 'o1' });
  check('…and so does Handed over', r.status === 409 && /isn’t ready yet/.test(r.body.error));
  await db.doc(`${T}/kdsTickets/k1`).set({ status: 'ready' }, { merge: true });
  await db.doc(`${T}/kdsTickets/k3`).set({ status: 'ready', holdUntil: null }, { merge: true });
  r = await C({ action: 'out', orderId: 'o3' });
  check('…and for them to be here', r.status === 409 && /haven’t said they’re here/.test(r.body.error));
  r = await C({ action: 'out', orderId: 'o1' }); v = await A.aheadView(db, 't1', TENANT, 'o1');
  check('out: their page says someone’s bringing it, by first name', r.body.ok && v.curb.out === true && v.curb.by === 'Maria', v.curb);
  r = await C({ action: 'out', orderId: 'o1' });
  check('…a second tap changes nothing', r.body.ok && r.body.already === true);
  r = await C({ action: 'handed', orderId: 'o1' }); o = await get(`${T}/counterOrders/o1`); v = await A.aheadView(db, 't1', TENANT, 'o1');
  check('handed over: done, the kitchen’s tickets served, and their page says picked up', r.body.ok && o.status === 'done' && o.ahead.curb.handedBy === 'Maria' && (await get(`${T}/kdsTickets/k1`)).status === 'delivered'
    && (await get(`${T}/kdsTickets/k2`)).status === 'delivered' && (await get(`${T}/kdsTickets/k2`)).deliveredBy.via === 'curbside' && v.kitchen === 'handed', { o, v: v.kitchen });
  r = await C({ action: 'list' });
  check('…and off the list', !r.body.cafe.some((x: any) => x.id === 'o1'));
  r = await C({ action: 'handed', orderId: 'o2' });
  check('an order that isn’t curbside isn’t moved here', r.status === 404);
  actor = { uid: 'r1', name: 'Rae', role: 'renter', isRenter: true };
  r = await C({ action: 'list' });
  check('renters don’t see or move the business’s orders', r.status === 403);

  console.log('on the way, and pulling in');
  const G = await import('../../src/lib/pickup-geo');
  const PIN = { ...TENANT, retailSettings: { curbsideLat: 40.7128, curbsideLng: -74.006 } };
  check('where pickups happen: the spot the shop pinned first', JSON.stringify(await G.pickupGeoOf(db, 't1', { ...PIN, studioLocation: { lat: 1, lng: 1 } })) === JSON.stringify({ lat: 40.7128, lng: -74.006 }));
  await db.doc(`${T}/locations/l1`).set({ isActive: true, coordinates: { lat: 41.1, lng: -73.2 } });
  check('…else the one location with coordinates, else the business’s own', JSON.stringify(await G.pickupGeoOf(db, 't1', { ...TENANT, studioLocation: { lat: 1, lng: 1 } })) === JSON.stringify({ lat: 41.1, lng: -73.2 }));
  await db.doc(`${T}/locations/l2`).set({ isActive: true, coordinates: { lat: 42.2, lng: -72.1 } });
  check('…the locations are read at most once a minute (a guest’s page asks every few seconds)', JSON.stringify(await G.pickupGeoOf(db, 't1', { ...TENANT, studioLocation: { lat: 1, lng: 1 } })) === JSON.stringify({ lat: 41.1, lng: -73.2 }));
  G.forgetPickupGeo('t1');
  check('…two pinned locations is a guess, so not one of them; nothing usable is none', JSON.stringify(await G.pickupGeoOf(db, 't1', { ...TENANT, studioLocation: { lat: 1, lng: 1 } })) === JSON.stringify({ lat: 1, lng: 1 })
    && (await G.pickupGeoOf(db, 't1', { ...TENANT, studioLocation: { lat: 0, lng: 0 } })) === null && (await G.pickupGeoOf(db, 't1', { retailSettings: { curbsideLat: 'x', curbsideLng: 5 } })) === null);
  await order('o7'); await order('o8', { paidAt: null }); await order('o9'); await order('o10');
  v = await A.aheadView(db, 't1', PIN, 'o7');
  check('their page, not here yet: where to pull in, to say how far and check them in', JSON.stringify(v.geo) === JSON.stringify({ lat: 40.7128, lng: -74.006 }) && v.curb.onWay === false, v);
  r = await A.aheadOnWay(db, 't1', 'o7', { eta: 7.4, where: ' Red Mini ' }); o = await get(`${T}/counterOrders/o7`);
  const onWayAt = o.ahead.curb.onWayAt; v = await A.aheadView(db, 't1', PIN, 'o7');
  check('I’m on my way: when, about how far, and what they’re driving; no alert', r.ok && !!onWayAt && o.ahead.curb.etaMinutes === 7 && o.ahead.curb.where === 'Red Mini' && !o.ahead.hereAt && pushed === 1
    && v.curb.onWay === true && v.curb.eta === 7 && v.curb.where === 'Red Mini', o.ahead);
  r = await A.aheadOnWay(db, 't1', 'o7', { eta: null }); o = await get(`${T}/counterOrders/o7`);
  check('…again with no new minutes: the last ones are kept', r.ok && o.ahead.curb.etaMinutes === 7);
  r = await A.aheadOnWay(db, 't1', 'o7', { eta: 400 }); o = await get(`${T}/counterOrders/o7`);
  check('…again: when they set off is kept, and a distance that isn’t a drive away isn’t shown', r.ok && o.ahead.curb.onWayAt === onWayAt && o.ahead.curb.etaMinutes === null && o.ahead.curb.where === 'Red Mini');
  const bad = [await A.aheadOnWay(db, 't1', 'o2', {}), await A.aheadOnWay(db, 't1', 'o8', {}), await A.aheadOnWay(db, 't1', 'nope', {})] as any[];
  check('…only for paid curbside orders', bad[0].status === 409 && /isn’t for curbside/.test(bad[0].error) && bad[1].status === 409 && bad[2].status === 404, bad);
  const listed = await S.cafeCurbside(db, 't1', TENANT, Date.now() + 10000);
  const w7 = listed.find((x: any) => x.id === 'o7') as any;
  check('the runner’s list: on the way, with the minutes they said', !!w7 && !!w7.onWayAt && w7.eta === null && w7.where === 'Red Mini' && w7.found === false && w7.hereAt === null, w7);
  const b2 = L.curbsideBoard([], [{ kind: 'cafe', id: 'w1', hereAt: null, onWayAt: ago(2), eta: 6, at: null, state: 'making' } as any, { kind: 'cafe', id: 'w2', hereAt: null, at: null, state: 'later' } as any], now);
  check('…under On the way, not later; about how many minutes now', b2.coming.map((x) => x.key).join() === 'c:w1' && b2.later.count === 1 && L.cafeMinutesAway({ onWayAt: ago(2), eta: 6 }, now) === 4
    && L.cafeMinutesAway({ onWayAt: ago(9), eta: 6 }, now) === 0 && L.cafeMinutesAway({ onWayAt: ago(2), eta: null }, now) === null && L.cafeMinutesAway({ onWayAt: null, eta: 6 }, now) === null);
  r = await A.aheadHere(db, 't1', 'o7', { source: 'geo', distanceM: 61.6 }); o = await get(`${T}/counterOrders/o7`);
  let n7 = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data()).filter((x: any) => /Order 59/.test(x.message));
  check('pulled in, found by their phone: checked in with the car they said on the way, and the floor hears', r.ok && !!o.ahead.hereAt && o.ahead.curb.where === 'Red Mini' && o.ahead.curb.source === 'geo' && o.ahead.curb.distanceM === 62
    && n7.length === 1 && n7[0].message === 'Order 59 for curbside: Red Mini.' && pushed === 2, { a: o.ahead, n7 });
  await A.aheadOnWay(db, 't1', 'o9', {});
  r = await A.aheadHere(db, 't1', 'o9', { source: 'geo', distanceM: 5000 }); o = await get(`${T}/counterOrders/o9`); v = await A.aheadView(db, 't1', PIN, 'o9');
  n7 = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data()).filter((x: any) => /found by their location/.test(x.message));
  check('…with nothing said about the car, where comes later (and a distance no lot is that big isn’t kept)', r.ok && !!o.ahead.hereAt && o.ahead.curb.where === null && o.ahead.curb.source === 'geo' && o.ahead.curb.distanceM === undefined
    && n7.length === 1 && n7[0].message === 'Order 59 for curbside: just pulled in (found by their location).' && v.curb.found === true && v.curb.where === null && v.geo === null, { a: o.ahead, v });
  const hereAt9 = o.ahead.hereAt; const count = (await db.collection(`${T}/notifications`).get()).docs.length;
  r = await A.aheadHere(db, 't1', 'o9', { source: 'geo', distanceM: 10 }); o = await get(`${T}/counterOrders/o9`);
  check('…the phone again changes nothing', r.ok && (r as any).already === true && o.ahead.hereAt === hereAt9 && o.ahead.curb.distanceM === undefined && (await db.collection(`${T}/notifications`).get()).docs.length === count);
  r = await A.aheadHere(db, 't1', 'o9', { where: 'White van, spot 2' }); o = await get(`${T}/counterOrders/o9`);
  check('…they say where after: kept, still found by their phone, no second alert', r.ok && o.ahead.curb.where === 'White van, spot 2' && o.ahead.curb.source === 'geo' && o.ahead.hereAt === hereAt9 && (await db.collection(`${T}/notifications`).get()).docs.length === count);
  await order('o11'); r = await A.aheadHere(db, 't1', 'o11', { source: 'geo' }); o = await get(`${T}/counterOrders/o11`);
  check('…a phone that said no distance doesn’t store one as “in the lot”', r.ok && o.ahead.curb.source === 'geo' && o.ahead.curb.distanceM === undefined, o.ahead.curb);
  r = await A.aheadHere(db, 't1', 'o10', {});
  check('a tap with nothing said is still asked where (only the phone can check in without it)', !r.ok && (r as any).code === 'where' && !(await get(`${T}/counterOrders/o10`)).ahead.hereAt);
  r = await A.aheadOnWay(db, 't1', 'o9', { eta: 5 }); o = await get(`${T}/counterOrders/o9`);
  check('on my way after they’re here changes nothing', r.ok && o.ahead.curb.etaMinutes === null);
  const rt = src('src/app/api/counter/ahead/route.ts');
  check('the guest’s link signs it: on my way only with their order’s signature', /\['done', 'track', 'here', 'onway', 'textMe'(, 'deliveryChoice')?(, 'cancel')?\]\.includes\(action\) && \(!ID\.test\(orderId\) \|\| !aheadSigOk/.test(rt) && /source: b\.source, distanceM: b\.distanceM/.test(rt));

  console.log('the screen');
  const { renderToStaticMarkup } = await import('react-dom/server'); const React = await import('react');
  const { CafeCard } = await import('../../src/components/orders/CurbsideScreen');
  const card = (c: any) => renderToStaticMarkup(React.createElement(CafeCard, { c, since: Date.now() - 6 * 60000, now: Date.now(), onOut: async () => {}, onHanded: async () => {} }));
  const base = { kind: 'cafe', id: 'o9', number: '61', name: 'Jo Park', where: 'Silver Civic, spot 3', note: 'Can’t come in, please bring it to the window', hereAt: ago(6), outAt: null, outBy: null, at: null, state: 'ready', items: 2, summary: 'latte, butter croissant' };
  const h1 = card(base); const t1 = h1.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('a café card: what they asked first, then the car in big type, who and what, the wait in amber at five minutes', t1.indexOf('Can’t come in') < t1.indexOf('Silver Civic, spot 3') && t1.includes('Jo Park, café order 61, latte, butter croissant') && /Waiting 6 min/.test(t1) && /cf-anim-pulse/.test(h1), t1);
  check('…ready: both taps open, named for the guest', /aria-label="Bringing it out to Jo"/.test(h1) && /aria-label="Hand over to Jo"/.test(h1) && !/disabled=""[^>]*aria-label="Bringing it out to Jo"/.test(h1));
  const t2 = card({ ...base, state: 'making', note: null }).replace(/<[^>]+>/g, ' ');
  check('…being made: both wait, and it says why', t2.includes('Being made') && t2.includes('Both open up once the kitchen marks it ready.'));
  const t3 = card({ ...base, outAt: ago(1), outBy: 'Maria' }).replace(/<[^>]+>/g, ' ');
  check('…taken out: who’s taking it, and only Handed over left', t3.includes('Maria is taking it out') && t3.includes('On the way out') && !t3.includes('Bringing it out') && t3.includes('Hand over'));
  const t4 = card({ ...base, where: null, note: null, found: true }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('…found by their phone with no car said: look for them', t4.includes('Just pulled in') && t4.includes('Found by their phone’s location. They haven’t said their car yet: look for them, or ask them to add it.'), t4);
  const t5 = card({ ...base, found: true }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('…found with a car said: the car, and how they were found', t5.includes('Silver Civic, spot 3') && t5.includes('Found by their phone’s location') && !t5.includes('haven’t said'));
  const scr = src('src/components/orders/CurbsideScreen.tsx');
  const pk = src('src/components/orders/PickupsScreen.tsx');
  check('a shop customer who can’t come in is said first, on Pickups too', /o\.curbside\?\.bringToVehicle \? 'Bring it to the car' : ''/.test(pk) && /carFirst \? <>/.test(pk));
  check('shop orders as on Pickups: the same card (car first), and handed over by checking their code or name', /<HereCard key=\{r\.key\} carFirst/.test(scr) && /<HandoverSheet fs=\{fs\}/.test(scr) && /bringingOut\(fs, tenantId, o, actor\)/.test(scr) && /useArrivalAlerts\((orders|mine|cafeLoaded \? mine : \[\]), now, tenantId/.test(scr));
  check('café orders every few seconds, and a new arrival is said once', /setInterval\(\(\) => \{ if \(document\.visibilityState === 'visible'\) void loadCafe\(\); \}, 5000\)/.test(scr) && /already here when the screen opened: not news/.test(scr));
  check('the page, the menu, the team app and the alert reach it', fs.existsSync('src/app/(app)/curbside/page.tsx') && /'\/curbside', '\/drive-live'\]/.test(src('src/components/shared/PortalScope.tsx'))
    && /href: '\/curbside'/.test(src('src/components/shared/AppSidebar.tsx')) && /if \(href === '\/curbside'\) return curbsideOn\(tenant\);/.test(src('src/lib/modules.ts'))
    && /curbside_here: 'now'/.test(src('src/lib/push-tier.ts')) && /orders_fast curbside_here/.test(src('src/lib/notify-prefs.ts')) && /'\/curbside', '\/drive-live'\];/.test(src('src/lib/push.ts')) && /curbside=\{curbsideOn\(portalTenant\)\}/.test(src('src/app/staff-portal/[tenantId]/StaffPortalPage.tsx')));
  const { curbsideOn } = await import('../../src/lib/modules');
  check('shown while the café offers it, or a shop that’s on does (its pickup tools on)', curbsideOn({ orderAhead: { on: true, curbside: true } }) === true && curbsideOn({ orderAhead: { on: false, curbside: true } }) === false && curbsideOn({}) === false
    && curbsideOn({ modules: { retail: true } }) === true && curbsideOn({ modules: { retail: true }, retailSettings: { curbsideOffered: false } }) === false && curbsideOn({ modules: { retail: true, pickup: false } }) === false);
  const pg = src('src/app/order/[tenantId]/page.tsx');
  check('the guest: Curbside to choose, I’m here asks where (said out loud, focus back on it), they can say where again after moving, and their page says when it’s on its way out', /(w === 'curbside' \? 'Curbside'|curbside: 'Curbside')/.test(pg) && /Where are you\?/.test(pg) && /On its way out to you/.test(pg) && /bringing it to your car/.test(pg)
    && /role=\{whereErr \? 'alert' : undefined\}/.test(pg) && /requestAnimationFrame\(\(\) => whereBox\.current\?\.focus\(\)\)/.test(pg) && /Moved\? Say where you are now/.test(pg));
  const ah = src('src/lib/counter-ahead.ts');
  check('the guest: I’m on my way (car optional; the form says their location is used for how far and to check them in), checked in by it while the page is open (rough until close, then precise; stops once in; a failed one tried again), a location prompt never holds the button, and asked where they parked if they hadn’t said',
    /I’m on my way/.test(pg) && /send\(open === 'way' \? 'onway' : 'here'\)/.test(pg) && /What are you driving\?/.test(pg) && /getCurrentPosition\(/.test(pg)
    && /watchPosition\(/.test(pg) && /if \(fired \|\| m > CURBSIDE_GEOFENCE_M \|\| tries\.current >= 3\) return;/.test(pg) && /if \(d\.ok\) \{ navigator\.geolocation\.clearWatch\(id\)/.test(pg) && /source: 'geo', distanceM: Math\.round\(m\)/.test(pg)
    && /enableHighAccuracy: close/.test(pg) && /if \(!close && m <= 1000\) \{ setClose\(true\); return; \}/.test(pg) && /setTimeout\(\(\) => res\(null\), 10000\)/.test(pg)
    && /While this page is open, it also checks you in when you pull in\./.test(pg)
    && /Where did you park\?/.test(pg) && /Keep this page open, and we’ll check you in when you pull in\./.test(pg) && /return \(\) => \{ navigator\.geolocation\.clearWatch\(id\)/.test(pg));
  check('the alert is sent before the kitchen is started, so nothing after it can lose it', ah.indexOf("type: 'curbside_here'") > 0 && ah.indexOf("type: 'curbside_here'") < ah.indexOf('try { await startNow(db, tenantId, orderId); }'));
  check('café orders are read at most every few seconds per business, and a screen with no café curbside asks once', /now - c\.at < 3000/.test(src('src/lib/curbside-server.ts')) && /if \(!cafeOn\) return;/.test(scr));
  check('the Menu page’s switch', /check\(!!a\.curbside, 'Curbside: we bring it to their car', 'curbside'\)/.test(src('src/components/menu/OrderAheadCard.tsx')));
  const mine = ['src/lib/curbside.ts', 'src/lib/curbside-server.ts', 'src/app/api/curbside/route.ts', 'src/components/orders/CurbsideScreen.tsx', 'src/app/(app)/curbside/page.tsx', 'src/lib/pickup-geo.ts'].map(src).join('\n');
  check('in the app’s own words and look', !/uppercase|font-black|\{\/\*| · |call us|contact us/i.test(mine) && !/[\u{1F300}-\u{1FAFF}]/u.test(mine) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(mine));

  const menuRoute = src("src/app/api/menu/route.ts"); const aheadCard = src("src/components/menu/OrderAheadCard.tsx");
  check('one location with curbside on: pinned from its address only when nothing is pinned yet (a pin already set never moves), and the card says what to do when it can’t be', /if \(!a\.curbside\) return a;\s*if \(await pickupGeoOf\(db, tenantId, t\)\.catch\(\(\) => null\)\) return \{ \.\.\.a, curbsidePinned: true \};\s*await locateMissing\(db, tenantId\)\.catch\(\(\) => \(\{\}\)\); forgetPickupGeo\(tenantId\);\s*return \{ \.\.\.a, curbsidePinned: !!\(await pickupGeoOf\(db, tenantId, t\)/.test(menuRoute)
    && /a\.curbside && a\.curbsidePinned === false && <p[^>]*>Guests tap I’m here when they pull in\./.test(aheadCard));
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
