// Checks the self-service review fixes (lib/address-pay, lib/address-cost, lib/order-contact, the self-serve and address
// routes, the rules):
//  - "keep the old address" only refunds a payment the server itself recorded for that request, and needs a shipper
//  - a new request never carries an earlier request's payment
//  - payment pages take cards only; a page paid after another replaced it is refunded; a page that can't be closed is
//    left for the five-minute check instead of being marked cancelled
//  - a cancelled order's address payments are refunded (at once, and by the sweep for a cancel from the team)
//  - the same price can't be paid twice, nor a price taken before the address changed
//  - a share too small to pay by card is the shop's
//  - codes are counted in one step, so many at once can't all go out
//  - an order's moves are counted from its original address: a move back counts nothing, and moving in steps can't
//    stack the shop's limit
//  - customers are told the real reason for a refund or a request
//  - a refund that failed or stopped part way is tried again, and a carrier quote that doesn't answer gives up quickly
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/address-pay-review.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
// Transactions as the database runs them: writes wait until the end, and if anything read changed meanwhile, the
// whole thing runs again (so parallel requests can't all pass a check).
function strict(db: any) {
  db.runTransaction = async (fn: any) => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const reads = new Map<string, string>(); const writes: (() => any)[] = [];
      const tx = {
        get: async (r: any) => { const snap = await r.get(); if (r.path && !r.where) reads.set(r.path, JSON.stringify(db._store.get(r.path) ?? null)); return snap; },
        set: (r: any, v: any, o?: any) => { writes.push(() => r.set(v, o)); },
        update: (r: any, v: any) => { writes.push(() => r.update(v)); },
        create: (r: any, v: any) => { writes.push(() => r.create(v)); },
        delete: (r: any) => { writes.push(() => r.delete()); },
      };
      const out = await fn(tx);
      let changed = false;
      for (const [path, before] of reads) if (JSON.stringify(db._store.get(path) ?? null) !== before) { changed = true; break; }
      if (changed) { await new Promise((r) => setTimeout(r, Math.random() * 3)); continue; }
      for (const w of writes) w();
      return out;
    }
    throw new Error('transaction kept conflicting');
  };
  return db;
}
let db = strict(makeDb());
let sent: any[] = [];
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const stripeCalls = { sessions: [] as any[], expired: [] as string[], refunds: [] as any[] };
let sessions: Record<string, any> = {};
let expireFails = false; let refundFails = 0; let refundedByHand = false;
function StripeMock(this: any) {
  return {
    checkout: { sessions: {
      create: async (p: any) => { const id = `cs_${stripeCalls.sessions.length + 1}`; stripeCalls.sessions.push(p); sessions[id] = { id, url: `https://pay.test/${id}`, payment_status: 'unpaid', status: 'open', amount_total: p.line_items[0].price_data.unit_amount, metadata: p.metadata, payment_intent: null }; return { ...sessions[id] }; },
      retrieve: async (id: string) => { if (!sessions[id]) throw new Error('no session'); return { ...sessions[id] }; },
      expire: async (id: string) => { stripeCalls.expired.push(id); if (expireFails) throw new Error('Stripe is unavailable'); if (sessions[id]?.payment_status === 'paid' || sessions[id]?.status === 'complete') throw new Error('already complete'); if (sessions[id]) sessions[id].status = 'expired'; return { ...(sessions[id] || {}) }; },
    } },
    refunds: { create: async (p: any, o: any) => { if (refundedByHand) throw Object.assign(new Error('Charge ch_1 has already been refunded.'), { code: 'charge_already_refunded' });
      if (refundFails > 0) { refundFails--; throw new Error('Your card was declined'); } stripeCalls.refunds.push({ ...p, key: o?.idempotencyKey }); return { id: `re_${stripeCalls.refunds.length}` }; } },
    paymentIntents: { retrieve: async () => ({}) },
  };
}
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-retail-selfserve' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/request-forensics') return { requestForensics: () => null };
  if (request === '@/lib/notify') return { sendNotification: async (_db: any, m: any) => { sent.push(m); return { ok: true }; } };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: { name: 'Opal' } }) };
  return load.call(this, request, ...rest);
};
// Shippo: 97201 is the order's own address ($7.10); 97210 is a little farther ($8.70); 10001 is across the country
// ($10.30); 97203 is 30 cents more ($7.40). SLOW never answers.
const RATES: Record<string, any[]> = {
  '97201': [{ provider: 'USPS', servicelevel: { name: 'Ground Advantage' }, amount: '7.10' }],
  '97210': [{ provider: 'USPS', servicelevel: { name: 'Ground Advantage' }, amount: '8.70' }],
  '10001': [{ provider: 'USPS', servicelevel: { name: 'Ground Advantage' }, amount: '10.30' }],
  '97203': [{ provider: 'USPS', servicelevel: { name: 'Ground Advantage' }, amount: '7.40' }],
};
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('goshippo.com/shipments')) { const b = JSON.parse(init.body);
    if (b.address_to.zip === '00000') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const r = RATES[b.address_to.zip]; return { ok: !!r, json: async () => (r ? { rates: r } : { detail: 'no rates' }) }; }
  return { ok: true, json: async () => ({}) };
};

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.test' } }) as any;
const HOME = { name: 'Priya Shah', line1: '12 Oak St', line2: '', city: 'Portland', state: 'OR', postalCode: '97201', country: 'US' };
const MID = { name: 'Priya Shah', line1: '9 Pine St', line2: '', city: 'Portland', state: 'OR', postalCode: '97210' };
const FAR = { name: 'Priya Shah', line1: '5 W 31st St', line2: 'Apt 4', city: 'New York', state: 'NY', postalCode: '10001' };
const CLOSE = { name: 'Priya Shah', line1: '3 Birch St', line2: '', city: 'Portland', state: 'OR', postalCode: '97203' };
const SLOW = { name: 'Priya Shah', line1: '1 Slow Rd', line2: '', city: 'Nowhere', state: 'OR', postalCode: '00000' };
const fresh = async (o: any = {}, policies: any = {}) => {
  db = strict(makeDb()); sent = []; sessions = {}; expireFails = false; refundFails = 0; refundedByHand = false; stripeCalls.sessions.length = 0; stripeCalls.expired.length = 0; stripeCalls.refunds.length = 0;
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  await db.doc(T).set({ name: 'Opal', businessName: 'Opal', stripeAccountId: 'acct_1', retailSettings: { shipFrom: { name: 'Opal', street1: '1 Main St', city: 'Portland', state: 'OR', zip: '97204' }, policies } });
  await db.doc(`${T}/private/retail`).set({ shippoApiKey: 'shippo_test' });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Cuticle oil', weightOz: 6 });
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', tenantId: 't1', orderNumber: 1210, stage: 'paid', method: 'ship', qrToken: 'qr1', customerName: 'Priya Shah', customerEmail: 'priya@example.com', customerPhone: '(503) 555-0148',
    shippingAddress: HOME, shippingCarrier: 'USPS', shippingService: 'Ground Advantage', shippingCents: 710, totalCents: 5710, chargedCents: 5710, stripePaymentIntentId: 'pi_main',
    lines: [{ lineId: 'a', productId: 'p1', name: 'Cuticle oil', qtyOrdered: 2, qtyShorted: 0, unitPriceCents: 2500 }], ...o });
};
const order = () => get(`${T}/retailOrders/o1`);
const paySession = (sid: string, pi: string) => { sessions[sid] = { ...sessions[sid], payment_status: 'paid', status: 'complete', payment_intent: pi }; };

