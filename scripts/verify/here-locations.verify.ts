// Checks quick-service screens and orders at more than one location (design board "More than one location";
// lib/business-locations atHere / dayKey, lib/here-server, api/kitchen 'pair' / 'screens' / 'screenPlace' / 'tickets',
// api/counter 'car' / 'lane' / 'readyBoard', api/curbside 'list', lib/counter-server createCar / sendOrder, lib/kiosk).
// - One location: nothing changes (no location asked, nothing stamped, every screen shows everything).
// - With two: each screen is set up for one (and a manager can move it); a team member on their own device is at the
//   one picked in the app. New guests and their orders are stamped with it, numbered there ("C1" at each), and their
//   kitchen tickets too. Each counter, lane, kitchen screen and ready board shows its own location's, and anything not
//   stamped (from before) shows at every one.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/here-locations.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
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
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const BL = await import('../../src/lib/business-locations');
  const HS = await import('../../src/lib/here-server');
  const { POST: KITCHEN } = await import('../../src/app/api/kitchen/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: CURB } = await import('../../src/app/api/curbside/route');

  console.log('the rules');
  check('something belongs here: no location asked, or not stamped, or stamped here', BL.atHere({ locationId: 'a' }, null) && BL.atHere({}, 'a') && BL.atHere({ locationId: 'a' }, 'a') && !BL.atHere({ locationId: 'b' }, 'a'));
  check('a day’s numbers and codes: kept for each location, as before with one', BL.dayKey('2026-11-21', null) === '2026-11-21' && BL.dayKey('2026-11-21', 'a') === '2026-11-21_a');

  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true, address: '1 Main St', coordinates: { lat: 39.95, lng: -75.0 } });
  await db.doc(`${T}/locations/bin1`).set({ name: 'Back shelf', isActive: true, locationTypeId: 'shelf' });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Burgers', price: 5, totalStock: 50, makeSeconds: 240 });
  const K = (b: any) => KITCHEN(req({ tenantId: 't1', ...b })) as any;
  const C = (b: any) => LANE(req({ tenantId: 't1', channel: 'counter', ...b })) as any;

  console.log('one location');
  check('a storage shelf isn’t a location; with one, no screen asks', (await HS.bizLocationsOf(db, 't1')).length === 1 && (await HS.hereOf(db, 't1', 'main')) === null);
  let r: any = await C({ action: 'car', carKey: 'carkeyaaaa1' });
  const one = await get(`${T}/counterOrders/${r.body.orderId}`);
  r = await C({ action: 'lane' });
  check('…a guest at the counter: nothing stamped, numbered for the day as before, and the counter says no location', !one.locationId && !!(await get(`${T}/orderCounters/${one.day}`)) && r.body.location === null, { one, location: r.body.location });

  console.log('two locations');
  await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true, address: '88 Harbor Rd' });
  HS.forgetLocations('t1');
  check('with two: each is a place a screen can be', (await HS.hereOf(db, 't1', 'harbor')) === 'harbor' && (await HS.hereOf(db, 't1', 'bin1')) === null && (await HS.hereOf(db, 't1', 'nowhere')) === null);
  const kMain = (await K({ action: 'pair', name: 'Kitchen 1', kind: 'kitchen', locationId: 'main' })).body.key;
  const kHarbor = (await K({ action: 'pair', name: 'Kitchen 2', kind: 'kitchen', locationId: 'harbor' })).body.key;
  const noPlace: any = await K({ action: 'pair', name: 'Kitchen 3', kind: 'kitchen', locationId: 'bin1' });
  const kAll = (await K({ action: 'pair', name: 'Kitchen 3', kind: 'kitchen', locationId: 'main' })).body.key;
  const lMain = (await K({ action: 'pair', name: 'Lane', kind: 'drive-thru', locationId: 'main' })).body.key;
  r = await K({ action: 'screens' });
  const scr = r.body.screens || [];
  check('a tablet set up for a location keeps it; with two, setting one up asks which (a storage shelf isn’t one); the Screens page lists the locations', noPlace.status === 400 && /Pick where this tablet is/.test(noPlace.body.error) && scr.find((x: any) => x.name === 'Kitchen 1')?.locationId === 'main' && scr.find((x: any) => x.name === 'Kitchen 2')?.locationId === 'harbor' && scr.find((x: any) => x.name === 'Kitchen 3')?.locationId === 'main'
    && JSON.stringify(r.body.locations) === JSON.stringify([{ id: 'harbor', name: 'Harbor Rd' }, { id: 'main', name: 'Main St' }]), { scr, locs: r.body.locations });
  const k3 = scr.find((x: any) => x.name === 'Kitchen 3');
  const bad1: any = await K({ action: 'screenPlace', id: k3.id, locationId: 'bin1' });
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  const bad2: any = await K({ action: 'screenPlace', id: k3.id, locationId: 'main' });
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  r = await K({ action: 'screenPlace', id: k3.id, locationId: 'main' });
  const r2: any = await K({ action: 'screenPlace', id: k3.id, locationId: null });
  check('a manager moves a tablet to another location, or back to every one (only a location, only a manager)', bad1.status === 400 && bad2.status === 403 && r.body.ok && r.body.locationId === 'main' && r2.body.ok && r2.body.locationId === null, [bad1.body, bad2.body, r.body, r2.body]);

  console.log('orders at each');
  r = await C({ action: 'car', carKey: 'carkeymain1', locationId: 'main' }); const m1 = r.body;
  r = await C({ action: 'car', carKey: 'carkeyharb1', locationId: 'harbor' }); const h1 = r.body;
  r = await C({ action: 'car', carKey: 'carkeyharb2', locationId: 'harbor' }); const h2 = r.body;
  const om1 = await get(`${T}/counterOrders/${m1.orderId}`); const oh1 = await get(`${T}/counterOrders/${h1.orderId}`);
  check('a guest at each counter: stamped with where they are, numbered there (each starts at C1)', om1.locationId === 'main' && oh1.locationId === 'harbor' && (await get(`${T}/driveThruCars/${m1.carId}`)).locationId === 'main'
    && m1.number === 'C1' && h1.number === 'C1' && h2.number === 'C2' && !!(await get(`${T}/orderCounters/${om1.day}_harbor`)), { m1, h1, h2 });
  for (const x of [m1, h1]) { await C({ action: 'add', orderId: x.orderId, carId: x.carId, itemId: 'burger', quantity: 1, tapKey: `tap${x.orderId}`, locationId: x === m1 ? 'main' : 'harbor' }); await C({ action: 'send', orderId: x.orderId, carId: x.carId, locationId: x === m1 ? 'main' : 'harbor' }); }
  const tix = await all(`${T}/kdsTickets`);
  check('…sent: its kitchen tickets are made at its location', tix.some((t: any) => t.orderId === m1.orderId && t.locationId === 'main') && tix.some((t: any) => t.orderId === h1.orderId && t.locationId === 'harbor'), tix.map((t: any) => [t.orderId, t.locationId]));
  r = await C({ action: 'lane', locationId: 'main' }); const laneMain = r.body;
  r = await C({ action: 'lane', locationId: 'harbor' }); const laneHarbor = r.body;
  r = await C({ action: 'lane' }); const laneNone = r.body;
  const ids = (l: any) => (l.cars || []).map((c: any) => c.id);
  check('each counter shows its own guests (and one from before, at both); none picked shows all', ids(laneMain).includes(m1.carId) && !ids(laneMain).includes(h1.carId) && ids(laneHarbor).includes(h1.carId) && !ids(laneHarbor).includes(m1.carId)
    && ids(laneMain).includes('car_carkeyaaaa1') && ids(laneHarbor).includes('car_carkeyaaaa1') && ids(laneNone).includes(m1.carId) && ids(laneNone).includes(h1.carId) && laneMain.location?.name === 'Main St' && laneNone.location === null, { main: ids(laneMain), harbor: ids(laneHarbor) });
  const tk = async (key: string | null, extra: any = {}) => ((await K({ action: 'tickets', ...(key ? { key } : {}), ...extra })).body.tickets || []).map((t: any) => t.orderId);
  const tMain = await tk(kMain); const tHarbor = await tk(kHarbor); const tAll = await tk(kAll); const tMe = await tk(null, { locationId: 'harbor' });
  check('each kitchen screen shows its own location’s tickets; one at every location, all; signed in on a device, the one picked', tMain.includes(m1.orderId) && !tMain.includes(h1.orderId) && tHarbor.includes(h1.orderId) && !tHarbor.includes(m1.orderId)
    && tAll.includes(m1.orderId) && tAll.includes(h1.orderId) && tMe.includes(h1.orderId) && !tMe.includes(m1.orderId), { tMain, tHarbor, tAll, tMe });
  r = await LANE(req({ tenantId: 't1', key: lMain, action: 'car', carKey: 'carkeylane1' }));
  const lc = await get(`${T}/driveThruCars/${r.body.carId}`);
  r = await LANE(req({ tenantId: 't1', key: lMain, action: 'car', carKey: 'carkeylane2', locationId: 'harbor' }));
  const lc2 = await get(`${T}/driveThruCars/${r.body.carId}`);
  check('a lane tablet set up for a location: its cars are there, whatever a page asks', lc.locationId === 'main' && lc2.locationId === 'main', [lc, lc2]);

  console.log('the ready board and curbside');
  for (const t of tix) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'ready', readyAt: new Date().toISOString() }, { merge: true });
  const bMain = (await K({ action: 'pair', name: 'Ready board', kind: 'drive-thru-board', locationId: 'main' })).body.key;
  r = await LANE(req({ tenantId: 't1', key: bMain, action: 'readyBoard' }));
  const ready = (r.body.ready || []).map((x: any) => x.number);
  check('the ready board by a location’s counter: its own orders only', r.body.ok && ready.length === 1 && ready[0] === 'C1', r.body);
  const curb = (id: string, loc: string | null) => db.doc(`${T}/counterOrders/${id}`).set({ id, number: `A${id}`, channel: 'ahead', status: 'sent', paidAt: new Date().toISOString(), day: om1.day, ...(loc ? { locationId: loc } : {}), ahead: { way: 'curbside', state: 'paid', code: '1234' } });
  await curb('cm', 'main'); await curb('ch', 'harbor'); await curb('cx', null);
  const CS = (b: any) => CURB(req({ tenantId: 't1', action: 'list', ...b })) as any;
  const cMain = ((await CS({ locationId: 'main' })).body.cafe || []).map((x: any) => x.id); const cNone = ((await CS({})).body.cafe || []).map((x: any) => x.id);
  check('the Curbside screen: the picked location’s, and any from before', cMain.includes('cm') && !cMain.includes('ch') && cMain.includes('cx') && cNone.length === 3, { cMain, cNone });

  console.log('a team member with nothing picked, and a location closed');
  await db.doc(`${T}/staff/s9`).set({ name: 'Rio Diaz', role: 'staff', locationIds: ['harbor'] });
  actor = { uid: 's9', name: 'Rio Diaz', role: 'staff', isManager: false, caps: [] };
  const tRio = await tk(null);
  r = await C({ action: 'car', carKey: 'carkeyrio01' });
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  check('signed in with nothing picked: where they work, when it’s one location', tRio.includes(h1.orderId) && !tRio.includes(m1.orderId) && (await get(`${T}/counterOrders/${r.body.orderId}`)).locationId === 'harbor', { tRio });
  const { POST: DEL } = await import('../../src/app/api/locations/delete/route');
  const del: any = await DEL(req({ tenantId: 't1', locationId: 'harbor', mode: 'delete' }));
  const delCheck = del.body?.ok || del.status;
  // (Its orders and staff still point at it in this test, so the delete may be refused: then it's closed by hand, as a
  // merge or a cleanup would leave it.)
  if (!del.body?.ok) { await db.doc(`${T}/locations/harbor`).delete(); await HS.unplaceScreens(db, 't1', 'harbor'); }
  const scr2 = (await K({ action: 'screens' })).body.screens || [];
  const tK2 = await tk(kHarbor);
  r = await LANE(req({ tenantId: 't1', key: lMain, action: 'car', carKey: 'carkeylane3' }));
  const lc3 = await get(`${T}/driveThruCars/${r.body.carId}`);
  check('a location closed: its tablets aren’t set to it any more, and back to one location nothing is stamped', !scr2.find((x: any) => x.name === 'Kitchen 2')?.locationId && tK2.includes(m1.orderId) && tK2.includes(h1.orderId) && !lc3.locationId, { delCheck, k2: scr2.find((x: any) => x.name === 'Kitchen 2'), lc3 });
  await db.doc(`kitchenScreens/${scr2.find((x: any) => x.name === 'Lane')?.id}`).set({ locationId: 'gone' }, { merge: true });
  r = await LANE(req({ tenantId: 't1', key: lMain, action: 'car', carKey: 'carkeylane4' }));
  check('…a tablet still set to a location that’s gone stamps nothing and numbers for the day', !(await get(`${T}/driveThruCars/${r.body.carId}`)).locationId && !(await get(`${T}/orderCounters/${om1.day}_gone`)), r.body);

  console.log('the pages');
  const page = src('src/app/(app)/counter/page.tsx'); const scrPage = src('src/app/(app)/screens/page.tsx'); const pick = src('src/components/drive-thru/PlacePick.tsx');
  check('the counter sends the location picked in the app and shows it', /channel: 'counter', \.\.\.hereAsked\(\)/.test(page) && /lane\?\.location\?\.name/.test(page));
  check('the lane, kitchen and curbside screens send it when signed in on a device (a tablet’s own key decides otherwise)', /\.\.\.\(!key \? hereAsked\(\) : \{\}\)/.test(src('src/app/drive-thru/[tenantId]/page.tsx')) && /key \? \{ key \} : \{ \.\.\.hereAsked\(\) \}/.test(src('src/app/kds/[tenantId]/page.tsx')) && /action: 'list', \.\.\.hereAsked\(\)/.test(src('src/components/orders/CurbsideScreen.tsx')));
  check('setting up a tablet asks where it is; the Screens page moves it', /Where is this tablet\?/.test(pick) && /<PlacePick/.test(src('src/components/drive-thru/ScreenSetup.tsx')) && /<PlacePick/.test(src('src/components/back/screen-kit.tsx')) && /action: 'screenPlace'/.test(scrPage) && /Every location/.test(scrPage));
  check('house style in the new words', ![pick, src('src/lib/here-server.ts')].some((x) => / · |\buppercase\b|font-black|call us|contact us/i.test(x)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
