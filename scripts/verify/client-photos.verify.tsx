// scripts/verify/client-photos.verify.tsx — THE CLIENT'S PHOTOS AND A PHOTO'S RECORD (B7d-1, board 18D). Every photo of
// a client, by visit, newest first, each saying what it is and where it came from; opening a record is noted; a photo
// the client sent can be removed for good by a manager, with the team's marks and every copy kept here.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/client-photos.verify.tsx
import Module from 'module';
import fs from 'fs';
import { makeDb, FV } from './fake-db';
import * as CP from '../../src/lib/client-photos';
import { photoKey } from '../../src/lib/markup/team';

let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const db: any = makeDb(); const audit: any[] = []; const deleted: string[] = [];
let actorNow: any = { name: 'Kai Park', uid: 'm1', role: 'manager', isManager: true, caps: [] };
const ML: any = Module as any; const load = ML._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = ML._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const failOn = new Set<string>();
const bucket = (name: string) => ({ file: (p: string) => ({ delete: async () => { if (failOn.has(p)) throw new Error('storage is busy'); deleted.push(`${name}:${p}`); } }) });
ML._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin' || request === './firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminApp: () => ({ options: {} }) });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: actorNow }) };
  if (request === '@/lib/audit' || request === './audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_d: any, _t: string, e: any) => { audit.push(e); } });
  if (request === 'firebase-admin/firestore') return { FieldValue: FV };
  if (request === './private-storage' || request === '@/lib/private-storage' || /\/src\/lib\/private-storage(\.ts)?$/.test(request)) return fake(request, { privateBucket: async () => bucket('private'), namedBucket: async (n: string) => bucket(n) });
  return load.call(this, request, ...rest);
};
const req = (body: any) => ({ json: async () => body, headers: new Headers(), nextUrl: { origin: 'https://opal.test', searchParams: new URLSearchParams() } } as any);

