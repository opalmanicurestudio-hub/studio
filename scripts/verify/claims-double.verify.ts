// Checks that one item is refunded once, through a claim or a return (api/retail/claims, the claims desk, returns).
// A claim for an item is worth what was paid for it with its tax; an approved claim marks those units as settled
// (qtyClaimed), so they can't be claimed again or returned for a second refund; a claim can't be filed for units
// already returned or on their way back; and "it never arrived" is worth what hasn't already been refunded.
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
  check('a second claim for the same polish is turned away, with nothing queued', r.status === 409 && /already been returned or refunded/.test(r.body.error) && (await get(`${T}/retailOrders/o1`)).pendingRefundCents === 1512, r.body);

  r = await selfPOST(req({ action: 'start_return', tenantId: 't1', orderId: 'o1', qrToken: 'qr1', selections: [{ lineId: 'P', qty: 1, reason: 'changed_mind' }], resolution: 'refund' }));
  check('…and it can’t be returned for a second refund either', r.status === 400 && /Only 0 of Gel polish can still be returned/.test(r.body.error), r.body);

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

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
