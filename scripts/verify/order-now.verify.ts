import assert from 'node:assert/strict';
import { orderNow } from '../../src/lib/order-now';

assert.equal(orderNow({ stage: 'cancelled' }), null);
const swap = orderNow({ stage: 'picking', swapOffer: { lineName: 'Rose oil', sub: { name: 'Lavender oil', unitPriceCents: 1500 }, origUnitCents: 2000, qty: 2 } })!;
assert.equal(swap.action?.kind, 'swap'); assert.match(swap.body, /\$10\.00 difference/);
assert.equal(orderNow({ stage: 'paid', holdForReview: true, method: 'ship' })!.title, 'We’re packing your order', 'a held order reads like any other');
assert.equal(orderNow({ stage: 'ready', method: 'curbside', customerName: 'Maya Chen' })!.action?.target, 'curbside');
assert.equal(orderNow({ stage: 'shipped', trackingUrl: 'https://t', carrier: 'USPS' })!.action?.kind, 'link');
assert.match(orderNow({ stage: 'shipped', pendingRefundCents: 500 }, { refundState: 'pending' })!.extra || '', /\$5\.00/);
console.log('order-now ok');
