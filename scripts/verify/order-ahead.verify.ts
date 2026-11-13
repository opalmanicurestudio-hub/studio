// Checks ordering ahead (lib/counter-ahead, api/counter/ahead, the lane's "Ordered ahead" in api/counter, api/menu
// 'ahead', the payment notice in lib/connect-webhook and the payments sweep in lib/counter-card).
// - The guest's menu: only what's on the menu for everyone, sold out says so; off unless the business turned it on and
//   payments are connected.
// - Placing: prices and stock from the server, never the page; a name, a way to pick up, and a time that was offered.
//   The same key is the same order and the same payment. A closed business takes no orders.
// - Paid (asked of the card company, whichever hears first): to the kitchen and paid by it, once; a later time waits
//   until it's time to start, or until I'm here. Sold out since: the money goes back and the guest is told.
// - Not paid in 30 minutes: let go, code freed.
// - At the speaker: the code finds the order; it becomes the car (its empty order let go) or a new car, straight to
//   pickup; never an unpaid order, another car's, or a car that already ordered.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-ahead.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), refunds: [] as any[], n: 0, event: null as any };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const err = (code: string) => Object.assign(new Error(code), { code, raw: { code } });
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, status: 'requires_payment_method', automatic_payment_methods: p.automatic_payment_methods, metadata: { ...p.metadata }, amount_received: 0, client_secret: `${id}_secret`, account: o?.stripeAccount };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); return clone(pi);
    },
    retrieve: async (id: string) => { const pi = S.pis.get(id); if (!pi) throw err('resource_missing'); return clone(pi); },
    cancel: async (id: string) => { const pi = S.pis.get(id); if (pi.status === 'succeeded') throw err('payment_intent_unexpected_state'); pi.status = 'canceled'; return clone(pi); },
  };
  refunds = { create: async (p: any) => { S.refunds.push(p); return { id: `re_${S.refunds.length}`, status: 'succeeded', amount: p.amount }; } };
  paymentMethodDomains = { list: async () => ({ data: [] }), create: async (p: any) => ({ id: 'pmd_1', domain_name: p.domain_name, enabled: true, apple_pay: { status: 'active' }, google_pay: { status: 'active' } }), update: async () => ({}), validate: async () => ({}) };
  webhooks = { constructEvent: () => S.event };
}
const paid = (piId: string) => { const pi = S.pis.get(piId); pi.status = 'succeeded'; pi.amount_received = pi.amount; };

const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : String(k).toLowerCase() === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const slot = (minutes: number) => { const step = 15 * 60000; return new Date(Math.ceil((Date.now() + minutes * 60000) / step) * step).toISOString(); };

