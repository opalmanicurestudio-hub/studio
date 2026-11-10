// Checks the Rentals home (app/(app)/rentals, components/renters/RentalsHome, api/renters/home, lib/rentals-home):
// - One rule for spaces: a lease holding a space (one being signed counts) makes it taken, a space marked for repair
//   with no lease is being repaired, a switched-off space isn't counted, and a guest checked in doesn't make it taken.
//   The Spaces page's numbers use the same rule.
// - The numbers: occupied, rent roll at a month's rent (leases on time away not counted), this month's rent paid of
//   what's come due, owed with who's late (a deposit isn't rent owed), deposits held, and what open spaces would bring in.
// - Needs you, most pressing first: late rent with Record payment, a lease not signed, papers running out or missing
//   when required, a lease ending that doesn't renew, an unanswered concern, an unread message, a repair nobody has
//   answered, time away asked for, and new applications. Each with a link that opens the right place.
// - Leases ending in the next 90 days, today at the spaces, and who a new lease can be written for.
// - The route reads only the chosen location, and only for someone who can see the business's numbers.
// - Every Rentals page carries the same tabs; the links land (renter, desk tab, Record payment, time away).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/rentals-home.verify.ts
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
  if (is(request, 'route-guard')) return fake(request, { requireCan: async (_r: any, _t: string, cap: string) => (role === 'none' || cap !== 'money.view' ? { deny: { status: 403, body: { ok: false } } } : { actor: { uid: 'u1', name: 'Dana', role } }) });
  return load.call(this, request, ...rest);
};

const today = '2026-11-10';
const nowIso = '2026-11-10T15:00:00.000Z';

