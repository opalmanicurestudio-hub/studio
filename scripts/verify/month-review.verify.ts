// scripts/verify/month-review.verify.ts — the month in review (lib/month-review).
import { monthReview, reviewLines } from '../../src/lib/month-review';
let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } };
const S = Date.parse('2026-09-01T04:00:00Z'), E = Date.parse('2026-10-01T04:00:00Z'); const at = '2026-09-10T15:00:00Z', out = '2026-10-02T15:00:00Z';
const r = monthReview({ month: '2026-09', startMs: S, endMs: E, callsUsed: 12, callsAllowed: 133, callsOn: true,
  openings: [{ createdAt: at, status: 'filled', filledBy: { kind: 'new' } }, { createdAt: at, status: 'filled', filledBy: { byCall: true } }, { createdAt: at, status: 'filled', filledBy: { kind: 'party' } }, { createdAt: at, status: 'expired' }, { createdAt: out, status: 'filled', filledBy: {} }],
  ledger: [{ at, type: 'earn', points: 55 }, { at, type: 'bonus', points: 25 }, { at, type: 'redeem', points: -300, cents: 1000, costCents: 400 }, { at: out, type: 'earn', points: 999 }, { at, type: 'expire', points: -40 }],
  results: [{ startTime: at, state: 'paid', paidCents: 6500 }, { startTime: at, state: 'booked' }], opportunities: [{ createdAt: at, status: 'auto' }, { createdAt: at, status: 'holdout' }],
  messages: [{ sentAt: at, status: 'sent' }, { sentAt: at, status: 'failed' }, { sentAt: at, channel: 'email', status: 'failed' }], inbox: [{ at, body: 'STOP' }, { at, body: 'thanks' }],
  cards: [{ soldAtLocationId: 'a', history: [{ type: 'spend', at, locationId: 'b', cents: -2000 }, { type: 'spend', at: out, locationId: 'b', cents: -5000 }] }], locationNames: { a: 'Main St', b: 'Uptown' } });
ok(r.waitlist.openings === 4 && r.waitlist.filled === 3 && r.waitlist.how.call === 1 && r.waitlist.how.party === 1 && r.waitlist.unfilled === 1, 'waitlist, this month only');
ok(r.rewards.earned === 80 && r.rewards.used === 1 && r.rewards.usedValueCents === 1000 && r.rewards.costCents === 400 && r.rewards.expired === 40, 'rewards');
ok(r.opportunities.paidCents === 6500 && r.opportunities.cameBack === 1 && r.opportunities.found === 2 && r.opportunities.contacted === 1, 'opportunities');
ok(r.texts.sent === 2 && r.texts.failed === 1 && r.texts.stops === 1, 'texts (not emails)');
ok(r.giftOwed.length === 1 && r.giftOwed[0].cents === 2000 && r.giftOwed[0].fromName === 'Main St', `gift cards owed, this month only (${JSON.stringify(r.giftOwed)})`);
const lines = reviewLines(r); ok(lines[0] === 'Waitlist: 3 of 4 cancelled times filled again (1 by text, 1 by a call, 1 by a party).' && lines.some((l) => /Main St owes Uptown \$20/.test(l)), lines.join(' | '));
if (bad) process.exit(1); console.log('month review ok');
