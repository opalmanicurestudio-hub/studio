

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
  Coffee
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
import { collection, query, where, Timestamp, doc } from 'firebase/firestore';
import { startOfDay, endOfDay, subDays, format as formatDate, startOfWeek, isPast, parseISO, differenceInMinutes } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { useTenant } from '@/context/TenantContext';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import Link from 'next/link';

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
    // This code now runs only on the client, after the initial render.
    const now = new Date();
    setDateRange({
        todayStart: startOfDay(now),
        todayEnd: endOfDay(now),
        weekStart: startOfWeek(now, { weekStartsOn: 0 }),
    });
  }, []);

  // Queries for today's data
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
  
  // Query for the last 7 days of transactions for the chart
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

    const yesterdayRevenue = 812; // Mock data for percentage change, can be fetched if needed
    const percentage = yesterdayRevenue > 0 ? ((revenue - yesterdayRevenue) / yesterdayRevenue) * 100 : revenue > 0 ? 100 : 0;

    return { todaysRevenue: revenue, todaysExpenses: expenses, profitPercentage: percentage };
  }, [todayTransactions]);
  
  const barChartData = useMemo(() => {
    if (!weeklyTransactions) return [];
    
    const dailyData: { [key: string]: { revenue: number, expense: number } } = {};
    const now = new Date();
    for (let i = 0; i < 7; i++) {
        const day = subDays(now, i);
        const dayKey = formatDate(day, 'yyyy-MM-dd');
        dailyData[dayKey] = { revenue: 0, expense: 0 };
    }

    weeklyTransactions.forEach(t => {
        const dayKey = formatDate(new Date(t.date), 'yyyy-MM-dd');
        if (dailyData[dayKey]) {
            if (t.type === 'income') dailyData[dayKey].revenue += t.amount;
            if (t.type === 'expense') dailyData[dayKey].expense += t.amount;
        }
    });

    return Object.entries(dailyData)
        .map(([date, { revenue, expense }]) => ({
            day: formatDate(new Date(date), 'EEE'),
            profit: revenue - expense,
        }))
        .reverse();

  }, [weeklyTransactions]);
  
   const newClientsThisWeek = useMemo(() => {
    if (!allAppointments || !clients || !dateRange) return 0;

    const startOfWeekDate = dateRange.weekStart;
    let newClientCount = 0;
    const clientsWithAppointmentsThisWeek = new Set<string>();

    // Get all clients who had an appointment this week
    allAppointments
      .filter(apt => new Date(apt.startTime) >= startOfWeekDate)
      .forEach(apt => clientsWithAppointmentsThisWeek.add(apt.clientId));

    clientsWithAppointmentsThisWeek.forEach(clientId => {
      // Find all appointments for this client
      const clientAppointments = allAppointments.filter(apt => apt.clientId === clientId);
      
      // If they only have one appointment ever, and it's this week, they are new.
      // A more robust check might look at their all-time appointment history.
      if (clientAppointments.length === 1 && new Date(clientAppointments[0].startTime) >= startOfWeekDate) {
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

  const revenueBreakdown = useMemo(() => {
    if (!allTransactions) return [];
    
    const serviceRevenue = allTransactions
        .filter(t => t.type === 'income' && t.category === 'Service')
        .reduce((acc, t) => acc + t.amount, 0);

    const retailRevenue = allTransactions
        .filter(t => t.type === 'income' && t.category === 'Retail')
        .reduce((acc, t) => acc + t.amount, 0);

    return [
      { name: 'services', value: serviceRevenue, fill: 'var(--color-services)' },
      { name: 'retail', value: retailRevenue, fill: 'var(--color-retail)' },
    ];
  }, [allTransactions]);


  const recentActivities = useMemo(() => {
    if (!allAppointments) return [];
    return [...allAppointments]
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
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
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Today's Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-32"/> : <div className="text-2xl font-bold">${todaysRevenue.toFixed(2)}</div>}
            {isLoading ? <Skeleton className="h-4 w-24 mt-1"/> : <p className="text-xs text-muted-foreground">
              {profitPercentage >= 0 ? '+' : ''}{profitPercentage.toFixed(0)}% from yesterday
            </p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Today's Appointments
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? <Skeleton className="h-8 w-10 inline-block" /> : todayAppointments?.length || 0}
            </div>
             {isLoading ? <Skeleton className="h-4 w-32 mt-1"/> : <p className="text-xs text-muted-foreground">{todayAppointments?.filter(a => a.status === 'completed').length || 0} completed, {todayAppointments?.filter(a => a.status !== 'completed').length || 0} upcoming</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Clients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-10 inline-block"/> : <div className="text-2xl font-bold">+{newClientsThisWeek}</div>}
            <p className="text-xs text-muted-foreground">this week</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Client Retention</CardTitle>
            <HeartHandshake className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20 inline-block"/> : <div className="text-2xl font-bold">{clientRetentionRate.toFixed(0)}%</div>}
            <p className="text-xs text-muted-foreground">All-time repeat clients</p>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-5">
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle>Weekly Profit</CardTitle>
            <CardDescription>Your profit over the last 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ClientOnly>
              <ChartContainer config={barChartConfig} className="h-[300px] w-full">
                {isLoading ? <Skeleton className="w-full h-full" /> : (
                    <BarChart accessibilityLayer data={barChartData}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                        dataKey="day"
                        tickLine={false}
                        tickMargin={10}
                        axisLine={false}
                    />
                    <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickMargin={10}
                        tickFormatter={(value) => `$${value}`}
                    />
                    <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent />}
                    />
                    <Bar dataKey="profit" fill="var(--color-profit)" radius={8} />
                    </BarChart>
                )}
              </ChartContainer>
            </ClientOnly>
          </CardContent>
        </Card>
         <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Revenue Breakdown</CardTitle>
            <CardDescription>All-time revenue from services vs. retail.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex justify-center pb-4">
            <ClientOnly>
              <ChartContainer
                config={pieChartConfig}
                className="mx-auto aspect-square h-[250px]"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Pie data={revenueBreakdown} dataKey="value" nameKey="name" innerRadius={60}>
                    {revenueBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                   <ChartLegend content={<ChartLegendContent nameKey="name" />} />
                </PieChart>
              </ChartContainer>
            </ClientOnly>
          </CardContent>
        </Card>
        <Card className="md:col-span-5">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>
              Recent appointments and client activity.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="flex items-center gap-4">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="grid gap-1 flex-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="h-5 w-16" />
                </div>
              ))
            ) : (
              recentActivities.map(({ apt, client, service }) => {
                if (!client || !service) return null;
                return (
                  <div key={apt.id} className="flex items-center gap-4">
                    <Avatar className="hidden h-9 w-9 sm:flex">
                      <AvatarImage src={client.avatarUrl} alt="Avatar" />
                      <AvatarFallback>
                        {client.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid gap-1">
                      <p className="text-sm font-medium leading-none">
                        {client.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {service.name}
                      </p>
                    </div>
                    <div className="ml-auto font-medium text-primary">
                      +${service.profit.toFixed(2)}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
       <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-4">
            <CardTitle>End-of-Day Debrief</CardTitle>
            <CardDescription>Get an AI summary of your day's performance and inventory needs.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => {
                setIsDebriefDialogOpen(true);
                handleGenerateDebrief();
              }}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Today's Debrief
            </Button>
          </CardContent>
        </Card>
        <Dialog
        open={isDebriefDialogOpen}
        onOpenChange={setIsDebriefDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>End-of-Day Debrief</DialogTitle>
            <DialogDescription>
              Here is your AI-powered summary for today's performance.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {isGenerating && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader className="h-5 w-5 animate-spin" />
                <span>Generating your summary...</span>
              </div>
            )}
            {debriefContent && (
              <p className="text-sm leading-relaxed">{debriefContent}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsDebriefDialogOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const StaffDashboardView = () => {
    const { user, isUserLoading } = useUser();
    const { clients, services, appointments, transactions, activityLogs, staff, isLoading: isInventoryLoading } = useInventory();
    
    const staffMember = useMemo(() => {
        if (!user || !staff) return null;
        return staff.find(s => s.id === user.uid);
    }, [user, staff]);

    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    const appointmentsToday = useMemo(() => {
      if (!appointments || !user) return [];
      return appointments.filter(apt => 
        apt.staffId === user.uid &&
        new Date(apt.startTime) >= todayStart &&
        new Date(apt.startTime) <= todayEnd
      );
    }, [appointments, user, todayStart, todayEnd]);

    const transactionsToday = useMemo(() => {
        if (!transactions || !user) return [];
        return transactions.filter(t => {
            const transactionDate = new Date(t.date);
            return t.staffId === user.uid &&
                   transactionDate >= todayStart &&
                   transactionDate <= todayEnd;
        });
    }, [transactions, user, todayStart, todayEnd]);

    const kpis = useMemo(() => {
        if (!transactionsToday || !appointmentsToday) {
            return { revenue: 0, tips: 0, completed: 0 };
        }
        const revenue = transactionsToday
            .filter(t => t.type === 'income' && t.category === 'Service Revenue')
            .reduce((sum, t) => sum + t.amount, 0);
        const tips = transactionsToday.reduce((sum, t) => sum + (t.tipAmount || 0), 0);
        const completed = appointmentsToday.filter(a => a.status === 'completed').length;
        return { revenue, tips, completed };
    }, [transactionsToday, appointmentsToday]);

    const upcomingAppointments = useMemo(() => {
        if (!appointmentsToday || !clients || !services) return [];
        return appointmentsToday
            .filter(a => a.status !== 'completed' && a.status !== 'cancelled')
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
            .map(apt => ({
                ...apt,
                client: clients.find(c => c.id === apt.clientId),
                service: services.find(s => s.id === apt.serviceId),
            }));
    }, [appointmentsToday, clients, services]);

    const nextAppointment = upcomingAppointments?.[0];

    const handleStatusChange = (action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
        if (!staffMember?.id || !selectedTenant?.id) return;
        const firestore = useFirebase().firestore;
    
        const activityLogsRef = collection(firestore, 'tenants', selectedTenant.id, 'activityLogs');
        const staffDocRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', staffMember.id);
        const now = new Date().toISOString();
    
        let staffUpdate: Partial<Staff> = {};
        let logEntry: Omit<ActivityLog, 'id'> = { staffId: staffMember.id, type: action, timestamp: now };
    
        switch (action) {
            case 'clock_in': staffUpdate = { active: true }; break;
            case 'clock_out': staffUpdate = { active: false, onBreak: false, status: 'idle' }; break;
            case 'break_start': staffUpdate = { onBreak: true, breakStartTime: now }; break;
            case 'break_end':
                if (staffMember.breakStartTime) {
                    const duration = differenceInMinutes(new Date(now), parseISO(staffMember.breakStartTime));
                    logEntry.durationMinutes = duration;
                }
                staffUpdate = { onBreak: false, breakStartTime: undefined };
                break;
        }
    
        addDocumentNonBlocking(activityLogsRef, logEntry);
        updateDocumentNonBlocking(staffDocRef, staffUpdate);
    };

    const renderActionButtons = () => {
        if (!staffMember) return null;
        if (!staffMember.active) {
          return <Button size="lg" className="w-full h-12" onClick={() => handleStatusChange('clock_in')}>Clock In</Button>;
        }
        if (staffMember.onBreak) {
          return <Button size="lg" className="w-full h-12" onClick={() => handleStatusChange('break_end')}><Coffee className="mr-2 h-4 w-4"/>End Break</Button>;
        }
        return (
          <div className="grid grid-cols-2 gap-4">
            <Button size="lg" variant="outline" onClick={() => handleStatusChange('break_start')}>Start Break</Button>
            <Button size="lg" variant="destructive" onClick={() => handleStatusChange('clock_out')}>Clock Out</Button>
          </div>
        );
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
        </Card>
  
        <div className="grid gap-4 md:grid-cols-3">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Today's Revenue</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">${kpis.revenue.toFixed(2)}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Tips Earned</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">${kpis.tips.toFixed(2)}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Appointments</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{kpis.completed}</p></CardContent></Card>
        </div>
        
        {nextAppointment ? (
          <Card className="border-primary ring-2 ring-primary/50">
            <CardHeader><CardTitle>Up Next</CardTitle></CardHeader>
            <CardContent>
                <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12"><AvatarImage src={nextAppointment.client?.avatarUrl} /><AvatarFallback>{nextAppointment.client?.name.charAt(0)}</AvatarFallback></Avatar>
                    <div>
                    <p className="font-semibold">{nextAppointment.client?.name}</p>
                    <p className="text-sm text-muted-foreground">{nextAppointment.service?.name}</p>
                    </div>
                    <div className="ml-auto text-right">
                    <p className="font-bold">{formatDate(new Date(nextAppointment.startTime), 'h:mm a')}</p>
                    </div>
                </div>
            </CardContent>
            <CardFooter>
                <Button asChild className="w-full">
                   <Link href={`/planner?view=staff&staffId=${user?.uid}`}>
                     View Details
                   </Link>
                </Button>
            </CardFooter>
          </Card>
        ) : <p className="text-center text-muted-foreground pt-4">No upcoming appointments today.</p>}
  
        <Card>
          <CardHeader><CardTitle>Today's Schedule</CardTitle></CardHeader>
          <CardContent>
            {upcomingAppointments.length > 0 ? (
              <div className="space-y-4">
                {upcomingAppointments.map((apt) => (
                  <div key={apt.id} className="flex items-center gap-4 p-2 rounded-md hover:bg-muted/50">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-bold">{formatDate(new Date(apt.startTime), 'h:mm a')}</div>
                    <div className="flex-1">
                      <p className="font-medium">{apt.client?.name}</p>
                      <p className="text-sm text-muted-foreground">{apt.service?.name}</p>
                    </div>
                    <Button variant="ghost" size="icon" asChild>
                        <Link href="/planner">
                           <MoreHorizontal className="h-4 w-4" />
                        </Link>
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No upcoming appointments today.</p>
            )}
          </CardContent>
        </Card>
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

