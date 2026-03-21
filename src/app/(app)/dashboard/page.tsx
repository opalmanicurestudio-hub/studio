
'use client';

import React, { useState, useMemo } from 'react';
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
  Landmark,
  Globe,
  Phone,
  Smartphone,
  Square,
  CheckCircle2,
  Check,
  ArrowRight,
  ShieldAlert,
  Activity,
  PackageX,
  Zap,
  TrendingDown,
  User as UserIcon,
  Timer
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type Appointment, type Transaction, type Service, Staff, ActivityLog, InventoryItem, WalkIn, RefreshmentRequest } from '@/lib/data';
import { Button } from '@/components/ui/button';
import { useFirebase, useCollection, useMemoFirebase, useUser, updateDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc, writeBatch, increment, arrayUnion } from 'firebase/firestore';
import { startOfDay, endOfDay, format, isSameDay, parseISO, differenceInMinutes, isToday } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { useTenant } from '@/context/TenantContext';
import { Badge } from '@/components/ui/badge';
import { cn, safeNumber } from '@/lib/utils';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import Image from 'next/image';

const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeForFirestore(v)])
  );
};

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

const RefreshmentQueue = ({ requests, inventory, user, onDeliver, staff }: any) => {
    if (!requests || requests.length === 0) return (
        <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
            <Coffee className="w-12 h-12" />
            <p className="text-[10px] font-black uppercase tracking-widest">No hospitality requests</p>
        </div>
    );

    return (
        <div className="space-y-4">
            <AnimatePresence>
                {requests.map((request: any) => {
                    const item = inventory.find((i: any) => i.id === request.itemId);
                    return (
                        <motion.div 
                            key={request.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="flex flex-col sm:flex-row items-center justify-between p-6 rounded-[2.5rem] border-2 bg-white shadow-sm hover:border-primary/20 transition-all gap-6 group"
                        >
                            <div className="flex flex-col sm:flex-row items-center gap-6 text-left w-full sm:w-auto">
                                <div className="p-4 bg-primary/5 rounded-2xl shadow-inner border border-primary/10 relative shrink-0">
                                    {item?.imageUrl ? (
                                        <div className="relative w-10 h-10">
                                            <Image src={item.imageUrl} alt={item.name} fill className="object-cover rounded-lg" />
                                        </div>
                                    ) : (
                                        <Coffee className="w-8 h-8 text-primary" />
                                    )}
                                    <div className="absolute -top-2 -right-2 bg-primary text-white rounded-full p-1 shadow-lg h-6 w-6 flex items-center justify-center font-black text-[10px]">
                                        {request.quantity || 1}
                                    </div>
                                </div>
                                <div className="space-y-1 text-left w-full sm:w-auto">
                                    <div className="flex items-center gap-3">
                                        <p className="font-black text-xl uppercase tracking-tighter text-slate-900">{request.itemName}</p>
                                        <Badge variant="outline" className="h-5 px-2 bg-primary/10 text-primary border-none font-black text-[10px]">{request.quantity || 1} UNIT(S)</Badge>
                                    </div>
                                    
                                    {item?.formula && item.formula.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-2 mb-3 text-left">
                                            {item.formula.map((f: any, idx: number) => {
                                                const totalNeeded = safeNumber(f.quantityUsed) * safeNumber(request.quantity || 1);
                                                return (
                                                    <Badge key={idx} variant="outline" className="text-[8px] font-black uppercase tracking-widest bg-muted/50 border-none px-2 py-0.5">
                                                        {totalNeeded.toFixed(1)}{f.unit} {f.name}
                                                    </Badge>
                                                )
                                            })}
                                        </div>
                                    )}

                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex flex-wrap items-center gap-x-2 gap-y-1">
                                        Guest: <span className="text-primary">{request.clientName}</span>
                                        <span className="opacity-40">&middot;</span>
                                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3"/> {request.stationName || 'Station'}</span>
                                        <span className="opacity-40">&middot;</span>
                                        <span className="flex items-center gap-1"><UserIcon className="w-3 h-3"/> {request.staffName || 'Pro'}</span>
                                        <span className="opacity-40">&middot;</span>
                                        {format(safeDate(request.requestedAt), 'h:mm a')}
                                    </p>
                                </div>
                            </div>
                            <Button 
                                onClick={() => onDeliver(request)}
                                className="h-12 w-full sm:w-48 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] shadow-xl shadow-primary/20 group"
                            >
                                Certify Delivery <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                            </Button>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
};

const ActiveSessionCard = ({ appointment, service, staffMember }: { appointment: Appointment, service?: Service, staffMember?: Staff }) => {
    const [elapsed, setElapsed] = useState('0m');
    const [isOver, setIsOver] = useState(false);

    React.useEffect(() => {
        const start = safeDate(appointment.actualStartTime || appointment.startTime);
        const target = service?.duration || 60;
        const timer = setInterval(() => {
            const mins = differenceInMinutes(new Date(), start);
            setElapsed(`${mins}m`);
            setIsOver(mins > target);
        }, 10000);
        return () => clearInterval(timer);
    }, [appointment, service]);

    return (
        <div className={cn("p-4 rounded-2xl border-2 bg-white flex items-center justify-between transition-all", isOver ? "border-destructive ring-2 ring-destructive/10" : "border-border/50")}>
            <div className="flex items-center gap-3 min-w-0 text-left">
                <Avatar className="h-10 w-10 border-2 rounded-xl shadow-sm">
                    <AvatarImage src={staffMember?.avatarUrl} className="object-cover" />
                    <AvatarFallback className="font-black text-xs">{(staffMember?.name || 'S')[0]}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 text-left">
                    <p className="font-black uppercase text-xs truncate leading-none mb-1">{appointment.clientName}</p>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 truncate">{service?.name}</p>
                </div>
            </div>
            <div className="text-right shrink-0">
                <p className={cn("font-black font-mono text-base tracking-tighter", isOver ? "text-destructive" : "text-primary")}>{elapsed}</p>
                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Progress</p>
            </div>
        </div>
    );
};

export default function DashboardPage() {
  const { firestore, user } = useFirebase();
  const { selectedTenant } = useTenant();
  const { inventory, clients, transactions, appointments, staff, services, walkIns, refreshmentRequests, isLoading: isInventoryLoading } = useInventory();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();

  const today = useMemo(() => startOfDay(new Date()), []);

  const pendingRequests = useMemo(() => 
    refreshmentRequests?.filter(r => r.status === 'pending' && safeDate(r.requestedAt) >= today) || []
  , [refreshmentRequests, today]);

  const handleDeliverRefreshment = async (request: RefreshmentRequest) => {
      if (!firestore || !tenantId || !inventory) return;
      
      const item = inventory.find(i => i.id === request.itemId);
      if (!item) return;

      const batch = writeBatch(firestore);
      const now = new Date().toISOString();
      const qty = safeNumber(request.quantity || 1);

      const requestRef = doc(firestore, `tenants/${tenantId}/refreshmentRequests`, request.id);
      batch.update(requestRef, {
          status: 'delivered',
          deliveredAt: now,
          deliveredBy: user?.uid || 'system'
      });

      const ingredients = item.formula && item.formula.length > 0 
        ? item.formula.map(f => ({ ...f, quantityUsed: safeNumber(f.quantityUsed) * qty }))
        : [{ id: item.id, name: item.name, quantityUsed: qty, unit: item.unit || 'unit' }];

      ingredients.forEach(ingredient => {
          const product = inventory.find(p => p.id === ingredient.id);
          if (!product) return;

          const productRef = doc(firestore, `tenants/${tenantId}/inventory`, product.id);
          const updateData: any = {};
          let unitLabel = product.unit || 'units';
          
          if (product.costingMethod === 'uses') {
              unitLabel = product.useUnit || 'uses';
              let currentUses = safeNumber(product.partialContainerUses);
              let currentStock = safeNumber(product.totalStock);
              const usesPerContainer = safeNumber(product.estimatedUses) || 1;
              
              currentUses -= ingredient.quantityUsed;
              while (currentUses <= 0 && currentStock > 0) {
                  currentStock -= 1;
                  currentUses += usesPerContainer;
              }
              if (currentStock <= 0 && currentUses < 0) {
                  currentStock = 0;
                  currentUses = 0;
              }
              updateData.totalStock = currentStock;
              updateData.partialContainerUses = currentUses;
          } else if (product.costingMethod === 'size' && product.size) {
              unitLabel = product.unit || 'ml';
              let currentSize = safeNumber(product.partialContainerSize);
              let currentStock = safeNumber(product.totalStock);
              const sizePerContainer = safeNumber(product.size);
              currentSize -= ingredient.quantityUsed;
              while (currentSize <= 0 && currentStock > 0) {
                  currentStock -= 1;
                  currentSize += sizePerContainer;
              }
              if (currentStock <= 0 && currentSize < 0) {
                  currentStock = 0;
                  currentSize = 0;
              }
              updateData.totalStock = currentStock;
              updateData.partialContainerSize = currentSize;
          } else {
              updateData.totalStock = increment(-ingredient.quantityUsed);
          }

          batch.update(productRef, sanitizeForFirestore(updateData));

          const correctionRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
          batch.set(correctionRef, sanitizeForFirestore({
              id: nanoid(),
              productId: product.id,
              date: now,
              change: -ingredient.quantityUsed,
              unit: unitLabel,
              reason: `Amenity Protocol: ${item.name} (x${qty}) for ${request.clientName}`,
              requestId: request.id
          }));
      });

      if (request.appointmentId) {
          const aptRef = doc(firestore, `tenants/${tenantId}/appointments`, request.appointmentId);
          batch.update(aptRef, {
              'checkoutState.refreshments': arrayUnion(sanitizeForFirestore({
                  id: item.id,
                  name: item.name,
                  price: safeNumber(request.priceAtRequest || item.price),
                  deliveredAt: now,
                  quantity: qty,
                  isAccountedFor: true
              }))
          });
      }

      try {
          await batch.commit();
          toast({ title: "Delivery Certified", description: `Stock reconciled and dossier updated for ${request.clientName}.` });
      } catch (e) {
          console.error("Fulfillment failed:", e);
          toast({ variant: 'destructive', title: "Process Error" });
      }
  };

  const dashboardMetrics = useMemo(() => {
    const todayStart = startOfDay(new Date());
    const dailyIncome = (transactions || []).filter(t => t.type === 'income' && isSameDay(safeDate(t.date), todayStart)).reduce((acc, t) => acc + t.amount, 0);
    const totalArrears = (clients || []).reduce((acc, c) => acc + safeNumber(c.outstandingBalance), 0);
    const activeStaff = (staff || []).filter(s => s.active && !s.onBreak).length;
    const todayArrivals = (walkIns || []).filter(w => isSameDay(safeDate(w.checkInTime), todayStart)).length + 
                         (appointments || []).filter(a => isSameDay(safeDate(a.startTime), todayStart) && a.checkInStatus === 'arrived').length;

    const liveSessions = (appointments || []).filter(a => a.status === 'servicing');
    const lowStockItems = (inventory || []).filter(i => i.reorderPoint && i.totalStock <= i.reorderPoint);

    const deliveredToday = refreshmentRequests?.filter(r => r.status === 'delivered' && safeDate(r.requestedAt) >= todayStart) || [];
    const waitTimes = deliveredToday.map(r => {
        const req = safeDate(r.requestedAt);
        const del = safeDate(r.deliveredAt);
        return Math.max(0, differenceInMinutes(del, req));
    });
    const hospitalityWaitVelocity = waitTimes.length > 0 
        ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) 
        : 0;

    const itemPopularity: Record<string, number> = {};
    refreshmentRequests?.filter(r => safeDate(r.requestedAt) >= todayStart).forEach(r => {
        itemPopularity[r.itemName] = (itemPopularity[r.itemName] || 0) + 1;
    });
    const topAmenity = Object.entries(itemPopularity).sort((a,b) => b[1] - a[1])[0]?.[0] || 'N/A';

    return { 
        dailyIncome, 
        totalArrears, 
        activeStaff, 
        todayArrivals, 
        liveSessions, 
        lowStockItems,
        hospitalityWaitVelocity,
        topAmenity,
        totalHospitalityRequests: refreshmentRequests?.filter(r => safeDate(r.requestedAt) >= todayStart).length || 0
    };
  }, [transactions, clients, staff, walkIns, appointments, inventory, refreshmentRequests]);

  if (isInventoryLoading) return <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">Syncing Operational Board...</p></div>;

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Command Hub" />
      <main className="flex-1 p-4 md:p-10 max-w-7xl mx-auto w-full space-y-10">
        
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2rem] shadow-xl shadow-primary/5">
                <CardHeader className="p-5 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase text-primary tracking-widest flex items-center gap-2"><TrendingUp className="w-3 h-3"/>Today's Gross</CardTitle></CardHeader>
                <CardContent className="p-5 pt-0 text-left"><p className="text-2xl md:text-4xl font-black tracking-tighter text-primary font-mono">${dashboardMetrics.dailyIncome.toFixed(2)}</p></CardContent>
            </Card>
            <Card className="border-2 shadow-sm rounded-[2rem] bg-white">
                <CardHeader className="p-5 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2 opacity-60"><Users className="w-3 h-3"/>Team Capacity</CardTitle></CardHeader>
                <CardContent className="p-5 pt-0 text-left"><p className="text-2xl md:text-4xl font-black tracking-tighter text-slate-900 font-mono">{dashboardMetrics.activeStaff}<span className="text-xs ml-1">Pro</span></p></CardContent>
            </Card>
            <Card className="border-2 shadow-sm rounded-[2rem] bg-white">
                <CardHeader className="p-5 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2 opacity-60"><MapPin className="w-3 h-3"/>Total Arrivals</CardTitle></CardHeader>
                <CardContent className="p-5 pt-0 text-left"><p className="text-2xl md:text-4xl font-black tracking-tighter text-slate-900 font-mono">{dashboardMetrics.todayArrivals}<span className="text-xs ml-1">Guests</span></p></CardContent>
            </Card>
            <Card className={cn("border-2 shadow-sm rounded-[2rem] transition-all", dashboardMetrics.totalArrears > 0 ? "border-destructive/20 bg-destructive/[0.02]" : "bg-white")}>
                <CardHeader className="p-5 pb-1 text-left"><CardTitle className={cn("text-[10px] font-black uppercase tracking-widest flex items-center gap-2", dashboardMetrics.totalArrears > 0 ? "text-destructive" : "text-muted-foreground opacity-60")}><Wallet className="w-3 h-3"/>Arrears Recovery</CardTitle></CardHeader>
                <CardContent className="p-5 pt-0 text-left"><p className={cn("text-2xl md:text-4xl font-black tracking-tighter font-mono", dashboardMetrics.totalArrears > 0 ? "text-destructive" : "text-slate-900")}>${dashboardMetrics.totalArrears.toFixed(2)}</p></CardContent>
            </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 space-y-10 text-left">
                <section className="space-y-6">
                    <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-xl"><Coffee className="w-5 h-5 text-primary" /></div>
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Hospitality Priority</h3>
                        </div>
                        <Badge variant="secondary" className="h-6 px-3 rounded-full font-black text-[9px] uppercase border-none bg-primary text-white shadow-lg animate-pulse">{pendingRequests?.length || 0} PENDING</Badge>
                    </div>
                    <RefreshmentQueue 
                        requests={pendingRequests || []} 
                        inventory={inventory} 
                        user={user}
                        onDeliver={handleDeliverRefreshment} 
                        staff={staff}
                    />
                </section>

                <section className="space-y-6">
                    <div className="flex items-center gap-3 px-1 text-left">
                        <div className="p-2 bg-indigo-500/10 rounded-xl"><Zap className="w-5 h-5 text-indigo-600" /></div>
                        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Live Studio Pulse</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {dashboardMetrics.liveSessions.length > 0 ? dashboardMetrics.liveSessions.map(apt => (
                            <ActiveSessionCard 
                                key={apt.id} 
                                appointment={apt} 
                                service={services.find(s => s.id === apt.serviceId)}
                                staffMember={staff.find(s => s.id === apt.staffId)}
                            />
                        )) : (
                            <div className="col-span-full py-12 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                                <Activity className="w-10 h-10" />
                                <p className="text-[10px] font-black uppercase tracking-widest">No Technical Sessions in Progress</p>
                            </div>
                        )}
                    </div>
                </section>
            </div>

            <div className="space-y-10 text-left">
                <Card className="border-4 border-primary/10 bg-white rounded-[2.5rem] shadow-xl overflow-hidden text-left">
                    <CardHeader className="bg-muted/5 border-b p-6">
                        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                            <Timer className="w-3.5 h-3.5" /> Hospitality Insights
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6 text-left">
                        <div className="space-y-1">
                            <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Avg. Wait Velocity</p>
                            <p className="text-3xl font-black tracking-tighter text-slate-900">{dashboardMetrics.hospitalityWaitVelocity} <span className="text-xs uppercase opacity-40">Min</span></p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1 p-3 rounded-xl bg-muted/20 border text-left">
                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Engagement</p>
                                <p className="text-sm font-black">{dashboardMetrics.totalHospitalityRequests} <span className="text-[8px] opacity-40">Orders</span></p>
                            </div>
                            <div className="space-y-1 p-3 rounded-xl bg-muted/20 border text-left">
                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Top Amenity</p>
                                <p className="text-[10px] font-black truncate text-primary">{dashboardMetrics.topAmenity}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 text-left">
                        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><ShieldAlert className="w-3.5 h-3.5"/>Asset Safeguard</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4 text-left">
                        {dashboardMetrics.lowStockItems.length > 0 ? (
                            <div className="space-y-3">
                                {dashboardMetrics.lowStockItems.slice(0, 5).map(item => (
                                    <div key={item.id} className="flex justify-between items-center p-3 rounded-xl border-2 border-destructive/10 bg-destructive/[0.02]">
                                        <div className="min-w-0 flex-1 text-left">
                                            <p className="text-[10px] font-black uppercase tracking-tight text-destructive truncate">{item.name}</p>
                                            <p className="text-[8px] font-bold opacity-60 uppercase">{item.category}</p>
                                        </div>
                                        <Badge variant="destructive" className="h-5 px-1.5 font-black text-[9px] border-none shadow-sm">{item.totalStock}u</Badge>
                                    </div>
                                ))}
                                <Button variant="ghost" asChild className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-primary hover:bg-primary/5">
                                    <Link href="/inventory">Audit Inventory <ArrowRight className="ml-2 h-3.5 w-3.5" /></Link>
                                </Button>
                            </div>
                        ) : (
                            <div className="py-10 text-center opacity-30 space-y-3 mx-auto">
                                <CheckCircle2 className="w-10 h-10 mx-auto text-green-500" />
                                <p className="text-[10px] font-black uppercase tracking-widest">Manifest Optimized</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="border-4 border-indigo-500/20 bg-indigo-500/5 rounded-[2.5rem] shadow-2xl shadow-indigo-500/5 overflow-hidden group">
                    <CardHeader className="p-8 pb-4 text-left">
                        <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-indigo-700 flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5" />
                            Studio Performance
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-8 pt-0 space-y-6 text-left">
                        <div className="space-y-1 text-left">
                            <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Daily Trajectory</p>
                            <p className="text-4xl font-black text-indigo-700 tracking-tighter leading-none">${dashboardMetrics.dailyIncome.toFixed(0)}</p>
                        </div>
                        <div className="pt-4 border-t border-indigo-500/10">
                            <p className="text-[10px] font-medium text-indigo-600 leading-relaxed uppercase tracking-tight text-left">
                                Business orchestration is active. You are currently tracking {walkIns?.length || 0} walk-ins and {appointments?.filter(a => isToday(safeDate(a.startTime))).length || 0} scheduled sessions.
                            </p>
                        </div>
                        <Button asChild className="w-full h-14 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-[10px] tracking-widest shadow-xl shadow-indigo-500/20">
                            <Link href="/reports">Analyze Yield Dossier</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
      </main>
    </div>
  );
}
