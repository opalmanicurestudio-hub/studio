// Checks row 16: wholesale buyers edited in one place, sales tax set per buyer with resale certificates, and a buyer
// apply form on the shop.
//   - tax (lib/wholesale-tax): an order is tax free only with one of the buyer's emails, proven theirs by signing in,
//     in a state they have a current certificate for (pickup where the shop is, shipping where it goes; an address
//     whose state can't be read matches none), not after the certificate ends, and never for downloads only; buyers tax
//     free under the old shop-wide switch stay so until a certificate is added; the house code follows the switch; the
//     shop's checkout works out the same answer without ever being sent the buyer's emails;
//   - buyers (lib/wholesale-server, api/retail/wholesale): managers only; every field is checked on the server; who
//     accepted each certificate is kept, and a certificate taken off stays on file; codes are unique and emailed;
//   - applications (api/retail/wholesale-apply): only when the shop takes them, one waiting per email, a hidden field for
//     scripts, limited per visitor; approving makes the buyer with the certificate they sent and emails the code, once;
//     declining emails them only when asked;
//   - checkout and the books: the order keeps the certificate it was sold under, and tax-free sales are added up.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/wholesale.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let actor: any = { uid: 'm1', name: 'Jessica Marshall', role: 'manager', isManager: true, isTenantOwner: false, caps: [] };
const afterJobs: Promise<any>[] = [];
const sent: any[] = []; const uploads: any[] = []; let limited = false;
function StripeMock(this: any) { return { coupons: { create: async (p: any) => ({ id: `co_${p.amount_off}` }) }, checkout: { sessions: { create: async () => ({ id: 'cs_1', url: 'https://stripe.test/x' }) } } }; }
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === 'stripe' || /node_modules\/stripe\//.test(request)) return fake(request, Object.assign(StripeMock, { default: StripeMock }));
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'x' }), getApps: () => [], cert: () => ({}) };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminApp: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { __esModule: true, sendNotification: async (_db: any, m: any) => { sent.push(m); return { ok: true, status: 'sent' }; } });
  if (request === '@/lib/claim-photo-upload' || /\/src\/lib\/claim-photo-upload(\.ts)?$/.test(request)) return fake(request, { uploadClaimPhotoFromDataUrl: async (t: string, id: string, data: any, folder: string) => { uploads.push({ t, id, folder }); return /^data:/.test(String(data)) ? { url: `https://firebasestorage.googleapis.com/v0/b/x/o/${encodeURIComponent(`tenants/${t}/${folder}/${id}/f.pdf`)}?alt=media&token=k` } : { url: null, error: 'Use a photo (JPG, PNG or WebP) or a PDF.' }; } });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => (limited ? { status: 429, body: { ok: false, error: 'Too many tries from here' } } : null), visitorIp: () => '1.2.3.4' });
  return load.call(this, request, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((x: any) => !String(x.id).startsWith('slot_'));
const req = (body: any, url = 'https://app.example/api') => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: new URL(url) }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const CERT_URL = `https://firebasestorage.googleapis.com/v0/b/x/o/${encodeURIComponent('tenants/t1/wholesale-certs/a1/f.pdf')}?alt=media&token=k`;
const CERT_URL2 = CERT_URL.replace('f.pdf', 'g.pdf');
const fresh = async (rs: any = {}) => {
  db = strictTransactions(makeDb()); sent.length = 0; uploads.length = 0; limited = false;
  await db.doc(T).set({ name: 'Opal Studio', businessName: 'Opal Studio', stripeAccountId: 'acct_1', address: { state: 'TX' }, retailSettings: { taxRatePercent: 8, ...rs } });
  await db.doc(`${T}/staff/o1`).set({ name: 'Jessica Marshall', role: 'owner' });
  await db.doc(`${T}/staff/m2`).set({ name: 'Dee Lane', role: 'manager' });
  await db.doc(`${T}/staff/s3`).set({ name: 'Kai Park', role: 'staff' });
};

