// Checks bundles, kits, build-your-own boxes, looks and bought-together savings (lib/retail-offers) and how checkout
// takes them (api/retail/checkout): item prices never change, the saving is its own line shared across the items it
// covers to the cent, each unit counts toward one offer, promo codes don't stack on covered items, the card keeps its
// 50¢, and the books, refunds and tax all see the saving.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/offers.verify.ts
import Module from 'module';
import { makeDb, strictTransactions, FV, check, failures } from './fake-db';
import {
  boxNext, boxPct, capSavings, groupsAvailable, matchOffers, pairsFromOrders, picksFor, problemsOf, publicOffer, readOffer, savingsLabel,
} from '../../src/lib/retail-offers';
import { refundUnitCents } from '../../src/lib/promo-codes';
import { orderParts } from '../../src/lib/order-books';

const kit = readOffer({ kind: 'set', name: 'Manicure kit', status: 'live', kit: true, items: [{ productId: 'oil', qty: 1 }, { productId: 'file', qty: 1 }, { productId: 'base', qty: 1 }], save: { type: 'pct', value: 10 } }, 'kit1')!;
const box = readOffer({ kind: 'box', name: 'Hand care box', status: 'live', pool: ['oil', 'cream', 'mask', 'file'], tiers: [{ count: 3, pct: 10 }, { count: 4, pct: 15 }, { count: 6, pct: 20 }] }, 'box1')!;
const L = (id: string, productId: string, unitPriceCents: number, qty = 1, listingId?: string) => ({ id, productId, unitPriceCents, qty, ...(listingId ? { listingId } : {}) });

