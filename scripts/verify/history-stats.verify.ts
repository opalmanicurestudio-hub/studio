// Checks the all-time numbers worked out on the server, and how they're brought up to date with the live window.
// Run: npx tsx scripts/verify/history-stats.verify.ts
import { computeHistory, mergeClientHistory } from '../../src/lib/history-stats';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const now = Date.parse('2026-10-20T12:00:00Z'); const d = (s: string) => `2026-${s}T10:00:00Z`;
const appts = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, clientId: 'c1', status: 'completed', serviceId: 's1', staffId: 'p1', startTime: new Date(now - (i + 1) * 20 * 864e5).toISOString(), revenue: 50 })),
  { id: 'x', clientId: 'c1', status: 'cancelled', serviceId: 's1', startTime: d('11-05') },
  { id: 'b1', clientId: 'c2', status: 'completed', serviceId: 's2', startTime: d('03-01') },
];
const tx = [{ type: 'income', category: 'Service Revenue', appointmentId: 'a0', clientId: 'c1', amount: 45, tipAmount: 10 }, { type: 'income', category: 'Retail', clientId: 'c1', amount: 20 }, { type: 'expense', category: 'Discounts', clientId: 'c1', amount: 5 }];
const h = computeHistory(appts, tx, [{ id: 's2', price: 30 }], now);
ok(h.clients.c1.v === 10 && h.clients.c1.r.length === 8 && h.clients.c1.r[0][0] === 'a0', 'visits counted, eight latest kept, newest first');
ok(h.clients.c1.y === 10 && h.clients.c1.la === Date.parse(d('11-05')), 'visits in the last year, latest booking of any kind');
ok(h.clients.c1.sr === 45 && h.clients.c1.rr === 20 && h.clients.c1.tp === 10, 'service, retail and tips per client');
ok(h.services.s1.b === 10 && h.services.s1.rv === 500 && h.services.s1.tx === 45 && h.services.s1.u === 1, 'per service: bookings, revenue, payments, people');
ok(h.services.s2.rv === 30, 'a visit with no revenue recorded counts at the service price');
const live = [{ id: 'a0', clientId: 'c1', status: 'completed', startTime: new Date(now - 20 * 864e5) }, { id: 'new', clientId: 'c1', status: 'completed', startTime: new Date(now - 864e5) }];
const m = mergeClientHistory(h.clients.c1, live, now);
ok(m.visits === 11 && m.done[0].id === 'new' && m.year === 11, 'a visit finished since adds one, and leads the list; nothing counted twice');
ok(mergeClientHistory(undefined, live, now).visits === 2, 'a client the server hasn’t seen yet counts from the window');
const cut = computeHistory(appts, tx, [], now, false);
ok(cut.clients.c1.sr === undefined && cut.services.s1.tx === 0, 'no money in the answer for people who may not see it');
if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
