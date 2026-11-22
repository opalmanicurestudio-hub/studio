// Checks ordering for one store (design board "Running low at each store", parts 3 and 4; lib/ordering-store, api/ordering
// plan, order and par with `at`; the page at /inventory/ordering).
// - With more than one location, Ordering works out what one store needs: its own shelf (less what paid orders hold
//   there), its own pace (what went there; what went without a store shared evenly between the stores that have it),
//   a set number kept there, and what's on its way to it. Orders for every store together are said, not taken off.
// - Another store with more than it needs is said, with a move; what isn't counted at the store yet is listed apart.
// - An order for a store says so (and in the text the supplier gets), and it's put away there unless it came to another.
// - Front desk and online sales keep their store on the stock history, so each store's pace is its own.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ordering-store.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

const GLOW = 'Glow Supply Co.';
const OIL = { name: 'Lip oil, Rose', type: 'retail', costPerUnit: 10, totalStock: 20, stockAt: { main: 16, harbor: 4 }, reorderAt: { harbor: 6 }, container: 'box', supplier: GLOW, batches: [] };
const BALM = { name: 'Shea balm', type: 'retail', costPerUnit: 8, totalStock: 6, stockAt: { main: 5, harbor: 1 }, parAt: { harbor: 3 }, parLevel: 10, container: 'case', supplier: GLOW, batches: [] };
const TEA = { name: 'Rooibos tin', type: 'retail', costPerUnit: 5, totalStock: 6, stockAt: { main: 6 }, supplier: GLOW, batches: [] };
const SOAP = { name: 'Oat soap', type: 'retail', costPerUnit: 3, totalStock: 9, supplier: GLOW, batches: [] };

