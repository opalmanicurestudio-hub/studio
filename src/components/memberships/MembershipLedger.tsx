
'use client';

import React, { useState, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
    TrendingUp, 
    AlertTriangle, 
    ShieldCheck, 
    Zap, 
    History, 
    Clock, 
    Search, 
    Loader,
    Wallet,
    Calendar,
    Sparkles,
    Landmark,
    XCircle,
    CheckCircle2
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { format, parseISO, isPast, isToday, addMonths, startOfDay, isSameMonth } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { collection, doc, writeBatch, increment } from 'firebase/firestore';
import { type SubscriptionInstance, type Membership } from '@/lib/data';
import { type Transaction } from '@/lib/financial-data';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const KpiCard = ({ title, value, icon: Icon, description, colorClass }: { title: string, value: string, icon: any, description: string, colorClass?: string }) => (
    <Card className="border-2 shadow-sm min-w-0 text-left bg-white/50 backdrop-blur-sm overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                {title}
            </CardTitle>
            <Icon className={cn("h-4 w-4 opacity-40", colorClass || "text-slate-900")} />
        </CardHeader>
        <CardContent className="p-4 pt-0">
            <div className={cn("text-2xl md:text-3xl font-black tracking-tighter font-mono", colorClass || "text-slate-900")}>
                {value}
            </div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase mt-1 opacity-40 truncate">{description}</p>
        </CardContent>
    </Card>
);

const SubscriptionRow = ({ instance, client, membership, onSettle, onTerminate }: { instance: SubscriptionInstance, client?: any, membership?: Membership, onSettle: (inst: SubscriptionInstance) => void, onTerminate: (inst: SubscriptionInstance) => void }) => {
    const isOverdue = instance.status === 'pending' && isPast(parseISO(instance.dueDate)) && !isToday(parseISO(instance.dueDate));
    const hasCard = !!client?.cardOnFile?.token;
    const isNoCommitment = !!membership?.noCommitment;

    return (
        <TableRow className="group hover:bg-primary/[0.02] cursor-pointer">
            <TableCell className="py-5">
                <div className="flex items-center gap-4 text-left">
                    <div className="relative shrink-0">
                        <Avatar className="h-10 w-10 border shadow-sm rounded-xl">
                            <AvatarImage src={client?.avatarUrl} className="object-cover" />
                            <AvatarFallback className="font-black text-[10px] bg-primary/10 text-primary">{(instance.clientName || 'G')[0]}</AvatarFallback>
                        </Avatar>
                        {hasCard && (
                            <div className="absolute -top-1 -right-1 bg-green-500 text-white p-0.5 rounded-full shadow-sm border border-background">
                                <ShieldCheck className="w-2 h-2" />
                            </div>
                        )}
                    </div>
                    <div className="min-w-0">
                        <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{instance.clientName}</p>
                        <div className='flex items-center gap-2'>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 truncate">{instance.membershipName}</p>
                            {isNoCommitment && <Badge variant="outline" className="h-3.5 px-1 text-[6px] font-black uppercase border-green-500/20 text-green-600 bg-green-50">Flex</Badge>}
                        </div>
                    </div>
                </div>
            </TableCell>
            <TableCell>
                <div className="text-left">
                    <p className="font-black text-sm text-slate-900 font-mono tracking-tighter">${instance.amount.toFixed(2)}</p>
                    <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest opacity-40">Monthly Due</p>
                </div>
            </TableCell>
            <TableCell>
                <div className="text-left space-y-1">
                    <p className="text-[10px] font-black uppercase text-slate-600">{format(parseISO(instance.dueDate), 'MMM d, yyyy')}</p>
                    {isOverdue && <Badge variant="destructive" className="h-4 text-[7px] font-black uppercase animate-pulse border-none">Overdue</Badge>}
                </div>
            </TableCell>
            <TableCell>
                <Badge 
                    variant={instance.status === 'paid' ? 'default' : 'outline'} 
                    className={cn(
                        "h-5 px-2 font-black text-[8px] uppercase tracking-widest border-2",
                        instance.status === 'paid' ? "bg-green-500 border-none text-white shadow-sm" : 
                        instance.status === 'failed' ? "text-destructive border-destructive/20" : 
                        "bg-white"
                    )}
                >
                    {instance.status}
                </Badge>
            </TableCell>
            <TableCell className="text-right pr-8">
                <div className="flex items-center justify-end gap-2">
                    {instance.status !== 'paid' && (
                        <Button 
                            size="sm" 
                            className={cn(
                                "h-9 rounded-xl font-black uppercase text-[9px] tracking-widest shadow-lg transition-all active:scale-95",
                                hasCard ? "bg-primary text-white shadow-primary/20" : "bg-muted text-slate-600 shadow-none border-2"
                            )}
                            onClick={() => onSettle(instance)}
                        >
                            {hasCard ? <><Zap className="w-3 h-3 mr-1.5" /> Quick Settle</> : "Log Payment"}
                        </Button>
                    )}
                    {isNoCommitment && instance.status !== 'paid' && (
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-destructive hover:bg-destructive/5" onClick={() => onTerminate(instance)}>
                            <XCircle className="w-4 h-4" />
                        </Button>
                    )}
                    {instance.status === 'paid' && instance.settledAt && (
                        <div className="text-right">
                            <p className="text-[8px] font-black text-muted-foreground uppercase opacity-40">Settled</p>
                            <p className="text-[10px] font-bold text-slate-500 uppercase">{format(parseISO(instance.settledAt), 'MMM d')}</p>
                        </div>
                    )}
                </div>
            </TableCell>
        </TableRow>
    );
};

export const MembershipLedger = () => {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const { subscriptionInstances, clients, memberships, isLoading } = useInventory();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [terminatingInstance, setTerminatingInstance] = useState<SubscriptionInstance | null>(null);

  const filteredInstances = useMemo(() => {
    if (!subscriptionInstances) return [];
    return subscriptionInstances.filter(i => {
        const searchMatch = !searchTerm.trim() || i.clientName.toLowerCase().includes(searchTerm.toLowerCase()) || i.membershipName.toLowerCase().includes(searchTerm.toLowerCase());
        const statusMatch = statusFilter === 'all' || i.status === statusFilter;
        return searchMatch && statusMatch;
    }).sort((a,b) => parseISO(b.dueDate).getTime() - parseISO(a.dueDate).getTime());
  }, [subscriptionInstances, statusFilter, searchTerm]);

  const stats = useMemo(() => {
    if (!subscriptionInstances) return { mrr: 0, pending: 0, arrears: 0 };
    const today = startOfDay(new Date());
    const paidThisMonth = subscriptionInstances.filter(i => i.status === 'paid' && isSameMonth(parseISO(i.dueDate), today));
    const mrr = paidThisMonth.reduce((acc, i) => acc + i.amount, 0);
    const pending = subscriptionInstances.filter(i => i.status === 'pending' && !isPast(parseISO(i.dueDate))).reduce((acc, i) => acc + i.amount, 0);
    const arrears = subscriptionInstances.filter(i => i.status === 'pending' && isPast(parseISO(i.dueDate))).reduce((acc, i) => acc + i.amount, 0);
    return { mrr, pending, arrears };
  }, [subscriptionInstances]);

  const handleSettle = async (instance: SubscriptionInstance) => {
    if (!firestore || !tenantId) return;
    const client = clients.find(c => c.id === instance.clientId);
    const hasCard = !!client?.cardOnFile?.token;

    const batch = writeBatch(firestore);
    const now = new Date().toISOString();

    const instanceRef = doc(firestore, `tenants/${tenantId}/subscriptionInstances`, instance.id);
    const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));

    const txn: Omit<Transaction, 'id'> = {
        date: now,
        description: `Membership Payment: ${instance.membershipName}`,
        clientOrVendor: instance.clientName,
        clientId: instance.clientId,
        type: 'income',
        context: 'Business',
        category: 'Membership Revenue',
        amount: instance.amount,
        paymentMethod: hasCard ? 'Card on File' : 'Cash/Manual',
        hasReceipt: false,
    };

    batch.update(instanceRef, { status: 'paid', settledAt: now, transactionId: txnRef.id, paymentMethod: txn.paymentMethod });
    batch.set(txnRef, { ...txn, id: txnRef.id });

    const clientRef = doc(firestore, `tenants/${tenantId}/clients`, instance.clientId);
    batch.update(clientRef, {
        'subscription.status': 'active',
        'subscription.nextBillingDate': format(addMonths(parseISO(instance.dueDate), 1), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
        'subscription.perkUsage': {} 
    });

    try {
        await batch.commit();
        toast({ title: "Settlement Certified", description: `Recorded ${hasCard ? 'automated' : 'manual'} payment for ${instance.clientName}.` });
    } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: "Process Error" });
    }
  };

  const handleTerminateSubscription = async () => {
      if (!terminatingInstance || !firestore || !tenantId) return;
      const batch = writeBatch(firestore);
      const now = new Date().toISOString();

      // Update Instance
      const instanceRef = doc(firestore, `tenants/${tenantId}/subscriptionInstances`, terminatingInstance.id);
      batch.update(instanceRef, { status: 'cancelled' });

      // Update Client
      const clientRef = doc(firestore, `tenants/${tenantId}/clients`, terminatingInstance.clientId);
      batch.update(clientRef, {
          'subscription.status': 'canceled',
          activeMembershipId: null
      });

      try {
          await batch.commit();
          toast({ title: "Subscription Terminated", description: `Access revoked for ${terminatingInstance.clientName} as per no-commitment protocol.` });
          setTerminatingInstance(null);
      } catch (e) {
          console.error(e);
          toast({ variant: 'destructive', title: "Termination Failed" });
      }
  };

  return (
    <div className="space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
            <KpiCard title="Active MRR" value={`$${stats.mrr.toFixed(0)}`} icon={TrendingUp} description="Collected this cycle" colorClass="text-primary" />
            <KpiCard title="Projected Dues" value={`$${stats.pending.toFixed(0)}`} icon={Clock} description="Awaiting collection" colorClass="text-indigo-600" />
            <KpiCard title="Arrears Alert" value={`$${stats.arrears.toFixed(0)}`} icon={AlertTriangle} description="Failed/Past due payments" colorClass="text-destructive" />
        </div>

        <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
            <CardHeader className="bg-muted/5 border-b p-6 md:p-8 space-y-8 text-left">
                <div className="flex flex-col md:flex-row items-center gap-4">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                        <Input 
                            placeholder="SEARCH BY GUEST OR CLUB NAME..." 
                            className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest focus-visible:ring-primary/20 bg-white"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="w-full md:w-auto">
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest w-full md:w-48 bg-white shadow-inner">
                                <SelectValue placeholder="STATUS" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-2 shadow-2xl">
                                <SelectItem value="all" className="font-bold">ALL ENTRIES</SelectItem>
                                <SelectItem value="pending" className="font-bold">PENDING SETTLEMENT</SelectItem>
                                <SelectItem value="paid" className="font-bold text-green-600">CERTIFIED PAID</SelectItem>
                                <SelectItem value="failed" className="font-bold text-destructive">FAILED COLLECTION</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center p-24 gap-4">
                        <Loader className="animate-spin h-8 w-8 text-primary" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Synchronizing Ledger...</p>
                    </div>
                ) : filteredInstances.length > 0 ? (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-muted/10 border-b-2">
                                <TableRow>
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest p-6 text-slate-900">Member & Tier</TableHead>
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Yield Value</TableHead>
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Settlement Date</TableHead>
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Protocol State</TableHead>
                                    <TableHead className="text-right font-black text-[10px] uppercase tracking-widest pr-10 text-slate-900">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredInstances.map(instance => (
                                    <SubscriptionRow 
                                        key={instance.id} 
                                        instance={instance} 
                                        client={clients.find(c => c.id === instance.clientId)}
                                        membership={memberships.find(m => m.id === instance.membershipId)}
                                        onSettle={handleSettle}
                                        onTerminate={setTerminatingInstance}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
                        <History className="w-16 h-16" />
                        <p className="text-sm font-black uppercase tracking-widest">No matching records</p>
                    </div>
                )}
            </CardContent>
        </Card>

        <AlertDialog open={!!terminatingInstance} onOpenChange={(v) => !v && setTerminatingInstance(null)}>
            <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                <AlertDialogHeader className="p-6 pb-0">
                    <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter text-left leading-none">Terminate Subscription</AlertDialogTitle>
                    <AlertDialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-2 text-left">
                        Guest: <strong>{terminatingInstance?.clientName}</strong>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="p-6 text-sm font-medium text-slate-600 leading-relaxed uppercase tracking-tight text-left">
                    You are stoping the recurring cycle for this member. Due to the <strong>No-Commitment Protocol</strong>, access can be revoked immediately without penalty. Confirm termination?
                </div>
                <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                    <Button onClick={handleTerminateSubscription} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-destructive/20 bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirm Termination</Button>
                    <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Abort</AlertDialogCancel>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </div>
  );
};
