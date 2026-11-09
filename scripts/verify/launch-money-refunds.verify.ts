// Checks money back to a renter's card, and the receipts that go with renter card money (launch L15f, part two):
// - What a renter paid by card from their account (rent online, autopay, an agreed charge from the card on file) is
//   listed with what can still go back; nothing else is (cash, a day booking, someone else's).
// - A refund goes to the same card on the account it was paid on, under one key per request, is claimed first so it
//   can never go past what was paid (two at once, a refund already on its way, one made in Stripe that isn't on the
//   books yet), and is recorded once: the books line, the payment's refunded total, the renter's account lines (money
//   back, and the same taken off when it's not owed again, or left open as owed when it is), and a portal note.
// - Stripe saying no lets the claim go; no answer keeps it, and asking again replays the same refund. A claim nobody
//   finished is checked against Stripe after a while: recorded if it went through, let go if not.
// - The renter is told once (Messages: "Refund to card"), filed under them, whether the screen or Stripe's notice of the
//   refund records it. A refund made in the Stripe Dashboard goes on their account too, and the owners are told.
// - An agreed charge taken from the card on file sends the renter a receipt, once.
// - The account statement counts rent paid by card, so someone who pays online doesn't show as owing.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-money-refunds.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.RESEND_API_KEY = 're_test'; process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <hello@mail.example.com>'; process.env.STRIPE_SECRET_KEY = 'sk_test';
let db: any = strictTransactions(makeDb());
let actorNow: any = { uid: 'm1', name: 'Max', role: 'manager', isManager: true, caps: ['checkout.refund'] };
class FakeResponse { status: number; body: any; headers: any; constructor(body?: any, init?: any) { this.body = body; this.status = init?.status || 200; this.headers = init?.headers; }
  static json(body: any, init?: any) { return new FakeResponse(body, init); } }

// Stripe: where each payment lives, what it took and what's gone back; refunds by key, so a replay returns the same one.
const S: any = { pis: {} as Record<string, any>, refunds: [] as any[], creates: [] as any[], mode: 'ok' as 'ok' | 'refuse' | 'silent' | 'down', byKey: {} as Record<string, any>, retrieves: 0 };
function StripeMock(this: any) {
  return {
    paymentIntents: { retrieve: async (id: string, _p: any, opts: any) => {
      S.retrieves++;
      if (S.mode === 'down') { const e: any = new Error('socket hang up'); e.type = 'StripeConnectionError'; throw e; }
      const p = S.pis[id]; const acct = opts?.stripeAccount || null;
      if (!p || (p.account || null) !== acct) { const e: any = new Error('No such payment_intent'); e.code = 'resource_missing'; e.type = 'StripeInvalidRequestError'; throw e; }
      return { id, amount: p.cents, amount_received: p.cents, latest_charge: { id: `ch_${id}`, amount_refunded: p.refunded || 0, payment_method_details: { card: { brand: 'visa', last4: '4242' } } } };
    } },
    refunds: {
      create: async (params: any, opts: any) => {
        S.creates.push({ params, opts });
        if (S.mode === 'refuse') { const e: any = new Error('Charge has been disputed'); e.type = 'StripeInvalidRequestError'; throw e; }
        if (S.mode === 'silent') { const e: any = new Error('socket hang up'); e.type = 'StripeConnectionError'; throw e; }
        const k = opts?.idempotencyKey;
        if (k && S.byKey[k]) return S.byKey[k];
        const rf = { id: `re_${S.refunds.length + 1}`, status: 'succeeded', amount: params.amount, payment_intent: params.payment_intent, metadata: params.metadata || {}, account: opts?.stripeAccount || null };
        S.refunds.push(rf); if (k) S.byKey[k] = rf;
        const p = S.pis[params.payment_intent]; if (p) p.refunded = (p.refunded || 0) + params.amount;
        return rf;
      },
      list: async (params: any) => ({ data: S.refunds.filter((r: any) => r.payment_intent === params.payment_intent) }),
    },
  };
}
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: FakeResponse };
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock, __esModule: true });
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/print-link' || /\/src\/lib\/print-link(\.ts)?$/.test(request)) return fake(request, { printLinkValid: () => true, printLinkExpired: () => FakeResponse.json({ ok: false }, { status: 410 }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async () => (actorNow ? { actor: actorNow } : { deny: FakeResponse.json({ ok: false }, { status: 401 }) }),
    requireCan: async (_r: any, _t: any, cap: string) => (!actorNow ? { deny: FakeResponse.json({ ok: false }, { status: 401 }) }
      : (actorNow.isTenantOwner || (actorNow.caps || []).includes(cap)) ? { actor: actorNow } : { deny: FakeResponse.json({ ok: false, error: 'Your role doesn’t allow that' }, { status: 403 }) }),
    staffOrServer: async () => !!actorNow });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const mails: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => { if (String(url).includes('resend')) mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: `m${mails.length}` }), text: async () => '' }; };
