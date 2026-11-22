// Checks write-offs, sales, uses and returns at a store (design board "Write-offs, sales and returns at a store";
// lib/store-stock storeFollow, lib/log-use and api/inventory/use, the Inventory page's Write some off and Log a sale,
// lib/retail-returns and api/retail/fulfil, the return sheet and Problems).
// - With more than one location, anything taken off by hand says which store it happened at (starting on the store the
//   screen is set to, waiting until one is picked), and a return says which store it's checked in at.
// - Counted at that store: its number moves with the total (down for a write-off, a sale or a use; up for a return).
//   Not counted there: the total only. A return held to check goes back on the shelf where it was checked in.
// - The stock history says which store. A return puts the total up by what came back (never worked out again from
//   the batches).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/store-shelf.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: true, isTenantOwner: false, caps: [] };
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
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };

(async () => {
  const S = await import('../../src/lib/store-stock');
  console.log('the rules');
  check('a change worked out as the new total moves the store’s number by the same amount', JSON.stringify(S.storeFollow({ totalStock: 10, stockAt: { main: 4 } }, 'main', 7)) === JSON.stringify({ 'stockAt.main': 1 })
    && JSON.stringify(S.storeFollow({ totalStock: 10, stockAt: { main: 2 } }, 'main', 5)) === JSON.stringify({ 'stockAt.main': 0 }));
  check('…not counted there, or no store: nothing', JSON.stringify(S.storeFollow({ totalStock: 10, stockAt: { harbor: 4 } }, 'main', 7)) === '{}' && JSON.stringify(S.storeFollow({ totalStock: 10, stockAt: { main: 4 } }, '', 7)) === '{}' && JSON.stringify(S.storeFollow({ totalStock: 10 }, 'main', 'x')) === '{}');

  const seed = async (several = true) => {
    db = strictTransactions(makeDb());
    await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', retailSettings: {} });
    await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true });
    if (several) await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true });
    await db.doc(`${T}/inventory/towels`).set({ id: 'towels', type: 'overhead', name: 'Paper towels', costPerUnit: 2, totalStock: 20, stockAt: { main: 12, harbor: 8 }, batches: [], unit: 'rolls' });
    await db.doc(`${T}/inventory/balm`).set({ id: 'balm', type: 'retail', name: 'Shea balm', costPerUnit: 3, totalStock: 6, stockAt: { harbor: 6 }, batches: [], unit: 'units' });
    await db.doc(`${T}/inventory/oil`).set({ id: 'oil', type: 'retail', name: 'Lip oil', costPerUnit: 4, totalStock: 9, stockAt: { main: 5, harbor: 4 }, batches: [{ id: 'b1', stock: 2, costPerUnit: 4 }], unit: 'units' });
  };

  console.log('Log a use');
  await seed();
  const U = await import('../../src/app/api/inventory/use/route');
  let r: any = await U.POST(req({ tenantId: 't1', productId: 'towels', quantity: 3, reason: 'Spill', at: 'main' }));
  let tw = await get(`${T}/inventory/towels`);
  check('used at Main St: off its shelf and the total', r.status === 200 && r.body.ok && tw.totalStock === 17 && tw.stockAt.main === 9 && tw.stockAt.harbor === 8, [r.body, tw]);
  const e1 = (await all(`${T}/stockCorrections`)).find((e: any) => e.productId === 'towels');
  check('…the stock history names the store', e1?.storeId === 'main' && /^Spill at Main St$/.test(e1.reason), e1);
  r = await U.POST(req({ tenantId: 't1', productId: 'balm', quantity: 2, at: 'main' }));
  const balm = await get(`${T}/inventory/balm`);
  check('not counted at that store: the total only (it comes off “Not at a store yet”)', r.body.ok && balm.totalStock === 4 && JSON.stringify(balm.stockAt) === JSON.stringify({ harbor: 6 }), balm);
  r = await U.POST(req({ tenantId: 't1', productId: 'towels', quantity: 1 }));
  check('no store with several: refused, nothing taken', r.status === 409 && /Pick the store it was used at/.test(r.body.error) && (await get(`${T}/inventory/towels`)).totalStock === 17);
  r = await U.POST(req({ tenantId: 't1', productId: 'towels', quantity: 1, at: 'gone' }));
  check('a store that isn’t one now: refused', r.status === 400 && /isn’t one of your locations now/.test(r.body.error) && (await get(`${T}/inventory/towels`)).totalStock === 17);
  await db.doc(`${T}/locations/pier`).set({ name: 'Pier', isActive: true });
  await db.doc(`${T}/inventory/towels`).set({ stockAt: { pier: 5 } }, { merge: true });
  r = await U.POST(req({ tenantId: 't1', productId: 'towels', quantity: 1, at: 'pier' }));
  check('a location added a moment ago counts', r.body.ok && (await get(`${T}/inventory/towels`)).stockAt.pier === 4);
  await seed(false);
  r = await U.POST(req({ tenantId: 't1', productId: 'towels', quantity: 2 }));
  tw = await get(`${T}/inventory/towels`);
  check('one location: no store asked, the total only, as before', r.body.ok && tw.totalStock === 18 && tw.stockAt.main === 12 && !(await all(`${T}/stockCorrections`))[0].storeId);

  console.log('Write some off, and Log a sale, in Inventory');
  const inv = src('src/app/(app)/inventory/page.tsx');
  check('in a step that reads the item: off that store’s shelf (never below none), the history names the store', inv.includes('const snap = await tx.get(productRef); const fresh: any = snap.data() || {};') && inv.includes("tx.update(productRef, { ...b.patch, ...storeMove(fresh, store.id, { stock: -qty }) });")
    && inv.includes('balanceAfter: b.balanceAfter, reason: `${entry.reason} at ${store.name}`.slice(0, 240), storeId: store.id'));
  check('…the batches and the total worked out from the item as it is now, in the same step', inv.includes('writeOffBatches(fresh.batches, batchId, quantity)') && inv.includes('fifoBatches(fresh.batches, quantity)') && inv.includes('const total = Math.max(0, Math.floor(Number(fresh.totalStock) || 0) - quantity);') && inv.includes('const have = Math.max(0, Math.floor(Number(fresh.totalStock) || 0));'));
  check('…waited for; with no connection, saved the usual way without the store’s own number, and said so', (inv.match(/const saved = await takeAtStore\(/g) || []).length === 2 && (inv.match(/if \(!saved\) takenWithoutStore\(/g) || []).length === 2
    && inv.includes('title: \'Saved without the store’s own number\'') && inv.includes('const handleLogSaleConfirm = async (') && inv.includes('const handleWriteOffConfirm = useCallback(async ('));
  check('…the history entry has one id either way (a second try never adds a second entry)', (inv.match(/const entryRef = doc\(collection\(firestore, `tenants\/\$\{tenantId\}\/stockCorrections`\)\);/g) || []).length === 2 && inv.includes('tx.set(entryRef, ') && inv.includes('void setDoc(entryRef, '));
  check('…less there now than the screen showed: stopped and said, nothing saved (the dialog stays open)', inv.includes('throw new ShortNow(`That batch has ${') && inv.includes('throw new ShortNow(`Only ${have} left now.') && inv.includes("return e instanceof ShortNow ? e.message : false;")
    && (inv.match(/if \(typeof saved === 'string'\) return \{ success: false, message: saved \};/g) || []).length === 2 && src('src/components/inventory/WriteOffDialog.tsx').includes("if (r && r.success === false) { toast({ variant: 'destructive', title: 'Not written off', description: String(r.message"));
  {
    const ts = await import('typescript');
    const grab = (name: string) => { const i = inv.indexOf(`function ${name}(`); const j = inv.indexOf('\n}\n', i); return inv.slice(i, j + 2); };
    const js = ts.transpileModule(`${grab('writeOffBatches')}\n${grab('fifoBatches')}\nmodule.exports = { writeOffBatches, fifoBatches };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const mod: any = { exports: {} }; new Function('module', 'exports', js)(mod, mod.exports);
    const now = [{ id: 'b2', stock: 3, receivedDate: '2026-11-02' }, { id: 'b1', stock: 1, receivedDate: '2026-10-02' }, { id: 'b3', stock: 5, receivedDate: '2026-11-20' }];
    check('…a write-off comes off its batch (never below none); a sale off the oldest first', JSON.stringify(mod.exports.writeOffBatches(now, 'b2', 5).map((b: any) => b.stock)) === '[0,1,5]'
      && JSON.stringify(mod.exports.fifoBatches(now, 3).map((b: any) => `${b.id}:${b.stock}`)) === '["b1:0","b2:1","b3:5"]' && now[0].stock === 3);
  }
  const wd = src('src/components/inventory/WriteOffDialog.tsx'); const sd = src('src/components/inventory/LogSaleDialog.tsx');
  check('…the dialogs wait for it, and can’t be sent twice', wd.includes('await onConfirm(product.id, data.batchId,') && wd.includes('disabled={isSubmitting || needStore') && sd.includes('const result = await onConfirm(product.id,') && sd.includes('disabled={isSubmitting || !!quantityError || needStore}'));
  for (const [f, label, hint] of [['WriteOffDialog', 'Where was it?', 'Pick the store it was at.'], ['LogSaleDialog', 'Sold at', 'Pick the store it was sold at.'], ['LogUseDialog', 'Used at', 'Pick the store it was used at.']]) {
    const d = src(`src/components/inventory/${f}.tsx`);
    check(`${f}: “${label}” with more than one location, starting on this screen’s store, and waits for one`, d.includes(`label="${label}" hint="${hint}"`) && d.includes('const [at, setAt] = useCameTo(stores);') && d.includes('<NotOnShelf way="out"') && /disabled=\{[^}]*(needStore|stores\.length > 0 && !at)/.test(d));
  }
  check('…Log a use sends the store', src('src/components/inventory/LogUseDialog.tsx').includes("data.reason || 'Logged by hand', at || undefined);") && src('src/lib/count-client.ts').includes('...(at ? { at } : {})'));

  console.log('a return checked in at a store');
  const line = (id: string, pid: string, name: string, n: number) => ({ lineId: id, productId: pid, sku: pid, name, unitPriceCents: 1200, qtyOrdered: n, qtyShorted: 0, qtyReturned: 0 });
  const order = async (rlines: any[]) => {
    await seed();
    await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', orderNumber: 1209, stage: 'completed', method: 'pickup', locationId: 'harbor', customerName: 'Jordan Tate', customerEmail: 'j@example.com', qrToken: 'o1.tok', lines: [line('A', 'oil', 'Lip oil', 2), line('B', 'balm', 'Shea balm', 1)], subtotalCents: 3600, taxCents: 0, totalCents: 3600, returnSeq: 1 });
    await db.doc(`${T}/retailReturns/r1`).set({ id: 'r1', tenantId: 't1', orderId: 'o1', orderNumber: 1209, status: 'open', resolution: 'refund', photoUrls: [], refundCents: 3600, openedBy: 'Kai Park', openedAt: '2026-11-21T15:00:00Z', lines: rlines });
  };
  const F = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { const x: any = await F.POST(req({ tenantId: 't1', action, ...args })); await settle(); return x; };
  await order([{ lineId: 'A', sku: 'oil', name: 'Lip oil', qty: 2, reason: 'changed_mind' }, { lineId: 'B', sku: 'balm', name: 'Shea balm', qty: 1, reason: 'changed_mind' }]);
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'A', disposition: 'restock' });
  check('going back on the shelf with several stores and none said: refused, nothing put back', r.status === 409 && /Pick the store it’s checked in at/.test(r.body.message) && (await get(`${T}/inventory/oil`)).totalStock === 9);
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'A', disposition: 'restock', at: 'gone' });
  check('…a store that isn’t one now: refused', r.status === 400 && (await get(`${T}/inventory/oil`)).totalStock === 9);
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'A', disposition: 'restock', at: 'main' });
  const oil = await get(`${T}/inventory/oil`);
  check('back on Main St’s shelf, and the total up by what came back (not worked out again from the batches)', r.body.ok && oil.totalStock === 11 && oil.stockAt.main === 7 && oil.stockAt.harbor === 4 && oil.batches.length === 2, oil);
  const back = (await all(`${T}/stockCorrections`)).find((e: any) => e.productId === 'oil');
  check('…the stock history names the store', back?.storeId === 'main' && /^Return restocked at Main St \(Order #1209\)$/.test(back.reason), back);
  const ret1 = await get(`${T}/retailReturns/r1`);
  check('…and the return keeps where it was checked in', ret1.lines[0].atStore === 'main' && ret1.lines[0].atStoreName === 'Main St');
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'B', disposition: 'damaged' });
  check('written off (damaged) needs no store: nothing goes on a shelf, no store kept on the line', r.body.ok && (await get(`${T}/inventory/balm`)).totalStock === 6 && !(await get(`${T}/retailReturns/r1`)).lines[1].atStore);
  await order([{ lineId: 'A', sku: 'oil', name: 'Lip oil', qty: 1, reason: 'changed_mind' }]);
  await db.doc(T).set({ retailSettings: { policies: { openedReturns: 'restock' } } }, { merge: true });
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'A', disposition: 'open_box' });
  check('opened, when the shop puts opened items back on the shelf: a store is asked for too', r.status === 409 && (await get(`${T}/inventory/oil`)).totalStock === 9);
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'A', disposition: 'open_box', at: 'harbor' });
  check('…and goes on that store’s shelf', r.body.ok && (await get(`${T}/inventory/oil`)).stockAt.harbor === 5 && (await get(`${T}/retailReturns/r1`)).lines[0].atStore === 'harbor');
  await order([{ lineId: 'A', sku: 'oil', name: 'Lip oil', qty: 1, reason: 'changed_mind' }]);
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'A', disposition: 'open_box' });
  check('opened, written off by the shop’s policy: no store asked', r.body.ok && (await get(`${T}/inventory/oil`)).totalStock === 9);

  console.log('held to check, then decided');
  await order([{ lineId: 'A', sku: 'oil', name: 'Lip oil', qty: 2, reason: 'defective' }]);
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'A', disposition: 'quarantine' });
  check('held with several stores and none said: refused', r.status === 409);
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'A', disposition: 'quarantine', at: 'harbor' });
  check('held at Harbor Rd: out of stock, the store kept on the line', r.body.ok && (await get(`${T}/inventory/oil`)).totalStock === 9 && (await get(`${T}/retailReturns/r1`)).lines[0].atStore === 'harbor');
  r = await step('decideHold', { returnId: 'r1', lineId: 'A', outcome: 'restock', qty: 1 });
  let o2 = await get(`${T}/inventory/oil`);
  check('decided fine: back on Harbor Rd’s shelf, where it was checked in', r.body.ok && o2.totalStock === 10 && o2.stockAt.harbor === 5 && o2.stockAt.main === 5, [r.body, o2]);
  r = await step('decideHold', { returnId: 'r1', lineId: 'A', outcome: 'damaged', qty: 1 });
  o2 = await get(`${T}/inventory/oil`);
  check('…the other one damaged: written off, nothing on a shelf', r.body.ok && o2.totalStock === 10 && o2.stockAt.harbor === 5);
  const held = (await all(`${T}/stockCorrections`)).find((e: any) => /Held return/.test(e.reason));
  check('…the stock history names the store', held?.storeId === 'harbor' && /at Harbor Rd/.test(held.reason), held);

  console.log('one location');
  await order([{ lineId: 'A', sku: 'oil', name: 'Lip oil', qty: 1, reason: 'changed_mind' }]);
  await db.doc(`${T}/locations/harbor`).delete();
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'A', disposition: 'restock' });
  const o3 = await get(`${T}/inventory/oil`);
  check('no store asked; the total only, as before', r.body.ok && o3.totalStock === 10 && o3.stockAt.main === 5 && !(await get(`${T}/retailReturns/r1`)).lines[0].atStore);

  console.log('the screens');
  const rs = src('src/components/orders/ReturnSheet.tsx');
  check('the return sheet: “Checked in at” when something goes back on the shelf or is held, and waits for a store', rs.includes('label="Checked in at" hint="Pick the store it’s checked in at."') && rs.includes("const shelfish = (c?: Cond) => c === 'restock' || c === 'quarantine' || (c === 'open_box' && rs?.policies?.openedReturns === 'restock');")
    && rs.includes('disabled={busy || !order || !ready || needStore}') && rs.includes('actor, stores.length > 1 && at ? at : undefined);'));
  check('…each item says where it goes', rs.includes("(atName ? `Goes back on ${atName}’s shelf.` : 'Goes back into stock.')") && rs.includes("`Kept out of stock${atName ? ` at ${atName}` : ''} until someone checks it. It waits in Problems.`"));
  const pp = src('src/components/orders/ProblemPanel.tsx');
  check('Problems: a held item says it goes back where it was checked in', pp.includes("const backTo = heldAt ? `Goes back on ${heldAt}’s shelf, where it was checked in` : 'Goes back into stock';"));
  const st = src('src/components/inventory/ReceiveAtStore.tsx');
  check('house style', !/ · |\buppercase\b|font-black|call us|contact us|\{\/\*/i.test(st + rs.split('\n').filter((l) => /atName|askStore|CameTo|NotOnShelf|shelfish|backItems|needStore/.test(l)).join('\n')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
