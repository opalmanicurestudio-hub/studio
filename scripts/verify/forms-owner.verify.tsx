// scripts/verify/forms-owner.verify.tsx — SETTINGS › FORMS AND DOCUMENTS (B6d-2, board FormsOwner). Each service says
// what it needs (forms, documents, inspiration photos), when they're due (a day, two days, or to book) and what happens
// if they aren't done (check-in goes through them, a reminder only, or the time is released: on its own or after asking
// the team). The release runs hourly and only once; the client is told why with no fee. The page writes the service's
// own fields and the business's signature rules; the booking sheet asks to book when that's the rule.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/forms-owner.verify.tsx
import Module from 'module';
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeDb, FV } from './fake-db';

(globalThis as any).React = React;
let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const db: any = makeDb(); const sent: any[] = []; const audit: any[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let tenantNow: any = { id: 't1', name: 'Opal Manicure Studio', timezone: 'America/Chicago' };
const colls: Record<string, any[]> = {};
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/audit' || request === './audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_d: any, _t: string, e: any) => { audit.push(e); } });
  if (request === './notify' || request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, x: any) => { sent.push(x); return { ok: true }; } });
  if (request === '@/lib/waitlist-server' || /\/src\/lib\/waitlist-server(\.ts)?$/.test(request)) return fake(request, { makeOpening: async () => ({}) });
  if (request === 'firebase-admin/firestore') return { FieldValue: FV, getFirestore: () => null };
  if (request === '@/context/TenantContext') return { useTenant: () => ({ selectedTenant: tenantNow, can: () => true }), useTenantOptional: () => ({ selectedTenant: tenantNow }) };
  if (request === '@/firebase') return { useFirebase: () => ({ firestore: {} }), useMemoFirebase: (fn: any) => fn(), useCollection: (p: any) => ({ data: p ? colls[p] || [] : null, isLoading: false }) };
  if (request === 'firebase/firestore') return { collection: (_f: any, p: string) => p, doc: (_f: any, p: string) => p, updateDoc: async () => undefined };
  if (request === '@/components/settings/settings-ui') return { SettingsPage: ({ title, help, children }: any) => <main><h1>{title}</h1><p>{help}</p>{children}</main>, Toggle: ({ checked, label }: any) => <button role="switch" aria-checked={checked} aria-label={label} /> };
  if (request === 'next/link') return { __esModule: true, default: ({ href, children, className }: any) => <a href={href} className={className}>{children}</a> };
  return load.call(this, request, ...rest);
};

