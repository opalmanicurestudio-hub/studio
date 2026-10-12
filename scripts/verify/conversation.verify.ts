// scripts/verify/conversation.verify.ts — one record of every conversation with a client (lib/conversation, lib/inbound-email).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/conversation.verify.ts
import { makeDb, check, failures } from './fake-db';
(async () => {
  const C = await import('../../src/lib/conversation'); const E = await import('../../src/lib/inbound-email');
  const db = makeDb(); await db.doc('tenants/t1').set({ name: 'Opal Nail Studio' });
  await db.doc('tenants/t1/clients/ana').set({ id: 'ana', name: 'Ana Ruiz', phone: '(832) 555-0137', email: 'ana@example.com' });
  await db.doc('tenants/t1/clients/rbo').set({ id: 'rbo', name: 'Bo (renter’s client)', phone: '8325550199', ownerRenterId: 'r1' });
  console.log('Who is this?');
  check('a text from +18325550137 is Ana, whatever format her number was saved in', (await C.clientByPhone(db, 't1', '+18325550137'))?.id === 'ana');
  check('an email from ANA@example.com is Ana', (await C.clientByEmail(db, 't1', 'ANA@example.com'))?.id === 'ana');
  check('an unknown number is nobody (it waits in the inbox to be linked)', (await C.clientByPhone(db, 't1', '+15550000000')) === null);

  console.log('Her record');
  await db.doc('tenants/t1/messageLog/m1').set({ clientId: 'ana', channel: 'sms', kind: 'appointment_reminder', body: 'Hi Ana, we’re looking forward to seeing you tomorrow at 10:00 AM.', preview: 'Hi Ana…', sentAt: '2026-10-12T14:00:00.000Z', deliveredAt: '2026-10-12T14:00:05.000Z' });
  await db.doc('tenants/t1/messageLog/m2').set({ clientId: 'ana', channel: 'sms', kind: 'staff_message', body: 'Of course, see you at 11.', sentBy: { id: 'kim', name: 'Kim' }, sentAt: '2026-10-12T14:20:00.000Z' });
  await db.doc('tenants/t1/smsInbox/i1').set({ id: 'i1', clientId: 'ana', channel: 'sms', from: '+18325550137', body: 'Can I come at 11 instead?', at: '2026-10-12T14:10:00.000Z' });
  await db.doc('tenants/t1/smsInbox/i0').set({ id: 'i0', channel: 'sms', from: '+18325550137', body: 'An older text from before linking', at: '2026-10-01T10:00:00.000Z' });
  await db.doc('tenants/t1/voiceCalls/c1').set({ id: 'c1', clientId: 'ana', direction: 'inbound', startedAt: '2026-10-12T15:00:00.000Z', durationSeconds: 95, summary: 'Asked about parking.', transcript: 'Agent: Hi…', recordingPath: 'tenants/t1/calls/c1.wav' });
  await db.doc('tenants/t1/clientNotes/n1').set({ clientId: 'ana', text: 'Prefers almond shape.', visibility: 'team', authorUid: 'maya', authorName: 'Maya', at: '2026-10-02T10:00:00.000Z' });
  await db.doc('tenants/t1/clientNotes/n2').set({ clientId: 'ana', text: 'Raised her voice at the desk.', visibility: 'managers', authorUid: 'jess', authorName: 'Jessica', at: '2026-10-03T10:00:00.000Z' });
  await db.doc('tenants/t1/clientNotes/n3').set({ clientId: 'ana', text: 'My own reminder.', visibility: 'private', authorUid: 'maya', authorName: 'Maya', at: '2026-10-04T10:00:00.000Z' });
  await db.doc('tenants/t1/graceUses/g1').set({ clientId: 'ana', event: 'late_cancellation', at: '2026-10-05T10:00:00.000Z', appliedBy: 'Kim', reason: 'Childcare fell through' });
  const asKim = await C.conversationFor(db, 't1', { id: 'ana', name: 'Ana Ruiz', phone: '(832) 555-0137', email: 'ana@example.com' }, { viewer: { uid: 'kim', manager: false } });
  const types = asKim.map((x) => x.type);
  check('texts both ways, the call, the courtesy and the team note are all there, oldest first', ['text', 'call', 'courtesy', 'note'].every((t) => (types as string[]).includes(t)) && asKim.every((x, i) => i === 0 || x.at >= asKim[i - 1].at), types);
  check('the text from before linking is found by her number', asKim.some((x) => x.text === 'An older text from before linking'));
  check('who wrote what: Kim’s reply is hers; the reminder was automatic', asKim.find((x) => x.text === 'Of course, see you at 11.')?.who === 'Kim' && asKim.find((x) => x.kind === 'appointment_reminder')?.who === 'Automatic');
  check('the whole message is kept, not just a preview', asKim.some((x) => x.text === 'Hi Ana, we’re looking forward to seeing you tomorrow at 10:00 AM.'));
  check('the call has its summary, transcript and a recording', !!asKim.find((x) => x.type === 'call')?.call?.recording);
  check('Kim (not a manager) doesn’t see the managers-only note or Maya’s private note', !asKim.some((x) => /Raised her voice|My own reminder/.test(String(x.text))));
  const asMaya = await C.conversationFor(db, 't1', { id: 'ana', phone: '(832) 555-0137' }, { viewer: { uid: 'maya', manager: false } });
  check('Maya sees her own private note', asMaya.some((x) => x.text === 'My own reminder.'));
  await db.doc('tenants/t1/clientNotes/n1').set({ removedAt: '2026-10-06T10:00:00.000Z', removedBy: { name: 'Maya' } }, { merge: true });
  const asJess = await C.conversationFor(db, 't1', { id: 'ana', phone: '(832) 555-0137' }, { viewer: { uid: 'jess', manager: true } });
  check('a removed note stays on the record for managers, marked removed', asJess.find((x) => x.text === 'Prefers almond shape.')?.status === 'removed by Maya' && !(await C.conversationFor(db, 't1', { id: 'ana' }, { viewer: { uid: 'kim', manager: false } })).some((x) => x.text === 'Prefers almond shape.'));
  const csv = C.conversationCsv({ name: 'Ana Ruiz' }, asJess);
  check('it exports as a spreadsheet', csv.startsWith('"Conversation record: Ana Ruiz"') && csv.includes('"Can I come at 11 instead?"'));

  console.log('Email replies');
  check('the business is found from reply+t1@…', E.tenantFromRecipients(['reply+t1@in.example.com']) === 't1');
  check('only the new part of a reply is shown', E.newPart('Yes, 11 works.\n\nOn Mon, Oct 12, 2026 at 9:00 AM Opal <x@y.com> wrote:\n> Hi Ana') === 'Yes, 11 works.');
  const fake: any = async () => ({ ok: true, json: async () => ({ from: 'Ana Ruiz <ana@example.com>', subject: 'Re: Your appointment', text: 'Yes, 11 works. Thank you!\n\nOn Mon wrote:\n> old' }) });
  const signed = `reply+t1.ana.${E.replyTag('t1', 'ana')}@in.example.com`;
  const forged = await E.receiveEmail(db, { type: 'email.received', data: { email_id: 'spoof-1', to: ['reply+t1@in.example.com'], from: 'ana@example.com', subject: 'Change my card' } }, fake);
  const fm: any = (await db.doc('tenants/t1/smsInbox/em_spoof-1').get()).data();
  check('an email that only CLAIMS to be from Ana (no signed reply address) is not linked to her; the desk decides', forged.ok && !fm.clientId && fm.unverifiedSender === true && fm.suspectedClientId === 'ana', fm);
  const unsigned = await E.receiveEmail(db, { data: { email_id: 'nohook-1', to: [signed], from: 'ana@example.com' } }, fake, { verified: null });
  check('…nor is anything when the webhook itself couldn’t be verified', unsigned.ok && !(await db.doc('tenants/t1/smsInbox/em_nohook-1').get()).data().clientId);
  check('a tampered reply address is not trusted', E.parseReplyAddress([`reply+t1.ana.0000000000@in.example.com`])?.clientId === null);
  const r = await E.receiveEmail(db, { type: 'email.received', data: { email_id: 'abc-1', to: [signed], from: 'ana@example.com', subject: 'Re: Your appointment' } }, fake);
  const m: any = (await db.doc('tenants/t1/smsInbox/em_abc-1').get()).data();
  check('her email reply lands in the inbox, linked to Ana, new part only', r.ok && m.channel === 'email' && m.clientId === 'ana' && m.body === 'Yes, 11 works. Thank you!' && m.subject === 'Re: Your appointment', m);
  check('…the team is told', (await db.collection('tenants/t1/notifications').get()).docs.some((d: any) => /Email from Ana Ruiz/.test(d.data().message)));
  check('…and it’s in her record', (await C.conversationFor(db, 't1', { id: 'ana', email: 'ana@example.com' })).some((x) => x.type === 'email' && x.dir === 'in'));
  check('the same email twice is kept once', (await E.receiveEmail(db, { data: { email_id: 'abc-1', to: ['reply+t1@in.example.com'] } }, fake)).skipped === 'duplicate');
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
