// Checks products sold to licensed pros only and licenses on file (lib/pro-license, api/retail/pro-license,
// api/retail/pro-licenses, the rule in api/retail/checkout).
// - The license form: checked again on the server, a photo required, a past expiry refused, one address only, a
//   script's hidden field answered as sent and nothing kept, one sent with no time (or too fast) refused, a shop without
//   the shop tool refused, a shop with a pile waiting takes no new ones (one sent again still goes through); one per
//   email; the managers hear about it.
// - Renewals: one sent while a license is good waits beside it, and the one on file keeps working until a manager
//   approves the new one (declined, it stays as it was); sent again while waiting, it keeps what it renews.
// - The team: anyone sees who has one (the copy to managers only), those waiting first; a manager approves (with an
//   expiry not past, a sign-in link in the email), declines (with a reason they're told), or takes one off, and only the
//   very one they looked at; the customer gets an email; a renter can't see them.
// - The register's check: valid, expired, waiting, none.
// - Checkout: a pros-only product (or one of its variants) needs the email proven theirs (a sign-in link) before the
//   license is even looked at, then a license good today; refused before anything is charged, with what's missing, the
//   same answer whatever's on file; with one, the order keeps the license it was sold on; a wholesale buyer needs one
//   too; an order without one sells as before. Swaps: a pros-only replacement only on an order sold on a license.
// - The rules: licenses aren't readable or writable from the browser.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/pro-license.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const sent: any[] = []; const uploads: any[] = []; const audits: any[] = [];
function StripeMock(this: any) { return { coupons: { create: async () => ({ id: 'co_1' }) }, checkout: { sessions: { create: async () => ({ id: 'cs_x', url: 'https://stripe.test/x' }) } }, paymentIntents: { create: async () => ({ id: 'pi_1', client_secret: 'pi_1_secret' }) } }; }
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_d: any, t: string, e: any) => { audits.push({ t, ...e }); }, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_d: any, m: any) => { sent.push(m); return { ok: true }; } });
  if (request === '@/lib/email-shell' || /\/src\/lib\/email-shell(\.ts)?$/.test(request)) return fake(request, { getEmailBrand: async () => ({ shopName: 'Polished Supply' }), brandedEmail: (_b: any, h: string) => h });
  if (request === '@/lib/claim-photo-upload' || /\/src\/lib\/claim-photo-upload(\.ts)?$/.test(request)) return fake(request, { uploadClaimPhotoFromDataUrl: async (t: string, id: string, data: any, folder: string) => { uploads.push({ t, id, folder }); return /^data:image\//.test(String(data)) ? { url: `https://firebasestorage.googleapis.com/v0/b/x/o/tenants%2F${t}%2F${folder}%2Fl.jpg?alt=media&token=z` } : { url: null, error: 'Use a JPG, PNG, or WebP photo.' }; } });
  if (request === '@/lib/loyalty-server' || /loyalty-server(\.ts)?$/.test(request)) return fake(request, { earnForShopOrder: async () => undefined });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any, q: Record<string, string> = {}) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams(q) } }) as any;
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

