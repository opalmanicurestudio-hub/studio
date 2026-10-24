// scripts/verify/discovery.verify.ts — how a shop is found (lib/shop-discovery): the facts taken from its settings,
// the search markup (returns, shipping, rating, barcode, variants, bundles), the Google Merchant feed (one item per
// variant at its own price and stock, linking to the page that shows that price; nothing digital, unpriced or undated;
// safe XML) and the guide and data for assistants. Includes the independent review's findings.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/discovery.verify.ts
import fs from 'fs';
import { listingsOf, shopOptionGroups } from '../../src/lib/variants';
import { catalogProducts, publicRow } from '../../src/lib/shop-catalog';
import {
  shopFactsOf, validGtin, gtinOf, shopJsonLd, returnPolicyLd, shippingLd, ratingLd, productLd, productGroupLd, offerJsonLd, offerSaving, setPriceCents,
  feedItems, feedProblem, merchantFeedXml, xmlEscape, shopAgentJson, shopGuideText, policyLines, availabilityOf, hasOwnPage, variesByOf, seoOrigin,
} from '../../src/lib/shop-discovery';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 700)); } else console.log('  ✓', m); };
const O = 'https://shop.example'; const Z = 'America/New_York';

// ── facts from settings
const tenant: any = { businessName: 'Opal & Co', phone: '555-0100', address: { street: '1 Main', city: 'Town', state: 'NY', zip: '10001' }, stripeAccountId: 'acct_1',
  retailSettings: { shopTagline: 'Hands, looked after', flatShippingDollars: 6, freeShippingOverDollars: 60, returnWindowDays: 14, returnLabelPayer: 'shop', returnPolicyText: 'Unworn items only.', policies: { restockingFees: { as_new: 10, opened: 80 }, cancelWindowHours: 2 } } };
const f = shopFactsOf('opal', tenant);
ok(f.live && f.listed && f.name === 'Opal & Co' && f.flatShipCents === 600 && f.freeShipOverCents === 6000 && f.returns.days === 14 && f.returns.payer === 'shop' && f.returns.newPct === 10 && f.cancelHours === 2, 'facts come from the shop’s settings', f);
ok(f.returns.openedPct === 50, 'restocking fees are capped at 50%, as returns caps them');
const paused = shopFactsOf('x', { ...tenant, retailSettings: { ...tenant.retailSettings, storePaused: true } });
ok(paused.listed && paused.paused && !paused.live, 'a paused shop stays listed but isn’t live');
ok(!shopFactsOf('x', { businessName: 'New', retailSettings: { shopOpenedAt: '2026-01-01' } }).listed, 'opened in Setup but no payments: checkout refuses every order, so not listed');
ok(!shopFactsOf('x', { businessName: 'C', stripeConnectAccountId: 'acct', retailSettings: {} }).listed, 'only the account checkout uses counts');
ok(!shopFactsOf('x', { ...tenant, modules: { retail: false } }).listed, 'no Retail tool, no shop');
ok(shopFactsOf('x', { retailSettings: { logoUrl: 'http://insecure/logo.png' } }).logoUrl === '', 'only https logos');
ok(shopFactsOf('x', { retailSettings: {} }).returns.days === 0, 'no return window set means no time limit (as the returns flow reads it)');

// ── barcodes
ok(validGtin('036000291452') === '036000291452' && validGtin('4006381333931') === '4006381333931' && validGtin('96385074') === '96385074', 'real UPC, EAN and EAN-8 pass');
ok(validGtin('036000291453') === '' && validGtin('12345') === '' && validGtin('abc') === '', 'a wrong check digit or length fails');
ok(gtinOf({ barcode: 'nope', barcodes: [{ code: '036000291452' }] }) === '036000291452' && gtinOf({ upc: '036 000 291 452' }) === '036000291452', 'any barcode field, spaces ignored');

// ── availability, as checkout sells
ok(availabilityOf({ totalStock: 2 }, Z).state === 'in_stock' && availabilityOf({ totalStock: 0 }, Z).state === 'out_of_stock', 'on the shelf or not');
ok(availabilityOf({ totalStock: 0, preorder: true, preorderClosesAt: '2020-01-01' }, Z).state === 'out_of_stock', 'a closed pre-order run is out of stock, not a pre-order (review)');
const pre = availabilityOf({ totalStock: 0, preorder: true, preorderEtaAt: '2099-12-15' }, Z);
ok(pre.state === 'preorder' && pre.date.startsWith('2099-12-15'), 'an open run is a pre-order with its date', pre);
ok(availabilityOf({ totalStock: 3, preorder: true, preorderEtaAt: '2099-12-15' }, Z).state === 'in_stock', 'stock on the shelf sells from the shelf');
ok(availabilityOf({ totalStock: 0, allowBackorder: true }, Z).state === 'backorder', 'sold ahead of stock');
ok(availabilityOf({ totalStock: 9 }, Z, true).state === 'out_of_stock', 'a paused shop shows out of stock');
ok(availabilityOf({ digital: true, totalStock: 0 }, Z).state === 'in_stock', 'a download is never out of stock (second review)');

