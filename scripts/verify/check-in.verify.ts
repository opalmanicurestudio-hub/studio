// scripts/verify/check-in.verify.ts — one way to say "they're here".
import { arrivalFields } from '../../src/lib/check-in';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const f = arrivalFields({}, 'front desk', 'T1'); ok(f.checkInStatus === 'arrived' && f.checkedInAt === 'T1' && f.arrivedAt === 'T1' && f.checkedInVia === 'front desk', 'same fields from every door');
ok(arrivalFields({ checkedInAt: 'T0', arrivedAt: 'T0' }, 'client link', 'T2').checkedInAt === 'T0', 'the first arrival time is kept');
// Telling their provider is the server's now, from every door: scripts/verify/arrival-nudge.verify.ts.
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
