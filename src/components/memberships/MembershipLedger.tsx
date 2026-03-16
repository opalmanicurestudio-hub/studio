'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter
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
    CheckCircle2,
    DollarSign,
    CreditCard,
    ArrowRight,
    Info,
    Smartphone,
    Activity,
    Repeat,
    ArrowLeft,
    Undo2
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { format, parseISO, isPast, isToday, addMonths, startOfDay, isSameMonth } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { collection, doc, writeBatch, increment } from 'firebase/firestore';
import { type SubscriptionInstance, type Membership, type Staff, type Client, type Redemption } from '@/lib/data';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

const settlementSchema = z.object({
  amount: z.coerce.number().positive(),
  date: z.date(),
  paymentMethod: z.string().min(1),
  notes: z.string().optional(),
});

type SettlementFormData = z.infer<typeof settlementSchema>;

const KpiCardInternal = ({ title, value, icon: Icon, description, colorClass }: { title: string, value: string, icon: any, description: string, colorClass?: string }) => (
    <Card className="border-2 shadow-sm min-0 text-left bg-white/50 backdrop-blur-sm overflow-hidden">
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

const SettleMembershipDialog = ({ open, onOpenChange, instance, client, onConfirm }: any) => {
    const isMobile = useIsMobile();
    const methods = useForm<SettlementFormData>({
        resolver: zodResolver(settlementSchema),
    });

    useEffect(() => {
        if (open && instance) {
            methods.reset({
                amount: instance.amount,
                date: new Date(),
                paymentMethod: client?.cardOnFile?.token ? 'Card on File' : 'Cash',
                notes: ''
            });
        }
    }, [open, instance, client, methods]);

    const DialogComp = isMobile ? Sheet : Dialog;
    const ContentComp = isMobile ? SheetContent : DialogContent;

    return (
        <DialogComp open={open} onOpenChange={onOpenChange}>
            <ContentComp side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[92dvh]")}>
                <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left shrink-0">
                    <div className="flex items-center gap-3 mb-2">
                        <DollarSign className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Revenue Settlement</span>
                    </div>
                    <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Settle Dues</DialogTitle>
                    <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Collecting for: {instance?.clientName}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1">
                    <div className="p-8 space-y-10">
                        <div className="p-8 rounded-[2.5rem] bg-primary/5 border-4 border-primary/10 text-center space-y-4 shadow-2xl shadow-primary/5">
                            <p className="text-[10px] font-black uppercase text-primary/60 tracking-widest">Calculated Dues</p>
                            <p className="text-5xl font-black text-primary tracking-tighter font-mono">${instance?.amount.toFixed(2)}</p>
                        </div>

                        <FormProvider {...methods}>
                            <form className="space-y-8 text-left">
                                <div className="space-y-6">
                                    <Controller
                                        name="date"
                                        control={methods.control}
                                        render={({ field }) => (
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Effective Date</Label>
                                                <Input 
                                                    type="date" 
                                                    value={field.value ? format(field.value, 'yyyy-MM-dd') : ''}
                                                    onChange={e => field.onChange(e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : new Date())}
                                                    className="h-14 rounded-2xl border-2 font-black text-lg"
                                                />
                                            </div>
                                        )}
                                    />
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Payment Method</Label>
                                        <Controller
                                            name="paymentMethod"
                                            control={methods.control}
                                            render={({ field }) => (
                                                <Select value={field.value} onValueChange={field.onChange}>
                                                    <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                        <SelectItem value="Card on File" className="font-bold">CARD ON FILE</SelectItem>
                                                        <SelectItem value="Cash" className="font-bold">CASH TENDER</SelectItem>
                                                        <SelectItem value="Other" className="font-bold">OTHER</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Audit Notes</Label>
                                        <Textarea {...methods.register('notes')} placeholder="Logistics or reference details..." className="rounded-2xl border-2 bg-muted/5 min-h-[100px]" />
                                    </div>
                                </div>
                            </form>
                        </FormProvider>
                    </div>
                </ScrollArea>
                <DialogFooter className="p-8 pt-4 border-t bg-muted/5 shrink-0">
                    <div className="flex gap-3 w-full">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                        <Button onClick={methods.handleSubmit(onConfirm)} className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 group">
                            Finalize Settlement <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/>
                        </Button>
                    </div>
                </DialogFooter>
            </ContentComp>
        </DialogComp>
    );
};

const SubscriptionRowInternal = ({ instance, client, membership, onSettle, onTerminate }: { instance: SubscriptionInstance, client?: any, membership?: Membership, onSettle: (inst: SubscriptionInstance) => void, onTerminate: (inst: SubscriptionInstance) => void }) => {
    const isOverdue = instance.status === 'failed' || (instance.status === 'pending' && isPast(parseISO(instance.dueDate)) && !isToday(parseISO(instance.dueDate)));
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
  const { subscriptionInstances, clients, memberships, transactions, redemptions, isLoading } = useInventory();
  const { toast } = useToast();

  const [activeSubTab, setActiveSubTab] = useState<'pending' | 'payments' | 'redemptions'>('pending');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [terminatingInstance, setTerminatingInstance] = useState<SubscriptionInstance | null>(null);
  const [settlingInstance, setSettlingInstance] = useState<SubscriptionInstance | null>(null);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);

  const filteredInstances = useMemo(() => {
    if (!subscriptionInstances) return [];
    return subscriptionInstances.filter(i => {
        const searchMatch = !searchTerm.trim() || i.clientName.toLowerCase().includes(searchTerm.toLowerCase()) || i.membershipName.toLowerCase().includes(searchTerm.toLowerCase());
        const statusMatch = statusFilter === 'all' || i.status === statusFilter;
        return searchMatch && statusMatch;
    }).sort((a,b) => parseISO(b.dueDate).getTime() - parseISO(a.dueDate).getTime());
  }, [subscriptionInstances, statusFilter, searchTerm]);

  const historicalTransactions = useMemo(() => {
      if (!transactions) return [];
      return transactions
        .filter(t => t.category === 'Membership Revenue' || t.description.toLowerCase().includes('membership'))
        .filter(t => !searchTerm.trim() || t.clientOrVendor.toLowerCase().includes(searchTerm.toLowerCase()) || t.description.toLowerCase().includes(searchTerm.toLowerCase()))
        .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, searchTerm]);

  const historicalRedemptions = useMemo(() => {
      if (!redemptions) return [];
      return redemptions
        .filter(r => r.type === 'membership')
        .filter(r => {
            const client = clients.find(c => c.id === r.clientId);
            return !searchTerm.trim() || 
                   client?.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                   r.offeringName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                   r.serviceName.toLowerCase().includes(searchTerm.toLowerCase());
        })
        .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [redemptions, searchTerm, clients]);

  const stats = useMemo(() => {
    if (!subscriptionInstances) return { mrr: 0, pending: 0, arrears: 0 };
    const today = startOfDay(new Date());
    const paidThisMonth = subscriptionInstances.filter(i => i.status === 'paid' && isSameMonth(parseISO(i.dueDate), today));
    const mrr = paidThisMonth.reduce((acc, i) => acc + i.amount, 0);
    const pending = subscriptionInstances.filter(i => i.status === 'pending' && !isPast(parseISO(i.dueDate))).reduce((acc, i) => acc + i.amount, 0);
    const arrears = subscriptionInstances.filter(i => (i.status === 'failed' || i.status === 'pending') && isPast(parseISO(i.dueDate)) && !isToday(parseISO(i.dueDate))).reduce((acc, i) => acc + i.amount, 0);
    return { mrr, pending, arrears };
  }, [subscriptionInstances]);

  const handleRunBatch = async () => {
      if (!firestore || !tenantId || isProcessingBatch) return;
      
      const autoSettlable = filteredInstances.filter(i => {
          if (i.status === 'paid' || i.status === 'cancelled') return false;
          const client = clients.find(c => c.id === i.clientId);
          return !!client?.cardOnFile?.token;
      });

      if (autoSettlable.length === 0) {
          toast({ title: "No Actions Required", description: "All eligible subscriptions are settled or pending manual payment." });
          return;
      }

      setIsProcessingBatch(true);
      const batch = writeBatch(firestore);
      const now = new Date().toISOString();

      autoSettlable.forEach(instance => {
          const isVirtual = instance.id.startsWith('virtual-');
          const instanceRef = isVirtual 
              ? doc(collection(firestore, `tenants/${tenantId}/subscriptionInstances`))
              : doc(firestore, `tenants/${tenantId}/subscriptionInstances`, instance.id);
          
          const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
          const client = clients.find(c => c.id === instance.clientId);

          const txn: Omit<Transaction, 'id'> = {
              date: now,
              description: `Automated Membership Payment: ${instance.membershipName}`,
              clientOrVendor: instance.clientName,
              clientId: instance.clientId,
              type: 'income',
              context: 'Business',
              category: 'Membership Revenue',
              amount: instance.amount,
              paymentMethod: 'Card on File',
              paymentMethodIdentifier: `Vault: ${client?.cardOnFile?.brand} ****${client?.cardOnFile?.last4}`,
              hasReceipt: false,
          };

          if (isVirtual) {
              batch.set(instanceRef, {
                  id: instanceRef.id,
                  clientId: instance.clientId,
                  clientName: instance.clientName,
                  membershipId: instance.membershipId,
                  membershipName: instance.membershipName,
                  amount: instance.amount,
                  dueDate: instance.dueDate,
                  status: 'paid',
                  settledAt: now,
                  transactionId: txnRef.id,
                  paymentMethod: 'Card on File'
              });
          } else {
              batch.update(instanceRef, { status: 'paid', settledAt: now, transactionId: txnRef.id, paymentMethod: 'Card on File' });
          }

          batch.set(txnRef, { ...txn, id: txnRef.id });

          const clientRef = doc(firestore, `tenants/${tenantId}/clients`, instance.clientId);
          batch.update(clientRef, {
              'subscription.status': 'active',
              'subscription.nextBillingDate': format(addMonths(parseISO(instance.dueDate), 1), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
              'subscription.perkUsage': {},
              'subscription.perkLastUsed': now
          });
      });

      try {
          await batch.commit();
          toast({ title: "Automated Batch Complete", description: `Processed ${autoSettlable.length} recurring distributions.` });
      } catch (e) {
          console.error(e);
          toast({ variant: 'destructive', title: "Batch Error" });
      } finally {
          setIsProcessingBatch(false);
      }
  };

  const handleSettleConfirm = async (data: SettlementFormData) => {
    if (!settlingInstance || !firestore || !tenantId) return;
    
    const isVirtual = settlingInstance.id.startsWith('virtual-');
    const batch = writeBatch(firestore);
    const settleDate = data.date.toISOString();

    const instanceRef = isVirtual 
        ? doc(collection(firestore, `tenants/${tenantId}/subscriptionInstances`))
        : doc(firestore, `tenants/${tenantId}/subscriptionInstances`, settlingInstance.id);
    
    const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));

    const txn: Omit<Transaction, 'id'> = {
        date: settleDate,
        description: `Membership Payment: ${settlingInstance.membershipName}`,
        clientOrVendor: settlingInstance.clientName,
        clientId: settlingInstance.clientId,
        type: 'income',
        context: 'Business',
        category: 'Membership Revenue',
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        hasReceipt: false,
    };

    if (isVirtual) {
        batch.set(instanceRef, {
            id: instanceRef.id,
            clientId: settlingInstance.clientId,
            clientName: settlingInstance.clientName,
            membershipId: settlingInstance.membershipId,
            membershipName: settlingInstance.membershipName,
            amount: data.amount,
            dueDate: settlingInstance.dueDate,
            status: 'paid',
            settledAt: settleDate,
            transactionId: txnRef.id,
            paymentMethod: data.paymentMethod
        });
    } else {
        batch.update(instanceRef, { 
            status: 'paid', 
            settledAt: settleDate, 
            transactionId: txnRef.id, 
            paymentMethod: data.paymentMethod 
        });
    }

    batch.set(txnRef, { ...txn, id: txnRef.id });

    const clientRef = doc(firestore, `tenants/${tenantId}/clients`, settlingInstance.clientId);
    batch.update(clientRef, {
        'subscription.status': 'active',
        'subscription.nextBillingDate': format(addMonths(parseISO(settlingInstance.dueDate), 1), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
        'subscription.perkUsage': {},
        'subscription.perkLastUsed': settleDate
    });

    try {
        await batch.commit();
        toast({ title: "Settlement Certified", description: `Recorded payment for ${settlingInstance.clientName}.` });
        setSettlingInstance(null);
    } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: "Process Error" });
    }
  };

  const handleTerminateSubscription = async () => {
      if (!terminatingInstance || !firestore || !tenantId) return;
      const batch = writeBatch(firestore);
      const now = new Date().toISOString();

      const instanceRef = !terminatingInstance.id.startsWith('virtual-')
        ? doc(firestore, `tenants/${tenantId}/subscriptionInstances`, terminatingInstance.id)
        : null;
      
      if (instanceRef) batch.update(instanceRef, { status: 'cancelled' });

      const clientRef = doc(firestore, `tenants/${tenantId}/clients`, terminatingInstance.clientId);
      batch.update(clientRef, {
          'subscription.status': 'canceled',
          activeMembershipId: deleteField()
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

  const isGatewayActive = selectedTenant?.paymentGateway && selectedTenant.paymentGateway !== 'none';

  return (
    <div className="space-y-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
            <KpiCardInternal title="Active MRR" value={`$${stats.mrr.toFixed(0)}`} icon={TrendingUp} description="Collected this cycle" colorClass="text-primary" />
            <KpiCardInternal title="Projected Dues" value={`$${stats.pending.toFixed(0)}`} icon={Clock} description="Awaiting collection" colorClass="text-indigo-600" />
            <KpiCardInternal title="Arrears Alert" value={`$${stats.arrears.toFixed(0)}`} icon={AlertTriangle} description="Failed/Past due payments" colorClass="text-destructive" />
        </div>

        <div className="flex justify-center">
            <div className="p-1.5 bg-muted/30 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 w-fit">
                <Button variant={activeSubTab === 'pending' ? 'default' : 'ghost'} onClick={() => setActiveSubTab('pending')} className="h-9 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                    <Clock className="w-3.5 h-3.5 mr-2" /> Pending Dues
                </Button>
                <Button variant={activeSubTab === 'payments' ? 'default' : 'ghost'} onClick={() => setActiveSubTab('payments')} className="h-9 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                    <History className="w-3.5 h-3.5 mr-2" /> Payment History
                </Button>
                <Button variant={activeSubTab === 'redemptions' ? 'default' : 'ghost'} onClick={() => setActiveSubTab('redemptions')} className="h-9 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                    <Activity className="w-3.5 h-3.5 mr-2" /> Redemption Log
                </Button>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            <Card className={cn("lg:col-span-2 border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white")}>
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8 space-y-8 text-left">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="space-y-1">
                            <CardTitle className="text-base md:text-lg font-black uppercase tracking-tight">
                                {activeSubTab === 'pending' ? 'Accounts Receivable' : activeSubTab === 'payments' ? 'Subscription Receipts' : 'Benefit Utilization Audit'}
                            </CardTitle>
                            <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                                {activeSubTab === 'pending' ? 'Monitor recurring revenue pipelines.' : activeSubTab === 'payments' ? 'History of settled recurring dues.' : 'Audit log of perk redemptions and usage.'}
                            </CardDescription>
                        </div>
                        {activeSubTab === 'pending' && (
                            <Button onClick={handleRunBatch} disabled={isProcessingBatch || isLoading} className="h-12 px-8 rounded-2xl shadow-xl font-black uppercase text-[10px] tracking-widest shadow-primary/20 w-full md:w-auto">
                                {isProcessingBatch ? <Loader className="animate-spin mr-2 h-4 w-4" /> : <Zap className="mr-2 h-4 w-4" />}
                                Run Subscription Batch
                            </Button>
                        )}
                    </div>
                    <div className="flex flex-col md:flex-row items-center gap-4 pt-4 border-t border-dashed">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                            <Input 
                                placeholder="SEARCH BY GUEST OR CLUB NAME..." 
                                className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest focus-visible:ring-primary/20 bg-white shadow-inner"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        {activeSubTab === 'pending' && (
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
                        )}
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <ScrollArea className="h-[500px]">
                        {activeSubTab === 'pending' ? (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader className="bg-muted/10 border-b-2">
                                        <TableRow>
                                            <TableHead className="font-black text-[10px] uppercase tracking-widest p-6 text-slate-900 text-left">Member & Tier</TableHead>
                                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-left">Value</TableHead>
                                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-left">Due Date</TableHead>
                                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-left">State</TableHead>
                                            <TableHead className="text-right font-black text-[10px] uppercase tracking-widest pr-10 text-slate-900">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredInstances.length > 0 ? filteredInstances.map(instance => (
                                            <SubscriptionRowInternal 
                                                key={instance.id} 
                                                instance={instance} 
                                                client={clients.find(c => c.id === instance.clientId)}
                                                membership={memberships.find(m => m.id === instance.membershipId)}
                                                onSettle={setSettlingInstance}
                                                onTerminate={setTerminatingInstance}
                                            />
                                        )) : (
                                            <TableRow><TableCell colSpan={5} className="py-20 text-center opacity-30 uppercase font-black tracking-widest text-xs">No pending dues</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        ) : activeSubTab === 'payments' ? (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader className="bg-muted/10 border-b-2">
                                        <TableRow>
                                            <TableHead className="font-black text-[10px] uppercase tracking-widest p-6 text-slate-900 text-left">Transaction & Member</TableHead>
                                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-left">Settlement</TableHead>
                                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-left">Method</TableHead>
                                            <TableHead className="text-right font-black text-[10px] uppercase tracking-widest pr-10 text-slate-900">Amount</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {historicalTransactions.length > 0 ? historicalTransactions.map(t => (
                                            <TableRow key={t.id} className="hover:bg-muted/5 transition-colors">
                                                <TableCell className="p-6">
                                                    <div className="text-left space-y-1">
                                                        <p className="font-black uppercase tracking-tight text-xs text-slate-900">{t.clientOrVendor}</p>
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 truncate max-w-[200px]">{t.description}</p>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-left font-black text-[10px] uppercase text-slate-600">{format(new Date(t.date), 'MMM d, yyyy')}</TableCell>
                                                <TableCell className="text-left">
                                                    <Badge variant="outline" className="h-5 px-2 border-none bg-primary/5 text-primary text-[8px] font-black uppercase">{t.paymentMethod}</Badge>
                                                </TableCell>
                                                <TableCell className="text-right pr-10 font-black font-mono text-base text-primary tracking-tighter">+${t.amount.toFixed(2)}</TableCell>
                                            </TableRow>
                                        )) : (
                                            <TableRow><TableCell colSpan={4} className="py-20 text-center opacity-30 uppercase font-black tracking-widest text-xs">No payment history</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader className="bg-muted/10 border-b-2">
                                        <TableRow>
                                            <TableHead className="font-black text-[10px] uppercase tracking-widest p-6 text-slate-900 text-left">Perk Redeemed</TableHead>
                                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-left">Member Account</TableHead>
                                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-left">Origin Tier</TableHead>
                                            <TableHead className="text-right font-black text-[10px] uppercase tracking-widest pr-10 text-slate-900">Timestamp</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {historicalRedemptions.length > 0 ? historicalRedemptions.map(r => {
                                            const rClient = clients.find(c => c.id === r.clientId);
                                            return (
                                                <TableRow key={r.id} className="hover:bg-muted/5 transition-colors">
                                                    <TableCell className="p-6">
                                                        <div className="text-left flex items-center gap-3">
                                                            <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-600 shadow-inner">
                                                                <Star className="w-4 h-4" />
                                                            </div>
                                                            <p className="font-black uppercase tracking-tight text-xs text-slate-900">{r.serviceName}</p>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-left font-black uppercase text-[10px] text-slate-600">{rClient?.name || 'Guest'}</TableCell>
                                                    <TableCell className="text-left">
                                                        <Badge variant="outline" className="h-5 px-2 border-2 border-indigo-500/20 bg-indigo-50 text-indigo-700 text-[8px] font-black uppercase">{r.offeringName}</Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right pr-10 font-black font-mono text-xs text-slate-400">{format(new Date(r.date), 'MMM d, p')}</TableCell>
                                                </TableRow>
                                            )
                                        }) : (
                                            <TableRow><TableCell colSpan={4} className="py-20 text-center opacity-30 uppercase font-black tracking-widest text-xs">No redemptions logged</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>

            <div className="space-y-6">
                <Card className={cn(
                    "border-4 rounded-[2.5rem] shadow-2xl overflow-hidden transition-all",
                    isGatewayActive ? "border-primary/20 bg-primary/5 shadow-primary/10" : "border-border bg-white opacity-60"
                )}>
                    <CardHeader className="p-6 pb-2 text-left">
                        <div className="flex items-center gap-3 mb-2">
                            <div className={cn("p-2 rounded-xl", isGatewayActive ? "bg-primary text-white shadow-lg" : "bg-muted text-muted-foreground")}>
                                <Landmark className="w-4 h-4" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Gateway Status</span>
                        </div>
                        <CardTitle className="text-sm font-black uppercase tracking-widest">
                            {selectedTenant?.paymentGateway?.toUpperCase() || 'NONE CONNECTED'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 pt-0 space-y-4 text-left">
                        <div className="flex items-center justify-between">
                            <span className="text-[9px] font-black uppercase text-muted-foreground">Auto-Process</span>
                            <Badge variant={selectedTenant?.autoProcessMemberships ? "default" : "secondary"} className="h-5 px-2 font-black text-[8px] uppercase">{selectedTenant?.autoProcessMemberships ? "ACTIVE" : "DISABLED"}</Badge>
                        </div>
                        <p className="text-[10px] font-medium text-slate-500 uppercase leading-relaxed">
                            {isGatewayActive ? "Autonomous billing protocol is online. Cards on file will be auto-debited on their renewal dates." : "Connect Stripe or Square in Settings to enable autonomous recurring billing."}
                        </p>
                        <Button variant="outline" asChild className="w-full h-10 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest bg-white shadow-sm">
                            <Link href="/settings?tab=integrations">Configure Gateway</Link>
                        </Button>
                    </CardContent>
                </Card>

                <div className="p-6 rounded-[2.5rem] border-2 border-dashed bg-primary/[0.02] flex items-start gap-4 text-left shadow-inner">
                    <Info className="w-5 h-5 text-primary shrink-0 mt-0.5 opacity-40" />
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-primary">Protocol Insight</p>
                        <p className="text-[11px] font-medium text-slate-600 leading-relaxed uppercase tracking-tight">
                            The **Redemption Log** identifies how frequently guests utilize their monthly inclusions. High redemption rates confirm tier value, while low rates identify at-risk members.
                        </p>
                    </div>
                </div>
            </div>
        </div>

        <SettleMembershipDialog
            open={!!settlingInstance}
            onOpenChange={(v: boolean) => !v && setSettlingInstance(null)}
            instance={settlingInstance}
            client={clients.find(c => c.id === settlingInstance?.clientId)}
            onConfirm={handleSettleConfirm}
        />

        <AlertDialog open={!!terminatingInstance} onOpenChange={(v) => !v && setTerminatingInstance(null)}>
            <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                <AlertDialogHeader className="p-6 pb-0 text-left">
                    <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter leading-none">Terminate Subscription</AlertDialogTitle>
                    <AlertDialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-2">
                        Guest: <strong>{terminatingInstance?.clientName}</strong>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="p-6 text-sm font-medium text-slate-600 leading-relaxed uppercase tracking-tight text-left">
                    You are stopping the recurring cycle for this member. Due to the <strong>No-Commitment Protocol</strong>, access can be revoked immediately without penalty. Confirm termination?
                </div>
                <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                    <Button onClick={handleTerminateSubscription} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20 bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirm Termination</Button>
                    <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Abort</AlertDialogCancel>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </div>
  );
};
