// Checks stock at each store, part 2: sales take from their store (design board "Stock at each store, and tonight's
// counts at each location"; lib/store-stock storeMove / onlineAt, lib/order-paid, lib/retail-fulfill, api/checkout/complete).
// - A paid online order picked up at a store (or going out from one) holds its units there; fulfilled, they come off that
//   store's shelf; shorted, cancelled, reopened or a backorder released, the store's numbers move with the hold.
// - A front desk sale at a location takes its products off that store's own number.
// - Only for an item counted at that store: one never counted there gets no number from a sale. Never below none.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/store-sales.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/notify' || request === './notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return { sendNotification: async () => ({ ok: true }) };
  if (request === '@/lib/loyalty-server') return { earnForShopOrder: async () => undefined };
  if (request === '@/lib/promo-codes-server') return { countPromoUse: async () => undefined };
  return load.call(this, request, ...rest);
};
process.env.NEXT_PUBLIC_APP_URL = 'https://studio.test';
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const S = await import('../../src/lib/store-stock');
  const stores = [{ id: 'main', name: 'Main St' }, { id: 'harbor', name: 'Harbor Rd' }];

  console.log('the rules');
  check('a move at a store not counted there: nothing (no number from a sale)', JSON.stringify(S.storeMove({ stockAt: { main: 3 } }, 'harbor', { stock: -1, held: 1 })) === '{}' && JSON.stringify(S.storeMove({}, 'main', { stock: -1 })) === '{}');
  check('…counted there: its shelf and its holds, as dotted fields', JSON.stringify(S.storeMove({ stockAt: { main: 3 }, heldAt: { main: 1 } }, 'main', { stock: -2, held: -1 })) === JSON.stringify({ 'stockAt.main': 1, 'heldAt.main': 0 }));
  check('…never below none', S.storeMove({ stockAt: { main: 1 } }, 'main', { stock: -5 })['stockAt.main'] === 0 && S.storeMove({ stockAt: { main: 1 } }, 'main', { held: -5 })['heldAt.main'] === 0);
  check('…no store, or one that isn’t an id: nothing', JSON.stringify(S.storeMove({ stockAt: { main: 1 } }, null, { stock: -1 })) === '{}' && JSON.stringify(S.storeMove({ stockAt: { main: 1 } }, 'a/b', { stock: -1 })) === '{}');
  check('what a store can sell online: its shelf less what’s held there, never more than the business can', S.onlineAt({ totalStock: 20, stockReserved: 2, stockAt: { main: 6 }, heldAt: { main: 2 } }, stores, 'main', 15) === 4
    && S.onlineAt({ totalStock: 20, stockAt: { main: 6 } }, stores, 'main', 3) === 3 && S.onlineAt({ totalStock: 20, stockAt: { main: 6 } }, stores, 'harbor', 15) === 0 && S.onlineAt({ totalStock: 20 }, stores, 'harbor', 15) === 15);

  console.log('a paid online order');
  const { payOrder } = await import('../../src/lib/order-paid');
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Polish', totalStock: 10, stockReserved: 1, stockAt: { harbor: 6, main: 4 }, heldAt: { harbor: 1 } });
  await db.doc(`${T}/inventory/p2`).set({ name: 'File', totalStock: 30, stockReserved: 0 });
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', tenantId: 't1', orderNumber: null, isDraft: true, stage: 'placed', method: 'pickup', priceTier: 'retail', locationId: 'harbor', pickupStore: { id: 'harbor', name: 'Harbor Rd' },
    lines: [{ lineId: 'l1', productId: 'p1', name: 'Polish', qtyOrdered: 1, unitPriceCents: 1500, optionsLabel: 'Rose' }, { lineId: 'l2', productId: 'p1', name: 'Polish', qtyOrdered: 1, unitPriceCents: 1500, optionsLabel: 'Sand' }, { lineId: 'l3', productId: 'p2', name: 'File', qtyOrdered: 2, unitPriceCents: 500 }],
    subtotalCents: 4000, discountCents: 0, taxCents: 0, taxMode: 'flat', shippingCents: 0, tipCents: 0, totalCents: 4000, storeCreditRequestedCents: 0, refundedCents: 0, customerName: 'Maya Lopez', customerEmail: 'maya@example.com', placedAt: '2026-10-23T15:00:00.000Z' });
  const r: any = await payOrder(db, 't1', 'o1', { via: 'card', session: { id: 'cs_1', payment_intent: 'pi_1', amount_total: 4000, payment_status: 'paid', total_details: { amount_tax: 0 }, metadata: { retailOrderId: 'o1' } }, chargeId: 'ch_1', connAcct: 'acct_1', clientId: 'c1', risk: null } as any);
  const p1 = await get(`${T}/inventory/p1`); const p2 = await get(`${T}/inventory/p2`);
  check('picked up at Harbor Rd: both lines held there too (1 + 2 = 3), Main St untouched', r.won === true && p1.stockReserved === 3 && p1.heldAt.harbor === 3 && !p1.heldAt.main && p1.stockAt.harbor === 6, p1);
  check('…a product not counted at any store: held as before, no store number', p2.stockReserved === 2 && !p2.heldAt && !p2.stockAt, p2);

  console.log('fulfilled, shorted, cancelled, reopened, released');
  const rf = src('src/lib/retail-fulfill.ts');
  check('fulfilled: off the store’s shelf and its hold, in the same step', rf.includes('...storeMove(item, (order as any).locationId, { stock: -qty, held: -heldQty }),'));
  check('shorted while picking: not on its shelf, no longer held there', rf.includes('...storeMove(item, (order as any).locationId, { stock: -qtyShorted, held: -qtyShorted }),'));
  check('a short reversed: back on its shelf and held', rf.includes('...storeMove(item, (order as any).locationId, { stock: qty, held: qty }),'));
  check('cancelled: its hold given back there', rf.includes("...storeMove(item, (order as any).locationId, { held: -qty }) });"));
  check('a backorder released: held there', rf.includes("...storeMove(it, (child as any).locationId, { held: q }) });"));

  console.log('a front desk sale');
  const desk = src('src/app/api/checkout/complete/route.ts');
  check('the sale’s location is worked out before its products move', desk.indexOf('const saleLocation') > 0 && desk.indexOf('const saleLocation') < desk.indexOf('const atShelf = saleLocation ? stockAtOf(inv)[saleLocation] : undefined;'));
  check('…its products come off that store’s own number when counted there, never below none (two lines of one product both count)', desk.includes('{ stockAt: { [saleLocation as string]: FieldValue.increment(-Math.min(atShelf, it.quantity)) } }')
    && desk.includes('inv.stockAt = { ...stockAtOf(inv), [saleLocation as string]: Math.max(0, atShelf - it.quantity) };'));

  check('a hold let go without its store can’t keep a store down: never more held there than the business holds', S.onlineAt({ totalStock: 20, stockReserved: 0, stockAt: { main: 6 }, heldAt: { main: 4 } }, stores, 'main', 20) === 6);
  const one = S.atStoresOf({ totalStock: 5, stockAt: { main: 2 } }, [{ id: 'main', name: 'Main St' }], 5, 99);
  check('one shop store (others aren’t on the shop): still its own number, as checkout checks it', JSON.stringify(one) === JSON.stringify([{ id: 'main', name: 'Main St', qty: 2, counted: true }]));
  check('a store not counted yet: said apart from sold out', S.atStoresOf({ totalStock: 5, stockAt: { main: 2 } }, stores, 5, 99)?.find((x) => x.id === 'harbor')?.counted === false);

  console.log('the shop');
  const SC = await import('../../src/lib/shop-catalog');
  const items: any[] = [{ id: 'oil', type: 'retail', name: 'Lip oil', showOnline: true, status: 'active', msrp: 18, totalStock: 18, stockReserved: 2, stockAt: { main: 12, harbor: 0 }, heldAt: { main: 2 } },
    { id: 'balm', type: 'retail', name: 'Balm', showOnline: true, status: 'active', msrp: 9, totalStock: 5, stockReserved: 0 }];
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows = SC.catalogProducts(items, byId, new Map(), { wholesale: false, discountPct: 0, zone: 'Etc/UTC', stores });
  const oil = rows.find((p: any) => p.id === 'oil'); const balm = rows.find((p: any) => p.id === 'balm');
  check('the catalog: each store’s number for one counted at a store (its shelf less what’s held there); none for one that isn’t', JSON.stringify(oil?.atStores) === JSON.stringify([{ id: 'main', name: 'Main St', qty: 10, counted: true }, { id: 'harbor', name: 'Harbor Rd', qty: 0, counted: true }]) && !balm?.atStores, [oil?.atStores, balm?.atStores, rows.length]);
  const ln = S.storeLine(oil?.atStores, 'harbor');
  check('the product page: out of stock at the store picked, in stock at the other', ln?.here?.qty === 0 && ln?.elsewhere.map((x) => x.name).join() === 'Main St' && S.storeLine(null, 'harbor') === null);
  const line = src('src/components/shop/StoreStockLine.tsx'); const pp = src('src/app/shop/[tenantId]/product/[productId]/page.tsx');
  check('…said under the button, with Change store and Pick up there', line.includes('`In stock at ${line.here.name}`') && line.includes('`Out of stock at ${line.here.name}`') && line.includes('>Pick up there<') && line.includes('>Change store<') && pp.includes('<StoreStockLine tenantId={tenantId} at={(product as any).atStores} />'));
  const co = src('src/app/api/retail/checkout/route.ts');
  check('checkout: a pickup only takes what that store has, a delivery what the store it goes out from has', co.includes('const can = onlineAt(n.item, counted, fromStore.id, Math.max(0, onlineSellable(n.item)));') && co.includes('is out of stock at ${where}. Pick another store, or have it delivered.')
    && co.indexOf('if (fromStore && storeNeeds.size)') < co.indexOf('  const order = {\n    id: orderId,'));
  check('…not counted there yet: “Not available at … right now”, at checkout too, and the owner told why', line.includes('`Not available at ${line.here.name} right now`') && co.includes('isn’t available at ${where} right now')
    && src('src/components/products/StoreStockPanel.tsx').includes('the shop doesn’t offer it for pickup or delivery from the ones not counted yet'));
  check('checkout checks the same stores the shop shows', co.includes('const counted = shops.stores.map((s: any) => ({ id: s.id, name: s.name }));'));
  check('a cancel by the customer, a swap and a refund instead: each store’s numbers move with the hold', src('src/app/api/retail/self-serve/route.ts').includes('...storeMove(item, loc, { held: -q })')
    && src('src/lib/retail-swap-server.ts').includes('...storeMove(it, o.locationId, { held: r.qty })') && src('src/lib/retail-swap-server.ts').includes('...storeMove(it, o.locationId, { stock: -r.qty, held: -r.qty })') && src('src/lib/retail-swap-server.ts').includes('...storeMove(it, o.locationId, { stock: -qty, held: -qty })'));
  const vd = src('src/app/api/checkout/void/route.ts');
  check('a voided front desk sale puts back what it took from its store (while that store is still counted)', desk.includes('storeTaken.push({ id: String(it.id), at: saleLocation as string, qty: Math.min(atShelf, it.quantity) });') && desk.includes('...(storeTaken.length ? { storeTaken } : {})')
    && vd.includes('.filter(([at]) => kept && typeof kept === \'object\' && at in kept)') && vd.includes('[`stockAt.${at}`, FieldValue.increment(q)]'));
  check('house style', !/ · |\buppercase\b|font-black|call us|contact us|\{\/\*/i.test(line) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(line));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
