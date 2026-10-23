// src/lib/report-builders.ts
//
// Printable reports for the Money page's Reports menu, each a whole HTML document to open in a print window, in the
// app's print look (lib/print-style):
//   buildPnlHtml             — Profit & Loss
//   buildTaxSummaryHtml      — Schedule C summary (US)
//   buildPayrollRegisterHtml — pay by person, with the employer tax estimate
//   buildAuditTrailHtml      — the money audit log
//
// The figures come from lib/books-summary, the same reading of the ledger the Money page shows, so the paper and the
// screen always agree: refunds are returns (their sales tax comes off the tax owed), discounts and deposits applied
// come off sales, gift cards sold and money taken for renters are held, owner draws and transfers are left out, and
// sales tax is never income. Lines marked Personal are left out of the P&L and the tax summary.

import { scheduleCFor } from './categories';
import { booksSummary, effectOf, lookupOf } from './books-summary';
import { esc, printLine, printMoney, printPage } from './print-style';
import { format } from 'date-fns';

type Txn = any;
type Range = { from?: Date; to?: Date } | undefined;
export type ReportOptions = { lookup?: Txn[]; shopName?: string; currency?: string };

const periodLabel = (range: Range) =>
  range?.from && range?.to
    ? `${format(range.from, 'MMM d, yyyy')} – ${format(range.to, 'MMM d, yyyy')}`
    : 'All dates';

const rows = (list: [string, number][], kind: '' | 'sub' = 'sub', none = 'None recorded') =>
  list.length ? list.map(([c, a]) => printLine(esc(c), a, kind)).join('') : `<div class="line sub"><span class="faint">${none}</span><span></span></div>`;

// ─── Profit & Loss ────────────────────────────────────────────────────────────

export function buildPnlHtml(txns: Txn[], range: Range, currency = 'USD', opts: ReportOptions = {}) {
  const s = booksSummary(txns, { lookup: opts.lookup, businessOnly: true });
  const fees = [['Card processing fees', s.feesPaid], ...(s.feesBack ? [['Fees returned by Stripe', -s.feesBack]] : [])] as [string, number][];
  const body = `
    <h2>Income</h2>
    ${rows(s.byCategory.sales)}
    ${printLine('Sales', s.sales)}
    ${s.returns ? printLine('Less returns and refunds', -s.returns, 'sub') : ''}
    ${s.discounts ? printLine('Less discounts and deposits used', -s.discounts, 'sub') : ''}
    ${printLine('Net sales', s.netSales, 'total')}
    ${s.tips ? printLine('Tips collected for the team', s.tips) : ''}
    ${s.otherIncome ? printLine('Other income', s.otherIncome) : ''}
    ${printLine('Total income', s.income, 'total')}

    <h2>Cost of goods</h2>
    ${rows(s.byCategory.cogs)}
    ${printLine('Gross profit', s.grossProfit, 'total')}

    <h2>Expenses</h2>
    ${rows(fees)}
    ${rows(s.byCategory.opex)}
    ${printLine('Total expenses', s.netFees + s.operatingExpenses, 'total')}
    ${printLine('Net income', s.net, 'total', s.net >= 0 ? 'ok' : 'bad')}

    <h2>Not in the profit (for your records)</h2>
    ${printLine('Sales tax collected', s.taxCollected, 'memo')}
    ${s.taxRefunded ? printLine('Sales tax given back on refunds and voids', -s.taxRefunded, 'memo') : ''}
    ${printLine('Sales tax owed to the state', s.taxOwed, 'memo')}
    ${s.giftCardsSold ? printLine('Gift cards sold (counted as sales when used)', s.giftCardsSold, 'memo') : ''}
    ${s.heldForRenters ? printLine('Taken for booth renters', s.heldForRenters, 'memo') : ''}
    ${printLine('Owner draws and transfers', s.transfers, 'memo')}
    ${s.shippingCharged || s.shippingCost ? printLine('Shipping charged / shipping cost', `${printMoney(s.shippingCharged, currency)} / ${printMoney(s.shippingCost, currency)}`, 'memo') : ''}
  `;
  return printPage({
    title: 'Profit and loss', heading: 'Profit and <b>loss</b>', subtitle: periodLabel(range), shopName: opts.shopName,
    body,
    footNote: 'Tips are shown beside sales because the team’s pay, an expense, includes the tips paid out. Owner draws and transfers aren’t expenses. Sales tax is held for the state. Check with your accountant before filing.',
    footRight: periodLabel(range),
  });
}

