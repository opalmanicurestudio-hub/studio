// Checks scan to pay at the drive-thru (lib/counter-phone, api/counter 'phoneLink' and 'phoneCheck', the guest's own page
// through api/counter/pay, the window screen's code, and the payment notice in lib/connect-webhook).
// - The link is signed for one order: another order's, a changed one or none opens nothing.
// - It works while the order is with the kitchen and not paid, for 3 hours at most; never for a voided order.
// - One phone payment per order (opening the page again reuses it); always the order's total, worked out on the server.
// - Paid: the order is paid by it once, whichever hears first (the page, the lane, the payment notice).
// - Cash or a card on the reader first: the phone payment is called off; paid on the phone at that same moment, it goes
//   back to the guest's card and managers are told. A card the reader was asking for is called off when the phone pays.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/drive-thru-phone.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
delete process.env.ORDER_TRACK_SECRET; delete process.env.RETAIL_QR_SECRET; delete process.env.CRON_SECRET;
let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), readers: new Map<string, any>(), refunds: [] as any[], calls: [] as string[], n: 0, event: null as any, down: false };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const err = (code: string, msg = code) => Object.assign(new Error(msg), { code, raw: { code } });
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`;
      const pi = { id, amount: p.amount, currency: p.currency, status: 'requires_payment_method', capture_method: p.capture_method || 'automatic', automatic_payment_methods: p.automatic_payment_methods || null, metadata: { ...p.metadata }, amount_received: 0, client_secret: `${id}_secret_x`, account: o?.stripeAccount };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); S.calls.push(`create ${id}`);
      return clone(pi);
    },
    retrieve: async (id: string) => { if (S.down) throw err('api_connection_error'); const pi = S.pis.get(id); if (!pi) throw Object.assign(err('resource_missing'), { statusCode: 404 }); return clone(pi); },
    capture: async (id: string) => { const pi = S.pis.get(id); if (pi.status !== 'requires_capture') throw err('payment_intent_unexpected_state'); pi.status = 'succeeded'; pi.amount_received = pi.amount; S.calls.push(`capture ${id}`); return clone(pi); },
    cancel: async (id: string) => { const pi = S.pis.get(id); if (pi.status === 'succeeded') throw err('payment_intent_unexpected_state'); pi.status = 'canceled'; S.calls.push(`cancel ${id}`); return clone(pi); },
  };
  refunds = { create: async (p: any) => { S.refunds.push(p); const pi = S.pis.get(p.payment_intent); if (pi) pi.refunded = true; return { id: `re_${S.refunds.length}`, status: 'succeeded', amount: p.amount }; } };
  terminal = { readers: {
    list: async () => ({ data: Array.from(S.readers.values()).map(clone) }),
    retrieve: async (id: string) => clone(S.readers.get(id)),
    processPaymentIntent: async (id: string, p: any) => { const r = S.readers.get(id); r.action = { type: 'process_payment_intent', status: 'in_progress', process_payment_intent: { payment_intent: p.payment_intent }, failure_message: null }; S.calls.push(`process ${id} ${p.payment_intent}`); return clone(r); },
    cancelAction: async (id: string) => { const r = S.readers.get(id); r.action = null; S.calls.push(`cancelAction ${id}`); return clone(r); },
  } };
  webhooks = { constructEvent: () => S.event };
}
/** The guest pays on their phone: the card company takes it. */
const payOnPhone = (piId: string) => { const pi = S.pis.get(piId); pi.status = 'succeeded'; pi.amount_received = pi.amount; };

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
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : String(k).toLowerCase() === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  const { POST: PAY } = await import('../../src/app/api/counter/pay/route');
  const { handleConnectWebhook } = await import('../../src/lib/connect-webhook');
  const PH = await import('../../src/lib/counter-phone');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', stripeAccountId: 'acct_1', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 2.5, totalStock: 500 });
  await db.doc(`${T}/inventory/gum`).set({ type: 'refreshment', name: 'Gum', category: 'Sides', price: 0.2, totalStock: 50 });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  S.readers.set('tmr_window1', { id: 'tmr_window1', label: 'Window', device_type: 'stripe_s700', status: 'online', action: null });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const wkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window screen', kind: 'drive-thru-board' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b }));
  const W = (at: string) => POST(req({ tenantId: 't1', key: wkey, action: 'window', at }));
  const G = (b: any) => PAY(req({ tenantId: 't1', ...b }));
  let n = 0;
  const newOrder = async (qty = 2, item = 'fries', send = true) => {
    const c = (await P({ action: 'car', carKey: `carkey-phone-${++n}` })).body;
    await P({ action: 'add', orderId: c.orderId, itemId: item, quantity: qty, tapKey: `tap-phone-${n}-a` });
    if (send) { const s: any = await P({ action: 'send', orderId: c.orderId }); if (!s.body.ok) throw new Error(JSON.stringify(s.body)); }
    return c;
  };
  const linkOf = (url: string) => { const u = new URL(url); return { o: u.searchParams.get('o') || '', s: u.searchParams.get('s') || '' }; };
  // Only the car at the window, for the window screen checks.
  const onlyAtWindow = async (carId: string) => { for (const c of await all(`${T}/driveThruCars`)) if (c.id !== carId && c.stage !== 'gone') await db.doc(`${T}/driveThruCars/${c.id}`).set({ stage: 'gone', goneAt: new Date(Date.now() - 60000).toISOString() }, { merge: true }); };

  console.log('the code');
  const c1 = await newOrder(2);   // 2 × 2.50 + 10% = 5.50
  let r: any = await P({ action: 'phoneLink', orderId: c1.orderId });
  check('with nothing to sign links with on the server, no code (and it says so)', r.status === 409 && r.body.code === 'no_secret', r.body);
  process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
  const cb = await newOrder(1, 'fries', false);
  r = await P({ action: 'phoneLink', orderId: cb.orderId });
  check('an order still being taken: no code until it goes to the kitchen', r.status === 409 && !(await get(`${T}/counterOrders/${cb.orderId}`)).phone, r.body);
  const cg = await newOrder(1, 'gum');
  r = await P({ action: 'phoneLink', orderId: cg.orderId });
  check('under the card company’s 50 cent minimum: cash instead', r.status === 409 && r.body.code === 'too_small', r.body);
  await onlyAtWindow(c1.carId);
  let wn: any = await W('pay');
  check('the window screen has no code before the team puts one up', wn.body.show?.mode === 'pay' && wn.body.show.payUrl === null, wn.body.show);
  r = await P({ action: 'phoneLink', orderId: c1.orderId });
  const L1 = linkOf(r.body.url || 'https://x/');
  check('the code: a link to this order’s own pay page, signed for it', r.body.ok && r.body.url.startsWith('https://app.test/drive-thru/t1/pay?o=') && L1.o === c1.orderId && L1.s.length === 32 && !!(await get(`${T}/counterOrders/${c1.orderId}`)).phone?.shownAt, r.body);
  wn = await W('pay');
  check('…and the window screen shows the same code for the car there', wn.body.show?.payUrl === r.body.url, wn.body.show);

  console.log('the guest’s page');
  r = await G({ action: 'view', o: c1.orderId, s: 'x'.repeat(32) });
  const rOther = await G({ action: 'view', o: cg.orderId, s: L1.s });
  const rNone = await G({ action: 'view', o: c1.orderId });
  check('a changed link, another order’s signature, or none: nothing opens', r.status === 404 && rOther.status === 404 && rNone.status === 404 && !r.body.lines && S.pis.size === 0, [r.body, rOther.body, rNone.body]);
  r = await G({ action: 'view', ...L1 });
  const pi1 = Array.from(S.pis.values()).pop() as any;
  check('the page: the order, its total, and the card company’s form for exactly that total', r.body.ok && r.body.paid === false && r.body.total === 5.5 && r.body.lines.length === 1 && r.body.business === 'Northside'
    && r.body.clientSecret === pi1.client_secret && r.body.publishableKey === 'pk_test_fake' && r.body.stripeAccount === 'acct_1'
    && pi1.amount === 550 && pi1.account === 'acct_1' && pi1.automatic_payment_methods?.enabled === true && pi1.automatic_payment_methods?.allow_redirects === 'never' && pi1.metadata.source === 'drive_thru_phone' && pi1.metadata.orderId === c1.orderId && pi1.metadata.tenantId === 't1', { body: r.body, pi1 });
  check('…and nothing about the business beyond its name and this order', !('stripeAccountId' in r.body) && !('createdBy' in r.body) && !('carId' in r.body), Object.keys(r.body));
  r = await G({ action: 'view', ...L1 });
  check('opened again (a second scan, a refresh): the same payment, never a second', r.body.clientSecret === pi1.client_secret && S.pis.size === 1, r.body);
  r = await G({ action: 'done', ...L1 });
  check('the page asks before the card company has it: still processing', r.status === 202 && r.body.pending === true && !(await get(`${T}/counterOrders/${c1.orderId}`)).paidAt, r.body);
  r = await P({ action: 'phoneCheck', orderId: c1.orderId });
  check('…and so does the lane', r.body.ok && r.body.paid === false, r.body);
  payOnPhone(pi1.id);
  r = await G({ action: 'done', ...L1 });
  const o1 = await get(`${T}/counterOrders/${c1.orderId}`);
  const sale1 = await get(`${T}/transactions/counter_${c1.orderId}`);
  check('paid on the phone: the order paid by it, with the payment’s reference in the books', r.body.ok && r.body.paid === true && o1.paidAt && o1.payMethod === 'card' && o1.paidVia === 'phone' && o1.cardPaymentId === pi1.id && o1.phone.state === 'paid'
    && sale1?.stripePaymentIntentId === pi1.id && sale1.amount === 5, { body: r.body, o1, sale1 });
  check('…and the car moves on to pick up', (await get(`${T}/driveThruCars/${c1.carId}`)).stage === 'pickup');
  const txs = (await all(`${T}/transactions`)).filter((t: any) => t.orderId === c1.orderId).length;
  r = await P({ action: 'phoneCheck', orderId: c1.orderId });
  const again: any = await G({ action: 'done', ...L1 });
  const view: any = await G({ action: 'view', ...L1 });
  check('heard again (the lane, the page): paid once, nothing recorded twice', r.body.paid === true && r.body.viaPhone === true && again.body.paid === true && view.body.paid === true && !view.body.clientSecret
    && (await all(`${T}/transactions`)).filter((t: any) => t.orderId === c1.orderId).length === txs, [r.body, again.body, view.body]);
  r = await P({ action: 'phoneLink', orderId: c1.orderId });
  check('no new code for a paid order', r.status === 409 && r.body.code === 'paid', r.body);
  const c1at = (await get(`${T}/counterOrders/${c1.orderId}`)).createdAt;
  await db.doc(`${T}/counterOrders/${c1.orderId}`).set({ createdAt: new Date(Date.now() - 4 * 3600000).toISOString() }, { merge: true });
  r = await G({ action: 'view', ...L1 });
  check('a paid order’s link stops showing the guest’s name and order after 3 hours too', r.status === 410 && !r.body.lines && !r.body.name, r.body);
  await db.doc(`${T}/counterOrders/${c1.orderId}`).set({ createdAt: c1at }, { merge: true });

  console.log('opened at once, or while the card company is unreachable');
  const cc = await newOrder(2);
  r = await P({ action: 'phoneLink', orderId: cc.orderId });
  const LC = linkOf(r.body.url);
  const n0 = S.pis.size;
  const [va, vb]: any[] = await Promise.all([G({ action: 'view', ...LC }), G({ action: 'view', ...LC })]);
  check('two phones open it at the same moment: one payment, and both get it', va.body.ok && vb.body.ok && va.body.clientSecret === vb.body.clientSecret && S.pis.size === n0 + 1, [va.body, vb.body, S.pis.size - n0]);
  const idBefore = (await get(`${T}/counterOrders/${cc.orderId}`)).phone.id;
  S.down = true; r = await G({ action: 'view', ...LC }); S.down = false;
  check('the card company unreachable on a reload: try again, and the payment already open on their phone is kept (never a second)', r.status === 503 && (await get(`${T}/counterOrders/${cc.orderId}`)).phone.id === idBefore && S.pis.size === n0 + 1, r.body);

  console.log('the payment notice');
  const c2 = await newOrder(1);   // 2.75
  r = await P({ action: 'phoneLink', orderId: c2.orderId });
  const L2 = linkOf(r.body.url);
  await G({ action: 'view', ...L2 });
  const pi2 = Array.from(S.pis.values()).pop() as any;
  payOnPhone(pi2.id);
  S.event = { type: 'charge.succeeded', account: 'acct_1', data: { object: { id: 'ch_2', object: 'charge', amount: 275, paid: true, refunded: false, payment_intent: pi2.id, metadata: clone(S.pis.get(pi2.id).metadata) } } };
  await handleConnectWebhook(req({}));
  let o2 = await get(`${T}/counterOrders/${c2.orderId}`);
  check('the guest closed the page before it said so: the card company’s notice pays the order', o2.paidAt && o2.payMethod === 'card' && o2.paidVia === 'phone' && o2.cardPaymentId === pi2.id, o2);
  const tx2 = (await all(`${T}/transactions`)).filter((t: any) => t.orderId === c2.orderId).length;
  await handleConnectWebhook(req({}));
  check('…once, however many times it’s told', tx2 > 0 && (await all(`${T}/transactions`)).filter((t: any) => t.orderId === c2.orderId).length === tx2, tx2);
  const c2b = await newOrder(1);
  S.event = { type: 'charge.succeeded', account: 'acct_1', data: { object: { id: 'ch_x', object: 'charge', amount: 275, paid: true, refunded: false, payment_intent: pi2.id, metadata: { ...clone(S.pis.get(pi2.id).metadata), orderId: c2b.orderId } } } };
  await handleConnectWebhook(req({}));
  check('a notice naming another order than its payment was made for pays nothing', !(await get(`${T}/counterOrders/${c2b.orderId}`)).paidAt);

  console.log('paid another way');
  const c3 = await newOrder(2);
  r = await P({ action: 'phoneLink', orderId: c3.orderId });
  const L3 = linkOf(r.body.url);
  await G({ action: 'view', ...L3 });
  const pi3 = Array.from(S.pis.values()).pop() as any;
  await db.doc(`${T}/tillSessions/d1`).set({ status: 'open' }, { merge: true });
  r = await P({ action: 'paid', orderId: c3.orderId, method: 'cash', tendered: 10 });
  const o3 = await get(`${T}/counterOrders/${c3.orderId}`);
  check('they paid cash at the window instead: the phone payment is called off, so it can’t be paid as well', r.body.ok && o3.payMethod === 'cash' && S.pis.get(pi3.id).status === 'canceled' && o3.phone.state === 'stopped', { body: r.body, o3, pi: S.pis.get(pi3.id) });
  r = await G({ action: 'view', ...L3 });
  check('…and their page says it’s paid, with no form', r.body.paid === true && !r.body.clientSecret, r.body);

  const c4 = await newOrder(2);
  r = await P({ action: 'phoneLink', orderId: c4.orderId });
  const L4 = linkOf(r.body.url);
  await G({ action: 'view', ...L4 });
  const pi4 = Array.from(S.pis.values()).pop() as any;
  payOnPhone(pi4.id);   // at the very moment cash was taken
  r = await P({ action: 'paid', orderId: c4.orderId, method: 'cash', tendered: 10 });
  const o4 = await get(`${T}/counterOrders/${c4.orderId}`);
  const notes = await all(`${T}/notifications`).catch(() => []);
  check('paid on the phone at the same moment as cash: it goes back to their card, once, and managers are told', o4.payMethod === 'cash' && S.refunds.filter((x: any) => x.payment_intent === pi4.id).length === 1 && S.refunds.find((x: any) => x.payment_intent === pi4.id).amount === 550
    && o4.cardBack?.[pi4.id]?.refunded === true && o4.phone.state === 'stopped' && notes.some((x: any) => String(x.id).includes(pi4.id) && x.userId === 'm9'), { o4, refunds: S.refunds, notes });
  r = await G({ action: 'done', ...L4 });
  check('…and their page says so (not “Thank you”), without giving it back twice', r.status === 409 && r.body.notKept === true && /going back to your card/.test(r.body.error) && S.refunds.filter((x: any) => x.payment_intent === pi4.id).length === 1, r.body);
  const c4b = await newOrder(2);
  r = await P({ action: 'phoneLink', orderId: c4b.orderId });
  const L4b = linkOf(r.body.url);
  await G({ action: 'view', ...L4b });
  const pi4b = Array.from(S.pis.values()).pop() as any;
  await db.doc(`${T}/counterOrders/${c4b.orderId}`).set({ paidAt: new Date().toISOString(), payMethod: 'cash' }, { merge: true });   // paid in cash on another tablet, the phone never called off
  payOnPhone(pi4b.id);
  r = await G({ action: 'done', ...L4b });
  check('paid in cash, and the guest’s card went through too before anyone called it off: their page says it’s going back, and it does', r.status === 409 && r.body.notKept === true && S.refunds.filter((x: any) => x.payment_intent === pi4b.id).length === 1, r.body);

  console.log('called off when paid another way');
  const c4c = await newOrder(2);
  r = await P({ action: 'phoneLink', orderId: c4c.orderId });
  await G({ action: 'view', ...linkOf(r.body.url) });
  const pi4c = Array.from(S.pis.values()).pop() as any;
  r = await P({ action: 'card', orderId: c4c.orderId, readerId: 'tmr_window1' });
  const piR = Array.from(S.pis.values()).pop() as any;
  const rd = S.readers.get('tmr_window1'); S.pis.get(piR.id).status = 'requires_capture'; rd.action.status = 'succeeded';
  r = await P({ action: 'cardCheck', orderId: c4c.orderId });
  check('paid on the card reader: the phone payment is called off', r.body.state === 'paid' && S.pis.get(pi4c.id).status === 'canceled' && (await get(`${T}/counterOrders/${c4c.orderId}`)).phone.state === 'stopped', { body: r.body, pi: S.pis.get(pi4c.id) });
  const c4d = await newOrder(2);
  r = await P({ action: 'phoneLink', orderId: c4d.orderId });
  await G({ action: 'view', ...linkOf(r.body.url) });
  const pi4d = Array.from(S.pis.values()).pop() as any;
  const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex');
  await db.doc(`kitchenScreens/${createHash('sha256').update(key).digest('hex')}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id: 'm9', name: 'Mo Diaz', exp: Date.now() + 3600000 } } }, { merge: true });
  r = await P({ action: 'void', orderId: c4d.orderId, reason: 'Drove off', staffPass: pass });
  check('voided: the phone payment is called off too', r.body.ok && S.pis.get(pi4d.id).status === 'canceled' && (await get(`${T}/counterOrders/${c4d.orderId}`)).phone.state === 'stopped', { body: r.body, pi: S.pis.get(pi4d.id) });

  console.log('a card on the reader meanwhile');
  const c5 = await newOrder(2);
  r = await P({ action: 'card', orderId: c5.orderId, readerId: 'tmr_window1' });
  const piReader = Array.from(S.pis.values()).pop() as any;
  r = await P({ action: 'phoneLink', orderId: c5.orderId });
  const L5 = linkOf(r.body.url);
  await G({ action: 'view', ...L5 });
  const pi5 = Array.from(S.pis.values()).pop() as any;
  payOnPhone(pi5.id);
  r = await G({ action: 'done', ...L5 });
  const o5 = await get(`${T}/counterOrders/${c5.orderId}`);
  check('the reader was asking, but they paid on their phone: paid by the phone, and the reader stops asking', r.body.paid === true && o5.cardPaymentId === pi5.id && o5.paidVia === 'phone'
    && S.calls.includes('cancelAction tmr_window1') && S.pis.get(piReader.id).status === 'canceled' && o5.card.state === 'stopped', { o5, calls: S.calls.slice(-5) });

  console.log('when a link stops working');
  const c6 = await newOrder(1);
  r = await P({ action: 'phoneLink', orderId: c6.orderId });
  const L6 = linkOf(r.body.url);
  await db.doc(`${T}/counterOrders/${c6.orderId}`).set({ status: 'voided' }, { merge: true });
  r = await G({ action: 'view', ...L6 });
  check('a voided order: the page says it was canceled, and no payment is made', r.status === 410 && /canceled/.test(r.body.error) && !(await get(`${T}/counterOrders/${c6.orderId}`)).phone?.id, r.body);
  const c7 = await newOrder(1);
  r = await P({ action: 'phoneLink', orderId: c7.orderId });
  const L7 = linkOf(r.body.url);
  await db.doc(`${T}/counterOrders/${c7.orderId}`).set({ createdAt: new Date(Date.now() - 4 * 3600000).toISOString() }, { merge: true });
  const before = S.pis.size;
  r = await G({ action: 'view', ...L7 });
  check('after 3 hours the link has expired', r.status === 410 && S.pis.size === before, r.body);
  r = await G({ action: 'done', o: c7.orderId, s: L7.s });
  check('…and saying it’s done without a payment ever made pays nothing', r.status === 409 && !(await get(`${T}/counterOrders/${c7.orderId}`)).paidAt, r.body);
  r = await PH.settlePhone(db, 't1', await get(T), c7.orderId, pi1.id, { stripe: new FakeStripe() });
  check('another order’s payment can’t pay this one', r.ok === false && !(await get(`${T}/counterOrders/${c7.orderId}`)).paidAt, r);

  console.log('the sweep');
  const CC = await import('../../src/lib/counter-card');
  const tenant = await get(T);
  const c8 = await newOrder(1);
  r = await P({ action: 'phoneLink', orderId: c8.orderId });
  await G({ action: 'view', ...linkOf(r.body.url) });
  const pi8 = Array.from(S.pis.values()).pop() as any;
  payOnPhone(pi8.id);   // the page closed, the notice never came, nobody looked
  let sw: any = await CC.sweepCounterCards(db, 't1', tenant, { stripe: new FakeStripe() });
  check('the sweep leaves a phone payment alone for its first 5 minutes', sw.paid === 0 && !(await get(`${T}/counterOrders/${c8.orderId}`)).paidAt, sw);
  sw = await CC.sweepCounterCards(db, 't1', tenant, { stripe: new FakeStripe(), now: Date.now() + 6 * 60000 });
  let o8 = await get(`${T}/counterOrders/${c8.orderId}`);
  check('…then one paid on the phone that nobody heard about pays its order', sw.paid >= 1 && o8.paidAt && o8.paidVia === 'phone' && o8.cardPaymentId === pi8.id, { sw, o8 });
  await CC.sweepCounterCards(db, 't1', tenant, { stripe: new FakeStripe(), now: Date.now() + 7 * 60000 });
  o8 = await get(`${T}/counterOrders/${c8.orderId}`);
  check('…and it’s off the sweep’s list after', o8.cardOpen === false, o8);
  const c9 = await newOrder(1);
  r = await P({ action: 'phoneLink', orderId: c9.orderId });
  await G({ action: 'view', ...linkOf(r.body.url) });
  const pi9 = Array.from(S.pis.values()).pop() as any;
  sw = await CC.sweepCounterCards(db, 't1', tenant, { stripe: new FakeStripe(), now: Date.now() + 3.5 * 3600000 });
  await CC.sweepCounterCards(db, 't1', tenant, { stripe: new FakeStripe(), now: Date.now() + 3.6 * 3600000 });
  const o9 = await get(`${T}/counterOrders/${c9.orderId}`);
  check('one left unpaid past its link’s 3 hours: called off, so it can’t be paid later, and off the list', S.pis.get(pi9.id).status === 'canceled' && o9.phone.state === 'stopped' && o9.cardOpen === false && !o9.paidAt, { o9, pi: S.pis.get(pi9.id) });
  const c10 = await newOrder(1);
  r = await P({ action: 'phoneLink', orderId: c10.orderId });
  await G({ action: 'view', ...linkOf(r.body.url) });
  const pi10 = Array.from(S.pis.values()).pop() as any;
  S.pis.get(pi10.id).status = 'canceled';   // called off at the card company already
  await PH.stopPhone(db, 't1', tenant, c10.orderId, { stripe: new FakeStripe() });
  check('calling off one that was called off already: it’s marked stopped, not left open', (await get(`${T}/counterOrders/${c10.orderId}`)).phone.state === 'stopped');

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
