// Checks ordering ahead from more than one location (design board "More than one location"; lib/ahead-places,
// lib/counter-ahead aheadMenu / placeAhead / deliveryQuote / aheadToCar / aheadView, api/menu 'aheadPlace').
// - One location: nothing asked. With two: guests pick one (its hours, open or when it opens), each location's ordering
//   ahead and delivery can be turned off and its hours set; an order is stamped with its location, and its pickup code
//   and number are that location's. A delivery goes from the nearest location that delivers there.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ahead-places.verify.ts
// (Mocks below as in ahead-days.verify.)
// Was: checks orders for another day (design board "Orders for another day"; lib/ahead-days, lib/ahead-days-server,
// lib/counter-ahead, api/menu 'ahead', api/counter/ahead 'place' / 'cancel', api/counter 'lane' / 'laterSend' /
// 'laterCancel', the payments cron).
// - Settings, a manager's: on, how far ahead (3, 7, 14 or 30 days), the notice (12, 24, 48 or 72 hours), the smallest order.
// - The guest picks a day and a time it's open, from the notice on, inside, curbside or delivered (never the drive-thru),
//   with a phone number and how many people; paid when placed, in the books that day; its code and number are its day's.
// - It waits (no tickets) until a couple of hours before its time, then goes to the kitchen screen under Later until it's
//   time to start (its slowest item, more for a big order). Something that can't be made then keeps it, and the managers
//   are told once; once fixed it goes by itself, or the counter sends it.
// - Canceled for a full refund: by the guest until the notice runs out, by a manager until it goes; each line once, a
//   refund that stops partway finished by asking again; the code freed; the guest texted when the business cancels.
// - The counter's Coming up; the night report; a delivery for another day isn't from an earlier night on its day.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ahead-days.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '+18325550100';
const db: any = strictTransactions(makeDb());
let geoNow: any = { lat: 39.95, lng: -75.0, label: '9 Harbor Ct', postal: '08077', confidence: 'exact' };
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const texts: { to: string; body: string }[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
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
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() || {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  if (request === '@/lib/geocode-server' || /\/src\/lib\/geocode-server(\.ts)?$/.test(request)) {
    const real = load.call(this, request, ...rest);
    return fake(request, { ...real, hasMapsKey: () => true, geocode: async () => (geoNow as any) });
  }
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const PLAN = { on: true, by: 'distance', origin: { lat: 39.9, lng: -75.0, label: 'Main St', source: 'location' }, zones: [{ id: 'near', name: 'Near', upToMiles: 6, feeCents: 399, minimumCents: 1000 }], days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: '00:00', end: '23:59' }] };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const allWeek = (start: string, end: string) => Object.fromEntries(DAYS.map((d) => [d, { enabled: true, start, end }]));
const closedWeek = Object.fromEntries(DAYS.map((d) => [d, { enabled: false, start: '9:00 AM', end: '5:00 PM' }]));

