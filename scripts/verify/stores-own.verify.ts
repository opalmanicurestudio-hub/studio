// Checks each store running on its own (design board "Each store runs on its own"; lib/here-server zoneOf / zonedFor /
// zonedHere, lib/locate-server, api/menu 'places', api/locations/create, lib/counter-ahead, api/counter, api/kitchen).
// - A location's own time zone: kept where it's other than the business's (the old New York default only in the east);
//   ordering ahead, its codes and its screens run on it. A new location starts on the business's.
// - A location with an address and no pin is found on the map by itself, once per address; not found says so.
// - Your stores says when a store's hours leave none of the pickup times.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/stores-own.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '+18325550100';
const db: any = strictTransactions(makeDb());
let geoNow: any = { lat: 39.95, lng: -75.0, label: '9 Harbor Ct', postal: '08077', confidence: 'exact' }; const geoAsks: string[] = [];
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
    return fake(request, { ...real, hasMapsKey: () => true, geocode: async (a: string) => { geoAsks.push(a); return typeof geoNow === 'function' ? geoNow(a) : geoNow; } });
  }
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  if (request === '@/lib/location-allowance' || /\/src\/lib\/location-allowance(\.ts)?$/.test(request)) return fake(request, { locationAllowance: async () => ({ canAdd: true, extraMonthly: 0 }) });
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
  const HS = await import('../../src/lib/here-server');
  const LS = await import('../../src/lib/locate-server');
  const TT = await import('../../src/lib/tenant-time');
  const CA = await import('../../src/lib/counter-ahead');
  const { POST: AHEAD } = await import('../../src/app/api/counter/ahead/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  const { POST: KITCHEN } = await import('../../src/app/api/kitchen/route');
  const { POST: CREATE } = await import('../../src/app/api/locations/create/route');

  console.log('each location’s own clock');
  const biz = { timezone: 'America/Chicago' };
  check('a location in another time zone keeps its own; the same as the business’s: the business’s', HS.zoneOf(biz, { timezone: 'America/Los_Angeles' }) === 'America/Los_Angeles' && HS.zoneOf(biz, { timezone: 'America/Chicago' }) === 'America/Chicago' && HS.zoneOf(biz, null) === 'America/Chicago');
  check('…the old default (New York) counts only once the owner says it’s right, and until then they’re asked', HS.zoneOf(biz, { timezone: 'America/New_York' }) === 'America/Chicago' && HS.zoneToAsk(biz, { timezone: 'America/New_York' }) === 'America/New_York'
    && HS.zoneOf(biz, { timezone: 'America/New_York', zoneSure: true }) === 'America/New_York' && HS.zoneToAsk(biz, { timezone: 'America/New_York', zoneSure: true }) === null && HS.zoneToAsk(biz, { timezone: 'America/Los_Angeles' }) === null);
  check('…a time zone that isn’t one: the business’s', HS.zoneOf(biz, { timezone: 'Mars/Olympus' }) === 'America/Chicago');
  const z = HS.zonedFor(biz, { timezone: 'America/Los_Angeles' });
  check('the business seen from a location: the same, on its clock (unchanged when it’s the same)', TT.tenantTimeZone(z) === 'America/Los_Angeles' && HS.zonedFor(biz, { timezone: 'America/Chicago' }) === biz && TT.tenantTimeZone(biz) === 'America/Chicago');

  console.log('found on the map by itself');
  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, retailSettings: { taxRatePercent: 10, pickupPlan: { hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [{ open: '00:00', close: '24:00' }]])), perWindow: 5, daysAhead: 3 } }, salesTax: { configured: true }, publicOrigin: 'https://app.test' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Burgers', price: 5, totalStock: 100, makeSeconds: 240 });
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true, address: '1 Main St, Riverton', coordinates: { lat: 39.9, lng: -75.0 }, timezone: 'Pacific/Pago_Pago' });
  await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true, address: '88 Harbor Rd, Riverton', timezone: 'Pacific/Kiritimati' });
  await db.doc(`${T}/locations/annex`).set({ name: 'Annex', isActive: true, address: 'Nowhere Lane', timezone: 'Etc/UTC' });
  await db.doc(`${T}/locations/shed`).set({ name: 'Shed', isActive: true });
  HS.forgetLocations('t1');
  geoNow = (a: string) => (/Harbor/.test(a) ? { lat: 39.96, lng: -75.0, label: '88 Harbor Rd', postal: '08077', confidence: 'exact' } : null);
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b })) as any;
  let r: any = await Mn({ action: 'places' });
  const pl = (id: string) => (r.body.places || []).find((p: any) => p.id === id);
  const hd = await get(`${T}/locations/harbor`);
  check('a location with an address and no pin: found from its address and kept', pl('harbor')?.map === 'on' && pl('harbor')?.pinned === true && hd.coordinates?.lat === 39.96 && hd.coordinatesSource === 'address', { map: pl('harbor')?.map, c: hd.coordinates });
  check('…one not found: says so; one with no address: asks for it; one pinned by hand: left as it is', pl('annex')?.map === 'missed' && pl('shed')?.map === 'no_address' && pl('main')?.map === 'on' && (await get(`${T}/locations/main`)).coordinates.lat === 39.9, [pl('annex')?.map, pl('shed')?.map]);
  const asked = geoAsks.length; await Mn({ action: 'places' });
  check('…each address looked up once (opening the settings again asks again for none)', geoAsks.length === asked && asked === 2, geoAsks);
  await db.doc(`${T}/locations/annex`).update({ address: '9 Annex Way, Riverton' }); HS.forgetLocations('t1');
  geoNow = 'down'; r = await Mn({ action: 'places' });
  check('…its address changed: looked up again; the map service down: tried again next time', geoAsks.length === asked + 1 && pl('annex')?.map === 'not_yet' && !(await get(`${T}/locations/annex`)).geoTriedFor, pl('annex'));
  check('each location’s own time zone shown where it’s other than the business’s', r.body.houseZone === 'Etc/UTC' && pl('harbor')?.zone === 'Pacific/Kiritimati' && pl('main')?.zone === 'Pacific/Pago_Pago' && pl('annex')?.zone === null, (r.body.places || []).map((p: any) => [p.id, p.zone]));
  // A pin found from its address follows the address; one set by hand never moves.
  await db.doc(`${T}/locations/harbor`).update({ address: '90 Harbor Rd, Riverton' }); await db.doc(`${T}/locations/main`).update({ address: '3 Main St, Riverton' }); HS.forgetLocations('t1');
  geoNow = { lat: 39.961, lng: -75.001, label: '90 Harbor Rd', postal: '08077', confidence: 'exact' }; const before = geoAsks.length;
  r = await Mn({ action: 'places' });
  const h2 = await get(`${T}/locations/harbor`); const m2 = await get(`${T}/locations/main`);
  check('…its address changed: a pin found from the address is found again; one set by hand stays', h2.coordinates.lat === 39.961 && m2.coordinates.lat === 39.9 && geoAsks.slice(before).includes('90 Harbor Rd, Riverton') && !geoAsks.slice(before).some((a) => /Main St/.test(a)) && pl('harbor')?.map === 'on', { h: h2.coordinates, m: m2.coordinates, asks: geoAsks.slice(before) });
  await db.doc(`${T}/locations/harbor`).update({ address: '91 Harbor Rd, Riverton' }); HS.forgetLocations('t1'); geoNow = null;
  r = await Mn({ action: 'places' });
  const h3 = await get(`${T}/locations/harbor`);
  check('…the new address not found: the old pin is taken off, never left at the old place', !h3.coordinates && pl('harbor')?.map === 'missed', { c: h3.coordinates, map: pl('harbor')?.map });
  await db.doc(`${T}/locations/harbor`).update({ address: '88 Harbor Rd, Riverton', coordinates: { lat: 39.96, lng: -75.0 }, coordinatesSource: null }); HS.forgetLocations('t1');
  await db.doc(`${T}/locations/annex`).update({ isActive: false }); await db.doc(`${T}/locations/shed`).update({ isActive: false }); HS.forgetLocations('t1');

  console.log('the old default time zone, asked');
  await db.doc(`${T}/locations/bay2`).set({ name: 'Bay Rd', isActive: true, address: '7 Bay Rd', coordinates: { lat: 39.9, lng: -75.1 }, timezone: 'America/New_York' }); HS.forgetLocations('t1');
  r = await Mn({ action: 'places' });
  check('a location still on the old default: not used, and asked', pl('bay2')?.zone === null && pl('bay2')?.zoneAsk === 'America/New_York', pl('bay2'));
  r = await Mn({ action: 'aheadPlace', id: 'bay2', zone: 'own' });
  const b2 = await get(`${T}/locations/bay2`);
  check('…answered “its own”: kept and used from then on', r.body.ok && b2.timezoneSure === true && b2.timezone === 'America/New_York' && (r.body.ahead?.places || []).find((p: any) => p.id === 'bay2')?.zone === 'America/New_York', b2);
  await db.doc(`${T}/locations/bay2`).update({ timezoneSure: false }); HS.forgetLocations('t1');
  r = await Mn({ action: 'aheadPlace', id: 'bay2', zone: 'house' });
  const b3 = await get(`${T}/locations/bay2`);
  check('…answered “the business’s”: set to it', b3.timezone === 'Etc/UTC' && b3.timezoneSure === true && !(r.body.ahead?.places || []).find((p: any) => p.id === 'bay2')?.zoneAsk, b3);
  await db.doc(`${T}/locations/bay2`).update({ isActive: false }); HS.forgetLocations('t1');

  console.log('a new location');
  geoNow = { lat: 39.97, lng: -75.01, label: '5 Bay St', postal: '08077', confidence: 'exact' };
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, isTenantOwner: true, caps: [] };
  const made: any = await CREATE(req({ tenantId: 't1', action: 'create', name: 'Bay St', address: '5 Bay St, Riverton' }));
  const bay = made.body.id ? await get(`${T}/locations/${made.body.id}`) : null;
  check('starts on the business’s time zone (never a guess), and is found on the map', made.body.ok && bay?.timezone === 'Etc/UTC' && bay?.coordinates?.lat === 39.97, { body: made.body, tz: bay?.timezone, c: bay?.coordinates });
  if (made.body.id) await db.doc(`${T}/locations/${made.body.id}`).update({ isActive: false });
  HS.forgetLocations('t1');

  console.log('hours that leave no pickup times');
  const closed = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((d) => [d, { enabled: false, start: '9:00 AM', end: '5:00 PM' }]));
  await Mn({ action: 'aheadPlace', id: 'harbor', hours: closed });
  r = await Mn({ action: 'places', shop: true });
  check('Your stores: a store whose hours leave none of the pickup times says so; the other doesn’t', pl('harbor')?.pickupNone === true && pl('main')?.pickupNone === false, [pl('harbor')?.pickupNone, pl('main')?.pickupNone]);
  await Mn({ action: 'aheadPlace', id: 'harbor', hours: null });

  console.log('ordering ahead on each location’s clock');
  await Mn({ action: 'ahead', on: true });
  const A = (b: any) => AHEAD(req({ tenantId: 't1', ...b })) as any;
  r = await A({ action: 'menu', place: 'harbor' });
  const rows = r.body.places || [];
  check('the menu at Harbor Rd runs on its clock, and each location on the picker is worded on its own', r.body.timeZone === 'Pacific/Kiritimati' && rows.find((p: any) => p.id === 'main')?.tz === 'Pacific/Pago_Pago' && rows.find((p: any) => p.id === 'harbor')?.tz === 'Pacific/Kiritimati', { tz: r.body.timeZone, rows: rows.map((p: any) => [p.id, p.tz]) });
  const lines = [{ itemId: 'burger', quantity: 1 }];
  let k = 0; const key = () => `zonekey${++k}`;
  const oh = await A({ action: 'place', key: key(), name: 'Maya', way: 'inside', lines, place: 'harbor' });
  const om = await A({ action: 'place', key: key(), name: 'Dee', way: 'inside', lines, place: 'main' });
  const H = oh.body.ok ? await get(`${T}/counterOrders/${oh.body.orderId}`) : null; const Mo = om.body.ok ? await get(`${T}/counterOrders/${om.body.orderId}`) : null;
  const now = new Date(); const utc = TT.todayIn('Etc/UTC', now);
  check('…each order’s day is its location’s own (a day ahead of the business here, behind there)', H?.day === TT.todayIn('Pacific/Kiritimati', now) && Mo?.day === TT.todayIn('Pacific/Pago_Pago', now) && (H?.day !== utc || Mo?.day !== utc), { h: H?.day, m: Mo?.day, utc, b1: oh.body.error, b2: om.body.error });
  const kitchen = (b: any) => KITCHEN(req({ tenantId: 't1', ...b })) as any;
  const keyH = (await kitchen({ action: 'pair', name: 'Lane', kind: 'drive-thru', locationId: 'harbor' })).body.key;
  if (H) await db.doc(`${T}/counterOrders/${oh.body.orderId}`).update({ paidAt: new Date().toISOString(), 'ahead.state': 'paid' });
  const atLane: any = await LANE(req({ tenantId: 't1', key: keyH, action: 'aheadCar', code: H?.ahead?.code }));
  check('…its lane finds it by its code on that same day', atLane.body.ok === true && atLane.body.number === H?.number, atLane.body);

  console.log('the pages');
  const src = (p: string) => readFileSync(p, 'utf8');
  const card = src('src/components/menu/PlacesCard.tsx');
  check('the location cards: On the map, not found, its own time zone (asked when it’s the old default), no pickup times', /On the map/.test(card) && /We couldn’t find its address on the map/.test(card) && /the business is on/.test(card) && /Which is it on\?/.test(card) && /No pickup times coming up/.test(card));
  check('Settings, Locations: a new location starts on the business’s time zone', /setForm\(\{ \.\.\.EMPTY_FORM, timezone: tenantTimeZone\(selectedTenant\) \}\)/.test(src('src/components/settings/LocationsSettingsTab.tsx')));
  check('the counter, kitchen, speaker and kiosk run on their location’s clock', /tenant = await zonedHere\(db, tenantId, tenant, here\);/.test(src('src/app/api/counter/route.ts')) && /zonedHere\(db, tenantId, tenant, here\)/.test(src('src/app/api/kitchen/route.ts')) && /tenant = await zonedHere/.test(src('src/app/api/counter/voice/route.ts')) && /zonedHere\(db, tenantId, tenant, here\)/.test(src('src/lib/kiosk.ts')));
  check('the café curbside list and the catering messages on the location’s clock', /cafeCurbside\(db, tenantId, await zonedHere\(db, tenantId, auth\.tenant, here\)\)/.test(src('src/app/api/curbside/route.ts')) && (src('src/lib/ahead-days-server.ts').match(/zonedHere\(db, tenantId, tenant, o\.locationId/g) || []).length === 2);
  check('Settings, Locations: a pin changed there is the owner’s own; one found from an address that changed is taken off; a time zone picked there counts', /coordinates: stale \? null : coordinates \?\? null/.test(src('src/components/settings/LocationsSettingsTab.tsx')) && /timezoneSure: true/.test(src('src/components/settings/LocationsSettingsTab.tsx')));
  check('the shop: each store’s rows, pickup times and deliveries on its own clock', /tz: zoneOf\(tenant, s\)/.test(src('src/lib/shop-stores-server.ts')) && /deliveryFor\(db, tenantId, zonedFor\(tenant, s\)/.test(src('src/lib/shop-stores-server.ts')) && /const storeTenant = fromStore \? zonedFor\(tenant, fromStore\) : tenant;/.test(src('src/app/api/retail/checkout/route.ts')) && /zonedFor\(t\.data\(\), store\)/.test(src('src/app/api/retail/pickup-times/route.ts')));
  check('house style', ![card, src('src/lib/locate-server.ts')].some((x) => / · |\buppercase\b|font-black|call us|contact us/i.test(x)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
