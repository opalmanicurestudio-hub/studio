// Checks the Books screen (design boards "Money, the books" and "A line in a closed month"; components/money/
// BooksScreen, the Books tab of app/(app)/money/page.tsx):
//   Lines by day   — every line for the dates picked, newest first, each day with what came in and went out; money in or
//                    out the way the bank sees it (a line taking back a sale is money out).
//   A line         — its category, where it goes on the taxes, how it was paid, what it came from, the bank's match.
//   Changing it    — its category in an open month; a receipt in any month; undoing it (a line taking it back, today,
//                    never carrying its bank match or its refund).
//   Closed month   — never changed: a correction goes in today (the category it should have been, the amount, or not in
//                    the books at all), saying which line it corrects, and the books add up as if it had been right.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/books-screen.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';
import { booksSummary, lookupOf } from '../../src/lib/books-summary';

(async () => {
  const S = await import('../../src/components/money/BooksScreen');
  const sale = { id: 's1', type: 'income', category: 'Service Revenue', amount: 120, description: 'Gel set, Ana', date: '2026-10-14T15:00:00.000Z', context: 'Business' };
  const cost = { id: 'c1', type: 'expense', category: 'Supplies', amount: 210, description: 'Sally Beauty Supply', date: '2026-10-14T15:00:00.000Z', context: 'Business', taxBucket: 'operating_cost' };
  const undoSale = { id: 'u1', type: 'reversal', reversalOf: 's1', reversedType: 'income', category: 'Service Revenue', amount: 120 };
  const byId = lookupOf([sale, cost, undoSale]);

  console.log('money in and out, and the taxes');
  check('money in or out the way the bank sees it: a sale in, a cost out, taking back a sale out, taking back a cost in',
    S.wayOf(sale, byId) === 'in' && S.wayOf(cost, byId) === 'out' && S.wayOf(undoSale, byId) === 'out' && S.wayOf({ type: 'reversal', reversalOf: 'c1' }, byId) === 'in');
  check('where a line goes on the taxes: a sale on line 1, supplies on line 22, sales tax held never income, a personal line not at all',
    S.taxLineOf(sale, byId) === 'Line 1, gross receipts' && S.taxLineOf(cost, byId) === 'Line 22, Supplies' && /not your income/.test(S.taxLineOf({ type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 8 }))
    && /not on your business taxes/.test(S.taxLineOf({ ...cost, context: 'Personal' })) && /returns and allowances/.test(S.taxLineOf(undoSale, byId)));

  console.log('a correction for a line in a closed month');
  const net = (ls: any[]) => booksSummary(ls, { lookup: ls, businessOnly: true });
  const moved = S.correctionFor(cost, 'category', 'Equipment')!;
  const after = net([cost, ...moved.lines]);
  check('the category it should have been: taken off one, put on the other, and the books add up as if it had been right',
    moved.lines.length === 2 && moved.lines.every((l: any) => l.correctionOf === 'c1' && !l.date) && Math.abs(after.net - net([{ ...cost, category: 'Equipment' }]).net) < 1e-9
    && Math.abs(after.cogs - 0) < 1e-9, { after, moved: moved.lines });
  const less = S.correctionFor(sale, 'amount', '', 9500)!; const more = S.correctionFor(sale, 'amount', '', 13000)!;
  check('the amount it should have been: the difference, taken back or added', less.lines.length === 1 && less.lines[0].type === 'reversal' && less.lines[0].amount === 25 && less.lines[0].reversalOf === 's1'
    && more.lines[0].type === 'income' && more.lines[0].amount === 10 && Math.abs(net([sale, ...more.lines]).net - 130) < 1e-9 && Math.abs(net([sale, ...less.lines]).net - 95) < 1e-9);
  const saleMoved = net([sale, ...S.correctionFor(sale, 'category', 'Retail')!.lines]);
  check('…a sale booked under the wrong category is moved, never counted as a return', Math.abs(saleMoved.returns) < 1e-9 && Math.abs(saleMoved.sales - 120) < 1e-9 && Math.abs(net([sale, ...less.lines]).returns) < 1e-9, saleMoved);
  const gone = S.correctionFor(cost, 'remove')!;
  check('not in the books at all: taken back whole, so it comes to nothing', Math.abs(net([cost, ...gone.lines]).net) < 1e-9 && gone.lines[0].paymentMethod === 'Correction');
  const refundLine = { id: 'r1', type: 'reversal', reversalOf: 's1', reversedType: 'income', category: 'Refunds', amount: 20, description: 'Refund for: Gel set, Ana', date: '2026-10-15T15:00:00.000Z' };
  check('a line that takes another back (a refund, an undo, a void) is only taken out or taken back by less: never moved, never more',
    S.correctionFor(refundLine, 'category', 'Supplies') === null && S.correctionFor(refundLine, 'amount', '', 2500) === null && S.correctionFor(refundLine, 'amount', '', 1500)!.lines[0].reversalOf === 'r1' && !!S.correctionFor(refundLine, 'remove'));
  const refundTax = { ...refundLine, id: 'r2', amount: 21.6, taxRefunded: 1.6 }; const putBack = S.correctionFor(refundTax, 'remove')!.lines[0];
  check('taking a refund out puts back the tax that came back with it, even without its sale', putBack.taxRefunded === 1.6 && Math.abs(net([refundTax, putBack]).taxOwed - net([]).taxOwed) < 1e-9 && Math.abs(net([refundTax]).taxOwed + 1.6) < 1e-9, [net([refundTax]).taxOwed, net([refundTax, putBack]).taxOwed]);
  const refundTip = { id: 'r3', type: 'expense', category: 'Refunds', taxBucket: 'refund', amount: 30, tipRefunded: 10, tipBooked: true, description: 'Refund, order 1042', date: '2026-10-15T15:00:00.000Z' }; const tipBack = S.correctionFor(refundTip, 'remove')!.lines[0];
  check('…and the tip that came back with it goes back to tips, never to sales', Math.abs(net([refundTip, tipBack]).tips - net([]).tips) < 1e-9 && Math.abs(net([refundTip, tipBack]).sales - net([]).sales) < 1e-9 && Math.abs(net([refundTip, tipBack]).returns) < 1e-9, net([refundTip, tipBack]));
  const app = { ...sale, id: 's9', appKey: 'doordash', taxFree: true, retailOrderId: 'o1', locationId: 'l2', stripeChargeId: 'ch_1' };
  const appFix = S.correctionFor(app, 'remove')!.lines[0];
  check('a correction keeps where it was sold and how it was taxed, never its payment', appFix.appKey === 'doordash' && appFix.taxFree === true && appFix.retailOrderId === 'o1' && appFix.locationId === 'l2' && appFix.stripeChargeId === undefined);
  check('nothing to correct yet: the same category, or the same amount', S.correctionFor(cost, 'category', 'Supplies') === null && S.correctionFor(cost, 'amount', '', 21000) === null && S.correctionFor(cost, 'amount') === null);

  console.log('undone, and never a refund');
  const fullUndo = { id: 'undo_s1', type: 'reversal', undo: true, reversalOf: 's1', reversedType: 'income', amount: 120, description: 'Undo: Gel set, Ana' };
  check('a refund never marks its sale undone; an Undo of the whole line does (and the older “Reversal of” lines too)', !S.undoneIn(lookupOf([sale, refundLine])).has('s1') && S.undoneIn(lookupOf([sale, fullUndo])).has('s1')
    && S.undoneIn(lookupOf([cost, { id: 'old', type: 'reversal', reversalOf: 'c1', amount: 210, description: 'Reversal of: Sally Beauty Supply' }])).has('c1') && !S.undoneIn(lookupOf([sale, { ...fullUndo, amount: 50 }])).has('s1'));
  const BM = await import('../../src/lib/bank-match');
  check('a correction is never matched to the bank: it moves no money', /correction in your books/.test(BM.notBankMoney({ ...moved.lines[1], id: 'k1' }, 'out')) && !!BM.notBankMoney({ type: 'expense', category: 'Supplies', amount: 5, paymentMethod: 'Correction' }, 'out'));

  console.log('the screen and the page');
  const scr = fs.readFileSync('src/components/money/BooksScreen.tsx', 'utf8');
  const page = fs.readFileSync('src/app/(app)/money/page.tsx', 'utf8');
  check('lines by day, each day with what came in and went out; filters for dates, money in or out, the books and the category; Print or export and New entry',
    /dayName\(d\.key\)/.test(scr) && /in, \{usd\(d\.out\)\} out/.test(scr) && /Money in and out/.test(scr) && /Business and personal/.test(scr) && /All categories/.test(scr) && /onClick=\{p\.onNew\}/.test(scr) && /Print or export/.test(page));
  check('a line shows its category, its taxes line, how it was paid, its books, who, what it came from and the bank’s match',
    ['Category', 'On your taxes', 'Paid with', 'Books', 'Who', 'From'].every((k) => scr.includes(`row('${k}'`)) && /so it’s counted once/.test(scr));
  check('a closed month: it says so, offers a correction (never a change), and how the owner reopens it',
    /This line can’t change\. If something on it was wrong, add a correction: it goes in today, and \{month\} stays as you closed it\./.test(scr) && /closed \? <button type="button" onClick=\{\(\) => setMode\('correct'\)\}/.test(scr)
    && /\{!closed && !isUndo && !undone && <button type="button" onClick=\{\(\) => setMode\('undo'\)\}/.test(scr) && /reopen \{month\} from Close a month/.test(scr));
  check('the page changes a category only in an open month, keeps a receipt in any month, and writes a correction dated today with who did it',
    /if \(!firestore \|\| !tenantId \|\| inClosedMonth\(selectedTenant, t\.date\)\) return false;/.test(page) && /receiptUrl: url, hasReceipt: true/.test(page) && /date: nowIso, createdAt: nowIso, enteredBy/.test(page) && /action: 'transaction\.correct'/.test(page));
  check('undoing a line writes it once (undo_{line}, refused when there is one), waits for it, and carries only what the line was and where it was sold',
    /`undo_\$\{String\(t\.id\)\}`/.test(page) && /if \(\(await tx\.get\(ref\)\)\.exists\(\)\) throw/.test(page) && /It was undone already\./.test(page) && /onUndo=\{undoLine\} isUndone=\{isUndone\}/.test(page)
    && /const UNDO_KEEP = \[/.test(page) && !/UNDO_KEEP = \[[^\]]*(stripe|refunded|reconciled|bankTransactionId|receipt)/i.test(page));
  check('the dates’ net sales and profit, the books’ own reading, and money in and out said not to be profit', /summary=\{\{ netSales: financialSummary\.netSales/.test(page) && /Money in and out isn’t profit/.test(scr));
  check('the old ledger is gone', !/const TransactionRow = /.test(page) && !/TransactionDossierSheet/.test(page) && !/The Ledger/.test(page) && /<BooksScreen lines=\{filteredTransactions\}/.test(page));
  const shell = page.slice(page.indexOf('const lineRef = '), page.indexOf('// ─── PaydayTab'));
  check('the Books screen keeps the house style', !/\buppercase\b|font-black|\{\/\*| · |[Cc]all us|[Cc]ontact us|\b(salon|stylist|booth|chair|studio)\b/.test(scr + shell) && !/[\u{1F300}-\u{1FAFF}]/u.test(scr) && /min-h-\[44px\]/.test(scr));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
