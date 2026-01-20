'use client';

import React, { useMemo } from 'react';
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
} from '@/components/ui/table';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartConfig,
} from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { useInventory } from '@/context/InventoryContext';
import { differenceInMinutes, format, getHours, parseISO } from 'date-fns';
import { Clock, BarChart as BarChartIcon, Hourglass, Users, Sigma } from 'lucide-react';
import { ClientOnly } from '@/components/shared/ClientOnly';

const chartConfig = {
  waitTime: {
    label: 'Wait Time (min)',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig;

export default function ReportsPage() {
  const { appointments, services, staff, walkIns } = useInventory();

  const performanceData = useMemo(() => {
    return staff.map(staffMember => {
      const staffAppointments = appointments.filter(
        apt => apt.staffId === staffMember.id && apt.status === 'completed'
      );

      let totalMinutesVariance = 0;
      let totalInServiceMinutes = 0;

      staffAppointments.forEach(apt => {
        const service = services.find(s => s.id === apt.serviceId);
        if (apt.actualStartTime && apt.actualEndTime && service) {
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
        staffAppointments.length > 0
          ? totalMinutesVariance / staffAppointments.length
          : 0;

      return {
        staffId: staffMember.id,
        staffName: staffMember.name,
        totalServices: staffAppointments.length,
        avgVariance: avgVariance,
        totalInServiceHours: totalInServiceMinutes / 60,
      };
    });
  }, [staff, appointments, services]);

  const waitTimeData = useMemo(() => {
    const completedWalkIns = walkIns.filter(
      w => w.status === 'completed' && w.serviceStartTime
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
    
    const avgWaitTime = completedWalkIns.length > 0 ? (chartData.reduce((acc, d) => acc + d.waitTime * (hourlyWaitTimes[parseInt(d.hour)].count), 0) / completedWalkIns.length) : 0;
    
    return { chartData, avgWaitTime };

  }, [walkIns]);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Reports & Analytics" />
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">
            Insights into your salon's performance and efficiency.
          </p>
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
                    <TableHead className="text-right">Avg. Time Variance</TableHead>
                    <TableHead className="text-right">Total In-Service</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performanceData.map(data => (
                    <TableRow key={data.staffId}>
                      <TableCell className="font-medium">{data.staffName}</TableCell>
                      <TableCell className="text-right">{data.totalServices}</TableCell>
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
