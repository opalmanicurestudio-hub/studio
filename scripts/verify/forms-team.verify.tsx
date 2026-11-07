// scripts/verify/forms-team.verify.tsx — THE TEAM'S SIDE OF FORMS (B6d, board FormsStaff). On the appointment, "Before
// the visit" says how much is ready and lists each form (done, with the answers one tap away and who opened them kept;
// not signed, with when it's due, "Send a reminder" and "Waive, with a reason"), the documents on file, and inspiration
// photos ("Looks good"). A waived form doesn't hold the visit up and isn't asked again on it; the client only reads
// "Not needed this time". Waiving and reminding are for managers, people who manage bookings and the visit's provider;
// only a manager waives a health form; health answers open only for people who may see health notes. Signed forms read back the
// same everywhere (SignedFormRecord): answers under their questions, the signature drawn or typed, who signed, any
// guardian, where and when; never the form screen's own marks. The planner counts forms by the forms themselves.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/forms-team.verify.tsx
import Module from 'module';
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeDb, FV } from './fake-db';

(globalThis as any).React = React;
let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const db: any = makeDb(); const audit: any[] = []; const sent: any[] = [];
const KAI = { name: 'Kai Park', uid: 'u1', role: 'manager', isManager: true, caps: [] }; let actorNow: any = KAI; let sendOk = true;
const M: any = Module as any; const load = M._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: actorNow }) };
  if (request === '@/lib/audit' || request === './audit') return { logAuditAdmin: async (_d: any, _t: string, e: any) => { audit.push(e); } };
  if (request === 'firebase-admin/firestore') return { FieldValue: FV };
  if (request === './notify' || request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_d: any, x: any) => { if (!sendOk) return { ok: false, error: 'no' }; sent.push(x); return { ok: true }; } });
  return load.call(this, request, ...rest);
};

