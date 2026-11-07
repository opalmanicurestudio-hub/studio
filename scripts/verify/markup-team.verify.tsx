// scripts/verify/markup-team.verify.tsx — THE TEAM'S MARKS ON A CLIENT'S PHOTO (B7c-2, boards 17B and 17C). The team
// marks up the client's photos on their own layers; the client's marks are never changed; private team notes never
// reach the visit link; what the visit link is given is the photo and each layer of marks over it, the note and the
// team's marks in plain words; the client can say it looks good or reply, once each time the team sends.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/markup-team.verify.tsx
import Module from 'module';
import fs from 'fs';
import { makeDb, FV } from './fake-db';
import * as Mk from '../../src/lib/markup/model';
import * as Tm from '../../src/lib/markup/team';
import * as IP from '../../src/lib/inspo-photos';

let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
// The server, against an in-memory database: the routes run as they do, with sign-in, messages and storage stood in for.
const db: any = makeDb(); const sent: any[] = []; const audit: any[] = [];
let actorNow: any = { name: 'Mia Lopez', uid: 'p1', role: 'staff', caps: [] };
const ML: any = Module as any; const load = ML._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = ML._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const stored: Record<string, Buffer> = { 'tenants/t1/completions/inspiration-originals/2026-11-07/abcdefgh12.jpg': Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]) };
const bucket = { file: (p: string) => ({ getMetadata: async () => [{ size: stored[p]?.length || 0, contentType: 'image/jpeg' }], download: async () => { if (!stored[p]) throw new Error('No such object'); return [stored[p]]; } }) };
ML._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request) || request === './firebase-admin') return fake(request, { getAdminDb: () => db, getAdminApp: () => ({ options: {} }) });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: actorNow }) };
  if (request === '@/lib/audit' || request === './audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_d: any, _t: string, e: any) => { audit.push(e); } });
  if (request === 'firebase-admin/firestore') return { FieldValue: FV };
  if (request === './notify' || request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_d: any, x: any) => { sent.push(x); return { ok: true }; } });
  if (request === './private-storage' || request === '@/lib/private-storage' || /\/src\/lib\/private-storage(\.ts)?$/.test(request)) return fake(request, { privateBucket: async () => bucket });
  if (request === '@/lib/client-verify' || /\/src\/lib\/client-verify(\.ts)?$/.test(request)) return fake(request, { visitLinkOpen: async () => 'ok', contactFresh: async () => true, deviceTrusted: async () => true });
  if (request === '@/lib/push' || /\/src\/lib\/push(\.ts)?$/.test(request)) return fake(request, { pushNow: async () => null });
  return load.call(this, request, ...rest);
};
const req = (body: any, q = '') => ({ json: async () => body, headers: new Headers(), nextUrl: { origin: 'https://opal.test', searchParams: new URLSearchParams(q) } } as any);

const mark = (o: Partial<Mk.Mark>): Mk.Mark => ({ id: Mk.uid(), kind: 'pen', layer: 'client', color: '#e11d48', size: 0.012, opacity: 1, rotation: 0, pts: [{ x: 10, y: 10 }, { x: 40, y: 40 }], ...o });

// ── keys
const u1 = 'https://firebasestorage.googleapis.com/v0/b/b1/o/tenants%2Ft1%2Fbooking-inspiration%2F2026-11-07%2F1-abc.jpg?alt=media&token=x';
ok(Tm.photoKey(u1) === Tm.photoKey(u1) && Tm.photoKey(u1) !== Tm.photoKey(u1 + 'y') && /^p[a-z0-9]{2,30}$/.test(Tm.photoKey(u1)), 'a photo has the same key every time, a different photo another, and the key is safe to keep as a field name', Tm.photoKey(u1));

