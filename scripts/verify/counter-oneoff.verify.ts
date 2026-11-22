// Checks something not on the menu, rung in at the counter or the window (design board "Register tools", part 2;
// lib/counter-oneoff; lib/counter-server editOrder 'oneOff', sendOrder, voidOrder; lib/counter-refund; api/counter
// 'oneOff'; api/menu laneSettings oneOffMax and oneOffForget; components/pos/CounterOneOff; components/menu/OneOffCard).
// - A name, a price up to the business's amount (or off), taxed or not: a line of its own, never merged.
// - It doesn't go to the kitchen and no stock moves; an order of only that is ready at once, and a void puts nothing back.
// - Its name is kept on record when it's sent; refunding it gives no tax back when it wasn't taxed.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-oneoff.verify.ts
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
  const X = await import('../../src/lib/counter-oneoff'); const CO = await import('../../src/lib/counter-orders');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/inventory/water`).set({ type: 'refreshment', name: 'Sparkling water', category: 'Drinks', price: 2.75, totalStock: 200, barcode: '012345678905', caseBarcode: '10012345678902', casePack: 6 });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Latte', category: 'Coffee', price: 5, totalStock: 200, barcode: '036000291452',
    choices: [{ id: 'size', name: 'Size', required: true, options: [{ id: 's', name: 'Small', price: 0 }, { id: 'l', name: 'Large', price: 1 }] }] });
  await db.doc(`${T}/inventory/chips`).set({ type: 'refreshment', name: 'Sea salt chips', category: 'Snacks', price: 2, totalStock: 50 });
  await db.doc(`${T}/inventory/shampoo`).set({ type: 'retail', name: 'Shampoo', price: 18, totalStock: 5, barcode: '042100005264' });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const passOf = async (id: string, name: string) => { const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex'); const h = createHash('sha256').update(key).digest('hex');
    await db.doc(`kitchenScreens/${h}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id, name, exp: Date.now() + 3600000 } } }, { merge: true }); return pass; };
  const mpass = await passOf('m9', 'Mo Diaz');
  const start = async (n: string) => (await P({ action: 'car', carKey: `oneoff-${n}` })).body.orderId as string;
  const lines = async (id: string) => (await get(`${T}/counterOrders/${id}`)).lines || [];


  console.log('the rules');
  check('up to $100 unless the business says, $0 is off, never past $1,000', X.oneOffMaxOf({}) === 100 && X.oneOffMaxOf({ counterOneOff: { max: 0 } }) === 0 && X.oneOffMaxOf({ counterOneOff: { max: 25.5 } }) === 25.5 && X.oneOffMaxOf({ counterOneOff: { max: 5000 } }) === 1000);
  const l1: any = X.oneOffLine({ name: '  Bag of beans,\n 12 oz ', price: '$18.00', taxed: false }, 100, 'x1');
  check('a line of its own: its name, its price, not taxed when said, no item', l1.ok && l1.line.name === 'Bag of beans, 12 oz' && l1.line.unitPrice === 18 && l1.line.untaxed === true && l1.line.oneOff === true && l1.line.itemId === '' && l1.line.quantity === 1, l1);
  check('…refused: no name, $0, past the most, or the most at $0', !X.oneOffLine({ name: ' ', price: 2 }, 100, 'x').ok && !X.oneOffLine({ name: 'Cup', price: 0 }, 100, 'x').ok && /Up to \$100\.00/.test((X.oneOffLine({ name: 'Grinder', price: 140 }, 100, 'x') as any).error) && /turned off/.test((X.oneOffLine({ name: 'Cup', price: 2 }, 0, 'x') as any).error));
  check('the same name in any case or spacing is kept as one', X.oneOffKey('Bag of Beans,  12 oz') === X.oneOffKey('bag of beans 12oz'.replace('12oz', '12 oz')) && X.oneOffKey('***') === null);
  const tz = { retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } };
  const t1 = CO.totalsOf(tz, [{ lineId: 'a', itemId: 'chips', name: 'Chips', quantity: 1, unitPrice: 5, choices: [], choicesText: null, makeSeconds: 0 }, l1.line]);
  const t2 = CO.totalsOf(tz, [{ lineId: 'a', itemId: 'chips', name: 'Chips', quantity: 1, unitPrice: 5, choices: [], choicesText: null, makeSeconds: 0 }, { ...l1.line, untaxed: undefined }]);
  check('not taxed: left out of the tax (and a reward’s share of it)', t1.subtotal === 23 && t1.tax === 0.5 && t1.total === 23.5 && t2.tax === 2.3 && CO.totalsOf(tz, [l1.line, { ...l1.line, lineId: 'b', untaxed: undefined, unitPrice: 2 }], 2).tax === 0.18, [t1, t2]);

  console.log('at the window');
  const o1 = await start('a');
  let r = await P({ action: 'lane' });
  check('the screen knows the most it can be', r.body.ok && r.body.oneOffMax === 100, r.body.oneOffMax);
  r = await P({ action: 'oneOff', orderId: o1, name: 'Bag of beans, 12 oz', price: 18, taxed: false, tapKey: 'tap-oneoff-0001' });
  let ls = await lines(o1);
  check('added: a line of its own, not taxed', r.body.ok && ls.length === 1 && ls[0].oneOff === true && ls[0].untaxed === true && ls[0].unitPrice === 18 && (await get(`${T}/counterOrders/${o1}`)).tax === 0, [r.body, ls]);
  await P({ action: 'oneOff', orderId: o1, name: 'Bag of beans, 12 oz', price: 18, taxed: false, tapKey: 'tap-oneoff-0001' });
  check('…the same tap sent twice: once', (await lines(o1)).length === 1);
  await P({ action: 'oneOff', orderId: o1, name: 'Bag of beans, 12 oz', price: 18, taxed: false, tapKey: 'tap-oneoff-0002' });
  check('…another tap: another line (never merged)', (await lines(o1)).length === 2);
  r = await P({ action: 'oneOff', orderId: o1, name: 'Grinder', price: 140, tapKey: 'tap-oneoff-0003' });
  check('past the most: refused, saying it goes on the menu first', r.status === 400 && /on the menu first/.test(r.body.error), r.body);
  r = await P({ action: 'add', orderId: o1, itemId: 'chips', tapKey: 'tap-oneoff-0004' });
  ls = await lines(o1);
  r = await P({ action: 'note', orderId: o1, lineId: ls[0].lineId, note: 'Grind it fine', tapKey: 'tap-oneoff-0006' });
  check('no note on it: it never goes to the kitchen', r.status === 409 && !(await lines(o1))[0].note, r.body);
  r = await P({ action: 'sizeUp', orderId: o1, lineId: ls[0].lineId, tapKey: 'tap-oneoff-0005' });
  check('no bigger size of something not on the menu', r.status === 409 && /isn’t on the menu/.test(r.body.error), r.body);
  const od1 = await get(`${T}/counterOrders/${o1}`);
  check('the order: $36 not taxed, chips taxed', od1.subtotal === 38 && od1.tax === 0.2 && od1.total === 38.2, [od1.subtotal, od1.tax, od1.total]);
  const chips0 = (await get(`${T}/inventory/chips`)).totalStock;
  r = await P({ action: 'send', orderId: o1 });
  const tix = (await db.collection(`${T}/kdsTickets`).get()).docs.map((d: any) => d.data()).filter((t: any) => t.orderId === o1);
  const named = await get(`${T}/oneOffNames/${X.oneOffKey('Bag of beans, 12 oz')}`);
  check('sent: the kitchen gets the chips only, and only the chips come off stock', r.body.ok && tix.length === 1 && tix[0].menuItemId === 'chips' && (await get(`${T}/inventory/chips`)).totalStock === chips0 - 1 && !(await get(`${T}/counterOrders/${o1}`)).kitchenNone, tix);
  check('…its name kept on record: twice, at $18', named && named.name === 'Bag of beans, 12 oz' && named.count === 2 && named.lastPrice === 18, named);
  const sales = await get(`${T}/menuSales/${new Date().toISOString().slice(0, 10)}`);
  check('…not in the menu’s sales counts', sales && !Object.keys(sales).some((k) => k === 'n_' || k.endsWith('_')), sales);

  console.log('only something not on the menu');
  const o2 = await start('b');
  await P({ action: 'oneOff', orderId: o2, name: 'Gift wrap', price: 3, tapKey: 'tap-oneoff-0010' });
  r = await P({ action: 'send', orderId: o2 });
  const o2d = await get(`${T}/counterOrders/${o2}`);
  check('sent: nothing for the kitchen, so it’s ready now (and no bag taken for it)', r.body.ok && o2d.kitchenNone === true && !(await db.collection(`${T}/kdsTickets`).get()).docs.some((d: any) => d.data().orderId === o2) && !o2d.extrasTaken, o2d);
  r = await P({ action: 'lane' });
  check('…the screen shows it ready', r.body.orders?.[o2]?.kitchen === 'ready', r.body.orders?.[o2]);
  process.env.TWILIO_ACCOUNT_SID = 'AC1'; process.env.TWILIO_AUTH_TOKEN = 'x'; process.env.TWILIO_FROM = '+15550000000';
  const RT = await import('../../src/lib/ready-text');
  // (Ready texts are for the counter, kiosk and orders ahead: the same order, as the counter's.)
  await db.doc(`${T}/counterOrders/${o2}`).set({ channel: 'counter' }, { merge: true });
  const ask: any = await RT.askReadyText(db, 't1', await get(T), o2, '5551234567', 'counter' as any).catch((e: any) => ({ ok: false, error: String(e) }));
  await db.doc(`${T}/counterOrders/${o2}`).set({ channel: 'drive-thru' }, { merge: true });
  check('…and no text when ready: it’s ready already', ask.ok === false && ask.code === 'ready' && !(await get(`${T}/counterOrders/${o2}`)).readyText, ask);
  r = await P({ action: 'void', orderId: o2, reason: 'Left', staffPass: mpass });
  check('…voided: nothing to put back, nothing thrown away', r.body.ok && r.body.returned === 0 && r.body.wasted === 0, r.body);

  console.log('paid, and refunded');
  r = await P({ action: 'paid', orderId: o1, method: 'card' });
  check('(paid on a card machine)', r.body.ok, r.body);
  const bean = (await lines(o1)).find((l: any) => l.oneOff);
  r = await P({ action: 'refundPreview', orderId: o1, all: false, lines: [{ lineId: bean.lineId, qty: 1 }], reason: 'Wrong order' });
  check('refunding something not taxed: no tax back', r.body.ok && r.body.plan.cents === 1800 && r.body.plan.taxCents === 0, r.body.plan);
  const chipLine = (await lines(o1)).find((l: any) => l.itemId === 'chips');
  r = await P({ action: 'refundPreview', orderId: o1, all: false, lines: [{ lineId: chipLine.lineId, qty: 1 }], reason: 'Wrong order' });
  check('…the chips: their tax back, all of it', r.body.ok && r.body.plan.cents === 220 && r.body.plan.taxCents === 20, r.body.plan);

  console.log('off, and the Menu page');
  await db.doc(T).set({ counterOneOff: { max: 0 } }, { merge: true });
  const o3 = await start('c');
  r = await P({ action: 'oneOff', orderId: o3, name: 'Gift wrap', price: 3, tapKey: 'tap-oneoff-0020' });
  check('turned off: refused, saying where it’s turned on', r.status === 400 && /under Menu/.test(r.body.error) && (await P({ action: 'lane' })).body.oneOffMax === 0, r.body);
  const menuRoute = src('src/app/api/menu/route.ts');
  check('the Menu page: up to how much ($0 to $1,000, $0 turns it off), and what’s been rung in by name, with a way to take one off the list', /b\.oneOffMax !== undefined/.test(menuRoute) && /b\.oneOffMax === null \|\| b\.oneOffMax === '' \? NaN/.test(menuRoute) && /oneOffForget/.test(menuRoute) && /oneOff: canEdit \? \{ max: oneOffMaxOf\(td\), names: await oneOffNamesOf\(db, tenantId\) \}/.test(menuRoute) && /'laneSettings'/.test(menuRoute.slice(menuRoute.indexOf('requireRole(req, tenantId, ['), menuRoute.indexOf('requireRole(req, tenantId, [') + 200)));

  console.log('the screens');
  const counter = src('src/app/(app)/counter/page.tsx'), window = src('src/app/drive-thru/[tenantId]/page.tsx'), sheet = src('src/components/pos/CounterOneOff.tsx'), card = src('src/components/menu/OneOffCard.tsx'), menuPage = src('src/app/(app)/menu/page.tsx');
  check('“Another item, not on the menu” at the counter and the window, while an order is being taken', counter.includes('Another item, not on the menu') && window.includes('Another item, not on the menu') && counter.includes('<OneOffSheet') && window.includes('<OneOffSheet') && counter.includes('!oneOffOpen') && window.includes('!oneOffOpen'));
  check('the sheet: what it is, the price, taxed or not, one tap one line', sheet.includes('What is it?') && sheet.includes('>Taxed<') && sheet.includes('>Not taxed<') && sheet.includes('tapKey') && sheet.includes('doesn’t go to the kitchen'));
  check('the Menu page’s card', menuPage.includes('<OneOffCard') && card.includes('Rung in lately') && card.includes('Turn it off'));
  const mine = sheet + card + src('src/lib/counter-oneoff.ts');
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(mine) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b|[Ss]tudio/.test(mine) && (sheet.match(/min-h-\[(44|48|52)px\]/g) || []).length >= 4);

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
