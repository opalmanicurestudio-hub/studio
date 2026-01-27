

'use client';

import React from 'react';
import { type DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface PrintableReportProps {
  dateRange: DateRange | undefined;
  kpiData: any;
  payrollData: any;
  payrollTotals: any;
  grossProfit: number;
  totalGrossRevenue: number;
  totalCOGS: number;
  periodOverhead: number;
  servicePerformanceData: any[];
}

export const PrintableReport = React.forwardRef<HTMLDivElement, PrintableReportProps>(({ 
    dateRange, 
    kpiData, 
    payrollData, 
    payrollTotals,
    grossProfit,
    totalGrossRevenue,
    totalCOGS,
    periodOverhead,
    servicePerformanceData
}, ref) => {
    
    const dateRangeString = dateRange?.from && dateRange.to
    ? `${format(dateRange.from, 'MMM d, yyyy')} - ${format(dateRange.to, 'MMM d, yyyy')}`
    : 'All Time';

    return (
        <div ref={ref} className="p-8 bg-white text-black font-sans text-sm">
            <style jsx global>{`
                @media print {
                    @page {
                        size: A4;
                        margin: 1in;
                    }
                    body {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .break-before-page {
                        page-break-before: always;
                    }
                }
            `}</style>

            <header className="mb-8 text-center">
                <h1 className="text-3xl font-bold">Performance Report</h1>
                <p className="text-gray-600">{dateRangeString}</p>
            </header>

            <section className="mb-8">
                <h2 className="text-xl font-semibold border-b pb-2 mb-4">Key Performance Indicators</h2>
                <div className="grid grid-cols-4 gap-4">
                    <div className="border p-3 rounded-md">
                        <h3 className="text-xs text-gray-500">Avg. Ticket Size</h3>
                        <p className="text-2xl font-bold">${kpiData.avgTicket.toFixed(2)}</p>
                    </div>
                     <div className="border p-3 rounded-md">
                        <h3 className="text-xs text-gray-500">Utilization Rate</h3>
                        <p className="text-2xl font-bold">{kpiData.utilizationRate.toFixed(1)}%</p>
                    </div>
                     <div className="border p-3 rounded-md">
                        <h3 className="text-xs text-gray-500">Retail Attachment</h3>
                        <p className="text-2xl font-bold">{kpiData.retailAttachmentRate.toFixed(1)}%</p>
                    </div>
                    <div className="border p-3 rounded-md">
                        <h3 className="text-xs text-gray-500">Cancellation Rate</h3>
                        <p className="text-2xl font-bold">{kpiData.cancellationRate.toFixed(1)}%</p>
                    </div>
                    <div className="border p-3 rounded-md">
                        <h3 className="text-xs text-gray-500">Revenue/Service Hr</h3>
                        <p className="text-2xl font-bold">${kpiData.revenuePerServiceHour.toFixed(2)}</p>
                    </div>
                    <div className="border p-3 rounded-md">
                        <h3 className="text-xs text-gray-500">Rebooking Rate</h3>
                        <p className="text-2xl font-bold">{kpiData.rebookingRate.toFixed(1)}%</p>
                    </div>
                    <div className="border p-3 rounded-md">
                        <h3 className="text-xs text-gray-500">Walk-in Conversion</h3>
                        <p className="text-2xl font-bold">{kpiData.walkInConversionRate.toFixed(1)}%</p>
                    </div>
                    <div className="border p-3 rounded-md">
                        <h3 className="text-xs text-gray-500">New Client Rate</h3>
                        <p className="text-2xl font-bold">{kpiData.newClientRate.toFixed(1)}%</p>
                    </div>
                </div>
            </section>
            
            <section className="mb-8 break-before-page">
                <h2 className="text-xl font-semibold border-b pb-2 mb-4">Payroll Report</h2>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-12"></TableHead>
                            <TableHead>Staff Member</TableHead>
                            <TableHead>Pay Structure</TableHead>
                            <TableHead className="text-right">Service Rev.</TableHead>
                            <TableHead className="text-right">Tips</TableHead>
                            <TableHead className="text-right font-bold text-primary">Total Payout</TableHead>
                             <TableHead className="text-right font-bold">Net Contribution</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {payrollData.map((data: any) => (
                            <TableRow key={data.id}>
                                <TableCell>
                                    <Avatar className="h-9 w-9">
                                        <AvatarImage src={data.avatarUrl} alt={data.name} />
                                        <AvatarFallback>{data.name.substring(0, 2)}</AvatarFallback>
                                    </Avatar>
                                </TableCell>
                                <TableCell className="font-medium">{data.name}</TableCell>
                                <TableCell>
                                      <div className="font-medium capitalize">{data.payStructure}</div>
                                      {data.payStructure === 'commission' && data.commissionRate !== undefined && (
                                          <div className="text-xs text-gray-500">
                                              {data.commissionRate}% (Svc) / {data.retailCommissionRate || 0}% (Retail)
                                          </div>
                                      )}
                                      {data.payStructure === 'hourly' && data.hourlyRate !== undefined && (
                                          <div className="text-xs text-gray-500">
                                              ${data.hourlyRate.toFixed(2)}/hr
                                          </div>
                                      )}
                                  </TableCell>
                                <TableCell className="text-right font-mono">${data.stats.serviceRevenue.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono">${data.stats.tips.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono font-bold text-blue-600">${data.stats.totalPay.toFixed(2)}</TableCell>
                                <TableCell className={cn("text-right font-mono font-bold", data.stats.netProfit >= 0 ? 'text-green-600' : 'text-red-600')}>${data.stats.netProfit.toFixed(2)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                     <TableFooter>
                          <TableRow><TableCell colSpan={6} className="font-semibold">Total Gross Revenue</TableCell><TableCell className="text-right font-mono font-semibold">${totalGrossRevenue.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={6} className="text-gray-500 pl-8">Cost of Goods Sold (COGS)</TableCell><TableCell className="text-right font-mono text-red-600">-${totalCOGS.toFixed(2)}</TableCell></TableRow>
                          <TableRow className="font-bold border-t"><TableCell colSpan={6}>Gross Profit</TableCell><TableCell className="text-right font-mono">${grossProfit.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={7} className="py-2"></TableCell></TableRow>
                          <TableRow><TableCell colSpan={6} className="font-semibold">Operating Expenses</TableCell><TableCell></TableCell></TableRow>
                          <TableRow><TableCell colSpan={6} className="text-gray-500 pl-8">Service Wages</TableCell><TableCell className="text-right font-mono text-red-600">-${payrollTotals.totalWages.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={6} className="text-gray-500 pl-8">Retail Commission</TableCell><TableCell className="text-right font-mono text-red-600">-${payrollTotals.totalRetailCommission.toFixed(2)}</TableCell></TableRow>
                          <TableRow className="font-bold border-t"><TableCell colSpan={6}>Operating Profit</TableCell><TableCell className={cn("text-right font-mono", payrollTotals.totalNetProfit >= 0 ? 'text-green-600' : 'text-red-600')}>${payrollTotals.totalNetProfit.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={7} className="py-2"></TableCell></TableRow>
                          <TableRow><TableCell colSpan={6} className="font-semibold">Overhead Expenses</TableCell><TableCell className="text-right font-mono text-red-600">-${periodOverhead.toFixed(2)}</TableCell></TableRow>
                          <TableRow className="font-bold text-lg bg-gray-100"><TableCell colSpan={6}>True Net Profit</TableCell><TableCell className={cn("text-right font-mono", (payrollTotals.totalNetProfit - periodOverhead) >= 0 ? 'text-green-600' : 'text-red-600')}>${(payrollTotals.totalNetProfit - periodOverhead).toFixed(2)}</TableCell></TableRow>
                    </TableFooter>
                </Table>
            </section>
            
             <section className="break-before-page">
                <h2 className="text-xl font-semibold border-b pb-2 mb-4">Service Performance</h2>
                <Table>
                    <TableHeader><TableRow><TableHead>Service</TableHead><TableHead className="text-right"># Bookings</TableHead><TableHead className="text-right">Avg. Time</TableHead><TableHead className="text-right">Total Revenue</TableHead></TableRow></TableHeader>
                    <TableBody>
                        {servicePerformanceData.map(service => (
                            <TableRow key={service.id}>
                                <TableCell className="font-medium">{service.name}</TableCell>
                                <TableCell className="text-right font-mono">{service.totalBookings}</TableCell>
                                <TableCell className="text-right font-mono">{service.avgTime.toFixed(0)} min</TableCell>
                                <TableCell className="text-right font-mono">${service.totalRevenue.toFixed(2)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </section>
        </div>
    );
});

PrintableStaffReport.displayName = 'PrintableStaffReport';