// ── structured data
const [store, site] = shopJsonLd(f, O);
ok(store['@type'] === 'Store' && store.address.addressLocality === 'Town' && store.telephone === '555-0100' && store.hasMerchantReturnPolicy.merchantReturnDays === 14 && site['@type'] === 'WebSite', 'the shop as a business', store);
ok(shopJsonLd({ ...f, address: null }, O)[0]['@type'] === 'OnlineStore', 'no address: an online store, not a local one');
const rp = returnPolicyLd(f);
ok(rp.returnFees === 'https://schema.org/FreeReturn' && rp.restockingFee === 10 && rp.returnMethod.length === 2, 'return policy: free returns, restocking fee, by mail and in store', rp);
ok(returnPolicyLd({ ...f, returns: { ...f.returns, enabled: false } }).returnPolicyCategory.endsWith('MerchantReturnNotPermitted'), 'no returns says so');
ok(returnPolicyLd(f, true).returnPolicyCategory.endsWith('MerchantReturnNotPermitted'), 'a final-sale item says it can’t be returned (review)');
const unl = returnPolicyLd({ ...f, returns: { ...f.returns, days: 0 } });
ok(unl.returnPolicyCategory.endsWith('MerchantReturnUnlimitedWindow') && !('merchantReturnDays' in unl), 'no time limit is said as no time limit (review)', unl);
ok(returnPolicyLd({ ...f, returns: { ...f.returns, payer: 'fault' } }).returnFees.endsWith('ReturnFeesCustomerResponsibility'), 'by fault is not called free');
ok(shippingLd(f, 2000)!.shippingRate.value === '6.00' && shippingLd(f, 6000)!.shippingRate.value === '0.00' && shippingLd({ ...f, shipping: false }, 100) === null, 'shipping: flat, free at the amount, none when the shop doesn’t ship');
ok(ratingLd(0, 0) === null && ratingLd(4.66, 3)!.ratingValue === 4.7, 'a rating only when there are reviews');

const pl = productLd(f, { id: 'file', sku: 'GF-1', upc: '036000291452', totalStock: 3 }, { url: `${O}/shop/opal/product/file`, name: 'File', description: 'A file.', images: ['https://i/f.jpg'], priceCents: 1800, zone: Z, rating: { average: 5, count: 2 } });
ok(pl.gtin === '036000291452' && pl.aggregateRating.reviewCount === 2 && pl.offers.availability.endsWith('InStock') && pl.offers.itemCondition.endsWith('NewCondition') && pl.offers.shippingDetails.shippingRate.value === '6.00' && pl.offers.hasMerchantReturnPolicy.merchantReturnDays === 14, 'a product result: barcode, rating, stock, condition, shipping and returns', pl);
const dl = productLd(f, { id: 'c', digital: true }, { url: 'u', name: 'Course', description: '', images: [], priceCents: 5000, zone: Z });
ok(!dl.offers.shippingDetails && dl.offers.hasMerchantReturnPolicy.returnPolicyCategory.endsWith('NotPermitted'), 'a download: no shipping, no returns (review)', dl.offers);
ok(productLd(f, { id: 'x', finalSale: true, totalStock: 1 }, { url: 'u', name: 'X', description: '', images: [], priceCents: 900, zone: Z }).offers.hasMerchantReturnPolicy.returnPolicyCategory.endsWith('NotPermitted'), 'marked final sale: no returns (review)');
ok(!('offers' in productLd(f, { id: 'x' }, { url: 'u', name: 'X', description: '', images: [], priceCents: 0 })), 'no price, no offer invented');
ok(productLd({ ...f, listed: false, live: false }, { id: 'x', totalStock: 5 }, { url: 'u', name: 'X', description: '', images: [], priceCents: 900, zone: Z }).offers.availability.endsWith('OutOfStock'), 'a shop that can’t take payments never says in stock (second review)');
ok(dl.offers.availability.endsWith('InStock'), 'a download is in stock in results (second review)');
ok(productLd(paused, { id: 'x', totalStock: 5 }, { url: 'u', name: 'X', description: '', images: [], priceCents: 900, zone: Z }).offers.availability.endsWith('OutOfStock'), 'paused: out of stock in results too');

