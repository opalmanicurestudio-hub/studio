// Checks the rent schedule round (launch L15b):
// - ONE rule decides billing days everywhere (lib/rent-schedule): the first bill is on the first charge date, or the day
//   the lease started when it was signed later; then the regular days. Nothing past the end of a lease that doesn't
//   renew itself. A monthly lease can bill its first part-month by the day.
// - The catch-up (nightly and the Rent page's "Bring rent up to date") follows the same rule, respects approved leave,
//   never bills a month twice, and doesn't reach back more than two months.
// - Autopay takes the open bill (first bills too, and a bill dated the day before), records it like every rent payment,
//   and never tries a declined card again on its own.
// - What a renter owes is their open rent bills plus open one-off charges: a paid autopay line or a declined attempt
//   isn't counted again.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-rent-schedule.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
class FakeResponse { status: number; body: any; constructor(body?: any, init?: any) { this.body = body; this.status = init?.status || 200; }
  static json(body: any, init?: any) { return new FakeResponse(body, init); } }
const charges: any[] = []; let declineNext = 0; let noAnswer = 0;
const fakeStripe: any = { paymentIntents: { create: async (p: any, o: any) => { charges.push({ p, o });
  if (noAnswer > 0) { noAnswer--; throw Object.assign(new Error('Connection reset'), { type: 'StripeConnectionError' }); }
  if (declineNext > 0) { declineNext--; throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined' }); }
  return { id: `pi_${charges.length}`, status: 'succeeded', latest_charge: `ch_${charges.length}` }; } } };
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: FakeResponse };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'stripe') return { __esModule: true, default: function Stripe() { return fakeStripe; } };
  if (request === '@/lib/cron-auth' || /\/src\/lib\/cron-auth(\.ts)?$/.test(request)) return { refuseCron: () => null, cronAllowed: () => true };
  if (request === '@/lib/cron-heartbeat' || /\/src\/lib\/cron-heartbeat(\.ts)?$/.test(request)) return { recordCronRun: async () => {} };
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'm1' }), text: async () => '' });
const read = (p: string) => readFileSync(p, 'utf8');
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;

