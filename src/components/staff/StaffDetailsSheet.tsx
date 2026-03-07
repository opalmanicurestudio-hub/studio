'use client';

import React, { useMemo, useState, useEffect } from 'react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, differenceInMinutes, parseISO, subDays, startOfDay, endOfDay, differenceInDays } from 'date-fns';
import { 
  TrendingUp, 
  DollarSign, 
  PackageX, 
  Clock, 
  Info, 
  Briefcase, 
  User, 
  MessageSquare, 
  Coffee, 
  Hourglass, 
  BarChart, 
  Percent, 
  Users, 
  List, 
  FileText, 
  Shield, 
  Search, 
  Calendar as CalendarIcon, 
  Printer, 
  ShieldAlert,
  Mail,
  Phone,
  Sparkles,
  Loader,
  Square,
  Zap,
  Workflow,
  PackageOpen
} from 'lucide-react';
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
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Alert, AlertDescription } from '../ui/alert';
import { Label } from '@/components/ui/label';
import { formatPhoneNumber } from 'react-phone-number-input';

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
    <Card className="bg-background border-2 shadow-sm rounded-xl overflow-hidden">
        <CardContent className="p-3">
             <div className="flex justify-between items-start gap-2">
                <div className="flex-1 space-y-1">
                    <p className="font-bold text-xs uppercase tracking-tight flex items-center gap-2">
                        {log.type === 'clock_in' && <Clock className="w-3.5 h-3.5 text-green-500" />}
                        {log.type === 'clock_out' && <Clock className="w-3.5 h-3.5 text-red-500" />}
                        {log.type === 'break_start' && <Coffee className="w-3.5 h-3.5 text-yellow-500" />}
                        {log.type === 'break_end' && <Coffee className="w-3.5 h-3.5 text-gray-500" />}
                        {log.type.replace('_', ' ')}
                    </p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">{format(log.timestamp, 'MMM d, h:mm a')}</p>
                </div>
                {log.durationMinutes && (
                    <div className="text-right flex-shrink-0">
                        <p className="font-black text-xs text-slate-900">{log.durationMinutes}m</p>
                        <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Dur.</p>
                    </div>
                )}
            </div>
        </CardContent>
    </Card>
);

const TransactionCard = ({ transaction, service, timeVariance }: { transaction: Transaction, service?: Service, timeVariance: number | null }) => (
    <Card className="bg-background border-2 shadow-sm rounded-xl overflow-hidden">
        <CardContent className="p-3">
            <div className="flex justify-between items-start gap-2">
                <div className="flex-1 space-y-1 min-w-0">
                    <p className="font-bold text-xs uppercase tracking-tight truncate">{transaction.description}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 truncate">{transaction.clientOrVendor} &middot; {format(new Date(transaction.date), 'MMM d, p')}</p>
                </div>
                <div className="text-right flex-shrink-0">
                    <p className={cn('font-black font-mono text-sm tracking-tighter', transaction.type === 'income' ? 'text-green-600' : 'text-destructive')}>
                        {transaction.type === 'income' ? '+' : '-'}${transaction.amount.toFixed(2)}
                    </p>
                    {timeVariance !== null && (
                        <p className={cn('text-[9px] font-black uppercase tracking-tighter', timeVariance > 0 ? 'text-destructive' : 'text-green-600')}>
                            {timeVariance > 0 ? '+' : ''}{timeVariance}m Var
                        </p>
                    )}
                </div>
            </div>
            <div className="flex items-center flex-wrap gap-2 mt-2 pt-2 border-t border-dashed border-border/50">
                 <Badge variant="outline" className={cn("text-[8px] h-4 px-1 uppercase font-black tracking-widest border-none", transaction.category === 'Tips' ? 'bg-green-500/10 text-green-700' : 'bg-primary/5 text-primary')}>{transaction.category}</Badge>
                 {service && <p className="text-[9px] font-bold uppercase tracking-tight text-muted-foreground truncate opacity-60">{service.name}</p>}
            </div>
        </CardContent>
    </Card>
);

