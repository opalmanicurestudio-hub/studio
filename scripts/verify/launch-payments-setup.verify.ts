// Checks a new business can get in and get paid (launch L1):
// - Your ClarityFlow (the page new owners land on) finds the business through the server, not a browser list the
//   rules refuse, and says so plainly when a sign-in owns no business instead of spinning.
// - Connect payments works for a business whose id isn't the owner's account id, only for the owner (or an admin);
//   Stripe's "start again" address names no business at all and sends the owner back to Payments to carry on.
// - The older Stripe return address no longer attaches an account to a business named in the address.
// - Stripe's "account updated" notice ticks payments on for the business, or for a renter's own account.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-payments-setup.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
let actorResult: any = { ok: true, actor: { staffId: 'u1', name: 'The owner', role: 'owner', isManager: true, isOwner: true, portal: false } };
const calls: { kind: string; params: any }[] = [];
let account: any = { id: 'acct_1', charges_enabled: false, details_submitted: false, payouts_enabled: false };
let webhookEvent: any = null;

function StripeMock(this: any) {
  return {
    accounts: {
      create: async (p: any, o?: any) => { calls.push({ kind: 'create', params: { ...p, _opts: o } }); return { id: 'acct_new' }; },
      retrieve: async (id: string) => { calls.push({ kind: 'retrieve', params: id }); return { ...account, id }; },
    },
    accountLinks: { create: async (p: any) => { calls.push({ kind: 'link', params: p }); return { url: `https://connect.stripe.com/setup/${p.account}` }; } },
    webhooks: { constructEvent: () => webhookEvent },
  };
}
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === '@/lib/request-actor') return { requestActor: async () => actorResult };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-connect-webhook' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: { delete: () => ({ __del: true }), increment: (n: number) => n, serverTimestamp: () => new Date().toISOString(), arrayUnion: (...a: any[]) => a } };
  if (request === 'next/server') return { NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, body }),
    redirect: (url: string) => ({ status: 307, url }),
  } };
  return load.call(this, request, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test'; process.env.CRON_SECRET = 'cron'; process.env.NEXT_PUBLIC_APP_URL = 'https://app.example'; process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec';

const post = (body: any) => ({ url: 'https://app.example/api/stripe/connect', json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer tk' : null) } }) as any;
const getReq = (q: string) => ({ url: `https://app.example/api/stripe/connect${q}`, headers: { get: () => null } }) as any;
const get = async (p: string) => (await db.doc(p).get()).data() || null;

(async () => {
  const R = await import('../../src/app/api/stripe/connect/route');
  console.log('Connect payments: a business made by sign-up (its id is not the owner’s account id)');
  db = makeDb(); calls.length = 0;
  await db.doc('tenants/biz_7Hq').set({ name: 'Lumen Brow Bar', userId: 'u1' });
  let r: any = await R.POST(post({ tenantId: 'biz_7Hq', action: 'start' }));
  check('the owner gets Stripe’s onboarding link', r.status === 200 && r.body.ok && /connect\.stripe\.com/.test(r.body.url), r);
  const made = calls.find((c) => c.kind === 'create');
  check('a Stripe account is made for that business', !!made && made.params.metadata?.tenantId === 'biz_7Hq' && made.params.metadata?.kind === 'business', made);
  check('two taps at once make one account (same request key for the business)', made?.params._opts?.idempotencyKey === 'connect-acct-biz_7Hq-first', made?.params._opts);
  let t: any = await get('tenants/biz_7Hq');
  check('the business records its account, with card payments not yet on', t.stripeAccountId === 'acct_new' && t.stripeChargesEnabled === false, t);
  const link = calls.find((c) => c.kind === 'link')!.params;
  check('Stripe returns the owner to Settings › Payments', link.return_url === 'https://app.example/settings?tab=payments&stripe=connected', link.return_url);
  check('the "start again" address names no business and no account', link.refresh_url === 'https://app.example/api/stripe/connect', link.refresh_url);

  calls.length = 0;
  r = await R.POST(post({ tenantId: 'biz_7Hq', action: 'start' }));
  check('starting again reuses the same account', r.body.ok && !calls.some((c) => c.kind === 'create') && calls.find((c) => c.kind === 'link')?.params.account === 'acct_new', calls);

  console.log('Who may set up payments');
  calls.length = 0;
  actorResult = { ok: true, actor: { staffId: 's2', name: 'Ivy', role: 'staff', isManager: false, isOwner: false, portal: false } };
  r = await R.POST(post({ tenantId: 'biz_7Hq', action: 'start' }));
  check('a team member is turned away, and Stripe is never asked', r.status === 403 && !calls.length, r);
  actorResult = { ok: true, actor: { staffId: 's3', name: 'Mo', role: 'manager', isManager: true, isOwner: false, portal: false } };
  r = await R.POST(post({ tenantId: 'biz_7Hq', action: 'start' }));
  check('a manager is turned away too (where money goes is the owner’s call)', r.status === 403, r);
  actorResult = { ok: true, actor: { staffId: 's4', name: 'Ana', role: 'admin', isManager: true, isOwner: false, portal: false } };
  r = await R.POST(post({ tenantId: 'biz_7Hq', action: 'start' }));
  check('an admin the owner trusted may', r.status === 200 && r.body.ok, r);
  actorResult = { ok: false, error: 'Please sign in again.', status: 401 };
  r = await R.POST(post({ tenantId: 'biz_7Hq', action: 'start' }));
  check('signed out: asked to sign in', r.status === 401, r);
  actorResult = { ok: true, actor: { staffId: 'u1', name: 'The owner', role: 'owner', isManager: true, isOwner: true, portal: false } };
  r = await R.POST(post({ action: 'start' }));
  check('no business named: a plain answer', r.status === 400 && !r.body.ok, r);

  console.log('Checking how setup stands');
  account = { id: 'acct_new', charges_enabled: true, details_submitted: true, payouts_enabled: true };
  r = await R.POST(post({ tenantId: 'biz_7Hq', action: 'refresh' }));
  t = await get('tenants/biz_7Hq');
  check('Stripe’s answer is saved: card payments on, details sent, payouts on', r.body.ok && r.body.chargesEnabled && t.stripeChargesEnabled === true && t.stripeDetailsSubmitted === true && t.stripePayoutsEnabled === true, { r, t });
  await db.doc('tenants/biz_new').set({ name: 'New Co', userId: 'u1' });
  r = await R.POST(post({ tenantId: 'biz_new', action: 'refresh' }));
  check('a business with no account yet: told so, nothing made', r.body.ok && r.body.hasAccount === false && !(await get('tenants/biz_new')).stripeAccountId, r);

  console.log('Stripe’s "start again" address');
  calls.length = 0;
  r = await R.GET(getReq(''));
  check('it sends the owner back to Payments to carry on, and Stripe is never asked', r.status === 307 && r.url === 'https://app.example/settings?tab=payments&stripe=refresh' && !calls.length, r);
  r = await R.GET(getReq('?tenantId=u1'));
  check('the old address with an account id does the same, and starts nothing', r.url === 'https://app.example/settings?tab=payments&stripe=refresh' && !calls.length, r);

  console.log('The older Stripe return address');
  const C = await import('../../src/app/api/stripe/connect/callback/route');
  const before = JSON.stringify((await get('tenants/biz_7Hq')));
  r = await C.GET({ url: 'https://app.example/api/stripe/connect/callback?code=ac_evil&state=biz_7Hq', nextUrl: new URL('https://app.example/api/stripe/connect/callback?code=ac_evil&state=biz_7Hq') } as any);
  check('it only sends people to Payments', r.status === 307 && r.url === 'https://app.example/settings?tab=payments', r);
  check('it never attaches an account to the business in the address', JSON.stringify(await get('tenants/biz_7Hq')) === before);
  const cb = readFileSync('src/app/api/stripe/connect/callback/route.ts', 'utf8');
  check('it no longer trades a Stripe code for an account', !/oauth\.token/.test(cb));

  console.log('Stripe’s "account updated" notice');
  const W = await import('../../src/lib/connect-webhook');
  const hook = (ev: any) => { webhookEvent = ev; return W.handleConnectWebhook({ text: async () => '{}', headers: { get: (k: string) => (k === 'stripe-signature' ? 'sig' : null) } } as any); };
  db = makeDb();
  await db.doc('tenants/biz_7Hq').set({ name: 'Lumen Brow Bar', userId: 'u1', stripeAccountId: 'acct_b', stripeChargesEnabled: false });
  await db.doc('tenants/biz_7Hq/renters/r1').set({ firstName: 'Sol', stripeAccountId: 'acct_r', stripeChargesEnabled: false });
  await db.doc('tenants/biz_7Hq/staff/st1').set({ name: 'Sol', renterId: 'r1', isRenter: true, stripeChargesEnabled: false });
  r = await hook({ type: 'account.updated', account: 'acct_b', data: { object: { id: 'acct_b', charges_enabled: true, details_submitted: true, payouts_enabled: false, metadata: { tenantId: 'biz_7Hq', kind: 'business' } } } });
  t = await get('tenants/biz_7Hq');
  check('the business shows card payments on (the setup guide ticks Payments)', r.status === 200 && t.stripeChargesEnabled === true && t.stripeDetailsSubmitted === true && t.stripePayoutsEnabled === false, t);
  r = await hook({ type: 'account.updated', account: 'acct_r', data: { object: { id: 'acct_r', charges_enabled: true, details_submitted: true, payouts_enabled: true, metadata: { tenantId: 'biz_7Hq', renterId: 'r1', kind: 'renter' } } } });
  const rn: any = await get('tenants/biz_7Hq/renters/r1'); const st: any = await get('tenants/biz_7Hq/staff/st1');
  check('a renter’s own account: the renter shows payments on', rn.stripeChargesEnabled === true && rn.stripePayoutsEnabled === true, rn);
  check('and their provider record carries the one flag the booking page reads', st.stripeChargesEnabled === true && st.stripeAccountId === undefined, st);
  check('the business itself is untouched by a renter’s notice', (await get('tenants/biz_7Hq')).stripePayoutsEnabled === false);
  await db.doc('tenants/biz_7Hq/renters/r2').set({ firstName: 'Kai', stripeAccountId: 'acct_real', stripeChargesEnabled: false });
  await hook({ type: 'account.updated', account: 'acct_fake', data: { object: { id: 'acct_fake', charges_enabled: true, metadata: { tenantId: 'biz_7Hq', renterId: 'r2', kind: 'renter' } } } });
  check('a notice naming a renter whose account is different changes nothing', (await get('tenants/biz_7Hq/renters/r2')).stripeChargesEnabled === false);

  console.log('Your ClarityFlow (new owners land here)');
  const page = readFileSync('src/app/(app)/subscriptions/page.tsx', 'utf8');
  check('finds the business through the server', /useMyTenants\(/.test(page) && !/where\('userId'/.test(page) && !/useCollection/.test(page));
  check('a sign-in with no business is told so, with a way on', /No business on this sign-in/.test(page) && /noBusiness/.test(page));
  check('signed out: asked to sign in instead of a spinner', /Please sign in/.test(page) && /signedOut/.test(page));

  const card = readFileSync('src/components/settings/StripeConnectSetup.tsx', 'utf8');
  check('Payments card says "unfinished" only when Stripe says card payments are off', /charges === false \? 'incomplete'/.test(card) && /Stripe setup isn’t finished/.test(card) && !/api\/stripe\/connect\?tenantId=/.test(card));
  check('after an expired Stripe link, an unfinished setup carries straight on', /pendingRefresh\.current && stripeAccountId/.test(card) && /chargesEnabled !== true\) \{ asked\.current = `\$\{tenantId\}:refresh`/.test(card) && /void start\(\)/.test(card));
  check('after a disconnect, reconnecting makes a new account', /stripeDisconnectedAt/.test(readFileSync('src/app/api/stripe/disconnect/route.ts', 'utf8')) && /stripeDisconnectedAt/.test(readFileSync('src/app/api/stripe/connect/route.ts', 'utf8')));
  check('the card never shows text from the address', !/params\.get\('reason'\)/.test(card));
  check('the card follows Stripe’s flag as it changes', /String\(chargesEnabled\)/.test(card));
  check('no signed link helper is left behind', !require('fs').existsSync('src/lib/connect-link-key.ts'));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
