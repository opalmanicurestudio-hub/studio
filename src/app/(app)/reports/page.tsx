
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Printer, 
  DollarSign, 
  TrendingUp, 
  AlertTriangle, 
  Target, 
  Ban as BanIcon, 
  Users, 
  Wallet, 
  Clock,
  Calendar as CalendarIcon,
  ShieldCheck,
  Loader,
  Percent,
  TrendingDown,
  Repeat,
  Zap,
  ArrowRight,
  Info,
  Landmark,
  Activity,
  ShoppingBag,
  UserPlus,
  ShieldAlert,
  ArrowUpRight,
  ChevronRight,
  Scale
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInventory } from '@/context/InventoryContext';
import { format, isPast, parseISO, subDays, startOfDay, endOfDay, differenceInMinutes, differenceInDays, startOfMonth, endOfMonth, subMonths, isSameMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { type Staff, type Service, type Appointment, type Transaction as DBTransaction } from '@/lib/data';
import { DateRange } from 'react-day-picker';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUser, useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import { type Transaction } from '@/lib/financial-data';
import { Separator } from '@/components/ui/separator';

const safeDate = (val: any): Date => {
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

const KpiStat = ({ label, value, subLabel, icon: Icon, colorClass, trend }: any) => (
    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white/50 backdrop-blur-sm group hover:border-primary/20 transition-all">
        <CardContent className="p-5 space-y-4">
            <div className="flex justify-between items-start">
                <div className={cn("p-2 rounded-xl bg-muted/50 group-hover:bg-primary transition-all duration-500", colorClass)}>
                    <Icon className="w-4 h-4 group-hover:text-white transition-colors" />
                </div>
                {trend && (
                    <div className={cn("flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border-2", trend > 0 ? "text-green-600 bg-green-50 border-green-100" : "text-destructive bg-destructive/5 border-destructive/10")}>
                        {trend > 0 ? <ArrowUpRight className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {Math.abs(trend)}%
                    </div>
                )}
            </div>
            <div className="space-y-1 text-left">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 leading-none">{label}</p>
                <p className="text-2xl font-black tracking-tighter text-slate-900 font-mono leading-none">{value}</p>
                <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-40 truncate">{subLabel}</p>
            </div>
        </CardContent>
    </Card>
);

export default function ReportsPage() {
  const isMobile = useIsMobile();
  const { user: currentUser } = useUser();
  const { role, selectedTenant } = useTenant();
  const [periodPreset, setPeriodPreset] = useState('thisMonth');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  
  const {
    inventory,
    appointments,
    services,
    staff,
    walkIns,
    activityLogs,
    transactions,
    clients,
    billInstances,
    isLoading
  } = useInventory();

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

  const periodOverhead = useMemo(() => {
    if (!billInstances) return 0;
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return billInstances
        .filter(bi => {
            const d = safeDate(bi.dueDate);
            return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
        })
        .reduce((sum, bi) => sum + (bi.amountDue || 0), 0);
  }, [billInstances, dateRange]);

  const analyticsData = useMemo(() => {
    if (!staff || !appointments || !services || !transactions || !activityLogs) return { performance: [], overall: {} as any };
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    const filterByDate = (date: any) => {
        const d = safeDate(date);
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
    }

    const performance = staff.map(staffMember => {
        const staffAppointments = appointments.filter(apt => apt.staffId === staffMember.id && filterByDate(apt.startTime));
        const completedAppointments = staffAppointments.filter(apt => apt.status === 'completed');
        const completedCount = completedAppointments.length;
      
        let totalMinutesVariance = 0;
        let totalInServiceMinutes = 0;
        completedAppointments.forEach(apt => {
            const service = services.find(s => s.id === apt.serviceId);
            if (apt.actualStartTime && apt.actualEndTime && service) {
                const actualDuration = differenceInMinutes(safeDate(apt.actualEndTime), safeDate(apt.actualStartTime));
                totalMinutesVariance += actualDuration - service.duration;
                totalInServiceMinutes += actualDuration;
            } else if (service) {
                totalInServiceMinutes += service.duration;
            }
        });
      
        const avgVariance = completedCount > 0 ? totalMinutesVariance / completedCount : 0;
        const staffTransactions = transactions.filter(t => t.staffId === staffMember.id && filterByDate(t.date));
        const serviceRevenue = staffTransactions.filter(t => t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0);
        const retailSales = staffTransactions.filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
        const tips = staffTransactions.reduce((acc, t) => acc + (t.tipAmount || (t.category === 'Tips' ? t.amount : 0)), 0);
        
        const retailTransactionsWithAppointment = staffTransactions.filter(t => t.category === 'Retail' && t.appointmentId);
        const retailAttachmentRate = completedCount > 0 ? (new Set(retailTransactionsWithAppointment.map(t => t.appointmentId)).size / completedCount) * 100 : 0;

        let totalMinutesWorked = 0;
        const staffLogs = activityLogs.filter(log => log.staffId === staffMember.id && filterByDate(log.timestamp));
        const sortedLogs = staffLogs.sort((a, b) => safeDate(a.timestamp).getTime() - safeDate(b.timestamp).getTime());
        
        let clockInTime: Date | null = null;
        let totalBreakMinutes = 0;
        for (const log of sortedLogs) {
            const logTime = safeDate(log.timestamp);
            if (log.type === 'clock_in') {
                if (clockInTime) totalMinutesWorked += Math.max(0, differenceInMinutes(logTime, clockInTime) - totalBreakMinutes);
                clockInTime = logTime;
                totalBreakMinutes = 0;
            } else if (log.type === 'clock_out' && clockInTime) {
                totalMinutesWorked += Math.max(0, differenceInMinutes(logTime, clockInTime) - totalBreakMinutes);
                clockInTime = null;
            } else if (log.type === 'break_end' && log.durationMinutes) {
                totalBreakMinutes += log.durationMinutes;
            }
        }
        if(clockInTime && (!toDate || clockInTime < toDate)) {
            const endOfRange = toDate && toDate < new Date() ? toDate : new Date();
            totalMinutesWorked += Math.max(0, differenceInMinutes(endOfRange, clockInTime) - totalBreakMinutes);
        }

        const totalHoursWorked = totalMinutesWorked / 60;
        const utilizationRate = totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0;
        const yieldPerHour = totalHoursWorked > 0 ? (serviceRevenue + retailSales) / totalHoursWorked : 0;
        
        let wages = 0;
        if (staffMember.payStructure === 'commission') {
            wages = serviceRevenue * ((staffMember.commissionRate || 0) / 100);
        } else if (staffMember.payStructure === 'hourly' && staffMember.hourlyRate) {
            wages = totalHoursWorked * staffMember.hourlyRate;
        }
        const retailCommission = retailSales * ((staffMember.retailCommissionRate || 0) / 100);
        const totalPay = wages + tips + retailCommission;
        
        const costOfGoodsSold = completedAppointments.reduce((acc, apt) => {
            const service = services.find(s => s.id === apt.serviceId);
            return acc + (service?.cost || 0);
        }, 0);

        const clientsServed = new Set(completedAppointments.map(a => a.clientId));
        let rebookedCount = 0;
        if (toDate) {
            clientsServed.forEach(cId => {
                const future = appointments.some(a => a.clientId === cId && safeDate(a.startTime) > toDate && a.status !== 'cancelled');
                if (future) rebookedCount++;
            });
        }
        const rebookingRate = clientsServed.size > 0 ? (rebookedCount / clientsServed.size) * 100 : 0;

        return {
            ...staffMember,
            stats: {
                totalServices: completedCount,
                avgVariance,
                totalInServiceHours: totalInServiceMinutes / 60,
                utilizationRate,
                yieldPerHour,
                retailAttachmentRate,
                serviceRevenue,
                retailSales,
                totalPay,
                tips,
                costOfGoodsSold,
                rebookingRate,
                totalHours: totalHoursWorked
            }
        };
    });

    // --- OVERALL METRICS ---
    const periodAppointments = appointments.filter(a => filterByDate(a.startTime));
    const cancelledApts = periodAppointments.filter(a => a.status === 'cancelled');
    
    const potentialRevenueLost = cancelledApts.reduce((acc, a) => {
        const svc = services.find(s => s.id === a.serviceId);
        return acc + (svc?.price || 0);
    }, 0);

    const recoveredFees = transactions
        .filter(t => t.category === 'Cancellation Fee' && filterByDate(t.date))
        .reduce((acc, t) => acc + t.amount, 0);

    const totalRevenue = performance.reduce((acc, d) => acc + d.stats.serviceRevenue + d.stats.retailSales, 0);
    const totalCOGS = performance.reduce((acc, d) => acc + d.stats.costOfGoodsSold, 0);
    
    const avgTicket = periodAppointments.filter(a => a.status === 'completed').length > 0
        ? totalRevenue / periodAppointments.filter(a => a.status === 'completed').length
        : 0;

    return { 
        performance, 
        overall: { 
            totalRevenue, 
            totalCOGS, 
            avgTicket,
            potentialRevenueLost,
            recoveredFees,
            recoveryEfficiency: potentialRevenueLost > 0 ? (recoveredFees / potentialRevenueLost) * 100 : 0,
            utilization: performance.length > 0 ? performance.reduce((acc,d) => acc + d.stats.utilizationRate, 0) / performance.length : 0
        } 
    };
  }, [staff, appointments, services, transactions, activityLogs, dateRange]);

  const { performance, overall } = analyticsData;

  const contributionData = useMemo(() => {
      if (performance.length === 0) return [];
      const overheadPerStaff = periodOverhead / performance.length;
      return performance.map(d => {
          const grossYield = d.stats.serviceRevenue + d.stats.retailSales;
          const totalStaffExpense = (d.stats.totalPay - d.stats.tips) + d.stats.costOfGoodsSold + overheadPerStaff;
          const contribution = grossYield - totalStaffExpense;
          return { ...d, overheadShare: overheadPerStaff, contribution };
      });
  }, [performance, periodOverhead]);

  if (isLoading) return <div className="h-screen flex flex-col items-center justify-center gap-4"><Loader className="animate-spin text-primary h-10 w-10" /><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground animate-pulse">Synthesizing Dossier...</p></div>;

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50 overflow-x-hidden">
      <AppHeader title="Intelligence Dossier" />
      <main className="relative z-10 flex-1 p-4 md:p-10 space-y-10 w-full max-w-7xl mx-auto min-w-0">
        
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1 text-left">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Studio Pulse</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Strategic Performance Audit</p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
             <Button variant="outline" className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-sm bg-white/50 backdrop-blur-sm" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Export Report</Button>
          </div>
        </div>

        <div className="p-6 rounded-[2.5rem] bg-muted/30 border-2 border-dashed border-border/50">
            <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="flex-1 w-full space-y-2 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">Analyze Period</Label>
                    <Select value={periodPreset} onValueChange={setPeriodPreset}>
                        <SelectTrigger className="h-14 rounded-2xl border-2 bg-white font-black uppercase text-[10px] tracking-widest shadow-sm">
                            <SelectValue placeholder="Select Period" />
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
                {periodPreset === 'custom' && (
                    <div className="flex-[2] grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                        <div className="space-y-2 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">Start Date</Label>
                            <input type="date" value={dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : ''} onChange={(e) => { const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined; setDateRange(prev => ({ from: d || prev?.from, to: prev?.to })); }} className="w-full h-14 rounded-2xl border-2 bg-white px-4 font-bold text-sm outline-none" />
                        </div>
                        <div className="space-y-2 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">End Date</Label>
                            <input type="date" value={dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : ''} onChange={(e) => { const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined; setDateRange(prev => ({ from: prev?.from, to: d || prev?.to })); }} className="w-full h-14 rounded-2xl border-2 bg-white px-4 font-bold text-sm outline-none" />
                        </div>
                    </div>
                )}
            </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 md:gap-6 w-full">
            <KpiStat label="Gross Yield" value={`$${overall.totalRevenue.toFixed(0)}`} subLabel="Direct period sales" icon={TrendingUp} colorClass="text-primary" />
            <KpiStat label="Overall Util." value={`${overall.utilization.toFixed(1)}%`} subLabel="Team productivity mean" icon={Target} />
            <KpiStat label="Avg. Ticket" value={`$${overall.avgTicket.toFixed(2)}`} subLabel="Mean spend per visit" icon={Wallet} />
            <KpiStat label="Fixed Overhead" value={`$${periodOverhead.toFixed(0)}`} subLabel="Rent & Recurring load" icon={Landmark} />
        </div>

        <section className="grid lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 space-y-6">
                <div className="flex items-center gap-2 px-1 text-left">
                    <ShieldAlert className="w-4 h-4 text-destructive" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Risk & Opportunity Matrix</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <Card className="border-4 border-destructive/10 bg-destructive/[0.02] rounded-[2rem] overflow-hidden">
                        <CardContent className="p-6 space-y-6">
                            <div className="flex justify-between items-start">
                                <div className="space-y-1 text-left">
                                    <p className="text-[10px] font-black uppercase text-destructive tracking-widest opacity-60">Lost Opportunity</p>
                                    <p className="text-3xl font-black font-mono tracking-tighter text-destructive">${overall.potentialRevenueLost.toFixed(2)}</p>
                                </div>
                                <div className="p-3 bg-destructive/10 rounded-2xl shadow-inner"><BanIcon className="w-6 h-6 text-destructive" /></div>
                            </div>
                            <Separator className="border-destructive/10 border-dashed" />
                            <div className="flex justify-between items-center text-[10px] font-black uppercase">
                                <span className="text-muted-foreground">Recovery Yield</span>
                                <span className="text-destructive font-mono">+${overall.recoveredFees.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-[10px] font-black uppercase text-muted-foreground">Recovery Efficiency</span>
                                <Badge variant="outline" className="h-5 border-destructive/20 text-destructive font-black text-[10px] font-mono">{overall.recoveryEfficiency.toFixed(1)}%</Badge>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
                        <CardHeader className="p-6 pb-2 border-b bg-muted/5 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Efficiency Leakage</CardTitle></CardHeader>
                        <CardContent className="p-6 space-y-6">
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Avg. Time Variance</p>
                                    <span className={cn("font-black font-mono text-sm", overall.utilization > 0 ? "text-destructive" : "text-primary")}>
                                        {(performance.reduce((acc,d) => acc + d.stats.avgVariance, 0) / (performance.length || 1)).toFixed(1)}m
                                    </span>
                                </div>
                                <Separator className="border-dashed" />
                                <div className="flex justify-between items-center">
                                    <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Period COGS Load</p>
                                    <span className="font-black font-mono text-sm text-slate-900">${overall.totalCOGS.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Material % of Revenue</p>
                                    <span className="font-black font-mono text-sm text-slate-900">{overall.totalRevenue > 0 ? ((overall.totalCOGS / overall.totalRevenue) * 100).toFixed(1) : '0'}%</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <div className="space-y-6">
                <div className="flex items-center gap-2 px-1 text-left">
                    <UserPlus className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Engagement Pulse</h3>
                </div>
                <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden h-fit bg-white">
                    <CardContent className="p-6 space-y-6">
                        <div className="flex items-center gap-4 text-left">
                            <div className="p-3 bg-primary/10 rounded-2xl text-primary"><Repeat className="w-6 h-6" /></div>
                            <div className="min-w-0">
                                <p className="text-[10px] font-black uppercase text-muted-foreground opacity-60 leading-none mb-1">Retention Velocity</p>
                                <p className="text-2xl font-black tracking-tighter text-slate-900">{(performance.reduce((acc, d) => acc + d.stats.rebookingRate, 0) / (performance.length || 1)).toFixed(1)}%</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 text-left">
                            <div className="p-3 bg-teal-500/10 rounded-2xl text-teal-600"><ShoppingBag className="w-6 h-6" /></div>
                            <div className="min-w-0">
                                <p className="text-[10px] font-black uppercase text-muted-foreground opacity-60 leading-none mb-1">Retail Attachment</p>
                                <p className="text-2xl font-black tracking-tighter text-slate-900">{(performance.reduce((acc, d) => acc + d.stats.retailAttachmentRate, 0) / (performance.length || 1)).toFixed(1)}%</p>
                            </div>
                        </div>
                        <div className="p-4 rounded-xl border-2 border-dashed bg-muted/5 flex items-start gap-3 text-left">
                            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5 opacity-40" />
                            <p className="text-[9px] font-bold uppercase text-slate-600 leading-relaxed">Velocity tracks clients who rebooked within the same analysis window.</p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </section>

        <section className="space-y-6">
            <div className="flex items-center gap-2 px-1 text-left">
                <Users className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Team Yield Ledger</h3>
            </div>
            <Card className="border-2 shadow-2xl rounded-[2.5rem] overflow-hidden bg-white">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/10 border-b-2">
                                <tr>
                                    <th className="p-6 font-black text-[10px] uppercase tracking-widest text-slate-900">Provider</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-center">Util %</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-right">Yield/Hr</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-right">Gross Sales</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-right">Payroll Load</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-primary text-right pr-10">Net Contrib.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y-2 divide-dashed divide-border/50">
                                {contributionData.map(data => (
                                    <tr key={data.id} className="group hover:bg-primary/[0.02] transition-colors">
                                        <td className="p-6">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-10 w-10 border-2 border-background shadow-md rounded-xl shrink-0">
                                                    <AvatarImage src={data.avatarUrl} className="object-cover" />
                                                    <AvatarFallback className="font-black text-[10px] bg-primary/10 text-primary uppercase">{data.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="min-w-0">
                                                    <p className="font-black uppercase tracking-tight text-xs text-slate-900 truncate">{data.name}</p>
                                                    <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">{data.payStructure}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="text-center font-bold text-xs font-mono text-slate-600">{data.stats.utilizationRate.toFixed(1)}%</td>
                                        <td className="text-right font-black text-xs font-mono text-primary">${data.stats.yieldPerHour.toFixed(2)}</td>
                                        <td className="text-right font-bold text-xs font-mono text-slate-600">${(data.stats.serviceRevenue + data.stats.retailSales).toFixed(0)}</td>
                                        <td className="text-right font-bold text-xs font-mono text-destructive">-${(data.stats.totalPay - data.stats.tips).toFixed(0)}</td>
                                        <td className="text-right pr-10">
                                            <span className={cn("font-black font-mono text-base tracking-tighter", data.contribution >= 0 ? "text-primary" : "text-destructive")}>
                                                ${data.contribution.toFixed(2)}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </section>

        <div className="p-10 rounded-[3rem] bg-slate-900 text-white flex flex-col md:flex-row items-center justify-between gap-10 shadow-3xl text-left relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-10 opacity-5 transition-opacity group-hover:opacity-10"><DollarSign className="w-48 h-48" /></div>
            <div className="space-y-3 relative z-10">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Certified Performance Audit</p>
                <h3 className="text-3xl md:text-5xl font-black uppercase tracking-tighter leading-[0.9]">True Net Period Yield</h3>
                <p className="text-sm font-medium text-slate-400 max-w-sm">Calculated post-payroll, direct treatment overhead, and full pro-rata fixed expense distribution.</p>
            </div>
            <div className="flex items-baseline gap-4 relative z-10">
                <span className={cn("text-6xl md:text-9xl font-black tracking-tighter font-mono", (overall.totalRevenue - contributionData.reduce((acc,d) => acc + (d.stats.totalPay - d.stats.tips + d.stats.costOfGoodsSold + d.overheadShare), 0)) >= 0 ? "text-primary" : "text-destructive")}>
                    ${(overall.totalRevenue - contributionData.reduce((acc,d) => acc + (d.stats.totalPay - d.stats.tips + d.stats.costOfGoodsSold + d.overheadShare), 0)).toFixed(0)}
                </span>
                <span className="text-[10px] font-black uppercase opacity-40 tracking-widest">USD TOTAL</span>
            </div>
        </div>
      </main>
    </div>
  );
}
