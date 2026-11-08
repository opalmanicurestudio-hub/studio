// Checks renters' money goes to the business's own Stripe account (launch L10, renters):
// - A renter's card is saved on the business's account, with the account recorded; their card on file stays as it is
//   until the new one is saved; a business that can't take cards yet is told so.
// - A card saved on the platform's account before the move isn't charged for this business (an incidental, autopay, a
//   station booking, paid texts): it has to be saved again, and the screens say so.
// - Rent paid online is paid on the business's account; the payments notice there records it and saves the card with
//   its account; a page opened before the move is still recorded by the platform's notice.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-renter-money.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_x';
let db: any = strictTransactions(makeDb());
type Call = { what: string; params: any; opts: any };
let calls: Call[] = []; let webhookEvent: any = null;
const sessions = new Map<string, any>();
const acctOf = (o: any) => (o && typeof o === 'object' ? o.stripeAccount || null : null);
function StripeMock(this: any) {
  const rec = (what: string, params: any, opts: any) => { calls.push({ what, params, opts }); };
  return {
    webhooks: { constructEvent: () => webhookEvent },
    customers: {
      list: async (p: any, o: any) => { rec('customers.list', p, o); return { data: [] }; },
      create: async (p: any, o: any) => { rec('customers.create', p, o); return { id: 'cus_biz' }; },
    },
    checkout: { sessions: {
      create: async (p: any, o: any) => { rec('sessions.create', p, o); const id = `cs_${calls.length}`; const s = { id, url: `https://checkout.stripe.test/${id}`, mode: p.mode, metadata: p.metadata, customer: p.customer || 'cus_biz', status: 'open' }; sessions.set(id, s); return s; },
      retrieve: async (id: string, p: any, o: any) => { rec('sessions.retrieve', p, o); const s = sessions.get(id); if (!s) throw Object.assign(new Error('No such checkout session'), { code: 'resource_missing', type: 'StripeInvalidRequestError' }); return s; },
      expire: async (id: string, p: any, o: any) => { rec('sessions.expire', p, o); return { id }; },
    } },
    paymentIntents: {
      create: async (p: any, o: any) => { rec('pi.create', p, o); return { id: `pi_${calls.length}`, status: 'succeeded', amount: p.amount, metadata: p.metadata, latest_charge: { id: 'ch_1', balance_transaction: { fee: 59 } } }; },
      retrieve: async (id: string, p: any, o: any) => { rec('pi.retrieve', p, o); return { id, payment_method: 'pm_paid', customer: 'cus_paid', latest_charge: { id: 'ch_r', balance_transaction: { id: 'txn_rent', fee: 2350, net: 77650, amount: 80000, fee_details: [] } } }; },
    },
    paymentMethods: { retrieve: async (id: string, p: any, o: any) => { rec('pm.retrieve', p, o); return { id, card: { brand: 'visa', last4: '4242' } }; } },
    balanceTransactions: { retrieve: async (id: string, p: any, o: any) => { rec('bt.retrieve', p, o); return { id, fee: 2350, net: 77650, amount: 80000, fee_details: [] }; } },
    refunds: { list: async (p: any, o: any) => { rec('refunds.list', p, o); return { data: [] }; } },
  };
}
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock, __esModule: true });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return {
    requireCan: async (req: any) => (String(req?.headers?.get?.('authorization') || '') === 'Bearer manager' ? { actor: { uid: 'm1', name: 'Ana Ruiz', role: 'manager', caps: ['checkout.take'] } } : { deny: { status: 401, body: { ok: false } } }),
    requireRole: async () => ({ deny: { status: 401, body: { ok: false } } }),
    staffOrServer: async () => false,
  };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any, auth = '') => ({ json: async () => body, url: 'https://studio.test/api/booths/setup-card', headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? auth || null : null) }, nextUrl: { origin: 'https://studio.test' } }) as any;