const safeDateWrapper = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
    return new Date(val);
};

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
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>(initialDateRange);
  
  const staffServices = useMemo(() => {
    if (!staffMember?.services || !services) return [];
    return services.filter(s => staffMember.services?.includes(s.id));
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
      const transactionDate = new Date(t.date);
      if (fromDate && transactionDate < fromDate) return false;
      if (toDate && transactionDate > toDate) return false;
      if (transactionSearch.trim() && !(t.description.toLowerCase().includes(transactionSearch.toLowerCase()) || t.clientOrVendor.toLowerCase().includes(transactionSearch.toLowerCase()))) return false;
      return true;
    }).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, staffMember, transactionSearch, dateRange]);
    
  if (!staffMember) {
    return null;
  }
  
  const stats = staffMember.stats || {};

  const performanceKpis = [
      { label: "Utilization", value: `${(stats.utilizationRate || 0).toFixed(1)}%` },
      { label: "Avg. Ticket", value: `$${(stats.avgSalePerAppointment || 0).toFixed(2)}` },
      { label: "Retail Rate", value: `${(stats.retailAttachmentRate || 0).toFixed(1)}%` },
      { label: "Avg Variance", value: `${(stats.avgVariance || 0) > 0 ? '+' : ''}${(stats.avgVariance || 0).toFixed(1)}m` },
  ];

  const content = (
    <div className="space-y-8 md:space-y-10">
          <div className={cn("flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 rounded-3xl bg-muted/30 border-2 border-dashed border-border/50", isMobile && "mb-6")}>
              <div className="flex flex-col sm:flex-row gap-3 flex-1">
                  <div className="flex-1 space-y-1">
                      <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-2">Period From</Label>
                      <input 
                          type="date" 
                          value={dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : ''}
                          onChange={(e) => {
                              const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined;
                              setDateRange(prev => ({ from: d || prev?.from, to: prev?.to }));
                          }}
                          className="w-full h-10 rounded-xl border-2 bg-background px-3 font-bold text-xs outline-none focus:border-primary transition-all shadow-sm"
                      />
                  </div>
                  <div className="flex-1 space-y-1">
                      <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-2">Period To</Label>
                      <input 
                          type="date" 
                          value={dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : ''}
                          onChange={(e) => {
                              const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined;
                              setDateRange(prev => ({ from: prev?.from, to: d || prev?.to }));
                          }}
                          className="w-full h-10 rounded-xl border-2 bg-background px-3 font-bold text-xs outline-none focus:border-primary transition-all shadow-sm"
                      />
                  </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.print()} className="h-10 rounded-xl font-black uppercase text-[9px] tracking-widest border-2 mt-auto sm:self-end bg-white shadow-sm">
                  <Printer className="mr-2 h-3.5 w-3.5" /> Print Intel
              </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <Card className="border-2 shadow-sm"><CardHeader className="p-3 sm:p-4 pb-1"><CardTitle className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground">Gross Sales</CardTitle></CardHeader><CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 text-left"><p className="text-xl sm:text-2xl font-black tracking-tighter text-slate-900 font-mono">${(stats.totalSales || 0).toFixed(2)}</p></CardContent></Card>
              <Card className="border-2 shadow-sm"><CardHeader className="p-3 sm:p-4 pb-1"><CardTitle className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground">Tips Earned</CardTitle></CardHeader><CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 text-left"><p className="text-xl sm:text-2xl font-black tracking-tighter text-green-600 font-mono">${(stats.tips || 0).toFixed(2)}</p></CardContent></Card>
              <Card className="border-2 shadow-sm"><CardHeader className="p-3 sm:p-4 pb-1"><CardTitle className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Hours</CardTitle></CardHeader><CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 text-left"><p className="text-xl sm:text-2xl font-black tracking-tighter text-slate-900 font-mono">{(stats.totalHours || 0).toFixed(1)}h</p></CardContent></Card>
              <Card className="bg-primary/5 border-primary/20 border-2 shadow-sm"><CardHeader className="p-3 sm:p-4 pb-1"><CardTitle className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-primary">Est. Payout</CardTitle></CardHeader><CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 text-left"><p className="text-xl sm:text-2xl font-black tracking-tighter text-primary font-mono">${(stats.earnings || 0).toFixed(2)}</p></CardContent></Card>
          </div>

           <Tabs defaultValue="activity" className="w-full">
              <ScrollArea className="w-full">
                  <TabsList className="bg-muted/50 p-1 rounded-2xl mb-6">
                      <TabsTrigger value="activity" className="rounded-xl font-black uppercase text-[10px] tracking-widest h-9">Activity</TabsTrigger>
                      <TabsTrigger value="transactions" className="rounded-xl font-black uppercase text-[10px] tracking-widest h-9">Ledger</TabsTrigger>
                      <TabsTrigger value="effectiveness" className="rounded-xl font-black uppercase text-[10px] tracking-widest h-9">Metrics</TabsTrigger>
                      <TabsTrigger value="profile" className="rounded-xl font-black uppercase text-[10px] tracking-widest h-9">Dossier</TabsTrigger>
                  </TabsList>
                  <ScrollBar orientation="horizontal" />
              </ScrollArea>
              
              <TabsContent value="activity" className="mt-0 space-y-4">
                  <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                      <Input placeholder="SEARCH ACTIONS..." className="pl-9 h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest focus-visible:ring-primary/20" value={activitySearch} onChange={(e) => setActivitySearch(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    {filteredActivityLogs.length > 0 ? (filteredActivityLogs.map(log => <ActivityLogCard key={log.id} log={log} />)) : (<div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30"><Clock className="w-12 h-12 mx-auto mb-2"/><p className="text-xs font-black uppercase tracking-widest">No activity</p></div>)}
                  </div>
              </TabsContent>

              <TabsContent value="transactions" className="mt-0 space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                    <Input placeholder="SEARCH LEDGER..." className="pl-9 h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest focus-visible:ring-primary/20" value={transactionSearch} onChange={(e) => setTransactionSearch(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                      {filteredTransactions.length > 0 ? (
                          filteredTransactions.map(t => {
                              const appointment = appointments.find(apt => apt.id === t.appointmentId);
                              const service = services.find(s => s.id === appointment?.serviceId);
                              let timeVariance = null;
                              if (appointment && service && appointment.actualStartTime && appointment.actualEndTime) {
                                  const actualDuration = differenceInMinutes(safeDateWrapper(appointment.actualEndTime), safeDateWrapper(appointment.actualStartTime));
                                  timeVariance = actualDuration - service.duration;
                              }
                              return <TransactionCard key={t.id} transaction={t} service={service} timeVariance={timeVariance} />
                          })
                      ) : (
                        <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30"><DollarSign className="w-12 h-12 mx-auto mb-2"/><p className="text-xs font-black uppercase tracking-widest">No records</p></div>
                      )}
                  </div>
              </TabsContent>

              <TabsContent value="effectiveness" className="mt-0">
                  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                    <CardHeader className="bg-muted/10 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest">Efficiency Matrix</CardTitle></CardHeader>
                    <CardContent className="p-6">
                        <div className="grid grid-cols-2 gap-4">
                            {performanceKpis.map(kpi => (
                                <div key={kpi.label} className="p-4 rounded-2xl bg-muted/20 border-2 transition-all group hover:border-primary/20">
                                    <div className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60">{kpi.label}</div>
                                    <div className={cn("text-2xl font-black tracking-tighter font-mono", kpi.label === "Avg Variance" && (parseFloat(kpi.value) > 0 ? 'text-destructive' : 'text-green-600'))}>{kpi.value}</div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                  </Card>
               </TabsContent>

               <TabsContent value="profile" className="mt-0 space-y-6">
                  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                    <CardHeader className="bg-muted/10 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Contact & Compliance</CardTitle></CardHeader>
                    <CardContent className="p-6 space-y-6 text-sm font-bold text-left">
                        <div className="space-y-3">
                            <div className="flex items-center gap-3"><Mail className="w-4 h-4 text-primary opacity-40" /> <span className="text-slate-900">{staffMember.email}</span></div>
                            <div className="flex items-center gap-3"><Phone className="w-4 h-4 text-primary opacity-40" /> <span className="text-slate-900">{staffMember.phone ? formatPhoneNumber(staffMember.phone) : 'No Phone'}</span></div>
                        </div>
                        {staffMember.emergencyContact?.name && (
                            <div className="pt-6 border-t border-dashed space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Emergency Protocol</p>
                                <div className="space-y-1">
                                    <p className="text-slate-900 uppercase font-black tracking-tight">{staffMember.emergencyContact.name} ({staffMember.emergencyContact.relationship})</p>
                                    <p className="text-primary font-black">{staffMember.emergencyContact.phone ? formatPhoneNumber(staffMember.emergencyContact.phone) : ''}</p>
                                </div>
                            </div>
                        )}
                        <Separator className="bg-muted/50" />
                        <div className="space-y-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Licensing Archive</p>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1"><p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-40">License ID</p><p className="uppercase tracking-tight font-black">{staffMember.compliance?.licenseNumber || '—'}</p></div>
                                <div className="space-y-1"><p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-40">Expiration</p><p className="uppercase tracking-tight font-black">{staffMember.compliance?.licenseExpiry ? format(safeDateWrapper(staffMember.compliance.licenseExpiry), 'MMM d, yyyy') : '—'}</p></div>
                            </div>
                        </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                    <CardHeader className="bg-muted/10 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Treatment Catalog</CardTitle></CardHeader>
                    <CardContent className="p-6 space-y-2">
                        {staffServices.length > 0 ? staffServices.map(s => (
                            <div key={s.id} className="flex justify-between items-center p-3 rounded-xl bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all text-left">
                                <span className="text-[10px] font-black uppercase tracking-tight text-slate-700 truncate mr-2">{s.name}</span>
                                <span className="font-mono font-black text-primary text-[10px] shrink-0">${s.price.toFixed(2)}</span>
                            </div>
                        )) : <p className="text-center py-6 text-[10px] font-black text-muted-foreground uppercase opacity-40">No services assigned</p>}
                    </CardContent>
                  </Card>
               </TabsContent>
          </Tabs>
      </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className={cn("p-0 border-none bg-background", isMobile ? "h-[92dvh] rounded-t-[3rem] shadow-2xl" : "sm:max-w-2xl")}>
        <div className="flex flex-col h-full">
            <SheetHeader className={cn("border-b bg-muted/5 flex-shrink-0 text-left", isMobile ? "p-5" : "p-8 pb-6")}>
                <div className="flex items-center gap-4">
                    <Avatar className={cn("border-4 border-background shadow-xl rounded-2xl", isMobile ? "h-12 w-12" : "h-16 w-16")}>
                        <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
                        <AvatarFallback className="font-black text-lg bg-primary/10 text-primary">{(staffMember.name || 'S').charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                        <SheetTitle className={cn("font-black uppercase tracking-tighter text-slate-900 leading-none mb-1", isMobile ? "text-xl" : "text-3xl")}>{staffMember.name}</SheetTitle>
                        <SheetDescription className="text-[9px] font-black uppercase tracking-widest opacity-60">Performance Intelligence</SheetDescription>
                    </div>
                </div>
            </SheetHeader>

            <ScrollArea className="flex-1 min-h-0">
                <div className={cn(isMobile ? "p-5" : "p-8")}>
                    {content}
                </div>
            </ScrollArea>
            
            <SheetFooter className={cn("border-t bg-background flex-shrink-0", isMobile ? "p-4" : "p-8 pt-4")}>
                <Button onClick={() => onOpenChange(false)} className={cn("w-full rounded-2xl font-black uppercase tracking-tight shadow-2xl shadow-primary/20 transition-all active:scale-95", isMobile ? "h-12 text-sm" : "h-16 text-xl")}>Close Dashboard</Button>
            </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
};
