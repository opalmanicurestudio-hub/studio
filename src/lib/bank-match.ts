// src/lib/bank-match.ts — WHICH LINES IN THE BOOKS A BANK LINE CAN BE THE MONEY FOR. Read by the Bank screen's Match to
// a sale (components/money/BankScreen), the route that does it (lib/bank-match-server) and the bank feed's own matching
// (lib/plaid-sync), so all three agree. Pure.
//   Never money that moved: a discount, a deposit taken off a bill, a comp, a credit or gift card used, a write-off.
//   Never money that moves another way: a card sale comes in with its card payout; card fees and card refunds come off
//   the payouts, not out of the bank.
//   One payment's lines together: the sale, its tax and its tip (one checkout, else one visit or order, paid one way), to
//   pick as one, or one by one.
import { normalizeLine } from './books-summary';
import { bucketFor, canonicalCategory } from './categories';

const NOT_MONEY_PM = /internal|deducted from payout|already.?charged|store credit|gift ?card|kept from|security deposit|add.?to.?balance|free plan|^deposit$|stripe refund/i;
const CARD_PM = /card|stripe|online|terminal|tap to pay|apple ?pay|google ?pay/i;
const NOT_MONEY_CATS = new Set(['comp & redemption cost', 'service recovery', 'bad debt', 'cash variance', 'delivery app fees', 'spoilage']);
/** Lines that go with a sale and never stand for it alone, or money given back: never "the same, a little different". */
const WITH_A_SALE = new Set(['tax_collected', 'gratuity', 'pass_through', 'transfer', 'tax_remitted', 'refund']);

/** A line's amount in cents (older lines kept cents). */
export const lineCents = (t: any): number => Math.round((Number(normalizeLine(t || {}).amount) || 0) * 100);
/** Where a line goes: its own bucket, else its category's. */
export const bucketOf = (t: any): string => String(t?.taxBucket || bucketFor(String(t?.category || ''), normalizeLine(t || {}).type === 'income' ? 'income' : 'expense')).toLowerCase();
const what = (t: any) => String(t?.description || t?.clientOrVendor || t?.category || 'That line').slice(0, 60);

export const OTHER_BOOKS = 'That line is in your other books (business or personal).';

/** Why a line in the books can't be the money for a bank line, or '' when it can be. `dir`: the bank line's way;
 *  `context`: the bank account's books. */
export function notBankMoney(t: any, dir: 'in' | 'out', context = 'Business'): string {
  const l = normalizeLine(t || {});
  if (l.type !== (dir === 'out' ? 'expense' : 'income')) return dir === 'out' ? 'Money out matches only a cost.' : 'Money in matches only a sale or other money in.';
  if ((l.context || 'Business') !== (context || 'Business')) return context === 'Personal'
    ? `${what(t)} is in your business books, and this money came into your personal account. If a client paid you there for a visit, Skip this line: the sale is in your books already.`
    : OTHER_BOOKS;
  if (t.reconciled || t.bankTransactionId) return `${what(t)} is matched to another bank line already.`;
  const pm = String(t.paymentMethod || ''); const b = bucketOf(t);
  if (b === 'adjustment' || NOT_MONEY_PM.test(pm) || NOT_MONEY_CATS.has(canonicalCategory(String(l.category)).toLowerCase())) return `${what(t)} isn’t money that moved (a discount, a credit or the like).`;
  if (dir === 'out' && b === 'processing_fee') return 'Card fees come off your card payouts, not out of the bank.';
  if (dir === 'in' && CARD_PM.test(pm)) return `${what(t)} was paid by card: its money comes in with your card payout.`;
  return '';
}

/** The one line the bank feed said was the same, a little different: it can be, unless it's tax, a tip or money held. */
export const nearOk = (t: any): boolean => !WITH_A_SALE.has(bucketOf(t));

/** A cost logged by hand and linked to nothing (no bill, order, supplier account, payroll or tax period): the only kind
 *  whose amount becomes what the bank says was paid. Anything else keeps its amount, and the difference is booked. */
export function plainCost(t: any): boolean {
  const l = normalizeLine(t || {});
  if (l.type !== 'expense') return false;
  if (t.relatedBillInstanceId || t.billInstanceId || t.salesTaxPeriod || t.relatedOrderId || t.purchaseOrderId || t.orderId || t.retailOrderId || t.payRunId) return false;
  if (t.source && !/^(manual|import|expenses?|receipt)$/i.test(String(t.source))) return false;
  if (/on account/i.test(String(t.paymentMethod || ''))) return false;
  return ['operating_cost', 'expense'].includes(bucketOf(t));
}

/** What a line was paid with: its checkout, else its visit (a deposit taken at booking), else its order. */
export function saleKeyOf(t: any): { field: string; value: string } | null {
  for (const field of ['checkoutSessionId', 'appointmentId', 'orderId', 'retailOrderId']) if (t?.[field]) return { field, value: String(t[field]) };
  return null;
}
/** One payment: the lines of one checkout (else visit, else order) paid the same way, so a sale, its tax and its tip go
 *  together, and a deposit by Zelle and the rest by check stay apart. '' when it's a line on its own. */
export const saleOf = (t: any): string => { const k = saleKeyOf(t); return k ? `${k.field}:${k.value}|${String(t?.paymentMethod || '').trim().toLowerCase()}` : ''; };
