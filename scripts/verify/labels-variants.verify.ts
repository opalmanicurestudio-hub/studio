// Checks Phase A, round 4: product labels, adding a variant from the product's page, and a new code at a scanner.
//   - labels: what each label says (a variant as its listing, its own price or the listing's, the barcode it carries or
//     its SKU), where each goes on a sheet (a used sheet starts at the first free label), how many copies, and the PDF:
//     at the labels' real size, its barcodes and QR codes read back by a scanner;
//   - the labels route: who may call it, what it refuses (too many, nothing chosen, renters), archived products left
//     out, label designs fetched only from the app's own file storage;
//   - adding a variant: a product of its own, in the listing's variants, its codes refused when another product has one
//     (with nothing left behind), a second variant of the same name refused, the listing's price used when it has none;
//   - the screens: the product page opens on its overview (codes a tab away), the labels page prints what it previews, receiving and
//     packing say what to do with a code no product has, and the words are the app's (variants, never shades).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/labels-variants.verify.ts
import Module from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let signedIn = true;
const actor: any = { uid: 'u1', name: 'Kai Park', role: 'staff', caps: [] };
let fetched: string[] = [];
class FakeResponse { status: number; body: any; headers: any; constructor(body: any, init?: any) { this.body = body; this.status = init?.status || 200; this.headers = init?.headers || {}; }
  static json(body: any, init?: any) { return new FakeResponse(body, init); } }
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: FakeResponse };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => (signedIn ? { ok: true, actor, tenant: {} } : { ok: false, status: 401, error: 'Please sign in again.' }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async (u: string) => { fetched.push(String(u)); throw new Error('offline'); };

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) } }) as any;
const fresh = async () => { db = strictTransactions(makeDb()); signedIn = true; actor.isRenter = false; await db.doc(T).set({ name: 'Opal', userId: 'owner1' }); };
const put = (id: string, x: any) => db.doc(`${T}/inventory/${id}`).set({ id, type: 'retail', status: 'active', name: id, totalStock: 0, ...x });
const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const pl = await import('../../src/lib/product-labels');
  const { labelsPdf } = await import('../../src/lib/labels-pdf');
  const ci = await import('../../src/lib/code-index');

  // ── What a label says ──
  const oil = { id: 'oil', name: 'Rose cuticle oil', type: 'retail', status: 'active', msrp: 18, optionGroups: [{ id: 'g', name: 'Variant', choices: [{ id: 'c1', label: 'Blush', deltaCents: 0, variantProductId: 'blush' }, { id: 'c2', label: 'Coral', deltaCents: 0, variantProductId: 'coral' }] }] };
  const blush = { id: 'blush', name: 'Rose cuticle oil · Blush', type: 'retail', status: 'active', parentId: 'oil', barcode: '012345678905', size: 15, unit: 'ml' };
  const coral = { id: 'coral', name: 'Coral', type: 'retail', status: 'active', parentId: 'oil', msrp: 20, sku: 'RCO-CORAL' };
  const listings = new Map<string, any>([['blush', oil], ['coral', oil]]);
  const b = pl.labelContent(blush, listings); const c = pl.labelContent(coral, listings);
  check('a variant’s label is named as its listing, with the variant and its size under it', b.name === 'Rose cuticle oil' && b.sub === 'Blush · 15 ml' && c.sub === 'Coral', { b, c });
  check('…its own price when it has one, otherwise the listing’s', b.price === '$18.00' && c.price === '$20.00', { b: b.price, c: c.price });
  check('…the barcode it carries (a UPC as a UPC), or its SKU when it has no barcode', b.code?.format === 'UPC' && b.code?.from === 'barcode' && c.code?.format === 'CODE128' && c.code?.value === 'RCO-CORAL', { b: b.code, c: c.code });
  check('…and the QR code is the product, read by the app’s own scanner', b.qr === 'clarityflow://product/blush');
  const bare = pl.labelContent({ id: 'x', name: 'Nail file' }, new Map());
  check('a product with no code or price says so in the list', /QR code only/.test(pl.labelNote(bare, pl.SHOW_ALL)) && /No price yet/.test(pl.labelNote(bare, pl.SHOW_ALL)) && pl.labelNote(b, pl.SHOW_ALL) === '');
  check('a barcode that isn’t a valid retail number is printed as it is (Code 128), never changed', pl.retailBarcode('012345678900') === null && pl.labelCode({ barcode: '012345678900' })?.format === 'CODE128');
  check('a name too long for the label is cut short with an ellipsis, never over its edge', (() => { const t = pl.fitText('A very long product name that never ends at all, honestly', 8, 500, 80); return t.endsWith('…') && pl.textWidth(t, 8, 500) <= 80; })());

  // ── Where each goes ──
  const sheet = pl.LAYOUTS.sheet;
  check('a letter sheet holds 30 labels, 2⅝ by 1 inch', pl.perPage(sheet) === 30 && sheet.labelW === 189 && sheet.labelH === 72 && sheet.pageW === 612 && sheet.pageH === 792);
  const at = pl.placeLabels(sheet, 5, 28);
  check('a sheet used before starts at the first free label, and the rest go on a new sheet', at[0].page === 0 && at[1].page === 0 && at[2].page === 1 && at[2].x === sheet.left && at[2].y === sheet.top, at);
  check('a roll is one label a page, and “start at” doesn’t apply to it', pl.placeLabels(pl.LAYOUTS.roll, 3, 7).map((p) => p.page).join() === '0,1,2');
  check('copies are one label each, in the list’s order, never more than 600', pl.expandCopies([{ qty: 2, id: 'a' }, { qty: 1, id: 'b' }] as any).map((r: any) => r.id).join() === 'a,a,b' && pl.expandCopies([{ qty: 999 }, { qty: 999 }]).length === 600);
  const rows = pl.labelRowsFromLink(new URLSearchParams('ids=oil,x'), [oil, blush, coral, { id: 'x', name: 'File', status: 'active' }]);
  check('a link to a listing’s labels is a label for each of its variants', rows.map((r) => r.productId).join() === 'blush,coral,x', rows);
  for (const size of ['sheet', 'roll'] as const) {
    const layout = pl.LAYOUTS[size];
    const ok = [b, c].every((x) => pl.drawLabel(x, layout).marks.every((m: any) => m.t === 'text' ? m.x >= 0 && m.y <= layout.labelH : m.t === 'bars' ? m.x + m.bits.length * m.module <= layout.labelW && m.y + m.h <= layout.labelH : m.x + m.side <= layout.labelW && m.y + m.side <= layout.labelH));
    check(`everything on a ${size} label stays inside it`, ok);
  }

  // ── The PDF, read back by a scanner ──
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labels-'));
  const pdf = await labelsPdf([{ content: b }, { content: c }], 'sheet', pl.SHOW_ALL, 0);
  fs.writeFileSync(path.join(dir, 'l.pdf'), pdf);
  let decoded: string[] = [];
  try {
    execFileSync('pdftoppm', ['-r', '300', '-png', '-f', '1', '-l', '1', path.join(dir, 'l.pdf'), path.join(dir, 'p')]);
    const png = fs.readdirSync(dir).find((f) => f.endsWith('.png'))!;
    decoded = execFileSync('python3', ['-I', '-c', 'import sys,zxingcpp\nfrom PIL import Image\nfor r in zxingcpp.read_barcodes(Image.open(sys.argv[1])): print(r.text)', path.join(dir, png)]).toString().trim().split('\n');
  } catch (e: any) { decoded = [`(couldn’t read: ${e?.message || e})`]; }
  const cf = await import('../../src/lib/code-form');
  // A scanner may read a UPC as the same number with a 0 in front (EAN-13): one code (lib/code-form).
  check('the PDF’s barcodes and QR codes read back as the products’ codes',
    decoded.some((d) => cf.codeForm(d) === cf.codeForm('012345678905')) && decoded.includes('RCO-CORAL') && decoded.includes('clarityflow://product/blush') && decoded.includes('clarityflow://product/coral'), decoded);
  let fonts = ''; try { fonts = execFileSync('pdffonts', [path.join(dir, 'l.pdf')]).toString(); } catch { /* none */ }
  const fontRows = fonts.split('\n').slice(2).filter((l) => l.trim());
  check('…in the app’s typeface, embedded', fontRows.length > 0 && fontRows.every((l) => /^PlusJakartaSans-/.test(l) && /\syes\s/.test(l)), fonts);

  // ── The labels route ──
  const { POST: LABELS } = await import('../../src/app/api/inventory/labels/route');
  await fresh();
  await put('oil', oil); await put('blush', blush); await put('coral', coral); await put('old', { name: 'Old polish', status: 'archived', barcode: '036000291452' });
  await put('art', { name: 'Art', barcode: '4006381333931', labelImageUrl: 'https://evil.example.com/a.png' });
  let r: any = await LABELS(req({ tenantId: 't1', size: 'sheet', rows: [{ productId: 'blush', qty: 2 }, { productId: 'old', qty: 3 }] }));
  check('the route makes the PDF the page previews, archived products left out', r.status === 200 && r.headers['Content-Type'] === 'application/pdf' && r.headers['X-Label-Count'] === '2', { status: r.status, h: r.headers, body: r.body });
  r = await LABELS(req({ tenantId: 't1', rows: [{ productId: 'blush', qty: 601 }] }));
  check('…refuses more than 600 labels at once, saying to print them in parts', r.status === 400 && /in parts/.test(r.body.error));
  r = await LABELS(req({ tenantId: 't1', rows: [] }));
  check('…and asks for a label when none is chosen', r.status === 400 && /at least one/.test(r.body.error));
  fetched = [];
  r = await LABELS(req({ tenantId: 't1', design: true, rows: [{ productId: 'art', qty: 1 }] }));
  check('a label design is fetched only from the app’s own file storage', r.status === 200 && fetched.length === 0, fetched);
  actor.isRenter = true;
  r = await LABELS(req({ tenantId: 't1', rows: [{ productId: 'blush', qty: 1 }] }));
  check('booth renters can’t print the shop’s labels', r.status === 403);
  actor.isRenter = false; signedIn = false;
  r = await LABELS(req({ tenantId: 't1', rows: [{ productId: 'blush', qty: 1 }] }));
  check('…nor anyone signed out', r.status === 401);

  // ── Adding a variant ──
  await fresh();
  await put('oil', { ...oil, costPerUnit: 4, category: 'Care', size: 15, unit: 'ml' }); await put('blush', blush); await put('coral', coral);
  await put('gel', { name: 'Gel polish', barcode: '036000291452' });
  await ci.buildCodeIndex(db, 't1');
  const { POST: CODES } = await import('../../src/app/api/inventory/codes/route');
  const cf2 = await import('../../src/lib/code-form');
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'oil', variant: { label: 'Mauve', barcode: '0 71249 60302 6', stock: 6 } }));
  const made = r.body.productId ? await get(`${T}/inventory/${r.body.productId}`) : null;
  const oilNow = await get(`${T}/inventory/oil`);
  check('a variant added on the product’s page is a product of its own, named as its listing, in the listing’s variants',
    r.status === 200 && made?.name === 'Rose cuticle oil · Mauve' && made?.parentId === 'oil' && oilNow.optionGroups[0].choices.length === 3 && oilNow.optionGroups[0].choices[2].variantProductId === r.body.productId, { body: r.body, made });
  check('…with its stock, the listing’s cost, category and size, and no price of its own (so it sells at the listing’s)',
    made?.totalStock === 6 && made?.batches?.[0]?.costPerUnit === 4 && made?.category === 'Care' && made?.size === 15 && made?.msrp === undefined, made);
  check('…and its barcode in the index, so every scanner knows it', (await get(`${T}/codeIndex/${cf2.codeDocId(cf2.codeForm('0 71249 60302 6'))}`))?.productId === r.body.productId);
  const count = async () => (await db.collection(`${T}/inventory`).get()).docs.length;
  const before = await count();
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'oil', variant: { label: 'Nude', barcode: '036000291452' } }));
  check('a barcode another product has is refused, naming it, and nothing is left behind', r.status === 409 && /Gel polish/.test(JSON.stringify(r.body)) && (await count()) === before && (await get(`${T}/inventory/oil`)).optionGroups[0].choices.length === 3, r.body);
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'oil', variant: { label: 'blush' } }));
  check('a second variant of the same name is refused', r.status === 409 && /already has a variant called blush/.test(r.body.error) && (await count()) === before);
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'blush', variant: { label: 'Deep' } }));
  check('a variant can’t have variants of its own', r.status === 409 && (await count()) === before, r.body);
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'oil', variant: { label: 'Peach', price: '22' } }));
  check('a variant given a price keeps it', r.status === 200 && (await get(`${T}/inventory/${r.body.productId}`))?.msrp === 22);
  // Two at once: both kept, neither overwrites the other.
  const [x1, x2] = await Promise.all([
    CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'oil', variant: { label: 'Lilac' } })),
    CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'oil', variant: { label: 'Sage' } }))]) as any[];
  const labels = (await get(`${T}/inventory/oil`)).optionGroups[0].choices.map((ch: any) => ch.label);
  check('two variants added at once are both kept', x1.status === 200 && x2.status === 200 && labels.includes('Lilac') && labels.includes('Sage'), labels);
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'gel', variant: { label: 'Red' } }));
  check('a product with no variants yet gets a variants group with the first one', r.status === 200 && (await get(`${T}/inventory/gel`)).optionGroups?.[0]?.choices?.[0]?.label === 'Red');

  // ── What the review found ──
  await fresh();
  const forty = Array.from({ length: 40 }, (_, k) => ({ id: `c${k}`, label: `V${k}`, deltaCents: 0, variantProductId: `v${k}` }));
  await put('big', { name: 'Big', optionGroups: [{ id: 'g', name: 'Variant', choices: forty }] });
  for (let k = 0; k < 40; k++) await put(`v${k}`, { name: `V${k}`, parentId: 'big' });
  await ci.buildCodeIndex(db, 't1');
  const n0 = await count();
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'big', variant: { label: 'Extra', barcode: '0 71249 60302 6' } }));
  check('a listing with as many variants as it can hold refuses another, saying so, with nothing made (it used to say added and leave a loose product)', r.status === 409 && /as many variants/.test(r.body.error) && (await count()) === n0 && !(await get(`${T}/codeIndex/${cf2.codeDocId(cf2.codeForm('0 71249 60302 6'))}`)), r.body);
  await put('six', { name: 'Six', optionGroups: Array.from({ length: 6 }, (_, k) => ({ id: `g${k}`, name: `Extra ${k}`, choices: [{ id: 'a', label: 'Wrap', deltaCents: 100 }] })) });
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'six', variant: { label: 'Blue' } }));
  check('…and so does one with all its groups taken and no variants group', r.status === 409 && (await count()) === n0 + 1, r.body);
  await put('oil2', { name: 'Oil', optionGroups: [] });
  // The product and its codes are made (the first step), then the listing's save throws (the second).
  const realTx = db.runTransaction.bind(db); let calls = 0;
  db.runTransaction = async (fn: any) => { calls++; if (calls === 2) throw new Error('contention'); return realTx(fn); };
  const n1 = await count();
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'oil2', variant: { label: 'Mauve', barcode: '036000291452' } }));
  db.runTransaction = realTx;
  check('a listing save that fails part way leaves nothing behind: no product, its barcode free again', calls >= 3 && r.status >= 400 && (await count()) === n1 && !(await get(`${T}/codeIndex/${cf2.codeDocId(cf2.codeForm('036000291452'))}`)), { status: r.status, calls, n: await count(), n1 });
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'oil2', variant: { label: 'Mauve', barcode: '036000291452' } }));
  check('…so trying again works', r.status === 200, r.body);
  // Saved, but the answer lost on the way back: the product stays, as the listing now sells it.
  calls = 0;
  db.runTransaction = async (fn: any) => { calls++; const out = await realTx(fn); if (calls === 2) throw new Error('lost answer'); return out; };
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'oil2', variant: { label: 'Rust' } }));
  db.runTransaction = realTx;
  const rust = (await get(`${T}/inventory/oil2`)).optionGroups[0].choices.find((ch: any) => ch.label === 'Rust');
  check('a save that went through but whose answer was lost keeps the product the listing now sells', r.status === 200 && !!rust && !!(await get(`${T}/inventory/${rust.variantProductId}`)), { body: r.body, rust });
  await put('notype', { name: 'No type', type: null });
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'notype', variant: { label: 'X' } }));
  check('a product with no type gets no variants, refused before anything is made', r.status === 409 && /Only retail/.test(r.body.error));
  check('a label image link with bad encoding is refused, not a crash', pl.designUrlOk('https://firebasestorage.googleapis.com/v0/b/x/o/a%E0%A4%A.png') === false);
  await put('arch', { name: 'Arch', status: 'archived' });
  r = await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'arch', variant: { label: 'X' } }));
  check('an archived listing gets no variants', r.status === 409 && /archived/.test(r.body.error));
  const opened = (await get(`${T}/inventory/oil2`)).optionGroups;
  await CODES(req({ tenantId: 't1', action: 'addVariant', productId: 'oil2', variant: { label: 'Sage' } }));
  r = await CODES(req({ tenantId: 't1', action: 'variants', productId: 'oil2', optionGroups: opened.map((g: any) => ({ ...g, name: 'Color' })), was: opened }));
  const after = (await get(`${T}/inventory/oil2`)).optionGroups[0].choices.map((ch: any) => ch.label);
  check('saving choices from a screen opened before a variant was added is refused, and the variant stays', r.status === 409 && /changed since you opened them/.test(r.body.error) && after.includes('Sage'), { body: r.body, after });
  const nowGroups = (await get(`${T}/inventory/oil2`)).optionGroups;
  r = await CODES(req({ tenantId: 't1', action: 'variants', productId: 'oil2', optionGroups: nowGroups.map((g: any) => ({ ...g, name: 'Color' })), was: nowGroups }));
  check('…and saving from what it has now goes through', r.status === 200 && (await get(`${T}/inventory/oil2`)).optionGroups[0].name === 'Color', r.body);
  const longSku = pl.labelContent({ id: 'l', name: 'Long', sku: 'ABCDEFGHIJ-KLMNOPQRST-UVWXYZ-0123456789' }, new Map());
  const dRoll = pl.drawLabel(longSku, pl.LAYOUTS.roll); const dSheet = pl.drawLabel(longSku, pl.LAYOUTS.sheet);
  check('a code too long to print as bars a scanner can read isn’t printed as bars, on a roll or a sheet; the QR code stays', dRoll.noBars && dSheet.noBars && !dRoll.marks.some((m: any) => m.t === 'bars') && dSheet.marks.some((m: any) => m.t === 'qr'));
  const okBars = (d: any) => d.marks.filter((m: any) => m.t === 'bars').every((m: any) => m.module >= 0.54);
  check('…and every bar printed is at least 7.5 thousandths of an inch', [b, c, longSku, pl.labelContent({ id: 'm', sku: 'RCO-CORAL-15ML-XL' }, new Map())].every((x) => okBars(pl.drawLabel(x, pl.LAYOUTS.roll)) && okBars(pl.drawLabel(x, pl.LAYOUTS.sheet))));
  check('a 14-digit unit barcode prints as Code 128, which every scanner reads out of the box', pl.retailBarcode('10012345678902')?.format === 'CODE128');
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'opal-app.firebasestorage.app';
  check('label designs only from the app’s own storage bucket, the preview and the PDF alike',
    pl.designUrlOk('https://firebasestorage.googleapis.com/v0/b/opal-app.firebasestorage.app/o/a.png?alt=media') && !pl.designUrlOk('https://firebasestorage.googleapis.com/v0/b/someone-else/o/a.png') && !pl.designUrlOk('https://storage.googleapis.com/public-bucket/a.png') && !pl.designUrlOk('http://firebasestorage.googleapis.com/v0/b/opal-app.firebasestorage.app/o/a.png'));
  delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const rcv = src('src/components/inventory/ReceiveStockDialog.tsx');
  check('receiving: a scan while a count box has the cursor puts the box back as it was and counts the scan (it used to type the code in as the count)', /data-scan-field="" data-count-of=\{item\.productId\}/.test(rcv) && /undoScanTyping\(\);/.test(rcv) && /el\.blur\(\);/.test(rcv));
  check('…a damaged count alone doesn’t count the line, so a scan after it starts from zero', /if \(field === 'quantityReceived'\) markCounted\(\[productId\]\);/.test(rcv));
  check('…and a question still open (a case, which variant, which product) is answered before the next scan counts', /if \(askRef\.current\) \{ scanFeedback\(false\); setNote\(\{ text: 'Finish this one first, then scan again\.' \}\); return; \}/.test(rcv));
  check('the product page opens on its overview, or the tab its link names when the product has it, worked out again for each product (never again mid-task)', /setTab\(asked && has\(asked\) \? asked : 'overview'\);/.test(src('src/app/(app)/inventory/(detail)/product/[id]/page.tsx')) && /\}, \[id, productType, sellOn\]\);/.test(src('src/app/(app)/inventory/(detail)/product/[id]/page.tsx')));

  // ── The screens ──
  const productPage = src('src/app/(app)/inventory/(detail)/product/[id]/page.tsx');
  const codesTab = src('src/components/inventory/CodesTab.tsx');
  const labelsPage = src('src/app/(app)/inventory/labels/page.tsx');
  const receive = src('src/components/inventory/ReceiveStockDialog.tsx');
  const unknown = src('src/components/inventory/UnknownCodePanel.tsx');
  check('the product page has its codes a tab away, and opens on the tab its link names', /Codes and labels/.test(productPage) && /get\('tab'\)/.test(productPage));
  check('…adds variants through the server, saves codes through the server', /addVariant\(tenantId/.test(codesTab) && /saveCodes\(tenantId/.test(codesTab));
  check('the labels page prints what it previews, and downloads the same as a PDF', /drawLabel\(/.test(labelsPage) && /LabelMarks/.test(labelsPage) && /\/api\/inventory\/labels/.test(labelsPage) && /Download a PDF/.test(labelsPage));
  check('the old label print page sends people to the labels page', /redirect\(/.test(src('src/app/print/product-labels/[tenantId]/page.tsx')) && /\/inventory\/labels/.test(src('src/app/print/product-labels/[tenantId]/page.tsx')));
  check('receiving: a case asks first, a listing’s code asks which variant, a code no product has asks which product', /Counts as \{ask\.pack\}/.test(receive) && /Which variant/.test(receive) && /<UnknownCodePanel/.test(receive));
  check('…and before stock is added, says which lines nobody counted', /Set the ones not counted to 0/.test(receive) && /not scanned or counted/.test(receive));
  check('a code no product has: the items here first, any product by name or SKU, never saved twice', /The items on the order or delivery, first in the list/.test(unknown) && /Name or SKU/.test(unknown) && /never saved twice/.test(unknown));
  check('after receiving, the toast offers to print labels; Inventory prints labels for what’s chosen', /Print labels/.test(src('src/app/(app)/inventory/page.tsx')) && /ToastAction/.test(src('src/app/(app)/inventory/page.tsx')));
  const words = [productPage, codesTab, labelsPage, receive, unknown, src('src/lib/product-labels.ts'), src('src/lib/labels-pdf.ts'), src('src/components/inventory/LabelMarks.tsx')].join('\n');
  check('the words are the app’s: variants, never shades; no comments in the markup; no emoji', !/shade/i.test(words) && !/\{\/\*/.test(words) && !/[\u{1F300}-\u{1FAFF}]/u.test(words));
  check('nothing tells anyone to call', !/call us/i.test(words));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
