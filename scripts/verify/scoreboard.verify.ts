// Checks the drive-thru scoreboard (design board "The hour at a glance, on the live view", layout A; lib/scoreboard,
// lib/scoreboard-server, api/drive-live 'now' and 'goals', Drive-thru live).
// - Cars this hour, last hour, the best hour lately, the pace, the goal; menu, pay, service and lane total this hour
//   against their goals; drive-offs today; this location's ranking; the daypart.
// - Goals: a manager sets menu, pay and service times and cars an hour; lane total is the drive-thru target.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/scoreboard.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor, tenant: {} }) };
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const B = await import('../../src/lib/scoreboard');
  console.log('goals');
  const g = B.goalsOf({}, 210);
  check('until a manager sets them: menu 0:30, pay 1:00, service 0:30, lane total the drive-thru target, no goal for cars an hour', g.menu === 30 && g.pay === 60 && g.service === 30 && g.total === 210 && g.perHour === null);
  check('…as set, only from the choices offered', B.goalsOf({ driveThru: { goals: { menu: 45, pay: 999, perHour: 40 } } }, 180).menu === 45 && B.goalsOf({ driveThru: { goals: { menu: 45, pay: 999, perHour: 40 } } }, 180).pay === 60 && B.goalsOf({ driveThru: { goals: { perHour: 40 } } }, 180).perHour === 40);
  check('a change: kept when it’s a choice, refused otherwise, cars an hour can be none', JSON.stringify(B.cleanGoals({ menu: 20, perHour: null })) === JSON.stringify({ menu: 20, perHour: null }) && 'error' in B.cleanGoals({ pay: 17 }) && 'error' in B.cleanGoals({ perHour: 9999 }));

  console.log('a car as the scoreboard counts it');
  const base = Date.parse('2026-11-22T13:00:00.000Z'); const t = (s: number) => new Date(base + s * 1000).toISOString();
  const c = (o: any) => ({ arrivedAt: t(0), goneAt: t(200), stageAt: { speaker: t(0), pay: t(40), pickup: t(110) }, ...o });
  check('menu: pulling up to the order sent; pay: to paid; service: to handed over; lane total: the whole', JSON.stringify(B.boardCar(c({}))) === JSON.stringify({ total: 200, menu: 40, pay: 70, service: 90 }));
  check('…a car left open over an hour, then handed over: forgotten, not slow (never in the averages or the ranking)', B.boardCar(c({ goneAt: t(3700) })) === null && B.boardCar(c({ goneAt: t(3500) }))!.total === 3500);
  check('…taken in line: no menu or pay time; one that left: not counted', B.boardCar(c({ inLine: true }))!.menu === null && B.boardCar(c({ inLine: true }))!.pay === null && B.boardCar(c({ left: true })) === null && B.boardCar(c({ voided: true })) === null);

  console.log('the hour');
  const hourStart = base + 3600000; const nowMs = hourStart + 30 * 60000;
  const at = (min: number, o: any = {}) => ({ arrivedAt: new Date(hourStart + (min - 3) * 60000).toISOString(), goneAt: new Date(hourStart + min * 60000).toISOString(), stageAt: { speaker: new Date(hourStart + (min - 3) * 60000).toISOString(), pay: new Date(hourStart + (min - 2.5) * 60000).toISOString(), pickup: new Date(hourStart + (min - 1) * 60000).toISOString() }, ...o });
  const gone = [at(2), at(10), at(20), at(-20), at(-40), at(-70), at(15, { left: true }), at(5, { voided: true }), at(12, { locationId: 'elm' }), at(14, { locationId: 'elm' }), at(16, { locationId: 'elm' }), at(-10, { locationId: 'main' }), at(1, { locationId: 'main' }), at(3, { locationId: 'main' })];
  let b = B.boardOf({ gone, here: null, hourStart, nowMs, best: 9, goals: g, daypart: 'Lunch', several: false });
  check('cars handed over this hour (never those that left), last hour, the best, the pace halfway through', b.hour.n === 8 && b.hour.prev === 3 && b.hour.best === 9 && b.hour.pace === 16, b.hour);
  check('this hour’s averages: lane total 3:00, menu 0:30, pay 1:30, service 1:00', b.avg.total === 180 && b.avg.menu === 30 && b.avg.pay === 90 && b.avg.service === 60, b.avg);
  check('drive-offs: those that left or were voided', b.driveOffs === 2 && b.daypart === 'Lunch' && b.rank === null);
  b = B.boardOf({ gone, here: null, hourStart, nowMs: hourStart + 5 * 60000, best: null, goals: g, daypart: null, several: false });
  check('…too early in the hour for a pace; no best yet', b.hour.pace === null && b.hour.best === null);
  b = B.boardOf({ gone: [at(2), at(5), at(8)], here: null, hourStart, nowMs: hourStart + 11 * 60000, best: null, goals: g, daypart: null, several: false });
  const two = B.boardOf({ gone: [at(2), at(5)], here: null, hourStart, nowMs: hourStart + 11 * 60000, best: null, goals: g, daypart: null, several: false });
  check('…a pace from a quarter of the hour, or ten minutes with three cars served', b.hour.pace === 16 && two.hour.pace === null);
  b = B.boardOf({ gone: gone.map((x, i) => (x.locationId === 'elm' ? { ...x, goneAt: x.goneAt, arrivedAt: new Date(Date.parse(x.goneAt) - 400000).toISOString() } : x)), here: 'main', hourStart, nowMs, best: 2, goals: g, daypart: null, several: true });
  check('with locations: this one’s cars (and those from before there were locations), and its place today by lane total', b.hour.n === 5 && b.rank?.place === 1 && b.rank.of === 2 && b.hour.best === 5, [b.hour, b.rank]);
  check('first, second, third', B.nth(1) === '1st' && B.nth(2) === '2nd' && B.nth(3) === '3rd' && B.nth(4) === '4th' && B.nth(11) === '11th' && B.nth(22) === '22nd');

  console.log('read on the server');
  const S = await import('../../src/lib/scoreboard-server');
  await db.doc(T).set({ name: 'Linden', timezone: 'UTC', kitchenSettings: { targets: { 'drive-thru': 210 } }, menuTimes: {} });
  const real = Date.now();
  const put = (id: string, ago: number, o: any = {}) => db.doc(`${T}/driveThruCars/${id}`).set({ id, channel: 'drive-thru', stage: 'gone', arrivedAt: new Date(real - (ago + 180) * 1000).toISOString(), goneAt: new Date(real - ago * 1000).toISOString(), ...o });
  await put('a', 30); await put('b', 60); await put('c', 90, { left: true }); await put('d', 120, { channel: 'counter' });
  const board = await S.boardNow(db, 't1', await get(T), null, 'UTC');
  check('the hour so far, from today’s cars (the drive-thru’s only), drive-offs today', board.hour.n >= 0 && board.driveOffs === 1 && board.goals.total === 210, board);
  await put('e', 10);
  check('read once every 20 seconds for every screen watching', (await S.boardNow(db, 't1', await get(T), null, 'UTC')).hour.n === board.hour.n);
  S.forgetBoard('t1');
  const fresh = await S.boardNow(db, 't1', await get(T), null, 'UTC');
  check('…and afresh once a car moves', fresh.hour.n + fresh.hour.prev === board.hour.n + board.hour.prev + 1, [fresh.hour, board.hour]);
  await new Promise((res) => setTimeout(res, 300));
  S.forgetBoard('t1');
  check('the best hour, worked out in the background (by the hour cars were handed over)', typeof (await S.boardNow(db, 't1', await get(T), null, 'UTC')).hour.best === 'number');
  check('a car moved at the lane or a window: the scoreboard reads it afresh', /forgetLive\(tenantId\); forgetBoard\(tenantId\); \};/.test(src('src/app/api/counter/route.ts')));

  console.log('the page asks');
  const { POST } = await import('../../src/app/api/drive-live/route');
  let r: any = await POST(req({ tenantId: 't1', action: 'now' }));
  check('the lane comes with the scoreboard', r.status === 200 && !!r.body.board && typeof r.body.board.hour.n === 'number' && r.body.board.goals.menu === 30, r.body.board);
  r = await POST(req({ tenantId: 't1', action: 'goals', menu: 45, perHour: 40 }));
  check('a manager sets the goals', r.status === 200 && r.body.goals.menu === 45 && r.body.goals.perHour === 40 && (await get(T)).driveThru.goals.menu === 45);
  r = await POST(req({ tenantId: 't1', action: 'goals', pay: 7 }));
  check('…only to the choices offered', r.status === 400);
  r = await POST(req({ tenantId: 't1', action: 'speed', ch: 'drive', range: 'today' }));
  check('the speed of service tab has them too', r.body.goals?.menu === 45);
  actor = { uid: 's1', name: 'Kai', role: 'staff', caps: [] };
  r = await POST(req({ tenantId: 't1', action: 'goals', menu: 20 }));
  check('…nobody else changes them', r.status === 403 && (await get(T)).driveThru.goals.menu === 45);

  console.log('the page');
  const pg = src('src/app/(app)/drive-live/page.tsx');
  check('the scoreboard over the lane: daypart and clock, the ranking, cars this hour with prev, best, pace and goal, each part against its goal, drive-offs',
    /function Scoreboard/.test(pg) && /board\.daypart/.test(pg) && /locations today/.test(pg) && /Prev <b/.test(pg) && /Best <b/.test(pg) && /Pace <b/.test(pg) && /Goal <b/.test(pg) && /part\('menu', board\.avg\.menu, g\.menu\)/.test(pg) && /drive-offs today/.test(pg));
  check('the lane right now in a row of small numbers under it', /function NowChip/.test(pg) && /<Scoreboard board=\{board\}/.test(pg));
  check('the goals on the speed of service tab, set by a manager', /function GoalsCard/.test(pg) && /GOAL_CHOICES\[k\]\.map/.test(pg) && /No goal/.test(pg) && /disabled=\{!canChange \|\| busy\}/.test(pg));
  for (const f of ['src/lib/scoreboard.ts', 'src/lib/scoreboard-server.ts', 'src/app/(app)/drive-live/page.tsx']) {
    const s = src(f);
    check(`${f}: no shouting or heavy type, no " · ", no comments in markup, no red`, !/\buppercase\b|font-black| · |\{\/\*|b42318/.test(s));
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
