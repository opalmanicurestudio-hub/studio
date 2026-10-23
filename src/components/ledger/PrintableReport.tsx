'use client';

import React from 'react';
import { format } from 'date-fns';
import { type Transaction } from '@/lib/financial-data';
import { type Staff } from '@/lib/data';
import { DateRange } from 'react-day-picker';
import { PRINT, PRINT_CSS } from '@/lib/print-style';

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

// ─── Categories ───────────────────────────────────────────────────────────────
// Every category prints as the same quiet pill (the app's print look, lib/print-style). The tax bucket only names a
// line that has no category of its own.
const BUCKET_LABELS: Record<string, string> = {
  'revenue': 'Revenue', 'gratuity': 'Gratuity', 'tax_collected': 'Tax', 'adjustment': 'Adjustment',
  'refund': 'Refund', 'processing_fee': 'Processing fee', 'operating_cost': 'Operating cost',
};
const CATEGORY_TO_BUCKET: Record<string, string> = {
  'Service Revenue': 'revenue', 'Retail': 'revenue', 'Retail Product': 'revenue',
  'Membership Sales': 'revenue', 'Package Sales': 'revenue', 'Hospitality Revenue': 'revenue',
  'Tips': 'gratuity', 'Tax Collected': 'tax_collected',
  'Discounts': 'adjustment', 'Protocol Recovery': 'adjustment', 'Strategic Adjustment': 'adjustment',
  'Fee Recovery': 'adjustment', 'Adjustment Fee': 'adjustment', 'Cancellation Fee': 'adjustment',
  'Deposit Applied': 'adjustment', 'Refunds': 'refund', 'Void': 'refund',
  'Processing Fee': 'processing_fee',
  'Supplies': 'operating_cost', 'Cost of Goods Sold': 'operating_cost', 'Spoilage': 'operating_cost',
};
const categoryLabel = (category: string, taxBucket?: string) => {
  const bucket = taxBucket || CATEGORY_TO_BUCKET[category] || 'revenue';
  return category || BUCKET_LABELS[bucket] || '';
};

