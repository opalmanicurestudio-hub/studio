// Checks cancelling an order made from another one after the order it was paid on was cancelled while keeping it back
// (lib/order-family followUpCancelCents with the family): it still gives back what it was kept back for, and nothing
// more than the family holds. Also: orders made from a replacement for a lost parcel stay part of that replacement;
// a missing-item report on a parcel already replaced goes to the replacement; a pre-order run is cancelled only by
// someone allowed to refund; and a return the team starts can't take items a customer has reported.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/family-cancel.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
const webFs: any = { __fs: true };
let auto = 0;
const colRef = (path: string) => ({ __col: true, path, id: path.split('/').pop() });
const docRef = (path: string) => ({ __doc: true, path, id: path.split('/').pop() });
const webSnap = (s: any, r: any) => ({ exists: () => s.exists, data: () => s.data(), id: s.id, ref: r });
const web: any = {
  collection: (base: any, ...segs: string[]) => colRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/')),
  doc: (base: any, ...segs: string[]) => (base?.__col ? docRef(`${base.path}/${segs[0] || `auto${++auto}`}`) : docRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/'))),
  runTransaction: (_fs: any, fn: any) => db.runTransaction(() => fn({ get: async (r: any) => webSnap(await db.doc(r.path).get(), r), update: (r: any, v: any) => db.doc(r.path).update(v), set: (r: any, v: any, o?: any) => db.doc(r.path).set(v, o) })),
  getDoc: async (r: any) => webSnap(await db.doc(r.path).get(), r),
  query: (c: any, ...cons: any[]) => ({ __q: true, path: c.path, cons }),
  where: (k: string, op: string, v: any) => ({ t: 'where', k, op, v }), limit: (n: number) => ({ t: 'limit', n }), orderBy: () => ({ t: 'orderBy' }),
  getDocs: async (q: any) => { let c: any = db.collection(q.path); for (const x of q.cons || []) { if (x?.t === 'where') c = c.where(x.k, x.op, x.v); if (x?.t === 'limit') c = c.limit(x.n); } const s = await c.get(); return { docs: s.docs.map((d: any) => ({ id: d.id, data: () => d.data(), exists: () => true })), empty: s.empty, size: s.size }; },
};
let canRefund = true;
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase/firestore') return web;
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-retail-claims' }, { name: 'admin-retail-selfserve' }, { name: 'retail-run-cancel' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: {} };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/request-forensics') return { requestForensics: () => null };
  if (request === '@/lib/route-guard') return { staffOrServer: async () => true, requireCan: async () => (canRefund ? { actor: { isRenter: false } } : { deny: { status: 403, body: { ok: false, error: 'Your role doesn’t allow that — ask the owner.' } } }) };
  if (request === '@/lib/email-shell') return { brandedEmail: (_b: any, html: string) => html, emailButton: (link: string) => `<a href="${link}">`, getEmailBrand: async () => ({ shopName: 'Opal' }) };
  if (request.endsWith('staff-fetch')) return { staffAuthHeader: async () => ({}) };
  if (request.endsWith('renter-credit-client')) return { syncRenterCredits: () => undefined };
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
process.env.CRON_SECRET = 'cron';

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.example' } }) as any;
const staff = { id: 'u1', name: 'Rae Moss' };
// Dana paid $100 by card: a $50 kit on pre-order, and a $50 lamp sent later as a backorder (no tax).
const payer = (x: any = {}) => ({ id: 'p1', tenantId: 't1', orderNumber: 1140, stage: 'paid', method: 'ship', lines: [{ lineId: 'K', productId: 'kit', name: 'Kit', unitPriceCents: 5000, qtyOrdered: 1, qtyShorted: 0, preorder: true, status: 'pending' }, { lineId: 'L', productId: 'lamp', name: 'Lamp', unitPriceCents: 5000, qtyOrdered: 1, qtyShorted: 1, status: 'backordered' }],
  subtotalCents: 10000, taxCents: 0, shippingCents: 0, totalCents: 10000, chargedCents: 10000, refundedCents: 0, stripePaymentIntentId: 'pi_1', qrToken: 'qr1', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', ...x });
const lampBo = (x: any = {}) => ({ id: 'f1', tenantId: 't1', orderNumber: 1140, stage: 'paid', method: 'ship', parentOrderId: 'p1', holdUntilRestock: true, totalCents: 0, subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0, taxBasis: { subtotalCents: 10000, taxCents: 0, discountCents: 0 },
  lines: [{ lineId: 'L2', productId: 'lamp', name: 'Lamp', unitPriceCents: 5000, unitPaidCents: 5000, qtyOrdered: 1, qtyShorted: 0, status: 'pending' }], qrToken: 'qr1', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', ...x });

(async () => {
  const RF = await import('../../src/lib/retail-fulfill');
  const fresh = async (setup: (d: any) => Promise<void>) => { db = makeDb(); canRefund = true; await db.doc(T).set({ name: 'Opal', retailSettings: { claimAutoResolveMaxCents: 5000 } }); await setup(db); };

  // The kit's run fell through: the order was cancelled, keeping back the $50 for the lamp still to come.
  const { POST: runPOST } = await import('../../src/app/api/retail/preorder-run-cancel/route');
  await fresh(async (d) => { await d.doc(`${T}/retailOrders/p1`).set({ ...payer(), hasPreorder: true }); await d.doc(`${T}/retailOrders/f1`).set(lampBo()); });
  let r: any = await runPOST(req({ tenantId: 't1', productId: 'kit', reason: 'Supplier fell through' }));
  const p1 = await get(`${T}/retailOrders/p1`);
  check('the run fell through: the order is cancelled and $50 queued, the lamp’s $50 kept back for it', r.status === 200 && p1.stage === 'cancelled' && p1.pendingRefundCents === 5000, { r: r.body, p1 });
  let c: any = await RF.cancelOrder(webFs, 't1', 'f1', staff, 'Changed my mind');
  check('Dana cancels the lamp later: its $50 comes back (it used to give nothing, as the order was cancelled)', c.ok && (await get(`${T}/retailOrders/f1`)).pendingRefundCents === 5000, { c, f1: await get(`${T}/retailOrders/f1`) });

  await fresh(async (d) => { await d.doc(`${T}/retailOrders/p1`).set(payer({ stage: 'cancelled', pendingRefundCents: 10000 })); await d.doc(`${T}/retailOrders/f1`).set(lampBo()); });
  c = await RF.cancelOrder(webFs, 't1', 'f1', staff, 'x');
  check('…but when the order’s own cancellation already gave back everything, the lamp gives nothing more', c.ok && (await get(`${T}/retailOrders/f1`)).pendingRefundCents === 0, await get(`${T}/retailOrders/f1`));

  // ── A pre-order run is cancelled only by someone allowed to refund ──
  await fresh(async (d) => { await d.doc(`${T}/retailOrders/p1`).set({ ...payer(), hasPreorder: true }); });
  canRefund = false;
  r = await runPOST(req({ tenantId: 't1', productId: 'kit', reason: 'x' }));
  check('someone not allowed to refund can see what cancelling a run would do, but not do it', r.status === 403 && (await get(`${T}/retailOrders/p1`)).stage === 'paid', r);
  r = await runPOST(req({ tenantId: 't1', productId: 'kit', dryRun: true }));
  check('…the preview still works for them', r.status === 200 && r.body.orders === 1, r.body);

  // ── Orders made from a replacement for a lost parcel stay part of it ──
  await fresh(async (d) => {
    await d.doc(`${T}/retailOrders/lost`).set(payer({ id: 'lost', stage: 'shipped', replacementOrderId: 'rp' }));
    await d.doc(`${T}/retailOrders/rp`).set({ ...lampBo({ id: 'rp', parentOrderId: 'lost', holdUntilRestock: false, isReplacement: true, replacementFor: 'lost_in_transit', lostParcelOrderId: 'lost' }), stage: 'picking', lines: [{ lineId: 'R1', productId: 'lamp', name: 'Lamp', unitPriceCents: 5000, unitPaidCents: 5000, qtyOrdered: 1, qtyScanned: 0, qtyShorted: 0, status: 'pending' }] });
    await d.doc(`${T}/inventory/lamp`).set({ name: 'Lamp', totalStock: 0, stockReserved: 1 });
  });
  const sh = await RF.resolveShortLine(webFs, 't1', 'rp', 'R1', 'Not on the shelf', 'backorder', staff);
  const kids = (await db.collection(`${T}/retailOrders`).where('parentOrderId', '==', 'rp').get()).docs.map((x: any) => x.data());
  check('a lamp short on a lost parcel’s replacement goes on a backorder that is still part of that replacement',
    sh.ok && kids.length === 1 && kids[0].replacementFor === 'lost_in_transit' && kids[0].lostParcelOrderId === 'lost', { sh, kids });
  await db.doc(`${T}/retailOrders/lost`).set({ deliveredAt: '2026-10-21T15:00:00Z', stage: 'completed' }, { merge: true });
  const kidId = (await db.collection(`${T}/retailOrders`).where('parentOrderId', '==', 'rp').get()).docs[0].id;
  c = await RF.cancelOrder(webFs, 't1', kidId, staff, 'x');
  check('…so when the first parcel turns up after all, cancelling that backorder gives nothing back (she has the lamp)', c.ok && !(await get(`${T}/retailOrders/${kidId}`)).pendingRefundCents, await get(`${T}/retailOrders/${kidId}`));

  // ── A missing-item report on a parcel already replaced ──
  const { POST: claimPOST } = await import('../../src/app/api/retail/claims/route');
  await fresh(async (d) => { await d.doc(`${T}/retailOrders/lost`).set(payer({ id: 'lost', stage: 'completed', completedAt: new Date().toISOString(), replacementOrderId: 'rp', lines: [{ lineId: 'L', productId: 'lamp', name: 'Lamp', unitPriceCents: 5000, qtyOrdered: 1, qtyScanned: 0, qtyShorted: 0, status: 'picked' }] })); });
  r = await claimPOST(req({ tenantId: 't1', orderId: 'lost', qrToken: 'qr1', type: 'missing', lineId: 'L', qty: 1 }));
  check('“something’s missing” on a parcel the shop already replaced points to the replacement, and nothing is approved', r.status === 409 && /replacement/.test(r.body.error) && !(await get(`${T}/retailOrders/lost`)).pendingRefundCents, r.body);

  // ── A return the team starts ──
  const RR = await import('../../src/lib/retail-returns');
  await fresh(async (d) => {
    await d.doc(`${T}/retailOrders/o9`).set(payer({ id: 'o9', stage: 'completed', lines: [{ lineId: 'G', productId: 'gel', name: 'Gel polish', unitPriceCents: 1400, qtyOrdered: 1, qtyScanned: 1, qtyShorted: 0, qtyReturned: 0, status: 'picked' }] }));
    await d.doc(`${T}/retailClaims/c9`).set({ id: 'c9', orderId: 'o9', lineId: 'G', qty: 1, type: 'damaged', status: 'in_review' });
  });
  const ro: any = await RR.openReturn(webFs, 't1', { ...(await get(`${T}/retailOrders/o9`)), id: 'o9' } as any, [{ lineId: 'G', qty: 1, reason: 'damaged_in_transit' } as any], 'refund' as any, '', staff);
  check('a return the team starts can’t take a polish the customer has reported: decide it in Claims', !ro.ok && /Claims/.test(ro.message), ro);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
