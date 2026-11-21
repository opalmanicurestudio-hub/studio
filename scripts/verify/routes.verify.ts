// Checks delivery routes in the best order (design board "Routes in the best order"; lib/route-plan, lib/route-server,
// api/retail/delivery-route, lib/delivery-run runFor, hot food going together in lib/food-delivery-server).
// - The least driving that keeps each stop's time: windows kept (not before they open), late only when nothing keeps
//   it (and flagged); hot food first; a skipped stop last; a stop not on the map after the others of its kind.
// - Every order tried up to 8 stops; more found by improving, never worse than going by time.
// - Drive times by road from the map (with traffic for up to 10 points), from the distance when it isn't there.
// - The plan kept on each stop, so the driver's list follows it; the same stops: the same plan; a stop added: planned
//   again; from where the driver is when they share it.
// - Drivers only; two hot orders going the same way suggested together; the screens.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/routes.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

process.env.MAPBOX_TOKEN = 'pk.test';
const db: any = makeDb();
let actor: any = { uid: 'd1', name: 'Sam Lee', role: 'staff', isManager: false };
const calls: string[] = []; let mapDown = false;
const PLACES: Record<string, { lat: number; lng: number }> = { '1 east st': { lat: 39.9, lng: -74.96 }, '2 west st': { lat: 39.9, lng: -75.04 } };
(globalThis as any).fetch = async (url: string) => {
  const u = String(url); calls.push(u);
  if (u.includes('directions-matrix')) {
    if (mapDown) return { ok: false, status: 503, json: async () => ({}) };
    const coords = decodeURIComponent(u.split('/driving')[1].split('/')[1].split('?')[0]).split(';').map((c) => c.split(',').map(Number));
    // Road times: straight-line minutes at 30 mph by road, a fifth longer (so they differ from the estimate).
    const mi = (a: number[], b: number[]) => { const r = (d: number) => (d * Math.PI) / 180; const h = Math.sin(r(b[1] - a[1]) / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(r(b[0] - a[0]) / 2) ** 2; return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h))); };
    return { ok: true, status: 200, json: async () => ({ code: 'Ok', durations: coords.map((a) => coords.map((b) => (mi(a, b) * 1.2 / 30) * 3600)), distances: coords.map((a) => coords.map((b) => mi(a, b) * 1.2 * 1609.344)) }) };
  }
  if (u.includes('/geocode/')) {
    const q = decodeURIComponent(u.split('q=')[1].split('&')[0]).toLowerCase();
    const k = Object.keys(PLACES).find((x) => q.startsWith(x));
    return { ok: true, status: 200, json: async () => ({ features: k ? [{ geometry: { coordinates: [PLACES[k].lng, PLACES[k].lat] }, properties: { full_address: q, match_code: { confidence: 'exact' }, context: { postcode: { name: '08077' } } } }] : [] }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() || {} }) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const P = await import('../../src/lib/route-plan');
  const { runFor } = await import('../../src/lib/delivery-run');
  const RS = await import('../../src/lib/route-server');
  const FS = await import('../../src/lib/food-delivery-server');
  const { POST: ROUTE } = await import('../../src/app/api/retail/delivery-route/route');

  const now = Date.parse('2026-11-21T19:00:00Z'); const shop = { lat: 39.9, lng: -75.0 };
  const at = (dlat: number, dlng: number) => ({ lat: 39.9 + dlat, lng: -75.0 + dlng });
  const win = (h1: number, h2: number) => ({ open: now + h1 * 3600e3, due: now + h2 * 3600e3 });

  console.log('the order');
  const zig = [
    { key: 'A', at: at(0, 0.05), ...win(0, 3), hot: false }, { key: 'B', at: at(0, -0.05), ...win(0, 3), hot: false },
    { key: 'C', at: at(0.01, 0.06), ...win(0, 3), hot: false }, { key: 'D', at: at(0.01, -0.06), ...win(0, 3), hot: false },
  ];
  const z = P.planRoute({ start: shop, home: shop, stops: zig, now });
  const sides = z.order.map((k) => (k === 'A' || k === 'C' ? 'e' : 'w')).join('');
  check('the least driving: one side of town, then the other (not back and forth by time)', (sides === 'eeww' || sides === 'wwee') && z.savedMin > 5 && z.exact && z.road === false, { order: z.order, saved: z.savedMin });
  const w = P.planRoute({ start: shop, home: shop, now, stops: [
    { key: 'near', at: at(0, 0.01), ...win(1, 2), hot: false },
    { key: 'far', at: at(0, -0.05), ...win(0, 1), hot: false },
  ] });
  check('a window that’s open first goes first, even when another stop is nearer (no waiting at a door for a window)', w.order.join(',') === 'far,near' && !w.eta.far.late && !w.eta.near.late && w.eta.near.at >= now + 3600e3, w);
  const late = P.planRoute({ start: shop, home: shop, now, stops: [{ key: 'x', at: at(0, 0.2), open: null, due: now + 5 * 60e3, hot: false }] });
  check('a stop nothing gets there in time for: flagged late', late.eta.x.late === true, late.eta);
  const mixed = P.planRoute({ start: shop, home: shop, now, stops: [
    { key: 's1', at: at(0, 0.002), ...win(0, 3), hot: false }, { key: 'h1', at: at(0, 0.04), open: null, due: now + 40 * 60e3, hot: true },
    { key: 'sk', at: at(0, 0.001), ...win(0, 3), hot: false, skippedAt: now - 60e3 }, { key: 'nomap', at: null, ...win(0, 3), hot: false },
    { key: 'h2', at: at(0, 0.03), open: null, due: now + 40 * 60e3, hot: true },
  ] });
  check('hot food first (even with a shop order next door), a stop not on the map after the others of its kind, a skipped stop last', mixed.order.join(',') === 'h2,h1,s1,nomap,sk', mixed.order);
  const many = Array.from({ length: 14 }, (_, i) => ({ key: `m${i}`, at: at(Math.sin(i * 2.1) * 0.05, Math.cos(i * 1.7) * 0.05), ...win(0, 5), hot: false }));
  const t0 = Date.now(); const big = P.planRoute({ start: shop, home: shop, stops: many, now });
  check('14 stops: found by improving, quickly, never worse than going by time', !big.exact && big.order.length === 14 && new Set(big.order).size === 14 && big.savedMin >= 0 && Date.now() - t0 < 1500, { saved: big.savedMin, ms: Date.now() - t0 });
  const eight = P.planRoute({ start: shop, home: shop, stops: many.slice(0, 8), now });
  check('8 stops: every order tried', eight.exact && eight.order.length === 8, eight.exact);
  check('the totals: drive time, miles, back at the shop', z.driveMin > 0 && z.miles > 0 && z.backAt! > now, z);

  console.log('together');
  const close = P.goesWith(shop, { at: at(0.02, 0.01), due: now + 30 * 60e3 }, { at: at(0.022, 0.012), due: now + 40 * 60e3 }, now);
  const apart = P.goesWith(shop, { at: at(0.02, 0.01), due: now + 30 * 60e3 }, { at: at(-0.05, -0.05), due: now + 40 * 60e3 }, now);
  check('two going the same way: adds a few minutes, both on time; opposite ways: far more', !!close && close.onTime && close.addMin <= P.TOGETHER_MAX_ADD_MIN && !!apart && apart.addMin > P.TOGETHER_MAX_ADD_MIN, { close, apart });
  check('…not on the map: nothing suggested', P.goesWith(shop, { at: null, due: null }, { at: at(0, 0), due: null }, now) === null);
  const link = P.routeLink('9 Main St, Riverton', ['1 A St', '2 B St', '3 C St'])!;
  check('the whole route in the maps app: from the shop, through the stops, to the last', link.startsWith('https://www.google.com/maps/dir/?') && new URL(link).searchParams.get('origin') === '9 Main St, Riverton' && new URL(link).searchParams.get('destination') === '3 C St' && new URL(link).searchParams.get('waypoints') === '1 A St|2 B St');
  const lost = P.planRoute({ start: shop, home: shop, now, stops: [
    { key: 'h1', at: at(0, 0.04), open: null, due: now + 60 * 60e3, hot: true }, { key: 'h0', at: null, open: null, due: now + 60 * 60e3, hot: true },
    { key: 'far', at: at(0, 0.08), ...win(0, 3), hot: false }, { key: 'near', at: at(0, 0.045), ...win(0, 3), hot: false },
  ] });
  check('a stop not on the map: no time given as if known, and the next drive is from where the driver really was', lost.order.join(',') === 'h1,h0,near,far' && lost.eta.h0.placed === false && lost.eta.near.placed === true
    && lost.eta.near.at - lost.eta.h0.at >= 30e3 && lost.eta.near.at - lost.eta.h1.at > (12 + 4) * 60e3, lost);
  check('…ten stops at most', new URL(P.routeLink(null, Array.from({ length: 14 }, (_, i) => `${i} St`))!).searchParams.get('waypoints')!.split('|').length === 9 && P.routeLink(null, []) === null);

  console.log('the driver’s list follows the plan');
  const o = (id: string, extra: any = {}) => ({ id, method: 'delivery', stage: 'packed', orderNumber: Number(id.replace(/\D/g, '')) || 1, delivery: { status: 'out', driverId: 'd1', window: { start: new Date(now).toISOString() }, ...extra } });
  const run = runFor([o('o1', { routeId: 'r1700000000500', routeSeq: 1 }), o('o2', { routeId: 'r1700000000500', routeSeq: 0 }), o('o3'), o('o4', { routeId: 'r1700000000100', routeSeq: 0 }), o('o5', { routeId: 'r1700000000500', routeSeq: 2, skippedAt: new Date(now).toISOString() })], 'd1');
  check('in the planned order, then stops added since (and one from an older plan), then a skipped one; two not planned', run.route.map((x: any) => x.id).join(',') === 'o2,o1,o3,o4,o5' && run.unplanned === 2, run.route.map((x: any) => x.id));

  console.log('drive times from the map');
  calls.length = 0;
  const legs = await RS.roadLegs([shop, at(0, 0.05), at(0, -0.05)]);
  check('by road, with live traffic for a few points', !!legs && legs.road && calls[0].includes('/driving-traffic/') && Math.abs(legs.min[0][1] - (P.estimateLegs([shop, at(0, 0.05)]).min[0][1])) > 0.01, calls[0]);
  calls.length = 0; await RS.roadLegs([shop, at(0, 0.05), at(0, -0.05)]);
  check('…asked once for the same points', calls.length === 0, calls);
  await RS.roadLegs(Array.from({ length: 12 }, (_, i) => at(i * 0.001, 0)));
  check('…by road without traffic for more than 10 points; more than 25: not asked', calls.some((c) => c.includes('/driving/')) && (await RS.roadLegs(Array.from({ length: 26 }, (_, i) => at(i * 0.001, 0.1)))) === null);
  mapDown = true; check('…the map service down: none (the plan works it out from the distance)', (await RS.roadLegs([at(0.3, 0.3), at(0.31, 0.3)])) === null); mapDown = false;

  console.log('the plan');
  await db.doc(T).set({ name: 'Northside', timezone: 'America/New_York', retailSettings: { deliveryPlan: { on: true, by: 'distance', origin: { lat: 39.9, lng: -75.0, label: '9 Main St, Riverton' }, drivers: ['d1'],
    zones: [{ id: 'z', name: 'Near', upToMiles: 10, feeCents: 500 }], days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: '08:00', end: '22:00' }] } } });
  const shopOrder = (id: string, line1: string, dest: any, extra: any = {}) => db.doc(`${T}/retailOrders/${id}`).set({ method: 'delivery', stage: 'packed', orderNumber: 1000 + Number(id.slice(1)), customerName: 'Pat Doe',
    shippingAddress: { line1, city: 'Riverton', state: 'NJ', postalCode: '08077' }, delivery: { status: 'out', driverId: 'd1', outAt: new Date().toISOString(), window: { start: new Date(Date.now() - 600e3).toISOString(), end: new Date(Date.now() + 3 * 3600e3).toISOString() },
      ...(dest ? { dest, destFor: ['' + line1, '', 'Riverton', 'NJ', '08077'].map((x) => x.trim().toLowerCase()).join('|'), destAt: new Date().toISOString() } : {}), ...extra } });
  await shopOrder('s1', '5 East Ave', at(0, 0.05)); await shopOrder('s2', '6 West Ave', at(0, -0.05)); await shopOrder('s3', '7 East Ave', at(0.005, 0.055)); await shopOrder('s4', '8 West Ave', at(0.005, -0.055));
  await db.doc(`${T}/retailOrders/s9`).set({ method: 'delivery', stage: 'packed', delivery: { status: 'out', driverId: 'd2' }, shippingAddress: { line1: '1 East St' } });
  await db.doc(`${T}/counterOrders/h1`).set({ number: 'A12', ahead: { way: 'delivery', delivery: { state: 'out', driverId: 'd1', arriveAt: new Date(Date.now() + 25 * 60e3).toISOString(), address: { line1: '1 East St', city: 'Riverton', state: 'NJ', postalCode: '08077' } } } });
  calls.length = 0;
  let r: any = await ROUTE(req({ tenantId: 't1' }));
  const v = r.body;
  check('planned: hot food first, then one side of town and the other, by road', v.ok && v.stops.length === 5 && v.stops[0].kind === 'hot' && v.stops[0].id === 'h1' && v.road === true && v.from === 'shop'
    && ['s1s3', 's3s1', 's2s4', 's4s2'].includes(v.stops.slice(1, 3).map((x: any) => x.id).join('')) && v.driveMin > 0 && v.miles > 0 && !!v.backAt, v.stops);
  check('…the hot food’s place looked up once and kept on it', !!(await get(`${T}/counterOrders/h1`)).ahead.delivery.dest && calls.filter((c) => c.includes('/geocode/')).length === 1, calls.filter((c) => c.includes('/geocode/')));
  const kept = await Promise.all(['s1', 's2', 's3', 's4'].map((id) => get(`${T}/retailOrders/${id}`)));
  const list = runFor(kept.map((x: any, i: number) => ({ ...x, id: `s${i + 1}` })), 'd1').route.map((x: any) => x.id);
  check('…kept on each stop: the driver’s list (and the customers’ pages) follow it', list.join(',') === v.stops.slice(1).map((x: any) => x.id).join(',') && kept.every((x: any) => x.delivery.routeId === v.id && x.delivery.routeEta), list);
  check('…and on the hot food', (await get(`${T}/counterOrders/h1`)).ahead.delivery.routeSeq === 0 && (await get(`${T}/counterOrders/h1`)).ahead.delivery.routeId === v.id);
  check('…another driver’s stop isn’t in it', !v.stops.some((x: any) => x.id === 's9'));
  check('…the whole route in the maps app from the shop', new URL(v.link).searchParams.get('origin') === '9 Main St, Riverton' && new URL(v.link).searchParams.get('waypoints')!.split('|').length === 4 && v.linkStops === 5 && v.linkOf === 5, v.link);
  check('…every stop on the map has its time', v.stops.every((x: any) => x.placed && x.eta), v.stops);
  calls.length = 0;
  r = await ROUTE(req({ tenantId: 't1' }));
  check('the same stops again: the same plan, nothing asked of the map', r.body.id === v.id && calls.length === 0, calls);
  r = await ROUTE(req({ tenantId: 't1', again: true }));
  check('…Plan again a moment later: still the same (not asked twice in a few seconds)', r.body.id === v.id);
  await shopOrder('s5', '2 West St|9 Evil Rd', null);
  await db.doc(`${T}/driverLocations/d1`).set({ sharing: true, point: at(0.002, -0.05), pointAt: new Date().toISOString() });
  r = await ROUTE(req({ tenantId: 't1' }));
  check('a stop added: planned again from where the driver is, its place looked up', r.body.id !== v.id && r.body.stops.length === 6 && r.body.from === 'here' && !!(await get(`${T}/retailOrders/s5`)).delivery.dest && !new URL(r.body.link).searchParams.get('origin'), r.body);
  check('…a bar typed in an address doesn’t add a stop to the maps link', new URL(r.body.link).searchParams.get('waypoints')!.split('|').length + 1 === 6, r.body.link);
  const ids = await Promise.all(['s1', 's2', 's3', 's4', 's5'].map(async (id) => (await get(`${T}/retailOrders/${id}`)).delivery.routeId));
  check('…every stop stamped with the one plan', ids.every((x) => x === r.body.id) && (await get(`${T}/counterOrders/h1`)).ahead.delivery.routeId === r.body.id, ids);
  mapDown = true; await db.doc(`${T}/retailOrders/s5`).set({ delivery: { skippedAt: new Date().toISOString() } }, { merge: true });
  await db.doc(`${T}/driverLocations/d1`).set({ sharing: true, point: at(0.004, -0.045), pointAt: new Date().toISOString() });   // (moved on: new drive times needed)
  r = await ROUTE(req({ tenantId: 't1' }));
  check('skipped, with the map service down: planned from the distance (and says so), the skipped stop last', r.body.ok && r.body.road === false && r.body.stops[r.body.stops.length - 1].id === 's5', r.body.stops); mapDown = false;

  console.log('who');
  actor = { uid: 'd3', name: 'Kai', role: 'staff', isManager: false };
  r = await ROUTE(req({ tenantId: 't1' }));
  check('only the business’s drivers', r.status === 403, r.body);
  actor = { uid: 'd1', name: 'Sam', role: 'staff', isManager: false, isRenter: true };
  r = await ROUTE(req({ tenantId: 't1' }));
  check('never a renter', r.status === 403, r.body);
  actor = { uid: 'd1', name: 'Sam', role: 'staff', isManager: false, screen: true };
  r = await ROUTE(req({ tenantId: 't1' }));
  check('never a shared tablet', r.status === 403, r.body);
  actor = { uid: 'd2', name: 'Rio', role: 'staff', isManager: true };
  r = await ROUTE(req({ tenantId: 't1' }));
  check('a manager plans their own stops only', r.body.ok && r.body.stops.length === 1 && r.body.stops[0].id === 's9', r.body.stops);

  console.log('hot food going together');
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const hotOrder = async (id: string, num: string, line1: string, dest: any) => {
    await db.doc(`${T}/counterOrders/${id}`).set({ number: num, day, paidAt: new Date().toISOString(), status: 'sent', guestName: 'Guest', ahead: { way: 'delivery', slot: new Date().toISOString(), delivery: { state: 'waiting', arriveAt: new Date(Date.now() + 40 * 60e3).toISOString(),
      address: { line1, city: 'Riverton', state: 'NJ', postalCode: '08077' }, dest, destFor: [line1, '', 'Riverton', 'NJ', '08077'].map((x) => x.trim().toLowerCase()).join('|'), destAt: new Date().toISOString() } } });
    await db.doc(`${T}/kdsTickets/t_${id}`).set({ orderId: id, status: 'ready', readyAt: new Date().toISOString() });
  };
  await hotOrder('k1', 'A20', '10 North Rd', at(0.02, 0.01)); await hotOrder('k2', 'A21', '12 North Rd', at(0.022, 0.012)); await hotOrder('k3', 'A22', '99 South Rd', at(-0.05, -0.05));
  const rows = await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 10_000);
  const by = (id: string) => rows.find((x: any) => x.orderId === id)!;
  check('two ready ones going the same way: each says it goes with the other; one the other way: nothing', by('k1')?.with?.orderId === 'k2' && by('k2')?.with?.orderId === 'k1' && by('k1').with!.addMin <= 8 && by('k3')?.with === null, rows.map((x: any) => [x.orderId, x.with]));

  console.log('the screens');
  const tab = src('src/components/staff-portal/DeliveriesTab.tsx'); const hot = src('src/components/staff-portal/HotFoodRun.tsx'); const desk = src('src/components/drive-thru/Deliveries.tsx');
  check('the driver’s tab: the plan asked for as stops change, its totals, the whole route, plan again, each stop’s time and late ones marked', /\/api\/retail\/delivery-route/.test(tab) && /in the best order, about/.test(tab) && /Open the whole route in Maps/.test(tab) && /Plan again/.test(tab) && /after its time/.test(tab) && /stopSig/.test(tab));
  check('hot food: the route’s times, and two that go together taken together', /Take both/.test(hot) && /Goes with/.test(hot) && /r\.route\?\.eta/.test(hot));
  check('the counter: sent together', /Send both/.test(desk) && /Goes with/.test(desk));
  check('the new screens keep the house style', ![tab, hot, desk].some((s) => /\buppercase\b|font-black/.test(s)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
