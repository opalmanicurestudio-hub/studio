
'use client';

import React, { useMemo, useState } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
} from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { format, isPast, parseISO, subDays, startOfDay, endOfDay, differenceInMinutes, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { type Staff } from '@/lib/data';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Badge } from '@/components/ui/badge';

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

const MobileDataCard = ({ title, items, renderItem }: { title: string, items: any[], renderItem: (item: any) => React.ReactNode }) => (
    <div className="space-y-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</h3>
        <div className="grid gap-4">
            {items.map((item, i) => (
                <Card key={i} className="border-2 shadow-sm overflow-hidden">
                    <CardContent className="p-4">
                        {renderItem(item)}
                    </CardContent>
                </Card>
            ))}
        </div>
    </div>
);

export default function ReportsPage() {
  const isMobile = useIsMobile();
  const { user: currentUser } = useUser();
  const { role } = useTenant();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 29), to: new Date() });
  
  const {
    inventory,
    appointments,
    services,
    staff,
    walkIns,
    activityLogs,
    transactions,
    clients,
    isLoading
  } = useInventory();

  const dateRangeString = useMemo(() => {
    if (!dateRange?.from) return 'All Time';
    if (!dateRange.to) return format(dateRange.from, 'MMM d, yyyy');
    return `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`;
  }, [dateRange]);

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
        const completedAppointmentsCount = completedAppointments.length;
      
        let totalMinutesVariance = 0;
        let totalInServiceMinutes = 0;
        completedAppointments.forEach(apt => {
            const service = services.find(s => s.id === apt.serviceId);
            if (apt.actualStartTime && apt.actualEndTime && service) {
                const actualDuration = differenceInMinutes(safeDate(apt.actualEndTime), safeDate(apt.actualStartTime));
                const scheduledDuration = service.duration;
                totalMinutesVariance += actualDuration - scheduledDuration;
                totalInServiceMinutes += actualDuration;
            } else if (service) {
                totalInServiceMinutes += service.duration;
            }
        });
      
        const avgVariance = completedAppointmentsCount > 0 ? totalMinutesVariance / completedAppointmentsCount : 0;
      
        const staffTransactions = transactions.filter(t => t.staffId === staffMember.id && filterByDate(t.date));
        
        const serviceRevenue = staffTransactions.filter(t => t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0);
        const retailSales = staffTransactions.filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
        const totalSales = serviceRevenue + retailSales;
        const tips = staffTransactions.reduce((acc, t) => acc + (t.tipAmount || 0), 0);
        
        const retailTransactionsWithAppointment = staffTransactions.filter(t => t.category === 'Retail' && t.appointmentId);
        const retailAttachmentRate = completedAppointmentsCount > 0 ? (new Set(retailTransactionsWithAppointment.map(t => t.appointmentId)).size / completedAppointmentsCount) * 100 : 0;
        const avgSalePerAppointment = completedAppointmentsCount > 0 ? totalSales / completedAppointmentsCount : 0;

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

        const utilizationRate = totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0;
        
        let wages = 0;
        if (staffMember.payStructure === 'commission') {
            wages = serviceRevenue * ((staffMember.commissionRate || 0) / 100);
        } else if (staffMember.payStructure === 'hourly' && staffMember.hourlyRate) {
            wages = (totalMinutesWorked / 60) * staffMember.hourlyRate;
        }

        const retailCommission = retailSales * ((staffMember.retailCommissionRate || 0) / 100);
        const totalPay = wages + tips + retailCommission;
        
        const costOfGoodsSold = completedAppointments.reduce((acc, apt) => {
            const service = services.find(s => s.id === apt.serviceId);
            return acc + (service?.cost || 0);
        }, 0);
        const netProfit = totalSales - costOfGoodsSold - (wages + retailCommission);
        
        return {
            ...staffMember,
            stats: {
                totalServices: completedAppointmentsCount,
                avgVariance,
                totalInServiceHours: totalInServiceMinutes / 60,
                utilizationRate,
                avgSalePerAppointment,
                retailAttachmentRate,
                serviceRevenue,
                retailSales,
                retailCommission,
                tips,
                wages,
                totalPay,
                netProfit,
                totalHours: totalMinutesWorked / 60,
                costOfGoodsSold,
            }
        };
    });
  }, [staff, appointments, services, transactions, activityLogs, dateRange]);

  const financials = useMemo(() => {
    if (!performanceAndPayrollData || !clients) return { totalGrossRevenue: 0, totalCOGS: 0, grossProfit: 0, totalAbsorbedCosts: 0, totalWaivedFees: 0, totalOutstandingDebt: 0, recoveryRate: 0 };
    const revenue = performanceAndPayrollData.reduce((acc, d) => acc + d.stats.serviceRevenue + d.stats.retailSales, 0);
    const cogs = performanceAndPayrollData.reduce((acc, d) => acc + d.stats.costOfGoodsSold, 0);
    
    const outstandingDebt = clients.reduce((acc, c) => acc + (c.outstandingBalance || 0), 0);

    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    const waivedFeesInRange = clients.flatMap(c => c.waivedFees || []).filter(w => {
        const d = safeDate(w.waivedAt);
        return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    });
    const waivedTotal = waivedFeesInRange.reduce((acc, w) => acc + w.feeAmount, 0);
    
    const discountsValue = transactions
        .filter(t => t.type === 'expense' && t.category === 'Discounts' && (!fromDate || safeDate(t.date) >= fromDate) && (!toDate || safeDate(t.date) <= toDate))
        .reduce((acc, t) => acc + t.amount, 0);

    const collectedFees = transactions
        .filter(t => t.type === 'income' && t.category === 'Cancellation Fee' && (!fromDate || safeDate(t.date) >= fromDate) && (!toDate || safeDate(t.date) <= toDate))
        .reduce((acc, t) => acc + t.amount, 0);
    
    const pendingFeesInRange = clients.flatMap(c => c.unpaidFees || []).filter(f => {
        const d = safeDate(f.appointmentDate);
        return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    }).reduce((acc, f) => acc + f.feeAmount, 0);

    const totalFeesCharged = collectedFees + pendingFeesInRange;
    const rate = totalFeesCharged > 0 ? (collectedFees / totalFeesCharged) * 100 : 0;

    return {
      totalGrossRevenue: revenue,
      totalCOGS: cogs,
      grossProfit: revenue - cogs,
      totalAbsorbedCosts: waivedTotal + discountsValue,
      totalWaivedFees: waivedTotal,
      totalOutstandingDebt: outstandingDebt,
      recoveryRate: rate
    };
  }, [performanceAndPayrollData, transactions, dateRange, clients]);
  
  const kpiData = useMemo(() => {
    if (!appointments || !transactions || !staff || !walkIns) return { avgSalePerAppointment: 0, utilizationRate: 0, retailAttachmentRate: 0, cancellationRate: 0, rebookingRate: 0, walkInConversionRate: 0, revenuePerServiceHour: 0 };
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    const appointmentsInRange = appointments.filter(apt => {
        const aptDate = safeDate(apt.startTime);
        if (fromDate && aptDate < fromDate) return false;
        if (toDate && aptDate > toDate) return false;
        return true;
    });

    const completedAppointments = appointmentsInRange.filter(apt => apt.status === 'completed');
    const cancelledAppointments = appointmentsInRange.filter(apt => apt.status === 'cancelled');

    const totalRevenue = transactions
        .filter(t => {
            const tDate = safeDate(t.date);
            if (fromDate && tDate < fromDate) return false;
            if (toDate && tDate > toDate) return false;
            return t.type === 'income' && (t.category === 'Service Revenue' || t.category === 'Retail');
        })
        .reduce((acc, t) => acc + t.amount, 0);
        
    const retailTransactions = transactions.filter(t => t.category === 'Retail' && t.appointmentId);
    const appointmentsWithRetail = new Set(retailTransactions.map(t => t.appointmentId));

    const totalInServiceMinutes = performanceAndPayrollData.reduce((total, staffMember) => total + (staffMember.stats.totalInServiceHours * 60), 0);
    const totalMinutesWorked = performanceAndPayrollData.reduce((total, staffMember) => total + (staffMember.stats.totalHours * 60), 0);
    
    const clientsInPeriod = new Set(completedAppointments.map(apt => apt.clientId));
    let rebookedClients = 0;
    if (toDate) {
      clientsInPeriod.forEach(clientId => {
        const hasFutureBooking = appointments.some(apt => apt.clientId === clientId && safeDate(apt.startTime) > toDate);
        if (hasFutureBooking) {
          rebookedClients++;
        }
      });
    }
    const rebookingRate = clientsInPeriod.size > 0 ? (rebookedClients / clientsInPeriod.size) * 100 : 0;
    
    const walkInsInRange = walkIns.filter(w => {
        const checkInDate = safeDate(w.checkInTime);
        if (fromDate && checkInDate < fromDate) return false;
        if (toDate && checkInDate > toDate) return false;
        return true;
    });
    const completedWalkInsCount = walkInsInRange.filter(w => w.status === 'completed').length;
    const terminalWalkInsCount = walkInsInRange.filter(w => ['completed', 'skipped', 'cancelled'].includes(w.status)).length;
    const walkInConversionRate = terminalWalkInsCount > 0 ? (completedWalkInsCount / terminalWalkInsCount) * 100 : 0;

    const totalServiceRevenue = performanceAndPayrollData.reduce((acc, d) => acc + d.stats.serviceRevenue, 0);
    const totalServiceHours = performanceAndPayrollData.reduce((acc, d) => acc + d.stats.totalInServiceHours, 0);
    const revenuePerServiceHour = totalServiceHours > 0 ? totalServiceRevenue / totalServiceHours : 0;

    return {
      avgSalePerAppointment: completedAppointments.length > 0 ? totalRevenue / completedAppointments.length : 0,
      utilizationRate: totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0,
      retailAttachmentRate: completedAppointments.length > 0 ? (appointmentsWithRetail.size / completedAppointments.length) * 100 : 0,
      cancellationRate: appointmentsInRange.length > 0 ? (cancelledAppointments.length / appointmentsInRange.length) * 100 : 0,
      rebookingRate,
      walkInConversionRate,
      revenuePerServiceHour,
    }
  }, [performanceAndPayrollData, appointments, transactions, staff, dateRange, walkIns]);

  const servicePerformanceData = useMemo(() => {
    if (!services || !appointments) return [];

    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return services
        .map(service => {
            const serviceAppointments = appointments.filter(apt => {
                if (apt.serviceId !== service.id || apt.status !== 'completed') return false;
                const aptDate = safeDate(apt.startTime);
                if(fromDate && aptDate < fromDate) return false;
                if(toDate && aptDate > toDate) return false;
                return true;
            });
            
            if (serviceAppointments.length === 0) return null;

            const totalRevenue = serviceAppointments.reduce((acc, apt) => acc + (service.price || 0), 0);
            
            const totalActualDuration = serviceAppointments.reduce((acc, apt) => {
                if (apt.actualStartTime && apt.actualEndTime) {
                    return acc + differenceInMinutes(safeDate(apt.actualEndTime), safeDate(apt.actualStartTime));
                }
                return acc + service.duration;
            }, 0);
            
            const avgTime = totalActualDuration / serviceAppointments.length;
            
            return {
                ...service,
                totalBookings: serviceAppointments.length,
                totalRevenue,
                avgTime,
            };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .sort((a,b) => b.totalRevenue - a.totalRevenue);
  }, [services, appointments, dateRange]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full flex-col">
        <AppHeader title="Reports" />
        <main className="flex-1 p-4 md:p-8 flex items-center justify-center">
            <Loader className="h-8 w-8 animate-spin" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-white overflow-x-hidden">
      <AppHeader title="Reports & Analytics" />
      <main className="flex-1 p-4 md:p-8 space-y-6 md:space-y-8 w-full max-w-full min-w-0 overflow-y-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900">Studio Reports</h1>
            <p className="text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70">
              Insights into your salon's performance
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        id="date"
                        variant={"outline"}
                        className={cn( "w-full sm:w-[300px] h-11 border-2 justify-start text-left font-normal shadow-sm", !dateRange && "text-muted-foreground" )}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateRangeString}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                    <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={isMobile ? 1 : 2} />
                </PopoverContent>
            </Popover>
             <Button variant="outline" className="h-11 border-2 shadow-sm font-bold uppercase tracking-tight" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print Report</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 w-full">
            <Card className="border-2 shadow-sm min-w-0">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><DollarSign className="w-3 h-3"/>Avg. Ticket Size</CardTitle></CardHeader>
                <CardContent>
                    <div className="text-2xl md:text-3xl font-black tracking-tighter">${kpiData.avgSalePerAppointment.toFixed(2)}</div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight opacity-60">Revenue per completed appointment</p>
                </CardContent>
            </Card>
            <Card className="border-2 shadow-sm min-w-0">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><Target className="w-3 h-3"/>Stylist Utilization</CardTitle></CardHeader>
                <CardContent>
                    <div className="text-2xl md:text-3xl font-black tracking-tighter">{kpiData.utilizationRate.toFixed(1)}%</div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight opacity-60">Clocked-in time spent in-service</p>
                </CardContent>
            </Card>
            <Card className="bg-destructive/[0.03] border-destructive/20 border-2 shadow-sm min-w-0">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-destructive/70 flex items-center gap-2"><AlertTriangle className="w-3 h-3"/>Absorbed Costs</CardTitle></CardHeader>
                <CardContent>
                    <div className="text-2xl md:text-3xl font-black tracking-tighter text-destructive">${financials.totalAbsorbedCosts.toFixed(2)}</div>
                    <p className="text-[10px] text-muted-foreground uppercase font-black tracking-tight opacity-60">Waived Fees & Discounts</p>
                </CardContent>
            </Card>
            <Card className="border-2 shadow-sm min-w-0">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><BanIcon className="w-3 h-3"/>Cancellation Rate</CardTitle></CardHeader>
                <CardContent>
                    <div className="text-2xl md:text-3xl font-black tracking-tighter">{kpiData.cancellationRate.toFixed(1)}%</div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight opacity-60">Appointments marked as cancelled</p>
                </CardContent>
            </Card>
        </div>

        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 w-full">
            <Card className="border-2 border-primary/20 bg-primary/[0.02] min-w-0">
                <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-primary font-black uppercase tracking-tighter text-base md:text-lg"><Wallet className="w-5 h-5" /> Revenue Recovery</CardTitle>
                    <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Tracking unpaid balances</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-background border-2 shadow-sm">
                        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Unpaid Debt (Total)</p>
                        <p className="text-2xl font-black text-destructive tracking-tighter">${financials.totalOutstandingDebt.toFixed(2)}</p>
                    </div>
                    <div className="p-4 rounded-xl bg-background border-2 shadow-sm">
                        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Fee Recovery Rate</p>
                        <p className="text-2xl font-black text-primary tracking-tighter">{financials.recoveryRate.toFixed(1)}%</p>
                    </div>
                    <div className="p-4 rounded-xl bg-background border-2 shadow-sm sm:col-span-2 flex justify-between items-center">
                        <div>
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Absorbed (Waived Fees)</p>
                            <p className="text-2xl font-black text-destructive/70 tracking-tighter">${financials.totalWaivedFees.toFixed(2)}</p>
                        </div>
                        <ShieldCheck className="w-8 h-8 text-primary/20" />
                    </div>
                </CardContent>
            </Card>

            <Card className="border-2 shadow-sm min-w-0">
                <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 font-black uppercase tracking-tighter text-base md:text-lg"><Users className="w-5 h-5" /> Top Accounts Receivable</CardTitle>
                    <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Clients with highest debt</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {clients?.filter(c => (c.outstandingBalance || 0) > 0).sort((a,b) => (b.outstandingBalance || 0) - (a.outstandingBalance || 0)).slice(0, 5).map(client => (
                            <div key={client.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 border-2">
                                <div className="flex items-center gap-3 truncate">
                                    <Avatar className="h-8 w-8 border-2 border-white shadow-sm shrink-0">
                                        <AvatarImage src={client.avatarUrl} className="object-cover" />
                                        <AvatarFallback>{(client.name || 'C').substring(0,2).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                    <span className="font-bold text-sm tracking-tight truncate">{client.name}</span>
                                </div>
                                <Badge variant="destructive" className="font-mono font-black border-none h-6 px-2 shrink-0">-${client.outstandingBalance?.toFixed(2)}</Badge>
                            </div>
                        ))}
                        {(!clients || clients.filter(c => (c.outstandingBalance || 0) > 0).length === 0) && (
                            <div className="text-center py-10 opacity-40">
                              <Users className="w-10 h-10 mx-auto mb-2" />
                              <p className="text-xs font-bold uppercase tracking-widest">No outstanding balances!</p>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
        
        {isMobile ? (
            <div className="space-y-8">
                <MobileDataCard 
                    title="Payroll & Earnings"
                    items={performanceAndPayrollData}
                    renderItem={(data) => (
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10 border-2">
                                    <AvatarImage src={data.avatarUrl} className="object-cover" />
                                    <AvatarFallback>{(data.name || 'S').substring(0, 2).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <p className="font-bold text-sm">{data.name || 'Staff'}</p>
                                    <p className="text-[10px] font-black uppercase text-muted-foreground">{data.payStructure}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="p-2 bg-muted/20 rounded-lg border"><p className="text-[9px] font-bold text-muted-foreground uppercase">Service Rev</p><p className="font-bold">${data.stats.serviceRevenue.toFixed(2)}</p></div>
                                <div className="p-2 bg-muted/20 rounded-lg border"><p className="text-[9px] font-bold text-muted-foreground uppercase">Tips</p><p className="font-bold text-green-600">${data.stats.tips.toFixed(2)}</p></div>
                                <div className="p-2 bg-primary/5 rounded-lg border border-primary/20 col-span-2 flex justify-between items-center"><p className="text-[9px] font-black text-primary uppercase">Total Payout</p><p className="font-black text-primary text-base">${data.stats.totalPay.toFixed(2)}</p></div>
                            </div>
                        </div>
                    )}
                />
                <MobileDataCard 
                    title="Service Performance"
                    items={servicePerformanceData}
                    renderItem={(service) => (
                        <div className="flex justify-between items-center">
                            <div className="min-w-0">
                                <p className="font-bold text-sm truncate">{service.name}</p>
                                <p className="text-[9px] font-black text-muted-foreground uppercase">{service.totalBookings} Bookings &middot; {service.avgTime.toFixed(0)}m Avg</p>
                            </div>
                            <p className="font-black text-primary font-mono text-base">${service.totalRevenue.toFixed(2)}</p>
                        </div>
                    )}
                />
                <MobileDataCard 
                    title="Stylist Effectiveness"
                    items={performanceAndPayrollData}
                    renderItem={(data) => (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <p className="font-bold text-sm">{data.name || 'Staff'}</p>
                                <Badge variant="outline" className={cn("text-[9px] h-4", data.stats.avgVariance > 0 ? "text-destructive" : "text-green-600")}>{data.stats.avgVariance > 0 ? '+' : ''}{data.stats.avgVariance.toFixed(1)}m</Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-[10px] font-black uppercase text-muted-foreground text-center">
                                <div className="p-1 bg-muted/20 rounded">Util: {data.stats.utilizationRate.toFixed(0)}%</div>
                                <div className="p-1 bg-muted/20 rounded">Tkt: ${data.stats.avgSalePerAppointment.toFixed(0)}</div>
                                <div className="p-1 bg-muted/20 rounded">Retail: {data.stats.retailAttachmentRate.toFixed(0)}%</div>
                            </div>
                        </div>
                    )}
                />
            </div>
        ) : (
            <>
                <Card className="border-2 shadow-sm overflow-hidden min-w-0">
                    <CardHeader className="pb-4 border-b bg-muted/10">
                        <CardTitle className="flex items-center gap-2 font-black uppercase tracking-tighter text-base md:text-lg"><Wallet className="w-5 h-5" /> Payroll & Earnings</CardTitle>
                        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Payout summary for {dateRangeString}</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50 border-b-2">
                                    <tr>
                                        <th className="w-12 p-4"></th>
                                        <th className="text-left p-4 font-black text-[10px] uppercase tracking-widest">Staff Member</th>
                                        <th className="text-left p-4 font-black text-[10px] uppercase tracking-widest">Pay Structure</th>
                                        <th className="text-right p-4 font-black text-[10px] uppercase tracking-widest">Svc Rev.</th>
                                        <th className="text-right p-4 font-black text-[10px] uppercase tracking-widest">Tips</th>
                                        <th className="text-right p-4 font-black text-[10px] uppercase tracking-widest">Total Payout</th>
                                        <th className="text-right p-4 font-black text-[10px] uppercase tracking-widest">Contribution</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {performanceAndPayrollData.map(data => (
                                        <tr key={data.id} className="border-b transition-colors hover:bg-muted/30">
                                            <td className="p-4">
                                                <Avatar className="h-9 w-9 border-2 border-white shadow-sm">
                                                    <AvatarImage src={data.avatarUrl} alt={data.name || 'Staff'} className="object-cover" />
                                                    <AvatarFallback>{(data.name || 'S').substring(0, 2).toUpperCase()}</AvatarFallback>
                                                </Avatar>
                                            </td>
                                            <td className="p-4 font-bold tracking-tight">{data.name || 'Staff'}</td>
                                            <td className="p-4 uppercase text-[10px] font-bold">
                                                {data.payStructure}
                                                {data.payStructure === 'commission' && (
                                                    <div className="text-[9px] text-muted-foreground font-medium opacity-60">
                                                        {data.commissionRate}% Svc / {data.retailCommissionRate || 0}% Ret.
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4 text-right font-mono font-bold text-xs">${data.stats.serviceRevenue.toFixed(2)}</td>
                                            <td className="p-4 text-right font-mono font-bold text-xs text-green-600">${data.stats.tips.toFixed(2)}</td>
                                            <td className="p-4 text-right font-mono font-black text-sm text-primary bg-primary/[0.02]">${data.stats.totalPay.toFixed(2)}</td>
                                            <td className={cn("p-4 text-right font-mono font-black text-sm", data.stats.netProfit >= 0 ? 'text-green-600' : 'text-destructive')}>${data.stats.netProfit.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
                
                <Card className="border-2 shadow-sm overflow-hidden min-w-0">
                    <CardHeader className="pb-4">
                        <CardTitle className="font-black uppercase tracking-tighter text-base md:text-lg">Service Performance</CardTitle>
                        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Popularity & Efficiency by Treatment</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/30 border-b">
                                    <tr>
                                        <th className="text-left p-4 font-black text-[10px] uppercase tracking-widest">Service</th>
                                        <th className="text-right p-4 font-black text-[10px] uppercase tracking-widest">Bookings</th>
                                        <th className="text-right p-4 font-black text-[10px] uppercase tracking-widest">Avg. Time</th>
                                        <th className="text-right p-4 font-black text-[10px] uppercase tracking-widest">Revenue</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {servicePerformanceData.map(service => (
                                        <tr key={service.id} className="border-b transition-colors hover:bg-muted/30">
                                            <td className="p-4 font-bold tracking-tight">{service.name}</td>
                                            <td className="p-4 text-right font-mono font-bold text-xs">{service.totalBookings}</td>
                                            <td className="p-4 text-right font-mono font-bold text-xs">{service.avgTime.toFixed(0)} min</td>
                                            <td className="p-4 text-right font-mono font-black text-sm text-primary">${service.totalRevenue.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            </>
        )}

        <div className="mt-4 border-t p-4 space-y-2 bg-muted/5 text-sm rounded-xl border-2">
              <div className="flex justify-between font-black uppercase text-[10px] text-muted-foreground"><span>Total Gross Revenue</span><span className="font-mono text-black">${financials.totalGrossRevenue.toFixed(2)}</span></div>
              <div className="flex justify-between text-muted-foreground pl-4 font-bold uppercase text-[9px]"><span>COGS</span><span className="text-destructive">-${financials.totalCOGS.toFixed(2)}</span></div>
              <div className="flex justify-between font-black border-t-2 pt-2 text-base"><span>Gross Profit</span><span className="font-mono">${financials.grossProfit.toFixed(2)}</span></div>
        </div>

        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 w-full pb-20">
          {!isMobile && (
            <Card className="border-2 shadow-sm overflow-hidden min-w-0">
                <CardHeader className="pb-4">
                <CardTitle className="font-black uppercase tracking-tighter text-base md:text-lg">Stylist Effectiveness</CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Efficiency metrics per provider</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30 border-b">
                            <tr>
                                <th className="text-left p-4 font-black text-[10px] uppercase tracking-widest">Staff Member</th>
                                <th className="text-right p-4 font-black text-[10px] uppercase tracking-widest">Util.</th>
                                <th className="text-right p-4 font-black text-[10px] uppercase tracking-widest">Avg. Ticket</th>
                                <th className="text-right p-4 font-black text-[10px] uppercase tracking-widest">Retail</th>
                                <th className="text-right p-4 font-black text-[10px] uppercase tracking-widest">Variance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {performanceAndPayrollData.map(data => (
                            <tr key={data.id} className="border-b transition-colors hover:bg-muted/30">
                                <td className="p-4 font-bold tracking-tight truncate max-w-[100px]">{data.name || 'Staff'}</td>
                                <td className="p-4 text-right font-mono font-bold text-xs">{data.stats.utilizationRate.toFixed(1)}%</td>
                                <td className="p-4 text-right font-mono font-bold text-xs">${data.stats.avgSalePerAppointment.toFixed(2)}</td>
                                <td className="p-4 text-right font-mono font-bold text-xs">{data.stats.retailAttachmentRate.toFixed(1)}%</td>
                                <td className={cn('p-4 text-right font-mono font-black text-[10px] uppercase', data.stats.avgVariance > 0 ? 'text-destructive' : 'text-green-600')}>
                                    {data.stats.avgVariance > 0 ? '+' : ''}{data.stats.avgVariance.toFixed(1)}m
                                </td>
                            </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