// ── what the team's editor opens with
const clientDoc: Mk.MarkupDoc = { ...Mk.emptyDoc(1200, 900), marks: [mark({}), mark({ kind: 'pin', pts: [{ x: 5, y: 5 }], pin: { n: 1, note: 'This shape' } }), mark({ kind: 'pin', pts: [{ x: 6, y: 6 }], pin: { n: 2, note: '' } })], nextPin: 3, colors: ['#a99cbb'], note: 'Shorter please' };
const cPacked = Mk.keepMarkup(Mk.packDoc(clientDoc), { as: 'client' })!;
const teamDoc: Mk.MarkupDoc = { ...Mk.emptyDoc(1200, 900), view: { crop: null, turn: 90, flip: false, straighten: 0 }, marks: [mark({ layer: 'team', kind: 'nail', pts: [{ x: 100, y: 100 }], nail: { shape: 'almond', length: 'medium' } }), mark({ layer: 'private', kind: 'text', pts: [{ x: 50, y: 50 }], text: 'Allergic to the glue' }), mark({ layer: 'team', kind: 'pin', pts: [{ x: 7, y: 7 }], pin: { n: 3, note: 'Medium almond on all ten' } }), mark({ layer: 'client', kind: 'arrow' })], nextPin: 4, colors: ['#a99cbb', '#b9605d'], note: 'We’ll do medium almond.' };
const tPacked = Tm.keepTeamMarkup(Mk.packDoc(teamDoc))!;
const tKept = JSON.parse(tPacked);
ok(tKept.marks.length === 3 && tKept.marks.every((m: any) => m.layer === 'team' || m.layer === 'private'), 'what the team keeps: only their own marks and private notes (a mark on the client’s layer sent with them is dropped)', tKept.marks.map((m: any) => m.layer));
const opened = Tm.teamDocFor({ client: cPacked, team: tPacked, base: 'original', teamBase: 'original' });
const od = opened.doc!;
ok(od.marks.filter((m) => m.layer === 'client').length === 3 && od.marks.filter((m) => m.layer === 'team').length === 2 && od.marks.filter((m) => m.layer === 'private').length === 1, 'on the photo before its marks: the client’s marks on their layer, the team’s and the private notes on theirs', od.marks.map((m) => m.layer));
ok(od.view.turn === 90 && od.nextPin === 4 && od.note === 'We’ll do medium almond.' && opened.clientColors.join() === '#a99cbb' && od.colors.includes('#b9605d'), 'it opens in the team’s own view, pins go on numbering after every pin so far, with the team’s note and colors', { view: od.view, nextPin: od.nextPin, note: od.note, colors: od.colors });
const split = Tm.teamPart(od, opened.clientColors);
ok(split.marks.every((m) => m.layer !== 'client') && split.colors.join() === '#b9605d' && split.view.turn === 90, 'kept for the team: their marks and private notes, the colors they picked (not the client’s), and their view', { colors: split.colors });
const flat = Tm.teamDocFor({ client: cPacked, team: tPacked, base: 'photo', teamBase: 'original' });
ok(flat.doc === null && flat.dropped && flat.clientColors.length === 0, 'without the photo before its marks: the client’s marks are part of the photo, and marks made on the other copy start fresh (and it says so)');
const flatTeam = Tm.teamDocFor({ client: cPacked, team: tPacked, base: 'photo', teamBase: 'photo' });
ok(flatTeam.doc && flatTeam.doc.marks.every((m) => m.layer !== 'client') && !flatTeam.dropped, 'on the photo as sent, the team’s own marks open again as they left them');
const wrongSize = Tm.teamDocFor({ client: Mk.keepMarkup(Mk.packDoc({ ...clientDoc, w: 1000 }), { as: 'client' }), team: tPacked, base: 'original', teamBase: 'original' });
ok(wrongSize.doc?.w === 1000 && wrongSize.dropped && wrongSize.doc!.marks.every((m) => m.layer === 'client'), 'team marks that don’t fit the photo’s size are left out, not drawn in the wrong place');
ok(Tm.teamDocFor({ client: null, team: null, base: 'original' }).doc === null, 'nothing kept: the editor starts fresh on the photo');
const stamps = (n: number, layer: Mk.Layer) => Array.from({ length: n }, (_, i) => ({ id: `${layer[0]}${i}`, kind: 'stamp', layer, stamp: 'heart', pts: [{ x: 10 + i, y: 10 }] }));
const bigClient = JSON.stringify({ v: 1, w: 1200, h: 900, nextPin: 1, view: {}, colors: [], note: '', marks: stamps(170, 'client') });
const bigTeam = JSON.stringify({ v: 1, w: 1200, h: 900, nextPin: 1, view: {}, colors: [], note: '', marks: stamps(140, 'team') });
const fullOpen = Tm.teamDocFor({ client: bigClient, team: bigTeam, base: 'original', teamBase: 'original' }).doc!;
const fullMeta = Tm.teamDocFor({ client: bigClient, team: bigTeam, base: 'original', teamBase: 'original' });
ok(fullMeta.cut && fullMeta.clientMarks.length === 170, 'it says when some of the client’s marks aren’t shown, and keeps all of them to send back with their layer');
ok(/overlay\(\{ \.\.\.res\.doc, marks: r\.clientMarks \}, img, \['client'\]\)/.test(src('src/components/markup/TeamPhotoMarkup.tsx')), 'the client’s layer sent back is every one of their marks, in the team’s view');
ok(bigClient.length < 16000 && bigTeam.length < 16000 && fullOpen.marks.length === Mk.LIMITS.marks && fullOpen.marks.filter((m) => m.layer === 'team').length === 140, 'a photo already full of the client’s marks: every one of the team’s marks is still there (fewer of the client’s are shown)', fullOpen.marks.length);
ok(Tm.keepTeamMarkup('not json') === null && Tm.keepTeamMarkup('x'.repeat(17000)) === null && Tm.keepTeamMarkup(null) === null, 'anything that isn’t marks is turned away');

