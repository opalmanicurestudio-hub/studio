// Checks a renter's security deposit paid by card from their portal, and returned to that card (launch L15f, money
// round four):
// - The portal shows the deposit (due, held, kept and why, returned) and, when it's due and the business takes cards,
//   a Pay deposit button. One payment page per deposit, on the business's own account; two taps get the same page.
// - A paid page is recorded once (the renter's return or Stripe's notice), held in the books with the card payment on
//   it, and the renter gets a receipt. Paid after a deposit was recorded by hand, it goes straight back to the card,
//   and the renter and the owners are told.
// - A deposit paid by card is returned to that card: claimed on the deposit first, one key per request, recorded once,
//   itemized for the renter. A refusal lets it go; no answer keeps it and asking again replays it. One nobody finished
//   is settled by the five-minute check. One made in the Stripe Dashboard is recorded on the deposit, and in the books
//   as held money going out. Money doesn't refund a deposit around all this.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-deposit-card.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.RESEND_API_KEY = 're_test'; process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <hello@mail.example.com>'; process.env.STRIPE_SECRET_KEY = 'sk_test';
let db: any = strictTransactions(makeDb());
const actorNow: any = { uid: 'm1', name: 'Max', role: 'manager', isManager: true };
class FakeResponse { status: number; body: any; constructor(body?: any, init?: any) { this.body = body; this.status = init?.status || 200; }
  static json(body: any, init?: any) { return new FakeResponse(body, init); } }
const S: any = { piStatus: {} as Record<string, string>, sessions: new Map<string, any>(), creates: [] as any[], refunds: [] as any[], refundCalls: [] as any[], byKey: {} as Record<string, any>, mode: 'ok' as 'ok' | 'refuse' | 'silent', expired: [] as string[] };
function StripeMock(this: any) {
  return {
    checkout: { sessions: {
      create: async (p: any, o: any) => { S.creates.push({ p, o }); const id = `cs_test_${S.creates.length}`; const s = { id, url: `https://checkout.stripe.test/${id}`, status: 'open', payment_status: 'unpaid', amount_total: p.line_items[0].price_data.unit_amount, metadata: p.metadata, account: o?.stripeAccount || null }; S.sessions.set(id, s); return s; },
      retrieve: async (id: string, _p: any, o: any) => { const s = S.sessions.get(id); if (!s || (s.account || null) !== (o?.stripeAccount || null)) throw Object.assign(new Error('No such checkout session'), { code: 'resource_missing', type: 'StripeInvalidRequestError' }); return s; },
      expire: async (id: string) => { S.expired.push(id); const s = S.sessions.get(id); if (s) s.status = 'expired'; return { id }; },
    } },
    paymentIntents: { retrieve: async (id: string) => ({ id, status: S.piStatus[id] || 'succeeded', latest_charge: { id: `ch_${id}`, payment_method_details: { card: { brand: 'visa', last4: '4242' } } } }) },
    refunds: {
      create: async (p: any, o: any) => {
        S.refundCalls.push({ p, o });
        if (S.mode === 'refuse') { const e: any = new Error('Charge already refunded'); e.type = 'StripeInvalidRequestError'; throw e; }
        if (S.mode === 'silent') { const e: any = new Error('socket hang up'); e.type = 'StripeConnectionError'; throw e; }
        const k = o?.idempotencyKey; if (k && S.byKey[k]) return S.byKey[k];
        const rf = { id: `re_${S.refunds.length + 1}`, status: 'succeeded', amount: p.amount, payment_intent: p.payment_intent, metadata: p.metadata || {} };
        S.refunds.push(rf); if (k) S.byKey[k] = rf; return rf;
      },
      list: async (p: any) => ({ data: S.refunds.filter((r: any) => r.payment_intent === p.payment_intent) }),
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
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor: actorNow }), requireCan: async () => ({ actor: actorNow }), staffOrServer: async () => true });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const mails: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => { if (String(url).includes('resend')) mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: `m${mails.length}` }), text: async () => '' }; };
const toMaya = () => mails.filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes('maya@example.com'));
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://northside.example.com', searchParams: new URLSearchParams() } } as any);

