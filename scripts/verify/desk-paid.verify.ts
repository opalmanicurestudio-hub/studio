// Checks deposits taken at the desk without a sale in the app (api/appointments/desk-deposit): paid in cash or on a card
// machine the app isn't connected to, the money is recorded as income (a Retainers line) with the deposit's credit, once,
// both named after the booking. Taken on the shop's card reader from the booking screen, the payment is checked with the
// card processor (this business, this booking's deposit, in person, gone through) and recorded by that payment with its
// income line, so it can be refunded to the card. A deposit on a sale still gets no second income line. The booking
// screen, the desk's booking sheet and the reader's payment all say which booking and how.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/desk-paid.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

let db = makeDb();
const actor: any = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false, caps: [] };
const sent: any[] = [];
// The card processor's payments, by id.
let pis: Record<string, any> = {};
const looked: any[] = [];
function StripeMock(this: any) {
  return { paymentIntents: { retrieve: async (id: string, _p: any, opts: any) => { looked.push({ id, opts }); if (!pis[id]) throw new Error('No such payment_intent'); return JSON.parse(JSON.stringify(pis[id])); } } };
}
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit') return { logAuditAdmin: async () => undefined };
  if (request === '@/lib/notify') return { sendNotification: async (_db: any, m: any) => { sent.push(m); return true; } };
  if (request === '@/lib/email-template') return { brandedEmailHtml: () => '<p>' };
  if (request === '@/lib/policy-copy') return { bookingPolicyLines: () => [], holdLine: () => '' };
  if (request === '@/lib/app-origin') return { linkOrigin: () => 'https://studio.test' };
  if (request === '@/lib/deposit-policy') return { graceHoursOf: () => 24 };
  if (request === '@/lib/message-policy') return { internalPost: async () => ({ ok: false, status: 500 }), internalOrigin: () => 'https://studio.test' };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://studio.test' } }) as any;
// Maya's gel set next Friday, waiting on a $25 deposit.
const visit = (x: any = {}) => ({ id: 'a1', tenantId: 't1', clientId: 'c1', clientName: 'Maya Lopez', clientEmail: 'maya@example.com', serviceName: 'Gel set', staffId: 's1',
  startTime: '2026-10-30T17:00:00.000Z', status: 'pending_payment', depositStatus: 'pending', depositAmountCents: 2500, checkInToken: 'tok1', ...x });
const fresh = async (x: any = {}) => {
  db = makeDb(); sent.length = 0; looked.length = 0; pis = {};
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com', outstandingBalance: 10 });
  await db.doc(`${T}/appointments/a1`).set(visit(x));
};
// A payment the reader took for this booking's deposit.
const readerPi = (id: string, x: any = {}) => { pis[id] = { id, status: 'succeeded', amount: 2500, amount_received: 2500, payment_method_types: ['card_present'], latest_charge: { id: `ch_${id}` },
  metadata: { tenantId: 't1', clientId: 'c1', source: 'terminal', appointmentId: 'a1', kind: 'deposit' }, ...x }; };