// ── the catalog as the shop sends it
const g = (choices: any[]) => [{ id: 'g0', name: 'Shade', choices }];
const inv: any[] = [
  { id: 'oil', type: 'retail', name: 'Rose oil', msrp: 24, showOnline: true, status: 'active', totalStock: 0, imageUrls: ['https://img/oil.jpg'], optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }, { id: 'b', label: 'Clear', variantProductId: 'clear' }, { id: 'c', label: 'Nude', variantProductId: 'nude' }]) },
  { id: 'blush', type: 'retail', name: 'Rose oil Blush', msrp: 24, parentId: 'oil', showOnline: true, status: 'active', totalStock: 5, upc: '036000291452' },
  { id: 'clear', type: 'retail', name: 'Rose oil Clear', msrp: 26, parentId: 'oil', showOnline: true, status: 'active', totalStock: 0, preorder: true, preorderClosesAt: '2020-01-01' },
  { id: 'nude', type: 'retail', name: 'Rose oil Nude', msrp: 28, parentId: 'oil', showOnline: true, status: 'active', totalStock: 0, preorder: true, preorderEtaAt: '2099-12-15' },
  { id: 'file', type: 'retail', name: 'Glass <file> & "case"', msrp: 14, showOnline: true, status: 'active', totalStock: 3, description: 'A file that lasts.', sku: 'GF-1', imageUrls: ['https://img/f.jpg', 'http://bad/x.jpg'] },
  { id: 'resold', type: 'retail', name: 'Brand polish', brand: 'OtherCo', msrp: 12, showOnline: true, status: 'active', totalStock: 3, sku: 'INT-9' },
  { id: 'later', type: 'retail', name: 'Made later', msrp: 30, showOnline: true, status: 'active', totalStock: 0, allowBackorder: true },
  { id: 'course', type: 'retail', name: 'Online course', msrp: 50, showOnline: true, status: 'active', digital: true, digitalUrl: 'https://x/c' },
  { id: 'free', type: 'retail', name: 'Sample', msrp: 0, showOnline: true, status: 'active', totalStock: 9 },
  { id: 'hidden', type: 'retail', name: 'Hidden', msrp: 9, showOnline: false, status: 'active', totalStock: 9 },
];
const byId = new Map<string, any>(inv.map((i) => [i.id, i]));
const products = catalogProducts(inv, byId, listingsOf(inv), { wholesale: false, discountPct: 0, zone: Z });
const ids = products.map((p: any) => p.id).sort();
ok(!ids.includes('blush') && !ids.includes('hidden') && ids.includes('oil') && ids.includes('file'), 'the catalog lists listings, not their variants or hidden products', ids);

// ── a listing in variants: a product group, each variant at the address and price the feed gives Google
const oil = byId.get('oil'); const vg: any = shopOptionGroups(oil, byId, { zone: Z }).find((x: any) => x.variants);
const grp = productGroupLd(f, oil, byId, vg.choices, { url: `${O}/shop/opal/product/oil`, name: 'Rose oil', description: 'Oil.', images: [], zone: Z, rating: null })!;
const vb = grp.hasVariant.find((v: any) => v.name.endsWith('Blush')); const vc = grp.hasVariant.find((v: any) => v.name.endsWith('Clear')); const vn = grp.hasVariant.find((v: any) => v.name.endsWith('Nude'));
ok(grp['@type'] === 'ProductGroup' && grp.productGroupID === 'oil' && vb.offers.price === '24.00' && vb.url === `${O}/shop/opal/product/oil?choice=a` && vb.gtin === '036000291452' && vc.offers.price === '26.00', 'each variant at its own price, linking to its own choice (review)', grp);
ok(grp.variesBy[0] === 'https://schema.org/color' && variesByOf('Size') === 'https://schema.org/size' && variesByOf('Scent') === '' && grp.hasVariant.every((v: any) => Array.isArray(v.image) || v.image === undefined), 'variesBy only takes Google’s own values; variants carry images (second review)', grp.variesBy);
const grpImg = productGroupLd(f, oil, byId, vg.choices, { url: 'u', name: 'Rose oil', description: '', images: ['https://i/oil.jpg'], zone: Z })!;
ok(grpImg.hasVariant.every((v: any) => v.image[0] === 'https://i/oil.jpg'), 'a variant without its own photo uses the listing’s');
ok(vc.offers.availability.endsWith('OutOfStock') && vn.offers.availability.endsWith('PreOrder') && vn.offers.availabilityStarts.startsWith('2099-12-15'), 'a closed run is out of stock; an open one a pre-order with its date');

