// scripts/verify/forms-photos.verify.tsx — PHOTOS AND KEPT ANSWERS (B6d-3, board FormsStaff). A photo answering a form's
// question is kept private (only the team opens it, five minutes at a time). Answers a long visit record moved beside
// the visit open on the appointment by the same rule (health answers only for people who may see health notes). "Ask
// for different photos" texts the client their visit link with the team's note; the visit link takes new photos with
// the booking photo tool, and the person doing the visit hears. What happens if forms aren't done is said to the client
// as the service has it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/forms-photos.verify.tsx
import Module from 'module';
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeDb, FV } from './fake-db';

(globalThis as any).React = React;
let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const db: any = makeDb(); const sent: any[] = []; const audit: any[] = []; const saved: any[] = [];
let actorNow: any = { name: 'Kai Park', uid: 'u1', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: actorNow }) };
  if (request === '@/lib/audit' || request === './audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_d: any, _t: string, e: any) => { audit.push(e); } });
  if (request === 'firebase-admin/firestore') return { FieldValue: FV };
  if (request === './notify' || request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_d: any, x: any) => { sent.push(x); return { ok: true }; } });
  if (request === '@/lib/private-storage' || /\/src\/lib\/private-storage(\.ts)?$/.test(request)) return fake(request, { savePrivateImage: async (t: string, path: string) => { saved.push(path); return { ref: `/api/files/view?t=${t}&p=${encodeURIComponent(path)}`, path }; } });
  if (request === '@/lib/claim-photo-upload') return { uploadClaimPhotoFromDataUrl: async () => ({ url: 'https://store.test/public.jpg' }) };
  if (request === '@/lib/client-verify' || /\/src\/lib\/client-verify(\.ts)?$/.test(request)) return fake(request, { visitLinkOpen: async () => 'ok' });
  return load.call(this, request, ...rest);
};
const req = (body: any) => ({ json: async () => body, headers: new Headers(), nextUrl: { origin: 'https://opal.test', searchParams: new URLSearchParams() } } as any);

