// scripts/verify/visit-clock.verify.ts — the one live timer: service + add-ons + usual extra time + step extra.
import { visitClock, expectedMinutes, clockLabel } from '../../src/lib/visit-clock';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const svc = { id: 's', duration: 45 }; const all = [svc, { id: 'a1', duration: 15 }];
const now = Date.parse('2026-10-16T15:00:00Z'); const start = new Date(now - 62 * 60000).toISOString();
ok(expectedMinutes({ addOnIds: ['a1'], clientExtraMinutes: 10, stepExtra: { 2: 5 } }, svc, all) === 75, 'service + add-on + usual + step extra');
const c = visitClock({ status: 'servicing', actualStartTime: start, addOnIds: ['a1'] }, svc, all, now)!;
ok(c.label === '1:02:00' && c.expected === 60 && c.over && c.overMinutes === 2, 'over by 2 minutes', c);
ok(visitClock({ status: 'servicing', actualStartTime: start, addOnIds: ['a1'], clientExtraMinutes: 10 }, svc, all, now)!.over === false, 'their usual extra time isn’t over');
ok(visitClock({ status: 'confirmed', actualStartTime: start }, svc, all, now) === null, 'no clock until started');
ok(visitClock({ status: 'servicing', serviceStartedAt: start }, svc, all, now)!.secs === 3720, 'started from the ticket counts too');
ok(clockLabel(65) === '1:05', 'm:ss');
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
