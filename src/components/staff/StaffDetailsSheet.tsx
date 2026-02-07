
'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { type Staff, type Transaction, type Service, type Appointment, type ActivityLog, type ConsentForm } from '@/lib/data';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, differenceInMinutes, parseISO, subDays, startOfDay, endOfDay, differenceInDays } from 'date-fns';
import { TrendingUp, DollarSign, PackageX, Clock, Info, Briefcase, User, MessageSquare, Coffee, Hourglass, BarChart, Percent, Users, List, FileText, Shield, Search, Calendar as CalendarIcon, Printer, ShieldAlert } from 'lucide-react';
import { Button, buttonVariants } from '../ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DateRange } from 'react-day-picker';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { PrintableStaffReport } from './PrintableStaffReport';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

interface StaffDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffMember: (Staff & { stats: any }) | null;
  dateRange: DateRange | undefined;
  transactions: Transaction[];
  services: Service[];
  appointments: Appointment[];
  activityLogs: ActivityLog[];
  consentForms: ConsentForm[];
}

const ActivityLogCard = ({ log }: { log: ActivityLog }) => (
    <Card className="bg-background">
        <CardContent className="p-3">
             <div className="flex justify-between items-start gap-2">
                <div className="flex-1 space-y-1">
                    <p className="font-medium text-sm leading-tight capitalize flex items-center gap-2">
                        {log.type === 'clock_in' && <Clock className="w-4 h-4 text-green-500" />}
                        {log.type === 'clock_out' && <Clock className="w-4 h-4 text-red-500" />}
                        {log.type === 'break_start' && <Coffee className="w-4 h-4 text-yellow-500" />}
                        {log.type === 'break_end' && <Coffee className="w-4 h-4 text-gray-500" />}
                        {log.type.replace('_', ' ')}
                    </p>
                    <p className="text-xs text-muted-foreground">{format(log.timestamp, 'PPP p')}</p>
                </div>
                {log.durationMinutes && (
                    <div className="text-right flex-shrink-0">
                        <p className="font-semibold text-sm">{log.durationMinutes} min</p>
                        <p className="text-xs text-muted-foreground">Duration</p>
                    </div>
                )}
            </div>
        </CardContent>
    </Card>
);

const TransactionCard = ({ transaction, service, timeVariance }: { transaction: Transaction, service?: Service, timeVariance: number | null }) => (
    <Card className="bg-background">
        <CardContent className="p-3">
            <div className="flex justify-between items-start gap-2">
                <div className="flex-1 space-y-1">
                    <p className="font-medium text-sm leading-tight">{transaction.description}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(transaction.date), 'MMM d, yyyy h:mm a')}</p>
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
                 <Badge variant={transaction.category === 'Tips' ? 'secondary' : 'outline'} className={transaction.category === 'Tips' ? 'bg-green-100 text-green-800' : ''}>{transaction.category}</Badge>
                 {service && <p className="truncate">{service.name}</p>}
            </div>
        </CardContent>
    </Card>
);

