// scripts/verify/shop-settings.verify.ts — Shop settings hold only what's about the whole shop, in four sections, and
// everything about one product is on its own page, under In the shop, saved in the shapes the shop reads.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/shop-settings.verify.ts
import fs from 'fs';
import { publicSpecs, collectImages } from '../../src/lib/product-public';

let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settings = src('src/app/(app)/retail-orders/settings/page.tsx');
const tab = src('src/components/inventory/OnlineListingTab.tsx');
const extras = src('src/components/inventory/ListingExtras.tsx');

ok(['id="open"', 'id="get"', 'id="money"', 'id="pack"'].every((k) => settings.includes(k)), 'four sections: open or paused, how customers get orders, money, packing');
ok(!/setDrafts|preorder-run-cancel|uploadImage|digitalUrl/.test(settings), 'no product editor left in Shop settings');
ok(settings.includes('Link href="/inventory"'), 'Shop settings points to Products for anything about one product');
ok(['<PhotosSection', '<BeforeStockSection', '<WholesaleSection', '<DocumentsSection', 'VariantsSellSection', '<DigitalSection'].every((k) => tab.includes(k)), 'photos, before it’s in stock, wholesale, documents, variants and downloads are on the product’s In the shop tab');
ok(tab.includes('specs: specs.filter((r) => r[0].trim() || r[1].trim()).slice(0, 40).map((r) => ({ label: r[0].trim(), value: r[1].trim() })),'), 'specs are saved as label and value');
ok(publicSpecs({ specs: [{ label: 'Size', value: '15 ml' }] } as any).length === 1, 'and the shop reads that shape');
ok(extras.includes("photoUrl: null, images: []") && collectImages({ imageUrls: ['a'], imageUrl: 'a', photoUrl: null, images: [] } as any).length === 1, 'a removed photo stays removed (older photo fields are cleared)');
ok(tab.includes("disabled={showOnline && !((Number(product.msrp) || 0) > 0)}"), 'a product with no price can’t be published');
ok(src('src/app/(app)/inventory/(detail)/product/[id]/page.tsx').includes('<OnlineListingTab key={product.id}'), 'moving to another product never carries this one’s unsaved edits');
ok(extras.includes("'/api/retail/preorder-run-eta'") && extras.includes("'/api/retail/preorder-run-cancel'"), 'a pre-order run can still be moved or cancelled, with refunds, from the product');
ok(!/Colours|colour/.test(settings), 'US spelling');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
