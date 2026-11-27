// Checks snapping a receipt (lib/receipt-read; Books' Snap a receipt: api/money/receipt-read and
// components/ledger/AddTransactionDialog; a renter's Add a cost: api/portal/renter-writeoffs 'receipt' and
// components/rent/RenterWriteOffs):
//   What's printed on the photo is read (who was paid, the day, the total, the tax, the likeliest category) and made
//   safe: a real day, not later than today, amounts above zero, only a category from the list. It fills only the boxes
//   still empty, for the person to check; nothing is saved from a reading alone. The photo is the business's own (its
//   uploads, or the renter's own folder), a picture, not too big. A renter's photo is kept with their cost; a meal's or a
//   gift's note stays theirs to write; a receipt kept as a photo isn't asked for again.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/receipt-snap.verify.ts
import fs from 'fs';
import Module from 'module';
import { createHash } from 'crypto';
import * as F from './fake-db';
const { check } = F;

const src = (f: string) => fs.readFileSync(f, 'utf8');
const db = F.makeDb();
let aiReply: any = { ok: true, text: '{"vendor":"Supply House","date":"2026-03-14","total":"$84.20","tax":"5.20","kind":"Supplies"}' };
const asked: any[] = []; let configured = true;
let actor: any = { uid: 'u1', isTenantOwner: true }; let deny = false;
let photo: { type: string; bytes: number; ok?: boolean } = { type: 'image/jpeg', bytes: 2000 };
const uploads: any[] = []; const dropped: string[] = []; const fetched: any[] = [];
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminStorage: () => ({ bucket: (_n: string) => ({ file: (p: string) => ({ delete: async () => { dropped.push(p); } }) }) }) };
  if (request === '@/lib/ai') return { aiConfigured: () => configured, askAI: async (o: any) => { asked.push(o); return aiReply; }, parseJson: (t: string) => { try { return JSON.parse((t.match(/\{[\s\S]*\}/) || [''])[0]); } catch { return null; } } };
  if (request === '@/lib/route-guard') return { requireCan: async () => (deny ? { deny: { status: 403, body: { ok: false } } } : { actor, tenant: { name: 'North Loft' } }) };
  if (request === '@/lib/inspo-photos') return { ourBuckets: async () => ['cf-app.firebasestorage.app'] };
  if (request === '@/lib/maintenance-server') return { uploadPortalImageFromDataUrl: async (t: string, sub: string, d: string) => { uploads.push({ t, sub }); return /^data:image\//.test(d) ? { url: fsUrl(`tenants/${t}/${sub}/1764000000000-ab12cd.jpg`) } : { url: null, error: 'Not a valid image.' }; } };
  if (request === '@/lib/here-server') return { bizLocationsOf: async () => [] };
  if (request === '@/lib/geocode-server') return { geocode: async () => null, reverseGeocode: async () => null, preciseEnough: () => false };
  if (request === '@/lib/route-server') return { roadLegs: async () => null };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
let lengthHeader = true;
(globalThis as any).fetch = async (_u: string, init: any) => { fetched.push(init || {}); return { ok: photo.ok !== false, headers: { get: (k: string) => (k === 'content-type' ? photo.type : k === 'content-length' && lengthHeader ? String(photo.bytes) : null) },
  body: { getReader: () => { let sent = 0; return { read: async () => { if (sent >= photo.bytes) return { done: true }; const n = Math.min(1024 * 1024, photo.bytes - sent); sent += n; return { done: false, value: new Uint8Array(n) }; }, cancel: async () => {} }; } } }; };
const fsUrl = (object: string, bucket = 'cf-app.firebasestorage.app') => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(object)}?alt=media&token=t1`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

(async () => {
  const { cleanReading, receiptPrompt, readReceipt, readSomething } = await import('../../src/lib/receipt-read');
  const kinds = ['Supplies', 'Meals', 'Rent'];
  console.log('A reading made safe');
  let r = cleanReading({ vendor: ' Supply\u0007 <House> ', date: '2026-03-14', total: '$1,234.50', tax: 9.1, kind: 'Supplies' }, '2026-11-27', kinds);
  check('vendor cleaned; the day kept; amounts in dollars; the kind from the list', r.vendor === 'Supply House' && r.date === '2026-03-14' && r.total === 1234.5 && r.tax === 9.1 && r.kind === 'Supplies', r);
  check('a day in the future, an impossible day or one years back: left empty', cleanReading({ date: '2026-12-01' }, '2026-11-27', kinds).date === null && cleanReading({ date: '2026-02-30' }, '2026-11-27', kinds).date === null
    && cleanReading({ date: '2023-01-02' }, '2026-11-27', kinds).date === null);
  check('no amount below zero, none absurd, the tax never the whole total', cleanReading({ total: -4 }, '2026-11-27', kinds).total === null && cleanReading({ total: 1e9 }, '2026-11-27', kinds).total === null
    && cleanReading({ total: 10, tax: 10 }, '2026-11-27', kinds).tax === null);
  check('a kind not on the list: none', cleanReading({ kind: 'Groceries' }, '2026-11-27', kinds).kind === '' && cleanReading(null, '2026-11-27', kinds).vendor === '');
  check('nothing made out: nothing to fill', !readSomething(cleanReading({}, '2026-11-27', kinds)) && readSomething(cleanReading({ total: 3 }, '2026-11-27', kinds)));
  check('the reader is told only what’s printed, the kinds as given', /Never guess a figure that isn’t printed/.test(receiptPrompt(kinds)) && /"Supplies", "Meals", "Rent"/.test(receiptPrompt(kinds)));

  console.log('Reading the photo');
  const bytes = Buffer.from('jpegbytes');
  let got = await readReceipt({ bytes, mediaType: 'image/jpeg', kinds, today: '2026-11-27', tenantId: 't1', purpose: 'x' });
  check('read with the fast model, the photo sent as a picture, for this business (its privacy setting applies)', got?.total === 84.2 && asked[0].tier === 'fast' && asked[0].image?.mediaType === 'image/jpeg' && asked[0].image?.data === bytes.toString('base64') && asked[0].tenantId === 't1');
  check('not a picture, or too big: not sent', (await readReceipt({ bytes, mediaType: 'application/pdf', kinds, today: '2026-11-27', tenantId: 't1', purpose: 'x' })) === null
    && (await readReceipt({ bytes: Buffer.alloc(6 * 1024 * 1024), mediaType: 'image/png', kinds, today: '2026-11-27', tenantId: 't1', purpose: 'x' })) === null && asked.length === 1);
  aiReply = { ok: false, text: '', error: 'Off in health privacy mode.' };
  check('reading off for the business, or it failed: nothing, never a guess', (await readReceipt({ bytes, mediaType: 'image/jpeg', kinds, today: '2026-11-27', tenantId: 't1', purpose: 'x' })) === null);
  aiReply = { ok: true, text: 'Sorry, I can’t read that. {"vendor":"","date":null,"total":null,"tax":null,"kind":""}' };
  check('not a receipt: nothing', (await readReceipt({ bytes, mediaType: 'image/jpeg', kinds, today: '2026-11-27', tenantId: 't1', purpose: 'x' })) === null);
  configured = false;
  check('no reader set up: nothing', (await readReceipt({ bytes, mediaType: 'image/jpeg', kinds, today: '2026-11-27', tenantId: 't1', purpose: 'x' })) === null);
  configured = true; aiReply = { ok: true, text: '{"vendor":"Supply House","date":"2026-03-14","total":84.2,"tax":5.2,"kind":"Supplies"}' };

  console.log('Books: Snap a receipt');
  const { POST: READ } = await import('../../src/app/api/money/receipt-read/route');
  const rq = (body: any) => ({ json: async () => ({ tenantId: 't1', ...body }), headers: { get: () => null } }) as any;
  let res: any = await READ(rq({ url: fsUrl('tenants/t1/uploads/1764_ab12cd.jpg') }));
  check('a photo in the business’s own uploads: read', res.status === 200 && res.body.reading?.total === 84.2 && res.body.reading?.kind === 'Supplies' && asked[asked.length - 1].purpose === 'receipt_read', res.body);
  res = await READ(rq({ url: fsUrl('tenants/t2/uploads/1764_ab12cd.jpg') }));
  const res2: any = await READ(rq({ url: 'https://evil.example/x.jpg' }));
  const res3: any = await READ(rq({ url: fsUrl('tenants/t1/uploads/1764_ab12cd.jpg', 'someone-else.appspot.com') }));
  check('another business’s photo, anywhere else or another bucket: refused', res.status === 400 && res2.status === 400 && res3.status === 400);
  photo = { type: 'text/html', bytes: 100 }; res = await READ(rq({ url: fsUrl('tenants/t1/uploads/1764_ab12cd.jpg') }));
  photo = { type: 'image/jpeg', bytes: 9 * 1024 * 1024 }; const big: any = await READ(rq({ url: fsUrl('tenants/t1/uploads/1764_ab12cd.jpg') }));
  lengthHeader = false; const noLen: any = await READ(rq({ url: fsUrl('tenants/t1/uploads/1764_ab12cd.jpg') })); lengthHeader = true;
  check('not a picture, or too big (said or not): nothing read, the form filled by hand', res.body.reading === null && big.body.reading === null && noLen.body.reading === null);
  check('the photo fetched with no redirects and a time limit', fetched.every((f) => f.redirect === 'error' && !!f.signal));
  photo = { type: 'image/jpeg', bytes: 2000 };
  const today = new Date().toISOString().slice(0, 10);
  await db.doc('tenants/t1/private/receiptReads').set({ day: '2000-01-01', total: 9999, by: {} });
  res = await READ(rq({ url: fsUrl('tenants/t1/uploads/1764_ab12cd.jpg') }));
  check('a day’s count starts again each day', res.body.reading?.total === 84.2);
  const { READS_A_DAY } = await import('../../src/lib/receipt-read');
  const day: any = (await db.doc('tenants/t1/private/receiptReads').get()).data();
  await db.doc('tenants/t1/private/receiptReads').set({ ...day, by: { ...day.by, team_u1: READS_A_DAY.person } });
  const { takeReceiptRead } = await import('../../src/lib/receipt-read');
  const t0 = day.day; await db.doc('tenants/t9/private/receiptReads').set({ day: t0, pools: { renters: READS_A_DAY.business }, by: {} });
  check('renters never use up the team’s readings', (await takeReceiptRead(db, 't9', 'team_x', t0, 'team')) === true && (await takeReceiptRead(db, 't9', 'renter_y', t0, 'renters')) === false);
  const n0 = asked.length; res = await READ(rq({ url: fsUrl('tenants/t1/uploads/1764_ab12cd.jpg') }));
  check('a person’s readings for the day used up: none read, the form by hand', res.body.reading === null && res.body.capped === true && asked.length === n0);
  await db.doc('tenants/t1/private/receiptReads').set({ day: day.day, pools: { team: READS_A_DAY.business }, by: {} });
  res = await READ(rq({ url: fsUrl('tenants/t1/uploads/1764_ab12cd.jpg') }));
  check('the business’s for the day used up: the same', res.body.reading === null && res.body.capped === true && asked.length === n0);
  await db.doc('tenants/t1/private/receiptReads').set({ day: '2000-01-01', total: 0, by: {} }); void today;
  deny = true; res = await READ(rq({ url: fsUrl('tenants/t1/uploads/1764_ab12cd.jpg') })); deny = false;
  check('only for those who keep the books', res.status === 403);
  check('nothing saved by reading', (await db.collection('tenants/t1/transactions').get()).docs.length === 0);

  console.log('A renter’s Add a cost');
  await db.doc('tenants/t1').set({ name: 'North Loft', timezone: 'America/New_York' });
  await db.doc('tenants/t1/private/renterSessions').set({ [sha('tok-ana')]: { renterId: 'r1', name: 'Ana', expiresAt: Date.now() + 3600e3 } });
  const { POST } = await import('../../src/app/api/portal/renter-writeoffs/route');
  const pq = (body: any) => ({ json: async () => ({ tenantId: 't1', token: 'tok-ana', ...body }), headers: { get: () => null } }) as any;
  res = await POST(pq({ action: 'receipt', photoData: `data:image/jpeg;base64,${bytes.toString('base64')}` }));
  const first = res.body.url;
  check('their photo kept in a folder of their own no browser opens, and read with their kinds', res.status === 200 && /renterReceipts%2Fr1%2F/.test(res.body.url) && uploads[uploads.length - 1].sub === 'renterReceipts/r1' && res.body.reading?.kind === 'Supplies'
    && /'renters', 'leases'/.test(src('storage.rules')) && !/renterReceipts/.test(src('storage.rules'))
    && asked[asked.length - 1].purpose === 'renter_receipt_read' && /"Licenses and fees"/.test(asked[asked.length - 1].system), res.body);
  res = await POST(pq({ action: 'receipt', photoData: 'not a photo' }));
  check('not a photo: refused', res.status === 400);
  res = await POST(pq({ action: 'receipt', photoData: `data:image/jpeg;base64,${bytes.toString('base64')}`, replaces: first }));
  check('taken again: the first photo, used by nothing, removed', res.status === 200 && dropped.includes('tenants/t1/renterReceipts/r1/1764000000000-ab12cd.jpg'));
  dropped.length = 0;
  res = await POST(pq({ action: 'drop', url: fsUrl('tenants/t1/renterReceipts/r2/1764000000000-ab12cd.jpg') }));
  check('another renter’s photo is never removed', res.status === 200 && dropped.length === 0);
  res = await POST(pq({ action: 'add', date: '2026-03-14', amount: '84.20', kind: 'Meals', note: 'Dana, rep: spring order', receiptUrl: fsUrl('tenants/t1/renterReceipts/r2/1764000000000-ab12cd.jpg') }));
  const res4: any = await POST(pq({ action: 'add', date: '2026-03-14', amount: '84.20', kind: 'Meals', note: 'Dana, rep: spring order', receiptUrl: fsUrl('tenants/t1/uploads/1764000000000-ab12cd.jpg') }));
  check('a photo from another renter’s folder or the business’s uploads: refused', res.status === 400 && res4.status === 400);
  res = await POST(pq({ action: 'add', date: '2026-03-14', amount: '84.20', kind: 'Meals', note: 'Dana, rep: spring order', receiptUrl: fsUrl('tenants/t1/renterReceipts/r1/1764000000000-ab12cd.jpg') }));
  const kept: any = (await db.collection('tenants/t1/renterExpenses').get()).docs.map((d: any) => d.data());
  check('their own photo kept with the cost', res.status === 200 && kept.length === 1 && /renterReceipts%2Fr1%2F/.test(kept[0].receiptUrl));
  res = await POST(pq({ action: 'drop', url: kept[0].receiptUrl }));
  check('a photo a saved cost uses is never removed', dropped.length === 0);
  res = await POST(pq({ action: 'list', year: 2026 }));
  check('listed again with the cost, to open', res.body.photos?.length === 1 && res.body.photos[0].url === kept[0].receiptUrl && res.body.photos[0].kind === 'Meals', res.body.photos);
  const { renterWriteOffsHtml } = await import('../../src/lib/renter-write-offs');
  const ph = renterWriteOffsHtml({ ...res.body, photos: [...res.body.photos, { id: 'z', day: '2026-01-02', kind: 'Supplies', cents: 100, note: '<b>', url: 'javascript:alert(1)' }] });
  check('printed for the accountant with each photo’s link; nothing but a storage link, everything escaped', /Receipts kept as photos/.test(ph) && ph.includes(`href="${kept[0].receiptUrl.replace(/&/g, '&amp;')}"`) && !/javascript:/.test(ph) && /&lt;b&gt;/.test(ph));
  const { renterFound } = await import('../../src/lib/renter-write-offs');
  const f = renterFound([{ id: 'a', renterId: 'r1', date: '2026-03-14', cents: 8420, category: 'Meals', note: 'x y z', receiptUrl: 'u' }, { id: 'b', renterId: 'r1', date: '2026-03-15', cents: 9000, category: 'Travel', note: '' }], 2026);
  check('a receipt kept as a photo isn’t asked for again', f.receipts === 1);

  console.log('On the screens');
  const dlg = src('src/components/ledger/AddTransactionDialog.tsx'); const books = src('src/components/money/BooksScreen.tsx'); const page = src('src/app/(app)/money/page.tsx'); const rwo = src('src/components/rent/RenterWriteOffs.tsx');
  check('Books: Snap a receipt, the photo first, read once uploaded', /onSnap && <button type="button" onClick=\{p\.onSnap\}/.test(books) && /onSnap=\{\(\) => \{ setSnapOpen\(true\); setIsAddTxnOpen\(true\); \}\}/.test(page)
    && /snap=\{snapOpen\} readReceipt=\{readReceipt\}/.test(page) && /\{snap && receiptField\}/.test(dlg) && /'\/api\/money\/receipt-read'/.test(page));
  check('only boxes still empty are filled, and it says to check them', /k === 'amount' && !\(Number\(v\) > 0\)/.test(dlg) && /!dirtyFields\.date/.test(dlg) && /r\.kind && !customCategory && free\('category'\)/.test(dlg) && /Check each box before you add it/.test(dlg));
  check('the renter’s form: filled where empty or filled by the last reading; a meal’s or a gift’s note theirs to write; the photo saved with it', /x\.vendor && kNow !== 'Meals' && kNow !== 'Gifts'/.test(rwo) && /setAmount\(\(a\) => \(!a \|\| a === f\.amount/.test(rwo) && /\.\.\.\(photo \? \{ receiptUrl: photo \} : \{\}\)/.test(rwo)
    && /action: 'receipt', photoData, \.\.\.\(replaces \? \{ replaces \} : \{\}\)/.test(rwo));
  check('the renter’s form: only the latest photo’s reading; the kind only while it’s the plain one they opened with; Cancel removes the photo', /if \(mine !== seq\.current\) return;/.test(rwo) && /!kindTouched\.current && kind0 === 'Supplies'/.test(rwo) && /if \(r\?\.ok && r\.url && onDrop\) onDrop\(r\.url\)/.test(rwo)
    && /dropReceiptPhoto\(String\(cur\.receiptUrl\)\)/.test(src('src/app/api/portal/renter/route.ts')) && /if \(photo && onDrop\) onDrop\(photo\)/.test(rwo));
  check('the owner’s form: only for the photo still on it; an earlier reading’s boxes replaced, never what was typed; kept as a JPEG', /if \(getValues\('receiptUrl'\) !== url\) return;/.test(dlg) && /v === was\[k\]/.test(dlg) && / asJpeg \/>/.test(dlg) && /asJpeg \? canvas\.toDataURL\('image\/jpeg', 0\.85\)/.test(src('src/components/shared/ImageUpload.tsx')));
  check('the renter’s receipts kept, each to open', /See the receipt/.test(rwo) && /rel="noopener noreferrer"/.test(rwo));
  check('the house style', ![dlg, rwo].some((s) => /uppercase|font-black| · /.test(s)) && !/font-bold/.test(rwo) && ![...rwo.matchAll(/>([^<>{}\n]*)</g), ...dlg.matchAll(/>([^<>{}\n]*)</g)].some((m) => m[1].includes("'")));

  console.log(F.failures ? `\n${F.failures} failed` : '\nAll passed');
  process.exit(F.failures ? 1 : 0);
})();
