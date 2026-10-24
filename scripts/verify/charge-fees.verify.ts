// Checks card charges and fees are taken once and recorded once (api/stripe/charge-card and its callers; lib/fee-pay,
// lib/fee-collection, api/portal/pay-balance, api/clients/balance):
//   - one line in the books per charge: a membership renewal, a membership or package sold by phone, a cancellation
//     or reschedule fee taken on a call (and the planner's cancellation fee);
//   - a declined renewal is never parked as a debt, and is one charge when it finally goes through;
//   - a fee that can't be charged is owed once, however often it's declined, and never when Stripe didn't answer
//     (a duplicate arriving while the first is still charging, or no connection);
//   - a desk charge asked again after its answer was lost is the same charge (the screen's key, or the server's
//     attempt record), and two taps at once charge once;
//   - every way of paying a fee shares one lock: a pay link keeps automatic collection off its fees, a payment for fees
//     already paid another way is recorded and refunded, a whole-balance payment waits for a fee being charged, and a
//     fee added meanwhile stays owed;
//   - a claim left behind (a run cut off after charging) is found at Stripe and recorded, never charged again;
//   - cash recorded at the desk twice at once is one line, and never while a card payment is going through.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/charge-fees.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.CRON_SECRET = 'sec';
process.env.VOICE_AGENT_SECRET = 'voice';
process.env.NEXT_PUBLIC_APP_URL = 'https://studio.test';
let db: any = strictTransactions(makeDb());
let signedIn = true;
let slotOpen = true;

// ── Stripe: one result per key; a key in use while its charge is still going; an answer that can go missing (after
//    charging, or before reaching Stripe); a card that says no; keys forgotten (a day later). ──
type Next = 'ok' | 'decline' | 'lost_after' | 'lost_before';
let pis: any[] = []; let keys = new Map<string, any>(); const inFlight = new Set<string>(); let creates = 0; let next: Next[] = [];
let refunds: any[] = []; let refundKeys = new Map<string, any>(); let sessions: any[] = []; let expired: string[] = [];
let forget = false; let during: null | (() => Promise<void>) = null;
const err = (type: string, code?: string, message = 'Stripe error') => Object.assign(new Error(message), { type, code, raw: { code } });
const clone = (x: any) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function StripeMock(this: any) {
  return {
    paymentIntents: {
      create: async (p: any, o: any) => {
        creates++;
        const key = o?.idempotencyKey ? String(o.idempotencyKey) : '';
        if (key && inFlight.has(key)) throw err('StripeInvalidRequestError', 'idempotency_key_in_use', 'There is currently another in-progress request using this idempotency key.');
        if (key && keys.has(key) && !forget) { const prev = keys.get(key); if (prev.params !== JSON.stringify(p)) throw err('StripeIdempotencyError', 'idempotency_error'); if (prev.error) throw prev.error; return clone(prev.pi); }
        const mode = next.shift() || 'ok';
        if (mode === 'lost_before') throw err('StripeConnectionError', undefined, 'An error occurred with our connection to Stripe.');
        if (key) inFlight.add(key);
        await sleep(4);   // still charging: a duplicate with the same key arrives meanwhile
        if (during) { const f = during; during = null; await f(); }
        if (key) inFlight.delete(key);
        const id = `pi_${pis.length + 1}`;
        if (mode === 'decline') {
          pis.push({ id, status: 'requires_payment_method', amount: p.amount, customer: p.customer, metadata: p.metadata || {}, created: Math.floor(Date.now() / 1000) });
          const e: any = err('StripeCardError', 'card_declined', 'Your card was declined.'); e.decline_code = 'insufficient_funds';
          if (key) keys.set(key, { params: JSON.stringify(p), error: e }); throw e;
        }
        const pi = { id, status: 'succeeded', amount: p.amount, amount_received: p.amount, customer: p.customer, payment_method: p.payment_method, description: p.description, metadata: p.metadata || {}, created: Math.floor(Date.now() / 1000), latest_charge: `ch_${pis.length + 1}` };
        pis.push(pi); if (key) keys.set(key, { params: JSON.stringify(p), pi });
        if (mode === 'lost_after') throw err('StripeConnectionError', undefined, 'An error occurred with our connection to Stripe.');
        return clone(pi);
      },
      list: async (q: any) => ({ data: clone(pis.filter((x) => (!q?.customer || x.customer === q.customer) && (!q?.created?.gte || x.created >= q.created.gte))) }),
      retrieve: async (id: string) => { const x = pis.find((y) => y.id === id); if (!x) throw err('StripeInvalidRequestError', 'resource_missing'); return clone(x); },
    },
    refunds: {
      create: async (p: any, o: any) => {
        const key = String(o?.idempotencyKey || ''); if (key && refundKeys.has(key)) return clone(refundKeys.get(key));
        const r = { id: `re_${refunds.length + 1}`, status: 'succeeded', amount: p.amount, payment_intent: p.payment_intent, metadata: p.metadata || {} }; refunds.push(r); if (key) refundKeys.set(key, r); return clone(r);
      },
    },
    checkout: { sessions: {
      create: async (p: any) => { const s = { id: `cs_${sessions.length + 1}`, url: `https://pay.test/cs_${sessions.length + 1}`, ...clone(p) }; sessions.push(s); return clone(s); },
      expire: async (id: string) => { expired.push(id); return { id, status: 'expired' }; },
    } },
  };
}