(async () => {
  const L = await import('../../src/lib/pro-license');
  const { GET: PUB_GET, POST: PUB } = await import('../../src/app/api/retail/pro-license/route');
  const { POST: TEAM } = await import('../../src/app/api/retail/pro-licenses/route');
  const { POST: CHECKOUT } = await import('../../src/app/api/retail/checkout/route');
  const { signProvenAccountToken, signAccountToken } = await import('../../src/lib/retail-account');
  const { offerSwap } = await import('../../src/lib/retail-swap-server');
  const proven = (e: string) => { const x = Date.now() + 864e5; return { e, x, s: signProvenAccountToken('t1', e, x) }; };

  console.log('the rules');
  const today = future(0);
  check('a real calendar day only', L.realDay('2027-02-28') === '2027-02-28' && L.realDay('2027-02-30') === null && L.realDay('2027-2-3') === null && L.realDay(null) === null);
  check('good to sell on: approved and not expired (the last day counts)', L.licenseValid({ status: 'approved', expiresOn: today }, today) && !L.licenseValid({ status: 'approved', expiresOn: future(-1) }, today)
    && !L.licenseValid({ status: 'waiting', expiresOn: future(90) }, today) && !L.licenseValid({ status: 'approved' }, today) && !L.licenseValid(null, today));
  check('one id per email, whatever its case or spaces, and never the email itself', L.licenseId(' Kim@Example.com ') === L.licenseId('kim@example.com') && /^[a-f0-9]{32}$/.test(L.licenseId('kim@example.com')) && L.licenseId('a@b.co') !== L.licenseId('b@b.co'));
  const form = (x: any = {}) => L.checkLicenseForm({ name: 'Kim Lee', email: 'Kim@Example.com', number: 'NT-204551', state: 'tx', expiresOn: future(400), ...x }, today);
  const f0: any = form();
  check('the form: a name, an email, the number as printed, a state, a real expiry not past', f0.ok && f0.fields.email === 'kim@example.com' && f0.fields.state === 'TX'
    && !form({ name: '' }).ok && !form({ email: 'kim' }).ok && !form({ email: 'kim@example.com,eve@example.com' }).ok && !form({ email: 'a;b@example.com' }).ok && !form({ email: '<kim@example.com>' }).ok && !form({ number: 'x' }).ok && !form({ number: '<script>' }).ok && !form({ state: 'ZZ' }).ok && !form({ expiresOn: '2027-13-01' }).ok && !form({ expiresOn: future(-2) }).ok);

  console.log('sending one');
  await db.doc(T).set({ name: 'Polished Supply', timezone: 'UTC', userId: 'owner1', retailSettings: { taxRatePercent: 8 }, stripeAccountId: 'acct_1' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', isManager: true });
  await db.doc(`${T}/staff/s1`).set({ name: 'Sam', role: 'staff' });
  let r: any = await PUB_GET(req({}, { tenantId: 't1' }));
  check('the page asks whether the shop takes licenses', r.status === 200 && r.body.open === true && r.body.shopName === 'Polished Supply', r.body);
  const base = { tenantId: 't1', name: 'Kim Lee', email: 'kim@example.com', number: 'NT-204551', state: 'TX', expiresOn: future(400), ms: 9000 };
  const { ms: _ms, ...noTime } = base; void _ms;
  const refused: any[] = await Promise.all([PUB(req({ ...base })), PUB(req({ ...base, file: PHOTO, expiresOn: future(-1) })), PUB(req({ ...base, file: PHOTO, ms: 900 })), PUB(req({ ...base, file: 'data:text/html;base64,PGI+' })),
    PUB(req({ ...noTime, file: PHOTO })), PUB(req({ ...base, file: PHOTO, ms: 'soon' }))]);
  check('refused: no photo, an expired license, sent too fast, a file that isn’t a photo, no time sent at all (or not a number); nothing kept',
    refused[0].status === 400 && /photo/.test(refused[0].body.error) && refused[1].status === 400 && refused[2].status === 400 && refused[3].status === 422 && refused[4].status === 400 && refused[5].status === 400 && (await db.collection(`${T}/proLicenses`).get())!.size === 0, refused.map((x: any) => [x.status, x.body.error]));
  r = await PUB(req({ ...base, file: PHOTO, hp: 'bot' }));
  check('a script’s hidden field: answered as sent, nothing kept', r.status === 200 && (await db.collection(`${T}/proLicenses`).get()).size === 0);
  r = await PUB(req({ ...base, email: 'Kim@Example.com', file: PHOTO, fileName: 'lic<x>.jpg' }));
  const id = L.licenseId('kim@example.com');
  const doc0 = await get(`${T}/proLicenses/${id}`);
  const notes = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());
  check('sent: kept waiting under its email’s own id, the copy saved in the shop’s own license folder', r.status === 200 && doc0?.status === 'waiting' && doc0.email === 'kim@example.com' && /pro-licenses/.test(doc0.fileUrl) && doc0.fileName === 'licx.jpg' && uploads.some((u) => u.folder === 'pro-licenses'), doc0);
  check('…each manager hears about it (not the rest of the team)', notes.length === 1 && notes[0].userId === 'm1' && notes[0].link === '/retail-orders/licenses' && /Kim Lee/.test(notes[0].message), notes);
  await db.doc('tenants/t9').set({ name: 'No Shop', modules: { retail: false } });
  r = await PUB(req({ ...base, tenantId: 't9', file: PHOTO }));
  check('a business without the shop takes none', r.status === 403);
  await db.doc('tenants/t2').set({ name: 'Busy Supply', timezone: 'UTC', userId: 'owner2' });
  for (let i = 0; i < 200; i++) await db.doc(`tenants/t2/proLicenses/${L.licenseId(`p${i}@example.com`)}`).set({ email: `p${i}@example.com`, status: 'waiting', toCheck: true, sentAt: '2026-01-01T00:00:00.000Z' });
  const full: any = await PUB(req({ ...base, tenantId: 't2', email: 'new@example.com', file: PHOTO }));
  const again: any = await PUB(req({ ...base, tenantId: 't2', email: 'p7@example.com', file: PHOTO }));
  check('a shop with 200 waiting takes no new ones, but one sent again by an email already waiting goes through (it replaces its own)', full.status === 429 && !(await get(`tenants/t2/proLicenses/${L.licenseId('new@example.com')}`)) && again.status === 200 && (await get(`tenants/t2/proLicenses/${L.licenseId('p7@example.com')}`)).number === 'NT-204551', [full.body, again.body]);

  console.log('the team');
  const at = async () => { const l: any = await get(`${T}/proLicenses/${id}`); return String((l.pending || l).sentAt || ''); };
  r = await TEAM(req({ tenantId: 't1', action: 'list' }));
  check('a manager sees it with its copy', r.status === 200 && r.body.licenses.length === 1 && r.body.licenses[0].status === 'waiting' && /pro-licenses/.test(r.body.licenses[0].fileUrl) && r.body.canDecide === true, r.body);
  actor = { uid: 's1', name: 'Sam', role: 'staff', caps: [] };
  r = await TEAM(req({ tenantId: 't1', action: 'list' }));
  const sd: any = await TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'approve', expiresOn: future(400), sentAt: await at() }));
  check('someone else on the team sees who sent one but not the copy, and can’t decide', r.status === 200 && !('fileUrl' in r.body.licenses[0]) && r.body.licenses[0].hasFile === true && r.body.canDecide === false && sd.status === 403, [r.body, sd.status]);
  actor = { uid: 'r1', name: 'Rae', role: 'staff', isRenter: true, caps: [] };
  r = await TEAM(req({ tenantId: 't1', action: 'list' }));
  check('a renter can’t see them', r.status === 403);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  const chk = async (email: string) => (await TEAM(req({ tenantId: 't1', action: 'check', email }))).body.state;
  check('the register’s check: waiting, and none for an email with nothing on file', (await chk('KIM@example.com')) === 'waiting' && (await chk('nobody@example.com')) === 'none');
  const s0 = await at();
  const bad: any[] = await Promise.all([TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'approve', expiresOn: future(-3), sentAt: s0 })), TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'decline', sentAt: s0 })),
    TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'revoke' })), TEAM(req({ tenantId: 't1', action: 'decide', id: 'nope', decision: 'approve', expiresOn: future(9), sentAt: s0 })), TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'maybe' })),
    TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'approve', expiresOn: future(9) })), TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'approve', expiresOn: future(9), sentAt: '2020-01-01T00:00:00.000Z' }))]);
  check('refused: approving with a past expiry, declining without a reason, taking off one not approved, an unknown one, an unknown decision, without saying which one was looked at, and one sent again since it was looked at (409)',
    bad.every((x: any) => x.status >= 400) && bad[6].status === 409 && (await get(`${T}/proLicenses/${id}`)).status === 'waiting', bad.map((x: any) => [x.status, x.body.error]));
  sent.length = 0;
  r = await TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'decline', note: 'The photo is too blurry to read', sentAt: s0 }));
  check('declined with a reason: they’re emailed it, with where to send it again', r.status === 200 && (await get(`${T}/proLicenses/${id}`)).status === 'declined' && sent.length === 1 && sent[0].to === 'kim@example.com' && /too blurry to read\. You can send it again here: https:\/\/[^ ]*\/shop\/t1\/pro/.test(sent[0].text), sent);
  r = await TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'approve', expiresOn: future(300), sentAt: s0 }));
  const signLink = /Open this link in the browser you shop with to sign in: https:\/\/app\.test\/shop\/t1\/account\?e=kim%40example\.com&x=\d+&s=[a-f0-9]{64}$/.test(sent[1]?.text || '');
  check('approved with the expiry read off it: they’re emailed (with a sign-in link, how they order these), and it’s good today', r.status === 200 && r.body.license.valid === true && (await get(`${T}/proLicenses/${id}`)).expiresOn === future(300) && /until/.test(sent[1]?.text || '') && signLink && (await chk('kim@example.com')) === 'valid', [r.body, sent[1]]);
  check('…each decision in the team’s log', audits.filter((a) => /^pro_license\./.test(a.action)).map((a) => a.action).join() === 'pro_license.decline,pro_license.approve', audits);
  r = await TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'approve', expiresOn: future(500), sentAt: s0 }));
  check('…and approving it again is refused (nothing waiting)', r.status === 409);

  console.log('renewals');
  const nBefore = (await db.collection(`${T}/notifications`).get()).size;
  r = await PUB(req({ ...base, number: 'NT-999', file: PHOTO, expiresOn: future(800) }));
  let lic: any = await get(`${T}/proLicenses/${id}`);
  const n2 = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data()).slice(nBefore);
  check('sent while the one on file is good: it waits beside it, and the one on file keeps working (the register still sees valid)',
    r.status === 200 && lic.status === 'approved' && lic.number === 'NT-204551' && lic.expiresOn === future(300) && lic.pending?.number === 'NT-999' && lic.toCheck === true && /pro-licenses/.test(lic.pending.fileUrl) && (await chk('kim@example.com')) === 'valid', lic);
  check('…the managers hear it’s a renewal', n2.length === 1 && /renewed license/.test(n2[0].message), n2);
  r = await TEAM(req({ tenantId: 't1', action: 'list' }));
  const row = r.body.licenses.find((x: any) => x.id === id);
  check('…the team’s list shows it to check, with what was sent beside what’s on file', row?.toCheck === true && row.pending?.number === 'NT-999' && row.number === 'NT-204551' && /pro-licenses/.test(row.pending.fileUrl), row);
  r = await TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'approve', expiresOn: future(800), sentAt: s0 }));
  check('…approving with the one on file’s time (not the renewal they sent) is refused: look again', r.status === 409 && (await get(`${T}/proLicenses/${id}`)).pending?.number === 'NT-999', r.body);
  sent.length = 0;
  r = await TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'decline', note: 'The number doesn’t match the state’s lookup', sentAt: await at() }));
  lic = await get(`${T}/proLicenses/${id}`);
  check('declining the renewal leaves the one on file as it was; they’re told it’s still good', r.status === 200 && lic.status === 'approved' && lic.number === 'NT-204551' && !lic.pending && lic.toCheck === false && (await chk('kim@example.com')) === 'valid'
    && /still good until/.test(sent[0]?.text || '') && /doesn’t match the state’s lookup\./.test(sent[0]?.text || ''), [lic, sent[0]]);
  await PUB(req({ ...base, number: 'NT-999', file: PHOTO, expiresOn: future(800) }));
  r = await TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'approve', expiresOn: future(800), sentAt: await at() }));
  lic = await get(`${T}/proLicenses/${id}`);
  check('approving the renewal: it takes the place of the one on file, which is kept as what it renewed', r.status === 200 && lic.status === 'approved' && lic.number === 'NT-999' && lic.expiresOn === future(800) && lic.renewalOf?.number === 'NT-204551' && !lic.pending && lic.toCheck === false && /pro-licenses/.test(lic.fileUrl), lic);
  r = await TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'revoke', note: 'License suspended' }));
  check('an approved one can be taken off (they’re told); then it’s no longer valid', r.status === 200 && (await chk('kim@example.com')) === 'declined' && /no longer on file: License suspended\./.test(sent[sent.length - 1].text), sent[sent.length - 1]);
  await db.doc(`${T}/proLicenses/${id}`).set({ status: 'approved', expiresOn: future(-1) }, { merge: true });
  check('…and one past its date reads expired', (await chk('kim@example.com')) === 'expired');
  await PUB(req({ ...base, number: 'NT-1200', file: PHOTO, expiresOn: future(900) }));
  await PUB(req({ ...base, number: 'NT-1201', file: PHOTO, expiresOn: future(900) }));
  lic = await get(`${T}/proLicenses/${id}`);
  check('one past its date, sent anew (twice before anyone looks): waiting, still marked a renewal of the one before', lic.status === 'waiting' && lic.number === 'NT-1201' && lic.renewalOf?.number === 'NT-999' && (await chk('kim@example.com')) === 'waiting', lic);
  await db.doc(`${T}/proLicenses/${id}`).set({ status: 'approved', number: 'NT-999', expiresOn: future(60), pending: null, toCheck: false }, { merge: true });
  await PUB(req({ ...base, number: 'NT-1300', file: PHOTO, expiresOn: future(900) }));
  await TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'revoke', note: 'Suspended by the state' }));
  sent.length = 0;
  r = await TEAM(req({ tenantId: 't1', action: 'decide', id, decision: 'decline', note: 'The photo is cut off', sentAt: await at() }));
  lic = await get(`${T}/proLicenses/${id}`);
  check('a renewal declined after the one on file was taken off: the email doesn’t say the old one is still good', r.status === 200 && lic.status === 'revoked' && !lic.pending && lic.toCheck === false && !/still good/.test(sent[0]?.text || '') && /cut off\. You can send it again here/.test(sent[0]?.text || ''), [lic, sent[0]]);
  await db.doc(`${T}/proLicenses/${id}`).set({ status: 'approved', number: 'NT-999', expiresOn: future(-1), renewalOf: null }, { merge: true });

  console.log('checkout');
  await db.doc(`${T}/inventory/mono`).set({ type: 'retail', name: 'Monomer', msrp: 24.99, totalStock: 10, showOnline: true, status: 'active', prosOnly: true });
  await db.doc(`${T}/inventory/gel`).set({ type: 'retail', name: 'Gel color', msrp: 12.5, totalStock: 0, showOnline: true, status: 'active', optionGroups: [{ id: 'g', name: 'Color', choices: [{ id: 'b', label: 'Berry', deltaCents: 0, variantProductId: 'gel-b' }] }] });
  await db.doc(`${T}/inventory/gel-b`).set({ type: 'retail', name: 'Gel · Berry', msrp: 12.5, totalStock: 6, status: 'active', parentId: 'gel', prosOnly: true });
  await db.doc(`${T}/inventory/cot`).set({ type: 'retail', name: 'Cotton', msrp: 4.49, totalStock: 10, showOnline: true, status: 'active' });
  const orders = async () => (await db.collection(`${T}/retailOrders`).get()).docs.map((d: any) => d.data());
  const buy = (email: string, items: any[], x: any = {}) => CHECKOUT(req({ tenantId: 't1', items, method: 'counter', customer: { name: 'Kim Lee', email }, accountSession: proven(email.toLowerCase()), checkoutKey: `key-${Math.random().toString(36).slice(2, 18).padEnd(16, 'x')}`, ...x }));
  r = await buy('kim@example.com', [{ productId: 'mono', qty: 1 }]);
  const r2: any = await buy('stranger@example.com', [{ productId: 'mono', qty: 1 }]);
  check('a pros-only product with a license past its date: refused before anything’s charged, with where to send one; the same answer for an email with nothing on file (it says nothing about anyone)',
    r.status === 422 && r.body.needsLicense === true && r.body.licenseUrl === '/shop/t1/pro' && /Monomer is for licensed pros/.test(r.body.error) && r2.status === 422 && r2.body.error.replace('stranger@example.com', 'X') === r.body.error.replace('kim@example.com', 'X') && (await orders()).length === 0, [r.body, r2.body]);
  r = await buy('kim@example.com', [{ productId: 'gel', qty: 1, selections: { g: 'b' } }]);
  check('…the same for a variant set Pros only on its own', r.status === 422 && r.body.needsLicense === true, r.body);
  r = await buy('kim@example.com', [{ productId: 'cot', qty: 2 }]);
  check('an order without a pros-only product sells as before', r.status === 200 && !r.body.needsLicense, r.body);
  await db.doc(`${T}/proLicenses/${id}`).set({ status: 'approved', expiresOn: future(30) }, { merge: true });
  const plain = (e: string) => { const x = Date.now() + 864e5; return { e, x, s: signAccountToken('t1', e, x) }; };
  const unproven: any[] = await Promise.all([buy('kim@example.com', [{ productId: 'mono', qty: 1 }], { accountSession: undefined }), buy('stranger@example.com', [{ productId: 'mono', qty: 1 }], { accountSession: undefined }),
    buy('kim@example.com', [{ productId: 'mono', qty: 1 }], { accountSession: proven('eve@example.com') }), buy('kim@example.com', [{ productId: 'mono', qty: 1 }], { accountSession: plain('kim@example.com') })]);
  check('with a license good today but the email not proven theirs (no session, someone else’s, or one from an order’s pass): asked to sign in first, nothing looked up, the same answer as an email with nothing on file, nothing charged',
    unproven.every((x: any) => x.status === 422 && x.body.needsSignIn === true && x.body.needsLicense === true) && unproven[0].body.error.replace('kim@example.com', 'X') === unproven[1].body.error.replace('stranger@example.com', 'X') && (await orders()).every((o: any) => !(o.lines || []).some((l: any) => l.productId === 'mono')), unproven.map((x: any) => [x.status, x.body.error]));
  await db.doc(`${T}/wholesaleAccounts/b1`).set({ businessName: 'Glow Nails', email: 'buyer@glow.com', accessCode: 'WS-GLOW-0001', status: 'active', extraDiscountPercent: 0 });
  await db.doc(`${T}/inventory/mono`).set({ wholesalePriceDollars: 15 }, { merge: true });
  r = await buy('buyer@glow.com', [{ productId: 'mono', qty: 1 }], { priceTier: 'wholesale', wholesaleCode: 'WS-GLOW-0001' });
  check('a wholesale buyer needs a license on file too (a resale certificate isn’t one)', r.status === 422 && r.body.needsLicense === true && !r.body.needsSignIn, r.body);
  r = await buy('KIM@example.com', [{ productId: 'mono', qty: 1 }]);
  const withLic = (await orders()).find((o: any) => (o.lines || []).some((l: any) => l.productId === 'mono'));
  check('with a license good today (the email in any case): sold, and the order keeps the license it was sold on, each such line marked',
    r.status === 200 && withLic?.proLicense?.number === 'NT-999' && withLic.proLicense.state === 'TX' && withLic.lines.find((l: any) => l.productId === 'mono')?.prosOnly === true, [r.body, withLic?.proLicense]);

  console.log('swaps');
  const cotOrder = (await orders()).find((o: any) => (o.lines || []).some((l: any) => l.productId === 'cot'));
  await db.doc(`${T}/retailOrders/${cotOrder.id}`).set({ stage: 'paid' }, { merge: true });
  const sw: any = await offerSwap(db, 't1', cotOrder.id, cotOrder.lines[0].lineId, 'mono', { id: 'm1', name: 'Ana' }, 'https://app.test');
  const sw2: any = await offerSwap(db, 't1', cotOrder.id, cotOrder.lines[0].lineId, 'gel-b', { id: 'm1', name: 'Ana' }, 'https://app.test');
  const after = await get(`${T}/retailOrders/${cotOrder.id}`);
  check('a pros-only replacement (or a variant of one) isn’t offered on an order sold without a license', !sw.ok && /licensed pros/.test(sw.message) && !sw2.ok && !after.swapOffer && after.lines[0].productId === 'cot', [sw, sw2]);

  console.log('the rules');
  const rules = require('fs').readFileSync('firestore.rules', 'utf8');
  const listed = (rules.match(/match \/tenants\/\{tenantId\}\/\{collection\}\/\{rest=\*\*\} \{[\s\S]*?\]\)/) || [''])[0];
  check('licenses aren’t in the team’s catch-all (no explicit rule: the browser can’t read or write them)', /'proLicenses'/.test(listed) && !/match \/tenants\/\{tenantId\}\/proLicenses/.test(rules));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
