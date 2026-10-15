// scripts/verify/outreach-history.verify.ts — "Why we reached out" (lib/outreach-history).
import { outreachTimeline } from '../../src/lib/outreach-history';
let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } };
const t = outreachTimeline({
  messages: [{ kind: 'loyalty', sentAt: '2026-10-10T15:00:00Z', status: 'sent', channel: 'sms' }, { kind: 'appointment_reminder', sentAt: '2026-10-11T15:00:00Z' }, { kind: 'opportunity', sentAt: '2026-10-01T15:00:00Z' },
    { kind: 'waitlist_offer', sentAt: '2026-10-12T15:00:00Z', status: 'failed' }],
  opportunities: [{ kind: 'due', why: 'usually every 3 weeks, it has been 5', status: 'done', outcome: 'booked', result: { status: 'paid' }, attempts: [{ at: '2026-10-01T15:00:00Z', by: 'auto', byName: 'Sent automatically', channel: 'text', note: 'Hi' }] },
    { kind: 'long_gone', status: 'holdout', createdAt: '2026-09-20T15:00:00Z' }],
  calls: [{ direction: 'outbound', outboundReason: 'waitlist_opening', startedAt: '2026-10-13T15:00:00Z', disconnectionReason: 'dial_no_answer' }, { direction: 'outbound', outboundReason: 'reminder', startedAt: '2026-10-13T16:00:00Z' }],
});
ok(t.length === 5, `reminders and the duplicate opportunity text left out (${t.length})`);
ok(t[0].source === 'call' && t[0].result === 'No answer', 'newest first: the call, no answer');
ok(t.some((i) => /regular who’s due: usually every 3 weeks/.test(i.why) && i.result === 'Came back and paid' && i.tone === 'good'), 'opportunity with reason and result');
ok(t.some((i) => /Held back on purpose/.test(i.how)), 'held back shown as not contacted');
ok(t.some((i) => i.result === 'Didn’t go through' && i.tone === 'bad'), 'failed text');
if (bad) process.exit(1); console.log('outreach history ok');
