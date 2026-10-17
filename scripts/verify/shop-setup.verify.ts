import assert from 'node:assert/strict';
import { setupSteps, showGuided } from '../../src/lib/shop-setup';

const fresh = { retailSettings: {} };
assert.equal(showGuided(fresh, 0), true);
assert.equal(setupSteps(fresh, 0).filter((s) => s.done).length, 0);
const selling = { stripeAccountId: 'acct', retailSettings: { shipFrom: { street1: 'a', city: 'b', state: 'c', zip: 'd' } } };
assert.equal(showGuided(selling, 12), false, 'a shop already selling skips the steps');
assert.equal(setupSteps(selling, 12).find((s) => s.id === 'delivery')!.done, true);
assert.equal(setupSteps({ retailSettings: { shippingEnabled: true } }, 3).find((s) => s.id === 'delivery')!.done, false, 'shipping needs a ship-from address');
console.log('shop-setup ok');
