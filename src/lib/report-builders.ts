// src/lib/report-builders.ts
//
// THE REPORTS, to print and to download (the Money page's Reports tab, components/money/ReportsScreen). Each report is
// one list of lines, read once, that both the printed page (in the app's print look, lib/print-style) and the
// spreadsheet download (lib/csv) are made from, so the paper and the spreadsheet always say the same:
//   Profit and loss          — pnlRows / buildPnlHtml
//   Tax summary              — taxSummaryRows / buildTaxSummaryHtml (US Schedule C)
//   Payroll register         — payrollRows / buildPayrollRegisterHtml (pay by person, with the employer tax estimate)
//   Audit trail              — auditRows / buildAuditTrailHtml (who did what with the money, in plain words)
//   Sales tax return         — salesTaxCsv / buildSalesTaxHtml (lib/sales-tax-report)
//   Every line               — ledgerCsv / buildLedgerHtml (each checkout and order with its lines, receipts at the back)
//   A closed month           — statementCsv / buildMonthStatementHtml (lib/books-close-server monthStatement)
//
// The figures come from lib/books-summary, the same reading of the books as the Money page, so the paper and the screen
// always agree: refunds are returns (their sales tax comes off the tax owed), discounts and deposits applied come off
// sales, gift cards sold and money taken for renters are held, owner draws and transfers are left out, and sales tax is
// never income. Lines marked Personal are left out of the profit and loss and the tax summary.

import { scheduleCFor } from './categories';
import { booksSummary, effectOf, lookupOf, type BooksSummary } from './books-summary';
import { esc, printLine, printMoney, printPage } from './print-style';
import { format } from 'date-fns';
import type { TaxReport } from './sales-tax-report';

type Txn = any;
type Range = { from?: Date; to?: Date } | undefined;
export type ReportOptions = { lookup?: Txn[]; shopName?: string; currency?: string; payrollRuns?: any[] };
/** One line of a report: a heading, or a label and an amount. `kind` as printLine's. */
export type ReportRow = { heading?: string; label?: string; amount?: number | string; kind?: '' | 'sub' | 'total' | 'memo'; tone?: '' | 'ok' | 'warn' | 'bad'; note?: string };

export const periodLabel = (range: Range) =>
  range?.from && range?.to
    ? (format(range.from, 'yyyy') === format(range.to, 'yyyy') ? `${format(range.from, 'MMMM d')} to ${format(range.to, 'MMMM d, yyyy')}` : `${format(range.from, 'MMMM d, yyyy')} to ${format(range.to, 'MMMM d, yyyy')}`)
    : 'All dates';

const H = (heading: string): ReportRow => ({ heading });
const L = (label: string, amount: number | string, kind: ReportRow['kind'] = '', tone: ReportRow['tone'] = ''): ReportRow => ({ label, amount, kind, tone });
const cats = (list: [string, number][], none = 'None recorded'): ReportRow[] => list.length ? list.map(([c, a]) => L(c, a, 'sub')) : [{ label: none, amount: '', kind: 'sub', note: 'none' }];

/** A report's lines as the printed page. */
export function rowsHtml(rows: ReportRow[], currency = 'USD'): string {
  return rows.map((r) => {
    if (r.heading) return `<h2>${esc(r.heading)}</h2>`;
    if (r.note === 'none') return `<div class="line sub"><span class="faint">${esc(r.label)}</span><span></span></div>`;
    return printLine(esc(r.label), typeof r.amount === 'number' ? printMoney(r.amount, currency) : esc(r.amount ?? ''), r.kind || '', r.tone || '');
  }).join('');
}
/** A report's lines as spreadsheet rows: section, line, amount. */
export function rowsCsv(rows: ReportRow[]): (string | number)[][] {
  const out: (string | number)[][] = [['Section', 'Line', 'Amount']]; let section = '';
  for (const r of rows) {
    if (r.heading) { section = r.heading; continue; }
    if (r.note === 'none') continue;
    out.push([section, String(r.label || ''), typeof r.amount === 'number' ? Math.round(r.amount * 100) / 100 : String(r.amount ?? '')]);
  }
  return out;
}

// ─── Profit and loss ──────────────────────────────────────────────────────────

export function pnlRows(s: BooksSummary, currency = 'USD'): ReportRow[] {
  const fees = [['Card processing fees', s.feesPaid], ...(s.feesBack ? [['Fees returned by Stripe', -s.feesBack]] : [])] as [string, number][];
  return [
    H('Income'), ...cats(s.byCategory.sales), L('Sales', s.sales),
    ...(s.returns ? [L('Less returns and refunds', -s.returns, 'sub')] : []),
    ...(s.discounts ? [L('Less discounts and deposits used', -s.discounts, 'sub')] : []),
    L('Net sales', s.netSales, 'total'),
    ...(s.tips ? [L('Tips collected for the team', s.tips)] : []),
    ...(s.otherIncome ? [L('Other income', s.otherIncome)] : []),
    L('Total income', s.income, 'total'),
    H('Cost of goods'), ...cats(s.byCategory.cogs), L('Gross profit', s.grossProfit, 'total'),
    H('Expenses'), ...cats(fees), ...cats(s.byCategory.opex),
    L('Total expenses', s.netFees + s.operatingExpenses, 'total'),
    L('Net income', s.net, 'total', s.net >= 0 ? 'ok' : 'bad'),
    H('Not in the profit (for your records)'),
    L('Sales tax collected', s.taxCollected, 'memo'),
    ...(s.taxRefunded ? [L('Sales tax given back on refunds and voids', -s.taxRefunded, 'memo')] : []),
    L('Sales tax owed to the state', s.taxOwed, 'memo'),
    ...(s.taxPaid ? [L('Sales tax paid to the state', s.taxPaid, 'memo')] : []),
    ...(s.unsorted.count ? [L(`In your books without a category (${s.unsorted.count})`, s.unsorted.amount, 'memo')] : []),
    ...(s.giftCardsSold ? [L('Gift cards sold (counted as sales when used)', s.giftCardsSold, 'memo')] : []),
    ...(s.heldForRenters ? [L('Taken for renters', s.heldForRenters, 'memo')] : []),
    L('Owner draws and transfers', s.transfers, 'memo'),
    ...(s.shippingCharged || s.shippingCost ? [L('Shipping charged, and what shipping cost', `${printMoney(s.shippingCharged, currency)}, ${printMoney(s.shippingCost, currency)}`, 'memo')] : []),
  ];
}

