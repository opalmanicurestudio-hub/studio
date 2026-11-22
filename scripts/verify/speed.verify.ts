// Checks speed of service and the long wait alert (design board "Speed of service, and what slows it"; lib/speed,
// lib/speed-server, api/drive-live 'speed' and 'alert', api/counter's lane, lib/drive-live-server, the Drive-thru live
// page's second tab, lib/tell-managers, lib/push, lib/notify-prefs, the team app's pages).
// - Every guest handed over is one record: the drive-thru and the counter from their place in line, curbside and pickups
//   ordered ahead from when they said they're here. A day is kept small once it's well over.
// - The report: average against the target, how many under it, how many, the longest; where the drive-thru's time goes;
//   each weekday by hour, the busiest and the slowest; everyone who waited too long.
// - A car past the business's limit (4 or 5 minutes, or off) buzzes the shift lead's phone once.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/speed.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let pushed = 0;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor, tenant: {} }) };
  if (request === '@/lib/push' || /\/src\/lib\/push(\.ts)?$/.test(request)) return fake(request, { pushNow: async () => { pushed++; } });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const S = await import('../../src/lib/speed');
  const hourOf = (ms: number) => new Date(ms).getUTCHours();
  const base = Date.parse('2026-11-21T12:00:00.000Z');
  const t = (s: number) => new Date(base + s * 1000).toISOString();

  console.log('one record for each guest served');
  const car = (o: any) => ({ id: 'c', number: 'B1', stage: 'gone', channel: 'drive-thru', arrivedAt: t(0), goneAt: t(200), orderId: 'o1', stageAt: { speaker: t(0), pay: t(60), pickup: t(120) }, ...o });
  let r = S.carRec(car({}), hourOf)!;
  check('the drive-thru: from pulling up to handed over, with where the time went', r.ch === 'drive' && r.sec === 200 && r.hour === 12 && r.parts.ordering === 60 && r.parts.toWindow === 60 && r.parts.atWindow === 80 && r.parts.greet === -1, r);
  r = S.carRec(car({ greetedAt: t(15), stageAt: { speaker: t(0), pay: t(60), pickup: t(120), window: t(150) } }), hourOf)!;
  check('…with the speaker’s and the window’s sensors: greeted, then ordering, getting to the window, at the window', r.parts.greet === 15 && r.parts.ordering === 45 && r.parts.toWindow === 90 && r.parts.atWindow === 50, r.parts);
  check('…a car taken in line: its whole wait, no parts', Object.values(S.carRec(car({ inLine: true }), hourOf)!.parts).every((x) => x === -1));
  check('…not one that left, or was voided, or isn’t handed over yet', !S.carRec(car({ left: true }), hourOf) && !S.carRec(car({ voided: true }), hourOf) && !S.carRec(car({ stage: 'pickup' }), hourOf) && !S.carRec(car({ goneAt: t(-5) }), hourOf));
  check('the counter (and the kiosk) from the same place in line, no parts', S.carRec(car({ channel: 'counter' }), hourOf)!.ch === 'counter' && S.carRec(car({ channel: 'kiosk' }), hourOf)!.ch === 'counter' && S.carRec(car({ channel: 'counter' }), hourOf)!.parts.ordering === -1);
  const ord = (o: any) => ({ id: 'a1', channel: 'ahead', status: 'done', number: 'A4', guestName: 'Kim', doneAt: t(150), ahead: { way: 'inside', hereAt: t(60) }, ...o });
  check('a pickup ordered ahead: from saying they’re here to handed over', S.aheadRec(ord({}), hourOf)?.ch === 'ahead' && S.aheadRec(ord({}), hourOf)?.sec === 90 && S.aheadRec(ord({ ahead: { way: 'drive-thru', hereAt: t(100) } }), hourOf)?.sec === 50);
  check('…café curbside, to when it was handed out at the curb', S.aheadRec(ord({ ahead: { way: 'curbside', hereAt: t(0), curb: { handedAt: t(240) } } }), hourOf)?.ch === 'curb' && S.aheadRec(ord({ ahead: { way: 'curbside', hereAt: t(0), curb: { handedAt: t(240) } } }), hourOf)?.sec === 240);
  check('…not a delivery, one never said to be here, or one not done', !S.aheadRec(ord({ ahead: { way: 'delivery', hereAt: t(0) } }), hourOf) && !S.aheadRec(ord({ ahead: { way: 'inside' } }), hourOf) && !S.aheadRec(ord({ status: 'ready' }), hourOf));
  check('the shop’s curbside: from saying they’re here to completed', S.shopCurbRec({ method: 'curbside', stage: 'completed', curbside: { arrivedAt: t(0) }, completedAt: t(130), orderNumber: 1042, customerName: 'Lee Ann Ray' }, hourOf)?.sec === 130
    && S.shopCurbRec({ method: 'curbside', stage: 'completed', curbside: { arrivedAt: t(0) }, completedAt: t(130), orderNumber: 1042, customerName: 'Lee Ann Ray' }, hourOf)?.name === 'Lee' && !S.shopCurbRec({ method: 'pickup', stage: 'completed', completedAt: t(1) }, hourOf));

  console.log('the report');
  const rec = (sec: number, hour: number, parts: number[] = [-1, 40, 60, sec - 100], name = 'Lee') => ({ ch: 'drive' as const, sec, hour, startMs: base, parts: { greet: parts[0], ordering: parts[1], toWindow: parts[2], atWindow: parts[3] }, number: `B${sec}`, orderId: null, name });
  const d1 = S.dayOf('2026-11-21', 6, [rec(180, 12), rec(200, 12), rec(300, 12), rec(150, 8), rec(400, 8)], (ms) => new Date(ms).toISOString());
  const d2 = S.dayOf('2026-11-20', 5, [rec(190, 12), rec(170, 9), rec(500, 9, [-1, 60, 300, 140])], (ms) => new Date(ms).toISOString());
  check('a day kept small: seven numbers a guest, the longest waits with their names', d1.ch.drive.r.length === 35 && d1.ch.drive.long[0].sec === 400 && d1.ch.drive.long[0].name === 'Lee' && d1.ch.counter.r.length === 0);
  const rp = S.speedReport([d1, d2], 'drive', '7', 210);
  check('average, how many under the target, how many, the longest', rp.n === 8 && rp.average === Math.round((180 + 200 + 300 + 150 + 400 + 190 + 170 + 500) / 8) && rp.under === 5 / 8 && rp.longest?.sec === 500, rp);
  check('where the time goes: each part’s average, for the guests that had it', rp.parts?.ordering === Math.round((40 * 7 + 60) / 8) && rp.parts?.greet === null && rp.parts?.toWindow === Math.round((60 * 7 + 300) / 8));
  check('each weekday by hour', rp.heat['6-12'].n === 3 && rp.heat['5-9'].n === 2 && rp.heat['5-9'].avg === 335 && rp.days[6] === 1 && rp.days[5] === 1);
  check('busiest: Saturday at 12, three cars', rp.busiest?.wd === 6 && rp.busiest.hour === 12 && rp.busiest.perDay === 3 && S.whenWords(6, 12, rp.days) === 'Saturday, 12 to 1 pm');
  check('slowest (a few guests at least): Saturday at 12, and the slowest part then', rp.slowest?.wd === 6 && rp.slowest.hour === 12 && rp.slowest.avg === 227 && rp.slowest.part === 'atWindow', rp.slowest);
  check('waited too long: past the target, longest first', rp.long.map((w) => w.sec).join() === '500,400,300' && S.longWords(rp.long[0]) === 'Most of it from the order to the window: 5:00');
  check('…the same days for another kind of guest: nobody', S.speedReport([d1, d2], 'counter', '7', 300).n === 0 && S.speedReport([d1, d2], 'counter', '7', 300).average === null && S.speedReport([d1, d2], 'counter', '7', 300).parts === null);
  const today = S.speedReport([d1], 'drive', 'today', 210);
  check('today: the busiest hour, no weekday', today.busiest?.wd === null && S.whenWords(null, 12, today.days) === '12 to 1 pm' && S.hourWords(11) === '11 am to 12 pm' && S.hourWords(8) === '8 to 9 am');
  check('weekdays seen more than once read as plural', S.whenWords(6, 12, { 6: 4 }) === 'Saturdays, 12 to 1 pm');
  check('the long wait alert: 5 minutes until the business chooses; 4, or off', S.longWaitOf({}) === 300 && S.longWaitOf({ driveThru: { longWaitSec: 240 } }) === 240 && S.longWaitOf({ driveThru: { longWaitSec: 0 } }) === 0 && S.longWaitOf({ driveThru: { longWaitSec: 999 } }) === 300);

  console.log('read on the server');
  const SS = await import('../../src/lib/speed-server');
  await db.doc(T).set({ name: 'Linden', timezone: 'UTC', kitchenSettings: { targets: { 'drive-thru': 210 } } });
  const realNow = Date.now(); const day0 = new Date(realNow).toISOString().slice(0, 10); const y = new Date(realNow - 86400000).toISOString().slice(0, 10);
  const at = (day: string, hh: number, s = 0) => new Date(Date.parse(`${day}T${String(hh).padStart(2, '0')}:00:00.000Z`) + s * 1000).toISOString();
  const put = (id: string, d: any) => db.doc(`${T}/driveThruCars/${id}`).set({ id, channel: 'drive-thru', stage: 'gone', ...d });
  await put('y1', { number: 'B10', arrivedAt: at(y, 12), goneAt: at(y, 12, 180), orderId: 'oy1', stageAt: { speaker: at(y, 12), pay: at(y, 12, 50), pickup: at(y, 12, 100) } });
  await put('y2', { number: 'B11', arrivedAt: at(y, 12, 30), goneAt: at(y, 12, 530), orderId: 'oy2', stageAt: { speaker: at(y, 12, 30), pay: at(y, 12, 90), pickup: at(y, 12, 150) } });
  await put('y3', { number: 'B12', arrivedAt: at(y, 13), goneAt: at(y, 13, 60), left: true });
  await put('y4', { number: 'C3', channel: 'counter', arrivedAt: at(y, 9), goneAt: at(y, 9, 140) });
  await put('y5', { number: 'B13', arrivedAt: at(y, 12, 40), goneAt: at(y, 12, 200), locationId: 'elm' });
  await db.doc(`${T}/counterOrders/oy2`).set({ guestName: 'Lee Ann', channel: 'drive-thru' });
  await db.doc(`${T}/counterOrders/ay1`).set({ channel: 'ahead', day: y, status: 'done', number: 'A2', doneAt: at(y, 10, 100), ahead: { way: 'inside', hereAt: at(y, 10) } });
  await put('y7', { number: 'B15', arrivedAt: new Date(Date.parse(at(y, 0)) - 120000).toISOString(), goneAt: at(y, 0, 200) });
  const sd = await SS.speedDay(db, 't1', await get(T), null, y, 'UTC');
  check('a day: the drive-thru’s and the counter’s cars handed over, and the pickups ordered ahead; never a car that left',
    sd.ch.drive.r.length / 7 === 4 && sd.ch.counter.r.length / 7 === 1 && sd.ch.ahead.r.length / 7 === 1 && sd.ch.drive.long[0].number === 'B11' && sd.ch.drive.long[0].orderId === 'oy2', sd.ch.drive.long);
  const rows = (c: any) => Array.from({ length: c.r.length / 7 }, (_, i) => c.r.slice(i * 7, i * 7 + 7));
  check('…a car that got here before midnight and was served after: in that day, in no hour (never the day before’s late hour)', rows(sd.ch.drive).some((x: number[]) => x[0] === 320 && x[1] === -1), rows(sd.ch.drive));
  const keptDoc: any = await get(`${T}/private/speed_all_${y}`);
  check('…kept once the day is well over (so a month is thirty small reads), without guests’ names', !!keptDoc && keptDoc.v === S.SPEED_DAY_VERSION && keptDoc.ch.drive.long.every((w: any) => w.name === null) && !JSON.stringify(keptDoc).includes('Lee'));
  const elm = await SS.speedDay(db, 't1', await get(T), 'elm', y, 'UTC');
  check('…at one location: its own cars, and those from before there were locations', elm.ch.drive.r.length / 7 === 4 && !!(await get(`${T}/private/speed_elm_${y}`)));
  await put('t1c', { number: 'B20', arrivedAt: new Date(realNow - 400000).toISOString(), goneAt: new Date(realNow - 100000).toISOString() });
  const sdt = await SS.speedDay(db, 't1', await get(T), null, day0, 'UTC');
  check('today: read as it happens, never kept', sdt.ch.drive.r.length >= 6 && !(await get(`${T}/private/speed_all_${day0}`)));
  await put('y6', { number: 'B14', arrivedAt: at(y, 14), goneAt: at(y, 14, 100) });
  const again = await SS.speedDay(db, 't1', await get(T), null, y, 'UTC');
  check('…a kept day is read back as kept', again.ch.drive.r.length / 7 === 4);
  const rep7 = await SS.speedFor(db, 't1', await get(T), null, 'drive', '7', 'UTC');
  check('the report over seven days: yesterday’s and today’s, the business’s own target; the names of those who waited longest looked up as shown',
    rep7.target === 210 && rep7.n === 5 && rep7.long.find((w) => w.number === 'B11')?.name === 'Lee', rep7.long);

  console.log('the long wait alert');
  await db.doc(`${T}/staff/sl1`).set({ name: 'Mo', role: 'staff', job: 'shift_lead', isActive: true });
  await db.doc(`${T}/staff/cook`).set({ name: 'Kai', role: 'staff', job: 'cook', isActive: true });
  await db.doc(`${T}/staff/own`).set({ name: 'Rae', role: 'owner', isActive: true });
  const live = (id: string, sec: number, o: any = {}) => ({ id, number: id.toUpperCase(), channel: 'drive-thru', stage: 'pickup', arrivedAt: new Date(realNow - sec * 1000).toISOString(), ...o });
  for (const c of [live('l1', 320), live('l2', 100), live('l3', 400, { stage: 'forward', spot: 2 })]) await db.doc(`${T}/driveThruCars/${c.id}`).set(c);
  const notes = async () => (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data()).filter((n: any) => n.type === 'drive_wait');
  let told = await SS.checkLongWaits(db, 't1', await get(T), [live('l1', 320), live('l2', 100), live('l3', 400, { stage: 'forward', spot: 2 })], realNow, new Map([['l1', ['2 Shake']]]));
  let n = await notes();
  check('a car past five minutes: the shift lead’s phone buzzes, with where it is and what the kitchen’s making; a car under it, nothing',
    told === 2 && n.length === 2 && n.every((x: any) => x.userId === 'sl1' && x.link === '/drive-live' && x.priority === 'high') && pushed >= 1
    && n.some((x: any) => /^L1 has waited 5:2\d at the drive-thru, at the pickup window, waiting on 2 Shake\.$/.test(x.message)) && n.some((x: any) => /parked in spot 2/.test(x.message)), n.map((x: any) => x.message));
  told = await SS.checkLongWaits(db, 't1', await get(T), [{ ...live('l1', 330), waitTold: 'x' }, live('l1', 330)], realNow + 10000);
  check('…once for each car, however many screens are watching', told === 0 && (await notes()).length === 2);
  await db.doc(T).set({ driveThru: { longWaitSec: 0 } }, { merge: true });
  told = await SS.checkLongWaits(db, 't1', await get(T), [live('l9', 900)], realNow);
  check('turned off: nobody is buzzed', told === 0);
  await db.doc(T).set({ driveThru: { longWaitSec: 240 } }, { merge: true });
  await db.doc(`${T}/driveThruCars/l4`).set(live('l4', 250));
  told = await SS.checkLongWaits(db, 't1', await get(T), [live('l4', 250)], realNow);
  check('set to four minutes: four is enough', told === 1);
  for (const id of ['m1', 'm2', 'm3']) await db.doc(`${T}/driveThruCars/${id}`).set(live(id, 300));
  const before = (await notes()).length;
  told = await SS.checkLongWaits(db, 't1', await get(T), ['m1', 'm2', 'm3'].map((id) => live(id, 300)), realNow);
  n = await notes();
  check('three at once: one notice for them all', told === 3 && n.length === before + 1 && /^3 cars have waited over 4:00 at the drive-thru: M1 5:00, M2 5:00, M3 5:00\.$/.test(n[n.length - 1].message), n[n.length - 1]?.message);
  await db.doc(`${T}/staff/sl2`).set({ name: 'Bo', role: 'staff', job: 'shift_lead', isActive: true, locationIds: ['elm'] });
  await db.doc(`${T}/staff/sl1`).set({ locationIds: ['main'] }, { merge: true });
  await db.doc(`${T}/driveThruCars/e1`).set(live('e1', 300, { locationId: 'elm' }));
  told = await SS.checkLongWaits(db, 't1', await get(T), [live('e1', 300, { locationId: 'elm' })], realNow + 6 * 60000);
  n = await notes();
  check('with more than one location: that location’s shift lead', told === 1 && n[n.length - 1].userId === 'sl2', n[n.length - 1]);
  const PT = await import('../../src/lib/push-tier'); const NP = await import('../../src/lib/notify-prefs'); const PU = src('src/lib/push.ts');
  check('it buzzes at once, under Floor and stations, and opens Drive-thru live even from the team app', PT.PUSH_TIER.drive_wait === 'now' && NP.groupOf('drive_wait') === 'floor'
    && /FLOOR_LINKS = \[[^\]]*'\/drive-live'\]/.test(PU) && /case 'drive_wait': return 'A car is waiting too long';/.test(PU) && /FLOOR_PAGES = \[[^\]]*'\/drive-live'\]/.test(src('src/components/shared/PortalScope.tsx')));
  check('checked whenever the lane is read: the lane screen and Drive-thru live', /if \(channel === 'drive-thru'\) await checkLongWaits\(db, tenantId, tenant, live,/.test(src('src/app/api/counter/route.ts')) && /await checkLongWaits\(db, tenantId, tenant, drive, nowMs,/.test(src('src/lib/drive-live-server.ts')));

  console.log('the page asks');
  const { POST } = await import('../../src/app/api/drive-live/route');
  let res: any = await POST(req({ tenantId: 't1', action: 'speed', ch: 'drive', range: '7' }));
  check('the report, the alert and the sensors', res.status === 200 && res.body.report?.n === 5 && !Object.keys(res.body.report.heat).some((k) => k.endsWith('-0')) && res.body.alert.sec === 240 && res.body.alert.canChange === true && Array.isArray(res.body.sensors) && res.body.sensors[0].point === 'entry', res.body);
  res = await POST(req({ tenantId: 't1', action: 'alert', sec: 300 }));
  check('a manager sets the alert', res.status === 200 && (await get(T)).driveThru.longWaitSec === 300);
  res = await POST(req({ tenantId: 't1', action: 'alert', sec: 120 }));
  check('…only to one of the choices', res.status === 400);
  actor = { uid: 's1', name: 'Kai', role: 'staff', caps: [] };
  res = await POST(req({ tenantId: 't1', action: 'alert', sec: 0 }));
  const seen: any = await POST(req({ tenantId: 't1', action: 'speed', ch: 'counter', range: 'today' }));
  check('…not anyone else, who sees the report all the same', res.status === 403 && (await get(T)).driveThru.longWaitSec === 300 && seen.status === 200 && seen.body.alert.canChange === false);

  console.log('the page');
  const pg = src('src/app/(app)/drive-live/page.tsx');
  check('two tabs: the lane now, and speed of service', /\['live', 'The lane now'\], \['speed', 'Speed of service'\]/.test(pg) && /role="tablist"/.test(pg) && /<SpeedTab tenantId=\{tenantId\} \/>/.test(pg));
  check('how fast: which guests, which days, four numbers, where the time goes', /SPEED_CHS\.map/.test(pg) && /SPEED_RANGES\.map/.test(pg) && /under the target/.test(pg) && /longest wait/.test(pg) && /function TimeGoes/.test(pg) && /gap-\[2px\]/.test(pg));
  check('when it’s busiest: a table a screen reader reads, darker for more, with the busiest and slowest said in words', /<table/.test(pg) && /scope="row"/.test(pg) && /sr-only/.test(pg) && /Fewer \{noun\[1\]\}/.test(pg) && /Slowest part then/.test(pg));
  check('waited too long, and the alert: 4:00, 5:00, off; only a manager changes it', /Waited too long/.test(pg) && /LONG_WAITS\.map/.test(pg) && /disabled=\{!data\.alert\.canChange/.test(pg) && /The shift lead’s phone buzzes once for that car/.test(pg));
  check('colors hold in black; no red', /html\.dark \.cf-speed/.test(pg) && !/b42318|bad-ink/.test(pg));
  for (const f of ['src/lib/speed.ts', 'src/lib/speed-server.ts', 'src/app/(app)/drive-live/page.tsx']) {
    const s = src(f);
    check(`${f}: no shouting or heavy type, no " · ", no comments in markup`, !/\buppercase\b|font-black| · |\{\/\*/.test(s));
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
