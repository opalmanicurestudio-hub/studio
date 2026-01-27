
'use client';

import React, { useMemo, useState, useRef } from 'react';
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
import { format, differenceInMinutes, parseISO, subDays, startOfDay, endOfDay } from 'date-fns';
import { TrendingUp, DollarSign, PackageX, Clock, Info, Briefcase, User, MessageSquare, Coffee, Hourglass, BarChart, Percent, Users, List, FileText, Shield, Search, Calendar as CalendarIcon, Printer } from 'lucide-react';
import { Button, buttonVariants } from '../ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DateRange } from 'react-day-picker';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { PrintableStaffReport } from './PrintableStaffReport';

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

const TransactionCard = ({ transaction, service, timeVariance }: { transaction: Transaction, service?: Service, timeVariance: number | null }) => (
    <Card className="bg-background">
        <CardContent className="p-3">
            <div className="flex justify-between items-start gap-2">
                <div className="flex-1 space-y-1">
                    <p className="font-medium text-sm leading-tight">{transaction.description}</p>
                    <p className="text-xs text-muted-foreground">{format(transaction.date, 'MMM d, yyyy')}</p>
                </div>
                <div className="text-right flex-shrink-0">
                    <p className={cn('font-mono font-semibold', transaction.type === 'income' ? 'text-green-500' : 'text-red-500')}>
                        {transaction.type === 'income' ? '+' : '-'}${transaction.amount.toFixed(2)}
                    </p>
                    {timeVariance !== null && (
                        <p className={cn('text-xs font-mono', timeVariance > 0 ? 'text-destructive' : 'text-green-500')}>
                            {timeVariance > 0 ? '+' : ''}{timeVariance} min
                        </p>
                    )}
                </div>
            </div>
            <div className="flex items-center flex-wrap gap-2 mt-2 pt-2 border-t text-xs text-muted-foreground">
                 <Badge variant={transaction.category === 'Tips' ? 'secondary' : 'outline'} className={transaction.category === 'Tips' ? 'bg-green-100 dark:bg-green-900/50 text-green-800' : ''}>{transaction.category}</Badge>
                 {service && <p className="truncate">{service.name}</p>}
            </div>
        </CardContent>
    </Card>
);

