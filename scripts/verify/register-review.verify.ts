// Checks the register review's findings stay fixed (each scenario the review reproduced, now refused or handled):
//  1. only a payment taken at the desk for this very sale is accepted, kept apart or refunded from a ticket — never an
//     online order, a gift card bought in the shop, or another sale's payment, whatever id the screen sends
//  2. "Save the paid sale" saves it as it was paid, and only what was added since stays as a new sale
//  3. two saves of the same sale at once record it once
//  4. another desk is never handed a ticket a card reader payment is running on; a finished ticket never swallows a
//     new payment
//  5. saved-card and typed-card payments ask the server first, name their ticket, and are refused on a paid sale
//  6. a manager recording or discarding a sale settles its card reader payments first
//  7. another client always gets a new ticket; a late client-screen payment on a ticket put away brings it back
//  plus: refunded payments, the cash path, legacy desk payments, and a ticket's cart replaced (never merged) on save
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/register-review.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';
import * as webMock from './web-firestore-mock';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
// Transactions as Firestore runs them: writes held until the end, and run again when something read changed meanwhile.
function strict(db: any) {
  db.runTransaction = async (fn: any) => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const reads = new Map<string, string>(); const writes: (() => any)[] = [];
      const tx = {
        get: async (r: any) => { const snap = await r.get(); if (r.path && !r.where) reads.set(r.path, JSON.stringify(db._store.get(r.path) ?? null)); return snap; },
        set: (r: any, v: any, o?: any) => { writes.push(() => r.set(v, o)); },
        update: (r: any, v: any) => { writes.push(() => r.update(v)); },
        create: (r: any, v: any) => { writes.push(() => r.create(v)); },
        delete: (r: any) => { writes.push(() => r.delete()); },
      };
      const out = await fn(tx);
      let changed = false;
      for (const [path, before] of reads) if (JSON.stringify(db._store.get(path) ?? null) !== before) { changed = true; break; }
      if (changed) { await new Promise((r) => setTimeout(r, Math.random() * 3)); continue; }
      for (const w of writes) await w();
      return out;
    }
    throw new Error('transaction kept conflicting');
  };
  return db;
}
let db = strict(makeDb());
const desk: any = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false, caps: [] };
const boss: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
let actor: any = desk;
let pis: Record<string, any> = {};
let n = 0; let down = false;
const calls = { create: [] as any[], capture: [] as string[], cancel: [] as string[], refunds: [] as any[] };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const missing = () => Object.assign(new Error('No such payment_intent'), { code: 'resource_missing', statusCode: 404 });
const offline = () => Object.assign(new Error('An error occurred with our connection to Stripe.'), { type: 'StripeConnectionError' });
const charge = (pi: any) => ({ id: `ch_${pi.id}`, amount: pi.amount, amount_refunded: 0, refunded: false, payment_method_details: { type: 'card' }, metadata: pi.metadata || {},
  balance_transaction: { id: `txn_${pi.id}`, fee: 160, net: pi.amount - 160, amount: pi.amount, fee_details: [] }, payment_intent: pi.id, created: Math.floor(Date.now() / 1000) });
