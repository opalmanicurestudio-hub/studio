// Checks the sensors further along the lane (design board "Speed of service, and what slows it", part 4; lib/lane-entry
// SENSOR_POINTS, lib/lane-entry-server pointCar / pointsView, lib/counter-server createCar, lib/counter-handover,
// api/menu laneSettings, api/counter/lane-entry, lib/drive-live, the Menu page's card, Drive-thru live).
// - The speaker: a car pulled up. Its time starts then, and a car nobody has greeted yet shows on Drive-thru live; a car
//   the crew started a moment before the sensor saw it is that car.
// - The pickup window: the first paid car in the line to the window that isn't there yet got there.
// - The exit: a car just handed over is the one that left; with no doubt (one car at the window, paid, ready, none
//   parked), it's handed over on its own; otherwise the window is asked to check.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/lane-points.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

const db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
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
let ip = 0;
const getReq = (url: string) => ({ json: async () => ({}), nextUrl: new URL(url), headers: { get: (k: string) => (String(k).toLowerCase() === 'x-forwarded-for' ? `10.1.0.${++ip % 250}` : null) } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// (As if the gap for the same car seen again had passed: lib/lane-entry POINT_GAP_MS.)
const rearm = (point: string) => db.doc(`tenants/t1/private/lanePoint_${point}_1`).set({ lastMs: 0 });

(async () => {
  const E = await import('../../src/lib/lane-entry');
  const NOW = Date.now(); const at = (s: number) => new Date(NOW + s * 1000).toISOString();

  console.log('the rules (lib/lane-entry)');
  check('four places along the lane; a link from before is the lane entry', E.SENSOR_POINTS.map((p) => p.id).join() === 'entry,speaker,window,exit' && E.pointOf(undefined) === 'entry' && E.pointOf('exit') === 'exit' && E.pointOf('roof') === 'entry');
  let a = E.addArrival(null, NOW - 20000); const a2 = E.addArrival(a.log, NOW - 19500); a = E.addArrival(a2.log, NOW - 5000);
  check('a car pulled up to the speaker; the same car again in a moment, once; the next car', a.counted && !a2.counted && a.log.at.length === 2);
  const cl = E.claimArrival(a.log, NOW);
  check('someone starts an order: the car that pulled up first is that one, and the other still waits', cl.at === at(-20) && cl.log.at.length === 1 && E.unclaimedArrivals(cl.log, NOW).join() === at(-5));
  check('…a car that pulled up over a minute and a half ago and was never started isn’t waiting any more (and never makes the next car’s time start early)', E.unclaimedArrivals({ at: [at(-95)] }, NOW).length === 0 && E.claimArrival({ at: [at(-95)] }, NOW).at === null && E.claimArrival({ at: [at(-80)] }, NOW).at === at(-80));
  check('the same car seen again past the entry: one car, for longer than a car can leave and the next take its place', E.POINT_GAP_MS.speaker >= 10000 && E.POINT_GAP_MS.speaker <= 15000 && E.POINT_GAP_MS.window >= 15000 && E.POINT_GAP_MS.exit >= 15000);
  const line: any[] = [{ id: 'p1', stage: 'pickup', stageAt: { window: at(-30) } }, { id: 'p2', stage: 'pickup', stageAt: {} }, { id: 'p3', stage: 'pickup', stageAt: {} }];
  check('the pickup window: the first paid car in the line that isn’t there yet', E.windowCar(line)?.id === 'p2' && E.windowCar([line[0]]) === null);
  const g: any = { id: 'g1', stage: 'gone', goneAt: at(-20) };
  check('the exit: a car just handed over is the one that left', (E.exitPick({ atWindow: line, parked: [], gone: [g] }, NOW) as any).car?.id === 'g1');
  check('…otherwise, one car at the window (the window’s sensor saw it) and none parked: that one', (E.exitPick({ atWindow: line, parked: [], gone: [{ ...g, exitAt: at(-5) }] }, NOW) as any).kind === 'handover' && (E.exitPick({ atWindow: line, parked: [], gone: [] }, NOW) as any).car.id === 'p1');
  check('…with no window sensor, the only paid car waiting', (E.exitPick({ atWindow: [line[1]], parked: [], gone: [] }, NOW) as any).car?.id === 'p2');
  check('…two at the window, or any parked, or one handed over a while ago: the window is asked',
    E.exitPick({ atWindow: [line[1], line[2]], parked: [], gone: [] }, NOW).kind === 'ask' && E.exitPick({ atWindow: [line[0]], parked: [{ id: 'f1', stage: 'forward' }], gone: [] }, NOW).kind === 'ask'
    && E.exitPick({ atWindow: [line[1], line[2]], parked: [], gone: [{ ...g, goneAt: at(-90) }] }, NOW).kind === 'ask');

  console.log('links for each, from the Menu page');
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  const { GET: entryGet } = await import('../../src/app/api/counter/lane-entry/route');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: counter } = await import('../../src/app/api/counter/route');
  const S = await import('../../src/lib/lane-entry-server');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, driveThru: { askName: false } });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Food', price: 6, totalStock: 50, makeSeconds: 120 });
  let r: any = await menuApi(req({ tenantId: 't1', action: 'list' }));
  check('the Menu page: the speaker, the pickup window and the exit, none set up; the lane entry as before', r.body.lane?.points?.map((x: any) => x.point).join() === 'speaker,window,exit' && r.body.lane.points.every((x: any) => !x.on) && r.body.lane.sensors.length === 2, r.body.lane);
  const make = async (point: string) => { const x: any = await menuApi(req({ tenantId: 't1', action: 'laneSettings', sensor: 'new', lane: 1, point })); return { body: x.body, link: String(x.body.sensorLink?.link || '') }; };
  const spk = await make('speaker'); const win = await make('window'); const ext = await make('exit');
  const sens: any = await get(`${T}/private/laneSensors`);
  check('a link each, shown once, only its fingerprint kept; the lane entry still not set up',
    [spk, win, ext].every((x) => /\/api\/counter\/lane-entry\?t=t1&k=[a-f0-9]{48}$/.test(x.link)) && ext.body.lane.points.every((x: any) => x.on) && ext.body.lane.sensors[0].on === false
    && Object.values(sens.tokens).map((t: any) => t.point).sort().join() === 'exit,speaker,window' && ![spk, win, ext].some((x) => JSON.stringify(sens).includes(new URL(x.link).searchParams.get('k')!)), ext.body.lane);
  const again = await make('speaker');
  check('a new speaker link stops the old one, and leaves the others', (await entryGet(getReq(spk.link))).status === 404 && Object.keys((await get(`${T}/private/laneSensors`)).tokens).length === 3);
  const speaker = again.link;

  console.log('the speaker');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  manager = false;
  const P = (x: any) => counter(req({ tenantId: 't1', key, ...x }));
  r = await entryGet(getReq(speaker));
  check('a car pulls up: counted at the speaker, nobody’s started it yet', r.status === 200 && r.body.counted === true && r.body.point === 'speaker' && (await get(`${T}/private/laneSpeaker_1`))?.at?.length === 1, r.body);
  await wait(1600);
  r = await entryGet(getReq(speaker));
  check('…the sensor fires again while it’s still there: the same car, not a second one', r.body.counted === false && (await get(`${T}/private/laneSpeaker_1`))?.at?.length === 1, r.body);
  const D = await import('../../src/lib/drive-live-server');
  D.forgetLive('t1');
  let live: any = await D.liveNow(db, 't1', await get(T), null);
  check('Drive-thru live shows it at the speaker, counting up', live.atSpeaker?.length === 1 && live.atSpeaker[0].lane === 1, live.atSpeaker);
  const pulledAt = (await get(`${T}/private/laneSpeaker_1`)).at[0];
  await wait(1100);
  const A: any = (await P({ action: 'car', carKey: 'pointcar-0001' })).body;
  const carA: any = await get(`${T}/driveThruCars/${A.carId}`);
  check('someone starts its order: its time started when it pulled up, and when it was greeted is kept; it’s no longer waiting to be greeted',
    carA.arrivedAt === pulledAt && carA.stageAt.speaker === pulledAt && Date.parse(carA.greetedAt) > Date.parse(pulledAt) && (await get(`${T}/private/laneSpeaker_1`)).at.length === 0, carA);
  const B: any = (await P({ action: 'car', carKey: 'pointcar-0002' })).body;
  await rearm('speaker');
  r = await entryGet(getReq(speaker));
  const carB: any = await get(`${T}/driveThruCars/${B.carId}`);
  check('the crew started a car a moment before the sensor saw it: that car, not another one waiting', r.body.counted === true && !!carB.speakerSeen && !carB.greetedAt && ((await get(`${T}/private/laneSpeaker_1`))?.at || []).length === 0, [carB, await get(`${T}/private/laneSpeaker_1`)]);
  const C: any = (await P({ action: 'car', carKey: 'pointcar-0003', inLine: true, looks: 'Red SUV' })).body;
  check('a car taken in line never takes a car the speaker saw', !(await get(`${T}/driveThruCars/${C.carId}`)).greetedAt);

  console.log('the pickup window');
  const car = async (id: string, d: any) => db.doc(`${T}/driveThruCars/${id}`).set({ id, channel: 'drive-thru', number: id.toUpperCase(), ...d });
  for (const id of [A.carId, B.carId, C.carId]) await db.doc(`${T}/driveThruCars/${id}`).set({ stage: 'gone', goneAt: at(-600), left: true }, { merge: true });
  await car('w1', { stage: 'pickup', arrivedAt: at(-200), stageAt: { speaker: at(-200), pay: at(-150), pickup: at(-100) }, orderId: 'ow1' });
  await car('w2', { stage: 'pickup', arrivedAt: at(-150), stageAt: { speaker: at(-150), pay: at(-90), pickup: at(-60) }, orderId: 'ow2' });
  r = await entryGet(getReq(win.link));
  check('a car at the window: the first paid car in the line', r.body.counted === true && !!(await get(`${T}/driveThruCars/w1`)).stageAt.window && !(await get(`${T}/driveThruCars/w2`)).stageAt.window);
  const r2: any = await entryGet(getReq(win.link));
  check('…the same car seen again in a moment, once', r2.body.counted === false && !(await get(`${T}/driveThruCars/w2`)).stageAt.window);
  await rearm('window');
  await entryGet(getReq(win.link));
  check('…the next car, the next', !!(await get(`${T}/driveThruCars/w2`)).stageAt.window);

  console.log('the exit');
  await db.doc(`${T}/counterOrders/ow1`).set({ status: 'sent', paidAt: at(-100), channel: 'drive-thru', number: 'W1', readyText: { to: '+15555550100', last4: '0100' } });
  await db.doc(`${T}/kdsTickets/t1a`).set({ orderId: 'ow1', status: 'ready', menuItemName: 'Burger', quantity: 1 });
  await db.doc(`${T}/counterOrders/ow2`).set({ status: 'sent', paidAt: at(-60), channel: 'drive-thru', number: 'W2' });
  await db.doc(`${T}/kdsTickets/t2a`).set({ orderId: 'ow2', status: 'in_progress', menuItemName: 'Shake', quantity: 1 });
  await rearm('exit');
  r = await entryGet(getReq(ext.link));
  check('two cars at the window: which one left isn’t certain, so the window is asked (and nothing is handed over)', r.body.counted === true && !!(await get(`${T}/private/laneExit`))?.askAt && (await get(`${T}/driveThruCars/w1`)).stage === 'pickup' && (await get(`${T}/driveThruCars/w2`)).stage === 'pickup');
  D.forgetLive('t1'); live = await D.liveNow(db, 't1', await get(T), null);
  check('…Drive-thru live says so', !!live.exitAsk);
  await db.doc(`${T}/driveThruCars/w2`).set({ stage: 'gone', goneAt: at(-500), left: true }, { merge: true });
  await rearm('exit');
  r = await entryGet(getReq(ext.link));
  const w1: any = await get(`${T}/driveThruCars/w1`); const o1: any = await get(`${T}/counterOrders/ow1`);
  check('one car at the window, paid, its order ready, none parked: handed over on its own, as the window would',
    w1.stage === 'gone' && w1.handedBy === 'Exit sensor' && !!w1.exitAt && !w1.left && o1.status === 'done' && o1.readyText?.to === null && (await get(`${T}/kdsTickets/t1a`)).status === 'delivered', [w1, o1]);
  await car('w3', { stage: 'pickup', arrivedAt: at(-90), stageAt: { pickup: at(-30), window: at(-10) }, orderId: 'ow3' });
  await db.doc(`${T}/counterOrders/ow3`).set({ status: 'sent', paidAt: at(-30), channel: 'drive-thru', number: 'W3' });
  await db.doc(`${T}/kdsTickets/t3a`).set({ orderId: 'ow3', status: 'in_progress', menuItemName: 'Shake', quantity: 1 });
  await db.doc(`${T}/private/laneExit`).set({ askAt: at(-600) });
  await rearm('exit');
  await entryGet(getReq(ext.link));
  check('…but never one still being made: the window is asked instead', (await get(`${T}/driveThruCars/w3`)).stage === 'pickup' && (await get(`${T}/private/laneExit`)).askAt > at(-5));
  await db.doc(`${T}/kdsTickets/t3a`).set({ orderId: 'ox' }, { merge: true });
  await db.doc(`${T}/private/laneExit`).set({ askAt: at(-600) }); await rearm('exit');
  await entryGet(getReq(ext.link));
  check('…nor one with nothing on the kitchen’s screen for it yet (it isn’t made, it’s not started)', (await get(`${T}/driveThruCars/w3`)).stage === 'pickup' && (await get(`${T}/private/laneExit`)).askAt > at(-5));
  await db.doc(`${T}/kdsTickets/t3a`).set({ orderId: 'ow3', status: 'ready' }, { merge: true });
  await db.doc(`${T}/counterOrders/ow3`).set({ status: 'voided' }, { merge: true });
  await db.doc(`${T}/private/laneExit`).set({ askAt: at(-600) }); await rearm('exit');
  await entryGet(getReq(ext.link));
  check('…nor one voided since it was paid', (await get(`${T}/driveThruCars/w3`)).stage === 'pickup' && (await get(`${T}/counterOrders/ow3`)).status === 'voided' && (await get(`${T}/private/laneExit`)).askAt > at(-5));
  await db.doc(`${T}/counterOrders/ow3`).set({ status: 'sent' }, { merge: true });
  await db.doc(`${T}/kdsTickets/t3a`).set({ status: 'ready' }, { merge: true });
  await db.doc(`${T}/driveThruCars/w3`).set({ stage: 'gone', goneAt: new Date().toISOString(), handedBy: 'Ana' }, { merge: true });
  await rearm('exit');
  await entryGet(getReq(ext.link));
  check('a car the window just handed over drives off: that’s the one, seen leaving', !!(await get(`${T}/driveThruCars/w3`)).exitAt);

  console.log('turned off');
  manager = true;
  r = await menuApi(req({ tenantId: 't1', action: 'laneSettings', sensor: 'stop', lane: 1, point: 'exit' }));
  check('the exit’s link stops, its question goes, the others stay', (await entryGet(getReq(ext.link))).status === 404 && !(await get(`${T}/private/laneExit`)) && (await entryGet(getReq(speaker))).status === 200 && r.body.lane.points.find((x: any) => x.point === 'exit').on === false);
  r = await menuApi(req({ tenantId: 't1', action: 'laneSettings', sensor: 'stop', lane: 1, point: 'speaker' }));
  check('…the speaker’s, with the cars it saw', !(await get(`${T}/private/laneSpeaker_1`)) && (await entryGet(getReq(win.link))).status === 200);
  await db.doc(T).set({ driveThru: { lanes: 2 } }, { merge: true });
  r = await menuApi(req({ tenantId: 't1', action: 'list' }));
  check('two ordering lanes: a speaker each; one pickup window and one exit', r.body.lane.points.map((x: any) => `${x.point}${x.lane}`).join() === 'speaker1,speaker2,window1,exit1');
  r = await menuApi(req({ tenantId: 't1', action: 'laneSettings', sensor: 'new', lane: 2, point: 'window' }));
  check('…the window’s link is the one for both lanes', r.body.sensorLink?.lane === 1);

  console.log('waiting to order');
  // (Another business, with no cars of its own yet.)
  const T2 = 'tenants/t2'; const now2 = Date.now(); const at2 = (x: number) => new Date(now2 + x * 1000).toISOString();
  await db.doc(T2).set({ name: 'Southside', timezone: 'UTC' });
  await db.doc(`${T2}/private/laneEntry_1`).set({ at: [at2(-120), at2(-60), at2(-30)] });
  let ln = await S.lineNow(db, 't2', await get(T2), { cars: [], nowMs: now2 });
  check('three counted at the entry: three waiting to order', ln.sensor && ln.waiting === 3, ln);
  await db.doc(`${T2}/private/laneSpeaker_1`).set({ at: [at2(-20)] });
  ln = await S.lineNow(db, 't2', await get(T2), { cars: [], nowMs: now2 + 1 });
  check('a car the speaker saw pull up isn’t waiting to order any more', ln.sensor && ln.waiting === 2, ln);

  console.log('the screens');
  const card = src('src/components/menu/LaneEntrySettings.tsx'), pg = src('src/app/(app)/drive-live/page.tsx'), mp = src('src/app/(app)/menu/page.tsx');
  check('the Menu page: the sensors further along the lane, each with its link (shown once), Check it and Turn off', /Sensors further along the lane/.test(card) && /points\.map/.test(card) && /point: x\.point \|\| 'entry'/.test(card) && /points=\{laneEntry\.points\}/.test(mp));
  check('Drive-thru live: a new car at the speaker counting up, and the exit’s question', /New car/.test(pg) && /greetTone\(sec\)/.test(pg) && /that nobody handed over\. Check the window/.test(pg) && /'Waiting to be greeted'/.test(pg));
  check('handed over one way, by the window or the exit (lib/counter-handover)', /handOverInTx\(tx, db, T, \{ carRef, car, order, tix, aheadRef, aheadTix, by, nowIso \}\)/.test(src('src/app/api/counter/route.ts')) && /handOverInTx\(tx, db, T,/.test(src('src/lib/lane-entry-server.ts')));
  for (const f of ['src/lib/lane-entry.ts', 'src/lib/lane-entry-server.ts', 'src/lib/counter-handover.ts', 'src/components/menu/LaneEntrySettings.tsx']) {
    const s = src(f);
    check(`${f}: no shouting or heavy type, no " · ", no comments in markup`, !/\buppercase\b|font-black| · |\{\/\*/.test(s));
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
