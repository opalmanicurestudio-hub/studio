// Checks taking something off an order the kitchen has, before it's paid (design board "Register tools, part 2", part 1;
// lib/counter-takeoff-server; api/counter 'takeOff'; components/pos/CounterTakeOff on the counter and the window).
// - Not started: some or all of a line comes off, back on the shelf in the same share (its own count, its recipe), its
//   ticket off the kitchen screen or showing fewer; the order's money follows, its discount worked out again.
// - Started: a manager okays it, it's kept as waste. Paid, still being taken, the last of the order, or something set
//   aside on it: refused, saying what to do instead.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-takeoff.verify.ts
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
  await db.doc(`${T}/inventory/chips`).set({ type: 'refreshment', name: 'Sea salt chips', category: 'Snacks', price: 2, totalStock: 50 });
  await db.doc(`${T}/inventory/water`).set({ type: 'refreshment', name: 'Sparkling water', category: 'Drinks', price: 3, totalStock: 40 });
  await db.doc(`${T}/inventory/bun`).set({ type: 'retail', name: 'Buns', totalStock: 100, unit: 'units' });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Food', price: 10, totalStock: 50, formula: [{ id: 'bun', name: 'Bun', quantityUsed: 1, unit: 'units' }] });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const passOf = async (id: string, name: string) => { const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex'); const h = createHash('sha256').update(key).digest('hex');
    await db.doc(`kitchenScreens/${h}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id, name, exp: Date.now() + 3600000 } } }, { merge: true }); return pass; };
  const mpass = await passOf('m9', 'Mo Diaz');
  const start = async (n: string) => (await P({ action: 'car', carKey: `takeoff-${n}` })).body.orderId as string;
  const lines = async (id: string) => (await get(`${T}/counterOrders/${id}`)).lines || [];


  const order = (id: string) => get(`${T}/counterOrders/${id}`);
  const stock = async (id: string) => (await get(`${T}/inventory/${id}`)).totalStock;
  const tickets = async (id: string) => (await db.collection(`${T}/kdsTickets`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((t: any) => t.orderId === id);
  const lineOf = async (id: string, itemId: string) => (await lines(id)).find((l: any) => l.itemId === itemId);

  console.log('not started yet');
  const o1 = await start('a');
  for (const [it, q, k] of [['chips', 3, 1], ['burger', 2, 2], ['water', 1, 3]] as [string, number, number][]) await P({ action: 'add', orderId: o1, itemId: it, quantity: q, tapKey: `tap-takeoff-000${k}` });
  let r = await P({ action: 'takeOff', orderId: o1, lineId: (await lineOf(o1, 'chips')).lineId, qty: 1 });
  check('still being taken: take it off as usual', r.status === 409 && r.body.code === 'building', r.body);
  await P({ action: 'send', orderId: o1 });
  await P({ action: 'discount', orderId: o1, discountId: 'ten' });
  const before = await order(o1);
  check('(sent: chips, burgers and a water; 10% off)', before.total === 28.71 && (await stock('chips')) === 47 && (await stock('bun')) === 98, [before.total, await stock('chips'), await stock('bun')]);
  r = await P({ action: 'takeOff', orderId: o1, lineId: (await lineOf(o1, 'chips')).lineId, qty: 1 });
  let od = await order(o1); let chipT = (await tickets(o1)).find((t: any) => t.menuItemId === 'chips');
  check('one of three chips off: back on the shelf, the ticket shows two', r.body.ok && r.body.made === false && (await stock('chips')) === 48 && chipT.quantity === 2 && chipT.status === 'pending' && (await lineOf(o1, 'chips')).quantity === 2, [r.body, chipT]);
  check('…the money follows: 10% of what’s left, and what was taken is kept as what’s left of it', od.subtotal === 24.3 && od.markdown.cents === 270 && od.total === 26.73 && r.body.less === 1.98 && od.stockTaken[(await lineOf(o1, 'chips')).lineId].own === 2 && od.takenOffReturnedQty === 1, [od.subtotal, od.markdown, od.total, od.stockTaken]);
  const corr = (await db.collection(`${T}/stockCorrections`).get()).docs.map((d: any) => d.data()).filter((c: any) => c.type === 'returned' && /Taken off/.test(c.reason));
  check('…counted apart from a void’s', od.takenOffReturnedQty === 1 && !od.returnedQty);
  check('…on the stock history as returned', corr.length === 1 && corr[0].productId === 'chips' && corr[0].change === 1, corr);
  r = await P({ action: 'takeOff', orderId: o1, lineId: (await lineOf(o1, 'burger')).lineId, qty: 2 });
  const burgerT = (await tickets(o1)).find((t: any) => t.menuItemId === 'burger');
  check('both burgers off: their buns back, the ticket off the kitchen screen', r.body.ok && (await stock('bun')) === 100 && burgerT.status === 'cancelled' && burgerT.takenOff === true && !(await lineOf(o1, 'burger')), [r.body, burgerT]);

  console.log('started already');
  const waterT = (await tickets(o1)).find((t: any) => t.menuItemId === 'water');
  await db.doc(`${T}/kdsTickets/${waterT.id}`).set({ status: 'in_progress' }, { merge: true });
  r = await P({ action: 'takeOff', orderId: o1, lineId: (await lineOf(o1, 'water')).lineId, qty: 1 });
  check('the kitchen started it: a manager’s', r.status === 403 && r.body.needsManager === true && !!(await lineOf(o1, 'water')), r.body);
  const water0 = await stock('water');
  r = await P({ action: 'takeOff', orderId: o1, lineId: (await lineOf(o1, 'water')).lineId, qty: 1, staffPass: mpass });
  od = await order(o1);
  check('okayed: kept as waste (apart from a void’s, with when), nothing back on the shelf, its ticket off the screen', r.body.ok && r.body.made === true && r.body.approvedBy === 'Mo Diaz' && (await stock('water')) === water0 && od.takenOffWaste?.water === 1 && od.takenOffWastedQty === 1 && !!od.wastedAt && !od.wastedItems && (await tickets(o1)).find((t: any) => t.menuItemId === 'water').status === 'cancelled', [r.body, od.takenOffWaste]);
  check('…kept on the order: what came off, how many, who okayed it', Array.isArray(od.takenOff) && od.takenOff.length === 3 && od.takenOff[2].approvedBy === 'Mo Diaz' && od.takenOff[2].made === true, od.takenOff);

  console.log('what it doesn’t do');
  r = await P({ action: 'takeOff', orderId: o1, lineId: (await lineOf(o1, 'chips')).lineId, qty: 2 });
  check('the last of the order: void it instead', r.status === 409 && r.body.code === 'all', r.body);
  r = await P({ action: 'takeOff', orderId: o1, lineId: (await lineOf(o1, 'chips')).lineId, qty: 3 });
  check('more than there is: refused', r.status === 400, r.body);
  r = await P({ action: 'takeOff', orderId: o1, lineId: (await lineOf(o1, 'chips')).lineId, qty: 1 });
  check('…one of the last two: fine', r.body.ok && (await lineOf(o1, 'chips')).quantity === 1, r.body);
  await P({ action: 'paid', orderId: o1, method: 'card' });
  const o2 = await start('b');
  await P({ action: 'add', orderId: o2, itemId: 'chips', quantity: 2, tapKey: 'tap-takeoff-0010' }); await P({ action: 'send', orderId: o2 }); await P({ action: 'paid', orderId: o2, method: 'card' });
  r = await P({ action: 'takeOff', orderId: o2, lineId: (await lineOf(o2, 'chips')).lineId, qty: 1 });
  check('paid already: a refund instead', r.status === 409 && r.body.code === 'paid' && /Refund/.test(r.body.error), r.body);

  console.log('the screens');
  const counter = src('src/app/(app)/counter/page.tsx'), window = src('src/app/drive-thru/[tenantId]/page.tsx'), sheet = src('src/components/pos/CounterTakeOff.tsx'), route = src('src/app/api/counter/route.ts');
  check('“Take off” on an order with the kitchen, before it’s paid, at the counter and the window', counter.includes('<TakeOffSheet') && window.includes('<TakeOffSheet') && /const canTakeOff = !!order && order\.status === 'sent' && !order\.paidAt/.test(counter) && /const canTakeOff = !!order && order\.status === 'sent' && !order\.paidAt/.test(window));
  check('the sheet: how many, and a manager’s PIN when the kitchen started it', sheet.includes('PinPad') && sheet.includes('needsManager') && sheet.includes('kept as waste') && sheet.includes('Refund it instead'));
  const fc = src('src/app/api/food-cost/route.ts'), rt = src('src/lib/ready-text.ts');
  check('Food cost counts what was made and taken off, in its own stretch; a text still goes when nothing is left to make', /where\('wastedAt', '>=', start\)/.test(fc) && /takenOffWaste/.test(fc) && /const nothingToMake = pre\.kitchenNone === true/.test(rt));
  check('the route: a manager for what’s made, on the audit log, and the ready text', /action === 'takeOff'/.test(route) && /counter\.takeOff/.test(route) && /textIfReady\(db, tenantId, \[orderId\]\)/.test(route));
  const mine = sheet + src('src/lib/counter-takeoff-server.ts');
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(mine) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b|[Ss]tudio/.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
