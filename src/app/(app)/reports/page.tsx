
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
  Coins,
  Building,
  Monitor,
  Plane,
  PlusCircle,
  FileText,
  ListChecks,
  Sparkles
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
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
    activityLogs,
    transactions,
    clients,
    billInstances,
    businessProfiles,
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

  const effectiveFrom = useMemo(() => dateRange?.from ? startOfDay(dateRange.from) : startOfMonth(new Date()), [dateRange]);
  const effectiveTo = useMemo(() => dateRange?.to ? endOfDay(dateRange.to) : endOfMonth(new Date()), [dateRange]);

  const analyticsData = useMemo(() => {
    if (!staff || !appointments || !services || !transactions || !activityLogs) return { performance: [], overall: {} as any, absorbedLedger: [], taxSummary: {} as any, reconciliation: [] };
    
    const filterByDate = (date: any) => {
        const d = safeDate(date);
        if (effectiveFrom && d < effectiveFrom) return false;
        if (effectiveTo && d > effectiveTo) return false;
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
        if(clockInTime) {
            const endOfRange = effectiveTo && effectiveTo < new Date() ? effectiveTo : new Date();
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
        if (effectiveTo) {
            clientsServed.forEach(cId => {
                const future = appointments.some(a => a.clientId === cId && safeDate(a.startTime) > effectiveTo && a.status !== 'cancelled');
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
                absorbedRevenue,
                totalSales: serviceRevenue + retailSales
            }
        };
    });

    // --- SMART RECONCILIATION LOGIC ---
    const activeBusinessProfile = (businessProfiles || []).find((p: any) => p.isActive);
    const reconciliationCategories = [
        { label: 'Facility & Rent', icon: Building, color: 'text-blue-600', match: ['rent', 'facility', 'lease', 'mortgage', 'housing'] },
        { label: 'Utilities', icon: Receipt, color: 'text-amber-600', match: ['electric', 'water', 'gas', 'waste', 'internet', 'phone'] },
        { label: 'Systems & Software', icon: Monitor, color: 'text-purple-600', match: ['software', 'subscription', 'booking', 'marketing', 'domain'] },
        { label: 'Travel & Per Diem', icon: Plane, color: 'text-teal-600', match: ['travel', 'flight', 'lodging', 'mileage', 'hotel', 'taxi'] },
    ];

    const daysInPeriod = differenceInDays(effectiveTo, effectiveFrom) + 1;
    const proRataFactor = daysInPeriod / 30.44;

    const reconciliation = reconciliationCategories.map(cat => {
        const foundationItems = (activeBusinessProfile?.categories || [])
            .find((c: any) => cat.match.some(m => c.name.toLowerCase().includes(m)))?.bills || [];
        
        const targetAmount = foundationItems.reduce((acc: number, b: any) => acc + (b.amount * proRataFactor), 0);
        
        const settledAmount = transactions
            .filter(t => t.type === 'payment' && t.context === 'Business' && cat.match.some(m => t.category.toLowerCase().includes(m)) && filterByDate(t.date))
            .reduce((acc, t) => acc + t.amount, 0);

        return {
            ...cat,
            targetAmount,
            settledAmount,
            gap: Math.max(0, targetAmount - settledAmount),
            reconciledAmount: Math.max(targetAmount, settledAmount),
            foundationItems
        };
    });

    const totalReconciledOpEx = reconciliation.reduce((acc, r) => acc + r.reconciledAmount, 0);

    const periodAppointments = appointments.filter(a => filterByDate(a.startTime));
    const cancelledApts = periodAppointments.filter(a => a.status === 'cancelled');
    const potentialRevenueLost = cancelledApts.reduce((acc, a) => acc + (services.find(s => s.id === a.serviceId)?.price || 0), 0);
    const recoveredFees = transactions.filter(t => t.category === 'Cancellation Fee' && filterByDate(t.date)).reduce((acc, t) => acc + t.amount, 0);

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
    const avgTicket = periodAppointments.filter(a => a.status === 'completed').length > 0 ? totalRevenue / periodAppointments.filter(a => a.status === 'completed').length : 0;

    const spoilageTransactions = transactions.filter(t => t.category === 'Spoilage' && filterByDate(t.date));
    totalSpoilage = spoilageTransactions.reduce((acc, t) => acc + t.amount, 0);

    const equipmentItems = inventory.filter(i => i.type === 'equipment');
    totalHardwareDepreciation = equipmentItems.reduce((acc, item) => {
        if (!item.lifespanYears) return acc;
        return acc + (((item.costPerUnit || 0) / item.lifespanYears / 365) * daysInPeriod);
    }, 0);

    const suppliesInvestment = transactions.filter(t => t.category === 'Supplies' && filterByDate(t.date)).reduce((acc, t) => acc + t.amount, 0);

    return { 
        performance, 
        overall: { 
            totalRevenue, 
            totalCOGS, 
            totalReconciledOpEx,
            netIncome: totalRevenue - totalCOGS - totalReconciledOpEx,
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
        },
        reconciliation
    };
  }, [staff, appointments, services, transactions, activityLogs, inventory, clients, businessProfiles, effectiveFrom, effectiveTo]);

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
            <KpiStat label="Gross Yield" value={`$${analyticsData.overall.totalRevenue.toFixed(0)}`} subLabel="Direct period sales" icon={TrendingUp} colorClass="text-primary" />
            <KpiStat label="Overall Util." value={`${analyticsData.overall.utilization.toFixed(1)}%`} subLabel="Team productivity mean" icon={Target} />
            <KpiStat label="Avg. Ticket" value={`$${analyticsData.overall.avgTicket.toFixed(2)}`} subLabel="Mean spend per visit" icon={Wallet} />
            <KpiStat label="Fixed Overhead" value={`$${analyticsData.overall.totalReconciledOpEx.toFixed(0)}`} subLabel="Reconciled OpEx" icon={Landmark} colorClass="text-indigo-600" />
        </div>

        <section className="space-y-6">
            <div className="flex items-center gap-2 px-1 text-left">
                <Scale className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Certified Profit & Loss Statement</h3>
            </div>
            <Card className="border-4 rounded-[3rem] shadow-3xl bg-white overflow-hidden">
                <CardContent className="p-8 sm:p-12 space-y-10">
                    <div className="space-y-6">
                        <div className="flex justify-between items-baseline border-b-2 border-slate-100 pb-2">
                            <h4 className="font-black uppercase tracking-widest text-[10px] text-muted-foreground">Category</h4>
                            <h4 className="font-black uppercase tracking-widest text-[10px] text-muted-foreground">Yield / (Load)</h4>
                        </div>
                        
                        <div className="space-y-4">
                            <div className="flex justify-between items-center group">
                                <span className="text-sm font-bold uppercase text-slate-600">Gross Operating Revenue</span>
                                <span className="font-black font-mono text-lg text-green-600">${analyticsData.overall.totalRevenue.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center group">
                                <span className="text-sm font-bold uppercase text-slate-600">Cost of Goods Sold (COGS)</span>
                                <span className="font-black font-mono text-lg text-destructive">-${analyticsData.overall.totalCOGS.toFixed(2)}</span>
                            </div>
                            <Separator className="border-dashed" />
                            <div className="flex justify-between items-center group py-2">
                                <span className="text-base font-black uppercase text-slate-900">Gross Profit Margin</span>
                                <span className="font-black font-mono text-xl text-slate-900">${(analyticsData.overall.totalRevenue - analyticsData.overall.totalCOGS).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center group">
                                <span className="text-sm font-bold uppercase text-slate-600">Reconciled OpEx (Overhead)</span>
                                <span className="font-black font-mono text-lg text-destructive">-${analyticsData.overall.totalReconciledOpEx.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="p-10 rounded-[3rem] bg-slate-900 text-white flex flex-col md:flex-row items-center justify-between gap-10 shadow-3xl text-left relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-10 opacity-5 transition-opacity group-hover:opacity-10"><DollarSign className="w-48 h-48" /></div>
                        <div className="space-y-3 relative z-10">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Certified Performance Audit</p>
                            <h3 className="text-3xl md:text-5xl font-black uppercase tracking-tighter leading-[0.9]">Net Period Yield</h3>
                            <p className="text-xs font-medium text-slate-400 max-w-sm uppercase tracking-tight">Mathematically definitive take-home post pro-rata fixed overhead and direct formula costs.</p>
                        </div>
                        <div className="flex items-baseline gap-4 relative z-10">
                            <span className={cn("text-6xl md:text-9xl font-black tracking-tighter font-mono", analyticsData.overall.netIncome >= 0 ? "text-primary" : "text-destructive")}>
                                ${analyticsData.overall.netIncome.toFixed(0)}
                            </span>
                            <span className="text-[10px] font-black uppercase opacity-40 tracking-widest">USD</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </section>

        <section className="space-y-6">
            <div className="flex items-center gap-2 px-1 text-left">
                <Landmark className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Reconciliation Manifest</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {analyticsData.reconciliation.map(cat => (
                    <Card key={cat.label} className="border-2 rounded-[2rem] bg-white overflow-hidden shadow-sm group hover:border-indigo-500/30 transition-all">
                        <CardHeader className="p-6 pb-4 border-b bg-muted/5 flex flex-row items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={cn("p-2 rounded-xl bg-background border shadow-inner", cat.color)}><cat.icon className="w-4 h-4" /></div>
                                <CardTitle className="text-xs font-black uppercase tracking-widest">{cat.label}</CardTitle>
                            </div>
                            <p className="text-[10px] font-black font-mono text-indigo-600">${cat.reconciledAmount.toFixed(2)}</p>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            <div className="space-y-2">
                                {cat.foundationItems.map((b: any, idx: number) => (
                                    <div key={idx} className="flex justify-between text-[10px] font-bold uppercase text-slate-600 px-2 py-1">
                                        <span>{b.title}</span>
                                        <span className="font-mono opacity-60">${((b.amount / 30.44) * (daysInPeriod)).toFixed(2)}</span>
                                    </div>
                                ))}
                                <div className="flex justify-between text-[10px] font-black uppercase bg-primary/5 p-2 rounded-lg mt-2 text-primary">
                                    <span>Foundation Target (Accrual)</span>
                                    <span className="font-mono">${cat.targetAmount.toFixed(2)}</span>
                                </div>
                            </div>
                            <Separator className="border-dashed" />
                            <div className="flex justify-between items-center text-[10px] font-black uppercase">
                                <span className="text-muted-foreground">Ledger Settlements (Actual)</span>
                                <span className="font-mono text-slate-900">${cat.settledAmount.toFixed(2)}</span>
                            </div>
                            {cat.gap > 0 && (
                                <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 flex items-center gap-2">
                                    <Info className="w-3 h-3 text-amber-600" />
                                    <p className="text-[8px] font-bold text-amber-700 uppercase tracking-tight">Gap detected: ${cat.gap.toFixed(2)} added to OpEx to protect yield precision.</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </section>

        <section className="space-y-6">
            <div className="flex items-center gap-2 px-1 text-left">
                <ShieldCheck className="w-4 h-4 text-green-600" />
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Tax Strategy Basis</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 text-left">
                <Card className="border-2 rounded-[2rem] bg-white overflow-hidden shadow-sm">
                    <CardHeader className="p-6 pb-2"><p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Formula (COGS)</p></CardHeader>
                    <CardContent className="p-6 pt-0"><p className="text-2xl font-black font-mono tracking-tighter text-slate-900">${analyticsData.taxSummary.deductibleCOGS.toFixed(2)}</p></CardContent>
                </Card>
                <Card className="border-2 rounded-[2rem] bg-white overflow-hidden shadow-sm">
                    <CardHeader className="p-6 pb-2"><p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Purchases (Outlay)</p></CardHeader>
                    <CardContent className="p-6 pt-0"><p className="text-2xl font-black font-mono tracking-tighter text-slate-900">${analyticsData.taxSummary.suppliesInvestment.toFixed(2)}</p></CardContent>
                </Card>
                <Card className="border-2 rounded-[2rem] bg-white overflow-hidden shadow-sm">
                    <CardHeader className="p-6 pb-2"><p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Depreciation</p></CardHeader>
                    <CardContent className="p-6 pt-0"><p className="text-2xl font-black font-mono tracking-tighter text-slate-900">${analyticsData.taxSummary.hardwareDepreciation.toFixed(2)}</p></CardContent>
                </Card>
                <Card className="border-2 rounded-[2rem] bg-white overflow-hidden shadow-sm">
                    <CardHeader className="p-6 pb-2"><p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Shrinkage</p></CardHeader>
                    <CardContent className="p-6 pt-0"><p className="text-2xl font-black font-mono tracking-tighter text-destructive">${analyticsData.taxSummary.spoilageLoss.toFixed(2)}</p></CardContent>
                </Card>
                <Card className="border-4 border-green-500/20 bg-green-500/5 rounded-[2rem] overflow-hidden shadow-xl shadow-green-500/5">
                    <CardHeader className="p-6 pb-2"><p className="text-[9px] font-black uppercase tracking-widest text-green-700">Audit Total</p></CardHeader>
                    <CardContent className="p-6 pt-0"><p className="text-3xl font-black font-mono tracking-tighter text-green-600">${analyticsData.taxSummary.totalTaxImpact.toFixed(2)}</p></CardContent>
                </Card>
            </div>
        </section>

        <section className="space-y-6">
            <div className="flex items-center gap-2 px-1 text-left">
                <Zap className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Performance Scorecards</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {analyticsData.performance.map(data => (
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
                                <p className="text-lg font-black font-mono tracking-tighter">{(data.stats.utilizationRate || 0).toFixed(1)}%</p>
                            </div>
                            <div className="space-y-1 text-left p-3 rounded-xl bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all">
                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Revenue</p>
                                <p className="text-lg font-black font-mono tracking-tighter">${(data.stats.totalSales || 0).toFixed(0)}</p>
                            </div>
                            <div className="space-y-1 text-left p-3 rounded-xl bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all">
                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Retail Attach</p>
                                <p className="text-lg font-black font-mono tracking-tighter">{(data.stats.retailAttachmentRate || 0).toFixed(0)}%</p>
                            </div>
                            <div className="space-y-1 text-left p-3 rounded-xl bg-primary/5 border-2 border-primary/10 transition-all">
                                <p className="text-[8px] font-black uppercase text-primary tracking-widest">Protocol Abs.</p>
                                <p className="text-lg font-black font-mono tracking-tighter text-primary">-${(data.stats.absorbedRevenue || 0).toFixed(0)}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </section>

        <section className="space-y-6">
            <div className="flex items-center gap-2 px-1 text-left">
                <ShieldAlert className="w-4 h-4 text-destructive" />
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Absorption Audit (Fee Waivers)</h3>
            </div>
            <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-muted/10 border-b-2">
                                <TableRow>
                                    <TableHead className="p-6 font-black text-[9px] uppercase tracking-widest text-slate-900">Guest</TableHead>
                                    <TableHead className="font-black text-[9px] uppercase tracking-widest text-slate-900">Authorized By</TableHead>
                                    <TableHead className="font-black text-[9px] uppercase tracking-widest text-slate-900">Reason</TableHead>
                                    <TableHead className="text-right font-black text-[9px] uppercase tracking-widest text-destructive pr-10">Value Abs.</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {absorbedLedger.length > 0 ? absorbedLedger.map(entry => (
                                    <TableRow key={entry.id} className="hover:bg-destructive/[0.01]">
                                        <TableCell className="p-6 text-left">
                                            <p className="font-bold uppercase text-[10px] text-slate-900">{entry.clientName}</p>
                                            <p className="text-[8px] font-black text-muted-foreground uppercase opacity-40">{format(safeDate(entry.date), 'MMM d, p')}</p>
                                        </TableCell>
                                        <TableCell className="text-[10px] font-black uppercase text-primary text-left">{entry.authorizer}</TableCell>
                                        <TableCell className="text-[10px] font-medium text-slate-500 uppercase truncate max-w-[120px] text-left">{entry.reason}</TableCell>
                                        <TableCell className="text-right pr-10 font-black font-mono text-destructive">-${entry.amount.toFixed(2)}</TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow><TableCell colSpan={4} className="p-12 text-center text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">No fees absorbed in this period</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </section>
      </main>
    </div>
  );
}
