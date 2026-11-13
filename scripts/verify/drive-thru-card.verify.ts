// Checks the card reader at the drive-thru window (lib/counter-card, api/counter 'readers', 'card', 'cardCheck',
// 'cardStop', 'cardTest', 'window', and the 'paid' step that now goes through lib/counter-server payOrder).
// - Readers: only the business's own that can take a payment sent from the server; asked at most every 30 seconds.
// - A payment is made once an order and try (two tablets, or a lost answer, never make a second); it's for exactly the
//   order's total; nothing but the reader can pay or void the order while the reader asks for the card.
// - Approved → taken and the order paid by it (the sale in the books with the payment's reference), once.
// - Declined → the reader's words, kept for the lane and the window screen; it can be sent again.
// - Stopped → the reader stops asking and the payment is cancelled, so it can never go through later; one approved just
//   before it was stopped pays for the order instead.
// - A card approved after the order was paid another way is let go; one already taken goes back to the card.
// - The sweep settles any the lane never heard back about.
// - The window screen shows only the car at that window: its order, its total and how paying is going, then where to go.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/drive-thru-card.verify.ts
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
      const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, currency: p.currency, status: 'requires_payment_method', capture_method: p.capture_method, metadata: { ...p.metadata }, amount_received: 0, latest_charge: null, account: o?.stripeAccount };
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
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  const CC = await import('../../src/lib/counter-card');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', stripeAccountId: 'acct_1', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 2.5, totalStock: 500 });
  await db.doc(`${T}/inventory/gum`).set({ type: 'refreshment', name: 'Gum', category: 'Sides', price: 0.2, totalStock: 50 });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  S.readers.set('tmr_window1', { id: 'tmr_window1', label: 'Window', device_type: 'stripe_s700', status: 'online', action: null });
  S.readers.set('tmr_test1', { id: 'tmr_test1', label: 'Test reader', device_type: 'simulated_wisepos_e', status: 'online', action: null });
  S.readers.set('tmr_off1', { id: 'tmr_off1', label: 'Back office', device_type: 'bbpos_wisepos_e', status: 'offline', action: null });
  S.readers.set('tmr_bt1', { id: 'tmr_bt1', label: 'Phone reader', device_type: 'stripe_m2', status: 'online', action: null });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const wkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window screen', kind: 'drive-thru-board' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b }));
  const W = (at: string) => POST(req({ tenantId: 't1', key: wkey, action: 'window', at }));
  let n = 0;
  const newOrder = async (qty = 2, item = 'fries') => {
    const c = (await P({ action: 'car', carKey: `carkey-card-${++n}` })).body;
    await P({ action: 'add', orderId: c.orderId, itemId: item, quantity: qty, tapKey: `tap-card-${n}-a` });
    const s: any = await P({ action: 'send', orderId: c.orderId });
    if (!s.body.ok) throw new Error(JSON.stringify(s.body));
    return c;
  };

  console.log('the readers');
  let r: any = await P({ action: 'readers' });
  const ids = (r.body.readers || []).map((x: any) => x.id).sort();
  check('the business’s readers the lane can send to: online or not, a test one marked, never one that pairs by Bluetooth', r.body.ok && r.body.payments === true && JSON.stringify(ids) === '["tmr_off1","tmr_test1","tmr_window1"]'
    && r.body.readers.find((x: any) => x.id === 'tmr_off1').online === false && r.body.readers.find((x: any) => x.id === 'tmr_test1').test === true, r.body);
  const calls0 = S.listCalls; await P({ action: 'readers' }); await P({ action: 'readers' });
  check('…asked of the card company at most every 30 seconds, however many tablets ask', S.listCalls === calls0, S.listCalls);

  console.log('a card on the reader');
  const c1 = await newOrder(2);   // 2 × 2.50 + 10% = 5.50
  r = await P({ action: 'card', orderId: c1.orderId, readerId: 'tmr_window1' });
  const pi1 = Array.from(S.pis.values()).pop() as any;
  check('the total goes to the reader: exactly the order’s total, no tip asked, the order named on it', r.body.ok && r.body.state === 'on_reader' && pi1.amount === 550 && pi1.capture_method === 'manual'
    && pi1.metadata.orderId === c1.orderId && pi1.metadata.source === 'drive_thru' && pi1.account === 'acct_1' && S.calls.includes(`process tmr_window1 ${pi1.id} tip:no`), { body: r.body, pi1, calls: S.calls });
  r = await P({ action: 'card', orderId: c1.orderId, readerId: 'tmr_window1' });
  check('sent again (another tablet, a second tap): the same payment, still on the reader, never a second', r.body.ok && r.body.state === 'on_reader' && S.pis.size === 1, r.body);
  r = await P({ action: 'paid', orderId: c1.orderId, method: 'cash', tendered: 10 });
  const passOf = async (id: string, name: string) => { const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex'); const h = createHash('sha256').update(key).digest('hex');
    await db.doc(`kitchenScreens/${h}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id, name, exp: Date.now() + 3600000 } } }, { merge: true }); return pass; };
  const v: any = await P({ action: 'void', orderId: c1.orderId, reason: 'Drove off', staffPass: await passOf('m9', 'Mo Diaz') });
  check('while the reader asks for the card, cash, another card machine and a void all wait', r.status === 409 && r.body.code === 'card_busy' && v.status === 409 && !(await get(`${T}/counterOrders/${c1.orderId}`)).paidAt, [r.body, v.body]);
  r = await P({ action: 'cardCheck', orderId: c1.orderId });
  check('checking while the guest hasn’t tapped yet: still on the reader', r.body.state === 'on_reader', r.body);
  let wn: any = await W('pay');
  check('the window screen says to tap or insert the card, with the total', wn.body.show?.mode === 'pay' && wn.body.show.card === 'on_reader' && wn.body.show.total === 5.5 && wn.body.show.number === (await get(`${T}/counterOrders/${c1.orderId}`)).number, wn.body);
  approve('tmr_window1');
  r = await P({ action: 'cardCheck', orderId: c1.orderId });
  const o1 = await get(`${T}/counterOrders/${c1.orderId}`);
  const sale1 = await get(`${T}/transactions/counter_${c1.orderId}`);
  check('approved: taken, and the order paid by it, with the payment’s reference in the books', r.body.ok && r.body.state === 'paid' && S.pis.get(pi1.id).status === 'succeeded' && o1.paidAt && o1.payMethod === 'card'
    && o1.cardPaymentId === pi1.id && o1.card.state === 'paid' && o1.cardOpen === false && sale1?.stripePaymentIntentId === pi1.id && sale1.amount === 5, { body: r.body, o1, sale1 });
  check('…and the car moves on to pick up', (await get(`${T}/driveThruCars/${c1.carId}`)).stage === 'pickup');
  const caps = S.calls.filter((x: string) => x === `capture ${pi1.id}`).length;
  r = await P({ action: 'cardCheck', orderId: c1.orderId });
  const r2: any = await P({ action: 'card', orderId: c1.orderId, readerId: 'tmr_window1' });
  check('asked again: already paid, nothing taken twice', r.body.already === true && r2.body.state === 'paid' && S.calls.filter((x: string) => x === `capture ${pi1.id}`).length === caps && (await all(`${T}/transactions`)).filter((t: any) => t.orderId === c1.orderId).length === 2, [r.body, r2.body]);
  wn = await W('pay');
  check('the window screen: paid, thank you, and on to the next window', wn.body.show?.mode === 'paid' && wn.body.show.paid === true && wn.body.show.payMethod === 'card' && wn.body.show.nextWindow === true, wn.body);

  console.log('declined, then sent again');
  const c2 = await newOrder(1);
  await P({ action: 'card', orderId: c2.orderId, readerId: 'tmr_window1' });
  decline('tmr_window1', 'Your card was declined for insufficient funds.');
  r = await P({ action: 'cardCheck', orderId: c2.orderId });
  check('declined: the reader’s words, plainly, kept on the order', r.body.state === 'declined' && r.body.message === 'The card was declined for not enough funds.' && (await get(`${T}/counterOrders/${c2.orderId}`)).card.failed === r.body.message, r.body);
  await db.doc(`${T}/driveThruCars/${c1.carId}`).set({ stage: 'gone', goneAt: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  wn = await W('one');
  check('…and the window screen says so', wn.body.show?.card === 'declined' && wn.body.show.cardMessage === 'The card was declined for not enough funds.', wn.body.show);
  S.readers.get('tmr_window1').action = null;
  const before2 = S.pis.size;
  r = await P({ action: 'card', orderId: c2.orderId, readerId: 'tmr_window1' });
  check('sent again: the same payment, back on the reader', r.body.state === 'on_reader' && S.pis.size === before2, r.body);
  approve('tmr_window1');
  r = await P({ action: 'cardCheck', orderId: c2.orderId });
  check('…approved the second time: paid', r.body.state === 'paid' && (await get(`${T}/counterOrders/${c2.orderId}`)).payMethod === 'card', r.body);

  console.log('stopped, and paid another way');
  const c3 = await newOrder(1);
  await P({ action: 'card', orderId: c3.orderId, readerId: 'tmr_window1' });
  const pi3 = Array.from(S.pis.values()).pop() as any;
  r = await P({ action: 'cardStop', orderId: c3.orderId });
  check('stopped: the reader stops asking, and the payment is cancelled so it can never go through', r.body.state === 'stopped' && S.readers.get('tmr_window1').action === null && S.pis.get(pi3.id).status === 'canceled' && (await get(`${T}/counterOrders/${c3.orderId}`)).cardOpen === false, r.body);
  await db.doc(`${T}/tillSessions/d1`).set({ status: 'open', expectedCash: 100, totalCashSales: 0 });
  r = await P({ action: 'paid', orderId: c3.orderId, method: 'cash', tendered: 5 });
  check('…then paid in cash, into the drawer', r.body.ok && r.body.change === 2.25 && (await get(`${T}/counterOrders/${c3.orderId}`)).payMethod === 'cash', r.body);
  // Declined, then paid in cash without stopping: the payment left behind is called off.
  const c4 = await newOrder(1);
  await P({ action: 'card', orderId: c4.orderId, readerId: 'tmr_window1' });
  const pi4 = Array.from(S.pis.values()).pop() as any;
  decline('tmr_window1'); await P({ action: 'cardCheck', orderId: c4.orderId }); S.readers.get('tmr_window1').action = null;
  r = await P({ action: 'paid', orderId: c4.orderId, method: 'cash', tendered: 5 });
  check('declined, then cash: the card payment left behind is cancelled, so it can’t go through later', r.body.ok && S.pis.get(pi4.id).status === 'canceled' && (await get(`${T}/counterOrders/${c4.orderId}`)).card.state === 'stopped', { body: r.body, pi: S.pis.get(pi4.id), o: await get(`${T}/counterOrders/${c4.orderId}`) });
  // Approved the moment it was stopped: it pays for the order.
  const c5 = await newOrder(1);
  await P({ action: 'card', orderId: c5.orderId, readerId: 'tmr_window1' });
  approve('tmr_window1');
  r = await P({ action: 'cardStop', orderId: c5.orderId });
  check('approved just before it was stopped: kept, and it pays for the order (the guest saw it approved)', r.body.state === 'paid' && r.body.justWent === true && (await get(`${T}/counterOrders/${c5.orderId}`)).payMethod === 'card', r.body);
  S.readers.get('tmr_window1').action = null;

  console.log('a card that goes through after the order was paid another way');
  const c6 = await newOrder(1);
  await P({ action: 'card', orderId: c6.orderId, readerId: 'tmr_window1' });
  const pi6 = Array.from(S.pis.values()).pop() as any;
  // Another tablet's cash got in first (the reader's hold was released on the screen that died): forced here.
  await db.doc(`${T}/counterOrders/${c6.orderId}`).set({ paidAt: new Date().toISOString(), payMethod: 'cash', card: { state: 'stopping' } }, { merge: true });
  approve('tmr_window1');
  r = await P({ action: 'cardCheck', orderId: c6.orderId });
  check('approved after it was paid in cash: the hold is let go, so the guest is never charged twice', r.body.ok && r.body.notKept === true && S.pis.get(pi6.id).status === 'canceled' && (await get(`${T}/counterOrders/${c6.orderId}`)).payMethod === 'cash', { body: r.body, pi: S.pis.get(pi6.id) });
  S.readers.get('tmr_window1').action = null;
  const c7 = await newOrder(1);
  await P({ action: 'card', orderId: c7.orderId, readerId: 'tmr_window1' });
  const pi7 = Array.from(S.pis.values()).pop() as any;
  await db.doc(`${T}/counterOrders/${c7.orderId}`).set({ paidAt: new Date().toISOString(), payMethod: 'cash' }, { merge: true });
  S.pis.get(pi7.id).status = 'succeeded'; S.pis.get(pi7.id).amount_received = pi7.amount;
  r = await P({ action: 'cardCheck', orderId: c7.orderId });
  const notes = (await all(`${T}/notifications`)).filter((x: any) => x.type === 'counter_card_back');
  check('…one already taken goes back to the card, once, and the managers are told', S.refunds.length === 1 && S.refunds[0].payment_intent === pi7.id && notes.length === 1 && /went back to the guest’s card/.test(notes[0].message), { refunds: S.refunds, notes });
  r = await P({ action: 'cardCheck', orderId: c7.orderId });
  check('…asked again: no second refund', S.refunds.length === 1, S.refunds);
  S.readers.get('tmr_window1').action = null;

  console.log('trouble');
  const c8 = await newOrder(1);
  r = await P({ action: 'card', orderId: c8.orderId, readerId: 'tmr_off1' });
  check('an offline reader: said plainly, and the order can still be sent again or paid another way', r.status === 409 && /offline/.test(r.body.error) && (await get(`${T}/counterOrders/${c8.orderId}`)).card.state === 'declined', r.body);
  r = await P({ action: 'paid', orderId: c8.orderId, method: 'card' });
  check('…paid on the business’s own card machine instead, and the reader’s payment called off', r.body.ok && (await get(`${T}/counterOrders/${c8.orderId}`)).payMethod === 'card' && Array.from(S.pis.values()).filter((p: any) => p.metadata.orderId === c8.orderId).every((p: any) => p.status === 'canceled'), r.body);
  const c9 = await newOrder(1, 'gum');   // 0.22
  r = await P({ action: 'card', orderId: c9.orderId, readerId: 'tmr_window1' });
  check('under the card minimum: said, take it in cash', r.status === 409 && /\$0\.50/.test(r.body.error), r.body);
  const c10 = (await P({ action: 'car', carKey: 'carkey-card-unsent' })).body;
  r = await P({ action: 'card', orderId: c10.orderId, readerId: 'tmr_window1' });
  check('an order not sent to the kitchen can’t be paid on the reader', r.status === 409, r.body);
  r = await P({ action: 'card', orderId: c8.orderId, readerId: 'not-a-reader' });
  check('…nor one with no reader picked', r.status === 400 || r.body.state === 'paid', r.body);
  const c11 = await newOrder(1);
  S.down = true;
  r = await P({ action: 'card', orderId: c11.orderId, readerId: 'tmr_window1' });
  S.down = false;
  check('the card company can’t be reached: nothing charged, and it can be tried again', r.status === 503 && /Nothing was charged/.test(r.body.error) && (await get(`${T}/counterOrders/${c11.orderId}`)).card.state === 'stopped', r.body);
  r = await P({ action: 'card', orderId: c11.orderId, readerId: 'tmr_window1' });
  check('…tried again: on the reader', r.body.state === 'on_reader', r.body);
  r = await P({ action: 'cardTest', orderId: c11.orderId });
  check('a test card only works on a test reader', r.status === 409 && /test reader/.test(r.body.error), r.body);
  await P({ action: 'cardStop', orderId: c11.orderId });
  await P({ action: 'card', orderId: c11.orderId, readerId: 'tmr_test1' });
  r = await P({ action: 'cardTest', orderId: c11.orderId });
  const r11: any = await P({ action: 'cardCheck', orderId: c11.orderId });
  check('…on a test reader, a test card goes through end to end', r.body.ok && r11.body.state === 'paid', [r.body, r11.body]);

  console.log('two screens at once');
  check('every payment’s key is short, whatever the order’s id', Array.from(S.keys.keys()).every((k: any) => String(k).length < 80), Array.from(S.keys.keys()));
  // The reader approves the card and moves on before the lane asks: never called declined.
  const d1 = await newOrder(1);
  await P({ action: 'card', orderId: d1.orderId, readerId: 'tmr_window1' });
  approve('tmr_window1'); S.readers.get('tmr_window1').action = null;
  await db.doc(`${T}/counterOrders/${d1.orderId}`).set({ card: { sentAt: new Date(Date.now() - 60000).toISOString() } }, { merge: true });
  r = await P({ action: 'cardCheck', orderId: d1.orderId });
  check('the reader moved on the moment the card was approved: the payment is asked again, and it’s paid, never “declined”', r.body.state === 'paid' && (await get(`${T}/counterOrders/${d1.orderId}`)).payMethod === 'card', r.body);
  // Stopped on another screen while this one is still starting the payment: the new payment is let go, never sent.
  const d2 = await newOrder(1);
  S.onCreate = async () => { await P({ action: 'cardStop', orderId: d2.orderId }); };
  const sentBefore = S.calls.filter((x: string) => x.startsWith('process')).length;
  r = await P({ action: 'card', orderId: d2.orderId, readerId: 'tmr_window1' });
  const pid2 = Array.from(S.pis.values()).pop() as any;
  check('stopped on another screen mid-start: that payment is canceled and never sent to the reader', r.body.state === 'stopped' && S.pis.get(pid2.id).status === 'canceled'
    && S.calls.filter((x: string) => x.startsWith('process')).length === sentBefore && (await get(`${T}/counterOrders/${d2.orderId}`)).card.state === 'stopped', { body: r.body, pi: S.pis.get(pid2.id) });
  // Cash tapped on another tablet while the payment goes to the reader: it waits.
  const d3 = await newOrder(1);
  let cashMid: any = null;
  S.onProcess = async () => { cashMid = await P({ action: 'paid', orderId: d3.orderId, method: 'cash', tendered: 5 }); };
  r = await P({ action: 'card', orderId: d3.orderId, readerId: 'tmr_window1' });
  check('cash tapped on another tablet while the total goes to the reader waits for the reader', cashMid?.status === 409 && cashMid.body.code === 'card_busy' && r.body.state === 'on_reader' && !(await get(`${T}/counterOrders/${d3.orderId}`)).paidAt, [cashMid?.body, r.body]);
  // Sent again after a decline: cash waits for that too.
  decline('tmr_window1'); await P({ action: 'cardCheck', orderId: d3.orderId }); S.readers.get('tmr_window1').action = null;
  S.onProcess = async () => { cashMid = await P({ action: 'paid', orderId: d3.orderId, method: 'cash', tendered: 5 }); };
  r = await P({ action: 'card', orderId: d3.orderId, readerId: 'tmr_window1' });
  check('…and while it’s sent again after a decline', cashMid?.status === 409 && r.body.state === 'on_reader', [cashMid?.body, r.body]);
  // The car can't pay: voided with the card declined, its payment is called off.
  decline('tmr_window1'); await P({ action: 'cardCheck', orderId: d3.orderId }); S.readers.get('tmr_window1').action = null;
  const pid3 = (await get(`${T}/counterOrders/${d3.orderId}`)).card.id;
  r = await P({ action: 'void', orderId: d3.orderId, reason: 'Couldn’t pay', staffPass: await passOf('m9', 'Mo Diaz') });
  check('voided after a decline: the card payment is canceled, so it can never go through', r.body.ok && S.pis.get(pid3).status === 'canceled' && (await get(`${T}/counterOrders/${d3.orderId}`)).card.state === 'stopped', { body: r.body, pi: S.pis.get(pid3) });
  // The window screen shows the car the reader is asking for, even with another car first at the pay window.
  for (const c of await all(`${T}/driveThruCars`)) if (c.stage !== 'gone') await db.doc(`${T}/driveThruCars/${c.id}`).set({ stage: 'gone', goneAt: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  const e1 = await newOrder(1); const e2 = await newOrder(2);
  await P({ action: 'card', orderId: e2.orderId, readerId: 'tmr_window1' });
  let wn2: any = await W('pay');
  check('the window screen shows the car the reader is asking for, even with another car ahead of it', wn2.body.show?.number === (await get(`${T}/counterOrders/${e2.orderId}`)).number && wn2.body.show.card === 'on_reader', wn2.body.show);
  await P({ action: 'cardStop', orderId: e2.orderId });
  wn2 = await W('pay');
  check('…stopped: back to the first car at the window', wn2.body.show?.number === (await get(`${T}/counterOrders/${e1.orderId}`)).number, wn2.body.show);
  for (const c of await all(`${T}/driveThruCars`)) if (c.stage !== 'gone') await db.doc(`${T}/driveThruCars/${c.id}`).set({ stage: 'gone', goneAt: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  // A payment already given back by hand counts as given back.
  const d4 = await newOrder(1);
  await P({ action: 'card', orderId: d4.orderId, readerId: 'tmr_window1' });
  const pid4 = (await get(`${T}/counterOrders/${d4.orderId}`)).card.id;
  await db.doc(`${T}/counterOrders/${d4.orderId}`).set({ paidAt: new Date().toISOString(), payMethod: 'cash' }, { merge: true });
  S.pis.get(pid4).status = 'succeeded'; S.pis.get(pid4).amount_received = S.pis.get(pid4).amount; S.readers.get('tmr_window1').action = null;
  S.refundErr = 'charge_already_refunded';
  r = await P({ action: 'cardCheck', orderId: d4.orderId });
  S.refundErr = null;
  const o4 = await get(`${T}/counterOrders/${d4.orderId}`);
  check('a card payment already given back by hand counts as given back: not tried again forever', o4.cardBack[pid4].refunded === true && o4.cardOpen === false, o4);
  const before7 = (await all(`${T}/notifications`)).filter((x: any) => x.type === 'counter_card_back').length;
  await CC.sweepCounterCards(db, 't1', await get(T), { stripe: new FakeStripe(), now: Date.now() + 6 * 60000 });
  check('…and the managers are told once a payment, however often it’s looked at', (await all(`${T}/notifications`)).filter((x: any) => x.type === 'counter_card_back').length === before7);

  console.log('the sweep');
  const c12 = await newOrder(1);
  await P({ action: 'card', orderId: c12.orderId, readerId: 'tmr_window1' });
  approve('tmr_window1'); S.readers.get('tmr_window1').action = null;
  const tenant = await get(T);
  let sw = await CC.sweepCounterCards(db, 't1', tenant, { stripe: new FakeStripe() });
  check('the sweep leaves a payment alone for its first 5 minutes (the lane is still on it)', sw.checked === 0 && !(await get(`${T}/counterOrders/${c12.orderId}`)).paidAt, sw);
  sw = await CC.sweepCounterCards(db, 't1', tenant, { stripe: new FakeStripe(), now: Date.now() + 6 * 60000 });
  check('…then one the lane never heard back about, approved: the order paid by it', sw.paid === 1 && (await get(`${T}/counterOrders/${c12.orderId}`)).payMethod === 'card', sw);
  const c13 = await newOrder(1);
  await P({ action: 'card', orderId: c13.orderId, readerId: 'tmr_window1' });
  const pi13 = Array.from(S.pis.values()).pop() as any;
  sw = await CC.sweepCounterCards(db, 't1', tenant, { stripe: new FakeStripe(), now: Date.now() + 16 * 60000 });
  check('…one still waiting after 15 minutes: stopped and cancelled', sw.stopped >= 1 && S.pis.get(pi13.id).status === 'canceled' && (await get(`${T}/counterOrders/${c13.orderId}`)).card.state === 'stopped', { sw, pi: S.pis.get(pi13.id) });

  console.log('the window screen');
  r = await POST(req({ tenantId: 't1', key, action: 'window', at: 'pay' }));
  check('the window screen has its own display-only key: a lane key can’t open it', r.status === 401, r.body);
  r = await POST(req({ tenantId: 't1', key: wkey, action: 'car' }));
  check('…and the window screen’s key can’t work the lane', r.status === 401, r.body);
  const cw = await newOrder(3);
  await db.doc(`${T}/counterOrders/${cw.orderId}`).set({ guestName: 'Sam' }, { merge: true });
  // Cars ahead have moved on.
  for (const c of await all(`${T}/driveThruCars`)) if (c.id !== cw.carId && c.stage !== 'gone') await db.doc(`${T}/driveThruCars/${c.id}`).set({ stage: 'gone', goneAt: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  wn = await W('one');
  const keys = Object.keys(wn.body.show || {}).sort().join(',');
  check('at a single window: the car there, by first name, its items with pictures, total, and nothing about anyone else', wn.body.show?.mode === 'pay' && wn.body.show.name === 'Sam' && wn.body.show.lines.length === 1 && wn.body.show.total === 8.25
    && keys === 'card,cardMessage,change,kitchen,lines,mode,name,nextWindow,number,paid,payMethod,payUrl,spot,subtotal,tax,total', { show: wn.body.show, keys });
  await db.doc(`${T}/tillSessions/d1`).set({ status: 'open' }, { merge: true });
  await P({ action: 'paid', orderId: cw.orderId, method: 'cash', tendered: 20 });
  wn = await W('one');
  check('paid in cash: the change shows, and the order is being made', wn.body.show?.mode === 'paid' && wn.body.show.change === 11.75 && wn.body.show.kitchen === 'making' && wn.body.show.nextWindow === false, wn.body.show);
  await P({ action: 'move', carId: cw.carId, to: 'forward', spot: '3' });
  wn = await W('pickup');
  check('pulled forward: “Please pull forward to spot 3”', wn.body.show?.mode === 'forward' && wn.body.show.spot === '3', wn.body.show);
  const cx = await newOrder(1);
  await P({ action: 'paid', orderId: cx.orderId, method: 'cash', tendered: 5 });
  await P({ action: 'move', carId: cx.carId, to: 'gone' });
  for (const c of await all(`${T}/driveThruCars`)) if (c.stage === 'forward') await db.doc(`${T}/driveThruCars/${c.id}`).set({ stageAt: { ...(c.stageAt || {}), forward: new Date(Date.now() - 60000).toISOString() } }, { merge: true });
  wn = await W('pickup');
  check('handed over at the window: thank you, before the next car', wn.body.show?.mode === 'thanks' && wn.body.show.number === (await get(`${T}/counterOrders/${cx.orderId}`)).number, wn.body.show);
  for (const c of await all(`${T}/driveThruCars`)) if (c.stage !== 'gone') await db.doc(`${T}/driveThruCars/${c.id}`).set({ stage: 'gone', goneAt: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  await db.doc(`${T}/driveThruCars/${cx.carId}`).set({ goneAt: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  wn = await W('one');
  check('no car at the window: a welcome, with the business’s name', wn.body.ok && wn.body.show === null && wn.body.business.name === 'Northside', wn.body);

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
