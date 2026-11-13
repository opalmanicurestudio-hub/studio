// Checks SPOT CHECKS BY A SECOND PERSON (lib/spot-check, lib/retail-fulfill, api/retail/fulfil):
//   - while the shop spot-checks, 1 in N orders is picked as it's packed, and goes no further (ready shelf, out for
//     delivery, shipped, a label bought) until someone other than its packer has scanned every unit again;
//   - wrong or extra items and missing ones are kept as mistakes; once every unit is counted it's done, and a pickup goes
//     onto the ready shelf; a manager's PIN (not the packer's) can let one go unchecked, kept on the order;
//   - How it's going counts the checks and their mistakes for the person who packed the order;
//   - the check can't be written from a browser (firestore.rules); the screens and Setup offer it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/spot-check.verify.ts
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
const line = (x: any = {}) => ({ lineId: 'A', productId: 'gel', sku: 'GEL-121', barcode: '012345678905', name: 'Gel color', unitPriceCents: 1500, qtyOrdered: 2, qtyScanned: 2, qtyPacked: 2, qtyShorted: 0, status: 'picked', ...x });
const line2 = (x: any = {}) => ({ lineId: 'B', productId: 'oil', sku: 'OIL-1', barcode: '012345678912', name: 'Cuticle oil', unitPriceCents: 900, qtyOrdered: 1, qtyScanned: 1, qtyPacked: 1, qtyShorted: 0, status: 'picked', ...x });
const as = (uid: string, name: string, role = 'staff') => { actor = { uid, name, role, isManager: role === 'manager', isTenantOwner: false, caps: [] }; };
const fresh = async (rs: any = {}, x: any = {}) => {
  db = strictTransactions(makeDb());
  await db.doc(T).set({ name: 'Opal', timezone: 'America/Los_Angeles', retailSettings: { spotCheckEvery: 10, ...rs } });
  for (const [id, it] of Object.entries({ gel: { name: 'Gel color', barcode: '012345678905', sku: 'GEL-121' }, oil: { name: 'Cuticle oil', barcode: '012345678912', sku: 'OIL-1' }, lamp: { name: 'Lamp', barcode: '099999999999' } }))
    await db.doc(`${T}/inventory/${id}`).set({ id, type: 'retail', status: 'active', totalStock: 10, stockReserved: 3, batches: [{ id: 'b1', stock: 10, costPerUnit: 4, receivedDate: '2026-01-01' }], ...(it as any) });
  const { pinHash } = await import('../../src/lib/approvals');
  await db.doc(`${T}/staff/m1`).set({ name: 'Andre Cole', role: 'manager', hasPin: true }); await db.doc(`${T}/staffSecrets/m1`).set({ pinHash: pinHash('t1', '4321') });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'manager', hasPin: true }); await db.doc(`${T}/staffSecrets/k1`).set({ pinHash: pinHash('t1', '1111') });
  await db.doc(`${T}/staff/s2`).set({ name: 'Sam Ito', role: 'staff' });
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', tenantId: 't1', orderNumber: 142, stage: 'picking', claimedBy: 'k1', claimedByName: 'Kai Park', method: 'counter', lines: [line(), line2()],
    customerName: 'Dana R', customerEmail: 'dana@example.com', qrToken: 'o1.abcdef', totalCents: 3900, refundedCents: 0, placedAt: '2026-11-13T10:00:00Z', paidAt: '2026-11-13T10:00:00Z', ...x });
};