(async () => {
  const H = await import('../../src/lib/rentals-home');

  // ── The one rule for spaces ──
  const booths = [
    { id: 'b1', name: 'Suite 1', status: 'vacant', baseRentCents: 100000, baseRentFrequency: 'monthly' },
    { id: 'b2', name: 'Suite 2', status: 'occupied', baseRentCents: 90000, baseRentFrequency: 'monthly' },
    { id: 'b3', name: 'Suite 3', status: 'vacant', baseRentCents: 25000, baseRentFrequency: 'weekly', dayUseEnabled: true },
    { id: 'b4', name: 'Suite 4', status: 'maintenance', baseRentCents: 80000, baseRentFrequency: 'monthly' },
    { id: 'b5', name: 'Suite 5', status: 'inactive', baseRentCents: 70000, baseRentFrequency: 'monthly' },
    { id: 'b6', name: 'Suite 6', status: 'vacant', baseRentCents: 0, pricingOptions: [{ frequency: 'daily', amountCents: 6000 }] },
    { id: 'b7', name: 'Suite 7', status: 'vacant', baseRentCents: 85000, baseRentFrequency: 'monthly' },
  ];
  const leases = [
    { id: 'l1', boothId: 'b1', renterId: 'r1', status: 'active', rentAmountCents: 100000, frequency: 'monthly', endDate: '2026-12-31', autoRenew: false, deposit: { amountCents: 100000 } },
    { id: 'l2', boothId: 'b2', renterId: 'r2', status: 'active', rentAmountCents: 20000, frequency: 'weekly', endDate: '2027-01-14', autoRenew: true },
    { id: 'l7', boothId: 'b7', renterId: 'r3', status: 'pending_signature', rentAmountCents: 85000, frequency: 'monthly', endDate: '2027-11-30' },
    { id: 'l0', boothId: 'b3', renterId: 'r9', status: 'ended', rentAmountCents: 25000, frequency: 'weekly', endDate: '2026-10-01', deposit: { amountCents: 50000 } },
    { id: 'l4', boothId: 'b4', renterId: 'r4', status: 'on_leave', rentAmountCents: 60000, frequency: 'monthly', endDate: '2027-03-01', autoRenew: false, isShared: true },
  ];
  const st = H.spaceStates(booths, leases);
  check('spaces: leased, being signed counts, repair, off, open; a shared lease reads shared', st.get('b1')!.state === 'taken' && st.get('b7')!.state === 'taken' && st.get('b4')!.state === 'shared' && st.get('b5')!.state === 'off' && st.get('b3')!.state === 'open' && st.get('b6')!.state === 'open',
    [...st.entries()].map(([k, v]) => `${k}:${v.state}`));
  const occ = H.occupancy(booths, leases);
  check('occupancy counts every space not switched off, taken by leases only', occ.total === 6 && occ.occupied === 4 && occ.open === 2 && occ.repair === 0 && occ.openDayUse === 1 && occ.pct === 67, occ);
  check('open spaces at their asking rent a month: weekly rent and a day rate over a five-day week', occ.openMonthlyCents === Math.round(25000 * 52 / 12) + Math.round(6000 * 5 * 52 / 12), occ.openMonthlyCents);
  check('a space marked for repair with no lease is being repaired, not open', H.occupancy([{ id: 'x', status: 'maintenance' }], []).repair === 1 && H.occupancy([{ id: 'x', status: 'maintenance' }], []).open === 0);
  check('lease ending: inside the window, running, renews or not', H.leaseEnding(leases[0], today)!.days === 51 && H.leaseEnding(leases[0], today)!.renews === false && H.leaseEnding(leases[1], today) === null
    && H.leaseEnding(leases[1], today, 90)!.renews === true && H.leaseEnding(leases[2], today, 900) === null && H.leaseEnding({ status: 'active', endDate: '2026-11-09' }, today) === null);

  // ── The whole home ──
  const renters = [
    { id: 'r1', firstName: 'Jordan', lastName: 'Lee', status: 'active', insuranceExpiry: '2026-11-16', insuranceDocUrl: 'x' },
    { id: 'r2', firstName: 'Alex', lastName: 'Kim', status: 'active', licenseExpiry: '2027-08-01', insuranceExpiry: '2027-05-01' },
    { id: 'r3', firstName: 'Maya', lastName: 'Ortiz', status: 'prospective' },
    { id: 'r4', firstName: 'Rosa', lastName: 'Diaz', status: 'on_leave' },
    { id: 'r5', firstName: 'Dev', lastName: 'Rao', status: 'prospective' },
    { id: 'r9', firstName: 'Sam', lastName: 'Chen', status: 'past' },
    { id: 'r8', firstName: 'Old', lastName: 'Record', status: 'archived' },
  ];
  const invoices = [
    { id: 'i1', renterId: 'r1', leaseId: 'l1', status: 'late', amountCents: 100000, lateFeeCents: 2500, paidCents: 0, dueDate: '2026-11-01' },
    { id: 'i2', renterId: 'r2', leaseId: 'l2', status: 'paid', amountCents: 20000, paidAt: '2026-11-03', dueDate: '2026-11-03' },
    { id: 'i3', renterId: 'r2', leaseId: 'l2', status: 'due', amountCents: 20000, paidCents: 0, dueDate: '2026-11-10' },
    { id: 'i4', renterId: 'r2', leaseId: 'l2', status: 'void', amountCents: 99999, dueDate: '2026-11-05' },
    { id: 'i5', renterId: 'r2', leaseId: 'l2', status: 'waived', amountCents: 88888, dueDate: '2026-11-06' },
  ];
  const ledger = [
    { id: 'p1', renterId: 'r2', type: 'payment', status: 'paid', amountCents: -20000, paidAt: '2026-11-03T10:00:00Z' },
    { id: 'p0', renterId: 'r2', type: 'payment', status: 'paid', amountCents: -20000, paidAt: '2026-10-27T10:00:00Z' },
    { id: 'd1', renterId: 'r1', leaseId: 'l1', type: 'deposit_charge', status: 'paid', amountCents: 100000 },
    { id: 'd0', renterId: 'r9', leaseId: 'l0', type: 'deposit_charge', status: 'paid', amountCents: 50000 },
    { id: 'd0r', renterId: 'r9', leaseId: 'l0', type: 'deposit_refund', status: 'paid', amountCents: -20000 },
    { id: 'd7', renterId: 'r3', leaseId: 'l7', type: 'deposit_charge', status: 'pending', amountCents: 85000 },
    { id: 'c1', renterId: 'r2', leaseId: 'l2', type: 'one_off_charge', status: 'pending', amountCents: 3000, dueDate: '2026-11-20' },
  ];
  const tenant = { name: 'Northside', bookingPageSettings: { automationRules: { requireInsurance: true, requireLicense: true } } };
  const x = H.rentalsHome({
    todayIso: today, nowIso, tenant, booths, leases, renters, invoices, ledger,
    documents: [{ id: 'doc1', kind: 'lease', leaseId: 'l7', status: 'sent', sentAt: '2026-11-04T10:00:00Z' }],
    grievances: [{ id: 'g1', ref: 'C-2611-K7PQ', category: 'noise', status: 'open', renterId: 'r2', renterName: 'Alex Kim', filedAt: '2026-11-09T18:00:00Z' }, { id: 'g2', status: 'acknowledged', category: 'space' }],
    threads: [{ id: 'r4', renterId: 'r4', unreadForOwner: true }],
    tickets: [
      { id: 't1', status: 'open', priority: 'high', boothId: 'b2', title: 'Sink', updates: [{ byType: 'renter' }], respondBy: '2026-11-10T17:00:00Z', dueAt: '2026-11-11T15:00:00Z' },
      { id: 't2', status: 'in_progress', priority: 'normal', title: 'Light', assigneeId: 'w1', updates: [], dueAt: '2026-11-20T00:00:00Z' },
      { id: 't3', status: 'resolved', priority: 'urgent', title: 'Door', updates: [] },
    ],
    leaves: [{ id: 'lv1', renterId: 'r4', status: 'approved', startDate: '2026-11-01', endDate: '2026-11-30' }, { id: 'lv2', renterId: 'r2', status: 'requested', startDate: '2026-12-01', endDate: '2026-12-14' }],
    applications: [{ id: 'a1', kind: 'application', status: 'new', name: 'Dev Rao', boothName: 'Suite 3', createdAt: '2026-11-08T00:00:00Z' }, { id: 'a2', kind: 'waitlist', status: 'new', name: 'Wait' }, { id: 'a3', kind: 'application', status: 'declined', name: 'No' }],
    reservations: [{ id: 'g0', boothId: 'b3', startDate: '2026-11-09', endDate: '2026-11-11', status: 'checked_in' }, { id: 'g5', boothId: 'b3', startDate: '2026-11-07', endDate: '2026-11-09', status: 'completed' }, { id: 'g2', boothId: 'b6', startDate: today, status: 'confirmed' }, { id: 'g3', boothId: 'b6', startDate: today, status: 'cancelled' }, { id: 'g4', boothId: 'b6', startDate: '2026-11-11', status: 'confirmed' }],
    interruptions: [{ id: 'c1', status: 'open', startDate: '2026-11-09', endDate: null, title: 'Power out' }, { id: 'c2', status: 'resolved', startDate: '2026-11-01', title: 'Old' }],
  });
  const k = Object.fromEntries(x.kpis.map((v: any) => [v.key, v]));
  check('occupied: 4 of 6, with open and day bookings', k.occupied.value === '4 of 6' && /67% · 2 open, 1 taking day bookings/.test(k.occupied.sub), k.occupied);
  check('rent roll: billed leases at a month (being signed isn’t rent yet; time away is said, not counted)', k.roll.value === H.money(100000 + Math.round(20000 * 52 / 12)) && k.roll.sub === 'a month, from 2 leases, not counting 1 on time away', k.roll);
  check('November rent paid: of this month’s bills due so far (not voided or waived, not later this month); a payment on an older bill isn’t this month’s rent', k.collected.label === 'November rent paid' && k.collected.value === '$200' && k.collected.sub === `of ${H.money(102500 + 20000 + 20000)} due so far`, k.collected);
  check('owed: open bills and one-off charges, and who is late; a deposit waiting to be paid isn’t rent owed', k.owed.value === H.money(102500 + 20000 + 3000) && k.owed.warn === true && k.owed.sub === '1 renter late', k.owed);
  check('deposits held: collected less returned, across leases (an ended lease still holding counts)', k.deposits.value === H.money(100000 + 30000) && /across 2 leases/.test(k.deposits.sub), k.deposits);
  check('open spaces: a month not coming in', k.open.value === H.money(occ.openMonthlyCents) && k.open.sub === 'a month not coming in');

  const ids = x.needs.map((n: any) => n.id);
  const by = (id: string) => x.needs.find((n: any) => n.id === id);
  check('late rent: days late, owed with late fees, Message and Record payment', by('late-r1')?.title === 'Jordan Lee · rent 9 days late' && /\$1,025 owed, including late fees · Suite 1/.test(by('late-r1')!.detail)
    && by('late-r1')!.actions.map((a: any) => `${a.label}>${a.href}`).join() === 'Message>/renters/r1?tab=messages,Record payment>/rent?pay=r1' && by('late-r1')!.actions[1].primary === true, by('late-r1'));
  check('a lease not signed yet, sent days ago', by('sign-l7')?.title === 'Maya Ortiz hasn’t signed their lease' && by('sign-l7')!.detail === 'Sent Nov 4 · Suite 7');
  check('papers: insurance running out for a leased renter; license missing when required; a prospect isn’t asked', by('papers-r1-insurance')?.title === 'Jordan Lee · liability insurance expires in 6 days' && !!by('papers-r1-license') && /lease settings ask for it/.test(by('papers-r1-license')!.detail)
    && !ids.some((i: string) => i.startsWith('papers-r3') || i.startsWith('papers-r5') || i.startsWith('papers-r2')), ids);
  check('a lease ending that doesn’t renew; one that renews isn’t a to-do', by('ending-l1')?.title === 'Jordan Lee · lease ends Dec 31' && /Doesn’t renew on its own · in 51 days/.test(by('ending-l1')!.detail) && !by('ending-l2'));
  check('an unanswered concern, with Reply to the concerns desk; an answered one isn’t listed', by('concern-g1')?.title === 'Concern C-2611-K7PQ · Noise or disruption' && /raised yesterday/.test(by('concern-g1')!.detail) && by('concern-g1')!.actions[0].href === '/renters?desk=concerns' && !by('concern-g2'), by('concern-g1'));
  check('an unread message', by('message-r4')?.title === 'Rosa Diaz wrote to you' && by('message-r4')!.actions[0].href === '/renters/r4?tab=messages');
  check('a repair nobody has answered, with how long is left; one being worked on in time isn’t listed', by('repair-t1')?.title === 'Repair · Suite 2 · Sink' && by('repair-t1')!.detail === 'High · answer due in 2 hours' && !by('repair-t2') && !by('repair-t3'), by('repair-t1'));
  check('time away asked for, to review on the Rent page', by('away-lv2')?.title === 'Alex Kim asked for time away' && by('away-lv2')!.detail === 'Dec 1 to Dec 14' && by('away-lv2')!.actions[0].href === '/rent#time-away');
  check('a new application, to review in the pipeline; waitlist and decided ones aren’t', by('app-a1')?.title === 'Dev Rao applied for Suite 3' && by('app-a1')!.actions[0].href === '/pipeline?lead=a1' && !by('app-a2') && !by('app-a3'));
  check('most pressing first: late rent and concerns before a new application', ids.indexOf('late-r1') < ids.indexOf('app-a1') && ids.indexOf('concern-g1') < ids.indexOf('ending-l1') && ids.indexOf('repair-t1') < ids.indexOf('papers-r1-insurance'), ids);

  check('leases ending in 90 days, soonest first, ends or renews', x.ending.map((e: any) => `${e.renter}|${e.space}|${e.endDate}|${e.renews}`).join(';') === 'Jordan Lee|Suite 1|2026-12-31|false;Alex Kim|Suite 2|2027-01-14|true', x.ending);
  const t = Object.fromEntries(x.today.map((r: any) => [r.label, r.value]));
  check('today: guests here today (a stay from yesterday still counts, one that ended doesn’t; one checked in), open repairs, closures, renters away', t['Day and hourly guests'] === '2, 1 checked in' && t['Open repairs'] === '2' && t['Closures'] === 'Power out' && t['Renters on time away'] === '1', t);
  check('a new lease can be written for anyone not holding a space, prospects first, never archived', x.leaseable.map((r: any) => r.id).join() === 'r5,r9', x.leaseable);
  const elsewhere = H.rentalsHome({ todayIso: today, nowIso, tenant, booths: [], leases: [], renters: [renters[4]], invoices: [], ledger: [], allLeases: [{ id: 'z', renterId: 'r5', boothId: 'other', status: 'active' }] });
  check('…not someone holding a space at another location', elsewhere.leaseable.length === 0);
  const past = H.rentalsHome({ todayIso: today, nowIso, tenant: {}, booths, leases: [{ id: 'lp', boothId: 'b1', renterId: 'r1', status: 'active', endDate: '2026-11-03', autoRenew: true, rentAmountCents: 1 }], renters, invoices: [], ledger: [] });
  check('a lease still running after its end date needs you', past.needs.some((n: any) => n.id === 'pastend-lp' && n.title === 'Jordan Lee · lease ended Nov 3' && /renew it or end it/.test(n.detail)) && H.leasePastEnd({ status: 'ended', endDate: '2026-11-03' }, today) === null);
  const lateFix = H.rentalsHome({ todayIso: today, nowIso, tenant: {}, timeZone: 'America/Los_Angeles', booths, leases: [], renters, invoices: [], ledger: [], tickets: [{ id: 'tz', status: 'open', priority: 'normal', title: 'Mirror', updates: [], dueAt: '2026-11-08T03:00:00Z' }] });
  check('a repair nobody answered and past its fix date says both, on the business’s own day', lateFix.needs.find((n: any) => n.id === 'repair-tz')?.detail === 'Normal · not answered yet · fix was due Nov 7', lateFix.needs);
  const ghost = H.rentalsHome({ todayIso: today, nowIso, tenant: {}, booths: [], leases: [], renters: [], invoices: [], ledger: [], threads: [{ id: 'gone', unreadForOwner: true }] });
  check('a message from someone no longer on the books isn’t listed', ghost.needs.length === 0);
  const empty = H.rentalsHome({ todayIso: today, nowIso, tenant: {}, booths: [], leases: [], renters: [], invoices: [], ledger: [] });
  check('nothing yet: plain words, no errors', empty.needs.length === 0 && empty.kpis.find((v: any) => v.key === 'occupied')!.sub === 'No spaces yet' && empty.kpis.find((v: any) => v.key === 'owed')!.sub === 'Everyone is paid up' && empty.kpis.find((v: any) => v.key === 'open')!.sub === 'No spaces yet' && empty.today.every((r: any) => r.value === 'None'));

  // ── The route ──
  const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Northside', timeZone: 'America/New_York' });
  for (const b of [{ id: 'b1', name: 'Front', status: 'vacant', locationId: 'L1', baseRentCents: 50000, baseRentFrequency: 'monthly' }, { id: 'b2', name: 'Back', status: 'vacant', locationId: 'L2', baseRentCents: 70000, baseRentFrequency: 'monthly' },
    { id: 'b3', name: 'Side', status: 'vacant', locationId: 'L1', baseRentCents: 40000, baseRentFrequency: 'monthly' }]) await db.doc(`${T}/booths/${b.id}`).set(b);
  // A renter whose own record says L2 but who leases at L1: they count at L1, with what they owe.
  await db.doc(`${T}/renters/r2`).set({ firstName: 'Bo', lastName: 'Park', status: 'active', locationId: 'L2' });
  await db.doc(`${T}/leases/l2`).set({ boothId: 'b3', renterId: 'r2', status: 'active', rentAmountCents: 40000, frequency: 'monthly', locationId: 'L1' });
  await db.doc(`${T}/rentInvoices/i2`).set({ renterId: 'r2', leaseId: 'l2', status: 'late', amountCents: 40000, paidCents: 0, lateFeeCents: 0, dueDate: '2026-11-01' });
  // A charge on L2's lease with no renter on it doesn't count at L1.
  await db.doc(`${T}/rentLedger/x1`).set({ leaseId: 'l1', renterId: null, type: 'one_off_charge', status: 'pending', amountCents: 9900 });
  await db.doc(`${T}/renters/r1`).set({ firstName: 'Ana', lastName: 'Ruiz', status: 'active', locationId: 'L2' });
  await db.doc(`${T}/leases/l1`).set({ boothId: 'b2', renterId: 'r1', status: 'active', rentAmountCents: 70000, frequency: 'monthly', locationId: 'L2' });
  await db.doc(`${T}/rentInvoices/i1`).set({ renterId: 'r1', leaseId: 'l1', status: 'late', amountCents: 70000, paidCents: 0, lateFeeCents: 0, dueDate: '2026-11-01' });
  await db.doc(`${T}/renterGrievances/g1`).set({ ref: 'C-1', category: 'noise', status: 'open', renterId: 'r1', filedAt: '2026-11-09T00:00:00Z' });
  const route = await import('../../src/app/api/renters/home/route');
  const req = (q: string) => ({ headers: { get: () => null }, nextUrl: { searchParams: new URLSearchParams(q) } }) as any;
  const all: any = await route.GET(req('tenantId=t1'));
  check('the route: every location, the business name', all.status === 200 && all.body.businessName === 'Northside' && all.body.kpis.find((v: any) => v.key === 'occupied').value === '2 of 3' && all.body.kpis.find((v: any) => v.key === 'owed').value === '$1,199' && all.body.needs.some((n: any) => n.id === 'late-r1') && all.body.needs.some((n: any) => n.id === 'concern-g1'), all.body);
  const l1: any = await route.GET(req('tenantId=t1&locationId=L1'));
  check('…one location: only its spaces, the renters on its leases and what they owe', l1.body.kpis.find((v: any) => v.key === 'occupied').value === '1 of 2' && !l1.body.needs.some((n: any) => n.id === 'late-r1' || n.id === 'concern-g1') && l1.body.needs.some((n: any) => n.id === 'late-r2') && l1.body.kpis.find((v: any) => v.key === 'owed').value === '$400', [l1.body.kpis, l1.body.needs.map((n: any) => n.id)]);
  const l2: any = await route.GET(req('tenantId=t1&locationId=L2'));
  check('…and the other location keeps its own, including a charge with no renter on it', l2.body.kpis.find((v: any) => v.key === 'owed').value === '$799' && !l2.body.needs.some((n: any) => n.id === 'late-r2'), l2.body.kpis);
  role = 'none';
  check('…only for someone who can see the business’s numbers', (await route.GET(req('tenantId=t1')) as any).status === 403);

  // ── The pages ──
  const src = (p: string) => readFileSync(p, 'utf8');
  check('the Home page exists', existsSync('src/app/(app)/rentals/page.tsx') && /<RentalsHome tenantId=\{tenantId\}/.test(src('src/app/(app)/rentals/page.tsx')));
  const pages: [string, string][] = [['src/app/(app)/booths/page.tsx', '/booths'], ['src/app/(app)/renters/page.tsx', '/renters'], ['src/app/(app)/rent/page.tsx', '/rent'], ['src/app/(app)/pipeline/page.tsx', '/pipeline'], ['src/app/(app)/rental-policies/page.tsx', '/rental-policies'], ['src/components/renters/RentalsHome.tsx', '/rentals']];
  const tabbed = (p: string, h: string) => new RegExp(`<Rentals(Nav|Header)[^>]*current="${h.replace(/\//g, '\\/')}"`).test(src(p));
  check('every Rentals page has the same header and tabs, marked where you are', pages.every(([p, h]) => tabbed(p, h)) && /export function RentalsHeader[\s\S]*<RentalsNav current=\{current\} \/>/.test(src('src/components/renters/RentalsNav.tsx')), pages.filter(([p, h]) => !tabbed(p, h)));
  check('…and no page says it’s for one trade in its heading', !/>\s*Booth rental\s*</.test(src('src/app/(app)/renters/page.tsx') + src('src/app/(app)/rent/page.tsx') + src('src/app/(app)/pipeline/page.tsx')) && /AppHeader title="Spaces"/.test(src('src/app/(app)/booths/page.tsx')));
  const sb = src('src/components/shared/AppSidebar.tsx');
  check('a door in the sidebar under Rentals; part of the rental module; a known app route', /\{ href: '\/rentals',\s+icon: HomeIcon,\s+label: 'Rentals home' \}/.test(sb) && /<NavSection label="Rentals" items=\{BOOTH_RENTAL\}/.test(sb)
    && /pages: \['\/rentals', '\/booths'/.test(src('src/lib/modules.ts')) && /'rentals'/.test(src('src/lib/app-theme.ts')));
  const rent = src('src/app/(app)/rent/page.tsx');
  check('the Rent page’s link hooks come before its early return (hooks always run in the same order)', rent.indexOf('const payLinked = useRef(false);') > 0 && rent.indexOf('const payLinked = useRef(false);') < rent.indexOf('  if (!tenantId) {\n    return (') && rent.indexOf('const openPaymentDialog') < rent.indexOf('  if (!tenantId) {\n    return ('));
  const svc = src('src/lib/booth-rental-service.ts');
  check('lease statuses match the ones the rest of the app uses', /OCCUPYING_LEASE_STATUSES: Lease\['status'\]\[\] = \[\s*'active',\s*'on_leave',\s*'pending_signature',\s*\]/.test(svc) && H.OCCUPYING.join() === 'active,on_leave,pending_signature'
    && /BILLABLE_LEASE_STATUSES: Lease\['status'\]\[\] = \['active'\]/.test(svc) && H.BILLING.join() === 'active');
  check('links land: a renter opens, the desk opens on its tab, Record payment opens, time away is found',
    /q\.get\('renter'\)/.test(src('src/app/(app)/renters/page.tsx')) && /initialTab=\{deskTab\}/.test(src('src/app/(app)/renters/page.tsx')) && /useEffect\(\(\) => \{ if \(initialTab\) setTab\(initialTab\); \}, \[initialTab\]\);/.test(src('src/components/renters/RenterCommsDesk.tsx'))
    && /get\('pay'\)/.test(src('src/app/(app)/rent/page.tsx')) && /<Card id="time-away"/.test(src('src/app/(app)/rent/page.tsx')));
  check('the Spaces page counts by the same rule', /occupancy\(all, ls\)/.test(src('src/app/(app)/booths/page.tsx')) && /leaseEnding\(l, todayLocal\)/.test(src('src/app/(app)/booths/page.tsx')) && /leaseEnding\(l, today\)/.test(src('src/app/(app)/booths/page.tsx')) && !/LEASE_ALERT_WINDOW_DAYS/.test(src('src/app/(app)/booths/page.tsx')));

  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  const mine = ['src/lib/rentals-home.ts', 'src/app/api/renters/home/route.ts', 'src/components/renters/RentalsHome.tsx', 'src/components/renters/RentalsNav.tsx', 'src/app/(app)/rentals/page.tsx'].map(src).join('\n');
  check('no tool names; no all-caps labels; no emojis', !AI.test(mine) && !/uppercase/.test(mine) && !/[\u{1F300}-\u{1FAFF}\u2705\u2714]/u.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
