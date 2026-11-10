// Checks one answer for a renter's insurance and license (lib/compliance), wherever it's asked:
// - The newest date on file wins: the renter's own upload in their portal, or an entry in the business's list of their
//   papers ("Esthetics license", "Liability insurance"), with that one's document.
// - A portal upload moves the matching entries in that list to the new date and document, so the owner's screens and
//   the expiry reminders stop saying the old one ran out; the owner's notice opens the renter's own page.
// - Only the one entry named (or marked) as that kind counts: a permit, a certificate, a business license or a second
//   license is a paper of its own, never used to hide an expired license, never overwritten by an upload, and still
//   reminded about. The reminders and the renter card read it the same way.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renter-credentials.verify.ts
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';

(async () => {
  const C = await import('../../src/lib/compliance');
  const today = '2026-11-10';
  const typedIn = { credentials: [{ label: 'Esthetics license', number: 'E-1', expiry: '2026-10-01' }, { label: 'Liability insurance', expiry: '2026-12-01', fileUrl: 'old-ins' }, { label: 'First aid card', expiry: '2026-09-01' }] };
  const v0 = C.credentialViews(typedIn, {}, today);
  check('a date typed into the business’s list counts (it used to be ignored by the new screens)', v0[1].state === 'expired' && v0[1].expiry === '2026-10-01' && v0[0].state === 'expiring' && v0[0].docUrl === 'old-ins', v0);
  const renewed = { ...typedIn, licenseExpiry: '2028-10-01', licenseDocUrl: 'new-lic' };
  const v1 = C.credentialViews(renewed, {}, today);
  check('a renewal uploaded in the portal wins over the old date in the list, with its document', v1[1].state === 'ok' && v1[1].expiry === '2028-10-01' && v1[1].docUrl === 'new-lic', v1);
  const older = { ...typedIn, insuranceExpiry: '2026-06-01', insuranceDocUrl: 'stale' };
  check('…and the other way round: a newer date in the list wins over an older upload', C.credentialViews(older, {}, today)[0].expiry === '2026-12-01' && C.credentialViews(older, {}, today)[0].docUrl === 'old-ins');
  check('names sort into the two kinds; a permit, certificate, registration, business or driver’s license is its own paper', C.credentialKindOf({ label: 'General liability policy' }) === 'insurance' && C.credentialKindOf({ label: 'Cosmetology License' }) === 'license'
    && C.credentialKindOf({ label: 'Food handler permit' }) === null && C.credentialKindOf({ label: 'CPR certificate' }) === null && C.credentialKindOf({ label: 'Business registration' }) === null && C.credentialKindOf({ label: 'Business license' }) === null
    && C.credentialKindOf({ label: 'Driver’s license' }) === null && C.credentialKindOf({ label: 'Anything', kind: 'license' }) === 'license' && C.credentialKindOf('') === null
    && C.credentialKindOf({ label: 'Health insurance card' }) === null && C.credentialKindOf({ label: 'Liability waiver' }) === null && C.credentialKindOf({ label: 'Liability insurance', kind: 'other' }) === null
    && C.primaryCredentialIndex([{ label: 'Liability insurance', kind: 'other' }, { label: 'General liability insurance' }], 'insurance') === 1);
  const busy = { licenseExpiry: '2026-01-15', credentials: [{ label: 'Food handler certificate', expiry: '2027-05-01' }, { label: 'Business registration', expiry: '2028-01-01' }, { label: 'Barber license', expiry: '2026-01-15' }, { label: 'Second state license', expiry: '2029-01-01' }] };
  const vb = C.credentialViews(busy, {}, today);
  check('an expired license isn’t hidden by a later certificate, registration or second license', vb[1].state === 'expired' && vb[1].expiry === '2026-01-15', vb[1]);
  check('the others stay papers of their own (shown and reminded about)', C.otherCredentials(busy.credentials).map((c: any) => c.label).join('|') === 'Food handler certificate|Business registration|Second state license');
  const list = C.credentialsAfterUpload(typedIn.credentials, 'license', { expiry: '2028-10-01', fileUrl: 'new-lic' });
  check('a portal upload moves that kind’s one entry to the new date and document, and leaves the rest', !!list && list[0].expiry === '2028-10-01' && list[0].fileUrl === 'new-lic' && list[0].number === 'E-1' && list[1].fileUrl === 'old-ins' && list[2].expiry === '2026-09-01', list);
  const many = C.credentialsAfterUpload(busy.credentials, 'license', { expiry: '2028-02-01', fileUrl: 'renewed' });
  check('…only that one: a certificate, a registration or a second license keep their own date and file', !!many && many[2].expiry === '2028-02-01' && many[2].fileUrl === 'renewed' && many[0].expiry === '2027-05-01' && !many[0].fileUrl && many[1].expiry === '2028-01-01' && many[3].expiry === '2029-01-01' && !many[3].fileUrl, many);
  check('…nothing to change when there’s no list or nothing matches', C.credentialsAfterUpload(undefined, 'license', { expiry: null, fileUrl: 'x' }) === null && C.credentialsAfterUpload([{ label: 'First aid card' }], 'insurance', { expiry: null, fileUrl: 'x' }) === null);
  check('flat fields alone still work as before', C.credentialViews({ insuranceExpiry: '2027-01-01', insuranceDocUrl: 'd' }, { bookingPageSettings: { automationRules: { requireLicense: true } } }, today).map((v) => v.state).join() === 'ok,missing');

  const portal = readFileSync('src/app/api/portal/renter/route.ts', 'utf8');
  const up = portal.slice(portal.indexOf("if (action === 'upload-credential')"), portal.indexOf("if (action === 'my-tickets')"));
  check('the portal upload updates the business’s list in the same save (read and written together), and the notice opens the renter’s page', /await db\.runTransaction\(async \(tx: any\) => \{\s*const cur: any = \(await tx\.get\(rRef\)\)\.data\(\) \|\| \{\};\s*const list = credentialsAfterUpload\(cur\.credentials, kind,/.test(up) && /tx\.set\(rRef, list \? \{ \.\.\.patch, credentials: list \} : patch, \{ merge: true \}\)/.test(up) && /link: `\/renters\/\$\{encodeURIComponent\(String\(session\.renterId\)\)\}`/.test(up));
  const rem = readFileSync('src/lib/reminders.ts', 'utf8');
  check('the expiry reminders use the same rule, and still remind about every other paper', /const lic = latestCredential\(r, 'license'\);/.test(rem) && /for \(const cr of otherCredentials\(r\?\.credentials\)\)/.test(rem));
  const drawer = readFileSync('src/components/renters/RenterProfileDrawer.tsx', 'utf8');
  check('the renter card’s paper list uses it too', /const on = latestCredential\(r, kind\);/.test(drawer) && /primaryCredentialIndex\(list, kind\)/.test(drawer) && /for \(const cr of otherCredentials\(list\)\)/.test(drawer));
  check('the unused copy on the Spaces page is gone', !/function complianceOf/.test(readFileSync('src/app/(app)/booths/page.tsx', 'utf8')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
