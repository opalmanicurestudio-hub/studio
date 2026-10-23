// Checks the money on a booth or day-rental booking moves once and only for the business's own team
// (api/booths/reserve): charging an overage or an incidental to the saved card and refunding a booking need someone
// signed in who may do it; two taps, or a retry after Stripe's answer was lost, charge or refund once and write one
// record; a day pass or a booking confirmed twice at once (a refresh, two tabs) is recorded once.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/booth-money.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
let db: any = strictTransactions(makeDb());
let signedIn = true;
// Stripe (the platform's own account): one charge or refund per key, an answer that can go missing, a card that can
// say no.
let charges: any[] = []; let refunds: any[] = []; const keys = new Map<string, any>(); let piCalls = 0; let rfCalls = 0;
let mode: 'ok' | 'lost_after' | 'decline' = 'ok';
const lost = () => { const e: any = new Error('connection reset'); e.type = 'StripeConnectionError'; return e; };
function StripeMock(this: any) {
  return {
    paymentIntents: {
      create: async (p: any, o: any) => {
        piCalls++;
        if (mode === 'decline') { const e: any = new Error('Your card was declined.'); e.type = 'StripeCardError'; throw e; }
        let pi = keys.get(o?.idempotencyKey);
        if (!pi) { pi = { id: `pi_${charges.length + 1}`, status: 'succeeded', amount: p.amount, metadata: p.metadata, latest_charge: { id: `ch_${charges.length + 1}`, balance_transaction: { fee: 59 } } }; charges.push(pi); if (o?.idempotencyKey) keys.set(o.idempotencyKey, pi); }
        if (mode === 'lost_after') { mode = 'ok'; throw lost(); }
        return pi;
      },
      retrieve: async (id: string) => charges.find((c) => c.id === id) || { id, latest_charge: { id: 'ch_x', balance_transaction: { fee: 120 } } },
    },
    refunds: {
      create: async (p: any, o: any) => {
        rfCalls++;
        let r = keys.get(o?.idempotencyKey);
        if (!r) { r = { id: `re_${refunds.length + 1}`, status: 'succeeded', amount: p.amount, payment_intent: p.payment_intent, metadata: p.metadata || {} }; refunds.push(r); if (o?.idempotencyKey) keys.set(o.idempotencyKey, r); }
        if (mode === 'lost_after') { mode = 'ok'; throw lost(); }
        return r;
      },
      list: async (q: any) => ({ data: refunds.filter((r) => r.payment_intent === q.payment_intent) }),
    },
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_status: 'paid', payment_intent: { id: 'pi_paid', payment_method: 'pm_1' } }) } },
  };
}
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock, __esModule: true });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireCan: async () => (signedIn ? { actor: { uid: 'm1', name: 'Ana Ruiz', role: 'manager' } } : { deny: { status: 401, body: { ok: false, error: 'Please sign in again.' } } }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (request === '@/lib/reservation-notify') return { sendReservationConfirmation: async () => undefined };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, url: 'https://studio.test/api/booths/reserve', headers: { get: () => null }, nextUrl: { origin: 'https://studio.test' } }) as any;
const getReq = (q: Record<string, string>) => ({ url: `https://studio.test/api/booths/reserve?${new URLSearchParams(q)}`, headers: { get: () => null } }) as any;
const lines = async (cat?: string) => (await all(`${T}/transactions`)).filter((x: any) => !cat || x.category === cat);
const booking = (x: any = {}) => ({ id: 'r1', status: 'completed', name: 'Lena Cho', boothName: 'Chair 2', amountCents: 6000, stripePaymentIntentId: 'pi_book', stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1',
  overageStatus: 'due', overageDueCents: 1500, overageMinutes: 30, startDate: '2026-10-20', endDate: '2026-10-20', ...x });
const fresh = async (x: any = {}) => {
  db = strictTransactions(makeDb()); charges = []; refunds = []; keys.clear(); piCalls = 0; rfCalls = 0; mode = 'ok'; signedIn = true;
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', incidentalCategories: [{ label: 'Cleaning', capCents: 5000 }] });
  await db.doc(`${T}/boothReservations/r1`).set(booking(x));
};

