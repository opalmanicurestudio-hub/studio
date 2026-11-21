// Checks the online shop at more than one store (design board "The online shop at more than one store"; lib/shop-stores,
// lib/shop-stores-server, api/retail/stores, api/retail/pickup-times 'at', api/retail/delivery-quote, api/retail/checkout,
// api/retail/order-status, api/menu 'places' / 'aheadPlace' shop).
// - One location: no stores, checkout as before. With two: the Find a store list (where, open now, directions); pickup
//   asks which store, the order is stamped with it; pickup times fill for each store alone and stay inside a store's own
//   hours; a store can be taken off the shop (one left: picked by itself; none: no pickup).
// - A delivery goes from the nearest store that delivers there; placing it keeps the store the customer's check said, or
//   asks them to check again. Stores not yet located on the map: from the shop's own starting point.
// - The customer's order page names the store, with directions, and its arrival pin is that store.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/shop-stores.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let geoNow: any = { lat: 39.955, lng: -75.0, label: '9 Harbor Ct', postal: '08077', confidence: 'exact' };
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
function StripeMock(this: any) { return { coupons: { create: async () => ({ id: 'co_1' }) }, checkout: { sessions: { create: async () => ({ id: 'cs_x', url: 'https://stripe.test/x' }) } } }; }
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() || {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null, visitorIp: () => '1.2.3.4' });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async () => ({ ok: true }) });
  if (request === '@/lib/loyalty-server' || /loyalty-server(\.ts)?$/.test(request)) return fake(request, { earnForShopOrder: async () => undefined });
  if (request === '@/lib/geocode-server' || /\/src\/lib\/geocode-server(\.ts)?$/.test(request)) {
    const real = load.call(this, request, ...rest);
    return fake(request, { ...real, hasMapsKey: () => true, geocode: async () => (geoNow as any) });
  }
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams() } }) as any;
const getReq = (q: Record<string, string>) => ({ headers: { get: () => null }, nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams(q) } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const closedWeek = Object.fromEntries(DAYS.map((d) => [d, { enabled: false, start: '9:00 AM', end: '5:00 PM' }]));
const allDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [{ open: '00:00', close: '24:00' }]]));
const PLAN = { on: true, by: 'distance', origin: { lat: 39.9, lng: -75.0, label: 'Main St', source: 'location' }, zones: [{ id: 'near', name: 'Near', upToMiles: 6, feeCents: 399, minimumCents: 1000 }], days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: '00:00', end: '23:59' }], perWindow: null, daysAhead: 3 };
const addr = { line1: '9 Harbor Ct', city: 'Riverton', state: 'NJ', postalCode: '08077' };

