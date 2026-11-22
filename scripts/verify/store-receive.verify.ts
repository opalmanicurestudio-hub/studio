// Checks receiving at a store, and each variant at each store (design board "Receiving at a store, and each variant at
// each store"; lib/store-stock receivedTo and storeMoveNested, components/inventory/ReceiveAtStore, QuickReceiveDialog,
// ReceiveStockDialog and the Inventory page, api/ordering and the Ordering page, lib/variants shopOptionGroups, the shop).
// - With more than one location, every way of receiving asks which store it came to, starting on the one the screen is
//   set to. What's counted at that store goes on its shelf; what's counted at other stores but not that one yet waits in
//   "Not at a store yet" (said before, or right after on Ordering); one never counted at a store is as before.
// - A delivery never starts a store's count. The stock history says which store.
// - In the shop, each variant carries each store's number, so the page says whether the one picked is in stock there.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/store-receive.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
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
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const S = await import('../../src/lib/store-stock');
  const HS = await import('../../src/lib/here-server');
  const stores = [{ id: 'harbor', name: 'Harbor Rd' }, { id: 'main', name: 'Main St' }];

  console.log('the rules');
  check('counted at the store it came to: its shelf', S.receivedTo({ totalStock: 10, stockAt: { main: 4, harbor: 6 } }, stores, 'main') === 'shelf');
  check('counted at other stores, not this one yet: “Not at a store yet”', S.receivedTo({ totalStock: 10, stockAt: { harbor: 6 } }, stores, 'main') === 'unplaced');
  check('never counted at a store, or one location: as before', S.receivedTo({ totalStock: 10 }, stores, 'main') === 'everywhere' && S.receivedTo({ totalStock: 10, stockAt: { main: 4 } }, [], 'main') === 'everywhere' && S.receivedTo({ stockAt: { main: 1 } }, stores, '') === 'everywhere');
  check('for a write that merges maps: nested, only for a store it’s counted at', JSON.stringify(S.storeMoveNested({ stockAt: { main: 4 } }, 'main', { stock: 3 })) === JSON.stringify({ stockAt: { main: 7 } })
    && JSON.stringify(S.storeMoveNested({ stockAt: { harbor: 4 } }, 'main', { stock: 3 })) === '{}' && JSON.stringify(S.storeMoveNested({ stockAt: { main: 4 }, heldAt: { main: 1 } }, 'main', { held: -1 })) === JSON.stringify({ heldAt: { main: 0 } }));

  console.log('Ordering, a delivery at a store');
  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC' });
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true }); await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true }); HS.forgetLocations('t1');
  await db.doc(`${T}/inventory/oil`).set({ type: 'retail', name: 'Lip oil, Rose', costPerUnit: 4, totalStock: 10, stockAt: { main: 4, harbor: 6 }, supplier: 'Glow Supply', batches: [] });
  await db.doc(`${T}/inventory/balm`).set({ type: 'retail', name: 'Shea balm', costPerUnit: 3, totalStock: 6, stockAt: { harbor: 6 }, supplier: 'Glow Supply', batches: [] });
  await db.doc(`${T}/inventory/cups`).set({ type: 'professional', name: 'Paper cups', costPerUnit: 40, totalStock: 2, supplier: 'Glow Supply', batches: [] });
  const order = (id: string) => db.doc(`${T}/orders/${id}`).set({ id, supplier: 'Glow Supply', orderDate: new Date().toISOString(), status: 'Placed', items: [
    { productId: 'oil', productName: 'Lip oil, Rose', quantity: 12, costPerUnit: 4 }, { productId: 'balm', productName: 'Shea balm', quantity: 6, costPerUnit: 3 }, { productId: 'cups', productName: 'Paper cups', quantity: 1, costPerUnit: 40 }] });
  const R = await import('../../src/app/api/ordering/route');
  let r: any = await R.POST(req({ tenantId: 't1', action: 'plan' }));
  check('the plan says which stores a delivery can come to', r.body.ok && JSON.stringify(r.body.stores) === JSON.stringify(stores), r.body.stores);
  await order('o1');
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: 'o1', at: 'main' }));
  const oil = await get(`${T}/inventory/oil`); const balm = await get(`${T}/inventory/balm`); const cups = await get(`${T}/inventory/cups`);
  check('counted at Main St: on its shelf, and on the total', r.body.ok && oil.totalStock === 22 && oil.stockAt.main === 16 && oil.stockAt.harbor === 6, oil);
  check('counted at Harbor Rd only: on the total, waiting in “Not at a store yet” (Main St’s count never started by a delivery)', balm.totalStock === 12 && JSON.stringify(balm.stockAt) === JSON.stringify({ harbor: 6 }), balm);
  check('never counted at a store: as before', cups.totalStock === 3 && cups.stockAt === undefined, cups);
  check('…the answer names the store, and the ones waiting', r.body.storeName === 'Main St' && JSON.stringify(r.body.unplaced) === JSON.stringify(['Shea balm']), r.body);
  const rec = (await all(`${T}/stockCorrections`)).filter((e: any) => e.refId === 'o1');
  check('the stock history says which store', rec.length === 3 && rec.every((e: any) => e.storeId === 'main' && / at Main St$/.test(e.reason)), rec.map((e: any) => [e.storeId, e.reason]));
  await order('o2');
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: 'o2', at: 'gone' }));
  check('a store that isn’t one now: refused, nothing put away', r.status === 400 && /Pick the store it came to again/.test(r.body.error) && (await get(`${T}/inventory/oil`)).totalStock === 22 && (await get(`${T}/orders/o2`)).status === 'Placed');
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: 'o2' }));
  check('no store sent with several (a page from before): refused, nothing put away', r.status === 409 && /Pick the store it came to/.test(r.body.error) && (await get(`${T}/inventory/oil`)).totalStock === 22 && (await get(`${T}/orders/o2`)).status === 'Placed');
  await db.doc(`${T}/locations/pier`).set({ name: 'Pier', isActive: true });
  await db.doc(`${T}/inventory/oil`).set({ stockAt: { pier: 0 } }, { merge: true });
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: 'o2', at: 'pier' }));
  const oil2 = await get(`${T}/inventory/oil`);
  check('a location added a moment ago counts (read now, not the minute-old copy)', r.body.ok && r.body.storeName === 'Pier' && oil2.totalStock === 34 && oil2.stockAt.pier === 12 && oil2.stockAt.main === 16, [r.body, oil2.stockAt]);
  await db.doc(`${T}/locations/pier`).delete(); await db.doc(`${T}/locations/harbor`).delete(); HS.forgetLocations('t1');
  await order('o3');
  r = await R.POST(req({ tenantId: 't1', action: 'receive', orderId: 'o3' }));
  check('one location: no store asked, the total only, as before', r.body.ok && !r.body.storeName && (await get(`${T}/inventory/oil`)).totalStock === 46 && (await all(`${T}/stockCorrections`)).filter((e: any) => e.refId === 'o3').every((e: any) => !e.storeId));
  const op = src('src/app/(app)/inventory/ordering/page.tsx');
  check('the page: “Came to” above the orders, starting on this screen’s store; Received waits for a store; the store sent', op.includes('<CameTo stores={stores} at={at} onPick={setAt} id="order-came-to"') && op.includes('const [at, setAt] = useCameTo(stores);')
    && op.includes("disabled={busy === `recv-${o.id}` || (stores.length > 1 && !cameFor(o))} onClick={() => void receive(o, false)}") && op.includes('...(stores.length > 1 ? { at: to } : {})')
    // (An order for one store goes there unless another is picked on it: verify ordering-store.)
    && op.includes('const cameFor = (o: SupplyOrder) => cameOther[o.id] ?? (storeOf(o) || at);'));
  check('…and says where it went, and what waits in “Not at a store yet”', op.includes("const shelf = d.storeName ? `on ${d.storeName}’s shelf` : 'on the shelf';") && op.includes('so ${waits.length === 1 ? \'it waits\' : \'they wait\'} in “Not at a store yet” on Inventory.') && op.includes("One tap puts it all on {to ? `${to}’s shelf` : 'the shelf'} at these costs."));

  console.log('Inventory: a purchase order, and a quick receive');
  const at = src('src/components/inventory/ReceiveAtStore.tsx');
  check('“Came to”: only with more than one location; starts on the store this screen is set to', at.includes('if (stores.length < 2) return null;') && at.includes("localStorage.getItem('selectedLocationId')") && at.includes('return stores.some((s) => s.id === here) ? here : \'\';'));
  check('…what won’t go on that store’s shelf yet, said before it’s added', at.includes("receivedTo(i, stores, at) === 'unplaced'") && at.includes("counted at {store} yet, so {way === 'out' ? `${one ? 'it comes' : 'they come'} off “Not at a store yet”.` : `${one ? 'it goes' : 'they go'} to “Not at a store yet” until ${one ? 'it’s' : 'they’re'} counted there or moved.`}"));
  const po = src('src/components/inventory/ReceiveStockDialog.tsx'); const inv = src('src/app/(app)/inventory/page.tsx');
  check('a purchase order: asks, waits for a store, and passes it on', po.includes('<CameTo stores={stores} at={at} onPick={setAt} id="po-came-to" />') && po.includes('onConfirm(receivedItems, at || undefined);') && po.includes('onClick={confirm} disabled={needStore}') && po.includes('<NotOnShelf className="mb-3"'));
  check('…the page adds it to that store’s shelf only for one counted there, and names the store on the history', inv.includes('...(store && store.id in stockAtOf(existingProduct) ? { [`stockAt.${store.id}`]: increment(item.quantityReceived) } : {}),')
    && inv.includes("reason: `Shipment from ${orderToReceive.supplier}${store ? `, received at ${store.name}` : ''}`,") && inv.includes('<OrdersTab inventory={inventory || []} locations={locations || []} />'));
  const q = src('src/components/inventory/QuickReceiveDialog.tsx');
  check('a quick receive: asks, waits for a store, and puts it on that shelf in the same step that read the item', q.includes('<CameTo stores={stores} at={at} onPick={setAt} id="quick-came-to" />') && q.includes('if (stores.length && !at) return;')
    && q.includes('...storeMove(item, at, { stock: l.qty }),') && q.indexOf('...storeMove(item, at, { stock: l.qty }),') > q.indexOf('const item = snap.data() as any;') && q.includes("reason: storeName ? `Quick receive at ${storeName}` : 'Quick receive',") && q.includes('...(storeName ? { storeId: at } : {}),'));
  const L = await import('../../src/lib/stock-ledger');
  check('the stock history keeps the store', (L.buildEntry({ productId: 'x', type: 'received', delta: 1, reason: 'r', storeId: 'main' }) as any).storeId === 'main' && !('storeId' in L.buildEntry({ productId: 'x', type: 'received', delta: 1, reason: 'r' })));
  const RS = await import('../../src/components/inventory/ReceiveAtStore');
  check('the stores, from the business’s locations (not storage areas, not closed ones), and none with one', JSON.stringify(RS.storesFrom([{ id: 'main', name: 'Main St' }, { id: 'harbor', name: 'Harbor Rd' }, { id: 'shelf', name: 'Back shelf', locationTypeId: 'x' }, { id: 'old', name: 'Old', isActive: false }])) === JSON.stringify(stores)
    && RS.storesFrom([{ id: 'main', name: 'Main St' }]).length === 0);

  console.log('each variant at each store, in the shop');
  const V = await import('../../src/lib/variants');
  const listing = { id: 'lip', type: 'retail', name: 'Lip oil', showOnline: true, status: 'active', msrp: 18, totalStock: 0, optionGroups: [{ id: 'g', name: 'Shade', choices: [{ id: 'rose', label: 'Rose', variantProductId: 'rose' }, { id: 'plum', label: 'Plum', variantProductId: 'plum' }] }] };
  const rose = { id: 'rose', type: 'retail', name: 'Lip oil, Rose', parentId: 'lip', showOnline: true, status: 'active', msrp: 18, totalStock: 10, stockReserved: 0, stockAt: { main: 6, harbor: 4 } };
  const plum = { id: 'plum', type: 'retail', name: 'Lip oil, Plum', parentId: 'lip', showOnline: true, status: 'active', msrp: 18, totalStock: 3, stockReserved: 0, stockAt: { main: 3, harbor: 0 } };
  const byId = new Map<string, any>([['lip', listing], ['rose', rose], ['plum', plum]]);
  const groups = V.shopOptionGroups(listing, byId, { stores, maxShown: 99 });
  const ch = (id: string) => (groups[0].choices as any[]).find((c) => c.id === id);
  check('each variant’s choice carries each store’s number', JSON.stringify(ch('rose').atStores) === JSON.stringify([{ id: 'harbor', name: 'Harbor Rd', qty: 4, counted: true }, { id: 'main', name: 'Main St', qty: 6, counted: true }])
    && ch('plum').atStores.find((s: any) => s.id === 'harbor').qty === 0, [ch('rose').atStores, ch('plum').atStores]);
  check('…none without stores (one location), as before', !('atStores' in (V.shopOptionGroups(listing, byId, {})[0].choices[0] as any)));
  const SC = await import('../../src/lib/shop-catalog');
  const rows = SC.catalogProducts([listing, rose, plum] as any, byId, new Map(), { wholesale: false, discountPct: 0, zone: 'Etc/UTC', stores });
  const lip = rows.find((p: any) => p.id === 'lip');
  check('the catalog: the listing has none of its own; each variant has its own', lip && !lip.atStores && !!lip.optionGroups?.[0]?.choices?.find((c: any) => c.id === 'plum')?.atStores, lip);
  const line = V.shopLine({ ...lip, optionGroups: groups }, { g: 'plum' });
  const said = S.storeLine((line.variantChoice as any)?.atStores, 'harbor');
  check('the product page, Plum picked at Harbor Rd: out of stock there, in stock at Main St', said?.here?.qty === 0 && said?.elsewhere.map((x) => x.name).join() === 'Main St', said);
  const pp = src('src/app/shop/[tenantId]/product/[productId]/page.tsx');
  check('…the line under the button follows the variant picked', pp.includes('<StoreStockLine tenantId={tenantId} at={line?.variantChoice ? (line.variantChoice as any).atStores : (product as any).atStores} />'));
  check('the product route sends each variant’s', src('src/app/api/retail/product/route.ts').includes('optionGroups: shopOptionGroups(item, byId, { wholesale: wholesaleUnlocked, discountPct: wsDiscount, zone: shopZone, maxShown: MAX_SHOWN_QTY, stores: shopStores }),'));

  const prod = src('src/app/(app)/inventory/(detail)/product/[id]/page.tsx');
  check('a listing’s Variants tab: each variant’s number at each store (each is counted on its own page)', prod.includes("w.stores.map((x) => (x.count === null ? `${x.name} not counted yet` : `${x.name} ${x.count}`)).join(', ') : 'Not counted at a store yet'")
    && prod.includes('{severalStores && storeList.length > 1 && <span className="col-span-2 text-[13.5px] md:col-span-6" style={muted}>{atEachStore(v)}</span>}'));
  const st = src('src/components/inventory/ReceiveAtStore.tsx');
  check('house style', !/ · |\buppercase\b|font-black|call us|contact us|\{\/\*/i.test(st) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(st));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