const toMaya = () => mails.filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes('maya@example.com'));
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: () => '' } } as any);
const getReq = (q: Record<string, string>) => ({ nextUrl: { searchParams: new URLSearchParams(q) }, headers: { get: () => '' } } as any);

async function fresh() {
  db = strictTransactions(makeDb()); mails.length = 0;
  Object.assign(S, { pis: {}, refunds: [], creates: [], mode: 'ok', byKey: {}, retrieves: 0 });
  await db.doc(T).set({ name: 'Northside Studio', timezone: 'America/New_York', publicOrigin: 'https://northside.example.com', stripeAccountId: 'acct_biz' });
  await db.doc(`${T}/renters/rt1`).set({ firstName: 'Maya', lastName: 'Ortiz', email: 'maya@example.com', status: 'active', cardBrand: 'visa', cardLast4: '4242' });
  await db.doc(`${T}/renters/rt2`).set({ firstName: 'Ben', lastName: 'Lee', email: 'ben@example.com', status: 'active' });
  await db.doc(`${T}/staff/own1`).set({ role: 'owner', name: 'Dana' });
  await db.doc(`${T}/leases/l1`).set({ renterId: 'rt1', boothId: 'b1', status: 'active', frequency: 'monthly', dueDay: '1', rentAmountCents: 90000, startDate: '2026-01-01' });
  // Rent paid online (Nov), by autopay (Oct), and an agreed charge from the card on file.
  await db.doc(`${T}/rentInvoices/inv_nov`).set({ renterId: 'rt1', leaseId: 'l1', status: 'paid', amountCents: 90000, lateFeeCents: 0, dueDate: '2026-11-01', paidSessionId: 'cs_1', stripePaymentIntentId: 'pi_on' });
  await db.doc(`${T}/rentInvoices/inv_oct`).set({ renterId: 'rt1', leaseId: 'l1', status: 'paid', amountCents: 51000, lateFeeCents: 0, paidCents: 51000, dueDate: '2026-10-14', paidVia: 'autopay', autopayIntentId: 'pi_ap', ledgerEntryId: 'apl1' });
  await db.doc(`${T}/rentLedger/apl1`).set({ renterId: 'rt1', leaseId: 'l1', type: 'rent_charge', status: 'paid', amountCents: 51000, stripePaymentIntentId: 'pi_ap', description: 'Autopay rent charge' });
  await db.doc(`${T}/transactions/rentpay_cs1`).set({ type: 'income', source: 'booth_rent', category: 'Booth Rent', amount: 900, sourceId: 'inv_nov', renterId: 'rt1', stripePaymentIntentId: 'pi_on', paymentMethod: 'Card (Stripe)', date: '2026-11-01T15:00:00Z', description: 'Booth rent — due 2026-11-01 (paid online)', clientOrVendor: 'Maya Ortiz', stripeConnectedAccountId: 'acct_biz' });
  await db.doc(`${T}/transactions/ap1`).set({ type: 'income', source: 'booth_rent', category: 'Booth Rent', amount: 510, sourceId: 'inv_oct', renterId: 'rt1', leaseId: 'l1', stripePaymentIntentId: 'pi_ap', paymentMethod: 'Card on file (Stripe autopay)', date: '2026-10-14T13:00:00Z', description: 'Rent — Suite 4 (due 2026-10-14, autopay)', clientOrVendor: 'Maya Ortiz' });
  await db.doc(`${T}/transactions/renterinc_rt1_k1`).set({ type: 'income', source: 'booth_rent', category: 'Renter Incidental', amount: 25, sourceId: 'rt1', renterId: 'rt1', stripePaymentIntentId: 'pi_inc', paymentMethod: 'Card on file (Stripe)', date: '2026-11-03T15:00:00Z', description: 'Lost key — Maya Ortiz (card on file)', clientOrVendor: 'Maya Ortiz' });
  // Not refundable here: cash recorded by hand, a day booking, someone else's rent.
  await db.doc(`${T}/transactions/booth_rent__recpay_x`).set({ type: 'income', source: 'booth_rent', category: 'Booth Rent', amount: 100, sourceId: 'recpay_x', renterId: 'rt1', paymentMethod: 'Cash', date: '2026-09-01' });
  await db.doc(`${T}/transactions/boothrent_res1`).set({ type: 'income', source: 'booth_rent', category: 'Booth Rent', amount: 60, sourceId: 'res1', renterId: 'rt1', stripePaymentIntentId: 'pi_day', date: '2026-09-02' });
  await db.doc(`${T}/transactions/boothinc_res1`).set({ type: 'income', source: 'booth_rent', category: 'Renter Incidental', amount: 15, sourceId: 'res1', renterId: 'rt1', stripePaymentIntentId: 'pi_dayinc', date: '2026-09-02' });
  // Rent paid online before payment lines carried the renter: found by the bill.
  await db.doc(`${T}/rentInvoices/inv_sep`).set({ renterId: 'rt1', leaseId: 'l1', status: 'paid', amountCents: 90000, lateFeeCents: 0, dueDate: '2026-09-01', paidSessionId: 'cs_old' });
  await db.doc(`${T}/transactions/rentpay_csold`).set({ type: 'income', source: 'booth_rent', category: 'Booth Rent', amount: 900, sourceId: 'inv_sep', renterId: null, stripePaymentIntentId: 'pi_old', paymentMethod: 'Card (Stripe)', date: '2026-09-01T15:00:00Z' });
  await db.doc(`${T}/transactions/rentpay_ben`).set({ type: 'income', source: 'booth_rent', category: 'Booth Rent', amount: 700, sourceId: 'inv_ben', renterId: 'rt2', stripePaymentIntentId: 'pi_ben', date: '2026-11-01' });
  S.pis = { pi_on: { cents: 90000, account: 'acct_biz' }, pi_ap: { cents: 51000, account: 'acct_biz' }, pi_inc: { cents: 2500, account: null }, pi_old: { cents: 90000, account: null } };
}