// The report's own touches on top of the shared print look.
const REPORT_CSS = `
@media print { @page { size: A4; margin: 0.6in; } }
.pp .sec-note { margin: -4px 0 10px; }
.pp .sess { margin-bottom: 12px; }
.pp .sess-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid ${PRINT.line}; }
.pp .sess-head .amt { font-size: 15px; font-weight: 500; }
.pp .sess td { padding: 6px 4px; }
.pp .sess tr:last-child td { border-bottom: 0; }
.pp .sess-sum { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px 20px; padding-top: 8px; border-top: 1px solid ${PRINT.line}; font-size: 11px; color: ${PRINT.muted}; }
.pp .sess-sum b { font-weight: 500; color: ${PRINT.ink}; }
.pp .sess-sum .t, .pp .sess-sum .t b { font-weight: 600; color: ${PRINT.ink}; }
.pp .small { font-size: 10.5px; }
.pp .att-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid ${PRINT.line}; }
.pp .att img { width: 100%; max-height: 280px; object-fit: contain; display: block; }
`;

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

  const { sessions, ungrouped, appendixItems, imgNumMap } = React.useMemo(() => {
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

      // Collect any receipt image attachments — imgNum assigned below
      const receiptItems = sorted
        .filter(t => (t as any).receiptUrl)
        .map(t => ({
          txnId:       t.id,
          description: t.description,
          date:        safeDate(t.date),
          receiptUrl:  (t as any).receiptUrl,
          refNumber:   `${sessionRef(sid)}-${t.id.slice(-4).toUpperCase()}`,
          imgNum:      0, // assigned in second pass below
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

    // Assign sequential IMG numbers and build lookup map
    const imgNumMap = new Map<string, number>();
    let imgCounter = 1;
    sessionGroups.forEach(s => {
      s.receiptItems.forEach(r => { r.imgNum = imgCounter; imgNumMap.set(r.txnId, imgCounter); imgCounter++; });
    });
    ungroupedList.filter(t => (t as any).receiptUrl).forEach(t => {
      imgNumMap.set(t.id, imgCounter); imgCounter++;
    });

    // All appendix items across sessions and ungrouped
    const appendixItems: { refNumber: string; imgNum: number; description: string; date: Date; receiptUrl: string; client: string }[] = [];
    sessionGroups.forEach(s => {
      s.receiptItems.forEach(r => appendixItems.push({ ...r, client: s.clientName }));
    });
    ungroupedList
      .filter(t => (t as any).receiptUrl)
      .forEach(t => appendixItems.push({
        refNumber:   txnRef(t.id),
        imgNum:      imgNumMap.get(t.id) || 0,
        description: t.description,
        date:        safeDate(t.date),
        receiptUrl:  (t as any).receiptUrl,
        client:      t.clientOrVendor || 'Unknown',
      }));

    return { sessions: sessionGroups, ungrouped: ungroupedList, appendixItems, imgNumMap };
  }, [transactions]);

  const today       = fmt(new Date(), 'MMMM d, yyyy · h:mm a');
  const periodLabel = dateRange?.from && dateRange?.to
    ? `${fmt(dateRange.from, 'MMM d, yyyy')} – ${fmt(dateRange.to, 'MMM d, yyyy')}`
    : 'All dates';

  // Category totals for the revenue breakdown
  const categoryTotals = React.useMemo(() => {
    const map = new Map<string, number>();
    transactions.filter(t => t.type === 'income').forEach(t => {
      map.set(t.category, (map.get(t.category) || 0) + t.amount);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [transactions]);

  // In the app's print look (lib/print-style): a light heading, sentence-case labels in grey, thin lines, soft rounded
  // panels, quiet category pills and tabular figures; green or red only for the net result.
  return (
    <div className="pp cf-paper" style={{ maxWidth: '820px', margin: '0 auto', padding: '40px 32px', background: '#fff' }}>

      <style>{`${PRINT_CSS}${REPORT_CSS}`}</style>

      <div className="head">
        <div>
          <p className="shop">ClarityFlow · Studio management</p>
          <h1>Financial <b>report</b></h1>
          <p className="sub">{periodLabel}</p>
        </div>
        <div className="meta">
          <div>Generated {today}</div>
          <div>Confidential</div>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Financial summary</h3>
          <div className="line"><span className="body">Total revenue</span><span>${financialSummary.revenue.toFixed(2)}</span></div>
          <div className="line"><span className="body">Cost of goods (COGS)</span><span>-${financialSummary.cogs.toFixed(2)}</span></div>
          <div className="line total"><span>Gross profit</span><span>${financialSummary.grossProfit.toFixed(2)}</span></div>
          <div className="line"><span className="body">Operating expenses</span><span>-${financialSummary.operatingExpenses.toFixed(2)}</span></div>
          <div className="line total"><span>Net income</span><span className={financialSummary.net >= 0 ? 'ok' : 'bad'}>${financialSummary.net.toFixed(2)}</span></div>
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Revenue by category</h3>
          {categoryTotals.map(([cat, amt]) => (
            <div key={cat} className="line">
              <span><span className="pill">{categoryLabel(cat) || cat}</span></span>
              <span>${amt.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      {sessions.length > 0 && (
        <div>
          <h2>Checkout sessions <span className="faint">· {sessions.length}</span></h2>
          <p className="note sec-note">Each session groups all related charges.</p>

          {sessions.map((session) => (
            <div key={session.checkoutSessionId} className="box sess">
              <div className="sess-head">
                <div>
                  <p style={{ fontWeight: 600 }}>{session.clientName}</p>
                  <p className="muted small">{fmt(session.date, 'MMM d, yyyy · h:mm a')} · {session.paymentMethod}</p>
                </div>
                <div className="r">
                  <p className="amt">${session.total.toFixed(2)}</p>
                  <p className="faint small">{session.refNumber}</p>
                </div>
              </div>

              <table>
                <tbody>
                  {session.items.map((t) => {
                    const staffMember = staff.find(s => s.id === (t as any).staffId);
                    return (
                      <tr key={t.id}>
                        <td style={{ width: '60%' }}>
                          <span className="pill" style={{ marginRight: 6 }}>{categoryLabel(t.category, (t as any).taxBucket) || t.category}</span>
                          {t.description}
                          {staffMember && <span className="faint"> · {staffMember.name.split(' ')[0]}</span>}
                        </td>
                        <td className="muted nowrap">{fmt(t.date, 'h:mm a')}</td>
                        <td className="r">{t.type === 'expense' ? '-' : ''}${t.amount.toFixed(2)}</td>
                        <td className="r faint small">{session.refNumber}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="sess-sum">
                {session.subtotal > 0 && <span>Services <b>${session.subtotal.toFixed(2)}</b></span>}
                {session.tax > 0 && <span>Tax <b>${session.tax.toFixed(2)}</b></span>}
                {session.tips > 0 && <span>Tip <b>${session.tips.toFixed(2)}</b></span>}
                {session.discounts > 0 && <span>Discount <b>-${session.discounts.toFixed(2)}</b></span>}
                <span className="t">Total <b>${session.total.toFixed(2)}</b></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {ungrouped.length > 0 && (
        <div>
          <h2>Manual and other entries <span className="faint">· {ungrouped.length}</span></h2>
          <table>
            <thead>
              <tr>
                {['Ref #','Date','Description','Category','Staff','Method','Amount'].map(h => (
                  <th key={h} className={h === 'Amount' ? 'r' : ''}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ungrouped.map((t) => {
                const sm = staff.find(s => s.id === (t as any).staffId);
                return (
                  <tr key={t.id}>
                    <td className="faint small nowrap">{txnRef(t.id)}</td>
                    <td className="muted nowrap">{fmt(t.date, 'MMM d, h:mm a')}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>
                        {t.description}
                        {imgNumMap.get(t.id) && <span className="pill" style={{ marginLeft: 6 }}>IMG-{imgNumMap.get(t.id)}</span>}
                      </div>
                      <div className="faint small">{t.clientOrVendor}</div>
                    </td>
                    <td><span className="pill">{categoryLabel(t.category, (t as any).taxBucket) || t.category}</span></td>
                    <td className="muted">{sm?.name?.split(' ')[0] || '—'}</td>
                    <td className="muted">{t.paymentMethod}</td>
                    <td className="r nowrap">{t.type === 'income' ? '+' : '-'}${t.amount.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {appendixItems.length > 0 && (
        <div className="break">
          <h2>Appendix A · receipt documentation <span className="faint">· {appendixItems.length} attachments</span></h2>
          <p className="note sec-note">
            Images numbered IMG-1 through IMG-{appendixItems.length}. Each IMG number appears on the corresponding transaction row above for cross-referencing.
          </p>
          <div className="grid2">
            {appendixItems.map((item, i) => (
              <div key={i} className="box att">
                <div className="att-head">
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>IMG-{item.imgNum}</p>
                    <p className="faint small">{item.refNumber}</p>
                  </div>
                  <div className="r">
                    <p style={{ fontWeight: 500 }}>{item.description}</p>
                    <p className="muted small">{item.client} · {fmt(item.date, 'MMM d, yyyy · h:mm a')}</p>
                  </div>
                </div>
                {item.receiptUrl ? (
                  <img src={item.receiptUrl} alt={`IMG-${item.imgNum}`} />
                ) : (
                  <p className="faint c" style={{ padding: '24px 0' }}>POS receipt, view it in ClarityFlow</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="foot">
        <span>ClarityFlow studio management<br />Confidential financial document, not for distribution</span>
        <span className="r">{periodLabel}<br />Generated {today}<br />{transactions.length} total records · {sessions.length} checkout sessions</span>
      </div>
    </div>
  );
}
