// Checks customers changing their own details from the order page (api/retail/self-serve, lib/order-contact,
// lib/address-cost, lib/address-pay). A new email or mobile is confirmed with a code sent TO it: wrong codes, used
// codes, old codes and too many sends are refused, and an order held for review can't be changed (never said why).
// Once confirmed, the order, its follow-ups and open messages take it, and the old email is told. A new address is
// priced again for the same service: the shop's policy says who pays a difference (the shop by default, kept for its
// running total; the customer, before the change goes through; or the shop up to a limit). The customer's payment
// can't be changed on the way, puts the change on once however often it's confirmed, turns into a request if the
// label was bought meanwhile, and is refunded if the order had already gone out. The team approving a request counts
// its cost; keeping the old address refunds what the customer paid.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/customer-self-service.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
let db = makeDb();
let sent: any[] = [];
let sendOk = true;
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const stripeCalls = { sessions: [] as any[], expired: [] as string[], refunds: [] as any[] };
let sessions: Record<string, any> = {};
function StripeMock(this: any) {
  return {
    checkout: { sessions: {
      create: async (p: any) => { const id = `cs_${stripeCalls.sessions.length + 1}`; stripeCalls.sessions.push(p); sessions[id] = { id, url: `https://pay.test/${id}`, payment_status: 'unpaid', status: 'open', amount_total: p.line_items[0].price_data.unit_amount, metadata: p.metadata, payment_intent: null }; return { ...sessions[id] }; },
      retrieve: async (id: string) => { if (!sessions[id]) throw new Error('no session'); return { ...sessions[id] }; },
      expire: async (id: string) => { stripeCalls.expired.push(id); if (sessions[id]?.payment_status === 'paid') throw new Error('already complete'); if (sessions[id]) sessions[id].status = 'expired'; return { ...(sessions[id] || {}) }; },
    } },
    refunds: { create: async (p: any, o: any) => { stripeCalls.refunds.push({ ...p, key: o?.idempotencyKey }); return { id: `re_${stripeCalls.refunds.length}` }; } },
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
  if (request === '@/lib/notify') return { sendNotification: async (_db: any, m: any) => { sent.push(m); return sendOk ? { ok: true } : { ok: false }; } };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: { name: 'Opal' } }) };
  return load.call(this, request, ...rest);
};
// Shippo: farther costs more. 97201 is the order's own address; 10001 is across the country; 97202 is next door.
const RATES: Record<string, any[]> = {
  '97201': [{ provider: 'USPS', servicelevel: { name: 'Ground Advantage' }, amount: '7.10' }, { provider: 'UPS', servicelevel: { name: 'Ground' }, amount: '9.00' }],
  '10001': [{ provider: 'USPS', servicelevel: { name: 'Ground Advantage' }, amount: '10.30' }, { provider: 'UPS', servicelevel: { name: 'Ground' }, amount: '8.40' }],
  '97202': [{ provider: 'USPS', servicelevel: { name: 'Ground Advantage' }, amount: '7.10' }],
};
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('goshippo.com/shipments')) { const b = JSON.parse(init.body); const r = RATES[b.address_to.zip]; return { ok: !!r, json: async () => (r ? { rates: r } : { detail: 'no rates' }) }; }
  return { ok: true, json: async () => ({}) };
};

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.test' } }) as any;
const HOME = { name: 'Priya Shah', line1: '12 Oak St', line2: '', city: 'Portland', state: 'OR', postalCode: '97201', country: 'US' };
const FAR = { name: 'Priya Shah', line1: '5 W 31st St', line2: 'Apt 4', city: 'New York', state: 'NY', postalCode: '10001' };
const NEAR = { name: 'Priya Shah', line1: '40 Elm St', line2: '', city: 'Portland', state: 'OR', postalCode: '97202' };
const NONE = { name: 'Priya Shah', line1: '1 Nowhere Rd', line2: '', city: 'Faraway', state: 'AK', postalCode: '99999' };
const fresh = async (o: any = {}, policies: any = {}, shippo = true) => {
  db = makeDb(); sent = []; sendOk = true; sessions = {}; stripeCalls.sessions.length = 0; stripeCalls.expired.length = 0; stripeCalls.refunds.length = 0;
  await db.doc(T).set({ name: 'Opal', businessName: 'Opal', stripeAccountId: 'acct_1', retailSettings: { shipFrom: { name: 'Opal', street1: '1 Main St', city: 'Portland', state: 'OR', zip: '97204' }, policies } });
  if (shippo) await db.doc(`${T}/private/retail`).set({ shippoApiKey: 'shippo_test' });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Cuticle oil', weightOz: 6 });
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', tenantId: 't1', orderNumber: 1210, stage: 'paid', method: 'ship', qrToken: 'qr1', customerName: 'Priya Shah', customerEmail: 'priya@example.com', customerPhone: '(503) 555-0148',
    shippingAddress: HOME, shippingCarrier: 'USPS', shippingService: 'Ground Advantage', shippingCents: 710, lines: [{ lineId: 'a', productId: 'p1', name: 'Cuticle oil', qtyOrdered: 2, qtyShorted: 0 }], ...o });
  await db.doc(`${T}/retailOrders/o2`).set({ id: 'o2', orderNumber: 1210, stage: 'paid', method: 'ship', parentOrderId: 'o1', qrToken: 'qr1', customerName: 'Priya Shah', customerEmail: 'priya@example.com', customerPhone: '5035550148' });
  await db.doc(`${T}/retailSupport/s1`).set({ orderId: 'o1', customerEmail: 'priya@example.com', status: 'open' });
};
const order = () => get(`${T}/retailOrders/o1`);

