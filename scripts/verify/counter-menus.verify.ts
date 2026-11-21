// Checks the counter and the menus (round 30, design canvas "The counter and the menus"):
// - menus by time of day and happy hour (lib/menu-time): an item in a menu is sold only while it's on (a window past
//   midnight too), and says when it's back; happy hour by the business's days and hours (one past midnight belongs to
//   the day it started); a happy-hour price only below the price
// - the counter (api/counter with channel 'counter', app/(app)/counter): its own line of guests numbered C1, C2, apart
//   from the drive-thru's B1; an item off its menu by time refused; the happy-hour price on the line, and kept; a ready
//   order called out (when, how many times), then handed over
// - combos: one line, a ticket for each part at its own station with the combo's name, each part's own stock taken once
//   and put back by a void; a combo line started in the kitchen isn't put back
// - the Menu page saving all of it (api/menu 'times' and 'save'), and checkout keeping a table's happy-hour price
// - the kitchen, dish and barback screens in Spanish (lib/screen-lang, components/kitchen/ScreenLang)
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-menus.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') { class StripeMock { paymentIntents = { create: async () => ({ id: 'pi_x' }), retrieve: async () => ({ id: 'pi_x' }) }; refunds = { create: async () => ({}) }; } return Object.assign(StripeMock, { default: StripeMock }); }
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
const at = (iso: string) => new Date(iso);

