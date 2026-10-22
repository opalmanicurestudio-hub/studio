// Checks returns that never come back and returns that come back opened. A return can be closed by the team while
// nothing on it is checked in, and the nightly check closes one never sent after the shop's limit (never one the
// carrier has, or one already being checked in); the customer is told on their order page. A return label that couldn't
// be made is written on the return, so Problems can send it again, and cleared once it's made. Something that comes
// back opened is written off at cost by default, or goes back on the shelf when the shop says so.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/returns-close.verify.ts
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
let shippoOk = false;
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase/firestore') return web;
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-retail-returnlabel' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: {} };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null };
  if (request === '@/lib/retail-secrets') return { shippoKeyFor: async () => 'shippo_key' };
  if (request === '@/lib/email-shell') return { brandedEmail: (_b: any, html: string) => html, emailButton: (link: string) => `<a href="${link}">`, getEmailBrand: async () => ({ shopName: 'Opal' }) };
  if (request.endsWith('staff-fetch')) return { staffAuthHeader: async () => ({}) };
  if (request.endsWith('renter-credit-client')) return { syncRenterCredits: () => undefined };
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async (url: any) => {
  const u = String(url);
  if (u.includes('goshippo.com/shipments')) return shippoOk ? { ok: true, json: async () => ({ rates: [{ object_id: 'rate1', provider: 'USPS', servicelevel: { name: 'Ground' }, amount: '6.50' }] }) } : { ok: false, json: async () => ({ detail: 'The customer’s address could not be verified' }) };
  if (u.includes('goshippo.com/transactions')) return { ok: true, json: async () => ({ status: 'SUCCESS', label_url: 'https://labels.example/l1.pdf', tracking_number: '9400TRACK' }) };
  return { ok: true, json: async () => ({}) };
};
process.env.NEXT_PUBLIC_APP_URL = 'https://shop.example'; process.env.RESEND_API_KEY = 'rk'; process.env.NOTIFY_FROM_EMAIL = 'shop@example.com';

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const ago = (days: number) => new Date(Date.now() - days * 86400e3).toISOString();
const GEL = { lineId: 'R1', productId: 'gel', name: 'Gel polish', unitPriceCents: 1400, qtyOrdered: 2, qtyScanned: 2, qtyShorted: 0, qtyReturned: 0, status: 'picked' };
const order = (x: any = {}) => ({ id: 'o1', tenantId: 't1', orderNumber: 1110, stage: 'completed', method: 'ship', lines: [GEL], shippingAddress: { name: 'Dana', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' }, qrToken: 'qr1', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', ...x });
const ret = (id: string, x: any = {}) => ({ id, tenantId: 't1', orderId: 'o1', orderNumber: 1110, status: 'open', resolution: 'refund', openedAt: ago(2), lines: [{ lineId: 'R1', name: 'Gel polish', qty: 1, reason: 'changed_mind' }], ...x });

(async () => {
  const RC = await import('../../src/lib/return-close');
  const RR = await import('../../src/lib/retail-returns');
  const fresh = async (setup: (d: any) => Promise<void> = async () => {}, tenant: any = {}) => {
    db = makeDb();
    await db.doc(T).set({ name: 'Opal', retailSettings: { shipFrom: { name: 'Opal', street1: '9 Shop St', city: 'Austin', state: 'TX', zip: '78702' }, ...tenant } });
    await db.doc(`${T}/inventory/gel`).set({ name: 'Gel polish', totalStock: 3, stockReserved: 0, costPerUnit: 4, batches: [{ id: 'b0', stock: 3, costPerUnit: 4 }] });
    await db.doc(`${T}/retailOrders/o1`).set(order());
    await setup(db);
  };

  // ── Closing ──
  await fresh(async (d) => { await d.doc(`${T}/retailReturns/r1`).set(ret('r1')); });
  let r = await RC.closeReturn(db, 't1', 'r1', { by: { id: 'm1', name: 'Rae Moss' }, why: 'team', note: 'You told us you’re keeping it.' });
  let rt = await get(`${T}/retailReturns/r1`);
  const ev = (await all(`${T}/retailOrders/o1/events`)).find((e: any) => e.meta?.kind === 'return_closed');
  const msg = (await all(`${T}/retailOrders/o1/inbox`)).find((x: any) => /closed the return/.test(String(x.body || '')));
  check('the team closes a return that isn’t coming: closed, with their note, in the order’s history, and Dana is told on her order page',
    r.ok && rt.status === 'cancelled' && rt.closedBy === 'Rae Moss' && /keeping it/.test(rt.closedNote) && !!ev && !!msg && /reply here/.test(msg.body), { r, rt, ev, msg });
  const { reservedByOpenReturns } = await import('../../src/lib/return-reserve');
  check('…and its polish can be returned again', reservedByOpenReturns([rt], 'R1') === 0 && reservedByOpenReturns([ret('x')], 'R1') === 1);
  r = await RC.closeReturn(db, 't1', 'r1', { by: { id: 'm1', name: 'Rae' }, why: 'team' });
  check('…closing it again says it’s already closed', !r.ok && /already closed/.test(r.message));

  await fresh(async (d) => { await d.doc(`${T}/retailReturns/r2`).set(ret('r2', { status: 'received', lines: [{ lineId: 'R1', name: 'Gel polish', qty: 1, reason: 'changed_mind', disposition: 'restock' }] })); });
  r = await RC.closeReturn(db, 't1', 'r2', { by: { id: 'm1', name: 'Rae' }, why: 'team' });
  check('a return already being checked in can’t be closed: finish it instead', !r.ok && /checked in already/.test(r.message) && (await get(`${T}/retailReturns/r2`)).status === 'received');

  await fresh(async (d) => {
    await d.doc(`${T}/retailReturns/old`).set(ret('old', { openedAt: ago(31) }));
    await d.doc(`${T}/retailReturns/moving`).set(ret('moving', { openedAt: ago(40), labelTrackingStatus: 'TRANSIT' }));
    await d.doc(`${T}/retailReturns/recent`).set(ret('recent', { openedAt: ago(10) }));
    await d.doc(`${T}/retailReturns/late`).set(ret('late', { openedAt: ago(45), labelPurchasedAt: ago(20) }));
  });
  let n = await RC.closeStaleReturns(db, 't1', await get(T));
  check('the nightly check closes a return never sent 31 days on, and leaves one the carrier has, a recent one, and one whose label is newer',
    n === 1 && (await get(`${T}/retailReturns/old`)).status === 'cancelled' && (await get(`${T}/retailReturns/moving`)).status === 'open' && (await get(`${T}/retailReturns/recent`)).status === 'open' && (await get(`${T}/retailReturns/late`)).status === 'open',
    { n, s: (await all(`${T}/retailReturns`)).map((x: any) => [x.id, x.status]) });
  const nightlyMsg = (await all(`${T}/retailOrders/o1/inbox`)).find((x: any) => /hasn’t been sent back 30 days/.test(String(x.body || '')));
  check('…and says why on the order page', !!nightlyMsg, await all(`${T}/retailOrders/o1/inbox`));
  await fresh(async (d) => { await d.doc(`${T}/retailReturns/old`).set(ret('old', { openedAt: ago(60) })); }, { policies: { returnCloseAfterDays: 0 } });
  check('a shop that set 0 never has returns closed for it', (await RC.closeStaleReturns(db, 't1', await get(T))) === 0 && (await get(`${T}/retailReturns/old`)).status === 'open');

  // ── A return label that couldn't be made ──
  const { POST: labelPOST } = await import('../../src/app/api/retail/return-label/route');
  const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.example' } }) as any;
  await fresh(async (d) => { await d.doc(`${T}/retailReturns/r3`).set(ret('r3')); });
  shippoOk = false;
  let lr: any = await labelPOST(req({ tenantId: 't1', orderId: 'o1', returnId: 'r3', qrToken: 'qr1' }));
  rt = await get(`${T}/retailReturns/r3`);
  check('the carrier can’t make the label: it’s written on the return and in the order’s history, so the team sees it',
    lr.status >= 400 && /could not be verified/.test(rt.labelError?.message || '') && (await all(`${T}/retailOrders/o1/events`)).some((e: any) => e.meta?.kind === 'return_label_failed'), { lr: lr.body, rt });
  shippoOk = true;
  lr = await labelPOST(req({ tenantId: 't1', orderId: 'o1', returnId: 'r3', qrToken: 'qr1' }));
  rt = await get(`${T}/retailReturns/r3`);
  check('…sent again from Problems: the label is made and the error cleared', lr.status === 200 && rt.labelUrl === 'https://labels.example/l1.pdf' && rt.labelError === null, { lr: lr.body, rt });
  lr = await labelPOST(req({ tenantId: 't1', orderId: 'o1', returnId: 'r3', qrToken: 'wrong' }));
  check('…and someone without the order’s link can’t ask for one', lr.status === 403);

  // ── Opened returns ──
  await fresh(async (d) => { await d.doc(`${T}/retailReturns/r4`).set(ret('r4', { status: 'open' })); });
  let rec = await RR.receiveReturnLine(webFs, 't1', { id: 'r4' } as any, 'R1', 'open_box' as any, { id: 'u1', name: 'Rae' });
  const books = await all(`${T}/transactions`); const exc = await all(`${T}/inventoryExceptions`);
  check('it came back opened: written off at cost by default, in the books and the losses, and the shelf count stays as it was',
    rec.ok && /written off at cost/.test(rec.message) && books.length === 1 && books[0].category === 'Spoilage' && books[0].amount === 4 && exc.length === 1 && exc[0].reason === 'return_opened' && (await get(`${T}/inventory/gel`)).totalStock === 3, { rec, books, exc });
  await fresh(async (d) => { await d.doc(`${T}/retailReturns/r5`).set(ret('r5', { status: 'open' })); }, { policies: { openedReturns: 'restock' } });
  rec = await RR.receiveReturnLine(webFs, 't1', { id: 'r5' } as any, 'R1', 'open_box' as any, { id: 'u1', name: 'Rae' });
  check('…or back on the shelf when that’s the shop’s policy, with nothing written off', rec.ok && /back on the shelf/.test(rec.message) && (await get(`${T}/inventory/gel`)).totalStock === 4 && (await all(`${T}/transactions`)).length === 0, { rec, inv: await get(`${T}/inventory/gel`) });

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
