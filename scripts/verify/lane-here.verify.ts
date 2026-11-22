// Checks each location's own lane entry sensor (design board "Sold out here or everywhere, each location's own night, and
// its own lane sensor", part 3; lib/lane-entry-server sensorsView / newSensor / stopSensor / sensorCar / lineClear /
// lineNow at, api/menu 'laneSettings', api/counter 'lane' and 'lineClear', api/kitchen, the speaker, the Menu page).
// - With more than one location, each location's lanes have their own link and count; its lane screen, kitchen and
//   speaker show its own line, rush and Line's clear.
// - One set up before there were locations keeps counting for screens that aren't set up for one, and the Menu page says
//   so until it's turned off.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/lane-here.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }), staffOrServer: async () => true });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const keyOf = (r: any) => new URL(String(r.body.sensorLink?.link || 'https://x.test/?k=')).searchParams.get('k') || '';

(async () => {
  const S = await import('../../src/lib/lane-entry-server');
  const HS = await import('../../src/lib/here-server');
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: KITCHEN } = await import('../../src/app/api/kitchen/route');
  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', driveThru: { askName: false } });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b })) as any;

  console.log('one location, a sensor set up');
  let r = await Mn({ action: 'laneSettings', sensor: 'new', lane: 1 });
  const oldKey = keyOf(r);
  check('as before: one row per lane, no location', r.body.ok && r.body.lane.sensors.length === 2 && r.body.lane.sensors[0].on === true && r.body.lane.sensors[0].locationId === null && r.body.lane.sensors[0].place === null, r.body.lane?.sensors);
  await S.sensorCar(db, 't1', oldKey, Date.now() - 60000);
  check('…its count is the business’s', (await get(`${T}/private/laneEntry_1`))?.at?.length === 1);

  console.log('two locations');
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true });
  await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true });
  HS.forgetLocations('t1');
  r = await Mn({ action: 'list' });
  const rows = r.body.lane?.sensors || [];
  check('the Menu page: each location’s lanes, and the one from before there were locations', rows.filter((x: any) => x.locationId).length === 4 && rows.some((x: any) => x.locationId === null && x.on) && rows.every((x: any) => !x.locationId || x.place), rows);
  r = await Mn({ action: 'laneSettings', sensor: 'new', lane: 1, at: 'harbor' });
  const hKey = keyOf(r);
  const kept = await get(`${T}/private/laneSensors`);
  check('a link for Harbor Rd’s lane 1: kept for that location, the old one still counting', r.body.ok && r.body.sensorLink.at === 'harbor' && Object.values(kept.tokens).some((t: any) => t.locationId === 'harbor' && t.lane === 1)
    && Object.values(kept.tokens).some((t: any) => !t.locationId && t.lane === 1) && r.body.lane.sensors.find((x: any) => x.locationId === 'harbor' && x.lane === 1)?.on === true, r.body);
  r = await Mn({ action: 'laneSettings', sensor: 'new', lane: 1, at: 'nowhere' });
  check('…a location that isn’t one: the one with no location', r.body.ok && r.body.sensorLink.at === null);
  const legacyKey = keyOf(r);
  check('…(and its old link stopped, as a new one does)', !(await S.sensorCar(db, 't1', oldKey)).ok || (await S.sensorCar(db, 't1', oldKey) as any).ok === false);

  const now = Date.now() + 2000;
  let c1: any = await S.sensorCar(db, 't1', hKey, now - 1500);
  check('a car at Harbor Rd’s sensor: counted in Harbor Rd’s lane only', c1.ok && c1.counted && (await get(`${T}/private/laneEntry_harbor_1`))?.at?.length === 1 && ((await get(`${T}/private/laneEntry_1`))?.at || []).length <= 1);
  // (Two cars a minute apart, counted since the line was last clear.)
  const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
  await db.doc(`${T}/private/laneEntry_harbor_1`).set({ at: [ago(120), ago(60)], clearedAt: ago(300) });
  const lh = await S.lineNow(db, 't1', await get(T), { at: 'harbor', cars: [], nowMs: Date.now() });
  const lm = await S.lineNow(db, 't1', await get(T), { at: 'main', cars: [], nowMs: Date.now() });
  check('the line at Harbor Rd: two waiting to order; at Main St: no sensor, none', lh.sensor && lh.waiting === 2 && !lm.sensor && lm.waiting === 0, [lh, lm]);
  const sensView = await S.sensorsView(db, 't1', await get(T), [{ id: 'main', name: 'Main St' }, { id: 'harbor', name: 'Harbor Rd' }]);
  check('…and when it last counted a car shows on its own row', !!sensView.find((x) => x.locationId === 'harbor' && x.lane === 1)?.lastAt && !sensView.find((x) => x.locationId === 'main' && x.lane === 1)?.lastAt);

  const kitchen = (b: any) => KITCHEN(req({ tenantId: 't1', ...b })) as any;
  const laneH = (await kitchen({ action: 'pair', name: 'Lane', kind: 'drive-thru', locationId: 'harbor' })).body.key;
  const laneM = (await kitchen({ action: 'pair', name: 'Lane 2', kind: 'drive-thru', locationId: 'main' })).body.key;
  const LH: any = await LANE(req({ tenantId: 't1', key: laneH, action: 'lane' }));
  const LM: any = await LANE(req({ tenantId: 't1', key: laneM, action: 'lane' }));
  check('each lane screen shows its own line', LH.body.ok && LH.body.stats?.sensor === true && LH.body.stats?.waiting === 2 && LM.body.ok && LM.body.stats?.sensor === false && (LM.body.stats?.waiting || 0) === 0, [LH.body.stats, LM.body.stats, LH.body.error]);
  r = await LANE(req({ tenantId: 't1', key: laneM, action: 'lineClear' }));
  check('Line’s clear at Main St leaves Harbor Rd’s line as it was', r.body.ok && (await S.lineNow(db, 't1', await get(T), { at: 'harbor', cars: [], nowMs: Date.now() })).waiting === 2);
  r = await LANE(req({ tenantId: 't1', key: laneH, action: 'lineClear' }));
  check('…at Harbor Rd, clears it', r.body.ok && (await S.lineNow(db, 't1', await get(T), { at: 'harbor', cars: [], nowMs: Date.now() + 1000 })).waiting === 0);
  const c2: any = await S.sensorCar(db, 't1', legacyKey, Date.now());
  check('the one from before there were locations counts for screens not set up for one', c2.ok && (await S.lineNow(db, 't1', await get(T), { cars: [], nowMs: Date.now() })).waiting >= 1);
  r = await Mn({ action: 'laneSettings', sensor: 'stop', lane: 1, at: 'harbor' });
  check('turning off Harbor Rd’s: its link stops and its count goes; the other stays', r.body.ok && !(await S.sensorCar(db, 't1', hKey) as any).ok && !(await get(`${T}/private/laneEntry_harbor_1`)) && (await S.sensorCar(db, 't1', legacyKey) as any).ok);

  console.log('back to one location');
  r = await Mn({ action: 'laneSettings', sensor: 'new', lane: 1, at: 'main' });
  const mKey = keyOf(r);
  await Mn({ action: 'laneSettings', sensor: 'stop', lane: 1 });
  await db.doc(`${T}/locations/harbor`).update({ isActive: false }); HS.forgetLocations('t1');
  const c3: any = await S.sensorCar(db, 't1', mKey, Date.now());
  const one = await S.sensorsView(db, 't1', await get(T), []);
  check('Main St’s sensor, now the only location: counted as the business’s, shown as its sensor, cleared with its Line’s clear', c3.ok && c3.counted && (await get(`${T}/private/laneEntry_1`))?.at?.length >= 1 && one[0].on === true
    && (await S.lineNow(db, 't1', await get(T), { cars: [], nowMs: Date.now() })).sensor === true, [c3, one[0]]);
  await Mn({ action: 'laneSettings', sensor: 'stop', lane: 1 });
  check('…and turned off from there', !(await S.sensorCar(db, 't1', mKey) as any).ok);

  console.log('the screens');
  const card = src('src/components/menu/LaneEntrySettings.tsx');
  check('the Menu page: each location’s lanes by name, the old one explained, and each call says which', card.includes("x.place || 'Every location'") && card.includes('Set up before there were locations') && card.includes("at: x.locationId || null"));
  check('the kitchen, the speaker and the lane screen read their own location’s line', src('src/app/api/kitchen/route.ts').includes('lineNow(db, tenantId, tenant, { withOrders: true, at: here })')
    && src('src/app/api/counter/voice/route.ts').includes("at: String((claim as any).car?.locationId || '') || here") && src('src/app/api/counter/route.ts').includes('nowMs: now.getTime(), at: here }') && src('src/app/api/counter/route.ts').includes('now.getTime(), here);'));
  check('house style', !/ · |\buppercase\b|font-black|call us|contact us|\{\/\*/i.test(card) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(card));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
