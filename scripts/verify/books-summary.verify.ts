// scripts/verify/books-summary.verify.ts — the one reading of the ledger the Money page and the printed reports share.
import { booksSummary, effectOf, lookupOf, netSalesOf } from '../../src/lib/books-summary';
import { refundTipPart, refundTaxPart } from '../../src/lib/refund-tax';
let f = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { f++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const eq = (a: number, b: number) => Math.abs(a - b) < 0.001;
let i = 0; const L = (x: any) => ({ id: x.id || `t${++i}`, date: '2026-10-01T12:00:00Z', context: 'Business', ...x });

// A desk checkout: service, retail, tax, a tip, a discount, a deposit applied; the card fee.
const sale = L({ id: 'sale', type: 'income', category: 'Service Revenue', taxBucket: 'revenue', amount: 80, checkoutSessionId: 's1' });
const desk = [
  sale,
  L({ type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 20, checkoutSessionId: 's1' }),
  L({ id: 'tax1', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 1.6, checkoutSessionId: 's1' }),
  L({ type: 'income', category: 'Tips', taxBucket: 'gratuity', amount: 15, checkoutSessionId: 's1' }),
  L({ id: 'disc', type: 'expense', category: 'Discounts', taxBucket: 'adjustment', amount: 10, checkoutSessionId: 's1' }),
  L({ type: 'expense', category: 'Deposit Applied', taxBucket: 'adjustment', amount: 25, checkoutSessionId: 's1' }),
  L({ type: 'expense', category: 'Processing Fee', taxBucket: 'processing_fee', amount: 3.2 }),
];
let s = booksSummary(desk);
ok(eq(s.sales, 100) && eq(s.discounts, 35) && eq(s.netSales, 65), 'desk sale: sales, discounts and deposits applied, net sales', s);
ok(eq(s.tips, 15) && eq(s.taxCollected, 1.6) && eq(s.taxOwed, 1.6), 'tips and tax kept apart from sales', s);
ok(eq(s.income, 80) && eq(s.netFees, 3.2) && eq(s.net, 76.8), 'income includes the tips (their pay includes them); net after fees', s);
ok(s.salesCount === 1, 'one checkout is one sale for the average ticket', s.salesCount);

// Money held or moved is never income: gift cards sold, money for renters, a payout landing in the bank, owner draws.
s = booksSummary([
  L({ type: 'income', category: 'Gift Card Sales', taxBucket: 'transfer', amount: 50 }),
  L({ type: 'income', category: 'Collected for renter', taxBucket: 'pass_through', amount: 70 }),
  L({ type: 'income', category: 'Tips collected for renter', taxBucket: 'pass_through', amount: 10 }),
  L({ type: 'income', category: 'Stripe Payout', taxBucket: 'transfer', amount: 400 }),
  L({ type: 'expense', category: 'Distribution', taxBucket: 'transfer', amount: 100 }),
  L({ type: 'expense', category: 'Transfer Out', taxBucket: 'transfer', amount: 30 }),
]);
ok(eq(s.sales, 0) && eq(s.net, 0) && eq(s.giftCardsSold, 50) && eq(s.heldForRenters, 80) && eq(s.transfers, 530 - 0), 'held and transfers stay out of income and costs', s);

// An online order: sale, shipping charged, tax; postage bought and partly refunded; then a refund with its tax part.
const online = [
  L({ id: 'osale_A', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 40, retailOrderId: 'A' }),
  L({ id: 'oship_A', type: 'income', category: 'Shipping Charged', taxBucket: 'revenue', amount: 8, retailOrderId: 'A' }),
  L({ id: 'otax_A', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 3.2, retailOrderId: 'A' }),
  L({ type: 'expense', category: 'Shipping', taxBucket: 'expense', amount: 6.5 }),
  L({ type: 'income', category: 'Shipping', taxBucket: 'refund', amount: 1.5 }),
  L({ type: 'expense', category: 'Refunds', taxBucket: 'refund', amount: 21.6, taxRefunded: 1.6, retailOrderId: 'A' }),
];
s = booksSummary(online);
ok(eq(s.sales, 48) && eq(s.shippingCharged, 8) && eq(s.returns, 20) && eq(s.netSales, 28), 'online: shipping charged is a sale of its own; the refund is a return without its tax', s);
ok(eq(s.taxCollected, 3.2) && eq(s.taxRefunded, 1.6) && eq(s.taxOwed, 1.6), 'the refund lowers the tax owed by its tax part', s);
ok(eq(s.shippingCost, 5) && eq(s.operatingExpenses, 5), 'postage less its refund is the shipping cost', s);
ok(s.salesCount === 1, 'an online order is one sale', s.salesCount);

// Voids undo each line where it was: the sale is a return, the tax comes off the tax owed, a discount comes back off.
const voids = [
  ...desk.slice(0, 3), desk[4],
  L({ type: 'expense', category: 'Void', taxBucket: 'refund', amount: 80, voidOf: 'sale' }),
  L({ type: 'expense', category: 'Void', taxBucket: 'refund', amount: 1.6, voidOf: 'tax1' }),
  L({ type: 'income', category: 'Void', taxBucket: 'refund', amount: 10, voidOf: 'disc' }),
];
s = booksSummary(voids);
ok(eq(s.returns, 80) && eq(s.discounts, 0) && eq(s.taxOwed, 0) && eq(s.taxRefunded, 1.6), 'voids land on what they undid', s);
ok(eq(s.netSales, 20), 'only the retail line is left in net sales', s.netSales);
// The same voids, written with what they undo (voidType / voidCategory / voidTaxBucket), with the originals not loaded.
s = booksSummary([
  L({ type: 'expense', category: 'Void', taxBucket: 'refund', amount: 1.6, voidOf: 'gone', voidType: 'income', voidCategory: 'Tax Collected', voidTaxBucket: 'tax_collected' }),
  L({ type: 'income', category: 'Void', taxBucket: 'refund', amount: 25, voidOf: 'gone2', voidType: 'expense', voidCategory: 'Deposit Applied', voidTaxBucket: 'adjustment' }),
]);
ok(eq(s.taxOwed, -1.6) && eq(s.discounts, -25) && eq(s.returns, 0), 'a void says what it undid when the original is outside the period', s);

// Reversals: of a sale (a return), of an expense (that expense down), of a refund (the return undone), of tax.
const sup = L({ id: 'sup', type: 'expense', category: 'Supplies', taxBucket: 'operating_cost', amount: 30 });
const rent = L({ id: 'rent', type: 'expense', category: 'Rent & Lease', taxBucket: 'operating_cost', amount: 900 });
const ref = L({ id: 'ref', type: 'expense', category: 'Refunds', taxBucket: 'refund', amount: 10.8, taxRefunded: 0.8 });
s = booksSummary([
  L({ type: 'reversal', category: 'Refunds', amount: 30, reversalOf: 'sale' }),
  L({ type: 'reversal', category: 'Supplies', amount: 30, reversalOf: 'sup' }),
  L({ type: 'reversal', category: 'Rent & Lease', taxBucket: 'operating_cost', amount: 900, reversalOf: 'rent' }),
  L({ type: 'reversal', category: 'Refunds', amount: 10.8, reversalOf: 'ref' }),
  L({ type: 'reversal', category: 'Refunds', amount: 1.6, reversalOf: 'tax1' }),
], { lookup: [sale, sup, rent, ref, desk[2]] });
ok(eq(s.returns, 30 - 10), 'a refund of a sale is a return; reversing a refund takes it (less its tax) back off', s);
ok(eq(s.cogs, -30) && eq(s.operatingExpenses, -900), 'reversed expenses come off their own lines', s);
ok(eq(s.taxRefunded, 1.6 - 0.8) && eq(s.taxOwed, -(1.6 - 0.8)), 'a refund of the tax line lowers the tax owed; reversing a refund puts its tax back', s);
// Older reversals with no original to find: by category, then by what they say.
s = booksSummary([
  L({ type: 'reversal', category: 'Supplies', amount: 12 }),          // cancelled supply order
  L({ type: 'reversal', category: 'Refunds', taxBucket: 'refund', amount: 5 }),
  L({ type: 'reversal', category: 'Service Revenue', amount: 7, reversedType: 'income' }),
  L({ type: 'reversal', category: 'My Custom Vendor', amount: 9, reversedType: 'expense' }),
]);
ok(eq(s.cogs, -12) && eq(s.returns, 12) && eq(s.operatingExpenses, -9), 'reversals without their original still land right', s);

// Deposits: paid (a sale), refunded (a return), kept as store credit (a return), the old negative 'refund' shape.
s = booksSummary([
  L({ type: 'income', category: 'Retainers', amount: 50 }),
  L({ type: 'expense', category: 'Deposit Refund', amount: 20 }),
  L({ type: 'refund', category: 'Deposit Refund', amount: -15 }),
  L({ type: 'store_credit_issued', category: 'Store Credit', amount: 15 }),
  L({ type: 'store_credit_redemption', category: 'Store Credit Applied', amount: -15 }),
]);
ok(eq(s.sales, 50) && eq(s.returns, 50) && eq(s.netSales, 0), 'deposits refunded or kept as credit come off sales; redemptions are memos', s);

// A lost chargeback is a return; the dispute fee is a fee; a won dispute's fee comes back; a fee Stripe returns.
s = booksSummary([
  L({ type: 'expense', category: 'Refunds', taxBucket: 'refund', amount: 60, taxRefunded: 0, chargeback: true }),
  L({ type: 'expense', category: 'Processing Fee', taxBucket: 'processing_fee', amount: 15 }),
  L({ type: 'income', category: 'Processing Fee', taxBucket: 'processing_fee', amount: 15 }),
  L({ type: 'income', category: 'Card Processing Fee', taxBucket: 'revenue', amount: 2 }),
]);
ok(eq(s.returns, 60) && eq(s.feesPaid, 15) && eq(s.feesBack, 15) && eq(s.netFees, 0) && eq(s.feesPassedOn, 2) && eq(s.sales, 2), 'chargebacks, dispute fees and fees passed on', s);

// Till over and short, a claim paid out, and personal lines left out of the business's reports.
s = booksSummary([
  L({ type: 'income', category: 'Cash Variance', taxBucket: 'operating_cost', amount: 3 }),
  L({ type: 'expense', category: 'Cash Variance', taxBucket: 'operating_cost', amount: 5 }),
  L({ type: 'income', category: 'Loss recovery', taxBucket: 'income', amount: 25 }),
  L({ type: 'expense', category: 'Food', amount: 40, context: 'Personal' }),
], { businessOnly: true });
ok(eq(s.operatingExpenses, 2) && eq(s.otherIncome, 25) && eq(s.sales, 0) && eq(s.net, 23), 'till variance nets in costs; a claim is other income; personal left out', s);

// A cancelled online order: the refund gives back the items, shipping, tax and the tip; the tip was never booked (it's
// written for the team when an order goes out), so it isn't a return. Once shared, a tip given back comes off tips.
s = booksSummary([
  L({ id: 'osale_B', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 40, retailOrderId: 'B' }),
  L({ id: 'otax_B', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 3.2, retailOrderId: 'B' }),
  L({ type: 'expense', category: 'Refunds', taxBucket: 'refund', amount: 48.2, taxRefunded: 3.2, tipRefunded: 5, retailOrderId: 'B' }),
]);
ok(eq(s.returns, 40) && eq(s.netSales, 0) && eq(s.tips, 0) && eq(s.taxOwed, 0), 'a refunded tip that was never booked stays out of returns and tips', s);
s = booksSummary([
  L({ id: 'osale_C', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 40, retailOrderId: 'C' }),
  L({ id: 'otip_C_x', type: 'income', category: 'Tips', taxBucket: 'gratuity', amount: 5, retailOrderId: 'C', staffId: 'x' }),
  L({ type: 'expense', category: 'Refunds', taxBucket: 'refund', amount: 45, taxRefunded: 0, tipRefunded: 5, tipBooked: true, retailOrderId: 'C' }),
]);
ok(eq(s.returns, 40) && eq(s.tips, 0) && eq(s.income, 0), 'a shared tip given back comes off the tips', s);

// Category breakdowns and the daily chart's figure.
s = booksSummary(desk);
ok(s.byCategory.sales[0][0] === 'Service Revenue' && s.byCategory.discounts.length === 2, 'categories by part', s.byCategory);
const byId = lookupOf(desk);
ok(eq(desk.reduce((x, t) => x + netSalesOf(t, byId), 0), 65), 'net sales by line adds up to net sales');
ok(effectOf({ type: 'income', category: 'Tax Collected', amount: 2 }).side === 'tax' && effectOf({ type: 'income', amount: 0 }).side === 'skip', 'effects');

// The tip goes back last: a part refund carries none, a refund of everything carries it all, once.
const ord = { subtotalCents: 4000, taxCents: 320, shippingCents: 800, tipCents: 500, totalCents: 5620 };
ok(refundTipPart(ord, 2160) === 0, 'a part refund has no tip in it');
ok(refundTipPart(ord, 5620) === 500, 'a refund of everything has the whole tip');
ok(refundTipPart({ ...ord, refundedCents: 2160 }, 3460) === 500 && refundTipPart({ ...ord, refundedCents: 2160 }, 3000) === 40, 'after a part refund, the rest carries the tip last');
ok(refundTipPart({ ...ord, refundedCents: 5620, refundedTipCents: 500 }, 100) === 0, 'never more tip than there was');
ok(refundTaxPart(ord, 5620 - 500 - 800) <= 320 && refundTaxPart(ord, 4320) === 320, 'the tax part of a whole refund is the whole tax');

if (f) { console.error(`${f} failed`); process.exit(1); } console.log('books-summary ok');
