// scripts/verify/shop-product.verify.ts — the product page in each of the five layouts (components/shop/product): one
// h1, the buy button and its label, choices with sold-out variants, quantity (none for downloads), the ship-by card and
// restock alert where the page passes them, details, related products, reviews and questions; plus the page wiring.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/shop-product.verify.ts
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProductViewProps } from '../../src/components/shop/product/ProductLayouts';
import { SITE_LAYOUTS, type SiteLayout } from '../../src/lib/shop-site';

// Outside a Next server the image component has no host list; render photos as plain images for these checks.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Mod: any = require('module'); const load = Mod._load;
Mod._load = function (req: string, ...rest: any[]) {
  if (req === 'next/image') { const Img = ({ fill, priority, sizes, ...p }: any) => React.createElement('img', p); return { __esModule: true, default: Img }; }
  return load.call(this, req, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProductView }: typeof import('../../src/components/shop/product/ProductLayouts') = require('../../src/components/shop/product/ProductLayouts');

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 500)); } else console.log('  ✓', m); };

const base = (layout: SiteLayout, over: Partial<ProductViewProps> = {}): ProductViewProps => ({
  layout, dark: false, tenantId: 't1', shopName: 'Opal <Studio>',
  product: { id: 'p1', name: 'Cuticle <oil>', category: 'Care', sku: 'CO-15', description: 'Soaks in fast.', howToUse: '1. One drop\n2. Massage in', specs: [{ label: 'Size', value: '15 ml' }], documents: [{ name: 'Safety sheet', url: 'https://cdn.example.com/sds.pdf' }], imageUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'], wholesaleMinQty: null,
    optionGroups: [{ id: 'g', name: 'Scent', variants: true, choices: [{ id: 'a', label: 'Rose', priceCents: 1800, inStock: true }, { id: 'b', label: 'Lavender', priceCents: 2200, inStock: false }] }] },
  priceCents: 1800, strikeCents: null, unitCents: 1800, wholesale: false, canBuy: true, paused: false, lowNow: false, leftNow: 4, digital: false,
  buyLabel: 'Add to bag · $18.00', buyNowLabel: 'Buy it now', status: 'In stock', qty: 1, qtyMin: 1, qtyMax: 4, stepQty: () => {}, onAdd: () => {}, onBuyNow: () => {},
  selections: { g: 'a' }, onSelect: () => {}, showVideo: true,
  promise: React.createElement('div', { id: 'promise' }), restock: null, together: React.createElement('div', { id: 'together' }),
  trust: [{ title: 'Fast local pickup', sub: 'Ready same day' }, { title: 'Easy returns', sub: 'From your order page' }, { title: 'Secure checkout', sub: 'Card details never touch us' }],
  related: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: 'r' + i, name: 'Related ' + i, priceCents: 1000 + i, imageUrls: [] })),
  reviews: [{ id: 'v1', rating: 5, title: 'Lovely', body: 'Great.', author: 'Priya', at: '2026-09-01' }], reviewAvg: 4.9, reviewCount: 12,
  faq: [{ q: 'How long until my order is ready?', a: 'Same day.' }], ...over,
});
const html = (p: ProductViewProps) => { try { return renderToStaticMarkup(React.createElement(ProductView, p)); } catch (e) { return 'ERROR ' + String(e); } };

