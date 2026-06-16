'use client';

import React from 'react';
import { format } from 'date-fns';
import { type Transaction } from '@/lib/financial-data';
import { type Staff } from '@/lib/data';
import { DateRange } from 'react-day-picker';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { try { return new Date(val); } catch { return new Date(); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const fmt = (d: any, s: string) => { try { return format(safeDate(d), s); } catch { return '—'; } };

// ─── Color system ─────────────────────────────────────────────────────────────
// Each category maps to a background and text color for the printed report.
const CATEGORY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  'Service Revenue':   { bg: '#dbeafe', text: '#1e40af', label: 'Service' },
  'Tips':              { bg: '#fef9c3', text: '#854d0e', label: 'Tip' },
  'Tax Collected':     { bg: '#f3f4f6', text: '#374151', label: 'Tax' },
  'Retail':            { bg: '#dcfce7', text: '#166534', label: 'Retail' },
  'Retail Product':    { bg: '#dcfce7', text: '#166534', label: 'Retail' },
  'Membership Sales':  { bg: '#ede9fe', text: '#5b21b6', label: 'Membership' },
  'Package Sales':     { bg: '#f5f3ff', text: '#6d28d9', label: 'Package' },
  'Discounts':         { bg: '#fce7f3', text: '#9d174d', label: 'Discount' },
  'Refunds':           { bg: '#fee2e2', text: '#991b1b', label: 'Refund' },
  'Fee Recovery':      { bg: '#fff7ed', text: '#92400e', label: 'Fee' },
  'Protocol Recovery': { bg: '#fff7ed', text: '#c2410c', label: 'Recovery' },
  'Hospitality Revenue':{ bg: '#ecfdf5', text: '#065f46', label: 'Hospitality' },
  'Cancellation Fee':  { bg: '#fef3c7', text: '#92400e', label: 'Cancel Fee' },
  'Strategic Adjustment':{ bg: '#fff7ed', text: '#b45309', label: 'Adjustment' },
};

const getCategoryStyle = (category: string) =>
  CATEGORY_COLORS[category] || { bg: '#f9fafb', text: '#374151', label: category };

// ─── Reference number system ──────────────────────────────────────────────────
// Sessions get REF-XXXX, ungrouped get TXN-XXXX (last 6 of ID)
const sessionRef  = (sid: string) => `REF-${sid.slice(-6).toUpperCase()}`;
const txnRef      = (id: string)  => `TXN-${id.slice(-6).toUpperCase()}`;

// ─── Types ────────────────────────────────────────────────────────────────────
interface PrintableReportProps {
  transactions:     Transaction[];
  staff:            Staff[];
  financialSummary: { revenue: number; cogs: number; grossProfit: number; operatingExpenses: number; net: number };
  dateRange?:       DateRange;
}

type SessionGroup = {
  checkoutSessionId: string;
  refNumber:         string;
  date:              Date;
  clientName:        string;
  paymentMethod:     string;
  items:             Transaction[];
  subtotal:          number;
  tax:               number;
  tips:              number;
  discounts:         number;
  total:             number;
  receiptItems:      { txnId: string; description: string; date: Date; receiptUrl?: string; refNumber: string }[];
};

// ─── Component ────────────────────────────────────────────────────────────────
export function PrintableReport({ transactions, staff, financialSummary, dateRange }: PrintableReportProps) {

  const { sessions, ungrouped, appendixItems } = React.useMemo(() => {
    const sessionMap = new Map<string, Transaction[]>();
    const ungroupedList: Transaction[] = [];

    transactions.forEach(t => {
      const sid = (t as any).checkoutSessionId;
      if (sid) {
        if (!sessionMap.has(sid)) sessionMap.set(sid, []);
        sessionMap.get(sid)!.push(t);
      } else {
        ungroupedList.push(t);
      }
    });

    const sessionGroups: SessionGroup[] = Array.from(sessionMap.entries()).map(([sid, txns]) => {
      const sorted    = [...txns].sort((a, b) => safeDate(a.date).getTime() - safeDate(b.date).getTime());
      const first     = sorted[0];
      const income    = txns.filter(t => t.type === 'income');
      const expense   = txns.filter(t => t.type === 'expense');
      const taxLine   = income.find(t => t.category === 'Tax Collected');
      const tipLines  = income.filter(t => t.category === 'Tips');
      const discLines = expense.filter(t => ['Discounts', 'Refunds'].includes(t.category));
      const svcLines  = income.filter(t => !['Tax Collected', 'Tips'].includes(t.category));

      // Collect any receipt image attachments within this session
      const receiptItems = sorted
        .filter(t => (t as any).receiptUrl)
        .map(t => ({
          txnId:       t.id,
          description: t.description,
          date:        safeDate(t.date),
          receiptUrl:  (t as any).receiptUrl,
          refNumber:   `${sessionRef(sid)}-${t.id.slice(-4).toUpperCase()}`,
        }));

      return {
        checkoutSessionId: sid,
        refNumber:   sessionRef(sid),
        date:        safeDate(first.date),
        clientName:  first.clientOrVendor || 'Guest',
        paymentMethod: first.paymentMethod || 'Unknown',
        items:       sorted,
        subtotal:    svcLines.reduce((s, t) => s + t.amount, 0),
        tax:         taxLine?.amount || 0,
        tips:        tipLines.reduce((s, t) => s + t.amount, 0),
        discounts:   discLines.reduce((s, t) => s + t.amount, 0),
        total:       income.reduce((s, t) => s + t.amount, 0) - expense.reduce((s, t) => s + t.amount, 0),
        receiptItems,
      };
    }).sort((a, b) => b.date.getTime() - a.date.getTime());

    // All appendix items (receipt images) across sessions and ungrouped
    const appendixItems: { refNumber: string; description: string; date: Date; receiptUrl: string; client: string }[] = [];
    sessionGroups.forEach(s => {
      s.receiptItems.forEach(r => appendixItems.push({ ...r, client: s.clientName }));
    });
    ungroupedList
      .filter(t => (t as any).receiptUrl)
      .forEach(t => appendixItems.push({
        refNumber:   txnRef(t.id),
        description: t.description,
        date:        safeDate(t.date),
        receiptUrl:  (t as any).receiptUrl,
        client:      t.clientOrVendor || 'Unknown',
      }));

    return { sessions: sessionGroups, ungrouped: ungroupedList, appendixItems };
  }, [transactions]);

  const today       = fmt(new Date(), 'MMMM d, yyyy · h:mm a');
  const periodLabel = dateRange?.from && dateRange?.to
    ? `${fmt(dateRange.from, 'MMM d, yyyy')} – ${fmt(dateRange.to, 'MMM d, yyyy')}`
    : 'All Dates';

  // Category totals for the color-coded breakdown
  const categoryTotals = React.useMemo(() => {
    const map = new Map<string, number>();
    transactions.filter(t => t.type === 'income').forEach(t => {
      map.set(t.category, (map.get(t.category) || 0) + t.amount);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [transactions]);

  // Cell style helper
  const cell = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: '6px 8px', fontSize: '11px', borderBottom: '1px solid #f3f4f6', ...extra,
  });

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", maxWidth: '820px', margin: '0 auto', padding: '40px 32px', fontSize: '12px', color: '#111', background: '#fff' }}>

      {/* ── Print styles ── */}
      <style>{`
        @media print {
          @page { size: A4; margin: 0.6in; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page-break { page-break-before: always; }
        }
      `}</style>

      {/* ── Cover header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', paddingBottom: '20px', borderBottom: '3px solid #111' }}>
        <div>
          <div style={{ fontSize: '26px', fontWeight: 900, letterSpacing: '-0.03em', textTransform: 'uppercase', marginBottom: '4px' }}>Studio Financial Report</div>
          <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600 }}>Period: {periodLabel}</div>
          <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>Generated {today}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>ClarityFlow</div>
          <div style={{ fontSize: '10px', color: '#9ca3af' }}>Studio Management</div>
          <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '4px' }}>Confidential</div>
        </div>
      </div>

      {/* ── Color Legend ── */}
      <div style={{ marginBottom: '24px', padding: '14px 16px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fafafa' }}>
        <div style={{ fontWeight: 900, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px', color: '#374151' }}>
          Color Key — Category Classification
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {Object.entries(CATEGORY_COLORS).map(([cat, style]) => (
            <span key={cat} style={{ background: style.bg, color: style.text, padding: '2px 8px', borderRadius: '12px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {style.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── P&L Summary ── */}
      <div style={{ marginBottom: '28px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Summary table */}
        <div style={{ padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fafafa' }}>
          <div style={{ fontWeight: 900, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px', color: '#374151' }}>Financial Summary</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <tbody>
              <tr><td style={{ padding: '3px 0', color: '#555' }}>Total Revenue</td><td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#166534', fontWeight: 700 }}>${financialSummary.revenue.toFixed(2)}</td></tr>
              <tr><td style={{ padding: '3px 0', color: '#555' }}>Cost of Goods (COGS)</td><td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#991b1b' }}>-${financialSummary.cogs.toFixed(2)}</td></tr>
              <tr style={{ borderTop: '1px solid #e5e7eb' }}><td style={{ padding: '6px 0 3px', fontWeight: 700 }}>Gross Profit</td><td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, padding: '6px 0 3px' }}>${financialSummary.grossProfit.toFixed(2)}</td></tr>
              <tr><td style={{ padding: '3px 0', color: '#555' }}>Operating Expenses</td><td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#991b1b' }}>-${financialSummary.operatingExpenses.toFixed(2)}</td></tr>
              <tr style={{ borderTop: '2px solid #111' }}>
                <td style={{ padding: '8px 0 0', fontWeight: 900, fontSize: '13px', textTransform: 'uppercase' }}>Net Income</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 900, fontSize: '13px', padding: '8px 0 0', color: financialSummary.net >= 0 ? '#166534' : '#991b1b' }}>${financialSummary.net.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Revenue by category */}
        <div style={{ padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fafafa' }}>
          <div style={{ fontWeight: 900, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px', color: '#374151' }}>Revenue Breakdown</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <tbody>
              {categoryTotals.map(([cat, amt]) => {
                const cs = getCategoryStyle(cat);
                return (
                  <tr key={cat}>
                    <td style={{ padding: '3px 0' }}>
                      <span style={{ background: cs.bg, color: cs.text, padding: '1px 6px', borderRadius: '10px', fontSize: '9px', fontWeight: 700 }}>{cs.label || cat}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#166534', fontWeight: 600 }}>${amt.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Checkout Sessions ── */}
      {sessions.length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontWeight: 900, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '16px', color: '#111', borderBottom: '2px solid #111', paddingBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
            <span>Checkout Sessions ({sessions.length})</span>
            <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 600 }}>Each session groups all related charges</span>
          </div>

          {sessions.map((session) => (
            <div key={session.checkoutSessionId} style={{ marginBottom: '16px', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', breakInside: 'avoid' }}>
              {/* Session header */}
              <div style={{ background: '#f8fafc', padding: '10px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{session.clientName}</div>
                  <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>
                    {fmt(session.date, 'MMM d, yyyy · h:mm a')} · {session.paymentMethod}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 900, fontSize: '15px', fontFamily: 'monospace' }}>${session.total.toFixed(2)}</div>
                  <div style={{ fontSize: '9px', color: '#9ca3af', fontFamily: 'monospace', fontWeight: 700 }}>{session.refNumber}</div>
                </div>
              </div>

              {/* Line items with color-coded categories */}
              <div style={{ padding: '8px 14px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {session.items.map((t, j) => {
                      const staffMember = staff.find(s => s.id === (t as any).staffId);
                      const cs = getCategoryStyle(t.category);
                      return (
                        <tr key={t.id} style={{ borderBottom: j < session.items.length - 1 ? '1px dashed #f3f4f6' : 'none' }}>
                          <td style={{ ...cell(), width: '60%' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ background: cs.bg, color: cs.text, padding: '1px 5px', borderRadius: '8px', fontSize: '8px', fontWeight: 700, whiteSpace: 'nowrap' }}>{cs.label || t.category}</span>
                              <span style={{ color: t.type === 'expense' ? '#991b1b' : '#111' }}>
                                {t.description}
                                {staffMember && <span style={{ color: '#9ca3af', fontSize: '10px' }}> · {staffMember.name.split(' ')[0]}</span>}
                              </span>
                            </div>
                          </td>
                          <td style={{ ...cell({ color: '#6b7280', whiteSpace: 'nowrap' }) }}>{fmt(t.date, 'h:mm a')}</td>
                          <td style={{ ...cell({ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: t.type === 'expense' ? '#991b1b' : t.category === 'Tax Collected' ? '#374151' : t.category === 'Tips' ? '#854d0e' : '#166534' }) }}>
                            {t.type === 'expense' ? '-' : ''}${t.amount.toFixed(2)}
                          </td>
                          <td style={{ ...cell({ textAlign: 'right', fontFamily: 'monospace', fontSize: '9px', color: '#d1d5db' }) }}>
                            {session.refNumber}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Session totals */}
              <div style={{ padding: '8px 14px 10px', background: '#f8fafc', borderTop: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', gap: '24px', justifyContent: 'flex-end', fontSize: '11px' }}>
                  {session.subtotal > 0 && <span style={{ color: '#6b7280' }}>Services <strong style={{ fontFamily: 'monospace', color: '#111' }}>${session.subtotal.toFixed(2)}</strong></span>}
                  {session.tax > 0 && <span style={{ color: '#6b7280' }}>Tax <strong style={{ fontFamily: 'monospace', color: '#374151' }}>${session.tax.toFixed(2)}</strong></span>}
                  {session.tips > 0 && <span style={{ color: '#6b7280' }}>Tip <strong style={{ fontFamily: 'monospace', color: '#854d0e' }}>${session.tips.toFixed(2)}</strong></span>}
                  {session.discounts > 0 && <span style={{ color: '#6b7280' }}>Discount <strong style={{ fontFamily: 'monospace', color: '#9d174d' }}>-${session.discounts.toFixed(2)}</strong></span>}
                  <span style={{ fontWeight: 900, fontSize: '12px' }}>Total <strong style={{ fontFamily: 'monospace' }}>${session.total.toFixed(2)}</strong></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Ungrouped transactions ── */}
      {ungrouped.length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontWeight: 900, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px', color: '#111', borderBottom: '2px solid #111', paddingBottom: '6px' }}>
            Manual & Other Entries ({ungrouped.length})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
                {['Ref #','Date','Description','Category','Staff','Method','Amount'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : 'left', padding: '7px 8px', fontWeight: 900, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b7280' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ungrouped.map((t, i) => {
                const sm = staff.find(s => s.id === (t as any).staffId);
                const cs = getCategoryStyle(t.category);
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ ...cell({ fontFamily: 'monospace', fontSize: '9px', color: '#9ca3af', whiteSpace: 'nowrap' }) }}>{txnRef(t.id)}</td>
                    <td style={{ ...cell({ color: '#6b7280', whiteSpace: 'nowrap' }) }}>{fmt(t.date, 'MMM d, h:mm a')}</td>
                    <td style={cell()}>
                      <div style={{ fontWeight: 600 }}>{t.description}</div>
                      <div style={{ fontSize: '9px', color: '#9ca3af' }}>{t.clientOrVendor}</div>
                    </td>
                    <td style={cell()}>
                      <span style={{ background: cs.bg, color: cs.text, padding: '1px 6px', borderRadius: '10px', fontSize: '9px', fontWeight: 700 }}>{cs.label || t.category}</span>
                    </td>
                    <td style={{ ...cell({ color: '#6b7280' }) }}>{sm?.name?.split(' ')[0] || '—'}</td>
                    <td style={{ ...cell({ color: '#6b7280' }) }}>{t.paymentMethod}</td>
                    <td style={{ ...cell({ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: t.type === 'income' ? '#166534' : '#991b1b' }) }}>
                      {t.type === 'income' ? '+' : '-'}${t.amount.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Receipt Appendix ── */}
      {appendixItems.length > 0 && (
        <div className="page-break" style={{ marginTop: '40px' }}>
          <div style={{ fontWeight: 900, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '16px', color: '#111', borderBottom: '2px solid #111', paddingBottom: '6px' }}>
            Appendix A — Receipt Documentation ({appendixItems.length} attachments)
          </div>
          <p style={{ fontSize: '10px', color: '#6b7280', marginBottom: '16px' }}>
            Each entry below corresponds to a transaction in this report. Reference numbers match the REF or TXN codes shown in the transaction detail above.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {appendixItems.map((item, i) => (
              <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', breakInside: 'avoid' }}>
                <div style={{ background: '#f8fafc', padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '10px', fontWeight: 900, color: '#374151' }}>{item.refNumber}</div>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#111', marginTop: '1px' }}>{item.description}</div>
                  <div style={{ fontSize: '9px', color: '#9ca3af' }}>{item.client} · {fmt(item.date, 'MMM d, yyyy · h:mm a')}</div>
                </div>
                {item.receiptUrl ? (
                  <div style={{ padding: '8px', background: '#fff' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.receiptUrl} alt={`Receipt ${item.refNumber}`} style={{ width: '100%', maxHeight: '280px', objectFit: 'contain', display: 'block' }} />
                  </div>
                ) : (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#d1d5db', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
                    Receipt generated from POS — view in ClarityFlow
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ marginTop: '40px', borderTop: '2px solid #111', paddingTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', color: '#9ca3af', fontSize: '9px' }}>
        <div>
          <div style={{ fontWeight: 700 }}>ClarityFlow Studio Management</div>
          <div>Confidential Financial Document — Not for Distribution</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div>{periodLabel}</div>
          <div>Generated {today}</div>
          <div style={{ marginTop: '2px' }}>{transactions.length} total records · {sessions.length} checkout sessions</div>
        </div>
      </div>
    </div>
  );
}