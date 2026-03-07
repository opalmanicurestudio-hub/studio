
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
  Calendar as CalendarIcon,
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
  ChevronRight,
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
import { collection, query, where, Timestamp, doc, writeBatch, deleteField } from 'firebase/firestore';
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
import { motion } from 'framer-motion';

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

const barChartConfig = {
  profit: {
    label: 'Profit',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig;

const pieChartConfig = {
  services: {
    label: 'Services',
    color: 'hsl(var(--primary))',
  },
  retail: {
    label: 'Retail',
    color: 'hsl(var(--accent))',
  },
  tips: {
    label: 'Tips',
    color: 'hsl(var(--muted-foreground))',
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
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-2 border-primary/10 bg-primary/[0.02] shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary">
              Today's Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-primary opacity-40" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-10 w-32"/> : <div className="text-3xl font-black tracking-tighter text-primary">${todaysRevenue.toFixed(2)}</div>}
            {!isLoading && (
                <div className="mt-1 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-primary" />
                    <span className="text-[10px] font-bold text-primary uppercase">
                        {profitPercentage >= 0 ? '+' : ''}{profitPercentage.toFixed(0)}% from yesterday
                    </span>
                </div>
            )}
          </CardContent>
        </Card>
        
        <Card className="border-2 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Sessions
            </CardTitle>
            <CalendarIcon className="h-4 w-4 text-muted-foreground opacity-40" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black tracking-tighter text-slate-900">
              {isLoading ? <Skeleton className="h-10 w-10 inline-block" /> : todayAppointments?.length || 0}
            </div>
             {!isLoading && <p className="text-[10px] font-bold uppercase text-muted-foreground opacity-60 mt-1">{todayAppointments?.filter((a: any) => a.status === 'completed').length || 0} COMPLETED &middot; {todayAppointments?.filter((a: any) => a.status !== 'completed').length || 0} REMAINING</p>}
          </CardContent>
        </Card>

        <Card className={cn("border-2 shadow-sm", totalOutstandingDebt > 0 ? "border-destructive/20 bg-destructive/[0.02]" : "bg-muted/10")}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Outstanding Debt</CardTitle>
            <Wallet className={cn("h-4 w-4 opacity-40", totalOutstandingDebt > 0 ? "text-destructive" : "text-muted-foreground")} />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-10 w-20 inline-block"/> : <div className={cn("text-3xl font-black tracking-tighter", totalOutstandingDebt > 0 ? "text-destructive" : "text-slate-900")}>${totalOutstandingDebt.toFixed(2)}</div>}
            <p className="text-[10px] font-bold uppercase text-muted-foreground opacity-60 mt-1">Across all client logs</p>
          </CardContent>
        </Card>

        <Card className="border-2 border-accent/10 bg-accent/[0.02] shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-teal-700">Client Retention</CardTitle>
            <HeartHandshake className="h-4 w-4 text-accent opacity-40" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-10 w-20 inline-block"/> : <div className="text-3xl font-black tracking-tighter text-teal-700">{clientRetentionRate.toFixed(0)}%</div>}
            <p className="text-[10px] font-bold uppercase text-teal-600/60 mt-1">All-time repeat rate</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 grid-cols-1 md:grid-cols-5">
        <Card className="md:col-span-3 border-2 shadow-sm overflow-hidden">
          <CardHeader className="p-6 border-b bg-muted/5">
            <CardTitle className="text-sm font-black uppercase tracking-widest">Weekly Profit Yield</CardTitle>
            <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">Revenue vs Overhead across 7 days.</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <ClientOnly>
              <ChartContainer config={barChartConfig} className="h-[300px] w-full">
                {isLoading ? <Skeleton className="w-full h-full rounded-xl" /> : (
                    <BarChart accessibilityLayer data={barChartData}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.1} />
                    <XAxis
                        dataKey="day"
                        tickLine={false}
                        tickMargin={10}
                        axisLine={false}
                        className="font-black uppercase text-[10px]"
                    />
                    <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickMargin={10}
                        tickFormatter={(value) => `$${value}`}
                        className="font-bold text-[10px]"
                    />
                    <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent className="rounded-xl border-2" />}
                    />
                    <Bar dataKey="profit" fill="var(--color-profit)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                )}
              </ChartContainer>
            </ClientOnly>
          </CardContent>
        </Card>

         <Card className="md:col-span-2 border-2 shadow-sm overflow-hidden flex flex-col">
          <CardHeader className="p-6 border-b bg-muted/5">
            <CardTitle className="text-sm font-black uppercase tracking-widest">Revenue Mix</CardTitle>
            <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">Services vs. Retail vs. Tips.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col items-center justify-center p-6">
            <ClientOnly>
              <ChartContainer
                config={pieChartConfig}
                className="mx-auto aspect-square h-[220px]"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel className="rounded-xl border-2" />}
                  />
                  <Pie data={revenueBreakdown} dataKey="value" nameKey="name" innerRadius={65} strokeWidth={4}>
                    {revenueBreakdown.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                   <ChartLegend content={<ChartLegendContent nameKey="name" className="font-black uppercase text-[10px] tracking-widest" />} />
                </PieChart>
              </ChartContainer>
            </ClientOnly>
          </CardContent>
        </Card>

        <Card className="md:col-span-5 border-2 shadow-sm overflow-hidden">
          <CardHeader className="p-6 border-b bg-muted/5 flex flex-row items-center justify-between">
            <div className="space-y-1">
                <CardTitle className="text-sm font-black uppercase tracking-widest">Recent Activity</CardTitle>
                <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">Latest sessions and client transactions.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild className="h-8 rounded-xl font-black uppercase text-[10px] tracking-widest">
                <Link href="/planner">View Full Agenda <ChevronRight className="ml-1 h-3 w-3" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={`skeleton-${index}`} className="flex items-center gap-4 p-4 border-b last:border-b-0">
                  <Skeleton className="h-10 w-10 rounded-2xl" />
                  <div className="grid gap-1 flex-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-6 w-16" />
                </div>
              ))
            ) : (
              <div className="divide-y">
                {recentActivities.map(({ apt, client, service }: any) => {
                    if (!client || !service) return null;
                    return (
                    <div key={apt.id} className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors">
                        <Avatar className="h-10 w-10 border-2 rounded-2xl shadow-sm">
                        <AvatarImage src={client.avatarUrl || undefined} alt="Avatar" className="object-cover" />
                        <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">
                            {client.name.split(' ').map((n: string) => n[0]).join('').substring(0,2).toUpperCase()}
                        </AvatarFallback>
                        </Avatar>
                        <div className="grid gap-0.5 min-w-0">
                        <p className="text-sm font-black uppercase tracking-tight text-slate-900 truncate">
                            {client.name}
                        </p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate">
                            {service.name} &middot; {format(safeDate(apt.startTime), 'MMM d @ h:mm a')}
                        </p>
                        </div>
                        <div className="ml-auto flex flex-col items-end gap-1">
                            <p className="font-black font-mono text-sm text-primary">
                                +${(service.price).toFixed(2)}
                            </p>
                            <Badge variant="secondary" className="h-4 px-1.5 text-[8px] font-black uppercase tracking-tighter border-none">
                                {apt.status}
                            </Badge>
                        </div>
                    </div>
                    );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

       <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/10 overflow-hidden relative group">
          <div className="absolute top-0 right-0 p-8 opacity-5 transition-opacity group-hover:opacity-10">
            <Sparkles className="w-32 h-32 text-primary" />
          </div>
          <CardHeader className="p-8 pb-4">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-primary rounded-xl">
                    <Sparkles className="w-5 h-5 text-white" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Intelligence Hub</span>
            </div>
            <CardTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter">AI-Powered CFO Debrief</CardTitle>
            <CardDescription className="text-sm font-medium text-slate-600 max-w-lg">Get a strategic summary of today's performance, inventory needs, and actionable growth insights.</CardDescription>
          </CardHeader>
          <CardContent className="p-8 pt-4">
            <Button
              size="lg"
              className="h-14 rounded-2xl px-10 text-lg font-black uppercase tracking-tight shadow-xl shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95"
              onClick={onGenerateDebrief}
            >
              Generate Today's Insights
            </Button>
          </CardContent>
        </Card>
    </div>
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
                    staffUpdate = { onBreak: false, breakStartTime: deleteField() as any };
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
          return <Button size="lg" className="w-full h-16 rounded-2xl text-lg font-black uppercase shadow-xl" onClick={() => handleStatusChangeInitiate('clock_in')}>Clock In</Button>;
        }
        if (staffMember.onBreak) {
          return <Button size="lg" variant="outline" className="w-full h-16 rounded-2xl text-lg font-black uppercase border-2 shadow-sm" onClick={() => handleStatusChangeInitiate('break_end')}><Coffee className="mr-2 h-5 w-5"/>End Break</Button>;
        }
        return (
          <div className="grid grid-cols-2 gap-4">
            <Button size="lg" variant="outline" className="h-16 rounded-2xl text-base font-black uppercase border-2" onClick={() => handleStatusChangeInitiate('break_start')}>Start Break</Button>
            <Button size="lg" variant="destructive" className="h-16 rounded-2xl text-base font-black uppercase shadow-xl" onClick={() => handleStatusChangeInitiate('clock_out')}>Clock Out</Button>
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
      <div className="space-y-8 animate-in fade-in duration-700">
        <Card className="text-center border-2 shadow-2xl rounded-[3rem] overflow-hidden bg-primary/[0.02] border-primary/10">
          <CardHeader className="p-10 pb-6">
            <div className="p-3 bg-primary/10 rounded-full w-fit mx-auto mb-4 border border-primary/20">
                <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-4xl md:text-6xl font-black tracking-tighter uppercase text-slate-900">Hello, {staffMember?.name?.split(' ')[0] || 'Staff'}!</CardTitle>
            {staffMember && (
                 <Badge variant={staffMember.active ? (staffMember.onBreak ? 'secondary' : 'default') : 'outline'} className={cn("capitalize w-fit mx-auto mt-4 h-7 px-4 rounded-full font-black uppercase text-[10px] tracking-[0.2em] border-2 shadow-sm", {
                    'bg-green-500 text-white border-none': staffMember.active && !staffMember.onBreak,
                    'bg-amber-500 text-white border-none': staffMember.active && staffMember.onBreak,
                 })}>
                    {staffMember.active ? (staffMember.onBreak ? 'On Break' : 'Clocked In') : 'Clocked Out'}
                </Badge>
            )}
          </CardHeader>
          <CardContent className="px-10 pb-6">
            {renderActionButtons()}
          </CardContent>
          <CardFooter className="px-10 pb-10">
            <Button variant="ghost" className="w-full font-black uppercase tracking-widest text-[10px] text-muted-foreground hover:bg-primary/5" onClick={onViewActivity}>My Performance Activity</Button>
          </CardFooter>
        </Card>
  
        <div className="grid gap-6 md:grid-cols-3">
             <Card className="border-2 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><Wallet className="w-3 h-3 text-primary" />Today's Take-Home</CardTitle>
                </CardHeader>
                <CardContent><p className="text-3xl font-black tracking-tighter text-slate-900">${todayKpis.earnings.toFixed(2)}</p><p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60 mt-1">Est. base + tips</p></CardContent>
            </Card>
            <Card className="border-2 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><DollarSign className="w-3 h-3 text-primary" />Gifts & Tips</CardTitle>
                </CardHeader>
                <CardContent><p className="text-3xl font-black tracking-tighter text-slate-900">${todayKpis.tips.toFixed(2)}</p><p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60 mt-1">From completed work</p></CardContent>
            </Card>
            <Card className="border-2 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><CalendarIcon className="w-3 h-3 text-primary" />Sessions Done</CardTitle>
                </CardHeader>
                <CardContent><p className="text-3xl font-black tracking-tighter text-slate-900">{todayKpis.completed}</p><p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60 mt-1">Completed appointments</p></CardContent>
            </Card>
        </div>
        
        <Card className="border-2 shadow-xl rounded-[2.5rem] overflow-hidden">
            <CardHeader className="p-8 border-b bg-muted/5"><CardTitle className="text-lg font-black uppercase tracking-tight">Today's Agenda</CardTitle></CardHeader>
            <CardContent className="p-8">
                {nextAppointment && (
                    <div className="mb-8 p-6 border-2 border-primary bg-primary/5 rounded-[2rem] space-y-6 shadow-2xl shadow-primary/5">
                         <div className="flex items-center justify-between">
                            <Badge className="bg-primary text-white border-none uppercase font-black tracking-[0.2em] text-[9px] h-6 px-3">Up Next</Badge>
                            {nextAppointment.checkInStatus === 'arrived' && (
                                <Badge className="bg-green-500 hover:bg-green-600 border-none uppercase font-black text-[9px] h-6 px-3 shadow-lg shadow-green-500/20">
                                    <MapPin className="w-3 h-3 mr-1.5" />
                                    Guest Arrived
                                </Badge>
                            )}
                            {nextAppointment.checkInStatus === 'running_late' && (
                                <Badge className="bg-amber-500 hover:bg-amber-600 border-none uppercase font-black text-[9px] h-6 px-3 shadow-lg shadow-amber-500/20 animate-pulse">
                                    <Clock className="w-3 h-3 mr-1.5" />
                                    +{nextAppointment.lateTimeMinutes}m Late
                                </Badge>
                            )}
                         </div>
                        <div className="flex items-center gap-6">
                            <Avatar className="h-16 w-16 border-4 border-background shadow-xl rounded-2xl">
                                <AvatarImage src={nextAppointment.client?.avatarUrl || undefined} className="object-cover" />
                                <AvatarFallback className="font-black text-xl bg-primary/10 text-primary">{getInitials(nextAppointment.client?.name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                                <p className="font-black text-2xl uppercase tracking-tighter leading-none mb-1 truncate">{nextAppointment.client?.name}</p>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate">{nextAppointment.service?.name}</p>
                            </div>
                            <div className="ml-auto text-right shrink-0">
                                <p className="font-black text-xl text-primary tracking-tighter font-mono">{format(safeDate(nextAppointment.startTime), 'h:mm a')}</p>
                            </div>
                        </div>
                        <Button asChild className="w-full h-14 rounded-2xl text-base font-black uppercase shadow-xl shadow-primary/20 group">
                            <Link href={`/planner?view=staff&staffId=${staffMember?.id}`}>
                                Start Consultation <ChevronRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                            </Link>
                        </Button>
                    </div>
                )}
                {upcomingAppointments.length > 0 ? (
                    <div className="space-y-4">
                        {upcomingAppointments.map((apt: any) => (
                            <div key={apt.id} className="flex items-center gap-4 p-4 rounded-2xl border-2 border-transparent hover:border-primary/10 hover:bg-primary/[0.02] transition-all group">
                                <Avatar className="h-12 w-12 border-2 rounded-2xl shadow-sm">
                                    <AvatarImage src={apt.client?.avatarUrl || undefined} alt={apt.client?.name || ''} className="object-cover" />
                                    <AvatarFallback className="font-black text-xs bg-muted text-muted-foreground">{getInitials(apt.client?.name)}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{apt.client?.name}</p>
                                        {apt.checkInStatus === 'arrived' && <div className="w-2 h-2 rounded-full bg-green-500 shadow-sm" title="Arrived" />}
                                        {apt.checkInStatus === 'running_late' && <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shadow-sm" title={`Late (+${apt.lateTimeMinutes}m)`} />}
                                    </div>
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate">{apt.service?.name}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="font-black text-sm font-mono tracking-tighter text-slate-900">{format(safeDate(apt.startTime), 'h:mm a')}</p>
                                    {apt.isWalkIn && <Badge variant="secondary" className="text-[8px] h-4 px-1.5 border-none font-black uppercase tracking-tighter bg-primary/10 text-primary">Walk-in</Badge>}
                                </div>
                                {apt.status === 'confirmed' ? (
                                    <Button size="sm" onClick={() => handleStartService(apt.id)} className="shrink-0 h-9 rounded-xl font-bold uppercase text-[10px] tracking-widest shadow-md">
                                        Start
                                    </Button>
                                ) : apt.status === 'servicing' ? (
                                    <Button size="sm" variant="outline" disabled className="shrink-0 h-9 rounded-xl font-black uppercase text-[10px] tracking-widest">Active</Button>
                                ) : (
                                    <Button variant="ghost" size="icon" asChild className="shrink-0 h-9 w-9 rounded-xl">
                                        <Link href="/planner">
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Link>
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-20 border-2 border-dashed rounded-[2rem] opacity-40">
                        <CalendarIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="text-sm font-black uppercase tracking-widest text-muted-foreground">End of Agenda</p>
                    </div>
                )}
            </CardContent>
        </Card>

        <Dialog open={isPinAuthOpen} onOpenChange={setIsPinAuthOpen}>
            <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle className="flex items-center gap-3 text-2xl font-black uppercase tracking-tighter">
                        <KeyRound className="w-6 h-6 text-primary" />
                        Security Verify
                    </DialogTitle>
                    <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Authorize status transition with your studio PIN.</DialogDescription>
                </DialogHeader>
                <div className="py-10 flex flex-col items-center space-y-6">
                    <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">Your 4-Digit PIN</Label>
                    <div className="relative w-48">
                        <Input 
                            type="password" 
                            maxLength={4} 
                            className="text-center text-4xl font-black h-20 tracking-[0.5em] bg-muted/30 border-4 rounded-3xl focus-visible:ring-primary/20" 
                            value={authPin} 
                            onChange={(e) => setAuthPin(e.target.value.replace(/\D/g, ''))}
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleVerifyPin()}
                        />
                    </div>
                </div>
                <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
                    <Button onClick={handleVerifyPin} disabled={authPin.length < 4} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/20">Verify & Confirm</Button>
                    <Button variant="ghost" onClick={() => setIsPinAuthOpen(false)} className="w-full font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
      </div>
    );
};

export default function DashboardPage() {
  const { firestore, user } = useFirebase();
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
    const tips = allTransactions.reduce((acc, t) => {
        if (t.category === 'Tips') return acc + t.amount;
        return acc + (t.tipAmount || 0);
    }, 0);
    return [
      { name: 'services', value: serviceRevenue, fill: 'hsl(var(--primary))' },
      { name: 'retail', value: retailRevenue, fill: 'hsl(var(--accent))' },
      { name: 'tips', value: tips, fill: 'hsl(var(--muted-foreground) / 0.4)' },
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
    
    const tips = transactionsToday.reduce((acc, t) => {
        if (t.category === 'Tips') return acc + t.amount;
        return acc + (t.tipAmount || 0);
    }, 0);

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
        if (apt.actualStartTime && apt.actualEndTime && s) totalInServiceMinutes += differenceInMinutes(safeDate(apt.actualEndTime), safeDate(apt.actualStartTime));
        else if (s) totalInServiceMinutes += s.duration;
    });
    const staffTransactions = allTransactions.filter(t => t.staffId === staffMember.id && filterByDate(safeDate(t.date)));
    const serviceRevenue = staffTransactions.filter(t => t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0);
    const retailSales = staffTransactions.filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
    
    const tips = staffTransactions.reduce((acc, t) => {
        if (t.category === 'Tips') return acc + t.amount;
        return acc + (t.tipAmount || 0);
    }, 0);

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

  const isLoadingTotal = isTenantLoading || isInventoryLoading || transactionsLoading || todayAppointmentsLoading || weeklyTransactionsLoading || !dateRange;

  if(isLoadingTotal) {
    return (
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader />
            <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8 justify-center items-center">
                <Loader className="w-8 h-8 animate-spin text-primary" />
            </main>
        </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <AppHeader title="Studio Dashboard" />
      <main className="flex flex-1 flex-col gap-8 p-4 md:gap-10 md:p-10 max-w-7xl mx-auto w-full">
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
        <DialogContent className="sm:max-w-lg rounded-[3rem] border-4">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter">End-of-Day Analysis</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Your AI-powered strategic summary.</DialogDescription>
          </DialogHeader>
          <div className="p-8">
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center gap-4 py-10">
                <Loader className="h-10 w-10 animate-spin text-primary" />
                <span className="text-[10px] font-black uppercase tracking-widest text-primary">Synthesizing Data...</span>
              </div>
            ) : <p className="text-sm leading-relaxed font-medium text-slate-700 whitespace-pre-wrap">{debriefContent}</p>}
          </div>
          <DialogFooter className="p-6 pt-0">
            <Button type="button" variant="outline" className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px]" onClick={() => setIsDebriefDialogOpen(false)}>Close Debrief</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
