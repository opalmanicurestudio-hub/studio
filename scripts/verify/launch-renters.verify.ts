// Checks the renters round, part one (launch L15a):
// - A lease can wait for the renter's signature: its terms are saved, it goes to their portal as a lease to sign, and
//   nothing bills it until they sign. Signing in the portal starts it (once). Without a signature it starts at once.
// - Adding a renter keeps every field the form sends. New renters show under New on the Renters page, with a way to
//   set up their lease, and the lease wizard can send their portal link.
// - Renters can save a card in their portal (on the business's own card page), and the portal says whether the
//   business can charge it. A personal link greets them by their name.
// - Rent history is found by renter, never by name: two renters with the same name never see each other's payments.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-renters.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
let actorNow: any = { uid: 'm1', name: 'Max', role: 'manager', isManager: true, caps: [] };
class FakeResponse { status: number; body: any; constructor(body?: any, init?: any) { this.body = body; this.status = init?.status || 200; }
  static json(body: any, init?: any) { return new FakeResponse(body, init); } }
// The browser database, on the same fake store.
let auto = 0;
const colRef = (path: string) => ({ __col: true, path, id: path.split('/').pop() });
const docRef = (path: string) => ({ __doc: true, path, id: path.split('/').pop() });
const web: any = {
  collection: (base: any, ...segs: string[]) => colRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/')),
  doc: (base: any, ...segs: string[]) => (base?.__col ? docRef(`${base.path}/${segs[0] || `auto${++auto}`}`) : docRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/'))),
  writeBatch: () => { const ops: any[] = []; const b: any = {
    set: (r: any, v: any, o?: any) => { ops.push(() => db.doc(r.path).set(v, o)); return b; },
    update: (r: any, v: any) => { ops.push(() => db.doc(r.path).update(v)); return b; },
    delete: (r: any) => { ops.push(() => db.doc(r.path).delete()); return b; },
    commit: async () => { for (const f of ops) await f(); } }; return b; },
  getDoc: async (r: any) => { const s = await db.doc(r.path).get(); return { exists: () => s.exists, data: () => s.data(), id: s.id }; },
  query: (c: any, ...cons: any[]) => ({ path: c.path, cons }), where: (k: string, op: string, v: any) => ({ k, op, v }),
  getDocs: async (q: any) => { let c: any = db.collection(q.path); for (const x of q.cons || []) c = c.where(x.k, x.op, x.v); const s = await c.get();
    return { docs: s.docs.map((d: any) => ({ id: d.id, ref: docRef(`${q.path}/${d.id}`), data: () => d.data() })), empty: s.empty, size: s.size }; },
  serverTimestamp: () => new Date().toISOString(), deleteField: () => FV.delete(), increment: (n: number) => FV.increment(n),
};
const stripeCalls: any[] = [];
const fakeStripe: any = {
  customers: { list: async () => ({ data: [] }), create: async (p: any, o: any) => { stripeCalls.push({ what: 'customer', p, o }); return { id: 'cus_new' }; } },
  checkout: { sessions: { create: async (p: any, o: any) => { stripeCalls.push({ what: 'setup', p, o }); return { id: 'cs_setup_1', url: 'https://checkout.stripe.test/cs_setup_1' }; } } },
};
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: FakeResponse };
  if (request === 'firebase/firestore') return web;
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === 'stripe') return { __esModule: true, default: function Stripe() { return fakeStripe; } };
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level = 'staff') => (!actorNow ? { deny: FakeResponse.json({ ok: false }, { status: 401 }) }
      : level === 'manager' && !actorNow.isManager ? { deny: FakeResponse.json({ ok: false }, { status: 403 }) } : { actor: actorNow }),
    requireCan: async () => (actorNow ? { actor: actorNow } : { deny: FakeResponse.json({ ok: false }, { status: 401 }) }),
    staffOrServer: async () => !!actorNow });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const mails: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => { if (String(url).includes('resend')) mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'm1' }), text: async () => '' }; };
const read = (p: string) => readFileSync(p, 'utf8');