const nowS = () => Math.floor(Date.now() / 1000);
function StripeMock(this: any) {
  return {
    paymentIntents: {
      retrieve: async (id: string) => { if (down) throw offline(); if (!pis[id]) throw missing(); return clone(pis[id]); },
      create: async (p: any) => { if (down) throw offline(); const id = `pi_${++n}`; calls.create.push(p);
        pis[id] = { id, created: nowS(), description: p.description, status: p.confirm ? 'succeeded' : 'requires_payment_method', amount: p.amount, metadata: p.metadata, client_secret: `${id}_secret` };
        if (p.confirm) { pis[id].amount_received = p.amount; pis[id].latest_charge = charge(pis[id]); }
        return clone(pis[id]); },
      capture: async (id: string) => { if (down) throw offline(); calls.capture.push(id); const pi = pis[id]; if (pi.status !== 'requires_capture') throw new Error(`This PaymentIntent could not be captured because it has a status of ${pi.status}.`); pi.status = 'succeeded'; pi.amount_received = pi.amount; pi.latest_charge = charge(pi); return clone(pi); },
      cancel: async (id: string) => { if (down) throw offline(); calls.cancel.push(id); const pi = pis[id]; if (['succeeded', 'canceled'].includes(pi.status)) throw new Error(`You cannot cancel this PaymentIntent because it has a status of ${pi.status}.`); pi.status = 'canceled'; return clone(pi); },
      update: async (id: string, p: any) => { const { metadata, ...rest } = p || {}; Object.assign(pis[id], rest); if (metadata) pis[id].metadata = { ...(pis[id].metadata || {}), ...metadata }; return clone(pis[id]); },   // Stripe merges metadata keys
    },
    balanceTransactions: { retrieve: async (id: string) => ({ id, fee: 160, net: 4340, amount: 4500, fee_details: [] }) },
    customers: { create: async () => ({ id: 'cus_1' }) },
    refunds: { create: async (p: any, o: any) => { calls.refunds.push({ ...p, key: o?.idempotencyKey }); const pi = pis[p.payment_intent]; if (pi?.latest_charge) { pi.latest_charge.amount_refunded = p.amount || pi.amount; pi.latest_charge.refunded = true; } return { id: `re_${calls.refunds.length}` }; } },
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
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://studio.test' } }) as any;
const paidPi = (id: string, cents: number, x: any = {}) => { pis[id] = { created: nowS(), ...x, id, status: 'succeeded', amount: cents, amount_received: cents, metadata: { tenantId: 't1', ...(x.metadata || {}) }, latest_charge: charge({ id, amount: cents, metadata: x.metadata || {} }) }; };
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const oil = [{ id: 'p1', type: 'product', quantity: 1, price: 45, name: 'Cuticle oil' }];
const coat = [{ id: 'p2', type: 'product', quantity: 1, price: 12, name: 'Top coat' }];
const reader = (id = 'pc1') => ({ kind: 'sale', pendingId: id, source: 'terminal' });
const fresh = async (ticket: any = null) => {
  db = strict(makeDb()); pis = {}; n = 0; actor = desk; down = false; calls.create.length = 0; calls.capture.length = 0; calls.cancel.length = 0; calls.refunds.length = 0;
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York', salesTax: { configured: true, productsPct: 0 } });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'front_desk' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com', cardOnFile: { customerId: 'cus_m', paymentMethodId: 'pm_m', brand: 'visa', last4: '4242' } });
  await db.doc(`${T}/clients/c2`).set({ name: 'Jo Kim', email: 'jo@example.com' });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Cuticle oil', msrp: 45, totalStock: 10 });
  await db.doc(`${T}/inventory/p2`).set({ name: 'Top coat', msrp: 12, totalStock: 10 });
  if (ticket) await db.doc(`${T}/pendingCheckouts/pc1`).set({ id: 'pc1', status: 'prepared', clientId: 'c1', clientName: 'Maya Lopez', expectedTotal: 45, preparedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    payload: { clientId: 'c1', items: oil, payment: { method: 'terminal' } }, ...ticket });
};
const ticket = (id = 'pc1') => get(`${T}/pendingCheckouts/${id}`);
const readerPaid = { status: 'paid_waiting', paymentIntentId: 'pi_p', paidVia: 'card_reader', paidCents: 4500, paidAt: ago(1), readerPis: { pi_p: { state: 'captured', at: ago(1) } } };
const stock = async (id: string) => (await get(`${T}/inventory/${id}`)).totalStock;