const getReq = (q: Record<string, string>) => ({ url: `https://studio.test/api/booths/setup-card?${new URLSearchParams(q)}`, headers: { get: () => null }, nextUrl: { origin: 'https://studio.test' } }) as any;
const callsOf = (what: string) => calls.filter((c) => c.what === what);
const legacyCard = { cardOnFile: true, stripeCustomerId: 'cus_plat', stripePaymentMethodId: 'pm_plat' };
const fresh = async (tenant: any = { stripeAccountId: 'acct_biz', stripeChargesEnabled: true }, renter: any = legacyCard) => {
  db = strictTransactions(makeDb()); calls = []; sessions.clear();
  await db.doc(T).set({ name: 'Opal', incidentalCategories: [{ label: 'Cleaning', capCents: 5000 }], ...tenant });
  await db.doc(`${T}/renters/rt1`).set({ firstName: 'Nia', lastName: 'Park', email: 'nia@example.com', ...renter });
  await db.doc(`${T}/private/renterSessions`).set({ [createHash('sha256').update('portal-token').digest('hex')]: { renterId: 'rt1', expiresAt: Date.now() + 3600e3 } });
};

(async () => {
  const S = await import('../../src/lib/space-stripe');
  const setup = await import('../../src/app/api/booths/setup-card/route');

  console.log('Saving a renter’s card');
  await fresh({ stripeAccountId: null });
  let r: any = await setup.POST(req({ tenantId: 't1', renterId: 'rt1', returnUrl: 'https://studio.test/card-setup/t1', portalToken: 'portal-token' }));
  check('a business that can’t take cards yet: nothing set up, and it says why', r.status === 409 && /isn’t set up to take cards/.test(r.body.error) && callsOf('sessions.create').length === 0, r.body);
  await fresh();
  r = await setup.POST(req({ tenantId: 't1', renterId: 'rt1', returnUrl: 'https://studio.test/card-setup/t1', portalToken: 'portal-token' }));
  const sc = callsOf('sessions.create')[0];
  check('the card page opens on the business’s own account, with a customer made there (the old platform one isn’t reused)', r.body.ok && acctOf(sc?.opts) === 'acct_biz' && acctOf(callsOf('customers.create')[0]?.opts) === 'acct_biz' && sc?.params?.customer === 'cus_biz', { body: r.body, opts: sc?.opts });
  let rt: any = await get(`${T}/renters/rt1`);
  check('the card on file stays as it is until the new one is saved', rt.stripeCustomerId === 'cus_plat' && rt.stripePaymentMethodId === 'pm_plat' && rt.cardSetupCustomerId === 'cus_biz' && rt.cardSetupAccount === 'acct_biz', rt);
  const sid = String(sc && [...sessions.keys()][0]);
  sessions.get(sid).setup_intent = { status: 'succeeded', payment_method: 'pm_biz' };
  sessions.get(sid).metadata = { ...sessions.get(sid).metadata };
  r = await setup.GET(getReq({ tenantId: 't1', renterId: 'rt1', session: sid }));
  rt = await get(`${T}/renters/rt1`);
  check('back from Stripe: the page is checked, and the card read, on the business’s account', acctOf(callsOf('sessions.retrieve').slice(-1)[0]?.opts) === 'acct_biz' && acctOf(callsOf('pm.retrieve').slice(-1)[0]?.opts) === 'acct_biz', r.body);
  check('…the new card and its customer go on file together, with the account they’re on', r.body.ok && rt.stripeCustomerId === 'cus_biz' && rt.stripePaymentMethodId === 'pm_biz' && rt.defaultPaymentMethodId === 'pm_biz' && rt.stripeCustomerAccount === 'acct_biz', rt);

  console.log('A card saved before the move');
  await fresh();
  r = await setup.PUT(req({ tenantId: 't1', renterId: 'rt1', category: 'Cleaning', amountCents: 2000, key: 'k1' }, 'Bearer manager'));
  check('an incidental isn’t charged to it: it needs saving again, and nothing is claimed', r.status === 409 && r.body.error === S.RENTER_CARD_AGAIN && callsOf('pi.create').length === 0 && !(await get(`${T}/renters/rt1/charges/inc_k1`)), r.body);
  await db.doc(`${T}/renters/rt1`).set({ stripeCustomerId: 'cus_biz', stripePaymentMethodId: 'pm_biz', stripeCustomerAccount: 'acct_biz' }, { merge: true });
  r = await setup.PUT(req({ tenantId: 't1', renterId: 'rt1', category: 'Cleaning', amountCents: 2000, key: 'k2' }, 'Bearer manager'));
  check('once saved on the business’s account, it’s charged there', r.status === 200 && acctOf(callsOf('pi.create')[0]?.opts) === 'acct_biz' && callsOf('pi.create')[0]?.params?.customer === 'cus_biz', r.body);
  const RS = await import('../../src/lib/rent-schedule');
  const lease = { dueDay: 1 };
  check('autopay shows it as not ready (no card it can charge) until it’s saved again', RS.autopayReadiness(lease, { autopayEnabled: true, ...legacyCard }, 'acct_biz') === 'no_card'
    && RS.autopayReadiness(lease, { autopayEnabled: true, stripeCustomerId: 'cus_biz', stripePaymentMethodId: 'pm_biz', stripeCustomerAccount: 'acct_biz' }, 'acct_biz') === 'ready');
  const ap = src('src/app/api/cron/autopay-leases/route.ts'); const bs = src('src/app/api/stripe/book-station/route.ts');
  check('autopay and station bookings charge only a card saved on the business’s account (a station booking takes the card the setup saves)',
    ap.includes("const card = renterBusinessCard(renter, stripeAccountId);") && ap.includes("'card_saved_before_move'") && ap.includes('customer: card.customer,')
    && bs.includes('!renterBusinessCard(renter, String(stripeAccountId))') && bs.includes('chargePm: String(renter.stripePaymentMethodId || renter.defaultPaymentMethodId)'));
  const pr = src('src/app/api/portal/renter/route.ts');
  check('paid texts and autopay in the renter’s portal ask for the card to be saved again', pr.includes('const rcCard = renterBusinessCard(r, spacePayAccount(') && pr.includes('Please save your card again first'));
  check('the station kiosk too', src('src/app/api/booths/kiosk/route.ts').includes('const stationCard = renterBusinessCard(rt, spacePayAccount('));

  console.log('Rent paid online');
  check('a new rent page opens on the business’s account, reusing their customer only when it’s there', pr.includes("const customerId: string | null = renterCardAccount(renter) === payAcct ? (renter.stripeCustomerId || null) : null;")
    && pr.includes("{ stripeAccount: payAcct, idempotencyKey: `rent-pay-${sidKey(invoiceId)}-${owedNow}-${n}` }") && pr.includes('stripeSessionAccount: payAcct'));
  await fresh(undefined, { ...legacyCard });
  await db.doc(`${T}/leases/l1`).set({ renterId: 'rt1', boothId: 'b1', status: 'active' });
  await db.doc(`${T}/rentInvoices/i1`).set({ leaseId: 'l1', status: 'due', amountCents: 80000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-11-01', stripeSessionId: 'cs_rent', stripeSessionAccount: 'acct_biz' });
  const W = await import('../../src/lib/connect-webhook');
  webhookEvent = { type: 'checkout.session.completed', account: 'acct_biz', data: { object: { id: 'cs_rent', mode: 'payment', payment_status: 'paid', status: 'complete', amount_total: 80000, payment_intent: 'pi_rent', customer: 'cus_paid', metadata: { tenantId: 't1', invoiceId: 'i1', kind: 'rent_invoice' } } } };
  const hook = () => W.handleConnectWebhook({ text: async () => '{}', headers: { get: (k: string) => (k === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio.test' } } as any);
  await hook();
  const inv: any = await get(`${T}/rentInvoices/i1`); rt = await get(`${T}/renters/rt1`);
  check('the business’s payments notice records it: the invoice paid, the rent and its fee in the books', inv.status === 'paid' && !!(await get(`${T}/transactions/rentpay_cs_rent`)) && (await get(`${T}/transactions/stripefee_txn_rent`))?.amount === 23.5, inv);
  check('…asking Stripe on the business’s account', callsOf('pi.retrieve').length >= 1 && callsOf('pi.retrieve').every((c) => acctOf(c.opts) === 'acct_biz'));
  check('…and the card used goes on file with that account, so autopay can charge it', rt.stripeCustomerId === 'cus_paid' && rt.stripePaymentMethodId === 'pm_paid' && rt.stripeCustomerAccount === 'acct_biz' && rt.defaultPaymentMethodId === 'pm_paid', rt);
  const before = (await all(`${T}/transactions`)).length;
  await hook();
  check('the same notice again: nothing more', (await all(`${T}/transactions`)).length === before);
  webhookEvent = { ...webhookEvent, data: { object: { ...webhookEvent.data.object, id: 'cs_x', metadata: { tenantId: 't2', invoiceId: 'i1', kind: 'rent_invoice' } } } };
  await hook();
  check('a page naming another business is left alone', (await all(`${T}/transactions`)).length === before);
  webhookEvent = { type: 'charge.succeeded', account: 'acct_biz', data: { object: { id: 'ch_r', paid: true, captured: true, amount: 80000, balance_transaction: 'txn_rent', metadata: { tenantId: 't1', invoiceId: 'i1', kind: 'rent_invoice' }, payment_intent: 'pi_rent', created: 1 } } };
  await hook();
  check('the payment’s own notice finds the rent’s fee already written under Stripe’s record: one fee line, never two', (await all(`${T}/transactions`)).filter((t: any) => /Processing Fee/.test(String(t.category))).length === 1);
  await fresh(undefined, { ...legacyCard });
  await db.doc(`${T}/leases/l1`).set({ renterId: 'rt1', boothId: 'b1', status: 'active' });
  await db.doc(`${T}/rentInvoices/i2`).set({ leaseId: 'l1', status: 'due', amountCents: 80000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-12-01' });
  webhookEvent = { type: 'charge.succeeded', account: 'acct_biz', data: { object: { id: 'ch_n', paid: true, captured: true, amount: 80000, balance_transaction: 'txn_n', metadata: { tenantId: 't1', invoiceId: 'i2', kind: 'rent_invoice' }, payment_intent: 'pi_n', created: 1 } } };
  await hook();
  check('when the rent’s fee couldn’t be read when it was recorded, the payment’s notice writes the real one', (await get(`${T}/transactions/stripefee_txn_n`))?.amount === 23.5);
  check('only space payments that write their own fee are skipped by the notice', S.writesOwnFee({ kind: 'space_booking' }) && !S.writesOwnFee({ kind: 'rent_invoice' }) && !S.writesOwnFee({ kind: 'renter_incidental' }) && !S.writesOwnFee({ kind: 'renter_campaign_texts' }) && !S.writesOwnFee({ kind: 'lease_autopay' }));

  console.log('A page from before the move');
  const RP = await import('../../src/lib/rent-online-pay');
  await fresh(undefined, { cardOnFile: true, stripeCustomerId: 'cus_biz', stripePaymentMethodId: 'pm_biz', stripeCustomerAccount: 'acct_biz' });
  await db.doc(`${T}/leases/l1`).set({ renterId: 'rt1', boothId: 'b1', status: 'active' });
  await db.doc(`${T}/rentInvoices/i3`).set({ leaseId: 'l1', status: 'due', amountCents: 80000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-12-01' });
  await RP.recordRentPayment(db, new (StripeMock as any)(), 't1', 'i3', { id: 'cs_old', payment_status: 'paid', amount_total: 80000, payment_intent: 'pi_old', customer: 'cus_plat', metadata: { tenantId: 't1', invoiceId: 'i3', kind: 'rent_invoice' } }, { account: null });
  rt = await get(`${T}/renters/rt1`);
  check('recorded, but it never replaces a card already saved on the business’s account', (await get(`${T}/rentInvoices/i3`)).status === 'paid' && rt.stripeCustomerId === 'cus_biz' && rt.stripeCustomerAccount === 'acct_biz' && rt.stripePaymentMethodId === 'pm_biz', rt);

  console.log('Two card setups at once, and a stale one');
  const sc2 = src('src/app/api/booths/setup-card/route.ts');
  check('two setups started at once get the same customer (one key for the renter on that account)', sc2.includes('idempotencyKey: `renter-card-customer-${safeKey(tenantId)}-${safeKey(renterId)}-'));
  await fresh();
  await db.doc(`${T}/renters/rt1`).set({ cardSetupCustomerId: 'cus_biz', cardSetupAccount: 'acct_biz' }, { merge: true });
  r = await setup.GET(getReq({ tenantId: 't1', renterId: 'rt1', session: 'cs_unknown' }));
  check('a setup Stripe doesn’t know on that account is told it’s out of date (not an error)', r.status === 410 && r.body.linkExpired === true, r.body);

  const bad = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  check('no assistant names in the new file', !bad.test(src('scripts/verify/launch-renter-money.verify.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
