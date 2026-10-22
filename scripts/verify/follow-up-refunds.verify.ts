// Checks orders made from other orders (lib/order-family). A backorder, pre-order items sent later and a replacement are
// $0 orders, so a refund on one goes back to the card on the order the customer paid on (api/retail/refund), within what
// that card has left across the whole family; cancelling one gives back what was paid for its items, on top of anything
// already queued (lib/retail-fulfill cancelOrder, api/retail/self-serve), and nothing for a replacement whose lost parcel
// was delivered after all; a claim for a whole one is worth what was paid for its items (api/retail/claims); every
// follow-up made (a short, a return, a lost parcel) keeps the price paid for each unit and the tax it was paid with; and
// a backorder still waiting for stock gives back no stock it never held.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/follow-up-refunds.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
let actor: any = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
let authTenant: any = {};
const stripeCalls: any[] = []; let stripeFail = '';
const fetches: any[] = [];

// The web SDK over the same fake database, for the board's own actions (lib/retail-fulfill, lib/retail-returns).
const webFs: any = { __fs: true };
let auto = 0;
const colRef = (path: string) => ({ __col: true, path, id: path.split('/').pop() });
const docRef = (path: string) => ({ __doc: true, path, id: path.split('/').pop() });
const webSnap = (s: any, r: any) => ({ exists: () => s.exists, data: () => s.data(), id: s.id, ref: r });
const web: any = {
  collection: (base: any, ...segs: string[]) => colRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/')),
  doc: (base: any, ...segs: string[]) => (base?.__col
    ? docRef(`${base.path}/${segs[0] || `auto${++auto}`}`)
    : docRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/'))),
  runTransaction: (_fs: any, fn: any) => db.runTransaction(() => fn({
    get: async (r: any) => webSnap(await db.doc(r.path).get(), r),
    update: (r: any, v: any) => db.doc(r.path).update(v),
    set: (r: any, v: any, o?: any) => db.doc(r.path).set(v, o),
  })),
  getDoc: async (r: any) => webSnap(await db.doc(r.path).get(), r),
  query: (c: any, ...cons: any[]) => ({ __q: true, path: c.path, cons }),
  where: (k: string, op: string, v: any) => ({ t: 'where', k, op, v }),
  limit: (n: number) => ({ t: 'limit', n }), orderBy: () => ({ t: 'orderBy' }),
  getDocs: async (q: any) => {
    let c: any = db.collection(q.path);
    for (const x of q.cons || []) { if (x?.t === 'where') c = c.where(x.k, x.op, x.v); if (x?.t === 'limit') c = c.limit(x.n); }
    const s = await c.get();
    return { docs: s.docs.map((d: any) => ({ id: d.id, data: () => d.data(), exists: () => true })), empty: s.empty, size: s.size };
  },
};

const stripeMade: any[] = [];
function StripeMock(this: any) {
  return { refunds: {
    create: async (params: any, opts: any) => {
      stripeCalls.push({ params, opts });
      if (stripeFail) throw Object.assign(new Error(stripeFail), { raw: { message: stripeFail } });
      const r = { id: `re_${stripeCalls.length}`, amount: params.amount, metadata: params.metadata, status: 'succeeded', payment_intent: params.payment_intent };
      stripeMade.push(r);
      return r;
    },
    list: async (params: any) => ({ data: stripeMade.filter((r) => r.payment_intent === params.payment_intent) }),
  } };
}

const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase/firestore') return web;
  if (request === 'stripe') return StripeMock;
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-retail-selfserve' }, { name: 'admin-retail-claims' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: {} };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: authTenant }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/email-shell') return { brandedEmail: (_b: any, html: string) => html, emailButton: (link: string) => `<a href="${link}">`, getEmailBrand: async () => ({ shopName: 'Opal' }) };
  if (request === '@/lib/cancel-restore') return { restoreNonCardPayment: async () => ({ giftCents: 0, creditCents: 0 }) };
  if (request === '@/lib/retail-webhook') return { sendOrderConfirmation: async () => ({}) };
  if (request === '@/lib/request-forensics') return { requestForensics: () => null };
  if (request.endsWith('staff-fetch')) return { staffAuthHeader: async () => ({}) };
  if (request.endsWith('renter-credit-client')) return { syncRenterCredits: () => undefined };
  if (request === '@/lib/route-guard') return { staffOrServer: async () => true };
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async (url: any, init?: any) => { fetches.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : null }); return { ok: true, json: async () => ({}) }; };
process.env.STRIPE_SECRET_KEY = 'sk_test'; process.env.CRON_SECRET = 'cron'; process.env.RESEND_API_KEY = 'rk'; process.env.NOTIFY_FROM_EMAIL = 'shop@example.com';

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, nextUrl: { origin: 'https://shop.example' } }) as any;