(async () => {
  const S = await import('../../src/lib/ordering-store');
  const O = await import('../../src/lib/ordering');
  const HS = await import('../../src/lib/here-server');
  const { POST } = await import('../../src/app/api/ordering/route');
  const stores = [{ id: 'main', name: 'Main St' }, { id: 'harbor', name: 'Harbor Rd' }];

  console.log('the rules');
  const since = ago(14);
  const moves = [
    { productId: 'oil', type: 'sold', change: -14, date: ago(5), storeId: 'harbor' }, { productId: 'oil', type: 'sold', change: -14, date: ago(6), storeId: 'main' },
    { productId: 'oil', type: 'sold', change: -14, date: ago(7) }, { productId: 'oil', type: 'received', change: 30, date: ago(3), storeId: 'harbor' },
  ];
  const r = S.storeRates(moves, since, 14);
  check('each store’s own pace, and what went without a store shared between the stores that have it', S.perDayAt(r, 'oil', 'harbor', 2).perDay === 1.5 && S.perDayAt(r, 'oil', 'harbor', 2).shared === true && S.perDayAt(r, 'oil', 'main', 1).perDay === 2);
  check('its own shelf, less what paid orders hold there', S.onHandAt({ ...OIL, heldAt: { harbor: 1 }, stockReserved: 1 }, 'harbor') === 3 && S.onHandAt(OIL, 'nowhere') === 0);
  check('what another store can spare: past what it goes through, never under its number to order more at', S.spareAt(OIL, 'main', 1.5, 7) === 5 && S.spareAt({ ...OIL, reorderAt: { main: 14 } }, 'main', 1.5, 7) === 2);
  const s = S.suggestAt('oil', OIL, stores[1], stores, r, 2, 3, 7);
  check('for Harbor Rd: enough for its pace, less its shelf and what’s on its way to it', s.suggest === 5 && s.spare?.storeId === 'main' && s.spare.qty === 5
    && s.why === 'About 1.5 a day here, 4 left, 2 on its way here. 3 more on an order for every store. Main St has 5 more than it needs.', s);
  const b = S.suggestAt('balm', BALM, stores[1], stores, r, 0, 0, 7);
  check('a set number kept there (not the business’s own), and a store that uses none of it can spare all it has', b.suggest === 2 && b.why === 'You keep 3 here, 1 left. Main St has 5 more than it needs.' && b.spare?.qty === 5, b);
  check('the text the supplier gets says where it goes', O.orderText('Northside', { id: 'abc123', number: '4F2A1C', items: [{ productId: 'oil', productName: 'Lip oil, Rose', quantity: 5, costPerUnit: 10, container: 'box' }], storeName: 'Harbor Rd' }, 'Tue, Nov 24') === 'Northside order #4F2A1C for Tue, Nov 24, to Harbor Rd:\n5 × Lip oil, Rose (box)');

  console.log('the plan for one store');
  await db.doc(T).set({ name: 'Northside' });
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true }); await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true }); HS.forgetLocations('t1');
  for (const [id, x] of Object.entries({ oil: OIL, balm: BALM, tea: TEA, soap: SOAP })) await db.doc(`${T}/inventory/${id}`).set({ id, ...x });
  let k = 0; for (const m of [...moves, { productId: 'oil', type: 'sold', change: -7, date: ago(2), storeId: 'room4' }]) await db.doc(`${T}/stockCorrections/mv${k++}`).set(m);
  await db.doc(`${T}/orders/o1`).set({ supplier: GLOW, orderDate: ago(1), status: 'Placed', storeId: 'harbor', storeName: 'Harbor Rd', items: [{ productId: 'oil', productName: 'Lip oil, Rose', quantity: 2, costPerUnit: 10, receivedQuantity: 0 }] });
  await db.doc(`${T}/orders/o2`).set({ supplier: GLOW, orderDate: ago(1), status: 'Placed', items: [{ productId: 'oil', productName: 'Lip oil, Rose', quantity: 3, costPerUnit: 10, receivedQuantity: 0 }] });
  let res: any = await POST(req({ tenantId: 't1', action: 'plan', at: 'harbor' }));
  const lines = res.body.plan?.[0]?.lines || []; const oil = lines.find((l: any) => l.id === 'oil'); const balm = lines.find((l: any) => l.id === 'balm');
  check('Harbor Rd’s own: its pace (a sale at a place that isn’t a store shared), its shelf, what’s on its way to it', res.body.ok && res.body.at === 'harbor' && res.body.atName === 'Harbor Rd' && res.body.shared === true
    && oil?.perDay === 1.75 && oil?.suggest === 7 && oil?.why === 'About 1.8 a day here, 4 left, 2 on its way here. 3 more on an order for every store. Main St has 3 more than it needs.' && oil?.spare?.qty === 3, oil);
  check('…its own set number', balm?.suggest === 2 && balm?.why.startsWith('You keep 3 here, 1 left.'), balm);
  check('…and what isn’t counted there yet, apart', res.body.notHere.map((x: any) => x.name).join() === 'Oat soap,Rooibos tin' && !lines.some((l: any) => l.id === 'tea' || l.id === 'soap'));
  res = await POST(req({ tenantId: 't1', action: 'plan' }));
  const all = res.body.plan[0].lines.find((l: any) => l.id === 'oil');
  check('every store together, as before: everything on its way, the business’s own set number', res.body.ok && !res.body.at && all.onOrder === 5 && res.body.plan[0].lines.find((l: any) => l.id === 'balm').why.startsWith('You keep 10 on hand') && res.body.stores.length === 2, all);
  await db.doc(`${T}/orders/o3`).set({ supplier: GLOW, orderDate: ago(1), status: 'Placed', storeId: 'old', storeName: 'Old Pier', items: [{ productId: 'oil', productName: 'Lip oil, Rose', quantity: 1, costPerUnit: 10, receivedQuantity: 0 }] });
  res = await POST(req({ tenantId: 't1', action: 'plan', at: 'harbor' }));
  check('an order for a store that isn’t a location any more: counted as for every store, never lost', /^About 1\.8 a day here, 4 left, 2 on its way here\. 4 more on an order for every store\./.test(res.body.plan[0].lines.find((l: any) => l.id === 'oil').why));
  await db.doc(`${T}/orders/o3`).delete();
  res = await POST(req({ tenantId: 't1', action: 'plan', at: 'mill' }));
  check('a store that isn’t one: refused, with what to do', res.status === 409 && /order for every store/.test(res.body.error));

  console.log('a set number, and an order, for one store');
  res = await POST(req({ tenantId: 't1', action: 'par', itemId: 'balm', par: 4, at: 'harbor' }));
  let x = await get(`${T}/inventory/balm`);
  check('kept at that store, the business’s own number left as it was', res.body.ok && x.parAt.harbor === 4 && x.parLevel === 10);
  await POST(req({ tenantId: 't1', action: 'par', itemId: 'balm', par: null, at: 'harbor' }));
  x = await get(`${T}/inventory/balm`);
  check('…and taken off again', !('harbor' in (x.parAt || {})) && x.parLevel === 10 && (await POST(req({ tenantId: 't1', action: 'par', itemId: 'balm', par: 2, at: 'mill' }))).status === 409);
  res = await POST(req({ tenantId: 't1', action: 'order', supplier: GLOW, lines: [{ itemId: 'oil', qty: 5 }], at: 'harbor' }));
  check('an order for Harbor Rd says so', res.body.ok && res.body.order.storeId === 'harbor' && res.body.order.storeName === 'Harbor Rd' && (await get(`${T}/orders/${res.body.order.id}`)).storeId === 'harbor');
  check('…a store that isn’t one: refused', (await POST(req({ tenantId: 't1', action: 'order', supplier: GLOW, lines: [{ itemId: 'oil', qty: 5 }], at: 'mill' }))).status === 409);
  res = await POST(req({ tenantId: 't1', action: 'plan', at: 'harbor' }));
  check('…and it’s on its way to Harbor Rd now', res.body.plan[0].lines.find((l: any) => l.id === 'oil').onOrder === 7);

  console.log('the screens, and sales by store');
  const page = src('src/app/(app)/inventory/ordering/page.tsx');
  check('the page: order for every store or one, opened from ?at=', page.includes("'Every store'") && page.includes('Order for') && page.includes("get('at')") && page.includes('Ordering for ${forName}') && page.includes('Order for ${forName}'));
  check('…a move from the store with spare, what isn’t counted there, and the delivery put away where it went', page.includes('`Move ${n} from ${sp2.name}`') && page.includes('Not counted at {forName} yet') && page.includes('It came to another store') && page.includes('cameFor(o)'));
  check('front desk and online sales keep their store on the stock history', /type: 'sold', field: 'totalStock', \.\.\.\(saleLocation \? \{ storeId: saleLocation \} : \{\}\)/.test(src('src/app/api/checkout/complete/route.ts'))
    && /Online order fulfilled[\s\S]{0,200}type: 'sold', \.\.\.\(typeof \(order as any\)\.locationId === 'string'/.test(src('src/lib/retail-fulfill.ts')));
  const mine = page + src('src/lib/ordering-store.ts');
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(mine) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b|[Ss]tudio/.test(src('src/lib/ordering-store.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
