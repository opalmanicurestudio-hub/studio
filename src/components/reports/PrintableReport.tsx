'use client';

import React, { useState, useEffect } from 'react';
import { type Transaction } from '@/lib/financial-data';
import { type Staff, type Appointment, type Service, type ActivityLog } from '@/lib/data';
import { DateRange } from 'react-day-picker';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Clock, Coffee, TrendingUp, DollarSign } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

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
    newClientRate: number;
  };
  payrollData: (Staff & { stats: any })[];
  payrollTotals: {
    totalWages: number;
    totalTips: number;
    totalRetailCommission: number;
    totalPayroll: number;
    totalNetProfit: number;
  };
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
    payrollTotals,
    grossProfit,
    totalGrossRevenue,
    totalCOGS,
    periodOverhead,
    servicePerformanceData,
    appointments,
    activityLogs,
    transactions,
    services,
}, ref) => {
    const [generationDate, setGenerationDate] = useState<Date | null>(null);

    useEffect(() => {
        setGenerationDate(new Date());
    }, []);

    const dateRangeString = dateRange?.from && dateRange.to
    ? `${format(dateRange.from, 'MMM d, yyyy')} - ${format(dateRange.to, 'MMM d, yyyy')}`
    : 'All Time';

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

            <header className="mb-8 border-b-2 border-black pb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-black uppercase tracking-tighter">Studio Performance Report</h1>
                    <p className="text-gray-600 font-bold uppercase tracking-widest text-[10px] mt-1">{dateRangeString}</p>
                </div>
                <div className="text-right text-[10px] text-gray-400 uppercase font-black">
                    <p>Generated: {generationDate ? format(generationDate, 'PPP p') : ''}</p>
                </div>
            </header>

            <section className="mb-10">
                <h2 className="text-lg font-black uppercase tracking-tight mb-4 border-b pb-1">Executive Summary</h2>
                <div className="grid grid-cols-4 gap-4">
                    <div className="p-3 border rounded-lg">
                        <p className="text-[9px] font-black uppercase text-gray-500 mb-1">Total Revenue</p>
                        <p className="text-xl font-black">${totalGrossRevenue.toFixed(2)}</p>
                    </div>
                    <div className="p-3 border rounded-lg">
                        <p className="text-[9px] font-black uppercase text-gray-500 mb-1">Gross Profit</p>
                        <p className="text-xl font-black text-green-600">${grossProfit.toFixed(2)}</p>
                    </div>
                    <div className="p-3 border rounded-lg">
                        <p className="text-[9px] font-black uppercase text-gray-500 mb-1">Operating Profit</p>
                        <p className="text-xl font-black text-primary">${payrollTotals.totalNetProfit.toFixed(2)}</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-gray-50">
                        <p className="text-[9px] font-black uppercase text-gray-500 mb-1">True Net (After Overhead)</p>
                        <p className={cn("text-xl font-black", (payrollTotals.totalNetProfit - periodOverhead) >= 0 ? "text-primary" : "text-destructive")}>
                            ${(payrollTotals.totalNetProfit - periodOverhead).toFixed(2)}
                        </p>
                    </div>
                </div>
            </section>

            <section className="mb-10">
                <h2 className="text-lg font-black uppercase tracking-tight mb-4 border-b pb-1">Salon-Wide KPIs</h2>
                <div className="grid grid-cols-4 gap-y-6">
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-gray-400">Avg Ticket</p>
                        <p className="text-base font-bold">${kpiData.avgSalePerAppointment.toFixed(2)}</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-gray-400">Utilization</p>
                        <p className="text-base font-bold">{kpiData.utilizationRate.toFixed(1)}%</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-gray-400">Retail Attach</p>
                        <p className="text-base font-bold">{kpiData.retailAttachmentRate.toFixed(1)}%</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-gray-400">Cancellation</p>
                        <p className="text-base font-bold">{kpiData.cancellationRate.toFixed(1)}%</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-gray-400">Rebooking</p>
                        <p className="text-base font-bold">{kpiData.rebookingRate.toFixed(1)}%</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-gray-400">New Client Rate</p>
                        <p className="text-base font-bold">{kpiData.newClientRate.toFixed(1)}%</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-gray-400">Waitlist Conv.</p>
                        <p className="text-base font-bold">{kpiData.walkInConversionRate.toFixed(1)}%</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-gray-400">Rev / Svc Hour</p>
                        <p className="text-base font-bold">${kpiData.revenuePerServiceHour.toFixed(2)}</p>
                    </div>
                </div>
            </section>

            <section className="mb-10 break-inside-avoid">
                <h2 className="text-lg font-black uppercase tracking-tight mb-4 border-b pb-1">Payroll & Staff Performance</h2>
                <Table>
                    <TableHeader>
                        <TableRow className="border-b-2 border-black">
                            <TableHead className="font-black text-[10px] uppercase">Staff Member</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Svc Rev</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Tips</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Total Pay</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Util %</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Net Contrib.</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {payrollData.map(data => (
                            <TableRow key={data.id} className="border-b">
                                <TableCell className="font-bold">{data.name || 'Staff'}</TableCell>
                                <TableCell className="text-right font-mono">${data.stats.serviceRevenue.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono text-green-600">${data.stats.tips.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono font-bold">${data.stats.totalPay.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono">{data.stats.utilizationRate.toFixed(1)}%</TableCell>
                                <TableCell className={cn("text-right font-mono font-bold", data.stats.netProfit >= 0 ? "text-primary" : "text-destructive")}>
                                    ${data.stats.netProfit.toFixed(2)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                    <TableFooter>
                        <TableRow className="border-t-2 border-black font-black">
                            <TableCell className="uppercase">Studio Totals</TableCell>
                            <TableCell className="text-right font-mono">${totalGrossRevenue.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono">${payrollTotals.totalTips.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono">${payrollTotals.totalPayroll.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono">{kpiData.utilizationRate.toFixed(1)}%</TableCell>
                            <TableCell className="text-right font-mono text-primary">${payrollTotals.totalNetProfit.toFixed(2)}</TableCell>
                        </TableRow>
                    </TableFooter>
                </Table>
            </section>

            <section className="break-before-page pt-8">
                <h2 className="text-lg font-black uppercase tracking-tight mb-4 border-b pb-1">Service Performance Analysis</h2>
                <Table>
                    <TableHeader>
                        <TableRow className="border-b-2 border-black">
                            <TableHead className="font-black text-[10px] uppercase">Service Name</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Bookings</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Avg Time</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase">Total Revenue</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {servicePerformanceData.map(service => (
                            <TableRow key={service.id} className="border-b">
                                <TableCell className="font-bold">{service.name}</TableCell>
                                <TableCell className="text-right font-mono">{service.totalBookings}</TableCell>
                                <TableCell className="text-right font-mono">{service.avgTime.toFixed(0)} min</TableCell>
                                <TableCell className="text-right font-mono font-bold">${service.totalRevenue.toFixed(2)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </section>

            <footer className="mt-20 pt-8 border-t border-gray-100 text-center text-[9px] text-gray-400 uppercase font-black tracking-[0.2em]">
                <p>ClarityFlow Studio Management System &middot; Confidential Internal Record</p>
            </footer>
        </div>
    );
});

PrintableStaffReport.displayName = 'PrintableStaffReport';