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
import { format, differenceInMinutes, parseISO, subDays, startOfDay, endOfDay, differenceInDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { 
  TrendingUp, 
  DollarSign, 
  Clock, 
  FileText, 
  Coffee, 
  BarChart, 
  Users, 
  Search, 
  Printer, 
  Mail, 
  Phone, 
  Sparkles, 
  Loader,
  CalendarDays,
  Target
} from 'lucide-react';
import { Button } from '../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateRange } from 'react-day-picker';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Label } from '@/components/ui/label';
import { formatPhoneNumber } from 'react-phone-number-input';
import { motion, AnimatePresence } from 'framer-motion';

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

const ActivityLogCard = ({ log }: { log: ActivityLog }) => (
    <Card className="bg-background border-2 shadow-sm rounded-xl overflow-hidden">
        <CardContent className="p-3 text-left">
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
    <Card className="bg-background border-2 shadow-sm rounded-xl overflow-hidden text-left">
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

export const StaffDetailsSheet = ({
  open,
  onOpenChange,
  staffMember,
  dateRange: initialDateRange,
  transactions,
  services,
  appointments,
  activityLogs,
  consentForms,
}: any) => {
  const isMobile = useIsMobile();
  const [activitySearch, setActivitySearch] = useState('');
  const [transactionSearch, setTransactionSearch] = useState('');
  const [periodPreset, setPeriodPreset] = useState('30days');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(initialDateRange);
  
  useEffect(() => {
    const now = new Date();
    switch (periodPreset) {
        case 'today':
            setDateRange({ from: startOfDay(now), to: endOfDay(now) });
            break;
        case '7days':
            setDateRange({ from: startOfDay(subDays(now, 6)), to: endOfDay(now) });
            break;
        case '30days':
            setDateRange({ from: startOfDay(subDays(now, 29)), to: endOfDay(now) });
            break;
        case 'thisMonth':
            setDateRange({ from: startOfMonth(now), to: endOfMonth(now) });
            break;
        case 'lastMonth':
            const lastMonth = subMonths(now, 1);
            setDateRange({ from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) });
            break;
        case 'custom':
            break;
    }
  }, [periodPreset]);

  // Recalculate stats based on local dateRange
  const liveStats = useMemo(() => {
    if (!staffMember || !transactions || !appointments || !activityLogs || !services) return null;
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    const filterByDate = (date: any) => {
        const d = safeDateWrapper(date);
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
    };

    const staffAppointments = appointments.filter((apt: Appointment) => apt.staffId === staffMember.id && filterByDate(apt.startTime));
    const completedAppointments = staffAppointments.filter((apt: Appointment) => apt.status === 'completed');
    const completedAppointmentsCount = completedAppointments.length;

    let totalMinutesVariance = 0;
    let totalInServiceMinutes = 0;
    completedAppointments.forEach((apt: Appointment) => {
        const service = services.find((s: Service) => s.id === apt.serviceId);
        if (apt.actualStartTime && apt.actualEndTime && service) {
            const actualDuration = differenceInMinutes(safeDateWrapper(apt.actualEndTime), safeDateWrapper(apt.actualStartTime));
            totalMinutesVariance += actualDuration - service.duration;
            totalInServiceMinutes += actualDuration;
        } else if (service) {
            totalInServiceMinutes += service.duration;
        }
    });
    
    const avgVariance = completedAppointmentsCount > 0 ? totalMinutesVariance / completedAppointmentsCount : 0;

    const staffTransactions = transactions.filter((t: Transaction) => t.staffId === staffMember.id && filterByDate(t.date));
    
    const serviceRevenue = staffTransactions
        .filter((t: Transaction) => t.category === 'Service Revenue')
        .reduce((acc: number, t: Transaction) => acc + t.amount, 0);

    const retailSales = staffTransactions
        .filter((t: Transaction) => t.category === 'Retail')
        .reduce((acc: number, t: Transaction) => acc + t.amount, 0);
    
    const totalSales = serviceRevenue + retailSales;
    const avgSalePerAppointment = completedAppointmentsCount > 0 ? totalSales / completedAppointmentsCount : 0;

    const retailTransactionsWithAppointment = staffTransactions.filter((t: Transaction) => t.category === 'Retail' && t.appointmentId);
    const retailAttachmentRate = completedAppointmentsCount > 0 ? (new Set(retailTransactionsWithAppointment.map((t: Transaction) => t.appointmentId)).size / completedAppointmentsCount) * 100 : 0;

    const tips = staffTransactions.reduce((acc: number, t: Transaction) => {
        if (t.category === 'Tips') return acc + t.amount;
        return acc + (t.tipAmount || 0);
    }, 0);

    let totalMinutesWorked = 0;
    const staffLogs = activityLogs.filter((log: ActivityLog) => log.staffId === staffMember.id && filterByDate(log.timestamp));
    const sortedLogs = staffLogs.sort((a: ActivityLog, b: ActivityLog) => safeDateWrapper(a.timestamp).getTime() - safeDateWrapper(b.timestamp).getTime());
    
    let clockInTime: Date | null = null;
    let totalBreakMinutes = 0;
    
    for (const log of sortedLogs) {
        const logTime = safeDateWrapper(log.timestamp);
        if (log.type === 'clock_in') {
            if (clockInTime) {
                const sessionEnd = toDate && logTime > toDate ? toDate : logTime;
                totalMinutesWorked += differenceInMinutes(sessionEnd, clockInTime) - totalBreakMinutes;
            }
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
    
    if(clockInTime) {
        const endOfRange = toDate && toDate < new Date() ? toDate : new Date();
        totalMinutesWorked += Math.max(0, differenceInMinutes(endOfRange, clockInTime) - totalBreakMinutes);
    }

    const utilizationRate = totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0;
    
    let earnings = 0;
    if (staffMember.payStructure === 'commission') {
        earnings = serviceRevenue * ((staffMember.commissionRate || 0) / 100);
    } else if (staffMember.payStructure === 'hourly' && staffMember.hourlyRate) {
        const hoursWorked = totalMinutesWorked / 60;
        earnings = hoursWorked * staffMember.hourlyRate;
    }
    
    const retailCommission = retailSales * ((staffMember.retailCommissionRate || 0) / 100);
    earnings += tips + retailCommission; 

    return {
        totalSales,
        tips,
        totalHours: totalMinutesWorked / 60,
        earnings,
        utilizationRate,
        avgSalePerAppointment,
        retailAttachmentRate,
        avgVariance
    };
  }, [staffMember, transactions, appointments, activityLogs, services, dateRange]);

  const staffServices = useMemo(() => {
    if (!staffMember?.services || !services) return [];
    return services.filter((s: any) => staffMember.services?.includes(s.id));
  }, [staffMember, services]);

  const filteredActivityLogs = useMemo(() => {
    if (!activityLogs || !staffMember) return [];
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return activityLogs
      .filter((log: any) => {
        if (log.staffId !== staffMember.id) return false;
        const logDate = log.timestamp;
        if (fromDate && logDate < fromDate) return false;
        if (toDate && logDate > toDate) return false;
        if (activitySearch.trim() && !log.type.toLowerCase().includes(activitySearch.toLowerCase())) return false;
        return true;
      })
      .sort((a: any, b: any) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [activityLogs, staffMember, activitySearch, dateRange]);
  
  const filteredTransactions = useMemo(() => {
    if (!transactions || !staffMember) return [];
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;
    
    return transactions.filter((t: any) => {
      if(t.staffId !== staffMember.id) return false;
      const transactionDate = new Date(t.date);
      if (fromDate && transactionDate < fromDate) return false;
      if (toDate && transactionDate > toDate) return false;
      if (transactionSearch.trim() && !(t.description.toLowerCase().includes(transactionSearch.toLowerCase()) || t.clientOrVendor.toLowerCase().includes(transactionSearch.toLowerCase()))) return false;
      return true;
    }).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, staffMember, transactionSearch, dateRange]);
    
  if (!staffMember) return null;
  
  const currentStats = liveStats || {};
  const performanceKpis = [
      { label: "Utilization", value: `${(currentStats.utilizationRate || 0).toFixed(1)}%` },
      { label: "Avg. Ticket", value: `$${(currentStats.avgSalePerAppointment || 0).toFixed(2)}` },
      { label: "Retail Rate", value: `${(currentStats.retailAttachmentRate || 0).toFixed(1)}%` },
      { label: "Avg Variance", value: `${(currentStats.avgVariance || 0) > 0 ? '+' : ''}${(currentStats.avgVariance || 0).toFixed(1)}m` },
  ];

  const content = (
    <div className="space-y-8 md:space-y-10">
          <div className={cn("p-5 rounded-3xl bg-muted/30 border-2 border-dashed border-border/50", isMobile && "mb-6")}>
              <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                      <div className="flex-1 w-full">
                          <Label className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">Analyze Period</Label>
                          <Select value={periodPreset} onValueChange={setPeriodPreset}>
                              <SelectTrigger className="h-12 rounded-2xl border-2 bg-background font-black uppercase text-[10px] tracking-widest shadow-sm">
                                  <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="rounded-2xl border-2 shadow-2xl">
                                  <SelectItem value="today" className="font-bold">TODAY</SelectItem>
                                  <SelectItem value="7days" className="font-bold">LAST 7 DAYS</SelectItem>
                                  <SelectItem value="30days" className="font-bold">LAST 30 DAYS</SelectItem>
                                  <SelectItem value="thisMonth" className="font-bold">THIS MONTH</SelectItem>
                                  <SelectItem value="lastMonth" className="font-bold">LAST MONTH</SelectItem>
                                  <SelectItem value="custom" className="font-bold">CUSTOM RANGE...</SelectItem>
                              </SelectContent>
                          </Select>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => window.print()} className="h-12 px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest mt-auto bg-white shadow-sm shrink-0">
                          <Printer className="mr-2 h-4 w-4 opacity-40" /> Print
                      </Button>
                  </div>

                  <AnimatePresence>
                      {periodPreset === 'custom' && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                              <div className="grid grid-cols-2 gap-3 pt-2">
                                  <div className="space-y-1 text-left">
                                      <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground ml-1">From</Label>
                                      <input 
                                          type="date" 
                                          value={dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : ''}
                                          onChange={(e) => {
                                              const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined;
                                              setDateRange(prev => ({ from: d || prev?.from, to: prev?.to }));
                                          }}
                                          className="w-full h-10 rounded-xl border-2 bg-background px-3 font-bold text-xs outline-none focus:border-primary transition-all shadow-inner"
                                      />
                                  </div>
                                  <div className="space-y-1 text-left">
                                      <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground ml-1">To</Label>
                                      <input 
                                          type="date" 
                                          value={dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : ''}
                                          onChange={(e) => {
                                              const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined;
                                              setDateRange(prev => ({ from: prev?.from, to: d || prev?.to }));
                                          }}
                                          className="w-full h-10 rounded-xl border-2 bg-background px-3 font-bold text-xs outline-none focus:border-primary transition-all shadow-inner"
                                      />
                                  </div>
                              </div>
                          </motion.div>
                      )}
                  </AnimatePresence>
              </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <Card className="border-2 shadow-sm"><CardHeader className="p-3 sm:p-4 pb-1"><CardTitle className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground">Gross Sales</CardTitle></CardHeader><CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 text-left"><p className="text-xl sm:text-2xl font-black tracking-tighter text-slate-900 font-mono">${(currentStats.totalSales || 0).toFixed(2)}</p></CardContent></Card>
              <Card className="border-2 shadow-sm"><CardHeader className="p-3 sm:p-4 pb-1"><CardTitle className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground">Tips Earned</CardTitle></CardHeader><CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 text-left"><p className="text-xl sm:text-2xl font-black tracking-tighter text-green-600 font-mono">${(currentStats.tips || 0).toFixed(2)}</p></CardContent></Card>
              <Card className="border-2 shadow-sm"><CardHeader className="p-3 sm:p-4 pb-1"><CardTitle className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Hours</CardTitle></CardHeader><CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 text-left"><p className="text-xl sm:text-2xl font-black tracking-tighter text-slate-900 font-mono">{(currentStats.totalHours || 0).toFixed(1)}h</p></CardContent></Card>
              <Card className="bg-primary/5 border-primary/20 border-2 shadow-sm"><CardHeader className="p-3 sm:p-4 pb-1"><CardTitle className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-primary">Est. Payout</CardTitle></CardHeader><CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 text-left"><p className="text-xl sm:text-2xl font-black tracking-tighter text-primary font-mono">${(currentStats.earnings || 0).toFixed(2)}</p></CardContent></Card>
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
                      <Input placeholder="SEARCH ACTIONS..." className="pl-9 h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest focus-visible:ring-primary/20 shadow-inner bg-muted/5" value={activitySearch} onChange={(e) => setActivitySearch(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    {filteredActivityLogs.length > 0 ? (filteredActivityLogs.map((log: any) => <ActivityLogCard key={log.id} log={log} />)) : (<div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30"><Clock className="w-12 h-12 mx-auto mb-2"/><p className="text-xs font-black uppercase tracking-widest">No activity</p></div>)}
                  </div>
              </TabsContent>

              <TabsContent value="transactions" className="mt-0 space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                    <Input placeholder="SEARCH LEDGER..." className="pl-9 h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest focus-visible:ring-primary/20 shadow-inner bg-muted/5" value={transactionSearch} onChange={(e) => setTransactionSearch(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                      {filteredTransactions.length > 0 ? (
                          filteredTransactions.map((t: any) => {
                              const appointment = appointments.find((apt: any) => apt.id === t.appointmentId);
                              const service = services.find((s: any) => s.id === appointment?.serviceId);
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
                                <div key={kpi.label} className="p-4 rounded-2xl bg-muted/20 border-2 transition-all group hover:border-primary/20 text-left">
                                    <div className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60">{kpi.label}</div>
                                    <div className={cn("text-2xl font-black tracking-tighter font-mono", kpi.label === "Avg Variance" && (parseFloat(kpi.value) > 0 ? 'text-destructive' : 'text-green-600'))}>{kpi.value}</div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                  </Card>
               </TabsContent>

               <TabsContent value="profile" className="mt-0 space-y-6 text-left">
                  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                    <CardHeader className="bg-muted/10 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest">Contact & Compliance</CardTitle></CardHeader>
                    <CardContent className="p-6 space-y-6 text-sm font-bold">
                        <div className="space-y-3">
                            <div className="flex items-center gap-3"><Mail className="w-4 h-4 text-primary opacity-40" /> <span className="text-slate-900 truncate">{staffMember.email}</span></div>
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
                    <CardHeader className="bg-muted/10 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest">Treatment Catalog</CardTitle></CardHeader>
                    <CardContent className="p-6 space-y-2">
                        {staffServices.length > 0 ? staffServices.map((s: any) => (
                            <div key={s.id} className="flex justify-between items-center p-3 rounded-xl bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all">
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
      <SheetContent side={isMobile ? 'bottom' : 'right'} className={cn("p-0 border-none bg-background flex flex-col", isMobile ? "h-[92dvh] rounded-t-[3rem] shadow-2xl" : "sm:max-w-2xl")}>
        <div className="flex flex-col h-full overflow-hidden">
            <SheetHeader className={cn("border-b bg-muted/5 flex-shrink-0 text-left", isMobile ? "p-4" : "p-8 pb-6")}>
                <div className="flex items-center gap-4">
                    <Avatar className={cn("border-4 border-background shadow-xl rounded-2xl", isMobile ? "h-10 w-10" : "h-16 w-16")}>
                        <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
                        <AvatarFallback className="font-black text-lg bg-primary/10 text-primary">{(staffMember.name || 'S').charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                        <SheetTitle className={cn("font-black uppercase tracking-tighter text-slate-900 leading-none mb-1", isMobile ? "text-lg" : "text-3xl")}>{staffMember.name}</SheetTitle>
                        <SheetDescription className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest opacity-60">Performance Intelligence</SheetDescription>
                    </div>
                </div>
            </SheetHeader>

            <ScrollArea className="flex-1 min-h-0">
                <div className={cn(isMobile ? "p-4" : "p-8")}>
                    {content}
                </div>
            </ScrollArea>
            
            <SheetFooter className={cn("border-t bg-background flex-shrink-0", isMobile ? "p-3" : "p-8 pt-4")}>
                <Button onClick={() => onOpenChange(false)} className={cn("w-full rounded-2xl font-black uppercase tracking-tight shadow-2xl shadow-primary/20 transition-all active:scale-95", isMobile ? "h-11 text-xs" : "h-16 text-xl")}>Close Dashboard</Button>
            </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
};