(async () => {
  const { PUT, PATCH, GET } = await import('../../src/app/api/booths/reserve/route');
  const overage = () => PUT(req({ tenantId: 't1', reservationId: 'r1' })) as any;
  const refund = (x: any = {}) => PATCH(req({ tenantId: 't1', reservationId: 'r1', ...x })) as any;

  console.log('signed in');
  await fresh(); signedIn = false;
  let r: any = await overage();
  check('charging an overage to the saved card without signing in: refused, nothing charged', r.status === 401 && piCalls === 0, r.body);
  r = await refund();
  check('…a refund: the same', r.status === 401 && rfCalls === 0);
  r = await refund({ action: 'incidental', amountCents: 2000, category: 'Cleaning', key: 'k1' });
  check('…an incidental charge: the same', r.status === 401 && piCalls === 0);

  console.log('an overage');
  await fresh();
  const two: any[] = await Promise.all([overage(), overage()]);
  check('two taps at once: charged once, one line in the books', charges.length === 1 && (await lines('Booth Rent')).length === 1 && (await get(`${T}/boothReservations/r1`)).overageStatus === 'charged', two.map((x) => x.body));
  r = await overage();
  check('…asked again later: done already', r.body.ok && r.body.already && charges.length === 1);
  await fresh(); mode = 'lost_after';
  r = await overage();
  check('the answer lost: it says to try again, and the overage is held', r.status === 502 && (await get(`${T}/boothReservations/r1`)).overageStatus === 'charging', r.body);
  await db.doc(`${T}/boothReservations/r1`).set({ overageClaimAt: new Date(Date.now() - 5 * 60000).toISOString() }, { merge: true });
  r = await overage();
  check('…asked again: the same charge (one at Stripe), recorded once', r.body.ok && charges.length === 1 && (await lines('Booth Rent')).length === 1, r.body);
  await fresh(); mode = 'decline';
  r = await overage();
  check('the card says no: still due, nothing recorded', r.status === 402 && (await get(`${T}/boothReservations/r1`)).overageStatus === 'due' && (await lines()).length === 0, r.body);

  console.log('an incidental');
  await fresh();
  const inc = (key = 'try1') => refund({ action: 'incidental', amountCents: 2000, category: 'Cleaning', key });
  const both: any[] = await Promise.all([inc(), inc()]);
  check('two taps at once: charged once, one line, on the booking once', charges.length === 1 && (await lines('Renter Incidental')).length === 1 && (await get(`${T}/boothReservations/r1`)).incidentals?.length === 1 && (await get(`${T}/boothReservations/r1`)).incidentalsTotalCents === 2000, both.map((x) => x.body));
  r = await inc('try2');
  check('…a second charge (a new attempt): charged as well', r.body.ok && charges.length === 2 && (await lines('Renter Incidental')).length === 2, r.body);

  console.log('a refund');
  await fresh();
  const rs: any[] = await Promise.all([refund(), refund()]);
  check('two taps at once: one refund, one record', refunds.length === 1 && (await lines('Refunds')).length === 1 && (await get(`${T}/boothReservations/r1`)).status === 'refunded', rs.map((x) => x.body));
  await fresh(); mode = 'lost_after';
  r = await refund();
  check('the answer lost: it says to try again', r.status === 502 && (await get(`${T}/boothReservations/r1`)).status === 'completed', r.body);
  await db.doc(`${T}/boothReservations/r1`).set({ refundClaimAt: new Date(Date.now() - 5 * 60000).toISOString() }, { merge: true });
  r = await refund();
  check('…asked again: the refund Stripe has is recorded, not sent again', r.body.ok && refunds.length === 1 && rfCalls === 1 && (await lines('Refunds')).length === 1, { body: r.body, rfCalls });

  console.log('confirmations');
  await fresh();
  await db.doc(`${T}/boothPassPurchases/pp1`).set({ id: 'pp1', status: 'pending', stripeSessionId: 'cs_1', name: 'Lena Cho', email: 'lena@example.com', days: 5, packLabel: '5-day pass', amountCents: 20000 });
  const ps: any[] = await Promise.all([GET(getReq({ tenantId: 't1', passPurchaseId: 'pp1', sessionId: 'cs_1' })), GET(getReq({ tenantId: 't1', passPurchaseId: 'pp1', sessionId: 'cs_1' }))]);
  check('a day pass confirmed twice at once: one pass, one line', (await all(`${T}/boothPasses`)).length === 1 && (await lines('Day Pass')).length === 1 && ps.every((x: any) => x.body.ok), ps.map((x: any) => x.body));
  await fresh({ status: 'pending_payment', stripeSessionId: 'cs_2', stripePaymentIntentId: null, boothId: 'b1' });
  const cs: any[] = await Promise.all([GET(getReq({ tenantId: 't1', reservationId: 'r1', sessionId: 'cs_2' })), GET(getReq({ tenantId: 't1', reservationId: 'r1', sessionId: 'cs_2' }))]);
  check('a booking confirmed twice at once: one line for its rent', (await lines('Booth Rent')).length === 1 && (await get(`${T}/boothReservations/r1`)).status === 'confirmed' && cs.every((x: any) => x.body.ok), cs.map((x: any) => x.body));

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('booth-money ok');
})();
