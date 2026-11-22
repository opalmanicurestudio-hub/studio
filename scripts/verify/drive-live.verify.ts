// Checks Drive-thru live (design board "Drive-thru live", layout A: the lane, from above; lib/drive-live, lib/drive-live-
// server, api/drive-live, the Drive-thru live page).
// - Every car in the lane now, where it is (the speaker, the pay window, the pickup window, a spot), with its guest's
//   first name, its time against the drive-thru target (on time, near it, over it), where that time went and what the
//   kitchen is still making; the cars counted at the entry that haven't reached the speaker.
// - Drawn as the lane from above: each car at its stage's place or just behind the car in front; two ordering lanes each
//   from its own speaker; parked cars in their spots; a long line squeezed into a wide screen, or a phone's lane grown.
// - Underneath: curbside, orders placed ahead for the drive-thru, the counter's line. Nothing here moves a car.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/drive-live.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
let actor: any = { uid: 's1', name: 'Kai Park', role: 'staff', caps: [] };
let denied = false;
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async (_r: any, _t: any, level: string) => (denied ? { deny: { status: 401, body: { ok: false, error: 'Please sign in again.' } } } : (lastLevel = level, { actor, tenant: {} })) };
  return load.call(this, request, ...rest);
};
let lastLevel = '';
const T = 'tenants/t1';
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const L = await import('../../src/lib/drive-live');
  const NOW = Date.parse('2026-11-22T17:30:00.000Z'); const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

  console.log('times and colors');
  check('a clock: minutes and seconds, hours when it comes to that', L.clock(38) === '0:38' && L.clock(264) === '4:24' && L.clock(3725) === '1:02:05' && L.clock(-4) === '0:00');
  check('on time, then near the target from three quarters of it, then over it', L.toneOf(100, 210) === 'ok' && L.toneOf(157, 210) === 'ok' && L.toneOf(158, 210) === 'near' && L.toneOf(209, 210) === 'near' && L.toneOf(210, 210) === 'over');
  const car = (id: string, stage: any, o: any = {}): any => ({ id, number: id.toUpperCase(), name: null, looks: null, stage, lane: null, spot: null, since: ago(o.waited ?? 60), stageAt: o.stageAt || {}, ahead: false, inLine: false, kitchen: 'making', waitingOn: [], ...o });
  const c1 = car('b38', 'pickup', { waited: 264, stageAt: { speaker: ago(264), pay: ago(212), pickup: ago(150) }, kitchen: 'making', waitingOn: ['Shake'] });
  const t1 = L.timesOf(c1, NOW);
  check('where a car’s time went: ordering, on to the window, at the window', t1.ordering === 52 && t1.toWindow === 62 && t1.atWindow === 150, t1);
  check('…still ordering: only ordering so far', JSON.stringify(L.timesOf(car('b41', 'speaker', { waited: 38, stageAt: { speaker: ago(38) } }), NOW)) === JSON.stringify({ ordering: 38, toWindow: null, atWindow: null }));
  check('…come for an order placed ahead, straight to pickup: only at the window', JSON.stringify(L.timesOf(car('a12', 'pickup', { waited: 70, ahead: true, stageAt: { pickup: ago(70) } }), NOW)) === JSON.stringify({ ordering: null, toWindow: null, atWindow: 70 }));
  check('what it’s stuck on, in words', L.stuckWords(c1, NOW) === 'Most of it at the window: 2:30, waiting on Shake', L.stuckWords(c1, NOW));

  console.log('the lane, from above');
  const shape = L.laneShape({ length: 800, slot: 78, laneWidth: 56, two: false });
  check('the places in order: the entry, the speaker, the pay window, the pickup window, the exit', shape.at.entry < shape.at.speaker && shape.at.speaker < shape.at.pay && shape.at.pay < shape.at.pickup && shape.at.pickup < 800 && shape.at.merge === null);
  const cars = [c1, car('b39', 'pickup', { waited: 72, stageAt: { speaker: ago(72), pay: ago(40), pickup: ago(20) } }), car('b40', 'pay', { waited: 182, stageAt: { speaker: ago(182), pay: ago(30) } }), car('b41', 'speaker', { waited: 38 }), car('b37', 'forward', { waited: 200, spot: 2, stageAt: { forward: ago(30) } })];
  let plan = L.placeLane(cars, shape, { two: false, waiting: { 1: 2, 2: 0 }, spots: 4, squeeze: true, perRow: 4 });
  const pos = (id: string) => plan.cars.find((p) => p.id === id)!;
  check('the first car at the pickup window, the next just behind it; the car paying at the pay window; the car ordering at the speaker',
    pos('b38').along === shape.at.pickup && pos('b39').along === shape.at.pickup - 78 && pos('b40').along === shape.at.pay && pos('b41').along === shape.at.speaker, plan.cars);
  check('two waiting to order, behind the speaker, one slot apart', plan.waiting.length === 2 && plan.waiting[0].along === shape.at.speaker - 78 && plan.waiting[1].along === shape.at.speaker - 156 && !plan.moreWaiting[1]);
  check('parked in the spot it was given', plan.spots[1].carId === 'b37' && pos('b37').along === plan.spots[1].along && pos('b37').across === shape.spotsAcross && !plan.spots[0].carId);
  const long = Array.from({ length: 12 }, (_, i) => car(`p${i}`, 'pickup', { waited: 300 - i, stageAt: { pickup: ago(300 - i) }, hereAt: ago(300 - i) }));
  plan = L.placeLane(long.slice(0, 7), shape, { two: false, waiting: { 1: 9, 2: 0 }, spots: 4, squeeze: true, minGap: 72 });
  const lo = shape.at.entry + 78 * 0.55;
  const gaps = (xs: number[]) => xs.slice(1).map((x, i) => xs[i] - x);
  let line = plan.cars.map((p) => p.along).concat(plan.waiting.map((w) => w.along));
  check('a long line on a wide screen: squeezed in, the front car still at the window, none past the entry, never closer than a car apart; the waiting beyond counted',
    line.every((x) => x >= lo - 0.001) && plan.cars.find((p) => p.id === 'p0')!.along === shape.at.pickup && gaps(line).every((g) => g >= 72 - 0.001) && plan.moreWaiting[1] + plan.waiting.length === 9 && !plan.moreCars.length, [line.map(Math.round), plan.moreWaiting]);
  plan = L.placeLane(long, shape, { two: false, waiting: { 1: 9, 2: 0 }, spots: 4, squeeze: true, minGap: 72 });
  line = plan.cars.map((p) => p.along);
  check('…longer than fits a car apart: every waiting car counted instead, then the cars at the back ("+2 more cars")',
    !plan.waiting.length && plan.moreWaiting[1] === 9 && plan.moreCars.join() === 'p10,p11' && plan.cars.length === 10 && gaps(line).every((g) => g >= 72 - 0.001) && line.every((x) => x >= lo - 0.001), [line.map(Math.round), plan.moreCars]);
  const grown = L.lengthFor(long, { min: 520, slot: 56, laneWidth: 84, two: false, waiting: { 1: 9, 2: 0 }, spots: 4 });
  const phone = L.placeLane(long, L.laneShape({ length: grown, slot: 56, laneWidth: 84, two: false }), { two: false, waiting: { 1: 9, 2: 0 }, spots: 4, squeeze: false });
  check('…on a phone the lane grows instead: every car a full slot apart, none past the entry',
    grown > 520 && phone.cars.every((p) => p.along >= 56 * 0.45 + 56 * 0.55 - 0.001) && phone.cars.every((p, i, a) => !i || Math.abs(a[i - 1].along - p.along - 56) < 0.001) && phone.moreWaiting[1] === 1, grown);
  const parkedMany = Array.from({ length: 6 }, (_, i) => car(`f${i}`, 'forward', { spot: i === 0 ? 3 : null, stageAt: { forward: ago(100 - i) } }));
  plan = L.placeLane(parkedMany, shape, { two: false, waiting: { 1: 0, 2: 0 }, spots: 4, squeeze: true, perRow: 4 });
  check('more cars parked than spots: each spot filled, the rest counted', plan.spots.every((s) => s.carId) && plan.spots[2].carId === 'f0' && plan.moreParked.length === 2);
  plan = L.placeLane([], shape, { two: false, waiting: { 1: 0, 2: 0 }, spots: 6, squeeze: true, perRow: 4 });
  check('six spots on a wide screen: four in a row, then two further out', plan.spots.filter((s) => s.across === shape.spotsAcross).length === 4 && plan.spots.filter((s) => s.across > shape.spotsAcross).length === 2);

  const two = L.laneShape({ length: 900, slot: 78, laneWidth: 56, two: true });
  const lanes = [car('b50', 'speaker', { lane: 1, waited: 40 }), car('b51', 'speaker', { lane: 2, waited: 30 }), car('b52', 'speaker', { lane: 2, waited: 20 }), car('b49', 'pay', { lane: 1, waited: 120, stageAt: { pay: ago(50) } })];
  plan = L.placeLane(lanes, two, { two: true, waiting: { 1: 0, 2: 1 }, spots: 4, squeeze: true });
  const p2 = (id: string) => plan.cars.find((p) => p.id === id)!;
  check('two lanes: each lane’s car at its own speaker, side by side; the next in lane 2 behind its own; the lanes meet before the pay window',
    two.at.merge! > two.at.speaker && two.at.merge! < two.at.pay && p2('b50').along === two.at.speaker && p2('b50').across < 0 && p2('b51').along === two.at.speaker && p2('b51').across > 0
    && p2('b52').along === two.at.speaker - 78 && p2('b49').across === 0 && p2('b49').along === two.at.pay && plan.waiting.length === 1 && plan.waiting[0].lane === 2, plan.cars);

  const phoneTwo = L.laneShape({ length: 700, slot: 56, laneWidth: 72, two: true });
  const backed = [...Array.from({ length: 6 }, (_, i) => car(`q${i}`, 'pickup', { waited: 300 - i, stageAt: { pickup: ago(300 - i) } })), car('o1', 'speaker', { lane: 1, waited: 20 }), car('o2', 'speaker', { lane: 2, waited: 10 })];
  plan = L.placeLane(backed, phoneTwo, { two: true, waiting: { 1: 0, 2: 0 }, spots: 3, squeeze: false });
  const tail = Math.min(...plan.cars.filter((p) => p.id.startsWith('q')).map((p) => p.along));
  check('two lanes on a phone, the line to the window backed up past where they meet: each lane’s cars wait behind it, never on top of it',
    tail < phoneTwo.at.merge! && plan.cars.filter((p) => p.id.startsWith('o')).every((p) => p.along <= tail - 56 + 0.001), [tail, plan.cars.filter((p) => p.id.startsWith('o'))]);

  console.log('the totals above the lane');
  const tot = L.liveTotals({ cars: [c1, car('b39', 'pickup', { waited: 72 })], waiting: { 1: 2, 2: 1 }, target: 210 }, NOW);
  check('cars in the lane, waiting to order, the longest wait, how many are over', tot.inLane === 2 && tot.waiting === 3 && tot.longest?.id === 'b38' && tot.longest.sec === 264 && tot.over === 1);

  console.log('read on the server');
  await db.doc(T).set({ name: 'Linden Coffee', timezone: 'America/New_York', kitchenSettings: { targets: { 'drive-thru': 210 } }, driveThru: { spots: 3 }, orderAhead: { on: true, driveThru: true, curbside: true } });
  const real = Date.now(); const rago = (s: number) => new Date(real - s * 1000).toISOString();
  const cset = async (id: string, d: any) => db.doc(`${T}/driveThruCars/${id}`).set({ id, channel: 'drive-thru', ...d });
  await cset('c1', { number: 'B38', stage: 'pickup', arrivedAt: rago(264), stageAt: { speaker: rago(264), pay: rago(212), pickup: rago(150) }, orderId: 'o1', looks: 'Red SUV' });
  await cset('c2', { number: 'B41', stage: 'speaker', arrivedAt: rago(38), stageAt: { speaker: rago(38) }, orderId: 'o2' });
  await cset('c3', { number: 'B37', stage: 'forward', arrivedAt: rago(200), stageAt: { speaker: rago(200), pay: rago(160), pickup: rago(130), forward: rago(30) }, orderId: 'o3', spot: 2 });
  await cset('c4', { number: 'B10', stage: 'pickup', arrivedAt: rago(5 * 3600), orderId: 'o4' });
  await cset('c5', { number: 'B11', stage: 'gone', arrivedAt: rago(100), goneAt: rago(10), orderId: 'o5' });
  await cset('c6', { number: 'C14', channel: 'counter', stage: 'pickup', arrivedAt: rago(95), orderId: 'o6' });
  await cset('c7', { number: 'B12', stage: 'speaker', arrivedAt: rago(20), orderId: 'o7', locationId: 'elm' });
  await db.doc(`${T}/counterOrders/o1`).set({ status: 'sent', guestName: 'Lee Ann', channel: 'drive-thru' });
  await db.doc(`${T}/counterOrders/o2`).set({ status: 'building', guestName: 'sam', channel: 'drive-thru' });
  await db.doc(`${T}/counterOrders/o3`).set({ status: 'sent', channel: 'drive-thru' });
  await db.doc(`${T}/kdsTickets/k1`).set({ orderId: 'o1', status: 'ready', menuItemName: 'Burger', quantity: 1 });
  await db.doc(`${T}/kdsTickets/k2`).set({ orderId: 'o1', status: 'in_progress', menuItemName: 'Shake', quantity: 2 });
  await db.doc(`${T}/kdsTickets/k3`).set({ orderId: 'o3', status: 'ready', menuItemName: 'Fries', quantity: 1 });
  await db.doc(`${T}/kdsTickets/k4`).set({ orderId: 'o1', status: 'cancelled', menuItemName: 'Pie', quantity: 1 });
  // A car with an order placed ahead going with it: still adding to its own (not sent), the order ahead not on the
  // kitchen's screen yet; and one whose order ahead is ready but whose own is sent with nothing made yet.
  await cset('c9', { number: 'B43', stage: 'speaker', arrivedAt: rago(50), orderId: 'o9', aheadId: 'a9' });
  await db.doc(`${T}/counterOrders/o9`).set({ status: 'building', channel: 'drive-thru' });
  await db.doc(`${T}/counterOrders/a9`).set({ status: 'sent', channel: 'ahead' });
  await cset('c10', { number: 'B44', stage: 'pickup', arrivedAt: rago(80), orderId: 'o10', aheadId: 'a10' });
  await db.doc(`${T}/counterOrders/o10`).set({ status: 'sent', channel: 'drive-thru', kitchenNone: true });
  await db.doc(`${T}/counterOrders/a10`).set({ status: 'sent', channel: 'ahead' });
  await db.doc(`${T}/kdsTickets/k10`).set({ orderId: 'a10', status: 'ready', menuItemName: 'Latte', quantity: 1 });
  await cset('c11', { number: 'A7', stage: 'pickup', arrivedAt: rago(40), aheadId: 'a11', ahead: true });
  await db.doc(`${T}/counterOrders/a11`).set({ status: 'sent', channel: 'ahead' });
  await db.doc(`${T}/kdsTickets/k11`).set({ orderId: 'a11', status: 'in_progress', menuItemName: 'Mocha', quantity: 1 });
  // The lane entry sensor: three counted; two cars (B41, and B12 at the other location) have reached a speaker since.
  await db.doc(`${T}/private/laneEntry_1`).set({ at: [rago(90), rago(60), rago(15)], clearedAt: rago(3600) });
  // An order placed ahead for the drive-thru, paid; a café curbside guest outside.
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(real));
  await db.doc(`${T}/counterOrders/a1`).set({ channel: 'ahead', day, number: 'A3', paidAt: rago(900), status: 'sent', ahead: { way: 'drive-thru', at: new Date(real + 600000).toISOString(), hereAt: null }, lines: [] });
  await db.doc(`${T}/counterOrders/a2`).set({ channel: 'ahead', day, number: 'A4', paidAt: rago(900), status: 'sent', ahead: { way: 'curbside', at: rago(60), hereAt: rago(130), curb: { where: 'Spot 4' } }, lines: [] });

  const S = await import('../../src/lib/drive-live-server');
  const tenant = (await db.doc(T).get()).data();
  const v = await S.liveNow(db, 't1', tenant, null);
  const byNum = (n: string) => v.cars.find((c) => c.number === n)!;
  check('only cars in the drive-thru now: not one handed over, not one left behind hours ago, not the counter’s', v.cars.map((c) => c.number).sort().join() === 'A7,B12,B37,B38,B41,B43,B44', v.cars.map((c) => c.number));
  check('never "ready" before it is: still adding to its own order (and nothing made for its order ahead yet) is not sent; ready once its order ahead is, with nothing of its own to make',
    byNum('B43').kitchen === 'not sent' && byNum('B44').kitchen === 'ready' && byNum('B12').kitchen === 'not sent' && byNum('A7').kitchen === 'making' && byNum('A7').waitingOn.join() === 'Mocha');
  check('each with its guest’s first name, how it looks, its stage and its spot', byNum('B38').name === 'Lee' && byNum('B38').looks === 'Red SUV' && byNum('B41').name === 'sam' && byNum('B37').stage === 'forward' && byNum('B37').spot === 2 && byNum('B37').name === null);
  check('the kitchen: still making two shakes (a canceled ticket isn’t counted); not sent yet; ready', byNum('B38').kitchen === 'making' && byNum('B38').waitingOn.join() === '2 Shake' && byNum('B41').kitchen === 'not sent' && byNum('B37').kitchen === 'ready');
  check('the business’s own target, its spots, one lane', v.target === 210 && v.spots === 3 && v.lanes === 1 && v.timeZone === 'America/New_York');
  check('waiting to order from the entry sensor: three counted, less the two cars that reached the speaker since', v.sensor === true && v.waiting[1] === 1, v.waiting);
  check('underneath: the counter’s line, the order placed ahead (due in ten minutes), the curbside guest outside',
    v.side.counter?.waiting === 1 && v.side.ahead?.open === 1 && v.side.ahead.here === 0 && !!v.side.ahead.nextAt && v.side.curbside?.here === 1 && v.side.curbside.longestSince === rago(130), v.side);
  const elm = await S.liveNow(db, 't1', tenant, 'elm');
  check('at one location: its own cars (and those from before there were locations)', elm.cars.some((c) => c.number === 'B12') && elm.location?.id === 'elm');
  await cset('c8', { number: 'B42', stage: 'speaker', arrivedAt: new Date().toISOString(), orderId: 'o8' });
  const again = await S.liveNow(db, 't1', tenant, null);
  check('read once every few seconds for every screen watching', again.cars.length === v.cars.length);
  S.forgetLive('t1');
  check('…and afresh once forgotten', (await S.liveNow(db, 't1', tenant, null)).cars.some((c) => c.number === 'B42'));

  console.log('the page asks');
  const { POST } = await import('../../src/app/api/drive-live/route');
  let r: any = await POST(req({ tenantId: 't1', action: 'now' }));
  check('anyone on the team, signed in, can watch the lane', r.status === 200 && r.body.ok && lastLevel === 'staff' && Array.isArray(r.body.live.cars) && Array.isArray(r.body.places), r.body);
  check('…with the clock as it answers (the cars are read every few seconds, the clock never stands still)', Math.abs(Date.parse(r.body.live.now) - Date.now()) < 1000);
  check('a car moved at the lane or a window: Drive-thru live reads it afresh', /const forgetStats = [^\n]*forgetLive\(tenantId\)/.test(src('src/app/api/counter/route.ts')));
  actor = { ...actor, isRenter: true }; r = await POST(req({ tenantId: 't1', action: 'now' }));
  check('not a renter (they run their own business here)', r.status === 403);
  actor = { ...actor, isRenter: false }; denied = true; r = await POST(req({ tenantId: 't1', action: 'now' }));
  check('not anyone signed out', r.status === 401); denied = false;
  r = await POST(req({ tenantId: 't1', action: 'move' }));
  check('nothing here moves a car', r.status === 400);

  console.log('the page');
  const pg = src('src/app/(app)/drive-live/page.tsx');
  check('the lane from above, read every few seconds while on screen, times counting on the server’s clock', /POLL_MS = 3000/.test(pg) && /visibilityState === 'visible'/.test(pg) && /setSkew/.test(pg) && /placeLane\(/.test(pg) && /lengthFor\(/.test(pg));
  check('cars slide along (and in from the entry, and off past the exit: the same chip), but not for someone who asked for less motion', /transform 900ms/.test(pg) && /prefers-reduced-motion/.test(pg) && /settled/.test(pg) && /const leaving = reduce \? \[\] : Array\.from\(last\.current/.test(pg) && /driving\.map/.test(pg) && /clearTimeout/.test(pg));
  check('each car a button that says who, where, how long and how that stands; its sheet says where the time went and what the kitchen’s making', /aria-label=\{`\$\{c\.number\}/.test(pg) && /TONE_WORDS\[tone\]/.test(pg) && /Where the time went/.test(pg) && /stuckWords/.test(pg) && /role="dialog"/.test(pg) && /Escape/.test(pg));
  check('over the target is solid amber, never red (red is for destructive buttons); colors hold in black', !/b42318|#ff8a80|bad-ink/.test(pg) && /var\(--warn-ink\)/.test(pg) && /var\(--warn-soft\)/.test(pg) && /dark:bg-\[#3a3b40\]/.test(pg));
  check('on the menu under the counter, with the drive-thru’s tools, in the app’s white or black', /href: '\/drive-live',\s+icon: CarFront,\s+label: 'Drive-thru live'/.test(src('src/components/shared/AppSidebar.tsx')) && /hospitality: \{[^}]*'\/drive-live'/.test(src('src/lib/modules.ts')) && /'drive-live'/.test(src('src/lib/app-theme.ts')));

  console.log('house style');
  for (const f of ['src/lib/drive-live.ts', 'src/lib/drive-live-server.ts', 'src/app/api/drive-live/route.ts', 'src/app/(app)/drive-live/page.tsx']) {
    const s = src(f);
    check(`${f}: no shouting or heavy type, no " · ", no comments in markup, no "call us"`, !/\buppercase\b|font-black| · |\{\/\*|call us|contact us/i.test(s));
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
