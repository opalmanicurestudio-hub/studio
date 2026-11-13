// Checks BAGS INTO THE VAN AND ONTO THE SHELF (lib/bag-tag, lib/retail-fulfill, api/retail/fulfil):
//   - a delivery goes out only once each of its bags' tags is scanned into the van, checked on the server whatever
//     screen sends it, each time it goes out; a tag that won't scan goes out on a manager's PIN, kept on the order;
//   - a shop that turned bag scans off, and an order packed before bags were counted, go out as before;
//   - an order's bags are put away by scanning each of them, then the spot's label; the order then says which spot and
//     who put it there, and a bag on the wrong spot moves the order; a delivery brought back is put away again;
//   - put-away can't be written from a browser (firestore.rules); the screens scan bags into the van and onto the shelf,
//     and Setup has the switch and the shelf labels.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/bag-van-shelf.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.CRON_SECRET = 'test-secret';
let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
const afterJobs: Promise<any>[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn).catch(() => null)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/message-policy' || /\/src\/lib\/message-policy(\.ts)?$/.test(request)) return fake(request, { gateMessage: async () => ({ send: true }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example', searchParams: new URLSearchParams() } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const plan = { on: true, by: 'postal', days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: '10:00', end: '12:00' }], perWindow: 4, perDriver: null, drivers: [], sameDayCutoff: null, daysAhead: 3, asap: { on: false, minutes: 90 }, dropoffNotes: true,
  zones: [{ id: 'a', name: 'Close', postalCodes: ['97204'], feeCents: 500, minimumCents: 0, freeOverCents: null, expressCents: null, on: true }] };
const line = (x: any = {}) => ({ lineId: 'A', productId: 'gel', name: 'Gel color', unitPriceCents: 1500, qtyOrdered: 2, qtyScanned: 2, qtyPacked: 2, qtyShorted: 0, status: 'picked', ...x });
const fresh = async (rs: any = {}, x: any = {}) => {
  db = strictTransactions(makeDb());
  await db.doc(T).set({ name: 'Opal', timezone: 'America/Los_Angeles', retailSettings: { deliveryPlan: plan, ...rs } });
  const { pinHash } = await import('../../src/lib/approvals');
  await db.doc(`${T}/staff/m1`).set({ name: 'Andre Cole', role: 'manager', hasPin: true }); await db.doc(`${T}/staffSecrets/m1`).set({ pinHash: pinHash('t1', '4321') });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'staff', hasPin: true, authUid: 'k1' }); await db.doc(`${T}/staffSecrets/k1`).set({ pinHash: pinHash('t1', '1111') });
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', tenantId: 't1', orderNumber: 142, stage: 'ready', readyAt: '2026-11-13T10:30:00Z', method: 'delivery', lines: [line()], bagCount: 2, shelfSlot: 'A3',
    customerName: 'Dana R', customerEmail: 'dana@example.com', qrToken: 'o1.abcdef', totalCents: 3500, refundedCents: 0, placedAt: '2026-11-13T10:00:00Z', paidAt: '2026-11-13T10:00:00Z',
    shippingAddress: { line1: '88 Pine St', city: 'Portland', state: 'OR', postalCode: '97204' }, delivery: { status: 'waiting', zoneId: 'a', feeCents: 500 }, ...x });
};