export function buildPnlHtml(txns: Txn[], range: Range, currency = 'USD', opts: ReportOptions = {}) {
  const s = booksSummary(txns, { lookup: opts.lookup, businessOnly: true });
  return printPage({
    title: 'Profit and loss', heading: 'Profit and <b>loss</b>', subtitle: esc(periodLabel(range)), shopName: opts.shopName,
    body: rowsHtml(pnlRows(s, currency), currency),
    footNote: 'Tips are shown beside sales because the team’s pay, an expense, includes the tips paid out. Owner draws and transfers aren’t expenses. Sales tax is held for the state. Check with your accountant before filing.',
    footRight: esc(periodLabel(range)),
  });
}

// ─── Tax summary (Schedule C map) ─────────────────────────────────────────────

export function taxSummaryRows(txns: Txn[], opts: ReportOptions = {}): ReportRow[] {
  const s = booksSummary(txns, { lookup: opts.lookup, businessOnly: true });
  // Expenses by Schedule C line, each net of what came back on it (a reversal, a fee Stripe returned, a postage refund).
  const byId = lookupOf(opts.lookup, txns);
  const lines = new Map<string, number>(); const notDeductible = new Map<string, number>();
  for (const t of txns) {
    if (String(t?.context || '').toLowerCase() === 'personal') continue;
    const e = effectOf(t, byId);
    if (e.side !== 'opex' && e.side !== 'fees' && e.side !== 'transfer') continue;
    // (A transfer says which kind where it can: a loan paid back, money between your accounts, an owner draw.)
    const own = scheduleCFor(e.category);
    const line = e.side === 'fees' ? scheduleCFor('Processing Fee') : e.side === 'transfer' ? (own.startsWith('Not deductible') ? own : 'Not deductible — owner draws and transfers') : own;
    const target = e.side === 'transfer' || line.startsWith('Not deductible') ? notDeductible : lines;
    target.set(line, (target.get(line) || 0) + e.amount);
  }
  const sortedLines = [...lines.entries()].filter(([, v]) => Math.abs(v) >= 0.005).sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
  const deductions = sortedLines.reduce((a, [, v]) => a + v, 0);
  const line1 = s.sales + s.tips; const line2 = s.returns + s.discounts; const line5 = line1 - line2 - s.cogs; const line7 = line5 + s.otherIncome;
  return [
    H('Income'),
    L('Line 1 — Gross receipts', line1), ...(s.tips ? [L('Includes tips collected for the team', s.tips, 'sub')] : []),
    L('Line 2 — Returns and allowances', -line2),
    ...(s.returns ? [L('Refunds and returns', -s.returns, 'sub')] : []), ...(s.discounts ? [L('Discounts and deposits used', -s.discounts, 'sub')] : []),
    L('Line 4 — Cost of goods sold', -s.cogs), L('Line 5 — Gross profit', line5, 'total'),
    ...(s.otherIncome ? [L('Line 6 — Other income', s.otherIncome)] : []), L('Line 7 — Gross income', line7, 'total'),
    H('Expenses by Schedule C line'),
    ...(sortedLines.length ? sortedLines.map(([line, amt]) => L(line, amt)) : [{ label: 'No expenses this period.', amount: '', note: 'none' } as ReportRow]),
    L('Total expenses', deductions, 'total'),
    L('Tentative profit (Line 7 less expenses)', line7 - deductions, 'total', line7 - deductions >= 0 ? 'ok' : 'bad'),
    H('Not deductible or held (for your records)'),
    ...[...notDeductible.entries()].map(([line, amt]) => L(line, amt, 'memo')),
    L('Sales tax collected', s.taxCollected, 'memo'),
    ...(s.taxRefunded ? [L('Sales tax given back on refunds and voids', -s.taxRefunded, 'memo')] : []),
    L('Sales tax to pay the state', s.taxOwed, 'memo'),
    ...(s.taxPaid ? [L('Sales tax paid to the state', s.taxPaid, 'memo')] : []),
    ...(s.unsorted.count ? [L(`In your books without a category (${s.unsorted.count}), counted under Other expenses`, s.unsorted.amount, 'memo')] : []),
    ...(s.giftCardsSold ? [L('Gift cards sold (income when they’re used)', s.giftCardsSold, 'memo')] : []),
    ...(s.heldForRenters ? [L('Taken for renters', s.heldForRenters, 'memo')] : []),
  ];
}

export function buildTaxSummaryHtml(txns: Txn[], range: Range, currency = 'USD', opts: ReportOptions = {}) {
  return printPage({
    title: 'Tax summary', heading: 'Tax <b>summary</b>', subtitle: `Schedule C, for a US sole proprietor or single-member LLC. ${esc(periodLabel(range))}`, shopName: opts.shopName,
    body: rowsHtml(taxSummaryRows(txns, opts), currency),
    footNote: 'A planning aid, not tax advice. The lines are common defaults; your accountant may place some differently (equipment, meals, a home office). Self-employment tax, estimated payments and state filings aren’t worked out here.',
    footRight: esc(periodLabel(range)),
  });
}