// ── the Google feed
const items = feedItems(f, O, products, byId, Z);
const blush = items.find((x) => x.id === 'blush'); const nude = items.find((x) => x.id === 'nude'); const clear = items.find((x) => x.id === 'clear'); const file = items.find((x) => x.id === 'file');
ok(blush && blush.groupId === 'oil' && blush.priceCents === 2400 && blush.availability === 'in_stock' && blush.gtin === '036000291452' && blush.link === `${O}/shop/opal/product/oil?choice=a` && blush.title.endsWith('- Blush'), 'each variant is its own item, grouped, at its own price, linking to the listing with it picked (review)', blush);
ok(clear && clear.availability === 'out_of_stock', 'a closed pre-order run is out of stock (review)', clear);
ok(nude && nude.availability === 'preorder' && nude.availabilityDate.startsWith('2099-12-15'), 'an open pre-order carries its date (review)', nude);
ok(file && file.mpn === 'GF-1' && file.images.length === 1 && file.shippingCents === 600, 'a plain product, https photos only, shipping from settings', file);
const resold = items.find((x) => x.id === 'resold');
ok(resold && resold.brand === 'OtherCo' && resold.mpn === '' && resold.gtin === '', 'another maker’s product: their brand, and no made-up part number (review)', resold);
ok(!items.some((x) => ['course', 'free', 'oil', 'later'].includes(x.id)), 'no downloads, nothing unpriced, no listing-level duplicate, nothing sold ahead of stock without a date', items.map((x) => x.id));
const pausedItems = feedItems(paused, O, products, byId, Z);
ok(pausedItems.every((x) => x.availability === 'out_of_stock') && items.every((x) => pausedItems.some((y) => y.id === x.id)), 'a paused shop keeps its items, all out of stock (review)', pausedItems.map((x) => x.id));
ok(feedItems({ ...f, listed: false, live: false }, O, products, byId, Z).length === 0 && !!feedProblem({ ...f, listed: false }), 'no payments, no feed');
ok(feedItems({ ...f, shipping: false }, O, products, byId, Z).length === 0 && /pickup only/.test(feedProblem({ ...f, shipping: false })), 'pickup only: no feed, and the owner is told why (review)');
ok(feedItems({ ...f, feed: false }, O, products, byId, Z).length === 0, 'the owner’s switch turns it off');
const xml = merchantFeedXml(f, O, items);
ok(xml.startsWith('<?xml') && xml.includes('xmlns:g="http://base.google.com/ns/1.0"') && xml.includes('<g:price>24.00 USD</g:price>') && xml.includes('<g:availability>out_of_stock</g:availability>') && xml.includes('<g:item_group_id>oil</g:item_group_id>'), 'the feed is Merchant Center RSS');
ok(xml.includes('<g:availability>preorder</g:availability><g:availability_date>2099-12-15'), 'pre-orders carry availability_date');
ok(xml.includes('Glass &lt;file&gt; &amp; &quot;case&quot;') && !xml.includes('<file>') && xml.includes('<title>Opal &amp; Co</title>') && xml.includes('?choice=a</link>'.replace('?', '?')), 'names and links are escaped', xml.slice(0, 300));
ok(xml.includes('<g:mpn>GF-1</g:mpn>') && xml.includes('<g:gtin>036000291452</g:gtin>') && xml.includes('<g:identifier_exists>no</g:identifier_exists>') && xml.includes('<g:shipping><g:country>US</g:country><g:price>6.00 USD</g:price></g:shipping>'), 'identifiers and shipping');
ok(xmlEscape('a\u0001b') === 'ab', 'control characters are dropped (they break XML)');

