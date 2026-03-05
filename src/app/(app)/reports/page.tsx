
'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { ArrowLeft, Printer, BarChart, DollarSign, Package, Store, Hammer, Recycle, TrendingUp, AlertTriangle, Download, Target, Ban, Repeat, UserPlus, Users, Wallet, ShoppingCart, Activity, Ban as BanIcon, ShieldCheck, Calculator, Loader } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { format, isPast, parseISO, differenceInMonths, subDays, startOfDay, endOfDay, differenceInMinutes, differenceInDays, getHours, setHours } from 'date-fns';
import { cn } from '@/lib/utils';
import { type InventoryItem, type Appointment, type Service, type Staff, type WalkIn, type Transaction, type ActivityLog } from '@/lib/data';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartConfig } from '@/components/ui/chart';
import { Bar, BarChart as RechartsBarChart, PieChart as RechartsPieChart, Pie, Cell } from 'recharts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { Calendar as CalendarIcon } from 'lucide-react';
import { PrintableStaffReport } from '@/components/reports/PrintableReport';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * Utility to safely convert potential strings, timestamps, or Date objects into valid Date instances.
 */
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
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 29), to: new Date() });
  const reportRef = useRef<HTMLDivElement>(null);
  
  const {
    inventory,
    stockCorrections,
    appointments,
    services,
    staff,
    walkIns,
    activityLogs,
    transactions,
    businessProfiles,
    lifestyleProfiles,
    clients,
    isLoading
  } = useInventory();


  const monthlyOverhead = useMemo(() => {
      let totalOverhead = 0;
      const activeBusinessProfile = businessProfiles?.[0];
      if (activeBusinessProfile?.categories) {
          totalOverhead += activeBusinessProfile.categories.reduce((total: number, category: any) => {
              return total + category.bills.reduce((catTotal: number, bill: any) => catTotal + (bill.amount || 0), 0);
          }, 0);
      }
      const activeLifestyleProfile = lifestyleProfiles?.[0];
      if (activeLifestyleProfile?.categories) {
          totalOverhead += activeLifestyleProfile.categories.reduce((total: number, category: any) => {
              return total + category.bills.reduce((catTotal: number, bill: any) => catTotal + (bill.amount || 0), 0);
          }, 0);
      }
      return totalOverhead;
  }, [businessProfiles, lifestyleProfiles]);

  const periodOverhead = useMemo(() => {
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;
    const daysInRange = fromDate && toDate ? differenceInDays(toDate, fromDate) + 1 : 30;

    return (monthlyOverhead / 30.44) * daysInRange;
  }, [dateRange, monthlyOverhead]);

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
            }
        });
      
        const avgVariance = completedAppointmentsCount > 0 ? totalMinutesVariance / completedAppointmentsCount : 0;
        const avgActualServiceTime = completedAppointmentsCount > 0 ? totalInServiceMinutes / completedAppointmentsCount : 0;
      
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
                avgActualServiceTime,
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

  const {
    totalGrossRevenue,
    totalCOGS,
    grossProfit,
    totalAbsorbedCosts,
    totalWaivedFees,
    totalOutstandingDebt,
    recoveryRate
  } = useMemo(() => {
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
  }, [performanceAndPayrollData, appointments, transactions, dateRange, clients]);
  
  const kpiData = useMemo(() => {
    if (!appointments || !transactions || !staff || !walkIns) return { avgSalePerAppointment: 0, utilizationRate: 0, retailAttachmentRate: 0, cancellationRate: 0, rebookingRate: 0, walkInConversionRate: 0, revenuePerServiceHour: 0, newClientRate: 0 };
    
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

    const totalInServiceMinutes = performanceAndPayrollData.reduce((total, staff) => total + (staff.stats.totalInServiceHours * 60), 0);
    const totalMinutesWorked = performanceAndPayrollData.reduce((total, staff) => total + (staff.stats.totalHours * 60), 0);
    
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

    let newClientsInPeriod = 0;
    if(fromDate) {
        clientsInPeriod.forEach(clientId => {
            const clientAppointments = appointments.filter(apt => apt.clientId === clientId);
            if (clientAppointments.length > 0) {
                const firstAppointmentDate = clientAppointments.reduce((earliest, current) => {
                    const d = safeDate(current.startTime);
                    return d < earliest ? d : earliest;
                }, safeDate(clientAppointments[0].startTime));
                if (firstAppointmentDate >= fromDate) {
                    newClientsInPeriod++;
                }
            }
        });
    }
    const newClientRate = clientsInPeriod.size > 0 ? (newClientsInPeriod / clientsInPeriod.size) * 100 : 0;
    
    return {
      avgSalePerAppointment: completedAppointments.length > 0 ? totalRevenue / completedAppointments.length : 0,
      utilizationRate: totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0,
      retailAttachmentRate: completedAppointments.length > 0 ? (appointmentsWithRetail.size / completedAppointments.length) * 100 : 0,
      cancellationRate: appointmentsInRange.length > 0 ? (cancelledAppointments.length / appointmentsInRange.length) * 100 : 0,
      rebookingRate,
      walkInConversionRate,
      revenuePerServiceHour,
      newClientRate,
    }
  }, [performanceAndPayrollData, appointments, transactions, staff, dateRange, walkIns]);


  const waitTimeData = useMemo(() => {
    if (!walkIns) return { chartData: [], avgWaitTime: 0 };
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    const completedWalkIns = walkIns.filter(
      w => {
          if (w.status !== 'completed' || !w.serviceStartTime) return false;
          const checkInDate = safeDate(w.checkInTime);
          if(fromDate && checkInDate < fromDate) return false;
          if(toDate && checkInDate > toDate) return false;
          return true;
      }
    );

    const hourlyWaitTimes: { [hour: number]: { totalWait: number; count: number } } = {};

    for(let i = 8; i < 20; i++) {
        hourlyWaitTimes[i] = { totalWait: 0, count: 0 };
    }

    completedWalkIns.forEach(w => {
      const checkInTime = safeDate(w.checkInTime);
      const serviceStartTime = safeDate(w.serviceStartTime!);
      const waitMinutes = differenceInMinutes(serviceStartTime, checkInTime);
      const hour = getHours(checkInTime);

      if (hourlyWaitTimes[hour]) {
        hourlyWaitTimes[hour].totalWait += waitMinutes;
        hourlyWaitTimes[hour].count++;
      }
    });

    const chartData = Object.entries(hourlyWaitTimes).map(([hour, data]) => ({
      hour: format(setHours(new Date(0), parseInt(hour, 10)), 'ha'),
      waitTime: data.count > 0 ? data.totalWait / data.count : 0,
    }));
    
    const totalWaitMinutes = chartData.reduce((acc, d) => acc + d.waitTime * (hourlyWaitTimes[parseInt(d.hour)]?.count || 0), 0);
    const avgWaitTime = completedWalkIns.length > 0 ? totalWaitMinutes / completedWalkIns.length : 0;
    
    return { chartData, avgWaitTime };

  }, [walkIns, dateRange]);
  
  const payrollTotals = useMemo(() => {
    if (!performanceAndPayrollData) return { totalWages: 0, totalTips: 0, totalRetailCommission: 0, totalPayroll: 0, totalNetProfit: 0 };
    return performanceAndPayrollData.reduce((acc, staff) => {
        acc.totalWages += staff.stats.wages;
        acc.totalTips += staff.stats.tips;
        acc.totalRetailCommission += staff.stats.retailCommission;
        acc.totalPayroll += staff.stats.totalPay;
        acc.totalNetProfit += staff.stats.netProfit;
        return acc;
    }, { totalWages: 0, totalTips: 0, totalRetailCommission: 0, totalPayroll: 0, totalNetProfit: 0 });
  }, [performanceAndPayrollData]);
  
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

            const totalRevenue = serviceAppointments.reduce((acc, apt) => acc + service.price, 0);
            
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

    const bookingSourceData = useMemo(() => {
        if (!appointments) return [];
        const counts = appointments.reduce((acc, apt) => {
            const source = apt.source || (apt.isWalkIn ? 'walk-in' : 'manual');
            acc[source] = (acc[source] || 0) + 1;
            return acc;
        }, { online: 0, 'walk-in': 0, manual: 0 } as Record<string, number>);

        return [
            { name: 'Online', value: counts.online, fill: 'hsl(var(--chart-1))' },
            { name: 'Walk-in', value: counts['walk-in'], fill: 'hsl(var(--chart-2))' },
            { name: 'Manual', value: counts.manual, fill: 'hsl(var(--chart-3))' },
        ];
    }, [appointments]);

  if (isLoading) {
      return (
          <div className="flex h-screen w-full items-center justify-center">
              <Loader className="animate-spin h-8 w-8 text-primary" />
          </div>
      );
  }

  return (
    <>
      <div className="no-print flex min-h-screen w-full flex-col bg-white overflow-x-hidden">
        <AppHeader title="Reports & Analytics" />
        <main className="flex-1 p-4 md:p-8 space-y-6 md:space-y-8 w-full max-w-full min-w-0 overflow-hidden">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter">Studio Reports</h1>
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
                          {dateRange?.from ? ( dateRange.to ? ( <> {format(dateRange.from, "LLL dd, yyyy")} -{" "} {format(dateRange.to, "LLL dd, yyyy")} </> ) : ( format(dateRange.from, "LLL dd, yyyy") ) ) : ( <span>Pick a date range</span> ) }
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
              <Card className="border-2 shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><DollarSign className="w-3 h-3"/>Avg. Ticket Size</CardTitle></CardHeader>
                  <CardContent>
                      <div className="text-2xl md:text-3xl font-black tracking-tighter">${kpiData.avgSalePerAppointment.toFixed(2)}</div>
                      <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight opacity-60">Revenue per completed appointment</p>
                  </CardContent>
              </Card>
              <Card className="border-2 shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><Target className="w-3 h-3"/>Stylist Utilization</CardTitle></CardHeader>
                  <CardContent>
                      <div className="text-2xl md:text-3xl font-black tracking-tighter">{kpiData.utilizationRate.toFixed(1)}%</div>
                      <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight opacity-60">Clocked-in time spent in-service</p>
                  </CardContent>
              </Card>
              <Card className="bg-destructive/[0.03] border-destructive/20 border-2 shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-destructive/70 flex items-center gap-2"><AlertTriangle className="w-3 h-3"/>Absorbed Costs</CardTitle></CardHeader>
                  <CardContent>
                      <div className="text-2xl md:text-3xl font-black tracking-tighter text-destructive">${totalAbsorbedCosts.toFixed(2)}</div>
                      <p className="text-[10px] text-muted-foreground uppercase font-black tracking-tight opacity-60">Waived Fees & Discounts</p>
                  </CardContent>
              </Card>
              <Card className="border-2 shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><BanIcon className="w-3 h-3"/>Cancellation Rate</CardTitle></CardHeader>
                  <CardContent>
                      <div className="text-2xl md:text-3xl font-black tracking-tighter">{kpiData.cancellationRate.toFixed(1)}%</div>
                      <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight opacity-60">Appointments marked as cancelled</p>
                  </CardContent>
              </Card>
          </div>

          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 w-full">
              <Card className="border-2 border-primary/20 bg-primary/[0.02]">
                  <CardHeader className="pb-4">
                      <CardTitle className="flex items-center gap-2 text-primary font-black uppercase tracking-tighter"><Wallet className="w-5 h-5" /> Revenue Recovery</CardTitle>
                      <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Tracking unpaid balances</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-4 rounded-xl bg-background border-2 shadow-sm">
                          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Unpaid Debt (Total)</p>
                          <p className="text-2xl font-black text-destructive tracking-tighter">${totalOutstandingDebt.toFixed(2)}</p>
                      </div>
                      <div className="p-4 rounded-xl bg-background border-2 shadow-sm">
                          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Fee Recovery Rate</p>
                          <p className="text-2xl font-black text-primary tracking-tighter">{recoveryRate.toFixed(1)}%</p>
                      </div>
                      <div className="p-4 rounded-xl bg-background border-2 shadow-sm sm:col-span-2 flex justify-between items-center">
                          <div>
                              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Absorbed (Waived Fees)</p>
                              <p className="text-2xl font-black text-destructive/70 tracking-tighter">${totalWaivedFees.toFixed(2)}</p>
                          </div>
                          <ShieldCheck className="w-8 h-8 text-primary/20" />
                      </div>
                  </CardContent>
              </Card>

              <Card className="border-2 shadow-sm">
                  <CardHeader className="pb-4">
                      <CardTitle className="flex items-center gap-2 font-black uppercase tracking-tighter"><Users className="w-5 h-5" /> Top Accounts Receivable</CardTitle>
                      <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Clients with highest debt</CardDescription>
                  </CardHeader>
                  <CardContent>
                      <div className="space-y-3">
                          {clients?.filter(c => (c.outstandingBalance || 0) > 0).sort((a,b) => (b.outstandingBalance || 0) - (a.outstandingBalance || 0)).slice(0, 5).map(client => (
                              <div key={client.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 border-2">
                                  <div className="flex items-center gap-3">
                                      <Avatar className="h-8 w-8 border-2 border-white shadow-sm">
                                          <AvatarImage src={client.avatarUrl} className="object-cover" />
                                          <AvatarFallback>{(client.name || 'C').substring(0,2).toUpperCase()}</AvatarFallback>
                                      </Avatar>
                                      <span className="font-bold text-sm tracking-tight">{client.name}</span>
                                  </div>
                                  <Badge variant="destructive" className="font-mono font-black border-none h-6 px-2">-${client.outstandingBalance?.toFixed(2)}</Badge>
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
          
          <Card className="border-2 shadow-sm overflow-hidden">
              <CardHeader className="pb-4 border-b bg-muted/10">
                  <CardTitle className="flex items-center gap-2 font-black uppercase tracking-tighter"><Wallet className="w-5 h-5" /> Payroll Report</CardTitle>
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Earnings & Contribution Summary</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                  <ScrollArea className="w-full">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/50 border-b-2">
                                <TableHead className="w-12"></TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest">Staff Member</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest">Pay Structure</TableHead>
                                <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Svc Rev.</TableHead>
                                <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Tips</TableHead>
                                <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Total Payout</TableHead>
                                <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Contribution</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {performanceAndPayrollData.map(data => (
                                <TableRow key={data.id} className="border-b transition-colors hover:bg-muted/30">
                                    <TableCell>
                                        <Avatar className="h-9 w-9 border-2 border-white shadow-sm">
                                            <AvatarImage src={data.avatarUrl} alt={data.name || 'Staff'} className="object-cover" />
                                            <AvatarFallback>{(data.name || 'S').substring(0, 2).toUpperCase()}</AvatarFallback>
                                        </Avatar>
                                    </TableCell>
                                    <TableCell className="font-bold tracking-tight text-sm">{data.name || 'Unknown'}</TableCell>
                                    <TableCell>
                                        <div className="font-bold uppercase text-[10px] tracking-tight">{data.payStructure}</div>
                                        {data.payStructure === 'commission' && data.commissionRate !== undefined && (
                                            <div className="text-[9px] text-muted-foreground font-medium uppercase opacity-60">
                                                {data.commissionRate}% Svc / {data.retailCommissionRate || 0}% Ret.
                                            </div>
                                        )}
                                        {data.payStructure === 'hourly' && data.hourlyRate !== undefined && (
                                            <div className="text-[9px] text-muted-foreground font-medium uppercase opacity-60">
                                                ${data.hourlyRate.toFixed(2)}/hr
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-bold text-xs">${data.stats.serviceRevenue.toFixed(2)}</TableCell>
                                    <TableCell className="text-right font-mono font-bold text-xs text-green-600">${data.stats.tips.toFixed(2)}</TableCell>
                                    <TableCell className="text-right font-mono font-black text-sm text-primary bg-primary/[0.02]">${data.stats.totalPay.toFixed(2)}</TableCell>
                                    <TableCell className={cn("text-right font-mono font-black text-sm", data.stats.netProfit >= 0 ? 'text-green-600' : 'text-destructive')}>${data.stats.netProfit.toFixed(2)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                        <TableFooter className="bg-muted/20">
                            <TableRow className="border-t-2"><TableCell colSpan={6} className="font-black uppercase text-[10px] tracking-widest text-muted-foreground">Total Gross Revenue</TableCell><TableCell className="text-right font-mono font-black text-sm">${totalGrossRevenue.toFixed(2)}</TableCell></TableRow>
                            <TableRow className="bg-destructive/[0.02]"><TableCell colSpan={6} className="text-muted-foreground pl-8 font-bold uppercase text-[9px] tracking-tight">Cost of Goods Sold (COGS)</TableCell><TableCell className="text-right font-mono text-xs font-bold text-destructive">-${totalCOGS.toFixed(2)}</TableCell></TableRow>
                            <TableRow className="font-black border-t-2 bg-muted/30"><TableCell colSpan={6} className="uppercase text-xs tracking-tight">Gross Profit</TableCell><TableCell className="text-right font-mono text-base tracking-tighter">${grossProfit.toFixed(2)}</TableCell></TableRow>
                            
                            <TableRow className="border-t-4 border-white"><TableCell colSpan={6} className="font-black uppercase text-[10px] tracking-widest text-muted-foreground pt-4">Operating Profit Analysis</TableCell><TableCell></TableCell></TableRow>
                            <TableRow><TableCell colSpan={6} className="text-muted-foreground pl-8 font-bold uppercase text-[9px] tracking-tight">Service Wages</TableCell><TableCell className="text-right font-mono text-xs font-bold text-destructive">-${payrollTotals.totalWages.toFixed(2)}</TableCell></TableRow>
                            <TableRow><TableCell colSpan={6} className="text-muted-foreground pl-8 font-bold uppercase text-[9px] tracking-tight">Retail Commission</TableCell><TableCell className="text-right font-mono text-xs font-bold text-destructive">-${payrollTotals.totalRetailCommission.toFixed(2)}</TableCell></TableRow>
                            
                            <TableRow className="font-black border-t-2 bg-muted/30"><TableCell colSpan={6} className="uppercase text-xs tracking-tight">Operating Profit</TableCell><TableCell className={cn("text-right font-mono text-base tracking-tighter", payrollTotals.totalNetProfit >= 0 ? 'text-primary' : 'text-destructive')}>${payrollTotals.totalNetProfit.toFixed(2)}</TableCell></TableRow>

                            <TableRow className="border-t-4 border-white"><TableCell colSpan={6} className="font-black uppercase text-[10px] tracking-widest text-muted-foreground pt-4">Bottom Line (After Overhead)</TableCell><TableCell className="text-right font-mono text-xs font-bold text-destructive">-${periodOverhead.toFixed(2)}</TableCell></TableRow>
                            <TableRow className="font-black text-xl md:text-2xl bg-primary/5"><TableCell colSpan={6} className="uppercase tracking-tighter py-6">True Net Profit</TableCell><TableCell className={cn("text-right font-mono tracking-tighter py-6", (payrollTotals.totalNetProfit - periodOverhead) >= 0 ? 'text-primary' : 'text-destructive')}>${(payrollTotals.totalNetProfit - periodOverhead).toFixed(2)}</TableCell></TableRow>
                        </TableFooter>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
              </CardContent>
          </Card>
          
          <Card className="border-2 shadow-sm">
              <CardHeader className="pb-4">
                  <CardTitle className="font-black uppercase tracking-tighter">Service Performance</CardTitle>
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Popularity & Efficiency by Treatment</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                  <ScrollArea className="w-full">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/30">
                                <TableHead className="font-black text-[10px] uppercase tracking-widest">Service</TableHead>
                                <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Bookings</TableHead>
                                <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Avg. Time</TableHead>
                                <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Revenue</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {servicePerformanceData.map(service => (
                                <TableRow key={service.id} className="border-b transition-colors hover:bg-muted/30">
                                    <TableCell className="font-bold tracking-tight text-sm">{service.name}</TableCell>
                                    <TableCell className="text-right font-mono font-bold text-xs">{service.totalBookings}</TableCell>
                                    <TableCell className="text-right font-mono font-bold text-xs">{service.avgTime.toFixed(0)} min</TableCell>
                                    <TableCell className="text-right font-mono font-black text-sm text-primary">${service.totalRevenue.toFixed(2)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
              </CardContent>
          </Card>

          <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
            <Card className="border-2 shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="font-black uppercase tracking-tighter">Stylist Effectiveness</CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Efficiency metrics per provider</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="w-full">
                    <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/30">
                        <TableHead className="font-black text-[10px] uppercase tracking-widest">Staff Member</TableHead>
                        <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Util.</TableHead>
                        <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Avg. Ticket</TableHead>
                        <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Retail</TableHead>
                        <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Variance</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {performanceAndPayrollData.map(data => (
                        <TableRow key={data.id} className="border-b transition-colors hover:bg-muted/30">
                            <TableCell className="font-bold tracking-tight text-sm truncate max-w-[100px]">{data.name}</TableCell>
                            <TableCell className="text-right font-mono font-bold text-xs">{data.stats.utilizationRate.toFixed(1)}%</TableCell>
                            <TableCell className="text-right font-mono font-bold text-xs">${data.stats.avgSalePerAppointment.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono font-bold text-xs">{data.stats.retailAttachmentRate.toFixed(1)}%</TableCell>
                            <TableCell className={cn('text-right font-mono font-black text-[10px] uppercase', data.stats.avgVariance > 0 ? 'text-destructive' : 'text-green-600')}>
                            {data.stats.avgVariance > 0 ? '+' : ''}{data.stats.avgVariance.toFixed(1)}m
                            </TableCell>
                        </TableRow>
                        ))}
                    </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </CardContent>
            </Card>
            <Card className="border-2 shadow-sm">
                <CardHeader className="pb-4">
                    <CardTitle className="font-black uppercase tracking-tighter">Booking Source</CardTitle>
                    <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Lead generation channels</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-6">
                    <ChartContainer config={{}} className="h-[200px] w-[200px] md:h-[250px] md:w-[250px]">
                        <RechartsPieChart>
                            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                            <Pie data={bookingSourceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={isMobile ? 60 : 80} label>
                                {bookingSourceData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.fill} />
                                ))}
                            </Pie>
                        </RechartsPieChart>
                    </ChartContainer>
                </CardContent>
            </Card>
          </div>
        </main>
      </div>
      <div className="hidden print:block">
        <PrintableStaffReport
            ref={reportRef} 
            dateRange={dateRange}
            kpiData={kpiData}
            payrollData={performanceAndPayrollData}
            payrollTotals={payrollTotals}
            grossProfit={grossProfit}
            totalGrossRevenue={totalGrossRevenue}
            totalCOGS={totalCOGS}
            periodOverhead={periodOverhead}
            servicePerformanceData={servicePerformanceData}
            appointments={appointments}
            activityLogs={activityLogs}
            transactions={transactions}
            services={services}
        />
      </div>

      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          .print-only {
            display: block !important;
          }
        }
      `}</style>
    </>
  );
}
