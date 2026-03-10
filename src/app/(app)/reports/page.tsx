
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
  Scale,
  Receipt,
  FileX,
  Star,
  Calculator,
  Gavel,
  History,
  Box,
  Coins
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
                {trend !== undefined && (
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
    if (!staff || !appointments || !services || !transactions || !activityLogs) return { performance: [], overall: {} as any, absorbedLedger: [], taxSummary: {} as any };
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    const filterByDate = (date: any) => {
        const d = safeDate(date);
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
    }

    let totalCOGS = 0;
    let totalSpoilage = 0;
    let totalHardwareDepreciation = 0;

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
        totalCOGS += costOfGoodsSold;

        const clientsServed = new Set(completedAppointments.map(a => a.clientId));
        let rebookedCount = 0;
        if (toDate) {
            clientsServed.forEach(cId => {
                const future = appointments.some(a => a.clientId === cId && safeDate(a.startTime) > toDate && a.status !== 'cancelled');
                if (future) rebookedCount++;
            });
        }
        const rebookingRate = clientsServed.size > 0 ? (rebookedCount / clientsServed.size) * 100 : 0;

        const absorbedRevenue = staffTransactions
            .filter(t => t.category === 'Discounts')
            .reduce((acc, t) => acc + t.amount, 0);

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
                wages,
                retailCommission,
                totalPay,
                tips,
                costOfGoodsSold,
                rebookingRate,
                totalHours: totalHoursWorked,
                absorbedRevenue
            }
        };
    });

    const periodAppointments = appointments.filter(a => filterByDate(a.startTime));
    const cancelledApts = periodAppointments.filter(a => a.status === 'cancelled');
    
    const potentialRevenueLost = cancelledApts.reduce((acc, a) => {
        const svc = services.find(s => s.id === a.serviceId);
        return acc + (svc?.price || 0);
    }, 0);

    const recoveredFees = transactions
        .filter(t => t.category === 'Cancellation Fee' && filterByDate(t.date))
        .reduce((acc, t) => acc + t.amount, 0);

    const absorbedLedger = periodAppointments
        .filter(a => a.cancellationFeeWaived === true)
        .map(a => ({
            id: a.id,
            date: a.waivedAt || a.startTime,
            clientName: a.clientName || clients.find(c => c.id === a.clientId)?.name || 'Guest',
            authorizer: staff.find(s => s.id === a.waivedBy)?.name || 'Admin',
            amount: a.cancellationFeeApplied || 0,
            reason: a.waivedReason || 'Policy Exception',
            staffId: a.waivedBy
        }))
        .sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime());

    const totalRevenue = performance.reduce((acc, d) => acc + d.stats.serviceRevenue + d.stats.retailSales, 0);
    
    const avgTicket = periodAppointments.filter(a => a.status === 'completed').length > 0
        ? totalRevenue / periodAppointments.filter(a => a.status === 'completed').length
        : 0;

    // Tax Strategy Metrics
    const spoilageTransactions = transactions.filter(t => t.category === 'Spoilage' && filterByDate(t.date));
    totalSpoilage = spoilageTransactions.reduce((acc, t) => acc + t.amount, 0);

    const equipmentItems = inventory.filter(i => i.type === 'equipment');
    totalHardwareDepreciation = equipmentItems.reduce((acc, item) => {
        if (!item.lifespanYears || item.lifespanYears === 0) return acc;
        const annualDepreciation = (item.costPerUnit || 0) / item.lifespanYears;
        const dailyDepreciation = annualDepreciation / 365;
        const daysInPeriod = fromDate && toDate ? Math.max(1, differenceInDays(toDate, fromDate)) : 30;
        return acc + (dailyDepreciation * daysInPeriod);
    }, 0);

    const suppliesInvestment = transactions
        .filter(t => t.category === 'Supplies' && filterByDate(t.date))
        .reduce((acc, t) => acc + t.amount, 0);

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
        },
        absorbedLedger,
        taxSummary: {
            deductibleCOGS: totalCOGS,
            spoilageLoss: totalSpoilage,
            hardwareDepreciation: totalHardwareDepreciation,
            suppliesInvestment,
            totalTaxImpact: totalCOGS + totalSpoilage + totalHardwareDepreciation + suppliesInvestment
        }
    };
  }, [staff, appointments, services, transactions, activityLogs, dateRange, clients, inventory]);

  const { performance, overall, absorbedLedger, taxSummary } = analyticsData;

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
        
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-left">
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
            <KpiStat label="Fixed Overhead" value={`$${periodOverhead.toFixed(0)}`} subLabel="Rent & Recurring load" icon={Landmark} colorClass="text-indigo-600" />
        </div>

        <section className="space-y-6">
            <div className="flex items-center gap-2 px-1 text-left">
                <ShieldCheck className="w-4 h-4 text-green-600" />
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Tax Strategy & Audit Basis</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                <Card className="border-2 rounded-[2rem] bg-white overflow-hidden shadow-sm text-left">
                    <CardHeader className="p-6 pb-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Formula (COGS)</p>
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                        <p className="text-2xl font-black font-mono tracking-tighter text-slate-900">${taxSummary.deductibleCOGS.toFixed(2)}</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1 opacity-40">Direct materials used</p>
                    </CardContent>
                </Card>
                <Card className="border-2 rounded-[2rem] bg-white overflow-hidden shadow-sm text-left">
                    <CardHeader className="p-6 pb-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Purchases (Outlay)</p>
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                        <p className="text-2xl font-black font-mono tracking-tighter text-slate-900">${taxSummary.suppliesInvestment.toFixed(2)}</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1 opacity-40">Period supply spend</p>
                    </CardContent>
                </Card>
                <Card className="border-2 rounded-[2rem] bg-white overflow-hidden shadow-sm text-left">
                    <CardHeader className="p-6 pb-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Depreciation</p>
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                        <p className="text-2xl font-black font-mono tracking-tighter text-slate-900">${taxSummary.hardwareDepreciation.toFixed(2)}</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1 opacity-40">Asset life loss</p>
                    </CardContent>
                </Card>
                <Card className="border-2 rounded-[2rem] bg-white overflow-hidden shadow-sm text-left">
                    <CardHeader className="p-6 pb-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Shrinkage</p>
                    </CardHeader>
                    <CardContent className="p-6 pt-0 text-left">
                        <p className="text-2xl font-black font-mono tracking-tighter text-destructive">${taxSummary.spoilageLoss.toFixed(2)}</p>
                        <p className="text-[10px] font-bold text-destructive/60 uppercase mt-1">Spoilage/Loss</p>
                    </CardContent>
                </Card>
                <Card className="border-4 border-green-500/20 bg-green-500/5 rounded-[2rem] overflow-hidden shadow-xl shadow-green-500/5 text-left">
                    <CardHeader className="p-6 pb-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-green-700">Schedule C Total</p>
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                        <p className="text-3xl font-black font-mono tracking-tighter text-green-600">${taxSummary.totalTaxImpact.toFixed(2)}</p>
                        <p className="text-[10px] font-bold text-green-700/60 uppercase mt-1">Total Deductions</p>
                    </CardContent>
                </Card>
            </div>
            <div className="p-6 rounded-3xl border-2 border-dashed bg-muted/10 flex items-start gap-4">
                <Gavel className="w-6 h-6 text-primary shrink-0 mt-1 opacity-40" />
                <div className="space-y-1 text-left">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-900">Tax Protocol Guidance</p>
                    <p className="text-[11px] font-medium text-slate-600 leading-relaxed uppercase tracking-tight">
                        Tracking supply usage via service formulas creates a precise audit trail for Cost of Goods Sold. Money spent on initial and recurring inventory is captured in "Purchases (Outlay)" based on your logged Purchase Orders. Spoilage write-offs and hardware depreciation further increase your deductible basis, reducing your taxable net yield.
                    </p>
                </div>
            </div>
        </section>

        <section className="space-y-6">
            <div className="flex items-center gap-2 px-1 text-left">
                <Zap className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Performance Scorecards</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {performance.map(data => (
                    <Card key={data.id} className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white hover:border-primary/20 transition-all group">
                        <CardHeader className="bg-muted/5 border-b p-6 flex flex-row items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10 border-2 border-white shadow-md rounded-xl">
                                    <AvatarImage src={data.avatarUrl} className="object-cover" />
                                    <AvatarFallback className="font-black bg-primary/10 text-primary">{(data.name || 'S')[0]}</AvatarFallback>
                                </Avatar>
                                <div className="text-left">
                                    <CardTitle className="text-sm font-black uppercase tracking-tight">{data.name}</CardTitle>
                                    <CardDescription className="text-[8px] font-bold uppercase tracking-widest">{data.role}</CardDescription>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-[10px] font-black text-primary tracking-tighter">${data.stats.yieldPerHour.toFixed(0)}/hr</p>
                                <p className="text-[7px] font-bold uppercase opacity-40">Yield Density</p>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6 grid grid-cols-2 gap-4">
                            <div className="space-y-1 text-left p-3 rounded-xl bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all">
                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Utilization</p>
                                <p className="text-lg font-black font-mono tracking-tighter">{data.stats.utilizationRate.toFixed(1)}%</p>
                            </div>
                            <div className="space-y-1 text-left p-3 rounded-xl bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all">
                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Rebooking</p>
                                <p className="text-lg font-black font-mono tracking-tighter">{data.stats.rebookingRate.toFixed(0)}%</p>
                            </div>
                            <div className="space-y-1 text-left p-3 rounded-xl bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all">
                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Retail Attach</p>
                                <p className="text-lg font-black font-mono tracking-tighter">{data.stats.retailAttachmentRate.toFixed(0)}%</p>
                            </div>
                            <div className="space-y-1 text-left p-3 rounded-xl bg-primary/5 border-2 border-primary/10 transition-all">
                                <p className="text-[8px] font-black uppercase text-primary tracking-widest">Protocol Abs.</p>
                                <p className="text-lg font-black font-mono tracking-tighter text-primary">-${data.stats.absorbedRevenue.toFixed(0)}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </section>

        <section className="space-y-6">
            <div className="flex items-center gap-2 px-1 text-left">
                <Users className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Comprehensive Payroll Ledger</h3>
            </div>
            <Card className="border-2 shadow-2xl rounded-[2.5rem] overflow-hidden bg-white">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/10 border-b-2">
                                <tr>
                                    <th className="p-6 font-black text-[10px] uppercase tracking-widest text-slate-900">Provider</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-right">Base Wages</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-right">Ret. Comm.</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-right">Gratuity</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-right">B.B. Fees</th>
                                    <th className="font-black text-[10px] uppercase tracking-widest text-primary text-right pr-10">Final Payout</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y-2 divide-dashed divide-border/50">
                                {performance.map(data => (
                                    <tr key={data.id} className="group hover:bg-primary/[0.02] transition-colors">
                                        <td className="p-6">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-10 w-10 border-2 border-background shadow-md rounded-xl shrink-0">
                                                    <AvatarImage src={data.avatarUrl} className="object-cover" />
                                                    <AvatarFallback className="font-black text-[10px] bg-primary/10 text-primary uppercase">{data.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="min-w-0">
                                                    <p className="font-black uppercase tracking-tight text-xs text-slate-900 truncate">{data.name}</p>
                                                    <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Payout Basis: {data.payStructure}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="text-right font-bold text-xs font-mono text-slate-600">${data.stats.wages.toFixed(2)}</td>
                                        <td className="text-right font-bold text-xs font-mono text-slate-600">${data.stats.retailCommission.toFixed(2)}</td>
                                        <td className="text-right font-bold text-xs font-mono text-green-600">+${data.stats.tips.toFixed(2)}</td>
                                        <td className="text-right font-bold text-xs font-mono text-destructive">-${data.stats.costOfGoodsSold.toFixed(2)}</td>
                                        <td className="text-right pr-10">
                                            <span className="font-black font-mono text-lg tracking-tighter text-primary">
                                                ${data.stats.totalPay.toFixed(2)}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-muted/5 border-t-2 font-black uppercase text-[10px]">
                                <tr>
                                    <td className="p-6">Registry Totals</td>
                                    <td className="text-right font-mono">${performance.reduce((acc, d) => acc + d.stats.wages, 0).toFixed(2)}</td>
                                    <td className="text-right font-mono">${performance.reduce((acc, d) => acc + d.stats.retailCommission, 0).toFixed(2)}</td>
                                    <td className="text-right font-mono text-green-600">${performance.reduce((acc, d) => acc + d.stats.tips, 0).toFixed(2)}</td>
                                    <td className="text-right font-mono text-destructive">-${performance.reduce((acc, d) => acc + d.stats.costOfGoodsSold, 0).toFixed(2)}</td>
                                    <td className="text-right pr-10 font-mono text-xl text-primary">${performance.reduce((acc, d) => acc + d.stats.totalPay, 0).toFixed(2)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </section>

        <section className="grid lg:grid-cols-2 gap-10">
            <div className="space-y-6">
                <div className="flex items-center gap-2 px-1 text-left">
                    <ShieldAlert className="w-4 h-4 text-destructive" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Absorption Audit (Fee Waivers)</h3>
                </div>
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-muted/10 border-b-2">
                                    <tr>
                                        <th className="p-4 font-black text-[9px] uppercase tracking-widest text-slate-900">Guest</th>
                                        <th className="font-black text-[9px] uppercase tracking-widest text-slate-900">Authorized By</th>
                                        <th className="font-black text-[9px] uppercase tracking-widest text-slate-900">Reason</th>
                                        <th className="text-right font-black text-[9px] uppercase tracking-widest text-destructive pr-6">Value Abs.</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-dashed">
                                    {absorbedLedger.length > 0 ? absorbedLedger.map(entry => (
                                        <tr key={entry.id} className="hover:bg-destructive/[0.01]">
                                            <td className="p-4 text-left">
                                                <p className="font-bold uppercase text-[10px] text-slate-900">{entry.clientName}</p>
                                                <p className="text-[8px] font-black text-muted-foreground uppercase opacity-40">{format(safeDate(entry.date), 'MMM d, p')}</p>
                                            </td>
                                            <td className="text-[10px] font-black uppercase text-primary text-left">{entry.authorizer}</td>
                                            <td className="text-[10px] font-medium text-slate-500 uppercase truncate max-w-[120px] text-left">{entry.reason}</td>
                                            <td className="text-right pr-6 font-black font-mono text-destructive">-${entry.amount.toFixed(2)}</td>
                                        </tr>
                                    )) : (
                                        <tr><td colSpan={4} className="p-12 text-center text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">No fees absorbed in this period</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="space-y-6">
                <div className="flex items-center gap-2 px-1 text-left">
                    <Activity className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">True Studio Contribution</h3>
                </div>
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-muted/10 border-b-2">
                                    <tr>
                                        <th className="p-4 font-black text-[9px] uppercase tracking-widest text-slate-900">Provider</th>
                                        <th className="text-right font-black text-[9px] uppercase tracking-widest text-slate-900">Material Cost</th>
                                        <th className="text-right font-black text-[9px] uppercase tracking-widest text-slate-900">Shared Fixed</th>
                                        <th className="text-right font-black text-[9px] uppercase tracking-widest text-primary pr-6">Net Profit</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-dashed">
                                    {contributionData.map(data => (
                                        <tr key={data.id}>
                                            <td className="p-4 font-black uppercase text-[10px] text-slate-900 text-left">{data.name.split(' ')[0]}</td>
                                            <td className="text-right font-mono text-[10px] text-destructive">-${data.stats.costOfGoodsSold.toFixed(0)}</td>
                                            <td className="text-right font-mono text-[10px] text-destructive">-${data.overheadShare.toFixed(0)}</td>
                                            <td className="text-right pr-6 font-black font-mono text-primary">${data.contribution.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            </div>
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
