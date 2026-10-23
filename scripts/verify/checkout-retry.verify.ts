// Checks an online order paid in full at checkout (a gift card or store credit covers it, so there's no card payment
// to wait for) is paid once however often the checkout page sends it: a retry after a lost answer is shown the order that
// was paid, two at the same moment make one order, and a gift card or store credit is spent once (api/retail/checkout,
// its checkout key).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/checkout-retry.verify.ts
import Module from 'module';
import { makeDb, strictTransactions, FV, check, failures } from './fake-db';

let db: any = strictTransactions(makeDb());
function StripeMock(this: any) { return { coupons: { create: async () => ({ id: 'co_1' }) }, checkout: { sessions: { create: async () => ({ id: 'cs_x', url: 'https://stripe.test/x' }) } } }; }
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin-retail-checkout' }), getApps: () => [], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async () => ({ ok: true }) });
  if (request === '@/lib/loyalty-server' || /loyalty-server(\.ts)?$/.test(request)) return fake(request, { earnForShopOrder: async () => undefined });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.test' } }) as any;
const orders = async () => (await db.collection(`${T}/retailOrders`).get()).docs.map((d: any) => d.data()).filter((o: any) => o.stage !== 'placed');
const gift = async () => (await db.doc(`${T}/giftCards/g1`).get()).data().balanceCents;
const fresh = async () => {
  db = strictTransactions(makeDb());
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: { taxRatePercent: 8 } });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Serum', msrp: 50, retailPriceCents: 5000, price: 50, totalStock: 10, stockReserved: 0, showOnline: true, status: 'active', type: 'retail' });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'ABCD-EFGH', codeKey: 'ABCDEFGH', balanceCents: 20000, status: 'active', holds: {}, history: [] });
};
const body = (x: any = {}) => ({ tenantId: 't1', items: [{ productId: 'p1', qty: 1 }], method: 'counter', customer: { name: 'Ana Ruiz', email: 'ana@example.com' }, giftCode: 'ABCD-EFGH', ...x });

(async () => {
  const { POST } = await import('../../src/app/api/retail/checkout/route');

  console.log('paid in full by gift card, sent again');
  await fresh();
  const a: any = await POST(req(body({ checkoutKey: 'key-aaaaaaaaaaaaaaaa' })));
  const b: any = await POST(req(body({ checkoutKey: 'key-aaaaaaaaaaaaaaaa' })));
  check('the first is paid ($50 and $4 tax off the gift card)', a.status === 200 && a.body.zeroCharge === true && (await gift()) === 14600, a.body);
  check('…the retry is shown that same order, and nothing more comes off the card', b.status === 200 && b.body.already === true && b.body.orderId === a.body.orderId && (await orders()).length === 1 && (await gift()) === 14600, b.body);

  console.log('two at the same moment');
  await fresh();
  const both: any[] = await Promise.all([POST(req(body({ checkoutKey: 'key-bbbbbbbbbbbbbbbb' }))), POST(req(body({ checkoutKey: 'key-bbbbbbbbbbbbbbbb' })))]);
  check('one order, one spend', (await orders()).length === 1 && (await gift()) === 14600, both.map((x) => [x.status, x.body?.orderId, x.body?.already, x.body?.error]));
  check('…the other is told it’s being placed, or shown the paid order', both.some((x) => x.status === 200 && !x.body.already) && both.some((x) => x.status === 409 || x.body.already === true), both.map((x) => x.status));
  const holds = (await db.doc(`${T}/giftCards/g1`).get()).data().holds || {};
  check('…and nothing is left held on the gift card for the one that didn’t go ahead', Object.values(holds).every((h: any) => !(Number(h?.cents) > 0) || Date.parse(h.until) < Date.now()), holds);

  console.log('a new checkout is a new order');
  const c: any = await POST(req(body({ checkoutKey: 'key-cccccccccccccccc' })));
  check('another checkout page (another key): a second order, paid', c.status === 200 && !c.body.already && (await orders()).length === 2 && (await gift()) === 9200, c.body);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('checkout-retry ok');
})().catch((e) => { console.error(e); process.exit(1); });
