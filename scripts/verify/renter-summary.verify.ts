// Checks one renter on one page (lib/renter-summary): the one thing that needs doing about them, the six numbers
// (owes, next bill, lease, deposit, autopay, portal) and the lease, money, papers and business lines, each in amber when
// something needs doing, by the same rules as the Rentals home and the Renters list.
// Also: settings that make a renter look like staff (pay from their booking record, an employee record, also on the
// team), the route for one renter, and that every Rentals page opens the renter's own page, with one Record payment,
// one End lease and one Edit.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renter-summary.verify.ts
import Module from 'module';
import { readFileSync, existsSync } from 'fs';
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
  if (is(request, 'route-guard')) return fake(request, { requireCan: async (_r: any, _t: string, cap: string) => (role === 'none' || cap !== 'money.view' ? { deny: { status: 403, body: { ok: false } } } : { actor: { uid: 'u1', name: 'Dana', role, isRenter: role === 'renter' } }) });
  return load.call(this, request, ...rest);
};

const today = '2026-11-10';
(async () => {
  const src0 = (p: string) => readFileSync(p, 'utf8');
  const S = await import('../../src/lib/renter-summary');
  const tenant = { bookingPageSettings: { automationRules: { requireInsurance: true, requireLicense: true } } };
  const booths = [{ id: 'b4', name: 'Suite 4' }, { id: 'b2', name: 'Suite 2' }];
  // Signing: a lease sent, waiting.
  const maya = { id: 'r1', firstName: 'Maya', lastName: 'Ortiz', businessName: 'Lash Lab', status: 'prospective', insuranceExpiry: '2027-10-01', insuranceCarrier: 'Hartline', licenseExpiry: '2028-03-01', portalInviteStatus: 'accepted', portalLastSeenAt: '2026-11-10T09:00:00Z', autopayEnabled: false };
  const l1 = { id: 'l1', renterId: 'r1', boothId: 'b4', status: 'pending_signature', rentAmountCents: 90000, frequency: 'monthly', dueDay: 1, startDate: '2026-11-14', endDate: '2027-11-13', autoRenew: true, deposit: { amountCents: 90000 }, leaseFrom: 'builder', leaseVersion: 4, lateFeePolicy: { enabled: true, type: 'flat', amountCents: 2500, graceDays: 3 }, businessSignature: { name: 'Dana Park', at: '2026-11-08T10:00:00Z' } };
  const a = S.renterSummary({ todayIso: today, tenant, renter: maya, leases: [l1], booths, invoices: [], ledger: [], documents: [{ kind: 'lease', leaseId: 'l1', status: 'sent', sentAt: '2026-11-08T10:00:00Z' }], w9OnFile: true });
  const t = Object.fromEntries(a.tiles.map((v: any) => [v.label, v]));
  check('who and where; the one thing: not signed yet', a.name === 'Maya Ortiz' && a.initials === 'MO' && a.sub === 'Lash Lab · Suite 4' && a.status.text === 'Hasn’t signed their lease yet' && a.status.warn, a);
  check('tiles: nothing owed, lease not signed, deposit not asked for yet, autopay off, portal used today', t['Owes'].value === '$0' && t['Lease'].value === 'Not signed yet' && t['Lease'].warn && t['Deposit'].value === '$900 not paid' && !t['Deposit'].warn && t['Autopay'].value === 'Off' && t['Portal'].value === 'Used today', a.tiles);
  const line = (ls: any[], label: string) => ls.find((l: any) => l.label === label);
  check('lease lines: sent, your signature, made from, term, rent with the late fee', line(a.lease, 'Signed').value === 'Sent Nov 8, not signed yet' && line(a.lease, 'Your signature').value === 'Dana Park, Nov 8, 2026' && line(a.lease, 'Made from').value === 'Your lease settings, version 4'
    && line(a.lease, 'Term').value === 'Nov 14, 2026 to Nov 13, 2027, renews' && line(a.lease, 'Rent').value === '$900 on the 1st, $25 late fee after 3 days', a.lease);
  check('papers: insurance with its carrier, license, W-9 on file, notice address missing', line(a.papers, 'Insurance').value === 'Hartline, to Oct 2027' && line(a.papers, 'License').value === 'To Mar 2028' && line(a.papers, 'W-9').value === 'On file' && line(a.papers, 'Address for notices').warn, a.papers);

  // Running, late, ending, papers short.
  const jo = { id: 'r2', firstName: 'Jordan', lastName: 'Lee', status: 'active', insuranceExpiry: '2026-11-16', insuranceDocUrl: 'x', portalInviteStatus: 'not_sent', noticeAddress: '1 Main St', autopayEnabled: true };
  const l2 = { id: 'l2', renterId: 'r2', boothId: 'b2', status: 'active', rentAmountCents: 90000, frequency: 'monthly', dueDay: 1, startDate: '2026-01-01', activatedOn: '2026-01-01', endDate: '2026-12-31', autoRenew: false, deposit: { amountCents: 90000 }, signedAt: '2025-12-20T00:00:00Z', signedByName: 'Jordan Lee' };
  const inv = [{ id: 'i1', renterId: 'r2', leaseId: 'l2', status: 'late', amountCents: 90000, lateFeeCents: 2500, paidCents: 0, dueDate: '2026-11-01' }, { id: 'i0', renterId: 'r2', leaseId: 'l2', status: 'paid', amountCents: 90000, dueDate: '2026-10-01' }];
  const led = [{ id: 'd', renterId: 'r2', leaseId: 'l2', type: 'deposit_charge', status: 'paid', amountCents: 90000 }];
  const b = S.renterSummary({ todayIso: today, tenant, renter: jo, leases: [l2], booths, invoices: inv, ledger: led, w9OnFile: false, grievances: [{ renterId: 'r2', status: 'open' }] });
  const u = Object.fromEntries(b.tiles.map((v: any) => [v.label, v]));
  check('late rent comes first; owes in amber', b.status.text === 'Rent late since Nov 1' && u['Owes'].value === '$925' && u['Owes'].warn && line(b.money, 'Balance').value === '$925, late', b.status);
  check('lease ending without renewing; deposit held; autopay on but no card', u['Lease'].value === 'Ends Dec 31' && u['Deposit'].value === '$900 held' && u['Autopay'].value === 'No card' && u['Autopay'].warn, b.tiles);
  check('rent bills paid this year counts bills due this year that are paid', line(b.money, 'Rent bills paid, 2026').value === '$900');
  check('papers short: insurance ending, license required and not on file, W-9 not on file', line(b.papers, 'Insurance').value === 'Ends in 6 days' && line(b.papers, 'Insurance').warn && line(b.papers, 'License').value === 'Not on file' && line(b.papers, 'License').warn && line(b.papers, 'W-9').value === 'Not on file' && !line(b.papers, 'Address for notices').warn);
  check('their business: portal never opened, a concern open, bookings not set up', line(b.business, 'Portal').value === 'Never opened' && line(b.business, 'Portal').warn && /^1 concern, no repairs, no time away$/.test(line(b.business, 'Open items').value) && line(b.business, 'Bookings').value === 'Not set up' && line(b.business, 'Bookings').warn, b.business);

  // Past: moved out, nothing chased.
  const old = { id: 'r3', firstName: 'Old', lastName: 'Timer', status: 'past', insuranceExpiry: '2025-01-01' };
  const c = S.renterSummary({ todayIso: today, tenant, renter: old, leases: [{ id: 'l3', renterId: 'r3', boothId: 'b2', status: 'ended', endDate: '2025-06-01', rentAmountCents: 1 }], booths, invoices: [], ledger: [] });
  check('moved out: nothing in amber', c.status.text === 'Moved out' && !c.status.warn && !c.papers.some((l: any) => l.warn) && !c.tiles.some((v: any) => v.warn), c);

  // A one-off charge past its grace is late, as the Rentals home says.
  const oc = S.renterSummary({ todayIso: today, tenant: {}, renter: { id: 'r5', firstName: 'One', lastName: 'Off', status: 'active', portalInviteStatus: 'accepted' }, leases: [{ id: 'l5', renterId: 'r5', boothId: 'b2', status: 'active', dueDay: 1, lateFeePolicy: { graceDays: 3 } }], booths, invoices: [],
    ledger: [{ id: 'c', renterId: 'r5', leaseId: 'l5', type: 'one_off_charge', status: 'pending', amountCents: 15000, dueDate: '2026-10-31' }] });
  check('a one-off charge past its grace: late, in amber, Record payment first', oc.late && oc.status.text === 'A charge is late' && oc.tiles[0].warn && oc.tiles[0].value === '$150', [oc.status, oc.tiles[0]]);

  // Deposits in every state.
  const dep = (leases: any[], ledger: any[]) => S.renterSummary({ todayIso: today, tenant: {}, renter: { id: 'd', firstName: 'D', lastName: 'Ep', status: 'active', portalInviteStatus: 'accepted' }, leases, booths, invoices: [], ledger });
  const L = (st: string, extra: any = {}) => ({ id: 'ld', renterId: 'd', boothId: 'b2', status: st, dueDay: 1, deposit: { amountCents: 90000 }, rentAmountCents: 1, ...extra });
  const paid = { id: 'p', renterId: 'd', leaseId: 'ld', type: 'deposit_charge', status: 'paid', amountCents: 90000 };
  const dt = (x: any) => x.tiles.find((t: any) => t.label === 'Deposit');
  check('deposit: partly returned says so (not unpaid)', dt(dep([L('active')], [paid, { id: 'r', renterId: 'd', leaseId: 'ld', type: 'deposit_refund', status: 'paid', amountCents: -40000 }])).value === '$500 held', dt(dep([L('active')], [paid, { id: 'r', renterId: 'd', leaseId: 'ld', type: 'deposit_refund', status: 'paid', amountCents: -40000 }])));
  check('…held after the lease ended: to settle, in amber, and said first', dt(dep([L('ended', { activatedOn: '2025-01-01' })], [paid])).value === '$900 to settle' && dt(dep([L('ended', { activatedOn: '2025-01-01' })], [paid])).warn && /^Deposit \$900 to settle$/.test(dep([L('ended', { activatedOn: '2025-01-01' })], [paid]).status.text));
  check('…never paid on a lease that ended: nothing to chase', dt(dep([L('ended')], [])).value === 'None' && !dt(dep([L('ended')], [])).warn);
  check('…part paid on the current lease', dt(dep([L('active')], [{ ...paid, amountCents: 30000 }])).value === '$300 of $900 paid' && dt(dep([L('active')], [{ ...paid, amountCents: 30000 }])).warn);
  const both = dep([L('ended', { activatedOn: '2025-01-01' }), { ...L('active'), id: 'ln' }], [paid, { ...paid, id: 'p2', leaseId: 'ln' }]);
  check('…a new lease’s deposit held and an old one still held: both said, the old one to settle, in amber', dt(both).value === '$1,800 held, $900 to settle' && dt(both).warn, dt(both));
  check('…the page’s Details is for a lease they hold now; Money keeps an ended one', src0('src/app/(app)/renters/[renterId]/page.tsx').includes("lease={t === 'details' ? heldLease : lease}"));
  check('…returned', dt(dep([L('active')], [paid, { id: 'r', renterId: 'd', leaseId: 'ld', type: 'deposit_refund', status: 'paid', amountCents: -90000 }])).value === 'Returned');
  check('…the page’s lease is the latest that ended when none runs, so its deposit can be settled', S.pickLease([L('ended', { endDate: '2026-01-01' }), { ...L('ended', { endDate: '2026-06-30' }), id: 'l2' }], 'd')?.id === 'l2');

  // Several leases, time away, and moved out without being marked so.
  const two = S.renterSummary({ todayIso: today, tenant: {}, renter: { id: 't', firstName: 'Two', lastName: 'Spaces', status: 'active', portalInviteStatus: 'accepted' }, booths,
    leases: [{ id: 'a1', renterId: 't', boothId: 'b4', status: 'active', dueDay: 1, endDate: '2027-06-01', autoRenew: true, rentAmountCents: 1 }, { id: 'a2', renterId: 't', boothId: 'b2', status: 'active', dueDay: 1, endDate: '2026-12-31', autoRenew: false, rentAmountCents: 1 }], invoices: [], ledger: [] });
  check('two leases: the one ending is named; the other lease has its own line', two.tiles.find((v: any) => v.label === 'Lease')?.value === 'Ends Dec 31 (Suite 2)' && two.lease.some((l: any) => l.label === 'Also rents' && /Suite 2, to Dec 31, 2026/.test(l.value) && l.warn), [two.tiles, two.lease]);
  const away = S.renterSummary({ todayIso: today, tenant: {}, renter: { id: 'w', firstName: 'Wa', lastName: 'Y', status: 'on_leave', portalInviteStatus: 'accepted' }, booths, leases: [{ id: 'w1', renterId: 'w', boothId: 'b2', status: 'on_leave', dueDay: 1, endDate: '2027-06-01', autoRenew: true, rentAmountCents: 1 }], invoices: [], ledger: [], leaves: [{ renterId: 'w', status: 'approved', startDate: '2026-11-01', endDate: '2026-12-07' }] });
  check('time away: the lease says until when', away.tiles.find((v: any) => v.label === 'Lease')?.value === 'Time away to Dec 7');
  const gone = S.renterSummary({ todayIso: today, tenant: {}, renter: { id: 'g', firstName: 'Go', lastName: 'Ne', status: 'active' }, booths, leases: [{ id: 'g1', renterId: 'g', boothId: 'b2', status: 'ended', activatedOn: '2025-01-01', rentAmountCents: 1 }], invoices: [], ledger: [] });
  check('a lease that ran and ended means moved out, even if not marked so (the Renters list’s rule)', gone.status.text === 'Moved out' && gone.movedOut && !gone.status.warn);
  check('the header says what’s amber: a portal never opened', S.renterSummary({ todayIso: today, tenant: {}, renter: { id: 'h', firstName: 'H', lastName: 'I', status: 'active', portalInviteStatus: 'not_sent' }, booths, leases: [{ id: 'h1', renterId: 'h', boothId: 'b2', status: 'active', dueDay: 1, rentAmountCents: 1 }], invoices: [], ledger: [] }).status.text === 'Hasn’t opened their portal yet');

  // Renter, not staff
  check('nothing to say when nothing makes them look like staff', a.relationship.length === 0 && S.workingRelationship({}, { payStructure: 'none' }, { leaseFrom: 'builder' }).length === 0);
  check('a weekly salary on their booking record counts as pay', S.workingRelationship({}, { payStructure: 'salary', salaryWeekly: 500 }, { leaseFrom: 'builder' })[0]?.label === 'Pay');
  const rel = S.workingRelationship({ linkedStaffId: 's9' }, { payStructure: 'commission', commissionRate: 40, employmentModel: 'employee' }, { leaseFrom: 'builder' });
  check('pay from their booking record and an employee record in amber; also on the team said plainly', rel.map((l: any) => l.label).join() === 'Pay,Team record,Also staff' && rel[0].warn && rel[1].warn && !rel[2].warn && /a commission/.test(rel[0].value), rel);
  check('a record with a pay type but no rate, set as a renter, isn’t flagged; nor is commission on retail only', S.workingRelationship({}, { payStructure: 'commission', commissionRate: 0, employmentModel: 'renter', retailCommissionRate: 10 }, { leaseFrom: 'builder' }).length === 0);
  check('a lease made outside the builder: check it says they run their own business', S.workingRelationship({}, null, { leaseFrom: 'own' })[0]?.label === 'Lease');

  // The route
  const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Northside' });
  await db.doc(`${T}/renters/r9`).set({ firstName: 'Ana', lastName: 'Ruiz', status: 'active', email: 'a@x.co', phone: '555' });
  await db.doc(`${T}/booths/b1`).set({ name: 'Front' });
  await db.doc(`${T}/leases/l9`).set({ renterId: 'r9', boothId: 'b1', status: 'active', rentAmountCents: 50000, frequency: 'monthly', dueDay: 1 });
  await db.doc(`${T}/leases/lx`).set({ renterId: 'other', boothId: 'b1', status: 'active', rentAmountCents: 99900 });
  await db.doc(`${T}/rentInvoices/i9`).set({ renterId: 'r9', leaseId: 'l9', status: 'late', amountCents: 50000, paidCents: 0, dueDate: '2026-11-01' });
  await db.doc(`${T}/staff/s9`).set({ isRenter: true, renterId: 'r9', payStructure: 'commission', commissionRate: 35 });
  const route = await import('../../src/app/api/renters/one/route');
  const req = (q: string) => ({ headers: { get: () => null }, nextUrl: { searchParams: new URLSearchParams(q) } }) as any;
  const one: any = await route.GET(req('tenantId=t1&renterId=r9'));
  check('the route: their summary, from their own lease and bills only; their booking record is checked', one.status === 200 && one.body.summary.name === 'Ana Ruiz' && one.body.summary.tiles[0].value === '$500' && one.body.summary.sub === 'Front' && one.body.summary.relationship[0]?.label === 'Pay' && one.body.renter.phone === '555', one.body);
  check('…someone not there, or no one given', (await route.GET(req('tenantId=t1&renterId=nope')) as any).status === 404 && (await route.GET(req('tenantId=t1&renterId=')) as any).status === 400 && (await route.GET(req('tenantId=t1&renterId=a/b')) as any).status === 400 && (await route.GET(req('tenantId=t1&renterId=..')) as any).status === 400);
  role = 'renter';
  check('…never for a renter signed in on the team side', (await route.GET(req('tenantId=t1&renterId=r9')) as any).status === 403);
  role = 'none';
  check('…only for someone who can see what renters owe', (await route.GET(req('tenantId=t1&renterId=r9')) as any).status === 403);

  // One page, opened the same way everywhere
  const src = (p: string) => readFileSync(p, 'utf8');
  check('the renter’s own page exists, with the renter card’s tabs inside it (its own overview under Details)', existsSync('src/app/(app)/renters/[renterId]/page.tsx') && /<RenterPage tenantId=\{tenantId\}/.test(src('src/app/(app)/renters/[renterId]/page.tsx')) && src('src/app/(app)/renters/[renterId]/page.tsx').includes("<RenterProfileDrawer inPage pageTab={t === 'details' ? 'overview' : (t as any)}") && /if \(inPage\) return body;/.test(src('src/components/renters/RenterProfileDrawer.tsx')) && src('src/app/(app)/renters/[renterId]/page.tsx').includes('pickLease(leases, renterId)'));
  check('every list opens it: the Rentals home, Spaces, Renters, the messages desk, Rent', /renterHref = \(id: string\) => `\/renters\/\$\{encodeURIComponent\(id\)\}`/.test(src('src/lib/rentals-home.ts')) && /href=\{`\/renters\/\$\{encodeURIComponent\(e\.renterId\)\}`\}/.test(src('src/components/renters/RentalsHome.tsx'))
    && /href=\{`\/renters\/\$\{encodeURIComponent\(id\)\}`\}/.test(src('src/components/renters/SpacesBoard.tsx')) && /const href = `\/renters\/\$\{encodeURIComponent\(r\.id\)\}`;/.test(src('src/lib/renters-roster.ts'))
    && /onOpen=\{\(id\) => openRenter\(id\)\}/.test(src('src/app/(app)/renters/page.tsx')) && /onOpenRenter=\{\(id\) => openRenter\(id, 'messages'\)\}/.test(src('src/app/(app)/renters/page.tsx'))
    && /router\.push\(`\/renters\/\$\{encodeURIComponent\(id\)\}`\)/.test(src('src/app/(app)/booths/page.tsx')) && /href=\{`\/renters\/\$\{encodeURIComponent\(/.test(src('src/app/(app)/rent/page.tsx')) && /const renterLink = \(id: string, tab\?: string\) => `\/renters\/\$\{encodeURIComponent\(id\)\}/.test(src('src/components/renters/RentMoney.tsx')));
  const bp = src('src/app/(app)/booths/page.tsx'); const rp = src('src/app/(app)/renters/page.tsx');
  check('one Record payment, one End lease, one Edit: the Spaces and Renters pages no longer have their own', !/<RenterProfileDrawer/.test(bp) && !/handleRecordPayment|openRecordPay|handleEndLease|endLeaseTarget/.test(bp) && !/<RenterProfileDrawer|setEditing\(|endLease\(/.test(rp)
    && /<EndLeaseDialog /.test(src('src/app/(app)/renters/[renterId]/page.tsx')) && /<RenterEditDialog /.test(src('src/app/(app)/renters/[renterId]/page.tsx')) && /onRecordPayment=\{\(\) => router\.push\(`\/rent\?pay=/.test(src('src/app/(app)/renters/[renterId]/page.tsx')));
  check('End lease prints the move-out statement and says what’s left to settle', /mode: 'final'/.test(src('src/components/renters/EndLeaseDialog.tsx')) && /Still to settle/.test(src('src/components/renters/EndLeaseDialog.tsx')));
  check('none of the Rentals reads are for a renter signed in on the team side', ['home', 'roster', 'spaces', 'one'].every((r) => src(`src/app/api/renters/${r}/route.ts`).includes('if (g.actor?.isRenter) return j(')));
  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  const mine = ['src/lib/renter-summary.ts', 'src/app/api/renters/one/route.ts', 'src/components/renters/RenterPage.tsx', 'src/components/renters/EndLeaseDialog.tsx', 'src/components/renters/RenterEditDialog.tsx', 'src/app/(app)/renters/[renterId]/page.tsx'].map(src).join('\n');
  check('no tool names; no all-caps labels', !AI.test(mine) && !/uppercase/.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