console.log('the rules');
{
  const m = matchOffers([L('a', 'oil', 1800), L('b', 'file', 1400), L('c', 'base', 2000)], [kit]);
  check('a complete kit saves 10% of $52.00: $5.20', m.cents === 520 && m.applied[0]?.offerId === 'kit1' && m.applied[0].groups === 1, m);
  check('…shared across its items to the cent, by what each costs', m.byLine.a + m.byLine.b + m.byLine.c === 520 && m.byLine.c === 200, m.byLine);
  const two = matchOffers([L('a', 'oil', 1800, 2), L('b', 'file', 1400, 2), L('c', 'base', 2000, 3)], [kit]);
  check('two complete kits save twice; the extra base coat is full price', two.cents === 1040 && two.applied[0].groups === 2, two);
  check('one item missing: no saving', matchOffers([L('a', 'oil', 1800), L('b', 'file', 1400)], [kit]).cents === 0);
  const priced = readOffer({ ...kit, save: { type: 'price', value: 4600 } }, 'kit2')!;
  check('a set price of $46 on $52 of items saves $6', matchOffers([L('a', 'oil', 1800), L('b', 'file', 1400), L('c', 'base', 2000)], [priced]).cents === 600);
  check('a set price above the items’ prices saves nothing', matchOffers([L('a', 'oil', 1800), L('b', 'file', 1400), L('c', 'base', 2000)], [readOffer({ ...kit, save: { type: 'price', value: 9000 } }, 'k')!]).cents === 0);
  const v = matchOffers([L('a', 'oil-rose', 1800, 1, 'oil'), L('b', 'file', 1400), L('c', 'base', 2000)], [kit]);
  check('a variant chosen on the listing counts as the listing', v.cents === 520, v);
  const dear = matchOffers([L('cheap', 'oil-15', 1200, 1, 'oil'), L('dear', 'oil-30', 2400, 1, 'oil'), L('b', 'file', 1400), L('c', 'base', 2000)], [kit]);
  check('the dearest unit is used when two variants are in the bag', dear.cents === 580 && !dear.byLine.cheap && dear.byLine.dear > 0, dear);
  const part = matchOffers([L('a', 'oil', 1800, 3), L('b', 'file', 1400), L('c', 'base', 2000)], [kit]);
  check('only the units in the kit are counted as covered', part.unitsByLine.a === 1 && part.unitsByLine.b === 1 && part.unitsByLine.c === 1, part.unitsByLine);
  check('an amount off is held to 90% of the group', matchOffers([L('a', 'oil', 1800), L('b', 'file', 1400), L('c', 'base', 2000)], [readOffer({ ...kit, save: { type: 'off', value: 900000 } }, 'k9')!]).cents === 4680);
  const pP = readOffer({ kind: 'set', name: 'P', status: 'live', items: [{ productId: 'A' }, { productId: 'B' }], save: { type: 'price', value: 3000 } }, 'P')!;
  const pQ = readOffer({ kind: 'set', name: 'Q', status: 'live', items: [{ productId: 'A' }, { productId: 'C' }], save: { type: 'pct', value: 10 } }, 'Q')!;
  const give = matchOffers([L('a1', 'A-big', 2500, 1, 'A'), L('a2', 'A-small', 1500, 1, 'A'), L('b', 'B', 1000, 2), L('c', 'C', 1000)], [pP, pQ]);
  check('a group that would save nothing gives its units back for another offer', give.cents === 500 + 250, give.applied);
  check('a draft offer is never used', matchOffers([L('a', 'oil', 1800), L('b', 'file', 1400), L('c', 'base', 2000)], [{ ...kit, status: 'draft' }]).cents === 0);

  const b5 = matchOffers([L('a', 'oil', 1800, 2), L('b', 'cream', 2200, 2), L('c', 'mask', 2600)], [box]);
  check('a box of 5 reaches the 4-item step: 15% off all five', b5.cents === Math.round((3600 + 4400 + 2600) * 0.15) && b5.applied[0].pct === 15, b5);
  check('…named for the box and its percent', savingsLabel(b5.applied) === 'Hand care box (15% off)');
  const lots = matchOffers([L('a', 'oil', 1800, 20)], [readOffer({ ...box, tiers: [{ count: 3, pct: 15 }] }, 'b3')!]);
  check('a box holds up to its top step: 20 items make six boxes of 3, and 2 stay full price', lots.cents === Math.round(5400 * 0.15) * 6 && lots.unitsByLine.a === 18 && lots.applied[0].groups === 6, lots);
  check('below the smallest step: nothing', matchOffers([L('a', 'oil', 1800), L('b', 'cream', 2200)], [box]).cents === 0);
  check('box steps read right', boxPct(box, 2) === 0 && boxPct(box, 3) === 10 && boxPct(box, 7) === 20 && boxNext(box, 3)?.more === 1 && boxNext(box, 6) === null);

  const both = matchOffers([L('a', 'oil', 1800), L('b', 'file', 1400), L('c', 'base', 2000), L('d', 'cream', 2200), L('e', 'mask', 2600)], [box, kit]);
  check('each unit counts toward one offer, and the bigger saving wins: a box of 4 (15% of $80) beats the kit ($5.20)', both.applied.length === 1 && both.applied[0].offerId === 'box1' && both.cents === 1200 && Object.values(both.offersByLine).every((xs) => xs.length === 1), both);
  const both2 = matchOffers([L('a', 'oil', 1800, 2), L('b', 'file', 1400), L('c', 'base', 2000), L('d', 'cream', 2200), L('e', 'mask', 2600)], [box, kit]);
  check('…five box items at 15% ($14.70) beat the kit plus a 3-item box ($11.80)', both2.cents === 1470 && both2.applied.length === 1, both2.applied);
  const both3 = matchOffers([L('a', 'oil', 1800), L('b', 'file', 1400), L('c', 'base', 2000), L('d', 'cream', 2200), L('e', 'mask', 2600), L('f', 'polish', 1500)], [kit, readOffer({ ...box, pool: ['cream', 'mask', 'polish'] }, 'box2')!]);
  check('when both fit, both apply: the kit, and cream, mask and polish as a box of 3', both3.applied.length === 2 && both3.cents === 520 + Math.round((2200 + 2600 + 1500) * 0.1), both3.applied);
  check('two offers on one bag say “Bundle savings”', savingsLabel(both3.applied) === 'Bundle savings');

  const tog = readOffer({ kind: 'together', status: 'live', anchorId: 'oil', items: [{ productId: 'file' }, { productId: 'oil' }], save: { type: 'pct', value: 5 } }, 't1')!;
  check('picks never include the product they’re for', tog.items.length === 1 && tog.items[0].productId === 'file');
  check('bought together with its picks: the saving applies', matchOffers([L('a', 'oil', 1800), L('b', 'file', 1400)], [tog]).cents === 160);
  const look = readOffer({ kind: 'look', name: 'The soft almond', status: 'live', photoUrl: 'https://x.test/a.jpg', items: [{ productId: 'oil' }, { productId: 'cream' }], hotspots: [{ productId: 'oil', x: 20, y: 30 }, { productId: 'zzz', x: 1, y: 1 }] }, 'l1')!;
  check('a look without a saving takes nothing off, and dots only point at its products', look.save === null && look.hotspots.length === 1 && matchOffers([L('a', 'oil', 1800), L('b', 'cream', 2200)], [look]).cents === 0);

  check('a bundle of one item is refused', readOffer({ kind: 'set', name: 'x', items: [{ productId: 'oil' }], save: { type: 'pct', value: 10 } }) === null);
  check('a box with no steps is refused', readOffer({ kind: 'box', name: 'x', pool: ['a', 'b', 'c'] }) === null);
  check('a look with no photo says so', problemsOf({ ...look, photoUrl: '' }).includes('Add the photo.'));
  check('a percent is held to 90%, a set price to at least $1', readOffer({ ...kit, save: { type: 'pct', value: 400 } })!.save!.value === 90 && readOffer({ ...kit, save: { type: 'price', value: 5 } })!.save!.value === 100);
  check('product ids with a slash are dropped', readOffer({ ...kit, items: [{ productId: 'a/b' }, { productId: 'oil' }, { productId: 'file' }] })!.items.length === 2);

  const m2 = matchOffers([L('a', 'oil', 1800), L('b', 'file', 1400), L('c', 'base', 2000)], [kit]);
  const cap = capSavings(m2, 300);
  check('savings are lowered to leave the card its room, still to the cent', cap.cents === 300 && Object.values(cap.byLine).reduce((s, c) => s + c, 0) === 300 && cap.applied[0].cents === 300, cap);
  check('…and untouched when they fit', capSavings(m2, 5000) === m2);

  const shown = new Map<string, any>([['oil', { inStock: true, qtyAvailable: 7 }], ['file', { inStock: true, qtyAvailable: 2 }], ['base', { inStock: true, qtyAvailable: 9 }]]);
  check('a kit’s stock is the item there are fewest of', publicOffer(kit, shown)?.groupsLeft === 2 && groupsAvailable(kit, (p) => shown.get(p)?.qtyAvailable || 0) === 2);
  shown.delete('base');
  check('a kit with a product not on sale online isn’t shown', publicOffer(kit, shown) === null);

  const pairs = pairsFromOrders([{ lines: [{ productId: 'oil' }, { productId: 'v-file', listingId: 'file' }] }, { lines: [{ productId: 'oil' }, { productId: 'file' }, { productId: 'mask' }] }, { lines: [{ productId: 'oil' }, { productId: 'mask' }] }, { lines: [{ productId: 'oil' }] }]);
  check('bought together: pairs seen at least twice, a variant counted as its listing', JSON.stringify(pairs.oil) === JSON.stringify(['file', 'mask']) && pairs.file?.[0] === 'oil', pairs);
  check('the shop’s own picks come first, then what customers buy, only things on sale', JSON.stringify(picksFor('oil', [tog], pairs, new Set(['file', 'mask'])).ids) === JSON.stringify(['file', 'mask']));
}

