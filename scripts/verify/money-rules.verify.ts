// Checks who can do what and Activity (design boards "Who can do what" and "Activity"): lib/money-rules,
// lib/money-rules-server okayFor, lib/activity, lib/activity-server logMoney, and api/counter's money moments.
// - Until the owner changes them, the rules are as the counter has always worked: a manager for refunds, voids, on the
//   house, a lower price, another discount amount, cash in or out and staff meals; anyone for the drawer with no sale.
// - Each can be anyone, a manager, or only the owner; staff can refund small amounts on their own.
// - Every money moment is one line in the audit log: kind, how much, where, who, who okayed it, why, and when it's worth
//   a look (a void after the kitchen started, the drawer opened with no sale again, a big refund, too many wrong PINs).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/money-rules.verify.ts
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
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const R = await import('../../src/lib/money-rules');
  const A = await import('../../src/lib/activity');

  console.log('the rules');
  const today = R.rulesOf({});
  check('until changed: a manager for all of them but the drawer with no sale (anyone); no refund on their own',
    R.RULES.every((x) => today[x.id] === (x.id === 'noSale' ? 'anyone' : 'manager')) && today.refundSelfCents === 0, today);
  const mine = R.rulesOf({ moneyRules: { comp: 'anyone', void: 'owner', refundSelfCents: 1000, lowerPrice: 'boss' } });
  check('the owner’s own; anything not one of the choices stays as it was', mine.comp === 'anyone' && mine.void === 'owner' && mine.lowerPrice === 'manager' && mine.refundSelfCents === 1000);
  check('a refund within what staff can do on their own takes nobody; over it, the rule', R.needFor(mine, 'refund', 1000) === 'anyone' && R.needFor(mine, 'refund', 1001) === 'manager' && R.needFor(mine, 'refund', null) === 'manager' && R.needFor(today, 'refund', 1) === 'manager');
  check('…and when refunds are anyone’s, any amount', R.needFor(R.rulesOf({ moneyRules: { refund: 'anyone' } }), 'refund', 99999) === 'anyone');
  check('what the screen says', R.needWords('comp', 'manager') === 'On the house takes a manager. Their PIN, or ask one to.' && R.needWords('void', 'owner') === 'A void takes the owner here. Their PIN, or ask them to.');
  const c1 = R.cleanRules({ comp: 'owner', refundSelfCents: 2500 }, today) as any;
  check('a change keeps the rest', c1.comp === 'owner' && c1.refundSelfCents === 2500 && c1.void === 'manager' && 'error' in (R.cleanRules({ comp: 'everyone' }, today) as any) && 'error' in (R.cleanRules({ refundSelfCents: 20000 }, today) as any));

  console.log('reading Activity');
  check('lines from before are read by their name', A.kindOf({ action: 'counter.refund' }) === 'refund' && A.kindOf({ action: 'checkout.voided' }) === 'void' && A.kindOf({ action: 'counter.no_sale' }) === 'drawer'
    && A.kindOf({ action: 'counter.drawer_out' }) === 'cash' && A.kindOf({ action: 'payroll.submit' }) === null && A.kindOf({ action: 'x', kind: 'comp' }) === 'comp' && A.kindOf({ action: 'counter.refund', kind: 'nope' }) === 'refund');
  const old = A.activityLine('a1', { action: 'counter.comp', amount: 4.5, summary: '1 × Croissant on the house', actor: { type: 'user', name: 'Mo Diaz' }, at: '2026-11-22T10:00:00.000Z' })!;
  check('…with what they have: how much, and who', old.kind === 'comp' && old.cents === 450 && old.by === 'Mo Diaz' && old.okBy === null && !old.auto);
  const auto = A.activityLine('a2', { action: 'retail.refund', kind: 'refund', cents: 840, actor: { type: 'system', name: 'Automatic' }, reason: 'Item out of stock', ref: 'Order 1042', auto: true })!;
  check('an automatic one says so', auto.auto && A.lineTitle(auto) === 'Automatic refund, Order 1042' && A.lineWho(auto) === 'On its own: Item out of stock');
  const l = A.activityLine('a3', { kind: 'refund', cents: 2400, by: { name: 'Ana' }, okBy: { name: 'Mo Diaz' }, reason: 'Wrong order', ref: 'C18', flag: 'A refund of $50 or more' })!;
  check('how a line reads', A.lineTitle(l) === 'Refund, C18' && A.lineWho(l) === 'Ana, okayed by Mo Diaz: Wrong order' && A.lineWho({ ...l, okBy: 'Ana' }) === 'Ana: Wrong order');
  const tot = A.totalsOf([l, auto, old]);
  check('today’s totals by kind', tot.refund.n === 2 && tot.refund.cents === 3240 && tot.comp.n === 1 && tot.void.n === 0);
  check('worth a look: a void after the kitchen started, the drawer again within half an hour, cash back by who took it, a big refund, too many PINs',
    A.flagFor({ kind: 'void', afterKitchen: true }) === 'After the kitchen started' && A.flagFor({ kind: 'void' }) === null
    && A.flagFor({ kind: 'drawer', noSalesBefore: 1 }) === 'Drawer opened with no sale 2 times in 30 minutes' && A.flagFor({ kind: 'drawer', noSalesBefore: 0 }) === null
    && A.flagFor({ kind: 'refund', cents: 900, toCash: true, sameAsPaid: true }) === 'Refunded in cash by the person who took the payment'
    && A.flagFor({ kind: 'refund', cents: 5000 }) === 'A refund of $50 or more' && A.flagFor({ kind: 'refund', cents: 4999 }) === null
    && A.flagFor({ kind: 'refund', cents: 2500, bigRefundCents: 2500 }) === 'A refund of $25 or more' && A.flagFor({ kind: 'refund', cents: 99999, bigRefundCents: null }) === null
    && A.flagFor({ kind: 'pin' }) === 'Too many wrong PINs');

  console.log('at the window');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  const { setStaffPin } = await import('../../src/lib/pin');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', ownerId: 'o1', stripeAccountId: 'acct_1', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, counterDiscounts: [] });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 2.5, totalStock: 500 });
  await db.doc(`${T}/inventory/shake`).set({ type: 'refreshment', name: 'Shake', category: 'Drinks', price: 5, totalStock: 500 });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  await db.doc(`${T}/staff/s4`).set({ name: 'Kai Park', role: 'staff', isActive: true });
  await db.doc(`${T}/staff/o1`).set({ name: 'Rae Lin', role: 'owner', isActive: true });
  await setStaffPin(db, 't1', 'm9', '1357'); await setStaffPin(db, 't1', 's4', '2468'); await setStaffPin(db, 't1', 'o1', '9753');
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 100, totalCashSales: 0 });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const passOf = async (id: string, name: string) => { const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex'); const h = createHash('sha256').update(key).digest('hex');
    await db.doc(`kitchenScreens/${h}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id, name, exp: Date.now() + 3600000 } } }, { merge: true }); return pass; };
  const kpass = await passOf('s4', 'Kai Park');
  const K = (b: any) => P({ staffPass: kpass, ...b });
  let n = 0;
  const newOrder = async (fries = 4, send = true) => {
    const c = (await K({ action: 'car', carKey: `carkey-mr-${++n}` })).body;
    await K({ action: 'add', orderId: c.orderId, itemId: 'fries', quantity: fries, tapKey: `tap-mr-${n}-a` });
    if (send) await K({ action: 'send', orderId: c.orderId });
    return c.orderId as string;
  };
  const lines = async () => (await db.collection(`${T}/auditLogs`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => String(a.at).localeCompare(String(b.at)));
  const lastOf = async (kind: string) => (await lines()).filter((x: any) => x.kind === kind).pop();

  const o1 = await newOrder(4); await K({ action: 'paid', orderId: o1, method: 'cash', tendered: 20 });
  let r = await K({ action: 'refund', orderId: o1, all: true, reason: 'Wrong order' });
  check('as today: a refund by someone who isn’t a manager asks for one', r.status === 403 && r.body.needsManager === true && !r.body.owner && r.body.error === 'A refund takes a manager. Their PIN, or ask one to.', r.body);
  r = await K({ action: 'refund', orderId: o1, all: true, reason: 'Wrong order', pin: '2468' });
  check('…a PIN that isn’t a manager’s: said', r.status === 403 && r.body.needsManager && r.body.error === 'That isn’t a manager’s PIN.', r.body);
  r = await K({ action: 'refund', orderId: o1, all: true, reason: 'Wrong order', pin: '1357' });
  let a: any = await lastOf('refund');
  check('a manager’s PIN: refunded, and one line in Activity with who, who okayed it, how much, where and why', r.body.ok && r.body.approvedBy === 'Mo Diaz' && a?.action === 'counter.refund'
    && a.cents === 1100 && a.by?.name === 'Kai Park' && a.okBy?.name === 'Mo Diaz' && a.where === 'window' && a.reason === 'Wrong order' && /^B\d+$/.test(String(a.ref)) && a.flag === null && a.actor?.name === 'Mo Diaz', a);

  await db.doc(T).set({ moneyRules: { refundSelfCents: 1000 } }, { merge: true });
  const o2 = await newOrder(2); await K({ action: 'paid', orderId: o2, method: 'cash', tendered: 10 });
  r = await K({ action: 'refund', orderId: o2, all: true, reason: 'Cold' });
  a = await lastOf('refund');
  check('staff can refund up to $10 on their own: a $5.50 refund goes through with no PIN, by them', r.body.ok && a.cents === 550 && a.by?.name === 'Kai Park' && a.okBy?.name === 'Kai Park'
    && A.lineWho(A.activityLine(a.id, a)!) === 'Kai Park: Cold', a);
  check('…and they took the payment and gave it back in cash: worth a look', a.flag === 'Refunded in cash by the person who took the payment', a.flag);
  const o3 = await newOrder(5); await K({ action: 'paid', orderId: o3, method: 'cash', tendered: 20 });
  r = await K({ action: 'refund', orderId: o3, all: true, reason: 'Cold' });
  check('…over $10, the rule again', r.status === 403 && r.body.needsManager, r.body);
  const o3b = await newOrder(4); await K({ action: 'paid', orderId: o3b, method: 'cash', tendered: 20 });
  const l3b = (await get(`${T}/counterOrders/${o3b}`)).lines[0];
  r = await K({ action: 'refund', orderId: o3b, all: false, lines: [{ lineId: l3b.lineId, qty: 2 }], tip: false, reason: 'Cold' });
  const r3b = await K({ action: 'refund', orderId: o3b, all: false, lines: [{ lineId: l3b.lineId, qty: 2 }], tip: false, reason: 'Cold' });
  check('…and in pieces it’s one refund: $5.50 on their own, then the next $5.50 takes $11.00 past $10, so the rule', r.body.ok && r3b.status === 403 && r3b.body.needsManager, [r.body, r3b.body]);
  await db.doc(T).set({ moneyRules: { comp: 'anyone' } }, { merge: true });
  const o3c = await newOrder(2, false);
  const r3c = await P({ action: 'comp', orderId: o3c, lineId: (await get(`${T}/counterOrders/${o3c}`)).lines[0].lineId, qty: 1, reason: 'Regular' });
  check('anyone, but someone: with nobody signed in at the screen, sign in first (never on a screen’s name)', r3c.status === 403 && r3c.body.needsStaff === true && /Sign in first/.test(r3c.body.error), r3c.body);
  await db.doc(T).set({ moneyRules: { comp: 'manager' } }, { merge: true });

  console.log('only the owner');
  await db.doc(T).set({ moneyRules: { comp: 'owner' } }, { merge: true });
  const o4 = await newOrder(3, false);
  const line4 = (await get(`${T}/counterOrders/${o4}`)).lines[0];
  r = await K({ action: 'comp', orderId: o4, lineId: line4.lineId, qty: 1, reason: 'Long wait', pin: '1357' });
  check('on the house is only the owner’s: a manager’s PIN isn’t enough, and the screen is told it’s the owner', r.status === 403 && r.body.needsManager && r.body.owner === true && r.body.error === 'That isn’t the owner’s PIN.', r.body);
  r = await K({ action: 'comp', orderId: o4, lineId: line4.lineId, qty: 1, reason: 'Long wait' });
  check('…with no PIN: what it takes', r.status === 403 && r.body.owner === true && r.body.error === 'On the house takes the owner here. Their PIN, or ask them to.', r.body);
  r = await K({ action: 'comp', orderId: o4, lineId: line4.lineId, qty: 1, reason: 'Long wait', pin: '9753' });
  a = await lastOf('comp');
  check('…the owner’s PIN: done, okayed by them', r.body.ok && a.okBy?.name === 'Rae Lin' && a.cents === 250 && a.reason === 'Long wait', [r.body, a]);
  await db.doc(T).set({ moneyRules: { comp: 'anyone' } }, { merge: true });
  r = await K({ action: 'comp', orderId: o4, lineId: (await get(`${T}/counterOrders/${o4}`)).lines.find((x: any) => !x.comp).lineId, qty: 1, reason: 'Regular' });
  a = await lastOf('comp');
  check('anyone’s: no PIN, and it’s by them', r.body.ok && a.by?.name === 'Kai Park' && a.okBy?.name === 'Kai Park', [r.body, a]);
  const ownerPass = await passOf('o1', 'Rae Lin');
  await db.doc(T).set({ moneyRules: { comp: 'owner' } }, { merge: true });
  r = await P({ staffPass: ownerPass, action: 'comp', orderId: o4, lineId: (await get(`${T}/counterOrders/${o4}`)).lines.find((x: any) => !x.comp).lineId, qty: 1, reason: 'Friend' });
  check('the owner signed in here is never asked for a PIN', r.body.ok, r.body);

  console.log('voids, prices, discounts, the drawer, staff meals');
  const o5 = await newOrder(2);
  await db.doc(`${T}/counterOrders/${o5}`).set({ kitchen: 'making' }, { merge: true });
  r = await K({ action: 'void', orderId: o5, reason: 'Guest left' });
  check('a void, as today: a manager', r.status === 403 && r.body.needsManager && r.body.error === 'A void takes a manager. Their PIN, or ask one to.', r.body);
  r = await K({ action: 'void', orderId: o5, reason: 'Guest left', pin: '1357' });
  a = await lastOf('void');
  check('…their PIN typed here now works too; once the kitchen started, worth a look', r.body.ok && a.action === 'counter.void' && a.okBy?.name === 'Mo Diaz' && a.cents === 550 && a.flag === 'After the kitchen started' && a.reason === 'Guest left', [r.body, a]);
  await db.doc(T).set({ moneyRules: { lowerPrice: 'anyone' } }, { merge: true });
  const o6 = await newOrder(2, false);
  const line6 = (await get(`${T}/counterOrders/${o6}`)).lines[0];
  r = await K({ action: 'price', orderId: o6, lineId: line6.lineId, qty: 1, price: 1.5, reason: 'Damaged' });
  a = await lastOf('price');
  check('a lower price anyone can give: done with no PIN, $1.00 off, in Activity', r.body.ok && a.cents === 100 && a.reason === 'Damaged (lower)' && a.by?.name === 'Kai Park' && !a.okBy, [r.body, a]);
  await db.doc(T).set({ moneyRules: { lowerPrice: 'owner' } }, { merge: true });
  r = await K({ action: 'price', orderId: o6, lineId: (await get(`${T}/counterOrders/${o6}`)).lines.find((x: any) => !x.priceChange).lineId, qty: 1, price: 1, reason: 'Damaged', pin: '1357' });
  check('…only the owner’s: a manager’s PIN isn’t enough', r.status === 403 && r.body.owner === true && r.body.needsManager, r.body);
  r = await K({ action: 'price', orderId: o6, lineId: (await get(`${T}/counterOrders/${o6}`)).lines.find((x: any) => !x.priceChange).lineId, qty: 1, price: 4, reason: 'Wrong price' });
  check('…higher never asks', r.body.ok, r.body);
  await db.doc(T).set({ moneyRules: { customDiscount: 'anyone' } }, { merge: true });
  await K({ action: 'send', orderId: o6 });
  r = await K({ action: 'discount', orderId: o6, custom: { kind: 'off', value: 100, reason: 'Birthday' } });
  a = await lastOf('discount');
  check('another discount amount, anyone’s: in Activity with why', r.body.ok && a?.cents === 100 && /Birthday/.test(a.reason || ''), [r.body, a]);
  await db.doc(`${T}/printers/front`).set({ name: 'Front counter', kind: 'star', receipts: true, drawer: true });
  await db.doc(T).set({ moneyRules: { noSale: 'manager' } }, { merge: true });
  r = await K({ action: 'noSale', reason: 'Change for a $20', moveKey: 'nosale-mr-0001' });
  check('the drawer with no sale, a manager’s by the owner’s rules: asks', r.status === 403 && r.body.needsManager && r.body.error === 'Opening the drawer with no sale takes a manager. Their PIN, or ask one to.', r.body);
  await db.doc(T).set({ moneyRules: { noSale: 'anyone' } }, { merge: true });
  r = await K({ action: 'noSale', reason: 'Change for a $20', moveKey: 'nosale-mr-0002' });
  a = await lastOf('drawer');
  check('as today, anyone with why: a line, not worth a look the first time', r.body.ok && a.by?.name === 'Kai Park' && a.reason === 'Change for a $20' && a.flag === null, [r.body, a]);
  r = await K({ action: 'noSale', reason: 'Guest forgot change', moveKey: 'nosale-mr-0003' });
  a = await lastOf('drawer');
  check('…again within half an hour by the same person: worth a look', r.body.ok && a.flag === 'Drawer opened with no sale 2 times in 30 minutes', a);
  await db.doc(T).set({ moneyRules: { cashMove: 'anyone' } }, { merge: true });
  r = await K({ action: 'drawer', kind: 'in', cents: 2000, note: 'More change', moveKey: 'drawer-mr-0001' });
  a = await lastOf('cash');
  check('cash in, anyone’s by the owner’s rules: done, in Activity', r.body.ok && a.cents === 2000 && a.reason === 'More change' && r.body.approvedBy === null, [r.body, a]);
  const o7 = await newOrder(1);
  r = await K({ action: 'staffMeal', orderId: o7, for: 'Kai' });
  check('a staff meal, as today: a manager', r.status === 403 && r.body.needsManager, r.body);
  r = await K({ action: 'staffMeal', orderId: o7, for: 'Kai', pin: '1357' });
  a = await lastOf('staffMeal');
  check('…with their PIN: in Activity, for whom', r.body.ok && a.reason === 'For Kai' && a.okBy?.name === 'Mo Diaz' && a.cents === 275, [r.body, a]);

  console.log('a big refund, and wrong PINs');
  await db.doc(T).set({ moneyRules: { refundSelfCents: 0 } }, { merge: true });
  await db.doc(`${T}/inventory/shake`).set({ price: 30 }, { merge: true });
  const c8 = (await K({ action: 'car', carKey: 'carkey-mr-big' })).body;
  await K({ action: 'add', orderId: c8.orderId, itemId: 'shake', quantity: 2, tapKey: 'tap-mr-big' }); await K({ action: 'send', orderId: c8.orderId });
  await P({ action: 'paid', orderId: c8.orderId, method: 'cash', tendered: 70 });
  r = await K({ action: 'refund', orderId: c8.orderId, all: true, reason: 'Spilled', pin: '1357' });
  a = await lastOf('refund');
  check('a refund of $50 or more is worth a look', r.body.ok && a.cents === 6600 && a.flag === 'A refund of $50 or more', a);
  const o9 = await newOrder(1);
  await db.doc(`${T}/private/pinGuard`).delete();
  await K({ action: 'void', orderId: o9, reason: 'Test', pin: '2468' });
  const misses = ((await get(`${T}/private/pinGuard`)) || {}).failedAt?.length || 0;
  check('a right PIN of someone it doesn’t take counts as a wrong one', misses === 1, misses);
  for (let i = 0; i < 16; i++) await K({ action: 'void', orderId: o9, reason: 'Test', pin: '0000' });
  r = await K({ action: 'void', orderId: o9, reason: 'Test', pin: '1357' });
  a = await lastOf('pin');
  check('too many wrong PINs: locked a while, and a line in Activity, worth a look', r.status === 423 && a?.flag === 'Too many wrong PINs' && a.where === 'window', [r.body, a]);
  check('…one line for the lock, not one for each try while it’s locked', (await lines()).filter((x: any) => x.kind === 'pin').length === 1);

  console.log('nothing to edit');
  const all = await lines();
  check('every line has its kind and when; none are written twice', all.filter((x: any) => x.kind).every((x: any) => x.at && x.summary) && new Set(all.map((x: any) => x.id)).size === all.length);
  const audit = src('src/lib/audit.ts');
  check('the log is still append-only (nobody edits or deletes a line)', /allow update, delete: if false;/.test(audit));
  check('no money moment at the counter asks for a manager in the old way any more', !/managerFor\(db, tenantId, staff, b\.pin\);\n\s+if \(m\.error\) return m\.notManager[\s\S]{0,400}(refund|comp|staffMeal|drawer)/.test(src('src/app/api/counter/route.ts')));

  console.log('house style');
  for (const f of ['src/lib/money-rules.ts', 'src/lib/money-rules-server.ts', 'src/lib/activity.ts', 'src/lib/activity-server.ts']) {
    const s = src(f);
    check(`${f}: no shouting, no " · ", no old trade words`, !/\buppercase\b|font-black| · |\{\/\*/.test(s) && !/\b(salon|stylist|booth|chair|studio)s?\b/i.test(s));
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
