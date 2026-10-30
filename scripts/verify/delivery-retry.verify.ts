// scripts/verify/delivery-retry.verify.ts — Delivery D2, round 2: when a delivery couldn't be made, the customer's three
// choices on their order page (mockup 7B) and the shop's second-try rule (7C), run for real against the stand-in
// database and a stand-in Stripe:
//  - another try: free (booked at once, if the window has room) or the order's delivery fee again by whose side it
//    failed on; a paid try holds its place while they pay, goes on once whichever way the payment is confirmed, and
//    gives the place back when the page is left or lapses; paid after the shop sent it out again, or on a page another
//    replaced, it's refunded
//  - pick it up: a pickup order with their code; the delivery fee for a try that failed on the shop's side goes back
//  - cancel: their items back whatever the cancellation policy, the delivery fee kept when it was their side (and kept
//    out of the tip), back when it was the shop's
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/delivery-retry.verify.ts
import fs from 'fs';
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.CRON_SECRET = 'test-secret';
process.env.ORDER_PASS_SECRET = process.env.ORDER_PASS_SECRET || 'pass-secret';
let db: any = strictTransactions(makeDb());
const stripeCalls = { sessions: [] as any[], expired: [] as string[], refunds: [] as any[] };
let sessions: Record<string, any> = {};
let pis: Record<string, any> = {};
function StripeMock(this: any) {
  return {
    paymentIntents: { retrieve: async (id: string) => { if (!pis[id]) throw new Error('no such payment'); return { id, metadata: pis[id] }; } },
    checkout: { sessions: {
      create: async (p: any) => { const id = `cs_${stripeCalls.sessions.length + 1}`; stripeCalls.sessions.push(p); sessions[id] = { id, url: `https://pay.test/${id}`, payment_status: 'unpaid', status: 'open', amount_total: p.line_items[0].price_data.unit_amount, metadata: p.metadata, payment_intent: null }; return { ...sessions[id] }; },
      retrieve: async (id: string) => { if (!sessions[id]) throw new Error('no session'); return { ...sessions[id] }; },
      expire: async (id: string) => { stripeCalls.expired.push(id); if (sessions[id]?.payment_status === 'paid') throw new Error('already complete'); if (sessions[id]) sessions[id].status = 'expired'; return { ...(sessions[id] || {}) }; },
    } },
    refunds: { create: async (p: any, o: any) => { stripeCalls.refunds.push({ ...p, key: o?.idempotencyKey }); return { id: `re_${stripeCalls.refunds.length}`, amount: p.amount, status: 'succeeded' }; }, list: async () => ({ data: [] }) },
  };
}
const M: any = Module as any;
const load = M._load;
const afterJobs: Promise<any>[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn).catch(() => null)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-retail-selfserve' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/request-forensics') return { requestForensics: () => null };
  if (request === '@/lib/order-tracking') return { syncTracking: async () => {}, putTracking: async () => {}, trackingKey: () => '' };
  if (request === '@/lib/notify') return { sendNotification: async () => ({ ok: true }) };
  if (request === '@/lib/email-shell') return { brandedEmail: (_b: any, html: string) => html, emailButton: (link: string) => `<a href="${link}">`, getEmailBrand: async () => ({ shopName: 'Opal' }) };
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return { verifyStaffActor: async () => ({ ok: true, actor: { uid: 'riley', name: 'Riley Chen', role: 'staff', isManager: false, isTenantOwner: false, caps: [] }, tenant: {} }) };
  if (request === '@/lib/message-policy' || /\/src\/lib\/message-policy(\.ts)?$/.test(request)) return { gateMessage: async () => ({ send: true }) };
  return load.call(this, request, ...rest);
};
const calls: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => { calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.test', searchParams: new URLSearchParams() } }) as any;
const PLAN = {
  on: true, by: 'postal', days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: '10:00', end: '12:00' }, { start: '14:00', end: '16:00' }, { start: '18:00', end: '20:00' }], perWindow: 1, perDriver: null, drivers: [],
  sameDayCutoff: null, daysAhead: 3, asap: { on: false, minutes: 90 }, dropoffNotes: true,
  zones: [{ id: 'a', name: 'Close', postalCodes: ['97204'], feeCents: 600, minimumCents: 0, freeOverCents: null, expressCents: null, on: true }],
  vehicles: {}, proof: { photo: 'left', pinOverCents: null },
};
// Items $40.00, tax $6.00, delivery $6.00, a $5.00 tip: $57.00 on the card.
const ORDER = { tenantId: 't1', orderNumber: 1214, method: 'delivery', stage: 'ready', readyAt: new Date(Date.now() - 3 * 864e5).toISOString(), qrToken: 'qr1', customerName: 'Ana Ruiz', customerEmail: 'ana@example.com',
  subtotalCents: 4000, taxCents: 600, shippingCents: 600, tipCents: 500, totalCents: 5700, chargedCents: 5700, refundedCents: 0, stripePaymentIntentId: 'pi_main', paidAt: new Date().toISOString(),
  shippingAddress: { line1: '88 Pine St', city: 'Portland', state: 'OR', postalCode: '97204' }, deliveryWindowKey: '2026-10-30D10:00',
  lines: [{ lineId: 'A', productId: 'gel', name: 'Gel', qtyOrdered: 1, qtyShorted: 0, unitPriceCents: 4000 }],
  delivery: { zoneId: 'a', zoneName: 'Close', feeCents: 600, expressCents: 0, free: false, window: { key: '2026-10-30D10:00', label: 'Fri Oct 30, 10 am–12 pm' }, status: 'failed', tries: 1,
    failedAt: new Date().toISOString(), failReason: 'No one answered', failCode: 'no_answer', failCause: 'customer' } };