// ── the team's marks in plain words (never a private note)
const line = Tm.teamLine(tPacked, 'We’ll do medium almond.');
ok(/almond nail guide/.test(line) && /a pin/i.test(line) && /medium almond/.test(line) && !/Allergic|glue/.test(line), 'the team’s marks in plain words, with their note, and never a private note', line);

// ── what the visit link is given
const appt = {
  inspirationPhotos: [{ url: u1, note: 'a' }, { url: u1 + '2', note: 'b' }],
  nowPhoto: { url: 'https://firebasestorage.googleapis.com/v0/b/b1/o/now.jpg?alt=media&token=1' },
  inspoReply: { by: 'Mia Lopez', at: '2026-11-07T10:00:00.000Z', photos: {
    [Tm.photoKey(u1 + '2')]: { base: 'B2', mine: null, theirs: 'T2', w: 800, h: 1000, note: 'Lilac on the ring finger', line: 'A pin' },
    [Tm.photoKey(u1)]: { base: 'B1', mine: 'M1', theirs: 'T1', w: 1200, h: 900, note: '', line: 'Two nail guides' },
    [Tm.photoKey('gone')]: { base: 'X', theirs: 'Y' } },
    answer: { kind: 'ok', at: '2026-11-07T09:00:00.000Z' } },
};
const rep = Tm.replyFor(appt)!;
ok(rep.photos.map((p) => p.n).join() === '1,2' && rep.photos[0].mine === 'M1' && rep.photos[1].mine === null && rep.by === 'Mia', 'the photos the client has now, in their order, each with its layers; a photo they no longer have is left out; the team by first name', rep.photos.map((p) => [p.n, p.base]));
ok(rep.answer === null, 'an answer given before the marks were last sent doesn’t count: they’re asked again');
ok(Tm.replyFor({ ...appt, inspoReply: { ...appt.inspoReply, answer: { kind: 'reply', text: 'Shorter', at: '2026-11-07T11:00:00.000Z' } } })!.answer?.text === 'Shorter', 'an answer after the marks were sent is shown');
ok(rep.now === appt.nowPhoto.url && Tm.replyFor({ ...appt, nowPhoto: { url: '/api/files/view?t=t1&p=x' } })!.now === null, 'Compare uses the photo of how it looks now, only when the visit link can open it');
ok(Tm.replyFor({ inspirationPhotos: [{ url: 'other' }], inspoReply: appt.inspoReply }) === null && Tm.replyFor({}) === null, 'nothing to show when the team’s marks are on photos the client no longer has');
const leaks = JSON.stringify(Tm.replyFor({ ...appt, inspoReply: { ...appt.inspoReply, photos: { [Tm.photoKey(u1)]: { ...appt.inspoReply.photos[Tm.photoKey(u1)], markup: tPacked, private: 'Allergic' } } } }));
ok(!/Allergic|markup|private/.test(leaks), 'the visit link is given only what it shows: no marks data, nothing private', leaks.slice(0, 200));

