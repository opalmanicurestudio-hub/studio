// Checks a sale that's already paid can never be paid again, and is never lost (the register review):
//  - the checkout refuses a second payment on a paid ticket (cash, a card, a split), keeps a second card payment apart
//    for a manager, tells the desk and managers once, and saves the sale with the payment it was paid with
//  - the ticket is finished in the same save as the sale; a lost answer finishes it too
//  - the amount charged is checked against what the sale comes to
//  - starting a ticket: a paid ticket is never changed, a lost one is picked up again for its client, a paid one is
//    never reused for another client, a discarded one never comes back, and a split's shares are handed back
//  - managers: discarding never refunds a sale that was recorded; an extra payment on a receipt isn't refunded as extra
//  - the card reader: never charges a ticket paid another way, or one being split; when Stripe can't be reached nothing
//    is assumed (no new charge, nothing marked "not charged"); a refunded payment never pays for a sale; an approved
//    payment that couldn't be captured isn't reported as "not charged"; only reader payments are cancelled from the
//    desk; fees are recorded whoever captures; only this sale's own reader payments are reused
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/register-paid-ticket.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';
import * as webMock from './web-firestore-mock';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
let db = makeDb();
const desk: any = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false, caps: [] };
const boss: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
let actor: any = desk;
let pis: Record<string, any> = {};
let n = 0; let down = false; let captureFails = false;
const calls = { create: 0, capture: [] as string[], cancel: [] as string[], refunds: [] as any[] };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const missing = () => Object.assign(new Error('No such payment_intent'), { code: 'resource_missing', statusCode: 404 });
const offline = () => Object.assign(new Error('An error occurred with our connection to Stripe.'), { type: 'StripeConnectionError' });
const charge = (pi: any) => ({ id: `ch_${pi.id}`, amount: pi.amount, amount_refunded: 0, refunded: false, payment_method_details: { type: 'card_present' }, metadata: pi.metadata || {},
  balance_transaction: { id: `txn_${pi.id}`, fee: 160, net: pi.amount - 160, amount: pi.amount, fee_details: [] }, payment_intent: pi.id, created: Math.floor(Date.now() / 1000) });
function StripeMock(this: any) {
  return {
    paymentIntents: {
      retrieve: async (id: string) => { if (down) throw offline(); if (!pis[id]) throw missing(); return clone(pis[id]); },
      create: async (p: any) => { if (down) throw offline(); const id = `pi_${++n}`; calls.create++; pis[id] = { id, status: 'requires_payment_method', amount: p.amount, metadata: p.metadata, client_secret: `${id}_secret` }; return clone(pis[id]); },
      capture: async (id: string) => { if (down) throw offline(); calls.capture.push(id); const pi = pis[id]; if (captureFails) throw new Error('Something went wrong on our end.');
        if (pi.status !== 'requires_capture') throw new Error(`This PaymentIntent could not be captured because it has a status of ${pi.status}.`); pi.status = 'succeeded'; pi.amount_received = pi.amount; pi.latest_charge = charge(pi); return clone(pi); },
      cancel: async (id: string) => { if (down) throw offline(); calls.cancel.push(id); const pi = pis[id]; if (['succeeded', 'canceled'].includes(pi.status)) throw new Error(`You cannot cancel this PaymentIntent because it has a status of ${pi.status}.`); pi.status = 'canceled'; return clone(pi); },
    },
    balanceTransactions: { retrieve: async (id: string) => ({ id, fee: 160, net: 4340, amount: 4500, fee_details: [] }) },
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
const paidPi = (id: string, cents: number, x: any = {}) => { pis[id] = { ...x, id, status: 'succeeded', amount: cents, amount_received: cents, metadata: { tenantId: 't1', ...(x.metadata || {}) }, latest_charge: charge({ id, amount: cents, metadata: x.metadata || {} }) }; };
const fresh = async (ticket: any = null) => {
  db = makeDb(); pis = {}; n = 0; actor = desk; down = false; captureFails = false; calls.create = 0; calls.capture.length = 0; calls.cancel.length = 0; calls.refunds.length = 0;
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York', salesTax: { configured: true, productsPct: 0 } });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'front_desk' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/staff/s9`).set({ name: 'Lee Tran', role: 'staff' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com' });
  await db.doc(`${T}/clients/c2`).set({ name: 'Jo Kim', email: 'jo@example.com' });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Cuticle oil', msrp: 45, totalStock: 10 });
  await db.doc(`${T}/inventory/p2`).set({ name: 'Top coat', msrp: 12, totalStock: 10 });
  if (ticket) await db.doc(`${T}/pendingCheckouts/pc1`).set({ id: 'pc1', status: 'prepared', clientId: 'c1', clientName: 'Maya Lopez', expectedTotal: 45, preparedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), payload: { items: [{ id: 'p1', type: 'product', quantity: 1 }] }, ...ticket });
};
const ticket = (id = 'pc1') => get(`${T}/pendingCheckouts/${id}`);
const tells = async () => (await all(`${T}/notifications`)).filter((x: any) => String(x.type).startsWith('reader_'));
const oil = [{ id: 'p1', type: 'product', quantity: 1, price: 45, name: 'Cuticle oil' }];
const readerPaid = { status: 'paid_waiting', paymentIntentId: 'pi_p', paidVia: 'card_reader', paidCents: 4500 };

