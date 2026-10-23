// Checks a refund made in the Stripe Dashboard reaches the books once (lib/outside-refund, through lib/connect-webhook's
// charge.refunded), and the app's own refunds aren't recorded twice:
//   - one made outside the app: a refund line named after Stripe's refund, once however often the notice comes, and
//     the owners told once;
//   - one the app sent (its mark), one from before this was in place, money held but never taken: nothing written;
//   - a shop order's: on the order too (with its tax part), in place of the refund it was waiting to send; one the
//     team recorded by hand as "refunded in the dashboard" is matched to it instead of written again;
//   - a booking deposit's: the deposit closes, so it can't also come off a bill.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/outside-refunds.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import { booksSummary } from '../../src/lib/books-summary';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_x';
process.env.RESEND_API_KEY = 're_test_x';
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: `em_${Math.random().toString(36).slice(2)}` }), text: async () => '' });
let db: any = strictTransactions(makeDb());
let refundList: any[] = [];
let piMeta: any = {};
function StripeMock(this: any) {
  return {
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    paymentIntents: { retrieve: async (id: string) => ({ id, metadata: piMeta }) },
    refunds: { list: async () => ({ data: refundList }) },
    balanceTransactions: { retrieve: async (id: string) => ({ id, fee: 0, amount: -1000 }) },
  };
}
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin-connect-webhook' }), getApps: () => [{ name: 'admin-connect-webhook' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/audit' || request === './audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const txns = () => [...db._store.entries()].filter(([p]: any) => p.startsWith(`${T}/transactions/`)).map(([, d]: any) => d);
const notes = () => [...db._store.entries()].filter(([p]: any) => p.startsWith(`${T}/notifications/outsiderefund_`)).map(([, d]: any) => d);
const req = (event: any) => ({ text: async () => JSON.stringify(event), json: async () => event, headers: { get: (k: string) => (String(k).toLowerCase() === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio.test' } }) as any;
const ev = (object: any) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, type: 'charge.refunded', account: 'acct_1', data: { object } });
let after = 0;
const fresh = async () => {
  db = strictTransactions(makeDb()); refundList = []; piMeta = {};
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York' });
  await db.doc(`${T}/staff/o1`).set({ name: 'Jess', role: 'owner' });
};
const charge = (x: any = {}) => ({ id: 'ch_1', payment_intent: 'pi_1', amount: 4500, amount_captured: 4500, captured: true, amount_refunded: 1000, metadata: { clientId: 'c1', type: 'appointment' }, billing_details: { name: 'Maya Lopez', email: 'maya@example.com' }, ...x });
const refund = (x: any = {}) => ({ id: 're_1', amount: 1000, status: 'succeeded', created: after, metadata: {}, ...x });

(async () => {
  const { POST: hook } = await import('../../src/app/api/stripe/connect-webhook/route');
  const { OUTSIDE_FROM } = await import('../../src/lib/outside-refund');
  after = Math.floor(OUTSIDE_FROM / 1000) + 3600;
  const send = (e: any) => hook(req(e)) as any;

  console.log('made in the Stripe Dashboard');
  await fresh();
  refundList = [refund()];
  const e1 = ev(charge());
  await Promise.all([send(e1), send(e1)]);
  await send(e1);
  const out = txns().filter((t: any) => t.madeOutsideApp);
  check('three notices: one refund line, named after Stripe’s refund', out.length === 1 && out[0].id === 'stripe_refund_re_1' && out[0].category === 'Refunds' && out[0].amount === 10, txns());
  check('…the books count it as a refund', booksSummary(txns() as any).returns === 10, booksSummary(txns() as any));
  check('…and the owner is told once', notes().length === 1 && /made in Stripe, outside the app/.test(notes()[0].message), notes());

  console.log('not made outside the app');
  await fresh();
  refundList = [refund({ metadata: { origin: 'app' } }), refund({ id: 're_2', metadata: { tenantId: 't1', moneyRefundOf: 'x1' } })];
  await send(ev(charge()));
  check('the app’s own refunds (its mark): nothing written', !txns().some((t: any) => t.madeOutsideApp));
  await fresh();
  refundList = [refund({ created: Math.floor(OUTSIDE_FROM / 1000) - 3600 })];
  await send(ev(charge()));
  check('one from before this was in place: left as it was', !txns().some((t: any) => t.madeOutsideApp));
  await fresh();
  refundList = [refund({ amount: 1500 })];
  await send(ev(charge({ amount_captured: 3000 })));
  check('the part of a hold that wasn’t captured: not a refund of a sale', !txns().some((t: any) => t.madeOutsideApp));
  await fresh();
  refundList = [refund({ amount: 4500 })];
  await send(ev(charge({ captured: false, amount_captured: 0 })));
  check('an authorization let go: the same', !txns().some((t: any) => t.madeOutsideApp));

  console.log('a shop order');
  await fresh();
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', orderNumber: 1130, customerName: 'Dana Whitfield', subtotalCents: 4000, taxCents: 330, shippingCents: 0, totalCents: 4330, chargedCents: 4330, refundedCents: 0, pendingRefundCents: 1083, stage: 'shipped' });
  refundList = [refund({ amount: 1083 })];
  piMeta = { type: 'retail_order', retailOrderId: 'o1', tenantId: 't1' };
  const e2 = ev(charge({ amount: 4330, amount_captured: 4330, metadata: {} }));
  await Promise.all([send(e2), send(e2)]);
  const o = await get(`${T}/retailOrders/o1`);
  const line = txns().find((t: any) => t.madeOutsideApp);
  check('on the order: refunded, in place of the refund it was waiting to send', o.refundedCents === 1083 && o.pendingRefundCents === 0 && o.outsideRefunds?.length === 1 && o.outsideRefunds[0].coveredPendingCents === 1083, o);
  check('…its tax part goes back in the books too', line && line.retailOrderId === 'o1' && Math.abs(line.taxRefunded - 0.83) < 1e-9 && o.refundedTaxCents === 83, { line, o });
  check('…once', txns().filter((t: any) => t.madeOutsideApp).length === 1);
  await fresh();
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', orderNumber: 1130, customerName: 'Dana Whitfield', subtotalCents: 4000, taxCents: 330, totalCents: 4330, refundedCents: 1083, pendingRefundCents: 0, stage: 'shipped' });
  await db.doc(`${T}/transactions/hand1`).set({ id: 'hand1', category: 'Refunds', type: 'expense', amount: 10.83, taxRefunded: 0.83, description: 'Refund executed — Order #1130', retailOrderId: 'o1', paymentMethod: 'Card (Online)' });
  refundList = [refund({ amount: 1083 })];
  piMeta = { type: 'retail_order', retailOrderId: 'o1', tenantId: 't1' };
  await send(ev(charge({ amount: 4330, amount_captured: 4330, metadata: {} })));
  check('recorded by hand already ("refunded in the dashboard"): matched to it, not written again', !txns().some((t: any) => t.madeOutsideApp) && (await get(`${T}/transactions/hand1`)).stripeRefundId === 're_1' && (await get(`${T}/retailOrders/o1`)).refundedCents === 1083, txns());

  console.log('a booking deposit');
  await fresh();
  await db.doc(`${T}/depositCredits/d1`).set({ id: 'd1', kind: 'deposit', status: 'available', amountCents: 2500, stripePaymentIntentId: 'pi_1', clientId: 'c1', sourceAppointmentId: 'a1' });
  refundList = [refund({ amount: 2500 })];
  await send(ev(charge({ amount: 2500, amount_captured: 2500, metadata: { type: 'deposit', appointmentId: 'a1' } })));
  check('refunded in Stripe: the deposit closes, so it can’t come off a bill as well', (await get(`${T}/depositCredits/d1`)).status === 'refunded' && txns().filter((t: any) => t.madeOutsideApp).length === 1);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('outside-refunds ok');
})();
