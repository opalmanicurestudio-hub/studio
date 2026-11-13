// Checks Apple Pay and Google Pay on the business's pay pages (lib/wallet-domains, api/stripe/wallets, the payment
// account notice in lib/connect-webhook, and scan to pay in lib/counter-phone).
// - The app's web addresses are registered on the business's own payments account (never the platform's), never a
//   local, bare-IP or one-off preview address.
// - Once: remembered on the business, looked at again after 30 days when on, after 6 hours when not yet.
// - A manager can check again; anyone signed in can see how it stands. Nothing without payments connected.
// - Scan to pay says Apple Pay and Google Pay only when they're on.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/wallet-domains.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ORDER_TRACK_SECRET = 'test-secret';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.clarity.test';
process.env.VERCEL_PROJECT_PRODUCTION_URL = 'studio-prod.vercel.app';
let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

// The card company's registered addresses, per payments account.
const S: any = { doms: new Map<string, any>(), calls: [] as string[], n: 0, appleOk: true, fail: false, createFail: '', event: null as any };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const k = (acct: string, d: string) => `${acct}|${d}`;
class FakeStripe {
  paymentMethodDomains = {
    list: async (p: any, o: any) => { if (S.fail) throw new Error('Your account can’t do that yet.'); S.calls.push(`list ${o?.stripeAccount} ${p.domain_name}`); const d = S.doms.get(k(o?.stripeAccount, p.domain_name)); return { data: d ? [clone(d)] : [] }; },
    create: async (p: any, o: any) => { S.calls.push(`create ${o?.stripeAccount} ${p.domain_name}`); if (S.createFail === 'down') throw new Error('The card company didn’t answer.'); if (S.createFail === 'raced') { S.createFail = ''; S.doms.set(k(o?.stripeAccount, p.domain_name), { id: 'pmd_raced', domain_name: p.domain_name, enabled: true, apple_pay: { status: 'active' }, google_pay: { status: 'active' }, link: { status: 'active' } }); throw new Error('This domain already exists.'); } const d = { id: `pmd_${++S.n}`, domain_name: p.domain_name, enabled: p.enabled !== false, apple_pay: { status: 'inactive' }, google_pay: { status: 'active' }, link: { status: 'active' }, acct: o?.stripeAccount }; S.doms.set(k(o?.stripeAccount, p.domain_name), d); return clone(d); },
    update: async (id: string, p: any, o: any) => { S.calls.push(`update ${o?.stripeAccount} ${id}`); const d: any = Array.from(S.doms.values()).find((x: any) => x.id === id); Object.assign(d, p); return clone(d); },
    validate: async (id: string, _p: any, o: any) => { S.calls.push(`validate ${o?.stripeAccount} ${id}`); const d: any = Array.from(S.doms.values()).find((x: any) => x.id === id); if (S.appleOk) d.apple_pay = { status: 'active' }; else d.apple_pay = { status: 'inactive', status_details: { error_message: 'The address couldn’t be checked.' } }; return clone(d); },
  };
  paymentIntents = { create: async (p: any) => ({ id: 'pi_1', amount: p.amount, status: 'requires_payment_method', client_secret: 'pi_1_secret', metadata: p.metadata }), retrieve: async () => ({ id: 'pi_1', status: 'requires_payment_method', metadata: {} }), cancel: async () => ({}) };
  webhooks = { constructEvent: () => S.event };
}

const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any, origin = 'https://app.clarity.test') => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (h: string) => (String(h).toLowerCase() === 'authorization' ? 'Bearer test' : String(h).toLowerCase() === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin } }) as any;