// ─── Tax Summary (Schedule C map) ─────────────────────────────────────────────

export function buildTaxSummaryHtml(txns: Txn[], range: Range, currency = 'USD', opts: ReportOptions = {}) {
  const s = booksSummary(txns, { lookup: opts.lookup, businessOnly: true });
  // Expenses by Schedule C line, each net of what came back on it (a reversal, a fee Stripe returned, a postage refund).
  const byId = lookupOf(opts.lookup, txns);
  const lines = new Map<string, number>(); const notDeductible = new Map<string, number>();
  for (const t of txns) {
    if (String(t?.context || '').toLowerCase() === 'personal') continue;
    const e = effectOf(t, byId);
    if (e.side !== 'opex' && e.side !== 'fees' && e.side !== 'transfer') continue;
    const line = e.side === 'fees' ? scheduleCFor('Processing Fee') : e.side === 'transfer' ? 'Not deductible — owner draws and transfers' : scheduleCFor(e.category);
    const target = e.side === 'transfer' || line.startsWith('Not deductible') ? notDeductible : lines;
    target.set(line, (target.get(line) || 0) + e.amount);
  }
  const sortedLines = [...lines.entries()].filter(([, v]) => Math.abs(v) >= 0.005).sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
  const deductions = sortedLines.reduce((a, [, v]) => a + v, 0);
  const line1 = s.sales + s.tips;
  const line2 = s.returns + s.discounts;
  const line5 = line1 - line2 - s.cogs;
  const line7 = line5 + s.otherIncome;
  const body = `
    <h2>Income</h2>
    ${printLine('Line 1 — Gross receipts', line1)}
    ${s.tips ? printLine('Includes tips collected for the team', s.tips, 'sub') : ''}
    ${printLine('Line 2 — Returns and allowances', -line2)}
    ${s.returns ? printLine('Refunds and returns', -s.returns, 'sub') : ''}
    ${s.discounts ? printLine('Discounts and deposits used', -s.discounts, 'sub') : ''}
    ${printLine('Line 4 — Cost of goods sold', -s.cogs)}
    ${printLine('Line 5 — Gross profit', line5, 'total')}
    ${s.otherIncome ? printLine('Line 6 — Other income', s.otherIncome) : ''}
    ${printLine('Line 7 — Gross income', line7, 'total')}

    <h2>Expenses by Schedule C line</h2>
    <table><thead><tr><th>Line</th><th class="r">Amount</th></tr></thead><tbody>
      ${sortedLines.map(([line, amt]) => `<tr><td>${esc(line)}</td><td class="r">${printMoney(amt, currency)}</td></tr>`).join('') || '<tr><td colspan="2" class="faint">No expenses this period.</td></tr>'}
    </tbody></table>
    ${printLine('Total expenses', deductions, 'total')}
    ${printLine('Tentative profit (Line 7 less expenses)', line7 - deductions, 'total', line7 - deductions >= 0 ? 'ok' : 'bad')}

    <h2>Not deductible or held (for your records)</h2>
    ${[...notDeductible.entries()].map(([line, amt]) => printLine(esc(line), amt, 'memo')).join('')}
    ${printLine('Sales tax collected', s.taxCollected, 'memo')}
    ${s.taxRefunded ? printLine('Sales tax given back on refunds and voids', -s.taxRefunded, 'memo') : ''}
    ${printLine('Sales tax to pay the state', s.taxOwed, 'memo')}
    ${s.giftCardsSold ? printLine('Gift cards sold (income when they’re used)', s.giftCardsSold, 'memo') : ''}
    ${s.heldForRenters ? printLine('Taken for booth renters', s.heldForRenters, 'memo') : ''}
  `;
  return printPage({
    title: 'Tax summary', heading: 'Tax <b>summary</b>', subtitle: `Schedule C (US sole proprietor or single-member LLC) · ${periodLabel(range)}`, shopName: opts.shopName,
    body,
    footNote: 'A planning aid, not tax advice. The lines are common defaults; your accountant may place some differently (equipment, meals, a home office). Self-employment tax, estimated payments and state filings aren’t worked out here.',
    footRight: periodLabel(range),
  });
}

