// Checks bag labels on food orders and the scan before one goes (design board "Bag labels, and a check before it goes",
// A: scan each bag; lib/food-bags, lib/food-bags-server, api/counter 'bags' / 'bagScan' / 'move', api/kitchen, api/curbside,
// Settings → Printers, the Menu page's "Scan bags before they're handed over"):
// - the rules: how many bags, what a label says (first name only, every item, the allergy, the code), which bags are left
// - printed by themselves once the kitchen finishes an order, on a printer set to print bag labels, once only; an Epson's
//   labels carry a code, a Star's are words only (and aren't scanned)
// - printed again from the counter, here or on the printer, with a number of bags
// - the handover refused until each bag is scanned: another order's bag says whose, an earlier print's is refused, a
//   manager's PIN lets it go without (kept on the order and the record); turned off, it goes as before
// - curbside the same
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/food-bags.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let actor: any = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
const audits: any[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (f: any) => { void Promise.resolve().then(f); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_db: any, _t: any, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const day = new Date().toISOString().slice(0, 10);
const nowS = () => new Date().toISOString();

(async () => {
  const F = await import('../../src/lib/food-bags');
  const Q = await import('../../src/lib/order-qr');

  console.log('the rules');
  const lines = (n: number) => [{ lineId: 'l1', name: 'Egg biscuit', quantity: n, choicesText: 'No cheese', note: 'Extra crispy' }, { lineId: 'g', name: 'Gift card', quantity: 1, giftCard: { to: null } }, { lineId: 'o', name: 'Tip jar', quantity: 1, oneOff: true }];
  check('one bag for every 6 items (gift cards and one-offs aren’t bagged), between 1 and 9', F.defaultBags({ lines: lines(6) }) === 1 && F.defaultBags({ lines: lines(7) }) === 2 && F.defaultBags({ lines: [] }) === 1 && F.defaultBags({ lines: lines(200) }) === 9);
  const o = { number: 'D15', channel: 'drive-thru', guestName: 'Maria Lopez Ortiz', lines: lines(2), allergy: { keys: ['peanuts'], other: null, severe: true } };
  const l = F.labelOf(o, 2, 3, 'clarityflow://bag/o1.2.abcdef0123456789');
  check('a label: the number, how it’s going out, the first name only, the bag, every item with its choices and notes, the allergy and the code', l.number === 'D15' && l.way === 'Drive-thru' && l.name === 'Maria' && l.n === 2 && l.of === 3
    && l.items.length === 1 && l.items[0].qty === 2 && l.items[0].sub.join('|') === 'No cheese|Note: Extra crispy' && /^Allergy: Peanuts/.test(String(l.allergy)) && /severe/.test(String(l.allergy)) && !!l.code, l);
  const doc = F.labelDoc(l);
  check('…printed: the code as a QR block, the allergy set off; with no code, none', doc.blocks.some((b: any) => b.k === 'qr' && b.data === l.code) && doc.blocks.some((b: any) => b.k === 'alert') && doc.blocks.some((b: any) => b.k === 'text' && b.text === 'Bag 2 of 3')
    && !F.labelDoc({ ...l, code: null }).blocks.some((b: any) => b.k === 'qr'));
  check('how it’s going out, for each way', F.wayWords({ channel: 'counter' }) === 'Counter' && F.wayWords({ channel: 'kiosk' }) === 'Kiosk' && F.wayWords({ channel: 'ahead', ahead: { way: 'curbside' } }) === 'Curbside'
    && F.wayWords({ channel: 'ahead', ahead: { way: 'delivery' } }) === 'Delivery' && F.wayWords({ channel: 'counter', app: { label: 'DoorDash', code: '4F2A' } }) === 'DoorDash 4F2A');
  const bagged = (b: any) => ({ status: 'sent', bags: { count: 3, printedAt: nowS(), coded: true, scanned: [], skipped: null, ...b } });
  check('the bags left to scan: all of them at first, none scanned twice, never more than there are', F.bagsLeft(bagged({}), {}).join() === '1,2,3' && F.bagsLeft(bagged({ scanned: [2, 2, 7] }), {}).join() === '1,3');
  check('…none when the labels carry no code, a manager let it go, the business turned the scan off, or nothing was printed', F.bagsLeft(bagged({ coded: false }), {}).length === 0 && F.bagsLeft(bagged({ skipped: { by: 'Ana', at: nowS() } }), {}).length === 0
    && F.bagsLeft(bagged({}), { bagCheck: { off: true } }).length === 0 && F.bagsLeft({ status: 'sent' }, {}).length === 0);
  check('bag words', F.bagName(2, 3) === 'Bag 2 of 3' && F.bagName(1, 1) === 'The bag' && F.bagsWords([1, 3], 3) === 'bags 1 and 3' && F.bagsWords([2], 3) === 'bag 2' && F.bagsWords([1], 1) === 'the bag');

  console.log('printed by themselves');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, orderAhead: { on: true, curbside: true }, ownerId: 'own1' });
  await db.doc(`${T}/staff/s1`).set({ name: 'Kai Park', role: 'staff' });
  await db.doc(`${T}/staff/m9`).set({ name: 'Ana Ruiz', role: 'manager', pin: '4821' });
  await db.doc(`${T}/inventory/biscuit`).set({ type: 'refreshment', name: 'Egg biscuit', category: 'Breakfast', price: 4, totalStock: 80 });
  await db.doc(`${T}/inventory/browns`).set({ type: 'refreshment', name: 'Hash browns', category: 'Breakfast', price: 2, totalStock: 80 });
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: curbApi } = await import('../../src/app/api/curbside/route');
  const { POST: printersApi } = await import('../../src/app/api/printers/route');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Lane', kind: 'drive-thru' }))).body.key;
  const kds = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Grill' }))).body.key;
  const L = (b: any) => LANE(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const K = (b: any) => kitchen(req({ tenantId: 't1', key: kds, ...b })) as Promise<any>;
  const C = (b: any) => curbApi(req({ tenantId: 't1', ...b })) as Promise<any>;
  const carWith = async (k: string, qty: number) => {
    const c = (await L({ action: 'car', carKey: k })).body;
    await L({ action: 'add', orderId: c.orderId, itemId: 'biscuit', quantity: qty - 1, tapKey: `${k}-a` });
    await L({ action: 'add', orderId: c.orderId, itemId: 'browns', quantity: 1, tapKey: `${k}-b` });
    await L({ action: 'name', orderId: c.orderId, name: 'Maria Lopez' });
    await L({ action: 'send', orderId: c.orderId });
    await L({ action: 'paid', orderId: c.orderId, method: 'cash', tendered: 100 });
    return c;
  };
  const ticketsOf = async (orderId: string) => (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === orderId);
  const c1 = await carWith('car-1', 8);
  let r = await K({ action: 'bump', step: 'ready', tickets: (await ticketsOf(c1.orderId)).map((t: any) => ({ col: 'kdsTickets', id: t.id })) });
  check('no printer for bag labels: nothing prints by itself, and the order goes as before', r.body.ok && !(await get(`${T}/counterOrders/${c1.orderId}`)).bags && (await all(`${T}/printJobs`)).length === 0, r.body);
  r = await L({ action: 'move', carId: c1.carId, to: 'gone' });
  check('…handed over with nothing to scan', r.body.ok && (await get(`${T}/counterOrders/${c1.orderId}`)).status === 'done', r.body);

  actor = { uid: 'm9', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  r = await printersApi(req({ tenantId: 't1', action: 'save', name: 'Bag labels', kind: 'epson', labels: true, tickets: false }));
  const pid = r.body.id;
  check('a printer set to print bag labels (Settings, Printers)', r.body.ok && (await get(`${T}/printers/${pid}`)).labels === true, r.body);
  r = await printersApi(req({ tenantId: 't1', action: 'list' }));
  check('…listed as printing bag labels', r.body.printers?.[0]?.labels === true && /bag labels/.test(r.body.printers[0].prints), r.body.printers);
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  const c2 = await carWith('car-2', 8);
  const t2 = await ticketsOf(c2.orderId);
  r = await K({ action: 'act', col: 'kdsTickets', id: t2[0].id, step: 'ready' });
  check('not all made yet: no labels', t2.length === 2 && r.body.ok && !(await get(`${T}/counterOrders/${c2.orderId}`)).bags, { n: t2.length, body: r.body });
  r = await K({ action: 'bump', step: 'ready', tickets: t2.map((t: any) => ({ col: 'kdsTickets', id: t.id })) });
  let o2: any = await get(`${T}/counterOrders/${c2.orderId}`);
  let jobs = (await all(`${T}/printJobs`)).filter((j: any) => j.kind === 'label' && j.orderId === c2.orderId);
  check('all made: a label for each bag prints on that printer, with its code (an Epson can print one)', o2.bags?.count === 2 && o2.bags.coded === true && jobs.length === 2 && jobs.every((j: any) => j.printerId === pid && j.doc.blocks.some((b: any) => b.k === 'qr'))
    && Q.checkBagCode('t1', c2.orderId, jobs[0].doc.blocks.find((b: any) => b.k === 'qr').data) !== null, { bags: o2.bags, jobs: jobs.length });
  await K({ action: 'act', col: 'kdsTickets', id: t2[0].id, step: 'ready' });
  check('…once only', (await all(`${T}/printJobs`)).filter((j: any) => j.kind === 'label' && j.orderId === c2.orderId).length === 2);

  console.log('the scan before it goes');
  r = await L({ action: 'lane' });
  check('the lane says the labels, which are left, and the label printer', JSON.stringify(r.body.orders[c2.orderId]?.bags) === JSON.stringify({ of: 2, left: [1, 2] }) && r.body.settings.labelPrinter === 'Bag labels' && r.body.orders[c2.orderId].bagsStart === 2, r.body.orders[c2.orderId]?.bags);
  r = await L({ action: 'move', carId: c2.carId, to: 'gone' });
  check('handing over is refused until each bag is scanned, saying which', r.status === 409 && r.body.code === 'bags' && r.body.bags?.[0]?.left?.join() === '1,2' && /^Scan all 2 bags of \w+ first\.$/.test(r.body.error) && (await get(`${T}/counterOrders/${c2.orderId}`)).status === 'sent', r.body);
  const codeOf = (oid: string, n: number) => Q.makeBagCode('t1', oid, n);
  r = await L({ action: 'bagScan', carId: c2.carId, code: 'not a label' });
  check('…something that isn’t a label says so', r.status === 409 && /isn’t a bag label/.test(r.body.error));
  r = await L({ action: 'bagScan', carId: c2.carId, code: codeOf(c1.orderId, 1) });
  check('…another order’s bag says whose it is', r.status === 409 && /Wrong bag\. This one is .* for Maria/.test(r.body.error), r.body);
  r = await L({ action: 'bagScan', carId: c2.carId, code: codeOf(c2.orderId, 3) });
  check('…a label from an earlier print (a bag that isn’t there now) is refused', r.status === 409 && /earlier print/.test(r.body.error), r.body);
  r = await L({ action: 'bagScan', carId: c2.carId, code: codeOf(c2.orderId, 1).replace(/.$/, (x) => (x === 'a' ? 'b' : 'a')) });
  check('…a code that’s been made up isn’t one', r.status === 409);
  r = await L({ action: 'bagScan', carId: c2.carId, code: codeOf(c2.orderId, 1) });
  check('…bag 1 scanned, bag 2 left', r.body.ok && r.body.n === 1 && r.body.left.join() === '2' && r.body.orderId === c2.orderId, r.body);
  r = await L({ action: 'bagScan', carId: c2.carId, code: codeOf(c2.orderId, 1) });
  check('…scanned again: no change', r.body.ok && r.body.already && r.body.left.join() === '2');
  r = await L({ action: 'move', carId: c2.carId, to: 'gone' });
  check('…still one to go', r.status === 409 && r.body.bags[0].left.join() === '2' && /Scan bag 2 of/.test(r.body.error), r.body);
  r = await L({ action: 'bagScan', carId: c2.carId, code: codeOf(c2.orderId, 2) });
  r = await L({ action: 'move', carId: c2.carId, to: 'gone' });
  check('every bag scanned: handed over', r.body.ok && (await get(`${T}/counterOrders/${c2.orderId}`)).status === 'done' && (await get(`${T}/counterOrders/${c2.orderId}`)).bags.scanned.length === 2, r.body);

  console.log('printed again, and let go without');
  const c3 = await carWith('car-3', 3);
  await K({ action: 'bump', step: 'ready', tickets: (await ticketsOf(c3.orderId)).map((t: any) => ({ col: 'kdsTickets', id: t.id })) });
  r = await L({ action: 'bags', carId: c3.carId, orderId: c3.orderId, count: 2, here: true });
  let o3: any = await get(`${T}/counterOrders/${c3.orderId}`);
  check('printed again here on the tablet, as 2 bags: each label comes back with its code, nothing goes to the printer', r.body.ok && r.body.count === 2 && r.body.labels.length === 2 && r.body.labels.every((x: any) => Q.checkBagCode('t1', c3.orderId, x.code) !== null)
    && o3.bags.count === 2 && (await all(`${T}/printJobs`)).filter((j: any) => j.orderId === c3.orderId).length === 1, { body: r.body, bags: o3.bags });
  r = await L({ action: 'bags', carId: c3.carId, orderId: c2.orderId, count: 1 });
  check('…only for an order of that car', r.status === 400);
  r = await L({ action: 'bags', carId: c3.carId, orderId: c3.orderId, count: 1 });
  check('…or on the printer, as 1 bag', r.body.ok && r.body.printer === 'Bag labels' && r.body.labels.length === 0 && (await all(`${T}/printJobs`)).filter((j: any) => j.orderId === c3.orderId).length === 2, r.body);
  r = await L({ action: 'move', carId: c3.carId, to: 'gone', bagOverride: true, bagReason: 'wont_scan' });
  check('a label won’t scan: someone who isn’t a manager can’t let it go without', r.status === 403 && r.body.needsManager, r.body);
  r = await L({ action: 'move', carId: c3.carId, to: 'gone', bagOverride: true, pin: '1111', bagReason: 'wont_scan' });
  check('…nor a wrong PIN', r.status === 403 && (await get(`${T}/counterOrders/${c3.orderId}`)).status === 'sent', r.body);
  r = await L({ action: 'move', carId: c3.carId, to: 'gone', bagOverride: true, pin: '4821', bagReason: 'wont_scan' });
  o3 = await get(`${T}/counterOrders/${c3.orderId}`);
  check('…a manager’s PIN lets it go, kept on the order and the record (let go, not passed by)', r.body.ok && o3.status === 'done' && o3.bags.skipped?.by === 'Ana Ruiz' && !o3.bags.unscanned && audits.some((a) => a.action === 'counter.bags_skipped' && /Ana Ruiz/.test(a.summary)), { body: r.body, bags: o3.bags });

  console.log('turned off, and a Star printer');
  await db.doc(`${T}/printers/${pid}`).set({ kind: 'star' }, { merge: true });
  const { forgetPrinter } = await import('../../src/lib/printing-server');
  forgetPrinter(T, pid);
  const c4 = await carWith('car-4', 2);
  await K({ action: 'bump', step: 'ready', tickets: (await ticketsOf(c4.orderId)).map((t: any) => ({ col: 'kdsTickets', id: t.id })) });
  const o4: any = await get(`${T}/counterOrders/${c4.orderId}`);
  const j4 = (await all(`${T}/printJobs`)).filter((j: any) => j.orderId === c4.orderId);
  check('on a Star printer the labels print words only, so the order isn’t held for a scan', o4.bags?.coded === false && j4.length === 1 && !j4[0].doc.blocks.some((b: any) => b.k === 'qr'), { bags: o4.bags });
  r = await L({ action: 'move', carId: c4.carId, to: 'gone' });
  check('…handed over as before', r.body.ok, r.body);
  await db.doc(`${T}/printers/${pid}`).set({ kind: 'epson' }, { merge: true }); forgetPrinter(T, pid);
  await db.doc(T).set({ bagCheck: { off: true } }, { merge: true });
  const c5 = await carWith('car-5', 2);
  await K({ action: 'bump', step: 'ready', tickets: (await ticketsOf(c5.orderId)).map((t: any) => ({ col: 'kdsTickets', id: t.id })) });
  const before = audits.length;
  r = await L({ action: 'move', carId: c5.carId, to: 'gone', bagOverride: true, pin: '4821', bagReason: 'wont_scan' });
  const o5: any = await get(`${T}/counterOrders/${c5.orderId}`);
  check('the scan turned off: labels still print, and it’s handed over without; the order says its bag went unscanned', r.body.ok && o5.bags?.count === 1 && o5.bags.unscanned?.left === 1 && o5.bags.unscanned.by === 'Lane', { body: r.body, bags: o5.bags });
  check('…a manager’s PIN sent with nothing to skip puts nothing on the record', audits.length === before && !o5.bags.skipped);
  await db.doc(T).set({ bagCheck: { off: false } }, { merge: true });

  console.log('curbside');
  const id = 'ahead1';
  await db.doc(`${T}/counterOrders/${id}`).set({ id, number: 'A1', channel: 'ahead', status: 'sent', day, guestName: 'Jordan Lee', paidAt: nowS(), payMethod: 'card', sentAt: nowS(),
    lines: [{ lineId: 'l1', itemId: 'biscuit', name: 'Egg biscuit', quantity: 2, unitPrice: 4 }], subtotal: 8, tax: 0, total: 8, ahead: { way: 'curbside', state: 'paid', hereAt: nowS() } });
  await db.doc(`${T}/kdsTickets/${id}_l1`).set({ orderId: id, channel: 'ahead', status: 'in_progress', menuItemName: 'Egg biscuit', quantity: 2 });
  await K({ action: 'act', col: 'kdsTickets', id: `${id}_l1`, step: 'ready' });
  r = await C({ action: 'list' });
  const row = (r.body.cafe || []).find((x: any) => x.id === id);
  check('a curbside order’s labels print when it’s ready, and the screen knows them and the printer', JSON.stringify(row?.bags) === JSON.stringify({ of: 1, left: [1] }) && r.body.labelPrinter === 'Bag labels', { row, lp: r.body.labelPrinter });
  r = await C({ action: 'handed', orderId: id });
  check('…handing it over is refused until its bag is scanned', r.status === 409 && r.body.code === 'bags' && r.body.bags?.[0]?.left?.join() === '1', r.body);
  r = await C({ action: 'bagScan', orderId: id, code: codeOf(id, 1) });
  check('…scanned', r.body.ok && r.body.left.length === 0, r.body);
  r = await C({ action: 'handed', orderId: id });
  check('…then handed over', r.body.ok && (await get(`${T}/counterOrders/${id}`)).status === 'done', r.body);
  r = await C({ action: 'bagScan', orderId: id, code: codeOf(id, 1) });
  check('…a scan after it’s gone says so', r.status === 409 && /already handed over/.test(r.body.error), r.body);
  const id2 = 'ahead2';
  await db.doc(`${T}/counterOrders/${id2}`).set({ id: id2, number: 'A2', channel: 'ahead', status: 'sent', day, guestName: 'Sam Ito', paidAt: nowS(), payMethod: 'card', sentAt: nowS(),
    lines: [{ lineId: 'l1', itemId: 'biscuit', name: 'Egg biscuit', quantity: 1, unitPrice: 4 }], subtotal: 4, tax: 0, total: 4, ahead: { way: 'curbside', state: 'paid', hereAt: nowS() } });
  await db.doc(`${T}/kdsTickets/${id2}_l1`).set({ orderId: id2, channel: 'ahead', status: 'in_progress', menuItemName: 'Egg biscuit', quantity: 1 });
  await K({ action: 'act', col: 'kdsTickets', id: `${id2}_l1`, step: 'ready' });
  actor = { uid: 'm9', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  const n0 = audits.length;
  r = await C({ action: 'handed', orderId: id2, bagOverride: true, bagReason: 'wont_scan' });
  check('…a manager signed in lets a curbside order go without its bag scanned: on the order, and on the record as at the counter', r.body.ok && (await get(`${T}/counterOrders/${id2}`)).bags?.skipped?.by === 'Ana Ruiz'
    && audits.length === n0 + 1 && audits[n0].action === 'curbside.bags_skipped', { body: r.body, audits: audits.slice(n0) });
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  r = await C({ action: 'bags', orderId: c5.orderId, here: true });
  check('…its screen prints and scans curbside orders only', r.status === 404);

  console.log('the screens');
  const counter = src('src/app/(app)/counter/page.tsx'), lane = src('src/app/drive-thru/[tenantId]/page.tsx'), curb = src('src/components/orders/CurbsideScreen.tsx'), sheets = src('src/components/drive-thru/BagSheets.tsx');
  check('the counter, the window and curbside open the scan when a handover waits on bags, and hand over once every bag is scanned', /if \(d\.code === 'bags' && Array\.isArray\(d\.bags\)\) \{ setBagHold\(/.test(counter) && /d\.code === 'bags' && Array\.isArray\(d\.bags\)\) setBagHold\(/.test(lane) && /d\.code === 'bags' && Array\.isArray\(d\.bags\)\) \{ setBagHold\(/.test(curb)
    && /if \(Object\.values\(next\)\.every\(\(l\) => l\.length === 0\) && Object\.values\(nextItems\)\.every\(\(l\) => l\.length === 0\)\) \{ setGood\('Everything scanned\. Handing it over\.'\); onDone\(\); \}/.test(sheets));
  check('…each prints labels again (here, or on the label printer), closing the scan to open afresh, and a manager’s PIN lets one go', [counter, lane, curb].every((s) => /<BagLabelsSheet /.test(s) && /bagOverride: true, pin/.test(s) && /printLabelsHere\(d\.labels \|\| \[\]\)/.test(s) && /setBagHold\(null\); setLabelsFor\(/.test(s)));
  check('…the sheets take focus, close on Escape and give focus back, and say when it hands over by itself', (sheets.match(/const box = useSheet\(onClose\);/g) || []).length === 2 && /if \(e\.key === 'Escape'\) close\.current\(\);/.test(sheets) && /setGood\('Everything scanned\. Handing it over\.'\)/.test(sheets));
  check('…an order handed over with bags not scanned (the exit sensor, or the scan turned off) says so', /\.\.\.unscanned\(order, by, nowIso\)/.test(src('src/lib/counter-handover.ts')) && /aheadOrder: ahead, by: 'Exit sensor'/.test(src('src/lib/lane-entry-server.ts')));
  check('…the scan takes a scanner or the camera, and the background scanner stops listening meanwhile', /<ScanGate onScan=/.test(sheets) && /!bagHold && !labelsFor, \{ layer: 'background' \}/.test(counter) && /!bagHold && !labelsFor, \{ layer: 'background' \}/.test(lane));
  check('…a label printed on this device carries its code as a picture to scan', /QRCode\.toDataURL\(l\.code/.test(sheets));
  check('the Menu page turns the scan on or off; Settings, Printers sets which printer prints labels', /laneSettings', bagCheck: v/.test(src('src/app/(app)/menu/page.tsx')) && /label="Prints bag labels"/.test(src('src/app/(app)/settings/printers/page.tsx')));
  for (const f of ['src/components/drive-thru/BagSheets.tsx', 'src/lib/food-bags.ts', 'src/lib/food-bags-server.ts']) check(`${f}: no comments in markup, no uppercase, no " · "`, !/\{\/\*/.test(src(f)) && !/\buppercase\b/.test(src(f)) && !/ · /.test(src(f)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