(async () => {
  const B = await import('../../src/lib/bag-tag');
  const Q = await import('../../src/lib/order-qr');
  const { eventWords } = await import('../../src/lib/order-events');
  const { POST } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { const r: any = await POST(req({ tenantId: 't1', action, ...args })); await settle(); return r; };
  const O = async () => get(`${T}/retailOrders/o1`);
  const evs = async () => all(`${T}/retailOrders/o1/events`);
  const c1 = Q.makeBagCode('t1', 'o1', 1); const c2 = Q.makeBagCode('t1', 'o1', 2);

  // ── The rules, on their own ──
  const del = { method: 'delivery', lines: [line()], bagCount: 2 };
  check('a delivery’s bags are scanned into the van; a pickup’s aren’t (they’re scanned at handover)', B.bagsToLoad(del, {}) === 2 && B.bagsToLoad({ ...del, method: 'counter' }, {}) === 0);
  check('…not when the shop turned bag scans off, nor for an order packed before bags were counted', B.bagsToLoad(del, { scanBagAtHandover: false }) === 0 && B.bagsToLoad({ ...del, bagCount: undefined }, {}) === 0);
  check('bags go onto the shelf for pickups and deliveries, not pop-up orders or shipped ones',
    B.bagsToShelve({ ...del, method: 'counter' }, {}) === 2 && B.bagsToShelve(del, {}) === 2 && B.bagsToShelve({ ...del, method: 'counter', popupId: 'p1' }, {}) === 0 && B.bagsToShelve({ ...del, method: 'ship' }, {}) === 0);
  check('…unless the shop turned the shelf scan off, or bag scans altogether', B.bagsToShelve(del, { scanBagToShelf: false }) === 0 && B.bagsToShelve(del, { scanBagAtHandover: false }) === 0 && B.shelfScanOn({}) && !B.shelfScanOn({ scanBagToShelf: false }));
  check('an order waits to be put away while it’s on the ready shelf, not once it’s put away or out with its driver',
    B.needsPutAway({ ...del, stage: 'ready' }, {}) && !B.needsPutAway({ ...del, stage: 'ready', putAway: { at: 'x' } }, {}) && !B.needsPutAway({ ...del, stage: 'ready', delivery: { status: 'out' } }, {}) && !B.needsPutAway({ ...del, stage: 'packed' }, {}));
  check('a shelf label reads as its spot; typed spots work too; anything else isn’t a spot',
    B.parseSpot('SPOT-A3') === 'A3' && B.parseSpot(' spot-f12 ') === 'F12' && B.parseSpot('b2') === 'B2' && B.parseSpot('SPOT-OVERFLOW') === 'Overflow' && B.parseSpot('overflow') === 'Overflow'
    && B.parseSpot('012345678905') === null && B.parseSpot(c1) === null && B.parseSpot('TOTE-04') === null);
  check('…and only a spot the shelf hands out: a product code or a made-up spot never is one',
    B.parseSpot('SPOT-Z9') === null && B.parseSpot('NF100') === null && B.parseSpot('A99') === null && B.parseSpot('A13') === null && B.parseSpot('SPOT-G1') === null && B.parseSpot('F12') === 'F12');
  check('the shelf labels cover every spot the shelf hands out, and Overflow', B.allSpots().length === 73 && B.allSpots()[0] === 'A1' && B.allSpots()[71] === 'F12' && B.allSpots()[72] === 'Overflow');
  const R = (v: string, have: number[] = []) => B.bagReply(v, { id: 'o1', orderNumber: 142 }, 2, new Set(have), (id) => (id === 'o9' ? { orderNumber: 9, customerName: 'Sam Ito' } : null));
  check('a scanned tag: one of its bags, once; another order’s, and whose; an old print; not a tag',
    (R(c2) as any).n === 2 && /already scanned/.test((R(c2, [2]) as any).message) && (R(Q.makeBagCode('t1', 'o9', 1)) as any).message === 'Wrong bag. This one is #0009 for Sam Ito.'
    && /earlier print/.test((R(Q.makeBagCode('t1', 'o1', 3)) as any).message) && /isn’t a bag tag/.test((R('012345678905') as any).message));

  // ── Into the van ──
  await fresh();
  let r = await step('deliveryOut', { orderId: 'o1' });
  let o = await O();
  check('a delivery doesn’t go out with no bags scanned', !r.body.ok && r.body.needBags === true && r.body.message === 'Scan all 2 bags into the van first.' && o.delivery.status === 'waiting', r.body);
  r = await step('deliveryOut', { orderId: 'o1', bags: [c1] });
  check('…one of two says which is still to scan', !r.body.ok && /into the van first: bag 2 of 2 still to scan/.test(r.body.message) && (await O()).delivery.status === 'waiting', r.body);
  r = await step('deliveryOut', { orderId: 'o1', bags: [c1, Q.makeBagCode('t1', 'o9', 2)] });
  check('…another order’s bag doesn’t count', !r.body.ok && (await O()).delivery.status === 'waiting', r.body);
  await db.doc(`${T}/retailOrders/o1`).update({ putAway: { at: '2026-11-13T10:40:00Z', spot: 'A3', bags: 2 } });
  r = await step('deliveryOut', { orderId: 'o1', bags: [c2, c1] });
  o = await O();
  check('every bag scanned: out with the driver, the bags kept on the delivery', r.body.ok && o.delivery.status === 'out' && o.delivery.driverId === 'k1' && o.delivery.bagsLoaded === 2, { r: r.body, d: o.delivery });
  check('…and off the shelf, so it’s put away again if it comes back', o.putAway === null && !B.needsPutAway(o, {}));
  let out = (await evs()).find((e: any) => e.type === 'out_for_delivery');
  check('…in its history, in words', out?.meta?.bags === 2 && eventWords(out).text === 'Out for delivery, all 2 bags scanned into the van · Kai Park', eventWords(out).text);
  r = await step('deliveryFailed', { orderId: 'o1', reason: 'No one home', code: 'no_answer' });
  o = await O();
  check('brought back, it waits to be put away again', r.body.ok && o.delivery.status === 'failed' && B.needsPutAway(o, {}), { r: r.body, o: o.delivery });
  r = await step('deliveryOut', { orderId: 'o1' });
  check('…and each bag is scanned again as it goes back out', !r.body.ok && r.body.needBags === true && (await O()).delivery.status === 'failed', r.body);

  // A bag still to scan, while the customer's page for another try was left open: their page stays as it is.
  await fresh({}, { delivery: { status: 'failed', zoneId: 'a', feeCents: 500, tries: 1, retryPay: { status: 'awaiting_payment', at: new Date(Date.now() - 20 * 60000).toISOString() } } });
  r = await step('deliveryOut', { orderId: 'o1', bags: [c1] });
  o = await O();
  check('a bag still to scan leaves the customer’s payment page for another try alone', !r.body.ok && r.body.needBags === true && o.delivery.retryPay?.status === 'awaiting_payment' && o.delivery.status === 'failed', { r: r.body, d: o.delivery });

  // A tag that won't scan: a manager's PIN.
  await fresh();
  r = await step('deliveryOut', { orderId: 'o1', bags: [c1], bagPin: '1111' });
  check('a packer’s own PIN doesn’t send it out without its bags', r.status === 403 && r.body.badBagPin === true && (await O()).delivery.status === 'waiting', r.body);
  r = await step('deliveryOut', { orderId: 'o1', bags: [c1], bagPin: '4321' });
  o = await O();
  const ov = (await evs()).find((e: any) => e.type === 'override' && e.meta?.rule === 'bags_approved');
  check('a manager’s PIN sends it out without every tag scanned, kept on the order with their name', r.body.ok && o.delivery.status === 'out' && !o.delivery.bagsLoaded && ov?.meta?.approvedBy === 'Andre Cole' && ov?.meta?.at === 'van', { r: r.body, ov });
  check('…in words', eventWords(ov).text === 'Out for delivery without scanning every bag’s tag, approved by Andre Cole · Kai Park', eventWords(ov).text);
  out = (await evs()).find((e: any) => e.type === 'out_for_delivery');
  check('…and the out-for-delivery step doesn’t claim the bags were scanned', !out?.meta?.bags && eventWords(out).text === 'Out for delivery · Kai Park', eventWords(out).text);

  // As before, where bags aren't scanned.
  await fresh({ scanBagAtHandover: false });
  r = await step('deliveryOut', { orderId: 'o1' });
  check('a shop that turned bag scans off sends deliveries out as before', r.body.ok && (await O()).delivery.status === 'out', r.body);
  await fresh({}, { bagCount: undefined });
  r = await step('deliveryOut', { orderId: 'o1' });
  check('an order packed before bags were counted goes out as before', r.body.ok && (await O()).delivery.status === 'out', r.body);

  // ── Onto the shelf ──
  await fresh({}, { method: 'counter', delivery: undefined, shippingAddress: undefined });
  r = await step('putAway', { orderId: 'o1', bags: [c1, c2] });
  check('putting away needs the shelf spot’s label', !r.body.ok && r.body.message === 'Scan the label on the shelf spot.', r.body);
  r = await step('putAway', { orderId: 'o1', bags: [c1], spot: 'SPOT-A3' });
  check('…and every bag first', !r.body.ok && r.body.needBags === true && /bag 2 of 2 still to scan/.test(r.body.message) && !(await O()).putAway, r.body);
  r = await step('putAway', { orderId: 'o1', bags: [c1, c2], spot: 'SPOT-A3' });
  o = await O();
  check('every bag, then the spot: the order says where it is and who put it there', r.body.ok && o.shelfSlot === 'A3' && o.putAway?.spot === 'A3' && o.putAway?.bags === 2 && o.putAway?.byName === 'Kai Park' && !B.needsPutAway(o, {}), { r: r.body, p: o.putAway });
  const pa = (await evs()).find((e: any) => e.type === 'put_away');
  check('…in its history, in words', eventWords(pa).text === '2 bags scanned onto shelf A3 · Kai Park', eventWords(pa).text);
  r = await step('putAway', { orderId: 'o1', bags: [c1, c2], spot: 'SPOT-B7' });
  check('put on another spot, the order moves to it', r.body.ok && (await O()).shelfSlot === 'B7' && (await O()).putAway.spot === 'B7', r.body);
  r = await step('handoffNoScan', { orderId: 'o1', verifiedBy: 'Photo ID', bags: [c1, c2] });
  check('put away, it’s handed over the same way', r.body.ok && (await O()).stage === 'completed', r.body);
  r = await step('putAway', { orderId: 'o1', bags: [c1, c2], spot: 'SPOT-A3' });
  check('a handed-over order can’t be put away', !r.body.ok && /handed over/.test(r.body.message), r.body);
  await fresh({}, { method: 'counter', stage: 'picking', delivery: undefined });
  r = await step('putAway', { orderId: 'o1', bags: [c1, c2], spot: 'SPOT-A3' });
  check('nor one that isn’t packed yet', !r.body.ok && /not on the ready shelf/.test(r.body.message), r.body);
  await fresh({}, { method: 'counter', bagCount: undefined, delivery: undefined });
  r = await step('putAway', { orderId: 'o1', bags: [], spot: 'SPOT-A3' });
  check('an order packed before bags were counted has nothing to scan', !r.body.ok && /no tags to scan/.test(r.body.message), r.body);
  await fresh({ scanBagToShelf: false }, { method: 'counter', delivery: undefined });
  r = await step('putAway', { orderId: 'o1', bags: [c1, c2], spot: 'SPOT-A3' });
  check('a shop that turned the shelf scan off isn’t asked', r.status === 409 && /doesn’t scan bags onto the shelf/.test(r.body.message), r.body);
  await fresh();
  await step('deliveryOut', { orderId: 'o1', bags: [c1, c2] });
  r = await step('putAway', { orderId: 'o1', bags: [c1, c2], spot: 'SPOT-A3' });
  check('a delivery out with its driver isn’t on the shelf', !r.body.ok && /out for delivery/.test(r.body.message), r.body);

  // ── Rules and screens ──
  const rules = src('firestore.rules');
  check('put-away is one of the order’s steps: a browser can’t write it (firestore.rules)', /function orderStepKeys\(\) \{[\s\S]{0,420}'putAway'\]/.test(rules));
  check('put-away is a packing step on the server', /putAway: 'pack'/.test(src('src/app/api/retail/fulfil/route.ts')));
  check('once put away, the shelf spot moves only on the server (firestore.rules)', /hasAny\(\['shelfSlot'\]\) \|\| resource\.data\.get\('putAway', null\) == null\)/.test(rules));
  const route = src('src/app/api/retail/fulfil/route.ts');
  check('a bag still to scan stops it before the customer’s payment page for another try is closed', route.indexOf('const vanMiss = F.vanBagsMissing(') > 0 && route.indexOf('const vanMiss = F.vanBagsMissing(') < route.indexOf('await cancelRetryPay(db, tenantId, orderId)'));
  const tab = src('src/components/staff-portal/DeliveriesTab.tsx');
  check('the driver scans each bag into the van, and every order goes out with its bags (or a PIN)', /<ScanGate onScan=\{onBag\}/.test(tab) && /markOutForDelivery\(tenantId, o\.id, needOf\(o\) \? \[\.\.\.\(loaded\.get\(o\.id\)\?\.values\(\) \|\| \[\]\)\] : undefined, pins\.get\(o\.id\) \|\| undefined\)/.test(tab) && /A tag won’t scan\?/.test(tab));
  const pane = src('src/components/orders/workspace/DeliveryPane.tsx');
  check('taking it out from the order scans its bags first', /if \(load\) \{ setErr\(''\); setLoadOpen\(true\); \}/.test(pane) && /<LoadBagsSheet /.test(pane) && /markOutForDelivery\(tenantId, order\.id, codes, bagPin\)/.test(pane));
  const sheet = src('src/components/orders/PutAwaySheet.tsx');
  check('putting away: bags, then the spot, saved on the server; shelf labels print from there', /putAway\(tenantId, order\.id, \[\.\.\.bags\.values\(\)\], spot\)/.test(sheet) && /printPickupSpots\(allSpots\(\)\)/.test(sheet));
  check('Pickups and the staff portal open it for orders waiting to be put away', [src('src/components/orders/PickupsScreen.tsx'), src('src/components/fulfilment/FulfilmentPanel.tsx')].every((t) => /<PutAwaySheet tenantId=\{tenantId\} orders=\{orders\} rs=\{rs\}/.test(t) && /needsPutAway\(o, rs\)/.test(t)));
  const setup = src('src/components/orders/SetupScreen.tsx');
  check('Setup: one switch for every bag, one for the shelf, and the shelf labels', /aria-label="Scan every bag"/.test(setup) && /'retailSettings\.scanBagToShelf': !shelfOn/.test(setup) && /printPickupSpots\(allSpots\(\)\)/.test(setup));
  const labels = src('src/lib/shelf-labels-client.ts');
  check('a shelf label carries its spot as SPOT-A3 in a barcode any scanner reads', /JsBarcode\(svg, `SPOT-\$\{spot\.toUpperCase\(\)\}`, \{ format: 'CODE128'/.test(labels));
  for (const [name, text] of [['van sheet', src('src/components/orders/LoadBagsSheet.tsx')], ['put-away sheet', sheet], ['driver’s tab', tab]] as [string, string][]) {
    check(`the ${name} has no all-caps, no heavy weight, no business words and the real apostrophe`, !/\buppercase\b|font-black/.test(text) && !/\b(studio|salon|stylist|booth|chair)\b/i.test(text.replace(/\/\/.*$/gm, ''))
      && !/[a-z]'[a-z]/i.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, '')));
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