(async () => {
  const P = await import('../../src/lib/ahead-places');
  const HS = await import('../../src/lib/here-server');
  const CA = await import('../../src/lib/counter-ahead');
  const { POST: AHEAD } = await import('../../src/app/api/counter/ahead/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  const { POST: KITCHEN } = await import('../../src/app/api/kitchen/route');

  console.log('the rules');
  check('miles apart (straight line), and a point a phone gave', Math.abs(P.milesApart({ lat: 39.9, lng: -75.0 }, { lat: 40.0, lng: -75.0 }) - 6.9) < 0.1 && P.pointOf('39.9', -75) !== null && P.pointOf(0, 0) === null && P.pointOf('x', 1) === null);
  const list = [{ id: 'a', name: 'Main St', coordinates: { lat: 39.9, lng: -75.0 } }, { id: 'b', name: 'Harbor Rd', coordinates: { lat: 39.96, lng: -75.0 } }, { id: 'c', name: 'Annex', coordinates: null }];
  const nf = P.nearestFirst(list, { lat: 39.95, lng: -75.0 }); const byName = P.nearestFirst(list, null);
  check('nearest first (one without a pin last); without a point, by name', nf.map((x) => x.id).join() === 'b,a,c' && nf[0].miles === 0.7 && byName.map((x) => x.id).join() === 'c,b,a', nf);
  const nowT = Date.parse('2026-11-23T15:00:00.000Z');
  check('open now and until when; closed, and when it opens next', P.openWords(allWeek('9:00 AM', '9:00 PM'), 'Etc/UTC', nowT).open && P.openWords(allWeek('9:00 AM', '9:00 PM'), 'Etc/UTC', nowT).until === '2026-11-23T21:00:00.000Z'
    && P.openWords(allWeek('6:00 PM', '11:00 PM'), 'Etc/UTC', nowT).opens === '2026-11-23T18:00:00.000Z' && !P.openWords(closedWeek, 'Etc/UTC', nowT).open && P.openWords(closedWeek, 'Etc/UTC', nowT).opens === null);
  check('a week as typed: each day open or closed with its times; anything else isn’t one', !!P.cleanWeek(allWeek('7:00 AM', '10:00 PM')) && P.cleanWeek({ monday: { enabled: true, start: '25:00', end: '5:00 PM' } }) === null && P.cleanWeek('x') === null
    && P.cleanWeek({ monday: { enabled: true, start: '7:00 AM', end: '3:00 PM' } })!.tuesday.enabled === false);
  check('its own hours, or the business’s', P.weekOf({ ordering: { ahead: true, delivery: true, hours: { a: 1 } } } as any, { b: 2 } as any)!.a === 1 && (P.weekOf({ ordering: { ahead: true, delivery: true, hours: null } } as any, { b: 2 } as any) as any).b === 2);

  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, retailSettings: { taxRatePercent: 10, deliveryPlan: PLAN }, salesTax: { configured: true }, publicOrigin: 'https://app.test' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Burgers', price: 5, totalStock: 100, makeSeconds: 240 });
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true, address: '1 Main St', coordinates: { lat: 39.9, lng: -75.0 } });
  const A = (b: any) => AHEAD(req({ tenantId: 't1', ...b })) as any;
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b })) as any;
  let k = 0; const nextKey = () => `placekey${++k}`;
  await Mn({ action: 'ahead', on: true });
  await Mn({ action: 'ahead', delivery: true });

  console.log('one location');
  let r: any = await A({ action: 'menu' });
  check('one location: nothing to pick, nothing listed', r.body.ok && !r.body.pick && (r.body.places || []).length === 0 && r.body.place === null, { pick: r.body.pick, places: r.body.places });
  const lines = [{ itemId: 'burger', quantity: 2 }];
  r = await A({ action: 'place', key: nextKey(), name: 'Maya', way: 'inside', lines });
  const o0 = await get(`${T}/counterOrders/${r.body.orderId}`);
  check('…an order isn’t stamped, and its code is the day’s', r.body.ok && !o0.locationId && !!(await get(`${T}/aheadCodes/${o0.day}_${o0.ahead.code}`)), r.body);

  console.log('two locations: the settings');
  await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true, address: '88 Harbor Rd', coordinates: { lat: 39.96, lng: -75.0 } });
  HS.forgetLocations('t1');
  r = await Mn({ action: 'list' });
  const ps = r.body.ahead?.places || [];
  check('the Menu page lists each location: ordering ahead and delivery on, the business’s hours, its own link', ps.length === 2 && ps.every((p: any) => p.ahead && p.delivery && p.hours === null && p.pinned) && ps.find((p: any) => p.id === 'main')?.link.endsWith('/order/t1?place=main'), ps);
  const badH: any = await Mn({ action: 'aheadPlace', id: 'harbor', hours: { monday: { enabled: true, start: '9 o’clock', end: '5:00 PM' } } });
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  const staffT: any = await Mn({ action: 'aheadPlace', id: 'harbor', ahead: false });
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  const noLoc: any = await Mn({ action: 'aheadPlace', id: 'nowhere', ahead: false });
  r = await Mn({ action: 'aheadPlace', id: 'harbor', hours: closedWeek });
  const hp = (r.body.ahead?.places || []).find((p: any) => p.id === 'harbor');
  check('a manager sets a location’s own hours (only real hours, only a manager, only their location)', badH.status === 400 && staffT.status === 403 && noLoc.status === 404 && r.body.ok && hp?.hours?.monday?.enabled === false, [badH.body, staffT.status, noLoc.status, hp]);

  console.log('the guest picks');
  r = await A({ action: 'menu' });
  const rows = r.body.places || [];
  check('with two: pick one first; each with whether it’s open now', r.body.pick === true && rows.length === 2 && rows.find((p: any) => p.id === 'main')?.open === true && rows.find((p: any) => p.id === 'harbor')?.open === false && rows.find((p: any) => p.id === 'harbor')?.opens === null, rows);
  r = await A({ action: 'menu', place: 'harbor' });
  check('…picked, its own hours: closed every day, so no times', r.body.place?.id === 'harbor' && r.body.closedNow === true && r.body.times.length === 0, { place: r.body.place, closed: r.body.closedNow });
  r = await A({ action: 'menu', place: 'main' });
  check('…the other: open, with times, and the others to change to', r.body.place?.name === 'Main St' && r.body.times.length > 0 && (r.body.places || []).length === 2, { place: r.body.place, times: r.body.times?.length });
  const noPlace: any = await A({ action: 'place', key: nextKey(), name: 'Maya', way: 'inside', lines });
  const closedThere: any = await A({ action: 'place', key: nextKey(), name: 'Maya', way: 'inside', lines, place: 'harbor' });
  check('placing: which location is asked; one closed now says so', noPlace.status === 400 && noPlace.body.code === 'place' && closedThere.status === 409 && closedThere.body.code === 'closed_now', [noPlace.body, closedThere.body]);
  r = await A({ action: 'place', key: nextKey(), name: 'Maya', way: 'inside', lines, place: 'main' });
  const o1 = await get(`${T}/counterOrders/${r.body.orderId}`);
  check('placed at Main St: stamped there, its code and number that location’s', r.body.ok && o1.locationId === 'main' && !!(await get(`${T}/aheadCodes/${o1.day}_main_${o1.ahead.code}`)) && !!(await get(`${T}/orderCounters/${o1.day}_main`)), { body: r.body, loc: o1?.locationId });
  await Mn({ action: 'aheadPlace', id: 'harbor', hours: null });
  await Mn({ action: 'aheadPlace', id: 'harbor', ahead: false });
  r = await A({ action: 'menu' });
  const off: any = await A({ action: 'place', key: nextKey(), name: 'Maya', way: 'inside', lines, place: 'harbor' });
  const offO = off.body.ok ? await get(`${T}/counterOrders/${off.body.orderId}`) : null;
  check('a location not taking orders ahead: not offered; with one left, it’s the one (nothing to pick)', !r.body.pick && r.body.place?.id === 'main' && (r.body.places || []).length === 1 && offO?.locationId === 'main', { pick: r.body.pick, place: r.body.place, off: off.body, loc: offO?.locationId });
  await Mn({ action: 'aheadPlace', id: 'main', ahead: false });
  r = await A({ action: 'menu' });
  const offAll: any = await A({ action: 'place', key: nextKey(), name: 'Maya', way: 'inside', lines, place: 'main' });
  const offDel: any = await A({ action: 'deliveryCheck', address: { line1: '9 Harbor Ct', city: 'Riverton', state: 'NJ', postalCode: '08077' }, lines });
  check('…neither taking orders ahead: off, never taken without a location', r.body.on === false && offAll.status === 409 && offAll.body.code === 'off' && offDel.status === 409 && offDel.body.code === 'delivery_off', [r.body.on, offAll.body, offDel.body]);
  await Mn({ action: 'aheadPlace', id: 'main', ahead: true });
  await Mn({ action: 'aheadPlace', id: 'harbor', ahead: true });
  // (A location turned off a moment ago takes no more: placing reads them again, not the minute's copy.)
  await db.doc(`${T}/locations/harbor`).update({ 'ordering.aheadOff': true });
  const stale: any = await A({ action: 'place', key: nextKey(), name: 'Maya', way: 'inside', lines, place: 'harbor' });
  const staleO = stale.body.ok ? await get(`${T}/counterOrders/${stale.body.orderId}`) : null;
  check('…placing reads the locations afresh: one just turned off isn’t used', staleO?.locationId === 'main', { body: stale.body, loc: staleO?.locationId });
  await Mn({ action: 'aheadPlace', id: 'harbor', ahead: true });

  console.log('delivered from the nearest');
  const addr = { line1: '9 Harbor Ct', city: 'Riverton', state: 'NJ', postalCode: '08077' };
  geoNow = { lat: 39.955, lng: -75.0, label: '9 Harbor Ct', postal: '08077', confidence: 'exact' };
  r = await A({ action: 'deliveryCheck', address: addr, lines, place: 'main' });
  check('an address nearer Harbor Rd: from there, measured from its own address', r.body.ok && r.body.from?.id === 'harbor' && r.body.driveMin === 5, r.body);
  await Mn({ action: 'aheadPlace', id: 'harbor', delivery: false });
  const hd = await get(`${T}/locations/harbor`);
  check('…its settings changed one at a time, the rest kept', hd.ordering.deliveryOff === true && hd.ordering.aheadOff === false && hd.ordering.hours === null, hd.ordering);
  r = await A({ action: 'deliveryCheck', address: addr, lines, place: 'main' });
  check('…Harbor Rd not delivering: from Main St instead', r.body.ok && r.body.from?.id === 'main' && r.body.driveMin === 14, r.body);
  await Mn({ action: 'aheadPlace', id: 'harbor', delivery: true });
  geoNow = { lat: 40.2, lng: -75.0, label: 'Far away', postal: '08077', confidence: 'exact' };
  r = await A({ action: 'deliveryCheck', address: addr, lines, place: 'main' });
  check('…too far from either: not delivered', r.status === 409 && r.body.code === 'delivery_outside', r.body);
  geoNow = { lat: 39.955, lng: -75.0, label: '9 Harbor Ct', postal: '08077', confidence: 'exact' };
  r = await A({ action: 'place', key: nextKey(), name: 'Dee', way: 'delivery', address: addr, phone: '8325550150', lines, place: 'main' });
  const od = await get(`${T}/counterOrders/${r.body.orderId}`);
  check('a delivery placed while Main St was picked: made at Harbor Rd, the one it goes from', r.body.ok && od.locationId === 'harbor' && !!(await get(`${T}/aheadCodes/${od.day}_harbor_${od.ahead.code}`)), { body: r.body, loc: od?.locationId });
  r = await A({ action: 'place', key: nextKey(), name: 'Dee', way: 'delivery', address: addr, phone: '8325550150', lines, place: 'main', deliveryFrom: 'main' });
  const oq = r.body.ok ? await get(`${T}/counterOrders/${r.body.orderId}`) : null;
  check('…placed after a check that said Main St: from Main St, the fee and drive they saw (never swapped unseen)', oq?.locationId === 'main' && oq?.ahead?.delivery?.driveMin === 14, { body: r.body, loc: oq?.locationId });
  await Mn({ action: 'aheadPlace', id: 'harbor', delivery: false });
  const moved: any = await A({ action: 'place', key: nextKey(), name: 'Dee', way: 'delivery', address: addr, phone: '8325550150', lines, place: 'main', deliveryFrom: 'harbor' });
  const junk: any = await A({ action: 'place', key: nextKey(), name: 'Dee', way: 'delivery', address: addr, phone: '8325550150', lines, place: 'main', deliveryFrom: 'nowhere' });
  check('…the one their check said stopped delivering: they check the address again', moved.status === 409 && moved.body.code === 'delivery_changed' && junk.body.code === 'delivery_changed', [moved.body, junk.body]);
  await Mn({ action: 'aheadPlace', id: 'harbor', delivery: true });

  console.log('at the lane, and the guest’s page');
  const kitchen = (b: any) => KITCHEN(req({ tenantId: 't1', ...b })) as any;
  paid(S.pis.get(o1.ahead.payId).id); await A({ action: 'done', o: o1.id, s: CA.aheadSig('t1', o1.id) });
  const keyMain = (await kitchen({ action: 'pair', name: 'Lane', kind: 'drive-thru', locationId: 'main' })).body.key;
  const keyHarbor = (await kitchen({ action: 'pair', name: 'Lane 2', kind: 'drive-thru', locationId: 'harbor' })).body.key;
  const atHarbor: any = await LANE(req({ tenantId: 't1', key: keyHarbor, action: 'aheadCar', code: o1.ahead.code }));
  const atMain: any = await LANE(req({ tenantId: 't1', key: keyMain, action: 'aheadCar', code: o1.ahead.code }));
  check('its code at the other location’s lane: not found; at its own: found', atHarbor.status === 404 && atMain.body.ok && atMain.body.number === o1.number, [atHarbor.body, atMain.body]);
  const legacy: any = await LANE(req({ tenantId: 't1', key: keyHarbor, action: 'aheadCar', code: o0.ahead.code }));
  check('…one from before there were two: found at either', legacy.status !== 404 || /isn’t paid/.test(String(legacy.body.error || '')), legacy.body);
  const tn = await get(T); const who = { id: 'm1', name: 'Ana Ruiz' };
  const unplaced: any = await CA.aheadToCar(db, 't1', tn, { code: o1.ahead.code }, who, null);
  check('…a lane not set to a location: every location’s codes (found, already with the car at Main St)', unplaced.code === 'taken', unplaced);
  await db.doc(`${T}/aheadCodes/${o1.day}_harbor_${o1.ahead.code}`).set({ orderId: od.id });
  const twice: any = await CA.aheadToCar(db, 't1', tn, { code: o1.ahead.code }, who, null);
  check('…the same code at two locations: set the screen to its location first', twice.status === 409 && twice.code === 'two_codes', twice);
  await db.doc(`${T}/aheadCodes/${o1.day}_harbor_${o1.ahead.code}`).delete();
  // (Back to one location the same day: an order placed at the one closed is still found by its code.)
  const parked = await get(`${T}/locations/harbor`); await db.doc(`${T}/locations/harbor`).delete(); HS.forgetLocations('t1');
  const odCode = od.ahead.code; await db.doc(`${T}/counterOrders/${od.id}`).update({ 'ahead.way': 'inside' });
  const backToOne: any = await CA.aheadToCar(db, 't1', tn, { code: odCode }, who, null);
  check('…back to one location: an order from the one closed still found by its code', backToOne.code !== 'no_code', backToOne);
  await db.doc(`${T}/counterOrders/${od.id}`).update({ status: 'voided', 'ahead.state': 'canceled', paidAt: new Date().toISOString() });
  const voided: any = await CA.aheadToCar(db, 't1', tn, { code: odCode }, who, null);
  check('…one canceled and refunded: never found by its code', voided.status === 404 && voided.code === 'no_code', voided);
  await db.doc(`${T}/counterOrders/${od.id}`).update({ 'ahead.way': 'delivery', status: 'building', 'ahead.state': 'awaiting_pay', paidAt: FV.delete() }); await db.doc(`${T}/locations/harbor`).set(parked); HS.forgetLocations('t1');
  r = await A({ action: 'track', o: o1.id, s: CA.aheadSig('t1', o1.id) });
  check('their page says where: the location and its address', r.body.place?.name === 'Main St' && r.body.place?.address === '1 Main St', r.body.place);

  console.log('the pages');
  const page = src('src/app/order/[tenantId]/page.tsx'); const card = src('src/components/menu/PlacesCard.tsx');
  check('the guest’s page: Where are you ordering from, Find the nearest, the one picked with Change, sent with each call', /Where are you ordering from\?/.test(page) && /Find the nearest/.test(page) && />Change</.test(page) && /\.\.\.menuPlace\(\)/.test(page) && /cf\.ahead\.place\./.test(page) && /deliveryFrom: dcheck\.from\.id/.test(page));
  check('the Menu page: each location’s ordering, delivery, hours, link and code', /Your locations/.test(card) && /Takes orders ahead/.test(card) && /Delivers from here/.test(card) && /Same as the business/.test(card) && /Save its code/.test(card) && /<PlacesCard/.test(src('src/components/menu/OrderAheadCard.tsx')));
  check('house style', ![card, src('src/lib/ahead-places.ts')].some((x) => / · |\buppercase\b|font-black|call us|contact us/i.test(x)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
