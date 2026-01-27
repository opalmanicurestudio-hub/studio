

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
import { Clock, BarChart as BarChartIcon, Hourglass, Users, Sigma, Wallet, Calendar as CalendarIcon, ShoppingCart } from 'lucide-react';
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

  const performanceData = useMemo(() => {
    if (!staff || !appointments || !services) return [];
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return staff.map(staffMember => {
      const staffAppointments = appointments.filter(
        apt => {
            if (apt.staffId !== staffMember.id || apt.status !== 'completed') return false;
            const appointmentDate = parseISO(apt.startTime);
            if(fromDate && appointmentDate < fromDate) return false;
            if(toDate && appointmentDate > toDate) return false;
            return true;
        }
      );

      let totalMinutesVariance = 0;
      let totalInServiceMinutes = 0;
      let appointmentsWithTimeTracking = 0;

      staffAppointments.forEach(apt => {
        const service = services.find(s => s.id === apt.serviceId);
        if (apt.actualStartTime && apt.actualEndTime && service) {
          appointmentsWithTimeTracking++;
          const actualDuration = differenceInMinutes(
            parseISO(apt.actualEndTime),
            parseISO(apt.actualStartTime)
          );
          const scheduledDuration = service.duration;
          totalMinutesVariance += actualDuration - scheduledDuration;
          totalInServiceMinutes += actualDuration;
        }
      });

      const avgVariance =
        appointmentsWithTimeTracking > 0
          ? totalMinutesVariance / appointmentsWithTimeTracking
          : 0;
          
      const avgActualServiceTime =
        appointmentsWithTimeTracking > 0
          ? totalInServiceMinutes / appointmentsWithTimeTracking
          : 0;

      return {
        staffId: staffMember.id,
        staffName: staffMember.name,
        totalServices: staffAppointments.length,
        avgVariance: avgVariance,
        avgActualServiceTime: avgActualServiceTime,
        totalInServiceHours: totalInServiceMinutes / 60,
      };
    });
  }, [staff, appointments, services, dateRange]);

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

  const salonWideStats = useMemo(() => {
     if (!appointments) return { avgActualServiceTime: 0 };
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;
    
    const completedAppointments = appointments.filter(apt => {
        if (apt.status !== 'completed') return false;
        const aptDate = parseISO(apt.startTime);
        if (fromDate && aptDate < fromDate) return false;
        if (toDate && aptDate > toDate) return false;
        return true;
    });

    let totalInServiceMinutes = 0;
    let appointmentsWithTimeTracking = 0;

    completedAppointments.forEach(apt => {
        if (apt.actualStartTime && apt.actualEndTime) {
            appointmentsWithTimeTracking++;
            const actualDuration = differenceInMinutes(
                parseISO(apt.actualEndTime),
                parseISO(apt.actualStartTime)
            );
            totalInServiceMinutes += actualDuration;
        }
    });

    const avgActualServiceTime = appointmentsWithTimeTracking > 0
        ? totalInServiceMinutes / appointmentsWithTimeTracking
        : 0;

    return { avgActualServiceTime };
  }, [appointments, dateRange]);

  const payrollData = useMemo(() => {
    if (!staff || !transactions || !appointments || !activityLogs || !services) return [];

    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return staff.map(member => {
        const staffTransactions = transactions.filter(t => {
            if (t.staffId !== member.id) return false;
            const transactionDate = parseISO(t.date);
            if (fromDate && transactionDate < fromDate) return false;
            if (toDate && transactionDate > toDate) return false;
            return true;
        });

        const serviceRevenue = staffTransactions
            .filter(t => t.category === 'Service Revenue')
            .reduce((acc, t) => acc + t.amount, 0);

        const retailSales = staffTransactions
            .filter(t => t.category === 'Retail')
            .reduce((acc, t) => acc + t.amount, 0);

        const tips = staffTransactions.reduce((acc, t) => acc + (t.tipAmount || 0), 0);
        
        let wages = 0;
        let totalMinutesWorked = 0;

        if (member.payStructure === 'commission') {
            wages = serviceRevenue * ((member.commissionRate || 0) / 100);
        } else if (member.payStructure === 'hourly' && member.hourlyRate) {
            const staffLogs = activityLogs.filter(log => {
                if (log.staffId !== member.id) return false;
                const logDate = parseISO(log.timestamp);
                if (fromDate && logDate < fromDate) return false;
                if (toDate && logDate > toDate) return false;
                return true;
            });

            const sortedLogs = staffLogs.sort((a,b) => parseISO(a.timestamp).getTime() - parseISO(b.timestamp).getTime());

            let clockInTime: Date | null = null;
            let totalBreakMinutes = 0;
            
            for (const log of sortedLogs) {
                const logTime = parseISO(log.timestamp);
                if (log.type === 'clock_in') {
                    if (clockInTime) { // If there's an open session, close it first (should not happen in clean data)
                       totalMinutesWorked += Math.max(0, differenceInMinutes(logTime, clockInTime) - totalBreakMinutes);
                    }
                    clockInTime = logTime;
                    totalBreakMinutes = 0;
                } else if (log.type === 'clock_out' && clockInTime) {
                    let sessionEnd = logTime;
                    if (toDate && sessionEnd > toDate) sessionEnd = toDate;
                    totalMinutesWorked += Math.max(0, differenceInMinutes(sessionEnd, clockInTime) - totalBreakMinutes);
                    clockInTime = null;
                } else if (log.type === 'break_start') {
                    // Handled by duration on break_end
                } else if (log.type === 'break_end' && log.durationMinutes) {
                    totalBreakMinutes += log.durationMinutes;
                }
            }
             if(clockInTime && (!toDate || clockInTime < toDate)) { // If still clocked in at the end of the range
                const endOfRange = toDate && toDate < new Date() ? toDate : new Date();
                const sessionEnd = endOfRange > clockInTime ? endOfRange : clockInTime;
                totalMinutesWorked += Math.max(0, differenceInMinutes(sessionEnd, clockInTime) - totalBreakMinutes);
             }

            wages = (totalMinutesWorked / 60) * member.hourlyRate;
        }

        const retailCommission = retailSales * ((member.retailCommissionRate || 0) / 100);

        const totalPay = wages + tips + retailCommission;

        return {
            ...member,
            serviceRevenue,
            retailSales,
            retailCommission,
            tips,
            wages,
            totalPay,
            totalHours: totalMinutesWorked / 60,
        };
    });
  }, [staff, transactions, dateRange, appointments, activityLogs, services]);
  
  const payrollTotals = useMemo(() => {
    return payrollData.reduce((acc, staff) => {
        acc.totalWages += staff.wages;
        acc.totalTips += staff.tips;
        acc.totalRetailCommission += staff.retailCommission;
        acc.totalPayroll += staff.totalPay;
        return acc;
    }, { totalWages: 0, totalTips: 0, totalRetailCommission: 0, totalPayroll: 0 });
  }, [payrollData]);

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
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg. Wait Time</CardTitle>
                <Hourglass className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                <div className="text-2xl font-bold">{waitTimeData.avgWaitTime.toFixed(1)} min</div>
                <p className="text-xs text-muted-foreground">Average for all walk-ins</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg. Service Time</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                <div className="text-2xl font-bold">{salonWideStats.avgActualServiceTime.toFixed(1)} min</div>
                <p className="text-xs text-muted-foreground">For all completed services</p>
                </CardContent>
            </Card>
             <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Services Today</CardTitle>
                <Sigma className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                <div className="text-2xl font-bold">{appointments.filter(a => a.status === 'completed').length}</div>
                <p className="text-xs text-muted-foreground">Completed appointments</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Walk-ins Today</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                <div className="text-2xl font-bold">{walkIns.length}</div>
                <p className="text-xs text-muted-foreground">Customers in queue today</p>
                </CardContent>
            </Card>
        </div>

        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Wallet /> Payroll Report</CardTitle>
                <CardDescription>A summary of staff earnings for the selected period.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Staff Member</TableHead>
                            <TableHead>Pay Structure</TableHead>
                            <TableHead className="text-right">Service Rev.</TableHead>
                            <TableHead className="text-right">Retail Sales</TableHead>
                            <TableHead className="text-right">Hours</TableHead>
                            <TableHead className="text-right">Wages</TableHead>
                            <TableHead className="text-right">Retail Comm.</TableHead>
                            <TableHead className="text-right">Tips</TableHead>
                            <TableHead className="text-right font-bold">Total Pay</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {payrollData.map(data => (
                            <TableRow key={data.id}>
                                <TableCell className="font-medium">{data.name}</TableCell>
                                <TableCell><Badge variant="outline" className="capitalize">{data.payStructure}</Badge></TableCell>
                                <TableCell className="text-right font-mono">${data.serviceRevenue.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono">${data.retailSales.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono">{data.payStructure === 'hourly' ? `${data.totalHours.toFixed(2)}h` : 'N/A'}</TableCell>
                                <TableCell className="text-right font-mono">${data.wages.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono text-blue-500">${data.retailCommission.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono text-green-500">${data.tips.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono font-bold text-primary">${data.totalPay.toFixed(2)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                    <TableFooter>
                        <TableRow className="font-bold">
                            <TableCell colSpan={5}>Total Payroll Cost</TableCell>
                            <TableCell className="text-right font-mono">${payrollTotals.totalWages.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-blue-500">${payrollTotals.totalRetailCommission.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-green-500">${payrollTotals.totalTips.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-primary">${payrollTotals.totalPayroll.toFixed(2)}</TableCell>
                        </TableRow>
                    </TableFooter>
                </Table>
            </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle>Staff Performance</CardTitle>
              <CardDescription>
                Analysis of service duration vs. scheduled time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff Member</TableHead>
                    <TableHead className="text-right">Total Services</TableHead>
                    <TableHead className="text-right">Avg. Actual Time</TableHead>
                    <TableHead className="text-right">Avg. Time Variance</TableHead>
                    <TableHead className="text-right">Total In-Service</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performanceData.map(data => (
                    <TableRow key={data.staffId}>
                      <TableCell className="font-medium">{data.staffName}</TableCell>
                      <TableCell className="text-right">{data.totalServices}</TableCell>
                      <TableCell className="text-right">{data.avgActualServiceTime.toFixed(1)} min</TableCell>
                      <TableCell className={`text-right font-medium ${data.avgVariance > 0 ? 'text-destructive' : 'text-green-500'}`}>
                        {data.avgVariance > 0 ? '+' : ''}{data.avgVariance.toFixed(1)} min
                      </TableCell>
                       <TableCell className="text-right">{data.totalInServiceHours.toFixed(1)} hrs</TableCell>
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
