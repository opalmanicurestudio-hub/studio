// Checks store credit for a return (lib/return-credit, api/retail/return-credit). The server works it out and issues
// it: what was paid for the items with their tax, never more than is left of what was paid on the order the customer
// paid on (after refunds made or waiting, gift card or credit given back, and credit for the order's other returns,
// including credit given before the server kept count), to that order's customer, or for a gift exchange to the person
// the server recorded when it was started. It's issued once. The returns desk asks the server for it rather than
// writing it, a renter can't settle the shop's returns, and the rules no longer let a browser add credit marked as for
// a return, or move a backorder or replacement to another order. The credit counts as given back wherever money goes
// back for the order: a card refund or a cancellation can't give the same money again.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/return-credit.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false, caps: [] };
let signedIn = true;
const webFs: any = { __fs: true };
let auto = 0;
const colRef = (path: string) => ({ __col: true, path, id: path.split('/').pop() });
const docRef = (path: string) => ({ __doc: true, path, id: path.split('/').pop() });
const webSnap = (s: any, r: any) => ({ exists: () => s.exists, data: () => s.data(), id: s.id, ref: r });
const browserWrites: string[] = [];
const web: any = {
  collection: (base: any, ...segs: string[]) => colRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/')),
  doc: (base: any, ...segs: string[]) => (base?.__col ? docRef(`${base.path}/${segs[0] || `auto${++auto}`}`) : docRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/'))),
  runTransaction: (_fs: any, fn: any) => db.runTransaction(() => fn({
    get: async (r: any) => webSnap(await db.doc(r.path).get(), r),
    update: (r: any, v: any) => { browserWrites.push(r.path); return db.doc(r.path).update(v); },
    set: (r: any, v: any, o?: any) => { browserWrites.push(r.path); return db.doc(r.path).set(v, o); },
  })),
  getDoc: async (r: any) => webSnap(await db.doc(r.path).get(), r),
  query: (c: any, ...cons: any[]) => ({ __q: true, path: c.path, cons }),
  where: (k: string, op: string, v: any) => ({ t: 'where', k, op, v }), limit: (n: number) => ({ t: 'limit', n }), orderBy: () => ({ t: 'orderBy' }),
  getDocs: async (q: any) => { let c: any = db.collection(q.path); for (const x of q.cons || []) { if (x?.t === 'where') c = c.where(x.k, x.op, x.v); if (x?.t === 'limit') c = c.limit(x.n); } const s = await c.get(); return { docs: s.docs.map((d: any) => ({ id: d.id, data: () => d.data(), exists: () => true })), empty: s.empty, size: s.size }; },
};
const stripeCalls: any[] = [];
function StripeMock(this: any) {
  return { refunds: {
    create: async (params: any) => { stripeCalls.push(params); return { id: `re_${stripeCalls.length}`, amount: params.amount, metadata: params.metadata, status: 'succeeded', payment_intent: params.payment_intent }; },
    list: async () => ({ data: [] }),
  } };
}
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === '@/lib/email-shell') return { brandedEmail: (_b: any, html: string) => html, emailButton: (link: string) => `<a href="${link}">`, getEmailBrand: async () => ({ shopName: 'Opal' }) };
  if (request === 'firebase/firestore') return web;
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => (signedIn ? { ok: true, actor, tenant: {} } : { ok: false, error: 'Sign in to record that decision.', status: 401 }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null };
  if (request.endsWith('staff-fetch')) return { staffAuthHeader: async () => ({ Authorization: 'Bearer t' }) };
  if (request.endsWith('renter-credit-client')) return { syncRenterCredits: () => undefined };
  return load.call(this, request, ...rest);
};
const notified: string[] = [];
let creditPOST: any = null;
(globalThis as any).fetch = async (url: any, init?: any) => {
  const u = String(url); const body = init?.body ? JSON.parse(init.body) : {};
  if (u.endsWith('/api/retail/return-credit')) { const r = await creditPOST({ json: async () => body, headers: { get: () => null } }); return { ok: r.status === 200, status: r.status, json: async () => r.body }; }
  if (u.endsWith('/api/retail/return-notify')) notified.push(body.returnId);
  return { ok: true, json: async () => ({}) };
};

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => null } }) as any;
// Dana paid $60.48 by card: four gel polishes at $15 with $4 off them ($14 each), 8% tax ($4.48).
const line = { lineId: 'A', productId: 'gel', name: 'Gel polish', sku: 'GEL', unitPriceCents: 1500, qtyOrdered: 4, qtyScanned: 4, qtyShorted: 0, qtyReturned: 0, status: 'picked', promoCents: 400 };
const order = (x: any = {}) => ({ id: 'o1', tenantId: 't1', orderNumber: 1150, stage: 'completed', method: 'ship', lines: [line], subtotalCents: 6000, discountCents: 400, taxCents: 448, shippingCents: 0, totalCents: 6048, chargedCents: 6048, refundedCents: 0,
  stripePaymentIntentId: 'pi_1', qrToken: 'qr1', customerEmail: 'Dana@Example.com', customerName: 'Dana Whitfield', clientId: 'cl1', ...x });
