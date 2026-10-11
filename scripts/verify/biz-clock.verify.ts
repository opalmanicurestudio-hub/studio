// Checks lib/biz-clock: the staff app's "today" and clock times follow the business's zone, not the phone's.
// Run: TZ=America/New_York npx tsx scripts/verify/biz-clock.verify.ts
import { setBizZone, biz, bizKey, bizDayStart, bizZone } from '../../src/lib/biz-clock';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const t = new Date('2026-10-12T02:30:00Z');   // 10:30pm Oct 11 in New York, 7:30pm Oct 11 in Los Angeles, 3:30am Oct 12 in London
setBizZone('');
ok(bizKey(t) === '2026-10-11' && biz(t).getHours() === 22, 'no zone → the phone’s own clock (New York here)');
setBizZone('Europe/London');
ok(bizZone() === 'Europe/London', 'zone set');
ok(bizKey(t) === '2026-10-12', 'London business: it is already Oct 12 there');
ok(biz(t).getHours() === 3 && biz(t).getMinutes() === 30, 'London wall clock reads 3:30');
ok(bizDayStart('2026-10-12').toISOString() === '2026-10-11T23:00:00.000Z', 'London day starts at 23:00Z (summer time)');
setBizZone('America/Los_Angeles');
ok(biz(t).getHours() === 19 && bizKey(t) === '2026-10-11', 'Los Angeles: 7:30pm Oct 11');
ok(bizDayStart('2026-11-01').toISOString() === '2026-11-01T07:00:00.000Z', 'Los Angeles Nov 1 starts at 07:00Z (still summer time at midnight)');
setBizZone('Not/AZone');
ok(bizZone() === '', 'an invalid zone is ignored');
console.log(bad ? `${bad} failed` : 'All checks passed'); process.exit(bad ? 1 : 0);
