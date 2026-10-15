// scripts/verify/text-report.verify.ts — the evening text report (lib/text-report) and STOP being honored (lib/sms).
import { buildTextReport, reportLines, failureWhy } from '../../src/lib/text-report';
let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } };
const since = Date.parse('2026-10-14T04:00:00Z'), until = Date.parse('2026-10-15T00:00:00Z');
ok(failureWhy({ failureDetail: 'Error 30006: Landline' }) === 'A landline, which can’t get texts' && failureWhy({ error: 'Error 21211' }) === 'The number looks wrong' && failureWhy({ failureDetail: 'Error 30034: Number not A2P-registered' }) === 'Texting registration not approved yet', 'reasons in plain words');
const r = buildTextReport([
  { sentAt: '2026-10-14T15:00:00Z', status: 'failed', error: 'Error 21211', recipientName: 'Ana', kind: 'appointment_reminder' },
  { sentAt: '2026-10-14T16:00:00Z', status: 'sent', bouncedAt: 'x', failureDetail: 'Error 30006: Landline', clientName: 'Bo', kind: 'waitlist_offer' },
  { sentAt: '2026-10-14T16:00:00Z', status: 'sent', recipientName: 'Cy' },
  { sentAt: '2026-10-13T16:00:00Z', status: 'failed', recipientName: 'Old' },
  { sentAt: '2026-10-14T17:00:00Z', status: 'failed', error: 'They replied STOP, so texts to this number are off.', recipientName: 'Di' },
], [{ at: '2026-10-14T18:00:00Z', body: 'STOP', fromName: 'Ed' }, { at: '2026-10-14T18:30:00Z', body: 'cancel', fromName: 'Flo' }, { at: '2026-10-14T19:00:00Z', body: 'START', fromName: 'Gus' }, { at: '2026-10-14T19:00:00Z', body: 'stop by at 3?', fromName: 'Hal' }], since, until);
ok(r.failed === 2 && r.groups.length === 2, `two failures today, grouped (${r.failed})`);
ok(r.stopped.map((s) => s.name).join() === 'Ed,Flo' && r.restarted.join() === 'Gus', 'STOP and START, not a sentence that starts with stop');
const lines = reportLines(r);
ok(lines[0] === '2 texts didn’t reach people today.' && lines.some((l) => /Check the number/.test(l)) && lines.some((l) => /“CANCEL” counts as STOP/.test(l)), 'readable lines with fixes');
ok(reportLines(buildTextReport([], [], since, until)).length === 0, 'nothing to report → nothing');
(async () => {
  const { makeDb } = await import('./fake-db'); const { textReportSweep } = await import('../../src/lib/text-report');
  const db = makeDb(); const T = 'tenants/t1'; const tenant = { name: 'Opal', timezone: 'America/New_York', ownerEmail: 'o@x.com' };
  await db.doc(T).set(tenant); await db.doc(`${T}/staff/own`).set({ role: 'owner', name: 'Jess' }); await db.doc(`${T}/staff/tech`).set({ role: 'stylist', name: 'Ty' });
  await db.doc(`${T}/messageLog/m1`).set({ sentAt: '2026-10-14T15:00:00.000Z', status: 'failed', error: 'Error 21211', recipientName: 'Ana', kind: 'reminder' });
  const mails: any[] = []; const email = async (to: string, s: string, l: string[]) => { mails.push({ to, l }); return true; };
  const at6 = Date.parse('2026-10-14T18:00:00-04:00'), at7 = Date.parse('2026-10-14T19:05:00-04:00');
  ok((await textReportSweep(db, 't1', tenant, at6, { email })).skipped === 'not yet', 'not before 7pm');
  const r1: any = await textReportSweep(db, 't1', tenant, at7, { email });
  ok(r1.sent && mails.length === 1 && mails[0].to === 'o@x.com', 'emailed to the owner');
  const notes = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());
  ok(notes.length === 1 && notes[0].userId === 'own', 'notice to the owner and managers only');
  ok((await textReportSweep(db, 't1', tenant, at7 + 3600e3, { email })).skipped === 'not yet', 'once a day');
  if (bad) process.exit(1); console.log('text report ok');
})().catch((e) => { console.error(e); process.exit(1); });
