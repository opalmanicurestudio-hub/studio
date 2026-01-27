
'use client';

import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Staff, type Transaction, type Service, type Appointment, type ActivityLog } from '@/lib/data';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, differenceInMinutes, parseISO } from 'date-fns';
import { TrendingUp, DollarSign, PackageX, Clock, Info, Briefcase, User, MessageSquare, Coffee, Hourglass, BarChart, Percent, Users } from 'lucide-react';
import { Button } from '../ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DateRange } from 'react-day-picker';

interface StaffDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffMember: (Staff & { stats: any }) | null;
  dateRange: DateRange | undefined;
  transactions: Transaction[];
  services: Service[];
  appointments: Appointment[];
  activityLogs: ActivityLog[];
}

export const StaffDetailsSheet: React.FC<StaffDetailsSheetProps> = ({
  open,
  onOpenChange,
  staffMember,
  dateRange,
  transactions,
  services,
  appointments,
  activityLogs,
}) => {
  if (!staffMember) return null;

  const dateRangeString = dateRange?.from && dateRange.to 
    ? `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d')}` 
    : 'the selected period';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="p-6">
          <SheetTitle>Activity for {staffMember.name}</SheetTitle>
          <SheetDescription>
            A detailed breakdown for {dateRangeString}.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
            <div className="p-6 pt-0 space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Performance Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 md:grid-cols-2 gap-4">
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <div className="text-sm font-medium text-muted-foreground">Total Sales</div>
                            <div className="text-2xl font-bold">${staffMember.stats.totalSales.toFixed(2)}</div>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <div className="text-sm font-medium text-muted-foreground">Tips Earned</div>
                            <div className="text-2xl font-bold">${staffMember.stats.tips.toFixed(2)}</div>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <div className="text-sm font-medium text-muted-foreground">Hours Worked</div>
                            <div className="text-2xl font-bold">{staffMember.stats.totalHours?.toFixed(1) ?? 'N/A'}</div>
                        </div>
                        <div className="p-3 bg-primary/10 rounded-lg">
                            <div className="text-sm font-medium text-primary">Est. Take-home</div>
                            <div className="text-2xl font-bold text-primary">${staffMember.stats.earnings.toFixed(2)}</div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Effectiveness</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Percent className="w-4 h-4"/>Utilization Rate</div>
                            <div className="text-2xl font-bold">{staffMember.stats.utilizationRate.toFixed(1)}%</div>
                        </div>
                         <div className="p-3 bg-muted/50 rounded-lg">
                            <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><DollarSign className="w-4 h-4"/>Avg. Sale / Appt</div>
                            <div className="text-2xl font-bold">${staffMember.stats.avgSalePerAppointment.toFixed(2)}</div>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg col-span-2">
                             <div className="text-sm font-medium text-muted-foreground mb-2">Revenue Breakdown</div>
                             <div className="space-y-1 text-sm">
                                <div className="flex justify-between"><span>Services:</span> <span className="font-semibold">${staffMember.stats.serviceRevenue.toFixed(2)}</span></div>
                                <div className="flex justify-between"><span>Retail:</span> <span className="font-semibold">${staffMember.stats.retailSales.toFixed(2)}</span></div>
                             </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Activity Log</CardTitle>
                    </CardHeader>
                    <CardContent>
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
                                    <TableRow><TableCell colSpan={3} className="text-center h-24">No activity logged in this period.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Transaction History</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {/* Mobile view */}
                        <div className="space-y-3 md:hidden">
                            {transactions.length > 0 ? (
                                transactions.map(t => {
                                    const appointment = t.appointmentId ? appointments.find(a => a.id === t.appointmentId) : undefined;
                                    const service = appointment ? services.find(s => s.id === appointment.serviceId) : undefined;
                                    let timeVariance: number | null = null;
                                    if (appointment && service && appointment.actualStartTime && appointment.actualEndTime) {
                                        const actualDuration = differenceInMinutes(appointment.actualEndTime, appointment.actualStartTime);
                                        timeVariance = actualDuration - service.duration;
                                    }

                                    return (
                                    <Card key={t.id}>
                                        <CardContent className="p-3">
                                            <div className="flex justify-between items-start">
                                                <div className="space-y-1">
                                                    <p className="font-medium">{t.description}</p>
                                                    <p className="text-xs text-muted-foreground">{format(t.date, 'MMM d, yyyy h:mm a')}</p>
                                                     {timeVariance !== null && (
                                                        <div>
                                                            <p className={`text-sm font-semibold ${timeVariance > 0 ? 'text-destructive' : 'text-green-500'}`}>
                                                                Time Variance: {timeVariance > 0 ? '+' : ''}{timeVariance} min
                                                            </p>
                                                            <p className="text-xs text-muted-foreground">(Actual vs. Scheduled)</p>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-mono font-semibold flex items-center justify-end gap-1">
                                                        {t.type === 'income' ? (
                                                            <TrendingUp className="h-4 w-4 text-green-500" />
                                                        ) : (
                                                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                                                        )}
                                                        ${t.amount.toFixed(2)}
                                                    </p>
                                                    <Badge
                                                        variant={t.category === 'Tips' ? 'secondary' : 'outline'}
                                                        className={`mt-1 text-xs ${t.category === 'Tips' ? 'bg-green-100 dark:bg-green-900/50 text-green-800' : ''}`}
                                                    >
                                                        {t.category}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )})
                            ) : (
                                <p className="text-center text-muted-foreground py-10">No transactions in this period.</p>
                            )}
                        </div>

                        {/* Desktop view */}
                        <div className="hidden md:block">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            Time Variance
                                            <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-4 w-4 rounded-full cursor-help"><Info className="h-3 w-3 text-muted-foreground" /></Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                <p>Actual time vs. scheduled duration.</p>
                                                <p>Captured from 'Start' to 'Finish' in the Planner.</p>
                                                </TooltipContent>
                                            </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {transactions.length > 0 ? (
                                    transactions.map(t => {
                                        const appointment = t.appointmentId ? appointments.find(a => a.id === t.appointmentId) : undefined;
                                        const service = appointment ? services.find(s => s.id === appointment.serviceId) : undefined;
                                        let timeVariance: number | null = null;
                                        if (appointment && service && appointment.actualStartTime && appointment.actualEndTime) {
                                            const actualDuration = differenceInMinutes(appointment.actualEndTime, appointment.actualStartTime);
                                            timeVariance = actualDuration - service.duration;
                                        }

                                        return (
                                        <TableRow key={t.id}>
                                        <TableCell>{format(t.date, 'MMM d, yyyy h:mm a')}</TableCell>
                                        <TableCell>{t.description}</TableCell>
                                        <TableCell>
                                            <Badge
                                            variant={t.category === 'Tips' ? 'secondary' : 'outline'}
                                            className={
                                                t.category === 'Tips' ? 'bg-green-100 dark:bg-green-900/50 text-green-800' : ''
                                            }
                                            >
                                            {t.category}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {timeVariance !== null ? (
                                                <span className={timeVariance > 0 ? 'text-destructive' : 'text-green-500'}>
                                                    {timeVariance > 0 ? '+' : ''}{timeVariance} min
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            <div className='flex items-center justify-end gap-1'>
                                                {t.type === 'income' ? (
                                                <TrendingUp className="h-4 w-4 text-green-500" />
                                                ) : (
                                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                                                )}
                                                ${t.amount.toFixed(2)}
                                            </div>
                                        </TableCell>
                                        </TableRow>
                                    )})
                                    ) : (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center h-24">
                                        No transactions in this period.
                                        </TableCell>
                                    </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </ScrollArea>
        <SheetFooter className="p-6 border-t">
            <Button onClick={() => onOpenChange(false)}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
