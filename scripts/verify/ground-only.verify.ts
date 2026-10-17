import assert from 'node:assert/strict';
import { groundFilter, isGroundRate } from '../../src/lib/ground-only';

assert.equal(isGroundRate({ servicelevel: { token: 'usps_ground_advantage', name: 'Ground Advantage' } }), true);
assert.equal(isGroundRate({ servicelevel: { token: 'usps_priority', name: 'Priority Mail' } }), false);
assert.equal(isGroundRate({ service: 'FedEx Ground' }), true);
assert.equal(isGroundRate({ service: 'UPS 2nd Day Air' }), false);
const rates = [{ servicelevel: { token: 'usps_priority' } }, { servicelevel: { token: 'ups_ground' } }];
assert.equal(groundFilter(rates, true).length, 1);
assert.equal(groundFilter(rates, false).length, 2);
console.log('ground-only ok');
