
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { format, parseISO, subMonths, isAfter, subYears, startOfMonth } from 'date-fns';
import { 
    Award, 
    Calendar, 
    Loader, 
    Clock, 
    Star, 
    Zap, 
    CheckCircle2, 
    ArrowRight, 
    History, 
    Sparkles, 
    Wallet,
    ListChecks,
    Coffee,
    Activity,
    ShieldCheck,
    Trophy,
    TrendingUp,
    HeartHandshake,
    Flame,
    PartyPopper,
    User,
    Repeat,
    Box,
    FileSignature,
    ArrowDown,
    Shield,
    Check
} from 'lucide-react';
import { type Client, type Appointment, type Service, type Membership, type Package, type Tenant, type Redemption, type RefreshmentRequest, type Discount, type Staff } from '@/lib/data';
import { type Transaction } from '@/lib/financial-data';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn, safeNumber } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';

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
    const { toast } = useToast();

    const [entered, setEntered] = useState(false);

    const clientRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}/clients/${clientId}`), [firestore, tenantId, clientId]);
    const { data: client, isLoading: clientLoading } = useDoc<Client>(clientRef);

    const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
    const { data: tenant } = useDoc<Tenant>(tenantRef);

    const appointmentsQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/appointments`), where('clientId', '==', clientId)), [firestore, tenantId, clientId]);
    const { data: appointments, isLoading: appointmentsLoading } = useCollection<Appointment>(appointmentsQuery);

    const redemptionsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/clients/${clientId}/redemptions`), [firestore, tenantId, clientId]);
    const { data: redemptions, isLoading: redemptionsLoading } = useCollection<Redemption>(redemptionsQuery);

    const refreshmentRequestsQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/refreshmentRequests`), where('clientId', '==', clientId)), [firestore, tenantId, clientId]);
    const { data: refreshmentRequests, isLoading: requestsLoading } = useCollection<RefreshmentRequest>(refreshmentRequestsQuery);

    const signedConsentsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`), [firestore, tenantId, clientId]);
    const { data: signedConsents, isLoading: consentsLoading } = useCollection<any>(signedConsentsQuery);

    const servicesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
    const { data: services } = useCollection<Service>(servicesQuery);

    const staffQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
    const { data: staff } = useCollection<Staff>(staffQuery);

    const membershipsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/memberships`), [firestore, tenantId]);
    const { data: memberships } = useCollection<Membership>(membershipsQuery);

    const packagesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/packages`), [firestore, tenantId]);
    const { data: packages } = useCollection<Package>(packagesQuery);

    const discountsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/discounts`), [firestore, tenantId]);
    const { data: discounts } = useCollection<Discount>(discountsQuery);

    const activeMembership = useMemo(() => {
        const mId = client?.activeMembershipId || client?.subscription?.membershipId;
        if (!mId || !memberships) return null;
        return memberships.find(m => m.id === mId);
    }, [client, memberships]);

    const cycleStart = useMemo(() => {
        if (!client?.subscription?.nextBillingDate || !activeMembership) return startOfMonth(new Date());
        const nextBilling = safeDate(client.subscription.nextBillingDate);
        return startOfMonth(activeMembership.interval === 'yearly' ? subYears(nextBilling, 1) : subMonths(nextBilling, 1));
    }, [client, activeMembership]);

    const currentCycleActivity = useMemo(() => {
        const servRedemptions = (redemptions || []).filter(r => isAfter(safeDate(r.date), cycleStart) && !r.isForfeit);
        const hospitalityReqs = (refreshmentRequests || []).filter(r => r.status !== 'cancelled' && isAfter(safeDate(r.requestedAt), cycleStart));
        
        return {
            services: servRedemptions,
            hospitality: hospitalityReqs,
            all: [...servRedemptions, ...hospitalityReqs].sort((a,b) => safeDate(b.date || (b as any).requestedAt).getTime() - safeDate(a.date || (a as any).requestedAt).getTime())
        };
    }, [redemptions, refreshmentRequests, cycleStart]);

    const perkAllotments = useMemo(() => {
        if (!activeMembership) return [];
        const items: any[] = [];

        const getUsage = (id: string) => {
            const servCount = currentCycleActivity.services.filter(r => r.serviceId === id).length;
            const hospCount = currentCycleActivity.hospitality.filter(r => r.itemId === id).reduce((sum, r) => sum + safeNumber(r.quantity), 0);
            return servCount + hospCount;
        };

        (activeMembership.includedServices || []).forEach(perk => {
            const used = getUsage(perk.id);
            items.push({ ...perk, type: 'Service', used, progress: Math.min(100, (used / perk.quantity) * 100), icon: Star, color: 'text-indigo-600', bg: 'bg-indigo-500/10' });
        });

        (activeMembership.includedAddOns || []).forEach(perk => {
            const used = getUsage(perk.id);
            items.push({ ...perk, type: 'Enhancement', used, progress: Math.min(100, (used / perk.quantity) * 100), icon: Zap, color: 'text-amber-600', bg: 'bg-amber-500/10' });
        });

        (activeMembership.includedProducts || []).forEach(perk => {
            const used = getUsage(perk.id);
            items.push({ ...perk, type: 'Hospitality', used, progress: Math.min(100, (used / perk.quantity) * 100), icon: Coffee, color: 'text-primary', bg: 'bg-primary/10' });
        });

        return items;
    }, [activeMembership, currentCycleActivity]);

    const loyaltyHubData = useMemo(() => {
        if (!client || !appointments || !discounts) return null;

        const completedApts = appointments.filter(a => a.status === 'completed');
        const visitCount = completedApts.length;

        const loyaltyProtocol = discounts.find(d => d.automation?.trigger === 'loyalty' && d.isActive);
        const threshold = loyaltyProtocol?.automation?.appointmentThreshold || 10;
        
        const progressToNextReward = (visitCount % threshold) / threshold * 100;
        const visitsToNext = threshold - (visitCount % threshold);

        let cycleSavings = 0;
        if (activeMembership) {
            currentCycleActivity.services.forEach(r => {
                const svc = services?.find(s => s.id === r.serviceId);
                cycleSavings += (svc?.price || 0);
            });
            currentCycleActivity.hospitality.forEach(r => {
                cycleSavings += (safeNumber(r.priceAtRequest) * safeNumber(r.quantity));
            });
        }

        return {
            visitCount,
            visitsToNext,
            progressToNextReward,
            loyaltyProtocol,
            cycleSavings,
            referralCount: client.successfulReferrals?.length || 0,
            referralEarnings: safeNumber(client.walletCredit)
        };
    }, [client, appointments, discounts, activeMembership, currentCycleActivity, services]);

    const upcomingAppointments = useMemo(() => {
        if (!appointments) return [];
        return appointments
            .filter(a => a.status !== 'cancelled' && safeDate(a.startTime) > new Date())
            .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime());
    }, [appointments]);

    const pastAppointments = useMemo(() => {
        if (!appointments) return [];
        return appointments
            .filter(a => safeDate(a.startTime) <= new Date())
            .sort((a, b) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime());
    }, [appointments]);

    if (clientLoading || appointmentsLoading || redemptionsLoading || requestsLoading || consentsLoading) {
        return (
            <div className="flex h-screen w-full flex-col items-center justify-center p-4 bg-background">
                <Loader className="h-10 w-10 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40 mt-4">Initializing Studio Pulse...</p>
            </div>
        );
    }

    if (!client) return <div className="p-10 text-center font-black uppercase text-slate-400">Dossier not found.</div>;

    return (
        <div className="min-h-screen bg-background relative overflow-x-hidden">
            <AnimatePresence>
                {!entered && (
                    <motion.div
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                        className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background overflow-hidden"
                    >
                        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
                            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full animate-pulse" />
                        </div>

                        <motion.div 
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            transition={{ delay: 0.2, duration: 1, ease: [0.16, 1, 0.3, 1] }}
                            className="relative z-10 flex flex-col items-center text-center px-6 w-full"
                        >
                            <div className="relative w-24 h-24 md:w-32 md:h-32 rounded-[2.5rem] md:rounded-[3rem] border-4 border-white shadow-2xl overflow-hidden mb-8 bg-white/50 backdrop-blur-xl">
                                {tenant?.bookingPageSettings?.logoUrl ? (
                                    <Image src={tenant.bookingPageSettings.logoUrl} alt={tenant.name} fill className="object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Sparkles className="w-12 h-12 text-primary" />
                                    </div>
                                )}
                            </div>
                            
                            <div className="space-y-4 max-w-sm mx-auto">
                                <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                                    Welcome, {client.name.split(' ')[0]}
                                </h1>
                                <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest opacity-60 mt-4">Verified Client Dashboard</p>
                            </div>

                            <motion.button 
                                onClick={() => setEntered(true)}
                                className="mt-16 group flex flex-col items-center gap-4 transition-all active:scale-95 text-muted-foreground"
                            >
                                <span className="text-[11px] md:text-sm font-black uppercase tracking-[0.4em] opacity-40 group-hover:opacity-100 transition-opacity">Access Dashboard</span>
                                <ArrowDown className="w-6 h-6 md:w-8 md:h-8 animate-bounce opacity-40 group-hover:opacity-100" />
                            </motion.button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <main className={cn(
                "relative transition-all duration-1000 p-4 md:p-8 max-w-6xl mx-auto space-y-10",
                !entered ? "opacity-0 translate-y-10" : "opacity-100 translate-y-0"
            )}>
                <header className="flex flex-col md:flex-row items-center gap-8 text-center md:text-left pt-10">
                    <div className="relative group">
                        <Avatar className="w-24 h-24 md:w-32 md:h-32 border-4 border-white shadow-2xl rounded-[3rem] overflow-hidden transition-all group-hover:scale-105">
                            <AvatarImage src={client.avatarUrl} className="object-cover" />
                            <AvatarFallback className="font-black text-2xl bg-primary/10 text-primary">{(client.name || 'G').substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        {activeMembership && (
                            <div className="absolute -top-3 -right-3 bg-indigo-600 text-white p-2 rounded-2xl shadow-xl border-4 border-white">
                                <Award className="w-6 h-6" />
                            </div>
                        )}
                    </div>
                    <div className="space-y-2 flex-1 min-w-0 text-left">
                        <div className="flex items-center justify-center md:justify-start gap-3">
                            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none truncate w-full md:w-auto">Client Dossier</h1>
                        </div>
                        <p className="text-xs md:sm font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-center md:text-left">{tenant?.name} &middot; Authenticated Guest</p>
                    </div>
                    <div className="shrink-0 flex gap-3 w-full md:w-auto">
                        <Button asChild variant="outline" className="flex-1 md:flex-none h-14 px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest border-border/50 bg-white/50 backdrop-blur-sm">
                            <Link href={`/book/${tenantId}`}>
                                Back to Menu
                            </Link>
                        </Button>
                        <Button asChild size="lg" className="flex-[2] md:flex-none h-14 px-8 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 group">
                            <Link href={`/book/${tenantId}`}>
                                Secure Session <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                            </Link>
                        </Button>
                    </div>
                </header>

                <Tabs defaultValue="appointments" className="w-full">
                    <ScrollArea className="w-full">
                        <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-10 w-max mx-auto">
                            <TabsTrigger value="appointments" className="px-8 h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">
                                <Clock className="w-3.5 h-3.5 mr-2" />
                                Schedule
                            </TabsTrigger>
                            <TabsTrigger value="portfolio" className="px-8 h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">
                                <Award className="w-3.5 h-3.5 mr-2" />
                                Membership
                            </TabsTrigger>
                            <TabsTrigger value="rewards" className="px-8 h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">
                                <Trophy className="w-3.5 h-3.5 mr-2" />
                                Rewards
                            </TabsTrigger>
                        </TabsList>
                        <ScrollBar orientation="horizontal" className="hidden" />
                    </ScrollArea>

                    <TabsContent value="appointments" className="space-y-12 animate-in fade-in duration-500 text-left">
                        <div className="space-y-6 text-left">
                            <div className="flex items-center gap-3 px-1 text-left">
                                <Calendar className="w-5 h-5 text-primary" />
                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Agenda Matrix</h3>
                            </div>
                            {upcomingAppointments.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                    {upcomingAppointments.map(apt => {
                                        const svc = services?.find(s => s.id === apt.serviceId);
                                        const pro = staff?.find(s => s.id === apt.staffId);
                                        return (
                                            <Card key={apt.id} className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm hover:border-primary/20 transition-all group">
                                                <CardContent className="p-6 flex items-center gap-6">
                                                    <div className="p-4 bg-primary/5 rounded-2xl border-2 border-primary/10 shadow-inner text-primary shrink-0 group-hover:bg-primary group-hover:text-white transition-all duration-500">
                                                        <Calendar className="w-8 h-8" />
                                                    </div>
                                                    <div className="min-w-0 text-left flex-1">
                                                        <p className="font-black text-lg uppercase tracking-tight text-slate-900 truncate mb-1">{svc?.name || 'Service'}</p>
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <Badge variant="outline" className="h-5 px-2 border-none bg-muted/50 text-muted-foreground text-[8px] font-black uppercase">By {pro?.name.split(' ')[0] || 'Technician'}</Badge>
                                                        </div>
                                                        <p className="text-xl font-black text-primary font-mono tracking-tighter">{format(safeDate(apt.startTime), 'EEEE, MMM d @ h:mm a')}</p>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="py-24 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                    <Clock className="w-16 h-16" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-center px-8">No Upcoming Appointments</p>
                                </div>
                            )}
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-6 text-left">
                            <div className="flex items-center gap-3 px-1 text-left">
                                <History className="w-5 h-5 text-muted-foreground opacity-40" />
                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Technical History Archive</h3>
                            </div>
                            <div className="grid gap-4">
                                {pastAppointments.slice(0, 10).map(apt => {
                                    const svc = services?.find(s => s.id === apt.serviceId);
                                    const pro = staff?.find(s => s.id === apt.staffId);
                                    return (
                                        <Card key={apt.id} className="border-2 rounded-[1.5rem] bg-white hover:bg-muted/5 transition-all text-left overflow-hidden">
                                            <CardContent className="p-5 flex items-center justify-between gap-6">
                                                <div className="flex items-center gap-4 min-w-0 text-left">
                                                    <div className="p-2.5 bg-muted/30 rounded-xl shrink-0"><CheckCircle2 className="w-5 h-5 text-slate-400" /></div>
                                                    <div className="min-w-0 text-left">
                                                        <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate leading-none mb-1">{svc?.name}</p>
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Verified with {pro?.name || 'Staff'}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="text-[10px] font-black font-mono text-slate-600">{format(safeDate(apt.startTime), 'MMM d, yyyy')}</p>
                                                    <Badge variant="outline" className="h-4 px-1.5 rounded-md border-none bg-muted/20 text-[7px] font-black uppercase mt-1">{apt.status}</Badge>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                                {pastAppointments.length === 0 && (
                                    <div className="py-16 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                        <History className="w-12 h-12" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">Archive Empty</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-6 text-left">
                            <div className="flex items-center gap-3 px-1 text-left">
                                <FileSignature className="w-5 h-5 text-primary opacity-40" />
                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Agreement Vault</h3>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {signedConsents && signedConsents.length > 0 ? (
                                    signedConsents.map(consent => (
                                        <Card key={consent.id} className="border-2 rounded-[1.5rem] bg-white shadow-sm hover:border-primary/20 transition-all text-left overflow-hidden">
                                            <CardContent className="p-5 flex items-center gap-4">
                                                <div className="p-3 bg-primary/5 rounded-xl border border-primary/10 text-primary shrink-0"><ShieldCheck className="w-5 h-5" /></div>
                                                <div className="min-w-0 text-left">
                                                    <p className="font-black text-xs uppercase tracking-tight text-slate-900 truncate mb-0.5">{consent.formTitle}</p>
                                                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Established {format(safeDate(consent.signedAt), 'MMM d, yyyy')}</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))
                                ) : (
                                    <div className="col-span-full py-16 text-center border-4 border-dashed rounded-[2rem] opacity-30">
                                        <p className="text-[10px] font-black uppercase tracking-widest">No Signed Agreements Found</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="portfolio" className="space-y-12 animate-in fade-in duration-500 text-left">
                        {activeMembership ? (
                            <div className="space-y-12">
                                <section className="space-y-6 text-left">
                                    <div className="flex flex-col sm:flex-row items-center justify-between px-1 gap-4">
                                        <div className="flex items-center gap-3 w-full sm:w-auto text-left">
                                            <ShieldCheck className="w-5 h-5 text-indigo-600" />
                                            <div className="text-left">
                                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 leading-tight">Active Allotment Matrix</h3>
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
                                                    Current Cycle: {format(cycleStart, 'MMM d')} - {client?.subscription?.nextBillingDate ? format(safeDate(client.subscription.nextBillingDate), 'MMM d, yyyy') : '...'}
                                                </p>
                                            </div>
                                        </div>
                                        {loyaltyHubData && (
                                            <div className="w-full sm:w-auto flex items-center gap-2 px-4 py-2 rounded-2xl bg-green-500/5 border-2 border-green-500/10">
                                                <TrendingUp className="w-3.5 h-3.5 text-green-600" />
                                                <span className="text-[10px] font-black uppercase text-green-700">Cycle Value Secured: ${loyaltyHubData.cycleSavings.toFixed(0)}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {perkAllotments.map(perk => {
                                            const used = safeNumber(perk.used);
                                            const total = safeNumber(perk.quantity);
                                            const remaining = Math.max(0, total - used);
                                            const isExhausted = used >= total;
                                            return (
                                                <Card key={perk.id} className={cn("border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm hover:border-primary/20 transition-all", isExhausted && "opacity-60")}>
                                                    <CardContent className="p-6 space-y-5 text-left">
                                                        <div className="flex justify-between items-start gap-4">
                                                            <div className="space-y-1 flex-1 min-w-0 text-left">
                                                                <p className="font-black text-base uppercase tracking-tight text-slate-900 truncate leading-tight">{perk.name}</p>
                                                                <p className={cn("text-[9px] font-black uppercase tracking-widest", perk.color)}>{perk.type} Allotment</p>
                                                            </div>
                                                            <div className={cn("p-3 rounded-2xl shadow-inner shrink-0", isExhausted ? "bg-green-500/10 text-green-600" : perk.bg + " " + perk.color)}>
                                                                {isExhausted ? <CheckCircle2 className="w-6 h-6" /> : <perk.icon className="w-6 h-6" />}
                                                            </div>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                                                                <span>Allotment State</span>
                                                                <div className="flex items-center gap-1.5">
                                                                    <span>Used {used} / {total}</span>
                                                                    <Badge variant="outline" className={cn("h-4 border-none font-black", isExhausted ? "text-muted-foreground" : "text-primary")}>({remaining} REMAINING)</Badge>
                                                                </div>
                                                            </div>
                                                            <Progress value={perk.progress} className={cn("h-2 rounded-full bg-muted shadow-inner", isExhausted && "[&>div]:bg-green-500")} />
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            )
                                        })}
                                    </div>
                                </section>

                                <Separator className="border-dashed" />

                                <section className="space-y-6 text-left">
                                    <div className="flex items-center gap-3 px-1 text-left">
                                        <Activity className="w-5 h-5 text-primary" />
                                        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Current Cycle Redemptions</h3>
                                    </div>
                                    {currentCycleActivity.all.length > 0 ? (
                                        <div className="grid gap-3">
                                            {currentCycleActivity.all.map((item: any) => {
                                                const isRefreshment = !!item.itemName;
                                                const date = safeDate(item.date || item.requestedAt);
                                                const id = item.id;
                                                return (
                                                    <div key={id} className="flex items-center justify-between p-5 rounded-[1.5rem] border-2 bg-white shadow-sm hover:border-primary/20 transition-all text-left">
                                                        <div className="flex items-center gap-4 text-left min-w-0 flex-1">
                                                            <div className={cn("p-3 rounded-2xl shadow-inner shrink-0", isRefreshment ? "bg-primary/10 text-primary" : "bg-indigo-500/10 text-indigo-600")}>
                                                                {isRefreshment ? <Coffee className="w-5 h-5" /> : <Star className="w-5 h-5" />}
                                                            </div>
                                                            <div className="min-w-0 text-left">
                                                                <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate leading-none mb-1">{isRefreshment ? item.itemName : item.serviceName}</p>
                                                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">Drawn from Membership Portfolio</p>
                                                            </div>
                                                        </div>
                                                        <div className="text-right shrink-0 ml-4">
                                                            <p className="font-black font-mono text-[11px] text-slate-900 leading-none">{format(date, 'MMM d, p')}</p>
                                                            <Badge variant="outline" className="h-4 px-1 text-[7px] font-black uppercase mt-2 border-none bg-muted/50 text-muted-foreground shadow-sm">VERIFIED</Badge>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                            <History className="w-12 h-12" />
                                            <p className="text-[10px] font-black uppercase tracking-widest text-center px-8">No Activity Logged in Current Cycle</p>
                                        </div>
                                    )}
                                </section>
                            </div>
                        ) : (
                            <div className="py-24 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                <Award className="w-16 h-16" />
                                <div className="space-y-2 text-center">
                                    <p className="text-xl font-black uppercase tracking-tighter text-slate-900">Portfolio Inactive</p>
                                    <p className="text-xs font-bold uppercase tracking-widest max-w-xs mx-auto">Explore our membership tiers to unlock recurring studio benefits.</p>
                                </div>
                                <Button asChild className="h-12 px-8 rounded-xl font-black uppercase text-[10px] tracking-widest mt-4">
                                    <Link href={`/book/${tenantId}#memberships`}>Explore Tiers</Link>
                                </Button>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="rewards" className="space-y-10 animate-in fade-in duration-500 text-left">
                        {loyaltyHubData ? (
                            <div className="space-y-10">
                                <div className="grid grid-cols-1 gap-6">
                                    <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
                                        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><Flame className="w-32 h-32 text-primary" /></div>
                                        <CardHeader className="p-8 pb-2 text-left">
                                            <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> Next Reward Protocol</CardTitle>
                                        </CardHeader>
                                        <CardContent className="p-8 pt-4 space-y-6 text-left">
                                            <div className="text-left">
                                                <p className="text-4xl md:text-6xl font-black text-primary tracking-tighter leading-none">{loyaltyHubData.visitsToNext}</p>
                                                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">Sessions remaining until next reward</p>
                                            </div>
                                            <div className="space-y-2">
                                                <Progress value={loyaltyHubData.progressToNextReward} className="h-2 rounded-full bg-white/40" />
                                                <div className="flex justify-between text-[8px] font-black uppercase tracking-widest text-primary/60">
                                                    <span>Active Progress</span>
                                                    <span>{Math.round(loyaltyHubData.progressToNextReward)}% Path</span>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>

                                <Card className="border-2 rounded-[2.5rem] overflow-hidden bg-white shadow-sm">
                                    <CardHeader className="p-8 pb-4 border-b bg-muted/5 flex flex-col md:flex-row md:items-center justify-between gap-6 text-left">
                                        <div className="space-y-1 text-left">
                                            <CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-3"><HeartHandshake className="w-5 h-5 text-primary" /> Advocacy Impact</CardTitle>
                                            <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Revenue earned through guest referrals.</CardDescription>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] font-black uppercase text-primary/60 tracking-widest mb-1">Total Credit Earned</p>
                                            <p className="text-3xl font-black font-mono tracking-tighter text-primary leading-none">${loyaltyHubData.referralEarnings.toFixed(2)}</p>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="p-8 space-y-8 text-left">
                                        {client.successfulReferrals && client.successfulReferrals.length > 0 ? (
                                            <div className="space-y-4 text-left">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Converted Referrals</p>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                                    {client.successfulReferrals.map((name, idx) => (
                                                        <div key={idx} className="flex items-center gap-3 p-3 rounded-xl border-2 bg-muted/5">
                                                            <div className="p-2 bg-white rounded-lg shadow-sm"><User className="w-3.5 h-3.5 text-primary opacity-40" /></div>
                                                            <span className="text-[10px] font-black uppercase text-slate-700 truncate">{name}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="py-12 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3">
                                                <PartyPopper className="w-10 h-10" />
                                                <p className="text-[10px] font-black uppercase tracking-widest">No Referrals Registered</p>
                                            </div>
                                        )}
                                        
                                        <div className="p-6 rounded-3xl border-2 border-dashed border-primary/20 bg-primary/[0.02] flex flex-col sm:flex-row items-center justify-between gap-6 text-left">
                                            <div className="space-y-1 text-center sm:text-left">
                                                <p className="text-sm font-black uppercase tracking-tight text-slate-900">Expand the Circle</p>
                                                <p className="text-[10px] font-medium text-slate-500 leading-relaxed uppercase tracking-tight">Share your private referral code to earn instant studio credit upon their first visit.</p>
                                            </div>
                                            <div className="flex gap-2 w-full sm:w-auto">
                                                <div className="flex-1 p-3 px-5 rounded-xl bg-white border-2 border-primary/10 shadow-inner font-black font-mono text-primary uppercase text-sm tracking-widest text-center">{client.referralCode}</div>
                                                <Button variant="outline" size="icon" className="h-12 w-12 rounded-xl border-2 bg-white" onClick={() => { navigator.clipboard.writeText(client.referralCode || ''); toast({ title: 'Code Copied' }); }}><Repeat className="w-5 h-5 opacity-40" /></Button>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        ) : (
                            <div className="py-24 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                <Trophy className="w-16 h-16" />
                                <p className="text-[10px] font-black uppercase tracking-widest text-center">Reward profile loading...</p>
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </main>
        </div>
    );
}