(async () => {
  const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Opal Manicure Studio', timezone: 'America/Chicago', publicOrigin: 'https://opal.test', roles: {}, storageBucket: 'opal-test.appspot.com' });
  const fb = (n: string, t = 't1', bucket = 'opal-test.appspot.com') => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(`tenants/${t}/booking-inspiration/2026-11-07/1762500000000-ab12cd.${n}`)}?alt=media&token=tok-${n}`;

  // ── a form's photo, kept private
  const P = await import('../../src/app/api/booking/photo/route');
  const pic = 'data:image/jpeg;base64,' + Buffer.alloc(4000, 7).toString('base64');
  const r1: any = await (await P.POST(req({ tenantId: 't1', dataUrl: pic, private: true }))).json();
  ok(r1.ok && r1.private && /^\/api\/files\/view\?t=t1&p=tenants%2Ft1%2Fcompletions%2Fform-photos%2F/.test(r1.url) && /^tenants\/t1\/completions\/form-photos\/\d{4}-\d{2}-\d{2}\/\w+\.jpg$/.test(saved[0]), 'a form’s photo is kept private, where only the team can open it', r1);
  const r2: any = await (await P.POST(req({ tenantId: 't1', dataUrl: pic }))).json();
  ok(r2.ok && r2.url === 'https://store.test/public.jpg' && saved.length === 1, 'inspiration photos go where they always have');
  const FR = src('src/components/booking/FormRunner.tsx');
  ok(/JSON\.stringify\(\{ tenantId, dataUrl, private: true \}\)/.test(FR) && /Photo added\. Only the team can see it\./.test(FR) && /setShown\(dataUrl\)/.test(FR), 'the form sends its photo private, and shows the phone’s own copy (or “Photo added”)');

  // ── answers kept beside the visit
  const health = { id: 'h1', title: 'Health and allergy questions', category: 'Intake', fields: [{ id: 'q1', type: 'short-text', label: 'Anything?' }] };
  const consent = { id: 'c1', title: 'Consent and release', category: 'Waiver', fields: [{ id: 's', type: 'signature', label: 'Signature' }] };
  await db.doc(`${T}/consentForms/h1`).set(health); await db.doc(`${T}/consentForms/c1`).set(consent);
  await db.doc(`${T}/services/s1`).set({ name: 'Gel manicure', requiredFormIds: ['h1', 'c1'] });
  const start = new Date(Date.now() + 3 * 864e5).toISOString();
  await db.doc(`${T}/appointments/a1`).set({ serviceId: 's1', serviceName: 'Gel manicure', clientId: 'cl1', clientName: 'Dana Reyes', clientPhone: '5125550148', staffId: 'p1', status: 'confirmed', startTime: start, checkInToken: 'tokA1234',
    signedForms: [{ formId: 'h1', formData: {}, answersMoved: true, signedAt: '2026-11-01T15:00:00Z' }], inspirationPhotos: [{ url: fb('jpg'), note: 'This shape' }] });
  await db.doc(`${T}/appointments/a1/formAnswers/h1`).set({ formId: 'h1', formData: { q1: 'Latex allergy' }, signedName: 'Dana Reyes', signedAt: '2026-11-01T15:00:00Z', via: 'visit_link' });
  await db.doc(`${T}/clients/cl1`).set({ name: 'Dana Reyes', phone: '5125550148' });
  const R = await import('../../src/app/api/forms/visit/route');
  const post = async (body: any) => { const res: any = await R.POST(req({ tenantId: 't1', apptId: 'a1', ...body })); return { status: res.status, body: await res.json() }; };
  const got = await post({ action: 'answers', formId: 'h1' });
  ok(got.body.ok && got.body.record?.formData?.q1 === 'Latex allergy' && got.body.record.signedName === 'Dana Reyes' && audit.some((e) => e.action === 'forms.answers_opened'), 'answers kept beside the visit open on the appointment (and the opening is noted)', got);
  actorNow = { name: 'Lee Tran', uid: 'u9', role: 'staff', isManager: false, caps: [] };
  ok((await post({ action: 'answers', formId: 'h1' })).status === 403, '…health answers only for people who may see health notes');
  actorNow = { name: 'Kai Park', uid: 'u1', role: 'manager', isManager: true, caps: [] };
  ok((await post({ action: 'answers', formId: 'zz' })).status === 400 && (await post({ action: 'answers', formId: 'c1' })).status === 404, '…only a form of this visit, and only answers that are there');
  const BV = src('src/components/planner/BeforeVisit.tsx');
  ok(/post\(\{ action: 'answers', formId \}\)/.test(BV) && /Opening the answers…/.test(BV), 'the appointment reads them when opened');

  // ── ask for different photos
  await db.doc(`${T}/appointments/a1`).set({ clientPhone: '' }, { merge: true }); await db.doc(`${T}/clients/cl1`).set({ name: 'Dana Reyes', phone: '' });
  const a0 = await post({ action: 'photos_again', note: 'A closer photo' });
  ok(a0.status === 409 && /no phone number or email for Dana/.test(a0.body.error) && !db._store.get(`${T}/appointments/a1`).inspoReview, 'a message that can’t go out changes nothing, and says why', a0);
  await db.doc(`${T}/appointments/a1`).set({ clientPhone: '5125550148' }, { merge: true }); await db.doc(`${T}/clients/cl1`).set({ name: 'Dana Reyes', phone: '5125550148' });
  const a1 = await post({ action: 'photos_again', note: 'A closer photo of the shape' });
  const ap = db._store.get(`${T}/appointments/a1`);
  const sms = sent.find((x) => x.kind === 'photos_again' && x.channel === 'sms');
  ok(a1.body.ok && ap.inspoReview.status === 'again' && ap.inspoReview.note === 'A closer photo of the shape' && ap.inspoReview.by === 'Kai Park', 'asked, with the note and who asked', a1);
  ok(sms && /^Opal Manicure Studio: Hi Dana, Kai would like a different inspiration photo for your gel manicure on \w{3} at \d{1,2}:\d{2} [AP]M: “A closer photo of the shape”\. You can add one here: https:\/\/opal\.test\/check-in\/tokA1234$/.test(sms.text), 'the client gets the visit link with the note', sms);
  ok((await post({ action: 'photos_again', note: 'x' })).status === 429, 'not twice within the hour');
  ok((await post({ action: 'photos_ok' })).status === 409 && db._store.get(`${T}/appointments/a1`).inspoReview.status === 'again', '“Looks good” on a stale screen never cancels an ask');
  actorNow = { name: 'Lee Tran', uid: 'u9', role: 'staff', isManager: false, caps: [] };
  ok((await post({ action: 'photos_again' })).status === 403, 'someone else’s visit: for its provider or a manager');
  actorNow = { name: 'Kai Park', uid: 'u1', role: 'manager', isManager: true, caps: [] };

  // ── the client sends new ones from the visit link
  await db.doc('appointmentCheckIns/tokA1234').set({ tenantId: 't1', id: 'a1' });
  const C = await import('../../src/app/api/checkin/actions/route');
  const cpost = async (body: any) => { const res: any = await C.POST(req({ token: 'tokA1234', ...body })); return { status: res.status, body: await res.json() }; };
  ok((await cpost({ action: 'photos', photos: [{ url: 'javascript:alert(1)' }] })).status === 400, 'only real photo links');
  ok((await cpost({ action: 'photos', photos: [{ url: 'https://elsewhere.example/2.jpg' }] })).status === 400
    && (await cpost({ action: 'photos', photos: [{ url: fb('jpg', 't2') }] })).status === 400
    && (await cpost({ action: 'photos', photos: [{ url: fb('jpg', 't1', 'someone-else.appspot.com') }] })).status === 400
    && (await cpost({ action: 'photos', photos: [{ url: 'https://elsewhere.example/api/booking/photo?t=t1&id=abcdefghijklmnop123' }] })).status === 400
    && (await cpost({ action: 'photos', photos: [{ url: fb('jpg') + 'x'.repeat(1000) }] })).status === 400, '…only this business’s own uploads: not another site, business or bucket, and never cut short');
  await db.doc(`${T}/bookingPhotos/abcdefghijklmnop123`).set({ id: 'abcdefghijklmnop123', dataUrl: 'data:image/jpeg;base64,AAAA' });
  const s1 = await cpost({ action: 'photos', photos: [{ url: fb('png'), note: 'Like this, shorter' }, { url: 'https://other-host.example/api/booking/photo?t=t1&id=abcdefghijklmnop123' }, { url: fb('png') }] });
  const ap2 = db._store.get(`${T}/appointments/a1`);
  const notes = [...db._store.entries()].filter(([k]: any) => k.startsWith(`${T}/notifications/`)).map(([, v]: any) => v).filter((n) => n.type === 'photos_sent');
  ok(s1.body.ok && ap2.inspirationPhotos.length === 2 && ap2.inspirationPhotos[0].url === fb('png') && ap2.inspirationPhotos[1].url === '/api/booking/photo?t=t1&id=abcdefghijklmnop123' && ap2.inspirationPhotosEarlier[0].url === fb('jpg') && ap2.inspoReview.status === 'sent' && ap2.inspoReview.note === 'A closer photo of the shape', 'new photos on the visit (a database copy kept as a link on this app), the earlier ones kept', { s1, ap2 });
  ok(notes.map((n) => n.userId).sort().join() === 'p1,u1' && notes.every((n) => n.link === '/planner?visit=a1'), 'the provider and whoever asked hear about it');
  ok((await cpost({ action: 'photos', photos: [{ url: fb('webp') }] })).status === 409, 'only when the team asked');
  // A second round keeps every earlier photo.
  await db.doc(`${T}/appointments/a1`).set({ inspoReview: { status: 'again', note: 'One more', by: 'Kai Park', byUid: 'u1', at: new Date().toISOString() } }, { merge: true });
  await cpost({ action: 'photos', photos: [{ url: fb('webp') }] });
  const ap3 = db._store.get(`${T}/appointments/a1`);
  ok(ap3.inspirationPhotosEarlier.map((p: any) => p.url).join() === [fb('png'), '/api/booking/photo?t=t1&id=abcdefghijklmnop123', fb('jpg')].join(), 'every earlier photo is kept, newest first', ap3.inspirationPhotosEarlier);
  // Not once the visit has started, or the link is off.
  await db.doc(`${T}/appointments/a1`).set({ inspoReview: { status: 'again', at: new Date().toISOString() }, startTime: new Date(Date.now() - 60e3).toISOString() }, { merge: true });
  ok((await cpost({ action: 'photos', photos: [{ url: fb('jpg') }] })).status === 409, 'not once the visit has started');
  await db.doc(`${T}/appointments/a1`).set({ startTime: start, status: 'cancelled' }, { merge: true });
  ok((await cpost({ action: 'photos', photos: [{ url: fb('jpg') }] })).status === 409, 'not for a visit that isn’t going ahead');
  await db.doc(`${T}/appointments/a1`).set({ status: 'confirmed', inspoReview: { status: 'sent' } }, { merge: true });
  const VV = src('src/app/api/visit-view/route.ts'), page = src('src/app/check-in/[token]/page.tsx');
  ok(/const photosAsk = photosAskOpen\(a\)/.test(VV) && /photosAsk \};/.test(VV) && /<PhotosAskCard ask=\{photosAsk\}/.test(page) && /\{formsCard\}\{photosCard\}/.test(page), 'the visit link shows the ask until they send');
  const PA = await import('../../src/components/visit/PhotosAskCard');
  const card = renderToStaticMarkup(<PA.PhotosAskCard ask={{ note: 'A closer photo of the shape', by: 'Kai' }} token="tokA1234" tenantId="t1" accent="#8b5e57" onSent={() => {}} />);
  ok(/Kai asked for a different inspiration photo/.test(card) && /“A closer photo of the shape”/.test(card) && /disabled=""[^>]*>Send the photo/.test(card), 'who asked, their note, the photo tool, and Send', card.slice(0, 300));

  // ── the appointment
  const B = await import('../../src/components/planner/BeforeVisit');
  const show = (inspoReview: any) => renderToStaticMarkup(<B.BeforeVisit tenantId="t1" tenant={{ timezone: 'America/Chicago' }} appointment={{ id: 'a1', startTime: start, clientName: 'Dana Reyes', inspirationPhotos: [{ url: 'https://store.test/2.jpg' }], inspoReview }} client={{ id: 'cl1' }} services={[{ id: 's1' }]} forms={[]} formsLoading={false} signedConsents={[]} />);
  ok(/Kai asked for different ones: “A closer one”/.test(show({ status: 'again', by: 'Kai Park', note: 'A closer one' })) && !/Ask for different photos|Ask again/.test(show({ status: 'again', by: 'Kai Park', at: new Date().toISOString() })), 'asked: says so, and waits');
  ok(/>Ask again</.test(show({ status: 'again', by: 'Kai Park', at: new Date(Date.now() - 2 * 3600e3).toISOString() })), '…and after an hour with nothing, they can be asked again');
  const BVs = src('src/components/planner/BeforeVisit.tsx');
  ok(/if \(visitNow\.current !== forVisit\) return;/.test(BVs) && /logged\.current\.has\(formId\)\) \{ logged\.current\.add\(formId\); logHealthOpen/.test(BVs) && />Try again</.test(BVs), 'kept answers: only for the visit they were read for, the health log kept, and a way to try again');
  ok(/new ones, waiting for you/.test(show({ status: 'sent' })) && />Looks good</.test(show({ status: 'sent' })) && />Ask for different photos</.test(show(null)), 'new ones: look, or ask again');

  const IP = await import('../../src/lib/inspo-photos');
  const later = { seconds: Math.floor(Date.now() / 1000) + 3600 };
  ok(IP.photosAskOpen({ inspoReview: { status: 'again' }, startTime: later, status: 'confirmed' }) && !IP.photosAskOpen({ inspoReview: { status: 'again' }, startTime: later, linkRevokedAt: 'x' }), 'the ask is open for a visit whose time is kept either way, and never once the link is off');
  // ── what clients read about forms not done: only when it would really happen
  const FRl = await import('../../src/lib/forms-release');
  const svcR = { requiredFormIds: ['h1'], formsRule: { due: 24, release: 'auto' } };
  const visitR = (h: number, bookedAgo = 72, extra: any = {}) => ({ status: 'confirmed', startTime: new Date(Date.now() + h * 3600e3).toISOString(), createdAt: new Date(Date.now() - bookedAgo * 3600e3).toISOString(), ...extra });
  const out = (o: any) => FRl.releaseOutlook({ service: svcR, appt: visitR(72), formsLeft: ['h1'], pending: true, ...o });
  ok(out({}) === 'auto' && out({ formsLeft: ['addon'] }) === 'off' && out({ pending: false }) === 'off' && out({ appt: visitR(72, 72, { status: 'checked_in' }) }) === 'off'
    && out({ appt: visitR(10, 1) }) === 'off' && out({ appt: visitR(20, 1) }) === 'off' && out({ appt: visitR(30, 1) }) === 'auto' && out({ service: { ...svcR, formsRule: { due: 24, release: 'ask' } } }) === 'ask'
    && out({ appt: visitR(30, 72), now: Date.now() + 29 * 3600e3 }) === 'off' && out({ rec: { formsReleaseAt: 'x', formsReleaseStart: 'an earlier time' } }) === 'auto' && ((ap) => out({ appt: ap, rec: { formsReleaseAt: 'x', formsReleaseStart: ap.startTime } }))(visitR(72)) === 'off', 'said only for the service’s own forms, a live visit with its request open, and a time it can still act', [out({}), out({ appt: visitR(10, 1) })]);
  const VF = src('src/components/visit/VisitForms.tsx'), FRM = src('src/lib/forms-remind.ts');
  ok(/visit\.release === 'auto' && visit\.asks\.some\(todo\) \? `If your forms aren’t done by \$\{when\(due, brand, true\)\}, your appointment time is released\.`/.test(VF) && /state\.release === 'auto' \? 'If your forms aren’t done by then, your appointment time is released\.'/.test(FRM) && /release: v\.release/.test(src('src/app/api/visit-completion/route.ts')), 'the visit link and the reminder say what the service does if forms aren’t done');
  const all = ['src/components/visit/PhotosAskCard.tsx', 'src/app/api/forms/visit/route.ts', 'src/lib/forms-remind.ts', 'src/components/planner/BeforeVisit.tsx', 'src/app/api/checkin/actions/route.ts', 'src/app/api/visit-view/route.ts', 'src/components/booking/FormRunner.tsx', 'src/lib/inspo-photos.ts', 'src/lib/forms-release.ts'].map(src).join('\n');
  const tools = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  ok(!tools.test(all) && !/call us|contact us/i.test(all) && !/\{\/\*/.test(all) && !/uppercase|tracking-widest/.test(all), 'house rules');
  console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
