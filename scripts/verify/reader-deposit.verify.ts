// Checks a deposit taken on the shop's card reader can't be charged and left unrecorded (lib/reader-deposit). The
// server sets the amount from the booking (its deposit, and a balance collected with it), never from the screen, and
// won't start one for a booking that owes none or has paid. The booking knows a reader payment was started for it. The
// capture records it; so does the booking screen asking after, the desk taking the deposit another way (which records
// the reader's payment instead of taking it twice), starting another reader payment, and the unpaid-hold sweep before
// it would let the time go. A cash deposit goes into the open till. Undoing a booking refunds a reader deposit to the
// card.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/reader-deposit.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

let db = makeDb();
const actor: any = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false, caps: [] };
const sent: any[] = [];
let pis: Record<string, any> = {};
const created: any[] = []; const captured: string[] = [];
let n = 0;
function StripeMock(this: any) {
  return {
    paymentIntents: {
      retrieve: async (id: string) => { if (!pis[id]) throw new Error('No such payment_intent'); return JSON.parse(JSON.stringify(pis[id])); },
      create: async (p: any, opts: any) => { const id = `pi_new${++n}`; created.push({ ...p, opts }); pis[id] = { id, status: 'requires_payment_method', amount: p.amount, payment_method_types: p.payment_method_types, metadata: p.metadata, latest_charge: null }; return { id, client_secret: `${id}_secret` }; },
      capture: async (id: string) => { captured.push(id); pis[id] = { ...pis[id], status: 'succeeded', amount_received: pis[id].amount, latest_charge: { id: `ch_${id}` } }; return JSON.parse(JSON.stringify(pis[id])); },
    },
    customers: { create: async () => ({ id: 'cus_1' }) },
  };
}
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }) };
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
const visit = (x: any = {}) => ({ id: 'a1', tenantId: 't1', clientId: 'c1', clientName: 'Maya Lopez', clientEmail: 'maya@example.com', serviceName: 'Gel set', staffId: 's1',
  startTime: new Date(Date.now() + 9 * 864e5).toISOString(), createdAt: new Date(Date.now() - 3 * 3600e3).toISOString(),
  status: 'pending_payment', depositStatus: 'pending', depositAmountCents: 2500, checkInToken: 'tok1', ...x });
const fresh = async (x: any = {}) => {
  db = makeDb(); sent.length = 0; pis = {}; created.length = 0; captured.length = 0;
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com', outstandingBalance: 10 });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'front_desk' });
  await db.doc(`${T}/appointments/a1`).set(visit(x));
};
const reader = (id: string, x: any = {}) => { pis[id] = { id, status: 'succeeded', amount: 2500, amount_received: 2500, payment_method_types: ['card_present'], latest_charge: { id: `ch_${id}` },
  metadata: { tenantId: 't1', clientId: 'c1', source: 'terminal', appointmentId: 'a1', kind: 'deposit' }, ...x }; };
const credits = async () => (await all(`${T}/depositCredits`)).filter((c: any) => c.sourceAppointmentId === 'a1');
const retainers = async () => (await all(`${T}/transactions`)).filter((t: any) => t.category === 'Retainers');