// ── the team's photos for the visit, and the photo bytes
const B = ['b1'];
const vp = (path: string, q = '?alt=media&token=t') => `https://firebasestorage.googleapis.com/v0/b/b1/o/${encodeURIComponent(path)}${q}`;
ok(IP.ownVisitPhoto(vp('tenants/t1/visit-photos/a1/1731000000000-abc123.png'), 't1', 'a1', B), 'a photo the team saved under this visit is taken');
ok(!IP.ownVisitPhoto(vp('tenants/t1/visit-photos/a2/1731000000000-abc123.png'), 't1', 'a1', B) && !IP.ownVisitPhoto(vp('tenants/t2/visit-photos/a1/1-abc.png'), 't1', 'a1', B)
  && !IP.ownVisitPhoto(vp('tenants/t1/visit-photos/a1/1-abc.png', ''), 't1', 'a1', B) && !IP.ownVisitPhoto(vp('tenants/t1/visit-photos/a1/1-abc.png').replace('/b/b1/', '/b/evil/'), 't1', 'a1', B)
  && !IP.ownVisitPhoto('http://firebasestorage.googleapis.com/v0/b/b1/o/x', 't1', 'a1', B) && !IP.ownVisitPhoto(vp('tenants/t1/visit-photos/a1/../a2/1-abc.png'), 't1', 'a1', B),
  'another visit’s, another business’s, one without its link token, another bucket’s, or a made-up path is turned away');

