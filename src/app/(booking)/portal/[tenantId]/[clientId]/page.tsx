'use client';

import React, { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { format, parseISO, subMonths, isAfter, isSameMonth } from 'date-fns';
import { Award, Repeat, Calendar, DollarSign, Gift, Loader, Clock, User, Heart, Star, CheckCircle, Percent, TicketIcon, History, AlertTriangle, Zap, CheckCircle2, ArrowRight, Tag, Sparkles, Wallet } from 'lucide-react';
import { type Client, type Appointment, type Service, type Membership, type Package, type Tenant, type Redemption } from '@/lib/data';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

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

export default function ClientPortalPage() {
    const { tenantId, clientId } = useParams() as { tenantId: string; clientId: string };
    const { firestore } = useFirebase();

    const clientRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}/clients/${clientId}`), [firestore, tenantId, clientId]);
    const { data: client, isLoading: clientLoading } = useDoc<Client>(clientRef);

    const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
    const { data: tenant } = useDoc<Tenant>(tenantRef);

    const appointmentsQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/appointments`), where('clientId', '==', clientId)), [firestore, tenantId, clientId]);
    const { data: appointments, isLoading: appointmentsLoading } = useCollection<Appointment>(appointmentsQuery);

    const redemptionsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/clients/${clientId}/redemptions`), [firestore, tenantId, clientId]);
    const { data: redemptions, isLoading: redemptionsLoading } = useCollection<Redemption>(redemptionsQuery);

    const servicesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
    const { data: services } = useCollection<Service>(servicesQuery);

    const membershipsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/memberships`), [firestore, tenantId]);
    const { data: memberships } = useCollection<Membership>(membershipsQuery);

    const packagesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/packages`), [firestore, tenantId]);
    const { data: packages } = useCollection<Package>(packagesQuery);

    const upcomingAppointments = useMemo(() => {
        if (!appointments) return [];
        return appointments
            .filter(a => a.status !== 'cancelled' && safeDate(a.startTime) > new Date())
            .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime());
    }, [appointments]);

    const pastAppointments = useMemo(() => {
        if (!appointments) return [];
        return appointments
            .filter(a => a.status === 'completed' || safeDate(a.startTime) <= new Date())
            .sort((a, b) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime());
    }, [appointments]);

    const activeMembership = useMemo(() => {
        const mId = client?.subscription?.membershipId || client?.activeMembershipId;
        if (!mId || !memberships) return null;
        return memberships.find(m => m.id === mId);
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

    if (clientLoading || appointmentsLoading || redemptionsLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader className="animate-spin text-primary" />
            </div>
        );
    }

    if (!client) return <div className="p-10 text-center font-black uppercase text-slate-400 text-left">Account not found.</div>;

    return (
        <div className="space-y-10 pb-20 text-left">
            <header className="flex flex-col md:flex-row items-center gap-8 text-center md:text-left">
                <div className="relative group">
                    <Avatar className="w-32 h-32 border-4 border-white shadow-2xl rounded-[3rem] overflow-hidden transition-all group-hover:scale-105">
                        <AvatarImage src={client.avatarUrl} className="object-cover" />
                        <AvatarFallback className="font-black text-2xl bg-primary/10 text-primary">{(client.name || 'G').substring(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    {activeMembership && (
                        <div className="absolute -top-3 -right-3 bg-indigo-600 text-white p-2 rounded-2xl shadow-xl border-4 border-white">
                            <Award className="w-6 h-6" />
                        </div>
                    )}
                </div>
                <div className="space-y-2 flex-1 min-w-0">
                    <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Hello, {client.name.split(' ')[0]}!</h1>
                    <p className="text-xs md:sm font-bold text-muted-foreground uppercase tracking-widest opacity-60">Subscriber Portal &middot; {tenant?.name}</p>
                </div>
                <div className="shrink-0">
                    <Button asChild size="lg" className="h-14 px-8 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 group">
                        <Link href={`/book/${tenantId}`}>
                            Secure New Session <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </Link>
                    </Button>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="bg-indigo-500/5 border-indigo-500/20 rounded-[2rem] overflow-hidden shadow-sm relative group">
                    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity"><Award className="w-20 h-20 text-indigo-600" /></div>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-indigo-700 flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> Club Status</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {activeMembership ? (
                            <div className="space-y-1 text-left">
                                <p className="text-2xl font-black uppercase tracking-tight text-slate-900 leading-none">{activeMembership.name}</p>
                                {client.subscription && (
                                    <Badge className="bg-indigo-600 text-white border-none font-black text-[8px] uppercase h-5 px-2 mt-2">{client.subscription.status}</Badge>
                                )}
                                <div className="pt-4 border-t border-indigo-500/10 mt-4 space-y-1 text-left">
                                    <p className="text-[8px] font-black text-indigo-600/60 uppercase">Renewal Date</p>
                                    <p className="text-xs font-black uppercase text-slate-700">{client.subscription?.nextBillingDate ? format(safeDate(client.subscription.nextBillingDate), 'MMMM d, yyyy') : 'N/A'}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="py-4 text-center opacity-40 uppercase font-black text-[10px] tracking-widest">No active membership</div>
                        )}
                    </CardContent>
                </Card>
                <Card className="rounded-[2rem] border-2 shadow-sm relative group overflow-hidden">
                    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity"><Wallet className="w-20 h-20 text-slate-900" /></div>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><DollarSign className="w-3.5 h-3.5" /> Store Credit</CardTitle>
                    </CardHeader>
                    <CardContent className="text-left">
                        <p className="text-4xl font-black text-slate-900 tracking-tighter font-mono">${(client.walletCredit || 0).toFixed(2)}</p>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 mt-1">Available for terminal checkout</p>
                    </CardContent>
                </Card>
                <Card className="rounded-[2rem] border-2 shadow-sm relative group overflow-hidden">
                    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity"><Tag className="w-20 h-20 text-slate-900" /></div>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><Tag className="w-3.5 h-3.5" /> Referral Protocol</CardTitle>
                    </CardHeader>
                    <CardContent className="text-left">
                        <div className="p-3 rounded-xl bg-muted/30 border-2 border-dashed flex items-center justify-between group/code cursor-pointer" onClick={() => { navigator.clipboard.writeText(client.referralCode || ''); }}>
                            <p className="text-xl font-black font-mono tracking-widest text-primary uppercase">{client.referralCode || 'N/A'}</p>
                            <Repeat className="w-4 h-4 text-primary opacity-0 group-hover/code:opacity-40 transition-opacity" />
                        </div>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 mt-3 leading-relaxed">Share this signature to earn credit on your profile.</p>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="appointments" className="w-full">
                <ScrollArea className="w-full">
                    <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-10 w-max mx-auto">
                        <TabsTrigger value="appointments" className="px-8 h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Schedule</TabsTrigger>
                        <TabsTrigger value="benefits" className="px-8 h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Benefit Pulse</TabsTrigger>
                        <TabsTrigger value="history" className="px-8 h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Usage Archive</TabsTrigger>
                    </TabsList>
                    <ScrollBar orientation="horizontal" className="hidden" />
                </ScrollArea>

                <TabsContent value="appointments" className="space-y-12 animate-in fade-in duration-500 text-left">
                    <div>
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-4 mb-4 opacity-60">Confirmed Window</h3>
                        {upcomingAppointments.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                {upcomingAppointments.map(apt => {
                                    const svc = services?.find(s => s.id === apt.serviceId);
                                    return (
                                        <Card key={apt.id} className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm hover:border-primary/20 transition-all">
                                            <CardContent className="p-6 flex items-center gap-6">
                                                <div className="p-4 bg-primary/5 rounded-2xl border-2 border-primary/10 shadow-inner text-primary shrink-0">
                                                    <Calendar className="w-8 h-8" />
                                                </div>
                                                <div className="min-w-0 text-left">
                                                    <p className="font-black text-lg uppercase tracking-tight text-slate-900 truncate mb-1">{svc?.name || 'Service'}</p>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-primary">{format(safeDate(apt.startTime), 'EEEE, MMM d')}</p>
                                                    <p className="text-sm font-black text-slate-500 font-mono tracking-tighter">{format(safeDate(apt.startTime), 'h:mm a')}</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                <Clock className="w-16 h-16" />
                                <p className="text-[10px] font-black uppercase tracking-widest">Agenda Empty</p>
                            </div>
                        )}
                    </div>

                    <Separator className="border-dashed" />

                    <div>
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-4 mb-4 opacity-60 text-left">Dossier History</h3>
                        <div className="grid gap-3">
                            {pastAppointments.slice(0, 10).map(apt => {
                                const svc = services?.find(s => s.id === apt.serviceId);
                                return (
                                    <div key={apt.id} className="flex justify-between items-center p-5 border-2 rounded-2xl bg-white hover:bg-muted/5 transition-all">
                                        <div className="text-left space-y-0.5">
                                            <p className="font-black text-sm uppercase tracking-tight text-slate-900">{svc?.name}</p>
                                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{format(safeDate(apt.startTime), 'MMMM d, yyyy')}</p>
                                        </div>
                                        <Badge variant="outline" className="h-6 px-2.5 rounded-lg border-2 font-black text-[8px] uppercase tracking-widest bg-muted/20">{apt.status}</Badge>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="benefits" className="space-y-12 animate-in fade-in duration-500 text-left">
                    {activeMembership && (
                        <div className="space-y-6">
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-indigo-600 flex items-center gap-3">
                                <Star className="w-5 h-5" />
                                Monthly Allotment Matrix
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {(activeMembership.includedServices || []).map(perk => {
                                    const used = client.subscription?.perkUsage?.[perk.id] || 0;
                                    const isRedeemed = isPerkUsedInCycle(perk.id);
                                    const progress = (used / perk.quantity) * 100;
                                    return (
                                        <Card key={perk.id} className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm hover:border-indigo-500/20 transition-all">
                                            <CardContent className="p-6 space-y-5">
                                                <div className="flex justify-between items-start">
                                                    <div className="space-y-1 text-left">
                                                        <p className="font-black text-base uppercase tracking-tight text-slate-900">{perk.name}</p>
                                                        <p className="text-[9px] font-black text-indigo-600/60 uppercase tracking-widest">Included Treatment</p>
                                                    </div>
                                                    <div className={cn("p-2.5 rounded-xl shadow-inner", isRedeemed ? "bg-green-500/10 text-green-600" : "bg-indigo-500/10 text-indigo-600")}>
                                                        {isRedeemed ? <CheckCircle2 className="w-5 h-5" /> : <Star className="w-5 h-5" />}
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                                                        <span>Cycle Progress</span>
                                                        <span>{used} / {perk.quantity} used</span>
                                                    </div>
                                                    <Progress value={progress} className={cn("h-2 rounded-full bg-muted", isRedeemed && "[&>div]:bg-green-500")} />
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
                                        <Card key={perk.id} className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm hover:border-amber-500/20 transition-all">
                                            <CardContent className="p-6 space-y-5">
                                                <div className="flex justify-between items-start">
                                                    <div className="space-y-1 text-left">
                                                        <p className="font-black text-base uppercase tracking-tight text-slate-900">{perk.name}</p>
                                                        <p className="text-[9px] font-black text-amber-600/60 uppercase tracking-widest">Included Enhancement</p>
                                                    </div>
                                                    <div className={cn("p-2.5 rounded-xl shadow-inner", isRedeemed ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600")}>
                                                        {isRedeemed ? <CheckCircle2 className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                                                        <span>Cycle Progress</span>
                                                        <span>{used} / {perk.quantity} used</span>
                                                    </div>
                                                    <Progress value={progress} className={cn("h-2 rounded-full bg-muted", isRedeemed && "[&>div]:bg-green-500")} />
                                                </div>
                                            </CardContent>
                                        </Card>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {client.activePackages && client.activePackages.length > 0 && (
                        <div className="space-y-6">
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-teal-600 flex items-center gap-3">
                                <Repeat className="w-5 h-5" />
                                Prepaid Service Bundles
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {client.activePackages.map((pack, idx) => {
                                    const details = packages?.find(p => p.id === pack.packageId);
                                    const svc = services?.find(s => s.id === details?.serviceId);
                                    const progress = (pack.sessionsRemaining / (details?.sessions || 1)) * 100;
                                    return (
                                        <Card key={idx} className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm hover:border-teal-500/20 transition-all">
                                            <CardContent className="p-6 space-y-5">
                                                <div className="flex justify-between items-start">
                                                    <div className="space-y-1 text-left">
                                                        <p className="font-black text-base uppercase tracking-tight text-slate-900">{details?.name}</p>
                                                        <p className="text-[9px] font-black text-teal-600/60 uppercase tracking-widest">{svc?.name}</p>
                                                    </div>
                                                    <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-600 shadow-inner">
                                                        <Repeat className="w-5 h-5" />
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                                                        <span>Sessions Remaining</span>
                                                        <span>{pack.sessionsRemaining} / {details?.sessions}</span>
                                                    </div>
                                                    <Progress value={progress} className="h-2 rounded-full bg-muted [&>div]:bg-teal-500" />
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="history" className="m-0 space-y-8 animate-in fade-in duration-500 text-left">
                    <div>
                        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3 ml-1 mb-6">
                            <History className="w-5 h-5" />
                            Redemption Archive
                        </h3>
                        {redemptions && redemptions.length > 0 ? (
                            <div className="grid gap-3">
                                {redemptions.sort((a,b) => safeDate(b.date).getTime() - safeDate(a.date).getTime()).map(r => (
                                    <div key={r.id} className={cn("flex items-center justify-between p-5 rounded-[1.5rem] border-2 bg-white shadow-sm hover:border-primary/20 transition-all", r.isForfeit && "border-destructive/20 bg-destructive/[0.01]")}>
                                        <div className="flex items-center gap-4">
                                            <div className={cn("p-3 rounded-2xl shadow-inner", r.isForfeit ? "bg-destructive/10 text-destructive" : r.isRollover ? "bg-blue-500/10 text-blue-600" : "bg-indigo-500/10 text-indigo-600")}>
                                                {r.isForfeit ? <AlertTriangle className="w-4 h-4" /> : r.isRollover ? <RefreshCw className="w-4 h-4" /> : <Star className="w-4 h-4" />}
                                            </div>
                                            <div className="min-w-0 text-left">
                                                <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate leading-none mb-1">{r.serviceName}</p>
                                                <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 text-left">Drawn from {r.offeringName}</p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0 ml-4">
                                            <p className="font-black font-mono text-[11px] text-slate-900 leading-none">{format(safeDate(r.date), 'MMM d, p')}</p>
                                            <Badge variant={r.isForfeit ? "destructive" : "outline"} className="h-4 px-1 text-[7px] font-black uppercase mt-2 border-none shadow-sm">
                                                {r.isForfeit ? "FORFEITED" : "CERTIFIED"}
                                            </Badge>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-20 border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                <History className="w-12 h-12" />
                                <p className="text-[10px] font-black uppercase tracking-widest">No redemption history found</p>
                            </div>
                        )}
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
