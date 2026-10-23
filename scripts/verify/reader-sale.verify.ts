// Checks a sale paid on the desk's card reader can't be charged twice or lost (lib/reader-sale, the terminal routes,
// lib/reader-settle). The sale is saved as a started ticket first and the payment carries it. Capturing is safe to
// repeat and says whether the card was charged. Trying again uses an earlier payment that went through (or one the
// reader approved) instead of charging again. A payment that went through without its sale is shown to managers to
// record; one on a sale already paid is kept apart to refund. The sweep settles payments the desk never heard back
// about. Discarding an unrecorded card sale refunds the card.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/reader-sale.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV } from './fake-db';
import * as webMock from './web-firestore-mock';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
let db = makeDb();
const desk: any = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false, caps: [] };
const boss: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
let actor: any = desk;
let pis: Record<string, any> = {};
let n = 0;
const calls = { create: 0, capture: [] as string[], cancel: [] as string[], refunds: [] as any[] };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
function StripeMock(this: any) {
  return {
    paymentIntents: {
      retrieve: async (id: string) => { if (!pis[id]) throw new Error('No such payment_intent'); return clone(pis[id]); },
      create: async (p: any) => { const id = `pi_${++n}`; calls.create++; pis[id] = { id, status: 'requires_payment_method', amount: p.amount, metadata: p.metadata, client_secret: `${id}_secret` }; return clone(pis[id]); },
      capture: async (id: string) => { calls.capture.push(id); const pi = pis[id]; if (pi.status !== 'requires_capture') throw new Error(`This PaymentIntent could not be captured because it has a status of ${pi.status}.`); pi.status = 'succeeded'; pi.amount_received = pi.amount; return clone(pi); },
      cancel: async (id: string) => { calls.cancel.push(id); const pi = pis[id]; if (['succeeded', 'canceled'].includes(pi.status)) throw new Error(`You cannot cancel this PaymentIntent because it has a status of ${pi.status}.`); pi.status = 'canceled'; return clone(pi); },
    },
    customers: { create: async () => ({ id: 'cus_1' }) },
    refunds: { create: async (p: any, o: any) => { calls.refunds.push({ ...p, key: o?.idempotencyKey }); return { id: `re_${calls.refunds.length}` }; } },
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
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://studio.test' } }) as any;
const approve = (id: string) => { pis[id].status = 'requires_capture'; };   // the reader approved the card (processPayment)
const fresh = async (ticket: any = {}) => {
  db = makeDb(); pis = {}; n = 0; actor = desk; calls.create = 0; calls.capture.length = 0; calls.cancel.length = 0; calls.refunds.length = 0;
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York' });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'front_desk' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/staff/s9`).set({ name: 'Lee Tran', role: 'staff' });
  await db.doc(`${T}/pendingCheckouts/pc1`).set({ id: 'pc1', status: 'prepared', clientId: 'c1', clientName: 'Maya Lopez', expectedTotal: 45, preparedAt: new Date().toISOString(), payload: { items: [] }, ...ticket });
};
const ticket = () => get(`${T}/pendingCheckouts/pc1`);
const tells = async () => (await all(`${T}/notifications`)).filter((x: any) => String(x.type).startsWith('reader_'));

(async () => {
  const { POST: start } = await import('../../src/app/api/stripe/terminal/create-payment-intent/route');
  const { POST: capture } = await import('../../src/app/api/stripe/terminal/capture-payment-intent/route');
  const { POST: release } = await import('../../src/app/api/stripe/terminal/cancel-payment-intent/route');
  const { sweepReaderPayments } = await import('../../src/lib/reader-sale');
  const { settleReader } = await import('../../src/lib/reader-settle');
  const begin = (body: any) => start(req({ tenantId: 't1', amountCents: 4500, kind: 'sale', pendingId: 'pc1', ...body })) as any;
  const take = (pi: string) => capture(req({ tenantId: 't1', paymentIntentId: pi })) as any;
  const callOff = (pi: string) => release(req({ tenantId: 't1', paymentIntentId: pi })) as any;

  // ── A sale carries its ticket ──
  await fresh();
  let r = await begin({ pendingId: '' });
  check('a sale isn’t charged on the reader without its started ticket', r.status === 400 && r.body.code === 'no_ticket' && calls.create === 0);
  r = await begin({});
  const p1 = r.body.paymentIntentId;
  check('starting it names the ticket on the payment', r.status === 200 && pis[p1]?.metadata?.kind === 'sale' && pis[p1]?.metadata?.pendingId === 'pc1');
  let t: any = await ticket();
  check('…and the ticket knows the payment started, before the reader sees the card', t.readerPis?.[p1]?.state === 'started' && t.readerOpen === true);

  // ── Captured, then the answer is lost ──
  approve(p1);
  r = await take(p1);
  t = await ticket();
  check('capturing marks the ticket paid on the card reader (the desk records the sale with it)', r.body.ok && t.status === 'paid_waiting' && t.paymentIntentId === p1 && t.paidVia === 'card_reader');
  r = await take(p1);
  check('asking again after a lost answer says it went through, and doesn’t capture twice', r.body.ok && r.body.already === true && calls.capture.length === 1);
  r = await begin({});
  check('trying again uses the payment that went through instead of charging the card again', r.status === 409 && r.body.code === 'sale_paid' && r.body.paymentIntentId === p1 && calls.create === 1);
  await db.doc(`${T}/pendingCheckouts/pc1`).set({ status: 'completed', receiptId: 'rc1', paymentIntentId: p1 }, { merge: true });
  r = await begin({});
  check('a finished sale isn’t charged again', r.status === 409 && r.body.code === 'sale_done' && calls.create === 1);

  // ── Approved but never captured (the screen closed) ──
  await fresh();
  r = await begin({}); const p2 = r.body.paymentIntentId; approve(p2);
  r = await begin({});
  check('trying again captures the payment the reader already approved (same total), with no new charge', r.status === 409 && r.body.code === 'sale_paid' && r.body.paymentIntentId === p2 && pis[p2].status === 'succeeded' && calls.create === 1);
  check('…and the ticket shows it paid', (await ticket()).paymentIntentId === p2);
  await fresh();
  r = await begin({}); const p3 = r.body.paymentIntentId; approve(p3);
  r = await begin({ amountCents: 5200 });
  check('the total changed: the hold from the earlier approval is released and the new total is charged', r.status === 200 && pis[p3].status === 'canceled' && calls.create === 2 && (await ticket()).readerPis?.[p3]?.state === 'released');

  // ── Declined ──
  await fresh();
  r = await begin({}); const p4 = r.body.paymentIntentId;
  r = await take(p4);
  check('a card that wasn’t approved says it wasn’t charged (a real answer, not a lost one)', r.status === 409 && r.body.ok === false && r.body.charged === false && (await ticket()).status === 'prepared');
  r = await begin({ previousPaymentIntentId: p4 });
  check('…trying again calls off the old attempt and starts a new one', r.status === 200 && pis[p4].status === 'canceled' && calls.create === 2);

  // ── Never someone else's payment ──
  await fresh();
  pis.pi_old = { id: 'pi_old', status: 'succeeded', amount: 4500, amount_received: 4500, metadata: { tenantId: 't1', kind: 'sale', pendingId: 'pcX' } };
  pis.pi_rcpt = { id: 'pi_rcpt', status: 'succeeded', amount: 4500, amount_received: 4500, metadata: { tenantId: 't1', kind: 'sale' } };
  await db.doc(`${T}/receipts/rc9`).set({ stripePaymentIntentId: 'pi_rcpt' });
  r = await begin({ previousPaymentIntentId: 'pi_old' });
  check('a payment made for another sale is never used for this one', r.status === 200 && r.body.paymentIntentId !== 'pi_old');
  await fresh();
  pis.pi_rcpt = { id: 'pi_rcpt', status: 'succeeded', amount: 4500, amount_received: 4500, metadata: { tenantId: 't1', kind: 'sale' } };
  await db.doc(`${T}/receipts/rc9`).set({ stripePaymentIntentId: 'pi_rcpt' });
  r = await begin({ previousPaymentIntentId: 'pi_rcpt' });
  check('…nor one already on a receipt', r.status === 200 && r.body.paymentIntentId !== 'pi_rcpt');
  pis.pi_dep = { id: 'pi_dep', status: 'succeeded', amount: 4500, amount_received: 4500, metadata: { tenantId: 't1', kind: 'deposit', appointmentId: 'a1' } };
  r = await begin({ previousPaymentIntentId: 'pi_dep' });
  check('…nor a booking’s deposit', r.status === 200 && r.body.paymentIntentId !== 'pi_dep');
  pis.pi_other = { id: 'pi_other', status: 'requires_capture', amount: 4500, metadata: { tenantId: 't2', kind: 'sale', pendingId: 'pc1' } };
  r = await take('pi_other');
  check('another business’s payment can’t be captured from here', r.status === 409 && r.body.ok === false && pis.pi_other.status === 'requires_capture');

  // ── Paid twice ──
  await fresh({ status: 'completed', receiptId: 'rc1' });
  pis.pi_x = { id: 'pi_x', status: 'requires_capture', amount: 4500, metadata: { tenantId: 't1', kind: 'sale', pendingId: 'pc1' } };
  r = await take('pi_x');
  t = await ticket();
  check('a reader payment on a sale already paid another way is kept apart as extra', r.body.ok && t.status === 'completed' && t.readerExtra?.pi_x?.state === 'open' && t.readerExtraOpen === true && !t.paymentIntentId);
  let told = await tells();
  check('…and the front desk and managers are told (not the rest of the team)', told.length === 2 && told.every((x: any) => x.type === 'reader_paid_twice' && ['k1', 'm1'].includes(x.userId)), told);
  await take('pi_x');
  check('…once', (await tells()).length === 2);

  // ── Calling a payment off ──
  await fresh();
  r = await begin({}); const p5 = r.body.paymentIntentId; approve(p5);
  r = await callOff(p5);
  check('cancelling a payment the reader approved but wasn’t captured releases the hold', r.body.ok && r.body.released && pis[p5].status === 'canceled' && (await ticket()).readerPis?.[p5]?.state === 'released');
  await fresh();
  r = await begin({}); const p6 = r.body.paymentIntentId; approve(p6); await take(p6);
  await db.doc(`${T}/pendingCheckouts/pc1`).set({ status: 'prepared', paymentIntentId: null, paidVia: null }, { merge: true });
  r = await callOff(p6);
  check('cancelling one that already went through says so, and the ticket shows it paid (so the sale is recorded, not charged again)', r.status === 409 && r.body.charged === true && (await ticket()).paymentIntentId === p6 && pis[p6].status === 'succeeded');

  // ── The sweep ──
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  const seedStarted = async (id: string, status: string, minutes: number, x: any = {}) => {
    pis[id] = { id, status, amount: 4500, ...(status === 'succeeded' ? { amount_received: 4500 } : {}), metadata: { tenantId: 't1', kind: 'sale', pendingId: 'pc1' } };
    await db.doc(`${T}/pendingCheckouts/pc1`).set({ readerPis: { [id]: { at: ago(minutes), cents: 4500, by: 'Kai Park', state: 'started' } }, readerOpen: true, ...x }, { merge: true });
  };
  const sweep = () => sweepReaderPayments(db, 't1', { stripeAccountId: 'acct_1' });
  await fresh(); await seedStarted('pi_s1', 'requires_capture', 5);
  let s = await sweep();
  check('the sweep leaves a payment started minutes ago alone (the desk may still be on it)', s.checked === 0 && pis.pi_s1.status === 'requires_capture' && (await ticket()).readerOpen === true);
  await fresh(); await seedStarted('pi_s2', 'requires_capture', 15);
  s = await sweep(); t = await ticket(); told = await tells();
  check('approved on the reader, never captured, sale not saved: captured, the ticket shows it paid, and the desk is told to record it', s.captured === 1 && pis.pi_s2.status === 'succeeded' && t.status === 'paid_waiting' && t.paymentIntentId === 'pi_s2' && told.length === 2 && told[0].type === 'reader_unrecorded');
  check('…and the ticket is done with the sweep', t.readerOpen === false);
  await fresh({ status: 'completed', receiptId: 'rc1' }); await seedStarted('pi_s3', 'requires_capture', 15);
  s = await sweep();
  check('…but when the sale was paid another way, the hold on the card is released instead', s.released === 1 && pis.pi_s3.status === 'canceled' && !calls.capture.includes('pi_s3'));
  await fresh(); await seedStarted('pi_s4', 'succeeded', 15);
  s = await sweep(); t = await ticket();
  check('went through, but its answer and mark were lost: the ticket shows it paid and the desk is told', t.status === 'paid_waiting' && t.paymentIntentId === 'pi_s4' && (await tells()).length === 2);
  await db.doc(`${T}/pendingCheckouts/pc1`).set({ readerOpen: true, readerPis: { pi_s4: { state: 'started' } } }, { merge: true });
  await sweep();
  check('…told once, however often the sweep runs', (await tells()).length === 2);
  await fresh(); await seedStarted('pi_s5', 'requires_payment_method', 20);
  await sweep();
  check('a payment never finished is left a while (the card may still be on the reader)', pis.pi_s5.status === 'requires_payment_method' && (await ticket()).readerOpen === true);
  await fresh(); await seedStarted('pi_s6', 'requires_payment_method', 40);
  await sweep();
  check('…then called off, so it can never complete later', pis.pi_s6.status === 'canceled' && (await ticket()).readerOpen === false);
  await fresh(); await seedStarted('pi_s7', 'processing', 15);
  await sweep();
  check('a payment still processing is asked about next time', pis.pi_s7.status === 'processing' && (await ticket()).readerOpen === true);

  // ── The screen asks again until it hears back ──
  const replies = (list: any[]) => { let i = 0; return async () => { const x = list[Math.min(i++, list.length - 1)]; if (x === 'drop') throw new Error('offline'); return { status: x.status, json: async () => x.body }; }; };
  const quick = async () => {};
  let a = await settleReader(replies(['drop', 'drop', { status: 200, body: { ok: true } }]), {}, 4, quick);
  check('a dropped connection is asked again until the answer comes back', a.reached && a.data.ok);
  a = await settleReader(replies(['drop', 'drop', 'drop', 'drop']), {}, 4, quick);
  check('…and if it never does, the screen says it couldn’t confirm (never “failed”)', !a.reached && !a.data);
  a = await settleReader(replies([{ status: 502, body: { ok: false } }, { status: 200, body: { ok: true, already: true } }]), {}, 4, quick);
  check('a server error is asked again too', a.reached && a.data.already);
  a = await settleReader(replies([{ status: 409, body: { ok: false, charged: false } }]), {}, 4, quick);
  check('“not charged” is a real answer: no asking again', a.reached && a.data.charged === false);
  a = await settleReader(replies([{ status: 202, body: { ok: false, status: 'processing' } }, { status: 202, body: { ok: false, status: 'processing' } }]), {}, 2, quick);
  check('still processing at the end: not a real answer yet', !a.reached && a.data?.status === 'processing');

  // ── The desk and managers, on the ticket ──
  const { POST: complete } = await import('../../src/app/api/checkout/complete/route');
  const desk2 = (body: any) => complete(req({ tenantId: 't1', pendingId: 'pc1', ...body })) as any;
  await fresh({ status: 'paid_waiting', paymentIntentId: 'pi_p', paidVia: 'card_reader' });
  r = await desk2({ action: 'prepare', clientId: 'c1', expectedTotal: 45, items: [] });
  check('the desk keeping a paid ticket up to date doesn’t turn it back into “started”', r.body.ok && (await ticket()).status === 'paid_waiting' && (await ticket()).paymentIntentId === 'pi_p');
  pis.pi_p = { id: 'pi_p', status: 'succeeded', amount: 4500, amount_received: 4500, metadata: { tenantId: 't1', kind: 'sale', pendingId: 'pc1', source: 'terminal' }, latest_charge: { id: 'ch_p', amount_refunded: 0, refunded: false } };
  actor = boss;
  r = await desk2({ action: 'discard', reason: 'Rang it up twice' });
  t = await ticket();
  check('discarding a card sale that was never recorded refunds the card', r.body.ok && t.status === 'discarded' && calls.refunds.length === 1 && calls.refunds[0].payment_intent === 'pi_p' && !!t.paymentRefundedAt);
  await fresh({ status: 'completed', receiptId: 'rc1', readerExtra: { pi_e: { cents: 4500, at: new Date().toISOString(), state: 'open' } }, readerExtraOpen: true });
  pis.pi_e = { id: 'pi_e', status: 'succeeded', amount: 4500, amount_received: 4500, metadata: { tenantId: 't1', kind: 'sale', pendingId: 'pc1', source: 'terminal' }, latest_charge: { id: 'ch_e', amount_refunded: 0, refunded: false } };
  r = await desk2({ action: 'reader_extra', paymentIntentId: 'pi_e', decision: 'refund' });
  check('only a manager refunds or keeps an extra payment', r.status === 403 && calls.refunds.length === 0);
  actor = boss;
  r = await desk2({ action: 'reader_extra', paymentIntentId: 'pi_e', decision: 'keep' });
  check('keeping it needs a reason', r.status === 400);
  r = await desk2({ action: 'reader_extra', paymentIntentId: 'pi_e', decision: 'refund' });
  t = await ticket();
  check('refunding the extra payment refunds that payment to the card, and it leaves the list', r.body.ok && calls.refunds[0]?.payment_intent === 'pi_e' && t.readerExtra.pi_e.state === 'refunded' && t.readerExtraOpen === false);
  r = await desk2({ action: 'reader_extra', paymentIntentId: 'pi_e', decision: 'refund' });
  check('…and a second tap doesn’t refund it twice', r.body.already === true && calls.refunds.length === 1);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
