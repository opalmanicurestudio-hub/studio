// Checks hot food delivered by the business's own drivers (design board "Hot food delivery"; lib/food-delivery,
// lib/food-delivery-server, lib/counter-ahead delivery, api/menu 'ahead', api/counter/ahead 'deliveryCheck', api/counter
// deliveryOut / deliveryDone / deliveryFailed, lib/ready-text "on its way").
// - Turned on by a manager only once the business's delivery zones are set up; the longest drive is one of the choices.
// - The guest's address: checked against the zones (the fee, a minimum), no farther than hot food goes; arrival times
//   are the pickup times plus the drive.
// - Placing: a phone for the driver; the fee worked out on the server, never the page; on its own line with no tax on
//   it; the kitchen makes it to be ready when the driver leaves; booked as delivery charged, apart from food sales.
// - The guest's page: where to (no ZIP, note or phone), about when, how it's going.
// - The counter: today's deliveries, ready ones first; out with a driver (the kitchen's tickets bagged, the order done,
//   the guest's one text "on its way"), delivered, or couldn't be and why, then sent again. Only at the counter.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/food-delivery.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '+18325550100';
const db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const texts: { to: string; body: string }[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('twilio')) { const p = new URLSearchParams(String(init?.body || '')); texts.push({ to: String(p.get('To')), body: String(p.get('Body')) }); }
  return { ok: true, status: 201, json: async () => ({ sid: `SM${texts.length}` }) };
};

const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), n: 0 };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, status: 'requires_payment_method', metadata: { ...p.metadata }, amount_received: 0, client_secret: `${id}_secret`, account: o?.stripeAccount };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); return clone(pi);
    },
    retrieve: async (id: string) => clone(S.pis.get(id)),
    cancel: async (id: string) => { const pi = S.pis.get(id); pi.status = 'canceled'; return clone(pi); },
  };
  refunds = { create: async (p: any) => ({ id: 're_1', status: 'succeeded', amount: p.amount }) };
}
const paid = (piId: string) => { const pi = S.pis.get(piId); pi.status = 'succeeded'; pi.amount_received = pi.amount; };

const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  if (request === '@/lib/geocode-server' || /\/src\/lib\/geocode-server(\.ts)?$/.test(request)) {
    const real = load.call(this, request, ...rest);
    return fake(request, { ...real, hasMapsKey: () => true, geocode: async () => ({ lat: 39.95, lng: -75.0, label: '412 Elm St', postal: '08077', confidence: 'exact' }) });
  }
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const PLAN = { on: true, by: 'postal', zones: [{ id: 'near', name: 'Near', postalCodes: ['08077'], feeCents: 399, minimumCents: 1000, freeOverCents: 6000 }], days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: '08:00', end: '22:00' }] };