(async () => {
  const F = await import('../../src/lib/forms');
  const health = { id: 'h1', title: 'Health and allergy questions', category: 'Intake', fields: [{ id: 'q1', type: 'multiple-choice', label: 'Any skin conditions?', options: ['Yes', 'No'] }, { id: 's', type: 'signature', label: 'Signature' }] };
  const consent = { id: 'c1', title: 'Consent and release', category: 'Waiver', fields: [{ id: 'p', type: 'paragraph', label: 'I understand.' }, { id: 's', type: 'signature', label: 'Your signature' }] };
  const svc = { id: 's1', name: 'Gel manicure', requiredFormIds: ['h1', 'c1'], requiredFileRequirements: [{ id: 'photo_id', label: 'Photo ID', persistToProfile: true }] };

  // ── waived for this visit
  const apt = { id: 'a1', serviceId: 's1', signedForms: [{ formId: 'h1', formData: { q1: 'No', s: 'typed:Dana Reyes' }, signedName: 'Dana Reyes', signedAt: '2026-11-01T15:00:00Z', via: 'visit_link' }] };
  ok(F.formsStillNeeded({ apt, services: [svc], client: {}, forms: [health, consent] }).join() === 'c1', 'the consent form is still needed');
  const waivedApt = { ...apt, formsWaived: { c1: { by: 'Kai Park', reason: 'Signed on paper at the desk', at: '2026-11-02T10:00:00Z' } } };
  ok(F.formsStillNeeded({ apt: waivedApt, services: [svc], client: {}, forms: [health, consent] }).length === 0, 'waived for this visit: it no longer holds the visit up');
  const ask = F.formAsks({ apt: waivedApt, ids: ['h1', 'c1'], client: {}, forms: [health, consent] }).find((a) => a.formId === 'c1');
  ok(ask?.ask === 'done' && ask.waived === true && ask.why === 'Waived by Kai: Signed on paper at the desk', 'and tells the team who waived it, and why', ask);
  ok(F.formsStillNeeded({ apt: { id: 'a2', serviceId: 's1' }, services: [svc], client: {}, forms: [health, consent] }).includes('c1'), 'the next visit asks as usual (a waiver isn’t on file)');
  const V = await import('../../src/lib/visit-requests');
  ok(V.formsToSign({ serviceId: 's1', requiredFormIds: ['gone'] }, { requiredFormIds: ['c1'] }, {}, [consent]).join() === 'c1', 'with the forms in hand, a deleted form is never counted on the planner');
  ok(V.formsToSign({ serviceId: 's1' }, { requiredFormIds: ['c1'] }, {}, []).join() === 'c1' && V.pendingFormIds({ serviceId: 's1', requiredFormIds: ['gone'] }, { requiredFormIds: ['c1'] }, {}, [consent]).length === 2, '…while the forms load nothing is hidden, and the one rule itself is unchanged');

  // ── the team's actions
  const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Opal Manicure Studio', timezone: 'America/Chicago', publicOrigin: 'https://opal.test' });
  await db.doc(`${T}/consentForms/h1`).set(health); await db.doc(`${T}/consentForms/c1`).set(consent); await db.doc(`${T}/services/s1`).set(svc);
  await db.doc(`${T}/clients/cl1`).set({ name: 'Dana Reyes', phone: '5125550148' });
  await db.doc(`${T}/appointments/a1`).set({ ...apt, clientId: 'cl1', clientName: 'Dana Reyes', status: 'confirmed', startTime: '2026-11-20T21:30:00Z', createdAt: '2026-11-01T00:00:00Z', checkInToken: 'tok12345' });
  const R = await import('../../src/app/api/forms/visit/route');
  await db.doc(`${T}/bookingCompletions/tok12345`).set({ status: 'pending', appointmentId: 'a1', skipCardStep: true, requiredConsentFormIds: ['c1'] });
  const post = async (body: any) => { const res: any = await R.POST({ json: async () => ({ tenantId: 't1', apptId: 'a1', ...body }), headers: new Headers() } as any); return { status: res.status, body: await res.json() }; };
  ok((await post({ action: 'waive', formId: 'c1', reason: '' })).status === 400, 'waiving needs a reason');
  ok((await post({ action: 'waive', formId: 'zz', reason: 'x' })).status === 400, 'only a form this visit asks for');
  ok((await post({ action: 'waive', formId: 'h1', reason: 'x' })).status === 409, 'not one already done for this visit');
  actorNow = { name: 'Lee Tran', uid: 'u9', role: 'staff', isManager: false, caps: [] };
  ok((await post({ action: 'waive', formId: 'c1', reason: 'x' })).status === 403 && (await post({ action: 'remind' })).status === 403, 'someone else’s visit: waiving and reminding are for a manager or its provider');
  actorNow = { name: 'Lee Tran', uid: 'u9', role: 'staff', isManager: false, caps: ['bookings.manage'] };
  const sentBefore = sent.length;
  const w = await post({ action: 'waive', formId: 'c1', reason: 'Signed on paper at the desk' });
  const a1 = db._store.get(`${T}/appointments/a1`);
  ok(w.body.ok && a1.formsWaived.c1.by === 'Lee Tran' && a1.formsWaived.c1.reason === 'Signed on paper at the desk' && audit.some((e) => e.action === 'forms.waived' && /Consent and release/.test(e.summary)), 'someone who manages bookings waives it, with who and why, on the record');
  const done1 = db._store.get(`${T}/bookingCompletions/tok12345`);
  ok(done1.status === 'complete' && done1.closedBy === 'waiver' && !done1.formsSignedAt && a1.completionStatus === 'completed' && sent.length === sentBefore, 'the last thing it waited on: the request closes, with no thank-you', done1);
  const VF = await import('../../src/lib/forms-visit');
  const seen = await VF.visitForms(db, 't1', { ...db._store.get(`${T}/appointments/a1`), id: 'a1' }, {});
  ok(seen.asks.find((x) => x.formId === 'c1')?.why === 'Not needed this time' && !JSON.stringify(seen.asks).includes('paper'), 'the client reads “Not needed this time”, never the team’s reason', seen.asks);
  const u = await post({ action: 'unwaive', formId: 'c1' });
  const back = db._store.get(`${T}/bookingCompletions/tok12345`);
  ok(u.body.ok && !db._store.get(`${T}/appointments/a1`).formsWaived?.c1 && audit.some((e) => e.action === 'forms.unwaived'), 'undo: it’s asked for again');
  ok(back.status === 'pending' && !('closedBy' in back) && !('completedAt' in back) && db._store.get(`${T}/appointments/a1`).completionStatus === 'pending' && !('requirementsCompletedAt' in db._store.get(`${T}/appointments/a1`)), '…and the request the waiver closed opens again (the closing marks taken off, not left empty)', back);
  // A health form: only a manager waives it.
  await db.doc(`${T}/appointments/a1`).set({ signedForms: [] }, { merge: true });
  ok((await post({ action: 'waive', formId: 'h1', reason: 'x' })).status === 403, 'only a manager waives a health form');
  actorNow = { name: 'Rae Kim', uid: 'p1', role: 'staff', isManager: false, caps: [] };
  await db.doc(`${T}/appointments/a1`).set({ staffId: 'p1' }, { merge: true });
  ok((await post({ action: 'waive', formId: 'c1', reason: 'Signed on paper' })).status === 200 && (await post({ action: 'unwaive', formId: 'c1' })).status === 200, 'the visit’s own provider can (a solo provider is all of these)');
  await db.doc(`${T}/appointments/a1`).set({ signedForms: apt.signedForms, staffId: null }, { merge: true });
  actorNow = KAI;
  ok((await post({ action: 'opened', formId: 'zz' })).status === 400, 'an opening is noted only for a form of this visit');
  await post({ action: 'opened', formId: 'h1' });
  ok(audit.some((e) => e.action === 'forms.answers_opened' && /Kai Park opened Dana Reyes’s answers/.test(e.summary)), 'opening someone’s answers is kept on record');
  sendOk = false;
  ok((await post({ action: 'remind' })).status === 409 && !('formsNudgedAt' in db._store.get(`${T}/appointments/a1`)), 'a reminder that couldn’t go out gives its turn back');
  sendOk = true;
  const r1 = await post({ action: 'remind' });
  ok(r1.body.ok && sent.some((x) => x.kind === 'forms_reminder' && x.channel === 'sms' && /Consent and release/.test(x.text)) && db._store.get(`${T}/appointments/a1`).formsNudgedAt, 'a reminder now: the same text as the evening before', { r1, sent });
  ok((await post({ action: 'remind' })).status === 429, 'not twice in a few hours');
  await db.doc(`${T}/appointments/a1`).set({ formsNudgedAt: null, formsReminderSentAt: new Date(Date.now() - 3600e3).toISOString() }, { merge: true });
  ok((await post({ action: 'remind' })).status === 429, '…counting the evening-before one');
  await db.doc(`${T}/appointments/a1`).set({ formsReminderSentAt: null }, { merge: true });
  await db.doc(T).set({ clientNotify: { enabled: false } }, { merge: true });
  ok((await post({ action: 'remind' })).status === 409, 'not when messages to clients are switched off');
  await db.doc(T).set({ clientNotify: { enabled: true } }, { merge: true });
  await db.doc(`${T}/appointments/a1`).set({ startTime: '2026-01-01T15:00:00Z' }, { merge: true });
  ok((await post({ action: 'remind' })).status === 409, 'not once the visit has started');
  await db.doc(`${T}/appointments/a1`).set({ startTime: '2026-11-20T21:30:00Z', status: 'cancelled' }, { merge: true });
  ok((await post({ action: 'waive', formId: 'c1', reason: 'x' })).status === 409, 'nothing to change on a canceled visit');
  await db.doc(`${T}/appointments/a1`).set({ status: 'confirmed' }, { merge: true });
  actorNow = { name: 'Lee Tran', uid: 'u9', role: 'staff', isManager: false, caps: [] };
  ok((await post({ action: 'photos_ok' })).status === 403, 'someone else’s visit: “Looks good” is for its provider or a manager');
  actorNow = KAI;
  const p = await post({ action: 'photos_ok' });
  ok(p.body.ok && db._store.get(`${T}/appointments/a1`).inspoReview?.status === 'ok' && db._store.get(`${T}/appointments/a1`).inspoReview?.by === 'Kai Park', 'inspiration photos: looked at, and by whom');

  // ── the section on the appointment
  const B = await import('../../src/components/planner/BeforeVisit');
  const S0 = await import('../../src/components/consents/SignedFormRecord');
  const appt = { ...apt, id: 'a1', clientName: 'Dana Reyes', startTime: '2026-11-20T21:30:00Z', createdAt: '2026-11-01T00:00:00Z', inspirationPhotos: [{ url: 'https://x/1.jpg', note: 'This shape, but shorter' }] };
  const client = { id: 'cl1', name: 'Dana Reyes', profileDocuments: [{ requirementId: 'photo_id', files: [{ url: 'https://x/id.jpg' }], uploadedAt: '2026-03-12T15:00:00Z' }] };
  const html = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{ timezone: 'America/Chicago' }} appointment={appt} client={client} services={[svc]} forms={[health, consent]} signedConsents={[]} canSeeHealth />);
  ok(/Before the visit/.test(html) && /2 of 3 ready/.test(html) && />Signed for this visit</.test(html) && />See answers</.test(html) && !/kept on record/.test(html), 'how much is ready, and the answers one tap away');
  const priv = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{ timezone: 'America/Chicago' }} appointment={appt} client={client} services={[svc]} forms={[health, consent]} signedConsents={[]} />);
  ok(/health answers are private/.test(priv) && !/See answers/.test(priv), 'health answers open only for people who may see health notes');
  const loading = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{}} appointment={appt} client={client} services={[svc]} forms={[]} signedConsents={[]} />);
  ok(/Loading this visit’s forms/.test(loading) && /aria-busy="true"/.test(loading), 'while the forms load, it says so (never “nothing to sign”)');
  const many = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{}} appointment={{ ...appt, inspirationPhotos: Array.from({ length: 9 }, (_, k) => ({ url: `https://x/${k}.jpg` })) }} client={{ ...client, profileDocuments: [{ requirementId: 'photo_id', files: [{ url: 'https://x/a.jpg' }, { url: 'https://x/b.jpg' }], uploadedAt: '2026-03-12T15:00:00Z' }] }} services={[svc]} forms={[health, consent]} signedConsents={[]} />);
  ok(/>View 1</.test(many) && />View 2</.test(many) && />\+2</.test(many) && (many.match(/Open inspiration photo/g) || []).length === 7, 'each file to view, and every photo one tap away (+2 more)');
  ok(/Not signed · due Thu at 3:30 PM/.test(html) && />Send a reminder</.test(html) && />Waive, with a reason</.test(html), 'not signed: when it’s due, a reminder, or waive it with a reason');
  ok(/Photo ID/.test(html) && /On file since Mar 12/.test(html) && />View</.test(html) && /Inspiration photos/.test(html) && /“This shape, but shorter”/.test(html) && />Looks good</.test(html), 'the photo ID on file, and inspiration photos with their notes');
  ok(/If “Consent and release” isn’t signed by Thu at 3:30 PM, Dana is asked first thing when they check in\. Nothing here is charged or released without you\./.test(html), 'what happens if it isn’t done, in plain words');
  const auto = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{ timezone: 'America/Chicago', appointmentAutomations: { consentFormUnsigned: { enabled: true, severity: 'auto_cancel', secondWindowHours: 2 } } }} appointment={appt} client={client} services={[svc]} forms={[health, consent]} signedConsents={[]} />);
  ok(/If “Consent and release” isn’t signed 2 hours before the visit, the booking is canceled automatically \(Automations\)/.test(auto) && !/Nothing here is charged/.test(auto), '…and says so when Automations cancels it');
  const req = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{ appointmentAutomations: { consentFormUnsigned: { enabled: true, severity: 'require', secondWindowHours: 1 } } }} appointment={appt} client={client} services={[svc]} forms={[health, consent]} signedConsents={[]} />);
  ok(/isn’t signed 1 hour before the visit, check-in waits until it’s signed \(Automations\)/.test(req), '…or holds check-in');
  const added = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{ appointmentAutomations: { consentFormUnsigned: { enabled: true, severity: 'auto_cancel', secondWindowHours: 2 } } }} appointment={{ ...appt, requiredFormIds: ['x1'], signedForms: [...appt.signedForms, { formId: 'c1', formData: {} }] }} client={client} services={[svc]} forms={[health, consent, { id: 'x1', title: 'Added for this visit', fields: [] }]} signedConsents={[]} />);
  ok(/If “Added for this visit” isn’t signed/.test(added) && !/canceled automatically/.test(added), '…but a form added to one visit never cancels it (as Automations has it)');
  const noWindow = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{ appointmentAutomations: { consentFormUnsigned: { enabled: true, severity: 'auto_cancel' } } }} appointment={appt} client={client} services={[svc]} forms={[health, consent]} signedConsents={[]} />);
  ok(!/canceled automatically/.test(noWindow) && /is asked first thing when they check in/.test(noWindow), '…and Automations with no second window acts on nothing, so it says nothing about canceling');
  const addOnFirst = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{ appointmentAutomations: { consentFormUnsigned: { enabled: true, severity: 'auto_cancel', secondWindowHours: 2 } } }} appointment={appt} client={client} services={[undefined, svc]} forms={[health, consent]} signedConsents={[]} />);
  ok(!/canceled automatically/.test(addOnFirst), '…its own service not loaded yet: an add-on’s forms are never taken for it');
  const none = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{}} appointment={appt} client={client} services={[svc]} forms={[]} formsLoading={false} signedConsents={[]} />);
  ok(!/Loading/.test(none) && /Photo ID/.test(none), 'loaded with no forms at all: not stuck on “Loading”');
  const movedAppt = { ...appt, signedForms: [{ formId: 'h1', formData: {}, answersMoved: true, signedAt: '2026-11-01T15:00:00Z' }] };
  const movedHtml = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{}} appointment={movedAppt} client={client} services={[svc]} forms={[health, consent]} signedConsents={[{ formId: 'h1', formData: { q1: 'Yes' }, signedAt: '2026-11-01T15:00:00Z' }]} canSeeHealth />);
  ok(/See answers/.test(movedHtml), 'answers moved off the visit: the copy on file is the one opened');
  const movedRec = renderToStaticMarkup(<S0.SignedFormRecord record={{ formData: {}, answersMoved: true, signedAt: '2026-11-01T15:00:00Z' }} form={health} />);
  ok(!/No answer/.test(movedRec) && /kept beside the visit/.test(movedRec), '…and a moved record never reads as a list of blank answers');
  const wv = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{}} appointment={{ ...appt, formsWaived: { c1: { by: 'Kai Park', reason: 'Signed on paper' } } }} client={client} services={[svc]} forms={[health, consent]} signedConsents={[]} />);
  ok(/All ready/.test(wv) && /Waived by Kai: Signed on paper/.test(wv) && />Undo</.test(wv) && !/Send a reminder/.test(wv), 'waived: ready, who and why, and Undo');

  // ── a signed form, read back
  const S = await import('../../src/components/consents/SignedFormRecord');
  const rec = renderToStaticMarkup(<S.SignedFormRecord record={{ formId: 'h1', formData: { q1: 'No', s: 'typed:Mia Reyes', old_question: 'Yes', __seen: true, __signedName: 'x' }, signedName: 'Mia Reyes', guardianName: 'Ana Reyes', guardianRelationship: 'Mother', signedAt: '2026-03-12T15:00:00Z', source: 'online_booking' }} form={health} />);
  ok(/Any skin conditions\?/.test(rec) && />No</.test(rec) && /old question/.test(rec) && !/__seen|__signedName/.test(rec), 'each answer under its question (an old one keeps its own name), never the form screen’s own marks');
  ok(/Mia Reyes <span[^>]*>\(typed\)<\/span>/.test(rec) && /Signed as Mia Reyes/.test(rec) && /Completed by Ana Reyes \(Mother\), who agreed to it as their parent or legal guardian/.test(rec) && /Signed when they booked online, March 12, 2026/.test(rec), 'a typed signature marked as typed, who signed, the guardian, and where and when');
  const row = renderToStaticMarkup(<S.SignedFormRow sc={{ formId: 'c1', formTitle: 'Consent and release', signedAt: '2026-03-12T15:00:00Z', source: 'online_booking' }} form={consent} first />);
  ok(/Consent and release/.test(row) && /Signed Mar 12, 2026 · when they booked online/.test(row) && />See answers</.test(row), 'on the client’s profile: each signed form with when and where, and its answers');
  const lockedRow = renderToStaticMarkup(<S.SignedFormRow sc={{ formId: 'h1', formTitle: 'Health', signedAt: '2026-03-12T15:00:00Z' }} form={health} locked first />);
  ok(/Health answers are private/.test(lockedRow) && !/See answers/.test(lockedRow), '…health answers locked for people who may not see health notes');
  const CT = await import('../../src/components/clients/ClientTabs');
  const soon = new Date(Date.now() + 3 * 864e5).toISOString();
  const need = renderToStaticMarkup(<CT.ClientFormsNeeded appointments={[{ id: 'n1', serviceId: 's9', startTime: soon, status: 'confirmed' }]} services={[{ id: 's9', requiredFormIds: ['c1', 'gone'] }]} consentForms={[consent]} consents={[]} onOpenVisit={() => {}} />);
  ok(/1 form to sign/.test(need) && !/A form</.test(need) && /for [A-Z][a-z]{2}, [A-Z][a-z]{2} \d/.test(need), 'the profile’s forms list skips a deleted form, with US-style dates', need.slice(0, 400));
  const shapes = renderToStaticMarkup(<S.SignedFormRecord record={{ formData: { prefs: { gel: true, acrylic: false, length: 'short' }, s: '/api/files/view?p=sig.png' }, signedAt: '2026-03-13T03:30:00Z' }} form={{ fields: [{ id: 'prefs', type: 'checkbox', label: 'Preferences' }, { id: 's', type: 'signature', label: 'Signature' }] }} zone="America/Chicago" />);
  ok(/gel, length: short/.test(shapes) && !/\[object Object\]/.test(shapes) && /March 12, 2026, 10:30 PM/.test(shapes) && /aria-label="Signature"|alt="Signature"/.test(shapes), 'any answer shape in words, a private signature file, and the business’s own clock', shapes);

  // ── wiring
  const sheet = src('src/components/planner/AppointmentDetailsSheet.tsx'); const agenda = src('src/components/planner/AgendaView.tsx');
  ok(/<BeforeVisit tenantId=\{tenantId!\}/.test(sheet) && !/Requirements & Intake/.test(sheet) && !/Health Disclosure Required/.test(sheet) && /waived\.has\(formId\)/.test(sheet), 'the appointment shows "Before the visit"; a waived form doesn’t stop the start');
  ok(/formsToSign\(a, service, c, forms, tenant\)/.test(agenda) && /formsToSign\(a1, service, c1, consentForms, selectedTenant\)/.test(src('src/components/planner/AppointmentCard.tsx')) && ['src/components/clients/ClientsList.tsx', 'src/components/clients/ClientProfileParts.tsx', 'src/components/clients/ClientSnapshot.tsx'].every((f) => /formsToSign\(/.test(src(f)) && !/pendingFormIds\(/.test(src(f))) && /useInventoryOptional\(\)\?\.consentForms/.test(agenda) && /useInventoryOptional\(\)\?\.consentForms/.test(src('src/components/planner/VisitPanel.tsx')) && /useInventoryOptional\(\)\?\.consentForms/.test(src('src/components/planner/NowFirst.tsx')), 'the planner counts forms by the forms themselves');
  ok(/<SignedFormRow /.test(src('src/app/(app)/clients/[id]/page.tsx')) && !/Staff Witnessed/.test(src('src/app/(app)/clients/[id]/page.tsx')) && /<SignedFormRecord record=\{consent\}/.test(src('src/app/(app)/clients/[id]/report/page.tsx')) && /<SignedFormRecord record=\{consent\}/.test(src('src/components/consents/PrintableConsentForm.tsx')), 'the profile, the report and the printed record read back the same way');
  ok(/toMs\(appt\.formsNudgedAt\) > now\.getTime\(\) - 4 \* 3600e3\) return;/.test(src('src/lib/forms-remind.ts')), 'the evening reminder waits if the team sent one in the last 4 hours');
  ok(['src/app/api/walkins/route.ts', 'src/app/api/checkin/actions/route.ts', 'src/app/api/visit-completion/route.ts', 'src/components/clients/ClientTabs.tsx'].every((f) => /waivedOnVisit/.test(src(f))) && /pill\('Waived for this visit'\)/.test(src('src/components/clients/ClientTabs.tsx')), 'the kiosk, check-in, the visit link and the profile all honor a waiver');
  ok(/canSeeHealth=\{canSeeCareNoteContents\(/.test(sheet) && /locked=\{!showCareContents/.test(src('src/app/(app)/clients/[id]/page.tsx')) && /Health answers are private/.test(src('src/app/(app)/clients/[id]/report/page.tsx')), 'health answers gated on the appointment, the profile and the report');
  const all = [src('src/components/planner/BeforeVisit.tsx'), src('src/components/consents/SignedFormRecord.tsx'), src('src/components/consents/PrintableConsentForm.tsx'), src('src/app/api/forms/visit/route.ts')].join('\n');
  const tools = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  ok(!tools.test(all) && !/call us|contact us/i.test(all) && !/\{\/\*/.test(all) && !/uppercase|tracking-widest/.test(all) && !/#b42318|red-/.test(all) && !/IP Address|Secure Kiosk/.test(all), 'house rules: no tool names, no "call us", no JSX comments, no all-caps labels, no red, no claims we don’t make');
  console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
