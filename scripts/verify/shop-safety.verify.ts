// Checks the shop safety round (from the shop admin audit, October 24): the things that lost data or let money be
// changed from a browser, fixed before any screen is rebuilt.
//   - shop reviews are moderated from their own collection, never the salon's visit reviews; a review the shop hid
//     stays hidden when the customer edits it;
//   - shop settings load the packing-slip and label options as saved, so changing one keeps the others;
//   - a return opened at the desk is worked out and saved on the server; nobody writes returns or report outcomes from
//     a browser; asking a customer for more about a report is saved and sent from the server;
//   - wholesale accounts are managers only, and "Unlock wholesale" shows only on shops that sell wholesale;
//   - a reply to a customer with only a mobile reaches them by text.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/shop-safety.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.CRON_SECRET = 'test-secret';
let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const afterJobs: Promise<any>[] = [];
const notified: any[] = [];
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-retail-reviews' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, input: any) => { notified.push(input); return { ok: true, status: 'sent' }; } });
  if (request === '@/lib/email-shell' || /\/src\/lib\/email-shell(\.ts)?$/.test(request)) return fake(request, { getEmailBrand: async () => ({ shopName: 'Opal', brandColor: '#16171a' }), brandedEmail: (_b: any, html: string) => html, emailButton: () => '' });
  if (request === '@/lib/message-policy' || /\/src\/lib\/message-policy(\.ts)?$/.test(request)) return fake(request, { gateMessage: async () => ({ send: true }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, sent: true }) });

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const req = (body: any, headers: Record<string, string> = {}, search = '') => ({ json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, nextUrl: { origin: 'https://app.example', searchParams: new URLSearchParams(search) } }) as any;