export const StaffDetailsSheet: React.FC<StaffDetailsSheetProps> = ({
  open,
  onOpenChange,
  staffMember,
  dateRange: initialDateRange,
  transactions,
  services,
  appointments,
  activityLogs,
  consentForms,
}) => {
  const isMobile = useIsMobile();
  const [activitySearch, setActivitySearch] = useState('');
  const [transactionSearch, setTransactionSearch] = useState('');
  const reportRef = useRef<HTMLDivElement>(null);
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>(initialDateRange);
  
  const staffServices = useMemo(() => {
    if (!staffMember?.services || !services) return [];
    const staffSkillLevel = staffMember.skillLevel || 'senior';
    return services
      .filter(s => staffMember.services?.includes(s.id))
      .map(service => {
        const tierPrice = service.pricingTiers?.find(t => t.level === staffSkillLevel)?.price;
        const finalPrice = tierPrice ?? service.pricingTiers?.find(t => t.level === 'senior')?.price ?? service.price;
        return {
          ...service,
          price: finalPrice,
        };
      });
  }, [staffMember, services]);

  useEffect(() => {
    setDateRange(initialDateRange);
  }, [initialDateRange]);

  const filteredActivityLogs = useMemo(() => {
    if (!activityLogs || !staffMember) return [];
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return activityLogs
      .filter(log => {
        if (log.staffId !== staffMember.id) return false;
        const logDate = log.timestamp;
        if (fromDate && logDate < fromDate) return false;
        if (toDate && logDate > toDate) return false;
        if (activitySearch.trim() && !log.type.toLowerCase().includes(activitySearch.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [activityLogs, staffMember, activitySearch, dateRange]);
  
  const filteredTransactions = useMemo(() => {
    if (!transactions || !staffMember) return [];
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;
    
    return transactions.filter(t => {
      if(t.staffId !== staffMember.id) return false;
      const transactionDate = t.date;
      if (fromDate && transactionDate < fromDate) return false;
      if (toDate && transactionDate > toDate) return false;
      if (transactionSearch.trim() && !(t.description.toLowerCase().includes(transactionSearch.toLowerCase()) || t.category.toLowerCase().includes(transactionSearch.toLowerCase()))) return false;
      return true;
    }).sort((a,b) => b.date.getTime() - a.date.getTime());
  }, [transactions, staffMember, transactionSearch, dateRange]);
    
  const dateRangeString = dateRange?.from && dateRange.to
    ? `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d')}`
    : 'the selected period';
    
  const handlePrint = () => {
    window.print();
  }

  if (!staffMember) {
    return null;
  }
  
  const performanceKpis = [
      { label: "Utilization Rate", value: `${staffMember.stats.utilizationRate.toFixed(1)}%` },
      { label: "Avg. Ticket Size", value: `$${staffMember.stats.avgSalePerAppointment.toFixed(2)}` },
      { label: "Retail Attach Rate", value: `${staffMember.stats.retailAttachmentRate.toFixed(1)}%` },
      { label: "Avg Time Variance", value: `${staffMember.stats.avgVariance > 0 ? '+' : ''}${staffMember.stats.avgVariance.toFixed(1)} min` },
  ];

  const content = (
      <div className="p-4 space-y-6">
            <div className="grid grid-cols-2 gap-4">
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Sales</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">${staffMember.stats.totalSales.toFixed(2)}</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Tips Earned</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">${staffMember.stats.tips.toFixed(2)}</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Hours Worked</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{staffMember.stats.totalHours?.toFixed(1) ?? 'N/A'}</p></CardContent></Card>
                <Card className="bg-primary/5 border-primary/20"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-primary">Take-home</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-primary">${staffMember.stats.earnings.toFixed(2)}</p></CardContent></Card>
            </div>
             <Tabs defaultValue="activity" className="w-full">
                <ScrollArea>
                    <TabsList>
                        <TabsTrigger value="activity">Activity Log</TabsTrigger>
                        <TabsTrigger value="transactions">Transactions</TabsTrigger>
                        <TabsTrigger value="effectiveness">Effectiveness</TabsTrigger>
                        <TabsTrigger value="profile">Profile</TabsTrigger>
                    </TabsList>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
                <TabsContent value="activity" className="mt-4">
                    <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search activities..." className="pl-9" value={activitySearch} onChange={(e) => setActivitySearch(e.target.value)} />
                    </div>
                    <div className="space-y-3">
                        {filteredActivityLogs.length > 0 ? (filteredActivityLogs.map(log => <ActivityLogCard key={log.id} log={log} />)) : (<p className="text-center text-sm text-muted-foreground pt-10">No activity found.</p>)}
                    </div>
                </TabsContent>
                <TabsContent value="transactions" className="mt-4">
                    <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search transactions..." className="pl-9" value={transactionSearch} onChange={(e) => setTransactionSearch(e.target.value)} />
                    </div>
                    <div className="space-y-3">
                        {filteredTransactions.length > 0 ? (
                            filteredTransactions.map(t => {
                                const appointment = appointments.find(apt => apt.id === t.appointmentId);
                                const service = services.find(s => s.id === appointment?.serviceId);
                                let timeVariance = null;
                                if (appointment && service && appointment.actualStartTime && appointment.actualEndTime) {
                                    const actualDuration = differenceInMinutes(appointment.actualEndTime, appointment.actualStartTime);
                                    timeVariance = actualDuration - service.duration;
                                }
                                return <TransactionCard key={t.id} transaction={t} service={service} timeVariance={timeVariance} />
                            })
                        ) : (<div className="text-center h-24 py-10 text-muted-foreground">No transactions found.</div>)}
                    </div>
                </TabsContent>
                <TabsContent value="effectiveness" className="mt-4">
                    <Card><CardContent className="p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                           {performanceKpis.map(kpi => (
                               <div key={kpi.label} className="p-3 rounded-lg bg-muted/50">
                                   <div className="text-sm font-medium text-muted-foreground">{kpi.label}</div>
                                   <div className={cn("text-2xl font-bold", kpi.label === "Avg Time Variance" && (parseFloat(kpi.value) > 0 ? 'text-destructive' : 'text-green-500'))}>{kpi.value}</div>
                               </div>
                           ))}
                        </div>
                    </CardContent></Card>
                 </TabsContent>
                 <TabsContent value="profile" className="mt-4 space-y-4">
                    <Card><CardHeader><CardTitle className="text-base">Contact & Emergency</CardTitle></CardHeader><CardContent className="text-sm space-y-2"><p><strong>Email:</strong> {staffMember.email}</p><p><strong>Phone:</strong> {staffMember.phone}</p>{staffMember.emergencyContact?.name && (<div className="pt-2 border-t"><p><strong>Emergency:</strong> {staffMember.emergencyContact.name} ({staffMember.emergencyContact.relationship})</p><p className="pl-4">{staffMember.emergencyContact.phone}</p></div>)}</CardContent></Card>
                    <Card><CardHeader><CardTitle className="text-base">Compliance</CardTitle></CardHeader><CardContent className="text-sm space-y-2"><p><strong>License #:</strong> {staffMember.compliance?.licenseNumber || 'N/A'}</p><p><strong>Expires:</strong> {staffMember.compliance?.licenseExpiry ? format(parseISO(staffMember.compliance.licenseExpiry), 'PPP') : 'N/A'}</p><div className="space-y-2 pt-2"><h4 className="font-medium">Documents</h4>{(staffMember.documents || []).length > 0 ? staffMember.documents?.map(doc => (<div key={doc.id}><a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{doc.name}</a></div>)) : <p className="text-muted-foreground text-xs">No documents uploaded.</p>}</div><div className="space-y-2 pt-2"><h4 className="font-medium">Assigned Forms</h4>{(staffMember.assignedFormIds || []).length > 0 ? (staffMember.assignedFormIds || []).map(formId => {const form = consentForms.find(f => f.id === formId); return <div key={formId}><p>{form?.title || 'Unknown Form'}</p></div>;}) : <p className="text-muted-foreground text-xs">No forms assigned.</p>}</div></CardContent></Card>
                    <Card><CardHeader><CardTitle className="text-base">Services Offered</CardTitle></CardHeader><CardContent className="text-sm space-y-2">{staffServices.map(s => (<div key={s.id} className="flex justify-between"><span>{s.name}</span><span className="font-semibold">${s.price.toFixed(2)}</span></div>))}</CardContent></Card>
                 </TabsContent>
            </Tabs>
        </div>
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side={isMobile ? 'bottom' : 'right'} className={cn("p-0 flex flex-col", isMobile ? "h-[90vh]" : "sm:max-w-2xl")}>
          <SheetHeader className="p-4 border-b text-left">
            <SheetTitle>Dashboard: {staffMember.name}</SheetTitle>
            <SheetDescription>
              Performance breakdown for {dateRangeString}.
            </SheetDescription>
          </SheetHeader>
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <Popover>
              <PopoverTrigger asChild>
                <Button id="date" variant={"outline"} size="sm" className={cn("w-[240px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (dateRange.to ? (<>{format(dateRange.from, "LLL dd, yyyy")} - {format(dateRange.to, "LLL dd, yyyy")}</>) : (format(dateRange.from, "LLL dd, yyyy"))) : (<span>Pick a date range</span>)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {content}
          </div>
          <SheetFooter className="p-4 border-t bg-background">
            <Button variant="outline" className="w-full" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print Report
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <div className="hidden print:block">
        <PrintableStaffReport ref={reportRef} staffMember={staffMember} dateRange={dateRange} activityLogs={filteredActivityLogs} transactions={filteredTransactions} services={services} appointments={appointments} />
      </div>
    </>
  );
};
