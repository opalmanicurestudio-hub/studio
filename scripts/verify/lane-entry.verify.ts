// Checks the line before the speaker and orders as they're said (design board "Rush and the lane entry"; lib/lane-entry,
// lib/lane-entry-server, api/counter/lane-entry, api/counter, api/kitchen, api/menu, the lane screen, the kitchen screen).
// - A sensor at the lane entry calls a link (shown once on the Menu page, only its fingerprint kept; a new one stops the
//   old) each time a car passes; the same car seen twice in a moment is one.
// - Waiting to order: cars counted that haven't started ordering, each car that starts taking off the earliest; a count
//   drops off after 20 minutes; Line's clear sets it to none. It counts toward a rush.
// - Orders as they're said: in a rush (or always, or never), the kitchen screen shows what's being said at the speaker,
//   with its station, before it's sent; nothing from stock, no ticket.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/lane-entry.verify.ts
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
const getReq = (url: string, ip = '10.0.0.1') => ({ json: async () => ({}), nextUrl: new URL(url), headers: { get: (k: string) => (String(k).toLowerCase() === 'x-forwarded-for' ? ip : null) } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const E = await import('../../src/lib/lane-entry');
  const NOW = Date.now(); const at = (s: number) => new Date(NOW + s * 1000).toISOString();

  console.log('Counting at the entry (lib/lane-entry)');
  let r1 = E.addEntry(null, NOW - 60000); const r2 = E.addEntry(r1.log, NOW - 59000); const r3 = E.addEntry(r2.log, NOW - 50000);
  check('a car counted; the same car seen again within a moment, not again; the next car, counted', r1.counted && !r2.counted && r3.counted && r3.log.at.length === 2);
  const old = E.addEntry({ at: [at(-25 * 60), at(-30)] }, NOW);
  check('a count older than 20 minutes drops off', old.counted && old.log.at.length === 2 && old.log.at[0] === at(-30), old.log);
  const log = { at: [at(-300), at(-240), at(-180)] };
  check('waiting to order: each car that starts ordering takes off the one counted first before it',
    E.waitingByLane({ 1: log }, [], NOW)[1] === 3 && E.waitingByLane({ 1: log }, [{ at: at(-200), lane: 1 }], NOW)[1] === 2 && E.waitingByLane({ 1: log }, [{ at: at(-200), lane: 1 }, { at: at(-10), lane: 1 }, { at: at(-5), lane: 1 }], NOW)[1] === 0);
  check('…a car already in line before the first count (or one the sensor missed) takes off nothing', E.waitingByLane({ 1: log }, [{ at: at(-400), lane: 1 }], NOW)[1] === 3);
  check('…the line said to be clear, or counts older than 20 minutes, aren’t waiting', E.waitingByLane({ 1: { ...log, clearedAt: at(-200) } }, [], NOW)[1] === 1 && E.waitingByLane({ 1: { at: [at(-21 * 60)] } }, [], NOW)[1] === 0);
  const two = E.waitingByLane({ 1: { at: [at(-100)] }, 2: { at: [at(-120), at(-60)] } }, [{ at: at(-50), lane: 1 }, { at: at(-40), lane: null }], NOW);
  check('two lanes: each its own count; a car taken in line takes off the earliest in either', two[1] === 0 && two[2] === 1, two);
  check('a rush counts those waiting; orders as they’re said in a rush unless set otherwise',
    E.isRush(3, 3) && !E.isRush(3, 2) && E.earlyModeOf({}) === 'rush' && E.earlyModeOf({ driveThru: { kitchenEarly: 'off' } }) === 'off' && E.showEarly('rush', true) && !E.showEarly('rush', false) && E.showEarly('always', false) && !E.showEarly('off', true));
  check('what’s been said so far: the lines of an order still being taken (never one sent)',
    E.earlyLines({ status: 'building', lines: [{ itemId: 'burger', name: 'Burger', quantity: 2, choicesText: 'No onion', price: 6 }] })[0]?.quantity === 2 && !('price' in E.earlyLines({ status: 'building', lines: [{ itemId: 'b', name: 'B', price: 6 }] })[0])
    && E.earlyLines({ status: 'sent', sentAt: at(0), lines: [{ itemId: 'b', name: 'B' }] }).length === 0);

  console.log('The sensor’s link (Menu page)');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  const { GET: entryGet, POST: entryPost } = await import('../../src/app/api/counter/lane-entry/route');
  const S = await import('../../src/lib/lane-entry-server');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, driveThru: { askName: false }, kitchenSettings: { stations: ['Grill', 'Bar'] } });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Food', price: 6, totalStock: 50, makeSeconds: 120, station: 'Grill' });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Latte', category: 'Drinks', price: 4.5, totalStock: 50, makeSeconds: 60, station: 'Bar' });
  let r: any = await menuApi(req({ tenantId: 't1', action: 'list' }));
  check('the Menu page: no sensor yet, and orders as they’re said in a rush', r.body.lane?.kitchenEarly === 'rush' && r.body.lane?.sensors?.[0]?.on === false, r.body.lane);
  r = await menuApi(req({ tenantId: 't1', action: 'laneSettings', sensor: 'new', lane: 1 }));
  const link = String(r.body.sensorLink?.link || ''); const key = new URL(link).searchParams.get('k') || '';
  const kept = await get(`${T}/private/laneSensors`);
  check('a link for the sensor, shown once: only its fingerprint is kept', r.status === 200 && /\/api\/counter\/lane-entry\?t=t1&k=[a-f0-9]{48}$/.test(link) && r.body.lane.sensors[0].on === true && !JSON.stringify(kept).includes(key), link);
  manager = false;
  r = await menuApi(req({ tenantId: 't1', action: 'laneSettings', sensor: 'new', lane: 1 }));
  check('…only a manager makes one', r.status === 403, r.body);
  manager = true;

  r = await entryGet(getReq(`${link}`));
  const r2b: any = await entryGet(getReq(`${link}`));
  check('the sensor calls the link (a plain GET works): a car counted; the same car again at once, not again', r.status === 200 && r.body.counted === true && r2b.body.counted === false && (await get(`${T}/private/laneEntry_1`))?.at?.length === 1, [r.body, r2b.body]);
  const bad1: any = await entryGet(getReq(`https://app.test/api/counter/lane-entry?t=t1&k=${'0'.repeat(48)}`));
  const bad2: any = await entryGet(getReq(`https://app.test/api/counter/lane-entry?t=t2&k=${key}`));
  check('a link that isn’t one, or for another business, counts nothing and says only that it isn’t set up', bad1.status === 404 && bad2.status === 404 && bad1.body.error === bad2.body.error, [bad1.body, bad2.body]);
  r = await entryPost({ json: async () => ({ tenantId: 't1', key }), nextUrl: new URL('https://app.test/api/counter/lane-entry'), headers: { get: () => '10.0.0.2' } } as any);
  check('…and a POST works too', r.status === 200 && r.body.ok === true, r.body);

  console.log('Waiting to order, on the lane screen');
  await db.doc(`${T}/private/laneEntry_1`).set({ at: [at(-300), at(-240), at(-180), at(-120)] });
  const key2 = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const kkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Grill', kind: 'kitchen' }))).body.key;
  manager = false;
  const P = (x: any) => POST(req({ tenantId: 't1', key: key2, ...x }));
  let lane: any = (await P({ action: 'lane' })).body;
  check('the lane screen: 4 cars waiting to order, from the sensor', lane.stats.sensor === true && lane.stats.waiting === 4, lane.stats);
  const A: any = (await P({ action: 'car', carKey: 'entrycar-0001' })).body;
  lane = (await P({ action: 'lane' })).body;
  check('…a car at the speaker takes one off (it’s in the lane now)', lane.stats.waiting === 3 && lane.stats.inLineNow === 1, lane.stats);
  const G: any = (await P({ action: 'car', carKey: 'entrycar-0009' })).body;
  await db.doc(`${T}/driveThruCars/${G.carId}`).set({ stage: 'gone' }, { merge: true });
  lane = (await P({ action: 'lane' })).body;
  check('…and a car that’s been served and gone stays taken off (it was counted once at the entry)', lane.stats.waiting === 2 && lane.stats.inLineNow === 1, lane.stats);
  await db.doc(`${T}/driveThruCars/${G.carId}`).set({ arrivedAt: at(-30 * 60) }, { merge: true });
  await P({ action: 'add', orderId: A.orderId, itemId: 'burger', tapKey: 'entrytap-0001' });
  await P({ action: 'add', orderId: A.orderId, itemId: 'latte', tapKey: 'entrytap-0002' });

  console.log('Orders as they’re said, in the kitchen');
  await wait(2600);
  let k: any = await kitchen(req({ tenantId: 't1', key: kkey, action: 'tickets' }));
  check('not a rush yet (1 in the lane, 3 waiting): the kitchen sees nothing early', Array.isArray(k.body.early) && k.body.early.length === 0, k.body.early);
  await db.doc(`${T}/private/laneEntry_1`).set({ at: [at(-300), at(-240), at(-180), at(-120), at(-60), at(-30)] });
  await wait(2600);
  k = await kitchen(req({ tenantId: 't1', key: kkey, action: 'tickets' }));
  const e: any = k.body.early?.[0];
  check('a rush (1 in the lane, 5 waiting): the kitchen sees what’s being said, with each item’s station, and nothing sent',
    e && e.number === A.number && e.lines.length === 2 && e.lines.find((l: any) => l.name === 'Burger')?.madeAt === 'Grill' && e.lines.find((l: any) => l.name === 'Latte')?.madeAt === 'Bar'
    && k.body.tickets.every((t: any) => t.orderId !== A.orderId) && (await get(`${T}/inventory/burger`))?.totalStock === 50, k.body.early);
  r = await P({ action: 'lineClear' });
  lane = (await P({ action: 'lane' })).body;
  check('Line’s clear: nobody waiting to order', r.status === 200 && lane.stats.waiting === 0 && lane.stats.sensor === true, lane.stats);
  manager = true; await menuApi(req({ tenantId: 't1', action: 'laneSettings', kitchenEarly: 'always' })); manager = false;
  await wait(2600);
  k = await kitchen(req({ tenantId: 't1', key: kkey, action: 'tickets' }));
  check('set to Always: the kitchen sees it with no rush', k.body.early?.[0]?.orderId === A.orderId, k.body.early);
  manager = true; await menuApi(req({ tenantId: 't1', action: 'laneSettings', kitchenEarly: 'off' })); manager = false;
  k = await kitchen(req({ tenantId: 't1', key: kkey, action: 'tickets' }));
  check('set to Never: not at all', k.body.early?.length === 0, k.body.early);
  manager = true; await menuApi(req({ tenantId: 't1', action: 'laneSettings', kitchenEarly: 'always' })); manager = false;
  await P({ action: 'send', orderId: A.orderId });
  await wait(2600);
  k = await kitchen(req({ tenantId: 't1', key: kkey, action: 'tickets' }));
  check('sent: tickets, and nothing early any more', k.body.early?.length === 0 && k.body.tickets.some((t: any) => t.orderId === A.orderId), k.body.early);

  console.log('Turned off');
  manager = true;
  r = await menuApi(req({ tenantId: 't1', action: 'laneSettings', sensor: 'stop', lane: 1 }));
  const after: any = await entryGet(getReq(link));
  check('the link stops counting', r.status === 200 && r.body.lane.sensors[0].on === false && after.status === 404, [r.body, after.body]);
  r = await menuApi(req({ tenantId: 't1', action: 'laneSettings', sensor: 'new', lane: 1 }));
  const link2 = String(r.body.sensorLink?.link || '');
  r = await menuApi(req({ tenantId: 't1', action: 'laneSettings', sensor: 'new', lane: 1 }));
  check('a new link stops the one before it', (await entryGet(getReq(link2))).status === 404 && (await entryGet(getReq(String(r.body.sensorLink?.link || '')))).status === 200);

  console.log('Kept small and honest');
  const sens: any = await get(`${T}/private/laneSensors`);
  const lastWas = sens?.last?.['1'];
  await S.sensorCar(db, 't1', new URL(String(r.body.sensorLink?.link || '')).searchParams.get('k') || '', Date.parse(lastWas || '') + 5000);
  check('when it last counted a car is written at most every half minute', (await get(`${T}/private/laneSensors`))?.last?.['1'] === lastWas, [(await get(`${T}/private/laneSensors`))?.last, lastWas]);
  const T9 = 'tenants/t9'; await db.doc(T9).set({ name: 'Elsewhere', driveThru: { askName: false } });
  await S.lineClear(db, 't9', null);
  check('Line’s clear at a business with no sensor writes nothing, so it never looks as if it had one', !(await get(`${T9}/private/laneEntry_1`)) && (await S.lineNow(db, 't9', { driveThru: {} })).sensor === false);
  manager = true; await menuApi(req({ tenantId: 't1', action: 'laneSettings', sensor: 'stop', lane: 1 })); manager = false;
  check('a sensor turned off takes its count with it', !(await get(`${T}/private/laneEntry_1`)));
  manager = true; const fresh: any = await menuApi(req({ tenantId: 't1', action: 'laneSettings', sensor: 'new', lane: 1 })); manager = false;
  check('…and a new one starts with an empty count', JSON.stringify((await get(`${T}/private/laneEntry_1`))?.at) === '[]');
  const fl = String(fresh.body.sensorLink?.link || ''); let lastStatus = 0;
  for (let i = 0; i < 61; i++) lastStatus = (await entryGet(getReq(fl, '10.9.9.9'))).status;
  check('one address calling over and over is turned away', lastStatus === 429 && (await entryGet(getReq(fl, '10.9.9.10'))).status === 429, lastStatus);

  console.log('The screens');
  const ln = src('src/app/drive-thru/[tenantId]/page.tsx'), kds = src('src/app/kds/[tenantId]/page.tsx'), vr = src('src/app/api/counter/voice/route.ts'), mp = src('src/app/(app)/menu/page.tsx'), card = src('src/components/menu/LaneEntrySettings.tsx');
  check('the lane screen: Waiting to order, the busy line counting them, and Line’s clear', /Waiting to order <b/.test(ln) && /\(st\.inLineNow \?\? st\.inLane\) \+ \(st\.waiting \|\| 0\) >= \(st\.rushAt \|\| 6\)/.test(ln) && /act\('lineClear', \{ action: 'lineClear' \}\)/.test(ln) && /Line’s clear<\/button>/.test(ln));
  check('the voice assistant’s rush counts them too', /busy = others \+ 1 \+ waiting >= RUSH_CARS;/.test(vr));
  check('the kitchen: Being ordered, this station’s part, before the tickets', /function BeingOrdered/.test(kds) && /\{data && earlyHere\.length > 0 && <BeingOrdered rows=\{earlyHere\} now=\{now\} \/>\}/.test(kds) && /l\.madeAt === myStation/.test(kds) && /early: Array\.isArray\(d\.early\) \? d\.early : \[\]/.test(kds));
  const L = await import('../../src/lib/screen-lang');
  check('…in Spanish too', ['Being ordered', 'Not sent yet', 'Ordering, {t}'].every((x) => L.hasSpanish(x)));
  check('the Menu page: the sensor’s link per lane (shown once), Check it, Turn off, and when the kitchen sees orders as they’re taken',
    /<LaneEntrySettings sensors=\{laneEntry\.sensors\}/.test(mp) && /It’s shown only now; make a new one if it’s lost\./.test(card) && /'Check it'|>Check it</.test(card) && /\[\['rush', 'In a rush'\], \['always', 'Always'\], \['off', 'Never'\]\]/.test(card));
  const ours = src('src/lib/lane-entry.ts') + src('src/lib/lane-entry-server.ts') + card + src('src/app/api/counter/lane-entry/route.ts');
  check('in the app’s own words', !/salon|stylist|booth|chair\b|studio|\buppercase\b|font-black/i.test(ours.replace(/^import .*$/gm, '')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
