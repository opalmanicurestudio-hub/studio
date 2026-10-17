import assert from 'node:assert/strict';
import { effectiveUnitCents, normaliseIfUnavailable, similarItems, swapLines, swapReply } from '../../src/lib/retail-swap';

const order = { subtotalCents: 4000, taxCents: 400, lines: [{ lineId: 'a', productId: 'p1', name: 'Rose oil', unitPriceCents: 2000, qtyOrdered: 2, qtyScanned: 0, qtyShorted: 0 }] };
const cheaper = swapLines(order, 'a', { productId: 'p2', name: 'Lavender oil', unitPriceCents: 1500 }, 'n1');
assert.equal(cheaper.qty, 2);
assert.equal(cheaper.refundCents, 1100, '$5 × 2 back, plus its tax');
assert.equal(cheaper.lines[0].status, 'refunded'); assert.equal(cheaper.lines[0].swappedToLineId, 'n1');
assert.equal(cheaper.newLine.lineDiscountCents, 0);
const dearer = swapLines(order, 'a', { productId: 'p3', name: 'Oil duo', unitPriceCents: 2600 }, 'n2');
assert.equal(dearer.refundCents, 0); assert.equal(dearer.newLine.lineDiscountCents, 1200, 'the shop covers the difference as a discount');
assert.equal(effectiveUnitCents(dearer.newLine), 2000, 'the customer still paid the original price');
assert.equal(normaliseIfUnavailable(undefined), 'refund', 'saying nothing means a refund');
assert.equal(swapReply('Yes!'), 'yes'); assert.equal(swapReply(' no thanks'), 'no'); assert.equal(swapReply('what is it?'), null);
const inv = [
  { id: 'p1', category: 'oil', msrp: 20, showOnline: true, totalStock: 0 },
  { id: 'p2', category: 'oil', msrp: 15, showOnline: true, totalStock: 4, stockReserved: 1 },
  { id: 'p3', category: 'oil', msrp: 40, showOnline: true, totalStock: 4 },
  { id: 'p4', category: 'cream', msrp: 20, showOnline: true, totalStock: 4 },
];
assert.deepEqual(similarItems(inv, { productId: 'p1', unitPriceCents: 2000 }).map((x) => x.productId), ['p2']);
console.log('retail-swap ok');