(async () => {
  process.env.RESEND_API_KEY = 're_test'; process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <hello@mail.example.com>'; process.env.STRIPE_SECRET_KEY = 'sk_test';
  const S = await import('../../src/lib/booth-rental-service');
  const RL = await import('../../src/lib/renter-link');
  const Portal = await import('../../src/app/api/portal/renter/route');
  const Notify = await import('../../src/app/api/booths/notify/route');
  const Card = await import('../../src/app/api/booths/setup-card/route');
  const Statement = await import('../../src/app/api/booths/statement/route');
  const PL = await import('../../src/lib/print-link');

  await db.doc(T).set({ name: 'Fern & Co', timezone: 'America/New_York', userId: 'owner1', subscriptionStatus: 'active', publicOrigin: 'https://fern.example.com', stripeAccountId: 'acct_biz', stripeChargesEnabled: true });
  await db.doc(`${T}/booths/b1`).set({ name: 'Room 1', status: 'vacant', locationId: 'loc1' });
  await db.doc(`${T}/booths/b2`).set({ name: 'Room 2', status: 'vacant', locationId: 'loc1' });
  const req = (body: any, ip = '10.0.0.1') => ({ json: async () => body, headers: { get: (k: string) => (k === 'x-forwarded-for' ? ip : null) }, nextUrl: { origin: 'https://fern.example.com', searchParams: new URLSearchParams() } } as any);
  const out = (r: any) => ({ status: r.status, ...(r.body && typeof r.body === 'object' ? r.body : {}) });
  const portal = async (body: any, ip = '10.0.0.1') => out(await Portal.POST(req({ tenantId: 't1', ...body }, ip)));
  const signIn = async (renterId: string, ip = '10.0.0.1') => { const link = await RL.mintRenterLink(db, 't1', renterId, 'https://fern.example.com'); return portal({ action: 'token-login', magicToken: new URL(link!).searchParams.get('rt') }, ip); };

  console.log('Adding a renter');
  const r1 = await S.createRenter(web as any, { tenantId: 't1', locationId: 'loc1', firstName: 'Ana', lastName: 'Diaz', email: 'ana@example.com', phone: '555-201-3344',
    avatarUrl: 'https://img.example.com/ana.jpg', amenitiesEnabled: true, amenityCompAllowance: 2, amenityPayer: 'client', linkedStaffId: 'st_ana',
    credentials: [{ label: 'Food handler card', number: 'FH-1', expiry: '2027-03-01' }], applicationMessage: 'I bake bread.' });
  const ana = await get(`${T}/renters/${r1}`);
  check('every field the form sends is kept', ana?.avatarUrl === 'https://img.example.com/ana.jpg' && ana?.amenitiesEnabled === true && ana?.amenityPayer === 'client'
    && ana?.credentials?.[0]?.label === 'Food handler card' && ana?.linkedStaffId === 'st_ana' && ana?.applicationMessage === 'I bake bread.', ana);
  check('a new renter starts as new (prospective)', ana?.status === 'prospective');

  console.log('A lease that waits for a signature');
  const lease = (extra: any) => ({ tenantId: 't1', locationId: 'loc1', boothId: 'b1', renterId: r1, rentAmountCents: 80000, frequency: 'monthly', dueDay: 1, firstChargeDate: '2026-12-01', startDate: '2026-12-01', endDate: null,
    autoRenew: true, earlyTerminationNoticeDays: 30, deposit: null, lateFeePolicy: { enabled: false, graceDays: 0, type: 'flat', amountCents: 0 }, scheduleSlot: null, perks: [], includedAmenities: [], houseRules: '', signedDocumentUrl: null, isShared: false, ...extra });
  let threw = '';
  try { await S.createLease(web as any, lease({ requireSignature: true, leaseTerms: '   ' }) as any); } catch (e: any) { threw = String(e?.message || ''); }
  check('asking for a signature with no terms is refused, with a reason', /terms/.test(threw), threw);
  const l1 = await S.createLease(web as any, lease({ requireSignature: true, leaseTerms: 'Rent is $800 a month, due on the 1st.', renterName: 'Ana Diaz', sentBy: 'Fern & Co' }) as any);
  const L1 = await get(`${T}/leases/${l1}`);
  check('the lease waits for the signature, with its terms saved', L1?.status === 'pending_signature' && L1?.leaseTerms === 'Rent is $800 a month, due on the 1st.', L1);
  const signDoc = L1?.signatureDocumentId ? await get(`${T}/renterDocuments/${L1.signatureDocumentId}`) : null;
  check('the terms go to the renter’s portal as their lease to sign', signDoc?.kind === 'lease' && signDoc?.status === 'sent' && signDoc?.leaseId === l1 && signDoc?.action === 'sign' && signDoc?.body === L1?.leaseTerms, signDoc);
  check('the space is held for them meanwhile', (await get(`${T}/booths/b1`))?.status === 'occupied');
  check('they stay a new renter until they sign', (await get(`${T}/renters/${r1}`))?.status === 'prospective');
  const nightly = read('src/app/api/cron/nightly/route.ts'); const autopay = read('src/app/api/cron/autopay-leases/route.ts');
  check('nothing bills a lease waiting for its signature (the rent jobs read active leases only)',
    /leases`\)\.where\('status', '==', 'active'\)/.test(nightly) && /leases`\)\.where\('status', '==', 'active'\)/.test(autopay));
  const l2 = await S.createLease(web as any, lease({ boothId: 'b2', requireSignature: false, leaseTerms: '' }) as any);
  check('without a signature asked for, the lease starts at once and nothing is sent to sign', (await get(`${T}/leases/${l2}`))?.status === 'active'
    && (await db.collection(`${T}/renterDocuments`).where('leaseId', '==', l2).get()).size === 0);

  console.log('Sending the portal link with the lease');
  mails.length = 0;
  const inv = out(await Notify.POST(req({ tenantId: 't1', action: 'portal-invite', renterId: r1, reason: 'lease' })));
  const mail = mails[0] || {};
  check('the email says the lease is ready to sign', inv.ok && /ready to sign/.test(String(mail.subject || '')) && /Read and sign my lease/.test(String(mail.html || '')), { inv, subject: mail.subject });
  const wiz = read('src/app/(app)/booths/page.tsx'); const lb = read('src/components/renters/LeaseBuilder.tsx');
  check('the lease builder sends the portal link when asked (on by default)', /const \[invite, setInvite\] = React\.useState\(true\)/.test(lb) && /action: 'portal-invite', tenantId, renterId: renter\.id, reason: sign \? 'lease' : 'welcome'/.test(lb) && /<LeaseBuilder/.test(wiz));
  check('the wizard no longer promises a "Documents tab" or auto-collection that never waited', !/signs in their portal \(Documents tab\)/.test(wiz) && !/Rent auto-collection begins only after they sign/.test(wiz));

  console.log('Signing in the portal');
  const s1 = await signIn(r1);
  check('a personal link greets the renter by name', s1.ok && s1.name === 'Ana Diaz', s1);
  const today = await portal({ action: 'today', token: s1.token });
  check('the portal says the lease is ready to sign', (today.items || []).some((i: any) => i.title === 'Your lease is ready to sign'), today.items);
  const r2 = await S.createRenter(web as any, { tenantId: 't1', locationId: 'loc1', firstName: 'Bo', lastName: 'Lee', email: 'bo@example.com' });
  const s2 = await signIn(r2, '10.0.0.2');
  await db.doc(`${T}/renters/${r1}`).set({ autopayEnabled: true, cardOnFile: true, stripeCustomerId: 'cus_a', stripePaymentMethodId: 'pm_a', stripeCustomerAccount: 'acct_biz' }, { merge: true });
  const waitMe = await portal({ action: 'me', token: s1.token, today: '2026-11-08' });
  check('before signing, the portal promises no rent date and doesn’t call autopay on', waitMe.rentOutlook?.waitingSignature === true && !waitMe.rentOutlook?.nextDue && waitMe.rentOutlook?.autopayOn === false, waitMe.rentOutlook);
  await db.doc(`${T}/renters/${r1}`).set({ autopayEnabled: false, cardOnFile: false, stripeCustomerId: null, stripePaymentMethodId: null, stripeCustomerAccount: null }, { merge: true });
  check('another renter can’t sign it', (await portal({ action: 'document-sign', token: s2.token, documentId: L1.signatureDocumentId, signedName: 'Bo Lee' })).status === 403);
  const signed = await portal({ action: 'document-sign', token: s1.token, documentId: L1.signatureDocumentId, signedName: 'Ana Diaz' });
  const L1b = await get(`${T}/leases/${l1}`);
  check('signing starts the lease, and they become an active renter', signed.ok && L1b?.status === 'active' && L1b?.signedDocumentId === signed.signedDocumentId && L1b?.signedByName === 'Ana Diaz'
    && (await get(`${T}/renters/${r1}`))?.status === 'active', { signed, L1b });
  const rec = await get(`${T}/signedDocuments/${signed.signedDocumentId}`);
  check('the signature is kept as a lease signature, with the exact terms', rec?.kind === 'lease' && /\$800 a month/.test(String(rec?.agreementText || rec?.text || JSON.stringify(rec))), rec && { kind: rec.kind });
  // A lease the business ended before it was signed: its copy is taken back, and an old copy can't start it.
  await db.doc(`${T}/booths/b3`).set({ name: 'Room 3', status: 'vacant', locationId: 'loc1' });
  const l3 = await S.createLease(web as any, lease({ boothId: 'b3', requireSignature: true, leaseTerms: 'Room 3 terms.' }) as any);
  const L3 = await get(`${T}/leases/${l3}`);
  await S.endLease(web as any, 't1', { id: l3, ...L3 } as any, r1, [{ id: l1, ...(await get(`${T}/leases/${l1}`)) }, { id: l3, ...L3 }] as any);
  check('ending a lease that was never signed takes its copy back from the portal', (await get(`${T}/renterDocuments/${L3.signatureDocumentId}`))?.status === 'withdrawn');
  await db.doc(`${T}/renterDocuments/${L3.signatureDocumentId}`).set({ status: 'sent' }, { merge: true });   // as if taken back by an older app
  const late = await portal({ action: 'document-sign', token: s1.token, documentId: L3.signatureDocumentId, signedName: 'Ana Diaz' });
  check('…and signing an ended lease is refused, without marking anything signed', late.status === 409 && (await get(`${T}/leases/${l3}`))?.status === 'ended'
    && (await get(`${T}/renterDocuments/${L3.signatureDocumentId}`))?.status === 'sent', late);
  check('it can’t be signed twice', (await portal({ action: 'document-sign', token: s1.token, documentId: L1.signatureDocumentId, signedName: 'Ana Diaz' })).status === 400);
  const note = (await db.collection(`${T}/notifications`).where('type', '==', 'renter_document').get()).docs.map((d: any) => d.data().message);
  check('the owner is told the lease is now active', note.some((m: string) => /Ana Diaz has signed "Your lease"\. Their lease is now active/.test(m)), note);

  console.log('Card on file');
  const me1 = await portal({ action: 'me', token: s1.token, today: '2026-11-08' });
  check('with no card, the portal says so', me1.ok && me1.renter?.cardUsable === false && me1.renter?.cardOnFile === false);
  await db.doc(`${T}/renters/${r1}`).set({ cardOnFile: true, stripeCustomerId: 'cus_old', stripePaymentMethodId: 'pm_old', cardBrand: 'visa', cardLast4: '4242' }, { merge: true });
  check('a card saved before the business’s payments moved isn’t counted as usable', (await portal({ action: 'me', token: s1.token, today: '2026-11-08' })).renter?.cardUsable === false);
  await db.doc(`${T}/renters/${r1}`).set({ stripeCustomerAccount: 'acct_biz' }, { merge: true });
  check('a card on the business’s account is usable', (await portal({ action: 'me', token: s1.token, today: '2026-11-08' })).renter?.cardUsable === true);
  stripeCalls.length = 0;
  const cs = out(await Card.POST(req({ tenantId: 't1', renterId: r1, portalToken: s1.token, returnUrl: 'https://fern.example.com/rent/t1' })));
  const setup = stripeCalls.find((c) => c.what === 'setup');
  check('a signed-in renter opens the card page on the business’s account', cs.ok && /checkout\.stripe\.test/.test(cs.url) && setup?.o?.stripeAccount === 'acct_biz' && setup?.p?.metadata?.cfAuth === 'renter', { cs, setup: setup && setup.p.metadata });
  check('…and comes back to their portal', /^https:\/\/fern\.example\.com\/rent\/t1\?cfCardSetup=1&cfSetupSession=/.test(String(setup?.p?.success_url || '')), setup?.p?.success_url);
  check('someone else’s portal session can’t open a card page for them', out(await Card.POST(req({ tenantId: 't1', renterId: r1, portalToken: s2.token, returnUrl: 'https://fern.example.com/rent/t1' }))).status === 401);
  const page = read('src/app/rent/[tenantId]/page.tsx'); const cardUi = read('src/components/rent/RenterCard.tsx');
  check('the portal’s Rent tab has the card and autopay, and handles the return', /<RenterCard /.test(page) && /cfCardSetup/.test(page) && /portalToken: token/.test(cardUi) && /autopayOn/.test(page));

  console.log('Rent history by renter, not by name');
  const s3r = await S.createRenter(web as any, { tenantId: 't1', locationId: 'loc1', firstName: 'Ana', lastName: 'Diaz', email: 'ana.other@example.com' });
  await db.doc(`${T}/rentInvoices/inv_other`).set({ renterId: s3r, amountCents: 50000, status: 'paid', dueDate: '2026-10-01' });
  await db.doc(`${T}/transactions/t_other`).set({ source: 'booth_rent', type: 'income', amount: 500, clientOrVendor: 'Ana Diaz', sourceId: 'inv_other', date: '2026-10-01' });
  await db.doc(`${T}/transactions/t_mine_new`).set({ source: 'booth_rent', type: 'income', amount: 800, clientOrVendor: 'Ana Diaz', renterId: r1, date: '2026-11-01' });
  await db.doc(`${T}/transactions/t_mine_old`).set({ source: 'booth_rent', type: 'income', amount: 800, clientOrVendor: 'Ana D.', sourceId: l1, date: '2026-10-02' });
  const pay = ((await portal({ action: 'me', token: s1.token, today: '2026-11-08' })).payments || []).map((p: any) => p.id).sort();
  check('a renter sees their own payments (new and older ones), not another renter’s with the same name', JSON.stringify(pay) === JSON.stringify(['t_mine_new', 't_mine_old']), pay);
  await db.doc(`${T}/boothReservations/res_ana`).set({ renterId: r1, phone: '555-201-3344', email: 'ana@example.com', status: 'completed', startDate: '2026-09-10', endDate: '2026-09-10', amountCents: 6000, boothName: 'Room 2', stripePaymentIntentId: 'pi_res' });
  await db.doc(`${T}/transactions/boothrent_res_ana`).set({ source: 'booth_rent', type: 'income', amount: 60, category: 'Booth Rent', sourceId: 'res_ana', stripePaymentIntentId: 'pi_res', date: '2026-09-10', description: 'Day rental' });
  await db.doc(`${T}/transactions/boothover_res_ana`).set({ source: 'booth_rent', type: 'income', amount: 12.5, category: 'Booth Rent', sourceId: 'res_ana', stripePaymentIntentId: 'pi_over', date: '2026-09-10', description: 'Overage — Room 2' });
  const sUrl = PL.signPrintLink('/api/booths/statement', { tenantId: 't1', renterId: r1, year: '2026' })!;
  const st: any = await Statement.GET({ url: new URL(sUrl, 'https://fern.example.com').toString(), nextUrl: { searchParams: new URL(sUrl, 'https://x.test').searchParams } } as any);
  const html = String(st.body || '');
  check('the annual statement leaves out the other renter’s payment', st.status === 200 && html.includes('800.00') && !html.includes('500.00'), st.status);
  check('…counts a booking once, and keeps its overage', (html.match(/60\.00/g) || []).length === 1 && html.includes('12.50'));
  const { readdirSync, statSync } = await import('fs'); const { join } = await import('path');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const byName = walk('src').filter((f) => /\.(tsx?)$/.test(f)).filter((f) => { const x = read(f); if (!/booth_rent/.test(x)) return false; return /where\('clientOrVendor', '=='/.test(x) || /names\.includes\(String\(t\.clientOrVendor/.test(x) || /namesToMatch/.test(x); });
  check('nothing in the app matches rent payments by name any more', byName.length === 0, byName);
  const MR = await import('../../src/lib/my-rent');
  await db.doc(`${T}/staff/st_ana`).set({ name: 'Ana Diaz', email: 'ana@example.com', isRenter: true, renterId: r1 });
  await db.doc(`${T}/renters/${r1}`).set({ linkedStaffId: 'st_ana' }, { merge: true });
  const mine = ((await MR.myRent(db, 't1', 'st_ana')) as any).payments.map((p: any) => p.id).sort();
  check('the staff portal’s rent tab shows only their own payments too (their rent and their bookings)', JSON.stringify(mine) === JSON.stringify(['boothover_res_ana', 'boothrent_res_ana', 't_mine_new', 't_mine_old']), mine);
  check('new rent payment lines record whose they are', /renterId: paymentRenter\.id/.test(read('src/app/(app)/rent/page.tsx')) && read('src/app/api/rent/record-payment/route.ts').includes('tx.set(txnRef, { ...entry, id: txnRef.id, tenantId, renterId,') && wiz.includes("fetch('/api/rent/deposit'") && read('src/lib/rent-deposit.ts').includes('tenantId, renterId: renterId || null, leaseId'));

  console.log('Renters page');
  const rp = read('src/app/(app)/renters/page.tsx');
  check('new renters have their own filter, an Add renter button and a lease shortcut', /filter === 'new'/.test(rp) && /href="\/booths\?addRenter=1"/.test(rp) && /Set up lease/.test(rp) && /addRenter/.test(wiz));
  check('the staff portal no longer tries to write a lease from the browser', !/updateDoc\(doc\(firestore, `tenants\/\$\{tenantId\}\/leases`/.test(read('src/components/shared/RenterDocumentsTab.tsx')));

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
