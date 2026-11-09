// Checks the safety round (launch L14):
// - Printable pages (receipts, statements, renter documents, the interruption packet) open only from a short-lived
//   signed link. The app asks for one and gets it only when the person may see that page: the team by role, a renter
//   only for their own records (in the app or the renter portal), and only their own part of an interruption packet.
// - A renter's personal portal link is fresh for each message, made from random bytes, stored only as a hash, and works
//   for 30 days. Old plain links stop working. A manager can turn every link off, which also signs the renter out.
//   Wrong tries count per visitor, so one person can't lock out every renter.
// - Desk booking and desk availability need the business's own team; who booked comes from the sign-in.
// - A renter's product cost per service is kept privately, not on the public menu.
// - The quote page no longer shows card boxes that take nothing.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-safety.verify.ts
import Module from 'module';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
let actorNow: any = null;
class FakeResponse { status: number; body: any; headers: any; constructor(body?: any, init?: any) { this.body = body; this.status = init?.status || 200; this.headers = init?.headers || {}; }
  static json(body: any, init?: any) { return new FakeResponse(body, init); } }
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const guard = {
  requireRole: async (_req: any, _tid: any, level = 'staff') => {
    if (!actorNow) return { deny: FakeResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 }) };
    if (level === 'manager' && !(actorNow.isManager || actorNow.isTenantOwner)) return { deny: FakeResponse.json({ ok: false, error: 'Only a manager can do that.' }, { status: 403 }) };
    return { actor: actorNow };
  },
  requireCan: async () => (actorNow ? { actor: actorNow } : { deny: FakeResponse.json({ ok: false }, { status: 401 }) }),
  staffOrServer: async () => !!actorNow,
};
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: FakeResponse };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === 'stripe') return { __esModule: true, default: function Stripe() { return {}; } };
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, guard);
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const mails: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => { if (String(url).includes('resend')) mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'm1' }), text: async () => '' }; };
const read = (p: string) => readFileSync(p, 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

(async () => {
  process.env.RESEND_API_KEY = 're_test'; process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <hello@mail.example.com>';
  delete process.env.LINK_SECRET;
  const PL = await import('../../src/lib/print-link');
  const RL = await import('../../src/lib/renter-link');
  const PrintRoute = await import('../../src/app/api/print-link/route');
  const Portal = await import('../../src/app/api/portal/renter/route');
  const Notify = await import('../../src/app/api/booths/notify/route');
  const Reserve = await import('../../src/app/api/booths/reserve/route');
  const Receipt = await import('../../src/app/api/booths/receipt/route');
  const Doc = await import('../../src/app/api/booths/renter-document/route');

  const tenant = { name: 'Fern & Co', timezone: 'America/New_York', userId: 'owner1', subscriptionStatus: 'active', publicOrigin: 'https://fern.example.com' };
  await db.doc(T).set(tenant);
  await db.doc(`${T}/renters/r1`).set({ firstName: 'Ana', lastName: 'Diaz', name: 'Ana Diaz', email: 'ana@example.com', phone: '555-201-3344', status: 'active', portalToken: 'oldplaintoken123456' });
  await db.doc(`${T}/renters/r2`).set({ firstName: 'Bo', lastName: 'Lee', name: 'Bo Lee', email: 'bo@example.com', status: 'active' });
  await db.doc(`${T}/staff/s_ana`).set({ name: 'Ana Diaz', isRenter: true, renterId: 'r1', isActive: true });
  await db.doc(`${T}/renterDocuments/d1`).set({ renterId: 'r1', title: 'Building rules', body: 'Be kind.', status: 'sent' });
  await db.doc(`${T}/renterDocuments/d2`).set({ renterId: 'r2', title: 'Building rules', body: 'Be kind.', status: 'sent' });
  await db.doc(`${T}/boothReservations/res1`).set({ renterId: 'r1', boothName: 'Chair 2', status: 'confirmed', startDate: '2026-11-02', endDate: '2026-11-02', amountCents: 6000, name: 'Ana Diaz' });
  await db.doc(`${T}/boothReservations/res2`).set({ renterId: 'r2', boothName: 'Chair 3', status: 'confirmed', startDate: '2026-11-02', endDate: '2026-11-02', amountCents: 6000, name: 'Bo Lee' });
  const req = (body: any, ip = '10.0.0.1') => ({ json: async () => body, headers: { get: (k: string) => (k === 'x-forwarded-for' ? ip : null) }, nextUrl: { origin: 'https://app.example.com', searchParams: new URLSearchParams() } } as any);
  const out = (r: any) => ({ status: r.status, ...(r.body && typeof r.body === 'object' ? r.body : {}) });

  console.log('Signed print links');
  const u = PL.signPrintLink('/api/booths/receipt', { tenantId: 't1', type: 'reservation', id: 'res1' })!;
  const sp = (url: string) => new URL(url, 'https://x.test').searchParams;
  check('a signed link checks out for its own page', PL.printLinkValid('/api/booths/receipt', sp(u)), u);
  check('the same link fails for a different page', !PL.printLinkValid('/api/booths/statement', sp(u)));
  check('changing a parameter breaks it', !PL.printLinkValid('/api/booths/receipt', sp(u.replace('id=res1', 'id=res2'))));
  check('adding a parameter breaks it', !PL.printLinkValid('/api/booths/receipt', sp(`${u}&renterId=r2`)));
  check('it runs out after ten minutes', !PL.printLinkValid('/api/booths/receipt', sp(u), Date.now() + 11 * 60 * 1000));
  check('a repeated name can’t swap in someone else’s record', !PL.printLinkValid('/api/booths/receipt', sp(u.replace('/api/booths/receipt?', '/api/booths/receipt?id=res2&'))));
  check('a link with no signature fails', !PL.printLinkValid('/api/booths/receipt', sp('/api/booths/receipt?tenantId=t1&type=reservation&id=res1')));
  const prodEnv = { NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production', CRON_SECRET: 'cron-secret' };
  check('another secret is never used in place of the link secret', PL.signPrintLink('/api/booths/receipt', { tenantId: 't1' }, Date.now(), prodEnv) === null);
  check('a preview copy doesn’t fall back to the development secret', PL.signPrintLink('/api/booths/receipt', { tenantId: 't1' }, Date.now(), { VERCEL: '1', VERCEL_ENV: 'preview' }) === null);
  check('a production copy on any other host doesn’t fall back to it either', PL.signPrintLink('/api/booths/receipt', { tenantId: 't1' }, Date.now(), { NODE_ENV: 'production' }) === null);
  check('with the link secret set, links work on the live app', !!PL.signPrintLink('/api/booths/receipt', { tenantId: 't1' }, Date.now(), { ...prodEnv, LINK_SECRET: 'real' }));
  const notReady: any = PL.printLinkExpired({ VERCEL: '1', VERCEL_ENV: 'production' });
  check('without it, a page says printing isn’t available (not "expired")', /isn’t available right now/.test(await notReady.text()));
  check('no secret in production means no links (and none accepted)', PL.signPrintLink('/api/booths/receipt', { tenantId: 't1' }, Date.now(), { NODE_ENV: 'production', VERCEL_ENV: 'production' }) === null
    && !PL.printLinkValid('/api/booths/receipt', sp(u), Date.now(), { NODE_ENV: 'production', VERCEL_ENV: 'production' }));

  const recGet = async (url: string) => Receipt.GET({ url: new URL(url, 'https://app.example.com').toString(), nextUrl: { searchParams: sp(url) } } as any) as any;
  const bare = await recGet('/api/booths/receipt?tenantId=t1&type=reservation&id=res1');
  check('a receipt with no signed link shows "expired", not the receipt', bare.status === 403 && !String((await bare.text?.()) || bare.body || '').includes('Ana'));
  const good = await recGet(u);
  check('a receipt with a signed link opens', good.status === 200 && String(good.body || '').includes('Chair 2'), good.status);

  const ask = async (body: any) => out(await PrintRoute.POST(req({ tenantId: 't1', ...body })));
  actorNow = null;
  check('nobody signed in gets no link', (await ask({ path: '/api/booths/receipt', params: { type: 'reservation', id: 'res1' } })).status === 401);
  actorNow = { uid: 'u_front', name: 'Front Desk', role: 'front', caps: ['bookings.manage', 'checkout.take'] };
  const f1 = await ask({ path: '/api/booths/receipt', params: { type: 'reservation', id: 'res2' } });
  check('the front desk can print a booking receipt', f1.ok && /^\/api\/booths\/receipt\?/.test(f1.url), f1);
  check('the front desk can’t print a renter’s statement', (await ask({ path: '/api/booths/account-statement', params: { renterId: 'r1' } })).status === 403);
  check('an unknown page is refused', (await ask({ path: '/api/clients/export', params: {} })).status === 400);
  actorNow = { uid: 'm1', name: 'Max', role: 'manager', isManager: true, caps: [] };
  const m1 = await ask({ path: '/api/booths/account-statement', params: { renterId: 'r1', mode: 'full', tenantId: 'someone-else' } });
  check('a manager can print a renter’s statement, always for this business', m1.ok && m1.url.includes('tenantId=t1') && !m1.url.includes('someone-else'), m1);
  const mp = await ask({ path: '/api/booths/interruption-packet', params: { id: 'i1' } });
  check('a manager gets the whole interruption packet', mp.ok && !mp.url.includes('renterId='), mp.url);

  actorNow = { uid: 's_ana', name: 'Ana Diaz', role: 'renter', isRenter: true, caps: [] };
  check('a renter in the app can print their own statement', (await ask({ path: '/api/booths/statement', params: { renterId: 'r1', year: 2026 } })).ok);
  check('…but not another renter’s', (await ask({ path: '/api/booths/statement', params: { renterId: 'r2', year: 2026 } })).status === 403);
  check('…their own booking receipt, not someone else’s', (await ask({ path: '/api/booths/receipt', params: { type: 'reservation', id: 'res1' } })).ok
    && (await ask({ path: '/api/booths/receipt', params: { type: 'reservation', id: 'res2' } })).status === 403);
  const ap = await ask({ path: '/api/booths/interruption-packet', params: { id: 'i1', renterId: 'r2' } });
  check('a renter only ever gets their own part of an interruption packet', ap.ok && ap.url.includes('renterId=r1') && !ap.url.includes('renterId=r2'), ap.url);

  console.log('Renter portal links');
  const link = await RL.mintRenterLink(db, 't1', 'r1', 'https://fern.example.com', { renter: await get(`${T}/renters/r1`) });
  const tok = new URL(link!).searchParams.get('rt')!;
  check('a link carries a long random token', /^https:\/\/fern\.example\.com\/rent\/t1\?rt=[A-Za-z0-9_-]{32}$/.test(String(link)), link);
  const stored = (await db.collection(`${T}/private/renterLinks/links`).get()).docs;
  check('only a hash is kept, never the link itself', stored.length === 1 && stored[0].id !== tok && !JSON.stringify(stored[0].data()).includes(tok) && stored[0].id.length === 64);
  check('the old plain link is wiped from the renter’s record', (await get(`${T}/renters/r1`))?.portalToken === undefined);
  check('it opens for its renter', (await RL.renterFromLink(db, 't1', tok)) === 'r1');
  check('it stops after 30 days', (await RL.renterFromLink(db, 't1', tok, Date.now() + 31 * 86_400_000)) === null);
  for (let i = 0; i < 11; i++) await RL.mintRenterLink(db, 't1', 'r2', 'https://fern.example.com');
  check('only the newest ten links are kept for a renter', (await db.collection(`${T}/private/renterLinks/links`).where('renterId', '==', 'r2').get()).size === 10);

  const portal = async (body: any, ip = '10.0.0.1') => out(await Portal.POST(req({ tenantId: 't1', ...body }, ip)));
  const s1 = await portal({ action: 'token-login', magicToken: tok });
  check('opening the link signs the renter in', s1.ok && typeof s1.token === 'string', s1);
  check('an old plain link no longer signs anyone in', (await portal({ action: 'token-login', magicToken: 'oldplaintoken123456' })).status === 401);
  for (let i = 0; i < 30; i++) await portal({ action: 'token-login', magicToken: `guess-${i}-aaaaaaaaaaaaaaaaaaaaaaaa` }, '10.9.9.9');
  check('one visitor guessing is stopped after 30 tries an hour', (await portal({ action: 'token-login', magicToken: tok }, '10.9.9.9')).status === 429);
  check('…and every other renter still gets in', (await portal({ action: 'token-login', magicToken: tok }, '10.0.0.2')).ok);
  await db.doc(`${T}/private/renterCodes`).set({ '5557771234': { codeHash: require('crypto').createHash('sha256').update('482913').digest('hex'), expiresAt: Date.now() + 600000, attempts: 0, name: 'Bo Lee', renterId: 'r2' } });
  for (let i = 0; i < 6; i++) await portal({ action: 'verify-code', contact: 'zed@example.com', code: '000000' }, '10.7.7.7');
  const vc = await portal({ action: 'verify-code', contact: '555-777-1234', code: '482913' }, '10.0.0.3');
  check('wrong codes from one visitor don’t lock out another renter', vc.ok, vc);

  await db.doc(`${T}/private/renterCodes`).set({ '5550001111': { codeHash: require('crypto').createHash('sha256').update('111222').digest('hex'), expiresAt: Date.now() + 600000, attempts: 0, name: 'Cy', renterId: null } }, { merge: true });
  for (let i = 0; i < 5; i++) await portal({ action: 'verify-code', contact: '555-000-1111', code: String(900000 + i) }, `10.6.0.${i}`);
  check('the fifth wrong try uses the code up, even from different visitors', (await portal({ action: 'verify-code', contact: '555-000-1111', code: '111222' }, '10.6.1.1')).status === 401);

  const docs = await portal({ action: 'documents-list', token: s1.token });
  check('the portal no longer hands the browser a sign-in token', docs.ok && docs.portalToken === undefined, Object.keys(docs));
  const pd = out(await PrintRoute.POST(req({ tenantId: 't1', token: s1.token, path: '/api/booths/renter-document', params: { tenantId: 't1', id: 'd1' } })));
  check('a portal renter can print their own document, scoped to them', pd.ok && pd.url.includes('renterId=r1'), pd);
  check('…but not another renter’s document', out(await PrintRoute.POST(req({ tenantId: 't1', token: s1.token, path: '/api/booths/renter-document', params: { id: 'd2' } }))).status === 403);
  check('a made-up portal session gets nothing', out(await PrintRoute.POST(req({ tenantId: 't1', token: 'nope', path: '/api/booths/renter-document', params: { id: 'd1' } }))).status === 401);
  const docGet = async (url: string) => Doc.GET({ nextUrl: { searchParams: sp(url) } } as any) as any;
  check('the signed document link opens', (await docGet(pd.url)).status === 200);
  check('an old ?renter= link shows "expired"', (await docGet('/api/booths/renter-document?tenantId=t1&id=d1&renter=oldplaintoken123456')).status === 403);

  console.log('Sending and turning off links');
  const notify = async (body: any) => out(await Notify.POST(req({ tenantId: 't1', ...body })));
  actorNow = { uid: 'u_front', name: 'Front Desk', role: 'front', caps: ['bookings.manage'] };
  check('only a manager can send a portal link', (await notify({ action: 'portal-invite', renterId: 'r1' })).status === 403);
  check('…or turn them off', (await notify({ action: 'portal-revoke', renterId: 'r1' })).status === 403);
  actorNow = { uid: 'm1', name: 'Max', role: 'manager', isManager: true, caps: [] };
  mails.length = 0;
  const inv = await notify({ action: 'portal-invite', renterId: 'r1' });
  const mail = mails.find((m) => m.to === 'ana@example.com' || (Array.isArray(m.to) && m.to.includes('ana@example.com')));
  check('a manager sends a fresh link by email', inv.ok && !!mail, inv);
  check('the link never comes back to whoever pressed the button', inv.link === undefined);
  check('the email says it works for 30 days (and no longer says it never expires)', /works for 30 days/.test(String(mail?.html || '')) && !/does not expire/.test(String(mail?.html || '')));
  const sentTok = String(mail?.html || '').match(/rt=([A-Za-z0-9_-]{32})/)?.[1];
  check('the emailed link signs in', !!sentTok && (await portal({ action: 'token-login', magicToken: sentTok }, '10.0.0.4')).ok);
  const rv = await notify({ action: 'portal-revoke', renterId: 'r1' });
  check('turning links off removes every link for that renter', rv.ok && rv.links >= 2 && (await db.collection(`${T}/private/renterLinks/links`).where('renterId', '==', 'r1').get()).size === 0, rv);
  check('…the links stop working', (await portal({ action: 'token-login', magicToken: sentTok }, '10.0.0.5')).status === 401);
  check('…and the renter is signed out', (await portal({ action: 'documents-list', token: s1.token })).status === 401);
  check('…while another renter stays signed in', Object.values((await get(`${T}/private/renterSessions`)) || {}).some((v: any) => v.renterId === 'r2'));

  console.log('Desk booking');
  await db.doc(`${T}/booths/b1`).set({ name: 'Chair 1', dayUseEnabled: true, status: 'vacant', pricingOptions: [{ frequency: 'daily', amountCents: 6000 }] });
  const desk = async (body: any) => out(await Reserve.POST(req({ tenantId: 't1', ...body })));
  actorNow = null;
  check('desk availability needs a sign-in', (await desk({ action: 'desk-availability', date: '2026-11-20' })).status === 401);
  check('desk booking needs a sign-in', (await desk({ action: 'desk-book', boothId: 'b1', date: '2026-11-20', name: 'Walk In' })).status === 401);
  actorNow = { uid: 's_ana', name: 'Ana Diaz', role: 'renter', isRenter: true, caps: ['checkout.take'] };
  check('a renter can’t use the front desk', (await desk({ action: 'desk-availability', date: '2026-11-20' })).status === 403);
  actorNow = { uid: 'u_front', name: 'Front Desk', role: 'front', caps: ['bookings.manage', 'checkout.take'] };
  const db1 = await desk({ action: 'desk-book', boothId: 'b1', date: '2026-11-20', name: 'Walk In', staffId: 'someone', staffName: 'Someone Else' });
  const made = db1.reservationId ? await get(`${T}/boothReservations/${db1.reservationId}`) : (await db.collection(`${T}/boothReservations`).where('source', '==', 'desk').get()).docs[0]?.data();
  check('the desk books, recording who did it from their sign-in', !!made && made.bookedByStaffName === 'Front Desk' && made.bookedByStaffId === 'u_front', { db1, made: made && { by: made.bookedByStaffName } });
  await db.doc(T).set({ subscriptionStatus: 'canceled' }, { merge: true });
  const closed = await desk({ action: 'desk-book', boothId: 'b1', date: '2026-11-21', name: 'Walk In' });
  check('a paused or canceled business takes no desk bookings', !closed.ok && closed.status >= 400, closed);
  await db.doc(T).set({ subscriptionStatus: 'active' }, { merge: true });

  console.log('Renter product costs');
  await db.doc(`${T}/renterServices/sv_old`).set({ id: 'sv_old', staffId: 's_ana', renterId: 'r1', name: 'Blowout', price: 55, duration: 45, productCost: 6, isActive: true });
  const link2 = await RL.mintRenterLink(db, 't1', 'r1', 'https://fern.example.com');
  const s3 = await portal({ action: 'token-login', magicToken: new URL(link2!).searchParams.get('rt') }, '10.0.0.7');
  const save = await portal({ action: 'my-service-save', token: s3.token, name: 'Silk press', price: 90, duration: 90, productCost: 12 });
  const svc = save.serviceId ? await get(`${T}/renterServices/${save.serviceId}`) : null;
  check('saving a service keeps its cost off the public service record', save.ok && !!svc && svc.productCost === undefined, { save, svc });
  check('…and in a private record instead', (await get(`${T}/private/renterServiceCosts`))?.[save.serviceId] === 12);
  const me = await portal({ action: 'me', token: s3.token, today: '2026-11-08' });
  const mine = (me.myServices || []) as any[];
  check('the renter still sees their own costs', mine.find((x) => x.id === save.serviceId)?.productCost === 12 && mine.find((x) => x.id === 'sv_old')?.productCost === 6, mine);
  check('a cost saved the old way is moved off the public record', (await get(`${T}/renterServices/sv_old`))?.productCost === undefined && (await get(`${T}/private/renterServiceCosts`))?.sv_old === 6);
  check('the booking page never sends a cost', /renterServices: rows\(rsv, \(x\) => drop\(x, \/\^productCost\/\)\)/.test(read('src/app/api/booking/public-data/route.ts')));

  await db.doc(`${T}/renters/r2`).set({ portalToken: 'legacyplaintoken999' }, { merge: true });
  const CL = await import('../../src/lib/renter-service-costs');
  check('the nightly tidy clears old plain links from renter records', (await RL.clearOldPortalTokens(db, 't1')) >= 1 && (await get(`${T}/renters/r2`))?.portalToken === undefined);
  await db.doc(`${T}/private/renterServiceCosts`).set({ sv_new: 9 }, { merge: true });
  await db.doc(`${T}/renterServices/sv_new`).set({ id: 'sv_new', staffId: 's_ana', name: 'Trim', price: 30, productCost: 3, isActive: true });
  await CL.moveLegacyCosts(db, 't1', (await db.collection(`${T}/renterServices`).get()).docs);
  check('moving old costs never overwrites a newer one', (await get(`${T}/private/renterServiceCosts`))?.sv_new === 9 && (await get(`${T}/renterServices/sv_new`))?.productCost === undefined);

  console.log('Pages');
  const quote = read('src/app/quote/[tenantId]/[id]/page.tsx');
  check('the quote page has no card boxes and says nothing about being booked', !/Card Number|CVC|MM \/ YY|Name on Card|You're Booked/.test(quote) && !/setStep\('payment'\)/.test(quote));
  const srcFiles = walk('src').filter((f) => /\.(tsx?|jsx?)$/.test(f));
  const plain = srcFiles.filter((f) => !f.includes('/api/booths/') && /[`'"]\/api\/booths\/(receipt|statement|account-statement|renter-document|interruption-packet)\?/.test(read(f)));
  check('no screen links to a printable page without a signed link', plain.length === 0, plain);
  const routes = ['receipt', 'statement', 'account-statement', 'renter-document', 'interruption-packet'];
  check('every printable page checks its link', routes.every((r) => read(`src/app/api/booths/${r}/route.ts`).includes(`printLinkValid('/api/booths/${r}'`)));
  check('no portal token is minted the old way anywhere', !srcFiles.some((f) => /portalToken:\s*tok\b|Math\.random\(\)[^\n]*portalToken|rt=\$\{(r|renter|target)\??\.portalToken/.test(read(f))));

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
