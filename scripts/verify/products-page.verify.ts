// Checks products round 1 (the merged products list and product page):
//   - a count sets the shelf to the number counted and records the difference with the counter's name; fewer comes
//     out of the batches the next sale would take, more goes in as a batch marked as found in a count;
//   - a count below what's held for paid orders is refused, equipment isn't counted, and a count that matches writes
//     nothing; booth renters can't count the shop's stock;
//   - the list says where each product stands in the shop (in it, needs a price, needs a photo, off);
//   - the screens use the new list and page, and the page keeps its form fields outside the page (so typing in one
//     doesn't rebuild it).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/products-page.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
let actor: any = { uid: 'k1', name: 'Kai Park', isRenter: false };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }) };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const req = (body: any) => ({ json: async () => body, headers: new Map() }) as any;

(async () => {
  const { applyCount, recordCount } = await import('../../src/lib/stock-count');

  // ── The pure count ──
  const item = { totalStock: 10, costPerUnit: 4, batches: [
    { id: 'b-old', stock: 6, costPerUnit: 4, receivedDate: '2026-01-01T00:00:00Z' },
    { id: 'b-new', stock: 4, costPerUnit: 5, receivedDate: '2026-06-01T00:00:00Z' },
  ] };
  const fewer = applyCount(item, 7, '2026-10-24T00:00:00Z', 'c1');
  check('fewer counted: the shelf is set to the count, and the difference comes out of the oldest batch first',
    fewer.totalStock === 7 && fewer.delta === -3 && fewer.batches?.find((b: any) => b.id === 'b-old')?.stock === 3 && fewer.batches?.find((b: any) => b.id === 'b-new')?.stock === 4, fewer);
  const more = applyCount(item, 12, '2026-10-24T00:00:00Z', 'c2');
  check('more counted: the extra go in as a batch of their own, marked as found in a count, at the product’s cost',
    more.totalStock === 12 && more.delta === 2 && more.batches?.length === 3 && more.batches?.[2]?.note === 'Found in a count' && more.batches?.[2]?.stock === 2 && more.batches?.[2]?.costPerUnit === 4, more);
  check('the item passed in is never changed', item.batches[0].stock === 6 && item.totalStock === 10);
  const bare = applyCount({ totalStock: 0 }, 5, 'x', 'c3');
  check('a product with no batches gets one when more are counted', bare.totalStock === 5 && bare.batches?.[0]?.stock === 5);
  const off = applyCount({ totalStock: 10, batches: [{ id: 'a', stock: 6, receivedDate: '2026-01-01' }] }, 8, 'x', 'c4');
  const offSum = (off.batches || []).reduce((n: number, b: any) => n + b.stock, 0);
  check('batches that disagreed with the total are brought to the count too (the next sale works the total out from them)', off.totalStock === 8 && offSum === 8, off);
  const sameTotal = applyCount({ totalStock: 3, batches: [{ id: 'a', stock: 5, receivedDate: '2026-01-01' }] }, 3, 'x', 'c5');
  check('a count that matches the total still puts the batches right', sameTotal.changed && (sameTotal.batches || []).reduce((n: number, b: any) => n + b.stock, 0) === 3, sameTotal);

  // ── On the server ──
  await db.doc(`${T}/inventory/p1`).set({ id: 'p1', name: 'Cuticle oil', type: 'retail', totalStock: 10, stockReserved: 2, costPerUnit: 4, batches: item.batches });
  let r: any = await recordCount(db, 't1', 'p1', 1, { id: 'k1', name: 'Kai Park' });
  check('a count below what’s held for paid orders is refused, with the reason', !r.ok && /2 are held for paid orders/.test(r.error) && (await db.doc(`${T}/inventory/p1`).get()).data().totalStock === 10, r);
  r = await recordCount(db, 't1', 'p1', 8, { id: 'k1', name: 'Kai Park' });
  const p1 = (await db.doc(`${T}/inventory/p1`).get()).data();
  const entries = (await db.collection(`${T}/stockCorrections`).get()).docs.map((d: any) => d.data());
  check('a count sets the shelf and says who counted and when', r.ok && r.delta === -2 && p1.totalStock === 8 && p1.lastCountedBy === 'Kai Park' && !!p1.lastCountedAt, { r, p1 });
  check('the difference is on the stock history as a count, with who did it and what the shelf was left at',
    entries.length === 1 && entries[0].type === 'counted' && entries[0].actorName === 'Kai Park' && entries[0].balanceAfter === 8 && /was 10/.test(entries[0].reason), entries);
  r = await recordCount(db, 't1', 'p1', 8, { id: 'k1', name: 'Kai Park' });
  const after = (await db.collection(`${T}/stockCorrections`).get()).docs.map((d: any) => d.data());
  check('a count that matches is still a count: when, by whom, and a fresh start for the history (no change, the number counted)', r.ok && r.delta === 0 && after.length === 2 && after[1].type === 'counted' && after[1].change === 0 && after[1].balanceAfter === 8 && (await db.doc(`${T}/inventory/p1`).get()).data().lastCountedAt >= p1.lastCountedAt, { r, after });
  await db.doc(`${T}/inventory/L1`).set({ id: 'L1', name: 'Polish trio', type: 'retail', totalStock: 0, optionGroups: [{ id: 'g', name: 'Shade', choices: [{ id: 'c1', label: 'Blush', variantProductId: 'v1' }] }] });
  r = await recordCount(db, 't1', 'L1', 4, { id: 'k1', name: 'Kai Park' });
  check('a listing with variants isn’t counted itself (its variants are)', !r.ok && /variants/.test(r.error) && (await db.doc(`${T}/inventory/L1`).get()).data().totalStock === 0, r);
  await db.doc(`${T}/inventory/g1`).set({ id: 'g1', name: 'Gel top coat', type: 'professional', costingMethod: 'uses', estimatedUses: 40, useUnit: 'uses', totalStock: 3, batches: [{ id: 'gb', stock: 3, receivedDate: '2026-01-01' }] });
  r = await recordCount(db, 't1', 'g1', 2, { id: 'k1', name: 'Kai Park' });
  const gEntry = (await db.collection(`${T}/stockCorrections`).get()).docs.map((d: any) => d.data()).find((e: any) => e.productId === 'g1');
  check('a product used by the dose records the count in doses, as the rest of its history is', r.ok && gEntry?.change === -40 && gEntry?.unit === 'uses', gEntry);
  await db.doc(`${T}/inventory/e1`).set({ id: 'e1', name: 'Lamp', type: 'equipment', totalStock: 1 });
  r = await recordCount(db, 't1', 'e1', 3, { id: 'k1', name: 'Kai Park' });
  check('equipment isn’t counted here', !r.ok, r);
  r = await recordCount(db, 't1', 'p1', -4 as any, { id: 'k1', name: 'Kai Park' });
  check('a number that isn’t a count is refused', !r.ok, r);

  // ── The route ──
  const { POST } = await import('../../src/app/api/inventory/count/route');
  r = await POST(req({ tenantId: 't1', productId: 'p1', counted: 9 }));
  check('the count route counts as the person signed in', r.status === 200 && r.body.ok && (await db.doc(`${T}/inventory/p1`).get()).data().totalStock === 9, r);
  actor = { uid: 'r1', name: 'Rae', isRenter: true };
  r = await POST(req({ tenantId: 't1', productId: 'p1', counted: 20 }));
  check('a booth renter can’t count the shop’s stock', r.status === 403 && (await db.doc(`${T}/inventory/p1`).get()).data().totalStock === 9, r);
  actor = { uid: 'k1', name: 'Kai Park', isRenter: false };
  r = await POST(req({ tenantId: 't1', productId: 'p1', counted: 0 }));
  check('a refused count answers 409 with the reason', r.status === 409 && /held/.test(r.body.error), r);
  r = await POST(req({ tenantId: 't1', productId: 'p1', counted: null }));
  check('a missing number is refused, never read as zero', r.status === 409 && (await db.doc(`${T}/inventory/p1`).get()).data().totalStock === 9, r);
  r = await POST(req({ tenantId: 't1', productId: 'a/b', counted: 1 }));
  check('a product id with a slash is refused', r.status === 400, r);

  // ── Where each product stands in the shop ──
  const { shopStatus } = await import('../../src/components/products/ProductsList');
  const none = new Map<string, any>();
  check('a retail product with no price needs a price', shopStatus({ id: 'a', type: 'retail', showOnline: true, imageUrl: 'x' }, none)?.label === 'Needs a price');
  check('one with a price and no photo needs a photo', shopStatus({ id: 'a', type: 'retail', showOnline: true, msrp: 12 }, none)?.label === 'Needs a photo');
  check('one with everything is in the shop', shopStatus({ id: 'a', type: 'retail', showOnline: true, msrp: 12, imageUrl: 'x' }, none)?.tone === 'ok');
  check('one turned off is not in the shop', shopStatus({ id: 'a', type: 'retail', showOnline: false, msrp: 12, imageUrl: 'x' }, none)?.tone === 'off');
  check('a product for services has no shop status', shopStatus({ id: 'a', type: 'professional' }, none) === null);

  // ── Not every business sells products, or sells online ──
  const { productFeatures } = await import('../../src/lib/product-features');
  const pf = (t: any) => JSON.stringify(productFeatures(t));
  check('a business with the Retail tool and an open shop sees everything', pf({ retailSettings: { shopOpenedAt: '2026-01-01' } }) === '{"sell":true,"online":true}');
  check('one that sells at the desk but hasn’t opened a shop sees prices and sales, no shop', pf({ retailSettings: {} }) === '{"sell":true,"online":false}');
  check('one without the Retail tool sees stock only (even with an old shop date)', pf({ modules: { retail: false }, retailSettings: { shopOpenedAt: '2026-01-01' } }) === '{"sell":false,"online":false}');
  const list = fs.readFileSync('src/components/products/ProductsList.tsx', 'utf8');
  check('the list hides shop status, wholesale and the "almost ready" banner without an open shop, and prices and holds without selling',
    /const almost = !features\.online \? \[\]/.test(list) && /features\.online \? shopStatus/.test(list) && /features\.sell \? \['Held for orders', 'Price'\]/.test(list) && /c\.id !== 'shop' && c\.id !== 'notshop'/.test(list));
  const addSrc = fs.readFileSync('src/components/products/AddProductSheet.tsx', 'utf8');
  check('quick add asks for a price only where products are sold, and offers the shop only where there is one', /features\.sell \? 'retail' : 'professional'/.test(addSrc) && /kind === 'retail' && features\.online &&/.test(addSrc) && /showOnline: features\.online && online/.test(addSrc));

  // ── The screens ──
  const inv = fs.readFileSync('src/app/(app)/inventory/page.tsx', 'utf8');
  const page = fs.readFileSync('src/app/(app)/inventory/(detail)/product/[id]/page.tsx', 'utf8');
  check('the products screen uses the new list, the quick add and receiving stock, and says what’s on order', /orderedIds=\{orderedProductIds/.test(inv) && /<ProductsList/.test(inv) && /<AddProductSheet/.test(inv) && /<QuickReceiveDialog/.test(inv) && !/<InventorySidebar/.test(inv));
  const body = page.slice(page.indexOf('export default function ProductDetailPage'));
  check('the product page defines no components inside itself (a field inside one would lose its place on each key)', !/const [A-Z]\w* = \(\{/.test(body));
  check('the product page shows the shop, its checklist and the customer preview only to a business with an open shop, and selling only to one that sells',
    /const status = features\.online \? shopStatus/.test(page) && /kindOf === 'retail' && features\.online && !listing/.test(page) && /\{sells \? \(/.test(page) && /productType === 'retail' && sellOn/.test(page) && /kindOf === 'retail' && features\.online && \(/.test(page));
  check('the products screen offers logging a sale only where products are sold', /item\.type === 'retail' && features\.sell \? \[\{ label: 'Log a sale'/.test(inv) && /features=\{features\}/.test(inv));
  check('the product page counts through the server, never by writing the shelf from the browser', /<CountSheet/.test(page) && !/totalStock:\s/.test(body));
  check('adding the first variant doesn’t move anyone off their tab (the tab is read once per product)', /\}, \[id, productType, sellOn\]\);/.test(page));
  check('after a count, the history measures from the count, so a count closes a gap', /lastCount \? Number\(lastCount\.balanceAfter\)/.test(page));
  check('old links to its tabs still land somewhere', /manufacturing: 'stock'/.test(page) && /batches: 'stock'/.test(page));
  const all = [inv, page, fs.readFileSync('src/components/products/ProductsList.tsx', 'utf8'), fs.readFileSync('src/components/products/AddProductSheet.tsx', 'utf8'), fs.readFileSync('src/components/products/CountSheet.tsx', 'utf8')].join('\n');
  const fresh = [page, fs.readFileSync('src/components/products/ProductsList.tsx', 'utf8'), fs.readFileSync('src/components/products/AddProductSheet.tsx', 'utf8'), fs.readFileSync('src/components/products/CountSheet.tsx', 'utf8')].join('\n');
  check('no JSX comments on the new screens', !/\{\/\*/.test(fresh));
  check('no "call us" on these screens', !/call us/i.test(all));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