// ── the server
const route = src('src/app/api/visit-photos/route.ts');
ok(/verifyStaffActor/.test(route) && /mayAct/.test(route) && /photoKey\(String\(p\.url\)\) === key/.test(route), 'the team only, the visit’s own provider or a manager to save or send, and only a photo the client has on this visit now');
ok(/inspoMarks\/\$\{key\}/.test(route) && !/inspoReply[^\n]*markup/.test(route) && /keepTeamMarkup/.test(route), 'the team’s marks and private notes are kept beside the visit; what the visit link gets never carries them');
ok(/ownVisitPhoto\(im\.base/.test(route) && /ownVisitPhoto\(im\.theirs/.test(route) && /photosAskOpen\(appt\)/.test(route), 'only photos saved under this visit are shown to the client, and not while they’ve been asked for different ones');
ok(/TELL_GAP_MS = 30 \* 60e3/.test(route) && /ms\(cur\.startTime\) > Date\.now\(\)/.test(route) && /tellPhotosMarked/.test(route), 'the client is told at most once every 30 minutes, and only before the visit');
ok(/'Cache-Control': 'private, no-store'/.test(route) && /photoBytes\(/.test(route), 'the photo itself comes from this app (so it can be drawn on), never kept by the browser');
ok(/toldAt: tellNow \? nowIso/.test(route) && /if \(cur\.inspoReply\?\.toldAt === nowIso\) tx\.update\(ref, \{ 'inspoReply\.toldAt': toldBefore \}\)/.test(route), 'the message time is set aside before it goes (two quick sends tell the client once), and given back if it didn’t go');
ok(route.indexOf('await markRef.set({ key, base, markup, note') < route.indexOf('await db.runTransaction'), 'the team’s copy is kept before the client sees anything');
const ip = src('src/lib/inspo-photos.ts');
ok(/export async function photoBytes/.test(ip) && /ownOriginal\(ref, tenantId\)/.test(ip) && /startsWith\(`tenants\/\$\{tenantId\}\/booking-inspiration\/`\)/.test(ip) && /buckets\.includes\(m\[1\]\)/.test(ip) && /image\\\/\(jpeg\|png\|webp\)/.test(ip), 'photo bytes: only this business’s own inspiration photos, in its own buckets, and only ever as a photo');
const remind = src('src/lib/forms-remind.ts');
ok(/export async function tellPhotosMarked/.test(remind) && /prefOf\(tenant, cl\)/.test(remind) && /kind: 'photos_marked'/.test(remind), 'the message about the marks goes the way the client chose to hear from the business');

// ── the visit link
const vv = src('src/app/api/visit-view/route.ts');
ok(/photosReply = !photosAsk && !ENDED_VISIT\.includes/.test(vv) && /replyFor\(a\)/.test(vv), 'the visit link shows the team’s marks before the visit, and not while new photos are asked for');
const act = src('src/app/api/checkin/actions/route.ts');
ok(/action === 'photos_reply'/.test(act) && /visitLinkOpen/.test(act) && /if \(r\.answer\) return 'already'/.test(act) && /runTransaction/.test(act), 'answering: from the client’s own link, once each time the team sends, even from two taps');
ok(/clientWrites\(db, x\.tenantId/.test(act) && /type: 'photos_reply'/.test(act), 'a reply reaches the business’s inbox, and the team hears about either answer');
const card = src('src/components/visit/PhotosReplyCard.tsx');
ok(/role="switch" aria-checked=\{mineOn\}/.test(card) && /role="switch" aria-checked=\{theirsOn\}/.test(card) && /Looks good/.test(card) && /Reply/.test(card) && /looked at your photos/.test(card), 'the reply card: your marks and the team’s, each shown or hidden, Looks good or Reply');
ok(/alt=\{alt\}/.test(card) && /p\.line/.test(card) && /over: \[/.test(card), 'every mark in plain words for screen readers, and Compare lays the marks over the photo');
const page = src('src/app/check-in/[token]/page.tsx');
ok(/PhotosReplyCard reply=\{photosReply\}/.test(page) && (page.match(/\{replyCard\}/g) || []).length === 2, 'the card is on the visit page, wherever the photo cards are');

// ── the team's screen
const tpm = src('src/components/markup/TeamPhotoMarkup.tsx');
ok(/editLayers=\{\['team', 'private'\]\}/.test(tpm) && /sendLayers=\{\['client', 'team'\]\}/.test(tpm) && /Save for the team/.test(tpm) && /doneLabel=\{`Send to \$\{client\}`\}/.test(tpm), 'the team adds to their layer or private notes, never the client’s; Save for the team, or Send to the client');
ok(/overlay\(res\.doc, img, \['team'\]\)/.test(tpm) && /flatten\(res\.doc, img, \[\]\)/.test(tpm) && !/overlay\([^)]*'private'/.test(tpm), 'what’s sent: the photo without marks and the team’s layer (and the client’s), never the private notes');
ok(/action: 'bytes'/.test(tpm) && /URL\.revokeObjectURL/.test(tpm) && /resolvePrivateUrl\(String\(photo\.url\)\)/.test(tpm), 'the photo opens through this app (the photo before its marks first), with older photos from elsewhere still looked at');
ok(/marks are part of this photo/.test(tpm) && /starts fresh/.test(tpm), 'it says when the client’s marks are part of the photo, and when earlier marks don’t fit');
const bv = src('src/components/planner/BeforeVisit.tsx');
ok(/setMarking\(photoKey\(String\(p\.url\)\)\)/.test(bv) && /<TeamPhotoMarkup key=\{marking!\}/.test(bv) && /said it looks good/.test(bv) && /replied:/.test(bv), 'on the appointment, each photo opens in the markup tool (by the photo itself, so a newer photo never gets another’s marks), with what the client said back');
ok(/new Date\(toMs\(appointment\.startTime\)\)/.test(bv) && /sent new photos, so that one closed/.test(bv), 'the visit’s time is read whatever form it’s kept in; a photo replaced while open closes, and says so');
ok(/<OverSheet label="Compare"><PhotoCompare inline/.test(bv) && /<OverSheet label=\{label\}>/.test(tpm) && /<MarkupEditor inline/.test(tpm) && /<PhotoCompare inline/.test(tpm), 'over the appointment’s sheet, the markup tool and Compare open as dialogs of their own, so keys and the pointer work');
const ed = src('src/components/markup/MarkupEditor.tsx');
ok(/alt\?: \{ label: string; onDone/.test(ed) && /done\('alt'\)/.test(ed) && /\{aside\}/.test(ed) && /\{headerExtra\}/.test(ed), 'the editor takes a second way to finish, more about the photo, and other views of it');
ok(/all\[all\.length - 1\] !== root\.current\) return/.test(ed), 'Back goes to the screen on top (Compare over the editor), not to both');
const draw = src('src/lib/markup/draw.ts');
ok(/if \(!o\.bare\)/.test(draw) && /export function overlay/.test(draw), 'one layer of marks can be drawn alone, see-through, to lay over the photo');
const cmp = src('src/components/markup/PhotoCompare.tsx');
ok(/over\?: string\[\]/.test(cmp) && /\(goal\.over \|\| \[\]\)\.map/.test(cmp), 'Compare lays each layer of marks over its photo');

(async () => {
// ── on the server: save, send, answer
{
  const T = 'tenants/t1'; const BK = 'opal-test.appspot.com';
  await db.doc(T).set({ name: 'Opal Manicure Studio', timezone: 'America/Chicago', publicOrigin: 'https://opal.test', storageBucket: BK });
  const fb = `https://firebasestorage.googleapis.com/v0/b/${BK}/o/${encodeURIComponent('tenants/t1/booking-inspiration/2026-11-07/1762500000000-ab12cd.jpg')}?alt=media&token=tok`;
  const orig = `/api/files/view?t=t1&p=${encodeURIComponent('tenants/t1/completions/inspiration-originals/2026-11-07/abcdefgh12.jpg')}`;
  const start = new Date(Date.now() + 3 * 864e5).toISOString();
  await db.doc(`${T}/appointments/a1`).set({ serviceName: 'Gel manicure', clientId: 'cl1', clientName: 'Dana Reyes', clientPhone: '5125550148', staffId: 'p1', status: 'confirmed', startTime: start, checkInToken: 'tokA1234',
    inspirationPhotos: [{ url: fb, note: 'This shape', original: orig, markup: cPacked }] });
  await db.doc(`${T}/clients/cl1`).set({ name: 'Dana Reyes', phone: '5125550148' });
  await db.doc('appointmentCheckIns/tokA1234').set({ tenantId: 't1', id: 'a1' });
  const key = Tm.photoKey(fb);
  const R = await import('../../src/app/api/visit-photos/route');
  const post = async (body: any) => { const res: any = await R.POST(req({ tenantId: 't1', apptId: 'a1', key, ...body })); const type = res.headers.get('content-type') || ''; return { status: res.status, type, body: /json/.test(type) ? await res.json() : Buffer.from(await res.arrayBuffer()) }; };

  const by = await post({ action: 'bytes', which: 'original' });
  ok(by.status === 200 && by.type === 'image/jpeg' && Buffer.isBuffer(by.body) && by.body[0] === 0xff, 'the photo before its marks opens through this app, for the team to draw on', by.status);
  ok((await post({ action: 'bytes', which: 'original', key: Tm.photoKey('https://elsewhere.test/x.jpg') })).status === 404, 'a photo that isn’t on this visit isn’t opened');

  const s1 = await post({ action: 'save', base: 'original', markup: tPacked, note: 'Medium almond' });
  const kept: any = (await db.doc(`${T}/appointments/a1/inspoMarks/${key}`).get()).data();
  let a: any = (await db.doc(`${T}/appointments/a1`).get()).data();
  ok(s1.body.ok && kept?.markup && /Allergic/.test(kept.markup) && a.inspoTeam?.[key]?.privateCount === 1 && !a.inspoTeam[key].sentAt && !a.inspoReply, 'Save for the team: the marks and private notes are kept beside the visit, and the client sees nothing yet', { s1: s1.body, team: a.inspoTeam });
  const ld = await post({ action: 'load' });
  ok(ld.body.ok && ld.body.mark?.markup === kept.markup && ld.body.mark.note === 'Medium almond' && ld.body.mark.base === 'original', 'opening it again brings the team’s marks back');

  actorNow = { name: 'Sam Lee', uid: 'p2', role: 'staff', caps: [] };
  ok((await post({ action: 'save', base: 'original', markup: tPacked })).status === 403 && (await post({ action: 'load' })).status === 200, 'someone else on the team (not the visit’s provider, not a manager) can look, but not save or send');
  actorNow = { name: 'Rae Kim', uid: 'r1', role: 'renter', caps: [], isRenter: true };
  ok((await post({ action: 'load' })).status === 403 && (await post({ action: 'bytes', which: 'original' })).status === 403, 'a booth renter can’t open another provider’s client’s photos or private notes');
  actorNow = { name: 'Mia Lopez', uid: 'p1', role: 'staff', caps: [] };

  const img = (n: string, ap = 'a1') => `https://firebasestorage.googleapis.com/v0/b/${BK}/o/${encodeURIComponent(`tenants/t1/visit-photos/${ap}/1762500000000-${n}.${n === 'base' ? 'jpg' : 'png'}`)}?alt=media&token=t${n}`;
  ok((await post({ action: 'send', base: 'original', markup: tPacked, note: 'x', images: { base: 'https://evil.test/x.jpg', theirs: img('team'), w: 1200, h: 900 } })).status === 400, 'a photo from anywhere but this visit’s own uploads isn’t shown to the client');
  const s2 = await post({ action: 'send', base: 'original', markup: tPacked, note: 'We’ll do medium almond.', images: { base: img('base'), mine: img('mine'), theirs: img('team'), w: 1200, h: 900 } });
  a = (await db.doc(`${T}/appointments/a1`).get()).data();
  const texts = sent.filter((x) => x.kind === 'photos_marked');
  ok(s2.body.ok && s2.body.told === 'sent' && texts.length === 1 && /Mia looked at your inspiration photos/.test(texts[0].text) && /https:\/\/opal\.test\/check-in\/tokA1234/.test(texts[0].text), 'Send: the client is told, with their visit link', { s2: s2.body, texts });
  ok(a.inspoReply?.photos?.[key]?.theirs === img('team') && a.inspoReply.photos[key].mine === img('mine') && a.inspoReview?.status === 'ok' && a.inspoTeam[key].sentAt, 'what the visit link shows is kept, and the photos count as looked at', a.inspoReply);
  ok(!/Allergic|glue/.test(JSON.stringify(a.inspoReply)) && /almond nail guide/.test(a.inspoReply.photos[key].line), 'never a private note in what the client gets; the team’s marks in plain words', a.inspoReply.photos[key].line);
  const s3 = await post({ action: 'send', base: 'original', markup: tPacked, note: 'Changed my mind: square.', images: { base: img('base'), mine: img('mine'), theirs: img('team'), w: 1200, h: 900 } });
  ok(s3.body.ok && s3.body.told === 'later' && sent.filter((x) => x.kind === 'photos_marked').length === 1, 'sent again soon after: shown, but not another message', s3.body);

  const V = await import('../../src/app/api/visit-view/route');
  const vv: any = await (await V.GET(req({}, 'token=tokA1234'))).json();
  ok(vv.ok && vv.view?.photosReply?.photos?.[0]?.theirs === img('team') && vv.view.photosReply.by === 'Mia' && !/Allergic|inspoMarks|"markup"/.test(JSON.stringify(vv.view)), 'the visit link gets the photo and both layers, by first name, and nothing private', vv.view?.photosReply);

  const C = await import('../../src/app/api/checkin/actions/route');
  const cpost = async (body: any) => { const res: any = await C.POST(req({ token: 'tokA1234', ...body })); return { status: res.status, body: await res.json() }; };
  const okA = await cpost({ action: 'photos_reply', answer: 'ok' });
  a = (await db.doc(`${T}/appointments/a1`).get()).data();
  const notes = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data()).filter((n: any) => n.type === 'photos_reply');
  ok(okA.body.ok && a.inspoReply.answer?.kind === 'ok' && notes.length === 1 && notes[0].userId === 'p1', '“Looks good” is kept, and the team hears', { okA: okA.body, notes });
  ok((await cpost({ action: 'photos_reply', answer: 'ok' })).status === 409, 'answered once for each time the team sends');
  await post({ action: 'send', base: 'original', markup: tPacked, note: 'Square, then.', images: { base: img('base'), theirs: img('team'), w: 1200, h: 900 } });
  ok((await cpost({ action: 'photos_reply', answer: 'reply', text: '' })).status === 400, 'a reply needs words');
  const rp = await cpost({ action: 'photos_reply', answer: 'reply', text: 'A little shorter, please' });
  const inbox = (await db.collection(`${T}/smsInbox`).get()).docs.map((d: any) => d.data());
  ok(rp.body.ok && inbox.some((m: any) => m.body === 'About my inspiration photos: A little shorter, please' && m.appointmentId === 'a1'), 'a reply to new marks is kept and reaches the business’s inbox', { rp: rp.body, inbox });
  // Someone the business can't reach: shown on their link, the message time isn't used up.
  await db.doc(`${T}/appointments/a2`).set({ serviceName: 'Gel manicure', clientName: 'Lee Cho', staffId: 'p1', status: 'confirmed', startTime: start, checkInToken: 'tokB1234', inspirationPhotos: [{ url: fb, note: '' }] });
  const n2 = await (async () => { const res: any = await R.POST(req({ tenantId: 't1', apptId: 'a2', key, action: 'send', base: 'photo', markup: tPacked, note: 'Hi', images: { base: img('base', 'a2'), theirs: img('team', 'a2'), w: 1200, h: 900 } })); return res.json(); })();
  const a2: any = (await db.doc(`${T}/appointments/a2`).get()).data();
  ok(n2.ok && n2.told === 'no_contact' && !a2.inspoReply.toldAt && a2.inspoReply.photos[key], 'no phone or email: the marks are on their link, and the time set aside for a message goes back', { n2, toldAt: a2.inspoReply?.toldAt });
  await db.doc(`${T}/appointments/a1`).set({ inspoReview: { status: 'again', at: new Date().toISOString() } }, { merge: true });
  ok((await post({ action: 'send', base: 'original', markup: tPacked, note: 'x', images: { base: img('base'), theirs: img('team'), w: 1200, h: 900 } })).status === 409, 'not sent while the client has been asked for different photos');
}

// ── the rules for every screen
const files = ['src/lib/markup/team.ts', 'src/app/api/visit-photos/route.ts', 'src/components/markup/TeamPhotoMarkup.tsx', 'src/components/visit/PhotosReplyCard.tsx', 'src/components/planner/BeforeVisit.tsx'];
const name = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map(([a, b]) => a + b).join('|'), 'i');
ok(files.every((f) => !name.test(src(f))), 'no tool names in the code');
ok(files.every((f) => !/\{\/\*/.test(src(f))), 'no comments inside the markup');
ok(files.every((f) => !/\bcolour|\bfavour|\bcentre\b|organis|\bcancelled\b(?![^']*')/.test(src(f).replace(/'cancelled'/g, ''))), 'US spelling');
ok(files.every((f) => !/call us|contact us/i.test(src(f))), 'never “call us” or “contact us”');

if (bad) { console.error(`\n${bad} check(s) failed`); process.exit(1); }
console.log('\nall good');
})().catch((e) => { console.error(e); process.exit(1); });
