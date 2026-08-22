'use client';

import React, { useEffect, useMemo } from 'react';
import { type Staff, type ActivityLog } from '@/lib/data';
import type { Transaction } from '@/lib/financial-data';
import { DateRange } from 'react-day-picker';
import { format, parseISO, startOfDay, endOfDay } from 'date-fns';

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

  return (
    <div id="staff-review-print" className="hidden print:block bg-white text-black">
      <style>{`
        @media print {
          @page { size: letter; margin: 0.6in; }
          body:has(#staff-review-print) [data-sidebar],
          body:has(#staff-review-print) header {
            display: none !important;
          }
          #staff-review-print {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-variant-numeric: tabular-nums;
          }
          #staff-review-print .avoid-break { break-inside: avoid; }
        }
      `}</style>

      <header className="flex items-start justify-between border-b-2 border-black pb-4 mb-6">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em]">{businessName}</p>
          <h1 className="text-3xl font-black tracking-tight mt-1">Performance review</h1>
        </div>
        <div className="text-right text-[11px] font-bold leading-relaxed">
          <p>Period: {periodLabel}</p>
          <p>Prepared: {format(new Date(), 'MMM d, yyyy')}</p>
        </div>
      </header>

      <section className="mb-6 avoid-break">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-black tracking-tight">{member.name}</h2>
          <p className="text-[11px] font-bold uppercase tracking-widest">{member.role}{member.payStructure ? ` · ${String(member.payStructure).replace(/_/g, ' ')}` : ''}</p>
        </div>
      </section>

      <section className="mb-6 avoid-break">
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] border-b border-black pb-1 mb-3">Results this period</h3>
        <div className="grid grid-cols-2 gap-x-8">
          {scorecard.map(row => (
            <div key={row.label} className="flex items-baseline justify-between border-b border-black/20 py-1.5">
              <span className="text-[12px] font-bold">{row.label}</span>
              <span className="text-[13px] font-black">{row.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6 avoid-break">
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] border-b border-black pb-1 mb-3">Attendance & pay</h3>
        <div className="grid grid-cols-2 gap-x-8">
          <div className="flex items-baseline justify-between border-b border-black/20 py-1.5">
            <span className="text-[12px] font-bold">Shifts clocked</span>
            <span className="text-[13px] font-black">{attendance.sessions}</span>
          </div>
          <div className="flex items-baseline justify-between border-b border-black/20 py-1.5">
            <span className="text-[12px] font-bold">Breaks taken</span>
            <span className="text-[13px] font-black">{attendance.breaks}{attendance.breakMinutes ? ` (${attendance.breakMinutes} min)` : ''}</span>
          </div>
          {earnings.map(row => (
            <div key={row.label} className="flex items-baseline justify-between border-b border-black/20 py-1.5">
              <span className="text-[12px] font-bold">{row.label}</span>
              <span className="text-[13px] font-black">{row.value}</span>
            </div>
          ))}
        </div>
      </section>

      {payments.total > 0 && (
        <section className="mb-6">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] border-b border-black pb-1 mb-2">Recent payments credited</h3>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left font-black uppercase tracking-widest border-b border-black">
                <th className="py-1 pr-3">Date</th>
                <th className="py-1 pr-3">Description</th>
                <th className="py-1 pr-3">Type</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.rows.map(t => (
                <tr key={t.id} className="border-b border-black/15 align-top">
                  <td className="py-1 pr-3 whitespace-nowrap font-bold">{format(safeDate(t.date), 'MMM d')}</td>
                  <td className="py-1 pr-3">{t.description}</td>
                  <td className="py-1 pr-3 font-bold">{t.category}</td>
                  <td className="py-1 text-right font-black">{money(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {payments.total > MAX_PAYMENT_ROWS && (
            <p className="text-[10px] font-bold mt-1">Showing the {MAX_PAYMENT_ROWS} most recent of {payments.total} entries this period.</p>
          )}
        </section>
      )}

      {noteSections.map(title => (
        <section key={title} className="mb-6 avoid-break">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] border-b border-black pb-1 mb-4">{title}</h3>
          <div>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="border-b border-black/25 h-7" />
            ))}
          </div>
        </section>
      ))}

      <section className="mt-10 grid grid-cols-2 gap-12 avoid-break">
        <div>
          <div className="border-b-2 border-black h-10" />
          <p className="text-[10px] font-black uppercase tracking-widest mt-1.5">Team member signature · date</p>
        </div>
        <div>
          <div className="border-b-2 border-black h-10" />
          <p className="text-[10px] font-black uppercase tracking-widest mt-1.5">Reviewer signature · date</p>
        </div>
      </section>

      <footer className="mt-8 pt-3 border-t border-black/30">
        <p className="text-[9px] font-bold uppercase tracking-widest">Pay shown is an estimate from recorded activity for the period and is not a pay statement.</p>
      </footer>
    </div>
  );
}
