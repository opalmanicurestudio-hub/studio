// src/lib/report-builders.ts
//
// Printable report builders for the Money Hub's Reports menu.
// Each returns a complete standalone HTML document to write into a print
// window (same pattern as the existing Studio Financial Report).
//
//   buildPnlHtml             — accountant-standard Profit & Loss
//   buildTaxSummaryHtml      — Schedule C-mapped tax summary (US)
//   buildPayrollRegisterHtml — per-staff payroll register + employer taxes
//   buildAuditTrailHtml      — the append-only audit log, printable
//
// Correctness notes baked in:
//   • Distributions / owner draws (taxBucket 'transfer') are EXCLUDED from
//     P&L expenses — owner pay is not a business expense for a sole prop.
//   • Tax Collected is a liability, never revenue.
//   • Reversals net against their side rather than inflating expenses.

import { scheduleCFor } from './categories';
import { format } from 'date-fns';

type Txn = any;
type Range = { from?: Date; to?: Date } | undefined;

const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

const periodLabel = (range: Range) =>
  range?.from && range?.to
    ? `${format(range.from, 'MMM d, yyyy')} – ${format(range.to, 'MMM d, yyyy')}`
    : 'All Dates';

const sum = (list: Txn[]) => list.reduce((s, t) => s + (t.amount || 0), 0);

const row = (label: string, amount: number, opts: { bold?: boolean; color?: string; indent?: boolean; currency?: string } = {}) =>
  `<div style="display:flex;justify-content:space-between;padding:${opts.bold ? '8px' : '4px'} 0 ${opts.bold ? '4px' : '4px'};font-size:${opts.bold ? '13px' : '12px'};${opts.bold ? 'font-weight:900;border-top:2px solid #111;margin-top:6px;' : 'border-bottom:1px solid #f3f4f6;'}${opts.indent ? 'padding-left:16px;' : ''}">
    <span style="color:${opts.bold ? '#111' : '#555'};">${label}</span>
    <span style="font-family:monospace;font-weight:700;color:${opts.color || '#111'};">${money(amount, opts.currency)}</span>
  </div>`;

function shell(title: string, subtitle: string, range: Range, bodyHtml: string, footNote?: string) {
  return `<!DOCTYPE html><html><head><title>${title}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,sans-serif; color:#111; padding:32px; max-width:800px; margin:0 auto; }
    h1 { font-size:24px; font-weight:900; text-transform:uppercase; letter-spacing:-0.03em; }
    h2 { font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:0.1em; margin:26px 0 10px; border-bottom:2px solid #111; padding-bottom:6px; }
    table { width:100%; border-collapse:collapse; }
    th { background:#f8fafc; text-align:left; padding:7px 8px; font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:0.08em; color:#6b7280; border-bottom:2px solid #e5e7eb; }
    td { padding:6px 8px; font-size:11px; border-bottom:1px solid #f3f4f6; vertical-align:top; }
    @media print { @page { size:A4; margin:0.65in; } body { padding:0; } }
  </style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:18px;border-bottom:3px solid #111;">
    <div>
      <h1>${title}</h1>
      <div style="font-size:12px;color:#6b7280;font-weight:600;margin-top:4px;">${subtitle}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px;">Period: ${periodLabel(range)}</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:2px;">Generated ${format(new Date(), 'MMMM d, yyyy · h:mm a')}</div>
    </div>
    <div style="text-align:right;font-size:10px;color:#9ca3af;">
      <div style="font-weight:700;">ClarityFlow</div><div>Studio Management</div><div style="margin-top:4px;">Confidential</div>
    </div>
  </div>
  ${bodyHtml}
  ${footNote ? `<div style="margin-top:28px;padding:12px 16px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;font-size:9px;color:#6b7280;line-height:1.6;">${footNote}</div>` : ''}
  <div style="margin-top:32px;border-top:2px solid #111;padding-top:12px;display:flex;justify-content:space-between;font-size:9px;color:#9ca3af;">
    <div>ClarityFlow — Confidential, Not for Distribution</div>
    <div>${periodLabel(range)}</div>
  </div>
  </body></html>`;
}

