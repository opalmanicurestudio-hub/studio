// src/lib/books-summary.ts — WHAT THE LEDGER ADDS UP TO (pure). One reading of the transactions for the Money page,
// the printed Profit & Loss and the tax summary, so they always agree:
//   sales          — what the shop sold: services, retail, deposits taken, fees, rent, shipping and delivery charged
//   less returns   — every refund (an online order, the Money page, a lost chargeback, a deposit, a voided sale),
//                    less the sales tax inside it, which comes off the tax owed instead
//   less discounts — discounts, and deposits applied at checkout (the deposit was counted when it was paid)
//   = net sales
//   tips           — the team's money. Their pay (an expense) includes the tips paid out, so the Profit & Loss shows the
//                    tips beside the sales rather than leaving them out: otherwise the profit would come out short
//   other income   — a claim paid out, interest: income that isn't a sale
//   sales tax      — collected, less what refunds and voids gave back: held for the state, never income
//   held           — gift cards sold (they count as sales when they're used) and money taken for booth renters
//   transfers      — owner draws, Profit First moves, payouts landing in the bank: never income or expense
//   costs          — cost of goods; card processing fees (less what Stripe gave back); everything else
// A reversal or a void undoes the line it names, wherever that line belongs: undoing an expense brings that expense
// down, a void of the sales tax brings the tax owed down, a refund of a sale is a return. The line it names is looked up
// by id (reversalOf / voidOf) in the lookup list — the whole ledger, so a refund in March of a February sale still
// finds it — or read from what the reversal says about it (reversedType, voidType / voidCategory / voidTaxBucket).
import { CATEGORY_LIBRARY } from '@/lib/categories';

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const lc = (v: any) => String(v || '').trim().toLowerCase();

export type Side = 'sales' | 'returns' | 'discounts' | 'tips' | 'other' | 'tax' | 'held' | 'transfer' | 'cogs' | 'fees' | 'opex' | 'skip';
/** Where a line lands: `amount` is signed for that part of the books (a fee Stripe gave back is fees −, a void of the
 *  sales tax is tax −); `tax` is the sales tax a return gave back (it lowers the tax owed, not the sales); `tip` is a
 *  tip given back with it (not a sale either: it comes off the team's tips when they'd been given it, `tipBooked`,
 *  and otherwise was never in the books). */
export type Effect = { side: Side; amount: number; tax: number; category: string; tip?: number; tipBooked?: boolean };

const COGS_WORDS = ['cost of goods', 'spoilage', 'supplies', 'comp'];
const isCogs = (c: string) => COGS_WORDS.some((w) => lc(c).includes(w));
const REFUND_CATS = new Set(['refunds', 'refund', 'deposit refund', 'chargeback', 'chargebacks', 'returns']);
const OTHER_INCOME = new Set(['other income', 'loss recovery', 'interest income', 'interest']);
const GIFT_WORDS = /gift card/i;
const SHIP_CHARGED = /^(shipping|delivery) charged$/i;
const SHIP_COST = /^(shipping|postage|carrier adjustment)$/i;

const libBucket = (cat: string, type: 'income' | 'expense'): string | null => {
  const hit = CATEGORY_LIBRARY.find((c) => c.name.toLowerCase() === lc(cat));
  return hit && hit.type === type ? hit.taxBucket : null;
};
const libType = (cat: string): 'income' | 'expense' | null => CATEGORY_LIBRARY.find((c) => c.name.toLowerCase() === lc(cat))?.type || null;

/** An income line. */
function incomeSide(t: any): Side {
  const cat = lc(t?.category);
  const b = lc(t?.taxBucket) || libBucket(t?.category, 'income') || 'revenue';
  if (b === 'tax_collected' || cat === 'tax collected') return 'tax';
  if (b === 'gratuity' || cat === 'tips' || cat === 'gratuity') return 'tips';
  if (b === 'pass_through') return 'held';
  if (b === 'transfer') return GIFT_WORDS.test(cat) ? 'held' : 'transfer';
  if (b === 'income' || OTHER_INCOME.has(cat)) return 'other';
  return 'sales';
}
/** An income line that is really money back on a cost (a fee Stripe returned, a postage refund, a till overage):
 *  the cost it came back on, to be brought down. */
