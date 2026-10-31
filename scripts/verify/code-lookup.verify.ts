// Checks one lookup for every scanner (Phase A, round 2, lib/code-lookup): a scan is the shop's label or link, any
// code a product carries in its one form (a case's code worth its units, a pallet's its cases of units, a tag however
// its reader types it), or a product's id; a listing's own code asks which variant (or picks the one variant on the
// order or delivery); a code two products share asks which one; archived products hold no codes. Then each scanner:
// the desk (a case asks "add 12 or just one", a shared code asks which product), the scan sheet and kits (tools'
// SKUs too), picking waves (a case puts the case, never more than the tote needs), packing and the staff app, returns,
// receiving and quick receive, bins, distribution, the orders board and Inventory's scan button and search; the
// cameras read case carton codes; a scanner typing into the desk's search adds the item once.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/code-lookup.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
const docRef = (path: string) => ({ __doc: true, path, id: path.split('/').pop() });
const colRef = (path: string) => ({ __col: true, path });
const web: any = {
  collection: (_fs: any, ...segs: string[]) => colRef(segs.join('/')),
  doc: (base: any, ...segs: string[]) => (base?.__col ? docRef(`${base.path}/${segs[0]}`) : docRef(segs.join('/'))),
  runTransaction: (_fs: any, fn: any) => db.runTransaction(() => fn({
    get: async (r: any) => { const s = await db.doc(r.path).get(); return { exists: () => s.exists, data: () => s.data(), id: s.id }; },
    update: (r: any, v: any) => db.doc(r.path).update(v), set: (r: any, v: any, o?: any) => db.doc(r.path).set(v, o),
  })),
};
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase/firestore') return web;
  return load.call(this, request, ...rest);
};

