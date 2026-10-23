// Checks Stripe's notices for the businesses' accounts (lib/connect-webhook) are recorded once however often they come,
// one after another or at the same moment: a deposit paid on the booking page (the booking, its credit, its income, one
// confirmation), a refund (one message to the client, Stripe's fee return once), a dispute (its record, Stripe's fee, the
// client's flag and the sidebar count in one step; the fee written later if a step stopped halfway), and its outcome
// (a lost dispute is a return in the books, once; a won one gives the fee back, once).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/stripe-notices.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import { booksSummary } from '../../src/lib/books-summary';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_x';
// Messages go through the real sender; the email provider is stood in for, and each message is in the business's log.
process.env.RESEND_API_KEY = 're_test_x';
(globalThis as any).fetch = async (url: string) => ({ ok: true, status: 200, json: async () => ({ id: `em_${Math.random().toString(36).slice(2)}` }), text: async () => '' , url });
let db: any = strictTransactions(makeDb());
const sentLog = () => [...db._store.entries()].filter(([p]: any) => p.startsWith(`${T}/messageLog/`)).map(([, d]: any) => d);
let refundList: any[] = [];
function StripeMock(this: any) {
  return {
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    paymentIntents: { retrieve: async (id: string) => ({ id, latest_charge: `ch_${id}`, customer: null, payment_method: null, metadata: {} }) },
    paymentMethods: { retrieve: async (id: string) => ({ id, card: { brand: 'visa', last4: '4242' } }) },
    refunds: { list: async () => ({ data: refundList }) },
    balanceTransactions: { retrieve: async (id: string) => ({ id, fee: -30, amount: -1000 }) },
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
  // A dynamic import reaches here by its file's path, and takes its exports from the module the loader keeps for it.
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/audit' || request === './audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const txns = () => [...db._store.entries()].filter(([p]: any) => p.startsWith(`${T}/transactions/`)).map(([, d]: any) => d);
const req = (event: any) => ({ text: async () => JSON.stringify(event), json: async () => event, headers: { get: (k: string) => (String(k).toLowerCase() === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio.test' } }) as any;
const nowS = Math.floor(Date.now() / 1000);
const fresh = async () => {
  db = strictTransactions(makeDb()); refundList = [];
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York', email: 'hello@opal.test' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com' });
};
const ev = (type: string, object: any) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, type, account: 'acct_1', data: { object } });

(async () => {
  const { POST: hook } = await import('../../src/app/api/stripe/connect-webhook/route');
  const send = (e: any) => hook(req(e)) as any;

  console.log('a deposit paid on the booking page');
  await fresh();
  await db.doc(`${T}/appointments/a1`).set({ clientId: 'c1', clientName: 'Maya Lopez', clientEmail: 'maya@example.com', serviceName: 'Gel fill', status: 'pending_payment', depositStatus: 'pending', depositAmountCents: 2500, startTime: '2026-11-02T15:00:00Z' });
  const paid = ev('checkout.session.completed', { id: 'cs_9', payment_intent: 'pi_9', amount_total: 2500, payment_status: 'paid', metadata: { type: 'deposit', appointmentId: 'a1', tenantId: 't1' } });
  await Promise.all([send(paid), send(paid)]);
  await send(paid);
  const a = await get(`${T}/appointments/a1`);
  check('three notices for one payment: the booking is paid and confirmed', a.status === 'confirmed' && a.depositStatus === 'paid', a);
  check('…one credit and one income line', [...db._store.keys()].filter((k: string) => k.startsWith(`${T}/depositCredits/`)).length === 1 && txns().length === 1 && txns()[0].amount === 25, txns());
  check('…and one confirmation to her', sentLog().filter((n: any) => n.kind === 'booking_confirmation' && n.status === 'sent').length === 1, sentLog().map((n: any) => [n.kind, n.status]));

  console.log('a refund');
  await fresh();
  refundList = [{ id: 're_1', amount: 1000, status: 'succeeded', balance_transaction: 'txn_r1', created: nowS, metadata: {} }];
  const refunded = ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', amount: 4500, amount_refunded: 1000, metadata: { clientId: 'c1', appointmentId: 'a1', type: 'appointment' }, billing_details: { email: 'maya@example.com' }, payment_method_details: { card: { last4: '4242' } }, refunds: { data: refundList } });
  await Promise.all([send(refunded), send(refunded)]);
  await send(refunded);
  check('the client is told once', sentLog().filter((n: any) => n.kind === 'refund_notice' && n.status === 'sent').length === 1, sentLog().map((n: any) => [n.kind, n.status]));
  check('…and Stripe’s fee return is in the books once', txns().filter((t: any) => t.description?.startsWith('Stripe fee return')).length === 1 && Math.abs(txns()[0].amount - 0.3) < 1e-9, txns());
  check('…the claim is marked sent', !!(await get(`${T}/refundNotices/refund_re_1`))?.sentAt);

  console.log('a dispute');
  await fresh();
  await db.doc(`${T}/transactions/sale1`).set({ id: 'sale1', type: 'income', category: 'Services', taxBucket: 'revenue', amount: 45, stripeChargeId: 'ch_1', clientId: 'c1', clientOrVendor: 'Maya Lopez', appointmentId: 'a1' });
  const dispute = { id: 'dp_1', charge: 'ch_1', amount: 4500, currency: 'usd', reason: 'fraudulent', status: 'needs_response', created: nowS, evidence_details: { due_by: nowS + 7 * 86400 }, balance_transactions: [{ fee: 1500 }] };
  const opened = ev('charge.dispute.created', dispute);
  await Promise.all([send(opened), send(opened)]);
  await send(opened);
  const d = await get(`${T}/disputes/dp_1`);
  check('three notices: one record, linked to her sale', d && d.clientId === 'c1' && d.amount === 45 && d.status === 'needs_response', d);
  check('…Stripe’s $15.00 fee once', txns().filter((t: any) => t.id === 'disputefee_dp_1').length === 1 && (await get(`${T}/transactions/disputefee_dp_1`))?.amount === 15);
  check('…her flag and the sidebar count go up once', (await get(`${T}/clients/c1`)).disputeCount === 1 && (await get(T)).openDisputeCount === 1, { c: await get(`${T}/clients/c1`), t: (await get(T)).openDisputeCount });
  // A record left without its fee (a step that stopped before this one wrote both together): the next notice adds it.
  await db.doc(`${T}/transactions/disputefee_dp_1`).delete();
  await send(opened);
  check('a record without its fee: the next notice writes the fee, and counts nothing again', (await get(`${T}/transactions/disputefee_dp_1`))?.amount === 15 && (await get(T)).openDisputeCount === 1 && (await get(`${T}/clients/c1`)).disputeCount === 1);

  console.log('lost');
  const lost = ev('charge.dispute.closed', { ...dispute, status: 'lost', balance_transactions: [{ fee: 1500 }] });
  await Promise.all([send(lost), send(lost)]);
  await send(lost);
  const back = txns().filter((t: any) => t.id === 'disputelost_dp_1');
  check('the chargeback is a return of $45.00, once', back.length === 1 && back[0].category === 'Refunds' && back[0].amount === 45, back);
  check('…her flag comes off and the count comes down once', (await get(`${T}/clients/c1`)).hasOpenDispute === false && (await get(T)).openDisputeCount === 0, (await get(T)).openDisputeCount);
  const books = booksSummary(txns());
  check('…in the books: $45.00 sold, $45.00 returned, $15.00 in fees', Math.abs(books.netSales) < 1e-9 && Math.abs(books.returns - 45) < 1e-9 && Math.abs(books.netFees - 15) < 1e-9, { netSales: books.netSales, returns: books.returns, fees: books.netFees });

  console.log('won');
  await fresh();
  const dispute2 = { ...dispute, id: 'dp_2', balance_transactions: [{ fee: 1500 }] };
  await send(ev('charge.dispute.created', dispute2));
  const won = ev('charge.dispute.closed', { ...dispute2, status: 'won', balance_transactions: [{ fee: 1500 }, { fee: -1500 }] });
  await Promise.all([send(won), send(won)]);
  await send(won);
  check('the fee comes back once', txns().filter((t: any) => t.id === 'disputewon_dp_2').length === 1 && (await get(`${T}/transactions/disputewon_dp_2`))?.amount === 15 && Math.abs(booksSummary(txns()).netFees) < 1e-9);
  check('…and nothing is returned', !txns().some((t: any) => t.id === 'disputelost_dp_2'));

  console.log('the outcome before the dispute');
  await fresh();
  const dispute3 = { ...dispute, id: 'dp_3' };
  await send(ev('charge.dispute.closed', { ...dispute3, status: 'lost' }));
  await send(ev('charge.dispute.created', dispute3));
  check('the outcome came first: the fee is still recorded, and nothing is counted as open', (await get(`${T}/transactions/disputefee_dp_3`))?.amount === 15 && !(await get(T)).openDisputeCount && txns().filter((t: any) => t.id === 'disputelost_dp_3').length === 1);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('stripe-notices ok');
})();