function incomeAsCostBack(t: any): Side | null {
  const b = lc(t?.taxBucket);
  if (b === 'processing_fee') return 'fees';
  if (b === 'refund' || b === 'operating_cost' || b === 'payroll' || b === 'expense') return isCogs(t?.category) ? 'cogs' : 'opex';
  return null;
}
/** An expense (or bill payment) line. */
function expenseSide(t: any): Side {
  const cat = lc(t?.category);
  const b = lc(t?.taxBucket) || libBucket(t?.category, 'expense') || 'operating_cost';
  if (REFUND_CATS.has(cat) || b === 'refund') return 'returns';
  if (b === 'adjustment') return 'discounts';
  if (b === 'transfer' || cat === 'distribution') return 'transfer';
  if (b === 'processing_fee' || cat === 'processing fee' || cat === 'processing fees') return 'fees';
  if (isCogs(cat)) return 'cogs';
  return 'opex';
}

/** Where an ordinary (not reversing) line lands, with its sign. */
function plain(t: any, amount: number): Effect {
  const category = String(t?.category || '') || 'Other';
  const type = lc(t?.type);
  if (type === 'income') {
    const back = incomeAsCostBack(t);
    if (back) return { side: back, amount: -amount, tax: 0, category };
    return { side: incomeSide(t), amount, tax: 0, category };
  }
  if (type === 'expense' || type === 'payment') {
    const side = expenseSide(t);
    if (side !== 'returns') return { side, amount, tax: 0, category };
    const sign = Math.sign(amount) || 1; const abs = Math.abs(amount);
    const tax = Math.min(abs, Math.max(0, n(t?.taxRefunded)));
    const tip = Math.min(abs - tax, Math.max(0, n(t?.tipRefunded)));
    return { side, amount, tax: tax * sign, category, ...(tip ? { tip: tip * sign, tipBooked: !!t?.tipBooked } : {}) };
  }
  return { side: 'skip', amount: 0, tax: 0, category };
}

/** What a reversal or void says about the line it undoes, when that line isn't in the lookup. */
function described(t: any): any | null {
  if (t?.voidType || t?.voidCategory || t?.voidTaxBucket) return { type: t.voidType || 'income', category: t.voidCategory || '', taxBucket: t.voidTaxBucket || '' };
  if (t?.reversedType) return { type: t.reversedType, category: t.category, taxBucket: t.taxBucket || '' };
  return null;
}

/** A reversal or void: the opposite of the line it undoes (`o`, when it's known). */
function undo(t: any, amount: number, o: any | null, byId: Map<string, any> | undefined, depth: number): Effect {
  const category = String(t?.category || '') || 'Refunds';
  const isVoid = lc(t?.category) === 'void';
  const taxIn = (cap: number) => Math.min(cap, Math.max(0, n(t?.taxRefunded)));
  let orig = o;
  if (!orig) {
    // Nothing to go on but the line itself (written before reversals said what they undo).
    if (!isVoid && (REFUND_CATS.has(lc(t?.category)) || lc(t?.taxBucket) === 'refund')) return { side: 'returns', amount, tax: taxIn(amount), category };
    if (isVoid) {
      // A void is written the other way round from what it undoes: an expense-side void undid a sale, an income-side
      // void undid an expense (most often a discount or a deposit applied).
      return lc(t?.type) === 'income' ? { side: 'discounts', amount: -amount, tax: 0, category } : { side: 'returns', amount, tax: 0, category };
    }
    const kind = libType(t?.category) || (['revenue', 'income', 'tax_collected', 'gratuity', 'pass_through'].includes(lc(t?.taxBucket)) ? 'income' : t?.taxBucket ? 'expense' : null);
    if (!kind) return { side: 'returns', amount, tax: 0, category };
    orig = { type: kind, category: t?.category, taxBucket: t?.taxBucket || '' };
  }
  // What the undone line did (itself a reversal, now and then: undoing that puts the first line back).
  const done = effectOf({ ...orig, amount }, byId, depth + 1);
  if (done.side === 'skip') return done;
  // Undoing a sale is a return; undoing anything else takes it back off where it was.
  if (done.side === 'sales') return { side: 'returns', amount, tax: taxIn(amount), category: isVoid ? 'Void' : REFUND_CATS.has(lc(t?.category)) ? category : 'Reversals' };
  if (done.side === 'returns') {
    const tax = Math.min(amount, Math.max(0, n(t?.taxRefunded ?? orig?.taxRefunded)));
    return { side: 'returns', amount: -amount, tax: -tax, category: String(orig?.category || category), ...(done.tip ? { tip: -done.tip, tipBooked: done.tipBooked } : {}) };
  }
  return { side: done.side, amount: -done.amount, tax: -done.tax, category: String(orig?.category || category) };
}

