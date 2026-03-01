'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { ArrowLeft, Printer, BarChart, DollarSign, Package, Store, Hammer, Recycle, TrendingUp, AlertTriangle, Download, Target, Ban, Repeat, UserPlus, Users, Wallet, ShoppingCart, Activity, Ban as BanIcon, ShieldCheck, Calculator } from 'lucide-react';
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
import { Loader } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

export default function ReportsPage() {
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
        const filterByDate = (date: Date) => {
            const d = date;
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
                const actualDuration = differenceInMinutes(apt.actualEndTime, apt.actualStartTime);
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
        const sortedLogs = staffLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        
        let clockInTime: Date | null = null;
        let totalBreakMinutes = 0;
        for (const log of sortedLogs) {
            const logTime = log.timestamp;
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
            totalMinutesWorked += differenceInMinutes(endOfRange, clockInTime) - totalBreakMinutes;
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
    
    // Total Debt across entire client base
    const outstandingDebt = clients.reduce((acc, c) => acc + (c.outstandingBalance || 0), 0);

    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    // Fees waived in period
    const waivedFeesInRange = clients.flatMap(c => c.waivedFees || []).filter(w => {
        const d = parseISO(w.waivedAt);
        return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    });
    const waivedTotal = waivedFeesInRange.reduce((acc, w) => acc + w.feeAmount, 0);
    
    const discountsValue = transactions
        .filter(t => t.type === 'expense' && t.category === 'Discounts' && (!fromDate || t.date >= fromDate) && (!toDate || t.date <= toDate))
        .reduce((acc, t) => acc + t.amount, 0);

    // Total fees generated (Charged) vs recovered (Collected)
    const collectedFees = transactions
        .filter(t => t.type === 'income' && t.category === 'Cancellation Fee' && (!fromDate || t.date >= fromDate) && (!toDate || t.date <= toDate))
        .reduce((acc, t) => acc + t.amount, 0);
    
    // "Charged" is whatever was collected + whatever is currently pending/unpaid
    const pendingFeesInRange = clients.flatMap(c => c.unpaidFees || []).filter(f => {
        const d = parseISO(f.appointmentDate);
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
  
  const salonWideStats = useMemo(() => {
    if (!appointments || !transactions || !staff || !walkIns) return { avgSalePerAppointment: 0, utilizationRate: 0, retailAttachmentRate: 0, cancellationRate: 0, rebookingRate: 0, walkInConversionRate: 0, revenuePerServiceHour: 0, newClientRate: 0 };
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    const appointmentsInRange = appointments.filter(apt => {
        const aptDate = apt.startTime;
        if (fromDate && aptDate < fromDate) return false;
        if (toDate && aptDate > toDate) return false;
        return true;
    });

    const completedAppointments = appointmentsInRange.filter(apt => apt.status === 'completed');
    const cancelledAppointments = appointmentsInRange.filter(apt => apt.status === 'cancelled');

    const totalRevenue = transactions
        .filter(t => {
            const tDate = t.date;
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
        const hasFutureBooking = appointments.some(apt => apt.clientId === clientId && apt.startTime > toDate);
        if (hasFutureBooking) {
          rebookedClients++;
        }
      });
    }
    const rebookingRate = clientsInPeriod.size > 0 ? (rebookedClients / clientsInPeriod.size) * 100 : 0;
    
    const walkInsInRange = walkIns.filter(w => {
        const checkInDate = parseISO(w.checkInTime);
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
                    return current.startTime < earliest ? current.startTime : earliest;
                }, clientAppointments[0].startTime);
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
          const checkInDate = parseISO(w.checkInTime);
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
      const checkInTime = parseISO(w.checkInTime);
      const serviceStartTime = parseISO(w.serviceStartTime!);
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
                const aptDate = apt.startTime;
                if(fromDate && aptDate < fromDate) return false;
                if(toDate && aptDate > toDate) return false;
                return true;
            });
            
            if (serviceAppointments.length === 0) return null;

            const totalRevenue = serviceAppointments.reduce((acc, apt) => acc + service.price, 0);
            
            const totalActualDuration = serviceAppointments.reduce((acc, apt) => {
                if (apt.actualStartTime && apt.actualEndTime) {
                    return acc + differenceInMinutes(apt.actualEndTime, apt.actualStartTime);
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

  return (
    <>
      <div className="no-print flex min-h-screen w-full flex-col">
        <AppHeader title="Reports & Analytics" />
        <main className="flex-1 p-4 md:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Reports</h1>
              <p className="text-muted-foreground">
                Insights into your salon's performance and efficiency.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Popover>
                  <PopoverTrigger asChild>
                      <Button
                          id="date"
                          variant={"outline"}
                          className={cn( "w-full sm:w-[300px] justify-start text-left font-normal", !dateRange && "text-muted-foreground" )}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {dateRange?.from ? ( dateRange.to ? ( <> {format(dateRange.from, "LLL dd, yyyy")} -{" "} {format(dateRange.to, "LLL dd, yyyy")} </> ) : ( format(dateRange.from, "LLL dd, yyyy") ) ) : ( <span>Pick a date range</span> )}
                      </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                      <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
                  </PopoverContent>
              </Popover>
               <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print Report</Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><DollarSign className="w-4 h-4"/>Avg. Ticket Size</CardTitle></CardHeader>
                  <CardContent>
                      <div className="text-2xl font-bold">${salonWideStats.avgSalePerAppointment.toFixed(2)}</div>
                      <p className="text-xs text-muted-foreground">Avg. revenue per completed appointment.</p>
                  </CardContent>
              </Card>
              <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><Target className="w-4 h-4"/>Stylist Utilization</CardTitle></CardHeader>
                  <CardContent>
                      <div className="text-2xl font-bold">{salonWideStats.utilizationRate.toFixed(1)}%</div>
                      <p className="text-xs text-muted-foreground">% of clocked-in time spent in-service.</p>
                  </CardContent>
              </Card>
              <Card className="bg-destructive/5 border-destructive/20 shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2 text-destructive"><AlertTriangle className="w-4 h-4"/>Absorbed Costs</CardTitle></CardHeader>
                  <CardContent>
                      <div className="text-2xl font-bold text-destructive">${totalAbsorbedCosts.toFixed(2)}</div>
                      <p className="text-[10px] text-muted-foreground uppercase font-black">Waived Fees & Discounts</p>
                  </CardContent>
              </Card>
              <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><BanIcon className="w-4 h-4"/>Cancellation Rate</CardTitle></CardHeader>
                  <CardContent>
                      <div className="text-2xl font-bold">{salonWideStats.cancellationRate.toFixed(1)}%</div>
                      <p className="text-xs text-muted-foreground">% of appointments marked as cancelled.</p>
                  </CardContent>
              </Card>
          </div>

          <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
              <Card className="border-2 border-primary/20 bg-primary/5">
                  <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-primary font-black"><Wallet className="w-5 h-5" /> Revenue Recovery Dashboard</CardTitle>
                      <CardDescription>Metrics related to unpaid balances and recovery efforts.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-4">
                      <div className="p-4 rounded-xl bg-background border shadow-sm">
                          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Unpaid Debt (Total)</p>
                          <p className="text-2xl font-black text-destructive">${totalOutstandingDebt.toFixed(2)}</p>
                      </div>
                      <div className="p-4 rounded-xl bg-background border shadow-sm">
                          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Fee Recovery Rate</p>
                          <p className="text-2xl font-black text-primary">{recoveryRate.toFixed(1)}%</p>
                      </div>
                      <div className="p-4 rounded-xl bg-background border shadow-sm col-span-2 flex justify-between items-center">
                          <div>
                              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Absorbed (Waived Fees)</p>
                              <p className="text-2xl font-black text-destructive/70">${totalWaivedFees.toFixed(2)}</p>
                          </div>
                          <ShieldCheck className="w-8 h-8 text-primary/20" />
                      </div>
                  </CardContent>
              </Card>

              <Card>
                  <CardHeader>
                      <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> Top Accounts Receivable</CardTitle>
                      <CardDescription>Clients with the highest outstanding balances.</CardDescription>
                  </CardHeader>
                  <CardContent>
                      <div className="space-y-3">
                          {clients?.filter(c => (c.outstandingBalance || 0) > 0).sort((a,b) => (b.outstandingBalance || 0) - (a.outstandingBalance || 0)).slice(0, 5).map(client => (
                              <div key={client.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border">
                                  <div className="flex items-center gap-3">
                                      <Avatar className="h-8 w-8">
                                          <AvatarImage src={client.avatarUrl} />
                                          <AvatarFallback>{client.name.substring(0,2)}</AvatarFallback>
                                      </Avatar>
                                      <span className="font-bold text-sm">{client.name}</span>
                                  </div>
                                  <Badge variant="destructive" className="font-mono font-black">${client.outstandingBalance?.toFixed(2)}</Badge>
                              </div>
                          ))}
                          {(!clients || clients.filter(c => (c.outstandingBalance || 0) > 0).length === 0) && (
                              <p className="text-center py-10 text-muted-foreground text-sm">No outstanding balances found!</p>
                          )}
                      </div>
                  </CardContent>
              </Card>
          </div>
          
          <Card>
              <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Wallet /> Payroll Report</CardTitle>
                  <CardDescription>A summary of staff earnings and business profitability for the selected period.</CardDescription>
              </CardHeader>
              <CardContent>
                  <Table>
                      <TableHeader>
                          <TableRow>
                              <TableHead className="w-12"></TableHead>
                              <TableHead>Staff Member</TableHead>
                              <TableHead>Pay Structure</TableHead>
                              <TableHead className="text-right">Service Rev.</TableHead>
                              <TableHead className="text-right">Tips</TableHead>
                              <TableHead className="text-right font-bold text-primary">Total Payout</TableHead>
                              <TableHead className="text-right font-bold">Net Contribution</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {performanceAndPayrollData.map(data => (
                              <TableRow key={data.id}>
                                  <TableCell>
                                      <Avatar className="h-9 w-9">
                                          <AvatarImage src={data.avatarUrl} alt={data.name} />
                                          <AvatarFallback>{data.name.substring(0, 2)}</AvatarFallback>
                                      </Avatar>
                                  </TableCell>
                                  <TableCell className="font-medium">{data.name}</TableCell>
                                  <TableCell>
                                      <div className="font-medium capitalize">{data.payStructure}</div>
                                      {data.payStructure === 'commission' && data.commissionRate !== undefined && (
                                          <div className="text-xs text-muted-foreground">
                                              {data.commissionRate}% (Svc) / {data.retailCommissionRate || 0}% (Retail)
                                          </div>
                                      )}
                                      {data.payStructure === 'hourly' && data.hourlyRate !== undefined && (
                                          <div className="text-xs text-muted-foreground">
                                              ${data.hourlyRate.toFixed(2)}/hr
                                          </div>
                                      )}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">${data.stats.serviceRevenue.toFixed(2)}</TableCell>
                                  <TableCell className="text-right font-mono text-green-500">${data.stats.tips.toFixed(2)}</TableCell>
                                  <TableCell className="text-right font-mono font-bold text-primary bg-primary/5">${data.stats.totalPay.toFixed(2)}</TableCell>
                                  <TableCell className={cn("text-right font-mono font-bold", data.stats.netProfit >= 0 ? 'text-green-600' : 'text-destructive')}>${data.stats.netProfit.toFixed(2)}</TableCell>
                              </TableRow>
                          ))}
                      </TableBody>
                      <TableFooter>
                          <TableRow><TableCell colSpan={6} className="font-semibold">Total Gross Revenue</TableCell><TableCell className="text-right font-mono font-semibold">${totalGrossRevenue.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={7} className="pt-0 pb-2 text-xs text-muted-foreground">Total revenue from all sales before any costs.</TableCell></TableRow>
                          
                          <TableRow><TableCell colSpan={6} className="text-muted-foreground pl-8">Cost of Goods Sold (COGS)</TableCell><TableCell className="text-right font-mono text-destructive">-${totalCOGS.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={7} className="pt-0 pb-2 text-xs text-muted-foreground pl-8">Direct costs of products used in services.</TableCell></TableRow>

                          <TableRow className="font-bold border-t"><TableCell colSpan={6}>Gross Profit</TableCell><TableCell className="text-right font-mono">${grossProfit.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={7} className="pt-0 pb-2 text-xs text-muted-foreground">Profit after subtracting the direct cost of services.</TableCell></TableRow>

                          <TableRow><TableCell colSpan={7} className="py-2"></TableCell></TableRow>
                          
                          <TableRow><TableCell colSpan={6} className="font-semibold">Operating Expenses</TableCell><TableCell></TableCell></TableRow>
                          <TableRow><TableCell colSpan={7} className="pt-0 pb-2 text-xs text-muted-foreground">Day-to-day costs of running the business.</TableCell></TableRow>

                          <TableRow><TableCell colSpan={6} className="text-muted-foreground pl-8">Service Wages</TableCell><TableCell className="text-right font-mono text-destructive">-${payrollTotals.totalWages.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={6} className="text-muted-foreground pl-8">Retail Commission</TableCell><TableCell className="text-right font-mono text-destructive">-${payrollTotals.totalRetailCommission.toFixed(2)}</TableCell></TableRow>
                          
                          <TableRow className="font-bold border-t"><TableCell colSpan={6}>Operating Profit</TableCell><TableCell className={cn("text-right font-mono", payrollTotals.totalNetProfit >= 0 ? 'text-primary' : 'text-destructive')}>${payrollTotals.totalNetProfit.toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={7} className="pt-0 pb-2 text-xs text-muted-foreground">Profit after payroll and direct service costs.</TableCell></TableRow>

                          <TableRow><TableCell colSpan={7} className="py-2"></TableCell></TableRow>
                          
                          <TableRow><TableCell colSpan={6} className="font-semibold">Overhead Expenses</TableCell><TableCell className="text-right font-mono text-destructive">-${periodOverhead.toFixed(2)}</TableCell></TableRow>
                           <TableRow><TableCell colSpan={7} className="pt-0 pb-2 text-xs text-muted-foreground">Your fixed business and personal costs for the period.</TableCell></TableRow>

                          <TableRow className="font-bold text-lg bg-muted/50"><TableCell colSpan={6}>True Net Profit</TableCell><TableCell className={cn("text-right font-mono", (payrollTotals.totalNetProfit - periodOverhead) >= 0 ? 'text-primary' : 'text-destructive')}>${(payrollTotals.totalNetProfit - periodOverhead).toFixed(2)}</TableCell></TableRow>
                          <TableRow><TableCell colSpan={7} className="pt-0 pb-2 text-xs text-muted-foreground">The final profit after all costs and overhead.</TableCell></TableRow>
                      </TableFooter>
                  </Table>
              </CardContent>
          </Card>
          
          <Card>
              <CardHeader><CardTitle>Service Performance</CardTitle><CardDescription>Breakdown of performance by individual service.</CardDescription></CardHeader>
              <CardContent>
                  <Table>
                      <TableHeader><TableRow><TableHead>Service</TableHead><TableHead className="text-right"># Bookings</TableHead><TableHead className="text-right">Avg. Time</TableHead><TableHead className="text-right">Total Revenue</TableHead></TableRow></TableHeader>
                      <TableBody>
                          {servicePerformanceData.map(service => (
                              <TableRow key={service.id}>
                                  <TableCell className="font-medium">{service.name}</TableCell>
                                  <TableCell className="text-right font-mono">{service.totalBookings}</TableCell>
                                  <TableCell className="text-right font-mono">{service.avgTime.toFixed(0)} min</TableCell>
                                  <TableCell className="text-right font-mono">${service.totalRevenue.toFixed(2)}</TableCell>
                              </TableRow>
                          ))}
                      </TableBody>
                  </Table>
              </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Stylist Effectiveness</CardTitle>
                <CardDescription>
                  Analysis of key performance indicators by staff member.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff Member</TableHead>
                      <TableHead className="text-right">Utilization</TableHead>
                      <TableHead className="text-right">Avg. Ticket</TableHead>
                      <TableHead className="text-right">Retail Attach</TableHead>
                      <TableHead className="text-right">Time Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {performanceAndPayrollData.map(data => (
                      <TableRow key={data.id}>
                        <TableCell className="font-medium">{data.name}</TableCell>
                        <TableCell className="text-right font-mono">{data.stats.utilizationRate.toFixed(1)}%</TableCell>
                        <TableCell className="text-right font-mono">${data.stats.avgSalePerAppointment.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono">{data.stats.retailAttachmentRate.toFixed(1)}%</TableCell>
                        <TableCell className={cn('text-right font-mono text-xs', data.stats.avgVariance > 0 ? 'text-destructive' : 'text-green-500')}>
                          {data.stats.avgVariance > 0 ? '+' : ''}{data.stats.avgVariance.toFixed(1)} min
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Booking Source</CardTitle>
                    <CardDescription>Breakdown of appointments by how they were booked.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                    <ChartContainer config={{}} className="h-[250px] w-[250px]">
                        <RechartsPieChart>
                            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                            <Pie data={bookingSourceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
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
            kpiData={salonWideStats}
            payrollData={performanceAndPayrollData}
            payrollTotals={payrollTotals}
            grossProfit={grossProfit}
            totalGrossRevenue={totalGrossRevenue}
            totalCOGS={totalCOGS}
            periodOverhead={periodOverhead}
            servicePerformanceData={servicePerformanceData}
        />
      </div>

      <style jsx global>{`
        @media print {
          .no-print {
            display: none;
          }
          .print-only {
            display: block;
          }
        }
      `}</style>
    </>
  );
}
