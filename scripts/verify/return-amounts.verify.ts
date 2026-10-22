// Checks what a return gives back. A return the customer starts from their order page, a gift recipient's exchange and
// one the team starts all come to the same figure: what was paid for the items, after any promo code, with their tax
// (lib/retail-orders returnRefundCents). A return started before that was counted the same way is settled at the full
// figure (lib/retail-returns resolveReturn). The restocking fee is a share of what was paid for the item, never its tax,
// and never when the shop was at fault (lib/restocking). The customer's email states the amount that was settled.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/return-amounts.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
const fetches: any[] = [];
const webFs: any = { __fs: true };
let auto = 0;
const colRef = (path: string) => ({ __col: true, path, id: path.split('/').pop() });
const docRef = (path: string) => ({ __doc: true, path, id: path.split('/').pop() });
const webSnap = (s: any, r: any) => ({ exists: () => s.exists, data: () => s.data(), id: s.id, ref: r });
const web: any = {
  collection: (base: any, ...segs: string[]) => colRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/')),
  doc: (base: any, ...segs: string[]) => (base?.__col ? docRef(`${base.path}/${segs[0] || `auto${++auto}`}`) : docRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/'))),
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
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase/firestore') return web;
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-retail-selfserve' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: {} };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/email-shell') return { brandedEmail: (_b: any, html: string) => html, emailButton: (link: string) => `<a href="${link}">`, getEmailBrand: async () => ({ shopName: 'Opal' }) };
  if (request === '@/lib/route-guard') return { staffOrServer: async () => true, requireCan: async () => ({ actor: { isRenter: false } }) };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: [] }, tenant: {} }) };
  if (request === '@/lib/cancel-restore') return { restoreNonCardPayment: async () => ({ giftCents: 0, creditCents: 0 }) };
  if (request === '@/lib/retail-webhook') return { sendOrderConfirmation: async () => ({}) };
  if (request === '@/lib/request-forensics') return { requestForensics: () => null };
  if (request.endsWith('staff-fetch')) return { staffAuthHeader: async () => ({}) };
  if (request.endsWith('renter-credit-client')) return { syncRenterCredits: () => undefined };
  return load.call(this, request, ...rest);
};
// The returns desk asks the server for store credit (api/retail/return-credit): that call goes to the real route.
let creditPOST: any = null;
(globalThis as any).fetch = async (url: any, init?: any) => {
  const body = init?.body ? JSON.parse(init.body) : null;
  fetches.push({ url: String(url), body });
  if (String(url).endsWith('/api/retail/return-credit') && creditPOST) { const r = await creditPOST({ json: async () => body, headers: { get: () => null } }); return { ok: r.status === 200, status: r.status, json: async () => r.body }; }
  return { ok: true, json: async () => ({}) };
};
process.env.RESEND_API_KEY = 'rk'; process.env.NOTIFY_FROM_EMAIL = 'shop@example.com';

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.example' } }) as any;

// Sam bought 4 gel polishes at $15 with $4 off them (a promo code): $14 each. Tax is 8% of the $56 ($4.48).
const line = { lineId: 'A', productId: 'gel', name: 'Gel polish', sku: 'GEL', unitPriceCents: 1500, qtyOrdered: 4, qtyScanned: 4, qtyShorted: 0, qtyReturned: 0, status: 'picked', promoCents: 400 };
const order = (x: any = {}) => ({ id: 'o1', tenantId: 't1', orderNumber: 1070, stage: 'completed', method: 'ship', completedAt: new Date().toISOString(), lines: [line], subtotalCents: 6000, discountCents: 400, taxCents: 448, shippingCents: 0, totalCents: 6048, chargedCents: 6048, refundedCents: 0, stripePaymentIntentId: 'pi_S', qrToken: 'qrS', customerEmail: 'sam@example.com', customerName: 'Sam Lee', ...x });
const fresh = async (rs: any = {}, x: any = {}) => {
  db = makeDb(); fetches.length = 0;
  await db.doc(T).set({ name: 'Opal', retailSettings: rs });
  await db.doc(`${T}/inventory/gel`).set({ name: 'Gel polish', totalStock: 10, stockReserved: 0, unit: 'units', costPerUnit: 4, batches: [] });
  await db.doc(`${T}/retailOrders/o1`).set(order(x));
};

