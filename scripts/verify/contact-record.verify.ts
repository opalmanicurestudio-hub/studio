// scripts/verify/contact-record.verify.ts — the contact record for one visit, and the link-open stamp.
import { contactRecord, contactSummary, contactRecordHtml } from '../../src/lib/contact-record';
import { viewPatch } from '../../src/lib/link-views';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const msgs = [
  { channel: 'sms', kind: 'visit_request', to: '+15550001111', status: 'sent', sentAt: '2026-10-10T15:00:00.000Z', deliveredAt: '2026-10-10T15:00:04.000Z', body: 'Hi Sam, please sign your form: https://x' },
  { channel: 'email', kind: 'visit_aftercare', to: 'sam@x.com', subject: 'Your aftercare', status: 'sent', sentAt: '2026-10-12T18:00:00.000Z', deliveredAt: '2026-10-12T18:00:02.000Z', firstOpenedAt: '2026-10-12T19:00:00.000Z', openCount: 3, firstClickedAt: '2026-10-12T19:01:00.000Z' },
  { channel: 'email', kind: 'reminder', to: 'sam@gmial.com', status: 'sent', sentAt: '2026-10-09T10:00:00.000Z', bouncedAt: '2026-10-09T10:00:05.000Z', failureDetail: 'Mailbox does not exist' },
];
const apt = { linkViews: { visit: { first: '2026-10-10T15:20:00.000Z', last: '2026-10-11T09:00:00.000Z', count: 2 } }, signedForms: [{ formTitle: 'Consent', signedAt: '2026-10-10T15:25:00.000Z' }], policyAcceptance: { acceptedAt: '2026-10-10T15:26:00.000Z', policyVersion: 'v3', cardAuthorization: true } };
const rows = contactRecord(apt, msgs);
ok(rows.every((r, i) => i === 0 || rows[i - 1].at <= r.at), 'oldest first');
ok(rows[0].what === 'Email sent: reminder' && rows[1].strength === 'problem', 'a bounce shows as a problem, with the reason', rows.slice(0, 2));
ok(rows.find((r) => r.what === 'Text sent: request for items before the visit')?.body?.includes('sign your form'), 'the exact words sent are kept');
ok(rows.find((r) => r.what === 'Email opened')?.strength === 'hint', 'an email open is only a hint');
ok(rows.find((r) => r.what === 'Opened their visit link')?.detail?.startsWith('2 times'), 'link opens counted');
ok(rows.some((r) => r.what === 'Signed “Consent”') && rows.some((r) => r.what === 'Agreed to the booking policy' && /v3/.test(r.detail || '')), 'signed and agreed');
const s = contactSummary(rows);
ok(s.sent === 3 && s.delivered === 2 && s.problems === 1 && s.firstAction?.what === 'Opened their visit link', 'summary', s);
const html = contactRecordHtml({ studio: 'Opal <Studio>', clientName: 'Sam', visitWhen: 'Oct 16', appointmentId: 'a1', rows });
ok(html.includes('Opal &lt;Studio&gt;') && html.includes('Contact record') && !/call us/i.test(html), 'printable page, escaped');
ok(contactRecord({}, []).length === 0, 'nothing yet');
ok(JSON.stringify(viewPatch({}, 'aftercare', 'T1')) === '{"first":"T1","last":"T1"}' && viewPatch({ linkViews: { aftercare: { first: 'T0' } } }, 'aftercare', 'T2').first === 'T0', 'first open kept, latest updated');
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