const fresh = async (o: any = {}, plan: any = {}, rs: any = {}) => {
  db = strictTransactions(makeDb()); sessions = {}; pis = { pi_7: { type: 'delivery_retry', retailOrderId: 'o1' } }; stripeCalls.sessions.length = 0; stripeCalls.expired.length = 0; stripeCalls.refunds.length = 0; calls.length = 0;
  await db.doc(T).set({ name: 'Opal', businessName: 'Opal Studio', timezone: 'America/Los_Angeles', stripeAccountId: 'acct_1', retailSettings: { deliveryPlan: { ...PLAN, ...plan }, prepMinutes: 30, ...rs } });
  await db.doc(`${T}/inventory/gel`).set({ name: 'Gel', stock: 5, stockReserved: 1 });
  await db.doc(`${T}/retailOrders/o1`).set({ ...JSON.parse(JSON.stringify(ORDER)), id: 'o1', ...o, delivery: { ...ORDER.delivery, ...(o.delivery || {}) } });
};
const order = () => get(`${T}/retailOrders/o1`);
const paySession = (sid: string, pi: string) => { sessions[sid] = { ...sessions[sid], payment_status: 'paid', status: 'complete', payment_intent: pi }; pis[pi] = { type: 'delivery_retry', retailOrderId: sessions[sid].metadata.retailOrderId }; };