// The order Dana paid for: 4 gel polishes at $15 with $4 off them (a promo code), and a $10 file. Tax is 8% of the
// $66 after the promo ($5.28), shipping $8: $79.28 on her card. Two polishes were short and are on a backorder.
const L1 = { lineId: 'L1', productId: 'gel', name: 'Gel polish', sku: 'GEL', unitPriceCents: 1500, qtyOrdered: 4, qtyScanned: 2, qtyShorted: 2, qtyReturned: 0, status: 'backordered', promoCents: 400 };
const L2 = { lineId: 'L2', productId: 'file', name: 'Nail file', sku: 'FILE', unitPriceCents: 1000, qtyOrdered: 1, qtyScanned: 1, qtyShorted: 0, qtyReturned: 0, status: 'picked' };
const payer = (x: any = {}) => ({ id: 'p1', tenantId: 't1', orderNumber: 1042, stage: 'shipped', method: 'ship', lines: [L1, L2], subtotalCents: 7000, discountCents: 400, taxCents: 528, shippingCents: 800, totalCents: 7928, chargedCents: 7928, refundedCents: 0, stripePaymentIntentId: 'pi_P', qrToken: 'qr1', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', ...x });

(async () => {
  const F = await import('../../src/lib/order-family');
  const { taxShareCents } = await import('../../src/lib/restocking');
  const { effectiveUnitCents } = await import('../../src/lib/retail-swap');

  // ── What a follow-up is, and what its items are worth ──
  const C1 = { ...F.lineFor(L1, 2), lineId: 'C1', qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending', shortReason: '' };
  const child = (x: any = {}) => ({ id: 'c1', tenantId: 't1', orderNumber: 1042, stage: 'paid', method: 'ship', lines: [C1], subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0, totalCents: 0, taxBasis: F.taxBasisOf(payer()), parentOrderId: 'p1', holdUntilRestock: true, qrToken: 'qr1', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', ...x });
  check('a $0 order made from another is a follow-up; the order paid for, or one with a charge of its own, isn’t',
    F.isFollowUp(child()) && !F.isFollowUp(payer()) && !F.isFollowUp(child({ chargedCents: 500 })) && !F.isFollowUp({ totalCents: 0 }));
  check('the backorder’s polishes keep the $14 each Dana paid after the promo (a plain copy of the line said $13)',
    C1.unitPaidCents === 1400 && C1.promoCents === 200 && C1.qtyOrdered === 2 && effectiveUnitCents(C1) === 1400 && effectiveUnitCents({ ...L1, qtyOrdered: 2 }) === 1300, C1);
  check('it carries the tax figures from the order she paid on', JSON.stringify(F.taxBasisOf(child())) === JSON.stringify({ subtotalCents: 7000, taxCents: 528, discountCents: 400 }) && F.taxBasisOf({}) === null);
  check('so its items’ tax comes back like the original order’s: $2.24 on $28', taxShareCents(child(), 2800) === 224 && taxShareCents(payer(), 2800) === 224 && taxShareCents({ ...child(), taxBasis: undefined }, 2800) === 0);
  check('the backorder is worth $30.24: two polishes at $14 and their tax', F.followUpItemsCents(child()) === 3024, F.followUpItemsCents(child()));
  check('a polish already shorted on it doesn’t count again; an older backorder takes the tax figures from the order paid on',
    F.followUpItemsCents(child({ lines: [{ ...C1, qtyShorted: 1 }] })) === 1512
    && F.followUpItemsCents({ ...child(), taxBasis: undefined, lines: [{ ...L1, lineId: 'X', qtyOrdered: 2, qtyShorted: 0, status: 'pending' }] }, payer()) === 3024
    && F.followUpItemsCents({ ...child(), taxBasis: undefined, lines: [{ productId: 'other', unitPriceCents: 1500, qtyOrdered: 2 }] }, payer()) === 3240);
  check('an older backorder’s copied line (the whole line’s promo kept for fewer units) is priced from the original line: $14, not $13',
    F.followUpItemsCents({ ...child(), lines: [{ ...L1, lineId: 'X', qtyOrdered: 2, qtyShorted: 0 }] }) === 2600 + 208
    && F.followUpItemsCents({ ...child(), lines: [{ ...L1, lineId: 'X', qtyOrdered: 2, qtyShorted: 0 }] }, payer()) === 3024);
  const lostRepl = child({ id: 'l1', isReplacement: true, replacementFor: 'lost_in_transit', holdUntilRestock: undefined });
  check('cancelling a replacement for a parcel that was delivered after all gives nothing back; one still lost or coming back gives the items back',
    F.followUpCancelCents(lostRepl, payer({ stage: 'completed', deliveredAt: '2026-10-21T15:00:00Z' })) === 0
    && F.followUpCancelCents(lostRepl, payer({ carrierTrail: { carrierStatus: 'DELIVERED' } })) === 0
    && F.followUpCancelCents(lostRepl, payer({ carrierTrail: { carrierStatus: 'RETURNED' } })) === 3024
    && F.followUpCancelCents(lostRepl, payer()) === 3024 && F.followUpCancelCents(child(), payer({ deliveredAt: 'x' })) === 3024);
  check('the card’s room across the family: what it was charged, less every refund on the order and its follow-ups (not an order that paid for itself)',
    F.familyRefundableCents(payer({ refundedCents: 1000 }), [child({ refundedCents: 2000 }), child({ id: 'c2', chargedCents: 500, refundedCents: 500 }), child({ refundedCents: 2000 })]) === 4928);
  check('the same customer: the shared order link, or the same email when there’s no link',
    F.sameCustomer(payer(), child()) && !F.sameCustomer(payer({ qrToken: 'other' }), child()) && F.sameCustomer({ customerEmail: 'Dana@Example.com' }, { customerEmail: 'dana@example.com' }));

  // ── Sending a follow-up's refund ──
  const { POST: refundPOST } = await import('../../src/app/api/retail/refund/route');
  const fresh = async (setup: (d: any) => Promise<void> = async () => {}) => {
    db = makeDb(); stripeCalls.length = 0; stripeMade.length = 0; fetches.length = 0; stripeFail = ''; authTenant = {};
    actor = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
    await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
    await db.doc(`${T}/retailOrders/p1`).set(payer());
    await db.doc(`${T}/retailOrders/c1`).set(child({ stage: 'cancelled', pendingRefundCents: 3024 }));
    await db.doc(`${T}/loyaltyLedger/earn_order_p1`).set({ clientId: 'cl1', type: 'earn', points: 79, basisCents: 7928, saleId: 'order_p1' });
    await setup(db);
  };
  const send = (orderId = 'c1', extra: any = {}, headers: Record<string, string> = {}) => refundPOST(req({ tenantId: 't1', orderId, qrToken: extra.qrToken || 'qr1', ...extra }, headers)) as any;

  await fresh();
  let r = await send();
  const c = await get(`${T}/retailOrders/c1`); const p = await get(`${T}/retailOrders/p1`);
  check('a cancelled backorder’s $30.24 goes back to the card Dana paid with, on her original order',
    r.status === 200 && stripeCalls.length === 1 && stripeCalls[0].params.payment_intent === 'pi_P' && stripeCalls[0].params.amount === 3024
    && stripeCalls[0].opts.stripeAccount === 'acct_1' && stripeCalls[0].opts.idempotencyKey === 'retail-refund-c1-1' && stripeCalls[0].params.metadata.retailOrderId === 'c1' && stripeCalls[0].params.metadata.paidOnOrderId === 'p1', { r, stripeCalls });
  check('…recorded on the backorder (nothing left to send), and the original order isn’t held any more',
    c.pendingRefundCents === 0 && c.refundedCents === 3024 && c.refundSeq === 1 && c.refundInFlight === null && c.lastStripeRefundId === 're_1' && p.refundInFlight === null && (p.refundedCents || 0) === 0, { c, p });
  const cEv = await all(`${T}/retailOrders/c1/events`); const pEv = await all(`${T}/retailOrders/p1/events`); const txns = await all(`${T}/transactions`);
  check('…its history says where the money went, and the original order’s history notes the refund',
    cEv.length === 1 && cEv[0].type === 'refund_issued' && cEv[0].meta.paidOnOrderId === 'p1' && cEv[0].meta.scope === 'full' && /original order/.test(cEv[0].meta.text)
    && pEv.length === 1 && pEv[0].type === 'note' && pEv[0].meta.kind === 'follow_up_refund' && pEv[0].meta.amountCents === 3024 && /for the backorder/.test(pEv[0].meta.text), { cEv, pEv });
  check('…one refund in the books, for the backorder, saying which order paid',
    txns.length === 1 && txns[0].category === 'Refund' && txns[0].amount === 30.24 && txns[0].retailOrderId === 'c1' && txns[0].paidOnOrderId === 'p1' && /#1042 \(backorder\)/.test(txns[0].description), txns);
  const rev = await get(`${T}/loyaltyLedger/rev_order_p1_re_1`);
  const card = (await all(`${T}/retailOrders/c1/inbox`)).find((x: any) => x.kind === 'refund_issued');
  check('…the points come off the sale that earned them, and the refund is posted on the backorder’s page for Dana',
    !!rev && rev.points < 0 && rev.saleId === 'order_p1' && !!card && /30\.24/.test(String(card.body || '')), { rev, card });
  check('…and the team is told it went to the card on the original order', /card used on the original order/.test(r.body.message) && r.body.amountCents === 3024 && r.body.leftCents === 0);
  r = await send();
  check('tapping again sends nothing more', r.status === 409 && stripeCalls.length === 1, r);

  await fresh(async (d) => { await d.doc(`${T}/retailOrders/p1`).set({ refundedCents: 5000 }, { merge: true }); });
  r = await send();
  check('never more than the card has left: $50 already back on it, so $29.28 goes and the other 96¢ stays on the order for a look',
    r.status === 200 && stripeCalls[0].params.amount === 2928 && r.body.overCardCents === 96 && r.body.leftCents === 96 && /0\.96 is more than is left of what they paid/.test(r.body.message), r.body);
  r = await send();
  check('…and asking again says everything paid has gone back', r.status === 409 && /paid on the original order has already gone back/.test(r.body.error) && stripeCalls.length === 1, r.body);

  await fresh();
  await send();
  await db.doc(`${T}/retailOrders/p1`).set({ pendingRefundCents: 6000 }, { merge: true });
  r = await send('p1');
  check('the original order’s own refund counts what went back for its backorder: $49.04 of the $60 asked',
    r.status === 200 && stripeCalls[1].params.amount === 4904 && stripeCalls[1].params.payment_intent === 'pi_P' && stripeCalls[1].opts.idempotencyKey === 'retail-refund-p1-1' && !stripeCalls[1].params.metadata.paidOnOrderId, stripeCalls[1]);

  await fresh(async (d) => { await d.doc(`${T}/retailOrders/p1`).set({ refundInFlight: { at: new Date().toISOString(), cents: 100, seq: 1, by: 'x' } }, { merge: true }); });
  r = await send();
  check('while a refund on the original order is being sent, the backorder’s waits its turn', r.status === 409 && /already being sent/.test(r.body.error) && stripeCalls.length === 0, r.body);
  await fresh(async (d) => { await d.doc(`${T}/retailOrders/c1`).set({ refundInFlight: { at: new Date().toISOString(), cents: 100, seq: 1 } }, { merge: true }); });
  check('…as it does while its own is being sent', (await send()).status === 409 && stripeCalls.length === 0);

  await fresh(async (d) => { await d.doc(`${T}/retailOrders/p1`).set({ stripePaymentIntentId: '' }, { merge: true }); });
  r = await send();
  check('the original order has no card payment on file: refunded by hand, and said so', r.status === 422 && /order this one was made from/.test(r.body.error) && stripeCalls.length === 0, r.body);
  await fresh(async (d) => { await d.doc(`${T}/retailOrders/p1`).set({ qrToken: 'someone-else' }, { merge: true }); });
  r = await send();
  check('an order linked to someone else’s order is never refunded to that card', r.status === 422 && stripeCalls.length === 0, r.body);
  await fresh(async (d) => { await d.doc(`${T}/retailOrders/p1`).delete(); });
  check('…nor one whose original order is gone', (await send()).status === 422 && stripeCalls.length === 0);

  await fresh(async () => { authTenant = {}; });
  await db.doc(T).set({ retailSettings: { policies: { refundLimits: { cashier: 2500 } } } }, { merge: true });
  actor = { uid: 'k1', name: 'Kai', role: 'cashier', caps: ['checkout.refund'] };
  r = await send();
  check('the role’s refund limit holds: a cashier can’t send $30.24 over a $25 limit', r.status === 403 && stripeCalls.length === 0 && r.body.limitCents === 2500, r.body);
  await db.doc(`${T}/retailOrders/p1`).set({ refundedCents: 5528 }, { merge: true });
  r = await send();
  check('…checked against what would really go back: $24 the card has left is within it', r.status === 200 && stripeCalls[0].params.amount === 2400, r.body);

  await fresh(); stripeFail = 'Your card was declined for refunds';
  r = await send();
  const cf = await get(`${T}/retailOrders/c1`); const pf = await get(`${T}/retailOrders/p1`);
  check('Stripe turns it down: nothing is written and nothing stays held', r.status === 502 && /declined/.test(r.body.error) && cf.pendingRefundCents === 3024 && !cf.refundedCents && cf.refundInFlight === null && pf.refundInFlight === null && (await all(`${T}/transactions`)).length === 0, { cf, pf });

  await fresh(async (d) => {
    await d.doc(`${T}/retailOrders/c1`).set({ stage: 'paid', pendingRefundCents: 0, refundedCents: 2000 }, { merge: true });
    await d.doc(`${T}/retailOrders/r1`).set({ ...child({ id: 'r1', parentOrderId: 'c1', isReplacement: true, holdUntilRestock: undefined, lines: [{ ...F.lineFor(C1, 1), lineId: 'R1' }], taxBasis: F.taxBasisOf(child()) }), stage: 'cancelled', pendingRefundCents: 1512 });
  });
  r = await send('r1');
  check('a replacement for the backorder goes back to the same card, two orders up, within what the family has left',
    r.status === 200 && stripeCalls[0].params.payment_intent === 'pi_P' && stripeCalls[0].params.amount === 1512 && stripeCalls[0].params.metadata.paidOnOrderId === 'p1'
    && F.followUpItemsCents((await get(`${T}/retailOrders/r1`))) === 1512 && /for the replacement/.test((await all(`${T}/retailOrders/p1/events`))[0]?.meta?.text || ''), { r: r.body, calls: stripeCalls });

  await fresh();
  await db.doc(T).set({ retailSettings: { policies: { refundAutoBelowCents: 5000 } } }, { merge: true });
  r = await send('c1', { reason: 'customer_cancel' }, { 'x-internal-key': 'cron' });
  check('a customer’s own cancellation under the shop’s automatic-refund amount goes back by itself, to the original card',
    r.status === 200 && stripeCalls[0].params.payment_intent === 'pi_P' && (await all(`${T}/retailOrders/c1/events`))[0].actorName === 'Customer cancellation (automatic)', r.body);

  await fresh(async (d) => { await d.doc(`${T}/retailOrders/c1`).set({ isReplacement: true, replacementFor: 'lost_in_transit', holdUntilRestock: false }, { merge: true }); });
  await db.doc(T).set({ retailSettings: { policies: { refundAutoBelowCents: 5000 } } }, { merge: true });
  r = await send('c1', { reason: 'customer_cancel' }, { 'x-internal-key': 'cron' });
  check('…but never for a replacement for a lost parcel: that refund is the shop’s to send', r.status === 403 && stripeCalls.length === 0, r.body);

  await fresh();
  const realTx = db.runTransaction; let txCalls = 0;
  db.runTransaction = async (fn: any) => { txCalls += 1; if (txCalls >= 2) throw new Error('unavailable'); return realTx(fn); };
  r = await send();
  db.runTransaction = realTx;
  const cl = await get(`${T}/retailOrders/c1`);
  check('the money went but the order couldn’t be written: the team is told it went and to tap again, and the hold stays',
    r.status === 200 && r.body.recorded === false && stripeCalls.length === 1 && cl.pendingRefundCents === 3024 && !cl.refundedCents && cl.refundInFlight?.seq === 1 && /won’t be sent twice/.test(r.body.message), { r: r.body, cl });
  await db.doc(`${T}/retailOrders/c1`).set({ refundInFlight: { ...cl.refundInFlight, at: new Date(Date.now() - 3 * 60000).toISOString() } }, { merge: true });
  r = await send();
  const cl2 = await get(`${T}/retailOrders/c1`); const pl2 = await get(`${T}/retailOrders/p1`);
  check('…tapping again once the hold lapses finds that refund at Stripe and records it, without sending a second one',
    r.status === 200 && stripeCalls.length === 1 && cl2.pendingRefundCents === 0 && cl2.refundedCents === 3024 && cl2.refundSeq === 1 && cl2.refundInFlight === null && pl2.refundInFlight === null
    && cl2.lastStripeRefundId === 're_1' && /already gone back/.test(r.body.message) && (await all(`${T}/transactions`)).length === 1, { r: r.body, cl2, pl2 });
  await fresh(async (d) => { await d.doc(`${T}/retailOrders/c1`).set({ refundInFlight: { cents: 3024, seq: 1, at: new Date(Date.now() - 3 * 60000).toISOString(), by: 'm1' } }, { merge: true }); });
  r = await send();
  check('a lapsed hold whose refund never reached Stripe sends a new one, under a fresh number',
    r.status === 200 && stripeCalls.length === 1 && stripeCalls[0].opts.idempotencyKey === 'retail-refund-c1-2' && (await get(`${T}/retailOrders/c1`)).refundSeq === 2, { r: r.body, keys: stripeCalls.map((c) => c.opts.idempotencyKey) });

  await fresh(async (d) => {
    await d.doc(`${T}/retailOrders/c1`).set({ pendingRefundCents: 500, refundedCents: 1000, refundSeq: 0, refundInFlight: { cents: 1000, seq: 1, at: new Date(Date.now() - 3 * 60000).toISOString(), by: 'm1', refundedBefore: 0 } }, { merge: true });
  });
  stripeMade.push({ id: 're_old', amount: 1000, metadata: { retailOrderId: 'c1', seq: '1' }, status: 'succeeded', payment_intent: 'pi_P' });
  r = await send();
  const cm = await get(`${T}/retailOrders/c1`);
  check('a refund marked done by hand after a cut-off try isn’t recorded again: the new $5 goes out under a fresh number',
    r.status === 200 && stripeCalls.length === 1 && stripeCalls[0].params.amount === 500 && stripeCalls[0].opts.idempotencyKey === 'retail-refund-c1-2' && cm.refundedCents === 1500 && cm.pendingRefundCents === 0, { r: r.body, cm, keys: stripeCalls.map((c) => c.opts.idempotencyKey) });

  await fresh();
  const realTx2 = db.runTransaction; let txCalls2 = 0;
  db.runTransaction = async (fn: any) => { txCalls2 += 1; const out = await realTx2(fn); if (txCalls2 === 2) throw new Error('deadline exceeded'); return out; };
  r = await send();
  db.runTransaction = realTx2;
  const cw = await get(`${T}/retailOrders/c1`);
  check('a write that went through but reported an error is written once, and the points and the customer’s notice still happen',
    r.status === 200 && r.body.recorded !== false && !/already recorded/.test(r.body.message) && cw.refundedCents === 3024 && cw.pendingRefundCents === 0
    && (await all(`${T}/transactions`)).length === 1 && !!(await get(`${T}/loyaltyLedger/rev_order_p1_re_1`)) && (await all(`${T}/retailOrders/c1/inbox`)).some((x: any) => x.kind === 'refund_issued'), { r: r.body, cw });

  await fresh(async (d) => { await d.doc(`${T}/retailOrders/q1`).set({ id: 'q1', orderNumber: 1050, stage: 'cancelled', lines: [L2], totalCents: 5000, chargedCents: 5000, refundedCents: 0, pendingRefundCents: 1000, stripePaymentIntentId: 'pi_Q', qrToken: 'qrQ', customerEmail: 'lee@example.com', customerName: 'Lee' }); });
  r = await send('q1', { qrToken: 'qrQ' });
  const qEv = await all(`${T}/retailOrders/q1/events`); const qTx = await all(`${T}/transactions`);
  check('an ordinary order refunds exactly as before: its own card, its own key, nothing noted elsewhere',
    r.status === 200 && stripeCalls[0].params.payment_intent === 'pi_Q' && stripeCalls[0].params.amount === 1000 && stripeCalls[0].opts.idempotencyKey === 'retail-refund-q1-1'
    && !('paidOnOrderId' in stripeCalls[0].params.metadata) && qEv.length === 1 && !('paidOnOrderId' in qEv[0].meta) && qTx.length === 1 && !('paidOnOrderId' in qTx[0])
    && /^\$10\.00 has been refunded through Stripe\. It will/.test(r.body.message) && (await all(`${T}/retailOrders/p1/events`)).length === 0, { r: r.body, qEv, qTx });

  // ── Cancelling a follow-up from the board ──
  const Fu = await import('../../src/lib/retail-fulfill');
  const staff = { id: 'm1', name: 'Rae Moss' };
  const board = async (setup: (d: any) => Promise<void>) => {
    db = makeDb(); fetches.length = 0;
    await db.doc(T).set({ name: 'Opal' });
    await db.doc(`${T}/inventory/gel`).set({ name: 'Gel polish', totalStock: 10, stockReserved: 5, unit: 'units' });
    await db.doc(`${T}/retailOrders/p1`).set(payer());
    await setup(db);
  };
  await board(async (d) => { await d.doc(`${T}/retailOrders/c1`).set(child()); });
  let res: any = await Fu.cancelOrder(webFs, 't1', 'c1', staff, 'We can’t get more');
  let co = await get(`${T}/retailOrders/c1`);
  check('cancelling the backorder queues the $30.24 Dana paid for those polishes (it queued nothing before)',
    res.ok && co.stage === 'cancelled' && co.pendingRefundCents === 3024 && /\$30\.24 has been queued/.test(res.message), { res, co });
  check('…and gives back no stock: a backorder waiting for stock holds none', (await get(`${T}/inventory/gel`)).stockReserved === 5);
  await board(async (d) => { await d.doc(`${T}/retailOrders/c1`).set(child({ pendingRefundCents: 500 })); });
  await Fu.cancelOrder(webFs, 't1', 'c1', staff, 'x');
  check('anything already queued on it stays queued, with the items added', (await get(`${T}/retailOrders/c1`)).pendingRefundCents === 3524);
  await board(async (d) => { await d.doc(`${T}/retailOrders/c0`).set({ ...child({ id: 'c0' }), taxBasis: null, lines: [{ ...L1, lineId: 'X', qtyOrdered: 2, qtyScanned: 0, qtyShorted: 0, status: 'pending' }] }); });
  await Fu.cancelOrder(webFs, 't1', 'c0', staff, 'x');
  check('a backorder made before follow-ups carried their figures reads the price and tax from the order Dana paid on: $30.24', (await get(`${T}/retailOrders/c0`)).pendingRefundCents === 3024, await get(`${T}/retailOrders/c0`));
  const lost = (x: any = {}) => ({ ...child({ id: 'l1', isReplacement: true, replacementFor: 'lost_in_transit', holdUntilRestock: undefined }), ...x });
  await board(async (d) => { await d.doc(`${T}/retailOrders/p1`).set({ stage: 'completed', deliveredAt: '2026-10-21T15:00:00Z' }, { merge: true }); await d.doc(`${T}/retailOrders/l1`).set(lost()); });
  res = await Fu.cancelOrder(webFs, 't1', 'l1', staff, 'It turned up');
  check('a replacement whose lost parcel was delivered after all is cancelled with nothing to refund, and its held stock goes back',
    res.ok && (await get(`${T}/retailOrders/l1`)).pendingRefundCents === 0 && !/queued/.test(res.message) && (await get(`${T}/inventory/gel`)).stockReserved === 3, res);
  await board(async (d) => { await d.doc(`${T}/retailOrders/l1`).set(lost()); });
  await Fu.cancelOrder(webFs, 't1', 'l1', staff, 'Out of stock');
  check('…one for a parcel still lost gives back what was paid for what was in it', (await get(`${T}/retailOrders/l1`)).pendingRefundCents === 3024);
  await board(async (d) => { await d.doc(`${T}/retailOrders/p3`).set(payer({ id: 'p3', stage: 'paid', chargedCents: 5000, totalCents: 5000, pendingRefundCents: 0, lines: [L2] })); await d.doc(`${T}/inventory/file`).set({ stockReserved: 2 }); });
  await Fu.cancelOrder(webFs, 't1', 'p3', staff, 'x');
  check('an order the customer paid for still gets everything its card paid back', (await get(`${T}/retailOrders/p3`)).pendingRefundCents === 5000 && (await get(`${T}/inventory/file`)).stockReserved === 1);

  // ── Cancelling the order paid on, with follow-ups ──
  const pickingPayer = (x: any = {}) => payer({ stage: 'picking', ...x });
  await board(async (d) => { await d.doc(`${T}/retailOrders/p1`).set(pickingPayer()); await d.doc(`${T}/retailOrders/c1`).set(child()); });
  res = await Fu.cancelOrder(webFs, 't1', 'p1', staff, 'Changed my mind');
  let pp = await get(`${T}/retailOrders/p1`); let cc = await get(`${T}/retailOrders/c1`);
  check('cancelling Dana’s order cancels its backorder with it, and her card gets back all $79.28 once',
    res.ok && pp.stage === 'cancelled' && pp.pendingRefundCents === 7928 && cc.stage === 'cancelled' && (cc.pendingRefundCents || 0) === 0 && /with the backorder/.test(res.message)
    && /Cancelled with order #1042/.test(cc.cancelReason) && (await all(`${T}/retailOrders/c1/events`)).some((e: any) => e.type === 'cancelled'), { res, pp, cc });
  check('…the backorder held no stock, so only the order’s own two polishes and file go back on the shelf', (await get(`${T}/inventory/gel`)).stockReserved === 3, await get(`${T}/inventory/gel`));
  await board(async (d) => { await d.doc(`${T}/retailOrders/p1`).set(pickingPayer()); await d.doc(`${T}/retailOrders/c1`).set(child({ stage: 'cancelled', refundedCents: 3024 })); });
  await Fu.cancelOrder(webFs, 't1', 'p1', staff, 'x');
  check('the backorder was cancelled and its $30.24 sent first: cancelling the order queues the other $49.04, not $79.28', (await get(`${T}/retailOrders/p1`)).pendingRefundCents === 4904);
  await board(async (d) => { await d.doc(`${T}/retailOrders/p1`).set(pickingPayer()); await d.doc(`${T}/retailOrders/c1`).set(child({ stage: 'cancelled', pendingRefundCents: 3024 })); });
  await Fu.cancelOrder(webFs, 't1', 'p1', staff, 'x');
  check('…the same when its $30.24 is queued but not sent yet: that stays on the backorder', (await get(`${T}/retailOrders/p1`)).pendingRefundCents === 4904 && (await get(`${T}/retailOrders/c1`)).pendingRefundCents === 3024);
  await board(async (d) => { await d.doc(`${T}/retailOrders/p1`).set(pickingPayer()); await d.doc(`${T}/retailOrders/c1`).set(child({ stage: 'shipped', holdUntilRestock: false })); });
  await Fu.cancelOrder(webFs, 't1', 'p1', staff, 'x');
  check('a backorder that has already gone out stays, and the order’s refund leaves out what Dana keeps: $49.04',
    (await get(`${T}/retailOrders/p1`)).pendingRefundCents === 4904 && (await get(`${T}/retailOrders/c1`)).stage === 'shipped');
  await board(async (d) => { await d.doc(`${T}/retailOrders/p1`).set(payer({ stage: 'cancelled', pendingRefundCents: 0, refundedCents: 7928 })); await d.doc(`${T}/retailOrders/c1`).set(child()); });
  res = await Fu.cancelOrder(webFs, 't1', 'c1', staff, 'x');
  check('a backorder left open when its order was cancelled (before they went together) gives nothing more back: the order’s refund was everything',
    res.ok && (await get(`${T}/retailOrders/c1`)).pendingRefundCents === 0 && !/queued/.test(res.message), res);
  await board(async (d) => { await d.doc(`${T}/retailOrders/p1`).set({ refundedCents: 7928 }, { merge: true }); await d.doc(`${T}/retailOrders/c1`).set(child()); });
  await Fu.cancelOrder(webFs, 't1', 'c1', staff, 'x');
  check('…nor one whose order’s card has been refunded in full', (await get(`${T}/retailOrders/c1`)).pendingRefundCents === 0);
  await board(async (d) => { await d.doc(`${T}/retailOrders/p1`).set(payer({ chargedCents: 2928, giftCardCents: 5000, refundedCents: 2928 })); await d.doc(`${T}/retailOrders/c1`).set(child()); });
  await Fu.cancelOrder(webFs, 't1', 'c1', staff, 'x');
  check('an order part paid by gift card isn’t done giving back just because its card has been: the backorder’s $30.24 is still queued',
    (await get(`${T}/retailOrders/c1`)).pendingRefundCents === 3024);
  check('digital items hold no stock to give back', F.heldUnits({ stage: 'paid', lines: [{ productId: 'ebook', qtyOrdered: 1, digital: true }, { productId: 'gel', qtyOrdered: 2, qtyShorted: 1 }] }).size === 1
    && F.heldUnits({ stage: 'paid', lines: [{ productId: 'gel', qtyOrdered: 2, qtyShorted: 1 }] }).get('gel') === 1 && F.heldUnits({ stage: 'paid', holdUntilRestock: true, lines: [{ productId: 'gel', qtyOrdered: 2 }] }).size === 0);

  // ── Making follow-ups: shorts, returns, lost parcels ──
  const picking = (id: string) => ({ id, tenantId: 't1', orderNumber: 1060, stage: 'picking', method: 'ship', lines: [{ lineId: 'A', productId: 'gel', name: 'Gel polish', sku: 'GEL', barcode: 'GEL', unitPriceCents: 1500, qtyOrdered: 4, qtyScanned: 2, qtyShorted: 0, qtyReturned: 0, status: 'pending', promoCents: 400 }],
    subtotalCents: 6000, discountCents: 400, taxCents: 448, shippingCents: 0, totalCents: 6048, chargedCents: 6048, refundedCents: 0, stripePaymentIntentId: 'pi_S', qrToken: 'qrS', customerEmail: 'sam@example.com', customerName: 'Sam' });
  await board(async (d) => { await d.doc(`${T}/retailOrders/s1`).set(picking('s1')); await d.doc(`${T}/retailOrders/s2`).set(picking('s2')); });
  res = await Fu.resolveShortLine(webFs, 't1', 's1', 'A', 'Not on the shelf', 'backorder', staff);
  const bo = (await db.collection(`${T}/retailOrders`).where('parentOrderId', '==', 's1').get()).docs.map((x: any) => x.data())[0];
  check('a short sent to backorder makes a backorder whose polishes keep the price paid and the tax figures',
    res.ok && bo && bo.lines[0].qtyOrdered === 2 && bo.lines[0].unitPaidCents === 1400 && bo.lines[0].promoCents === 200 && JSON.stringify(bo.taxBasis) === JSON.stringify({ subtotalCents: 6000, taxCents: 448, discountCents: 400 }) && F.followUpItemsCents(bo) === 3024, bo);
  res = await Fu.resolveShortLine(webFs, 't1', 's2', 'A', 'Not on the shelf', 'refund', staff);
  check('a short refunded queues what was paid for those two, after the promo, with their tax: $30.24 (it was $32.40)', res.ok && (await get(`${T}/retailOrders/s2`)).pendingRefundCents === 3024, await get(`${T}/retailOrders/s2`));
  res = await Fu.reopenShortedLine(webFs, 't1', 's2', 'A', staff);
  check('…and reopening that short takes back exactly what it queued', res.ok && (await get(`${T}/retailOrders/s2`)).pendingRefundCents === 0, await get(`${T}/retailOrders/s2`));

  const Rt = await import('../../src/lib/retail-returns');
  await board(async (d) => {
    await d.doc(`${T}/retailOrders/p4`).set({ ...picking('p4'), stage: 'completed', lines: [{ lineId: 'B', productId: 'gel', name: 'Gel polish', sku: 'GEL', unitPriceCents: 1500, qtyOrdered: 4, qtyScanned: 4, qtyShorted: 0, qtyReturned: 0, status: 'picked', promoCents: 400 }] });
    await d.doc(`${T}/retailReturns/ret1`).set({ id: 'ret1', orderId: 'p4', orderNumber: 1060, resolution: 'replacement', status: 'open', lines: [{ lineId: 'B', sku: 'GEL', name: 'Gel polish', qty: 1, reason: 'defective', disposition: 'write_off' }] });
  });
  res = await Rt.resolveReturn(webFs, 't1', { ...(await get(`${T}/retailReturns/ret1`)), id: 'ret1' } as any, staff);
  const rp = (await db.collection(`${T}/retailOrders`).where('parentOrderId', '==', 'p4').get()).docs.map((x: any) => x.data())[0];
  check('a replacement for a return keeps the price paid for the item and the tax figures',
    res.ok && rp && rp.isReplacement && rp.lines[0].qtyOrdered === 1 && rp.lines[0].unitPaidCents === 1400 && rp.lines[0].promoCents === 100 && F.followUpItemsCents(rp) === 1512, { res, rp });

  const { POST: lostPOST } = await import('../../src/app/api/retail/lost-parcel/route');
  await board(async (d) => { await d.doc(`${T}/retailOrders/p5`).set({ ...picking('p5'), stage: 'shipped', lines: [{ lineId: 'D', productId: 'gel', name: 'Gel polish', sku: 'GEL', unitPriceCents: 1500, qtyOrdered: 4, qtyScanned: 3, qtyShorted: 1, qtyReturned: 0, status: 'refunded', promoCents: 400 }] }); });
  actor = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
  r = await lostPOST(req({ tenantId: 't1', orderId: 'p5' })) as any;
  const lr = r.body.replacementOrderId ? await get(`${T}/retailOrders/${r.body.replacementOrderId}`) : null;
  check('a replacement for a lost parcel carries the three polishes sent, each at the price paid, and the tax figures',
    r.status === 200 && lr && lr.lines[0].qtyOrdered === 3 && lr.lines[0].unitPaidCents === 1400 && lr.lines[0].promoCents === 300 && JSON.stringify(lr.taxBasis) === JSON.stringify({ subtotalCents: 6000, taxCents: 448, discountCents: 400 }), { r: r.body, lr });

  const { POST: runPOST } = await import('../../src/app/api/retail/preorder-run-cancel/route');
  await board(async (d) => { await d.doc(`${T}/retailOrders/pre1`).set({ ...picking('pre1'), stage: 'paid', hasPreorder: true, lines: [{ lineId: 'P', productId: 'kit', name: 'Starter kit', sku: 'KIT', unitPriceCents: 1500, qtyOrdered: 4, qtyShorted: 0, qtyScanned: 0, preorder: true, status: 'pending', promoCents: 400 }] }); });
  r = await runPOST(req({ tenantId: 't1', productId: 'kit', reason: 'The supplier fell through' })) as any;
  check('a pre-order run that falls through gives back what was paid for the items, with their tax: $60.48, not $56',
    r.status === 200 && (await get(`${T}/retailOrders/pre1`)).pendingRefundCents === 6048 && r.body.refundCents === 6048, { r: r.body, o: await get(`${T}/retailOrders/pre1`) });
  const { swapLines } = await import('../../src/lib/retail-swap');
  const sw = swapLines({ lines: [{ lineId: 'A', productId: 'gel', name: 'Gel polish', unitPriceCents: 1500, qtyOrdered: 4, qtyScanned: 2, qtyShorted: 0, promoCents: 400 }], subtotalCents: 6000, taxCents: 448, discountCents: 400 } as any, 'A', { productId: 'gel2', name: 'Gel polish (new)', unitPriceCents: 1200 }, 'B');
  const swUp = swapLines({ lines: [{ lineId: 'A', productId: 'gel', name: 'Gel polish', unitPriceCents: 1500, qtyOrdered: 4, qtyScanned: 2, qtyShorted: 0, promoCents: 400 }], subtotalCents: 6000, taxCents: 448, discountCents: 400 } as any, 'A', { productId: 'gel3', name: 'Gel polish (pro)', unitPriceCents: 1600 }, 'B');
  check('a swap is priced from what was paid after the promo: $4.32 back for a $12 one, and a $16 one costs them no more than the $14 they paid',
    sw.refundCents === 432 && swUp.refundCents === 0 && effectiveUnitCents(swUp.newLine) === 1400, { sw: sw.refundCents, up: effectiveUnitCents(swUp.newLine) });

  const SW = await import('../../src/lib/retail-swap-server');
  await board(async (d) => {
    await d.doc(`${T}/retailOrders/sw1`).set({ ...picking('sw1'), customerPhone: '', ifUnavailable: 'ask' });
    await d.doc(`${T}/inventory/gel2`).set({ name: 'Gel polish (new)', msrp: 12, totalStock: 5, stockReserved: 0 });
  });
  const offered = await SW.offerSwap(db, 't1', 'sw1', 'A', 'gel2', { id: 'm1', name: 'Rae Moss' }, 'https://shop.example');
  const swCard = (await all(`${T}/retailOrders/sw1/inbox`)).find((x: any) => x.kind === 'order_swap');
  check('asking about a swap quotes the refund the swap really gives: $4.32 on a $14 polish swapped for a $12 one, not $6.00',
    offered.ok && !!swCard && /\$4\.32/.test(String(swCard.body || '') + String(swCard.title || '')) && !/\$6\.00/.test(String(swCard.body || '')), { offered, swCard });

  // ── The customer cancels a backorder themselves ──
  const { POST: selfPOST } = await import('../../src/app/api/retail/self-serve/route');
  await board(async (d) => { await d.doc(T).set({ retailSettings: { policies: { refundAutoBelowCents: 5000 } } }, { merge: true }); await d.doc(`${T}/retailOrders/c1`).set(child()); });
  r = await selfPOST(req({ action: 'cancel', tenantId: 't1', orderId: 'c1', qrToken: 'qr1', reason: 'Found it elsewhere' })) as any;
  const sc = await get(`${T}/retailOrders/c1`);
  check('Dana cancels her backorder from her order page: $30.24 is queued and, under the shop’s automatic amount, sent straight back',
    r.status === 200 && sc.stage === 'cancelled' && sc.pendingRefundCents === 3024 && fetches.length === 1 && /\/api\/retail\/refund$/.test(fetches[0].url) && fetches[0].body.reason === 'customer_cancel' && fetches[0].body.orderId === 'c1' && /on its way back to your card/.test(r.body.message), { r: r.body, sc, fetches });
  check('…and no stock it never held is given back', (await get(`${T}/inventory/gel`)).stockReserved === 5);

  await board(async (d) => { await d.doc(`${T}/retailOrders/p1`).set(payer({ stage: 'paid' })); await d.doc(`${T}/retailOrders/c1`).set(child()); });
  r = await selfPOST(req({ action: 'cancel', tenantId: 't1', orderId: 'p1', qrToken: 'qr1' })) as any;
  check('Dana cancels her whole order from its page: the backorder goes with it and the card gets back $79.28 once',
    r.status === 200 && (await get(`${T}/retailOrders/p1`)).pendingRefundCents === 7928 && (await get(`${T}/retailOrders/c1`)).stage === 'cancelled' && ((await get(`${T}/retailOrders/c1`)).pendingRefundCents || 0) === 0, r.body);
  await board(async (d) => { await d.doc(`${T}/retailOrders/p1`).set(payer({ stage: 'paid' })); await d.doc(`${T}/retailOrders/c1`).set(child({ stage: 'packed', holdUntilRestock: false })); });
  r = await selfPOST(req({ action: 'cancel', tenantId: 't1', orderId: 'p1', qrToken: 'qr1' })) as any;
  check('…a backorder already being packed isn’t hers to cancel online: it ships, and her refund leaves out what’s in it ($49.04)',
    r.status === 200 && (await get(`${T}/retailOrders/p1`)).pendingRefundCents === 4904 && (await get(`${T}/retailOrders/c1`)).stage === 'packed', r.body);
  await board(async (d) => { await d.doc(T).set({ retailSettings: { policies: { refundAutoBelowCents: 5000 } } }, { merge: true }); await d.doc(`${T}/retailOrders/l1`).set(lost({ stage: 'paid' })); });
  fetches.length = 0;
  r = await selfPOST(req({ action: 'cancel', tenantId: 't1', orderId: 'l1', qrToken: 'qr1' })) as any;
  check('cancelling a replacement for a lost parcel queues the refund for the shop, never sent by itself: the first parcel may still turn up',
    r.status === 200 && (await get(`${T}/retailOrders/l1`)).pendingRefundCents === 3024 && !fetches.some((f) => /\/api\/retail\/refund$/.test(f.url)), { r: r.body, fetches });

  // ── A claim for a whole follow-up ──
  const { POST: claimPOST } = await import('../../src/app/api/retail/claims/route');
  await board(async (d) => { await d.doc(`${T}/retailOrders/l2`).set(lost({ id: 'l2', stage: 'shipped' })); });
  r = await claimPOST(req({ tenantId: 't1', orderId: 'l2', qrToken: 'qr1', type: 'not_received' })) as any;
  const claim = await get(`${T}/retailClaims/l2__not_received__order`);
  check('“it never arrived” on a replacement is worth what was paid for what was in it ($30.24), not its $0 total', r.status === 200 && claim && claim.claimValueCents === 3024, { r: r.body, claim });
  await board(async (d) => { await d.doc(`${T}/retailOrders/l3`).set({ ...lost({ id: 'l3', stage: 'shipped' }), taxBasis: null, lines: [{ ...L1, lineId: 'Y', qtyOrdered: 2, qtyScanned: 2, qtyShorted: 0, status: 'picked' }] }); });
  await claimPOST(req({ tenantId: 't1', orderId: 'l3', qrToken: 'qr1', type: 'not_received' }));
  check('…an older one reads its price and tax from the order paid on', (await get(`${T}/retailClaims/l3__not_received__order`))?.claimValueCents === 3024, await get(`${T}/retailClaims/l3__not_received__order`));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
