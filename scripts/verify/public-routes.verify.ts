// Checks the routes anyone can reach take money, or use someone's account, only with proof, and once:
//   - the concierge kiosk's station charge (api/booths/kiosk 'charge'): only from the station's signed link (or the front
//     desk signed in); a day guest's own card only after the code texted to their phone; priced from the menu; two at
//     once, or asked again after a lost answer, is one charge and one line in the books; Stripe saying no records
//     nothing; a new link stops the old one; a station that charges a lot is turned away;
//   - the lounge orders (api/concierge/requests): a client's balance or club allowance only with the texted code (or,
//     for someone checked in right now, the station's link or the front desk); paying when it arrives needs nothing;
//     a balance goes up once per order; one allowance can't be spent twice at once; a station charge goes on one order;
//   - what a phone number alone tells (club-perk counts, whether a number is on file, whether a guest is checked in):
//     nothing, without the code's pass or the front desk signed in;
//   - a renter's incidental charge (api/booths/setup-card PUT): signed in, once per attempt;
//   - replacing a renter's card on file (api/booths/setup-card POST/GET): the team, the owner's signed 7-day link, or
//     the renter signed in to their own portal; a setup from a link sent before that is told to ask for a new link;
//   - enrolling a membership or package (api/memberships/enroll): the team or our own server only;
//   - the deposit page (api/stripe/deposit): the old booking-request way, with the browser's amount, is refused;
//   - dispute evidence (api/stripe/submit-dispute-evidence): managers only, the business's own account and files;
//   - the scheduled jobs (api/cron/*, api/appointments/sweep-overdue): refused when the secret is missing or doesn't
//     match exactly.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/public-routes.verify.ts
import Module from 'module';
import { readFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.ORDER_PASS_SECRET = 'test-station-secret';
process.env.CRON_SECRET = 'sec';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'studio.appspot.com';
let db: any = strictTransactions(makeDb());

// ── Stripe (the platform's own account for booths, a business's account for the rest): one charge per key, an
// answer that can go missing, a card that can say no. ──
let charges: any[] = []; const keys = new Map<string, any>(); let piCalls = 0;
let mode: 'ok' | 'lost_after' | 'decline' = 'ok';
let sessions: any[] = []; let disputeUpdates: any[] = []; let files: any[] = []; const stripeSessions = new Map<string, any>();
function StripeMock(this: any) {
  return {
    paymentIntents: {
      create: async (p: any, o: any) => {
        piCalls++;
        if (mode === 'decline') { const e: any = new Error('Your card was declined.'); e.type = 'StripeCardError'; throw e; }
        let pi = keys.get(o?.idempotencyKey);
        if (!pi) { pi = { id: `pi_${charges.length + 1}`, status: 'succeeded', amount: p.amount, customer: p.customer, payment_method: p.payment_method, metadata: p.metadata, latest_charge: { id: `ch_${charges.length + 1}`, balance_transaction: { fee: 47 } } }; charges.push(pi); if (o?.idempotencyKey) keys.set(o.idempotencyKey, pi); }
        if (mode === 'lost_after') { mode = 'ok'; const e: any = new Error('connection reset'); e.type = 'StripeConnectionError'; throw e; }
        return pi;
      },
      retrieve: async (id: string) => charges.find((c) => c.id === id) || { id, latest_charge: { id: 'ch_x', balance_transaction: { fee: 47 } } },
    },
    checkout: { sessions: {
      create: async (p: any, o: any) => { sessions.push({ p, o }); const s = { id: `cs_${sessions.length}`, client_secret: 'secret', url: `https://checkout.stripe.test/cs_${sessions.length}`, mode: p.mode, metadata: p.metadata, customer: p.customer, setup_intent: null as any }; stripeSessions.set(s.id, s); return s; },
      retrieve: async (id: string) => stripeSessions.get(id) || null,
    } },
    customers: { list: async () => ({ data: [] }), create: async () => ({ id: 'cus_new' }) },
    paymentMethods: { retrieve: async (id: string) => ({ id, card: { brand: 'visa', last4: '4242' } }) },
    files: { create: async (p: any, o: any) => { files.push({ p, o }); return { id: `file_${files.length}` }; } },
    disputes: { update: async (id: string, p: any, o: any) => { disputeUpdates.push({ id, p, o }); return { id }; } },
  };
}

// ── Who's signed in (by the Authorization header the screen sends) ──
const ACTORS: Record<string, any> = {
  'Bearer manager': { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: ['checkout.take'] },
  'Bearer staff': { uid: 's1', name: 'Sam Lee', role: 'front_desk', caps: ['checkout.take'] },
  'Bearer renter': { uid: 'r9', name: 'Rita Moss', role: 'renter', isRenter: true, caps: ['checkout.take'] },
  'Bearer renter-rt1': { uid: 'rt1', name: 'Nia Park', role: 'renter', isRenter: true, portal: true, caps: [] },
  'Bearer renter-rt2': { uid: 'rt2', name: 'Ola Diaz', role: 'renter', isRenter: true, portal: true, caps: [] },
};
const who = (req: any) => ACTORS[String(req?.headers?.get?.('authorization') || '')] || null;
const denied = (status: number) => ({ deny: { status, body: { ok: false, error: status === 401 ? 'Please sign in again.' : 'Only a manager can do that.' } } });
const routeGuard = {
  requireRole: async (req: any, _t: any, level = 'staff') => { const a = who(req); if (!a) return denied(401); if (level !== 'staff' && !a.isManager) return denied(403); return { actor: a }; },
  requireCan: async (req: any, _t: any, cap: string) => { const a = who(req); if (!a) return denied(401); if (!(a.caps || []).includes(cap)) return denied(403); return { actor: a }; },
  staffOrServer: async (req: any) => req?.headers?.get?.('x-cf-internal') === 'sec' || !!who(req),
};

let texts: any[] = []; let enrolled: any[] = []; let downloads: string[] = []; let fetched: string[] = []; let renewalsRun = 0;
const storage = { bucket: (name: string) => ({ file: (path: string) => ({ download: async () => { downloads.push(`${name}/${path}`); return [Buffer.from('a stored file')]; } }) }) };
(globalThis as any).fetch = async (u: any) => { fetched.push(String(u)); return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(8) }; };

