import assert from 'node:assert/strict';
import { depleteBatchesFIFO, expiredUnits, onlineSellable } from '../../src/lib/retail-orders';

const now = Date.parse('2026-10-18T12:00:00Z');
const batches = [
  { id: 'a', stock: 5, costPerUnit: 2, receivedDate: '2026-01-01', lot: 'L1', expirationDate: '2027-06-01' },
  { id: 'b', stock: 5, costPerUnit: 2, receivedDate: '2026-05-01', lot: 'L2', expirationDate: '2026-12-01' },
  { id: 'c', stock: 3, costPerUnit: 2, receivedDate: '2025-12-01', lot: 'L0', expirationDate: '2026-09-01' },
  { id: 'd', stock: 4, costPerUnit: 2, receivedDate: '2025-11-01' },
];
const r = depleteBatchesFIFO(batches as any, 7, now);
assert.deepEqual(r.taken.map((t) => [t.lot, t.qty]), [['L2', 5], ['L1', 2]], 'soonest-expiring good stock first; expired last');
assert.equal(r.taken[0].expirationDate, '2026-12-01');
assert.equal(expiredUnits({ batches }, now), 3);
assert.equal(onlineSellable({ totalStock: 17, stockReserved: 0, batches } as any), 14, 'expired units never sell online');
const old = depleteBatchesFIFO([{ id: 'x', stock: 2, costPerUnit: 1, receivedDate: '2026-02-01' }, { id: 'y', stock: 2, costPerUnit: 1, receivedDate: '2026-01-01' }] as any, 1, now);
assert.equal(old.taken[0].batchId, 'y', 'without dates it is still oldest first');
const all = depleteBatchesFIFO(batches as any, 15, now);
assert.deepEqual(all.taken.map((t) => t.batchId), ['b', 'a', 'd', 'c'], 'undated stock before expired stock');
console.log('lots-expiry ok');
