

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
import { type Staff, type Transaction, type Service, type Appointment } from '@/lib/data';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, differenceInMinutes, parseISO } from 'date-fns';
import { TrendingUp, DollarSign, PackageX, Clock } from 'lucide-react';
import { Button } from '../ui/button';

interface StaffDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffMember: (Staff & { stats: any }) | null;
  transactions: Transaction[];
  services: Service[];
  appointments: Appointment[];
}

export const StaffDetailsSheet: React.FC<StaffDetailsSheetProps> = ({
  open,
  onOpenChange,
  staffMember,
  transactions,
  services,
  appointments,
}) => {
  if (!staffMember) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="p-6">
          <SheetTitle>Activity for {staffMember.name}</SheetTitle>
          <SheetDescription>
            A detailed breakdown of sales, tips, and service performance for the selected period.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
            <div className="p-6 pt-0 space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Performance Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <div className="text-sm font-medium text-muted-foreground">Total Sales</div>
                            <div className="text-2xl font-bold">${staffMember.stats.totalSales.toFixed(2)}</div>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <div className="text-sm font-medium text-muted-foreground">Tips Earned</div>
                            <div className="text-2xl font-bold">${staffMember.stats.tips.toFixed(2)}</div>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <div className="text-sm font-medium text-muted-foreground">Product Consumption</div>
                            <div className="text-2xl font-bold">${staffMember.stats.consumptionValue.toFixed(2)}</div>
                        </div>
                        <div className="p-3 bg-primary/10 rounded-lg">
                            <div className="text-sm font-medium text-primary">Est. Take-home</div>
                            <div className="text-2xl font-bold text-primary">${staffMember.stats.earnings.toFixed(2)}</div>
                        </div>
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
                                        const actualDuration = differenceInMinutes(parseISO(appointment.actualEndTime), parseISO(appointment.actualStartTime));
                                        timeVariance = actualDuration - service.duration;
                                    }

                                    return (
                                    <Card key={t.id}>
                                        <CardContent className="p-3">
                                            <div className="flex justify-between items-start">
                                                <div className="space-y-1">
                                                    <p className="font-medium">{t.description}</p>
                                                    <p className="text-xs text-muted-foreground">{format(new Date(t.date), 'MMM d, yyyy h:mm a')}</p>
                                                    {timeVariance !== null && (
                                                        <p className={`text-xs font-semibold ${timeVariance > 0 ? 'text-destructive' : 'text-green-500'}`}>
                                                            Time Variance: {timeVariance > 0 ? '+' : ''}{timeVariance} min
                                                        </p>
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
                                    <TableHead className="text-right">Time Variance</TableHead>
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
                                            const actualDuration = differenceInMinutes(parseISO(appointment.actualEndTime), parseISO(appointment.actualStartTime));
                                            timeVariance = actualDuration - service.duration;
                                        }

                                        return (
                                        <TableRow key={t.id}>
                                        <TableCell>{format(new Date(t.date), 'MMM d, yyyy h:mm a')}</TableCell>
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
