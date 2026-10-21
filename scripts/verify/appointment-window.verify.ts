// Checks how stored appointments become what screens see, and which visit-link copies are watched.
// Run: npx tsx scripts/verify/appointment-window.verify.ts
import { mergeVisit, mergeVisits, liveTokens, visitDate } from '../../src/lib/appointment-merge';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const now = Date.parse('2026-10-20T15:00:00Z');
const a = { id: 'a', status: 'confirmed', checkInToken: 't', startTime: '2026-10-20T16:00:00Z', endTime: '2026-10-20T17:00:00Z' };
ok(mergeVisit(a, { status: 'servicing', checkInStatus: 'arrived' }).status === 'servicing', 'day-of progress lays over a confirmed booking');
ok(mergeVisit({ ...a, status: 'cancelled' }, { status: 'servicing' }).status === 'cancelled', 'an old visit-link copy never revives a cancelled booking');
ok(mergeVisit(a, { status: 'requested' }).status === 'confirmed', 'an old booking stage on the copy is ignored');
ok(mergeVisit(a, null).startTime instanceof Date && mergeVisit(a, null).checkInStatus === 'pending', 'dates become Dates, check-in defaults to pending');
ok(visitDate({ seconds: 10 }).getTime() === 10000, 'Firestore timestamps read');
const masked = mergeVisits([{ ...a, clientPhone: '555' }], new Map(), (x) => ({ ...x, clientPhone: '' }));
ok(masked[0].clientPhone === '', 'contact privacy applies to every list');
const toks = liveTokens([[a, { id: 'old', checkInToken: 'o', startTime: '2026-09-01T10:00:00Z' }, { id: 'far', checkInToken: 'f', startTime: '2026-11-20T10:00:00Z' }], null], now);
ok(toks.join() === 't', 'only visits around today have their visit-link copies watched');
if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
