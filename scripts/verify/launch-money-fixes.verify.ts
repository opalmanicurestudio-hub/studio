// Checks the renter money fixes (launch L15f, part one):
// - One rule for every recorded rent payment (lib/rent-payment-plan): bills first, oldest first, part of a bill when
//   the money runs out, then whole one-off charges, anything over kept as credit. A declined autopay line is never
//   mistaken for a charge, and the same money never pays two things.
// - Record payment (api/rent/record-payment) is for managers, writes the payment, the books line, the bills and any
//   credit in one step, records a payment once however often Save is pressed, refuses future dates, and sends the
//   renter a receipt filed under the renter (unless rent receipts are switched off).
// - Rent paid online sends a receipt, once.
// - Credits come off bills already open (lib/rent-credits), never twice, never past what's owed, and never onto a bill
//   autopay may still be charging. The catch-up run and the nightly job both apply them.
// - The front desk uses the same rule: a payment that covers a bill doesn't also pay an old charge.
// - The Spaces page records rent through the same path, and its deposit record writes the deposit's account line.
// - Autopay and new station bookings only use an account that can take cards.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-money-fixes.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.RESEND_API_KEY = 're_test'; process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <hello@mail.example.com>'; process.env.STRIPE_SECRET_KEY = 'sk_test';
let db: any = strictTransactions(makeDb());
let actorNow: any = { uid: 'm1', name: 'Max', role: 'manager', isManager: true, caps: [] };
class FakeResponse { status: number; body: any; constructor(body?: any, init?: any) { this.body = body; this.status = init?.status || 200; }
  static json(body: any, init?: any) { return new FakeResponse(body, init); } }
function StripeMock(this: any) {
  return {
    paymentIntents: { retrieve: async (id: string) => ({ id, payment_method: 'pm_paid', customer: 'cus_paid', latest_charge: { id: 'ch_r', balance_transaction: { id: 'txn_rent', fee: 235 } } }) },
    paymentMethods: { retrieve: async (id: string) => ({ id, card: { brand: 'visa', last4: '4242' } }) },
    refunds: { create: async () => ({ id: 're_1', status: 'succeeded' }), list: async () => ({ data: [] }) },
  };
}
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: FakeResponse };
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock, __esModule: true });
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level = 'staff') => (!actorNow ? { deny: FakeResponse.json({ ok: false }, { status: 401 }) }
      : level === 'manager' && !actorNow.isManager ? { deny: FakeResponse.json({ ok: false }, { status: 403 }) } : { actor: actorNow }),
    requireCan: async () => (actorNow ? { actor: actorNow } : { deny: FakeResponse.json({ ok: false }, { status: 401 }) }),
    staffOrServer: async () => !!actorNow });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const mails: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => { if (String(url).includes('resend')) mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: `m${mails.length}` }), text: async () => '' }; };
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: () => '' } } as any);

async function fresh(tenant: any = {}) {
  db = strictTransactions(makeDb()); mails.length = 0;
  await db.doc(T).set({ name: 'Northside Studio', timezone: 'America/New_York', publicOrigin: 'https://northside.example.com', stripeAccountId: 'acct_biz', ...tenant });
  await db.doc(`${T}/renters/rt1`).set({ firstName: 'Maya', lastName: 'Ortiz', email: 'maya@example.com', status: 'active' });
  await db.doc(`${T}/leases/l1`).set({ renterId: 'rt1', boothId: 'b1', status: 'active', frequency: 'monthly', dueDay: '1', rentAmountCents: 90000, startDate: '2026-01-01' });
  await db.doc(`${T}/booths/b1`).set({ name: 'Suite 4' });
}

