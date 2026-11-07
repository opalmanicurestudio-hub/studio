// scripts/verify/visit-forms.verify.tsx — AFTER BOOKING, WHAT'S LEFT (B6c, board FormsAfter). The visit link opens on
// a ring and the list of the visit's forms and documents (done, to sign, or "anything changed?" for health answers on
// file), saves each form as it's finished by the same rule as the booking sheet, and closes the visit's request once
// nothing is left. One reminder goes out the evening before the forms are due, only if something is left, then a
// thank-you once it's done. Arriving with something left asks for it first, on the client's own phone.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/visit-forms.verify.tsx
import Module from 'module';
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeDb, FV } from './fake-db';

(globalThis as any).React = React;
let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const sent: any[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/audit' || request === './audit') return { logAuditAdmin: async () => undefined };
  if (request === './notify' || request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, x: any) => { sent.push(x); return { ok: true }; } });
  if (request === 'firebase-admin/firestore') return { FieldValue: FV, getFirestore: () => null };
  return load.call(this, request, ...rest);
};

(async () => {
  const F = await import('../../src/lib/forms');
  const V = await import('../../src/lib/forms-visit');
  const RM = await import('../../src/lib/forms-remind');

  // ── when forms are due, and when the one reminder goes out
  ok(F.formsDueAt('2026-11-07T21:30:00Z', '2026-10-20T00:00:00Z') === '2026-11-06T21:30:00.000Z' && F.formsDueAt('2026-11-07T21:30:00Z', '2026-11-07T10:00:00Z') === '2026-11-07T21:30:00.000Z', 'due a day before the visit (at its start when booked less than a day ahead)');
  const zone = 'America/Chicago';
  ok(RM.remindAt('2026-11-06T21:30:00.000Z', zone).toISOString() === '2026-11-06T00:00:00.000Z', 'the reminder: 6 PM the evening before it’s due, on the business’s clock (Thursday 6 PM in Austin)');
  ok(RM.dueWords('2026-11-06T21:30:00.000Z', zone) === 'Fri at 3:30 PM' && RM.dueWords('2026-11-06T21:30:00.000Z', zone, true) === 'Friday at 3:30 PM', '"Fri at 3:30 PM", in the business’s time');

  // ── a visit's forms and documents, as the client sees them
  const db: any = makeDb(); const T = 'tenants/t1';
  const consent = { title: 'Consent and release', category: 'Waiver', fields: [{ id: 'p', type: 'paragraph', label: 'I understand.' }, { id: 's', type: 'signature', label: 'Your signature' }] };
  const health = { title: 'Health and allergy questions', category: 'Intake', fields: [{ id: 'q1', type: 'multiple-choice', label: 'Any skin conditions?', options: ['Yes', 'No'] }] };
  const tenant = { name: 'Opal Manicure Studio', timezone: zone, publicOrigin: 'https://opal.test' };
  await db.doc(T).set(tenant);
  await db.doc(`${T}/consentForms/c1`).set(consent); await db.doc(`${T}/consentForms/h1`).set(health);
  await db.doc(`${T}/services/s1`).set({ name: 'Gel manicure', requiredFormIds: ['h1', 'c1'], requiredFileRequirements: [{ id: 'photo_id', label: 'Photo ID', persistToProfile: true }] });
  await db.doc(`${T}/clients/cl1`).set({ name: 'Dana Reyes', phone: '5125550148', email: 'dana@x.test',
    signedForms: { h1: { signedAt: '2026-03-12T15:00:00Z', version: F.formVersion(health) } }, profileDocuments: [{ requirementId: 'photo_id', files: [{ url: 'https://x' }] }] });
  const appt: any = { id: 'a1', clientId: 'cl1', clientName: 'Dana Reyes', serviceId: 's1', serviceName: 'Gel manicure', status: 'confirmed', startTime: '2026-11-07T21:30:00Z', createdAt: '2026-10-20T00:00:00Z', checkInToken: 'tok12345', signedForms: [] };
  await db.doc(`${T}/appointments/a1`).set(appt);
  const rec = { status: 'pending', appointmentId: 'a1', clientId: 'cl1', clientName: 'Dana Reyes', clientEmail: 'dana@x.test', skipCardStep: true, requiredConsentFormIds: ['c1'], appointmentStartTime: appt.startTime, createdAt: '2026-10-20T00:00:00Z',
    fileRequirements: [{ id: 'photo_id', label: 'Photo ID', persistToProfile: true, minCount: 1 }] };
  await db.doc(`${T}/bookingCompletions/tok12345`).set(rec);
  const v1 = await V.visitForms(db, 't1', appt, { rec });
  const by = (id: string) => v1.asks.find((a) => a.formId === id);
  ok(by('c1')?.ask === 'sign' && by('h1')?.ask === 'confirm' && by('h1')?.health === true && by('h1')?.since === '2026-03-12T15:00:00.000Z', 'the consent form to sign; the health answers on file get "anything changed?"');
  ok(v1.files.length === 1 && v1.files[0].done && v1.files[0].onFile && v1.left === 1 && v1.dueAt === '2026-11-06T21:30:00.000Z', 'photo ID already on file; one thing holds the visit up; due Friday');

  // ── one form at a time from the visit link
  const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(10);
  ok((await V.saveVisitForm(db, 't1', appt, 'a1', 'tok12345', { formId: 'zz' })).status === 400, 'a form that isn’t part of this visit is refused');
  const half = await V.saveVisitForm(db, 't1', appt, 'a1', 'tok12345', { formId: 'c1', formData: { s: SIG } });
  ok(!half.ok && half.error === 'Please finish the form first.', 'an unfinished form (no name) isn’t saved', half);
  sent.length = 0;
  const r1 = await V.saveVisitForm(db, 't1', appt, 'a1', 'tok12345', { formId: 'c1', formData: { s: SIG, __seen: true, __proto__x: 1 }, signedName: 'Dana Reyes' });
  const aNow: any = db._store.get(`${T}/appointments/a1`); const cNow: any = db._store.get(`${T}/clients/cl1`); const rNow: any = db._store.get(`${T}/bookingCompletions/tok12345`);
  ok(r1.ok && r1.left === 0 && r1.done === true, 'a finished form is saved, and with nothing left the visit’s request closes', r1);
  ok(aNow.signedForms.length === 1 && aNow.signedForms[0].formId === 'c1' && aNow.signedForms[0].signedName === 'Dana Reyes' && !('__seen' in aNow.signedForms[0].formData) && aNow.completionStatus === 'completed', 'kept on the visit with the signer’s name, never the form screen’s own marks');
  ok(cNow.signedForms.c1?.source === 'visit_link' && cNow.signedForms.h1?.signedAt === '2026-03-12T15:00:00Z' && rNow.status === 'complete', 'and on file (the health form on file untouched); the request is complete');
  ok(sent.length === 0, 'no thank-you when they weren’t reminded');
  ok(JSON.stringify(Object.keys(aNow.signedForms[0].formData)) === '["s"]', 'only the form’s own questions are kept as answers');
  const hist = () => [...db._store.entries()].filter(([k]) => k.includes('/formHistory/')).map(([, v]) => JSON.stringify(v));
  const h0 = hist();
  const again = await V.saveVisitForm(db, 't1', aNow, 'a1', 'tok12345', { formId: 'c1', formData: { s: SIG }, signedName: 'Someone Else' });
  ok(again.ok && JSON.stringify(hist()) === JSON.stringify(h0) && db._store.get(`${T}/appointments/a1`).signedForms[0].signedName === 'Dana Reyes', 'sending the same form again for this visit changes nothing (the copy kept for good stays as signed)');
  // A read that fails is never taken as "nothing there".
  const dbF: any = makeDb(); for (const [k, v] of db._store.entries()) await dbF.doc(k).set(v);
  await dbF.doc(`${T}/appointments/a1`).set({ ...appt, signedForms: [] }); await dbF.doc(`${T}/bookingCompletions/tok12345`).set(rec);
  const realDoc = dbF.doc.bind(dbF); dbF.doc = (p: string) => { const r = realDoc(p); if (p.endsWith('/consentForms/c1')) return { ...r, get: async () => { throw new Error('unavailable'); } }; return r; };
  const flaky = await V.saveVisitForm(dbF, 't1', { ...appt, signedForms: [] }, 'a1', 'tok12345', { formId: 'c1', formData: { s: SIG }, signedName: 'Dana Reyes' });
  ok(!flaky.ok && flaky.status === 503 && dbF._store.get(`${T}/bookingCompletions/tok12345`).status === 'pending', 'a read that fails: “try again”, and the request stays open');
  // Two forms saved at the same moment both stay on the visit.
  const db4: any = makeDb(); for (const [k, v] of db._store.entries()) await db4.doc(k).set(v);
  await db4.doc(`${T}/services/s1`).set({ name: 'Gel manicure', requiredFormIds: ['c1', 'c2'] }); await db4.doc(`${T}/consentForms/c2`).set({ ...consent, title: 'Aftercare' });
  const a4 = { ...appt, signedForms: [] }; await db4.doc(`${T}/appointments/a1`).set(a4);
  await Promise.all([V.saveVisitForm(db4, 't1', a4, 'a1', '', { formId: 'c1', formData: { s: SIG }, signedName: 'Dana Reyes' }), V.saveVisitForm(db4, 't1', a4, 'a1', '', { formId: 'c2', formData: { s: SIG }, signedName: 'Dana Reyes' })]);
  ok(db4._store.get(`${T}/appointments/a1`).signedForms.map((f: any) => f.formId).sort().join() === 'c1,c2', 'two forms saved at once both stay');
  // An optional document never holds anything up.
  const vOpt = await V.visitForms(db, 't1', { ...appt, signedForms: [{ formId: 'c1' }], healthConfirmed: ['h1'] }, { rec: { ...rec, fileRequirements: [{ id: 'nails', label: 'A photo of your nails', required: false }] } });
  ok(vOpt.left === 0 && vOpt.files[0].optional === true && !vOpt.files[0].done, 'an optional document is shown, but never holds the visit up');
  ok(!(await V.closeIfDone(db, 't1', 'tok12345', { ...appt }, { ...rec, status: 'pending' }, vOpt, tenant)), '…and while it isn’t added, the last form doesn’t close the request (it’s added with Send)');
  // A save whose on-file copy didn't make it is finished when it's sent again.
  const db5: any = makeDb(); for (const [k, v] of db._store.entries()) if (!/formHistory|signedConsents/.test(k)) await db5.doc(k).set(v);
  await db5.doc(`${T}/clients/cl1`).set({ name: 'Dana Reyes', signedForms: { h1: { signedAt: '2026-03-12T15:00:00Z', version: F.formVersion(health) } }, profileDocuments: [{ requirementId: 'photo_id', files: [{ url: 'https://x' }] }] }); await db5.doc(`${T}/bookingCompletions/tok12345`).set(rec);
  const onVisit = { ...appt, signedForms: [{ formId: 'c1', formTitle: 'Consent and release', formData: { s: SIG }, signedName: 'Dana Reyes', signedAt: '2026-11-01T10:00:00.000Z' }], healthConfirmed: ['h1'] };
  await db5.doc(`${T}/appointments/a1`).set(onVisit);
  const healed = await V.saveVisitForm(db5, 't1', onVisit, 'a1', 'tok12345', { formId: 'c1', formData: { s: SIG }, signedName: 'Dana Reyes' });
  ok(healed.ok && (healed as any).repeat && db5._store.get(`${T}/clients/cl1`).signedForms?.c1?.appointmentId === 'a1' && db5._store.get(`${T}/bookingCompletions/tok12345`).status === 'complete', 'sent again after a slow moment: put on file, and the request closes (nothing on the visit changes)');
  ok(F.requestAsksMore({ skipCardStep: true }) === false && F.requestAsksMore({ skipCardStep: true, acknowledgments: [{ id: 'k' }] }) && F.requestAsksMore({ skipCardStep: false }), 'a request that asks for more than forms keeps its Send (and its screen)');

  // "Nothing's changed"
  const h = await V.confirmHealthSame(db, 't1', { ...aNow, id: 'a1' }, 'a1', 'tok12345', 'h1');
  const aH: any = db._store.get(`${T}/appointments/a1`); const cH: any = db._store.get(`${T}/clients/cl1`);
  ok(h.ok && aH.healthConfirmed.includes('h1') && cH.signedForms.h1.confirmedAt && cH.signedForms.h1.signedAt === '2026-03-12T15:00:00Z' && cH.signedForms.c1?.source === 'visit_link', '"Nothing’s changed": confirmed for this visit, and the rest of their forms on file stay as they are');
  ok(!(await V.confirmHealthSame(db, 't1', { ...aH, id: 'a1' }, 'a1', 'tok12345', 'c1')).ok, 'only a health form on file can be confirmed that way');
  const after = await V.visitForms(db, 't1', aH, {});
  ok(after.asks.every((a) => a.ask === 'done') && after.left === 0, 'then everything shows done');

  // ── the one reminder, then thanks
  const db2: any = makeDb();
  for (const [k, v] of db._store.entries()) if (!/bookingCompletions|appointments/.test(k)) await db2.doc(k).set(v);
  await db2.doc(`${T}/clients/cl1`).set({ name: 'Dana Reyes', phone: '5125550148', email: 'dana@x.test', profileDocuments: [{ requirementId: 'photo_id', files: [{ url: 'https://x' }] }], signedForms: { h1: { signedAt: '2026-03-12T15:00:00Z', version: F.formVersion(health) } } });
  await db2.doc(`${T}/appointments/a1`).set(appt); await db2.doc(`${T}/bookingCompletions/tok12345`).set(rec);
  sent.length = 0;
  ok(await RM.formsReminderSweep(db2, 't1', tenant, new Date('2026-11-05T23:00:00Z')) === 0 && sent.length === 0, 'not before 6 PM the evening before');
  ok(await RM.formsReminderSweep(db2, 't1', tenant, new Date('2026-11-06T00:30:00Z')) === 1, 'at 6 PM the evening before: sent');
  const sms = sent.find((x) => x.channel === 'sms'); const mail = sent.find((x) => x.channel === 'email');
  ok(sms?.kind === 'forms_reminder' && sms.text === 'One thing to finish before your visit Sat at 3:30 PM: Consent and release (1 min). https://opal.test/check-in/tok12345', 'the text says what’s left, how long, and the link', sms?.text);
  ok(mail?.subject === 'One thing to finish before Saturday' && /Finish now/.test(mail.html) && /Due Fri at 3:30 PM\. If it isn’t done by then, we’ll go through it with you when you arrive\./.test(mail.html) && /Health and allergy questions/.test(mail.html) && /on file/.test(mail.html), 'the email: the list ticked off, one button, and when it’s due');
  ok(await RM.formsReminderSweep(db2, 't1', tenant, new Date('2026-11-06T02:30:00Z')) === 0 && db2._store.get(`${T}/bookingCompletions/tok12345`).formsReminderSentAt && db2._store.get(`${T}/appointments/a1`).formsReminderSentAt, 'never twice');
  sent.length = 0;
  const r2 = await V.saveVisitForm(db2, 't1', db2._store.get(`${T}/appointments/a1`), 'a1', 'tok12345', { formId: 'c1', formData: { s: SIG }, signedName: 'Dana Reyes' });
  ok(r2.done && sent.length === 1 && sent[0].kind === 'forms_done' && sent[0].channel === 'sms' && sent[0].text === 'Thanks, Dana. You’re all set for Saturday at 3:30 PM.', 'reminded, then done: one thank-you', sent);
  // Booked after that evening, nothing left, or switched off: no reminder.
  const db3: any = makeDb(); for (const [k, v] of db2._store.entries()) if (!/bookingCompletions|appointments/.test(k)) await db3.doc(k).set(v);
  await db3.doc(`${T}/clients/cl1`).set({ name: 'Dana', phone: '5125550148' });
  await db3.doc(`${T}/appointments/a1`).set({ ...appt, createdAt: '2026-11-06T01:00:00Z' }); await db3.doc(`${T}/bookingCompletions/tok12345`).set({ ...rec, createdAt: '2026-11-06T01:00:00Z' });
  sent.length = 0;
  ok(await RM.formsReminderSweep(db3, 't1', tenant, new Date('2026-11-06T02:00:00Z')) === 0 && sent.length === 0, 'booked after that evening: they were just asked, so no reminder');
  await db3.doc(`${T}/appointments/a1`).set({ ...appt }); await db3.doc(`${T}/bookingCompletions/tok12345`).set({ ...rec });
  ok(await RM.formsReminderSweep(db3, 't1', { ...tenant, clientNotify: { formsReminder: false } }, new Date('2026-11-06T02:00:00Z')) === 0, 'switched off under Automations: no reminder');
  await db3.doc(`${T}/clients/cl1`).set({ name: 'Dana', phone: '5125550148', notificationPreferences: { reminderChannel: 'none' } });
  ok(await RM.formsReminderSweep(db3, 't1', tenant, new Date('2026-11-06T02:00:00Z')) === 0 && !db3._store.get(`${T}/bookingCompletions/tok12345`).formsReminderSentAt && db3._store.get(`${T}/bookingCompletions/tok12345`).formsReminderTries === 1, 'they chose no reminders: none, and the mark comes off (tried once)');
  await db3.doc(`${T}/clients/cl1`).set({ name: 'Dana', phone: '5125550148' });
  const { appointmentStartTime: _drop, ...noStart } = rec as any;
  await db3.doc(`${T}/bookingCompletions/tok12345`).set(noStart); await db3.doc(`${T}/appointments/a1`).set({ ...appt });
  sent.length = 0;
  ok(await RM.formsReminderSweep(db3, 't1', tenant, new Date('2026-11-06T02:00:00Z')) === 1 && sent.length === 1, 'a request made without the visit’s time (a phone booking) still reminds, from the visit itself');
  await db3.doc(`${T}/bookingCompletions/tok12345`).set(rec); await db3.doc(`${T}/appointments/a1`).set({ ...appt, linkRevokedAt: '2026-11-01T00:00:00Z' }); sent.length = 0;
  ok(await RM.formsReminderSweep(db3, 't1', tenant, new Date('2026-11-06T02:00:00Z')) === 0 && sent.length === 0, 'a link turned off with “Not you?”: no reminder');
  await db3.doc(`${T}/clients/cl1`).set({ name: 'Dana', phone: '5125550148', email: 'd@x.test', notificationPreferences: { reminderChannel: 'email' } }); sent.length = 0;
  ok(await RM.sendFormsThanks(db3, 't1', { ...appt }, tenant) && sent.length === 1 && sent[0].channel === 'email', 'the thank-you follows how they chose to be reminded');
  ok(!(await RM.sendFormsThanks(db3, 't1', { ...appt }, { ...tenant, clientNotify: { enabled: false } })), '…and isn’t sent when the business has client messages off');
  await db3.doc(`${T}/appointments/a1`).set({ ...appt, status: 'requested' });
  ok(await RM.formsReminderSweep(db3, 't1', tenant, new Date('2026-11-06T02:00:00Z')) === 0, 'a request still waiting on the business: no reminder');

  // ── the screens
  const VF = await import('../../src/components/visit/VisitForms');
  const brand = { accent: '#8b5e57', mood: 'soft' as const, studioName: 'Opal Manicure Studio', zone };
  const view = { asks: [{ formId: 'h1', title: 'Health and allergy questions', ask: 'confirm' as const, why: 'On file since Mar 12', minutes: 1, health: true, since: '2026-03-12T15:00:00.000Z' }, { formId: 'c1', title: 'Consent and release', ask: 'sign' as const, why: 'Read and sign', minutes: 2, health: false }],
    files: [{ id: 'photo_id', label: 'Photo ID', done: true, onFile: true }], left: 1, dueAt: new Date(Date.now() + 86400e3).toISOString() };
  const defs = [{ id: 'c1', ...consent }, { id: 'h1', ...health }];
  const list = renderToStaticMarkup(<VF.FormsLeft brand={brand} visit={view} forms={defs} token="tok12345" tenantId="t1" guardianAsk businessName="Opal" onChanged={() => {}} />);
  ok(/2 things <b>left<\/b>/.test(list) && /Due \w{3} at/.test(list) && /Read and sign · 2 min/.test(list) && />Sign</.test(list) && /On file/.test(list), 'the ring and heading, when it’s due, each row with how long it takes');
  ok(/Anything changed since March 12, like new medications or allergies\?/.test(list) && /Nothing’s changed/.test(list) && />Update</.test(list), '"anything changed?" for health answers on file, with "Nothing’s changed" or "Update"');
  ok(/Sign: Consent and release/.test(list) && /If it isn’t done by \w+ at [0-9:]+ [AP]M, we’ll go through it with you when you arrive\./.test(list), 'the next thing to do, and what happens if it isn’t done');
  const card = renderToStaticMarkup(<VF.FormsLeftCard visit={view} onOpen={() => {}} />);
  ok(/2 things left before your visit/.test(card) && /Health and allergy questions: anything changed\?|Consent and release · 2 min/.test(card), 'the card before the day');
  const arrive = renderToStaticMarkup(<VF.FormsLeftView brand={brand} visit={view} forms={defs} token="t" tenantId="t1" guardianAsk businessName="Opal" onChanged={() => {}} onBack={() => {}} arriving first="Dana" provider="Mia" />);
  ok(/Welcome in, Dana/.test(arrive) && /2 things <b>before Mia starts<\/b>/.test(arrive) && /Consent and release isn’t finished yet\. It takes about 2 minutes\./.test(arrive) && />Not now</.test(arrive) && />Here</.test(arrive) && /Mia sees it the moment you’re done\./.test(arrive) && !/If it isn’t done by/.test(arrive), 'arriving: "before Mia starts", on their own phone, with "Not now"');
  const more = renderToStaticMarkup(<VF.FormsLeft brand={brand} visit={{ ...view, asks: view.asks.map((a) => ({ ...a, ask: 'done' as const })), left: 0 }} forms={defs} token="t" tenantId="t1" guardianAsk businessName="Opal" onChanged={() => {}} moreAfter />);
  ok(/Forms <b>done<\/b>/.test(more) && /Just the steps below now\./.test(more) && !/nothing more to do/.test(more), 'forms done on a screen that asks for more: it says so, never “nothing more to do”');
  const allDone = renderToStaticMarkup(<VF.FormsLeft brand={brand} visit={{ ...view, asks: view.asks.map((a) => ({ ...a, ask: 'done' as const })), left: 0 }} forms={defs} token="t" tenantId="t1" guardianAsk businessName="Opal" onChanged={() => {}} />);
  ok(/All <b>done<\/b>/.test(allDone) && !/Sign:/.test(allDone) && !/If it isn’t done/.test(allDone), 'all done: nothing more asked');

  // ── wiring
  const page = src('src/app/check-in/[token]/page.tsx'); const gates = src('src/components/visit/VisitGates.tsx'); const vc = src('src/app/api/visit-completion/route.ts');
  const act = src('src/app/api/checkin/actions/route.ts'); const cron = src('src/app/api/cron/reminders/route.ts'); const vfx = src('src/components/visit/VisitForms.tsx');
  ok(/setVisitForms\(d\.visit \|\| null\)/.test(page) && /visit=\{visitForms\}/.test(page) && /<FormsLeftCard visit=\{visitForms!\}/.test(page) && /stillToDo=\{!!formsCard \|\| !!photosCard\}/.test(page) && /checkInStatus === 'arrived' && appointmentData\?\.status !== 'servicing' && formsProps && visitForms && visitForms\.left > 0 && !formsLater/.test(page), 'the visit link: the list in the request screen, a card before the day, and asked on arrival');
  ok(/<FormsLeft brand=\{brand\} visit=\{shownVisit\}/.test(gates) && !/FormFieldRenderer/.test(gates) && /if \(formsLeftNow\) \{ setError\('Please finish the forms above first\.'\)/.test(gates) && /onSaved=\{\(id\) => setSavedHere/.test(gates), 'the request screen uses the one form screen; each form is saved on its own');
  ok(/return hasForms \|\| hasFileReqs \|\| requestAsksMore\(completion\)/.test(page) && /requiredConsentFormIds \|\| \[\]\)\.length > 0/.test(page) && /visibilitychange/.test(page) && /&device=\$\{encodeURIComponent\(visitDevice\(\)\)\}/.test(page), 'the request screen stays while it asks for anything; the list is asked again when they come back');
  ok(/onFinish=\{\(\) => \{ const id = open; setOpen\(null\); if \(id\) void save\(id\); \}\}/.test(vfx) && /onClose=\{\(\) => setOpen\(null\)\}/.test(vfx) && /\(onFinish \|\| onClose\)\(\)/.test(src('src/components/booking/FormRunner.tsx')), 'only Done saves a form; closing it keeps the answers for later');
  ok(/visitLinkOpen\(db, x\.tenantId, x\.appt, str\(b\.device, 120\)\)/.test(act) && /visitLinkOpen\(db, tenantId, appt,/.test(vc) && /export async function visitLinkOpen/.test(src('src/lib/client-verify.ts')), 'a link turned off by “Not you?”, or waiting on “Is this you?”, shows and saves nothing');
  ok(/const visit = await visitSummary\(db, tenantId, appt, rec\)/.test(vc) && /never anyone's answers/.test(vc), 'the visit link hears what’s done and left (titles and states, never answers)');
  ok(/action === 'form' \|\| action === 'health_same'/.test(act) && /sendFormsThanks/.test(act), 'saving one form, "nothing’s changed", and thanks when the last step closes it');
  ok(/formsReminderSweep\(db, tid, tDoc\.data\(\)\)/.test(cron) && /id: 'forms-reminder'/.test(src('src/lib/automation-switches.ts')) && /id: 'forms_reminder'/.test(src('src/lib/message-policy.ts')) && /id: 'forms_done'/.test(src('src/lib/message-policy.ts')), 'the hourly job sends it; owners can switch it off and change the words');
  const all = [vfx, src('src/lib/forms-visit.ts'), src('src/lib/forms-remind.ts'), gates].join('\n');
  const tools = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  ok(!tools.test(all) && !/call us|contact us/i.test(all) && !/\{\/\*/.test(vfx) && !/\{\/\*/.test(gates) && !/cancelled/.test(vfx) && !/#b42318/i.test(vfx), 'house rules: no tool names, no "call us", no JSX comments, US spelling, no red');
  console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
