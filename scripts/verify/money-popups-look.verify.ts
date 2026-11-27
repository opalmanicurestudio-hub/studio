// Checks the last Money pop-ups and cards in the new look (components/ledger/AddTransactionDialog, components/money/
// ReceiptDialog and RefundDialog, components/ledger/BadDebtAgingCard):
//   Add a line: money in or out, amount, day and time, what it was for, category (or one typed in), who, whose books,
//   how it was paid, the receipt; what's saved is the line as before, its report group stamped from the category.
//   The receipt: as it was given, and printed again with every word escaped.
//   Refund: what they get back and how, what's kept back for the visit's costs, the provider's commission, why, and a
//   manager's PIN checked online; the same choice handed to the Books tab as before; every hook before the early return.
//   Fees clients owe: charge the saved card (once per fee) or mark paid; nothing shown when nothing's owed.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/money-popups-look.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';

const src = (f: string) => fs.readFileSync(f, 'utf8');

(async () => {
  const add = src('src/components/ledger/AddTransactionDialog.tsx'), rec = src('src/components/money/ReceiptDialog.tsx');
  const ref = src('src/components/money/RefundDialog.tsx'), owed = src('src/components/ledger/BadDebtAgingCard.tsx');
  const page = src('src/app/(app)/money/page.tsx');
  const A = await import('../../src/components/ledger/AddTransactionDialog');
  const R = await import('../../src/components/money/ReceiptDialog');
  const F = await import('../../src/components/money/RefundDialog');

  console.log('add a line');
  check('money in or out, the amount, the day and time, what it was for, a category or one typed in, who, whose books, how it was paid, the receipt',
    /Money out/.test(add) && /Money in/.test(add) && /What was it for\?/.test(add) && /Something else, typed in/.test(add) && /Who it came from/.test(add) && /Who it was paid to/.test(add)
    && /Whose books/.test(add) && /How it was paid/.test(add) && /Add a photo of the receipt/.test(add) && /type="date"/.test(add) && /type="time"/.test(add));
  check('how it was paid is kept as before', A.PAID_WITH.map(([v]) => v).join() === 'Business Checking,Business Credit Card,Personal Checking,Personal Credit Card,Cash,Other');
  check('what’s saved is the line as before, its report group from the category, the date as a moment',
    /taxBucket: bucketFor\(data\.category, data\.type\)/.test(add) && /date: data\.date\.toISOString\(\)/.test(add) && /hasReceipt: !!data\.receiptUrl/.test(add) && /onConfirm\(newTransaction\)/.test(add));
  check('a missing field says what to do, in amber, and the form goes to it', /Put in an amount above zero\./.test(add) && /Say what it was for\./.test(add) && /Pick a category\./.test(add) && /Pick how it was paid\./.test(add)
    && /style=\{\{ color: AMBER \}\}/.test(add) && /ref=\{f\.ref\} id="amount"/.test(add));
  check('it opens empty each time', /useEffect\(\(\) => \{ if \(open\) reset\(EMPTY\(\)\); \}, \[open, reset\]\);/.test(add));

  console.log('the receipt');
  const html = R.receiptPrintHtml({ id: 'r', checkoutSessionId: 'k', clientName: 'Ana <b>Ruiz</b>', businessName: 'North & Loft', date: '2026-11-20T15:30:00.000Z', paymentMethod: 'Card',
    lineItems: [{ label: '<img src=x onerror=alert(1)>', amount: 48 }], subtotal: 48, tax: 3.6, tip: 10, discount: 0, total: 61.6, tendered: 61.6, change: 0 } as any);
  check('printed again with every word escaped, and no shouting', !/<img/.test(html) && /&lt;img/.test(html) && /North &amp; Loft/.test(html) && /Ana &lt;b&gt;Ruiz/.test(html) && /Total/.test(html) && !/TOTAL/.test(html) && !/ · /.test(html), html.slice(0, 200));
  check('a blocked print window says so', /Your browser blocked its window\. Allow pop-ups for this site, then try again\./.test(rec));
  check('a line with no receipt says so; the Books tab opens it', /There’s no receipt kept for this line/.test(rec) && /<ReceiptDialog\b/.test(page) && !/const ReceiptPreviewDialog/.test(page) && /Print it again/.test(rec));

  console.log('refund');
  const costs = F.visitCosts({ id: 's', amount: 100, appointmentId: 'a1', commissionPct: 40 }, {
    services: [{ id: 'v1', duration: 60 }], appointments: [{ id: 'a1', serviceId: 'v1', staffId: 'p1', actualStartTime: '2026-11-20T15:00:00.000Z', actualEndTime: '2026-11-20T16:00:00.000Z' }],
    staff: [{ id: 'p1', payStructure: 'commission' }], inventory: [], tenant: {} });
  check('what the visit cost: the provider’s commission at the sale’s own rate', Math.abs(costs.labor - 40) < 0.001 && costs.staffMember?.id === 'p1', costs);
  check('the choice handed to the Books tab is the same as before, and the button stays busy until the refund is done',
    /await onConfirm\(\{ amount: refundAmount, refundTip: refundTip && \(Number\(transaction\.tipAmount\) \|\| 0\) > 0, tipStrategy, reason, logIncident, authorizerId, takeBack: isServiceSale && takeBack, later: isCash && later \}\);/.test(ref)
    && /disabled=\{pin\.length < 4 \|\| !reason\.trim\(\) \|\| !!stage\}/.test(ref));
  check('cash is decided the way the Books tab refunds (only a cash sale gets the till or later choice; a card, an online sale or a gift card goes back the way it was paid)',
    /const isCash = method\.toLowerCase\(\) === 'cash';/.test(ref) && /\{isCash && \(\s+<fieldset/.test(ref) && /const isCash = transactionToRefund\.paymentMethod\?\.toLowerCase\(\) === 'cash';/.test(page) && !/isCard/.test(ref));
  check('fees paid or charged read in plain words in Activity and the audit trail', (await import('../../src/lib/report-builders')).actionWords('debt.collect') === 'Marked a fee paid' && (await import('../../src/lib/report-builders')).actionWords('debt.charge_card') === 'Charged a saved card');
  check('the PIN is checked online, never on this device', /action: 'verify-manager'/.test(ref) && /Can’t check the PIN offline/.test(ref) && !/pin ===|=== pin/.test(ref));
  check('they get back: the amount, how, the commission, what’s kept back, why, a PIN; the button says the amount, in red (it’s destructive)',
    /They get back/.test(ref) && /How they get it back/.test(ref) && /The provider’s commission on it/.test(ref) && /Keep back what the visit cost/.test(ref) && /A manager’s PIN/.test(ref)
    && /`Refund \$\{usd\(total\)\}`/.test(ref) && /background: RED/.test(ref) && /RED = '#b42318'/.test(ref));

  console.log('fees clients owe');
  check('charge the saved card once per fee (staff only), or mark paid; nothing shown when nothing’s owed',
    /fetch\('\/api\/stripe\/charge-card'/.test(owed) && /idempotencyKey: `owed-fee-/.test(owed) && /if \(!item \|\| inFlight\.current\) return;/.test(owed) && /Charge their card/.test(owed) && /Mark paid/.test(owed)
    && /if \(total === 0 && items\.length === 0\) return null;/.test(owed) && /aria-expanded=\{expanded\}/.test(owed));
  check('taking the fee off the client, adding the money to the books and the activity note go in one write', /batch\.set\(doc\(firestore, `tenants\/\$\{tenantId\}\/clients`, item\.clientId\), \{\s+unpaidFees: arrayRemove\(removeKey\),/.test(owed) && /category: 'Fee Recovery'/.test(owed) && /await batch\.commit\(\);/.test(owed));

  console.log('house style');
  check('no shouting labels, no dots between words, no comments in the markup, 44px targets, red only on the refund button',
    [add, rec, ref, owed].every((s) => !/\buppercase\b|font-black|\{\/\*| · |[Cc]all us|[Cc]ontact us|\b(salon|stylist|booth|chair|studio)\b/.test(s) && /min-h-\[44px\]/.test(s))
    && ![add, rec, owed].some((s) => /#b42318|destructive\/|text-destructive|bg-destructive/.test(s)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
