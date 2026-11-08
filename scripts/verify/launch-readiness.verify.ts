// Checks HQ's "Ready to launch?" (lib/launch-readiness, shown on HQ System): every setting, Stripe webhook and
// published rule the platform needs, grouped by how much it matters, with a fix for each — and never a value.
// Also checks the rules fingerprint is current, so HQ compares Firebase with the latest rules.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-readiness.verify.ts
import Module from 'module';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { check, failures } from './fake-db';

// Stripe and Firebase's rules service are stood in for: what they answer is set per check below.
let stripeAnswer: () => Promise<any> = async () => ({ data: [] });
let rulesAnswer: { firestore: () => Promise<any>; storage: () => Promise<any> } = { firestore: async () => ({ source: [] }), storage: async () => ({ source: [] }) };
class FakeStripe { webhookEndpoints = { list: () => stripeAnswer() }; constructor(_k: string, _o: any) {} }
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminApp: () => ({}), getAdminDb: () => ({}) };
  if (request === '@/lib/notify') return { resolveFromAddress: () => String(process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM || '').trim() || 'ClarityFlow <onboarding@resend.dev>' };
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'firebase-admin/security-rules') return { getSecurityRules: () => ({ getFirestoreRuleset: () => rulesAnswer.firestore(), getStorageRuleset: () => rulesAnswer.storage() }) };
  return load.call(this, request, ...rest);
};
const read = (p: string) => readFileSync(p, 'utf8');
const KEYS = ['FIREBASE_ADMIN_PROJECT_ID', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY', 'FIREBASE_STORAGE_BUCKET', 'STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_CONNECT_WEBHOOK_SECRET', 'STRIPE_BILLING_WEBHOOK_SECRET', 'RESEND_API_KEY', 'NOTIFY_FROM_EMAIL', 'CRON_SECRET', 'PLATFORM_ADMIN_EMAILS', 'NEXT_PUBLIC_APP_URL', 'VERCEL_PROJECT_PRODUCTION_URL',
  'PIN_PEPPER', 'NEXT_PUBLIC_FIREBASE_VAPID_KEY', 'NEXT_PUBLIC_LEGAL_NAME', 'NEXT_PUBLIC_SUPPORT_EMAIL', 'NEXT_PUBLIC_LEGAL_ADDRESS', 'NEXT_PUBLIC_LEGAL_STATE', 'SHIPPO_API_KEY', 'DEFAULT_SMS_TENANT_ID',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_MESSAGING_SERVICE_SID', 'TWILIO_FROM', 'MAPBOX_TOKEN', 'LEADS_NOTIFY_EMAIL', 'NEXT_PUBLIC_TENOR_API_KEY', 'RESEND_FROM'];
const clear = () => { for (const k of KEYS) delete process.env[k]; };
const full = () => {
  clear();
  Object.assign(process.env, {
    FIREBASE_ADMIN_PROJECT_ID: 'p', FIREBASE_ADMIN_CLIENT_EMAIL: 'svc@p.example', FIREBASE_ADMIN_PRIVATE_KEY: 'PRIVATE-KEY-VALUE', FIREBASE_STORAGE_BUCKET: 'p.appspot.com',
    STRIPE_SECRET_KEY: 'sk_live_SECRETVALUE', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_abc', STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_CONNECTVALUE', STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_BILLVALUE',
    RESEND_API_KEY: 're_RESENDVALUE', NOTIFY_FROM_EMAIL: 'Opal <hello@opal.example>', CRON_SECRET: 'CRONVALUE', PLATFORM_ADMIN_EMAILS: 'jess@opal.example', NEXT_PUBLIC_APP_URL: 'https://app.example',
    PIN_PEPPER: 'PEPPERVALUE', NEXT_PUBLIC_FIREBASE_VAPID_KEY: 'vapid',
  });
};

(async () => {
  const N = await import('../../src/lib/rules-normalize');
  const { RULES_FINGERPRINT } = await import('../../src/lib/rules-fingerprint');
  console.log('Rules fingerprint');
  check('the fingerprint matches today’s firestore.rules (run node scripts/rules-fingerprint.mjs after a rules change)', N.rulesFingerprint(read('firestore.rules')) === RULES_FINGERPRINT.firestore);
  check('…and today’s storage.rules', N.rulesFingerprint(read('storage.rules')) === RULES_FINGERPRINT.storage);
  check('a console paste with Windows line endings or trailing spaces still matches', N.rulesFingerprint(read('firestore.rules').replace(/\n/g, '  \r\n') + '\n\n') === RULES_FINGERPRINT.firestore);
  check('a real change doesn’t', N.rulesFingerprint(read('firestore.rules').replace('allow read, write: if false;', 'allow read, write: if true;')) !== RULES_FINGERPRINT.firestore);
  // The build-time script writes the same fingerprint the app checks with (it runs before every build: package.json).
  copyFileSync('src/lib/rules-fingerprint.ts', '/tmp/rules-fingerprint.bak');
  writeFileSync('src/lib/rules-fingerprint.ts', 'export const RULES_FINGERPRINT = { firestore: \'stale\', storage: \'stale\' } as const;\n');
  execFileSync('node', ['scripts/rules-fingerprint.mjs'], { stdio: 'ignore' });
  const regenerated = read('src/lib/rules-fingerprint.ts');
  copyFileSync('/tmp/rules-fingerprint.bak', 'src/lib/rules-fingerprint.ts');
  check('the build script writes the same fingerprint, and runs before every build', regenerated.includes(`firestore: '${RULES_FINGERPRINT.firestore}'`) && regenerated.includes(`storage: '${RULES_FINGERPRINT.storage}'`) && /"prebuild": "node scripts\/rules-fingerprint\.mjs"/.test(read('package.json')));

  const L = await import('../../src/lib/launch-readiness');
  console.log('Stripe webhooks');
  const all = { url: 'https://app.example/api/stripe/connect-webhook', status: 'enabled', enabled_events: L.CONNECT_EVENTS };
  check('no endpoint: needed, with where to add it', (() => { const r = L.webhookRow('x', 'X', [], ['/api/stripe/connect-webhook'], L.CONNECT_EVENTS, 'on Connected accounts'); return r.state === 'missing' && /add an endpoint/.test(r.fix || ''); })());
  check('an endpoint sending everything: ready', L.webhookRow('x', 'X', [all], ['/api/stripe/connect-webhook'], L.CONNECT_EVENTS, '').state === 'ok');
  check('the older address counts too', L.webhookRow('x', 'X', [{ ...all, url: 'https://app.example/api/stripe/webhook/' }], ['/api/stripe/connect-webhook', '/api/stripe/webhook'], L.CONNECT_EVENTS, '').state === 'ok');
  check('“all events” counts as everything', L.webhookRow('x', 'X', [{ ...all, enabled_events: ['*'] }], ['/api/stripe/connect-webhook'], L.CONNECT_EVENTS, '').state === 'ok');
  const gap = L.webhookRow('x', 'X', [{ ...all, enabled_events: L.CONNECT_EVENTS.filter((e) => e !== 'account.updated') }], ['/api/stripe/connect-webhook'], L.CONNECT_EVENTS, '');
  check('missing “account updated”: needed, and named', gap.state === 'missing' && /account\.updated/.test(gap.note) && /add those events/.test(gap.fix || ''));
  check('a disabled endpoint doesn’t count', L.webhookRow('x', 'X', [{ ...all, status: 'disabled' }], ['/api/stripe/connect-webhook'], L.CONNECT_EVENTS, '').state === 'missing');
  check('another app’s endpoint doesn’t count', L.webhookRow('x', 'X', [{ ...all, url: 'https://other.example/hooks' }], ['/api/stripe/connect-webhook'], L.CONNECT_EVENTS, '').state === 'missing');
  const other = L.webhookRow('x', 'X', [{ ...all, url: 'https://preview.example/api/stripe/connect-webhook' }], ['/api/stripe/connect-webhook'], L.CONNECT_EVENTS, '', ['app.example']);
  check('with the app’s address known, a copy at the same path on another address isn’t counted as ready, and is flagged to look at', other.state === 'warn' && /preview\.example/.test(other.note) && /NEXT_PUBLIC_APP_URL/.test(other.fix || ''));
  process.env.NEXT_PUBLIC_APP_URL = 'https://opal.example'; process.env.VERCEL_PROJECT_PRODUCTION_URL = 'studio-one.vercel.app';
  const hosts = L.appHosts();
  check('with the live address set, a copy on another address means the live one has none: needed', L.webhookRow('x', 'X', [{ ...all, url: 'https://preview.example/api/stripe/connect-webhook' }], ['/api/stripe/connect-webhook'], L.CONNECT_EVENTS, '', hosts).state === 'missing');
  delete process.env.NEXT_PUBLIC_APP_URL; delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  check('the app knows both its own domain and its Vercel address, with and without www', ['opal.example', 'www.opal.example', 'studio-one.vercel.app'].every((h) => hosts.includes(h)));
  check('so a webhook on the Vercel address counts', L.webhookRow('x', 'X', [{ ...all, url: 'https://studio-one.vercel.app/api/stripe/connect-webhook' }], ['/api/stripe/connect-webhook'], L.CONNECT_EVENTS, '', hosts).state === 'ok');
  const two = L.webhookRow('x', 'X', [all, { ...all, url: 'https://app.example/api/stripe/webhook', enabled_events: ['checkout.session.completed'] }], ['/api/stripe/connect-webhook', '/api/stripe/webhook'], L.CONNECT_EVENTS, '', ['app.example']);
  check('two endpoints, one broken: the broken one is reported, not hidden by the healthy one', two.state === 'missing' && /account\.updated/.test(two.note));
  const idOnly = L.webhookRow('x', 'X', [all], ['/api/stripe/connect-webhook'], L.CONNECT_EVENTS, '', [], L.CONNECT_OPTIONAL_EVENTS);
  check('ID-check events missing: still ready, and named as only for ID checks', idOnly.state === 'ok' && /ID checks/.test(idOnly.note) && /identity\.verification_session\.verified/.test(idOnly.note));
  // Every event the handlers deal with is on a list, so the check can't fall behind the code.
  const connectSrc = read('src/lib/connect-webhook.ts'), billingSrc = read('src/app/api/stripe/billing-webhook/route.ts');
  const cases = (src: string) => [...src.matchAll(/case '([a-z_]+\.[a-z_.]+)'/g)].map((m) => m[1]);
  check('every event the payments webhook handles is checked', cases(connectSrc).every((e) => L.CONNECT_EVENTS.includes(e)) && /identity\.verification_session\./.test(connectSrc) && L.CONNECT_OPTIONAL_EVENTS.every((e) => e.startsWith('identity.verification_session.')), cases(connectSrc).filter((e) => !L.CONNECT_EVENTS.includes(e)));
  check('every event the plans webhook handles is checked', cases(billingSrc).every((e) => L.BILLING_EVENTS.includes(e)), cases(billingSrc).filter((e) => !L.BILLING_EVENTS.includes(e)));

  console.log('Published rules');
  check('same rules: ready', L.rulesRow('r', 'R', read('firestore.rules'), RULES_FINGERPRINT.firestore, 'Firestore').state === 'ok');
  check('different rules: needed, with where to publish', (() => { const r = L.rulesRow('r', 'R', 'rules_version = \'2\';', RULES_FINGERPRINT.firestore, 'Firestore Database, Rules'); return r.state === 'missing' && /Firestore Database, Rules/.test(r.fix || ''); })());
  check('couldn’t read them: says so, never passes', L.rulesRow('r', 'R', null, RULES_FINGERPRINT.firestore, '', 'permission denied').state === 'unknown');

  console.log('Asking Stripe and Firebase');
  full();
  const okRules = { firestore: async () => ({ source: [{ name: 'firestore.rules', content: read('firestore.rules') }] }), storage: async () => ({ source: [{ name: 'storage.rules', content: read('storage.rules') }] }) };
  stripeAnswer = async () => ({ data: [all, { url: 'https://app.example/api/stripe/billing-webhook', status: 'enabled', enabled_events: L.BILLING_EVENTS }] });
  rulesAnswer = okRules;
  let live = await L.launchReadiness();
  const get = (id: string) => live.find((x) => x.id === id);
  check('both webhooks right and both rules current: all four ready', ['stripe-connect-events', 'stripe-billing-events', 'rules-firestore', 'rules-storage'].every((id) => get(id)?.state === 'ok'), live.filter((x) => /stripe|rules/.test(x.id)));
  stripeAnswer = async () => { const e: any = new Error('Invalid API Key provided: sk_live_****ABCD'); e.type = 'StripeAuthenticationError'; e.statusCode = 401; throw e; };
  rulesAnswer = { firestore: async () => { throw Object.assign(new Error('Caller does not have permission for service account svc@p.example key ABCD'), { code: 403 }); }, storage: okRules.storage };
  live = await L.launchReadiness();
  const shown = JSON.stringify(live);
  check('Stripe refusing the key: “couldn’t check”, never ready, and none of its message is shown', get('stripe-events')?.state === 'unknown' && /the key was refused/.test(get('stripe-events')!.note) && !/ABCD|sk_live|svc@/.test(shown));
  check('no permission to read the rules: “couldn’t check”, with the role to add', get('rules-firestore')?.state === 'unknown' && /Rules Viewer/.test(get('rules-firestore')!.fix || '') && get('rules-storage')?.state === 'ok');
  stripeAnswer = () => new Promise(() => {});
  rulesAnswer = { firestore: () => new Promise(() => {}), storage: okRules.storage };
  const t0 = Date.now(); live = await L.launchReadiness();
  check('Stripe or Firebase not answering: gives up after a few seconds and says so', Date.now() - t0 < 9000 && get('stripe-events')?.state === 'unknown' && /no answer in time/.test(get('stripe-events')!.note) && get('rules-firestore')?.state === 'unknown');
  rulesAnswer = { firestore: async () => ({ source: [{ name: 'firestore.rules', content: 'rules_version = \'2\';' }] }), storage: okRules.storage };
  stripeAnswer = async () => ({ data: [] });
  live = await L.launchReadiness();
  check('older rules published: needed, with where to publish; no webhook yet: needed, with the app’s own address', get('rules-firestore')?.state === 'missing' && get('stripe-connect-events')?.state === 'missing' && /https:\/\/app\.example\/api\/stripe\/connect-webhook/.test(get('stripe-connect-events')!.fix || ''));

  console.log('Settings');
  full();
  let rows = await L.launchReadiness({ outside: false });
  const by = (id: string) => rows.find((r) => r.id === id)!;
  const out = JSON.stringify(rows);
  check('everything needed set: nothing needed is missing', L.readinessSummary(rows).need === 0, rows.filter((r) => r.state === 'missing'));
  check('no value is ever shown, only whether it’s there', !/SECRETVALUE|CONNECTVALUE|BILLVALUE|RESENDVALUE|CRONVALUE|PEPPERVALUE|PRIVATE-KEY-VALUE/.test(out));
  check('legal details not set yet: “before your first real business”, not needed', by('legal-name').group === 'invite' && by('legal-name').state === 'warn' && L.readinessSummary(rows).invite === 4);
  process.env.STRIPE_SECRET_KEY = 'sk_test_SECRETVALUE'; process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_abc';
  rows = await L.launchReadiness({ outside: false });
  check('Stripe in test mode: fine for the test run, flagged to switch before a real business', by('stripe-keys').state === 'warn' && /Test mode/.test(by('stripe-keys').note));
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_abc';
  rows = await L.launchReadiness({ outside: false });
  check('keys from different modes: needed, because payments would fail', by('stripe-keys').state === 'missing' && /test mode/.test(by('stripe-keys').note) && /live mode/.test(by('stripe-keys').note));
  process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <onboarding@resend.dev>';
  rows = await L.launchReadiness({ outside: false });
  check('email from the test address: needed, with how to fix', by('email-from').state === 'missing' && /Verify your sending domain/.test(by('email-from').fix || ''));
  delete process.env.NOTIFY_FROM_EMAIL; process.env.RESEND_FROM = 'Opal <hello@opal.example>';
  rows = await L.launchReadiness({ outside: false });
  check('a real sender set the older way (RESEND_FROM): ready, because that’s what really sends', by('email-from').state === 'ok' && /hello@opal\.example/.test(by('email-from').note));
  process.env.STRIPE_SECRET_KEY = 'sk_live_x'; process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'not-a-key';
  rows = await L.launchReadiness({ outside: false });
  check('a key that isn’t a Stripe key: needed', by('stripe-keys').state === 'missing' && /doesn’t look like a Stripe key/.test(by('stripe-keys').note));
  process.env.DEFAULT_SMS_TENANT_ID = 't1'; process.env.SHIPPO_API_KEY = 'x';
  rows = await L.launchReadiness({ outside: false });
  check('a default business for text replies set: a real problem', by('default-sms-tenant').state === 'missing' && L.readinessSummary(rows).need >= 1);
  check('a shared shipping key set: flagged to check', by('shippo-shared').state === 'warn');
  clear();
  rows = await L.launchReadiness({ outside: false });
  check('nothing set: each needed row says what fails and how to fix it', rows.filter((r) => r.group === 'need' && r.state === 'missing').every((r) => r.note && r.fix));
  check('the PIN key falls back safely, so it’s a check, not a blocker', by('pin-pepper').state === 'warn');
  const vendor = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  check('no vendor names in what HQ shows', !vendor.test(out) && !vendor.test(JSON.stringify(rows)));

  console.log('HQ System');
  const route = read('src/app/api/hq/route.ts'), page = read('src/app/(app)/admin/system/page.tsx');
  check('the check is its own HQ action, for people with the System permission, so the rest of System doesn’t wait', /if \(b\.action === 'readiness'\)/.test(route) && /readiness: 'system'/.test(route) && !/current, readiness,/.test(route));
  check('a dropped connection says so instead of spinning forever', /setRowsErr\('The launch check didn’t load\. Check your connection and reload\.'\)/.test(page) && /\.catch\(\(\) => setErr\(/.test(page));
  check('the page loads it on its own, shows it grouped with the fix for each, and counts what couldn’t be checked', /hq\(\{ action: 'readiness' \}\)/.test(page) && /<Readiness rows=\{rows\} error=\{rowsErr\} \/>/.test(page) && /Needed to launch/.test(page) && /\{r\.fix &&/.test(page) && /couldn’t be checked/.test(page) && /readinessSummary/.test(page));
  check('each row’s status is read out, not shown by color alone', /<span className="sr-only">: \{m\.label\}<\/span>/.test(page));
  check('no all-caps labels on the page', !/uppercase/.test(page));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
