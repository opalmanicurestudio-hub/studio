// Checks a deposit paid online (the booking page or a booking's pay link: lib/online-deposit) is recorded once: the
// booking marked paid, its credit and its income in one step, named after the payment, so a notice sent twice, or two at
// the same moment, records it once; a second payment for a deposit already paid is kept and flagged; a payment after the
// hold was released doesn't revive the booking; a balance collected with it clears in the same step.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/online-deposit.verify.ts
import { makeDb, check, failures, strictTransactions } from './fake-db';
import { recordOnlineDeposit, onlineDepositCreditId, onlineDepositIncomeId, onlineBalanceIncomeId } from '../../src/lib/online-deposit';
import { booksSummary } from '../../src/lib/books-summary';
import { isDepositCredit, storeCreditBalance } from '../../src/lib/credit-pools';

const T = 'tenants/t1';
let db: any;
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = (prefix: string) => [...db._store.entries()].filter(([p]: any) => p.startsWith(prefix)).map(([, d]: any) => d);
const booking = (x: any = {}) => ({ id: 'a1', clientId: 'c1', clientName: 'Maya Lopez', clientEmail: 'maya@example.com', serviceName: 'Gel fill', staffId: 's1',
  status: 'pending_payment', depositStatus: 'pending', depositAmountCents: 2500, checkInToken: 'tok1', ...x });
const fresh = async (x: any = {}, client: any = { name: 'Maya Lopez', outstandingBalance: 0 }) => {
  db = strictTransactions(makeDb());
  await db.doc(`${T}/appointments/a1`).set(booking(x));
  if (client) await db.doc(`${T}/clients/c1`).set(client);
};
const pay = (x: any = {}) => recordOnlineDeposit(db, 't1', { appointmentId: 'a1', sessionId: 'cs_1', paymentIntentId: 'pi_1', chargeId: 'ch_1', paidCents: 2500, via: 'online booking', ...x });