(async () => {
  const L = await import('../../src/lib/code-lookup');
  const items = [
    { id: 'oil', type: 'retail', name: 'Rose cuticle oil', sku: 'ROSE-OIL', optionGroups: [{ id: 'g', name: 'Variant', choices: [{ id: 'a', label: 'Blush', variantProductId: 'blush' }, { id: 'b', label: 'Sheer gold', variantProductId: 'gold' }] }] },
    { id: 'blush', type: 'retail', name: 'Blush', barcode: '0 84501 33013 1', caseBarcode: '10845013301301', casePack: 12, palletBarcode: 'PAL-B', palletPack: 10 },
    { id: 'gold', type: 'retail', name: 'Sheer gold', barcode: '084501330155' },
    { id: 'candle', type: 'retail', name: 'Cedar candle', barcode: '012345678905', tagIds: ['04A2B3C4D5'] },
    { id: 'old', type: 'retail', name: 'Old candle', barcode: '012345678905', status: 'archived' },
    { id: 'np', type: 'retail', name: 'Nail polish', sku: 'NP-000123' }, { id: 'ab', type: 'retail', name: 'Acrylic brush', sku: 'AB-000123' },
    { id: 'c1', type: 'retail', name: 'Hand cream 50', sku: 'HC' }, { id: 'c2', type: 'retail', name: 'Hand cream 30', sku: 'hc' },
    { id: 'dryer', type: 'equipment', name: 'Dryer', sku: 'DRY-1' },
  ];
  const book = L.codeBook(items);
  let f: any = L.lookupCode(book, 'clarityflow://product/candle');
  check('the shop’s label finds its product', f.kind === 'product' && f.item.id === 'candle' && f.via === 'label');
  f = L.lookupCode(book, 'https://opal.example/shop/t1/product/candle');
  check('…and so does a link to it in the shop', f.kind === 'product' && f.item.id === 'candle');
  f = L.lookupCode(book, '0012345678905');
  check('a barcode in any form (here EAN-13 with a leading 0) finds its product, never an archived one', f.kind === 'product' && f.item.id === 'candle' && f.pack === 1, f);
  f = L.lookupCode(book, '04:a2:b3:c4:d5');
  check('a tag typed by a reader with colons between its bytes finds its product', f.kind === 'product' && f.item.id === 'candle' && f.via === 'tag', f);
  f = L.lookupCode(book, '1 08 45013 30130 1');
  check('a case’s code finds its variant, worth the case', f.kind === 'product' && f.item.id === 'blush' && f.pack === 12 && f.via === 'case' && L.packWords(f) === 'a case of 12', f);
  f = L.lookupCode(book, 'pal-b');
  check('a pallet’s code is worth its cases of units', f.kind === 'product' && f.pack === 120 && L.packWords(f) === 'a pallet of 120', f);
  f = L.lookupCode(book, 'rose-oil');
  check('a listing’s own code asks which variant', f.kind === 'choose' && f.listing.id === 'oil' && f.variants.map((v: any) => v.id).join() === 'blush,gold', f);
  f = L.lookupCode(book, 'ROSE-OIL', { variants: false });
  check('…or gives the listing itself, for a screen that opens it', f.kind === 'product' && f.item.id === 'oil');
  f = L.lookupCode(book, 'AB-000123');
  check('NP-000123 and AB-000123 are two products’ codes', f.kind === 'product' && f.item.id === 'ab');
  f = L.lookupCode(book, 'HC');
  check('a code two products share asks which one', f.kind === 'clash' && f.items.map((i: any) => i.id).sort().join() === 'c1,c2');
  check('a product’s id typed in finds it', (L.lookupCode(book, 'gold') as any).item?.id === 'gold' && (L.lookupCode(book, 'gold') as any).via === 'id');
  check('…a code no product has is none; equipment’s codes count only when asked for (kits)', L.lookupCode(book, 'NOPE-1').kind === 'none' && L.lookupCode(book, 'DRY-1').kind === 'none' && (L.lookupCode(L.codeBook(items, { equipment: true }), 'DRY-1') as any).item?.id === 'dryer');
  const nums = L.codeBook([{ id: 'n1', type: 'retail', name: 'Spreadsheet SKU', sku: '000123456' }, { id: 'n2', type: 'retail', name: 'Dashed', barcode: '4006-3812' }, { id: 'n3', type: 'retail', name: 'Twin A', sku: '0099887765' }, { id: 'n4', type: 'retail', name: 'Twin B', sku: '99887765' }, ...items]);
  check('a number written another way (leading zeros a spreadsheet dropped, dashes) still finds the one product with it',
    (L.lookupCode(nums, '123456') as any).item?.id === 'n1' && (L.lookupCode(nums, '40063812') as any).item?.id === 'n2');
  check('…but never guesses between two products with that number, and never mixes up codes with letters', L.lookupCode(nums, '00099887765').kind === 'none' && L.lookupCode(nums, '000123').kind === 'none' && (L.lookupCode(nums, 'NP-000123') as any).item?.id === 'np');
  const ro = await import('../../src/lib/retail-orders');
  check('the database lookup also asks for a UPC-A stored without its small first digit', ro.codeVariants('012345678905').has('12345678905'));
  const lines = [{ lineId: 'A', productId: 'gold' }, { lineId: 'B', productId: 'candle' }];
  check('with an order in front: a listing’s code is its one variant on the order', L.pickFor(L.lookupCode(book, 'ROSE-OIL'), lines, (l) => l.productId).pick?.lineId === 'A');
  check('…two of its variants on the order: it asks (no pick)', L.pickFor(L.lookupCode(book, 'ROSE-OIL'), [...lines, { lineId: 'C', productId: 'blush' }], (l) => l.productId).pick === null);
  check('…a shared code picks the one of its products on the order', L.pickFor(L.lookupCode(book, 'HC'), [{ lineId: 'X', productId: 'c2' }], (l) => l.productId).pick?.lineId === 'X');

  // ── The desk ──
  const ps = await import('../../src/lib/pos-scan');
  const inv = items.map((i) => ({ ...i, msrp: 10 }));
  let h: any = ps.identifyPosScan('10845013301301', { inventory: inv, appointments: [], walkIns: [] });
  check('the desk: a case’s code is the product, worth the case (it asks: add 12 or just one)', h.kind === 'product' && h.item.id === 'blush' && h.pack === 12 && h.packKind === 'case', h);
  h = ps.identifyPosScan('ROSE-OIL', { inventory: inv, appointments: [], walkIns: [] });
  check('…a listing’s code asks which variant', h.kind === 'choose' && h.variants.length === 2);
  h = ps.identifyPosScan('hc', { inventory: inv, appointments: [], walkIns: [] });
  check('…a shared code asks which product', h.kind === 'clash' && h.items.length === 2);
  h = ps.identifyPosScan('XQ12ZZ', { inventory: inv, appointments: [{ id: 'ap', shortCode: 'XQ12ZZ' }], walkIns: [] });
  check('…anything else is a ticket, as before', h.kind === 'ticket' && h.record.id === 'ap');
  // A code that's exactly an item the desk doesn't sell is that item: never a product with a similar number or a code
  // that differs by a dash.
  const shelf = [
    { id: 'A', type: 'retail', name: 'Retail cream', sku: '000123456', msrp: 20 },
    { id: 'B', type: 'professional', name: 'Backbar cream', barcode: '123456' },
    { id: 'X', type: 'retail', status: 'archived', name: 'Old toner', barcode: '7654321', msrp: 9 },
    { id: 'Y', type: 'retail', name: 'New toner', sku: '0007654321', msrp: 12 },
    { id: 'H', type: 'retail', name: 'Hand cream 50', sku: 'HC50', msrp: 15 },
    { id: 'G', type: 'professional', name: 'Nitrile gloves', barcode: 'HC-50' },
    { id: 'L', type: 'retail', name: 'Rose oil', sku: 'ROSE', msrp: 20, optionGroups: [{ id: 'g', name: 'Size', choices: [{ id: 'a', label: '15 ml', variantProductId: 'V1' }] }] },
    { id: 'V1', type: 'retail', status: 'archived', name: 'Rose oil 15 ml', barcode: 'R15' },
  ];
  const at = (code: string) => ps.identifyPosScan(code, { inventory: shelf, appointments: [], walkIns: [] }) as any;
  check('…a backbar product’s barcode says what it is (it used to add the retail product whose SKU has the same digits)', at('123456').kind === 'unsold' && /That’s Backbar cream, which isn’t sold at the desk/.test(at('123456').text), at('123456'));
  check('…an archived product’s barcode says it’s archived (it used to add a different, active one)', at('7654321').kind === 'unsold' && /Old toner, which is archived/.test(at('7654321').text), at('7654321'));
  check('…gloves’ barcode HC-50 is the gloves, never the hand cream HC50', at('HC-50').kind === 'unsold' && /Nitrile gloves/.test(at('HC-50').text) && (L.lookupCode(L.codeBook(shelf.filter((i) => i.id !== 'G')), 'HC-50').kind === 'none'), at('HC-50'));
  check('…a listing with no variants to sell says so (it used to be added as itself)', at('ROSE').kind === 'unsold' && /Rose oil has no variants to sell yet/.test(at('ROSE').text), at('ROSE'));
  const lamp = [...shelf, { id: 'LED', type: 'equipment', name: 'LED lamp', msrp: 89, barcode: 'LED-89' }];
  const atLamp = (code: string) => ps.identifyPosScan(code, { inventory: lamp, appointments: [], walkIns: [] }) as any;
  check('…an item the desk sells by its price (an LED lamp marked as equipment) is added by its barcode or label, as its catalog tile adds it', atLamp('LED-89').kind === 'product' && atLamp('clarityflow://product/LED').kind === 'product', atLamp('LED-89'));
  check('…and the same digits written another way never guess between an item it sells and one it doesn’t', at('0123456').kind === 'lookup', at('0123456'));
  const digits = L.codeBook([{ id: 'A', type: 'retail', name: 'Retail cream', sku: '000123456' }]);
  check('…(a number with its leading zeros dropped, when it’s the only item with that number)', (L.lookupCode(digits, '123456') as any).item?.id === 'A');
  check('a product’s id in other capitals finds it, when only one product has it (a scanner set to capitals)', (L.lookupCode(book, 'GOLD') as any).item?.id === 'gold' && (L.lookupCode(book, 'clarityflow://product/CANDLE') as any).item?.id === 'candle');
  const shared: any = L.lookupCode(L.codeBook([{ id: 't1', type: 'retail', name: 'One', tagIds: ['04A2B3C4D5'] }, { id: 't2', type: 'retail', name: 'Two', tagIds: ['04A2B3C4D5'] }]), '04:a2:b3:c4:d5');
  check('a shared tag read with colons gives the code as products keep it (Inventory searches for that)', shared.kind === 'clash' && shared.code === '04A2B3C4D5', shared);
  check('Inventory’s scan button searches a shared code as products keep it, and shows an archived product in the archive', /setSearchTerm\(found\.kind === 'clash' \? found\.code : String\(data\)\.trim\(\)\)/.test(fs.readFileSync('src/app/(app)/inventory/page.tsx', 'utf8')) && /setShowArchived\(true\); setSearchTerm\(String\(found\.owner\.id\)\)/.test(fs.readFileSync('src/app/(app)/inventory/page.tsx', 'utf8')));
  const engine = fs.readFileSync('src/components/pos/usePosEngine.tsx', 'utf8'); const desk = fs.readFileSync('src/components/pos/desk/DeskPOS.tsx', 'utf8');
  check('…the desk asks “Add 12” or “Just one” for a case, and which product for a shared code', /if \(hit\.pack > 1\) \{ setPackChoice\(/.test(engine) && /hit\.kind === 'clash'\) \{ setVariantChoice\(\{ parent: \{ name: 'product' \}, variants: hit\.items, clash: true \}\)/.test(engine)
    && /Add \{e\.packChoice\.pack\}/.test(desk) && />Just one</.test(desk) && /Which product is it\?/.test(desk));
  check('…and adds that many at once', /const handleAddToCart = useCallback\(\(item: any, qty = 1\)/.test(engine) && /e\.addProductChecked\?\.\(c\.item, c\.pack\)/.test(desk));
  check('…one scan does one thing at the desk: the desk’s products and tickets, or the kit scanner for a kit, bundle, steriliser or station (it used to do both)',
    /const scanner = useScanSheet\(false\);/.test(desk) && /if \(hit\.kind !== 'lookup' && hit\.kind !== 'empty' && hit\.kind !== 'unsold'\) \{ e\.handlePosScan\?\.\(code\); return; \}/.test(desk) && /scanner\.openWith\(code\); return; \}/.test(desk)
    && /useWedge\(openWith, listen && !open, 'background'\);/.test(fs.readFileSync('src/components/pos/desk/ScanSheet.tsx', 'utf8')));
  const cat = fs.readFileSync('src/components/pos/PosCatalog.tsx', 'utf8');
  check('a handheld scanner typing into the desk’s search adds the item once (the desk’s listener already heard it)', /const heard = e\.nativeEvent\.defaultPrevented; e\.preventDefault\(\); if \(heard\) \{ setQ\(''\); return; \} submit\(\);/.test(cat));
  const posPage = fs.readFileSync('src/app/(app)/pos/page.tsx', 'utf8');
  check('the desk’s camera for products reads every barcode, not only QR codes', /<ScanGate cameraFirst label="Point at a barcode or QR code" onScan=\{\(raw\) => \{ setIsCameraScanOpen\(false\);/.test(posPage) && /if \(window\.dispatchEvent\(ev\)\) \(__engine as any\)\.handlePosScan\(raw\);/.test(posPage));
  check('the cameras read case carton codes (ITF-14)', /Html5QrcodeSupportedFormats\.ITF,/.test(fs.readFileSync('src/components/retail/ScanGate.tsx', 'utf8')));

  // ── The scan sheet and kits ──
  const sr = await import('../../src/lib/scan-route');
  let route: any = sr.routeScan('0 12345 67890 5', { inventory: items });
  check('the scan sheet finds a product by any form of its code', route.target === 'product' && route.id === 'candle');
  route = sr.routeScan('HC', { inventory: items });
  check('…and says when a code is on two products', route.target === 'unknown' && /on 2 products/.test(route.label));
  const kits = await import('../../src/lib/kits');
  check('kits find tools by their SKU, products by any code, and fall back to a name', kits.matchInventory(items, 'dry-1')?.id === 'dryer' && kits.matchInventory(items, '012345678905')?.id === 'candle' && kits.matchInventory(items, 'Sheer gold')?.id === 'gold');

  // ── Picking waves ──
  const W = await import('../../src/lib/waves');
  const rows: any[] = [{ productId: 'blush', name: 'Blush', location: 'A1', totalQty: 17, totes: [{ tote: 1, qty: 12 }, { tote: 2, qty: 5 }] }, { productId: 'candle', name: 'Cedar candle', location: 'B2', totalQty: 1, totes: [{ tote: 2, qty: 1 }] }];
  let m: any = W.matchWaveItem(rows, '10845013301301', book);
  check('a wave: a case’s code finds its row, worth the case', m?.productId === 'blush' && m.units === 12, m);
  m = W.matchWaveItem(rows, 'ROSE-OIL', book);
  check('…a listing’s code finds its one variant on the list', m?.productId === 'blush' && m.units === 1);
  let put: any = W.wavePut(rows, {}, 1, '10845013301301', book);
  check('…a case put in a tote that needs it all counts the case', put.ok && put.units === 12 && put.putInTote === 12 && put.toteDone === true, put);
  put = W.wavePut(rows, {}, 2, '10845013301301', book);
  check('…a case is never put in a tote that needs fewer than it holds (it says how many to put in)', !put.ok && put.reason === 'case_too_big' && /case of 12, and tote 2 needs 5 more Blush/.test(put.message), put);
  put = W.wavePut(rows, { '1': { blush: 4 } }, 1, '084501330131', book);
  check('…one unit is one', put.ok && put.units === 1 && put.putInTote === 5);
  const both: any[] = [{ productId: 'blush', name: 'Blush', location: 'A1', totalQty: 1, totes: [{ tote: 1, qty: 1 }] }, { productId: 'gold', name: 'Sheer gold', location: 'A2', totalQty: 1, totes: [{ tote: 2, qty: 1 }] }];
  put = W.wavePut(both, {}, 1, 'ROSE-OIL', book);
  check('…a listing’s own code with two of its variants on the list asks which (it used to say “not on this list”)', !put.ok && put.reason === 'which_one' && /Rose cuticle oil’s own code, and this pick list has 2 of its variants: Blush and Sheer gold/.test(put.message), put);
  check('…before a tote is chosen too', /its variants/.test(W.waveItem(both, 'ROSE-OIL', book).ask) && /const \{ row: matched, ask \} = waveItem\(rows, value, codesFor\);/.test(fs.readFileSync('src/app/(app)/retail-orders/waves/page.tsx', 'utf8')));
  db = makeDb(); await db.doc('tenants/t1/waves/w1').set({ scannedByTote: { '1': { blush: 4 } }, scanned: { blush: 4 }, pickedBy: {} });
  await W.recordWavePut({} as any, 't1', 'w1', 1, 'blush', 10, 15, { id: 'k', name: 'Kai' }, 12);
  const wave: any = (await db.doc('tenants/t1/waves/w1').get()).data();
  check('…and the record counts the units, capped at what the tote needs (two pickers at once)', wave.scannedByTote['1'].blush === 10 && wave.scanned.blush === 10 && wave.pickedBy.k.items === 6, wave);

  // ── Every other scanner asks the same lookup ──
  const src = (p: string) => fs.readFileSync(p, 'utf8');
  const returnsPage = src('src/components/orders/ReturnSheet.tsx'); const receive = src('src/components/inventory/ReceiveStockDialog.tsx');
  check('returns: the codes the line was sold with, then the products’ codes now (a listing’s code is its variant on the return; with two of them, it asks which)', /lineMatchesScan\(x\.orig, t\)/.test(returnsPage) && /const picked = pickFor\(found, open, \(x: any\) => lineProductId\(x\.orig\)\);/.test(returnsPage) && /askWhich\(found, picked, \(x: any\) => lineProductId\(x\.orig\)/.test(returnsPage) && /'this return'\);/.test(returnsPage));
  check('receiving: the one lookup with tools and supplies too, a case counts the case, a listing’s code is its variant on the delivery (with two, it asks), a name typed in finds its line',
    /codeBook\(items, \{ equipment: true \}\)/.test(receive) && /const picked = pickFor\(found, lines, \(ri\) => ri\.productId\);/.test(receive) && /'this delivery'\);/.test(receive) && /codeForm\(ri\.productName\) === name/.test(receive) && /role="status"/.test(receive) && /Counts as \{ask\.pack\}/.test(receive));
  check('…and scanning a line counts it from zero (a line starts at what was ordered: scanning all 6 used to show 12)', /const now = \(countedRef\.current\.has\(productId\) \? ri\.quantityReceived : 0\) \+ units;/.test(receive) && /countedRef\.current = new Set\(\); setCountedState\(new Set\(\)\);/.test(receive));
  check('…but a count typed in is kept: a scan after it adds to it', /if \(field === 'quantityReceived'\) markCounted\(\[productId\]\);/.test(receive));
  check('quick receive: a case counts the case, a listing’s code names its variants', /addItem\(found\.item, true, found\.pack\)/.test(src('src/components/inventory/QuickReceiveDialog.tsx')) && /Tap the variant you received in the list/.test(src('src/components/inventory/QuickReceiveDialog.tsx')));
  check('bins and distribution: the one lookup, knowing every item’s codes, saying when a code is shared or is another item’s',
    /codeBook\(inventory \|\| \[\], \{ only: shelfProduct \}\)/.test(src('src/components/orders/BinsScreen.tsx')) && /lookupCode\(book, raw, \{ variants: false \}\)/.test(src('src/components/orders/BinsScreen.tsx'))
    && /lookupCode\(trackableBook, raw, \{ variants: false \}\)/.test(src('src/app/(app)/inventory/distribution/page.tsx')) && /distribute\(firestore as Firestore, tenantId, item\.id, holder, found\.pack, actor\)/.test(src('src/app/(app)/inventory/distribution/page.tsx')));
  check('the orders board: a listing’s code finds its variants on waiting orders', /found\.kind === 'choose' \? found\.variants\.map/.test(src('src/components/orders/OrdersApp.tsx')));
  check('the staff app: a waiting order is found by every code its lines carry', /\(o\.lines \|\| \[\]\)\.some\(\(l: any\) => lineMatchesScan\(l, raw\)\)/.test(src('src/components/fulfilment/FulfilmentPanel.tsx')));
  const invPage = src('src/app/(app)/inventory/page.tsx');
  check('Inventory’s scan button takes every barcode (it used to refuse anything but the shop’s QR), and its search finds a code in any form',
    /const found = lookupCode\(book, data, \{ variants: false \}\);/.test(invPage) && !/Invalid QR Code/.test(invPage) && /<ScanGate cameraFirst label="Point at a barcode or QR code" onScan=\{handleScan\} \/>/.test(invPage) && /codesOf\(\{ \.\.\.item, type: 'retail' \}\)\.some\(\(c\) => c\.code === asCode\)/.test(invPage));
  check('no scanner compares only a product’s barcode and SKU any more', !/codesMatch\(i\.barcode, v\)|codesMatch\(String\(i\.barcode/.test(src('src/components/orders/BinsScreen.tsx') + src('src/app/(app)/inventory/distribution/page.tsx')) && !/codesMatch\(orig\.barcode/.test(src('src/components/orders/ReturnSheet.tsx')));
  const page = src('src/app/(app)/inventory/codes/page.tsx');
  check('the codes check shows every scanner taking the same codes', /const SCANNERS = \['Desk and counter', 'Packing bench', 'Picking', 'Returns', 'Receiving stock', 'Inventory', 'Staff app'\];/.test(page) && !/\{\/\*/.test(page));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
