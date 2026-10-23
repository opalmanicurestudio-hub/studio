// Checks sales tax on a shipped order at a shop that uses Stripe Tax when a gift card pays part (api/retail/checkout,
// lib/stripe-tax-calc): a gift card is a way of paying, not a discount, so the tax is on the full price, worked out with
// Stripe Tax first and shown as its own line; the books carry that tax; and it's recorded with Stripe Tax once paid.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/checkout-tax.verify.ts
import Module from 'module';
import { makeDb, strictTransactions, FV, check, failures } from './fake-db';

let db: any = strictTransactions(makeDb());
const sessions: any[] = []; const calcs: any[] = []; const records: any[] = []; let calcDown = false;
function StripeMock(this: any) {
  return {
    coupons: { create: async (p: any) => ({ id: `co_${p.amount_off}` }) },
    checkout: { sessions: { create: async (p: any) => { sessions.push(p); return { id: `cs_${sessions.length}`, url: 'https://stripe.test/x' }; } } },
    tax: {
      calculations: { create: async (p: any) => { if (calcDown) throw new Error('Stripe Tax is not set up'); calcs.push(p); const base = p.line_items.reduce((s: number, l: any) => s + l.amount, 0); return { id: `taxcalc_${calcs.length}`, tax_amount_exclusive: Math.round(base * 0.0725) }; } },
      transactions: { createFromCalculation: async (p: any) => { if (records.some((r) => r.reference === p.reference)) throw Object.assign(new Error('A transaction with this reference already exists.'), { raw: { message: 'A transaction with this reference already exists.' } }); records.push(p); return { id: `tax_${records.length}` }; } },
    },
  };
}
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe' || /node_modules\/stripe\//.test(request)) return fake(request, Object.assign(StripeMock, { default: StripeMock }));
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin-retail-checkout' }), getApps: () => [], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async () => ({ ok: true }) });
  return load.call(this, request, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
const T = 'tenants/t1';
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.test' } }) as any;
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const lines = () => [...db._store.entries()].filter(([p]: any) => p.startsWith(`${T}/transactions/`)).map(([, d]: any) => d);
const fresh = async () => {
  db = strictTransactions(makeDb()); sessions.length = 0; calcs.length = 0; records.length = 0; calcDown = false;
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: { stripeTaxEnabled: true, taxRatePercent: 6, flatShippingDollars: 8, shipping: { mode: 'flat' } } });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Serum', msrp: 100, retailPriceCents: 10000, price: 100, totalStock: 10, stockReserved: 0, showOnline: true, status: 'active', type: 'retail' });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'ABCD-EFGH', codeKey: 'ABCDEFGH', balanceCents: 5000, status: 'active', holds: {}, history: [] });
};
const addr = { name: 'Dana Whitfield', line1: '88 Pine St', city: 'Portland', state: 'OR', postalCode: '97201', country: 'US' };
const body = (x: any = {}) => ({ tenantId: 't1', items: [{ productId: 'p1', qty: 1 }], method: 'ship', customer: { name: 'Dana Whitfield', email: 'dana@example.com' }, shippingAddress: addr, giftCode: 'ABCD-EFGH', ...x });

(async () => {
  const { POST } = await import('../../src/app/api/retail/checkout/route');
  const { handleRetailOrderPaid, finishPaidOrder } = await import('../../src/lib/retail-webhook');

  console.log('a $100 item, a $50 gift card, Stripe Tax at 7.25%');
  await fresh();
  const r: any = await POST(req(body()));
  const oid = r.body?.orderId;
  let o = oid ? await get(`${T}/retailOrders/${oid}`) : null;
  check('the tax is worked out on the full $100, not the $50 left after the gift card', r.status === 200 && calcs.length === 1 && calcs[0].line_items[0].amount === 10000 && o?.taxMode === 'stripe_calc' && o?.taxCents === 725, { status: r.status, body: r.body, calc: calcs[0]?.line_items, o: o && { mode: o.taxMode, tax: o.taxCents } });
  const s = sessions[0] || {};
  check('…shown on the payment page as its own line, with Stripe’s own tax switched off for this page', !s.automatic_tax && (s.line_items || []).some((l: any) => l.price_data?.product_data?.name === 'Sales Tax' && l.price_data.unit_amount === 725), s.line_items);

  // Paid: the card covers what the gift card didn't.
  await handleRetailOrderPaid(db, null, 't1', 'acct_1', { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 10000 + 800 + 725 - 5000, total_details: { amount_tax: 0 }, metadata: { retailOrderId: oid } }, 'ch_1');
  o = await get(`${T}/retailOrders/${oid}`);
  const tax = lines().find((l: any) => l.category === 'Tax Collected');
  check('…paid: the books hold $7.25 of tax, whatever the gift card paid', o.stage === 'paid' && tax?.amount === 7.25 && o.taxCents === 725, { stage: o.stage, tax });
  check('…and it’s recorded with Stripe Tax, once', records.length === 1 && records[0].calculation === 'taxcalc_1' && records[0].reference === oid && !!o.taxTransactionId, records);
  await finishPaidOrder(db, 't1', oid);
  check('…a second run records nothing more', records.length === 1);

  console.log('no gift card or credit');
  await fresh();
  const r2: any = await POST(req(body({ giftCode: undefined })));
  check('Stripe’s own tax on its page, as before (nothing to work out first)', r2.status === 200 && calcs.length === 0 && sessions[0]?.automatic_tax?.enabled === true, { calcs: calcs.length, auto: sessions[0]?.automatic_tax });

  console.log('Stripe Tax can’t be asked');
  await fresh(); calcDown = true;
  const r3: any = await POST(req(body()));
  o = await get(`${T}/retailOrders/${r3.body?.orderId}`);
  check('the shop’s flat rate (6%) on the full price, and the order says so', r3.status === 200 && o?.taxMode === 'flat_fallback' && o?.taxCents === 600 && !sessions[0]?.automatic_tax, { mode: o?.taxMode, tax: o?.taxCents });

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('checkout-tax ok');
})().catch((e) => { console.error(e); process.exit(1); });
