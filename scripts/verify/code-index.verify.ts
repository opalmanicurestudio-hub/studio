// Checks one set of codes (Phase A, round 1): every code a product carries is kept in one form (lib/code-form), on one
// product, in one index (lib/code-index), and a code that's taken is refused wherever it's given to a product:
//   - one form: spaces, quotes and letter case don't make two codes; a retail barcode is one number however it's
//     printed (UPC-A, EAN-13, GTIN-14); NP-000123 and AB-000123 are two codes; the shop's own labels are products;
//   - saving a product's codes: a code new to it that another product has is refused, naming that product, with
//     nothing written; archived, deleted and stale owners give a code up; a code shared from before isn't new, and
//     stays shared until someone chooses; two saves at once can't both take a code; two codes learned at once both stay;
//   - learning a scanned code, pairing a tag (never one a kit or bundle has, nor another product's code), keeping a
//     shared code on one product (it comes off the others' right fields), building the index (only changes written,
//     stale entries gone, lookalikes pointed out), and the four counts on the codes check, by the shop's own rules;
//   - the route (who may call it, what it answers), the screens (codes go through the server, the rest as before,
//     equipment whole), imports (matched by any code, indexed as they're added), and the database rules (a product's
//     code fields and the index can't be written from a browser).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/code-index.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let signedIn = true;
const actor = { uid: 'u1', name: 'Kai Park', role: 'staff', caps: [] };
// What a screen sends to the server and writes itself.
let apiCalls: any[] = []; let apiAnswer: any = { ok: true }; let browserWrites: any[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => (signedIn ? { ok: true, actor, tenant: {} } : { ok: false, status: 401, error: 'Please sign in again.' }) });
  if (request === '@/firebase') return { __esModule: true,
    setDocumentNonBlocking: (r: any, v: any) => browserWrites.push({ op: 'set', path: r.path, v: JSON.parse(JSON.stringify(v)) }),
    updateDocumentNonBlocking: (r: any, v: any) => browserWrites.push({ op: 'update', path: r.path, v: JSON.parse(JSON.stringify(v)) }) };
  if (request === 'firebase/firestore') return { __esModule: true, doc: (_fs: any, ...segs: string[]) => ({ path: segs.join('/') }) };
  if (request === '@/lib/codes-api' || /\/src\/lib\/codes-api(\.ts)?$/.test(request)) return fake(request, { __esModule: true,
    codesApi: async (b: any) => { apiCalls.push(b); return apiAnswer; },
    saveCodes: async (tenantId: string, productId: string, codes: any) => { apiCalls.push({ action: 'set', tenantId, productId, codes }); return apiAnswer; } });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const entries = async () => (await db.collection(`${T}/codeIndex`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) } }) as any;
const fresh = async () => { db = strictTransactions(makeDb()); signedIn = true; await db.doc(T).set({ name: 'Opal', userId: 'owner1' }); };
const put = (id: string, x: any) => db.doc(`${T}/inventory/${id}`).set({ id, type: 'retail', status: 'active', name: id, totalStock: 0, ...x });

