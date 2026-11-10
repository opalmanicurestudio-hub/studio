// Checks the Spaces list (components/renters/SpacesBoard, api/renters/spaces, lib/spaces-board):
// - Each space's status in words by the one rule the Rentals home uses: leased, shared, waiting to sign, rent late,
//   ending without renewing, open, day use or hourly, repair, not rented.
// - Who has it (or guests, or applicants), when the lease ends, the rent (a shared space's leases added up; an open
//   space at its asking rent), what it brought in this year (rent paid on its bills and its guests so far), and how
//   much of the last twelve months it was used (leases and guest days, since it was added; new spaces say New).
// - The detail: lease dates, rent and due day, deposit, signing, repairs, use by month.
// - The filters and their counts; the route reads one location and needs the business's numbers.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/spaces-board.verify.ts
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
  const S = await import('../../src/lib/spaces-board');
  const booths = [
    { id: 'b1', name: 'Suite 1', status: 'occupied', type: 'suite', amenities: ['Sink', 'Wi-Fi'], baseRentCents: 85000, baseRentFrequency: 'monthly', createdAt: '2025-01-01' },
    { id: 'b2', name: 'Suite 2', status: 'occupied', baseRentCents: 90000, baseRentFrequency: 'monthly', createdAt: '2025-01-01' },
    { id: 'b3', name: 'Suite 3', status: 'vacant', dayUseEnabled: true, pricingOptions: [{ frequency: 'daily', amountCents: 16000 }], createdAt: '2025-01-01' },
    { id: 'b4', name: 'Suite 4', status: 'occupied', baseRentCents: 90000, baseRentFrequency: 'monthly', createdAt: '2025-01-01' },
    { id: 'b6', name: 'Suite 6', status: 'vacant', dayUseEnabled: true, pricingOptions: [{ frequency: 'hourly', amountCents: 2500 }], createdAt: '2025-01-01' },
    { id: 'b7', name: 'Suite 7', status: 'vacant', baseRentCents: 85000, baseRentFrequency: 'monthly', createdAt: '2025-01-01' },
    { id: 'b8', name: 'Suite 8', status: 'partial', baseRentCents: 100000, baseRentFrequency: 'monthly', createdAt: '2025-01-01' },
    { id: 'b9', name: 'Suite 9', status: 'occupied', baseRentCents: 85000, baseRentFrequency: 'monthly', createdAt: '2025-01-01' },
    { id: 'b10', name: 'Suite 10', status: 'maintenance', baseRentCents: 85000, baseRentFrequency: 'monthly', createdAt: '2025-01-01' },
    { id: 'b11', name: 'Suite 11', status: 'inactive', createdAt: '2025-01-01' },
    { id: 'b12', name: 'Suite 12', status: 'vacant', baseRentCents: 70000, baseRentFrequency: 'monthly', createdAt: '2026-11-05' },
  ];
  const leases = [
    { id: 'l1', boothId: 'b1', renterId: 'r1', status: 'active', rentAmountCents: 85000, frequency: 'monthly', dueDay: 1, startDate: '2026-01-15', activatedOn: '2026-01-15', endDate: '2027-01-14', autoRenew: true, signedAt: '2026-01-10T00:00:00Z', signedByName: 'Alex Kim', deposit: { amountCents: 85000 } },
    { id: 'l2', boothId: 'b2', renterId: 'r2', status: 'active', rentAmountCents: 90000, frequency: 'monthly', startDate: '2025-03-01', endDate: '2027-03-01', autoRenew: true },
    { id: 'l4', boothId: 'b4', renterId: 'r3', status: 'pending_signature', rentAmountCents: 90000, frequency: 'monthly', startDate: '2026-11-14', endDate: '2027-11-13', autoRenew: true, deposit: { amountCents: 90000 } },
    { id: 'l8a', boothId: 'b8', renterId: 'r4', status: 'active', rentAmountCents: 50000, frequency: 'monthly', startDate: '2025-09-01', endDate: '2027-08-31', isShared: true },
    { id: 'l8b', boothId: 'b8', renterId: 'r5', status: 'active', rentAmountCents: 50000, frequency: 'monthly', startDate: '2025-09-01', endDate: '2027-08-31', isShared: true },
    { id: 'l9', boothId: 'b9', renterId: 'r6', status: 'active', rentAmountCents: 85000, frequency: 'monthly', startDate: '2025-12-31', endDate: '2026-12-31', autoRenew: false },
    { id: 'l7old', boothId: 'b7', renterId: 'r7', status: 'ended', rentAmountCents: 85000, frequency: 'monthly', startDate: '2025-06-01', lastChargeDate: '2026-06-30' },
  ];
  const renters = [['r1', 'Alex', 'Kim'], ['r2', 'Jordan', 'Lee'], ['r3', 'Maya', 'Ortiz'], ['r4', 'Lee', 'Chen'], ['r5', 'Ana', 'Lopez'], ['r6', 'Sam', 'Chen'], ['r7', 'Old', 'Renter']].map(([id, f, l]) => ({ id, firstName: f, lastName: l, status: 'active' }));
  const invoices = [
    { id: 'i1', boothId: 'b1', renterId: 'r1', status: 'paid', amountCents: 85000, lateFeeCents: 0, dueDate: '2026-10-01' },
    { id: 'i1b', boothId: 'b1', renterId: 'r1', status: 'paid', amountCents: 85000, dueDate: '2025-12-01' },
    { id: 'i2', boothId: 'b2', renterId: 'r2', status: 'late', amountCents: 90000, lateFeeCents: 2500, paidCents: 10000, dueDate: '2026-11-01' },
    { id: 'i2v', boothId: 'b2', renterId: 'r2', status: 'void', amountCents: 90000, dueDate: '2026-09-01' },
  ];
  const ledger = [{ id: 'd1', leaseId: 'l1', renterId: 'r1', type: 'deposit_charge', status: 'paid', amountCents: 85000 }];
  const reservations = [
    { id: 'g1', boothId: 'b3', startDate: '2026-10-02', status: 'completed', amountCents: 16000, overageStatus: 'charged', overageDueCents: 2000 },
    { id: 'g2', boothId: 'b3', startDate: '2026-11-03', status: 'confirmed', amountCents: 16000 },
    { id: 'g3', boothId: 'b3', startDate: '2026-11-20', status: 'confirmed', amountCents: 16000 },
    { id: 'g4', boothId: 'b3', startDate: '2026-11-04', status: 'cancelled', amountCents: 16000 },
  ];
  const x = S.spacesBoard({
    todayIso: today, booths, leases, renters, invoices, ledger, reservations,
    applications: [{ id: 'a1', boothId: 'b7', kind: 'application', status: 'new' }, { id: 'a2', boothId: 'b7', kind: 'tour', status: 'new' }],
    documents: [{ id: 'doc', kind: 'lease', leaseId: 'l4', status: 'sent', sentAt: '2026-11-09T00:00:00Z' }],
    tickets: [{ id: 't1', boothId: 'b10', status: 'open' }, { id: 't2', boothId: 'b1', status: 'resolved' }],
  });
  const r = Object.fromEntries(x.rows.map((v: any) => [v.id, v]));
  check('statuses in words', [['b1', 'Leased'], ['b2', 'Rent late'], ['b3', 'Day use'], ['b4', 'Waiting to sign'], ['b6', 'Hourly'], ['b7', 'Open'], ['b8', 'Shared'], ['b9', 'Ends Dec 31'], ['b10', 'Repair'], ['b11', 'Not rented']].every(([id, s]) => r[id].status === s),
    x.rows.map((v: any) => `${v.id}:${v.status}`));
  check('…amber for what needs doing', r.b2.warn && r.b4.warn && r.b9.warn && r.b10.warn && !r.b1.warn && !r.b8.warn && !r.b7.warn);
  check('who has it: a renter, both sharers, guests, or applicants (not tour requests)', r.b1.renter === 'Alex Kim' && r.b8.renter === 'Lee Chen, Ana Lopez' && r.b3.renter === 'Guests' && r.b7.renter === '1 applicant' && r.b10.renter === '');
  check('rent: the lease’s, a shared space’s added up, an open space’s asking rent', r.b1.rent === '$850/mo' && r.b8.rent === '$1,000/mo' && r.b3.rent === '$160/day' && r.b6.rent === '$25/hr' && r.b7.rent === '$850/mo');
  check('lease ends', r.b1.leaseEnds === '2027-01-14' && r.b3.leaseEnds === null);
  check('this year: rent paid on its bills (part of a late one counts, a void one doesn’t, last year’s doesn’t), and guests so far with any extra charged',
    r.b1.thisYearCents === 85000 && r.b2.thisYearCents === 10000 && r.b3.thisYearCents === 16000 + 2000 + 16000, [r.b1.thisYearCents, r.b2.thisYearCents, r.b3.thisYearCents]);
  check('used: lease days in the last twelve months; guest days; an ended lease up to its last day; a new space says New',
    r.b2.usedPct === 100 && r.b1.usedPct === Math.round(((Date.parse('2026-11-10') - Date.parse('2026-01-15')) / 86400000 + 1) / 365 * 100) && r.b3.usedPct === Math.round((2 / 365) * 100) && r.b7.usedPct === Math.round((((Date.parse('2026-06-30') - Date.parse('2025-11-11')) / 86400000 + 1) / 365) * 100) && r.b12.usedPct === null && r.b4.usedPct === 0,
    [r.b1.usedPct, r.b2.usedPct, r.b3.usedPct, r.b7.usedPct, r.b12.usedPct, r.b4.usedPct]);
  check('…by month, twelve of them ending this month', r.b2.detail.usedByMonth.length === 12 && r.b2.detail.usedByMonth[11].month === 'Nov' && r.b2.detail.usedByMonth[11].pct === 100 && r.b7.detail.usedByMonth[11].pct === 0);
  const line = (row: any, label: string) => row.detail.lines.find((l: any) => l.label === label);
  check('detail: lease dates and renewal, rent on its day, deposit held, signed', line(r.b1, 'Lease').value === 'Jan 15, 2026 to Jan 14, 2027, renews' && line(r.b1, 'Rent').value === '$850 on the 1st' && line(r.b1, 'Deposit').value === '$850, held' && line(r.b1, 'Signed').value === 'Jan 10 by Alex Kim' && r.b1.detail.about === 'Suite · Sink, Wi-Fi',
    r.b1.detail.lines);
  check('…waiting to sign: when it was sent, deposit not asked for yet', line(r.b4, 'Signed').value === 'Sent Nov 9, not signed yet' && line(r.b4, 'Signed').warn && line(r.b4, 'Deposit').value === '$900, not paid yet' && !line(r.b4, 'Deposit').warn && r.b4.detail.pendingLeaseId === 'l4');
  check('…an open space: what it asks and who applied; repairs open', line(r.b7, 'Asking').value === '$850/mo' && line(r.b7, 'Applied').value === '1 person' && line(r.b10, 'Repairs').value === '1 open' && line(r.b1, 'Repairs').value === 'None open');
  const c = Object.fromEntries(x.chips.map((v: any) => [v.key, v.count]));
  check('filters and counts: all (the one switched off too, at the bottom of the list), leased, open, day and hourly, repairs', c.all === 11 && c.leased === 5 && c.open === 2 && c.day === 2 && c.repair === 1, c);
  check('…months before a space was added show as not yet, not as empty', r.b12.detail.usedByMonth.slice(0, 11).every((m: any) => m.pct === null) && r.b12.detail.usedByMonth[11].pct === 0);

  // One renter, two spaces, late on one; a lease still running after its end; a stay of several days; a bill paid in
  // two parts; a booking with money still owed on it.
  const y = S.spacesBoard({
    todayIso: today,
    booths: [{ id: 'p', name: 'P', status: 'occupied', createdAt: '2025-01-01' }, { id: 'q', name: 'Q', status: 'occupied', createdAt: '2025-01-01' }, { id: 'e', name: 'E', status: 'occupied', createdAt: '2025-01-01' }, { id: 'g', name: 'G', status: 'vacant', dayUseEnabled: true, pricingOptions: [{ frequency: 'daily', amountCents: 10000 }], createdAt: '2025-01-01' }],
    leases: [{ id: 'lp', boothId: 'p', renterId: 'z', status: 'active', rentAmountCents: 50000, frequency: 'monthly', startDate: '2025-01-01' }, { id: 'lq', boothId: 'q', renterId: 'z', status: 'active', rentAmountCents: 40000, frequency: 'monthly', startDate: '2025-01-01' },
      { id: 'le', boothId: 'e', renterId: 'w', status: 'active', rentAmountCents: 1, frequency: 'monthly', startDate: '2025-01-01', endDate: '2026-11-03', autoRenew: false }],
    renters: [{ id: 'z', firstName: 'Zed', lastName: 'Two' }, { id: 'w', firstName: 'Wil', lastName: 'Over' }],
    invoices: [{ id: 'iz', leaseId: 'lp', renterId: 'z', status: 'late', amountCents: 50000, paidCents: 0, dueDate: '2026-11-01' },
      { id: 'iq', boothId: 'q', leaseId: 'lq', renterId: 'z', status: 'paid', amountCents: 40000, lateFeeCents: 0, paidCents: 30000, paidAmountCents: 10000, dueDate: '2026-10-01' }],
    ledger: [],
    reservations: [{ id: 's1', boothId: 'g', startDate: '2026-11-02', endDate: '2026-11-06', status: 'completed', amountCents: 50000, balanceDueCents: 10000 }],
  });
  const yr = Object.fromEntries(y.rows.map((v: any) => [v.id, v]));
  check('late rent is the space’s, not every space its renter has', yr.p.status === 'Rent late' && yr.q.status === 'Leased', [yr.p.status, yr.q.status]);
  check('a lease still running after its end date says so, in amber', yr.e.status === 'Ended Nov 3' && yr.e.warn);
  check('a stay of several days counts every day it ran; money still owed on it isn’t in yet', yr.g.usedPct === Math.round((5 / 365) * 100) && yr.g.thisYearCents === 40000 && yr.g.detail.usedByMonth[11].pct === Math.round((5 / 10) * 100), [yr.g.usedPct, yr.g.thisYearCents]);
  check('a bill paid in two parts counts in full', yr.q.thisYearCents === 40000, yr.q.thisYearCents);

  check('sorted the way people count: Suite 2 before Suite 10', x.rows.findIndex((v: any) => v.id === 'b2') < x.rows.findIndex((v: any) => v.id === 'b10'));

  // ── The route ──
  const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Northside' });
  await db.doc(`${T}/booths/x1`).set({ name: 'Front', status: 'vacant', locationId: 'L1', baseRentCents: 50000, baseRentFrequency: 'monthly' });
  await db.doc(`${T}/booths/x2`).set({ name: 'Back', status: 'vacant', locationId: 'L2', baseRentCents: 70000, baseRentFrequency: 'monthly' });
  await db.doc(`${T}/renters/p1`).set({ firstName: 'Pat', lastName: 'Ng', status: 'prospective' });
  await db.doc(`${T}/renters/p2`).set({ firstName: 'Kim', lastName: 'Bo', status: 'active' });
  await db.doc(`${T}/leases/k2`).set({ boothId: 'x2', renterId: 'p2', status: 'active', rentAmountCents: 70000, frequency: 'monthly', locationId: 'L2' });
  await db.doc(`${T}/rentInvoices/n2`).set({ boothId: 'x2', leaseId: 'k2', renterId: 'p2', status: 'late', amountCents: 70000, paidCents: 0, dueDate: '2026-11-01' });
  await db.doc(`${T}/boothReservations/v1`).set({ boothId: 'x1', startDate: '2026-11-03', status: 'completed', amountCents: 12000 });
  await db.doc(`${T}/boothReservations/v2`).set({ boothId: 'x2', startDate: '2026-11-03', status: 'completed', amountCents: 99900 });
  const route = await import('../../src/app/api/renters/spaces/route');
  const req = (q: string) => ({ headers: { get: () => null }, nextUrl: { searchParams: new URLSearchParams(q) } }) as any;
  const all: any = await route.GET(req('tenantId=t1'));
  check('the route: every space, and who a new lease can be for', all.status === 200 && all.body.rows.length === 2 && all.body.leaseable.map((v: any) => v.id).join() === 'p1', all.body);
  const one: any = await route.GET(req('tenantId=t1&locationId=L1'));
  check('…one location, with only its own money', one.body.rows.map((v: any) => v.id).join() === 'x1' && one.body.rows[0].thisYearCents === 12000 && one.body.rows[0].status === 'Open', one.body.rows);
  check('…the other location’s late rent stays on its space', all.body.rows.find((v: any) => v.id === 'x2').status === 'Rent late');
  role = 'none';
  check('…only for someone who can see the business’s numbers', (await route.GET(req('tenantId=t1')) as any).status === 403);

  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  const mine = ['src/lib/spaces-board.ts', 'src/app/api/renters/spaces/route.ts', 'src/components/renters/SpacesBoard.tsx'].map((p) => readFileSync(p, 'utf8')).join('\n');
  check('no tool names; no all-caps labels', !AI.test(mine) && !/uppercase/.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