/** Where one line lands in the books. `byId` finds the line a reversal or void undoes. */
export function effectOf(t: any, byId?: Map<string, any>, depth = 0): Effect {
  const type = lc(t?.type);
  const raw = n(t?.amount);
  const category = String(t?.category || '') || 'Other';
  if (!raw) return { side: 'skip', amount: 0, tax: 0, category };
  // A deposit kept for a no-show or a late cancellation (lib/deposit-outcome): it was counted as a sale when it was
  // paid, and the line only names it (for the team's no-show share). Lines written before it said so are known by
  // their wording: paid by "Deposit", "Deposit forfeited — …".
  if (t?.alreadyCounted === true || (lc(t?.paymentMethod) === 'deposit' && /^deposit forfeited/i.test(String(t?.description || '')))) return { side: 'skip', amount: 0, tax: 0, category };
  // Older deposit refunds were written as type 'refund' with a negative amount, and deposits kept as store credit as
  // 'store_credit_issued': both give back a deposit that was counted as a sale when it was paid.
  if (type === 'refund') return { side: 'returns', amount: Math.abs(raw), tax: 0, category };
  if (type === 'store_credit_issued') return { side: 'returns', amount: Math.abs(raw), tax: 0, category: 'Deposit kept as store credit' };
  if (type === 'reversal' || lc(t?.category) === 'void') {
    if (depth > 3) return { side: 'skip', amount: 0, tax: 0, category };
    const ref = String(t?.reversalOf || t?.voidOf || '');
    const o = (ref && ref !== String(t?.id || '') && byId?.get(ref)) || described(t);
    return undo(t, Math.abs(raw), o || null, byId, depth);
  }
  return plain(t, raw);
}

export type BooksSummary = {
  sales: number; returns: number; discounts: number; netSales: number;
  tips: number; otherIncome: number; income: number;
  taxCollected: number; taxRefunded: number; taxOwed: number;
  held: number; giftCardsSold: number; heldForRenters: number; transfers: number;
  cogs: number; grossProfit: number;
  feesPaid: number; feesBack: number; netFees: number; feesPassedOn: number;
  operatingExpenses: number; net: number;
  shippingCharged: number; shippingCost: number;
  /** How many sales (a checkout, an online order, a visit), for the average ticket. */
  salesCount: number;
  byCategory: Record<'sales' | 'returns' | 'discounts' | 'other' | 'cogs' | 'fees' | 'opex' | 'transfer' | 'held', [string, number][]>;
};

export type SummaryOptions = {
  /** The whole ledger (or as much of it as is loaded), so a reversal finds the line it undoes outside the period. */
  lookup?: any[];
  /** Leave out lines marked Personal (the printed reports are the business's). */
  businessOnly?: boolean;
};

export function lookupOf(...lists: (any[] | undefined)[]): Map<string, any> {
  const m = new Map<string, any>();
  for (const l of lists) for (const t of l || []) if (t?.id) m.set(String(t.id), t);
  return m;
}

