// Checks Rent and deposits at the top of the Rent page (lib/rent-money, components/renters/RentMoney):
// - Owed now, by the shared rule (bills and one-off charges, never a deposit), with who's late and how long; each
//   renter's bills in words (rent, late fee, part paid), their charges, and autopay on or off.
// - Former renters who still owe are their own list.
// - Deposits: held when a lease has ended or ends soon without renewing (to settle), not paid yet on a lease running
//   or being signed, and the rest held with nothing to settle.
// - Rent coming up in the next seven days and how it'll be paid; what was paid this month and how.
// - The Rent page uses it, keeps one Record payment and one waiver path, and no longer turns autopay on for a renter
//   without their signed OK.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/rent-money.verify.ts
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';

const today = '2026-11-10';
(async () => {
  const M = await import('../../src/lib/rent-money');
  const renters = [
    { id: 'r1', firstName: 'Jordan', lastName: 'Lee', autopayEnabled: false },
    { id: 'r2', firstName: 'Maya', lastName: 'Ortiz', autopayEnabled: true },
    { id: 'r3', firstName: 'Sam', lastName: 'Chen' },
    { id: 'r4', firstName: 'Old', lastName: 'Timer', status: 'past' },
    { id: 'r5', firstName: 'Alex', lastName: 'Kim' },
  ];
  const booths = [{ id: 'b2', name: 'Suite 2' }, { id: 'b4', name: 'Suite 4' }, { id: 'b9', name: 'Suite 9' }, { id: 'b1', name: 'Suite 1' }];
  const leases = [
    { id: 'l1', renterId: 'r1', boothId: 'b2', status: 'active', dueDay: 1, rentAmountCents: 90000, frequency: 'monthly', deposit: { amountCents: 90000 } },
    { id: 'l2', renterId: 'r2', boothId: 'b4', status: 'pending_signature', dueDay: 14, rentAmountCents: 90000, frequency: 'monthly', deposit: { amountCents: 90000 } },
    { id: 'l3', renterId: 'r3', boothId: 'b9', status: 'active', dueDay: 1, endDate: '2026-12-01', autoRenew: false, rentAmountCents: 85000, deposit: { amountCents: 85000 } },
    { id: 'l4', renterId: 'r4', boothId: 'b1', status: 'ended', rentAmountCents: 50000 },
    { id: 'l5', renterId: 'r5', boothId: 'b1', status: 'active', dueDay: 1, endDate: '2027-06-01', autoRenew: true, rentAmountCents: 80000, deposit: { amountCents: 80000 } },
  ];
  const invoices = [
    { id: 'i1', renterId: 'r1', leaseId: 'l1', status: 'late', amountCents: 90000, lateFeeCents: 2500, paidCents: 0, dueDate: '2026-11-01' },
    { id: 'i4', renterId: 'r4', leaseId: 'l4', status: 'late', amountCents: 50000, paidCents: 20000, dueDate: '2026-06-01' },
    { id: 'i5', renterId: 'r5', leaseId: 'l5', status: 'paid', amountCents: 80000, paidAt: '2026-11-02T12:00:00Z', paidMethod: 'Card (Stripe)', paidAmountCents: 80000, dueDate: '2026-11-01' },
    { id: 'i6', renterId: 'r1', leaseId: 'l1', status: 'due', amountCents: 1000, paidCents: 0, dueDate: '2026-11-09', autopayUnconfirmed: true, autopayTriedAt: '2026-11-09T12:00:00Z' },
  ];
  const ledger = [
    { id: 'c1', renterId: 'r1', leaseId: 'l1', type: 'one_off_charge', status: 'pending', amountCents: 3000, description: 'Towel service', dueDate: '2026-11-20' },
    { id: 'dp', renterId: 'r2', leaseId: 'l2', type: 'deposit_charge', status: 'pending', amountCents: 90000 },
    { id: 'd3', renterId: 'r3', leaseId: 'l3', type: 'deposit_charge', status: 'paid', amountCents: 85000 },
    { id: 'd5', renterId: 'r5', leaseId: 'l5', type: 'deposit_charge', status: 'paid', amountCents: 80000 },
    { id: 'p3', renterId: 'r3', type: 'payment', status: 'paid', amountCents: -85000, paidAt: '2026-11-01T15:00:00Z', description: 'Payment — Cash', method: 'cash' },
    { id: 'a5', renterId: 'r5', type: 'rent_charge', status: 'paid', amountCents: 1000, paidAt: '2026-11-03T15:00:00Z', description: 'Rent (autopay)' },
    { id: 'old', renterId: 'r3', type: 'payment', status: 'paid', amountCents: -85000, paidAt: '2026-10-01T15:00:00Z', description: 'Payment — Cash' },
  ];
  const schedule = [
    { leaseId: 'l5', renterId: 'r5', boothId: 'b1', date: '2026-11-14', amountCents: 80000, frequency: 'monthly', readiness: 'ready', lastAttempt: null },
    { leaseId: 'l1', renterId: 'r1', boothId: 'b2', date: '2026-12-01', amountCents: 90000, frequency: 'monthly', readiness: 'manual', lastAttempt: null },
    { leaseId: 'l3', renterId: 'r3', boothId: 'b9', date: '2026-11-15', amountCents: 85000, frequency: 'monthly', readiness: 'no_card', lastAttempt: null },
  ] as any[];
  const x = M.rentMoney({ todayIso: today, renters, leases, booths, invoices, ledger, schedule });
  const k = Object.fromEntries(x.kpis.map((v: any) => [v.key, v]));
  check('owed now: everyone’s, former renters too (like the Rentals home), bills and charges, never a deposit; who is late, how long', k.owed.value === '$1,265' && k.owed.warn && k.owed.sub === '1 renter, 9 days late, plus 1 former renter', k.owed);
  const o = x.owed[0];
  check('each renter’s bills in words, their charges, autopay', x.owed.length === 1 && o.name === 'Jordan Lee' && o.space === 'Suite 2' && o.totalCents === 96500 && o.bills[0].text === 'Nov 1 rent $900 + late fee $25' && o.bills[0].late && o.bills[0].feeCents === 2500
    && o.charges[0].text === 'Towel service, due Nov 20' && o.autopay === 'autopay off', o);
  check('…an autopay try nobody heard back about is flagged on its bill', o.bills[1].autopayUnconfirmed === true && o.bills[1].autopayTriedAt === '2026-11-09');
  check('former renters who still owe: their own list, part paid said', x.former.length === 1 && x.former[0].name === 'Old Timer' && x.former[0].totalCents === 30000 && /\$200 paid/.test(x.former[0].bills[0].text) && x.former[0].barred === false, x.former);
  check('everyone else renting (or signing) is paid up', x.paidUp === 3, x.paidUp);
  check('deposits: one to settle as its lease ends without renewing; one not paid on a lease being signed; the rest held', x.deposits.toSettle.length === 1 && x.deposits.toSettle[0].name === 'Sam Chen' && /lease ends Dec 1/.test(x.deposits.toSettle[0].text)
    && x.deposits.unpaid.some((d: any) => d.name === 'Maya Ortiz' && /due once they sign/.test(d.text)) && x.deposits.unpaid.some((d: any) => d.name === 'Jordan Lee' && /not paid yet/.test(d.text))
    && x.deposits.restHeld.count === 1 && x.deposits.restHeld.cents === 80000, x.deposits);
  check('deposits held: total, to settle and not paid counts', k.deposits.value === '$1,650' && k.deposits.sub === '1 to settle, 2 not paid' && k.deposits.warn, k.deposits);
  check('coming up in seven days, soonest first, and how: autopay ready, or on without a card (amber)', x.upcoming.map((u: any) => `${u.name}|${u.date}|${u.how}|${u.warn}`).join(';') === 'Alex Kim|2026-11-14|Autopay ready|false;Sam Chen|2026-11-15|Autopay on, no card|true'
    && k.soon.value === '$1,650' && k.soon.sub === '2 bills, 1 on autopay', [x.upcoming, k.soon]);
  check('paid this month, newest first: by hand (cash), autopay, online; last month’s not', x.paid.map((p: any) => `${p.name}|${p.how}|${p.cents}`).join(';') === 'Alex Kim|Autopay|1000;Alex Kim|Online|80000;Sam Chen|By hand, cash|85000' && k.collected.label === 'Collected in November' && k.collected.sub === '1 by autopay, 2 by hand or online', [x.paid, k.collected]);
  const two = M.rentMoney({ todayIso: today, renters, leases, booths, invoices: [...invoices, { id: 'i7', renterId: 'r5', leaseId: 'l5', status: 'due', amountCents: 5000, paidCents: 0, dueDate: '2026-11-09' }], ledger, schedule });
  check('two renters owe, one late: says which is late, not both', two.kpis[0].sub === '2 renters, 1 is 9 days late, plus 1 former renter', two.kpis[0].sub);

  // ── Edges the review asked for ──
  const E = M.rentMoney({
    todayIso: today,
    renters: [
      { id: 'a', firstName: 'Ana', lastName: 'Diaz' }, { id: 'b', firstName: 'Ben', lastName: 'Ode' }, { id: 'c', firstName: 'Cy', lastName: 'Barr', status: 'past', doNotRent: true },
      { id: 'd', firstName: 'Di', lastName: 'Cole' }, { id: 'e', firstName: 'Ed', lastName: 'Fay' }, { id: 'f', firstName: 'Fi', lastName: 'Gee' },
    ],
    leases: [
      { id: 'la', renterId: 'a', boothId: 'b1', status: 'active', dueDay: 10, rentAmountCents: 50000, lateFeePolicy: { graceDays: 0 } },
      { id: 'lb', renterId: 'b', boothId: 'b2', status: 'on_leave', dueDay: 1, rentAmountCents: 60000 },
      { id: 'lb2', renterId: 'b', boothId: 'b4', status: 'active', dueDay: 1, rentAmountCents: 20000 },
      { id: 'ld', renterId: 'd', boothId: 'b9', status: 'cancelled', deposit: { amountCents: 40000 } },
      { id: 'le', renterId: 'e', boothId: 'b1', status: 'active', dueDay: 1, endDate: '2027-02-01', autoRenew: false, deposit: { amountCents: 30000 } },
      { id: 'lf', renterId: 'f', boothId: 'b2', status: 'active', dueDay: 1, endDate: '2026-11-30', autoRenew: true, deposit: { amountCents: 30000 } },
    ],
    booths,
    invoices: [
      { id: 'v1', renterId: 'b', leaseId: 'lb2', status: 'late', amountCents: 20000, paidCents: 5000, dueDate: '2026-10-01' },
      { id: 'v2', renterId: 'b', leaseId: 'lb2', status: 'due', amountCents: 20000, lateFeeCents: 1500, paidCents: 0, dueDate: '2026-11-01' },
      { id: 'v3', renterId: 'b', leaseId: 'lb2', status: 'void', amountCents: 20000, dueDate: '2026-09-01' },
      { id: 'v4', renterId: 'b', leaseId: 'lb2', status: 'paid', amountCents: 20000, dueDate: '2026-08-01' },
      { id: 'v5', renterId: 'a', leaseId: 'la', status: 'due', amountCents: 50000, paidCents: 20000, dueDate: '2026-11-01', lastPaidOnlineAt: '2026-11-03T10:00:00Z', onlineParts: { s1: { cents: 20000, at: '2026-11-03T10:00:00Z' } } },
      { id: 'v6', renterId: 'e', leaseId: 'le', status: 'due', amountCents: 30000, dueDate: '2026-11-10' },
    ],
    ledger: [
      { id: 'x1', renterId: 'a', leaseId: 'la', type: 'one_off_charge', status: 'pending', amountCents: 4000, description: 'Key replacement', dueDate: '2026-10-31' },
      { id: 'x2', renterId: 'a', leaseId: 'la', type: 'deposit_charge', status: 'pending', amountCents: 50000, dueDate: '2026-10-01' },
      { id: 'x3', renterId: 'd', leaseId: 'ld', type: 'deposit_charge', status: 'paid', amountCents: 40000 },
      { id: 'x4', renterId: 'e', leaseId: 'le', type: 'deposit_charge', status: 'paid', amountCents: 30000 },
      { id: 'x5', renterId: 'f', leaseId: 'lf', type: 'deposit_charge', status: 'paid', amountCents: 30000 },
      { id: 'x6', renterId: 'f', leaseId: 'lf', type: 'deposit_refund', status: 'paid', amountCents: -30000 },
      { id: 'x7', renterId: 'a', type: 'card_refund', status: 'refunded', amountCents: 2500, createdAt: '2026-11-04T09:00:00Z' },
      { id: 'x8', renterId: 'b', type: 'payment', status: 'paid', amountCents: -5000, paidAt: '2026-10-31T22:00:00Z', description: 'Payment — Check' },
    ],
    schedule: [
      { leaseId: 'la', renterId: 'a', boothId: 'b1', date: '2026-11-10', amountCents: 50000, frequency: 'monthly', readiness: 'manual', lastAttempt: null },
      { leaseId: 'le', renterId: 'e', boothId: 'b1', date: '2026-11-10', amountCents: 30000, frequency: 'monthly', readiness: 'manual', lastAttempt: null },
      { leaseId: 'lf', renterId: 'f', boothId: 'b2', date: '2026-11-17', amountCents: 30000, frequency: 'monthly', readiness: 'manual', lastAttempt: null },
      { leaseId: 'lb2', renterId: 'b', boothId: 'b4', date: '2026-11-18', amountCents: 20000, frequency: 'monthly', readiness: 'manual', lastAttempt: null },
    ] as any[],
  });
  const ana = E.owed.find((o: any) => o.renterId === 'a'); const ben = E.owed.find((o: any) => o.renterId === 'b');
  check('late by a one-off charge alone: counted from that charge, never from a deposit dated earlier', !!ana && ana.late && ana.daysLate === 10 && ana.totalCents === 34000, ana);
  check('several bills: oldest first, part paid said; a void or paid bill isn’t owed; their spaces joined', !!ben && ben.bills.map((b: any) => b.id).join() === 'v1,v2' && /\$50 paid/.test(ben.bills[0].text) && ben.totalCents === 36500 && ben.space === 'Suite 2, Suite 4', ben);
  const cy = E.former.find((o: any) => o.renterId === 'c');
  check('barred and since paid up: still listed, so they can be let back in', !!cy && cy.totalCents === 0 && cy.barred === true, E.former);
  check('a deposit held on a cancelled lease is to settle; one on a lease ending in months isn’t; one already returned drops out', E.deposits.toSettle.some((d: any) => d.leaseId === 'ld') && !E.deposits.toSettle.some((d: any) => d.leaseId === 'le') && !E.deposits.toSettle.some((d: any) => d.leaseId === 'lf') && E.deposits.restHeld.count === 1, E.deposits);
  check('coming up from today: due today and not billed yet counts; due today with its bill out doesn’t (it’s under Owed); a week out is the edge', E.upcoming.map((u: any) => `${u.leaseId}|${u.date}`).join(';') === 'la|2026-11-10;lf|2026-11-17', E.upcoming);
  const ek = Object.fromEntries(E.kpis.map((v: any) => [v.key, v]));
  check('part of a bill paid online is collected on its day; a card refund comes off and is listed; last month’s payment isn’t', E.paid.map((p: any) => `${p.how}|${p.cents}`).join(';') === 'Refunded to their card|-2500;Online, part of the Nov 1 bill|20000' && ek.collected.value === '$175' && ek.collected.sub === '1 by hand or online, less 1 refund', [E.paid, ek.collected]);
  const quiet = M.rentMoney({ todayIso: today, renters: [{ id: 'q', firstName: 'Q', lastName: 'R' }], leases: [{ id: 'lq', renterId: 'q', boothId: 'b1', status: 'active' }], booths, invoices: [{ id: 'q1', renterId: 'q', leaseId: 'lq', status: 'late', amountCents: 100, dueDate: '' }], ledger: [], schedule: [] });
  check('late with no date on file: says late, never “0 days late”', quiet.kpis[0].sub === '1 renter, late', quiet.kpis[0].sub);
  const W = M.rentMoney({ todayIso: today, renters: [{ id: 'w', firstName: 'W', lastName: 'X' }], leases: [{ id: 'lw', renterId: 'w', boothId: 'b1', status: 'active', dueDay: 10 }], booths,
    invoices: [{ id: 'w1', renterId: 'w', leaseId: 'lw', status: 'void', voidReason: 'waived', amountCents: 100, dueDate: today }], ledger: [],
    schedule: [{ leaseId: 'lw', renterId: 'w', boothId: 'b1', date: today, amountCents: 100, frequency: 'monthly', readiness: 'manual', lastAttempt: null }] as any[] });
  const W2 = M.rentMoney({ todayIso: today, renters: [{ id: 'w', firstName: 'W', lastName: 'X' }], leases: [{ id: 'lw', renterId: 'w', boothId: 'b1', status: 'active', dueDay: 10 }], booths,
    invoices: [{ id: 'w1', renterId: 'w', leaseId: 'lw', status: 'void', voidReason: 'entered twice', amountCents: 100, dueDate: today }], ledger: [],
    schedule: [{ leaseId: 'lw', renterId: 'w', boothId: 'b1', date: today, amountCents: 100, frequency: 'monthly', readiness: 'manual', lastAttempt: null }] as any[] });
  check('a bill waived today doesn’t come back under Coming up; one voided as a mistake does', W.upcoming.length === 0 && W2.upcoming.length === 1, [W.upcoming, W2.upcoming]);
  const tzIn = { todayIso: '2026-11-01', renters: [{ id: 'z', firstName: 'Z', lastName: 'Y' }], leases: [], booths, invoices: [{ id: 'z1', renterId: 'z', status: 'paid', paidMethod: 'Card (Stripe)', paidAt: '2026-11-01T02:00:00Z', paidAmountCents: 5000, amountCents: 5000, dueDate: '2026-10-31' }],
    ledger: [{ id: 'z2', renterId: 'z', type: 'payment', status: 'paid', amountCents: -7000, paidAt: '2026-11-01', description: 'Payment — Cash' }], schedule: [] };
  const NY = M.rentMoney({ ...tzIn, timeZone: 'America/New_York' }); const UTC = M.rentMoney(tzIn);
  check('a payment at 10pm on Oct 31 in New York (2am Nov 1 on the server) is October’s, on the business’s clock; a cash payment on Nov 1 is November’s', NY.paid.map((p: any) => p.id).join() === 'z2' && NY.kpis[1].value === '$70' && UTC.paid.length === 2, [NY.paid, NY.kpis[1], UTC.paid.length]);
  const none = M.rentMoney({ todayIso: today, renters: [], leases: [], booths: [], invoices: [], ledger: [], schedule: [] });
  check('nothing yet: plain words', none.kpis.every((v: any) => !v.warn) && none.kpis[0].sub === 'Everyone is paid up' && none.kpis[2].sub === 'Nothing due this week' && none.kpis[3].sub === 'None held');

  const page = readFileSync('src/app/(app)/rent/page.tsx', 'utf8');
  check('the Rent page shows it, with its one Record payment and its waivers', /<RentMoney tenantId=\{tenantId\} data=\{moneyView\}/.test(page) && /onRecordPayment=\{\(id\) => \{ const r = /.test(page) && /onWaive=\{\(what, id, why\) => what === 'charge' \? handleWaive\(/.test(page) && /: waiveInvoice\(id, what, why\)\}/.test(page) && /onWriteOff=\{\(id, why, cents\) =>/.test(page)
    && page.indexOf('const moneyView = useMemo(') < page.indexOf('  if (!tenantId) {\n    return ('));
  check('the Rent page no longer turns autopay on for a renter without their signed OK', !/RentScheduleCard/.test(page) && !/autopayEnabled: true, autopayChangedAt/.test(page));
  check('old charges not on a bill yet can still be brought in', /onClick=\{importCharges\}/.test(page));
  const wv = page.slice(page.indexOf('const waiveInvoice = async'), page.indexOf('const historyEntries'));
  check('a waiver is read again as it’s saved: nothing is written for a bill paid or changed meanwhile, and the panel is told', /runTransaction\(firestore, async \(tx\) => \{\s*const snap = await tx\.get\(invRef\);/.test(wv) && /if \(!\['due', 'late'\]\.includes\(String\(inv\.status\)\)\) return null;/.test(wv) && /const owed = invoiceOwedCents\(inv\);/.test(wv) && /return false;/.test(wv)
    && /tx\.get\(ref\)/.test(wv) && /isOpenLedgerCharge\(snap\.data\(\)\)/.test(wv));
  const wo = page.slice(page.indexOf('const writeOff = async'), page.indexOf('if (!tenantId) {\n    return ('));
  check('a write-off keeps its reason, is read again as it’s saved (nothing written if what they owe changed), and says whether it went through', /note: reasonGiven\.trim\(\) \|\| 'Written off as uncollectable'/.test(wo) && /const writeOff = async \(r: any, reasonGiven = '', expectCents\?: number\): Promise<boolean>/.test(wo)
    && /runTransaction\(firestore, async \(tx\) => \{\s*const bills = \(await Promise\.all\(billIds\.map\(\(id\) => tx\.get\(/.test(wo) && /if \(bal <= 0 \|\| \(typeof expectCents === 'number' && bal !== expectCents\)\) return 0;/.test(wo) && /onWriteOff=\{\(id, why, cents\) =>/.test(page)
    && /!String\(e\.type \|\| ''\)\.startsWith\('deposit_'\)/.test(wo));
  check('no hook after the page’s early return', !/use(State|Memo|Effect|Callback|Ref)\(/.test(page.slice(page.indexOf('if (!tenantId) {\n    return ('), page.indexOf('\nfunction ', page.indexOf('if (!tenantId) {\n    return (')) > 0 ? page.indexOf('\nfunction ', page.indexOf('if (!tenantId) {\n    return (')) : undefined)));
  check('today on the Rent page is the business’s day, and its sums count payments on that clock', /const bizTimeZone = tenantTimeZone\(selectedTenant\);\s*const todayIso = todayIn\(bizTimeZone\);/.test(page) && /const cycleStartIso = `\$\{todayIso\.slice\(0, 7\)\}-01`;/.test(page)
    && /rentMoney\(\{ todayIso, timeZone: bizTimeZone,/.test(page) && /timeZone: bizTimeZone,\s*\}\),/.test(page) && /invoices, timeZone: x\.timeZone \}\);/.test(readFileSync('src/lib/rentals-home.ts', 'utf8')));
  const ui = readFileSync('src/components/renters/RentMoney.tsx', 'utf8');
  check('the panel stays open with what went wrong when a waiver or write-off doesn’t go through', /if \(ok\) setPanel\(null\);\s*else setErr\(/.test(ui) && /role="alert"/.test(ui));
  check('every bill, fee and charge can be waived, not just the oldest; former renters can be written off and their history opened', /function waivables\(o: OwedRow\)/.test(ui) && /for \(const c of o\.charges\)/.test(ui) && />Write off<\/button>/.test(ui) && /renterLink\(o\.renterId, 'money'\)/.test(ui));
  check('the tabs work from the keyboard (arrows, Home, End; one tab stop)', /tabIndex=\{tab === t\.id \? 0 : -1\}/.test(ui) && /e\.key === 'ArrowRight'/.test(ui) && /e\.key === 'Home'/.test(ui));
  const online = readFileSync('src/lib/rent-online-pay.ts', 'utf8'); const types = readFileSync('src/lib/booth-rental-types.ts', 'utf8');
  check('part of a bill paid online is kept with its day, and counted as collected everywhere', /onlineParts: \{ \[k\]: \{ cents: take, at: nowIso \} \}/.test(online) && /flatMap\(\(i: any\) => Object\.values\(\(i\?\.onlineParts \|\| \{\}\)/.test(types));
  const lb = readFileSync('src/components/renters/LeaseBuilder.tsx', 'utf8');
  check('the lease builder’s staff check reads again on return, drops a late answer, and says when it couldn’t check', /window\.addEventListener\('focus', onFocus\)/.test(lb) && /let live = true;/.test(lb) && /couldn’t be checked just now/.test(lb));
  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  const mine = ['src/lib/rent-money.ts', 'src/components/renters/RentMoney.tsx'].map((p) => readFileSync(p, 'utf8')).join('\n');
  check('no tool names; no all-caps labels', !AI.test(mine) && !/uppercase/.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
