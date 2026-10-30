// scripts/verify/shop-home.verify.ts — the shop's home page in each of the five layouts (components/shop/home): every
// layout shows a welcome (unless the owner built their own hero) and the catalog, cards keep the bag rules (sold out,
// choose options, wholesale minimum, quantity limits), and shop grids follow their wider-screen columns.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/shop-home.verify.ts
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HomeItem, HomeBag } from '../../src/components/shop/home/HomeLayouts';
import { SITE_LAYOUTS, type SiteLayout } from '../../src/lib/shop-site';

// Outside a Next server the image component has no host list; render photos as plain images for these checks.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Mod: any = require('module'); const load = Mod._load;
Mod._load = function (req: string, ...rest: any[]) {
  if (req === 'next/image') { const Img = ({ fill, priority, sizes, ...p }: any) => React.createElement('img', p); return { __esModule: true, default: Img }; }
  return load.call(this, req, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HomeCatalog, HomeIntro, spotlightPick }: typeof import('../../src/components/shop/home/HomeLayouts') = require('../../src/components/shop/home/HomeLayouts');

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 500)); } else console.log('  ✓', m); };

const item = (i: number, extra: Partial<HomeItem> = {}): HomeItem => ({ id: 'p' + i, name: 'Item ' + i, category: i % 2 ? 'Care' : 'Tools', description: 'About item ' + i, imageUrls: [`https://cdn.example.com/${i}.jpg`], priceCents: 1000 + i * 100, wholesalePriceCents: null, wholesaleMinQty: null, inStock: true, qtyAvailable: 3, lowStock: false, ...extra });
const products = [item(0, { imageUrls: [], inStock: false }), item(1, { lowStock: true }), item(2, { optionGroups: [{ id: 'g' }], priceVaries: true }), item(3), item(4), item(5)];
const cart: Record<string, number> = { p3: 3 };
const bag: HomeBag = { tenantId: 't1', wholesale: false, priceOf: (p) => p.priceCents, qtyOf: (p) => cart[p.id] ?? 0, onAdd: () => {}, onQty: () => {} };
const cats = ['all', '__gift', 'Care', 'Tools'];
const html = (el: React.ReactElement) => { try { return renderToStaticMarkup(el); } catch (e) { return 'ERROR ' + String(e); } };

// ── the Spotlight pick
ok(spotlightPick(products)?.id === 'p1', 'Spotlight tells the first in-stock product with a photo');
ok(spotlightPick([item(0, { imageUrls: [], inStock: true }), item(1, { inStock: false })])?.id === 'p0', 'without photos, the first in stock');
ok(spotlightPick([item(0, { inStock: false })])?.id === 'p0' && spotlightPick([]) === null, 'everything sold out: the first; nothing: none');