(async () => {
  const F = await import('../../src/lib/food-delivery');
  const FS = await import('../../src/lib/food-delivery-server');
  const { POST: AHEAD } = await import('../../src/app/api/counter/ahead/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const R = await import('../../src/lib/ready-text');

  console.log('the rules');
  check('the drive from the miles: a few minutes to get going, then about 2.5 a mile; a ZIP zone takes a usual drive', F.driveMinutes(0) === 5 && F.driveMinutes(3) === 12 && F.driveMinutes(null) === 15 && F.driveMinutes(-1) === 15);
  const ca = F.cleanAddress({ line1: '  412   Elm St ', line2: 'Apt 3', city: 'Riverton', state: 'nj', postalCode: '08077' });
  check('an address tidied, and one missing a part (or a ZIP that isn’t one) is refused', ca?.line1 === '412 Elm St' && ca?.state === 'NJ' && F.cleanAddress({ line1: '1 A St', city: 'X', state: 'NJ' }) === null && F.cleanAddress({ line1: '1 A St', city: 'X', state: 'NJ', postalCode: '8077' }) === null);
  check('one line for the counter and the guest’s page (no ZIP)', F.addressLine(ca) === '412 Elm St, Apt 3, Riverton');
  check('arrival times: the pickup time plus the drive, to the next 5 minutes', JSON.stringify(F.arrivalTimes(['2026-01-01T18:00:00.000Z'], 12)) === JSON.stringify([{ at: '2026-01-01T18:00:00.000Z', arrive: '2026-01-01T18:15:00.000Z' }]));
  const wf = F.withDeliveryFee({ subtotal: 10, tax: 1, total: 11 }, 399);
  check('the fee on its own line, in the total, the tax as it was', wf.deliveryFee === 3.99 && wf.total === 14.99 && wf.tax === 1 && wf.subtotal === 10);
  check('the steps: being made, ready (waiting on a driver), out, delivered, couldn’t be', F.deliveryStep(null, 'making') === 'making' && F.deliveryStep({ state: 'waiting' }, 'ready') === 'ready' && F.deliveryStep({ state: 'out' }, 'making') === 'out' && F.deliveryStep({ state: 'failed' }, 'ready') === 'failed');
  check('the longest drive is one of the choices (15 otherwise)', F.foodDeliveryOf({ orderAhead: { delivery: true, deliveryMaxMin: 99 } }).maxDriveMin === 15 && F.foodDeliveryOf({ orderAhead: { delivery: true, deliveryMaxMin: 20 } }).maxDriveMin === 20 && F.foodDeliveryOf({}).on === false);

  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, publicOrigin: 'https://app.test' });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Burgers', price: 5, totalStock: 50, makeSeconds: 240 });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 3, totalStock: 50, makeSeconds: 60 });
  const A = (b: any) => AHEAD(req({ tenantId: 't1', ...b }));
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b }));
  const C = (b: any) => LANE(req({ tenantId: 't1', channel: 'counter', ...b }));
  let k = 0; const nextKey = () => `keykeykey${++k}`;

  console.log('turning it on');
  let r: any = await Mn({ action: 'ahead', on: true });
  check('order ahead on', r.body.ok && r.body.ahead.on === true && r.body.ahead.delivery === false && r.body.ahead.deliveryReady === false, r.body);
  r = await Mn({ action: 'ahead', delivery: true });
  check('delivery needs the business’s delivery zones set up first (Orders, Delivery)', r.status === 409 && /Set up delivery first/.test(r.body.error), r.body);
  await db.doc(T).set({ retailSettings: { taxRatePercent: 10, deliveryPlan: PLAN } }, { merge: true });
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  r = await Mn({ action: 'ahead', delivery: true });
  check('only a manager turns it on', r.status === 403, r.body);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  r = await Mn({ action: 'ahead', deliveryMaxMin: 25 });
  check('the longest drive is one of 10, 15, 20 or 30 minutes', r.status === 400, r.body);
  r = await Mn({ action: 'ahead', delivery: true, deliveryMaxMin: 20 });
  check('on, with the longest drive for hot food', r.body.ok && r.body.ahead.delivery === true && r.body.ahead.deliveryMaxMin === 20 && r.body.ahead.deliveryReady === true, r.body);
  r = await Mn({ action: 'ahead', driveThru: false, inside: false });
  check('delivery counts as a way to get it (pickup can be off)', r.body.ok && r.body.ahead.driveThru === false && r.body.ahead.inside === false, r.body);
  await Mn({ action: 'ahead', driveThru: true, inside: true });

  console.log('the guest’s address');
  r = await A({ action: 'menu' });
  check('the guest’s page offers delivery', r.body.ok && r.body.ways.includes('delivery'), r.body.ways);
  const lines = [{ itemId: 'burger', quantity: 2 }, { itemId: 'fries', quantity: 1 }];
  const addr = { line1: '412 Elm St', line2: 'Apt 3', city: 'Riverton', state: 'NJ', postalCode: '08077' };
  r = await A({ action: 'deliveryCheck', address: { ...addr, postalCode: '' }, lines });
  const out1: any = await A({ action: 'deliveryCheck', address: { ...addr, postalCode: '10001' }, lines });
  const small: any = await A({ action: 'deliveryCheck', address: addr, lines: [{ itemId: 'burger', quantity: 1 }] });
  check('a part missing, outside the zones, or under the zone’s minimum: said', r.status === 400 && r.body.code === 'address' && out1.status === 409 && out1.body.code === 'delivery_outside' && small.status === 409 && small.body.code === 'delivery_minimum' && /\$10\.00/.test(small.body.error), { r: r.body, out1: out1.body, small: small.body });
  r = await A({ action: 'deliveryCheck', address: addr, lines });
  const times: any[] = r.body.times || [];
  check('we deliver there: the zone’s fee and the drive', r.body.ok && r.body.feeCents === 399 && r.body.free === false && r.body.driveMin === 15, r.body);
  check('…its arrival times are the pickup times plus the drive', times.every((t: any) => Date.parse(t.arrive) - Date.parse(t.at) >= 15 * 60000 && Date.parse(t.arrive) - Date.parse(t.at) < 20 * 60000 && Date.parse(t.arrive) % 300000 === 0), times.slice(0, 3));
  check('…and about when it’d get there as soon as it’s ready', !!r.body.asapArrive && Date.parse(r.body.asapArrive) > Date.now() + 15 * 60000, r.body.asapArrive);
  await Mn({ action: 'ahead', deliveryMaxMin: 10 });
  r = await A({ action: 'deliveryCheck', address: addr, lines });
  check('zones by ZIP code: the zones are how far it goes (no drive limit on top)', r.body.ok && r.body.driveMin === 15, r.body);
  r = await Mn({ action: 'list' });
  check('…and the Menu page says so', r.body.ahead?.deliveryByZip === true, r.body.ahead);
  // Zones by distance (measured from the business on the map): 3.5 miles is about a 13-minute drive.
  await db.doc(T).set({ retailSettings: { taxRatePercent: 10, deliveryPlan: { ...PLAN, by: 'distance', origin: { lat: 39.9, lng: -75.0, label: 'Northside' }, zones: [{ id: 'near', name: 'Near', upToMiles: 5, feeCents: 399, minimumCents: 1000 }] } } }, { merge: true });
  r = await A({ action: 'deliveryCheck', address: addr, lines });
  check('farther than hot food goes: turned away, with pickup offered', r.status === 409 && r.body.code === 'too_far' && /about a 13-minute drive/.test(r.body.error) && /Pick it up instead/.test(r.body.error), r.body);
  await Mn({ action: 'ahead', deliveryMaxMin: 20 });
  r = await A({ action: 'deliveryCheck', address: addr, lines });
  check('…within it: the drive from the miles', r.body.ok && r.body.driveMin === 13 && r.body.feeCents === 399, r.body);
  await db.doc(T).set({ retailSettings: { taxRatePercent: 10, deliveryPlan: PLAN } }, { merge: true });

  console.log('placing');
  const base = { action: 'place', name: 'Maya', way: 'delivery', lines, address: addr, note: 'Side door, gate code 1234' };
  r = await A({ ...base, key: nextKey() });
  const noAddr: any = await A({ ...base, key: nextKey(), address: { line1: '412 Elm St' }, phone: '8325550142' });
  check('a phone for the driver, and the whole address, are needed', r.status === 400 && r.body.code === 'phone' && noAddr.status === 400 && noAddr.body.code === 'address', { r: r.body, noAddr: noAddr.body });
  r = await A({ ...base, key: nextKey(), phone: '8325550142', deliveryFee: 0, feeCents: 0, total: 1 });
  const id1 = r.body.orderId; const s1 = r.body.sig;
  const o1 = await get(`${T}/counterOrders/${id1}`); const pi1 = S.pis.get(o1?.ahead?.payId);
  check('placed: the fee from the zones (never the page), on its own line with no tax on it', r.body.ok && o1.subtotal === 13 && o1.tax === 1.3 && o1.deliveryFee === 3.99 && o1.total === 18.29 && pi1.amount === 1829 && r.body.total === 18.29 && r.body.deliveryFee === 3.99, { body: r.body, o1 });
  const d1 = o1.ahead.delivery;
  check('…where to, the driver’s note and phone, the drive, and due at the door the drive after it’s ready', d1.address.line1 === '412 Elm St' && d1.note === 'Side door, gate code 1234' && d1.phone === '8325550142' && d1.feeCents === 399 && d1.driveMin === 15 && d1.state === 'waiting'
    && Date.parse(d1.arriveAt) - Date.parse(o1.ahead.slot) === 15 * 60000, d1);
  paid(pi1.id);
  r = await A({ action: 'done', o: id1, s: s1 });
  const t1 = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id1);
  check('paid: to the kitchen, its tickets marked as a delivery', r.body.ok && r.body.paid && t1.length === 2 && t1.every((t: any) => t.stationName === `Delivery ${o1.number}`), t1.map((t: any) => t.stationName));
  const sale = await get(`${T}/transactions/counter_${id1}`); const taxT = await get(`${T}/transactions/counter_${id1}_tax`); const feeT = await get(`${T}/transactions/counter_${id1}_delivery`);
  check('…booked: the food as sales, the tax collected, and the fee as delivery charged', sale?.amount === 13 && sale?.category === 'Retail' && taxT?.amount === 1.3 && feeT?.amount === 3.99 && feeT?.category === 'Shipping Charged' && feeT?.taxBucket === 'revenue', { sale, taxT, feeT });
  r = await A({ action: 'track', o: id1, s: s1 });
  const page = JSON.stringify(r.body);
  check('the guest’s page: where to (no ZIP, note or phone), about when, being made, the fee, and no pickup code', r.body.delivery?.to === '412 Elm St, Apt 3, Riverton' && r.body.delivery.arriveAt === d1.arriveAt && r.body.delivery.step === 'making' && r.body.deliveryFee === 3.99 && r.body.code === null
    && !page.includes('08077') && !page.includes('gate code') && !page.includes('8325550142'), r.body.delivery);

  const lkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Speaker', kind: 'drive-thru' }))).body.key;
  r = await LANE(req({ tenantId: 't1', key: lkey, action: 'aheadCar', code: o1.ahead.code }));
  check('its code can’t take it at the drive-thru: it goes out from the counter', r.status === 409 && /goes out from the counter/.test(r.body.error), r.body);

  console.log('a text when it’s on its way');
  r = await A({ ...base, key: nextKey(), name: 'Jordan', phone: '8325550177', textMe: true, note: '' });
  const id2 = r.body.orderId; const s2 = r.body.sig; const o2 = await get(`${T}/counterOrders/${id2}`);
  paid(S.pis.get(o2.ahead.payId).id); await A({ action: 'done', o: id2, s: s2 });
  const t2 = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id2);
  for (const t of t2) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'ready', readyAt: new Date().toISOString() }, { merge: true });
  texts.length = 0;
  await R.textWhenTicketsReady(db, 't1', t2.map((t: any) => t.id));
  check('ready in the kitchen: no text yet (it isn’t on its way)', texts.length === 0 && !!(await get(`${T}/counterOrders/${id2}`)).readyText?.to, texts);

  console.log('the counter');
  r = await C({ action: 'lane' });
  const rows: any[] = r.body.deliveries || [];
  check('today’s deliveries on the counter: ready ones first, then being made, with where to, the note and the phone', r.body.ok && rows.length === 2 && rows[0].orderId === id2 && rows[0].step === 'ready' && rows[1].orderId === id1 && rows[1].step === 'making'
    && rows[1].note === 'Side door, gate code 1234' && rows[1].phone === '8325550142' && rows[1].to === '412 Elm St, Apt 3, Riverton' && rows[1].driveMin === 15, rows);
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  r = await LANE(req({ tenantId: 't1', key, action: 'deliveryOut', orderId: id2 }));
  check('only at the counter, never a lane screen', r.status === 409 && /at the counter/.test(r.body.error), r.body);
  r = await C({ action: 'deliveryOut', orderId: id1 });
  check('not out while it’s still being made (nothing bagged, no text)', r.status === 409 && /still being made/.test(r.body.error) && (await get(`${T}/counterOrders/${id1}`)).ahead.delivery.state === 'waiting' && (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id1).every((t: any) => t.status !== 'delivered'), r.body);
  r = await A({ action: 'here', o: id1, s: s1 });
  check('a delivery has nothing to check in for', r.status === 409 && !(await get(`${T}/counterOrders/${id1}`)).ahead.hereAt, r.body);
  r = await C({ action: 'deliveryDone', orderId: id2 });
  check('not delivered before it’s gone out', r.status === 409, r.body);
  r = await C({ action: 'deliveryOut', orderId: id2, driver: 'Sam Lee' });
  const o2b = await get(`${T}/counterOrders/${id2}`); const t2b = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id2);
  check('out with a driver: done for the kitchen, its tickets bagged', r.body.ok && o2b.status === 'done' && o2b.ahead.delivery.state === 'out' && o2b.ahead.delivery.driverName === 'Sam Lee' && !!o2b.ahead.delivery.outAt && t2b.every((t: any) => t.status === 'delivered'), { o2b: o2b.ahead.delivery, t2b });
  check('…and the guest’s one text: on its way, with their page', texts.length === 1 && texts[0].to === '+18325550177' && /Order A\d+ is on its way\./.test(texts[0].body) && /\/order\/t1\?o=/.test(texts[0].body), texts);
  r = await C({ action: 'deliveryOut', orderId: id2, driver: 'Sam Lee' });
  check('…tapped again: nothing twice', r.body.ok && r.body.already === true && texts.length === 1, r.body);
  r = await A({ action: 'track', o: id2, s: s2 });
  check('the guest’s page: on its way, with the driver’s first name', r.body.delivery?.step === 'out' && r.body.delivery.driver === 'Sam' && !!r.body.delivery.outAt, r.body.delivery);
  r = await C({ action: 'deliveryFailed', orderId: id2, why: 'lost' });
  check('couldn’t deliver needs a reason from the list', r.status === 400, r.body);
  r = await C({ action: 'deliveryFailed', orderId: id2, why: 'no_answer' });
  const rowsF: any[] = await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 5000);
  check('couldn’t deliver: said why, on the counter', r.body.ok && (await get(`${T}/counterOrders/${id2}`)).ahead.delivery.state === 'failed' && rowsF.find((x: any) => x.orderId === id2)?.why === 'No one answered', rowsF);
  r = await C({ action: 'deliveryOut', orderId: id2 });
  check('…sent out again (whoever’s signed in drives)', r.body.ok && !r.body.already && (await get(`${T}/counterOrders/${id2}`)).ahead.delivery.state === 'out' && (await get(`${T}/counterOrders/${id2}`)).ahead.delivery.driverName === 'Ana Ruiz' && texts.length === 1, r.body);
  r = await C({ action: 'deliveryDone', orderId: id2 });
  const rowsD: any[] = await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 10000);
  check('delivered: last on the counter, and its phone isn’t shown any more', r.body.ok && (await get(`${T}/counterOrders/${id2}`)).ahead.delivery.state === 'delivered' && rowsD[rowsD.length - 1].orderId === id2 && rowsD[rowsD.length - 1].step === 'delivered' && rowsD[rowsD.length - 1].phone === null, rowsD);
  r = await A({ action: 'track', o: id2, s: s2 });
  check('the guest’s page: delivered', r.body.delivery?.step === 'delivered' && !!r.body.delivery.deliveredAt, r.body.delivery);

  console.log('turned off');
  await Mn({ action: 'ahead', delivery: false });
  r = await A({ ...base, key: nextKey(), phone: '8325550142' });
  check('off: delivery can’t be picked', r.status === 400 && r.body.code === 'way', r.body);
  r = await A({ action: 'menu' });
  check('…and the guest’s page doesn’t offer it', !r.body.ways.includes('delivery'), r.body.ways);

  console.log('the screens');
  const order = src('src/app/order/[tenantId]/page.tsx'); const card = src('src/components/menu/OrderAheadCard.tsx'); const desk = src('src/components/drive-thru/Deliveries.tsx'); const counter = src('src/app/(app)/counter/page.tsx');
  check('ordering: the address, a note for the driver, checking it, and arrival times', /Check the address/.test(order) && /Notes for the driver/.test(order) && /When it gets to you/.test(order) && /action: 'deliveryCheck'/.test(order) && /autoComplete=\{auto\}/.test(order) && /'address-line1'/.test(order));
  check('…the fee in the totals, and the page after paying follows it', /<span>Delivery<\/span>/.test(order) && /function DeliveryStatus/.test(order) && /Left\$\{D\.driver/.test(order) && /onWay/.test(order));
  check('the Menu page: delivery by our drivers, and the longest drive', /Delivery, by our drivers/.test(card) && /Longest drive for hot food/.test(card) && /\/retail-orders\/policies\/delivery/.test(card));
  check('the counter: deliveries, ready ones to leave now, out, delivered, couldn’t deliver and why', /<Deliveries rows=/.test(counter) && /Out for delivery/.test(desk) && /leave now/.test(desk) && /Couldn’t deliver/.test(desk) && /deliveryFailed/.test(desk) && /What happened\?/.test(desk));
  check('the new screens keep the house style (no all caps, no heaviest weight, 44px taps)', ![order, card, desk].some((s) => /\buppercase\b|font-black/.test(s)) && /min-h-\[44px\]/.test(desk));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