(async () => {
  const R = await import('../../src/lib/delivery-retry');
  const { cleanDelivery } = await import('../../src/lib/delivery-plan');
  const { refundTipPart } = await import('../../src/lib/refund-tax');
  const { makePass } = await import('../../src/lib/order-pass');
  const { POST: CHOICE } = await import('../../src/app/api/retail/delivery-choice/route');
  const { POST: SELF } = await import('../../src/app/api/retail/self-serve/route');
  const S = await import('../../src/lib/delivery-retry-server');
  const pass = makePass('t1', 'qr1');
  const choose = async (b: any, withPass = true) => { const r: any = await CHOICE(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', ...(withPass ? { pass } : {}), ...b })); await settle(); return r; };

  console.log('the rules');
  check('the second-try rule: charge on the customer’s side, free on the shop’s, unless the shop says otherwise',
    JSON.stringify(cleanDelivery({}).secondTry) === JSON.stringify({ customer: 'charge', shop: 'free' }) && JSON.stringify(cleanDelivery({ secondTry: { customer: 'free', shop: 'charge' } }).secondTry) === JSON.stringify({ customer: 'free', shop: 'charge' })
    && JSON.stringify(cleanDelivery({ secondTry: { customer: 'x', shop: 'y' } }).secondTry) === JSON.stringify({ customer: 'charge', shop: 'free' }));
  const plan0 = cleanDelivery(PLAN);
  const theirs = { ...ORDER }; const ours = { ...ORDER, delivery: { ...ORDER.delivery, failCode: 'unsafe', failCause: 'shop' } };
  check('another try costs the order’s own delivery fee on their side, nothing on ours', R.retryCents(theirs, plan0) === 600 && R.retryCents(ours, plan0) === 0
    && R.retryCents(theirs, { secondTry: { customer: 'free', shop: 'free' } }) === 0 && R.retryCents(ours, { secondTry: { customer: 'charge', shop: 'charge' } }) === 600);
  check('never the “within minutes” charge, and too little to pay by card is free', R.retryCents({ ...theirs, delivery: { ...theirs.delivery, feeCents: 600, expressCents: 900 } }, plan0) === 600 && R.retryCents({ ...theirs, delivery: { ...theirs.delivery, feeCents: 40 } }, plan0) === 0);
  const w = R.choiceWords(theirs, plan0, { cardCents: 5700, pickup: true });
  check('the words, as the mockup: the fee again because no one was home', w.retry === '$6.00 delivery fee again, because no one was home.', w.retry);
  check('…pick it up free with their code', w.pickup === 'Free, ready now. Bring your pickup code.', w.pickup);
  check('…cancel: the items (and the tip) back, the delivery fee kept', w.cancel === '$51.00 for your items and the tip back to your card. The $6.00 delivery fee isn’t refunded.', w.cancel);
  check('…and trying again is free when it fails on our side', w.footer === 'If a delivery fails on our side, trying again is free.' && R.choiceWords(theirs, { secondTry: { customer: 'charge', shop: 'charge' } }, { cardCents: 0, pickup: true }).footer === null);
  const wo = R.choiceWords(ours, plan0, { cardCents: 5700, pickup: true });
  check('on our side: another try free, the fee back with a pickup or a cancellation', wo.retry === 'Free. Choose a time below.' && wo.pickup === 'Free, ready now. Your $6.00 delivery fee goes back to your card.' && wo.cancel === '$51.00 for your items and the tip back to your card, with the $6.00 delivery fee.', wo);
  check('no pickup offered when the shop doesn’t do pickup', R.choiceWords(theirs, plan0, { cardCents: 0, pickup: false }).pickup === null);
  check('why it failed is said only with their pass', R.choiceWords(theirs, plan0, { cardCents: 5700, pickup: true, withWhy: false }).retry === '$6.00 delivery fee again.');
  const twice = { ...ours, deliveryRetryPaid: { cs_7: { cents: 600, state: 'applied' } }, delivery: { ...ours.delivery, feeFor: { cents: 600, from: 'cs_7' } } };
  check('a paid try that failed on our side: that try’s fee back, the earlier one said as kept', R.choiceWords(twice, plan0, { cardCents: 5700, pickup: true }).cancel === '$51.00 for your items and the tip back to your card, with the $6.00 delivery fee for the last try. The $6.00 for the earlier try isn’t refunded.', R.choiceWords(twice, plan0, { cardCents: 5700, pickup: true }).cancel);
  check('paid partly by gift card: no one card amount is promised', R.choiceWords({ ...theirs, giftCardCents: 5000 }, plan0, { cardCents: 700, pickup: true }).cancel === 'Your items and the tip go back the way you paid. The $6.00 delivery fee isn’t refunded.', R.choiceWords({ ...theirs, giftCardCents: 5000 }, plan0, { cardCents: 700, pickup: true }).cancel);
  check('never more kept than the card has left', R.choiceWords(theirs, plan0, { cardCents: 300, pickup: true }).cancel.endsWith('The $3.00 delivery fee isn’t refunded.'));
  check('a delivery fee already given back isn’t kept or given back again', R.keptFromCard({ ...theirs, shippingRefundedCents: 600 }) === 0 && R.feeOnTry({ ...ours, shippingRefundedCents: 600 }) === null && R.keptFromCard({ ...theirs, deliveryFeeBackHandCents: 600 }) === 0
    && R.feeOnTry({ ...ours, shippingRefundedCents: 600, delivery: { ...ours.delivery, feeFor: { cents: 600, from: 'order' } } }) === null);
  check('a window in a sentence: today and tomorrow in lower case, a date as it is', R.whenInSentence('Today 5–7 pm') === 'today 5–7 pm' && R.whenInSentence('Sat Nov 1, 2–4 pm') === 'Sat Nov 1, 2–4 pm');
  check('the fee that goes with each try: the order’s, a paid try’s own, carried to a free try after our failure, none after theirs',
    R.feeOnTry(theirs)?.from === 'order' && R.feeForNext(theirs, { cents: 600, from: 'cs_9' })?.from === 'cs_9' && R.feeForNext(ours, null)?.from === 'order' && R.feeForNext(theirs, null) === null
    && R.feeOnTry({ ...theirs, delivery: { ...theirs.delivery, feeFor: null } }) === null);
  check('the tip isn’t taken for a kept delivery fee: a cancellation keeping $6.00 gives the whole $5.00 tip back',
    refundTipPart({ ...ORDER, deliveryFeeKeptCents: 600 }, 5100) === 500 && refundTipPart({ ...ORDER }, 5100) === 0);

  // ── Another try, free (it failed on our side)
  console.log('another try');
  await fresh({ delivery: { failCode: 'unsafe', failCause: 'shop', failReason: 'Not safe to leave it here' } });
  let r: any = await choose({ action: 'windows' }, false);
  check('the open windows come with the order’s link alone', r.status === 200 && r.body.windows.length > 0 && r.body.cents === 0, r.body);
  const k1 = r.body.windows[0].key; const k2 = r.body.windows[1]?.key;
  r = await choose({ action: 'retry', key: k1 }, false);
  check('booking a try needs their pass too', r.status === 401 && r.body.code === 'pass_needed');
  r = await choose({ action: 'retry', key: 'nope' });
  check('a time that isn’t open is refused', r.status === 409);
  r = await choose({ action: 'retry', key: k1 });
  let o: any = await order();
  check('free on our side: booked at once, waiting to go out again in that window', r.status === 200 && r.body.booked && o.delivery.status === 'waiting' && o.deliveryWindowKey === k1 && o.delivery.window.key === k1 && o.delivery.readyBy === o.delivery.window.start, { b: r.body, d: o.delivery });
  check('the try that failed is kept as the last one, and the order’s fee carries to this one', o.delivery.lastFail?.code === 'unsafe' && o.delivery.lastFail?.try === 1 && !o.delivery.failCode && o.delivery.feeFor?.from === 'order' && o.delivery.retry?.cents === 0, o.delivery);
  const notes = await all(`${T}/notifications`);
  check('the team hears what they chose', notes.some((n: any) => n.type === 'delivery_choice' && /another try for order #1214/.test(n.message)), notes);
  r = await choose({ action: 'retry', key: k2 });
  check('once booked, it can’t be booked again', r.status === 409);

  // A full window.
  await db.doc(`${T}/retailOrders/other`).set({ ...ORDER, id: 'other', orderNumber: 1300, qrToken: 'qx', stage: 'paid', deliveryWindowKey: k1, delivery: { ...ORDER.delivery, status: 'waiting' } });
  await db.doc(`${T}/retailOrders/o1`).set({ ...(await order()), delivery: { ...ORDER.delivery }, deliveryWindowKey: ORDER.deliveryWindowKey });
  r = await choose({ action: 'windows' });
  check('a window another order filled isn’t offered', !r.body.windows.some((x: any) => x.key === k1), r.body.windows);

  // ── Another try, paid (it failed on their side)
  console.log('a paid try');
  await fresh();
  r = await choose({ action: 'windows' });
  check('on their side another try is the delivery fee', r.body.cents === 600);
  const p1 = r.body.windows[0].key;
  r = await choose({ action: 'retry', key: p1 });
  o = await order();
  check('a Stripe page (cards only, on the shop’s account) for the fee', r.status === 200 && r.body.url === 'https://pay.test/cs_1' && stripeCalls.sessions[0].payment_method_types.join() === 'card' && stripeCalls.sessions[0].line_items[0].price_data.unit_amount === 600 && stripeCalls.sessions[0].metadata.type === 'delivery_retry', r.body);
  check('its place in the window is held while they pay, and nothing else changes yet', o.deliveryWindowKey === p1 && o.delivery.status === 'failed' && o.delivery.retryPay.status === 'awaiting_payment' && o.delivery.retryPay.prevKey === ORDER.deliveryWindowKey, o.delivery);
  await db.doc(`${T}/retailOrders/x2`).set({ ...ORDER, id: 'x2', orderNumber: 1301, qrToken: 'q2', delivery: { ...ORDER.delivery } });
  const other = await S.chooseRetry(db, 't1', await get(T), 'x2', p1, 'https://shop.test');
  check('nobody else can take the held place', !other.ok && (other as any).status === 409, other);
  paySession('cs_1', 'pi_r1');
  r = await choose({ action: 'retry_paid', sessionId: 'cs_1' }, false);
  o = await order();
  check('paid: the try is booked in that window, the payment written once', r.body.result === 'applied' && o.delivery.status === 'waiting' && o.delivery.window.key === p1 && o.deliveryRetryPaid?.cs_1?.state === 'applied' && o.delivery.feeFor?.from === 'cs_1' && o.delivery.retry.cents === 600, { b: r.body, d: o.delivery });
  const inc = await get(`${T}/transactions/delivretry_cs_1`);
  check('…and it’s delivery income in the books', inc?.type === 'income' && inc.amount === 6 && inc.shippingCollected === 6, inc);
  r = await choose({ action: 'retry_paid', sessionId: 'cs_1' }, false);
  const again = await S.finishRetryPay(db, 't1', 'o1', 'cs_1', { session: sessions.cs_1 });
  check('the return, Stripe’s notice and the five-minute check can all arrive: it goes on once', r.body.result === 'applied' && again.result === 'applied' && (await order()).delivery.tries === 1 && stripeCalls.refunds.length === 0);

  // Left the page: the place goes back.
  await fresh();
  r = await choose({ action: 'windows' }); const p2 = r.body.windows[0].key;
  await choose({ action: 'retry', key: p2 });
  r = await choose({ action: 'retry_cancel' });
  o = await order();
  check('left the payment page: closed, nothing charged, and the place goes back', r.body.result === 'cancelled' && stripeCalls.expired.includes('cs_1') && o.delivery.retryPay.status === 'cancelled' && o.deliveryWindowKey === ORDER.deliveryWindowKey && o.delivery.status === 'failed', o);
  // A page that lapses is closed by the five-minute check.
  await choose({ action: 'retry', key: p2 });
  sessions.cs_2.status = 'expired';
  await db.doc(`${T}/retailOrders/o1`).update({ 'delivery.retryPay.at': new Date(Date.now() - 40 * 60000).toISOString() });
  await S.sweepRetryPays(db, 't1', await get(T));
  o = await order();
  check('a page nobody came back from lapses: the five-minute check gives the place back', o.delivery.retryPay.status === 'expired' && o.deliveryWindowKey === ORDER.deliveryWindowKey, o.delivery.retryPay);

  // Paid after the shop sent it out again: refunded.
  await fresh();
  r = await choose({ action: 'windows' }); const p3 = r.body.windows[0].key;
  await choose({ action: 'retry', key: p3 });
  await db.doc(`${T}/retailOrders/o1`).update({ 'delivery.status': 'out', 'delivery.tries': 2 });
  paySession('cs_1', 'pi_r3');
  r = await choose({ action: 'retry_paid', sessionId: 'cs_1' }, false);
  o = await order();
  check('paid after the shop had sent it out again: refunded, and the place goes back', r.body.result === 'refunded' && /sent it out again/.test(r.body.message) && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_r3' && x.amount === 600) && o.deliveryRetryPaid.cs_1.refundedAt && o.deliveryWindowKey === ORDER.deliveryWindowKey, { b: r.body, o: o.deliveryRetryPaid });
  check('…with the refund in the books', (await get(`${T}/transactions/delivretryrefund_cs_1`))?.type === 'expense');

  // A page another replaced, paid anyway (a second tab): refunded.
  await fresh();
  r = await choose({ action: 'windows' }); const p4 = r.body.windows[0].key; const p5 = r.body.windows[1].key;
  await choose({ action: 'retry', key: p4 });
  await choose({ action: 'retry', key: p5 });
  o = await order();
  check('a second page replaces the first, and the first is closed', o.delivery.retryPay.sessionId === 'cs_2' && o.deliveryWindowKey === p5 && o.delivery.retryPay.prevKey === ORDER.deliveryWindowKey && stripeCalls.expired.includes('cs_1'), o.delivery.retryPay);
  paySession('cs_1', 'pi_old');
  r = await choose({ action: 'retry_paid', sessionId: 'cs_1' }, false);
  check('the replaced page paid anyway is refunded', r.body.result === 'refunded' && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_old'), r.body);

  // ── Pick it up
  console.log('pick it up');
  await fresh({ delivery: { failCode: 'unsafe', failCause: 'shop', failReason: 'Not safe to leave it here' } });
  r = await choose({ action: 'pickup' }, false);
  check('switching to pickup needs their pass', r.status === 401);
  r = await choose({ action: 'pickup' });
  o = await order();
  check('a pickup order now, on the ready shelf from now (the uncollected reminders count from here)', r.status === 200 && o.method === 'counter' && o.stage === 'ready' && o.delivery.status === 'pickup' && o.deliveryWindowKey === null && o.switchedFrom?.method === 'delivery' && Date.now() - Date.parse(o.readyAt) < 60000, o);
  const back = calls.find((c) => c.url.endsWith('/api/retail/refund'));
  check('on our side, the order’s delivery fee goes back as a shipping refund', o.pendingRefundCents === 600 && o.deliveryFeeBackCents === 600 && back?.body.reason === 'delivery_fee_back' && /delivery fee was refunded/.test(r.body.message), { o: { p: o.pendingRefundCents, f: o.deliveryFeeBackCents }, back, m: r.body.message });
  await fresh();
  r = await choose({ action: 'pickup' });
  o = await order();
  check('on their side, nothing comes back', r.status === 200 && !(o.pendingRefundCents > 0) && !calls.some((c) => c.url.endsWith('/api/retail/refund')) && !/refund/.test(r.body.message), { m: r.body.message });
  await fresh({}, {}, { pickupEnabled: false });
  r = await choose({ action: 'pickup' });
  check('a shop without pickup doesn’t offer it', r.status === 409);
  // A paid try that failed on our side, then pickup: that try's own payment goes back.
  await fresh({ deliveryRetryPaid: { cs_7: { cents: 600, pi: 'pi_7', at: new Date().toISOString(), state: 'applied' } }, delivery: { failCode: 'other', failCause: 'shop', failReason: 'Van broke down', feeFor: { cents: 600, from: 'cs_7' }, tries: 2 } });
  r = await choose({ action: 'pickup' });
  o = await order();
  check('a paid try that failed on our side: its own payment goes back, not the order’s fee', stripeCalls.refunds.some((x) => x.payment_intent === 'pi_7' && x.amount === 600) && o.deliveryRetryPaid.cs_7.refundedAt && !(o.pendingRefundCents > 0), o.deliveryRetryPaid);

  // ── Cancel
  console.log('cancel');
  await fresh({}, {}, { policies: { cancelAllowed: false } });
  r = await SELF(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', action: 'cancel' })); await settle();
  check('canceling a delivery that couldn’t be made needs their pass, like their other choices', r.status === 401 && r.body.code === 'pass_needed' && (await order()).stage === 'ready');
  r = await SELF(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', pass, action: 'cancel', reason: 'The delivery couldn’t be made' })); await settle();
  o = await order();
  check('cancelling a delivery that couldn’t be made works whatever the cancellation policy, while it’s on the shelf', r.status === 200 && o.stage === 'cancelled' && o.delivery.status === 'cancelled', r.body);
  check('on their side: everything back but the delivery fee, which is said', o.pendingRefundCents === 5100 && o.deliveryFeeKeptCents === 600 && /\$6\.00 delivery fee isn’t refunded/.test(r.body.message), { p: o.pendingRefundCents, m: r.body.message });
  check('its items go back on the shelf', (await get(`${T}/inventory/gel`)).stockReserved === 0);
  await fresh({ delivery: { failCode: 'unsafe', failCause: 'shop', failReason: 'Not safe to leave it here' } });
  r = await SELF(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', pass, action: 'cancel' })); await settle();
  o = await order();
  check('on our side: everything back, the delivery fee too', o.pendingRefundCents === 5700 && !o.deliveryFeeKeptCents, { p: o.pendingRefundCents });
  await fresh({ deliveryRetryPaid: { cs_7: { cents: 600, pi: 'pi_7', at: new Date().toISOString(), state: 'applied' } }, delivery: { failCode: 'other', failCause: 'shop', feeFor: { cents: 600, from: 'cs_7' }, tries: 2 } });
  r = await SELF(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', pass, action: 'cancel' })); await settle();
  o = await order();
  check('a paid try that failed on our side: the order keeps its first fee (their first try), the paid try comes back', o.pendingRefundCents === 5100 && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_7') && /\$6\.00 delivery fee for the last try was refunded/.test(r.body.message) && /\$6\.00 for the earlier try isn’t refunded/.test(r.body.message), { p: o.pendingRefundCents, m: r.body.message });
  // An open payment page closes first.
  await fresh();
  r = await choose({ action: 'windows' });
  await choose({ action: 'retry', key: r.body.windows[0].key });
  r = await SELF(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', pass, action: 'cancel' })); await settle();
  o = await order();
  check('cancelling with a payment page open closes the page first', r.status === 200 && o.stage === 'cancelled' && stripeCalls.expired.includes('cs_1') && o.delivery.retryPay.status === 'cancelled', { s: r.status, b: r.body });
  // Paid in the moment before they cancelled: the try is booked, and the cancellation doesn't go through.
  await fresh();
  r = await choose({ action: 'windows' });
  await choose({ action: 'retry', key: r.body.windows[0].key });
  paySession('cs_1', 'pi_now');
  r = await SELF(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', pass, action: 'cancel' })); await settle();
  o = await order();
  check('paid in the moment before cancelling: the try is booked and they’re told, nothing is canceled', r.status === 409 && /Paid \$6\.00/.test(r.body.error) && o.stage === 'ready' && o.delivery.status === 'waiting', { s: r.status, b: r.body });
  // The shop canceled the order while their page was open, then they paid: it goes straight back.
  await fresh();
  r = await choose({ action: 'windows' });
  await choose({ action: 'retry', key: r.body.windows[0].key });
  await db.doc(`${T}/retailOrders/o1`).update({ stage: 'cancelled' });
  paySession('cs_1', 'pi_late');
  const late = await S.finishRetryPay(db, 't1', 'o1', 'cs_1', {});
  check('paid after the shop canceled the order: refunded, and said why', late.result === 'refunded' && /was canceled/.test(late.message) && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_late'), late);

  // ── After the review
  console.log('timing, late payments and cleanup');
  const { wallToUtc } = await import('../../src/lib/tenant-time');
  await fresh();
  const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const nineThirty = wallToUtc(day, 9, 30, 'America/Los_Angeles').getTime();
  const tenant1 = await get(T);
  const freeW = await S.retryWindows(db, 't1', tenant1, nineThirty);
  const paidW = await S.retryWindows(db, 't1', tenant1, nineThirty, { paid: true });
  check('a free try can take a window half an hour away; a paid one leaves time to pay first',
    freeW.ok && paidW.ok && freeW.windows[0].key === `${day}D10:00` && paidW.windows[0].key === `${day}D14:00`, { f: (freeW as any).windows?.[0]?.key, p: (paidW as any).windows?.[0]?.key });
  // Paid after the window it held had ended (a late notice): refunded, the place back, still theirs to choose.
  r = await choose({ action: 'windows' });
  await choose({ action: 'retry', key: r.body.windows[0].key });
  await db.doc(`${T}/retailOrders/o1`).update({ 'delivery.retryPay.window.end': new Date(Date.now() - 60000).toISOString() });
  paySession('cs_1', 'pi_lateW');
  r = await choose({ action: 'retry_paid', sessionId: 'cs_1' }, false);
  o = await order();
  check('paid after the chosen time had passed: refunded, and they choose again', r.body.result === 'refunded' && /after the time you chose/.test(r.body.message) && o.delivery.status === 'failed' && o.deliveryWindowKey === ORDER.deliveryWindowKey && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_lateW'), { b: r.body });
  // A page closed here that Stripe later says was paid.
  await fresh();
  r = await choose({ action: 'windows' });
  await choose({ action: 'retry', key: r.body.windows[0].key });
  sessions.cs_1.status = 'expired';
  await S.finishRetryPay(db, 't1', 'o1', 'cs_1', {});
  paySession('cs_1', 'pi_after');
  const after1 = await S.finishRetryPay(db, 't1', 'o1', 'cs_1', {});
  o = await order();
  check('a page that lapsed here but was paid after all: written down and refunded, never lost', after1.result === 'refunded' && o.deliveryRetryPaid?.cs_1?.refundedAt && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_after'), { after1, p: o.deliveryRetryPaid });
  // The shop cancels an order after a paid try was booked: the five-minute check refunds the try.
  await fresh();
  r = await choose({ action: 'windows' });
  await choose({ action: 'retry', key: r.body.windows[0].key });
  paySession('cs_1', 'pi_booked');
  await choose({ action: 'retry_paid', sessionId: 'cs_1' }, false);
  await db.doc(`${T}/retailOrders/o1`).update({ stage: 'cancelled' });
  await S.sweepRetryPays(db, 't1', await get(T));
  o = await order();
  check('a paid try on an order the shop canceled goes back', !!o.deliveryRetryPaid.cs_1.refundedAt && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_booked'), o.deliveryRetryPaid);
  // Kept by the customer's own cancellation (their side): the check leaves it.
  await fresh({ deliveryRetryPaid: { cs_7: { cents: 600, pi: 'pi_7', at: new Date().toISOString(), state: 'applied' } }, deliveryRetryPaidOpen: true, delivery: { feeFor: { cents: 600, from: 'cs_7' }, tries: 2 } });
  r = await SELF(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', pass, action: 'cancel' })); await settle();
  await S.sweepRetryPays(db, 't1', await get(T));
  o = await order();
  check('a paid try that failed on their side is kept when they cancel, and the check leaves it', o.stage === 'cancelled' && o.deliveryRetryPaid.cs_7.state === 'kept' && o.deliveryRetryPaidOpen === false && !stripeCalls.refunds.length && /\$12\.00 delivery fee isn’t refunded/.test(r.body.message), { p: o.deliveryRetryPaid, m: r.body.message });
  // Only a payment Stripe says was this order's second try is refunded from here.
  await fresh({ deliveryRetryPaid: { cs_x: { cents: 900, pi: 'pi_someone', at: new Date().toISOString(), state: 'refund_failed' } }, deliveryRetryPaidRetry: true });
  pis.pi_someone = { type: 'retail_order', retailOrderId: 'zz' };
  await S.sweepRetryPays(db, 't1', await get(T));
  o = await order();
  check('a payment that isn’t this order’s second try is never refunded, and the team is told', !stripeCalls.refunds.length && o.deliveryRetryPaid.cs_x.gaveUp === true && (await all(`${T}/notifications`)).some((n: any) => n.type === 'order_refund_due'), o.deliveryRetryPaid);
  // The driver waits while the customer is paying for another try.
  await fresh();
  r = await choose({ action: 'windows' });
  await choose({ action: 'retry', key: r.body.windows[0].key });
  const { POST: FULFIL } = await import('../../src/app/api/retail/fulfil/route');
  const fr: any = await FULFIL(({ json: async () => ({ tenantId: 't1', action: 'deliveryOut', orderId: 'o1' }), headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://shop.test', searchParams: new URLSearchParams() } }) as any); await settle();
  check('it can’t go out while they’re paying for another try', !fr.body.ok && /is paying for another try/.test(fr.body.message) && (await order()).delivery.status === 'failed', fr.body);
  // The delivery fee back, through the real refund route: shipping only, no tax, and never more than the fee.
  await fresh({ delivery: { failCode: 'unsafe', failCause: 'shop', failReason: 'Not safe to leave it here' } });
  await choose({ action: 'pickup' });
  const { POST: REFUND } = await import('../../src/app/api/retail/refund/route');
  const ireq = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'x-internal-key' ? 'test-secret' : null) }, nextUrl: { origin: 'https://shop.test' }, clone() { return this; } }) as any;
  await db.doc(`${T}/retailOrders/o1`).update({ pendingRefundCents: 1600 });
  r = await REFUND(ireq({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', reason: 'delivery_fee_back' })); await settle();
  check('anything waiting beyond the fee isn’t sent this way', r.status === 403 && !stripeCalls.refunds.length, r.body);
  await db.doc(`${T}/retailOrders/o1`).update({ pendingRefundCents: 600 });
  r = await REFUND(ireq({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', reason: 'delivery_fee_back' })); await settle();
  o = await order();
  check('the fee goes back to the card as shipping, with no tax and none of the tip', r.status === 200 && stripeCalls.refunds.some((x) => x.payment_intent === 'pi_main' && x.amount === 600) && o.refundedCents === 600 && !o.pendingRefundCents
    && !(o.refundedTaxCents > 0) && !(o.refundedTipCents > 0) && o.shippingRefundedCents === 600 && o.deliveryFeeBackRefundedCents === 600, { s: r.status, b: r.body, o: { rc: o.refundedCents, tax: o.refundedTaxCents, tip: o.refundedTipCents, ship: o.shippingRefundedCents } });
  r = await REFUND(ireq({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', reason: 'delivery_fee_back' })); await settle();
  check('…once', r.status >= 400 && stripeCalls.refunds.filter((x) => x.payment_intent === 'pi_main').length === 1);

  // ── The wiring
  console.log('the wiring');
  const hook = fs.readFileSync('src/lib/connect-webhook.ts', 'utf8');
  check('Stripe’s notice books a paid try', /sessionType === 'delivery_retry'/.test(hook) && /finishRetryPay/.test(hook) && /meta\.type === 'delivery_retry'/.test(hook));
  check('the five-minute check sweeps the payments', /sweepRetryPays/.test(fs.readFileSync('src/app/api/cron/retail-payments/route.ts', 'utf8')));
  check('marked done by hand, it carries no tax either, and isn’t refunded again as shipping', /deliveryFeeBackHandCents/.test(fs.readFileSync('src/lib/retail-returns.ts', 'utf8')) && /deliveryFeeBackHandCents/.test(fs.readFileSync('src/lib/part-refund.ts', 'utf8')));
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  check('only a manager marks a delivery fee given back by hand', /get\('deliveryFeeBackRefundedCents', 0\) == resource/.test(rules) && /get\('deliveryFeeBackHandCents', 0\) == resource/.test(rules));
  check('only the server writes the second-try payments and the fee owed back or kept', ['deliveryRetryPaid', 'deliveryRetryPaidOpen', 'deliveryRetryPaidRetry', 'deliveryRetryLog', 'deliveryFeeBackCents', 'deliveryFeeKeptCents', 'switchedFrom'].every((k) => new RegExp(`'${k}'`).test(rules.slice(rules.indexOf('function orderLockedKeys'), rules.indexOf('function orderStepKeys')))));
  const status = fs.readFileSync('src/app/api/retail/order-status/route.ts', 'utf8');
  check('the order page gets the choices and their words from the server', /choices: canChoose\(order\)/.test(status) && /choiceWords\(order, plan/.test(status));
  check('the plan saves the second-try rule', /'secondTry'\] as const/.test(fs.readFileSync('src/app/api/retail/delivery-plan/route.ts', 'utf8')));
  check('the failed message points to the choices', /Choose another time, pick it up or cancel on your order page/.test(fs.readFileSync('src/app/api/retail/delivery-notify/route.ts', 'utf8')));
  const words = ['src/lib/delivery-retry.ts', 'src/lib/delivery-retry-server.ts', 'src/app/api/retail/delivery-choice/route.ts', 'src/components/shop/DeliveryChoices.tsx'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const tool = new RegExp(String.fromCharCode(67, 108, 97, 117, 100, 101), 'i');
  check('no mention of the tool that wrote this, no "call us", no JSX comments, no British spelling', !tool.test(words) && !/call us/i.test(words) && !/\{\/\*/.test(words) && !/cancelled|colour|organis|behaviour/i.test(fs.readFileSync('src/components/shop/DeliveryChoices.tsx', 'utf8').replace(/\bcancelled:|'cancelled'/g, '')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
