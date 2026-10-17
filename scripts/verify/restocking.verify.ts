import assert from 'node:assert/strict';
import { bandOf, feePctFor, restockingFee, taxShareCents } from '../../src/lib/restocking';

const ol = [{ lineId: 'a', unitPriceCents: 2000 }, { lineId: 'b', unitPriceCents: 1000 }];
assert.equal(bandOf('restock'), 'as_new');
assert.equal(bandOf('open_box'), 'opened');
assert.equal(bandOf('write_off'), 'damaged');
assert.equal(feePctFor({ restockingFeePct: 15 }, 'damaged'), 15, 'old single percentage applies to every condition');
assert.equal(feePctFor({ restockingFees: { as_new: 0, opened: 10, damaged: 30 }, restockingFeePct: 15 }, 'restock'), 0);
assert.equal(feePctFor({ restockingFees: { damaged: 90 } }, 'dispose'), 50, 'capped at 50');
const f = restockingFee(ol, [{ lineId: 'a', qty: 1, reason: 'changed_mind', disposition: 'restock' }, { lineId: 'b', qty: 2, reason: 'changed_mind', disposition: 'open_box' }], { restockingFees: { as_new: 0, opened: 10, damaged: 30 } });
assert.equal(f.cents, 200); assert.equal(f.lines.length, 1); assert.equal(f.waived, false);
const w = restockingFee(ol, [{ lineId: 'a', qty: 1, reason: 'changed_mind', disposition: 'open_box' }, { lineId: 'b', qty: 1, reason: 'defective', disposition: 'damaged' }], { restockingFeePct: 20 });
assert.equal(w.cents, 0); assert.equal(w.waived, true, 'any shop fault waives the whole return');
assert.equal(taxShareCents({ subtotalCents: 5000, taxCents: 400 }, 2500), 200);
assert.equal(taxShareCents({ subtotalCents: 5000, taxCents: 0 }, 2500), 0);
console.log('restocking ok');
