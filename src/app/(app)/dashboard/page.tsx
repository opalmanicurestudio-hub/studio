
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
import { type Appointment, type Transaction, type Service, Staff, ActivityLog, AppointmentCheckoutState } from '@/lib/data';
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
import { useCollection, useFirebase, useMemoFirebase, useUser, useDoc, setDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, query, where, Timestamp, doc, writeBatch } from 'firebase/firestore';
import { startOfDay, endOfDay, subDays, format, startOfWeek, isSameDay, parseISO, differenceInMinutes, addDays, differenceInDays, formatDistanceToNow } from 'date-fns';
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
    // Handle Firestore Timestamp like object { seconds, nanoseconds }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
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


const OwnerDashboard = ({ 
  todaysRevenue, 
  profitPercentage, 
  totalOutstandingDebt, 
  clientRetentionRate, 
  todayAppointments, 
  isLoading,
  barChartData,
  revenueBreakdown,
  recentActivities,
  onGenerateDebrief 
}: any) => {
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
            {!isLoading && <p className="text-xs text-muted-foreground">
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
             {!isLoading && <p className="text-xs text-muted-foreground">{todayAppointments?.filter((a: any) => a.status === 'completed').length || 0} completed, {todayAppointments?.filter((a: any) => a.status !== 'completed').length || 0} upcoming</p>}
          </CardContent>
        </Card>
        <Card className={cn(totalOutstandingDebt > 0 && "border-destructive/50 bg-destructive/[0.02]")}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outstanding Debt</CardTitle>
            <Wallet className={cn("h-4 w-4", totalOutstandingDebt > 0 ? "text-destructive" : "text-muted-foreground")} />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20 inline-block"/> : <div className={cn("text-2xl font-bold", totalOutstandingDebt > 0 && "text-destructive")}>${totalOutstandingDebt.toFixed(2)}</div>}
            <p className="text-xs text-muted-foreground">Across all client profiles</p>
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
                    {revenueBreakdown.map((entry: any, index: number) => (
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
                <div key={`skeleton-${index}`} className="flex items-center gap-4">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="grid gap-1 flex-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="h-5 w-16" />
                </div>
              ))
            ) : (
              recentActivities.map(({ apt, client, service }: any) => {
                if (!client || !service) return null;
                return (
                  <div key={apt.id} className="flex items-center gap-4">
                    <Avatar className="hidden h-9 w-9 sm:flex">
                      <AvatarImage src={client.avatarUrl || undefined} alt="Avatar" />
                      <AvatarFallback>
                        {client.name.split(' ').map((n: string) => n[0]).join('').substring(0,2)}
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
                      +${(service.price - (service.cost || 0)).toFixed(2)}
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
              onClick={onGenerateDebrief}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Today's Debrief
            </Button>
          </CardContent>
        </Card>
    </>
  );
};

const StaffDashboardView = ({ staffMember, upcomingAppointments, todayKpis, onViewActivity }: any) => {
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const { toast } = useToast();
    const [isPinAuthOpen, setIsPinAuthOpen] = useState(false);
    const [authPin, setAuthPin] = useState('');
    const [pendingAction, setPendingAction] = useState<'clock_in' | 'clock_out' | 'break_start' | 'break_end' | null>(null);

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
            let logEntry: any = { staffId: staffMember.id, type: pendingAction, timestamp: now };
        
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
            setDocumentNonBlocking(staffDocRef, staffUpdate, { merge: true });
            
            setIsPinAuthOpen(false);
            setAuthPin('');
            setPendingAction(null);
            toast({ title: "Status Updated" });
        } else {
            toast({ variant: 'destructive', title: "Invalid PIN" });
        }
    };

    const handleStartService = (appointmentId: string) => {
      if (!firestore || !selectedTenant?.id) return;
      const tenantId = selectedTenant.id;
      const nowISO = new Date().toISOString();
      const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
      
      const batch = writeBatch(firestore);
      batch.update(appointmentRef, {
          status: 'servicing',
          actualStartTime: nowISO
      });

      if (staffMember?.id) {
          const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffMember.id);
          batch.set(staffDocRef, { status: 'busy' }, { merge: true });
      }

      batch.commit().then(() => {
          toast({ title: "Service Started" });
      });
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

    const nextAppointment = upcomingAppointments?.find((apt: any) => apt.status === 'confirmed');

    return (
      <div className="space-y-6">
        <Card className="text-center">
          <CardHeader>
            <CardTitle className="text-3xl">Welcome, {staffMember?.name?.split(' ')[0] || 'Staff'}!</CardTitle>
            {staffMember && (
                 <Badge variant={staffMember.active ? (staffMember.onBreak ? 'secondary' : 'default') : 'outline'} className={cn("capitalize w-fit mx-auto", {
                    'bg-green-100 text-green-800 dark:bg-green-900/50': staffMember.active && !staffMember.onBreak,
                    'bg-yellow-100 text-yellow-800 dark:bg-green-900/50': staffMember.active && staffMember.onBreak,
                 })}>
                    {staffMember.active ? (staffMember.onBreak ? 'On Break' : 'Clocked In') : 'Clocked Out'}
                </Badge>
            )}
          </CardHeader>
          <CardContent>
            {renderActionButtons()}
          </CardContent>
          <CardFooter>
            <Button variant="secondary" className="w-full" onClick={onViewActivity}>View My Activity</Button>
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
                            <Link href={`/planner?view=staff&staffId=${staffMember?.id}`}>
                                View Details
                            </Link>
                        </Button>
                    </div>
                )}
                {upcomingAppointments.length > 0 ? (
                    <div className="space-y-2">
                        {upcomingAppointments.map((apt: any) => (
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
  const { firestore, user, isUserLoading } = useFirebase();
  const { selectedTenant, role, isLoading: isTenantLoading } = useTenant();
  const { staff, inventory, clients, services, appointments: allAppointments, transactions: allTransactions, activityLogs, isLoading: isInventoryLoading } = useInventory();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();

  const [dateRange, setDateRange] = useState<{todayStart: Date, todayEnd: Date, weekStart: Date} | null>(null);
  const [isDetailsSheetOpen, setIsDetailsSheetOpen] = useState(false);
  const [isDebriefDialogOpen, setIsDebriefDialogOpen] = useState(false);
  const [debriefContent, setDebriefContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

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
  const { data: todayAppointments, isLoading: todayAppointmentsLoading } = useCollection<Appointment>(todayAppointmentsQuery);
  const { data: weeklyTransactions, isLoading: weeklyTransactionsLoading } = useCollection<Transaction>(weeklyTransactionsQuery);

  const { todaysRevenue, profitPercentage } = useMemo(() => {
    if (!todayTransactions) return { todaysRevenue: 0, profitPercentage: 0 };
    const revenue = todayTransactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
    const yesterdayRevenue = 812; 
    const percentage = yesterdayRevenue > 0 ? ((revenue - yesterdayRevenue) / yesterdayRevenue) * 100 : revenue > 0 ? 100 : 0;
    return { todaysRevenue: revenue, profitPercentage: percentage };
  }, [todayTransactions]);

  const barChartData = useMemo(() => {
    if (!weeklyTransactions) return [];
    const dailyData: { [key: string]: { revenue: number, expense: number } } = {};
    const now = new Date();
    for (let i = 0; i < 7; i++) {
        const day = subDays(now, i);
        const dayKey = format(day, 'yyyy-MM-dd');
        dailyData[dayKey] = { revenue: 0, expense: 0 };
    }
    weeklyTransactions.forEach(t => {
        const dayKey = format(safeDate(t.date), 'yyyy-MM-dd');
        if (dailyData[dayKey]) {
            if (t.type === 'income') dailyData[dayKey].revenue += t.amount;
            if (t.type === 'expense') dailyData[dayKey].expense += t.amount;
        }
    });
    return Object.entries(dailyData).map(([date, { revenue, expense }]) => ({ day: format(new Date(date), 'EEE'), profit: revenue - expense })).reverse();
  }, [weeklyTransactions]);

  const clientRetentionRate = useMemo(() => {
    if (!clients || clients.length === 0 || !allAppointments) return 0;
    const returningClients = clients.filter(client => allAppointments.filter(apt => apt.clientId === client.id).length > 1).length;
    return (returningClients / clients.length) * 100;
  }, [clients, allAppointments]);

  const totalOutstandingDebt = useMemo(() => (clients || []).reduce((acc, c) => acc + (c.outstandingBalance || 0), 0), [clients]);

  const revenueBreakdown = useMemo(() => {
    if (!allTransactions) return [];
    const serviceRevenue = allTransactions.filter(t => t.type === 'income' && t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0);
    const retailRevenue = allTransactions.filter(t => t.type === 'income' && t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
    const tips = allTransactions.filter(t => t.type === 'income' && t.category === 'Tips').reduce((acc, t) => acc + t.amount, 0);
    return [
      { name: 'services', value: serviceRevenue, fill: 'var(--color-services)' },
      { name: 'retail', value: retailRevenue, fill: 'var(--color-retail)' },
      { name: 'tips', value: tips, fill: 'hsl(var(--primary))' },
    ];
  }, [allTransactions]);

  const recentActivities = useMemo(() => {
    if (!allAppointments) return [];
    return [...allAppointments].sort((a, b) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime()).slice(0, 5).map((apt) => ({
          apt,
          client: clients.find((c) => c.id === apt.clientId),
          service: services.find((s) => s.id === apt.serviceId),
        })).filter(activity => activity.client && activity.service);
  }, [allAppointments, clients, services]);

  const staffMember = useMemo(() => (user && staff) ? staff.find(s => s.id === user.uid) : null, [user, staff]);

  const todayKpis = useMemo(() => {
    if (!allTransactions || !allAppointments || !staffMember || !dateRange) return { revenue: 0, tips: 0, completed: 0, earnings: 0 };
    const { todayStart, todayEnd } = dateRange;
    const staffAppointmentsToday = allAppointments.filter(apt => apt.staffId === staffMember.id && safeDate(apt.startTime) >= todayStart && safeDate(apt.startTime) <= todayEnd);
    const transactionsToday = allTransactions.filter(t => {
        const d = safeDate(t.date);
        return t.staffId === staffMember.id && d >= todayStart && d <= todayEnd;
    });
    const serviceRevenue = transactionsToday.filter(t => t.category === 'Service Revenue').reduce((sum, t) => sum + t.amount, 0);
    const tips = transactionsToday.filter(t => t.category === 'Tips').reduce((sum, t) => sum + t.amount, 0);
    const completed = staffAppointmentsToday.filter(a => a.status === 'completed').length;
    let earnings = (staffMember.payStructure === 'commission') ? (serviceRevenue * ((staffMember.commissionRate || 0) / 100)) : 0;
    const retailSales = transactionsToday.filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
    earnings += tips + (retailSales * ((staffMember.retailCommissionRate || 0) / 100));
    return { revenue: serviceRevenue, tips, completed, earnings };
  }, [allTransactions, allAppointments, staffMember, dateRange]);

  const upcomingAppointments = useMemo(() => {
    if (!allAppointments || !user || !clients || !services || !dateRange) return [];
    const { todayStart, todayEnd } = dateRange;
    return allAppointments.filter(a => a.staffId === user.uid && (a.status === 'confirmed' || a.status === 'servicing') && safeDate(a.startTime) >= todayStart && safeDate(a.startTime) <= todayEnd)
        .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime())
        .map(apt => ({ ...apt, client: clients.find(c => c.id === apt.clientId), service: services.find(s => s.id === apt.serviceId) }));
  }, [allAppointments, user, clients, services, dateRange]);

  const handleGenerateDebrief = async () => {
    setIsGenerating(true);
    setDebriefContent('');
    try {
      const result = await endOfDayDebrief({
        dailyRevenue: todaysRevenue,
        dailyExpenses: 0,
        inventoryLevels: inventory.filter(item => item.type === 'professional').slice(0, 5).reduce((acc, item) => { acc[item.name] = item.totalStock; return acc; }, {} as any),
        completedAppointments: todayAppointments?.filter(a => a.status === 'completed').length || 0,
      });
      setDebriefContent(result.summary);
      setIsDebriefDialogOpen(true);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to generate debrief.' });
    } finally { setIsGenerating(false); }
  };

  const staffMemberWithStats = useMemo(() => {
    if (!staffMember || !allAppointments || !services || !allTransactions || !activityLogs) return null;
    const fromDate = subDays(new Date(), 29);
    const toDate = new Date();
    const filterByDate = (d: Date) => d >= fromDate && d <= toDate;
    const staffAppointments = allAppointments.filter(apt => apt.staffId === staffMember.id && filterByDate(safeDate(apt.startTime)));
    const completedAppointments = staffAppointments.filter(apt => apt.status === 'completed');
    let totalInServiceMinutes = 0;
    completedAppointments.forEach(apt => {
        const s = services.find(sv => sv.id === apt.serviceId);
        if (apt.actualStartTime && apt.actualEndTime) totalInServiceMinutes += differenceInMinutes(safeDate(apt.actualEndTime), safeDate(apt.actualStartTime));
        else if (s) totalInServiceMinutes += s.duration;
    });
    const staffTransactions = allTransactions.filter(t => t.staffId === staffMember.id && filterByDate(safeDate(t.date)));
    const serviceRevenue = staffTransactions.filter(t => t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0);
    const retailSales = staffTransactions.filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
    const tips = staffTransactions.filter(t => t.category === 'Tips').reduce((acc, t) => acc + t.amount, 0);
    let totalMinutesWorked = 0;
    const sortedLogs = activityLogs.filter(log => log.staffId === staffMember.id && filterByDate(safeDate(log.timestamp))).sort((a,b) => safeDate(a.timestamp).getTime() - safeDate(b.timestamp).getTime());
    let clockInTime: Date | null = null;
    let totalBreakMinutes = 0;
    for (const log of sortedLogs) {
        const logTime = safeDate(log.timestamp);
        if (log.type === 'clock_in') { if (clockInTime) totalMinutesWorked += differenceInMinutes(logTime, clockInTime) - totalBreakMinutes; clockInTime = logTime; totalBreakMinutes = 0; }
        else if (log.type === 'clock_out' && clockInTime) { totalMinutesWorked += differenceInMinutes(logTime, clockInTime) - totalBreakMinutes; clockInTime = null; }
        else if (log.type === 'break_end' && log.durationMinutes) totalBreakMinutes += log.durationMinutes;
    }
    if(clockInTime) totalMinutesWorked += differenceInMinutes(new Date(), clockInTime) - totalBreakMinutes;
    let wages = (staffMember.payStructure === 'commission') ? (serviceRevenue * ((staffMember.commissionRate || 0) / 100)) : (staffMember.payStructure === 'hourly' && staffMember.hourlyRate ? (totalMinutesWorked / 60) * staffMember.hourlyRate : 0);
    const earnings = wages + tips + (retailSales * ((staffMember.retailCommissionRate || 0) / 100));
    return { ...staffMember, stats: { totalSales: serviceRevenue + retailSales, tips, earnings, totalHours: totalMinutesWorked / 60, utilizationRate: totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0 } };
  }, [staffMember, allAppointments, services, allTransactions, activityLogs]);

  const isLoadingTotal = isUserLoading || isTenantLoading || isInventoryLoading || transactionsLoading || todayAppointmentsLoading || weeklyTransactionsLoading || !dateRange;

  if(isLoadingTotal) {
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
        {role === 'owner' ? (
          <OwnerDashboard 
            todaysRevenue={todaysRevenue}
            profitPercentage={profitPercentage}
            totalOutstandingDebt={totalOutstandingDebt}
            clientRetentionRate={clientRetentionRate}
            todayAppointments={todayAppointments}
            isLoading={isLoadingTotal}
            barChartData={barChartData}
            revenueBreakdown={revenueBreakdown}
            recentActivities={recentActivities}
            onGenerateDebrief={handleGenerateDebrief}
          />
        ) : (
          <StaffDashboardView 
            staffMember={staffMemberWithStats}
            upcomingAppointments={upcomingAppointments}
            todayKpis={todayKpis}
            onViewActivity={() => setIsDetailsSheetOpen(true)}
          />
        )}
      </main>
      {staffMemberWithStats && (
          <StaffDetailsSheet
              open={isDetailsSheetOpen}
              onOpenChange={setIsDetailsSheetOpen}
              staffMember={staffMemberWithStats}
              dateRange={dateRange ? { from: dateRange.todayStart, to: dateRange.todayEnd } : undefined}
              transactions={allTransactions || []}
              services={services || []}
              appointments={allAppointments || []}
              activityLogs={activityLogs || []}
              consentForms={[]}
          />
      )}
      <Dialog open={isDebriefDialogOpen} onOpenChange={setIsDebriefDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>End-of-Day Debrief</DialogTitle>
            <DialogDescription>Your AI-powered summary for today's performance.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {isGenerating ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader className="h-5 w-5 animate-spin" />
                <span>Generating your summary...</span>
              </div>
            ) : <p className="text-sm leading-relaxed">{debriefContent}</p>}
          </div>
          <DialogFooter><Button type="button" variant="secondary" onClick={() => setIsDebriefDialogOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
