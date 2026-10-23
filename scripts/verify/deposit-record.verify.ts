// Checks deposits charged to a saved card (lib/deposit-record, api/appointments/desk-deposit, api/stripe/charge-card,
// api/stripe/deposit-refund). The server charges the card and records the deposit once: the visit is marked paid and
// the deposit's credit (what comes off the bill at checkout) is named after the card payment, so a second tap, a second
// device or a retry can never add it twice. One charge at a time per booking; an attempt whose answer was lost is asked
// about again rather than charged again; a new attempt after a decline really tries the card. A deposit paid on a sale
// gets one credit per sale and never more than the booking's deposit. The visit screen asks the server instead of
// writing credit, and the rules no longer let a browser add credit marked as a deposit. Every route that charges a
// deposit to a saved card records it the same way, and a deposit refund gives back only the deposit.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/deposit-record.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

let db = makeDb();
const actor: any = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false, caps: [] };
// What the card processor says next, and every charge asked for.
let next: any[] = [];
const charges: any[] = [];
const sent: any[] = [];
const internalPost = async (_origin: string, path: string, body: any) => {
  charges.push({ path, body });
  const r = next.shift() || { ok: true, status: 200, data: { ok: true, paymentIntentId: `pi_${charges.length}`, chargeId: `ch_${charges.length}` } };
  return r;
};
const intents: any[] = [];
const refunds: any[] = [];
function StripeMock(this: any) {
  return {
    paymentIntents: { create: async (params: any, opts: any) => { intents.push({ params, opts }); return { id: `pi_s${intents.length}`, status: 'succeeded', latest_charge: `ch_s${intents.length}`, client_secret: 'x' }; } },
    refunds: { create: async (params: any, opts: any) => { refunds.push({ params, opts }); return { id: `re_${refunds.length}` }; } },
  };
}
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ deny: null }) };
  if (request === '@/lib/audit') return { logAuditAdmin: async () => undefined };
  if (request === '@/lib/notify') return { sendNotification: async (_db: any, m: any) => { sent.push(m); return true; } };
  if (request === '@/lib/email-template') return { brandedEmailHtml: () => '<p>' };
  if (request === '@/lib/policy-copy') return { bookingPolicyLines: () => [], holdLine: () => '' };
  if (request === '@/lib/app-origin') return { linkOrigin: () => 'https://studio.test' };
  if (request === '@/lib/deposit-policy') return { graceHoursOf: () => 24, computeDepositCents: () => 0, isPoorHistory: () => false };
  if (request === '@/lib/message-policy') return { internalPost, internalOrigin: () => 'https://studio.test' };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, nextUrl: { origin: 'https://studio.test' } }) as any;
// Maya's gel set next Friday, waiting on a $25 deposit; her card is on file.
const visit = (x: any = {}) => ({ id: 'a1', tenantId: 't1', clientId: 'c1', clientName: 'Maya Lopez', serviceName: 'Gel set', startTime: '2026-10-30T17:00:00.000Z',
  status: 'pending_payment', depositStatus: 'pending', depositAmountCents: 2500, checkInToken: 'tok1', ...x });
const fresh = async (x: any = {}) => {
  db = makeDb(); next = []; charges.length = 0; sent.length = 0; intents.length = 0; refunds.length = 0;
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'Maya@Example.com', cardOnFile: { customerId: 'cus_1', paymentMethodId: 'pm_1', brand: 'Visa', last4: '4242' } });
  await db.doc(`${T}/appointments/a1`).set(visit(x));
};