const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const notify = { sendNotification: async (_db: any, msg: any) => { texts.push(msg); return { ok: true, status: 'sent' }; } };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock, __esModule: true });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminStorage: () => storage };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === 'firebase/firestore') return { collection: () => ({}), doc: () => ({}), setDoc: async () => undefined };
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, routeGuard);
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, notify);
  if (request === '@/lib/memberships/enroll-membership') return {
    enrollMembership: async (_db: any, input: any) => { enrolled.push(input); return { ok: true, activeMembershipId: input.membershipId }; },
    enrollPackage: async (_db: any, input: any) => { enrolled.push(input); return { ok: true, sessionsRemaining: 5 }; },
  };
  if (request === '@/lib/cron-heartbeat') return { recordCronRun: async () => undefined };
  if (request === '@/lib/memberships/renewals') return { runRenewals: async () => { renewalsRun++; return { charged: 0, waiting: 0, lapsed: 0 }; } };
  if (request === '@/lib/card-save') return { cardReminderSweep: async () => 0 };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const today = new Date().toISOString().slice(0, 10);
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, headers: { get: (k: string) => headers[String(k).toLowerCase()] ?? null }, nextUrl: { origin: 'https://studio.test', searchParams: new URLSearchParams() }, url: 'https://studio.test/api/x' }) as any;
const getReq = (q: Record<string, string>, headers: Record<string, string> = {}) => ({ headers: { get: (k: string) => headers[String(k).toLowerCase()] ?? null }, nextUrl: { origin: 'https://studio.test', searchParams: new URLSearchParams(q) }, url: `https://studio.test/api/x?${new URLSearchParams(q)}` }) as any;
const lines = async (prefix: string) => (await all(`${T}/transactions`)).filter((x: any) => String(x.id).startsWith(prefix));
const fresh = async () => {
  db = strictTransactions(makeDb()); charges = []; keys.clear(); piCalls = 0; mode = 'ok'; sessions = []; disputeUpdates = []; files = []; stripeSessions.clear();
  texts = []; enrolled = []; downloads = []; fetched = [];
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', incidentalCategories: [{ label: 'Cleaning', capCents: 5000 }] });
  await db.doc('tenants/t2').set({ name: 'Other shop', stripeAccountId: 'acct_2' });
  await db.doc(`${T}/booths/b1`).set({ name: 'Chair 2' });
  await db.doc(`${T}/booths/b2`).set({ name: 'Room 3' });
  await db.doc(`${T}/leases/l1`).set({ boothId: 'b1', renterId: 'rt1', status: 'active' });
  await db.doc(`${T}/renters/rt1`).set({ firstName: 'Nia', lastName: 'Park', amenitiesEnabled: true, amenityPayer: 'renter', amenityCompAllowance: 1, cardOnFile: true, stripeCustomerId: 'cus_r', stripePaymentMethodId: 'pm_r' });
  await db.doc(`${T}/inventory/latte`).set({ name: 'Latte', type: 'refreshment', price: 6, totalStock: 10 });
  await db.doc(`${T}/boothReservations/res1`).set({ name: 'Lena Cho', phone: '+15551112222', boothId: 'b2', boothName: 'Room 3', status: 'checked_in', startDate: today, endDate: today, cardOnFile: true, stripeCustomerId: 'cus_g', stripePaymentMethodId: 'pm_g' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', phone: '+15553334444', activeMembershipId: 'mem1', subscription: { nextBillingDate: new Date(Date.now() + 20 * 864e5).toISOString() }, outstandingBalance: 0 });
  await db.doc(`${T}/memberships/mem1`).set({ name: 'Club', includedProducts: [{ id: 'latte', quantity: 1 }] });
};

(async () => {
  const kiosk = (await import('../../src/app/api/booths/kiosk/route')).POST;
  const ordersRoute = await import('../../src/app/api/concierge/requests/route');
  const orders = ordersRoute.POST;
  const setupRoute = await import('../../src/app/api/booths/setup-card/route');
  const setupCard = setupRoute.PUT;
  const enroll = (await import('../../src/app/api/memberships/enroll/route')).POST;
  const deposit = (await import('../../src/app/api/stripe/deposit/route')).POST;
  const evidence = (await import('../../src/app/api/stripe/submit-dispute-evidence/route')).POST;
  const K = (body: any, h: Record<string, string> = {}) => kiosk(req({ tenantId: 't1', ...body }, h)) as any;
  const O = (body: any, h: Record<string, string> = {}) => orders(req({ tenantId: 't1', ...body }, h)) as any;
  const stationLink = async (renew = false) => (await K({ action: 'station-link', boothId: 'b1', renew }, { authorization: 'Bearer manager' })).body.token;
  const charge = (x: any = {}, h: Record<string, string> = {}) => K({ action: 'charge', payer: 'station', boothId: 'b1', itemId: 'latte', quantity: 1, amountCents: 600, orderKey: 'o1', ...x }, h);
  const codeFor = async (phone: string) => {
    const s: any = await O({ action: 'send-code', phone });
    const text = texts[texts.length - 1]?.text || ''; const code = (text.match(/code is (\d{6})/) || [])[1] || '';
    const c: any = await O({ action: 'check-code', phone, codeId: s.body.codeId, code });
    return { sent: s, code, pass: c.body.pass, checked: c };
  };

  console.log('the station link');
  await fresh();
  let r: any = await K({ action: 'station-link', boothId: 'b1' });
  check('making a station link without signing in: refused', r.status === 401 && !r.body.token, r.body);
  r = await K({ action: 'station-link', boothId: 'b1' }, { authorization: 'Bearer staff' });
  check('…by someone who isn’t a manager: refused', r.status === 403, r.body);
  const token = await stationLink();
  check('a manager gets a signed link for the renter’s station', /^1\.[A-Za-z0-9_-]{32}$/.test(String(token)), token);
  r = await K({ action: 'active-stay', boothId: 'b1' });
  check('an old link (no signature) still finds the station, can’t charge it, and is told to ask the front desk', r.body.ok && r.body.found === false && r.body.linkNeedsUpdate === true && r.body.boothName === 'Chair 2' && !('renterId' in r.body), r.body);
  r = await K({ action: 'active-stay', boothId: 'b1', stationToken: token });
  check('the signed link: the station’s payer is the renter, and their id isn’t handed out', r.body.found === true && r.body.payerType === 'renter' && r.body.cardOnFile === true && !('renterId' in r.body), r.body);
  r = await K({ action: 'active-stay', boothId: 'b1', stationToken: token.replace(/.$/, (ch: string) => (ch === 'A' ? 'B' : 'A')) });
  check('…a signature that’s been changed is no good', r.body.found === false && r.body.linkNeedsUpdate === true, r.body);

  console.log('charging the station');
  r = await charge();
  check('a charge without the signed link: refused, nothing charged', r.status === 403 && r.body.linkNeedsUpdate === true && piCalls === 0, r.body);
  r = await K({ action: 'charge', renterId: 'rt1', amountCents: 50000, description: 'Concierge: Latte (x1)' });
  check('the old way (a renter id and any amount): refused, nothing charged', r.status === 400 && piCalls === 0, r.body);
  r = await charge({ stationToken: token, amountCents: 100 });
  check('an amount that isn’t the menu’s price: refused, nothing charged', r.status === 409 && piCalls === 0, r.body);
  const two: any[] = await Promise.all([charge({ stationToken: token }), charge({ stationToken: token })]);
  const claims = await all(`${T}/private/kiosk/stationCharges`);
  check('two taps at once: charged once ($6.00, the renter’s card), one line in the books', charges.length === 1 && charges[0].amount === 600 && charges[0].payment_method === 'pm_r' && (await lines('concierge_')).length === 1 && claims.length === 1 && claims[0].status === 'charged', two.map((x) => x.body));
  check('…both answers name the same order', two.every((x) => x.body.ok && x.body.orderId === claims[0].id), two.map((x) => x.body));
  check('…and its Stripe fee is in the books once', (await lines('conciergefee_')).length === 1 && (await lines('conciergefee_'))[0].amount === 0.47);
  r = await charge({ stationToken: token });
  check('…asked again later: done already, nothing more', r.body.ok && r.body.already && charges.length === 1 && piCalls <= 2, { body: r.body, piCalls });
  r = await charge({ stationToken: token }, { authorization: 'Bearer renter' });
  check('a renter signed in is not the front desk (the same order, still once)', charges.length === 1);
  await fresh();
  const t2 = await stationLink();
  r = await charge({ orderKey: 'desk1' }, { authorization: 'Bearer staff' });
  check('the front desk signed in on the screen vouches for the station', r.body.ok && charges.length === 1, r.body);
  r = await charge({ orderKey: 'desk2' }, { authorization: 'Bearer renter' });
  check('…a renter signed in does not', r.status === 403 && charges.length === 1, r.body);
  mode = 'lost_after';
  r = await charge({ stationToken: t2, orderKey: 'lost1' });
  const lostClaim = (await all(`${T}/private/kiosk/stationCharges`)).find((c: any) => c.status === 'charging');
  check('the answer lost: it says to try again, and the order stays claimed', r.status === 502 && !!lostClaim && (await lines('concierge_')).length === 1, r.body);
  r = await charge({ stationToken: t2, orderKey: 'lost1' });
  check('…asked again straight away: told it’s going through', r.status === 409, r.body);
  await db.doc(`${T}/private/kiosk/stationCharges/${lostClaim.id}`).set({ claimAt: new Date(Date.now() - 5 * 60000).toISOString() }, { merge: true });
  r = await charge({ stationToken: t2, orderKey: 'lost1' });
  check('…asked again later: the same charge at Stripe, recorded once', r.body.ok && charges.length === 2 && (await lines('concierge_')).length === 2, { body: r.body, charges: charges.length });
  mode = 'decline';
  r = await charge({ stationToken: t2, orderKey: 'no1' });
  const declined = (await all(`${T}/private/kiosk/stationCharges`)).find((c: any) => c.status === 'failed');
  check('the card says no: nothing recorded, the order let go', r.status === 402 && (await lines('concierge_')).length === 2 && !!declined && !declined.claimAt, r.body);
  mode = 'ok';
  const t3 = await stationLink(true);
  r = await charge({ stationToken: t2, orderKey: 'old1' });
  check('a new link: the old one no longer charges', r.status === 403 && r.body.linkNeedsUpdate === true, r.body);
  r = await charge({ stationToken: t3, orderKey: 'new1' });
  check('…the new one does', r.body.ok, r.body);
  await db.doc(`${T}/leases/l1`).set({ status: 'ended' }, { merge: true });
  await db.doc(`${T}/leases/l2`).set({ boothId: 'b1', renterId: 'rt2', status: 'active' });
  await db.doc(`${T}/renters/rt2`).set({ firstName: 'Ola', amenitiesEnabled: true, amenityPayer: 'renter', cardOnFile: true, stripeCustomerId: 'cus_2', stripePaymentMethodId: 'pm_2' });
  r = await charge({ stationToken: t3, orderKey: 'next1' });
  check('a new renter in the space: the last renter’s link doesn’t charge them', r.status === 403 && !charges.some((c) => c.payment_method === 'pm_2'), r.body);

  await fresh();
  const t4 = await stationLink();
  let refused = 0; for (let i = 0; i < 16; i++) { const x: any = await charge({ stationToken: t4, orderKey: `many${i}` }); if (x.status === 429) refused++; }
  check('a station charging again and again: the 16th in an hour is turned away', charges.length === 15 && refused === 1, { charges: charges.length, refused });

  console.log('a day guest’s own card');
  await fresh();
  const stay = (x: any = {}) => K({ action: 'charge', payer: 'stay', reservationId: 'res1', phone: '+15551112222', itemId: 'latte', quantity: 2, amountCents: 1200, orderKey: 'g1', ...x });
  r = await stay();
  check('their phone number alone: refused (they’re asked for the code), nothing charged', r.status === 403 && r.body.needsCode === true && piCalls === 0, r.body);
  const unknown: any = await O({ action: 'send-code', phone: '5559990000' });
  check('a number the business doesn’t have: answered like any other (nothing says it isn’t on file), and nothing is texted', unknown.status === 200 && unknown.body.ok && typeof unknown.body.codeId === 'string' && unknown.body.sentTo === 'the number ending in 0000' && texts.length === 0, unknown.body);
  r = await O({ action: 'check-code', phone: '5559990000', codeId: unknown.body.codeId, code: '123456' });
  check('…and no code confirms it', !r.body.ok && /doesn’t match/.test(String(r.body.error)), r.body);
  const g = await codeFor('5551112222');
  check('a code is texted to the number on their stay', g.sent.body.ok && texts.length === 1 && texts[0].to === '+15551112222' && texts[0].kind === 'verify_code' && /\d{6}/.test(g.code), g.sent.body);
  check('…the right code gives a pass', g.checked.body.ok && typeof g.pass === 'string', g.checked.body);
  r = await stay({ guestPass: g.pass, phone: '+15553334444' });
  check('the pass is for that number only', r.status === 403 && r.body.needsCode === true && piCalls === 0, r.body);
  const both: any[] = await Promise.all([stay({ guestPass: g.pass }), stay({ guestPass: g.pass })]);
  check('with the pass, two taps at once: their card charged once ($12.00), one line', charges.length === 1 && charges[0].payment_method === 'pm_g' && charges[0].amount === 1200 && (await lines('concierge_')).length === 1, both.map((x) => x.body));

  console.log('the codes');
  await fresh();
  const s1: any = await O({ action: 'send-code', phone: '5553334444' });
  const right = (String(texts[0]?.text || '').match(/code is (\d{6})/) || [])[1];
  const wrong = right === '000000' ? '111111' : '000000';
  await Promise.all(Array.from({ length: 7 }, () => O({ action: 'check-code', phone: '5553334444', codeId: s1.body.codeId, code: wrong })));
  r = await O({ action: 'check-code', phone: '5553334444', codeId: s1.body.codeId, code: right });
  check('wrong guesses sent all at once still count: after five, even the right code is refused', !r.body.ok && /Too many tries/.test(String(r.body.error)), r.body);
  for (let i = 0; i < 5; i++) await O({ action: 'send-code', phone: '5553334444' });
  check('no more than five codes an hour to one number', texts.length === 5, texts.length);

  console.log('a lounge order on a client’s account');
  await fresh();
  const order = (x: any = {}, h: Record<string, string> = {}) => O({ itemId: 'latte', quantity: 1, clientName: 'Maya', phone: '+15553334444', settle: 'balance', orderKey: 'k1', ...x }, h);
  r = await order();
  check('“add it to my visit” with their phone number alone: refused, nothing owed', r.status === 403 && r.body.needsCode === true && !(await get(`${T}/clients/c1`)).outstandingBalance && (await all(`${T}/refreshmentRequests`)).length === 0, r.body);
  r = await order({ settle: 'perk', orderKey: 'k2' });
  check('…their club allowance: the same', r.status === 403 && r.body.needsCode === true && (await all(`${T}/refreshmentRequests`)).length === 0, r.body);
  r = await order({ settle: 'desk', orderKey: 'k3' });
  check('paying when it arrives needs nothing more', r.body.ok && r.body.settledBy === 'desk' && (await all(`${T}/refreshmentRequests`)).length === 1, r.body);
  const c = await codeFor('5553334444');
  const twice: any[] = await Promise.all([order({ guestPass: c.pass }), order({ guestPass: c.pass })]);
  const cl = await get(`${T}/clients/c1`);
  check('with the code’s pass, two taps at once: one order, $6.00 owed once', twice.every((x) => x.body.ok) && (await all(`${T}/refreshmentRequests`)).length === 2 && cl.outstandingBalance === 6 && cl.unpaidFees.length === 1, { bodies: twice.map((x) => x.body), cl });
  r = await order({ guestPass: c.pass });
  check('…sent again later: the same order, nothing more owed', r.body.ok && r.body.already && (await get(`${T}/clients/c1`)).outstandingBalance === 6, r.body);
  await fresh();
  const c2 = await codeFor('5553334444');
  const perks: any[] = await Promise.all([order({ guestPass: c2.pass, settle: 'perk', orderKey: 'p1' }), order({ guestPass: c2.pass, settle: 'perk', orderKey: 'p2' })]);
  check('one included latte left, two orders at once: only one is free', perks.filter((x) => x.body.ok).length === 1 && perks.filter((x) => x.status === 409).length === 1, perks.map((x) => x.body));

  await fresh();
  await db.doc(`${T}/appointments/a1`).set({ clientId: 'c1', status: 'checked_in', startTime: new Date().toISOString() });
  r = await order();
  check('checked in right now, but on a screen nobody vouches for: still asked for the code', r.status === 403 && r.body.needsCode === true, r.body);
  r = await order({}, { authorization: 'Bearer staff' });
  check('checked in right now, on the front desk’s screen: no code needed', r.body.ok && (await get(`${T}/clients/c1`)).outstandingBalance === 6, r.body);
  const t5 = await stationLink();
  r = await order({ orderKey: 'k9', boothId: 'b1', stationToken: t5 });
  check('…or from the station’s signed link', r.body.ok && (await get(`${T}/clients/c1`)).outstandingBalance === 12, r.body);
  await db.doc(`${T}/appointments/a1`).set({ status: 'completed' }, { merge: true });
  r = await order({ orderKey: 'k10' }, { authorization: 'Bearer staff' });
  check('once their visit is finished, the front desk’s screen isn’t enough', r.status === 403 && r.body.needsCode === true, r.body);

  console.log('a station charge and its order');
  await fresh();
  const t6 = await stationLink();
  r = await charge({ stationToken: t6, orderKey: 'st1' });
  const orderId = r.body.orderId;
  const stationOrder = (x: any = {}) => O({ itemId: 'latte', quantity: 1, boothId: 'b1', settle: 'station', stationOrderId: orderId, orderKey: 'st1', ...x });
  const so: any[] = await Promise.all([stationOrder(), stationOrder()]);
  const line = (await lines('concierge_'))[0];
  check('the order made from it: once, and the charge’s line points to it', so.every((x) => x.body.ok && x.body.chargedToStation) && (await all(`${T}/refreshmentRequests`)).length === 1 && line.conciergeRequestId === so[0].body.requestId, so.map((x) => x.body));
  r = await stationOrder({ orderKey: 'other' });
  check('…the same charge can’t pay for another order', r.status === 402 && (await all(`${T}/refreshmentRequests`)).length === 1, r.body);
  r = await stationOrder({ stationOrderId: 'sc_000000000000000000000000', orderKey: 'fake' });
  check('…nor can a charge that was never made', r.status === 402, r.body);
  r = await O({ itemId: 'latte', quantity: 1, boothId: 'b1', settle: 'renter_comp', orderKey: 'comp1' });
  check('the host’s complimentary allowance from an old link: refused', r.status === 403 && r.body.linkNeedsUpdate === true, r.body);
  const comps: any[] = await Promise.all([O({ itemId: 'latte', quantity: 1, boothId: 'b1', settle: 'renter_comp', stationToken: t6, orderKey: 'comp2' }), O({ itemId: 'latte', quantity: 1, boothId: 'b1', settle: 'renter_comp', stationToken: t6, orderKey: 'comp3' })]);
  check('…from the signed link, one a day allowed and two at once: only one is complimentary', comps.filter((x) => x.body.ok).length === 1, comps.map((x) => x.body));

  console.log('a renter’s incidental charge');
  await fresh();
  const inc = (x: any = {}, h: Record<string, string> = { authorization: 'Bearer staff' }) => setupCard(req({ tenantId: 't1', renterId: 'rt1', category: 'Cleaning', amountCents: 2000, key: 'try1', ...x }, h)) as any;
  r = await inc({}, {});
  check('without signing in (anyone who knows the renter’s id): refused, nothing charged', r.status === 401 && piCalls === 0, r.body);
  r = await inc({ key: '' });
  check('a screen that doesn’t name the attempt is asked to reload, nothing charged', r.status === 400 && piCalls === 0, r.body);
  const pair: any[] = await Promise.all([inc(), inc()]);
  const rt = await get(`${T}/renters/rt1`);
  check('two taps at once: charged once, one line, on their log once', charges.length === 1 && (await lines('renterinc_')).length === 1 && rt.incidentals.length === 1 && rt.incidentalsTotalCents === 2000 && pair.filter((x) => x.body.ok).length >= 1, pair.map((x) => x.body));
  r = await inc({ key: 'try2' });
  check('…a second charge (a new attempt): charged as well', r.body.ok && charges.length === 2 && (await lines('renterinc_')).length === 2, r.body);
  mode = 'lost_after';
  r = await inc({ key: 'try3' });
  check('the answer lost: it says to try again, nothing recorded yet', r.status === 502 && (await lines('renterinc_')).length === 2, r.body);
  await db.doc(`${T}/renters/rt1/charges/inc_try3`).set({ claimAt: new Date(Date.now() - 5 * 60000).toISOString() }, { merge: true });
  r = await inc({ key: 'try3' });
  check('…asked again: the same charge at Stripe, recorded once', r.body.ok && charges.length === 3 && (await lines('renterinc_')).length === 3 && (await get(`${T}/renters/rt1`)).incidentalsTotalCents === 6000, r.body);
  mode = 'decline';
  r = await inc({ key: 'try4' });
  check('the card says no: nothing recorded', r.status === 402 && (await lines('renterinc_')).length === 3 && (await get(`${T}/renters/rt1/charges/inc_try4`)).status === 'failed', r.body);
  mode = 'ok';

  console.log('what a phone number alone tells');
  await fresh();
  const perkCounts = (q: Record<string, string>, h: Record<string, string> = {}) => ordersRoute.GET(getReq({ tenantId: 't1', ...q }, h)) as any;
  const member: any = await perkCounts({ phone: '+15553334444' });
  const nobody: any = await perkCounts({ phone: '+15550001111' });
  check('a member’s number alone: told nothing — the same answer as a number nobody has', member.body.ok && JSON.stringify(member.body) === JSON.stringify(nobody.body) && Object.keys(member.body.perkRemaining || {}).length === 0, { member: member.body, nobody: nobody.body });
  r = await perkCounts({ phone: '+15553334444' }, { authorization: 'Bearer staff' });
  check('…on the front desk’s screen: the club allowance left', r.body.perkRemaining?.latte === 1, r.body);
  const cp = await codeFor('5553334444');
  r = await perkCounts({ phone: '+15553334444', pass: cp.pass });
  check('…with the pass from the code we text them: the same', r.body.perkRemaining?.latte === 1, r.body);
  r = await perkCounts({ phone: '+15553334444', pass: `${Date.now() + 3600e3}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` });
  check('…a made-up pass: told nothing', Object.keys(r.body.perkRemaining || {}).length === 0, r.body);
  r = await perkCounts({ phone: '+15550001111', pass: cp.pass });
  check('…another number’s pass: told nothing', Object.keys(r.body.perkRemaining || {}).length === 0, r.body);
  const asNobody: any = await O({ itemId: 'latte', quantity: 1, phone: '+15550001111', settle: 'balance', orderKey: 'u1' });
  const asClient: any = await O({ itemId: 'latte', quantity: 1, phone: '+15553334444', settle: 'balance', orderKey: 'u2' });
  check('“add it to my visit” for a number nobody has and for a client’s: the same answer', asNobody.status === 403 && asClient.status === 403 && asNobody.body.needsCode && JSON.stringify(asNobody.body) === JSON.stringify(asClient.body), { a: asNobody.body, b: asClient.body });
  r = await O({ itemId: 'latte', quantity: 1, phone: '+15550001111', settle: 'desk', orderKey: 'u3' });
  check('…paying when it arrives, with a number nobody has: taken as a walk-in order, not “not found”', r.body.ok && r.body.settledBy === 'desk' && (await get(`${T}/refreshmentRequests/${r.body.requestId}`)).clientId === 'guest-walkin', r.body);
  r = await K({ action: 'active-stay', phone: '+15551112222' });
  check('the kiosk’s stay lookup by a phone number alone: told nothing', r.body.ok && r.body.found === false && !r.body.reservationId, r.body);
  r = await K({ action: 'active-stay', phone: '+15551112222' }, { authorization: 'Bearer staff' });
  check('…on the front desk’s screen: the guest checked in today is found', r.body.found === true && r.body.reservationId === 'res1', r.body);
  const gp = await codeFor('5551112222');
  r = await K({ action: 'active-stay', phone: '+15551112222', guestPass: gp.pass });
  check('…or with the pass from the code texted to them', r.body.found === true, r.body);

  console.log('replacing a renter’s card on file');
  await fresh();
  await db.doc(`${T}/renters/rt2`).set({ firstName: 'Ola', lastName: 'Diaz' });
  const sPost = (x: any = {}, h: Record<string, string> = {}) => setupRoute.POST(req({ tenantId: 't1', renterId: 'rt1', returnUrl: 'https://studio.test/card-setup/t1', ...x }, h)) as any;
  const sGet = (q: Record<string, string>) => setupRoute.GET(getReq({ tenantId: 't1', renterId: 'rt1', ...q })) as any;
  r = await sPost();
  check('starting a card setup with nobody signed in and no link: refused, nothing set up at Stripe', r.status === 401 && sessions.length === 0, r.body);
  r = await sPost({}, { authorization: 'Bearer renter-rt2' });
  check('…another renter signed in to their portal: refused', r.status === 401 && sessions.length === 0, r.body);
  r = await sPost({}, { authorization: 'Bearer staff' });
  const ownerLink = String(r.body.url || '');
  const lk = (() => { try { return new URL(ownerLink).searchParams.get('k') || ''; } catch { return ''; } })();
  check('the team signed in gets the link to send: our own card page, signed for the renter (nothing at Stripe yet)', r.body.ok && ownerLink.startsWith('https://studio.test/card-setup/t1?r=rt1&k=') && !!lk && sessions.length === 0, r.body);
  r = await sGet({ link: lk });
  check('…opening it: the studio’s name and the renter’s first name, nothing more', r.body.ok && r.body.studioName === 'Opal' && r.body.renterFirstName === 'Nia' && Object.keys(r.body).length === 3, r.body);
  r = await sGet({ link: lk.replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A')) });
  check('…a link that’s been changed is no good', r.status === 403 && r.body.linkExpired === true, r.body);
  r = await sPost({ linkToken: lk });
  check('…from the link, the renter is sent to Stripe’s card page, and the setup records how it was started', r.body.ok && r.body.url === 'https://checkout.stripe.test/cs_1' && sessions[0]?.p?.metadata?.cfAuth === 'link'
    && String(sessions[0]?.p?.success_url).startsWith('https://studio.test/card-setup/t1?cfCardSetup=1') && String(sessions[0]?.p?.cancel_url).includes(`k=${encodeURIComponent(lk)}`), { body: r.body, p: sessions[0]?.p });
  stripeSessions.get('cs_1').setup_intent = { status: 'succeeded', payment_method: 'pm_new' };
  const saves: any[] = await Promise.all([sGet({ session: 'cs_1' }), sGet({ session: 'cs_1' })]);
  const rtNow: any = await get(`${T}/renters/rt1`);
  const notes = (await all(`${T}/notifications`)).filter((n: any) => String(n.id).startsWith('cardsetup_'));
  check('back from Stripe, twice at once: the card is saved, and the owner told once', saves.every((x) => x.body.ok && x.body.cardLast4 === '4242') && rtNow.stripePaymentMethodId === 'pm_new' && rtNow.cardSetupSessionId === 'cs_1' && notes.length === 1, { saves: saves.map((x) => x.body), notes: notes.length });
  r = await sPost({ linkToken: lk });
  check('…the same link once a card is saved with it: no longer works', r.status === 403 && r.body.linkExpired === true && /already been used/.test(String(r.body.error)), r.body);
  stripeSessions.set('cs_old', { id: 'cs_old', mode: 'setup', metadata: { tenantId: 't1', renterId: 'rt1' }, customer: rtNow.stripeCustomerId, setup_intent: { status: 'succeeded', payment_method: 'pm_someone' } });
  r = await sGet({ session: 'cs_old' });
  check('a card link sent before this check: told to ask the studio for a new one, and the card isn’t replaced', r.status === 410 && /ask Opal for a new one/.test(String(r.body.error)) && (await get(`${T}/renters/rt1`)).stripePaymentMethodId === 'pm_new', r.body);
  stripeSessions.set('cs_other', { id: 'cs_other', mode: 'setup', metadata: { tenantId: 't1', renterId: 'rt2', cfAuth: 'staff' }, customer: rtNow.stripeCustomerId, setup_intent: { status: 'succeeded', payment_method: 'pm_x' } });
  r = await sGet({ session: 'cs_other' });
  check('…a setup started for another renter isn’t stored on this one', r.status === 410 && (await get(`${T}/renters/rt1`)).stripePaymentMethodId === 'pm_new', r.body);
  r = await sPost({}, { authorization: 'Bearer renter-rt1' });
  check('the renter signed in to their own portal: straight to Stripe’s card page', r.body.ok && /checkout\.stripe\.test/.test(String(r.body.url)) && sessions[sessions.length - 1].p.metadata.cfAuth === 'renter', r.body);
  await db.doc(`${T}/private/renterSessions`).set({ [createHash('sha256').update('guest-session').digest('hex')]: { renterId: 'rt1', expiresAt: Date.now() + 3600e3 } });
  r = await sPost({ portalToken: 'guest-session' });
  check('…or with their guest portal session', r.body.ok && sessions[sessions.length - 1].p.metadata.cfAuth === 'renter', r.body);
  r = await sPost({ portalToken: 'guest-session', renterId: 'rt2' });
  check('…that session doesn’t work for another renter', r.status === 401, r.body);
  r = await sPost({ returnUrl: 'https://evil.example.com/steal' }, { authorization: 'Bearer renter-rt1' });
  check('a return address on another site isn’t used: Stripe sends them back to the card page here', String(sessions[sessions.length - 1].p.success_url).startsWith('https://studio.test/card-setup/t1?'), sessions[sessions.length - 1]?.p?.success_url);
  const lastLink = (await sPost({}, { authorization: 'Bearer staff' })).body.url;
  const lk2 = (() => { try { return new URL(String(lastLink)).searchParams.get('k') || ''; } catch { return ''; } })();
  r = await sGet({ link: lk2 });
  check('a new link made after the card was saved works', r.body.ok, r.body);
  const realNow = Date.now; Date.now = () => realNow() + 8 * 864e5;
  try { r = await sGet({ link: lk2 }); } finally { Date.now = realNow; }
  check('a link more than 7 days old: told it has expired', r.status === 403 && /expired/.test(String(r.body.error)), r.body);

  console.log('enrolling a membership or package');
  await fresh();
  r = await enroll(req({ tenantId: 't1', clientId: 'c1', offeringType: 'package', offeringId: 'pk1' }));
  check('without signing in: refused, nothing granted', r.status === 401 && enrolled.length === 0, r.body);
  r = await enroll(req({ tenantId: 't1', clientId: 'c1', offeringType: 'package', offeringId: 'pk1' }, { 'x-cf-internal': 'sec' }));
  check('our own server (checkout): enrolled', r.body.ok && enrolled.length === 1, r.body);
  r = await enroll(req({ tenantId: 't1', clientId: 'c1', offeringType: 'membership', offeringId: 'mem1' }, { authorization: 'Bearer staff' }));
  check('the team, signed in: enrolled', r.body.ok && enrolled.length === 2, r.body);
  const checkoutSrc = readFileSync('src/app/api/checkout/complete/route.ts', 'utf8');
  const enrollCall = checkoutSrc.split('\n').find((l) => l.includes('/api/memberships/enroll')) || '';
  check('checkout’s call to enroll sends the internal header (and the desk’s sign-in)', /internalHeaders\(origin\)/.test(enrollCall) && /Authorization: authz/.test(enrollCall), enrollCall.slice(0, 200));

  console.log('the deposit page');
  await fresh();
  await db.doc(`${T}/bookingRequests/br1`).set({ clientName: 'Guest', serviceName: 'Gel', depositAmount: 50 });
  r = await deposit(req({ tenantId: 't1', bookingRequestId: 'br1', depositAmount: 1, clientEmail: 'x@example.com' }));
  check('the old booking-request way, with the browser’s amount: refused, no payment page made', r.status === 410 && sessions.length === 0, r.body);
  await db.doc(`${T}/appointments/ap1`).set({ status: 'pending_payment', depositAmountCents: 2500, clientName: 'Maya Lopez', clientEmail: 'maya@example.com', serviceName: 'Gel fill' });
  r = await deposit(req({ tenantId: 't1', appointmentId: 'ap1', depositAmount: 1 }));
  check('a booking holding its time: the deposit is the booking’s own ($25.00), whatever the browser says', r.status === 200 && sessions.length === 1 && sessions[0].p.line_items[0].price_data.unit_amount === 2500 && sessions[0].p.metadata.appointmentId === 'ap1' && sessions[0].o.stripeAccount === 'acct_1', { body: r.body, s: sessions[0]?.p?.line_items });

  console.log('dispute evidence');
  await fresh();
  const own = 'https://firebasestorage.googleapis.com/v0/b/studio.appspot.com/o/tenants%2Ft1%2Fdispute-evidence%2Fd1%2Fphoto.jpg?alt=media&token=abc';
  await db.doc(`${T}/disputes/d1`).set({ id: 'd1', stripeDisputeId: 'dp_1', stripeConnectedAccountId: 'acct_1', clientName: 'Maya Lopez', amount: 60, createdAt: new Date().toISOString(),
    signatureUrls: ['https://firebasestorage.googleapis.com/v0/b/studio.appspot.com/o/tenants%2Ft2%2Fsignatures%2Fs.png?alt=media'], receiptUrl: own });
  const ev = (x: any = {}, h: Record<string, string> = { authorization: 'Bearer manager' }) => evidence(req({ tenantId: 't1', disputeId: 'd1', stripeDisputeId: 'dp_1', stripeConnectedAccountId: 'acct_evil', evidenceText: 'Service done.', ...x }, h)) as any;
  r = await ev({}, {});
  check('without signing in: refused, nothing sent to Stripe', r.status === 401 && disputeUpdates.length === 0, r.body);
  r = await ev({}, { authorization: 'Bearer staff' });
  check('…by someone who isn’t a manager: refused', r.status === 403 && disputeUpdates.length === 0, r.body);
  r = await ev({ stripeDisputeId: 'dp_other' });
  check('a dispute id that isn’t this dispute’s: refused', r.status === 400 && disputeUpdates.length === 0, r.body);
  r = await ev({ additionalFiles: [
    { url: 'http://169.254.169.254/latest/meta-data/', purpose: 'receipt' },
    { url: 'https://evil.example.com/x.png', purpose: 'uncategorized_file' },
    { url: 'https://firebasestorage.googleapis.com/v0/b/other-bucket/o/tenants%2Ft1%2Fx.png?alt=media', purpose: 'uncategorized_file' },
    { url: own, purpose: 'service_documentation' },
  ] });
  check('a manager: submitted on the business’s own account, whatever account the screen names', r.body.ok && disputeUpdates.length === 1 && disputeUpdates[0].o.stripeAccount === 'acct_1' && disputeUpdates[0].id === 'dp_1' && disputeUpdates[0].p.submit === true, { body: r.body, u: disputeUpdates[0]?.o });
  check('…no address from the screen is fetched; only the business’s own stored files are read', fetched.length === 0 && downloads.length === 2 && downloads.every((d) => d.startsWith('studio.appspot.com/tenants/t1/')) && files.length === 2, { fetched, downloads });
  r = await ev();
  check('…submitted again: done already, nothing more sent', r.body.ok && r.body.already && disputeUpdates.length === 1, r.body);

  console.log('scheduled jobs');
  const { cronAllowed } = await import('../../src/lib/cron-auth');
  const hdr = (v: string | null) => ({ headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? v : null) } });
  delete process.env.CRON_SECRET;
  check('no secret set: nobody may start a job, “Bearer undefined” included', !cronAllowed(hdr('Bearer undefined')) && !cronAllowed(hdr(null)) && !cronAllowed(hdr('Bearer ')));
  const renewals = (await import('../../src/app/api/cron/membership-renewals/route')).GET;
  const autopay = (await import('../../src/app/api/cron/autopay-leases/route')).GET;
  r = await renewals(req({}, { authorization: 'Bearer undefined' }));
  const r2: any = await autopay(req({}, { authorization: 'Bearer undefined' }));
  check('…the renewal run and rent autopay refuse it', r.status === 401 && renewalsRun === 0 && r2.status === 401, { r: r.body, r2: r2.body });
  const sweep = (await import('../../src/app/api/appointments/sweep-overdue/route')).GET;
  r = await sweep(getReq({}, { authorization: 'Bearer undefined' }));
  check('…and so does the overdue-appointments sweep', r.status === 401, r.body);
  process.env.CRON_SECRET = 'sec';
  r = await sweep(getReq({}, { authorization: 'Bearer wrong' }));
  check('…which, with the secret set, still refuses a wrong one', r.status === 401, r.body);
  delete process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'sec';
  check('with the secret set: only the exact secret', cronAllowed(hdr('Bearer sec')) && !cronAllowed(hdr('Bearer sec ')) && !cronAllowed(hdr('Bearer se')) && !cronAllowed(hdr('sec')));
  await db.doc(`${T}/clients/c1`).set({ subscription: { status: 'active' } }, { merge: true });
  r = await renewals(req({}, { authorization: 'Bearer sec' }));
  check('…the scheduler with the secret runs the job', r.status === 200 && r.body.ok && renewalsRun === 1, r.body);
  const open: string[] = [];
  for (const dir of readdirSync('src/app/api/cron')) {
    let src = ''; try { src = readFileSync(`src/app/api/cron/${dir}/route.ts`, 'utf8'); } catch { continue; }
    const guarded = /refuseCron\(req\)/.test(src) || /!process\.env\.CRON_SECRET \|\|/.test(src);
    const failsOpen = /if \(secret && /.test(src) || /process\.env\.CRON_SECRET && /.test(src) || /if \(authHeader !== `Bearer/.test(src);
    if (!guarded || failsOpen) open.push(dir);
  }
  const sweepSrc = readFileSync('src/app/api/appointments/sweep-overdue/route.ts', 'utf8');
  if (!/refuseCron\(req\)/.test(sweepSrc) || /if \(!secret\) return true/.test(sweepSrc)) open.push('appointments/sweep-overdue');
  check('every scheduled job refuses when the secret is missing', open.length === 0, open);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('public-routes ok');
})();
