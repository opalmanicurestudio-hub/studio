// Checks the Bank screen (design board "Bank: lines to sort, sorted for you, matched"; components/money/BankScreen,
// api/plaid):
//   Match to a sale — a bank line matched to what's in the books already: one line or several that add up to it, money
//                     the same way, in the same books, never one matched to another bank line; nothing new is booked.
//                     The line the bank feed said was the same, a little different, takes the bank's amount (not in a
//                     closed month).
//   Change          — a line the app sorted, put under another category: its books line changes and its payee follows;
//                     never in a closed month.
//   Payees          — fixing a payee's category fixes its past lines, never a closed month's.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/bank-screen.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, strictTransactions, FV, check, failures } from './fake-db';
import * as B from '../../src/lib/books-summary';

const db: any = strictTransactions(makeDb());
const actor = { type: 'user', id: 'u1', name: 'Jo' };
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor, tenant: {} }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
process.env.PLAID_CLIENT_ID = 'x'; process.env.PLAID_SECRET = 'y';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const T = 'tenants/t1';

(async () => {
  const { POST } = await import('../../src/app/api/plaid/route');
  const call = async (body: any) => (await POST({ json: async () => ({ tenantId: 't1', ...body }), headers: { get: () => null } } as any)) as any;
  // (The route's own checks: the owner's only; tenants/t1 is the business.)
  await db.doc(T).set({ name: 'North Loft', timezone: 'America/New_York' });
  const line = (id: string, x: any) => db.doc(`${T}/bankTransactions/${id}`).set({ id, status: 'unmatched', context: 'Business', date: '2026-11-23', ...x });
  const txn = (id: string, x: any) => db.doc(`${T}/transactions/${id}`).set({ id, context: 'Business', date: '2026-11-20T15:00:00.000Z', ...x });

  console.log('match to a sale');
  await line('z1', { name: 'Zelle from Ana Ruiz', direction: 'in', amountCents: 8500 });
  await txn('s1', { type: 'income', category: 'Service Revenue', amount: 85, description: 'Gel manicure, Ana Ruiz', paymentMethod: 'Zelle' });
  const before = (await db.collection(`${T}/transactions`).get()).size;
  const r1 = await call({ action: 'resolve', bankTxnId: 'z1', mode: 'match', ledgerTxnIds: ['s1'] });
  check('money in matched to the sale it’s for: the bank line is that sale’s money, and nothing new is booked', r1.body.ok && (await get(`${T}/bankTransactions/z1`))?.status === 'matched' && (await get(`${T}/bankTransactions/z1`))?.matchedTxnId === 's1'
    && (await get(`${T}/transactions/s1`))?.reconciled === true && (await get(`${T}/transactions/s1`))?.bankTransactionId === 'z1' && (await db.collection(`${T}/transactions`).get()).size === before, r1.body);
  check('…and once matched, it can’t be booked as well (on another device, or by Book all)', !(await call({ action: 'resolve', bankTxnId: 'z1', mode: 'create' })).body.ok && (await db.collection(`${T}/transactions`).get()).size === before
    && !(await call({ action: 'resolve', bankTxnId: 'z1', mode: 'ignore' })).body.ok && (await get(`${T}/bankTransactions/z1`))?.status === 'matched');
  await line('c1', { name: 'Mobile deposit', direction: 'in', amountCents: 25000 });
  await txn('v1', { type: 'income', category: 'Service Revenue', amount: 90 }); await txn('v2', { type: 'income', category: 'Service Revenue', amount: 160 }); await txn('v3', { type: 'income', category: 'Service Revenue', amount: 40 });
  const short = await call({ action: 'resolve', bankTxnId: 'c1', mode: 'match', ledgerTxnIds: ['v1', 'v3'] });
  check('several lines must add up to it exactly, and it says what they come to', !short.body.ok && /come to \$130\.00, and the bank line is \$250\.00/.test(short.body.error) && (await get(`${T}/bankTransactions/c1`))?.status === 'unmatched' && !(await get(`${T}/transactions/v1`))?.reconciled);
  const two = await call({ action: 'resolve', bankTxnId: 'c1', mode: 'match', ledgerTxnIds: ['v1', 'v2'] });
  check('…a check for two visits matches both', two.body.ok && JSON.stringify((await get(`${T}/bankTransactions/c1`))?.matchedTxnIds) === '["v1","v2"]' && (await get(`${T}/transactions/v2`))?.bankTransactionId === 'c1');
  await line('c2', { name: 'Deposit', direction: 'in', amountCents: 9000 });
  check('a line matched to another bank line already can’t be matched again', !(await call({ action: 'resolve', bankTxnId: 'c2', mode: 'match', ledgerTxnIds: ['v1'] })).body.ok);
  await txn('x1', { type: 'expense', category: 'Supplies', amount: 90 }); await txn('p1', { type: 'income', category: 'Service Revenue', amount: 90, context: 'Personal' });
  const wrongWay = await call({ action: 'resolve', bankTxnId: 'c2', mode: 'match', ledgerTxnIds: ['x1'] }); const otherBooks = await call({ action: 'resolve', bankTxnId: 'c2', mode: 'match', ledgerTxnIds: ['p1'] });
  check('…nor money the other way, nor a line in the other books', !wrongWay.body.ok && /only a sale/.test(wrongWay.body.error) && !otherBooks.body.ok && /other books/.test(otherBooks.body.error));
  await line('pz', { name: 'Zelle from Mia', direction: 'in', amountCents: 9000, context: 'Personal' });
  check('a client paying the owner’s personal account for a visit: it says to Skip it, the sale is in the books already', /Skip this line: the sale is in your books already/.test((await call({ action: 'resolve', bankTxnId: 'pz', mode: 'match', ledgerTxnIds: ['v3'] })).body.error || ''));
  check('a bank line sorted already isn’t matched again', !(await call({ action: 'resolve', bankTxnId: 'z1', mode: 'match', ledgerTxnIds: ['v3'] })).body.ok);
  // Never money that didn't move, nor a card sale (its money comes in with the card payout).
  await txn('card1', { type: 'income', category: 'Service Revenue', amount: 90, paymentMethod: 'Card (Stripe)' }); await txn('disc1', { type: 'expense', category: 'Discounts', amount: 12, taxBucket: 'adjustment' });
  await txn('fee1', { type: 'expense', category: 'Processing Fee', taxBucket: 'processing_fee', amount: 12 }); await line('o12', { name: 'Debit', direction: 'out', amountCents: 1200 });
  const card = await call({ action: 'resolve', bankTxnId: 'c2', mode: 'match', ledgerTxnIds: ['card1'] }); const disc = await call({ action: 'resolve', bankTxnId: 'o12', mode: 'match', ledgerTxnIds: ['disc1'] }); const cfee = await call({ action: 'resolve', bankTxnId: 'o12', mode: 'match', ledgerTxnIds: ['fee1'] });
  check('never a card sale for money in, a discount or a card fee for money out: none of them is money in the bank', !card.body.ok && /paid by card/.test(card.body.error) && !disc.body.ok && /isn’t money that moved/.test(disc.body.error) && !cfee.body.ok && /card payouts/.test(cfee.body.error));
  // A visit paid by check: its sale, its tax and its tip, together; and a line kept in cents.
  await txn('vs', { type: 'income', category: 'Service Revenue', amount: 100, checkoutSessionId: 'co1', paymentMethod: 'Check' }); await txn('vt', { type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 8, checkoutSessionId: 'co1', paymentMethod: 'Check' });
  await txn('vg', { type: 'income', category: 'Tips', taxBucket: 'gratuity', checkoutSessionId: 'co1', paymentMethod: 'Check', amountCents: 2000 }); await line('chk', { name: 'Check deposit', direction: 'in', amountCents: 12800 });
  const visit = await call({ action: 'resolve', bankTxnId: 'chk', mode: 'match', ledgerTxnIds: ['vs', 'vt', 'vg'] });
  check('a visit’s sale, tax and tip match one check together (a line kept in cents counts as its cents)', visit.body.ok && (await get(`${T}/transactions/vg`))?.bankTransactionId === 'chk', visit.body);
  await line('pend', { name: 'Target', direction: 'out', amountCents: 1200, pending: true }); await txn('pc', { type: 'expense', category: 'Supplies', amount: 12 });
  const pm = await call({ action: 'resolve', bankTxnId: 'pend', mode: 'match', ledgerTxnIds: ['pc'] }); const pb = await call({ action: 'resolve', bankTxnId: 'pend', mode: 'create' });
  check('a line still pending at the bank is never matched or booked: it waits until it clears', !pm.body.ok && /pending/.test(pm.body.error) && !pb.body.ok && /pending/.test(pb.body.error) && !(await get(`${T}/transactions/pc`))?.reconciled);

  console.log('the same as one in the books, a little different');
  await line('n1', { name: 'Target', direction: 'out', amountCents: 3842, suggestedMatchTxnId: 'e1' });
  await txn('e1', { type: 'expense', category: 'Supplies', amount: 38, description: 'Target' });
  const near = await call({ action: 'resolve', bankTxnId: 'n1', mode: 'match', ledgerTxnIds: ['e1'] });
  check('a cost logged by hand takes the bank’s amount', near.body.ok && (await get(`${T}/transactions/e1`))?.amount === 38.42 && (await get(`${T}/transactions/e1`))?.amountWas === 38 && !(await get(`${T}/transactions/bankdiff_n1`)), near.body);
  await line('n2', { name: 'City Power', direction: 'out', amountCents: 9120, suggestedMatchTxnId: 'e2' });
  await txn('e2', { type: 'expense', category: 'Utilities', amount: 88.4, relatedBillInstanceId: 'bill1', description: 'City Power' });
  const linked = await call({ action: 'resolve', bankTxnId: 'n2', mode: 'match', ledgerTxnIds: ['e2'] }); const d2 = await get(`${T}/transactions/bankdiff_n2`);
  check('a cost linked to a bill keeps its amount, and the rest is booked as its own line under the same category', linked.body.ok && (await get(`${T}/transactions/e2`))?.amount === 88.4 && d2?.amount === 2.8 && d2?.type === 'expense' && d2?.category === 'Utilities' && d2?.bankTransactionId === 'n2', d2);
  await line('n3', { name: 'Venmo from Lee', direction: 'in', amountCents: 9560, suggestedMatchTxnId: 's3' }); await txn('s3', { type: 'income', category: 'Service Revenue', amount: 98.5, description: 'Pedicure, Lee', paymentMethod: 'Venmo' });
  const askLess = await call({ action: 'resolve', bankTxnId: 'n3', mode: 'match', ledgerTxnIds: ['s3'] });
  check('a sale paid a little short: it asks why, a fee taken or they paid less', !askLess.body.ok && askLess.body.ask === 'short' && askLess.body.extraCents === -290);
  const less = await call({ action: 'resolve', bankTxnId: 'n3', mode: 'match', ledgerTxnIds: ['s3'], extra: 'fee' }); const d3 = await get(`${T}/transactions/bankdiff_n3`);
  check('…a fee: the sale keeps its amount and the difference is a fee, so sales are never understated', less.body.ok && (await get(`${T}/transactions/s3`))?.amount === 98.5 && d3?.category === 'Processing Fee' && d3?.type === 'expense' && Math.abs(d3?.amount - 2.9) < 1e-9, d3);
  await line('n6', { name: 'Check deposit', direction: 'in', amountCents: 9000, suggestedMatchTxnId: 's6' }); await txn('s6', { type: 'income', category: 'Service Revenue', amount: 95, description: 'Lash lift, Bo', paymentMethod: 'Check' });
  await call({ action: 'resolve', bankTxnId: 'n6', mode: 'match', ledgerTxnIds: ['s6'], extra: 'less' }); const d6 = await get(`${T}/transactions/bankdiff_n6`);
  check('…they paid less: what wasn’t paid comes off the sale, as a discount', d6?.category === 'Discounts' && d6?.taxBucket === 'adjustment' && B.effectOf(d6).side === 'discounts', d6);
  await line('n7', { name: 'Mobile deposit', direction: 'in', amountCents: 10500, suggestedMatchTxnId: 's7' });
  await txn('s7', { type: 'income', category: 'Service Revenue', amount: 100, description: 'Acrylic set, Jo', checkoutSessionId: 'co7', paymentMethod: 'Check' }); await txn('s7t', { type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 5, checkoutSessionId: 'co7', paymentMethod: 'Check' });
  const whole = await call({ action: 'resolve', bankTxnId: 'n7', mode: 'match', ledgerTxnIds: ['s7'] });
  check('“It’s the same” on a sale takes its whole payment: a $105 check for a $100 visit and its $5 of tax matches both, nothing extra asked', whole.body.ok && (await get(`${T}/transactions/s7t`))?.bankTransactionId === 'n7' && !(await get(`${T}/transactions/bankdiff_n7`)), whole.body);
  await line('n4', { name: 'Zelle from Kim', direction: 'in', amountCents: 10500, suggestedMatchTxnId: 's4' }); await txn('s4', { type: 'income', category: 'Service Revenue', amount: 98, description: 'Gel fill, Kim', staffId: 'st1', paymentMethod: 'Zelle' });
  const ask = await call({ action: 'resolve', bankTxnId: 'n4', mode: 'match', ledgerTxnIds: ['s4'] });
  check('more than the sale came in: it asks what the extra was, never counting it as sales', !ask.body.ok && ask.body.ask === 'extra' && ask.body.extraCents === 700 && (await get(`${T}/bankTransactions/n4`))?.status === 'unmatched');
  await line('n8', { name: 'Zelle from Sam', direction: 'in', amountCents: 6600, suggestedMatchTxnId: 's8' }); await txn('s8', { type: 'income', category: 'Retail', amount: 60, description: 'Cuticle oil', paymentMethod: 'Zelle' });
  const noOne = await call({ action: 'resolve', bankTxnId: 'n8', mode: 'match', ledgerTxnIds: ['s8'], extra: 'tip' });
  check('…with nobody on the sale, it can’t be a tip for someone: it asks again, offering other money in', !noOne.body.ok && noOne.body.ask === 'extra' && noOne.body.tipOk === false && !(await get(`${T}/transactions/bankdiff_n8`)));
  const tip = await call({ action: 'resolve', bankTxnId: 'n4', mode: 'match', ledgerTxnIds: ['s4'], extra: 'tip' }); const d4 = await get(`${T}/transactions/bankdiff_n4`);
  check('…a tip: booked as a tip for whoever did the visit', tip.body.ok && d4?.category === 'Tips' && d4?.taxBucket === 'gratuity' && d4?.amount === 7 && d4?.staffId === 'st1' && (await get(`${T}/transactions/s4`))?.amount === 98, d4);
  await line('n5', { name: 'Deposit', direction: 'in', amountCents: 850, suggestedMatchTxnId: 'tx5' }); await txn('tx5', { type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 8, paymentMethod: 'Cash' });
  check('never a tax line or a tip on its own, a little different', !(await call({ action: 'resolve', bankTxnId: 'n5', mode: 'match', ledgerTxnIds: ['tx5'] })).body.ok && (await get(`${T}/transactions/tx5`))?.amount === 8);

  console.log('undoing a match');
  const un = await call({ action: 'unmatch', bankTxnId: 'n1' });
  check('a match undone: its line as it was (its amount too), and the bank line back to sort', un.body.ok && (await get(`${T}/transactions/e1`))?.amount === 38 && (await get(`${T}/transactions/e1`))?.amountWas === undefined && !(await get(`${T}/transactions/e1`))?.reconciled
    && (await get(`${T}/bankTransactions/n1`))?.status === 'unmatched' && (await get(`${T}/bankTransactions/n1`))?.matchedTxnId === undefined, [un.body, await get(`${T}/transactions/e1`)]);
  const un2 = await call({ action: 'unmatch', bankTxnId: 'n2' });
  check('…its difference line goes with it', un2.body.ok && !(await get(`${T}/transactions/bankdiff_n2`)) && !(await get(`${T}/transactions/e2`))?.bankTransactionId);

  console.log('booking, changing a sorted line, and payees');
  await line('r1', { name: 'Sally Beauty refund', merchant: 'Sally Beauty', direction: 'in', amountCents: 2400, suggestedCategory: 'Supplies', suggestedType: 'expense', suggestedTaxBucket: 'operating_cost' });
  await call({ action: 'resolve', bankTxnId: 'r1', mode: 'create' }); const r1l = await get(`${T}/transactions/${(await get(`${T}/bankTransactions/r1`))?.matchedTxnId}`);
  check('money in booked under a cost’s category is money back on that cost, never a second cost', r1l?.type === 'income' && r1l?.category === 'Supplies' && ['cogs', 'opex'].includes(B.effectOf(r1l).side) && B.effectOf(r1l).amount === -24, B.effectOf(r1l));
  await line('w1', { name: 'Refund to Ana', direction: 'out', amountCents: 4000 });
  const wrongCat = await call({ action: 'resolve', bankTxnId: 'w1', mode: 'create', categoryOverride: 'Service Revenue' });
  check('money out is never booked as a sale', !wrongCat.body.ok && /pick Refunds/.test(wrongCat.body.error) && (await get(`${T}/bankTransactions/w1`))?.status === 'unmatched');
  await line('pp', { name: 'Sally Beauty', merchant: 'Sally Beauty Supply', direction: 'out', amountCents: 5600, context: 'Personal', suggestedCategory: 'Supplies' });
  await call({ action: 'resolve', bankTxnId: 'pp', mode: 'create', contextOverride: 'Business' });
  check('a personal card’s line booked as the business’s teaches nothing: later lines from that payee on the card still wait for her', !(await get(`${T}/vendorRules/personal:sally beauty supply`)) && !(await get(`${T}/vendorRules/business:sally beauty supply`)));
  await line('u1', { name: 'Deposit', direction: 'in', amountCents: 3000, suggestedCategory: 'Uncategorized', suggestedTaxBucket: 'operating_cost', suggestedType: 'expense' });
  await line('u2', { name: 'Refund to Lee', direction: 'out', amountCents: 2000, suggestedCategory: 'Service Revenue', suggestedTaxBucket: 'revenue' });
  const all = await call({ action: 'accept-all' }); const u1l = await get(`${T}/transactions/${(await get(`${T}/bankTransactions/u1`))?.matchedTxnId}`);
  check('Book all: money in with no category is money in (never money back on a cost), and money out under a sale’s category waits for her', all.body.ok && u1l?.type === 'income' && u1l?.taxBucket === 'revenue' && B.effectOf(u1l).amount > 0
    && (await get(`${T}/bankTransactions/u2`))?.status === 'unmatched', [all.body, u1l]);
  await line('a1', { name: 'Gusto', merchant: 'Gusto', direction: 'out', amountCents: 214055, status: 'auto_categorized', matchedTxnId: 'g1', appliedRule: 'Payroll' });
  await txn('g1', { type: 'expense', category: 'Payroll', taxBucket: 'payroll', amount: 2140.55, clientOrVendor: 'Gusto', bankTransactionId: 'a1', paymentMethod: 'Bank feed' });
  const ch = await call({ action: 'recategorize', bankTxnId: 'a1', category: 'Contract Labor' });
  check('a line the app sorted, changed: its books line changes, its payee follows from now on, and it stays in Sorted for you to change again', ch.body.ok && (await get(`${T}/transactions/g1`))?.category === 'Contract Labor' && (await get(`${T}/vendorRules/business:gusto`))?.category === 'Contract Labor'
    && (await get(`${T}/bankTransactions/a1`))?.appliedRule === 'Contract Labor' && (await get(`${T}/bankTransactions/a1`))?.status === 'auto_categorized', ch.body);
  check('…never to a sale’s category for money out', !(await call({ action: 'recategorize', bankTxnId: 'a1', category: 'Retail' })).body.ok && (await get(`${T}/transactions/g1`))?.category === 'Contract Labor');
  const S = await import('../../src/lib/books-close-server');
  await txn('old1', { type: 'expense', category: 'Payroll', amount: 2000, clientOrVendor: 'Gusto', bankTransactionId: 'a0', paymentMethod: 'Bank feed', date: '2026-10-15T15:00:00.000Z' });
  await line('a0', { name: 'Gusto', merchant: 'Gusto', direction: 'out', amountCents: 200000, status: 'auto_categorized', matchedTxnId: 'old1', date: '2026-10-15' });
  await txn('hand1', { type: 'expense', category: 'Contract Labor', amount: 300, clientOrVendor: 'Gusto', bankTransactionId: 'a9', paymentMethod: 'Business Credit Card' });
  await S.closeMonth(db, 't1', await get(T), '2026-10', 'Jo', Date.parse('2026-11-20T15:00:00Z'));
  const shut = await call({ action: 'recategorize', bankTxnId: 'a0', category: 'Contract Labor' });
  check('…never one in a closed month: it says to add a correction', !shut.body.ok && /October is closed/.test(shut.body.error) && (await get(`${T}/transactions/old1`))?.category === 'Payroll');
  const fix = await call({ action: 'rules-update', ruleId: 'business:gusto', category: 'Payroll', fixPast: true });
  check('fixing a payee fixes the lines booked from the bank, never a closed month’s, never one logged by hand', fix.body.ok && fix.body.fixed === 1 && (await get(`${T}/transactions/g1`))?.category === 'Payroll' && (await get(`${T}/transactions/old1`))?.taxBucket === undefined
    && (await get(`${T}/transactions/hand1`))?.category === 'Contract Labor', fix.body);
  await txn('e10', { type: 'expense', category: 'Supplies', amount: 10, description: 'Corner Hardware', date: '2026-10-20T15:00:00.000Z' }); await line('n10', { name: 'Corner Hardware', direction: 'out', amountCents: 1050, suggestedMatchTxnId: 'e10', date: '2026-10-21' });
  const closedNear = await call({ action: 'resolve', bankTxnId: 'n10', mode: 'match', ledgerTxnIds: ['e10'] }); const d10 = await get(`${T}/transactions/bankdiff_n10`);
  check('…a cost in a closed month keeps its amount, and the difference goes in today', closedNear.body.ok && (await get(`${T}/transactions/e10`))?.amount === 10 && d10?.amount === 0.5 && String(d10?.date) >= '2026-11', d10);

  console.log('the bank feed');
  {
    const P = await import('../../src/lib/plaid-sync');
    const day = (n: number) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
    await db.doc('tenants/t2').set({ name: 'Corner' }); await db.doc('tenants/t2/plaidItems/i1').set({ accessToken: 'ok', label: 'Business', institution: 'First Bank' });
    await db.doc('tenants/t2/plaidItems/i2').set({ accessToken: 'locked', label: 'Business', institution: 'Second Bank' });
    await db.doc('tenants/t2/bankTransactions/pend1').set({ id: 'pend1', status: 'unmatched', pending: true, direction: 'out', amountCents: 4200, date: day(2), context: 'Business' });
    await db.doc('tenants/t2/bankTransactions/pend2').set({ id: 'pend2', status: 'created', pending: true, direction: 'out', amountCents: 1500, date: day(2), context: 'Business', matchedTxnId: 'bk2' });
    await db.doc('tenants/t2/transactions/bk2').set({ id: 'bk2', type: 'expense', category: 'Supplies', amount: 15, bankTransactionId: 'pend2', date: `${day(2)}T12:00:00.000Z` });
    await db.doc('tenants/t2/bankTransactions/pend3').set({ id: 'pend3', status: 'unmatched', pending: true, direction: 'out', amountCents: 900, date: day(2), context: 'Business' });
    await db.doc('tenants/t2/transactions/sale9').set({ id: 'sale9', type: 'income', category: 'Service Revenue', amount: 60, paymentMethod: 'Card (Stripe)', date: `${day(1)}T12:00:00.000Z` });
    // (Matched while pending at $50 by an older check; it clears at $60 with the tip.)
    await db.doc('tenants/t2/bankTransactions/pend4').set({ id: 'pend4', status: 'matched', pending: true, direction: 'out', amountCents: 5000, date: day(2), context: 'Business', matchedTxnId: 'meal' });
    await db.doc('tenants/t2/transactions/meal').set({ id: 'meal', type: 'expense', category: 'Meals & Entertainment', amount: 50, reconciled: true, bankTransactionId: 'pend4', date: `${day(2)}T12:00:00.000Z` });
    await db.doc('tenants/t2/transactions/hw').set({ id: 'hw', type: 'expense', category: 'Supplies', amount: 31, date: `${day(1)}T12:00:00.000Z` });
    (globalThis as any).fetch = async (_url: string, init: any) => {
      const tok = JSON.parse(init?.body || '{}').access_token;
      if (tok === 'locked') return { ok: false, json: async () => ({ error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login required' }) };
      return { ok: true, json: async () => ({ added: [
        { transaction_id: 'post1', pending_transaction_id: 'pend1', pending: false, amount: 42, name: 'CORNER HARDWARE', date: day(1) },
        { transaction_id: 'post2', pending_transaction_id: 'pend2', pending: false, amount: 15, name: 'TARGET', date: day(1) },
        { transaction_id: 'in60', pending: false, amount: -60, name: 'MOBILE DEPOSIT', date: day(1) },
        { transaction_id: 'post4', pending_transaction_id: 'pend4', pending: false, amount: 60, name: 'BISTRO', date: day(1) },
        { transaction_id: 'pend5', pending: true, amount: 31, name: 'HARDWARE', date: day(0) },
      ], removed: [{ transaction_id: 'pend3' }], next_cursor: 'c2', has_more: false }) };
    };
    const r: any = await P.syncTenantBankFeed(db, 't2');
    check('an account asking to be signed in again is set aside and named; the others are still checked', JSON.stringify(r.needsLogin) === '["Second Bank"]' && (await get('tenants/t2/plaidItems/i2'))?.needsLogin === true && (await get('tenants/t2/plaidItems/i1'))?.cursor === 'c2', r);
    check('a pending line leaves the inbox when it clears (the line that cleared is sorted instead), or when the bank drops it', (await get('tenants/t2/bankTransactions/pend1'))?.status === 'cleared' && (await get('tenants/t2/bankTransactions/post1'))?.status === 'unmatched'
      && (await get('tenants/t2/bankTransactions/pend3'))?.status === 'cleared');
    check('…one sorted while pending carries over to the line that cleared, never booked twice', (await get('tenants/t2/bankTransactions/post2'))?.status === 'created' && (await get('tenants/t2/bankTransactions/post2'))?.matchedTxnId === 'bk2'
      && (await get('tenants/t2/transactions/bk2'))?.bankTransactionId === 'post2' && (await get('tenants/t2/bankTransactions/pend2'))?.status === 'cleared');
    check('a charge cleared at another amount than the one it was matched at while pending: that match is undone, and it waits with a note', (await get('tenants/t2/bankTransactions/post4'))?.status === 'unmatched' && /cleared at a different amount/.test((await get('tenants/t2/bankTransactions/post4'))?.hint || '')
      && !(await get('tenants/t2/transactions/meal'))?.reconciled && (await get('tenants/t2/bankTransactions/pend4'))?.status === 'cleared');
    check('a line still pending is never matched on its own, even at the same amount', (await get('tenants/t2/bankTransactions/pend5'))?.status === 'unmatched' && !(await get('tenants/t2/transactions/hw'))?.reconciled);
    check('a deposit the same as a card sale is never matched to it (the sale’s money comes with the card payout)', (await get('tenants/t2/bankTransactions/in60'))?.status === 'unmatched' && !(await get('tenants/t2/transactions/sale9'))?.reconciled);
    const st = await call({ tenantId: 't2', action: 'status' });
    check('the Bank screen hears which accounts are connected and which asks to sign in again, never their keys', st.body.ok && st.body.items.length === 2 && st.body.items.some((i: any) => i.needsLogin && i.institution === 'Second Bank') && !JSON.stringify(st.body).includes('locked'), st.body);
    // A busy shop: thousands of cash sales in the books, and a deposit that matches none of them.
    await db.doc('tenants/t3').set({ name: 'Busy' }); await db.doc('tenants/t3/plaidItems/i1').set({ accessToken: 'busy', label: 'Business' });
    for (let i = 0; i < 6000; i++) await db.doc(`tenants/t3/transactions/c${i}`).set({ id: `c${i}`, type: 'income', category: i % 3 ? 'Service Revenue' : 'Tax Collected', amount: 40 + (i % 50), paymentMethod: 'Cash', checkoutSessionId: `co${Math.floor(i / 3)}`, date: `${day(1 + (i % 100))}T12:00:00.000Z` });
    (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ added: Array.from({ length: 20 }, (_, i) => ({ transaction_id: `d${i}`, pending: false, amount: -(5000 + i * 137), name: 'MOBILE DEPOSIT', date: day(2) })), next_cursor: 'c9', has_more: false }) });
    const t0 = Date.now(); await P.syncTenantBankFeed(db, 't3'); const took = Date.now() - t0;
    check('a busy shop’s books are added up once per check, never again for every deposit (20 deposits against 6,000 lines)', took < 4000 && (await get('tenants/t3/plaidItems/i1'))?.cursor === 'c9', { took });
    // A check that stops after booking and matching but before its lines are written: started again, it picks up where it
    // was, never booking or matching twice.
    await db.doc('tenants/t4').set({ name: 'Stops' }); await db.doc('tenants/t4/plaidItems/i1').set({ accessToken: 'stop', label: 'Business' });
    await db.doc('tenants/t4/transactions/zs').set({ id: 'zs', type: 'income', category: 'Service Revenue', amount: 70, paymentMethod: 'Zelle', date: `${day(1)}T12:00:00.000Z` });
    (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ added: [
      { transaction_id: 'f1', pending: false, amount: 15, name: 'MONTHLY SERVICE FEE', date: day(1), personal_finance_category: { primary: 'BANK_FEES', detailed: 'BANK_FEES_OTHER_BANK_FEES', confidence_level: 'VERY_HIGH' } },
      { transaction_id: 'z70', pending: false, amount: -70, name: 'ZELLE FROM ROSA', date: day(1) }], next_cursor: 'c4', has_more: false }) });
    const realBatch = db.batch.bind(db); let failOnce = true;
    db.batch = () => { const b = realBatch(); if (!failOnce) return b; return { ...b, set: b.set, commit: async () => { failOnce = false; throw new Error('stopped'); } }; };
    const stopped = await P.syncTenantBankFeed(db, 't4').then(() => false, () => true);
    db.batch = realBatch;
    await db.doc('tenants/t4/private/bankSyncLock').set({ at: null });
    await P.syncTenantBankFeed(db, 't4');
    const booked = (await db.collection('tenants/t4/transactions').get()).docs.map((d: any) => d.data()).filter((t: any) => t.bankTransactionId === 'f1');
    check('a check stopped before writing its lines, started again: the bank fee is booked once and the Zelle still matches its sale', stopped && booked.length === 1 && (await get('tenants/t4/bankTransactions/f1'))?.status === 'auto_categorized'
      && (await get('tenants/t4/bankTransactions/z70'))?.status === 'matched' && (await get('tenants/t4/bankTransactions/z70'))?.matchedTxnId === 'zs' && (await get('tenants/t4/plaidItems/i1'))?.cursor === 'c4', { stopped, booked: booked.length, f1: (await get('tenants/t4/bankTransactions/f1'))?.status, cur: (await get('tenants/t4/plaidItems/i1'))?.cursor });
    const src = fs.readFileSync('src/lib/plaid-sync.ts', 'utf8');
    check('where the bank’s check got to is kept only once its lines are written', /cursors\.push\(\{ ref: item\.ref, cursor \}\)/.test(src) && src.indexOf('for (const c of cursors)') > src.lastIndexOf('await batch.commit()'));
    check('the feed claims each line before matching it: one the owner sorted meanwhile is left as she sorted it', /claimLedger\(hit\.id, btId\)/.test(src) && /claimWaiting\(w\.ref/.test(src) && /type: outflow \? 'expense' : 'income',\n\s+context: rule\.context/.test(src));
  }

  console.log('the screen');
  const scr = fs.readFileSync('src/components/money/BankScreen.tsx', 'utf8');
  check('three lists: to sort (each with a category picked), sorted for you, matched; and the payees you’ve sorted', /To sort/.test(scr) && /Each has a category picked\. Check it, then book it\./.test(scr) && /Sorted for you/.test(scr) && /Matched, nothing to do/.test(scr) && /Payees you’ve sorted/.test(scr));
  check('each line: Book, Match to a sale (or a cost), Skip, a receipt, the bill it pays, personal booked as the business’s; money in can be money back on a cost', /'Match to a sale' : 'Match to a cost'/.test(scr) && />Skip</.test(scr) && /Add a receipt/.test(scr) && /marks \$\{bt\.suggestedBillName\} paid/.test(scr) && /Book as the business’s/.test(scr) && /label="Money back on a cost"/.test(scr));
  check('matching picks lines (one payment’s sale, tax and tip as one, which can be split) that add up to the bank line, and only then can it be matched', /disabled=\{!!busy \|\| pickedCents !== Number\(bt\.amountCents\)\}/.test(scr) && /ledgerTxnIds: ids/.test(scr) && /saleOf\(t\)/.test(scr) && /with its \$\{/.test(scr) && /notBankMoney\(t, dir/.test(scr) && />Split</.test(scr));
  const BM = await import('../../src/lib/bank-match');
  check('one payment is one checkout paid one way: a deposit by Zelle at booking and the rest by check stay apart', BM.saleOf({ appointmentId: 'a1', paymentMethod: 'Zelle' }) !== BM.saleOf({ appointmentId: 'a1', checkoutSessionId: 'c1', paymentMethod: 'Check' })
    && BM.saleOf({ checkoutSessionId: 'c1', paymentMethod: 'Check' }) === BM.saleOf({ checkoutSessionId: 'c1', paymentMethod: 'check', category: 'Tips' }) && BM.saleOf({ checkoutSessionId: 'c1', paymentMethod: 'Cash' }) !== BM.saleOf({ checkoutSessionId: 'c1', paymentMethod: 'Check' }));
  check('the match sheet reads the week before it with lines of the same amount, and further back only when asked', /where\('amount', '==', cents \/ 100\), limit\(60\)/.test(scr) && /Look back two weeks/.test(scr) && /Look back six weeks/.test(scr));
  check('the lists change in place after what’s done here, and are read again on coming back, never after every tap', !/loadRecent\(\); \} return d;/.test(scr) && /visibilitychange/.test(scr) && /const patch = /.test(scr));
  check('a pending line waits until it clears; more or less than a sale came to is asked; a match can be undone', /Still pending at your bank\. It can be sorted once it clears\./.test(scr) && /What was the extra\?/.test(scr) && />A tip</.test(scr) && />They paid less</.test(scr) && /action: 'unmatch'/.test(scr));
  check('no bank yet says so; one asking to sign in again says so, with the way back in; payees are saved on purpose, or typed', /No bank connected yet\./.test(scr) && /asks you to sign in again/.test(scr) && /action: 'link-token', itemId: item\.id/.test(scr) && /Type your own/.test(scr) && /onClick=\{\(\) => saveRule\(rl\)\}/.test(scr));
  check('the screen keeps the house style', !/\buppercase\b|font-black|\{\/\*| · |[Cc]all us|[Cc]ontact us|\b(salon|stylist|booth|chair|studio)\b/.test(scr.replace(/replace\(\/ · \/g/, '')) && !/[\u{1F300}-\u{1FAFF}]/u.test(scr));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
