// Checks money moves once, and is recorded once, on: the nightly booth no-show fee (lib/no-show), booking and charging a
// station (api/stripe/book-station), a company's gift card order (lib/gift-bulk), rent paid online and a renter's
// campaign texts (api/portal/renter), and academy tuition (lib/academy-admissions):
//   - two at once (two runs, two taps, two tabs, the return page with Stripe's notice) → charged once, recorded once;
//   - asked again after Stripe's answer was lost → the same charge (one at Stripe), recorded once;
//   - Stripe says no → nothing recorded, and the claim let go;
//   - a second payment that arrives anyway → refunded automatically and written down, never dropped.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/booth-gift-rent-academy.verify.ts
import Module from 'module';
import { createHash } from 'crypto';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_BILLING_WEBHOOK_SECRET = 'whsec_platform_x';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_x';
let db: any = strictTransactions(makeDb());
let signedIn = true;
let enrolls = 0;

// Stripe: one result per key (a refusal too, as Stripe keeps it), an answer that can go missing (before or after the
// charge was made), a card that can say no, a refund that can be refused, and Checkout pages that can be paid.
type Mode = 'ok' | 'lost_after' | 'lost_before' | 'decline';
let piMode: Mode = 'ok'; let rfMode: Mode | 'refuse' = 'ok';
let pis: any[] = []; let refunds: any[] = []; let sessions: any[] = []; let customers: any[] = [];
const keys = new Map<string, any>(); const calls: any[] = [];
let piCreates = 0; let rfCreates = 0;
const lost = () => Object.assign(new Error('connection reset'), { type: 'StripeConnectionError' });
const declined = () => Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined', decline_code: 'generic_decline' });
function StripeMock(this: any) {
  return {
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    subscriptions: { retrieve: async (id: string) => ({ id, status: 'active', customer: 'cus_x', metadata: {} }) },
    paymentIntents: {
      create: async (p: any, o: any = {}) => {
        piCreates++; calls.push({ op: 'pi', key: o.idempotencyKey, acct: o.stripeAccount || null, amount: p.amount });
        if (piMode === 'lost_before') { piMode = 'ok'; throw lost(); }
        const k = `pi:${o.stripeAccount || ''}:${o.idempotencyKey || Math.random()}`;
        let hit = keys.get(k);
        if (!hit) {
          if (piMode === 'decline') hit = { error: declined() };
          else {
            const pi = { id: `pi_${pis.length + 1}`, status: 'succeeded', amount: p.amount, customer: p.customer, payment_method: p.payment_method, metadata: p.metadata || {},
              created: Math.floor(Date.now() / 1000), latest_charge: { id: `ch_${pis.length + 1}`, balance_transaction: { fee: 59 } } };
            pis.push(pi); hit = { pi };
          }
          keys.set(k, hit);
        }
        if (piMode === 'lost_after') { piMode = 'ok'; throw lost(); }
        if (hit.error) throw hit.error;
        return hit.pi;
      },
      retrieve: async (id: string) => pis.find((x) => x.id === id) || { id, latest_charge: { id: 'ch_x', balance_transaction: { fee: 120 } } },
      list: async (q: any) => ({ data: pis.filter((x) => !q?.customer || x.customer === q.customer) }),
    },
    refunds: {
      create: async (p: any, o: any = {}) => {
        rfCreates++; calls.push({ op: 'rf', key: o.idempotencyKey, acct: o.stripeAccount || null, amount: p.amount, metadata: p.metadata || {} });
        if (rfMode === 'refuse') throw Object.assign(new Error('This charge can’t be refunded.'), { type: 'StripeInvalidRequestError' });
        if (rfMode === 'lost_before') { rfMode = 'ok'; throw lost(); }
        const k = `rf:${o.stripeAccount || ''}:${o.idempotencyKey}`;
        let r = keys.get(k);
        if (!r) { r = { id: `re_${refunds.length + 1}`, status: 'succeeded', amount: p.amount, payment_intent: p.payment_intent, metadata: p.metadata || {} }; refunds.push(r); keys.set(k, r); }
        if (rfMode === 'lost_after') { rfMode = 'ok'; throw lost(); }
        return r;
      },
      list: async (q: any) => ({ data: refunds.filter((r) => r.payment_intent === q.payment_intent) }),
    },
    checkout: {
      sessions: {
        create: async (p: any, o: any = {}) => {
          const k = `cs:${o.stripeAccount || ''}:${o.idempotencyKey || Math.random()}`;
          let s = keys.get(k);
          if (!s) {
            s = { id: `cs_${sessions.length + 1}`, url: `https://pay.test/cs_${sessions.length + 1}`, status: 'open', payment_status: 'unpaid', amount_total: p.line_items?.[0]?.price_data?.unit_amount,
              metadata: p.metadata || {}, customer: p.customer || null, payment_intent: null, acct: o.stripeAccount || null };
            sessions.push(s); keys.set(k, s);
          }
          return s;
        },
        retrieve: async (id: string) => { const s = sessions.find((x) => x.id === id); if (!s) throw Object.assign(new Error('No such session'), { type: 'StripeInvalidRequestError' }); return JSON.parse(JSON.stringify(s)); },
        expire: async (id: string) => { const s = sessions.find((x) => x.id === id); if (s && s.status === 'open') s.status = 'expired'; return s; },
      },
    },
    customers: { create: async (p: any, o: any = {}) => { const k = `cus:${o.idempotencyKey || Math.random()}`; let c = keys.get(k); if (!c) { c = { id: `cus_new${customers.length + 1}`, email: p.email }; customers.push(c); keys.set(k, c); } return c; } },
    setupIntents: { retrieve: async () => ({ id: 'seti_1', payment_method: 'pm_new' }) },
    paymentMethods: { retrieve: async () => ({ card: { brand: 'visa', last4: '4242' } }) },
  };
}
// A Checkout page paid: Stripe marks it paid and makes its payment.
const payPage = (sid: string) => {
  const s = sessions.find((y) => y.id === sid)!;
  const pi = { id: `pi_${sid}`, status: 'succeeded', amount: s.amount_total, customer: s.customer, payment_method: 'pm_paid', metadata: s.metadata, created: Math.floor(Date.now() / 1000), latest_charge: { id: `ch_${sid}`, balance_transaction: { fee: 88 } } };
  pis.push(pi); Object.assign(s, { status: 'complete', payment_status: 'paid', payment_intent: pi.id }); return s;
};
// A page paid by bank debit: finished, but the money takes days (its payment is 'processing') — then it arrives, or fails.
const clearingPage = (sid: string) => {
  const s = sessions.find((y) => y.id === sid)!;
  const pi = { id: `pi_${sid}`, status: 'processing', amount: s.amount_total, customer: s.customer, payment_method: 'pm_bank', metadata: s.metadata, created: Math.floor(Date.now() / 1000), latest_charge: { id: `ch_${sid}`, balance_transaction: { fee: 80 } } };
  pis.push(pi); Object.assign(s, { status: 'complete', payment_status: 'unpaid', payment_intent: pi.id }); return s;
};
const bankArrives = (sid: string) => { const s = sessions.find((y) => y.id === sid)!; pis.find((x) => x.id === s.payment_intent)!.status = 'succeeded'; s.payment_status = 'paid'; return s; };
const bankFails = (sid: string) => { const s = sessions.find((y) => y.id === sid)!; pis.find((x) => x.id === s.payment_intent)!.status = 'requires_payment_method'; return s; };
// Stripe's notices: the platform's own account (no account on the event) or a business's.
const notice = (type: string, session: any, account?: string) => ({
  text: async () => JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type, ...(account ? { account } : {}), data: { object: JSON.parse(JSON.stringify(session)) } }),
  headers: { get: (k: string) => (String(k).toLowerCase() === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio.test' } }) as any;
// A page made some other way (an older version of the screen, another tab long ago).
const otherPage = (cents: number, metadata: any, acct: string | null) => { const s = { id: `cs_${sessions.length + 1}`, url: `https://pay.test/cs_${sessions.length + 1}`, status: 'open', payment_status: 'unpaid', amount_total: cents, metadata, customer: 'cus_1', payment_intent: null, acct }; sessions.push(s); return s; };

const M: any = Module as any;
const load = M._load;
// A stand-in module, also for dynamic imports (marked as an ES module, with its default, and put in the cache).
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const members = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}` }));
const is = (request: string, name: string) => request === `@/lib/${name}` || new RegExp(`/src/lib/${name}(\\.ts)?$`).test(request);
const stripeMod = Object.assign(StripeMock, { default: StripeMock, __esModule: true });
M._load = function (request: string, ...rest: any[]) {
  // Never the real Stripe library, however it's asked for (a dynamic import arrives by its file's path).
  if (request === 'stripe' || /node_modules\/stripe\//.test(request)) { const c = M._cache?.[request]; if (c) { c.exports = stripeMod; c.loaded = true; } return stripeMod; }
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (is(request, 'firebase-admin')) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (is(request, 'staff-auth')) return fake(request, { verifyStaffActor: async () => (signedIn ? { ok: true, actor: { uid: 'm1', name: 'Ana Ruiz', role: 'manager' } } : { ok: false }) });
  if (request === './audit' || is(request, 'audit')) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (is(request, 'notify')) return fake(request, { sendNotification: async () => ({ status: 'sent' }), resolveFromAddress: () => 'hello@example.com' });
  if (is(request, 'sms')) return fake(request, { smsConfigured: () => true, sendTenantSms: async () => ({ ok: true }) });
  if (is(request, 'maintenance-server')) return fake(request, { uploadTicketPhotoFromDataUrl: async () => ({ url: null }), uploadPortalImageFromDataUrl: async () => ({ url: null }), autoAssignTicket: async () => null });
  if (is(request, 'campaign-engine')) return fake(request, {
    previewCampaign: async () => ({ aud: { members }, segments: 1, summary: { willReceive: members.length }, sampleText: 'Hi', channel: 'sms' }),
    peopleOf: () => ({ recipients: [] }),
    sendCampaignBatch: async () => ({ ok: true, done: true, totals: { sent: members.length }, batch: { sent: members.length } }),
  });
  if (is(request, 'academy-compliance')) return fake(request, { appendAudit: async () => undefined });
  if (is(request, 'academy-school')) return fake(request, { enrollInProgram: async () => { enrolls++; return { studentId: 'st1', staffId: 's1' }; } });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const fresh = async () => {
  db = strictTransactions(makeDb()); pis = []; refunds = []; sessions = []; customers = []; keys.clear(); calls.length = 0;
  piCreates = 0; rfCreates = 0; piMode = 'ok'; rfMode = 'ok'; signedIn = true; enrolls = 0;
};
const linesOf = async (cat: string) => (await all(`${T}/transactions`)).filter((x: any) => x.category === cat);

(async () => {
  // ── 10. The nightly booth no-show fee ────────────────────────────────────
  {
    const NS = await import('../../src/lib/no-show');
    const R = `${T}/boothReservations/r1`;
    const seed = async (x: any = {}, policy: any = { enabled: true, feeCents: 2500 }) => {
      await fresh();
      await db.doc(T).set({ name: 'Opal', noShowPolicy: policy });
      await db.doc(`${T}/clients/c1`).set({ name: 'Lena Cho', outstandingBalance: 0, unpaidFees: [] });
      await db.doc(R).set({ status: 'confirmed', name: 'Lena Cho', boothName: 'Chair 2', startDate: '2026-10-20', endDate: '2026-10-20', stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', clientId: 'c1', ...x });
    };
    const night = new Date('2026-10-23T07:00:00Z');
    const sweep = () => NS.sweepNoShows(db, 't1', night);
    const notes = async () => (await all(`${T}/notifications`)).length;

    console.log('booth no-shows');
    await seed();
    const two = await Promise.all([sweep(), sweep()]);
    let r = await get(R);
    check('two runs at once: the fee is charged once, one line in the books, one note to the owner', pis.length === 1 && (await linesOf('No-show Fee')).length === 1 && r.status === 'no_show' && r.noShowFeeStatus === 'charged' && (await notes()) === 1 && two[0].feesCharged + two[1].feesCharged === 1, { two, r, pis: pis.length });
    check('…under one key for the booking, amount and card; the line named after the booking', calls.filter((c) => c.op === 'pi').every((c) => c.key === 'noshow_r1_2500_pm_1') && !!(await get(`${T}/transactions/noshow_r1`)), calls);
    const later = await sweep();
    check('…run again later: nothing more', pis.length === 1 && later.swept === 0 && (await linesOf('No-show Fee')).length === 1);

    await seed(); piMode = 'lost_after';
    let c = await sweep(); r = await get(R);
    check('the answer lost: nothing recorded, the booking stays as it was (claimed), and the fee isn’t parked as owed', c.feesPending === 1 && c.swept === 0 && r.status === 'confirmed' && !!r.noShowClaimAt && !r.noShowFeeStatus && (await linesOf('No-show Fee')).length === 0 && (await get(`${T}/clients/c1`)).unpaidFees.length === 0, { c, r });
    c = await sweep();
    check('…a second run at the same moment leaves it alone', c.swept === 0 && piCreates === 1, { c, piCreates });
    await db.doc(R).set({ noShowClaimAt: ago(5) }, { merge: true });
    c = await sweep(); r = await get(R);
    check('…the next run: the charge Stripe has is recorded (not sent again), once', pis.length === 1 && piCreates === 1 && (await linesOf('No-show Fee')).length === 1 && r.noShowFeeStatus === 'charged' && r.status === 'no_show' && !r.noShowClaimAt && c.feesCharged === 1, { c, r, piCreates });
    await seed(); piMode = 'lost_before';
    await sweep(); await db.doc(R).set({ noShowClaimAt: ago(5) }, { merge: true }); await sweep();
    check('the request never reached Stripe: the next run sends it under the same key, once', pis.length === 1 && (await linesOf('No-show Fee')).length === 1 && calls.filter((x) => x.op === 'pi').length === 2 && calls.filter((x) => x.op === 'pi').every((x) => x.key === 'noshow_r1_2500_pm_1'), calls);

    await seed(); piMode = 'decline';
    await Promise.all([sweep(), sweep()]);
    r = await get(R); let cl = await get(`${T}/clients/c1`);
    check('the card says no: owed once on their account, the booking flagged, nothing in the books, the claim let go', cl.outstandingBalance === 25 && cl.unpaidFees.length === 1 && r.noShowFeeStatus === 'declined' && r.status === 'no_show' && !r.noShowClaimAt && (await linesOf('No-show Fee')).length === 0 && (await notes()) === 1, { cl, r });
    await sweep();
    check('…run again: still owed once', (await get(`${T}/clients/c1`)).unpaidFees.length === 1 && (await get(`${T}/clients/c1`)).outstandingBalance === 25);

    await seed({ stripePaymentMethodId: null });
    await Promise.all([sweep(), sweep()]);
    r = await get(R); cl = await get(`${T}/clients/c1`);
    check('no card on file, two runs at once: owed once, flagged once, nothing charged', cl.outstandingBalance === 25 && cl.unpaidFees.length === 1 && r.noShowFeeStatus === 'no_card' && piCreates === 0 && (await notes()) === 1, { cl, r });
    await seed({}, { enabled: false });
    const off = await Promise.all([sweep(), sweep()]);
    check('fee policy off: flagged once, nothing charged, one note', (await get(R)).status === 'no_show' && piCreates === 0 && (await notes()) === 1 && off[0].swept + off[1].swept === 1, off);
  }

  // ── 11. Booking and charging a station ────────────────────────────────────
  {
    const { POST } = await import('../../src/app/api/stripe/book-station/route');
    const seed = async () => {
      await fresh();
      await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1' });
      await db.doc(`${T}/booths/b1`).set({ name: 'Chair 2', dayUseEnabled: true, dayUseHourlyCents: 2000, dayUseDailyCents: 12000 });
      await db.doc(`${T}/renters/rn1`).set({ firstName: 'Lena', lastName: 'Cho', stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_1' });
      await db.doc(`${T}/renters/rn2`).set({ firstName: 'Ana', lastName: 'Ruiz', stripeCustomerId: 'cus_2', defaultPaymentMethodId: 'pm_2' });
    };
    const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) } }) as any;
    const book = (x: any = {}) => POST(req({ tenantId: 't1', locationId: 'loc1', boothId: 'b1', renterId: 'rn1', startAt: '2026-10-24T09:00:00', endAt: '2026-10-24T11:00:00', rateType: 'hourly', mode: 'pos', attemptKey: 'try1', ...x })) as any;
    const confirmed = async () => (await all(`${T}/bookings`)).filter((b: any) => b.status === 'confirmed');
    const ledgerRows = async () => (await all(`${T}/rentLedger`)).length;

    console.log('booking a station');
    await seed(); signedIn = false;
    let r: any = await book();
    check('not signed in: refused, nothing charged', r.status === 401 && piCreates === 0, r.body);

    await seed();
    const tap: any[] = await Promise.all([book(), book()]);
    check('a double tap: one booking, one charge, one line in the books and one in the rent roll', (await confirmed()).length === 1 && pis.length === 1 && (await linesOf('Day-Use Booking Revenue')).length === 1 && (await ledgerRows()) === 1 && tap.some((x) => x.body.ok), tap.map((x) => x.body));
    check('…the booking named before the charge, and the key named after the booking, amount and card', !!(await get(`${T}/bookings/sb_try1`)) && calls.filter((c) => c.op === 'pi').every((c) => c.key === 'station_booking_sb_try1_4000_pm_1'), calls);
    r = await book();
    check('…asked again later: done already, nothing more', r.body.ok && r.body.already && pis.length === 1);

    await seed();
    const staff: any[] = await Promise.all([book({ attemptKey: 'deskA' }), book({ attemptKey: 'deskB', renterId: 'rn2' })]);
    check('two people booking the same time at once: one gets it, the other is told it’s taken; one charge', (await confirmed()).length === 1 && pis.length === 1 && staff.filter((x) => x.body.ok).length === 1 && staff.filter((x) => x.body.code === 'slot_conflict').length === 1, staff.map((x) => x.body));
    r = await book({ attemptKey: 'deskC', renterId: 'rn2', startAt: '2026-10-24T10:00:00', endAt: '2026-10-24T12:00:00' });
    check('…an overlapping time afterwards: taken', r.body.code === 'slot_conflict' && pis.length === 1, r.body);

    await seed(); piMode = 'lost_after';
    r = await book();
    const held = await get(`${T}/bookings/sb_try1`);
    check('the answer lost: it says to try again, and the booking holds its time', r.status === 502 && held.status === 'held' && !!held.chargeClaimAt && (await linesOf('Day-Use Booking Revenue')).length === 0, r.body);
    r = await book({ attemptKey: 'deskB', renterId: 'rn2' });
    check('…someone else can’t take that time meanwhile (the charge may have gone through)', r.body.code === 'slot_conflict', r.body);
    r = await book();
    check('…the same attempt asked again at once: told it’s under way', r.status === 409 && r.body.code === 'in_progress' && piCreates === 1, r.body);
    await db.doc(`${T}/bookings/sb_try1`).set({ chargeClaimAt: ago(5) }, { merge: true });
    r = await book();
    check('…asked again later: the payment Stripe has is the one (one charge), recorded once', r.body.ok && pis.length === 1 && piCreates === 1 && (await confirmed()).length === 1 && (await linesOf('Day-Use Booking Revenue')).length === 1, { body: r.body, piCreates });

    await seed(); piMode = 'decline';
    r = await book();
    check('the card says no: nothing recorded, the booking ends', r.status === 402 && (await get(`${T}/bookings/sb_try1`)).status === 'cancelled' && (await linesOf('Day-Use Booking Revenue')).length === 0 && (await ledgerRows()) === 0, r.body);
    piMode = 'ok';
    r = await book({ attemptKey: 'try2' });
    check('…and its time is free again: a new attempt books it', r.body.ok && (await confirmed()).length === 1, r.body);
    await db.doc(`${T}/bookings/sb_try2`).set({ status: 'cancelled' }, { merge: true });
    r = await book({ attemptKey: 'try3', renterId: 'rn2' });
    check('a booking cancelled some other way doesn’t keep the time', r.body.ok, r.body);
  }

  // ── 13a. A company's gift card order ──────────────────────────────────────
  {
    const B = await import('../../src/lib/gift-bulk');
    const G = `${T}/giftBulk/g1`;
    const seed = async (x: any = {}) => {
      await fresh();
      await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York', userId: 'owner1' });
      await db.doc(G).set({ id: 'g1', status: 'invoiced', company: 'Acme', contactEmail: 'dana@acme.co', count: 2, totalCents: 200000, design: 'frost',
        rows: [{ name: 'Ana Ruiz', email: 'ana@acme.co', cents: 100000 }, { name: 'Ben Ortiz', email: 'ben@acme.co', cents: 100000 }], ...x });
    };
    const cards = async () => (await all(`${T}/giftCards`)).length;
    const paidOnline = (sid: string) => B.markBulkPaid(db, 't1', 'g1', { via: 'card', sessionId: sid, amountCents: 200000, by: 'Online' });

    console.log('a company’s gift card order');
    await seed();
    const taps: any[] = await Promise.all([B.payBulk(db, 't1', 'g1', 'https://studio.test'), B.payBulk(db, 't1', 'g1', 'https://studio.test')]);
    check('two taps (two tabs) at once: one payment page for both', sessions.length === 1 && taps.every((x) => x.ok && x.url === sessions[0].url), taps);
    let p: any = await B.payBulk(db, 't1', 'g1', 'https://studio.test');
    check('…tapped again later: the same page', p.ok && p.url === sessions[0].url && sessions.length === 1, p);
    sessions[0].status = 'expired';
    p = await B.payBulk(db, 't1', 'g1', 'https://studio.test');
    check('…once it has expired: a new page', p.ok && sessions.length === 2 && p.url === sessions[1].url, p);
    await db.doc(G).set({ totalCents: 150000, rows: [{ name: 'Ana Ruiz', email: 'ana@acme.co', cents: 75000 }, { name: 'Ben Ortiz', email: 'ben@acme.co', cents: 75000 }] }, { merge: true });
    p = await B.payBulk(db, 't1', 'g1', 'https://studio.test');
    check('…the total changed: the old page is closed and a new one opened for the new total', p.ok && sessions[1].status === 'expired' && sessions.length === 3 && sessions[2].amount_total === 150000, p);
    await db.doc(G).set({ payPage: { sessionId: 'cs_missing', cents: 150000 } }, { merge: true });
    p = await B.payBulk(db, 't1', 'g1', 'https://studio.test');
    check('…a page Stripe doesn’t know any more: a new one', p.ok && sessions.length === 4 && p.url === sessions[3].url, p);

    await seed();
    await B.payBulk(db, 't1', 'g1', 'https://studio.test'); payPage('cs_1');
    const both: any[] = await Promise.all([paidOnline('cs_1'), B.confirmBulk(db, 't1', 'g1', 'cs_1')]);
    check('Stripe’s notice and the return page at once: the cards made once, the money recorded once', (await cards()) === 2 && (await linesOf('Gift Card Sales')).length === 1 && ['paid', 'issued'].includes((await get(G)).status), both);
    const second = otherPage(200000, { tenantId: 't1', type: 'gift_bulk', giftBulkId: 'g1' }, 'acct_1'); payPage(second.id);
    const dup: any[] = await Promise.all([B.confirmBulk(db, 't1', 'g1', second.id), paidOnline(second.id)]);
    let o = await get(G);
    check('a second page paid too: refunded automatically, once, and written on the order — no second line, no more cards', refunds.length === 1 && refunds[0].amount === 200000 && refunds[0].payment_intent === `pi_${second.id}` && o.extraPayments?.[second.id]?.state === 'refunded' && (await linesOf('Gift Card Sales')).length === 1 && (await cards()) === 2, { dup, o: o.extraPayments, refunds });
    const rf = calls.find((c) => c.op === 'rf');
    check('…on the business’s account, marked as the app’s, keyed on that payment', rf?.acct === 'acct_1' && rf?.metadata?.origin === 'app' && rf?.key === `gift-bulk-twice-pi_${second.id}-200000`, rf);
    check('…the return page says so, and the managers are told', dup.some((x: any) => x?.twice && x?.refunded) && (await all(`${T}/notifications`)).some((n: any) => /refunded to their card/.test(n.message)), dup);
    await paidOnline(second.id);
    check('…the same notice again: nothing more', refunds.length === 1 && rfCreates === 1);

    await seed();
    await B.markBulkPaid(db, 't1', 'g1', { via: 'check', by: 'Jess' });
    const late = otherPage(200000, { tenantId: 't1', type: 'gift_bulk', giftBulkId: 'g1' }, 'acct_1'); payPage(late.id);
    await paidOnline(late.id);
    o = await get(G);
    check('marked paid by check, then paid by card: the card payment goes back', refunds.length === 1 && o.extraPayments?.[late.id]?.state === 'refunded' && (await linesOf('Gift Card Sales')).length === 1 && (await linesOf('Gift Card Sales'))[0].paymentMethod === 'Check', o.extraPayments);

    await seed({ status: 'cancelled' });
    const gone = otherPage(200000, { tenantId: 't1', type: 'gift_bulk', giftBulkId: 'g1' }, 'acct_1'); payPage(gone.id);
    await paidOnline(gone.id);
    check('paid after it was cancelled: refunded, no cards made', refunds.length === 1 && (await get(G)).extraPayments?.[gone.id]?.state === 'refunded' && (await cards()) === 0 && (await linesOf('Gift Card Sales')).length === 0);

    await seed();
    await B.markBulkPaid(db, 't1', 'g1', { via: 'check', by: 'Jess' });
    const kept = otherPage(200000, { tenantId: 't1', type: 'gift_bulk', giftBulkId: 'g1' }, 'acct_1'); payPage(kept.id);
    rfMode = 'refuse';
    const k: any = await paidOnline(kept.id);
    o = await get(G);
    check('the refund refused: kept on the order for a manager, with a note saying so', k.twice && !k.refunded && o.extraPayments?.[kept.id]?.state === 'refund_failed' && (await all(`${T}/notifications`)).some((n: any) => /refund it in Stripe/.test(n.message)), { k, o: o.extraPayments });
    rfMode = 'ok';
    await paidOnline(kept.id);
    check('…tried again when the notice comes again: refunded then, once', refunds.length === 1 && (await get(G)).extraPayments?.[kept.id]?.state === 'refunded');

    console.log('a company’s gift card order, through Stripe’s notice (the business’s account)');
    const { POST: connectHook } = await import('../../src/app/api/stripe/connect-webhook/route');
    const tell = (type: string, sid: string) => connectHook(notice(type, sessions.find((x) => x.id === sid), 'acct_1')) as any;
    await seed();
    await B.payBulk(db, 't1', 'g1', 'https://studio.test'); payPage('cs_1');
    const notices: any[] = await Promise.all([tell('checkout.session.completed', 'cs_1'), tell('checkout.session.completed', 'cs_1'), B.confirmBulk(db, 't1', 'g1', 'cs_1')]);
    check('paid, and the company never came back: Stripe’s notice makes the cards; twice and with the return page at once, once', (await cards()) === 2 && (await linesOf('Gift Card Sales')).length === 1 && (await get(G)).status === 'issued' && notices.every((x: any) => x.status === 200 || x.ok), notices.map((x: any) => x.body || x));
    await seed();
    await B.payBulk(db, 't1', 'g1', 'https://studio.test'); clearingPage('cs_1');
    await tell('checkout.session.completed', 'cs_1');
    check('paid by bank debit: nothing made or recorded while it clears', (await cards()) === 0 && (await linesOf('Gift Card Sales')).length === 0 && (await get(G)).status === 'invoiced');
    p = await B.payBulk(db, 't1', 'g1', 'https://studio.test');
    check('…tapping Pay meanwhile: told it’s going through (no second page)', !p.ok && /still going through/.test(p.error) && sessions.length === 1, p);
    bankArrives('cs_1');
    await Promise.all([tell('checkout.session.async_payment_succeeded', 'cs_1'), tell('checkout.session.async_payment_succeeded', 'cs_1')]);
    check('…the money arrives: the cards made, recorded once', (await cards()) === 2 && (await linesOf('Gift Card Sales')).length === 1);
    await seed();
    await B.payBulk(db, 't1', 'g1', 'https://studio.test'); clearingPage('cs_1'); bankFails('cs_1');
    p = await B.payBulk(db, 't1', 'g1', 'https://studio.test');
    check('the bank payment failed: tapping Pay opens a new page', p.ok && sessions.length === 2 && p.url === sessions[1].url, p);

    console.log('editing a company order while it’s being paid');
    let guarded = true; const seen = { saved: 0, refused: 0 };
    const pause = (ms: number) => new Promise((res) => setTimeout(res, ms));
    for (let i = 0; i < 10; i++) {
      await seed();
      const edit = async () => B.saveBulk(db, 't1', { id: 'g1', company: 'Acme', contactEmail: 'dana@acme.co', defaultAmount: 500,
        rows: [{ name: 'Ana Ruiz', email: 'ana@acme.co', cents: 50000 }, { name: 'Ben Ortiz', email: 'ben@acme.co', cents: 50000 }, { name: 'Cara Lee', email: 'cara@acme.co', cents: 50000 }] }, 'Jess');
      const pay = async () => B.markBulkPaid(db, 't1', 'g1', { via: 'check', by: 'Jess' });
      // Each goes first half the time, the other a moment later, while the first is still in its step.
      const [e, m] = (i % 2 ? await Promise.all([edit(), pause(1).then(pay)]) : await Promise.all([pause(1).then(edit), pay()])) as any[];
      const o2 = await get(G);
      const fine = m.ok && o2.status === 'issued' && o2.rows.every((r: any) => !!r.cardId) && (await cards()) === o2.rows.length && (e.ok ? o2.rows.length === 3 : o2.rows.length === 2 && /already paid/.test(e.error));
      if (e.ok) seen.saved++; else seen.refused++;
      if (!fine) { guarded = false; console.log('   ', { e, m, status: o2.status, rows: o2.rows.length, cards: await cards() }); }
    }
    check('an edit at the same moment as the payment is saved first or refused — it never undoes the payment or its cards', guarded && seen.saved > 0 && seen.refused > 0, seen);
    await seed();
    await B.payBulk(db, 't1', 'g1', 'https://studio.test');
    let e2: any = await B.saveBulk(db, 't1', { id: 'g1', company: 'Acme', contactEmail: 'dana@acme.co', defaultAmount: 500, rows: [{ name: 'Ana Ruiz', email: 'ana@acme.co', cents: 50000 }] }, 'Jess');
    check('a new total: the page made for the old one is closed', e2.ok && sessions[0].status === 'expired' && (await get(G)).status === 'invoiced', e2);
    await seed();
    await B.payBulk(db, 't1', 'g1', 'https://studio.test'); payPage('cs_1');
    await db.doc(G).set({ totalCents: 150000 }, { merge: true });
    await paidOnline('cs_1');
    check('paid for an amount the order no longer comes to: the cards are made, and the managers are told to settle it', (await cards()) === 2 && (await all(`${T}/notifications`)).some((n: any) => /settle the difference/.test(n.message)));
    await seed({ status: 'paid', paidVia: 'check', paidAt: '2026-10-20T00:00:00.000Z' });
    e2 = await B.saveBulk(db, 't1', { id: 'g1', company: 'Acme Two', rows: [] }, 'Jess');
    const o3 = await get(G);
    check('an edit after it’s paid: refused, and the order is as it was', !e2.ok && o3.status === 'paid' && o3.company === 'Acme' && o3.paidVia === 'check' && o3.rows.length === 2, { e2, o3 });
  }

  // ── 13b and 20. Rent paid online, and a renter’s campaign texts ─────────
  {
    const { POST } = await import('../../src/app/api/portal/renter/route');
    const TOKEN = 'tok_renter_1';
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    const I = `${T}/rentInvoices/i1`;
    const seed = async (inv: any = {}) => {
      await fresh();
      await db.doc(T).set({ name: 'Opal', renterCampaigns: { mode: 'renter_pays', priceCentsPerText: 2 } });
      await db.doc(`${T}/private/renterSessions`).set({ [sha(TOKEN)]: { contactKey: 'lena@example.com', name: 'Lena Cho', renterId: 'rn1', expiresAt: Date.now() + 3600e3 } });
      await db.doc(`${T}/renters/rn1`).set({ firstName: 'Lena', lastName: 'Cho', email: 'lena@example.com', phone: '', stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1' });
      await db.doc(`${T}/leases/l1`).set({ renterId: 'rn1', boothId: 'b1', status: 'active' });
      await db.doc(I).set({ leaseId: 'l1', status: 'due', amountCents: 80000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-10-01', ...inv });
    };
    const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://studio.test' } }) as any;
    const portal = (x: any) => POST(req({ tenantId: 't1', token: TOKEN, ...x })) as any;
    const payInv = () => portal({ action: 'pay-invoice', invoiceId: 'i1', returnUrl: 'https://studio.test/rent/t1?tab=rent' });
    const confirmInv = (sessionId: string) => portal({ action: 'confirm-invoice', invoiceId: 'i1', sessionId });
    const rentMeta = { tenantId: 't1', invoiceId: 'i1', kind: 'rent_invoice' };

    console.log('rent paid online');
    await seed();
    const taps: any[] = await Promise.all([payInv(), payInv()]);
    check('two taps at once: one payment page for both', sessions.length === 1 && taps.every((x) => x.body.ok && x.body.url === sessions[0].url), taps.map((x) => x.body));
    let r: any = await payInv();
    check('…tapped again later: the same page', r.body.url === sessions[0].url && sessions.length === 1, r.body);
    payPage('cs_1');
    const conf: any[] = await Promise.all([confirmInv('cs_1'), confirmInv('cs_1')]);
    let inv = await get(I);
    check('the return page confirmed twice at once: the rent recorded once (named after the page), the invoice paid', (await linesOf('Booth Rent')).length === 1 && !!(await get(`${T}/transactions/rentpay_cs_1`)) && inv.status === 'paid' && conf.every((x) => x.body.ok), conf.map((x) => x.body));
    const older = otherPage(80000, rentMeta, null); payPage(older.id);
    const dup: any[] = await Promise.all([confirmInv(older.id), confirmInv(older.id)]);
    inv = await get(I);
    check('a second page paid as well: refunded automatically once, written on the invoice, no second rent line', refunds.length === 1 && refunds[0].amount === 80000 && inv.extraPayments?.[older.id]?.state === 'refunded' && (await linesOf('Booth Rent')).length === 1, { dup: dup.map((x) => x.body), extra: inv.extraPayments });
    const rf = calls.find((c) => c.op === 'rf');
    check('…on the platform account, marked as the app’s, keyed on that payment; the renter is told', rf?.acct === null && rf?.metadata?.origin === 'app' && rf?.key === `rent-paid_twice-pi_${older.id}-80000` && dup.some((x) => /already paid, so your payment of \$800\.00 was refunded/.test(String(x.body.error))), { rf, dup: dup.map((x) => x.body) });
    r = await confirmInv(older.id);
    check('…asked again: nothing more', refunds.length === 1 && rfCreates === 1, r.body);

    await seed();
    await payInv(); payPage('cs_1');
    r = await payInv();
    check('paid on the page but never came back: tapping Pay records it instead of opening another', r.body.ok && r.body.alreadyPaid && sessions.length === 1 && (await linesOf('Booth Rent')).length === 1 && (await get(I)).status === 'paid', r.body);
    await seed({ stripeSessionId: 'cs_missing' });
    r = await payInv();
    check('a page Stripe doesn’t know any more: a new one opens', r.body.ok && sessions.length === 1 && r.body.url === sessions[0].url, r.body);
    await seed();
    await payInv(); await db.doc(I).set({ lateFeeCents: 2500 }, { merge: true });
    r = await payInv();
    check('what’s owed went up (a late fee): the old page closes and a new one opens for the new amount', r.body.ok && sessions[0].status === 'expired' && sessions.length === 2 && sessions[1].amount_total === 82500, r.body);

    await seed();
    await payInv();
    await db.doc(I).set({ status: 'paid', paidVia: 'desk', paidCents: 80000 }, { merge: true });
    payPage('cs_1');
    r = await confirmInv('cs_1');
    check('paid at the desk, then on the page as well: the card payment goes back, nothing more recorded', refunds.length === 1 && (await get(I)).extraPayments?.cs_1?.state === 'refunded' && (await linesOf('Booth Rent')).length === 0 && !r.body.ok, r.body);

    await seed();
    await payInv();
    await db.doc(I).set({ paidCents: 30000 }, { merge: true });
    payPage('cs_1');
    r = await confirmInv('cs_1');
    inv = await get(I);
    check('part paid at the desk while the page was open: what was owed is recorded, the extra refunded', (await linesOf('Booth Rent')).length === 1 && (await linesOf('Booth Rent'))[0].amount === 500 && refunds.length === 1 && refunds[0].amount === 30000 && inv.status === 'paid' && r.body.ok && r.body.refundedCents === 30000, { body: r.body, refunds });

    await seed();
    await payInv(); payPage('cs_1'); await confirmInv('cs_1');
    const refused = otherPage(80000, rentMeta, null); payPage(refused.id);
    rfMode = 'refuse';
    r = await confirmInv(refused.id);
    inv = await get(I);
    check('the refund refused: kept on the invoice, the studio asked to refund it', inv.extraPayments?.[refused.id]?.state === 'refund_failed' && (await all(`${T}/notifications`)).some((n: any) => /please refund it in Stripe/.test(n.message)) && !r.body.ok, { body: r.body, extra: inv.extraPayments });

    console.log('rent paid online, through Stripe’s notice (the platform’s account)');
    const { POST: billingHook } = await import('../../src/app/api/stripe/billing-webhook/route');
    const hear = (type: string, sid: string) => billingHook(notice(type, sessions.find((x) => x.id === sid))) as any;
    await seed();
    await payInv(); payPage('cs_1');
    r = await hear('checkout.session.completed', 'cs_1');
    check('paid, and the renter never came back: Stripe’s notice records it', r.status === 200 && (await linesOf('Booth Rent')).length === 1 && (await get(I)).status === 'paid', r.body);
    await seed();
    await payInv(); payPage('cs_1');
    const heard: any[] = await Promise.all([hear('checkout.session.completed', 'cs_1'), hear('checkout.session.completed', 'cs_1'), confirmInv('cs_1')]);
    check('…the notice twice and the return page at the same moment: recorded once', (await linesOf('Booth Rent')).length === 1 && (await linesOf('Processing Fee')).length === 1 && (await get(I)).status === 'paid' && heard.every((x) => x.status === 200), heard.map((x) => x.body));
    const later = otherPage(80000, rentMeta, null); payPage(later.id);
    await Promise.all([hear('checkout.session.completed', later.id), confirmInv(later.id)]);
    check('…a second page’s notice and its return at once: refunded once, no second line', refunds.length === 1 && (await get(I)).extraPayments?.[later.id]?.state === 'refunded' && (await linesOf('Booth Rent')).length === 1);
    await seed();
    await payInv(); clearingPage('cs_1');
    r = await hear('checkout.session.completed', 'cs_1');
    const wait: any = await confirmInv('cs_1');
    check('paid by bank debit: nothing recorded while it clears, and the return page says it’s on its way', r.status === 200 && (await linesOf('Booth Rent')).length === 0 && (await get(I)).status === 'due' && wait.status === 202 && wait.body.pending, wait.body);
    r = await payInv();
    check('…tapping Pay meanwhile: told it’s going through (no second page)', r.status === 409 && /still going through/.test(r.body.error) && sessions.length === 1, r.body);
    bankArrives('cs_1');
    await Promise.all([hear('checkout.session.async_payment_succeeded', 'cs_1'), hear('checkout.session.async_payment_succeeded', 'cs_1'), confirmInv('cs_1')]);
    check('…the money arrives: recorded once (the notice twice, and the return page, at once)', (await linesOf('Booth Rent')).length === 1 && (await get(I)).status === 'paid');
    await seed();
    await payInv(); clearingPage('cs_1'); bankFails('cs_1');
    r = await payInv();
    check('the bank payment failed: tapping Pay opens a new page', r.body.ok && sessions.length === 2 && r.body.url === sessions[1].url, r.body);
    await seed();
    await payInv(); payPage('cs_1');
    const other = { ...sessions[0], metadata: { kind: 'booth_booking' } };
    r = await billingHook(notice('checkout.session.completed', other));
    check('a platform page that isn’t rent: left alone', r.status === 200 && (await linesOf('Booth Rent')).length === 0);

    console.log('a renter’s campaign texts');
    const C = `${T}/campaigns/k1`;
    const seedRc = async () => { await seed(); await db.doc(C).set({ id: 'k1', ownerRenterId: 'rn1', name: 'Fall', type: 'sms', body: 'Hi {first}', status: 'draft', segmentsBudget: 0, segmentsUsed: 0, chargedCents: 0 }); };
    const send = (x: any = {}) => portal({ action: 'rc-send', campaignId: 'k1', confirmChargeCents: 100, attemptKey: 'tap1', ...x });
    await seedRc();
    const two: any[] = await Promise.all([send(), send()]);
    let k = await get(C);
    check('a double tap on Send: charged once, one line, the texts added to the budget once', pis.length === 1 && pis[0].amount === 100 && (await linesOf('Renter Text Messages')).length === 1 && k.segmentsBudget === 50 && k.chargedCents === 100, { two: two.map((x) => x.body), k });
    check('…under one key for the purchase, amount and card', calls.filter((c) => c.op === 'pi').every((c) => c.key === 'rc-texts-k1-tap1-1-100-pm_1'), calls);
    r = await send();
    check('…the same tap asked again: nothing more', pis.length === 1 && (await linesOf('Renter Text Messages')).length === 1 && (await get(C)).segmentsBudget === 50, r.body);

    await seedRc(); piMode = 'lost_after';
    r = await send();
    k = await get(C);
    check('the answer lost: it says to try again; nothing recorded, the budget untouched, the purchase still claimed', r.status === 502 && (await linesOf('Renter Text Messages')).length === 0 && k.segmentsBudget === 0 && k.textCharge?.status === 'charging', r.body);
    r = await send();
    check('…asked again at once: told it’s under way', r.status === 409 && r.body.code === 'in_progress' && piCreates === 1, r.body);
    await db.doc(C).set({ textCharge: { at: ago(5) } }, { merge: true });
    r = await send();
    k = await get(C);
    check('…asked again later: the same charge (one at Stripe), recorded once, the budget credited once', r.body.ok && pis.length === 1 && (await linesOf('Renter Text Messages')).length === 1 && k.segmentsBudget === 50 && k.chargedCents === 100, { body: r.body, k });

    await seedRc(); piMode = 'decline';
    r = await send();
    k = await get(C);
    check('the card says no: nothing recorded, nothing added, the claim let go', r.status === 402 && (await linesOf('Renter Text Messages')).length === 0 && k.segmentsBudget === 0 && !k.textCharge, { body: r.body, k });
    piMode = 'ok';
    r = await send({ attemptKey: 'tap2' });
    check('…a new tap later: charged then, under a new key', r.body.ok && pis.length === 1 && (await get(C)).segmentsBudget === 50, r.body);
  }

  // ── 14. Academy tuition ───────────────────────────────────────────────────
  {
    const A = await import('../../src/lib/academy-admissions');
    const P = `${T}/tuitionPlans/pr1_st1`;
    const seed = async (plan: any = {}, paidDown = false) => {
      await fresh();
      await db.doc(T).set({ name: 'Opal School', stripeAccountId: 'acct_1' });
      await db.doc(`${T}/admissions/ad1`).set({ name: 'Maya Lopez', email: 'maya@example.com', stage: 'agreement', history: [] });
      await db.doc(P).set({ id: 'pr1_st1', programId: 'pr1', studentId: 'st1', email: 'maya@example.com', name: 'Maya Lopez', admissionId: 'ad1', totalCents: 500000, downPaymentCents: 100000,
        installmentCents: 100000, installmentsTotal: 4, installmentsPaid: 0, interval: 'month', nextDueAt: null, status: 'awaiting_down_payment', autopay: false, failures: 0, ...plan });
      await db.doc(`${T}/tuitionEntries/ch1`).set({ id: 'ch1', planId: 'pr1_st1', studentId: 'st1', type: 'charge', amountCents: 500000, desc: 'Tuition', at: '2026-10-01T00:00:00.000Z' });
      if (paidDown) await db.doc(`${T}/tuitionEntries/pay_cs_down0`).set({ id: 'pay_cs_down0', planId: 'pr1_st1', studentId: 'st1', type: 'payment', amountCents: 100000, desc: 'Down payment', at: '2026-10-02T00:00:00.000Z' });
      pis.push({ id: 'pi_cs_down1', payment_method: 'pm_s1', status: 'succeeded', amount: 100000, metadata: {} });
    };
    const down = (id = 'cs_down1') => ({ id, payment_status: 'paid', amount_total: 100000, payment_intent: `pi_${id}`, customer: 'cus_s1', metadata: { type: 'academy_tuition', planId: 'pr1_st1', admissionId: 'ad1' } });
    const payments = async () => (await all(`${T}/tuitionEntries`)).filter((e: any) => e.type === 'payment');
    const active = { status: 'active', installmentsPaid: 1, customerId: 'cus_s1', paymentMethodId: 'pm_s1', autopay: true, nextDueAt: '2026-10-20T00:00:00.000Z', downPaidAt: '2026-10-02T00:00:00.000Z', downPaidSessionId: 'cs_down0' };

    console.log('academy tuition');
    await seed();
    const both = await Promise.all([A.completeDownPayment('t1', down()), A.completeDownPayment('t1', down())]);
    let pl = await get(P);
    check('the down payment’s return page and Stripe’s notice at once: one entry, one Tuition line, enrolled once', (await payments()).length === 1 && (await linesOf('Tuition')).length === 1 && enrolls === 1 && pl.status === 'active' && pl.downPaidSessionId === 'cs_down1' && pl.paymentMethodId === 'pm_s1' && both.every((x: any) => x?.planId), { both, enrolls, pl });
    check('…the entry is named after the Checkout page', !!(await get(`${T}/tuitionEntries/pay_cs_down1`)));
    await A.completeDownPayment('t1', down());
    check('…asked again later: nothing more', (await payments()).length === 1 && enrolls === 1);
    await A.completeDownPayment('t1', down('cs_down2'));
    check('a second down payment page paid: counted toward the balance once, not enrolled again', (await payments()).length === 2 && (await linesOf('Tuition')).length === 2 && enrolls === 1 && !!(await get(`${T}/tuitionEntries/pay_cs_down2`)));
    await A.completeDownPayment('t1', down('cs_down2'));
    check('…and that one asked again: nothing more', (await payments()).length === 2);
    await seed({ downPaidAt: '2026-10-02T00:00:00.000Z', status: 'active' });
    const legacy: any = await A.completeDownPayment('t1', down());
    check('a down payment recorded before this (the plan says paid, no page named): never recorded again', legacy?.already && (await payments()).length === 0 && enrolls === 0, legacy);

    await seed(active, true);
    const next = { id: 'cs_next1', payment_status: 'paid', amount_total: 100000, payment_intent: 'pi_next1', metadata: { type: 'academy_tuition_payment', planId: 'pr1_st1', what: 'next' } };
    await Promise.all([A.completeStudentPayment('t1', next), A.completeStudentPayment('t1', next)]);
    pl = await get(P);
    check('a student’s own payment, return page and notice at once: one entry, one line, the plan moves on once', (await payments()).length === 2 && (await linesOf('Tuition')).length === 1 && pl.installmentsPaid === 2, { pl, payments: await payments() });
    await db.doc(`${T}/tuitionPayments/cs_old`).set({ at: '2026-10-05T00:00:00.000Z', planId: 'pr1_st1' });
    await A.completeStudentPayment('t1', { ...next, id: 'cs_old', payment_intent: 'pi_old' });
    check('…one recorded before this (its old mark): not recorded again', (await payments()).length === 2);

    await seed({ ...active, status: 'past_due', paymentMethodId: 'pm_old', failures: 1 }, true);
    const card = { id: 'cs_card1', status: 'complete', setup_intent: 'seti_1', metadata: { type: 'academy_card_update', planId: 'pr1_st1' } };
    const cu: any[] = await Promise.all([A.completeCardUpdate('t1', 'acct_1', card), A.completeCardUpdate('t1', 'acct_1', card)]);
    pl = await get(P);
    check('a card update’s return page and notice at once: the missed instalment charged once, recorded once', piCreates === 1 && pis.filter((x) => x.metadata?.type === 'academy_tuition_installment').length === 1 && (await payments()).length === 2 && (await linesOf('Tuition')).length === 1 && pl.installmentsPaid === 2 && pl.status === 'active' && pl.paymentMethodId === 'pm_new', { cu, pl, piCreates });
    check('…the entry named after its payment, the key after the instalment, try and card', !!(await get(`${T}/tuitionEntries/pay_pi_2`)) && calls.find((c) => c.op === 'pi')?.key === 'tuition_pr1_st1_2_1_pm_new', calls);

    await seed(active, true);
    const ref = db.doc(P); const plan = await get(P);
    const runs: any[] = await Promise.all([A.chargePlan('t1', 'acct_1', ref, plan), A.chargePlan('t1', 'acct_1', ref, plan)]);
    pl = await get(P);
    check('the instalment charged twice at once (the daily run and a card update): one charge, one entry, the plan moves on once', piCreates === 1 && (await payments()).length === 2 && pl.installmentsPaid === 2, { runs, pl });

    await seed(active, true); piMode = 'lost_after';
    let cp: any = await A.chargePlan('t1', 'acct_1', db.doc(P), await get(P));
    pl = await get(P);
    check('the answer lost: not counted as a failure or past due, nothing recorded, the charge still claimed', !cp.ok && cp.unknown && pl.status === 'active' && pl.failures === 0 && !!pl.chargeClaim && (await payments()).length === 1, { cp, pl });
    await db.doc(P).set({ chargeClaim: { at: ago(5) } }, { merge: true });
    cp = await A.chargePlan('t1', 'acct_1', db.doc(P), await get(P));
    pl = await get(P);
    check('…the next try: the payment Stripe has is recorded (one charge), once, and the plan moves on once', cp.ok && piCreates === 1 && pis.filter((x) => x.metadata?.type === 'academy_tuition_installment').length === 1 && (await payments()).length === 2 && pl.installmentsPaid === 2 && !pl.chargeClaim, { cp, pl, piCreates });

    await seed(active, true); piMode = 'decline';
    cp = await A.chargePlan('t1', 'acct_1', db.doc(P), await get(P));
    pl = await get(P);
    check('the card says no: past due, one more failure, nothing recorded, the claim let go', !cp.ok && pl.status === 'past_due' && pl.failures === 1 && !pl.chargeClaim && (await payments()).length === 1, { cp, pl });
  }

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('booth-gift-rent-academy ok');
})();