(async () => {
  const S = await import('../../src/lib/shop-stores');
  const SS = await import('../../src/lib/shop-stores-server');
  const HS = await import('../../src/lib/here-server');
  const { GET: STORES } = await import('../../src/app/api/retail/stores/route');
  const { GET: TIMES } = await import('../../src/app/api/retail/pickup-times/route');
  const { POST: QUOTE } = await import('../../src/app/api/retail/delivery-quote/route');
  const { POST: CHECKOUT } = await import('../../src/app/api/retail/checkout/route');
  const { POST: MENU } = await import('../../src/app/api/menu/route');

  console.log('the rules');
  const wk = { monday: { enabled: true, start: '9:00 AM', end: '5:00 PM' } };
  const mon = (h: number) => Date.parse(`2026-11-23T${String(h).padStart(2, '0')}:00:00.000Z`);
  check('a pickup time inside a store’s hours, or not; no hours: always', S.insideWeek(wk, 'Etc/UTC', mon(10), mon(11)) && !S.insideWeek(wk, 'Etc/UTC', mon(8), mon(9)) && !S.insideWeek(wk, 'Etc/UTC', mon(16), mon(18)) && S.insideWeek(null, 'Etc/UTC', mon(1), mon(2)));
  const nowT = Date.parse('2026-11-23T15:00:00.000Z');
  check('open now and until when; when it opens, today, tomorrow or later', S.storeOpenLine({ open: true, until: '2026-11-23T21:00:00.000Z', opens: null }, 'Etc/UTC', nowT) === 'Open until 9 PM'
    && S.storeOpenLine({ open: false, until: null, opens: '2026-11-23T18:30:00.000Z' }, 'Etc/UTC', nowT) === 'Closed, opens 6:30 PM'
    && S.storeOpenLine({ open: false, until: null, opens: '2026-11-24T10:00:00.000Z' }, 'Etc/UTC', nowT) === 'Closed, opens 10 AM tomorrow'
    && S.storeOpenLine({ open: false, until: null, opens: '2026-11-26T10:00:00.000Z' }, 'Etc/UTC', nowT) === 'Closed, opens Thursday 10 AM'
    && S.storeOpenLine({ open: false, until: null, opens: null }, 'Etc/UTC', nowT) === 'Closed', [S.storeOpenLine({ open: false, until: null, opens: '2026-11-26T10:00:00.000Z' }, 'Etc/UTC', nowT)]);
  check('directions in the phone’s own maps', S.directionsTo('1 Main St, Riverton') === 'https://www.google.com/maps/dir/?api=1&destination=1%20Main%20St%2C%20Riverton');

  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', stripeAccountId: 'acct_1', retailSettings: { taxRatePercent: 0, prepMinutes: 15, pickupPlan: { hours: allDay, perWindow: 1, daysAhead: 3 }, deliveryPlan: PLAN }, publicOrigin: 'https://app.test' });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Candle', msrp: 50, retailPriceCents: 5000, price: 50, totalStock: 100, stockReserved: 0, showOnline: true, status: 'active', type: 'retail' });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'ABCD-EFGH', codeKey: 'ABCDEFGH', balanceCents: 10000000, status: 'active', holds: {}, history: [] });
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true, address: '1 Main St, Riverton', coordinates: { lat: 39.9, lng: -75.0 } });
  let k = 0; const ck = () => `checkoutkey-${String(++k).padStart(8, '0')}`;
  const times = async (at = '') => (await TIMES(getReq({ tenantId: 't1', ck: 'timeskey-aaaaaaaaaaaa', fresh: '1', ...(at ? { at } : {}) })) as any).body;
  const buy = async (x: any) => (await CHECKOUT(req({ tenantId: 't1', items: [{ productId: 'p1', qty: 1 }], method: 'counter', customer: { name: 'Maya Chen', email: 'maya@example.com', phone: '8325550150' }, giftCode: 'ABCD-EFGH', checkoutKey: ck(), ...x })) as any);
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b })) as any;

  console.log('one location');
  let r: any = (await STORES(getReq({ tenantId: 't1' })) as any).body;
  check('no stores to list', r.several === false && r.stores.length === 0, r);
  let tw = await times(); const w1 = tw.windows.find((w: any) => !w.full)?.key;
  r = await buy({ pickupWindowKey: w1 });
  const o0 = r.body.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('…checkout as before: nothing asked, nothing stamped', r.status === 200 && !!o0 && !o0.locationId && !o0.pickupStore, r.body);

  console.log('two stores');
  await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true, address: '88 Harbor Rd, Riverton', coordinates: { lat: 39.96, lng: -75.0 } });
  HS.forgetLocations('t1');
  const rows = await SS.storeRows(db, 't1', await get(T), (await SS.shopStoresOf(db, 't1')).stores);
  check('Find a store: both, with where, open now and directions', rows.length === 2 && rows.every((x) => x.open && !!x.directions && x.delivers) && rows.map((x) => x.name).join() === 'Harbor Rd,Main St', rows);
  const noStore = await buy({ pickupWindowKey: w1 });
  check('pickup asks which store', noStore.status === 400 && noStore.body.pickupStore === true, noStore.body);
  tw = await times('harbor'); const wh = tw.windows.find((w: any) => !w.full)?.key;
  r = await buy({ pickupWindowKey: wh, pickupStore: 'harbor' });
  const o1 = r.body.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('…picked: stamped with the store, its name and address on the order', r.status === 200 && o1?.locationId === 'harbor' && o1?.pickupStore?.name === 'Harbor Rd' && o1?.pickupStore?.address === '88 Harbor Rd, Riverton', { body: r.body, o: o1 && { loc: o1.locationId, ps: o1.pickupStore } });
  const atHarbor = (await times('harbor')).windows.find((w: any) => w.key === wh); const atMain = (await times('main')).windows.find((w: any) => w.key === wh);
  check('each store’s pickup times fill for it alone (one a time here: full at Harbor Rd, open at Main St)', atHarbor?.full === true && atMain?.full === false, [atHarbor, atMain]);
  const fullThere = await buy({ pickupWindowKey: wh, pickupStore: 'harbor' });
  r = await buy({ pickupWindowKey: wh, pickupStore: 'main' });
  check('…a full time at one store is turned back; the same time at the other is taken', fullThere.status === 409 && r.status === 200 && (await get(`${T}/retailOrders/${r.body.orderId}`))?.locationId === 'main', [fullThere.status, fullThere.body?.error, r.status]);

  console.log('each store’s settings');
  r = await Mn({ action: 'places' });
  const hp = (r.body.places || []).find((p: any) => p.id === 'harbor');
  check('Shop settings, Your stores: each on the shop, with its own shop link, and the Find a store link', r.body.ok && hp?.shop === true && hp?.shopLink === 'https://app.test/shop/t1?store=harbor' && r.body.storesLink === 'https://app.test/shop/t1/stores', { hp, link: r.body.storesLink });
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  const staffT: any = await Mn({ action: 'aheadPlace', id: 'harbor', shop: false });
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  check('…only a manager changes them', staffT.status === 403, staffT.status);
  await Mn({ action: 'aheadPlace', id: 'harbor', hours: closedWeek });
  tw = await times('harbor'); const tm = await times('main');
  check('a store with its own hours: only pickup times inside them (closed all week: none); the other store’s are as they were', tw.windows.length === 0 && tm.windows.length > 0, [tw.windows.length, tm.windows.length]);
  await Mn({ action: 'aheadPlace', id: 'harbor', hours: null });
  r = await Mn({ action: 'aheadPlace', id: 'harbor', shop: false });
  const hd = await get(`${T}/locations/harbor`);
  check('…taken off the shop (the rest of its settings kept)', r.body.ok && hd.ordering.shopOff === true && hd.ordering.hours === null && hd.ordering.aheadOff === undefined, hd.ordering);
  r = await buy({ pickupWindowKey: (await times('main')).windows.find((w: any) => !w.full)?.key });
  check('…one store left on the shop: picked by itself', r.status === 200 && (await get(`${T}/retailOrders/${r.body.orderId}`))?.locationId === 'main', r.body);
  await Mn({ action: 'aheadPlace', id: 'main', shop: false });
  r = await buy({ pickupWindowKey: w1 });
  check('…none on the shop: no pickup (never an order no store will see)', r.status === 409 && r.body.pickupStore === true, r.body);
  await Mn({ action: 'aheadPlace', id: 'main', shop: true }); await Mn({ action: 'aheadPlace', id: 'harbor', shop: true });

  console.log('delivered from the nearest store');
  const quote = async () => (await QUOTE(req({ tenantId: 't1', address: addr, itemsCents: 5000 })) as any).body;
  let q = await quote();
  check('an address nearer Harbor Rd: from there, measured from its own address', q.ok && q.from?.id === 'harbor' && q.miles < 1, { from: q.from, miles: q.miles });
  const win = q.windows.find((w: any) => !w.full)?.key;
  const deliver = (x: any) => buy({ method: 'delivery', shippingAddress: { ...addr, name: '', country: 'US' }, deliveryWindowKey: win, deliveryToken: q.token, ...x });
  r = await deliver({ deliveryFrom: 'harbor' });
  const od = r.body.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('…placed: goes out from Harbor Rd', r.status === 200 && od?.locationId === 'harbor' && od?.deliveryFrom?.name === 'Harbor Rd' && !od?.pickupStore, { body: r.body, loc: od?.locationId, from: od?.deliveryFrom });
  await Mn({ action: 'aheadPlace', id: 'harbor', delivery: false });
  r = await deliver({ deliveryFrom: 'harbor' });
  check('…Harbor Rd stopped delivering before they paid: they check the address again', r.status === 409 && r.body.deliveryProblem === 'changed', r.body);
  q = await quote();
  check('…checked again: from Main St, with its own fee and distance', q.ok && q.from?.id === 'main' && q.miles > 3, { from: q.from, miles: q.miles });
  await Mn({ action: 'aheadPlace', id: 'harbor', delivery: true });
  const bare = [{ id: 'a', name: 'Annex', address: null, coordinates: null, timezone: null, ordering: { ahead: true, delivery: true, shop: true, hours: null } }, { id: 'b', name: 'Barn', address: null, coordinates: null, timezone: null, ordering: { ahead: true, delivery: false, shop: true, hours: null } }];
  const sd = await SS.storeDelivery(db, 't1', await get(T), addr, { itemsCents: 5000 }, bare as any);
  check('stores not yet located on the map: from the shop’s own starting point (the one that delivers)', sd.v.ok && sd.from?.id === 'a', { ok: sd.v.ok, from: sd.from?.id });

  console.log('the customer’s page');
  let status: any = null;
  try { const { GET: STATUS } = await import('../../src/app/api/retail/order-status/route'); status = ((await STATUS(getReq({ tenantId: 't1', orderId: o1.id }))) as any).body; } catch (e: any) { status = { err: String(e?.message || e) }; }
  check('their order page names the store, with directions, and the arrival pin is that store', status?.order?.pickupStore?.name === 'Harbor Rd' && /destination=88%20Harbor%20Rd/.test(String(status?.order?.pickupStore?.directions || '')) && status?.shopGeo?.lat === 39.96, { ps: status?.order?.pickupStore, geo: status?.shopGeo, err: status?.err || status?.error });

  console.log('the pages');
  const page = src('src/app/shop/[tenantId]/stores/page.tsx'); const co = src('src/app/shop/[tenantId]/checkout/page.tsx'); const chrome = src('src/components/shop/ShopChrome.tsx');
  check('Find a store: Find the nearest, Shop this store, Directions', /Find a store/.test(page) && /Find the nearest/.test(page) && /Shop this store/.test(page) && />Directions</.test(page));
  check('checkout: Pick up at, nearest first, the store sent, the delivery’s store kept', />Pick up at</.test(co) && /pickupStore: store/.test(co) && /deliveryFrom: deliveryOk\?\.from\?\.id/.test(co) && /mi from \$\{dqFresh\.from \? dqFresh\.from\.name : 'the shop'\}/.test(co) && /&at=/.test(co));
  check('the shop’s header, menu and footer link Find a store once there are two', /'Find a store', `\$\{base\}\/stores`/.test(chrome) && /Find a store/.test(src('src/components/shop/ShopMenu.tsx')) && /saveStore\(site\.tenantId/.test(chrome));
  check('Shop settings: Your stores; Pickups: each store’s own', /On your shop/.test(src('src/components/menu/PlacesCard.tsx')) && /<ShopStoresCard/.test(src('src/app/(app)/retail-orders/settings/page.tsx')) && /Every store/.test(src('src/components/orders/PickupsScreen.tsx')));
  check('the ready text and the order email name the store and its address', /o\.pickupStore\?\.id \? \[o\.pickupStore\.name, o\.pickupStore\.address\]/.test(src('src/app/api/retail/ready-notify/route.ts')) && /Pick it up at <strong>\$\{escapeHtml\(String\(order\.pickupStore\.name\)\)\}/.test(src('src/lib/retail-webhook.ts')) && /\$\{pickupNote\}\$\{storeNote\}/.test(src('src/lib/retail-webhook.ts')));
  check('Curbside: only this store’s shop pickups and arrivals', /const mine = React\.useMemo\(\(\) => \(here \? orders\.filter\(\(o\) => atHere\(o, here\)\)/.test(src('src/components/orders/CurbsideScreen.tsx')) && /useArrivalAlerts\(cafeLoaded \? mine : \[\],/.test(src('src/components/orders/CurbsideScreen.tsx')) && /curbsideBoard\(mine,/.test(src('src/components/orders/CurbsideScreen.tsx')) && /setHere\(typeof d\.here === 'string'/.test(src('src/components/orders/CurbsideScreen.tsx')) && /ok: true, here, cafe:/.test(src('src/app/api/curbside/route.ts')));
  check('pickup times keep inside the store’s hours, its own or the business’s (the same ones its open line uses)', /week: await storeWeekOf\(db, tenantId, fromStore\)/.test(src('src/app/api/retail/checkout/route.ts')) && /week: await storeWeekOf\(db, tenantId, store\)/.test(src('src/app/api/retail/pickup-times/route.ts')));
  check('house style', ![page, src('src/lib/shop-stores.ts'), src('src/lib/shop-stores-server.ts'), src('src/components/settings/ShopStoresCard.tsx')].some((x) => / · |\buppercase\b|font-black|call us|contact us/i.test(x)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