(async () => {
  // ── the photos, by visit
  const BK = 'opal-test.appspot.com';
  const fb = (n: string, folder = 'booking-inspiration/2026-11-07/1762500000000-ab12cd') => `https://firebasestorage.googleapis.com/v0/b/${BK}/o/${encodeURIComponent(`tenants/t1/${folder}${n}.jpg`)}?alt=media&token=t${n}`;
  const orig = `/api/files/view?t=t1&p=${encodeURIComponent('tenants/t1/completions/inspiration-originals/2026-11-07/abcdefgh12.jpg')}`;
  const visits = [
    { id: 'a1', clientId: 'c1', serviceId: 's1', staffId: 'p1', status: 'confirmed', startTime: '2026-10-31T20:30:00.000Z', createdAt: '2026-10-24T15:00:00.000Z',
      inspirationPhotos: [{ url: fb('1'), note: 'This shape', original: orig, markup: '{"v":1}' }, { url: fb('2'), note: '' }], nowPhoto: { url: fb('n') }, inspirationPhotosEarlier: [{ url: fb('e'), note: 'old' }], inspoReview: { status: 'sent', sentAt: '2026-10-28T10:00:00.000Z' } },
    { id: 'a0', clientId: 'c1', serviceName: 'Builder gel fill', staffId: 'p1', status: 'completed', startTime: '2026-09-19T18:00:00.000Z', afterPhotoUrls: [fb('a', 'visit-photos/a0/1762500000000-x'), fb('a', 'visit-photos/a0/1762500000000-x')] },
    { id: 'a2', clientId: 'c1', status: 'confirmed', startTime: '2026-12-01T18:00:00.000Z' },
  ];
  const r = CP.clientPhotos({ client: { importedFiles: [{ kind: 'photo', url: 'https://old.test/x.jpg', importedFrom: 'Vagaro' }, { kind: 'doc', url: 'https://old.test/f.pdf' }] }, appointments: visits, services: [{ id: 's1', name: 'Gel manicure' }], staff: [{ id: 'p1', name: 'Mia Lopez' }] });
  ok(r.visits.map((v) => v.apptId).join() === 'a1,a0' && r.visits[0].service === 'Gel manicure' && r.visits[0].provider === 'Mia' && r.visits[1].service === 'Builder gel fill', 'by visit, newest first, with the service and who did it; a visit with no photos isn’t listed', r.visits.map((v) => [v.apptId, v.service, v.provider]));
  const v1 = r.visits[0].photos;
  ok(v1.map((p) => p.kind).join() === 'inspiration,inspiration,now,earlier' && v1[1].n === 2 && v1[0].original === orig && v1[0].current && !v1[3].current, 'each photo says what it is and its number; only the photos on the visit now can be marked up', v1.map((p) => [p.kind, p.n, p.current]));
  ok(v1[0].source === 'visit_link' && v1[0].at === Date.parse('2026-10-28T10:00:00.000Z') && v1[3].source === 'earlier', 'photos sent from the visit link (after the team asked) say so, with when', v1[0]);
  ok(r.visits[1].photos.length === 1 && r.visits[1].photos[0].source === 'team', 'the same photo twice is shown once; after photos are the team’s');
  ok(r.imported.length === 1 && r.imported[0].from === 'Vagaro' && r.imported[0].id === photoKey('https://old.test/x.jpg'), 'photos brought over from another app, and where from');
  const counts = CP.filterCounts(r.visits, r.imported);
  ok(counts.all === 6 && counts.inspiration === 3 && counts.before === 1 && counts.after === 1 && counts.imported === 1, 'how many each filter has', counts);
  ok(CP.removable({ kind: 'inspiration' }) && CP.removable({ kind: 'now' }) && !CP.removable({ kind: 'after' }) && !CP.removable({ kind: 'imported' }), 'only photos the client sent can be removed here (after photos stay part of the visit’s record)');

  // ── the server: opened, and remove
  const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Opal Manicure Studio', storageBucket: BK });
  await db.doc(`${T}/clients/c1`).set({ name: 'Dana Reyes' }); await db.doc(`${T}/clients/c2`).set({ name: 'Lee Cho' });
  for (const a of visits) await db.doc(`${T}/appointments/${a.id}`).set({ ...a, clientName: 'Dana Reyes' });
  const k1 = photoKey(fb('1'));
  await db.doc(`${T}/appointments/a1`).set({ inspoTeam: { [k1]: { by: 'Mia' } }, inspoReply: { at: 'x', photos: { [k1]: { base: fb('b', 'visit-photos/a1/1762500000000-b'), theirs: fb('t', 'visit-photos/a1/1762500000000-t'), mine: null } } } }, { merge: true });
  await db.doc(`${T}/appointments/a1/inspoMarks/${k1}`).set({ markup: '{"private":"Allergic"}' });
  const R = await import('../../src/app/api/clients/photos/route');
  const post = async (body: any) => { const res: any = await R.POST(req({ tenantId: 't1', clientId: 'c1', ...body })); return { status: res.status, body: await res.json() }; };

  const o1 = await post({ action: 'opened', key: k1, apptId: 'a1' }); const o2 = await post({ action: 'opened', key: k1, apptId: 'a1' });
  actorNow = { name: 'Mia Lopez', uid: 'p1', role: 'staff', caps: [] };
  const o3 = await post({ action: 'opened', key: k1, apptId: 'a1' });
  const rec: any = (await db.doc(`${T}/clientPhotoRecords/c1__${k1}`).get()).data();
  ok(o1.body.ok && rec.opened.length === 2 && o3.body.opened.map((x: any) => x.by).join() === 'Mia,Kai', 'opening a record is noted (once in a while for the same person), latest first', { o3: o3.body, n: rec.opened.length });
  ok((await post({ action: 'opened', key: k1, apptId: 'a1', clientId: 'c2' })).status === 404, 'a photo is only opened from its own client’s page');
  ok((await post({ action: 'opened', key: photoKey('https://made.up/x.jpg'), apptId: 'a1' })).status === 404 && (await post({ action: 'opened', key: photoKey('https://made.up/x.jpg') })).status === 404, 'only a photo that’s really on the visit (or brought over onto the page) gets a record');
  actorNow = { name: 'Rae Kim', uid: 'r1', role: 'renter', caps: [], isRenter: true };
  ok((await post({ action: 'opened', key: k1, apptId: 'a1' })).status === 403, 'a booth renter can’t open another provider’s client’s photos');
  actorNow = { name: 'Mia Lopez', uid: 'p1', role: 'staff', caps: [] };
  ok((await post({ action: 'remove', key: k1, apptId: 'a1', kind: 'inspiration' })).status === 403, 'only a manager can remove a client’s photo');
  actorNow = { name: 'Kai Park', uid: 'm1', role: 'manager', isManager: true, caps: [] };
  ok((await post({ action: 'remove', key: photoKey(fb('a', 'visit-photos/a0/1762500000000-x')), apptId: 'a0', kind: 'after' })).status === 400, 'after photos can’t be removed here');
  const rm = await post({ action: 'remove', key: k1, apptId: 'a1', kind: 'inspiration' });
  const a1: any = (await db.doc(`${T}/appointments/a1`).get()).data();
  ok(rm.body.ok && a1.inspirationPhotos.length === 1 && a1.inspirationPhotos[0].url === fb('2') && !a1.inspoTeam?.[k1] && !a1.inspoReply?.photos?.[k1], 'removed: off the visit, with the team’s marks and what the visit link showed', { rm: rm.body, team: a1.inspoTeam, reply: a1.inspoReply });
  ok(!(await db.doc(`${T}/appointments/a1/inspoMarks/${k1}`).get()).exists && !(await db.doc(`${T}/visitPhotoMarks/a1__${k1}`).get()).exists, 'the team’s marks and private notes on it are deleted too (wherever they were kept)');
  ok(deleted.includes(`${BK}:tenants/t1/booking-inspiration/2026-11-07/1762500000000-ab12cd1.jpg`) && deleted.includes('private:tenants/t1/completions/inspiration-originals/2026-11-07/abcdefgh12.jpg')
    && deleted.some((d) => /visit-photos\/a1\/1762500000000-b/.test(d)) && deleted.some((d) => /visit-photos\/a1\/1762500000000-t/.test(d)) && rm.body.deleted === 4 && !rm.body.failed && !rm.body.shared, 'every copy kept here is deleted: the photo, the photo before its marks, and the team’s images', { deleted, rm: rm.body });
  const tomb: any = (await db.doc(`${T}/clientPhotoRecords/c1__${k1}`).get()).data();
  ok(tomb.removedAt && tomb.removedBy?.name === 'Kai Park' && !tomb.opened && !tomb.pendingDeletes && audit.some((e) => e.action === 'clients.photo_removed'), 'who removed it, and when, is kept (who had opened it isn’t, and nothing is left to delete)', tomb);
  ok((await post({ action: 'remove', key: k1, apptId: 'a1', kind: 'inspiration' })).status === 404, 'removing it twice: it’s already gone');
  // The same photo on another of the client's visits (a copied or rebooked visit): that copy is kept.
  const k2 = photoKey(fb('2'));
  await db.doc(`${T}/appointments/a3`).set({ clientId: 'c1', status: 'confirmed', startTime: '2026-12-05T18:00:00.000Z', inspirationPhotos: [{ url: fb('2') }] });
  const before = deleted.length; const rs = await post({ action: 'remove', key: k2, apptId: 'a1', kind: 'inspiration' });
  const a1b: any = (await db.doc(`${T}/appointments/a1`).get()).data();
  ok(rs.body.ok && rs.body.shared === 1 && deleted.length === before && !a1b.inspirationPhotos.length && !a1b.inspirationPhotoUrl, 'a photo another of the client’s visits still uses is taken off this visit, and its file is kept', { rs: rs.body, a1b: a1b.inspirationPhotos });
  // A copy that can't be deleted just now is listed to be tried again.
  await db.doc(`${T}/appointments/a4`).set({ clientId: 'c1', status: 'confirmed', startTime: '2026-12-09T18:00:00.000Z', inspirationPhotosEarlier: [{ url: fb('f') }] });
  failOn.add('tenants/t1/booking-inspiration/2026-11-07/1762500000000-ab12cdf.jpg');
  const rf = await post({ action: 'remove', key: photoKey(fb('f')), apptId: 'a4', kind: 'earlier' });
  const recF: any = (await db.doc(`${T}/clientPhotoRecords/c1__${photoKey(fb('f'))}`).get()).data();
  ok(rf.body.ok && rf.body.failed === 1 && recF.pendingDeletes?.[0] === fb('f'), 'a copy that couldn’t be deleted just now is listed on the record, to be tried again', { rf: rf.body, recF });
  ok((await db.doc(`${T}/clients/c1`).get()).data().photoDeletesPending === true, 'and the client is marked as having copies left to delete');
  failOn.clear(); const dl0 = deleted.length;
  await post({ action: 'opened', key: photoKey(fb('n')), apptId: 'a1' });
  const recF2: any = (await db.doc(`${T}/clientPhotoRecords/c1__${photoKey(fb('f'))}`).get()).data();
  ok(!recF2.pendingDeletes && deleted.length === dl0 + 1 && !(await db.doc(`${T}/clients/c1`).get()).data().photoDeletesPending, 'the next time one of the client’s photos is opened, what’s left is deleted, and the mark goes', { recF2, n: deleted.length - dl0 });
  const routeS = src('src/app/api/clients/photos/route.ts');
  ok(/photoDeletesTriedAt \|\| ''\)\) > Date\.now\(\) - 15 \* 60e3/.test(routeS) && /all\.docs\.length < 500/.test(routeS) && /\{ tries: 1, scan \}/.test(routeS), 'tried again at most every 15 minutes, once each with no waiting; the mark only goes when every record was seen');
  const kn = photoKey(fb('n'));
  const rn = await post({ action: 'remove', key: kn, apptId: 'a1', kind: 'now' });
  ok(rn.body.ok && !(await db.doc(`${T}/appointments/a1`).get()).data().nowPhoto, 'how it looked before can be removed too');
  const IPm = await import('../../src/lib/inspo-photos');
  ok((await IPm.deleteOwnPhoto(db, 'https://elsewhere.test/x.jpg', 't1', 'a1', [BK])) === 'not_ours', 'a photo somewhere else is never deleted from here');
  ok((await IPm.deleteOwnPhoto(db, fb('z', 'retail-claims/x/1-'), 't1', 'a1', [BK])) === 'not_ours' && (await IPm.deleteOwnPhoto(db, fb('z', 'visit-photos/a9/1-'), 't1', 'a1', [BK])) === 'not_ours', 'another of the business’s files (or another visit’s team photo) is never deleted as this photo');

  // ── the page
  const tabs = src('src/components/clients/ClientTabs.tsx'); const recS = src('src/components/clients/ClientPhotoRecord.tsx');
  ok(/PHOTO_FILTERS\.filter\(\(f\) => f\.key === 'all' \|\| counts\[f\.key\]\)/.test(tabs) && /aria-pressed=\{kind === f\.key\}/.test(tabs) && /v\.provider/.test(tabs), 'filters by kind with counts (only kinds with photos), and each visit says what and who');
  ok(/grid-cols-\[minmax\(0,1fr\)_380px\]/.test(tabs) && /aria-label="A photo’s record"/.test(tabs) && /Escape/.test(tabs), 'the record sits beside the photos on a computer, and over them on a phone (Escape or ‹ Photos closes it)');
  ok(/'marked', 'original'/.test(recS) && /role="switch"/.test(recS) && /Private team notes/.test(recS) && /Never shown to \$\{name\}/.test(recS), 'a record: marked or original, each layer shown or hidden, private notes marked as never shown');
  ok(/May be used for/.test(recS) && /Never: it may be someone else’s work/.test(recS) && /hasn’t agreed to marketing use/.test(recS), 'what it may be used for: never marketing for someone else’s work, and the client’s own say for the rest');
  ok(/Opened by/.test(recS) && /Until \{name\} asks to remove it/.test(recS) && /action: 'opened'/.test(recS), 'who has opened it lately, and how long it’s kept');
  ok(/role="alertdialog" aria-label="Remove this photo\?"/.test(recS) && /This can’t be undone/.test(recS) && /background: RED/.test(recS) && /removeOk = isManager && removable\(photo\)/.test(recS), 'remove asks first, says it can’t be undone, and is only for managers and photos the client sent');
  ok(/<TeamPhotoMarkup key=\{photo\.id\}/.test(recS) && /!ENDED\.includes/.test(recS), 'open in markup: a photo on a visit that’s still to come');
  ok(/if \(mode === 'original'\) \{ setMode\('marked'\); setShown\(\(s\) => \(s\.includes\(l\) \? s : \[\.\.\.s, l\]\)\)/.test(recS), 'from the original, a layer’s switch shows the marks again with that layer on');
  ok(/exportRef\.current = img \?/.test(recS) && /4000 \/ Math\.max/.test(recS), 'Download saves what’s shown at the photo’s own size');
  ok(/Not available just now/.test(recS) && /tried again later, when \$\{name\}’s photos are opened/.test(recS) && /so that copy is kept there/.test(recS), 'it says when who opened it can’t be shown, and when a copy is kept or will be tried again');
  ok(/max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto/.test(tabs) && /if \(kind !== 'all' && !counts\[kind\]\) setKind\('all'\)/.test(tabs) && /\[data-markup-editor\], \[role=alertdialog\]/.test(tabs) && /lastTile\.current/.test(tabs), 'the record scrolls within the screen; an empty filter goes back to All; Escape leaves the markup tool and questions alone; focus goes back to the photo');
  const page = src('src/app/(app)/clients/[id]/page.tsx');
  ok(/<ClientPhotos tenantId=\{tenantId\}[^>]*staff=\{allStaffList\}/.test(page) && /isManager=\{isPrivacyManager\}/.test(page), 'the client page passes who’s signed in and whether they’re a manager');
  const files = ['src/lib/client-photos.ts', 'src/app/api/clients/photos/route.ts', 'src/components/clients/ClientPhotoRecord.tsx', 'src/components/markup/useTeamPhoto.ts'];
  const name = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map(([a, b]) => a + b).join('|'), 'i');
  ok(files.every((f) => !name.test(src(f))) && files.every((f) => !/\{\/\*/.test(src(f))) && files.every((f) => !/call us|contact us|colour|favour/i.test(src(f))), 'house rules: no tool names, no comments in the markup, US spelling, never “call us”');

  if (bad) { console.error(`\n${bad} check(s) failed`); process.exit(1); }
  console.log('\nall good');
})().catch((e) => { console.error(e); process.exit(1); });
