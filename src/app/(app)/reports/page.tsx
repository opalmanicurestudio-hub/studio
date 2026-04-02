'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Printer, DollarSign, TrendingUp, AlertTriangle, Target, Users, Wallet, Clock,
  Calendar as CalendarIcon, ShieldCheck, Loader, Percent, TrendingDown, Repeat,
  Zap, ArrowRight, Info, Landmark, Activity, ShoppingBag, UserPlus, ShieldAlert,
  ArrowUpRight, ChevronRight, Scale, Receipt, FileX, Star, Calculator, Gavel,
  History, Box, Coins, Building, Monitor, Plane, PlusCircle, FileText, ListChecks,
  Sparkles, Globe, Phone, Smartphone, Undo2, HeartHandshake, User
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from '@/components/ui/table';
import { useInventory } from '@/context/InventoryContext';
import {
  format, isPast, parseISO, subDays, startOfDay, endOfDay, differenceInMinutes,
  differenceInDays, startOfMonth, endOfMonth, subMonths, isSameMonth
} from 'date-fns';
import { cn, safeNumber } from '@/lib/utils';
import { type Staff, type Service, type Appointment } from '@/lib/data';
import { DateRange } from 'react-day-picker';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUser, useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import { Separator } from '@/components/ui/separator';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

const KpiStat = ({ label, value, subLabel, icon: Icon, colorClass, trend }: any) => (
    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white/50 backdrop-blur-sm group hover:border-primary/20 transition-all text-left">
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
            <div className="space-y-1">
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

  const { inventory, appointments, services, staff, activityLogs, transactions, clients, billInstances, businessProfiles, isLoading } = useInventory();

  useEffect(() => {
    const now = new Date();
    switch (periodPreset) {
        case 'today': setDateRange({ from: startOfDay(now), to: endOfDay(now) }); break;
        case '7days': setDateRange({ from: startOfDay(subDays(now, 6)), to: endOfDay(now) }); break;
        case '30days': setDateRange({ from: startOfDay(subDays(now, 29)), to: endOfDay(now) }); break;
        case 'thisMonth': setDateRange({ from: startOfMonth(now), to: endOfMonth(now) }); break;
        case 'lastMonth': { const lm = subMonths(now, 1); setDateRange({ from: startOfMonth(lm), to: endOfMonth(lm) }); break; }
        case 'custom': break;
    }
  }, [periodPreset]);

  const effectiveFrom = useMemo(() => dateRange?.from ? startOfDay(dateRange.from) : startOfMonth(new Date()), [dateRange]);
  const effectiveTo = useMemo(() => dateRange?.to ? endOfDay(dateRange.to) : endOfMonth(new Date()), [dateRange]);

  const analyticsData = useMemo(() => {
    if (!staff || !appointments || !services || !transactions || !activityLogs || !selectedTenant)
      return { performance: [], overall: {} as any, absorbedLedger: [], recoveryLedger: [], reconciliation: [], channelStats: [] };

    const filterByDate = (date: any) => {
        const d = safeDate(date);
        if (effectiveFrom && d < effectiveFrom) return false;
        if (effectiveTo && d > effectiveTo) return false;
        return true;
    };

    const taxBurden = selectedTenant.employerTaxBurdenPct || 10;
    const tmhr = selectedTenant.tmhr || 50;

    const performance = staff.map(staffMember => {
        const staffAppointments = appointments.filter(apt => apt.staffId === staffMember.id && filterByDate(apt.startTime));
        const completedAppointments = staffAppointments.filter(apt => apt.status === 'completed');
        const completedCount = completedAppointments.length;
        let totalMinutesVariance = 0, totalInServiceMinutes = 0, totalMaterialCost = 0;

        completedAppointments.forEach(apt => {
            const service = services.find(s => s.id === apt.serviceId);
            if (service) {
                const formula = apt.checkoutState?.formula || service.products || [];
                formula.forEach((p: any) => {
                    const item = inventory.find(i => i.id === p.id);
                    if (item) {
                        let cpu = item.costPerUnit || 0;
                        if (item.costingMethod === 'size' && item.size) cpu = cpu / item.size;
                        else if (item.costingMethod === 'uses' && item.estimatedUses) cpu = cpu / item.estimatedUses;
                        totalMaterialCost += (p.quantityUsed || p.quantity || 1) * cpu;
                    }
                });
                if (apt.actualStartTime && apt.actualEndTime) {
                    const actualDuration = differenceInMinutes(safeDate(apt.actualEndTime), safeDate(apt.actualStartTime));
                    totalMinutesVariance += actualDuration - service.duration;
                    totalInServiceMinutes += actualDuration;
                } else { totalInServiceMinutes += service.duration; }
            }
        });

        const staffTransactions = transactions.filter(t => t.staffId === staffMember.id && filterByDate(t.date));
        const serviceRevenue = staffTransactions.filter(t => t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0);
        const retailSales = staffTransactions.filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
        const tips = staffTransactions.reduce((acc, t) => acc + (t.tipAmount || (t.category === 'Tips' ? t.amount : 0)), 0);

        let totalMinutesWorked = 0;
        const staffLogs = activityLogs.filter(log => log.staffId === staffMember.id && filterByDate(log.timestamp));
        const sortedLogs = staffLogs.sort((a, b) => safeDate(a.timestamp).getTime() - safeDate(b.timestamp).getTime());
        let clockInTime: Date | null = null;
        let totalBreakMinutes = 0;
        for (const log of sortedLogs) {
            const logTime = safeDate(log.timestamp);
            if (log.type === 'clock_in') {
                if (clockInTime) totalMinutesWorked += Math.max(0, differenceInMinutes(logTime, clockInTime) - totalBreakMinutes);
                clockInTime = logTime; totalBreakMinutes = 0;
            } else if (log.type === 'clock_out' && clockInTime) {
                totalMinutesWorked += Math.max(0, differenceInMinutes(logTime, clockInTime) - totalBreakMinutes);
                clockInTime = null;
            } else if (log.type === 'break_end' && log.durationMinutes) {
                totalBreakMinutes += log.durationMinutes;
            }
        }
        if (clockInTime) {
            const endOfRange = effectiveTo && effectiveTo < new Date() ? effectiveTo : new Date();
            totalMinutesWorked += Math.max(0, differenceInMinutes(endOfRange, clockInTime) - totalBreakMinutes);
        }

        const totalHoursWorked = totalMinutesWorked / 60;
        const utilizationRate = totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0;
        const yieldPerHour = totalHoursWorked > 0 ? (serviceRevenue + retailSales) / totalHoursWorked : 0;

        let wages = 0;
        if (staffMember.payStructure === 'commission') wages = serviceRevenue * ((staffMember.commissionRate || 0) / 100);
        else if (staffMember.payStructure === 'hourly' && staffMember.hourlyRate) wages = totalHoursWorked * staffMember.hourlyRate;
        else if (staffMember.payStructure === 'hourly_plus_commission' && staffMember.hourlyRate) wages = (totalHoursWorked * staffMember.hourlyRate) + (serviceRevenue * ((staffMember.commissionRate || 0) / 100));
        const retailCommission = retailSales * ((staffMember.retailCommissionRate || 0) / 100);
        const laborBase = wages + retailCommission;
        const laborBurden = laborBase * (1 + (taxBurden / 100));
        const timeFloorOverhead = (totalInServiceMinutes / 60) * tmhr;

        return {
            ...staffMember,
            stats: { totalServices: completedCount, totalInServiceHours: totalInServiceMinutes / 60, utilizationRate, yieldPerHour, serviceRevenue, retailSales, laborBurden, tips, totalMaterialCost, timeFloorOverhead, netContribution: serviceRevenue + retailSales - totalMaterialCost - timeFloorOverhead - laborBurden, totalSales: serviceRevenue + retailSales }
        };
    });

    const periodAppointments = appointments.filter(a => filterByDate(a.startTime));
    const channelStats = [
        { id: 'online', label: 'Online Booking', icon: Globe, color: 'text-primary' },
        { id: 'manual', label: 'Manual / Phone', icon: Phone, color: 'text-indigo-600' },
        { id: 'walk-in', label: 'Walk-in Kiosk', icon: Users, color: 'text-teal-600' },
    ].map(channel => {
        const matchingApts = periodAppointments.filter(a => (a.source === channel.id || (channel.id === 'walk-in' && a.isWalkIn)));
        const count = matchingApts.length;
        const revenue = matchingApts.reduce((acc, a) => { const svc = services.find(s => s.id === a.serviceId); return acc + (a.revenue || svc?.price || 0); }, 0);
        return { ...channel, count, revenue, percentage: periodAppointments.length > 0 ? (count / periodAppointments.length) * 100 : 0 };
    });

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
        const foundationItems = (activeBusinessProfile?.categories || []).find((c: any) => cat.match.some(m => c.name.toLowerCase().includes(m)))?.bills || [];
        const targetAmount = foundationItems.reduce((acc: number, b: any) => acc + (b.amount * proRataFactor), 0);
        const settledAmount = transactions.filter(t => t.type === 'payment' && t.context === 'Business' && cat.match.some(m => t.category.toLowerCase().includes(m)) && filterByDate(t.date)).reduce((acc, t) => acc + t.amount, 0);
        return { ...cat, targetAmount, settledAmount, gap: Math.max(0, targetAmount - settledAmount), reconciledAmount: Math.max(targetAmount, settledAmount), foundationItems };
    });

    const totalReconciledOpEx = reconciliation.reduce((acc, r) => acc + r.reconciledAmount, 0);
    const totalLaborLoad = performance.reduce((acc, d) => acc + d.stats.laborBurden, 0);
    const totalMaterials = performance.reduce((acc, d) => acc + d.stats.totalMaterialCost, 0);
    const totalGrossRevenue = performance.reduce((acc, d) => acc + d.stats.totalSales, 0);

    const absorbedLedger = periodAppointments
        .filter(a => a.cancellationFeeWaived === true)
        .map(a => ({
            id: a.id, date: a.waivedAt || a.startTime,
            clientName: a.clientName || clients.find(c => c.id === a.clientId)?.name || 'Guest',
            authorizer: staff.find(s => s.id === a.waivedBy)?.name || 'Admin',
            amount: a.cancellationFeeApplied || 0,
            reason: a.waivedReason || 'Policy Exception',
        }))
        .sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime());

    // Recovery ledger -- include authorizing staff member
    const recoveryLedger = transactions
        .filter(t => t.type === 'expense' && t.category === 'Discounts' && t.description.toLowerCase().includes('recovery') && filterByDate(t.date))
        .map(t => ({
            id: t.id, date: t.date,
            clientName: t.clientOrVendor,
            amount: t.amount,
            reason: t.notes || 'Service Recovery Adjustment',
            authorizedBy: staff.find(s => s.id === t.staffId)?.name || (t.staffId ? 'Staff' : 'System'),
            staffId: t.staffId,
        }))
        .sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime());

    const totalRecoveryLoss = recoveryLedger.reduce((sum, r) => sum + r.amount, 0);

    return {
        performance, channelStats, reconciliation, absorbedLedger, recoveryLedger,
        overall: { totalRevenue: totalGrossRevenue, totalCOGS: totalMaterials, totalLaborLoad, totalReconciledOpEx, totalRecoveryLoss, netIncome: totalGrossRevenue - totalMaterials - totalReconciledOpEx - totalLaborLoad - totalRecoveryLoss, utilization: performance.length > 0 ? performance.reduce((acc, d) => acc + d.stats.utilizationRate, 0) / performance.length : 0 }
    };
  }, [staff, appointments, services, transactions, activityLogs, inventory, clients, businessProfiles, effectiveFrom, effectiveTo, selectedTenant]);

  if (isLoading) return <div className="h-screen flex flex-col items-center justify-center gap-4"><Loader className="animate-spin text-primary h-10 w-10" /><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground animate-pulse">Synthesizing Dossier...</p></div>;

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50 overflow-x-hidden">
      <AppHeader title="Intelligence Dossier" />
      <main className="relative z-10 flex-1 p-4 md:p-10 space-y-10 w-full max-w-7xl mx-auto min-w-0">

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Studio Pulse</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Strategic Performance Audit</p>
          </div>
          <Button variant="outline" className="h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-sm bg-white/50" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Export Report
          </Button>
        </div>

        {/* Period selector */}
        <div className="p-6 rounded-[2.5rem] bg-muted/30 border-2 border-dashed border-border/50">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="flex-1 w-full space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">Analyze Period</Label>
              <Select value={periodPreset} onValueChange={setPeriodPreset}>
                <SelectTrigger className="h-14 rounded-2xl border-2 bg-white font-black uppercase text-[10px] tracking-widest shadow-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
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
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">Start Date</Label>
                  <input type="date" value={dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : ''} onChange={(e) => { const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined; setDateRange(prev => ({ from: d || prev?.from, to: prev?.to })); }} className="w-full h-14 rounded-2xl border-2 bg-white px-4 font-bold text-sm outline-none" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">End Date</Label>
                  <input type="date" value={dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : ''} onChange={(e) => { const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined; setDateRange(prev => ({ from: prev?.from, to: d || prev?.to })); }} className="w-full h-14 rounded-2xl border-2 bg-white px-4 font-bold text-sm outline-none" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 md:gap-6 w-full">
          <KpiStat label="Gross Yield" value={`$${analyticsData.overall.totalRevenue?.toFixed(0) || 0}`} subLabel="Direct period sales" icon={TrendingUp} colorClass="text-primary" />
          <KpiStat label="Overall Util." value={`${analyticsData.overall.utilization?.toFixed(1) || 0}%`} subLabel="Team productivity mean" icon={Target} />
          <KpiStat label="Labor Load" value={`$${analyticsData.overall.totalLaborLoad?.toFixed(0) || 0}`} subLabel="Payroll + Tax Burden" icon={Users} colorClass="text-amber-600" />
          <KpiStat label="Fixed Overhead" value={`$${analyticsData.overall.totalReconciledOpEx?.toFixed(0) || 0}`} subLabel="Reconciled OpEx" icon={Landmark} colorClass="text-indigo-600" />
        </div>

        {/* Acquisition matrix */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Acquisition Matrix</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {analyticsData.channelStats.map(channel => (
              <Card key={channel.id} className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white hover:border-primary/20 transition-all group">
                <CardHeader className="p-6 pb-2 border-b bg-muted/5">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2.5 rounded-xl bg-background border shadow-inner", channel.color)}><channel.icon className="w-5 h-5" /></div>
                      <div>
                        <CardTitle className="text-sm font-black uppercase tracking-tight">{channel.label}</CardTitle>
                        <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest opacity-60">Acquisition Channel</p>
                      </div>
                    </div>
                    <Badge className="bg-primary text-white border-none font-black font-mono text-[10px]">{channel.percentage.toFixed(0)}%</Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-6 pt-4 grid grid-cols-2 gap-4">
                  <div className="space-y-1 p-3 rounded-xl bg-muted/20 border shadow-inner">
                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Volume</p>
                    <p className="text-lg font-black font-mono tracking-tighter text-slate-900">{channel.count} <span className="text-[8px]">Sessions</span></p>
                  </div>
                  <div className="space-y-1 text-right p-3 rounded-xl bg-primary/5 border border-primary/10">
                    <p className="text-[8px] font-black uppercase text-primary tracking-widest text-right">Yield</p>
                    <p className="text-lg font-black font-mono tracking-tighter text-primary text-right">${channel.revenue.toFixed(0)}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* P&L Statement -- mobile-optimised */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <Scale className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Certified Profit & Loss Statement</h3>
          </div>
          <Card className="border-4 rounded-[3rem] shadow-2xl bg-white overflow-hidden">
            <CardContent className="p-5 sm:p-8 md:p-12 space-y-8">
              {/* Line items */}
              <div className="space-y-5">
                <div className="flex justify-between items-center border-b-2 border-slate-100 pb-3">
                  <h4 className="font-black uppercase tracking-widest text-[10px] text-muted-foreground">Category</h4>
                  <h4 className="font-black uppercase tracking-widest text-[10px] text-muted-foreground">Amount</h4>
                </div>
                {[
                  { label: 'Gross Operating Revenue', value: analyticsData.overall.totalRevenue, positive: true },
                  { label: 'Cost of Goods Sold', value: -analyticsData.overall.totalCOGS, positive: false },
                  { label: 'Reconciled OpEx', value: -analyticsData.overall.totalReconciledOpEx, positive: false },
                  { label: 'Total Labor Burden', value: -analyticsData.overall.totalLaborLoad, positive: false },
                  ...(analyticsData.overall.totalRecoveryLoss > 0 ? [{ label: 'Service Recovery (Comped)', value: -analyticsData.overall.totalRecoveryLoss, positive: false, amber: true }] : []),
                ].map((row: any, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <span className={cn("text-xs sm:text-sm font-bold uppercase leading-tight pr-4", row.amber ? "text-amber-600" : "text-slate-600")}>{row.label}</span>
                    <span className={cn("font-black font-mono text-base sm:text-lg shrink-0", row.positive ? "text-green-600" : row.amber ? "text-amber-600" : "text-destructive")}>
                      {row.positive ? '+' : ''}{(row.value || 0) < 0 ? '-' : ''}${Math.abs(row.value || 0).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Net yield -- mobile-friendly dark box */}
              <div className="rounded-[2rem] sm:rounded-[3rem] bg-slate-900 text-white overflow-hidden relative">
                <div className="absolute inset-0 opacity-5 flex items-center justify-end p-8"><DollarSign className="w-40 h-40" /></div>
                <div className="relative z-10 p-6 sm:p-10 flex flex-col gap-6">
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Certified Performance Audit</p>
                    <h3 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter leading-none">Net Period Yield</h3>
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-tight max-w-sm">Studio cash remaining post burdened labor, overhead, and direct material costs.</p>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className={cn("text-5xl sm:text-7xl md:text-9xl font-black tracking-tighter font-mono", (analyticsData.overall.netIncome || 0) >= 0 ? "text-primary" : "text-destructive")}>
                      ${(analyticsData.overall.netIncome || 0).toFixed(0)}
                    </span>
                    <span className="text-[10px] font-black uppercase opacity-40 tracking-widest self-end pb-2">USD</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Service Recovery Ledger -- with Authorized By */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <HeartHandshake className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Service Recovery Ledger</h3>
          </div>
          <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/10 border-b-2">
                    <TableRow>
                      <TableHead className="p-4 md:p-6 font-black text-[9px] uppercase tracking-widest text-slate-900">Guest</TableHead>
                      <TableHead className="font-black text-[9px] uppercase tracking-widest text-slate-900">Recovery Reason</TableHead>
                      <TableHead className="font-black text-[9px] uppercase tracking-widest text-primary hidden sm:table-cell">Authorized By</TableHead>
                      <TableHead className="text-right font-black text-[9px] uppercase tracking-widest text-amber-600 pr-6 md:pr-10">Value Comped</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analyticsData.recoveryLedger.length > 0 ? analyticsData.recoveryLedger.map(entry => (
                      <TableRow key={entry.id} className="hover:bg-amber-50/50">
                        <TableCell className="p-4 md:p-6">
                          <p className="font-bold uppercase text-[10px] text-slate-900">{entry.clientName}</p>
                          <p className="text-[8px] font-black text-muted-foreground uppercase opacity-40">{format(safeDate(entry.date), 'MMM d, p')}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-[10px] font-medium text-slate-500 uppercase truncate max-w-[160px]">{entry.reason}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <User className="w-3 h-3 text-primary" />
                            </div>
                            <p className="text-[10px] font-black uppercase text-primary">{entry.authorizedBy}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6 md:pr-10 font-black font-mono text-amber-600">-${entry.amount.toFixed(2)}</TableCell>
                      </TableRow>
                    )) : (
                      <TableRow><TableCell colSpan={4} className="p-12 text-center text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">No service recoveries in this period</TableCell></TableRow>
                    )}
                  </TableBody>
                  {analyticsData.recoveryLedger.length > 0 && (
                    <TableFooter>
                      <TableRow className="bg-amber-50 border-t-2 border-amber-100">
                        <TableCell colSpan={3} className="p-4 font-black uppercase text-[10px] tracking-widest text-amber-700">Total Recovery Investment</TableCell>
                        <TableCell className="text-right pr-6 md:pr-10 font-black font-mono text-amber-700 text-lg">-${analyticsData.overall.totalRecoveryLoss?.toFixed(2)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Absorption Audit */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <ShieldAlert className="w-4 h-4 text-destructive" />
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Absorption Audit (Fee Waivers)</h3>
          </div>
          <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/10 border-b-2">
                    <TableRow>
                      <TableHead className="p-4 md:p-6 font-black text-[9px] uppercase tracking-widest text-slate-900">Guest</TableHead>
                      <TableHead className="font-black text-[9px] uppercase tracking-widest text-slate-900 hidden sm:table-cell">Authorized By</TableHead>
                      <TableHead className="font-black text-[9px] uppercase tracking-widest text-slate-900">Reason</TableHead>
                      <TableHead className="text-right font-black text-[9px] uppercase tracking-widest text-destructive pr-6 md:pr-10">Value Abs.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analyticsData.absorbedLedger.length > 0 ? analyticsData.absorbedLedger.map(entry => (
                      <TableRow key={entry.id} className="hover:bg-destructive/[0.01]">
                        <TableCell className="p-4 md:p-6">
                          <p className="font-bold uppercase text-[10px] text-slate-900">{entry.clientName}</p>
                          <p className="text-[8px] font-black text-muted-foreground uppercase opacity-40">{format(safeDate(entry.date), 'MMM d, p')}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <User className="w-3 h-3 text-primary" />
                            </div>
                            <p className="text-[10px] font-black uppercase text-primary">{entry.authorizer}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="text-[10px] font-medium text-slate-500 uppercase truncate max-w-[120px]">{entry.reason}</p>
                        </TableCell>
                        <TableCell className="text-right pr-6 md:pr-10 font-black font-mono text-destructive">-${entry.amount.toFixed(2)}</TableCell>
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