(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  const RS = await import('../../src/lib/rent-schedule');
  const RC = await import('../../src/lib/rent-cycle');
  const BT = await import('../../src/lib/booth-rental-types');
  const { todayIn } = await import('../../src/lib/tenant-time');

  console.log('One billing rule');
  const m = { frequency: 'monthly', dueDay: 1, rentAmountCents: 80000, firstChargeDate: '2026-11-09', startDate: '2026-11-09' };
  check('the first bill is on the first charge date, not the next due day', RS.nextChargeDate(m, '2026-11-01') === '2026-11-09' && RS.nextChargeDate(m, '2026-11-10') === '2026-12-01');
  check('a first part-month can be billed by the day', RS.billCents({ ...m, prorateFirst: true }, '2026-11-09') === Math.round(80000 * 22 / 30) && RS.billCents({ ...m, prorateFirst: true }, '2026-12-01') === 80000);
  check('…or as a full month when the owner says so', RS.billCents({ ...m, prorateFirst: false }, '2026-11-09') === 80000);
  check('a lease made before this setting existed is billed by the day (never two full bills weeks apart)', RS.billCents(m, '2026-11-09') === Math.round(80000 * 22 / 30));
  check('a first bill on a due day the month is too short for is a full month', RS.billCents({ ...m, dueDay: 31, firstChargeDate: '2027-01-31', rentAmountCents: 93000 }, '2027-01-31') === 93000
    && RS.billCents({ ...m, dueDay: 31, firstChargeDate: '2026-08-31', rentAmountCents: 93000 }, '2026-08-31') === 93000
    && RS.billCents({ ...m, dueDay: 30, firstChargeDate: '2027-01-30', rentAmountCents: 93000 }, '2027-01-30') === 93000);
  check('a February start is billed by February’s days', RS.billCents({ ...m, firstChargeDate: '2027-02-20' }, '2027-02-20') === Math.round(80000 * 9 / 28));
  check('a first charge date on the due day is a full month either way', RS.billCents({ ...m, firstChargeDate: '2026-12-01', prorateFirst: true }, '2026-12-01') === 80000);
  const fb = RS.firstBill({ ...m, prorateFirst: true });
  check('the wizard sees the first bill and the next one', fb?.due === '2026-11-09' && fb?.prorated === true && fb?.nextDue === '2026-12-01', fb);
  check('a lease signed after its first charge date bills first on the day it was signed (the business’s day)', RS.nextChargeDate({ ...m, activatedAt: '2026-11-21T02:00:00Z', activatedOn: '2026-11-20' }, '2026-11-01') === '2026-11-20'
    && RS.billCents({ ...m, prorateFirst: true, activatedOn: '2026-11-20' }, '2026-11-20') === Math.round(80000 * 11 / 30));
  check('a weekly lease signed late keeps a full week between its first bills', JSON.stringify(RS.dueDatesBetween({ frequency: 'weekly', firstChargeDate: '2026-11-02', activatedOn: '2026-11-05' }, '2026-11-01', '2026-11-20')) === '["2026-11-05","2026-11-12","2026-11-19"]');
  check('a lease already running keeps the schedule it’s been billed on (no new weekday after this change)', JSON.stringify(RS.dueDatesBetween({ frequency: 'weekly', firstChargeDate: '2026-11-02', activatedAt: '2026-11-05T15:00:00Z' }, '2026-11-01', '2026-11-20')) === '["2026-11-02","2026-11-09","2026-11-16"]');
  check('a lease signed in the portal before this change keeps the schedule it’s been billed on', RS.billingStart({ firstChargeDate: '2026-11-02', activatedAt: '2026-11-05T15:00:00Z', signatureDocumentId: 'sd1' }) === '2026-11-02'
    && JSON.stringify(RS.dueDatesBetween({ frequency: 'weekly', firstChargeDate: '2026-11-02', activatedAt: '2026-11-05T15:00:00Z', signatureDocumentId: 'sd1' }, '2026-11-01', '2026-11-20')) === '["2026-11-02","2026-11-09","2026-11-16"]');
  const RI = await import('../../src/lib/rent-invoices');
  const mm = { frequency: 'monthly', dueDay: 5, firstChargeDate: '2027-03-03' };
  check('a part-month first bill and the regular bill can share a month', !RI.monthAlreadyBilled(mm, '2027-03-05', [{ dueDate: '2027-03-03', status: 'due' }]));
  check('a month billed on another regular day isn’t billed again (old 28th bills)', RI.monthAlreadyBilled({ frequency: 'monthly', dueDay: 31, firstChargeDate: '2026-08-31' }, '2026-10-31', [{ dueDate: '2026-10-28', status: 'paid' }])
    && !RI.monthAlreadyBilled({ frequency: 'monthly', dueDay: 31, firstChargeDate: '2026-08-31' }, '2026-10-31', [{ dueDate: '2026-10-28', status: 'void' }]));
  check('nothing is billed past the end of a lease that doesn’t renew itself', RS.nextChargeDate({ ...m, endDate: '2026-12-15' }, '2026-12-02') === null);
  check('…but a self-renewing lease keeps going (the nightly job extends it)', RS.nextChargeDate({ ...m, endDate: '2026-12-15', autoRenew: true }, '2026-12-02') === '2027-01-01');
  check('a due day the month doesn’t have falls on its last day', RS.nextChargeDate({ ...m, dueDay: 31, firstChargeDate: '2026-10-31' }, '2026-11-01') === '2026-11-30');
  check('daily leases bill every day (the old catch-up treated them as every two weeks)', JSON.stringify(RS.dueDatesBetween({ frequency: 'daily', firstChargeDate: '2026-11-01' }, '2026-11-01', '2026-11-03')) === '["2026-11-01","2026-11-02","2026-11-03"]');
  check('weekly leases keep their weekday', JSON.stringify(RS.dueDatesBetween({ frequency: 'weekly', firstChargeDate: '2026-11-02' }, '2026-11-01', '2026-11-20')) === '["2026-11-02","2026-11-09","2026-11-16"]');

  console.log('Catch-up');
  const tenant = { name: 'Fern & Co', timezone: 'America/New_York', subscriptionStatus: 'active', stripeAccountId: 'acct_biz', stripeChargesEnabled: true };
  await db.doc(T).set(tenant);
  const today = todayIn('America/New_York');
  const minus = (k: number) => new Date(Date.parse(`${today}T12:00:00Z`) - k * 86400000).toISOString().slice(0, 10);
  await db.doc(`${T}/renters/r1`).set({ firstName: 'Ana', lastName: 'Diaz' });
  await db.doc(`${T}/booths/b1`).set({ name: 'Room 1' });
  const lease = (id: string, extra: any) => db.doc(`${T}/leases/${id}`).set({ renterId: 'r1', boothId: 'b1', status: 'active', rentAmountCents: 10000, frequency: 'daily', lateFeePolicy: { enabled: true, graceDays: 3, type: 'flat', amountCents: 2500 }, ...extra });
  // A daily lease on paused leave for the last 3 days.
  await lease('L_leave', { firstChargeDate: minus(5) });
  await db.doc(`${T}/renterLeaves/lv1`).set({ leaseId: 'L_leave', status: 'approved', treatment: 'pause', startDate: minus(3), endDate: today });
  // A monthly lease due on the 31st, billed on the 28th by the old rule.
  const m31: any = { firstChargeDate: '2026-08-31', frequency: 'monthly', dueDay: 31 };
  await lease('L_31', m31);
  const prevMonth = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  await db.doc(`${T}/rentInvoices/old28`).set({ leaseId: 'L_31', renterId: 'r1', dueDate: `${prevMonth}-28`, amountCents: 10000, status: 'paid' });
  // A lease signed today, 20 days after its first charge date.
  await lease('L_late', { firstChargeDate: minus(20), frequency: 'weekly', activatedAt: `${today}T15:00:00Z`, activatedOn: today, signatureDocumentId: 'sd1' });
  // A daily lease that started long ago.
  await lease('L_old', { firstChargeDate: minus(200) });
  const r = await RC.runRentCycle(db, 't1', today);
  const bills = (await db.collection(`${T}/rentInvoices`).get()).docs.map((d: any) => d.data());
  const of = (id: string) => bills.filter((b: any) => b.leaseId === id).map((b: any) => b.dueDate).sort();
  check('paused leave days aren’t billed', JSON.stringify(of('L_leave')) === JSON.stringify([minus(5), minus(4)]), of('L_leave'));
  check('a month already billed (on another day) isn’t billed again', !of('L_31').some((d: string) => d.startsWith(prevMonth) && d !== `${prevMonth}-28`), of('L_31'));
  const late = bills.filter((b: any) => b.leaseId === 'L_late');
  check('a lease signed late gets one bill, on the day it was signed, and it isn’t late', late.length === 1 && late[0].dueDate === today && late[0].status === 'due' && !(late[0].lateFeeCents > 0), late);
  check('the catch-up doesn’t reach back more than two months', of('L_old').length === 63 && of('L_old')[0] === minus(62), { n: of('L_old').length, first: of('L_old')[0] });
  const again = await RC.runRentCycle(db, 't1', today);
  check('running it again changes nothing', again.created === 0 && r.created > 0, again);
  check('bills have one id per lease and day, so two runs at once can’t make two', (await db.collection(`${T}/rentInvoices`).get()).docs.every((d: any) => d.id === `${d.data().leaseId}_${d.data().dueDate}` || d.id === 'old28'));
  // A declined autopay line on yesterday's bill is history: moving old ledger charges onto bills never makes a new bill.
  await db.doc(`${T}/rentLedger/decl1`).set({ leaseId: 'L_leave', renterId: 'r1', type: 'rent_charge', amountCents: 10000, status: 'failed', dueDate: minus(1), description: 'Autopay rent charge — card declined (card_declined)' });
  const mig = await RC.migrateLedger(db, 't1', today);
  check('a declined autopay never becomes a second bill', (mig as any).charges === 0 && (await get(`${T}/rentLedger/decl1`))?.status === 'failed', mig);
  // An old ledger charge on a lease's first day keeps its own amount when it's moved onto a bill.
  await lease('L_mig', { frequency: 'monthly', dueDay: 1, firstChargeDate: minus(9), rentAmountCents: 90000 });
  await db.doc(`${T}/rentLedger/oldc`).set({ leaseId: 'L_mig', renterId: 'r1', type: 'rent_charge', amountCents: 90000, status: 'pending', dueDate: minus(9) });
  await db.doc(T).set({ rentLedgerMigratedAt: null }, { merge: true });
  await RC.migrateLedger(db, 't1', today);
  const movedBill = (await db.collection(`${T}/rentInvoices`).where('leaseId', '==', 'L_mig').get()).docs.map((d: any) => d.data()).find((b: any) => b.dueDate === minus(9));
  check('an old charge moved onto a bill keeps its amount (never prorated again)', movedBill?.amountCents === 90000, movedBill);

  console.log('Autopay');
  const A = await import('../../src/app/api/cron/autopay-leases/route');
  for (const d of (await db.collection(`${T}/leases`).get()).docs) await d.ref.delete();
  for (const d of (await db.collection(`${T}/rentInvoices`).get()).docs) await d.ref.delete();
  await db.doc(`${T}/renters/r1`).set({ autopayEnabled: true, stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', stripeCustomerAccount: 'acct_biz', cardOnFile: true }, { merge: true });
  await db.doc(`${T}/renters/r2`).set({ firstName: 'Bo', lastName: 'Lee', autopayEnabled: true, stripeCustomerId: 'cus_2', stripePaymentMethodId: 'pm_2', stripeCustomerAccount: 'acct_biz', cardOnFile: true });
  await db.doc(`${T}/leases/LA`).set({ renterId: 'r1', boothId: 'b1', status: 'active', rentAmountCents: 80000, frequency: 'monthly', dueDay: 1, firstChargeDate: minus(1), locationId: 'loc1' });
  await db.doc(`${T}/rentInvoices/billA`).set({ leaseId: 'LA', renterId: 'r1', dueDate: minus(1), amountCents: 58667, status: 'due' });
  await db.doc(`${T}/leases/LB`).set({ renterId: 'r2', boothId: 'b1', status: 'active', rentAmountCents: 50000, frequency: 'monthly', dueDay: 1, firstChargeDate: today, locationId: 'loc1' });
  await db.doc(`${T}/rentInvoices/billB`).set({ leaseId: 'LB', renterId: 'r2', dueDate: today, amountCents: 50000, status: 'due' });
  charges.length = 0; declineNext = 0;
  await A.POST({ headers: { get: () => null } } as any);
  const paidA = await get(`${T}/rentInvoices/billA`);
  check('autopay takes a first bill that isn’t on the due day, dated the day before (far-west businesses)', charges.some((c) => c.p.amount === 58667 && c.p.customer === 'cus_1' && c.o.stripeAccount === 'acct_biz') && paidA?.status === 'paid' && !!paidA?.autopayTriedAt, { charges: charges.map((c) => c.p.amount), paidA });
  const txn = (await db.collection(`${T}/transactions`).where('sourceId', '==', 'billA').get()).docs.map((d: any) => d.data())[0];
  check('the payment is recorded like every rent payment (so it shows in their history)', txn?.source === 'booth_rent' && txn?.category === 'Booth Rent' && txn?.renterId === 'r1', txn);
  check('running autopay again doesn’t charge again', (await (async () => { const n = charges.length; await A.POST({ headers: { get: () => null } } as any); return charges.length === n; })()));
  await db.doc(`${T}/rentInvoices/billC`).set({ leaseId: 'LB', renterId: 'r2', dueDate: today, amountCents: 50000, status: 'due' });
  await db.doc(`${T}/rentInvoices/billB`).set({ status: 'paid' }, { merge: true });
  for (const d of (await db.collection('notificationLog').get()).docs) await d.ref.delete();
  for (const d of (await db.collection(`${T}/notificationLog`).get()).docs) await d.ref.delete();
  declineNext = 1; const before = charges.length;
  await A.POST({ headers: { get: () => null } } as any);
  const billC = await get(`${T}/rentInvoices/billC`);
  check('a declined card leaves the bill open and marks it tried', charges.length === before + 1 && billC?.status === 'due' && !!billC?.autopayTriedAt, billC);
  for (const d of (await db.collection(`${T}/notificationLog`).get()).docs) await d.ref.delete();
  await A.POST({ headers: { get: () => null } } as any);
  check('…and autopay doesn’t try that card again on its own', charges.length === before + 1);
  check('each charge is keyed to its bill (Stripe makes it once however often it’s asked)', charges.every((c) => /^autopay-bill-/.test(String(c.o.idempotencyKey || ''))) && charges.every((c) => !!c.p.metadata?.invoiceId));
  // The charge goes through but saving the result fails once: it's saved on the next try, and never charged again.
  await db.doc(`${T}/rentInvoices/billD`).set({ leaseId: 'LB', renterId: 'r2', dueDate: today, amountCents: 50000, status: 'due' });
  await db.doc(`${T}/rentInvoices/billC`).set({ status: 'paid' }, { merge: true });
  for (const d of (await db.collection(`${T}/notificationLog`).get()).docs) await d.ref.delete();
  const realBatch = db.batch; let failOnce = 1;
  db.batch = () => { const b = realBatch(); const commit = b.commit; b.commit = async () => { if (failOnce > 0) { failOnce--; throw new Error('deadline exceeded'); } return commit(); }; return b; };
  const n0 = charges.length;
  await A.POST({ headers: { get: () => null } } as any);
  db.batch = realBatch;
  const billD = await get(`${T}/rentInvoices/billD`);
  check('a passing failure to save after a charge is retried, and the card is charged once', charges.length === n0 + 1 && billD?.status === 'paid', billD);
  for (const d of (await db.collection(`${T}/notificationLog`).get()).docs) await d.ref.delete();
  await db.doc(`${T}/rentInvoices/billD`).set({ status: 'due' }, { merge: true });   // even if it somehow read as open again
  await A.POST({ headers: { get: () => null } } as any);
  check('a bill autopay already tried is never charged again', charges.length === n0 + 1);
  // A late fee isn't taken by autopay; the bill stays open for it.
  await db.doc(`${T}/rentInvoices/billE`).set({ leaseId: 'LA', renterId: 'r1', dueDate: today, amountCents: 80000, lateFeeCents: 2500, status: 'late' });
  for (const d of (await db.collection(`${T}/notificationLog`).get()).docs) await d.ref.delete();
  await A.POST({ headers: { get: () => null } } as any);
  const billE = await get(`${T}/rentInvoices/billE`);
  check('autopay takes the rent, not a late fee: the fee stays on the bill', charges[charges.length - 1]?.p.amount === 80000 && billE?.status === 'late' && billE?.paidCents === 80000, billE);
  // No answer from Stripe: asked again under the same key, and if still nothing, left for the business, never a decline.
  await db.doc(`${T}/rentInvoices/billF`).set({ leaseId: 'LB', renterId: 'r2', dueDate: today, amountCents: 50000, status: 'due' });
  await db.doc(`${T}/rentInvoices/billD`).set({ status: 'paid' }, { merge: true });
  for (const d of (await db.collection(`${T}/notificationLog`).get()).docs) await d.ref.delete();
  noAnswer = 3; const n1 = charges.length;
  await A.POST({ headers: { get: () => null } } as any);
  const billF = await get(`${T}/rentInvoices/billF`);
  const keysF = charges.slice(n1).map((c) => c.o.idempotencyKey);
  check('no answer from Stripe is asked again under the same key', keysF.length === 3 && new Set(keysF).size === 1, keysF);
  check('…and still nothing leaves the bill for the business to check, not a decline', billF?.status === 'due' && billF?.autopayUnconfirmed === true && !billF?.autopayDeclined
    && !(await db.collection(`${T}/rentLedger`).where('leaseId', '==', 'LB').get()).docs.some((d: any) => /declined \(Connection/.test(d.data().description || '')), billF);
  noAnswer = 1; await db.doc(`${T}/rentInvoices/billG`).set({ leaseId: 'LB', renterId: 'r2', dueDate: today, amountCents: 50000, status: 'due' });
  await db.doc(`${T}/rentInvoices/billF`).set({ status: 'paid' }, { merge: true });
  for (const d of (await db.collection(`${T}/notificationLog`).get()).docs) await d.ref.delete();
  await A.POST({ headers: { get: () => null } } as any);
  check('a passing hiccup is answered on the second ask, and the bill is paid', (await get(`${T}/rentInvoices/billG`))?.status === 'paid');
  check('a charge noted on a bill whose record didn’t save still counts as paid', BT.invoiceOwedCents({ status: 'due', amountCents: 50000, autopayIntentId: 'pi_x', autopayChargedCents: 50000 }) === 0
    && BT.invoiceOwedCents({ status: 'due', amountCents: 50000, paidCents: 50000, autopayIntentId: 'pi_x', autopayChargedCents: 50000, paidVia: 'autopay', lateFeeCents: 2500 }) === 2500);
  const failedLine = (await db.collection(`${T}/rentLedger`).where('leaseId', '==', 'LB').get()).docs.map((d: any) => d.data()).find((e: any) => /declined/.test(e.description || ''));
  check('the declined attempt is history, not a second amount owed', failedLine?.status === 'failed');

  console.log('What a renter owes');
  const invs = [{ renterId: 'r1', status: 'due', amountCents: 80000, lateFeeCents: 2500, paidCents: 30000 }, { renterId: 'r1', status: 'paid', amountCents: 80000 }, { renterId: 'r2', status: 'late', amountCents: 5000 }];
  const led = [{ renterId: 'r1', type: 'rent_charge', amountCents: 80000, status: 'paid' }, { renterId: 'r1', type: 'rent_charge', amountCents: 80000, status: 'failed' },
    { renterId: 'r1', type: 'one_off_charge', amountCents: 4000, status: 'pending' }, { renterId: 'r1', type: 'rent_charge', amountCents: 80000, status: 'migrated', migratedToInvoiceId: 'x' },
    { renterId: 'r1', type: 'payment', amountCents: -30000, status: 'paid' }];
  check('open bills (what’s left) plus open one-off charges; paid autopay lines, declines and moved charges don’t count', BT.renterOwedCents('r1', invs, led) === 52500 + 4000, BT.renterOwedCents('r1', invs, led));
  const sum = BT.buildRentRollSummary({ booths: [], renters: [], leases: [], ledger: led as any, todayIso: today, cycleStartIso: today, invoices: invs });
  check('the Rent page’s totals use the same rule, and a late bill marks the renter past due', sum.outstandingCents === 52500 + 4000 + 5000 && sum.pastDueRenterIds.includes('r2'), sum);
  const col = BT.buildRentRollSummary({ booths: [], renters: [], leases: [], todayIso: today, cycleStartIso: '2026-11-01',
    ledger: [{ type: 'payment', status: 'paid', amountCents: -30000, paidAt: '2026-11-03' }, { type: 'rent_charge', status: 'paid', amountCents: 80000, paidAt: '2026-11-01', description: 'Autopay rent charge' }] as any,
    invoices: [{ status: 'paid', paidMethod: 'Card (Stripe)', paidAt: '2026-11-04T10:00:00Z', paidAmountCents: 20000 }] });
  check('“collected this cycle” counts hand, autopay and online payments', col.collectedThisCycleCents === 130000, col.collectedThisCycleCents);

  console.log('Rent page and the rest');
  const rp = read('src/app/(app)/rent/page.tsx');
  check('the Rent page never writes rent bills from the browser (the rules refuse it)', !/doc\(collection\(firestore, 'tenants', tenantId, 'rentInvoices'\)\)/.test(rp) && /onClick=\{runRentCycle\}/.test(rp) && /importCharges = \(\) => runRentCycle\(\)/.test(rp));
  check('its balances and Record payment use what’s owed on rent bills', !/computeBalanceCents/.test(rp) && /owedOf\(renter\.id\)/.test(rp));
  check('paying more than owed is kept as credit toward the next rent', /type: 'prepaid_credit', status: 'paid', amountCents: -leftover/.test(rp));
  const nightly = read('src/app/api/cron/nightly/route.ts');
  check('each nightly bill is saved on its own (one that exists holds up no one), and the due email goes after it’s saved, with the renter’s own link',
    /try \{ await batch\.commit\(\); saved = true; \}/.test(nightly) && /if \(!saved\) continue;/.test(nightly) && nightly.indexOf('if (!saved) continue;') < nightly.indexOf('for (const t of tellDue)')
    && /renterPortalLink\(db, tDoc\.id, t\.renterId, rd\)/.test(nightly) && !/your booth rent/.test(nightly));
  check('the portal won’t open a payment page while autopay is taking that bill, or may have taken it', /autopayBusy/.test(read('src/app/api/portal/renter/route.ts')) && /if \(inv\.autopayUnconfirmed === true\)/.test(read('src/app/api/portal/renter/route.ts')));
  check('the owner sees an unconfirmed autopay, is warned before recording, and can let them pay', /It didn’t go through: let them pay/.test(rp) && /Check your Stripe payments before recording another payment/.test(rp));
  check('a charge still processing is unconfirmed, not a decline; the nightly skips only a bill that already exists', /unconfirmed = intent\.status === 'processing'/.test(read('src/app/api/cron/autopay-leases/route.ts')) && /Number\(e\?\.code\) === 6/.test(nightly));
  check('the catch-up uses the one rule and approved leave', /dueDatesBetween/.test(read('src/lib/rent-cycle.ts')) && /rentUnderLeave/.test(read('src/lib/rent-cycle.ts')));
  check('autopay no longer has its own due-day rule', !/function isDueToday/.test(read('src/app/api/cron/autopay-leases/route.ts')));
  check('editing a renter never sends an empty value the database refuses', /linkedStaffId: renterForm\.linkedStaffId \|\| null/.test(read('src/app/(app)/booths/page.tsx')));
  const portal = read('src/app/rent/[tenantId]/page.tsx');
  check('a personal link decides who is signed in, even with a session on the phone', /if \(new URLSearchParams\(window\.location\.search\)\.get\('rt'\)\) return null;/.test(portal) && !/if \(typeof window === 'undefined' \|\| session\?\.token\) return;\n    const rt/.test(portal));

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