(async () => {
  const { POST: complete } = await import('../../src/app/api/checkout/complete/route');
  const { POST: chargeCard } = await import('../../src/app/api/stripe/charge-card/route');
  const { POST: typedCard } = await import('../../src/app/api/stripe/pos-payment-intent/route');
  const { POST: screenRoute } = await import('../../src/app/api/client-screen/route');
  const { sweepReaderPayments, markSalePaid } = await import('../../src/lib/reader-sale');
  const pay = (body: any) => complete(req({ tenantId: 't1', pendingId: 'pc1', clientId: 'c1', items: oil, expectedTotal: 45, ...body })) as any;
  const prep = (body: any) => complete(req({ tenantId: 't1', action: 'prepare', clientId: 'c1', items: oil, expectedTotal: 45, ...body })) as any;

  console.log('1. Only this sale’s own desk payments');
  await fresh(readerPaid); paidPi('pi_p', 4500, { metadata: reader() });
  paidPi('pi_online', 30000, { metadata: { type: 'retail_order', retailOrderId: 'o77' } });
  let r = await pay({ payment: { method: 'card', stripePaymentIntentId: 'pi_online' } });
  let t: any = await ticket();
  let told = (await all(`${T}/notifications`)).filter((x: any) => x.type === 'reader_paid_twice');
  check('an online order’s payment sent from the desk on a paid sale is refused, never listed as extra, and nobody is told', r.status === 409 && r.body.code === 'ticket_paid' && !r.body.extra && !t.readerExtra?.pi_online && told.length === 0, { body: r.body, extra: t.readerExtra });
  actor = boss;
  r = await pay({ action: 'reader_extra', paymentIntentId: 'pi_online', decision: 'refund' });
  check('…so a manager can’t refund it from here', r.status === 404 && calls.refunds.length === 0);
  paidPi('pi_cof2', 4500, { metadata: { kind: 'pos_cof', pendingId: 'pc_other' } }); actor = desk;
  r = await pay({ payment: { method: 'card_on_file', stripePaymentIntentId: 'pi_cof2' } });
  check('…nor another sale’s saved-card payment', r.status === 409 && !r.body.extra && !(await ticket()).readerExtra?.pi_cof2);

  await fresh({});
  paidPi('pi_gift', 30000, { metadata: { type: 'gift_card', giftOrderId: 'g1' } });
  r = await pay({ payment: { method: 'card', stripePaymentIntentId: 'pi_gift' }, staffDiscount: { kind: 'pct', value: 50, reason: 'x' } });
  t = await ticket();
  check('a gift card bought online sent as a sale’s payment is refused before anything, and never stored on the ticket', r.status === 409 && r.body.code === 'payment_invalid' && !t.paymentIntentId && t.status === 'prepared', { status: r.status, body: r.body, t: { status: t.status, pi: t.paymentIntentId } });
  actor = boss;
  r = await pay({ action: 'discard', reason: 'did not go through' });
  check('…and discarding the ticket refunds nothing', r.status === 200 && calls.refunds.length === 0, { body: r.body, refunds: calls.refunds });

  await fresh({}); actor = desk;
  paidPi('pi_mine', 4500, { metadata: { kind: 'pos_cof', pendingId: 'pc1' } });
  r = await pay({ payment: { method: 'card_on_file', stripePaymentIntentId: 'pi_mine' }, staffDiscount: { kind: 'pct', value: 50, reason: 'x' } });
  t = await ticket();
  check('this sale’s own saved-card payment, when the save fails: kept on the ticket so a manager can record it', r.status === 403 && t.status === 'failed' && t.paymentIntentId === 'pi_mine' && t.paidVia === 'card_on_file', { status: r.status, t: { status: t.status, pi: t.paymentIntentId, via: t.paidVia } });
  actor = boss;
  r = await pay({ action: 'discard', reason: 'client changed their mind' });
  check('…and discarding it refunds that payment', r.status === 200 && calls.refunds.length === 1 && calls.refunds[0].payment_intent === 'pi_mine');

  await fresh({ status: 'partial', tenders: [{ id: 'tn1', method: 'card', amount: 30, tip: 0, stripePaymentIntentId: 'pi_web', via: 'card' }] });
  paidPi('pi_web', 3000, { metadata: { type: 'retail_order', retailOrderId: 'o9' } });
  r = await pay({ action: 'tender_remove', tenderId: 'tn1' });
  check('a split share whose payment is an online order’s is never refunded from Split the bill', r.status === 409 && calls.refunds.length === 0, { body: r.body });
  paidPi('pi_web2', 3000, { metadata: { type: 'retail_order', retailOrderId: 'o10' } });
  r = await pay({ action: 'tender', method: 'card', amount: 30, stripePaymentIntentId: 'pi_web2' });
  check('…and an online order’s payment can’t be added as a share', r.status === 409 && (await ticket()).tenders.length === 1);
  paidPi('pi_sh', 1500, { metadata: { kind: 'pos_cof', pendingId: 'pc1', split: '1' } });
  r = await pay({ action: 'tender', method: 'card', amount: 15, stripePaymentIntentId: 'pi_sh', via: 'saved_card' });
  check('…while this sale’s own share is', r.status === 200 && (await ticket()).tenders.length === 2);
  r = await pay({ payment: { method: 'card', stripePaymentIntentId: 'pi_sh' }, items: oil });
  check('a share’s payment can’t pay for the whole sale', r.status === 409);

  console.log('2. Save the paid sale');
  await fresh({ ...readerPaid, payload: { clientId: 'c1', items: oil, payment: { method: 'terminal' } } }); paidPi('pi_p', 4500, { metadata: reader() });
  r = await prep({ pendingId: 'pc1', items: [...oil, ...coat], expectedTotal: 57 });
  check('the desk hears the sale is paid, and what it was rung up with', r.body.paid?.id === 'pi_p' && r.body.paidPayload?.items?.length === 1 && r.body.paidPayload.items[0].id === 'p1' && r.body.paidPayload.items[0].name === 'Cuticle oil', r.body);
  r = await pay({ action: 'record' });
  let rc = await all(`${T}/receipts`);
  check('the front desk saves the paid sale as it was paid: one receipt, with its payment, the oil only', r.status === 200 && r.body.ok && rc.length === 1 && rc[0].stripePaymentIntentId === 'pi_p' && rc[0].id === 'tk_pc1' && (await stock('p1')) === 9 && (await stock('p2')) === 10, { status: r.status, body: r.body, rc: rc.length });
  r = await complete(req({ tenantId: 't1', clientId: 'c1', items: coat, expectedTotal: 12, payment: { method: 'cash', amountTendered: 12 } })) as any;
  rc = await all(`${T}/receipts`);
  check('…what was added after it was paid is its own sale', r.status === 200 && rc.length === 2 && (await stock('p1')) === 9 && (await stock('p2')) === 9, { body: r.body });
  await fresh({}); r = await pay({ action: 'record' });
  check('the front desk can’t record a sale nobody paid at the desk', r.status === 403);
  await fresh(readerPaid); r = await pay({ action: 'discard', reason: 'x' });
  check('…nor discard one', r.status === 403);
  const hub = readFileSync('src/components/pos/CheckoutHub.tsx', 'utf8'); const engine = readFileSync('src/components/pos/usePosEngine.tsx', 'utf8');
  check('“Start a separate sale” is gone; the banner saves the paid sale', !/separateSale|Start a separate sale/.test(hub + engine) && /Save the paid sale/.test(hub) && /savePaidSale/.test(engine));
  check('…and keeps in the cart only what wasn’t on the paid sale', /paidQty/.test(engine) && /itemsLeft/.test(engine) && /visitsLeft/.test(engine));

  console.log('3. Two saves at once');
  await fresh(readerPaid); paidPi('pi_p', 4500, { metadata: reader() }); actor = boss;
  const [a3, b3] = await Promise.all([pay({ payment: { method: 'terminal', stripePaymentIntentId: 'pi_p' } }), pay({ action: 'record' })]);
  rc = await all(`${T}/receipts`);
  check('the desk saving and a manager recording the same sale at once: one receipt, stock counted once', rc.length === 1 && (await stock('p1')) === 9 && a3.body.ok && b3.body.ok, { a: a3.body, b: b3.body, receipts: rc.length, stock: await stock('p1') });
  await fresh({}); actor = desk;
  const [a4, b4] = await Promise.all([pay({ payment: { method: 'cash', amountTendered: 45 } }), pay({ payment: { method: 'cash', amountTendered: 45 } })]);
  rc = await all(`${T}/receipts`);
  check('…and two cash saves of one ticket at once: one receipt', rc.length === 1 && (await stock('p1')) === 9, { a: a4.body, b: b4.body, receipts: rc.length });

  console.log('4. Another desk, and a finished ticket');
  await fresh({ status: 'prepared', readerOpen: true, deskId: 'd1', readerPis: { pi_d1: { at: ago(0), cents: 4500, state: 'started' } }, payload: { clientId: 'c1', items: oil } });
  r = await prep({ items: coat, expectedTotal: 12, deskId: 'd2' });
  t = await ticket();
  check('desk 2 opening the same client gets its own ticket; desk 1’s cart is untouched', r.body.pendingId && r.body.pendingId !== 'pc1' && t.payload.items[0].id === 'p1' && t.expectedTotal === 45, { pid: r.body.pendingId, items: t.payload.items });
  await db.doc(`${T}/pendingCheckouts/pc1`).set({ status: 'completed', receiptId: 'tk_pc1', paymentIntentId: 'pi_d1' }, { merge: true });
  paidPi('pi_cof3', 1200, { metadata: { kind: 'pos_cof', pendingId: 'pc1' } });
  r = await pay({ items: coat, expectedTotal: 12, payment: { method: 'card_on_file', stripePaymentIntentId: 'pi_cof3' } });
  rc = await all(`${T}/receipts`);
  t = await ticket();
  check('a payment charged again on a ticket another screen had finished: kept apart for a manager (never “already recorded”, never a second sale)', r.status === 409 && r.body.code === 'sale_done' && r.body.extra?.id === 'pi_cof3' && !rc.some((x: any) => x.stripePaymentIntentId === 'pi_cof3') && t.readerExtra?.pi_cof3?.state === 'open', { body: r.body, rc: rc.length });

  console.log('5. Saved and typed cards ask first');
  await fresh(readerPaid); paidPi('pi_p', 4500, { metadata: reader() });
  r = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 4500, description: 'Studio Services — POS Checkout', noLedger: true, pendingId: 'pc1' })) as any;
  check('the saved card is never charged for a sale already paid', r.status === 409 && r.body.code === 'ticket_paid' && r.body.paidWith?.id === 'pi_p' && calls.create.length === 0, r.body);
  r = await typedCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 4500, pendingId: 'pc1' })) as any;
  check('…nor is a typed card started for it', r.status === 409 && r.body.code === 'ticket_paid' && calls.create.length === 0, r.body);
  await fresh({});
  r = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 4500, description: 'Studio Services — POS Checkout', noLedger: true, pendingId: 'pc1' })) as any;
  t = await ticket();
  check('a saved-card charge names its ticket, and the ticket shows it’s paid the moment it goes through', r.body.ok && calls.create[0]?.metadata?.pendingId === 'pc1' && t.status === 'paid_waiting' && t.paymentIntentId === r.body.paymentIntentId && t.paidVia === 'card_on_file', { body: r.body, t });
  const cofPi = r.body.paymentIntentId;
  r = await pay({ payment: { method: 'card_on_file', stripePaymentIntentId: cofPi } });
  check('…and the sale saves with it', r.status === 200 && (await all(`${T}/receipts`))[0]?.stripePaymentIntentId === cofPi);
  await fresh({});
  r = await typedCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 4500, pendingId: 'pc1' })) as any;
  check('a typed card names its ticket', r.status === 200 && calls.create[0]?.metadata?.pendingId === 'pc1' && calls.create[0]?.metadata?.source === 'pos_embedded');
  await fresh({ status: 'partial', tenders: [{ id: 'tn1', method: 'cash', amount: 20, tip: 0 }] });
  r = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 4500, description: 'Studio Services — POS Checkout', noLedger: true, pendingId: 'pc1' })) as any;
  check('the whole bill isn’t charged on a saved card while it’s being split', r.status === 409 && r.body.code === 'ticket_split' && calls.create.length === 0);
  r = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 2500, description: 'Share of a split bill — Share 2 of 2', noLedger: true, pendingId: 'pc1', share: true })) as any;
  check('…but a share is, marked as a share and never as the whole sale', r.body.ok && calls.create[0]?.metadata?.split === '1' && !(await ticket()).paymentIntentId);
  await fresh({ status: 'prepared', readerOpen: true, readerPis: { pi_rd: { at: ago(1), cents: 4500, state: 'started' } } });
  pis.pi_rd = { id: 'pi_rd', created: nowS(), status: 'requires_capture', amount: 4500, metadata: { tenantId: 't1', ...reader() } };
  r = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 4500, description: 'Studio Services — POS Checkout', noLedger: true, pendingId: 'pc1' })) as any;
  check('a card reader payment approved for the sale isn’t finished: the saved card isn’t charged, the desk checks the reader first', r.status === 409 && r.body.code === 'reader_open' && calls.create.length === 0 && pis.pi_rd.status === 'requires_capture', r.body);
  pis.pi_rd.status = 'requires_payment_method';
  r = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 4500, description: 'Studio Services — POS Checkout', noLedger: true, pendingId: 'pc1' })) as any;
  check('…one never finished on the reader is called off first, so it can’t complete later', r.body.ok && pis.pi_rd.status === 'canceled' && (await ticket()).readerPis.pi_rd.state === 'released', r.body);

  console.log('6. A manager recording or discarding');
  await fresh({ status: 'prepared', readerOpen: true, readerPis: { pi_h: { at: ago(11), cents: 4500, state: 'started' } }, updatedAt: ago(11) });
  pis.pi_h = { id: 'pi_h', created: nowS(), status: 'requires_capture', amount: 4500, metadata: { tenantId: 't1', ...reader() } }; actor = boss;
  r = await pay({ action: 'record' });
  rc = await all(`${T}/receipts`);
  check('recording a sale whose reader payment was approved but not captured captures it and records the sale with it', r.status === 200 && rc.length === 1 && rc[0].stripePaymentIntentId === 'pi_h' && pis.pi_h.status === 'succeeded', { body: r.body, rc: rc.map((x: any) => x.stripePaymentIntentId) });
  await sweepReaderPayments(db, 't1', { stripeAccountId: 'acct_1' });
  check('…and the sweep leaves it alone afterwards', calls.cancel.length === 0 && !(await ticket()).readerExtra);
  await fresh({ status: 'prepared', readerOpen: true, readerPis: { pi_m: { at: ago(11), cents: 4500, state: 'started' } }, updatedAt: ago(11) });
  paidPi('pi_m', 4500, { metadata: reader() }); actor = boss;
  r = await pay({ action: 'record' });
  await sweepReaderPayments(db, 't1', { stripeAccountId: 'acct_1' });
  t = await ticket(); rc = await all(`${T}/receipts`);
  check('a reader payment captured but never marked: recorded with the sale, never flagged as paid twice', r.status === 200 && rc[0]?.stripePaymentIntentId === 'pi_m' && !t.readerExtra?.pi_m, { body: r.body, extra: t.readerExtra });
  await fresh({ status: 'prepared', readerOpen: true, readerPis: { pi_h2: { at: ago(11), cents: 4500, state: 'started' } }, updatedAt: ago(11) });
  pis.pi_h2 = { id: 'pi_h2', created: nowS(), status: 'requires_capture', amount: 4500, metadata: { tenantId: 't1', ...reader() } }; actor = boss;
  r = await pay({ action: 'discard', reason: 'Rang it up by mistake' });
  check('discarding one releases the approved hold, so it can’t complete later', r.status === 200 && pis.pi_h2.status === 'canceled' && calls.capture.length === 0);
  await fresh({ status: 'prepared', readerOpen: true, readerPis: { pi_x: { at: ago(11), cents: 4500, state: 'started' } }, updatedAt: ago(11) });
  pis.pi_x = { id: 'pi_x', created: nowS(), status: 'requires_capture', amount: 4500, metadata: { tenantId: 't1', ...reader() } }; actor = boss; down = true;
  r = await pay({ action: 'record' });
  check('Stripe can’t be reached about it: nothing is recorded yet', r.status === 503 && (await all(`${T}/receipts`)).length === 0);
  down = false;
  await fresh({ updatedAt: ago(11) }); actor = boss;
  r = await pay({ action: 'record' });
  check('nothing paid at the desk: the manager says how it was paid (never recorded as a card sale with no payment)', r.status === 400 && r.body.code === 'say_how' && (await all(`${T}/receipts`)).length === 0);
  r = await pay({ action: 'record', paidAs: 'cash' });
  rc = await all(`${T}/receipts`);
  check('…“paid in cash” records it as cash', r.status === 200 && rc[0]?.paymentMethod === 'cash' && !rc[0]?.stripePaymentIntentId);
  const ops = readFileSync('src/components/ops/OpsBoard.tsx', 'utf8');
  check('…and Needs attention asks how it was paid', /Paid in cash — record it/.test(ops) && /Paid another way — record it/.test(ops) && /paidAs/.test(ops));
  await fresh({ status: 'completed', receiptId: 'rc0', payload: { clientId: 'c1', items: oil } });
  paidPi('pi_late', 4500, { metadata: reader() });
  await markSalePaid(db, 't1', 'pc1', pis.pi_late, 'card_reader');
  check('a payment that lands on a sale saved without a card says so, so the right one is refunded', (await ticket()).readerExtra?.pi_late?.hint === 'saved_without_card');

  console.log('7. Another client, and a late client-screen payment');
  await fresh({ payload: { clientId: 'c1', items: oil } });
  r = await prep({ pendingId: 'pc1', clientId: 'c2', items: coat, expectedTotal: 12 });
  t = await ticket();
  check('the next client always gets a new ticket; the first one’s unpaid ticket is put away', r.body.pendingId !== 'pc1' && t.clientId === 'c1' && t.status === 'discarded' && t.discardedBy === 'System');
  const jo = r.body.pendingId;
  paidPi('pi_scr', 4500, { metadata: { source: 'client_screen', pendingCheckoutId: 'pc1' } });
  const ms = await markSalePaid(db, 't1', 'pc1', pis.pi_scr, 'client_screen');
  t = await ticket();
  check('Maya finishes paying on the iPad after the desk moved on: her sale comes back as paid, to be recorded', ms.result === 'waiting' && ms.revived === true && t.status === 'paid_waiting' && t.paymentIntentId === 'pi_scr' && !t.discardedAt);
  r = await prep({ pendingId: jo, clientId: 'c2', items: coat, expectedTotal: 12 });
  check('…and Jo’s sale isn’t touched by it', r.body.pendingId === jo && !r.body.paid && (await ticket(jo)).clientId === 'c2');
  await fresh(readerPaid); paidPi('pi_p', 4500, { metadata: reader() });
  r = await pay({ clientId: 'c2', items: coat, expectedTotal: 12, payment: { method: 'terminal', stripePaymentIntentId: 'pi_p' } });
  check('Maya’s card payment is never used to save Jo’s sale', r.status === 409 && r.body.code === 'payment_other_client' && (await all(`${T}/receipts`)).length === 0, r.body);
  await fresh({ payload: { clientId: 'c1', items: oil } });
  r = await pay({ clientId: 'c2', items: coat, expectedTotal: 12, payment: { method: 'cash', amountTendered: 12 } });
  rc = await all(`${T}/receipts`); t = await ticket();
  check('Jo’s cash sale saved with Maya’s unpaid ticket still named: recorded on its own, Maya’s ticket put away', r.status === 200 && rc.length === 1 && rc[0].clientId === 'c2' && rc[0].id !== 'tk_pc1' && t.status === 'discarded', { body: r.body, t: t.status });

  console.log('The client screen');
  await fresh({ status: 'partial', tenders: [{ id: 'tn1', method: 'cash', amount: 20, tip: 0 }] });
  await db.doc('clientScreens/scr1scr1scr1scr1scr1scr1scr1scr1').set({ tenantId: 't1', name: 'iPad', phase: 'idle', request: null });
  r = await screenRoute(req({ tenantId: 't1', action: 'request', screenId: 'scr1scr1scr1scr1scr1scr1scr1scr1', kind: 'pay', amount: 25, splitPendingId: 'pc1', shareLabel: 'Share 2 of 2' })) as any;
  check('a split share paid on the client screen names its ticket and says it’s a share', r.body.ok && calls.create[0]?.metadata?.pendingCheckoutId === 'pc1' && calls.create[0]?.metadata?.split === '1', { body: r.body, meta: calls.create[0]?.metadata });
  await fresh(readerPaid); paidPi('pi_p', 4500, { metadata: reader() });
  await db.doc('clientScreens/scr1scr1scr1scr1scr1scr1scr1scr1').set({ tenantId: 't1', name: 'iPad', phase: 'idle', request: null });
  r = await screenRoute(req({ tenantId: 't1', action: 'request', screenId: 'scr1scr1scr1scr1scr1scr1scr1scr1', kind: 'pay', amount: 45, pendingId: 'pc1' })) as any;
  check('…and a sale already paid is never sent to the client screen to pay again', r.status === 409 && r.body.code === 'ticket_paid' && calls.create.length === 0, r.body);

  console.log('Refunded payments, the cash path, older screens, and saving a ticket');
  await fresh({ status: 'paid_waiting', paymentIntentId: 'pi_rf', paidVia: 'card_on_file', paidCents: 4500, paidAt: ago(1) });
  paidPi('pi_rf', 4500, { metadata: { kind: 'pos_cof', pendingId: 'pc1' } }); pis.pi_rf.latest_charge.amount_refunded = 4500; pis.pi_rf.latest_charge.refunded = true;
  r = await pay({ payment: { method: 'card_on_file', stripePaymentIntentId: 'pi_rf' } });
  t = await ticket();
  check('a ticket’s payment refunded in Stripe itself never saves the sale, and the ticket can be paid again', r.status === 409 && r.body.code === 'payment_refunded' && t.status === 'prepared' && !t.paymentIntentId && t.refundedPayment?.id === 'pi_rf', { body: r.body, t: { status: t.status, pi: t.paymentIntentId } });
  await fresh({ ...readerPaid, deskId: 'd1' }); paidPi('pi_p', 4500, { metadata: reader() });
  r = await complete(req({ tenantId: 't1', clientId: 'c1', items: oil, expectedTotal: 45, deskId: 'd2', payment: { method: 'cash', amountTendered: 45 } })) as any;
  check('cash for a client whose sale was already paid on another screen is refused, and the desk is pointed to that sale', r.status === 409 && r.body.code === 'ticket_paid' && r.body.pendingId === 'pc1' && r.body.paidPayload?.items?.[0]?.id === 'p1' && (await all(`${T}/receipts`)).length === 0, r.body);
  check('…and the desk saves the ticket first for cash, so it finds that sale before taking the money', /paymentMethod !== 'split'\) \{\s*await prepareNow\(paymentData\)/.test(engine));
  await fresh({});
  paidPi('pi_old', 4500, { description: 'Studio Services — POS Checkout — Studio Services', metadata: { kind: 'pos_cof', clientId: 'c1' } });
  r = await pay({ payment: { method: 'card_on_file', stripePaymentIntentId: 'pi_old' } });
  check('a saved-card payment from a desk screen opened before payments named their ticket still saves its sale', r.status === 200 && (await all(`${T}/receipts`))[0]?.stripePaymentIntentId === 'pi_old', r.body);
  await fresh({});
  paidPi('pi_old2', 4500, { description: 'Studio Services — POS Checkout — Studio Services', metadata: { kind: 'pos_cof', clientId: 'c1' } }); pis.pi_old2.created = nowS() - 3 * 86400;
  r = await pay({ payment: { method: 'card_on_file', stripePaymentIntentId: 'pi_old2' } });
  check('…but only a recent one', r.status === 409);
  await fresh({ payload: { clientId: 'c1', items: oil, tipAllocations: { s9: 5 }, waivers: { a1: { reason: 'x' } } } });
  r = await prep({ pendingId: 'pc1', tipAllocations: {}, waivers: {} });
  t = await ticket();
  check('saving a ticket again replaces what it was rung up with (old tip shares and waivers don’t linger)', !t.payload.tipAllocations?.s9 && !t.payload.waivers?.a1, t.payload);
  await fresh({});
  paidPi('pi_c', 4000, { metadata: { kind: 'pos_cof', pendingId: 'pc1' } });
  r = await pay({ payment: { method: 'card_on_file', stripePaymentIntentId: 'pi_c' } });
  rc = await all(`${T}/receipts`);
  check('a saved card charged $40 for a $45 sale: saved, and the receipt flagged with both amounts', r.status === 200 && rc[0]?.paidDiffers?.paidCents === 4000 && rc[0]?.paidDiffers?.dueCents === 4500);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