(async () => {
  const { POST: selfServe } = await import('../../src/app/api/retail/self-serve/route');
  const { POST: staffAddress } = await import('../../src/app/api/retail/address/route');
  const { costPolicy, splitCost, addressCostFor } = await import('../../src/lib/address-cost');
  const { finishAddressPay, sweepAddressPays } = await import('../../src/lib/address-pay');
  const { hideCodes } = await import('../../src/lib/code-redact');
  const ss = (body: any) => selfServe(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', ...body })) as any;
  const codeIn = (m: any) => String(m?.text || '').match(/\b(\d{6})\b/)?.[1] || '';

  // ── A new email, with a code sent to it ──
  await fresh();
  let r = await ss({ action: 'contact_code', field: 'email', value: 'Priya.New@Example.com' });
  const codesOnly = async () => (await all(`${T}/clientVerifications`)).filter((v: any) => v.purpose === 'order_contact');
  const vers = await codesOnly();
  check('a code goes to the NEW email, not the old one', r.status === 200 && r.body.verificationId && sent.length === 1 && sent[0].to === 'priya.new@example.com' && sent[0].kind === 'verify_code' && sent[0].essential === true);
  check('…and the code itself is never stored, only a fingerprint of it', vers.length === 1 && vers[0].codeHash && !JSON.stringify(vers[0]).includes(codeIn(sent[0])) && vers[0].value === 'priya.new@example.com');
  check('…and is hidden in the log the team can read', !hideCodes('verify_code', sent[0].text).includes(codeIn(sent[0])) && hideCodes('order_ready', 'Order 1210 is ready') === 'Order 1210 is ready');
  const code = codeIn(sent[0]);
  r = await ss({ action: 'contact_confirm', verificationId: r.body.verificationId, code: code === '000000' ? '111111' : '000000' });
  check('a wrong code is refused, and nothing changes', r.status === 400 && (await order()).customerEmail === 'priya@example.com' && (await codesOnly())[0].tries === 1);
  sent = [];
  r = await ss({ action: 'contact_confirm', verificationId: vers[0].id, code });
  let o: any = await order();
  check('the right code puts the new email on the order', r.status === 200 && o.customerEmail === 'priya.new@example.com', r.body);
  check('…and on its follow-up order and its open message', (await get(`${T}/retailOrders/o2`)).customerEmail === 'priya.new@example.com' && (await get(`${T}/retailSupport/s1`)).customerEmail === 'priya.new@example.com');
  check('…the new email gets the order link and the old one is told it changed on the order page', sent.some((m) => m.to === 'priya.new@example.com' && m.kind === 'contact_changed') && sent.some((m) => m.to === 'priya@example.com' && m.kind === 'contact_changed_notice' && /on your order page/.test(m.html)));
  check('…and the record says the customer did it', (await all(`${T}/retailOrders/o1/events`)).some((e: any) => e.meta?.kind === 'contact_changed' && e.meta?.selfServe === true && e.actorId === 'customer'));
  r = await ss({ action: 'contact_confirm', verificationId: vers[0].id, code });
  check('a code works once', r.status === 400);

  await fresh();
  r = await ss({ action: 'contact_code', field: 'email', value: 'new@example.com' });
  const vid = r.body.verificationId; const c1 = codeIn(sent[0]);
  for (let i = 0; i < 5; i++) await ss({ action: 'contact_confirm', verificationId: vid, code: c1 === '000000' ? '111111' : '000000' });
  r = await ss({ action: 'contact_confirm', verificationId: vid, code: c1 });
  check('five wrong tries and even the right code needs a new one', r.status === 400 && /new code/i.test(r.body.error) && (await order()).customerEmail === 'priya@example.com');
  await db.doc(`${T}/clientVerifications/${vid}`).set({ tries: 0, expiresAt: new Date(Date.now() - 60e3).toISOString() }, { merge: true });
  r = await ss({ action: 'contact_confirm', verificationId: vid, code: c1 });
  check('an old code has expired', r.status === 400 && /expired/i.test(r.body.error));
  await fresh();
  for (let i = 0; i < 5; i++) await ss({ action: 'contact_code', field: 'email', value: `n${i}@example.com` });
  r = await ss({ action: 'contact_code', field: 'email', value: 'n9@example.com' });
  check('a few codes an hour, then they wait', r.status === 429 && sent.length === 5);
  r = await ss({ action: 'contact_code', field: 'email', value: 'priya@example.com' });
  check('the email already on the order isn’t sent a code', r.status === 409 || r.status === 429);
  await fresh();
  sendOk = false;
  r = await ss({ action: 'contact_code', field: 'email', value: 'typo@example' });
  check('an address that isn’t an email is refused before anything is sent', r.status === 400 && sent.length === 0);
  r = await ss({ action: 'contact_code', field: 'email', value: 'real@example.com' });
  check('a code that couldn’t be sent says so', r.status === 429 && /couldn’t send/.test(r.body.error));
  await fresh();
  await db.doc(`${T}/retailOrders/o2`).set({ holdForReview: true }, { merge: true });
  r = await ss({ action: 'contact_code', field: 'email', value: 'thief@example.com' });
  check('an order with a follow-up held for review can’t be changed from the page, and why isn’t said', r.status === 409 && /message on this page/.test(r.body.error) && !/review|held/i.test(r.body.error) && sent.length === 0);

  // ── A new mobile, and texts on or off ──
  await fresh({ textsOff: true });
  r = await ss({ action: 'contact_code', field: 'phone', value: '(971) 555-0199' });
  check('a code for a new mobile is texted to the new number', r.status === 200 && sent[0]?.channel === 'sms' && sent[0]?.to === '(971) 555-0199' && /ending in 0199/.test(r.body.message));
  const pc = codeIn(sent[0]); sent = [];
  r = await ss({ action: 'contact_confirm', verificationId: r.body.verificationId, code: pc });
  o = await order();
  check('confirmed: the new mobile is on the order, with texts on (that’s what it was added for)', r.status === 200 && o.customerPhone === '(971) 555-0199' && o.textsOff === false);
  check('…and the email is told the mobile changed', sent.some((m) => m.channel === 'email' && m.to === 'priya@example.com' && /mobile/.test(m.subject)));
  r = await ss({ action: 'texts', off: true });
  check('texts can be turned off with one tap', r.status === 200 && (await order()).textsOff === true && (await get(`${T}/retailOrders/o2`)).textsOff === true);
  await fresh({ customerPhone: '' });
  r = await ss({ action: 'texts', off: false });
  check('…and can’t be turned on with no mobile', r.status === 400);

  // ── What a new address costs, and who pays ──
  check('by default the shop covers a difference (as before), with a $2 limit ready if it chooses one', costPolicy({}).payer === 'shop' && costPolicy({}).limitCents === 200);
  check('who pays: the shop, the customer, or the shop up to a limit and the customer the rest',
    JSON.stringify(splitCost(320, { payer: 'shop', limitCents: 200 })) === JSON.stringify({ shopCents: 320, customerCents: 0 })
    && JSON.stringify(splitCost(320, { payer: 'customer', limitCents: 200 })) === JSON.stringify({ shopCents: 0, customerCents: 320 })
    && JSON.stringify(splitCost(320, { payer: 'shop_up_to', limitCents: 200 })) === JSON.stringify({ shopCents: 200, customerCents: 120 })
    && JSON.stringify(splitCost(150, { payer: 'shop_up_to', limitCents: 200 })) === JSON.stringify({ shopCents: 150, customerCents: 0 })
    && JSON.stringify(splitCost(-90, { payer: 'customer', limitCents: 200 })) === JSON.stringify({ shopCents: 0, customerCents: 0 }));
  await fresh();
  let t: any = await get(T);
  let cost: any = await addressCostFor(db, 't1', t, await order(), FAR, { apiKey: 'shippo_test' });
  check('the same service is priced to both addresses: $7.10 to $10.30 is $3.20 more', cost.ok && cost.diffCents === 320 && cost.fromCents === 710 && cost.toCents === 1030 && cost.service === 'Ground Advantage');
  cost = await addressCostFor(db, 't1', t, { ...(await order()), shippingService: 'Free shipping', shippingCarrier: '' }, FAR, { apiKey: 'shippo_test' });
  check('free shipping: the cheapest at each address, which is what the shop buys ($7.10 to $8.40)', cost.ok && cost.diffCents === 130);
  cost = await addressCostFor(db, 't1', { ...t, retailSettings: { ...t.retailSettings, shippingMarkupPercent: 10 } }, await order(), FAR, { apiKey: 'shippo_test' });
  check('the shop’s shipping markup applies to both', cost.ok && cost.diffCents === 1133 - 781);
  cost = await addressCostFor(db, 't1', t, await order(), FAR, { apiKey: '' });
  check('a shop with no carrier account charges a flat rate, which no address changes', cost.ok && cost.diffCents === 0 && cost.flat === true);
  cost = await addressCostFor(db, 't1', t, await order(), NONE, { apiKey: 'shippo_test' });
  check('no rates for the new address: the cost is unknown, not zero', !cost.ok);

  // ── The shop covers it ──
  await fresh();
  r = await ss({ action: 'update_address', address: FAR });
  o = await order();
  check('the shop covers it by default: the change goes straight on, and its $3.20 is kept for the running total', r.status === 200 && r.body.applied && o.shippingAddress.postalCode === '10001' && o.addressCost?.shopCents === 320 && o.addressCost?.customerCents === 0, { body: r.body, cost: o.addressCost });
  await fresh();
  r = await ss({ action: 'update_address', address: NEAR });
  o = await order();
  check('an address that costs the same changes nothing about money', r.body.applied && o.shippingAddress.postalCode === '97202' && !o.addressCost);
  await fresh({}, { addressCostPayer: 'shop_up_to', addressCostLimitCents: 500 });
  r = await ss({ action: 'update_address', address: FAR });
  check('up to a limit of $5: a $3.20 difference is all the shop’s', r.body.applied && (await order()).addressCost?.shopCents === 320);

  // ── The customer pays ──
  await fresh({}, { addressCostPayer: 'shop_up_to', addressCostLimitCents: 200 });
  r = await ss({ action: 'update_address', address: FAR });
  o = await order();
  check('over the limit: the customer is shown the shop’s share and theirs, and nothing changes yet', r.status === 200 && r.body.needsPayment && r.body.pay.cents === 120 && r.body.pay.shopCents === 200 && /covers \$2\.00/.test(r.body.message) && o.shippingAddress.postalCode === '97201');
  const pay = r.body.pay;
  r = await ss({ action: 'address_pay', address: FAR, pay: { ...pay, cents: 1 } });
  check('a price changed on the way is refused', r.status === 409 && stripeCalls.sessions.length === 0);
  r = await ss({ action: 'address_pay', address: NEAR, pay });
  check('…and so is the price for one address used for another', r.status === 409 && stripeCalls.sessions.length === 0);
  r = await ss({ action: 'address_pay', address: FAR, pay });
  o = await order();
  check('paying opens Stripe’s page for their $1.20, on the shop’s account, and the change waits', r.status === 200 && r.body.url && stripeCalls.sessions[0]?.line_items[0].price_data.unit_amount === 120 && stripeCalls.sessions[0]?.metadata?.type === 'address_change' && o.addressPay?.status === 'awaiting_payment' && o.shippingAddress.postalCode === '97201');
  const sid = o.addressPay.sessionId;
  r = await ss({ action: 'address_paid', sessionId: sid });
  check('back before the payment is confirmed: still waiting, nothing changes', r.body.result === 'pending' && (await order()).shippingAddress.postalCode === '97201');
  sessions[sid].payment_status = 'paid'; sessions[sid].status = 'complete'; sessions[sid].payment_intent = 'pi_addr1';
  r = await ss({ action: 'address_paid', sessionId: sid });
  o = await order();
  check('paid: the new address goes on, with what each side paid', r.body.result === 'applied' && o.shippingAddress.postalCode === '10001' && o.addressCost?.shopCents === 200 && o.addressCost?.customerCents === 120 && o.addressPay?.status === 'applied', { body: r.body, o: o.addressCost });
  let incomes = (await all(`${T}/transactions`)).filter((x: any) => x.addressChangeSessionId === sid);
  check('…and their $1.20 is shipping income', incomes.length === 1 && incomes[0].amount === 1.2 && incomes[0].type === 'income' && incomes[0].retailOrderId === 'o1');
  const f = await finishAddressPay(db, 't1', 'o1', sid, { session: sessions[sid] });
  r = await ss({ action: 'address_paid', sessionId: sid });
  incomes = (await all(`${T}/transactions`)).filter((x: any) => x.addressChangeSessionId === sid);
  check('Stripe’s notice and a second return change nothing more', f.result === 'applied' && r.body.result === 'applied' && incomes.length === 1 && (await all(`${T}/retailOrders/o1/events`)).filter((e: any) => e.type === 'address_updated').length === 1);

  await fresh({}, { addressCostPayer: 'customer' });
  r = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: r.body.pay });
  let s2 = (await order()).addressPay.sessionId;
  await db.doc(`${T}/retailOrders/o1`).set({ labelUrl: 'https://label.test/1', shippoTransactionId: 'tx1' }, { merge: true });
  sessions[s2] = { ...sessions[s2], payment_status: 'paid', status: 'complete', payment_intent: 'pi_addr2' };
  r = await ss({ action: 'address_paid', sessionId: s2 });
  o = await order();
  check('the label was bought while they paid: it goes to the shop as a request, carrying their payment', r.body.result === 'requested' && o.addressRequest?.status === 'waiting' && o.addressRequest?.paid?.cents === 320 && o.shippingAddress.postalCode === '97201');

  // The team keeps the old address: their payment goes back.
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  await db.doc(`${T}/retailOrders/o1`).set({ labelUrl: null, shippoTransactionId: null }, { merge: true });
  r = await staffAddress(req({ tenantId: 't1', orderId: 'o1', action: 'keep_old', reason: 'It’s already packed' }));
  check('keeping the old address refunds what they paid for the new one, to their card', r.status === 200 && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_addr2' && x.amount === 320) && /refunded/.test(r.body.message), r.body);
  const told = (await all(`${T}/retailOrders/o1/inbox`)).filter((m: any) => m.kind === 'address_reply');
  check('…and the customer is told on their order page', told.some((m: any) => /refunded/.test(JSON.stringify(m))), told);

  await fresh({}, { addressCostPayer: 'customer' });
  r = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: r.body.pay });
  s2 = (await order()).addressPay.sessionId;
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'shipped' }, { merge: true });
  sessions[s2] = { ...sessions[s2], payment_status: 'paid', status: 'complete', payment_intent: 'pi_addr3' };
  r = await ss({ action: 'address_paid', sessionId: s2 });
  check('it had already gone out: the address can’t change, and the payment is refunded straight away', r.body.result === 'refunded' && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_addr3') && (await order()).shippingAddress.postalCode === '97201');
  const lines = (await all(`${T}/transactions`)).filter((x: any) => x.retailOrderId === 'o1');
  check('…and the books show it in and back out', lines.some((x: any) => x.type === 'income' && x.amount === 3.2) && lines.some((x: any) => x.type === 'expense' && x.category === 'Refund' && x.amount === 3.2));

  await fresh({}, { addressCostPayer: 'customer' });
  r = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: r.body.pay });
  s2 = (await order()).addressPay.sessionId;
  r = await ss({ action: 'address_pay_cancel' });
  check('keeping their address closes the payment page', r.body.result === 'cancelled' && stripeCalls.expired.includes(s2) && (await order()).addressPay.status === 'cancelled');

  await fresh({}, { addressCostPayer: 'customer' });
  r = await ss({ action: 'update_address', address: NONE });
  o = await order();
  check('the cost can’t be checked and the customer could owe it: it goes to the shop to decide', r.body.requested && o.addressRequest?.why === 'cost' && o.shippingAddress.postalCode === '97201');

  // The team approves a request: its cost counts toward what the shop covered.
  await fresh({ labelUrl: 'x', shippoTransactionId: null, trackingNumber: null });
  await db.doc(`${T}/retailOrders/o1`).set({ labelUrl: null }, { merge: true });
  await db.doc(T).set({ retailSettings: { shipFrom: { name: 'Opal', street1: '1 Main St', city: 'Portland', state: 'OR', zip: '97204' }, policies: { addressChangeUntil: 'never' } } }, { merge: true });
  r = await ss({ action: 'update_address', address: FAR });
  o = await order();
  check('a change after the cutoff is a request, carrying what it would cost', r.body.requested && o.addressRequest?.cost?.diffCents === 320);
  r = await staffAddress(req({ tenantId: 't1', orderId: 'o1', action: 'approve_change' }));
  o = await order();
  check('approving it puts it on, and the $3.20 counts as covered by the shop', r.status === 200 && o.shippingAddress.postalCode === '10001' && o.addressCost?.shopCents === 320 && o.addressCost?.approvedBy === 'Ana Ruiz', r.body);

  // A shop that takes changes by message only.
  await fresh({}, { addressChangeUntil: 'off' });
  r = await ss({ action: 'update_address', address: FAR });
  check('a shop that doesn’t take address changes online refuses them here', r.status === 409 && (await order()).shippingAddress.postalCode === '97201');

  // ── Nobody came back from paying ──
  await fresh({}, { addressCostPayer: 'customer' });
  r = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: r.body.pay });
  s2 = (await order()).addressPay.sessionId;
  sessions[s2] = { ...sessions[s2], payment_status: 'paid', status: 'complete', payment_intent: 'pi_addr4' };
  await db.doc(`${T}/retailOrders/o1`).set({ addressPay: { at: new Date(Date.now() - 10 * 60000).toISOString() } }, { merge: true });
  await sweepAddressPays(db, 't1', await get(T));
  check('the five-minute check puts a paid change on when they never came back', (await order()).shippingAddress.postalCode === '10001');
  await fresh({}, { addressCostPayer: 'customer' });
  r = await ss({ action: 'update_address', address: FAR });
  await ss({ action: 'address_pay', address: FAR, pay: r.body.pay });
  s2 = (await order()).addressPay.sessionId;
  await db.doc(`${T}/retailOrders/o1`).set({ addressPay: { at: new Date(Date.now() - 3 * 3600e3).toISOString() } }, { merge: true });
  await sweepAddressPays(db, 't1', await get(T));
  check('…and closes one never paid after a couple of hours', (await order()).addressPay.status === 'cancelled' && stripeCalls.expired.includes(s2));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