(async () => {
  const cf = await import('../../src/lib/code-form');
  const ci = await import('../../src/lib/code-index');

  // ── One form ──
  check('spaces, quotes and letter case don’t make two codes', cf.codeForm('  hc-50 ') === 'HC-50' && cf.codeForm('"HC-50"') === 'HC-50' && cf.codeForm('hc - 50') === 'HC-50');
  const upc = cf.codeForm('012345678905');
  check('a retail barcode is one number however it’s printed: UPC-A, with spaces or dashes, as EAN-13, as GTIN-14',
    upc === '00012345678905' && cf.codeForm('0 12345 67890 5') === upc && cf.codeForm('0-12345-67890-5') === upc && cf.codeForm('0012345678905') === upc && cf.codeForm('00012345678905') === upc);
  check('…including a UPC-A typed without its small first digit', cf.codeForm('12345678905') === upc);
  check('…but a number that isn’t a valid barcode isn’t padded, and keeps its dashes (123456 and 0123456 are two codes, so are 1234-5678 and 12345678)',
    cf.codeForm('123456') !== cf.codeForm('0123456') && cf.codeForm('012345678900') === '012345678900' && cf.codeForm('1234-5678') === '1234-5678' && cf.codeForm('1234-5678') !== cf.codeForm('12345678'));
  check('NP-000123 and AB-000123 are two codes (only their digits used to be compared)', cf.codeForm('NP-000123') !== cf.codeForm('AB-000123') && cf.digitsKey('NP-000123') === cf.digitsKey('AB-000123'));
  const ro = await import('../../src/lib/retail-orders');
  const pcodes = await import('../../src/lib/product-codes');
  check('every scanner compares codes the same way: NP-000123 isn’t AB-000123, a UPC-A read as EAN-13 is the same, case and spaces don’t matter',
    !ro.codesMatch('NP-000123', 'AB-000123') && ro.codesMatch('012345678905', '0012345678905') && ro.codesMatch('gel 01', 'GEL01') && !ro.codesMatch('', '')
    && pcodes.productMatch({ id: 'np', sku: 'NP-000123' }, 'AB-000123') === null && pcodes.productMatch({ id: 'c', barcode: '012345678905' }, '0012345678905') === 'unit');
  check('…and a database lookup asks for every way a barcode may be written', ['012345678905', '0012345678905', '00012345678905'].every((f) => ro.codeVariants('0 12345 67890 5').has(f)));
  check('the shop’s product label and a shop link are read as the product, anything else as a code',
    JSON.stringify(cf.readCode('clarityflow://product/p_1')) === JSON.stringify({ kind: 'product', productId: 'p_1' })
    && JSON.stringify(cf.readCode('https://opal.example/shop/t1/product/p_2?x=1')) === JSON.stringify({ kind: 'product', productId: 'p_2' })
    && cf.readCode(' gel-01 ').kind === 'code' && cf.readCode('  ').kind === 'empty');
  check('a code Firestore can’t use as a document name is kept under a fixed hash of it',
    cf.codeDocId('HC-50') === 'HC-50' && /^h_[0-9a-f]{16}$/.test(cf.codeDocId('A/B')) && cf.codeDocId('A/B') === cf.codeDocId('A/B') && cf.codeDocId('A/B') !== cf.codeDocId('A/C') && cf.codeDocId('__X__').startsWith('h_'));
  const codes = cf.codesOf({ type: 'retail', sku: 'gel-1', barcode: '012345678905', upc: '12345678905', barcodes: ['0 12345 67890 5', 'GP-OLD'], caseBarcode: '10012345678902', casePack: 12, palletBarcode: 'pal-9', palletPack: 10, tagIds: ['04A2B3C4'] });
  check('a product’s codes: SKU, barcodes (one entry for one number), a case worth its units, a pallet its cases of units, tags',
    codes.map((c) => `${c.kind}:${c.code}:${c.pack}`).join(' ') === 'sku:GEL-1:1 unit:00012345678905:1 unit:GP-OLD:1 case:10012345678902:12 pallet:PAL-9:120 tag:04A2B3C4:1', codes);
  check('equipment and overhead items hold no scan codes (three dryers can share a model number)', cf.codesOf({ type: 'equipment', sku: 'DRY-1' }).length === 0 && cf.codesOf({ type: 'overhead', sku: 'X' }).length === 0);
  check('a SKU kept as a number and typed back as text is unchanged; a changed barcode is the only field sent',
    cf.changedCodes({ sku: 12345, barcode: 'A' }, { sku: '12345', barcode: 'A' }) === null && JSON.stringify(cf.changedCodes({ sku: 'S', barcode: 'A' }, { sku: 'S', barcode: 'B' })) === JSON.stringify({ barcode: 'B' }));
  const inv = [{ id: 'a', type: 'retail', name: 'Cedar candle', barcode: '012345678905' }, { id: 'b', type: 'retail', name: 'Old candle', barcode: '0 12345 67890 5', status: 'archived' }, { id: 'c', type: 'equipment', name: 'Dryer', sku: 'GEL-1' }];
  const cl = cf.codeClashes(inv, { id: 'n', sku: 'gel-1', barcode: '0012345678905' });
  check('the product form sees a code on another product in any form, but not on archived products or equipment', cl.length === 1 && cl[0].item.id === 'a' && cl[0].before === false, cl);
  check('…and tells a clash that was there before (both had it) from a new one', cf.codeClashes(inv, { id: 'x', barcode: '012345678905' }, { saved: { id: 'x', type: 'retail', barcode: '012345678905' } })[0]?.before === true);

  // ── Saving a product's codes ──
  await fresh();
  await put('a', { name: 'Cedar candle', barcode: '012345678905' }); await put('n', { name: 'New candle' });
  await ci.buildCodeIndex(db, 't1');
  let s: any = await ci.setProductCodes(db, 't1', 'n', { barcode: '0 12345 67890 5' }, { by: 'Kai' });
  check('a code another product has is refused, naming it', !s.ok && s.status === 409 && /012345678905|0 12345 67890 5/.test(s.error) && /Cedar candle/.test(s.error) && s.clashes[0].productId === 'a', s);
  check('…and nothing is written: not the product, not the index', !(await get(`${T}/inventory/n`)).barcode && (await entries()).length === 1 && (await entries())[0].productId === 'a');
  s = await ci.setProductCodes(db, 't1', 'n', { sku: 'nc-1', barcodes: ['NC-ALT'] }, { by: 'Kai' });
  const e1 = await entries();
  check('a free code is saved with its entry, which says what it is and whose', s.ok && (await get(`${T}/inventory/n`)).sku === 'nc-1' && e1.some((e: any) => e.id === 'NC-1' && e.productId === 'n' && e.kind === 'sku' && e.raw === 'nc-1') && e1.some((e: any) => e.code === 'NC-ALT' && e.kind === 'unit'), e1);
  s = await ci.setProductCodes(db, 't1', 'n', { barcodes: [] }, { by: 'Kai' });
  check('a code taken off a product frees its entry', s.ok && !(await entries()).some((e: any) => e.code === 'NC-ALT'));
  await db.doc(`${T}/inventory/a`).set({ status: 'archived' }, { merge: true });
  s = await ci.setProductCodes(db, 't1', 'n', { barcode: '012345678905' }, { by: 'Kai' });
  check('an archived product gives its code up', s.ok && (await get(`${T}/codeIndex/00012345678905`)).productId === 'n', s);
  await put('d', { name: 'Gone', sku: 'GONE-1' }); await ci.setProductCodes(db, 't1', 'd', {}, { by: 'Kai' }); await db.doc(`${T}/inventory/d`).delete();
  s = await ci.setProductCodes(db, 't1', 'n', { barcodes: ['gone-1'] }, { by: 'Kai' });
  check('…so does a deleted one', s.ok && (await get(`${T}/codeIndex/GONE-1`)).productId === 'n');
  await put('e', { name: 'Moved on', sku: 'OLD-SKU' }); await ci.setProductCodes(db, 't1', 'e', {}, { by: 'Kai' }); await db.doc(`${T}/inventory/e`).set({ sku: 'NEW-SKU' }, { merge: true });
  s = await ci.setProductCodes(db, 't1', 'n', { sku: 'old-sku' }, { by: 'Kai' });
  check('…and one that no longer carries it (an entry left behind)', s.ok && (await get(`${T}/codeIndex/OLD-SKU`)).productId === 'n');

  // A code on two products from before the index: shared until someone chooses.
  await fresh();
  await put('a', { name: 'Hand cream, 50 ml', caseBarcode: '10845013301211', casePack: 12 }); await put('b', { name: 'Hand cream, 30 ml', caseBarcode: '1 08 45013 30121 1', casePack: 6, sku: 'HC-30' });
  await put('c', { name: 'Rose cuticle oil', sku: 'ROSE-OIL' }); await put('v', { name: 'Blush', sku: 'rose-oil', barcode: '0084501330131' });
  await put('np', { name: 'Nail polish', sku: 'NP-000123' }); await put('ab', { name: 'Acrylic brush', sku: 'AB-000123' });
  let built: any = await ci.buildCodeIndex(db, 't1');
  const shared = await get(`${T}/codeIndex/10845013301211`); const st: any = await get(`${T}/private/codeIndex`);
  check('the index finds codes already on more than one product, and gives them to none', built.clashes === 2 && shared.clash === true && shared.productIds.join() === 'a,b' && st.clashCount === 2 && st.clashes.some((c: any) => c.code === 'ROSE-OIL' && c.owners.length === 2), { built, shared });
  check('…and points out codes only their digits used to tell apart', st.lookalikes.some((l: any) => [l.a, l.b].sort().join() === 'AB-000123,NP-000123'), st.lookalikes);
  built = await ci.buildCodeIndex(db, 't1');
  check('building again writes nothing when nothing changed', built.written === 0, built);
  s = await ci.setProductCodes(db, 't1', 'b', { sku: 'HC-30ML' }, { by: 'Kai' });
  check('a product with a shared code can still be saved (the shared code isn’t new to it), and stays shared', s.ok && (await get(`${T}/codeIndex/10845013301211`)).clash === true && !(await get(`${T}/codeIndex/HC-30`)) && (await get(`${T}/codeIndex/HC-30ML`)).productId === 'b', s);
  await put('z', { name: 'Third cream' });
  s = await ci.setProductCodes(db, 't1', 'z', { caseBarcode: '10845013301211', casePack: 12 }, { by: 'Kai' });
  check('…but no third product can take it', !s.ok && s.status === 409, s);
  let k: any = await ci.keepCodeOn(db, 't1', '1 08 45013 30121 1', 'a', 'Kai');
  const bAfter = await get(`${T}/inventory/b`); const keptEntry = await get(`${T}/codeIndex/10845013301211`);
  check('choosing which product keeps a shared code: it comes off the other’s case fields, and the entry is the keeper’s',
    k.ok && k.removedFrom.join() === 'Hand cream, 30 ml' && bAfter.caseBarcode === '' && bAfter.casePack === null && keptEntry.productId === 'a' && !keptEntry.clash && keptEntry.pack === 12, { k, bAfter, keptEntry });
  check('…and it leaves the list of shared codes', !(await get(`${T}/private/codeIndex`)).clashes.some((c: any) => c.code === '10845013301211'));
  k = await ci.keepCodeOn(db, 't1', 'ROSE-OIL', 'v', 'Kai');
  check('a listing and its variant sharing a SKU: kept on the variant, the listing’s SKU is cleared', k.ok && (await get(`${T}/inventory/c`)).sku === '' && (await get(`${T}/codeIndex/ROSE-OIL`)).productId === 'v');
  k = await ci.keepCodeOn(db, 't1', 'NOT-THERE', 'a', 'Kai');
  check('keeping a code on a product that doesn’t have it is refused', !k.ok && k.status === 409);
  // A barcode in a product's list of other barcodes comes off that list only.
  await put('p1', { name: 'One', barcode: 'MAIN-1', barcodes: ['SHARED-9', 'KEEP-2'] }); await put('p2', { name: 'Two', barcode: 'SHARED-9' });
  await ci.buildCodeIndex(db, 't1'); k = await ci.keepCodeOn(db, 't1', 'shared-9', 'p2', 'Kai');
  const p1 = await get(`${T}/inventory/p1`);
  check('…a shared code among a product’s other barcodes comes off that list only', k.ok && p1.barcode === 'MAIN-1' && p1.barcodes.join() === 'KEEP-2', p1);
  await put('p3', { name: 'Three', barcode: 'SOLE-1', barcodes: ['NEXT-2'] }); await put('p4', { name: 'Four', sku: 'SOLE-1' });
  await ci.buildCodeIndex(db, 't1'); k = await ci.keepCodeOn(db, 't1', 'SOLE-1', 'p4', 'Kai');
  const p3 = await get(`${T}/inventory/p3`);
  check('…and when it was the main barcode, the next one takes its place', k.ok && p3.barcode === 'NEXT-2' && p3.barcodes.length === 0, p3);

  // Archived products hold no codes; brought back, a product holds its codes again (shared if another took one).
  await put('arch', { name: 'Old cream', status: 'archived', sku: 'CREAM-1' }); await put('live', { name: 'New cream', sku: 'cream-1' });
  await ci.buildCodeIndex(db, 't1');
  check('an archived product doesn’t hold its codes in the index', (await get(`${T}/codeIndex/CREAM-1`)).productId === 'live' && !(await get(`${T}/codeIndex/CREAM-1`)).clash);
  s = await ci.setProductCodes(db, 't1', 'arch', { barcode: 'OLD-BAR' }, { by: 'Kai' });
  check('…saving it doesn’t put it back into the index', s.ok && !(await get(`${T}/codeIndex/CREAM-1`)).clash && !(await get(`${T}/codeIndex/OLD-BAR`)));
  await db.doc(`${T}/inventory/arch`).set({ status: 'active' }, { merge: true });
  await ci.reindexProducts(db, 't1', ['arch'], 'Kai');
  const back = await get(`${T}/codeIndex/CREAM-1`);
  check('…brought back from the archive, its code another product took meanwhile is listed as shared, and its free code is its own', back.clash === true && back.productIds.join() === 'arch,live' && (await get(`${T}/codeIndex/OLD-BAR`)).productId === 'arch', back);
  check('…a shared code names its products in one fixed order, so the next check has nothing to rewrite', (await ci.buildCodeIndex(db, 't1')).written === 0);
  await db.doc(`${T}/inventory/arch`).set({ status: 'archived' }, { merge: true });
  const la = await ci.learnCode(db, 't1', 'arch', 'cream-1', 'Kai');
  const lb = await ci.learnCode(db, 't1', 'arch', 'live-new', 'Kai');
  await put('live2', { name: 'Newest cream', sku: 'LIVE-2' }); await ci.buildCodeIndex(db, 't1');
  const lc2 = await ci.learnCode(db, 't1', 'arch', 'live-2', 'Kai');
  check('an archived product still can’t be given a code another product has (packing an order whose product was archived)', la.ok && /already on this product/.test(la.message) && lb.ok && !lc2.ok && /already on Newest cream/.test(lc2.message), { la, lb, lc2 });

  // Stale entries go; a product saved while the index was being built isn't lost.
  await db.doc(`${T}/codeIndex/LEFT-1`).set({ code: 'LEFT-1', productId: 'nobody' });
  await ci.buildCodeIndex(db, 't1');
  check('building the index removes entries no product carries', !(await get(`${T}/codeIndex/LEFT-1`)));
  // A save made while the check runs (after it read the products, before it read the index) isn't undone, so no
  // second product can take that code.
  await put('racer', { name: 'Racer' }); await put('second', { name: 'Second' });
  const realCollection = db.collection; let during: any = null;
  db.collection = (path: string) => { const c = realCollection(path); if (!path.endsWith('/codeIndex') || !during) return c;
    return { ...c, get: async () => { const f = during; during = null; await f(); return c.get(); } }; };
  during = () => ci.setProductCodes(db, 't1', 'racer', { sku: 'MID-1' }, { by: 'A' });
  await ci.buildCodeIndex(db, 't1');
  db.collection = realCollection;
  check('a code saved while the index is being built keeps its entry', (await get(`${T}/codeIndex/MID-1`))?.productId === 'racer');
  s = await ci.setProductCodes(db, 't1', 'second', { sku: 'mid-1' }, { by: 'B' });
  check('…so a second product can’t take it', !s.ok && s.status === 409, s);
  // An entry the check would hand to a product that gave the code up meanwhile is settled from the products as they are.
  await put('giver', { name: 'Giver', sku: 'MOVE-1' }); await put('taker', { name: 'Taker' }); await ci.buildCodeIndex(db, 't1');
  db.collection = (path: string) => { const c = realCollection(path); if (!path.endsWith('/codeIndex') || !during) return c;
    return { ...c, get: async () => { const f = during; during = null; await f(); return c.get(); } }; };
  during = async () => { await ci.setProductCodes(db, 't1', 'giver', { sku: '' }, { by: 'A' }); await ci.setProductCodes(db, 't1', 'taker', { sku: 'move-1' }, { by: 'B' }); };
  await db.doc(`${T}/codeIndex/MOVE-1`).set({ code: 'MOVE-1', productId: 'giver', raw: 'old', kind: 'sku', pack: 1 });
  await ci.buildCodeIndex(db, 't1');
  db.collection = realCollection;
  check('…and an entry is never handed back to a product that gave its code up while the check ran', (await get(`${T}/codeIndex/MOVE-1`))?.productId === 'taker', await get(`${T}/codeIndex/MOVE-1`));

  // Two saves at once: only one gets the code.
  await fresh(); await put('x', { name: 'X' }); await put('y', { name: 'Y' }); await ci.buildCodeIndex(db, 't1');
  const [rx, ry]: any[] = await Promise.all([ci.setProductCodes(db, 't1', 'x', { barcode: 'RACE-1' }, { by: 'A' }), ci.setProductCodes(db, 't1', 'y', { barcode: 'race-1' }, { by: 'B' })]);
  check('two saves at once can’t both take a code', [rx.ok, ry.ok].filter(Boolean).length === 1 && [(await get(`${T}/inventory/x`)).barcode, (await get(`${T}/inventory/y`)).barcode].filter(Boolean).length === 1, { rx, ry });
  // Two codes learned at once on one product both stay.
  await put('l', { name: 'Lip oil', barcode: 'LIP-1' });
  const [l1, l2] = await Promise.all([ci.learnCode(db, 't1', 'l', 'LIP-2', 'A'), ci.learnCode(db, 't1', 'l', 'LIP-3', 'B')]);
  const lip = await get(`${T}/inventory/l`);
  check('two codes learned at once on one product both stay', l1.ok && l2.ok && lip.barcodes.sort().join() === 'LIP-2,LIP-3', { l1, l2, lip });
  let lc = await ci.learnCode(db, 't1', 'l', 'lip-2', 'A');
  check('learning a code the product has says so', lc.ok && /already on this product/.test(lc.message));
  lc = await ci.learnCode(db, 't1', 'x', 'LIP-3', 'A');
  check('…one another product has is refused, naming it', !lc.ok && /already on Lip oil/.test(lc.message), lc);
  lc = await ci.learnCode(db, 't1', 'l', 'clarityflow://product/x', 'A');
  check('…the shop’s own label isn’t a code to learn', !lc.ok && /isn’t a barcode/.test(lc.message));
  await put('full', { name: 'Full', barcode: 'F0', barcodes: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'] });
  lc = await ci.learnCode(db, 't1', 'full', 'F11', 'A');
  check('…and with ten other barcodes already, it says to remove one first (none is silently dropped)', !lc.ok && /ten other barcodes/.test(lc.message) && !(await get(`${T}/inventory/full`)).barcodes.includes('F11'));
  await put('dryer', { type: 'equipment', name: 'Dryer' });
  lc = await ci.learnCode(db, 't1', 'dryer', 'DRY-9', 'A');
  check('…equipment doesn’t take scan codes', !lc.ok);

  // Tags.
  await db.doc(`${T}/kits/k1`).set({ name: 'Pedicure kit', code: 'K-01', status: 'ready', tagIds: ['04A2B3C4D5'] });
  let pt: any = await ci.pairTag(db, 't1', 'l', '04:a2:b3:c4:d5', 'A');
  check('a tag a kit has is refused for a product, naming the kit', !pt.ok && /Pedicure kit K-01/.test(pt.message), pt);
  pt = await ci.pairTag(db, 't1', 'l', '04-11-22-33-44', 'A');
  check('a free tag pairs to the product, kept in its reader’s form, with its entry', pt.ok && (await get(`${T}/inventory/l`)).tagIds.join() === '0411223344' && (await get(`${T}/codeIndex/0411223344`)).kind === 'tag', pt);
  pt = await ci.pairTag(db, 't1', 'x', '0411223344', 'A');
  check('…the same tag can’t go on a second product', !pt.ok && /already on Lip oil/.test(pt.message));
  pt = await ci.pairTag(db, 't1', 'x', 'lip-1', 'A');
  check('…nor can another product’s barcode be paired as a tag', !pt.ok);
  pt = await ci.pairTag(db, 't1', 'l', '0411223344', 'A', true);
  check('a tag taken off frees its entry', pt.ok && (await get(`${T}/inventory/l`)).tagIds.length === 0 && !(await get(`${T}/codeIndex/0411223344`)));

  // A new product added with its codes.
  s = await ci.setProductCodes(db, 't1', 'newp', { sku: 'NEW-9', barcode: 'NEWBAR-9' }, { by: 'A', create: { name: 'New lotion', type: 'retail', msrp: 12, sku: 'IGNORED', codesUpdatedAt: 'x' } });
  const np: any = await get(`${T}/inventory/newp`);
  check('a new product with codes is added with them, and its entries (code fields in the rest are ignored)', s.ok && np.name === 'New lotion' && np.sku === 'NEW-9' && np.id === 'newp' && np.codesUpdatedAt !== 'x' && (await get(`${T}/codeIndex/NEWBAR-9`)).productId === 'newp', np);
  s = await ci.setProductCodes(db, 't1', 'newq', { barcode: 'newbar-9' }, { by: 'A', create: { name: 'Copy', type: 'retail' } });
  check('…and one whose code is taken isn’t added at all', !s.ok && s.status === 409 && !(await get(`${T}/inventory/newq`)));
  s = await ci.setProductCodes(db, 't1', 'nobody', { sku: 'Q' }, { by: 'A' });
  check('codes for a product that isn’t there are refused', !s.ok && s.status === 404);

  // ── The four counts, by the shop's own rules ──
  await fresh();
  const listing = (id: string, x: any) => put(id, { showOnline: true, msrp: 24, ...x });
  await listing('oil', { name: 'Rose cuticle oil', totalStock: 0, optionGroups: [{ id: 'g', name: 'Variant', choices: [{ id: 'c1', label: 'Blush', deltaCents: 0, variantProductId: 'blush' }, { id: 'c2', label: 'Sheer gold', deltaCents: 0, variantProductId: 'gold' }] }] });
  await put('blush', { name: 'Blush', totalStock: 5, barcode: '0084501330131' }); await put('gold', { name: 'Sheer gold', totalStock: 0, showOnline: true, msrp: 28 });
  await listing('candle', { name: 'Cedar candle', totalStock: 3 });
  await listing('cream', { name: 'Hand cream', totalStock: 2, sku: 'HC-50' });
  await listing('mask', { name: 'Mask', totalStock: 0, optionGroups: [{ id: 'g', name: 'Size', choices: [{ id: 's', label: 'Small', deltaCents: 0, variantProductId: 'small' }] }], sku: 'MASK' });
  await put('small', { name: 'Small mask', totalStock: 4 });
  await put('hidden', { name: 'Hidden', totalStock: 0, showOnline: false });
  await listing('course', { name: 'Online course', digital: true, totalStock: 0 });
  const chk: any = await ci.codesCheck(db, 't1');
  // The shop's rules (lib/variants): a listing is in stock while a variant is, and a variant is never listed on its own,
  // so those two counts are at zero; the codes check still counts them from the same rules the shop uses.
  check('no listing shows sold out while a variant has stock (it’s in stock while any variant is)', chk.counts.soldOut === 0 && chk.soldOut.length === 0, chk.soldOut);
  check('in the shop with nothing to scan: a listing with no code, and each variant with none under a listing with none', chk.noCode.map((x: any) => x.name).sort().join('|') === 'Cedar candle|Rose cuticle oil · Sheer gold', chk.noCode);
  check('no variant shows as a listing of its own (it’s sold inside its listing)', chk.counts.variantsListed === 0, chk.variantsListed);
  check('the counts come from the shop’s own rules (the shop’s grid and product page use the same ones)',
    /listedInShop\(item, listings\)/.test(fs.readFileSync('src/app/api/retail/catalog/route.ts', 'utf8')) && /listingStock\(item, byId\)/.test(fs.readFileSync('src/app/api/retail/catalog/route.ts', 'utf8'))
    && /choiceFor\(parent, item\.id\)/.test(fs.readFileSync('src/app/api/retail/product/route.ts', 'utf8')) && /listingStock\(item, byId\)/.test(fs.readFileSync('src/app/api/retail/product/route.ts', 'utf8')));
  check('the check points each variant at its listing, and its codes’ entries name the listing',
    (await get(`${T}/inventory/blush`)).parentId === 'oil' && (await get(`${T}/inventory/gold`)).parentId === 'oil' && (await get(`${T}/inventory/small`)).parentId === 'mask'
    && !(await get(`${T}/inventory/candle`)).parentId && (await get(`${T}/codeIndex/0084501330131`))?.parentId === 'oil', [(await get(`${T}/inventory/blush`)).parentId, await get(`${T}/codeIndex/0084501330131`)]);

  // ── The route ──
  await fresh();
  await put('a', { name: 'Cedar candle', barcode: '012345678905' }); await put('b', { name: 'Other' });
  const { POST } = await import('../../src/app/api/inventory/codes/route');
  let r: any = await POST(req({ tenantId: 't1', action: 'set', productId: 'b', codes: { barcode: '0012345678905' } }));
  check('the route builds the index the first time, then refuses a taken code with the product it’s on', r.status === 409 && /Cedar candle/.test(r.body.error) && r.body.clashes[0].productId === 'a' && !!(await get(`${T}/private/codeIndex`))?.builtAt, r);
  r = await POST(req({ tenantId: 't1', action: 'set', productId: 'b', codes: { barcode: 'B-1' } }));
  check('…and saves a free one', r.status === 200 && r.body.ok && (await get(`${T}/inventory/b`)).barcode === 'B-1');
  r = await POST(req({ tenantId: 't1', action: 'learn', productId: 'b', code: 'B-2' }));
  check('learning a code through the route', r.status === 200 && /Added B-2 to Other/.test(r.body.message));
  r = await POST(req({ tenantId: 't1', action: 'tag', productId: 'b', tag: '0411223344' }));
  check('pairing a tag through the route', r.status === 200 && (await get(`${T}/inventory/b`)).tagIds.includes('0411223344'));
  r = await POST(req({ tenantId: 't1', action: 'check' }));
  check('the check through the route: counts, lists and whether the shop is on', r.status === 200 && r.body.counts && r.body.shop === true && typeof r.body.codes === 'number', r.body.counts);
  r = await POST(req({ tenantId: 't1', action: 'nope', productId: 'b' }));
  const r2: any = await POST(req({ tenantId: 't1', action: 'set' }));
  check('an unknown action, or no product, is turned away', r.status === 400 && r2.status === 400);
  signedIn = false; r = await POST(req({ tenantId: 't1', action: 'set', productId: 'b', codes: { barcode: 'X' } })); signedIn = true;
  check('…and so is anyone not signed in to the business', r.status === 401 && (await get(`${T}/inventory/b`)).barcode === 'B-1');
  (actor as any).isRenter = true;
  r = await POST(req({ tenantId: 't1', action: 'set', productId: 'b', codes: { barcode: 'X' } }));
  const rc: any = await POST(req({ tenantId: 't1', action: 'check' }));
  (actor as any).isRenter = false;
  check('…and a booth renter, who runs their own business, can’t change or list the shop’s products', r.status === 403 && rc.status === 403 && (await get(`${T}/inventory/b`)).barcode === 'B-1');
  r = await POST(req({ tenantId: 't1', action: 'set', productId: 'b', codes: { sku: 'B-SKU', tagIds: ['0499887766'] } }));
  check('tags aren’t set with the other codes (they’re paired one at a time, with the kit check)', r.status === 200 && (await get(`${T}/inventory/b`)).sku === 'B-SKU' && !(await get(`${T}/inventory/b`)).tagIds.includes('0499887766'));
  await db.doc(`${T}/inventory/a`).set({ status: 'archived' }, { merge: true }); await put('c2', { name: 'Took it', barcode: '012345678905' });
  await ci.setProductCodes(db, 't1', 'c2', {}, { by: 'Kai' });
  await db.doc(`${T}/inventory/a`).set({ status: 'active' }, { merge: true });
  r = await POST(req({ tenantId: 't1', action: 'reindex', productIds: ['a'] }));
  check('products brought back from the archive are indexed again through the route', r.status === 200 && r.body.products === 1 && (await get(`${T}/codeIndex/00012345678905`)).clash === true);

  // ── Screens: codes through the server, the rest as before, equipment whole ──
  const cc = await import('../../src/lib/codes-client');
  apiCalls = []; browserWrites = []; apiAnswer = { ok: true };
  let out: any = await cc.saveProduct({} as any, 't1', { id: 'p', type: 'retail', name: 'Gel', sku: 'G-1', barcode: 'A', msrp: 10 }, { id: 'p', type: 'retail', name: 'Gel polish', sku: 'G-1', barcode: 'B', msrp: 12, codesUpdatedAt: 'old' });
  check('saving an edited product: only its changed code goes to the server, then the rest is written without code fields',
    out.ok && apiCalls.length === 1 && JSON.stringify(apiCalls[0].codes) === JSON.stringify({ barcode: 'B' }) && browserWrites.length === 1 && browserWrites[0].v.name === 'Gel polish' && browserWrites[0].v.msrp === 12
    && !['sku', 'barcode', 'codesUpdatedAt'].some((f) => f in browserWrites[0].v), { apiCalls, browserWrites });
  apiCalls = []; browserWrites = []; apiAnswer = { ok: false, error: 'B is already on Gel top coat. A code can be on one product only.' };
  out = await cc.saveProduct({} as any, 't1', { id: 'p', type: 'retail', barcode: 'A' }, { id: 'p', type: 'retail', barcode: 'B', name: 'Changed' });
  check('…refused: nothing is written, and the reason comes back for the form', !out.ok && /Gel top coat/.test(out.error) && browserWrites.length === 0);
  apiCalls = []; browserWrites = []; apiAnswer = { ok: true };
  out = await cc.saveProduct({} as any, 't1', { id: 'p', type: 'retail', sku: 'S', barcode: 'A' }, { id: 'p', type: 'retail', sku: 'S', barcode: 'A', name: 'Price only', msrp: 9 });
  check('…a save that doesn’t change a code doesn’t ask the server', out.ok && apiCalls.length === 0 && browserWrites.length === 1 && !('sku' in browserWrites[0].v));
  apiCalls = []; browserWrites = [];
  out = await cc.saveProduct({} as any, 't1', { id: 'e', type: 'equipment', sku: 'DRY-1' }, { id: 'e', type: 'equipment', sku: 'DRY-2', name: 'Dryer' });
  check('…equipment is written whole, as always', out.ok && apiCalls.length === 0 && browserWrites[0].v.sku === 'DRY-2');
  apiCalls = []; browserWrites = [];
  out = await cc.addProduct({} as any, 't1', { id: 'n1', type: 'retail', name: 'Lotion', sku: 'L-1', barcode: '', batches: [] });
  check('adding a product with codes: the server adds it, with the rest of it (no code fields in the rest)', out.ok && apiCalls[0]?.action === 'set' && apiCalls[0].codes.sku === 'L-1' && apiCalls[0].create.name === 'Lotion' && !('sku' in apiCalls[0].create) && browserWrites.length === 0, apiCalls);
  apiCalls = []; browserWrites = [];
  out = await cc.addProduct({} as any, 't1', { id: 'n2', type: 'retail', name: 'No codes', sku: '', barcode: '' });
  check('…without codes it’s written here, with no empty code fields', out.ok && apiCalls.length === 0 && browserWrites[0].op === 'set' && !('sku' in browserWrites[0].v) && !('barcode' in browserWrites[0].v));

  const src = (p: string) => fs.readFileSync(p, 'utf8');
  const invPage = src('src/app/(app)/inventory/page.tsx');
  check('Inventory saves and adds products through the codes path (the form stays open when refused)', /await saveProduct\(firestore, tenantId, saved, updatedItem\)/.test(invPage) && /await addProduct\(firestore, tenantId, newProduct\)/.test(invPage) && !/updateDocumentNonBlocking\(itemDocRef, updatedItem\)/.test(invPage));
  check('…so does a product’s own page', /await saveProduct\(firestore, tenantId, product, updatedProduct\)/.test(src('src/app/(app)/inventory/(detail)/product/[id]/page.tsx')));
  check('…compared with the product as the form opened it, so a code learned or paired since isn’t put back', /const saved = editingItem && editingItem\.id === updatedItem\.id \? editingItem/.test(invPage));
  check('…products brought back from the archive are indexed again, all of them (a hundred at a time)', /batch\.commit\(\)\.then\(async \(\) => \{ for \(let i = 0; i < ids\.length; i \+= 100\) await reindexCodes\(tenantId, ids\.slice\(i, i \+ 100\)\); \}\)/.test(invPage));
  check('a SKU kept as a number loads into the edit form as text (or the save would silently do nothing)', /sku: \(product as any\)\.sku == null \? '' : String\(\(product as any\)\.sku\)/.test(src('src/components/inventory/EditProductDialog.tsx')));
  check('the product forms wait for the save and close only when it worked', /const ok = await onProductUpdated\(/.test(src('src/components/inventory/EditProductDialog.tsx')) && /if \(ok !== false\) onOpenChange\(false\)/.test(src('src/components/inventory/EditProductDialog.tsx'))
    && /ok = await onProductAdded\(/.test(src('src/components/inventory/AddProductDialog.tsx')) && /if \(ok !== false\) onOpenChange\(false\)/.test(src('src/components/inventory/AddProductDialog.tsx')));
  const shopSettings = src('src/app/(app)/retail-orders/settings/page.tsx');
  const settingsWrite = shopSettings.slice(shopSettings.indexOf('await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/inventory`, it.id), {\n        wholesalePriceDollars'), shopSettings.indexOf("// What's saved is what the draft starts from now."));
  check('Shop settings saves case and pallet codes through the server, and no longer writes them itself', /await saveCodes\(tenantId, it\.id, codes\)/.test(shopSettings) && settingsWrite.length > 100 && !/caseBarcode|palletBarcode|casePack|palletPack/.test(settingsWrite));
  check('…only the ones changed in its draft (a code changed elsewhere since isn’t put back)', /changedCodes\(d\.codesBase \|\| it,/.test(shopSettings) && /codesBase: \{ casePack: it\.casePack \?\? null/.test(shopSettings));
  check('a code learned at packing goes through the server', /learnProductCode\(tenantId, productId, code\)/.test(src('src/lib/scan-resolve.ts')) && !/updateDoc\(/.test(src('src/lib/scan-resolve.ts')));
  const tagSrc = src('src/components/pos/desk/TagPairing.tsx');
  check('a product’s tag is paired through the server; a kit’s or bundle’s tag can’t be another product’s code', /pairProductTag\(tenantId, item\.id, tag\)/.test(tagSrc) && /pairProductTag\(tenantId, item\.id, tag, true\)/.test(tagSrc) && /codesOf\(p\)\.some\(\(c\) => c\.code === codeForm\(tag\)\)/.test(tagSrc));
  check('receiving no longer promises to save a scanned barcode it never saved', !/capturedBarcode/.test(src('src/components/inventory/ReceiveStockDialog.tsx')) && !/saved to the item automatically/.test(src('src/components/inventory/ReceiveStockDialog.tsx')));
  check('the codes check page is in the menu', /href: '\/inventory\/codes'/.test(src('src/components/shared/AppSidebar.tsx')) && fs.existsSync('src/app/(app)/inventory/codes/page.tsx'));
  const page = src('src/app/(app)/inventory/codes/page.tsx');
  check('the codes check page says variants, never shades, and has no comments in its markup', !/shade/i.test(page) && /Variants listed on their own/.test(page) && !/\{\/\*/.test(page));
  check('…says when a check fails over lists already shown, and drops one business’s lists when another is chosen', /if \(shown\.current\) setToast\(r\.error\)/.test(page) && /if \(forTenant\.current !== tenantId\) return;/.test(page) && /setData\(null\); shown\.current = false;/.test(page));

  // ── Imports: matched by any code, indexed as they're added ──
  await fresh();
  await put('gel', { name: 'Gel polish', barcode: '012345678905' }); await ci.buildCodeIndex(db, 't1');
  const { POST: IMPORT } = await import('../../src/app/api/import/route');
  actor.role = 'manager';
  r = await IMPORT(req({ tenantId: 't1', action: 'save', kind: 'products', importId: 'imp1', rows: [{ name: 'Gel Polish 15ml', sku: '0 12345 67890 5' }, { name: 'Base coat', sku: 'BC-1' }, { name: 'Base coat copy', sku: 'bc-1' }] }));
  const prods = (await db.collection(`${T}/inventory`).get()).docs.map((d: any) => d.data());
  const bc = prods.filter((p: any) => String(p.sku || '').toUpperCase() === 'BC-1');
  check('an imported row whose code a product has (in any form) fills that product in, not a second one', r.status === 200 && prods.length === 2 && (await get(`${T}/inventory/gel`)).sku === '0 12345 67890 5', { body: r.body, n: prods.length });
  check('…a new product’s code is indexed as it’s added, and a second row with it matches the first', bc.length === 1 && (await get(`${T}/codeIndex/BC-1`))?.productId === bc[0].id, bc);
  await fresh();
  await put('g1', { name: 'Gel polish' }); await put('g2', { name: 'Gel polish', barcode: 'B-123' }); await ci.buildCodeIndex(db, 't1');
  r = await IMPORT(req({ tenantId: 't1', action: 'save', kind: 'products', importId: 'imp2', rows: [{ name: 'Top coat', sku: 'b-123' }] }));
  check('…a code on a product that shares its name with another is still found (never given to a new product)', r.status === 200 && (await db.collection(`${T}/inventory`).get()).docs.length === 2 && (await get(`${T}/codeIndex/B-123`)).productId === 'g2', r.body);
  actor.role = 'staff';

  const ciSrc = src('src/lib/code-index.ts');
  check('building the index reads a hundred entries, and their products, in one step each (the first build of a big shop stays quick)', /i \+= 100\) \{ const r = await settleEntries\(db, tenantId, differ\.slice\(i, i \+ 100\), by\)/.test(ciSrc) && /if \(typeof tx\.getAll === 'function'\) return tx\.getAll\(\.\.\.refs\);/.test(ciSrc) && (ciSrc.match(/await readAll\(tx,/g) || []).length >= 5);

  // ── The database rules ──
  const rules = src('firestore.rules');
  const invRule = rules.slice(rules.indexOf('match /tenants/{tenantId}/inventory/{itemId}'), rules.indexOf('match /tenants/{tenantId}/codeIndex/{codeId}'));
  check('a browser can’t change a product’s code fields, nor any item’s choices or listing (equipment and overhead keep their codes, and carry none and no choices when turned into a product), nor add an item with choices or a product with codes',
    /allow update: if isTeam\(tenantId\) && !request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(productLinkKeys\(\)\) && \(\s*\(codesFree\(resource\.data\) && codesFree\(request\.resource\.data\)\)\s*\|\| \(!codesFree\(resource\.data\) && !request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(productCodeKeys\(\)\)\)\s*\|\| \(codesFree\(resource\.data\) && !codesFree\(request\.resource\.data\) && noCodes\(request\.resource\.data\) && noLinks\(request\.resource\.data\)\)\);/.test(invRule)
    && /allow create: if isTeam\(tenantId\) && noLinks\(request\.resource\.data\) && \(codesFree\(request\.resource\.data\) \|\| noCodes\(request\.resource\.data\)\)/.test(invRule)
    && /function productLinkKeys\(\) \{\s*return \['optionGroups', 'parentId'\];/.test(rules)
    && ['sku', 'barcode', 'barcodes', 'upc', 'gtin', 'ean', 'caseBarcode', 'casePack', 'palletBarcode', 'palletPack', 'tagIds', 'codesUpdatedAt'].every((f) => new RegExp(`'${f}'`).test(rules.slice(rules.indexOf('function productCodeKeys'), rules.indexOf('function codesFree')))), invRule.slice(0, 400));
  check('the index is read by the team and written only by the server', /match \/tenants\/\{tenantId\}\/codeIndex\/\{codeId\} \{\s*allow read: if isTeam\(tenantId\);\s*allow write: if false;/.test(rules));
  const catchAll = rules.slice(rules.indexOf('match /tenants/{tenantId}/{collection}/{rest=**}'));
  check('…and the catch-all rule no longer opens either of them', /'inventory', 'codeIndex',/.test(catchAll.slice(0, catchAll.indexOf(']);'))));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