// ─── Payroll register ─────────────────────────────────────────────────────────

/** Pay by person. A payday recorded as one line for the team (lib/payday-record) is shown person by person from its
 *  payroll run (tenants/{t}/payrollRuns/payday_{period}), when it could be read; else as the team's one line. */
export function payrollRows(txns: Txn[], staff: any[], runs: any[] = []) {
  // (When payroll is run in ClarityFlow, each payday's run also has what was withheld and what each person took home.)
  type PayRow = { name: string; count: number; total: number; withheld?: number; takeHome?: number };
  const byStaff = new Map<string, PayRow>();
  const byRun = new Map<string, any>(runs.filter((r) => r?.kind === 'payday' && r.periodKey && Array.isArray(r.people)).map((r) => [String(r.periodKey), r]));
  const shown = new Set<string>();
  for (const t of txns.filter((x) => x.category === 'Payroll' && (x.type === 'expense' || x.type === 'payment'))) {
    const run = (t as any).paydayPeriod && !t.staffId ? byRun.get(String((t as any).paydayPeriod)) : null;
    if (run) {
      if (shown.has(run.periodKey)) continue; shown.add(run.periodKey);
      for (const p of run.people.filter((x: any) => !x.contractor)) {
        const total = (Number(p.paid) || 0) + (Number(p.cashTips) || 0); if (total <= 0) continue;
        const cur: PayRow = byStaff.get(String(p.staffId)) || { name: staff.find((s: any) => s.id === p.staffId)?.name || String(p.name || 'Team member'), count: 0, total: 0 };
        cur.count += 1; cur.total += total;
        if (p.taxes) { cur.withheld = (cur.withheld || 0) + (Number(p.taxes.employeeTotal) || 0); cur.takeHome = (cur.takeHome || 0) + (Number(p.taxes.takeHome) || 0); }
        byStaff.set(String(p.staffId), cur);
      }
      continue;
    }
    const key = t.staffId || t.clientOrVendor || 'unassigned';
    const name = staff.find((s: any) => s.id === t.staffId)?.name || t.clientOrVendor || 'Not assigned to anyone';
    const cur: PayRow = byStaff.get(key) || { name, count: 0, total: 0 };
    cur.count += 1; cur.total += Number(t.amount) || 0; byStaff.set(key, cur);
  }
  return [...byStaff.values()].sort((a, b) => b.total - a.total);
}
/** The employer's payroll taxes for these dates, from the books: payday's own line when payroll is run in ClarityFlow
 *  (paydaytax_), what a payroll company took beyond the pay booked on payday (paydiff_), and, for a payroll company's
 *  withdrawals claimed for a payday when it was recorded, only what they came to beyond the employees' pay (the rest is
 *  the pay, withheld taxes included). Undone lines come back off. None of those: an estimate from the state's rate. */
export function employerTaxesOf(txns: Txn[], gross: number, pct: number, runs: any[] = []): { amount: number; booked: boolean } {
  const byId = lookupOf(txns as any[]); const runOf = new Map<string, any>(runs.filter((r) => r?.kind === 'payday' && r.periodKey).map((r) => [String(r.periodKey), r]));
  let amount = 0, booked = false; const claimed = new Set<string>();
  for (const t of txns as any[]) {
    const e = effectOf(t, byId); if (e.side === 'skip') continue;
    const undone = String(t?.type || '').toLowerCase() === 'reversal' || String(t?.category || '').toLowerCase() === 'void';
    const o: any = (undone ? byId.get(String(t.reversalOf || t.voidOf || '')) : t) || t; const id = String(o?.id || '');
    if (/^(paydaytax|paydiff)_/.test(id) && e.category === 'Payroll Taxes') { amount += e.amount; booked = true; continue; }
    // (A payroll company's withdrawals claimed for a payday, sorted as payroll or payroll taxes: once per payday.)
    if (o?.paydayPeriod && String(o.paymentMethod || '') === 'Bank feed' && !undone && /^payroll( taxes)?$/i.test(String(o.category || ''))) {
      const r = runOf.get(String(o.paydayPeriod)); if (!r || claimed.has(String(r.periodKey))) continue; claimed.add(String(r.periodKey));
      amount += Math.max(0, (Number(r.viaBankCents) || 0) / 100 - (Number(r.employeesTotal) || 0)); booked = true;
    }
  }
  return booked ? { amount: Math.round(Math.max(0, amount) * 100) / 100, booked: true } : { amount: Math.round(gross * pct) / 100, booked: false };
}
export function payrollCsv(txns: Txn[], staff: any[], profile: { code: string; employerPayrollTaxPct: number }, runs: any[] = []) {
  const list = payrollRows(txns, staff, runs); const gross = list.reduce((s, r) => s + r.total, 0); const er = employerTaxesOf(txns, gross, profile.employerPayrollTaxPct, runs);
  const taxed = list.some((r) => r.withheld != null); const r2 = (n: number) => Math.round(n * 100) / 100;
  return [['Person', 'Payouts', 'Paid', ...(taxed ? ['Withheld', 'Take-home'] : [])], ...list.map((r) => [r.name, r.count, r2(r.total), ...(taxed ? [r.withheld == null ? '' : r2(r.withheld), r.takeHome == null ? '' : r2(r.takeHome)] : [])]),
    ['Total pay', '', r2(gross)], [er.booked ? 'Employer payroll taxes, in your books' : `Employer payroll taxes, estimated (${profile.employerPayrollTaxPct}%)`, '', er.amount]];
}

