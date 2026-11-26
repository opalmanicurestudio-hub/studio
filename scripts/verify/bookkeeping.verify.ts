// Checks the bookkeeping audit: every way money moves lands in the books, in the right part of them, by itself.
// - Every category the app writes on its own is one the books know (lib/categories), so it's sorted and on the right
//   tax line; older spellings and the bank feed's old names are read as the category they mean.
// - Tuition refunds come off sales; sales tax paid to the state and loan payments are never expenses; lines with no
//   category are counted so they can be sorted.
// - The bank feed (lib/plaid-sync) uses the app's own categories, books a line on its own when the bank is sure and it
//   means the same for everyone (the owner's switch), matches card payouts and supplier orders paid later, and leaves
//   meals, taxes and anything unclear for the owner.
// - What a business pays for ClarityFlow is an expense in its books (api/stripe/billing-webhook), once.
// - A gift to a school is in its books as other income (lib/academy-funding), once.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/bookkeeping.verify.ts
import Module from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
class NR { status: number; body: any; constructor(body: any, init: any = {}) { this.body = body; this.status = init.status || 200; } static json(body: any, init?: any) { return new NR(body, init); } }
let nextEvent: any = null;
class FakeStripe { webhooks = { constructEvent: () => nextEvent }; constructor(..._a: any[]) {} }
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: NR, NextRequest: class {} };
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({ getUser: async () => ({ email: '' }) }) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/academy-compliance') return { appendAudit: async () => {} };
  if (request === '@/lib/academy-email') return { sendAcademyEmail: async () => ({ ok: true }) };
  if (request === '@/lib/notify') return { sendNotification: async () => ({ ok: true }), resolveFromAddress: () => 'x@example.com' };
  return load.call(this, request, ...rest);
};
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const SRC = path.resolve('src');

