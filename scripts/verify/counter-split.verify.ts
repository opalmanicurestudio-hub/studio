// Checks split bills at the counter and the drive-thru (lib/counter-split-server; api/counter 'split', 'part',
// 'partUndo', 'card' with a part; lib/counter-card; components/pos/CounterMoney SplitAsk).
// - Evenly some number of ways, or by amount; each part in cash (into the drawer then), on the card reader, on another
//   card machine, or with a gift card for that share. The last part pays the order, booked once as split.
// - While a part is paid the total stays as it is, and the order isn't voided until the parts are given back.
// - A part given back takes a manager: cash out of the drawer, a card refunded once.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-split.verify.ts
import { readFileSync } from 'fs';
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

// A pretend card company: payments, readers and refunds, as the server sees them.
const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), readers: new Map<string, any>(), refunds: [] as any[], calls: [] as string[], n: 0, listCalls: 0, down: false,
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
  refunds = { create: async (p: any) => { if (S.refundErr) throw err(S.refundErr); S.refunds.push(p); const pi = S.pis.get(p.payment_intent); if (pi) pi.refunded = true; return { id: `re_${S.refunds.length}`, status: 'succeeded', amount: p.amount }; } };
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
  const CM = await import('../../src/lib/counter-money');
  const CS = await import('../../src/lib/counter-server');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', stripeAccountId: 'acct_1', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, counterTips: { on: true, pcts: [15, 18, 20], where: 'both' }, counterDiscounts: [{ id: 'team', label: 'Team', kind: 'pct', value: 50 }] });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 2.5, totalStock: 500 });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 100, totalCashSales: 0 });
  S.readers.set('tmr_window1', { id: 'tmr_window1', label: 'Window', device_type: 'stripe_s700', status: 'online', action: null });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const passOf = async (id: string, name: string) => { const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex'); const h = createHash('sha256').update(key).digest('hex');
    await db.doc(`kitchenScreens/${h}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id, name, exp: Date.now() + 3600000 } } }, { merge: true }); return pass; };
  let n = 0;
  const newOrder = async (qty = 8) => {
    const c = (await P({ action: 'car', carKey: `carkey-split-${++n}` })).body;
    await P({ action: 'add', orderId: c.orderId, itemId: 'fries', quantity: qty, tapKey: `tap-split-${n}-a` });
    const s: any = await P({ action: 'send', orderId: c.orderId });
    if (!s.body.ok) throw new Error(JSON.stringify(s.body));
    return c.orderId as string;
  };
  const laneOrder = async (id: string) => (await P({ action: 'lane' })).body.orders?.[id] || null;
  const till = async () => (await get(`${T}/tillSessions/till1`)).expectedCash;

  console.log('the next share');
  check('evenly: what’s left over the ways still to pay, the last one whatever’s left', CM.nextShare(2201, 2, 0) === 1101 && CM.nextShare(1100, 2, 1) === 1100 && CM.nextShare(3000, 3, 0) === 1000 && CM.nextShare(2000, 3, 1) === 1000 && CM.nextShare(500, 2, 5) === 500);

  console.log('two ways: cash, then a card machine');
  const o1 = await newOrder(8);   // 8 × 2.50 + 10% = 22.00
  let r = await P({ action: 'split', orderId: o1, ways: 2 });
  let lo = await laneOrder(o1);
  check('split two ways: kept on the order, so every screen shows the same share', r.body.ok && lo.split?.ways === 2 && lo.split.shares === 0, [r.body, lo?.split]);
  check('…not 1 way, or 11', (await P({ action: 'split', orderId: o1, ways: 1 })).status === 400 && (await P({ action: 'split', orderId: o1, ways: 11 })).status === 400);
  r = await P({ action: 'part', orderId: o1, method: 'cash', cents: 1100, tendered: 5 });
  check('cash less than the part: refused', r.status === 400 && /less than this part/.test(r.body.error), r.body);
  const cash0 = await till();
  r = await P({ action: 'part', orderId: o1, method: 'cash', cents: 1100, tendered: 20 });
  lo = await laneOrder(o1); let od = await get(`${T}/counterOrders/${o1}`);
  check('a part in cash: the change from the part, into the drawer now, the rest left', r.body.ok && r.body.paid === false && r.body.change === 9 && r.body.due === 11 && (await till()) === cash0 + 11 && !od.paidAt, [r.body, await till()]);
  check('…on the order as a part paid, one share of two', lo.tenders.length === 1 && lo.tenders[0].kind === 'cash' && lo.tenders[0].cents === 1100 && lo.split.shares === 1 && lo.due === 11, lo);
  r = await P({ action: 'tip', orderId: o1, cents: 300 }); const r2 = await P({ action: 'discount', orderId: o1, discountId: 'team' });
  check('while a part is paid, the total stays: no tip, no discount', r.status === 409 && r.body.code === 'parts' && r2.status === 409 && r2.body.code === 'parts', [r.body, r2.body]);
  const v: any = await CS.voidOrder(db, 't1', o1, 'Left', { id: null, name: 'Window' } as any);
  check('…and it can’t be voided until the parts are given back', v.code === 'parts' && !(await get(`${T}/counterOrders/${o1}`)).voidedAt, v);
  r = await P({ action: 'part', orderId: o1, method: 'card', cents: 1100 });
  od = await get(`${T}/counterOrders/${o1}`); const sale = await get(`${T}/transactions/counter_${o1}`);
  check('the last part pays it: the card machine, the order paid', r.body.ok && r.body.paid === true && od.paidAt && od.payments.length === 2 && od.payments[0].method === 'cash' && od.payments[0].amount === 11 && od.payments[1].method === 'card' && od.payments[1].amount === 11, [r.body, od.payments]);
  check('…the sale booked once, split; the drawer has only the cash part', sale.paymentMethod === 'split' && sale.amount === 20 && (await till()) === cash0 + 11, [sale, await till()]);
  const CR = await import('../../src/lib/counter-receipt');
  check('…the receipt and today’s sales show each part', CR.counterReceipt(od, o1).detail.payments.length === 2 && CR.counterSaleRow(od, o1).paymentMethod === 'split');
  const PR = await import('../../src/lib/printing');
  const slip = PR.receiptDoc(CR.counterReceipt(od, o1), { business: 'x', tz: null }).blocks.map((x: any) => `${x.left || ''} ${x.right || ''}`).join('\n');
  check('…the printed slip too: each share, adding up to the total', /Cash, a share \$11\.00/.test(slip) && /\nCard \$11\.00/.test(slip) && !/Paid Card/.test(slip), slip);
  check('…and the order isn’t listed as open any more', od.partsOpen === false);

  console.log('the night, and a staff meal');
  const o5 = await newOrder(8); await P({ action: 'split', orderId: o5, ways: 2 });
  await P({ action: 'part', orderId: o5, method: 'cash', cents: 1100, tendered: 11 });
  const sm: any = await CS.staffMeal(db, 't1', o5, 'Rio', { id: 'm9', name: 'Mo Diaz' } as any);
  check('a staff meal with a share paid: refused, nothing changed', sm.code === 'parts' && !(await get(`${T}/counterOrders/${o5}`)).paidAt, sm);
  const NC = await import('../../src/lib/night-close-server');
  const day = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
  const { report: night } = await NC.buildNightReport(db, 't1', await get(T), day, {});
  const held = (night as any).deliveries?.held;
  const NCT = await import('../../src/lib/night-close');
  check('the night: a split bill still open is listed, its cash share in the drawer', held && held.orders === 1 && held.cashCents === 1100 && held.cardCents === 0 && held.numbers.length === 1, held);
  check('…in the night’s written report too', /Split bills still open: .* Shares paid so far: \$11\.00 in cash \(in the drawer\)/.test(NCT.reportText('Northside', night as any)), NCT.reportText('Northside', night as any));

  console.log('a part on the card reader');
  const o2 = await newOrder(8); await P({ action: 'split', orderId: o2, ways: 2 });
  r = await P({ action: 'card', orderId: o2, readerId: 'tmr_window1', cents: 1100 });
  const pi2 = Array.from(S.pis.values()).pop() as any;
  check('the reader asks for the part only', r.body.ok && r.body.state === 'on_reader' && pi2.amount === 1100 && /, part$/.test(String(pi2.description)), [r.body, pi2.amount]);
  r = await P({ action: 'part', orderId: o2, method: 'cash', cents: 1100 });
  check('…cash waits while the reader asks', r.status === 409 && r.body.code === 'card_busy', r.body);
  approve('tmr_window1');
  r = await P({ action: 'cardCheck', orderId: o2 });
  od = await get(`${T}/counterOrders/${o2}`);
  check('approved: taken, on the order as a part, the order not paid yet', r.body.ok && r.body.state === 'part' && r.body.partCents === 1100 && r.body.due === 11 && !od.paidAt && CM.paidPartsOf(od).length === 1 && (CM.paidPartsOf(od)[0] as any).id === pi2.id && S.pis.get(pi2.id).status === 'succeeded', [r.body, od.tenders]);
  r = await P({ action: 'cardCheck', orderId: o2 });
  check('…asked again: the same part, never twice', r.body.state === 'part' && CM.paidPartsOf(await get(`${T}/counterOrders/${o2}`)).length === 1, r.body);
  r = await P({ action: 'card', orderId: o2, readerId: 'tmr_window1' });
  const pi3 = Array.from(S.pis.values()).pop() as any;
  check('the reader is free for the next: a new payment, for what’s left', r.body.ok && r.body.state === 'on_reader' && pi3.id !== pi2.id && pi3.amount === 1100, [r.body, pi3.amount]);
  approve('tmr_window1'); r = await P({ action: 'cardCheck', orderId: o2 });
  od = await get(`${T}/counterOrders/${o2}`); const sale2 = await get(`${T}/transactions/counter_${o2}`);
  check('…the last part pays it, both payments kept with the sale', r.body.state === 'paid' && od.paidAt && od.payments.length === 2 && sale2.paymentMethod === 'split' && sale2.stripePaymentIntentId === pi3.id && sale2.partPaymentIntentIds?.[0] === pi2.id, [r.body, sale2]);
  check('…the part’s payment never called off or given back after the order was paid', !S.calls.includes(`cancel ${pi2.id}`) && !S.refunds.some((x: any) => x.payment_intent === pi2.id));

  console.log('a part given back');
  const o3 = await newOrder(8); await P({ action: 'split', orderId: o3, ways: 2 });
  const cash3 = await till();
  const p1 = (await P({ action: 'part', orderId: o3, method: 'cash', cents: 1100, tendered: 11 })).body;
  r = await P({ action: 'partUndo', orderId: o3, partId: p1.partId });
  check('a manager’s: without one, it asks', r.status === 403 && r.body.needsManager === true, r.body);
  const mpass = await passOf('m9', 'Mo Diaz');
  r = await P({ action: 'partUndo', orderId: o3, partId: p1.partId, staffPass: mpass });
  od = await get(`${T}/counterOrders/${o3}`);
  check('cash: out of the drawer again, off the order, kept on record', r.body.ok && r.body.kind === 'cash' && r.body.fromDrawer === true && (await till()) === cash3 && CM.paidPartsOf(od).length === 0 && od.partsBack?.[p1.partId]?.by === 'Mo Diaz', [r.body, await till()]);
  r = await P({ action: 'card', orderId: o3, readerId: 'tmr_window1', cents: 1100 });
  const pi4 = Array.from(S.pis.values()).pop() as any; approve('tmr_window1'); await P({ action: 'cardCheck', orderId: o3 });
  const part4: any = CM.paidPartsOf(await get(`${T}/counterOrders/${o3}`))[0];
  r = await P({ action: 'partUndo', orderId: o3, partId: part4.partId, staffPass: mpass });
  check('card: refunded to their card, once', r.body.ok && r.body.kind === 'card' && S.refunds.filter((x: any) => x.payment_intent === pi4.id).length === 1 && S.refunds.find((x: any) => x.payment_intent === pi4.id).amount === 1100, [r.body, S.refunds]);
  S.refundErr = 'api_connection_error';
  r = await P({ action: 'card', orderId: o3, readerId: 'tmr_window1', cents: 1100 });
  approve('tmr_window1'); await P({ action: 'cardCheck', orderId: o3 });
  const part5: any = CM.paidPartsOf(await get(`${T}/counterOrders/${o3}`))[0];
  r = await P({ action: 'partUndo', orderId: o3, partId: part5.partId, staffPass: mpass });
  check('the card company not answering: nothing changes, it can be asked again', r.status === 503 && CM.paidPartsOf(await get(`${T}/counterOrders/${o3}`)).length === 1, r.body);
  check('…and the order isn’t held by it', !(await get(`${T}/counterOrders/${o3}`)).partBack);
  // While a card part's refund is being asked, nothing pays the order (it's never paid with a part that's then refunded).
  await db.doc(`${T}/counterOrders/${o3}`).set({ partBack: { partId: part5.partId, at: new Date().toISOString() } }, { merge: true });
  const held1 = await P({ action: 'part', orderId: o3, method: 'cash', cents: 1100, tendered: 20 });
  const held2: any = await CS.payOrder(db, 't1', o3, { method: 'cash', tendered: 20, by: 'Window' } as any);
  const held3 = await P({ action: 'card', orderId: o3, readerId: 'tmr_window1' });
  check('a card part being given back: cash, another part and the reader all wait', held1.status === 409 && held1.body.code === 'part_back' && held2.code === 'part_back' && held3.status === 409 && held3.body.code === 'part_back', [held1.body, held2, held3.body]);
  await db.doc(`${T}/counterOrders/${o3}`).set({ partBack: { partId: part5.partId, at: new Date(Date.now() - 5 * 60000).toISOString() } }, { merge: true });
  check('…one left halfway (minutes ago) holds nothing', !CM.partBackOpen(await get(`${T}/counterOrders/${o3}`)));
  S.refundErr = null;
  r = await P({ action: 'partUndo', orderId: o3, partId: part5.partId, staffPass: mpass });
  check('…asked again: given back', r.body.ok && CM.paidPartsOf(await get(`${T}/counterOrders/${o3}`)).length === 0);
  const vv: any = await CS.voidOrder(db, 't1', o3, 'Left', { id: null, name: 'Window' } as any);
  check('with its parts given back, it can be voided', vv.ok, vv);

  console.log('a share taken with no drawer to put it in');
  const o6 = await newOrder(8); await P({ action: 'split', orderId: o6, ways: 2 });
  await db.doc(`${T}/tillSessions/till2`).set({ status: 'open', expectedCash: 50, totalCashSales: 0 });
  const p6 = (await P({ action: 'part', orderId: o6, method: 'cash', cents: 1100, tendered: 11 })).body;
  await db.doc(`${T}/tillSessions/till2`).set({ status: 'closed' }, { merge: true });
  const before6 = await till();
  r = await P({ action: 'partUndo', orderId: o6, partId: p6.partId, staffPass: mpass });
  check('two drawers open when it was taken: given back, out of no drawer', r.body.ok && r.body.fromDrawer === false && (await till()) === before6 && p6.inDrawer === false, [r.body, p6]);

  console.log('a share refunded, the step not finished');
  const o7 = await newOrder(8); await P({ action: 'split', orderId: o7, ways: 2 });
  await P({ action: 'card', orderId: o7, readerId: 'tmr_window1', cents: 1100 }); approve('tmr_window1'); await P({ action: 'cardCheck', orderId: o7 });
  const part7: any = CM.paidPartsOf(await get(`${T}/counterOrders/${o7}`))[0];
  await db.doc(`${T}/counterOrders/${o7}`).set({ partBack: { partId: part7.partId, at: new Date(Date.now() - 30 * 60000).toISOString(), refunded: true } }, { merge: true });
  r = await P({ action: 'part', orderId: o7, method: 'cash', cents: 1100, tendered: 20 });
  check('refunded, the part still on it: nothing pays the order, however long ago', CM.partBackOpen(await get(`${T}/counterOrders/${o7}`)) && r.status === 409 && r.body.code === 'part_back', r.body);
  const refunds7 = S.refunds.length;
  r = await P({ action: 'partUndo', orderId: o7, partId: part7.partId, staffPass: mpass });
  const od7 = await get(`${T}/counterOrders/${o7}`);
  check('…giving it back again finishes it: off the order, the hold let go, asked of the card company with the same key', r.body.ok && CM.paidPartsOf(od7).length === 0 && !od7.partBack && S.refunds.length === refunds7 + 1, r.body);

  console.log('a share on the reader while a scan-to-pay code is open');
  const o8 = await newOrder(8);
  await db.doc(`${T}/counterOrders/${o8}`).set({ phone: { id: 'pi_phone', state: 'open' } }, { merge: true });
  r = await P({ action: 'card', orderId: o8, readerId: 'tmr_window1', cents: 1100 });
  check('refused until the code is closed', r.status === 409 && r.body.code === 'phone_open', r.body);

  console.log('a gift card for one share');
  const o4 = await newOrder(8); await P({ action: 'split', orderId: o4, ways: 2 });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'KQ7M-24RT', codeKey: 'KQ7M24RT', initialCents: 5000, balanceCents: 5000, status: 'active', history: [] });
  r = await P({ action: 'tender', orderId: o4, do: 'gift', code: 'KQ7M-24RT', upTo: 1100 });
  lo = await laneOrder(o4);
  check('it covers that share only, held for it, and counts as a share paid', r.body.ok && r.body.cents === 1100 && r.body.due === 11 && (await get(`${T}/giftCards/g1`)).holds?.[`counter_${o4}`]?.cents === 1100 && lo.split.shares === 1, [r.body, lo?.split]);
  r = await P({ action: 'part', orderId: o4, method: 'cash', cents: 1100, tendered: 20 });
  od = await get(`${T}/counterOrders/${o4}`);
  check('…the other share in cash pays it, the card spent for its share', r.body.ok && r.body.paid === true && r.body.change === 9 && od.paidAt && (await get(`${T}/giftCards/g1`)).balanceCents === 3900, [r.body]);

  console.log('the screens');
  const page = src('src/app/(app)/counter/page.tsx'), dt = src('src/app/drive-thru/[tenantId]/page.tsx'), cm = src('src/components/pos/CounterMoney.tsx');
  check('the panel: evenly some ways or by amount, then cash, the reader, a card machine or a gift card', cm.includes('aria-label="Split the bill"') && cm.includes("[['even', 'Evenly'], ['amount', 'By amount']]") && cm.includes('>Card reader</button>') && cm.includes('>Card machine</button>')
    && cm.includes('It goes to the kitchen as one order and counts as paid when the parts add up.'));
  check('the counter: Split, the panel while it’s split, parts on the order with Give back (a manager’s PIN)', page.includes('onClick={() => void splitWays(2)}') && page.includes('order.split && !order.app ? <div className="space-y-2">') && page.includes('>Give back</button>') && page.includes('{partPin && <PinPad'));
  check('…cash for a part counts change from the part', page.includes('cashPart(cash === \'\' ? cashFor : tendered)') && page.includes('Change: {usd(tendered - cashFor)}'));
  check('the drive-thru: the same (never into a pouch)', dt.includes('Split the bill</button>') && dt.includes('order.split && cash === null && !pouchCash ?') && dt.includes('>Give back</button>') && dt.includes('{partPin && <PinPad'));
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(cm) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b/.test(cm + src('src/lib/counter-split-server.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