(async () => {
  // ── Reviews ──
  const page = src('src/app/(app)/retail-orders/reviews/page.tsx');
  // The shop's page went to the one Reviews screen (row 14): shop and visit reviews side by side, each kind changed only
  // through the server in its own collection, and none deleted.
  const screen = src('src/components/reviews/ReviewsScreen.tsx'); const rserver = src('src/lib/reviews-server.ts');
  check('the Reviews screen keeps shop and visit reviews apart, changes them only through the server, and deletes none',
    /redirect\('\/reviews\?tab=shop'\)/.test(page) && /tenants\/\$\{tenantId\}\/retailReviews/.test(screen) && /tenants\/\$\{tenantId\}\/reviews`/.test(screen)
    && !/updateDoc|deleteDoc|setDoc|addDoc/.test(screen) && /kind === 'shop' \? 'retailReviews' : 'reviews'/.test(rserver) && !/\.delete\(/.test(rserver));
  const { POST: REVIEW } = await import('../../src/app/api/retail/reviews/route');
  await db.doc(T).set({ name: 'Opal', retailSettings: {} });
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', stage: 'completed', qrToken: 'o1.tok', customerName: 'Dana Whit', lines: [{ lineId: 'A', productId: 'gel', name: 'Gel polish' }] });
  let r: any = await REVIEW(req({ tenantId: 't1', orderId: 'o1', qrToken: 'o1.tok', productId: 'gel', rating: 2, body: 'Not great at all' }));
  const id = 'o1__gel';
  const first = await get(`${T}/retailReviews/${id}`);
  await db.doc(`${T}/retailReviews/${id}`).update({ status: 'hidden' });
  r = await REVIEW(req({ tenantId: 't1', orderId: 'o1', qrToken: 'o1.tok', productId: 'gel', rating: 1, body: 'Edited to be worse' }));
  const again = await get(`${T}/retailReviews/${id}`);
  check('a review the shop hid stays hidden when the customer edits it, and keeps when it was first written', r.status === 200 && again.status === 'hidden' && again.createdAt === first.createdAt && again.body === 'Edited to be worse', { r: r.body, again });

  // ── Shop settings ──
  const settings = src('src/app/(app)/retail-orders/settings/page.tsx');
  check('shop settings load the packing-slip and label options as saved (changing one used to wipe the rest)', /existing\.slip && typeof existing\.slip === 'object' \? \{ slip:/.test(settings) && /labelFormat: existing\.labelFormat/.test(settings) && /labelPackingSlip: existing\.labelPackingSlip/.test(settings) && /labelOrderRef: existing\.labelOrderRef/.test(settings));
  check('…and no escape codes show on screen as text', !/[>\s]\\u20(14|26)/.test(settings.replace(/'[^'\n]*'|`[^`\n]*`/g, '')));

  // ── Returns opened at the desk ──
  const { POST: FULFIL } = await import('../../src/app/api/retail/fulfil/route');
  db = strictTransactions(makeDb());
  await db.doc(T).set({ name: 'Opal', retailSettings: {} });
  await db.doc(`${T}/retailOrders/r1`).set({ id: 'r1', orderNumber: 1500, stage: 'completed', method: 'counter', qrToken: 'r1.tok', subtotalCents: 3000, taxCents: 240, totalCents: 3240, lines: [{ lineId: 'A', productId: 'gel', name: 'Gel polish', unitPriceCents: 1500, qtyOrdered: 2, qtyScanned: 2, qtyShorted: 0, qtyReturned: 0, status: 'picked' }] });
  r = await FULFIL(req({ tenantId: 't1', action: 'openReturn', orderId: 'r1', selections: [{ lineId: 'A', qty: 1, reason: 'changed_mind' }], resolution: 'refund', refundCents: 999999, notes: 'At the desk' }, { authorization: 'Bearer t' })); await settle();
  const rets = await all(`${T}/retailReturns`);
  check('a return opened at the desk is saved by the server, with what comes back worked out from what was paid (a sum sent by the screen is ignored)', r.body.ok === true && rets.length === 1 && rets[0].refundCents > 0 && rets[0].refundCents < 2000 && rets[0].openedBy === 'Kai Park', { r: r.body, rets });
  r = await FULFIL(req({ tenantId: 't1', action: 'openReturn', orderId: 'r1', selections: [{ lineId: 'A', qty: 5, reason: 'changed_mind' }], resolution: 'refund' }, { authorization: 'Bearer t' }));
  check('…and more than can still come back is refused', r.body.ok === false && /can still be returned/.test(r.body.message));
  await db.doc(`${T}/retailOrders/r2`).set({ id: 'r2', orderNumber: 1501, stage: 'packed', method: 'counter', lines: [] });
  r = await FULFIL(req({ tenantId: 't1', action: 'openReturn', orderId: 'r2', selections: [{ lineId: 'A', qty: 1 }] }, { authorization: 'Bearer t' }));
  check('…nor for an order that hasn’t gone out', r.status === 409);
  actor = { ...actor, isRenter: true };
  r = await FULFIL(req({ tenantId: 't1', action: 'openReturn', orderId: 'r1', selections: [{ lineId: 'A', qty: 1 }] }, { authorization: 'Bearer t' }));
  check('…and a renter can’t open the shop’s returns', r.status === 403);
  actor = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
  check('a return started on the order opens through the server, and is checked in through it', /import \{ openReturn, type Actor \} from '@\/lib\/fulfil-client'/.test(src('src/components/orders/StartReturnSheet.tsx')) && /import \{ receiveReturnLine, resolveReturn \} from '@\/lib\/fulfil-client'/.test(src('src/components/orders/ReturnSheet.tsx')));

  // ── More about a report ──
  await db.doc(`${T}/retailClaims/c1`).set({ id: 'c1', orderId: 'r1', status: 'in_review', customerEmail: 'dana@example.com', claimValueCents: 1500 });
  r = await FULFIL(req({ tenantId: 't1', action: 'requestClaimInfo', claimId: 'c1', text: 'A photo of the box, please' }, { authorization: 'Bearer t' })); await settle();
  check('only someone who can decide on a report writes to the customer about it (anyone on the team could)', r.status === 403 && !(await get(`${T}/retailClaims/c1`)).infoRequestText, r.body);
  actor = { ...actor, caps: ['checkout.refund'] };
  r = await FULFIL(req({ tenantId: 't1', action: 'requestClaimInfo', claimId: 'c1', text: 'A photo of the box, please' }, { authorization: 'Bearer t' })); await settle();
  const c1 = await get(`${T}/retailClaims/c1`);
  const q = (await all('messageOutbox')).find((m: any) => m.kind === 'claim_info');
  check('asking the customer for more about a report is saved by the server, as the person signed in, and sent from the queue', r.body.ok === true && c1.infoRequestText === 'A photo of the box, please' && c1.infoRequestBy === 'Kai Park' && !!q && q.body.kind === 'info_request', { r: r.body, c1, q });
  check('the reports screen asks through the server (its request used to fail without a sign-in, silently)', /requestClaimInfo\(tenantId, claim\.id/.test(src('src/components/orders/ClaimCard.tsx')) && !/kind: 'info_request'/.test(src('src/components/orders/ClaimCard.tsx')));

  await db.doc(`${T}/retailClaims/c2`).set({ id: 'c2', orderId: 'r1', status: 'resolved' });
  r = await FULFIL(req({ tenantId: 't1', action: 'requestClaimInfo', claimId: 'c2', text: 'More please' }, { authorization: 'Bearer t' }));
  check('…not on a report that’s been decided', r.status === 409);
  const cn = src('src/app/api/retail/claim-notify/route.ts');
  check('a customer with only a mobile is told about a report by text, and a send that throws gives its mark back', /async function textInstead/.test(cn) && (cn.match(/await textInstead\(/g) || []).length === 2 && /console\.error\('\[claim-notify\] info request ping failed:', err\?\.message\);\s*await giveBack\(\);/.test(cn));
  // Two returns started at once on one order: the order's return count lets only one through.
  db = strictTransactions(makeDb());
  await db.doc(T).set({ name: 'Opal', retailSettings: {} });
  await db.doc(`${T}/retailOrders/r3`).set({ id: 'r3', orderNumber: 1502, stage: 'completed', method: 'counter', qrToken: 'r3.tok', subtotalCents: 1500, taxCents: 0, totalCents: 1500, lines: [{ lineId: 'A', productId: 'gel', name: 'Gel polish', unitPriceCents: 1500, qtyOrdered: 1, qtyScanned: 1, qtyShorted: 0, qtyReturned: 0, status: 'picked' }] });
  const both: any[] = await Promise.all([1, 2].map(() => FULFIL(req({ tenantId: 't1', action: 'openReturn', orderId: 'r3', selections: [{ lineId: 'A', qty: 1, reason: 'changed_mind' }], resolution: 'refund' }, { authorization: 'Bearer t' }))));
  check('two returns started at once for the last unit: only one is saved', (await all(`${T}/retailReturns`)).length === 1 && both.filter((x) => x.body.ok).length === 1, both.map((x) => x.body));
  check('…and the customer’s own returns count the same way', /if \(\(Number\(cur\.returnSeq\) \|\| 0\) !== \(Number\(order\.returnSeq\) \|\| 0\)\) return true;/.test(src('src/app/api/retail/self-serve/route.ts')) && /'returnSeq'[,\]]/.test(src('firestore.rules')));
  check('a reply posted with nobody to tell isn’t reported as told', /!\/nobody to nudge\/\.test/.test(src('src/app/api/retail/support-reply/route.ts')));

  // ── The database ──
  const rules = src('firestore.rules');
  check('nobody writes a report’s worth, photos or outcome from a browser', /match \/tenants\/\{tenantId\}\/retailClaims\/\{claimId\} \{\s*allow read: if isTeam\(tenantId\);\s*allow create, update, delete: if false;/.test(rules));
  check('…nor a return', /match \/tenants\/\{tenantId\}\/retailReturns\/\{returnId\} \{\s*allow read: if isTeam\(tenantId\);\s*allow write: if false;/.test(rules));
  check('wholesale accounts are managers only (codes are money off)', /match \/tenants\/\{tenantId\}\/wholesaleAccounts\/\{accountId\} \{\s*allow read, write: if isManager\(tenantId\);/.test(rules) && /'retailClaims', 'wholesaleAccounts', 'retailReturns',/.test(rules));

  // ── Wholesale on the shop ──
  const catalog = src('src/app/api/retail/catalog/route.ts');
  check('“Unlock wholesale” shows only on a shop that sells wholesale (it showed on every shop)', !/rs\.wholesaleOffered !== false/.test(catalog) && /rs\.wholesaleOffered === true/.test(catalog) && /where\('status', '==', 'active'\)\.limit\(1\)/.test(catalog));

  // ── A reply to a customer with only a mobile ──
  const { POST: REPLY } = await import('../../src/app/api/retail/support-reply/route');
  db = strictTransactions(makeDb()); notified.length = 0;
  await db.doc(T).set({ name: 'Opal' });
  await db.doc(`${T}/retailOrders/m1`).set({ id: 'm1', orderNumber: 1600, customerPhone: '5551234567' });
  await db.doc(`${T}/retailSupport/s1`).set({ id: 's1', orderId: 'm1', orderNumber: 1600, customerName: 'Sam', customerEmail: '', message: 'Where is it?', status: 'open' });
  r = await REPLY(req({ tenantId: 't1', ticketId: 's1', reply: 'On its way today' }, { authorization: 'Bearer t' }));
  check('a reply to a customer with only a mobile reaches them by text (it used to go nowhere)', r.status === 200 && notified.some((n) => n.channel === 'sms' && n.to === '5551234567' && n.kind === 'support_reply') && /told by text or email/.test(r.body.message), { r: r.body, notified });

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
