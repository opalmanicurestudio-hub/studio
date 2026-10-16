// scripts/verify/agent-holds.verify.ts — a held time is busy for everyone but its client, and only while it lasts.
import { holdLive, holdsAsBusy, asDocs, holdText, holdKey } from '../../src/lib/agent-holds';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const now = Date.parse('2026-10-16T14:00:00Z'); const iso = (m: number) => new Date(now + m * 60000).toISOString();
const holds = [{ id: 'h1', status: 'held', expiresAt: iso(10), staffId: 'maya', serviceId: 'g', startTime: iso(120), endTime: iso(165) }, { id: 'h2', status: 'held', expiresAt: iso(-1), staffId: 'lena', startTime: iso(60), endTime: iso(90) }, { id: 'h3', status: 'booked', expiresAt: iso(10), staffId: 'jo', startTime: iso(30), endTime: iso(60) }];
ok(holdLive(holds[0], now) && !holdLive(holds[1], now) && !holdLive(holds[2], now), 'only held and unexpired holds count');
const busy = holdsAsBusy(holds, null, now); ok(busy.length === 1 && busy[0].staffId === 'maya' && busy[0].status === 'held' && busy[0].startTime === holds[0].startTime, 'a live hold blocks its provider and time', busy);
ok(holdsAsBusy(holds, 'h1', now).length === 0, 'but not for the client it was held for');
ok(asDocs(busy)[0].data().id === 'hold-h1', 'readable like a snapshot');
const t = holdText({ first: 'Sam', studio: 'Opal', service: 'gel manicure', when: 'Sat, Oct 17, 2:00 PM', minutes: 15, link: 'https://x' });
ok(t.includes('confirm here within 15 minutes: https://x') && t.includes("If this wasn't you") && !/call us/i.test(t), 'the one text', t);
ok(holdKey() !== holdKey() && holdKey().length >= 16, 'private keys');
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