(async () => {
  const MT = await import('../../src/lib/menu-time');
  const utc = { timezone: 'UTC' };
  console.log('menus by time of day, and happy hour');
  const parts = [{ id: 'bk', name: 'Breakfast', from: '07:00', to: '11:00' }, { id: 'ln', name: 'Lunch', from: '11:00', to: '15:00' }, { id: 'late', name: 'Late', from: '22:00', to: '02:00' }];
  const tn: any = { ...utc, menuSettings: { dayparts: parts, happyHour: { on: true, days: [1, 2, 3, 4, 5], from: '16:00', to: '18:00' } } };
  const pancakes = { name: 'Pancakes', price: 9, dayparts: ['bk'] }, nachos = { name: 'Nachos', price: 10, dayparts: ['late'] }, soup = { name: 'Soup', price: 6, dayparts: ['bk', 'ln'] };
  check('an item in a menu is sold while it’s on', MT.servedNow(pancakes, tn, at('2026-11-16T08:00:00Z')).ok === true && MT.servedNow(soup, tn, at('2026-11-16T13:59:00Z')).ok === true);
  const off = MT.servedNow(pancakes, tn, at('2026-11-16T12:00:00Z'));
  check('…and outside it, says when it’s back', off.ok === false && (off as any).when === 'Breakfast, from 7 AM', off);
  check('…a menu past midnight: on at 1 AM, back at 10 PM after it', MT.servedNow(nachos, tn, at('2026-11-17T01:00:00Z')).ok === true && (MT.servedNow(nachos, tn, at('2026-11-17T03:00:00Z')) as any).when === 'Late, from 10 PM');
  const soupOff = MT.servedNow(soup, tn, at('2026-11-16T16:00:00Z'));
  check('…in two menus: the next one to start', soupOff.ok === false && (soupOff as any).when === 'Breakfast, from 7 AM', soupOff);
  check('…an item in none is sold all day', MT.servedNow({ name: 'Water', price: 1 }, tn, at('2026-11-16T04:00:00Z')).ok === true);
  check('…a menu that was taken away doesn’t hold an item back', MT.servedNow({ name: 'Old', price: 1, dayparts: ['gone'] }, tn, at('2026-11-16T04:00:00Z')).ok === true);
  check('…the time is the business’s own', MT.servedNow(pancakes, { ...tn, timezone: 'America/New_York' }, at('2026-11-16T13:00:00Z')).ok === true && MT.servedNow(pancakes, tn, at('2026-11-16T13:00:00Z')).ok === false);
  check('the menu that’s on now', MT.daypartNow(tn, at('2026-11-16T12:30:00Z'))?.name === 'Lunch' && MT.daypartNow(tn, at('2026-11-16T12:30:00Z'))?.until === '3 PM' && MT.daypartNow(tn, at('2026-11-16T16:00:00Z')) === null);
  check('menus by time, kept clean: a name, a start and an end that differ, each once, up to six', MT.cleanDayparts([...parts, { id: 'bk', name: 'Again', from: '01:00', to: '02:00' }, { id: 'x', name: '', from: '01:00', to: '02:00' }, { id: 'y', name: 'Same', from: '05:00', to: '05:00' }, { id: 'z', name: 'Bad', from: '25:00', to: '02:00' }]).map((d) => d.id).join() === 'bk,ln,late');
  check('happy hour on its days and hours', MT.inHappyHour(tn, at('2026-11-16T17:00:00Z')) && !MT.inHappyHour(tn, at('2026-11-21T17:00:00Z')) && !MT.inHappyHour(tn, at('2026-11-16T18:00:00Z')) && !MT.inHappyHour(tn, at('2026-11-16T15:59:00Z')));
  const late: any = { ...utc, menuSettings: { happyHour: { on: true, days: [5], from: '22:00', to: '02:00' } } };
  check('…one past midnight belongs to the day it started (Friday’s runs into Saturday)', MT.inHappyHour(late, at('2026-11-21T01:00:00Z')) && !MT.inHappyHour(late, at('2026-11-20T01:00:00Z')) && MT.inHappyHour(late, at('2026-11-20T23:00:00Z')));
  check('…off, or with no days, is off', !MT.inHappyHour({ ...utc, menuSettings: { happyHour: { on: false, days: [1], from: '16:00', to: '18:00' } } }, at('2026-11-16T17:00:00Z')) && MT.cleanHappyHour({ on: true, days: [] }).on === false);
  check('a happy-hour price only when it’s below the price', MT.happyPriceOf({ price: 9, happyPrice: 6 }) === 6 && MT.happyPriceOf({ price: 9, happyPrice: 9 }) === null && MT.happyPriceOf({ price: 9, happyPrice: null }) === null && MT.happyPriceOf({ price: 9, happyPrice: -1 }) === null && MT.happyPriceOf({ price: 9, happyPrice: '' }) === null);
  const red = { name: 'House red', price: 9, happyPrice: 6 };
  check('the price now: happy hour’s during it, the price otherwise', MT.priceNow(red, tn, at('2026-11-16T17:00:00Z')).price === 6 && MT.priceNow(red, tn, at('2026-11-16T17:00:00Z')).happy && MT.priceNow(red, tn, at('2026-11-16T19:00:00Z')).price === 9 && !MT.priceNow(red, tn, at('2026-11-16T19:00:00Z')).happy);
  check('the words: 7 AM, 11:30 AM, 12 PM, 12 AM', MT.timeWords('07:00') === '7 AM' && MT.timeWords('11:30') === '11:30 AM' && MT.timeWords('12:00') === '12 PM' && MT.timeWords('00:00') === '12 AM');

  console.log('the counter');
  const H = new Date().getUTCHours();
  await db.doc(T).set({ name: 'Corner Cafe', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true },
    menuSettings: { dayparts: [{ id: 'now', name: 'All day', from: hh(H - 1), to: hh(H + 1) }, { id: 'later', name: 'Supper', from: hh(H + 3), to: hh(H + 4) }], happyHour: { on: true, days: [0, 1, 2, 3, 4, 5, 6], from: hh(H - 1), to: hh(H + 1) } } });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', job: 'manager' });
  await db.doc(`${T}/inventory/bun`).set({ type: 'retail', name: 'Buns', totalStock: 100, unit: 'units' });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Food', price: 11, totalStock: 50, makeSeconds: 300, station: 'Grill', formula: [{ id: 'bun', name: 'Bun', quantityUsed: 1, unit: 'units' }] });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 4, totalStock: 40, makeSeconds: 120, station: 'Fryer' });
  await db.doc(`${T}/inventory/salad`).set({ type: 'refreshment', name: 'Side salad', category: 'Sides', price: 5, totalStock: 10 });
  await db.doc(`${T}/inventory/tea`).set({ type: 'refreshment', name: 'Iced tea', category: 'Drinks', price: 3, totalStock: 30 });
  await db.doc(`${T}/inventory/red`).set({ type: 'refreshment', name: 'House red', category: 'Drinks', price: 9, happyPrice: 6, totalStock: 20, dayparts: ['now'] });
  await db.doc(`${T}/inventory/stew`).set({ type: 'refreshment', name: 'Stew', category: 'Food', price: 12, totalStock: 20, dayparts: ['later'] });
  await db.doc(`${T}/inventory/meal`).set({ type: 'refreshment', name: 'Burger meal', category: 'Food', price: 13.5, totalStock: 0, combo: true, comboParts: [{ itemId: 'burger' }], choices: [
    { id: 'side', name: 'Side', pick: 'one', required: true, options: [{ id: 'f', name: 'Fries', price: 0, itemId: 'fries' }, { id: 's', name: 'Salad', price: 1, itemId: 'salad' }] },
    { id: 'drink', name: 'Drink', pick: 'one', required: true, options: [{ id: 't', name: 'Iced tea', price: 0, itemId: 'tea' }] }] });
  const { POST } = await import('../../src/app/api/counter/route');
  const P = (b: any) => POST(req({ tenantId: 't1', ...b }));
  manager = false;
  let r: any = await P({ action: 'car', channel: 'counter', carKey: 'k1' });
  const c1 = r.body;
  check('a guest at the counter: numbered C1, a counter order, its own line', r.body.ok && c1.number === 'C1' && (await get(`${T}/counterOrders/${c1.orderId}`)).channel === 'counter' && (await get(`${T}/driveThruCars/${c1.carId}`)).channel === 'counter', r.body);
  r = await P({ action: 'car', carKey: 'k2' }); const b1 = r.body;
  r = await P({ action: 'car', channel: 'counter', carKey: 'k3' }); const c2 = r.body;
  check('…the drive-thru keeps its own numbers (B1), the counter its own (C2)', b1.number === 'B1' && c2.number === 'C2', { b1, c2 });
  let lane: any = (await P({ action: 'lane', channel: 'counter' })).body; const dlane: any = (await P({ action: 'lane' })).body;
  check('…each screen sees only its own line of guests', lane.ok && lane.channel === 'counter' && lane.cars.map((c: any) => c.number).sort().join() === 'C1,C2' && dlane.cars.map((c: any) => c.number).join() === 'B1' && dlane.channel === 'drive-thru', { c: lane.cars, d: dlane.cars });
  check('…and the counter isn’t offered orders placed ahead for the drive-thru', Array.isArray(lane.ahead) && lane.ahead.length === 0);
  const m = (id: string) => lane.menu.find((x: any) => x.id === id);
  check('the menu at the counter: what’s on now, at its price now, and when the rest is back', m('red').priceNow === 6 && m('red').happy === true && m('red').off === null && m('stew').off === `Supper, from ${MT.timeWords(hh(H + 3))}` && m('fries').priceNow === 4 && m('fries').happy === false, { red: m('red'), stew: m('stew') });
  check('…and the header’s menu by time and happy hour', lane.daypart?.name === 'All day' && typeof lane.happyHour?.until === 'string', { d: lane.daypart, h: lane.happyHour });
  r = await P({ action: 'add', channel: 'counter', orderId: c1.orderId, itemId: 'stew', tapKey: 't1' });
  check('an item off its menu by time can’t be ordered', !r.body.ok && /Stew isn’t on now: Supper, from/.test(r.body.error), r.body);
  r = await P({ action: 'add', channel: 'counter', orderId: c1.orderId, itemId: 'red', quantity: 2, tapKey: 't2' });
  const redLine = r.body.order?.lines?.find((l: any) => l.itemId === 'red');
  check('a happy-hour item: its happy-hour price on the line, marked so', r.body.ok && redLine?.unitPrice === 6 && redLine?.happy === true, r.body.order?.lines);
  r = await P({ action: 'add', channel: 'counter', orderId: c1.orderId, itemId: 'meal', choices: { side: ['f'], drink: ['t'] }, tapKey: 't3' });
  const mealLine = r.body.order?.lines?.find((l: any) => l.itemId === 'meal');
  check('a combo: one line at its price, with what was picked', r.body.ok && mealLine?.unitPrice === 13.5 && /Fries/.test(mealLine?.choicesText || '') && /Iced tea/.test(mealLine?.choicesText || ''), mealLine);
  await P({ action: 'name', channel: 'counter', orderId: c1.orderId, name: 'Maria' });
  // Happy hour ends before it's sent: the line keeps the price it was ordered at.
  await db.doc(T).set({ menuSettings: { happyHour: { on: false, days: [], from: '16:00', to: '18:00' } } }, { merge: true });
  r = await P({ action: 'send', channel: 'counter', orderId: c1.orderId });
  const o1 = await get(`${T}/counterOrders/${c1.orderId}`);
  check('…sent after happy hour ended: the line keeps its happy-hour price', r.body.ok && o1.status === 'sent' && o1.lines.find((l: any) => l.itemId === 'red').unitPrice === 6 && Math.abs(o1.subtotal - 25.5) < 0.001, { st: o1.status, sub: o1.subtotal, e: r.body });
  const tix = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c1.orderId);
  const part = (id: string) => tix.find((t: any) => t.menuItemId === id);
  check('the combo goes to the kitchen as its parts: a ticket each, under its own name, with the combo’s', tix.length === 4 && part('burger')?.menuItemName === 'Burger' && part('fries')?.menuItemName === 'Fries' && part('tea')?.menuItemName === 'Iced tea'
    && part('burger')?.choicesText === 'Burger meal' && part('fries')?.comboLineId === mealLine.lineId && !part('meal') && part('fries')?.makeSeconds === 120, tix.map((t: any) => [t.id, t.menuItemName, t.choicesText]));
  check('…each ticket for “Maria, C1”, so the kitchen and the counter call the same name', tix.every((t: any) => t.guestName === 'Maria, C1' && t.orderNumber === 'C1'), tix.map((t: any) => t.guestName));
  check('…each part’s own stock taken once (the fries and the tea by count, the burger by its recipe), never the combo’s', (await get(`${T}/inventory/fries`)).totalStock === 39 && (await get(`${T}/inventory/tea`)).totalStock === 29 && (await get(`${T}/inventory/bun`)).totalStock === 99 && (await get(`${T}/inventory/burger`)).totalStock === 50 && (await get(`${T}/inventory/meal`)).totalStock === 0 && (await get(`${T}/inventory/red`)).totalStock === 18);
  check('…kept with the line, so a void puts back exactly that', o1.stockTaken?.[mealLine.lineId]?.items?.fries === 1 && o1.stockTaken?.[mealLine.lineId]?.items?.tea === 1 && o1.stockTaken?.[mealLine.lineId]?.parts?.bun === 1, o1.stockTaken);
  r = await P({ action: 'paid', channel: 'counter', orderId: c1.orderId, method: 'cash', tendered: 40 });
  check('paid at the counter in cash, with the change', r.body.ok && Math.abs(r.body.change - (40 - o1.total)) < 0.001 && (await get(`${T}/driveThruCars/${c1.carId}`)).stage === 'pickup', r.body);
  for (const t of tix) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'ready' }, { merge: true });
  lane = (await P({ action: 'lane', channel: 'counter' })).body;
  check('…waiting until it’s ready: the counter sees it’s ready', lane.orders[c1.orderId]?.kitchen === 'ready' && lane.cars.find((c: any) => c.id === c1.carId)?.calledAt === null);
  r = await P({ action: 'call', channel: 'counter', carId: c1.carId });
  await P({ action: 'call', channel: 'counter', carId: c1.carId });
  lane = (await P({ action: 'lane', channel: 'counter' })).body; const called = lane.cars.find((c: any) => c.id === c1.carId);
  check('called out: when, and how many times, on every counter screen', r.body.ok && typeof called?.calledAt === 'string' && called?.calls === 2 && (await get(`${T}/driveThruCars/${c1.carId}`)).calledBy === 'Ana Ruiz', called);
  r = await P({ action: 'move', channel: 'counter', carId: c1.carId, to: 'gone' });
  check('…handed over: off the counter, and the kitchen’s tickets served', r.body.ok && (await get(`${T}/driveThruCars/${c1.carId}`)).stage === 'gone' && (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c1.orderId).every((t: any) => t.status === 'delivered'));
  r = await P({ action: 'call', channel: 'counter', carId: c1.carId });
  check('…and can’t be called again once it’s gone', !r.body.ok && r.status === 404);

  console.log('the counter and the drive-thru kept apart');
  manager = true;
  const { POST: kitchenApi } = await import('../../src/app/api/kitchen/route');
  const lkey = (await kitchenApi(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const bkey = (await kitchenApi(req({ action: 'pair', tenantId: 't1', name: 'Order board', kind: 'drive-thru-board' }))).body.key;
  manager = false;
  r = await POST(req({ tenantId: 't1', key: bkey, action: 'board' }));
  check('the order board by the speaker never shows a guest at the counter (the newest at the speaker is C2, at the counter)', r.body.ok && r.body.order?.number !== 'C2', r.body.order);
  r = await POST(req({ tenantId: 't1', key: lkey, action: 'add', orderId: c2.orderId, itemId: 'fries', tapKey: 'x1' }));
  check('a drive-thru screen can’t change a counter order', r.status === 409 && /counter’s/.test(r.body.error), r.body);
  r = await P({ action: 'add', orderId: b1.orderId, itemId: 'fries', tapKey: 'x2', channel: 'counter' });
  check('…nor the counter a car', r.status === 409 && /drive-thru’s/.test(r.body.error), r.body);
  r = await P({ action: 'add', carId: c2.carId, orderId: b1.orderId, itemId: 'fries', tapKey: 'x3', channel: 'counter' });
  check('…even carrying one of its own guests beside the car’s order', r.status === 409 && /drive-thru’s/.test(r.body.error), r.body);
  const vr = src('src/app/api/counter/voice/route.ts'), cr = src('src/app/api/counter/route.ts');
  check('…the windows and the voice assistant see only the drive-thru’s cars', /c\.inLine !== true && atDriveThru\(c\)( && \(!myLane \|\| laneOf\(c\) === myLane\))?\)\.sort/.test(vr) && /if \(!atDriveThru\(car\)\) return/.test(vr) && /\.filter\(atDriveThru\), Date\.now\(\), carId\)/.test(vr)
    && /c\.inLine !== true && atDriveThru\(c\)\)\s*\n?\s*\.sort/.test(cr) && /ageOf\(c\.goneAt\) < 8000 && atDriveThru\(c\)/.test(cr));

  console.log('a combo voided');
  await P({ action: 'add', channel: 'counter', orderId: c2.orderId, itemId: 'meal', choices: { side: ['s'], drink: ['t'] }, tapKey: 't4' });
  await P({ action: 'add', channel: 'counter', orderId: c2.orderId, itemId: 'meal', choices: { side: ['f'], drink: ['t'] }, tapKey: 't5' });
  r = await P({ action: 'send', channel: 'counter', orderId: c2.orderId });
  const o2 = await get(`${T}/counterOrders/${c2.orderId}`); const [mA, mB] = o2.lines;
  check('…a salad meal costs a dollar more, and takes a salad', Math.abs(mA.unitPrice - 14.5) < 0.001 && (await get(`${T}/inventory/salad`)).totalStock === 9 && (await get(`${T}/inventory/fries`)).totalStock === 38 && (await get(`${T}/inventory/tea`)).totalStock === 27, o2.lines);
  // The kitchen started the second meal's burger: that line was made; the first goes back whole.
  await db.doc(`${T}/kdsTickets/${c2.orderId}_${mB.lineId}_0`).set({ status: 'in_progress' }, { merge: true });
  r = await P({ action: 'void', channel: 'counter', orderId: c2.orderId, reason: 'Left' });
  const t2 = async (id: string) => (await get(`${T}/inventory/${id}`)).totalStock;
  check('a void puts back the combo the kitchen never started, part by part (the salad, its tea, its bun)', r.body.ok && (await t2('salad')) === 10 && r.body.returned === 1, { b: r.body, salad: await t2('salad') });
  check('…and of the one the kitchen started on, only the part it started stays taken (the burger’s bun); its fries and tea go back', (await t2('fries')) === 39 && (await t2('tea')) === 29 && (await t2('bun')) === 98 && r.body.wasted === 1, { fries: await t2('fries'), tea: await t2('tea'), bun: await t2('bun'), b: r.body });
  check('…the waste booked to the part that was made, not the combo', JSON.stringify((await get(`${T}/counterOrders/${c2.orderId}`)).wastedItems) === JSON.stringify({ burger: 1 }), (await get(`${T}/counterOrders/${c2.orderId}`)).wastedItems);
  check('…what each part took is kept part by part at sending', o2.stockTaken?.[mB.lineId]?.byPart?.['1']?.items?.fries === 1 && o2.stockTaken?.[mB.lineId]?.byPart?.['0']?.parts?.bun === 1 && o2.stockTaken?.[mB.lineId]?.byPart?.['0']?.item === 'burger', o2.stockTaken?.[mB.lineId]);

  lane = (await P({ action: 'lane', channel: 'counter' })).body;
  check('a combo needs no count of its own: on the menu while its parts can be made', lane.menu.find((x: any) => x.id === 'meal')?.inStock === true);
  await db.doc(`${T}/inventory/burger`).set({ soldOut: true }, { merge: true }); await db.doc(`${T}/inventory/salad`).set({ totalStock: 0 }, { merge: true });
  lane = (await P({ action: 'lane', channel: 'counter' })).body; const mealNow = lane.menu.find((x: any) => x.id === 'meal');
  check('…a part it always has sold out: the combo says so', mealNow?.inStock === false && mealNow?.short === 'Burger', mealNow && { i: mealNow.inStock, s: mealNow.short });
  const sides = mealNow?.choices.find((g: any) => g.id === 'side')?.options || [];
  check('…a choice of an item that’s run out shows as sold out; the rest don’t', sides.find((o: any) => o.id === 's')?.soldOut === true && sides.find((o: any) => o.id === 'f')?.soldOut === false, sides);
  await db.doc(`${T}/inventory/burger`).set({ soldOut: false }, { merge: true }); await db.doc(`${T}/inventory/salad`).set({ totalStock: 10 }, { merge: true });

  console.log('the Menu page');
  manager = true;
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  r = await menuApi(req({ tenantId: 't1', action: 'times', dayparts: [{ id: 'b', name: 'Breakfast', from: '07:00', to: '11:00' }, { id: 'd', name: '', from: '17:00', to: '22:00' }], happyHour: { on: true, days: [5], from: '16:00', to: '18:00' } }));
  check('a menu by time without a name is said, not dropped quietly', r.status === 400);
  r = await menuApi(req({ tenantId: 't1', action: 'times', dayparts: [{ id: 'b', name: 'Breakfast', from: '07:00', to: '11:00' }, { id: 'd', name: 'Dinner', from: '17:00', to: '22:00' }], happyHour: { on: true, days: [5, 9, 1], from: '16:00', to: '18:00' } }));
  const tdoc = await get(T);
  check('menus by time and happy hour saved by a manager (days kept clean)', r.body.ok && tdoc.menuSettings.dayparts.length === 2 && tdoc.menuSettings.happyHour.days.join() === '1,5' && tdoc.menuSettings.happyHour.on === true, tdoc.menuSettings);
  r = await menuApi(req({ tenantId: 't1', action: 'list' }));
  check('…and read back on the Menu page', r.body.ok && r.body.times.dayparts.map((d: any) => d.id).join() === 'b,d' && r.body.times.happyHour.on === true);
  manager = false;
  r = await menuApi(req({ tenantId: 't1', action: 'times', dayparts: [], happyHour: { on: false } }));
  check('…only a manager sets them', r.status === 403);
  manager = true;
  const save = (x: any) => menuApi(req({ tenantId: 't1', action: 'save', itemId: x.id, item: x }));
  r = await save({ id: 'fries', name: 'Fries', section: 'Sides', price: 4, dayparts: ['b', 'nope'] });
  check('an item’s menus by time: only the business’s own', r.status === 400);
  r = await save({ id: 'fries', name: 'Fries', section: 'Sides', price: 4, dayparts: ['d', 'd'], happyPrice: 3 });
  const fr = await get(`${T}/inventory/fries`);
  check('…saved with its happy-hour price', r.body.ok && fr.dayparts.join() === 'd' && fr.happyPrice === 3, { b: r.body, fr: { d: fr.dayparts, h: fr.happyPrice } });
  r = await save({ id: 'fries', name: 'Fries', section: 'Sides', price: 4, happyPrice: 4 });
  check('a happy-hour price at or above the price is said', r.status === 400 && /happy-hour price/.test(r.body.error));
  r = await save({ id: 'fries', name: 'Fries', section: 'Sides', price: 4, happyPrice: '' });
  check('…and cleared when left empty', r.body.ok && (await get(`${T}/inventory/fries`)).happyPrice === null);
  r = await save({ id: 'meal', name: 'Burger meal', section: 'Food', price: 13.5, combo: true, comboParts: [] });
  check('a combo with nothing in it is said', r.status === 400 && /combo needs/.test(r.body.error), r.body);
  r = await save({ id: 'meal', name: 'Burger meal', section: 'Food', price: 13.5, combo: true, comboParts: ['burger', 'meal'], choices: [{ id: 'side', name: 'Side', pick: 'one', required: true, options: [{ id: 'f', name: 'Fries', price: 0, itemId: 'fries' }] }] });
  const ml = await get(`${T}/inventory/meal`);
  check('…saved with what it always has (never itself) and its choice of items', r.body.ok && ml.combo === true && ml.comboParts.map((p: any) => p.itemId).join() === 'burger' && ml.choices[0].options[0].itemId === 'fries', { b: r.body, ml: { p: ml.comboParts, c: ml.choices } });
  r = await save({ id: 'meal', name: 'Burger meal', section: 'Food', price: 13.5, combo: true, comboParts: ['burger'], choices: [{ id: 'side', name: 'Side', pick: 'one', required: true, options: [{ id: 'm', name: 'Another', price: 0, itemId: 'meal' }] }] });
  check('…a combo can’t have itself in a choice', r.status === 400 && /itself/.test(r.body.error));
  await db.doc(`${T}/inventory/deal`).set({ type: 'refreshment', name: 'Family deal', category: 'Food', price: 30, totalStock: 0 });
  r = await save({ id: 'deal', name: 'Family deal', section: 'Food', price: 30, combo: true, comboParts: ['meal', 'fries'] });
  check('…nor another combo as a part (its parts are what’s made)', r.status === 400 && /Burger meal is a combo itself/.test(r.body.error), r.body);
  r = await save({ id: 'deal', name: 'Family deal', section: 'Food', price: 30, combo: true, comboParts: ['ghost'] });
  check('…nor something that isn’t on the menu', r.status === 400 && /isn’t on the menu any more/.test(r.body.error), r.body);

  console.log('checkout keeps a table’s happy-hour price');
  const CO = await import('../../src/app/api/checkout/complete/route');
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  await db.doc(T).set({ modules: { hospitality: true }, menuSettings: { happyHour: { on: true, days: allDays, from: hh(H - 1), to: hh(H + 1) } } }, { merge: true });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez' });
  await db.doc(`${T}/inventory/red`).set({ msrp: 9 }, { merge: true });   // (what the desk sells it for)
  // Each check its own table (a table is checked out once).
  const tabLn = (v: string, lineId: string, o: any = {}) => ({ lineId, itemId: 'red', itemType: 'product', name: 'House red', price: 6, listPrice: 6, quantity: 1, at: new Date().toISOString(), by: 'Ana', kdsId: `tab_${v}_${lineId}`, happy: true, ...o });
  const tix9 = async (v: string, lineId: string) => db.doc(`${T}/kdsTickets/tab_${v}_${lineId}`).set({ id: `tab_${v}_${lineId}`, source: 'tab', visitId: v, lineId, menuItemId: 'red', status: 'delivered' });
  const table9 = (v: string, tab: any[]) => db.doc(`${T}/appointments/${v}`).set({ isTable: true, tableName: `Table ${v}`, clientId: 'c1', clientName: 'Marsh', status: 'servicing', source: 'host', partyId: `p_${v}`, tab });
  const pay9 = (v: string, lineId: string) => CO.POST(req({ tenantId: 't1', clientId: 'c1', appointmentIds: [v], items: [{ id: `red~tab~${lineId}`, itemId: 'red', tabLineId: lineId, tabVisitId: v, type: 'product', quantity: 1, price: 6, name: 'House red' }], payment: { method: 'cash', amountTendered: 50 } }));
  await tix9('v9', 'a'); await table9('v9', [tabLn('v9', 'a')]);
  r = await pay9('v9', 'a');
  check('a table’s line rung in during happy hour is charged its happy-hour price at checkout', r.status === 200 && Math.abs(Number(r.body.subtotal ?? r.body.total) - (r.body.subtotal !== undefined ? 6 : 6.6)) < 0.011, { s: r.status, b: r.body });
  // Happy hour was earlier tonight; this line says it was rung in then, but its kitchen ticket was made just now.
  const ago3 = new Date(Date.now() - 3 * 3600000).toISOString();
  await db.doc(T).set({ menuSettings: { happyHour: { on: true, days: allDays, from: hh(H - 4), to: hh(H - 2) } } }, { merge: true });
  await tix9('v10', 'b'); await table9('v10', [tabLn('v10', 'b', { at: ago3 })]);
  r = await pay9('v10', 'b'); const rb = r.body;
  // …or one pointing at another table’s ticket from happy hour.
  await table9('v11', [tabLn('v11', 'c', { at: ago3, kdsId: 'tab_v9_a' })]);
  r = await pay9('v11', 'c'); const rcBody = r.body;
  check('…a line that only says it was rung in during happy hour (the time on it is the tablet’s) is charged its price: the database’s own clock decides', Math.abs(Number(rb.subtotal ?? rb.total) - (rb.subtotal !== undefined ? 9 : 9.9)) < 0.011 && Math.abs(Number(rcBody.subtotal ?? rcBody.total) - (rcBody.subtotal !== undefined ? 9 : 9.9)) < 0.011, { rb, rcBody });
  r = await CO.POST(req({ tenantId: 't1', clientId: 'c1', items: [{ id: 'meal', type: 'product', quantity: 1, price: 13.5, name: 'Burger meal' }], payment: { method: 'cash', amountTendered: 50 } }));
  check('a combo isn’t rung up at the desk as one item', r.status === 409 && /is a combo/.test(r.body.error), r.body);
  await db.doc(`${T}/inventory/stew`).set({ dayparts: ['later'] }, { merge: true });
  await db.doc(T).set({ menuSettings: { dayparts: [{ id: 'later', name: 'Supper', from: hh(H + 3), to: hh(H + 4) }] } }, { merge: true });
  r = await CO.POST(req({ tenantId: 't1', clientId: 'c1', items: [{ id: 'stew', type: 'product', quantity: 1, price: 12, name: 'Stew' }], payment: { method: 'cash', amountTendered: 50 } }));
  check('…nor an item outside its menus by time of day', r.status === 409 && /isn’t on now: Supper/.test(r.body.error), r.body);
  check('…the desk’s list leaves combos out, and the guest lounge offers neither a combo nor an item off its menu by time', /\(i as any\)\.combo !== true/.test(src('src/components/pos/PosCatalog.tsx'))
    && /i\.combo !== true && servedNow\(i, tenantDoc\)\.ok/.test(src('src/app/api/guest-lounge/route.ts')) && /offeredOnMenu\(item\) \|\| item\.combo === true/.test(src('src/app/api/guest-lounge/route.ts')) && /const on = servedNow\(item, tenant\)/.test(src('src/app/api/guest-lounge/route.ts')));
  const co = src('src/app/api/checkout/complete/route.ts');
  check('…a sale at the desk is priced as it is now', /p\.type === 'refreshment'\) price = priceNow\(\{ \.\.\.p, price \}, tenant\)\.price/.test(co) && /rungInAt/.test(co));
  const tt = src('src/components/host/TableTab.tsx'), tab = src('src/lib/table-tab.ts');
  check('…the table’s tab rings an item in at its price now, marked when it’s happy hour, and refuses one off its menu by time', /servedNow\(/.test(tt) && /priceNow\(/.test(tt) && /happy: pn\.happy/.test(tt) && /item\.happy \? \{ happy: true \}/.test(tab));
  check('…combos are for the counter and the drive-thru, not a table’s tab', /!prods\.find\(\(p: any\) => p\.id === x\.id\)\?\.combo/.test(tt));

  console.log('the counter page');
  const cp = src('src/app/(app)/counter/page.tsx');
  check('the counter page asks the server for everything, as counter orders', /send\('\/api\/counter', \{ tenantId, channel: 'counter', \.\.\.body \}/.test(cp) && !/firebase\/firestore/.test(cp));
  check('…Next guest, the menu with happy-hour prices and when the rest is back, and the order with a first name', /Next guest/.test(cp) && /m\.off \|\| outWords\(m\)/.test(cp) && /<s>\{usd\(fullOf\(m\)\)\}<\/s>/.test(cp) && /First name, for calling it out/.test(cp));
  check('…send and take payment: cash with the change, or the card reader', /Send and take payment/.test(cp) && /Change: \{usd\(tendered - order\.total\)\}/.test(cp) && /action: 'card', orderId: order\.id, readerId: reader\.id/.test(cp));
  check('…Waiting: Call says it out loud and marks it called; Handed over takes it off', /new SpeechSynthesisUtterance/.test(cp) && /action: 'call', carId: g\.id/.test(cp) && /action: 'move', carId: g\.id, to: 'gone'/.test(cp) && /Called \$\{minsAgo/.test(cp));
  check('…keeps the writing rules', !/uppercase|font-black|\{\/\*/.test(cp) && !/ · /.test(cp) && /min-h-\[44px\]/.test(cp));
  const J = await import('../../src/lib/jobs');
  check('the counter job opens on the counter (the front desk a tap away), in the app’s pages and the team app', J.jobDef('counter')?.home === '/counter' && !!J.jobDef('counter')?.menu.includes('/pos') && /'counter'/.test(src('src/lib/app-theme.ts')) && /hospitality: \{[^}]*'\/counter'/.test(src('src/lib/modules.ts'))
    && /href: '\/counter'/.test(src('src/components/shared/AppSidebar.tsx')) && /'\/bar-tabs', '\/counter', '\/curbside'\]/.test(src('src/components/shared/PortalScope.tsx')) && /href: '\/counter'/.test(src('src/components/portal/FloorLinks.tsx')));
  const lp = src('src/app/drive-thru/[tenantId]/page.tsx');
  check('the drive-thru lane shows happy-hour prices and when an item is back too', /const why = m\.off \|\| outWords\(m\)/.test(lp) && /usd\(priceOf\(m\)\)/.test(lp));

  console.log('the kitchen, dish and barback screens in Spanish');
  const L = await import('../../src/lib/screen-lang');
  check('English unless Spanish is picked, kept on the device', L.cleanLang('es') === 'es' && L.cleanLang('fr') === 'en' && L.cleanLang(null) === 'en' && L.tr('en', 'Ready') === 'Ready' && L.tr('es', 'Ready') === 'Listo');
  check('…the words filled in, in either', L.tr('es', '{n} tickets up', { n: 4 }) === '4 comandas en pantalla' && L.tr('en', '{n} tickets up', { n: 4 }) === '4 tickets up' && L.tr('es', 'Mark {n} ready', { n: 3 }) === 'Marcar 3 listos');
  check('…what another part puts together: the clock, when to start, who’s on the way', L.tr('es', '2:05 over') === '2:05 tarde' && L.tr('es', '0:45 left') === 'quedan 0:45' && L.tr('es', 'in 4 min') === 'en 4 min' && L.tr('es', 'Sam’s on the way') === 'Sam va en camino' && L.tr('es', 'Waiting, 3 min') === 'Esperando, 3 min');
  check('…what the business wrote stays as it is (a dish, a station)', L.tr('es', 'Smash burger') === 'Smash burger' && L.tr('es', 'Grill') === 'Grill');
  check('…an allergy in Spanish with the English beside it, never in place of it', L.tr('es', 'Sesame') === 'Ajonjolí (sesame)' && L.tr('es', 'Tree nuts') === 'Frutos secos (tree nuts)' && /say\(a\.name\)/.test(src('src/app/kds/[tenantId]/page.tsx')) && /say\(a\.name\)/.test(src('src/components/kitchen/ExpoView.tsx')));
  check('…a call’s kind in Spanish, the words that came with it as written', L.tr('es', 'Ice, well 2') === 'Hielo, well 2' && L.tr('es', 'Glasses') === 'Vasos' && L.tr('es', 'Dinner plates to the pass') === 'Dinner plates to the pass');
  check('…orders, tables and courses said in it too', L.tr('es', 'Drive-thru B38') === 'Autoservicio B38' && L.tr('es', 'Dana Wu, Table 3, seat 1') === 'Dana Wu, mesa 3, asiento 1' && L.tr('es', 'Spring dinner, course 1') === 'Spring dinner, tiempo 1');
  const kds = src('src/app/kds/[tenantId]/page.tsx'), dish = src('src/app/dish/[tenantId]/page.tsx'), bb = src('src/app/barback/[tenantId]/page.tsx');
  const sayWords = (s: string) => Array.from(s.matchAll(/say\('((?:[^'\\]|\\.)*)'/g)).map((x) => x[1]);
  const kitWords = [kds, dish, bb, src('src/components/kitchen/ExpoView.tsx'), src('src/components/kitchen/CallSheet.tsx'), src('src/components/kitchen/ClosingSheet.tsx'), src('src/components/back/CallList.tsx'), src('src/components/back/screen-kit.tsx'), src('src/components/kitchen/PinPad.tsx'), src('src/components/kitchen/SafetySheet.tsx')].flatMap(sayWords);
  const missing = Array.from(new Set(kitWords.filter((w) => !L.hasSpanish(w))));
  check('every word those screens say through the toggle has its Spanish', kitWords.length > 150 && missing.length === 0, { count: kitWords.length, missing });
  const { CALL_KINDS, TO_WORD } = await import('../../src/lib/back-calls'); const { BREAK_KINDS } = await import('../../src/lib/dish');
  const lists = [...Object.values(CALL_KINDS).flat().filter((k: any) => k.id !== 'run').map((k: any) => k.label), ...Object.values(TO_WORD), ...BREAK_KINDS.map((k) => k.label), 'Lanes', 'By order', 'By course', 'By dish', 'Expo', 'Drive-thru', 'Counter', 'Kiosk', 'Ordered ahead', 'Lounge', 'Table', 'Desk', 'Event', 'Order', 'Out', 'The last of it', 'Get the next one ready', 'the kitchen and bar', 'the kitchen or bar', 'the dish pit', 'the bar', 'Bar', 'Dish', 'Kitchen', 'Anyone'];
  check('…and so do the calls, the breakages, the views and the kinds of order', lists.every((w) => L.hasSpanish(w)), lists.filter((w) => !L.hasSpanish(w)));
  check('the toggle on each screen’s header, the screen inside it', [kds, dish, bb].every((s) => /<LangToggle \/>/.test(s) && /<ScreenLangProvider>/.test(s)));
  const sl = src('src/components/kitchen/ScreenLang.tsx');
  check('…kept on the device, the page’s language said for screen readers, each button 44px', /localStorage\.setItem\(LANG_KEY, l\)/.test(sl) && /lang=\{lang\}/.test(sl) && /aria-pressed=\{lang === l\.id\}/.test(sl) && /min-h-\[44px\]/.test(sl));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
