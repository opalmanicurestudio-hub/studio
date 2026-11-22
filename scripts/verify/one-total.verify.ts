// Checks "one count, one total" (design board of that name; lib/retail-fulfill convertSaleInTxn, lib/retail-orders
// shrinkStock, lib/stock-count recordCount and api/inventory/count, components/products/CountSheet, the product page).
// - An online order handed off or shipped takes what it sold off the total, as every other sale does: never worked out
//   again from the deliveries (a use or the kitchen that moved the total only stays taken; a product with no deliveries
//   recorded keeps its number). A short does the same.
// - With more than one location, a product already counted at a store is counted at a store: Count it asks which store
//   (starting on this screen's), and a whole count of it is refused on the server. Not counted at any store yet, or one
//   location: Count it counts the whole business, as before.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/one-total.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: true, isTenantOwner: false, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const afterJobs: Promise<any>[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };

(async () => {
  const seed = async (several: boolean) => {
    db = strictTransactions(makeDb());
    await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', retailSettings: {} });
    await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true });
    if (several) await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true });
    // A tester was logged (total 9) after a delivery of 10 (its batch still says 10).
    await db.doc(`${T}/inventory/oil`).set({ id: 'oil', type: 'retail', name: 'Lip oil', costPerUnit: 4, totalStock: 9, stockReserved: 1, batches: [{ id: 'b1', stock: 10, costPerUnit: 4, receivedDate: '2026-10-01T12:00:00Z' }], unit: 'units' });
    // Added with a number, no deliveries recorded.
    await db.doc(`${T}/inventory/cream`).set({ id: 'cream', type: 'retail', name: 'Hand cream', costPerUnit: 5, totalStock: 5, stockReserved: 1, batches: [], unit: 'units' });
    await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', orderNumber: 1301, stage: 'ready', method: 'pickup', customerName: 'Jordan Tate', qrToken: 'o1.tok', paidAt: '2026-11-21T15:00:00Z',
      lines: [{ lineId: 'A', productId: 'oil', sku: 'oil', name: 'Lip oil', unitPriceCents: 1800, qtyOrdered: 1, qtyShorted: 0 }, { lineId: 'B', productId: 'cream', sku: 'cream', name: 'Hand cream', unitPriceCents: 1200, qtyOrdered: 1, qtyShorted: 0 }],
      subtotalCents: 3000, taxCents: 0, totalCents: 3000 });
  };

  console.log('an online order takes what it sold off the total');
  await seed(false);
  const F = await import('../../src/app/api/retail/fulfil/route');
  const r: any = await F.POST(req({ tenantId: 't1', action: 'handoffNoScan', orderId: 'o1' })); await settle();
  const oil = await get(`${T}/inventory/oil`); const cream = await get(`${T}/inventory/cream`);
  check('handed off: the order went', r.body?.ok === true, r.body);
  check('a use logged before it stays taken (9 less 1 is 8, not 10 less 1 from the delivery)', oil.totalStock === 8 && oil.batches[0].stock === 9 && oil.stockReserved === 0, oil);
  check('a product with no deliveries recorded keeps its number (5 less 1, never none)', cream.totalStock === 4 && cream.stockReserved === 0, cream);
  await seed(true);
  await db.doc(`${T}/inventory/oil`).set({ stockReserved: 3, stockAt: { main: 6, harbor: 3 }, heldAt: { main: 3 } }, { merge: true });
  await db.doc(`${T}/retailOrders/o1`).set({ locationId: 'main', lines: [{ lineId: 'A', productId: 'oil', sku: 'oil', name: 'Lip oil', unitPriceCents: 1800, qtyOrdered: 1, qtyShorted: 0 }, { lineId: 'C', productId: 'oil', sku: 'oil', name: 'Lip oil (gift)', unitPriceCents: 1800, qtyOrdered: 2, qtyShorted: 0 }] }, { merge: true });
  const r2: any = await F.POST(req({ tenantId: 't1', action: 'handoffNoScan', orderId: 'o1' })); await settle();
  const oil2 = await get(`${T}/inventory/oil`);
  check('one product on two lines: both come off (total, batches, hold and the store’s number), not just the last', r2.body?.ok === true && oil2.totalStock === 6 && oil2.batches[0].stock === 7 && oil2.stockReserved === 0 && oil2.stockAt.main === 3 && oil2.heldAt.main === 0 && oil2.stockAt.harbor === 3, [r2.body, oil2]);
  const RO = await import('../../src/lib/retail-orders');
  const sh = RO.shrinkStock({ totalStock: 9, batches: [{ id: 'b1', stock: 10, costPerUnit: 4, receivedDate: '2026-10-01' } as any] }, 2);
  check('a short takes what was missing off the total, and out of the batches', sh.totalStock === 7 && sh.batches?.[0].stock === 8 && RO.shrinkStock({ totalStock: 3 }, 5).totalStock === 0 && RO.shrinkStock({ totalStock: 4, batches: [] }, 1).totalStock === 3);
  const rf = src('src/lib/retail-fulfill.ts');
  check('…nowhere is the total worked out again from the batches', !/totalStock: batches\.reduce|const newTotal = batches\.reduce/.test(rf + src('src/lib/retail-orders.ts')) && rf.includes('const newTotal = Math.max(0, Math.floor(Number(item.totalStock) || 0) - qty);'));

  console.log('Count it, at a store');
  await seed(true);
  await db.doc(`${T}/inventory/oil`).set({ stockAt: { main: 5, harbor: 4 } }, { merge: true });
  const C = await import('../../src/app/api/inventory/count/route');
  let c: any = await C.POST(req({ tenantId: 't1', productId: 'oil', counted: 3 }));
  check('a whole count of a product counted at each store: refused, nothing changes', c.status === 409 && /counted at each store\. Pick the store you counted at/.test(c.body.error) && (await get(`${T}/inventory/oil`)).totalStock === 9);
  c = await C.POST(req({ tenantId: 't1', productId: 'cream', counted: 6 }));
  check('not counted at any store yet: counted as a whole, as before', c.body.ok && (await get(`${T}/inventory/cream`)).totalStock === 6);
  await seed(false);
  await db.doc(`${T}/inventory/oil`).set({ stockAt: { main: 5 } }, { merge: true });
  c = await C.POST(req({ tenantId: 't1', productId: 'oil', counted: 7 }));
  check('one location (an old store number left behind): counted as a whole, as before', c.body.ok && (await get(`${T}/inventory/oil`)).totalStock === 7);
  const SS = await import('../../src/lib/store-stock-server');
  const HS = await import('../../src/lib/here-server');
  await seed(true); HS.forgetLocations('t1');
  await db.doc(`${T}/inventory/oil`).set({ stockAt: { main: 5, harbor: 4 } }, { merge: true });
  const sc = await SS.countAtStore(db, 't1', 'oil', 'harbor', 3, { id: 'k1', name: 'Kai Park' });
  check('Count it at a store goes the same way as At each store’s count', sc.ok && (await get(`${T}/inventory/oil`)).stockAt.harbor === 3);

  const cs = src('src/components/products/CountSheet.tsx');
  check('the sheet: “Counted at” for a product counted at a store (more than one location, not by the dose), starting on this screen’s', cs.includes("const view = stores.length > 1 && !dose ? storeView(product, stores) : null;") && cs.includes('const perStore = !!view?.tracked;')
    && cs.includes('label="Counted at" hint="Pick the store you counted at."') && cs.includes('const [at, setAt] = useCameTo(perStore ? stores : []);'));
  check('…starts on that store’s number, compares with it, and saves it at that store', cs.includes("setN(here && here.count !== null ? String(here.count) : '')") && cs.includes('const base = perStore ? (here?.count ?? 0) : was;') && cs.includes('await countAtStoreOf(tenantId, String(product.id), here.id, counted);')
    && cs.includes('`The record says ${here.count} at ${here.name}.`') && cs.includes('Not counted at ${here.name} yet: what you count comes from “Not at a store yet”'));
  check('…the message says which store', cs.includes('`Counted at ${here.name} for the first time. It’s on the history.`') && cs.includes('than the record at ${here.name}. It’s on the history.`'));
  const pp = src('src/app/(app)/inventory/(detail)/product/[id]/page.tsx');
  check('the product page: At each store reads its numbers again after a count', pp.includes('<StoreStockPanel key={storeSeen}') && pp.includes('onCounted={(d, changed, note) => (setStoreSeen((k) => k + 1), toast(') && pp.includes(': note ? note : d === 0'));
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(cs));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
