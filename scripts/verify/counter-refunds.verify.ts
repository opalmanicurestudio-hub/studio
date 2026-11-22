// Checks refunds after a counter order is paid (lib/counter-refund, lib/counter-refund-server; api/counter
// 'paidToday', 'refundPreview', 'refund'; components/pos/CounterRefund).
// - All of what's left, or some items with their share of the tax; the tip on a full refund unless they say not.
// - Back the way it was paid: the card, gift cards and store credit, another card machine (by hand), then cash.
// - A manager's, with why; once; a refund that didn't finish is finished, never sent twice.
// - In the books with its tax and tip carved out, the tip off whoever's it was; on the receipt and the night report.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-refunds.verify.ts
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
  const CR = await import('../../src/lib/counter-refund');
  const CS = await import('../../src/lib/counter-server');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', stripeAccountId: 'acct_1', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, counterTips: { on: true, pcts: [15, 18, 20], where: 'both' } });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 2.5, totalStock: 500 });
  await db.doc(`${T}/inventory/shake`).set({ type: 'refreshment', name: 'Shake', category: 'Drinks', price: 5, totalStock: 500 });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  await db.doc(`${T}/staff/s4`).set({ name: 'Kai Park', role: 'staff', isActive: true });
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 100, totalCashSales: 0 });
  S.readers.set('tmr_window1', { id: 'tmr_window1', label: 'Window', device_type: 'stripe_s700', status: 'online', action: null });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const passOf = async (id: string, name: string) => { const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex'); const h = createHash('sha256').update(key).digest('hex');
    await db.doc(`kitchenScreens/${h}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id, name, exp: Date.now() + 3600000 } } }, { merge: true }); return pass; };
  const mpass = await passOf('m9', 'Mo Diaz'); const kpass = await passOf('s4', 'Kai Park');
  let n = 0;
  const newOrder = async (fries = 4, shakes = 0) => {
    const c = (await P({ action: 'car', carKey: `carkey-ref-${++n}` })).body;
    await P({ action: 'add', orderId: c.orderId, itemId: 'fries', quantity: fries, tapKey: `tap-ref-${n}-a` });
    if (shakes) await P({ action: 'add', orderId: c.orderId, itemId: 'shake', quantity: shakes, tapKey: `tap-ref-${n}-b` });
    const s: any = await P({ action: 'send', orderId: c.orderId });
    if (!s.body.ok) throw new Error(JSON.stringify(s.body));
    return c.orderId as string;
  };
  const till = async () => get(`${T}/tillSessions/till1`);
  const order = (id: string) => get(`${T}/counterOrders/${id}`);

  console.log('a cash order, all of it back');
  const o1 = await newOrder(4);   // 4 × 2.50 = 10.00 + 10% = 11.00
  await P({ action: 'tip', orderId: o1, cents: 200 });   // 13.00
  let r = await P({ action: 'paid', orderId: o1, method: 'cash', tendered: 20, staffPass: kpass });
  check('(paid in cash with a $2.00 tip, Kai’s)', r.body.ok && (await get(`${T}/transactions/ctip_${o1}`))?.staffId === 's4', [r.body, await get(`${T}/transactions/ctip_${o1}`)]);
  r = await P({ action: 'refundPreview', orderId: o1, all: true, reason: 'Wrong order' });
  check('the preview: all of it, the tip too, back in cash from the drawer', r.body.ok && r.body.plan.cents === 1300 && r.body.plan.tipCents === 200 && r.body.plan.taxCents === 100 && r.body.plan.netCents === 1000 && r.body.back.length === 1 && r.body.back[0].kind === 'cash', r.body);
  r = await P({ action: 'refund', orderId: o1, all: true, reason: 'Wrong order' });
  check('a manager’s: without one, it asks', r.status === 403 && r.body.needsManager === true, r.body);
  r = await P({ action: 'refund', orderId: o1, all: true, reason: '', staffPass: mpass });
  check('…and why', r.status === 400 && r.body.code === 'reason', r.body);
  const cash0 = (await till()).expectedCash;
  r = await P({ action: 'refund', orderId: o1, all: true, reason: 'Wrong order', staffPass: mpass });
  let od = await order(o1); let line = await get(`${T}/transactions/crefund_${o1}_1`); let tl = await till();
  check('refunded: $13.00 out of the drawer, counted as a refund', r.body.ok && r.body.cents === 1300 && r.body.cashCents === 1300 && r.body.full === true && tl.expectedCash === cash0 - 13 && tl.totalCashRefunds === 13, [r.body, tl]);
  check('…in the books: a refund line with its tax and tip carved out, the tip off Kai', line && line.category === 'Refunds' && line.type === 'expense' && line.amount === 13 && line.taxRefunded === 1 && line.tipRefunded === 2 && line.tipBooked === true && line.tipReversal?.staffId === 's4' && line.tipReversal.amount === 2 && line.approvedBy === 'Mo Diaz' && line.reason === 'Wrong order', line);
  check('…kept on the order: how much, the tip, the tax, each line, who okayed it and why', od.refundCents === 1300 && od.refundTipCents === 200 && od.refundTaxCents === 100 && od.refunds.length === 1 && od.refunds[0].approvedBy === 'Mo Diaz' && !od.refundClaim && Object.values(od.refundedLines || {}).length === 1, od);
  r = await P({ action: 'refund', orderId: o1, all: true, reason: 'Again', staffPass: mpass });
  check('…never twice', r.status === 409 && /refunded already/.test(r.body.error), r.body);
  const RC = await import('../../src/lib/counter-receipt');
  const rc = RC.counterReceipt(od, o1);
  check('the receipt: refunded, and why; today’s sales: nothing kept', rc.refunds.length === 1 && rc.refunds[0].reason === 'Wrong order' && rc.voided === true && RC.counterSaleRow(od, o1).total === 13 && RC.counterSaleRow(od, o1).voided === true, rc.refunds);

  console.log('a card order, some items, then the rest');
  const o2 = await newOrder(2, 2);   // 2 × 2.50 + 2 × 5.00 = 15.00 + 10% = 16.50
  await P({ action: 'tip', orderId: o2, cents: 300 });   // 19.50
  await P({ action: 'card', orderId: o2, readerId: 'tmr_window1' }); approve('tmr_window1'); await P({ action: 'cardCheck', orderId: o2 });
  od = await order(o2); const pi2 = od.cardPaymentId;
  const shakeLine = od.lines.find((l: any) => l.itemId === 'shake');
  r = await P({ action: 'refund', orderId: o2, all: false, lines: [{ lineId: shakeLine.lineId, qty: 1 }], reason: 'Made wrong', staffPass: mpass });
  od = await order(o2);
  check('one shake: its price and its tax, the tip stays, to the card', r.body.ok && r.body.cents === 550 && S.refunds.some((x: any) => x.payment_intent === pi2 && x.amount === 550) && od.refundTipCents === 0 && od.refundedLines[shakeLine.lineId] === 1, [r.body, S.refunds]);
  r = await P({ action: 'refund', orderId: o2, all: false, lines: [{ lineId: shakeLine.lineId, qty: 2 }], reason: 'Made wrong', staffPass: mpass });
  check('…more of it than is left: refused', r.status === 409 && /Only 1/.test(r.body.error), r.body);
  r = await P({ action: 'refundPreview', orderId: o2, all: true, tip: false, reason: 'Left' });
  check('the rest, not the tip: what’s left less the tip', r.body.ok && r.body.plan.cents === 1950 - 550 - 300 && r.body.plan.tipCents === 0, r.body);
  r = await P({ action: 'refund', orderId: o2, all: true, tip: false, reason: 'Left', staffPass: mpass });
  od = await order(o2);
  check('…given back; only the tip is left on it', r.body.ok && od.refundCents === 1650 && CR.refundLeftOf(od) === 300 && CR.cantRefund(od) === null, od.refundCents);
  check('…each refund its own key at the card company', S.refunds.filter((x: any) => x.payment_intent === pi2).length === 2 && new Set(S.refunds.filter((x: any) => x.payment_intent === pi2).map((x: any) => x.key)).size === 2);

  console.log('a split bill: a gift card and cash');
  const o3 = await newOrder(8);   // 22.00
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'KQ7M-24RT', codeKey: 'KQ7M24RT', initialCents: 1000, balanceCents: 1000, status: 'active', history: [] });
  await P({ action: 'tender', orderId: o3, do: 'gift', code: 'KQ7M-24RT' });
  await P({ action: 'paid', orderId: o3, method: 'cash', tendered: 12 });
  const g1a = (await get(`${T}/giftCards/g1`)).balanceCents; const cash3 = (await till()).expectedCash;
  r = await P({ action: 'refundPreview', orderId: o3, all: true, reason: 'Wrong order' });
  check('back the way it was paid: the gift card first, then cash', r.body.back.length === 2 && r.body.back[0].kind === 'gift' && r.body.back[0].cents === 1000 && r.body.back[1].kind === 'cash' && r.body.back[1].cents === 1200, r.body.back);
  r = await P({ action: 'refund', orderId: o3, all: false, lines: [{ lineId: (await order(o3)).lines[0].lineId, qty: 2 }], reason: 'Made wrong', staffPass: mpass });
  check('two fries ($5.50): all of it back on the gift card', r.body.ok && r.body.cents === 550 && (await get(`${T}/giftCards/g1`)).balanceCents === g1a + 550 && (await till()).expectedCash === cash3 && (await get(`${T}/giftCards/g1`)).history.slice(-1)[0].type === 'refund', [r.body]);
  r = await P({ action: 'refund', orderId: o3, all: true, reason: 'Wrong order', staffPass: mpass });
  check('the rest: the gift card’s share, then cash', r.body.ok && r.body.cents === 1650 && (await get(`${T}/giftCards/g1`)).balanceCents === 1000 && (await till()).expectedCash === cash3 - 12, [r.body, (await get(`${T}/giftCards/g1`)).balanceCents]);

  console.log('store credit, and another card machine');
  await db.doc(`${T}/clients/c1`).set({ name: 'Mia Ross', storeCredits: [{ id: 'sc1', amount: 5, status: 'available', createdAt: new Date(Date.now() - 86400000).toISOString() }], totalStoreCredit: 5 });
  const o4 = await newOrder(4);   // 11.00
  await db.doc(`${T}/counterOrders/${o4}`).set({ clientId: 'c1', points: { phone: '0142', verified: true } }, { merge: true });
  await P({ action: 'tender', orderId: o4, do: 'credit' });
  await P({ action: 'paid', orderId: o4, method: 'card' });
  r = await P({ action: 'refund', orderId: o4, all: true, reason: 'Took too long', staffPass: mpass });
  const c1 = await get(`${T}/clients/c1`);
  check('store credit back onto their record; the card machine part to give back by hand', r.body.ok && c1.totalStoreCredit === 5 && c1.storeCredits.some((x: any) => x.source === 'counter_refund' && x.amount === 5 && x.status === 'available') && r.body.machineCents === 600, [r.body, c1.totalStoreCredit]);

  console.log('the card company not answering, or saying no');
  const o5 = await newOrder(4);
  await P({ action: 'card', orderId: o5, readerId: 'tmr_window1' }); approve('tmr_window1'); await P({ action: 'cardCheck', orderId: o5 });
  S.refundErr = { code: 'api_connection_error' };
  r = await P({ action: 'refund', orderId: o5, all: true, reason: 'Wrong order', staffPass: mpass });
  od = await order(o5);
  check('no answer: kept as started, nothing recorded yet', r.status === 503 && od.refundClaim && !od.refundCents, [r.body, od.refundClaim]);
  S.refundErr = null;
  r = await P({ action: 'refundPreview', orderId: o5, all: false, lines: [{ lineId: od.lines[0].lineId, qty: 1 }], reason: 'x' });
  check('the screen is told about it, to finish it first', r.body.ok && r.body.resuming?.cents === 1100 && r.body.resuming.approvedBy === 'Mo Diaz' && r.body.resuming.reason === 'Wrong order', r.body);
  r = await P({ action: 'refund', orderId: o5, all: false, lines: [{ lineId: od.lines[0].lineId, qty: 1 }], reason: 'Something else', staffPass: mpass });
  check('…a new refund waits until it’s finished: refused, saying what it was', r.status === 409 && r.body.code === 'unfinished' && r.body.unfinished?.cents === 1100 && !(await order(o5)).refundCents, r.body);
  r = await P({ action: 'refund', orderId: o5, resume: true, staffPass: mpass });
  od = await order(o5);
  check('finished on purpose: as it was okayed, the same key, never a second', r.body.ok && r.body.resumed === true && r.body.cents === 1100 && od.refundCents === 1100 && od.refunds[0].reason === 'Wrong order' && S.refunds.filter((x: any) => x.key === `counter-refund-${o5}-1-${od.cardPaymentId}`).length === 1, [r.body, od.refundCents]);
  r = await P({ action: 'refund', orderId: o5, resume: true, staffPass: mpass });
  check('…finishing it again: it’s done', r.status === 409 && (r.body.code === 'finished' || r.body.code === 'cant'), r.body);
  const o6 = await newOrder(4);
  await P({ action: 'card', orderId: o6, readerId: 'tmr_window1' }); approve('tmr_window1'); await P({ action: 'cardCheck', orderId: o6 });
  S.refundErr = { code: 'charge_disputed', type: 'StripeInvalidRequestError' };
  r = await P({ action: 'refund', orderId: o6, all: true, reason: 'Wrong order', staffPass: mpass });
  check('the card company said no: let go, nothing recorded', r.status === 409 && !(await order(o6)).refundClaim && !(await order(o6)).refundCents, r.body);
  S.refundErr = null;

  console.log('a gift card that was cancelled since');
  const o8 = await newOrder(8);   // 22.00
  await db.doc(`${T}/giftCards/g2`).set({ id: 'g2', code: 'ZZZZ-9999', codeKey: 'ZZZZ9999', initialCents: 1000, balanceCents: 1000, status: 'active', history: [] });
  await P({ action: 'tender', orderId: o8, do: 'gift', code: 'ZZZZ-9999' });
  await P({ action: 'paid', orderId: o8, method: 'cash', tendered: 12 });
  await db.doc(`${T}/giftCards/g2`).set({ status: 'void' }, { merge: true });
  r = await P({ action: 'refundPreview', orderId: o8, all: true, reason: 'x' });
  check('all of it: its part has nowhere to go, so it’s refused, naming the card', r.status === 409 && r.body.code === 'nowhere' && /Gift card ••9999 was cancelled/.test(r.body.error), r.body);
  r = await P({ action: 'refund', orderId: o8, all: false, lines: [{ lineId: (await order(o8)).lines[0].lineId, qty: 2 }], reason: 'Made wrong', staffPass: mpass });
  check('…a part the cash covers: back in cash, never onto the cancelled card', r.body.ok && r.body.cashCents === 550 && (await get(`${T}/giftCards/g2`)).balanceCents === 0, r.body);

  console.log('an order for another day');
  const o9 = await newOrder(2);
  await db.doc(`${T}/counterOrders/${o9}`).set({ status: 'scheduled', paidAt: new Date().toISOString(), payMethod: 'card', channel: 'ahead', ahead: { forDay: '2030-01-02', later: {} } }, { merge: true });
  check('not refunded here: canceled from Orders ahead', /Cancel it from Orders ahead/.test(String(CR.cantRefund(await order(o9)))));
  const AD = await import('../../src/lib/ahead-days-server');
  await db.doc(`${T}/counterOrders/${o9}`).set({ refundCents: 100 }, { merge: true });
  const cl: any = await AD.cancelLater(db, 't1', await get(T), o9, { by: 'Mo', guest: false });
  check('…and one refunded at the counter already isn’t canceled for all of it again', cl.ok === false && /refunded at the counter/.test(cl.error), cl);
  await db.doc(`${T}/counterOrders/${o9}`).set({ refundCents: 0, status: 'voided' }, { merge: true });

  console.log('not here');
  const o7 = await newOrder(2); await CS.staffMeal(db, 't1', o7, 'Rio', { id: 'm9', name: 'Mo Diaz' } as any);
  check('a staff meal, an unpaid order: refused', /staff meal/.test(String(CR.cantRefund(await order(o7)))) && /isn’t paid/.test(String(CR.cantRefund({ total: 5 }))) && /app/.test(String(CR.cantRefund({ paidAt: 'x', total: 5, app: { code: 'A1' } }))) && /Deliveries/.test(String(CR.cantRefund({ paidAt: 'x', total: 5, ahead: { way: 'delivery' } }))));

  console.log('today’s paid orders, and the night');
  r = await P({ action: 'paidToday' });
  const row2 = (r.body.orders || []).find((x: any) => x.id === o2);
  check('today’s paid orders on this side, with what’s left to refund', r.body.ok && row2 && row2.left === 300 && row2.why === null && (r.body.orders || []).every((x: any) => x.id !== o7) && row2.lines.find((l: any) => l.lineId === shakeLine.lineId).left === 0, row2);
  const NC = await import('../../src/lib/night-close-server');
  const day = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
  const { report: night } = await NC.buildNightReport(db, 't1', await get(T), day, {});
  const D: any = (night as any).deliveries;
  check('the night: each refund with why and who okayed it', D?.refunds?.count === 8 && D.refunds.rows.some((f: any) => f.reason === 'Made wrong' && f.approvedBy === 'Mo Diaz'), D?.refunds);
  const netTonight = D.refunds.rows.length && (await Promise.all([o1, o2, o3, o4, o5, o8].map(order))).flatMap((x: any) => x.refunds || []).reduce((n: number, f: any) => n + f.cents - f.tipCents - f.taxCents, 0) / 100;
  check('…and tonight’s sales come down by what was given back tonight, before tax and tips', Math.abs((night as any).sales.refunds - netTonight) < 0.001, [(night as any).sales.refunds, netTonight]);

  console.log('the screens');
  const page = src('src/app/(app)/counter/page.tsx'), dt = src('src/app/drive-thru/[tenantId]/page.tsx'), cr = src('src/components/pos/CounterRefund.tsx');
  check('the refund panel: all of it or some items, the tip, where it goes back, why, a manager’s PIN', cr.includes("[['all', 'All of it'], ['some', 'Some items']]") && cr.includes('Give the tip back too') && cr.includes('Back the way it was paid') && cr.includes('REFUND_REASONS'));
  check('the counter and the drive-thru: Refund an order, today’s paid ones', page.includes('>Refund an order</button>') && page.includes('<RefundFind') && dt.includes('>Refund an order</button>') && dt.includes('<RefundFind'));
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(cr) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b/.test(cr + src('src/lib/counter-refund.ts') + src('src/lib/counter-refund-server.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