for (const l of SITE_LAYOUTS) {
  const layout = l.id as SiteLayout; const h = html(base(layout));
  ok(!h.startsWith('ERROR') && (h.match(/<h1/g) || []).length === 1 && h.includes('Cuticle &lt;oil&gt;'), `${l.name}: one h1, the name escaped`, h.slice(0, 200));
  ok(h.includes('Add to bag · $18.00') && h.includes('id="buy-main"'), `${l.name}: the buy button with its price`);
  ok(h.includes('role="group"') && h.includes('aria-pressed="true"') && /Lavender[^<]*(sold out|Sold out)|Lavender[\s\S]{0,200}Sold out/.test(h), `${l.name}: choices show which is picked and which are sold out`);
  ok(h.includes('$22.00'), `${l.name}: a variant at a different price shows it`);
  ok(h.includes('aria-label="Increase quantity"'), `${l.name}: a quantity stepper for things that ship`);
  ok(h.includes('id="promise"'), `${l.name}: the ship-by card the page worked out`);
  ok(h.includes('id="together"'), `${l.name}: buy it together`);
  ok(h.includes('15 ml') && h.includes('Safety sheet') && h.includes('One drop'), `${l.name}: specifications, documents and how to use`);
  ok(h.includes('id="reviews"') || layout === 'bento' && h.includes('Read them'), `${l.name}: reviews`);
  ok(h.includes('How long until my order is ready?'), `${l.name}: questions`);
  ok(h.includes('/shop/t1/product/r1'), `${l.name}: related products link to their pages`);
  const relCount = (h.match(/href="\/shop\/t1\/product\/r\d"/g) || []).length;
  ok(relCount > 0 && relCount <= 6, `${l.name}: a short row of related products (${relCount})`);
  const dl = html(base(layout, { digital: true, buyLabel: 'Buy now · $18.00', buyNowLabel: null, status: 'Instant access — nothing ships', promise: null }));
  ok(!dl.includes('aria-label="Increase quantity"') && dl.includes('Buy now · $18.00') && !dl.includes('Buy it now'), `${l.name}: a download has no quantity and no second buy button`);
  const off = html(base(layout, { canBuy: false, buyLabel: 'Sold out', restock: React.createElement('div', { id: 'restock' }) }));
  ok(/<button id="buy-main"[^>]*disabled/.test(off) && off.includes('id="restock"'), `${l.name}: sold out disables buying and shows the restock alert`);
  const ws = html(base(layout, { wholesale: true, strikeCents: 1800, priceCents: 1200, product: { ...base(layout).product, wholesaleMinQty: 6 } }));
  ok(ws.includes('$12.00') && ws.includes('line-through') && ws.includes('Wholesale minimum 6'), `${l.name}: wholesale price, retail struck through, minimum`);
}
const page = fs.readFileSync('src/app/shop/[tenantId]/product/[productId]/page.tsx', 'utf8');
const at = html(base('atelier'));
ok(at.includes('Buy it now'), 'Atelier offers buy it now beside add to bag');
ok(/disabled=""[^>]*aria-label="Decrease quantity"|aria-label="Decrease quantity"[^>]*disabled/.test(at), 'quantity can’t go below the minimum (the button says so)');
ok(at.includes('<output') && at.includes('aria-live="polite"'), 'quantity changes are announced');
const ix = html(base('index', { product: { ...base('index').product, sku: '', specs: [] } }));
ok(ix.includes('Safety sheet') && ix.includes('One drop') && ix.includes('Fast local pickup'), 'Index keeps documents, how to use and delivery even without a spec table');
const be = html(base('bento', { product: { ...base('bento').product, howToUse: Array.from({ length: 7 }, (_, i) => `${i + 1}. Step ${i + 1}`).join('\n') } }));
ok(be.includes('Step 7'), 'Bento shows every how-to step');
for (const l of SITE_LAYOUTS) ok(html(base(l.id as SiteLayout)).includes('aria-label="Breadcrumb"'), `${l.name}: breadcrumbs`);
const sp = html(base('spotlight'));
ok((sp.match(/Fast local pickup/g) || []).length === 1, 'Spotlight shows the delivery promises once');
ok(page.includes("cart[key] = qty; writeCart(tenantId, cart)") && page.includes('Your bag could not be saved'), 'buy it now sets this line to the chosen quantity and checks the bag saved');
ok(page.includes("setQty(wholesale && product.wholesaleMinQty ? product.wholesaleMinQty : 1); }}"), 'changing a choice resets the quantity (a download never carries over 3)');
ok(page.includes('backdrop-blur lg:hidden'), 'the sticky bar is for phones (the buy column already stays in view on a computer)');

// ── the page wires it in
ok(page.includes('<ProductView') && page.includes("layout={site?.layout || 'atelier'}"), 'the product page uses the layouts');
ok(/const site = useShopSite\(\);/.test(page) && page.indexOf('const site = useShopSite();') < page.indexOf('if (loadError)'), 'the layout is read before any early return (hooks keep their order)');
ok(page.includes('window.location.href = `/shop/${encodeURIComponent(tenantId)}/checkout`'), 'buy it now adds to the bag and goes to checkout');
ok(page.includes('cfg.showRelated ? related : []') && page.includes('cfg.showFaq ?') && page.includes('cfg.showTrust ?') && page.includes('cfg.showStickyBar !== false'), 'the owner’s page settings still switch sections off');

// ── controls keep a hairline on flat presets
const g = fs.readFileSync('src/app/globals.css', 'utf8');
ok(/\[data-shop-theme\] \.cf-line \{\s*border-width: 1px;/.test(g) && g.indexOf('.cf-line {') > g.indexOf('[data-shop-theme] .border {'), 'controls keep a border when cards are flat');

const src = fs.readFileSync('src/components/shop/product/ProductLayouts.tsx', 'utf8');
ok(!/\{\/\*/.test(src) && !/colour|favourite|centre\b/i.test(src) && !/font-(serif|mono)/.test(src), 'house rules: no JSX comments, US spelling, one typeface');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
