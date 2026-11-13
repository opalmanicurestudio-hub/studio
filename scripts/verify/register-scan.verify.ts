// Checks THE REGISTER SCANS WHAT HAS A BARCODE (lib/register-scan, components/pos):
//   - a product with a barcode (the maker's, or the shop's own label printed from the app) is added at the register by
//     its scan; services, listings (each color asks for its own scan), downloads, gift cards and products with nothing
//     to scan stay a tap; a shop can turn it off;
//   - the code scanned or typed decides what's added: the product tapped, or the one actually scanned; a listing's code,
//     an archived product's code, a typed id or an unknown code adds nothing, and says why;
//   - an item that won't scan is added on a manager's PIN with a reason (api/approvals, kept in the audit log);
//   - printing a product's label from the app marks it as having a barcode; Setup lists products with no barcode yet
//     and prints their labels.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/register-scan.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';

const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const R = await import('../../src/lib/register-scan');
  const P = await import('../../src/lib/pos-scan');
  const inv = [
    { id: 'gel', name: 'Gel color, Rosewood 121', type: 'retail', status: 'active', barcode: '012345678905', totalStock: 8 },
    { id: 'gel2', name: 'Gel color, Blush 140', type: 'retail', status: 'active', upc: '012345678912', totalStock: 3 },
    { id: 'oil', name: 'Cuticle oil', type: 'retail', status: 'active', sku: 'OIL-1', totalStock: 5 },
    { id: 'file', name: 'Nail file', type: 'retail', status: 'active', sku: 'FILE-2', labelPrintedAt: '2026-11-13T10:00:00Z', totalStock: 20 },
    { id: 'tips', name: 'Nail tips', type: 'retail', status: 'active', totalStock: 2 },
    { id: 'kit', name: 'Polish', type: 'retail', status: 'active', sku: 'POL', optionGroups: [{ name: 'Color', choices: [{ label: 'Red', variantProductId: 'pr' }, { label: 'Nude', variantProductId: 'pn' }] }] },
    { id: 'pr', name: 'Polish, Red', type: 'retail', status: 'active', parentId: 'kit', barcode: '000000111111', totalStock: 4 },
    { id: 'pn', name: 'Polish, Nude', type: 'retail', status: 'active', parentId: 'kit', barcode: '000000222222', totalStock: 4 },
    { id: 'old', name: 'Old lamp', type: 'retail', status: 'archived', barcode: '099999999999' },
    { id: 'guide', name: 'Nail art guide', type: 'retail', status: 'active', digital: true, msrp: 12 },
  ];
  const by = (id: string) => inv.find((i) => i.id === id);
  const book = P.deskBook(inv);

  // ── What has a barcode ──
  check('a maker’s barcode counts, whichever field it’s in', R.hasBarcode(by('gel')) && R.hasBarcode(by('gel2')) && R.hasBarcode({ ean: '4006381333931' }) && R.hasBarcode({ gtin: '00012345678905' }) && R.hasBarcode({ barcodes: ['', '123456789012'] }));
  check('a label printed from the app counts; a SKU alone, or nothing, doesn’t', R.hasBarcode(by('file')) && !R.hasBarcode(by('oil')) && !R.hasBarcode(by('tips')) && !R.hasBarcode(null) && !R.hasBarcode({ barcode: '  ' }));
  check('the register asks for the scan of a product with a barcode, on unless the shop turned it off',
    R.mustScanAtRegister(by('gel'), {}) && R.mustScanAtRegister(by('file'), {}) && !R.mustScanAtRegister(by('gel'), { scanAtRegister: false }) && R.registerScanOn({}) && !R.registerScanOn({ scanAtRegister: false }));
  check('…not for a listing (each color asks for its own), a download, a gift card, or a product with nothing to scan',
    !R.mustScanAtRegister(by('kit'), {}) && R.mustScanAtRegister(by('pr'), {}) && !R.mustScanAtRegister({ ...by('gel'), digital: true }, {}) && !R.mustScanAtRegister({ ...by('gel'), giftCard: true }, {}) && !R.mustScanAtRegister(by('oil'), {}) && !R.mustScanAtRegister(by('tips'), {}));

  // ── What a scan adds ──
  const m = (raw: string, tapped: string, typed = false) => R.registerMatch(book, raw, by(tapped), { typed }) as any;
  check('scanning the product tapped adds it', m('012345678905', 'gel').kind === 'same' && m('012345678905', 'gel').item.id === 'gel');
  check('scanning another product adds the one scanned (it’s the one in their hand)', m('012345678912', 'gel').kind === 'other' && m('012345678912', 'gel').item.id === 'gel2');
  check('the wrong color of the same listing is caught: the scanned color is added', m('000000222222', 'pr').kind === 'other' && m('000000222222', 'pr').item.id === 'pn');
  check('the number typed as printed adds it, leading zeros or not', m('012345678905', 'gel', true).kind === 'same' && m('12345678905', 'gel', true).kind === 'same');
  check('the shop’s own label (its QR code) scans as the product', m('clarityflow://product/file', 'file').kind === 'same');
  check('…a printed label’s SKU too', m('FILE-2', 'file').kind === 'same');
  check('a listing’s own code can’t say which color is in their hand, so it adds nothing', m('POL', 'pr').kind === 'none' && m('POL', 'pr').message === 'That’s the code for Polish, not one color. Scan the barcode on the item itself.', m('POL', 'pr'));
  check('an archived product’s code adds nothing, and says which product it is', m('099999999999', 'gel').kind === 'none' && /Old lamp/.test(m('099999999999', 'gel').message));
  check('a code that isn’t on a product adds nothing', m('5555', 'gel').kind === 'none' && /isn’t on a product/.test(m('5555', 'gel').message) && /number isn’t on a product/.test(m('5555', 'gel', true).message));
  check('a product’s id typed in isn’t a scan', m('clarityflow://product/gel', 'gel', true).kind === 'none');
  const cased = P.deskBook([...inv, { id: 'cot', name: 'Cotton rounds', type: 'retail', status: 'active', barcode: '011111111111', caseBarcode: '022222222222', casePack: 12, totalStock: 40 }]);
  check('a case’s code doesn’t stand in for one item’s scan', (R.registerMatch(cased, '022222222222', { id: 'cot' }) as any).kind === 'none' && /code on a case/.test((R.registerMatch(cased, '022222222222', { id: 'cot' }) as any).message) && (R.registerMatch(cased, '011111111111', { id: 'cot' }) as any).kind === 'same');

  // ── No barcode yet ──
  const bare = R.noBarcodeYet(inv, P.isSellable).map((i: any) => i.id).sort();
  check('products with no barcode yet: sold, not a listing, not a download, no label printed', JSON.stringify(bare) === JSON.stringify(['oil', 'tips']), bare);

  // ── The screens ──
  const cat = src('src/components/pos/PosCatalog.tsx');
  check('the register’s tiles, colors and search all go through the scan rule', (cat.match(/\badd\((i|v|only)\)/g) || []).length >= 3 && /if \(dept === 'products' && mustScanAtRegister\(i, rs\)\) \{ setScanFor\(i\); return; \}/.test(cat) && !/onClick=\{\(\) => onAdd\(/.test(cat) && /<RegisterScanSheet /.test(cat));
  const engine = src('src/components/pos/usePosEngine.tsx');
  check('a listing’s code scanned at the register offers only the colors with nothing to scan', /const tappable = hit\.variants\.filter\(\(v: any\) => !mustScanAtRegister\(v, /.test(engine) && /setVariantChoice\(\{ parent: hit\.parent, variants: tappable \}\)/.test(engine));
  const sheet = src('src/components/pos/RegisterScanSheet.tsx');
  check('an item that won’t scan is added on a manager’s PIN, checked on the server with a reason', /approveWithPin\(tenantId, pin, \{ kind: 'item_without_scan', ref: id, reason: `\$\{label\}: \$\{reason\}` \}\)/.test(sheet) && /APPROVE_REASONS\.map/.test(sheet));
  check('…which the audit log words', /item_without_scan: 'add an item at the register without scanning it'/.test(src('src/app/api/approvals/route.ts')));
  const hub = src('src/components/pos/CheckoutHub.tsx');
  check('one more of a product with a barcode, from the cart, is scanned too', /onClick=\{\(\) => oneMore\(item\)\}/.test(hub) && /mustScanAtRegister\(inv, \(selectedTenant as any\)\?\.retailSettings\)\) \{ setScanMore\(/.test(hub) && /<RegisterScanSheet /.test(hub) && !/onClick=\{\(\) => handleUpdateQuantity\(item\.id, item\.quantity \+ 1\)\}/.test(hub));
  check('an approval rides on its cart line and goes with the sale', /noScan: \[\.\.\.\(\(i as any\)\.noScan \|\| \[\]\), \.\.\.ns\]/.test(engine) && /noScan: retailItems\.flatMap\(/.test(engine) && /onAdd=\{\(i: any, ns\?: any\) => e\.addProductChecked\(i, 1, ns\)\}/.test(src('src/components/pos/desk/Counter.tsx')) && /onAdd=\{\(i: any, ns\?: any\) => onAddItem\(i, 1, ns\)\}/.test(hub));
  const done = src('src/app/api/checkout/complete/route.ts');
  check('…where the server keeps who and why on that item’s sale, for an approval of that item only',
    /a\.kind !== 'item_without_scan' \|\| a\.ref !== pid/.test(done) && /addedWithoutScan: noScanBy\[String\(it\.id\)\]/.test(done));
  check('…each marked used in the same write as the sale, so a sale that stops first leaves it for the retry, and it’s never on two sales',
    /const batch = db\.batch\(\);\n  for \(const r of noScanRefs\) batch\.update\(r, \{ used: true/.test(done) && /a\.used \|\|/.test(done));
  check('one more from the cart says when a different item was scanned', /if \(a\.note\) toast\(\{ title: 'A different item was scanned', description: a\.note \}\)/.test(hub));
  check('the old retail register sends people to the desk', /redirect\('\/pos'\)/.test(src('src/app/(app)/retail/page.tsx')) && !/'use client'/.test(src('src/app/(app)/retail/page.tsx')));
  const labels = src('src/app/(app)/inventory/labels/page.tsx');
  check('printing labels (or the PDF) marks the products as having a barcode', /b\.update\(doc\(firestore, `tenants\/\$\{tenantId\}\/inventory`, id\), \{ labelPrintedAt: at \}\)/.test(labels) && (labels.match(/void markPrinted\(\);/g) || []).length === 2);
  check('…a field a browser may write (it isn’t one of a product’s codes)', !/function productCodeKeys\(\) \{[^}]*labelPrintedAt/.test(src('firestore.rules')));
  const setup = src('src/components/orders/SetupScreen.tsx');
  check('Setup: the register switch, and the products with no barcode yet with their labels to print', /'retailSettings\.scanAtRegister': !regOn/.test(setup) && /noBarcodeYet\(inventory \|\| \[\], isSellable\)/.test(setup) && /\/inventory\/labels\?ids=\$\{bare\.slice\(0, 200\)/.test(setup));
  for (const [name, text] of [['scan sheet', sheet], ['register rules', src('src/lib/register-scan.ts')]] as [string, string][]) {
    check(`the ${name} has no all-caps, no heavy weight, no business words and the real apostrophe`, !/\buppercase\b|font-black/.test(text) && !/\b(studio|salon|stylist|booth|chair)\b/i.test(text.replace(/\/\/.*$/gm, ''))
      && !/[a-z]'[a-z]/i.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, '')));
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