for (const l of SITE_LAYOUTS) {
  const layout = l.id as SiteLayout;
  const intro = html(React.createElement(HomeIntro, { layout, name: 'Opal <Studio>', tagline: '', products, categories: ['all', 'Care', 'Tools'], bag, dark: false, delivery: 'Free delivery over $60', hasGift: true, onShop: () => {}, onPickCategory: () => {} }));
  ok(!intro.startsWith('ERROR') && intro.includes('id="home-welcome"') && !/<h1/.test(intro), `${l.name}: a welcome with its own heading (the logo keeps the page's h1)`, intro.slice(0, 300));
  ok(!intro.includes('<Studio>'), `${l.name}: the shop name is escaped`);
  const grid = html(React.createElement(HomeCatalog, { layout, cardStyle: 'grid', products, categories: cats, category: 'all', setCategory: () => {}, giftTile: React.createElement('div', { id: 'gift-tile' }), bag, dark: false, skipId: null }));
  ok(!grid.startsWith('ERROR') && grid.includes('id="shop-catalog"') && grid.includes('id="gift-tile"'), `${l.name}: the catalog, with the gift card tile`, grid.slice(0, 300));
  ok(grid.includes('Sold out') && !grid.includes('aria-label="Add Item 0 to bag"'), `${l.name}: a sold-out item can't be added`);
  ok(grid.includes('href="/shop/t1/product/p2"') && grid.includes('Choose options for Item 2') && !grid.includes('aria-label="Add Item 2 to bag"'), `${l.name}: an item with choices goes to its page to choose`);
  ok(grid.includes('From $12.00'), `${l.name}: prices that vary say From`);
  ok(/Increase quantity of Item 3"[^>]*disabled/.test(grid) || /disabled=""[^>]*aria-label="Increase quantity of Item 3"/.test(grid) || /<button[^>]*disabled[^>]*Increase quantity of Item 3/.test(grid), `${l.name}: no more than are in stock can be added`);
  ok(grid.includes('Almost gone'), `${l.name}: low stock is marked`);
  ok(grid.includes('aria-pressed="true"') && grid.includes('Gift cards'), `${l.name}: categories show which is chosen, gift cards among them`);
  const list = html(React.createElement(HomeCatalog, { layout, cardStyle: 'list', products: products.filter((p) => p.category === 'Care'), categories: cats, category: 'Care', setCategory: () => {}, giftTile: React.createElement('div', { id: 'gift-tile' }), bag, dark: false }));
  ok(!list.includes('id="gift-tile"') && !list.includes('Item 0') && list.includes('Item 1') && list.includes('flex flex-col gap-3'), `${l.name}: the owner's list style and a chosen category are kept`);
}

// ── Spotlight doesn't show its big product twice; Index sorts and filters
const sp = html(React.createElement(HomeCatalog, { layout: 'spotlight', cardStyle: 'grid', products, categories: cats, category: 'all', setCategory: () => {}, giftTile: null, bag, dark: false, skipId: 'p1' }));
ok(!sp.includes('Item 1<') && sp.includes('Item 3'), 'Spotlight leaves its big product out of the grid below');
const ix = html(React.createElement(HomeCatalog, { layout: 'index', cardStyle: 'grid', products, categories: cats, category: 'all', setCategory: () => {}, giftTile: null, bag, dark: false }));
ok(ix.includes('In stock only') && ix.includes('Price, low to high') && ix.includes('6 products'), 'Index has a count, sorting and an in-stock filter');

const solo = html(React.createElement(HomeCatalog, { layout: 'spotlight', cardStyle: 'grid', products: [item(1)], categories: ['all'], category: 'all', setCategory: () => {}, giftTile: null, bag, dark: false, skipId: 'p1' }));
ok(solo === '', 'a Spotlight shop with one product shows it big, without an empty list below');
const bento = html(React.createElement(HomeCatalog, { layout: 'bento', cardStyle: 'grid', products, categories: cats, category: 'all', setCategory: () => {}, giftTile: React.createElement('div', { id: 'gift-tile' }), bag, dark: false }));
ok(bento.includes('grid-flow-dense') && bento.includes('col-span-2'), 'Bento fills the gap a gift card tile leaves beside the big card');
ok(!/aria-live="polite">\d/.test(grid0()), 'quantity counts are not announced on their own (the buttons name the product)');
function grid0() { return html(React.createElement(HomeCatalog, { layout: 'atelier', cardStyle: 'grid', products, categories: cats, category: 'all', setCategory: () => {}, giftTile: null, bag, dark: false })); }
ok(/h-11 w-11[^"]*"[^>]*>.*Minus|Decrease quantity of Item 3" [^>]*class="flex h-11 w-11/.test(grid0()) || grid0().includes('class="flex h-11 w-11 items-center justify-center"'), 'quantity buttons are 44px');

// ── wholesale
const wbag: HomeBag = { ...bag, wholesale: true, priceOf: (p) => p.wholesalePriceCents ?? p.priceCents };
const w = html(React.createElement(HomeCatalog, { layout: 'atelier', cardStyle: 'grid', products: [item(7, { wholesalePriceCents: 800, wholesaleMinQty: 6 })], categories: ['all'], category: 'all', setCategory: () => {}, giftTile: null, bag: wbag, dark: false }));
ok(w.includes('$8.00') && w.includes('line-through') && w.includes('Min 6'), 'a wholesale buyer sees their price, the retail price struck through, and the minimum');

// ── the page wires it in
const page = fs.readFileSync('src/app/shop/[tenantId]/page.tsx', 'utf8');
ok(page.includes('<HomeIntro') && page.includes('<HomeCatalog') && page.includes('!ownHero'), 'the home page uses the layouts and steps the welcome aside for the owner’s hero');
ok(/onAdd: \(p\) => setQty\(p as ShopProduct, wholesale && p\.wholesaleMinQty \? p\.wholesaleMinQty : 1\)/.test(page), 'adding starts at the wholesale minimum for a wholesale buyer');
ok(page.includes("cardStyle={shop.layout || 'grid'}"), 'the owner’s card setting is kept');

ok(page.includes('q < p.wholesaleMinQty && q < (cart[p.id] ?? 0) ? 0 : q'), 'below a wholesale minimum the line comes out of the bag');
ok(/pickupOffered !== false \? 'Order ahead, pick up in store'\s*: null/.test(page), 'the welcome never offers pickup when pickup is off');
ok(!/bg-white p-4 transition-all hover:shadow-lg/.test(page) && page.includes("background: 'var(--shop-card)', color: 'var(--shop-ink)'"), 'the gift card tile follows the theme (readable on dark presets)');
const co = fs.readFileSync('src/app/shop/[tenantId]/checkout/page.tsx', 'utf8');
ok(co.includes("return n === 3 ? 'min-[380px]:grid-cols-3' : n >= 4 ? 'sm:grid-cols-4' : '';"), 'checkout shows three columns only when three ways are offered, four when four are');

// ── shop grids follow wider-screen columns
const g = fs.readFileSync('src/app/globals.css', 'utf8');
ok(g.includes(':where([data-shop-theme]) .grid {') && !/\n\[data-shop-theme\] \.grid \{/.test(g), 'the shop grid rule is light enough for md:/lg: columns to apply');

// ── house rules
const src = fs.readFileSync('src/components/shop/home/HomeLayouts.tsx', 'utf8');
ok(!/\{\/\*/.test(src) && !/colour|favourite|centre\b/i.test(src), 'no JSX comments, US spelling');
ok(!/font-(serif|mono)|Georgia|Inter\b/.test(src), 'one typeface (the shop font)');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
