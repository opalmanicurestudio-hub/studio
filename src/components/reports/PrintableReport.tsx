'use client';

import React from 'react';
import { type DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, DollarSign } from 'lucide-react';

interface PrintableStaffReportProps {
  dateRange: DateRange | undefined;
  kpiData: any;
  payrollData: any[];
  payrollTotals: any;
  grossProfit: number;
  totalGrossRevenue: number;
  totalCOGS: number;
  periodOverhead: number;
  servicePerformanceData: any[];
  staffMember?: any; // Added for single staff report fallback
  activityLogs?: any[];
  transactions?: any[];
  services?: any[];
  appointments?: any[];
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
                    <div className="border p-3 rounded-md text-center">
                        <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Avg. Ticket</h3>
                        <p className="text-xl font-black">${kpiData.avgSalePerAppointment?.toFixed(2) || '0.00'}</p>
                    </div>
                     <div className="border p-3 rounded-md text-center">
                        <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Util. Rate</h3>
                        <p className="text-xl font-black">{kpiData.utilizationRate?.toFixed(1) || '0.0'}%</p>
                    </div>
                     <div className="border p-3 rounded-md text-center">
                        <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Retail</h3>
                        <p className="text-xl font-black">{kpiData.retailAttachmentRate?.toFixed(1) || '0.0'}%</p>
                    </div>
                    <div className="border p-3 rounded-md text-center">
                        <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Cancel %</h3>
                        <p className="text-xl font-black">{kpiData.cancellationRate?.toFixed(1) || '0.0'}%</p>
                    </div>
                </div>
            </section>
            
            <section className="mb-8">
                <h2 className="text-xl font-semibold border-b pb-2 mb-4">Payroll Report</h2>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-12"></TableHead>
                            <TableHead className="font-black text-[10px] uppercase tracking-widest">Staff Member</TableHead>
                            <TableHead className="font-black text-[10px] uppercase tracking-widest">Pay Structure</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Svc Rev.</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Tips</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Total Payout</TableHead>
                             <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Net Contrib.</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {payrollData.map((data: any) => (
                            <TableRow key={data.id}>
                                <TableCell>
                                    <Avatar className="h-9 w-9 border shadow-sm">
                                        <AvatarImage src={data.avatarUrl} alt={data.name || 'Staff'} className="object-cover" />
                                        <AvatarFallback>{(data.name || 'S').substring(0, 2).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                </TableCell>
                                <TableCell className="font-bold tracking-tight">{data.name || 'Unknown'}</TableCell>
                                <TableCell>
                                      <div className="font-bold uppercase text-[9px] tracking-tight">{data.payStructure}</div>
                                      {data.payStructure === 'commission' && data.commissionRate !== undefined && (
                                          <div className="text-[8px] text-gray-500 uppercase font-medium">
                                              {data.commissionRate}% Svc / {data.retailCommissionRate || 0}% Ret.
                                          </div>
                                      )}
                                      {data.payStructure === 'hourly' && data.hourlyRate !== undefined && (
                                          <div className="text-[8px] text-gray-500 uppercase font-medium">
                                              ${data.hourlyRate.toFixed(2)}/hr
                                          </div>
                                      )}
                                  </TableCell>
                                <TableCell className="text-right font-mono font-bold text-xs">${data.stats.serviceRevenue.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono font-bold text-xs text-green-600">${data.stats.tips.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono font-black text-sm text-blue-600 bg-blue-50">${data.stats.totalPay.toFixed(2)}</TableCell>
                                <TableCell className={cn("text-right font-mono font-black text-sm", data.stats.netProfit >= 0 ? 'text-green-600' : 'text-red-600')}>${data.stats.netProfit.toFixed(2)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                     <TableFooter>
                          <TableRow><TableCell colSpan={6} className="font-black uppercase text-[10px] tracking-widest">Total Gross Revenue</TableCell><TableCell className="text-right font-mono font-black">${totalGrossRevenue.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={6} className="font-black uppercase text-[10px] tracking-widest text-gray-500 pl-8">Cost of Goods Sold (COGS)</TableCell><TableCell className="text-right font-mono text-red-600">-${totalCOGS.toFixed(2)}</TableCell></TableRow>
                          <TableRow className="font-black border-t-2 bg-gray-50"><TableCell colSpan={6} className="uppercase text-xs">Gross Profit</TableCell><TableCell className="text-right font-mono">${grossProfit.toFixed(2)}</TableCell></TableRow>
                          
                          <TableRow><TableCell colSpan={6} className="font-black uppercase text-[10px] tracking-widest text-gray-500 pl-8">Service Wages</TableCell><TableCell className="text-right font-mono text-red-600">-${payrollTotals.totalWages.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={6} className="font-black uppercase text-[10px] tracking-widest text-gray-500 pl-8">Retail Commission</TableCell><TableCell className="text-right font-mono text-red-600">-${payrollTotals.totalRetailCommission.toFixed(2)}</TableCell></TableRow>
                          <TableRow className="font-black border-t-2 bg-gray-50"><TableCell colSpan={6} className="uppercase text-xs">Operating Profit</TableCell><TableCell className={cn("text-right font-mono", payrollTotals.totalNetProfit >= 0 ? 'text-blue-600' : 'text-red-600')}>${payrollTotals.totalNetProfit.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={6} className="font-black uppercase text-[10px] tracking-widest text-gray-500 pl-8">Fixed Overhead</TableCell><TableCell className="text-right font-mono text-red-600">-${periodOverhead.toFixed(2)}</TableCell></TableRow>
                          <TableRow className="font-black text-lg bg-blue-50"><TableCell colSpan={6} className="uppercase tracking-tighter">True Net Profit</TableCell><TableCell className={cn("text-right font-mono tracking-tighter", (payrollTotals.totalNetProfit - periodOverhead) >= 0 ? 'text-blue-600' : 'text-red-600')}>${(payrollTotals.totalNetProfit - periodOverhead).toFixed(2)}</TableCell></TableRow>
                    </TableFooter>
                </Table>
            </section>
            
             <section className="break-before-page">
                <h2 className="text-xl font-semibold border-b pb-2 mb-4">Service Performance</h2>
                <Table>
                    <TableHeader><TableRow className="bg-gray-50"><TableHead className="font-black text-[10px] uppercase tracking-widest">Service</TableHead><TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Bookings</TableHead><TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Avg. Time</TableHead><TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Total Revenue</TableHead></TableRow></TableHeader>
                    <TableBody>
                        {servicePerformanceData.map(service => (
                            <TableRow key={service.id} className="border-b">
                                <TableCell className="font-bold">{service.name}</TableCell>
                                <TableCell className="text-right font-mono">{service.totalBookings}</TableCell>
                                <TableCell className="text-right font-mono">{service.avgTime.toFixed(0)} min</TableCell>
                                <TableCell className="text-right font-mono font-bold text-blue-600">${service.totalRevenue.toFixed(2)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </section>
        </div>
    );
});

PrintableStaffReport.displayName = 'PrintableStaffReport';
