// Checks questions about swapping an out-of-stock item (lib/retail-swap-server). One that stopped applying (the order
// was cancelled or sent, the item was found or refunded) is closed, not left waiting: the regular job closes it, a late
// answer closes it and says so, a customer's own cancellation closes it, and a YES or NO text only lands on a question
// that still applies. The order page quotes the refund the swap really gives.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/swap-offers.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-retail-selfserve' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: {} };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/request-forensics') return { requestForensics: () => null };
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, json: async () => ({}) });
process.env.CRON_SECRET = 'cron';

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.example' } }) as any;
const L1 = { lineId: 'L1', productId: 'gel', name: 'Gel polish', unitPriceCents: 1500, promoCents: 200, qtyOrdered: 2, qtyScanned: 1, qtyShorted: 0, qtyReturned: 0, status: 'picking' };
const offer = (x: any = {}) => ({ lineId: 'L1', lineName: 'Gel polish', sub: { productId: 'gel2', name: 'Gel polish, rose', unitPriceCents: 1200 }, at: '2026-10-22T10:00:00Z', expiresAt: new Date(Date.now() + 3600e3).toISOString(), status: 'waiting', by: 'Rae', ...x });
const order = (x: any = {}) => ({ id: 'o1', tenantId: 't1', orderNumber: 1080, stage: 'picking', method: 'ship', lines: [L1], subtotalCents: 3000, taxCents: 240, totalCents: 3240, chargedCents: 3240, refundedCents: 0,
  stripePaymentIntentId: 'pi_1', qrToken: 'qr1', customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', customerPhone: '+15555550123', swapOffer: offer(), swapPendingPhone: '5555550123', ...x });

(async () => {
  const S = await import('../../src/lib/retail-swap-server');
  const { orderNow } = await import('../../src/lib/order-now');
  const fresh = async (x: any = {}) => {
    db = makeDb();
    await db.doc(T).set({ name: 'Opal', retailSettings: {} });
    await db.doc(`${T}/inventory/gel`).set({ name: 'Gel polish', msrp: 15, totalStock: 1, stockReserved: 2 });
    await db.doc(`${T}/inventory/gel2`).set({ name: 'Gel polish, rose', msrp: 12, totalStock: 5, stockReserved: 0 });
    await db.doc(`${T}/retailOrders/o1`).set(order(x));
  };

  check('a question still applies while the order is being packed and the item has units to send',
    S.offerStillOpen(order()) && !S.offerStillOpen(order({ stage: 'cancelled' })) && !S.offerStillOpen(order({ stage: 'shipped' }))
    && !S.offerStillOpen(order({ lines: [{ ...L1, qtyScanned: 2 }] })) && !S.offerStillOpen(order({ lines: [{ ...L1, qtyShorted: 1, status: 'refunded' }] })) && !S.offerStillOpen(order({ swapOffer: offer({ status: 'closed' }) })));

  await fresh({ stage: 'cancelled', swapOffer: offer({ expiresAt: new Date(Date.now() - 60e3).toISOString() }) });
  let n = await S.expireSwapOffers(db, 't1');
  let o = await get(`${T}/retailOrders/o1`);
  check('the order was cancelled while the question waited: the regular job closes it, and refunds nothing more',
    n === 0 && o.swapOffer.status === 'closed' && /cancelled/.test(o.swapOffer.closedWhy) && o.swapPendingPhone === null && !o.pendingRefundCents, o);

  await fresh({ lines: [{ ...L1, qtyScanned: 2 }] });
  n = await S.expireSwapOffers(db, 't1');
  o = await get(`${T}/retailOrders/o1`);
  check('the polish turned up and was packed: the question is closed even before it runs out', n === 0 && o.swapOffer.status === 'closed' && o.swapPendingPhone === null, o);

  await fresh({ stage: 'shipped' });
  const d = await S.decideSwap(db, 't1', 'o1', true, 'text', 'https://shop.example');
  o = await get(`${T}/retailOrders/o1`);
  check('a YES after the order shipped changes nothing, says so, and closes the question',
    !d.ok && /already been sorted out/.test(d.message) && o.swapOffer.status === 'closed' && o.lines.length === 1, { d, o });

  await fresh({ swapOffer: offer({ expiresAt: new Date(Date.now() - 60e3).toISOString() }) });
  n = await S.expireSwapOffers(db, 't1');
  o = await get(`${T}/retailOrders/o1`);
  check('a question that still applies and ran out is answered with a refund, as before', n === 1 && o.pendingRefundCents > 0 && o.swapOffer === null, o);

  // ── A customer's own cancellation ──
  const { POST: selfPOST } = await import('../../src/app/api/retail/self-serve/route');
  await fresh({ stage: 'paid', lines: [{ ...L1, qtyScanned: 0 }] });
  const r: any = await selfPOST(req({ action: 'cancel', tenantId: 't1', orderId: 'o1', qrToken: 'qr1', reason: 'Changed my mind' }));
  o = await get(`${T}/retailOrders/o1`);
  check('Dana cancels her order while a swap question waits: it’s closed with the order, so a later YES can’t land on it',
    r.status === 200 && o.stage === 'cancelled' && o.swapOffer?.status === 'closed' && o.swapPendingPhone === null, { r: r.body, o });

  // ── What her order page says ──
  const now = orderNow({ stage: 'picking', method: 'ship', swapOffer: { lineName: 'Gel polish', sub: { name: 'Gel polish, rose', unitPriceCents: 1200 }, origUnitCents: 1400, qty: 1, refundCents: 216 } });
  check('her order page quotes the refund the swap really gives: $2.16 on the $14 she paid, with its tax (not the $3 price gap)', /\$2\.16 difference/.test(String(now?.body || '')) && !/\$3\.00/.test(String(now?.body || '')), now);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