// ─── checkout ────────────────────────────────────────────────────────────────────────────────────────────────────
let db: any = strictTransactions(makeDb());
const sessions: any[] = []; const coupons: any[] = [];
function StripeMock(this: any) {
  return {
    coupons: { create: async (p: any) => { coupons.push(p); return { id: `co_${coupons.length}` }; } },
    checkout: { sessions: { create: async (p: any) => { sessions.push(p); return { id: `cs_${sessions.length}`, url: 'https://stripe.test/x' }; } } },
  };
}
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe' || /node_modules\/stripe\//.test(request)) return fake(request, Object.assign(StripeMock, { default: StripeMock }));
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin-retail-checkout' }), getApps: () => [], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async () => ({ ok: true }) });
  return load.call(this, request, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
const T = 'tenants/t1';
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://shop.test' } }) as any;
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const product = (name: string, cents: number) => ({ name, msrp: cents / 100, retailPriceCents: cents, price: cents / 100, totalStock: 20, stockReserved: 0, showOnline: true, status: 'active', type: 'retail' });
const fresh = async (offerDocs: Record<string, any> = { kit1: { kind: 'set', name: 'Manicure kit', status: 'live', kit: true, items: [{ productId: 'oil', qty: 1 }, { productId: 'file', qty: 1 }, { productId: 'base', qty: 1 }], save: { type: 'pct', value: 10 } } }) => {
  db = strictTransactions(makeDb()); sessions.length = 0; coupons.length = 0;
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: { taxRatePercent: 6, pickupEnabled: true } });
  await db.doc(`${T}/inventory/oil`).set(product('Cuticle oil', 1800));
  await db.doc(`${T}/inventory/file`).set(product('Glass file', 1400));
  await db.doc(`${T}/inventory/base`).set(product('Base coat', 2000));
  await db.doc(`${T}/inventory/mask`).set(product('Hand mask', 2600));
  for (const [id, d] of Object.entries(offerDocs)) await db.doc(`${T}/retailOffers/${id}`).set(d);
  await db.doc(`${T}/discounts/d1`).set({ code: 'FALL15', appliesTo: 'shop', type: 'percentage', value: 15, isActive: true, usageLimit: 0, usageCount: 0 });
};
const body = (items: any[], x: any = {}) => ({ tenantId: 't1', items, method: 'counter', customer: { name: 'Dana Whitfield', email: 'dana@example.com' }, ...x });
const three = [{ productId: 'oil', qty: 1 }, { productId: 'file', qty: 1 }, { productId: 'base', qty: 1 }];