(async () => {
  const P = await import('../../src/lib/spot-check');
  const { eventWords } = await import('../../src/lib/order-events');
  const { staffKpis } = await import('../../src/lib/fulfilment-access');
  const { POST } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { const r: any = await POST(req({ tenantId: 't1', action, ...args })); await settle(); return r; };
  const O = async () => get(`${T}/retailOrders/o1`);
  const evs = async () => all(`${T}/retailOrders/o1/events`);
  const realRandom = Math.random;
  const pack = async (picked = true) => { as('k1', 'Kai Park', 'manager'); Math.random = () => (picked ? 0 : 0.99); const r = await step('markPacked', { orderId: 'o1' }); Math.random = realRandom; return r; };

  // ── The rules, on their own ──
  check('spot checks are off unless the shop picks 1 in 10, 25 or 50', P.spotEvery({}) === 0 && P.spotEvery({ spotCheckEvery: 25 }) === 25 && P.spotEvery({ spotCheckEvery: 7 }) === 0);
  check('1 in N is picked at random, never a pop-up order or a download', P.pickForSpot({ lines: [line()] }, 10, 0.05) && !P.pickForSpot({ lines: [line()] }, 10, 0.2) && !P.pickForSpot({ lines: [line()], popupId: 'p' }, 10, 0) && !P.pickForSpot({ lines: [line({ digital: true })] }, 10, 0) && !P.pickForSpot({ lines: [line()] }, 0, 0));
  const half = { lines: [line(), line2({ qtyOrdered: 3, qtyShorted: 1 })], spotCheck: { due: true, counts: { A: 1, B: 2 }, missing: { A: 1 }, wrong: 2 } };
  check('the check counts what’s going out, line by line (shorted units aren’t in the bag)', JSON.stringify(P.spotLines(half).map((l) => [l.lineId, l.need, l.got, l.missing])) === JSON.stringify([['A', 2, 1, 1], ['B', 2, 2, 0]]) && P.spotLeft(half) === 1);
  check('…and the mistakes it found', JSON.stringify(P.spotMistakes(half)) === JSON.stringify({ wrong: 2, missing: 1 }));
  check('its result in words', P.spotWords({ result: 'passed' }) === 'Spot check passed: every item right' && P.spotWords({ result: 'fixed', wrong: 1, missing: 2 }) === 'Spot check found 1 wrong or extra and 2 missing, fixed before it went out' && P.spotWords({ result: 'skipped', approvedBy: 'Andre Cole' }) === 'Spot check skipped, approved by Andre Cole');

  // ── Picked as it's packed, and held there ──
  await fresh();
  let r = await pack(false);
  check('an order not picked goes on as before', r.body.ok && !(await O()).spotCheck);
  await fresh();
  r = await pack(true);
  let o = await O();
  check('an order picked is packed and waits for its check, with who packed it', r.body.ok && r.body.spotCheck === true && o.stage === 'packed' && o.spotCheck?.due === true && o.spotCheck?.packedById === 'k1' && /Picked for a spot check/.test(r.body.message), r.body);
  r = await step('markReady', { orderId: 'o1' });
  check('…it can’t go onto the ready shelf until it’s checked', !r.body.ok && /picked for a spot check/.test(r.body.message) && (await O()).stage === 'packed', r.body);
  r = await step('spotScan', { orderId: 'o1', value: '012345678905' });
  check('…and its packer can’t check it', !r.body.ok && /Someone other than its packer/.test(r.body.message), r.body);
  as('s2', 'Sam Ito');
  r = await step('spotScan', { orderId: 'o1', value: '012345678905' });
  check('someone else scans each item', r.body.ok && r.body.left === 2 && (await O()).spotCheck.counts.A === 1, r.body);
  r = await step('spotScan', { orderId: 'o1', value: '099999999999' });
  check('a wrong item is a mistake, to take out', !r.body.ok && r.body.mistake === true && /isn’t on this order/.test(r.body.message) && (await O()).spotCheck.wrong === 1, r.body);
  r = await step('spotScan', { orderId: 'o1', value: '099999999999' });
  check('…read twice in a row, it’s one mistake', !r.body.ok && /Already counted/.test(r.body.message) && (await O()).spotCheck.wrong === 1, r.body);
  r = await step('spotDone', { orderId: 'o1' });
  check('it isn’t done while items are still to scan', !r.body.ok && r.body.left === 2 && (await O()).spotCheck.due === true, r.body);
  r = await step('spotScan', { orderId: 'o1', value: '012345678905' });
  r = await step('spotScan', { orderId: 'o1', value: '012345678905' });
  check('one more than the order has is a mistake too', !r.body.ok && /one more Gel color than the order has/.test(r.body.message) && (await O()).spotCheck.wrong === 2, r.body);
  r = await step('spotMissing', { orderId: 'o1', lineId: 'B' });
  check('an item that isn’t there is marked missing', r.body.ok && (await O()).spotCheck.missing.B === 1, r.body);
  r = await step('spotScan', { orderId: 'o1', value: '012345678912' });
  r = await step('spotDone', { orderId: 'o1' });
  o = await O();
  const ev = (await evs()).filter((e: any) => e.type === 'spot_check').find((e: any) => e.meta?.result === 'fixed');
  check('every item counted: done, its mistakes kept, and it goes onto the ready shelf', r.body.ok && r.body.result === 'fixed' && r.body.ready === true && o.stage === 'ready' && o.spotCheck.due === false && o.spotCheck.byName === 'Sam Ito', { r: r.body, sc: o.spotCheck });
  check('…in its history, for its packer', ev?.meta?.packedById === 'k1' && ev?.meta?.wrong === 2 && ev?.meta?.missing === 1 && eventWords(ev).text === 'Spot check found 2 wrong or extra and 1 missing, fixed before it went out · Sam Ito', eventWords(ev).text);

  // A manager lets one go.
  await fresh(); await pack(true);
  as('s2', 'Sam Ito');
  r = await step('spotDone', { orderId: 'o1', pin: '1111' });
  check('the packer’s own PIN can’t let it go unchecked', !r.body.ok && /packed it can’t let it go/.test(r.body.message) && (await O()).spotCheck.due === true, r.body);
  r = await step('spotDone', { orderId: 'o1', pin: '9999' });
  check('a wrong PIN doesn’t', r.status === 403 && r.body.badPin === true, r.body);
  r = await step('spotDone', { orderId: 'o1', pin: '4321' });
  o = await O();
  check('another manager’s PIN lets it go, kept on the order with their name', r.body.ok && r.body.result === 'skipped' && o.spotCheck.approvedBy === 'Andre Cole' && o.stage === 'ready', { r: r.body, sc: o.spotCheck });

  // A shipped order waits for its label.
  await fresh({}, { method: 'ship', shippingAddress: { line1: '1 Main', city: 'Portland', state: 'OR', postalCode: '97204' } });
  await pack(true);
  r = await step('markShipped', { orderId: 'o1', tracking: { carrier: 'USPS', number: '9400100000000000000000' } });
  check('a shipped order can’t be marked shipped until it’s checked', !r.body.ok && (await O()).stage === 'packed', r.body);
  as('s2', 'Sam Ito');
  for (const v of ['012345678905', '012345678905', '012345678912']) await step('spotScan', { orderId: 'o1', value: v });
  r = await step('spotDone', { orderId: 'o1' });
  o = await O();
  check('…checked, it passes and stays packed for its label', r.body.ok && r.body.result === 'passed' && o.stage === 'packed' && o.spotCheck.due === false, { r: r.body, stage: o.stage });
  const label = src('src/app/api/retail/shipping-label/route.ts'); const bulk = src('src/app/api/retail/shipping-labels-bulk/route.ts');
  check('…nor shipped in a box with another order', /const due = orders\.find\(\(o: any\) => o\.spotCheck\?\.due === true\);/.test(src('src/app/api/retail/ship-together/route.ts')));
  await fresh(); await pack(true);
  await db.doc(`${T}/retailOrders/o1`).update({ lines: [line({ status: 'refunded' }), line2({ status: 'backordered' })] });
  as('s2', 'Sam Ito');
  r = await step('spotDone', { orderId: 'o1' });
  check('one with nothing left in it to check is closed, not counted as a check', r.body.ok && r.body.result === 'empty' && (await O()).spotCheck.due === false, r.body);
  check('no label is bought for an order waiting for its check, one at a time or in bulk', /if \(order\.spotCheck\?\.due === true\) return NextResponse\.json\(/.test(label) && /if \(order\.spotCheck\?\.due === true\) return 'Waiting for its spot check';/.test(bulk));

  // How it's going.
  const rows = staffKpis([{ events: [
    { type: 'spot_check', at: '2026-11-13T11:00:00Z', actorId: 's2', actorName: 'Sam Ito', meta: { result: 'fixed', wrong: 1, missing: 1, packedById: 'k1', packedBy: 'Kai Park' } },
    { type: 'spot_check', at: '2026-11-13T12:00:00Z', actorId: 's2', actorName: 'Sam Ito', meta: { result: 'passed', wrong: 0, missing: 0, packedById: 'k1', packedBy: 'Kai Park' } },
    { type: 'spot_check', at: '2026-11-13T12:05:00Z', actorId: 'm1', actorName: 'Andre Cole', meta: { result: 'skipped', packedById: 'k1', packedBy: 'Kai Park' } },
    { type: 'override', at: '2026-11-13T10:00:00Z', actorId: 'k1', actorName: 'Kai Park', meta: { rule: 'unit_approved' } },
  ] }] as any);
  const kai = rows.find((x: any) => x.actorId === 'k1'); const sam = rows.find((x: any) => x.actorId === 's2');
  check('How it’s going counts each check and its mistakes for the packer, not the checker (a skipped one isn’t a check)', kai?.spotChecked === 2 && kai?.spotMistakes === 2 && kai?.approvedNoScan === 1 && !sam?.spotChecked, { kai, sam });

  // ── Rules and screens ──
  check('the check is one of the order’s steps: a browser can’t write it (firestore.rules)', /function orderStepKeys\(\) \{[^}]{0,420}'spotCheck'/.test(src('firestore.rules')));
  const route = src('src/app/api/retail/fulfil/route.ts');
  check('the check is a packing step, and a skip takes a manager’s PIN on the one lock', /spotScan: 'pack', spotMissing: 'pack', spotDone: 'pack'/.test(route) && /mayApprove\(permissionsFor\(who\), 'managers'\)/.test(route));
  const sheet = src('src/components/orders/SpotCheckSheet.tsx');
  check('the check: scan, mark missing, finish, or a manager’s PIN', /spotScan\(tenantId, order\.id, v\)/.test(sheet) && /spotMissing\(tenantId, order\.id, l\.lineId\)/.test(sheet) && /spotDone\(tenantId, order\.id, p\)/.test(sheet));
  check('Pickups, the staff portal and the order itself open it', ['src/components/orders/PickupsScreen.tsx', 'src/components/fulfilment/FulfilmentPanel.tsx', 'src/components/orders/workspace/OrderWorkspace.tsx'].every((f) => /<SpotCheckSheet tenantId=\{tenantId\}/.test(src(f))));
  check('Setup: off, or 1 in 10, 25 or 50', /'retailSettings\.spotCheckEvery': n/.test(src('src/components/orders/SetupScreen.tsx')));
  for (const [name, text] of [['check sheet', sheet], ['check rules', src('src/lib/spot-check.ts')]] as [string, string][]) {
    check(`the ${name} has no all-caps, no heavy weight, no business words and the real apostrophe`, !/\buppercase\b|font-black/.test(text) && !/\b(studio|salon|stylist|booth|chair)\b/i.test(text.replace(/\/\/.*$/gm, ''))
      && !/[a-z]'[a-z]/i.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, '')));
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
