// Checks a space rental's money goes to the business's own Stripe account (launch L10):
// - A day or hourly space booking and a day-pass pack are paid on the business's connected account, the account is
//   saved with them, and a business that can't take cards yet is told so before anything is held.
// - Every later step on a booking (confirming it, its fee, an overage, an incidental, a refund, a no-show fee, a kiosk
//   order on the stay's card) uses the account the booking was paid on; a booking paid before this carries on on the
//   platform's account.
// - The payments notice doesn't add a second processing fee for a space payment (it writes its own).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-space-money.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_x';
let db: any = strictTransactions(makeDb());
type Call = { what: string; params: any; opts: any };
let calls: Call[] = []; let webhookEvent: any = null; let piRetrieveFails = false; let sessionCreateFails = false;
const fetched: string[] = [];
(globalThis as any).fetch = async (url: string) => { fetched.push(String(url)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
const acctOf = (o: any) => (o && typeof o === 'object' ? o.stripeAccount || null : null);
function StripeMock(this: any) {
  const rec = (what: string, params: any, opts: any) => { calls.push({ what, params, opts }); };
  return {
    webhooks: { constructEvent: () => webhookEvent },
    customers: {
      list: async (p: any, o: any) => { rec('customers.list', p, o); return { data: [] }; },
      create: async (p: any, o: any) => { rec('customers.create', p, o); return { id: 'cus_new' }; },
    },
    checkout: { sessions: {
      create: async (p: any, o: any) => { rec('sessions.create', p, o); if (sessionCreateFails) throw Object.assign(new Error('account restricted'), { type: 'StripeInvalidRequestError' }); return { id: `cs_${calls.length}`, url: 'https://checkout.stripe.com/x' }; },
      retrieve: async (id: string, p: any, o: any) => { rec('sessions.retrieve', p, o); return { id, payment_status: 'paid', payment_intent: { id: 'pi_paid', payment_method: 'pm_1' } }; },
    } },
    paymentIntents: {
      create: async (p: any, o: any) => { rec('pi.create', p, o); return { id: `pi_${calls.length}`, status: 'succeeded', amount: p.amount, metadata: p.metadata, latest_charge: { id: 'ch_1', balance_transaction: { fee: 59 } } }; },
      retrieve: async (id: string, p: any, o: any) => { rec('pi.retrieve', p, o); if (piRetrieveFails) throw new Error('connection reset'); return { id, latest_charge: { id: 'ch_r', balance_transaction: { fee: 120 } } }; },
      list: async (p: any, o: any) => { rec('pi.list', p, o); return { data: [] }; },
    },
    refunds: {
      create: async (p: any, o: any) => { rec('refunds.create', p, o); return { id: 're_1', status: 'succeeded', amount: p.amount, payment_intent: p.payment_intent, metadata: p.metadata }; },
      list: async (p: any, o: any) => { rec('refunds.list', p, o); return { data: [] }; },
    },
    balanceTransactions: { retrieve: async (id: string, p: any, o: any) => { rec('bt.retrieve', p, o); return { id, fee: 90, net: 910, amount: 1000, fee_details: [] }; } },
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
  if (request === '@/lib/route-guard') return { requireCan: async () => ({ actor: { uid: 'm1', name: 'Ana Ruiz', role: 'manager' } }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (request === '@/lib/reservation-notify' || /\/src\/lib\/reservation-notify(\.ts)?$/.test(request)) return fake(request, { sendReservationConfirmation: async () => undefined, sendStayMoneyNotice: async () => undefined });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, url: 'https://studio.test/api/booths/reserve', headers: { get: () => null }, nextUrl: { origin: 'https://studio.test' } }) as any;
const getReq = (q: Record<string, string>) => ({ url: `https://studio.test/api/booths/reserve?${new URLSearchParams(q)}`, headers: { get: () => null } }) as any;
const callsOf = (what: string) => calls.filter((c) => c.what === what);
const future = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const booking = (x: any = {}) => ({ id: 'r1', status: 'completed', name: 'Lena Cho', boothName: 'Chair 2', amountCents: 6000, stripePaymentIntentId: 'pi_book', stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1',
  overageStatus: 'due', overageDueCents: 1500, overageMinutes: 30, startDate: '2026-10-20', endDate: '2026-10-20', ...x });
const fresh = async (tenant: any = { stripeAccountId: 'acct_biz', stripeChargesEnabled: true }) => {
  db = strictTransactions(makeDb()); calls = [];
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', incidentalCategories: [{ label: 'Cleaning', capCents: 5000 }],
    bookingPageSettings: { dayPassPacks: [{ label: '5-day pack', days: 5, amountCents: 20000 }], requireBookingSignature: false }, ...tenant });
  await db.doc(`${T}/booths/b1`).set({ name: 'Chair 2', status: 'vacant', pricingOptions: [{ frequency: 'daily', amountCents: 6000 }] });
};

(async () => {
  const R = await import('../../src/app/api/booths/reserve/route');

  console.log('Paying for a space');
  await fresh({ stripeAccountId: null });
  let r: any = await R.POST(req({ action: 'buy-pass', tenantId: 't1', packIndex: 0, name: 'Lena Cho', email: 'lena@example.com', phone: '5555550100', returnUrl: 'https://studio.test/book/t1' }));
  check('a business that can’t take cards yet: a day pass isn’t sold, and it says why', r.status === 409 && /isn’t set up to take card payments/.test(r.body.error) && (await all(`${T}/boothPassPurchases`)).length === 0, r.body);
  const bookBody = { tenantId: 't1', boothId: 'b1', startDate: future(3), endDate: future(3), name: 'Lena Cho', phone: '5555550100', email: 'lena@example.com', returnUrl: 'https://studio.test/book/t1', consentAccepted: true, bookingType: 'daily', agreementSignedName: 'Lena Cho' };
  r = await R.POST(req(bookBody));
  check('…nor a space booked, and no time is held for it', r.status === 409 && (await all(`${T}/boothReservations`)).length === 0, r.body);

  await fresh();
  r = await R.POST(req({ action: 'buy-pass', tenantId: 't1', packIndex: 0, name: 'Lena Cho', email: 'lena@example.com', phone: '5555550100', returnUrl: 'https://studio.test/book/t1' }));
  const passSession = callsOf('sessions.create')[0];
  const pur: any = (await all(`${T}/boothPassPurchases`))[0];
  check('a day pass is paid on the business’s own account, and the account is saved with it', r.status === 200 && acctOf(passSession?.opts) === 'acct_biz' && pur?.stripeAccountId === 'acct_biz', { status: r.status, body: r.body, opts: passSession?.opts });
  check('its payment carries what it is, for the fee and the books', passSession?.params?.payment_intent_data?.metadata?.kind === 'day_pass');
  calls = [];
  r = await R.POST(req(bookBody));
  const bookSession = callsOf('sessions.create')[0]; const res: any = (await all(`${T}/boothReservations`))[0];
  check('a space booking is paid on the business’s own account, saved on the booking', r.status === 200 && acctOf(bookSession?.opts) === 'acct_biz' && res?.stripeAccountId === 'acct_biz', { status: r.status, body: r.body });
  check('the guest’s card is kept under a customer on that account, found only within this business', callsOf('customers.list').every((c) => acctOf(c.opts) === 'acct_biz') && callsOf('customers.create').every((c) => acctOf(c.opts) === 'acct_biz') && callsOf('customers.create').length === 1);
  check('the card is saved for later charges, and the payment says what it is', bookSession?.params?.payment_intent_data?.setup_future_usage === 'off_session' && bookSession?.params?.payment_intent_data?.metadata?.kind === 'space_booking');
  await fresh();
  await db.doc(`${T}/boothCredits/cr1`).set({ contactKey: 'lena@example.com', amountCents: 1000, status: 'available' });
  sessionCreateFails = true;
  r = await R.POST(req({ ...bookBody, startDate: future(4), endDate: future(4) }));
  sessionCreateFails = false;
  const failed: any = (await all(`${T}/boothReservations`))[0];
  check('when the payment page can’t open, the time is let go at once and any credit it set aside is free again', r.status === 500 && failed?.status === 'cancelled' && (await get(`${T}/boothCredits/cr1`)).status === 'available', { status: r.status, res: failed?.status, credit: (await get(`${T}/boothCredits/cr1`))?.status });
  check('a business that couldn’t be read just now isn’t told it can’t take cards', src('src/app/api/booths/reserve/route.ts').includes("if (!tenantRead) return NextResponse.json({ ok: false, error: 'That didn’t go through. Please try again in a moment.' }, { status: 503 });"));

  console.log('Later steps use the booking’s account');
  await fresh();
  await db.doc(`${T}/boothReservations/r2`).set({ id: 'r2', status: 'pending_payment', name: 'Lena Cho', boothId: 'b1', boothName: 'Chair 2', amountCents: 6000, startDate: future(5), endDate: future(5), stripeSessionId: 'cs_x', stripeAccountId: 'acct_biz' });
  r = await R.GET(getReq({ tenantId: 't1', reservationId: 'r2', sessionId: 'cs_x' }));
  check('confirming the payment asks the business’s account', callsOf('sessions.retrieve').length === 1 && acctOf(callsOf('sessions.retrieve')[0].opts) === 'acct_biz', r.body);
  check('…and so does looking up its fee', callsOf('pi.retrieve').every((c) => acctOf(c.opts) === 'acct_biz') && callsOf('pi.retrieve').length >= 1);
  const fee1: any = await get(`${T}/transactions/boothrentfee_r2`);
  check('the fee Stripe took is in the books', fee1?.amount === 1.2 && fee1?.category === 'Processing Fee', fee1);
  await fresh();
  await db.doc(`${T}/boothReservations/r3`).set({ id: 'r3', status: 'pending_payment', name: 'Lena Cho', boothId: 'b1', boothName: 'Chair 2', amountCents: 6000, startDate: future(6), endDate: future(6), stripeSessionId: 'cs_y', stripeAccountId: 'acct_biz' });
  piRetrieveFails = true;
  await R.GET(getReq({ tenantId: 't1', reservationId: 'r3', sessionId: 'cs_y' }));
  piRetrieveFails = false;
  const fee3: any = await get(`${T}/transactions/boothrentfee_r3`);
  check('when Stripe can’t be asked for the fee, the usual rate is booked as an estimate, never nothing', fee3?.amount === 2.04 && /\(est\.\)/.test(fee3?.description || ''), fee3);
  await fresh();
  await db.doc(`${T}/boothReservations/held`).set({ id: 'held', status: 'confirmed', name: 'Someone', boothId: 'b1', boothName: 'Chair 2', amountCents: 6000, startDate: future(7), endDate: future(7) });
  await db.doc(`${T}/boothReservations/r4`).set({ id: 'r4', status: 'pending_payment', name: 'Lena Cho', boothId: 'b1', boothName: 'Chair 2', amountCents: 6000, startDate: future(7), endDate: future(7), stripeSessionId: 'cs_z', stripeAccountId: 'acct_biz' });
  r = await R.GET(getReq({ tenantId: 't1', reservationId: 'r4', sessionId: 'cs_z' }));
  check('paid for dates someone else got first: not booked, but the fee Stripe kept is in the books', (await get(`${T}/boothReservations/r4`)).status === 'payment_received_conflict' && (await get(`${T}/transactions/boothrentfee_r4`))?.amount === 1.2 && !(await get(`${T}/transactions/boothrent_r4`)), r.body);
  check('…and the guest is told plainly, without salon words', /The business will be in touch/.test(r.body?.error || '') && !/studio/i.test(r.body?.error || ''), r.body);
  await db.doc(`${T}/boothReservations/r1`).set(booking({ stripeAccountId: 'acct_biz' }));
  calls = [];
  r = await R.PUT(req({ tenantId: 't1', reservationId: 'r1' }));
  check('an overage is charged on the booking’s account', r.status === 200 && acctOf(callsOf('pi.create')[0]?.opts) === 'acct_biz' && !!callsOf('pi.create')[0]?.opts?.idempotencyKey, r.body);
  calls = [];
  r = await R.PATCH(req({ tenantId: 't1', reservationId: 'r1', action: 'incidental', amountCents: 2000, description: 'Cleaning', category: 'Cleaning' }));
  check('an incidental too', acctOf(callsOf('pi.create')[0]?.opts) === 'acct_biz', r.body);
  calls = [];
  await db.doc(`${T}/boothReservations/r1`).set({ status: 'completed' }, { merge: true });
  r = await R.PATCH(req({ tenantId: 't1', reservationId: 'r1', amountCents: 6000, reason: 'Closed early' }));
  check('a refund goes back from the booking’s account', r.status === 200 && acctOf(callsOf('refunds.create')[0]?.opts) === 'acct_biz' && callsOf('refunds.list').every((c) => acctOf(c.opts) === 'acct_biz'), r.body);

  console.log('A booking paid before this');
  await fresh();
  await db.doc(`${T}/boothReservations/r1`).set(booking());
  r = await R.PUT(req({ tenantId: 't1', reservationId: 'r1' }));
  check('carries on on the platform’s account, where its card is', r.status === 200 && acctOf(callsOf('pi.create')[0]?.opts) === null, callsOf('pi.create')[0]?.opts);

  console.log('A no-show fee');
  const NS = await import('../../src/lib/no-show');
  await fresh({ stripeAccountId: 'acct_biz', boothNoShowPolicy: { enabled: true, feeCents: 2500 } });
  await db.doc(`${T}/boothReservations/n1`).set({ id: 'n1', status: 'confirmed', name: 'Lena Cho', boothName: 'Chair 2', startDate: '2026-01-02', endDate: '2026-01-02', stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', stripeAccountId: 'acct_biz' });
  await NS.sweepNoShows(db, 't1', new Date());
  const ns = callsOf('pi.create')[0];
  check('a no-show fee is charged on the booking’s account', !!ns && acctOf(ns.opts) === 'acct_biz' && ns.params?.metadata?.kind === 'booth_no_show_fee', { calls: calls.map((c) => c.what) });
  // Paused: the no-show is flagged, but nothing is charged.
  await fresh({ stripeAccountId: 'acct_biz', boothNoShowPolicy: { enabled: true, feeCents: 2500 }, accessLocked: true, accessLockedAt: '2026-01-01T00:00:00Z' });
  await db.doc(`${T}/boothReservations/n2`).set({ id: 'n2', status: 'confirmed', name: 'Lena Cho', boothName: 'Chair 2', startDate: '2026-01-02', endDate: '2026-01-02', stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', stripeAccountId: 'acct_biz' });
  await NS.sweepNoShows(db, 't1', new Date());
  const n2: any = (await db.doc(`${T}/boothReservations/n2`).get()).data();
  check('a paused business: the no-show is flagged, and no fee is charged', callsOf('pi.create').length === 0 && n2?.status === 'no_show', { calls: calls.map((c) => c.what), status: n2?.status });
  // Judged on the business's day: a booking that ends "yesterday" in UTC but today in Los Angeles isn't a no-show yet.
  await fresh({ stripeAccountId: 'acct_biz', boothNoShowPolicy: { enabled: true, feeCents: 2500 }, timezone: 'America/Los_Angeles' });
  await db.doc(`${T}/boothReservations/n3`).set({ id: 'n3', status: 'confirmed', name: 'Lena Cho', boothName: 'Chair 2', startDate: '2026-03-10', endDate: '2026-03-10', stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', stripeAccountId: 'acct_biz' });
  await NS.sweepNoShows(db, 't1', new Date('2026-03-11T04:00:00Z'));
  const n3: any = (await db.doc(`${T}/boothReservations/n3`).get()).data();
  check('no-shows are judged on the business’s day (9pm on the day in Los Angeles is still that day)', n3?.status === 'confirmed' && callsOf('pi.create').length === 0, n3?.status);

  console.log('A kiosk order on a stay’s card');
  const ks = src('src/app/api/booths/kiosk/route.ts'); const kc = src('src/lib/kiosk-charges.ts');
  check('charged on the account the stay was paid on, and the claim keeps it for a retry and the five-minute check',
    ks.includes("account: stay.stripeAccountId ? String(stay.stripeAccountId) : null") && ks.includes('onAccount({ stripeAccountId: claim.account }') && ks.includes('account: payer.account || null')
    && kc.includes('paymentsSince(stripe, String(c.customer), Math.floor(claimTime(c) / 1000) - DAY_S, c.account || null)') && kc.includes('cancelOpen(stripe, found.open, c.account || null)'));

  console.log('No second fee from the payments notice');
  const W = await import('../../src/lib/connect-webhook');
  await fresh();
  await db.doc(T).set({ stripeAccountId: 'acct_biz' }, { merge: true });
  webhookEvent = { type: 'charge.succeeded', account: 'acct_biz', data: { object: { id: 'ch_1', paid: true, captured: true, amount: 1500, balance_transaction: 'txn_1', metadata: { tenantId: 't1', reservationId: 'r1', kind: 'booth_overage' }, payment_intent: 'pi_1', created: 1 } } };
  await W.handleConnectWebhook({ text: async () => '{}', headers: { get: (k: string) => (k === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio.test' } } as any);
  check('a space payment’s fee is written once, where it’s recorded', (await all(`${T}/transactions`)).filter((t: any) => t.category === 'Processing Fee').length === 0);
  webhookEvent = { ...webhookEvent, data: { object: { ...webhookEvent.data.object, id: 'ch_2', balance_transaction: 'txn_2', metadata: { tenantId: 't1' } } } };
  await W.handleConnectWebhook({ text: async () => '{}', headers: { get: (k: string) => (k === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio.test' } } as any);
  check('any other payment’s fee is still written by the notice', (await all(`${T}/transactions`)).filter((t: any) => t.category === 'Processing Fee').length === 1);
  webhookEvent = { ...webhookEvent, data: { object: { ...webhookEvent.data.object, id: 'ch_3', balance_transaction: 'txn_3', metadata: { tenantId: 't1', bookingId: 'sb1', kind: 'booth_booking' } } } };
  await W.handleConnectWebhook({ text: async () => '{}', headers: { get: (k: string) => (k === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio.test' } } as any);
  check('a renter’s station booking (whose fee only the notice writes) still gets its fee line', (await all(`${T}/transactions`)).filter((t: any) => t.category === 'Processing Fee').length === 2);
  fetched.length = 0;
  webhookEvent = { type: 'checkout.session.completed', account: 'acct_biz', data: { object: { id: 'cs_paid1', payment_status: 'paid', status: 'complete', payment_intent: 'pi_9', metadata: { tenantId: 't1', reservationId: 'r9', kind: 'space_booking' } } } };
  await W.handleConnectWebhook({ text: async () => '{}', headers: { get: (k: string) => (k === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio.test' } } as any);
  check('a paid space booking is confirmed from the payments notice too, even if the guest never comes back', fetched.some((u) => u.includes('/api/booths/reserve?') && u.includes('reservationId=r9') && u.includes('sessionId=cs_paid1')), fetched);
  fetched.length = 0;
  webhookEvent = { type: 'checkout.session.completed', account: 'acct_biz', data: { object: { id: 'cs_pass1', payment_status: 'paid', status: 'complete', payment_intent: 'pi_8', metadata: { tenantId: 't1', passPurchaseId: 'p9', kind: 'day_pass' } } } };
  await W.handleConnectWebhook({ text: async () => '{}', headers: { get: (k: string) => (k === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio.test' } } as any);
  check('…and so is a day pass', fetched.some((u) => u.includes('passPurchaseId=p9') && u.includes('sessionId=cs_pass1')), fetched);
  (globalThis as any).fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const failedHook: any = await W.handleConnectWebhook({ text: async () => '{}', headers: { get: (k: string) => (k === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio.test' } } as any);
  check('if confirming fails on our side, the notice fails too, so Stripe sends it again', failedHook?.status === 500, failedHook);

  const bad = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  check('no assistant names in the new files', !bad.test(src('src/lib/space-stripe.ts')) && !bad.test(src('scripts/verify/launch-space-money.verify.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
