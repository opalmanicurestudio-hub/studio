// Checks that a variant sells the same way everywhere (the independent review of Phase A, round 3): what a listing sets
// for how it's sold (pre-order, a download, made to order, weight, final sale, who it's sold for) applies to each of its
// variants that doesn't set it itself, in the shop, at checkout and in the shipping quote; a wholesale account pays
// the listing's wholesale discount off a variant's own price unless the variant has a wholesale price; a variant's order line is named as its listing
// and the variant; a variant's reviews show on its listing; a code made for a variant applies in the checkout preview;
// only a retail product is a listing; a choice that picks something else gets a new id; old variants are pointed at
// their listing the first time anything asks; the print catalog prints a listing once; the codes check lists choices
// that can't sell as set; restock requests made on a variant's old page still go out.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/variants-sold.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const sessions: any[] = []; const sent: any[] = [];
function StripeMock(this: any) {
  return {
    coupons: { create: async (p: any) => ({ id: `co_${p.amount_off}` }) },
    checkout: { sessions: { create: async (p: any) => { sessions.push(p); return { id: `cs_${sessions.length}`, url: 'https://stripe.test/x' }; } } },
    tax: { calculations: { create: async () => ({ id: 'tc', tax_amount_exclusive: 0 }) }, transactions: { createFromCalculation: async () => ({ id: 't' }) } },
  };
}
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe' || /node_modules\/stripe\//.test(request)) return fake(request, Object.assign(StripeMock, { default: StripeMock }));
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return fake(request, { initializeApp: () => ({ name: 'x' }), getApps: () => [], cert: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/notify' || request === './notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, m: any) => { sent.push(m); return { ok: true }; } });
  return load.call(this, request, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test_x';

const T = 'tenants/t1';
const fresh = () => { db = strictTransactions(makeDb()); sessions.length = 0; sent.length = 0; };
const put = (id: string, x: any) => db.doc(`${T}/inventory/${id}`).set({ id, type: 'retail', ...x });
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const url = (path: string, q: Record<string, string>) => ({ nextUrl: { searchParams: new URLSearchParams(q), origin: 'https://shop.example' }, url: `https://shop.example${path}`, headers: { get: () => null } }) as any;
const post = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.example' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const g = (choices: any[], extra: any[] = []) => [{ id: 'g0', name: 'Variant', choices }, ...extra];
const order = (x: any) => ({ tenantId: 't1', method: 'counter', customer: { name: 'Dana W', email: 'dana@example.com' }, ...x });

(async () => {
  const V = await import('../../src/lib/variants');
  const cat = (await import('../../src/app/api/retail/catalog/route')).GET;
  const prod = (await import('../../src/app/api/retail/product/route')).GET;
  const co = (await import('../../src/app/api/retail/checkout/route')).POST;
  // The page's sums: each line as the catalog sends it (lib/variants shopLine).
  const lineFor = (catalog: any, id: string, sel: Record<string, string>) => V.shopLine(catalog.body.products.find((p: any) => p.id === id), sel);

  // ── The rule ──
  const listing = { id: 'l', type: 'retail', name: 'Gel kit', preorder: true, preorderEtaAt: '2026-12-15', preorderLimit: 20, digital: true, digitalUrl: 'https://x/dl', leadDays: { min: 3, max: 5 }, allowBackorder: true, weightOz: 6, finalSale: true, soldFor: { renterId: 'r1', renterName: 'Maya', shopCutPct: 20 }, shipGroundOnly: true, showOnline: true, status: 'active', optionGroups: [] };
  const plain = V.asSold(listing, { id: 'v', type: 'retail', name: 'Pink', totalStock: 0 });
  check('a variant sells as its listing is set wherever it isn’t set itself: pre-order (with its date and places), a download, made to order, ahead of stock, weight, final sale, who it’s sold for, ground only',
    plain.preorder === true && plain.preorderEtaAt === '2026-12-15' && plain.preorderLimit === 20 && plain.digital === true && plain.digitalUrl === 'https://x/dl' && plain.leadDays.max === 5
    && plain.allowBackorder === true && plain.weightOz === 6 && plain.finalSale === true && plain.soldFor?.renterId === 'r1' && plain.shipGroundOnly === true && plain.name === 'Gel kit', plain);
  const own = V.asSold({ ...listing, preorder: false, digital: false }, { id: 'v', type: 'retail', preorder: true, preorderEtaAt: '2027-01-02', digital: true, digitalUrl: 'https://x/own', weightOz: 2, leadDays: { min: 1, max: 2 }, soldFor: { renterId: 'r2', renterName: 'Ivy' } });
  check('…and its own setting wins', own.preorderEtaAt === '2027-01-02' && own.digitalUrl === 'https://x/own' && own.weightOz === 2 && own.leadDays.max === 2 && own.soldFor.renterId === 'r2', own);
  check('a wholesale account pays a variant’s own wholesale price, else the listing’s wholesale discount off the variant’s own price ($60 at 50% off is $30), else the listing’s wholesale price',
    V.variantPriceCents({ msrp: 60 }, { msrp: 24, wholesalePriceDollars: 12 }, 'wholesale') === 3000 && V.variantPriceCents({}, { msrp: 24, wholesalePriceDollars: 12 }, 'wholesale') === 1200 && V.variantPriceCents({ msrp: 28, wholesalePriceDollars: 14 }, { msrp: 24, wholesalePriceDollars: 12 }, 'wholesale') === 1400
    && V.variantPriceCents({ msrp: 28 }, { msrp: 24 }, 'wholesale') === 2800);
  check('…a listing with no wholesale discount gives a variant its own price, and a wholesale price of 0 is no price at all',
    V.variantPriceCents({ msrp: 10 }, { msrp: 20, wholesalePriceDollars: 20 }, 'wholesale') === 1000 && (await import('../../src/lib/retail-orders')).listingPriceCents({ msrp: 24, wholesalePriceDollars: 0 } as any, 'wholesale') === 2400);
  {
    fresh();
    await put('l', { name: 'Kit', msrp: 50, wholesalePriceDollars: 25, optionGroups: g([{ id: 'a', label: 'A', variantProductId: 'va' }, { id: 'b', label: 'B', variantProductId: 'vb' }]) });
    await put('va', { name: 'A', msrp: 60, parentId: 'l' }); await put('vb', { name: 'B', msrp: 40, parentId: 'l' });
    await db.doc(`${T}/wholesaleAccounts/w1`).set({ extraDiscountPercent: 10 });
    const sw = await import('../../src/lib/retail-swap-server');
    const ws = await sw.catalogItem(db, 't1', 'vb', { priceTier: 'wholesale', wholesaleDiscountPct: 10 });
    const old = await sw.catalogItem(db, 't1', 'vb', { priceTier: 'wholesale', wholesaleAccountId: 'w1' });
    const rt = await sw.catalogItem(db, 't1', 'vb', { priceTier: 'retail' });
    check('a swap on a wholesale order is priced as checkout would charge it: wholesale, less the account’s discount (it used to be retail)', ws?.unitPriceCents === 1800 && old?.unitPriceCents === 1800 && rt?.unitPriceCents === 4000, { ws, old, rt });
  }
  check('only a retail product is a listing: an equipment item’s choices sell nothing',
    V.variantIdsOf({ id: 'e', type: 'equipment', optionGroups: g([{ id: 'a', label: 'A', variantProductId: 'p' }]) }).length === 0 && V.variantIdsOf({ id: 'r', optionGroups: g([{ id: 'a', label: 'A', variantProductId: 'p' }]) }).join() === 'p');
  const two = { id: 'l2', type: 'retail', optionGroups: g([{ id: 'a', label: '15 ml', variantProductId: 's' }], [{ id: 'g1', name: 'Size', choices: [{ id: 'b', label: '30 ml', variantProductId: 't' }, { id: 'w', label: 'Gift wrap', deltaCents: 250 }] }]) };
  const shownTwo = V.shopOptionGroups(two, new Map([['s', { id: 's', type: 'retail', totalStock: 3 }], ['t', { id: 't', type: 'retail', totalStock: 3 }]]));
  check('a choice outside the variants group that picks a product (saved before) isn’t offered, and isn’t sold from an old cart',
    shownTwo[1].choices.map((c: any) => c.id).join() === 'w' && V.choiceSale(two, { g0: 'a', g1: 'b' }).unknown.join() === 'Size' && V.strayLinks(two).length === 1);
  const shared = { id: 'b', type: 'retail', optionGroups: g([{ id: 'x', label: 'Gold', variantProductId: 'gold' }]) };
  const sh = V.shopOptionGroups(shared, new Map([['gold', { id: 'gold', type: 'retail', totalStock: 4, parentId: 'a' }]]));
  check('a variant another listing sells shows sold out here (an old link two listings shared sells under the one it points at)', sh[0].choices[0].inStock === false && sh[0].choices[0].live === false);
  const runs = V.shopOptionGroups({ id: 'k', type: 'retail', msrp: 40, optionGroups: g([{ id: 'p', label: 'Pink', variantProductId: 'pink' }]) },
    new Map([['pink', { id: 'pink', type: 'retail', totalStock: 0, preorder: true, preorderEtaAt: '2099-01-01', preorderLimit: 10, preorderSold: 7 }]]));
  check('a pre-order variant offers the places left in its run, not 99', runs[0].choices[0].qtyAvailable === 3 && runs[0].choices[0].preorder?.open === true && runs[0].choices[0].preorder?.etaAt === '2099-01-01', runs[0].choices[0]);

  // ── A. A variant on pre-order, its listing not ──
  fresh();
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
  await put('oil', { name: 'Rose oil', msrp: 24, showOnline: true, totalStock: 0, optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }, { id: 'b', label: 'Clear', variantProductId: 'clear' }]) });
  await put('blush', { name: 'Blush', totalStock: 0, preorder: true, preorderEtaAt: '2099-12-15', parentId: 'oil' });
  await put('clear', { name: 'Clear', totalStock: 0, parentId: 'oil' });
  let c: any = await cat(url('/api/retail/catalog', { tenantId: 't1' }));
  let l = lineFor(c, 'oil', { g0: 'a' });
  check('a variant on pre-order: the shop sells that choice as a pre-order, with its ship-by date (the cart asks for the tick)', l.inStock === true && l.preorder?.open === true && l.preorder?.etaAt === '2099-12-15', l);
  let r: any = await co(post(order({ items: [{ productId: 'oil', qty: 1, selections: { g0: 'a' } }] })));
  check('…checkout wants the tick the page shows', r.status === 422 && r.body.needsPreorderAck === true, r.body);
  r = await co(post(order({ items: [{ productId: 'oil', qty: 1, selections: { g0: 'a' } }], preorderAck: true })));
  let o: any = r.body?.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('…and takes it as a pre-order line named as the listing and the variant', r.status === 200 && o?.lines?.[0]?.preorder === true && o.lines[0].name === 'Rose oil · Blush', o?.lines?.[0]);
  const pg: any = await prod(url('/api/retail/product', { tenantId: 't1', productId: 'oil' }));
  check('…and the product page’s data says so for that choice', pg.body.product.optionGroups[0].choices[0].preorder?.open === true && pg.body.product.optionGroups[0].choices[1].preorder === null);

  // ── B. The listing on pre-order, its variants not ──
  fresh();
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
  await put('kit', { name: 'Gel kit', msrp: 40, showOnline: true, totalStock: 0, preorder: true, preorderEtaAt: '2099-12-15', optionGroups: g([{ id: 'a', label: 'Pink', variantProductId: 'pink' }, { id: 'b', label: 'Nude', variantProductId: 'nude' }]) });
  await put('pink', { name: 'Pink', totalStock: 0, parentId: 'kit' });
  await put('nude', { name: 'Nude', totalStock: 0, parentId: 'kit' });
  c = await cat(url('/api/retail/catalog', { tenantId: 't1' }));
  const kit = c.body.products.find((x: any) => x.id === 'kit');
  check('a listing on pre-order: in stock, and each variant sells on its run', kit.inStock === true && lineFor(c, 'kit', { g0: 'b' }).preorder?.open === true, kit.optionGroups[0].choices);
  r = await co(post(order({ items: [{ productId: 'kit', qty: 2, selections: { g0: 'a' } }], preorderAck: true })));
  o = r.body?.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('…and checkout takes it as a pre-order (it used to refuse it for stock)', r.status === 200 && o?.lines?.[0]?.preorder === true && o.lines[0].preorderEtaAt === '2099-12-15', r.body);

  // ── C. A download as one variant of a physical listing ──
  fresh();
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: { flatShippingDollars: 8 } });
  await put('book', { name: 'Nail book', msrp: 30, showOnline: true, totalStock: 0, weightOz: 12, optionGroups: g([{ id: 'p', label: 'Paperback', variantProductId: 'paper' }, { id: 'e', label: 'Ebook', variantProductId: 'ebook' }]) });
  await put('paper', { name: 'Paperback', totalStock: 5, parentId: 'book' });
  await put('ebook', { name: 'Ebook', totalStock: 0, digital: true, digitalUrl: 'https://x.example/dl', parentId: 'book' });
  c = await cat(url('/api/retail/catalog', { tenantId: 't1' }));
  check('an ebook variant: the cart knows that line is a download (no address, no shipping), the paperback isn’t', lineFor(c, 'book', { g0: 'e' }).digital === true && lineFor(c, 'book', { g0: 'p' }).digital === false);
  r = await co(post(order({ method: 'counter', items: [{ productId: 'book', qty: 1, selections: { g0: 'e' } }] })));
  o = r.body?.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('…and checkout charges what the page shows (no shipping)', r.status === 200 && o?.shippingCents === 0 && o?.totalCents === 3000 && o.lines[0].digital === true, o && { s: o.shippingCents, t: o.totalCents });

  // ── D. A listing set as a download: its variants are downloads too ──
  fresh();
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: { pickupEnabled: false, curbsideOffered: false } });
  await put('course', { name: 'Gel course', msrp: 50, showOnline: true, digital: true, digitalUrl: 'https://x.example/course', optionGroups: g([{ id: 'b', label: 'Basic', variantProductId: 'basic' }]) });
  await put('basic', { name: 'Basic', totalStock: 3, parentId: 'course' });
  c = await cat(url('/api/retail/catalog', { tenantId: 't1' }));
  r = await co(post(order({ method: 'counter', items: [{ productId: 'course', qty: 1, selections: { g0: 'b' } }] })));
  o = r.body?.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('a listing set as a download sells its variants as downloads, at a shop with pickup off', lineFor(c, 'course', { g0: 'b' }).digital === true && r.status === 200 && o?.lines?.[0]?.digital === true && o.lines[0].digitalUrl === 'https://x.example/course', r.body);

  // ── Order lines, a variant another listing sells, renters ──
  fresh();
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
  await put('oil', { name: 'Rose oil', msrp: 24, showOnline: true, soldFor: { renterId: 'r1', renterName: 'Maya', shopCutPct: 20 }, optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }, { id: 'b', label: 'Gold', variantProductId: 'gold' }], [{ id: 'g1', name: 'Gift wrap', choices: [{ id: 'n', label: 'No wrap' }, { id: 'w', label: 'Gift wrap', deltaCents: 250 }] }]) });
  await put('blush', { name: 'Blush', totalStock: 5, parentId: 'oil' });
  await put('gold', { name: 'Gold', totalStock: 5, msrp: 28 });
  // Two listings pick Gold (saved before the rules): the build gives it to the first, "aaa".
  await put('aaa', { name: 'Other oil', msrp: 20, showOnline: true, optionGroups: g([{ id: 'x', label: 'Gold', variantProductId: 'gold' }]) });
  await (await import('../../src/lib/code-index')).buildCodeIndex(db, 't1');
  r = await co(post(order({ items: [{ productId: 'oil', qty: 1, selections: { g0: 'a', g1: 'w' } }] })));
  o = r.body?.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('a variant’s line is named “Listing · Variant”, with the other choices under it (the payment page tells two variants apart)',
    o?.lines?.[0]?.name === 'Rose oil · Blush' && o.lines[0].optionsLabel === 'Gift wrap' && o.lines[0].listingId === 'oil' && sessions[sessions.length - 1]?.line_items?.some((li: any) => /Rose oil · Blush/.test(li.price_data?.product_data?.name || '')), { line: o?.lines?.[0], stripe: sessions[sessions.length - 1]?.line_items?.map((li: any) => li.price_data?.product_data?.name) });
  check('…and a listing sold for a renter credits the renter for its variants’ sales', o?.lines?.[0]?.soldFor?.renterId === 'r1', o?.lines?.[0]?.soldFor);
  r = await co(post(order({ items: [{ productId: 'oil', qty: 1, selections: { g0: 'b' } }] })));
  check('a variant another listing sells isn’t sold here', (await get(`${T}/inventory/gold`)).parentId === 'aaa' && r.status === 409 && /no longer available/.test(r.body.error), r.body);

  // ── An old variant without its pointer ──
  fresh();
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
  await put('oil', { name: 'Rose oil', msrp: 24, showOnline: true, optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }]) });
  await put('blush', { name: 'Blush oil', totalStock: 5, msrp: 22, showOnline: true });
  // The nightly job (and checkout) points it; a visitor's page load only reads.
  await (await import('../../src/lib/code-index')).ensureCodeIndex(db, 't1');
  let pr: any = await prod(url('/api/retail/product', { tenantId: 't1', productId: 'blush' }));
  check('a variant saved before variants knew their listing is pointed at it by the nightly job, and then opens the listing', pr.status === 404 && pr.body.listing?.id === 'oil' && (await get(`${T}/inventory/blush`)).parentId === 'oil', pr.body);
  fresh();
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
  await put('oil', { name: 'Rose oil', msrp: 24, showOnline: true, optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }]) });
  await put('blush', { name: 'Blush oil', totalStock: 5, msrp: 22, showOnline: true });
  r = await co(post(order({ items: [{ productId: 'blush', qty: 1 }] })));
  check('…and an old cart holding it on its own is refused at checkout (it used to sell under its own name)', r.status === 409 && /on its own/.test(r.body.error), r.body);
  check('…the swap catalog, the nightly checks and the shipping quote ask the same way',
    /await ensureCodeIndex\(db, t\)\.catch\(\(\) => \{\}\);/.test(src('src/lib/retail-swap-server.ts')) && /try \{ await ensureCodeIndex\(db, tenantId\); \}/.test(src('src/lib/retail-nightly.ts'))
    && /const sale = choiceSale\(d, it\.selections/.test(src('src/app/api/retail/shipping-quote/route.ts')) && /d = asSold\(d, \{ \.\.\.\(vs\.data\(\) as any\), id: vs\.id \}\);/.test(src('src/app/api/retail/shipping-quote/route.ts')));

  // ── The checkout preview of a promo code made for a variant ──
  fresh();
  await db.doc(T).set({ name: 'Opal', retailSettings: {} });
  await put('oil', { name: 'Rose oil', msrp: 24, showOnline: true, optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }]) });
  await put('blush', { name: 'Blush', totalStock: 5, parentId: 'oil' });
  await db.doc(`${T}/discounts/d1`).set({ id: 'd1', code: 'BLUSH10', name: 'Blush', type: 'percentage', value: 10, isActive: true, appliesTo: 'shop', applicableProductIds: ['blush'] });
  const promo = (await import('../../src/app/api/retail/promo/route')).POST;
  r = await promo(post({ tenantId: 't1', code: 'BLUSH10', items: [{ productId: 'oil', selections: { g0: 'a' }, qty: 1, unitPriceCents: 2400 }] }));
  check('a code made for one variant applies in the checkout page’s preview, as it will at checkout', r.body?.ok === true && r.body.cents === 240, r.body);

  // ── Reviews ──
  fresh();
  await put('oil', { name: 'Rose oil', msrp: 24, showOnline: true, optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }, { id: 'b', label: 'Gold', variantProductId: 'gold' }]) });
  await db.doc(`${T}/retailOrders/o1`).set({ qrToken: 'tok', stage: 'completed', orderNumber: 7, customerName: 'Dana W', lines: [{ lineId: 'L1', productId: 'blush', listingId: 'oil', name: 'Rose oil · Blush' }] });
  await db.doc(`${T}/retailReviews/old`).set({ id: 'old', productId: 'gold', status: 'published', rating: 4, body: 'Lovely gold', createdAt: '2026-01-01' });
  const reviews = await import('../../src/app/api/retail/reviews/route');
  r = await reviews.POST(post({ tenantId: 't1', orderId: 'o1', qrToken: 'tok', productId: 'blush', rating: 5, body: 'Lovely blush', name: 'Dana W' }));
  const rv: any = await reviews.GET(url('/api/retail/reviews', { tenantId: 't1', productId: 'oil' }));
  check('a variant’s review is filed with its listing, and the listing’s page shows its variants’ reviews (older ones too)', r.status === 200 && (await get(`${T}/retailReviews/o1__blush`))?.listingId === 'oil' && rv.body.count === 2, rv.body);

  // ── Choices: a re-pointed choice gets a new id; the editor never reuses one ──
  fresh();
  const ci = await import('../../src/lib/code-index');
  await put('oil', { name: 'Rose oil', msrp: 24, showOnline: true });
  await put('blush', { name: 'Blush', totalStock: 5 }); await put('gold', { name: 'Gold', totalStock: 5 }); await put('clear', { name: 'Clear', totalStock: 5 });
  await ci.buildCodeIndex(db, 't1');
  await ci.saveListingChoices(db, 't1', 'oil', g([{ id: 'c0-0', label: 'Blush', variantProductId: 'blush' }, { id: 'c0-1', label: 'Gold', variantProductId: 'gold' }]), 'K');
  await ci.saveListingChoices(db, 't1', 'oil', g([{ id: 'c0-0', label: 'Blush', variantProductId: 'blush' }, { id: 'c0-1', label: 'Clear', variantProductId: 'clear' }]), 'K');
  const oilNow: any = { ...(await get(`${T}/inventory/oil`)), id: 'oil' };
  check('a choice that now picks another product gets a new id, so a cart holding the old one is asked to choose again (it used to buy the other product)',
    V.choiceSale(oilNow, { g0: 'c0-1' }).unknown.length === 1 && oilNow.optionGroups[0].choices[1].id !== 'c0-1' && oilNow.optionGroups[0].choices[0].id === 'c0-0', oilNow.optionGroups);
  check('…and the editor gives each new choice an id never used before', /const freshId = \(p: string\) =>/.test(src('src/components/inventory/OnlineListingTab.tsx')) && /\{ id: freshId\('c'\), label: '', deltaCents: 0 \}/.test(src('src/components/inventory/OnlineListingTab.tsx')) && !/id: `c\$\{gi\}-\$\{g\.choices\.length\}`/.test(src('src/components/inventory/OnlineListingTab.tsx')));

  // ── The codes check lists choices that can't sell as set ──
  fresh();
  await put('a', { name: 'Rose oil', msrp: 24, showOnline: true, optionGroups: g([{ id: 'x', label: 'Gold', variantProductId: 'gold' }]) });
  await put('b', { name: 'Other oil', msrp: 20, showOnline: true, optionGroups: g([{ id: 'y', label: 'Gold', variantProductId: 'gold' }]) });
  await put('gold', { name: 'Gold', totalStock: 3 });
  await put('c', { name: 'Hand cream', msrp: 18, showOnline: true, optionGroups: g([{ id: 's', label: '15 ml', variantProductId: 'small' }], [{ id: 'g1', name: 'Size', choices: [{ id: 'l', label: '30 ml', variantProductId: 'large' }] }]) });
  await put('small', { name: 'Small', totalStock: 2 }); await put('large', { name: 'Large', totalStock: 2 });
  const chk: any = await ci.codesCheck(db, 't1');
  check('the codes check lists a variant two listings pick, and a variant outside its listing’s variants', chk.counts.choices === 2 && chk.choices.some((x: any) => x.productId === 'b' && /also a variant of Rose oil/.test(x.why)) && chk.choices.some((x: any) => x.productId === 'c' && /30 ml/.test(x.why)), chk.choices);
  check('…shown on the codes page as a fifth count only when there’s something to fix', /t\.id !== 'choices' \|\| \(data\?\.counts\.choices \|\| 0\) > 0/.test(src('src/app/(app)/inventory/codes/page.tsx')));

  // ── Restock requests made on a variant's own page before ──
  fresh();
  await db.doc(T).set({ name: 'Opal' });
  await put('oil', { name: 'Rose oil', msrp: 24, showOnline: true, optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }]) });
  await put('blush', { name: 'Blush', totalStock: 3, parentId: 'oil' });
  await db.doc(`${T}/restockAlerts/blush_x`).set({ id: 'blush_x', productId: 'blush', productName: 'Blush', email: 'a@example.com', notifiedAt: null });
  const ra = await import('../../src/lib/restock-alerts');
  const out: any[] = [];
  const n = await ra.sendRestockAlerts(db, 't1', 'https://shop.example', { send: async (_d: any, m: any) => { out.push(m); return { ok: true }; } });
  check('a back-in-stock request made on a variant’s own page still goes out, opening its listing with it picked', n === 1 && /\/product\/oil\?choice=a/.test(out[0]?.html || '') && /Rose oil · Blush is back/.test(out[0]?.subject || ''), out[0]?.subject);
  check('…and asking again through the listing gives the waiting request its listing', /else if \(choiceId && existing\.data\(\)\?\.listingId !== productId\) await ref\.set\(\{ productName: name, listingId: productId, choiceId \}, \{ merge: true \}\);/.test(src('src/app/api/retail/restock-alert/route.ts')));

  // ── The print catalog ──
  fresh();
  await db.doc(T).set({ name: 'Opal', retailSettings: {} });
  await put('oil', { name: 'Rose oil', msrp: 24, wholesalePriceDollars: 12, showOnline: true, optionGroups: g([{ id: 'a', label: 'Blush', variantProductId: 'blush' }, { id: 'b', label: 'Gold', variantProductId: 'gold' }]) });
  await put('blush', { name: 'Rose oil Blush', totalStock: 5, parentId: 'oil' });
  await put('gold', { name: 'Rose oil Gold', totalStock: 5, msrp: 28, parentId: 'oil' });
  const React = await import('react'); (globalThis as any).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const Page = (await import('../../src/app/print/catalog/[tenantId]/page')).default;
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ tenantId: 't1' }), searchParams: Promise.resolve({ tier: 'retail', qr: '0' }) }) as any);
  check('the printed catalog prints a listing once, with its variants and “From” its lowest price', /<p class="nm">Rose oil<\/p>/.test(html) && /Blush · Gold/.test(html) && /From \$24\.00/.test(html) && !/Rose oil Blush|Rose oil Gold/.test(html));
  const ws = renderToStaticMarkup(await Page({ params: Promise.resolve({ tenantId: 't1' }), searchParams: Promise.resolve({ tier: 'wholesale', qr: '0' }) }) as any);
  check('…and the wholesale line sheet needs a wholesale account’s code or the team’s print key (anyone else gets the retail catalog)', !/\$12\.00/.test(ws) && /Product catalog/.test(ws)
    && /tier=wholesale&code=\$\{encodeURIComponent\(readWholesaleCode\(tenantId\)/.test(src('src/components/shop/ShopMenu.tsx')) && /catalog: \(\) => true,/.test(src('src/app/api/print-key/route.ts'))
    && /openPrint\(String\(tenantId \|\| ''\), 'catalog', `\/print\/catalog\/\$\{tenantId\}\?tier=wholesale`\)/.test(src('src/app/(app)/retail-orders/settings/page.tsx')));

  // ── The desk and the host stand ──
  const calc = await import('../../src/lib/checkout-calc');
  const cc: any = (calc as any).computeCheckout || (calc as any).checkoutTotals || null;
  const memberSrc = src('src/lib/checkout-calc.ts');
  check('a membership discount on a listing covers its variants at the desk (screen and server)', /eligible\.includes\(String\(\(it as any\)\.listingId\)\)/.test(memberSrc) && /eligibleProductIds\.includes\(String\(\(item as any\)\.listingId\)\)/.test(src('src/components/pos/usePosEngine.tsx')), !!cc);
  check('the host stand’s tab prices products as the desk sells them (variants in their listing’s place, nothing without a price)', /price: deskPrice\(x, listings\)/.test(src('src/components/host/TableTab.tsx')) && /name: saleName\(x, listings\)/.test(src('src/components/host/TableTab.tsx')) && /\.filter\(\(x: any\) => x\.price > 0\)/.test(src('src/components/host/TableTab.tsx')));

  // ── Pre-order runs, the shop's pages, the sitemap ──
  const inRun = V.inRunOf('kit', new Set(['own']));
  check('a listing’s pre-order run covers its variants’ orders (not a variant with a run of its own)', inRun({ productId: 'kit' }) && inRun({ productId: 'pink', listingId: 'kit' }) && !inRun({ productId: 'own', listingId: 'kit' }) && !inRun({ productId: 'x' })
    && /const inRun = inRunOf\(productId, await ownRunsOf\(db, tenantId, productId\)\);/.test(src('src/app/api/retail/preorder-run-eta/route.ts')) && /const inRun = inRunOf\(productId, await ownRunsOf\(db, tenantId, productId\)\);/.test(src('src/app/api/retail/preorder-run-cancel/route.ts')));
  const page = src('src/app/shop/[tenantId]/product/[productId]/page.tsx');
  check('the product page reads how the chosen variant sells (pre-order, download, made to order)', /const sold: any = vc \?/.test(page) && !/\(product as any\)\.preorder\?\.isPreorder/.test(page) && /sold\.preorder\?\.isPreorder/.test(page));
  const cp = src('src/app/shop/[tenantId]/checkout/page.tsx');
  check('the checkout page reads each line’s variant for the pre-order tick, a download and the ship-by date, and sends the choices with the shipping quote and the promo code',
    /cartEntries\.every\(\(\[key\]\) => lineOf\(key\)\?\.digital === true\)/.test(cp) && /return l\?\.preorder\?\.open === true/.test(cp) && /items: cartEntries\.map\(\(\[key, qty\]\) => \(\{ \.\.\.parseCartKey\(key\), qty \}\)\)/.test(cp) && /selections: k\.selections/.test(cp));
  check('…and takes out of the cart what the shop doesn’t list any more, saying so (the cart badge used to count it)', /setDropped\(\(d\) => d \+ gone\.length\)/.test(cp) && /isn’t in the shop any more, so it was taken out/.test(cp));
  const catSrc = src('src/lib/shop-catalog.ts');
  check('the grid never says “From $0.00” and says “From” only when live variants cost different amounts', /const liveCs: any\[\] = vg \? vg\.choices\.filter\(\(c: any\) => c\.live !== false\) : \[\];/.test(catSrc) && /priceVaries: !!vg && new Set\(liveCs\.map/.test(catSrc));
  check('the sitemap leaves out only a variant a listing still sells (one whose listing was deleted has a page of its own)', /listedInShop\(item, listings\) \|\| soldInside\(item\)/.test(src('src/app/sitemap.ts')));
  check('Shop settings shows how each variant sells under its listing (its own wholesale price and weight, and a setting of its own put back to the listing’s)',
    /<VariantSettings firestore=/.test(src('src/app/(app)/retail-orders/settings/page.tsx')) && /Use the listing’s/.test(src('src/components/retail/VariantSettings.tsx')));

  // ── E. A listing's pre-order run, shared by its variants (second review) ──
  fresh();
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
  await put('kit', { name: 'Gel kit', msrp: 40, showOnline: true, status: 'active', totalStock: 0, preorder: true, preorderEtaAt: '2099-12-15', preorderLimit: 3, preorderSold: 1, optionGroups: g([{ id: 'a', label: 'Pink', variantProductId: 'pink' }, { id: 'b', label: 'Nude', variantProductId: 'nude' }, { id: 'c', label: 'Red', variantProductId: 'red' }]) });
  await put('pink', { name: 'Pink', status: 'active', totalStock: 12, parentId: 'kit' });
  await put('nude', { name: 'Nude', status: 'active', totalStock: 0, parentId: 'kit' });
  await put('red', { name: 'Red', status: 'active', totalStock: 0, parentId: 'kit' });
  c = await cat(url('/api/retail/catalog', { tenantId: 't1' }));
  const pinkLine = lineFor(c, 'kit', { g0: 'a' }); const nudeLine = lineFor(c, 'kit', { g0: 'b' });
  check('a listing on pre-order: a variant with stock on the shelf sells from the shelf, not as a pre-order', !pinkLine.preorder?.isPreorder && pinkLine.inStock === true && nudeLine.preorder?.open === true, { pinkLine, nudeLine });
  r = await co(post(order({ items: [{ productId: 'kit', qty: 2, selections: { g0: 'a' } }] })));
  o = r.body?.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('…and checkout takes it as a shelf sale (no pre-order tick, no ship-by date)', r.status === 200 && o?.lines?.[0]?.preorder !== true, r.body);
  check('the run’s places are the listing’s, counted across its variants: 2 left of 3 for each of them', nudeLine.qtyAvailable === 2 && lineFor(c, 'kit', { g0: 'c' }).qtyAvailable === 2, nudeLine);
  r = await co(post(order({ items: [{ productId: 'kit', qty: 2, selections: { g0: 'b' } }, { productId: 'kit', qty: 1, selections: { g0: 'c' } }], preorderAck: true })));
  check('…two variants in one cart share them: 3 places asked for when 2 are left is refused, saying how many are left', r.status === 409 && /Only 2 pre-order places are left/.test(r.body.error), r.body);
  r = await co(post(order({ items: [{ productId: 'kit', qty: 1, selections: { g0: 'b' } }, { productId: 'kit', qty: 1, selections: { g0: 'c' } }], preorderAck: true })));
  o = r.body?.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('…2 of them are taken, each line marked with its listing’s run', r.status === 200 && o?.lines?.every((x: any) => x.preorder === true && x.preorderRunId === 'kit'), o?.lines);
  const { payOrder } = await import('../../src/lib/order-paid');
  const paid: any = r.body?.orderId ? await payOrder(db, 't1', r.body.orderId, { via: 'card', session: { id: 'cs_9', payment_intent: 'pi_9', amount_total: o.totalCents, payment_status: 'paid', total_details: { amount_tax: 0 }, metadata: { retailOrderId: r.body.orderId } }, chargeId: 'ch_9', connAcct: 'acct_1', clientId: 'c1', risk: null } as any) : null;
  const kitNow = await get(`${T}/inventory/kit`);
  check('…and paid, they’re counted on the listing’s run, not on each variant', paid?.won === true && kitNow.preorderSold === 3 && !(await get(`${T}/inventory/nude`)).preorderSold && !(await get(`${T}/inventory/red`)).preorderSold, { paid, sold: kitNow.preorderSold });
  c = await cat(url('/api/retail/catalog', { tenantId: 't1' }));
  r = await co(post(order({ items: [{ productId: 'kit', qty: 1, selections: { g0: 'b' } }], preorderAck: true })));
  check('…then the run is full for every variant', r.status === 409 && /are full/.test(r.body.error) && lineFor(c, 'kit', { g0: 'c' }).inStock === false && lineFor(c, 'kit', { g0: 'c' }).variantChoice?.preorder?.reason === 'sold_out', { body: r.body, red: lineFor(c, 'kit', { g0: 'c' }), raw: c.body.products.find((p: any) => p.id === 'kit')?.optionGroups?.[0]?.choices?.[2] });
  await put('closed', { name: 'Old run', msrp: 10, showOnline: true, status: 'active', totalStock: 0, preorder: true, preorderEtaAt: '2099-12-15', preorderClosesAt: '2020-01-01' });
  r = await co(post(order({ items: [{ productId: 'closed', qty: 1 }], preorderAck: true })));
  check('a pre-order run that has closed takes no more orders (checkout used to take them)', r.status === 409 && /have closed/.test(r.body.error), r.body);
  const before = (db as any).dump ? Object.keys((db as any).dump()).length : null;
  const ghost: any = await prod(url('/api/retail/product', { tenantId: 'no-such-shop', productId: 'x' }));
  check('a product page for a shop that doesn’t exist writes nothing', ghost.status === 404 && !(await db.doc('tenants/no-such-shop/private/codeIndex').get()).exists && !/ensureCodeIndex/.test(src('src/app/api/retail/product/route.ts')), before);

  // Wording: variants, never shades; no emojis.
  const files = ['src/lib/variants.ts', 'src/components/retail/VariantSettings.tsx', 'src/app/print/catalog/[tenantId]/page.tsx', 'src/app/(app)/inventory/codes/page.tsx', 'src/app/shop/[tenantId]/checkout/page.tsx'].map(src).join('\n');
  check('the new words say variants, never shades, and carry no emojis', !/\bshades?\b/i.test(files.replace(/var\(--[^)]*\)/g, '')) && !/[\u{1F300}-\u{1FAFF}]/u.test(files));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
