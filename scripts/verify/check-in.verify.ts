// scripts/verify/check-in.verify.ts — one way to say "they're here".
import { arrivalFields, arrivalNotice } from '../../src/lib/check-in';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const f = arrivalFields({}, 'front desk', 'T1'); ok(f.checkInStatus === 'arrived' && f.checkedInAt === 'T1' && f.arrivedAt === 'T1' && f.checkedInVia === 'front desk', 'same fields from every door');
ok(arrivalFields({ checkedInAt: 'T0', arrivedAt: 'T0' }, 'client link', 'T2').checkedInAt === 'T0', 'the first arrival time is kept');
const apt = { id: 'a', staffId: 'maya', clientName: 'Sam Patel', status: 'confirmed', startTime: '2026-10-16T19:00:00.000Z' };
const n = arrivalNotice(apt, { timeZone: 'America/New_York', serviceName: 'Full set' });
ok(n?.userId === 'maya' && n.message === 'Sam is here for their 3:00 PM full set.' && n.link === '/planner?visit=a', 'the provider is told', n);
ok(arrivalNotice(apt, { byUserId: 'maya' }) === null, 'not when they checked them in themselves');
ok(arrivalNotice({ ...apt, checkInStatus: 'arrived' }) === null && arrivalNotice({ ...apt, status: 'servicing' }) === null, 'not twice, not once started');
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