(async () => {
  const { POST: complete } = await import('../../src/app/api/checkout/complete/route');
  const { POST: start } = await import('../../src/app/api/stripe/terminal/create-payment-intent/route');
  const { POST: capture } = await import('../../src/app/api/stripe/terminal/capture-payment-intent/route');
  const { POST: release } = await import('../../src/app/api/stripe/terminal/cancel-payment-intent/route');
  const { sweepReaderPayments, markSalePaid } = await import('../../src/lib/reader-sale');
  const pay = (body: any) => complete(req({ tenantId: 't1', pendingId: 'pc1', clientId: 'c1', items: oil, expectedTotal: 45, ...body })) as any;
  const prep = (body: any) => complete(req({ tenantId: 't1', action: 'prepare', clientId: 'c1', items: oil, expectedTotal: 45, ...body })) as any;
  const begin = (body: any = {}) => start(req({ tenantId: 't1', amountCents: 4500, kind: 'sale', pendingId: 'pc1', ...body })) as any;
  const take = (pi: string) => capture(req({ tenantId: 't1', paymentIntentId: pi })) as any;

  console.log('A second payment on a paid sale');
  await fresh(readerPaid); paidPi('pi_p', 4500, { metadata: { kind: 'sale', pendingId: 'pc1', source: 'terminal' } });
  let r = await pay({ payment: { method: 'cash', amountTendered: 50 } });
  let t: any = await ticket();
  check('cash on a sale already paid on the card reader is refused, with the payment it was paid with', r.status === 409 && r.body.code === 'ticket_paid' && r.body.paidWith?.id === 'pi_p' && r.body.paidWith?.cents === 4500 && r.body.paidWith?.via === 'card_reader');
  check('…nothing is recorded, and the ticket stays paid', (await all(`${T}/receipts`)).length === 0 && t.status === 'paid_waiting' && t.paymentIntentId === 'pi_p');
  check('…and the desk is told in words', /already paid: \$45\.00 on the card reader/.test(r.body.error || ''), r.body.error);
  paidPi('pi_cof', 4500, { metadata: { kind: 'pos_cof', pendingId: 'pc1' } });
  r = await pay({ payment: { method: 'card_on_file', stripePaymentIntentId: 'pi_cof' } });
  t = await ticket(); let told = await tells();
  check('a saved card charged on top of it is refused too, and that payment is kept apart for a manager', r.status === 409 && r.body.code === 'ticket_paid' && r.body.extra?.id === 'pi_cof' && t.readerExtra?.pi_cof?.state === 'open' && t.readerExtra?.pi_cof?.via === 'card_on_file' && t.readerExtraOpen === true);
  check('…the front desk and managers are told it was paid twice', told.length === 2 && told.every((x: any) => x.type === 'reader_paid_twice' && /on their saved card/.test(x.message)), told.map((x: any) => x.message));
  await pay({ payment: { method: 'card_on_file', stripePaymentIntentId: 'pi_cof' } });
  check('…once', (await tells()).length === 2);
  r = await pay({ payment: { method: 'card', stripePaymentIntentId: 'pi_made_up' } });
  check('a payment Stripe has never heard of is refused and never listed as extra', r.status === 409 && !r.body.extra && !(await ticket()).readerExtra?.pi_made_up);
  r = await pay({ payment: { method: 'terminal', stripePaymentIntentId: 'pi_p' } });
  t = await ticket(); let receipts = await all(`${T}/receipts`);
  check('saving it with the payment it was paid with records the sale', r.status === 200 && r.body.ok && receipts.length === 1 && receipts[0].stripePaymentIntentId === 'pi_p' && receipts[0].pendingId === 'pc1');
  check('…and finishes the ticket in the same save', t.status === 'completed' && t.receiptId === receipts[0].id);
  r = await pay({ payment: { method: 'terminal', stripePaymentIntentId: 'pi_p' } });
  check('saving again (the answer was lost) records nothing twice', r.body.already === true && (await all(`${T}/receipts`)).length === 1);

  await fresh({ ...readerPaid, paidCents: 4000 }); paidPi('pi_p', 4000, { metadata: { kind: 'sale', pendingId: 'pc1', source: 'terminal' } });
  r = await pay({ payment: { method: 'terminal', stripePaymentIntentId: 'pi_p' } });
  receipts = await all(`${T}/receipts`);
  check('charged $40 for a $45 sale: still saved, the receipt flagged with both amounts, and the desk warned', r.status === 200 && receipts[0]?.needsReview === true && receipts[0]?.paidDiffers?.paidCents === 4000 && receipts[0]?.paidDiffers?.dueCents === 4500 && (r.body.warnings || []).some((w: string) => /charged \$40\.00/.test(w)));

  await fresh({ status: 'partial', tenders: [{ id: 'tn1', method: 'cash', amount: 20, tip: 0 }] });
  r = await pay({ payment: { method: 'cash', amountTendered: 45 } });
  check('the whole bill in cash while part of it was paid in a split is refused', r.status === 409 && r.body.code === 'ticket_split' && r.body.paidSoFar === 20);

  await fresh({ ...readerPaid, paymentIntentId: 'pi_q' }); paidPi('pi_q', 4500);
  await db.doc(`${T}/receipts/rc7`).set({ id: 'rc7', stripePaymentIntentId: 'pi_q', total: 45 });
  r = await pay({ payment: { method: 'terminal', stripePaymentIntentId: 'pi_q' } });
  t = await ticket();
  check('the sale was saved but its ticket wasn’t marked: saving again finishes the ticket, nothing twice', r.body.already === true && t.status === 'completed' && t.receiptId === 'rc7' && (await all(`${T}/receipts`)).length === 1);

  console.log('Starting a ticket');
  await fresh({ ...readerPaid, payload: { items: oil }, expectedTotal: 45 });
  r = await prep({ pendingId: 'pc1', items: [...oil, { id: 'p2', type: 'product', quantity: 1, price: 12, name: 'Top coat' }], expectedTotal: 57 });
  t = await ticket();
  check('a paid ticket isn’t changed when the desk keeps it up to date, and the desk hears it’s paid', r.body.paid?.id === 'pi_p' && t.payload.items.length === 1 && t.expectedTotal === 45 && t.status === 'paid_waiting');
  r = await prep({});
  check('the page was reloaded (no ticket): this client’s paid ticket is picked up again', r.body.pendingId === 'pc1' && r.body.paid?.id === 'pi_p');
  await fresh({ status: 'prepared', readerOpen: true, deskId: 'd1', readerPis: { pi_9: { at: new Date().toISOString(), cents: 4500, state: 'started' } } });
  r = await prep({ items: [...oil], expectedTotal: 45, deskId: 'd1' });
  check('…and so is this desk’s own one with a card reader payment still going (so it isn’t charged again)', r.body.pendingId === 'pc1' && !r.body.paid);
  r = await prep({ items: [...oil], expectedTotal: 45, deskId: 'd2' });
  check('…but another desk is never handed it: that desk is still working on it', r.body.pendingId && r.body.pendingId !== 'pc1' && (await ticket()).deskId === 'd1');
  await fresh(readerPaid);
  r = await prep({ pendingId: 'pc1', clientId: 'c2' });
  t = await ticket();
  check('a paid ticket is never reused for the next client: they get a new one', r.body.pendingId && r.body.pendingId !== 'pc1' && t.clientId === 'c1' && t.status === 'paid_waiting');
  check('…and the desk hears the last client’s sale isn’t saved', r.body.left?.pendingId === 'pc1' && r.body.left?.clientName === 'Maya Lopez' && r.body.left?.cents === 4500);
  const jo = r.body.pendingId;
  r = await prep({ pendingId: jo, clientId: 'c1' });
  check('choosing the first client again finds their paid sale', r.body.pendingId === 'pc1' && r.body.paid?.id === 'pi_p');
  check('…and the other client’s unpaid ticket is put away, so it never shows as a sale not recorded', (await ticket(jo))?.status === 'discarded' && (await ticket(jo))?.discardedBy === 'System');
  await fresh({ status: 'discarded' });
  r = await prep({ pendingId: 'pc1' });
  check('a discarded ticket never comes back', r.body.pendingId !== 'pc1' && (await ticket()).status === 'discarded');
  await fresh({ status: 'partial', tenders: [{ id: 'tn1', method: 'cash', amount: 20, tip: 0, label: 'Share 1 of 2' }] });
  r = await prep({ pendingId: 'pc1' });
  check('a split in progress stays a split, and its shares are handed back to the screen', (await ticket()).status === 'partial' && r.body.tenders?.length === 1 && r.body.paidSoFar === 20);

  console.log('Managers');
  await fresh(readerPaid); paidPi('pi_p', 4500);
  await db.doc(`${T}/receipts/rc1`).set({ id: 'rc1', pendingId: 'pc1', total: 45, date: new Date().toISOString() });
  actor = boss;
  r = await pay({ action: 'discard', reason: 'Looks like a duplicate' });
  t = await ticket();
  check('discarding a sale that was in fact recorded refunds nothing, and the ticket is marked finished', r.body.recorded === true && calls.refunds.length === 0 && t.status === 'completed' && t.receiptId === 'rc1');
  await fresh({ ...readerPaid, readerPis: { pi_p: { state: 'captured' } } }); paidPi('pi_p', 4500, { metadata: { kind: 'sale', pendingId: 'pc1', source: 'terminal' } }); actor = boss;
  r = await pay({ action: 'discard', reason: 'Rang it up twice' });
  t = await ticket();
  check('discarding an unrecorded reader sale refunds the card, and its payment is marked refunded', r.body.ok && calls.refunds[0]?.payment_intent === 'pi_p' && t.status === 'discarded' && t.readerPis?.pi_p?.state === 'refunded');
  r = await pay({ action: 'record' });
  check('…a discarded sale can’t be recorded afterwards', r.status === 409);
  await fresh({ status: 'completed', receiptId: 'rc1', paymentIntentId: 'pi_main', readerExtra: { pi_e: { cents: 4500, at: new Date().toISOString(), state: 'open' }, pi_main: { cents: 4500, state: 'open' } }, readerExtraOpen: true }); actor = boss;
  await db.doc(`${T}/receipts/rc2`).set({ id: 'rc2', stripePaymentIntentId: 'pi_e' });
  r = await pay({ action: 'reader_extra', paymentIntentId: 'pi_e', decision: 'refund' });
  check('an “extra” payment that’s on a recorded sale’s receipt isn’t refunded as extra', r.status === 409 && calls.refunds.length === 0 && (await ticket()).readerExtra.pi_e.state === 'on_receipt');
  r = await pay({ action: 'reader_extra', paymentIntentId: 'pi_main', decision: 'refund' });
  check('…nor the payment the sale itself was paid with', r.status === 409 && calls.refunds.length === 0);
  await fresh({ status: 'paid_waiting', paymentIntentId: 'pi_s', paidVia: 'client_screen', paidCents: 5000, paidTip: 5, payload: { items: oil, tip: 0, payment: { method: 'card' } }, expectedTotal: 45 }); paidPi('pi_s', 5000, { metadata: { source: 'client_screen', pendingCheckoutId: 'pc1' } }); actor = boss;
  r = await pay({ action: 'record' });
  receipts = await all(`${T}/receipts`);
  check('recording a client-screen sale later includes the tip the client chose there', r.status === 200 && receipts[0]?.tip === 5 && receipts[0]?.total === 50 && !receipts[0]?.paidDiffers, { status: r.status, body: r.body, tip: receipts[0]?.tip, total: receipts[0]?.total });

  console.log('Split shares');
  await fresh(readerPaid); paidPi('pi_p', 4500); paidPi('pi_share', 2000, { metadata: { kind: 'pos_cof', pendingId: 'pc1', split: '1' } });
  r = await pay({ action: 'tender', method: 'card', amount: 20, stripePaymentIntentId: 'pi_share', via: 'saved_card' });
  t = await ticket();
  check('a split share on a sale already paid is refused, and a card share already charged is kept apart', r.status === 409 && r.body.code === 'ticket_paid' && t.readerExtra?.pi_share?.state === 'open' && !(t.tenders || []).length);

  console.log('The card reader');
  await fresh({ status: 'paid_waiting', paymentIntentId: 'pi_s', paidVia: 'client_screen', paidCents: 4500 }); paidPi('pi_s', 4500);
  r = await begin();
  check('a sale paid on the client screen is never charged on the reader', r.status === 409 && r.body.code === 'ticket_paid' && r.body.paidWith?.id === 'pi_s' && calls.create === 0);
  await fresh({ status: 'partial', tenders: [{ id: 'tn1', method: 'cash', amount: 20 }] });
  r = await begin();
  check('…nor one being split', r.status === 409 && r.body.code === 'ticket_split' && calls.create === 0);
  await fresh({ status: 'discarded' });
  r = await begin();
  check('…nor a discarded one', r.status === 409 && r.body.code === 'sale_discarded' && calls.create === 0);

  await fresh({});
  r = await begin(); const p1 = r.body.paymentIntentId;
  down = true;
  r = await begin();
  check('Stripe can’t be reached about the last payment: nothing new is charged, and the screen is told to check again', r.status === 503 && r.body.code === 'reader_unknown' && r.body.paymentIntentId === p1 && calls.create === 1);
  r = await take(p1);
  check('…capturing then is “not settled yet” (asked again), never “not charged”', r.status === 503 && r.body.charged !== true && r.body.status === 'unknown');
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  await db.doc(`${T}/pendingCheckouts/pc1`).set({ readerPis: { [p1]: { at: ago(15), state: 'started' } }, readerOpen: true }, { merge: true });
  let sw = await sweepReaderPayments(db, 't1', { stripeAccountId: 'acct_1' });
  t = await ticket();
  check('…and the sweep leaves it open for next time instead of marking it “not charged”', t.readerOpen === true && t.readerPis[p1].state === 'started' && sw.checked === 1);
  down = false;
  delete pis[p1];
  await sweepReaderPayments(db, 't1', { stripeAccountId: 'acct_1' });
  t = await ticket();
  check('only Stripe saying it doesn’t exist settles it as not charged', t.readerPis[p1].state === 'not_charged' && t.readerOpen === false);

  await fresh({ status: 'paid_waiting', paymentIntentId: 'pi_r', paidVia: 'card_reader', paidCents: 4500, readerPis: { pi_r: { state: 'captured' } } });
  paidPi('pi_r', 4500, { metadata: { kind: 'sale', pendingId: 'pc1', source: 'terminal' } }); pis.pi_r.latest_charge.amount_refunded = 4500; pis.pi_r.latest_charge.refunded = true;
  r = await take('pi_r');
  check('a refunded reader payment says so when asked about, and can’t pay for the sale', r.status === 409 && r.body.refunded === true && r.body.ok === false);
  r = await begin();
  t = await ticket();
  check('…trying again doesn’t reuse it: the ticket is no longer paid by it and a new payment starts', r.status === 200 && r.body.paymentIntentId !== 'pi_r' && calls.create === 1 && t.readerPis.pi_r.state === 'refunded' && t.paymentIntentId == null && t.refundedPayment?.id === 'pi_r');

  await fresh({});
  r = await begin(); const p2 = r.body.paymentIntentId; pis[p2].status = 'requires_capture'; captureFails = true;
  r = await take(p2);
  check('approved on the reader but the capture failed: “not settled yet” (asked again), not “the card wasn’t charged”', r.status === 503 && r.body.status === 'requires_capture' && r.body.charged !== false);
  captureFails = false;
  r = await take(p2);
  check('…asking again captures it, says what was charged, and records the fee', r.body.ok && r.body.amountCents === 4500 && (await all(`${T}/transactions`)).some((x: any) => x.category === 'Processing Fee' && x.stripePaymentIntentId === p2));

  await fresh({});
  pis.pi_cs = { id: 'pi_cs', status: 'requires_payment_method', amount: 4500, metadata: { tenantId: 't1', source: 'client_screen' } };
  r = await release(req({ tenantId: 't1', paymentIntentId: 'pi_cs' }));
  check('the desk can only call off card reader payments, never a client-screen payment', r.status === 409 && pis.pi_cs.status === 'requires_payment_method' && calls.cancel.length === 0);

  await fresh({});
  pis.pi_s2 = { id: 'pi_s2', status: 'requires_capture', amount: 4500, metadata: { tenantId: 't1', kind: 'sale', pendingId: 'pc1', source: 'terminal' } };
  await db.doc(`${T}/pendingCheckouts/pc1`).set({ readerPis: { pi_s2: { at: ago(15), state: 'started' } }, readerOpen: true }, { merge: true });
  await sweepReaderPayments(db, 't1', { stripeAccountId: 'acct_1' });
  check('a payment the sweep captures has its fee recorded', (await all(`${T}/transactions`)).some((x: any) => x.category === 'Processing Fee' && x.stripePaymentIntentId === 'pi_s2'));
  await fresh({});
  r = await begin(); const p3 = r.body.paymentIntentId; pis[p3].status = 'requires_capture';
  r = await begin();
  check('so does one captured when the desk tries again', r.body.code === 'sale_paid' && (await all(`${T}/transactions`)).some((x: any) => x.category === 'Processing Fee' && x.stripePaymentIntentId === p3));
  await fresh({});
  paidPi('pi_loose', 4500, { metadata: { kind: 'sale' } });
  r = await begin({ previousPaymentIntentId: 'pi_loose' });
  check('a reader payment that doesn’t name this sale is never used for it', r.status === 200 && r.body.paymentIntentId !== 'pi_loose');

  console.log('Paid on the client screen');
  await fresh({});
  let m = await markSalePaid(db, 't1', 'pc1', { id: 'pi_cs1', amount: 5000, amount_received: 5000 }, 'client_screen', { paidTip: 5, paidTipAllocations: { s9: 5 } });
  t = await ticket();
  check('a client-screen payment pays the ticket, with the tip chosen there', m.result === 'waiting' && t.status === 'paid_waiting' && t.paidVia === 'client_screen' && t.paidCents === 5000 && t.paidTip === 5);
  m = await markSalePaid(db, 't1', 'pc1', { id: 'pi_cs2', amount: 5000, amount_received: 5000 }, 'client_screen');
  t = await ticket();
  check('…a second one is kept apart, never replacing the first', m.result === 'paid_twice' && t.paymentIntentId === 'pi_cs1' && t.readerExtra?.pi_cs2?.via === 'client_screen');
  const screenSrc = readFileSync('src/app/api/client-screen/route.ts', 'utf8');
  check('the client screen marks its payments through the same check (never overwriting a paid ticket)', !/status: 'paid_waiting'/.test(screenSrc) && /paidOnScreen\(/.test(screenSrc) && /ticketPayment\(pc\)\) await keepApartPayment/.test(screenSrc));

  console.log('The desk screen');
  const hub = readFileSync('src/components/pos/CheckoutHub.tsx', 'utf8');
  const engine = readFileSync('src/components/pos/usePosEngine.tsx', 'utf8');
  check('a reader payment the server marks “paid twice” is never used to save the sale', /if \(r\.sale === 'paid_twice'\)/.test(hub) && /afterReaderPaid\(result\)/.test(hub));
  check('the last payment’s status is cleared before a new one starts', /terminal\.beginPayment\?\.\(\);[\s\S]{0,120}setCardMode\('terminal'\);[\s\S]{0,80}prepareNow/.test(hub));
  check('every other way to pay checks for an unconfirmed reader payment and an already-paid sale', (hub.match(/payBlockedNow\(\)/g) || []).length >= 6);
  check('the ticket is saved with the sale as it is now (not as it was when the client was chosen)', /buildRef\.current\(paymentData\)/.test(engine) && /buildRef\.current\(\)/.test(engine));
  check('the sale is saved for what the card was actually charged', /amountTendered: charged/.test(hub));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
