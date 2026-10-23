// Checks that an online order becomes paid in one step (lib/order-paid), whatever pays for it:
//  - a card payment: the number, the stock held, the order paid, and its lines in the books (the sale after the promo
//    code, the shipping charged on its own line, the sales tax), all in one step; nothing for the tip yet
//  - the same notice twice, or two at once: paid once, one number, one set of lines
//  - store credit the checkout applied: taken from what's left on the customer's store credit, oldest first, never a
//    booking's deposit; a credit spent by another order meanwhile is short (and says so), never spent twice
//  - paid in full with store credit or a gift card: the sale is still in the books; not enough credit or a gift card
//    that can't pay writes nothing at all
//  - a gift card the checkout set aside is spent in the same step; one that can't be spent is short (and says so)
//  - Stripe Tax: the tax is Stripe's, and the order's total is what it sold for (the card paid less by the credit)
//  - digital-only orders finish; pre-orders take a place in their run
//  - what follows (the receipt) happens once, is tried again when it fails, and isn't retried when the shop has no
//    email set up
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-paid.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const sent: any[] = [];
let sendFails = 0;
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/notify' || request === './notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return { sendNotification: async (_db: any, m: any) => { if (sendFails > 0) { sendFails--; return { ok: false, status: 'failed', error: 'down' }; } sent.push(m); return { ok: true }; } };
  if (request === '@/lib/loyalty-server') return { earnForShopOrder: async () => undefined };
  if (request === '@/lib/promo-codes-server') return { countPromoUse: async () => undefined };
  return load.call(this, request, ...rest);
};
process.env.RESEND_API_KEY = 're_x'; process.env.RESEND_FROM = 'shop@opal.test'; process.env.NEXT_PUBLIC_APP_URL = 'https://studio.test';

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const lines = async () => (await db.collection(`${T}/transactions`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
// Maya's order: two of one polish (as two lines, two shades) and a file, $40.00 of items, a $5.00 code, $7.10
// shipping, 8% tax on the items after the code ($2.80), a $3.00 tip.
const draft = (x: any = {}) => ({
  id: 'o1', tenantId: 't1', orderNumber: null, isDraft: true, stage: 'placed', method: 'ship', priceTier: 'retail',
  lines: [
    { lineId: 'l1', productId: 'p1', name: 'Polish', qtyOrdered: 1, unitPriceCents: 1500, optionsLabel: 'Rose' },
    { lineId: 'l2', productId: 'p1', name: 'Polish', qtyOrdered: 1, unitPriceCents: 1500, optionsLabel: 'Sand' },
    { lineId: 'l3', productId: 'p2', name: 'File', qtyOrdered: 2, unitPriceCents: 500 },
  ],
  subtotalCents: 4000, promo: { code: 'FALL5', cents: 500 }, discountCents: 500, taxCents: 280, taxMode: 'flat', shippingCents: 710, shippingService: 'USPS Ground Advantage',
  tipCents: 300, totalCents: 4000 - 500 + 280 + 710 + 300, storeCreditRequestedCents: 0, refundedCents: 0,
  customerName: 'Maya Lopez', customerEmail: 'maya@example.com', placedAt: '2026-10-23T15:00:00.000Z', stripeCheckoutSessionId: 'cs_1', ...x,
});
const session = (x: any = {}) => ({ id: 'cs_1', payment_intent: 'pi_1', amount_total: 4790, total_details: { amount_tax: 0 }, metadata: { retailOrderId: 'o1' }, ...x });
const fresh = async (o: any = {}) => {
  db = strictTransactions(makeDb()); sent.length = 0; sendFails = 0;
  await db.doc(T).set({ name: 'Opal', businessName: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Polish', totalStock: 10, stockReserved: 1, unit: 'bottles' });
  await db.doc(`${T}/inventory/p2`).set({ name: 'File', totalStock: 30, stockReserved: 0 });
  await db.doc(`${T}/retailOrders/o1`).set(draft(o));
};

(async () => {
  const { payOrder } = await import('../../src/lib/order-paid');
  const { finishPaidOrder, handleRetailOrderPaid } = await import('../../src/lib/retail-webhook');
  const card = (x: any = {}) => ({ via: 'card' as const, session: session(x), chargeId: 'ch_1', connAcct: 'acct_1', clientId: 'c1', risk: null });

  console.log('A card payment');
  await fresh();
  let r: any = await payOrder(db, 't1', 'o1', card());
  let o: any = await get(`${T}/retailOrders/o1`);
  check('it wins, with number 1', r.won === true && r.orderNumber === 1 && o.orderNumber === 1 && o.stage === 'paid' && o.isDraft === false, { r, o });
  check('the counter moves to 1', (await get(`${T}/counters/retailOrders`))?.value === 1);
  check('both shades of polish are held (1 + 2 = 3), and both files', (await get(`${T}/inventory/p1`))?.stockReserved === 3 && (await get(`${T}/inventory/p2`))?.stockReserved === 2);
  let L = await lines();
  const sale = L.find((t: any) => t.id === 'osale_o1'); const ship = L.find((t: any) => t.id === 'oship_o1'); const tax = L.find((t: any) => t.id === 'otax_o1');
  check('the sale is the items after the code ($35.00), in Retail', sale?.amount === 35 && sale?.category === 'Retail' && sale?.taxBucket === 'revenue' && sale?.stripeChargeId === 'ch_1', sale);
  check('shipping charged is its own line ($7.10), not product sales', ship?.amount === 7.1 && ship?.category === 'Shipping Charged', ship);
  check('the sales tax is held for the state ($2.80)', tax?.amount === 2.8 && tax?.category === 'Tax Collected' && tax?.taxBucket === 'tax_collected', tax);
  check('no tip line yet (it goes to who fulfills the order)', !L.some((t: any) => t.category === 'Tips'), L.map((t: any) => t.category));
  check('the order keeps its full total and what the card paid', o.totalCents === 4790 && o.chargedCents === 4790 && o.tenders?.cardCents === 4790, { total: o.totalCents, charged: o.chargedCents });
  check('each hold is on the stock ledger (one per line)', (await db.collection(`${T}/stockCorrections`).get()).docs.length === 3);

  console.log('The same notice twice, and two at once');
  r = await payOrder(db, 't1', 'o1', card());
  check('a second try does nothing', r.won === false && (await lines()).length === 3 && (await get(`${T}/counters/retailOrders`))?.value === 1);
  await fresh();
  const [x1, x2] = await Promise.all([payOrder(db, 't1', 'o1', card()), payOrder(db, 't1', 'o1', card())]);
  check('two at once: exactly one wins', [x1, x2].filter((x: any) => x.won).length === 1, [x1.won, x2.won]);
  check('two at once: one number, one set of lines, stock held once', (await get(`${T}/counters/retailOrders`))?.value === 1 && (await lines()).length === 3 && (await get(`${T}/inventory/p1`))?.stockReserved === 3);

  console.log('Store credit the checkout applied');
  await fresh({ storeCreditRequestedCents: 1500, totalCents: 4790 });
  await db.doc(`${T}/depositCredits/dep1`).set({ clientEmail: 'maya@example.com', status: 'available', amountCents: 5000, sourceAppointmentId: 'a9', createdAt: '2026-01-01T00:00:00.000Z' });
  await db.doc(`${T}/depositCredits/sc1`).set({ clientEmail: 'maya@example.com', status: 'available', amountCents: 1000, usedCents: 300, sourceRetailReturnId: 'r1', createdAt: '2026-02-01T00:00:00.000Z' });
  await db.doc(`${T}/depositCredits/sc2`).set({ clientEmail: 'maya@example.com', status: 'available', amountCents: 2000, createdAt: '2026-03-01T00:00:00.000Z' });
  r = await payOrder(db, 't1', 'o1', card({ amount_total: 3290 }));
  const sc1: any = await get(`${T}/depositCredits/sc1`); const sc2: any = await get(`${T}/depositCredits/sc2`); const dep1: any = await get(`${T}/depositCredits/dep1`);
  check('the oldest store credit gives what was left on it ($7.00) and is used up', sc1.usedCents === 1000 && sc1.status === 'used', sc1);
  check('the next gives the rest ($8.00) and keeps $12.00', sc2.usedCents === 800 && sc2.status === 'available', sc2);
  check('the booking deposit is never touched', !dep1.usedCents && dep1.status === 'available', dep1);
  o = await get(`${T}/retailOrders/o1`);
  check('the order says $15.00 of credit, nothing short', r.creditTaken === 1500 && o.creditShortfallCents === 0 && o.tenders?.creditCents === 1500, o.tenders);
  check('what it took is kept where only the server writes', (await get(`${T}/private/nonCardPaid/orders/o1`))?.creditCents === 1500);
  check('the sale is still the full $35.00 (credit pays for it, it doesn’t shrink it)', (await lines()).find((t: any) => t.id === 'osale_o1')?.amount === 35);

  console.log('Store credit spent by another order meanwhile');
  await fresh({ storeCreditRequestedCents: 1500 });
  await db.doc(`${T}/depositCredits/sc1`).set({ clientEmail: 'maya@example.com', status: 'available', amountCents: 1500, usedCents: 1000, createdAt: '2026-02-01T00:00:00.000Z' });
  r = await payOrder(db, 't1', 'o1', card({ amount_total: 3290 }));
  o = await get(`${T}/retailOrders/o1`);
  check('it takes what is left ($5.00) and records $10.00 short', r.creditTaken === 500 && o.creditShortfallCents === 1000, { taken: r.creditTaken, short: o.creditShortfallCents });
  const ev = (await db.collection(`${T}/retailOrders/o1/events`).get()).docs.map((d: any) => d.data());
  check('the order’s history says it needs a look', ev.some((e: any) => /short needs a look/.test(String(e.meta?.text || ''))));

  console.log('Paid in full with store credit');
  await fresh({ shippingCents: 0, tipCents: 0, taxCents: 280, totalCents: 3780 });
  await db.doc(`${T}/depositCredits/sc1`).set({ clientEmail: 'maya@example.com', status: 'available', amountCents: 5000, createdAt: '2026-02-01T00:00:00.000Z' });
  r = await payOrder(db, 't1', 'o1', { via: 'store_credit', cents: 3780 });
  o = await get(`${T}/retailOrders/o1`); L = await lines();
  check('paid, nothing charged, by store credit', r.won && o.stage === 'paid' && o.chargedCents === 0 && o.paidVia === 'store_credit' && o.storeCreditRequestedCents === 3780, o);
  check('the sale and its tax are in the books (they weren’t before)', L.find((t: any) => t.id === 'osale_o1')?.amount === 35 && L.find((t: any) => t.id === 'otax_o1')?.amount === 2.8 && /Store credit/.test(String(L.find((t: any) => t.id === 'osale_o1')?.paymentMethod)), L);
  await fresh({ shippingCents: 0, tipCents: 0, totalCents: 3780 });
  await db.doc(`${T}/depositCredits/sc1`).set({ clientEmail: 'maya@example.com', status: 'available', amountCents: 3000, createdAt: '2026-02-01T00:00:00.000Z' });
  await db.doc(`${T}/depositCredits/dep1`).set({ clientEmail: 'maya@example.com', status: 'available', amountCents: 5000, sourceAppointmentId: 'a9', createdAt: '2026-01-01T00:00:00.000Z' });
  r = await payOrder(db, 't1', 'o1', { via: 'store_credit', cents: 3780 });
  o = await get(`${T}/retailOrders/o1`);
  check('not enough store credit (a deposit doesn’t count): nothing written at all', r.won === false && r.reason === 'credit_short' && o.stage === 'placed' && !(await get(`${T}/counters/retailOrders`)) && (await lines()).length === 0 && !(await get(`${T}/depositCredits/sc1`))?.usedCents, { r, stage: o.stage });

  console.log('Paid in full with a gift card');
  await fresh({ shippingCents: 0, tipCents: 0, totalCents: 3780 });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'GIFT-1', balanceCents: 5000, status: 'active', holds: { retail_o1: { cents: 3780, until: new Date(Date.now() + 9e5).toISOString() } }, history: [] });
  r = await payOrder(db, 't1', 'o1', { via: 'gift_card', gift: { id: 'g1', code: 'GIFT-1', cents: 3780 } });
  const g1: any = await get(`${T}/giftCards/g1`); o = await get(`${T}/retailOrders/o1`);
  check('the card pays all of it in the same step, its hold gone', r.won && g1.balanceCents === 1220 && !g1.holds?.retail_o1 && g1.history?.[0]?.cents === -3780, g1);
  check('the order is paid by gift card, and the spend is on the server’s record', o.paidVia === 'gift_card' && o.giftSpentAt && (await get(`${T}/private/nonCardPaid/orders/o1`))?.giftCents === 3780);
  check('the sale is in the books', (await lines()).find((t: any) => t.id === 'osale_o1')?.amount === 35);
  await fresh({ shippingCents: 0, tipCents: 0, totalCents: 3780 });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'GIFT-1', balanceCents: 2000, status: 'active', holds: {}, history: [] });
  r = await payOrder(db, 't1', 'o1', { via: 'gift_card', gift: { id: 'g1', code: 'GIFT-1', cents: 3780 } });
  check('a card without enough on it: nothing written at all', r.won === false && r.reason === 'gift_failed' && (await get(`${T}/retailOrders/o1`))?.stage === 'placed' && (await get(`${T}/giftCards/g1`))?.balanceCents === 2000 && (await lines()).length === 0, r);

  console.log('A gift card the checkout set aside, with a card payment');
  await fresh({ giftCardId: 'g1', giftCardCode: 'GIFT-1', giftCardCents: 1000 });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'GIFT-1', balanceCents: 1000, status: 'active', holds: { retail_o1: { cents: 1000, until: new Date(Date.now() + 9e5).toISOString() } }, history: [] });
  r = await payOrder(db, 't1', 'o1', card({ amount_total: 3790 }));
  check('spent in the same step', r.won && r.giftSpent === 1000 && (await get(`${T}/giftCards/g1`))?.balanceCents === 0 && (await get(`${T}/retailOrders/o1`))?.giftSpentAt);
  await fresh({ giftCardId: 'g1', giftCardCode: 'GIFT-1', giftCardCents: 1000 });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'GIFT-1', balanceCents: 1000, status: 'void', holds: {}, history: [] });
  r = await payOrder(db, 't1', 'o1', card({ amount_total: 3790 }));
  o = await get(`${T}/retailOrders/o1`);
  check('a cancelled card: the order is still paid (the card payment is real), $10.00 short and flagged', r.won && o.stage === 'paid' && o.giftShortfallCents === 1000 && !o.giftSpentAt, o);

  console.log('Stripe Tax');
  await fresh({ taxMode: 'stripe', taxCents: 0, totalCents: 4510, storeCreditRequestedCents: 1000 });
  await db.doc(`${T}/depositCredits/sc1`).set({ clientEmail: 'maya@example.com', status: 'available', amountCents: 1000, createdAt: '2026-02-01T00:00:00.000Z' });
  r = await payOrder(db, 't1', 'o1', card({ amount_total: 3833, total_details: { amount_tax: 323 } }));
  o = await get(`${T}/retailOrders/o1`);
  check('the tax is Stripe’s ($3.23) and the total is what it sold for ($48.33), not what the card paid', o.taxCents === 323 && o.totalCents === 4833 && o.chargedCents === 3833, { tax: o.taxCents, total: o.totalCents, charged: o.chargedCents });
  check('the tax line is Stripe’s figure', (await lines()).find((t: any) => t.id === 'otax_o1')?.amount === 3.23);

  console.log('Digital-only, and pre-orders');
  await fresh({ digitalOnly: true, method: 'digital', lines: [{ lineId: 'l1', productId: 'p3', name: 'Guide', qtyOrdered: 1, unitPriceCents: 4000, digital: true }], shippingCents: 0 });
  await db.doc(`${T}/inventory/p3`).set({ name: 'Guide', totalStock: 0 });
  r = await payOrder(db, 't1', 'o1', card({ amount_total: 4080 }));
  o = await get(`${T}/retailOrders/o1`);
  check('a digital-only order is finished at once', o.stage === 'completed' && !!o.completedAt);
  await fresh({ lines: [{ lineId: 'l1', productId: 'p1', name: 'Polish', qtyOrdered: 2, unitPriceCents: 2000, preorder: true }] });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Polish', totalStock: 0, stockReserved: 0, preorderSold: 5 });
  await payOrder(db, 't1', 'o1', card());
  const p1: any = await get(`${T}/inventory/p1`);
  check('a pre-order takes places in its run, not shelf stock', p1.preorderSold === 7 && !p1.stockReserved, p1);

  console.log('What follows: the receipt, once');
  await fresh();
  await payOrder(db, 't1', 'o1', card());
  await finishPaidOrder(db, 't1', 'o1', session());
  await finishPaidOrder(db, 't1', 'o1', session());
  check('one receipt', sent.filter((m: any) => m.kind === 'order_confirmation').length === 1, sent.map((m: any) => m.kind));
  check('done is marked', !!(await get(`${T}/retailOrders/o1`))?.afterPaidAt);
  await fresh();
  await payOrder(db, 't1', 'o1', card());
  sendFails = 1;
  await finishPaidOrder(db, 't1', 'o1', session());
  o = await get(`${T}/retailOrders/o1`);
  check('a failed send isn’t marked done, and gives its claim back', !o.afterPaidAt && !o.receiptSentAt && !o.receiptSending, o);
  await finishPaidOrder(db, 't1', 'o1', session());
  check('the next run sends it', sent.filter((m: any) => m.kind === 'order_confirmation').length === 1 && !!(await get(`${T}/retailOrders/o1`))?.afterPaidAt);
  await fresh();
  await payOrder(db, 't1', 'o1', card());
  delete process.env.RESEND_API_KEY;
  await finishPaidOrder(db, 't1', 'o1', session());
  process.env.RESEND_API_KEY = 're_x';
  o = await get(`${T}/retailOrders/o1`);
  check('no email set up: done, not retried forever', !!o.afterPaidAt && o.receiptSkipped === true && sent.length === 0, o);

  console.log('The webhook path end to end');
  await fresh();
  await handleRetailOrderPaid(db, null, 't1', 'acct_1', session(), 'ch_1');
  await handleRetailOrderPaid(db, null, 't1', 'acct_1', session(), 'ch_1');
  o = await get(`${T}/retailOrders/o1`);
  check('paid once, receipt once, the client matched or made once', o.stage === 'paid' && sent.filter((m: any) => m.kind === 'order_confirmation').length === 1 && (await db.collection(`${T}/clients`).get()).docs.length === 1, { stage: o.stage, sent: sent.length });

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
