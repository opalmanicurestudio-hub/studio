// Checks the order's words and links (lib/order-tags, lib/order-method), units held for online orders at the desk
// (lib/held-stock), and who can see and change an order from its link (lib/order-pass).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-gaps.verify.ts
import { followUpKind, orderStatus, orderTags, paymentStatus, restockExpected, unitsOnBackorder, customTags, tagText } from '../../src/lib/order-tags';
import { methodWords } from '../../src/lib/order-method';
import { heldShortfall, freeUnits, heldLine } from '../../src/lib/held-stock';
import { checkPass, linkExpiresAt, linkOpen, makePass, maskAddress, paidHere } from '../../src/lib/order-pass';
import { matchesSearch } from '../../src/lib/orders-view';
let f = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { f++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const day = 864e5; const iso = (ms: number) => new Date(ms).toISOString();

console.log('status and payment');
ok(orderStatus({ stage: 'paid' }).label === 'To pack' && orderStatus({ stage: 'paid', holdUntilRestock: true }).label === 'Waiting on stock', 'paid: to pack, or waiting on stock');
ok(orderStatus({ stage: 'packed', method: 'ship' }).label === 'Packed, needs a label' && orderStatus({ stage: 'packed', method: 'ship', labelUrl: 'x' }).label === 'Labeled, ready to ship', 'packed shipping order: label or not');
ok(orderStatus({ stage: 'completed', method: 'ship', deliveredAt: 'x' }).label === 'Delivered' && orderStatus({ stage: 'completed', method: 'counter' }).label === 'Picked up', 'finished: delivered or picked up');
ok(orderStatus({ stage: 'ready', method: 'curbside' }).label === 'Ready for curbside', 'ready for curbside');
ok(paymentStatus({ stage: 'paid', totalCents: 5000, chargedCents: 5000 }).label === 'Paid', 'paid');
ok(paymentStatus({ stage: 'paid', totalCents: 5000, giftCardCents: 5000 }).label === 'Paid by gift card', 'paid by gift card');
ok(paymentStatus({ stage: 'paid', totalCents: 5000, chargedCents: 3000, giftCardCents: 2000 }).label === 'Paid by card and gift card', 'paid two ways');
ok(paymentStatus({ stage: 'paid', totalCents: 5000, pendingRefundCents: 1200 }).label === 'Refund of $12.00 waiting' && paymentStatus({ stage: 'paid', totalCents: 5000, pendingRefundCents: 1200 }).tone === 'warn', 'a refund waiting');
ok(paymentStatus({ stage: 'completed', totalCents: 5000, refundedCents: 1000 }).label === 'Paid · $10.00 refunded' && paymentStatus({ stage: 'cancelled', totalCents: 5000, refundedCents: 4000, refundedOtherCents: 1000 }).label === 'Refunded', 'partly and fully refunded');
ok(paymentStatus({ stage: 'paid', parentOrderId: 'p', totalCents: 0, subtotalCents: 0 }).label === 'Paid on the first order', 'a backorder is paid on the first order');
ok(paymentStatus({ stage: 'placed' }).label === 'Not paid', 'not paid');

console.log('tags, backorders, method');
const child = { stage: 'paid', parentOrderId: 'p1', holdUntilRestock: true, lines: [{ productId: 'x', qtyOrdered: 1 }] };
ok(followUpKind(child)?.kind === 'backorder' && followUpKind(child)?.waiting === true, 'a backorder, waiting on stock');
ok(followUpKind({ ...child, hasPreorder: true })?.label === 'Sent later' && followUpKind({ ...child, isReplacement: true })?.label === 'Replacement', 'sent later, a replacement');
const parent = { stage: 'picking', lines: [{ status: 'backordered', qtyShorted: 2 }, { status: 'picked' }], tags: ['Fragile', 'fragile', ' VIP '], gift: true, priceTier: 'wholesale', tipCents: 300 };
ok(unitsOnBackorder(parent) === 2, 'units on backorder');
const tags = orderTags(parent);
ok(tags.some((t) => t.id === 'part_backorder' && t.label === '2 on backorder') && tags.some((t) => t.id === 'gift') && tags.some((t) => t.id === 'wholesale'), 'its own tags', tags);
ok(JSON.stringify(customTags(parent)) === '["Fragile","VIP"]' && tags.filter((t) => !t.system).length === 2, 'the shop’s tags, without repeats', customTags(parent));
ok(tags.find((t) => t.id === 'tip')?.onSlip === false && tags.find((t) => t.id === 'gift')?.onSlip === true, 'what prints on the slip');
ok(tagText(parent).includes('fragile') && matchesSearch(parent, 'vip') && !matchesSearch(parent, 'zzz'), 'search finds tags');
ok(methodWords('curbside', { curbsideMode: 'drive_thru' }).short === 'Drive-through' && methodWords('curbside').short === 'Curbside' && methodWords('in_store').long === 'In-store pickup' && methodWords('counter').long === 'Counter pickup', 'method words');
const so = [
  { status: 'Placed', supplier: 'Acme', expectedArrivalDate: '2026-11-04', items: [{ productId: 'x', quantity: 5, receivedQuantity: 0 }] },
  { status: 'Placed', supplier: 'Beta', expectedArrivalDate: '2026-10-30', items: [{ productId: 'x', quantity: 5, receivedQuantity: 5 }] },
  { status: 'Received', supplier: 'Gamma', expectedArrivalDate: '2026-10-25', items: [{ productId: 'x', quantity: 5 }] },
];
const exp = restockExpected(child, so);
ok(exp && exp.at.startsWith('2026-11-04') && /Acme/.test(exp.from), 'expected from the open supplier order with the item still to come', exp);
ok(restockExpected(child, []) === null, 'nothing on order: no date');

console.log('held for online orders');
const inv = [{ id: 'p1', name: 'Hand cream', totalStock: 3, stockReserved: 2 }, { id: 'p2', name: 'Oil', totalStock: 5, stockReserved: 0 }];
ok(freeUnits(inv[0]) === 1, 'free units');
ok(heldShortfall([{ type: 'product', id: 'p1', quantity: 1 }, { type: 'product', id: 'p2', quantity: 9 }], inv).length === 0, 'within what’s free (and nothing held): no question');
const hs = heldShortfall([{ type: 'product', id: 'p1', quantity: 1 }, { type: 'product', id: 'p1', quantity: 1 }], inv);
ok(hs.length === 1 && hs[0].want === 2 && hs[0].free === 1 && hs[0].held === 2, 'two of one product across lines', hs);
ok(/only 1 isn’t held/.test(heldLine(hs[0])), 'said plainly', heldLine(hs[0]));

console.log('the order link and the pass');
const now = Date.parse('2026-10-23T12:00:00Z');
process.env.ORDER_PASS_SECRET = 'test-secret';
const pass = makePass('t1', 'qr1', now);
ok(checkPass('t1', 'qr1', pass, now) && !checkPass('t1', 'qr2', pass, now) && !checkPass('t2', 'qr1', pass, now), 'a pass is for one order family');
ok(!checkPass('t1', 'qr1', pass, now + 31 * day) && !checkPass('t1', 'qr1', 'nonsense', now) && !checkPass('t1', 'qr1', `${now + day}.AAAA`, now), 'expired or forged: no');
const done = { stage: 'completed', method: 'ship', deliveredAt: iso(now - 20 * day), lines: [] };
ok(linkOpen({ stage: 'paid' }, {}, now) && linkExpiresAt({ stage: 'paid' }, {}) === null, 'open while the order is going');
ok(linkOpen(done, {}, now) && !linkOpen({ ...done, deliveredAt: iso(now - 31 * day) }, {}, now), '30 days after it’s finished');
ok(linkOpen({ ...done, deliveredAt: iso(now - 50 * day) }, { returnWindowDays: 60 }, now), '…or the return window, when it’s longer');
ok(linkOpen({ ...done, deliveredAt: iso(now - 400 * day), lines: [{ digital: true }] }, {}, now), 'a download sold for good: open for good');
ok(paidHere({ stripeCheckoutSessionId: 'cs_1', paidAt: iso(now - day) }, 'cs_1', now) && !paidHere({ stripeCheckoutSessionId: 'cs_1', paidAt: iso(now - 3 * day) }, 'cs_1', now) && !paidHere({ stripeCheckoutSessionId: 'cs_1', paidAt: iso(now) }, 'cs_2', now), 'the device that paid, for two days');
const m = maskAddress({ name: 'Dana Whitfield', line1: '88 Pine St', city: 'Portland', state: 'OR', postalCode: '97201' });
ok(m.city === 'Portland' && !m.line1 && !m.postalCode && m.name === 'Dana' && m.masked, 'without a pass: the town, never the street', m);

if (f) { console.error(`${f} failed`); process.exit(1); } console.log('order-gaps ok');
