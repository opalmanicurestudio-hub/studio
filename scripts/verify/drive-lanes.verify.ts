// Checks two ordering lanes that merge (design board "Two lanes that merge"; lib/drive-lanes, api/counter, api/kitchen,
// api/menu, the lane screen, the speaker, the order board, the kitchen screen).
// - Set on the Menu page: one lane, or two that merge. With one, nothing changes and a car has no lane.
// - Every car carries its lane: the speaker's own, or the lane screen's button (never one taken in line).
// - Each order board and speaker shows only its own lane's car.
// - The line to the window: in the order cars finished ordering, each lane keeping its own order; the windows are asked
//   which car merged first only for the front car of each lane, while both wait and neither is paying, and one tap puts
//   it first for the window screens and the kitchen.
// - The kitchen: drive-thru orders in the order cars reach the window, with the lane and the place on each.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/drive-lanes.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

let db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: () => {} };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const L = await import('../../src/lib/drive-lanes');
  // (Times from ten minutes ago, so cars made now by the routes come after them, and all are in the lane now.)
  const BASE = Date.now() - 600000, NOW = Date.now();
  const at = (s: number) => new Date(BASE + s * 1000).toISOString();

  console.log('The line to the window (lib/drive-lanes)');
  check('two lanes only when set so; a lane as given, else none', L.lanesOf({ driveThru: { lanes: 2 } }) === 2 && L.lanesOf({}) === 1 && L.lanesOf({ driveThru: { lanes: 3 } }) === 1
    && L.cleanLane('2') === 2 && L.cleanLane(1) === 1 && L.cleanLane(3) === null && L.cleanLane(undefined) === null && L.laneOf({}) === 1 && L.laneOf({ lane: 2 }) === 2);
  const a = { id: 'a', stage: 'pay', lane: 1, arrivedAt: at(0), stageAt: { pay: at(90) } };
  const b = { id: 'b', stage: 'pay', lane: 2, arrivedAt: at(10), stageAt: { pay: at(70) } };
  const c = { id: 'c', stage: 'pay', lane: 1, arrivedAt: at(20), stageAt: { pay: at(100) } };
  check('one lane: as they arrived (a car can’t pass another); two: in the order they finished ordering',
    [a, b, c].sort(L.byWindow(false)).map((x) => x.id).join() === 'a,b,c' && [a, b, c].sort(L.byWindow(true)).map((x) => x.id).join() === 'b,a,c');
  check('a car taken in line goes from when it got to the window', L.windowKey({ hereAt: at(5), stageAt: { pay: at(200) }, arrivedAt: at(0) }, true) === at(5));
  let ask = L.mergeAsk([a, b, c], true, new Set(), NOW);
  check('asked about the front car of each lane: the one that finished first is next for now', ask?.next.id === 'b' && ask?.other.id === 'a', ask);
  check('…never with one lane, or with only one lane waiting', L.mergeAsk([a, b, c], false, new Set(), NOW) === null && L.mergeAsk([a, c], true, new Set(), NOW) === null);
  check('…nor once one of them is paying', L.mergeAsk([a, b, c], true, new Set(['a']), NOW) === null && L.mergeAsk([a, b, c], true, new Set(['b']), NOW) === null);
  check('…nor once the one in front was said to be first', L.mergeAsk([a, { ...b, mergeSure: true }, c], true, new Set(), NOW) === null);
  check('…and never about a car taken in line, or one already paid', L.mergeAsk([a, { ...b, inLine: true }], true, new Set(), NOW) === null && L.mergeAsk([a, { ...b, stage: 'pickup' }], true, new Set(), NOW) === null && L.mergeAsk([a, { ...b, wasInLine: true, hereAt: at(5) }], true, new Set(), NOW) === null);
  check('…nor about a car with no lane (made at the window for an order placed ahead, or from before two lanes), or one left behind for hours',
    L.mergeAsk([a, { ...b, lane: undefined }], true, new Set(), NOW) === null && L.mergeAsk([a, { ...b, arrivedAt: new Date(NOW - 4 * 3600000).toISOString() }], true, new Set(), NOW) === null
    && L.mergeAsk([a, { ...b, arrivedAt: new Date(NOW - 4 * 3600000).toISOString() }, { ...b, id: 'b2', arrivedAt: at(15), stageAt: { pay: at(95) } }], true, new Set(), NOW)?.other.id === 'b2');
  const tapA = L.mergeFirst(a, ask!), tapB = L.mergeFirst(b, ask!);
  check('tapping the car behind puts it just ahead of the other; tapping the one in front only settles it', tapA.mergeSure && tapA.mergeAt === new Date(Date.parse(at(70)) - 1).toISOString() && tapB.mergeSure && !tapB.mergeAt, [tapA, tapB]);
  const merged = [{ ...a, ...tapA }, b, c];
  check('…so the car tapped is first, its lane-mate stays behind it, and nothing more is asked', merged.sort(L.byWindow(true)).map((x) => x.id).join() === 'a,b,c' && L.mergeAsk(merged, true, new Set(), NOW) === null);
  const pf = L.paidFirst([a, b, c], 'a', true, NOW);
  check('a car that pays at the window while the other lane’s front car was taken to be ahead merged first (even after a tap said otherwise); the one in front, nothing to change',
    pf?.mergeSure === true && pf.mergeAt === new Date(Date.parse(at(70)) - 1).toISOString() && L.paidFirst([a, { ...b, mergeSure: true }, c], 'a', true, NOW)?.mergeAt === pf.mergeAt
    && L.paidFirst([a, b, c], 'b', true, NOW) === null && L.paidFirst([a, b, c], 'c', true, NOW) === null && L.paidFirst([a, b, c], 'a', false, NOW) === null, pf);
  const places = L.windowPlaces([a, b, c, { id: 'd', stage: 'forward', lane: 2, orderId: 'od', arrivedAt: at(-60) }, { id: 'e', stage: 'pickup', lane: 1, orderId: 'oe', aheadId: 'oe2', arrivedAt: at(-30), stageAt: { pay: at(30) } },
    { id: 'f', stage: 'pay', inLine: true, orderId: 'of', arrivedAt: at(-90) }, { id: 'g', stage: 'speaker', lane: 1, orderId: 'og', arrivedAt: at(110) }].map((x: any) => ({ orderId: `o${x.id}`, ...x })), true, NOW);
  check('the kitchen’s places: cars coming to the window, in the line’s order, with their lane (and their order placed ahead too)',
    places.get('oe')?.place === 1 && places.get('oe2')?.place === 1 && places.get('ob')?.place === 2 && places.get('oa')?.place === 3 && places.get('oc')?.place === 4 && places.get('ob')?.lane === 2 && places.get('oa')?.lane === 1, Array.from(places.entries()));
  check('…not a car parked in a spot, one still in line, or one still ordering', !places.has('od') && !places.has('of') && !places.has('og'));
  check('…and no lane with one lane, or for a car with none', L.windowPlaces([a], false, NOW).get('oa' as any) === undefined && L.windowPlaces([{ ...a, orderId: 'oa' }], false, NOW).get('oa')?.lane === null && L.windowPlaces([{ id: 'h', stage: 'pickup', orderId: 'oh', arrivedAt: at(0) }], true, NOW).get('oh')?.lane === null
    && !L.windowPlaces([{ ...a, orderId: 'oa', arrivedAt: new Date(NOW - 4 * 3600000).toISOString() }], true, NOW).has('oa'));

  console.log('Set on the Menu page');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Food', price: 6, totalStock: 50, makeSeconds: 120 });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Latte', category: 'Drinks', price: 4.5, totalStock: 50, makeSeconds: 60 });
  let r: any = await menuApi(req({ tenantId: 't1', action: 'list' }));
  check('the Menu page reads one lane to start', r.body.lane?.lanes === 1, r.body.lane);
  r = await menuApi(req({ tenantId: 't1', action: 'laneSettings', lanes: 2 }));
  check('…and turns on two that merge', r.status === 200 && r.body.lane?.lanes === 2 && (await get(T))?.driveThru?.lanes === 2, r.body);
  r = await menuApi(req({ tenantId: 't1', action: 'laneSettings', lanes: 3 }));
  check('…never anything but one or two', r.status === 400 && (await get(T))?.driveThru?.lanes === 2, r.body);

  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const bkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Order board', kind: 'drive-thru-board' }))).body.key;
  const kkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Grill', kind: 'kitchen' }))).body.key;
  manager = false;
  const P = (x: any) => POST(req({ tenantId: 't1', key, ...x }));
  const board = (lane?: number) => POST(req({ tenantId: 't1', key: bkey, action: 'board', ...(lane ? { lane } : {}) }));
  const win = () => POST(req({ tenantId: 't1', key: bkey, action: 'window', at: 'pay' }));

  console.log('Every car carries its lane');
  const A: any = (await P({ action: 'car', carKey: 'lanecar-0001', lane: 1 })).body;
  await P({ action: 'add', orderId: A.orderId, itemId: 'burger', tapKey: 'lanetap-0001' });
  const B: any = (await P({ action: 'car', carKey: 'lanecar-0002', lane: 2 })).body;
  await P({ action: 'add', orderId: B.orderId, itemId: 'latte', tapKey: 'lanetap-0002' });
  const X: any = (await P({ action: 'car', carKey: 'lanecar-0003', lane: 2, inLine: true, looks: 'Red SUV' })).body;
  check('a car added at a lane keeps it; one taken in line has none', (await get(`${T}/driveThruCars/${A.carId}`))?.lane === 1 && (await get(`${T}/driveThruCars/${B.carId}`))?.lane === 2 && !('lane' in ((await get(`${T}/driveThruCars/${X.carId}`)) || {})));
  let b1: any = await board(1), b2: any = await board(2), b0: any = await board();
  check('each order board shows only its own lane’s car (and says there are two lanes)', b1.body.order?.number === A.number && b2.body.order?.number === B.number && b0.body.lanes === 2, [b1.body.order?.number, b2.body.order?.number]);
  check('…a board not set to a lane shows the newest car, as before', b0.body.order?.number === B.number, b0.body.order);

  console.log('The line to the window');
  await P({ action: 'send', orderId: B.orderId });
  await db.doc(`${T}/driveThruCars/${B.carId}`).set({ stageAt: { pay: at(70) } }, { merge: true });
  await P({ action: 'send', orderId: A.orderId });
  await db.doc(`${T}/driveThruCars/${A.carId}`).set({ stageAt: { pay: at(90) } }, { merge: true });
  let lane: any = (await P({ action: 'lane' })).body;
  const ids = lane.cars.map((x: any) => x.id);
  check('the lane screen: the line to the window first (in the order they finished ordering), with each car’s lane', ids.indexOf(B.carId) < ids.indexOf(A.carId) && lane.cars.find((x: any) => x.id === A.carId)?.lane === 1 && lane.settings.lanes === 2, lane.cars.map((x: any) => [x.number, x.lane, x.stage]));
  check('…and asks which car merged first: the one that finished first is next for now', lane.merge?.next === B.carId && lane.merge?.other === A.carId, lane.merge);
  let w: any = await win();
  check('the pay window shows the car next in that line', w.body.show?.number === B.number, w.body.show?.number);
  let k: any = await kitchen(req({ tenantId: 't1', key: kkey, action: 'tickets' }));
  const tA = () => k.body.tickets.find((t: any) => t.orderId === A.orderId), tB = () => k.body.tickets.find((t: any) => t.orderId === B.orderId);
  check('the kitchen has each drive-thru order’s place in that line and its lane', tB()?.windowPlace === 1 && tB()?.lane === 2 && tA()?.windowPlace === 2 && tA()?.lane === 1, [tA()?.windowPlace, tB()?.windowPlace]);

  console.log('One tap: this car merged first');
  r = await P({ action: 'merged', carId: A.carId });
  await new Promise((res) => setTimeout(res, 2600));   // (the kitchen reads the line once every few seconds)
  lane = (await P({ action: 'lane' })).body; w = await win(); k = await kitchen(req({ tenantId: 't1', key: kkey, action: 'tickets' }));
  check('the car tapped goes first: the lane screen, the window and the kitchen, and nothing more is asked', r.status === 200 && r.body.done && lane.merge === null && w.body.show?.number === A.number && tA()?.windowPlace === 1 && tB()?.windowPlace === 2, [r.body, lane.merge, w.body.show?.number]);
  r = await P({ action: 'merged', carId: B.carId });
  check('…a tap on a car no longer asked about changes nothing', r.status === 200 && r.body.already && (await win()).body.show?.number === A.number, r.body);
  const C: any = (await P({ action: 'car', carKey: 'lanecar-0004', lane: 1 })).body;
  await P({ action: 'add', orderId: C.orderId, itemId: 'burger', tapKey: 'lanetap-0004' });
  await P({ action: 'send', orderId: C.orderId });
  lane = (await P({ action: 'lane' })).body;
  check('a car behind its lane-mate is never asked about', lane.merge === null, lane.merge);
  await db.doc(`${T}/driveThruCars/${A.carId}`).set({ stage: 'pickup', stageAt: { pay: at(69), pickup: at(150) } }, { merge: true });
  lane = (await P({ action: 'lane' })).body;
  check('once the first car is through, the next pair is asked about', lane.merge && [lane.merge.next, lane.merge.other].sort().join() === [B.carId, C.carId].sort().join(), lane.merge);
  await db.doc(`${T}/counterOrders/${B.orderId}`).set({ card: { state: 'on_reader', at: new Date().toISOString() } }, { merge: true });
  lane = (await P({ action: 'lane' })).body;
  check('…and not while one of them is paying on the reader: it’s at the window', lane.merge === null, lane.merge);
  r = await P({ action: 'paid', orderId: C.orderId, method: 'cash', tendered: 20 });
  const cAfter: any = await get(`${T}/driveThruCars/${C.carId}`);
  check('the other lane’s car pays at the window first: it merged first, so it goes ahead of the car taken to be in front', r.status === 200 && cAfter?.mergeSure === true && String(cAfter?.mergeAt) < at(70), [r.body, cAfter?.mergeAt]);
  r = await POST(req({ tenantId: 't1', key, action: 'merged', carId: 'not a car!' }));
  const r2: any = await POST(req({ tenantId: 't1', key, action: 'merged', carId: 'nosuchcar' }));
  check('a car that isn’t one is refused, and one not in question changes nothing', r.status === 400 && r2.status === 200 && r2.body.already, [r.body, r2.body]);

  console.log('One lane, as before');
  manager = true; await menuApi(req({ tenantId: 't1', action: 'laneSettings', lanes: 1 })); manager = false;
  const D: any = (await P({ action: 'car', carKey: 'lanecar-0005', lane: 2 })).body;
  lane = (await P({ action: 'lane' })).body; k = await kitchen(req({ tenantId: 't1', key: kkey, action: 'tickets' }));
  r = await P({ action: 'merged', carId: C.carId });
  check('with one lane a car has no lane, nothing is asked, the kitchen has no places, and a tap is refused', !('lane' in ((await get(`${T}/driveThruCars/${D.carId}`)) || {})) && lane.merge === null && lane.settings.lanes === 1
    && lane.cars.every((x: any) => x.lane === null) && k.body.tickets.every((t: any) => t.windowPlace === null && t.lane === null) && r.status === 409, [lane.merge, r.body]);

  console.log('The screens');
  const sp = src('src/app/drive-thru/[tenantId]/speaker/page.tsx'), bd = src('src/app/drive-thru/[tenantId]/board/page.tsx'), ln = src('src/app/drive-thru/[tenantId]/page.tsx');
  const kds = src('src/app/kds/[tenantId]/page.tsx'), mp = src('src/app/(app)/menu/page.tsx'), vr = src('src/app/api/counter/voice/route.ts'), kl = src('src/lib/kitchen.ts');
  check('the speaker: asks its lane once (kept on the tablet), greets only its own lane’s cars, and a car pulled up there is that lane’s',
    /Which lane is this speaker at\?/.test(sp) && /cf\.drivethru\.speakerLane\./.test(sp) && /action: 'speaker', lane: atLane/.test(sp) && /action: 'car', carKey: rid\(\), lane: atLane/.test(sp) && /Change lane/.test(sp)
    && /const myLane = lanesOf\(tenant\) === 2 \? cleanLane\(b\.lane\) : null;/.test(vr) && /lanes: lanesOf\(tenant\) \}\);/.test(vr));
  check('the order board: asks its lane once (or ?lane=), sends it, and can be changed from the corner', /Which lane is this screen at\?/.test(bd) && /action: 'board', lane: myLane/.test(bd) && /get\('lane'\)/.test(bd) && /setPicking\(true\)/.test(bd));
  check('the lane screen: a New car button for each lane, each car’s lane, Taking orders for one lane, and Which car is next at the window',
    /aria-label=\{`New car at lane \$\{l\}`\}/.test(ln) && /New car at the speaker<\/p>/.test(ln) && /Lane \{c\.lane\}/.test(ln) && /'Taking orders, lane 1'/.test(ln) && /function MergeAsk/.test(ln) && /Which car is next at the window\?/.test(ln) && /action: 'merged', carId: c\.id/.test(ln)
    && /\.sort\(byWindow\(twoLanes\)\)/.test(ln) && /`car\$\{at \|\| ''\}`\);/.test(ln));
  check('the kitchen: the lane and the place on each drive-thru order, bagged in window order', /function WindowPlace/.test(kds) && /say\('Next at the window'\)/.test(kds) && /say\('Lane \{n\}', \{ n: t\.lane \}\)/.test(kds)
    && /ready: tickets\.filter\(\(t\) => t\.status === 'ready'\)\.sort\(\(a, b\) => \(a\.windowPlace && b\.windowPlace/.test(kds) && /if \(dt\(a\) && pa !== pb\)/.test(kl));
  const S = await import('../../src/lib/screen-lang');
  check('…in Spanish too', ['Lane {n}', 'Next at the window', '1 car ahead', '{n} cars ahead'].every((x) => S.hasSpanish(x)));
  check('the Menu page: Ordering lanes, One lane or Two that merge, only while cars order at the speaker', /Ordering lanes/.test(mp) && /\[2, 'Two that merge'\]/.test(mp) && /lanes !== null && pickupOnly === false/.test(mp));
  const ours = src('src/lib/drive-lanes.ts');
  check('in the app’s own words', !/salon|stylist|booth|chair\b|studio|\buppercase\b|font-black/i.test(ours + ln.slice(ln.indexOf('function MergeAsk'), ln.indexOf('function NameField'))));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