// ─── Payroll Register ─────────────────────────────────────────────────────────

export function buildPayrollRegisterHtml(
  txns: Txn[], staff: any[], profile: { code: string; employerPayrollTaxPct: number },
  range: Range, hasStateSet: boolean, currency = 'USD', opts: ReportOptions = {},
) {
  const payouts = txns.filter(t => t.category === 'Payroll' && (t.type === 'expense' || t.type === 'payment'));
  const byStaff = new Map<string, { name: string; count: number; total: number }>();
  payouts.forEach(t => {
    const key = t.staffId || t.clientOrVendor || 'unassigned';
    const name = staff.find((s: any) => s.id === t.staffId)?.name || t.clientOrVendor || 'Unassigned';
    const cur = byStaff.get(key) || { name, count: 0, total: 0 };
    cur.count += 1; cur.total += t.amount || 0;
    byStaff.set(key, cur);
  });
  const list = [...byStaff.values()].sort((a, b) => b.total - a.total);
  const gross = list.reduce((s, r) => s + r.total, 0);
  const employerTaxes = gross * (profile.employerPayrollTaxPct / 100);

  const body = `
    <h2>Pay by person</h2>
    <table><thead><tr><th>Person</th><th>Payouts</th><th class="r">Paid</th></tr></thead><tbody>
      ${list.map(r => `<tr><td>${esc(r.name)}</td><td>${r.count}</td><td class="r">${printMoney(r.total, currency)}</td></tr>`).join('') || '<tr><td colspan="3" class="faint">No pay in this period.</td></tr>'}
    </tbody></table>
    ${printLine('Total pay', gross, 'total')}
    ${printLine(`Employer payroll taxes, estimated (${hasStateSet ? esc(profile.code) : 'federal only'} · ${profile.employerPayrollTaxPct}%)`, employerTaxes, 'sub')}
    ${printLine('Total cost of pay', gross + employerTaxes, 'total')}
  `;
  return printPage({
    title: 'Payroll register', heading: 'Payroll <b>register</b>', subtitle: periodLabel(range), shopName: opts.shopName,
    body,
    footNote: `Employer taxes are estimates (FICA, FUTA and an approximate SUTA${hasStateSet ? '' : '; set your state in Payday for your state’s figures'}). When Gusto is connected, Gusto’s filings are the record.`,
    footRight: periodLabel(range),
  });
}

// ─── Audit Trail ──────────────────────────────────────────────────────────────

export function buildAuditTrailHtml(entries: any[], range: Range, currency = 'USD', opts: ReportOptions = {}) {
  const systemCount = entries.filter(e => e.actor?.type === 'system').length;
  const who = (a: any) => a?.type === 'system' ? `<span class="pill">Automatic · ${esc(a.name || 'system')}</span>` : `<span class="pill">${esc(a?.name || 'Owner')}</span>`;
  const body = `
    <p class="muted" style="margin-bottom:12px">${entries.length} actions · ${entries.length - systemCount} by people · ${systemCount} automatic</p>
    <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th><th class="r">Amount</th></tr></thead><tbody>
      ${entries.map(e => `<tr>
        <td class="nowrap muted">${e.at ? format(new Date(e.at), 'MMM d, h:mm a') : '—'}</td>
        <td>${who(e.actor)}</td>
        <td class="muted">${esc(e.action || '—')}</td>
        <td>${esc(e.summary || '—')}</td>
        <td class="r">${typeof e.amount === 'number' ? printMoney(e.amount, currency) : ''}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="faint">No entries in this period.</td></tr>'}
    </tbody></table>
  `;
  return printPage({
    title: 'Audit trail', heading: 'Audit <b>trail</b>', subtitle: `Every money action · ${periodLabel(range)}`, shopName: opts.shopName,
    body,
    footNote: 'Each entry is written when the action happens and is never edited or deleted; a correction is a new entry.',
    footRight: periodLabel(range),
  });
}
