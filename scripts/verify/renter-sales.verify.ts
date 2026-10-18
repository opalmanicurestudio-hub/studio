import assert from 'node:assert/strict';
import { creditChange, renterShareCents } from '../../src/lib/renter-sales';

const line = { qtyOrdered: 3, qtyShorted: 0, qtyReturned: 0, unitPriceCents: 2000, soldFor: { renterId: 'r1', shopCutPct: 20 } };
assert.equal(renterShareCents(line), 4800, '3 × $20 less the shop’s 20%');
assert.equal(renterShareCents({ ...line, qtyReturned: 1 }), 3200, 'a return takes its share back');
assert.equal(renterShareCents({ ...line, soldFor: undefined }), 0);
assert.equal(renterShareCents({ ...line, lineDiscountCents: 600 }), 4320, 'what the customer actually paid');
assert.deepEqual(creditChange(4800, null), { amountCents: -4800, appliedCents: 0, status: 'paid', clawbackCents: 0 });
assert.equal(creditChange(4800, { amountCents: -4800, appliedCents: 0 }), null, 'nothing to change');
assert.deepEqual(creditChange(0, { amountCents: -4800, appliedCents: 0 }), { amountCents: 0, appliedCents: 0, status: 'voided', clawbackCents: 0 });
assert.deepEqual(creditChange(3200, { amountCents: -4800, appliedCents: 4800 }), { amountCents: -4800, appliedCents: 4800, status: 'paid', clawbackCents: 1600 }, 'already used: flag what to recover');
console.log('renter-sales ok');
