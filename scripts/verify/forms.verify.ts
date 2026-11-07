// scripts/verify/forms.verify.ts — ONE RULE FOR FORMS ON FILE (B6a, Forms and documents). A form a client signed stays
// on file until its wording changes or the business's time limit passes (12 months unless it chooses), unless it's
// signed at every visit; health forms on file get "anything changed?" instead. Every screen asks lib/forms, and every
// signature is saved by lib/forms-server, so a form signed online, on the visit link or at the kiosk is on file
// everywhere, with the version of the wording signed and a copy kept for good.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/forms.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb } from './fake-db';

let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/audit' || request === './audit') return { logAuditAdmin: async () => undefined };
  return load.call(this, request, ...rest);
};

(async () => {
  const F = await import('../../src/lib/forms');
  const FS = await import('../../src/lib/forms-server');

  // ── the version of a form's wording
  const consent = { id: 'f1', title: 'Consent and release', category: 'Waiver', fields: [{ id: 'a', type: 'paragraph', label: 'I understand gel services…' }, { id: 's', type: 'signature', label: 'Sign here' }] };
  const v1 = F.formVersion(consent);
  ok(/^v[0-9a-z]+$/.test(v1) && F.formVersion(JSON.parse(JSON.stringify(consent))) === v1 && F.formVersion({ ...consent, clientsSigned: 9, notifyOnEdit: true }) === v1, 'the same words always give the same version (counts and settings aside)');
  ok(F.formVersion({ ...consent, fields: [{ ...consent.fields[0], label: 'I understand gel and acrylic services…' }, consent.fields[1]] }) !== v1 && F.formVersion({ ...consent, title: 'Consent' }) !== v1, 'changed words give a new version');

  // ── where one form stands for one client
  const now = new Date('2026-11-02T12:00:00Z');
  const R = F.FORM_RULES_DEFAULT;
  ok(R.lastsMonths === 12 && R.health === 'changed' && R.guardian === true, 'defaults: 12 months, "anything changed?" for health forms, guardians asked');
  ok(F.formStateOf(consent, null, R, now) === 'none', 'never signed');
  ok(F.formStateOf(consent, { signedAt: '2026-06-01T00:00:00Z', version: v1 }, R, now) === 'current', 'signed this wording in June: current');
  ok(F.formStateOf({ ...consent, title: 'Consent (new)' }, { signedAt: '2026-06-01T00:00:00Z', version: v1 }, R, now) === 'changed', 'the wording changed since: sign again');
  ok(F.formStateOf(consent, { signedAt: '2025-10-15T00:00:00Z', version: v1 }, R, now) === 'expired' && F.formStateOf(consent, { signedAt: '2025-11-05T00:00:00Z', version: v1 }, R, now) === 'current', 'past 12 months: sign again (a few days short of a year still counts)');
  ok(F.formStateOf(consent, { signedAt: '2023-01-01T00:00:00Z', version: v1 }, { ...R, lastsMonths: 0 }, now) === 'current', '"until its wording changes": no time limit');
  ok(F.formStateOf({ ...consent, requiresEveryAppointment: true }, { signedAt: '2026-10-01T00:00:00Z', version: v1 }, R, now) === 'every' && F.formStateOf(null, { signedAt: '2026-10-01T00:00:00Z', everyVisit: true }, R, now) === 'every', 'a form signed at every visit always asks again');
  ok(F.formStateOf({ ...consent, title: 'Other words' }, { signedAt: '2026-06-01T00:00:00Z' }, R, now) === 'current', 'signed before versions existed: not asked again just because versions began');
  ok(F.formStateOf(consent, { signedAt: '2024-01-01T00:00:00Z' }, R, now) === 'current' && F.formStateOf(consent, { signedAt: '2024-01-01T00:00:00Z' }, R, new Date('2027-12-01T00:00:00Z')) === 'expired', 'signed under the old rules: counted from when this rule began, so nobody is held up the day it starts (and asked again a year on)');
  ok(F.formStateOf(consent, { version: v1 }, R, now) === 'expired' && F.formStateOf(consent, { signedAt: 'not a date', version: v1 }, R, now) === 'expired', 'a date that can’t be read is never taken as current');
  ok(F.formStateOf(consent, { signedAt: { seconds: Date.parse('2026-06-01T00:00:00Z') / 1000 }, version: v1 }, R, now) === 'current' && F.formStateOf(consent, { signedAt: { toDate: () => new Date('2025-01-01T00:00:00Z') }, version: v1 }, R, now) === 'expired', 'stored timestamps are read, whatever their shape');
  ok(F.onFileEntry({ 'signedForms.f1': { signedAt: '2026-05-01T00:00:00Z', source: 'walkin-kiosk' } }, 'f1')?.source === 'walkin-kiosk', 'signatures the kiosk saved under a dotted name are found again');
  const minorForm = { ...consent, requiresGuardianSignature: true };
  ok(F.formStateOf(minorForm, { signedAt: '2026-06-01T00:00:00Z', version: F.formVersion(minorForm) }, R, now) === 'none' && F.formStateOf(minorForm, { signedAt: '2026-06-01T00:00:00Z', version: F.formVersion(minorForm), guardian: true }, R, now) === 'current', 'a form that needs a guardian isn’t on file without one');
  ok(F.formStateOf({ ...consent, versionedAt: '2026-12-01T00:00:00Z' }, { signedAt: '2026-06-01T00:00:00Z' }, R, new Date('2027-01-05T00:00:00Z')) === 'changed', 'signed before versions began, then the wording changed: sign the new wording');
  ok(F.formStateOf(consent, { signedAt: '2026-06-01T00:00:00Z', version: v1, everyVisit: true }, R, now) === 'current' && F.formStateOf(null, { signedAt: '2026-06-01T00:00:00Z', everyVisit: true }, R, now) === 'every', 'the form as it is now decides "every visit"; the stored flag only counts without it');
  ok(F.onFileEntry({ signedForms: { f1: { _seconds: 1700000000 } } }, 'f1')?.signedAt?._seconds === 1700000000 && F.onFileEntry({ signedForms: { f1: { signedAt: '2026-01-01T00:00:00Z' } }, 'signedForms.f1': { signedAt: '2026-05-01T00:00:00Z' } }, 'f1')?.signedAt === '2026-05-01T00:00:00Z', 'a bare timestamp is read as a date; the newer of two copies counts');
  const big = Array.from({ length: 5 }, (_, i) => ({ formId: `f${i}`, formData: { s: 'x'.repeat(150_000) } }));
  const fit = F.fitOnVisit(big, 1);
  ok(JSON.stringify(fit.list).length < 500_000 && fit.list[4].formData.s.length === 150_000 && fit.list[0].answersMoved === true && fit.list[0].formId === 'f0' && fit.moved.length === 4 && fit.moved[0].formData.s.length === 150_000, 'a visit’s forms stay within one record: older answers move beside it, whole; names and dates stay');
  ok(F.formRulesOf({ formRules: { lastsMonths: 18, health: 'every', guardian: false } }).lastsMonths === 18 && F.formRulesOf({ formRules: { lastsMonths: 7 } }).lastsMonths === 12 && F.formRulesOf({}).health === 'changed', 'the business’s choices, within the offered ones');

  // ── what a visit still needs
  const health = { id: 'h1', title: 'Health and allergy questions', category: 'Intake', fields: [{ id: 'q', type: 'checkboxes', label: 'Do any of these apply?', options: ['Diabetes', 'None'] }] };
  const client = { signedForms: { h1: { signedAt: '2026-03-12T00:00:00Z', version: F.formVersion(health) }, f1: { signedAt: '2026-03-12T00:00:00Z', version: v1 } } };
  const svc = { requiredFormIds: ['h1', 'f1'] };
  ok(F.formsStillNeeded({ apt: {}, services: [svc], client, forms: [consent, health], now }).length === 0, 'both on file: nothing to sign');
  ok(F.formsStillNeeded({ apt: { extraFormIds: ['x9'] }, services: [svc], client, forms: [consent, health], now }).join() === 'x9', 'a form the team added to the visit is asked for too');
  ok(F.formsStillNeeded({ apt: { signedForms: [{ formId: 'x9' }], extraFormIds: ['x9'] }, services: [svc], client, forms: [consent, health], now }).length === 0, 'signed for this visit: done');
  ok(F.formStateOf(health, { signedAt: '2026-06-01T00:00:00Z', version: F.formVersion(health) }, { ...R, health: 'every' }, now) === 'every', 'health questions asked in full: never on file, on every screen');
  ok(F.formsStillNeeded({ apt: {}, services: [svc], client, forms: [consent, health], now, rules: { ...R, health: 'every' } }).join() === 'h1', 'health questions asked in full at every visit, when the business says so');
  const asks = F.formAsks({ apt: {}, services: [svc], client, forms: [consent, health], now });
  ok(asks.find((a) => a.formId === 'h1')?.ask === 'confirm' && asks.find((a) => a.formId === 'f1')?.ask === 'done' && /still current/.test(asks.find((a) => a.formId === 'f1')!.why), 'health questions on file: "anything changed?"; a consent on file: done, still current', asks);
  ok(F.formAsks({ apt: { healthConfirmed: ['h1'] }, services: [svc], client, forms: [consent, health], now }).find((a) => a.formId === 'h1')?.ask === 'done', 'confirmed nothing changed for this visit: done');
  ok(F.formAsks({ apt: {}, services: [svc], client: {}, forms: [consent, health], now }).every((a) => a.ask === 'sign') && F.formAsks({ apt: {}, services: [svc], client, forms: [{ ...consent, title: 'New words' }, health], now, rules: { ...R, health: 'every' } }).map((a) => a.ask).join() === 'sign,sign_again', 'a first visit signs everything; new wording signs again; "every time" health forms ask in full');
  const idReq = { id: 'photo_id', label: 'Photo ID', persistToProfile: true };
  ok(F.filesStillNeeded({ requiredFileRequirements: [idReq, { id: 'inspo', label: 'Inspiration' }] }, { profileDocuments: [{ requirementId: 'photo_id', files: ['https://x/id.jpg'] }] }).map((r) => r.id).join() === 'inspo'
    && F.filesStillNeeded({ requiredFileRequirements: [idReq] }, { profileDocuments: [{ requirementId: 'photo_id', files: [] }] }).length === 1, 'photo ID on file isn’t asked again (an empty entry doesn’t count)');
  const merged = F.mergeProfileDocuments([{ requirementId: 'photo_id', files: ['a'] }, { requirementId: 'license', files: ['b'] }], [{ requirementId: 'photo_id', files: ['c'] }]);
  ok(merged.length === 2 && merged.find((d) => d.requirementId === 'license')?.files[0] === 'b' && merged.find((d) => d.requirementId === 'photo_id')?.files[0] === 'c', 'a new upload replaces its own document and keeps the others');

  // ── one place a signed form is saved
  const db: any = makeDb();
  await db.doc('tenants/t1/consentForms/f1').set(consent);
  await db.doc('tenants/t1/consentForms/h1').set({ ...health, requiresEveryAppointment: false });
  await db.doc('tenants/t1/clients/c1').set({ name: 'Dana Reyes', signedForms: { old: { signedAt: '2026-01-01T00:00:00Z' } } });
  const out = await FS.recordSignedForms(db, 't1', { clientId: 'c1', appointmentId: 'a1', source: 'online_booking', at: '2026-11-02T12:00:00.000Z', forms: [{ formId: 'f1', formData: { s: 'data:image/png;base64,AAA' }, guardian: { name: 'Ana Reyes', relationship: 'Mother' } }] });
  const c1 = (await db.doc('tenants/t1/clients/c1').get()).data();
  ok(c1.signedForms.old && c1.signedForms.f1?.version === v1 && c1.signedForms.f1?.appointmentId === 'a1' && c1.signedForms.f1?.formTitle === 'Consent and release' && out.f1?.guardian === true, 'on the client record with the version signed, keeping the forms already there');
  const sc = (await db.doc('tenants/t1/clients/c1/signedConsents/f1').get()).data();
  ok(sc.version === v1 && sc.guardianName === 'Ana Reyes' && sc.formData.s.startsWith('data:image'), 'the latest signed copy, with the guardian');
  await db.doc('tenants/t1/consentForms/f1').set({ ...consent, title: 'Consent and release (2027)' });
  await FS.recordSignedForms(db, 't1', { clientId: 'c1', appointmentId: 'a2', source: 'client_self_service', forms: [{ formId: 'f1', formData: { s: 'data:image/png;base64,BBB' } }] });
  const hist = (await db.collection('tenants/t1/clients/c1/formHistory').get()).docs.map((d: any) => d.data());
  ok(hist.length === 2 && hist[0].version === v1 && hist[1].version !== v1 && hist[0].wording?.title === 'Consent and release' && hist[1].wording?.title === 'Consent and release (2027)', 'each signing kept for good, with the words they read');
  await db.doc('tenants/t1/consentForms/e1').set({ id: 'e1', title: 'Every visit', requiresEveryAppointment: true, fields: [] });
  await FS.recordSignedForms(db, 't1', { clientId: 'c1', appointmentId: 'a3', source: 'x', forms: [{ formId: 'e1' }] });
  await db.doc('tenants/t1/consentForms/e1').set({ id: 'e1', title: 'Every visit', requiresEveryAppointment: false, fields: [] });
  await FS.recordSignedForms(db, 't1', { clientId: 'c1', appointmentId: 'a4', source: 'x', forms: [{ formId: 'e1' }] });
  await FS.recordSignedForms(db, 't1', { clientId: 'c1', appointmentId: 'a4', source: 'x', forms: [{ formId: 'e1' }] });
  const c1b = (await db.doc('tenants/t1/clients/c1').get()).data();
  ok(c1b.signedForms.e1.everyVisit === false && c1b.signedForms.e1.guardian === false, 'un-ticking "every visit" takes effect at the next signing (the flags are always written)');
  ok((await db.collection('tenants/t1/clients/c1/formHistory').get()).docs.filter((d: any) => d.id.startsWith('e1_')).length === 2, 'sending the same signing twice keeps one copy');
  ok((await FS.recordSignedForms(db, 't1', { clientId: null, forms: [{ formId: 'f1' }], source: 'x' })) && Object.keys(await FS.recordSignedForms(db, 't1', { clientId: null, forms: [{ formId: 'f1' }], source: 'x' })).length === 0, 'no client: nothing saved to a client');

  // ── every screen and every way in uses it
  const files = ['src/lib/booking/create-booking.ts', 'src/app/api/voice/create-booking/route.ts', 'src/app/api/voice/lookup-client/route.ts', 'src/app/api/walkins/route.ts'];
  ok(files.every((f) => !/FORM_(SIGNATURE_)?VALIDITY_MONTHS|monthsBetween\(signedAt/.test(src(f))) && files.every((f) => /formsStillNeeded|formStateOf/.test(src(f))), 'phone bookings, the voice lookup and the kiosk use the one rule (no 18-month copies left)');
  const walk = src('src/app/api/walkins/route.ts');
  ok(!/\[`signedForms\.\$\{f\.formId\}`\]/.test(walk) && /recordSignedForms\(db, tenantId, \{ clientId, appointmentId: null, source: 'walkin-kiosk'/.test(walk), 'the kiosk saves signatures to the client record (dotted keys were stored as literal field names)');
  const act = src('src/app/api/checkin/actions/route.ts');
  ok(/const skipCard = c\.skipCardStep === true;/.test(act) && !/b\.skipCardStep/.test(act), 'the visit link’s "done" never trusts the browser about the card step');
  ok(/mergeProfileDocuments\(had,/.test(act) && /recordSignedForms\(db, tenantId, \{ clientId, appointmentId: apptId, source: 'client_self_service'/.test(act), 'the visit link saves forms the one way, and adds documents without dropping others');
  ok(/askedIds\.has\(String\(f\?\.formId/.test(act) && /byId\(apptNow\.signedForms, 'formId', signedForms\)/.test(act) && /\.\.\.\(signedForms\.length \? \{ signedForms:/.test(act), 'the visit link adds to the forms already on the visit (never wipes those signed while booking), and only the forms it asked for');
  ok(/'declined', 'expired', 'released', 'cancelled', 'canceled', 'no_show'\]\.includes\(String\(apptNow\.status/.test(act) && /'declined', 'expired', 'released', 'cancelled', 'canceled', 'no_show'\]\.includes\(String\(apptNow\.status/.test(src('src/app/api/completion/submit/route.ts')), 'a declined, lapsed, released or canceled visit takes nothing more');
  ok(/skipCardStep && completion\?\.cardAlreadyOnFile === true/.test(src('src/components/visit/VisitGates.tsx')), '"your card is on file" only when it is');
  const sub = src('src/app/api/completion/submit/route.ts');
  ok(/recordSignedForms\(db, tenantId, \{ clientId: c\.clientId/.test(sub) && /completionStatus: 'completed'/.test(sub), 'the older completion page puts forms on file and marks the visit done');
  const book = src('src/app/api/appointments/book/route.ts');
  ok(/status: 413/.test(book) && /return JSON\.stringify\(clean\)\.length <= 600_000 \? clean : null;/.test(book), 'forms too large to keep are refused with a reason, never dropped quietly');
  ok(/recordSignedForms\(db, tenantId, \{ clientId: r\.clientId, appointmentId: r\.aptId, source: staffSet \? 'desk_booking' : 'online_booking', forms: keptForms \}\)/.test(book) && /\(staffSet \|\| \(r as any\)\.clientNew\)/.test(book) && /clientNew = true;/.test(book), 'forms signed while booking go on file only when the record is surely theirs (the team booked, or this booking made it)');
  ok(/const def = formsPre\.defs\.find\(\(d: any\) => d\.id === f\.formId\); return !!def && sentFormDone\(def, f, rules\)/.test(book) && /formsPre\.formIds = formsAskedFor\(\{\}/.test(book), 'only the forms the booking asks for, each finished (a form that needs a guardian, only with one who agreed)');
  ok(/expiresAt: r\.placedEndIso/.test(book) && /if \(askedItems && askedItems\.length && \(sendStatus\.emailSent \|\| sendStatus\.smsSent \|\| renterConfirmed\)\)/.test(book) && /known\.has\(id\)/.test(book), 'marked as asked only once the confirmation went out; a deleted form is never asked for');
  ok(/made\.clientNew && made\.forms\.length/.test(src('src/lib/connect-webhook.ts')) && /if \(!asked\.has\(id\)\) continue;/.test(src('src/lib/connect-webhook.ts')) && /requiresGuardianSignature\) continue;/.test(src('src/lib/connect-webhook.ts')), 'deposit-paid online bookings keep only the service’s forms, none needing a guardian');
  ok(/if \(!existing \|\| body\.__deskStaff === true\) await recordSignedForms/.test(walk) && /__deskStaff: deskStaff === true \}/.test(walk), 'the kiosk keeps a signature on file only for a client it made, or one the desk added');
  const vc = src('src/app/api/visit-completion/route.ts');
  ok(/const ENDED = \['declined', 'expired', 'released'/.test(vc) && (vc.match(/ENDED\.includes/g) || []).length === 2 && /stillAsked\(db, tenantId,/.test(vc), 'both links stop asking once a visit isn’t happening, and drop forms signed since the request was made');
  ok(/Please complete and sign every form before sending\./.test(act) && /askedFiles\.has\(String\(x\?\.requirementId/.test(act) && /fitOnVisit\(\[\.\.\.out, \.\.\.add\], add\.length\)/.test(act) && /answersPath\(tenantId, apptId, String\(m\.formId\)\)/.test(act), 'a partial answer stays open; only the files asked for; the visit record never outgrows itself, and moved answers are kept');
  ok(/ids: ids\.filter\(\(id\) => defs\.some/.test(act) && /catch \{ return \[\] as string\[\]; \}/.test(act) && /ids: ids\.filter\(\(id\) => forms\.some/.test(src('src/app/api/visit-completion/route.ts')) && /const live = ids\.filter\(\(id\) => !!fc\.get\(id\)\);/.test(src('src/app/api/cron/check-automations/route.ts')), 'a deleted form is never required, reminded or held over; a slow moment never refuses a client who signed');
  ok(/asideForms\.length \? \{ formsSetAside: asideForms \}/.test(book) && /label: String\(fr\.label \|\| 'A document'\)/.test(book), 'a form sent unfinished (or without the guardian it needs) is kept aside and asked for on the visit link');
  ok(/made\.clientNew && made\.forms\.length/.test(src('src/lib/connect-webhook.ts')), 'an online booking paid by deposit puts its forms on file the same way');
  ok(/formStateOf\(form, entry, rules\) !== 'current'/.test(walk) && /sc\?\.revokedAt/.test(walk), 'arriving at the kiosk uses the one rule');
  ok(['src/components/clients/ClientsList.tsx', 'src/components/clients/ClientProfileParts.tsx', 'src/components/clients/ClientSnapshot.tsx'].every((f) => /formsToSign\(/.test(src(f))) && /export function formsToSign[\s\S]{0,400}pendingFormIds\(/.test(src('src/lib/visit-requests.ts')) && /formStateOf\(consentForms\.find/.test(src('src/components/clients/ClientTabs.tsx')), 'the client list and profile use the one rule (a form on file is no longer "due")');
  const st = src('src/app/(app)/settings/page.tsx');
  const fset = fs.readFileSync('src/components/settings/FormsSettings.tsx', 'utf8');
  ok(/label="Signed forms"[\s\S]{0,300}href="\/settings\/forms"/.test(st) && /Until its wording changes, or \$\{m\} months/.test(fset) && /Ask “anything changed\?” each booking/.test(fset) && /Ask them in full each booking/.test(fset), 'owners choose how long a signed form lasts, and how health questions are asked (Settings › Forms and documents)');
  ok(/bookingCompletions\/\$\{r\.token\}/.test(book) && /filesStillNeeded\(x, formsCtx!\.cDoc\)/.test(book) && /skipCardStep: true/.test(book), 'photo ID (or a form not asked while booking) is asked for on the visit link');
  ok(/formStateOf\(\(consentForms \|\| \[\]\)\.find/.test(src('src/components/planner/AppointmentDetailsSheet.tsx')), 'the visit sheet uses the one rule');
  ok(/formsStillNeeded\(\{ apt, ids: live, client, forms:/.test(src('src/app/api/cron/check-automations/route.ts')), 'automations never remind, hold or cancel over a form already on file');
  ok(/return formsStillNeeded\(\{ apt, services: \[service\], client, forms, rules: formRulesOf\(tenant\) \}\);/.test(src('src/lib/visit-requests.ts')) && /formsStillNeeded\(\{ apt: a, services: svcs, client, forms/.test(src('src/lib/here-now.ts')), 'readiness, cards and the desk’s here-now list use it');
  ok(!/completionStatus !== 'completed'/.test(src('src/components/pos/desk/DeskPOS.tsx') + src('src/components/pos/desk/DeskCheckIn.tsx') + src('src/app/api/cron/reminders/route.ts')), 'both spellings of "done" count as done');
  const iu = src('src/components/shared/ImageUpload.tsx');
  ok(/useTenantOptional\(\)\?\.selectedTenant/.test(iu) && !/useTenant\(\)/.test(iu) && /Math\.max\(maxSizeMB, 20\)/.test(iu) && /That photo is too large/.test(iu), 'a photo question on a public page doesn’t crash; phone photos are made smaller, not refused');
  const toast = src('src/components/ui/toast.tsx');
  ok(!/bg-destructive|uppercase|font-black/.test(toast) && /text-\[#b45309\]/.test(toast) && /h-11 w-11/.test(toast), 'error messages are amber words on white, never red; no all-caps; 44px close');
  const cons = src('src/app/(app)/consents/page.tsx');
  const fb = fs.readFileSync('src/components/consents/FormBuilder.tsx', 'utf8');
  ok(/version: formVersion\(patch\)/.test(fb) && /const version = formVersion\(\{ \.\.\.target, \.\.\.patch \}\); const changed = /.test(fb) && /Clients who signed “\$\{out\.title\}” before sign the new wording at their next booking\./.test(fb) && !/Protocol|matrix|manifest/.test(fb), 'saving a form stamps its version and says plainly what happens to clients who signed (the form builder)');

  console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
