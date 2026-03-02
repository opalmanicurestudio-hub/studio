
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import {
  Users,
  Calendar,
  DollarSign,
  ArrowUp,
  Sparkles,
  Loader,
  TrendingUp,
  HeartHandshake,
  Clock,
  MoreHorizontal,
  Coffee,
  Play,
  Wallet,
  MapPin,
  Car,
  KeyRound,
} from 'lucide-react';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartConfig,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Pie, PieChart, Cell } from 'recharts';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type Appointment, type Transaction, type Service, Staff, ActivityLog } from '@/lib/data';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { endOfDayDebrief } from '@/ai/flows/end-of-day-debrief';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { useCollection, useFirebase, useMemoFirebase, useUser, useDoc, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, query, where, Timestamp, doc, writeBatch } from 'firebase/firestore';
import { startOfDay, endOfDay, subDays, format, startOfWeek, isPast, parseISO, differenceInMinutes, addDays, differenceInDays, formatDistanceToNow, isSameDay } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { useTenant } from '@/context/TenantContext';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { StaffDetailsSheet } from '@/components/staff/StaffDetailsSheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Utility to safely convert potential strings, Timestamps or Date objects into valid Date instances.
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
    return new Date(val);
};

const barChartConfig = {
  profit: {
    label: 'Profit',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig;

const pieChartConfig = {
  services: {
    label: 'Services',
    color: 'hsl(var(--chart-1))',
  },
  retail: {
    label: 'Retail',
    color: 'hsl(var(--chart-2))',
  },
  tips: {
    label: 'Tips',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig;


type Activity = {
  apt: Appointment;
  client: { name: string; avatarUrl: string; } | undefined;
  service: { name: string; profit: number; } | undefined;
};

const OwnerDashboard = () => {
  const [isDebriefDialogOpen, setIsDebriefDialogOpen] = useState(false);
  const [debriefContent, setDebriefContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();
  
  const { firestore, user, isUserLoading } = useFirebase();
  const { inventory, clients, services, appointments: allAppointments, transactions: allTransactions } = useInventory();
  const { selectedTenant, isLoading: isTenantLoading } = useTenant();
  
  const tenantId = selectedTenant?.id;
  
  const [dateRange, setDateRange] = useState<{todayStart: Date, todayEnd: Date, weekStart: Date} | null>(null);

  useEffect(() => {
    const now = new Date();
    setDateRange({
        todayStart: startOfDay(now),
        todayEnd: endOfDay(now),
        weekStart: startOfWeek(now, { weekStartsOn: 0 }),
    });
  }, []);

  const todayTransactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !dateRange || !tenantId) return null;
    return query(
      collection(firestore, 'tenants', tenantId, 'transactions'),
      where('date', '>=', Timestamp.fromDate(dateRange.todayStart)),
      where('date', '<=', Timestamp.fromDate(dateRange.todayEnd))
    );
  }, [firestore, user, dateRange, tenantId]);

  const todayAppointmentsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !dateRange || !tenantId) return null;
    return query(
      collection(firestore, 'tenants', tenantId, 'appointments'),
      where('startTime', '>=', Timestamp.fromDate(dateRange.todayStart)),
      where('startTime', '<=', Timestamp.fromDate(dateRange.todayEnd))
    );
  }, [firestore, user, dateRange, tenantId]);
  
  const weeklyTransactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !dateRange || !tenantId) return null;
    return query(
      collection(firestore, 'tenants', tenantId, 'transactions'),
      where('date', '>=', Timestamp.fromDate(dateRange.weekStart)),
      where('date', '<=', Timestamp.fromDate(dateRange.todayEnd))
    );
  }, [firestore, user, dateRange, tenantId]);


  const { data: todayTransactions, isLoading: transactionsLoading } = useCollection<Transaction>(todayTransactionsQuery);
  const { data: todayAppointments, isLoading: appointmentsLoading } = useCollection<Appointment>(todayAppointmentsQuery);
  const { data: weeklyTransactions, isLoading: weeklyTransactionsLoading } = useCollection<Transaction>(weeklyTransactionsQuery);

  const { todaysRevenue, todaysExpenses, profitPercentage } = useMemo(() => {
    if (!todayTransactions) return { todaysRevenue: 0, todaysExpenses: 0, profitPercentage: 0 };
    
    const revenue = todayTransactions
      .filter(t => t.type === 'income')
      .reduce((acc, t) => acc + t.amount, 0);
      
    const expenses = todayTransactions
      .filter(t => t.type === 'expense')
      .reduce((acc, t) => acc + t.amount, 0);

    const yesterdayRevenue = 812; 
    const percentage = yesterdayRevenue > 0 ? ((revenue - yesterdayRevenue) / yesterdayRevenue) * 100 : revenue > 0 ? 100 : 0;

    return { todaysRevenue: revenue, todaysExpenses: expenses, profitPercentage: percentage };
  }, [todayTransactions]);
  
  const barChartData = useMemo(() => {
    if (!weeklyTransactions) return [];
    
    const dailyData: { [key: string]: { revenue: number, expense: number } } = {};
    const now = new Date();
    for (let i = 0; i < 7; i++) {
        const day = subDays(now, i);
        const dayKey = format(day, 'yyyy-MM-0dd');
        dailyData[dayKey] = { revenue: 0, expense: 0 };
    }

    weeklyTransactions.forEach(t => {
        const dayKey = format(safeDate(t.date), 'yyyy-MM-dd');
        if (dailyData[dayKey]) {
            if (t.type === 'income') dailyData[dayKey].revenue += t.amount;
            if (t.type === 'expense') dailyData[dayKey].expense += t.amount;
        }
    });

    return Object.entries(dailyData)
        .map(([date, { revenue, expense }]) => ({
            day: format(new Date(date), 'EEE'),
            profit: revenue - expense,
        }))
        .reverse();

  }, [weeklyTransactions]);
  
   const newClientsThisWeek = useMemo(() => {
    if (!allAppointments || !clients || !dateRange) return 0;

    const startOfWeekDate = dateRange.weekStart;
    let newClientCount = 0;
    const clientsWithAppointmentsThisWeek = new Set<string>();

    allAppointments
      .filter(apt => safeDate(apt.startTime) >= startOfWeekDate)
      .forEach(apt => clientsWithAppointmentsThisWeek.add(apt.clientId));

    clientsWithAppointmentsThisWeek.forEach(clientId => {
      const clientAppointments = allAppointments.filter(apt => apt.clientId === clientId);
      if (clientAppointments.length === 1 && safeDate(clientAppointments[0].startTime) >= startOfWeekDate) {
        newClientCount++;
      }
    });

    return newClientCount;
  }, [allAppointments, clients, dateRange]);
  
   const clientRetentionRate = useMemo(() => {
    if (!clients || clients.length === 0 || !allAppointments) return 0;
    const returningClients = clients.filter(client => {
      return allAppointments.filter(apt => apt.clientId === client.id).length > 1;
    }).length;

    return (returningClients / clients.length) * 100;
  }, [clients, allAppointments]);

  const totalOutstandingDebt = useMemo(() => {
      if (!clients) return 0;
      return clients.reduce((acc, c) => acc + (c.outstandingBalance || 0), 0);
  }, [clients]);

  const revenueBreakdown = useMemo(() => {
    if (!allTransactions) return [];
    
    const serviceRevenue = allTransactions
        .filter(t => t.type === 'income' && t.category === 'Service Revenue')
        .reduce((acc, t) => acc + t.amount, 0);

    const retailRevenue = allTransactions
        .filter(t => t.type === 'income' && t.category === 'Retail')
        .reduce((acc, t) => acc + t.amount, 0);

    const tips = allTransactions
        .filter(t => t.type === 'income' && t.category === 'Tips')
        .reduce((acc, t) => acc + t.amount, 0);

    return [
      { name: 'services', value: serviceRevenue, fill: 'var(--color-services)' },
      { name: 'retail', value: retailRevenue, fill: 'var(--color-retail)' },
      { name: 'tips', value: tips, fill: 'hsl(var(--primary))' },
    ];
  }, [allTransactions]);


  const recentActivities = useMemo(() => {
    if (!allAppointments) return [];
    return [...allAppointments]
        .sort((a, b) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime())
        .slice(0, 5)
        .map((apt) => ({
          apt,
          client: clients.find((c) => c.id === apt.clientId),
          service: services.find((s) => s.id === apt.serviceId),
        }))
        .filter(activity => activity.client && activity.service) as Activity[];
  }, [allAppointments, clients, services]);

  const handleGenerateDebrief = async () => {
    setIsGenerating(true);
    setDebriefContent('');
    try {
      const inventoryLevels = inventory
        .filter(item => item.type === 'professional')
        .slice(0, 5)
        .reduce((acc, item) => {
          acc[item.name] = item.totalStock;
          return acc;
        }, {} as Record<string, number>);

      const result = await endOfDayDebrief({
        dailyRevenue: todaysRevenue,
        dailyExpenses: todaysExpenses,
        inventoryLevels: inventoryLevels,
        completedAppointments: todayAppointments?.filter(a => a.status === 'completed').length || 0,
      });
      setDebriefContent(result.summary);
    } catch (error) {
      console.error('Error generating debrief:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate end-of-day debrief.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const isLoading = isUserLoading || isTenantLoading || transactionsLoading || appointmentsLoading || weeklyTransactionsLoading || !dateRange;

  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        {role === 'owner' ? <OwnerDashboard /> : <StaffDashboardView />}
      </main>
    </div>
  );
}

const StaffDashboardView = () => {
    const { user, isUserLoading } = useUser();
    const { selectedTenant } = useTenant();
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const { clients, services, staff, appointments, transactions, activityLogs, isLoading: isInventoryLoading } = useInventory();
    const [isDetailsSheetOpen, setIsDetailsSheetOpen] = useState(false);
    
    const [isPinAuthOpen, setIsPinAuthOpen] = useState(false);
    const [authPin, setAuthPin] = useState('');
    const [pendingAction, setPendingAction] = useState<'clock_in' | 'clock_out' | 'break_start' | 'break_end' | null>(null);

    const staffMember = useMemo(() => {
        if (!user || !staff) return null;
        return staff.find(s => s.id === user.uid);
    }, [user, staff]);
    
    const { start: periodStart, end: periodEnd, periodName } = useMemo(() => {
        const now = new Date();
        if (staffMember?.payStructure === 'commission' && staffMember.payoutFrequency === 'bi-weekly') {
            const epoch = new Date('2024-01-07T00:00:00.000Z'); 
            const diffDays = differenceInDays(now, epoch);
            const periodIndex = Math.floor(diffDays / 14);
            const start = addDays(epoch, periodIndex * 14);
            return { start: startOfDay(start), end: endOfDay(addDays(start, 13)), periodName: 'Pay Period' };
        }
        return { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfDay(now), periodName: 'This Week' };
    }, [staffMember]);

    const [todayRange, setTodayRange] = useState<{todayStart: Date, todayEnd: Date} | null>(null);

    useEffect(() => {
        const now = new Date();
        setTodayRange({
            todayStart: startOfDay(now),
            todayEnd: endOfDay(now),
        });
    }, []);

    const handleStartService = (appointmentId: string) => {
      if (!firestore || !selectedTenant?.id || !appointments) return;
      const tenantId = selectedTenant.id;
      const appointment = appointments.find(a => a.id === appointmentId);
      if (!appointment) return;

      const nowISO = new Date().toISOString();
      const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
      
      const batch = writeBatch(firestore);
      batch.update(appointmentRef, {
          status: 'servicing',
          actualStartTime: nowISO
      });

      if (appointment.checkInToken) {
          const checkInRef = doc(firestore, 'appointmentCheckIns', appointment.checkInToken);
          batch.update(checkInRef, { status: 'servicing' });
      }
      
      if (appointment.staffId) {
          const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId);
          batch.update(staffDocRef, { status: 'busy' });
      }
      
      if(appointment.isWalkIn) {
          const walkInId = appointment.id.replace('apt-walkin-', '');
          const walkInRef = doc(firestore, `tenants/${tenantId}/walkIns`, walkInId);
          batch.update(walkInRef, {
              status: 'servicing',
              serviceStartTime: nowISO,
          });
      }

      batch.commit().then(() => {
          toast({ title: "Service Started" });
      });
    };

    const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
        if (!firestore || !selectedTenant?.id) return;
        const tenantId = selectedTenant.id;
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
        
        const batch = writeBatch(firestore);
        batch.update(appointmentRef, {
            status: 'ready_for_checkout',
            checkoutState,
            actualEndTime: new Date().toISOString(),
        });
        
        const appointment = appointments?.find(a => a.id === appointmentId);
        if (appointment?.checkInToken) {
            const checkInRef = doc(firestore, 'appointmentCheckIns', appointment.checkInToken);
            batch.update(checkInRef, { status: 'ready_for_checkout' });
        }

        if (appointment?.staffId) {
            const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId);
            batch.update(staffDocRef, { status: 'idle' });
        }

        batch.commit().then(() => {
            toast({ title: "Service Finished", description: "Client sent to front desk." });
            setIsDetailsSheetOpen(false);
        });
    };

    const upcomingAppointments = useMemo(() => {
        if (!appointments || !user || !clients || !services || !todayRange) return [];
        const { todayStart, todayEnd } = todayRange;
        
        return appointments
            .filter(a => 
                a.staffId === user.uid && 
                (a.status === 'confirmed' || a.status === 'servicing') && 
                safeDate(a.startTime) >= todayStart && safeDate(a.startTime) <= todayEnd
            )
            .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(a.startTime).getTime())
            .map(apt => ({
                ...apt,
                client: clients.find(c => c.id === apt.clientId),
                service: services.find(s => s.id === apt.serviceId),
            }));
    }, [appointments, user, clients, services, todayRange]);

    const nextAppointment = upcomingAppointments?.find(apt => apt.status === 'confirmed');

    const handleStatusChangeInitiate = (action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
        setPendingAction(action);
        setIsPinAuthOpen(true);
    };

    const handleVerifyPin = () => {
        if (!staffMember || !pendingAction || !firestore || !selectedTenant) return;

        if (staffMember.pin === authPin) {
            const activityLogsRef = collection(firestore, 'tenants', selectedTenant.id, 'activityLogs');
            const staffDocRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', staffMember.id);
            const now = new Date().toISOString();
        
            let staffUpdate: Partial<Staff> = {};
            let logEntry: Omit<ActivityLog, 'id'> = { staffId: staffMember.id, type: pendingAction, timestamp: now };
        
            switch (pendingAction) {
                case 'clock_in': staffUpdate = { active: true }; break;
                case 'clock_out': staffUpdate = { active: false, onBreak: false, status: 'idle' }; break;
                case 'break_start': staffUpdate = { onBreak: true, breakStartTime: now }; break;
                case 'break_end':
                    if (staffMember.breakStartTime) {
                        const duration = differenceInMinutes(new Date(now), safeDate(staffMember.breakStartTime));
                        logEntry.durationMinutes = duration;
                    }
                    staffUpdate = { onBreak: false, breakStartTime: undefined };
                    break;
            }
        
            addDocumentNonBlocking(activityLogsRef, logEntry);
            updateDocumentNonBlocking(staffDocRef, staffUpdate);
            
            setIsPinAuthOpen(false);
            setAuthPin('');
            setPendingAction(null);
            toast({ title: "Status Updated" });
        } else {
            toast({ variant: 'destructive', title: "Invalid PIN" });
        }
    };

    const renderActionButtons = () => {
        if (!staffMember) return null;
        if (!staffMember.active) {
          return <Button size="lg" className="w-full h-12" onClick={() => handleStatusChangeInitiate('clock_in')}>Clock In</Button>;
        }
        if (staffMember.onBreak) {
          return <Button size="lg" className="w-full h-12" onClick={() => handleStatusChangeInitiate('break_end')}><Coffee className="mr-2 h-4 w-4"/>End Break</Button>;
        }
        return (
          <div className="grid grid-cols-2 gap-4">
            <Button size="lg" variant="outline" onClick={() => handleStatusChangeInitiate('break_start')}>Start Break</Button>
            <Button size="lg" variant="destructive" onClick={() => handleStatusChangeInitiate('clock_out')}>Clock Out</Button>
          </div>
        );
      };
      
    const getInitials = (name?: string | null): string => {
        if (!name) return '?';
        const parts = name.split(' ');
        if (parts.length > 1 && parts[parts.length-1]) {
            return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

    const todayKpis = useMemo(() => {
        if (!transactions || !appointments || !staffMember || !todayRange) {
            return { revenue: 0, tips: 0, completed: 0, earnings: 0 };
        }
        const { todayStart, todayEnd } = todayRange;

        const appointmentsToday = appointments.filter(apt => 
            apt.staffId === staffMember.id &&
            safeDate(apt.startTime) >= todayStart &&
            safeDate(apt.startTime) <= todayEnd
        );

        const transactionsToday = transactions.filter(t => {
            const transactionDate = safeDate(t.date);
            return t.staffId === staffMember.id &&
                    transactionDate >= todayStart &&
                    transactionDate <= todayEnd;
        });
        
        const serviceRevenue = transactionsToday
            .filter(t => t.category === 'Service Revenue')
            .reduce((sum, t) => sum + t.amount, 0);

        const tips = transactionsToday
            .filter(t => t.category === 'Tips')
            .reduce((sum, t) => sum + t.amount, 0);

        const completed = appointmentsToday.filter(a => a.status === 'completed').length;
        
        let earnings = 0;
        if (staffMember.payStructure === 'commission') {
            earnings = serviceRevenue * ((staffMember.commissionRate || 0) / 100);
        } 

        const retailSales = transactionsToday
            .filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);

        const retailCommission = retailSales * ((staffMember.retailCommissionRate || 0) / 100);
        earnings += tips + retailCommission;
        
        return { revenue: serviceRevenue, tips, completed, earnings };

    }, [transactions, appointments, staffMember, todayRange]);

    const staffMemberWithStats = useMemo(() => {
      if (!staffMember || !appointments || !services || !transactions || !activityLogs) return null;
  
      const fromDate = subDays(new Date(), 29);
      const toDate = new Date();
  
      const filterByDate = (date: Date) => {
          if (fromDate && date < fromDate) return false;
          if (toDate && date > toDate) return false;
          return true;
      };
  
      const staffAppointments = appointments.filter(apt => apt.staffId === staffMember.id && filterByDate(safeDate(apt.startTime)));
      const completedAppointments = staffAppointments.filter(apt => apt.status === 'completed');
      const completedAppointmentsCount = completedAppointments.length;
    
      let totalMinutesVariance = 0;
      let totalInServiceMinutes = 0;
      completedAppointments.forEach(apt => {
          const service = services.find(s => s.id === apt.serviceId);
          if (apt.actualStartTime && apt.actualEndTime && service) {
              const actualDuration = differenceInMinutes(safeDate(apt.actualEndTime), safeDate(apt.actualStartTime));
              totalMinutesVariance += actualDuration - service.duration;
              totalInServiceMinutes += actualDuration;
          }
      });
    
      const avgVariance = completedAppointmentsCount > 0 ? totalMinutesVariance / completedAppointmentsCount : 0;
      const avgActualServiceTime = completedAppointmentsCount > 0 ? totalInServiceMinutes / completedAppointmentsCount : 0;
    
      const staffTransactions = transactions.filter(t => t.staffId === staffMember.id && filterByDate(safeDate(t.date)));
      
      const serviceRevenue = staffTransactions.filter(t => t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0);
      const retailSales = staffTransactions.filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
      const totalSales = serviceRevenue + retailSales;
      const tips = staffTransactions.filter(t => t.category === 'Tips').reduce((acc, t) => acc + t.amount, 0);
      
      const retailTransactionsWithAppointment = staffTransactions.filter(t => t.category === 'Retail' && t.appointmentId);
      const retailAttachmentRate = completedAppointmentsCount > 0 ? (new Set(retailTransactionsWithAppointment.map(t => t.appointmentId)).size / completedAppointmentsCount) * 100 : 0;
      const avgSalePerAppointment = completedAppointmentsCount > 0 ? totalSales / completedAppointmentsCount : 0;

      let totalMinutesWorked = 0;
      const staffLogs = activityLogs.filter(log => log.staffId === staffMember.id && filterByDate(safeDate(log.timestamp)));
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
          const hoursWorked = totalMinutesWorked / 60;
          wages = hoursWorked * staffMember.hourlyRate;
      }

      const retailCommission = retailSales * ((staffMember.retailCommissionRate || 0) / 100);
      const totalPay = wages + tips + retailCommission;
      
      return {
          ...staffMember,
          stats: {
              totalSales,
              tips,
              earnings: totalPay,
              consumptionValue: 0,
              totalHours: totalMinutesWorked / 60,
              utilizationRate,
              avgSalePerAppointment,
              retailAttachmentRate,
              avgVariance,
          }
      };

    }, [staffMember, appointments, services, transactions, activityLogs]);


    const handleViewActivity = () => {
        setIsDetailsSheetOpen(true);
    };

    if (isUserLoading || isInventoryLoading) {
        return <Loader className="animate-spin" />;
    }
  
    return (
      <div className="space-y-6">
        <Card className="text-center">
          <CardHeader>
            <CardTitle className="text-3xl">Welcome, {staffMember?.name?.split(' ')[0] || 'Staff'}!</CardTitle>
            {staffMember && (
                 <Badge variant={staffMember.active ? (staffMember.onBreak ? 'secondary' : 'default') : 'outline'} className={cn("capitalize w-fit mx-auto", {
                    'bg-green-100 text-green-800 dark:bg-green-900/50': staffMember.active && !staffMember.onBreak,
                    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50': staffMember.active && staffMember.onBreak,
                 })}>
                    {staffMember.active ? (staffMember.onBreak ? 'On Break' : 'Clocked In') : 'Clocked Out'}
                </Badge>
            )}
          </CardHeader>
          <CardContent>
            {renderActionButtons()}
          </CardContent>
          <CardFooter>
            <Button variant="secondary" className="w-full" onClick={handleViewActivity}>View My Activity</Button>
          </CardFooter>
        </Card>
  
        <div className="grid gap-4 md:grid-cols-3">
             <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Today's Earnings</CardTitle><Wallet className="h-4 w-4 text-muted-foreground"/></CardHeader>
                <CardContent><p className="text-2xl font-bold">${todayKpis.earnings.toFixed(2)}</p><p className="text-xs text-muted-foreground">Est. based on completed work & tips</p></CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Today's Tips</CardTitle><DollarSign className="h-4 w-4 text-muted-foreground"/></CardHeader>
                <CardContent><p className="text-2xl font-bold">${todayKpis.tips.toFixed(2)}</p><p className="text-xs text-muted-foreground">From completed appointments</p></CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Completed Today</CardTitle><Calendar className="h-4 w-4 text-muted-foreground"/></CardHeader>
                <CardContent><p className="text-2xl font-bold">{todayKpis.completed}</p><p className="text-xs text-muted-foreground">Completed appointments</p></CardContent>
            </Card>
        </div>
        
        <Card>
            <CardHeader><CardTitle>Today's Agenda</CardTitle></CardHeader>
            <CardContent>
                {nextAppointment && (
                    <div className="mb-4 p-3 border-2 border-primary bg-primary/5 rounded-lg space-y-3">
                         <div className="flex items-center justify-between">
                            <Badge>Up Next</Badge>
                            {nextAppointment.checkInStatus === 'arrived' && (
                                <Badge className="bg-green-500 hover:bg-green-600 border-none uppercase font-black text-[9px] h-5">
                                    <MapPin className="w-3 h-3 mr-1" />
                                    Arrived
                                </Badge>
                            )}
                            {nextAppointment.checkInStatus === 'running_late' && (
                                <Badge className="bg-amber-500 hover:bg-amber-600 border-none uppercase font-black text-[9px] h-5 animate-pulse">
                                    <Clock className="w-3 h-3 mr-1" />
                                    +{nextAppointment.lateTimeMinutes}m Late
                                </Badge>
                            )}
                            {nextAppointment.checkInStatus === 'on_my_way' && (
                                <Badge className="bg-blue-500 hover:bg-blue-600 border-none uppercase font-black text-[9px] h-5">
                                    <Car className="w-3 h-3 mr-1" />
                                    On Way
                                </Badge>
                            )}
                         </div>
                        <div className="flex items-center gap-4">
                            <Avatar className="h-12 w-12"><AvatarImage src={nextAppointment.client?.avatarUrl || undefined} /><AvatarFallback>{getInitials(nextAppointment.client?.name)}</AvatarFallback></Avatar>
                            <div>
                                <p className="font-semibold">{nextAppointment.client?.name}</p>
                                <p className="text-sm text-muted-foreground">{nextAppointment.service?.name}</p>
                            </div>
                            <div className="ml-auto text-right">
                                <p className="font-bold">{format(safeDate(nextAppointment.startTime), 'h:mm a')}</p>
                            </div>
                        </div>
                        <Button asChild className="w-full">
                            <Link href={`/planner?view=staff&staffId=${user?.uid}`}>
                                View Details
                            </Link>
                        </Button>
                    </div>
                )}
                {upcomingAppointments.length > 0 ? (
                    <div className="space-y-2">
                        {upcomingAppointments.map((apt) => (
                            <div key={apt.id} className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50">
                                <Avatar className="h-10 w-10">
                                    <AvatarImage src={apt.client?.avatarUrl || undefined} alt={apt.client?.name || ''} />
                                    <AvatarFallback>{getInitials(apt.client?.name)}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className="font-medium truncate">{apt.client?.name}</p>
                                    {apt.checkInStatus === 'arrived' && <div className="w-2 h-2 rounded-full bg-green-500" title="Arrived" />}
                                    {apt.checkInStatus === 'running_late' && <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title={`Late (+${apt.lateTimeMinutes}m)`} />}
                                </div>
                                <p className="text-sm text-muted-foreground truncate">{apt.service?.name}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="font-medium">{format(safeDate(apt.startTime), 'h:mm a')}</p>
                                    {apt.isWalkIn && <Badge variant="secondary" className="text-[9px] uppercase font-black">Walk-in</Badge>}
                                </div>
                                {apt.status === 'confirmed' ? (
                                    <Button size="sm" onClick={() => handleStartService(apt.id)} className="shrink-0">
                                        <Play className="w-4 h-4 mr-2" />
                                        Start
                                    </Button>
                                ) : apt.status === 'servicing' ? (
                                    <Button size="sm" variant="outline" disabled className="shrink-0">In Service</Button>
                                ) : (
                                    <Button variant="ghost" size="icon" asChild className="shrink-0">
                                        <Link href="/planner">
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Link>
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-center text-muted-foreground py-8">No upcoming appointments today.</p>
                )}
            </CardContent>
        </Card>
        {staffMemberWithStats && (
            <StaffDetailsSheet
                open={isDetailsSheetOpen}
                onOpenChange={setIsDetailsSheetOpen}
                staffMember={staffMemberWithStats}
                dateRange={todayRange ? { from: todayRange.todayStart, to: todayRange.todayEnd } : undefined}
                transactions={transactions || []}
                services={services || []}
                appointments={appointments || []}
                activityLogs={activityLogs || []}
                consentForms={[]}
            />
        )}

        <Dialog open={isPinAuthOpen} onOpenChange={setIsPinAuthOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <KeyRound className="w-5 h-5 text-primary" />
                        Authorize Status Change
                    </DialogTitle>
                    <DialogDescription>Enter your unique 4-digit PIN to confirm.</DialogDescription>
                </DialogHeader>
                <div className="py-6 flex flex-col items-center space-y-4">
                    <Label className="text-sm font-black uppercase tracking-widest text-muted-foreground">Verification PIN</Label>
                    <div className="relative w-48">
                        <Input 
                            type="password" 
                            maxLength={4} 
                            className="text-center text-3xl font-black h-16 tracking-[0.5em] bg-muted/50 border-2" 
                            value={authPin} 
                            onChange={(e) => setAuthPin(e.target.value.replace(/\D/g, ''))}
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleVerifyPin()}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsPinAuthOpen(false)}>Cancel</Button>
                    <Button onClick={handleVerifyPin} disabled={authPin.length < 4}>Verify & Confirm</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
      </div>
    );
};

export default function DashboardPage() {
  const { role, isLoading } = useTenant();

  if(isLoading) {
    return (
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader />
            <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8 justify-center items-center">
                <Loader className="w-8 h-8 animate-spin" />
            </main>
        </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        {role === 'owner' ? <OwnerDashboard /> : <StaffDashboardView />}
      </main>
    </div>
  );
}