export function booksSummary(txns: any[], opts: SummaryOptions = {}): BooksSummary {
  const byId = lookupOf(opts.lookup, txns);
  const acc: Record<Side, number> = { sales: 0, returns: 0, discounts: 0, tips: 0, other: 0, tax: 0, held: 0, transfer: 0, cogs: 0, fees: 0, opex: 0, skip: 0 };
  const cats: BooksSummary['byCategory'] = { sales: [], returns: [], discounts: [], other: [], cogs: [], fees: [], opex: [], transfer: [], held: [] };
  const catMaps = Object.fromEntries(Object.keys(cats).map((k) => [k, new Map<string, number>()])) as Record<keyof BooksSummary['byCategory'], Map<string, number>>;
  let taxIn = 0; let taxBack = 0; let feesPaid = 0; let feesBack = 0; let feesPassedOn = 0;
  let giftCardsSold = 0; let heldForRenters = 0; let shippingCharged = 0; let shippingCost = 0; const saleKeys = new Set<string>();
  for (const t of txns || []) {
    if (opts.businessOnly && lc(t?.context) === 'personal') continue;
    const e = effectOf(t, byId);
    if (e.side === 'skip') continue;
    if (e.side === 'returns') {
      // The sales tax inside a refund comes off the tax owed, not the sales; a tip inside it comes off the tips.
      const tip = e.tip || 0;
      acc.returns += e.amount - e.tax - tip; taxBack += e.tax;
      if (tip && e.tipBooked) acc.tips -= tip;
      const m = catMaps.returns; m.set(e.category, (m.get(e.category) || 0) + e.amount - e.tax - tip);
      continue;
    }
    if (e.side === 'tax') { if (e.amount >= 0) taxIn += e.amount; else taxBack += -e.amount; continue; }
    acc[e.side] += e.amount;
    if (e.side in catMaps) { const m = catMaps[e.side as keyof typeof catMaps]; m.set(e.category, (m.get(e.category) || 0) + e.amount); }
    if (e.side === 'sales') {
      // One sale per order or checkout: an online order's lines (its sale and its shipping) count once.
      if (e.amount > 0) saleKeys.add(String(t?.retailOrderId ? `ro:${t.retailOrderId}` : t?.checkoutSessionId || t?.appointmentId || t?.id || saleKeys.size));
      if (SHIP_CHARGED.test(e.category)) shippingCharged += e.amount;
      if (lc(e.category) === 'card processing fee') feesPassedOn += e.amount;
    }
    if (e.side === 'fees') { if (e.amount >= 0) feesPaid += e.amount; else feesBack += -e.amount; }
    if (e.side === 'held') { if (GIFT_WORDS.test(e.category)) giftCardsSold += e.amount; else heldForRenters += e.amount; }
    if ((e.side === 'opex' || e.side === 'cogs') && SHIP_COST.test(e.category)) shippingCost += e.amount;
  }
  for (const k of Object.keys(cats) as (keyof typeof cats)[]) {
    cats[k] = [...catMaps[k].entries()].filter(([, v]) => Math.abs(v) >= 0.005).map(([c, v]) => [c, r2(v)] as [string, number]).sort((a, b) => b[1] - a[1]);
  }
  const netSales = acc.sales - acc.returns - acc.discounts;
  const income = netSales + acc.tips + acc.other;
  const grossProfit = income - acc.cogs;
  const net = grossProfit - acc.fees - acc.opex;
  return {
    sales: r2(acc.sales), returns: r2(acc.returns), discounts: r2(acc.discounts), netSales: r2(netSales),
    tips: r2(acc.tips), otherIncome: r2(acc.other), income: r2(income),
    taxCollected: r2(taxIn), taxRefunded: r2(taxBack), taxOwed: r2(taxIn - taxBack),
    held: r2(acc.held), giftCardsSold: r2(giftCardsSold), heldForRenters: r2(heldForRenters), transfers: r2(acc.transfer),
    cogs: r2(acc.cogs), grossProfit: r2(grossProfit),
    feesPaid: r2(feesPaid), feesBack: r2(feesBack), netFees: r2(acc.fees), feesPassedOn: r2(feesPassedOn),
    operatingExpenses: r2(acc.opex), net: r2(net),
    shippingCharged: r2(shippingCharged), shippingCost: r2(shippingCost),
    salesCount: saleKeys.size,
    byCategory: cats,
  };
}

/** A line's part in net sales (sales up, returns and discounts down), for charts by day. */
export function netSalesOf(t: any, byId?: Map<string, any>): number {
  const e = effectOf(t, byId);
  if (e.side === 'sales') return e.amount;
  if (e.side === 'returns') return -(e.amount - e.tax - (e.tip || 0));
  if (e.side === 'discounts') return -e.amount;
  return 0;
}