export function buildPayrollRegisterHtml(
  txns: Txn[], staff: any[], profile: { code: string; employerPayrollTaxPct: number },
  range: Range, hasStateSet: boolean, currency = 'USD', opts: ReportOptions = {},
) {
  const list = payrollRows(txns, staff, opts.payrollRuns || []);
  const gross = list.reduce((s, r) => s + r.total, 0);
  const er = employerTaxesOf(txns, gross, profile.employerPayrollTaxPct, opts.payrollRuns || []); const employerTaxes = er.amount;
  const taxed = list.some((r) => r.withheld != null); const cols = taxed ? 5 : 3;
  const body = `
    <h2>Pay by person</h2>
    <table><thead><tr><th>Person</th><th>Payouts</th><th class="r">Paid</th>${taxed ? '<th class="r">Withheld</th><th class="r">Take-home</th>' : ''}</tr></thead><tbody>
      ${list.map(r => `<tr><td>${esc(r.name)}</td><td>${r.count}</td><td class="r">${printMoney(r.total, currency)}</td>${taxed ? `<td class="r">${r.withheld == null ? '' : printMoney(r.withheld, currency)}</td><td class="r">${r.takeHome == null ? '' : printMoney(r.takeHome, currency)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${cols}" class="faint">No pay in this period.</td></tr>`}
    </tbody></table>
    ${printLine('Total pay', gross, 'total')}
    ${printLine(er.booked ? 'Employer payroll taxes, in your books' : `Employer payroll taxes, estimated (${hasStateSet ? `${esc(profile.code)}, ` : 'federal only, '}${profile.employerPayrollTaxPct}%)`, employerTaxes, 'sub')}
    ${printLine('Total cost of pay', gross + employerTaxes, 'total')}
  `;
  return printPage({
    title: 'Payroll register', heading: 'Payroll <b>register</b>', subtitle: esc(periodLabel(range)), shopName: opts.shopName,
    body,
    footNote: er.booked ? 'Employer taxes are the ones in your books for these dates. Withheld and take-home are each payday’s own, when payroll is worked out in ClarityFlow.' : `Employer taxes are estimates (FICA, FUTA and an approximate SUTA${hasStateSet ? '' : '; set your state in Payday for your state’s figures'}). When Gusto is connected, Gusto’s filings are the record.`,
    footRight: esc(periodLabel(range)),
  });
}

// ─── Audit trail ──────────────────────────────────────────────────────────────

/** What an action in the audit log was, in plain words. */
const ACTION_WORDS: Record<string, string> = {
  'transaction.create': 'Added a line', 'transaction.revert': 'Undid a line', 'transaction.recategorize': 'Changed a category', 'transaction.correct': 'Added a correction',
  'transaction.refund': 'Gave a refund', 'transaction.auto_book': 'Sorted a bank line', 'retail.refund': 'Refunded an order', 'rent.card_refund': 'Refunded rent',
  'bank.match': 'Matched a bank line', 'bank.unmatch': 'Undid a bank match', 'bank.book': 'Booked a bank line', 'bank.ignore': 'Skipped a bank line',
  'bank.accept_all': 'Booked bank lines as picked', 'bank.recategorize': 'Changed a bank line’s category', 'bill.pay': 'Paid a bill',
  'rule.update': 'Changed a payee’s category', 'rule.delete': 'Forgot a payee', 'rule.money': 'Changed a money rule',
  'salestax.paid': 'Recorded sales tax as paid', 'salestax.unpaid': 'Took back a sales tax payment',
  'payroll.tax_paid': 'Marked payroll taxes paid', 'payroll.tax_unpaid': 'Took back a payroll tax payment',
  'books.month_closed': 'Closed a month', 'books.month_reopened': 'Reopened a month',
  'payroll.draft_created': 'Started a payroll', 'payroll.submit_gusto': 'Sent payroll to Gusto', 'payroll.distribute': 'Paid the team', 'payroll.prior': 'Put in pay from before ClarityFlow', 'payroll.prior_removed': 'Took out pay from before ClarityFlow', 'gusto.connected': 'Connected Gusto',
  'rent.payment_recorded': 'Recorded a rent payment', 'rent.paid_online': 'Rent paid online', 'rent.invoice': 'Sent a rent invoice', 'rent.marked_late': 'Marked rent late',
  'deposit.paid': 'A deposit was paid', 'deposit.waived': 'Waived a deposit', 'deposit.moved': 'Moved a deposit', 'balance.paid': 'A balance was paid', 'balance.paid_online': 'A balance was paid online',
  'fee.paid': 'A fee was paid', 'fee.waived': 'Waived a fee', 'fee.auto_refunded': 'Refunded a fee', 'night.close': 'Closed the night', 'tab.void': 'Voided a check', 'tab.comp': 'Comped an item',
  'mileage.rate': 'Changed the mileage rate', 'inventory.order': 'Ordered stock', 'inventory.cost': 'Changed a cost', 'records.tips_declared': 'Declared tips', 'card.saved': 'Saved a card',
  'debt.collect': 'Marked a fee paid', 'debt.charge_card': 'Charged a saved card',
};
/** Whether the action has its own plain words (the rest are worked out from its name). */
export const knownAction = (action: unknown): boolean => !!ACTION_WORDS[String(action || '')];
export const actionWords = (action: unknown): string => {
  const a = String(action || '');
  if (ACTION_WORDS[a]) return ACTION_WORDS[a];
  const last = a.split('.').pop() || ''; const w = last.replace(/_+/g, ' ').trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : 'Something changed';
};
const whoOf = (a: any) => (a?.type === 'system' ? 'Done for you' : String(a?.name || 'The owner'));
/** What was written about it, with any dots between words (older entries) read as commas. */
const plain = (v: unknown) => String(v || '').replace(/ · /g, ', ');

export function auditCsv(entries: any[]) {
  return [['When', 'Who', 'What happened', 'Detail', 'Amount'], ...entries.map((e) => [e.at ? format(new Date(e.at), 'yyyy-MM-dd HH:mm') : '', whoOf(e.actor), actionWords(e.action), plain(e.summary), typeof e.amount === 'number' ? Math.round(e.amount * 100) / 100 : ''])];
}

export function buildAuditTrailHtml(entries: any[], range: Range, currency = 'USD', opts: ReportOptions & { capped?: boolean } = {}) {
  const systemCount = entries.filter(e => e.actor?.type === 'system').length;
  const who = (a: any) => a?.type === 'system' ? `<span class="pill">Done for you</span>` : esc(a?.name || 'The owner');
  const body = `
    <p class="muted" style="margin-bottom:12px">${entries.length} action${entries.length === 1 ? '' : 's'}: ${entries.length - systemCount} by people, ${systemCount} done for you.${opts.capped ? ' These are the latest; pick fewer days to see the rest.' : ''}</p>
    <table><thead><tr><th>When</th><th>Who</th><th>What happened</th><th>Detail</th><th class="r">Amount</th></tr></thead><tbody>
      ${entries.map(e => `<tr>
        <td class="nowrap muted">${e.at ? format(new Date(e.at), 'MMM d, h:mm a') : ''}</td>
        <td>${who(e.actor)}</td>
        <td>${esc(actionWords(e.action))}</td>
        <td>${esc(plain(e.summary))}</td>
        <td class="r">${typeof e.amount === 'number' ? printMoney(e.amount, currency) : ''}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="faint">Nothing in this period.</td></tr>'}
    </tbody></table>
  `;
  return printPage({
    title: 'Audit trail', heading: 'Audit <b>trail</b>', subtitle: `Every money action, ${esc(periodLabel(range))}`, shopName: opts.shopName,
    body,
    footNote: 'Each entry is written when it happens and never changed; a correction is a new entry.',
    footRight: esc(periodLabel(range)),
  });
}

// ─── Sales tax, for filing ────────────────────────────────────────────────────

export function salesTaxCsv(r: TaxReport) {
  return [['Line', 'Amount'], ['All sales', r.allSales], ...(r.taxFree ? [['Sold tax free to resellers', -r.taxFree]] : []), ...(r.viaApps ? [['Sold through delivery apps that collect the tax themselves', -r.viaApps]] : []),
    ['Not taxed', -r.notTaxed], ['Taxable sales', r.taxable], ['Sales tax collected', r.collected], ...(r.givenBack ? [['Given back on refunds and voids', -r.givenBack]] : []), ['Sales tax to pay', r.toPay],
    [], ['Location', 'Rate', 'Taxable sales', 'Tax to pay'], ...r.places.map((p) => [p.name, p.rate, p.taxable, p.tax])] as (string | number)[][];
}

/** The sales tax report for a period (lib/sales-tax-report): what the return asks for, then by location. `paid`: when it
 *  was recorded as paid, and how much. */
export function buildSalesTaxHtml(r: TaxReport, opts: ReportOptions & { paid?: { at: string; cents: number } | null } = {}) {
  const cur = opts.currency || 'USD';
  const body = `
    <h2>What your return asks for</h2>
    ${printLine('All sales', r.allSales)}
    ${r.taxFree ? printLine('Sold tax free to resellers (keep their certificates)', -r.taxFree, 'sub') : ''}
    ${r.viaApps ? printLine('Sold through delivery apps that collect the tax themselves', -r.viaApps, 'sub') : ''}
    ${printLine('Not taxed (services where they aren’t taxed, fees, anything rung in untaxed)', -r.notTaxed, 'sub')}
    ${printLine('Taxable sales', r.taxable, 'total')}
    ${printLine('Sales tax collected', r.collected)}
    ${r.givenBack ? printLine('Given back on refunds and voids', -r.givenBack, 'sub') : ''}
    ${printLine('Sales tax to pay', r.toPay, 'total')}
    <h2>By location</h2>
    <table><thead><tr><th>Location</th><th class="r">Rate</th><th class="r">Taxable sales</th><th class="r">Tax to pay</th></tr></thead><tbody>
      ${r.places.map((p) => `<tr><td>${esc(p.name)}${p.address ? `<div class="faint">${esc(p.address)}</div>` : ''}</td><td class="r">${esc(p.rate)}</td><td class="r">${printMoney(p.taxable, cur)}</td><td class="r">${printMoney(p.tax, cur)}</td></tr>`).join('')}
    </tbody></table>
    ${opts.paid ? `<h2>Paid to the state</h2>${opts.paid.cents > 0 ? printLine(`Recorded as paid ${esc(format(new Date(opts.paid.at), 'MMMM d, yyyy'))}`, opts.paid.cents / 100) : printLine(`Filed ${esc(format(new Date(opts.paid.at), 'MMMM d, yyyy'))}, nothing to pay`, 0)}` : ''}
  `;
  const notes = ['Sales are what clients paid before tax and tips; tips are never taxed. Gift cards are taxed when they’re used, not when they’re sold.'];
  notes.push('Days are your business’s own, in its time zone. Taxable sales and tax to pay by location are after refunds.');
  if (r.estimated) notes.push('For some sales and refunds, what was taxed is worked out from their tax and the rate charged.');
  return printPage({
    title: `Sales tax, ${r.period.label}`, heading: `Sales tax, <b>${esc(r.period.label)}</b>`, subtitle: `${esc(format(new Date(`${r.period.start}T12:00:00Z`), 'MMMM d'))} to ${esc(format(new Date(`${r.period.end}T12:00:00Z`), 'MMMM d, yyyy'))}. Due ${esc(r.period.dueLabel)}.`,
    shopName: opts.shopName, body,
    footNote: `${notes.join(' ')} Check it against your state’s return before you file.`,
    footRight: esc(r.period.label),
  });
}

// ─── Every line ───────────────────────────────────────────────────────────────
// The same figures as the screen, then every checkout and online order with its lines, the other entries, and the
// receipt pictures at the back. Each line says what it is in the books (a sale, a refund, a tip, the sales tax, a card
// fee) in a quiet pill rather than a rainbow of colors.

const SIDE_LABEL: Record<string, { label: string; tone?: 'ok' | 'warn' }> = {
  sales: { label: 'Sale', tone: 'ok' }, returns: { label: 'Refund', tone: 'warn' }, discounts: { label: 'Discount' }, tax: { label: 'Sales tax' },
  tips: { label: 'Tip' }, other: { label: 'Other income' }, held: { label: 'Held' }, transfer: { label: 'Transfer' }, cogs: { label: 'Cost of goods' },
  fees: { label: 'Card fee' }, opex: { label: 'Expense' }, taxpaid: { label: 'Sales tax paid' }, skip: { label: 'Note' },
};
const INCOME_SIDES = new Set(['sales', 'tips', 'other', 'tax', 'held']);
const refOf = (id: string) => String(id || '').slice(-6).toUpperCase();
const fmtD = (d: any, f: string) => { try { return format(d?.toDate ? d.toDate() : new Date(d), f); } catch { return ''; } };
/** What a line comes to, the way the books read it: money in plus, money out minus. */
function shownOf(t: any, byId: Map<string, any>) {
  const e = effectOf(t, byId);
  const value = e.side === 'transfer' || e.side === 'skip' ? Math.abs(Number(t.amount) || 0) : INCOME_SIDES.has(e.side) ? e.amount : -e.amount;
  return { e, value, pill: SIDE_LABEL[e.side] || SIDE_LABEL.skip };
}

export function ledgerCsv(lines: Txn[], staff: any[], opts: { lookup?: Txn[] } = {}) {
  const byId = lookupOf(opts.lookup, lines); const name = (id?: string) => (id ? staff.find((m: any) => m.id === id)?.name : '') || '';
  return [['Date', 'Time', 'Description', 'Client or vendor', 'Category', 'In the books', 'Amount', 'Paid with', 'Books', 'Team member', 'Matched to the bank', 'Ref'],
    ...[...lines].sort((a, b) => fmtD(a.date, 'yyyy-MM-dd HH:mm').localeCompare(fmtD(b.date, 'yyyy-MM-dd HH:mm'))).map((t) => { const v = shownOf(t, byId);
      return [fmtD(t.date, 'yyyy-MM-dd'), fmtD(t.date, 'HH:mm'), String(t.description || ''), String(t.clientOrVendor || ''), String(t.category || ''), v.pill.label, Math.round(v.value * 100) / 100,
        String(t.paymentMethod || ''), t.context === 'Personal' ? 'Personal' : 'Business', name(t.staffId), t.reconciled || t.bankTransactionId ? 'Yes' : '', refOf(t.checkoutSessionId || t.retailOrderId || t.id)]; })];
}

export function buildLedgerHtml(transactions: Txn[], staff: any[], summary: BooksSummary, range: Range, opts: { lookup?: any[]; shopName?: string } = {}) {
  const byId = lookupOf(opts.lookup, transactions);
  const period = periodLabel(range);
  const staffName = (id?: string) => (id ? staff.find((m: any) => m.id === id)?.name : '') || '';
  const pillHtml = (p: { label: string; tone?: string }) => `<span class="pill ${p.tone || ''}">${p.label}</span>`;

  // Checkouts at the desk and online orders, each with its lines; everything else on its own.
  const groups = new Map<string, any[]>(); const loose: any[] = [];
  for (const t of transactions) {
    const key = t.checkoutSessionId ? `cs:${t.checkoutSessionId}` : t.retailOrderId ? `ro:${t.retailOrderId}` : '';
    if (key) { if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(t); } else loose.push(t);
  }
  const sessions = [...groups.entries()].map(([key, lines]) => {
    const first = lines[0];
    const sum = (side: string) => lines.reduce((a, t) => { const x = shownOf(t, byId); return x.e.side === side ? a + x.value : a; }, 0);
    const total = lines.reduce((a, t) => { const x = shownOf(t, byId); return x.e.side === 'fees' || x.e.side === 'transfer' || x.e.side === 'skip' ? a : a + x.value; }, 0);
    return { key, first, lines, items: sum('sales'), tax: sum('tax'), tips: sum('tips'), off: sum('discounts') + sum('returns'), fees: sum('fees'), total };
  }).sort((a, b) => new Date(b.first.date).getTime() - new Date(a.first.date).getTime());

  const appendix: { n: number; desc: string; when: string; who: string; url: string }[] = [];
  const picOf = new Map<string, number>();
  for (const t of [...sessions.flatMap((x) => x.lines), ...loose]) {
    if (!t.receiptUrl || picOf.has(t.id)) continue;
    picOf.set(t.id, appendix.length + 1);
    appendix.push({ n: appendix.length + 1, desc: String(t.description || ''), when: fmtD(t.date, 'MMM d, yyyy, h:mm a'), who: String(t.clientOrVendor || ''), url: String(t.receiptUrl) });
  }
  const picTag = (t: any) => (picOf.get(t.id) ? ` <span class="pill">Receipt ${picOf.get(t.id)}</span>` : '');

  const sessionHtml = sessions.map((x) => {
    const lineRows = x.lines.map((t) => {
      const v = shownOf(t, byId); const who = staffName(t.staffId);
      return `<tr><td>${pillHtml(v.pill)} ${esc(t.description || t.category || '')}${who ? ` <span class="muted">(${esc(who.split(' ')[0])})</span>` : ''}${picTag(t)}</td>
        <td class="muted nowrap">${fmtD(t.date, 'h:mm a')}</td><td class="r">${printMoney(v.value)}</td></tr>`;
    }).join('');
    const parts = [x.items ? `Items ${printMoney(x.items)}` : '', x.tax ? `tax ${printMoney(x.tax)}` : '', x.tips ? `tip ${printMoney(x.tips)}` : '', x.off ? `off ${printMoney(x.off)}` : ''].filter(Boolean).join(', ');
    return `<div class="box keep" style="margin-bottom:12px;padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;gap:12px;padding:10px 14px;background:#f5f5f7">
        <div><b>${esc(x.first.clientOrVendor || 'Guest')}</b><div class="muted">${fmtD(x.first.date, 'MMM d, yyyy, h:mm a')}${x.first.paymentMethod ? `, ${esc(x.first.paymentMethod)}` : ''}</div></div>
        <div class="r"><b>${printMoney(x.total)}</b><div class="faint">${x.key.startsWith('ro:') ? 'Online order' : 'Checkout'} ${refOf(x.key.slice(3))}</div></div>
      </div>
      <table><tbody>${lineRows}</tbody></table>
      <div class="muted" style="padding:8px 14px">${parts}${parts ? '. ' : ''}<b>Total ${printMoney(x.total)}</b>${x.fees ? ` <span class="faint">Card fee ${printMoney(-x.fees)}, the business’s cost, not the client’s.</span>` : ''}</div>
    </div>`;
  }).join('');

  const looseHtml = loose.map((t) => {
    const v = shownOf(t, byId);
    return `<tr><td class="muted nowrap">${fmtD(t.date, 'MMM d, h:mm a')}</td>
      <td>${esc(t.description || '')}${picTag(t)}<div class="muted">${esc(t.clientOrVendor || '')}</div></td>
      <td>${pillHtml(v.pill)} <span class="muted">${esc(t.category || '')}</span></td><td class="muted">${esc(staffName(t.staffId))}</td>
      <td class="muted">${esc(t.paymentMethod || '')}</td><td class="r">${printMoney(v.value)}</td></tr>`;
  }).join('');

  const catRows = (list: [string, number][], none: string) => list.length ? list.map(([c, a]) => printLine(esc(c), a, 'sub')).join('') : `<p class="faint">${none}</p>`;
  const body = `
  <div class="grid2">
    <div class="box">
      <h3 style="margin-top:0">Summary</h3>
      ${printLine('Sales', summary.sales)}
      ${summary.returns ? printLine('Returns and refunds', -summary.returns, 'sub') : ''}
      ${summary.discounts ? printLine('Discounts and deposits used', -summary.discounts, 'sub') : ''}
      ${printLine('Net sales', summary.netSales, 'total')}
      ${summary.tips ? printLine('Tips for the team', summary.tips) : ''}
      ${summary.otherIncome ? printLine('Other income', summary.otherIncome) : ''}
      ${printLine('Cost of goods', -summary.cogs)}
      ${printLine('Card fees', -summary.netFees)}
      ${printLine('Other expenses', -summary.operatingExpenses)}
      ${printLine('Net income', summary.net, 'total', summary.net >= 0 ? 'ok' : 'bad')}
    </div>
    <div class="box">
      <h3 style="margin-top:0">Held, not income</h3>
      ${printLine('Sales tax collected', summary.taxCollected)}
      ${summary.taxRefunded ? printLine('Given back on refunds and voids', -summary.taxRefunded, 'sub') : ''}
      ${printLine('Sales tax owed', summary.taxOwed, 'total')}
      ${summary.taxPaid ? printLine('Paid to the state', summary.taxPaid, 'sub') : ''}
      ${summary.taxFreeSales ? printLine('Sold tax free to resellers', summary.taxFreeSales, 'sub') : ''}
      ${summary.giftCardsSold ? printLine('Gift cards sold', summary.giftCardsSold) : ''}
      ${summary.heldForRenters ? printLine('Taken for renters', summary.heldForRenters) : ''}
      <h3>Card fees</h3>
      ${printLine('Passed on to clients', summary.feesPassedOn)}
      ${printLine('Paid to Stripe', -summary.feesPaid)}
      ${summary.feesBack ? printLine('Returned by Stripe', summary.feesBack, 'sub') : ''}
      ${printLine('Card fees, net', summary.feesPassedOn - summary.netFees, 'total')}
    </div>
  </div>
  <div class="grid2" style="margin-top:12px">
    <div class="box"><h3 style="margin-top:0">Sales by category</h3>${catRows(summary.byCategory.sales, 'No sales this period.')}</div>
    <div class="box"><h3 style="margin-top:0">Expenses by category</h3>${catRows([...summary.byCategory.cogs, ...summary.byCategory.opex].sort((a, b) => b[1] - a[1]), 'No expenses this period.')}</div>
  </div>
  ${sessions.length ? `<h2>Checkouts and online orders (${sessions.length})</h2>${sessionHtml}` : ''}
  ${loose.length ? `<h2>Everything else (${loose.length})</h2>
  <table><thead><tr><th>Date</th><th>Description</th><th>In the books</th><th>Team</th><th>Paid with</th><th class="r">Amount</th></tr></thead><tbody>${looseHtml}</tbody></table>` : ''}
  ${appendix.length ? `<div class="break"></div><h2>Receipts (${appendix.length})</h2>
  <div class="grid2">${appendix.map((a) => `<div class="box keep"><div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:8px"><b>Receipt ${a.n}</b><span class="muted r">${esc(a.desc)}<br>${esc([a.who, a.when].filter(Boolean).join(', '))}</span></div>
    <img src="${esc(a.url)}" alt="Receipt ${a.n}" style="width:100%;max-height:280px;object-fit:contain;display:block;border-radius:10px" /></div>`).join('')}</div>` : ''}`;

  return printPage({
    title: 'Every line', heading: 'Every <b>line</b>', subtitle: esc(period), shopName: opts.shopName, body,
    footNote: `${transactions.length} line${transactions.length === 1 ? '' : 's'}, ${sessions.length} checkout${sessions.length === 1 ? '' : 's'} and order${sessions.length === 1 ? '' : 's'}. Sales tax and gift cards sold are held, not income.`,
    footRight: esc(period),
  });
}

// ─── A closed month's statement ───────────────────────────────────────────────

export type MonthStatement = {
  month: string; label: string; start: string; end: string; closedAt: string | null; closedBy: string | null;
  figures: { sales: number; returns: number; discounts: number; netSales: number; tips: number; otherIncome: number; cogs: number; fees: number; teamPay: number; otherCosts: number; costs: number; profit: number };
  tax: { collected: number; givenBack: number; owed: number; paid: number; period?: { label: string; due: string; paid: boolean } | null };
  bank: { total: number; sorted: number; waiting: number } | null;
  held: { giftCards: number; renters: number };
  corrections: { date: string; description: string; amount: number; by: string }[];
};

export function statementRows(st: MonthStatement): ReportRow[] {
  const f = st.figures;
  return [
    H('Profit and loss'), L('Sales', f.sales), ...(f.returns ? [L('Refunds and returns', -f.returns, 'sub')] : []), ...(f.discounts ? [L('Discounts and deposits used', -f.discounts, 'sub')] : []),
    L('Net sales', f.netSales, 'total'), ...(f.tips ? [L('Tips for the team', f.tips)] : []), ...(f.otherIncome ? [L('Other income', f.otherIncome)] : []),
    L('Cost of goods', -f.cogs), L('Card fees', -f.fees), L('Team pay', -f.teamPay), L('Other costs', -f.otherCosts), L('Profit', f.profit, 'total', f.profit >= 0 ? 'ok' : 'bad'),
    H('Sales tax'), L(`Collected in ${st.label}`, st.tax.collected), ...(st.tax.givenBack ? [L('Given back on refunds and voids', -st.tax.givenBack, 'sub')] : []),
    L(`Owed for ${st.label}`, st.tax.owed, 'total'), ...(st.tax.paid ? [L('Paid to the state in the month', st.tax.paid, 'sub')] : []),
    ...(st.tax.period ? [L(`Return for ${st.tax.period.label}`, st.tax.period.paid ? 'Recorded as paid' : `Due ${st.tax.period.due}`, 'memo')] : []),
    ...(st.bank ? [H('Your bank'), L('Lines from the bank', String(st.bank.total)), L('Matched to your books or sorted', String(st.bank.sorted)), L('Waiting to be sorted', st.bank.waiting ? String(st.bank.waiting) : 'None', '', st.bank.waiting ? 'warn' : '')] : []),
    ...(st.held.giftCards || st.held.renters ? [H('Held, never yours'), ...(st.held.giftCards ? [L('Gift cards sold', st.held.giftCards)] : []), ...(st.held.renters ? [L('Taken for renters', st.held.renters)] : [])] : []),
    H('Corrected after it closed'),
    ...(st.corrections.length ? st.corrections.map((c) => L(`${c.description}, added ${fmtD(`${c.date}`, 'MMM d')}${c.by ? ` by ${c.by}` : ''}`, c.amount)) : [{ label: 'Nothing has been corrected.', amount: '', note: 'none' } as ReportRow]),
  ];
}
export const statementCsv = (st: MonthStatement) => rowsCsv(statementRows(st));

export function buildMonthStatementHtml(st: MonthStatement, opts: ReportOptions = {}) {
  const stat = (v: number, l: string, tone = '') => `<div class="panel stat"><div class="v ${tone}">${printMoney(v)}</div><div class="l">${l}</div></div>`;
  // (The three add up: what came in, less costs, is the profit.)
  const f = st.figures; const extra = f.tips + f.otherIncome; const inn = f.netSales + extra;
  const closed = st.closedAt ? `Closed ${esc(fmtD(st.closedAt, 'MMMM d'))}${st.closedBy ? ` by ${esc(st.closedBy)}` : ''}.` : '';
  return printPage({
    title: `Statement, ${st.label}`, heading: `Statement, <b>${esc(st.label)}</b>`,
    subtitle: `${esc(fmtD(`${st.start}T12:00:00`, 'MMMM d'))} to ${esc(fmtD(`${st.end}T12:00:00`, 'MMMM d, yyyy'))}. ${closed}`, shopName: opts.shopName,
    body: `<div class="grid3" style="margin-bottom:6px">${stat(inn, !extra ? 'Net sales' : f.tips && f.otherIncome ? 'Net sales, tips and other income' : f.tips ? 'Net sales and tips' : 'Net sales and other income')}${stat(f.costs, 'Costs')}${stat(f.profit, 'Profit', f.profit >= 0 ? 'ok' : 'bad')}</div>${rowsHtml(statementRows(st))}`,
    footNote: 'Corrections go in the day they’re made, so the month stays as it was closed. Check with your accountant before filing.',
    footRight: esc(st.label),
  });
}
