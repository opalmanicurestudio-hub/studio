// Checks the Renters list by stage (lib/renters-roster):
// - Stages: current, new (no lease yet), signing, ending soon (or past its end), time away, past, missing something.
// - Each column in a few words, amber when something needs doing, with where to fix it: the lease, what they owe
//   (late with Record payment), autopay (no card when they turned it on), insurance and license (only asked of
//   someone with a lease), and the portal.
// - Most pressing first.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renters-roster.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
let role = 'owner';
const M: any = Module as any;
const load = M._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const is = (request: string, name: string) => request === `@/lib/${name}` || new RegExp(`/src/lib/${name}(\\.ts)?$`).test(request);
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (is(request, 'firebase-admin')) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (is(request, 'route-guard')) return fake(request, { requireCan: async (_r: any, _t: string, cap: string) => (role === 'none' || cap !== 'money.view' ? { deny: { status: 403, body: { ok: false } } } : { actor: { uid: 'u1', name: 'Dana', role } }) });
  return load.call(this, request, ...rest);
};

const today = '2026-11-10';
(async () => {
  const R = await import('../../src/lib/renters-roster');
  const tenant = { bookingPageSettings: { automationRules: { requireInsurance: true, requireLicense: false } } };
  const renters = [
    { id: 'r1', firstName: 'Jordan', lastName: 'Lee', specialty: 'Barber', status: 'active', insuranceExpiry: '2027-06-01', portalInviteStatus: 'accepted', portalLastSeenAt: '2026-11-02T10:00:00Z', autopayEnabled: false },
    { id: 'r2', firstName: 'Priya', lastName: 'Shah', status: 'active', insuranceExpiry: '2026-11-16', insuranceDocUrl: 'x', portalInviteStatus: 'accepted', portalLastSeenAt: '2026-11-10T08:00:00Z', autopayEnabled: true, stripeCustomerId: 'c', stripePaymentMethodId: 'pm' },
    { id: 'r3', firstName: 'Maya', lastName: 'Ortiz', status: 'prospective', portalInviteStatus: 'sent' },
    { id: 'r4', firstName: 'Sam', lastName: 'Chen', status: 'active', insuranceExpiry: '2027-04-01', portalInviteStatus: 'accepted', portalFirstSeenAt: '2026-10-29T00:00:00Z', autopayEnabled: true },
    { id: 'r5', firstName: 'Rosa', lastName: 'Diaz', status: 'on_leave', portalInviteStatus: 'not_sent' },
    { id: 'r6', firstName: 'Dev', lastName: 'Rao', status: 'prospective' },
    { id: 'r7', firstName: 'Old', lastName: 'Timer', status: 'past', insuranceExpiry: '2025-01-01' },
    { id: 'r8', firstName: 'Gone', lastName: 'Record', status: 'archived' },
  ];
  const leases = [
    { id: 'l1', renterId: 'r1', boothId: 'b2', status: 'active', dueDay: 1, endDate: '2027-03-01', autoRenew: true },
    { id: 'l2', renterId: 'r2', boothId: 'b11', status: 'active', dueDay: 1, endDate: '2027-06-17', autoRenew: true },
    { id: 'l3', renterId: 'r3', boothId: 'b4', status: 'pending_signature', dueDay: 1, endDate: '2027-11-13' },
    { id: 'l4', renterId: 'r4', boothId: 'b9', status: 'active', dueDay: 1, endDate: '2026-12-31', autoRenew: false },
    { id: 'l5', renterId: 'r5', boothId: 'b5', status: 'on_leave', dueDay: 1, endDate: '2027-02-01', autoRenew: true },
    { id: 'l7', renterId: 'r7', boothId: 'b1', status: 'ended', endDate: '2025-06-01' },
  ];
  const booths = [['b2', 'Suite 2'], ['b11', 'Suite 11'], ['b4', 'Suite 4'], ['b9', 'Suite 9'], ['b5', 'Suite 5'], ['b1', 'Suite 1']].map(([id, name]) => ({ id, name }));
  const invoices = [{ id: 'i1', renterId: 'r1', status: 'late', amountCents: 90000, lateFeeCents: 2500, paidCents: 0, dueDate: '2026-11-01' }, { id: 'i2', renterId: 'r4', status: 'due', amountCents: 85000, paidCents: 0, dueDate: '2026-11-10' }];
  const x = R.rentersRoster({ todayIso: today, tenant, renters, leases, booths, invoices, ledger: [], leaves: [{ id: 'v', renterId: 'r5', status: 'approved', startDate: '2026-11-01', endDate: '2026-12-07' }] });
  const r = Object.fromEntries(x.rows.map((v: any) => [v.id, v]));
  check('an archived record isn’t listed', !r.r8 && x.rows.length === 7);
  check('stages', r.r1.stages.join() === 'current' && r.r3.stages.join() === 'signing,missing' && r.r4.stages.includes('ending') && r.r5.stages.includes('away') && r.r5.stages.includes('current') && r.r6.stages.join() === 'new' && r.r7.stages.join() === 'past', x.rows.map((v: any) => `${v.id}:${v.stages}`));
  check('lease: to a date, not signed yet, ends soon, time away, no lease yet (to write one), moved out',
    r.r1.lease.text === 'To Mar 1, 2027' && r.r3.lease.text === 'Not signed yet' && r.r3.lease.warn && r.r4.lease.text === 'Ends Dec 31' && r.r4.lease.warn && r.r5.lease.text === 'Time away to Dec 7' && r.r6.lease.text === 'No lease yet' && r.r6.lease.href === '/booths?lease=r6' && r.r7.lease.text === 'Moved out',
    x.rows.map((v: any) => v.lease));
  check('balance: late with Record payment, due, nothing', r.r1.balance.text === '$925 late' && r.r1.balance.warn && r.r1.balance.href === '/rent?pay=r1' && r.r4.balance.text === '$850 due' && !r.r4.balance.warn && r.r2.balance.text === '$0');
  check('autopay: on, off, no card when they turned it on', r.r2.autopay.text === 'On' && r.r1.autopay.text === 'Off' && !r.r1.autopay.warn && r.r4.autopay.text === 'No card' && r.r4.autopay.warn && r.r6.autopay.text === 'None');
  check('papers: to a month, running out, not on file when required, not needed when not; nobody without a lease is chased',
    r.r1.insurance.text === 'To Jun 2027' && r.r2.insurance.text === 'Ends in 6 days' && r.r2.insurance.warn && r.r5.insurance.text === 'Not on file' && r.r5.insurance.warn && r.r1.license.text === 'Not needed' && !r.r6.insurance.warn && r.r6.insurance.text === 'None' && !r.r7.insurance.warn,
    x.rows.map((v: any) => [v.id, v.insurance, v.license]));
  check('portal: used today, used on a day, link sent, never opened', r.r2.portal.text === 'Used today' && r.r1.portal.text === 'Used Nov 2' && r.r4.portal.text === 'Used Oct 29' && r.r3.portal.text === 'Link sent, not opened' && r.r3.portal.warn && r.r5.portal.text === 'Never opened' && r.r5.portal.warn && !r.r6.portal.warn);
  check('missing something says what', r.r2.missing.join() === 'insurance ends in 6 days' && r.r5.missing.includes('insurance not on file') && r.r5.missing.includes('portal not opened') && r.r4.missing.includes('autopay has no card') && !r.r1.stages.includes('missing'));
  check('most pressing first: late rent at the top', x.rows[0].id === 'r1', x.rows.map((v: any) => v.id));
  const c = Object.fromEntries(x.chips.map((v: any) => [v.key, v.count]));
  check('stage counts', c.current === 4 && c.new === 1 && c.signing === 1 && c.ending === 1 && c.away === 1 && c.past === 1 && c.missing === 4, c);

  check('everyone is in at least one stage, so nobody drops out of every filter', x.rows.every((v: any) => v.stages.length > 0));

  const z = R.rentersRoster({
    todayIso: today, tenant, timeZone: 'America/Los_Angeles', businessAccount: 'acct_biz', booths,
    renters: [
      { id: 'q1', firstName: 'Card', lastName: 'Elsewhere', status: 'active', autopayEnabled: true, stripeCustomerId: 'c', stripePaymentMethodId: 'pm', stripeCustomerAccount: 'acct_old', insuranceExpiry: '2027-06-01', portalInviteStatus: 'accepted', portalLastSeenAt: '2026-11-11T02:00:00Z' },
      { id: 'q2', firstName: 'Card', lastName: 'Here', status: 'active', autopayEnabled: true, stripeCustomerId: 'c', stripePaymentMethodId: 'pm', stripeCustomerAccount: 'acct_biz', insuranceExpiry: '2027-06-01', portalInviteStatus: 'accepted', portalLastSeenAt: '2026-11-10T07:00:00Z' },
      { id: 'q3', firstName: 'Left', lastName: 'Quietly', status: 'active' },
      { id: 'q4', firstName: 'Owes', lastName: 'Charge', status: 'active', insuranceExpiry: '2027-06-01', portalInviteStatus: 'accepted' },
      { id: 'q5', firstName: 'Never', lastName: 'Signed', status: 'prospective' },
    ],
    leases: [
      { id: 'k1', renterId: 'q1', boothId: 'b2', status: 'active', dueDay: 1 }, { id: 'k2', renterId: 'q2', boothId: 'b4', status: 'active', dueDay: 1 },
      { id: 'k3', renterId: 'q3', boothId: 'b5', status: 'ended', endDate: '2026-09-30', activatedOn: '2025-10-01' }, { id: 'k5', renterId: 'q5', boothId: 'b1', status: 'ended' }, { id: 'k4', renterId: 'q4', boothId: 'b9', status: 'active', dueDay: 1, lateFeePolicy: { graceDays: 3 } },
    ],
    invoices: [], ledger: [{ id: 'o1', renterId: 'q4', leaseId: 'k4', type: 'one_off_charge', status: 'pending', amountCents: 12000, dueDate: '2026-11-01' }],
  });
  const zr = Object.fromEntries(z.rows.map((v: any) => [v.id, v]));
  check('autopay: a card saved on another account can’t be charged here; one on this account can', zr.q1.autopay.text === 'No card' && zr.q1.autopay.warn && zr.q2.autopay.text === 'On', [zr.q1.autopay, zr.q2.autopay]);
  check('portal: the business’s own day (an evening visit isn’t tomorrow)', zr.q1.portal.text === 'Used today' && zr.q2.portal.text === 'Used Nov 9', [zr.q1.portal, zr.q2.portal]);
  check('someone whose lease ended (not marked moved out) is past, not new', zr.q3.stages.join() === 'past' && zr.q3.lease.text === 'Moved out' && !zr.q3.lease.warn);
  check('…but a lease taken back before it was signed doesn’t make them past', zr.q5.stages.join() === 'new' && zr.q5.lease.text === 'No lease yet');
  check('a one-off charge past its grace is late, like the Rentals home says', zr.q4.balance.text === '$120 late' && zr.q4.balance.warn, zr.q4.balance);

  // ── The route ──
  const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Northside' });
  await db.doc(`${T}/booths/x1`).set({ name: 'Front', locationId: 'L1' });
  await db.doc(`${T}/booths/x2`).set({ name: 'Back', locationId: 'L2' });
  await db.doc(`${T}/renters/a`).set({ firstName: 'Ann', lastName: 'Bo', status: 'active', locationId: 'L2' });
  await db.doc(`${T}/renters/b`).set({ firstName: 'Ben', lastName: 'Cy', status: 'active', locationId: 'L2' });
  await db.doc(`${T}/renters/c`).set({ firstName: 'Cal', lastName: 'Do', status: 'prospective', locationId: 'L1' });
  await db.doc(`${T}/leases/la`).set({ renterId: 'a', boothId: 'x1', status: 'active', locationId: 'L1', dueDay: 1 });
  await db.doc(`${T}/leases/lb`).set({ renterId: 'b', boothId: 'x2', status: 'active', locationId: 'L2', dueDay: 1 });
  await db.doc(`${T}/rentInvoices/ia`).set({ renterId: 'a', leaseId: 'la', status: 'late', amountCents: 5000, paidCents: 0, dueDate: '2026-11-01' });
  const route = await import('../../src/app/api/renters/roster/route');
  const req = (q: string) => ({ headers: { get: () => null }, nextUrl: { searchParams: new URLSearchParams(q) } }) as any;
  const all: any = await route.GET(req('tenantId=t1'));
  check('the route: everyone', all.status === 200 && all.body.rows.length === 3, all.body);
  const l1: any = await route.GET(req('tenantId=t1&locationId=L1'));
  check('…one location: the renters on its leases (even when their own record says another) and anyone tied to it without a lease', l1.body.rows.map((v: any) => v.id).sort().join() === 'a,c' && l1.body.rows.find((v: any) => v.id === 'a').balance.text === '$50 late', l1.body.rows);
  // Someone who used to rent at L1 and now rents at L2 belongs to L2's list.
  await db.doc(`${T}/renters/d`).set({ firstName: 'Dee', lastName: 'Moved', status: 'active', locationId: 'L1' });
  await db.doc(`${T}/leases/ld1`).set({ renterId: 'd', boothId: 'x1', status: 'ended', locationId: 'L1' });
  await db.doc(`${T}/leases/ld2`).set({ renterId: 'd', boothId: 'x2', status: 'active', locationId: 'L2', dueDay: 1 });
  const m1: any = await route.GET(req('tenantId=t1&locationId=L1')); const m2: any = await route.GET(req('tenantId=t1&locationId=L2'));
  check('…someone who moved to another location is listed there, not here as needing a lease', !m1.body.rows.some((v: any) => v.id === 'd') && m2.body.rows.some((v: any) => v.id === 'd' && v.stages.includes('current')), [m1.body.rows.map((v: any) => v.id), m2.body.rows.map((v: any) => v.id)]);
  role = 'none';
  check('…only for someone who can see what renters owe', (await route.GET(req('tenantId=t1')) as any).status === 403);

  // ── The pages ──
  const src = (p: string) => readFileSync(p, 'utf8');
  const rp = src('src/app/(app)/renters/page.tsx');
  check('the Renters page is the list by stage, with what can’t be booked yet, Messages and Message everyone, and the messages desk', /<RentersRoster tenantId=\{tenantId\}/.test(rp) && /Can’t be booked yet/.test(rp) && /openDesk\('inbox'\)/.test(rp) && /openDesk\('everyone'\)/.test(rp) && /<RenterCommsDesk /.test(rp) && !/uppercase/.test(rp.slice(rp.indexOf('<RentalsHeader'), rp.indexOf('{profileRenter && tenantId'))));
  const portal = src('src/app/api/portal/renter/route.ts');
  check('the portal notes when a renter last used it, and keeps their first sign-in as the first', (portal.match(/portalLastSeenAt/g) || []).length >= 4 && /was\.portalFirstSeenAt \? \{\} : \{ portalFirstSeenAt: at \}/.test(portal) && /r\.portalFirstSeenAt \? \{\} : \{ portalFirstSeenAt: at \}/.test(portal));
  const bp = src('src/app/(app)/booths/page.tsx');
  check('Spaces: the list, lease this space with it already picked, from Convert too', /<SpacesBoard tenantId=\{tenantId\}/.test(bp) && /defaultBoothId=\{builderBoothId\}/.test(bp) && /onLease\(lease, space\)/.test(bp) && /openLeaseWizard\(rid, sourceApp\?\.boothId \|\| null\)/.test(bp)
    && /&space=\$\{encodeURIComponent\(r\.boothId\)\}/.test(src('src/app/(app)/pipeline/page.tsx')));
  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  const mine = ['src/lib/renters-roster.ts', 'src/app/api/renters/roster/route.ts', 'src/components/renters/RentersRoster.tsx'].map(src).join('\n');
  check('no tool names; no all-caps labels', !AI.test(mine) && !/uppercase/.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
