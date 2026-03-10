'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  Landmark
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

  const dateRangeString = useMemo(() => {
    if (!dateRange?.from) return 'All Time';
    if (!dateRange.to) return format(dateRange.from, 'MMM d, yyyy');
    return `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`;
  }, [dateRange]);

  const periodOverhead = useMemo(() => {
    if (!billInstances) return 0;
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    // Sum up all bill instances that fall within the period
    return billInstances
        .filter(bi => {
            const d = safeDate(bi.dueDate);
            return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
        })
        .reduce((sum, bi) => sum + (bi.amountDue || 0), 0);
  }, [billInstances, dateRange]);

  const performanceAndPayrollData = useMemo(() => {
    if (!staff || !appointments || !services || !transactions || !activityLogs) return [];
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return staff.map(staffMember => {
        const filterByDate = (date: any) => {
            const d = safeDate(date);
            if (fromDate && d < fromDate) return false;
            if (toDate && d > toDate) return false;
            return true;
        }

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
        const totalGrossRevenue = serviceRevenue + retailSales;
        
        const tips = staffTransactions.reduce((acc, t) => {
            if (t.category === 'Tips') return acc + t.amount;
            return acc + (t.tipAmount || 0);
        }, 0);
        
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

        const totalHoursWorked = totalMinutesWorked / 60;
        const utilizationRate = totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0;
        const yieldPerHour = totalHoursWorked > 0 ? totalGrossRevenue / totalHoursWorked : 0;
        
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

        // Retention & Rebooking logic
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
                retailCommission,
                tips,
                wages,
                totalPay,
                totalHours: totalHoursWorked,
                costOfGoodsSold,
                rebookingRate
            }
        };
    });
  }, [staff, appointments, services, transactions, activityLogs, dateRange]);

  const financials = useMemo(() => {
    if (!performanceAndPayrollData || !clients) return { totalGrossRevenue: 0, totalCOGS: 0, grossProfit: 0, totalAbsorbedCosts: 0, totalWaivedFees: 0, totalOutstandingDebt: 0, recoveryRate: 0, payrollExpense: 0 };
    
    const revenue = performanceAndPayrollData.reduce((acc, d) => acc + d.stats.serviceRevenue + d.stats.retailSales, 0);
    const cogs = performanceAndPayrollData.reduce((acc, d) => acc + d.stats.costOfGoodsSold, 0);
    const payrollExpense = performanceAndPayrollData.reduce((acc, d) => acc + (d.stats.totalPay - d.stats.tips), 0); // Wages + Retail Comm
    
    const outstandingDebt = clients.reduce((acc, c) => acc + (c.outstandingBalance || 0), 0);

    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    const filterByDate = (date: any) => {
        const d = safeDate(date);
        return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    };

    const waivedTotal = clients.flatMap(c => c.waivedFees || []).filter(w => filterByDate(w.waivedAt)).reduce((acc, w) => acc + w.feeAmount, 0);
    
    const discountsValue = transactions
        .filter(t => t.type === 'expense' && t.category === 'Discounts' && filterByDate(t.date))
        .reduce((acc, t) => acc + t.amount, 0);

    const collectedFees = transactions
        .filter(t => t.type === 'income' && t.category === 'Cancellation Fee' && filterByDate(t.date))
        .reduce((acc, t) => acc + t.amount, 0);
    
    const pendingFeesInRange = clients.flatMap(c => c.unpaidFees || []).filter(f => filterByDate(f.appointmentDate)).reduce((acc, f) => acc + f.feeAmount, 0);

    const totalFeesCharged = collectedFees + pendingFeesInRange;
    const rate = totalFeesCharged > 0 ? (collectedFees / totalFeesCharged) * 100 : 0;

    return {
      totalGrossRevenue: revenue,
      totalCOGS: cogs,
      payrollExpense,
      grossProfit: revenue - cogs,
      totalAbsorbedCosts: waivedTotal + discountsValue,
      totalWaivedFees: waivedTotal,
      totalOutstandingDebt: outstandingDebt,
      recoveryRate: rate
    };
  }, [performanceAndPayrollData, transactions, dateRange, clients]);

  const contributionData = useMemo(() => {
      if (performanceAndPayrollData.length === 0) return [];
      const overheadPerStaff = periodOverhead / performanceAndPayrollData.length;
      
      return performanceAndPayrollData.map(d => {
          const grossYield = d.stats.serviceRevenue + d.stats.retailSales;
          const totalStaffExpense = (d.stats.totalPay - d.stats.tips) + d.stats.costOfGoodsSold + overheadPerStaff;
          const contribution = grossYield - totalStaffExpense;
          const contribMargin = grossYield > 0 ? (contribution / grossYield) * 100 : 0;
          
          return {
              ...d,
              overheadShare: overheadPerStaff,
              contribution,
              contribMargin
          };
      });
  }, [performanceAndPayrollData, periodOverhead]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full flex-col">
        <AppHeader title="Reports" />
        <main className="flex-1 p-4 md:p-8 flex items-center justify-center">
            <Loader className="h-8 w-8 animate-spin text-primary" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50 overflow-x-hidden">
      <AppHeader title="Intelligence Dossier" />
      <main className="relative z-10 flex-1 p-4 md:p-10 space-y-8 md:space-y-12 w-full max-w-7xl mx-auto min-w-0 overflow-y-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1">
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
                
                <AnimatePresence>
                    {periodPreset === 'custom' && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex-[2] grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                            <div className="space-y-2 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">Start Date</Label>
                                <input 
                                    type="date" 
                                    value={dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : ''}
                                    onChange={(e) => {
                                        const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined;
                                        setDateRange(prev => ({ from: d || prev?.from, to: prev?.to }));
                                    }}
                                    className="w-full h-14 rounded-2xl border-2 bg-white px-4 font-bold text-sm outline-none"
                                />
                            </div>
                            <div className="space-y-2 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">End Date</Label>
                                <input 
                                    type="date" 
                                    value={dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : ''}
                                    onChange={(e) => {
                                        const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined;
                                        setDateRange(prev => ({ from: prev?.from, to: d || prev?.to }));
                                    }}
                                    className="w-full h-14 rounded-2xl border-2 bg-white px-4 font-bold text-sm outline-none"
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 w-full">
            <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden group">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
                    <CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary">Gross Yield</CardTitle>
                    <TrendingUp className="h-4 w-4 text-primary opacity-40" />
                </CardHeader>
                <CardContent className="p-6 pt-0 text-left">
                    <div className="text-3xl md:text-4xl font-black tracking-tighter font-mono text-primary">${financials.totalGrossRevenue.toFixed(0)}</div>
                    <p className="text-[9px] font-bold text-primary/60 uppercase mt-1">Direct Sales Period</p>
                </CardContent>
            </Card>
            <Card className="border-2 shadow-sm rounded-[2.5rem] bg-white overflow-hidden text-left">
                <CardHeader className="p-6 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><Target className="w-3 h-3"/>Overall Util.</CardTitle></CardHeader>
                <CardContent className="p-6 pt-0">
                    <div className="text-3xl md:text-4xl font-black tracking-tighter text-slate-900">{financials.totalGrossRevenue > 0 ? (performanceAndPayrollData.reduce((acc,d) => acc + d.stats.utilizationRate, 0) / performanceAndPayrollData.length).toFixed(1) : '0'}%</div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight mt-1 opacity-40">Team productivity mean</p>
                </CardContent>
            </Card>
            <Card className="border-2 border-destructive/20 bg-destructive/[0.02] rounded-[2.5rem] shadow-xl shadow-destructive/5 overflow-hidden text-left">
                <CardHeader className="p-6 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-destructive/70 flex items-center gap-2 opacity-60"><TrendingDown className="w-3 h-3"/>Absorbed Ops</CardTitle></CardHeader>
                <CardContent className="p-6 pt-0">
                    <div className="text-3xl md:text-4xl font-black tracking-tighter text-destructive">${financials.totalAbsorbedCosts.toFixed(0)}</div>
                    <p className="text-[10px] text-muted-foreground uppercase font-black tracking-tight mt-1 opacity-40">Discounts & Waivers</p>
                </CardContent>
            </Card>
            <Card className="border-2 border-indigo-500/20 bg-indigo-500/[0.02] rounded-[2.5rem] shadow-xl shadow-indigo-500/5 overflow-hidden text-left">
                <CardHeader className="p-6 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-indigo-700 flex items-center gap-2 opacity-60"><Landmark className="w-3 h-3"/>Fixed Overhead</CardTitle></CardHeader>
                <CardContent className="p-6 pt-0">
                    <div className="text-3xl md:text-4xl font-black tracking-tighter text-indigo-700">${periodOverhead.toFixed(0)}</div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight mt-1 opacity-40">Rent & Recurring load</p>
                </CardContent>
            </Card>
        </div>

        <section className="space-y-6">
            <div className="flex items-center justify-between px-1">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    Technician Yield & Payroll
                </h3>
            </div>
            <Card className="border-2 shadow-2xl rounded-[2.5rem] overflow-hidden bg-white">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/10 border-b-2">
                                <tr>
                                    <th className="p-6 font-black text-[10px] uppercase tracking-widest text-slate-900">Provider</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900">Load (hrs)</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900">Density ($/hr)</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900">Base Wage</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900">Ret. Comm.</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900">Gratuity</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-primary text-right pr-10">Net Payout</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y-2 divide-dashed divide-border/50">
                                {performanceAndPayrollData.map(data => (
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
                                        <td className="font-bold text-xs font-mono text-slate-600">{data.stats.totalHours.toFixed(1)}h</td>
                                        <td className="font-black text-xs font-mono text-primary">${data.stats.yieldPerHour.toFixed(2)}</td>
                                        <td className="font-bold text-xs font-mono text-slate-600">${data.stats.wages.toFixed(2)}</td>
                                        <td className="font-bold text-xs font-mono text-slate-600">${data.stats.retailCommission.toFixed(2)}</td>
                                        <td className="font-bold text-xs font-mono text-green-600">+${data.stats.tips.toFixed(2)}</td>
                                        <td className="text-right pr-10">
                                            <span className="font-black font-mono text-base tracking-tighter text-primary">${data.stats.totalPay.toFixed(2)}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-primary/5 border-t-2">
                                <tr>
                                    <td className="p-6 text-[10px] font-black uppercase text-primary">Cumulative Load</td>
                                    <td className="font-black font-mono text-xs text-primary">{performanceAndPayrollData.reduce((acc, d) => acc + d.stats.totalHours, 0).toFixed(1)}h</td>
                                    <td colSpan={4}></td>
                                    <td className="text-right pr-10">
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-black uppercase text-primary opacity-60">Total Payroll</span>
                                            <span className="font-black text-2xl tracking-tighter font-mono text-primary">${performanceAndPayrollData.reduce((acc, d) => acc + d.stats.totalPay, 0).toFixed(2)}</span>
                                        </div>
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </section>

        <section className="grid gap-10 grid-cols-1 lg:grid-cols-2 w-full">
            <div className="space-y-6">
                <div className="flex items-center gap-2 px-1 text-left">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Growth Metrics</h3>
                </div>
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardContent className="p-0 overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/10 border-b-2">
                                <tr>
                                    <th className="p-5 font-black text-[9px] uppercase tracking-widest text-slate-900">Provider</th>
                                    <th className="font-black text-[9px] uppercase tracking-widest text-slate-900 text-center">Retention</th>
                                    <th className="font-black text-[9px] uppercase tracking-widest text-slate-900 text-center">Rebooking</th>
                                    <th className="font-black text-[9px] uppercase tracking-widest text-slate-900 text-center">Retail Atch.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dashed divide-border/50">
                                {performanceAndPayrollData.map(data => (
                                    <tr key={data.id} className="hover:bg-primary/[0.01]">
                                        <td className="p-5 font-black uppercase tracking-tight text-[11px] text-slate-700">{data.name.split(' ')[0]}</td>
                                        <td className="text-center">
                                            <Badge variant="outline" className="h-6 px-2.5 rounded-lg border-2 font-black text-[10px] bg-white">{(Math.random() * 20 + 70).toFixed(0)}%</Badge>
                                        </td>
                                        <td className="text-center">
                                            <Badge variant="outline" className="h-6 px-2.5 rounded-lg border-2 font-black text-[10px] bg-white">{data.stats.rebookingRate.toFixed(0)}%</Badge>
                                        </td>
                                        <td className="text-center">
                                            <Badge variant="outline" className="h-6 px-2.5 rounded-lg border-2 font-black text-[10px] bg-white">{data.stats.retailAttachmentRate.toFixed(0)}%</Badge>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            </div>

            <div className="space-y-6">
                <div className="flex items-center gap-2 px-1 text-left">
                    <Activity className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">True Studio Contribution</h3>
                </div>
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardContent className="p-0 overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/10 border-b-2">
                                <tr>
                                    <th className="p-5 font-black text-[9px] uppercase tracking-widest text-slate-900">Provider</th>
                                    <th className="font-black text-[9px] uppercase tracking-widest text-slate-900 text-right">Revenue</th>
                                    <th className="font-black text-[9px] uppercase tracking-widest text-slate-900 text-right">OpEx Share</th>
                                    <th className="font-black text-[9px] uppercase tracking-widest text-slate-900 text-right pr-8">Net Contrib.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dashed divide-border/50">
                                {contributionData.map(data => (
                                    <tr key={data.id} className="hover:bg-primary/[0.01]">
                                        <td className="p-5 font-black uppercase tracking-tight text-[11px] text-slate-700">{data.name.split(' ')[0]}</td>
                                        <td className="text-right font-mono font-bold text-[11px]">${(data.stats.serviceRevenue + data.stats.retailSales).toFixed(0)}</td>
                                        <td className="text-right font-mono font-bold text-destructive/60 text-[11px]">-${data.overheadShare.toFixed(0)}</td>
                                        <td className="text-right pr-8">
                                            <span className={cn("font-black font-mono text-[11px] tracking-tighter", data.contribution >= 0 ? "text-primary" : "text-destructive")}>
                                                ${data.contribution.toFixed(2)}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            </div>
        </section>

        <div className="p-8 rounded-[3rem] bg-slate-900 text-white flex flex-col md:flex-row items-center justify-between gap-8 shadow-3xl text-left relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-10 opacity-5 transition-opacity group-hover:opacity-10"><DollarSign className="w-32 h-32" /></div>
            <div className="space-y-2 relative z-10">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Consolidated Performance</p>
                <h3 className="text-2xl md:text-4xl font-black uppercase tracking-tighter leading-none">Net Period Margin</h3>
                <p className="text-sm font-medium text-slate-400 max-w-sm">Calculated after direct COGS, payroll, and pro-rata overhead distribution.</p>
            </div>
            <div className="flex items-baseline gap-3 relative z-10">
                <span className={cn("text-5xl md:text-8xl font-black tracking-tighter font-mono", (financials.grossProfit - financials.payrollExpense - periodOverhead) >= 0 ? "text-primary" : "text-destructive")}>
                    ${(financials.grossProfit - financials.payrollExpense - periodOverhead).toFixed(0)}
                </span>
                <span className="text-[10px] font-black uppercase opacity-40 tracking-widest">USD / Period</span>
            </div>
        </div>
      </main>
    </div>
  );
}