async function fresh(lease: any = {}) {
  db = strictTransactions(makeDb()); mails.length = 0;
  Object.assign(S, { piStatus: {}, sessions: new Map(), creates: [], refunds: [], refundCalls: [], byKey: {}, mode: 'ok', expired: [] });
  await db.doc(T).set({ name: 'Northside Studio', timezone: 'America/New_York', publicOrigin: 'https://northside.example.com', stripeAccountId: 'acct_biz', stripeChargesEnabled: true });
  await db.doc(`${T}/renters/rt1`).set({ firstName: 'Maya', lastName: 'Ortiz', email: 'maya@example.com', status: 'active' });
  await db.doc(`${T}/booths/b1`).set({ name: 'Suite 4' });
  await db.doc(`${T}/leases/l1`).set({ renterId: 'rt1', boothId: 'b1', status: 'active', frequency: 'monthly', dueDay: '1', rentAmountCents: 90000, startDate: '2026-01-01',
    deposit: { amountCents: 50000, refundable: true, refundConditions: 'Returned within 30 days of move-out', collectedLedgerEntryId: null }, ...lease });
  await db.doc(`${T}/private/renterSessions`).set({ [createHash('sha256').update('tok').digest('hex')]: { contactKey: 'maya@example.com', name: 'Maya', renterId: 'rt1', expiresAt: Date.now() + 3600e3 } });
}
const paid = (id: string) => { const s = S.sessions.get(id); Object.assign(s, { status: 'complete', payment_status: 'paid', payment_intent: `pi_${id}` }); return s; };

