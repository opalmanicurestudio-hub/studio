// Checks orders placed ahead at the drive-thru lane (design canvas: Ordered ahead at the drive-thru): lib/counter-ahead
// aheadToCar and aheadNothingMore, lib/counter-orders carryOn and pickupOnlyOf, the lane's moves in api/counter (lane,
// board, window, aheadCar, aheadDone, send, paid, move, cancel), lib/counter-server voidOrder, api/menu laneSettings,
// lib/drive-thru-voice voiceOn, and the lane, window, board, menu board and Menu page screens.
// - Found at the speaker: the order goes with the car, which stays there ("anything else?"); what they add is the car's
//   own order, sent and paid at the window as ever; "Nothing else" sends the car on with the order it paid for.
// - Handed over together: both orders done and every ticket served; the window says both, and Ready only when both are.
// - A paid order is never left behind: the car's own order voided, cancelled or let go, the car carries on to pickup.
// - Found by name or order number as well as the code.
// - Pickup only (Menu page): the lane screen finds orders instead of taking them, the voice assistant is off, the menu
//   board says to order on your phone.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ahead-lane.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const day = new Date().toISOString().slice(0, 10);
const nowS = () => new Date().toISOString();

(async () => {
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const CS = await import('../../src/lib/counter-server');
  const V = await import('../../src/lib/drive-thru-voice');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, orderAhead: { on: true } });
  await db.doc(`${T}/inventory/muffin`).set({ type: 'refreshment', name: 'Blueberry muffin', category: 'Bakery', price: 3.75, totalStock: 40 });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Lane', kind: 'drive-thru' }))).body.key;
  const wkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru-board' }))).body.key;
  const L = (b: any) => LANE(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const W = (b: any) => LANE(req({ tenantId: 't1', key: wkey, ...b })) as Promise<any>;
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b })) as Promise<any>;
  // Orders placed ahead, paid, each with its kitchen ticket waiting (as lib/counter-ahead leaves them).
  const placed = async (n: number, name: string) => {
    const id = `ahead${n}`; const code = String(4800 + n);
    await db.doc(`${T}/counterOrders/${id}`).set({ id, number: `A${n}`, channel: 'ahead', status: 'sent', day, guestName: name, paidAt: nowS(), payMethod: 'card', sentAt: nowS(),
      lines: [{ lineId: 'l1', itemId: 'latte', name: 'Latte', quantity: 2, unitPrice: 4.5 }], subtotal: 9, tax: 0, total: 9, ahead: { way: 'drive-thru', code, state: 'paid' } });
    await db.doc(`${T}/aheadCodes/${day}_${code}`).set({ orderId: id });
    await db.doc(`${T}/kdsTickets/${id}_l1`).set({ orderId: id, status: 'pending', menuItemName: 'Latte', quantity: 2 });
    return { id, code, number: `A${n}` };
  };
  const tickets = async (orderId: string) => (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === orderId);
  const ready = async (orderId: string) => { for (const t of await tickets(orderId)) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'ready' }, { merge: true }); };
  const a1 = await placed(1, 'Jordan'), a2 = await placed(2, 'Sam'), a3 = await placed(3, 'Lee'), a4 = await placed(4, 'Dev'), a5 = await placed(5, 'Rae'), a6 = await placed(6, 'Kim');

  console.log('found at the speaker');
  const c1 = (await L({ action: 'car', carKey: 'carkey-lane-1' })).body;
  let r = await L({ action: 'aheadCar', code: a1.code, carId: c1.carId });
  let car: any = await get(`${T}/driveThruCars/${c1.carId}`);
  check('the order goes with the car at the speaker, which stays there for anything else', r.body.ok && r.body.linked && r.body.number === 'A1' && r.body.name === 'Jordan' && r.body.carNumber === c1.number
    && car.aheadId === a1.id && car.aheadNumber === 'A1' && car.stage === 'speaker' && car.orderId === c1.orderId, { body: r.body, car });
  check('…their name comes with it, and the order placed ahead is this car’s', (await get(`${T}/counterOrders/${c1.orderId}`)).guestName === 'Jordan' && (await get(`${T}/counterOrders/${a1.id}`)).carId === c1.carId);
  r = await L({ action: 'aheadCar', code: a1.code, carId: c1.carId });
  check('…found again for the same car: as it is', r.body.ok && r.body.linked && r.body.already, r.body);
  r = await L({ action: 'lane' });
  const row = r.body.cars.find((c: any) => c.id === c1.carId);
  check('the lane: the car with its order placed ahead, both orders, and off the list of orders on their way', row?.aheadId === a1.id && r.body.orders[a1.id]?.number === 'A1' && r.body.orders[a1.id].lines.length === 1 && r.body.orders[c1.orderId]
    && !(r.body.ahead || []).some((a: any) => a.id === a1.id) && r.body.settings.pickupOnly === false, { row, ahead: r.body.ahead });
  r = await W({ action: 'board' });
  check('the order board by the speaker: their order placed ahead, while they’re asked for anything else', r.body.order?.alsoAhead === 'A1' && r.body.order.lines.length === 0, r.body.order);
  r = await L({ action: 'aheadCar', code: a2.code, carId: c1.carId });
  check('a second order placed ahead for the same car: a new car for it', r.status === 409 && r.body.code === 'has_ahead', r.body);
  await L({ action: 'add', orderId: c1.orderId, itemId: 'muffin', quantity: 1, tapKey: 'tap-lane-1' });
  r = await L({ action: 'aheadDone', carId: c1.carId });
  check('something added: “Nothing else” doesn’t let it go (it’s sent and paid at the window)', r.status === 409 && r.body.code === 'has_order', r.body);
  await L({ action: 'send', orderId: c1.orderId });
  car = await get(`${T}/driveThruCars/${c1.carId}`);
  check('sent: on to pay, with the order placed ahead still going with it', car.stage === 'pay' && car.aheadId === a1.id, car);
  r = await L({ action: 'aheadCar', code: a2.code, carId: c1.carId });
  check('a car whose order is with the kitchen: a new car for another order placed ahead', r.status === 409 && r.body.code === 'has_order', r.body);
  r = await W({ action: 'window', at: 'pay' });
  check('the pay window: only what they added to pay, and their order placed ahead said as paid', r.body.show?.mode === 'pay' && r.body.show.subtotal === 3.75 && r.body.show.alsoAhead === 'A1' && r.body.show.lines.length === 1, r.body.show);
  r = await L({ action: 'paid', orderId: c1.orderId, method: 'cash', tendered: 5 });
  car = await get(`${T}/driveThruCars/${c1.carId}`);
  check('paid: on to pickup', r.body.ok && car.stage === 'pickup', car);
  await ready(c1.orderId);
  r = await W({ action: 'window', at: 'pickup' });
  check('the pickup window: both orders, and not ready while the one placed ahead is still being made', r.body.show?.mode === 'paid' && r.body.show.alsoAhead === 'A1' && r.body.show.kitchen === 'making', r.body.show);
  await ready(a1.id);
  r = await W({ action: 'window', at: 'pickup' });
  check('…ready once both are', r.body.show?.kitchen === 'ready', r.body.show);
  r = await L({ action: 'move', carId: c1.carId, to: 'gone' });
  const ts = [...await tickets(c1.orderId), ...await tickets(a1.id)];
  check('handed over: both orders done, every ticket of both served', r.body.ok && (await get(`${T}/driveThruCars/${c1.carId}`)).stage === 'gone' && (await get(`${T}/counterOrders/${c1.orderId}`)).status === 'done'
    && (await get(`${T}/counterOrders/${a1.id}`)).status === 'done' && ts.length === 2 && ts.every((t: any) => t.status === 'delivered'), ts);

  console.log('nothing else, and a paid order never left behind');
  const c2 = (await L({ action: 'car', carKey: 'carkey-lane-2' })).body;
  await L({ action: 'aheadCar', code: a2.code, carId: c2.carId });
  r = await L({ action: 'aheadDone', carId: c2.carId });
  car = await get(`${T}/driveThruCars/${c2.carId}`);
  check('“Nothing else”: on to pickup with the order placed ahead, under its number; the empty order let go', r.body.ok && r.body.number === 'A2' && car.orderId === a2.id && car.stage === 'pickup' && car.number === 'A2' && car.ahead === true && !car.aheadId
    && (await get(`${T}/counterOrders/${c2.orderId}`)).status === 'voided', car);
  r = await L({ action: 'aheadDone', carId: c2.carId });
  check('…a second tap: already on its way', r.body.ok && r.body.already, r.body);
  const c3 = (await L({ action: 'car', carKey: 'carkey-lane-3' })).body;
  r = await L({ action: 'aheadDone', carId: c3.carId });
  check('a car with no order placed ahead: “Nothing else” isn’t for it', r.status === 409 && r.body.code === 'no_ahead', r.body);
  await L({ action: 'aheadCar', code: a3.code, carId: c3.carId });
  r = await L({ action: 'cancel', orderId: c3.orderId });
  car = await get(`${T}/driveThruCars/${c3.carId}`);
  check('“left without ordering” from another screen: the car carries on to pickup with what it paid for', r.body.ok && r.body.carriedOn && car.stage === 'pickup' && car.orderId === a3.id && car.number === 'A3' && !car.left
    && (await get(`${T}/counterOrders/${c3.orderId}`)).status === 'cancelled', car);
  const c4 = (await L({ action: 'car', carKey: 'carkey-lane-4' })).body;
  await L({ action: 'aheadCar', code: a4.code, carId: c4.carId });
  await L({ action: 'add', orderId: c4.orderId, itemId: 'muffin', quantity: 1, tapKey: 'tap-lane-4' });
  await L({ action: 'send', orderId: c4.orderId });
  const vr: any = await CS.voidOrder(db, 't1', c4.orderId, 'Couldn’t pay', { id: null, name: 'Mo Diaz' });
  car = await get(`${T}/driveThruCars/${c4.carId}`);
  check('what they added voided (couldn’t pay): the car carries on to pickup with its order placed ahead, and the lane is told why', vr.ok && car.stage === 'pickup' && car.orderId === a4.id && car.number === 'A4' && !car.aheadId && !car.voided && car.addOnVoided === true
    && (await L({ action: 'lane' })).body.cars.find((c: any) => c.id === c4.carId)?.addOnVoided === true
    && (await get(`${T}/counterOrders/${c4.orderId}`)).status === 'voided', car);
  const c5 = (await L({ action: 'car', carKey: 'carkey-lane-5' })).body;
  await L({ action: 'aheadCar', code: a5.code, carId: c5.carId });
  r = await L({ action: 'move', carId: c5.carId, to: 'gone' });
  car = await get(`${T}/driveThruCars/${c5.carId}`);
  check('let go from an old screen while nothing was added: carries on to pickup, never gone without it', r.body.ok && r.body.carriedOn && car.stage === 'pickup' && car.orderId === a5.id, car);
  r = await L({ action: 'move', carId: c5.carId, to: 'gone' });
  check('…then handed over with it', r.body.ok && (await get(`${T}/driveThruCars/${c5.carId}`)).stage === 'gone' && (await get(`${T}/counterOrders/${a5.id}`)).status === 'done');
  r = await L({ action: 'aheadCar', code: a6.code });
  car = await get(`${T}/driveThruCars/${r.body.carId}`);
  check('no car at the speaker (the window, a pickup-only lane): a car made for it, straight to pickup', r.body.ok && !r.body.linked && car.stage === 'pickup' && car.orderId === a6.id && !car.aheadId, car);

  console.log('pickup only');
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  r = await Mn({ action: 'laneSettings', pickupOnly: true });
  check('only a manager says so', r.status === 403, r.body);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  r = await Mn({ action: 'laneSettings', pickupOnly: true });
  const td: any = await get(T);
  check('pickup only: kept, the spots as they were', r.body.ok && r.body.lane.pickupOnly === true && r.body.lane.aheadThere === true && r.body.lane.spots === 4 && td.driveThru.pickupOnly === true, r.body);
  r = await Mn({ action: 'laneSettings', spots: 3 });
  check('…the spots changed after: still pickup only', r.body.ok && r.body.lane.spots === 3 && r.body.lane.pickupOnly === true && (await get(T)).driveThru.pickupOnly === true, r.body);
  r = await Mn({ action: 'list' });
  check('…the Menu page knows it', r.body.ok && r.body.lane?.pickupOnly === true, r.body.lane);
  r = await L({ action: 'lane' });
  check('…so does the lane screen', r.body.settings?.pickupOnly === true && r.body.settings.spots === 3, r.body.settings);
  r = await W({ action: 'menuBoard' });
  check('…and the menu board, while ordering ahead is on', r.body.ok && r.body.pickupOnly === true && !!r.body.orderAhead, r.body.pickupOnly);
  process.env.RETELL_API_KEY = 'test-key';
  check('the voice assistant is off for a pickup-only drive-thru, on otherwise', !V.voiceOn({ driveThru: { voiceAgentId: 'agent_1', pickupOnly: true }, orderAhead: { on: true } }) && V.voiceOn({ driveThru: { voiceAgentId: 'agent_1' }, orderAhead: { on: true } }));
  check('…and on while ordering ahead is off, or not at the drive-thru: nothing could be picked up, so cars order at the speaker', V.voiceOn({ driveThru: { voiceAgentId: 'agent_1', pickupOnly: true } }) && V.voiceOn({ driveThru: { voiceAgentId: 'agent_1', pickupOnly: true }, orderAhead: { on: true, driveThru: false } }));
  delete process.env.RETELL_API_KEY;
  await db.doc(T).set({ orderAhead: { on: false } }, { merge: true });
  r = await L({ action: 'lane' }); const ml: any = await Mn({ action: 'list' });
  check('ordering ahead turned off: the lane takes orders at the speaker again; the Menu page keeps the choice and says why it waits', r.body.settings?.pickupOnly === false && ml.body.lane?.pickupOnly === true && ml.body.lane?.aheadThere === false, [r.body.settings, ml.body.lane]);
  await db.doc(T).set({ orderAhead: { on: true } }, { merge: true });
  r = await Mn({ action: 'laneSettings', pickupOnly: false });
  check('back to orders and pickup', r.body.ok && r.body.lane.pickupOnly === false && (await get(T)).driveThru.pickupOnly === false);

  console.log('the screens');
  const lane = src('src/app/drive-thru/[tenantId]/page.tsx');
  check('found by code (four digits, even one not listed yet), or by name or order number as it’s typed', /const code = \/\^\\d\{4\}\$\/\.test\(t\);/.test(lane) && /a\.number\.toLowerCase\(\)\.startsWith\(t\)/.test(lane) && /String\(a\.name \|\| ''\)\.toLowerCase\(\)\.split\(\/\\s\+\/\)\.some\(\(w\) => w\.startsWith\(t\)\)/.test(lane)
    && /placeholder="Code or name"/.test(lane) && /No order today under that name or number\. Ask for their code\./.test(lane));
  check('the speaker: with the car still ordering, it goes with that car; anything else, or “Nothing else, send to pickup” (no “left without ordering”)', /const speakerCar = car && car\.stage === 'speaker' && order && order\.status === 'building' && !car\.aheadId \? car : null;/.test(lane)
    && /onClick=\{aheadDone\}[^\n]*Nothing else, send to pickup/.test(lane) && /\{!aheadOrder && <button type="button" onClick=\{cancel\}/.test(lane) && /Anything else\?/.test(lane) && /<AheadWith o=\{aheadOrder\} \/>/.test(lane));
  check('the pay and pickup windows: only what was added to pay; both handed over, ready only when both are', /Only what they added\. Order \{aheadOrder\.number\}, placed ahead, is paid already\./.test(lane) && /const allReady = order\?\.kitchen === 'ready' && \(!aheadOrder \|\| aheadOrder\.kitchen === 'ready'\);/.test(lane)
    && /if \(allReady \|\|/.test(lane) && /<AheadTicket o=\{aheadOrder\} \/>/.test(lane) && /placed ahead and paid: hand both over\./.test(lane));
  check('pickup only: the screen finds orders (a new car for each, at pickup), can still take one, and keeps Every car, Pickup window and Runner', /onPick=\{\(x\) => toAhead\(x, true\)\}/.test(lane) && /Take an order here anyway/.test(lane)
    && /const PICKUP_ROLES: Role\[\] = \['all', 'pickup', 'runner'\];/.test(lane) && /const role: Role = pickupOnly && !PICKUP_ROLES\.includes\(roleSet\) \? 'all' : roleSet;/.test(lane) && /ROLES\.filter\(\(\[k\]\) => PICKUP_ROLES\.includes\(k\)\)/.test(lane));
  check('away from the speaker, which car it goes with is picked (the car there may not be theirs); the speaker’s own screen links it', /choose=\{role !== 'speaker'\}/.test(lane) && /toCarOrdering=\{!!speakerCar && !!order\?\.lines\.length\}/.test(lane) && /useState\(!toCarOrdering\)/.test(lane) && /\[\[true, `Car \$\{toCar\} at the speaker`\], \[false, 'A new car at pickup'\]\]/.test(lane) && /onPick=\{\(x\) => onPick\(x, !linking\)\}/.test(lane));
  check('after a void, the window is told the order paid ahead is still theirs; only the count is read out as it’s typed', /What they added was voided\. \{order\.number\} was paid ahead and is still theirs/.test(lane) && /<p className="text-\[14px\] font-semibold" aria-live="polite">/.test(lane) && !/<div className="space-y-2" aria-live="polite">/.test(lane));
  check('“Nothing else” hangs up the voice assistant with that car', /if \(r\.ok && !r\.already\) await stopCarCall\(db, tenantId, String\(b\.carId \|\| ''\), 'car moved on'\);/.test(src('src/app/api/counter/route.ts')));
  check('the window and the order board say their order placed ahead', /t\('Your order placed ahead, \{n\}, is paid already\.', \{ n: s\.alsoAhead \}\)/.test(src('src/app/drive-thru/[tenantId]/window/page.tsx')) && /t\('We have your order \{n\}, paid and being made\. Anything else\?', \{ n: o\.alsoAhead \}\)/.test(src('src/app/drive-thru/[tenantId]/board/page.tsx')));
  const menuPage = src('src/app/(app)/menu/page.tsx');
  check('the Menu page: Your drive-thru, Orders and pickup or Pickup only; the menu board says to order on your phone', /\[\[false, 'Orders and pickup'\], \[true, 'Pickup only'\]\]/.test(menuPage) && /aria-pressed=\{on\} aria-disabled=\{busy === 'pickupOnly'\}/.test(menuPage)
    && /Pickup only: order on your phone/.test(src('src/app/drive-thru/[tenantId]/menu/page.tsx')));
  const mine = [lane.slice(lane.indexOf('function AheadWith'), lane.indexOf('// ─── A car in the lane')), lane.slice(lane.indexOf('function AheadFind'), lane.indexOf('function LooksSheet'))].join('\n');
  check('in the app’s own words', !/font-black|uppercase|call us|contact us/i.test(mine) && !/ · /.test(mine.replace(/\{a\.name \? ` · \$\{a\.name\}` : ''\} · code|\} · \{a\.summary\}/g, '')), mine.match(/ · .{0,30}/g));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
