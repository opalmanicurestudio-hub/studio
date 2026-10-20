// Checks the date-range reader for money records: both stored date kinds, exact trimming, wide-enough text bounds.
// Run: npx tsx scripts/verify/transactions-range.verify.ts
import { mergeInRange, textBounds, txDate } from '../../src/hooks/use-transactions';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const from = new Date('2026-10-19T04:00:00Z'); const to = new Date('2026-10-20T04:00:00Z'); // one New York day
const [lo, hi] = textBounds(from, to);
ok(lo <= '2026-10-19' && '2026-10-19T03:59:00Z' >= lo && hi > '2026-10-20T03:59:59Z', 'text bounds catch date-only and UTC-timestamped records for the day');
const text = [{ id: 'a', date: '2026-10-19T15:00:00Z', amount: 10 }, { id: 'b', date: '2026-10-19T03:00:00Z', amount: 5 }, { id: 'c', date: '2026-10-20T03:30:00Z', amount: 7 }];
const stamps = [{ id: 'd', date: { seconds: Date.parse('2026-10-19T20:00:00Z') / 1000 }, amount: 3 }, { id: 'a', date: '2026-10-19T15:00:00Z', amount: 10 }];
const got = mergeInRange(text, stamps, from.getTime(), to.getTime());
ok(got.map((t) => t.id).join() === 'c,d,a', 'only the day’s records, newest first, no duplicates');
ok(got.every((t) => t.date instanceof Date), 'dates come back as Dates, as screens expect');
ok(txDate(null).getTime() === 0 && txDate({ toDate: () => new Date(5) }).getTime() === 5, 'odd and Firestore dates read safely');
if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