(async () => {
  const { POST: desk } = await import('../../src/app/api/appointments/desk-deposit/route');
  const { recordCardDeposit, depositCreditId } = await import('../../src/lib/deposit-record');
  const run = (body: any) => desk(req({ tenantId: 't1', appointmentId: 'a1', ...body })) as any;

  // ── Paid at the desk, no sale in the app ──
  await fresh({ balanceCollectCents: 1000 });
  let r = await run({ action: 'settled', amountCents: 2500, via: 'cash' });
  let a = await get(`${T}/appointments/a1`);
  let txns = await all(`${T}/transactions`);
  const line = txns.find((t: any) => t.category === 'Retainers');
  check('a $25 deposit paid in cash at the desk: the booking is paid and confirmed, with its $25 credit',
    r.body.ok && a.status === 'confirmed' && a.depositStatus === 'paid' && a.depositPaidVia === 'desk' && a.depositPaidMethod === 'Cash'
    && (await get(`${T}/depositCredits/deposit_desk_a1`))?.amountCents === 2500, { r: r.body, a });
  check('…and the $25 is in the books as deposit income, paid in cash, named after the booking',
    !!line && line.id === 'deposit_desk_a1' && line.type === 'income' && line.taxBucket === 'revenue' && line.amount === 25 && line.paymentMethod === 'Cash'
    && line.appointmentId === 'a1' && line.clientId === 'c1' && line.recordedBy === 'Kai Park', line);
  check('…and the $10 balance collected with it is in the books as the fee payment it is',
    txns.some((t: any) => t.category === 'Fee Recovery' && t.amount === 10 && t.paymentMethod === 'Cash') && (await get(`${T}/clients/c1`)).outstandingBalance === 0, txns);
  r = await run({ action: 'settled', amountCents: 2500, via: 'cash' });
  check('tapped again: nothing more is added (one credit, one income line)', r.body.ok && r.body.already && (await all(`${T}/transactions`)).filter((t: any) => t.category === 'Retainers').length === 1
    && (await all(`${T}/depositCredits`)).length === 1);

  await fresh();
  await db.doc(`${T}/appointments/a1`).set(visit({ balanceCollectCents: 1000 }));
  r = await run({ action: 'settled', amountCents: 2500, via: 'terminal', withBalance: false });
  txns = await all(`${T}/transactions`);
  check('taken on a card machine the app isn’t connected to: recorded as a card machine payment',
    r.body.ok && txns.find((t: any) => t.category === 'Retainers')?.paymentMethod === 'Card machine', txns);
  check('…and a balance the desk says it didn’t take stays owed (nothing recorded as collected)',
    !txns.some((t: any) => t.category === 'Fee Recovery') && (await get(`${T}/clients/c1`)).outstandingBalance === 10 && !(await get(`${T}/appointments/a1`)).balanceCollectedAt);

  await fresh();
  r = await run({ action: 'settled', amountCents: 2500 });
  check('no method given: it’s still income, as paid at the desk', r.body.ok && (await all(`${T}/transactions`)).find((t: any) => t.category === 'Retainers')?.paymentMethod === 'Paid at the desk');

  await fresh();
  r = await run({ action: 'settled', amountCents: 9900, via: 'cash' });
  check('never more than the booking’s deposit', r.body.ok && (await get(`${T}/depositCredits/deposit_desk_a1`))?.amountCents === 2500 && (await all(`${T}/transactions`)).find((t: any) => t.category === 'Retainers')?.amount === 25);

  // ── A deposit on today's sale: the sale wrote the income ──
  await fresh();
  r = await run({ action: 'settled', amountCents: 2500, receiptId: 'r9', paidMethod: 'card' });
  check('a deposit paid on a sale gets its credit and no second income line (the sale recorded the money)',
    r.body.ok && (await get(`${T}/depositCredits/deposit_r9_a1`))?.amountCents === 2500 && !(await all(`${T}/transactions`)).some((t: any) => t.category === 'Retainers')
    && (await get(`${T}/appointments/a1`)).depositPaidVia === 'checkout', await all(`${T}/transactions`));

  // ── On the shop's card reader ──
  await fresh();
  readerPi('pi_r1');
  r = await run({ action: 'reader', paymentIntentId: 'pi_r1' });
  a = await get(`${T}/appointments/a1`);
  const cr = await get(`${T}/depositCredits/${depositCreditId('pi_r1')}`);
  txns = await all(`${T}/transactions`);
  check('the reader’s payment is checked with the card processor, on this business’s account', looked[0]?.id === 'pi_r1' && looked[0]?.opts?.stripeAccount === 'acct_1');
  check('a $25 deposit on the card reader: the booking is paid and confirmed, and its credit carries the payment (so it can be refunded)',
    r.body.ok && !r.body.already && a.status === 'confirmed' && a.depositStatus === 'paid' && a.depositPaidVia === 'card_reader' && a.depositStripePaymentIntentId === 'pi_r1'
    && cr?.amountCents === 2500 && cr.stripePaymentIntentId === 'pi_r1' && cr.stripeChargeId === 'ch_pi_r1' && cr.sourceAppointmentId === 'a1', { r: r.body, a, cr });
  const rl = txns.find((t: any) => t.category === 'Retainers');
  check('…and the $25 is in the books as deposit income on the card reader, with the payment (so the card fee matches it)',
    !!rl && rl.id === 'reader_deposit__pi_r1' && rl.amount === 25 && rl.paymentMethod === 'Card reader' && rl.taxBucket === 'revenue' && rl.stripeChargeId === 'ch_pi_r1' && rl.stripePaymentIntentId === 'pi_r1', rl);
  r = await run({ action: 'reader', paymentIntentId: 'pi_r1' });
  check('recorded again (a retry): nothing more is added', r.body.ok && r.body.already && (await all(`${T}/transactions`)).filter((t: any) => t.category === 'Retainers').length === 1 && (await all(`${T}/depositCredits`)).length === 1);

  await fresh();
  readerPi('pi_r2', { amount: 3500, amount_received: 3500 });
  await db.doc(`${T}/appointments/a1`).set(visit({ balanceCollectCents: 1000 }));
  r = await run({ action: 'reader', paymentIntentId: 'pi_r2' });
  txns = await all(`${T}/transactions`);
  check('$35 on the reader for a $25 deposit and a $10 balance: $25 is the deposit (and its credit), $10 the fee payment',
    r.body.ok && (await get(`${T}/depositCredits/${depositCreditId('pi_r2')}`))?.amountCents === 2500 && txns.find((t: any) => t.category === 'Retainers')?.amount === 25
    && txns.find((t: any) => t.category === 'Fee Recovery')?.amount === 10 && txns.find((t: any) => t.category === 'Fee Recovery')?.paymentMethod === 'Card reader', txns);

  const refused = async (label: string, x: any, status: number) => {
    await fresh(); readerPi('pi_x', x);
    const res = await run({ action: 'reader', paymentIntentId: 'pi_x' });
    check(label, !res.body.ok && res.status === status && !(await all(`${T}/depositCredits`)).length && !(await all(`${T}/transactions`)).length && (await get(`${T}/appointments/a1`)).depositStatus === 'pending', { res, status });
  };
  await refused('another business’s payment is refused, and nothing is recorded', { metadata: { tenantId: 't2', appointmentId: 'a1', kind: 'deposit' } }, 403);
  await refused('a payment for another booking is refused', { metadata: { tenantId: 't1', appointmentId: 'a2', kind: 'deposit' } }, 409);
  await refused('a payment from a sale (not taken for this deposit) is refused', { metadata: { tenantId: 't1', source: 'terminal' } }, 409);
  await refused('a payment that didn’t go through is refused', { status: 'requires_payment_method' }, 402);
  await refused('a payment that wasn’t taken in person is refused', { payment_method_types: ['card'] }, 400);
  await fresh();
  r = await run({ action: 'reader', paymentIntentId: 'pi_missing' });
  check('a payment the processor can’t find isn’t recorded, and says it won’t be charged twice', !r.body.ok && r.status === 502 && /won’t be charged twice/.test(r.body.error) && !(await all(`${T}/depositCredits`)).length);
  await fresh();
  r = await run({ action: 'reader', paymentIntentId: 'not-a-payment' });
  check('a malformed payment id is refused before asking anyone', !r.body.ok && r.status === 400 && !looked.length);

  // Paid by link while the card was on the reader: both are kept, and the booking is flagged.
  await fresh({ depositStatus: 'paid', status: 'confirmed', depositStripePaymentIntentId: 'pi_link' });
  readerPi('pi_r3');
  r = await run({ action: 'reader', paymentIntentId: 'pi_r3' });
  check('a reader payment for a deposit already paid another way is still recorded (the money came in), and flagged to refund one',
    r.body.ok && r.body.paidTwice && (await get(`${T}/depositCredits/${depositCreditId('pi_r3')}`))?.amountCents === 2500 && (await get(`${T}/appointments/a1`)).needsAttention === 'deposit_paid_twice'
    && (await all(`${T}/transactions`)).filter((t: any) => t.category === 'Retainers').length === 1, r.body);

  // A card payment recorded for one booking is never moved onto another.
  await fresh();
  await db.doc(`${T}/appointments/a2`).set(visit({ id: 'a2' }));
  await recordCardDeposit(db, 't1', 'a1', { cents: 2500, paymentIntentId: 'pi_shared', via: 'card_on_file' });
  const moved: any = await recordCardDeposit(db, 't1', 'a2', { cents: 2500, paymentIntentId: 'pi_shared', via: 'card_on_file' });
  check('a card payment already recorded for one booking can’t be recorded for another', !moved.ok && (await get(`${T}/appointments/a2`)).depositStatus === 'pending', moved);

  // ── The screens say which booking and how ──
  const src = (p: string) => fs.readFileSync(p, 'utf8');
  const dialog = src('src/components/planner/AddAppointmentDialog.tsx');
  check('the booking screen takes the reader’s payment for this booking’s deposit, then has the server record it',
    /collectPayment\(\{[\s\S]{0,300}?appointmentId: out\.appointmentId, kind: 'deposit' \}\)/.test(dialog) && /action: 'reader', paymentIntentId: paid\.paymentIntentId/.test(dialog));
  check('…checks the reader is connected before anything is booked', /viaReader && !\['connected', 'busy'\]\.includes/.test(dialog) && dialog.indexOf("viaReader && !['connected'") < dialog.indexOf("fetch('/api/appointments/book'"));
  check('…and a deposit paid at the desk says how it was paid', /action === 'settled' \? \{ amountCents: Math\.round\(depositDetails\.amount \* 100\), via: deskVia, withBalance: true \}/.test(dialog) && !/New card at terminal/.test(dialog));
  check('the reader’s payment carries the booking it was taken for', /appointmentId: forBooking, kind: purpose/.test(src('src/app/api/stripe/terminal/create-payment-intent/route.ts')));
  check('the desk’s booking sheet says how a deposit paid at the desk came in', /action === 'settled' \? \{ via: depVia \} : \{\}/.test(src('src/components/pos/desk/StaffBookSheet.tsx')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
