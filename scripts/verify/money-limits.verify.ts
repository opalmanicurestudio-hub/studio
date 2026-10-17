import assert from 'node:assert/strict';
import { refundAllowed, refundLimitFor } from '../../src/lib/money-limits';

const rs = { policies: { refundLimits: { front_desk: 5000, staff: 0 } } };
assert.equal(refundLimitFor(rs, { role: 'owner' }), null);
assert.equal(refundLimitFor(rs, { role: 'manager' }), null, 'no limit set means unlimited');
assert.equal(refundAllowed(rs, { role: 'front_desk' }, 5000).ok, true);
assert.equal(refundAllowed(rs, { role: 'front_desk' }, 5001).ok, false);
assert.equal(refundAllowed(rs, { role: 'staff' }, 1).ok, false, '$0 means none');
assert.equal(refundAllowed(rs, { role: 'staff', isTenantOwner: true }, 999999).ok, true);
console.log('money-limits ok');
