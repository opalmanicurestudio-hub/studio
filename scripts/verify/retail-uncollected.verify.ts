import assert from 'node:assert/strict';
import { noticeDue, noticeText, uncollectedPolicy } from '../../src/lib/retail-uncollected';

const pol = uncollectedPolicy({});
const now = Date.parse('2026-10-17T12:00:00Z');
const at = (h: number) => new Date(now - h * 3600e3).toISOString();
const o = (h: number, sent = 0, extra: any = {}) => ({ stage: 'ready', method: 'counter', readyAt: at(h), uncollectedNotices: sent, ...extra });
assert.equal(noticeDue(o(5), pol, now), 0);
assert.equal(noticeDue(o(25), pol, now), 1);
assert.equal(noticeDue(o(25, 1), pol, now), 0, 'never twice');
assert.equal(noticeDue(o(80, 1), pol, now), 2);
assert.equal(noticeDue(o(150, 2), pol, now), 3, 'last day of a 7-day hold');
assert.equal(noticeDue(o(150, 0), pol, now), 3, 'a missed run jumps to the notice that is due');
assert.equal(noticeDue(o(150, 0, { method: 'ship' }), pol, now), 0);
assert.equal(noticeDue(o(150, 0, { isTest: true }), pol, now), 0);
assert.match(noticeText(3, { customerName: 'Ada B', orderNumber: 12, readyAt: at(150) }, uncollectedPolicy({ policies: { uncollected: { after: 'credit' } } }), 'Opal').sms, /store credit/);
console.log('retail-uncollected ok');
