// Checks the smart packing slip: sections only when they apply, wording from the shop's own settings, gifts.
// Run: npx tsx scripts/verify/smart-slip.verify.ts
import { buildSlip, damageLine, nextLots, returnsLine, slipSettingsOf } from '../../src/lib/order-slip';
import { cleanGift, giftWindow } from '../../src/lib/gift-orders';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };

const busy = {
  orderNumber: 42, customerName: 'Dana Parker', packageCount: 2, claimedByName: 'Maya Lee',
  lines: [
    { lineId: 'a', productId: 'p1', name: 'Argan oil', unitPriceCents: 2400, qtyOrdered: 2 },
    { lineId: 'b', productId: 'p2', name: 'Rose oil', unitPriceCents: 1800, qtyOrdered: 1, qtyShorted: 1, status: 'refunded', shortReason: 'Swapped', swappedToName: 'Lavender oil' },
    { lineId: 'c', productId: 'p3', name: 'Lavender oil', unitPriceCents: 1600, qtyOrdered: 1, swapForLineId: 'b', swapForName: 'Rose oil' },
    { lineId: 'd', productId: 'p4', name: 'Cuticle balm', unitPriceCents: 1200, qtyOrdered: 1, qtyShorted: 1, status: 'backordered' },
    { lineId: 'e', productId: 'p5', name: 'Top coat', unitPriceCents: 900, qtyOrdered: 2, qtyShorted: 1, status: 'shorted' },
    { lineId: 'f', productId: 'p6', name: 'Course', unitPriceCents: 5000, qtyOrdered: 1, digital: true },
  ],
};
const products = { p1: { careNote: 'Two drops at night.', batches: [{ stock: 1, lot: 'A1', expirationDate: '2027-03-01', receivedDate: '2026-01-01' }, { stock: 5, lot: 'B2', expirationDate: '2027-09-01', receivedDate: '2026-06-01' }] } };
const m = buildSlip(busy, { returnWindowDays: 14, deliveryIssueWindowDays: 3, policies: { claimPhotosRequired: true } }, products);
ok(m.orderNo === '#0042' && m.firstName === 'Dana' && m.packedBy === 'Maya', 'header from the order');
ok(m.inBox.map((l) => `${l.name}×${l.qty}`).join(',') === 'Argan oil×2,Lavender oil×1,Top coat×1', 'in the box: only what was sent, never digital, never the swapped-out item');
ok(m.notInBox.length === 2 && /back order/.test(m.notInBox[0].text) && /refund/.test(m.notInBox[1].text), 'not in this box: back order and a refunded short, never the swap');
ok(m.swaps.length === 1 && m.swaps[0].from === 'Rose oil' && /difference/.test(m.swaps[0].text), 'the swap says what was ordered and that the difference is back');
ok(m.boxes === 2, 'two boxes');
ok(m.care.length === 1 && m.care[0].note === 'Two drops at night.', 'care note from the product');
ok(m.useBy.length === 1 && /A1/.test(m.useBy[0].text) && /B2/.test(m.useBy[0].text), 'use by follows the batches that go out first');
ok(m.returns === 'Returns within 14 days of delivery. Start one from your order page, no email needed.', 'return window from the shop');
ok(m.damage === 'Keep the box. Within 3 days of delivery, scan the code and add a photo. We’ll make it right.', 'damage window and photo rule from the shop');
ok(damageLine({}) === 'Keep the box. Scan the code. We’ll make it right.', 'no damage window set: no deadline promised');
ok(returnsLine({ returnsEnabled: false }) === null && buildSlip(busy, { returnsEnabled: false }).returns === null, 'returns off: no return promise on the slip');
ok(m.inBox.every((l) => l.priceCents === null) && buildSlip(busy, { slip: { prices: true } }).inBox[0].priceCents === 2400, 'prices only when the shop turns them on');
const quiet = buildSlip(busy, { slip: { notInBox: false, swap: false, boxes: false, care: false, useBy: false, damage: false, returns: false } }, products);
ok(!quiet.notInBox.length && !quiet.swaps.length && quiet.boxes === 1 && !quiet.care.length && !quiet.useBy.length && !quiet.damage && !quiet.returns, 'every section can be turned off');
const g = buildSlip({ ...busy, gift: { to: 'Sam', message: 'Happy birthday' } }, { slip: { prices: true } });
ok(!!g.gift && g.inBox.every((l) => l.priceCents === null) && !g.damage && /isn’t told/.test(String(g.returns)), 'gift slip: message, no prices, gift exchange wording');
ok(slipSettingsOf({}).size === '4x6' && slipSettingsOf({ slip: { size: 'half' } }).size === 'half', 'slip size defaults to 4x6');
ok(nextLots([{ stock: 0, lot: 'X' }, { stock: 3, lot: 'Y', receivedDate: '2026' }], 2).map((x) => x.lot).join() === 'Y', 'empty batches are skipped');

ok(cleanGift({ isGift: true, to: '  Sam  ', message: 'Hi' })?.to === 'Sam' && cleanGift({ to: 'Sam' }) === null, 'a gift only when ticked');
const now = Date.parse('2026-10-19T12:00:00Z');
ok(giftWindow({ stage: 'shipped', completedAt: '2026-10-10T00:00:00Z' }, { returnWindowDays: 30 }, now).open, 'gift exchange open inside the window');
ok(!giftWindow({ stage: 'shipped', completedAt: '2026-08-01T00:00:00Z' }, { returnWindowDays: 30 }, now).open && !giftWindow({ stage: 'picking' }, {}, now).open && !giftWindow({ stage: 'shipped' }, { returnsEnabled: false }, now).open, 'closed after the window, before it arrives, or with returns off');

if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
