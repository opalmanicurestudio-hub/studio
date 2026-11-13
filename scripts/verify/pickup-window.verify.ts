// Checks the pickup window (lib/pickup-window, api/retail/window, the board's products in api/counter 'menuBoard') and
// shades on a product's choices (lib/variants swatchOf, cleanChoices, shopOptionGroups).
// - Shades: a choice keeps a "#rrggbb" color through saving and into the shop; anything else is dropped.
// - The window: the business's own products in its order, never a variant on its own or an archived product; a size,
//   shades, Pros only, sold out from what's on the shelf.
// - Numbers: the menu's numbers unchanged, the window's after them, category by category; the register asks for them.
// - The page's API: anyone on the team reads it, only a manager changes it; best sellers first; a product that can't go
//   on the window is refused by name.
// - The board: products after the menu with their size, shades and Pros only; nothing about cost; the code goes to the
//   shop when ordering ahead isn't on.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/pickup-window.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV } from './fake-db';

let db: any = makeDb();
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const audits: any[] = [];
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_db: any, t: string, e: any) => { audits.push({ t, ...e }); }, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const V = await import('../../src/lib/variants');
  const W = await import('../../src/lib/pickup-window');
  const { menuNumbers } = await import('../../src/lib/menu-numbers');
  const { POST: WIN } = await import('../../src/app/api/retail/window/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');

  console.log('shades');
  check('a color is kept only as #rrggbb, in lower case', V.swatchOf('#8A1D40') === '#8a1d40' && V.swatchOf('8a1d40') === null && V.swatchOf('#8a1d4') === null && V.swatchOf('red') === null && V.swatchOf('#8a1d40; x') === null && V.swatchOf(null) === null);
  const cleaned = V.cleanChoices([{ id: 'g1', name: 'Shade', choices: [{ id: 'a', label: 'Berry', variantProductId: 'gel-berry', swatch: '#8A1D40' }, { id: 'b', label: 'Bare', deltaCents: 0, swatch: 'url(x)' }, { id: 'c', label: 'Ink', swatch: '#16171a' }] }]);
  const ch = cleaned.groups[0]?.choices || [];
  check('saving keeps a good color on a variant and on a plain choice, and drops a bad one', !cleaned.problem && ch[0]?.swatch === '#8a1d40' && ch[0]?.variantProductId === 'gel-berry' && ch[1] && !('swatch' in ch[1]) && ch[2]?.swatch === '#16171a', ch);
  const listing = { id: 'gel', type: 'retail', name: 'Gel color', msrp: 12.5, totalStock: 0, optionGroups: [{ id: 'g1', name: 'Shade', choices: [{ id: 'a', label: 'Berry', deltaCents: 0, variantProductId: 'gel-berry', swatch: '#8a1d40' }, { id: 'b', label: 'Midnight', deltaCents: 0, variantProductId: 'gel-mid', swatch: '#1d2a4a' }] }, { id: 'g2', name: 'Wrap', choices: [{ id: 'w', label: 'Gift wrap', deltaCents: 200, swatch: '#ffd1dc' }] }] };
  const byId = new Map<string, any>([['gel-berry', { id: 'gel-berry', type: 'retail', name: 'Gel · Berry', msrp: 12.5, totalStock: 8, parentId: 'gel' }], ['gel-mid', { id: 'gel-mid', type: 'retail', name: 'Gel · Midnight', msrp: 14, totalStock: 0, parentId: 'gel' }]]);
  const shop = V.shopOptionGroups(listing, byId);
  check('the shop sends each choice’s color, for the variants and for the other choices', shop[0]?.choices[0]?.swatch === '#8a1d40' && shop[0]?.choices[1]?.swatch === '#1d2a4a' && shop[1]?.choices[0]?.swatch === '#ffd1dc', shop);

  console.log('the window');
  check('the list: its order, no repeats, no bad ids, at most WINDOW_MAX', JSON.stringify(W.windowIdsOf({ pickupWindow: { items: ['b', 'a', 'b', 'x/y', '', 'c'] } })) === JSON.stringify(['b', 'a', 'c'])
    && W.windowIdsOf({ pickupWindow: { items: Array.from({ length: 80 }, (_, k) => `p${k}`) } }).length === W.WINDOW_MAX && W.windowIdsOf({}).length === 0);
  check('only the shop’s own products with a price go on it: not archived, not a variant, not a menu item',
    W.windowable({ type: 'retail', msrp: 5 }) && !W.windowable({ type: 'retail', msrp: 5, status: 'archived' }) && !W.windowable({ type: 'retail', msrp: 5, parentId: 'gel' })
    && !W.windowable({ type: 'retail', msrp: 0 }) && !W.windowable({ type: 'refreshment', price: 5 }) && !W.windowable(null));
  check('a size a customer reads, never “each”', W.sizeWords({ size: 16, unit: 'fl oz' }) === '16 fl oz' && W.sizeWords({ size: 1, unit: 'each' }) === null && W.sizeWords({ sizeLabel: '10 pack', size: 1, unit: 'each' }) === '10 pack' && W.sizeWords({}) === null);
  const gp = W.windowProductOf('gel', listing, byId);
  check('a product with shades: from its lowest price, its shades with colors (one sold out), in stock while any is',
    gp.from && gp.price === 12.5 && gp.swatches.length === 2 && gp.swatches[0].color === '#8a1d40' && !gp.swatches[0].soldOut && gp.swatches[1].soldOut && !gp.soldOut && gp.onHand === 8, gp);
  const held = W.windowProductOf('ace', { type: 'retail', name: 'Acetone', msrp: 6.99, totalStock: 3, stockReserved: 3, storeHoldback: 2, size: 16, unit: 'fl oz', prosOnly: true, imageUrls: ['https://img.test/a.png'], boardBadge: 'new' });
  check('sold out when every unit on hand is held for orders; the online shop’s holdback doesn’t count at the window; Pros only, its photo and tag',
    held.soldOut && held.onHand === 0 && held.prosOnly && held.size === '16 fl oz' && held.imageUrl === 'https://img.test/a.png' && held.badge === 'new' && held.price === 6.99 && !held.from, held);
  const shelf = W.windowProductOf('ace', { type: 'retail', name: 'Acetone', msrp: 6.99, totalStock: 5, storeHoldback: 5, imageUrl: 'http://insecure.test/a.png' });
  check('…but the shop’s holdback is still on the shelf at the window; a photo that isn’t https isn’t shown', !shelf.soldOut && shelf.onHand === 5 && shelf.imageUrl === null, shelf);
  const menu = [{ id: 'm1', section: 'Drinks' }, { id: 'm2', section: 'Food' }, { id: 'm3', section: 'Drinks' }];
  const nums = W.boardNumbers(menu, [{ id: 'p1', section: 'Drinks' }, { id: 'p2', section: 'Everyday' }, { id: 'p3', section: 'Drinks' }]);
  const plain = menuNumbers(menu);
  check('numbers: the menu’s own are unchanged by the window (a product in a section the menu also has doesn’t move them), the window’s after them, category by category',
    ['m1', 'm2', 'm3'].every((id) => nums.get(id) === plain.get(id)) && nums.get('p1') === 4 && nums.get('p3') === 5 && nums.get('p2') === 6, Array.from(nums.entries()));

  console.log('the page’s API');
  await db.doc(T).set({ name: 'Polished Supply', timezone: 'UTC', retailSettings: {} });
  const put = (id: string, x: any) => db.doc(`${T}/inventory/${id}`).set(x);
  await put('ace', { type: 'retail', name: 'Acetone', category: 'Everyday', msrp: 6.99, totalStock: 12, size: 16, unit: 'fl oz', costPerUnit: 2.1, supplier: 'Acme' });
  await put('cot', { type: 'retail', name: 'Cotton rounds', category: 'Everyday', msrp: 4.49, totalStock: 40 });
  await put('gel', { ...listing });
  await put('gel-berry', byId.get('gel-berry')); await put('gel-mid', byId.get('gel-mid'));
  await put('mono', { type: 'retail', name: 'Monomer', category: 'Acrylic', msrp: 24.99, totalStock: 4, prosOnly: true });
  await put('old', { type: 'retail', name: 'Old file', category: 'Everyday', msrp: 2, totalStock: 1, status: 'archived' });
  await put('latte', { type: 'refreshment', name: 'Latte', category: 'Coffee', price: 5, totalStock: 50 });
  const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  await db.doc(`${T}/retailOrders/o1`).set({ placedAt: day(2), paidAt: day(2), stage: 'completed', lines: [{ productId: 'cot', qtyOrdered: 9 }, { productId: 'gel-berry', listingId: 'gel', qtyOrdered: 3 }] });
  await db.doc(`${T}/retailOrders/o2`).set({ placedAt: day(3), stage: 'placed', lines: [{ productId: 'mono', qtyOrdered: 50 }] });
  await db.doc(`${T}/retailOrders/o3`).set({ placedAt: day(40), paidAt: day(40), stage: 'completed', lines: [{ productId: 'ace', qtyOrdered: 99 }] });
  const W_ = (b: any) => WIN(req({ tenantId: 't1', ...b }));
  let r: any = await W_({ action: 'list' });
  const cat = r.body.catalog || [];
  check('the list: nothing on it yet, every product that could go on it (not archived, not a variant, not the menu), best sellers of 30 paid days first',
    r.status === 200 && r.body.items.length === 0 && cat[0]?.id === 'cot' && cat[1]?.id === 'gel' && cat.length === 4 && !cat.some((c: any) => ['old', 'gel-berry', 'latte'].includes(c.id)) && r.body.canEdit === true
    && r.body.board === 'https://app.test/drive-thru/t1/menu' && r.body.menuCount === 1, r.body);
  check('…nothing about cost or suppliers', !/costPerUnit|supplier|Acme|2\.1\b/.test(JSON.stringify(r.body)));
  r = await W_({ action: 'save', items: ['cot', 'mono', 'ace', 'gel', 'cot'], was: [] });
  const tdoc = await get(T);
  check('a manager saves it in order (a repeat once)', r.status === 200 && JSON.stringify(tdoc.pickupWindow.items) === JSON.stringify(['cot', 'mono', 'ace', 'gel']), r.body);
  const logs = audits.filter((a) => a.t === 't1');
  check('…who saved it goes in the team’s log, never on the business’s page anyone can read', !('updatedBy' in tdoc.pickupWindow) && !/m1|Ana Ruiz|@/.test(JSON.stringify(tdoc.pickupWindow)) && logs.some((l: any) => l.action === 'window.saved' && l.actor?.name === 'Ana Ruiz'), [tdoc.pickupWindow, logs]);
  r = await W_({ action: 'list' });
  check('the list says what’s saved (the page sends it back)', JSON.stringify(r.body.stored) === JSON.stringify(['cot', 'mono', 'ace', 'gel']) && r.body.items.map((i: any) => i.id).join() === 'cot,ace,mono,gel', r.body.stored);
  r = await W_({ action: 'save', items: ['ace'], was: ['cot'] });
  check('a save from a page that started from another list is refused (someone else changed it), nothing changed', r.status === 409 && /changed since/.test(r.body.error) && (await get(T)).pickupWindow.items.length === 4, r.body);
  const bads = await Promise.all([W_({ action: 'save', items: ['old'] }), W_({ action: 'save', items: ['gel-berry'] }), W_({ action: 'save', items: ['latte'] }), W_({ action: 'save', items: ['nope'] }), W_({ action: 'save', items: Array.from({ length: 61 }, (_, k) => `p${k}`) }), W_({ action: 'save' })]);
  // A product archived while on the window: the page shows it no longer, and the next save from the page (with what it
  // read as saved) goes through and drops it.
  await db.doc(`${T}/inventory/ace`).set({ status: 'archived' }, { merge: true });
  r = await W_({ action: 'list' }); const st = r.body.stored; const shownNow = r.body.items.map((i: any) => i.id);
  r = await W_({ action: 'save', items: shownNow, was: st });
  check('a product archived while on the window doesn’t lock the page: its next save goes through and leaves it off', !shownNow.includes('ace') && r.status === 200 && JSON.stringify((await get(T)).pickupWindow.items) === JSON.stringify(['cot', 'mono', 'gel']), [shownNow, r.body]);
  await db.doc(`${T}/inventory/ace`).set({ status: 'active' }, { merge: true });
  r = await W_({ action: 'save', items: ['cot', 'mono', 'ace', 'gel'], was: ['cot', 'mono', 'gel'] });
  check('…refused: archived, a variant, a menu item, one not in Inventory (by name), more than 60, no list; nothing changed',
    bads.every((x: any) => x.status === 400) && /Old file/.test(bads[0].body.error) && /no longer in Inventory/.test(bads[3].body.error) && JSON.stringify((await get(T)).pickupWindow.items) === JSON.stringify(['cot', 'mono', 'ace', 'gel']), bads.map((x: any) => x.body.error));
  r = await W_({ action: 'list' });
  const nmap = Object.fromEntries(r.body.items.map((i: any) => [i.id, i.number]));
  check('numbers after the menu’s one item, kept together by category in the order the list first reaches each (Everyday’s two together though the list put Acrylic between them)',
    nmap.cot === 2 && nmap.ace === 3 && nmap.mono === 4 && nmap.gel === 5 && r.body.items.map((i: any) => i.id).join() === 'cot,ace,mono,gel', nmap);
  r = await W_({ action: 'numbers' });
  check('the register asks for the same numbers', r.status === 200 && r.body.numbers.cot === 2 && r.body.numbers.mono === 4 && r.body.numbers.gel === 5 && !('latte' in r.body.numbers), r.body);
  r = await W_({ action: 'tag', itemId: 'cot', featured: true, badge: 'new' });
  const tagBads = await Promise.all([W_({ action: 'tag', itemId: 'gel-berry', featured: true }), W_({ action: 'tag', itemId: 'cot', badge: 'popular' }), W_({ action: 'tag', itemId: 'cot', featured: 'yes' }), W_({ action: 'tag', itemId: 'cot' })]);
  check('a manager tags a product on the window (shown big, New); not one off it, not Popular (worked out from sales), not a bad value, not nothing',
    r.status === 200 && (await get(`${T}/inventory/cot`)).boardFeatured === true && (await get(`${T}/inventory/cot`)).boardBadge === 'new' && tagBads.every((x: any) => x.status === 400), tagBads.map((x: any) => x.body.error));
  actor = { uid: 's1', name: 'Sam', role: 'staff', caps: [] };
  const staffSave: any = await W_({ action: 'save', items: [] }); const staffTag: any = await W_({ action: 'tag', itemId: 'cot', featured: false }); r = await W_({ action: 'list' });
  check('someone on the team reads it but can’t change it', staffSave.status === 403 && staffTag.status === 403 && r.status === 200 && r.body.canEdit === false && (await get(T)).pickupWindow.items.length === 4);
  actor = { uid: 'r1', name: 'Rae', role: 'staff', isRenter: true, caps: [] };
  r = await W_({ action: 'list' });
  check('a renter can’t read it', r.status === 403);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

  console.log('the board');
  const bkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window board', kind: 'drive-thru-board' }))).body.key;
  await db.doc(`${T}/inventory/ace`).set({ stockReserved: 12 }, { merge: true });
  r = await LANE(req({ tenantId: 't1', key: bkey, action: 'menuBoard' }));
  const secs = r.body.sections || [];
  const prods = secs.filter((x: any) => x.kind === 'product').flatMap((x: any) => x.items);
  const itm = (id: string) => secs.flatMap((x: any) => x.items).find((i: any) => i.id === id) || {};
  check('the board: the menu first, then the window’s products by category with their numbers',
    secs.map((x: any) => `${x.kind || 'menu'}:${x.name}`).join() === 'menu:Coffee,product:Everyday,product:Acrylic,product:Shop' && prods.map((p: any) => p.number).join() === '2,3,4,5' && itm('latte').number === 1,
    secs.map((x: any) => [x.name, x.kind, x.items.map((i: any) => i.number)]));
  check('…each product with its size, its shades, Pros only, featured and New as tagged, sold out from the shelf (all of the acetone held for orders)',
    itm('ace').size === '16 fl oz' && itm('ace').soldOut === true && itm('mono').prosOnly === true && itm('gel').swatches?.length === 2 && itm('gel').swatches[0].color === '#8a1d40' && itm('gel').from === true
    && itm('cot').featured === true && itm('cot').badge === 'new' && itm('cot').kind === 'product' && itm('latte').kind === undefined, prods);
  const allowedP = ['id', 'name', 'words', 'price', 'from', 'startPrice', 'imageUrl', 'soldOut', 'featured', 'badge', 'calories', 'number', 'kind', 'size', 'prosOnly', 'swatches'];
  check('…nothing about cost, stock counts or suppliers', prods.every((p: any) => Object.keys(p).every((k) => allowedP.includes(k))) && !/costPerUnit|supplier|Acme|totalStock|onHand/.test(JSON.stringify(r.body)), prods[0]);
  check('…ordering ahead isn’t on, so the code goes to the shop', r.body.orderAhead === 'https://app.test/shop/t1', r.body.orderAhead);
  await db.doc(T).set({ pickupWindow: { items: [] } }, { merge: true });
  check('the best-seller reads take the newest orders first (a range read is oldest first unless ordered)',
    /where\('placedAt', '>', since\)\.orderBy\('placedAt', 'desc'\)\.limit\(500\)/.test(require('fs').readFileSync('src/app/api/retail/window/route.ts', 'utf8'))
    && /where\('placedAt', '>', since\)\.orderBy\('placedAt', 'desc'\)\.limit\(400\)/.test(require('fs').readFileSync('src/app/api/counter/route.ts', 'utf8')));
  const old = W.windowProductOf('oil', { type: 'retail', name: 'Oil', msrp: 8, totalStock: 4, batches: [{ stock: 4, expiryDate: '2001-01-01' }] });
  check('units past their date aren’t on the shelf', old.soldOut && old.onHand === 0, old);

  // A second business, so the board is read fresh (it's kept for 10 seconds).
  const T2 = 'tenants/t2';
  await db.doc(T2).set({ name: 'Bean Stop', timezone: 'UTC', pickupWindow: { items: ['mug', 'beans', 'tee'] } });
  await db.doc(`${T2}/inventory/drip`).set({ type: 'refreshment', name: 'Drip coffee', category: 'Drinks', price: 3, totalStock: 50 });
  await db.doc(`${T2}/inventory/mug`).set({ type: 'retail', name: 'Mug', category: 'Drinks', msrp: 14, totalStock: 9 });
  await db.doc(`${T2}/inventory/beans`).set({ type: 'retail', name: 'Beans', category: 'Coffee to go', msrp: 18, totalStock: 9 });
  await db.doc(`${T2}/inventory/tee`).set({ type: 'retail', name: 'Tee', category: 'Coffee to go', msrp: 25, totalStock: 9 });
  await db.doc(`${T2}/retailOrders/a`).set({ placedAt: day(1), paidAt: day(1), stage: 'completed', lines: [{ productId: 'beans', qtyOrdered: 6 }, { productId: 'tee', qtyOrdered: 4 }] });
  await db.doc(`${T2}/retailOrders/b`).set({ placedAt: day(9), paidAt: day(9), stage: 'completed', lines: [{ productId: 'tee', qtyOrdered: 40 }] });
  await db.doc(`${T2}/retailOrders/c`).set({ placedAt: day(1), stage: 'placed', lines: [{ productId: 'mug', qtyOrdered: 40 }] });
  const bkey2 = (await kitchen(req({ action: 'pair', tenantId: 't2', name: 'Board', kind: 'drive-thru-board' }))).body.key;
  r = await LANE(req({ tenantId: 't2', key: bkey2, action: 'menuBoard' }));
  const s2 = r.body.sections || []; const i2 = (id: string) => s2.flatMap((x: any) => x.items).find((i: any) => i.id === id) || {};
  check('a product category named like a menu section is shown apart (a screen can show either), keys stay unique',
    s2.map((x: any) => x.name).join() === 'Drinks,Drinks (shop),Coffee to go' && new Set(s2.map((x: any) => x.name)).size === s2.length, s2.map((x: any) => x.name));
  check('Popular on a window product sold 5 or more on paid orders in 7 days; not one sold 4 (older and unpaid sales don’t count)',
    i2('beans').badge === 'popular' && i2('tee').badge === null && i2('mug').badge === null, [i2('beans').badge, i2('tee').badge, i2('mug').badge]);
  const T3 = 'tenants/t3';
  await db.doc(T3).set({ name: 'Off Shop', timezone: 'UTC', modules: { retail: false }, pickupWindow: { items: ['x'] } });
  await db.doc(`${T3}/inventory/m`).set({ type: 'refreshment', name: 'Tea', category: 'Drinks', price: 3, totalStock: 50 });
  await db.doc(`${T3}/inventory/x`).set({ type: 'retail', name: 'Kettle', category: 'Home', msrp: 40, totalStock: 2 });
  const bkey3 = (await kitchen(req({ action: 'pair', tenantId: 't3', name: 'Board', kind: 'drive-thru-board' }))).body.key;
  r = await LANE(req({ tenantId: 't3', key: bkey3, action: 'menuBoard' }));
  check('a business with the shop turned off shows its menu alone, and no code to a shop', r.status === 200 && (r.body.sections || []).every((x: any) => !x.kind) && !/Kettle/.test(JSON.stringify(r.body)) && r.body.orderAhead === null, r.body);

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
