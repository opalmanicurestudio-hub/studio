// scripts/verify/swap-credit.verify.ts — a lead swap part-way through shares the credit.
import { swapShare, swapAssist } from '../../src/lib/swap-credit';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const T0 = Date.parse('2026-10-15T13:00:00Z'); const apt = { status: 'servicing', actualStartTime: new Date(T0).toISOString(), durationMinutes: 60 };
ok(swapShare(apt, {}, [], T0 + 24 * 60000) === 40, '24 of 60 minutes is 40%');
ok(swapShare(apt, {}, [], T0 + 2 * 60000) === 5 && swapShare(apt, {}, [], T0 + 90 * 60000) === 95, 'kept between 5 and 95');
ok(swapShare({ status: 'confirmed' }, {}, [], T0) === 0, 'not started: nothing to share');
ok(JSON.stringify(swapAssist({}, 'maya', 'lena', 40).assist) === '{"staffId":"maya","pct":40,"fromSwap":true}', 'the one who started shares');
ok(swapAssist({ assist: { staffId: 'jo', pct: 20 } }, 'maya', 'lena', 40).keepExisting, 'an existing assistant is kept');
ok(swapAssist({}, 'maya', 'lena', 0).assist === null, 'zero means the new lead gets it all');
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
