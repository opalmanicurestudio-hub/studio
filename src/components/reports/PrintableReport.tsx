
'use client';

import React from 'react';
import { type Staff, type Appointment, type Service, type ActivityLog } from '@/lib/data';
import { type Transaction } from '@/lib/financial-data';
import { DateRange } from 'react-day-picker';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface PrintableStaffReportProps {
  dateRange: DateRange | undefined;
  kpiData: {
    avgSalePerAppointment: number;
    utilizationRate: number;
    retailAttachmentRate: number;
    cancellationRate: number;
    rebookingRate: number;
    walkInConversionRate: number;
    revenuePerServiceHour: number;
  };
  payrollData: (Staff & { stats: any })[];
  grossProfit: number;
  totalGrossRevenue: number;
  totalCOGS: number;
  periodOverhead: number;
  servicePerformanceData: any[];
  appointments: Appointment[];
  activityLogs: ActivityLog[];
  transactions: Transaction[];
  services: Service[];
}

export const PrintableStaffReport = React.forwardRef<HTMLDivElement, PrintableStaffReportProps>(({ 
    dateRange,
    kpiData,
    payrollData,
    totalGrossRevenue,
    totalCOGS,
    periodOverhead,
}, ref) => {
    const dateRangeString = dateRange?.from && dateRange.to
    ? `${format(dateRange.from, 'MMM d, yyyy')} - ${format(dateRange.to, 'MMM d, yyyy')}`
    : 'All Time';

    const payrollTotal = payrollData.reduce((acc, d) => acc + d.stats.totalPay, 0);
    const netTakeHomeTotal = payrollData.reduce((acc, d) => acc + (d.stats.totalPay - d.stats.tips), 0);
    const totalRevenue = payrollData.reduce((acc, d) => acc + d.stats.serviceRevenue + d.stats.retailSales, 0);
    const totalContribution = payrollData.reduce((acc, d) => {
        const overheadShare = periodOverhead / payrollData.length;
        return acc + (d.stats.serviceRevenue + d.stats.retailSales - (d.stats.totalPay - d.stats.tips) - d.stats.costOfGoodsSold - overheadShare);
    }, 0);

    return (
        <div ref={ref} className="p-8 bg-white text-black font-sans text-sm max-w-4xl mx-auto">
            <style jsx global>{`
                @media print {
                    @page {
                        size: A4;
                        margin: 0.5in;
                    }
                    body {
                        background-color: white !important;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .break-before-page {
                        page-break-before: always;
                    }
                }
            `}</style>

            <header className="mb-10 border-b-4 border-black pb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter">Studio Yield Dossier</h1>
                    <p className="text-gray-600 font-bold uppercase tracking-widest text-[10px] mt-1">{dateRangeString}</p>
                </div>
                <div className="text-right">
                    <p className="text-[9px] font-black uppercase text-gray-400">Authenticated Ledger Record</p>
                </div>
            </header>

            <section className="mb-12">
                <h2 className="text-lg font-black uppercase tracking-tight mb-6 border-b-2 border-black pb-1">Executive Performance Matrix</h2>
                <div className="grid grid-cols-4 gap-6">
                    <div className="p-4 border-2 rounded-xl">
                        <p className="text-[9px] font-black uppercase text-gray-500 mb-1">Total Revenue</p>
                        <p className="text-2xl font-black font-mono">${totalRevenue.toFixed(2)}</p>
                    </div>
                    <div className="p-4 border-2 rounded-xl">
                        <p className="text-[9px] font-black uppercase text-gray-500 mb-1">Payroll Load</p>
                        <p className="text-2xl font-black font-mono text-red-600">-${netTakeHomeTotal.toFixed(2)}</p>
                    </div>
                    <div className="p-4 border-2 rounded-xl">
                        <p className="text-[9px] font-black uppercase text-gray-500 mb-1">Overhead Draw</p>
                        <p className="text-2xl font-black font-mono text-red-600">-${periodOverhead.toFixed(2)}</p>
                    </div>
                    <div className="p-4 border-2 rounded-xl bg-gray-100">
                        <p className="text-[9px] font-black uppercase text-gray-500 mb-1">True Net Margin</p>
                        <p className={cn("text-2xl font-black font-mono", totalContribution >= 0 ? "text-primary" : "text-red-600")}>
                            ${totalContribution.toFixed(2)}
                        </p>
                    </div>
                </div>
            </section>

            <section className="mb-12 break-inside-avoid">
                <h2 className="text-lg font-black uppercase tracking-tight mb-6 border-b-2 border-black pb-1">Technician Payout Ledger</h2>
                <Table>
                    <TableHeader>
                        <TableRow className="border-b-2 border-black hover:bg-transparent">
                            <TableHead className="font-black text-[10px] uppercase p-4">Provider</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Wages/Comm.</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Ret. Comm.</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Gratuity</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">B.B. Fees</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Final Payout</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {payrollData.map(data => (
                            <TableRow key={data.id} className="border-b hover:bg-transparent">
                                <TableCell className="p-4 font-bold uppercase truncate">{data.name}</TableCell>
                                <TableCell className="text-right font-mono">${data.stats.wages.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono">${data.stats.retailCommission.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono text-green-600">+${data.stats.tips.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono text-red-600">-${data.stats.costOfGoodsSold.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono font-black text-lg">
                                    ${data.stats.totalPay.toFixed(2)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                    <TableFooter className="bg-gray-50">
                        <TableRow className="hover:bg-transparent">
                            <TableCell className="p-4 font-black uppercase text-[10px]">Registry Totals</TableCell>
                            <TableCell colSpan={4}></TableCell>
                            <TableCell className="text-right font-mono font-black text-xl">
                                ${payrollTotal.toFixed(2)}
                            </TableCell>
                        </TableRow>
                    </TableFooter>
                </Table>
            </section>

            <section className="break-inside-avoid">
                <h2 className="text-lg font-black uppercase tracking-tight mb-6 border-b-2 border-black pb-1">Operational Benchmarks</h2>
                <div className="grid grid-cols-2 gap-12">
                    <div className="space-y-4">
                        <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Retention & Growth</p>
                        <Table>
                            <TableBody>
                                {payrollData.map(data => (
                                    <TableRow key={data.id} className="border-b hover:bg-transparent">
                                        <TableCell className="font-bold uppercase text-xs p-3">{data.name.split(' ')[0]}</TableCell>
                                        <TableCell className="text-right text-xs font-black">{data.stats.rebookingRate.toFixed(0)}% Rebook</TableCell>
                                        <TableCell className="text-right text-xs font-black">{data.stats.retailAttachmentRate.toFixed(0)}% Retail</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="space-y-4">
                        <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Time & Yield Density</p>
                        <Table>
                            <TableBody>
                                {payrollData.map(data => (
                                    <TableRow key={data.id} className="border-b hover:bg-transparent">
                                        <TableCell className="font-bold uppercase text-xs p-3">{data.name.split(' ')[0]}</TableCell>
                                        <TableCell className="text-right text-xs font-black">{data.stats.utilizationRate.toFixed(0)}% Util.</TableCell>
                                        <TableCell className="text-right text-xs font-black">${data.stats.yieldPerHour.toFixed(2)}/hr</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </section>

            <footer className="mt-24 pt-8 border-t-2 border-gray-200 text-center text-[9px] text-gray-400 uppercase font-black tracking-[0.3em]">
                <p>ClarityFlow Studio OS &middot; Certified Financial Internal Dossier &middot; Page 1 of 1</p>
            </footer>
        </div>
    );
});

PrintableStaffReport.displayName = 'PrintableStaffReport';
