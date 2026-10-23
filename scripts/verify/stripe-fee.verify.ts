// Checks the exact Stripe fee on a card payment is recorded once (lib/stripe-fee): from the approval notice when the
// money is already captured, from the capture notice or the card reader's own capture when it isn't (a card reader
// payment is approved first, so its approval notice has no fee yet), never twice whichever arrives first.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/stripe-fee.verify.ts
import { makeDb, check, failures } from './fake-db';

const T = 'tenants/t1';
let db = makeDb();
const stripe: any = { balanceTransactions: { retrieve: async (id: string) => ({ id, fee: 162, net: 4338, amount: 4500, fee_details: [{ type: 'stripe_fee', amount: 162, currency: 'usd' }] }) } };
const fees = async () => (await db.collection(`${T}/transactions`).get()).docs.map((d: any) => d.data()).filter((t: any) => t.category === 'Processing Fee');

(async () => {
  const { recordChargeFee } = await import('../../src/lib/stripe-fee');
  const reader = (x: any = {}) => ({ id: 'ch_1', created: 1760000000, payment_intent: 'pi_1', payment_method_details: { type: 'card_present' }, metadata: { tenantId: 't1', clientId: 'c1' }, ...x });

  let c = await recordChargeFee(db, stripe, 't1', 'acct_1', reader({ balance_transaction: null }));
  check('a reader payment only approved (not captured) has no fee yet: nothing is written', c === 0 && (await fees()).length === 0);
  c = await recordChargeFee(db, stripe, 't1', 'acct_1', reader({ balance_transaction: 'txn_1' }));
  let f = await fees();
  check('once captured, the exact fee is an expense line, marked as a card reader payment', c === 162 && f.length === 1 && f[0].amount === 1.62 && f[0].paymentMethod === 'Terminal (card present)' && f[0].stripePaymentIntentId === 'pi_1' && f[0].taxBucket === 'processing_fee');
  await recordChargeFee(db, stripe, 't1', 'acct_1', reader({ balance_transaction: { id: 'txn_1', fee: 162, net: 4338, amount: 4500, fee_details: [] } }));
  check('the capture and the notice both arriving still write it once', (await fees()).length === 1);

  db = makeDb();
  await db.doc(`${T}/transactions/old1`).set({ category: 'Processing Fee', stripeBalanceTxnId: 'txn_2', amount: 1.62 });
  await recordChargeFee(db, stripe, 't1', 'acct_1', reader({ id: 'ch_2', balance_transaction: 'txn_2' }));
  check('a fee written before (under another id) isn’t written again', (await fees()).length === 1);

  db = makeDb();
  await db.doc(`${T}/transactions/rev1`).set({ taxBucket: 'revenue', checkoutSessionId: 'cs_9', amount: 45 });
  await recordChargeFee(db, stripe, 't1', 'acct_1', { id: 'ch_3', created: 1760000000, balance_transaction: 'txn_3', payment_method_details: { type: 'card' }, metadata: { checkoutSessionId: 'cs_9' } });
  const rev: any = (await db.doc(`${T}/transactions/rev1`).get()).data();
  check('the sale line it belongs to gets the fee and the net', rev.stripeFeeAmountDollars === 1.62 && rev.stripeNetAmountDollars === 43.38 && rev.stripeChargeId === 'ch_3');
  const zero: any = { balanceTransactions: { retrieve: async () => ({ fee: 0, net: 4500, amount: 4500, fee_details: [] }) } };
  db = makeDb();
  c = await recordChargeFee(db, zero, 't1', 'acct_1', reader({ balance_transaction: 'txn_4' }));
  check('no fee, no line', c === 0 && (await fees()).length === 0);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