(async () => {
  const { restockingFee } = await import('../../src/lib/restocking');
  const pol = { restockingFees: { as_new: 10, opened: 20, damaged: 50 } };
  check('the restocking fee is a share of what was paid ($14), not the $15 list price: 10% is $1.40',
    restockingFee([line], [{ lineId: 'A', qty: 1, reason: 'changed_mind', disposition: 'restock' }], pol).cents === 140);
  check('…20% for an opened one, and none at all when the shop was at fault',
    restockingFee([line], [{ lineId: 'A', qty: 1, reason: 'changed_mind', disposition: 'open_box' }], pol).cents === 280
    && restockingFee([line], [{ lineId: 'A', qty: 1, reason: 'defective', disposition: 'damaged' }], pol).waived);

  // ── Sam starts a return from his order page ──
  const { POST: selfPOST } = await import('../../src/app/api/retail/self-serve/route');
  await fresh();
  let r: any = await selfPOST(req({ action: 'start_return', tenantId: 't1', orderId: 'o1', qrToken: 'qrS', resolution: 'refund', selections: [{ lineId: 'A', qty: 1, reason: 'changed_mind' }] }));
  const rets = await all(`${T}/retailReturns`);
  check('a return Sam starts himself counts the polish’s tax too: $15.12, as a return the shop starts does (it was $14.00)',
    r.status === 200 && rets.length === 1 && rets[0].refundCents === 1512, { r: r.body, rets });
  r = await selfPOST(req({ action: 'start_return', tenantId: 't1', orderId: 'o1', qrToken: 'qrS', resolution: 'store_credit', selections: [{ lineId: 'A', qty: 2, reason: 'changed_mind' }] }));
  check('…and so does one he takes as store credit: $30.24 for two', r.status === 200 && (await all(`${T}/retailReturns`)).some((x: any) => x.storeCreditCents === 3024));

  // ── Settling a return ──
  const Rt = await import('../../src/lib/retail-returns');
  creditPOST = (await import('../../src/app/api/retail/return-credit/route')).POST;
  const staff = { id: 'm1', name: 'Rae Moss' };
  await fresh({ policies: pol });
  await db.doc(`${T}/retailReturns/ret1`).set({ id: 'ret1', orderId: 'o1', orderNumber: 1070, resolution: 'refund', status: 'received', refundCents: 1400, openedBy: 'Customer — Sam Lee', lines: [{ lineId: 'A', sku: 'GEL', name: 'Gel polish', qty: 1, reason: 'changed_mind', disposition: 'restock' }] });
  let res: any = await Rt.resolveReturn(webFs, 't1', { ...(await get(`${T}/retailReturns/ret1`)), id: 'ret1' } as any, staff);
  const ret1 = await get(`${T}/retailReturns/ret1`); const o1 = await get(`${T}/retailOrders/o1`);
  check('a return Sam started before the fix is settled at the full $15.12, less the $1.40 restocking fee: $13.72 queued',
    res.ok && res.refundQueuedCents === 1372 && o1.pendingRefundCents === 1372 && ret1.refundNetCents === 1372 && ret1.restockingFeeCents === 140 && o1.returnSummary?.refundCents === 1372, { res, ret1, o1 });
  await fresh({ policies: pol });
  await db.doc(`${T}/retailReturns/ret2`).set({ id: 'ret2', orderId: 'o1', orderNumber: 1070, resolution: 'store_credit', status: 'received', storeCreditCents: 1400, lines: [{ lineId: 'A', sku: 'GEL', name: 'Gel polish', qty: 1, reason: 'changed_mind', disposition: 'restock' }] });
  res = await Rt.resolveReturn(webFs, 't1', { ...(await get(`${T}/retailReturns/ret2`)), id: 'ret2' } as any, staff);
  const credits = await all(`${T}/depositCredits`);
  check('store credit is the full $15.12, with no restocking fee (fees are for refunds only)',
    res.ok && credits.length === 1 && credits[0].amountCents === 1512 && (await get(`${T}/retailReturns/ret2`)).creditNetCents === 1512, { res, credits });
  await fresh({ policies: pol });
  await db.doc(`${T}/retailReturns/ret3`).set({ id: 'ret3', orderId: 'o1', orderNumber: 1070, resolution: 'refund', status: 'received', refundCents: 1512, lines: [{ lineId: 'A', sku: 'GEL', name: 'Gel polish', qty: 1, reason: 'damaged_in_transit', disposition: 'damaged' }] });
  res = await Rt.resolveReturn(webFs, 't1', { ...(await get(`${T}/retailReturns/ret3`)), id: 'ret3' } as any, staff);
  check('a polish that arrived damaged comes back in full, $15.12, no fee', res.ok && res.refundQueuedCents === 1512 && !(await get(`${T}/retailReturns/ret3`)).restockingFeeCents);

  // ── The customer's email ──
  const { POST: notifyPOST } = await import('../../src/app/api/retail/return-notify/route');
  await fresh({ policies: pol });
  await db.doc(`${T}/retailReturns/ret4`).set({ id: 'ret4', orderId: 'o1', orderNumber: 1070, resolution: 'refund', status: 'resolved', refundCents: 1400, refundNetCents: 1372, restockingFeeCents: 140, lines: [{ lineId: 'A', name: 'Gel polish', qty: 1 }] });
  r = await notifyPOST(req({ tenantId: 't1', returnId: 'ret4' }));
  const card = (await all(`${T}/retailOrders/o1/inbox`))[0];
  const body = String(card?.body || '');
  check('Sam’s email says what really comes back, $13.72, and that a $1.40 restocking fee came off',
    r.status === 200 && /\$13\.72/.test(body) && /restocking fee of \$1\.40/.test(body) && !/\$14\.00/.test(body), { r: r.body, body: body.slice(0, 400) });

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