(async () => {
  const { POST: AHEAD } = await import('../../src/app/api/counter/ahead/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { handleConnectWebhook } = await import('../../src/lib/connect-webhook');
  const CC = await import('../../src/lib/counter-card');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Burgers', price: 5, totalStock: 50, makeSeconds: 240, imageUrl: 'https://img.test/burger.png' });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 2, totalStock: 3, makeSeconds: 60, choices: [{ id: 'sz', name: 'Size', pick: 'one', required: true, options: [{ id: 's', name: 'Small', price: 0 }, { id: 'l', name: 'Large', price: 1 }] }] });
  await db.doc(`${T}/inventory/shake`).set({ type: 'refreshment', name: 'Shake', category: 'Drinks', price: 4, totalStock: 30, soldOut: true });
  await db.doc(`${T}/inventory/secret`).set({ type: 'refreshment', name: 'Members burger', category: 'Burgers', price: 9, totalStock: 30, isMembersOnly: true });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  const A = (b: any) => AHEAD(req({ tenantId: 't1', ...b }));
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const L = (b: any) => LANE(req({ tenantId: 't1', key, ...b }));
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b }));
  let k = 0; const nextKey = () => `keykeykey${++k}`;

  console.log('turning it on');
  let r: any = await A({ action: 'menu' });
  check('off until the business turns it on: the page says so', r.body.ok && r.body.on === false && r.body.sections.length === 0, r.body);
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  r = await Mn({ action: 'ahead', on: true });
  check('only a manager turns it on', r.status === 403, r.body);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  r = await Mn({ action: 'ahead', driveThru: false, inside: false });
  check('…and at least one way to pick up stays', r.status === 400, r.body);
  r = await Mn({ action: 'ahead', on: true, laterHours: 2 });
  check('on: the guests’ link is where they order', r.body.ok && r.body.ahead.on === true && r.body.ahead.link === 'https://app.test/order/t1' && r.body.ahead.laterHours === 2, r.body);
  r = await Mn({ action: 'list' });
  check('…and the Menu page shows it', r.body.ok && r.body.ahead?.on === true && r.body.ahead.driveThru && r.body.ahead.inside, r.body.ahead);

  console.log('the guest’s menu');
  r = await A({ action: 'menu' });
  const items = r.body.sections.flatMap((s: any) => s.items);
  check('the menu by section, with photos and choices; sold out says so; members-only items aren’t shown', r.body.on === true && r.body.business === 'Northside' && JSON.stringify(r.body.ways) === '["drive-thru","inside"]'
    && items.find((i: any) => i.id === 'burger')?.imageUrl === 'https://img.test/burger.png' && items.find((i: any) => i.id === 'fries')?.choices.length === 1 && items.find((i: any) => i.id === 'shake')?.soldOut === true && !items.some((i: any) => i.id === 'secret'), r.body);
  check('times every 15 minutes, from 20 minutes out, for 2 hours, today only', r.body.times.length <= 8 && r.body.times.every((t: string) => t.slice(0, 10) === new Date().toISOString().slice(0, 10) || new Date().getUTCHours() >= 22) && Date.parse(r.body.times[0]) >= Date.now() + 19 * 60000 && r.body.times.every((t: string) => Date.parse(t) % (15 * 60000) === 0), r.body.times);

  console.log('placing');
  const base = { action: 'place', name: 'Jordan', way: 'drive-thru', lines: [{ itemId: 'burger', quantity: 2 }, { itemId: 'fries', quantity: 1, choices: { sz: ['l'] } }] };
  r = await A({ ...base, key: nextKey(), name: '' });
  const r2: any = await A({ ...base, key: nextKey(), way: 'delivery' });
  const r3: any = await A({ ...base, key: nextKey(), at: new Date(Date.now() + 5 * 60000).toISOString() });
  const r4: any = await A({ ...base, key: nextKey(), lines: [{ itemId: 'shake', quantity: 1 }] });
  const r5: any = await A({ ...base, key: nextKey(), lines: [{ itemId: 'secret', quantity: 1 }] });
  const r6: any = await A({ ...base, key: nextKey(), lines: [{ itemId: 'fries', quantity: 4, choices: { sz: ['s'] } }] });
  check('a name, a way to pick up and an offered time are needed; sold out, members-only and more than there is are refused', r.status === 400 && r.body.code === 'name' && r2.body.code === 'way' && r3.body.code === 'at' && r4.status === 409 && r5.status === 409 && r6.status === 409 && /Only 3 Fries left/.test(r6.body.error), [r.body, r2.body, r3.body, r4.body, r5.body, r6.body]);
  const key1 = nextKey();
  r = await A({ ...base, key: key1, lines: [...base.lines, { itemId: 'burger', quantity: 1, price: 0.01 }] });
  const o1 = await get(`${T}/counterOrders/${r.body.orderId}`);
  const pi1 = S.pis.get(o1?.ahead?.payId);
  check('placed: prices from the menu (never the page), a number and a 4-digit code, and one payment for exactly the total', r.body.ok && r.body.number === 'A1' && r.body.total === 19.8 && r.body.clientSecret === pi1.client_secret && r.body.publishableKey === 'pk_test_fake'
    && /^\d{4}$/.test(o1.ahead.code) && o1.ahead.state === 'awaiting_pay' && o1.status === 'building' && o1.guestName === 'Jordan' && pi1.amount === 1980 && pi1.account === 'acct_1'
    && pi1.automatic_payment_methods?.allow_redirects === 'never' && pi1.metadata.source === 'order_ahead' && pi1.metadata.orderId === r.body.orderId, { body: r.body, o1, pi1 });
  check('…the code is the order’s alone today', (await get(`${T}/aheadCodes/${o1.day}_${o1.ahead.code}`))?.orderId === r.body.orderId);
  check('…and nothing goes to the kitchen before it’s paid', (await all(`${T}/kdsTickets`)).length === 0);
  const id1 = r.body.orderId; const s1 = r.body.sig;
  r = await A({ ...base, key: key1, lines: [...base.lines, { itemId: 'burger', quantity: 1, price: 0.01 }] });
  check('placed again with the same key and the same order (a refresh): the same order and the same payment', r.body.orderId === id1 && r.body.clientSecret === pi1.client_secret && S.pis.size === 1, r.body);

  console.log('paying');
  r = await A({ action: 'track', o: id1, s: 'x'.repeat(32) });
  check('a changed link opens nothing', r.status === 404, r.body);
  r = await A({ action: 'done', o: id1, s: s1 });
  check('the page asks before the card company has it: still going through', r.status === 202 && r.body.pending === true, r.body);
  r = await A({ action: 'track', o: id1, s: s1 });
  check('…the order page says it’s waiting for the payment, with no code yet', r.body.ok && r.body.paid === false && r.body.code === null, r.body);
  paid(pi1.id);
  r = await A({ action: 'done', o: id1, s: s1 });
  const o1b = await get(`${T}/counterOrders/${id1}`);
  const t1 = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id1);
  const sale1 = await get(`${T}/transactions/counter_${id1}`);
  check('paid: to the kitchen and paid by it, with the payment’s reference in the books', r.body.ok && r.body.paid && o1b.status === 'sent' && o1b.paidAt && o1b.payMethod === 'card' && o1b.cardPaymentId === pi1.id && o1b.ahead.state === 'paid' && o1b.paidVia === 'online'
    && t1.length === 3 && t1.every((t: any) => t.channel === 'ahead' && !t.holdUntil) && sale1?.stripePaymentIntentId === pi1.id, { body: r.body, o1b, t1, sale1 });
  const txs1 = (await all(`${T}/transactions`)).filter((t: any) => t.orderId === id1).length;
  r = await A({ action: 'done', o: id1, s: s1 });
  check('…asked again: paid once, nothing sent twice', r.body.paid && (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id1).length === 3 && (await all(`${T}/transactions`)).filter((t: any) => t.orderId === id1).length === txs1, r.body);
  r = await A({ action: 'track', o: id1, s: s1 });
  check('the order page: the code, being made, at the drive-thru', r.body.paid && r.body.code === o1.ahead.code && r.body.kitchen === 'making' && r.body.way === 'drive-thru' && r.body.number === 'A1', r.body);

  console.log('for later');
  const later = slot(60);
  r = await A({ ...base, key: nextKey(), name: 'Priya', way: 'inside', at: later, lines: [{ itemId: 'burger', quantity: 1 }] });
  const id2 = r.body.orderId; const s2 = r.body.sig; const o2 = await get(`${T}/counterOrders/${id2}`);
  paid(o2.ahead.payId);
  S.event = { type: 'charge.succeeded', account: 'acct_1', data: { object: { id: 'ch_2', object: 'charge', amount: 550, paid: true, refunded: false, payment_intent: o2.ahead.payId, metadata: clone(S.pis.get(o2.ahead.payId).metadata) } } };
  await handleConnectWebhook(req({}));
  const t2 = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id2);
  const o2b = await get(`${T}/counterOrders/${id2}`);
  check('the guest closed the page before it said so: the card company’s notice sends it and pays it', o2b.paidAt && o2b.status === 'sent' && t2.length === 1, { o2b, t2 });
  check('for a later time: wanted at that time, and the kitchen waits until it’s time to start (its slowest item and two minutes before)', t2[0]?.dueAt === later && t2[0]?.holdUntil === new Date(Date.parse(later) - (240 + 120) * 1000).toISOString(), t2[0]);
  r = await A({ action: 'track', o: id2, s: s2 });
  check('…the order page says it will be started in time', r.body.kitchen === 'later' && r.body.way === 'inside' && r.body.at === later, r.body);
  r = await A({ action: 'here', o: id2, s: s2 });
  const t2b = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id2);
  check('I’m here: the kitchen starts now', r.body.ok && t2b.every((t: any) => !t.holdUntil) && (await get(`${T}/counterOrders/${id2}`)).ahead.hereAt, t2b);

  console.log('sold out before it was paid');
  r = await A({ ...base, key: nextKey(), name: 'Sam', lines: [{ itemId: 'fries', quantity: 2, choices: { sz: ['s'] } }] });
  const id3 = r.body.orderId; const s3 = r.body.sig; const o3 = await get(`${T}/counterOrders/${id3}`);
  await db.doc(`${T}/inventory/fries`).set({ totalStock: 0 }, { merge: true });
  paid(o3.ahead.payId);
  r = await A({ action: 'done', o: id3, s: s3 });
  const o3b = await get(`${T}/counterOrders/${id3}`);
  check('the fries ran out before it was paid: nothing made, the money goes back, and the guest is told why', r.status === 409 && r.body.notKept && /going back to your card/.test(r.body.error) && /Fries/.test(r.body.error)
    && S.refunds.filter((x: any) => x.payment_intent === o3.ahead.payId).length === 1 && o3b.ahead.state === 'canceled' && o3b.status === 'voided' && !o3b.paidAt && (await all(`${T}/kdsTickets`)).every((t: any) => t.orderId !== id3), { body: r.body, o3b });
  r = await A({ action: 'track', o: id3, s: s3 });
  check('…and the order page says it couldn’t be made', r.body.state === 'canceled' && /Fries/.test(r.body.failed), r.body);
  await db.doc(`${T}/inventory/fries`).set({ totalStock: 40 }, { merge: true });

  console.log('not paid');
  r = await A({ ...base, key: nextKey(), name: 'Lee', lines: [{ itemId: 'burger', quantity: 1 }] });
  const id4 = r.body.orderId; const o4 = await get(`${T}/counterOrders/${id4}`);
  const tenant = await get(T);
  await CC.sweepCounterCards(db, 't1', tenant, { stripe: new FakeStripe(), now: Date.now() + 10 * 60000 });
  check('the sweep leaves an unpaid order alone for its first 30 minutes', (await get(`${T}/counterOrders/${id4}`)).ahead.state === 'awaiting_pay');
  await CC.sweepCounterCards(db, 't1', tenant, { stripe: new FakeStripe(), now: Date.now() + 31 * 60000 });
  const o4b = await get(`${T}/counterOrders/${id4}`);
  check('…then it’s let go: the payment called off, the code free again, off the sweep’s list', o4b.ahead.state === 'abandoned' && o4b.status === 'voided' && o4b.cardOpen === false && S.pis.get(o4.ahead.payId).status === 'canceled' && !(await get(`${T}/aheadCodes/${o4.day}_${o4.ahead.code}`)), o4b);
  r = await A({ ...base, key: nextKey(), name: 'Ray', lines: [{ itemId: 'burger', quantity: 1 }] });
  const id5 = r.body.orderId; const o5 = await get(`${T}/counterOrders/${id5}`);
  paid(o5.ahead.payId);
  await CC.sweepCounterCards(db, 't1', tenant, { stripe: new FakeStripe(), now: Date.now() + 6 * 60000 });
  check('one paid that nobody heard about: the sweep sends it to the kitchen and pays it', (await get(`${T}/counterOrders/${id5}`)).paidAt && (await all(`${T}/kdsTickets`)).some((t: any) => t.orderId === id5));

  console.log('at the speaker');
  r = await L({ action: 'lane' });
  const list = r.body.ahead || [];
  check('the lane lists today’s paid drive-thru orders placed ahead (not inside ones, not unpaid or let go)', list.some((a: any) => a.id === id1 && a.code === o1.ahead.code && a.name === 'Jordan') && !list.some((a: any) => [id2, id3, id4].includes(a.id)), list);
  const car = (await L({ action: 'car', carKey: 'carkey-ahead-1' })).body;
  r = await L({ action: 'aheadCar', code: '0000', carId: car.carId });
  check('a code nobody has today: says so', r.status === 404 && r.body.code === 'no_code', r.body);
  r = await L({ action: 'aheadCar', code: o1.ahead.code, carId: car.carId });
  const carB = await get(`${T}/driveThruCars/${car.carId}`); const empty = await get(`${T}/counterOrders/${car.orderId}`);
  check('“I ordered ahead, code …”: the order becomes the car at the speaker, its empty order let go, straight to pickup', r.body.ok && r.body.number === 'A1' && carB.orderId === id1 && carB.stage === 'pickup' && carB.number === 'A1' && carB.ahead === true && empty.status === 'voided'
    && (await get(`${T}/counterOrders/${id1}`)).ahead.carId === car.carId, { body: r.body, carB, empty });
  r = await L({ action: 'lane' });
  check('…and it’s off the lane’s list of orders on their way', !(r.body.ahead || []).some((a: any) => a.id === id1) && r.body.cars.some((c: any) => c.id === car.carId && c.stage === 'pickup'), r.body.ahead);
  const car2 = (await L({ action: 'car', carKey: 'carkey-ahead-2' })).body;
  r = await L({ action: 'aheadCar', code: o1.ahead.code, carId: car2.carId });
  check('the same code for another car: it’s with a car already', r.status === 409 && r.body.code === 'taken', r.body);
  await L({ action: 'add', orderId: car2.orderId, itemId: 'burger', quantity: 1, tapKey: 'tap-ahead-1' });
  r = await L({ action: 'aheadCar', orderId: id5, carId: car2.carId });
  check('a car that already ordered something keeps its own order', r.status === 409 && r.body.code === 'has_order', r.body);
  r = await L({ action: 'aheadCar', orderId: id5 });
  const newCar = await get(`${T}/driveThruCars/${r.body.carId}`);
  check('no car on screen: a car is made for it, at pickup', r.body.ok && newCar.orderId === id5 && newCar.stage === 'pickup', newCar);
  r = await A({ ...base, key: nextKey(), name: 'Kim', lines: [{ itemId: 'burger', quantity: 1 }] });
  const unpaidO = await get(`${T}/counterOrders/${r.body.orderId}`);
  const rU: any = await L({ action: 'aheadCar', code: unpaidO.ahead.code });
  check('an order that isn’t paid isn’t handed out', rU.status === 409 && rU.body.code === 'unpaid', rU.body);
  await L({ action: 'move', carId: car.carId, to: 'gone' });
  r = await A({ action: 'track', o: id1, s: s1 });
  check('handed over at the window: the order page says picked up', r.body.kitchen === 'handed', r.body);

  console.log('after the review');
  const kk = nextKey();
  const ra: any = await A({ ...base, key: kk, name: 'Ava', way: 'inside', lines: [{ itemId: 'burger', quantity: 1 }] });
  const rb: any = await A({ ...base, key: kk, name: 'Ava', way: 'drive-thru', lines: [{ itemId: 'burger', quantity: 1 }] });
  check('went back and changed how they’ll pick it up: a new order (never the old one paid for)', ra.body.ok && rb.body.ok && ra.body.orderId !== rb.body.orderId && (await get(`${T}/counterOrders/${rb.body.orderId}`)).ahead.way === 'drive-thru', [ra.body, rb.body]);
  check('…and an order isn’t on the payments sweep’s list until its payment exists', (await get(`${T}/counterOrders/${ra.body.orderId}`)).cardOpen === true);
  const AH = await import('../../src/lib/counter-ahead');
  const oc = await get(`${T}/counterOrders/${rb.body.orderId}`); paid(oc.ahead.payId);
  await db.doc(`${T}/counterOrders/${rb.body.orderId}`).set({ ahead: { settlingAt: new Date().toISOString() } }, { merge: true });
  const busyR: any = await A({ action: 'done', o: rb.body.orderId, s: rb.body.sig });
  check('the page, the notice and the sweep at once: one sends it, the others wait', busyR.status === 202 && !(await get(`${T}/counterOrders/${rb.body.orderId}`)).paidAt, busyR.body);
  await db.doc(`${T}/counterOrders/${rb.body.orderId}`).set({ ahead: { settlingAt: null } }, { merge: true });
  await AH.settleAhead(db, 't1', await get(T), rb.body.orderId, oc.ahead.payId, { stripe: new FakeStripe() });
  check('…then it’s sent and paid', !!(await get(`${T}/counterOrders/${rb.body.orderId}`)).paidAt);
  // Sold out, given back; restocked a moment later and asked again: never made after it was given back.
  r = await A({ ...base, key: nextKey(), name: 'Bo', lines: [{ itemId: 'fries', quantity: 1, choices: { sz: ['s'] } }] });
  const idR = r.body.orderId; const oR = await get(`${T}/counterOrders/${idR}`);
  await db.doc(`${T}/inventory/fries`).set({ totalStock: 0 }, { merge: true }); paid(oR.ahead.payId);
  await AH.settleAhead(db, 't1', await get(T), idR, oR.ahead.payId, { stripe: new FakeStripe() });
  await db.doc(`${T}/inventory/fries`).set({ totalStock: 40 }, { merge: true });
  const again2: any = await AH.settleAhead(db, 't1', await get(T), idR, oR.ahead.payId, { stripe: new FakeStripe() });
  check('sold out and given back, then restocked and asked again: not made, not given back twice', again2.notKept && !(await get(`${T}/counterOrders/${idR}`)).paidAt && (await all(`${T}/kdsTickets`)).every((t: any) => t.orderId !== idR) && S.refunds.filter((x: any) => x.payment_intent === oR.ahead.payId).length === 1, again2);
  // Last night's order, picked up after midnight.
  r = await A({ ...base, key: nextKey(), name: 'Night', lines: [{ itemId: 'burger', quantity: 1 }] });
  const idN = r.body.orderId; const oN = await get(`${T}/counterOrders/${idN}`); paid(oN.ahead.payId);
  await A({ action: 'done', o: idN, s: r.body.sig });
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await db.doc(`${T}/counterOrders/${idN}`).set({ day: yesterday }, { merge: true });
  await db.doc(`${T}/aheadCodes/${yesterday}_${oN.ahead.code}`).set({ orderId: idN });
  await db.doc(`${T}/aheadCodes/${oN.day}_${oN.ahead.code}`).delete();
  await new Promise((res) => setTimeout(res, 4100));
  const laneN: any = await L({ action: 'lane' });
  const carN = (await L({ action: 'car', carKey: 'carkey-ahead-night' })).body;
  const atN: any = await L({ action: 'aheadCar', code: oN.ahead.code, carId: carN.carId });
  check('placed just before midnight, picked up after: still on the lane and found by its code', (laneN.body.ahead || []).some((a: any) => a.id === idN) && atN.body.ok && atN.body.number === oN.number, [atN.body]);
  // A car that left frees the order; a car that left can't take one.
  await L({ action: 'move', carId: carN.carId, to: 'gone' }).catch(() => null);
  await db.doc(`${T}/driveThruCars/${carN.carId}`).set({ stage: 'gone' }, { merge: true });
  await db.doc(`${T}/counterOrders/${idN}`).set({ status: 'sent' }, { merge: true });
  const goneTake: any = await L({ action: 'aheadCar', orderId: idN, carId: carN.carId });
  const freeAgain: any = await L({ action: 'aheadCar', orderId: idN });
  check('a car that left the lane can’t take an order, and an order whose car left can go to another', goneTake.status === 404 && freeAgain.body.ok, [goneTake.body, freeAgain.body]);
  // Inside, picked up: the kitchen screen marks it delivered.
  for (const t of (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id2)) await db.doc(`${T}/kdsTickets/${t.id}`).set({ status: 'delivered' }, { merge: true });
  r = await A({ action: 'track', o: id2, s: s2 });
  check('picked up inside (marked on the kitchen screen): the order page says picked up', r.body.kitchen === 'handed', r.body);
  // The page stopped asking before the payment went through: the order page asks the card company itself.
  r = await A({ ...base, key: nextKey(), name: 'Tess', lines: [{ itemId: 'burger', quantity: 1 }] });
  const idT = r.body.orderId; const sT = r.body.sig; paid((await get(`${T}/counterOrders/${idT}`)).ahead.payId);
  const trT: any = await A({ action: 'track', o: idT, s: sT });
  check('the order page asks the card company if the payment isn’t marked yet: paid, with its code', trT.body.paid && /^\d{4}$/.test(trT.body.code), trT.body);
  // Held tickets wait from when they're due to start, not from when they were placed.
  const held = (await all(`${T}/kdsTickets`)).find((t: any) => t.holdUntil);
  check('a ticket waiting for later counts its wait from when it’s due to start', !held || held.requestedAt === held.holdUntil, held);
  // Switched off with paid orders still to pick up: still on the lane.
  await Mn({ action: 'ahead', on: false });
  await new Promise((res) => setTimeout(res, 4100));
  r = await L({ action: 'lane' });
  check('ordering ahead switched off with paid orders still to come: they stay on the lane', (r.body.ahead || []).some((a: any) => a.id === idT), r.body.ahead);
  await Mn({ action: 'ahead', on: true });

  console.log('closed');
  await db.doc(T).set({ accessLocked: true, accessLockedAt: new Date().toISOString() }, { merge: true });
  r = await A({ action: 'menu' });
  const rp: any = await A({ ...base, key: nextKey() });
  const tr: any = await A({ action: 'track', o: id2, s: s2 });
  check('a closed business takes no new orders, but an order already paid can still be followed', r.status === 403 && rp.status === 403 && tr.body.ok === true, [r.status, rp.status, tr.status]);

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