(async () => {
  const RR = await import('../../src/lib/renter-refund');
  const P = await import('../../src/lib/rent-payment-plan');
  const route = await import('../../src/app/api/rent/refund/route');

  console.log('What can be refunded');
  await fresh();
  let r: any = await route.GET(getReq({ tenantId: 't1', renterId: 'rt1' }));
  const list = r.body.payments || [];
  check('rent paid online, autopay and an agreed charge are listed, newest first, older lines found by their bill', list.map((p: any) => p.id).join() === 'renterinc_rt1_k1,rentpay_cs1,ap1,rentpay_csold', list.map((p: any) => p.id));
  check('cash, a day booking, its extras and another renter’s payment are not', !list.some((p: any) => ['booth_rent__recpay_x', 'boothrent_res1', 'boothinc_res1', 'rentpay_ben'].includes(p.id)));
  check('each says what it was and what can still go back', list.find((p: any) => p.id === 'ap1')?.label === 'Autopay, rent due Oct 14, 2026' && list.find((p: any) => p.id === 'rentpay_csold')?.refundableCents === 90000 && list.find((p: any) => p.id === 'ap1')?.refundableCents === 51000
    && list.find((p: any) => p.id === 'renterinc_rt1_k1')?.label === 'Agreed charge: Lost key', list);
  check('the card each was paid with comes from Stripe, wherever the payment is', list.find((p: any) => p.id === 'ap1')?.card?.last4 === '4242' && list.find((p: any) => p.id === 'renterinc_rt1_k1')?.card?.last4 === '4242');
  actorNow = { uid: 's1', name: 'Sam', role: 'staff', caps: [] };
  r = await route.GET(getReq({ tenantId: 't1', renterId: 'rt1' }));
  const r2: any = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 100, requestId: 'req-nope-0001' }));
  check('only someone allowed to refund can list or refund', r.status === 403 && r2.status === 403 && S.creates.length === 0);
  actorNow = { uid: 'm1', name: 'Max', role: 'manager', isManager: true, caps: ['checkout.refund'] };

  console.log('A refund, not owed again');
  await fresh();
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 6000, reason: 'The water was off on Oct 20', requestId: 'req-ref-0001' }));
  const c0 = S.creates[0] || {};
  check('it goes back to the card, on the business’s account, under one key for the request', r.body.ok === true && c0.params?.payment_intent === 'pi_ap' && c0.params?.amount === 6000 && c0.opts?.stripeAccount === 'acct_biz'
    && c0.opts?.idempotencyKey === 'renter-refund-ap1-req-ref-0001' && c0.params?.metadata?.origin === 'app' && c0.params?.metadata?.kind === 'renter_refund', c0);
  const line = await get(`${T}/transactions/rentrefund_re_1`);
  check('the books get a refund line that undoes part of the rent payment', line?.type === 'reversal' && line.reversalOf === 'ap1' && line.amount === 60 && line.renterId === 'rt1' && line.stripeRefundId === 're_1' && line.source === undefined, line);
  const ap = await get(`${T}/transactions/ap1`);
  check('the payment says how much has gone back', ap.refundedCents === 6000 && ap.renterRefunds?.['req-ref-0001']?.state === 'refunded');
  const rrf = await get(`${T}/rentLedger/rrf_re_1`); const rrw = await get(`${T}/rentLedger/rrw_re_1`);
  check('their account shows the refund, and the same taken off so it isn’t owed', rrf?.type === 'card_refund' && rrf.amountCents === 6000 && rrf.status === 'refunded' && rrw?.type === 'refund_waiver' && rrw.amountCents === -6000 && rrw.status === 'refunded', { rrf, rrw });
  let inv = await all(`${T}/rentInvoices`); let led = await all(`${T}/rentLedger`);
  check('what they owe doesn’t change', P.accountPosition(inv, led).owedCents === 0 && P.planRentPayment(1000, inv, led).charges.length === 0);
  const alert = await get(`${T}/renterAlerts/refund_re_1`);
  check('their portal says it, with the reason', alert?.renterId === 'rt1' && /\$60\.00 was refunded to Visa ending 4242/.test(alert.text) && /water was off/.test(alert.text), alert);
  const m1 = toMaya();
  check('they’re sent one refund notice, saying how much, to which card, and why', m1.length === 1 && /Refund: \$60\.00 back to your card/.test(m1[0].subject) && /Visa ending 4242/.test(m1[0].html) && /water was off/.test(m1[0].html), m1.map((m) => m.subject));
  const logs = (await all(`${T}/messageLog`)).filter((x: any) => x.kind === 'renter_refund');
  check('the notice is filed under the renter', logs.length >= 1 && logs.every((x: any) => x.recipientType === 'renter' && x.recipientId === 'rt1'), logs);
  check('the activity log says who refunded what, once', (await all(`${T}/auditLogs`)).filter((a: any) => a.action === 'rent.card_refund' && /\$60\.00/.test(a.summary) && a.actor?.name === 'Max').length === 1);
  check('the notice says what it was for in plain words', /for your autopay rent payment for the bill due Oct 14, 2026/.test(m1[0].html), m1[0].html.slice(0, 600));
  check('the screen is told where it went', r.body.refundedCents === 6000 && r.body.card?.last4 === '4242' && /Maya by email/.test(String(r.body.sentTo)));
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 6000, reason: 'The water was off on Oct 20', requestId: 'req-ref-0001' }));
  check('pressing Refund again sends nothing more', r.body.already === true && S.creates.length === 1 && toMaya().length === 1 && (await all(`${T}/rentLedger`)).length === led.length);
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 50000, requestId: 'req-ref-0002' }));
  check('never more than is left', r.status === 409 && /Only \$450\.00/.test(r.body.error) && S.creates.length === 1, r.body);
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt2', transactionId: 'ap1', amountCents: 100, requestId: 'req-ref-0003' }));
  check('never someone else’s payment', r.status === 404 && S.creates.length === 1);
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'booth_rent__recpay_x', amountCents: 100, requestId: 'req-ref-0004' }));
  check('never a payment that wasn’t by card from their account', r.status === 400 && S.creates.length === 1);
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'boothinc_res1', amountCents: 100, requestId: 'req-ref-0005' }));
  check('nor a day booking’s extras (refunded with the booking)', r.status === 400 && S.creates.length === 1);
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'rentpay_csold', amountCents: 2000, requestId: 'req-ref-0006' }));
  check('an older payment without the renter on it is theirs by its bill, and refunded where it was paid', r.body.ok === true && S.creates[1]?.opts?.stripeAccount === undefined && (await get(`${T}/rentLedger/rrf_re_2`))?.renterId === 'rt1', r.body);
  const MR = await import('../../src/lib/money-refund');
  const mr: any = await MR.refundSaleToCard(db, 't1', await get(T), 'ap1', 1000, 'Max');
  check('Money sends a renter’s payment to the Rent page to refund, so their account follows', mr.ok === false && mr.status === 409 && /Refund on the Rent page/.test(mr.error) && S.creates.length === 2, mr);
  await db.doc(`${T}/transactions/oldline1`).set({ type: 'income', source: 'booth_rent', category: 'Booth Rent', amount: 900, sourceId: 'inv_sep', stripePaymentIntentId: 'pi_old', date: '2026-09-01' });
  const mr2: any = await MR.refundSaleToCard(db, 't1', await get(T), 'oldline1', 1000, 'Max');
  check('also a rent payment written before lines were named after it', mr2.ok === false && /Refund on the Rent page/.test(String(mr2.error)) && (await RR.isRenterAccountPaymentIn(db, 't1', 'oldline1', await get(`${T}/transactions/oldline1`))), mr2);

  console.log('The same request, another amount');
  await fresh();
  S.mode = 'silent';
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 5000, requestId: 'req-amt-0001' }));
  check('no answer from Stripe tells the screen to ask again as it was', r.status === 502 && r.body.retry === true);
  S.mode = 'ok';
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 9000, requestId: 'req-amt-0001' }));
  check('asked again for a different amount, it’s refused, never sent as the old one', r.status === 409 && /already started for \$50\.00/.test(r.body.error) && S.creates.length === 1, r.body);
  await fresh();
  S.mode = 'down';
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 5000, requestId: 'req-dwn-0001' }));
  check('when Stripe can’t even be asked about the payment, nothing is held back', r.status === 502 && !r.body.retry && RR.refundableCents(await get(`${T}/transactions/ap1`)) === 51000 && S.creates.length === 0, r.body);
  S.mode = 'ok';

  console.log('Two at once, and Stripe’s own count');
  await fresh();
  await db.doc(`${T}/transactions/ap1`).set({ renterRefunds: { 'other-req-01': { state: 'refunding', cents: 48000, at: new Date().toISOString() } } }, { merge: true });
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 5000, requestId: 'req-two-0001' }));
  check('a refund already on its way counts against what’s left', r.status === 409 && /Only \$30\.00/.test(r.body.error) && S.creates.length === 0, r.body);
  await fresh();
  S.pis.pi_on.refunded = 85000;   // refunded in the Stripe Dashboard, not on the books yet
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'rentpay_cs1', amountCents: 10000, requestId: 'req-two-0002' }));
  const onLine = await get(`${T}/transactions/rentpay_cs1`);
  check('Stripe’s count of what’s gone back is checked too, and the claim let go', r.status === 409 && /only \$50\.00/.test(r.body.error) && S.creates.length === 0 && onLine.renterRefunds?.['req-two-0002']?.state === 'released', r.body);

  console.log('Still owed');
  await fresh();
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'rentpay_cs1', amountCents: 10000, reason: 'Paid with the wrong card', stillOwed: true, requestId: 'req-owe-0001' }));
  const owed = await get(`${T}/rentLedger/rrf_re_1`);
  check('the refund stays on their account as owed, due today', r.body.ok && r.body.stillOwed === true && owed?.status === 'pending' && owed.stillOwed === true && /^\d{4}-\d{2}-\d{2}$/.test(owed.dueDate) && !(await get(`${T}/rentLedger/rrw_re_1`)), owed);
  inv = await all(`${T}/rentInvoices`); led = await all(`${T}/rentLedger`);
  check('it counts in what they owe, and a payment recorded later pays it', P.accountPosition(inv, led).owedCents === 10000 && P.planRentPayment(10000, inv, led).charges[0]?.id === 'rrf_re_1');
  check('their notice says it’s still owed', /still owed/.test(String(toMaya()[0]?.html || '')));
  await fresh();
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'renterinc_rt1_k1', amountCents: 2500, stillOwed: true, requestId: 'req-owe-0002' }));
  check('an agreed charge refunded is never left owed', r.body.ok && r.body.stillOwed === false && (await get(`${T}/rentLedger/rrw_re_1`))?.amountCents === -2500);
  check('a payment from before the business’s own account is refunded where it was paid', S.creates[0]?.opts?.stripeAccount === undefined && S.creates[0]?.params?.payment_intent === 'pi_inc', S.creates[0]);

  console.log('When Stripe says no, or doesn’t answer');
  await fresh();
  S.mode = 'refuse';
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 6000, requestId: 'req-no-00001' }));
  check('a refusal records nothing and lets the claim go', r.status === 400 && /disputed/.test(r.body.error) && !(await get(`${T}/rentLedger/rrf_re_1`)) && RR.refundableCents(await get(`${T}/transactions/ap1`)) === 51000, r.body);
  S.mode = 'silent';
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 6000, requestId: 'req-no-00002' }));
  const held = await get(`${T}/transactions/ap1`);
  check('no answer keeps the claim, so nothing else can take that money', r.status === 502 && held.renterRefunds?.['req-no-00002']?.state === 'refunding' && RR.refundableCents(held) === 45000);
  S.mode = 'ok';
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 6000, requestId: 'req-no-00002' }));
  check('asking again sends it under the same key and records it once', r.body.ok && S.creates.filter((c: any) => c.opts?.idempotencyKey === 'renter-refund-ap1-req-no-00002').length === 2 && S.refunds.length === 1
    && (await get(`${T}/transactions/ap1`)).refundedCents === 6000 && (await all(`${T}/rentLedger`)).filter((x: any) => x.type === 'card_refund').length === 1);

  console.log('The money went back but the record couldn’t be written');
  await fresh();
  { const real = db.runTransaction.bind(db); let calls = 0; db.runTransaction = async (fn: any) => { calls++; if (calls === 2) throw new Error('contention'); return real(fn); };
    r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 7000, reason: 'Short week', requestId: 'req-rec-0001' }));
    db.runTransaction = real; }
  check('the screen is told it went back, not that nothing was refunded', r.body.ok === true && r.body.recordPending === true && S.refunds.length === 1, r.body);
  const SW = await import('../../src/lib/money-sweep');
  const sw: any = await SW.sweepMoneyOnTheWay(db, 't1', await get(T), { stripe: new (StripeMock as any)(), now: Date.now() + 20 * 60000 });
  check('the five-minute check finds it at Stripe and records it, once, and the renter is told', sw.byKind.renterRefunds?.recorded === 1 && !!(await get(`${T}/rentLedger/rrf_re_1`)) && (await get(`${T}/transactions/ap1`)).refundedCents === 7000
    && !(await get(`${T}/transactions/ap1`)).renterRefundOpenAt && toMaya().length === 1 && /Short week/.test(toMaya()[0].html), sw.byKind.renterRefunds);

  console.log('A claim nobody finished');
  await fresh();
  const old = new Date(Date.now() - 20 * 60000).toISOString();
  await db.doc(`${T}/transactions/ap1`).set({ renterRefunds: { 'lost-req-001': { state: 'refunding', cents: 51000, at: old } } }, { merge: true });
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 1000, requestId: 'req-late-001' }));
  check('one that never reached Stripe is let go after a while, so the money can be refunded', r.body.ok && (await get(`${T}/transactions/ap1`)).renterRefunds?.['lost-req-001']?.state === 'released', r.body);
  await fresh();
  S.refunds.push({ id: 're_lost', status: 'succeeded', amount: 3000, payment_intent: 'pi_ap', metadata: { requestId: 'lost-req-002', kind: 'renter_refund' } }); S.pis.pi_ap.refunded = 3000;
  await db.doc(`${T}/transactions/ap1`).set({ renterRefunds: { 'lost-req-002': { state: 'refunding', cents: 3000, at: old, reason: 'Late opening' } } }, { merge: true });
  r = await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 49000, requestId: 'req-late-002' }));
  check('one that did go through is recorded, and counts against what’s left', !!(await get(`${T}/rentLedger/rrf_re_lost`)) && (await get(`${T}/transactions/ap1`)).refundedCents === 3000 && r.status === 409 && /Only \$480\.00/.test(r.body.error), r.body);

  console.log('Stripe’s notice of a refund');
  await fresh();
  const tData = await get(T);
  // The screen never heard back: the claim is open, the refund went through.
  await db.doc(`${T}/transactions/rentpay_cs1`).set({ renterRefunds: { 'req-hook-001': { state: 'refunding', cents: 5000, at: new Date().toISOString(), reason: 'Goodwill' } } }, { merge: true });
  const charge = { id: 'ch_on', payment_intent: 'pi_on', captured: true, amount: 90000, amount_captured: 90000, payment_method_details: { card: { brand: 'visa', last4: '4242' } } };
  const appRf = { id: 're_app', status: 'succeeded', amount: 5000, created: Math.floor(Date.now() / 1000), metadata: { kind: 'renter_refund', origin: 'app', transactionId: 'rentpay_cs1', requestId: 'req-hook-001' } };
  let who: any = await RR.noticeRenterRefund(db, 't1', tData, charge, appRf, { kind: 'rent_invoice', invoiceId: 'inv_nov', tenantId: 't1' }, { piId: 'pi_on', outside: false });
  check('the app’s own refund is recorded from the notice when the screen never heard back', who?.recorded === true && !!(await get(`${T}/transactions/rentrefund_re_app`)) && (await get(`${T}/transactions/rentpay_cs1`)).renterRefunds['req-hook-001'].state === 'refunded');
  await RR.noticeRenterRefund(db, 't1', tData, charge, appRf, { kind: 'rent_invoice', invoiceId: 'inv_nov' }, { piId: 'pi_on', outside: false });
  check('the same notice twice records and tells them once', toMaya().length === 1 && (await all(`${T}/rentLedger`)).filter((x: any) => x.type === 'card_refund').length === 1);
  // Made in the Stripe Dashboard.
  const OR = await import('../../src/lib/outside-refund');
  const dashRf = { id: 're_dash', status: 'succeeded', amount: 2000, created: Math.floor(Date.now() / 1000), metadata: {} };
  check('a Dashboard refund is one made outside the app', OR.notOutside(charge, dashRf) === null && OR.notOutside(charge, appRf) === 'app');
  who = await RR.noticeRenterRefund(db, 't1', tData, charge, dashRf, { kind: 'rent_invoice', invoiceId: 'inv_nov' }, { piId: 'pi_on', outside: true });
  await OR.recordOutsideRefund(db, 't1', charge, dashRf, { kind: 'rent_invoice' }, { piId: 'pi_on', account: 'acct_biz', lineExtra: { renterId: who.renterId, rentRefundOf: who.transactionId },
    accountNote: who?.onAccount ? `It’s also on ${who.name}’s account as money back they don’t owe again. If they still owe it, add it as a charge on the Rent page.` : null });
  const dl = await get(`${T}/rentLedger/rrf_re_dash`);
  check('it goes on their account as money back they don’t owe again', dl?.outsideApp === true && dl.status === 'refunded' && (await get(`${T}/rentLedger/rrw_re_dash`))?.amountCents === -2000, dl);
  const dline = await get(`${T}/transactions/stripe_refund_re_dash`);
  check('the books line is the Dashboard refund’s own, written once, naming the renter and the payment', !!dline && dline.renterId === 'rt1' && dline.rentRefundOf === 'rentpay_cs1' && !(await get(`${T}/transactions/rentrefund_re_dash`)), dline);
  const RH = await import('../../src/lib/renter-rent-history');
  check('so their rent history counts it against what they paid', (await RH.renterRentPayments(db, 't1', { renterId: 'rt1' })).some((x: any) => x.id === 'stripe_refund_re_dash'));
  const note = (await all(`${T}/notifications`)).find((x: any) => String(x.id).startsWith('outsiderefund_re_dash'));
  check('the owners are told, and how to bill it again if it is still owed', /Maya Ortiz’s account/.test(String(note?.message)) && /add it as a charge on the Rent page/.test(String(note?.message)), note);
  check('the renter is told about it', toMaya().length === 2 && /\$20\.00/.test(toMaya()[1].subject));
  // Money a bill didn't need, sent back when it was paid: no line of its own in the books.
  const twice = { id: 're_twice', status: 'succeeded', amount: 90000, created: Math.floor(Date.now() / 1000), metadata: { tenantId: 't1', invoiceId: 'inv_nov', kind: 'rent_refund', why: 'paid_twice', origin: 'app' } };
  who = await RR.noticeRenterRefund(db, 't1', tData, { ...charge, payment_intent: 'pi_second' }, twice, { kind: 'rent_invoice', invoiceId: 'inv_nov' }, { piId: 'pi_second', outside: false });
  check('a second payment sent back is told to the renter, found by their bill, with why', who?.renterId === 'rt1' && toMaya().length === 3 && /already paid/.test(String(toMaya()[2].html)) && !(await get(`${T}/rentLedger/rrf_re_twice`)));
  const hook = src('src/lib/connect-webhook.ts');
  check('the payments notice sends renters’ refunds this way, not as a client’s', hook.includes('noticeRenterRefund(db, tenant.id, tData, charge, rf, meta') && /renterPay \|\| \['renter_refund', 'rent_refund'\]/.test(hook) && hook.includes('} else if (!shopOrder && !rf.metadata?.retailOrderId) {'));
  check('and if it can’t be written, the notice fails so Stripe sends it again, a few times, then the owners are told', hook.includes("console.error('[connect-webhook] renter refund', e);") && hook.includes('if (tries < 5) throw e;') && hook.includes('renterrefundfail_') && hook.includes('lineExtra });'));

  console.log('A receipt for an agreed charge');
  await fresh();
  const RI = await import('../../src/lib/renter-incidentals'); const ri = src('src/lib/renter-incidentals.ts');
  await db.doc(`${T}/renters/rt1/charges/inc_k1`).set({ status: 'charged', amountCents: 2500, description: 'Lost key', category: 'Keys' });
  await db.doc(`${T}/renterAlerts/charge_rt1_k1`).set({ renterId: 'rt1', text: '$25.00 was charged to Visa ending 4242 for Lost key, as set out in your rental agreement.' });
  const sent = await RI.tellRenterCharged(db, 't1', tData, 'rt1', 'k1');
  check('the renter gets a receipt saying what it was for and which card', /Maya by email/.test(String(sent)) && /Receipt: \$25\.00 for Lost key/.test(toMaya()[0]?.subject) && /Visa ending 4242/.test(toMaya()[0]?.html), toMaya().map((m) => m.subject));
  check('the note in their portal is written with the charge itself', ri.includes("const alertRef = db.doc(`tenants/${tenantId}/renterAlerts/charge_${safeKey(renterId)}_${key}`);") && ri.indexOf('renterAlerts/charge_') < ri.indexOf('export async function tellRenterCharged'));
  await RI.tellRenterCharged(db, 't1', tData, 'rt1', 'k1');
  check('once', toMaya().length === 1);
  await db.doc(`${T}/renters/rt1/charges/inc_k2`).set({ status: 'charging', amountCents: 2500 });
  check('never for a charge that hasn’t gone through', (await RI.tellRenterCharged(db, 't1', tData, 'rt1', 'k2')) === null && toMaya().length === 1);
  const sc = src('src/app/api/booths/setup-card/route.ts');
  check('the charge screen sends it, also when the same charge is asked again', (sc.match(/tellRenterCharged\(db, String\(tenantId\), tenantDoc, String\(renterId\), key\)/g) || []).length === 3 && /if \(wrote\) \{\s*const tenant: any = [^\n]+\n\s*await tellRenterCharged\(db, tenantId, tenant, renterId, key\)/.test(ri));
  // A charge recorded but the receipt never sent (the screen stopped part way): the five-minute check sends it.
  await db.doc(`${T}/renters/rt1/charges/inc_k3`).set({ status: 'charged', amountCents: 4000, description: 'Extra cleaning' });
  const old3 = new Date(Date.now() - 10 * 60000).toISOString();
  await db.doc(`${T}/renters/rt1`).set({ incidentalTellDue: { k3: old3 }, incidentalTellDueAt: old3 }, { merge: true });
  await RI.settleLostRenterIncidentals(db, 't1', tData, { stripe: new (StripeMock as any)() });
  const rt = await get(`${T}/renters/rt1`);
  check('a receipt the screen never sent is sent by the five-minute check, once', toMaya().length === 2 && /\$40\.00 for Extra cleaning/.test(toMaya()[1].subject) && !rt.incidentalTellDueAt && rt.incidentalTellDue?.k3 == null, rt);
  await RI.settleLostRenterIncidentals(db, 't1', tData, { stripe: new (StripeMock as any)() });
  check('and not again', toMaya().length === 2);
  // A receipt whose send failed is tried again by the five-minute check (up to three times), not marked done.
  await db.doc(`${T}/renters/rt1/charges/inc_k4`).set({ status: 'charged', amountCents: 1500, description: 'Towels' });
  await db.doc(`${T}/renters/rt1`).set({ incidentalTellDue: { k4: old3 }, incidentalTellDueAt: old3 }, { merge: true });
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'down' }), text: async () => 'down' });
  await RI.tellRenterCharged(db, 't1', tData, 'rt1', 'k4');
  (globalThis as any).fetch = realFetch;
  const a4 = await get(`${T}/renters/rt1/charges/inc_k4`);
  check('a receipt that didn’t send is left to try again', !a4.renterToldAt && a4.renterTellTries === 1 && (await get(`${T}/renters/rt1`)).incidentalTellDue?.k4 === old3, a4);
  await RI.settleLostRenterIncidentals(db, 't1', tData, { stripe: new (StripeMock as any)() });
  check('and the five-minute check sends it', toMaya().some((m) => /\$15\.00 for Towels/.test(m.subject)) && !!(await get(`${T}/renters/rt1/charges/inc_k4`)).renterToldAt);
  const MP = await import('../../src/lib/message-policy');
  const kinds = (MP.MESSAGE_KINDS as any[]).filter((k) => ['renter_refund', 'renter_charge'].includes(k.id));
  check('both messages are in Messages, for renters, and can’t be switched off', kinds.length === 2 && kinds.every((k) => k.group === 'Renters' && k.canDisable === false && k.mandatoryNote));

  console.log('The account statement counts card payments');
  await fresh();
  const ST = await import('../../src/app/api/booths/account-statement/route');
  const stmt = async () => String((await ST.GET(getReq({ tenantId: 't1', renterId: 'rt1' }))).body || '');
  let html = await stmt();
  const bal = (h: string) => (h.match(/<span>Balance(?: owing)?<\/span><span>([^<]+)<\/span>/) || [])[1];
  check('someone paid up by card shows nothing owing', bal(html) === '$0.00' && html.includes('Payment — autopay') && html.includes('Payment — card, online') && html.includes('Agreed charge — Lost key'), bal(html));
  await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'ap1', amountCents: 6000, requestId: 'req-st-00001' }));
  html = await stmt();
  check('a refund not owed again leaves it at nothing, with both lines shown', bal(html) === '$0.00' && html.includes('Refund to Visa ending 4242') && html.includes('Refund: not owed again'), bal(html));
  await route.POST(req({ tenantId: 't1', renterId: 'rt1', transactionId: 'rentpay_cs1', amountCents: 10000, stillOwed: true, requestId: 'req-st-00002' }));
  html = await stmt();
  check('one still owed shows as owing', bal(html) === '$100.00', bal(html));
  check('a payment recorded by hand is counted once', src('src/app/api/booths/account-statement/route.ts').includes('if (named.has(id)) continue;'));

  console.log('Where it shows');
  const rent = src('src/app/(app)/rent/page.tsx'); const drawer = src('src/components/renters/RenterProfileDrawer.tsx'); const dlg = src('src/components/rent/RenterRefundDialog.tsx');
  check('Refund is on each renter on the Rent page and in their profile’s Money tab', rent.includes('onClick={() => setRefundRenter(renter)}') && rent.includes('<RenterRefundDialog') && drawer.includes('Refund a payment') && drawer.includes('<RenterRefundDialog'));
  check('the dialog asks whether it’s still owed (not for agreed charges) and keeps one request per ask', dlg.includes('Do they still owe this amount?') && dlg.includes("chosen.kind !== 'agreed'") && dlg.includes('useEffect(() => { if (!locked) setRequestId(nanoid(16)); setArmed(false); }, [sel, cents, reason, stillOwed, open]);') && dlg.includes('if (d.retry) setLocked(true); else setRequestId(nanoid(16));') && dlg.includes('Tap again to refund'));
  check('refunds come off what they paid in the yearly statement and their profile', src('src/app/api/booths/statement/route.ts').includes("t.type === 'reversal' || t.rentRefundOf ? -Math.abs(amount0) : amount0") && drawer.includes("return t.type === 'reversal' || t.rentRefundOf ? -Math.abs(v) : v;") && src('src/lib/renter-rent-history.ts').includes("x.source === 'booth_rent' || x.rentRefundOf"));
  check('new card payments say which account they were taken on', src('src/lib/rent-online-pay.ts').includes('...(account ? { stripeConnectedAccountId: account } : {})') && src('src/app/api/cron/autopay-leases/route.ts').includes('...(stripeAccountId ? { stripeConnectedAccountId: stripeAccountId } : {})') && ri.includes('...(o.account ? { stripeConnectedAccountId: o.account } : {})'));

  const bad = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  check('no assistant names in the changed files', ['src/lib/renter-refund.ts', 'src/app/api/rent/refund/route.ts', 'src/components/rent/RenterRefundDialog.tsx', 'scripts/verify/launch-money-refunds.verify.ts'].every((f) => !bad.test(src(f))));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