// ── bundles
const pm = new Map<string, any>(products.map((p: any) => [String(p.id), p]));
const set: any = { id: 'k', kind: 'set', name: 'Care kit', blurb: '', status: 'live', kit: true, photoUrl: '', items: [{ productId: 'file', qty: 2 }], anchorId: '', pool: [], tiers: [], save: { type: 'pct', value: 10 }, hotspots: [], order: 1, groupsLeft: 1 };
ok(setPriceCents(set, pm) === 2520 && offerSaving(set) === 'save 10%', 'a set’s price is its items less the saving, the way checkout charges it');
const sld = offerJsonLd(set, pm, f, `${O}/shop/opal/offer/k`)!;
ok(sld['@type'] === 'Product' && sld.offers.price === '25.20' && sld.offers.availability.endsWith('InStock') && sld.isRelatedTo[0].url === `${O}/shop/opal/product/file`, 'a priced set is a product at its set price', sld);
ok(offerJsonLd({ ...set, groupsLeft: 0 }, pm, f, 'u')!.offers.availability.endsWith('OutOfStock'), 'a set stock can’t make a whole one of is out of stock (review)');
const fsMap = new Map<string, any>([...byId.entries(), ['file', { ...byId.get('file'), finalSale: true }]]);
ok(offerJsonLd(set, pm, f, 'u', fsMap)!.offers.hasMerchantReturnPolicy.returnPolicyCategory.endsWith('NotPermitted'), 'a kit with a final-sale item says no returns (second review)');
const box: any = { ...set, id: 'b', kind: 'box', name: 'Pick 3', items: [], pool: ['file', 'oil'], tiers: [{ count: 3, pct: 10 }], save: null };
ok(offerJsonLd(box, pm, f, `${O}/shop/opal/offer/b`)!['@type'] === 'ItemList' && offerSaving(box) === 'pick 3, save 10%' && setPriceCents(box, pm) === 0, 'a box is a list, never a made-up price');
ok(setPriceCents({ ...set, items: [{ productId: 'oil', qty: 1 }] }, pm) === 0, 'a set with a "from" price item can’t be priced, so isn’t');
const tog: any = { ...set, id: 't', kind: 'together', anchorId: 'file', items: [{ productId: 'resold', qty: 1 }] };
ok(!hasOwnPage(tog) && offerJsonLd(tog, pm, f, 'u') === null, 'bought-together picks have no page of their own (review)');

// ── assistants
const j = shopAgentJson(f, O, products, [set, tog]);
ok(j.ok && j.shop.open && j.bundles.length === 1 && j.bundles[0].saving === 'save 10%' && j.bundles[0].url === `${O}/shop/opal/offer/k`, 'the data for assistants (no together picks as bundles)', j.bundles);
const joil = j.products.find((p: any) => p.id === 'oil');
const opts = joil?.choices[0].options || [];
ok(joil && joil.priceIsFrom && opts.find((o: any) => o.label === 'Blush')?.inStock === true && opts.find((o: any) => o.label === 'Clear')?.inStock === false && opts.find((o: any) => o.label === 'Clear')?.price === 26 && !('cost' in joil), 'each variant with its own price and stock, nothing private (review)', joil);
const jp = shopAgentJson(paused, O, products, [set]);
ok(jp.products.length > 0 && jp.products.every((p: any) => !p.inStock) && /paused/.test(jp.howToBuy.note), 'paused: products listed, none buyable, and it says so');
ok(shopAgentJson({ ...f, listed: false, live: false }, O, products, [set]).products.length === 0, 'a shop that can’t sell lists nothing');
const lines = policyLines(f);
ok(lines.some((l) => l.includes('$6.00 flat, free on orders of $60.00')) && lines.some((l) => l.includes('within 14 days') && l.includes('Return shipping is free') && l.includes('10% on unopened items, 50% on opened items') && l.includes('final sale')) && lines.some((l) => l.includes('Unworn items only.')) && lines.some((l) => l.includes('within 2 hours')), 'policies in words, from settings, with the shop’s own wording (review)', lines);
ok(policyLines({ ...f, returns: { ...f.returns, days: 0 } }).some((l) => l.includes('no time limit')), 'no limit said plainly');
const guide = shopGuideText(f, O, products, [set, tog], `${O}/book/opal`);
ok(guide.startsWith('# Opal & Co') && guide.includes(`- Product feed (Google Merchant format): ${O}/shop/opal/feed.xml`) && guide.includes('[Rose oil]') && guide.includes('from $24.00') && guide.includes('## Bundles and kits') && !guide.includes('/offer/t') && guide.includes(`Book a service: ${O}/book/opal`) && !/call us/i.test(guide), 'the plain-text guide', guide.slice(0, 900));
ok(!shopGuideText({ ...f, feed: false }, O, products, [], null).includes('feed.xml'), 'no feed link when the feed is off (review)');
ok(shopGuideText({ ...f, listed: false }, O, products, [], null).includes('not open right now') && shopGuideText(paused, O, products, [], null).includes('paused'), 'closed and paused shops say so');