(async () => {
  const Portal = await import('../../src/app/api/portal/renter/route');
  const portal = async (body: any) => { const r: any = await Portal.POST(req({ tenantId: 't1', token: 'tok', ...body })); return { status: r.status, ...(r.body || {}) }; };
  const RD = await import('../../src/lib/rent-deposit');
  const DA = await import('../../src/lib/deposit-accounting');
  const route = await import('../../src/app/api/rent/deposit/route');
  const pos = async () => DA.depositPosition({ id: 'l1', ...(await get(`${T}/leases/l1`)) }, (await all(`${T}/rentLedger`)).filter((l: any) => l.leaseId === 'l1'));

  console.log('Paying it from the portal');
  await fresh();
  let me: any = await portal({ action: 'me', today: '2026-11-09' });
  check('the portal shows the deposit due, payable here', me.lease?.deposit?.status === 'not_collected' && me.lease.deposit.agreedCents === 50000 && me.lease.deposit.canPayOnline === true, me.lease?.deposit);
  let r: any = await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://northside.example.com/rent/t1?tab=rent' });
  const c0 = S.creates[0];
  check('one payment page, on the business’s account, for the deposit agreed', r.ok && r.url && c0?.o?.stripeAccount === 'acct_biz' && c0.p.line_items[0].price_data.unit_amount === 50000 && c0.p.metadata.kind === 'rent_deposit' && c0.p.payment_intent_data.metadata.leaseId === 'l1'
    && /^rent-deposit-l1-50000-1$/.test(c0.o.idempotencyKey) && (await get(`${T}/leases/l1`)).deposit.stripeSessionId === 'cs_test_1', c0);
  r = await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://northside.example.com/rent/t1' });
  check('a second tap gets the same page', r.url === 'https://checkout.stripe.test/cs_test_1' && S.creates.length === 1);
  paid('cs_test_1');
  r = await portal({ action: 'confirm-deposit', leaseId: 'l1', sessionId: 'cs_test_1' });
  const line = (await all(`${T}/rentLedger`)).find((l: any) => l.type === 'deposit_charge');
  const bk = (await all(`${T}/transactions`)).find((t: any) => t.category === 'Booth Deposit');
  check('back from paying, it’s recorded as held, with the card payment on it', r.ok && r.paidCents === 50000 && line?.status === 'paid' && line.stripePaymentIntentId === 'pi_cs_test_1' && line.stripeConnectedAccountId === 'acct_biz'
    && bk?.taxBucket === 'transfer' && bk.stripePaymentIntentId === 'pi_cs_test_1' && (await pos()).status === 'held', { r, line, bk });
  check('the renter gets a receipt', toMaya().length === 1 && /We received your \$500\.00 security deposit \(Card, paid online\)/.test(toMaya()[0].html));
  r = await RD.recordCardDeposit(db, new (StripeMock as any)(), 't1', await get(T), 'l1', S.sessions.get('cs_test_1'), { account: 'acct_biz', today: '2026-11-09' });
  check('Stripe’s notice of the same payment records nothing more', r.ok && r.already && (await all(`${T}/rentLedger`)).filter((l: any) => l.type === 'deposit_charge').length === 1 && toMaya().length === 1);
  r = await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://northside.example.com/rent/t1' });
  me = await portal({ action: 'me', today: '2026-11-09' });
  check('once paid, it can’t be paid again, and shows as held', r.alreadyPaid === true && me.lease.deposit.status === 'held' && me.lease.deposit.canPayOnline === false && S.creates.length === 1);
  const hook = src('src/lib/connect-webhook.ts');
  check('Stripe’s notice of a paid page records it', hook.includes("if (session.metadata?.kind === 'rent_deposit') {") && hook.includes('recordCardDeposit(db, stripe2, tenant.id, tData, leaseId, session'));

  console.log('Not yet, or paid twice');
  await fresh({ status: 'pending_signature' });
  r = await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' });
  check('not before the lease is signed', r.status === 409 && /Sign your lease first/.test(r.error));
  await fresh();
  await db.doc(`${T}/renters/rt2`).set({ firstName: 'Ben', email: 'ben@example.com' });
  await db.doc(`${T}/leases/l2`).set({ renterId: 'rt2', status: 'active', deposit: { amountCents: 40000 } });
  r = await portal({ action: 'pay-deposit', leaseId: 'l2', returnUrl: 'https://x.example.com/rent/t1' });
  check('never someone else’s deposit', r.status === 403 && S.creates.length === 0);
  await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' });
  await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'received', methodLabel: 'Cash', requestId: 'cash-dep-0001' }));
  paid('cs_test_1'); mails.length = 0;
  r = await portal({ action: 'confirm-deposit', leaseId: 'l1', sessionId: 'cs_test_1' });
  const extra = S.refundCalls[0];
  check('paid by card after it was recorded by hand: the card payment goes straight back', r.extra === true && r.refunded === true && extra?.p?.payment_intent === 'pi_cs_test_1' && extra.o?.stripeAccount === 'acct_biz'
    && /^deposit-extra-/.test(extra.o.idempotencyKey) && (await pos()).collectedCents === 50000, { r, extra });
  check('and the renter and the owners are told', /already paid, so the \$500\.00 you just paid online was refunded to your card/.test(String(toMaya()[0]?.html)) && (await all(`${T}/notifications`)).some((x: any) => /refunded to their card/.test(String(x.message))));
  await portal({ action: 'confirm-deposit', leaseId: 'l1', sessionId: 'cs_test_1' });
  check('asked again, it isn’t refunded twice', S.refundCalls.length === 1);

  console.log('Returned to the card');
  await fresh();
  await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' }); paid('cs_test_1');
  await portal({ action: 'confirm-deposit', leaseId: 'l1', sessionId: 'cs_test_1' });
  await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'deduct', cents: 8000, reason: 'Broken mirror', requestId: 'ded-00000001' }));
  mails.length = 0;
  r = await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'refund', toCard: true, requestId: 'ret-00000001' }));
  const rc = S.refundCalls[0]; const rl = await get(`${T}/rentLedger/deprefund_ret-00000001`);
  check('what’s left goes back to the card it was paid with, under one key', r.body.ok && r.body.cents === 42000 && rc?.p?.payment_intent === 'pi_cs_test_1' && rc.p.amount === 42000 && rc.o?.stripeAccount === 'acct_biz'
    && rc.o.idempotencyKey === 'deposit-refund-l1-ret-00000001' && rc.p.metadata.kind === 'deposit_refund', { body: r.body, rc });
  check('recorded as returned, and out of held money in the books', rl?.status === 'paid' && rl.stripeRefundId === 're_1' && (await pos()).returnableCents === 0 && (await get(`${T}/transactions/deprefund_ret-00000001`))?.taxBucket === 'transfer');
  check('the renter is told, to which card, with every deduction', /We returned \$420\.00 of your security deposit to Visa ending 4242/.test(String(toMaya()[0]?.html)) && /Broken mirror −\$80\.00/.test(String(toMaya()[0]?.html)), toMaya()[0]?.html?.slice(0, 400));
  r = await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'refund', toCard: true, requestId: 'ret-00000001' }));
  check('pressing it again returns nothing more', r.body.already === true && S.refundCalls.length === 1);

  await fresh();
  await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'received', methodLabel: 'Check', requestId: 'chk-dep-0001' }));
  r = await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'refund', toCard: true, requestId: 'ret-00000002' }));
  check('a deposit paid by check can’t go back to a card', r.status === 409 && /wasn’t paid by card/.test(r.body.error) && S.refundCalls.length === 0);

  console.log('When Stripe says no, or doesn’t answer');
  await fresh();
  await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' }); paid('cs_test_1');
  await portal({ action: 'confirm-deposit', leaseId: 'l1', sessionId: 'cs_test_1' });
  S.mode = 'refuse';
  r = await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'refund', toCard: true, requestId: 'ret-00000003' }));
  check('a refusal lets the deposit go back to held', r.status === 400 && !(await get(`${T}/rentLedger/deprefund_ret-00000003`)) && (await pos()).returnableCents === 50000);
  S.mode = 'silent';
  r = await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'refund', toCard: true, requestId: 'ret-00000004' }));
  check('no answer keeps it on its way, so nothing else can take it', r.status === 502 && r.body.retry === true && (await get(`${T}/rentLedger/deprefund_ret-00000004`))?.status === 'refunding' && (await pos()).returnableCents === 0);
  S.mode = 'ok';
  r = await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'refund', toCard: true, cents: 50000, requestId: 'ret-00000004' }));
  check('asking again sends it under the same key and records it once', r.body.ok && S.refunds.length === 1 && (await get(`${T}/rentLedger/deprefund_ret-00000004`))?.status === 'paid' && (await all(`${T}/transactions`)).filter((t: any) => String(t.id).startsWith('deprefund_')).length === 1);

  console.log('One nobody finished');
  await fresh();
  await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' }); paid('cs_test_1');
  await portal({ action: 'confirm-deposit', leaseId: 'l1', sessionId: 'cs_test_1' });
  const old = new Date(Date.now() - 20 * 60000).toISOString();
  await db.doc(`${T}/rentLedger/deprefund_lost-0000001`).set({ leaseId: 'l1', renterId: 'rt1', type: 'deposit_refund', status: 'refunding', amountCents: -50000, stripePaymentIntentId: 'pi_cs_test_1', stripeConnectedAccountId: 'acct_biz', requestId: 'lost-0000001', createdAt: old });
  let sw = await RD.settleStuckSecurityDepositRefunds(db, 't1', await get(T), { stripe: new (StripeMock as any)() });
  check('one that never reached Stripe is let go, so the deposit is held again', sw.released === 1 && !(await get(`${T}/rentLedger/deprefund_lost-0000001`)) && (await pos()).returnableCents === 50000);
  await db.doc(`${T}/rentLedger/deprefund_lost-0000002`).set({ leaseId: 'l1', renterId: 'rt1', type: 'deposit_refund', status: 'refunding', amountCents: -50000, stripePaymentIntentId: 'pi_cs_test_1', stripeConnectedAccountId: 'acct_biz', requestId: 'lost-0000002', createdAt: old });
  S.refunds.push({ id: 're_lost', status: 'succeeded', amount: 50000, payment_intent: 'pi_cs_test_1', metadata: { requestId: 'lost-0000002' } });
  mails.length = 0;
  sw = await RD.settleStuckSecurityDepositRefunds(db, 't1', await get(T), { stripe: new (StripeMock as any)() });
  check('one that went through is recorded, and the renter told', sw.recorded === 1 && (await get(`${T}/rentLedger/deprefund_lost-0000002`))?.status === 'paid' && toMaya().length === 1);
  check('the five-minute check runs it', src('src/lib/money-sweep.ts').includes("['securityDepositRefunds', settleStuckSecurityDepositRefunds as Part]"));

  console.log('Stripe’s notice of a refund');
  await fresh();
  await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' }); paid('cs_test_1');
  await portal({ action: 'confirm-deposit', leaseId: 'l1', sessionId: 'cs_test_1' });
  const charge = { id: 'ch_1', payment_intent: 'pi_cs_test_1', captured: true, amount: 50000, amount_captured: 50000, payment_method_details: { card: { brand: 'visa', last4: '4242' } } };
  await db.doc(`${T}/rentLedger/deprefund_hook-0000001`).set({ leaseId: 'l1', renterId: 'rt1', type: 'deposit_refund', status: 'refunding', amountCents: -10000, stripePaymentIntentId: 'pi_cs_test_1', requestId: 'hook-0000001', createdAt: new Date().toISOString() });
  mails.length = 0;
  await RD.noticeDepositRefund(db, 't1', await get(T), charge, { id: 're_h', status: 'succeeded', amount: 10000, metadata: { kind: 'deposit_refund', leaseId: 'l1', requestId: 'hook-0000001', origin: 'app' } }, { kind: 'rent_deposit', leaseId: 'l1' }, { outside: false });
  check('the app’s own return is recorded from the notice when the screen never heard back', (await get(`${T}/rentLedger/deprefund_hook-0000001`))?.status === 'paid' && toMaya().length === 1);
  const OR = await import('../../src/lib/outside-refund');
  const dash = { id: 're_dash', status: 'succeeded', amount: 15000, created: Math.floor(Date.now() / 1000), metadata: {} };
  const who: any = await RD.noticeDepositRefund(db, 't1', await get(T), charge, dash, { kind: 'rent_deposit', leaseId: 'l1' }, { outside: true });
  await OR.recordOutsideRefund(db, 't1', charge, dash, { kind: 'rent_deposit', leaseId: 'l1' }, { piId: 'pi_cs_test_1', account: 'acct_biz', lineExtra: { category: 'Booth Deposit', taxBucket: 'transfer', renterId: who.renterId, leaseId: who.leaseId }, accountNote: `It’s recorded on ${who.name}’s security deposit as returned.` });
  const bl = await get(`${T}/transactions/stripe_refund_re_dash`);
  check('one made in the Stripe Dashboard is recorded on the deposit as returned', (await get(`${T}/rentLedger/deprefund_out_re_dash`))?.status === 'paid' && (await pos()).returnableCents === 25000 && toMaya().length === 2);
  check('and in the books as held money going out, not a refund of a sale', bl?.category === 'Booth Deposit' && bl.taxBucket === 'transfer' && bl.renterId === 'rt1', bl);
  check('the payments notice handles deposit refunds this way', hook.includes("if (meta.kind === 'rent_deposit' || ['deposit_refund', 'deposit_extra'].includes(String(rf.metadata?.kind || ''))) {"));
  const MR = await import('../../src/lib/money-refund');
  const mr: any = await MR.refundSaleToCard(db, 't1', await get(T), bk ? (await all(`${T}/transactions`)).find((t: any) => t.category === 'Booth Deposit' && t.type === 'income').id : 'x', 1000, 'Max');
  check('Money doesn’t refund a deposit around its own card', mr.ok === false && /security deposit/.test(String(mr.error)), mr);

  console.log('Review fixes');
  // A return asked again just now isn't let go by the five-minute check, even though it was first asked long ago.
  await fresh();
  await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' }); paid('cs_test_1');
  await portal({ action: 'confirm-deposit', leaseId: 'l1', sessionId: 'cs_test_1' });
  S.mode = 'silent';
  await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'refund', toCard: true, requestId: 'ret-retry-001' }));
  await db.doc(`${T}/rentLedger/deprefund_ret-retry-001`).set({ createdAt: new Date(Date.now() - 30 * 60000).toISOString() }, { merge: true });
  await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'refund', toCard: true, requestId: 'ret-retry-001' }));
  let sw2 = await RD.settleStuckSecurityDepositRefunds(db, 't1', await get(T), { stripe: new (StripeMock as any)() });
  check('a return asked again just now is never let go by the five-minute check', sw2.released === 0 && !!(await get(`${T}/rentLedger/deprefund_ret-retry-001`))?.retryAt);
  S.mode = 'ok';
  // The money went back but the line is gone: Stripe's notice writes it, once.
  await db.doc(`${T}/rentLedger/deprefund_ret-retry-001`).delete();
  mails.length = 0;
  const rfLost = { id: 're_gone', status: 'succeeded', amount: 50000, metadata: { kind: 'deposit_refund', leaseId: 'l1', requestId: 'ret-retry-001', origin: 'app' } };
  const ch1 = { id: 'ch_1', payment_intent: 'pi_cs_test_1', captured: true, amount: 50000, amount_captured: 50000, payment_method_details: { card: { brand: 'visa', last4: '4242' } } };
  await RD.noticeDepositRefund(db, 't1', await get(T), ch1, rfLost, { kind: 'rent_deposit', leaseId: 'l1' }, { outside: false });
  await RD.noticeDepositRefund(db, 't1', await get(T), ch1, rfLost, { kind: 'rent_deposit', leaseId: 'l1' }, { outside: false });
  check('a return Stripe made whose claim was gone is still recorded, booked and told, once', (await get(`${T}/rentLedger/deprefund_ret-retry-001`))?.status === 'paid' && !!(await get(`${T}/transactions/deprefund_ret-retry-001`)) && (await pos()).returnableCents === 0 && toMaya().length === 1);
  // A refund in the Dashboard of a second payment (not the deposit) changes nothing on the deposit.
  await fresh();
  await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' }); paid('cs_test_1');
  await portal({ action: 'confirm-deposit', leaseId: 'l1', sessionId: 'cs_test_1' });
  await db.doc(`${T}/leases/l1`).set({ deposit: { extraPayments: { cs_cs_x: { cents: 50000, pi: 'pi_extra', refundError: true } } } }, { merge: true });
  const exWho: any = await RD.noticeDepositRefund(db, 't1', await get(T), { ...ch1, payment_intent: 'pi_extra' }, { id: 're_x', status: 'succeeded', amount: 50000, created: Math.floor(Date.now() / 1000), metadata: {} }, { kind: 'rent_deposit', leaseId: 'l1' }, { outside: true });
  check('a Dashboard refund of a second payment leaves the deposit held and isn’t booked', exWho?.skipBooks === true && (await pos()).returnableCents === 50000 && (await get(`${T}/leases/l1`)).deposit.extraPayments.cs_cs_x.refundedOutside === true
    && src('src/lib/connect-webhook.ts').includes('if (who?.skipBooks) continue;'));
  // Portal return and Stripe's notice together on a second payment: sent back and told once.
  await fresh();
  await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' });
  await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'received', methodLabel: 'Cash', requestId: 'cash-dep-0009' }));
  paid('cs_test_1'); mails.length = 0;
  await Promise.all([RD.recordCardDeposit(db, new (StripeMock as any)(), 't1', await get(T), 'l1', S.sessions.get('cs_test_1'), { account: 'acct_biz', today: '2026-11-09' }),
    RD.recordCardDeposit(db, new (StripeMock as any)(), 't1', await get(T), 'l1', S.sessions.get('cs_test_1'), { account: 'acct_biz', today: '2026-11-09' })]);
  check('a second payment arriving twice at once is sent back and told once', S.refunds.length === 1 && toMaya().length === 1 && (await all(`${T}/notifications`)).filter((x: any) => String(x.id).startsWith('depositextra_')).length === 1);
  // A request is this lease's.
  await fresh();
  await db.doc(`${T}/leases/l2`).set({ renterId: 'rt1', status: 'active', deposit: { amountCents: 30000 } });
  await db.doc(`${T}/rentLedger/deprefund_shared-00001`).set({ leaseId: 'l2', type: 'deposit_refund', status: 'refunding', amountCents: -30000, stripePaymentIntentId: 'pi_l2', requestId: 'shared-00001', createdAt: new Date().toISOString() });
  r = await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'refund', toCard: true, requestId: 'shared-00001' }));
  check('a request from another lease is refused, never sent for it', r.status === 409 && S.refundCalls.length === 0);
  // A bank payment that failed makes way for a new page.
  await fresh();
  await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' });
  Object.assign(S.sessions.get('cs_test_1'), { status: 'complete', payment_status: 'unpaid', payment_intent: 'pi_failed' }); S.piStatus.pi_failed = 'requires_payment_method';
  r = await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' });
  check('a bank payment that failed lets them pay again', r.ok && r.url === 'https://checkout.stripe.test/cs_test_2' && S.creates.length === 2, r);
  S.piStatus.pi_failed = 'processing'; Object.assign(S.sessions.get('cs_test_2'), { status: 'complete', payment_status: 'unpaid', payment_intent: 'pi_failed' });
  r = await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' });
  check('one still clearing waits', r.status === 409 && /still going through/.test(r.error));
  await fresh({ status: 'ended' });
  me = await portal({ action: 'me', today: '2026-11-09' });
  r = await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' });
  check('an ended lease’s deposit isn’t paid here', r.status === 409 && S.creates.length === 0);
  // Paid by card against a deposit line waiting for a different amount: the line is what was paid.
  await fresh();
  await db.doc(`${T}/rentLedger/pendx`).set({ leaseId: 'l1', renterId: 'rt1', type: 'deposit_charge', status: 'pending', amountCents: 40000 });
  await portal({ action: 'pay-deposit', leaseId: 'l1', returnUrl: 'https://x.example.com/rent/t1' }); paid('cs_test_1');
  await portal({ action: 'confirm-deposit', leaseId: 'l1', sessionId: 'cs_test_1' });
  check('a card payment sets the deposit to what was paid', (await get(`${T}/rentLedger/pendx`))?.amountCents === 50000 && (await pos()).collectedCents === 50000);
  // On its way: said so, not "returned".
  S.mode = 'silent';
  await route.POST(req({ tenantId: 't1', leaseId: 'l1', action: 'refund', toCard: true, requestId: 'ret-way-0001' }));
  S.mode = 'ok';
  me = await portal({ action: 'me', today: '2026-11-09' });
  check('a return on its way is shown as on its way, not returned', me.lease.deposit.refundingCents === 50000 && me.lease.deposit.refundedCents === 0 && src('src/app/rent/[tenantId]/page.tsx').includes('on its way to your card'));
  check('renter refunds asked again are stamped the same way', src('src/lib/renter-refund.ts').includes("tx.set(txRef, { renterRefunds: { [req]: { retryAt: at } } }, { merge: true });") && src('src/lib/renter-refund.ts').includes("String(cl.retryAt || '') !== String(c.retryAt || '')"));

  console.log('Screens');
  const page = src('src/app/rent/[tenantId]/page.tsx'); const drawer = src('src/components/renters/RenterProfileDrawer.tsx');
  check('the portal Rent tab shows the deposit and a Pay deposit button, and confirms on return', page.includes("action: 'pay-deposit'") && page.includes("action: 'confirm-deposit'") && page.includes('Pay deposit') && page.includes('Security deposit'));
  check('the profile returns a card-paid deposit to the card, asking again as the same request', drawer.includes("toCard: action === 'refund' && paidByCard") && drawer.includes('setDepReq({ action, leaseId: lease.id, id: reqId })'));
  const bad = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  check('no assistant names', !bad.test(src('src/lib/rent-deposit.ts')) && !bad.test(src('scripts/verify/launch-deposit-card.verify.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