const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
let chargeRecords: any[] = [];
M._load = function (request: string, ...rest: any[]) {
  // A dynamic import('stripe') arrives by the package's file path.
  if (request === 'stripe' || /[\\/]node_modules[\\/]stripe[\\/]/.test(request)) return fake(request, Object.assign(StripeMock, { default: StripeMock, __esModule: true }));
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => (signedIn ? { ok: true, actor, tenant: {} } : { ok: false, status: 401, error: 'Please sign in to continue.' }) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async () => ({ ok: true }) });
  if (request === '@/lib/charge-records' || /\/src\/lib\/charge-records(\.ts)?$/.test(request)) return fake(request, { recordCharge: async (_db: any, _t: string, x: any) => { chargeRecords.push(x); return { id: `cr${chargeRecords.length}` }; } });
  if (request === '@/lib/message-policy' || /\/src\/lib\/message-policy(\.ts)?$/.test(request)) return fake(request, { internalHeaders: () => ({ 'x-cf-internal': 'sec' }), resolveMessagePolicy: () => ({ enabled: false }), renderMessage: (s: string) => s, MESSAGE_KINDS: [] });
  if (request === '@/lib/app-origin') return { linkOrigin: () => 'https://studio.test' };
  if (request === '@/lib/deposit-policy') return { isPoorHistory: () => false };
  if (request === '@/lib/card-save' || /\/src\/lib\/card-save(\.ts)?$/.test(request)) return fake(request, { sendCardLink: async () => undefined });
  // Gift cards, as far as a balance payment uses them: a spend already on its record is never made again.
  if (request === '@/lib/gift-cards' || /\/src\/lib\/gift-cards(\.ts)?$/.test(request)) return fake(request, {
    available: (g: any) => Number(g.balanceCents) || 0, notifyGiftUse: async () => undefined,
    spendGiftCard: async (d: any, t: string, o: any) => {
      const rec: any = o.record ? (await o.record.get()).data() : null; if (rec?.giftCents) return { ok: true, cents: rec.giftCents, already: true };
      const ref = d.doc(`tenants/${t}/giftCards/${o.id}`); const g: any = (await ref.get()).data(); if (!g || g.balanceCents < o.cents) return { ok: false, error: 'Not enough left.' };
      await ref.set({ balanceCents: g.balanceCents - o.cents }, { merge: true }); if (o.record) await o.record.set({ giftCents: o.cents }, { merge: true }); return { ok: true, cents: o.cents };
    } });
  if (request === '@/lib/voice/server-availability') return {
    loadTenantContext: async (d: any, t: string) => ({ tenant: (await d.doc(`tenants/${t}`).get()).data() || {}, timezone: 'America/New_York',
      services: (await d.collection(`tenants/${t}/services`).get()).docs.map((x: any) => ({ id: x.id, ...x.data() })), staff: (await d.collection(`tenants/${t}/staff`).get()).docs.map((x: any) => ({ id: x.id, ...x.data() })) }),
    verifySlotOpen: () => ({ open: slotOpen }), fetchDayAppointments: async () => [] };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const lines = async (cat?: string) => (await all(`${T}/transactions`)).filter((x: any) => !cat || x.category === cat);
const income = async (cat: string) => Math.round((await lines(cat)).filter((x: any) => x.type === 'income').reduce((n: number, x: any) => n + (Number(x.amount) || 0), 0) * 100) / 100;
const client = () => get(`${T}/clients/c1`);
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, headers: { get: (k: string) => headers[String(k).toLowerCase()] ?? null }, nextUrl: { origin: 'https://studio.test' }, url: 'https://studio.test/x' }) as any;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const fee = (id: string, dollars: number, x: any = {}) => ({ feeId: id, feeAmount: dollars, reason: 'No-Show Fee', appointmentId: `ap_${id}`, appointmentDate: ago(3600e3), ...x });

const fresh = async (clientExtra: any = {}) => {
  db = strictTransactions(makeDb()); pis = []; keys = new Map(); inFlight.clear(); creates = 0; next = []; refunds = []; refundKeys = new Map(); sessions = []; expired = [];
  forget = false; during = null; signedIn = true; slotOpen = true; chargeRecords = []; dropAnswers = 0;
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York', automations: { feeCollection: true, feeCollectionAfterHours: 0 },
    voiceAgent: { autoSellOfferings: true, autoChargeFeeBearingActions: true }, cancellationFee: 40, cancellationWindowHours: 24, rescheduleFee: 25, rescheduleFeeWindowHours: 48 });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com', phone: '7135550101', cardOnFile: { customerId: 'cus_1', paymentMethodId: 'pm_1', brand: 'Visa', last4: '4242' }, outstandingBalance: 0, unpaidFees: [], ...clientExtra });
  await db.doc(`${T}/memberships/gel`).set({ name: 'Gel club', price: 99, interval: 'monthly' });
  await db.doc(`${T}/packages/p10`).set({ name: '10 gel manicures', price: 300, sessions: 10 });
  await db.doc(`${T}/staff/s1`).set({ name: 'Ana Ruiz', role: 'owner' });
  await db.doc(`${T}/services/gel`).set({ name: 'Gel manicure', price: 55, duration: 60 });
};

