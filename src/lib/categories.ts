// src/lib/categories.ts
//
// The canonical category library for ClarityFlow.
//
// One source of truth shared by: AddTransactionDialog (ledger + events),
// the Bank screen (components/money/BankScreen: the category picker and learned rules), and the
// print report (each category carries the taxBucket that drives its color).
//
// `taxBucket` values match TAX_BUCKET_COLORS in the Money Hub report:
//   revenue · gratuity · tax_collected · adjustment · refund ·
//   processing_fee · operating_cost · payroll · transfer
//   income (other income: not a sale) · tax_remitted (sales tax paid to the state: never an expense)
//
// Every category the app writes on its own is here too (marked `system`), so the books, the reports and the tax
// summary all know where it goes; the pickers leave those out, since nobody types them by hand.

export type CategoryDef = {
  name: string;
  type: 'income' | 'expense';
  taxBucket: string;
  hint?: string;
  /** Written by the app itself (a deposit, a renter's charge): known everywhere, left out of the pickers. */
  system?: boolean;
};

export const CATEGORY_LIBRARY: CategoryDef[] = [
  // ── Income ──
  { name: 'Service Revenue',     type: 'income',  taxBucket: 'revenue',        hint: 'The services you sell' },
  { name: 'Retail',              type: 'income',  taxBucket: 'revenue',        hint: 'Product sales — usually sales-taxable' },
  { name: 'Membership Sales',    type: 'income',  taxBucket: 'revenue' },
  { name: 'Package Sales',       type: 'income',  taxBucket: 'revenue' },
  { name: 'Gift Card Sales',     type: 'income',  taxBucket: 'transfer',       hint: 'Money held for clients — it counts as a sale when the card is used' },
  { name: 'Booth Rent',          type: 'income',  taxBucket: 'revenue',        hint: 'Rent from booth renters' },
  { name: 'Tips',                type: 'income',  taxBucket: 'gratuity' },
  { name: 'Tax Collected',       type: 'income',  taxBucket: 'tax_collected',  hint: 'Held for the state — not your income' },
  { name: 'Card Processing Fee', type: 'income',  taxBucket: 'revenue',        hint: 'Fee passed through to clients' },
  { name: 'Shipping Charged',    type: 'income',  taxBucket: 'revenue',        hint: 'What customers paid for shipping or delivery' },
  { name: 'Other Income',        type: 'income',  taxBucket: 'revenue' },
  { name: 'Interest Income',     type: 'income',  taxBucket: 'income',         hint: 'Interest the bank paid you' },
  { name: 'Donations',           type: 'income',  taxBucket: 'income',         hint: 'Gifts to the business or school' },
  { name: 'Owner Contribution',  type: 'income',  taxBucket: 'transfer',       hint: 'Money you put into the business — not income' },
  // Written by the app as money comes in.
  { name: 'Retainers',           type: 'income',  taxBucket: 'revenue',        hint: 'Deposits taken on bookings, taken off at checkout', system: true },
  { name: 'Fee Recovery',        type: 'income',  taxBucket: 'revenue',        hint: 'Fees and balances clients paid', system: true },
  { name: 'Cancellation Fee',    type: 'income',  taxBucket: 'revenue',        system: true },
  { name: 'No-show Fee',         type: 'income',  taxBucket: 'revenue',        system: true },
  { name: 'Event Tickets',       type: 'income',  taxBucket: 'revenue',        system: true },
  { name: 'Events',              type: 'income',  taxBucket: 'revenue',        hint: 'Event packages and quotes', system: true },
  { name: 'Hospitality Revenue', type: 'income',  taxBucket: 'revenue',        hint: 'Drinks and snacks from the lounge or kitchen', system: true },
  { name: 'Tuition',             type: 'income',  taxBucket: 'revenue',        system: true },
  { name: 'Day Pass',            type: 'income',  taxBucket: 'revenue',        hint: 'Space rented by the day', system: true },
  { name: 'Space Rentals',       type: 'income',  taxBucket: 'revenue',        hint: 'Space booked by the hour', system: true },
  { name: 'Renter Incidental',   type: 'income',  taxBucket: 'revenue',        hint: 'One-off charges to renters', system: true },
  { name: 'Renter Add-on',       type: 'income',  taxBucket: 'revenue',        system: true },
  { name: 'Renter Text Messages',type: 'income',  taxBucket: 'revenue',        system: true },
  { name: 'Loss Recovery',       type: 'income',  taxBucket: 'income',         hint: 'A claim paid out', system: true },
  { name: 'Reschedule Fee',      type: 'income',  taxBucket: 'revenue',        system: true },
  { name: 'Deposit Kept',        type: 'income',  taxBucket: 'revenue',        hint: 'Kept from a renter’s security deposit', system: true },
  { name: 'Collected for renter',type: 'income',  taxBucket: 'pass_through',   hint: 'Taken at your desk for a booth renter: theirs, not yours', system: true },
  { name: 'Tips collected for renter', type: 'income', taxBucket: 'pass_through', system: true },
  { name: 'Stripe Payout',       type: 'income',  taxBucket: 'transfer',       hint: 'Card sales landing in your bank — already counted', system: true },

  // ── Expenses ──
  { name: 'Supplies',               type: 'expense', taxBucket: 'operating_cost', hint: 'What you use up doing the work' },
  { name: 'Cost of Goods Sold',     type: 'expense', taxBucket: 'operating_cost', hint: 'Retail product you resell' },
  { name: 'Rent & Lease',           type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Utilities',              type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Phone & Internet',       type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Repairs & Maintenance',  type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Office Expense',         type: 'expense', taxBucket: 'operating_cost', hint: 'Paper, printer ink, postage stamps' },
  { name: 'Vehicle',                type: 'expense', taxBucket: 'operating_cost', hint: 'Gas, parking, tolls (when you don’t use the mileage rate)' },
  { name: 'Interest Paid',          type: 'expense', taxBucket: 'operating_cost', hint: 'Interest on a business loan or card' },
  { name: 'Insurance',              type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Payroll',                type: 'expense', taxBucket: 'payroll' },
  { name: 'Payroll Taxes',          type: 'expense', taxBucket: 'payroll',        hint: 'Your employer share, taken by a payroll company. Paying taxes worked out on Payday is Payroll Tax Deposit' },
  { name: 'Payroll Tax Deposit',    type: 'expense', taxBucket: 'transfer',       hint: 'Payroll taxes paid to the IRS or the state, already in your books from payday' },
  { name: 'Payroll Deductions Paid', type: 'expense', taxBucket: 'transfer',      hint: 'Retirement or health plan money taken out of the team’s pay, paid to the plan: already in your books from payday' },
  { name: 'Contract Labor',         type: 'expense', taxBucket: 'operating_cost', hint: 'People you pay who aren’t on payroll' },
  { name: 'Professional Services',  type: 'expense', taxBucket: 'operating_cost', hint: 'Accountant, lawyer, consultant' },
  { name: 'Software & Subscriptions', type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Marketing',              type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Education & Training',   type: 'expense', taxBucket: 'operating_cost', hint: 'Classes, certifications' },
  { name: 'Licenses & Permits',     type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Equipment',              type: 'expense', taxBucket: 'operating_cost', hint: 'Chairs, lamps, drills' },
  { name: 'Cleaning & Sanitation',  type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Bank Fees',              type: 'expense', taxBucket: 'operating_cost', hint: 'Monthly/overdraft/wire fees' },
  { name: 'Processing Fee',         type: 'expense', taxBucket: 'processing_fee', hint: 'Stripe/Square card fees' },
  { name: 'Travel',                 type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Meals & Entertainment',  type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Bills',                  type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Spoilage',               type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Shipping',               type: 'expense', taxBucket: 'operating_cost', hint: 'Postage and shipping labels' },
  { name: 'Refunds',                type: 'expense', taxBucket: 'refund' },
  { name: 'Discounts',              type: 'expense', taxBucket: 'adjustment' },
  { name: 'Sales Tax Paid',         type: 'expense', taxBucket: 'tax_remitted',   hint: 'Sales tax you paid the state — not an expense' },
  { name: 'Loan Payment',           type: 'expense', taxBucket: 'transfer',       hint: 'Paying back a loan — only its interest is an expense' },
  { name: 'Transfer',               type: 'expense', taxBucket: 'transfer',       hint: 'Money moved between your own accounts' },
  { name: 'Distribution',           type: 'expense', taxBucket: 'transfer',       hint: 'Profit First / owner transfers' },
  { name: 'Personal Needs',         type: 'expense', taxBucket: 'operating_cost', hint: 'Personal-context spending' },
  { name: 'Other',                  type: 'expense', taxBucket: 'operating_cost' },
  // Written by the app as money goes out.
  { name: 'Tuition Refunds',        type: 'expense', taxBucket: 'refund',         system: true },
  { name: 'Delivery App Fees',      type: 'expense', taxBucket: 'operating_cost', hint: 'A delivery app’s share of an order', system: true },
  { name: 'Comp & Redemption Cost', type: 'expense', taxBucket: 'operating_cost', hint: 'What a free item or reward cost you', system: true },
  { name: 'Service Recovery',       type: 'expense', taxBucket: 'operating_cost', hint: 'Credits given to put things right', system: true },
  { name: 'Bad Debt',               type: 'expense', taxBucket: 'operating_cost', hint: 'Money owed that you wrote off', system: true },
  { name: 'Cash Variance',          type: 'expense', taxBucket: 'operating_cost', hint: 'The drawer came out short', system: true },
  { name: 'Deposit Applied',        type: 'expense', taxBucket: 'adjustment',     hint: 'A deposit taken off the bill at checkout', system: true },
  { name: 'Delivery App Adjustments', type: 'expense', taxBucket: 'adjustment',   system: true },
  { name: 'Booth Deposit',          type: 'expense', taxBucket: 'transfer',       hint: 'A renter’s security deposit: held, not income', system: true },
];

/** Other names for the same category, written before the names above were settled (or by the bank feed's own list):
 *  read as the category they mean, in the books, the reports and the tax summary. */
const ALIASES: Record<string, string> = {
  'booth rent collected': 'Booth Rent',
  'processing fees': 'Processing Fee',
  'cancellation fees': 'Cancellation Fee',
  'maintenance & repairs': 'Repairs & Maintenance',
  'internet & phone': 'Phone & Internet',
  'loan payments': 'Loan Payment',
  'refund': 'Refunds',
  'membership revenue': 'Membership Sales',
  'day-use booking revenue': 'Space Rentals',
  'loss recovery': 'Loss Recovery',
  'software & systems': 'Software & Subscriptions',
  'rent & facility': 'Rent & Lease',
  'transfer in': 'Transfer',
  'transfer out': 'Transfer',
  'meals': 'Meals & Entertainment',
  'travel & transport': 'Travel',
  'marketing & entertainment': 'Marketing',
  'debt repayment': 'Loan Payment',
  'capital equipment': 'Equipment',
  'no-show revenue': 'No-show Fee',
  'reschedule fees': 'Reschedule Fee',
  'fees': 'Fee Recovery',
};

/** The category a name means: the library's own spelling, or the name as it was written when it isn't one. */
export const canonicalCategory = (name: string): string => {
  const k = String(name || '').trim().toLowerCase();
  if (!k) return '';
  const hit = CATEGORY_LIBRARY.find(c => c.name.toLowerCase() === k);
  if (hit) return hit.name;
  return ALIASES[k] || String(name).trim();
};

/** The library entry for a name (its own spelling or another name for it), if it's one. */
export const findCategory = (name: string): CategoryDef | undefined => {
  const c = canonicalCategory(name).toLowerCase();
  return CATEGORY_LIBRARY.find(x => x.name.toLowerCase() === c);
};

/** Sentinel value for "type your own" in category pickers. */
export const CUSTOM_CATEGORY = '__custom__';

/** The categories to pick from (the app's own are left out unless asked for). */
export const categoriesFor = (type?: 'income' | 'expense', o: { withSystem?: boolean } = {}): CategoryDef[] =>
  CATEGORY_LIBRARY.filter(c => (!type || c.type === type) && (o.withSystem || !c.system));

export const categoryNames = (type?: 'income' | 'expense'): string[] =>
  categoriesFor(type).map(c => c.name);

/** taxBucket for a category name — falls back sensibly for custom names. */
export const bucketFor = (name: string, type: 'income' | 'expense' = 'expense'): string => {
  const found = findCategory(name);
  if (found) return found.taxBucket;
  return type === 'income' ? 'revenue' : 'operating_cost';
};

// ── Schedule C mapping (US sole proprietor / single-member LLC) ──────────
// Drives the printable Tax Summary report. Custom categories fall through
// to Line 27a (Other expenses). PLANNING AID ONLY — not tax advice.

const SCHEDULE_C_MAP: Record<string, string> = {
  'Supplies':                'Line 22 — Supplies',
  'Cost of Goods Sold':      'Part III — Cost of Goods Sold',
  'Spoilage':                'Part III — Cost of Goods Sold',
  'Rent & Lease':            'Line 20b — Rent (business property)',
  'Utilities':               'Line 25 — Utilities',
  'Phone & Internet':        'Line 25 — Utilities',
  'Rent & Utilities':        'Line 20b — Rent (business property)',
  'Repairs & Maintenance':   'Line 21 — Repairs and maintenance',
  'Office Expense':          'Line 18 — Office expense',
  'Vehicle':                 'Line 9 — Car and truck expenses',
  'Interest Paid':           'Line 16b — Interest (other)',
  'Professional Services':   'Line 17 — Legal and professional services',
  'Contract Labor':          'Line 11 — Contract labor',
  'Delivery App Fees':       'Line 10 — Commissions & fees',
  'Comp & Redemption Cost':  'Part III — Cost of Goods Sold',
  'Tuition Refunds':         'Line 2 — Returns & allowances',
  'Service Recovery':        'Line 27a — Other expenses',
  'Bad Debt':                'Line 27a — Other expenses',
  'Cash Variance':           'Line 27a — Other expenses',
  'Health':                  'Not deductible — personal',
  'Loan Payment':            'Not deductible — loan principal',
  'Transfer':                'Not deductible — transfer between your accounts',
  'Sales Tax Paid':          'Not deductible — sales tax held for the state',
  'Insurance':               'Line 15 — Insurance',
  'Payroll':                 'Line 26 — Wages',
  'Payroll Taxes':           'Line 23 — Taxes & licenses',
  'Payroll Tax Deposit':     'Not deductible again — counted on payday, as wages and payroll taxes',
  'Payroll Deductions Paid': 'Not deductible again — counted on payday, as wages',
  'Licenses & Permits':      'Line 23 — Taxes & licenses',
  'Software & Subscriptions':'Line 27a — Other expenses',
  'Marketing':               'Line 8 — Advertising',
  'Education & Training':    'Line 27a — Other expenses',
  'Equipment':               'Line 13 — Depreciation (or de minimis → 27a)',
  'Cleaning & Sanitation':   'Line 27a — Other expenses',
  'Bank Fees':               'Line 27a — Other expenses',
  'Processing Fee':          'Line 10 — Commissions & fees',
  'Travel':                  'Line 24a — Travel',
  'Meals & Entertainment':   'Line 24b — Meals (50% limit; entertainment isn’t deductible)',
  'Bills':                   'Line 27a — Other expenses',
  'Refunds':                 'Line 2 — Returns & allowances',
  'Refund':                  'Line 2 — Returns & allowances',
  'Deposit Refund':          'Line 2 — Returns & allowances',
  'Void':                    'Line 2 — Returns & allowances',
  'Deposit Applied':         'Line 2 — Returns & allowances',
  'Shipping':                'Line 27a — Other expenses (postage and shipping)',
  'Discounts':               'Line 2 — Returns & allowances',
  'Distribution':            'Not deductible — owner draw',
  'Personal Needs':          'Not deductible — personal',
  'Other':                   'Line 27a — Other expenses',
};

export const scheduleCFor = (category: string): string =>
  SCHEDULE_C_MAP[category] || SCHEDULE_C_MAP[canonicalCategory(category)] || 'Line 27a — Other expenses';

/** Library names merged with any custom names already used in the ledger,
 *  so pickers always show the user's own vocabulary too. */
export const mergedCategoryNames = (
  usedNames: string[],
  type?: 'income' | 'expense',
): string[] => {
  const base = categoryNames(type);
  const seen = new Set(base.map(n => n.toLowerCase()));
  const extras = usedNames
    .filter(Boolean)
    .filter(n => !seen.has(n.toLowerCase()) && !seen.has(canonicalCategory(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  return [...base, ...extras];
};