(async () => {
  const W = await import('../../src/lib/wallet-domains');
  const { POST: wallets } = await import('../../src/app/api/stripe/wallets/route');
  const { handleConnectWebhook } = await import('../../src/lib/connect-webhook');
  await db.doc(T).set({ name: 'Northside', stripeAccountId: 'acct_1', stripeChargesEnabled: true });

  console.log('which addresses');
  const hosts = W.walletHosts({ publicOrigin: 'https://pay.northside.test' }, 'https://studio-abc123-team.vercel.app');
  check('the business’s own address, the app’s, and the live one: never a one-off preview deployment', JSON.stringify(hosts) === JSON.stringify(['pay.northside.test', 'app.clarity.test']), hosts);
  const local = W.walletHosts({}, 'http://localhost:3000').concat(W.walletHosts({ publicOrigin: 'http://192.168.1.4:3000' }, null), W.walletHosts({ publicOrigin: 'http://plain.example.com' }, null));
  check('never localhost, a bare IP or a plain http address', !local.some((h) => /localhost|192\.168|plain\.example/.test(h)), local);

  console.log('registering');
  let t: any = await get(T);
  let r: any = await W.ensureWalletDomains(db, 't1', t, 'https://app.clarity.test', { stripe: new FakeStripe() });
  t = await get(T);
  const st = Object.values<any>(t.walletDomains || {});
  check('the app’s address goes on the business’s own payments account, and both wallets are on', r.checked >= 1 && S.calls.includes('create acct_1 app.clarity.test') && !S.calls.some((c: string) => c.startsWith('create undefined'))
    && st.some((s) => s.domain === 'app.clarity.test' && s.enabled && s.apple === 'active' && s.google === 'active') && W.walletsOn(t, 'https://app.clarity.test'), { calls: S.calls, st });
  const before = S.calls.length;
  r = await W.ensureWalletDomains(db, 't1', t, 'https://app.clarity.test', { stripe: new FakeStripe() });
  check('asked again: nothing is asked of the card company (remembered)', r.checked === 0 && S.calls.length === before, S.calls.slice(before));
  r = await W.ensureWalletDomains(db, 't1', t, 'https://app.clarity.test', { stripe: new FakeStripe(), now: Date.now() + 31 * 86400000 });
  check('…looked at again after 30 days, without registering it twice', r.checked >= 1 && S.calls.filter((c: string) => c === 'create acct_1 app.clarity.test').length === 1, S.calls.slice(before));

  console.log('not on yet');
  await db.doc('tenants/t2').set({ name: 'Eastside', stripeAccountId: 'acct_2', stripeChargesEnabled: true });
  S.doms.set(k('acct_2', 'app.clarity.test'), { id: 'pmd_old', domain_name: 'app.clarity.test', enabled: false, apple_pay: { status: 'inactive' }, google_pay: { status: 'inactive' }, link: { status: 'inactive' } });
  S.appleOk = false;
  let t2: any = await get('tenants/t2');
  await W.ensureWalletDomains(db, 't2', t2, null, { stripe: new FakeStripe() });
  t2 = await get('tenants/t2');
  const s2 = Object.values<any>(t2.walletDomains).find((s) => s.domain === 'app.clarity.test');
  check('registered before but switched off: switched back on, not made again', S.calls.includes('update acct_2 pmd_old') && !S.calls.includes('create acct_2 app.clarity.test') && s2.enabled === true, { calls: S.calls.filter((c: string) => c.includes('acct_2')), s2 });
  check('…neither wallet checked yet: says why, and isn’t counted as on', s2.apple === 'inactive' && s2.google === 'inactive' && /couldn’t be checked/.test(String(s2.error)), s2);
  const n2 = S.calls.length;
  await W.ensureWalletDomains(db, 't2', t2, null, { stripe: new FakeStripe(), now: Date.now() + 3600000 });
  check('…not asked again within 6 hours', S.calls.length === n2, S.calls.slice(n2));
  S.appleOk = true;
  await W.ensureWalletDomains(db, 't2', t2, null, { stripe: new FakeStripe(), now: Date.now() + 7 * 3600000 });
  t2 = await get('tenants/t2');
  check('…then asked again, and on', Object.values<any>(t2.walletDomains).find((s) => s.domain === 'app.clarity.test').apple === 'active', t2.walletDomains);
  await db.doc('tenants/t3').set({ name: 'Southside', stripeAccountId: 'acct_3' });
  S.fail = true;
  let t3: any = await get('tenants/t3');
  r = await W.ensureWalletDomains(db, 't3', t3, null, { stripe: new FakeStripe() });
  S.fail = false;
  t3 = await get('tenants/t3');
  check('the card company refuses (an account not ready): remembered with its words, tried again later', r.active === 0 && Object.values<any>(t3.walletDomains).every((s) => s.enabled === false && /can’t do that/.test(s.error)) && W.walletsDue(t3, ['app.clarity.test'], Date.now() + 7 * 3600000).length === 1, t3.walletDomains);
  r = await W.ensureWalletDomains(db, 't9', { name: 'No payments' }, null, { stripe: new FakeStripe() });
  check('no payments account: nothing asked', r.checked === 0, r);

  console.log('hiccups');
  t = await get(T);
  S.fail = true;
  r = await W.ensureWalletDomains(db, 't1', t, 'https://app.clarity.test', { stripe: new FakeStripe(), force: true });
  S.fail = false;
  t = await get(T);
  const kept = Object.values<any>(t.walletDomains).find((s) => s.domain === 'app.clarity.test');
  check('a hiccup when looking again never undoes one that works (only noted)', kept.enabled && kept.apple === 'active' && /can’t do that/.test(kept.error) && W.walletsOn(t, 'https://app.clarity.test'), kept);
  check('…and that one is looked at again in 6 hours, not a month', W.walletsDue(t, ['app.clarity.test'], Date.now() + 7 * 3600000).length === 1, kept);
  await W.ensureWalletDomains(db, 't1', t, 'https://app.clarity.test', { stripe: new FakeStripe(), now: Date.now() + 7 * 3600000 });
  t = await get(T);
  check('…and once it answers, back to a month', !Object.values<any>(t.walletDomains).find((s) => s.domain === 'app.clarity.test').error && W.walletsDue(t, ['app.clarity.test'], Date.now() + 8 * 86400000).length === 0, t.walletDomains);
  await db.doc('tenants/t10').set({ name: 'Riverside', stripeAccountId: 'acct_10', stripeChargesEnabled: true });
  S.createFail = 'down';
  let t10: any = await get('tenants/t10');
  await W.ensureWalletDomains(db, 't10', t10, null, { stripe: new FakeStripe(), hosts: ['app.clarity.test'] });
  S.createFail = '';
  t10 = await get('tenants/t10');
  const s10 = Object.values<any>(t10.walletDomains)[0];
  check('registering fails (no answer): remembered as not on, and the next try isn’t blocked by the first one’s answer', s10.enabled === false && s10.fails === 1 && /didn’t answer/.test(s10.error), s10);
  await W.ensureWalletDomains(db, 't10', t10, null, { stripe: new FakeStripe(), hosts: ['app.clarity.test'], now: Date.now() + 7 * 3600000 });
  t10 = await get('tenants/t10');
  check('…then tried again later, and on', W.walletsOn(t10, 'https://app.clarity.test') && S.calls.filter((c: string) => c === 'create acct_10 app.clarity.test').length === 2, { w: t10.walletDomains, calls: S.calls.filter((c: string) => c.includes('acct_10')) });
  await db.doc('tenants/t11').set({ name: 'Lakeside', stripeAccountId: 'acct_11', stripeChargesEnabled: true });
  S.createFail = 'raced';
  let t11: any = await get('tenants/t11');
  await W.ensureWalletDomains(db, 't11', t11, null, { stripe: new FakeStripe(), hosts: ['app.clarity.test'] });
  t11 = await get('tenants/t11');
  check('made at the same moment by another caller: that one is used', W.walletsOn(t11, 'https://app.clarity.test') && Object.values<any>(t11.walletDomains)[0].id === 'pmd_raced', t11.walletDomains);
  S.appleOk = false;
  await db.doc('tenants/t12').set({ name: 'Hillside', stripeAccountId: 'acct_12', stripeChargesEnabled: true });
  S.doms.set(k('acct_12', 'app.clarity.test'), { id: 'pmd_12', domain_name: 'app.clarity.test', enabled: true, apple_pay: { status: 'inactive' }, google_pay: { status: 'inactive' }, link: { status: 'inactive' } });
  let t12: any = await get('tenants/t12');
  await W.ensureWalletDomains(db, 't12', t12, null, { stripe: new FakeStripe(), hosts: ['app.clarity.test'] });
  t12 = await get('tenants/t12');
  await W.ensureWalletDomains(db, 't12', t12, null, { stripe: new FakeStripe(), hosts: ['app.clarity.test'], now: Date.now() + 7 * 3600000 });
  t12 = await get('tenants/t12');
  const due12 = (h: number) => W.walletsDue(t12, ['app.clarity.test'], Date.now() + h * 3600000).length === 1;
  check('still not on after asking again: asked less often (not after 6 hours, after 12)', Object.values<any>(t12.walletDomains)[0].fails === 2 && !due12(7 + 6) && due12(7 + 12.5), t12.walletDomains);
  S.appleOk = true;
  await db.doc('tenants/t13').set({ name: 'Cliffside', stripeAccountId: 'acct_13', stripeChargesEnabled: true });
  const busyBefore = S.calls.length;
  await Promise.all([W.ensureWalletDomainsSoon(db, 't13', await get('tenants/t13'), null, 3000, { stripe: new FakeStripe() }), (async () => { await new Promise((r) => setTimeout(r, 5)); await W.ensureWalletDomainsSoon(db, 't13', await get('tenants/t13'), null, 3000, { stripe: new FakeStripe() }); })()]);
  const made13 = S.calls.slice(busyBefore).filter((c: string) => c.startsWith('create acct_13'));
  check('…and the business is free for the next one after', !(await get('tenants/t13')).walletDomainsBusyAt);
  check('two pages at once for a business: each address registered once', made13.length >= 1 && new Set(made13).size === made13.length, S.calls.slice(busyBefore));

  console.log('the payments settings');
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  r = await wallets(req({ tenantId: 't3', action: 'status' }));
  const r2: any = await wallets(req({ tenantId: 't3', action: 'check' }));
  check('anyone signed in sees how it stands; only a manager can check again', r.body.ok && r.body.on === false && r.body.addresses.some((a: any) => a.domain === 'app.clarity.test') && r2.status === 403, [r.body, r2.body]);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const t3now: any = await get('tenants/t3');
  await db.doc('tenants/t3').set({ walletDomains: Object.fromEntries(Object.entries<any>(t3now.walletDomains).map(([kk, v]) => [kk, { ...v, at: hourAgo }])) }, { merge: true });
  const c0 = S.calls.length;
  r = await wallets(req({ tenantId: 't3', action: 'check' }));
  check('a manager’s Check again asks now (even inside the 6 hours), and it’s on', r.body.ok && r.body.on === true && S.calls.length > c0 && r.body.addresses.find((a: any) => a.domain === 'app.clarity.test').apple === 'active', r.body);
  const c1 = S.calls.length;
  const again: any = await wallets(req({ tenantId: 't3', action: 'check' }));
  check('…tapped again straight after: the answer already in hand, nothing asked twice', again.body.ok && again.body.on === true && S.calls.length === c1, S.calls.slice(c1));
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  const seen: any = await wallets(req({ tenantId: 't10', action: 'status' }));
  check('the card company’s own words are shown to managers only', seen.body.ok && seen.body.addresses.every((a: any) => a.error === null), seen.body);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  const bad: any = await wallets(req({ tenantId: '../t3', action: 'status' }));
  check('a made-up business id is turned away before anything is read', bad.status === 400, bad.body);
  await db.doc('tenants/t4').set({ name: 'Westside' });
  r = await wallets(req({ tenantId: 't4', action: 'check' }));
  check('payments not connected: connect them first', r.status === 409, r.body);

  console.log('when payments are ready');
  await db.doc('tenants/t5').set({ name: 'Uptown', stripeAccountId: 'acct_5' });
  S.event = { type: 'account.updated', account: 'acct_5', data: { object: { id: 'acct_5', charges_enabled: true, details_submitted: true, payouts_enabled: true, metadata: {} } } };
  await handleConnectWebhook(req({}));
  const t5: any = await get('tenants/t5');
  check('the account becomes ready to take payments: its addresses are registered by themselves', S.calls.includes('create acct_5 app.clarity.test') && W.walletsOn(t5, 'https://app.clarity.test'), { calls: S.calls.filter((c: string) => c.includes('acct_5')), w: t5.walletDomains });
  await db.doc('tenants/t6').set({ name: 'Midtown', stripeAccountId: 'acct_6' });
  S.event = { type: 'account.updated', account: 'acct_6', data: { object: { id: 'acct_6', charges_enabled: false, details_submitted: false, payouts_enabled: false, metadata: {} } } };
  await handleConnectWebhook(req({}));
  check('…but not before it can take payments', !S.calls.some((c: string) => c.includes('acct_6')), S.calls.filter((c: string) => c.includes('acct_6')));

  console.log('scan to pay says so');
  const PH = await import('../../src/lib/counter-phone');
  await db.doc('tenants/t7').set({ name: 'Harbor', stripeAccountId: 'acct_7', stripeChargesEnabled: true });
  await db.doc('tenants/t7/counterOrders/o1').set({ number: 'B1', status: 'sent', total: 5.5, createdAt: new Date().toISOString(), lines: [] });
  let lk: any = await PH.phoneLink(db, 't7', await get('tenants/t7'), 'o1', 'https://app.clarity.test', 'Kai', { stripe: new FakeStripe() });
  check('the first code for a business registers its address, and says Apple Pay and Google Pay are on', lk.ok && lk.wallets === true && S.calls.includes('create acct_7 app.clarity.test'), lk);
  await db.doc('tenants/t8').set({ name: 'Bay', stripeAccountId: 'acct_8', stripeChargesEnabled: true });
  await db.doc('tenants/t8/counterOrders/o1').set({ number: 'B1', status: 'sent', total: 5.5, createdAt: new Date().toISOString(), lines: [] });
  S.fail = true;
  lk = await PH.phoneLink(db, 't8', await get('tenants/t8'), 'o1', 'https://app.clarity.test', 'Kai', { stripe: new FakeStripe() });
  S.fail = false;
  check('…and when they aren’t on, the code still works and it says card only', lk.ok && lk.wallets === false && /\/drive-thru\/t8\/pay\?o=o1&s=/.test(lk.url), lk);

  console.log('the payments sweep');
  const cron = require('fs').readFileSync(require('path').resolve('src/app/api/cron/retail-payments/route.ts'), 'utf8');
  check('the payments sweep registers what’s due for every business that can take payments', /ensureWalletDomains\(db, t\.id, tenant, null\)/.test(cron) && /stripeChargesEnabled !== false/.test(cron));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
