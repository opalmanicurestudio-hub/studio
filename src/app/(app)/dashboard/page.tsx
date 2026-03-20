
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
  Landmark,
  Globe,
  Phone,
  Smartphone,
  Square,
  CheckCircle2,
  Check
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type Appointment, type Transaction, type Service, Staff, ActivityLog, InventoryItem } from '@/lib/data';
import { Button } from '@/components/ui/button';
import { useFirebase, useCollection, useMemoFirebase, useUser, addDocumentNonBlocking } from '@/firebase';
import { collection, query, where, Timestamp, doc, writeBatch, increment } from 'firebase/firestore';
import { startOfDay, endOfDay, format, isSameDay, parseISO, differenceInMinutes } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { useTenant } from '@/context/TenantContext';
import { Badge } from '@/components/ui/badge';
import { cn, safeNumber } from '@/lib/utils';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

const RefreshmentQueue = ({ requests, inventory, staff, onDeliver }: any) => {
    if (!requests || requests.length === 0) return null;

    return (
        <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/10 overflow-hidden mb-10 animate-in slide-in-from-top-4 duration-700">
            <CardHeader className="p-6 md:p-8 pb-4 border-b bg-white/50 backdrop-blur-md">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary rounded-xl shadow-lg shadow-primary/20">
                            <Coffee className="w-5 h-5 text-white" />
                        </div>
                        <div className="text-left">
                            <CardTitle className="text-lg md:text-2xl font-black uppercase tracking-tighter text-slate-900">Hospitality Hub</CardTitle>
                            <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Guest refreshment requests requiring fulfillment.</CardDescription>
                        </div>
                    </div>
                    <Badge className="bg-primary text-white border-none font-black text-[10px] h-6 px-3 shadow-lg animate-pulse">{requests.length} PENDING</Badge>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="divide-y-2 divide-dashed divide-primary/10">
                    {requests.map((request: any) => (
                        <div key={request.id} className="flex flex-col sm:flex-row items-center justify-between p-6 md:p-8 gap-6 group hover:bg-primary/[0.02] transition-all">
                            <div className="flex items-center gap-6 text-left w-full sm:w-auto">
                                <div className="p-4 bg-white rounded-2xl shadow-inner border border-primary/10 relative">
                                    <Coffee className="w-8 h-8 text-primary opacity-40" />
                                    <div className="absolute -top-2 -right-2 bg-primary text-white rounded-full p-1 shadow-lg">
                                        <CheckCircle2 className="w-3 h-3" />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <p className="font-black text-xl uppercase tracking-tighter text-slate-900">{request.itemName}</p>
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                                        Requested by <span className="text-primary">{request.clientName}</span> &middot; {format(safeDate(request.requestedAt), 'h:mm a')}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 w-full sm:w-auto">
                                <Button 
                                    onClick={() => onDeliver(request)}
                                    className="h-12 flex-1 sm:w-48 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] shadow-xl shadow-primary/20 transition-all active:scale-95 group"
                                >
                                    Certify Delivery <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
};

export default function DashboardPage() {
  const { firestore } = useFirebase();
  const { selectedTenant, role } = useTenant();
  const { inventory, staff, appointments, transactions, isLoading: isInventoryLoading } = useInventory();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();

  const requestsQuery = useMemoFirebase(() => {
      if (!firestore || !tenantId) return null;
      return query(collection(firestore, `tenants/${tenantId}/refreshmentRequests`), where("status", "==", "pending"));
  }, [firestore, tenantId]);
  const { data: pendingRequests } = useCollection(requestsQuery);

  const handleDeliverRefreshment = async (request: any) => {
      if (!firestore || !tenantId || !inventory) return;
      
      const item = inventory.find(i => i.id === request.itemId);
      if (!item) return;

      const batch = writeBatch(firestore);
      const now = new Date().toISOString();

      // 1. Mark request as delivered
      const requestRef = doc(firestore, `tenants/${tenantId}/refreshmentRequests`, request.id);
      batch.update(requestRef, {
          status: 'delivered',
          deliveredAt: now,
          deliveredBy: currentUser?.uid || 'system'
      });

      // 2. Atomic Inventory Deduction
      const productRef = doc(firestore, `tenants/${tenantId}/inventory`, item.id);
      batch.update(productRef, { totalStock: increment(-1) });

      // 3. Log Stock Correction
      const correctionRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
      batch.set(correctionRef, {
          id: correctionRef.id,
          productId: item.id,
          date: now,
          change: -1,
          unit: item.unit || 'unit',
          reason: `Concierge fulfillment: ${request.clientName}`,
          requestId: request.id
      });

      try {
          await batch.commit();
          toast({ title: "Delivery Certified", description: "Inventory atomically reconciled." });
      } catch (e) {
          toast({ variant: 'destructive', title: "Reconciliation Failed" });
      }
  };

  const { todaysRevenue, totalOutstandingDebt, clientRetentionRate } = useMemo(() => {
    const today = startOfDay(new Date());
    const tRevenue = (transactions || []).filter(t => t.type === 'income' && isSameDay(safeDate(t.date), today)).reduce((acc, t) => acc + t.amount, 0);
    const tDebt = (clients || []).reduce((acc, c) => acc + safeNumber(c.outstandingBalance), 0);
    return { todaysRevenue: tRevenue, totalOutstandingDebt: tDebt, clientRetentionRate: 82 };
  }, [transactions, clients]);

  if (isInventoryLoading) return <div className="h-screen flex items-center justify-center"><Loader className="animate-spin" /></div>;

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <AppHeader title="Studio Dashboard" />
      <main className="flex-1 p-4 md:p-10 max-w-7xl mx-auto w-full">
        
        {/* HOSPITALITY CONCIERGE QUEUE */}
        <RefreshmentQueue 
            requests={pendingRequests || []} 
            inventory={inventory} 
            staff={staff} 
            onDeliver={handleDeliverRefreshment} 
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
            <Card className="border-2 shadow-sm bg-primary/5 border-primary/10">
                <CardHeader className="p-4 pb-2 text-left"><CardTitle className="text-[10px] font-black uppercase text-primary">Today's Revenue</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0 text-left"><p className="text-3xl font-black tracking-tighter text-primary">${todaysRevenue.toFixed(2)}</p></CardContent>
            </Card>
            <Card className="border-2 shadow-sm bg-destructive/5 border-destructive/10">
                <CardHeader className="p-4 pb-2 text-left"><CardTitle className="text-[10px] font-black uppercase text-destructive">Arrears</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0 text-left"><p className="text-3xl font-black tracking-tighter text-destructive">${totalOutstandingDebt.toFixed(2)}</p></CardContent>
            </Card>
        </div>

        <div className="text-center py-20 border-4 border-dashed rounded-[3.5rem] opacity-30">
            <Sparkles className="w-16 h-16 mx-auto text-primary mb-4" />
            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Operations Suite Active</h3>
            <p className="text-sm font-bold uppercase tracking-widest mt-2">Jessica Marshall &middot; Master Owner</p>
        </div>
      </main>
    </div>
  );
}