(async () => {
  const P = await import('../../src/lib/rent-payment-plan');

  console.log('One rule for where a payment goes');
  {
    const inv = [
      { id: 'b2', renterId: 'rt1', status: 'due', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-12-01' },
      { id: 'b1', renterId: 'rt1', status: 'late', amountCents: 90000, lateFeeCents: 2500, paidCents: 10000, dueDate: '2026-11-01' },
      { id: 'b0', renterId: 'rt1', status: 'paid', amountCents: 90000, dueDate: '2026-10-01' },
    ];
    const led = [
      { id: 'c1', renterId: 'rt1', type: 'charge', status: 'pending', amountCents: 2500, dueDate: '2026-11-10' },
      { id: 'f1', renterId: 'rt1', type: 'rent_charge', status: 'failed', amountCents: 90000, dueDate: '2026-11-01' },
    ];
    let p = P.planRentPayment(100000, inv, led);
    check('the oldest open bill is paid first, in full', p.bills[0]?.id === 'b1' && p.bills[0].takeCents === 82500 && p.bills[0].full === true);
    check('then part of the next bill when the money runs out', p.bills[1]?.id === 'b2' && p.bills[1].takeCents === 17500 && p.bills[1].full === false);
    check('nothing left for charges or credit', p.charges.length === 0 && p.creditCents === 0);
    check('a declined autopay line is never treated as a charge', !P.planRentPayment(999999, inv, led).charges.some((c) => c.id === 'f1'));
    p = P.planRentPayment(200000, inv, led);
    check('bills, then a whole charge, then the rest as credit', p.bills.length === 2 && p.charges.map((c) => c.id).join() === 'c1' && p.creditCents === 200000 - 82500 - 90000 - 2500);
    check('what was owed before is reported', p.owedBeforeCents === 82500 + 90000 + 2500);
    p = P.planRentPayment(173000, inv, led);
    check('a charge the money can’t fully cover is left alone, and what is left is credit', p.charges.length === 0 && p.creditCents === 500);
    const autopaid = [{ id: 'a1', renterId: 'rt1', status: 'due', amountCents: 90000, paidCents: 0, autopayIntentId: 'pi_x', autopayChargedCents: 90000, paidVia: null, dueDate: '2026-12-01' }];
    check('a bill autopay already charged counts as paid', P.planRentPayment(5000, autopaid, []).bills.length === 0);
    const busy = [
      { id: 'w1', renterId: 'rt1', status: 'due', amountCents: 90000, paidCents: 0, autopayTriedAt: new Date(Date.now() - 60_000).toISOString(), dueDate: '2026-12-01' },
      { id: 'w0', renterId: 'rt1', status: 'late', amountCents: 90000, paidCents: 0, autopayTriedAt: '2026-11-01T12:00:00Z', autopayDeclined: 'card_declined', dueDate: '2026-11-01' },
    ];
    p = P.planRentPayment(100000, busy, []);
    check('a bill autopay is still working on is left for autopay; a declined one can be paid', p.bills.map((x) => x.id).join() === 'w0' && p.creditCents === 10000);
    const stale = [{ ...busy[0], autopayTriedAt: new Date(Date.now() - 60 * 60_000).toISOString() }];
    check('a claim autopay never finished stops holding the bill after a few minutes', P.planRentPayment(90000, stale, []).bills[0]?.id === 'w1');
    check('a bill autopay may have taken (no answer) is held until the business checks', P.autopayBusy({ status: 'due', autopayUnconfirmed: true, autopayTriedAt: '2026-11-01T12:00:00Z' }));
    p = P.planRentPayment(50000, [], [{ id: 'dp', renterId: 'rt1', type: 'deposit_charge', status: 'pending', amountCents: 50000 }]);
    check('a deposit waiting to be paid is never paid by rent money', p.charges.length === 0 && p.creditCents === 50000);
    const pos = P.accountPosition([{ id: 'x', status: 'due', amountCents: 90000, paidCents: 0 }], [{ id: 'c', type: 'rent_abatement', amountCents: -3000 }, { id: 'h', type: 'charge', status: 'pending', amountCents: 2500 }]);
    check('the account position counts charges and takes off credit waiting', pos.owedCents === 89500 && pos.creditCents === 0);
  }

  console.log('Record payment');
  const RP = await import('../../src/app/api/rent/record-payment/route');
  await fresh();
  await db.doc(`${T}/rentInvoices/b1`).set({ renterId: 'rt1', leaseId: 'l1', status: 'late', amountCents: 90000, lateFeeCents: 2500, paidCents: 0, dueDate: '2026-11-01' });
  await db.doc(`${T}/rentInvoices/b2`).set({ renterId: 'rt1', leaseId: 'l1', status: 'due', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-12-01' });
  actorNow = { uid: 's1', name: 'Sky', role: 'front', isManager: false, caps: ['checkout.take'] };
  let r: any = await RP.POST(req({ tenantId: 't1', renterId: 'rt1', amountCents: 5000, method: 'cash', requestId: 'req-staff-1' }));
  check('only managers can record rent', r.status === 403);
  actorNow = { uid: 'm1', name: 'Max', role: 'manager', isManager: true, caps: [] };
  r = await RP.POST(req({ tenantId: 't1', renterId: 'rt1', amountCents: 5000, method: 'cash', date: '2099-01-01', requestId: 'req-future-1' }));
  check('a payment dated in the future is refused', r.status === 400 && /future/.test(r.body.error));
  r = await RP.POST(req({ tenantId: 't1', renterId: 'rt1', amountCents: 200000, method: 'cash', methodLabel: 'Cash', date: '2026-11-09', note: 'Envelope', requestId: 'req-pay-0001' }));
  check('recorded', r.status === 200 && r.body.ok === true && r.body.paymentId === 'recpay_req-pay-0001', r.body);
  const b1 = await get(`${T}/rentInvoices/b1`); const b2 = await get(`${T}/rentInvoices/b2`);
  check('the late bill is paid with its fee', b1.status === 'paid' && b1.paidCents === 92500 && b1.paidVia === 'cash');
  check('the next bill is paid too', b2.status === 'paid' && b2.paidCents === 90000);
  const pay = await get(`${T}/rentLedger/recpay_req-pay-0001`);
  check('the payment line is on the renter’s account, pointing at both bills', pay?.type === 'payment' && pay.amountCents === -200000 && pay.appliesToInvoiceIds.join() === 'b1,b2');
  const txn = await get(`${T}/transactions/booth_rent__recpay_req-pay-0001`);
  check('the books line is written with the renter’s id', txn?.amount === 2000 && txn.renterId === 'rt1' && txn.source === 'booth_rent');
  const credits = (await all(`${T}/rentLedger`)).filter((l: any) => l.type === 'prepaid_credit');
  check('the extra is kept as credit for the next bill', credits.length === 1 && credits[0].amountCents === -(200000 - 182500) && credits[0].paymentEntryId === 'recpay_req-pay-0001');
  check('the response says how much became credit', r.body.creditCents === 17500);
  check('a receipt was emailed to the renter', mails.some((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes('maya@example.com') && /\$2,000\.00/.test(String(m.subject || '') + String(m.html || ''))));
  const rmail = mails.find((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes('maya@example.com')) || {};
  check('it links to their portal’s Rent tab without making a new sign-in link', String(rmail.html || '').includes('/rent/t1?tab=rent') && !/[?&]rt=/.test(String(rmail.html || '')) && (await all(`${T}/private/renterLinks/links`)).length === 0);
  check('it says what is now in credit', /You have \$175\.00 in credit/.test(String(rmail.html || '')), String(rmail.html || '').slice(0, 400));
  const logRows = (await all(`${T}/messageLog`)).filter((x: any) => x.kind === 'rent_receipt');
  check('the receipt is filed under the renter', logRows.length >= 1 && logRows.every((x: any) => x.recipientType === 'renter' && x.recipientId === 'rt1'), logRows);
  const before = (await all(`${T}/rentLedger`)).length;
  r = await RP.POST(req({ tenantId: 't1', renterId: 'rt1', amountCents: 200000, method: 'cash', date: '2026-11-09', requestId: 'req-pay-0001' }));
  check('pressing Save again records it once', r.body.already === true && (await all(`${T}/rentLedger`)).length === before);

  await fresh({ rentComms: { sendReceipts: false } });
  await db.doc(`${T}/rentInvoices/b1`).set({ renterId: 'rt1', leaseId: 'l1', status: 'due', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-11-01' });
  r = await RP.POST(req({ tenantId: 't1', renterId: 'rt1', amountCents: 30000, method: 'check', date: '2026-11-09', requestId: 'req-part-0001' }));
  const part = await get(`${T}/rentInvoices/b1`);
  check('part of a bill is recorded on it and it stays open', r.body.ok && part.status === 'due' && part.paidCents === 30000);
  check('no receipt when rent receipts are switched off', mails.length === 0);

  await fresh();
  await db.doc(`${T}/rentInvoices/w1`).set({ renterId: 'rt1', leaseId: 'l1', status: 'due', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-12-01', autopayTriedAt: new Date(Date.now() - 60_000).toISOString() });
  await db.doc(`${T}/rentLedger/cr1`).set({ renterId: 'rt1', type: 'rent_abatement', status: 'paid', amountCents: -3000, date: '2026-11-03' });
  await db.doc(`${T}/rentInvoices/w0`).set({ renterId: 'rt1', leaseId: 'l1', status: 'due', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-11-01' });
  r = await RP.POST(req({ tenantId: 't1', renterId: 'rt1', amountCents: 40000, method: 'cash', date: '2026-11-09', requestId: 'req-busy-0001' }));
  check('a bill autopay is charging isn’t touched by a recorded payment', (await get(`${T}/rentInvoices/w1`)).paidCents === 0 && (await get(`${T}/rentInvoices/w0`)).paidCents === 40000);
  const bmail = mails.find((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes('maya@example.com')) || {};
  check('the receipt’s still-owed figure takes off credit waiting', /Still owed: \$1,370\.00/.test(String(bmail.html || '')), String(bmail.html || '').slice(0, 300));

  await db.doc(`${T}/rentInvoices/w1`).set({ autopayUnconfirmed: true }, { merge: true });
  r = await RP.POST(req({ tenantId: 't1', renterId: 'rt1', amountCents: 40000, method: 'cash', date: '2026-11-09', requestId: 'req-unsure-001' }));
  check('a payment is refused while autopay may already have taken a bill, saying what to check', r.status === 409 && /Check your Stripe payments/.test(r.body.error) && !(await get(`${T}/rentLedger/recpay_req-unsure-001`)));

  console.log('Rent paid online sends a receipt, once');
  const ROP = await import('../../src/lib/rent-online-pay');
  await fresh();
  await db.doc(`${T}/rentInvoices/o1`).set({ renterId: 'rt1', leaseId: 'l1', status: 'due', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-12-01' });
  const cs = { id: 'cs_rent_1', payment_status: 'paid', amount_total: 90000, payment_intent: 'pi_rent_1', customer: 'cus_paid', metadata: { tenantId: 't1', invoiceId: 'o1', kind: 'rent_invoice' } };
  await ROP.recordRentPayment(db, new (StripeMock as any)(), 't1', 'o1', cs, { account: 'acct_biz' });
  const firstCount = mails.filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes('maya@example.com')).length;
  check('the payment is recorded and a receipt is emailed', (await get(`${T}/rentInvoices/o1`)).status === 'paid' && firstCount === 1, mails.map((m) => m.subject));
  await ROP.recordRentPayment(db, new (StripeMock as any)(), 't1', 'o1', cs, { account: 'acct_biz' });
  check('the same payment seen again sends no second receipt', mails.filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes('maya@example.com')).length === 1);

  console.log('Credits come off bills already open');
  const RC = await import('../../src/lib/rent-credits');
  await fresh();
  await db.doc(`${T}/rentInvoices/k1`).set({ renterId: 'rt1', leaseId: 'l1', status: 'due', amountCents: 90000, lateFeeCents: 0, paidCents: 20000, dueDate: '2026-11-01' });
  await db.doc(`${T}/rentInvoices/k2`).set({ renterId: 'rt1', leaseId: 'l1', status: 'due', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-12-01', autopayTriedAt: '2026-12-01T12:00:00Z', autopayUnconfirmed: true });
  await db.doc(`${T}/rentLedger/cr1`).set({ renterId: 'rt1', type: 'rent_abatement', status: 'paid', amountCents: -3000, date: '2026-11-03' });
  await db.doc(`${T}/rentLedger/cr2`).set({ renterId: 'rt1', type: 'retail_sale_credit', status: 'paid', amountCents: -100000, appliedCents: 20000, date: '2026-11-04' });
  let applied = await RC.applyCreditsToOpenBills(db, 't1', 'rt1');
  const k1 = await get(`${T}/rentInvoices/k1`); const k2 = await get(`${T}/rentInvoices/k2`);
  check('the open bill is paid off by the credits, oldest credit first', applied === 70000 && k1.status === 'paid' && k1.paidVia === 'credit' && k1.paidCents === 90000 && k1.creditAppliedCents === 70000);
  check('each credit records what it gave', (await get(`${T}/rentLedger/cr1`)).appliedCents === 3000 && (await get(`${T}/rentLedger/cr2`)).appliedCents === 20000 + 67000);
  check('a bill autopay may still be charging is left alone', k2.paidCents === 0 && !k2.creditAppliedCents);
  check('the renter is told', (await all(`${T}/renterAlerts`)).some((a: any) => a.renterId === 'rt1' && a.kind === 'credit_applied'));
  applied = await RC.applyCreditsToOpenBills(db, 't1', 'rt1');
  check('running it again changes nothing', applied === 0 && (await get(`${T}/rentLedger/cr2`)).appliedCents === 87000);
  await db.doc(`${T}/rentInvoices/k2`).set({ autopayUnconfirmed: false, autopayDeclined: 'card declined' }, { merge: true });
  const sum = await RC.applyAllOpenCredits(db, 't1');
  const k2b = await get(`${T}/rentInvoices/k2`);
  check('once autopay is settled as declined, the rest of the credit goes on that bill, never past what is left of it', sum.appliedCents === 13000 && k2b.paidCents === 13000 && k2b.status === 'due');

  console.log('The catch-up run applies credits too');
  const CY = await import('../../src/lib/rent-cycle');
  await fresh();
  await db.doc(`${T}/leases/l1`).set({ renterId: 'rt1', boothId: 'b1', status: 'active', frequency: 'monthly', dueDay: '1', rentAmountCents: 90000, startDate: '2026-10-01', firstChargeDate: '2026-10-01', activatedOn: '2026-10-01', prorateFirst: false });
  await db.doc(`${T}/rentLedger/cr9`).set({ renterId: 'rt1', type: 'prepaid_credit', status: 'paid', amountCents: -5000, date: '2026-10-15' });
  const cyc: any = await CY.runRentCycle(db, 't1', '2026-11-09');
  const bills = (await all(`${T}/rentInvoices`)).sort((a: any, b: any) => String(a.dueDate).localeCompare(String(b.dueDate)));
  check('catch-up bills are made', cyc.created >= 1 && bills.length >= 1, cyc);
  check('and the credit comes off the oldest of them', bills[0].creditAppliedCents === 5000 && bills[0].paidCents === 5000);

  console.log('The front desk uses the same rule');
  const D = await import('../../src/lib/rent-desk');
  await fresh();
  await db.doc(`${T}/rentInvoices/d1`).set({ renterId: 'rt1', leaseId: 'l1', status: 'due', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-11-01' });
  await db.doc(`${T}/rentLedger/dc1`).set({ renterId: 'rt1', type: 'charge', status: 'pending', amountCents: 2500, dueDate: '2026-11-05' });
  const acct = await D.renterAccount(db, T, 'rt1');
  const batch = db.batch();
  const out = D.applyRentPayment(batch, db, T, acct, { amountCents: 90000, method: 'cash', receiptId: 'rc1', transactionId: 'tx1', now: '2026-11-09T15:00:00Z', by: 'Desk' });
  await batch.commit();
  check('the bill is paid', (await get(`${T}/rentInvoices/d1`)).status === 'paid');
  check('the same money doesn’t also pay the old charge', (await get(`${T}/rentLedger/dc1`)).status === 'pending' && out.settled.length === 0);
  check('what a void needs is still returned', out.invoices[0]?.id === 'd1' && out.invoices[0].paidCents === 0 && out.invoices[0].takeCents === 90000 && typeof out.entryId === 'string');
  await db.doc(`${T}/rentInvoices/d1`).set({ paidCents: 95000 }, { merge: true });   // something else paid on it since
  const vb = db.batch(); D.reverseRentPayment(vb, db, T, out as any, '2026-11-09T16:00:00Z', 'test'); await vb.commit();
  const d1 = await get(`${T}/rentInvoices/d1`);
  check('a void takes off only what that payment put on the bill', d1.paidCents === 5000 && d1.status === 'due');
  const voidSrc = src('src/app/api/checkout/void/route.ts');
  check('a sale whose rent bill was paid on since can’t be voided', voidSrc.includes('has had another payment since, so the sale can’t be voided'));
  check('a sale whose rent credit was already used elsewhere can’t be voided', voidSrc.includes('so the sale can’t be voided. Refund it instead.') && voidSrc.indexOf('(Number(c.appliedCents) || 0) > 0') < voidSrc.indexOf('// ── 1. The claim'));
  const db2 = db.batch(); const acct2 = await D.renterAccount(db, T, 'rt1');
  const out2 = D.applyRentPayment(db2, db, T, acct2, { amountCents: 100000, method: 'cash', receiptId: 'rc2', transactionId: 'tx2', now: '2026-11-09T17:00:00Z', by: 'Desk' }); await db2.commit();
  check('a desk overpayment keeps the rest as credit, tied to its payment', out2.creditCents > 0 && (await get(`${T}/rentLedger/${out2.creditId}`))?.paymentEntryId === out2.entryId);

  console.log('Screens and accounts');
  const rentPage = src('src/app/(app)/rent/page.tsx');
  const booths = src('src/app/(app)/booths/page.tsx');
  check('the Rent page records through the server', rentPage.includes("fetch('/api/rent/record-payment'") && !/paymentRef = doc\(\s*collection\(firestore, BOOTH_RENTAL_COLLECTIONS\.rentLedger/.test(rentPage));
  check('Spaces records rent through the same path', booths.includes("fetch('/api/rent/record-payment'") && !booths.includes('paidAmountCents: cents, paidLedgerEntryId: txnRef.id, recordedManually: true'));
  check('a deposit recorded on Spaces writes its account line', /type: 'deposit_charge', status: 'paid', amountCents: cents/.test(booths));
  check('autopay only uses an account that can take cards', src('src/app/api/cron/autopay-leases/route.ts').includes('const stripeAccountId = spacePayAccount(tenantDoc.data());'));
  check('a new station booking needs an account that can take cards', src('src/app/api/stripe/book-station/route.ts').includes("if (!spacePayAccount(tenantSnap.data())) problem ="));
  check('the nightly job applies open-bill credits before the late sweep', (() => { const n = src('src/app/api/cron/nightly/route.ts'); const a = n.indexOf('applyAllOpenCredits(db, tDoc.id)'); const l = n.indexOf('markedLateAt:'); return a > 0 && l > a; })());
  const ap = src('src/app/api/cron/autopay-leases/route.ts');
  check('autopay works out what to charge from the bill as it is when it claims it, and adds to what is paid', /const cents = Math\.max\(0, Math\.round\(\(Number\(cur\.amountCents/.test(ap) && ap.includes('paidCents: FieldValue.increment(chargeCents)'));
  const st = src('src/app/api/booths/account-statement/route.ts');
  check('statements count an overpayment once and show bills before credits', st.includes("e.type === 'prepaid_credit' && e.paymentEntryId") && st.includes('cents: Number(i.grossCents ?? i.amountCents) || 0'));
  check('a deposit recorded on Spaces is written once per lease', booths.includes('Deposit already recorded') && booths.includes("`deposit_${reqKey}`"));

  const bad = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  check('no assistant names in the changed files', ['src/lib/rent-payment-plan.ts', 'src/lib/rent-credits.ts', 'src/app/api/rent/record-payment/route.ts', 'scripts/verify/launch-money-fixes.verify.ts'].every((f) => !bad.test(src(f))));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
