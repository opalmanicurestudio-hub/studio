import assert from 'node:assert/strict';
import { assessRisk, riskPolicy } from '../../src/lib/retail-risk';

const pol = riskPolicy({});
const shipOrder = { method: 'ship', totalCents: 45000, shippingAddress: { country: 'US' } };
assert.equal(assessRisk(shipOrder, { outcome: { risk_level: 'normal', risk_score: 12 } }, 3, pol).hold, false);
assert.equal(assessRisk(shipOrder, { outcome: { risk_level: 'elevated' } }, 3, pol).hold, true, 'Stripe elevated holds on its own');
const two = assessRisk(shipOrder, { outcome: { risk_level: 'normal' }, payment_method_details: { card: { country: 'GB', checks: {} } } }, 0, pol);
assert.equal(two.hold, true, 'foreign card plus a big first order'); assert.equal(two.weak.length, 2);
assert.equal(assessRisk({ ...shipOrder, totalCents: 4000 }, { payment_method_details: { card: { country: 'GB' } } }, 0, pol).hold, false, 'one small sign is not enough');
assert.equal(assessRisk({ method: 'counter', totalCents: 90000 }, { payment_method_details: { card: { country: 'GB', checks: { address_postal_code_check: 'fail' } } } }, 0, pol).hold, false, 'pickup only holds on strong signs');
assert.equal(assessRisk(shipOrder, { outcome: { risk_level: 'highest' } }, 0, riskPolicy({ policies: { fraudHold: 'off' } })).hold, false, 'off means off');
console.log('retail-risk ok');
