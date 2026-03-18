'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { 
    Edit, 
    Mail, 
    Phone, 
    Clock, 
    Award, 
    Repeat, 
    CheckCircle2, 
    ShieldAlert, 
    BadgeInfo, 
    Ban, 
    PlusCircle, 
    FlaskConical, 
    TrendingUp, 
    CreditCard, 
    Lock, 
    Zap, 
    Trash2,
    ArrowLeft,
    ArrowRight,
    Globe,
    ShieldPlus,
    AlertTriangle,
    Ear,
    Loader,
    ShieldCheck,
    Info,
    RefreshCw,
    Calendar as CalendarIcon,
    Users,
    TrendingDown,
    Activity,
    Landmark,
    Star,
    History,
    CheckCircle
} from 'lucide-react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, parseISO, subMonths, isAfter } from 'date-fns';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { EditClientDialog } from '@/components/clients/EditClientDialog';
import { AddFormulaDialog } from '@/components/clients/AddFormulaDialog';
import { formatPhoneNumber } from 'react-phone-number-input';
import { nanoid } from 'nanoid';
import { useFirebase, useDoc, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';
import { useInventory } from '@/context/InventoryContext';
import { collection, doc, arrayUnion, writeBatch, increment } from 'firebase/firestore';
import type { Client, Appointment, Service, CustomFormula, Membership, Redemption } from '@/lib/data';
import { useTenant } from '@/context/TenantContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

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

const getInitials = (name: string) => {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length > 1 && parts[parts.length-1]) {
        return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
};

const ClientIntelBanner = ({ client }: { client: Client }) => {
    const hasIntel = client.intel?.hasIncidents || client.medicalNotes || client.allergyNotes || client.sensoryNeeds || client.status === 'banned';
    if (!hasIntel) return null;

    return (
        <Card className={cn("bg-white border-2 rounded-[2rem] shadow-xl overflow-hidden relative transition-all", client.status === 'banned' && "border-destructive ring-4 ring-destructive/10")}>
            <div className={cn("absolute top-0 left-0 w-1.5 h-full", client.status === 'banned' ? "bg-destructive" : "bg-primary")} />
            <CardContent className="p-5 md:p-6 flex flex-wrap gap-x-8 gap-y-4 text-left">
                {client.status === 'banned' && (
                    <div className="flex items-center gap-3 text-left">
                        <div className="p-2 bg-destructive rounded-xl shadow-lg shadow-destructive/20"><Ban className="w-4 h-4 text-white" /></div>
                        <span className="text-[10px] md:text-xs font-black text-destructive uppercase tracking-widest">Banned Guest</span>
                    </div>
                )}
                {client.intel?.hasIncidents && (
                     <div className="flex items-center gap-3 text-left">
                        <div className="p-2 bg-purple-50/10 rounded-xl border border-purple-500/20 text-purple-600"><ShieldAlert className="w-4 h-4" /></div>
                        <span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-purple-600">Incident History</span>
                    </div>
                )}
                {client.medicalNotes && (
                    <div className="flex items-center gap-3 text-left">
                        <div className="p-2 bg-red-500/10 rounded-xl border border-red-500/20 text-red-600"><ShieldPlus className="w-4 h-4" /></div>
                        <span className="text-[10px] md:text-xs font-black text-red-600 uppercase tracking-widest">Medical Alert</span>
                    </div>
                )}
                {client.allergyNotes && (
                    <div className="flex items-center gap-3 text-left">
                        <div className="p-2 bg-orange-500/10 rounded-xl border-orange-500/20 text-orange-600 border"><AlertTriangle className="w-4 h-4" /></div>
                        <span className="text-[10px] md:text-xs font-black text-orange-600 uppercase tracking-widest">Allergy Warning</span>
                    </div>
                )}
                 {client.sensoryNeeds && (
                    <div className="flex items-center gap-3 text-left">
                        <div className="p-2 bg-blue-500/10 rounded-xl border-blue-500/20 text-blue-600 border"><Ear className="w-4 h-4" /></div>
                        <span className="text-[10px] md:text-xs font-black text-blue-600 uppercase tracking-widest">Sensory Intel</span>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

const AppointmentHistoryCard = ({
  appointment,
  onRebook,
}: {
  appointment: any;
  onRebook: (appointment: Appointment) => void;
}) => {
  const total = Number((appointment.revenue || appointment.service?.price || 0)) + Number(appointment.tipAmount || 0);
  return (
    <Card className="flex flex-col border-2 rounded-[1.5rem] shadow-sm overflow-hidden group hover:border-primary/20 transition-all bg-white text-left">
      <CardContent className="p-5 space-y-4 flex-1">
        <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1 text-left">
                <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">{appointment.service?.name || 'Session'}</p>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1 opacity-60">
                {format(safeDate(appointment.startTime), 'MMMM d, yyyy')}
                </p>
            </div>
            <Badge
                variant="secondary"
                className={cn(
                'capitalize font-black text-[8px] h-5 px-2 border-none',
                appointment.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'
                )}
            >
                {appointment.status}
            </Badge>
        </div>
        <div className="flex justify-between items-center text-sm pt-3 border-t border-dashed">
          <span className="text-[9px] font-black uppercase text-muted-foreground opacity-40">Total Yield</span>
          <span className="font-black text-lg font-mono tracking-tighter text-slate-900">
            ${total.toFixed(2)}
          </span>
        </div>
      </CardContent>
      <div className="p-2 pt-0 border-t bg-muted/5">
        <Button variant="ghost" size="sm" className="w-full font-black uppercase text-[9px] tracking-widest h-9 hover:bg-primary/5 text-primary" onClick={() => onRebook(appointment)}>
            <Repeat className="w-3.5 h-3.5 mr-2"/> Rebook Treatment
        </Button>
      </div>
    </Card>
  );
};

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const { id: clientId } = params;
  const { firestore, isUserLoading } = useFirebase();
  const { selectedTenant, role, isLoading: isTenantLoading } = useTenant();
  const { appointments: allAppointments, services, memberships, redemptions: allRedemptions, packages } = useInventory();
  const tenantId = selectedTenant?.id;
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const clientDocRef = useMemoFirebase(() => !firestore || !clientId || !tenantId ? null : doc(firestore, `tenants/${tenantId}/clients`, clientId), [firestore, tenantId, clientId]);
  const { data: client, isLoading: clientLoading, error: clientError } = useDoc<Client>(clientDocRef);
  
  const { toast } = useToast();
  const [isEditClientOpen, setIsEditClientOpen] = useState(false);
  const [isAddFormulaOpen, setIsAddFormulaOpen] = useState(false);
  const [isQuickSettleOpen, setIsQuickSettleOpen] = useState(false);
  const [isSettleProcessing, setIsSettleProcessing] = useState(false);

  const appointmentsForThisClient = useMemo(() => (allAppointments || []).filter(apt => apt.clientId === clientId).map(apt => ({ ...apt, service: services.find(s => s.id === apt.serviceId) })), [clientId, allAppointments, services]);
  const clientRedemptions = useMemo(() => (allRedemptions || []).filter(r => r.clientId === clientId).sort((a,b) => safeDate(b.date).getTime() - safeDate(a.date).getTime()), [clientId, allRedemptions]);

  const activeMembership = useMemo(() => {
    const mId = client?.subscription?.membershipId || client?.activeMembershipId;
    return (!mId || !memberships) ? null : memberships.find(m => m.id === mId);
  }, [client, memberships]);

  const isPerkUsedInCycle = (perkId: string) => {
    if (!client?.subscription?.nextBillingDate || !client.subscription.perkLastUsed) return false;
    
    const lastUsed = safeDate(client.subscription.perkLastUsed);
    const nextBilling = safeDate(client.subscription.nextBillingDate);
    const cycleStart = subMonths(nextBilling, 1);

    const isCurrentCycle = isAfter(lastUsed, cycleStart);
    if (!isCurrentCycle) return false;

    const usageCount = client.subscription.perkUsage?.[perkId] || 0;
    const perkDef = activeMembership?.includedServices?.find(s => s.id === perkId) || 
                    activeMembership?.includedAddOns?.find(a => a.id === perkId);
    
    return usageCount >= (perkDef?.quantity || 1);
  };

  const handleQuickSettle = async () => {
    if (!client || !firestore || !tenantId) return;
    setIsSettleProcessing(true);
    
    const batch = writeBatch(firestore);
    const amount = Number(client.outstandingBalance || 0);
    const now = new Date().toISOString();

    const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
    batch.set(txnRef, {
        id: txnRef.id,
        date: now,
        description: "Dossier Settlement (Quick Settle)",
        clientOrVendor: client.name,
        clientId: client.id,
        type: 'income',
        context: 'Business',
        category: 'Fee Recovery',
        amount: amount,
        paymentMethod: 'Card on File',
        paymentMethodIdentifier: `${client.cardOnFile?.brand} •••• ${client.cardOnFile?.last4}`,
        hasReceipt: false,
    });

    const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
    batch.update(clientRef, {
        outstandingBalance: 0,
        unpaidFees: [],
        lifetimeValue: increment(amount)
    });

    try {
        await batch.commit();
        toast({ title: "Account Reconciled", description: `Successfully charged ${client.cardOnFile?.brand} for $${amount.toFixed(2)}.` });
        setIsQuickSettleOpen(false);
    } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: "Process Failed" });
    } finally {
        setIsSettleProcessing(false);
    }
  };

  const handleSaveFormula = (formula: CustomFormula) => {
      if (!firestore || !tenantId || !client) return;
      const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
      updateDocumentNonBlocking(clientRef, { customFormulas: arrayUnion(formula) });
      toast({ title: "Protocol Archived", description: `"${formula.name}" registered in technical library.` });
  }

  const handleDeleteFormula = (formulaId: string) => {
      if (!firestore || !tenantId || !client) return;
      const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
      const nextFormulas = (client.customFormulas || []).filter(f => f.id !== formulaId);
      updateDocumentNonBlocking(clientRef, { customFormulas: nextFormulas });
      toast({ title: "Protocol Purged", description: "Formula removed from technical archive." });
  }

  // DEFENSIVE: Ensure we parse numeric values correctly to avoid $NaN display issues
  const { safeLTV, safeWalletCredit, safeOutstandingBalance } = useMemo(() => {
      const getNum = (v: any) => {
          const n = Number(v);
          return isNaN(n) ? 0 : n;
      }
      return {
          safeLTV: getNum(client?.lifetimeValue),
          safeWalletCredit: getNum(client?.walletCredit),
          safeOutstandingBalance: getNum(client?.outstandingBalance)
      };
  }, [client]);

  if (isUserLoading || isTenantLoading || clientLoading) {
      return <div className="flex min-h-screen w-full flex-col bg-slate-50/50"><AppHeader title="Profile" /><main className="flex-1 p-4 md:p-10 flex items-center justify-center"><Loader className="w-8 h-8 animate-spin text-primary" /></main></div>;
  }
  if (clientError || !client || !tenantId) return notFound();

  const upcomingAppointments = appointmentsForThisClient.filter(apt => safeDate(apt.startTime) > new Date() && apt.status !== 'cancelled');
  const pastAppointments = appointmentsForThisClient.filter(apt => safeDate(apt.startTime) <= new Date()).sort((a,b) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime());

  const hasDebt = safeOutstandingBalance > 0;
  const hasCardOnFile = !!client.cardOnFile?.token;

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50 overflow-x-hidden">
      <AppHeader title="Guest Dossier" />
      <main className="flex-1 p-4 sm:p-6 md:p-10 space-y-8 md:space-y-10 w-full max-w-7xl mx-auto min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 text-left">
                <div className="space-y-1">
                    <h1 className="text-2xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Record Detail</h1>
                    <p className="text-[10px] md:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Identity & performance profile</p>
                </div>
                <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto">
                    <Button variant="outline" size="sm" asChild className="flex-1 sm:flex-none h-12 px-4 md:px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm shadow-sm"><Link href="/clients" className="flex items-center"><ArrowLeft className="h-4 w-4 mr-2" />Return</Link></Button>
                    {isOwnerOrAdmin && <Button variant="outline" size="sm" onClick={() => setIsEditClientOpen(true)} className="flex-1 sm:flex-none h-12 px-4 md:px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm shadow-sm"><Edit className="h-4 w-4 mr-2" />Modify</Button>}
                </div>
            </div>
            
            <Card className={cn("border-4 shadow-3xl rounded-[2.5rem] md:rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl transition-all", client.status === 'banned' && "border-destructive ring-4 ring-destructive/10")}>
                 <CardContent className="p-6 md:p-12 flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-6 md:gap-12">
                    <div className="relative shrink-0">
                        <Avatar className="w-28 h-28 md:w-40 md:h-40 text-2xl border-4 border-white shadow-2xl rounded-[2.5rem] md:rounded-[3rem]">
                            <AvatarImage src={client.avatarUrl} alt={client.name} className="object-cover" />
                            <AvatarFallback className="font-black bg-primary/10 text-primary">{getInitials(client.name)}</AvatarFallback>
                        </Avatar>
                        {activeMembership && <div className="absolute -top-2 -right-2 md:-top-3 md:-right-3 bg-indigo-600 text-white p-1.5 md:p-2 rounded-2xl shadow-xl border-4 border-white"><Award className="w-4 h-4 md:w-6 md:h-6" /></div>}
                    </div>
                    <div className="space-y-4 flex-1 min-w-0 w-full">
                        <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-start sm:items-baseline gap-3 md:gap-4">
                            <h2 className={cn("font-black uppercase tracking-tighter text-slate-900 truncate leading-none w-full sm:w-auto", client.name.length > 15 ? "text-xl md:text-4xl" : "text-2xl md:text-5xl")}>{client.name}</h2>
                            <div className="flex gap-2 shrink-0">
                                {activeMembership && <Badge className="bg-indigo-500/10 text-indigo-700 border-none font-black text-[8px] md:text-[9px] uppercase tracking-widest h-6 px-3">Master Member</Badge>}
                                {client.status === 'banned' && <Badge variant="destructive" className="animate-pulse font-black text-[8px] md:text-[9px] uppercase tracking-widest h-6 px-3">Hard Restriction</Badge>}
                            </div>
                        </div>
                        <div className="flex flex-wrap justify-center sm:justify-start gap-x-6 sm:gap-x-10 gap-y-4 pt-2 w-full text-left">
                            {isOwnerOrAdmin ? (
                                <div className="space-y-1 min-w-0 max-w-full text-left">
                                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Verified Contact</p>
                                    <a href={`mailto:${client.email}`} className="text-xs md:text-sm font-black uppercase tracking-tight text-primary hover:underline block truncate w-full">{client.email}</a>
                                    <p className="text-xs md:text-sm font-black tracking-tight text-slate-700">{client.phone ? formatPhoneNumber(client.phone) : 'N/A'}</p>
                                </div>
                            ) : (
                                <div className="space-y-1 text-left">
                                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Verified Contact</p>
                                    <p className="text-xs md:text-sm font-black uppercase tracking-tight text-muted-foreground italic">Contact Restricted</p>
                                </div>
                            )}
                            <div className="space-y-1 text-left">
                                <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Discovery Source</p>
                                <p className="text-xs md:text-sm font-black uppercase tracking-tight text-slate-700">{client.intel?.referralSource || 'Unknown'}</p>
                            </div>
                            <div className="space-y-1 text-left">
                                <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Strategic Origin</p>
                                <div className="flex items-center gap-2">
                                    <Badge variant="secondary" className="h-6 px-2.5 rounded-lg border-2 font-black text-[8px] md:text-[9px] uppercase tracking-widest bg-white shadow-sm flex items-center gap-1.5 w-fit">
                                        <Globe className="w-3 h-3" />
                                        Online
                                    </Badge>
                                </div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <ClientIntelBanner client={client} />
            
            <div className="grid lg:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-10">
                <div className="lg:col-span-2 xl:col-span-3 space-y-8 md:space-y-10 min-w-0">
                    <Tabs defaultValue="overview">
                        <ScrollArea className="w-full overflow-hidden">
                            <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-6 md:mb-8 w-max">
                                <TabsTrigger value="overview" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Overview</TabsTrigger>
                                <TabsTrigger value="history" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">History</TabsTrigger>
                                <TabsTrigger value="archive" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Technical Archive</TabsTrigger>
                                <TabsTrigger value="ledger" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Financial Ledger</TabsTrigger>
                            </TabsList>
                            <ScrollBar orientation="horizontal" className="hidden" />
                        </ScrollArea>
                        
                        <TabsContent value="overview" className="m-0 space-y-6 md:space-y-8 animate-in fade-in duration-500">
                            {activeMembership && (
                                <div className="space-y-4">
                                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-indigo-600 flex items-center gap-3 text-left">
                                        <Award className="w-5 h-5" />
                                        Active Privilege Matrix
                                    </h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                                        {(activeMembership.includedServices || []).map(perk => {
                                            const used = client.subscription?.perkUsage?.[perk.id] || 0;
                                            const isRedeemed = isPerkUsedInCycle(perk.id);
                                            const progress = (used / perk.quantity) * 100;
                                            return (
                                                <Card key={perk.id} className="border-2 rounded-2xl overflow-hidden bg-white shadow-sm hover:border-indigo-500/20 transition-all text-left">
                                                    <CardContent className="p-5 space-y-4 text-left">
                                                        <div className="flex justify-between items-start gap-2">
                                                            <div className="min-w-0">
                                                                <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 truncate leading-none mb-1">{perk.name}</p>
                                                                <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">Monthly Service Allotment</p>
                                                            </div>
                                                            <div className={cn("p-2 rounded-xl shadow-inner", isRedeemed ? "bg-green-500/10 text-green-600" : "bg-indigo-500/10 text-indigo-600")}>
                                                                {isRedeemed ? <CheckCircle className="w-4 h-4" /> : <Star className="w-4 h-4" />}
                                                            </div>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                                                                <span>Allotment Usage</span>
                                                                <span>{used} / {perk.quantity}</span>
                                                            </div>
                                                            <Progress value={progress} className={cn("h-1.5 rounded-full bg-muted", isRedeemed && "[&>div]:bg-green-500")} />
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            )
                                        })}
                                        {(activeMembership.includedAddOns || []).map(perk => {
                                            const used = client.subscription?.perkUsage?.[perk.id] || 0;
                                            const isRedeemed = isPerkUsedInCycle(perk.id);
                                            const progress = (used / perk.quantity) * 100;
                                            return (
                                                <Card key={perk.id} className="border-2 rounded-2xl overflow-hidden bg-white shadow-sm hover:border-amber-500/20 transition-all text-left">
                                                    <CardContent className="p-5 space-y-4">
                                                        <div className="flex justify-between items-start">
                                                            <div className="min-w-0">
                                                                <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 truncate leading-none mb-1">{perk.name}</p>
                                                                <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">Monthly Enhancement Allotment</p>
                                                            </div>
                                                            <div className={cn("p-2 rounded-xl shadow-inner", isRedeemed ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600")}>
                                                                {isRedeemed ? <CheckCircle className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                                                            </div>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                                                                <span>Allotment Usage</span>
                                                                <span>{used} / {perk.quantity}</span>
                                                            </div>
                                                            <Progress value={progress} className={cn("h-1.5 rounded-full bg-muted", isRedeemed && "[&>div]:bg-green-500")} />
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            <Card className="border-2 shadow-sm rounded-[2rem] md:rounded-[2.5rem] overflow-hidden bg-white text-left">
                                <CardHeader className="bg-muted/5 border-b p-6 md:p-8 pb-4 text-left">
                                    <CardTitle className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-3"><BadgeInfo className="w-4 h-4 text-primary" /> Dossier Details</CardTitle>
                                </CardHeader>
                                <CardContent className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-10 text-left">
                                    <div className="space-y-6">
                                        <div className="space-y-1 text-left">
                                            <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Birth Milestone</p>
                                            <p className="text-base md:text-lg font-black uppercase text-slate-900 tracking-tight">{client.birthday ? format(safeDate(client.birthday), 'MMMM d') : 'Not on file'}</p>
                                        </div>
                                        {client.address && <div className="space-y-1 text-left"><p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Primary Domicile</p><p className="text-xs md:sm font-bold text-slate-700 leading-relaxed uppercase tracking-tight">{client.address.street}<br/>{client.address.city}, {client.address.state} {client.address.zip}</p></div>}
                                    </div>
                                    <div className="space-y-6 text-left">
                                        {client.emergencyContact && <div className="space-y-1 p-4 md:p-5 rounded-2xl bg-destructive/[0.02] border-2 border-destructive/10 text-left"><p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-destructive/60 mb-2">Emergency Protocol</p><p className="text-xs md:sm font-black text-slate-900 uppercase tracking-tight">{client.emergencyContact.name}</p><p className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest opacity-60">{client.emergencyContact.relationship}</p><p className="text-xs md:sm font-black text-primary tracking-tight mt-2">{client.emergencyContact.phone ? formatPhoneNumber(client.emergencyContact.phone) : 'N/A'}</p></div>}
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="history" className="m-0 space-y-8 md:space-y-10 animate-in fade-in duration-500 text-left">
                            <div className="space-y-4">
                                <h3 className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-4 text-left">Scheduled Events</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {upcomingAppointments.length > 0 ? upcomingAppointments.map((apt) => <AppointmentHistoryCard key={apt.id} appointment={apt} onRebook={() => {}} />) : <div className="col-span-full py-12 md:py-16 text-center border-4 border-dashed rounded-[2rem] md:rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3"><CalendarIcon className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-2"/><p className="text-[10px] md:text-xs font-black uppercase tracking-widest">No upcoming sessions</p></div>}
                                </div>
                            </div>
                            <div className="space-y-4 pt-6 border-t border-dashed">
                                <h3 className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-4 text-left">Historical Records</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {pastAppointments.length > 0 ? pastAppointments.map((apt) => <AppointmentHistoryCard key={apt.id} appointment={apt} onRebook={() => {}} />) : <div className="col-span-full py-12 md:py-16 text-center border-4 border-dashed rounded-[2rem] md:rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3"><Clock className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-2"/><p className="text-[10px] font-black uppercase tracking-widest">Empty history</p></div>}
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="archive" className="m-0 space-y-8 animate-in fade-in duration-500 text-left">
                            <div className="space-y-6">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1">
                                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3">
                                        <FlaskConical className="w-5 h-5" />
                                        Technical Archive
                                    </h3>
                                    <Button variant="ghost" size="sm" onClick={() => setIsAddFormulaOpen(true)} className="h-8 px-4 rounded-xl border-2 border-primary/20 bg-primary/5 text-primary font-black uppercase text-[10px] tracking-widest shadow-sm hover:bg-primary/10">
                                        <PlusCircle className="mr-2 h-3.5 w-3.5" /> Establish Protocol
                                    </Button>
                                </div>
                                
                                {client.customFormulas && client.customFormulas.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                        {client.customFormulas.map((formula) => (
                                            <Card key={formula.id} className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm hover:border-primary/20 transition-all group text-left">
                                                <CardHeader className="bg-muted/5 border-b p-5 flex flex-row items-center justify-between text-left">
                                                    <div className="space-y-0.5 text-left">
                                                        <CardTitle className="text-xs font-black uppercase tracking-tight">{formula.name}</CardTitle>
                                                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 text-left">Established {format(safeDate(formula.date), 'MMM d, yyyy')}</p>
                                                    </div>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDeleteFormula(formula.id)}>
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                </CardHeader>
                                                <CardContent className="p-5 space-y-4">
                                                    <div className="space-y-2">
                                                        {formula.items.map((item, idx) => (
                                                            <div key={idx} className="flex justify-between items-center text-[10px] font-bold uppercase tracking-tight p-2 rounded-xl bg-muted/20 border-2 border-transparent">
                                                                <span className="text-slate-600 truncate mr-2">{item.name}</span>
                                                                <span className="font-black text-slate-900 shrink-0">{item.quantity}{item.unit}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {formula.notes && (
                                                        <div className="pt-2 text-left">
                                                            <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mb-1">Audit Notes</p>
                                                            <p className="text-[10px] font-medium text-slate-500 leading-relaxed italic border-l-2 border-primary/20 pl-3">"{formula.notes}"</p>
                                                        </div>
                                                    )}
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                        <FlaskConical className="w-16 h-16" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-center px-8 leading-relaxed">No strategic formulas archived. Save a formula during technical review or manually build a protocol above.</p>
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        <TabsContent value="ledger" className="m-0 space-y-8 animate-in fade-in duration-500 text-left">
                            <div className="space-y-4">
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-destructive ml-1">Unpaid Protocol Fees</h3>
                                {client.unpaidFees && client.unpaidFees.length > 0 ? (
                                    <div className="grid gap-3">
                                        {client.unpaidFees.map((fee) => (
                                            <div key={fee.feeId} className="flex justify-between items-center p-5 rounded-2xl border-2 border-destructive/20 bg-destructive/[0.02] shadow-sm">
                                                <div className="space-y-1 text-left">
                                                    <p className="font-black text-sm uppercase tracking-tight text-destructive">{fee.reason}</p>
                                                    <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Incurred {format(safeDate(fee.appointmentDate), 'MMM d, yyyy')}</p>
                                                </div>
                                                <p className="text-xl font-black font-mono tracking-tighter text-destructive">${Number(fee.feeAmount || 0).toFixed(2)}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : <div className="py-10 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3"><CheckCircle2 className="w-10 h-10" /><p className="text-[10px] font-black uppercase tracking-widest">Account Clear</p></div>}
                            </div>

                            <Separator className="border-dashed" />

                            <div className="space-y-4 text-left">
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Certified Redemptions & Waivers</h3>
                                <div className="grid gap-3">
                                    {clientRedemptions.map(r => (
                                        <div key={r.id} className={cn("flex items-center justify-between p-4 rounded-2xl border-2 bg-white", r.isForfeit && "border-destructive/20 bg-destructive/[0.01]")}>
                                            <div className="flex items-center gap-4">
                                                <div className={cn("p-2 rounded-xl shadow-inner", r.isForfeit ? "bg-destructive/10 text-destructive" : r.type === 'membership' ? "bg-indigo-500/10 text-indigo-600" : "bg-teal-500/10 text-teal-600")}>
                                                    {r.isForfeit ? <AlertTriangle className="w-4 h-4" /> : r.type === 'membership' ? <Award className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
                                                </div>
                                                <div className="min-w-0 text-left">
                                                    <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 truncate">{r.serviceName}</p>
                                                    <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">Via {r.offeringName}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] font-black font-mono">{format(safeDate(r.date), 'MMM d, yy')}</p>
                                                <Badge variant={r.isForfeit ? "destructive" : "outline"} className="h-4 px-1 text-[7px] font-black uppercase mt-1 border-none shadow-sm">{r.isForfeit ? "FORFEITED" : "REDEEMED"}</Badge>
                                            </div>
                                        </div>
                                    ))}
                                    {clientRedemptions.length === 0 && (
                                        <div className="py-10 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3">
                                            <History className="w-10 h-10" />
                                            <p className="text-[10px] font-black uppercase tracking-widest">No Redemption History</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>

                <div className="lg:col-span-1 space-y-8 text-left">
                    <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white text-left">
                        <CardHeader className="bg-muted/5 border-b p-6 flex flex-row items-center justify-between">
                            <CardTitle className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground">Financial Vault</CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-6">
                            <div className="p-5 md:p-6 rounded-[1.5rem] bg-primary/5 border-2 border-primary/10 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-4 opacity-5"><TrendingUp className="w-10 h-10 md:w-12 md:h-12 text-primary"/></div>
                                <p className="text-[8px] md:text-[9px] font-black uppercase text-primary/60 tracking-widest mb-1">Lifetime Yield</p>
                                <p className="text-3xl md:text-4xl font-black text-primary tracking-tighter font-mono leading-none">${safeLTV.toFixed(2)}</p>
                            </div>
                            
                            <div className="grid grid-cols-1 gap-4">
                                <div className="p-4 md:p-5 rounded-[1.5rem] bg-muted/20 border-2 shadow-inner">
                                    <p className="text-[8px] md:text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60">Store Credit</p>
                                    <p className="text-xl md:text-2xl font-black text-slate-900 tracking-tighter font-mono">${safeWalletCredit.toFixed(2)}</p>
                                </div>
                                <div className={cn("p-4 md:p-5 rounded-[1.5rem] border-2 shadow-inner transition-all", hasDebt ? "bg-destructive/5 border-destructive/20 text-destructive animate-in pulse duration-1000" : "bg-muted/20 border-transparent")}>
                                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest mb-1 opacity-60">Account Arrears</p>
                                    <p className="text-xl md:text-2xl font-black tracking-tighter font-mono">${safeOutstandingBalance.toFixed(2)}</p>
                                </div>
                            </div>

                            <Separator className="border-dashed" />

                            <div className="space-y-4 text-left">
                                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2">
                                    <Lock className="w-3 h-3" /> Secure Card on File
                                </p>
                                {client.cardOnFile ? (
                                    <div className="p-4 rounded-2xl border-2 border-primary/10 bg-primary/[0.02] flex items-center justify-between">
                                        <div className="flex items-center gap-3 text-left">
                                            <div className="p-2 bg-white rounded-xl shadow-sm border border-primary/10">
                                                <CreditCard className="w-5 h-5 text-primary" />
                                            </div>
                                            <div className="text-left">
                                                <p className="text-xs font-black uppercase tracking-tighter text-slate-900">{client.cardOnFile.brand} •••• {client.cardOnFile.last4}</p>
                                                <p className="text-[8px] font-bold text-muted-foreground uppercase">Exp: {client.cardOnFile.expiryMonth}/{client.cardOnFile.expiryYear}</p>
                                            </div>
                                        </div>
                                        <Button variant="ghost" size="icon" onClick={() => setIsEditClientOpen(true)} className="h-8 w-8 text-primary hover:bg-primary/5">
                                            <RefreshCw className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                ) : (
                                    <Button variant="outline" onClick={() => setIsEditClientOpen(true)} className="w-full h-12 rounded-xl border-2 border-dashed font-black uppercase text-[9px] tracking-widest bg-muted/5 hover:bg-primary/[0.02] hover:border-primary/20 transition-all">
                                        <PlusCircle className="mr-2 h-3.5 w-3.5 opacity-40" /> Vault Security Card
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                        <CardFooter className="p-6 pt-0 flex flex-col gap-3">
                            {hasDebt && hasCardOnFile && (
                                <Button 
                                    className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 bg-primary text-white"
                                    onClick={() => setIsQuickSettleOpen(true)}
                                >
                                    <Zap className="mr-2 h-4 w-4" /> Charge Card on File
                                </Button>
                            )}
                            <Button 
                                disabled={!hasDebt} 
                                variant="outline"
                                className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-xs border-2" 
                                asChild
                            >
                                <Link href={`/pos?payer_id=${client.id}&action=settle`}>
                                    Initialize POS Settlement
                                </Link>
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            </div>
      </main>
      
      <EditClientDialog open={isEditClientOpen} onOpenChange={setIsEditClientOpen} client={client} onSave={(data) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, client.id), data); toast({ title: "Profile Updated" }); }} />
      <AddFormulaDialog open={isAddFormulaOpen} onOpenChange={setIsAddFormulaOpen} clientName={client.name} onSave={handleSaveFormula} />

      <Dialog open={isQuickSettleOpen} onOpenChange={setIsQuickSettleOpen}>
        <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden">
            <DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left">
                <div className="flex items-center gap-3 mb-2">
                    <ShieldCheck className="w-5 h-5 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Strategic Settlement</span>
                </div>
                <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">Confirm Vault Charge</DialogTitle>
                <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Authorize debt reconciliation for: <strong>{client.name}</strong></DialogDescription>
            </DialogHeader>
            <div className="p-8 space-y-8">
                <div className="p-8 rounded-[2.5rem] bg-primary/5 border-4 border-primary/10 text-center space-y-4 shadow-2xl shadow-primary/5">
                    <p className="text-[10px] font-black uppercase text-primary/60 tracking-widest">Total Arrears Balance</p>
                    <p className="text-5xl font-black text-primary tracking-tighter font-mono">${safeOutstandingBalance.toFixed(2)}</p>
                </div>
                <div className="space-y-4 text-left">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Distribution Method</p>
                    <div className="p-4 rounded-2xl border-2 bg-muted/5 flex items-center gap-4 text-left">
                        <div className="p-2 bg-white rounded-xl shadow-sm border"><CreditCard className="w-5 h-5 text-primary" /></div>
                        <div className="text-left">
                            <p className="font-black text-sm uppercase tracking-tight text-slate-900">{client.cardOnFile?.brand} •••• {client.cardOnFile?.last4}</p>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase">Authorized Vault Access</p>
                        </div>
                    </div>
                </div>
                <div className="p-4 rounded-xl border-2 border-dashed bg-muted/10 flex items-start gap-3 text-left">
                    <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 opacity-40" />
                    <p className="text-[10px] font-bold text-slate-600 leading-relaxed uppercase tracking-tight">This will instantly clear the client's unpaid fees and create a verified revenue record in the studio ledger.</p>
                </div>
            </div>
            <DialogFooter className="p-8 pt-0 flex flex-col gap-3">
                <Button 
                    className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30"
                    onClick={handleQuickSettle}
                    disabled={isSettleProcessing}
                >
                    {isSettleProcessing ? <Loader className="animate-spin" /> : 'Authorize Charge'}
                </Button>
                <Button variant="ghost" onClick={() => setIsQuickSettleOpen(false)} className="w-full font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
