
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartConfig,
} from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { useInventory } from '@/context/InventoryContext';
import { differenceInMinutes, format, getHours, parseISO, startOfDay, endOfDay, subDays, differenceInSeconds } from 'date-fns';
import { Clock, BarChart as BarChartIcon, Hourglass, Users, Sigma, Wallet, Calendar as CalendarIcon, ShoppingCart, Percent, Target, TrendingUp, DollarSign, Ban } from 'lucide-react';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const chartConfig = {
  waitTime: {
    label: 'Wait Time (min)',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig;

export default function ReportsPage() {
  const { appointments, services, staff, walkIns, transactions, activityLogs, stockCorrections, inventory } = useInventory();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 29), to: new Date() });

  const performanceAndPayrollData = useMemo(() => {
    if (!staff || !appointments || !services || !transactions || !activityLogs) return [];
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return staff.map(staffMember => {
        const filterByDate = (date: string) => {
            const d = parseISO(date);
            if (fromDate && d < fromDate) return false;
            if (toDate && d > toDate) return false;
            return true;
        }

        const staffAppointments = appointments.filter(apt => apt.staffId === staffMember.id && filterByDate(apt.startTime));
        const completedAppointments = staffAppointments.filter(apt => apt.status === 'completed');
        const completedAppointmentsCount = completedAppointments.length;
      
        const staffTransactions = transactions.filter(t => t.staffId === staffMember.id && filterByDate(t.date));

        // KPI Calculations
        let totalMinutesVariance = 0;
        let totalInServiceMinutes = 0;
        completedAppointments.forEach(apt => {
            const service = services.find(s => s.id === apt.serviceId);
            if (apt.actualStartTime && apt.actualEndTime && service) {
                const actualDuration = differenceInMinutes(parseISO(apt.actualEndTime), parseISO(apt.actualStartTime));
                const scheduledDuration = service.duration;
                totalMinutesVariance += actualDuration - scheduledDuration;
                totalInServiceMinutes += actualDuration;
            }
        });
      
        const avgVariance = completedAppointmentsCount > 0 ? totalMinutesVariance / completedAppointmentsCount : 0;
        const avgActualServiceTime = completedAppointmentsCount > 0 ? totalInServiceMinutes / completedAppointmentsCount : 0;
      
        const serviceRevenue = staffTransactions.filter(t => t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0);
        const retailSales = staffTransactions.filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
        const totalSales = serviceRevenue + retailSales;
        const tips = staffTransactions.reduce((acc, t) => acc + (t.tipAmount || 0), 0);
        
        const retailTransactionsWithAppointment = staffTransactions.filter(t => t.category === 'Retail' && t.appointmentId);
        const retailAttachmentRate = completedAppointmentsCount > 0 ? (new Set(retailTransactionsWithAppointment.map(t => t.appointmentId)).size / completedAppointmentsCount) * 100 : 0;
        const avgTicket = completedAppointmentsCount > 0 ? totalSales / completedAppointmentsCount : 0;

        // Payroll and Utilization
        let totalMinutesWorked = 0;
        const staffLogs = activityLogs.filter(log => log.staffId === staffMember.id && filterByDate(log.timestamp));
        const sortedLogs = staffLogs.sort((a, b) => parseISO(a.timestamp).getTime() - parseISO(b.timestamp).getTime());
        
        let clockInTime: Date | null = null;
        let totalBreakMinutes = 0;
        for (const log of sortedLogs) {
            const logTime = parseISO(log.timestamp);
            if (log.type === 'clock_in') {
                if (clockInTime) totalMinutesWorked += Math.max(0, differenceInMinutes(logTime, clockInTime) - totalBreakMinutes);
                clockInTime = logTime;
                totalBreakMinutes = 0;
            } else if (log.type === 'clock_out' && clockInTime) {
                let sessionEnd = logTime;
                if (toDate && sessionEnd > toDate) sessionEnd = toDate;
                totalMinutesWorked += Math.max(0, differenceInMinutes(sessionEnd, clockInTime) - totalBreakMinutes);
                clockInTime = null;
            } else if (log.type === 'break_end' && log.durationMinutes) {
                totalBreakMinutes += log.durationMinutes;
            }
        }
        if(clockInTime && (!toDate || clockInTime < toDate)) {
            const endOfRange = toDate && toDate < new Date() ? toDate : new Date();
            totalMinutesWorked += Math.max(0, differenceInMinutes(endOfRange, clockInTime) - totalBreakMinutes);
        }

        const utilizationRate = totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0;
        
        let wages = 0;
        if (staffMember.payStructure === 'commission') {
            wages = serviceRevenue * ((staffMember.commissionRate || 0) / 100);
        } else if (staffMember.payStructure === 'hourly' && staffMember.hourlyRate) {
            wages = (totalMinutesWorked / 60) * staffMember.hourlyRate;
        }

        const retailCommission = retailSales * ((staffMember.retailCommissionRate || 0) / 100);
        const totalPay = wages + tips + retailCommission;
        
        const costOfGoodsSold = completedAppointments.reduce((acc, apt) => {
            const service = services.find(s => s.id === apt.serviceId);
            return acc + (service?.cost || 0);
        }, 0);
        const netProfit = totalSales - costOfGoodsSold - (wages + retailCommission);
        
        return {
            ...staffMember,
            stats: {
                totalServices: completedAppointmentsCount,
                avgActualServiceTime,
                avgVariance,
                totalInServiceHours: totalInServiceMinutes / 60,
                utilizationRate,
                avgTicket,
                retailAttachmentRate,
                serviceRevenue,
                retailSales,
                retailCommission,
                tips,
                wages,
                totalPay,
                netProfit,
                totalHours: totalMinutesWorked / 60,
            }
        };
    });
  }, [staff, appointments, services, transactions, activityLogs, dateRange]);

  const salonWideStats = useMemo(() => {
    if (!appointments || !transactions || !staff) return { avgTicket: 0, utilizationRate: 0, retailAttachmentRate: 0, cancellationRate: 0 };
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    const appointmentsInRange = appointments.filter(apt => {
        const aptDate = parseISO(apt.startTime);
        if (fromDate && aptDate < fromDate) return false;
        if (toDate && aptDate > toDate) return false;
        return true;
    });

    const completedAppointments = appointmentsInRange.filter(apt => apt.status === 'completed');
    const cancelledAppointments = appointmentsInRange.filter(apt => apt.status === 'cancelled');

    const totalRevenue = transactions
        .filter(t => {
            const tDate = parseISO(t.date);
            if (fromDate && tDate < fromDate) return false;
            if (toDate && tDate > toDate) return false;
            return t.type === 'income' && (t.category === 'Service Revenue' || t.category === 'Retail');
        })
        .reduce((acc, t) => acc + t.amount, 0);
        
    const retailTransactions = transactions.filter(t => t.category === 'Retail' && t.appointmentId);
    const appointmentsWithRetail = new Set(retailTransactions.map(t => t.appointmentId));

    const totalInServiceMinutes = performanceAndPayrollData.reduce((acc, d) => acc + (d.stats.totalInServiceHours * 60), 0);
    const totalMinutesWorked = performanceAndPayrollData.reduce((acc, d) => acc + (d.stats.totalHours * 60), 0);
    
    return {
      avgTicket: completedAppointments.length > 0 ? totalRevenue / completedAppointments.length : 0,
      utilizationRate: totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0,
      retailAttachmentRate: completedAppointments.length > 0 ? (appointmentsWithRetail.size / completedAppointments.length) * 100 : 0,
      cancellationRate: appointmentsInRange.length > 0 ? (cancelledAppointments.length / appointmentsInRange.length) * 100 : 0,
    }
  }, [performanceAndPayrollData, appointments, transactions, staff, dateRange]);


  const waitTimeData = useMemo(() => {
    if (!walkIns) return { chartData: [], avgWaitTime: 0 };
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    const completedWalkIns = walkIns.filter(
      w => {
          if (w.status !== 'completed' || !w.serviceStartTime) return false;
          const checkInDate = parseISO(w.checkInTime);
          if(fromDate && checkInDate < fromDate) return false;
          if(toDate && checkInDate > toDate) return false;
          return true;
      }
    );

    const hourlyWaitTimes: { [hour: number]: { totalWait: number; count: number } } = {};

    for(let i = 8; i < 20; i++) { // From 8 AM to 7 PM
        hourlyWaitTimes[i] = { totalWait: 0, count: 0 };
    }

    completedWalkIns.forEach(w => {
      const checkInTime = parseISO(w.checkInTime);
      const serviceStartTime = parseISO(w.serviceStartTime!);
      const waitMinutes = differenceInMinutes(serviceStartTime, checkInTime);
      const hour = getHours(checkInTime);

      if (hourlyWaitTimes[hour]) {
        hourlyWaitTimes[hour].totalWait += waitMinutes;
        hourlyWaitTimes[hour].count++;
      }
    });

    const chartData = Object.entries(hourlyWaitTimes).map(([hour, data]) => ({
      hour: `${parseInt(hour, 10)}:00`,
      waitTime: data.count > 0 ? data.totalWait / data.count : 0,
    }));
    
    const totalWaitMinutes = chartData.reduce((acc, d) => acc + d.waitTime * (hourlyWaitTimes[parseInt(d.hour)]?.count || 0), 0);
    const avgWaitTime = completedWalkIns.length > 0 ? totalWaitMinutes / completedWalkIns.length : 0;
    
    return { chartData, avgWaitTime };

  }, [walkIns, dateRange]);
  
  const payrollTotals = useMemo(() => {
    return performanceAndPayrollData.reduce((acc, staff) => {
        acc.totalWages += staff.stats.wages;
        acc.totalTips += staff.stats.tips;
        acc.totalRetailCommission += staff.stats.retailCommission;
        acc.totalPayroll += staff.stats.totalPay;
        acc.totalNetProfit += staff.stats.netProfit;
        return acc;
    }, { totalWages: 0, totalTips: 0, totalRetailCommission: 0, totalPayroll: 0, totalNetProfit: 0 });
  }, [performanceAndPayrollData]);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Reports & Analytics" />
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Reports</h1>
            <p className="text-muted-foreground">
              Insights into your salon's performance and efficiency.
            </p>
          </div>
           <Popover>
            <PopoverTrigger asChild>
                <Button id="date" variant={"outline"} className={cn( "w-full sm:w-[300px] justify-start text-left font-normal", !dateRange && "text-muted-foreground" )}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? ( dateRange.to ? ( <> {format(dateRange.from, "LLL dd, yyyy")} -{" "} {format(dateRange.to, "LLL dd, yyyy")} </> ) : ( format(dateRange.from, "LLL dd, yyyy") ) ) : ( <span>Pick a date range</span> )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
                <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
             <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Avg. Ticket Size</CardTitle><DollarSign className="h-4 w-4 text-muted-foreground" /></CardHeader>
                <CardContent><div className="text-2xl font-bold">${salonWideStats.avgTicket.toFixed(2)}</div><p className="text-xs text-muted-foreground">Average revenue per appointment</p></CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Stylist Utilization</CardTitle><Target className="h-4 w-4 text-muted-foreground" /></CardHeader>
                <CardContent><div className="text-2xl font-bold">{salonWideStats.utilizationRate.toFixed(1)}%</div><p className="text-xs text-muted-foreground">Of clocked-in time is spent on services</p></CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Retail Attachment</CardTitle><ShoppingCart className="h-4 w-4 text-muted-foreground" /></CardHeader>
                <CardContent><div className="text-2xl font-bold">{salonWideStats.retailAttachmentRate.toFixed(1)}%</div><p className="text-xs text-muted-foreground">Of appointments include a retail sale</p></CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Cancellation Rate</CardTitle><Ban className="h-4 w-4 text-muted-foreground" /></CardHeader>
                <CardContent><div className="text-2xl font-bold">{salonWideStats.cancellationRate.toFixed(1)}%</div><p className="text-xs text-muted-foreground">Of all booked appointments</p></CardContent>
            </Card>
        </div>

        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Wallet /> Payroll Report</CardTitle>
                <CardDescription>A summary of staff earnings and business profitability for the selected period.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Staff Member</TableHead>
                            <TableHead className="text-right">Service Rev.</TableHead>
                            <TableHead className="text-right">Retail Sales</TableHead>
                            <TableHead className="text-right">Wages</TableHead>
                            <TableHead className="text-right">Retail Comm.</TableHead>
                            <TableHead className="text-right">Tips</TableHead>
                            <TableHead className="text-right font-bold">Total Pay</TableHead>
                             <TableHead className="text-right font-bold">Net Profit</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {performanceAndPayrollData.map(data => (
                            <TableRow key={data.id}>
                                <TableCell className="font-medium">{data.name}</TableCell>
                                <TableCell className="text-right font-mono">${data.stats.serviceRevenue.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono">${data.stats.retailSales.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono">${data.stats.wages.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono text-blue-500">${data.stats.retailCommission.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono text-green-500">${data.stats.tips.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono font-bold">${data.stats.totalPay.toFixed(2)}</TableCell>
                                <TableCell className={cn("text-right font-mono font-bold", data.stats.netProfit >= 0 ? 'text-primary' : 'text-destructive')}>${data.stats.netProfit.toFixed(2)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                    <TableFooter>
                        <TableRow className="font-bold">
                            <TableCell colSpan={3}>Total Payroll Cost</TableCell>
                            <TableCell className="text-right font-mono">${payrollTotals.totalWages.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-blue-500">${payrollTotals.totalRetailCommission.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-green-500">${payrollTotals.totalTips.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono">${payrollTotals.totalPayroll.toFixed(2)}</TableCell>
                            <TableCell className={cn("text-right font-mono", payrollTotals.totalNetProfit >= 0 ? 'text-primary' : 'text-destructive')}>${payrollTotals.totalNetProfit.toFixed(2)}</TableCell>
                        </TableRow>
                    </TableFooter>
                </Table>
            </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle>Stylist Effectiveness</CardTitle>
              <CardDescription>
                Analysis of key performance indicators by staff member.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff Member</TableHead>
                    <TableHead className="text-right">Utilization</TableHead>
                    <TableHead className="text-right">Avg. Ticket</TableHead>
                    <TableHead className="text-right">Retail Attach</TableHead>
                    <TableHead className="text-right">Time Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performanceAndPayrollData.map(data => (
                    <TableRow key={data.id}>
                      <TableCell className="font-medium">{data.staffName}</TableCell>
                      <TableCell className="text-right font-mono">{data.stats.utilizationRate.toFixed(1)}%</TableCell>
                      <TableCell className="text-right font-mono">${data.stats.avgTicket.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{data.stats.retailAttachmentRate.toFixed(1)}%</TableCell>
                      <TableCell className={`text-right font-mono ${data.stats.avgVariance > 0 ? 'text-destructive' : 'text-green-500'}`}>
                        {data.stats.avgVariance > 0 ? '+' : ''}{data.stats.avgVariance.toFixed(1)} min
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="lg:col-span-3">
             <CardHeader>
              <CardTitle>Walk-in Wait Time by Hour</CardTitle>
              <CardDescription>Average wait time for walk-in customers throughout the day.</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
                <ClientOnly>
                    <ChartContainer config={chartConfig} className="h-[300px] w-full">
                        <BarChart accessibilityLayer data={waitTimeData.chartData}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                            dataKey="hour"
                            tickLine={false}
                            tickMargin={10}
                            axisLine={false}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickMargin={10}
                            tickFormatter={(value) => `${value}m`}
                        />
                        <ChartTooltip
                            cursor={false}
                            content={<ChartTooltipContent />}
                        />
                        <Bar dataKey="waitTime" fill="var(--color-waitTime)" radius={8} />
                        </BarChart>
                    </ChartContainer>
              </ClientOnly>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