export const StaffDetailsSheet: React.FC<StaffDetailsSheetProps> = ({
  open,
  onOpenChange,
  staffMember,
  transactions,
  services,
  appointments,
  activityLogs,
}) => {
  const isMobile = useIsMobile();
  const [activitySearch, setActivitySearch] = useState('');
  const [transactionSearch, setTransactionSearch] = useState('');
  const reportRef = useRef<HTMLDivElement>(null);
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });

  const filteredActivityLogs = useMemo(() => {
    if (!activityLogs) return [];
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return activityLogs.filter(log => {
      const logDate = log.timestamp;
      if (fromDate && logDate < fromDate) return false;
      if (toDate && logDate > toDate) return false;
      if (activitySearch.trim() && !log.type.toLowerCase().includes(activitySearch.toLowerCase())) return false;
      return true;
    });
  }, [activityLogs, activitySearch, dateRange]);
  
  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;
    
    return transactions.filter(t => {
      const transactionDate = t.date;
      if (fromDate && transactionDate < fromDate) return false;
      if (toDate && transactionDate > toDate) return false;
      if (transactionSearch.trim() && !(t.description.toLowerCase().includes(transactionSearch.toLowerCase()) || t.category.toLowerCase().includes(transactionSearch.toLowerCase()))) return false;
      return true;
    });
  }, [transactions, transactionSearch, dateRange]);


  if (!staffMember) return null;

  const staffServices = services.filter(s => staffMember.services?.includes(s.id));

  const dateRangeString = dateRange?.from && dateRange.to
    ? `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d')}`
    : 'the selected period';
    
  const handlePrint = () => {
    window.print();
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="p-6">
          <SheetTitle>Activity for {staffMember.name}</SheetTitle>
          <SheetDescription>
            A detailed breakdown for {dateRangeString}.
          </SheetDescription>
        </SheetHeader>
        <div className="flex items-center justify-between px-6 pb-4 border-b">
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                        "w-[260px] justify-start text-left font-normal",
                        !dateRange && "text-muted-foreground"
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateRange?.from ? (
                        dateRange.to ? (
                            <>
                            {format(dateRange.from, "LLL dd, y")} -{" "}
                            {format(dateRange.to, "LLL dd, y")}
                            </>
                        ) : (
                            format(dateRange.from, "LLL dd, y")
                        )
                        ) : (
                        <span>Pick a date range</span>
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={dateRange?.from}
                        selected={dateRange}
                        onSelect={setDateRange}
                        numberOfMonths={2}
                    />
                </PopoverContent>
            </Popover>
             <Button variant="outline" onClick={handlePrint}><Printer className="mr-2 h-4 w-4" />Print</Button>
        </div>
        <ScrollArea className="flex-1">
            <div className="px-6 pb-6 space-y-6">
                <Accordion type="multiple" defaultValue={['summary', 'details']} className="w-full space-y-4">
                    <AccordionItem value="summary" className="border rounded-lg">
                        <AccordionTrigger className="p-4 font-semibold">Performance Summary</AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
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
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                    
                    <AccordionItem value="effectiveness" className="border rounded-lg">
                        <AccordionTrigger className="p-4 font-semibold">Effectiveness</AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                             <div className="grid grid-cols-2 gap-4">
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
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                     <AccordionItem value="details" className="border rounded-lg">
                        <AccordionTrigger className="p-4 font-semibold">Internal Details</AccordionTrigger>
                        <AccordionContent className="p-4 pt-0 text-sm space-y-4">
                           <div className="space-y-1">
                             <h4 className="font-medium text-xs text-muted-foreground">Contact</h4>
                             <p>{staffMember.email}</p>
                             <p>{staffMember.phone}</p>
                           </div>
                           <div className="space-y-1">
                             <h4 className="font-medium text-xs text-muted-foreground">Pay Structure</h4>
                             <p className="capitalize">{staffMember.payStructure}</p>
                             {staffMember.payStructure === 'commission' && (
                               <p className="text-xs">Service: {staffMember.commissionRate}% | Retail: {staffMember.retailCommissionRate}%</p>
                             )}
                             {staffMember.payStructure === 'hourly' && (
                               <p className="text-xs">${staffMember.hourlyRate}/hr</p>
                             )}
                           </div>
                            {staffMember.emergencyContact?.name && (
                                <div className="space-y-1">
                                    <h4 className="font-medium text-xs text-muted-foreground">Emergency Contact</h4>
                                    <p>{staffMember.emergencyContact.name} ({staffMember.emergencyContact.relationship})</p>
                                    <p>{staffMember.emergencyContact.phone}</p>
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>
                    
                     <AccordionItem value="services" className="border rounded-lg">
                        <AccordionTrigger className="p-4 font-semibold">Services Offered ({staffServices.length})</AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                           <div className="space-y-2 mt-2">
                               {staffServices.map(s => (
                                   <div key={s.id} className="p-2 bg-muted/50 rounded-md text-sm">{s.name}</div>
                               ))}
                           </div>
                        </AccordionContent>
                    </AccordionItem>

                     <AccordionItem value="compliance" className="border rounded-lg">
                        <AccordionTrigger className="p-4 font-semibold">Compliance</AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                           <div className="space-y-2 mt-2 text-sm">
                               <div className="flex justify-between"><span>License #:</span> <span className="font-mono">{staffMember.compliance?.licenseNumber || 'N/A'}</span></div>
                               <div className="flex justify-between"><span>Expires:</span> <span>{staffMember.compliance?.licenseExpiry ? format(parseISO(staffMember.compliance.licenseExpiry), 'PPP') : 'N/A'}</span></div>
                           </div>
                        </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="activity" className="border rounded-lg">
                        <AccordionTrigger className="p-4 font-semibold">Activity Log</AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                             <div className="relative my-4">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search activities (e.g., clock in)..."
                                    className="pl-9"
                                    value={activitySearch}
                                    onChange={(e) => setActivitySearch(e.target.value)}
                                />
                            </div>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date & Time</TableHead>
                                        <TableHead>Action</TableHead>
                                        <TableHead className="text-right">Duration</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredActivityLogs.length > 0 ? (
                                        filteredActivityLogs.map(log => (
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
                        </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="transactions" className="border rounded-lg">
                        <AccordionTrigger className="p-4 font-semibold">Transaction History</AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            <div className="relative my-4">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search by description or category..."
                                    className="pl-9"
                                    value={transactionSearch}
                                    onChange={(e) => setTransactionSearch(e.target.value)}
                                />
                            </div>
                            {isMobile ? (
                                <div className="space-y-4 pt-4">
                                    {filteredTransactions.length > 0 ? (
                                        filteredTransactions.map(t => {
                                            const appointment = t.appointmentId ? appointments.find(a => a.id === t.appointmentId) : undefined;
                                            const service = appointment ? services.find(s => s.id === appointment.serviceId) : undefined;
                                            let timeVariance: number | null = null;
                                            if (appointment && service && appointment.actualStartTime && appointment.actualEndTime) {
                                                const actualDuration = differenceInMinutes(appointment.actualEndTime, appointment.actualStartTime);
                                                timeVariance = actualDuration - service.duration;
                                            }

                                            return (
                                                <TransactionCard
                                                    key={t.id}
                                                    transaction={t}
                                                    service={service}
                                                    timeVariance={timeVariance}
                                                />
                                            );
                                        })
                                    ) : (
                                        <div className="text-center h-24 flex items-center justify-center text-muted-foreground">
                                            No transactions found.
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Time Variance</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {filteredTransactions.length > 0 ? (
                                        filteredTransactions.map(t => {
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
                                            <TableCell><Badge variant={t.category === 'Tips' ? 'secondary' : 'outline'} className={t.category === 'Tips' ? 'bg-green-100 dark:bg-green-900/50 text-green-800' : ''}>{t.category}</Badge></TableCell>
                                            <TableCell className="text-right font-mono">{timeVariance !== null ? (<span className={cn(timeVariance > 0 ? 'text-destructive' : 'text-green-500', 'text-xs')}>{timeVariance > 0 ? '+' : ''}{timeVariance} min</span>) : (<span className="text-muted-foreground">—</span>)}</TableCell>
                                            <TableCell className="text-right font-mono"><div className='flex items-center justify-end gap-1'>{t.type === 'income' ? (<TrendingUp className="h-4 w-4 text-green-500" />) : (<DollarSign className="h-4 w-4 text-muted-foreground" />)} ${t.amount.toFixed(2)}</div></TableCell>
                                            </TableRow>
                                        )})
                                        ) : (
                                        <TableRow><TableCell colSpan={5} className="text-center h-24">No transactions in this period.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            )}
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
    <div className="hidden">
      <PrintableStaffReport ref={reportRef} staffMember={staffMember} dateRange={dateRange} activityLogs={filteredActivityLogs} transactions={filteredTransactions} services={services} appointments={appointments} />
    </div>
    </>
  );
};