// ── the cached rows are only what the public shop reads, and give the same catalog
const fat = inv.map((i) => ({ ...i, costPerUnit: 4.2, supplier: 'Acme', notes: 'x'.repeat(5000), batches: i.id === 'file' ? [{ stock: 1, expirationDate: '2000-01-01', cost: 3, supplierLot: 'L9' }, { stock: 3 }] : undefined, allocations: i.id === 'blush' ? { st1: { qty: 5, staffName: 'Maya' } } : i.id === 'resold' ? { b2: { qty: 1 } } : undefined }));
const trimmed = fat.map(publicRow);
const fatById = new Map<string, any>(fat.map((i) => [i.id, i])); const trimById = new Map<string, any>(trimmed.map((i: any) => [i.id, i]));
const a1 = JSON.stringify(catalogProducts(fat, fatById, listingsOf(fat), { wholesale: false, discountPct: 0, zone: Z }));
const a2 = JSON.stringify(catalogProducts(trimmed, trimById, listingsOf(trimmed), { wholesale: false, discountPct: 0, zone: Z }));
ok(a1 === a2, 'the trimmed rows make exactly the same catalog (expired batches and units handed out to stations included)');
ok(JSON.parse(a2).find((p: any) => p.id === 'oil').optionGroups[0].choices.find((c: any) => c.id === 'a').inStock === false, 'units handed out to stations aren’t counted as for sale (third review)');
ok(trimmed.every((r: any) => !('costPerUnit' in r) && !('supplier' in r) && !('notes' in r)) && !('cost' in (trimmed.find((r: any) => r.id === 'file').batches[0])), 'cost, suppliers and notes never go in the cache (second review)');
const pa = process.env.NEXT_PUBLIC_APP_ORIGIN; process.env.NEXT_PUBLIC_APP_ORIGIN = 'https://app.example/';
ok(seoOrigin({ publicOrigin: 'https://yourbrand.com' }) === 'https://app.example', 'search engines get the app’s address, never a business’s free-text link setting (second review)');
process.env.NEXT_PUBLIC_APP_ORIGIN = pa;

// ── wiring
const src = (p: string) => fs.readFileSync(p, 'utf8');
const feedRoute = src('src/app/shop/[tenantId]/feed.xml/route.ts'); const guideRoute = src('src/app/shop/[tenantId]/llms.txt/route.ts'); const jsonRoute = src('src/app/api/agents/[tenantId]/shop/route.ts');
ok(/loadPublicShop\(getAdminDb\(\), tenantId, \(t\) => !feedProblem/.test(feedRoute) && /loadPublicShop\(db, tenantId, \(t\) => agentPolicy\(t\)\.menu\)/.test(guideRoute) && /loadPublicShop\(getAdminDb\(\), tenantId, \(t\) => agentPolicy\(t\)\.menu\)/.test(jsonRoute), 'switches are checked before the catalog is read (review)');
ok([feedRoute, guideRoute, jsonRoute].every((r) => /no-store/.test(r)) && !/s-maxage[^\n]*none\(/.test(feedRoute), 'an off or missing answer isn’t cached (review)');
ok(/seoOrigin/.test(feedRoute) && /seoOrigin/.test(src('src/app/shop/[tenantId]/product/[productId]/layout.tsx')) && /seoOrigin/.test(src('src/app/shop/[tenantId]/layout.tsx')) && /seoOrigin/.test(src('src/app/sitemap.ts')), 'feed, markup, canonicals and sitemap name one address (review)');
ok(!/origin !== host/.test(src('src/app/sitemap.ts')) && /hasOwnPage/.test(src('src/app/sitemap.ts')) && /hasOwnPage/.test(src('src/lib/shop-public-server.ts')), 'together picks stay out of the sitemap and the shop data (review)');
ok(/cachedRating/.test(src('src/app/shop/[tenantId]/product/[productId]/layout.tsx')) && /unstable_cache/.test(src('src/lib/shop-public-server.ts')), 'ratings and the catalog are kept briefly, not read on every view (review)');
const screen = src('src/components/orders/DiscoveryScreen.tsx');
ok(!/#1a0dab|#4d5156/.test(screen) && !/\{\/\*/.test(screen) && !/call us/i.test(screen) && /feedProblem/.test(screen) && /variantIdsOf/.test(screen), 'the owner screen: palette, the reason a feed is off, variant-aware checks (review)');

console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