(async () => {
  const F = await import('../../src/lib/forms');
  const health = { id: 'h1', title: 'Health and allergy questions', category: 'Intake', fields: [{ id: 'q1', type: 'multiple-choice', label: 'Any skin conditions?', options: ['Yes', 'No'], required: true }, { id: 's', type: 'signature', label: 'Signature' }] };
  const lash = { id: 'l1', title: 'Lash and brow consent', category: 'Waiver', fields: [{ id: 'p', type: 'paragraph', label: 'I understand the risks.' }, { id: 'ph', type: 'image-upload', label: 'A photo of your eyes' }, { id: 's', type: 'signature', label: 'Your signature' }] };

  // ── the rule
  ok(JSON.stringify(F.formsRuleOf({})) === JSON.stringify({ due: 24, dueHours: 24, release: 'off', own: false }), 'a service with no rule of its own: due a day before, nothing released');
  ok(F.formsRuleOf({ formsRule: { due: 48, release: 'ask' } }).dueHours === 48 && F.formsRuleOf({ formsRule: { due: 'booking', release: 'auto' } }).dueHours === 24 && F.formsRuleOf({ formsRule: { due: 'booking' } }).own, 'two days, or to book (a visit the team books is due a day before)');
  const start = '2026-11-20T21:30:00.000Z';
  ok(F.formsDueAt(start, '2026-11-01T00:00:00Z', 48) === '2026-11-18T21:30:00.000Z' && F.formsDueAt(start, '2026-11-01T00:00:00Z') === '2026-11-19T21:30:00.000Z' && F.formsDueAt(start, '2026-11-19T12:00:00Z', 48) === start, 'due 24 or 48 hours before, or at the start for a later booking');
  ok(F.asksInspirationPhotos({}) && !F.asksInspirationPhotos({ inspirationPhotos: 'off' }), 'inspiration photos are offered unless switched off for the service');

  // ── the words
  const S = await import('../../src/lib/forms-settings');
  const lashLift = { id: 's2', name: 'Lash lift', requiredFormIds: ['h1', 'l1'], requiredFileRequirements: [{ id: 'photo_id', label: 'Photo ID', persistToProfile: true }], inspirationPhotos: 'off', formsRule: { due: 'booking', release: 'ask' } };
  ok(S.needsLine(lashLift, [health, lash]) === 'Health and allergy questions · Lash and brow consent · Photo ID, kept on file', 'what a service needs, in one line', S.needsLine(lashLift, [health, lash]));
  ok(S.needsLine({ requiredFormIds: ['h1'] }, [health]) === 'Health and allergy questions · inspiration photos, optional', '…inspiration photos when offered');
  ok(S.formKind(health) === 'Health questions and a signature · about 1 minute' && S.formKind(lash) === 'Wording, a photo and a signature', 'each form in a few words', [S.formKind(health), S.formKind(lash)]);
  const types = S.docTypesOf([lashLift, { requiredFileRequirements: [{ id: 'other_id', label: 'photo id ' }, { id: 'ref', label: 'Referral letter' }] }]);
  ok(types.length === 2 && types[0].id === 'photo_id' && types[0].services === 2 && types[0].kept && types[1].label === 'Referral letter' && !types[1].kept, 'each kind of document once, with the id services share', types);
  ok(JSON.stringify(S.ifNotDoneOf({}, { appointmentAutomations: { consentFormUnsigned: { enabled: true, severity: 'auto_cancel', secondWindowHours: 2 } } })) === JSON.stringify({ ifNot: 'release', decide: 'auto' }), 'before a service has a rule, the page starts from what Automations does (saving keeps it)');
  ok(S.ifNotDoneOf({ readiness: { forms: 'remind' } }, {}).ifNot === 'remind' && S.ifNotDoneOf({}, {}).ifNot === 'checkin' && S.ifNotDoneOf({ formsRule: { release: 'ask' } }, {}).decide === 'ask', '…or from "Before a visit"');
  const svcNoRule = { requiredFormIds: ['h1'], readiness: { forms: 'off', photo: 'block' } };
  ok(Object.keys(S.needsPatch(svcNoRule, {}, { formIds: ['h1'], files: [], photos: true, due: 24, ifNot: 'remind', decide: 'ask' })).length === 0, 'opening a service and pressing Done writes nothing (nothing changed)');
  const p1 = S.needsPatch(svcNoRule, {}, { formIds: ['h1'], files: [], photos: true, due: 48, ifNot: 'remind', decide: 'ask' });
  ok(JSON.stringify(p1) === JSON.stringify({ formsRule: { due: 48, release: 'off' } }), 'changing only when they’re due writes only the rule (the start gate as it was)', p1);
  const p2 = S.needsPatch({ requiredFormIds: ['h1'], readiness: { forms: 'remind' } }, {}, { formIds: ['h1', 'l1'], files: [], photos: false, due: 24, ifNot: 'checkin', decide: 'ask' });
  ok(JSON.stringify(p2) === JSON.stringify({ requiredFormIds: ['h1', 'l1'], inspirationPhotos: 'off', formsRule: { due: 24, release: 'off' }, 'readiness.forms': 'block' }) && !('readiness.forms' in S.needsPatch({ requiredFormIds: ['h1'] }, {}, { formIds: ['h1'], files: [], photos: true, due: 24, ifNot: 'release', decide: 'auto' })), 'a new choice writes only what changed, the start gate as a single field; releasing leaves the start gate alone', p2);
  ok(/Right now Automations cancels the visit if a form isn’t signed 2 hours before the visit\. Changing the rules here replaces that for this service\./.test(String(S.automationNote({}, { appointmentAutomations: { consentFormUnsigned: { enabled: true, severity: 'auto_cancel', secondWindowHours: 2 } } }))) && S.automationNote({ formsRule: { due: 24 } }, { appointmentAutomations: { consentFormUnsigned: { enabled: true, severity: 'auto_cancel', secondWindowHours: 2 } } }) === null, 'before a service has its own rule, the page says what Automations does now and that a rule replaces it');
  const reads = S.clientReads(lashLift, [health, lash], {});
  ok(reads === 'Health and allergy questions, Lash and brow consent and your Photo ID, about 3 minutes. They’re needed to book. If the forms aren’t done by then, your time may be released. Your Photo ID is kept on your profile, so you’re asked only once.', 'what the client reads', reads);
  ok(/the time is released: the client is told, nothing is charged/.test(S.ifNotDoneHelp('release', 'auto', 24)) && /asked whether to release the time\. Nothing changes until someone decides/.test(S.ifNotDoneHelp('release', 'ask', 48)) && /two days before/.test(S.ifNotDoneHelp('release', 'ask', 48)), 'what each choice means, in plain words');

  // ── releasing the time (hourly)
  const R = await import('../../src/lib/forms-release');
  const T = 'tenants/t1';
  const appt = { serviceId: 's2', status: 'confirmed', startTime: '2030-05-10T18:00:00.000Z', createdAt: '2030-05-01T00:00:00Z', clientId: 'c1', clientName: 'Dana Reyes', clientPhone: '5125550148', serviceName: 'Lash lift', staffId: 'p1', staffName: 'Rae Kim', checkInToken: 'tokA', depositStatus: 'paid', depositAmountCents: 2500 };
  const at = (iso: string) => new Date(iso).getTime();
  ok(R.releaseCall({ service: lashLift, appt, formsLeft: ['l1'], now: at('2030-05-09T17:00:00Z') }) === null, 'not before they’re due');
  ok(R.releaseCall({ service: lashLift, appt, formsLeft: ['l1'], now: at('2030-05-09T19:00:00Z') }) === 'ask', 'due and not done: the team is asked');
  ok(R.releaseCall({ service: { ...lashLift, formsRule: { due: 24, release: 'auto' } }, appt, formsLeft: ['l1'], now: at('2030-05-09T19:00:00Z') }) === 'release', '…or the time is released, as the service says');
  ok(R.releaseCall({ service: lashLift, appt, formsLeft: ['x9'], now: at('2030-05-09T19:00:00Z') }) === null, 'a form added to one visit never releases it');
  ok(R.releaseCall({ service: lashLift, appt: { ...appt, createdAt: '2030-05-10T08:00:00Z' }, formsLeft: ['l1'], now: at('2030-05-10T09:00:00Z') }) === null, 'booked after they were due: check-in takes it from there');
  ok(R.releaseCall({ service: lashLift, appt, formsLeft: ['l1'], now: at('2030-05-10T16:30:00Z') }) === null, 'never within 2 hours of the start');
  ok(R.releaseCall({ service: lashLift, appt: { ...appt, createdAt: '2030-05-09T12:00:00Z' }, formsLeft: ['l1'], now: at('2030-05-09T19:00:00Z') }) === null && R.releaseCall({ service: lashLift, appt: { ...appt, createdAt: '2030-05-09T12:00:00Z' }, formsLeft: ['l1'], now: at('2030-05-10T00:30:00Z') }) === 'ask', 'booked just before they were due: at least 12 hours to do them first');
  ok(R.releaseCall({ service: { requiredFormIds: ['l1'] }, appt, formsLeft: ['l1'], now: at('2030-05-09T19:00:00Z') }) === null, 'a service without its own rule: Automations, as before');

  await db.doc(T).set({ name: 'Opal Manicure Studio', timezone: 'America/Chicago', publicOrigin: 'https://opal.test' });
  await db.doc(`${T}/services/s2`).set({ ...lashLift, formsRule: { due: 24, release: 'auto' } });
  await db.doc(`${T}/consentForms/h1`).set(health); await db.doc(`${T}/consentForms/l1`).set(lash);
  await db.doc(`${T}/clients/c1`).set({ name: 'Dana Reyes', phone: '5125550148', signedForms: { h1: { signedAt: '2030-04-01T00:00:00Z', version: F.formVersion(health) } } });
  await db.doc(`${T}/staff/o1`).set({ name: 'Jess', role: 'owner' }); await db.doc(`${T}/staff/p1`).set({ name: 'Rae Kim', role: 'staff' }); await db.doc(`${T}/staff/x1`).set({ name: 'Sam', role: 'staff' });
  await db.doc(`${T}/appointments/a1`).set(appt);
  await db.doc(`${T}/bookingCompletions/tokA`).set({ status: 'pending', appointmentId: 'a1', skipCardStep: true, requiredConsentFormIds: ['l1'] });
  const tenant = db._store.get(T);
  const r1 = await R.formsReleaseSweep(db, 't1', tenant, new Date('2030-05-09T19:00:00Z'));
  const a1 = db._store.get(`${T}/appointments/a1`);
  ok(r1.released === 1 && a1.status === 'cancelled' && a1.cancellationReason === 'forms_not_done' && a1.cancellationFeeCharged === 0 && db._store.get('appointmentCheckIns/tokA')?.status === 'cancelled', 'released: canceled with no fee, everywhere', { r1, a1 });
  const sms = sent.find((x) => x.channel === 'sms' && x.kind === 'forms_released');
  ok(sms && /^Opal Manicure Studio: Hi Dana, we’ve released your Lash lift time on Fri, May 10 at 1:00 PM, because your form, Lash and brow consent, wasn’t finished in time\. There’s no fee, and your deposit will be refunded\. Book a new time: https:\/\/opal\.test\/book\/t1$/.test(sms.text), 'the client is told why, with no fee and a way to book again (the studio’s name first)', sms);
  const notes = [...db._store.entries()].filter(([k]: any) => k.startsWith(`${T}/notifications/`)).map(([, v]: any) => v);
  ok(notes.filter((n) => n.type === 'appointment_released').map((n) => n.userId).sort().join() === 'o1,p1' && notes.some((n) => /deposit is waiting for you to refund/.test(n.message)), 'the owner and the provider are told (not everyone)', notes);
  const dd = [...db._store.entries()].filter(([k]: any) => k.startsWith(`${T}/depositDecisions/`)).map(([, v]: any) => v);
  ok(dd.length === 1 && dd[0].suggested === 'refund' && dd[0].amountCents === 2500 && dd[0].status === 'pending', 'the deposit waits for the desk, suggested as a refund (nothing moved here)');
  ok(db._store.get(`${T}/bookingCompletions/tokA`).formsReleaseAt && audit.some((e) => e.action === 'appointment.released_forms'), 'once, and on the record');
  const r2 = await R.formsReleaseSweep(db, 't1', tenant, new Date('2030-05-09T20:00:00Z'));
  ok(r2.released === 0 && r2.asked === 0, 'never twice');
  ok(notes.some((n) => /was released: the form “Lash and brow consent” wasn’t done in time\. They’ve been told there’s no fee; the deposit is waiting for you to refund\./.test(n.message)), 'the team note reads right for one form', notes.map((n) => n.message));

  // Ask me first; and a waived form counts as done.
  await db.doc(`${T}/services/s2`).set({ formsRule: { due: 24, release: 'ask' } }, { merge: true });
  await db.doc(`${T}/appointments/a2`).set({ ...appt, checkInToken: 'tokB' });
  await db.doc(`${T}/bookingCompletions/tokB`).set({ status: 'pending', appointmentId: 'a2', skipCardStep: true, requiredConsentFormIds: ['l1'] });
  await db.doc(`${T}/appointments/a3`).set({ ...appt, checkInToken: 'tokC', formsWaived: { l1: { by: 'Jess', reason: 'Signed on paper' } } });
  await db.doc(`${T}/bookingCompletions/tokC`).set({ status: 'pending', appointmentId: 'a3', skipCardStep: true, requiredConsentFormIds: ['l1'] });
  const before = sent.length;
  const r3 = await R.formsReleaseSweep(db, 't1', db._store.get(T), new Date('2030-05-09T19:00:00Z'));
  const asks = [...db._store.entries()].filter(([k]: any) => k.startsWith(`${T}/notifications/`)).map(([, v]: any) => v).filter((n) => n.type === 'forms_release_ask');
  ok(r3.asked === 1 && r3.released === 0 && db._store.get(`${T}/appointments/a2`).status === 'confirmed' && sent.length === before, '“Ask me first”: nothing changes and the client hears nothing', r3);
  ok(asks.length === 2 && asks.every((n) => n.link === '/planner?visit=a2' && n.priority === 'high') && /Dana Reyes hasn’t finished Lash and brow consent for Lash lift on Fri, May 10 at 1:00 PM\. Open the visit to send a reminder, waive it, or cancel and release the time\./.test(asks[0].message), '…the owner and the provider are asked, with the visit to open', asks[0]);
  ok(db._store.get(`${T}/appointments/a3`).status === 'confirmed' && !db._store.get(`${T}/bookingCompletions/tokC`).formsReleaseAt, 'a form the team waived counts as done');
  // A booth renter's visit: their business, their call.
  await db.doc(`${T}/staff/r1`).set({ name: 'Ren', role: 'renter' });
  await db.doc(`${T}/appointments/a4`).set({ ...appt, staffId: 'r1', checkInToken: 'tokD' });
  await db.doc(`${T}/bookingCompletions/tokD`).set({ status: 'pending', appointmentId: 'a4', skipCardStep: true, requiredConsentFormIds: ['l1'] });
  const r4 = await R.formsReleaseSweep(db, 't1', db._store.get(T), new Date('2030-05-09T19:30:00Z'));
  ok(r4.asked === 0 && !db._store.get(`${T}/bookingCompletions/tokD`).formsReleaseAt, 'a booth renter’s visit is never released or asked about', r4);
  // Moved to a new time: the rule applies to the new time.
  await db.doc(`${T}/appointments/a2`).set({ startTime: '2030-05-17T18:00:00.000Z' }, { merge: true });
  const r5 = await R.formsReleaseSweep(db, 't1', db._store.get(T), new Date('2030-05-16T19:00:00Z'));
  ok(r5.asked === 1 && db._store.get(`${T}/bookingCompletions/tokB`).formsReleaseStart === '2030-05-17T18:00:00.000Z', 'a visit moved to a new time gets the rule again', r5);
  // A business with no service that releases or asks reads nothing more.
  const quiet: any = makeDb(); let nRead = 0; const origColl = quiet.collection.bind(quiet); quiet.collection = (p: string) => { nRead++; return origColl(p); };
  ok(JSON.stringify(await R.formsReleaseSweep(quiet, 'q1', {}, new Date())) === JSON.stringify({ released: 0, asked: 0 }) && nRead === 1, 'a business that doesn’t use it costs one read an hour');

  // ── when they're due, everywhere
  const VF = await import('../../src/lib/forms-visit');
  await db.doc(`${T}/services/s2`).set({ formsRule: { due: 48, release: 'off' } }, { merge: true });
  const st = await VF.visitForms(db, 't1', { ...db._store.get(`${T}/appointments/a3`), id: 'a3' }, {});
  ok(st.dueAt === '2030-05-08T18:00:00.000Z', 'the visit link’s due date follows the service (two days before)', st.dueAt);
  const B = await import('../../src/components/planner/BeforeVisit');
  const bv = (svc: any, extra: any = {}) => renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{ timezone: 'America/Chicago', ...extra }} appointment={{ ...appt, id: 'a2' }} client={{ id: 'c1', name: 'Dana Reyes' }} services={[svc]} forms={[health, lash]} signedConsents={[]} />);
  ok(/If “Health and allergy questions” isn’t signed by Thu at 1:00 PM, the time is released and Dana is told\. Nothing is charged\./.test(bv({ ...lashLift, formsRule: { due: 24, release: 'auto' } })), 'the appointment says the service’s own rule: released…');
  ok(/you’re asked whether to release the time\. Nothing is released without you\./.test(bv(lashLift)) && /by Wed at 1:00 PM/.test(bv({ ...lashLift, formsRule: { due: 48, release: 'ask' } })), '…or the team is asked (and two days before reads as such)');
  ok(/it shows here as a reminder\. Nothing is held up\./.test(bv({ ...lashLift, formsRule: { due: 24, release: 'off' }, readiness: { forms: 'remind' } })) && /the visit starts once it’s signed/.test(bv({ ...lashLift, formsRule: { due: 24, release: 'off' } })), '…or a reminder, or check-in');
  const late = renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{ timezone: 'America/Chicago' }} appointment={{ ...appt, id: 'a2', createdAt: '2030-05-09T12:00:00Z' }} client={{ id: 'c1', name: 'Dana Reyes' }} services={[{ ...lashLift, formsRule: { due: 24, release: 'auto' } }]} forms={[health, lash]} signedConsents={[]} />);
  ok(/isn’t signed by Thu at 7:00 PM, the time is released/.test(late), 'booked late: the appointment says when it would really happen (12 hours after booking)');
  ok(!/canceled automatically/.test(bv({ ...lashLift, formsRule: { due: 24, release: 'off' } }, { appointmentAutomations: { consentFormUnsigned: { enabled: true, severity: 'auto_cancel', secondWindowHours: 2 } } })), 'a service with its own rule is never described by Automations');

  // ── the page
  colls['tenants/t1/services'] = [lashLift, { id: 's1', name: 'Gel manicure', requiredFormIds: ['h1'] }, { id: 's3', name: 'Spa pedicure' }, { id: 'ad', name: 'French tips', type: 'addon' }];
  colls['tenants/t1/consentForms'] = [health, lash];
  const P = await import('../../src/components/settings/FormsSettings');
  const page = renderToStaticMarkup(<P.FormsSettings />);
  ok(/Forms and documents/.test(page) && /What each service needs/.test(page) && />Lash lift</.test(page) && />When they book</.test(page) && />24 hours before</.test(page) && />Nothing</.test(page) && !/French tips/.test(page), 'each service with what it needs and when (add-ons aren’t listed)');
  ok(/href="\/consents\?edit=h1"/.test(page) && />2 services</.test(page) && /href="\/consents\?new=1"/.test(page) && /Wording, a photo and a signature/.test(page), 'your forms, how many services use each, and a new one');
  ok(/A signed form lasts/.test(page) && /Health questions/.test(page) && /Signing for someone under 18/.test(page) && />Photo ID</.test(page) && /Kept on the client’s profile/.test(page), 'signature rules and documents in one place');
  const panel = renderToStaticMarkup(<P.ServiceNeeds service={lashLift} forms={[health, lash]} docTypes={types} tenant={{}} canEdit onSave={async () => true} onClose={() => {}} />);
  ok(/aria-checked="true"[^>]*>.*?Health and allergy questions/.test(panel) && /role="checkbox" aria-checked="false"[^>]*>[\s\S]*?Inspiration photos/.test(panel) && /Referral letter/.test(panel) && /Who decides/.test(panel) && /Ask me first/.test(panel) && /They’re needed to book\./.test(panel) && />Done</.test(panel), 'one service: its needs ticked, its rules, who decides, and what clients read', panel.slice(0, 600));

  // ── wiring
  const book = src('src/app/api/appointments/book/route.ts');
  ok(/trust === null && formsPre\.defsRead && !\(groupSigned && body\?\.quiet === true\) && !movingOwn\) \{[\s\S]{0,200}formsRuleOf\(svc\)\.due === 'booking'[\s\S]{0,300}code: 'forms_needed'/.test(book) && /groupSigned = signed;/.test(book) && /movingOwn = String\(old\.serviceId \|\| ''\) === String\(serviceId \|\| ''\)[\s\S]{0,300}old\.clientEmail[\s\S]{0,200}old\.clientPhone/.test(book), 'online, a service due to book refuses a booking without its forms (not a guest’s part of a group, or their own visit of the same service being moved)');
  const sheet = src('src/components/booking/BookingSheet.tsx'), flow = src('src/components/booking/StudioFlow.tsx');
  ok(/formsToBook: formsRuleOf\(service\)\.due === 'booking'/.test(sheet) && /!c\.formsToBook && <div className="mt-3 flex gap-1/.test(flow) && /They’re needed to book\./.test(flow) && /c\.asksPhotos !== false &&/.test(flow), 'the booking sheet asks for them to book, and offers photos only when the service does');
  ok(/formsReleaseSweep/.test(src('src/app/api/cron/reminders/route.ts')) && /!\(service\?\.formsRule && typeof service\.formsRule === 'object'\)/.test(src('src/app/api/cron/check-automations/route.ts')), 'released hourly; Automations leaves a service with its own rule alone');
  ok(/href: '\/settings\/forms'/.test(src('src/lib/settings-registry.ts')) && /href="\/settings\/forms"/.test(src('src/app/(app)/settings/page.tsx')) && !/LASTS_CHOICES/.test(src('src/app/(app)/settings/page.tsx')) && /\?edit=|get\('edit'\)/.test(src('src/app/(app)/consents/page.tsx')), 'one place in Settings; the builder opens the form you tapped');
  const all = ['src/components/settings/FormsSettings.tsx', 'src/lib/forms-settings.ts', 'src/lib/forms-release.ts', 'src/app/(app)/settings/forms/page.tsx'].map(src).join('\n');
  const tools = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  ok(!tools.test(all) && !/call us|contact us/i.test(all) && !/\{\/\*/.test(all) && !/uppercase|tracking-widest|letter-spacing/.test(all) && !/#b42318|red-/.test(all) && !/cancell(ed|ing)\b(?!')/.test(all.replace(/'cancelled'/g, '')), 'house rules: no tool names, no "call us", no JSX comments, no all-caps labels, no red, US spelling');
  ok(/^export default function \w+\(\) \{\n  return <FormsSettings \/>;\n\}/m.test(src('src/app/(app)/settings/forms/page.tsx')) && !/^export (?!default)/m.test(src('src/app/(app)/settings/forms/page.tsx')), 'the page file exports only the page');
  console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
