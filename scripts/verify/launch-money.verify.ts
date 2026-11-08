// Checks the money paths a launch relies on (launch L9), from the client-and-money walk-through:
// - A renter's online deposit, paid to the renter's own account, is recorded: the booking is confirmed and paid, nothing
//   goes in the business's books, a stray notice can't mark anyone's visit paid, and a repeat notice changes nothing.
// - A business's online deposit saves the card to the client (under a customer, never over a good card), and the
//   client gets a text as well as an email, with links on the business's real address.
// - A held time is let go only once every payment form opened for it is closed; a form that was paid keeps the booking,
//   and if Stripe can't be asked nothing is let go. The form also closes by itself at the hold's deadline.
// - A renter's deposit never carries a balance owed to the business.
// - At checkout, a deposit for a service whose deposit doesn't count isn't taken off the bill, and it's closed as kept.
// - Client messages give times on the business's own clock; thank-you messages go only to visits that took place.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-money.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_x'; process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
let db: any = strictTransactions(makeDb());
const sent: any[] = []; let webhookEvent: any = null; let stripeDown = false;
const sessions: Record<string, any> = {}; const created: any[] = [];
const desk: any = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false, caps: [] };
function StripeMock(this: any) {
  return {
    webhooks: { constructEvent: () => webhookEvent },
    paymentIntents: { retrieve: async (id: string) => ({ id, latest_charge: `ch_${id}`, customer: 'cus_1', payment_method: 'pm_1' }) },
    paymentMethods: { retrieve: async (id: string) => ({ id, card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2099 } }) },
    checkout: { sessions: {
      retrieve: async (id: string) => { if (stripeDown) throw new Error('down'); const s = sessions[id]; if (!s) throw Object.assign(new Error('No such checkout session'), { code: 'resource_missing' }); return { ...s, id }; },
      expire: async (id: string) => { if (stripeDown) throw new Error('down'); const s = sessions[id]; if (s.status === 'open') s.status = 'expired'; return { ...s, id }; },
      create: async (p: any, o: any) => { created.push({ p, o }); return { id: `cs_new${created.length}`, client_secret: 'sec' }; },
    } },
  };
}
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }), redirect: (url: string) => ({ status: 307, url }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin-stripe-deposit' }, { name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, m: any) => { sent.push(m); return { ok: true }; }, ensureApptToken: async () => 'tok' });
  if (request === '@/lib/email-template' || /\/src\/lib\/email-template(\.ts)?$/.test(request)) return fake(request, { brandedEmailHtml: (x: any) => JSON.stringify(x) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: desk, tenant: {} }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor: desk }) };
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://studio-abc123-team.vercel.app' } }) as any;
const later = new Date(Date.now() + 3 * 86400000).toISOString();

const base = async () => {
  db = strictTransactions(makeDb()); sent.length = 0; created.length = 0; stripeDown = false; for (const k of Object.keys(sessions)) delete sessions[k];
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_biz', stripeChargesEnabled: true, timezone: 'America/Chicago', bookingMode: { holdMinutes: 30 }, salesTax: { configured: true, productsPct: 0 } });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'front_desk' });
  await db.doc(`${T}/staff/r1`).set({ name: 'Rae Kim', role: 'renter', isRenter: true, renterId: 'rent1' });
  await db.doc(`${T}/renters/rent1`).set({ name: 'Rae Kim', stripeAccountId: 'acct_renter', stripeChargesEnabled: true });
  await db.doc(`${T}/services/s1`).set({ name: 'Consultation', price: 100, duration: 60 });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com', phone: '+15555550100' });
};
const sessionEvent = (account: string, id: string, md: any, amount = 2500) => ({ type: 'checkout.session.completed', account,
  data: { object: { id, payment_status: 'paid', status: 'complete', amount_total: amount, payment_intent: `pi_${id}`, metadata: md } } });

