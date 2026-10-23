// Checks the fourth register review's findings stay fixed (each scenario the review reproduced, now handled):
//  1. a split share on a recorded receipt is never extra, and never refunded as extra
//  2. a client-screen share that goes through as the desk cancels it, or as the screen times out, is on its split
//  3. a saved-card share is on its split the moment it goes through, so a lost record never means charging again
//  4. an earlier paid sale of the same client is shown to save on its own, never taken for the sale being rung up
//  5. a save and a discard of the same sale can't both happen (whichever begins first wins; the other changes nothing)
//  6. a payment on another sale's receipt never marks this sale finished
//  7. a manager recording a sale closes its payment on the client screen first; a payment for a sale already saved is
//     kept apart, never recorded as a second sale
//  8. a refunded payment with another kept apart for the sale: that one pays for it (no third charge)
//  9. two equal saved-card shares of one bill are two charges
// 10. no sale payment is taken on the client screen without its ticket; a card sale is never saved without its payment
// 11. a client-screen share paid after the split was finished is kept apart, and the finished sale stays finished
// 12. "paid in cash" releases an approved card reader hold instead of capturing it
// 13. the tip chosen on the client screen survives when Stripe's notice is what puts the payment on the ticket
// 14. a cancelled card reader payment leaves nothing open on the ticket
// 15. payments from before payments named their ticket: never started now, never a share, only a recent one from a desk
// 16. two shares taken at the same moment are both kept
// 17. an extra payment a manager keeps is in the books, once
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
let n = 0; let down = false;
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
      retrieve: async (id: string) => { if (down) throw offline(); if (!pis[id]) throw missing(); return clone(pis[id]); },
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
    refunds: { create: async (p: any, o: any) => { if (down) throw offline(); calls.refunds.push({ ...p, key: o?.idempotencyKey }); const pi = pis[p.payment_intent]; if (pi?.latest_charge) { pi.latest_charge.amount_refunded = p.amount || pi.amount; pi.latest_charge.refunded = true; } return { id: `re_${calls.refunds.length}` }; } },
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
  db = strict(makeDb()); pis = {}; n = 0; actor = desk; down = false; idem.clear(); calls.create.length = 0; calls.capture.length = 0; calls.cancel.length = 0; calls.refunds.length = 0;
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
  const { POST: typedCard } = await import('../../src/app/api/stripe/pos-payment-intent/route');
  const { POST: screenRoute } = await import('../../src/app/api/client-screen/route');
  const { POST: cancelRoute } = await import('../../src/app/api/stripe/terminal/cancel-payment-intent/route');
  const { POST: startReader } = await import('../../src/app/api/stripe/terminal/create-payment-intent/route');
  const { POST: webhook } = await import('../../src/app/api/stripe/connect-webhook/route');
  const { markSalePaid } = await import('../../src/lib/reader-sale');
  const pay = (body: any) => complete(req({ tenantId: 't1', pendingId: 'pc1', clientId: 'c1', items: oil, expectedTotal: 45, ...body })) as any;
  const prep = (body: any) => complete(req({ tenantId: 't1', action: 'prepare', clientId: 'c1', items: oil, expectedTotal: 45, ...body })) as any;
  const screen = (body: any) => screenRoute(req({ tenantId: 't1', screenId: SCREEN, ...body })) as any;
  const pairScreen = () => db.doc(`clientScreens/${SCREEN}`).set({ tenantId: 't1', name: 'iPad', phase: 'idle', request: null });
  const hook = (ch: any) => webhook(req({ type: 'charge.succeeded', account: 'acct_1', data: { object: ch } })) as any;
  const hub = readFileSync('src/components/pos/CheckoutHub.tsx', 'utf8'); const engine = readFileSync('src/components/pos/usePosEngine.tsx', 'utf8');
  const splitSrc = readFileSync('src/components/pos/SplitBill.tsx', 'utf8'); const ops = readFileSync('src/components/ops/OpsBoard.tsx', 'utf8');
  let r: any; let t: any; let rc: any[];

  console.log('1. A split share on a recorded receipt');
  await fresh({ status: 'partial', tenders: [{ id: 'tn1', method: 'card', amount: 22.5, tip: 0, stripePaymentIntentId: 'pi_sh1', via: 'saved_card', label: 'Share 1 of 2' }, { id: 'tn2', method: 'cash', amount: 22.5, tip: 0, label: 'Share 2 of 2' }] });
  paidPi('pi_sh1', 2250, { metadata: { kind: 'pos_cof', pendingId: 'pc1', split: '1' } });
  r = await pay({ payment: { method: 'split' } });
  rc = await all(`${T}/receipts`);
  check('a split sale’s receipt lists every card payment on it', r.status === 200 && rc.length === 1 && (rc[0].paymentIntentIds || []).includes('pi_sh1'), { body: r.body, ids: rc[0]?.paymentIntentIds });
  await db.doc(`${T}/pendingCheckouts/pc2`).set({ id: 'pc2', status: 'prepared', clientId: 'c2', clientName: 'Jo Kim', expectedTotal: 12, preparedAt: ago(1), updatedAt: ago(1), payload: { clientId: 'c2', items: coat } });
  r = await complete(req({ tenantId: 't1', pendingId: 'pc2', clientId: 'c2', items: coat, expectedTotal: 12, payment: { method: 'card', stripePaymentIntentId: 'pi_sh1' } })) as any;
  t = await ticket();
  check('that share’s payment sent to save another sale is refused, and never listed as paid twice', r.status === 409 && r.body.code === 'payment_used' && !t.readerExtra?.pi_sh1 && !t.readerExtraOpen, { body: r.body, extra: t.readerExtra });
  const own = await markSalePaid(db, 't1', 'pc1', pis.pi_sh1, 'card_on_file');
  check('…nor when Stripe’s notice for it arrives late', own.result === 'recorded' && !(await ticket()).readerExtra?.pi_sh1);
  actor = boss;
  r = await pay({ action: 'reader_extra', paymentIntentId: 'pi_sh1', decision: 'refund' });
  check('…so a manager can’t refund it as extra', r.status >= 400 && calls.refunds.length === 0, r.body);

  console.log('2. A client-screen share as the desk cancels it, or as the screen times out');
  await fresh({ status: 'partial', tenders: [{ id: 'tn1', method: 'cash', amount: 22.5, tip: 0, label: 'Share 1 of 2' }] });
  await pairScreen(); actor = desk;
  await screen({ action: 'request', kind: 'pay', amount: 22.5, splitPendingId: 'pc1', shareLabel: 'Share 2 of 2', clientId: 'c1' });
  const shPi = Object.keys(pis)[0]; succeed(shPi, 2250);
  r = await screen({ action: 'request', kind: 'idle' });
  t = await ticket();
  check('it goes through just as the desk cancels it: the share is on the split, with its payment and its name', r.body.paymentClosed === 'paid' && (t.tenders || []).length === 2 && t.tenders.some((x: any) => x.stripePaymentIntentId === shPi && x.label === 'Share 2 of 2'), { body: r.body, tenders: t.tenders });
  await fresh({ status: 'partial', tenders: [{ id: 'tn1', method: 'cash', amount: 22.5, tip: 0, label: 'Share 1 of 2' }] });
  await pairScreen(); actor = desk;
  await screen({ action: 'request', kind: 'pay', amount: 22.5, splitPendingId: 'pc1', shareLabel: 'Share 2 of 2', clientId: 'c1' });
  const shPi2 = Object.keys(pis)[0]; succeed(shPi2, 2250);
  const s3: any = await get(`clientScreens/${SCREEN}`);
  r = await screenRoute(req({ action: 'pay_abandon', screenId: SCREEN, requestId: s3.request?.id }));
  const resp: any = (await get(`clientScreens/${SCREEN}`)).response; t = await ticket();
  check('…or as the screen times out: the answer carries the payment, and the share is on the split', resp?.paid === true && resp?.paymentIntentId === shPi2 && t.tenders.some((x: any) => x.stripePaymentIntentId === shPi2), { resp, tenders: t.tenders });

  console.log('3. A saved-card share');
  await fresh({ status: 'prepared' }); actor = desk;
  const c1 = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 2250, description: 'Share of a split bill — Share 1 of 2', category: 'Service Revenue', noLedger: true, pendingId: 'pc1', share: true, shareLabel: 'Share 1 of 2' })) as any;
  t = await ticket();
  check('it’s on its split, named as its share, the moment it goes through', c1.body.ok && c1.body.sale === 'added' && (t.tenders || []).length === 1 && t.tenders[0].stripePaymentIntentId === c1.body.paymentIntentId && t.tenders[0].label === 'Share 1 of 2', { body: c1.body, tenders: t.tenders });
  r = await pay({ action: 'tender', method: 'card', amount: 22.5, stripePaymentIntentId: c1.body.paymentIntentId, via: 'saved_card', label: 'Share 1 of 2' });
  t = await ticket();
  check('…the desk recording it again with the same payment adds nothing twice', r.status === 200 && r.body.already && t.tenders.length === 1);
  check('…and Split the bill records it again (never charges again) when its record doesn’t arrive', /setUnrecorded\(\{ share, body \}\)/.test(splitSrc) && /Record \$\{unrecorded\.share\.label\} again/.test(splitSrc) && /shareLabel: share\.label/.test(splitSrc));

  console.log('4. An earlier paid sale of the same client');
  const old = (paidMin: number) => db.doc(`${T}/pendingCheckouts/pcOld`).set({ id: 'pcOld', status: 'paid_waiting', clientId: 'c1', clientName: 'Maya Lopez', deskId: 'd1', expectedTotal: 45, preparedAt: ago(paidMin + 2), updatedAt: ago(paidMin), paidAt: ago(paidMin),
    paymentIntentId: 'pi_old', paidVia: 'card_reader', paidCents: 4500, readerPis: { pi_old: { state: 'captured', at: ago(paidMin + 1) } }, payload: { clientId: 'c1', items: oil, payment: { method: 'terminal' } } });
  await fresh(null); actor = desk; await old(60); paidPi('pi_old', 4500, { metadata: reader('pcOld') });
  r = await prep({ deskId: 'd2', items: oil, expectedTotal: 45 });
  check('paid an hour ago at another desk and never saved: it isn’t taken for this sale, and the desk is shown it', r.body.pendingId && r.body.pendingId !== 'pcOld' && !r.body.paid && r.body.otherPaid?.pendingId === 'pcOld' && r.body.otherPaid?.cents === 4500, r.body);
  const cash = await complete(req({ tenantId: 't1', clientId: 'c1', items: oil, expectedTotal: 45, deskId: 'd2', pendingId: r.body.pendingId, payment: { method: 'cash', amountTendered: 45 } })) as any;
  check('…this sale saves as cash; the paid one waits to be saved on its own', cash.status === 200 && (await ticket('pcOld')).status === 'paid_waiting', cash.body);
  r = await complete(req({ tenantId: 't1', action: 'record', pendingId: 'pcOld' })) as any;
  rc = await all(`${T}/receipts`);
  check('…and “Save that sale” saves it with its own payment', r.status === 200 && rc.length === 2 && rc.some((x: any) => x.stripePaymentIntentId === 'pi_old'), r.body);
  check('…the desk shows it with a button to save it, leaving the cart alone', /has another sale, paid but not saved/.test(hub) && /Save that sale/.test(hub) && /saveOtherPaidSale/.test(engine) && /action: 'record', pendingId: op\.pendingId/.test(engine));
  await fresh(null); actor = desk; await old(10); paidPi('pi_old', 4500, { metadata: reader('pcOld') });
  r = await prep({ deskId: 'd2', items: oil, expectedTotal: 45 });
  check('the same cart paid ten minutes ago on another screen (the desk moved devices): it’s this sale, and the desk is told it’s paid', r.body.pendingId === 'pcOld' && r.body.paid?.id === 'pi_old', r.body);

  console.log('5. A save and a discard of the same sale');
  await fresh(readerPaid); paidPi('pi_p', 4500, { metadata: reader() }); actor = boss;
  r = await pay({ action: 'discard', reason: 'Rang up twice' });
  actor = desk; const s1 = await pay({ payment: { method: 'terminal', stripePaymentIntentId: 'pi_p' } });
  check('discarded first: the card is refunded, and saving it afterwards records nothing', r.status === 200 && calls.refunds.length === 1 && s1.status === 409 && (await all(`${T}/receipts`)).length === 0 && (await stock('p1')) === 10, { d: r.body, s: s1.body });
  await fresh(readerPaid); paidPi('pi_p', 4500, { metadata: reader() }); actor = desk;
  const s2 = await pay({ payment: { method: 'terminal', stripePaymentIntentId: 'pi_p' } });
  actor = boss; r = await pay({ action: 'discard', reason: 'x' });
  check('saved first: discarding it says it’s recorded, and refunds nothing', s2.status === 200 && r.body.already && calls.refunds.length === 0 && (await ticket()).status === 'completed', r.body);
  check('…the save is written with the ticket’s outcome, once', (await get(`${T}/pendingCheckouts/pc1/outcome/final`))?.kind === 'saved');
  await fresh(readerPaid); paidPi('pi_p', 4500, { metadata: reader() }); actor = desk;
  { const realBatch = db.batch; let once = false;
    db.batch = () => { const b = realBatch(); const commit = b.commit; b.commit = async () => { if (!once) { once = true; await outcome().set({ kind: 'discarding', at: new Date().toISOString(), by: 'Ana Ruiz', token: 'x' }); } return commit(); }; return b; };
    const s3b = await pay({ payment: { method: 'terminal', stripePaymentIntentId: 'pi_p' } });
    db.batch = realBatch;
    check('a discard that begins while a save is under way stops the save: nothing recorded, stock untouched', s3b.status === 409 && s3b.body.code === 'sale_discarding' && (await all(`${T}/receipts`)).length === 0 && (await stock('p1')) === 10, s3b.body); }
  await fresh({ ...readerPaid, status: 'discarding', discardFrom: 'paid_waiting', discardingAt: ago(5), discardingBy: 'Ana Ruiz' }); paidPi('pi_p', 4500, { metadata: reader() });
  await outcome().set({ kind: 'discarding', at: ago(5), by: 'Ana Ruiz', token: 't0' });
  actor = desk; r = await pay({ payment: { method: 'terminal', stripePaymentIntentId: 'pi_p' } });
  check('a discard that stopped partway: the desk can’t save the sale', r.status === 409 && r.body.code === 'sale_discarding', r.body);
  actor = boss; r = await pay({ action: 'record' });
  rc = await all(`${T}/receipts`);
  check('…a manager can still record it, with its payment', r.status === 200 && rc.length === 1 && rc[0].stripePaymentIntentId === 'pi_p' && (await get(`${T}/pendingCheckouts/pc1/outcome/final`))?.kind === 'saved', r.body);
  await fresh({ ...readerPaid, status: 'discarding', discardFrom: 'paid_waiting', discardingAt: ago(5), discardingBy: 'Ana Ruiz' }); paidPi('pi_p', 4500, { metadata: reader() });
  await outcome().set({ kind: 'discarding', at: ago(5), by: 'Ana Ruiz', token: 't0' }); actor = boss;
  r = await pay({ action: 'discard', reason: 'Rang up twice' });
  check('…or discard it again: refunded once, and discarded', r.status === 200 && calls.refunds.length === 1 && (await ticket()).status === 'discarded' && (await get(`${T}/pendingCheckouts/pc1/outcome/final`))?.kind === 'discarded', r.body);
  await fresh({ ...readerPaid, status: 'discarding', discardFrom: 'paid_waiting', discardingAt: ago(1), discardingBy: 'Ana Ruiz' }); paidPi('pi_p', 4500, { metadata: reader() });
  await outcome().set({ kind: 'discarding', at: ago(1), by: 'Ana Ruiz', token: 't0' }); actor = boss;
  const [rA, rB] = await Promise.all([pay({ action: 'record' }), pay({ action: 'discard', reason: 'x' })]);
  check('…but not while it’s still under way', rA.status === 409 && rB.status === 409 && calls.refunds.length === 0 && (await all(`${T}/receipts`)).length === 0, { a: rA.body, b: rB.body });
  await fresh(readerPaid); paidPi('pi_p', 4500, { metadata: reader() }); actor = boss; down = true;
  r = await pay({ action: 'discard', reason: 'x' }); down = false;
  t = await ticket();
  check('a discard that can’t refund lets the sale go again (it can still be saved or discarded)', r.status >= 500 && t.status === 'paid_waiting' && !(await get(`${T}/pendingCheckouts/pc1/outcome/final`)), { body: r.body, status: t.status });
  check('Needs attention shows a discard that stopped partway, to finish or record', /'partial', 'discarding'\]/.test(ops) && /didn’t finish\. Discard it again/.test(ops));

  console.log('6. A payment on another sale’s receipt');
  await fresh({ status: 'partial', tenders: [{ id: 'tn1', method: 'cash', amount: 20, tip: 0 }, { id: 'tn2', method: 'card', amount: 10, tip: 0, stripePaymentIntentId: 'pi_shB', via: 'saved_card' }] });
  paidPi('pi_shB', 1000, { metadata: { kind: 'pos_cof', pendingId: 'pc1', split: '1' } });
  paidPi('pi_other', 1200, { metadata: { kind: 'pos_cof', pendingId: 'pcX' } });
  await db.doc(`${T}/receipts/rX`).set({ id: 'rX', stripePaymentIntentId: 'pi_other', pendingId: 'pcX', total: 12, clientId: 'c2' });
  actor = desk; r = await pay({ payment: { method: 'card', stripePaymentIntentId: 'pi_other' } });
  t = await ticket();
  check('naming it never marks this split finished (its shares stay to finish or refund)', r.status === 409 && r.body.code === 'payment_used' && t.status === 'partial' && !t.receiptId, { body: r.body, status: t.status });

  console.log('7. A manager recording while the client pays on the screen, and a payment for a sale already saved');
  await fresh({ updatedAt: ago(11), payload: { clientId: 'c1', items: oil, payment: { method: 'card' } } });
  await pairScreen(); actor = desk;
  await screen({ action: 'request', kind: 'pay', amount: 45, pendingId: 'pc1', clientId: 'c1' });
  const scrPi = Object.keys(pis)[0];
  actor = boss; r = await pay({ action: 'record', paidAs: 'cash' });
  const sc: any = await get(`clientScreens/${SCREEN}`);
  check('“paid in cash” first closes its payment on the client screen, so they can’t pay for it too', r.status === 200 && pis[scrPi].status === 'canceled' && !sc.request && (await all(`${T}/receipts`))[0]?.paymentMethod === 'cash', { body: r.body, pi: pis[scrPi].status });
  await fresh({ updatedAt: ago(11), payload: { clientId: 'c1', items: oil, payment: { method: 'card' } } });
  await pairScreen(); actor = desk;
  await screen({ action: 'request', kind: 'pay', amount: 45, pendingId: 'pc1', clientId: 'c1' });
  const scrPi2 = Object.keys(pis)[0]; succeed(scrPi2, 4500);
  actor = boss; r = await pay({ action: 'record', paidAs: 'cash' });
  rc = await all(`${T}/receipts`);
  check('…when they had just paid there: recorded with that card payment, and the manager is told', r.status === 200 && rc.length === 1 && rc[0].stripePaymentIntentId === scrPi2 && (r.body.warnings || []).some((w: string) => /card payment went through/.test(w)), r.body);
  actor = desk; r = await pay({ payment: { method: 'card', stripePaymentIntentId: scrPi2 } });
  check('…and the desk saving it with that payment afterwards adds nothing twice', r.status === 200 && r.body.already && (await all(`${T}/receipts`)).length === 1, r.body);
  await fresh({ status: 'completed', receiptId: 'tk_pc1' });
  await db.doc(`${T}/receipts/tk_pc1`).set({ id: 'tk_pc1', pendingId: 'pc1', paymentMethod: 'cash', total: 45 });
  paidPi('pi_late', 4500, { metadata: { source: 'client_screen', pendingCheckoutId: 'pc1' } });
  actor = desk; r = await pay({ payment: { method: 'card', stripePaymentIntentId: 'pi_late' } });
  t = await ticket();
  check('a card payment for a sale already saved is kept apart for a manager, never recorded as a second sale', r.status === 409 && r.body.code === 'sale_done' && (await all(`${T}/receipts`)).length === 1 && t.readerExtra?.pi_late?.state === 'open' && (await stock('p1')) === 10, r.body);
  check('…and the desk is told not to charge again', /out\?\.code === 'sale_discarding' \|\| out\?\.code === 'sale_done'/.test(engine));

  console.log('8. A refunded payment with another kept apart');
  await fresh({ status: 'paid_waiting', paymentIntentId: 'pi_A', paidVia: 'card_on_file', paidCents: 4500, paidAt: ago(3), readerExtra: { pi_E: { cents: 4500, at: ago(2), state: 'open', via: 'client_screen' } }, readerExtraOpen: true });
  paidPi('pi_A', 4500, { metadata: { kind: 'pos_cof', pendingId: 'pc1' } }); paidPi('pi_E', 4500, { metadata: { source: 'client_screen', pendingCheckoutId: 'pc1' } });
  pis.pi_A.latest_charge.amount_refunded = 4500; pis.pi_A.latest_charge.refunded = true;
  actor = desk; r = await pay({ action: 'record' });
  check('the one kept apart pays for the sale now, and the desk is told to save it with that', r.status === 409 && r.body.code === 'ticket_paid' && r.body.paidWith?.id === 'pi_E', r.body);
  const again = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 4500, description: 'Studio Services — POS Checkout', noLedger: true, pendingId: 'pc1' })) as any;
  check('…so the card isn’t charged a third time', again.status === 409 && again.body.code === 'ticket_paid' && calls.create.length === 0, again.body);
  r = await pay({ action: 'record' }); rc = await all(`${T}/receipts`);
  check('…and the sale saves with it', r.status === 200 && rc[0]?.stripePaymentIntentId === 'pi_E', r.body);

  console.log('9. Two equal saved-card shares');
  await fresh({ status: 'prepared' }); actor = desk;
  const f1 = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 2250, description: 'Share of a split bill — Share 1 of 2', category: 'Service Revenue', noLedger: true, pendingId: 'pc1', share: true, shareLabel: 'Share 1 of 2' })) as any;
  const f2 = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 2250, description: 'Share of a split bill — Share 2 of 2', category: 'Service Revenue', noLedger: true, pendingId: 'pc1', share: true, shareLabel: 'Share 2 of 2' })) as any;
  t = await ticket();
  check('two shares of the same amount on the same card within seconds are two charges, both on the split', f1.body.ok && f2.body.ok && f1.body.paymentIntentId !== f2.body.paymentIntentId && (t.tenders || []).length === 2, { f1: f1.body, f2: f2.body });

  console.log('10. Never without its ticket, never a card sale without its payment');
  await fresh(null); await pairScreen(); actor = desk;
  r = await screen({ action: 'request', kind: 'pay', amount: 45, pendingId: null, clientId: 'c1' });
  check('the client screen never takes a sale payment without its ticket', r.status === 400 && r.body.code === 'no_ticket' && calls.create.length === 0, r.body);
  check('…and the desk never asks it to', /if \(!pendingId\) \{ toast\(\{ variant: 'destructive', title: 'The sale couldn’t be saved first'/.test(hub));
  check('…nor saves a sale from a screen answer with no payment', /if \(!r\.paymentIntentId\) \{/.test(hub));
  await fresh({});
  r = await pay({ payment: { method: 'card' } });
  check('a card sale with no card payment is never saved, and nothing is used up', r.status === 409 && r.body.code === 'card_unpaid' && (await all(`${T}/receipts`)).length === 0 && (await stock('p1')) === 10, r.body);
  actor = boss; r = await pay({ payment: { method: 'card' }, staffDiscount: { kind: 'pct', value: 100, reason: 'Comp' } });
  check('…unless nothing is due', r.status === 200 && (await all(`${T}/receipts`)).length === 1, r.body);

  console.log('11. A client-screen share after the split was finished');
  await fresh({ status: 'partial', tenders: [{ id: 'tn1', method: 'cash', amount: 22.5, tip: 0, label: 'Share 1 of 2' }] });
  await pairScreen(); actor = desk;
  await screen({ action: 'request', kind: 'pay', amount: 22.5, splitPendingId: 'pc1', shareLabel: 'Share 2 of 2', clientId: 'c1' });
  const gPi = Object.keys(pis)[0];
  await pay({ action: 'tender', method: 'cash', amount: 22.5, label: 'Share 2 of 2', cashGiven: 22.5 });
  r = await pay({ payment: { method: 'split' } });
  const finished = r.status === 200;
  succeed(gPi, 2250);
  const sg: any = await get(`clientScreens/${SCREEN}`);
  if (sg.request?.id) await screenRoute(req({ action: 'pay_done', screenId: SCREEN, requestId: sg.request.id }));
  else await hook({ ...charge(pis[gPi]), paid: true, captured: true, amount_captured: 2250, metadata: pis[gPi].metadata, balance_transaction: null });
  t = await ticket();
  check('the finished sale stays finished, and the late share is kept apart for a manager', finished && t.status === 'completed' && (t.tenders || []).length === 2 && t.readerExtra?.[gPi]?.state === 'open', { status: t.status, tenders: (t.tenders || []).length, extra: t.readerExtra });

  console.log('12. “Paid in cash” with an approved card reader hold');
  await fresh({ status: 'prepared', readerOpen: true, readerPis: { pi_h: { at: ago(11), cents: 4500, state: 'started' } }, updatedAt: ago(11) });
  pis.pi_h = { id: 'pi_h', created: nowS(), status: 'requires_capture', amount: 4500, metadata: { tenantId: 't1', ...reader() } }; actor = boss;
  r = await pay({ action: 'record', paidAs: 'cash' });
  rc = await all(`${T}/receipts`);
  check('the hold is released (never captured on top) and the sale is recorded as cash', r.status === 200 && !calls.capture.includes('pi_h') && pis.pi_h.status === 'canceled' && rc[0]?.paymentMethod === 'cash' && !rc[0]?.stripePaymentIntentId, { body: r.body, pm: rc[0]?.paymentMethod });

  console.log('13. The tip chosen on the client screen');
  await fresh({ payload: { clientId: 'c1', items: oil, payment: { method: 'card' } } });
  await pairScreen(); actor = desk;
  await screen({ action: 'request', kind: 'pay', amount: 45, pendingId: 'pc1', clientId: 'c1', askTip: true, tipBase: 45 });
  const lPi = Object.keys(pis)[0]; const sl: any = await get(`clientScreens/${SCREEN}`);
  await screenRoute(req({ action: 'pay_tip', screenId: SCREEN, requestId: sl.request?.id, tip: 9 }));
  succeed(lPi, 5400);
  await hook({ ...charge(pis[lPi]), amount: 5400, paid: true, captured: true, amount_captured: 5400, metadata: pis[lPi].metadata, balance_transaction: null });
  t = await ticket();
  actor = boss; r = await pay({ action: 'record' }); rc = await all(`${T}/receipts`);
  check('Stripe’s notice puts the payment on the ticket with the tip, and the sale is recorded with it', t.status === 'paid_waiting' && t.paidTip === 9 && r.status === 200 && rc[0]?.tip === 9 && rc[0]?.total === 54 && !rc[0]?.paidDiffers, { paidTip: t.paidTip, rc: rc[0] && { tip: rc[0].tip, total: rc[0].total, pd: rc[0].paidDiffers } });

  console.log('14. A cancelled card reader payment');
  await fresh({ deskId: 'd1', payload: { clientId: 'c1', items: oil } }); actor = desk;
  r = await startReader(req({ tenantId: 't1', clientId: 'c1', amountCents: 4500, kind: 'sale', pendingId: 'pc1' })) as any;
  await cancelRoute(req({ tenantId: 't1', paymentIntentId: r.body.paymentIntentId }));
  const after = await ticket();
  await prep({ pendingId: 'pc1', clientId: 'c2', items: coat, expectedTotal: 12, deskId: 'd1' });
  t = await ticket();
  check('nothing is left open on the ticket, so moving on to the next client puts it away', after.readerOpen === false && t.status === 'discarded', { readerOpen: after.readerOpen, status: t.status });

  console.log('15. Payments from before payments named their ticket');
  await fresh({}); actor = desk;
  r = await typedCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 2000 })) as any;
  check('a typed card is never started without its ticket (the screen reloads first)', r.status === 409 && r.body.code === 'reload' && calls.create.length === 0, r.body);
  r = await chargeCard(req({ tenantId: 't1', clientId: 'c1', amountCents: 4500, description: 'Studio Services — POS Checkout', noLedger: true })) as any;
  check('…nor a saved card charged for a sale', r.status === 409 && r.body.code === 'reload' && calls.create.length === 0, r.body);
  paidPi('pi_leg', 2000, { metadata: { source: 'pos_embedded' }, created: nowS() - 3600 });
  r = await pay({ action: 'tender', method: 'card', amount: 20, stripePaymentIntentId: 'pi_leg' });
  check('one made before is never taken as a split share', r.status === 409 && !((await ticket()).tenders || []).length, r.body);
  await fresh({ status: 'paid_waiting', paymentIntentId: 'pi_old3', paidVia: 'card', paidCents: 4500, paidAt: ago(3 * 1440) });
  paidPi('pi_old3', 4500, { metadata: { source: 'pos_embedded' }, created: nowS() - 3 * 86400 });
  actor = boss; r = await pay({ action: 'record' }); rc = await all(`${T}/receipts`);
  check('…but one already on its ticket still records that sale, however long ago it was paid', r.status === 200 && rc[0]?.stripePaymentIntentId === 'pi_old3', r.body);

  console.log('16. Two shares at the same moment');
  await fresh({ status: 'prepared' }); await pairScreen(); actor = desk;
  await screen({ action: 'request', kind: 'pay', amount: 22.5, splitPendingId: 'pc1', shareLabel: 'Share 1 of 2', clientId: 'c1' });
  const kPi = Object.keys(pis)[0]; succeed(kPi, 2250);
  const sk: any = await get(`clientScreens/${SCREEN}`);
  await Promise.all([screenRoute(req({ action: 'pay_done', screenId: SCREEN, requestId: sk.request?.id })), pay({ action: 'tender', method: 'cash', amount: 22.5, label: 'Share 2 of 2', cashGiven: 22.5 })]);
  t = await ticket();
  check('the client screen’s share and the desk’s cash share are both kept', (t.tenders || []).length === 2 && t.tenders.some((x: any) => x.method === 'cash') && t.tenders.some((x: any) => x.stripePaymentIntentId === kPi), { tenders: (t.tenders || []).map((x: any) => x.method) });

  console.log('17. An extra payment kept');
  await fresh({ ...readerPaid, readerExtra: { pi_x2: { cents: 4500, at: ago(1), state: 'open', via: 'card_on_file' } }, readerExtraOpen: true });
  paidPi('pi_p', 4500, { metadata: reader() }); paidPi('pi_x2', 4500, { metadata: { kind: 'pos_cof', pendingId: 'pc1' } }); actor = boss;
  r = await pay({ action: 'reader_extra', paymentIntentId: 'pi_x2', decision: 'keep', reason: 'Prepaid for her next visit' });
  const r2 = await pay({ action: 'reader_extra', paymentIntentId: 'pi_x2', decision: 'keep', reason: 'again' });
  const kept = (await all(`${T}/transactions`)).filter((x: any) => x.stripePaymentIntentId === 'pi_x2');
  check('kept: in the books once, as income, with why', r.status === 200 && r2.body.already && kept.length === 1 && kept[0].amount === 45 && kept[0].category === 'Other Income' && /Prepaid for her next visit/.test(kept[0].description), kept);

  check('no transaction reads after writing', readAfterWrite.length === 0, readAfterWrite);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
