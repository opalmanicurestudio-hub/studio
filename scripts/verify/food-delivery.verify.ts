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
const texts: { to: string; body: string }[] = []; let smsDown = false;
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('twilio') && smsDown) return { ok: false, status: 500, json: async () => ({ message: 'down' }) };
  if (String(url).includes('twilio')) { const p = new URLSearchParams(String(init?.body || '')); texts.push({ to: String(p.get('To')), body: String(p.get('Body')) }); }
  return { ok: true, status: 201, json: async () => ({ sid: `SM${texts.length}` }) };
};

const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), n: 0, refunds: [] as any[], refundKeys: new Map<string, any>(), failIn: 0 };
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
  // (Card refunds: kept, one per key; `failIn` makes that many-th one from now say no.)
  refunds = { create: async (p: any, o: any) => {
    if (o?.idempotencyKey && S.refundKeys.has(o.idempotencyKey)) return S.refundKeys.get(o.idempotencyKey);
    if (S.failIn > 0 && --S.failIn === 0) throw Object.assign(new Error('The card company said no.'), { type: 'StripeInvalidRequestError' });
    const r = { id: `re_${S.refunds.length + 1}`, status: 'succeeded', amount: p.amount, payment_intent: p.payment_intent }; S.refunds.push(r); if (o?.idempotencyKey) S.refundKeys.set(o.idempotencyKey, r); return r;
  }, list: async () => ({ data: [] }) };
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
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => (actor.uid === 'nobody' ? { ok: false, error: 'Sign in again.', status: 401 } : { ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() || {} }) });
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
  const { POST: RUN } = await import('../../src/app/api/counter/food-run/route');

  console.log('the rules');
  check('the drive from the miles: a few minutes to get going, then about 2.5 a mile; a ZIP zone takes a usual drive', F.driveMinutes(0) === 5 && F.driveMinutes(3) === 12 && F.driveMinutes(null) === 15 && F.driveMinutes(-1) === 15);
  const ca = F.cleanAddress({ line1: '  412   Elm St ', line2: 'Apt 3', city: 'Riverton', state: 'nj', postalCode: '08077' });
  check('an address tidied, and one missing a part (or a ZIP that isn’t one) is refused', ca?.line1 === '412 Elm St' && ca?.state === 'NJ' && F.cleanAddress({ line1: '1 A St', city: 'X', state: 'NJ' }) === null && F.cleanAddress({ line1: '1 A St', city: 'X', state: 'NJ', postalCode: '8077' }) === null);
  check('one line for the counter and the guest’s page (no ZIP)', F.addressLine(ca) === '412 Elm St, Apt 3, Riverton');
  check('arrival times: the pickup time plus the drive, to the next 5 minutes', JSON.stringify(F.arrivalTimes(['2026-01-01T18:00:00.000Z'], 12)) === JSON.stringify([{ at: '2026-01-01T18:00:00.000Z', arrive: '2026-01-01T18:15:00.000Z' }]));
  const wf = F.withDeliveryFee({ subtotal: 10, tax: 1, total: 11 }, 399);
  check('the fee on its own line, in the total, the tax as it was', wf.deliveryFee === 3.99 && wf.total === 14.99 && wf.tax === 1 && wf.subtotal === 10);
  check('the driver’s tip: a percent of the food or an amount up to $100, nothing else', F.tipCentsOf({ pct: 18 }, 1350) === 243 && F.tipCentsOf({ pct: 15 }, 1350) === 203 && F.tipCentsOf({ pct: 17 }, 1350) === -1
    && F.tipCentsOf({ cents: 500 }, 1350) === 500 && F.tipCentsOf({ cents: 20000 }, 1350) === -1 && F.tipCentsOf({ cents: 2.5 }, 1350) === -1 && F.tipCentsOf(null, 1350) === 0 && F.tipCentsOf('5', 1350) === -1);
  const wt = F.withDeliveryFee({ subtotal: 13.5, tax: 1.35, total: 14.85 }, 399, 243);
  check('…in the total, on its own line, with no tax on it', wt.total === 21.27 && wt.tipCents === 243 && wt.tax === 1.35 && wt.deliveryFee === 3.99, wt);
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
  check('…and the guest is texted at once, why, with their page to pick it up or get a refund', texts.length === 2 && texts[1].to === '+18325550177' && /^Northside: Our driver couldn’t get order A\d+ to you \(no one answered\)\. Pick it up, or get a refund: https:\/\/app\.test\/order\/t1\?o=/.test(texts[1].body), texts);
  r = await C({ action: 'deliveryOut', orderId: id2 });
  check('…sent out again (whoever’s signed in drives)', r.body.ok && !r.body.already && (await get(`${T}/counterOrders/${id2}`)).ahead.delivery.state === 'out' && (await get(`${T}/counterOrders/${id2}`)).ahead.delivery.driverName === 'Ana Ruiz' && texts.length === 2, r.body);
  r = await C({ action: 'deliveryDone', orderId: id2 });
  const rowsD: any[] = await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 10000);
  check('delivered: last on the counter, and its phone isn’t shown any more', r.body.ok && (await get(`${T}/counterOrders/${id2}`)).ahead.delivery.state === 'delivered' && rowsD[rowsD.length - 1].orderId === id2 && rowsD[rowsD.length - 1].step === 'delivered' && rowsD[rowsD.length - 1].phone === null, rowsD);
  r = await A({ action: 'track', o: id2, s: s2 });
  check('the guest’s page: delivered', r.body.delivery?.step === 'delivered' && !!r.body.delivery.deliveredAt, r.body.delivery);

  console.log('a tip for the driver');
  await db.doc(`${T}/staff/d1`).set({ name: 'Sam Lee', role: 'staff', isActive: true });
  await db.doc(`${T}/staff/d2`).set({ name: 'Rio Diaz', role: 'staff', isActive: true });
  await db.doc(`${T}/staff/s9`).set({ name: 'Kai Park', role: 'staff', isActive: true });
  await db.doc(T).set({ retailSettings: { taxRatePercent: 10, deliveryPlan: { ...PLAN, drivers: ['d1', 'd2'] } } }, { merge: true });
  r = await A({ ...base, key: nextKey(), phone: '8325550142', tip: { pct: 50 } });
  check('a tip that isn’t one offered is refused', r.status === 400 && r.body.code === 'tip', r.body);
  r = await A({ ...base, key: nextKey(), name: 'Dee', phone: '8325550188', textMe: true, tip: { pct: 18 }, tipCents: 1 });
  const id3 = r.body.orderId; const s3 = r.body.sig; const o3 = await get(`${T}/counterOrders/${id3}`);
  check('placed with an 18% tip of the food: worked out here, in the total, untaxed', r.body.ok && o3.subtotal === 13 && o3.tax === 1.3 && o3.tipCents === 234 && o3.tipFor === 'driver' && o3.total === 20.63 && S.pis.get(o3.ahead.payId).amount === 2063 && r.body.tip === 2.34, { body: r.body, o3 });
  paid(o3.ahead.payId); await A({ action: 'done', o: id3, s: s3 });
  const paidTip = await get(`${T}/transactions/ftip_${id3}`);
  check('…paid: booked as a tip (never sales) with no one on it until it’s delivered, and refundable to the card', paidTip?.category === 'Tips' && paidTip.taxBucket === 'gratuity' && paidTip.amount === 2.34 && paidTip.staffId === null && paidTip.stripePaymentIntentId === o3.ahead.payId
    && (await get(`${T}/transactions/counter_${id3}`))?.amount === 13 && (await get(`${T}/transactions/counter_${id3}_delivery`))?.amount === 3.99, paidTip);
  r = await A({ action: 'track', o: id3, s: s3 });
  check('the guest’s page shows the tip', r.body.tip === 2.34, r.body.tip);

  console.log('the driver’s phone');
  const Run = (b: any) => RUN(req({ tenantId: 't1', ...b }));
  actor = { uid: 's9', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  r = await Run({ action: 'list' });
  check('only the business’s drivers (when it lists them)', r.status === 403 && /one of the drivers/.test(r.body.error), r.body);
  actor = { uid: 'd2', name: 'Rio Diaz', role: 'staff', isManager: false, caps: [], isRenter: true };
  r = await Run({ action: 'list' });
  check('never a renter', r.status === 403, r.body);
  actor = { uid: 'd1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
  await new Promise((res) => setTimeout(res, 3100));   // (the list is read once every few seconds)
  r = await Run({ action: 'list' });
  const mineRow = (r.body.rows || []).find((x: any) => x.orderId === id3);
  check('a driver sees hot food being made, with the tip, and never the guest’s number', r.body.ok && r.body.on && mineRow?.step === 'making' && mineRow.tip === 2.34 && mineRow.phone === null && /08077/.test(mineRow.mapTo) && !(r.body.rows || []).some((x: any) => x.phone), r.body.rows);
  r = await Run({ action: 'take', orderId: id3 });
  check('not taken while it’s being made', r.status === 409 && /still being made/.test(r.body.error), r.body);
  const t3 = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id3);
  for (const t of t3) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'ready', readyAt: new Date().toISOString() }, { merge: true });
  texts.length = 0;
  r = await Run({ action: 'take', orderId: id3 });
  const o3b = await get(`${T}/counterOrders/${id3}`);
  check('Take it: out with them (their team record), and the guest’s text that it’s on its way', r.body.ok && o3b.ahead.delivery.state === 'out' && o3b.ahead.delivery.driverId === 'd1' && o3b.ahead.delivery.driverName === 'Sam Lee' && texts.length === 1 && /on its way/.test(texts[0].body), { d: o3b.ahead.delivery, texts });
  actor = { uid: 'd2', name: 'Rio Diaz', role: 'staff', isManager: false, caps: [] };
  r = await Run({ action: 'take', orderId: id3 });
  const other: any = await Run({ action: 'list' });
  check('another driver can’t take it, and doesn’t see it', r.status === 409 && /already out with Sam Lee/.test(r.body.error) && !(other.body.rows || []).some((x: any) => x.orderId === id3), r.body);
  r = await Run({ action: 'outside', orderId: id3 });
  const notMine: any = await Run({ action: 'done', orderId: id3 });
  check('…or text them, or mark it delivered', r.status === 403 && notMine.status === 403, [r.body, notMine.body]);
  actor = { uid: 'd1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
  texts.length = 0; smsDown = true;
  r = await Run({ action: 'outside', orderId: id3 });
  const downPage: any = await A({ action: 'track', o: id3, s: s3 });
  check('I’m outside when texts aren’t going: said, their page doesn’t claim it, and it can be tried again at once', r.body.ok && r.body.sent === false && r.body.why === 'failed' && downPage.body.delivery?.outside === false && !(await get(`${T}/counterOrders/${id3}`)).ahead.delivery.outsideAt, r.body);
  smsDown = false; texts.length = 0;
  r = await Run({ action: 'outside', orderId: id3 });
  const again: any = await Run({ action: 'outside', orderId: id3 });
  check('I’m outside: one text from the business’s number (not again straight away, and the driver is told why)', r.body.ok && r.body.sent === true && texts.length === 1 && texts[0].to === '+18325550188' && /Your driver is outside with order A\d+\./.test(texts[0].body) && again.body.ok && again.body.sent === false && again.body.why === 'soon' && texts.length === 1, texts);
  r = await A({ action: 'track', o: id3, s: s3 });
  check('…and their page says so', r.body.delivery?.outside === true && r.body.delivery.driver === 'Sam', r.body.delivery);
  r = await Run({ action: 'done', orderId: id3 });
  const tipLine = await get(`${T}/transactions/ftip_${id3}`);
  check('delivered: the tip is the driver’s, put under their name (the same line)', r.body.ok && tipLine?.category === 'Tips' && tipLine.staffId === 'd1' && tipLine.amount === 2.34 && tipLine.taxBucket === 'gratuity' && tipLine.type === 'income' && tipLine.date === paidTip.date && tipLine.description === `Driver tip, order ${o3.number}`, tipLine);
  r = await Run({ action: 'done', orderId: id3 });
  check('…tapped again: booked once', r.body.ok && r.body.already === true && (await all(`${T}/transactions`)).filter((t: any) => t.id === `ftip_${id3}`).length === 1, r.body);

  console.log('the counter picks the driver');
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  r = await A({ ...base, key: nextKey(), name: 'Ola', phone: '8325550199', tip: { cents: 500 } });
  const id4 = r.body.orderId; paid(S.pis.get((await get(`${T}/counterOrders/${id4}`)).ahead.payId).id); await A({ action: 'done', o: id4, s: r.body.sig });
  for (const t of (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id4)) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'ready' }, { merge: true });
  r = await C({ action: 'lane' });
  check('the counter lists the business’s drivers', JSON.stringify(r.body.drivers) === JSON.stringify([{ id: 'd1', name: 'Sam Lee' }, { id: 'd2', name: 'Rio Diaz' }]), r.body.drivers);
  r = await C({ action: 'deliveryOut', orderId: id4, driverId: 's9' });
  check('only one of them can be picked', r.status === 400, r.body);
  r = await C({ action: 'deliveryOut', orderId: id4, driver: 'Cousin Jo' });
  actor = { uid: 'd1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
  const taken: any = await Run({ action: 'take', orderId: id4 });
  check('out with someone the counter named: a driver can’t take it over', taken.status === 409 && /already out with Cousin Jo/.test(taken.body.error), taken.body);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  await C({ action: 'deliveryDone', orderId: id4 });
  const jo = await get(`${T}/transactions/ftip_${id4}`);
  check('someone else by name: their tip is kept for the owner to give out by hand', r.body.ok && jo?.amount === 5 && jo.staffId === null && /give it out by hand/.test(jo.description), jo);

  console.log('brought back');
  r = await A({ ...base, key: nextKey(), name: 'Bo', phone: '8325550111' });
  const id5 = r.body.orderId; paid(S.pis.get((await get(`${T}/counterOrders/${id5}`)).ahead.payId).id); await A({ action: 'done', o: id5, s: r.body.sig });
  for (const t of (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id5)) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'ready' }, { merge: true });
  actor = { uid: 'd1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
  await Run({ action: 'take', orderId: id5 }); await Run({ action: 'failed', orderId: id5, why: 'no_answer' });
  r = await Run({ action: 'take', orderId: id5 });
  check('brought back: a driver can’t pick it up again from their phone (a manager sends it again from the counter)', r.status === 409 && /A manager sends it out again/.test(r.body.error) && (await get(`${T}/counterOrders/${id5}`)).ahead.delivery.state === 'failed', r.body);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

  console.log('running late, and late nights');
  const FD = await import('../../src/lib/food-delivery');
  const t0 = Date.parse('2026-11-20T18:00:00Z'); const at = (m: number) => new Date(t0 + m * 60000).toISOString();
  let e: any = FD.etaOf({ outAt: at(0), driveMin: 10, arriveAt: at(12) }, t0 + 60000);
  check('out with a driver: when it left plus the drive, on time', e.eta === at(10) && e.late === false, e);
  e = FD.etaOf({ outAt: at(0), driveMin: 10, routeEta: at(20), arriveAt: at(12) }, t0 + 60000);
  check('…the driver’s planned route’s time first, and 5 minutes past the guest’s time is running late', e.eta === at(20) && e.late === true, e);
  e = FD.etaOf({ outAt: at(0), driveMin: 10, arriveAt: at(10) }, t0 + 16 * 60000);
  check('…a time already past is now (still on its way), and late', e.eta === at(16) && e.late === true, e);
  r = await A({ ...base, key: nextKey(), name: 'Lu', phone: '8325550122' });
  const id6 = r.body.orderId; const s6 = r.body.sig; paid(S.pis.get((await get(`${T}/counterOrders/${id6}`)).ahead.payId).id); await A({ action: 'done', o: id6, s: s6 });
  for (const t of (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id6)) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'ready' }, { merge: true });
  await C({ action: 'deliveryOut', orderId: id6, driver: 'Sam Lee' });
  const o6 = await get(`${T}/counterOrders/${id6}`);
  await db.doc(`${T}/counterOrders/${id6}`).set({ ahead: { delivery: { routeId: 'r1763661600000', routeSeq: 0, routeEta: new Date(Date.parse(o6.ahead.delivery.arriveAt) + 12 * 60000).toISOString() } } }, { merge: true });
  let late: any[] = await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 20000);
  const row6 = late.find((x: any) => x.orderId === id6);
  r = await A({ action: 'track', o: id6, s: s6 });
  check('the counter: running late, and about when now', row6?.step === 'out' && row6.late === true && row6.eta === new Date(Math.ceil((Date.parse(o6.ahead.delivery.arriveAt) + 12 * 60000) / 60000) * 60000).toISOString(), row6);
  check('…and the guest’s page: the new time, running late', r.body.delivery?.late === true && r.body.delivery.eta === row6?.eta && !!r.body.delivery.arriveAt, r.body.delivery);
  const out2 = await C({ action: 'deliveryFailed', orderId: id6, why: 'no_answer' }); await C({ action: 'deliveryOut', orderId: id6 });
  check('sent out again: a trip of its own (the old route’s time gone)', out2.body.ok && !(await get(`${T}/counterOrders/${id6}`)).ahead.delivery.routeEta);
  // After midnight: started yesterday and still out; one paid yesterday and never sent; one delivered yesterday.
  const cal = new Date(Date.now()).toISOString().slice(0, 10); const yday = new Date(Date.parse(`${cal}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 3600e3).toISOString();
  await db.doc(`${T}/counterOrders/${id6}`).set({ day: yday }, { merge: true });
  r = await A({ ...base, key: nextKey(), name: 'Vi', phone: '8325550133' });
  const id7 = r.body.orderId; paid(S.pis.get((await get(`${T}/counterOrders/${id7}`)).ahead.payId).id); await A({ action: 'done', o: id7, s: r.body.sig });
  await db.doc(`${T}/counterOrders/${id7}`).set({ day: yday, paidAt: ago30, createdAt: ago30 }, { merge: true });
  await db.doc(`${T}/counterOrders/${id2}`).set({ day: yday, ahead: { delivery: { deliveredAt: ago30 } } }, { merge: true });
  late = await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 30000);
  check('started before midnight and still out: still on the counter', late.some((x: any) => x.orderId === id6 && x.step === 'out' && !x.earlier), late.map((x: any) => [x.number, x.step, x.earlier]));
  check('…one paid yesterday and never sent: still there, marked from yesterday', late.some((x: any) => x.orderId === id7 && x.earlier === true && x.step !== 'delivered'));
  check('…one delivered yesterday isn’t in today’s delivered line', !late.some((x: any) => x.orderId === id2));
  const num7 = (await get(`${T}/counterOrders/${id7}`)).number;
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', isActive: true }, { merge: true });
  let told: any = await FS.deliveryNightly(db, 't1', await get(T), Date.now());
  const toldNow = (await all(`${T}/notifications`)).filter((n: any) => n.type === 'delivery_unsettled');
  check('the night after: the managers told about the one paid and never settled (not the one out tonight)', told.told === 1 && !!(await get(`${T}/counterOrders/${id7}`)).ahead.delivery.toldAt && !(await get(`${T}/counterOrders/${id6}`)).ahead.delivery.toldAt
    && toldNow.length > 0 && toldNow.every((n: any) => new RegExp(`Delivery ${num7} was paid for and never marked delivered`).test(n.message)), { told, toldNow });
  told = await FS.deliveryNightly(db, 't1', await get(T), Date.now());
  check('…once', told.told === 0, told);
  actor = { uid: 'd1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
  await new Promise((res) => setTimeout(res, 3100));
  r = await Run({ action: 'list' });
  check('…a driver isn’t offered yesterday’s one (the counter settles it)', r.body.ok && !(r.body.rows || []).some((x: any) => x.orderId === id7), r.body.rows);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

  console.log('couldn’t be delivered: picked up instead, or refunded');
  const placeOut = async (name: string, phone: string, extra: any = {}) => {
    const p: any = await A({ ...base, key: nextKey(), name, phone, ...extra });
    const id = p.body.orderId; const sig = p.body.sig;
    paid(S.pis.get((await get(`${T}/counterOrders/${id}`)).ahead.payId).id); await A({ action: 'done', o: id, s: sig });
    for (const t of (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id)) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'ready' }, { merge: true });
    await C({ action: 'deliveryOut', orderId: id, driver: 'Sam Lee' });
    return { id, sig };
  };
  texts.length = 0;
  const f1 = await placeOut('Mo', '8325550144', { tip: { pct: 18 } });
  r = await C({ action: 'deliveryFailed', orderId: f1.id, why: 'no_answer' });
  check('couldn’t deliver: the guest’s text, once', r.body.ok && texts.length === 1 && texts[0].to === '+18325550144' && /\(no one answered\)/.test(texts[0].body), texts);
  r = await A({ action: 'track', o: f1.id, s: f1.sig });
  const fv = r.body.delivery?.failed;
  check('their page: couldn’t be delivered, why, and what a refund gives back (the fee kept: their side, and second tries are charged)', r.body.delivery?.step === 'failed' && fv?.why === 'No one answered' && fv.keepFee === true && fv.keepWhen === 'no one answers' && fv.food === 13 && fv.tax === 1.3 && fv.tip === 2.34 && fv.fee === 3.99 && !fv.stuck, r.body.delivery);
  const rowF1 = (await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 40000)).find((x: any) => x.orderId === f1.id);
  check('…and the counter the same, to refund it', rowF1?.step === 'failed' && rowF1.back?.keepFee === true && rowF1.back.tip === 2.34 && rowF1.back.fee === 3.99, rowF1);
  const before = S.refunds.length;
  r = await A({ action: 'deliveryChoice', o: f1.id, s: f1.sig, choice: 'refund' });
  const of1 = await get(`${T}/counterOrders/${f1.id}`);
  const sent1 = S.refunds.slice(before).map((x: any) => x.amount).sort((a: number, b: number) => a - b);
  check('Refund me: the food, its tax and the tip back to their card in one step, not the fee', r.body.ok && r.body.cents === 1664 && sent1.join() === '130,234,1300' && of1.ahead.delivery.state === 'refunded' && !!of1.refundedAt && of1.refundedCents === 1664, { body: r.body, sent1, d: of1.ahead.delivery });
  const books1 = await Promise.all([`counter_${f1.id}`, `counter_${f1.id}_tax`, `ftip_${f1.id}`, `counter_${f1.id}_delivery`].map((x) => get(`${T}/transactions/${x}`)));
  check('…the books show each line refunded (the fee’s line not)', !!books1[0]?.refundedAt && !!books1[1]?.refundedAt && !!books1[2]?.refundedAt && !books1[3]?.refundedAt && !!(await get(`${T}/transactions/refund_counter_${f1.id}`)) && !!(await get(`${T}/transactions/refund_ftip_${f1.id}`)), books1.map((b: any) => b?.refundedAt || null));
  r = await A({ action: 'deliveryChoice', o: f1.id, s: f1.sig, choice: 'refund' });
  let r2: any = await A({ action: 'deliveryChoice', o: f1.id, s: f1.sig, choice: 'pickup' });
  check('…asked again: as it was, nothing twice; and it can’t become a pickup now', r.body.ok && r.body.already === true && S.refunds.length === before + 3 && r2.status === 409, [r.body, r2.body]);
  r = await A({ action: 'track', o: f1.id, s: f1.sig });
  r2 = await C({ action: 'deliveryOut', orderId: f1.id });
  check('…their page says refunded, and how much; it can’t go out again', r.body.delivery?.step === 'refunded' && r.body.delivery.back === 16.64 && r2.status === 409, [r.body.delivery, r2.body]);
  r = await A({ action: 'deliveryChoice', o: id6, s: s6, choice: 'refund' });
  check('a delivery that hasn’t come back can’t be refunded from the guest’s page', r.status === 409, r.body);

  const f2 = await placeOut('Jo', '8325550145', { tip: { pct: 18 } });
  await C({ action: 'deliveryFailed', orderId: f2.id, why: 'other' });
  const b2 = S.refunds.length;
  r = await A({ action: 'deliveryChoice', o: f2.id, s: f2.sig, choice: 'pickup' });
  const of2 = await get(`${T}/counterOrders/${f2.id}`);
  const sent2 = S.refunds.slice(b2).map((x: any) => x.amount).sort((a: number, b: number) => a - b);
  check('I’ll pick it up: a pickup with their code; the tip comes back, and the fee (the business’s side)', r.body.ok && of2.ahead.delivery.state === 'pickup' && r.body.code === of2.ahead.code && sent2.join() === '234,399' && r.body.cents === 633 && !of2.refundedAt, { body: r.body, sent2, d: of2.ahead.delivery });
  r = await A({ action: 'track', o: f2.id, s: f2.sig });
  check('…their page: come pick it up, their code, and what’s on its way back', r.body.delivery?.step === 'pickup' && r.body.code === of2.ahead.code && r.body.delivery.back === 6.33 && !r.body.delivery.owed, r.body);
  const rowP = (await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 41000)).find((x: any) => x.orderId === f2.id);
  r = await C({ action: 'deliveryOut', orderId: f2.id });
  check('…the counter: picking it up, with their code; not sent out again', rowP?.step === 'pickup' && rowP.code === of2.ahead.code && rowP.owed === 0 && r.status === 409 && /picking this one up/.test(r.body.error), { rowP, r: r.body });
  r = await C({ action: 'deliveryHanded', orderId: f2.id });
  r2 = await C({ action: 'deliveryHanded', orderId: f2.id });
  check('Handed over: done, once', r.body.ok && (await get(`${T}/counterOrders/${f2.id}`)).ahead.delivery.state === 'picked_up' && r2.body.ok && r2.body.already === true, [r.body, r2.body]);

  const f3 = await placeOut('Ty', '8325550146');
  await C({ action: 'deliveryFailed', orderId: f3.id, why: 'no_access' });
  actor = { uid: 'd1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
  r = await C({ action: 'deliveryRefund', orderId: f3.id, fee: true });
  check('the counter’s Refund it: a manager’s (their PIN, or ask one)', r.status === 403 && r.body.needsManager === true && (await get(`${T}/counterOrders/${f3.id}`)).ahead.delivery.state === 'failed', r.body);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  const b3 = S.refunds.length; S.failIn = 2; texts.length = 0;
  r = await C({ action: 'deliveryRefund', orderId: f3.id, fee: true });
  let of3 = await get(`${T}/counterOrders/${f3.id}`);
  const rowS = (await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 42000)).find((x: any) => x.orderId === f3.id);
  check('…a card refund that says no partway: what went is kept, and the counter says to finish it', r.status === 502 && /went back, but not all of it/.test(r.body.error) && of3.ahead.delivery.state === 'failed' && rowS?.back?.stuck === true && S.refunds.length - b3 === 2, { body: r.body, d: of3.ahead.delivery, rowS });
  r = await C({ action: 'deliveryOut', orderId: f3.id });
  check('…and with money already going back, it isn’t sent out again', r.status === 409 && /refund for this one was started/.test(r.body.error), r.body);
  r = await C({ action: 'deliveryRefund', orderId: f3.id, fee: false });
  of3 = await get(`${T}/counterOrders/${f3.id}`);
  check('…asked again: the rest goes (nothing twice), the fee too as first decided, and the guest is texted', r.body.ok && r.body.cents === 1829 && of3.ahead.delivery.state === 'refunded' && S.refunds.length - b3 === 3 && texts.some((x) => x.to === '+18325550146' && /\$18\.29 is on its way back to your card/.test(x.body)), { body: r.body, n: S.refunds.length - b3, texts });
  // A pickup whose tip is still going back, and a manager's refund at the same moment: one at a time.
  const f4 = await placeOut('Al', '8325550147', { tip: { pct: 18 } });
  smsDown = true;
  await C({ action: 'deliveryFailed', orderId: f4.id, why: 'other' });
  smsDown = false;
  const rowT = (await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 43000)).find((x: any) => x.orderId === f4.id);
  check('the text to them didn’t go: the counter is told to phone them', rowT?.back?.textFailed === true, rowT?.back);
  S.failIn = 1;
  r = await A({ action: 'deliveryChoice', o: f4.id, s: f4.sig, choice: 'pickup' });
  let of4 = await get(`${T}/counterOrders/${f4.id}`);
  const rowO = (await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 44000)).find((x: any) => x.orderId === f4.id);
  check('a pickup whose tip didn’t go back: the counter shows what’s owed, and why', r.body.ok && of4.ahead.delivery.state === 'pickup' && of4.ahead.delivery.owed.length === 1 && rowO?.owed === 2.34 && /said no/.test(String(rowO?.back?.stuckWhy)), { body: r.body, rowO });
  await db.doc(`${T}/counterOrders/${f4.id}`).set({ ahead: { delivery: { owedAt: new Date().toISOString() } } }, { merge: true });
  r = await C({ action: 'deliveryRefund', orderId: f4.id });
  check('…while it’s being sent again, a manager’s refund waits (one step at a time on its money)', r.status === 409 && /Give it a moment/.test(r.body.error), r.body);
  await db.doc(`${T}/counterOrders/${f4.id}`).set({ ahead: { delivery: { owedAt: null } } }, { merge: true });
  await C({ action: 'deliveryHanded', orderId: f4.id });
  const rowH = (await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 45000)).find((x: any) => x.orderId === f4.id);
  check('…handed over, it stays on the counter until the money goes back', rowH?.step === 'picked_up' && rowH.owed === 2.34, rowH);
  const yIso = new Date(Date.now() - 30 * 3600e3).toISOString();
  await db.doc(`${T}/counterOrders/${f4.id}`).set({ ahead: { delivery: { pickupAt: yIso } } }, { merge: true });
  await FS.deliveryNightly(db, 't1', await get(T), Date.now());
  check('…and the managers hear the night after', !!(await get(`${T}/counterOrders/${f4.id}`)).ahead.delivery.owedToldAt && (await all(`${T}/notifications`)).some((n: any) => /picked up instead, but some of its money/.test(String(n.message))));
  r = await C({ action: 'deliveryOwed', orderId: f4.id });
  of4 = await get(`${T}/counterOrders/${f4.id}`);
  const rowsAfter = await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 46000);
  check('Send it again: it goes, and it’s off the counter', r.body.ok && r.body.owed === 0 && of4.ahead.delivery.owed.length === 0 && of4.ahead.delivery.backCents === 633 && !rowsAfter.some((x: any) => x.orderId === f4.id), { body: r.body, d: of4.ahead.delivery });
  // A pickup refunded at the counter that stopped partway can't be handed over until the refund is finished.
  const f5 = await placeOut('Bea', '8325550148');
  await C({ action: 'deliveryFailed', orderId: f5.id, why: 'no_answer' });
  await A({ action: 'deliveryChoice', o: f5.id, s: f5.sig, choice: 'pickup' });
  S.failIn = 2;
  r = await C({ action: 'deliveryRefund', orderId: f5.id });
  r2 = await C({ action: 'deliveryHanded', orderId: f5.id });
  check('a pickup whose refund stopped partway isn’t handed over until it’s finished', r.status === 502 && r2.status === 409 && /Refund it again to finish/.test(r2.body.error) && (await get(`${T}/counterOrders/${f5.id}`)).ahead.delivery.state === 'pickup', [r.body, r2.body]);
  r = await C({ action: 'deliveryRefund', orderId: f5.id });
  check('…finished, it’s refunded', r.body.ok && (await get(`${T}/counterOrders/${f5.id}`)).ahead.delivery.state === 'refunded', r.body);
  let told2: any = await FS.deliveryNightly(db, 't1', await get(T), Date.now());
  check('settled ones aren’t in the managers’ night note', !(await get(`${T}/counterOrders/${f1.id}`)).ahead.delivery.toldAt && !(await get(`${T}/counterOrders/${f2.id}`)).ahead.delivery.toldAt && !(await get(`${T}/counterOrders/${f3.id}`)).ahead.delivery.toldAt, told2);

  console.log('allergies and a note, ordered ahead');
  r = await A({ ...base, key: nextKey(), name: 'Ivy', phone: '8325550144', lines: [{ itemId: 'burger', quantity: 2, note: 'No onions' }, { itemId: 'fries', quantity: 1 }], allergy: { keys: ['sesame'], other: 'Mustard' } });
  const id9 = r.body.orderId; const s9 = r.body.sig; paid(S.pis.get((await get(`${T}/counterOrders/${id9}`)).ahead.payId).id); await A({ action: 'done', o: id9, s: s9 });
  const t9 = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id9);
  const burger9 = t9.find((t: any) => t.menuItemId === 'burger'); const fries9 = t9.find((t: any) => t.menuItemId === 'fries');
  check('the guest’s allergies on every ticket; the note on the burger only', r.body.ok && t9.length === 2 && t9.every((t: any) => t.allergies?.some((a: any) => a.name === 'Sesame') && t.allergies.some((a: any) => a.name === 'Mustard')) && burger9?.note === 'No onions' && !fries9?.note, t9.map((t: any) => [t.menuItemId, t.allergies, t.note]));
  r = await A({ action: 'track', o: id9, s: s9 });
  check('…and their page shows what they told the kitchen', r.body.allergy === 'Sesame, Mustard' && r.body.lines.find((l: any) => l.name === 'Burger')?.note === 'No onions', { a: r.body.allergy, l: r.body.lines });

  console.log('slowed down at the counter');
  const keyR = nextKey(); const plR: any = await A({ ...base, key: keyR, phone: '8325550156' });
  r = await C({ action: 'deliverySlow', mode: 'pause', minutes: 30 });
  const plR2: any = await A({ ...base, key: keyR, phone: '8325550156' });
  check('an order placed before the pause, asked again (its answer lost), is found as it was', plR.body.ok && plR2.body.ok && plR2.body.orderId === plR.body.orderId, [plR.body, plR2.body]);
  const chkP: any = await A({ action: 'deliveryCheck', address: addr, lines });
  check('paused: the address check says so, with when to try again', r.body.ok && r.body.slow.paused && chkP.status === 409 && chkP.body.code === 'paused' && !!chkP.body.until, [r.body, chkP.body]);
  const plP: any = await A({ ...base, key: nextKey(), phone: '8325550155' });
  check('…and a delivery can’t be placed', plP.status === 409 && plP.body.code === 'paused', plP.body);
  let lane2: any = (await C({ action: 'lane' })).body;
  check('…the counter shows it', lane2.slow?.paused === true && !!lane2.slow.until, lane2.slow);
  await C({ action: 'deliverySlow', mode: 'clear' });
  const chk0: any = await A({ action: 'deliveryCheck', address: addr, lines });
  r = await C({ action: 'deliverySlow', mode: 'extra', minutes: 15 });
  const chk15: any = await A({ action: 'deliveryCheck', address: addr, lines });
  check('15 minutes added: the first delivery time is that much later, for an hour', chk0.body.ok && chk15.body.ok && Date.parse(chk15.body.leaveFirst) - Date.parse(chk0.body.leaveFirst) >= 15 * 60000 && r.body.slow.extraMin === 15 && Date.parse(r.body.slow.extraUntil) > Date.now() + 59 * 60000, [chk0.body.leaveFirst, chk15.body.leaveFirst, r.body.slow]);
  r = await C({ action: 'deliverySlow', mode: 'extra', minutes: 45 });
  check('…only the choices', r.status === 400, r.body);
  r = await C({ action: 'deliverySlow', mode: 'pause', minutes: 'day' });
  check('paused for the rest of the business’s day', r.body.ok && r.body.slow.paused && Date.parse(r.body.slow.until) > Date.now(), r.body.slow);
  r = await C({ action: 'deliverySlow', mode: 'clear' });
  check('back to normal', r.body.ok && !r.body.slow.paused && r.body.slow.extraMin === 0 && ((await A({ action: 'deliveryCheck', address: addr, lines })) as any).body.ok, r.body.slow);

  console.log('sales tax on the delivery fee');
  r = await Mn({ action: 'ahead', deliveryFeeTaxed: true });
  check('a manager can charge sales tax on the delivery fee', r.body.ok && r.body.ahead.deliveryFeeTaxed === true, r.body.ahead);
  const g1 = await placeOut('Gus', '8325550149');
  const og1 = await get(`${T}/counterOrders/${g1.id}`);
  check('…the fee’s tax is in the order’s tax and total, kept apart', og1.deliveryFeeTax === 0.4 && og1.tax === 1.7 && og1.total === 18.69, { tax: og1.tax, ft: og1.deliveryFeeTax, total: og1.total });
  const gt: any = await get(`${T}/transactions/counter_${g1.id}_tax`); const gft: any = await get(`${T}/transactions/counter_${g1.id}_delivery_tax`);
  check('…booked: the food’s tax and the fee’s tax on lines of their own', gt?.amount === 1.3 && gft?.amount === 0.4 && gft.category === 'Tax Collected', { gt, gft });
  await C({ action: 'deliveryFailed', orderId: g1.id, why: 'no_answer' });
  const gv = ((await A({ action: 'track', o: g1.id, s: g1.sig })) as any).body.delivery?.failed;
  const bg = S.refunds.length;
  r = await A({ action: 'deliveryChoice', o: g1.id, s: g1.sig, choice: 'refund' });
  check('…refunded with the fee kept: the fee’s tax is kept with it', gv?.tax === 1.3 && gv.fee === 4.39 && r.body.ok && r.body.cents === 1430 && S.refunds.length - bg === 2 && !(await get(`${T}/transactions/counter_${g1.id}_delivery_tax`)).refundedAt, { gv, body: r.body });
  await Mn({ action: 'ahead', deliveryFeeTaxed: false });

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
  check('running late: the counter and the guest’s page say so, with the new time', /Running late/.test(desk) && /From yesterday/.test(desk) && /Running a little late\. It was due at/.test(order) && /st === 'out' && D\.eta \? D\.eta : D\.arriveAt/.test(order));
  check('the new screens keep the house style (no all caps, no heaviest weight, 44px taps)', ![order, card, desk].some((s) => /\buppercase\b|font-black/.test(s)) && /min-h-\[44px\]/.test(desk));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
