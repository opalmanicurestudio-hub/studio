// src/lib/categories.ts
//
// The canonical category library for ClarityFlow.
//
// One source of truth shared by: AddTransactionDialog (ledger + events),
// BankFeedSection (reconciliation category picker + learned rules), and the
// print report (each category carries the taxBucket that drives its color).
//
// `taxBucket` values match TAX_BUCKET_COLORS in the Money Hub report:
//   revenue · gratuity · tax_collected · adjustment · refund ·
//   processing_fee · operating_cost · payroll · transfer

export type CategoryDef = {
  name: string;
  type: 'income' | 'expense';
  taxBucket: string;
  hint?: string;
};

export const CATEGORY_LIBRARY: CategoryDef[] = [
  // ── Income ──
  { name: 'Service Revenue',     type: 'income',  taxBucket: 'revenue',        hint: 'Manicures, pedicures, enhancements' },
  { name: 'Retail',              type: 'income',  taxBucket: 'revenue',        hint: 'Product sales — usually sales-taxable' },
  { name: 'Membership Sales',    type: 'income',  taxBucket: 'revenue' },
  { name: 'Package Sales',       type: 'income',  taxBucket: 'revenue' },
  { name: 'Booth Rent Collected',type: 'income',  taxBucket: 'revenue',        hint: 'Rent from booth renters' },
  { name: 'Tips',                type: 'income',  taxBucket: 'gratuity' },
  { name: 'Tax Collected',       type: 'income',  taxBucket: 'tax_collected',  hint: 'Held for the state — not your income' },
  { name: 'Card Processing Fee', type: 'income',  taxBucket: 'revenue',        hint: 'Fee passed through to clients' },
  { name: 'Other Income',        type: 'income',  taxBucket: 'revenue' },

  // ── Expenses ──
  { name: 'Supplies',               type: 'expense', taxBucket: 'operating_cost', hint: 'Polish, tips, acetone, files' },
  { name: 'Cost of Goods Sold',     type: 'expense', taxBucket: 'operating_cost', hint: 'Retail product you resell' },
  { name: 'Rent & Lease',           type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Utilities',              type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Insurance',              type: 'expense', taxBucket: 'operating_cost' },
  { name: 'Payroll',                type: 'expense', taxBucket: 'payroll' },
  { name: 'Payroll Taxes',          type: 'expense', taxBucket: 'payroll',        hint: 'Employer FICA / FUTA / SUTA' },
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
  { name: 'Refunds',                type: 'expense', taxBucket: 'refund' },
  { name: 'Discounts',              type: 'expense', taxBucket: 'adjustment' },
  { name: 'Distribution',           type: 'expense', taxBucket: 'transfer',       hint: 'Profit First / owner transfers' },
  { name: 'Personal Needs',         type: 'expense', taxBucket: 'operating_cost', hint: 'Personal-context spending' },
  { name: 'Other',                  type: 'expense', taxBucket: 'operating_cost' },
];

/** Sentinel value for "type your own" in category pickers. */
export const CUSTOM_CATEGORY = '__custom__';

export const categoriesFor = (type?: 'income' | 'expense'): CategoryDef[] =>
  type ? CATEGORY_LIBRARY.filter(c => c.type === type) : CATEGORY_LIBRARY;

export const categoryNames = (type?: 'income' | 'expense'): string[] =>
  categoriesFor(type).map(c => c.name);

/** taxBucket for a category name — falls back sensibly for custom names. */
export const bucketFor = (name: string, type: 'income' | 'expense' = 'expense'): string => {
  const found = CATEGORY_LIBRARY.find(c => c.name.toLowerCase() === (name || '').toLowerCase());
  if (found) return found.taxBucket;
  return type === 'income' ? 'revenue' : 'operating_cost';
};

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
    .filter(n => !seen.has(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  return [...base, ...extras];
};
