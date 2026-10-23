// Checks a booking's deposit goes back to the card once, whichever screen sends it (lib/deposit-refund, through
// api/stripe/studio-cancel-refund and api/stripe/deposit-refund), and that undoing a booking at the desk refunds and
// records its deposit once (api/appointments/undo-booking):
//   - two taps, or a retry after a lost answer, send one refund and write one record;
//   - a deposit used by a sale at the same moment is either refunded or used, never both;
//   - a walk-in's deposit (no booking behind the id) is refunded and recorded, and no booking is made up for it;
//   - a refund Stripe already has for the deposit (an earlier try, or one sent before this) is recorded, not sent again;
//   - Stripe saying no gives the deposit back to use.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/deposit-refunds.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
// Stripe, as far as refunds go: one refund per key, a list per payment, and an answer that can go missing.
let atStripe: any[] = []; const keys = new Map<string, any>(); let creates = 0;
let mode: 'ok' | 'lost_after' | 'lost_before' | 'refuse' = 'ok';
function StripeMock(this: any) {
  return {
    refunds: {
      create: async (p: any, o: any) => {
        creates++;
        if (mode === 'refuse') { const e: any = new Error('This charge has already been refunded.'); e.type = 'StripeInvalidRequestError'; throw e; }
        if (mode === 'lost_before') { mode = 'ok'; const e: any = new Error('connection reset'); e.type = 'StripeConnectionError'; throw e; }
        let r = keys.get(o?.idempotencyKey);
        if (!r) { r = { id: `re_${atStripe.length + 1}`, status: 'succeeded', amount: p.amount, payment_intent: p.payment_intent, metadata: p.metadata || {} }; atStripe.push(r); keys.set(o?.idempotencyKey, r); }
        if (mode === 'lost_after') { mode = 'ok'; const e: any = new Error('connection reset'); e.type = 'StripeConnectionError'; throw e; }
        return r;
      },
      list: async (q: any) => ({ data: atStripe.filter((r) => r.payment_intent === q.payment_intent) }),
      retrieve: async (id: string) => atStripe.find((r) => r.id === id),
    },
    paymentIntents: { retrieve: async () => ({ status: 'succeeded', latest_charge: { balance_transaction: { fee: 120 } } }) },
  };
}
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }), staffOrServer: async () => true };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async () => true });
  if (request === '@/lib/refund-notice' || /\/src\/lib\/refund-notice(\.ts)?$/.test(request)) return fake(request, { __esModule: true, sendRefundNotice: async () => undefined, default: { sendRefundNotice: async () => undefined } });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://studio.test' } }) as any;
const refundLines = async () => (await all(`${T}/transactions`)).filter((x: any) => x.category === 'Refunds');
const fresh = async (credit: any = {}, appt: any = { status: 'cancelled', clientId: 'c1', clientName: 'Maya Lopez' }) => {
  db = strictTransactions(makeDb()); atStripe = []; keys.clear(); creates = 0; mode = 'ok';
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com' });
  if (appt) await db.doc(`${T}/appointments/a1`).set(appt);
  await db.doc(`${T}/depositCredits/d1`).set({ id: 'd1', kind: 'deposit', status: 'available', clientId: 'c1', clientEmail: 'maya@example.com', clientName: 'Maya Lopez', amountCents: 2500, amount: 25,
    sourceAppointmentId: 'a1', stripePaymentIntentId: 'pi_dep', serviceName: 'Gel manicure', createdAt: new Date().toISOString(), ...credit });
};

