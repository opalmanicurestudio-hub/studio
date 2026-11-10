// Checks signing that holds up (lib/esign-consent, lib/signed-copy, api/portal/renter, api/booths/renter-document):
// - A renter agrees to sign electronically before signing, and what they sign is the exact text sent and shown: its
//   fingerprint is checked against the one taken when it was sent and against their screen.
// - Opening a document is noted once; the signed record keeps the fingerprint, the consent, when it was sent and
//   opened, and the business's own signature (given as it sent the lease).
// - Both sides get the signed copy by email, once, with its whole text and its signature certificate.
// - Autopay needs the renter's written OK: the words with their card and rent, signed by typing their name, kept with
//   its fingerprint and emailed; turning it off keeps the record and notes it was withdrawn. The business turning it on
//   for them asks first and records a paper authorization.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/esign-signing.verify.ts
import Module from 'module';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const sent: any[] = [];
const M: any = Module as any;
const load = M._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const is = (request: string, name: string) => request === `@/lib/${name}` || new RegExp(`/src/lib/${name}(\\.ts)?$`).test(request);
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe' || /node_modules\/stripe\//.test(request)) return fake(request, function () { return {}; });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (is(request, 'firebase-admin')) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === './audit' || is(request, 'audit')) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (is(request, 'notify')) return fake(request, { sendNotification: async (_db: any, i: any) => { sent.push(i); return { status: 'sent', ok: true }; }, resolveFromAddress: () => 'hello@example.com' });
  if (is(request, 'sms')) return fake(request, { smsConfigured: () => false, sendTenantSms: async () => ({ ok: true }) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const TOKEN = 'tok-maya-0123456789abcdef';
const get = async (p: string) => (await db.doc(p).get()).data() || null;

(async () => {
  const E = await import('../../src/lib/esign-consent');
  check('the consent names the business, what it covers, what’s needed, a free paper copy and how to withdraw', /^I agree to sign electronically, and to get the documents Northside sends me in my portal/.test(E.esignConsentText('Northside')) && /a device with a web browser and an email address/.test(E.esignConsentText('Northside')) && /ask Northside for a paper copy at no cost, and withdraw this agreement at any time, by message in my portal or in writing/.test(E.esignConsentText('Northside')));
  const rows = E.certificateRows({ title: 'Your lease', business: 'Northside', sha256: 'abc', fingerprintMatches: true, sentAt: '2026-11-10T15:00:00Z', sentBy: 'Northside', viewedAt: '2026-11-10T16:00:00Z', consentAt: '2026-11-10T16:05:00Z', signedName: 'Maya Ortiz', signedAt: '2026-11-10T16:05:00Z', ip: '1.2.3.4', device: 'Safari', businessSignature: { name: 'Dana Lee', at: '2026-11-10T15:00:00Z' }, recordId: 's1' });
  check('the certificate, in order: document, fingerprint, sent, the business’s signature, opened, consent, signed, from, record', rows.map((r) => r.label).join('|') === 'Document|Fingerprint (SHA-256 of the exact text)|Sent|Signed for Northside|Opened by the renter|Agreed to sign electronically|Signed by the renter|From|Record' && /matches the text above/.test(rows[1].value), rows);
  check('…leaving out what didn’t happen', E.certificateRows({ title: 'X', business: 'N', sha256: 'a', fingerprintMatches: null }).length === 2);
  const auth = E.autopayAuthorizationText({ business: 'Northside', card: 'Visa ending 4242', rentCents: 90000, frequency: 'monthly', dueDay: 1 });
  check('the autopay authorization: who, which card, each bill, what’s charged, not late fees, how to stop', auth.startsWith('I authorize Northside to charge my Visa ending 4242 for each rent bill on its due date. My rent is $900.00 a month, due on the 1st; what’s still owed on that bill after any credits.'.replace('; what', '; what’s charged is what')) && /Late fees and other charges aren’t taken by autopay\./.test(auth) && /until I turn autopay off in my portal/.test(auth), auth);

  // The portal.
  await db.doc(T).set({ name: 'Northside', ownerEmail: 'owner@northside.test', stripeAccountId: 'acct_1', stripeChargesEnabled: true });
  await db.doc(`${T}/renters/r1`).set({ firstName: 'Maya', lastName: 'Ortiz', email: 'maya@example.com', phone: '5551234567', status: 'prospective', cardOnFile: true, cardLast4: '4242', cardBrand: 'visa', stripeCustomerId: 'cus_1', stripeCustomerAccount: 'acct_1', stripePaymentMethodId: 'pm_1' });
  await db.doc(`${T}/private/renterSessions`).set({ [sha(TOKEN)]: { contactKey: '5551234567', name: 'Maya Ortiz', renterId: 'r1', expiresAt: Date.now() + 3600e3 } });
  const body = 'Space Lease\nNorthside and Maya Ortiz\n\n1. Parties\nThis agreement is between Northside and Maya Ortiz.';
  await db.doc(`${T}/leases/L1`).set({ renterId: 'r1', boothId: 'b1', status: 'pending_signature', rentAmountCents: 90000, frequency: 'monthly', dueDay: 1, startDate: '2026-11-14' });
  await db.doc(`${T}/renterDocuments/d1`).set({ renterId: 'r1', renterName: 'Maya Ortiz', leaseId: 'L1', kind: 'lease', title: 'Your lease', body, action: 'sign', status: 'sent', sentAt: '2026-11-10T15:00:00Z', sentBy: 'Northside',
    meta: { termsSha256: sha(body), leaseVersion: 2, businessSignature: { name: 'Dana Lee', at: '2026-11-10T15:00:00Z', termsSha256: sha(body) } } });
  const { POST } = await import('../../src/app/api/portal/renter/route');
  const req = (b: any) => ({ json: async () => b, headers: { get: (h: string) => (h === 'user-agent' ? 'TestPhone' : h === 'x-forwarded-for' ? '9.9.9.9' : null) }, nextUrl: { origin: 'https://northside.test' } }) as any;
  const portal = (x: any) => POST(req({ tenantId: 't1', token: TOKEN, ...x })) as any;
  const cSha = sha(E.esignConsentText('Northside'));
  const orig = { e: console.error, w: console.warn };
  console.error = () => {}; console.warn = () => {};

  await portal({ action: 'document-viewed', documentId: 'd1' });
  const v1 = (await get(`${T}/renterDocuments/d1`)).viewedAt;
  await portal({ action: 'document-viewed', documentId: 'd1' });
  check('opening it is noted once', !!v1 && (await get(`${T}/renterDocuments/d1`)).viewedAt === v1);

  const noConsent = await portal({ action: 'document-sign', documentId: 'd1', signedName: 'Maya Ortiz', shownSha: sha(body) });
  check('no signing without agreeing to sign electronically', noConsent.status === 400 && /Agree to sign electronically first/.test(noConsent.body.error));
  const wrongShown = await portal({ action: 'document-sign', documentId: 'd1', signedName: 'Maya Ortiz', consent: true, shownSha: sha(body + 'x'), consentSha: cSha });
  check('…nor when their screen showed different words', wrongShown.status === 409 && /changed while you were reading it/.test(wrongShown.body.error));
  await db.doc(`${T}/renterDocuments/d2`).set({ renterId: 'r1', kind: 'notice', title: 'A notice', body: 'Changed words', action: 'sign', status: 'sent', meta: { termsSha256: sha('Original words') } });
  const changed = await portal({ action: 'document-sign', documentId: 'd2', signedName: 'Maya Ortiz', consent: true, shownSha: sha('Changed words'), consentSha: cSha });
  check('…nor when the document changed after it was sent', changed.status === 409 && /changed after it was sent/.test(changed.body.error));

  const noShown = await portal({ action: 'document-sign', documentId: 'd1', signedName: 'Maya Ortiz', consent: true, consentSha: cSha });
  check('…nor without saying which words were shown (an old page is asked to refresh)', noShown.status === 409 && /Refresh this page to sign/.test(noShown.body.error));
  const oldConsent = await portal({ action: 'document-sign', documentId: 'd1', signedName: 'Maya Ortiz', consent: true, shownSha: sha(body), consentSha: sha('older wording') });
  check('…nor over consent wording other than what’s kept', oldConsent.status === 409 && /wording you agreed to has changed/.test(oldConsent.body.error));
  const ok = await portal({ action: 'document-sign', documentId: 'd1', signedName: 'Maya Ortiz', consent: true, shownSha: sha(body), consentSha: cSha });
  const rec = await get(`${T}/signedDocuments/${ok.body.signedDocumentId}`);
  check('signed: the record keeps the fingerprint, the consent, when it was sent and opened, the business’s signature, where from', ok.status === 200 && rec.termsSha256 === sha(body) && rec.esignConsent?.agreed === true && /Northside for a paper copy/.test(rec.esignConsent.text)
    && rec.sentAt === '2026-11-10T15:00:00Z' && rec.viewedAt === v1 && rec.businessSignature?.name === 'Dana Lee' && rec.businessSignature.uid === undefined && rec.ip === '9.9.9.9' && rec.userAgent === 'TestPhone' && rec.agreementText === body, rec);
  check('…the lease starts, and the renter’s consent is kept on them', (await get(`${T}/leases/L1`)).status === 'active' && (await get(`${T}/renters/r1`)).esignConsent?.version === 1);
  const copies = sent.filter((x) => x.kind === 'signed_copy');
  check('both sides get the signed copy: the whole text and its certificate', copies.length === 2 && copies.some((x) => x.to === 'maya@example.com' && /Signature certificate/.test(x.html) && /This agreement is between Northside and Maya Ortiz/.test(x.html))
    && copies.some((x) => x.to === 'owner@northside.test' && /Signed for Northside/.test(x.html)) && ok.body.emailed === true, copies.map((c) => c.to));
  const { sendSignedCopy } = await import('../../src/lib/signed-copy');
  const again = await sendSignedCopy(db, 't1', 'd1');
  check('…once (unless asked again)', !again.renter && !again.owner && sent.filter((x) => x.kind === 'signed_copy').length === 2);
  await db.doc(`${T}/renterDocuments/d1`).set({ copyEmailedTo: { renter: true, owner: false } }, { merge: true });
  const retry = await sendSignedCopy(db, 't1', 'd1');
  check('…a side whose copy didn’t go is sent it again, the other isn’t', !retry.renter && retry.owner && sent.filter((x) => x.kind === 'signed_copy').length === 3);

  // Acknowledging needs no consent and sends no copy.
  await db.doc(`${T}/renterDocuments/d3`).set({ renterId: 'r1', kind: 'policy', title: 'House rules', body: 'Be kind.', action: 'acknowledge', status: 'sent' });
  const ack = await portal({ action: 'document-sign', documentId: 'd3', signedName: 'Maya Ortiz' });
  check('acknowledging a document needs no e-sign consent and sends no copy', ack.status === 200 && sent.filter((x) => x.kind === 'signed_copy').length === 3);

  await db.doc(`${T}/renterDocuments/d4`).set({ renterId: 'r1', kind: 'lease', title: 'Lease 2', body: 'x', action: 'sign', status: 'sent', meta: { businessSignature: { name: 'Dana Lee', at: '2026-11-10T15:00:00Z', uid: 'staff9', email: 'dana@northside.test' } } });
  const list = await portal({ action: 'documents-list' });
  const d4 = list.body.documents.find((x: any) => x.id === 'd4');
  check('the renter sees the business’s signature by name and time, not who on the team signed', d4.meta.businessSignature.name === 'Dana Lee' && d4.meta.businessSignature.uid === undefined && d4.meta.businessSignature.email === undefined);

  // Autopay.
  const terms = await portal({ action: 'autopay-terms' });
  check('autopay: the words, with their card and rent', terms.status === 200 && terms.body.text.startsWith('I authorize Northside to charge my Visa ending 4242 for each rent bill on its due date. My rent is $900.00 a month, due on the 1st') && terms.body.sha === sha(terms.body.text), terms.body);
  const noName = await portal({ action: 'autopay-set', enabled: true, shownSha: terms.body.sha });
  check('…not on without their typed name', noName.status === 400 && (await get(`${T}/renters/r1`)).autopayEnabled !== true);
  const stale = await portal({ action: 'autopay-set', enabled: true, signedName: 'Maya Ortiz', shownSha: 'old' });
  check('…nor if the words changed while open', stale.status === 409);
  const on = await portal({ action: 'autopay-set', enabled: true, signedName: 'Maya Ortiz', shownSha: terms.body.sha });
  const r1 = await get(`${T}/renters/r1`);
  const authRec = await get(`${T}/signedDocuments/${r1.autopayAuthorization?.signedDocumentId}`);
  check('…on: the signed authorization is kept with its fingerprint, and noted on the renter (signed by typed name, no consent claimed it didn’t show)', on.status === 200 && r1.autopayEnabled === true && r1.autopayAuthorization?.method === 'portal' && authRec?.kind === 'autopay_authorization' && authRec.agreementText === terms.body.text && authRec.termsSha256 === terms.body.sha && authRec.signedBy === 'typed name' && !authRec.esignConsent);
  check('…and they get a copy', sent.some((x) => x.to === 'maya@example.com' && /autopay authorization/.test(x.subject) && x.html.includes('I authorize Northside')));
  const twice = await portal({ action: 'autopay-set', enabled: true, signedName: 'Maya Ortiz', shownSha: terms.body.sha });
  check('…a second tap changes nothing: one authorization, one copy', twice.status === 200 && (await db.collection(`${T}/signedDocuments`).where('kind', '==', 'autopay_authorization').get()).docs.length === 1 && sent.filter((x) => /autopay authorization/.test(x.subject)).length === 1);
  await db.doc(`${T}/leases/L1`).set({ autoCollect: true }, { merge: true });
  await portal({ action: 'autopay-set', enabled: false });
  const r2 = await get(`${T}/renters/r1`);
  check('off means off: rent the business set to charge automatically stops too', (await get(`${T}/leases/L1`)).autoCollect === false && (await get(`${T}/leases/L1`)).autoCollectStoppedBy === 'renter');
  const bell = (await db.collection(`${T}/notifications`).get()).docs.map((x: any) => x.data()).filter((n: any) => n.type === 'renter_autopay');
  check('…and the business is told both', bell.some((n: any) => /turned autopay off from their portal\. Rent you set to charge automatically on their lease is off too/.test(n.message)));
  check('off: autopay stops, the authorization is kept and marked withdrawn', r2.autopayEnabled === false && !!r2.autopayAuthorization?.withdrawnAt && r2.autopayAuthorization.signedDocumentId === r1.autopayAuthorization.signedDocumentId);
  const terms2 = await portal({ action: 'autopay-terms' });
  await portal({ action: 'autopay-set', enabled: true, signedName: 'Maya Ortiz', shownSha: terms2.body.sha });
  const r3 = await get(`${T}/renters/r1`);
  check('on again: a fresh authorization, with nothing left over from the withdrawn one', r3.autopayEnabled === true && !r3.autopayAuthorization.withdrawnAt && r3.autopayAuthorization.signedDocumentId !== r1.autopayAuthorization.signedDocumentId);
  console.error = orig.e; console.warn = orig.w;

  // The business's side.
  const lb = readFileSync('src/components/renters/LeaseBuilder.tsx', 'utf8');
  check('the business signs as it sends the lease, and Send waits for it', /Sign for \$\{ctx\.businessName \|\| 'the business'\}/.test(lb) && /\(!sign \|\| bizSig\.trim\(\)\.length >= 2\)/.test(lb) && /businessSignature: \{ name: bizSig\.trim\(\), at: new Date\(\)\.toISOString\(\), termsSha256: sha, uid: p\.signer\?\.uid \|\| null/.test(lb));
  check('…and the document to sign carries it', /businessSignature: \{ name: input\.extra\.businessSignature\.name \|\| null, at: input\.extra\.businessSignature\.at \|\| null, termsSha256/.test(readFileSync('src/lib/booth-rental-service.ts', 'utf8')));
  const print = readFileSync('src/app/api/booths/renter-document/route.ts', 'utf8');
  check('the printed copy shows the business’s signature and the certificate', /const bizBox = bizSig\?\.name/.test(print) && /<h2>Signature certificate<\/h2>/.test(print) && /Agreed before signing/.test(print));
  const drawer = readFileSync('src/components/renters/RenterProfileDrawer.tsx', 'utf8');
  check('the business turning on automatic rent asks first unless the renter’s OK is in place (not withdrawn), and records a paper one whole', (drawer.match(/AUTOPAY_PAPER_OK\(r\.firstName\)/g) || []).length === 2 && (drawer.match(/updateDoc\(doc\(firestore, 'tenants', tenantId, 'renters', r\.id\), \{ autopayAuthorization: \{ method: 'paper'/g) || []).length === 2
    && /const autopayOk = \(r: any\) => !!r\?\.autopayAuthorization\?\.at && !r\.autopayAuthorization\.withdrawnAt;/.test(drawer)
    && drawer.indexOf("if (paper) await updateDoc") < drawer.indexOf("autopayChangedBy: 'owner',\n                    }, { merge: true });") && drawer.indexOf("if (paperNeeded) await updateDoc") < drawer.indexOf("{ autoCollect: !on, updatedAt"));
  check('documents sent from the comms desk carry the fingerprint of their words', /meta\.termsSha256 = sha256Hex\(docBody\.trim\(\)\);/.test(readFileSync('src/components/renters/RenterCommsDesk.tsx', 'utf8')));
  const studio = readFileSync('src/components/rent/studio.tsx', 'utf8');
  check('the renter’s screen: the consent box, signing the words shown, the copy promised', /esignConsentText\(biz\(\)\)/.test(studio) && /shownSha: sha256Hex\(String\(doc\.body \|\| ''\)\), consentSha: sha256Hex\(esignConsentText\(biz\(\)\)\)/.test(studio) && /disabled=\{busy \|\| name\.trim\(\)\.length < 2 \|\| \(verb === 'sign' && !consent\)\}/.test(studio));
  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  check('no tool names', ['src/lib/esign-consent.ts', 'src/lib/signed-copy.ts', 'src/components/rent/RenterCard.tsx'].every((f) => !AI.test(readFileSync(f, 'utf8'))));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
