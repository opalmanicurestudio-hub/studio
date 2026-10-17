import assert from 'node:assert/strict';
import { buildProblems, threadOf } from '../../src/lib/problems-view';

const now = Date.parse('2026-10-17T12:00:00Z');
const iso = (m: number) => new Date(now + m * 60000).toISOString();
const orders = [
  { id: 'o1', orderNumber: 10, customerName: 'Maya Chen', stage: 'arrived', curbside: { arrivedAt: iso(-3) } },
  { id: 'o2', orderNumber: 11, customerName: 'Leo Park', stage: 'paid', holdForReview: true, holdReason: 'Address mismatch', paidAt: iso(-60) },
];
const refundOrders = [{ id: 'o3', orderNumber: 12, customerName: 'Ada Brooks', stage: 'completed', pendingRefundCents: 2400 }];
const tickets = [
  { id: 't1', orderId: 'o3', orderNumber: 12, customerName: 'Ada Brooks', status: 'open', message: 'Where is my refund?', createdAt: iso(-120), customerMessagesSinceStaffReply: 2, followUps: [{ at: iso(-30), message: 'Hello?' }] },
  { id: 't2', orderId: 'o2', status: 'resolved', message: 'x', createdAt: iso(-10) },
];
const claims = [{ id: 'c1', orderId: 'o3', type: 'damaged', lineName: 'Hand cream', status: 'in_review', openedAt: iso(-200), claimValueCents: 1200 }];
const returns = [{ id: 'r1', orderId: 'o2', status: 'open', resolution: 'refund', lines: [{ qty: 2 }], openedAt: iso(-500) }];
const g = buildProblems({ orders, refundOrders, tickets, claims, returns, now });
assert.equal(g.length, 3, 'one row per order');
assert.equal(g[0].orderId, 'o1', 'someone outside comes first');
const o3 = g.find((x) => x.orderId === 'o3')!;
assert.deepEqual(o3.items.map((i) => i.kind), ['message', 'claim', 'refund'], 'grouped and ordered inside the order');
assert.match(o3.items[0].detail, /2 unanswered/);
assert.equal(g.find((x) => x.orderId === 'o2')!.items.length, 2, 'held and a return; the solved message is left out');
assert.deepEqual(threadOf(tickets[0]).map((m) => m.text), ['Where is my refund?', 'Hello?']);
console.log('problems-view ok');
