// Checks every payment whose answer from Stripe was lost, and that nobody asked about again, ends recorded or refunded
// (lib/money-sweep, run by the five-minute check, api/cron/retail-payments):
//   - a saved-card charge (api/stripe/charge-card): recorded once when Stripe has it (a booking's deposit as that
//     deposit, anything else as income with the owners told), closed when Stripe said no, left while a bank payment is
//     processing, closed after two hours when it never reached Stripe; a desk sale's payment is left to its ticket; two
//     runs at once record it once; nothing is looked at before its answer had time to come back;
//   - fees charged to the card on file (lib/fee-pay): recorded, or let go; fees waived meanwhile: the money is recorded
//     and refunded; money for fees already paid that was on its way back: refunded once;
//   - a deposit refund left 'refunding' (lib/deposit-refund): recorded once, sent under the same key, or given back;
//   - a booking undone at the desk (lib/undo-booking): finished when Stripe has the refund, let go when it hasn't (at
//     once for cash, after two hours otherwise), never sending a refund itself;
//   - a sale refunded to the card from Money (lib/money-refund): recorded on the server with the reason and anything
//     taken back, once however it's asked; a lost answer keeps the claim, so a retry or the check finds the refund;
//     nothing at Stripe after two hours lets it go; Stripe saying no lets it go at once;
//   - a booth's overage, extras and refund (lib/booth-money): recorded once, or let go after two hours;
//   - rent paid online that wasn't owed, whose refund's answer was lost (lib/rent-online-pay): recorded when Stripe has
//     the refund (the app's, or one made by hand), sent once under the same key when it hasn't, or left for the studio
//     when Stripe says no;
//   - a group gift cancelled with a share's refund unanswered (lib/gift-groups): held so it can't be sent, and the
//     share sent back again under the same key, once;
//   - one part failing doesn't stop the rest, and the check runs for a business without its own payments account.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/lost-payments.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.CRON_SECRET = 'sec';
process.env.NEXT_PUBLIC_APP_URL = 'https://studio.test';
let db: any = strictTransactions(makeDb());

// ── Stripe: one result per key; an answer that can go missing after charging or before reaching Stripe; a card that
//    says no; a bank payment still processing; lists that can fail. ──
type Next = 'ok' | 'lost_after' | 'lost_before' | 'processing' | 'lost_declined' | 'refuse';
let pis: any[] = []; let pkeys = new Map<string, any>(); let refunds: any[] = []; let rkeys = new Map<string, any>();
let piNext: Next[] = []; let rfNext: Next[] = []; let piCreates = 0; let rfCreates = 0; let listFails = 0;
const err = (type: string, code?: string, message = 'Stripe error') => Object.assign(new Error(message), { type, code, raw: { code } });
const lost = () => err('StripeConnectionError', undefined, 'An error occurred with our connection to Stripe.');
const clone = (x: any) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
function StripeMock(this: any) {
  return {
    paymentIntents: {
      create: async (p: any, o: any) => {
        piCreates++;
        const key = String(o?.idempotencyKey || '');
        if (key && pkeys.has(key)) { const prev = pkeys.get(key); if (prev.error) throw prev.error; return clone(pis.find((x) => x.id === prev.id)); }
        const mode = piNext.shift() || 'ok';
        if (mode === 'lost_before') throw lost();
        if (mode === 'refuse') { const e = err('StripeCardError', 'card_declined', 'Your card was declined.'); if (key) pkeys.set(key, { error: e }); throw e; }
        const id = `pi_${pis.length + 1}`;
        const status = mode === 'processing' ? 'processing' : mode === 'lost_declined' ? 'requires_payment_method' : 'succeeded';
        const pi = { id, status, amount: p.amount, amount_received: status === 'succeeded' ? p.amount : 0, customer: p.customer, payment_method: p.payment_method, metadata: p.metadata || {},
          created: Math.floor(Date.now() / 1000), latest_charge: { id: `ch_${pis.length + 1}`, balance_transaction: { fee: 59 } }, account: o?.stripeAccount || null };
        pis.push(pi); if (key) pkeys.set(key, { id });
        if (mode === 'lost_after' || mode === 'lost_declined') throw lost();
        return clone(pi);
      },
      // As Stripe lists them: newest first, and only those on the account asked about (the platform's own when none).
      list: async (q: any, o: any) => { if (listFails > 0) { listFails--; throw lost(); } return { data: clone(pis.filter((x) => (x.account || null) === (o?.stripeAccount || null) && (!q?.customer || x.customer === q.customer) && (!q?.created?.gte || x.created >= q.created.gte)).reverse()) }; },
      retrieve: async (id: string) => { const x = pis.find((y) => y.id === id); if (!x) throw err('StripeInvalidRequestError', 'resource_missing'); return clone(x); },
    },
    refunds: {
      create: async (p: any, o: any) => {
        rfCreates++;
        const key = String(o?.idempotencyKey || '');
        if (key && rkeys.has(key)) return clone(rkeys.get(key));
        const mode = rfNext.shift() || 'ok';
        if (mode === 'lost_before') throw lost();
        if (mode === 'refuse') throw err('StripeInvalidRequestError', 'invalid_request', 'Refund amount is greater than the unrefunded amount.');
        const r = { id: `re_${refunds.length + 1}`, status: 'succeeded', amount: p.amount, payment_intent: p.payment_intent, metadata: p.metadata || {}, account: o?.stripeAccount || null, created: Math.floor(Date.now() / 1000) };
        refunds.push(r); if (key) rkeys.set(key, r);
        if (mode === 'lost_after') throw lost();
        return clone(r);
      },
      list: async (q: any, o: any) => { if (listFails > 0) { listFails--; throw lost(); } return { data: clone(refunds.filter((r) => (r.account || null) === (o?.stripeAccount || null) && r.payment_intent === q.payment_intent).reverse()) }; },
    },
    checkout: { sessions: { expire: async (id: string) => ({ id, status: 'expired' }), retrieve: async (id: string) => ({ id, payment_status: 'paid', payment_intent: { id: 'pi_paid', payment_method: 'pm_1' } }) } },
  };
}

const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
let messages: any[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe' || /[\\/]node_modules[\\/]stripe[\\/]/.test(request)) return fake(request, Object.assign(StripeMock, { default: StripeMock, __esModule: true }));
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireCan: async () => ({ actor }), requireRole: async () => ({ actor }), staffOrServer: async () => true });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { __esModule: true, sendNotification: async (_db: any, m: any) => { messages.push(m); return { ok: true }; } });
  if (request === '@/lib/charge-records' || /\/src\/lib\/charge-records(\.ts)?$/.test(request)) return fake(request, { recordCharge: async () => ({ id: 'cr1' }) });
  if (request === '@/lib/message-policy' || /\/src\/lib\/message-policy(\.ts)?$/.test(request)) return fake(request, { internalHeaders: () => ({ 'x-cf-internal': 'sec' }), resolveMessagePolicy: () => ({ enabled: false }), renderMessage: (s: string) => s, MESSAGE_KINDS: [] });
  if (request === '@/lib/app-origin') return { linkOrigin: () => 'https://studio.test' };
  if (request === '@/lib/reservation-notify') return { sendReservationConfirmation: async () => undefined };
  if (request === '@/lib/refund-notice' || /\/src\/lib\/refund-notice(\.ts)?$/.test(request)) return fake(request, { __esModule: true, sendRefundNotice: async () => undefined, default: { sendRefundNotice: async () => undefined } });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const lines = async (cat?: string) => (await all(`${T}/transactions`)).filter((x: any) => !cat || x.category === cat);
const notes = async () => all(`${T}/notifications`);
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, headers: { get: (k: string) => headers[String(k).toLowerCase()] ?? null }, nextUrl: { origin: 'https://studio.test' }, url: 'https://studio.test/x' }) as any;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const later = (ms: number) => Date.now() + ms;
const MIN = 60000; const HOUR = 3600e3;
const internal = { 'x-cf-internal': 'sec' }; const staff = { authorization: 'Bearer test' };

