'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
    ArrowRight
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
            <ContentComp side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[90dvh]")}>
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
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 font-black uppercase text-[10px] tracking-widest text-slate-400">Cancel</Button>
                        <Button onClick={methods.handleSubmit(onConfirm)} className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 group">
                            Finalize Settlement <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/>
                        </Button>
                    </div>
                </DialogFooter>
            </ContentComp>
        </DialogComp>
    );
};

const KpiCardInternal = ({ title, value, icon: Icon, description, colorClass }: { title: string, value: string, icon: any, description: string, colorClass?: string }) => (
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
  const { subscriptionInstances, clients, memberships, isLoading } = useInventory();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [terminatingInstance, setTerminatingInstance] = useState<SubscriptionInstance | null>(null);
  const [settlingInstance, setSettlingInstance] = useState<SubscriptionInstance | null>(null);

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
    const arrears = subscriptionInstances.filter(i => (i.status === 'failed' || i.status === 'pending') && isPast(parseISO(i.dueDate)) && !isToday(parseISO(i.dueDate))).reduce((acc, i) => acc + i.amount, 0);
    return { mrr, pending, arrears };
  }, [subscriptionInstances]);

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

    // Update Client Perks Logic
    const clientRef = doc(firestore, `tenants/${tenantId}/clients`, settlingInstance.clientId);
    batch.update(clientRef, {
        'subscription.status': 'active',
        'subscription.nextBillingDate': format(addMonths(parseISO(settlingInstance.dueDate), 1), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
        'subscription.perkUsage': {}, // Reset for new cycle
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
            <KpiCardInternal title="Active MRR" value={`$${stats.mrr.toFixed(0)}`} icon={TrendingUp} description="Collected this cycle" colorClass="text-primary" />
            <KpiCardInternal title="Projected Dues" value={`$${stats.pending.toFixed(0)}`} icon={Clock} description="Awaiting collection" colorClass="text-indigo-600" />
            <KpiCardInternal title="Arrears Alert" value={`$${stats.arrears.toFixed(0)}`} icon={AlertTriangle} description="Failed/Past due payments" colorClass="text-destructive" />
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
                                    <SubscriptionRowInternal 
                                        key={instance.id} 
                                        instance={instance} 
                                        client={clients.find(c => c.id === instance.clientId)}
                                        membership={memberships.find(m => m.id === instance.membershipId)}
                                        onSettle={setSettlingInstance}
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
