// Checks stock at each store, part 1 (design board "Stock at each store, and tonight's counts at each location";
// lib/store-stock, lib/store-stock-server, api/inventory/stores, components/products/StoreStockPanel, the product page).
// - With more than one location, an item can be counted at each store; the total stays the business's one number, and
//   what isn't at a store yet is the rest.
// - A first count at a store takes from "Not at a store yet"; a later one changes the total by the difference (less what
//   a sale without a store already took off). Moves keep the total. Every store counted: what wasn't found comes off.
// - Each change is one step with the item and a line on its stock history, as the person who did it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/store-stock.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let actor: any = { uid: 'u1', name: 'Rae Kim', role: 'staff', isManager: false, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => 'Bearer test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const S = await import('../../src/lib/store-stock');
  const HS = await import('../../src/lib/here-server');
  const { POST } = await import('../../src/app/api/inventory/stores/route');
  const stores = [{ id: 'main', name: 'Main St' }, { id: 'harbor', name: 'Harbor Rd' }];

  console.log('the rules');
  let v = S.storeView({ totalStock: 18 }, stores);
  check('not counted at any store: all of it is “Not at a store yet”, as before', v.total === 18 && v.unplaced === 18 && !v.tracked && v.stores.every((s) => s.count === null));
  let a = S.afterCount({ totalStock: 18 }, stores, 'main', 12);
  check('a first count at a store takes from “Not at a store yet”: the total stays', a.totalStock === 18 && a.stockAt.main === 12 && a.delta === 0);
  a = S.afterCount({ totalStock: 18, stockAt: { main: 12 } }, stores, 'harbor', 9);
  check('…and past it, adds the rest to the total', a.totalStock === 21 && a.stockAt.harbor === 9 && a.delta === 3);
  a = S.afterCount({ totalStock: 18, stockAt: { main: 12, harbor: 4 } }, stores, 'main', 10);
  check('a later count changes the total by the difference', a.totalStock === 16 && a.stockAt.main === 10);
  v = S.storeView({ totalStock: 15, stockAt: { main: 12, harbor: 4 } }, stores);
  check('sold without a store: the stores add up to more than the total, and it says by how many', v.short === 1 && v.unplaced === 0);
  a = S.afterCount({ totalStock: 15, stockAt: { main: 12, harbor: 4 } }, stores, 'main', 11);
  check('…the next count at that store finds one fewer, already off the total', a.totalStock === 15 && a.stockAt.main === 11);
  check('a closed store’s number is “Not at a store yet” again', S.storeView({ totalStock: 10, stockAt: { gone: 6, main: 4 } }, stores).unplaced === 6);
  const mv = S.afterMove({ totalStock: 18, stockAt: { main: 12, harbor: 4 } }, stores, 'main', 'harbor', 3);
  check('a move between stores', 'stockAt' in mv && mv.stockAt.main === 9 && mv.stockAt.harbor === 7);
  const m2 = S.afterMove({ totalStock: 18, stockAt: { main: 12, harbor: 4 } }, stores, 'none', 'harbor', 3);
  check('…from “Not at a store yet”, only what’s there', 'error' in m2 && /Not at a store yet has 2/.test(m2.error));
  check('…nothing, the same place, or a store that isn’t one: refused', 'error' in S.afterMove({}, stores, 'main', 'harbor', 0) && 'error' in S.afterMove({}, stores, 'main', 'main', 1) && 'error' in S.afterMove({}, stores, 'main', 'gone', 1));
  check('what a store can sell: its own number (never more than the business can), or the business’s before it’s counted', S.sellableAt({ totalStock: 18, stockAt: { main: 12 } }, stores, 'main', 10) === 10
    && S.sellableAt({ totalStock: 18, stockAt: { main: 12 } }, stores, 'harbor', 10) === 0 && S.sellableAt({ totalStock: 18 }, stores, 'harbor', 10) === 10 && S.sellableAt({ totalStock: 18, stockAt: { main: 2 } }, stores, null, 10) === 10);

  console.log('counting at a store');
  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC' });
  await db.doc(`${T}/inventory/oil`).set({ type: 'retail', name: 'Lip oil, Rose', totalStock: 18, stockReserved: 2, costPerUnit: 4, batches: [{ id: 'b1', stock: 18, costPerUnit: 4, receivedDate: '2026-10-01' }] });
  const call = (b: any) => POST(req({ tenantId: 't1', itemId: 'oil', ...b })) as any;
  let r = await call({ action: 'view' });
  check('with one location: not here yet', r.status === 409);
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true }); await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true }); HS.forgetLocations('t1');
  r = await call({ action: 'view' });
  check('two locations: each store, the total, and “Not at a store yet”', r.body.ok && r.body.total === 18 && r.body.unplaced === 18 && r.body.stores.length === 2, r.body);
  r = await call({ action: 'count', at: 'main', counted: 12 });
  let it = await get(`${T}/inventory/oil`);
  check('a count at Main St: kept for it, the total as it was, who and when', r.body.ok && it.stockAt.main === 12 && it.totalStock === 18 && it.lastCountedBy === 'Rae Kim' && r.body.unplaced === 6, r.body);
  r = await call({ action: 'count', at: 'harbor', counted: 9 });
  it = await get(`${T}/inventory/oil`);
  check('…at Harbor Rd, 3 more than were left: the total goes up, its batches too', r.body.ok && it.totalStock === 21 && it.batches.reduce((n: number, b: any) => n + b.stock, 0) === 21 && r.body.unplaced === 0, it);
  const hist = (await all(`${T}/stockCorrections`)).filter((e: any) => e.productId === 'oil');
  check('each on the stock history, as the person who counted, with the store', hist.length === 2 && hist.every((e: any) => e.actorName === 'Rae Kim' && e.type === 'counted') && hist.some((e: any) => e.storeId === 'harbor' && e.change === 3 && /Counted at Harbor Rd: 9/.test(e.reason)), hist);
  r = await call({ action: 'count', at: 'main', counted: 0 });
  const r9: any = await call({ action: 'count', at: 'harbor', counted: 1 });
  check('…never below what’s held for paid orders', r.body.ok === true && r9.status === 409 && /2 are held for paid orders/.test(r9.body.error) && (await get(`${T}/inventory/oil`)).stockAt.harbor === 9, r9.body);
  r = await call({ action: 'count', at: 'main', counted: 12 });
  r = await call({ action: 'count', at: 'gone', counted: 1 });
  check('a store that isn’t one, or a number that isn’t one: refused', r.status === 400 && (await call({ action: 'count', at: 'main', counted: 'lots' })).status === 400);

  console.log('moving and clearing');
  r = await call({ action: 'move', from: 'main', to: 'harbor', qty: 3 });
  it = await get(`${T}/inventory/oil`);
  check('a move: from one store to the other, the total the same, on the history', r.body.ok && it.stockAt.main === 9 && it.stockAt.harbor === 12 && it.totalStock === 21 && (await all(`${T}/stockCorrections`)).some((e: any) => e.type === 'transferred' && e.moved === 3 && e.from === 'main' && e.to === 'harbor'), it);
  r = await call({ action: 'move', from: 'main', to: 'harbor', qty: 50 });
  check('…more than it has: refused, saying how many it has', r.status === 400 && /Main St has 9/.test(r.body.error));
  await db.doc(`${T}/inventory/oil`).update({ totalStock: 24 });
  r = await call({ action: 'clear' });
  it = await get(`${T}/inventory/oil`);
  check('every store counted, 3 not found: taken off the total, on the history', r.body.ok && it.totalStock === 21 && r.body.unplaced === 0 && (await all(`${T}/stockCorrections`)).some((e: any) => /Not found at any store: 3 taken off/.test(e.reason)), r.body);
  await db.doc(`${T}/inventory/var`).set({ type: 'retail', name: 'Tee', totalStock: 4, optionGroups: [{ id: 'g', name: 'Size', choices: [{ id: 's', label: 'Small', variantProductId: 'small' }] }] });
  r = await POST(req({ tenantId: 't1', itemId: 'var', action: 'count', at: 'main', counted: 1 })) as any;
  check('a product counted by its variants: count each variant instead', r.status === 400 && /variants/.test(r.body.error), r.body);
  await db.doc(`${T}/inventory/lemon`).set({ type: 'professional', name: 'Lemons', totalStock: 2, costingMethod: 'uses', estimatedUses: 100, partialContainerUses: 40 });
  r = await POST(req({ tenantId: 't1', itemId: 'lemon', action: 'count', at: 'main', counted: 1 })) as any;
  check('one counted by the dose (with an open container): counted on its own page', r.status === 400 && /counted by the dose/.test(r.body.error), r.body);
  await db.doc(`${T}/inventory/flour`).set({ type: 'professional', name: 'Flour', totalStock: 0, countStock: false });
  r = await POST(req({ tenantId: 't1', itemId: 'flour', action: 'count', at: 'main', counted: 5 })) as any;
  check('one never counted until now: where it starts, not a difference found, and counted from now on', r.body.ok && (await all(`${T}/stockCorrections`)).some((e: any) => e.productId === 'flour' && e.baseline === true) && (await get(`${T}/inventory/flour`)).countStock === true);
  await db.doc(`${T}/inventory/oil`).update({ 'stockAt.gone': 4 });
  await POST(req({ tenantId: 't1', itemId: 'oil', action: 'move', from: 'main', to: 'harbor', qty: 1 }));
  check('a closed store’s number is let go on the next change', !('gone' in (await get(`${T}/inventory/oil`)).stockAt));
  actor = { ...actor, isRenter: true };
  r = await call({ action: 'view' });
  check('a booth renter can’t change the business’s stock', r.status === 403);

  console.log('the page');
  const panel = src('src/components/products/StoreStockPanel.tsx'); const page = src('src/app/(app)/inventory/(detail)/product/[id]/page.tsx');
  check('the product page shows At each store with more than one location (not for one counted by its variants)', page.includes("{countable && !variantIds.length && p.costingMethod !== 'uses' && p.costingMethod !== 'size' && tenantId && severalStores && <StoreStockPanel"));
  check('the panel: each store, Not at a store yet, Count at a store, Move, and what wasn’t found', panel.includes('Not at a store yet') && panel.includes('>Count at a store<') && panel.includes('>Move<') && panel.includes('not found off the total') && panel.includes('sold or used without a store since the last count'));
  check('house style', !/ · |\buppercase\b|font-black|call us|contact us|\{\/\*/i.test(panel) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(panel));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
