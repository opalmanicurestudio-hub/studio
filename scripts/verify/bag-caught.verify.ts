// Checks "Caught before it went" (design board "The extras in the bag, and what got caught"; lib/bag-caught,
// lib/bag-caught-server, lib/food-bags-server noteWrong and noteHeld, api/drive-live 'caught', Drive-thru live's third
// tab):
// - shifts: the menu's times of day (one past midnight too, and other times), or morning, afternoon and evening, in the
//   business's time zone
// - the report: orders to go only, wrong items caught, orders held and what was missing (each order once a name), PINs
//   and why (who okayed them for managers only), labels and stickers with no code, by shift and all day
// - kept as it happens: another order's bag scanned for this one, and a handover refused (at the window and curbside)
// - the live view's tab reads it for today, 7 or 30 days; the rest of the team sees why but not who
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/bag-caught.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let actor: any = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (f: any) => { void Promise.resolve().then(f); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams() } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const day = new Date().toISOString().slice(0, 10);
const nowS = () => new Date().toISOString();

(async () => {
  const B = await import('../../src/lib/bag-caught');
  const BS = await import('../../src/lib/bag-caught-server');

  console.log('shifts');
  const parts = [{ id: 'bk', name: 'Breakfast', from: '06:00', to: '11:00' }, { id: 'ln', name: 'Lunch', from: '11:00', to: '15:00' }, { id: 'lt', name: 'Late night', from: '22:00', to: '02:00' }];
  check('with no times of day: morning, afternoon, evening', B.shiftOf(9 * 60, []).name === 'Morning' && B.shiftOf(12 * 60, []).name === 'Afternoon' && B.shiftOf(17 * 60 + 1, []).name === 'Evening' && B.shiftOf(0, []).name === 'Morning');
  check('…with them: the menu’s own, one past midnight too, and other times for the rest', B.shiftOf(7 * 60, parts).name === 'Breakfast' && B.shiftOf(11 * 60, parts).name === 'Lunch' && B.shiftOf(23 * 60, parts).name === 'Late night' && B.shiftOf(60, parts).name === 'Late night' && B.shiftOf(16 * 60, parts).name === 'Other times');
  check('the minute of the day in the business’s time zone', B.minuteIn('2026-11-22T15:30:00Z', 'America/New_York') === 10 * 60 + 30 && B.minuteIn('2026-11-22T15:30:00Z', 'UTC') === 15 * 60 + 30 && B.minuteIn('nope', 'UTC') === 0);
  check('what counts as missing: an item without its choices, an extra without how many', B.missName('Iced matcha, Medium') === 'Iced matcha' && B.missName('2 Ranch', true) === 'Ranch' && B.missName('Napkins', true) === 'Napkins');

  console.log('the report');
  const at = (h: number, m = 0) => `2026-11-22T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
  const orders = [
    { status: 'done', channel: 'drive-thru', doneAt: at(7), checks: { wrongs: ['bag:o9.1', 'item:o9.t1.1', 'bag:o9.1'], held: true, missing: ['Iced matcha', 'Ranch'] }, bags: { count: 1, printedAt: at(7), coded: true, scanned: [1] } },
    { status: 'done', channel: 'drive-thru', doneAt: at(8), checks: { held: true, missing: ['Ranch', 'ranch'] }, bags: { count: 1, printedAt: at(8), coded: false, skipped: { by: 'Ana Ruiz', at: at(8), reason: 'The printer is down' } } },
    { status: 'done', channel: 'drive-thru', doneAt: at(12), stickers: { list: [{ k: 't1.1', name: 'Latte', v: 1, c: false }, { k: 't1.2', name: 'Latte', v: 1, c: false }], scanned: [] }, bags: { skipped: { by: 'Ana Ruiz', at: at(12), reason: 'The printer is down' } } },
    { status: 'done', channel: 'ahead', doneAt: at(13), checks: { held: true, missing: ['Napkins'] }, bags: { skipped: { by: 'Lee Fox', at: at(13), reason: 'An extra ran out' } } },
    { status: 'done', channel: 'counter', doneAt: at(9), checks: { wrongs: ['a', 'b', 'c', 'd', 'e'], held: true, missing: ['Fries'] } },
    { status: 'cancelled', channel: 'drive-thru', doneAt: at(9), checks: { wrongs: ['a'] } },
    { status: 'done', channel: 'drive-thru', checks: { wrongs: ['a'] } },
  ];
  const rep = B.caughtReport(orders, [], 'UTC', { who: true });
  check('orders to go only (not for here, not cancelled), by shift, with the day’s total', rep.shifts.map((s) => `${s.name}:${s.orders}`).join() === 'Morning:2,Afternoon:2' && rep.total.orders === 4, rep.shifts);
  check('…wrong items caught, orders held, let go with a PIN, and without a code', rep.total.wrong === 2 && rep.total.held === 3 && rep.total.skipped === 3 && rep.total.noCode === 2 && rep.shifts[0].held === 2 && rep.shifts[1].skipped === 2, rep.total);
  check('most often missing: each order counts a name once, whatever its case', rep.missing.map((m) => `${m.name}:${m.n}`).join() === 'Ranch:2,Iced matcha:1,Napkins:1', rep.missing);
  check('the PINs: why, and who okayed them (for a manager)', rep.skips.map((x) => `${x.n} ${x.reason} ${x.by}`).join('|') === '2 The printer is down Ana Ruiz|1 An extra ran out Lee Fox', rep.skips);
  check('…for anyone else, why only', B.caughtReport(orders, [], 'UTC', { who: false }).skips.every((x) => x.by === null) && B.caughtReport(orders, [], 'UTC', { who: false }).skips[0].n === 2);
  check('…labels in words only, and stickers in words only, counted apart', rep.noCode.labels === 1 && rep.noCode.stickers === 2, rep.noCode);
  check('with the menu’s times of day, in order', B.caughtReport(orders, parts, 'UTC', { who: true }).shifts.map((s) => s.name).join() === 'Breakfast,Lunch');

  console.log('kept as it happens');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, orderAhead: { on: true, curbside: true }, ownerId: 'own1',
    foodCost: { extras: [{ id: 'x1', itemId: 'nap', name: 'Napkins', amount: 2, measure: 'each', per: 'order', when: 'togo' }] }, bagCheck: { groups: ['Dips'], extras: ['x1'] } });
  await db.doc(`${T}/staff/s1`).set({ name: 'Kai Park', role: 'staff' });
  await db.doc(`${T}/staff/m9`).set({ name: 'Ana Ruiz', role: 'manager', pin: '4821' });
  await db.doc(`${T}/inventory/tenders`).set({ type: 'refreshment', name: 'Chicken tenders', category: 'Mains', price: 8, totalStock: 80,
    choices: [{ id: 'dips', name: 'Dips', pick: 'any', max: 3, options: [{ id: 'ranch', name: 'Ranch', price: 0 }] }] });
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: curbApi } = await import('../../src/app/api/curbside/route');
  const { POST: live } = await import('../../src/app/api/drive-live/route');
  const Q = await import('../../src/lib/order-qr');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Lane', kind: 'drive-thru' }))).body.key;
  const L = (b: any) => LANE(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const C = (b: any) => curbApi(req({ tenantId: 't1', ...b })) as Promise<any>;
  const carWith = async (k: string) => {
    const c = (await L({ action: 'car', carKey: k })).body;
    await L({ action: 'add', orderId: c.orderId, itemId: 'tenders', quantity: 2, choices: { dips: ['ranch'] }, tapKey: `${k}-a` });
    await L({ action: 'name', orderId: c.orderId, name: 'Maria Lopez' });
    await L({ action: 'send', orderId: c.orderId });
    await L({ action: 'paid', orderId: c.orderId, method: 'cash', tendered: 100 });
    return c;
  };
  const c1 = await carWith('car-1'); const c2 = await carWith('car-2');
  await L({ action: 'bags', carId: c1.carId, orderId: c1.orderId, count: 1, here: true });
  await L({ action: 'bags', carId: c2.carId, orderId: c2.orderId, count: 1, here: true });
  let r = await L({ action: 'bagScan', carId: c1.carId, code: Q.makeBagCode('t1', c2.orderId, 1) });
  check('another order’s bag scanned for this one: kept on this one, which bag', r.status === 409 && /Wrong bag/.test(r.body.error) && (await get(`${T}/counterOrders/${c1.orderId}`)).checks?.wrongs?.join() === `bag:${c2.orderId}.1` && !(await get(`${T}/counterOrders/${c2.orderId}`)).checks, (await get(`${T}/counterOrders/${c1.orderId}`)).checks);
  r = await L({ action: 'bagScan', carId: c1.carId, code: Q.makeBagCode('t1', c2.orderId, 1) });
  check('…the same one scanned again counts once', (await get(`${T}/counterOrders/${c1.orderId}`)).checks.wrongs.length === 1);
  r = await L({ action: 'bagScan', carId: c1.carId, code: 'not a label' });
  check('…something that isn’t a label isn’t a wrong item', (await get(`${T}/counterOrders/${c1.orderId}`)).checks.wrongs.length === 1);
  r = await L({ action: 'move', carId: c1.carId, to: 'gone' });
  let ch: any = (await get(`${T}/counterOrders/${c1.orderId}`)).checks;
  check('a handover refused with something left: held, and the extras still to go in, by name', r.status === 409 && ch.held === true && ch.missing.slice().sort().join() === 'Napkins,Ranch' && ch.wrongs.length === 1, ch);
  await L({ action: 'move', carId: c1.carId, to: 'gone' });
  check('…refused again: the same names once', (await get(`${T}/counterOrders/${c1.orderId}`)).checks.missing.length === 2);
  await L({ action: 'bagScan', carId: c1.carId, code: Q.makeBagCode('t1', c1.orderId, 1) });
  for (const k of (await import('../../src/lib/bag-extras')).extrasFor(await get(`${T}/counterOrders/${c1.orderId}`), await get(T)).map((x) => x.k)) await L({ action: 'extra', carId: c1.carId, orderId: c1.orderId, k });
  r = await L({ action: 'move', carId: c1.carId, to: 'gone' });
  check('…then handed over, keeping what was caught', r.body.ok && (await get(`${T}/counterOrders/${c1.orderId}`)).status === 'done' && (await get(`${T}/counterOrders/${c1.orderId}`)).checks.held === true, r.body);
  r = await L({ action: 'move', carId: c2.carId, to: 'gone', bagOverride: true, pin: '4821', bagReason: 'ran_out' });
  check('another let go with a manager’s PIN, held on nothing first', r.body.ok && !(await get(`${T}/counterOrders/${c2.orderId}`)).checks, r.body);
  const id = 'ahead1';
  await db.doc(`${T}/counterOrders/${id}`).set({ id, number: 'A1', channel: 'ahead', status: 'sent', day, guestName: 'Jordan Lee', paidAt: nowS(), payMethod: 'card', sentAt: nowS(),
    lines: [{ lineId: 'l1', itemId: 'tenders', name: 'Chicken tenders', quantity: 1, unitPrice: 8, section: 'Mains', choices: [] }], subtotal: 8, tax: 0, total: 8, ahead: { way: 'curbside', state: 'paid', hereAt: nowS() } });
  await db.doc(`${T}/kdsTickets/${id}_l1`).set({ orderId: id, channel: 'ahead', status: 'ready', menuItemName: 'Chicken tenders', quantity: 1 });
  r = await C({ action: 'handed', orderId: id });
  check('curbside: a refused handover is kept too', r.status === 409 && (await get(`${T}/counterOrders/${id}`)).checks?.missing?.join() === 'Napkins', r.body);
  await C({ action: 'extra', orderId: id, k: (await import('../../src/lib/bag-extras')).extrasFor(await get(`${T}/counterOrders/${id}`), await get(T))[0].k });
  r = await C({ action: 'handed', orderId: id });
  check('…then handed over', r.body.ok, r.body);

  console.log('on Drive-thru live');
  BS.forgetCaught();
  actor = { uid: 'm9', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  r = await live(req({ tenantId: 't1', action: 'caught', range: 'today' }));
  const rp = r.body.report;
  check('today: the orders to go handed over, what was caught, and who okayed the PIN (a manager)', r.body.ok && r.body.manager === true && r.body.scanOn === true && rp.total.orders === 3 && rp.total.wrong === 1 && rp.total.held === 2 && rp.total.skipped === 1
    && rp.missing.map((m: any) => `${m.name}:${m.n}`).join() === 'Napkins:2,Ranch:1' && rp.skips[0].reason === 'An extra ran out' && rp.skips[0].by === 'Ana Ruiz', rp);
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  BS.forgetCaught();
  r = await live(req({ tenantId: 't1', action: 'caught', range: '30' }));
  check('…the rest of the team sees why, not who; 30 days reads the same orders', r.body.ok && r.body.manager === false && r.body.report.skips[0].by === null && r.body.report.total.orders === 3 && r.body.report.range === '30', r.body.report?.skips);
  r = await live(req({ tenantId: 't1', action: 'caught', range: 'year' }));
  check('…days not offered read as today', r.body.ok && r.body.report.range === 'today');
  const srv = src('src/lib/bag-caught-server.ts');
  check('the newest orders first, only the fields the report reads, and a small cache', /\.orderBy\('doneAt', 'desc'\)\.select\(\.\.\.FIELDS\)\.limit\(CAUGHT_MAX\)/.test(srv) && /if \(cache\.size > 20\)/.test(srv));
  const { noteHeld, noteWrong } = await import('../../src/lib/food-bags-server');
  await noteWrong(db, T, 'gone1', 'bag:x.1'); await noteHeld(db, T, [{ orderId: 'gone2', number: 'X', of: 0, left: [], extras: [{ k: 'x:a_1000', name: 'Napkins', done: false }] }]);
  check('…nothing kept on an order that isn’t there', !(await get(`${T}/counterOrders/gone1`)) && !(await get(`${T}/counterOrders/gone2`)));

  console.log('the screen');
  const tab = src('src/components/drive-thru/CaughtTab.tsx'), page = src('src/app/(app)/drive-live/page.tsx');
  check('a third tab on Drive-thru live, kept in the address', /\['caught', 'Caught before it went'\]/.test(page) && /t === 'speed' \|\| t === 'caught' \? t : 'live'/.test(page) && /<CaughtTab tenantId=\{tenantId\} ask=\{hereAsked\} \/>/.test(page));
  check('…today, 7 or 30 days; a table by shift with a caption and headers; the missing as labeled bars; and what to do about no codes', /SPEED_RANGES\.map/.test(tab) && /aria-pressed=\{range === r\.id\}/.test(tab) && /<caption className="sr-only">/.test(tab) && /scope="col"/.test(tab) && /scope="row"/.test(tab)
    && /<span aria-hidden className="h-2 rounded-r-\[4px\]"/.test(tab) && /href="\/settings\/printers"/.test(tab) && /okayed by \$\{x\.by\}/.test(tab));
  for (const f of ['src/lib/bag-caught.ts', 'src/lib/bag-caught-server.ts', 'src/components/drive-thru/CaughtTab.tsx']) check(`${f}: no comments in markup, no uppercase, no " · "`, !/\{\/\*/.test(src(f)) && !/\buppercase\b/.test(src(f)) && !/ · /.test(src(f)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