(async () => {
  const { POST: selfServe } = await import('../../src/app/api/retail/self-serve/route');
  const { POST: staffAddress } = await import('../../src/app/api/retail/address/route');
  const { addressCostFor, costAfterMove } = await import('../../src/lib/address-cost');
  const { finishAddressPay, cancelAddressPay, sweepAddressPays } = await import('../../src/lib/address-pay');
  const ss = (body: any) => selfServe(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', ...body })) as any;
  const team = (body: any) => staffAddress(req({ tenantId: 't1', orderId: 'o1', ...body })) as any;
  const payFor = async (address: any, pi: string) => { const q = await ss({ action: 'update_address', address }); await ss({ action: 'address_pay', address, pay: q.body.pay }); const sid = (await order()).addressPay.sessionId; paySession(sid, pi); return { q, sid }; };

  console.log('Keeping the old address');
  await fresh();
  await db.doc(`${T}/retailOrders/o1`).set({ addressRequest: { id: 'rq1', kind: 'change', status: 'waiting', to: FAR, at: new Date().toISOString(), paid: { cents: 5000, paymentIntentId: 'pi_main', sessionId: 'cs_forged' } } }, { merge: true });
  let r = await team({ action: 'keep_old', reason: 'Packed already' });
  check('a request whose “payment” the server never recorded refunds nothing (not the order’s own payment)', r.status === 200 && stripeCalls.refunds.length === 0, stripeCalls.refunds);
  const rules = readFileSync('firestore.rules', 'utf8');
  const lockedIn = (fn: string) => (rules.split(`function ${fn}()`)[1] || '').split('}')[0];
  check('…and the team can’t write a request, or the payment records, from the browser', ['addressRequest', 'addressPaid', 'addressPaidOpen', 'addressPaidRetry', 'addressPayLog'].every((k) => lockedIn('orderLockedKeys').includes(`'${k}'`) && lockedIn('orderCreateLockedKeys').includes(`'${k}'`)));
  await fresh();
  await db.doc(`${T}/retailOrders/o1`).set({ addressRequest: { id: 'rq1', kind: 'change', status: 'waiting', to: FAR, at: new Date().toISOString() } }, { merge: true });
  actor = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false, caps: [] };
  r = await team({ action: 'keep_old' });
  check('answering an address change needs someone who ships orders', r.status === 403 && (await order()).addressRequest.status === 'waiting');

  console.log('A new request starts clean');
  await fresh({}, { addressCostPayer: 'customer' });
  let q = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  let sid = (await order()).addressPay.sessionId;
  await db.doc(`${T}/retailOrders/o1`).set({ labelUrl: 'https://label.test/1', shippoTransactionId: null }, { merge: true });
  paySession(sid, 'pi_b');
  r = await ss({ action: 'address_paid', sessionId: sid });
  await db.doc(`${T}/retailOrders/o1`).set({ labelUrl: null }, { merge: true });
  r = await team({ action: 'approve_change' });
  let o: any = await order();
  check('paid for B while the label was bought, approved: B goes on and their $3.20 counts as theirs', r.status === 200 && o.shippingAddress.postalCode === '10001' && o.addressCost?.customerCents === 320 && o.addressCost?.shopCents === 0 && o.addressPaid?.[sid]?.state === 'applied', { r: r.body, cost: o.addressCost });
  await db.doc(T).set({ retailSettings: { policies: { addressCostPayer: 'customer', addressChangeUntil: 'never' } } }, { merge: true });
  r = await ss({ action: 'update_address', address: CLOSE });
  o = await order();
  check('the next change is a new request, with nothing of the last one’s payment or answer', r.body.requested && o.addressRequest?.status === 'waiting' && !o.addressRequest?.paid && !o.addressRequest?.answeredAt && !o.addressRequest?.reply, o.addressRequest);
  r = await team({ action: 'keep_old', reason: 'Already labelled' });
  check('…so keeping the old address refunds nothing (B went on, and its payment stays)', r.status === 200 && stripeCalls.refunds.length === 0);

  console.log('Payment pages');
  await fresh({}, { addressCostPayer: 'customer' });
  q = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  check('payment pages take cards only (no bank debits that clear days later)', JSON.stringify(stripeCalls.sessions[0]?.payment_method_types) === JSON.stringify(['card']));
  const first = (await order()).addressPay.sessionId;
  paySession(first, 'pi_first');
  r = await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  const second = (await order()).addressPay.sessionId;
  let f = await finishAddressPay(db, 't1', 'o1', first, { session: sessions[first] });
  o = await order();
  check('a page paid after a second one replaced it is refunded in full, never left in limbo', second !== first && f.result === 'refunded' && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_first' && x.amount === 320) && o.addressPaid?.[first]?.refundedAt, { f, refunds: stripeCalls.refunds });
  const ledger = (await all(`${T}/transactions`)).filter((x: any) => x.retailOrderId === 'o1');
  check('…and the books show it in and back out', ledger.some((x: any) => x.type === 'income' && x.addressChangeSessionId === first) && ledger.some((x: any) => x.type === 'expense' && x.category === 'Refund' && x.amount === 3.2));
  f = await finishAddressPay(db, 't1', 'o1', first, { session: sessions[first] });
  check('…once, however often Stripe says so', f.result === 'refunded' && stripeCalls.refunds.filter((x) => x.payment_intent === 'pi_first').length === 1);
  paySession(second, 'pi_second');
  f = await finishAddressPay(db, 't1', 'o1', second, { session: sessions[second] });
  check('…and the page that replaced it puts the change on as normal', f.result === 'applied' && (await order()).shippingAddress.postalCode === '10001');

  await fresh({}, { addressCostPayer: 'customer' });
  q = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  sid = (await order()).addressPay.sessionId;
  expireFails = true;
  f = await cancelAddressPay(db, 't1', 'o1', {});
  check('a page that couldn’t be closed isn’t marked cancelled (it may still be paid): left for the five-minute check', f.result === 'pending' && (await order()).addressPay.status === 'awaiting_payment');
  expireFails = false;

  console.log('A cancelled order');
  await fresh({}, { addressCostPayer: 'customer' });
  ({ sid } = await payFor(FAR, 'pi_c1'));
  await ss({ action: 'address_paid', sessionId: sid });
  r = await ss({ action: 'cancel', reason: 'Changed my mind' });
  o = await order();
  check('the customer cancels: what they paid to change the address is refunded with the order, and they’re told', r.status === 200 && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_c1' && x.amount === 320) && o.addressPaid?.[sid]?.refundedAt && /paid to change the address was refunded/.test(r.body.message), r.body);
  await fresh({}, { addressCostPayer: 'customer' });
  ({ sid } = await payFor(FAR, 'pi_c2'));
  await ss({ action: 'address_paid', sessionId: sid });
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'cancelled', cancelledAt: new Date().toISOString() }, { merge: true });
  await sweepAddressPays(db, 't1', await get(T));
  check('the team cancels it: the five-minute check refunds it', stripeCalls.refunds.some((x) => x.payment_intent === 'pi_c2') && (await order()).addressPaid?.[sid]?.refundedAt);
  await sweepAddressPays(db, 't1', await get(T));
  check('…once', stripeCalls.refunds.filter((x) => x.payment_intent === 'pi_c2').length === 1 && (await order()).addressPaidOpen === false);
  await fresh({}, { addressCostPayer: 'customer' });
  q = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  sid = (await order()).addressPay.sessionId;
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'cancelled' }, { merge: true });
  paySession(sid, 'pi_c3');
  f = await finishAddressPay(db, 't1', 'o1', sid, { session: sessions[sid] });
  check('paid just after it was cancelled: refunded, and told it’s because the order was cancelled (not that it had gone out)', f.result === 'refunded' && /was cancelled/.test(f.message) && !/gone out/.test(f.message), f);

  console.log('One price, paid once');
  await fresh({}, { addressCostPayer: 'customer' });
  ({ q, sid } = await payFor(FAR, 'pi_once'));
  await ss({ action: 'address_paid', sessionId: sid });
  const made = stripeCalls.sessions.length;
  r = await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  check('the same price again (a page the browser brought back): nothing to pay, the address is already on', r.status === 200 && r.body.already === true && stripeCalls.sessions.length === made);
  await fresh({}, { addressCostPayer: 'customer' });
  q = await ss({ action: 'update_address', address: FAR });
  await db.doc(`${T}/retailOrders/o1`).set({ shippingAddress: CLOSE }, { merge: true });
  r = await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  check('a price taken before the address changed can’t be paid: they look again', r.status === 409 && stripeCalls.sessions.length === 0);
  const page = readFileSync('src/app/shop/[tenantId]/order/[orderId]/page.tsx', 'utf8');
  check('a page the browser restores clears the old price and looks at the order again', /e\.persisted\) \{ setPayBusy\(false\); setPayAsk\(null\); load\(\); \}/.test(page));

  console.log('Small amounts');
  await fresh({}, { addressCostPayer: 'customer' });
  r = await ss({ action: 'update_address', address: CLOSE });
  o = await order();
  check('a 30¢ difference is too small to pay by card: the shop covers it and the change goes on', r.status === 200 && r.body.applied && o.shippingAddress.postalCode === '97203' && o.addressCost?.shopCents === 30 && o.addressCost?.customerCents === 0, { body: r.body, cost: o.addressCost });

  console.log('Codes');
  await fresh();
  const many = await Promise.all(Array.from({ length: 12 }, (_, i) => ss({ action: 'contact_code', field: 'phone', value: `(971) 555-01${String(10 + i)}` })));
  check('twelve codes asked for at once: only five go out', many.filter((x: any) => x.status === 200).length === 5 && sent.filter((m) => m.kind === 'verify_code').length === 5, many.map((x: any) => x.status));
  await fresh();
  for (const v of ['(971) 555-0199', '971-555-0199', '9715550199']) await ss({ action: 'contact_code', field: 'phone', value: v });
  r = await ss({ action: 'contact_code', field: 'phone', value: '+1 971 555 0199' });
  check('the same number typed four ways counts as one number (three an hour)', r.status === 429 && sent.filter((m) => m.kind === 'verify_code').length === 3);

  console.log('Moves add up from the original address');
  check('moving back counts nothing; moving twice counts both; the limit covers the order once',
    costAfterMove(null, { fromCents: 710, toCents: 1030, service: 'G', carrier: 'U' }, { payer: 'shop_up_to', limitCents: 200 }).owedCents === 120
    && costAfterMove({ origCents: 710, customerCents: 120, toCents: 1030 }, { fromCents: 1030, toCents: 710, service: 'G', carrier: 'U' }, { payer: 'shop_up_to', limitCents: 200 }).state.shopCents === 0
    && costAfterMove({ origCents: 710, customerCents: 0, toCents: 870 }, { fromCents: 870, toCents: 1030, service: 'G', carrier: 'U' }, { payer: 'shop_up_to', limitCents: 200 }).owedCents === 120);
  await fresh({}, { addressCostPayer: 'shop_up_to', addressCostLimitCents: 200 });
  r = await ss({ action: 'update_address', address: MID });
  o = await order();
  check('a $1.60 move under a $2 limit: the shop covers it', r.body.applied && o.addressCost?.shopCents === 160 && o.addressCost?.origCents === 710);
  r = await ss({ action: 'update_address', address: FAR });
  check('moving on to one $3.20 from the original: the customer pays the $1.20 over the limit (the limit isn’t used twice)', r.body.needsPayment && r.body.pay.cents === 120 && r.body.pay.shopCents === 200, r.body);
  await fresh({}, { addressCostPayer: 'shop' });
  await ss({ action: 'update_address', address: FAR });
  check('the shop pays: moving out counts $3.20…', (await order()).addressCost?.shopCents === 320);
  await ss({ action: 'update_address', address: HOME });
  o = await order();
  check('…and moving back brings it to nothing (the running total isn’t left counting $3.20)', o.addressCost?.shopCents === 0 && o.shippingAddress.postalCode === '97201');
  const pol = readFileSync('src/components/orders/PoliciesScreen.tsx', 'utf8');
  check('the running total is added up by the database, so every order counts', /getAggregateFromServer\(shopQ/.test(pol) && /sum\('addressCost\.shopCents'\)/.test(pol));

  console.log('Saying why');
  await fresh({}, { addressCostPayer: 'customer', addressChangeUntil: 'packing' });
  q = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  sid = (await order()).addressPay.sessionId;
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'picking' }, { merge: true });
  paySession(sid, 'pi_w1');
  f = await finishAddressPay(db, 't1', 'o1', sid, { session: sessions[sid] });
  check('packing started while they paid: they’re told that (not that a label was printed)', f.result === 'requested' && /Packing started/.test(f.message) && !/label/.test(f.message), f);
  await fresh({}, { addressCostPayer: 'customer' });
  q = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  sid = (await order()).addressPay.sessionId;
  await db.doc(T).set({ retailSettings: { policies: { addressChangeUntil: 'off' } } }, { merge: true });
  paySession(sid, 'pi_w2');
  f = await finishAddressPay(db, 't1', 'o1', sid, { session: sessions[sid] });
  check('the shop stopped taking changes online meanwhile: refunded, and told why', f.result === 'refunded' && /can’t be changed online/.test(f.message), f);

  console.log('Refunds that didn’t go through');
  await fresh({}, { addressCostPayer: 'customer' });
  q = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  sid = (await order()).addressPay.sessionId;
  await db.doc(`${T}/retailOrders/o1`).set({ labelUrl: 'https://label.test/1' }, { merge: true });
  paySession(sid, 'pi_r1');
  await ss({ action: 'address_paid', sessionId: sid });
  await db.doc(`${T}/retailOrders/o1`).set({ labelUrl: null }, { merge: true });
  refundFails = 1;
  r = await team({ action: 'keep_old', reason: 'Packed' });
  const dues = (await all(`${T}/notifications`)).filter((n: any) => n.type === 'order_refund_due');
  check('keeping the address but the refund fails: the team is told, and the customer hears it will be refunded', r.status === 200 && dues.length === 1 && /tried again/.test(r.body.message) && (await order()).addressPaidRetry === true, { r: r.body, dues });
  await sweepAddressPays(db, 't1', await get(T), { now: Date.now() + 11 * 60000 });
  o = await order();
  check('…the five-minute check tries again and it goes through', stripeCalls.refunds.some((x) => x.payment_intent === 'pi_r1' && x.amount === 320) && o.addressPaid?.[sid]?.refundedAt && o.addressPaidRetry === false);
  await fresh({}, {});
  await db.doc(`${T}/retailOrders/o1`).set({ addressPaid: { cs_9: { cents: 250, pi: 'pi_stuck', at: new Date(Date.now() - 30 * 60000).toISOString(), state: 'refunding', refundWhy: 'gone_out', refundTriedAt: new Date(Date.now() - 30 * 60000).toISOString() } }, addressPaidOpen: true, addressPaidRetry: true }, { merge: true });
  await sweepAddressPays(db, 't1', await get(T));
  check('a refund that stopped part way is finished by the five-minute check', stripeCalls.refunds.some((x) => x.payment_intent === 'pi_stuck' && x.amount === 250) && (await order()).addressPaid.cs_9.refundedAt);
  await fresh({}, {});
  const stale = new Date(Date.now() - 30 * 60000).toISOString();
  await db.doc(`${T}/retailOrders/o1`).set({ addressPaid: { cs_7: { cents: 250, pi: 'pi_hard', at: stale, state: 'refund_failed', refundWhy: 'kept', refundTries: 11, refundTriedAt: stale } }, addressPaidOpen: true, addressPaidRetry: true }, { merge: true });
  refundFails = 5;
  await sweepAddressPays(db, 't1', await get(T));
  await sweepAddressPays(db, 't1', await get(T));
  o = await order(); let notes = (await all(`${T}/notifications`)).filter((n: any) => n.type === 'order_refund_due');
  check('a refund that keeps failing stops after about an hour of tries, and the team is told once to refund it in Stripe', o.addressPaid.cs_7.gaveUp === true && o.addressPaidRetry === false && notes.length === 1 && /refund it in Stripe/.test(notes[0].message), { e: o.addressPaid.cs_7, notes });
  await fresh({}, {});
  await db.doc(`${T}/retailOrders/o1`).set({ addressPaid: { cs_6: { cents: 250, pi: 'pi_byhand', at: stale, state: 'refund_failed', refundWhy: 'kept', refundTries: 2, refundTriedAt: stale } }, addressPaidOpen: true, addressPaidRetry: true }, { merge: true });
  refundedByHand = true;
  await sweepAddressPays(db, 't1', await get(T));
  o = await order();
  check('one the team refunded in Stripe by hand meanwhile is written down as refunded (and in the books), not tried forever', o.addressPaid.cs_6.refundedAt && o.addressPaid.cs_6.refundedOutside === true && o.addressPaidRetry === false && (await all(`${T}/transactions`)).some((x: any) => x.category === 'Refund' && x.amount === 2.5));
  refundedByHand = false;

  console.log('The second review');
  await fresh({}, { addressCostPayer: 'customer' });
  q = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  sid = (await order()).addressPay.sessionId;
  await db.doc(`${T}/retailOrders/o1`).set({ labelUrl: 'https://label.test/1' }, { merge: true });
  paySession(sid, 'pi_b'); await ss({ action: 'address_paid', sessionId: sid });
  r = await ss({ action: 'update_address', address: CLOSE });
  o = await order();
  check('a paid change waiting for the shop isn’t replaced by another (a second tab or an old page): the customer is told to message the shop', r.status === 409 && /waiting for the shop/.test(r.body.error) && o.addressRequest?.paid?.sessionId === sid && o.addressRequest?.to?.postalCode === '10001', { body: r.body, req: o.addressRequest });
  r = await team({ action: 'keep_old', reason: 'Label printed' });
  check('…so keeping the old address still refunds what they paid for it', stripeCalls.refunds.some((x) => x.payment_intent === 'pi_b' && x.amount === 320));
  await fresh({}, {});
  const old2 = new Date(Date.now() - 30 * 60000).toISOString();
  await db.doc(`${T}/retailOrders/o1`).set({ addressPay: { id: 'ap2', status: 'awaiting_payment', sessionId: 'cs_live', at: old2, cents: 320 }, addressPaid: { cs_old: { cents: 320, pi: 'pi_old', at: old2, state: 'replaced' } }, addressPaidOpen: true, addressPaidRetry: true }, { merge: true });
  sessions.cs_old = { id: 'cs_old', payment_status: 'paid', status: 'complete', payment_intent: 'pi_old', amount_total: 320, metadata: { type: 'address_change', tenantId: 't1', retailOrderId: 'o1', payId: 'apX' } };
  sessions.cs_live = { id: 'cs_live', payment_status: 'unpaid', status: 'open', amount_total: 320, metadata: { type: 'address_change', tenantId: 't1', retailOrderId: 'o1', payId: 'ap2' } };
  let f2 = await finishAddressPay(db, 't1', 'o1', 'cs_old', { session: sessions.cs_old });
  check('a replaced page whose refund never ran: asking again says it will be refunded (never “the address is on”)', f2.result === 'refund_failed' && /refund/.test(f2.message), f2);
  await sweepAddressPays(db, 't1', await get(T), { now: Date.now() + 15 * 60000 });
  o = await order();
  check('…and the five-minute check refunds it', stripeCalls.refunds.some((x) => x.payment_intent === 'pi_old' && x.amount === 320) && o.addressPaid.cs_old.refundedAt && o.addressPaidRetry === false, { refunds: stripeCalls.refunds, e: o.addressPaid.cs_old });
  await fresh({}, { addressCostPayer: 'customer' });
  const p1 = await payFor(FAR, 'pi_a'); await ss({ action: 'address_paid', sessionId: p1.sid });
  r = await ss({ action: 'update_address', address: HOME });
  check('A→B paid, then back home: free', r.body.applied === true);
  const before = stripeCalls.sessions.length;
  r = await ss({ action: 'address_pay', address: FAR, pay: p1.q.body.pay });
  check('…the old B price from another tab can’t be paid again (it was for before the first payment)', r.status === 409 && /out of date/.test(r.body.error) && stripeCalls.sessions.length === before, r.body);
  await fresh({}, { addressCostPayer: 'customer' });
  q = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: q.body.pay });
  expireFails = true;
  r = await ss({ action: 'update_address', address: HOME, });
  o = await order();
  check('an earlier payment page that can’t be closed just now: the new change waits (paying that page later can’t put its address back over this one)', r.status === 503 && o.addressPay?.status === 'awaiting_payment' && o.shippingAddress.postalCode === '97201', { body: r.body, ap: o.addressPay?.status });
  expireFails = false;
  await fresh({}, { addressCostPayer: 'customer' });
  const p2 = await payFor(FAR, 'pi_c'); await ss({ action: 'address_paid', sessionId: p2.sid });
  o = await order();
  check('paid and on: the running total counts what they paid', o.addressCost?.customerCents === 320);
  r = await ss({ action: 'cancel', reason: 'changed_mind' });
  o = await order();
  check('…the order cancelled: the payment is refunded and the running total no longer counts it (nor any cost to the shop)', stripeCalls.refunds.some((x) => x.payment_intent === 'pi_c') && o.addressCost?.customerCents === 0 && o.addressCost?.shopCents === 0 && o.addressCost?.refundedCents === 320, { cost: o.addressCost, body: r.body });

  const tq0 = Date.now();
  const slow = await addressCostFor(db, 't1', await get(T), await order(), SLOW, { apiKey: 'shippo_test', timeoutMs: 60 });
  check('a carrier that doesn’t answer: the quote gives up in seconds (the shop decides, or covers it)', !slow.ok && Date.now() - tq0 < 2000);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
