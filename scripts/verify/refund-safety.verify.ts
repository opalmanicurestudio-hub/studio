// Checks the refund route's guards (api/retail/refund): a try cut off after Stripe sent the money is recorded, never
// sent again, however many tries came before it; when Stripe gives no clear answer the hold stays, and the next try
// asks Stripe first; the shop's automatic amount is for an order and everything made from it, not for each tap; a
// renter never sends the shop's money; nothing made from a replacement for a lost parcel goes back on its own; and a
// closing write that went through but reported an error still tells the customer about the gift card part.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/refund-safety.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
let actor: any = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
const stripeCalls: any[] = []; const stripeMade: any[] = []; let stripeFail = '';
function StripeMock(this: any) {
  return { refunds: {
    create: async (params: any, opts: any) => {
      stripeCalls.push({ params, opts });
      if (stripeFail) throw Object.assign(new Error(stripeFail), { type: stripeFail === 'timeout' ? 'StripeConnectionError' : 'StripeInvalidRequestError', raw: { message: stripeFail } });
      const r = { id: `re_${stripeMade.length + 1}`, amount: params.amount, metadata: params.metadata, status: 'succeeded', payment_intent: params.payment_intent };
      stripeMade.push(r); return r;
    },
    list: async (params: any) => ({ data: stripeMade.filter((r) => r.payment_intent === params.payment_intent) }),
  } };
}
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/email-shell') return { brandedEmail: (_b: any, html: string) => html, emailButton: (link: string) => `<a href="${link}">`, getEmailBrand: async () => ({ shopName: 'Opal' }) };
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, json: async () => ({}) });
process.env.STRIPE_SECRET_KEY = 'sk_test'; process.env.CRON_SECRET = 'cron'; process.env.RESEND_API_KEY = 'rk'; process.env.NOTIFY_FROM_EMAIL = 'shop@example.com';

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, nextUrl: { origin: 'https://shop.example' } }) as any;
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const order = (x: any = {}) => ({ id: 'o1', tenantId: 't1', orderNumber: 1130, stage: 'completed', method: 'ship', lines: [], subtotalCents: 10000, taxCents: 0, totalCents: 10000, chargedCents: 10000, refundedCents: 0,
  stripePaymentIntentId: 'pi_1', qrToken: 'qr1', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', pendingRefundCents: 3000, ...x });

(async () => {
  const { POST } = await import('../../src/app/api/retail/refund/route');
  const fresh = async (x: any = {}, rs: any = {}) => {
    db = makeDb(); stripeCalls.length = 0; stripeMade.length = 0; stripeFail = '';
    actor = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
    await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: rs });
    await db.doc(`${T}/retailOrders/o1`).set(order(x));
  };
  const send = (orderId = 'o1', extra: any = {}, headers: Record<string, string> = {}) => POST(req({ tenantId: 't1', orderId, qrToken: 'qr1', ...extra }, headers)) as any;

  // ── A try that was cut off, then another whose write failed: the third records, never sends again ──
  await fresh({ refundInFlight: { cents: 3000, seq: 1, at: ago(6), by: 'm1', refundedBefore: 0 } });
  const realTx = db.runTransaction; let txn = 0;
  db.runTransaction = async (fn: any) => { txn += 1; if (txn >= 2) throw new Error('unavailable'); return realTx(fn); };
  let r = await send();
  db.runTransaction = realTx;
  let o = await get(`${T}/retailOrders/o1`);
  check('after a try that never reached Stripe, the next one sends under a new number, never the old one', r.body.recorded === false && stripeCalls.length === 1 && stripeCalls[0].opts.idempotencyKey === 'retail-refund-o1-2' && o.refundInFlight?.seq === 2, { r: r.body, keys: stripeCalls.map((c) => c.opts.idempotencyKey), o });
  await db.doc(`${T}/retailOrders/o1`).set({ refundInFlight: { ...o.refundInFlight, at: ago(6) } }, { merge: true });
  r = await send();
  o = await get(`${T}/retailOrders/o1`);
  check('…when that one’s write failed too, the third try finds its refund at Stripe and records it: $30 out, $30 recorded, not $60',
    r.status === 200 && stripeCalls.length === 1 && o.refundedCents === 3000 && o.pendingRefundCents === 0 && o.refundSeq === 2 && o.lastStripeRefundId === 're_1', { r: r.body, o, n: stripeCalls.length });

  // ── No clear answer from Stripe ──
  await fresh();
  stripeFail = 'timeout';
  r = await send();
  o = await get(`${T}/retailOrders/o1`);
  check('Stripe doesn’t answer in time: the hold stays, and the team is told to try again in five minutes', r.status === 502 && /five minutes/.test(r.body.error) && o.refundInFlight?.seq === 1, { r: r.body, o });
  r = await send();
  check('…a tap meanwhile is told it’s already being sent', r.status === 409 && stripeCalls.length === 1);
  stripeFail = '';
  stripeMade.push({ id: 're_late', amount: 3000, metadata: { retailOrderId: 'o1', seq: '1' }, status: 'succeeded', payment_intent: 'pi_1' });
  await db.doc(`${T}/retailOrders/o1`).set({ refundInFlight: { ...o.refundInFlight, at: ago(6) } }, { merge: true });
  r = await send();
  o = await get(`${T}/retailOrders/o1`);
  check('…once it lapses, Stripe is asked first: the refund it made after all is recorded, not sent again', r.status === 200 && stripeCalls.length === 1 && o.refundedCents === 3000 && o.lastStripeRefundId === 're_late', { r: r.body, o });
  await fresh(); stripeFail = 'No such charge';
  r = await send();
  check('Stripe says no: nothing moved, so the hold comes off straight away', r.status === 502 && (await get(`${T}/retailOrders/o1`)).refundInFlight === null, r.body);

  // ── The automatic amount is for the order, not for each tap ──
  await fresh({ pendingRefundCents: 2000 }, { policies: { refundAutoBelowCents: 2000 } });
  actor = { uid: 'k1', name: 'Kai', role: 'cashier', caps: [] };
  r = await send('o1', { reason: 'policy' });
  check('within the $20 automatic amount, a team member without refund rights sends $20', r.status === 200 && stripeCalls.length === 1, r.body);
  await db.doc(`${T}/retailOrders/o1`).set({ pendingRefundCents: 2000 }, { merge: true });
  r = await send('o1', { reason: 'policy' });
  check('…but not another $20 on the same order: what already went back on its own counts, kept where only the server writes', r.status === 403 && stripeCalls.length === 1 && (await get(`${T}/private/autoRefunds/orders/o1`))?.cents === 2000, r.body);
  // A browser can write the order's own fields, but the running total isn't one of them.
  await db.doc(`${T}/retailOrders/o1`).set({ autoRefundedCents: 0 }, { merge: true });
  r = await send('o1', { reason: 'policy' });
  check('…and clearing a field on the order doesn’t reset it', r.status === 403 && stripeCalls.length === 1, r.body);
  await db.doc(`${T}/retailOrders/b1`).set({ id: 'b1', tenantId: 't1', orderNumber: 1130, stage: 'cancelled', parentOrderId: 'o1', totalCents: 0, qrToken: 'qr1', customerEmail: 'dana@example.com', pendingRefundCents: 500, lines: [] });
  r = await send('b1', { reason: 'policy' });
  check('…nor on an order made from it: the automatic amount covers the whole family', r.status === 403 && stripeCalls.length === 1, r.body);
  r = await send('o1', { reason: 'policy' }, { 'x-internal-key': 'cron' });
  check('…the shop’s own server is held to the same total', r.status === 403 && stripeCalls.length === 1, r.body);
  actor = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
  r = await send();
  check('…someone allowed to refund still sends it', r.status === 200 && stripeCalls.length === 2, r.body);

  // ── Renters ──
  await fresh({ pendingRefundCents: 1000 }, { policies: { refundAutoBelowCents: 5000 } });
  actor = { uid: 'x1', name: 'Lee', role: 'staff', isRenter: true, caps: ['checkout.refund'] };
  r = await send('o1', { reason: 'policy' });
  check('a renter signed in to the staff side can’t send the shop’s refund, even within the automatic amount', r.status === 403 && stripeCalls.length === 0, r.body);
  r = await send();
  check('…or at all', r.status === 403 && stripeCalls.length === 0, r.body);

  // ── Made from a replacement for a lost parcel ──
  await fresh({}, { policies: { refundAutoBelowCents: 5000 } });
  await db.doc(`${T}/retailOrders/rp`).set({ id: 'rp', tenantId: 't1', orderNumber: 1130, stage: 'shipped', parentOrderId: 'o1', isReplacement: true, replacementFor: 'lost_in_transit', totalCents: 0, qrToken: 'qr1', customerEmail: 'dana@example.com', lines: [] });
  await db.doc(`${T}/retailOrders/bo`).set({ id: 'bo', tenantId: 't1', orderNumber: 1130, stage: 'cancelled', parentOrderId: 'rp', totalCents: 0, qrToken: 'qr1', customerEmail: 'dana@example.com', pendingRefundCents: 1000, lines: [] });
  r = await send('bo', { reason: 'policy' }, { 'x-internal-key': 'cron' });
  check('a backorder made from a replacement for a lost parcel isn’t refunded on its own either', r.status === 403 && stripeCalls.length === 0, r.body);

  // ── A closing write that went through but reported an error ──
  await fresh({ chargedCents: 2500, giftCardId: 'g1', giftCardCode: 'GIFT-1234', giftCardCents: 1500, giftSpentAt: '2026-10-01T10:00:00Z', totalCents: 4000, pendingRefundCents: 3000, stage: 'completed' });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'GIFT-1234', balanceCents: 0, status: 'active', history: [] });
  await db.doc(`${T}/private/nonCardPaid/orders/o1`).set({ at: '2026-10-01T10:00:00Z', giftCents: 1500, giftCardId: 'g1' });
  let t2 = 0;
  db.runTransaction = async (fn: any) => { t2 += 1; const out = await realTx(fn); if (t2 === 2) throw new Error('deadline exceeded'); return out; };
  r = await send();
  db.runTransaction = realTx;
  const card = (await all(`${T}/retailOrders/o1/inbox`)).find((x: any) => x.kind === 'refund_issued');
  check('a write that went through but reported an error: the customer is still told about the $5 on her gift card, not “$0.00”',
    r.status === 200 && r.body.amountCents === 3000 && r.body.otherCents === 500 && !!card && /30\.00/.test(card.body) && /gift card/.test(card.body) && (await get(`${T}/giftCards/g1`)).balanceCents === 500, { r: r.body, card });

  // ── The rules: a browser can't make an order that looks paid ──
  const fsMod = await import('fs');
  const rules = fsMod.readFileSync('firestore.rules', 'utf8');
  check('a new order from the browser can’t carry a payment, a gift card, store credit or a refund record',
    /orderCreateLockedKeys\(\)/.test(rules) && /hasAny\(orderCreateLockedKeys\(\)\)/.test(rules) && ['giftCardId', 'giftSpentAt', 'giftCardCents', 'storeCreditRequestedCents', 'creditShortfallCents', 'nonCardRestored', 'stripePaymentIntentId', 'refundedOtherCents'].every((k) => new RegExp(`function orderCreateLockedKeys\\(\\) \\{[^}]*'${k}'`).test(rules))
    && /'refundedOtherCents'\];\s*\}\s*\/\/ What a new order/.test(rules));
  check('the server’s records (what an order paid by gift card or credit, and what went back on its own) are where no browser reads or writes',
    /match \/tenants\/\{tenantId\}\/private\/\{docId\} \{\s*allow read, write: if false;/.test(rules) && /'private',/.test(rules));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
