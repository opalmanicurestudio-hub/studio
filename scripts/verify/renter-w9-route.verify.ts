// Checks a renter saving their W-9 through the portal (/api/portal/renter, actions w9-status and w9-save), end to end
// against a stand-in database:
// - It goes on their own record, whatever renter id the request carries, and nowhere a browser can read: the full
//   record sits in renters/{id}/private/w9, the renter document only says one is on file.
// - The number is never stored, returned, logged or put in the history in full; an unreadable request isn't quoted.
// - Saving twice says "updated"; a missing encryption key fails plainly; a record that doesn't exist isn't created.
// - One saved the old way (on the renter document) is still read, and moved on the next save. The staff route reads both.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renter-w9-route.verify.ts
import Module from 'module';
import { createHash } from 'crypto';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const audits: any[] = [];
const M: any = Module as any;
const load = M._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const is = (request: string, name: string) => request === `@/lib/${name}` || new RegExp(`/src/lib/${name}(\\.ts)?$`).test(request);
let staffSignedIn = true;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe' || /node_modules\/stripe\//.test(request)) return fake(request, function () { return {}; });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (is(request, 'firebase-admin')) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === './audit' || is(request, 'audit')) return fake(request, { logAuditAdmin: async (_db: any, _t: string, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  if (is(request, 'route-guard')) return fake(request, { requireRole: async () => (staffSignedIn ? { actor: { uid: 'm1', isManager: true } } : { deny: { status: 401, body: { ok: false } } }) });
  if (is(request, 'notify')) return fake(request, { sendNotification: async () => ({ status: 'sent' }), resolveFromAddress: () => 'hello@example.com' });
  if (is(request, 'sms')) return fake(request, { smsConfigured: () => false, sendTenantSms: async () => ({ ok: true }) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const TOKEN = 'tok-maya-0123456789abcdef'; const UNLINKED = 'tok-guest-0123456789abcdef';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const TIN = '123-45-6789'; const DIGITS = '123456789';
const form = (x: any = {}) => ({ tin: TIN, tinType: 'ssn', legalName: 'Maya Ortiz', businessName: 'Lash Lab', address: { street: '1 Main St', city: 'Austin', state: 'TX', zip: '78701' }, entityType: 'Single-member LLC', certifiedUnderPenalty: true, ...x });

(async () => {
  process.env.W9_ENCRYPTION_KEY = 'b'.repeat(64);
  await db.doc(T).set({ name: 'Northside Studio' });
  await db.doc(`${T}/renters/r1`).set({ firstName: 'Maya', lastName: 'Ortiz', phone: '5551234567' });
  await db.doc(`${T}/renters/r2`).set({ firstName: 'Kim', lastName: 'Reyes' });
  await db.doc(`${T}/private/renterSessions`).set({
    [sha(TOKEN)]: { contactKey: '5551234567', name: 'Maya Ortiz', renterId: 'r1', expiresAt: Date.now() + 3600e3 },
    [sha(UNLINKED)]: { contactKey: '5550000000', name: 'Guest', renterId: null, expiresAt: Date.now() + 3600e3 },
  });
  const { POST } = await import('../../src/app/api/portal/renter/route');
  const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://studio.test' } }) as any;
  const portal = (x: any, token = TOKEN) => POST(req({ tenantId: 't1', token, ...x })) as any;
  const logs: string[] = [];
  const orig = { e: console.error, l: console.log, w: console.warn };
  console.error = (...a: any[]) => { logs.push(a.map(String).join(' ')); }; console.warn = console.error;
  const said = () => logs.join('\n');

  // Saving: their own record, whatever the request names.
  const r1 = await portal({ action: 'w9-save', ...form(), renterId: 'r2' });
  check('a W-9 saves', r1.status === 200 && r1.body.ok === true, r1.body);
  const priv = await get(`${T}/renters/r1/private/w9`);
  check('it goes to their own record, in private', !!priv && priv.tinLast4 === '6789' && !!priv.encryptedTin);
  check('the request’s own renter id is ignored', !(await get(`${T}/renters/r2/private/w9`)) && !(await get(`${T}/renters/r2`))?.w9OnFile);
  const doc = await get(`${T}/renters/r1`);
  check('the renter document only says it’s on file', doc?.w9OnFile === true && !doc?.w9 && !JSON.stringify(doc).includes('6789'));
  check('the full number is stored nowhere', !JSON.stringify(db.dump ? db.dump() : [priv, doc]).includes(DIGITS) && !JSON.stringify(priv).includes(TIN));
  check('the answer carries only the masked number', r1.body.w9?.tinMasked === '***-**-6789' && !JSON.stringify(r1.body).includes(DIGITS) && !('encryptedTin' in (r1.body.w9 || {})));
  check('the history says added, with only the last 4 digits', audits.some((a) => /added their W-9 \(SSN ending 6789\)/.test(a.summary)) && !JSON.stringify(audits).includes(DIGITS));
  const r2 = await portal({ action: 'w9-save', ...form({ legalName: 'Maya R. Ortiz' }) });
  check('saving again says updated', r2.status === 200 && audits.some((a) => /updated their W-9/.test(a.summary)));

  // Reading it back.
  const st = await portal({ action: 'w9-status' });
  check('their status shows the masked number and name, never the stored number', st.body.ok && st.body.w9?.tinMasked === '***-**-6789' && st.body.w9?.legalName === 'Maya R. Ortiz' && !JSON.stringify(st.body).includes((priv as any).encryptedTin));

  // What it refuses.
  const bad = await portal({ action: 'w9-save', ...form({ tin: '12345' }) });
  check('a short number is refused plainly', bad.status === 400 && bad.body.error === 'An SSN has nine digits.');
  const unsigned = await portal({ action: 'w9-save', ...form({ certifiedUnderPenalty: 'true' }) });
  check('the certification has to be a real yes', unsigned.status === 400 && unsigned.body.error === 'Check the box to sign it.');
  const guest = await portal({ action: 'w9-save', ...form() }, UNLINKED);
  check('a session not linked to a renter record can’t save one', guest.status === 403);
  check('…or read one', (await portal({ action: 'w9-status' }, UNLINKED)).status === 403);
  await db.doc(`${T}/private/renterSessions`).set({ [sha('tok-gone-0123456789abcdef')]: { contactKey: '5559999999', name: 'Gone', renterId: 'r9', expiresAt: Date.now() + 3600e3 } }, { merge: true });
  const gone = await portal({ action: 'w9-save', ...form() }, 'tok-gone-0123456789abcdef');
  check('a renter record that doesn’t exist isn’t created', gone.status === 404 && !(await get(`${T}/renters/r9`)) && !(await get(`${T}/renters/r9/private/w9`)));

  // A missing key fails plainly, and nothing of the request reaches the log.
  delete process.env.W9_ENCRYPTION_KEY;
  logs.length = 0;
  const nokey = await portal({ action: 'w9-save', ...form() });
  check('a missing encryption key fails plainly', nokey.status === 500 && /couldn’t be saved just now/.test(nokey.body.error) && !/W9_ENCRYPTION_KEY|randomBytes/.test(JSON.stringify(nokey.body)));
  check('…and the log names the cause without the number', /encryption key missing/.test(said()) && !said().includes(DIGITS) && !said().includes(TIN));
  process.env.W9_ENCRYPTION_KEY = 'b'.repeat(64);

  // An unreadable request isn't quoted, in the answer or the log.
  logs.length = 0;
  const garbled = await POST({ json: async () => { throw new SyntaxError(`Unexpected token in JSON at position 40: {"tin":"${TIN}"`); }, headers: { get: () => null } } as any) as any;
  check('an unreadable request gets a fixed answer', garbled.status === 400 && garbled.body.error === 'The request couldn’t be read.' && !said().includes(TIN));

  // Saved the old way: still read, and moved on the next save.
  const W = await import('../../src/lib/w9-record');
  await db.doc(`${T}/renters/r2`).set({ firstName: 'Kim', w9: W.sealW9(form({ tin: '987-65-4321', legalName: 'Kim Reyes' }), '2026-01-01T00:00:00Z') }, { merge: true });
  const Store = await import('../../src/lib/w9-store');
  check('one saved on the renter document is still on file', Store.hasW9(await get(`${T}/renters/r2`)));
  check('…and reads', (await Store.readW9(db, 't1', 'r2'))?.tinLast4 === '4321');
  const moved = await get(`${T}/renters/r2`);
  check('…and is moved into private the first time it’s read', !moved?.w9 && moved?.w9OnFile === true && (await get(`${T}/renters/r2/private/w9`))?.tinLast4 === '4321');

  // A newer save wins over moving an old copy.
  await db.doc(`${T}/renters/r3`).set({ firstName: 'Lee', w9: W.sealW9(form({ tin: '111-22-3333', legalName: 'Lee Old' }), '2025-01-01T00:00:00Z') });
  await db.doc(`${T}/renters/r3/private/w9`).set(W.sealW9(form({ tin: '444-55-6666', legalName: 'Lee New' }), '2026-11-09T00:00:00Z'));
  await Store.readW9(db, 't1', 'r3');
  check('moving an old copy never overwrites a newer one', (await get(`${T}/renters/r3/private/w9`))?.tinLast4 === '6666');
  const W9STORE = (await import('fs')).readFileSync('src/lib/w9-store.ts', 'utf8');
  check('the move re-reads inside one transaction', /db\.runTransaction\(async \(tx: any\) => \{\s*const p = await tx\.get\(pRef\)/.test(W9STORE) && /if \(p\.exists && \(p\.data\(\) as any\)\?\.tinLast4\) return;/.test(W9STORE));

  // The staff route reads the same place.
  const staff = await import('../../src/app/api/booths/w9/route');
  const sget = await staff.GET({ url: 'https://studio.test/api/booths/w9?tenantId=t1&renterId=r1', headers: { get: () => 'Bearer x' } } as any) as any;
  check('the owner’s view reads it from private, masked', sget.status === 200 && sget.body.w9?.tinMasked === '***-**-6789' && !JSON.stringify(sget.body).includes('encryptedTin'));
  const spost = await staff.POST({ json: async () => ({ tenantId: 't1', renterId: 'r2', ...form({ tin: '12-3456789', tinType: 'ein', legalName: 'Kim LLC' }) }), headers: { get: () => 'Bearer x' } } as any) as any;
  check('the staff route saves into private too', spost.status === 200 && (await get(`${T}/renters/r2/private/w9`))?.tinType === 'ein' && !(await get(`${T}/renters/r2`))?.w9);
  check('nothing logged the number anywhere', !said().includes(DIGITS));

  // A flood of saves is slowed down.
  let limited = 0;
  for (let i = 0; i < 12; i++) { const r = await portal({ action: 'w9-save', ...form() }); if (r.status === 429) limited++; }
  check('more than 10 saves an hour are refused for a while', limited >= 1);

  // Who sees the W-9 screen and step: someone signed in as their record.
  const Map = await import('../../src/components/rent/portal-map');
  const base = { booksHere: false, hasRenter: true, hasLease: true, swapsOn: false };
  check('the W-9 screen is for someone signed in as their record', Map.viewAllowed('w9', base) && Map.viewAllowed('w9', { ...base, linked: true }) && !Map.viewAllowed('w9', { ...base, linked: false }));
  check('…while their other screens stay open to a renter matched by phone or email', ['lease', 'notices', 'repairs', 'insurance'].every((v) => Map.viewAllowed(v, { ...base, linked: false })));

  console.error = orig.e; console.warn = orig.w;
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
