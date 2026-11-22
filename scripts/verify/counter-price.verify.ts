// Checks one item at a different price, and opening the drawer with no sale, at the counter and the window (design
// board "Register tools, part 3"; lib/counter-price-server, lib/counter-price, lib/drawer-moves-server drawerNoSale;
// api/counter 'price', 'priceBack' and 'noSale'; components/pos/CounterPrice, DrawerMove; the receipt and the night
// report).
// - A different price: lower takes a manager, higher doesn't; some of a line while it's taken, all of it once it's with
//   the kitchen; never merged into, never more of it at a lower price without another okay; back at the menu price.
// - No sale: someone signed in, with why, on the open drawer's record first, then the drawer opens; once per tap.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-price.verify.ts
import { readFileSync } from 'fs';
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

// A pretend card company: payments, readers and refunds, as the server sees them.
const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), readers: new Map<string, any>(), refunds: [] as any[], refundKeys: new Map<string, any>(), calls: [] as string[], n: 0, listCalls: 0, down: false,
  onCreate: null as null | (() => Promise<void>), onProcess: null as null | (() => Promise<void>), refundErr: null as null | string };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const err = (code: string, msg = code) => Object.assign(new Error(msg), { code, raw: { code } });
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (S.down) throw err('api_connection_error');
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, description: p.description, currency: p.currency, status: 'requires_payment_method', capture_method: p.capture_method, metadata: { ...p.metadata }, amount_received: 0, latest_charge: null, account: o?.stripeAccount };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); S.calls.push(`create ${id}`);
      if (S.onCreate) { const f = S.onCreate; S.onCreate = null; await f(); }
      return clone(pi);
    },
    retrieve: async (id: string) => { if (S.down) throw err('api_connection_error'); const pi = S.pis.get(id); if (!pi) throw Object.assign(err('resource_missing'), { statusCode: 404 }); return clone(pi); },
    capture: async (id: string) => { const pi = S.pis.get(id); if (pi.status !== 'requires_capture') throw err('payment_intent_unexpected_state'); pi.status = 'succeeded'; pi.amount_received = pi.amount; S.calls.push(`capture ${id}`); return clone(pi); },
    cancel: async (id: string) => { const pi = S.pis.get(id); if (pi.status === 'succeeded') throw err('payment_intent_unexpected_state'); pi.status = 'canceled'; S.calls.push(`cancel ${id}`); return clone(pi); },
  };
  refunds = { create: async (p: any, o?: any) => {
    if (S.refundErr) { const e: any = err(S.refundErr.code || S.refundErr); if (S.refundErr.type) e.type = S.refundErr.type; throw e; }
    if (o?.idempotencyKey && S.refundKeys.has(o.idempotencyKey)) return S.refundKeys.get(o.idempotencyKey);
    S.refunds.push({ ...p, key: o?.idempotencyKey || null }); const pi = S.pis.get(p.payment_intent); if (pi) pi.refunded = true;
    const r = { id: `re_${S.refunds.length}`, status: 'succeeded', amount: p.amount }; if (o?.idempotencyKey) S.refundKeys.set(o.idempotencyKey, r); return r; } };
  terminal = { readers: {
    list: async () => { S.listCalls++; return { data: Array.from(S.readers.values()).map(clone) }; },
    retrieve: async (id: string) => { const r = S.readers.get(id); if (!r) throw Object.assign(err('resource_missing'), { statusCode: 404 }); return clone(r); },
    processPaymentIntent: async (id: string, p: any) => {
      const r = S.readers.get(id); if (!r) throw Object.assign(err('resource_missing'), { statusCode: 404 });
      if (r.status !== 'online') throw err('terminal_reader_offline');
      if (r.action?.status === 'in_progress') throw err('terminal_reader_busy');
      if (S.onProcess) { const f = S.onProcess; S.onProcess = null; await f(); }
      r.action = { type: 'process_payment_intent', status: 'in_progress', process_payment_intent: { payment_intent: p.payment_intent }, failure_message: null };
      S.calls.push(`process ${id} ${p.payment_intent} tip:${p.process_config?.skip_tipping === true ? 'no' : 'yes'}`); return clone(r);
    },
    cancelAction: async (id: string) => { const r = S.readers.get(id); r.action = null; S.calls.push(`cancelAction ${id}`); return clone(r); },
  } };
  testHelpers = { terminal: { readers: { presentPaymentMethod: async (id: string) => { approve(id); return clone(S.readers.get(id)); } } } };
}
/** The guest taps a card the reader approves / declines. */
const approve = (readerId: string) => { const r = S.readers.get(readerId); const piId = r.action.process_payment_intent.payment_intent; S.pis.get(piId).status = 'requires_capture'; r.action.status = 'succeeded'; };
const decline = (readerId: string, msg = 'Your card was declined.') => { const r = S.readers.get(readerId); r.action.status = 'failed'; r.action.failure_message = msg; };

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
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, counterDiscounts: [{ id: 'ten', label: 'Ten off', kind: 'pct', value: 10 }] });
  await db.doc(`${T}/inventory/muffin`).set({ type: 'refreshment', name: 'Blueberry muffin', category: 'Bakery', price: 3.75, totalStock: 50 });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Oat latte', category: 'Drinks', price: 5.25, totalStock: 50 });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  await db.doc(`${T}/staff/s2`).set({ name: 'Kai Park', role: 'staff', isActive: true });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const passOf = async (id: string, name: string) => { const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex'); const h = createHash('sha256').update(key).digest('hex');
    await db.doc(`kitchenScreens/${h}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id, name, exp: Date.now() + 3600000 } } }, { merge: true }); return pass; };
  const mpass = await passOf('m9', 'Mo Diaz'); const kpass = await passOf('s2', 'Kai Park');
  const start = async (n: string) => (await P({ action: 'car', carKey: `price-${n}` })).body.orderId as string;
  const order = (id: string) => get(`${T}/counterOrders/${id}`);
  const lines = async (id: string) => (await order(id)).lines || [];
  const PR = await import('../../src/lib/counter-price');

  console.log('the rules');
  check('a price from a cent to $1,000', PR.cleanPrice('2') === 200 && PR.cleanPrice('$0.01') === 1 && PR.cleanPrice('0') === null && PR.cleanPrice('1000.01') === null && PR.cleanPrice('abc') === null);
  check('how it reads', PR.priceWords({ priceChange: { from: 3.75, to: 2, reason: 'Damaged', by: 'Kai', approvedBy: 'Mo Diaz', at: '' } }) === 'Was $3.75: Damaged' && PR.priceWords({}) === '');

  console.log('while it’s being taken');
  const o1 = await start('a');
  await P({ action: 'add', orderId: o1, itemId: 'muffin', quantity: 3, tapKey: 'tap-price-0001' });
  const m1 = (await lines(o1))[0].lineId;
  let r = await P({ action: 'price', orderId: o1, lineId: m1, qty: 1, price: 2, reason: 'Damaged', staffPass: kpass });
  check('lower takes a manager: without one, it asks', r.status === 403 && r.body.needsManager === true && (await lines(o1)).length === 1, r.body);
  r = await P({ action: 'price', orderId: o1, lineId: m1, qty: 1, price: 2, reason: ' ', staffPass: mpass });
  check('…and why', r.status === 400 && r.body.code === 'reason', r.body);
  r = await P({ action: 'price', orderId: o1, lineId: m1, qty: 1, price: 0, reason: 'Damaged', staffPass: mpass });
  check('$0 is On the house instead', r.status === 400 && r.body.code === 'price', r.body);
  r = await P({ action: 'price', orderId: o1, lineId: m1, qty: 1, price: 2, reason: 'Damaged', staffPass: mpass });
  let od = await order(o1); let ch = (await lines(o1)).find((l: any) => l.priceChange); let rest = (await lines(o1)).find((l: any) => !l.priceChange);
  check('one of three at $2: split off, its menu price and why kept, okayed by the manager', r.body.ok && ch.quantity === 1 && ch.unitPrice === 2 && ch.priceChange.from === 3.75 && ch.priceChange.approvedBy === 'Mo Diaz' && rest.quantity === 2 && rest.unitPrice === 3.75, [r.body, ch]);
  check('…the money: $7.50 + $2.00 and its tax', od.subtotal === 9.5 && od.tax === 0.95 && od.total === 10.45 && od.priceChanges?.length === 1, [od.subtotal, od.tax, od.total]);
  await P({ action: 'add', orderId: o1, itemId: 'muffin', quantity: 1, tapKey: 'tap-price-0002' });
  check('another from the menu joins the line at the menu price, never the changed one', (await lines(o1)).find((l: any) => !l.priceChange).quantity === 3 && (await lines(o1)).find((l: any) => l.priceChange).quantity === 1);
  r = await P({ action: 'qty', orderId: o1, lineId: ch.lineId, quantity: 2, tapKey: 'tap-price-0003' });
  check('more at the lower price is another okay', r.status === 409 && (await lines(o1)).find((l: any) => l.priceChange).quantity === 1, r.body);
  r = await P({ action: 'price', orderId: o1, lineId: ch.lineId, qty: 1, price: 2, reason: 'Damaged', staffPass: mpass });
  check('the same price again is said so', r.status === 409 && r.body.code === 'same', r.body);
  const lat = await (async () => { await P({ action: 'add', orderId: o1, itemId: 'latte', quantity: 1, tapKey: 'tap-price-0004' }); return (await lines(o1)).find((l: any) => l.itemId === 'latte').lineId; })();
  r = await P({ action: 'price', orderId: o1, lineId: lat, qty: 1, price: 6, reason: 'Wrong price', staffPass: kpass });
  check('higher needs no manager', r.body.ok && (await lines(o1)).find((l: any) => l.lineId === lat).unitPrice === 6 && r.body.approvedBy === null, r.body);
  r = await P({ action: 'priceBack', orderId: o1, lineId: lat, staffPass: kpass });
  check('…and back at its lower menu price takes one', r.status === 403 && r.body.needsManager, r.body);
  r = await P({ action: 'price', orderId: o1, lineId: ch.lineId, qty: 1, price: 3, reason: 'Last one of the day', staffPass: kpass });
  check('raised after a manager lowered it: no manager’s name on it', r.body.ok && (await lines(o1)).find((l: any) => l.lineId === ch.lineId).priceChange.approvedBy === null && (await lines(o1)).find((l: any) => l.lineId === ch.lineId).priceChange.from === 3.75, (await lines(o1)).find((l: any) => l.lineId === ch.lineId));
  r = await P({ action: 'priceBack', orderId: o1, lineId: ch.lineId, staffPass: kpass });
  check('the muffin back at its menu price (higher: anyone)', r.body.ok && (await lines(o1)).find((l: any) => l.lineId === ch.lineId).unitPrice === 3.75 && !(await lines(o1)).find((l: any) => l.lineId === ch.lineId).priceChange && (await order(o1)).priceChanges[0].undoneAt, r.body);

  console.log('with the kitchen');
  r = await P({ action: 'price', orderId: o1, lineId: ch.lineId, qty: 1, price: 2.5, reason: 'Damaged', staffPass: mpass });
  await P({ action: 'send', orderId: o1 });
  const three = (await lines(o1)).find((l: any) => l.itemId === 'muffin' && !l.priceChange).lineId;
  r = await P({ action: 'price', orderId: o1, lineId: three, qty: 1, price: 3, reason: 'Damaged', staffPass: mpass });
  check('sent: the whole line or none', r.status === 409 && r.body.code === 'whole', r.body);
  await P({ action: 'discount', orderId: o1, discountId: 'ten' });
  od = await order(o1);
  check('a discount on the order is on the changed price too', od.markdown?.cents > 0 && Math.round(od.itemsTotal * 100) === 3 * 375 + 250 + 600, [od.itemsTotal, od.markdown]);
  r = await P({ action: 'comp', orderId: o1, lineId: lat, qty: 1, reason: 'Long wait', staffPass: mpass });
  r = await P({ action: 'price', orderId: o1, lineId: lat, qty: 1, price: 4, reason: 'Damaged', staffPass: mpass });
  check('on the house: charged for first', r.status === 409 && r.body.code === 'comp', r.body);
  r = await P({ action: 'priceBack', orderId: o1, lineId: lat, staffPass: mpass });
  check('…and never back at its menu price while it’s on the house', r.status === 409 && r.body.code === 'comp' && (await lines(o1)).find((l: any) => l.lineId === lat).unitPrice === 0, r.body);
  await P({ action: 'giftCard', orderId: o1, cents: 1000, tapKey: 'tap-price-0005' });

  const o3 = await start('c');
  await P({ action: 'oneOff', orderId: o3, name: 'Bag of beans', price: 18, tapKey: 'tap-price-0010' });
  r = await P({ action: 'price', orderId: o3, lineId: (await lines(o3))[0].lineId, qty: 1, price: 900, reason: 'Wrong price', staffPass: kpass });
  check('something not on the menu is rung in at its own price', r.status === 409 && r.body.code === 'one_off', r.body);

  console.log('paid');
  r = await P({ action: 'paid', orderId: o1, method: 'card' });
  od = await order(o1);
  const RC = await import('../../src/lib/counter-receipt');
  check('the receipt says what it was', RC.counterReceipt(od, o1).detail.lines.some((l: any) => /Blueberry muffin, was \$3\.75/.test(l.label) && l.unit === 2.5), RC.counterReceipt(od, o1).detail.lines);
  r = await P({ action: 'price', orderId: o1, lineId: three, qty: 3, price: 3, reason: 'Late', staffPass: mpass });
  check('paid already: a refund instead', r.status === 409 && r.body.code === 'paid', r.body);
  const o2 = await start('b');
  await P({ action: 'giftCard', orderId: o2, cents: 2500, tapKey: 'tap-price-0006' });
  r = await P({ action: 'price', orderId: o2, lineId: (await lines(o2))[0].lineId, qty: 1, price: 20, reason: 'Damaged', staffPass: mpass });
  check('a gift card is its own amount', r.status === 409 && r.body.code === 'gift', r.body);

  console.log('the night report');
  const NC = await import('../../src/lib/night-close');
  const rep = NC.nightReport({ day: '2026-11-22', timeZone: 'UTC', sales: [], tables: [], adjustments: [], tips: { mode: 'direct', rows: [] }, items: [], checks: {},
    tills: [{ openedBy: 'Ana', openingFloat: 100, expectedCash: 100, actualCash: null, status: 'open', moves: [{ kind: 'out', cents: 500, note: 'Milk', by: 'Ana', approvedBy: 'Mo' }], noSales: { count: 3, by: ['Ana', 'Ana', 'Kai'] } }],
    priceOffs: [{ amount: 1.75, reason: 'Damaged' }, { amount: 1.25, reason: 'Damaged' }, { amount: 1.25, reason: 'Price match' }] });
  const txt = NC.reportText('Northside', rep);
  check('what different prices took off, by why', rep.priceChanges?.count === 3 && rep.priceChanges.total === 4.25 && rep.priceChanges.byReason[0].label === 'Damaged' && txt.includes('Different prices $4.25 off (3)'), rep.priceChanges);
  check('the drawer opened with no sale, by who (never listed as money moved)', rep.noSales?.count === 3 && rep.noSales.byPerson.find((x: any) => x.label === 'Ana')?.count === 2 && txt.includes('Drawer opened with no sale: 3 times (Ana 2, Kai 1)') && !/To the safe \$0\.00/.test(txt), txt);
  check('…counted from the drawer’s own count and list, never from its money moves', /noSales: \{ count: Math\.round\(num\(t\.noSales\)\)/.test(src('src/lib/night-close-server.ts')));
  check('the night’s paid orders give what their different prices took off', /priceOffs = co\.docs/.test(src('src/lib/night-close-server.ts')) && /priceOffs,/.test(src('src/lib/night-close-server.ts')));

  console.log('no sale');
  r = await P({ action: 'noSale', reason: 'Make change', moveKey: 'nosale-00000001' });
  check('someone signed in here does it', r.status === 403 && r.body.needsStaff === true, r.body);
  r = await P({ action: 'noSale', reason: 'Make change', moveKey: 'nosale-00000001', staffPass: kpass });
  check('no printer opens a drawer: said so', r.status === 409 && r.body.code === 'no_printer', r.body);
  await db.doc(`${T}/printers/front`).set({ name: 'Front counter', kind: 'star', receipts: true, drawer: true });
  r = await P({ action: 'noSale', reason: 'Make change', moveKey: 'nosale-00000001', staffPass: kpass });
  check('no drawer open: said so', r.status === 409 && r.body.code === 'closed', r.body);
  await db.doc(`${T}/tillSessions/till1`).set({ id: 'till1', status: 'open', openedBy: 'Ana', openingFloat: 100, expectedCash: 140 });
  r = await P({ action: 'noSale', reason: ' ', moveKey: 'nosale-00000001', staffPass: kpass });
  check('…and why', r.status === 400 && r.body.code === 'note', r.body);
  r = await P({ action: 'noSale', reason: 'Make change', moveKey: 'nosale-00000001', staffPass: kpass });
  let till = await get(`${T}/tillSessions/till1`);
  const jobs = async () => (await db.collection(`${T}/printJobs`).get()).docs.map((d: any) => d.data()).filter((j: any) => j.kind === 'drawer');
  check('on the drawer’s record as theirs, with why, then opened on the printer with the drawer', r.body.ok && r.body.printer === 'Front counter' && till.noSaleLog?.[0]?.by === 'Kai Park' && till.noSaleLog[0].note === 'Make change' && till.noSaleLog[0].opened === true && till.noSales === 1 && till.expectedCash === 140 && !(till.cashMoves || []).length && (await jobs()).length === 1 && (await jobs())[0].printerId === 'front', [r.body, till]);
  r = await P({ action: 'noSale', reason: 'Make change', moveKey: 'nosale-00000001', staffPass: kpass });
  check('one tap is one opening', r.body.ok && r.body.already && (await jobs()).length === 1 && (await get(`${T}/tillSessions/till1`)).noSales === 1, r.body);
  r = await P({ action: 'drawerUndo', moveKey: 'nosale-00000001', staffPass: mpass });
  check('it stays on the record', r.status === 409 && r.body.code === 'nosale', r.body);
  // An opening on the record whose drawer job didn't go: asked again with the same key, it opens (once).
  const T2 = await get(`${T}/tillSessions/till1`);
  await db.doc(`${T}/tillSessions/till1`).set({ noSaleLog: [...T2.noSaleLog, { key: 'nosale-00000002', note: 'Make change', by: 'Kai Park', byId: 's2', at: new Date().toISOString(), opened: false }], noSales: 2 }, { merge: true });
  r = await P({ action: 'noSale', reason: 'Make change', moveKey: 'nosale-00000002', staffPass: kpass });
  check('…one whose opening didn’t go opens when asked again, still one on the record', r.body.ok && (await jobs()).length === 2 && (await get(`${T}/tillSessions/till1`)).noSales === 2 && (await get(`${T}/tillSessions/till1`)).noSaleLog.find((m: any) => m.key === 'nosale-00000002').opened === true, r.body);
  r = await P({ action: 'drawerView', staffPass: kpass });
  check('the drawer’s today list shows it', r.body.drawer?.moves?.some((m: any) => m.kind === 'nosale' && m.by === 'Kai Park'), r.body.drawer);

  console.log('the screens');
  const counter = src('src/app/(app)/counter/page.tsx'), window = src('src/app/drive-thru/[tenantId]/page.tsx'), sheet = src('src/components/pos/CounterPrice.tsx'), dsheet = src('src/components/pos/DrawerMove.tsx');
  check('“Change price” (on the house, or a different price) and “Menu price” on each line, at the counter and the window', [counter, window].every((p) => p.includes('<PriceSheet') && p.includes('<PriceMenu name={l.name} free={l.unitPrice > 0}') && p.includes('>Menu price</button>') && p.includes('priceWords(l as any)')) && sheet.includes('>On the house</button>') && sheet.includes('>A different price</button>'));
  check('the sheet: the new price, why, how many while it’s being taken, a manager’s PIN when lower', sheet.includes('PRICE_REASONS') && sheet.includes('Something else') && sheet.includes('PinPad') && sheet.includes('whole') && sheet.includes('a manager’s PIN'));
  check('the drawer sheet opens it with no sale, with why', dsheet.includes("action: 'noSale'") && dsheet.includes('Open the drawer, no sale') && dsheet.includes("m.kind !== 'nosale' && <button"));
  check('the till shows how often it was opened with no sale', src('src/components/pos/TillManagement.tsx').includes('Opened with no sale'));
  const mine = sheet + src('src/lib/counter-price.ts') + src('src/lib/counter-price-server.ts');
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(mine) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b|[Ss]tudio/.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
