// Checks packing photos (api/retail/pack-photo, lib/pack-photo, the packing screen and the bench). A photo is saved by
// the server, so the photo storage's own rules never stop it, and recorded with its order, the box it shows (box 1,
// box 2, … as the boxes' labels are numbered), what it shows and who took it when; the order's history says so. The
// shop's limit is per box. A photo taken by mistake can be taken off. Every box going out needs its own open photo
// when one is needed. Photos from before are still counted (box 1). The screens send a small JPEG made on the device.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/pack-photo.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false };
const uploads: any[] = [];
let uploadFails = '';
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/claim-photo-upload') return { uploadClaimPhotoFromDataUrl: async (t: string, id: string, dataUrl: string, folder: string) => {
    uploads.push({ t, id, folder, dataUrl });
    return uploadFails ? { url: null, error: uploadFails } : { url: `https://files.test/${folder}/${id}/${uploads.length}.jpg` };
  } };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => null } }) as any;
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const fresh = async (x: any = {}, rs: any = {}) => {
  db = makeDb(); uploads.length = 0; uploadFails = '';
  actor = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false };
  await db.doc(T).set({ name: 'Opal', retailSettings: { packPhotoEnabled: true, packPhotoMaxPhotos: 3, ...rs } });
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', orderNumber: 1300, stage: 'picking', method: 'ship', lines: [], packBoxes: [{ name: 'Small' }, { name: 'Medium' }], ...x });
};

(async () => {
  const lib = await import('../../src/lib/pack-photo');
  const { POST } = await import('../../src/app/api/retail/pack-photo/route');
  const send = (x: any) => POST(req({ tenantId: 't1', orderId: 'o1', ...x })) as any;

  // ── Saving a photo ──
  await fresh();
  let r = await send({ dataUrl: jpeg, box: 2, kind: 'contents' });
  let o = await get(`${T}/retailOrders/o1`);
  check('a photo of box 2, open: saved by the server and recorded with the order, the box, what it shows and who took it',
    r.status === 200 && r.body.ok && uploads[0]?.folder === 'pack-photos' && uploads[0]?.id === 'o1' && o.packPhotos?.length === 1 && o.packPhotos[0].box === 2
    && o.packPhotos[0].kind === 'contents' && o.packPhotos[0].by === 'Kai Park' && !!o.packPhotos[0].at && o.packPhotoUrls?.[0] === o.packPhotos[0].url && o.packPhotoBy === 'Kai Park', { r: r.body, o });
  const ev = (await all(`${T}/retailOrders/o1/events`)).find((e: any) => e.meta?.kind === 'pack_photo');
  check('…and the order’s history says so', !!ev && ev.meta.box === 2 && /Photo of box 2 of 2/.test(ev.meta.text), ev);
  r = await send({ dataUrl: jpeg });
  o = await get(`${T}/retailOrders/o1`);
  check('no box or kind given: box 1, open with its contents', r.body.ok && o.packPhotos[1].box === 1 && o.packPhotos[1].kind === 'contents');
  r = await send({ dataUrl: jpeg, box: 99, kind: 'weird' });
  o = await get(`${T}/retailOrders/o1`);
  check('a box number past the last box is kept to the boxes there can be, and an unknown kind is “open”', r.body.ok && o.packPhotos[2].box <= 6 && o.packPhotos[2].kind === 'contents', o.packPhotos[2]);

  // ── The limit is per box ──
  await fresh();
  for (let i = 0; i < 6; i++) await send({ dataUrl: jpeg, box: (i % 2) + 1 });
  r = await send({ dataUrl: jpeg, box: 1 });
  check('the shop keeps 3 photos a box: two boxes keep 6, and a 7th is refused with a reason', r.status === 409 && /already has 6 photos/.test(r.body.error) && (await get(`${T}/retailOrders/o1`)).packPhotos.length === 6, r.body);

  // ── Taking one off ──
  const url = (await get(`${T}/retailOrders/o1`)).packPhotos[0].url;
  r = await send({ action: 'remove', url });
  o = await get(`${T}/retailOrders/o1`);
  check('a photo taken by mistake comes off the order (and its plain list), and the history keeps a line',
    r.body.ok && o.packPhotos.length === 5 && !o.packPhotoUrls.includes(url) && (await all(`${T}/retailOrders/o1/events`)).some((e: any) => e.meta?.kind === 'pack_photo_removed'), r.body);
  r = await send({ action: 'remove', url });
  check('…taking it off again: it isn’t on the order', r.status === 404);

  // ── Who and when ──
  await fresh();
  actor = { ...actor, isRenter: true };
  r = await send({ dataUrl: jpeg });
  check('a renter can’t add photos to the shop’s orders', r.status === 403 && !uploads.length);
  await fresh({ stage: 'cancelled' });
  r = await send({ dataUrl: jpeg });
  check('a cancelled order has no box to photograph', r.status === 409 && !uploads.length);
  await fresh();
  uploadFails = 'Use a JPG, PNG, or WebP photo.';
  r = await send({ dataUrl: 'data:image/heic;base64,AAAA' });
  check('a photo the server can’t keep says why, and nothing is recorded', r.status === 422 && /JPG, PNG, or WebP/.test(r.body.error) && !(await get(`${T}/retailOrders/o1`)).packPhotos, r.body);

  // ── The record ──
  const legacy = { packPhotoUrls: ['https://old/1.jpg'], packPhotoAt: '2026-10-01T10:00:00.000Z', packPhotoBy: 'Ava', packPhotos: [{ url: 'https://new/2.jpg', box: 2, kind: 'sealed', at: '2026-10-02T10:00:00.000Z', by: 'Kai' }] };
  const list = lib.packPhotosOf(legacy);
  check('photos from before boxes were recorded still count, as box 1 open', list.length === 2 && list[0].url === 'https://old/1.jpg' && list[0].box === 1 && list[0].kind === 'contents' && list[0].by === 'Ava' && list[1].box === 2 && list[1].kind === 'sealed');
  check('each box needs its own open photo: box 2 has only a sealed one', JSON.stringify(lib.boxesMissingPhoto(legacy, 2)) === '[2]' && lib.boxesMissingPhoto(legacy, 1).length === 0);
  check('the dispute line counts the boxes', /2 images of 2 boxes/.test(lib.packPhotoEvidenceLine({ ...legacy, packPhotoUrls: ['https://old/1.jpg', 'https://new/2.jpg'], packPhotos: [{ box: 1 }, { box: 2 }] })));

  // ── The screens ──
  const src = (p: string) => fs.readFileSync(p, 'utf8');
  const pack = src('src/components/orders/PackMode.tsx');
  check('the packing screen sends a small JPEG made on the device to the server, box by box, and can take one off',
    /downscaleImageToDataUrl\(file, \{ maxDim: policy\.maxDimension \}\)/.test(pack) && /\/api\/retail\/pack-photo/.test(pack) && /action: 'remove'/.test(pack) && !/uploadImage\(/.test(pack) && /capture="environment"/.test(pack) && /or choose one/.test(pack));
  const bench = src('src/app/(app)/retail-orders/bench/page.tsx');
  check('…and so does the bench', /downscaleImageToDataUrl\(/.test(bench) && /\/api\/retail\/pack-photo/.test(bench) && !/uploadImage\(/.test(bench));
  check('the evidence pages show each photo’s box and what it shows', /packPhotosOf\(order\)/.test(src('src/app/(app)/retail-orders/evidence/[orderId]/page.tsx')) && /packPhotosOf\(order\)/.test(src('src/app/print/evidence/[tenantId]/[orderId]/page.tsx')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