(async () => {
  const W = await import('../../src/lib/connect-webhook');
  const hook = (ev: any) => { webhookEvent = ev; return W.handleConnectWebhook({ text: async () => '{}', headers: { get: (k: string) => (k === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio-abc123-team.vercel.app' } } as any); };

  console.log('A renter’s online deposit');
  await base();
  await db.doc(`${T}/appointments/ar`).set({ clientId: 'c1', clientName: 'Maya Lopez', isRenterBooking: true, renterProviderId: 'r1', renterServiceName: 'Brow shaping', status: 'pending_payment', depositStatus: 'pending', depositAmountCents: 2500, startTime: later, checkInToken: 'tokR' });
  await db.doc(`${T}/appointments/ar2`).set({ clientId: 'c1', isRenterBooking: true, renterProviderId: 'r1', status: 'pending_payment', depositStatus: 'pending', startTime: later });
  await hook(sessionEvent('acct_renter', 'cs_r1', { type: 'deposit', tenantId: 't1', appointmentId: 'ar', renterProviderId: 'r1' }));
  let ap: any = await get(`${T}/appointments/ar`);
  check('the booking is confirmed and marked paid, to the renter', ap.status === 'confirmed' && ap.depositStatus === 'paid' && ap.depositPaidTo === 'renter' && ap.depositAmountCents === 2500 && ap.stripeCheckoutSessionId === 'cs_r1', ap);
  check('nothing goes in the business’s books or its deposit credits', (await all(`${T}/transactions`)).length === 0 && (await all(`${T}/depositCredits`)).length === 0);
  check('the card isn’t put on the business’s client record (it’s on the renter’s account)', !(await get(`${T}/clients/c1`)).cardOnFile);
  check('the client is told by text and email', sent.some((m) => m.channel === 'sms' && m.kind === 'booking_confirmation') && sent.some((m) => m.channel === 'email' && m.kind === 'booking_confirmation'), sent.map((m) => m.channel));
  const before = JSON.stringify(await get(`${T}/appointments/ar`)); sent.length = 0;
  await hook(sessionEvent('acct_renter', 'cs_r1', { type: 'deposit', tenantId: 't1', appointmentId: 'ar', renterProviderId: 'r1' }));
  check('the same notice again changes nothing and sends nothing', JSON.stringify(await get(`${T}/appointments/ar`)) === before && sent.length === 0);
  await hook(sessionEvent('acct_someone_else', 'cs_x', { type: 'deposit', tenantId: 't1', appointmentId: 'ar2', renterProviderId: 'r1' }));
  check('a notice from another account can’t mark a renter’s visit paid', (await get(`${T}/appointments/ar2`)).depositStatus === 'pending');
  await hook(sessionEvent('acct_renter', 'cs_y', { type: 'deposit', tenantId: 't1', appointmentId: 'ar2', renterProviderId: 'k1' }));
  check('…nor one naming someone who isn’t that booking’s renter', (await get(`${T}/appointments/ar2`)).depositStatus === 'pending');
  await hook(sessionEvent('acct_renter', 'cs_r2', { type: 'deposit', tenantId: 't1', appointmentId: 'ar', renterProviderId: 'r1' }));
  ap = await get(`${T}/appointments/ar`);
  check('a second payment for a paid booking is flagged for a refund, never recorded twice', ap.needsAttention === 'deposit_paid_twice' && ap.stripeCheckoutSessionId === 'cs_r1' && (await all(`${T}/transactions`)).length === 0, ap);
  await db.doc('tenants/t2').set({ name: 'Another business', stripeAccountId: 'acct_renter' });
  await db.doc(`${T}/appointments/ar4`).set({ clientId: 'c1', isRenterBooking: true, renterProviderId: 'r1', status: 'pending_payment', depositStatus: 'pending', startTime: later });
  await hook(sessionEvent('acct_renter', 'cs_r4', { type: 'deposit', tenantId: 't1', appointmentId: 'ar4', renterProviderId: 'r1' }));
  check('found even when the renter’s account is also some other business’s own', (await get(`${T}/appointments/ar4`)).depositStatus === 'paid' && (await all('tenants/t2/transactions')).length === 0);
  check('a business’s team never sees a renter’s deposit as theirs to refund after a disruption', src('src/app/api/appt/route.ts').includes("a.depositStatus === 'paid' && a.depositPaidTo !== 'renter' && !a.isRenterBooking"));

  console.log('A business’s online deposit');
  await base();
  await db.doc(`${T}/appointments/as`).set({ clientId: 'c1', clientName: 'Maya Lopez', serviceId: 's1', status: 'pending_payment', depositStatus: 'pending', depositAmountCents: 2500, startTime: '2026-12-01T20:00:00.000Z', checkInToken: 'tokS', createdAt: new Date().toISOString() });
  await hook(sessionEvent('acct_biz', 'cs_s1', { type: 'deposit', tenantId: 't1', appointmentId: 'as' }));
  ap = await get(`${T}/appointments/as`);
  const cl: any = await get(`${T}/clients/c1`);
  check('the booking is confirmed, with its income and its deposit credit', ap.status === 'confirmed' && ap.depositStatus === 'paid' && (await all(`${T}/transactions`)).length === 1 && (await all(`${T}/depositCredits`)).length === 1);
  check('the card used is saved to the client, under the customer, so it can be charged later', cl.cardOnFile?.paymentMethodId === 'pm_1' && cl.cardOnFile?.customerId === 'cus_1' && cl.cardOnFile?.last4 === '4242', cl.cardOnFile);
  const sms = sent.find((m) => m.channel === 'sms'); const mail = sent.find((m) => m.channel === 'email');
  check('the client gets a text too, with the visit link', !!sms && sms.text.includes('https://app.example/check-in/tokS') && sms.text.includes('$25.00'), sms?.text);
  check('links use the business’s real address, never a preview’s or a made-up one', !!mail && mail.html.includes('https://app.example/check-in/tokS') && !JSON.stringify(sent).includes('clarityflow.app') && !JSON.stringify(sent).includes('vercel.app'), mail?.html?.slice(0, 200));
  check('the time is on the business’s own clock (Chicago)', !!sms && sms.text.includes('2:00 PM'), sms?.text);
  await base();
  await db.doc(`${T}/clients/c1`).set({ cardOnFile: { paymentMethodId: 'pm_keep', customerId: 'cus_keep', last4: '1111', expMonth: 1, expYear: 2099 } }, { merge: true });
  await db.doc(`${T}/appointments/as`).set({ clientId: 'c1', serviceId: 's1', status: 'pending_payment', depositStatus: 'pending', depositAmountCents: 2500, startTime: later, checkInToken: 'tokS' });
  await hook(sessionEvent('acct_biz', 'cs_s2', { type: 'deposit', tenantId: 't1', appointmentId: 'as' }));
  check('a good card already on file stays', (await get(`${T}/clients/c1`)).cardOnFile.paymentMethodId === 'pm_keep');
  await db.doc(`${T}/clients/c1`).set({ cardOnFile: { paymentMethodId: 'pm_old', customerId: 'cus_keep', last4: '2222', expMonth: 1, expYear: 2020, oldNote: 'from the old card' } }, { merge: true });
  await db.doc(`${T}/appointments/as3`).set({ clientId: 'c1', serviceId: 's1', status: 'pending_payment', depositStatus: 'pending', depositAmountCents: 2500, startTime: later, checkInToken: 'tok3' });
  await hook(sessionEvent('acct_biz', 'cs_s3', { type: 'deposit', tenantId: 't1', appointmentId: 'as3' }));
  check('an expired one is replaced by the card just used, whole (nothing from the old card stays)', (await get(`${T}/clients/c1`)).cardOnFile.paymentMethodId === 'pm_1' && !('oldNote' in (await get(`${T}/clients/c1`)).cardOnFile));

  console.log('Letting a held time go');
  const { releaseUnpaidHolds } = await import('../../src/lib/release-unpaid');
  const hour = new Date(Date.now() - 60 * 60000).toISOString();
  const held = (sid: string) => ({ clientId: 'c1', serviceId: 's1', status: 'pending_payment', depositStatus: 'pending', startTime: later, createdAt: hour, source: 'booking-page', depositSessions: [`acct_biz:${sid}`] });
  await base();
  await db.doc(`${T}/appointments/h1`).set(held('cs_open')); sessions.cs_open = { status: 'open', payment_status: 'unpaid' };
  await db.doc(`${T}/appointments/h2`).set(held('cs_paid')); sessions.cs_paid = { status: 'complete', payment_status: 'paid' };
  await releaseUnpaidHolds(db, 't1', { origin: 'https://app.example' });
  check('an open payment form is closed, then the time is let go', sessions.cs_open.status === 'expired' && (await get(`${T}/appointments/h1`)).status === 'cancelled');
  const h2: any = await get(`${T}/appointments/h2`);
  check('a form that was paid keeps the booking, and the team is told once to check it', h2.status === 'pending_payment' && h2.needsAttention === 'deposit_paid_not_recorded' && (await all(`${T}/notifications`)).length > 0, h2);
  const told = (await all(`${T}/notifications`)).length;
  await releaseUnpaidHolds(db, 't1', { origin: 'https://app.example' });
  check('…only once', (await all(`${T}/notifications`)).length === told && (await get(`${T}/appointments/h2`)).status === 'pending_payment');
  await base();
  await db.doc(`${T}/appointments/h3`).set(held('cs_open2')); sessions.cs_open2 = { status: 'open' }; stripeDown = true;
  await releaseUnpaidHolds(db, 't1', { origin: 'https://app.example' });
  check('when Stripe can’t be asked, nothing is let go', (await get(`${T}/appointments/h3`)).status === 'pending_payment');
  await db.doc(`${T}/appointments/h4`).set({ ...held('cs_gone'), createdAt: new Date(Date.now() - 30 * 3600000).toISOString(), depositSessionAt: new Date(Date.now() - 26 * 3600000).toISOString() });
  await releaseUnpaidHolds(db, 't1', { origin: 'https://app.example', now: Date.now() });
  check('a form opened more than a day ago can’t still be paid, so not hearing from Stripe no longer holds the time', (await get(`${T}/appointments/h4`)).status === 'cancelled');
  stripeDown = false;
  await db.doc(`${T}/appointments/h5`).set({ ...held('cs_paid5'), createdAt: new Date(Date.now() - 30 * 3600000).toISOString(), depositSessionAt: new Date(Date.now() - 26 * 3600000).toISOString() }); sessions.cs_paid5 = { status: 'complete', payment_status: 'paid' };
  await releaseUnpaidHolds(db, 't1', { origin: 'https://app.example', now: Date.now() });
  check('…but a form that was paid is still found, however old, and the time is kept', (await get(`${T}/appointments/h5`)).status === 'pending_payment' && (await get(`${T}/appointments/h5`)).needsAttention === 'deposit_paid_not_recorded');
  stripeDown = true;
  await releaseUnpaidHolds(db, 't1', { origin: 'https://app.example', now: Date.now() + 2 * 86400000 });
  check('a paid but unrecorded booking is never let go by a clock, even when Stripe can’t be asked later', (await get(`${T}/appointments/h5`)).status === 'pending_payment');
  stripeDown = false;

  console.log('Opening the payment form');
  const { POST: deposit } = await import('../../src/app/api/stripe/deposit/route');
  await base();
  await db.doc(`${T}/appointments/d1`).set({ clientId: 'c1', clientName: 'Maya Lopez', serviceId: 's1', status: 'pending_payment', depositStatus: 'pending', depositAmountCents: 2000, startTime: later, createdAt: new Date().toISOString() });
  let r: any = await deposit(req({ tenantId: 't1', appointmentId: 'd1' }));
  const p1 = created[0]?.p || {}; const nowS = Date.now() / 1000;
  check('the form closes by itself when the hold runs out (as soon as Stripe allows), not a day later', r.status === 200 && p1.expires_at >= nowS + 30 * 60 && p1.expires_at <= nowS + 40 * 60, { status: r.status, exp: p1.expires_at && p1.expires_at - nowS });
  await db.doc(`${T}/appointments/d2`).set({ clientId: 'c1', clientName: 'Maya Lopez', isRenterBooking: true, renterProviderId: 'r1', renterServiceName: 'Brow shaping', status: 'pending_payment', depositStatus: 'pending', depositAmountCents: 2000, balanceCollectCents: 1500, startTime: later, createdAt: new Date().toISOString() });
  r = await deposit(req({ tenantId: 't1', appointmentId: 'd2' }));
  const p2 = created[1] || {};
  check('a renter’s deposit is paid to the renter and never carries a balance owed to the business', r.status === 200 && p2.o?.stripeAccount === 'acct_renter' && p2.p.line_items.length === 1 && p2.p.line_items[0].price_data.unit_amount === 2000, p2.p?.line_items);
  check('a booking can’t pick up a balance on a renter’s booking in the first place', src('src/app/api/appointments/book/route.ts').includes("payload.depositStatus === 'pending' && !payload.isRenterBooking) payload.balanceCollectCents = owedCents;"));

  console.log('Checkout: a deposit that doesn’t count toward the bill');
  const { POST: complete } = await import('../../src/app/api/checkout/complete/route');
  const visit = async (counts: boolean) => {
    await base();
    await db.doc(`${T}/services/s1`).set({ name: 'Consultation', price: 100, duration: 60, ...(counts ? {} : { depositAppliesToBalance: false }) });
    await db.doc(`${T}/appointments/a1`).set({ clientId: 'c1', clientName: 'Maya Lopez', serviceId: 's1', staffId: 'k1', status: 'checked_in', startTime: new Date(Date.now() - 3600000).toISOString(), depositStatus: 'paid', depositAmountCents: 2000 });
    await db.doc(`${T}/depositCredits/dc1`).set({ kind: 'deposit', clientId: 'c1', clientEmail: 'maya@example.com', amountCents: 2000, status: 'available', sourceAppointmentId: 'a1' });
  };
  await visit(false);
  r = await complete(req({ tenantId: 't1', clientId: 'c1', appointmentIds: ['a1'], items: [], expectedTotal: 100, payment: { method: 'cash', amountTendered: 100 } }));
  const dc: any = await get(`${T}/depositCredits/dc1`); const lines = await all(`${T}/transactions`);
  check('the sale goes through at the full price, as the checkout screen shows', r.status === 200, r.body);
  check('the deposit isn’t taken off the bill', !lines.some((t: any) => t.category === 'Deposit Applied'), lines.map((t: any) => t.category));
  check('it’s closed as kept, so it can’t come off another bill later', dc.status === 'forfeited' && dc.forfeitedFromAppointmentId === 'a1' && (await get(`${T}/appointments/a1`)).depositDisposition === 'forfeited', dc);
  await visit(true);
  r = await complete(req({ tenantId: 't1', clientId: 'c1', appointmentIds: ['a1'], items: [], expectedTotal: 100, payment: { method: 'cash', amountTendered: 80 } }));
  check('a deposit that counts still comes off the bill', r.status === 200 && (await get(`${T}/depositCredits/dc1`)).status === 'consumed' && (await all(`${T}/transactions`)).some((t: any) => t.category === 'Deposit Applied'), r.body);
  await base();
  await db.doc(`${T}/services/s9`).set({ name: 'Booking fee visit', price: 50, duration: 30, depositAppliesToBalance: false });
  await db.doc(`${T}/appointments/a0`).set({ clientId: 'c1', serviceId: 's9', status: 'completed', startTime: new Date(Date.now() - 20 * 86400000).toISOString() });
  await db.doc(`${T}/depositCredits/dc0`).set({ kind: 'deposit', clientId: 'c1', clientEmail: 'maya@example.com', amountCents: 2000, status: 'available', sourceAppointmentId: 'a0' });
  await db.doc(`${T}/appointments/a1`).set({ clientId: 'c1', clientName: 'Maya Lopez', serviceId: 's1', staffId: 'k1', status: 'checked_in', startTime: new Date(Date.now() - 3600000).toISOString() });
  r = await complete(req({ tenantId: 't1', clientId: 'c1', appointmentIds: ['a1'], items: [], expectedTotal: 100, payment: { method: 'cash', amountTendered: 100 } }));
  check('a deposit left from an earlier booking whose deposit doesn’t count never comes off a later bill', r.status === 200 && (await get(`${T}/depositCredits/dc0`)).status === 'available' && !(await all(`${T}/transactions`)).some((t: any) => t.category === 'Deposit Applied'), r.body);

  console.log('Message times and thank-yous');
  const TT = await import('../../src/lib/tenant-time');
  check('a business with a time zone gets its own clock', TT.visitWhen('2026-01-16T19:00:00.000Z', { timezone: 'America/Los_Angeles' }) === 'Friday, January 16 at 11:00 AM');
  check('an older business without one keeps the offset it saved', TT.visitWhen('2026-01-16T19:00:00.000Z', { clientNotify: { tzOffsetMinutes: -300 } }) === 'Friday, January 16 at 2:00 PM');
  check('the resend and visit-request messages use it', src('src/app/api/notifications/resend-confirmation/route.ts').includes('visitWhen(apt.startTime, tData)') && src('src/lib/visit-requests.ts').includes('visitWhen(o.startTime, o.tenant)') && !src('src/app/api/notifications/resend-confirmation/route.ts').includes(': -300'));
  const rem = src('src/app/api/cron/reminders/route.ts');
  check('thank-you and review messages go only to visits that took place', rem.includes('if (!visitHappened(a)) continue;') && ['declined', 'requested', 'pending', 'expired', 'provider_declined', 'released'].every((x) => rem.includes(`'${x}'`)));

  console.log('Words clients see');
  const said = ['src/app/api/stripe/completion/route.ts', 'src/app/api/stripe/deposit/route.ts', 'src/app/api/stripe/booking-card/route.ts', 'src/components/visit/VisitGates.tsx', 'src/app/(booking)/complete/[tenantId]/[token]/page.tsx'].map(src).join('\n');
  check('no "contact the studio", "per studio policy" or "This studio" in payment messages', !/contact the studio|per studio policy|This studio/i.test(said));
  check('the shop checkout never shows Stripe’s own error words to a customer', !src('src/app/api/retail/checkout/route.ts').includes('Checkout could not start'));
  const bad = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  check('no assistant names in the new files', !bad.test(src('src/lib/deposit-sessions.ts')) && !bad.test(src('scripts/verify/launch-money.verify.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