const fresh = async (tenant: any = { stripeAccountId: 'acct_1' }) => {
  db = strictTransactions(makeDb()); pis = []; pkeys = new Map(); refunds = []; rkeys = new Map(); piNext = []; rfNext = []; piCreates = 0; rfCreates = 0; listFails = 0; messages = [];
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', incidentalCategories: [{ label: 'Cleaning', capCents: 5000 }], ...tenant });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com', phone: '7135550101', cardOnFile: { customerId: 'cus_1', paymentMethodId: 'pm_1', brand: 'Visa', last4: '4242' }, outstandingBalance: 0, unpaidFees: [] });
  await db.doc(`${T}/staff/s1`).set({ name: 'Ana Ruiz', role: 'owner' });
};
const tenantNow = async () => get(T);

(async () => {
  const { POST: chargeCard } = await import('../../src/app/api/stripe/charge-card/route');
  const { POST: undo } = await import('../../src/app/api/appointments/undo-booking/route');
  const { PUT: boothOverage, PATCH: boothPatch } = await import('../../src/app/api/booths/reserve/route');
  const L = await import('../../src/lib/lost-charges');
  const F = await import('../../src/lib/fee-pay');
  const D = await import('../../src/lib/deposit-refund');
  const U = await import('../../src/lib/undo-booking');
  const B = await import('../../src/lib/booth-money');
  const S = await import('../../src/lib/money-sweep');
  const R = await import('../../src/lib/rent-online-pay');
  const MR = await import('../../src/lib/money-refund');
  const GG = await import('../../src/lib/gift-groups');
  const GB = await import('../../src/lib/gift-bulk');
  const stripe: any = new (StripeMock as any)();
  const cc = (x: any, headers: Record<string, string> = internal) => chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 4000, ...x }, headers)) as any;
  const auto = (x: any = {}) => cc({ mode: 'auto', description: 'No-show fee', category: 'Fees', reason: 'No-show', appointmentId: 'a5', kind: 'arrears_fee', ...x });
  const settleCards = async (at: number) => L.settleLostCardCharges(db, 't1', await tenantNow(), { stripe, now: at });
  const attempts = async () => all(`${T}/cardAttempts`);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('A saved-card charge whose answer was lost');
  await fresh(); piNext = ['lost_after'];
  let r: any = await auto();
  check('the charge goes through at Stripe, but its answer is lost: the screen is told to try again', r.status === 502 && r.body.unknown && pis.length === 1 && (await lines()).length === 0, r.body);
  let n: any = await settleCards(later(10 * MIN));
  check('…ten minutes on: not looked at yet (its answer could still come back)', n.checked === 0 && (await lines()).length === 0, n);
  n = await settleCards(later(25 * MIN));
  let ls: any[] = await lines();
  check('…25 minutes on: recorded once, as the charge would have recorded it', n.recorded === 1 && ls.length === 1 && ls[0].id === 'card_charge__pi_1' && ls[0].amount === 40 && ls[0].category === 'Fees' && ls[0].stripeChargeId === 'ch_1', { n, ls });
  check('…the attempt is closed as charged, and the owners are told what it was for', (await attempts())[0].status === 'charged' && (await notes()).length === 1 && /No-show fee/.test((await notes())[0].message), await notes());
  n = await settleCards(later(40 * MIN));
  check('…the next run: nothing more (one line, one note)', n.checked === 0 && (await lines()).length === 1 && (await notes()).length === 1, n);
  r = await auto();
  check('…asked again by the screen afterwards: the same payment (one at Stripe), still one line', r.body.ok && pis.length === 1 && (await lines()).length === 1, r.body);

  await fresh(); piNext = ['lost_after'];
  await auto();
  const both: any[] = await Promise.all([settleCards(later(25 * MIN)), settleCards(later(25 * MIN))]);
  check('two runs at once: recorded once', both.reduce((k, x) => k + x.recorded, 0) === 1 && (await lines()).length === 1 && (await notes()).length === 1, both);

  await fresh(); piNext = ['lost_after'];
  await auto({ onLost: 'refund', description: 'Cancellation fee', category: 'Cancellation Fee' });
  await settleCards(later(25 * MIN));
  check('a cancellation whose screen saved nothing: recorded, and the owners are told it may need refunding', (await lines('Cancellation Fee')).length === 1 && /wasn’t saved/.test(((await notes())[0] || {}).message || '') && /refund it from Money/.test(((await notes())[0] || {}).message || ''), await notes());

  console.log('…a booking’s deposit');
  await fresh();
  await db.doc(`${T}/appointments/a2`).set({ status: 'confirmed', clientId: 'c1', clientName: 'Maya Lopez', startTime: new Date(later(3 * 864e5)).toISOString(), depositStatus: 'pending', depositAmountCents: 2500,
    depositChargeUnconfirmed: { key: 'dep_book_a2', at: ago(MIN) } });
  piNext = ['lost_after'];
  r = await cc({ mode: 'auto', kind: 'deposit', amountCents: 2500, category: 'Retainers', description: 'Deposit', reason: 'Booking deposit', appointmentId: 'a2', idempotencyKey: 'dep_book_a2', onLost: 'deposit' });
  check('the deposit charge’s answer is lost', r.status === 502 && pis.length === 1, r.body);
  n = await settleCards(later(25 * MIN));
  let ap: any = await get(`${T}/appointments/a2`); const credits: any[] = (await all(`${T}/depositCredits`)).filter((c: any) => c.sourceAppointmentId === 'a2');
  check('…recorded as the booking’s deposit: paid, its credit made, one line in the books', n.recorded === 1 && ap.depositStatus === 'paid' && !ap.depositChargeUnconfirmed && credits.length === 1 && (await lines('Retainers')).length === 1 && (await lines()).length === 1, { n, ap, credits, ls: await lines() });
  check('…and the owners are told it went through', (await notes()).some((x: any) => /did go through/.test(x.message)), await notes());

  await fresh();
  await db.doc(`${T}/appointments/a2`).set({ status: 'confirmed', clientId: 'c1', clientName: 'Maya Lopez', depositStatus: 'pending', depositAmountCents: 2500 });
  piNext = ['lost_after'];
  await cc({ mode: 'auto', kind: 'deposit', amountCents: 2500, category: 'Retainers', description: 'Deposit', reason: 'Booking deposit', appointmentId: 'a2', idempotencyKey: 'dep_book_a2', onLost: 'deposit' });
  await db.doc(`${T}/appointments/a2`).set({ depositStatus: 'paid', depositPaidVia: 'link' }, { merge: true });
  await settleCards(later(25 * MIN));
  check('a deposit paid another way meanwhile: the card payment is still recorded, kept beside the first for the desk to refund one, and the owners told it was paid twice',
    (await lines()).length === 1 && (await all(`${T}/depositCredits`)).length === 1 && (await get(`${T}/appointments/a2`)).needsAttention === 'deposit_paid_twice' && (await notes()).some((x: any) => /paid twice/.test(x.message)), { ls: await lines(), n: await notes() });

  await fresh();
  await db.doc(`${T}/clients/c1`).set({ outstandingBalance: 40, unpaidFees: [{ feeId: 'f9', feeAmount: 40, reason: 'No-Show Fee' }] }, { merge: true });
  await db.doc(`${T}/appointments/a4`).set({ status: 'confirmed', clientId: 'c1', clientName: 'Maya Lopez', depositStatus: 'pending', depositAmountCents: 2500, balanceCollectCents: 4000 });
  piNext = ['lost_after'];
  await cc({ mode: 'auto', kind: 'deposit', amountCents: 6500, category: 'Retainers', description: 'Deposit — Gel manicure + $40.00 balance', reason: 'Front desk deposit (card on file)', appointmentId: 'a4', idempotencyKey: 'dep_a4_6500_1', onLost: 'deposit' });
  await settleCards(later(25 * MIN));
  const a4: any = await get(`${T}/appointments/a4`); const c4: any = await get(`${T}/clients/c1`);
  const cr4 = (await all(`${T}/depositCredits`)).filter((c: any) => c.sourceAppointmentId === 'a4');
  check('a deposit charged together with a balance, its answer lost: the deposit and the balance recorded apart, the balance cleared', a4.depositStatus === 'paid' && cr4.length === 1 && cr4[0].amountCents === 2500
    && (await lines('Retainers'))[0]?.amount === 25 && (await lines('Fee Recovery'))[0]?.amount === 40 && c4.outstandingBalance === 0 && !!a4.balanceCollectedAt, { a4, cr4, c4, ls: await lines() });

  console.log('…the charge went through, but the step that asked never heard back');
  await fresh();
  await db.doc(`${T}/appointments/a6`).set({ status: 'pending_payment', clientId: 'c1', clientName: 'Maya Lopez', depositStatus: 'pending', depositAmountCents: 2500 });
  r = await cc({ mode: 'auto', kind: 'deposit', amountCents: 2500, category: 'Deposits', description: 'Deposit', reason: 'Appointment deposit', appointmentId: 'a6', onLost: 'deposit' });
  check('the deposit is charged (and its line written), but the booking never hears back', r.body.ok && (await attempts())[0].unapplied === true && (await get(`${T}/appointments/a6`)).depositStatus === 'pending', r.body);
  n = await settleCards(later(10 * MIN));
  check('…ten minutes on: not looked at yet', n.checked === 0, n);
  n = await settleCards(later(25 * MIN));
  let a6: any = await get(`${T}/appointments/a6`);
  check('…then: recorded on its booking (paid, its credit), still one line in the books, and the owners told', n.recorded === 1 && a6.depositStatus === 'paid' && a6.status === 'confirmed' && (await all(`${T}/depositCredits`)).length === 1
    && (await lines()).length === 1 && (await notes()).some((x: any) => /never heard back/.test(x.message)), { n, a6, ls: await lines() });
  n = await settleCards(later(40 * MIN));
  check('…checked once only', n.checked === 0 && (await all(`${T}/depositCredits`)).length === 1, n);
  await fresh();
  await db.doc(`${T}/appointments/a6`).set({ status: 'pending_payment', clientId: 'c1', clientName: 'Maya Lopez', depositStatus: 'pending', depositAmountCents: 2500 });
  r = await cc({ mode: 'auto', kind: 'deposit', amountCents: 2500, category: 'Deposits', description: 'Deposit', reason: 'Appointment deposit', appointmentId: 'a6', onLost: 'deposit' });
  const { recordCardDeposit } = await import('../../src/lib/deposit-record');
  await recordCardDeposit(db, 't1', 'a6', { cents: 2500, paymentIntentId: r.body.paymentIntentId, via: 'card_on_file' });
  n = await settleCards(later(25 * MIN));
  check('…when the booking did hear back: nothing more, and nobody is told', n.checked === 1 && n.recorded === 0 && (await all(`${T}/depositCredits`)).length === 1 && (await notes()).length === 0, n);
  await fresh();
  await db.doc(`${T}/appointments/a7`).set({ status: 'confirmed', clientId: 'c1', clientName: 'Maya Lopez', startTime: new Date(later(864e5)).toISOString() });
  r = await cc({ mode: 'auto', kind: 'deposit', amountCents: 3000, category: 'Cancellation Fees', description: 'Late-cancellation fee', reason: 'Client cancelled inside the window', appointmentId: 'a7', onLost: 'refund' });
  n = await settleCards(later(25 * MIN));
  check('a cancellation fee charged, the cancellation never saved: the owners are told the booking is still on', n.recorded === 1 && (await notes()).some((x: any) => /cancellation wasn’t saved/.test(x.message)) && (await lines()).length === 1, { n, notes: await notes() });
  await fresh();
  await db.doc(`${T}/appointments/a7`).set({ status: 'confirmed', clientId: 'c1', clientName: 'Maya Lopez', startTime: new Date(later(864e5)).toISOString() });
  r = await cc({ mode: 'auto', kind: 'deposit', amountCents: 3000, category: 'Cancellation Fees', description: 'Late-cancellation fee', reason: 'Client cancelled inside the window', appointmentId: 'a7', onLost: 'refund' });
  await db.doc(`${T}/appointments/a7`).set({ status: 'cancelled' }, { merge: true });
  n = await settleCards(later(25 * MIN));
  check('…when it was cancelled: nobody is told', (await notes()).length === 0, n);

  console.log('…never reached Stripe, said no, or still processing');
  await fresh();
  await db.doc(`${T}/appointments/a3`).set({ status: 'confirmed', clientId: 'c1', clientName: 'Maya Lopez', depositStatus: 'pending', depositAmountCents: 2500, depositChargeUnconfirmed: { key: 'dep_book_a3', at: ago(MIN) } });
  piNext = ['lost_before'];
  r = await cc({ mode: 'auto', kind: 'deposit', amountCents: 2500, category: 'Retainers', description: 'Deposit', reason: 'Booking deposit', appointmentId: 'a3', idempotencyKey: 'dep_book_a3', onLost: 'deposit' });
  n = await settleCards(later(25 * MIN));
  check('never reached Stripe: left open for two hours (nothing found yet)', r.status === 502 && n.waiting === 1 && (await attempts())[0].status === 'unknown' && !(await attempts())[0].settlingAt, { n, a: await attempts() });
  n = await settleCards(later(2 * HOUR + 5 * MIN));
  ap = await get(`${T}/appointments/a3`);
  check('…after two hours: closed with nothing recorded, and the booking can send its deposit link', n.released === 1 && (await attempts())[0].status === 'not_charged' && (await lines()).length === 0 && !ap.depositChargeUnconfirmed && (await notes()).some((x: any) => /never reached Stripe/.test(x.message)), { n, ap });

  await fresh(); piNext = ['lost_declined'];
  await auto();
  n = await settleCards(later(25 * MIN));
  check('the card said no, but the answer was lost: closed as declined, nothing recorded', n.released === 1 && (await attempts())[0].status === 'declined' && (await lines()).length === 0, { n, a: await attempts() });

  await fresh(); piNext = ['processing'];
  r = await auto();
  n = await settleCards(later(25 * MIN));
  check('a bank payment still processing: left for the next run', r.status === 502 && n.waiting === 1 && (await lines()).length === 0, { r: r.body, n });
  pis[0].status = 'succeeded'; pis[0].amount_received = pis[0].amount;
  n = await settleCards(later(35 * MIN));
  check('…once it goes through: recorded', n.recorded === 1 && (await lines()).length === 1, n);

  await fresh(); listFails = 1; piNext = ['lost_after'];
  await auto();
  n = await settleCards(later(25 * MIN));
  check('Stripe can’t be asked right now: left for the next run, and taken up again then', n.waiting === 1 && (await lines()).length === 0 && !(await attempts())[0].settlingAt, n);
  n = await settleCards(later(30 * MIN));
  check('…the next run records it', n.recorded === 1 && (await lines()).length === 1, n);

  console.log('…at the desk');
  await fresh(); piNext = ['lost_after'];
  r = await cc({ mode: 'pos', amountCents: 4120, surchargeAmountCents: 120, description: 'Gel manicure', category: 'Service Revenue', reason: 'Studio Services' }, staff);
  n = await settleCards(later(25 * MIN));
  const base = (await lines('Service Revenue'))[0]; const sur = (await lines('Card Processing Fee'))[0];
  check('a desk charge with no sale behind it: recorded, with the card fee passed on as its own line', r.status === 502 && n.recorded === 1 && base?.id === 'pos_cof__pi_1' && base.amount === 40 && sur?.amount === 1.2, { r: r.body, n, ls: await lines() });
  r = await cc({ mode: 'pos', amountCents: 4120, surchargeAmountCents: 120, description: 'Gel manicure', category: 'Service Revenue', reason: 'Studio Services' }, staff);
  check('…the desk taps again afterwards: the same payment (one at Stripe), the same two lines', r.body.ok && r.body.paymentIntentId === 'pi_1' && pis.length === 1 && (await lines('Service Revenue')).length === 1 && (await lines('Card Processing Fee')).length === 1, { r: r.body, ls: await lines() });
  await fresh();
  await db.doc(`${T}/cardAttempts/x1`).set({ mode: 'pos', key: 'pos_pc1_k', at: ago(30 * MIN), unknown: true, unknownAt: ago(30 * MIN), done: false, ticket: 'pc1', customer: 'cus_1', account: 'acct_1', clientId: 'c1', amountCents: 4000 });
  n = await settleCards(later(0));
  check('a desk sale’s payment named on its ticket: left to its ticket, nothing recorded here', n.released === 1 && (await get(`${T}/cardAttempts/x1`)).settledAs === 'ticket' && (await lines()).length === 0, n);
  n = await settleCards(later(5 * MIN));
  check('…and not taken up again on the next run', n.checked === 0, n);
  await db.doc(`${T}/cardAttempts/x2`).set({ key: 'pos_old', at: ago(5 * 864e5), unknown: true, done: false, clientId: 'c1', amountCents: 4000 });
  n = await settleCards(later(0));
  check('a desk attempt from before attempts kept what’s needed to find them: left alone', n.checked === 0 && (await get(`${T}/cardAttempts/x2`)).unknown === true, n);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('Fees charged to the card on file');
  const fee = (id: string, dollars: number) => ({ feeId: id, feeAmount: dollars, reason: 'No-Show Fee', appointmentId: `ap_${id}`, appointmentDate: ago(HOUR) });
  const settleFees = async (at: number) => F.settleStuckFeeClaims(db, 't1', await tenantNow(), { stripe, now: at });
  await fresh(); await db.doc(`${T}/clients/c1`).set({ unpaidFees: [fee('f1', 40)], outstandingBalance: 40 }, { merge: true });
  piNext = ['lost_after'];
  r = await F.chargeFeesNow(db, stripe, 't1', await tenantNow(), { clientId: 'c1', feeIds: ['f1'], by: 'Ana Ruiz' });
  check('the fee charge’s answer is lost: the fee stays claimed', !r.ok && r.code === 'unconfirmed' && (await all(`${T}/feeCharges`))[0].status === 'charging', r);
  n = await settleFees(later(10 * MIN));
  check('…ten minutes on: not looked at yet (a charge can still be on its way)', n.checked === 0, n);
  n = await settleFees(later(16 * MIN));
  let cl: any = await get(`${T}/clients/c1`);
  check('…then: the payment Stripe has is recorded, and the fee comes off what they owe', n.recorded === 1 && cl.unpaidFees.length === 0 && cl.outstandingBalance === 0 && (await lines('Fees')).length === 1 && (await all(`${T}/feeCharges`))[0].status === 'charged', { n, cl, ls: await lines() });
  n = await settleFees(later(30 * MIN));
  check('…the next run: nothing more', n.checked === 0 && (await lines('Fees')).length === 1 && piCreates === 1, n);
  await fresh(); await db.doc(`${T}/clients/c1`).set({ unpaidFees: [fee('f1', 40)], outstandingBalance: 40 }, { merge: true });
  piNext = ['lost_after'];
  await F.chargeFeesNow(db, stripe, 't1', await tenantNow(), { clientId: 'c1', feeIds: ['f1'], by: 'Ana Ruiz' });
  const twoFees: any[] = await Promise.all([settleFees(later(16 * MIN)), settleFees(later(16 * MIN))]);
  check('two runs at once: the fee payment is recorded once', (await lines('Fees')).length === 1 && (await all(`${T}/receipts`)).length === 1 && (await get(`${T}/clients/c1`)).unpaidFees.length === 0, { twoFees, ls: await lines() });

  await fresh(); await db.doc(`${T}/clients/c1`).set({ unpaidFees: [fee('f1', 40)], outstandingBalance: 40 }, { merge: true });
  piNext = ['lost_before'];
  await F.chargeFeesNow(db, stripe, 't1', await tenantNow(), { clientId: 'c1', feeIds: ['f1'], by: 'Ana Ruiz' });
  n = await settleFees(later(16 * MIN));
  cl = await get(`${T}/clients/c1`);
  check('never reached Stripe: the fee is free again, still owed, nothing recorded', n.released === 1 && cl.unpaidFees.length === 1 && !cl.unpaidFees[0].collectingAt && (await lines()).length === 0 && (await all(`${T}/feeCharges`))[0].status === 'released', { n, cl });

  await fresh(); await db.doc(`${T}/clients/c1`).set({ unpaidFees: [fee('f1', 40)], outstandingBalance: 40 }, { merge: true });
  piNext = ['lost_after'];
  await F.chargeFeesNow(db, stripe, 't1', await tenantNow(), { clientId: 'c1', feeIds: ['f1'], by: 'Ana Ruiz' });
  await db.doc(`${T}/clients/c1`).set({ unpaidFees: [], outstandingBalance: 0 }, { merge: true });   // waived meanwhile
  n = await settleFees(later(16 * MIN));
  const fp: any = (await all(`${T}/feePayments`))[0];
  check('the fee was waived meanwhile: the money that came in is recorded and refunded to the card', n.recorded === 1 && fp?.status === 'refunded' && refunds.length === 1 && refunds[0].amount === 4000
    && (await lines()).some((x: any) => x.id === 'feepay_twice_pi_1' && x.type === 'income') && (await lines()).some((x: any) => x.id === 'feepay_twice_refund_pi_1'), { n, fp, refunds, ls: await lines() });
  n = await settleFees(later(30 * MIN));
  check('…the next run: nothing more (one refund)', n.checked === 0 && refunds.length === 1, n);

  await fresh();
  const p0: any = await stripe.paymentIntents.create({ amount: 4000, customer: 'cus_1', metadata: {} }, { idempotencyKey: 'x', stripeAccount: 'acct_1' });
  await db.doc(`${T}/feePayments/${p0.id}`).set({ id: p0.id, clientId: 'c1', paymentIntentId: p0.id, status: 'refunding', twiceCents: 4000, keptCents: 0, goneFeeIds: ['f1'], at: ago(20 * MIN) });
  await db.doc(`${T}/chargeFlags/twice_${p0.id}`).set({ status: 'needs_attention', code: 'paid_twice' });
  n = await F.settleStuckPaidTwice(db, 't1', await tenantNow(), {});
  check('money for fees already paid, whose refund was cut off: refunded once', n.recorded === 1 && refunds.length === 1 && (await get(`${T}/feePayments/${p0.id}`)).status === 'refunded' && (await get(`${T}/chargeFlags/twice_${p0.id}`)).status === 'resolved', { n, refunds });
  n = await F.settleStuckPaidTwice(db, 't1', await tenantNow(), {});
  check('…the next run: nothing more', n.checked === 0 && refunds.length === 1, n);
  await fresh();
  const p1: any = await stripe.paymentIntents.create({ amount: 8000, customer: 'cus_1', metadata: {} }, { idempotencyKey: 'y', stripeAccount: 'acct_1' });
  refunds.push({ id: 're_old', status: 'succeeded', amount: 4000, payment_intent: p1.id, metadata: { why: 'fees_already_paid', origin: 'app' }, account: 'acct_1' });
  await db.doc(`${T}/feePayments/${p1.id}`).set({ id: p1.id, clientId: 'c1', paymentIntentId: p1.id, status: 'refunding', twiceCents: 4000, keptCents: 4000, goneFeeIds: ['f2'], at: ago(2 * 864e5) });
  n = await F.settleStuckPaidTwice(db, 't1', await tenantNow(), {});
  check('…refunded two days ago with the answer lost (Stripe has forgotten that key): found and recorded, never sent again', n.recorded === 1 && rfCreates === 0 && refunds.length === 1 && (await get(`${T}/feePayments/${p1.id}`)).refundId === 're_old', { n, rfCreates });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('A deposit refund left on its way');
  const credit = async (x: any = {}) => db.doc(`${T}/depositCredits/d1`).set({ id: 'd1', kind: 'deposit', status: 'refunding', refundingCents: 2500, refundingAt: ago(20 * MIN), refundingForAppointmentId: 'a1',
    clientId: 'c1', clientName: 'Maya Lopez', amountCents: 2500, amount: 25, sourceAppointmentId: 'a1', stripePaymentIntentId: 'pi_dep', serviceName: 'Gel manicure', createdAt: ago(864e5), ...x });
  const settleDeps = async (at = Date.now()) => D.settleStuckDepositRefunds(db, 't1', await tenantNow(), { stripe, now: at });
  const refundLines = async () => (await lines('Refunds'));
  await fresh(); await db.doc(`${T}/appointments/a1`).set({ status: 'cancelled', clientId: 'c1', clientName: 'Maya Lopez' }); await credit();
  refunds.push({ id: 're_9', status: 'succeeded', amount: 2500, payment_intent: 'pi_dep', metadata: { depositCreditId: 'd1', appointmentId: 'a1', origin: 'app' }, account: 'acct_1' });
  n = await settleDeps();
  check('Stripe has the refund (its answer was lost): recorded once, not sent again', n.recorded === 1 && rfCreates === 0 && (await get(`${T}/depositCredits/d1`)).status === 'refunded' && (await get(`${T}/depositCredits/d1`)).stripeRefundId === 're_9'
    && (await refundLines()).length === 1 && (await get(`${T}/appointments/a1`)).depositRefunded === true, { n, rfCreates });
  n = await settleDeps();
  check('…the next run: nothing more', n.checked === 0 && (await refundLines()).length === 1, n);

  await fresh(); await db.doc(`${T}/appointments/a1`).set({ status: 'cancelled', clientId: 'c1', clientName: 'Maya Lopez' }); await credit();
  const two: any[] = await Promise.all([settleDeps(), settleDeps()]);
  check('it never reached Stripe: sent now, under the deposit’s own key (two runs at once: one refund, one record)', refunds.length === 1 && refunds[0].amount === 2500 && (await get(`${T}/depositCredits/d1`)).status === 'refunded' && (await refundLines()).length === 1, { two, refunds });

  await fresh(); await credit(); rfNext = ['refuse'];
  n = await settleDeps();
  check('Stripe says no: the deposit is back to use, nothing recorded', n.released === 1 && (await get(`${T}/depositCredits/d1`)).status === 'available' && (await refundLines()).length === 0, n);

  await fresh(); await credit({ refundingAt: ago(5 * MIN) });
  n = await settleDeps();
  check('a refund just asked for: not looked at yet', n.checked === 0 && rfCreates === 0 && (await get(`${T}/depositCredits/d1`)).status === 'refunding', n);
  await fresh(); await credit({ refundingFor: 'undo_a1' });
  n = await settleDeps();
  check('a deposit set aside by undoing its booking: left to that', n.checked === 0 && rfCreates === 0, n);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('A booking undone at the desk, with its answer lost');
  const booked = (x: any = {}) => ({ status: 'confirmed', source: 'planner', createdAt: new Date().toISOString(), startTime: new Date(later(3 * 864e5)).toISOString(), clientId: 'c1', clientName: 'Maya Lopez',
    depositStatus: 'paid', depositAmountCents: 2500, depositPaidVia: 'card_on_file', depositStripePaymentIntentId: 'pi_dep', ...x });
  const setUp = async (x: any = {}) => {
    await fresh(); await db.doc(`${T}/appointments/a1`).set(booked(x));
    await db.doc(`${T}/depositCredits/d1`).set({ id: 'd1', kind: 'deposit', status: 'available', clientId: 'c1', clientName: 'Maya Lopez', amountCents: 2500, amount: 25, sourceAppointmentId: 'a1', stripePaymentIntentId: 'pi_dep', createdAt: ago(MIN) });
  };
  const undoIt = () => undo(req({ tenantId: 't1', appointmentId: 'a1' }, staff)) as any;
  const settleUndos = async (at: number) => U.settleStuckUndos(db, 't1', await tenantNow(), { stripe, now: at });
  await setUp(); rfNext = ['lost_after'];
  r = await undoIt();
  check('the refund goes through at Stripe, but its answer is lost: the booking stays, its deposit set aside', r.status === 502 && refunds.length === 1 && (await get(`${T}/appointments/a1`)).status === 'confirmed' && (await get(`${T}/depositCredits/d1`)).status === 'refunding', r.body);
  n = await settleUndos(later(10 * MIN));
  check('…ten minutes on: not looked at yet', n.checked === 0, n);
  n = await settleUndos(later(20 * MIN));
  ap = await get(`${T}/appointments/a1`);
  check('…then: finished, as the desk meant (the money is back with the client)', n.recorded === 1 && ap.status === 'cancelled' && !!ap.undoneAt && !ap.undoClaim && ap.depositStatus === 'refunded' && (await get(`${T}/depositCredits/d1`)).status === 'refunded' && (await refundLines()).length === 1, { n, ap });
  check('…the client gets the one short note, and no refund was sent from here', messages.length === 1 && /removed/.test(messages[0].text || '') && /\$25\.00 deposit has been refunded/.test(messages[0].text || '') && rfCreates === 1, messages);
  n = await settleUndos(later(30 * MIN));
  r = await undoIt();
  const undoneOnce = (await refundLines()).length === 1 && messages.length === 1;
  check('…the next run, or the desk asking again: nothing more', n.checked === 0 && r.body.ok && r.body.already && undoneOnce && refunds.length === 1, { n, r: r.body });
  await setUp(); rfNext = ['lost_after'];
  await undoIt();
  const twoUndos: any[] = await Promise.all([settleUndos(later(20 * MIN)), settleUndos(later(20 * MIN))]);
  check('two runs at once: finished once (one line, one note)', (await refundLines()).length === 1 && messages.length === 1 && twoUndos.reduce((k2, x) => k2 + x.recorded, 0) === 1, twoUndos);

  await setUp(); rfNext = ['lost_before'];
  r = await undoIt();
  n = await settleUndos(later(20 * MIN));
  check('the refund never reached Stripe: left as it is for two hours', r.status === 502 && n.waiting === 1 && !!(await get(`${T}/appointments/a1`)).undoClaim && (await get(`${T}/depositCredits/d1`)).status === 'refunding', { r: r.body, n });
  n = await settleUndos(later(2 * HOUR + 5 * MIN));
  ap = await get(`${T}/appointments/a1`);
  check('…after two hours: the booking and its deposit go back as they were, with nothing sent from here', n.released === 1 && ap.status === 'confirmed' && !ap.undoClaim && (await get(`${T}/depositCredits/d1`)).status === 'available' && refunds.length === 0 && messages.length === 0, { n, ap });
  r = await undoIt();
  check('…so the desk can undo it again: refunded once, recorded once', r.body.ok && refunds.length === 1 && (await refundLines()).length === 1 && (await get(`${T}/appointments/a1`)).status === 'cancelled', r.body);

  await setUp(); rfNext = ['lost_after'];
  await undoIt();
  await db.doc(`${T}/appointments/a1`).set({ status: 'checked_in' }, { merge: true });
  n = await settleUndos(later(20 * MIN));
  ap = await get(`${T}/appointments/a1`);
  check('the booking went ahead meanwhile (checked in): the refund is recorded, the booking stays, the team is told, the client isn’t texted', n.recorded === 1 && ap.status === 'checked_in' && !ap.undoneAt && ap.depositStatus === 'refunded'
    && ap.needsAttention === 'undo_refund_kept' && (await refundLines()).length === 1 && messages.length === 0 && (await notes()).some((x: any) => /went ahead/.test(x.message)), { n, ap });

  await setUp({ depositPaidVia: null, depositStripePaymentIntentId: null, depositPaidMethod: 'Cash', undoClaim: ago(20 * MIN) });
  await db.doc(`${T}/depositCredits/d1`).set({ status: 'refunding', refundingFor: 'undo_a1', refundingAt: ago(20 * MIN), refundingCents: 2500 }, { merge: true });
  n = await settleUndos(later(0));
  check('a cash deposit (nothing went to Stripe) left set aside: let go at once', n.released === 1 && !(await get(`${T}/appointments/a1`)).undoClaim && (await get(`${T}/depositCredits/d1`)).status === 'available', n);

  await setUp({ undoClaim: ago(MIN) });
  await db.doc(`${T}/depositCredits/d1`).set({ status: 'refunding', refundingFor: 'undo_a1', refundingAt: ago(MIN), refundingCents: 2500 }, { merge: true });
  const taken = String((await get(`${T}/appointments/a1`)).undoClaim);
  await U.releaseUndo(db, 't1', 'a1', [{ ref: db.doc(`${T}/depositCredits/d1`) }], ago(30 * MIN));
  check('letting go of an older claim never takes one the desk has just made', (await get(`${T}/appointments/a1`)).undoClaim === taken && (await get(`${T}/depositCredits/d1`)).status === 'refunding');

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('A sale refunded to the card from Money');
  const SALE = `${T}/transactions/s1`;
  const saleSetUp = async () => {
    await fresh();
    await db.doc(SALE).set({ id: 's1', type: 'income', category: 'Service Revenue', amount: 60, tipAmount: 10, staffId: 'st1', description: 'Gel manicure', clientOrVendor: 'Maya Lopez', clientId: 'c1', paymentMethod: 'Card', stripePaymentIntentId: 'pi_sale', date: ago(864e5) });
  };
  const rec = { reason: 'Not happy with the shape', refundTip: true, tipStrategy: 'clawback', payReversals: [{ staffId: 'st1', amount: 12 }] };
  const refundSale = async (record: any = rec) => MR.refundSaleToCard(db, 't1', await tenantNow(), 's1', 7000, 'Ana Ruiz', record === null ? null : MR.cleanRecord(record)) as any;
  const saleLine = async () => get(`${T}/transactions/refund_s1`);
  const settleSales = async (at: number) => MR.settleStuckSaleRefunds(db, 't1', await tenantNow(), { stripe, now: at });
  await saleSetUp();
  let sr: any = await refundSale();
  let line: any = await saleLine();
  check('refunded to the card and recorded on the server: the line has the reason, the tip and the commission taken back', sr.ok && sr.card && sr.recorded && refunds.length === 1 && refunds[0].amount === 7000 && line?.amount === 70
    && line.tipReversal?.staffId === 'st1' && line.tipReversal.amount === 10 && line.payReversals?.[0]?.amount === 12 && /Not happy/.test(line.notes) && (await get(SALE)).refundedAt && !(await get(SALE)).cardRefundClaim, { sr, line });
  sr = await refundSale();
  check('…asked again: refused as already refunded, nothing more', !sr.ok && sr.status === 409 && refunds.length === 1 && (await lines('Refunds')).length === 1, sr);
  await saleSetUp();
  const twoSales: any[] = await Promise.all([refundSale(), refundSale()]);
  check('two taps at once: one refund, one line', refunds.length === 1 && (await lines('Refunds')).length === 1 && twoSales.filter((x) => x.ok).length === 1, twoSales);

  await saleSetUp(); rfNext = ['lost_after'];
  sr = await refundSale();
  check('the refund goes through, its answer lost: the screen is told Stripe didn’t answer, and the claim stays', !sr.ok && sr.unknown && refunds.length === 1 && !!(await get(SALE)).cardRefundClaim && !(await get(SALE)).refundedAt && !(await saleLine()), sr);
  await db.doc(SALE).set({ cardRefundClaim: { at: ago(3 * MIN) } }, { merge: true });
  sr = await refundSale();
  line = await saleLine();
  check('…asked again a few minutes on: the refund Stripe has is recorded (with the first try’s reason), never sent again', sr.ok && sr.already && sr.recorded && refunds.length === 1 && line?.amount === 70 && /Not happy/.test(line.notes), { sr, line });

  await saleSetUp(); rfNext = ['lost_after'];
  await refundSale();
  n = await settleSales(later(10 * MIN));
  check('not asked again: ten minutes on, not looked at yet', n.checked === 0, n);
  n = await settleSales(later(20 * MIN));
  line = await saleLine();
  check('…then the check records it, as it was asked (reason, tip and commission), and the owners are told', n.recorded === 1 && line?.amount === 70 && line.tipReversal?.amount === 10 && line.payReversals?.length === 1 && (await get(SALE)).refundedAt
    && (await notes()).some((x: any) => /never heard back/.test(x.message)), { n, line });
  n = await settleSales(later(30 * MIN));
  check('…the next run: nothing more', n.checked === 0 && (await lines('Refunds')).length === 1 && refunds.length === 1, n);

  await saleSetUp(); rfNext = ['lost_before'];
  sr = await refundSale();
  n = await settleSales(later(20 * MIN));
  check('it never reached Stripe: held for two hours, nothing recorded', !sr.ok && sr.unknown && n.waiting === 1 && !(await saleLine()) && !!(await get(SALE)).cardRefundClaim, { sr, n });
  n = await settleSales(later(2 * HOUR + 5 * MIN));
  check('…then let go, with nothing sent from the check', n.released === 1 && !(await get(SALE)).cardRefundClaim && refunds.length === 0 && !(await get(SALE)).refundedAt, n);
  sr = await refundSale();
  check('…so it can be refunded again: once, recorded once', sr.ok && refunds.length === 1 && (await lines('Refunds')).length === 1, sr);

  await saleSetUp(); rfNext = ['refuse'];
  sr = await refundSale();
  check('Stripe says no: nothing recorded, and the sale can be refunded again at once', !sr.ok && !sr.unknown && !(await get(SALE)).cardRefundClaim && !(await saleLine()), sr);

  await fresh();
  await db.doc(`${T}/receipts/rc1`).set({ checkoutSessionId: 'cs_split', payments: [{ stripePaymentIntentId: 'pi_a', amount: 40 }, { stripePaymentIntentId: 'pi_b', amount: 30 }] });
  await db.doc(SALE).set({ id: 's1', type: 'income', category: 'Service Revenue', amount: 70, description: 'Gel manicure', clientOrVendor: 'Maya Lopez', clientId: 'c1', paymentMethod: 'Card', checkoutSessionId: 'cs_split', date: ago(864e5) });
  rfNext = ['ok', 'lost_after'];
  sr = await MR.refundSaleToCard(db, 't1', await tenantNow(), 's1', 7000, 'Ana Ruiz', MR.cleanRecord(rec));
  check('a sale paid on two cards, the second card’s refund unanswered: nothing is recorded yet, and the claim stays', !sr.ok && sr.unknown && refunds.length === 2 && !(await saleLine()) && !!(await get(SALE)).cardRefundClaim, sr);
  n = await settleSales(later(20 * MIN));
  check('…the check records both cards’ refunds together', n.recorded === 1 && (await saleLine())?.amount === 70 && (await get(SALE)).cardRefunds?.length === 2 && refunds.length === 2, { n, line: await saleLine() });

  await saleSetUp();
  sr = await refundSale(null);
  check('a screen from before the server wrote the line: the card is refunded and kept on the sale, and the screen writes the line', sr.ok && sr.card && !sr.recorded && (await get(SALE)).cardRefunds?.length === 1 && !(await saleLine()) && !(await get(SALE)).cardRefundClaim, sr);

  await saleSetUp();
  await db.doc(SALE).set({ cardRefunds: [{ pi: 'pi_sale', cents: 7000, refundId: 're_x', at: ago(30 * MIN), by: 'Ana Ruiz' }], cardRefundClaim: { at: ago(30 * MIN), cents: 7000, by: 'Ana Ruiz', record: MR.cleanRecord(rec) } }, { merge: true });
  n = await settleSales(later(0));
  check('refunded and kept on the sale, but never written in the books: written now', n.recorded === 1 && (await saleLine())?.amount === 70 && (await get(SALE)).refundedAt && refunds.length === 0, n);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('A booth booking’s money, with its answer lost');
  const reservation = (x: any = {}) => ({ id: 'r1', status: 'completed', name: 'Lena Cho', boothName: 'Chair 2', amountCents: 6000, stripePaymentIntentId: 'pi_book', stripeCustomerId: 'cus_b', stripePaymentMethodId: 'pm_b',
    overageStatus: 'due', overageDueCents: 1500, overageMinutes: 30, startDate: '2026-10-20', endDate: '2026-10-20', ...x });
  const boothSetUp = async () => { await fresh({ stripeAccountId: null }); await db.doc(`${T}/boothReservations/r1`).set(reservation()); };
  const settleBooth = async (at: number) => B.settleLostBoothMoney(db, 't1', await tenantNow(), { stripe, now: at });
  await boothSetUp(); piNext = ['lost_after'];
  r = await boothOverage(req({ tenantId: 't1', reservationId: 'r1' }));
  n = await settleBooth(later(20 * MIN));
  check('an overage charged, its answer lost: recorded once (with its fee)', r.status === 502 && n.recorded === 1 && (await get(`${T}/boothReservations/r1`)).overageStatus === 'charged' && (await lines('Booth Rent')).length === 1 && (await lines('Processing Fee')).length === 1, { r: r.body, n });
  n = await settleBooth(later(30 * MIN));
  check('…the next run: nothing more', n.checked === 0 && (await lines('Booth Rent')).length === 1 && piCreates === 1, n);
  await boothSetUp(); piNext = ['lost_after'];
  await boothOverage(req({ tenantId: 't1', reservationId: 'r1' }));
  const twoBooth: any[] = await Promise.all([settleBooth(later(20 * MIN)), settleBooth(later(20 * MIN))]);
  check('two runs at once: the overage is recorded once', (await lines('Booth Rent')).length === 1 && twoBooth.reduce((k2, x) => k2 + x.recorded, 0) === 1, twoBooth);
  await boothSetUp(); piNext = ['lost_before'];
  await boothOverage(req({ tenantId: 't1', reservationId: 'r1' }));
  n = await settleBooth(later(20 * MIN));
  check('an overage that never reached Stripe: held for two hours', n.waiting === 1 && (await get(`${T}/boothReservations/r1`)).overageStatus === 'charging', n);
  n = await settleBooth(later(2 * HOUR + 5 * MIN));
  check('…then due again, for the desk to charge or collect, nothing recorded', n.released === 1 && (await get(`${T}/boothReservations/r1`)).overageStatus === 'due' && (await lines()).length === 0, n);

  await boothSetUp(); piNext = ['lost_after'];
  r = await boothPatch(req({ tenantId: 't1', reservationId: 'r1', action: 'incidental', amountCents: 2000, category: 'Cleaning', key: 'try1' }));
  n = await settleBooth(later(20 * MIN));
  let res: any = await get(`${T}/boothReservations/r1`);
  check('an incidental charged, its answer lost: recorded once, on the booking once', r.status === 502 && n.recorded === 1 && (await lines('Renter Incidental')).length === 1 && res.incidentals?.length === 1 && res.incidentalsTotalCents === 2000 && !res.incidentalOpenAt, { r: r.body, n, res });
  check('…its attempt is closed as charged', (await get(`${T}/boothReservations/r1/charges/inc_try1`)).status === 'charged');

  await boothSetUp(); rfNext = ['lost_after'];
  r = await boothPatch(req({ tenantId: 't1', reservationId: 'r1' }));
  n = await settleBooth(later(20 * MIN));
  check('a booking refunded, its answer lost: recorded once, not sent again', r.status === 502 && n.recorded === 1 && (await get(`${T}/boothReservations/r1`)).status === 'refunded' && (await lines('Refunds')).length === 1 && rfCreates === 1, { r: r.body, n });
  await boothSetUp(); rfNext = ['lost_before'];
  await boothPatch(req({ tenantId: 't1', reservationId: 'r1' }));
  n = await settleBooth(later(2 * HOUR + 5 * MIN));
  res = await get(`${T}/boothReservations/r1`);
  check('a refund that never reached Stripe: after two hours the booking can be refunded again', n.released === 1 && !res.refundClaimAt && res.status === 'completed' && (await lines()).length === 0, { n, res });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('Rent paid online that wasn’t owed, with its refund’s answer lost');
  const I = `${T}/rentInvoices/i1`;
  const rentSetUp = async () => {
    await fresh({ stripeAccountId: null });
    await db.doc(`${T}/renters/rn1`).set({ firstName: 'Lena', lastName: 'Cho', email: 'lena@example.com' });
    await db.doc(`${T}/leases/l1`).set({ renterId: 'rn1', boothId: 'b1', status: 'active' });
    await db.doc(I).set({ id: 'i1', leaseId: 'l1', status: 'paid', amountCents: 80000, dueDate: '2026-10-01', paidAt: ago(864e5), paidMethod: 'Cash' });
  };
  const paidAgain = () => R.recordRentPayment(db, stripe, 't1', 'i1', { id: 'cs_2', payment_intent: 'pi_rent2', amount_total: 80000 });
  const settleRent = async (at: number) => R.settleStuckRentRefunds(db, 't1', await tenantNow(), { stripe, now: at });
  const rentNote = async () => String((await get(`${T}/notifications/rent_extra_cs_2`))?.message || '');
  await rentSetUp(); rfNext = ['lost_after'];
  let rp: any = await paidAgain();
  check('paid on a page after it was paid at the desk; the refund goes through, its answer lost: on its way, and the studio is told not to refund it by hand',
    rp.extra && !rp.refunded && (await get(I)).extraPayments?.cs_2?.state === 'refunding' && !!(await get(I)).extraRefundOpenAt && /no need to refund it by hand/.test(await rentNote()), { rp, inv: await get(I) });
  n = await settleRent(later(10 * MIN));
  check('…ten minutes on: not looked at yet', n.checked === 0, n);
  n = await settleRent(later(20 * MIN));
  let inv: any = await get(I);
  check('…then: the refund Stripe has is recorded, not sent again', n.recorded === 1 && inv.extraPayments.cs_2.state === 'refunded' && inv.extraPayments.cs_2.refundId === 're_1' && !inv.extraRefundOpenAt && rfCreates === 1 && /refunded to their card automatically/.test(await rentNote()), { n, inv });
  n = await settleRent(later(30 * MIN));
  check('…the next run: nothing more', n.checked === 0 && refunds.length === 1, n);

  await rentSetUp(); rfNext = ['lost_before'];
  await paidAgain();
  const twoRent: any[] = await Promise.all([settleRent(later(20 * MIN)), settleRent(later(20 * MIN))]);
  check('the refund never reached Stripe: sent now, under the same key, once (two runs at once)', refunds.length === 1 && refunds[0].amount === 80000 && (await get(I)).extraPayments.cs_2.state === 'refunded' && twoRent.reduce((k2, x) => k2 + x.recorded, 0) === 1, { twoRent, refunds });

  await rentSetUp(); rfNext = ['lost_before'];
  await paidAgain();
  refunds.push({ id: 're_hand', status: 'succeeded', amount: 80000, payment_intent: 'pi_rent2', metadata: {}, created: Math.floor(Date.now() / 1000) });
  n = await settleRent(later(20 * MIN));
  check('refunded by hand in Stripe meanwhile: recorded as that refund, never a second', n.recorded === 1 && refunds.length === 1 && (await get(I)).extraPayments.cs_2.refundId === 're_hand', { n, refunds });

  await rentSetUp(); rfNext = ['lost_before', 'refuse'];
  await paidAgain();
  n = await settleRent(later(20 * MIN));
  inv = await get(I);
  check('Stripe says no when it’s sent again: kept on the invoice for the studio, and the note says so', n.released === 1 && inv.extraPayments.cs_2.state === 'refund_failed' && !inv.extraRefundOpenAt && /please refund it in Stripe/.test(await rentNote()), { n, inv });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('A group gift cancelled, with a share’s refund unanswered');
  const groupSetUp = async (g: any = {}) => {
    await fresh();
    await db.doc(`${T}/giftGroups/g1`).set({ id: 'g1', status: 'collecting', recipientName: 'Rosa', organizerName: 'Ana Ruiz', organizerEmail: 'ana@example.com', sendAt: new Date(later(864e5)).toISOString(), via: 'email', ...g });
    await db.doc(`${T}/giftOrders/o1`).set({ id: 'o1', groupId: 'g1', status: 'paid', amountCents: 2500, paymentIntentId: 'pi_g1', buyerName: 'Ana Ruiz', organizer: true, createdAt: ago(864e5) });
    await db.doc(`${T}/giftOrders/o2`).set({ id: 'o2', groupId: 'g1', status: 'paid', amountCents: 3000, paymentIntentId: 'pi_g2', buyerName: 'Ben Ito', createdAt: ago(864e5) });
  };
  const shareLines = async () => (await lines('Gift Card Sales')).filter((x: any) => x.amount < 0);
  await groupSetUp(); rfNext = ['ok', 'lost_after'];
  let gr: any = await GG.cancelGroup(db, 't1', 'g1');
  check('one share refunded, the other’s answer lost: the gift is held, and the organizer is told it will finish on its own', !gr.ok && /finish on its own/.test(gr.error) && (await get(`${T}/giftGroups/g1`)).status === 'cancelling'
    && (await get(`${T}/giftOrders/o1`)).status === 'refunded' && (await get(`${T}/giftOrders/o2`)).status === 'refunding' && (await shareLines()).length === 1, { gr, g: await get(`${T}/giftGroups/g1`) });
  gr = await GG.finishGroup(db, 't1', 'g1');
  check('…the gift can’t be sent meanwhile', !gr.ok && (await all(`${T}/giftCards`)).length === 0, gr);
  await db.doc(`${T}/giftGroups/g1`).set({ cancellingAt: ago(20 * MIN) }, { merge: true });
  n = await GG.settleCancellingGroups(db, 't1', await tenantNow(), {});
  check('…the check sends the share back under the same key: refunded once, recorded once, the gift cancelled', n.recorded === 1 && refunds.length === 2 && (await get(`${T}/giftOrders/o2`)).status === 'refunded' && (await shareLines()).length === 2
    && (await get(`${T}/giftGroups/g1`)).status === 'cancelled', { n, refunds, g: await get(`${T}/giftGroups/g1`) });
  n = await GG.settleCancellingGroups(db, 't1', await tenantNow(), {});
  check('…the next run: nothing more', n.checked === 0 && refunds.length === 2 && (await shareLines()).length === 2, n);
  await groupSetUp({ status: 'cancelling', cancellingAt: ago(20 * MIN) });
  n = await GG.settleCancellingGroups(db, 't1', await tenantNow(), {});
  check('a cancel cut off before any share went back: every share refunded, once each', n.recorded === 1 && refunds.length === 2 && (await shareLines()).length === 2 && (await get(`${T}/giftGroups/g1`)).status === 'cancelled', n);

  console.log('A company’s second payment for gift cards, its refund unanswered');
  await fresh();
  await db.doc(`${T}/giftBulk/b1`).set({ id: 'b1', status: 'issued', company: 'Acme Dental', totalCents: 50000, extraRefundOpenAt: ago(20 * MIN),
    extraPayments: { cs_9: { sessionId: 'cs_9', paymentIntentId: 'pi_b2', cents: 50000, why: 'paid_twice', state: 'refunding', claimAt: ago(20 * MIN), firstAt: ago(20 * MIN) } } });
  await db.doc(`${T}/giftBulk/b2`).set({ id: 'b2', status: 'issued', company: 'Fresh Co', totalCents: 9000, extraRefundOpenAt: ago(5 * MIN),
    extraPayments: { cs_8: { sessionId: 'cs_8', paymentIntentId: 'pi_b3', cents: 9000, why: 'paid_twice', state: 'refunding', claimAt: ago(5 * MIN), firstAt: ago(5 * MIN) } } });
  n = await GB.settleStuckBulkRefunds(db, 't1', await tenantNow(), {});
  let b1: any = await get(`${T}/giftBulk/b1`);
  check('sent again under the same key: refunded once, the order no longer waiting, the managers told', n.recorded === 1 && n.checked === 1 && refunds.length === 1 && refunds[0].amount === 50000 && b1.extraPayments.cs_9.state === 'refunded' && !b1.extraRefundOpenAt, { n, b1 });
  check('…one asked for five minutes ago: not looked at yet', (await get(`${T}/giftBulk/b2`)).extraPayments.cs_8.state === 'refunding' && refunds.every((r: any) => r.payment_intent !== 'pi_b3'));
  n = await GB.settleStuckBulkRefunds(db, 't1', await tenantNow(), {});
  check('…the next run: nothing more', n.checked === 0 && refunds.length === 1, n);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('The five-minute check');
  await boothSetUp(); piNext = ['lost_after'];
  await boothOverage(req({ tenantId: 't1', reservationId: 'r1' }));
  let m: any = await S.sweepMoneyOnTheWay(db, 't1', await tenantNow(), { stripe, now: later(20 * MIN) });
  check('a business without its own payments account: its booth money is still settled', m.recorded === 1 && m.byKind.boothMoney.recorded === 1 && m.failed.length === 0 && (await lines('Booth Rent')).length === 1, m);
  await boothSetUp(); await db.doc(T).set({ stripeAccountId: 'acct_1' }, { merge: true }); piNext = ['lost_after'];
  await boothOverage(req({ tenantId: 't1', reservationId: 'r1' }));
  const realCollection = db.collection;
  db.collection = (p: string) => { if (/\/cardAttempts$/.test(p)) throw new Error('index missing'); return realCollection(p); };
  m = await S.sweepMoneyOnTheWay(db, 't1', await tenantNow(), { stripe, now: later(20 * MIN) });
  db.collection = realCollection;
  check('one part failing doesn’t stop the rest', m.failed.includes('cardCharges') && m.byKind.boothMoney?.recorded === 1 && (await lines('Booth Rent')).length === 1, m);
  const cron = fs.readFileSync('src/app/api/cron/retail-payments/route.ts', 'utf8');
  check('the five-minute job runs it for every business, after the shop’s own work',
    /sweepMoneyOnTheWay\(db, t\.id, tenant\)/.test(cron) && /if \(!tenant\.stripeAccountId && !tenant\.stripeConnectAccountId\) \{ await money\(\); return; \}/.test(cron) && cron.lastIndexOf('await money();') > cron.indexOf('shareOrderTip('));

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('lost-payments ok');
})();