// The app's own server calls to the card route go straight to it; `dropAnswers` loses the answer on the way back.
let chargeCard: any = null; let dropAnswers = 0;
(globalThis as any).fetch = async (url: any, init: any = {}) => {
  const u = String(url);
  if (u.endsWith('/api/stripe/charge-card')) {
    const headers: Record<string, string> = {}; for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = String(v);
    const r = await chargeCard(req(JSON.parse(init.body || '{}'), headers));
    if (dropAnswers > 0) { dropAnswers--; throw new Error('socket hang up'); }
    return { status: r.status, ok: r.status < 400, json: async () => r.body };
  }
  if (u.includes('/api/notifications/')) return { status: 200, ok: true, json: async () => ({ ok: true }) };
  throw new Error(`unexpected fetch ${u}`);
};

(async () => {
  ({ POST: chargeCard } = await import('../../src/app/api/stripe/charge-card/route'));
  const R = await import('../../src/lib/memberships/renewals');
  const E = await import('../../src/lib/memberships/enroll-membership');
  const { POST: sellPackage } = await import('../../src/app/api/voice/sell-package/route');
  const { POST: sellMembership } = await import('../../src/app/api/voice/sell-membership/route');
  const { POST: callIntent } = await import('../../src/app/api/voice/log-call-intent/route');
  const F = await import('../../src/lib/fee-pay');
  const C = await import('../../src/lib/fee-collection');
  const { POST: payBalance } = await import('../../src/app/api/portal/pay-balance/route');
  const { POST: balance } = await import('../../src/app/api/clients/balance/route');
  const voice = (body: any, callId = 'call_1') => ({ args: { tenantId: 't1', ...body }, call: { call_id: callId, from_number: '+17135550101' } });
  const vreq = (body: any) => req(body, { 'x-voice-secret': 'voice' });
  const internal = { 'x-cf-internal': 'sec' }; const staff = { authorization: 'Bearer test' };
  const cc = (x: any, headers: Record<string, string> = internal) => chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 4000, ...x }, headers)) as any;
  const stripe: any = new (StripeMock as any)(); const tenant = async () => get(T);
  const renewDue = async () => db.doc(`${T}/clients/c1`).set({ subscription: { membershipId: 'gel', status: 'active', nextBillingDate: ago(3600e3) }, activeMembershipId: 'gel' }, { merge: true });

  console.log('One line in the books per charge');
  await fresh(); await renewDue();
  let rr: any = await R.runRenewals(db, 't1', { appUrl: 'https://studio.test' });
  let c: any = await client();
  check('a $99 renewal: charged once and $99 of Membership Sales (not $198), the plan moved on a month', pis.length === 1 && (await income('Membership Sales')) === 99 && (await lines('Membership Sales')).length === 1 && rr.charged === 1
    && Date.parse(c.subscription.nextBillingDate) > Date.now() + 20 * 864e5 && c.lifetimeValue === 99, { pis: pis.length, lines: await lines(), rr });
  check('…the one line is the charge’s own (named after the payment)', (await lines('Membership Sales'))[0]?.id === `card_charge__${pis[0]?.id}`);

  await fresh();
  let r: any = await sellMembership(vreq(voice({ clientId: 'c1', membershipId: 'gel' })));
  check('a membership sold on a call: charged once, $99 of Membership Sales once', r.body.sold === true && pis.length === 1 && (await income('Membership Sales')) === 99, { body: r.body, lines: await lines() });

  await fresh();
  const p1: any = await E.enrollPackage(db, { tenantId: 't1', clientId: 'c1', packageId: 'p10', paymentMethod: 'card_on_file', source: 'front_desk', appUrl: 'https://studio.test' });
  const p2: any = await E.enrollPackage(db, { tenantId: 't1', clientId: 'c1', packageId: 'p10', paymentMethod: 'card_on_file', source: 'front_desk', appUrl: 'https://studio.test' });
  c = await client();
  check('a package enrolled with the card on file: $300 of Package Sales once; asked again with the same charge, the package isn’t added twice', p1.ok && p2.ok && pis.length === 1 && (await income('Package Sales')) === 300 && (c.activePackages || []).length === 1, { pis: pis.length, pk: c.activePackages, lines: await lines() });

  await fresh();
  const s1: any = await sellPackage(vreq(voice({ clientId: 'c1', packageId: 'p10' })));
  const s2: any = await sellPackage(vreq(voice({ clientId: 'c1', packageId: 'p10' })));
  c = await client();
  check('a package sold on a call, the tool asked twice on the same call: one charge, one package, one line', s1.body.sold && s2.body.sold && pis.length === 1 && (c.activePackages || []).length === 1 && (await income('Package Sales')) === 300, { s1: s1.body, s2: s2.body, pis: pis.length, lines: await lines() });
  await sellPackage(vreq(voice({ clientId: 'c1', packageId: 'p10' }, 'call_2')));
  check('…bought again on another call: a second sale, charged and recorded', pis.length === 2 && ((await client()).activePackages || []).length === 2 && (await income('Package Sales')) === 600);

  const soon = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
  const appt = async (id: string, startH: number) => db.doc(`${T}/appointments/${id}`).set({ clientId: 'c1', clientName: 'Maya Lopez', serviceId: 'gel', staffId: 's1', startTime: soon(startH), endTime: soon(startH + 1), status: 'confirmed', shortCode: 'K7Q2' });
  await fresh(); await appt('a1', 3);
  r = await callIntent(vreq(voice({ intent: 'cancel', clientId: 'c1', appointmentId: 'a1', confirmationCode: 'K7Q2' })));
  check('a cancellation fee taken on a call: canceled, $40 of Cancellation Fee once', r.body.logged && (await get(`${T}/appointments/a1`)).status === 'cancelled' && pis.length === 1 && (await income('Cancellation Fee')) === 40 && (await lines('Cancellation Fee')).length === 1, { body: r.body, lines: await lines() });

  const to = soon(30);
  await fresh(); await appt('a2', 10);
  r = await callIntent(vreq(voice({ intent: 'reschedule', clientId: 'c1', appointmentId: 'a2', confirmationCode: 'K7Q2', requestedSlotISO: to })));
  const adj = await lines('Adjustment Fee');
  check('a reschedule fee taken on a call: moved, $25 of Adjustment Fee once (as an adjustment)', (await get(`${T}/appointments/a2`)).startTime === to && pis.length === 1 && adj.length === 1 && adj[0].amount === 25 && adj[0].taxBucket === 'adjustment', { lines: await lines(), a2: await get(`${T}/appointments/a2`) });
  await fresh(); await appt('a2', 10); slotOpen = false;
  r = await callIntent(vreq(voice({ intent: 'reschedule', clientId: 'c1', appointmentId: 'a2', confirmationCode: 'K7Q2', requestedSlotISO: to })));
  check('…the new time isn’t free: nothing charged, nothing owed (the fee is only for a move that happens)', pis.length === 0 && (await lines()).length === 0 && !((await client()).unpaidFees || []).length, { pis: pis.length });
  await fresh(); await appt('a2', 10); next = ['decline'];
  const was = (await get(`${T}/appointments/a2`)).startTime;
  r = await callIntent(vreq(voice({ intent: 'reschedule', clientId: 'c1', appointmentId: 'a2', confirmationCode: 'K7Q2', requestedSlotISO: to })));
  check('…the card says no: not moved, the time let go, and no fee parked as a debt', (await get(`${T}/appointments/a2`)).startTime === was && !((await client()).unpaidFees || []).length && (await all(`${T}/slotLocks`)).length === 0 && !(await all(`${T}/chargeFlags`)).length, { c: await client() });

  const planner = fs.readFileSync('src/app/(app)/planner/page.tsx', 'utf8');
  const cancelHandler = (planner.match(/const handleConfirmCancellation = async \(data: any\) => \{[\s\S]*?\n  \};/) || [''])[0];
  check('the planner’s cancellation fee: the charge is its one line (no second line written there), under the categories staff pay and reports count',
    !!cancelHandler && !/transactions`\)\)/.test(cancelHandler) && /'No-Show Revenue' : 'Cancellation Fee'/.test(cancelHandler), cancelHandler.slice(0, 120));
  check('…and no answer from the card processor saves nothing (asked again, it’s the same charge)', /status >= 500 \|\| r\.unknown\) \{[^}]*\}\); return; \}/.test(cancelHandler));

  console.log('A declined renewal');
  await fresh(); await renewDue();
  next = ['decline', 'decline', 'decline'];
  for (let day = 0; day < 3; day++) await R.runRenewals(db, 't1', { appUrl: 'https://studio.test' });
  c = await client();
  check('declined Monday to Wednesday: past due, tried for real each day (three charges asked), and nothing parked as a debt', c.subscription.status === 'past_due' && creates === 3 && !(Number(c.outstandingBalance) > 0) && !(c.unpaidFees || []).length && !(await all(`${T}/chargeFlags`)).length, { c, creates });
  await R.runRenewals(db, 't1', { appUrl: 'https://studio.test' });
  c = await client();
  check('…paid Thursday: charged $99 once, owes nothing, active again', c.subscription.status === 'active' && (await income('Membership Sales')) === 99 && pis.filter((x) => x.status === 'succeeded').length === 1 && !(Number(c.outstandingBalance) > 0), { c, lines: await lines() });

  await fresh(); await renewDue();
  await Promise.all([R.runRenewals(db, 't1', { appUrl: 'https://studio.test' }), R.runRenewals(db, 't1', { appUrl: 'https://studio.test' })]);
  check('two runs at once (the daily one and a manual one): one charge, one line, moved on once', pis.length === 1 && (await lines('Membership Sales')).length === 1 && ((await client()).lifetimeValue || 0) === 99, { pis: pis.length, lines: await lines() });

  await fresh(); await renewDue(); dropAnswers = 1;
  rr = await R.runRenewals(db, 't1', { appUrl: 'https://studio.test' });
  const renId = (await all(`${T}/membershipRenewals`))[0];
  check('the answer lost on the way back: nothing changes yet (not past due), the try is kept', rr.results[0]?.outcome === 'unconfirmed' && (await client()).subscription.status === 'active' && renId?.status === 'charging', { rr, renId });
  await db.doc(`${T}/membershipRenewals/${renId.id}`).set({ at: ago(5 * 60000) }, { merge: true });
  await R.runRenewals(db, 't1', { appUrl: 'https://studio.test' });
  check('…the next run: the same charge (one at Stripe), recorded once, moved on', pis.length === 1 && (await lines('Membership Sales')).length === 1 && Date.parse((await client()).subscription.nextBillingDate) > Date.now(), { pis: pis.length });
  await fresh(); await renewDue(); dropAnswers = 1;
  await R.runRenewals(db, 't1', { appUrl: 'https://studio.test' });
  const ren2 = (await all(`${T}/membershipRenewals`))[0];
  await db.doc(`${T}/membershipRenewals/${ren2.id}`).set({ at: ago(25 * 3600e3), firstAt: ago(25 * 3600e3) }, { merge: true }); forget = true;
  const before = creates; await R.runRenewals(db, 't1', { appUrl: 'https://studio.test' });
  check('…a day later, when Stripe has forgotten the key: the payment is found (it carries the key), recorded once, never charged again', creates === before && pis.length === 1 && (await lines('Membership Sales')).length === 1 && (await client()).subscription.status === 'active', { creates, before });

  console.log('A fee that can’t be charged is owed once');
  await fresh(); next = ['decline', 'decline'];
  const arrears = { amountCents: 4000, appointmentId: 'ap9', category: 'No-Show Revenue', description: 'No-show fee', mode: 'auto', kind: 'arrears_fee' };
  const d1 = await cc(arrears); const d2 = await cc(arrears);
  c = await client();
  check('declined twice: on their balance once ($40, one fee, one flag)', d1.body.parkedAsBalance && d2.body.parkedAsBalance && c.outstandingBalance === 40 && (c.unpaidFees || []).length === 1 && (await all(`${T}/chargeFlags`)).length === 1, { c, d1: d1.body });
  await fresh();
  const both = await Promise.all([cc({ ...arrears, category: 'Cancellation Fee', description: 'Cancellation fee' }), cc({ ...arrears, category: 'Cancellation Fee', description: 'Cancellation fee' })]);
  c = await client();
  check('two calls at once (one sends no key; the second meets the first still charging): charged once, one line, nothing parked', pis.length === 1 && (await lines('Cancellation Fee')).length === 1 && !(c.unpaidFees || []).length && !(Number(c.outstandingBalance) > 0) && both.some((x: any) => x.body.ok) && both.some((x: any) => x.status === 502 && x.body.unknown), both.map((x: any) => [x.status, x.body]));
  await fresh(); next = ['lost_before'];
  r = await cc(arrears);
  check('no connection to Stripe: “may or may not have gone through”, and nothing parked', r.status === 502 && r.body.unknown && !((await client()).unpaidFees || []).length && !(await all(`${T}/chargeFlags`)).length, r.body);
  r = await cc(arrears);
  check('…asked again: charged once', r.body.ok && pis.length === 1 && (await lines('No-Show Revenue')).length === 1);
  await fresh(); next = ['lost_after'];
  r = await cc(arrears); const again = await cc(arrears);
  check('charged but the answer lost: asked again, the same charge, one line, nothing owed', r.status === 502 && again.body.ok && pis.length === 1 && (await lines('No-Show Revenue')).length === 1 && !((await client()).unpaidFees || []).length, { r: r.body, again: again.body });

  await fresh(); await appt('a1', 3); next = ['decline'];
  r = await callIntent(vreq(voice({ intent: 'cancel', clientId: 'c1', appointmentId: 'a1', confirmationCode: 'K7Q2' })));
  c = await client();
  check('a call’s cancellation fee declined: canceled with the fee owed once, under the visit’s fee name', (await get(`${T}/appointments/a1`)).status === 'cancelled' && c.outstandingBalance === 40 && (c.unpaidFees || []).length === 1 && c.unpaidFees[0].feeId === 'cancel-a1' && (await all(`${T}/chargeFlags`)).length === 1, { c });
  await fresh(); await appt('a1', 3); next = ['lost_before'];
  r = await callIntent(vreq(voice({ intent: 'cancel', clientId: 'c1', appointmentId: 'a1', confirmationCode: 'K7Q2' })));
  const inbox: any = (await all(`${T}/voiceInbox`))[0];
  check('…no answer from the card processor: not canceled, nothing owed, and the team is told to check the payment first', (await get(`${T}/appointments/a1`)).status === 'confirmed' && !((await client()).unpaidFees || []).length && inbox?.paymentUnconfirmed === true, { inbox });

  console.log('A desk charge asked again');
  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] }); next = ['lost_after'];
  const settle = (key?: string) => cc({ description: 'Dossier Settlement — Outstanding Balance', category: 'Fee Recovery', taxBucket: 'adjustment', ...(key ? { idempotencyKey: key } : {}) }, staff);
  r = await settle('settle_c1_abc');
  const r12 = await settle('settle_c1_abc');   // staff tap again 12 seconds later, the screen keeping its key
  check('Settlement: the answer lost, tapped again with the screen’s key: the same charge (one at Stripe), one line', r.status === 502 && r12.body.ok && pis.length === 1 && (await lines('Fee Recovery')).length === 1 && (await lines('Fee Recovery'))[0].taxBucket === 'adjustment', { r: r.body, r12: r12.body, pis: pis.length });
  await fresh(); next = ['lost_after'];
  r = await settle(); const r2 = await settle();
  check('…a screen that sends no key: the try Stripe didn’t answer keeps its key, so tapping again is the same charge', r.status === 502 && r2.body.ok && pis.length === 1, { r: r.body, r2: r2.body });
  let clean = true;
  for (let i = 0; i < 6; i++) {
    await fresh();
    const taps = await Promise.all([settle(), settle()]);
    // The second is told it's going through, or (when it lands just after the first finished) gets that same payment.
    if (pis.length !== 1 || !taps.every((x: any) => (x.body.ok ? x.body.paymentIntentId === pis[0].id : x.status === 409 && x.body.code === 'in_progress'))) { clean = false; console.log('   ', taps.map((x: any) => [x.status, x.body])); }
  }
  check('…two taps at once: one charge (the other is told it’s going through, or answered with that payment)', clean);
  await fresh();
  r = await settle(); const again2: any = await settle();
  check('…tapped again moments after it went through (its answer lost on the way to the screen): the same payment, not a second', r.body.ok && again2.body.ok && again2.body.paymentIntentId === r.body.paymentIntentId && pis.length === 1 && (await lines('Fee Recovery')).length === 1);
  for (const a of await all(`${T}/cardAttempts`)) await db.doc(`${T}/cardAttempts/${a.id}`).set({ doneAt: ago(60000) }, { merge: true });
  const later: any = await settle();
  check('…the same charge asked for a minute later is a new charge (the same thing bought again)', later.body.ok && pis.length === 2 && later.body.paymentIntentId !== r.body.paymentIntentId);
  await fresh(); next = ['decline'];
  r = await settle(); const r4: any = await settle();
  check('…a decline ends the try: tapping again really tries the card again', r.body.ok === false && r4.body.ok && creates === 2 && pis.filter((x) => x.status === 'succeeded').length === 1, { r: r.body, r4: r4.body });
  const page = fs.readFileSync('src/app/(app)/clients/[id]/page.tsx', 'utf8');
  check('the client page’s Settlement pays through the whole-balance payment (one lock with every other way of paying a fee), and never clears the balance itself',
    /fetch\('\/api\/portal\/pay-balance'/.test(page) && !/Dossier Settlement/.test(page) && !/outstandingBalance: 0,\s*unpaidFees: \[\]/.test(page) && /out\.code === 'unconfirmed'/.test(page));
  await fresh(); signedIn = false;
  r = await settle();
  check('no sign-in: refused, nothing charged', r.status === 401 && creates === 0, r.body);

  console.log('One lock for every way of paying a fee');
  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] });
  const link: any = await F.feePayLink(db, stripe, 't1', await tenant(), { clientId: 'c1', feeIds: ['f1'], origin: 'https://studio.test' });
  const out: any = await C.collectFees(db, stripe, 't1', await tenant());
  check('a $40 pay link texted at 10:00: automatic collection at 15:00 leaves the fee to the link (nothing charged)', link.ok && out.tried === 0 && creates === 0 && !!(await client()).unpaidFees[0].payLinkUntil, { out, f: (await client()).unpaidFees });
  pis.push({ id: 'pi_link', status: 'succeeded', amount: 4000, amount_received: 4000, customer: 'cus_x', metadata: {}, created: Math.floor(Date.now() / 1000) });
  await F.settleFeesPaid(db, 't1', { clientId: 'c1', feeIds: ['f1'], how: 'link', paymentIntentId: 'pi_link', by: 'Payment link' });
  await F.settleFeesPaid(db, 't1', { clientId: 'c1', feeIds: ['f1'], how: 'link', paymentIntentId: 'pi_link', by: 'Payment link' });
  c = await client();
  check('…the client pays the link at 18:00: settled once (one line, one receipt), nothing owed', !(c.unpaidFees || []).length && c.outstandingBalance === 0 && (await lines('Fees')).length === 1 && (await all(`${T}/receipts`)).length === 1 && refunds.length === 0, { lines: await lines() });

  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] });
  const l2: any = await F.feePayLink(db, stripe, 't1', await tenant(), { clientId: 'c1', feeIds: ['f1'], origin: 'https://studio.test' });
  const desk: any = await F.chargeFeesNow(db, stripe, 't1', await tenant(), { clientId: 'c1', feeIds: ['f1'], by: 'Kai' });
  check('the desk charges the card while the link is open: paid, and the link is closed', desk.ok && pis.length === 1 && expired.includes(l2.url.split('/').pop()) && !((await client()).unpaidFees || []).length, { desk, expired });
  pis.push({ id: 'pi_link2', status: 'succeeded', amount: 4000, amount_received: 4000, customer: 'cus_x', metadata: {}, created: Math.floor(Date.now() / 1000) });
  await F.settleFeesPaid(db, 't1', { clientId: 'c1', feeIds: ['f1'], how: 'link', paymentIntentId: 'pi_link2', by: 'Payment link' });
  const twiceIn = (await lines()).filter((x: any) => x.id === 'feepay_twice_pi_link2'); const twiceOut = (await lines()).filter((x: any) => x.id === 'feepay_twice_refund_pi_link2');
  check('…the client pays the link anyway: the payment is recorded and refunded (never dropped), and the flag says it was', twiceIn.length === 1 && twiceIn[0].amount === 40 && twiceOut.length === 1 && refunds.length === 1 && refunds[0].amount === 4000 && refunds[0].payment_intent === 'pi_link2' && refunds[0].metadata?.origin === 'app'
    && (await get(`${T}/chargeFlags/twice_pi_link2`))?.status === 'resolved' && (await client()).outstandingBalance === 0, { lines: await lines(), refunds });
  await F.settleFeesPaid(db, 't1', { clientId: 'c1', feeIds: ['f1'], how: 'link', paymentIntentId: 'pi_link2', by: 'Payment link' });
  check('…the webhook sent again: refunded once, recorded once', refunds.length === 1 && (await lines()).filter((x: any) => /feepay_twice/.test(x.id)).length === 2);

  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40, { collectingAt: new Date().toISOString(), collectingKey: 'fees_c1_x' })] });
  r = await payBalance(req({ tenantId: 't1', clientId: 'c1' }, staff));
  check('a whole-balance payment while automatic collection is charging the fee: told it’s going through, nothing charged', r.status === 409 && creates === 0, r.body);
  r = await balance(req({ tenantId: 't1', clientId: 'c1', action: 'settled', via: 'cash' }, staff));
  check('…cash recorded at the desk meanwhile: refused, nothing recorded', r.status === 409 && (await lines()).length === 0 && (await client()).outstandingBalance === 40, r.body);

  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] });
  const pb = await Promise.all([payBalance(req({ tenantId: 't1', clientId: 'c1' }, staff)), payBalance(req({ tenantId: 't1', clientId: 'c1' }, staff))]) as any[];
  c = await client();
  check('a whole-balance payment tapped twice at once: one charge, one line, the fee off their list', pis.length === 1 && (await lines('Fee Recovery')).length === 1 && !(c.unpaidFees || []).length && c.outstandingBalance === 0 && pb.filter((x) => x.body.ok).length === 1, pb.map((x) => x.body));
  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] });
  during = async () => { await db.doc(`${T}/clients/c1`).set({ outstandingBalance: 65, unpaidFees: [...((await client()).unpaidFees || []), fee('f2', 25)] }, { merge: true }); };
  r = await payBalance(req({ tenantId: 't1', clientId: 'c1' }, staff));
  c = await client();
  check('…a fee added while it was charging stays owed: $40 paid, the new $25 fee still on their list', r.body.ok && c.outstandingBalance === 25 && (c.unpaidFees || []).length === 1 && c.unpaidFees[0].feeId === 'f2' && (await income('Fee Recovery')) === 40, { c, body: r.body });
  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] }); next = ['lost_after'];
  r = await payBalance(req({ tenantId: 't1', clientId: 'c1' }, staff));
  const held = await client();
  await db.doc(`${T}/clients/c1`).set({ unpaidFees: held.unpaidFees.map((f: any) => ({ ...f, collectingAt: ago(5 * 60000) })), balancePaying: { ...held.balancePaying, at: ago(5 * 60000) } }, { merge: true });
  const r3: any = await payBalance(req({ tenantId: 't1', clientId: 'c1' }, staff));
  check('…the answer lost: asked again, that payment is found and recorded, never charged again', r.status === 502 && pis.length === 1 && (await lines('Fee Recovery')).length === 1 && (await client()).outstandingBalance === 0 && r3.body.ok, { r: r.body, r3: r3.body, pis: pis.length });

  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] });
  await db.doc(`${T}/giftCards/g1`).set({ recipientId: 'c1', status: 'active', balanceCents: 2500, code: 'GIFT-1' }); next = ['lost_after'];
  r = await payBalance(req({ tenantId: 't1', clientId: 'c1', useGift: true, cardToo: true }, staff));
  const heldG = await client();
  await db.doc(`${T}/clients/c1`).set({ unpaidFees: (heldG.unpaidFees || []).map((f: any) => ({ ...f, collectingAt: ago(5 * 60000) })), balancePaying: { ...heldG.balancePaying, at: ago(5 * 60000) } }, { merge: true });
  const rG: any = await payBalance(req({ tenantId: 't1', clientId: 'c1', useGift: true, cardToo: true }, staff));
  c = await client();
  check('gift card first, then the card (its answer lost, asked again): $25 from the gift card once, $15 charged once, nothing left owing',
    r.status === 502 && rG.body.ok && (await get(`${T}/giftCards/g1`)).balanceCents === 0 && pis.length === 1 && pis[0].amount === 1500 && (await lines('Fee Recovery')).length === 2 && (await income('Fee Recovery')) === 40 && c.outstandingBalance === 0 && !(c.unpaidFees || []).length,
    { r: r.body, rG: rG.body, lines: await lines(), c });

  console.log('A claim left behind');
  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] }); next = ['lost_after'];
  const run: any = await C.collectFees(db, stripe, 't1', await tenant());
  check('automatic collection charged the fee but got no answer: the fee stays claimed (no failed try counted)', run.unconfirmed === 1 && run.failed === 0 && !!(await client()).unpaidFees[0].collectingKey && !(await client()).unpaidFees[0].collectAttempts, { run, f: (await client()).unpaidFees });
  const cl0 = await client(); const k0 = cl0.unpaidFees[0].collectingKey;
  await db.doc(`${T}/clients/c1`).set({ unpaidFees: cl0.unpaidFees.map((f: any) => ({ ...f, collectingAt: ago(10 * 60000) })) }, { merge: true });
  await db.doc(`${T}/feeCharges/${k0}`).set({ at: ago(10 * 60000) }, { merge: true });
  const deskAfter: any = await F.chargeFeesNow(db, stripe, 't1', await tenant(), { clientId: 'c1', feeIds: ['f1'], by: 'Kai' });
  check('…ten minutes later the desk taps Charge card: the payment Stripe has is recorded, the card isn’t charged again', pis.length === 1 && creates === 1 && !((await client()).unpaidFees || []).length && (await lines('Fees')).length === 1 && (await lines('Fees'))[0].id === 'collect_f1' && deskAfter.ok === false && /already paid/.test(deskAfter.error), { deskAfter, pis: pis.length, creates, lines: await lines() });
  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] }); next = ['lost_before'];
  await C.collectFees(db, stripe, 't1', await tenant());
  const cl1 = await client(); const k1 = cl1.unpaidFees[0].collectingKey;
  await db.doc(`${T}/clients/c1`).set({ unpaidFees: cl1.unpaidFees.map((f: any) => ({ ...f, collectingAt: ago(10 * 60000) })) }, { merge: true }); await db.doc(`${T}/feeCharges/${k1}`).set({ at: ago(10 * 60000) }, { merge: true });
  const deskNew: any = await F.chargeFeesNow(db, stripe, 't1', await tenant(), { clientId: 'c1', feeIds: ['f1'], by: 'Kai' });
  check('…the run never reached Stripe: the fee is free again and the desk charges it once', deskNew.ok && pis.length === 1 && (await lines('Fees')).length === 1, { deskNew, pis: pis.length });
  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40, { collectingAt: ago(15 * 60000) })] });
  pis.push({ id: 'pi_old', status: 'succeeded', amount: 4000, amount_received: 4000, customer: 'cus_1', metadata: { feeId: 'f1', source: 'fee_collection' }, created: Math.floor(Date.now() / 1000) - 900, latest_charge: 'ch_old' });
  const deskOld: any = await F.chargeFeesNow(db, stripe, 't1', await tenant(), { clientId: 'c1', feeIds: ['f1'], by: 'Kai' });
  check('…a lock from before charges kept their key: the payment naming the fee is found and recorded, not charged again', creates === 0 && (await lines('Fees')).length === 1 && !((await client()).unpaidFees || []).length && deskOld.ok === false, { deskOld });
  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] });
  const two = await Promise.all([F.chargeFeesNow(db, stripe, 't1', await tenant(), { clientId: 'c1', feeIds: ['f1'], by: 'Kai' }), C.collectFees(db, stripe, 't1', await tenant())]) as any[];
  check('the desk’s Charge card and automatic collection at the same moment: charged once', pis.length === 1 && (await lines('Fees')).length === 1, { two, pis: pis.length });

  console.log('Cash recorded at the desk');
  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] });
  const cash = await Promise.all([balance(req({ tenantId: 't1', clientId: 'c1', action: 'settled', via: 'cash' }, staff)), balance(req({ tenantId: 't1', clientId: 'c1', action: 'settled', via: 'cash' }, staff))]) as any[];
  check('“Settled” pressed on two devices at once: one income line for the one cash payment', (await lines('Fee Recovery')).length === 1 && (await income('Fee Recovery')) === 40 && (await client()).outstandingBalance === 0 && cash.every((x) => x.body.ok) && cash.some((x) => x.body.already), cash.map((x) => x.body));
  await fresh({ outstandingBalance: 40, unpaidFees: [fee('f1', 40)] }); signedIn = false;
  r = await balance(req({ tenantId: 't1', clientId: 'c1', action: 'settled', via: 'cash' }));
  check('…no sign-in: refused, nothing recorded', r.status === 401 && (await lines()).length === 0, r.body);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('charge-fees ok');
})();
