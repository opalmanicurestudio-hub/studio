// Checks one product identity everywhere (lib/product-codes, lib/scan-resolve, lib/retail-orders applyScan, the test
// order, the packing screen, the register, receiving and the product form). A product answers to the shop's label, its
// barcode, SKU and any other code it carries, and its case and pallet codes, tolerant of leading zeros; the register,
// packing and receiving use the same rules. Packing a test order scans the real products. A barcode added after an
// order was placed, a duplicate's label, or a parent's code for the order's one size still scans. A code that isn't on
// the order says which product it is, or that no product has it yet, and the packer can add it to the right product;
// a code is never given to two products, and adding a product keeps its SKU and barcode.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/product-codes.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

let db = makeDb();
let auto = 0;
const colRef = (path: string) => ({ __col: true, path, id: path.split('/').pop() });
const docRef = (path: string) => ({ __doc: true, path, id: path.split('/').pop() });
const webSnap = (s: any, r: any) => ({ exists: () => s.exists, data: () => s.data(), id: s.id, ref: r });
const web: any = {
  collection: (base: any, ...segs: string[]) => colRef([base?.__doc ? base.path : base?.__col ? base.path : '', ...segs].filter(Boolean).join('/')),
  doc: (base: any, ...segs: string[]) => (base?.__col ? docRef(`${base.path}/${segs[0] || `auto${++auto}`}`) : docRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/'))),
  runTransaction: (_fs: any, fn: any) => db.runTransaction(() => fn({
    get: async (r: any) => webSnap(await db.doc(r.path).get(), r),
    update: (r: any, v: any) => db.doc(r.path).update(v),
    set: (r: any, v: any, o?: any) => db.doc(r.path).set(v, o),
  })),
  getDoc: async (r: any) => webSnap(await db.doc(r.path).get(), r),
  updateDoc: async (r: any, v: any) => db.doc(r.path).update(v),
  arrayUnion: (...v: any[]) => FV.arrayUnion(...v),
  query: (c: any, ...cons: any[]) => ({ __q: true, path: c.path, cons }),
  where: (k: string, op: string, v: any) => ({ t: 'where', k, op, v }), limit: (n: number) => ({ t: 'limit', n }), orderBy: () => ({ t: 'orderBy' }),
  getDocs: async (q: any) => { let c: any = db.collection(q.path); for (const x of q.cons || []) { if (x?.t === 'where') c = c.where(x.k, x.op, x.v); if (x?.t === 'limit') c = c.limit(x.n); } const s = await c.get(); return { docs: s.docs.map((d: any) => ({ id: d.id, data: () => d.data(), exists: () => true })), empty: s.empty, size: s.size }; },
};
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase/firestore') return web;
  if (request.endsWith('staff-fetch')) return { staffAuthHeader: async () => ({ Authorization: 'Bearer t' }) };
  if (request.endsWith('renter-credit-client')) return { syncRenterCredits: () => undefined };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const actor = { id: 'k1', name: 'Kai Park' };
const line = (x: any = {}) => ({ lineId: 'A', productId: 'gel', sku: 'GEL-01', barcode: '012345678905', name: 'Gel polish', optionsLabel: '', unitPriceCents: 1500, qtyOrdered: 2, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending', ...x });
const order = (lines: any[], x: any = {}) => ({ id: 'o1', tenantId: 't1', orderNumber: 1201, stage: 'picking', method: 'ship', lines, ...x });
const fresh = async () => { db = makeDb(); auto = 0; };

(async () => {
  const pc = await import('../../src/lib/product-codes');
  const ro = await import('../../src/lib/retail-orders');
  const { resolveOrderScan, scanMissMessage, learnCode } = await import('../../src/lib/scan-resolve');
  const { recordItemScan, recordPackScan } = await import('../../src/lib/retail-fulfill');
  const { identifyPosScan } = await import('../../src/lib/pos-scan');

  // ── One set of codes ──
  const gel = { id: 'gel', name: 'Gel polish', sku: 'GEL-01', barcode: '012345678905', upc: '', gtin: '00012345678912', barcodes: ['GP-OLD'], caseBarcode: '10012345678902', casePack: 12, palletBarcode: 'PAL-9', palletPack: 10 };
  check('a product answers to its label, id, barcode, SKU, GTIN and extra barcodes (one unit each)',
    ['clarityflow://product/gel', 'gel', '012345678905', 'GEL-01', '00012345678912', 'GP-OLD'].every((c) => pc.productMatch(gel, c) === 'unit'));
  check('…and its case and pallet codes count a case and a pallet', pc.productMatch(gel, '10012345678902') === 'case' && pc.productMatch(gel, 'PAL-9') === 'pallet');
  check('…a UPC read as EAN-13 (a leading zero) is the same code; another product’s label is not',
    pc.productMatch(gel, '0012345678905') === 'unit' && pc.productMatch(gel, '12345678905') === 'unit' && pc.productMatch(gel, 'clarityflow://product/top') === null && pc.productMatch(gel, '999') === null);
  const items = [gel, { id: 'top', name: 'Top coat', sku: 'TOP-1' }];
  check('found among products by any code', pc.findByCode(items, 'GP-OLD')?.item.id === 'gel' && pc.findByCode(items, 'clarityflow://product/top')?.item.id === 'top' && pc.findByCode(items, 'nope') === null);
  check('who already uses a code (so it isn’t given to a second product)', pc.codeOwners(items, ['TOP-1', 'NEW-1'], 'gel').map((x) => x.item.id).join() === 'top' && pc.codeOwners(items, ['GEL-01'], 'gel').length === 0);

  // ── The order line carries every code ──
  const built = ro.buildOrderLine({ ...gel, type: 'retail', totalStock: 5, msrp: 15 } as any, 1, 'L1');
  check('a line keeps the product’s other codes as sold (not repeating its barcode or SKU)', JSON.stringify(built.codes) === JSON.stringify(['00012345678912', 'GP-OLD']), built.codes);
  let out = ro.applyScan([line({ codes: ['GP-OLD'] })] as any, 'GP-OLD');
  check('scanning an extra barcode counts the item', out.result.ok && (out.result as any).name === 'Gel polish' && out.lines[0].qtyScanned === 1, out.result);
  out = ro.applyScan([line({ qtyOrdered: 24 })] as any, '10012345678902', { lineId: 'A', identity: { casePack: 12, caseBarcode: '10012345678902' } });
  check('a case code the product got after the order was placed still counts a case', out.result.ok && out.lines[0].qtyScanned === 12, out.result);
  out = ro.applyScan([line({ productId: 'test-gel', sku: '', barcode: '' })] as any, 'clarityflow://product/gel');
  check('the shop’s label counts an item on a test order made before test items kept their codes', out.result.ok, out.result);

  // ── The test order ──
  await fresh();
  await db.doc(T).set({ name: 'Opal' });
  await db.doc(`${T}/inventory/gel`).set({ ...gel, type: 'retail', status: 'active', msrp: 15, totalStock: 4, showInShop: true, publishedOnline: true, isPublic: true });
  const Mod: any = Module as any; const prevLoad = Mod._load;
  Mod._load = function (request: string, ...rest: any[]) {
    if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
    if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
    if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: { uid: 'm1', name: 'Mia Chen', isManager: true } }) };
    if (request === '@/lib/retail-webhook') return { makeQrToken: (id: string) => `qr_${id}` };
    if (request === '@/lib/retail-orders') return { ...ro, isStorefrontVisible: () => true };
    return prevLoad.call(this, request, ...rest);
  };
  const { POST: testOrder } = await import('../../src/app/api/retail/test-order/route');
  Mod._load = prevLoad;
  const made: any = await testOrder({ json: async () => ({ tenantId: 't1' }), headers: { get: () => null } } as any);
  const tOrder = (await db.doc(`${T}/retailOrders/${made.body.orderId}`).get()).data();
  const tl = tOrder?.lines?.[0];
  check('a test order’s item stands for the real product and carries its codes, but points at no real stock',
    made.body.ok && tl?.productId === 'test-gel' && tl?.testOfProductId === 'gel' && tl?.barcode === '012345678905' && tl?.sku === 'GEL-01' && tl?.caseBarcode === '10012345678902' && tOrder.isTest === true, tl);
  await db.doc(`${T}/retailOrders/${made.body.orderId}`).set({ stage: 'picking' }, { merge: true });
  let r: any = await recordItemScan(web as any, 't1', made.body.orderId, '012345678905', actor);
  check('packing the test order: scanning the real product’s barcode counts it', r.ok && r.lineId === 'line-test0' && /Gel polish/.test(r.name), r);
  check('…and no stock moved', (await db.doc(`${T}/inventory/gel`).get()).data().totalStock === 4);

  // ── Worked out from the products as they are now ──
  await fresh();
  await db.doc(`${T}/inventory/gel`).set({ ...gel });
  await db.doc(`${T}/retailOrders/o1`).set(order([line({ sku: '', barcode: '' })]));
  r = await recordItemScan(web as any, 't1', 'o1', 'GP-OLD', actor);
  check('a barcode added to the product after the order was placed scans (the order’s copy had none)', r.ok && r.lineId === 'A', r);
  const ev = (await db.collection(`${T}/retailOrders/o1/events`).get()).docs.map((d: any) => d.data());
  check('…and the timeline says it was matched by the product’s current codes', ev.some((e: any) => e.type === 'item_scanned' && e.meta?.matchedBy === 'product'), ev.map((e: any) => e.meta));

  // A parent's code (the shelf name), with the order holding one of its shades.
  await fresh();
  await db.doc(`${T}/inventory/lip`).set({ id: 'lip', name: 'Lip tint', barcode: '7700001', optionGroups: [{ id: 'g', name: 'Shade', choices: [{ id: 'c1', label: 'Rose', variantProductId: 'lip-rose' }, { id: 'c2', label: 'Coral', variantProductId: 'lip-coral' }] }] });
  await db.doc(`${T}/inventory/lip-rose`).set({ id: 'lip-rose', name: 'Lip tint Rose', sku: '' });
  await db.doc(`${T}/inventory/lip-coral`).set({ id: 'lip-coral', name: 'Lip tint Coral', sku: '' });
  const rose = line({ lineId: 'R', productId: 'lip-rose', sku: '', barcode: '', name: 'Lip tint', optionsLabel: 'Rose', qtyOrdered: 1 });
  let res: any = await resolveOrderScan(web as any, 't1', [rose] as any, '7700001');
  check('the parent product’s barcode, and the order has one of its shades: that shade', res.kind === 'line' && res.hint.lineId === 'R' && res.via === 'parent', res);
  const coral = line({ lineId: 'C', productId: 'lip-coral', sku: '', barcode: '', name: 'Lip tint', optionsLabel: 'Coral', qtyOrdered: 1 });
  res = await resolveOrderScan(web as any, 't1', [rose, coral] as any, '7700001');
  check('…two shades on the order: it asks for the shade’s own code instead of guessing',
    res.kind === 'choose' && /comes in options, and this order has 2 of them/.test(scanMissMessage(res, '7700001', [rose, coral] as any)), res);

  // A label printed from a duplicate of the product.
  await fresh();
  await db.doc(`${T}/inventory/gel`).set({ ...gel });
  await db.doc(`${T}/inventory/gel-copy`).set({ id: 'gel-copy', name: 'Gel polish', sku: 'GEL-01' });
  res = await resolveOrderScan(web as any, 't1', [line()] as any, 'clarityflow://product/gel-copy');
  check('a label printed from a duplicate of the product (same SKU) counts the order’s item', res.kind === 'line' && res.hint.lineId === 'A' && res.via === 'duplicate', res);

  // Not on the order.
  await db.doc(`${T}/inventory/top`).set({ id: 'top', name: 'Top coat', sku: 'TOP-1' });
  await db.doc(`${T}/retailOrders/o1`).set(order([line()]));
  r = await recordItemScan(web as any, 't1', 'o1', 'TOP-1', actor);
  check('another product’s code: it says which product it is, and what the order needs', !r.ok && r.miss === 'elsewhere' && /That’s Top coat, which isn’t on this order\. This order needs Gel polish\./.test(r.message), r);
  r = await recordItemScan(web as any, 't1', 'o1', '5550001', actor);
  check('a code no product has: it says so, and how to fix it', !r.ok && r.miss === 'unknown' && /No product has the code 5550001 yet/.test(r.message) && /add the code to it/.test(r.message), r);

  // The packer says which item it is: the code goes on that product.
  let lc = await learnCode(web as any, 't1', 'top', '5550001');
  check('adding a new code to a product with a SKU but no barcode makes it its barcode', lc.ok && (await db.doc(`${T}/inventory/top`).get()).data().barcode === '5550001', lc);
  lc = await learnCode(web as any, 't1', 'gel', '5550002');
  check('…a product that has a barcode keeps it and gets the new one as an extra code', lc.ok && (await db.doc(`${T}/inventory/gel`).get()).data().barcode === '012345678905' && (await db.doc(`${T}/inventory/gel`).get()).data().barcodes.includes('5550002'), lc);
  lc = await learnCode(web as any, 't1', 'gel', '5550001');
  check('…a code another product already has isn’t added twice', !lc.ok && /already on Top coat/.test(lc.message), lc);
  lc = await learnCode(web as any, 't1', 'test-gel', '5550009');
  check('…and nothing is added to a test item’s stand-in', !lc.ok);

  // The second scan at the box uses the same rules.
  await fresh();
  await db.doc(`${T}/inventory/gel`).set({ ...gel });
  await db.doc(`${T}/retailOrders/o1`).set(order([line({ sku: '', barcode: '', qtyScanned: 2, status: 'picked' })], { stage: 'packed' }));
  r = await recordPackScan(web as any, 't1', 'o1', '00012345678912', actor);
  check('the pack check at the box finds the item by its current codes too', r.ok && r.lineId === 'A', r);

  // ── The register uses the same codes ──
  const hit: any = identifyPosScan('00012345678912', { inventory: [{ ...gel, type: 'retail', msrp: 15 }], appointments: [], walkIns: [] });
  check('the register finds a product by its GTIN as packing does', hit.kind === 'product' && hit.item.id === 'gel', hit.kind);

  // ── The screens ──
  const src = (p: string) => fs.readFileSync(p, 'utf8');
  const add = src('src/components/inventory/AddProductDialog.tsx');
  check('adding a product keeps its SKU and its barcodes (the SKU used to be dropped)', /sku: String\(data\.sku\)\.trim\(\)/.test(add) && /\.\.\.\(barcode \? \{ barcode \} : \{\}\)/.test(add) && /<ProductCodesField \/>/.test(add));
  check('the product forms refuse a code another product already has', [add, src('src/components/inventory/EditProductDialog.tsx')].every((s) => /codeOwners\(/.test(s) && /That code belongs to another product/.test(s)));
  const pack = src('src/components/orders/workspace/PackPane.tsx');
  check('the packing screen names what was scanned from the answer, and offers to add a new code to an item', /after\(r, r\.name \|\| 'Item', r\.lineId \|\| ''/.test(pack) && /learnCode\(fs, tenantId, lineProductId\(l\), learn\)/.test(pack) && /Which item has the code/.test(pack));
  check('receiving, scan routing and waves read the same codes', /productMatch\(/.test(src('src/components/inventory/QuickReceiveDialog.tsx')) && /productMatch\(/.test(src('src/components/inventory/ReceiveStockDialog.tsx'))
    && /unitCodes\(i\)/.test(src('src/lib/scan-route.ts')) && /unitCodes\(i\)/.test(src('src/app/(app)/retail-orders/waves/page.tsx')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