(async () => {
  const { POST } = await import('../../src/app/api/retail/checkout/route');

  console.log('checkout: a complete kit in the cart');
  await fresh();
  let r: any = await POST(req(body(three)));
  let o: any = r.body?.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('the order is placed', r.status === 200 && !!o, r.body);
  check('item prices are unchanged: $18, $14, $20', o && o.lines.map((l: any) => l.unitPriceCents).join(',') === '1800,1400,2000' && o.subtotalCents === 5200, o?.lines?.map((l: any) => l.unitPriceCents));
  check('the kit saves $5.20, recorded by offer and as the order’s discount', o?.offerCents === 520 && o?.discountCents === 520 && o?.offers?.[0]?.offerId === 'kit1' && o?.offerLabel === 'Manicure kit', o && { offerCents: o.offerCents, discountCents: o.discountCents, offers: o.offers });
  check('each line carries its share, adding up to the cent', o && o.lines.reduce((s: number, l: any) => s + (l.offerCents || 0), 0) === 520 && o.lines.every((l: any) => l.promoCents === l.offerCents && l.offerIds?.[0] === 'kit1'), o?.lines);
  check('tax is on what the items cost after the saving: 6% of $46.80', o?.taxCents === 281 && o?.totalCents === 4680 + 281, o && { tax: o.taxCents, total: o.totalCents });
  check('the payment page keeps each item at its own price, with one discount for the saving', sessions[0]?.line_items?.filter((l: any) => l.price_data.product_data.name !== 'Sales Tax').map((l: any) => l.price_data.unit_amount).join(',') === '1800,1400,2000' && coupons[0]?.amount_off === 520 && /Bundle savings/.test(coupons[0]?.name), { items: sessions[0]?.line_items, coupon: coupons[0] });
  check('a refund of the base coat gives back what was paid for it', o && refundUnitCents(o.lines[2]) === 2000 - o.lines[2].offerCents);
  check('the books count the saving off the sale', o && orderParts(o).promoCents === 520 && orderParts(o).itemsCents === 4680);

  console.log('checkout: not a complete kit');
  await fresh();
  r = await POST(req(body(three.slice(0, 2))));
  o = await get(`${T}/retailOrders/${r.body.orderId}`);
  check('no saving and no discount', r.status === 200 && !o.offerCents && !o.discountCents && !coupons.length && o.lines.every((l: any) => !l.promoCents), o);

  console.log('checkout: a draft offer');
  await fresh({ kit1: { kind: 'set', name: 'Manicure kit', status: 'draft', items: three.map((x) => ({ productId: x.productId, qty: 1 })), save: { type: 'pct', value: 10 } } });
  r = await POST(req(body(three)));
  o = await get(`${T}/retailOrders/${r.body.orderId}`);
  check('isn’t used', !o.offerCents, o);

  console.log('checkout: a promo code with a kit');
  await fresh();
  r = await POST(req(body([...three, { productId: 'mask', qty: 1 }], { promoCode: 'FALL15' })));
  o = await get(`${T}/retailOrders/${r.body.orderId}`);
  const mask = o?.lines?.find((l: any) => l.productId === 'mask');
  check('the code comes off only the item the kit doesn’t cover (15% of $26 = $3.90)', o?.promo?.cents === 390 && mask?.promoCents === 390 && !mask?.offerCents, o && { promo: o.promo, mask });
  check('both are in the order’s discount, the tax and the one payment-page discount', o?.discountCents === 910 && o?.taxCents === Math.round((7800 - 910) * 0.06) && coupons[0]?.amount_off === 910, o && { d: o.discountCents, tax: o.taxCents, coupon: coupons[0] });
  r = await POST(req(body(three, { promoCode: 'FALL15' })));
  check('a code on a cart that’s all kit is refused, saying why', r.status === 400 && /already in a bundle/.test(r.body?.error || ''), r.body);
  await db.doc(`${T}/discounts/d2`).set({ code: 'SHIPFREE', appliesTo: 'shop', type: 'free_shipping', isActive: true, usageLimit: 0, usageCount: 0 });
  r = await POST(req(body(three, { promoCode: 'SHIPFREE', method: 'ship', shippingAddress: { name: 'Dana Whitfield', line1: '88 Pine St', city: 'Portland', state: 'OR', postalCode: '97201', country: 'US' } })));
  o = r.body?.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('a free-shipping code still works on a cart that’s all kit', r.status === 200 && o?.promo?.freeShipping === true && o?.offerCents === 520, { status: r.status, body: r.body });

  console.log('checkout: more of an item than the kit needs');
  await fresh();
  r = await POST(req(body([{ productId: 'oil', qty: 3 }, { productId: 'file', qty: 1 }, { productId: 'base', qty: 1 }, { productId: 'mask', qty: 0 }].filter((x) => x.qty), { promoCode: 'FALL15' })));
  o = r.body?.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  const oils = (o?.lines || []).filter((l: any) => l.productId === 'oil');
  check('the oil line is split: 1 in the kit with its share, 2 outside it at full price', oils.length === 2 && oils[0].qtyOrdered === 1 && oils[0].offerCents > 0 && oils[1].qtyOrdered === 2 && !oils[1].offerCents && oils[1].lineId !== oils[0].lineId, oils);
  check('…and the code comes off the 2 outside the kit (15% of $36)', oils[1]?.promoCents === 540 && o?.promo?.cents === 540, { promo: o?.promo, oils });
  check('…so a refund of one of those gives back what was paid for it', oils[1] && refundUnitCents(oils[1]) === 1800 - 270);

  console.log('checkout: a build-your-own box');
  await fresh({ box1: { kind: 'box', name: 'Hand care box', status: 'live', pool: ['oil', 'file', 'mask'], tiers: [{ count: 3, pct: 10 }, { count: 4, pct: 15 }] } });
  r = await POST(req(body([{ productId: 'oil', qty: 2 }, { productId: 'file', qty: 1 }, { productId: 'mask', qty: 1 }])));
  o = await get(`${T}/retailOrders/${r.body.orderId}`);
  check('4 items reach 15%: $11.40 off $76', o?.offerCents === Math.round(7600 * 0.15) && o?.offers?.[0]?.pct === 15 && o?.offerLabel === 'Hand care box (15% off)', o && { c: o.offerCents, offers: o.offers, label: o.offerLabel });

  console.log('checkout: the card keeps its 50¢');
  await fresh({ k: { kind: 'set', name: 'Sample pair', status: 'live', items: [{ productId: 'pin', qty: 1 }, { productId: 'clip', qty: 1 }], save: { type: 'pct', value: 90 } } });
  await db.doc(`${T}/inventory/pin`).set(product('Hair pin', 100)); await db.doc(`${T}/inventory/clip`).set(product('Hair clip', 100));
  r = await POST(req(body([{ productId: 'pin', qty: 1 }, { productId: 'clip', qty: 1 }])));
  o = r.body?.orderId ? await get(`${T}/retailOrders/${r.body.orderId}`) : null;
  check('a saving that would leave less than 50¢ is lowered to leave it', r.status === 200 && o?.offerCents === 150 && o.lines.reduce((s: number, l: any) => s + l.offerCents, 0) === 150, { status: r.status, body: r.body, c: o?.offerCents });

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nall good');
})();