(async () => {
  const { recordCardDeposit, depositCreditId } = await import('../../src/lib/deposit-record');
  const { POST: desk } = await import('../../src/app/api/appointments/desk-deposit/route');
  const charge = (id = 'a1') => desk(req({ tenantId: 't1', appointmentId: id, action: 'charge' })) as any;

  // ── The recorder ──
  await fresh();
  let rec: any = await recordCardDeposit(db, 't1', 'a1', { cents: 2500, paymentIntentId: 'pi_A', chargeId: 'ch_A', via: 'card_on_file', clientEmail: 'Maya@Example.com' });
  let a = await get(`${T}/appointments/a1`);
  let cr = await get(`${T}/depositCredits/${depositCreditId('pi_A')}`);
  check('a $25 deposit charged to her card: the visit is paid and confirmed, and its $25 credit is named after the payment',
    rec.ok && !rec.already && a.status === 'confirmed' && a.depositStatus === 'paid' && a.depositStripePaymentIntentId === 'pi_A' && cr?.amountCents === 2500 && cr.status === 'available'
    && cr.sourceAppointmentId === 'a1' && cr.clientId === 'c1' && cr.clientEmail === 'maya@example.com' && cr.stripePaymentIntentId === 'pi_A' && cr.stripeChargeId === 'ch_A', { rec, a, cr });
  check('…and the visit link shows it paid', (await get('appointmentCheckIns/tok1'))?.depositStatus === 'paid');
  rec = await recordCardDeposit(db, 't1', 'a1', { cents: 2500, paymentIntentId: 'pi_A', via: 'card_on_file' });
  check('…recorded again (a retry): nothing more is added', rec.ok && rec.already && (await all(`${T}/depositCredits`)).length === 1, rec);
  await fresh({ status: 'cancelled' });
  rec = await recordCardDeposit(db, 't1', 'a1', { cents: 2500, paymentIntentId: 'pi_B', via: 'card_on_file' });
  a = await get(`${T}/appointments/a1`);
  check('the hold was released before the payment went through: the booking stays released and is flagged, and the money is kept as credit',
    rec.ok && rec.released && a.status === 'cancelled' && a.needsAttention === 'deposit_paid_after_hold_released' && (await get(`${T}/depositCredits/deposit_pi_B`))?.amountCents === 2500, { rec, a });

  // ── Charging at the desk ──
  await fresh();
  let r = await charge();
  a = await get(`${T}/appointments/a1`);
  let credits = await all(`${T}/depositCredits`);
  check('Collect: the server charges $25 to her card, marks the visit paid and confirmed, and adds one $25 credit tied to the payment',
    r.status === 200 && r.body.ok && r.body.depositCents === 2500 && r.body.chargedCents === 2500 && charges.length === 1 && charges[0].body.amountCents === 2500 && charges[0].body.kind === 'deposit'
    && a.depositStatus === 'paid' && a.status === 'confirmed' && !a.depositChargeLock && credits.length === 1 && credits[0].id === 'deposit_pi_1' && credits[0].stripePaymentIntentId === 'pi_1' && credits[0].clientEmail === 'maya@example.com', { r: r.body, a, credits });
  // (The message goes through the real sender here, which logs every send.)
  const logged = [...db._store.entries()].filter(([, d]: any) => d?.kind === 'desk_booking_confirmed');
  check('…and Maya hears her visit is confirmed', sent.some((m) => m.kind === 'desk_booking_confirmed') || logged.length > 0, [...db._store.keys()].filter((k: string) => !k.includes('/appointments/')).slice(0, 20));
  r = await charge();
  check('…tapped again: nothing is charged and nothing is added', r.body.ok && r.body.already && charges.length === 1 && (await all(`${T}/depositCredits`)).length === 1, r.body);

  // Two devices at once: the second waits for the first.
  await fresh({ depositChargeLock: { at: new Date().toISOString(), by: 'Ava' } });
  r = await charge();
  check('another device is charging this deposit right now: nothing is charged here', r.status === 409 && r.body.code === 'in_progress' && charges.length === 0, r.body);
  await fresh({ depositChargeLock: { at: new Date(Date.now() - 5 * 60_000).toISOString(), by: 'Ava' } });
  r = await charge();
  check('…a hold left from minutes ago doesn’t block a new attempt', r.body.ok && charges.length === 1, r.body);

  // A decline, then a real second try.
  await fresh();
  next = [{ ok: true, status: 200, data: { ok: false, reason: 'Your card has insufficient funds.', code: 'card_declined', declineCode: 'insufficient_funds' } }];
  r = await charge();
  a = await get(`${T}/appointments/a1`);
  check('the card is declined: the reason is shown, nothing is recorded, and the hold is lifted',
    r.status === 402 && /insufficient funds/.test(r.body.error) && r.body.declineCode === 'insufficient_funds' && !a.depositChargeLock && a.depositStatus === 'pending' && !(await all(`${T}/depositCredits`)).length, { r: r.body, a });
  await new Promise((res) => setTimeout(res, 5));
  r = await charge();
  check('…she adds funds and the desk tries again: it’s a new attempt with its own key, so the card is really tried again',
    r.body.ok && charges.length === 2 && charges[0].body.idempotencyKey !== charges[1].body.idempotencyKey && /^dep_a1_2500_/.test(charges[1].body.idempotencyKey), charges.map((c) => c.body.idempotencyKey));

  // The answer is lost: the next attempt asks about the same charge.
  await fresh();
  next = [{ ok: false, status: 0, data: {}, transportError: 'timeout' }];
  r = await charge();
  a = await get(`${T}/appointments/a1`);
  check('no answer from the card processor: the desk is told it couldn’t be confirmed, and the attempt is remembered',
    r.status === 502 && r.body.code === 'unconfirmed' && a.depositChargeLock?.unknown === true && a.depositChargeLock?.key === charges[0].body.idempotencyKey && a.depositStatus === 'pending', { r: r.body, a });
  r = await charge();
  check('…trying again uses the same key, so a charge that did go through is answered with that charge, not made twice',
    r.body.ok && charges.length === 2 && charges[1].body.idempotencyKey === charges[0].body.idempotencyKey && (await all(`${T}/depositCredits`)).length === 1, charges.map((c) => c.body.idempotencyKey));
  await fresh();
  next = [{ ok: false, status: 400, data: { error: 'Missing tenantId, clientId, or amountCents' } }];
  r = await charge();
  check('a plain refusal (not a lost answer) lifts the hold rather than remembering the attempt', r.status === 402 && !(await get(`${T}/appointments/a1`)).depositChargeLock, r.body);

  // Charged before but never recorded; taken already some other way.
  await fresh({ depositStatus: 'paid', status: 'confirmed', depositStripePaymentIntentId: 'pi_9' });
  r = await charge();
  check('a card payment on the visit that was never recorded: it’s recorded now, without charging again',
    r.body.ok && charges.length === 0 && (await get(`${T}/depositCredits/deposit_pi_9`))?.amountCents === 2500, r.body);
  await fresh();
  await db.doc(`${T}/depositCredits/old1`).set({ amountCents: 2500, status: 'available', sourceAppointmentId: 'a1', clientId: 'c1' });
  r = await charge();
  check('the deposit’s credit is already here (paid another way): nothing is charged, and the visit is marked paid',
    r.body.ok && r.body.already && charges.length === 0 && (await get(`${T}/appointments/a1`)).depositStatus === 'paid' && (await all(`${T}/depositCredits`)).length === 1, r.body);
  await fresh({ depositStatus: 'paid', status: 'confirmed', depositStripePaymentIntentId: 'pi_7' });
  await db.doc(`${T}/depositCredits/browser1`).set({ amountCents: 2500, status: 'available', sourceAppointmentId: 'a1', clientId: 'c1', stripeChargeId: 'pi_7' });
  r = await charge();
  check('…a deposit recorded the old way (from the visit screen) isn’t given a second credit', r.body.ok && charges.length === 0 && (await all(`${T}/depositCredits`)).length === 1, r.body);

  // A balance taken with the deposit.
  await fresh({ balanceCollectCents: 1000 });
  await db.doc(`${T}/clients/c1`).set({ outstandingBalance: 10 }, { merge: true });
  r = await charge();
  credits = await all(`${T}/depositCredits`);
  check('a $10 balance collected with the deposit: one $35 charge, the credit is the $25 deposit only, and the balance is cleared',
    r.body.ok && charges[0].body.amountCents === 3500 && r.body.chargedCents === 3500 && credits.length === 1 && credits[0].amountCents === 2500
    && (await get(`${T}/appointments/a1`)).balanceCollectedCents === 1000 && (await get(`${T}/clients/c1`)).outstandingBalance === 0, { r: r.body, credits });

  // ── Paid on a sale ──
  await fresh();
  const settle = (x: any) => desk(req({ tenantId: 't1', appointmentId: 'a1', action: 'settled', ...x })) as any;
  r = await settle({ amountCents: 2500, receiptId: 'rcpt1', paidMethod: 'cash' });
  check('the deposit paid on today’s sale: one credit for that sale and visit',
    r.body.ok && (await get(`${T}/depositCredits/deposit_rcpt1_a1`))?.amountCents === 2500 && (await get(`${T}/appointments/a1`)).depositReceiptId === 'rcpt1', r.body);
  await db.doc(`${T}/appointments/a1`).set({ depositStatus: 'pending' }, { merge: true });
  r = await settle({ amountCents: 2500, receiptId: 'rcpt1' });
  check('…the same sale sent again (even with the visit reset): no second credit', r.body.already && (await all(`${T}/depositCredits`)).length === 1, r.body);
  await fresh();
  r = await settle({ amountCents: 900000 });
  check('a deposit marked paid at the desk for $9,000: never more than the booking’s $25 deposit, and one credit per booking',
    r.body.ok && (await get(`${T}/depositCredits/deposit_desk_a1`))?.amountCents === 2500 && (await all(`${T}/depositCredits`)).length === 1, r.body);

  // ── The card charge itself ──
  process.env.CRON_SECRET = 'sec';
  const { POST: chargeCard } = await import('../../src/app/api/stripe/charge-card/route');
  await fresh();
  const cc = (x: any) => chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 2500, appointmentId: 'a1', mode: 'auto', kind: 'deposit', ...x }, { 'x-cf-internal': 'sec' })) as any;
  r = await cc({ category: 'Retainers', idempotencyKey: 'dep_a1_2500_123' });
  check('the caller’s key for this attempt is the one the card processor gets, and the charge’s id comes back',
    r.body.ok && intents[0].opts.idempotencyKey === 'dep_a1_2500_123' && r.body.chargeId === 'ch_s1' && r.body.paymentIntentId === 'pi_s1', { r: r.body, o: intents[0]?.opts });
  r = await cc({ category: 'Retainers' });
  const r2 = await cc({ category: 'Cancellation Fees' });
  check('a $25 deposit and a $25 late-cancel fee on the same visit are two charges, not one answered twice',
    r.body.ok && r2.body.ok && intents[1].opts.idempotencyKey === 'fee_a1_2500_retainers' && intents[2].opts.idempotencyKey === 'fee_a1_2500_cancellation-fees', intents.map((i) => i.opts.idempotencyKey));

  // ── A deposit refund gives back the deposit only ──
  const { POST: refund } = await import('../../src/app/api/stripe/deposit-refund/route');
  await fresh();
  await db.doc(`${T}/depositCredits/deposit_pi_5`).set({ amountCents: 2500, status: 'available', kind: 'deposit', sourceAppointmentId: 'a1', stripePaymentIntentId: 'pi_5', clientName: 'Maya Lopez' });
  r = await refund(req({ tenantId: 't1', creditId: 'deposit_pi_5' })) as any;
  check('refunding a deposit taken with a $10 balance in one charge: $25 goes back, not the whole $35',
    r.body.ok && refunds[0].params.amount === 2500 && refunds[0].params.payment_intent === 'pi_5' && (await get(`${T}/depositCredits/deposit_pi_5`)).status === 'refunded', { r: r.body, p: refunds[0]?.params });
  await db.doc(`${T}/depositCredits/sc_ret1`).set({ amountCents: 2500, status: 'available', kind: 'store_credit', stripePaymentIntentId: 'pi_6', clientName: 'Maya Lopez' });
  r = await refund(req({ tenantId: 't1', creditId: 'sc_ret1' })) as any;
  check('store credit (from a return) isn’t sent back to a card as a deposit', r.status === 409 && refunds.length === 1 && (await get(`${T}/depositCredits/sc_ret1`)).status === 'available', r.body);
  await db.doc(`${T}/depositCredits/deposit_pi_7`).set({ amountCents: 2500, usedCents: 1000, status: 'available', kind: 'deposit', sourceAppointmentId: 'a1', stripePaymentIntentId: 'pi_7', clientName: 'Maya Lopez' });
  r = await refund(req({ tenantId: 't1', creditId: 'deposit_pi_7' })) as any;
  check('a deposit $10 of which was used at the desk: the $15 left goes back', r.body.ok && refunds[1]?.params.amount === 1500, { r: r.body, p: refunds[1]?.params });

  // ── Nothing in a browser writes deposit credit ──
  const src = (p: string) => fs.readFileSync(p, 'utf8');
  const sheet = src('src/components/planner/AppointmentDetailsSheet.tsx');
  const handler = (sheet.match(/const handleCollectDepositNow = async \(\) => \{[\s\S]*?\n  \};/) || [''])[0];
  check('the visit screen’s Collect asks the server, and writes no credit itself',
    !!handler && /\/api\/appointments\/desk-deposit/.test(handler) && /action: 'charge'/.test(handler) && !/depositCredits/.test(handler) && !/charge-card/.test(handler) && !/writeBatch/.test(handler), handler.slice(0, 200));
  const rules = src('firestore.rules');
  const creditRule = (rules.match(/match \/tenants\/\{tenantId\}\/depositCredits\/\{creditId\} \{[\s\S]*?\n    \}/) || [''])[0];
  check('the rules don’t let a browser add credit marked as a deposit or a card payment (a goodwill credit is still fine)',
    /hasAny\(\[[^\]]*'sourceAppointmentId'[^\]]*'stripePaymentIntentId'[^\]]*'stripeChargeId'[^\]]*'checkoutSessionId'[^\]]*\]\)/.test(creditRule) && /staffCreditCapCents/.test(creditRule), creditRule);
  check('the support desk’s goodwill credit carries none of those marks', !/sourceAppointmentId|stripePaymentIntentId|stripeChargeId|checkoutSessionId/.test((src('src/app/(app)/retail-orders/support/page.tsx').match(/addDoc\(collection\(firestore as Firestore, `tenants\/\$\{tenantId\}\/depositCredits`\), \{[\s\S]*?\}\);/) || ['x'])[0]));
  check('approvals, group bookings and the nightly retry record a charged deposit through the server recorder',
    ['src/app/api/appointments/decide/route.ts', 'src/app/api/appointments/party/route.ts', 'src/lib/retail-sweeps.ts'].every((p) => /recordCardDepositSafely\(/.test(src(p))));
  check('…and instant and phone bookings add its credit with the booking', ['src/lib/booking/create-booking.ts', 'src/app/api/voice/create-booking/route.ts'].every((p) => /cardDepositCredit\(/.test(src(p)) && /depositCredits\/\$\{dc\.id\}/.test(src(p))));
  check('the nightly retry is a real second try (its own key), not a replay of the first decline', /idempotencyKey: `dep_retry_\$\{d\.id\}_\$\{attempts \+ 1\}`/.test(src('src/lib/retail-sweeps.ts')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
