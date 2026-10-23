// Checks the fifth register review's findings stay fixed (each scenario the review reproduced, now handled):
//  1. a split share refunded (by a discard that failed or stopped partway, at the desk, or in Stripe) never pays for the
//     sale, and a repeated notice never puts a refunded share back
//  2. a paid sale that shares a visit, a fee or an item with the cart is this sale, however it was rung up again
//  3. a discard that lost its hold refunds nothing more; one that can't start lets the sale go again
//  4. a share taken off the split is claimed first, so it's never refunded off a recorded receipt
//  5. a share paid as the desk cancels it is on the split, and a second one for the same share is refused
//  6. a split saved while one of its payments changed records nothing (it's finished again)
//  7. an extra payment on a receipt is never kept (counted twice) or refunded; one refunded in Stripe is never kept
//  8. the client screen isn't asked again for a sale its last payment just paid
//  9. "Save again" after a lost answer says it's saved; a promoted payment keeps its tip; a share is never promoted
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/register-review4.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';
import * as webMock from './web-firestore-mock';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_x';
// Transactions as Firestore runs them: writes held until the end, run again when something read changed meanwhile, and
// no read after a write.
const readAfterWrite: string[] = [];
function strict(db: any) {
  db.runTransaction = async (fn: any) => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const reads = new Map<string, string>(); const writes: (() => any)[] = []; let wrote = false;
      const tx = {
        get: async (r: any) => { if (wrote) readAfterWrite.push(String(r.path)); const snap = await r.get(); if (r.path && !r.where) reads.set(r.path, JSON.stringify(db._store.get(r.path) ?? null)); return snap; },
        set: (r: any, v: any, o?: any) => { wrote = true; writes.push(() => r.set(v, o)); },
        update: (r: any, v: any) => { wrote = true; writes.push(() => r.update(v)); },
        create: (r: any, v: any) => { wrote = true; writes.push(() => r.create(v)); },
        delete: (r: any) => { wrote = true; writes.push(() => r.delete()); },
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
let n = 0; let down = false; let beforeRetrieve: null | (() => Promise<void>) = null; let beforeRefund: null | (() => Promise<void>) = null; const failRefund = new Set<string>();
const idem = new Map<string, { params: string; id: string }>();
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
      retrieve: async (id: string) => { if (beforeRetrieve) { const f = beforeRetrieve; beforeRetrieve = null; await f(); } if (down) throw offline(); if (!pis[id]) throw missing(); return clone(pis[id]); },
      // Stripe's idempotency keys: the same key with the same request gives the same payment; with another, an error.
      create: async (p: any, o: any = {}) => { if (down) throw offline();
        if (o?.idempotencyKey) { const prev = idem.get(o.idempotencyKey); const params = JSON.stringify(p);
          if (prev) { if (prev.params !== params) throw Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters they were first used with.'), { type: 'StripeIdempotencyError', code: 'idempotency_error' }); return clone(pis[prev.id]); } }
        const id = `pi_${++n}`; calls.create.push(p);
        pis[id] = { id, created: nowS(), description: p.description, status: p.confirm ? 'succeeded' : 'requires_payment_method', amount: p.amount, metadata: p.metadata, client_secret: `${id}_secret` };
        if (p.confirm) { pis[id].amount_received = p.amount; pis[id].latest_charge = charge(pis[id]); }
        if (o?.idempotencyKey) idem.set(o.idempotencyKey, { params: JSON.stringify(p), id });
        return clone(pis[id]); },
      capture: async (id: string) => { if (down) throw offline(); calls.capture.push(id); const pi = pis[id]; if (pi.status !== 'requires_capture') throw new Error(`This PaymentIntent could not be captured because it has a status of ${pi.status}.`); pi.status = 'succeeded'; pi.amount_received = pi.amount; pi.latest_charge = charge(pi); return clone(pi); },
      cancel: async (id: string) => { if (down) throw offline(); calls.cancel.push(id); const pi = pis[id]; if (['succeeded', 'canceled'].includes(pi.status)) throw new Error(`You cannot cancel this PaymentIntent because it has a status of ${pi.status}.`); pi.status = 'canceled'; return clone(pi); },
      update: async (id: string, p: any) => { const { metadata, ...rest } = p || {}; Object.assign(pis[id], rest); if (metadata) pis[id].metadata = { ...(pis[id].metadata || {}), ...metadata }; return clone(pis[id]); },   // Stripe merges metadata keys
    },
    paymentMethods: { retrieve: async (id: string) => ({ id, card: { brand: 'visa', last4: '4242' } }) },
    balanceTransactions: { retrieve: async (id: string) => ({ id, fee: 160, net: 4340, amount: 4500, fee_details: [] }) },
    customers: { create: async () => ({ id: 'cus_1' }) },
    refunds: { create: async (p: any, o: any) => { if (beforeRefund) { const f = beforeRefund; beforeRefund = null; await f(); } if (down || failRefund.has(p.payment_intent)) throw offline(); calls.refunds.push({ ...p, key: o?.idempotencyKey }); const pi = pis[p.payment_intent]; if (pi?.latest_charge) { pi.latest_charge.amount_refunded = p.amount || pi.amount; pi.latest_charge.refunded = true; } return { id: `re_${calls.refunds.length}` }; } },
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
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
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : String(k).toLowerCase() === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://studio.test' } }) as any;
const paidPi = (id: string, cents: number, x: any = {}) => { pis[id] = { created: nowS(), ...x, id, status: 'succeeded', amount: cents, amount_received: cents, metadata: { tenantId: 't1', ...(x.metadata || {}) }, latest_charge: charge({ id, amount: cents, metadata: x.metadata || {} }) }; };
const succeed = (id: string, cents: number) => { Object.assign(pis[id], { status: 'succeeded', amount: cents, amount_received: cents }); pis[id].latest_charge = charge(pis[id]); };
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const oil = [{ id: 'p1', type: 'product', quantity: 1, price: 45, name: 'Cuticle oil' }];
const coat = [{ id: 'p2', type: 'product', quantity: 1, price: 12, name: 'Top coat' }];
const reader = (id = 'pc1') => ({ kind: 'sale', pendingId: id, source: 'terminal' });
const SCREEN = 'scr1scr1scr1scr1scr1scr1scr1scr1';
const fresh = async (ticket: any = null) => {
  db = strict(makeDb()); pis = {}; n = 0; actor = desk; down = false; beforeRetrieve = null; beforeRefund = null; failRefund.clear(); idem.clear(); calls.create.length = 0; calls.capture.length = 0; calls.cancel.length = 0; calls.refunds.length = 0;
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York', salesTax: { configured: true, productsPct: 0 } });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'front_desk' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com', cardOnFile: { customerId: 'cus_m', paymentMethodId: 'pm_m', brand: 'visa', last4: '4242' } });
  await db.doc(`${T}/clients/c2`).set({ name: 'Jo Kim', email: 'jo@example.com', cardOnFile: { customerId: 'cus_j', paymentMethodId: 'pm_j', brand: 'visa', last4: '1111' } });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Cuticle oil', msrp: 45, totalStock: 10 });
  await db.doc(`${T}/inventory/p2`).set({ name: 'Top coat', msrp: 12, totalStock: 10 });
  if (ticket) await db.doc(`${T}/pendingCheckouts/pc1`).set({ id: 'pc1', status: 'prepared', clientId: 'c1', clientName: 'Maya Lopez', expectedTotal: 45, preparedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    payload: { clientId: 'c1', items: oil, payment: { method: 'terminal' } }, ...ticket });
};
const ticket = (id = 'pc1') => get(`${T}/pendingCheckouts/${id}`);
const stock = async (id: string) => (await get(`${T}/inventory/${id}`)).totalStock;
const readerPaid = { status: 'paid_waiting', paymentIntentId: 'pi_p', paidVia: 'card_reader', paidCents: 4500, paidAt: ago(1), readerPis: { pi_p: { state: 'captured', at: ago(1) } } };
const outcome = (id = 'pc1') => db.doc(`${T}/pendingCheckouts/${id}/outcome/final`);

(async () => {
  const { POST: complete } = await import('../../src/app/api/checkout/complete/route');
  const { POST: chargeCard } = await import('../../src/app/api/stripe/charge-card/route');
  const { POST: screenRoute } = await import('../../src/app/api/client-screen/route');
  const { POST: webhook } = await import('../../src/app/api/stripe/connect-webhook/route');
  const { markSalePaid } = await import('../../src/lib/reader-sale');
  const pay = (body: any) => complete(req({ tenantId: 't1', pendingId: 'pc1', clientId: 'c1', items: oil, expectedTotal: 45, ...body })) as any;
  const prep = (body: any) => complete(req({ tenantId: 't1', action: 'prepare', clientId: 'c1', items: oil, expectedTotal: 45, ...body })) as any;
  const screen = (body: any) => screenRoute(req({ tenantId: 't1', screenId: SCREEN, ...body })) as any;
  const pairScreen = () => db.doc(`clientScreens/${SCREEN}`).set({ tenantId: 't1', name: 'iPad', phase: 'idle', request: null });
  const hook = (ch: any) => webhook(req({ type: 'charge.succeeded', account: 'acct_1', data: { object: ch } })) as any;
  const routeSrc = readFileSync('src/app/api/checkout/complete/route.ts', 'utf8'); const libSrc = readFileSync('src/lib/reader-sale.ts', 'utf8');
  const splitSrc = readFileSync('src/components/pos/SplitBill.tsx', 'utf8'); const hub = readFileSync('src/components/pos/CheckoutHub.tsx', 'utf8');
  const shareA = { id: 'tnA', method: 'card', amount: 22.5, tip: 0, stripePaymentIntentId: 'pi_A', via: 'saved_card', label: 'Share 1 of 2' };
  const shareB = { id: 'tnB', method: 'card', amount: 22.5, tip: 0, stripePaymentIntentId: 'pi_B', via: 'saved_card', label: 'Share 2 of 2' };
  const cashB = { id: 'tnB', method: 'cash', amount: 22.5, tip: 0, label: 'Share 2 of 2' };
  const sharePi = (id: string) => paidPi(id, 2250, { metadata: { kind: 'pos_cof', pendingId: 'pc1', split: '1' } });
  const refundedAt = (id: string) => { pis[id].latest_charge.amount_refunded = pis[id].amount; pis[id].latest_charge.refunded = true; };
  let r: any; let t: any; let rc: any[];

  console.log('1. Refunded split shares');
  await fresh({ status: 'partial', paidSoFar: 45, tenders: [shareA, shareB] }); sharePi('pi_A'); sharePi('pi_B'); failRefund.add('pi_B'); actor = boss;
  r = await pay({ action: 'discard', reason: 'Rang up twice' }); t = await ticket();
  check('a discard whose second refund fails: the first share shows as refunded, with what’s still paid', r.status === 502 && t.status === 'partial' && !!t.tenders.find((x: any) => x.id === 'tnA')?.refundedAt && t.paidSoFar === 22.5, { body: r.body, t: { status: t.status, paid: t.paidSoFar } });
  failRefund.clear();
  r = await pay({ action: 'record' }); rc = await all(`${T}/receipts`);
  check('…so recording it then is refused ($22.50 still to pay), never recorded as fully paid', r.status === 409 && /Still \$22\.50/.test(r.body.error || '') && rc.length === 0, r.body);
  await fresh({ status: 'discarding', discardFrom: 'partial', discardingAt: ago(5), discardingBy: 'Ana Ruiz', paidSoFar: 45, tenders: [shareA, shareB] }); sharePi('pi_A'); sharePi('pi_B'); refundedAt('pi_A'); refundedAt('pi_B');
  await outcome().set({ kind: 'discarding', at: ago(5), by: 'Ana Ruiz', token: 't0' }); actor = boss;
  r = await pay({ action: 'record' }); rc = await all(`${T}/receipts`); t = await ticket();
  check('shares refunded in Stripe that the ticket doesn’t know about (a discard that stopped partway): found as the split is saved, nothing recorded', r.status === 409 && r.body.code === 'share_refunded' && rc.length === 0 && !!t.tenders.find((x: any) => x.id === 'tnA')?.refundedAt, r.body);
  await fresh({ status: 'partial', paidSoFar: 22.5, tenders: [shareA] }); sharePi('pi_A'); actor = desk;
  r = await pay({ action: 'tender_remove', tenderId: 'tnA' });
  await hook({ ...charge(pis.pi_A), amount: 2250, paid: true, captured: true, amount_captured: 2250, refunded: false, amount_refunded: 0, metadata: pis.pi_A.metadata, balance_transaction: null });
  t = await ticket();
  check('a share taken off (and refunded) never comes back from a payment notice delivered again', r.status === 200 && r.body.refunded && !(t.tenders || []).some((x: any) => x.stripePaymentIntentId === 'pi_A'), { body: r.body, tenders: t.tenders });
  await fresh({ status: 'partial', paidSoFar: 22.5, tenders: [{ ...cashB, id: 'tn1', label: 'Share 1 of 2' }] }); await pairScreen(); actor = desk;
  await screen({ action: 'request', kind: 'pay', amount: 22.5, splitPendingId: 'pc1', shareLabel: 'Share 2 of 2', clientId: 'c1' });
  const sPi = Object.keys(pis)[0]; succeed(sPi, 2250);
  await hook({ ...charge(pis[sPi]), amount: 2250, paid: true, captured: true, amount_captured: 2250, metadata: pis[sPi].metadata, balance_transaction: null });
  const onIt = ((await ticket()).tenders || []).find((x: any) => x.stripePaymentIntentId === sPi);
  r = await pay({ action: 'tender_remove', tenderId: onIt?.id });
  await screen({ action: 'request', kind: 'idle' });
  t = await ticket();
  check('…nor when the screen payment it came from is closed afterwards', !!onIt && r.body.refunded && !(t.tenders || []).some((x: any) => x.stripePaymentIntentId === sPi), { tenders: t.tenders });

  console.log('2. A paid sale that shares anything with the cart');
  const paidOld = (o: any) => db.doc(`${T}/pendingCheckouts/pcOld`).set({ id: 'pcOld', status: 'paid_waiting', clientId: 'c1', clientName: 'Maya Lopez', deskId: 'd1', expectedTotal: 45, paymentIntentId: 'pi_old', paidVia: 'card_reader', paidCents: 4500,
    readerPis: { pi_old: { state: 'captured', at: ago(21) } }, payload: { clientId: 'c1', items: oil, payment: { method: 'terminal' } }, ...o });
  await fresh(null); actor = desk; await paidOld({ preparedAt: ago(22), updatedAt: ago(20), paidAt: ago(20) }); paidPi('pi_old', 4500, { metadata: reader('pcOld') });
  r = await prep({ deskId: 'd1', items: [...oil, ...coat], expectedTotal: 57 });
  check('the oil paid 20 minutes ago at this desk (its save lost), rung up again with a top coat: the desk is told it’s paid', r.body.pendingId === 'pcOld' && r.body.paid?.id === 'pi_old', r.body);
  const cc = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 5700, description: 'Studio Services — POS Checkout', noLedger: true, pendingId: r.body.pendingId })) as any;
  check('…so the card isn’t charged for it again', cc.status === 409 && cc.body.code === 'ticket_paid' && calls.create.length === 0, cc.body);
  r = await complete(req({ tenantId: 't1', action: 'record', pendingId: 'pcOld' })) as any; rc = await all(`${T}/receipts`);
  check('…“Save the paid sale” records the oil once; the top coat stays as a new sale', r.status === 200 && rc.length === 1 && (await stock('p1')) === 9 && (await stock('p2')) === 10, r.body);
  await fresh(null); actor = desk;
  await db.doc(`${T}/pendingCheckouts/pcV`).set({ id: 'pcV', status: 'paid_waiting', clientId: 'c1', clientName: 'Maya Lopez', deskId: 'd9', expectedTotal: 60, paymentIntentId: 'pi_v', paidVia: 'client_screen', paidCents: 6000, preparedAt: ago(182), updatedAt: ago(180), paidAt: ago(180), payload: { clientId: 'c1', appointmentIds: ['a1'], items: [], payment: { method: 'card' } } });
  paidPi('pi_v', 6000, { metadata: { source: 'client_screen', pendingCheckoutId: 'pcV' } });
  r = await prep({ deskId: 'd2', appointmentIds: ['a1'], items: coat, expectedTotal: 72 });
  check('a visit paid on another device three hours ago, rung up again with a product: it’s this sale, however long ago', r.body.pendingId === 'pcV' && r.body.paid?.id === 'pi_v', r.body);
  r = await complete(req({ tenantId: 't1', clientId: 'c1', appointmentIds: ['a1'], items: coat, expectedTotal: 72, deskId: 'd2', payment: { method: 'cash', amountTendered: 72 } })) as any;
  check('…and cash for it is refused (the visit is paid)', r.status === 409 && r.body.code === 'ticket_paid' && r.body.pendingId === 'pcV', r.body);

  console.log('3. Discards');
  await fresh(readerPaid); paidPi('pi_p', 4500, { metadata: reader() }); actor = boss;
  beforeRetrieve = async () => {   // manager A's discard is checking the payment with Stripe when its hold runs out…
    await db.doc(`${T}/pendingCheckouts/pc1`).set({ discardingAt: ago(4) }, { merge: true }); await outcome().set({ at: ago(4) }, { merge: true });
    const was = actor; actor = { uid: 'm2', name: 'Lee Fox', role: 'owner', isManager: true, caps: [] };
    await pay({ action: 'record' });   // …and manager B records the sale
    actor = was;
  };
  r = await pay({ action: 'discard', reason: 'Rang up twice' }); rc = await all(`${T}/receipts`); t = await ticket();
  check('a discard that lost its hold (another manager recorded the sale) refunds nothing', r.status === 409 && calls.refunds.length === 0 && rc.length === 1 && t.status === 'completed', { body: r.body, refunds: calls.refunds.length, status: t.status });
  check('…and no request runs long enough to outlive its hold', /export const maxDuration = 60;/.test(routeSrc) && /timeout: 20000, maxNetworkRetries: 1/.test(libSrc));
  await fresh({ status: 'partial', paidSoFar: 22.5, tenders: [shareA] }); sharePi('pi_A');
  await db.doc(T).set({ stripeAccountId: null }, { merge: true }); actor = boss;
  r = await pay({ action: 'discard', reason: 'x' }); t = await ticket();
  check('a discard that can’t refund (card payments aren’t set up) lets the sale go again', r.status === 400 && t.status === 'partial' && !(await get(`${T}/pendingCheckouts/pc1/outcome/final`)), { body: r.body, status: t.status });

  console.log('4. Taking a share off');
  await fresh({ status: 'partial', paidSoFar: 45, tenders: [shareA, cashB] }); sharePi('pi_A'); actor = desk;
  r = await pay({ payment: { method: 'split' } });
  const rm = await pay({ action: 'tender_remove', tenderId: 'tnA' });
  check('the split saved first: taking a share off is refused and nothing is refunded', r.status === 200 && rm.status === 409 && calls.refunds.length === 0 && (await ticket()).status === 'completed', { finish: r.body, remove: rm.body });
  await fresh({ status: 'partial', paidSoFar: 45, tenders: [{ ...shareA, removingAt: new Date().toISOString() }, cashB] }); sharePi('pi_A'); actor = desk;
  r = await pay({ payment: { method: 'split' } });
  check('a share being taken off doesn’t pay for the sale: finishing then is refused', r.status === 409 && /Still \$22\.50/.test(r.body.error || '') && (await all(`${T}/receipts`)).length === 0, r.body);
  await fresh({ status: 'partial', paidSoFar: 45, tenders: [shareA, cashB] }); sharePi('pi_A'); actor = desk;
  const [fin, rem] = await Promise.all([pay({ payment: { method: 'split' } }), pay({ action: 'tender_remove', tenderId: 'tnA' })]);
  rc = await all(`${T}/receipts`);
  check('…and at the same moment: never a receipt with a refunded share', !(rc.some((x: any) => (x.paymentIntentIds || []).includes('pi_A')) && pis.pi_A.latest_charge.refunded), { finish: fin.status, remove: rem.status, receipts: rc.length, refunded: pis.pi_A.latest_charge.refunded });

  console.log('5. A share paid as the desk cancels it');
  await fresh({ status: 'partial', paidSoFar: 22.5, tenders: [{ ...cashB, id: 'tn1', label: 'Share 1 of 2' }] }); await pairScreen(); actor = desk;
  await screen({ action: 'request', kind: 'pay', amount: 22.5, splitPendingId: 'pc1', shareLabel: 'Share 2 of 2', clientId: 'c1' });
  const dPi = Object.keys(pis)[0]; succeed(dPi, 2250);
  r = await screen({ action: 'request', kind: 'idle' });
  const scr: any = await get(`clientScreens/${SCREEN}`);
  check('the desk is told it was paid, with the share', r.body.paymentClosed === 'paid' && r.body.closedAnswer?.share === true && r.body.closedAnswer?.paymentIntentId === dPi && scr.response?.paymentIntentId === dPi, { body: r.body, resp: scr.response });
  check('…and Split the bill shows it (it never takes that share again)', /cf:screen-late-payment/.test(splitSrc) && /refreshShares/.test(splitSrc) && /Also paid on this bill/.test(splitSrc));
  r = await pay({ action: 'tender', method: 'cash', amount: 22.5, label: 'Share 2 of 2', cashGiven: 22.5 });
  check('the same share taken again in cash is refused: it would pay more than the bill', r.status === 409 && r.body.code === 'overpays', r.body);
  r = await pay({ payment: { method: 'split' } }); rc = await all(`${T}/receipts`);
  check('…so the sale is recorded once, for what it comes to', r.status === 200 && rc[0]?.total === 45 && (rc[0]?.payments || []).length === 2 && !rc[0]?.overpaid, { body: r.body, payments: rc[0]?.payments });

  console.log('6. A split saved while one of its payments changes');
  await fresh({ status: 'partial', paidSoFar: 45, tenders: [shareA, cashB] }); sharePi('pi_A'); actor = desk;
  { const realBatch = db.batch; let once = false;
    db.batch = () => { const b = realBatch(); const commit = b.commit; b.commit = async () => { if (!once) { once = true; await db.doc(`${T}/pendingCheckouts/pc1`).set({ updatedAt: new Date().toISOString() }, { merge: true }); } return commit(); }; return b; };
    r = await pay({ payment: { method: 'split' } }); db.batch = realBatch; }
  check('it records nothing, and the desk is told to finish again', r.status === 409 && r.body.code === 'bill_changed' && (await all(`${T}/receipts`)).length === 0 && (await stock('p1')) === 10, r.body);
  r = await pay({ payment: { method: 'split' } });
  check('…which then records it once', r.status === 200 && (await all(`${T}/receipts`)).length === 1, r.body);
  await fresh({ status: 'partial', paidSoFar: 45, tenders: [shareA, cashB] }); sharePi('pi_A'); paidPi('pi_late', 2250, { metadata: { source: 'client_screen', pendingCheckoutId: 'pc1', split: '1' } }); actor = desk;
  { const { recordCardShare } = await import('../../src/lib/screen-pay'); const realBatch = db.batch; let once = false; let x = '';
    db.batch = () => { const b = realBatch(); const commit = b.commit; b.commit = async () => { if (!once) { once = true; x = await recordCardShare(db, 't1', 'pc1', { id: 'pi_late' }, { amount: 22.5, via: 'client_screen', label: 'Share 3', by: 'Client screen' }); } return commit(); }; return b; };
    r = await pay({ payment: { method: 'split' } }); db.batch = realBatch;
    const again = await pay({ payment: { method: 'split' } }); t = await ticket(); rc = await all(`${T}/receipts`);
    check('a card share that lands as the split is saved (more than the bill): kept apart for a manager, and the sale recorded once without it', x === 'kept_apart' && r.status === 409 && again.status === 200 && rc.length === 1 && !(rc[0].paymentIntentIds || []).includes('pi_late') && t.readerExtra?.pi_late?.state === 'open', { x, r: r.body, again: again.body }); }
  await fresh({ status: 'completed', receiptId: 'tk_pc1', receiptPaymentIntentIds: ['pi_A'], tenders: [shareA, { id: 'tnL', method: 'card', amount: 22.5, tip: 0, stripePaymentIntentId: 'pi_L', via: 'client_screen' }] });
  sharePi('pi_A'); paidPi('pi_L', 2250, { metadata: { source: 'client_screen', pendingCheckoutId: 'pc1', split: '1' } });
  await db.doc(`${T}/receipts/tk_pc1`).set({ id: 'tk_pc1', pendingId: 'pc1', paymentIntentIds: ['pi_A'], total: 45 });
  const ml = await markSalePaid(db, 't1', 'pc1', pis.pi_L, 'client_screen');
  check('a share on the split but not on its receipt is extra, never taken as recorded', ml.result === 'paid_twice' && (await ticket()).readerExtra?.pi_L?.hint === 'late_share', ml);

  console.log('7. Extra payments');
  await fresh({ status: 'prepared', payload: { clientId: 'c1', items: oil, payment: { method: 'card' } } }); actor = boss;
  await pay({ action: 'discard', reason: 'They changed their mind' });
  paidPi('pi_typed', 4500, { metadata: { source: 'pos_embedded', pendingId: 'pc1' } });
  await hook({ ...charge(pis.pi_typed), amount: 4500, paid: true, captured: true, amount_captured: 4500, metadata: pis.pi_typed.metadata, balance_transaction: null });
  const listed = (await ticket()).readerExtra?.pi_typed?.state === 'open';
  actor = desk; r = await pay({ payment: { method: 'card', stripePaymentIntentId: 'pi_typed' } });
  t = await ticket(); rc = await all(`${T}/receipts`);
  check('a typed card that went through as the sale was discarded, then saved by the desk: recorded once, and off the paid-twice list', listed && r.status === 200 && rc.length === 1 && rc[0].askedPendingId === 'pc1' && t.readerExtra?.pi_typed?.state === 'on_receipt' && !t.readerExtraOpen, { body: r.body, extra: t.readerExtra });
  const again2 = await pay({ payment: { method: 'card', stripePaymentIntentId: 'pi_typed' } });
  check('…“Save again” after a lost answer says it’s saved (never “on another sale”)', again2.status === 200 && again2.body.already && (await all(`${T}/receipts`)).length === 1, again2.body);
  await db.doc(`${T}/pendingCheckouts/pc1`).set({ readerExtra: { pi_typed: { state: 'open' } }, readerExtraOpen: true }, { merge: true }); actor = boss;
  r = await pay({ action: 'reader_extra', paymentIntentId: 'pi_typed', decision: 'keep', reason: 'Prepaid' });
  const kept = (await all(`${T}/transactions`)).filter((x: any) => String(x.id || '').startsWith('kept_'));
  check('…and it can never be kept as extra income on top', r.status === 409 && kept.length === 0, r.body);
  await fresh({ ...readerPaid, readerExtra: { pi_x9: { cents: 4500, at: ago(1), state: 'open', via: 'card_on_file' } }, readerExtraOpen: true });
  paidPi('pi_p', 4500, { metadata: reader() }); paidPi('pi_x9', 4500, { metadata: { kind: 'pos_cof', pendingId: 'pc1' } }); refundedAt('pi_x9'); actor = boss;
  r = await pay({ action: 'reader_extra', paymentIntentId: 'pi_x9', decision: 'keep', reason: 'Prepaid' });
  check('an extra payment already refunded in Stripe is never kept (counted as income)', r.status === 409 && (await all(`${T}/transactions`)).length === 0 && (await ticket()).readerExtra?.pi_x9?.state === 'refunded', r.body);

  console.log('8. The client screen asked again');
  await fresh({ payload: { clientId: 'c1', items: oil, payment: { method: 'card' } } }); await pairScreen(); actor = desk;
  await screen({ action: 'request', kind: 'pay', amount: 45, pendingId: 'pc1', clientId: 'c1' });
  const p1 = Object.keys(pis)[0]; succeed(p1, 4500);
  r = await screen({ action: 'request', kind: 'pay', amount: 45, pendingId: 'pc1', clientId: 'c1' });
  check('asked again just as its last payment went through: refused (the sale is paid), and nothing new is started', r.status === 409 && r.body.code === 'ticket_paid' && r.body.paymentClosed === 'paid' && calls.create.length === 1 && (await ticket()).paymentIntentId === p1, r.body);
  check('…and the desk checks the sale again when a payment goes through as it’s cancelled', /prepareRef\.current\(\)/.test(hub));

  console.log('9. Payments kept apart for a refunded sale');
  await fresh({ status: 'paid_waiting', paymentIntentId: 'pi_A0', paidVia: 'card_on_file', paidCents: 4500, paidAt: ago(3), readerExtra: { pi_S: { cents: 2250, at: ago(2), state: 'open', via: 'card_on_file' } }, readerExtraOpen: true });
  paidPi('pi_A0', 4500, { metadata: { kind: 'pos_cof', pendingId: 'pc1' } }); refundedAt('pi_A0'); sharePi('pi_S'); actor = desk;
  r = await pay({ action: 'record' }); t = await ticket();
  check('a share kept apart is never made to pay for the whole sale', r.status === 409 && r.body.code === 'payment_refunded' && !t.paymentIntentId && t.readerExtra?.pi_S?.state === 'open', r.body);
  await fresh({ status: 'paid_waiting', paymentIntentId: 'pi_A0', paidVia: 'card_on_file', paidCents: 4500, paidAt: ago(3), payload: { clientId: 'c1', items: oil, payment: { method: 'card_on_file' } }, readerExtra: { pi_E: { cents: 5400, at: ago(2), state: 'open', via: 'client_screen' } }, readerExtraOpen: true });
  paidPi('pi_A0', 4500, { metadata: { kind: 'pos_cof', pendingId: 'pc1' } }); refundedAt('pi_A0'); paidPi('pi_E', 5400, { metadata: { source: 'client_screen', pendingCheckoutId: 'pc1', tipCents: '900' } }); actor = desk;
  await pay({ action: 'record' }); r = await pay({ action: 'record' }); rc = await all(`${T}/receipts`);
  check('a client-screen payment that pays for the sale instead keeps the tip chosen there', r.status === 200 && rc[0]?.tip === 9 && rc[0]?.total === 54 && !rc[0]?.paidDiffers, { body: r.body, tip: rc[0]?.tip, pd: rc[0]?.paidDiffers });

  check('no transaction reads after writing', readAfterWrite.length === 0, readAfterWrite);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