(async () => {
  const X = await import('../../src/lib/wholesale-tax');
  const W = await import('../../src/lib/wholesale-server');
  const today = '2026-10-31';

  console.log('when a wholesale order is tax free');
  const glow = { businessName: 'Glow Studio', email: 'maya@glowstudio.com', taxEmails: ['front@glowstudio.com'], tax: 'exempt', certs: [{ id: 'c1', state: 'TX', number: '12-3456789-0', endsOn: null }] };
  const tf = (account: any, email: string, taxState: string | null, rs: any = {}, d = today, proven = true) => X.taxFreeFor({ account, rs, email, proven, taxState, today: d });
  check('their email, in Texas, with a Texas certificate: tax free, under that certificate', tf(glow, 'maya@glowstudio.com', 'TX').free && tf(glow, 'Maya@GlowStudio.com', 'TX').cert?.number === '12-3456789-0');
  check('…a staff email the shop added works too', tf(glow, 'front@glowstudio.com', 'TX').free);
  check('…someone else using their code pays tax, and is told nothing about the certificate', tf(glow, 'friend@gmail.com', 'TX').why === 'email' && !tf(glow, 'friend@gmail.com', 'TX').states);
  check('…their email typed but not signed in: tax, asked to sign in, and nothing said about their list or certificates', tf(glow, 'maya@glowstudio.com', 'TX', {}, today, false).why === 'verify' && tf(glow, 'friend@gmail.com', 'TX', {}, today, false).why === 'verify');
  check('downloads only are never tax free', X.taxFreeFor({ account: glow, rs: {}, email: 'maya@glowstudio.com', proven: true, taxState: 'TX', today, digitalOnly: true }).why === 'digital');
  check('a shipped order whose state can’t be read matches no certificate', tf(glow, 'maya@glowstudio.com', X.taxStateOf('ship', 'Calif.', 'TX')).why === 'state' && tf(glow, 'maya@glowstudio.com', X.taxStateOf('ship', '', 'TX')).why === 'state' && tf(glow, 'maya@glowstudio.com', X.taxStateOf('delivery', 'XX', null)).why === 'state');
  check('…shipped to Oregon, where they have no certificate: tax, and which states they do have', tf(glow, 'maya@glowstudio.com', 'OR').why === 'state' && tf(glow, 'maya@glowstudio.com', 'OR').states?.[0] === 'TX');
  check('…when the shop’s own state isn’t known, a current certificate counts', tf(glow, 'maya@glowstudio.com', null).free);
  const ends = { ...glow, certs: [{ id: 'c1', state: 'TX', number: '12-3', endsOn: '2026-11-12' }] };
  check('a certificate covers its end date, and tax comes back the day after', tf(ends, 'maya@glowstudio.com', 'TX', {}, '2026-11-12').free && tf(ends, 'maya@glowstudio.com', 'TX', {}, '2026-11-13').why === 'ended' && tf(ends, 'maya@glowstudio.com', 'TX', {}, '2026-11-13').endedOn === '2026-11-12');
  const two = { ...glow, certs: [{ id: 'a', state: 'TX', number: '111', endsOn: '2026-10-01' }, { id: 'b', state: 'OK', number: '222', endsOn: null }] };
  check('a state whose certificate ended says it ended, even with another state current', tf(two, 'maya@glowstudio.com', 'TX').why === 'ended' && tf(two, 'maya@glowstudio.com', 'OK').free);
  check('set to pay tax: tax, whatever certificates are on file', tf({ ...glow, tax: 'taxable' }, 'maya@glowstudio.com', 'TX').why === 'taxable');
  check('tax free with no certificate, set up here: tax until one is added', tf({ ...glow, certs: [] }, 'maya@glowstudio.com', 'TX').why === 'no_cert');
  const legacy = { businessName: 'Sunset Spa', email: 'leo@sunsetspa.com' };
  check('a buyer from before, with the old shop-wide switch on: still tax free, with their own email', tf(legacy, 'leo@sunsetspa.com', 'TX', { wholesaleTaxExempt: true }).why === 'legacy' && tf(legacy, 'x@y.com', 'TX', { wholesaleTaxExempt: true }).why === 'email');
  check('…with the switch off they pay tax', tf(legacy, 'leo@sunsetspa.com', 'TX', {}).why === 'taxable');
  check('…once their certificate is added, it decides', tf({ ...legacy, taxFromShopSwitch: true, tax: 'exempt', certs: [{ id: 'c', state: 'OK', number: '999', endsOn: null }] }, 'leo@sunsetspa.com', 'TX').why === 'state');
  check('the house code follows the shop’s switch', tf(null, 'a@b.com', 'TX', { wholesaleTaxExempt: true }).why === 'house' && !tf(null, 'a@b.com', 'TX', {}).free);
  check('pickup is taxed where the shop is, shipping and delivery where it goes', X.taxStateOf('counter', 'OR', 'TX') === 'TX' && X.taxStateOf('ship', 'Oregon', 'TX') === 'OR' && X.taxStateOf('delivery', 'or', 'TX') === 'OR');
  check('a pickup is sold where the shop is: its business address, else its ship-from address', X.shopStateOf({ retailSettings: { shipFrom: { state: 'NC' } }, address: { state: 'TX' } }) === 'TX' && X.shopStateOf({ retailSettings: { shipFrom: { state: 'NC' } } }) === 'NC' && X.shopStateOf({}) === null);
  // The shop's version: no emails and no numbers sent, the same answer every time.
  const info = X.shopTaxInfo(two, {}, 'TX', today, 'maya@glowstudio.com');
  check('the shop is sent no emails and no certificate numbers, only whether the signed-in email is theirs', JSON.stringify(info).indexOf('front@') === -1 && JSON.stringify(info).indexOf('222') === -1 && (info as any).signedIn?.listed === true);
  check('…a signed-in email that isn’t theirs is said to be not on the list', (X.shopTaxInfo(two, {}, 'TX', today, 'x@y.com') as any).signedIn?.listed === false);
  let agree = true;
  for (const acc of [glow, ends, two, { ...glow, tax: 'taxable' }, { ...glow, certs: [] }, legacy]) for (const e of ['maya@glowstudio.com', 'leo@sunsetspa.com', 'x@y.com']) for (const signed of ['same', 'none', 'other']) for (const m of [['counter', ''], ['ship', 'OR'], ['ship', 'OK'], ['ship', 'TX'], ['ship', 'Calif.']]) for (const d of ['2026-10-31', '2026-11-13']) for (const sw of [{}, { wholesaleTaxExempt: true }]) for (const dig of [false, true]) {
    const sess = signed === 'same' ? e : signed === 'other' ? 'someone@else.com' : null;
    const server = X.taxFreeFor({ account: acc, rs: sw, email: e, proven: sess === e, taxState: X.taxStateOf(m[0], m[1], 'TX'), today: d, digitalOnly: dig });
    const shop = X.taxFreeOnShop(X.shopTaxInfo(acc, sw, 'TX', d, sess), e, m[0], m[1], dig);
    if (server.free !== shop.free || server.why !== shop.why || server.endedOn !== shop.endedOn) { agree = false; console.log('    differs', acc.businessName, e, signed, m, d, sw, dig, server, shop); }
  }
  check('…and checkout on the shop reaches the same answer as the server, in every case tried', agree);
  check('moving an order sold under a certificate to another state is caught', X.taxFreeMoved({ taxFree: true, taxFreeWhy: 'cert', taxFreeCert: { state: 'TX' } }, { state: 'CA' }) && X.taxFreeMoved({ taxFree: true, taxFreeWhy: 'cert', shippingAddress: { state: 'TX' } }, { state: '' }) && !X.taxFreeMoved({ taxFree: true, taxFreeWhy: 'cert', taxFreeCert: { state: 'TX' } }, { state: 'Texas' }) && !X.taxFreeMoved({ taxFree: false }, { state: 'CA' }));
  check('…the house code and buyers from before aren’t tied to a state', !X.taxFreeMoved({ taxFree: true, taxFreeWhy: 'house', shippingAddress: { state: 'TX' } }, { state: 'OK' }) && !X.taxFreeMoved({ taxFree: true, taxFreeWhy: 'legacy', shippingAddress: { state: 'TX' } }, { state: 'OK' }));
  check('checkout asks them to sign in, in plain words', /To buy tax free, sign in with Glow Studio’s email on file/.test(String(X.taxNote({ free: false, why: 'verify' }, 'Glow Studio', 'Opal Studio'))));
  check('what checkout says when tax is added', /Glow Studio’s email on file/.test(String(X.taxNote({ free: false, why: 'email' }, 'Glow Studio', 'Opal Studio'))) && /ended Oct 1, so sales tax is added\. Send Opal Studio a new one/.test(String(X.taxNote({ free: false, why: 'ended', endedOn: '2026-10-01' }, 'Glow Studio', 'Opal Studio'))) && /is for Texas/.test(String(X.taxNote({ free: false, why: 'state', states: ['TX'] }, 'Glow Studio', 'Opal Studio'))));
  check('how a buyer reads on Wholesale', X.buyerTaxLabel(glow, {}, today).label === 'Tax free in Texas' && X.buyerTaxLabel(ends, {}, today).label === 'Certificate ends Nov 12' && X.buyerTaxLabel(ends, {}, today).warn
    && X.buyerTaxLabel({ ...ends, certs: [{ id: 'c1', state: 'TX', number: '1', endsOn: '2026-10-01' }] }, {}, today).label === 'Certificate ended Oct 1'
    && X.buyerTaxLabel(legacy, { wholesaleTaxExempt: true }, today).label === 'Tax free, add their certificate' && X.buyerTaxLabel({ ...legacy, email: '' }, { wholesaleTaxExempt: true }, today).label === 'Tax free, add their email'
    && X.buyerTaxLabel({ tax: 'taxable' }, {}, today).label === 'Pays tax',
    [X.buyerTaxLabel(glow, {}, today), X.buyerTaxLabel(ends, {}, today)]);

  console.log('buyers, changed by a manager on the server');
  await fresh();
  const { POST } = await import('../../src/app/api/retail/wholesale/route');
  const call = (action: string, x: any = {}) => POST(req({ tenantId: 't1', action, ...x })) as any;
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
  const denied: any = await call('save', { buyer: { businessName: 'Glow Studio' } });
  check('someone who isn’t a manager is turned away', denied.status === 403 && !(await all(`${T}/wholesaleAccounts`)).length);
  actor = { uid: 'm1', name: 'Jessica Marshall', role: 'manager', isManager: true, isTenantOwner: false, caps: [] };
  let r: any = await call('save', { buyer: { businessName: 'Glow Studio', contactName: 'Maya Chen', email: 'Maya@GlowStudio.com', extraDiscountPercent: 80, tax: 'exempt', certs: [] } });
  check('tax free with no certificate is refused', r.status === 400 && /resale certificate/.test(r.body.message), r.body);
  r = await call('save', { buyer: { businessName: 'Glow Studio', contactName: 'Maya Chen', email: '', tax: 'exempt', certs: [{ state: 'TX', number: '12-3456789-0', fileUrl: CERT_URL }] } });
  check('tax free with no email is refused (orders are tax free only with it)', r.status === 400 && /Add their email/.test(r.body.message), r.body);
  r = await call('save', { buyer: { businessName: 'Glow Studio', email: 'maya@glowstudio.com', tax: 'exempt', certs: [{ state: 'TX', number: '12-3456789-0' }] } });
  check('a certificate with no copy is refused (it’s kept on file)', r.status === 400 && /Add a copy of the Texas certificate/.test(r.body.message), r.body);
  r = await call('save', { buyer: { businessName: 'Glow Studio', email: 'maya@glowstudio.com', tax: 'exempt', certs: [{ state: 'TX', number: '12-3456789-0', fileUrl: CERT_URL, endsOn: '' }] } });
  check('“On a date” with no date is refused, never saved as no end date', r.status === 400 && /end date, or No end date/.test(r.body.message), r.body);
  check('a copy has to be in this shop’s certificate folder, not just mention it', !W.isCertFile('t1', `https://firebasestorage.googleapis.com/v0/b/x/o/other.pdf?x=${encodeURIComponent('tenants/t1/wholesale-certs/')}`) && !W.isCertFile('t1', CERT_URL.replace('tenants%2Ft1', 'tenants%2Ft2')) && W.isCertFile('t1', CERT_URL));
  r = await call('save', { buyer: { businessName: 'Glow Studio', email: 'maya@glowstudio.com', tax: 'exempt', certs: [{ state: 'TX', number: '1', fileUrl: CERT_URL }] } });
  check('a certificate with no real number is refused', r.status === 400 && /number/.test(r.body.message));
  r = await call('save', { buyer: { businessName: 'Glow Studio', email: 'maya@glowstudio.com', tax: 'exempt', certs: [{ state: 'TX', number: '12-3456789-0', endsOn: '2026-02-30', fileUrl: CERT_URL }] } });
  check('an end date that isn’t a real date is refused', r.status === 400 && /real date/.test(r.body.message));
  r = await call('save', { buyer: { businessName: 'Glow Studio', email: 'maya@glowstudio.com', tax: 'exempt', certs: [{ state: 'TX', number: '12-3456789-0', fileUrl: 'https://evil.example/x.pdf' }] } });
  check('a copy that wasn’t saved here is refused', r.status === 400 && /wasn’t saved here/.test(r.body.message));
  r = await call('save', { buyer: { businessName: 'Glow Studio', email: 'maya@glowstudio.com', tax: 'exempt', certs: [{ state: 'TX', number: '12-3456789-0', fileUrl: CERT_URL }, { state: 'Texas', number: '99-1', fileUrl: CERT_URL }] } });
  check('two certificates for one state are refused', r.status === 400 && /already a Texas/.test(r.body.message));
  r = await call('save', { buyer: { businessName: 'Glow Studio', contactName: 'Maya Chen', email: 'Maya@GlowStudio.com', extraDiscountPercent: 80, tax: 'exempt', taxEmails: ['front@glowstudio.com', 'maya@glowstudio.com', 'FRONT@glowstudio.com'], certs: [{ state: 'TX', number: '12-3456789-0', fileUrl: CERT_URL, fileName: 'glow.pdf' }] } });
  const id = r.body.id; let a = await get(`${T}/wholesaleAccounts/${id}`);
  check('added: a code is made, the discount kept within 50%, the email lowercased, staff emails kept once each', r.status === 200 && /^WS-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(a.accessCode) && a.extraDiscountPercent === 50 && a.email === 'maya@glowstudio.com' && JSON.stringify(a.taxEmails) === '["front@glowstudio.com"]' && a.status === 'active', a);
  check('…the certificate is kept with who accepted it (whole name and id) and when, from the sign-in', a.certs[0].acceptedBy === 'Jessica Marshall' && a.certs[0].acceptedById === 'm1' && !!a.certs[0].acceptedAt && a.certs[0].fileUrl === CERT_URL && a.createdBy === 'Jessica Marshall');
  const accepted = a.certs[0].acceptedAt;
  actor = { ...actor, uid: 'm2', name: 'Dee Lane' };
  r = await call('save', { buyer: { id, seenAt: 'an older time', businessName: 'Glow Studio', email: 'maya@glowstudio.com', tax: 'exempt', certs: a.certs } });
  check('a save over someone else’s change since the sheet opened is turned back', r.status === 400 && r.body.stale === true, r.body);
  r = await call('save', { buyer: { id, seenAt: a.updatedAt, businessName: 'Glow Studio', contactName: 'Maya Chen', email: 'maya@glowstudio.com', tax: 'exempt', certs: [{ ...a.certs[0], acceptedBy: 'Someone else' }, { state: 'OK', number: '55-1', endsOn: '2027-03-01', fileUrl: CERT_URL2 }] } });
  a = await get(`${T}/wholesaleAccounts/${id}`);
  check('changed by someone else: the Texas one keeps who accepted it, the new one is theirs', r.status === 200 && a.certs[0].acceptedBy === 'Jessica Marshall' && a.certs[0].acceptedAt === accepted && a.certs[1].acceptedBy === 'Dee Lane' && a.certs[1].endsOn === '2027-03-01', a.certs);
  r = await call('save', { buyer: { id, businessName: 'Glow Studio', email: 'maya@glowstudio.com', tax: 'exempt', certs: [{ ...a.certs[0], endsOn: '2099-12-31' }, a.certs[1]] } });
  a = await get(`${T}/wholesaleAccounts/${id}`);
  check('a changed end date is accepted again by whoever changed it, and the version before stays on file', a.certs[0].acceptedBy === 'Dee Lane' && a.certs[0].endsOn === '2099-12-31' && a.certsRemoved.some((c: any) => c.replaced === true && c.endsOn === null && c.acceptedBy === 'Jessica Marshall'), a.certsRemoved);
  r = await call('save', { buyer: { id, businessName: 'Glow Studio', email: 'maya@glowstudio.com', tax: 'exempt', certs: [{ ...a.certs[0], number: '12-0000000-0' }] } });
  a = await get(`${T}/wholesaleAccounts/${id}`);
  check('a changed number is accepted again, and the one taken off stays on file too', a.certs.length === 1 && a.certs[0].acceptedBy === 'Dee Lane' && a.certsRemoved.some((c: any) => c.number === '12-3456789-0') && a.certsRemoved.some((c: any) => c.state === 'OK' && c.removedBy === 'Dee Lane'), a.certsRemoved);
  r = await call('save', { buyer: { id, businessName: 'Glow Studio', email: 'maya@glowstudio.com', tax: 'taxable', certs: a.certs } });
  a = await get(`${T}/wholesaleAccounts/${id}`);
  check('set to pay tax: the certificate stays on the buyer, unused', a.tax === 'taxable' && a.certs.length === 1);
  const code1 = a.accessCode;
  r = await call('newCode', { id });
  a = await get(`${T}/wholesaleAccounts/${id}`);
  check('a new code replaces the old one', r.status === 200 && a.accessCode !== code1 && r.body.code === a.accessCode);
  r = await call('emailCode', { id });
  const { verifyAccountToken, verifyProvenAccountToken, signAccountToken: plainSign } = await import('../../src/lib/retail-account');
  const link = sent[0] ? new URL(String(/href="([^"]+)"/.exec(sent[0].html)?.[1] || 'https://x/').replace(/&amp;/g, '&')) : null;
  check('their code is emailed to them, with a link that opens it on the shop and signs them in as that email', r.status === 200 && sent.length === 1 && sent[0].to === 'maya@glowstudio.com' && sent[0].kind === 'wholesale_code' && sent[0].html.includes(a.accessCode) && link?.pathname === '/shop/t1/wholesale' && link?.searchParams.get('code') === a.accessCode && verifyProvenAccountToken('t1', 'maya@glowstudio.com', Number(link?.searchParams.get('x')), String(link?.searchParams.get('s'))).ok, sent[0] && { to: sent[0].to, kind: sent[0].kind });
  const px = Date.now() + 864e5;
  check('a session from an order’s pass signs them in but isn’t proof for tax; one from an emailed link is both', verifyAccountToken('t1', 'a@b.com', px, plainSign('t1', 'a@b.com', px)).ok && !verifyProvenAccountToken('t1', 'a@b.com', px, plainSign('t1', 'a@b.com', px)).ok && verifyAccountToken('t1', 'maya@glowstudio.com', Number(link?.searchParams.get('x')), String(link?.searchParams.get('s'))).ok);
  const { accountUrl } = await import('../../src/lib/retail-account');
  const su = new URL(accountUrl('https://app.example', 't1', 'Maya@GlowStudio.com'));
  check('the emailed sign-in link gives the proven kind', verifyProvenAccountToken('t1', 'maya@glowstudio.com', Number(su.searchParams.get('x')), String(su.searchParams.get('s'))).ok);
  r = await call('status', { id, status: 'suspended' });
  a = await get(`${T}/wholesaleAccounts/${id}`);
  const re2: any = await call('emailCode', { id });
  check('paused: their code stops, and it isn’t emailed', a.status === 'suspended' && re2.status === 400);
  const { resolveWholesaleAccess } = await import('../../src/lib/retail-wholesale');
  check('…the shop says so in plain words', /paused/.test(String((await resolveWholesaleAccess(db, 't1', {}, a.accessCode)).error)));
  await db.doc(`${T}/wholesaleAccounts/${id}`).set({ website: 'glowstudio.com' }, { merge: true });
  r = await call('save', { buyer: { id, businessName: 'Glow Studio', email: 'maya@glowstudio.com', tax: 'taxable', certs: (await get(`${T}/wholesaleAccounts/${id}`)).certs } });
  check('what the sheet doesn’t show (their website) is kept on a save', r.status === 200 && (await get(`${T}/wholesaleAccounts/${id}`)).website === 'glowstudio.com');
  await call('status', { id, status: 'active' });
  const { hideCodes } = await import('../../src/lib/code-redact');
  check('the code, and the link’s sign-in, are hidden in the message log the team reads', !hideCodes('wholesale_code', `Your code: ${a.accessCode}`).includes(a.accessCode) && !/[0-9a-f]{64}/.test(hideCodes('wholesale_code', sent[0]?.text || '')) && !/[0-9a-f]{64}/.test(hideCodes('account_signin_link', `https://x/account?e=a&x=1&s=${'a'.repeat(64)}`)));

  console.log('wholesale settings and buyers from before');
  await db.doc(`${T}/wholesaleAccounts/old1`).set({ businessName: 'Sunset Spa', email: 'leo@sunsetspa.com', accessCode: 'WS-AAAA-BBBB', status: 'active' });
  await db.doc(T).set({ retailSettings: { wholesaleTaxExempt: true } }, { merge: true });
  r = await call('settings', { houseTaxFree: false, applyOpen: true });
  check('a manager can’t change whether house code orders are tax free (the owner’s call)', r.status === 403 && (await get(T)).retailSettings.wholesaleTaxExempt === true);
  actor = { uid: 'o1', name: 'Jessica Marshall', role: 'owner', isManager: true, isTenantOwner: true, caps: [] };
  r = await call('settings', { houseTaxFree: false, applyOpen: true });
  const old1 = await get(`${T}/wholesaleAccounts/old1`); const t1 = await get(T);
  check('turning the house code’s tax off first gives each buyer from before the old setting as their own', r.status === 200 && old1.tax === 'exempt' && old1.taxFromShopSwitch === true && t1.retailSettings.wholesaleTaxExempt === false && t1.retailSettings.wholesaleApplyOpen === true, { old1, rs: t1.retailSettings });
  check('…so they stay tax free, marked to add their certificate', X.taxFreeFor({ account: old1, rs: t1.retailSettings, email: 'leo@sunsetspa.com', proven: true, taxState: 'TX', today }).why === 'legacy' && X.buyerTaxLabel(old1, t1.retailSettings, today).label === 'Tax free, add their certificate');
  r = await call('save', { buyer: { id: 'old1', businessName: 'Sunset Spa', email: 'leo@sunsetspa.com', tax: 'exempt', certs: [] } });
  check('…and saving them without a certificate is still allowed', r.status === 200 && (await get(`${T}/wholesaleAccounts/old1`)).taxFromShopSwitch === true, r.body);
  r = await call('save', { buyer: { id: 'old1', businessName: 'Sunset Spa', email: 'leo@sunsetspa.com', tax: 'exempt', certs: [{ state: 'TX', number: '88-1', fileUrl: CERT_URL }] } });
  r = await call('save', { buyer: { id: 'old1', businessName: 'Sunset Spa', email: 'leo@sunsetspa.com', tax: 'exempt', certs: [] } });
  const old2 = await get(`${T}/wholesaleAccounts/old1`);
  check('once a certificate has been on file, taking it off doesn’t bring the old switch back', r.status === 400 && old2.taxFromShopSwitch === false && X.taxFreeFor({ account: { ...old2, certs: [] }, rs: {}, email: 'leo@sunsetspa.com', proven: true, taxState: 'TX', today }).why === 'no_cert', { status: r.status, body: r.body, flag: old2.taxFromShopSwitch });

  console.log('applying from the shop');
  const AP = await import('../../src/app/api/retail/wholesale-apply/route');
  const apply = (x: any) => AP.POST(req({ tenantId: 't1', businessName: 'Lumen Nail Bar', contactName: 'Dana Ruiz', email: 'Dana@LumenNailBar.com', phone: '(737) 555-0118', kind: 'salon', state: 'Texas', website: 'instagram.com/lumennailbar', certNumber: '32-1098765-4', note: 'About 40 bottles a month', ...x })) as any;
  await db.doc(T).set({ retailSettings: { wholesaleApplyOpen: false } }, { merge: true });
  r = await apply({});
  check('a shop not taking applications turns them away', r.status === 403 && !(await all(`${T}/wholesaleApplications`)).length);
  await db.doc(T).set({ retailSettings: { wholesaleApplyOpen: true } }, { merge: true });
  const g1: any = await AP.GET(req({}, 'https://app.example/api?tenantId=t1'));
  check('the page can ask whether the shop takes them', g1.body.open === true && g1.body.shopName === 'Opal Studio');
  r = await apply({ hp: 'Bot Inc' });
  check('the hidden field filled in: answered as if sent, nothing kept', r.status === 200 && !(await all(`${T}/wholesaleApplications`)).length);
  r = await apply({ ms: 900 });
  check('sent under three seconds after opening: nothing kept, and they’re asked to check it and send again', r.status === 400 && /send it again/.test(r.body.error) && !(await all(`${T}/wholesaleApplications`)).length);
  r = await apply({ state: 'Atlantis', certFile: 'data:application/pdf;base64,JVBERi0=' });
  check('a state that isn’t one is refused, before any file is saved', r.status === 400 && /state/.test(r.body.error) && uploads.length === 0);
  r = await apply({ certFile: 'data:application/pdf;base64,JVBERi0=', certFileName: 'lumen<cert>.pdf' });
  let list = await all(`${T}/wholesaleApplications`);
  check('sent: waiting, with the certificate saved where the server picks', r.status === 200 && list.length === 1 && list[0].status === 'pending' && list[0].email === 'dana@lumennailbar.com' && list[0].state === 'TX' && W.isCertFile('t1', list[0].certFileUrl) && uploads[0]?.folder === 'wholesale-certs' && list[0].certFileName === 'lumencert.pdf', list[0]);
  const notes = await all(`${T}/notifications`);
  check('…and each manager hears about it, on their own bell', notes.length === 2 && notes.every((n: any) => n.link === '/retail-orders/wholesale' && /Lumen Nail Bar applied/.test(n.message)) && notes.map((n: any) => n.userId).sort().join() === 'm2,o1', notes.map((n: any) => n.userId));
  const firstId = list[0].id;
  r = await apply({ note: 'Also 6 chairs', certFile: undefined });
  list = await all(`${T}/wholesaleApplications`);
  const newer = list.find((x: any) => x.status === 'pending'); const older = list.find((x: any) => x.id === firstId);
  check('sent again with the same email: a new one, the earlier marked replaced, the same answer, and nobody told twice', r.status === 200 && r.body.message === 'Sent.' && list.length === 2 && newer?.note === 'Also 6 chairs' && older?.status === 'replaced' && older?.replacedBy === newer?.id && (await all(`${T}/notifications`)).length === 2, list.map((x: any) => ({ id: x.id, status: x.status })));
  check('…sent again without the copy: the copy sent before comes with it', W.isCertFile('t1', newer?.certFileUrl) && newer?.certFileName === 'lumencert.pdf');
  const rOld: any = await call('approve', { appId: firstId, tax: 'taxable' });
  check('…the replaced one can’t be approved', rOld.status === 400 && /newer application/.test(rOld.body.message));
  list = [newer];
  const both: any[] = await Promise.all([apply({ email: 'twice@x.com', businessName: 'Twice Co' }), apply({ email: 'twice@x.com', businessName: 'Twice Co', note: 'again' })]);
  const twice = (await all(`${T}/wholesaleApplications`)).filter((x: any) => x.email === 'twice@x.com');
  check('two sent at once with one email: one waiting, the other replaced', both.every((x) => x.status === 200) && twice.length === 2 && twice.filter((x: any) => x.status === 'pending').length === 1 && twice.filter((x: any) => x.status === 'replaced').length === 1, twice.map((x: any) => x.status));
  for (const x of twice) await db.doc(`${T}/wholesaleApplications/${x.id}`).delete();
  limited = true; r = await apply({ email: 'other@x.com' }); limited = false;
  check('too many from one visitor are turned away', r.status === 429);
  check('the public route is limited per visitor and per shop', /limitPublic\(req, 'wsapply'/.test(src('src/app/api/retail/wholesale-apply/route.ts')) && /limitPublic\(req, 'wscode'/.test(src('src/app/api/retail/wholesale-apply/route.ts')));
  check('the busy message never asks anyone to phone', !/call the business/.test(src('src/lib/rate-limit.ts')));

  console.log('approving and declining');
  const appId = list[0].id;
  r = await call('approve', { appId, extraDiscountPercent: 10, tax: 'exempt', cert: { state: 'TX', number: '32-1098765-4', endsOn: null } });
  const buyers = (await all(`${T}/wholesaleAccounts`)).filter((x: any) => x.applicationId === appId);
  const ap = await get(`${T}/wholesaleApplications/${appId}`);
  check('approved: the buyer is made with their details, the discount, and the certificate they sent, accepted by the person approving', r.status === 200 && buyers.length === 1 && buyers[0].businessName === 'Lumen Nail Bar' && buyers[0].extraDiscountPercent === 10 && buyers[0].tax === 'exempt' && buyers[0].certs[0].state === 'TX' && buyers[0].certs[0].fileUrl === list[0].certFileUrl && buyers[0].certs[0].acceptedBy === 'Jessica Marshall' && buyers[0].email === 'dana@lumennailbar.com', buyers[0]);
  check('…the application says so, and their code is on its way to them', ap.status === 'approved' && ap.accountId === buyers[0].id && r.body.emailed === true && sent.some((m) => m.to === 'dana@lumennailbar.com' && m.html.includes(buyers[0].accessCode) && /tax free in Texas/.test(m.html)), r.body);
  const before = sent.length;
  r = await call('approve', { appId, tax: 'taxable' });
  check('pressed again: nothing more is made or sent', r.status === 200 && r.body.already === true && (await all(`${T}/wholesaleAccounts`)).filter((x: any) => x.applicationId === appId).length === 1 && sent.length === before);
  r = await apply({ email: 'sam@polished.co', businessName: 'Polished & Co.', certNumber: '' });
  const app2 = (await all(`${T}/wholesaleApplications`)).find((x: any) => x.email === 'sam@polished.co');
  r = await call('approve', { appId: app2.id, tax: 'exempt', cert: { state: 'CO', number: '' } });
  check('approving tax free needs a certificate number', r.status === 400 && /number/.test(r.body.message));
  r = await call('approve', { appId: app2.id, tax: 'exempt', cert: { state: 'CO', number: '77-1234' } });
  check('…and a copy (none was sent, and none added)', r.status === 400 && /Add a copy of the Colorado certificate/.test(r.body.message), r.body);
  r = await call('decline', { appId: app2.id, email: false });
  await settle();
  check('declined without an email: nothing is sent', r.status === 200 && (await get(`${T}/wholesaleApplications/${app2.id}`)).status === 'declined' && sent.length === before);
  r = await apply({ email: 'sam@polished.co', businessName: 'Polished & Co.' });
  const app3 = (await all(`${T}/wholesaleApplications`)).find((x: any) => x.email === 'sam@polished.co' && x.status === 'pending');
  r = await call('decline', { appId: app3.id, email: true, note: 'We sell wholesale to licensed salons only.' });
  await settle();
  check('they can apply again; declined with an email, they get one with the note', !!app3 && r.status === 200 && sent.length === before + 1 && sent[sent.length - 1].kind === 'wholesale_declined' && sent[sent.length - 1].html.includes('licensed salons only'));
  r = await call('approve', { appId: app3.id, tax: 'taxable' });
  check('a declined one can’t then be approved', r.status === 400);
  const g2: any = await AP.GET(req({}, `https://app.example/api?tenantId=t1&code=${buyers[0].accessCode.toLowerCase()}`));
  const g3: any = await AP.GET(req({}, 'https://app.example/api?tenantId=t1&code=WS-NOPE-NOPE'));
  check('the code link checks the code: theirs works, another doesn’t', g2.body.ok === true && g2.body.business === 'Lumen Nail Bar' && g3.status === 403);

  console.log('the emailed sign-in for a buyer’s emails');
  process.env.RESEND_API_KEY = 'k'; process.env.NOTIFY_FROM_EMAIL = 'Opal <hi@opal.example>';
  const RQ = await import('../../src/app/api/retail/account/request/route');
  const ask = async (email: string) => { const before = sent.length; const res: any = await RQ.POST(req({ tenantId: 't1', email })); await settle(); return { res, mail: sent.slice(before) }; };
  await db.doc(`${T}/wholesaleAccounts/rq1`).set({ businessName: 'Lumen', contactName: '<a/href=//evil.example>Click</a> Ruiz', email: 'dana@lumen.example', taxEmails: ['front@lumen.example'], status: 'active' });
  await db.doc(`${T}/wholesaleAccounts/rq2`).set({ businessName: 'Old Lumen', email: 'dup@x.example', status: 'suspended' });
  await db.doc(`${T}/wholesaleAccounts/rq3`).set({ businessName: 'New Lumen', email: 'dup@x.example', status: 'active' });
  await db.doc(`${T}/wholesaleAccounts/rq4`).set({ businessName: 'Paused', email: 'paused@x.example', taxEmails: ['pstaff@x.example'], status: 'suspended' });
  const q1 = await ask('front@lumen.example'); const q2 = await ask('dana@lumen.example'); const q3 = await ask('dup@x.example'); const q4 = await ask('nobody@x.example'); const q5 = await ask('pstaff@x.example');
  const same = [q1, q2, q3, q4, q5].every((q) => JSON.stringify(q.res.body) === JSON.stringify(q1.res.body));
  const sl = q1.mail[0] ? new URL(String(/href="([^"]+)"/.exec(q1.mail[0].html)?.[1] || 'https://x/').replace(/&amp;/g, '&')) : null;
  check('a staff email on a buyer’s list gets the emailed sign-in (the proven kind), before ordering anything', q1.mail.length === 1 && q1.mail[0].to === 'front@lumen.example' && !!sl && verifyProvenAccountToken('t1', 'front@lumen.example', Number(sl.searchParams.get('x')), String(sl.searchParams.get('s'))).ok);
  check('…the name in the greeting is escaped', q2.mail.length === 1 && !/<a\/href/.test(q2.mail[0].html) && /Hi &lt;a\/href/.test(q2.mail[0].html), q2.mail[0]?.html?.slice(0, 400));
  check('…an email shared with a paused buyer still gets it from the active one; unknown and paused ones get nothing', q3.mail.length === 1 && q4.mail.length === 0 && q5.mail.length === 0);
  check('…and the answer is the same every time', same && /wholesale account/.test(q1.res.body.message), [q1.res.body, q4.res.body]);
  check('…sent after the answer, so its timing says nothing', /after\(async \(\) => \{ try \{\s*const tenantSnap/.test(src('src/app/api/retail/account/request/route.ts')));

  console.log('checkout and the books');
  await fresh({ wholesaleApplyOpen: true });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Gel Base Coat', msrp: 16, wholesalePriceDollars: 8, totalStock: 100, stockReserved: 0, showOnline: true, status: 'active', type: 'retail' });
  await db.doc(`${T}/wholesaleAccounts/b1`).set({ ...glow, accessCode: 'WS-GLOW-0001', status: 'active', extraDiscountPercent: 0 });
  const CO = await import('../../src/app/api/retail/checkout/route');
  const { signAccountToken, signProvenAccountToken } = await import('../../src/lib/retail-account');
  const session = (e: string) => { const x = Date.now() + 864e5; return { e, x, s: signProvenAccountToken('t1', e, x) }; };
  const order = async (email: string, x: any = {}) => { const res: any = await CO.POST(req({ tenantId: 't1', items: [{ productId: 'p1', qty: 10 }], method: 'counter', priceTier: 'wholesale', wholesaleCode: 'WS-GLOW-0001', customer: { name: 'Maya Chen', email }, accountSession: session(email), ...x })); return { res, o: res.body?.orderId ? await get(`${T}/retailOrders/${res.body.orderId}`) : null }; };
  let c1 = await order('maya@glowstudio.com');
  check('their email, signed in, picked up in Texas: no tax, and the order keeps the certificate’s id and last four only', c1.res.status === 200 && c1.o.taxCents === 0 && c1.o.taxFree === true && c1.o.taxFreeCert?.last4 === '89-0' && c1.o.taxFreeCert?.id === 'c1' && c1.o.taxFreeCert?.state === 'TX' && !c1.o.taxFreeCert?.number, { status: c1.res.status, body: c1.res.body, o: c1.o && { tax: c1.o.taxCents, free: c1.o.taxFree, cert: c1.o.taxFreeCert } });
  c1 = await order('maya@glowstudio.com', { accountSession: undefined });
  check('their email typed, not signed in: tax, and the order says why', c1.res.status === 200 && c1.o.taxCents === 640 && c1.o.taxFreeWhy === 'verify');
  { const x = Date.now() + 864e5; c1 = await order('maya@glowstudio.com', { accountSession: { e: 'maya@glowstudio.com', x, s: signAccountToken('t1', 'maya@glowstudio.com', x) } }); }
  check('…signed in as their email from an order’s pass (anyone who placed an order with it could be): tax', c1.o.taxCents === 640 && c1.o.taxFreeWhy === 'verify');
  c1 = await order('maya@glowstudio.com', { accountSession: session('friend@gmail.com') });
  check('…signed in as someone else: tax', c1.o.taxCents === 640 && c1.o.taxFreeWhy === 'verify');
  c1 = await order('friend@gmail.com');
  check('their code with someone else’s email: wholesale prices, with tax', c1.res.status === 200 && c1.o.taxCents === 640 && c1.o.taxFree === false && c1.o.taxFreeWhy === 'email' && c1.o.subtotalCents === 8000, c1.o && { tax: c1.o.taxCents, why: c1.o.taxFreeWhy, sub: c1.o.subtotalCents });
  await db.doc(`${T}/wholesaleAccounts/b1`).set({ certs: [{ id: 'c1', state: 'TX', number: '12-3456789-0', endsOn: '2026-01-31' }] }, { merge: true });
  c1 = await order('maya@glowstudio.com');
  check('their certificate has ended: tax, and the order says why', c1.res.status === 200 && c1.o.taxCents === 640 && c1.o.taxFreeWhy === 'ended');
  check('the house code follows the shop’s switch at checkout', /taxFreeFor\(\{ account: wsAccount \? \(wsAccount\.raw \|\| \{\}\) : null/.test(src('src/app/api/retail/checkout/route.ts')));
  const { orderBookLines } = await import('../../src/lib/order-books');
  const lines = orderBookLines({ orderNumber: 7, subtotalCents: 30000, taxCents: 0, priceTier: 'wholesale', taxFree: true, taxFreeCert: { id: 'c1', state: 'TX', last4: '89-0' } }, { tenantId: 't1', orderId: 'o7', at: '2026-10-31T12:00:00Z', tenders: { cardCents: 30000, creditCents: 0, giftCents: 0 } });
  check('the sale in the books is marked tax free, with its certificate', lines[0].data.taxFree === true && lines[0].data.taxFreeCert?.id === 'c1');
  const { booksSummary } = await import('../../src/lib/books-summary');
  const sum = booksSummary([lines[0].data, { id: 'r1', type: 'expense', category: 'Refunds', taxBucket: 'refund', amount: 50, taxRefunded: 0, retailOrderId: 'o7', date: '2026-10-31' }, { id: 's2', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 100, retailOrderId: 'o8', date: '2026-10-31' }]);
  check('tax-free sales are added up, less what was refunded on them, and other sales aren’t', sum.taxFreeSales === 250 && sum.sales === 400, { taxFree: sum.taxFreeSales, sales: sum.sales, returns: sum.returns });
  const shipped = orderBookLines({ orderNumber: 9, subtotalCents: 30000, shippingCents: 1500, taxCents: 0, priceTier: 'wholesale', method: 'ship', taxFree: true, taxFreeCert: { id: 'c1', state: 'TX', last4: '89-0' } }, { tenantId: 't1', orderId: 'o9', at: '2026-10-31T12:00:00Z', tenders: { cardCents: 31500, creditCents: 0, giftCents: 0 } });
  const sum2 = booksSummary([...shipped.map((l) => l.data), { id: 'r9', type: 'expense', category: 'Refunds', taxBucket: 'refund', amount: 315, taxRefunded: 0, retailOrderId: 'o9', date: '2026-10-31' }]);
  check('…a tax-free order with shipping refunded in full comes to nothing, never below', shipped.length === 2 && shipped[1].data.taxFree === true && sum2.taxFreeSales === 0, { lines: shipped.map((l) => l.data.taxFree), taxFree: sum2.taxFreeSales });

  console.log('the rules and the screens');
  const rules = src('firestore.rules');
  check('no browser writes buyers or applications; managers read them', /wholesaleAccounts\/\{accountId\} \{\s*allow read: if isManager\(tenantId\);\s*allow write: if false;/.test(rules) && /wholesaleApplications\/\{appId\} \{\s*allow read: if isManager\(tenantId\);\s*allow write: if false;/.test(rules) && /'wholesaleAccounts', 'wholesaleApplications'/.test(rules));
  const screen = src('src/components/orders/WholesaleScreen.tsx');
  check('the Wholesale screen changes nothing itself: every change goes through the server', !/updateDoc|addDoc|setDoc|deleteDoc/.test(screen) && /wholesale\(tenantId, 'save'/.test(screen) && /'approve' \| 'decline'/.test(screen));
  check('Shop settings no longer has the shop-wide tax switch; the house code moved to Wholesale', !/Wholesale orders tax-exempt/.test(src('src/app/(app)/retail-orders/settings/page.tsx')) && /Its orders are tax free/.test(screen));
  check('the shop’s code box links to the apply page when the shop takes applications', /shop\.wholesaleApply && \(/.test(src('src/app/shop/[tenantId]/page.tsx')) && /Apply for wholesale/.test(src('src/app/shop/[tenantId]/page.tsx')));
  const ck = src('src/app/shop/[tenantId]/checkout/page.tsx');
  check('checkout shows the tax decision before paying and sends the signed-in session with the order (wholesale tax, and products for licensed pros)', /taxFreeOnShop\(shop\.wholesaleTax, email/.test(ck) && /accountSession: acctSess \|\| undefined/.test(ck) && /qs\.set\('acctE'/.test(ck));
  check('checkout offers to email the sign-in, says if it didn’t go, and picks it up when they come back', /Email me a sign-in link/.test(ck) && /\/api\/retail\/account\/request/.test(ck) && /setLinkErr\(String\(d\.error/.test(ck) && /addEventListener\('visibilitychange', recheck\)/.test(ck) && /addEventListener\('storage', recheck\)/.test(ck));
  check('a tax-free order can’t be moved to another state, by the customer or the team', /taxFreeMoved\(order, clean\)/.test(src('src/app/api/retail/self-serve/route.ts')) && /taxFreeMoved\(o, req0\.to\)/.test(src('src/app/api/retail/address/route.ts')));
  const toolWords = new RegExp(['cl', 'aude|anth', 'ropic'].join(''), 'i');
  const touched = ['src/lib/wholesale-tax.ts', 'src/lib/wholesale-server.ts', 'src/lib/wholesale-client.ts', 'src/components/orders/WholesaleScreen.tsx', 'src/app/api/retail/wholesale/route.ts', 'src/app/api/retail/wholesale-apply/route.ts', 'src/app/shop/[tenantId]/wholesale/page.tsx'];
  check('no tool names in what changed', touched.every((p) => !toolWords.test(src(p))));
  check('US spelling and no emojis in what changed', touched.every((p) => !/\b(cancelled|colour|behaviour|organise|licence)\b/i.test(src(p).replace(/'cancelled'/g, '')) && !/\p{Extended_Pictographic}/u.test(src(p))));

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('wholesale ok');
})().catch((e) => { console.error(e); process.exit(1); });
