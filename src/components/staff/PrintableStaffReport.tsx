
'use client';

import React from 'react';
import { type Staff, type Transaction, type Service, type Appointment, type ActivityLog } from '@/lib/data';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Clock, Coffee, TrendingUp, DollarSign } from 'lucide-react';

interface PrintableStaffReportProps {
  staffMember: (Staff & { stats: any });
  dateRange: DateRange | undefined;
  activityLogs: ActivityLog[];
  transactions: Transaction[];
  services: Service[];
  appointments: Appointment[];
}

export const PrintableStaffReport = React.forwardRef<HTMLDivElement, PrintableStaffReportProps>(({
  staffMember,
  dateRange,
  activityLogs,
  transactions,
  services,
  appointments
}, ref) => {
    
    const dateRangeString = dateRange?.from && dateRange.to
    ? `${format(dateRange.from, 'MMM d, yyyy')} - ${format(dateRange.to, 'MMM d, yyyy')}`
    : 'All Time';

  return (
    <div ref={ref} className="p-8 bg-white text-black font-sans">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold">{staffMember.name}</h1>
        <p className="text-lg font-semibold">Performance Report</p>
        <p className="text-gray-600">{dateRangeString}</p>
      </header>

      <section className="mb-8">
        <h2 className="text-xl font-semibold border-b pb-2 mb-4">Performance Summary</h2>
        <table className="w-full text-left">
            <tbody>
                <tr className="border-b"><td className="py-2 pr-4">Total Sales</td><td className="py-2 text-right font-medium">${staffMember.stats.totalSales.toFixed(2)}</td></tr>
                <tr className="border-b"><td className="py-2 pr-4">Tips Earned</td><td className="py-2 text-right font-medium">${staffMember.stats.tips.toFixed(2)}</td></tr>
                <tr className="border-b"><td className="py-2 pr-4">Hours Worked</td><td className="py-2 text-right font-medium">{staffMember.stats.totalHours?.toFixed(1) ?? 'N/A'}</td></tr>
                <tr className="border-b font-bold bg-gray-50"><td className="py-3 px-4">Est. Take-home</td><td className="py-3 px-4 text-right">${staffMember.stats.earnings.toFixed(2)}</td></tr>
            </tbody>
        </table>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold border-b pb-2 mb-4">Activity Log</h2>
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {activityLogs.length > 0 ? (
                    activityLogs.map(log => (
                        <TableRow key={log.id}>
                            <TableCell>{format(log.timestamp, 'PPP p')}</TableCell>
                            <TableCell className="capitalize flex items-center gap-2">
                                {log.type === 'clock_in' && <Clock className="w-4 h-4 text-green-500" />}
                                {log.type === 'clock_out' && <Clock className="w-4 h-4 text-red-500" />}
                                {log.type === 'break_start' && <Coffee className="w-4 h-4 text-yellow-500" />}
                                {log.type === 'break_end' && <Coffee className="w-4 h-4 text-gray-500" />}
                                {log.type.replace('_', ' ')}
                            </TableCell>
                            <TableCell className="text-right">
                                {log.durationMinutes ? `${log.durationMinutes} min` : '—'}
                            </TableCell>
                        </TableRow>
                    ))
                ) : (
                    <TableRow><TableCell colSpan={3} className="text-center h-24">No activity found.</TableCell></TableRow>
                )}
            </TableBody>
        </Table>
      </section>

      <section>
          <h2 className="text-xl font-semibold border-b pb-2 mb-4">Transaction History</h2>
            <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                    {transactions.length > 0 ? (
                    transactions.map(t => (
                        <TableRow key={t.id}>
                        <TableCell>{format(t.date, 'MMM d, yyyy h:mm a')}</TableCell>
                        <TableCell>{t.description}</TableCell>
                        <TableCell><Badge variant={t.category === 'Tips' ? 'secondary' : 'outline'} className={t.category === 'Tips' ? 'bg-green-100 text-green-800' : ''}>{t.category}</Badge></TableCell>
                        <TableCell className="text-right font-mono"><div className='flex items-center justify-end gap-1'>{t.type === 'income' ? (<TrendingUp className="h-4 w-4 text-green-500" />) : (<DollarSign className="h-4 w-4 text-muted-foreground" />)} ${t.amount.toFixed(2)}</div></TableCell>
                        </TableRow>
                    ))
                    ) : (
                    <TableRow><TableCell colSpan={4} className="text-center h-24">No transactions in this period.</TableCell></TableRow>
                    )}
                </TableBody>
            </Table>
      </section>
      <style jsx global>{`
        @media print {
            .break-before-page {
                page-break-before: always;
            }
        }
      `}</style>
    </div>
  );
});
PrintableStaffReport.displayName = 'PrintableStaffReport';
