// Checks what the kitchen, the counter, tabs, the front desk, services and the guest lounge use, taken from their own
// location (design board "Each location uses its own"; lib/store-stock storeFollowNested / storeStep / storeStepNested,
// lib/recipe-stock-server takeParts `at`, api/kitchen ticketPlace, api/tab, api/checkout/complete, lib/counter-server,
// lib/usage, lib/visit-handoff, api/guest-lounge).
// - With more than one location, what's made or used comes off the location it happened at, for an item counted
//   there: a ticket's own location, or its table's or visit's; a counter order's; the front desk sale's; a visit's.
//   What's given back (a void, a recall, a usage corrected down) goes back there. Not counted there: the total only.
// - The stock history names the location.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/made-here.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, isTenantOwner: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { void Promise.resolve().then(fn); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireStaff: async () => ({ actor }) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const at = (m: number) => new Date(Date.now() - m * 60000).toISOString();

(async () => {
  const S = await import('../../src/lib/store-stock');
  console.log('the rules');
  check('a change worked out as the new total, for a merged write: nested, only where counted', JSON.stringify(S.storeFollowNested({ totalStock: 20, stockAt: { main: 10 } }, 'main', 18)) === JSON.stringify({ stockAt: { main: 8 } }) && JSON.stringify(S.storeFollowNested({ totalStock: 20, stockAt: { harbor: 10 } }, 'main', 18)) === '{}');
  const inc = (n: number) => `inc(${n})`;
  check('an increment for a write that didn’t read the item in the same step: never more off than it had, only where counted', JSON.stringify(S.storeStep({ stockAt: { main: 2 } }, 'main', -5, inc)) === JSON.stringify({ 'stockAt.main': 'inc(-2)' })
    && JSON.stringify(S.storeStep({ stockAt: { main: 2 } }, 'main', 3, inc)) === JSON.stringify({ 'stockAt.main': 'inc(3)' }) && JSON.stringify(S.storeStep({ stockAt: { harbor: 2 } }, 'main', -1, inc)) === '{}' && JSON.stringify(S.storeStep({ stockAt: { main: 0 } }, 'main', -1, inc)) === '{}'
    && JSON.stringify(S.storeStepNested({ stockAt: { main: 2 } }, 'main', -1, inc)) === JSON.stringify({ stockAt: { main: 'inc(-1)' } }));

  const seed = async () => {
    db = strictTransactions(makeDb());
    await db.doc(T).set({ name: 'Linden', timezone: 'Etc/UTC' });
    await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true }); await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true });
    await db.doc(`${T}/inventory/buns`).set({ id: 'buns', type: 'professional', name: 'Buns', unit: 'units', costPerUnit: 0.5, totalStock: 20, stockAt: { main: 10, harbor: 10 }, batches: [] });
    await db.doc(`${T}/inventory/oil`).set({ id: 'oil', type: 'professional', name: 'Fry oil', unit: 'ml', costingMethod: 'size', size: 1000, totalStock: 4, partialContainerSize: 500, batches: [] });
    await db.doc(`${T}/inventory/burger`).set({ id: 'burger', type: 'refreshment', name: 'Burger', price: 14, status: 'active', isActive: true, formula: [{ id: 'buns', quantityUsed: 1 }, { id: 'oil', quantityUsed: 20 }] });
    await db.doc(`${T}/appointments/v1`).set({ id: 'v1', isTable: true, tableName: 'Table 4', locationId: 'harbor', partySize: 2, status: 'seated' });
  };

  console.log('the kitchen');
  await seed();
  const Kitchen = await import('../../src/app/api/kitchen/route');
  let r: any = await Kitchen.POST(req({ action: 'pair', tenantId: 't1', name: 'Grill' }));
  const key = r.body.key;
  await db.doc(`${T}/kdsTickets/k1`).set({ id: 'k1', source: 'tab', visitId: 'v1', menuItemId: 'burger', menuItemName: 'Burger', quantity: 2, status: 'pending', createdAt: at(10) });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k1', step: 'ready' }));
  let buns = await get(`${T}/inventory/buns`); const oil = await get(`${T}/inventory/oil`);
  check('a table’s dish made: its ingredients come off its table’s location (Harbor Rd) and the total', r.body.ok !== false && buns.totalStock === 18 && buns.stockAt.harbor === 8 && buns.stockAt.main === 10, [r.body, buns]);
  check('…one used by the dose (never counted at a store) only as before', oil.partialContainerSize === 460 && oil.stockAt === undefined, oil);
  const made = (await all(`${T}/stockCorrections`)).find((e: any) => e.productId === 'buns');
  check('…the history names the location', made?.storeId === 'harbor' && /^Made: Burger ×2/.test(made.reason), made);
  await db.doc(`${T}/kdsTickets/k2`).set({ id: 'k2', source: 'pos', locationId: 'main', menuItemId: 'burger', menuItemName: 'Burger', quantity: 1, status: 'pending', createdAt: at(9) });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k2', step: 'ready' }));
  buns = await get(`${T}/inventory/buns`);
  check('a ticket that says its own location: off that one (Main St)', buns.totalStock === 17 && buns.stockAt.main === 9 && buns.stockAt.harbor === 8, buns);
  await db.doc(`${T}/kdsTickets/k3`).set({ id: 'k3', source: 'event', menuItemId: 'burger', menuItemName: 'Burger', quantity: 1, status: 'pending', createdAt: at(8) });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k3', step: 'ready' }));
  buns = await get(`${T}/inventory/buns`);
  check('one that doesn’t say where: the total only', buns.totalStock === 16 && buns.stockAt.main === 9 && buns.stockAt.harbor === 8, buns);

  console.log('services');
  await seed();
  await db.doc(`${T}/inventory/gloves`).set({ id: 'gloves', type: 'professional', name: 'Gloves', unit: 'pairs', totalStock: 30, stockAt: { main: 20, harbor: 10 }, batches: [] });
  const U = await import('../../src/lib/usage');
  await U.recordVisitUsage(db, 't1', { id: 'a1', clientName: 'Mia', locationId: 'main' }, [{ productId: 'gloves', name: 'Gloves', unit: 'pairs', expected: 2 }]);
  let gl = await get(`${T}/inventory/gloves`);
  check('a visit’s products: off its location (Main St), and the location kept on its usage', gl.totalStock === 28 && gl.stockAt.main === 18 && gl.stockAt.harbor === 10 && (await get(`${T}/usage/a1`)).at === 'main', gl);
  await U.adjustVisitUsage(db, 't1', 'a1', { gloves: 3 });
  gl = await get(`${T}/inventory/gloves`);
  check('…corrected up later: the rest comes off the same location', gl.totalStock === 27 && gl.stockAt.main === 17, gl);
  await U.adjustVisitUsage(db, 't1', 'a1', { gloves: 1 });
  gl = await get(`${T}/inventory/gloves`);
  check('…corrected down: goes back there', gl.totalStock === 29 && gl.stockAt.main === 19, gl);
  check('…the history names the location', (await all(`${T}/stockCorrections`)).filter((e: any) => e.productId === 'gloves').every((e: any) => e.storeId === 'main'));

  console.log('the counter, tabs, the front desk, the hand-off and the lounge');
  const cs = src('src/lib/counter-server.ts');
  check('the counter: sent, off the order’s location, and what came off it kept item by item; the history names it', cs.includes('...tookAt(id, d.data, storeFollowNested(d.data, soldAt, mv.patch.totalStock))') && cs.includes('...tookAt(id, d.data, storeMoveNested(d.data, soldAt, { stock: -own }))')
    && cs.includes('...(soldAt && Object.keys(storeTaken).length ? { storeTaken: { at: soldAt, items: storeTaken } } : {})') && (cs.match(/storeId: soldAt/g) || []).length === 3);
  check('…voided: back to where it came off, no more than came off there; an order sent before that was kept gives nothing back to a location', cs.includes("const at = o.storeTaken && typeof o.storeTaken === 'object' ? String(o.storeTaken.at || '') || null : null;")
    && cs.includes('const n = Math.min(Math.max(0, Math.round(qty)), storeLeft[id] || 0); if (!at || n <= 0) return {}; storeLeft[id] -= n;') && (cs.match(/backAt\(/g) || []).length === 4 && (cs.match(/storeId: at \}/g) || []).length === 4);
  const tab = src('src/app/api/tab/route.ts');
  check('a tab: waste off its table’s location', (tab.match(/at: String\(k\?\.locationId \|\| cur\?\.locationId \|\| ''\) \|\| null/g) || []).length === 2);
  check('the front desk: what it made, off the sale’s location', src('src/app/api/checkout/complete/route.ts').includes("id: receiptRef.id }, at: saleLocation || null });"));
  const vh = src('src/lib/visit-handoff.ts');
  check('the hand-off: off the visit’s location, as increments never more than it had (a batch that didn’t read it in the same step)', vh.includes("const at = String(apt.locationId || '') || null;") && vh.includes('...storeStep(p, at, -q, (n) => FieldValue.increment(n))') && vh.includes('...storeStep(p, at, -1, (n) => FieldValue.increment(n))') && vh.includes('{ ...(at ? { at } : {}), visitId: aptId,'));
  const gl2 = src('src/app/api/guest-lounge/route.ts');
  check('the lounge: ordered, off the visit’s location, what came off kept on the order; recalled or cancelled, no more than that back there', gl2.includes('...storeStepNested(item, at, -qty, (n) => FieldValue.increment(n))') && gl2.includes('...(stockMoved && at && atTook > 0 ? { storeTaken: { at, qty: atTook } } : {}),')
    && gl2.includes('storeMoveNested((itG as any).data(), atG, { stock: Math.min(back, Math.max(0, Math.floor(num(r.storeTaken.qty)))) })') && src('src/app/api/kitchen/route.ts').includes('storeMoveNested(item, String(st.at), { stock: Math.min(qty, Math.max(0, Math.floor(num(st.qty)))) })'));
  const kr = src('src/app/api/kitchen/route.ts');
  check('the kitchen: a held batch’s portion off the ticket’s location, one thrown out off the kitchen’s own; a lounge order’s too', kr.includes('at: binAt });') && kr.includes("const binAt = action === 'holdToss' ? await hereFor(")
    && kr.includes('...(place ? storeFollowNested(p.data, place, m.patch.totalStock) : {})') && kr.includes('const place = several && (makes || stopsStarted || (lounge && step === \'deliver\')) ? await ticketPlace(tx, db, T, r) : null;') && kr.includes('const place = takes && severalHere ? await ticketPlace(tx, db, T, t) : null;'));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
