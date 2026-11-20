// Checks the ready board by the counter (design canvas: The ready board): lib/ready-board, api/counter 'readyBoard',
// the board's page, its setup, and where it's opened from.
// - Counter and kiosk orders, and orders placed ahead to pick up inside; never the drive-thru's cars or curbside orders,
//   an order placed ahead that isn't paid, or one for later the kitchen hasn't started.
// - Being made while any part is; ready when every part is (two stations included), newest first; off the board once
//   handed over (the order done, or every ticket delivered).
// - Only numbers and first names, from a key that can only show.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ready-board.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] }, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const src = (p: string) => fs.readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const ago = (m: number) => new Date(Date.now() - m * 60000).toISOString();

(async () => {
  const R = await import('../../src/lib/ready-board');
  const o = (id: string, x: any) => ({ id, number: id.toUpperCase(), status: 'sent', channel: 'counter', sentAt: ago(10), ...x });
  const t = (orderId: string, status: string, x: any = {}) => ({ orderId, status, ...x });
  const orders = [
    o('c1', { guestName: 'Priya Shah', sentAt: ago(8) }), o('c2', { guestName: 'Dev' }), o('c3', { guestName: 'Sam', sentAt: ago(2) }), o('c4', {}), o('c5', { guestName: 'Ana' }),
    o('k1', { channel: 'kiosk', guestName: 'Kim', sentAt: ago(5) }),
    o('a1', { channel: 'ahead', paidAt: ago(20), ahead: { way: 'inside' }, guestName: 'Jordan', sentAt: ago(20) }), o('a2', { channel: 'ahead', paidAt: ago(20), ahead: { way: 'inside' }, guestName: 'Later' }),
    o('a3', { channel: 'ahead', paidAt: ago(20), ahead: { way: 'drive-thru' } }), o('a4', { channel: 'ahead', paidAt: ago(20), ahead: { way: 'curbside' } }), o('a5', { channel: 'ahead', ahead: { way: 'inside' } }),
    o('b1', { channel: 'drive-thru' }), o('d1', { status: 'done' }), o('v1', { status: 'voided' }),
  ];
  const tickets = [
    t('c1', 'in_progress'), t('c2', 'ready', { readyAt: ago(3) }), t('c3', 'ready', { readyAt: ago(1) }), t('c3', 'in_progress'), t('c4', 'ready', { readyAt: ago(1) }), t('c4', 'cancelled'),
    t('c5', 'delivered'), t('k1', 'pending'), t('a1', 'ready', { readyAt: ago(0.5) }), t('a2', 'pending', { holdUntil: new Date(Date.now() + 3600000).toISOString() }),
    t('a3', 'pending'), t('a4', 'pending'), t('a5', 'pending'), t('b1', 'pending'), t('d1', 'ready'), t('v1', 'pending'),
  ];
  const b = R.readyBoardOf(orders, tickets);
  console.log('what’s on it');
  check('being made, oldest first: a part still being made keeps the whole order there (two stations)', b.making.map((x) => x.number).join(',') === 'C1,K1,C3', b.making);
  check('ready, newest first, once every part is (a cancelled part doesn’t count)', b.ready.map((x) => x.number).join(',') === 'A1,C4,C2', b.ready);
  check('first names only', b.making.find((x) => x.number === 'C1')?.name === 'Priya' && b.ready.find((x) => x.number === 'C4')?.name === null);
  const all = [...b.making, ...b.ready].map((x) => x.number);
  const aged = R.readyBoardOf([o('r1', { guestName: 'Old' }), o('m1', { sentAt: ago(4 * 60) }), o('r2', {})], [t('r1', 'ready', { readyAt: ago(50) }), t('m1', 'in_progress'), t('r2', 'ready', { readyAt: ago(40) })]);
  check('a ready order nobody marked collected leaves after 45 minutes; one being made for over three hours isn’t shown', aged.ready.map((x) => x.number).join(',') === 'R2' && aged.making.length === 0, aged);
  check('not on it: the drive-thru’s cars, curbside and drive-thru pickups placed ahead, one not paid, one for later not started, handed over (done, or every ticket delivered), voided',
    !['B1', 'A3', 'A4', 'A5', 'A2', 'D1', 'C5', 'V1'].some((n) => all.includes(n)), all);

  console.log('the board’s screen');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const day = new Date().toISOString().slice(0, 10);
  await db.doc(T).set({ name: 'North Pier Coffee', timezone: 'UTC' });
  for (const x of orders) await db.doc(`${T}/counterOrders/${x.id}`).set({ ...x, day, lines: [{ name: 'Secret latte', quantity: 1, unitPrice: 9.99 }], total: 9.99 });
  const chan = (id: string) => orders.find((x) => x.id === id)?.channel || 'counter';
  for (const [i, x] of tickets.entries()) await db.doc(`${T}/kdsTickets/t${i}`).set({ ...x, channel: chan(x.orderId), createdAt: ago(30) });
  await db.doc(`${T}/kdsTickets/stale`).set({ orderId: 'c9', channel: 'counter', status: 'ready', readyAt: ago(10), createdAt: ago(20 * 60) });
  await db.doc(`${T}/counterOrders/c9`).set({ id: 'c9', number: 'C9', status: 'sent', channel: 'counter', sentAt: ago(20 * 60), day });
  const bkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Ready board', kind: 'drive-thru-board' }))).body.key;
  const r: any = await LANE(req({ tenantId: 't1', key: bkey, action: 'readyBoard' }));
  check('a key that can only show opens it: being made and ready, numbers and first names', r.status === 200 && r.body.ok && r.body.making.map((x: any) => x.number).join(',') === 'C1,K1,C3' && r.body.ready.map((x: any) => x.number).join(',') === 'A1,C4,C2' && r.body.business.name === 'North Pier Coffee', r.body);
  check('…and nothing else: no items, prices or anything about the guest but a first name', !/Secret latte|9\.99|Shah/.test(JSON.stringify(r.body)) && r.body.making.every((x: any) => Object.keys(x).join(',') === 'number,name'));
  const route = src('src/app/api/counter/route.ts');
  check('…started from the kitchen’s live tickets and only their orders, never a whole day’s orders every few seconds', /BOARD_CHANNELS\.flatMap\(\(c\) => LIVE_TICKETS\.map\(\(s\) => db\.collection\(`\$\{T\}\/kdsTickets`\)\.where\('channel', '==', c\)\.where\('status', '==', s\)\.limit\(300\)\.get\(\)\)\)\)/.test(route) && /\(Date\.parse\(String\(t\.createdAt \|\| ''\)\) \|\| now\.getTime\(\)\) >= old/.test(route) && /db\.getAll\(\.\.\.ids\.map\(\(id\) => db\.doc\(`\$\{T\}\/counterOrders\/\$\{id\}`\)\)\)/.test(route));
  const r2: any = await LANE(req({ tenantId: 't1', key: bkey, action: 'lane' }));
  check('…that key still can’t work the lane', r2.status === 401);

  console.log('the page');
  const page = src('src/app/drive-thru/[tenantId]/ready/page.tsx');
  check('set up like the menu board; reads only the ready board; out of touch, it says so rather than show an old board', /<ScreenSetup ready tenantId=\{tenantId\}/.test(page) && /action: 'readyBoard'/.test(page) && /Reconnecting…/.test(page) && /const b = stale \? null : board;/.test(page));
  check('numbers and first names, or numbers only, picked on the screen and kept on it', /\[\[true, 'Numbers and first names', 'The name given with the order'\], \[false, 'Numbers only'/.test(page) && /write\(namesName\(tenantId\), v \? 'on' : 'off'\)/.test(page) && /const who = \(r: Row\) => \(names && r\.name \? r\.name : null\);/.test(page));
  check('opened from the counter and the lane', /Open the ready board/.test(src('src/app/(app)/counter/page.tsx')) && /Open the ready board/.test(src('src/app/drive-thru/[tenantId]/page.tsx')) && /'Set up the ready board'/.test(src('src/components/drive-thru/ScreenSetup.tsx')));
  check('in the app’s own words', !/font-black|\buppercase\b|call us|contact us/i.test(page + src('src/lib/ready-board.ts')) && !/ · /.test(page));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
