// Checks the money on a day or hourly booking after it's booked (api/booths/reserve, lib/booth-money):
// - The balance on a booking with a deposit: charged to the saved card once (two taps, one charge, one line), with the
//   guest sent a receipt once; a declined card leaves it to take again; taken in person at the desk instead.
// - Refunds in parts: part of what was paid, then more later, each its own numbered refund and line; never more than
//   is left; a part refund on a booking that stands leaves it standing; the last of it, or any refund on a booking being
//   called off, closes it. A lost answer finishes that same refund, by its number.
// - A booking paid with prepaid days, called off: the days go back to the pack, once; not after the stay began.
// - The five-minute check records a balance whose answer was lost.
// - The guest's receipt shows refunds; the guest's own page lists every line; the message they're sent says what moved
//   and links to their booking, once per thing that happened, by text when there's no email.
// - The desk: the business's charge types (not a blank list), the balance, refund and move panels are there.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/stay-money.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
let db: any = strictTransactions(makeDb());
let notices: any[] = []; let charges: any[] = []; let refunds: any[] = []; const keys = new Map<string, any>(); let piCalls = 0; let rfCalls = 0;
let mode: 'ok' | 'lost_after' | 'decline' = 'ok';
let sent: any[] = [];
const lost = () => { const e: any = new Error('connection reset'); e.type = 'StripeConnectionError'; return e; };
function StripeMock(this: any) {
  return {
    paymentIntents: {
      create: async (p: any, o: any) => {
        piCalls++;
        if (mode === 'decline') { const e: any = new Error('Your card was declined.'); e.type = 'StripeCardError'; throw e; }
        let pi = keys.get(o?.idempotencyKey);
        if (!pi) { pi = { id: `pi_${charges.length + 1}`, status: 'succeeded', amount: p.amount, metadata: p.metadata, customer: p.customer, created: Math.floor(Date.now() / 1000), latest_charge: { id: `ch_${charges.length + 1}`, balance_transaction: { fee: 59 } } }; charges.push(pi); if (o?.idempotencyKey) keys.set(o.idempotencyKey, pi); }
        if (mode === 'lost_after') { mode = 'ok'; throw lost(); }
        return pi;
      },
      retrieve: async (id: string) => charges.find((c) => c.id === id) || { id, latest_charge: { id: 'ch_x', balance_transaction: { fee: 120 } } },
      list: async (q: any) => ({ data: charges.filter((c) => c.customer === q.customer) }),
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
  if (request === '@/lib/route-guard') return { requireCan: async () => ({ actor: { uid: 'm1', name: 'Ana Ruiz', role: 'manager' } }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (request === '@/lib/reservation-notify') return { sendReservationConfirmation: async () => undefined, sendStayMoneyNotice: async (_db: any, _t: any, _id: any, n: any) => { notices.push(n); } };
  if (request === './notify') return { sendNotification: async (_db: any, x: any) => { sent.push(x); return { ok: true }; } };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, url: 'https://biz.test/api/booths/reserve', headers: { get: () => null }, nextUrl: { origin: 'https://biz.test' } }) as any;
let R0: () => any = () => require('../../src/lib/stay-receipt');
const lines = async (cat?: string) => (await all(`${T}/transactions`)).filter((x: any) => !cat || x.category === cat);
const booking = (x: any = {}) => ({ id: 'r1', status: 'confirmed', name: 'Lena Cho', email: 'lena@example.com', boothName: 'Room 2', bookingType: 'daily', startDate: '2026-11-20', endDate: '2026-11-20', numDays: 1,
  originalAmountCents: 10000, netDueCents: 10000, amountCents: 3000, depositCents: 3000, balanceDueCents: 7000, balancePaid: false,
  stripePaymentIntentId: 'pi_book', stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', cardOnFile: true, ...x });
const fresh = async (x: any = {}) => {
  db = strictTransactions(makeDb()); charges = []; refunds = []; keys.clear(); piCalls = 0; rfCalls = 0; mode = 'ok'; notices = []; sent = [];
  await db.doc(T).set({ name: 'North Loft', timezone: 'America/New_York' });
  await db.doc(`${T}/boothReservations/r1`).set(booking(x));
};

(async () => {
  const { PUT, PATCH } = await import('../../src/app/api/booths/reserve/route');
  const balance = () => PUT(req({ tenantId: 't1', reservationId: 'r1', action: 'balance' })) as any;
  const refund = (x: any = {}) => PATCH(req({ tenantId: 't1', reservationId: 'r1', ...x })) as any;

  console.log('the balance');
  await fresh();
  let rs: any[] = await Promise.all([balance(), balance()]);
  let res = await get(`${T}/boothReservations/r1`);
  check('two taps at once: the balance charged once, one line, the booking paid', charges.length === 1 && charges[0].amount === 7000 && charges[0].metadata.kind === 'booth_balance' && (await lines()).filter((l: any) => l.id === 'boothbal_r1').length === 1
    && res.balancePaid === true && res.balancePaidVia === 'card' && res.balanceChargedCents === 7000 && !res.balanceClaimAt, rs.map((x) => x.body));
  check('…its fee is in the books, and the guest is sent a receipt for it, once', (await lines()).some((l: any) => l.id === 'boothbalfee_r1') && notices.filter((n) => n.key === 'balance').length === 1 && notices[0].kind === 'charge' && notices[0].cents === 7000, notices);
  let r: any = await balance();
  check('…asked again: done already, nothing charged', r.body.ok && r.body.already && charges.length === 1);
  await fresh(); mode = 'decline';
  r = await balance(); res = await get(`${T}/boothReservations/r1`);
  check('the card says no: nothing recorded, still to pay, and it can be asked again', r.status === 402 && !res.balancePaid && !res.balanceStatus && !(await lines()).length && /in person/.test(r.body.error), r.body);
  await fresh({ stripeCustomerId: null, stripePaymentMethodId: null, cardOnFile: false });
  r = await balance();
  check('no saved card: refused, to take in person', r.status === 400 && /in person/.test(r.body.error) && piCalls === 0, r.body);
  await fresh(); mode = 'lost_after';
  r = await balance(); res = await get(`${T}/boothReservations/r1`);
  check('the answer lost: it says to try again, and the balance is held', r.status === 502 && res.balanceStatus === 'charging', r.body);
  await db.doc(`${T}/boothReservations/r1`).set({ balanceClaimAt: new Date(Date.now() - 20 * 60000).toISOString() }, { merge: true });
  const BM = await import('../../src/lib/booth-money');
  const sweep = await BM.settleLostBoothMoney(db, 't1', {}, { stripe: new (StripeMock as any)(), now: Date.now() });
  res = await get(`${T}/boothReservations/r1`);
  check('…nobody asks again: the five-minute check finds the charge and records it, once', sweep.recorded === 1 && res.balancePaid === true && charges.length === 1 && (await lines()).filter((l: any) => l.id === 'boothbal_r1').length === 1, sweep);
  check('…and the guest gets their receipt from the check', notices.some((n) => n.key === 'balance' && n.cents === 7000), notices);
  const SS = await import('../../src/lib/space-stripe');
  check('the payments notice doesn’t write a second fee for a balance (it writes its own)', SS.SPACE_OWN_FEE_KINDS.has('booth_balance'));

  console.log('refunds in parts');
  await fresh({ status: 'completed', amountCents: 10000, depositCents: 0, balanceDueCents: 0, balancePaid: false });
  r = await refund({ amountCents: 2000, reason: 'Heater was out' });
  res = await get(`${T}/boothReservations/r1`);
  check('part of it: refunded, its line, the booking stands', r.body.ok && r.body.closed === false && res.status === 'completed' && res.refundedCents === 2000 && refunds.length === 1 && refunds[0].amount === 2000 && refunds[0].metadata.seq === '1'
    && (await lines('Refunds')).map((l: any) => l.id).join() === 'boothrefund_r1', { body: r.body, res });
  check('…the guest is told, with the reason', notices.some((n) => n.kind === 'refund' && n.cents === 2000 && n.what === 'Heater was out' && n.key === 'refund_1'), notices);
  r = await refund({ amountCents: 1000 });
  res = await get(`${T}/boothReservations/r1`);
  check('more later: a second refund, numbered, its own line', r.body.ok && res.refundedCents === 3000 && refunds.length === 2 && refunds[1].metadata.seq === '2' && (await lines('Refunds')).map((l: any) => l.id).sort().join() === 'boothrefund_r1,boothrefund_r1_2' && res.status === 'completed', res);
  r = await refund({ amountCents: 9000 });
  check('never more than is left', r.status === 400 && /\$70\.00/.test(r.body.error) && refunds.length === 2, r.body);
  r = await refund();
  res = await get(`${T}/boothReservations/r1`);
  check('the rest of it: refunded, and the booking closes', r.body.ok && r.body.refundedCents === 7000 && res.status === 'refunded' && res.refundedCents === 10000 && (await lines('Refunds')).length === 3, res);
  r = await refund();
  check('…nothing more after that', r.body.alreadyRefunded && refunds.length === 3);

  await fresh({ status: 'cancel_requested', amountCents: 10000, depositCents: 0, balanceDueCents: 0 });
  r = await refund({ amountCents: 8000, reason: 'Called off late' });
  res = await get(`${T}/boothReservations/r1`);
  check('a booking being called off: a part refund closes it, the rest kept as a fee', r.body.closed === true && res.status === 'refunded' && res.refundedCents === 8000, res);

  await fresh({ status: 'completed', amountCents: 10000, depositCents: 0, balanceDueCents: 0 });
  await refund({ amountCents: 2000 });
  mode = 'lost_after';
  r = await refund({ amountCents: 3000 });
  check('a second refund whose answer is lost: try again', r.status === 502, r.body);
  await db.doc(`${T}/boothReservations/r1`).set({ refundClaimAt: new Date(Date.now() - 5 * 60000).toISOString() }, { merge: true });
  r = await refund({ amountCents: 500 });
  res = await get(`${T}/boothReservations/r1`);
  check('…asked again: that same refund (its number and amount) is recorded, not sent again', r.body.ok && r.body.refundedCents === 3000 && refunds.length === 2 && res.refundedCents === 5000 && (await lines('Refunds')).length === 2, { body: r.body, n: refunds.length });

  await fresh({ status: 'completed', amountCents: 10000, depositCents: 0, balanceDueCents: 0, refundClaimAt: new Date(Date.now() - 5 * 60000).toISOString(), refundClaimCents: 4000 });
  check('(an old unnumbered claim is only finished once Stripe can be asked about it)', /if \(!refund && !looked && claim\.legacy\) return NextResponse\.json/.test(readFileSync('src/app/api/booths/reserve/route.ts', 'utf8')));

  console.log('calling off');
  await fresh({ status: 'cancelled_refund_pending', stripePaymentIntentId: null, source: 'desk', paymentStatus: 'paid', amountCents: 6000, depositCents: 0, balanceDueCents: 0 });
  r = await refund({ action: 'call-off' }); res = await get(`${T}/boothReservations/r1`);
  check('paid at the desk: called off on the server, with nothing sent to Stripe', r.body.ok && res.status === 'cancelled' && !!res.cancelledAt && rfCalls === 0, r.body);
  await fresh({ status: 'cancelled_refund_pending', amountCents: 6000, depositCents: 0, balanceDueCents: 0 });
  r = await refund({ action: 'call-off' });
  check('…paid online with money left to refund: refused (refund it to call it off)', r.status === 400 && /Refund it/.test(r.body.error), r.body);
  await fresh({ status: 'checked_in', stripePaymentIntentId: null });
  r = await refund({ action: 'call-off' });
  check('…not once the stay has begun', r.status === 400);
  await fresh({ status: 'cancelled_refund_pending', amountCents: 3000, refundedCents: 3000, balancePaid: true, balancePaidVia: 'card', balanceChargedCents: 7000 });
  r = await refund({ action: 'call-off' });
  check('…nor with other money on their card for it not refunded (a balance charged)', r.status === 400 && /Other charges/.test(r.body.error), r.body);
  const offR = R0().stayReceipt({ boothName: 'Room 2', bookingType: 'daily', startDate: '2026-11-20', endDate: '2026-11-20', numDays: 1, originalAmountCents: 6000, amountCents: 6000, status: 'cancelled', confirmedAt: 'x' });
  check('a booking called off at the desk never shows as paid', offR.paidCents === 0 && offR.state === 'refunded', offR);
  const rcRoute = readFileSync('src/app/api/booths/receipt/route.ts', 'utf8');
  check('…and a booking whose payment page was left has no receipt at all', /!\(r\.status === 'cancelled' && r\.confirmedAt\)/.test(rcRoute));

  console.log('prepaid days back');
  const passBooking = { status: 'cancel_requested', amountCents: 0, depositCents: 0, balanceDueCents: 0, balancePaid: true, stripePaymentIntentId: null, paidWithPassId: 'p1', passDaysUsed: 2 };
  await fresh(passBooking);
  await db.doc(`${T}/boothPasses/p1`).set({ id: 'p1', status: 'used_up', daysTotal: 5, daysUsed: 5 });
  rs = await Promise.all([refund(), refund()]);
  const pass = await get(`${T}/boothPasses/p1`); res = await get(`${T}/boothReservations/r1`);
  check('called off: the days go back to the pack, once, and the pack can be used again', pass.daysUsed === 3 && pass.status === 'active' && res.status === 'cancelled' && res.passDaysReturned === 2 && rs.every((x) => x.body.ok) && rfCalls === 0, { pass, rs: rs.map((x) => x.body) });
  check('…the guest is told', notices.filter((n) => n.kind === 'days_back' && n.days === 2).length === 1, notices);
  await fresh({ ...passBooking, status: 'checked_in' });
  await db.doc(`${T}/boothPasses/p1`).set({ id: 'p1', status: 'active', daysTotal: 5, daysUsed: 3 });
  r = await refund();
  check('not once the stay has begun', r.status === 400 && (await get(`${T}/boothPasses/p1`)).daysUsed === 3, r.body);

  console.log('receipts');
  const R = await import('../../src/lib/stay-receipt');
  const part = R.stayReceipt({ boothName: 'Room 2', bookingType: 'daily', startDate: '2026-11-20', endDate: '2026-11-20', numDays: 1, originalAmountCents: 10000, amountCents: 10000, refundedCents: 2000, status: 'completed' });
  check('a refund is its own line, out of what’s paid', part.lines.some((l) => l.description === 'Refunded' && l.amountCents === -2000) && part.paidCents === 8000 && part.state === 'paid', part);
  const off = R.stayReceipt({ boothName: 'Room 2', bookingType: 'daily', startDate: '2026-11-20', endDate: '2026-11-20', numDays: 1, originalAmountCents: 10000, amountCents: 3000, balanceDueCents: 7000, refundedCents: 3000, status: 'refunded' });
  check('called off and refunded: nothing more owed, said so', off.state === 'refunded' && off.stillDueCents === 0 && off.paidCents === 0 && /Called off\. \$30\.00 was refunded/.test(off.note), off);

  console.log('the message the guest gets');
  const N = await import('../../src/lib/reservation-notify');
  await fresh({ status: 'completed' });
  await db.doc(T).set({ name: 'North Loft', publicOrigin: 'https://north.test' }, { merge: true });
  await N.sendStayMoneyNotice(db, 't1', 'r1', { kind: 'charge', cents: 1500, what: 'Extra time (30 minutes)', key: 'overage' });
  await N.sendStayMoneyNotice(db, 't1', 'r1', { kind: 'charge', cents: 1500, what: 'Extra time (30 minutes)', key: 'overage' });
  check('a charge: one email, once, with the amount, what it was for and a link to their booking', sent.length === 1 && sent[0].channel === 'email' && sent[0].kind === 'reservation_money' && /\$15\.00/.test(sent[0].subject)
    && /extra time \(30 minutes\)/.test(sent[0].html) && /https:\/\/north\.test\/reservation\/t1\/r1\?k=/.test(sent[0].html), sent.map((x) => x.subject));
  const words = new RegExp(['studio', 'salon', 'stylist', 'booth', 'chair'].join('|'), 'i');
  check('…in words that fit any business', !words.test(sent[0].html.replace(/studioName|data-studio/g, '')) && !words.test(sent[0].subject));
  await fresh({ status: 'completed', email: '', phone: '5550100' });
  await N.sendStayMoneyNotice(db, 't1', 'r1', { kind: 'refund', cents: 2000, what: '', key: 'refund_1' });
  check('no email: a text instead', sent.length === 1 && sent[0].channel === 'sms' && /refunded \$20\.00/.test(sent[0].text), sent);

  console.log('the desk and the guest’s page');
  const desk = readFileSync('src/components/booths/GuestsToday.tsx', 'utf8');
  check('the desk’s charge list is the business’s own charge types (it was left blank, and the panel broke)', /const incidentalPolicy: any\[\] = useMemo\(\(\) => resolveIncidentalPolicy\(tenant\), \[tenant\]\);/.test(desk));
  check('…the balance (saved card or in person), a refund of any amount with a reason, prepaid days back, and moving a booking are on the stay card',
    /onClick=\{\(\) => chargeBalanceToCard\(r\)\}/.test(desk) && /onClick=\{\(\) => markBalancePaid\(r\)\}/.test(desk) && /onClick=\{\(\) => sendRefund\(r\)\}/.test(desk) && /giveDaysBack\(r\)/.test(desk) && /\{reschedRes\?\.id === r\.id && \(/.test(desk));
  check('…in the app’s look: no shouting capitals, no check marks', !/uppercase/.test(desk) && !/[✓✔⚠]/.test(desk));
  const page = readFileSync('src/app/(booking)/reservation/[tenantId]/[resId]/page.tsx', 'utf8');
  const api = readFileSync('src/app/api/reservation/route.ts', 'utf8');
  check('the guest’s page lists their receipt, from the same lines', /receipt: \(\(\) => \{ const rc = stayReceipt\(r\);/.test(api) && /rc\.lines\.map\(/.test(page) && /Still to pay/.test(page));
  check('…and its words fit any business, with no “call us”', !/studio|call or text/i.test(page.replace(/d\.studioName/g, '')) && !/call the studio|Booth Hub/.test(api));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
