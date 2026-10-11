// Checks lib/pay-questions payQuestionWaiting: who a waiting pay question nudges, and how often.
// Run: npx tsx scripts/verify/pay-question-nudge.verify.ts
import { payQuestionWaiting } from '../../src/lib/pay-questions';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const N = Date.parse('2026-10-11T12:00:00Z'); const ago = (d: number) => new Date(N - d * 864e5).toISOString();
ok(payQuestionWaiting({ status: 'open', staffId: 's1', createdAt: ago(1) }, N) === null, 'open 1 day → not yet');
ok(payQuestionWaiting({ status: 'open', staffId: 's1', createdAt: ago(3) }, N)?.days === 3, 'open 3 days → nudge (3 days)');
ok(payQuestionWaiting({ status: 'checking', staffId: 's1', createdAt: ago(5), messages: [{ by: 's1', at: ago(5) }, { by: 'm1', at: ago(3) }] }, N) === null, 'manager had the last word → waiting on the person, no nudge');
ok(payQuestionWaiting({ status: 'checking', staffId: 's1', createdAt: ago(9), messages: [{ by: 'm1', at: ago(8) }, { by: 's1', at: ago(2.5) }] }, N)?.days === 2, 'person replied 2.5 days ago → nudge');
ok(payQuestionWaiting({ status: 'open', staffId: 's1', createdAt: ago(6), nudgedAt: ago(1) }, N) === null, 'nudged yesterday → not again yet');
ok(payQuestionWaiting({ status: 'open', staffId: 's1', createdAt: ago(6), nudgedAt: ago(2.1) }, N)?.days === 6, 'nudged 2+ days ago → again');
ok(payQuestionWaiting({ status: 'sorted', staffId: 's1', createdAt: ago(6) }, N) === null, 'settled → never');
console.log(bad ? `${bad} failed` : 'All checks passed'); process.exit(bad ? 1 : 0);
