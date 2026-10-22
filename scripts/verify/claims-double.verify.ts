// Checks that one item is refunded once, through a claim or a return (api/retail/claims, the claims desk, returns).
// A claim for an item is worth what was paid for it with its tax; an approved claim marks those units as settled
// (qtyClaimed), so they can't be claimed again or returned for a second refund; a claim can't be filed for units
// already returned or on their way back; and "it never arrived" is worth what hasn't already been refunded. When what's
// already reported or coming back can't be read, no return is offered or started.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/claims-double.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-retail-claims' }, { name: 'admin-retail-selfserve' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: {} };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/request-forensics') return { requestForensics: () => null };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null };
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.example' } }) as any;
// One polish at $14 and two files at $5; 8% tax ($1.92 on $24). Packed with the polish never scanned in.
const order = (x: any = {}) => ({ id: 'o1', tenantId: 't1', orderNumber: 1120, stage: 'completed', completedAt: new Date().toISOString(), method: 'ship',
  lines: [{ lineId: 'P', productId: 'gel', name: 'Gel polish', unitPriceCents: 1400, qtyOrdered: 1, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'picked' },
    { lineId: 'F', productId: 'file', name: 'Nail file', unitPriceCents: 500, qtyOrdered: 2, qtyScanned: 2, qtyShorted: 0, qtyReturned: 0, status: 'picked' }],
  subtotalCents: 2400, taxCents: 192, shippingCents: 0, totalCents: 2592, chargedCents: 2592, refundedCents: 0, qrToken: 'qr1', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', ...x });

(async () => {
  const { POST: claimPOST } = await import('../../src/app/api/retail/claims/route');
  const { POST: selfPOST } = await import('../../src/app/api/retail/self-serve/route');
  const fresh = async (x: any = {}, rs: any = { claimAutoResolveMaxCents: 5000 }) => {
    db = makeDb();
    await db.doc(T).set({ name: 'Opal', retailSettings: { returnsEnabled: true, ...rs } });
    await db.doc(`${T}/retailOrders/o1`).set(order(x));
  };
  const claim = (body: any) => claimPOST(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', ...body })) as any;

  await fresh();
  let r = await claim({ type: 'missing', lineId: 'P', qty: 1 });
  let o = await get(`${T}/retailOrders/o1`);
  const c = await get(`${T}/retailClaims/o1__missing__P`);
  check('a missing $14 polish is worth what she paid for it with its tax: $15.12 (it was $14)', c?.claimValueCents === 1512 && r.body.status === 'auto_resolved' && o.pendingRefundCents === 1512, { c, r: r.body });
  check('…and the approval marks the polish as settled on her order', o.lines[0].qtyClaimed === 1, o.lines[0]);

  r = await claim({ type: 'damaged', lineId: 'P', qty: 1, description: 'The bottle arrived cracked open' });
  check('a second claim for the same polish is turned away, with nothing queued', r.status === 409 && /already been reported, returned or refunded/.test(r.body.error) && (await get(`${T}/retailOrders/o1`)).pendingRefundCents === 1512, r.body);

  r = await selfPOST(req({ action: 'start_return', tenantId: 't1', orderId: 'o1', qrToken: 'qr1', selections: [{ lineId: 'P', qty: 1, reason: 'changed_mind' }], resolution: 'refund' }));
  check('…and it can’t be returned for a second refund either', r.status === 400 && /Only 0 of Gel polish can still be returned/.test(r.body.error), r.body);

  // ── A report still waiting for a decision, and one approved before approvals marked the order ──
  await fresh({}, { claimAutoResolveMaxCents: 0 });
  r = await claim({ type: 'damaged', lineId: 'P', qty: 1, description: 'The bottle arrived cracked open' });
  check('with no automatic approval, the report waits for the shop', r.status === 200 && r.body.status === 'in_review', r.body);
  r = await selfPOST(req({ action: 'start_return', tenantId: 't1', orderId: 'o1', qrToken: 'qr1', selections: [{ lineId: 'P', qty: 1, reason: 'changed_mind' }], resolution: 'refund' }));
  check('…while it waits, the same polish can’t also be returned for a refund, and she’s told why', r.status === 400 && /problem you reported/.test(r.body.error), r.body);
  r = await selfPOST(req({ action: 'start_return', tenantId: 't1', orderId: 'o1', qrToken: 'qr1', selections: [{ lineId: 'F', qty: 2, reason: 'changed_mind' }], resolution: 'refund' }));
  check('…the files she didn’t report can still be returned', r.status === 200 && r.body.ok, r.body);
  r = await claim({ type: 'missing', lineId: 'P', qty: 1 });
  check('…and the same polish can’t be reported a second way while the first report waits', r.status === 409 && /already been reported/.test(r.body.error), r.body);
  await fresh();
  await db.doc(`${T}/retailClaims/old`).set({ id: 'old', orderId: 'o1', lineId: 'P', qty: 1, type: 'missing', status: 'resolved', resolution: 'refund' });
  r = await selfPOST(req({ action: 'start_return', tenantId: 't1', orderId: 'o1', qrToken: 'qr1', selections: [{ lineId: 'P', qty: 1, reason: 'changed_mind' }], resolution: 'refund' }));
  check('a report approved before the order kept count still keeps that polish from a second refund', r.status === 400, r.body);
  await fresh();
  await db.doc(`${T}/retailClaims/nr`).set({ id: 'nr', orderId: 'o1', lineId: null, type: 'not_received', status: 'in_review' });
  r = await selfPOST(req({ action: 'start_return', tenantId: 't1', orderId: 'o1', qrToken: 'qr1', selections: [{ lineId: 'F', qty: 1, reason: 'changed_mind' }], resolution: 'refund' }));
  check('“it never arrived” waiting for a decision covers everything on the order', r.status === 400, r.body);

  // ── Units already on their way back ──
  await fresh();
  await db.doc(`${T}/retailReturns/ret1`).set({ id: 'ret1', orderId: 'o1', status: 'open', lines: [{ lineId: 'F', name: 'Nail file', qty: 2, reason: 'changed_mind' }] });
  r = await claim({ type: 'damaged', lineId: 'F', qty: 2, description: 'Both files snapped in the box' });
  check('a claim for files already on their way back in a return is turned away', r.status === 409, r.body);
  await db.doc(`${T}/retailReturns/ret1`).set({ lines: [{ lineId: 'F', name: 'Nail file', qty: 1, reason: 'changed_mind' }] }, { merge: true });
  r = await claim({ type: 'damaged', lineId: 'F', qty: 2, description: 'Both files snapped in the box' });
  const cf = await get(`${T}/retailClaims/o1__damaged__F`);
  check('…with one of the two on its way back, the claim covers the other one: $5.40', r.status === 200 && cf?.qty === 1 && cf?.claimValueCents === 540, { r: r.body, cf });

  // ── It never arrived ──
  await fresh({ refundedCents: 500, pendingRefundCents: 300 });
  r = await claim({ type: 'not_received' });
  const cn = await get(`${T}/retailClaims/o1__not_received__order`);
  check('“it never arrived” is worth what hasn’t been refunded or queued already: $17.92 of the $25.92', r.status === 200 && cn?.claimValueCents === 1792, { r: r.body, cn });

  // ── What's already reported can't be read: nothing is started ──
  await fresh();
  const real = db;
  const claimsDown = (d: any) => new Proxy(d, { get: (t: any, prop: any) => (prop === 'collection'
    ? (path: string) => (/retailClaims$/.test(path) ? { where: () => ({ limit: () => ({ get: async () => { throw new Error('unavailable'); } }) }) } : t.collection(path))
    : t[prop]) });
  db = claimsDown(real);
  r = await selfPOST(req({ action: 'start_return', tenantId: 't1', orderId: 'o1', qrToken: 'qr1', selections: [{ lineId: 'F', qty: 1, reason: 'changed_mind' }], resolution: 'refund' }));
  check('the problems she reported can’t be read just now: no return is started, and she’s asked to try again', r.status === 503 && /try again/.test(r.body.error) && (await real.collection(`${T}/retailReturns`).get()).size === 0, r.body);
  db = real;
  await db.doc(`${T}/retailOrders/o1`).set({ gift: { token: 'gt1', to: 'Sam' } }, { merge: true });
  const { GET: giftGET } = await import('../../src/app/api/retail/gift/route');
  const giftReq = { nextUrl: { searchParams: new URLSearchParams({ tenantId: 't1', orderId: 'o1', g: 'gt1' }) }, headers: { get: () => null } } as any;
  let g: any = await giftGET(giftReq);
  check('a gift’s exchange page lists what can be sent back', g.status === 200 && Array.isArray(g.body.items) && g.body.items.length > 0, g.body);
  db = claimsDown(real);
  g = await giftGET(giftReq);
  check('…but when the problems reported on it can’t be read, nothing is offered, and they’re asked to try again', g.status === 503 && /try again/.test(g.body.error), g.body);
  db = real;

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