(async () => {
  const { POST: studio } = await import('../../src/app/api/stripe/studio-cancel-refund/route');
  const { POST: managerRefund } = await import('../../src/app/api/stripe/deposit-refund/route');
  const { POST: undo } = await import('../../src/app/api/appointments/undo-booking/route');
  const refund = (x: any = {}) => studio(req({ tenantId: 't1', clientId: 'c1', appointmentId: 'a1', disposition: 'refund', staffId: 'm1', reason: 'We cancelled', ...x })) as any;

  console.log('a cancellation we made');
  await fresh();
  let r: any = await refund();
  check('the deposit goes back to the card, is closed, and the refund is in the books', r.status === 200 && r.body.ok && atStripe.length === 1 && atStripe[0].amount === 2500 && (await get(`${T}/depositCredits/d1`)).status === 'refunded' && (await refundLines()).length === 1, r.body);
  check('…the booking says so', (await get(`${T}/appointments/a1`)).depositRefunded === true && (await get(`${T}/appointments/a1`)).depositDisposition === 'refunded');
  r = await refund();
  check('asked again: nothing more (one refund, one record)', atStripe.length === 1 && (await refundLines()).length === 1);

  await fresh();
  const both: any[] = await Promise.all([refund(), refund(), managerRefund(req({ tenantId: 't1', creditId: 'd1' }))]);
  check('three taps at once (two screens): one refund, one record', atStripe.length === 1 && (await refundLines()).length === 1 && both.filter((x) => x.body?.ok).length >= 1, both.map((x) => x.body));

  console.log('a sale using it at the same moment');
  let clean = true;
  for (let i = 0; i < 8; i++) {
    await fresh();
    const use = db.runTransaction(async (tx: any) => { const ref = db.doc(`${T}/depositCredits/d1`); const c = (await tx.get(ref)).data() || {};
      if (c.status !== 'available') return false; tx.set(ref, { status: 'consumed', consumedAt: new Date().toISOString() }, { merge: true }); return true; });
    const [rr, used] = await Promise.all([refund(), use]);
    const refunded = !!rr.body?.ok;
    if (refunded === used || atStripe.length !== (refunded ? 1 : 0)) { clean = false; console.log('   ', { refunded, used, atStripe: atStripe.length }); }
  }
  check('either refunded or used on the sale, never both', clean);

  console.log('a walk-in’s deposit');
  await fresh({ sourceAppointmentId: 'walkin_77' }, null);
  r = await refund({ appointmentId: 'walkin_77' });
  check('refunded and recorded, though there’s no booking behind the id', r.body.ok && atStripe.length === 1 && (await get(`${T}/depositCredits/d1`)).status === 'refunded' && (await refundLines()).length === 1, r.body);
  check('…and no booking is made up for it', (await get(`${T}/appointments/walkin_77`)) === null);
  await fresh({ sourceAppointmentId: 'walkin_78' }, null);
  r = await studio(req({ tenantId: 't1', clientId: 'c1', appointmentId: 'walkin_78', disposition: 'store_credit', staffId: 'm1' }));
  check('…given as store credit instead: the same', r.body.ok && (await get(`${T}/depositCredits/d1`)).status === 'consumed' && (await get(`${T}/appointments/walkin_78`)) === null, r.body);

  console.log('no answer from Stripe');
  await fresh(); mode = 'lost_after';
  r = await refund();
  check('the refund went through but the answer was lost: it says to try again, and the deposit is set aside', r.status === 502 && (await get(`${T}/depositCredits/d1`)).status === 'refunding' && atStripe.length === 1, r.body);
  r = await studio(req({ tenantId: 't1', clientId: 'c1', appointmentId: 'a1', disposition: 'store_credit', staffId: 'm1' }));
  check('…it can’t be given as store credit meanwhile', r.status === 409 && !(await get(`${T}/clients/c1`)).totalStoreCredit, r.body);
  r = await refund();
  check('…asked again: recorded, not sent again', r.body.ok && atStripe.length === 1 && creates === 1 && (await get(`${T}/depositCredits/d1`)).status === 'refunded' && (await refundLines()).length === 1, { body: r.body, creates });
  await fresh(); mode = 'lost_before';
  r = await refund();
  check('the request never reached Stripe: asked again, it’s sent under the same key, once', r.status === 502 && (r = await refund()).body.ok && atStripe.length === 1 && (await refundLines()).length === 1, r.body);

  console.log('a refund Stripe already has for it');
  await fresh();
  atStripe.push({ id: 're_old', status: 'succeeded', amount: 2500, payment_intent: 'pi_dep', metadata: { tenantId: 't1', clientId: 'c1', appointmentId: 'a1', disposition: 'refund' } });
  r = await refund();
  check('one sent for this booking before (whose record was never written): recorded, not sent again', r.body.ok && creates === 0 && (await get(`${T}/depositCredits/d1`)).stripeRefundId === 're_old' && (await refundLines()).length === 1, r.body);
  await fresh();
  await db.doc(`${T}/depositCredits/d0`).set({ id: 'd0', kind: 'deposit', status: 'refunded', stripeRefundId: 're_old', clientId: 'c1', sourceAppointmentId: 'a1', amountCents: 2500, stripePaymentIntentId: 'pi_dep' });
  atStripe.push({ id: 're_old', status: 'succeeded', amount: 2500, payment_intent: 'pi_dep', metadata: { appointmentId: 'a1', disposition: 'refund' } });
  r = await refund();
  check('…but one that closed another deposit isn’t taken for this one', r.body.ok && creates === 1 && (await get(`${T}/depositCredits/d1`)).stripeRefundId !== 're_old', r.body);

  console.log('Stripe says no');
  await fresh(); mode = 'refuse';
  r = await refund();
  check('the deposit is back to use, and nothing is recorded', r.status === 502 && (await get(`${T}/depositCredits/d1`)).status === 'available' && (await refundLines()).length === 0, r.body);

  console.log('undoing a booking made by mistake');
  const booked = { status: 'confirmed', source: 'planner', createdAt: new Date().toISOString(), startTime: new Date(Date.now() + 3 * 864e5).toISOString(), clientId: 'c1', clientName: 'Maya Lopez',
    depositStatus: 'paid', depositAmountCents: 2500, depositPaidVia: 'card_on_file', depositStripePaymentIntentId: 'pi_dep' };
  await fresh({}, booked);
  const two: any[] = await Promise.all([undo(req({ tenantId: 't1', appointmentId: 'a1' })), undo(req({ tenantId: 't1', appointmentId: 'a1' }))]);
  check('two taps at once: one refund, one record, the deposit closed', atStripe.length === 1 && (await refundLines()).length === 1 && (await get(`${T}/depositCredits/d1`)).status === 'refunded' && (await get(`${T}/appointments/a1`)).status === 'cancelled', two.map((x) => x.body));
  r = await undo(req({ tenantId: 't1', appointmentId: 'a1' }));
  check('…asked again later: done already, nothing more', r.body.ok && r.body.already && atStripe.length === 1 && (await refundLines()).length === 1, r.body);
  await fresh({ usedCents: 1000 }, booked);
  r = await undo(req({ tenantId: 't1', appointmentId: 'a1' }));
  check('a deposit already used on a sale isn’t refunded from here', r.status === 409 && atStripe.length === 0 && (await get(`${T}/appointments/a1`)).status === 'confirmed', r.body);
  await fresh({}, booked); mode = 'lost_after';
  r = await undo(req({ tenantId: 't1', appointmentId: 'a1' }));
  check('no answer from Stripe: the booking stays, its deposit set aside', r.status === 502 && (await get(`${T}/appointments/a1`)).status === 'confirmed' && (await get(`${T}/depositCredits/d1`)).status === 'refunding', r.body);
  await db.doc(`${T}/appointments/a1`).set({ undoClaim: new Date(Date.now() - 5 * 60000).toISOString() }, { merge: true });
  r = await undo(req({ tenantId: 't1', appointmentId: 'a1' }));
  check('…undone again: the same refund, recorded once', r.body.ok && atStripe.length === 1 && (await refundLines()).length === 1 && (await get(`${T}/appointments/a1`)).status === 'cancelled', r.body);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('deposit-refunds ok');
})();