const ret = (id: string, qty: number, x: any = {}) => ({ id, orderId: 'o1', orderNumber: 1150, resolution: 'store_credit', status: 'received', storeCreditCents: 1512 * qty,
  lines: [{ lineId: 'A', sku: 'GEL', name: 'Gel polish', qty, reason: 'changed_mind', disposition: 'restock' }], ...x });
const fresh = async (x: any = {}) => {
  db = makeDb(); notified.length = 0; browserWrites.length = 0; signedIn = true;
  actor = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false, caps: [] };
  await db.doc(T).set({ name: 'Opal', retailSettings: {} });
  await db.doc(`${T}/retailOrders/o1`).set(order(x));
};

(async () => {
  const { POST } = await import('../../src/app/api/retail/return-credit/route');
  creditPOST = POST;
  const send = (returnId: string) => POST(req({ tenantId: 't1', returnId })) as any;

  // ── A return settled with store credit ──
  await fresh();
  await db.doc(`${T}/retailReturns/r1`).set(ret('r1', 1));
  let r = await send('r1');
  let c = await get(`${T}/depositCredits/return_r1`);
  check('one polish back: $15.12 store credit (what she paid, with its tax), for Dana, issued by the server',
    r.status === 200 && r.body.creditCents === 1512 && c?.amountCents === 1512 && c.clientEmail === 'dana@example.com' && c.clientId === 'cl1' && c.status === 'available' && c.sourceRetailReturnId === 'r1' && c.returnForOrderId === 'o1', { r: r.body, c });
  const r1 = await get(`${T}/retailReturns/r1`); const o1 = await get(`${T}/retailOrders/o1`);
  const ev = (await all(`${T}/retailOrders/o1/events`)).find((e: any) => e.type === 'return_resolved');
  check('…the return is settled, and the order and its history say so',
    r1.status === 'resolved' && r1.creditNetCents === 1512 && r1.resolvedBy === 'Kai Park' && o1.returnSummary?.creditCents === 1512 && ev?.meta?.creditCents === 1512, { r1, o1: o1.returnSummary, ev });
  const booked = (await all(`${T}/transactions`)).filter((x: any) => x.category === 'Refunds');
  check('…and in the books it’s a return of $15.12, with the $1.12 of tax that was on it', booked.length === 1 && booked[0].amount === 15.12 && Math.abs(booked[0].taxRefunded - 1.12) < 0.006 && booked[0].paymentMethod === 'Store credit' && o1.refundedTaxCents === Math.round(booked[0].taxRefunded * 100), booked);
  r = await send('r1');
  check('…tapped again: nothing more is issued', r.status === 200 && r.body.already === true && (await all(`${T}/depositCredits`)).length === 1 && (await all(`${T}/transactions`)).filter((x: any) => x.category === 'Refunds').length === 1, r.body);

  // ── Never more than is left of what was paid ──
  await fresh();
  await db.doc(`${T}/retailReturns/r2`).set(ret('r2', 1, { storeCreditCents: 900000 }));
  r = await send('r2');
  check('a return whose amount was changed to $9,000 on the team’s screen gives $60.48 at most: what was paid on the order',
    r.status === 200 && (await get(`${T}/depositCredits/return_r2`))?.amountCents === 6048 && r.body.cappedCents === 900000 - 6048 && /more than is left of what they paid/.test(r.body.message), r.body);
  await fresh({ refundedCents: 3024, pendingRefundCents: 1512 });
  await db.doc(`${T}/retailReturns/r3`).set(ret('r3', 2));
  r = await send('r3');
  check('$30.24 already refunded to the card and $15.12 waiting to go: two polishes back give $15.12, not $30.24',
    r.status === 200 && r.body.creditCents === 1512 && r.body.cappedCents === 1512, r.body);
  await fresh({ refundedCents: 6048 });
  await db.doc(`${T}/retailReturns/r4`).set(ret('r4', 1));
  r = await send('r4');
  check('everything already refunded: the return is checked in with no credit, and no “credit issued” email',
    r.status === 200 && r.body.creditCents === 0 && !(await get(`${T}/depositCredits/return_r4`)) && (await get(`${T}/retailReturns/r4`)).status === 'resolved' && /No store credit was issued/.test(r.body.message), r.body);

  // Credit given for another return on the order before the server kept count (written from a browser) still counts.
  await fresh();
  await db.doc(`${T}/retailReturns/old`).set(ret('old', 3, { status: 'resolved', creditNetCents: 4536 }));
  await db.doc(`${T}/depositCredits/abc`).set({ id: 'abc', clientEmail: 'dana@example.com', amountCents: 4536, status: 'available', sourceRetailReturnId: 'old' });
  await db.doc(`${T}/retailReturns/r5`).set(ret('r5', 2));
  r = await send('r5');
  check('$45.36 already given as credit for another return: what’s left is $15.12, so that’s all two more polishes give',
    r.status === 200 && r.body.creditCents === 1512 && (await get(`${T}/private/returnCredits/orders/o1`))?.cents === 4536 + 1512, r.body);
  await db.doc(`${T}/retailReturns/r6`).set(ret('r6', 1));
  r = await send('r6');
  check('…and the server keeps count: nothing is left for a third', r.status === 200 && r.body.creditCents === 0, r.body);

  // Part of it paid with store credit: that counts as paid too (the server's record of it).
  await fresh({ chargedCents: 3048 });
  await db.doc(`${T}/private/nonCardPaid/orders/o1`).set({ at: '2026-10-20T15:00:00Z', creditCents: 3000 });
  await db.doc(`${T}/retailReturns/r7`).set(ret('r7', 4));
  r = await send('r7');
  check('$30.48 by card and $30 of store credit: all four polishes back give the whole $60.48', r.status === 200 && r.body.creditCents === 6048, r.body);

  // ── A backorder's return ──
  await fresh();
  await db.doc(`${T}/retailOrders/b1`).set({ id: 'b1', tenantId: 't1', orderNumber: 1150, stage: 'completed', parentOrderId: 'o1', totalCents: 0, subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 1512, qrToken: 'qr1', customerEmail: 'someone.else@example.com',
    taxBasis: { subtotalCents: 6000, taxCents: 448, discountCents: 400 }, lines: [{ lineId: 'B', productId: 'gel', name: 'Gel polish', unitPriceCents: 1500, unitPaidCents: 1400, promoCents: 100, qtyOrdered: 1, qtyScanned: 1, qtyShorted: 0, qtyReturned: 0, status: 'picked' }] });
  await db.doc(`${T}/retailReturns/rb`).set({ id: 'rb', orderId: 'b1', orderNumber: 1150, resolution: 'store_credit', status: 'received', storeCreditCents: 1512, lines: [{ lineId: 'B', name: 'Gel polish', qty: 1, reason: 'changed_mind', disposition: 'restock' }] });
  r = await send('rb');
  c = await get(`${T}/depositCredits/return_rb`);
  check('a return on a backorder: the credit goes to the customer of the order she paid on (not an email changed on the backorder), counted against it',
    r.status === 200 && c?.amountCents === 1512 && c.clientEmail === 'dana@example.com' && c.returnForOrderId === 'o1', { r: r.body, c });

  // ── A gift exchange ──
  const { POST: giftPOST } = await import('../../src/app/api/retail/gift/route');
  await fresh({ gift: { token: 'gt1', to: 'Sam' }, completedAt: new Date().toISOString() });
  await db.doc(T).set({ name: 'Opal', retailSettings: { returnsEnabled: true } });
  r = await giftPOST(req({ tenantId: 't1', orderId: 'o1', g: 'gt1', name: 'Sam Lee', email: 'Sam@Example.com', selections: [{ lineId: 'A', qty: 1, reason: 'changed_mind' }] })) as any;
  const gid = r.body?.returnId;
  check('a gift exchange records who its credit is for where only the server writes',
    r.status === 200 && !!gid && (await get(`${T}/private/giftReturns/returns/${gid}`))?.email === 'sam@example.com', r.body);
  // Someone changes the recipient on the return, and takes off its gift marks, then checks it in.
  await db.doc(`${T}/retailReturns/${gid}`).set({ giftRecipient: { name: 'Not Sam', email: 'not.sam@example.com' }, status: 'received', lines: [{ lineId: 'A', sku: 'GEL', name: 'Gel polish', qty: 1, reason: 'changed_mind', disposition: 'restock' }] }, { merge: true });
  r = await send(gid);
  c = await get(`${T}/depositCredits/return_${gid}`);
  check('…so the credit goes to Sam, whatever the return was changed to say', r.status === 200 && c?.clientEmail === 'sam@example.com' && c.clientId === null && c.amountCents === 1512, { r: r.body, c });
  await fresh();
  await db.doc(`${T}/retailReturns/g2`).set(ret('g2', 1, { isGiftReturn: true, giftRecipient: { name: 'Sam Lee', email: 'sam@example.com' } }));
  r = await send('g2');
  check('a gift exchange started before the server kept that record: someone on the team can’t finish it…', r.status === 403 && /manager/.test(r.body.error) && !(await get(`${T}/depositCredits/return_g2`)), r.body);
  actor = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
  r = await send('g2');
  check('…a manager can', r.status === 200 && (await get(`${T}/depositCredits/return_g2`))?.clientEmail === 'sam@example.com', r.body);

  // ── Who can ──
  await fresh();
  await db.doc(`${T}/retailReturns/r8`).set(ret('r8', 1));
  actor = { uid: 'x1', name: 'Lee', role: 'renter', isRenter: true, caps: [] };
  r = await send('r8');
  check('a renter can’t settle the shop’s returns', r.status === 403 && !(await get(`${T}/depositCredits/return_r8`)), r.body);
  signedIn = false;
  r = await send('r8');
  check('…nor anyone not signed in', r.status === 401 && !(await get(`${T}/depositCredits/return_r8`)), r.body);

  // ── The returns desk asks the server ──
  const Rt = await import('../../src/lib/retail-returns');
  // As the server sets them (api/retail/fulfil): the credit issued by lib/return-credit, the email asked for.
  const RC = await import('../../src/lib/return-credit');
  Rt.setReturnEffects({ credit: async (t, id, a) => RC.resolveCreditReturn(db, t, id, { uid: a.id, name: a.name, isManager: false }) as any, notify: (_t, id) => { notified.push(id); }, renterCredits: () => {} });
  await fresh();
  await db.doc(`${T}/retailReturns/r9`).set(ret('r9', 1));
  const res: any = await Rt.resolveReturn(webFs, 't1', { ...(await get(`${T}/retailReturns/r9`)), id: 'r9' } as any, { id: 'k1', name: 'Kai Park' });
  check('checking in a store credit return asks the server, which issues it: the browser writes no credit',
    res.ok && (await get(`${T}/depositCredits/return_r9`))?.amountCents === 1512 && /\$15\.12 store credit issued/.test(res.message) && !browserWrites.some((p) => p.includes('depositCredits')) && notified.includes('r9'), { res, browserWrites });

  await fresh({ refundedCents: 6048 });
  await db.doc(`${T}/retailReturns/r10`).set(ret('r10', 1));
  const res2: any = await Rt.resolveReturn(webFs, 't1', { ...(await get(`${T}/retailReturns/r10`)), id: 'r10' } as any, { id: 'k1', name: 'Kai Park' });
  check('…and when nothing is left to give, it’s checked in without a “credit issued” email', res2.ok && /No store credit was issued/.test(res2.message) && !notified.includes('r10'), { res2, notified });

  // ── The credit counts wherever money goes back ──
  const { POST: refundPOST } = await import('../../src/app/api/retail/refund/route');
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  const refund = () => refundPOST({ json: async () => ({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1' }), headers: { get: () => null }, nextUrl: { origin: 'https://shop.example' } } as any) as any;
  await fresh();
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
  await db.doc(`${T}/retailReturns/ra`).set(ret('ra', 4));
  r = await send('ra');
  // The same four polishes, on a second return settled as a refund: $60.48 waiting to go back to the card.
  await db.doc(`${T}/retailOrders/o1`).set({ pendingRefundCents: 6048 }, { merge: true });
  actor = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
  stripeCalls.length = 0;
  let rf = await refund();
  check('all four polishes given as $60.48 store credit: a card refund for the same money is refused, nothing goes to the card',
    r.body.creditCents === 6048 && rf.status === 409 && stripeCalls.length === 0 && /given as store credit\./.test(rf.body.error), { credit: r.body, rf: rf.body });
  await fresh();
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
  await db.doc(`${T}/retailReturns/rc`).set(ret('rc', 1));
  r = await send('rc');
  await db.doc(`${T}/retailOrders/o1`).set({ pendingRefundCents: 6048 }, { merge: true });
  actor = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
  stripeCalls.length = 0;
  rf = await refund();
  check('one polish given as $15.12 credit: refunding the whole order sends $45.36 to the card, and says why the rest stays',
    rf.status === 200 && stripeCalls.length === 1 && stripeCalls[0].amount === 4536 && rf.body.overCardCents === 1512 && /store credit given for a return counts/.test(rf.body.message), rf.body);

  // Paid with a $20 gift card; a $10 return was given as store credit; then the order is cancelled.
  const { restoreNonCardPayment } = await import('../../src/lib/cancel-restore');
  await fresh({ lines: [{ ...line, unitPriceCents: 1000, promoCents: 0, qtyOrdered: 2 }], subtotalCents: 2000, discountCents: 0, taxCents: 0, totalCents: 2000, chargedCents: 0, stripePaymentIntentId: null, giftCardId: 'g1', giftCardCode: 'GIFT-1', giftCardCents: 2000, giftSpentAt: '2026-10-20T15:00:00Z', paidVia: 'gift_card' });
  await db.doc(`${T}/private/nonCardPaid/orders/o1`).set({ at: '2026-10-20T15:00:00Z', giftCents: 2000, giftCardId: 'g1' });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'GIFT-1', balanceCents: 0, status: 'active', history: [] });
  await db.doc(`${T}/retailReturns/rg`).set(ret('rg', 1, { storeCreditCents: 1000 }));
  r = await send('rg');
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'cancelled', cancelledAt: new Date().toISOString() }, { merge: true });
  const back = await restoreNonCardPayment(db, 't1', 'o1', 'Order cancelled');
  check('a $20 gift card order with $10 already given as credit for a return: cancelling it puts $10 back on the gift card, not $20',
    r.body.creditCents === 1000 && back.giftCents === 1000 && (await get(`${T}/giftCards/g1`)).balanceCents === 1000, { credit: r.body, back });

  // ── The rules ──
  const fsMod = await import('fs');
  const rules = fsMod.readFileSync('firestore.rules', 'utf8');
  const credits = (rules.match(/match \/tenants\/\{tenantId\}\/depositCredits\/\{creditId\} \{[\s\S]*?\n    \}/) || [''])[0];
  check('a browser can’t add store credit marked as for a return: the old way round the staff limit is gone',
    !!credits && !/\('sourceRetailReturnId' in request\.resource\.data\) \|\|/.test(credits) && /!request\.resource\.data\.keys\(\)\.hasAny\(\['sourceRetailReturnId', 'returnForOrderId'[^\]]*\]\)/.test(credits)
    && /amountCents <= staffCreditCapCents\(tenantId\)/.test(credits), credits);
  check('…and can’t move a backorder or replacement onto another order', /function orderLockedKeys\(\) \{[^}]*'parentOrderId'/.test(rules));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
