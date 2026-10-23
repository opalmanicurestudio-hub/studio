'use client';

import React, { useEffect, useMemo } from 'react';
import { type Staff, type ActivityLog } from '@/lib/data';
import type { Transaction } from '@/lib/financial-data';
import { DateRange } from 'react-day-picker';
import { format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { PRINT, PRINT_CSS } from '@/lib/print-style';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') {
    try { return parseISO(val); } catch { return new Date(val); }
  }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

const MAX_PAYMENT_ROWS = 14;

interface PrintableStaffReportProps {
  member: Staff & { stats: any };
  businessName: string;
  dateRange: DateRange | undefined;
  activityLogs: ActivityLog[];
  transactions: Transaction[];
  onDone: () => void;
}

export function PrintableStaffReport({
  member,
  businessName,
  dateRange,
  activityLogs,
  transactions,
  onDone,
}: PrintableStaffReportProps) {
  const periodLabel = dateRange?.from && dateRange?.to
    ? `${format(dateRange.from, 'MMM d, yyyy')} – ${format(dateRange.to, 'MMM d, yyyy')}`
    : 'All time';

  const inRange = (d: Date) => {
    if (dateRange?.from && d < startOfDay(dateRange.from)) return false;
    if (dateRange?.to && d > endOfDay(dateRange.to)) return false;
    return true;
  };

  const attendance = useMemo(() => {
    const mine = (activityLogs || []).filter(l => l.staffId === member.id && inRange(safeDate(l.timestamp)));
    const sessions = mine.filter(l => l.type === 'clock_in').length;
    const breaks = mine.filter(l => l.type === 'break_end').length;
    const breakMinutes = mine.reduce((acc, l) => acc + (l.type === 'break_end' ? (l.durationMinutes || 0) : 0), 0);
    return { sessions, breaks, breakMinutes };
  }, [activityLogs, member.id, dateRange?.from, dateRange?.to]);

  const payments = useMemo(() => {
    const mine = (transactions || [])
      .filter(t => t.staffId === member.id && inRange(safeDate(t.date)))
      .sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime());
    return { rows: mine.slice(0, MAX_PAYMENT_ROWS), total: mine.length };
  }, [transactions, member.id, dateRange?.from, dateRange?.to]);

  useEffect(() => {
    const finish = () => onDone();
    window.addEventListener('afterprint', finish, { once: true });
    const raf = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', finish);
    };
  }, [onDone]);

  const s = member.stats || {};
  const varianceLabel = Math.abs(Number(s.avgVariance) || 0) < 0.5
    ? 'On booked time'
    : `${Math.abs(s.avgVariance).toFixed(0)} min ${s.avgVariance > 0 ? 'over' : 'under'} booked`;

  const scorecard: Array<{ label: string; value: string }> = [
    { label: 'Services completed', value: String(s.totalServices ?? 0) },
    { label: 'Total sales', value: money(s.totalSales) },
    { label: 'Average sale per visit', value: money(s.avgSalePerAppointment) },
    { label: 'Retail attach rate', value: `${(Number(s.retailAttachmentRate) || 0).toFixed(0)}%` },
    { label: 'Hours worked', value: `${(Number(s.totalHours) || 0).toFixed(1)} h` },
    { label: 'Time in service', value: `${(Number(s.totalInServiceHours) || 0).toFixed(1)} h` },
    { label: 'Utilization', value: `${(Number(s.utilizationRate) || 0).toFixed(0)}%` },
    { label: 'Pace vs booked', value: varianceLabel },
  ];

  const earnings: Array<{ label: string; value: string }> = [
    { label: 'Tips received', value: money(s.tips) },
    { label: 'Estimated pay for period', value: money(s.earnings) },
  ];

  const noteSections = ['What went well', 'Areas to grow', 'Goals for next period'];
  const roleLine = [String(member.role || '').replace(/_/g, ' '), member.payStructure ? String(member.payStructure).replace(/_/g, ' ') : ''].filter(Boolean).join(' · ');

  // In the app's print look (lib/print-style): a light heading, sentence-case labels in grey, thin lines, tabular
  // figures. The heading is a div rather than a <header>, so the rule that hides the app's header on paper leaves it be.
  return (
    <div id="staff-review-print" className="pp cf-paper hidden print:block">
      <style>{`${PRINT_CSS}
        @media print {
          @page { size: letter; margin: 0.6in; }
          body:has(#staff-review-print) [data-sidebar],
          body:has(#staff-review-print) header {
            display: none !important;
          }
          #staff-review-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #staff-review-print .avoid-break { break-inside: avoid; }
        }
        #staff-review-print { background: #fff; }
        #staff-review-print .who { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
        #staff-review-print .who h2 { font-size: 20px; font-weight: 300; letter-spacing: -0.01em; margin: 0; }
        #staff-review-print .rows { column-gap: 32px; row-gap: 0; }
        #staff-review-print .write { height: 28px; border-bottom: 1px solid #c9cacd; }
        #staff-review-print .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 36px; }
        #staff-review-print .sign .ln { height: 40px; border-bottom: 1px solid ${PRINT.ink}; }
        #staff-review-print .sign .lbl { margin-top: 6px; }
      `}</style>

      <div className="head">
        <div>
          <p className="shop">{businessName}</p>
          <h1>Performance <b>review</b></h1>
        </div>
        <div className="meta">
          <div>{periodLabel}</div>
          <div>Prepared {format(new Date(), 'MMM d, yyyy')}</div>
        </div>
      </div>

      <section className="who avoid-break">
        <h2>{member.name}</h2>
        {roleLine && <p className="muted">{roleLine.charAt(0).toUpperCase() + roleLine.slice(1)}</p>}
      </section>

      <section className="avoid-break">
        <h2>Results this period</h2>
        <div className="grid2 rows">
          {scorecard.map(row => (
            <div key={row.label} className="line">
              <span className="body">{row.label}</span>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="avoid-break">
        <h2>Attendance and pay</h2>
        <div className="grid2 rows">
          <div className="line">
            <span className="body">Shifts clocked</span>
            <span>{attendance.sessions}</span>
          </div>
          <div className="line">
            <span className="body">Breaks taken</span>
            <span>{attendance.breaks}{attendance.breakMinutes ? ` (${attendance.breakMinutes} min)` : ''}</span>
          </div>
          {earnings.map(row => (
            <div key={row.label} className="line">
              <span className="body">{row.label}</span>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
      </section>

      {payments.total > 0 && (
        <section>
          <h2>Recent payments credited</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Type</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.rows.map(t => (
                <tr key={t.id}>
                  <td className="nowrap muted">{format(safeDate(t.date), 'MMM d')}</td>
                  <td>{t.description}</td>
                  <td className="muted">{t.category}</td>
                  <td className="r">{money(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {payments.total > MAX_PAYMENT_ROWS && (
            <p className="note" style={{ marginTop: 6 }}>Showing the {MAX_PAYMENT_ROWS} most recent of {payments.total} entries this period.</p>
          )}
        </section>
      )}

      {noteSections.map(title => (
        <section key={title} className="avoid-break">
          <h2>{title}</h2>
          <div>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="write" />
            ))}
          </div>
        </section>
      ))}

      <section className="sign avoid-break">
        <div>
          <div className="ln" />
          <p className="lbl">Team member signature · date</p>
        </div>
        <div>
          <div className="ln" />
          <p className="lbl">Reviewer signature · date</p>
        </div>
      </section>

      <div className="foot">
        <span>Pay shown is an estimate from recorded activity for the period and is not a pay statement.</span>
        <span>{businessName}</span>
      </div>
    </div>
  );
}