(async () => {
  const { POST: start } = await import('../../src/app/api/stripe/terminal/create-payment-intent/route');
  const { POST: capture } = await import('../../src/app/api/stripe/terminal/capture-payment-intent/route');
  const { POST: desk } = await import('../../src/app/api/appointments/desk-deposit/route');
  const { releaseUnpaidHolds } = await import('../../src/lib/release-unpaid');
  const { readerDepositAmount } = await import('../../src/lib/reader-deposit');
  const begin = (body: any) => start(req({ tenantId: 't1', ...body })) as any;
  const take = (pi: string) => capture(req({ tenantId: 't1', paymentIntentId: pi })) as any;
  const atDesk = (body: any) => desk(req({ tenantId: 't1', appointmentId: 'a1', ...body })) as any;

  // ── The amount is the booking's ──
  check('the reader takes the deposit, and a balance collected with it', readerDepositAmount({ depositAmountCents: 2500, balanceCollectCents: 1000 }).totalCents === 3500
    && readerDepositAmount({ depositAmountCents: 2500, balanceCollectCents: 1000, balanceCollectedAt: 'x' }).totalCents === 2500 && readerDepositAmount({ depositAmountCents: 0, balanceCollectCents: 1000 }).totalCents === 0);
  await fresh({ balanceCollectCents: 1000 });
  let r = await begin({ amountCents: 9900, appointmentId: 'a1', kind: 'deposit', description: 'Deposit' });
  check('starting a reader deposit charges what the booking owes ($25 + $10), not what the screen sent', r.status === 200 && created[0]?.amount === 3500 && r.body.amountCents === 3500, created[0]);
  check('…named for the booking, and the booking knows it was started', created[0]?.metadata?.appointmentId === 'a1' && created[0]?.metadata?.kind === 'deposit' && (await get(`${T}/appointments/a1`)).depositReaderPi?.id === r.body.paymentIntentId);
  await fresh({ depositStatus: 'paid', status: 'confirmed' });
  r = await begin({ amountCents: 2500, appointmentId: 'a1', kind: 'deposit' });
  check('a deposit already paid isn’t taken on the reader again', r.status === 409 && r.body.code === 'already_paid' && !created.length);
  await fresh({ depositAmountCents: 0 });
  r = await begin({ amountCents: 2500, appointmentId: 'a1', kind: 'deposit' });
  check('a booking that owes no deposit isn’t charged one (the screen and the server can disagree)', r.status === 409 && r.body.code === 'no_deposit' && !created.length);
  await fresh();
  r = await begin({ amountCents: 4200, description: 'Front desk' });
  check('an ordinary reader sale still charges what was asked', r.status === 200 && created[0]?.amount === 4200 && !created[0]?.metadata?.kind);

  // ── Recorded as it's captured ──
  await fresh();
  r = await begin({ amountCents: 2500, appointmentId: 'a1', kind: 'deposit' });
  const pi1 = r.body.paymentIntentId;
  pis[pi1].status = 'requires_capture';   // the reader approved the card
  r = await take(pi1);
  let ap: any = await get(`${T}/appointments/a1`);
  check('the capture records the deposit itself: paid and confirmed, its credit and its income line', r.body.ok && r.body.deposit?.ok && ap.depositStatus === 'paid' && ap.status === 'confirmed'
    && (await credits()).length === 1 && (await retainers()).length === 1 && (await retainers())[0].paymentMethod === 'Card reader' && !ap.depositReaderPi, { body: r.body, ap });
  check('…and the client is told their visit is confirmed', sent.some((m) => m.kind === 'desk_booking_confirmed'));
  r = await atDesk({ action: 'reader', paymentIntentId: pi1 });
  check('the booking screen asking after only confirms it: nothing more is added', r.body.ok && r.body.already && (await credits()).length === 1 && (await retainers()).length === 1, r.body);
  await fresh();
  pis.pi_sale = { id: 'pi_sale', status: 'requires_capture', amount: 4200, payment_method_types: ['card_present'], metadata: { tenantId: 't1', source: 'terminal' } };
  r = await take('pi_sale');
  check('capturing an ordinary sale records no deposit', r.body.ok && !r.body.deposit && !(await credits()).length);

  // ── The screen lost its connection ──
  await fresh({ depositReaderPi: { id: 'pi_lost', at: new Date().toISOString(), cents: 2500 } });
  reader('pi_lost');
  r = await atDesk({ action: 'settled', amountCents: 2500, via: 'cash' });
  ap = await get(`${T}/appointments/a1`);
  check('cash taken while a reader payment had gone through: the reader payment is recorded first, as the booking’s payment', ap.depositPaidVia === 'card_reader' && ap.depositStripePaymentIntentId === 'pi_lost', ap);
  check('…and the cash is recorded too, as a second payment (never dropped), flagged, with the desk told to refund one',
    r.body.ok && r.body.paidTwice && /paid twice/.test(r.body.message) && ap.needsAttention === 'deposit_paid_twice' && (await credits()).length === 2
    && (await retainers()).map((t: any) => t.paymentMethod).sort().join() === 'Card reader,Cash' && (await all(`${T}/notifications`)).some((n: any) => n.type === 'deposit_paid_twice'), { body: r.body, ap });
  r = await atDesk({ action: 'settled', amountCents: 2500, via: 'cash' });
  check('…tapped again, nothing more is added', r.body.ok && r.body.already && (await credits()).length === 2 && (await retainers()).length === 2, r.body);
  await fresh({ depositReaderPi: { id: 'pi_lost', at: new Date().toISOString(), cents: 2500 }, clientId: 'c1' });
  reader('pi_lost');
  r = await atDesk({ action: 'charge' });
  check('…charging the saved card records the reader payment instead of charging again', r.body.ok && r.body.viaReader && (await credits()).length === 1, r.body);
  await fresh({ depositReaderPi: { id: 'pi_declined', at: new Date().toISOString(), cents: 2500 } });
  pis.pi_declined = { id: 'pi_declined', status: 'requires_payment_method', amount: 2500, payment_method_types: ['card_present'], metadata: { tenantId: 't1', appointmentId: 'a1', kind: 'deposit' } };
  r = await atDesk({ action: 'settled', amountCents: 2500, via: 'cash' });
  ap = await get(`${T}/appointments/a1`);
  check('a reader payment that didn’t go through doesn’t stop the cash deposit', r.body.ok && !r.body.viaReader && !r.body.paidTwice && ap.depositPaidVia === 'desk' && (await retainers())[0]?.paymentMethod === 'Cash', { body: r.body, ap });
  // A card may still be on the reader for a while: a payment that hasn't finished is only forgotten once it's old.
  const { recordWaitingReaderDeposit } = await import('../../src/lib/reader-deposit');
  await fresh({ depositReaderPi: { id: 'pi_waiting', at: new Date().toISOString(), cents: 2500 } });
  pis.pi_waiting = { id: 'pi_waiting', status: 'requires_payment_method', amount: 2500, payment_method_types: ['card_present'], metadata: { tenantId: 't1', appointmentId: 'a1', kind: 'deposit' } };
  await recordWaitingReaderDeposit(db, 't1', { ...(await get(`${T}/appointments/a1`)), id: 'a1' });
  check('…a payment still waiting on the reader isn’t forgotten while it might finish', (await get(`${T}/appointments/a1`)).depositReaderPi?.id === 'pi_waiting');
  await db.doc(`${T}/appointments/a1`).set({ depositReaderPi: { id: 'pi_waiting', at: new Date(Date.now() - 3 * 3600e3).toISOString(), cents: 2500 } }, { merge: true });
  await recordWaitingReaderDeposit(db, 't1', { ...(await get(`${T}/appointments/a1`)), id: 'a1' });
  check('…one that never finished, hours later, isn’t asked about again', !(await get(`${T}/appointments/a1`)).depositReaderPi);
  await fresh({ depositReaderPi: { id: 'pi_lost', at: new Date().toISOString(), cents: 2500 } });
  reader('pi_lost');
  r = await begin({ amountCents: 2500, appointmentId: 'a1', kind: 'deposit' });
  check('starting another reader payment records the one that went through, and charges nothing new', r.status === 409 && r.body.code === 'already_paid' && !created.length && (await get(`${T}/appointments/a1`)).depositStatus === 'paid');

  // ── The unpaid-hold sweep ──
  await fresh({ depositReaderPi: { id: 'pi_lost', at: new Date().toISOString(), cents: 2500 } });
  reader('pi_lost');
  await releaseUnpaidHolds(db, 't1', { origin: 'https://studio.test' });
  ap = await get(`${T}/appointments/a1`);
  check('the sweep records a reader deposit the screen never confirmed, and keeps the visit', ap.status === 'confirmed' && ap.depositStatus === 'paid' && (await credits()).length === 1, ap);
  await fresh();
  await releaseUnpaidHolds(db, 't1', { origin: 'https://studio.test' });
  check('…a walked-away hold with no payment is still released', (await get(`${T}/appointments/a1`)).status === 'cancelled');

  // ── A balance collected with the deposit, split once ──
  await fresh({ balanceCollectCents: 1000 });
  reader('pi_bal', { amount: 3500, amount_received: 3500 });
  const both = await Promise.all([atDesk({ action: 'reader', paymentIntentId: 'pi_bal' }), atDesk({ action: 'reader', paymentIntentId: 'pi_bal' })]);
  const fees = (await all(`${T}/transactions`)).filter((t: any) => t.category === 'Fee Recovery');
  check('$35 on the reader for a $25 deposit and a $10 balance, recorded twice at once: one $10 fee payment, one $25 deposit and credit',
    both.every((x: any) => x.body.ok) && fees.length === 1 && fees[0].amount === 10 && (await retainers()).length === 1 && (await retainers())[0].amount === 25 && (await credits())[0]?.amountCents === 2500
    && (await get(`${T}/clients/c1`)).outstandingBalance === 0, { fees, ret: await retainers(), cr: await credits() });
  await fresh({ balanceCollectCents: 1000, balanceCollectedAt: new Date().toISOString() });
  reader('pi_bal2', { amount: 3500, amount_received: 3500 });
  r = await atDesk({ action: 'reader', paymentIntentId: 'pi_bal2' });
  check('…a balance already collected another way: everything this payment took is the deposit’s credit (nothing lost)', r.body.ok && (await credits())[0]?.amountCents === 3500 && !(await all(`${T}/transactions`)).some((t: any) => t.category === 'Fee Recovery'), await credits());

  // ── Paid on today's bill for a booking already paid on the reader ──
  await fresh();
  reader('pi_first');
  await atDesk({ action: 'reader', paymentIntentId: 'pi_first' });
  r = await atDesk({ action: 'settled', amountCents: 2500, receiptId: 'rcpt9', paidMethod: 'card' });
  check('a deposit charged again on today’s bill is recorded as a second payment (the sale has its own income line) and flagged',
    r.body.ok && r.body.paidTwice && (await credits()).length === 2 && (await retainers()).length === 1 && (await get(`${T}/appointments/a1`)).needsAttention === 'deposit_paid_twice', r.body);

  // ── Undo ──
  const { POST: undo } = await import('../../src/app/api/appointments/undo-booking/route');
  const undoIt = () => undo(req({ tenantId: 't1', appointmentId: 'a1' })) as any;
  await fresh({ source: 'planner' });
  reader('pi_first');
  await atDesk({ action: 'reader', paymentIntentId: 'pi_first' });
  await atDesk({ action: 'settled', amountCents: 2500, via: 'cash' });
  r = await undoIt();
  check('a booking whose deposit was paid twice isn’t undone until one payment is refunded', r.status === 409 && /paid twice/.test(r.body.error) && (await get(`${T}/appointments/a1`)).status !== 'cancelled', r.body);
  await fresh({ source: 'planner', createdAt: new Date().toISOString() });
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 100 });
  await atDesk({ action: 'settled', amountCents: 2500, via: 'cash', withBalance: false });
  r = await undoIt();
  check('undoing a booking whose deposit was paid in cash takes the cash back out of the till', r.body.ok && (await get(`${T}/tillSessions/till1`)).expectedCash === 100, { body: r.body, till: await get(`${T}/tillSessions/till1`) });

  // ── Cash into the till ──
  await fresh();
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 100 });
  r = await atDesk({ action: 'settled', amountCents: 2500, via: 'cash', withBalance: false });
  const till: any = await get(`${T}/tillSessions/till1`);
  check('a cash deposit goes into the open till, so it balances at close', r.body.ok && till.expectedCash === 125 && till.cashAdjustments?.[0]?.amount === 25 && /Deposit paid in cash/.test(till.cashAdjustments[0].reason), till);
  r = await atDesk({ action: 'settled', amountCents: 2500, via: 'cash', withBalance: false });
  check('…tapped again, it isn’t counted twice', (await get(`${T}/tillSessions/till1`)).expectedCash === 125);
  await fresh();
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 100 });
  await atDesk({ action: 'settled', amountCents: 2500, via: 'card_machine' });
  check('…a card machine deposit doesn’t touch the till', (await get(`${T}/tillSessions/till1`)).expectedCash === 100);

  // ── The screens ──
  const src = (p: string) => fs.readFileSync(p, 'utf8');
  const dialog = src('src/components/planner/AddAppointmentDialog.tsx');
  check('the booking screen takes only what the server says the booking owes (no amount of its own)', /const depCents = Math\.max\(0, Math\.round\(Number\(out\.depositCents\) \|\| 0\)\);/.test(dialog) && !/out\.depositCents\) \|\| depositDetails\.amount/.test(dialog));
  check('…holds a reader booking for a day, and asks the server again when the answer is lost', /payLater \|\| viaReader \? \{ holdUntil/.test(dialog) && /for \(let i = 0; !d && paid\?\.paymentIntentId && i < 3; i\+\+\)/.test(dialog) && !/it won’t be charged twice/.test(dialog));
  check('the reader passes the capture’s record back, and the payment’s id even when the answer was lost', /deposit: data\?\.deposit \|\| null, captured: true/.test(src('src/components/pos/StripeTerminalProvider.tsx')) && /error: processResult\.error\.message, paymentIntentId: piId, captured: false/.test(src('src/components/pos/StripeTerminalProvider.tsx')));
  check('…including when the connection drops while it’s captured (the screen then asks the server instead of saying it failed)', /return \{ ok: false, error: err\.message, paymentIntentId: piId, captured: false \}/.test(src('src/components/pos/StripeTerminalProvider.tsx')));
  check('the desk is told when a deposit it took was already paid', /d\.paidTwice \|\| d\.viaReader/.test(dialog) && /d\.paidTwice \|\| d\.viaReader\) && d\.message/.test(src('src/components/pos/desk/StaffBookSheet.tsx')));
  check('undoing a booking refunds a reader deposit to the card', /a\.depositPaidVia === 'card_on_file' \|\| a\.depositPaidVia === 'card_reader'/.test(src('src/lib/undo-booking.ts')) && /undoPiFor\(a, receipt, cents\)/.test(src('src/app/api/appointments/undo-booking/route.ts')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