const byCategory = (txns: Txn[]) => {
  const m = new Map<string, number>();
  txns.forEach(t => m.set(t.category, (m.get(t.category) || 0) + (t.amount || 0)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

// ─── Profit & Loss ────────────────────────────────────────────────────────────

export function buildPnlHtml(txns: Txn[], range: Range, currency = 'USD') {
  const COGS_CATS = new Set(['Cost of Goods Sold', 'Spoilage', 'Supplies']);
  const isTransfer = (t: Txn) => t.taxBucket === 'transfer' || t.category === 'Distribution';

  const income   = txns.filter(t => t.type === 'income');
  const expenses = txns.filter(t => (t.type === 'expense' || t.type === 'payment') && !isTransfer(t));
  const reversals = sum(txns.filter(t => t.type === 'reversal'));
  const transfers = sum(txns.filter(t => (t.type === 'expense' || t.type === 'payment') && isTransfer(t)));

  const taxCollected = sum(income.filter(t => t.category === 'Tax Collected'));
  const revenueTxns  = income.filter(t => t.category !== 'Tax Collected');
  const revenue      = sum(revenueTxns) - reversals;
  const cogsTxns     = expenses.filter(t => COGS_CATS.has(t.category));
  const cogs         = sum(cogsTxns);
  const opexTxns     = expenses.filter(t => !COGS_CATS.has(t.category));
  const grossProfit  = revenue - cogs;
  const net          = grossProfit - sum(opexTxns);

  const body = `
    <h2>Revenue</h2>
    ${byCategory(revenueTxns).map(([c, a]) => row(c, a, { color: '#166534', currency })).join('')}
    ${reversals > 0 ? row('Less: refunds & reversals', -reversals, { color: '#991b1b', currency }) : ''}
    ${row('Total Revenue', revenue, { bold: true, color: '#166534', currency })}

    <h2>Cost of Goods & Supplies</h2>
    ${byCategory(cogsTxns).map(([c, a]) => row(c, a, { color: '#991b1b', currency })).join('') || row('None recorded', 0, { currency })}
    ${row('Gross Profit', grossProfit, { bold: true, currency })}

    <h2>Operating Expenses</h2>
    ${byCategory(opexTxns).map(([c, a]) => row(c, a, { color: '#991b1b', currency })).join('') || row('None recorded', 0, { currency })}
    ${row('Net Income', net, { bold: true, color: net >= 0 ? '#166534' : '#991b1b', currency })}

    <h2>Excluded From P&amp;L (memo)</h2>
    ${row('Sales tax collected (liability, held)', taxCollected, { color: '#64748b', currency })}
    ${row('Owner draws & internal transfers', transfers, { color: '#0f766e', currency })}
  `;
  return shell('Profit & Loss', 'Income statement', range, body,
    'Owner draws and internal transfers are not business expenses and are excluded from Net Income. Sales tax collected is a liability held for the state, not revenue. Prepared by ClarityFlow from the studio ledger — verify with your accountant.');
}

// ─── Tax Summary (Schedule C map) ─────────────────────────────────────────────

export function buildTaxSummaryHtml(txns: Txn[], range: Range, currency = 'USD') {
  const isTransfer = (t: Txn) => t.taxBucket === 'transfer' || t.category === 'Distribution';
  const income   = txns.filter(t => t.type === 'income');
  const expenses = txns.filter(t => (t.type === 'expense' || t.type === 'payment'));
  const reversals = sum(txns.filter(t => t.type === 'reversal'));

  const taxCollected  = sum(income.filter(t => t.category === 'Tax Collected'));
  const grossReceipts = sum(income.filter(t => t.category !== 'Tax Collected')) - reversals;

  // Group deductible expenses by Schedule C line
  const lines = new Map<string, number>();
  const nonDeductible = new Map<string, number>();
  expenses.forEach(t => {
    const line = scheduleCFor(t.category);
    const target = (isTransfer(t) || line.startsWith('Not deductible')) ? nonDeductible : lines;
    target.set(line, (target.get(line) || 0) + (t.amount || 0));
  });
  const sortedLines = [...lines.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const deductibleTotal = [...lines.values()].reduce((s, v) => s + v, 0);

  const body = `
    <h2>Income</h2>
    ${row('Line 1 — Gross receipts (net of returns)', grossReceipts, { color: '#166534', currency })}

    <h2>Deductible Expenses by Schedule C Line</h2>
    <table><thead><tr><th>Schedule C Line</th><th style="text-align:right;">Amount</th></tr></thead><tbody>
      ${sortedLines.map(([line, amt]) => `<tr><td>${line}</td><td style="text-align:right;font-family:monospace;font-weight:700;color:#991b1b;">${money(amt, currency)}</td></tr>`).join('') || '<tr><td colspan="2" style="color:#9ca3af;">No expenses this period.</td></tr>'}
    </tbody></table>
    ${row('Total deductions (mapped)', deductibleTotal, { bold: true, color: '#991b1b', currency })}
    ${row('Tentative profit (Line 1 − deductions)', grossReceipts - deductibleTotal, { bold: true, currency })}

    <h2>Not Deductible / Held (memo)</h2>
    ${[...nonDeductible.entries()].map(([line, amt]) => row(line, amt, { color: '#64748b', currency })).join('') || row('None', 0, { currency })}
    ${row('Sales tax collected — remit to state', taxCollected, { color: '#64748b', currency })}
  `;
  return shell('Tax Summary', 'Schedule C mapping (US sole proprietor / single-member LLC)', range, body,
    '⚠ PLANNING AID ONLY — NOT TAX ADVICE. Line mappings are conventional defaults; your accountant may classify differently (e.g., equipment capitalization, meals limits, home office). Self-employment tax, estimated payments, and state filings are not computed here.');
}

// ─── Payroll Register ─────────────────────────────────────────────────────────

export function buildPayrollRegisterHtml(
  txns: Txn[], staff: any[], profile: { code: string; employerPayrollTaxPct: number },
  range: Range, hasStateSet: boolean, currency = 'USD',
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
  const rows = [...byStaff.values()].sort((a, b) => b.total - a.total);
  const gross = rows.reduce((s, r) => s + r.total, 0);
  const employerTaxes = gross * (profile.employerPayrollTaxPct / 100);

  const body = `
    <h2>Payouts by Staff</h2>
    <table><thead><tr><th>Staff</th><th>Payouts</th><th style="text-align:right;">Gross Paid</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td style="font-weight:700;">${r.name}</td><td>${r.count}</td><td style="text-align:right;font-family:monospace;font-weight:700;">${money(r.total, currency)}</td></tr>`).join('') || '<tr><td colspan="3" style="color:#9ca3af;">No payroll payouts in this period.</td></tr>'}
    </tbody></table>
    ${row('Gross payroll', gross, { bold: true, currency })}
    ${row(`Est. employer payroll taxes (${hasStateSet ? profile.code : 'federal-only baseline'} · ${profile.employerPayrollTaxPct}%)`, employerTaxes, { color: '#92400e', currency })}
    ${row('Total payroll cost', gross + employerTaxes, { bold: true, currency })}
  `;
  return shell('Payroll Register', 'Staff payouts & employer tax estimate', range, body,
    `Employer taxes are estimates (FICA + FUTA + approximate SUTA${hasStateSet ? '' : ' — set your state in Payday for state-accurate numbers'}). When Gusto is connected, Gusto's filings are the authoritative record; this register is the studio-side view.`);
}

// ─── Audit Trail ──────────────────────────────────────────────────────────────

export function buildAuditTrailHtml(entries: any[], range: Range, currency = 'USD') {
  const actorChip = (a: any) => a?.type === 'system'
    ? `<span style="background:#e0f2fe;color:#075985;padding:1px 6px;border-radius:10px;font-size:8px;font-weight:900;text-transform:uppercase;">⚙ ${a.name || 'system'}</span>`
    : `<span style="background:#f1f5f9;color:#475569;padding:1px 6px;border-radius:10px;font-size:8px;font-weight:900;text-transform:uppercase;">👤 ${a?.name || 'owner'}</span>`;

  const systemCount = entries.filter(e => e.actor?.type === 'system').length;

  const body = `
    <div style="display:flex;gap:16px;margin-bottom:16px;font-size:11px;color:#6b7280;font-weight:600;">
      <span>${entries.length} actions</span><span>·</span>
      <span>${entries.length - systemCount} by people</span><span>·</span>
      <span>${systemCount} automated</span>
    </div>
    <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th><th style="text-align:right;">Amount</th></tr></thead><tbody>
      ${entries.map(e => `<tr>
        <td style="white-space:nowrap;color:#6b7280;">${e.at ? format(new Date(e.at), 'MMM d, h:mm a') : '—'}</td>
        <td>${actorChip(e.actor)}</td>
        <td style="font-family:monospace;font-size:10px;color:#475569;">${e.action || '—'}</td>
        <td>${e.summary || '—'}</td>
        <td style="text-align:right;font-family:monospace;font-weight:700;">${typeof e.amount === 'number' ? money(e.amount, currency) : ''}</td>
      </tr>`).join('') || '<tr><td colspan="5" style="color:#9ca3af;">No audit entries in this period.</td></tr>'}
    </tbody></table>
  `;
  return shell('Audit Trail', 'Append-only record of every money action', range, body,
    'Entries are written at the moment of each action and are never edited or deleted; corrections appear as new entries (e.g., transaction.revert). ⚙ marks automated actions (nightly bank sync, payroll drafts); 👤 marks human actions.');
}
