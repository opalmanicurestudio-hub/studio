// Checks "Refund part of this order" through the refund route (api/retail/refund with `add`): items at what was paid
// for them with their tax, the shipping with none, an amount; never more than is left of what was paid; queued and sent
// in one go, and taken off again when Stripe says no; marked on the order so the same items can't be refunded twice;
// only for someone allowed to send refunds. And a cancelled order's tip is kept out of returns.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/part-refund.verify.ts
import Module from 'module';
import { makeDb, check, failures, strictTransactions } from './fake-db';
import { partRefundAsk, unitsLeft, shippingLeft } from '../../src/lib/part-refund';
import { booksSummary } from '../../src/lib/books-summary';

let db = makeDb();
let actor: any = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
const stripeCalls: any[] = []; const stripeMade: any[] = []; let stripeFail = '';
function StripeMock(this: any) {
  return { refunds: {
    create: async (params: any, opts: any) => {
      stripeCalls.push({ params, opts });
      if (stripeFail) throw Object.assign(new Error(stripeFail), { type: 'StripeInvalidRequestError', raw: { message: stripeFail } });
      const r = { id: `re_${stripeMade.length + 1}`, amount: params.amount, metadata: params.metadata, status: 'succeeded', payment_intent: params.payment_intent };
      stripeMade.push(r); return r;
    },
    list: async (params: any) => ({ data: stripeMade.filter((r) => r.payment_intent === params.payment_intent) }),
  } };
}
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/email-shell') return { brandedEmail: (_b: any, html: string) => html, emailButton: (link: string) => `<a href="${link}">`, getEmailBrand: async () => ({ shopName: 'Opal' }) };
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, json: async () => ({}) });
process.env.STRIPE_SECRET_KEY = 'sk_test'; process.env.CRON_SECRET = 'cron';

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const lines = () => [...db._store.entries()].filter(([p]: any) => p.startsWith(`${T}/transactions/`)).map(([, d]: any) => d);
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.example' } }) as any;
// $40 of items (2 × $12 candles, 1 × $16 mug) with 8% tax ($3.20), $8 shipping, $5 tip: $56.20.
const order = (x: any = {}) => ({ id: 'o1', tenantId: 't1', orderNumber: 1130, stage: 'completed', method: 'ship', booksAt: '2026-10-01T00:00:00.000Z',
  lines: [
    { lineId: 'a', productId: 'p1', name: 'Pine candle', unitPriceCents: 1200, qtyOrdered: 2, qtyScanned: 2, qtyShorted: 0, qtyReturned: 0, status: 'picked' },
    { lineId: 'b', productId: 'p2', name: 'Mug', unitPriceCents: 1600, qtyOrdered: 1, qtyScanned: 1, qtyShorted: 0, qtyReturned: 0, status: 'picked' },
  ],
  subtotalCents: 4000, taxCents: 320, shippingCents: 800, tipCents: 500, totalCents: 5620, chargedCents: 5620, refundedCents: 0,
  stripePaymentIntentId: 'pi_1', qrToken: 'qr1', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', pendingRefundCents: 0, ...x });

(async () => {
  console.log('working it out from the order');
  const o0 = order();
  let a: any = partRefundAsk(o0, { kind: 'items', lines: [{ lineId: 'a', qty: 1 }], note: 'cracked' });
  check('an item: what was paid for it with its tax', a.ok && a.add.cents === 1296 && a.add.itemsCents === 1200 && a.add.taxCents === 96, a);
  a = partRefundAsk(o0, { kind: 'items', lines: [{ lineId: 'a', qty: 3 }], note: 'x' });
  check('never more of a line than is left', !a.ok && /Only 2/.test(a.error), a);
  a = partRefundAsk(o0, { kind: 'shipping', note: 'late' });
  check('the shipping: all of it by default, no tax', a.ok && a.add.cents === 800 && a.add.taxCents === 0, a);
  check('no reason, no refund', !partRefundAsk(o0, { kind: 'amount', cents: 500 }).ok);
  check('units left skip what was missing, returned or refunded', unitsLeft({ qtyOrdered: 5, qtyShorted: 1, qtyReturned: 1, qtyRefunded: 2 }) === 1 && shippingLeft({ shippingCents: 800, shippingRefundedCents: 300 }) === 500);

  const { POST } = await import('../../src/app/api/retail/refund/route');
  const fresh = async (x: any = {}) => {
    db = makeDb(); strictTransactions(db); stripeCalls.length = 0; stripeMade.length = 0; stripeFail = '';
    actor = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
    await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
    await db.doc(`${T}/retailOrders/o1`).set(order(x));
  };
  const send = (add?: any) => POST(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', ...(add ? { add } : {}) })) as any;

  console.log('items');
  await fresh();
  let r = await send({ kind: 'items', lines: [{ lineId: 'a', qty: 1 }], note: 'Arrived cracked, she kept it' });
  let o = await get(`${T}/retailOrders/o1`);
  check('sent through Stripe for exactly the item and its tax', r.status === 200 && stripeCalls.length === 1 && stripeCalls[0].params.amount === 1296, r.body);
  check('nothing left waiting; the refund is on the order', o.pendingRefundCents === 0 && o.refundedCents === 1296 && o.refundedTaxCents === 96, o);
  check('the item is marked refunded, so it can’t be refunded twice', o.lines[0].qtyRefunded === 1 && Array.isArray(o.partRefunds) && o.partRefunds[0].note === 'Arrived cracked, she kept it', o);
  let ls = lines();
  check('in the books: a return of $12.00 and $0.96 of tax given back', ls.length === 1 && ls[0].category === 'Refunds' && Math.abs(ls[0].taxRefunded - 0.96) < 0.001 && Math.abs(booksSummary(ls).returns - 12) < 0.001, ls);
  r = await send({ kind: 'items', lines: [{ lineId: 'a', qty: 2 }], note: 'again' });
  check('the same item again: refused, only what’s left can be', r.status === 422 && /Only 1/.test(r.body.error) && stripeCalls.length === 1, r.body);

  console.log('shipping');
  await fresh();
  r = await send({ kind: 'shipping', cents: 500, note: 'Arrived late' });
  o = await get(`${T}/retailOrders/o1`);
  check('part of the shipping: no tax with it', r.status === 200 && stripeCalls[0].params.amount === 500 && !o.refundedTaxCents && o.shippingRefundedCents === 500, o);
  r = await send({ kind: 'shipping', cents: 400, note: 'more' });
  check('never more shipping than is left', r.status === 422 && /Only \$3\.00/.test(r.body.error), r.body);

  console.log('an amount, with a refund already waiting');
  await fresh({ pendingRefundCents: 1000 });
  r = await send({ kind: 'amount', cents: 700, note: 'Price matched' });
  o = await get(`${T}/retailOrders/o1`);
  check('what was waiting goes with it, in one refund', r.status === 200 && stripeCalls[0].params.amount === 1700 && o.pendingRefundCents === 0 && o.refundedCents === 1700, { r: r.body, o });

  console.log('Stripe says no');
  await fresh({ pendingRefundCents: 1000 });
  stripeFail = 'Charge already refunded';
  r = await send({ kind: 'items', lines: [{ lineId: 'b', qty: 1 }], note: 'x' });
  o = await get(`${T}/retailOrders/o1`);
  check('the part refund comes off again; what was waiting stays', r.status === 502 && o.pendingRefundCents === 1000 && !o.refundInFlight && !o.lines[1].qtyRefunded && lines().length === 0, o);

  console.log('limits');
  await fresh({ refundedCents: 5000 });
  r = await send({ kind: 'amount', cents: 1000, note: 'goodwill' });
  o = await get(`${T}/retailOrders/o1`);
  check('never more than is left of what they paid', r.status === 422 && /more than is left/.test(r.body.error) && stripeCalls.length === 0 && !o.pendingRefundCents, r.body);
  await fresh();
  actor = { uid: 's2', name: 'Sam', role: 'staff', isManager: false, caps: [] };
  r = await send({ kind: 'amount', cents: 500, note: 'x' });
  check('someone not allowed to send refunds can’t', r.status === 403 && stripeCalls.length === 0, r.body);
  await fresh();
  const both = await Promise.all([send({ kind: 'amount', cents: 500, note: 'x', id: 'ask-0001' }), send({ kind: 'amount', cents: 500, note: 'x', id: 'ask-0001' })]);
  o = await get(`${T}/retailOrders/o1`);
  check('two taps at once: one refund', stripeCalls.length === 1 && o.refundedCents === 500 && both.some((x: any) => x.body.already === true || x.status === 409), both.map((x: any) => x.body));
  r = await send({ kind: 'amount', cents: 500, note: 'x', id: 'ask-0001' });
  check('…and the same ask later: still one', r.body.already === true && stripeCalls.length === 1, r.body);
  r = await send({ kind: 'amount', cents: 500, note: 'another', id: 'ask-0002' });
  check('a new ask is a new refund', r.status === 200 && stripeCalls.length === 2, r.body);

  console.log('a cancelled order’s tip');
  await fresh({ stage: 'cancelled', pendingRefundCents: 5620 });
  r = await send();
  o = await get(`${T}/retailOrders/o1`);
  ls = lines();
  check('the tip goes back with it, and is kept out of returns', r.status === 200 && o.refundedTipCents === 500 && Math.abs(ls[0].tipRefunded - 5) < 0.001 && !ls[0].tipBooked, ls);
  const books = booksSummary([{ id: 's', type: 'income', category: 'Retail', amount: 40 }, { id: 'sh', type: 'income', category: 'Shipping Charged', amount: 8 }, { id: 't', type: 'income', category: 'Tax Collected', amount: 3.2 }, ...ls]);
  check('…so sales, tax and tips all come back to nothing', Math.abs(books.netSales) < 0.001 && Math.abs(books.taxOwed) < 0.001 && Math.abs(books.tips) < 0.001, books);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('part-refund ok');
})();
