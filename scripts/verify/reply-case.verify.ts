import assert from 'node:assert/strict';
import { parseReplyAddress, replyTag } from '../../src/lib/inbound-email';

const c = 'case-AbC123';
const good = `reply+t1.${c}.${replyTag('t1', c)}@in.example.com`;
assert.deepEqual(parseReplyAddress(good), { tenantId: 't1', clientId: c });
assert.deepEqual(parseReplyAddress(`reply+t1.${c}.0123456789@in.example.com`), { tenantId: 't1', clientId: null }, 'a forged tag links nothing');
assert.deepEqual(parseReplyAddress('reply+t1@in.example.com'), { tenantId: 't1', clientId: null });
console.log('reply-case ok');
