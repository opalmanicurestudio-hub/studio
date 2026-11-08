// Checks launch L3:
// - Sign-up takes the owner's time zone from their device and keeps it on the business and its main location; a
//   missing or made-up one falls back to New York. Settings shows the time zone openly, with a plain warning, when a
//   business has never had one; otherwise it stays tucked away.
// - HQ opens only for a verified email (or one Google or Apple verified): someone on the HQ list with an unverified
//   email is told to verify, with one email to send, and still sees the way in.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-time-zone-hq.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures } from './fake-db';

let token: any = null;
const db = makeDb();
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({ verifyIdToken: async () => { if (!token) throw new Error('bad'); return token; } }) };
  return load.call(this, request, ...rest);
};
process.env.PLATFORM_ADMIN_EMAILS = 'jessica@opal.example';
const req = () => ({ headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer tk' : null) } }) as any;
const read = (p: string) => readFileSync(p, 'utf8');

(async () => {
  console.log('Time zone at sign-up');
  const page = read('src/app/(auth)/signup/page.tsx');
  check('the sign-up page sends the device’s time zone', /timezone: \(\(\) => \{ try \{ return Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/.test(page));
  const route = read('src/app/api/signup/route.ts');
  check('sign-up keeps a real time zone, and falls back to New York for a missing or made-up one', /const timezone = isValidTimeZone\(String\(b\.timezone \|\| ''\)\) \? String\(b\.timezone\)\.trim\(\) : 'America\/New_York';/.test(route));
  check('it’s saved on the business and on its main location', /signupTools: tools, timezone,/.test(route) && /locations\/primary`\), \{ tenantId, name: businessName \|\| 'Main location', timezone,/.test(route));
  const T = await import('../../src/lib/tenant-time');
  check('a real zone passes, a made-up one doesn’t', T.isValidTimeZone('America/Denver') && T.isValidTimeZone('Europe/London') && !T.isValidTimeZone('Mars/Olympus') && !T.isValidTimeZone(''));
  const settings = read('src/app/(app)/settings/page.tsx');
  check('Settings shows the time zone openly, asking to check and save it, when the business never saved one', /Check this is your time zone and save it\./.test(settings) && /!selectedTenant \|\| isValidTimeZone\(\(selectedTenant as any\)\.timezone\)/.test(settings));
  const card = read('src/components/settings/TimezoneSettingCard.tsx');
  check('the time zone list always includes the saved zone and this device’s zone, wherever they are', /const extra = \[saved, here, selected\]/.test(card) && /\(this device\)/.test(card));
  check('saving moves the main location along when it was on the old zone or had none', /locations\/primary/.test(card) && /!l\.timezone \|\| l\.timezone === \(saved \|\| OLD_DEFAULT\)/.test(card));
  check('the card uses the app’s own colors, so it reads the same on Settings and the phone page', !/var\(--accent\)/.test(card) && /bg-foreground/.test(card));
  check('Settings no longer claims it was set at sign-up', !/Set when you signed up/.test(settings));

  console.log('Who opens HQ');
  const P = await import('../../src/lib/platform-admin');
  token = { uid: 'u1', email: 'jessica@opal.example', email_verified: false, firebase: { sign_in_provider: 'password' } };
  let r: any = await P.platformAdminCheck(req());
  check('an HQ owner whose email isn’t verified: not let in, asked to verify', r.member === null && r.unverifiedEmail === 'jessica@opal.example', r);
  check('and nothing else that asks lets them in either', (await P.verifyPlatformAdmin(req())) === null);
  token = { ...token, email_verified: true };
  r = await P.platformAdminCheck(req());
  check('verified: let in as an owner', r.member?.role === 'owner' && !r.unverifiedEmail, r);
  token = { uid: 'u2', email: 'jessica@opal.example', email_verified: false, firebase: { sign_in_provider: 'google.com' } };
  check('signed in with Google (which verifies the email): let in', (await P.verifyPlatformAdmin(req()))?.role === 'owner');
  await db.doc('platformTeam/sam@opal.example').set({ role: 'support', name: 'Sam', active: true });
  token = { uid: 'u3', email: 'sam@opal.example', email_verified: false, firebase: { sign_in_provider: 'password' } };
  r = await P.platformAdminCheck(req());
  check('a team member with an unverified email: asked to verify too', r.member === null && r.unverifiedEmail === 'sam@opal.example', r);
  token = { uid: 'u4', email: 'stranger@x.example', email_verified: false, firebase: { sign_in_provider: 'password' } };
  r = await P.platformAdminCheck(req());
  check('someone not on the list: simply not HQ (and not told to verify)', r.member === null && r.unverifiedEmail === null, r);
  process.env.PLATFORM_ADMIN_UIDS = 'u9';
  token = { uid: 'u9', email: 'jessica@opal.example', email_verified: false, firebase: { sign_in_provider: 'password' } };
  check('last resort: an owner whose sign-in id is listed gets in without the email', (await P.verifyPlatformAdmin(req()))?.role === 'owner');
  token = { uid: 'u8', email: 'nobody@x.example', email_verified: false, firebase: { sign_in_provider: 'password' } };
  check('a listed id still needs to be on the HQ list', (await P.verifyPlatformAdmin(req())) === null);
  token = null;
  check('no sign-in: nothing', (await P.platformAdminCheck(req())).member === null);
  const inv = read('src/app/api/invites/route.ts');
  check('invites say "verify your email" too', /platformAdminCheck\(req\)/.test(inv) && /Verify your email to open HQ\./.test(inv));

  const hq = read('src/app/api/hq/route.ts');
  check('HQ’s who-am-I says when to verify', /verifyEmail: !!unverifiedEmail/.test(hq) && /if \(unverifiedEmail\) return NextResponse\.json\(\{ ok: false, error: 'Verify your email to open HQ\.' \}/.test(hq));
  const shell = read('src/components/hq/hq.tsx');
  check('HQ shows one card to send the link and come back', /me\?\.verifyEmail \? <VerifyEmailCard email=\{me\.email\} \/> : children/.test(shell) && /sendEmailVerification\(u\)/.test(shell) && /getIdToken\(true\)/.test(shell));
  check('Done says so when the email isn’t verified yet; too many links are explained', /Your email isn’t verified yet\./.test(shell) && /too-many-requests/.test(shell));
  check('one import line for sign-in in HQ', (shell.match(/from 'firebase\/auth'/g) || []).length === 1);
  const help = read('src/components/support/HelpDesk.tsx');
  check('the way into HQ stays visible while they verify', /setYes\(!!d\?\.admin \|\| !!d\?\.verifyEmail\)/.test(help));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
