// Checks that variants sell as their listing (Phase A, round 3, lib/variants): one group of a listing's choices holds
// its variants; a variant belongs to one listing and knows it (parentId); a listing is in stock while any variant is;
// variants are never listed on their own; a variant costs its own price when it has one, otherwise the listing's, the
// same in the shop, at checkout and at the desk, and the price shown is the price charged; order lines record the
// listing and the choices. Then the server's save for a listing's choices (refusals, pointers, index entries), the
// codes check settling pointers, the shop's catalog and product page, checkout's sums, the desk's prices (never at
// cost), restock emails for a listing and for one variant, promo codes, swaps, and the screens that write choices.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/variants.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const sent: any[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return fake(request, { initializeApp: () => ({ name: 'x' }), getApps: () => [], cert: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/notify' || request === './notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, m: any) => { sent.push(m); return { ok: true }; } });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const put = (id: string, x: any) => db.doc(`${T}/inventory/${id}`).set({ id, type: 'retail', ...x });
const src = (p: string) => fs.readFileSync(p, 'utf8');
const url = (path: string, q: Record<string, string>) => ({ nextUrl: { searchParams: new URLSearchParams(q) }, url: `https://shop.example${path}`, headers: { get: () => null } }) as any;

(async () => {
  const V = await import('../../src/lib/variants');

  // ── The rules ──
  const oil = { id: 'oil', type: 'retail', name: 'Rose cuticle oil', msrp: 24, wholesalePriceDollars: 12, showOnline: true, totalStock: 0,
    optionGroups: [
      { id: 'g0', name: 'Variant', choices: [{ id: 'a', label: 'Blush', deltaCents: 300, variantProductId: 'blush' }, { id: 'b', label: 'Clear', deltaCents: 0, variantProductId: 'clear' }, { id: 'c', label: 'Sheer gold', deltaCents: 0, variantProductId: 'gold' }] },
      { id: 'g1', name: 'Gift wrap', choices: [{ id: 'n', label: 'No wrap', deltaCents: 0 }, { id: 'w', label: 'Gift wrap', deltaCents: 250 }] },
    ] };
  const blush = { id: 'blush', type: 'retail', name: 'Rose cuticle oil — Blush', totalStock: 8, msrp: 0 };
  const clear = { id: 'clear', type: 'retail', name: 'Clear', totalStock: 0 };
  const gold = { id: 'gold', type: 'retail', name: 'Sheer gold', totalStock: 4, msrp: 28, storeHoldback: 1 };
  const items = [oil, blush, clear, gold];
  const byId = new Map<string, any>(items.map((i) => [i.id, i]));
  const listings = V.listingsOf(items);
  check('one group holds a listing’s variants (the first with a choice that picks a product)', V.variantGroup(oil)?.id === 'g0' && V.variantIdsOf(oil).join() === 'blush,clear,gold');
  check('each variant knows its listing; a listing is never a variant', listings.get('blush') === oil && listings.get('gold') === oil && !listings.has('oil'));
  check('variants are never listed on their own; the listing is', !V.listedInShop({ ...blush, showOnline: true, msrp: 24 }, listings) && V.listedInShop(oil, listings));
  check('a variant’s own price when it has one, otherwise the listing’s', V.variantPriceCents(gold, oil) === 2800 && V.variantPriceCents(blush, oil) === 2400 && V.variantPriceCents(clear, oil) === 2400);
  check('…wholesale: its own wholesale price, else the listing’s wholesale discount off its own price ($28 at the listing’s 50% off is $14), else its retail price by the rule',
    V.variantPriceCents({ ...gold, wholesalePriceDollars: 15 }, oil, 'wholesale') === 1500 && V.variantPriceCents(gold, oil, 'wholesale') === 1400 && V.variantPriceCents(blush, oil, 'wholesale') === 1200
    && V.variantPriceCents(gold, { ...oil, wholesalePriceDollars: null }, 'wholesale') === 2800 && V.variantPriceCents(blush, { ...oil, wholesalePriceDollars: null }, 'wholesale') === 2400);
  const sale = V.choiceSale(oil, { g0: 'a', g1: 'w' });
  check('choices: the variant sold, and only gift wrap adds (an extra cost on a variant’s choice never applies)', sale.variantId === 'blush' && sale.extraCents === 250 && sale.label === 'Blush · Gift wrap' && sale.choices.g0 === 'a' && sale.choices.g1 === 'w' && !sale.unknown.length, sale);
  check('…priced by the rule', V.saleUnitCents(oil, blush, sale) === 2650 && V.saleUnitCents(oil, gold, V.choiceSale(oil, { g0: 'c' })) === 2800);
  check('…a wholesale account’s discount comes off the product’s price, not the extras', V.saleUnitCents(oil, blush, sale, 'wholesale', 10) === 1080 + 250);
  const gone = V.choiceSale(oil, { g0: 'zzz' });
  check('a choice the listing doesn’t offer any more is noted (checkout refuses it rather than sell another)', gone.unknown.join() === 'Variant' && gone.variantId === 'blush');
  check('stock: a listing has what its variants have (after each one’s holdback)', V.listingStock(oil, byId) === 8 + 0 + 3, V.listingStock(oil, byId));
  check('…and is in stock while any variant is', V.listingBuyable(oil, byId) && !V.listingBuyable({ ...oil, optionGroups: [{ id: 'g0', name: 'V', choices: [{ id: 'b', label: 'Clear', variantProductId: 'clear' }] }] }, byId));
  const shown = V.shopOptionGroups(oil, byId, { wholesale: true, discountPct: 0 });
  check('the shop’s choices say what each variant sells for and whether it can be bought, with no product ids',
    shown[0].variants === true && shown[0].choices[0].priceCents === 2400 && shown[0].choices[2].priceCents === 2800 && shown[0].choices[1].inStock === false && shown[0].choices[0].qtyAvailable === 8
    && !JSON.stringify(shown).includes('variantProductId') && shown[1].choices[1].deltaCents === 250, shown);
  const p = { priceCents: 2400, wholesalePriceCents: 1200, inStock: true, qtyAvailable: 11, optionGroups: shown };
  const line = V.shopLine(p, { g0: 'c', g1: 'w' });
  check('the shop works out the price checkout charges', line.unitCents === 2800 + 250 && line.baseCents === 2800 && V.saleUnitCents(oil, gold, V.choiceSale(oil, { g0: 'c', g1: 'w' })) === line.unitCents, line);
  check('…the most that can be added is that variant’s, and a sold-out variant can’t be bought', line.qtyAvailable === 3 && V.shopLine(p, { g0: 'b' }).inStock === false);
  check('…and a choice picked before the shop changed its choices is flagged in the cart (checkout refuses it)', V.shopLine(p, { g0: 'zzz' }).stale === true && V.shopLine(p, { g0: 'a' }).stale === false
    && /optInfo\.stale && \(/.test(src('src/app/shop/[tenantId]/checkout/page.tsx')));
  check('the choice shown picked first is one that can be bought', V.firstChoices(shown).g0 === 'a' && V.firstChoices([{ ...shown[0], choices: [shown[0].choices[1], shown[0].choices[2]] }]).g0 === 'c');
  check('at the desk: the shop’s price (a variant’s own, else its listing’s), and 0 for one with no price (never its cost)',
    V.deskPrice(blush, listings) === 24 && V.deskPrice(gold, listings) === 28 && V.deskPrice({ id: 'x', type: 'retail', msrp: 0, costPerUnit: 6 }, listings) === 0
    && V.saleName(blush, listings) === 'Rose cuticle oil · Blush');
  const asSold = V.soldAs(items);
  check('a list to swap from has the variants in their listing’s place, named and priced as sold', !asSold.some((i: any) => i.id === 'oil') && asSold.find((i: any) => i.id === 'blush')?.name === 'Rose cuticle oil · Blush' && asSold.find((i: any) => i.id === 'blush')?.msrp === 24 && asSold.find((i: any) => i.id === 'blush')?.showOnline === true);

  // ── Saving a listing's choices (the server) ──
  const ci = await import('../../src/lib/code-index');
  const fresh = async () => { db = strictTransactions(makeDb()); };
  await fresh();
  await put('oil', { name: 'Rose cuticle oil', msrp: 24, showOnline: true, sku: 'ROSE-OIL' });
  await put('blush', { name: 'Blush', totalStock: 8, barcode: '084501330131' });
  await put('gold', { name: 'Sheer gold', totalStock: 4, msrp: 28 });
  await put('clear', { name: 'Clear', totalStock: 0 });
  await put('cream', { name: 'Hand cream', msrp: 18, showOnline: true });
  await put('dryer', { type: 'equipment', name: 'Dryer' });
  await put('old', { name: 'Old variant', status: 'archived' });
  await ci.buildCodeIndex(db, 't1');
  const g = (choices: any[], extra: any[] = []) => [{ id: 'g0', name: 'Variant', choices }, ...extra];
  let r: any = await ci.saveListingChoices(db, 't1', 'oil', g([{ id: 'a', label: 'Blush', deltaCents: 300, variantProductId: 'blush' }, { id: 'c', label: 'Sheer gold', variantProductId: 'gold' }], [{ id: 'g1', name: 'Gift wrap', choices: [{ id: 'n', label: 'No wrap' }, { id: 'w', label: 'Gift wrap', deltaCents: 250 }] }]), 'Kai');
  const oilDoc: any = await get(`${T}/inventory/oil`);
  check('a listing’s choices save, with their ids kept and a variant’s extra cost dropped (its price is the variant’s)',
    r.ok && oilDoc.optionGroups[0].choices.map((c: any) => c.id).join() === 'a,c' && oilDoc.optionGroups[0].choices[0].deltaCents === 0 && oilDoc.optionGroups[1].choices[1].deltaCents === 250, r);
  const cf = await import('../../src/lib/code-form');
  const blushEntry = `${T}/codeIndex/${cf.codeDocId(cf.codeForm('084501330131'))}`;
  check('…each variant points at its listing, and its codes’ entries name it', (await get(`${T}/inventory/blush`)).parentId === 'oil' && (await get(`${T}/inventory/gold`)).parentId === 'oil' && (await get(blushEntry))?.parentId === 'oil', await get(blushEntry));
  r = await ci.saveListingChoices(db, 't1', 'cream', g([{ id: 'x', label: '50 ml', variantProductId: 'gold' }]), 'Kai');
  check('a product another listing sells is refused, naming that listing', !r.ok && r.status === 409 && /Sheer gold is already a variant of Rose cuticle oil/.test(r.error), r);
  r = await ci.saveListingChoices(db, 't1', 'cream', g([{ id: 'x', label: 'Oil', variantProductId: 'oil' }]), 'Kai');
  check('…a listing as a variant is refused', !r.ok && /has variants of its own/.test(r.error), r);
  r = await ci.saveListingChoices(db, 't1', 'blush', g([{ id: 'x', label: 'Clear', variantProductId: 'clear' }]), 'Kai');
  check('…a variant can’t have variants of its own', !r.ok && /is a variant of Rose cuticle oil/.test(r.error), r);
  r = await ci.saveListingChoices(db, 't1', 'cream', g([{ id: 'x', label: 'Dryer', variantProductId: 'dryer' }]), 'Kai');
  const r2: any = await ci.saveListingChoices(db, 't1', 'cream', g([{ id: 'x', label: 'Old', variantProductId: 'old' }]), 'Kai');
  check('…equipment and archived products are refused', !r.ok && /isn’t a retail product/.test(r.error) && !r2.ok && /is archived/.test(r2.error), [r, r2]);
  r = await ci.saveListingChoices(db, 't1', 'cream', g([{ id: 'x', label: 'Clear', variantProductId: 'clear' }], [{ id: 'g1', name: 'Size', choices: [{ id: 'y', label: 'Big', variantProductId: 'old' }] }]), 'Kai');
  check('…variants go in one group of choices', !r.ok && /Variants go in one group/.test(r.error), r);
  r = await ci.saveListingChoices(db, 't1', 'cream', g([{ id: 'x', label: 'Clear', variantProductId: 'clear' }, { id: 'y', label: 'Plain' }]), 'Kai');
  check('…every choice of the variants group picks a product', !r.ok && /needs its own product/.test(r.error), r);
  r = await ci.saveListingChoices(db, 't1', 'cream', g([{ id: 'x', label: '' }]), 'Kai');
  check('…every choice needs a name', !r.ok && r.status === 400 && /Give every choice/.test(r.error), r);
  check('…and nothing is written when it’s refused', !(await get(`${T}/inventory/cream`)).optionGroups && !(await get(`${T}/inventory/clear`)).parentId);
  r = await ci.saveListingChoices(db, 't1', 'oil', g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }]), 'Kai');
  check('a product taken out of a listing stops pointing at it', r.ok && (await get(`${T}/inventory/gold`)).parentId === null && (await get(`${T}/inventory/blush`)).parentId === 'oil', await get(`${T}/inventory/gold`));
  r = await ci.saveListingChoices(db, 't1', 'cream', g([{ id: 'x', label: '50 ml', variantProductId: 'gold' }]), 'Kai');
  check('…and is free for another listing', r.ok && (await get(`${T}/inventory/gold`)).parentId === 'cream');

  // The codes check settles pointers saved before (or a listing deleted since).
  await fresh();
  await put('oil', { name: 'Rose cuticle oil', msrp: 24, showOnline: true, optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }]) });
  await put('blush', { name: 'Blush', totalStock: 8 });
  await put('stray', { name: 'Stray', parentId: 'gone-listing' });
  await db.doc(`${T}/private/codeIndex`).set({ builtAt: '2026-10-20T00:00:00Z', complete: true });
  await ci.ensureCodeIndex(db, 't1');
  check('an index built before variants knew their listing is built again, pointing each variant at its listing', (await get(`${T}/inventory/blush`)).parentId === 'oil' && (await get(`${T}/private/codeIndex`)).version === 2);
  check('…and a pointer to a listing that’s gone is cleared', (await get(`${T}/inventory/stray`)).parentId === null);

  // ── The shop ──
  await fresh();
  await db.doc('tenants/t1').set({ name: 'Opal', retailSettings: {} });
  await put('oil', { name: 'Rose cuticle oil', msrp: 24, showOnline: true, totalStock: 0, optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }, { id: 'b', label: 'Clear', variantProductId: 'clear' }, { id: 'c', label: 'Sheer gold', variantProductId: 'gold' }]) });
  await put('blush', { name: 'Blush', totalStock: 8, showOnline: true, msrp: 0, parentId: 'oil' });
  await put('clear', { name: 'Clear', totalStock: 0, parentId: 'oil' });
  await put('gold', { name: 'Sheer gold', totalStock: 4, msrp: 28, parentId: 'oil' });
  await put('candle', { name: 'Cedar candle', msrp: 30, showOnline: true, totalStock: 2 });
  const cat: any = await (await import('../../src/app/api/retail/catalog/route')).GET(url('/api/retail/catalog', { tenantId: 't1' }));
  const listed = cat.body.products || [];
  const oilShown = listed.find((x: any) => x.id === 'oil');
  check('the catalog lists the listing (in stock while a variant is) and never a variant on its own', listed.map((x: any) => x.id).sort().join() === 'candle,oil' && oilShown?.inStock === true, listed.map((x: any) => x.id));
  check('…at its lowest price, saying it varies, with each variant’s price and stock', oilShown?.priceCents === 2400 && oilShown?.priceVaries === true && oilShown.optionGroups[0].choices.find((c: any) => c.id === 'c').priceCents === 2800 && oilShown.optionGroups[0].choices.find((c: any) => c.id === 'b').inStock === false, oilShown);
  const prod = (await import('../../src/app/api/retail/product/route')).GET;
  let pr: any = await prod(url('/api/retail/product', { tenantId: 't1', productId: 'blush' }));
  check('a variant’s own link opens its listing, with it picked', pr.status === 404 && pr.body.listing?.id === 'oil' && pr.body.listing?.choice === 'a', pr.body);
  pr = await prod(url('/api/retail/product', { tenantId: 't1', productId: 'oil' }));
  check('the listing’s page is in stock and prices each variant', pr.status === 200 && pr.body.product.inStock === true && pr.body.product.optionGroups[0].choices.map((c: any) => c.priceCents).join() === '2400,2400,2800', pr.body.product?.optionGroups);
  const page = src('src/app/shop/[tenantId]/product/[productId]/page.tsx');
  check('the product page shows the picked variant’s price, stock and sold out, and the price it shows is the one charged (one shared sum)',
    /const line = useMemo\(\(\) => \(product \? shopLine\(product, selections, wholesale\) : null\)/.test(page) && /firstChoices\(data\.product\.optionGroups \|\| \[\]\)/.test(page) && / · sold out/.test(page.replace(/\\u00b7/g, '·')) && /window\.location\.replace\(/.test(page) && !/optionDeltaCents/.test(page));
  check('the cart and checkout pages price each line the same way', /shopLine\(p, selections, wholesale\)/.test(src('src/app/shop/[tenantId]/page.tsx')) && /shopLine\(p, selections, wholesale\)/.test(src('src/app/shop/[tenantId]/checkout/page.tsx')) && !/optionDelta\(/.test(src('src/app/shop/[tenantId]/checkout/page.tsx')));
  check('the grids say “From” when a listing’s variants cost different amounts', /p\.priceVaries \? 'From ' : ''/.test(src('src/components/shop/home/HomeLayouts.tsx')) && /<HomeCatalog/.test(src('src/app/shop/[tenantId]/page.tsx')) && /p\.priceVaries \? 'From ' : ''/.test(src('src/app/shop/[tenantId]/catalog/page.tsx')));
  check('a variant’s own address isn’t indexed and points at its listing, and the sitemap lists only listings',
    /robots: \{ index: false, follow: true \}/.test(src('src/app/shop/[tenantId]/product/[productId]/layout.tsx')) && /listedInShop\(item, listings\) \|\| soldInside\(item\)/.test(src('src/app/sitemap.ts')));

  // ── Checkout ──
  const co = src('src/app/api/retail/checkout/route.ts');
  check('checkout: the variant sold by the one rule, refused when its choice isn’t offered any more, priced as shown, and the line records its listing and choices',
    /const sale = choiceSale\(listing, cartEntries\[i\]\.selections\);/.test(co) && /if \(sale\.unknown\.length\)/.test(co) && /line\.unitPriceCents = saleUnitCents\(listing, variant, sale, priceTier/.test(co)
    && /\(line as any\)\.listingId = listing\.id/.test(co) && /\(line as any\)\.choices = sale\.choices/.test(co) && !/resolveVariantProductId/.test(co) && !/discountedCents\(line\.unitPriceCents/.test(co));
  check('…a variant bought on its own (an old cart) is refused, and the variant sells as its listing sets it (a listing that can’t fly keeps its variants on the ground)', /is no longer available on its own\. Choose it on its listing\./.test(co) && /item = asSold\(listing, variant\) as SellableItem;/.test(co)
    && V.asSold({ id: 'l', type: 'retail', shipGroundOnly: true }, { id: 'v', type: 'retail' }).shipGroundOnly === true);
  const promo = await import('../../src/lib/promo-codes');
  check('a promo code for a listing covers its variants', /only\.includes\(String\(l\.listingId\)\)/.test(src('src/lib/promo-codes.ts')) && typeof promo === 'object');

  // ── The desk ──
  const engine = src('src/components/pos/usePosEngine.tsx'); const done = src('src/app/api/checkout/complete/route.ts'); const pc = src('src/components/pos/PosCatalog.tsx');
  check('the desk adds a product at the shop’s price, and one with no price isn’t added (it used to sell at its cost)',
    /price = deskPrice\(item, listings\);/.test(engine) && /has no price\. Give it one in Inventory, then add it\./.test(engine) && !/item\.msrp \|\| item\.costPerUnit/.test(engine));
  check('…the server prices it the same way, refuses one with no price, and the sale records the listing', /price = deskPrice\(p, deskListings\); name = saleName\(p, deskListings\);/.test(done) && /has no price yet/.test(done) && /listingId: it\.listingId/.test(done) && !/num\(p\.msrp \|\| p\.costPerUnit\)/.test(done));
  check('…its catalog shows the variants inside their listing, priced by the rule, as variants', /deskPrice\(i, listings\)/.test(pc) && /Choose a variant of/.test(pc) && /'variant' : 'variants'/.test(pc) && !/costPerUnit/.test(pc) && !/Choose a size of/.test(pc));
  check('…and its which-variant drawer shows each variant’s price the same way', /deskPrice\(v, deskListings\)/.test(src('src/components/pos/desk/DeskPOS.tsx')) && !/v\.msrp \|\| v\.costPerUnit/.test(src('src/components/pos/desk/DeskPOS.tsx')));

  // ── Restock emails ──
  const ra = await import('../../src/lib/restock-alerts');
  await fresh();
  await db.doc('tenants/t1').set({ name: 'Opal' });
  await put('oil', { name: 'Rose cuticle oil', msrp: 24, showOnline: true, totalStock: 0, optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }, { id: 'b', label: 'Clear', variantProductId: 'clear' }]) });
  await put('blush', { name: 'Blush', totalStock: 3, parentId: 'oil' });
  await put('clear', { name: 'Clear', totalStock: 0, parentId: 'oil' });
  await db.doc(`${T}/restockAlerts/a1`).set({ id: 'a1', productId: 'oil', productName: 'Rose cuticle oil', email: 'a@x.com', notifiedAt: null });
  await db.doc(`${T}/restockAlerts/a2`).set({ id: 'a2', productId: 'clear', listingId: 'oil', choiceId: 'b', productName: 'Rose cuticle oil · Clear', email: 'b@x.com', notifiedAt: null });
  sent.length = 0;
  const send = async (_db: any, m: any) => { sent.push(m); return { ok: true }; };
  let n = await ra.sendRestockAlerts(db, 't1', 'https://shop.example', { send });
  check('a listing is back when a variant is (its own stock is zero)', n === 1 && sent.length === 1 && sent[0].to === 'a@x.com', sent);
  check('…a variant someone asked about waits for that variant', !(await get(`${T}/restockAlerts/a2`)).notifiedAt);
  await put('clear', { name: 'Clear', totalStock: 2, parentId: 'oil' });
  sent.length = 0; n = await ra.sendRestockAlerts(db, 't1', 'https://shop.example', { send });
  check('…and when it’s back, the email opens the listing with it picked', n === 1 && /product\/oil\?choice=b/.test(sent[0]?.html || '') && /Rose cuticle oil · Clear is back/.test(sent[0]?.subject || ''), sent[0]?.subject);
  const rr = await import('../../src/app/api/retail/restock-alert/route');
  const ask: any = await rr.POST({ json: async () => ({ tenantId: 't1', productId: 'oil', choiceId: 'b', email: 'c@x.com' }) } as any);
  const kept = (await db.collection(`${T}/restockAlerts`).get()).docs.map((d: any) => d.data()).find((a: any) => a.email === 'c@x.com');
  check('a customer can ask about one sold-out variant', ask.status === 200 && kept?.productId === 'clear' && kept?.listingId === 'oil' && kept?.choiceId === 'b', kept);

  // ── Swaps ──
  const sw = await import('../../src/lib/retail-swap-server');
  const sub: any = await sw.catalogItem(db, 't1', 'clear');
  check('a swap to another variant is named as its listing and choice, at the price it sells for', sub?.name === 'Rose cuticle oil · Clear' && sub?.unitPriceCents === 2400 && sub?.listingId === 'oil', sub);

  // ── The screens that write choices ──
  const tab = src('src/components/inventory/OnlineListingTab.tsx'); const settings = src('src/app/(app)/retail-orders/settings/page.tsx');
  check('the product’s shop tab saves choices through the server, offers only products no other listing sells, and shows what a variant sells for',
    /const r = await onSaveChoices\(groups, groupsBase\)/.test(tab) && /!listings\.has\(String\(i\.id\)\) \|\| String\(listings\.get\(String\(i\.id\)\)\?\.id\) === String\(product\.id\)/.test(tab) && /sellsFor\(c\.variantProductId\)/.test(tab)
    && /onSaveChoices=\{handleChoicesSave\}/.test(src('src/app/(app)/inventory/(detail)/product/[id]/page.tsx')));
  check('…a variant’s own tab says which listing sells it, and how', /A variant of \{sellsMe\.name \|\| 'a listing'\}/.test(tab));
  check('Shop settings no longer edits choices as text (it rewrote their ids), and lists listings, not variants', !/parseOptionGroups/.test(settings) && !/optionGroups:/.test(settings) && /!listings\.has\(String\(i\.id\)\)/.test(settings) && !/📷|🎬/.test(settings));
  const client = src('src/lib/codes-client.ts');
  check('screens never write a product’s choices or its listing themselves (the database refuses it too)', /delete o\.optionGroups; delete o\.parentId;/.test(client) && /withoutLinks\(withoutCodes\(edited\)\)/.test(client) && /'variants'/.test(src('src/app/api/inventory/codes/route.ts')));
  check('no screen says “shades” or “options” for variants', ![pc, tab, settings, src('src/components/pos/desk/DeskPOS.tsx'), src('src/lib/scan-resolve.ts')].some((t) => /\bshades?\b|comes in options|option’s own code/i.test(t.replace(/var\(--[\w-]+\)/g, ''))));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
