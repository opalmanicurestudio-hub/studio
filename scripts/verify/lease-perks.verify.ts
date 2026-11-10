// Checks perks on a lease from the builder (lib/lease-perks):
// - What each is worth (a week of rent at any frequency, a percentage of one bill, a set credit) and when it's due
//   (the start, or the signing day if later; or 3, 6 or 12 months after the start).
// - The nightly step gives each perk once, as a credit on the rent account that then comes off open bills; never
//   before it's due, never on a lease that isn't running, never on an older lease, never twice.
// - The lease's words list them, and the renter's statement shows them.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/lease-perks.verify.ts
import { readFileSync } from 'fs';
import { makeDb, check, failures } from './fake-db';

(async () => {
  const P = await import('../../src/lib/lease-perks');
  const { applyAllOpenCredits } = await import('../../src/lib/rent-credits');
  const { creditLabel } = await import('../../src/lib/rent-payment-plan');
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

  check('a week of rent: monthly, weekly, two-weekly, daily', P.weekOfRent(90000, 'monthly') === 20769 && P.weekOfRent(25000, 'weekly') === 25000 && P.weekOfRent(50000, 'biweekly') === 25000 && P.weekOfRent(4000, 'daily') === 28000);
  check('what each perk is worth', P.perkCreditCents({ type: 'free_week', trigger: 'on_signup' }, 90000, 'monthly') === 20769
    && P.perkCreditCents({ type: 'rent_discount', trigger: 'on_signup', valuePercent: 10 }, 90000, 'monthly') === 9000
    && P.perkCreditCents({ type: 'custom', trigger: 'on_signup', valueCents: 5000 }, 90000, 'monthly') === 5000
    && P.perkCreditCents({ type: 'rent_discount', trigger: 'on_signup', valuePercent: 400 }, 90000, 'monthly') === 90000);
  check('when it’s due: the start, or the day they signed if later; months after the start, clamped', P.perkDueOn({ type: 'free_week', trigger: 'on_signup' }, { startDate: '2026-11-14' }) === '2026-11-14'
    && P.perkDueOn({ type: 'free_week', trigger: 'on_signup' }, { startDate: '2026-11-14', signedAt: '2026-11-20T15:00:00Z' }) === '2026-11-20'
    && P.perkDueOn({ type: 'free_week', trigger: 'after_6_months' }, { startDate: '2026-08-31' }) === '2027-02-28'
    && P.perkDueOn({ type: 'free_week', trigger: 'annually' }, { startDate: '2026-08-31' }) === null);
  check('the lease’s words for each', P.perkWords({ type: 'free_week', trigger: 'on_signup', label: 'Welcome week' }, 'monthly', usd) === 'Welcome week: a credit of one week’s rent when the lease starts, or when it’s signed if that’s later'
    && P.perkWords({ type: 'rent_discount', trigger: 'after_12_months', valuePercent: 10 }, 'monthly', usd) === 'a credit of 10% of one month’s rent after 12 months'
    && P.perkWords({ type: 'custom', trigger: 'after_3_months', valueCents: 5000 }, 'weekly', usd) === 'a $50.00 credit after 3 months');

  // The nightly step.
  const db: any = makeDb();
  const T = 'tenants/t1';
  const lease = (id: string, over: any) => db.doc(`${T}/leases/${id}`).set({ renterId: 'r1', boothId: 'b1', locationId: 'l1', status: 'active', leaseFrom: 'builder', rentAmountCents: 90000, frequency: 'monthly', startDate: '2026-11-01', ...over });
  await lease('L1', { perks: [
    { id: 'p1', type: 'free_week', label: 'Welcome week', trigger: 'on_signup', appliedAt: null, ledgerEntryId: null },
    { id: 'p2', type: 'rent_discount', label: '', trigger: 'after_6_months', valuePercent: 10, appliedAt: null, ledgerEntryId: null },
  ] });
  await lease('L2', { status: 'pending_signature', perks: [{ id: 'p1', type: 'custom', label: 'Credit', trigger: 'on_signup', valueCents: 5000, appliedAt: null, ledgerEntryId: null }] });
  await lease('L3', { leaseFrom: undefined, perks: [{ id: 'p1', type: 'custom', label: 'Old', trigger: 'on_signup', valueCents: 5000, appliedAt: null, ledgerEntryId: null }] });
  await lease('L4', { renterId: 'r2', leaseFrom: 'own', perks: [{ id: 'p1', type: 'custom', label: 'Set', trigger: 'on_signup', valueCents: 5000, appliedAt: null, ledgerEntryId: null }] });
  await db.doc(`${T}/rentInvoices/i1`).set({ renterId: 'r1', leaseId: 'L1', status: 'due', dueDate: '2026-12-01', amountCents: 90000, paidCents: 0 });

  const r1 = await P.grantLeasePerks(db, 't1', '2026-12-01', '2026-12-01T08:00:00Z');
  const line = (await db.doc(`${T}/rentLedger/perk_L1_p1`).get()).data();
  const l1 = (await db.doc(`${T}/leases/L1`).get()).data();
  check('a perk that’s due is posted once as a rent credit, and marked given on the lease', r1.given === 1 && line?.type === 'perk_credit' && line.amountCents === -20769 && line.status === 'paid' && line.renterId === 'r1'
    && l1.perks[0].appliedAt === '2026-12-01' && l1.perks[0].ledgerEntryId === 'perk_L1_p1', r1);
  check('…not before it’s due', !l1.perks[1].appliedAt && !(await db.doc(`${T}/rentLedger/perk_L1_p2`).get()).exists);
  check('…not on a lease not yet signed, nor an older lease', !(await db.doc(`${T}/rentLedger/perk_L2_p1`).get()).exists && !(await db.doc(`${T}/rentLedger/perk_L3_p1`).get()).exists);
  check('…nor an attorney’s own lease, whose words don’t state them', !(await db.doc(`${T}/rentLedger/perk_L4_p1`).get()).exists);
  const again = await P.grantLeasePerks(db, 't1', '2026-12-02', '2026-12-02T08:00:00Z');
  check('…and never twice', again.given === 0);
  await applyAllOpenCredits(db, 't1', '2026-12-01T08:05:00Z');
  const inv = (await db.doc(`${T}/rentInvoices/i1`).get()).data();
  check('the credit comes off their open bill the same night', inv.paidCents === 20769 && /lease perk/.test(String(inv.creditNote)), inv);
  check('it reads as a lease perk', creditLabel('perk_credit') === 'lease perk');
  const r2 = await P.grantLeasePerks(db, 't1', '2027-05-01', '2027-05-01T08:00:00Z');
  check('a perk months on is given that day', r2.given === 1 && (await db.doc(`${T}/rentLedger/perk_L1_p2`).get()).data()?.amountCents === -9000);

  // Wiring.
  const nightly = readFileSync('src/app/api/cron/nightly/route.ts', 'utf8');
  check('the nightly job gives perks before taking credits off open bills', nightly.indexOf('grantLeasePerks(db, tDoc.id') > 0 && nightly.indexOf('grantLeasePerks(db, tDoc.id') < nightly.indexOf('applyAllOpenCredits(db, tDoc.id)'));
  check('the renter’s statement lists a lease perk', /'retail_sale_credit', 'perk_credit'\]\.includes\(String\(r\.type \|\| ''\)\)/.test(readFileSync('src/app/api/portal/renter/route.ts', 'utf8')));
  const L = await import('../../src/lib/lease-builder');
  const { resolveOffers } = await import('../../src/lib/renter-offers');
  const { responseCommitments } = await import('../../src/lib/maintenance');
  const { resolveLeavePolicy } = await import('../../src/lib/leave-policy');
  const { resolveCollectionsPolicy } = await import('../../src/lib/collections-policy');
  const t: any = { name: 'Northside', address: { state: 'PA' } };
  const ctx = { businessName: 'Northside', policy: L.resolveLeasePolicy(t), repairs: responseCommitments(null), leave: resolveLeavePolicy(t), collections: resolveCollectionsPolicy(t), offers: resolveOffers(t) };
  const base: any = { renterName: 'Maya Ortiz', renterBusinessName: '', renterNoticeAddress: 'x', spaceName: 'Suite 4', spaceAddress: '', isShared: false, slot: null, accessHours: '', amenities: [], keyType: 'own_code', startDate: '2026-11-14', endDate: '2027-11-13', autoRenew: true, noticeDays: 30, earlyEndFee: 'none', holdover: 'same',
    rentCents: 90000, frequency: 'monthly', dueDay: 1, prorateFirst: true, rentChangeNoticeDays: 60, graceDays: 3, lateFee: null, declinedFeeCents: 0, payByCard: true, payByAutopay: false, payOffline: false,
    depositCents: 0, depositRefundable: true, depositReturnDays: 14, depositAsLastMonth: false, agreedCharges: [], sellProducts: true, noPoach: false, insurance: ctx.policy.insurance, licenseRequired: false, houseRules: null, changesNeedOk: true, damageByRenter: true, propertyClause: true };
  const withPerks = L.buildLease({ ...base, perks: [{ type: 'free_week', trigger: 'on_signup', label: 'Welcome week' }] }, ctx as any);
  check('the lease states its perks, in the rent section and the key terms', /The lease also gives this perk, each a credit to the Renter’s rent account that comes off their next bills: Welcome week: a credit of one week’s rent when the lease starts, or when it’s signed if that’s later\./.test(withPerks.sections.find((s: any) => s.key === 'rent')!.text)
    && withPerks.keyTerms.some((k: any) => k.label === 'Perks') && !L.buildLease(base, ctx as any).keyTerms.some((k: any) => k.label === 'Perks'));
  const src = readFileSync('src/components/renters/LeaseBuilder.tsx', 'utf8');
  check('the builder offers only perks it can give, and a lease in whole months keeps its length for renewal', /BUILDER_PERK_TYPES\.map/.test(src) && /BUILDER_PERK_TRIGGERS\.map/.test(src) && !/PERK_TYPE_LABELS/.test(src) && /termMonths: Number\(length\)/.test(src) && /perks: \(own\.on \? \[\] : perks\)/.test(src));

  // The desk's balance counts only what's left of a credit already drawn onto bills.
  const { renterAccount } = await import('../../src/lib/rent-desk');
  await db.doc(`${T}/renters/r1`).set({ firstName: 'Maya' });
  await db.doc(`${T}/rentLedger/c1`).set({ renterId: 'r1', type: 'one_off_charge', status: 'pending', amountCents: 30000, dueDate: '2027-05-01' });
  const acct: any = await renterAccount(db, T, 'r1');
  check('the desk balance doesn’t count a perk twice once it’s on a bill: only what’s left of each credit', acct.invoiceOwedCents === 90000 - 20769 && acct.balanceCents === 30000 - 9000, { bal: acct.balanceCents, inv: acct.invoiceOwedCents });

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