(async () => {
  const C = await import('../../src/lib/categories');
  const B = await import('../../src/lib/books-summary');

  console.log('every category the app writes is one the books know');
  // Each literal category written next to a books line, in every file that writes the books.
  const files: string[] = [];
  const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p); } };
  walk(path.join(SRC, 'lib')); walk(path.join(SRC, 'app', 'api'));
  // Not books lines: document and request kinds, the bills' own sample data, and kinds the books read by their type.
  const NOT_BOOKS = new Set(['sop', 'policy', 'equipment', 'space', 'software', 'cleaning', 'aftercare', 'starter', 'service_quality', 'safety', 'request', 'other', 'handbook',
    'category', 'prep', 'food', 'beverages', 'intake', 'housing', 'transportation', 'add-on', 'store credit', 'store credit applied', 'void', 'uncategorized', 'deposit kept as store credit']);
  const unknown = new Map<string, string>();
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    if (!/transactions/.test(s) || /financial-data\.ts$|data\.ts$/.test(f)) continue;
    for (const m of s.matchAll(/category: ?'([^']+)'/g)) {
      const name = m[1];
      if (NOT_BOOKS.has(name.toLowerCase())) continue;
      if (!C.findCategory(name)) unknown.set(name, path.relative(SRC, f));
    }
  }
  check('each one is in the category list (or another name for one), so it’s sorted and on the right tax line', unknown.size === 0, Object.fromEntries(unknown));
  check('older spellings and the bank feed’s old names read as the category they mean',
    C.canonicalCategory('Booth Rent Collected') === 'Booth Rent' && C.canonicalCategory('processing fees') === 'Processing Fee' && C.canonicalCategory('Maintenance & Repairs') === 'Repairs & Maintenance'
    && C.canonicalCategory('Loan Payments') === 'Loan Payment' && C.canonicalCategory('Day-Use Booking Revenue') === 'Space Rentals' && C.canonicalCategory('My own thing') === 'My own thing');
  check('…and land on the right Schedule C line', C.scheduleCFor('Maintenance & Repairs') === 'Line 21 — Repairs and maintenance' && C.scheduleCFor('Delivery App Fees') === C.scheduleCFor('Processing Fee')
    && C.scheduleCFor('Internet & Phone') === 'Line 25 — Utilities' && C.scheduleCFor('Professional Services') === 'Line 17 — Legal and professional services' && C.scheduleCFor('Something new') === 'Line 27a — Other expenses');
  check('the app’s own categories stay out of the pickers; the ones people type stay in', !C.categoriesFor('income').some((c) => c.name === 'Retainers') && C.categoriesFor('income', { withSystem: true }).some((c) => c.name === 'Retainers')
    && C.categoriesFor('expense').some((c) => c.name === 'Repairs & Maintenance') && C.categoriesFor('expense').some((c) => c.name === 'Sales Tax Paid'));

  console.log('each lands in the right part of the books');
  const L = (x: any) => ({ id: `l${Math.random()}`, date: '2026-11-10T12:00:00.000Z', context: 'Business', ...x });
  const s = B.booksSummary([
    L({ type: 'income', category: 'Service Revenue', taxBucket: 'revenue', amount: 1000 }),
    L({ type: 'income', category: 'Tuition', amount: 500 }),
    L({ type: 'expense', category: 'Tuition Refunds', amount: 200 }),
    L({ type: 'expense', category: 'Sales Tax Paid', taxBucket: 'tax_remitted', amount: 80 }),
    L({ type: 'expense', category: 'Loan Payments', taxBucket: 'operating_cost', amount: 300 }),
    L({ type: 'expense', category: 'Debt Repayment', amount: 50 }),
    L({ type: 'income', category: 'Donations', taxBucket: 'income', amount: 250 }),
    L({ type: 'income', category: 'Transfer', taxBucket: 'transfer', amount: 400 }),
    L({ type: 'expense', category: 'Uncategorized', taxBucket: 'operating_cost', amount: 45 }),
    L({ type: 'expense', category: 'Maintenance & Repairs', taxBucket: 'operating_cost', amount: 60 }),
    L({ type: 'income', category: 'Booth Rent Collected', amount: 700 }),
    L({ type: 'income', category: 'Booth Rent', taxBucket: 'revenue', amount: 300 }),
  ]);
  check('a tuition refund comes off sales, not an operating expense (old lines too: the books read them fresh)', s.returns === 200 && s.sales === 2500, s);
  check('sales tax paid to the state is kept apart: never an expense, and it doesn’t change what was collected', s.taxPaid === 80 && s.taxOwed === 0 && !s.byCategory.opex.some(([c]) => c === 'Sales Tax Paid'));
  check('paying back a loan and moving money between your accounts are transfers, never expenses (old bank lines too)', s.transfers === 750 && !s.byCategory.opex.some(([c]) => /loan|debt|transfer/i.test(c)), s.byCategory);
  check('a gift is other income, not a sale', s.otherIncome === 250);
  check('lines with no category are counted, so they can be sorted', s.unsorted.count === 1 && s.unsorted.amount === 45);
  check('the same category under two names adds up as one', s.byCategory.sales.some(([c, v]) => c === 'Booth Rent' && v === 1000) && s.byCategory.opex.some(([c, v]) => c === 'Repairs & Maintenance' && v === 60) && s.operatingExpenses === 105, s.byCategory);
  const R = await import('../../src/lib/report-builders');
  const tax = R.buildTaxSummaryHtml([L({ type: 'expense', category: 'Loan Payments', taxBucket: 'operating_cost', amount: 300 }), L({ type: 'expense', category: 'Maintenance & Repairs', amount: 60 }), L({ type: 'expense', category: 'Sales Tax Paid', taxBucket: 'tax_remitted', amount: 80 })],
    { from: '2026-11-01', to: '2026-11-30' } as any, 'USD', {});
  check('the tax summary names a loan paid back as not deductible, puts repairs on Line 21 and shows the tax paid', /Not deductible — loan principal/.test(tax) && /Line 21 — Repairs and maintenance/.test(tax) && /Sales tax paid to the state/.test(tax));

  console.log('the bank feed sorts what it can, and matches what’s already there');
  const P = await import('../../src/lib/plaid-sync');
  const g = (primary: string, detailed: string, name: string, conf = 'VERY_HIGH') => P.mapCategory(primary, name, detailed, conf);
  check('the bank’s categories become the app’s own', g('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_TELEPHONE', 'Verizon').category === 'Phone & Internet' && g('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_RENT', 'Oak Plaza').category === 'Rent & Lease'
    && g('LOAN_PAYMENTS', 'LOAN_PAYMENTS_OTHER_PAYMENT', 'SBA Loan').taxBucket === 'transfer' && g('GENERAL_SERVICES', 'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING', 'CPA Group').category === 'Professional Services'
    && g('GENERAL_SERVICES', 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', 'Gusto Payroll').category === 'Payroll' && g('', '', 'TX COMPTROLLER SALES TAX').category === 'Sales Tax Paid'
    && [...['Rent & Lease', 'Phone & Internet', 'Professional Services', 'Payroll', 'Loan Payment']].every((n) => !!C.findCategory(n)));
  check('sure enough to book only when the bank is sure and it’s a business cost by its nature; anything that can be personal, needs a choice or may be income waits',
    g('BANK_FEES', 'BANK_FEES_OTHER_BANK_FEES', 'Monthly fee').sure && !g('BANK_FEES', 'BANK_FEES_OTHER_BANK_FEES', 'Monthly fee', 'MEDIUM').sure && g('', '', 'GUSTO PAYROLL').sure
    && !g('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', 'City Power').sure && !g('GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_SUPERSTORES', 'Target').sure
    && !g('LOAN_PAYMENTS', 'LOAN_PAYMENTS_OTHER_PAYMENT', 'SBA Loan').sure && !g('TRANSFER_IN', 'TRANSFER_IN_ACCOUNT_TRANSFER', 'Zelle from Ana').sure
    && !g('FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT', 'Cafe').sure && !g('', '', 'TX COMPTROLLER SALES TAX').sure && !g('MEDICAL', 'MEDICAL_PHARMACIES', 'Pharmacy').sure && !g('', '', 'Something').sure
    && g('ENTERTAINMENT', 'ENTERTAINMENT_SPORTING_EVENTS', 'Stadium').category === 'Other');

  await db.doc('tenants/b1').set({ name: 'North Loft' });
  await db.doc('tenants/b1/plaidItems/i1').set({ accessToken: 'tok', label: 'Business' });
  await db.doc('tenants/b1/plaidItems/i2').set({ accessToken: 'tokP', label: 'Personal' });
  await db.doc('tenants/b1/vendorRules/business:sally beauty').set({ category: 'Supplies', taxBucket: 'operating_cost', type: 'expense' });
  const day = (n: number) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
  await db.doc('tenants/b1/stripePayouts/po_1').set({ id: 'po_1', stripePayoutId: 'po_1', amount: 1234.56, arrivalDate: `${day(2)}T00:00:00.000Z` });
  await db.doc('tenants/b1/transactions/po_order').set({ id: 'po_order', type: 'expense', context: 'Business', category: 'Supplies', amount: 210, paymentMethod: 'On Account', clientOrVendor: 'Sally Beauty Supply', description: 'Purchase Order: Sally Beauty Supply', date: `${day(30)}T12:00:00.000Z` });
  const bank = (id: string, x: any) => ({ transaction_id: id, date: day(1), pending: false, ...x });
  let feed: any[] = [];
  // (Each connected account's lines: the business's under its token, the personal one's under its own.)
  (globalThis as any).fetch = async (url: string, init: any) => {
    if (/\/transactions\/sync$/.test(String(url))) { const tok = JSON.parse(init?.body || '{}').access_token; const out = feed.filter((b) => (b.__tok || 'tok') === tok); feed = feed.filter((b) => !out.includes(b));
      return { ok: true, json: async () => ({ added: out.map(({ __tok, ...b }: any) => b), next_cursor: 'c', has_more: false }) }; }
    return { ok: true, json: async () => ({}) };
  };
  feed = [
    bank('b_payout', { amount: -1234.56, name: 'STRIPE TRANSFER', personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', confidence_level: 'VERY_HIGH' } }),
    bank('b_sally', { amount: 210, name: 'SALLY BEAUTY #1042', merchant_name: 'Sally Beauty', personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', confidence_level: 'HIGH' } }),
    bank('b_power', { amount: 88.4, name: 'CITY POWER', merchant_name: 'City Power', personal_finance_category: { primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', confidence_level: 'VERY_HIGH' } }),
    bank('b_lunch', { amount: 23.1, name: 'TACO SPOT', merchant_name: 'Taco Spot', personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT', confidence_level: 'VERY_HIGH' } }),
    bank('b_tax', { amount: 312, name: 'TX COMPTROLLER SALES TAX', personal_finance_category: { primary: 'GOVERNMENT_AND_NON_PROFIT', detailed: 'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT', confidence_level: 'HIGH' } }),
    bank('b_loan', { amount: 400, name: 'SBA LOAN PMT', personal_finance_category: { primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_OTHER_PAYMENT', confidence_level: 'HIGH' } }),
    bank('b_fee', { amount: 15, name: 'MONTHLY SERVICE FEE', personal_finance_category: { primary: 'BANK_FEES', detailed: 'BANK_FEES_OTHER_BANK_FEES', confidence_level: 'VERY_HIGH' } }),
    bank('b_gusto', { amount: 2140.55, name: 'GUSTO PAYROLL', merchant_name: 'Gusto', personal_finance_category: { primary: 'GENERAL_SERVICES', detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', confidence_level: 'MEDIUM' } }),
    // A draw: out of the business account, into the personal one the next day. A client's Zelle with no other side.
    bank('b_draw', { amount: 500, name: 'TRANSFER TO CHK 4421', account_id: 'acc_biz', personal_finance_category: { primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', confidence_level: 'VERY_HIGH' } }),
    { ...bank('p_draw', { amount: -500, name: 'TRANSFER FROM CHK 9910', account_id: 'acc_personal', personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', confidence_level: 'VERY_HIGH' } }), __tok: 'tokP' },
    bank('b_zelle', { amount: -85, name: 'ZELLE FROM ANA RUIZ', account_id: 'acc_biz', personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', confidence_level: 'VERY_HIGH' } }),
  ];
  const r1: any = await P.syncTenantBankFeed(db, 'b1');
  const bt = async (id: string) => get(`tenants/b1/bankTransactions/${id}`);
  const tx = async (id: string) => { const b: any = await bt(id); return b?.matchedTxnId ? get(`tenants/b1/transactions/${b.matchedTxnId}`) : null; };
  check('a card payout landing in the bank is matched to the payout: no inbox, no second line', (await bt('b_payout'))?.status === 'payout' && (await get('tenants/b1/stripePayouts/po_1'))?.bankTransactionId === 'b_payout', await bt('b_payout'));
  check('a supplier order booked when placed and paid a month later is matched, not booked again by the supplier’s rule', (await bt('b_sally'))?.status === 'matched' && (await bt('b_sally'))?.matchedTxnId === 'po_order' && (await get('tenants/b1/transactions/po_order'))?.reconciled === true, await bt('b_sally'));
  const fee: any = await tx('b_fee'), gusto: any = await tx('b_gusto');
  check('a business cost by its nature is booked on its own, as the app’s own category, marked as sorted by the app (a bank fee, a payroll run)',
    (await bt('b_fee'))?.status === 'auto_categorized' && fee?.category === 'Bank Fees' && fee?.autoCategorized === true && fee?.sortedBy === 'bank' && fee?.amount === 15
    && gusto?.category === 'Payroll' && gusto?.taxBucket === 'payroll', [fee, gusto]);
  check('a utility, a loan payment, a meal and a tax payment wait for the owner, each with the app’s own category suggested',
    (await bt('b_power'))?.status === 'unmatched' && (await bt('b_power'))?.suggestedCategory === 'Utilities'
    && (await bt('b_loan'))?.status === 'unmatched' && (await bt('b_loan'))?.suggestedCategory === 'Loan Payment' && (await bt('b_loan'))?.suggestedTaxBucket === 'transfer'
    && (await bt('b_lunch'))?.status === 'unmatched' && (await bt('b_lunch'))?.suggestedCategory === 'Meals & Entertainment'
    && (await bt('b_tax'))?.status === 'unmatched' && (await bt('b_tax'))?.suggestedCategory === 'Sales Tax Paid' && (await bt('b_tax'))?.suggestedTaxBucket === 'tax_remitted');
  const draw: any = await tx('b_draw');
  check('money moved from the business account to her personal one is matched to its other side and booked as an owner draw (never an expense)',
    (await bt('b_draw'))?.status === 'own_transfer' && (await bt('b_draw'))?.pairedWith === 'p_draw' && (await get('tenants/b1/bankTransactions/p_draw'))?.status === 'own_transfer'
    && draw?.category === 'Distribution' && draw?.taxBucket === 'transfer' && draw?.amount === 500 && B.effectOf(draw).side === 'transfer', [await bt('b_draw'), draw]);
  check('a “transfer” with no other side on her accounts (a client’s Zelle) waits for her: it may be a sale', (await bt('b_zelle'))?.status === 'unmatched' && (await bt('b_zelle'))?.suggestedCategory === 'Transfer');
  check('…and the totals say so', r1.matched === 4 && r1.autoBooked === 2 && r1.needsReview === 5, r1);
  // The other side arriving on a later sync: matched then, both ways.
  feed = [bank('b_mv', { amount: 300, name: 'TRANSFER TO SAVINGS', account_id: 'acc_biz', personal_finance_category: { primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', confidence_level: 'VERY_HIGH' } })];
  await P.syncTenantBankFeed(db, 'b1');
  check('…one whose other side hasn’t arrived yet waits', (await bt('b_mv'))?.status === 'unmatched');
  feed = [{ ...bank('p_mv', { amount: -300, name: 'TRANSFER FROM BUSINESS', account_id: 'acc_personal', personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', confidence_level: 'VERY_HIGH' } }), __tok: 'tokP' }];
  await P.syncTenantBankFeed(db, 'b1');
  const mv: any = await bt('b_mv');
  check('…and is matched, with the draw booked on the business side, when the other side comes in', mv?.status === 'own_transfer' && mv?.pairedWith === 'p_mv' && (await get(`tenants/b1/transactions/${mv?.matchedTxnId}`))?.category === 'Distribution'
    && (await bt('p_mv'))?.status === 'own_transfer', mv);

  // A Profit First draw she booked on the Money page, then the money moving: matched to hers, never a second draw.
  await db.doc('tenants/b1/transactions/pf_draw').set({ id: 'pf_draw', type: 'expense', context: 'Business', category: 'Distribution', taxBucket: 'transfer', amount: 750, paymentMethod: 'Distribution', date: `${day(2)}T12:00:00.000Z` });
  feed = [bank('b_pf', { amount: 750, name: 'TRANSFER TO CHK 4421', account_id: 'acc_biz', personal_finance_category: { primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', confidence_level: 'VERY_HIGH' } }),
    { ...bank('p_pf', { amount: -750, name: 'TRANSFER FROM BUSINESS', account_id: 'acc_personal', personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', confidence_level: 'VERY_HIGH' } }), __tok: 'tokP' },
    // Paying off the business card from business checking: a "loan payment" out, a transfer into the card. Nothing to book.
    bank('b_card', { amount: 1200, name: 'PAYMENT TO CARD 0088', account_id: 'acc_biz', personal_finance_category: { primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', confidence_level: 'VERY_HIGH' } }),
    bank('c_card', { amount: -1200, name: 'PAYMENT THANK YOU', account_id: 'acc_card', personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', confidence_level: 'VERY_HIGH' } })];
  const before = (await db.collection('tenants/b1/transactions').get()).size;
  await P.syncTenantBankFeed(db, 'b1');
  check('a draw she already booked herself is matched when the money moves, never booked again', (await bt('b_pf'))?.status === 'own_transfer' && (await bt('b_pf'))?.matchedTxnId === 'pf_draw' && (await get('tenants/b1/transactions/pf_draw'))?.reconciled === true);
  check('paying off a card from checking pairs with the card’s line, and nothing is booked (both accounts are the business’s)', (await bt('b_card'))?.status === 'own_transfer' && (await bt('c_card'))?.status === 'own_transfer'
    && (await db.collection('tenants/b1/transactions').get()).size === before, { before, after: (await db.collection('tenants/b1/transactions').get()).size });
  // A pending line waiting in the inbox isn't paired (its posted line comes with a new id).
  await db.doc('tenants/b1/bankTransactions/b_pend').set({ id: 'b_pend', status: 'unmatched', pending: true, direction: 'out', amountCents: 6000, date: day(1), accountId: 'acc_biz', plaidCategory: 'TRANSFER_OUT', context: 'Business' });
  feed = [{ ...bank('p_pend', { amount: -60, name: 'TRANSFER IN', account_id: 'acc_personal', personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', confidence_level: 'VERY_HIGH' } }), __tok: 'tokP' }];
  await P.syncTenantBankFeed(db, 'b1');
  check('a pending line waiting in the inbox isn’t paired', (await bt('b_pend'))?.status === 'unmatched' && (await bt('p_pend'))?.status === 'unmatched');

  await db.doc('tenants/b1').set({ automations: { bankAutoSort: false } }, { merge: true });
  feed = [bank('b_power2', { amount: 91.2, name: 'MONTHLY SERVICE FEE', personal_finance_category: { primary: 'BANK_FEES', detailed: 'BANK_FEES_OTHER_BANK_FEES', confidence_level: 'VERY_HIGH' } }),
    bank('b_sally2', { amount: 64, name: 'SALLY BEAUTY #1042', merchant_name: 'Sally Beauty', personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', confidence_level: 'HIGH' } })];
  const r2: any = await P.syncTenantBankFeed(db, 'b1');
  check('with the owner’s switch off, nothing is booked on its own (not even by a learned rule): every line waits', (await bt('b_power2'))?.status === 'unmatched' && (await bt('b_sally2'))?.status === 'unmatched' && r2.autoBooked === 0, r2);
  const SW = await import('../../src/lib/automation-switches');
  check('the switch is on the Automations page, on unless turned off', SW.AUTOMATION_SWITCHES.some((x: any) => x.id === 'bank-sort' && x.field === 'automations.bankAutoSort' && x.defaultOn === true && x.who === 'you')
    && SW.automationOn({}, 'bank-sort') && !SW.automationOn({ automations: { bankAutoSort: false } }, 'bank-sort'));

  console.log('money already in the books, arriving at the bank');
  {
    const AO = await import('../../src/lib/app-orders');
    await db.doc('tenants/b3').set({ name: 'Corner Cafe', appOrders: { on: true, apps: ['doordash', 'ubereats', 'grubhub'], money: { doordash: { feePct: 20 }, ubereats: { feePct: 25 }, grubhub: { feePct: 20 } } } });
    await db.doc('tenants/b3/plaidItems/i1').set({ accessToken: 'tok3', label: 'Business' });
    const lastWeek = AO.payoutWeek(new Date(Date.now() - 8 * 86400e3).toISOString().slice(0, 10));
    const wk = (app: string) => `tenants/b3/private/${AO.appWeekId(app, lastWeek)}`;
    await db.doc(wk('doordash')).set({ app: 'doordash', label: 'DoorDash', week: lastWeek, orders: 12, grossCents: 51540, feeCents: 10308, payoutCents: 41232 });
    await db.doc(wk('ubereats')).set({ app: 'ubereats', label: 'Uber Eats', week: lastWeek, orders: 10, grossCents: 40000, feeCents: 10000, payoutCents: 30000 });
    const opened = (n: number) => new Date(Date.now() - n * 86400e3).toISOString();
    await db.doc('tenants/b3/tillSessions/d0').set({ status: 'closed', openedAt: opened(20), closedAt: opened(20), openingFloat: 100, expectedCash: 600, actualCash: 600 });
    await db.doc('tenants/b3/tillSessions/d1').set({ status: 'closed', openedAt: opened(6), closedAt: opened(6), openingFloat: 100, expectedCash: 542, actualCash: 540, totalPaidIn: 20 });
    await db.doc('tenants/b3/tillSessions/d2').set({ status: 'closed', openedAt: opened(5), closedAt: opened(5), openingFloat: 100, expectedCash: 300, actualCash: 300, totalDrops: 50 });
    await db.doc('tenants/b3/tillSessions/d3').set({ status: 'open', openedAt: opened(0), openingFloat: 100, expectedCash: 900 });
    feed = [{ ...bank('b_dd', { amount: -412.30, name: 'DOORDASH, INC. PAYOUT', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME', confidence_level: 'HIGH' } }), __tok: 'tok3' },
      { ...bank('b_ue1', { amount: -180, name: 'UBER EATS PAYOUT', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME', confidence_level: 'HIGH' } }), __tok: 'tok3' },
      { ...bank('b_cash', { amount: -600, name: 'DEPOSIT', personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_DEPOSIT', confidence_level: 'HIGH' } }), __tok: 'tok3' },
      { ...bank('b_cash2', { amount: -200, name: 'BRANCH DEPOSIT', personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_DEPOSIT', confidence_level: 'HIGH' } }), __tok: 'tok3' },
      { ...bank('b_etsy', { amount: -95, name: 'ETSY DEPOSIT', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME', confidence_level: 'HIGH' } }), __tok: 'tok3' }];
    const before3 = (await db.collection('tenants/b3/transactions').get()).size;
    await P.syncTenantBankFeed(db, 'b3');
    const b3 = async (id: string) => get(`tenants/b3/bankTransactions/${id}`);
    const dd: any = await get(wk('doordash')), ue1: any = await get(wk('ubereats'));
    check('a delivery app’s payout is matched to its week, and what it paid is filled in from the bank (the orders are in the books already)',
      (await b3('b_dd'))?.status === 'app_payout' && (await b3('b_dd'))?.matchedAppWeek === `doordash_${lastWeek}` && dd?.paidCents === 41230 && dd?.paidBy === 'Bank feed', [await b3('b_dd'), dd]);
    check('a week paid in pieces isn’t filled in partway (it would show short): what’s come in so far is kept on it', (await b3('b_ue1'))?.status === 'app_payout' && ue1?.bankCents === 18000 && ue1?.paidCents === undefined, ue1);
    check('cash taken at the drawers in the ten days before (less each opening float and any cash put in, plus cash taken to the safe) and then deposited is matched, never booked as income again', (await b3('b_cash'))?.status === 'cash_deposit');
    check('…a deposit bigger than what’s left of it waits, saying what it may be', (await b3('b_cash2'))?.status === 'unmatched' && /cash and checks taken lately/.test(String((await b3('b_cash2'))?.hint || '')));
    check('…and another company’s payout with “deposit” in its name is never taken for cash', (await b3('b_etsy'))?.status !== 'cash_deposit' && (await db.collection('tenants/b3/transactions').get()).size === before3);
    await db.doc(wk('ubereats')).set({ paidCents: 29000, paidBy: 'Dana' }, { merge: true });
    feed = [{ ...bank('b_ue2', { amount: -120, name: 'UBER EATS PAYOUT', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME', confidence_level: 'HIGH' } }), __tok: 'tok3' },
      { ...bank('b_cash3', { amount: -45, name: 'DEPOSIT', personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_DEPOSIT', confidence_level: 'HIGH' } }), __tok: 'tok3' },
      { ...bank('b_dd2', { amount: -900, name: 'DOORDASH PAYOUT', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME', confidence_level: 'HIGH' } }), __tok: 'tok3' }];
    await P.syncTenantBankFeed(db, 'b3');
    const ue2: any = await get(wk('ubereats'));
    check('the rest of a week paid in pieces adds to it; what a manager typed for the week is never replaced', (await b3('b_ue2'))?.status === 'app_payout' && ue2?.bankCents === 30000 && ue2?.paidCents === 29000 && ue2?.paidBy === 'Dana', ue2);
    check('the rest of the cash, deposited on a later day, is matched (deposits already matched count against it)', (await b3('b_cash3'))?.status === 'cash_deposit');
    check('an app payout that fits none of its weeks waits, saying its orders are in the books already (never income)', (await b3('b_dd2'))?.status === 'unmatched' && /delivery app payout/.test(String((await b3('b_dd2'))?.hint || '')) && (await b3('b_dd2'))?.suggestedCategory === 'Transfer');
    const AP = await import('../../src/lib/app-payouts-server');
    await db.doc(`tenants/b3/private/${AO.appWeekId('doordash', AO.payoutWeek(new Date(Date.now() - 22 * 86400e3).toISOString().slice(0, 10)))}`).set({ app: 'doordash', orders: 5, payoutCents: 20000, bankCents: 15000, bankLines: ['x'] });
    const settled = await AP.settleBankWeeks(db, 'b3', (await get('tenants/b3')));
    check('ten days after a week ended, what the bank paid of it is filled in, so the week shows short', settled === 1 && (await get(`tenants/b3/private/${AO.appWeekId('doordash', AO.payoutWeek(new Date(Date.now() - 22 * 86400e3).toISOString().slice(0, 10)))}`))?.paidCents === 15000);
    // Which week: the one it pays off exactly, else the week of the day before it came in, then older, then newer.
    const NC = await import('../../src/lib/night-close-server');
    const thisWk = AO.payoutWeek(NC.tonight(await get('tenants/b3'), new Date()));
    const gA = NC.addDays(thisWk, -14), gB = NC.addDays(thisWk, -7);
    const gw = (w: string) => `tenants/b3/private/${AO.appWeekId('grubhub', w)}`;
    await db.doc(gw(gA)).set({ app: 'grubhub', week: gA, orders: 10, payoutCents: 20000, bankCents: 15000, bankLines: ['g0'] });
    await db.doc(gw(gB)).set({ app: 'grubhub', week: gB, orders: 6, payoutCents: 10000 });
    const g1 = await AP.bankPayout(db, 'b3', await get('tenants/b3'), 'grubhub', 4000, 'g1', thisWk);
    check('a day’s payout goes to the week of the day before it came in, not an older week that came up short', g1?.week === gB && (await get(gw(gA)))?.bankCents === 15000 && (await get(gw(gB)))?.bankCents === 4000, [g1, await get(gw(gA)), await get(gw(gB))]);
    const g2 = await AP.bankPayout(db, 'b3', await get('tenants/b3'), 'grubhub', 6000, 'g2', NC.addDays(thisWk, 1));
    check('…and the rest of a week goes to the week it pays off, which is then filled in from the bank', g2?.week === gB && (await get(gw(gB)))?.paidCents === 10000 && (await get(gw(gB)))?.paidBy === 'Bank feed', [g2, await get(gw(gB))]);
    await db.doc(gw(gA)).set({ paidCents: 15000, paidBy: 'Dana', adjustedAt: new Date().toISOString(), adjustedCents: -5000 }, { merge: true });
    feed = [{ ...bank('b_gh', { amount: -50, name: 'GRUBHUB INC', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME', confidence_level: 'HIGH' } }), __tok: 'tok3' }];
    await db.doc('tenants/b3/vendorRules/business:grubhub inc').set({ category: 'Service Revenue', taxBucket: 'income', type: 'income' });
    const before4 = (await db.collection('tenants/b3/transactions').get()).size;
    await P.syncTenantBankFeed(db, 'b3');
    const gh: any = await b3('b_gh'), gAx: any = await get(gw(gA));
    check('money for a week whose difference was booked already goes to that week (not the next one), changes nothing, and waits as making up the difference',
      gh?.status === 'unmatched' && /booked already/.test(String(gh?.hint || '')) && gh?.suggestedCategory === 'Delivery App Adjustments' && gAx?.bankCents === 20000 && gAx?.paidCents === 15000 && (await get(gw(gB)))?.bankCents === 10000, [gh, gAx]);
    check('…and a payee rule never books an app’s money on its own', (await db.collection('tenants/b3/transactions').get()).size === before4);
    // Something small from the app taking a week's room before its payout: the payout takes the week back.
    const gD = NC.addDays(thisWk, -21), gE = NC.addDays(thisWk, -28);
    await db.doc(gw(gD)).set({ app: 'grubhub', week: gD, orders: 5, payoutCents: 8000 });
    feed = [{ ...bank('b_s1', { date: NC.addDays(gD, 8), amount: -12, name: 'GRUBHUB INC', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME', confidence_level: 'HIGH' } }), __tok: 'tok3' },
      { ...bank('b_s2', { date: NC.addDays(gD, 9), amount: -80, name: 'GRUBHUB INC', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME', confidence_level: 'HIGH' } }), __tok: 'tok3' }];
    await P.syncTenantBankFeed(db, 'b3');
    const gDx: any = await get(gw(gD));
    check('a payout that pays its week off on its own takes it back from a smaller line from the app that got there first, which goes back to her to sort',
      (await b3('b_s2'))?.status === 'app_payout' && gDx?.bankCents === 8000 && gDx?.paidCents === 8000 && (await b3('b_s1'))?.status === 'unmatched' && /not part of a payout/.test(String((await b3('b_s1'))?.hint || ''))
      && (await get(gw(gA)))?.bankCents === 20000, [await b3('b_s1'), await b3('b_s2'), gDx]);
    // An app line that fits no week is never matched to a sale; with app orders off, it's a line like any other.
    await db.doc('tenants/b3/transactions/sale33').set({ id: 'sale33', type: 'income', context: 'Business', category: 'Service Revenue', amount: 33, date: `${day(1)}T12:00:00.000Z` });
    feed = [{ ...bank('b_gx', { amount: -33, name: 'GRUBHUB INC', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME', confidence_level: 'HIGH' } }), __tok: 'tok3' }];
    await P.syncTenantBankFeed(db, 'b3');
    check('an app payout that fits none of its weeks is never matched to a sale of the same amount', (await b3('b_gx'))?.status === 'unmatched' && !(await b3('b_gx'))?.matchedTxnId);
    await db.doc('tenants/b3').set({ appOrders: { on: false } }, { merge: true });
    feed = [{ ...bank('b_gy', { amount: -33, name: 'GRUBHUB INC', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME', confidence_level: 'HIGH' } }), __tok: 'tok3' }];
    await P.syncTenantBankFeed(db, 'b3');
    check('…and once app orders are turned off, an app’s money that no week is waiting on is sorted like any other line', (await b3('b_gy'))?.status === 'matched' && (await b3('b_gy'))?.matchedTxnId === 'sale33' && !/delivery app/.test(String((await b3('b_gy'))?.hint || '')), await b3('b_gy'));
    await db.doc('tenants/b3').set({ appOrders: { on: true } }, { merge: true });
    // A second line the size of a week's payout never takes the week from the payout already on it.
    const gF = NC.addDays(thisWk, -35);
    await db.doc(gw(gF)).set({ app: 'grubhub', week: gF, orders: 5, payoutCents: 8000, bankCents: 8000, bankLines: ['f1'], paidCents: 8000, paidBy: 'Bank feed' });
    const gF2 = await AP.bankPayout(db, 'b3', await get('tenants/b3'), 'grubhub', 8000, 'f2', NC.addDays(gF, 8));
    check('a line the size of a week’s payout never takes a week the bank has paid in full', gF2?.week !== gF && JSON.stringify((await get(gw(gF)))?.bankLines) === '["f1"]', [gF2, await get(gw(gF))]);
    await db.doc(gw(gE)).set({ app: 'grubhub', week: gE, orders: 4, payoutCents: 20000, bankCents: 1000, bankLines: ['e1'] });
    await AP.settleBankWeeks(db, 'b3', await get('tenants/b3'));
    check('a week the bank paid under half of isn’t filled in as short (more may come, or it wasn’t the payout): it waits', (await get(gw(gE)))?.paidCents === undefined);
    feed = [bank('b_dd_other', { amount: -88, name: 'DOORDASH PAYOUT', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME', confidence_level: 'HIGH' } })];
    await P.syncTenantBankFeed(db, 'b1');
    check('a business that doesn’t take app orders here: an app’s money is sorted like any other line (it isn’t in its books yet)', (await bt('b_dd_other'))?.status === 'unmatched' && !/delivery app/.test(String((await bt('b_dd_other'))?.hint || '')) && (await bt('b_dd_other'))?.suggestedCategory !== 'Transfer', await bt('b_dd_other'));
    await db.doc('tenants/b3/private/bankSyncLock').set({ at: new Date().toISOString() });
    const locked = await P.syncTenantBankFeed(db, 'b3').then(() => null, (e: any) => String(e?.message || e));
    check('two checks of the bank at once never run together (the second is told to wait)', /being checked already/.test(String(locked)));
    await db.doc('tenants/b3/private/bankSyncLock').set({ at: null });
  }

  console.log('what a business pays for ClarityFlow');
  await db.doc('tenants/b2').set({ name: 'Harbor Nails', billing: { customerId: 'cus_9' } });
  process.env.STRIPE_BILLING_WEBHOOK_SECRET = 'whsec'; process.env.STRIPE_SECRET_KEY = 'sk';
  const W = await import('../../src/app/api/stripe/billing-webhook/route');
  const paid = { id: 'in_77', customer: 'cus_9', amount_paid: 4900, currency: 'usd', number: 'CF-0012', hosted_invoice_url: 'https://invoice.example/in_77', status_transitions: { paid_at: Math.floor(Date.now() / 1000) } };
  const hook = async () => { nextEvent = { type: 'invoice.paid', data: { object: paid } }; return W.POST({ headers: { get: (h: string) => (h === 'stripe-signature' ? 'sig' : null) }, text: async () => '{}', nextUrl: { origin: 'https://app.example' } } as any); };
  await hook();
  const line: any = await get('tenants/b2/transactions/clarityflow_in_77');
  check('it’s a software expense in its own books, with the invoice as its receipt', line?.type === 'expense' && line?.category === 'Software & Subscriptions' && line?.amount === 49 && line?.receiptUrl === paid.hosted_invoice_url && line?.hasReceipt === true && line?.clientOrVendor === 'ClarityFlow', line);
  await db.doc('tenants/b2/transactions/clarityflow_in_77').set({ category: 'Software & Subscriptions', notes: 'mine' }, { merge: true });
  await hook();
  check('…once: a second notice leaves it as the owner left it', (await get('tenants/b2/transactions/clarityflow_in_77'))?.notes === 'mine');
  await db.doc('tenants/b2/plaidItems/i1').set({ accessToken: 'tok2', label: 'Business' });
  feed = [{ ...bank('b_cf', { amount: 49, name: 'CLARITYFLOW', merchant_name: 'ClarityFlow', personal_finance_category: { primary: 'GENERAL_SERVICES', detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', confidence_level: 'HIGH' } }), __tok: 'tok2' }];
  await P.syncTenantBankFeed(db, 'b2');
  check('…and the card line for it in the bank feed is matched to it, not booked again', (await get('tenants/b2/bankTransactions/b_cf'))?.matchedTxnId === 'clarityflow_in_77');
  const paid2 = { ...paid, id: 'in_78', number: 'CF-0013', hosted_invoice_url: 'https://invoice.example/in_78', status_transitions: { paid_at: Math.floor(Date.now() / 1000) - 9 * 86400 } };
  nextEvent = { type: 'invoice.paid', data: { object: paid2 } }; await W.POST({ headers: { get: (h: string) => (h === 'stripe-signature' ? 'sig' : null) }, text: async () => '{}', nextUrl: { origin: 'https://app.example' } } as any);
  feed = [{ ...bank('b_cf2', { amount: 49, name: 'CLARITYFLOW', merchant_name: 'ClarityFlow', personal_finance_category: { primary: 'GENERAL_SERVICES', detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', confidence_level: 'HIGH' } }), __tok: 'tok2' }];
  await P.syncTenantBankFeed(db, 'b2');
  check('…even when the card posts it a week after the invoice (never booked a second time by its name)', (await get('tenants/b2/bankTransactions/b_cf2'))?.matchedTxnId === 'clarityflow_in_78' && (await db.collection('tenants/b2/transactions').get()).size === 2);

  console.log('checks paid but never closed');
  const NC = await import('../../src/lib/night-close');
  const rep0: any = (NC as any).nightReport({ day: '2026-11-25', timeZone: 'America/New_York', sales: [], tables: [], adjustments: [], tills: [], tips: { mode: 'none', rows: [] }, items: [], checks: {},
    openPaid: { count: 2, cents: 18450, names: ['table 4', 'Rae Lin'] } });
  check('the night report says which checks have money taken but were never closed, and that they aren’t in the books yet', rep0.flags.some((f: string) => /2 checks with \$184\.50 paid were never closed \(table 4, Rae Lin\)\. They aren’t in your sales or your books until they’re closed\./.test(f)), rep0.flags);
  const NCS = fs.readFileSync('src/lib/night-close-server.ts', 'utf8');
  check('…found among the open tickets with a card share or a whole payment on them', /where\('status', 'in', \['partial', 'paid_waiting'\]\)/.test(NCS) && /nightReport\(\{ day, timeZone: b\.timeZone, openPaid,/.test(NCS));

  console.log('a gift to a school');
  await db.doc('tenants/s1').set({ name: 'North Loft Academy' });
  const F = await import('../../src/lib/academy-funding');
  const session = { id: 'cs_gift_1', payment_status: 'paid', amount_total: 5000, payment_intent: 'pi_g1', customer_details: { name: 'Rae Lin', email: 'rae@example.com' }, metadata: { type: 'academy_donation', fund: 'General fund', name: 'Rae Lin' } };
  await F.completeDonation('s1', session).catch(() => null);
  await F.completeDonation('s1', session).catch(() => null);
  const gift: any = await get('tenants/s1/transactions/donation_cs_gift_1');
  check('it’s in the school’s books as other income, once, with the donor and the payment', gift?.type === 'income' && gift?.category === 'Donations' && gift?.amount === 50 && gift?.clientOrVendor === 'Rae Lin' && gift?.stripePaymentIntentId === 'pi_g1'
    && B.effectOf(gift).side === 'other' && (await db.collection('tenants/s1/transactions').get()).size === 1, gift);

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