(async () => {
  console.log('the first notice');
  await fresh();
  let r: any = await pay();
  let a = await get(`${T}/appointments/a1`);
  const credit = await get(`${T}/depositCredits/${onlineDepositCreditId('pi_1', 'cs_1')}`);
  const income = await get(`${T}/transactions/${onlineDepositIncomeId('cs_1')}`);
  check('the booking is paid and confirmed', r && !r.already && a.status === 'confirmed' && a.depositStatus === 'paid' && a.depositAmountCents === 2500 && a.stripeCheckoutSessionId === 'cs_1' && a.depositStripePaymentIntentId === 'pi_1', a);
  check('one credit for the visit, a deposit (never store credit), named after the card payment', credit && credit.id === 'deposit_pi_1' && credit.amountCents === 2500 && credit.kind === 'deposit' && credit.sourceAppointmentId === 'a1' && isDepositCredit(credit) && storeCreditBalance([credit]) === 0, credit);
  check('one income line for $25.00, a deposit taken', income && income.amount === 25 && income.category === 'Retainers' && income.checkoutSessionId === 'cs_1' && all(`${T}/transactions/`).length === 1, income);
  check('her check-in page says it’s paid', (await get('appointmentCheckIns/tok1'))?.depositStatus === 'paid');
  check('in the books: $25.00 of sales', Math.abs(booksSummary(all(`${T}/transactions/`)).netSales - 25) < 0.001);

  console.log('the same notice again');
  r = await pay();
  check('a retried notice records nothing more', r?.already === true && all(`${T}/transactions/`).length === 1 && all(`${T}/depositCredits/`).length === 1, r);

  console.log('two at once');
  await fresh();
  const both: any[] = await Promise.all([pay(), pay()]);
  check('exactly one records it', both.filter((x) => x && !x.already).length === 1 && both.filter((x) => x?.already).length === 1, both.map((x) => x && (x.already ? 'already' : 'recorded')));
  check('one credit, one income line', all(`${T}/depositCredits/`).length === 1 && all(`${T}/transactions/`).length === 1);

  console.log('a payment without a card payment id');
  await fresh();
  r = await pay({ paymentIntentId: null });
  check('the credit is named after the payment page', !!(await get(`${T}/depositCredits/deposit_cs_cs_1`)) && (await pay({ paymentIntentId: null }))?.already === true && all(`${T}/depositCredits/`).length === 1);

  console.log('recorded the old way');
  await fresh();
  await db.doc(`${T}/transactions/old1`).set({ type: 'income', category: 'Retainers', amount: 25, checkoutSessionId: 'cs_1' });
  r = await pay();
  check('an income line for the same page from before: nothing more', r?.already === true && all(`${T}/depositCredits/`).length === 0 && all(`${T}/transactions/`).length === 1, r);

  console.log('paid twice');
  await fresh({ status: 'confirmed', depositStatus: 'paid', stripeCheckoutSessionId: 'cs_0' });
  r = await pay({ sessionId: 'cs_2', paymentIntentId: 'pi_2' });
  a = await get(`${T}/appointments/a1`);
  check('a second payment is kept: its own credit and income', r && r.twice === true && !!(await get(`${T}/depositCredits/deposit_pi_2`)) && (await get(`${T}/transactions/${onlineDepositIncomeId('cs_2')}`))?.secondDepositPayment === true, r);
  check('…and the booking is flagged for someone to refund one, its first deposit untouched', a.needsAttention === 'deposit_paid_twice' && a.stripeCheckoutSessionId === 'cs_0' && a.depositAmountCents === 2500, a);

  console.log('paid after the hold was released');
  await fresh({ status: 'cancelled' });
  r = await pay();
  a = await get(`${T}/appointments/a1`);
  check('the booking stays released and is flagged; the money is kept as its credit', r?.released === true && a.status === 'cancelled' && a.needsAttention === 'deposit_paid_after_hold_released' && (await get(`${T}/depositCredits/deposit_pi_1`))?.amountCents === 2500, a);

  console.log('a pay link');
  await fresh({ status: 'pending' });
  r = await pay({ via: 'pay link', confirmFrom: ['pending_payment', 'deposit_pending', 'pending'] });
  check('a booking waiting on its link is confirmed', (await get(`${T}/appointments/a1`)).status === 'confirmed' && (await get(`${T}/depositCredits/deposit_pi_1`))?.via === 'pay link');
  await fresh({ status: 'pending' });
  r = await pay();
  check('…a booking page payment leaves another status as it was', (await get(`${T}/appointments/a1`)).status === 'pending');

  console.log('no booking');
  db = strictTransactions(makeDb());
  check('a payment for a booking that isn’t there: nothing written', (await pay()) === null && all(`${T}/`).length === 0);

  console.log('a balance collected with the deposit');
  await fresh({ balanceCollectCents: 1000 }, { name: 'Maya Lopez', outstandingBalance: 10, unpaidFees: [{ cents: 1000 }] });
  r = await pay({ paidCents: 3500 });
  a = await get(`${T}/appointments/a1`);
  let c = await get(`${T}/clients/c1`);
  const bal = await get(`${T}/transactions/${onlineBalanceIncomeId('cs_1')}`);
  check('$35.00 paid: $10.00 clears what she owed, the deposit is $25.00', r.cents === 2500 && r.balanceCents === 1000 && (await get(`${T}/depositCredits/deposit_pi_1`))?.amountCents === 2500 && a.depositAmountCents === 2500, r);
  check('…in the same step: her balance is cleared and the fee is in the books', c.outstandingBalance === 0 && Array.isArray(c.unpaidFees) && c.unpaidFees.length === 0 && bal?.amount === 10 && bal?.category === 'Fee Recovery' && a.balanceCollectedCents === 1000 && !!a.balanceCollectedAt, { c, bal });
  check('…all $35.00 in the books once', Math.abs(all(`${T}/transactions/`).reduce((s: number, t: any) => s + t.amount, 0) - 35) < 0.001 && all(`${T}/transactions/`).length === 2);
  r = await pay({ paidCents: 3500 });
  c = await get(`${T}/clients/c1`);
  check('…retried: her balance isn’t cleared twice', r?.already === true && c.outstandingBalance === 0 && all(`${T}/transactions/`).length === 2);
  await fresh({ balanceCollectCents: 1000 }, { name: 'Maya Lopez', outstandingBalance: 30 });
  const two: any[] = await Promise.all([pay({ paidCents: 3500 }), pay({ paidCents: 3500 })]);
  c = await get(`${T}/clients/c1`);
  check('…two at once: $10.00 comes off once ($20.00 still owed)', two.filter((x) => x && !x.already).length === 1 && c.outstandingBalance === 20 && all(`${T}/transactions/`).length === 2, c);
  await fresh({ balanceCollectCents: 1000, clientId: null }, null);
  r = await pay({ paidCents: 3500 });
  check('no client on the booking: all of it is the deposit, nothing lost', r.cents === 3500 && r.balanceCents === 0 && (await get(`${T}/depositCredits/deposit_pi_1`))?.amountCents === 3500 && all(`${T}/transactions/`).length === 1);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('online-deposit ok');
})();
