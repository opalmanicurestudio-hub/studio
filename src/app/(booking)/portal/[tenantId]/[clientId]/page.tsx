
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, writeBatch, increment, arrayUnion, deleteField } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { format, parseISO, subMonths, isAfter, subYears, startOfMonth, differenceInHours } from 'date-fns';
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
    FileSignature, 
    ArrowDown, 
    Shield, 
    Check, 
    AlertTriangle, 
    XCircle, 
    Undo2, 
    CalendarCheck, 
    Lock, 
    CreditCard, 
    Ban, 
    ShieldAlert, 
    MessageSquare, 
    Heart
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
import { 
    AlertDialog, 
    AlertDialogAction, 
    AlertDialogCancel, 
    AlertDialogContent, 
    AlertDialogDescription, 
    AlertDialogFooter, 
    AlertDialogHeader, 
    AlertDialogTitle 
} from "@/components/ui/alert-dialog";
import { 
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle, 
    DialogDescription, 
    DialogFooter 
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RescheduleDialog } from '@/components/planner/RescheduleDialog';
import { nanoid } from 'nanoid';

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

const ViewContainer = ({ children }: { children: React.ReactNode }) => (
    <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="w-full max-w-4xl mx-auto px-2 sm:px-0"
    >
        {children}
    </motion.div>
);

export default function ClientPortalPage() {
    const { tenantId, clientId } = useParams() as { tenantId: string; clientId: string };
    const { firestore, user: firebaseUser } = useFirebase();
    const { toast } = useToast();

    const [entered, setEntered] = useState(false);
    const [appointmentToCancel, setAppointmentToCancel] = useState<Appointment | null>(null);
    const [appointmentToReschedule, setAppointmentToReschedule] = useState<Appointment | null>(null);
    const [isSettlementOpen, setIsSettlementOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [settlementSuccess, setSettlementSuccess] = useState(false);

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
            items.push({ ...perk, id: perk.id, type: 'Service', used, progress: Math.min(100, (used / perk.quantity) * 100), icon: Star, color: 'text-indigo-600', bg: 'bg-indigo-500/10' });
        });

        (activeMembership.includedAddOns || []).forEach(perk => {
            const used = getUsage(perk.id);
            items.push({ ...perk, id: perk.id, type: 'Enhancement', used, progress: Math.min(100, (used / perk.quantity) * 100), icon: Zap, color: 'text-amber-600', bg: 'bg-amber-500/10' });
        });

        (activeMembership.includedProducts || []).forEach(perk => {
            const used = getUsage(perk.id);
            items.push({ ...perk, id: perk.id, type: 'Hospitality', used, progress: Math.min(100, (used / perk.quantity) * 100), icon: Coffee, color: 'text-primary', bg: 'bg-primary/10' });
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
            .filter(a => (a.status === 'confirmed' || a.status === 'deposit_pending' || a.status === 'ready_for_checkout' || a.status === 'servicing') && safeDate(a.startTime) > new Date())
            .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime());
    }, [appointments]);

    const pastAppointments = useMemo(() => {
        if (!appointments) return [];
        return appointments
            .filter(a => a.status === 'completed' || safeDate(a.startTime) <= new Date())
            .sort((a, b) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime());
    }, [appointments]);

    const handleConfirmCancellation = async () => {
        if (!appointmentToCancel || !firestore || !tenantId || !client) return;
        setIsProcessing(true);
        
        const batch = writeBatch(firestore);
        const appointmentRef = doc(firestore, `tenants/${tenantId}/appointments`, appointmentToCancel.id);
        const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);

        const hoursUntil = differenceInHours(safeDate(appointmentToCancel.startTime), new Date());
        const svc = services?.find(s => s.id === appointmentToCancel.serviceId);
        const requiredWindow = svc?.cancellationWindowHours || tenant?.cancellationWindowHours || 24;
        const isLate = hoursUntil < requiredWindow;

        let feeAmount = 0;
        if (isLate) {
            const duration = svc?.duration || 60;
            const tmhr = tenant?.tmhr || 50;
            const overhead = (duration / 60) * tmhr;
            feeAmount = Number(overhead.toFixed(2));
        }

        batch.update(appointmentRef, { 
            status: 'cancelled', 
            cancellationReason: 'client_request',
            cancellationFeeApplied: feeAmount,
            cancellationPaymentStatus: feeAmount > 0 ? 'unpaid' : 'waived'
        });

        if (feeAmount > 0) {
            batch.update(clientRef, {
                outstandingBalance: increment(feeAmount),
                unpaidFees: arrayUnion({
                    feeId: nanoid(),
                    appointmentId: appointmentToCancel.id,
                    appointmentDate: safeDate(appointmentToCancel.startTime).toISOString(),
                    feeAmount: feeAmount,
                    reason: `Late Cancellation: Guest Request (< ${requiredWindow}h notice)`
                })
            });
        }

        try {
            await batch.commit();
            toast({ title: "Session Terminated", description: feeAmount > 0 ? `Late cancellation fee of $${feeAmount.toFixed(2)} applied.` : "Appointment removed." });
            setAppointmentToCancel(null);
        } catch (e) {
            toast({ variant: 'destructive', title: "Process Error" });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRescheduleConfirm = async (data: any) => {
        if (!firestore || !tenantId) return;
        setIsProcessing(true);
        
        const { applyFee, feeAmount, ...aptData } = data;
        const batch = writeBatch(firestore);
        const appointmentRef = doc(firestore, `tenants/${tenantId}/appointments`, aptData.id);
        
        batch.update(appointmentRef, {
            startTime: aptData.startTime,
            endTime: aptData.endTime
        });

        if (applyFee && feeAmount > 0) {
            const clientRef = doc(firestore, `tenants/${tenantId}/clients`, clientId);
            batch.update(clientRef, {
                outstandingBalance: increment(feeAmount),
                unpaidFees: arrayUnion({
                    feeId: nanoid(),
                    appointmentId: aptData.id,
                    appointmentDate: safeDate(aptData.startTime).toISOString(),
                    feeAmount: feeAmount,
                    reason: "Late Reschedule Protocol Fee"
                })
            });
        }

        try {
            await batch.commit();
            toast({ title: "Session Shifted", description: applyFee ? "Late adjustment fee applied to ledger." : "Agenda updated." });
            setAppointmentToReschedule(null);
        } catch (e) {
            toast({ variant: 'destructive', title: "Process Error" });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSettleArrears = async () => {
        if (!client || !firestore || !tenantId) return;
        setIsProcessing(true);
        
        const batch = writeBatch(firestore);
        const amount = safeNumber(client.outstandingBalance);
        const now = new Date().toISOString();

        const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
        batch.set(txnRef, {
            id: txnRef.id,
            date: now,
            description: "Self-Service Arrears Settlement",
            clientOrVendor: client.name,
            clientId: client.id,
            type: 'income',
            context: 'Business',
            category: 'Fee Recovery',
            amount: amount,
            paymentMethod: client.cardOnFile?.token ? 'Card on File' : 'Digital Gateway',
            hasReceipt: false,
            tenantId
        });

        const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
        batch.update(clientRef, {
            outstandingBalance: 0,
            unpaidFees: [],
            lifetimeValue: increment(amount)
        });

        try {
            await batch.commit();
            setSettlementSuccess(true);
            toast({ title: "Balance Reconciled", description: "Your studio account is now clear." });
        } catch (e) {
            console.error(e);
            toast({ variant: 'destructive', title: "Settlement Failed" });
        } finally {
            setIsProcessing(false);
        }
    };

    const safeBalance = useMemo(() => safeNumber(client?.outstandingBalance), [client]);

    if (clientLoading || appointmentsLoading || redemptionsLoading || requestsLoading || consentsLoading) {
        return (
            <div className="flex h-screen w-full flex-col items-center justify-center p-4 bg-background">
                <Loader className="h-10 w-10 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40 mt-4">Initializing Studio Pulse...</p>
            </div>
        );
    }

    if (!client) return <div className="p-10 text-center font-black uppercase text-slate-400">Dossier not found.</div>;

    if (client.status === 'banned') {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 font-body">
                <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                    <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-destructive/5 blur-[120px] rounded-full" />
                </div>
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative z-10 w-full max-w-md">
                    <Card className="border-4 rounded-[3rem] shadow-3xl overflow-hidden bg-white/90 backdrop-blur-xl text-center">
                        <CardHeader className="p-8 pb-4 border-b bg-muted/5 text-left">
                            <div className="flex items-center gap-3 mb-2">
                                <ShieldAlert className="w-5 h-5 text-destructive" />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-destructive">Security Restriction</span>
                            </div>
                            <CardTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">Authentication Denied</CardTitle>
                        </CardHeader>
                        <CardContent className="p-10 space-y-8">
                            <div className="w-24 h-24 bg-destructive/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-destructive/5">
                                <Ban className="w-12 h-12 text-destructive" />
                            </div>
                            <div className="space-y-3">
                                <p className="text-sm font-medium text-slate-600 leading-relaxed uppercase tracking-tight text-center">
                                    Your guest profile has been restricted in the studio manifest. Access to the private portal is currently prohibited.
                                </p>
                            </div>
                        </CardContent>
                        <CardFooter className="p-8 pt-0">
                            <Button asChild variant="ghost" className="w-full h-12 font-black uppercase tracking-widest text-[10px] text-slate-400">
                                <Link href={`/book/${tenantId}`}>Return to Studio Home</Link>
                            </Button>
                        </CardFooter>
                    </Card>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background relative overflow-x-hidden">
            <AnimatePresence mode="wait">
                {!entered ? (
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
                                className="mt-16 group flex flex-col items-center gap-4 transition-all active:scale-95 text-slate-400"
                            >
                                <span className="text-[11px] md:text-sm font-black uppercase tracking-[0.4em] opacity-60 group-hover:opacity-100 transition-opacity">Access Dashboard</span>
                                <ArrowDown className="w-6 h-6 md:w-8 md:h-8 animate-bounce opacity-60 group-hover:opacity-100" />
                            </motion.button>
                        </motion.div>
                    </motion.div>
                ) : null}
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
                        <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none truncate w-full md:w-auto text-center md:text-left">Client Dossier</h1>
                        <p className="text-xs md:sm font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-center md:text-left">{tenant?.name} &middot; Authenticated Guest</p>
                    </div>
                    <div className="shrink-0 flex gap-3 w-full md:w-auto">
                        <Button asChild variant="outline" className="flex-1 md:flex-none h-14 px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest border-border/50 bg-white/50 backdrop-blur-sm">
                            <Link href={`/book/${tenantId}`}>Back to Menu</Link>
                        </Button>
                        <Button asChild size="lg" className="flex-[2] md:flex-none h-14 px-8 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 group">
                            <Link href={`/book/${tenantId}`}>Secure Session <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" /></Link>
                        </Button>
                    </div>
                </header>

                <AnimatePresence>
                    {safeBalance > 0 && (
                        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}>
                            <Alert variant="destructive" className="border-4 border-destructive/20 bg-destructive/[0.02] rounded-[2.5rem] p-8 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8 text-left">
                                <div className="flex items-start gap-6 text-left">
                                    <div className="p-4 bg-destructive text-white rounded-2xl shadow-xl shadow-destructive/20 shrink-0 mt-1">
                                        <Wallet className="w-8 h-8" />
                                    </div>
                                    <div className="space-y-1">
                                        <AlertTitle className="text-2xl font-black uppercase tracking-tighter text-destructive leading-none text-left">Accounting Balance</AlertTitle>
                                        <AlertDescription className="text-sm font-bold text-slate-600 uppercase tracking-tight opacity-80 mt-2 text-left">
                                            A total of <strong>${safeBalance.toFixed(2)}</strong> in outstanding fees is recorded. Reconcile now to maintain active status.
                                        </AlertDescription>
                                        <div className="pt-4 text-left">
                                            <Button variant="outline" onClick={() => setIsSettlementOpen(true)} className="h-10 rounded-xl border-destructive/30 bg-white text-destructive font-black uppercase text-[10px] tracking-widest hover:bg-destructive hover:text-white transition-all shadow-sm"><Zap className="w-3.5 h-3.5 mr-2" />Settle Balance Now</Button>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-[10px] font-black uppercase text-destructive tracking-[0.2em] mb-1 text-right">Total Arrears</p>
                                    <p className="text-5xl font-black font-mono tracking-tighter text-destructive">${safeBalance.toFixed(2)}</p>
                                </div>
                            </Alert>
                        </motion.div>
                    )}
                </AnimatePresence>

                <Tabs defaultValue="appointments" className="w-full">
                    <ScrollArea className="w-full">
                        <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-10 w-max mx-auto">
                            <TabsTrigger value="appointments" className="px-8 h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">
                                <Clock className="w-3.5 h-3.5 mr-2" /> Schedule
                            </TabsTrigger>
                            <TabsTrigger value="portfolio" className="px-8 h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">
                                <Award className="w-3.5 h-3.5 mr-2" /> Membership
                            </TabsTrigger>
                            <TabsTrigger value="rewards" className="px-8 h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">
                                <Trophy className="w-3.5 h-3.5 mr-2" /> Rewards
                            </TabsTrigger>
                            <TabsTrigger value="ledger" className="px-8 h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">
                                <Landmark className="w-3.5 h-3.5 mr-2" /> Ledger
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
                                        const isActionable = apt.status === 'confirmed' || apt.status === 'deposit_pending';
                                        return (
                                            <Card key={apt.id} className="border-2 rounded-[2.5rem] overflow-hidden bg-white shadow-sm hover:border-primary/20 transition-all group flex flex-col">
                                                <CardContent className="p-6 flex items-center gap-6 flex-1">
                                                    <div className="p-4 bg-primary/5 rounded-2xl border-2 border-primary/10 shadow-inner text-primary shrink-0 group-hover:bg-primary group-hover:text-white transition-all duration-500"><Calendar className="w-8 h-8" /></div>
                                                    <div className="min-w-0 text-left flex-1">
                                                        <p className="font-black text-lg uppercase tracking-tight text-slate-900 truncate mb-1">{svc?.name || 'Service'}</p>
                                                        <div className="flex items-center gap-2 mb-2 text-left">
                                                            <Badge variant="outline" className="h-5 px-2 border-none bg-muted/50 text-muted-foreground text-[8px] font-black uppercase">By {pro?.name.split(' ')[0] || 'Technician'}</Badge>
                                                            <Badge className={cn("h-5 px-2 border-none font-black text-[8px] uppercase", apt.status === 'confirmed' ? "bg-green-500 text-white" : "bg-amber-500 text-white")}>{apt.status.replace('_', ' ')}</Badge>
                                                        </div>
                                                        <p className="text-xl font-black text-primary font-mono tracking-tighter">{format(safeDate(apt.startTime), 'EEEE, MMM d @ h:mm a')}</p>
                                                    </div>
                                                </CardContent>
                                                {isActionable && (
                                                    <div className="p-3 border-t bg-muted/5 grid grid-cols-2 gap-2">
                                                        <Button variant="ghost" onClick={() => setAppointmentToReschedule(apt)} className="h-10 rounded-xl font-black uppercase text-[9px] tracking-widest hover:bg-primary/5 text-primary"><Undo2 className="w-3.5 h-3.5 mr-2" /> Reschedule</Button>
                                                        <Button variant="ghost" onClick={() => setAppointmentToCancel(apt)} className="h-10 rounded-xl font-black uppercase text-[9px] tracking-widest hover:bg-destructive/5 text-destructive"><XCircle className="w-3.5 h-3.5 mr-2" /> Cancel</Button>
                                                    </div>
                                                )}
                                            </Card>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="py-24 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4"><Clock className="w-16 h-16" /><p className="text-[10px] font-black uppercase tracking-widest text-center px-8">No Upcoming Appointments</p></div>
                            )}
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-6 text-left">
                            <div className="flex items-center gap-3 px-1 text-left"><History className="w-5 h-5 text-muted-foreground opacity-40" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Technical History Archive</h3></div>
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
                            </div>
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-6 text-left">
                            <div className="flex items-center gap-3 px-1 text-left"><FileSignature className="w-5 h-5 text-primary opacity-40" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Agreement Vault</h3></div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {signedConsents?.length ? signedConsents.map((consent: any) => (
                                    <Card key={consent.id} className="border-2 rounded-[1.5rem] bg-white shadow-sm hover:border-primary/20 transition-all text-left overflow-hidden">
                                        <CardContent className="p-5 flex items-center gap-4">
                                            <div className="p-3 bg-primary/5 rounded-xl border border-primary/10 text-primary shrink-0"><ShieldCheck className="w-5 h-5" /></div>
                                            <div className="min-w-0 text-left">
                                                <p className="font-black text-xs uppercase tracking-tight text-slate-900 truncate mb-0.5">{consent.formTitle}</p>
                                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Established {format(safeDate(consent.signedAt), 'MMM d, yyyy')}</p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )) : <div className="col-span-full py-16 text-center border-4 border-dashed rounded-[2rem] opacity-30"><p className="text-[10px] font-black uppercase tracking-widest">No Signed Agreements Found</p></div>}
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
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Cycle: {format(cycleStart, 'MMM d')} - {client?.subscription?.nextBillingDate ? format(safeDate(client.subscription.nextBillingDate), 'MMM d, yyyy') : '...'}</p>
                                            </div>
                                        </div>
                                        {loyaltyHubData && (<div className="w-full sm:w-auto flex items-center gap-2 px-4 py-2 rounded-2xl bg-green-500/5 border-2 border-green-500/10"><TrendingUp className="w-3.5 h-3.5 text-green-600" /><span className="text-[10px] font-black uppercase text-green-700">Value Secured: ${loyaltyHubData.cycleSavings.toFixed(0)}</span></div>)}
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
                                                        <div className="flex justify-between items-start gap-4 text-left">
                                                            <div className="space-y-1 flex-1 min-w-0 text-left">
                                                                <p className="font-black text-base uppercase tracking-tight text-slate-900 truncate leading-none mb-1 text-left">{perk.name}</p>
                                                                <p className={cn("text-[9px] font-black uppercase tracking-widest text-left", perk.color)}>{perk.type} Allotment</p>
                                                            </div>
                                                            <div className={cn("p-3 rounded-2xl shadow-inner shrink-0", isExhausted ? "bg-green-500/10 text-green-600" : perk.bg + " " + perk.color)}>{isExhausted ? <CheckCircle2 className="w-6 h-6" /> : <perk.icon className="w-6 h-6" />}</div>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1"><span>Allotment State</span><div className="flex items-center gap-1.5"><span>Used {used} / {total}</span><Badge variant="outline" className={cn("h-4 border-none font-black", isExhausted ? "text-muted-foreground" : "text-primary")}>({remaining} LEFT)</Badge></div></div>
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
                                    <div className="flex items-center gap-3 px-1 text-left"><Activity className="w-5 h-5 text-primary" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Current Cycle Redemptions</h3></div>
                                    {currentCycleActivity.all.length > 0 ? (
                                        <div className="grid gap-3">
                                            {currentCycleActivity.all.map((item: any) => {
                                                const isRefreshment = !!item.itemName;
                                                const date = safeDate(item.date || item.requestedAt);
                                                return (
                                                    <div key={item.id} className="flex items-center justify-between p-5 rounded-[1.5rem] border-2 bg-white shadow-sm hover:border-primary/20 transition-all text-left">
                                                        <div className="flex items-center gap-4 text-left min-w-0 flex-1">
                                                            <div className={cn("p-3 rounded-2xl shadow-inner shrink-0", isRefreshment ? "bg-primary/10 text-primary" : "bg-indigo-500/10 text-indigo-600")}>{isRefreshment ? <Coffee className="w-5 h-5" /> : <Star className="w-5 h-5" />}</div>
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
                                    ) : (<div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4"><History className="w-12 h-12" /><p className="text-[10px] font-black uppercase tracking-widest text-center px-8">No Activity Logged in Current Cycle</p></div>)}
                                </section>
                            </div>
                        ) : (<div className="py-24 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4"><Award className="w-16 h-16" /><p className="text-xl font-black uppercase tracking-tighter text-slate-900">Portfolio Inactive</p><Button asChild className="h-12 px-8 rounded-xl font-black uppercase text-[10px] tracking-widest mt-4"><Link href={`/book/${tenantId}#memberships`}>Explore Tiers</Link></Button></div>)}
                    </TabsContent>

                    <TabsContent value="rewards" className="space-y-10 animate-in fade-in duration-500 text-left">
                        {loyaltyHubData ? (
                            <div className="space-y-10">
                                <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
                                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><Flame className="w-32 h-32 text-primary" /></div>
                                    <CardHeader className="p-8 pb-2 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> Next Reward Protocol</CardTitle></CardHeader>
                                    <CardContent className="p-8 pt-4 space-y-6 text-left">
                                        <div className="text-left">
                                            <p className="text-4xl md:text-6xl font-black text-primary tracking-tighter leading-none">{loyaltyHubData.visitsToNext}</p>
                                            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">Sessions remaining until next reward</p>
                                        </div>
                                        <div className="space-y-2">
                                            <Progress value={loyaltyHubData.progressToNextReward} className="h-2 rounded-full bg-white/40" />
                                            <div className="flex justify-between text-[8px] font-black uppercase tracking-widest text-primary/60"><span>Active Progress</span><span>{Math.round(loyaltyHubData.progressToNextReward)}% Path</span></div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border-2 rounded-[2.5rem] overflow-hidden bg-white shadow-sm">
                                    <CardHeader className="p-8 pb-4 border-b bg-muted/5 flex flex-col md:flex-row md:items-center justify-between gap-6 text-left">
                                        <div className="space-y-1 text-left"><CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-3"><HeartHandshake className="w-5 h-5 text-primary" /> Advocacy Impact</CardTitle><CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Revenue earned through guest referrals.</CardDescription></div>
                                        <div className="text-right"><p className="text-[10px] font-black uppercase text-primary/60 tracking-widest mb-1">Total Credit Earned</p><p className="text-3xl font-black font-mono tracking-tighter text-primary leading-none">${loyaltyHubData.referralEarnings.toFixed(2)}</p></div>
                                    </CardHeader>
                                    <CardContent className="p-8 space-y-8 text-left">
                                        {client.successfulReferrals?.length ? (
                                            <div className="space-y-4 text-left">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Converted Referrals</p>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                                    {client.successfulReferrals.map((name, idx) => (<div key={idx} className="flex items-center gap-3 p-3 rounded-xl border-2 bg-muted/5"><div className="p-2 bg-white rounded-lg shadow-sm"><User className="w-3.5 h-3.5 text-primary opacity-40" /></div><span className="text-[10px] font-black uppercase text-slate-700 truncate">{name}</span></div>))}
                                                </div>
                                            </div>
                                        ) : (<div className="py-12 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3"><PartyPopper className="w-10 h-10" /><p className="text-[10px] font-black uppercase tracking-widest">No Referrals Registered</p></div>)}
                                        <div className="p-6 rounded-3xl border-2 border-dashed border-primary/20 bg-primary/[0.02] flex flex-col sm:flex-row items-center justify-between gap-6 text-left">
                                            <div className="space-y-1 text-center sm:text-left"><p className="text-sm font-black uppercase tracking-tight text-slate-900">Expand the Circle</p><p className="text-[10px] font-medium text-slate-500 leading-relaxed uppercase tracking-tight">Share your referral code to earn instant studio credit.</p></div>
                                            <div className="flex gap-2 w-full sm:w-auto"><div className="flex-1 p-3 px-5 rounded-xl bg-white border-2 border-primary/10 shadow-inner font-black font-mono text-primary uppercase text-sm tracking-widest text-center">{client.referralCode}</div><Button variant="outline" size="icon" className="h-12 w-12 rounded-xl border-2 bg-white" onClick={() => { navigator.clipboard.writeText(client.referralCode || ''); toast({ title: 'Code Copied' }); }}><Repeat className="w-5 h-5 opacity-40" /></Button></div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        ) : (<div className="py-24 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4"><Trophy className="w-16 h-16" /><p className="text-[10px] font-black uppercase tracking-widest text-center">Reward profile loading...</p></div>)}
                    </TabsContent>

                    <TabsContent value="ledger" className="space-y-8 animate-in fade-in duration-500 text-left">
                        <div className="space-y-6">
                            <div className="flex items-center gap-3 px-1 text-left"><Landmark className="w-5 h-5 text-primary" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Accounting Manifest</h3></div>
                            {client.unpaidFees?.length ? (
                                <div className="grid gap-4">
                                    {client.unpaidFees.map((fee) => (
                                        <Card key={fee.feeId} className="border-4 border-destructive/20 bg-destructive/[0.02] rounded-3xl overflow-hidden shadow-xl shadow-destructive/5">
                                            <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
                                                <div className="flex items-center gap-4 text-left w-full sm:w-auto">
                                                    <div className="p-3 bg-destructive rounded-2xl shadow-lg shadow-destructive/20"><AlertTriangle className="w-6 h-6 text-white" /></div>
                                                    <div className="space-y-1"><p className="font-black text-sm uppercase tracking-tight text-destructive">{fee.reason}</p><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Incurred {format(safeDate(fee.appointmentDate), 'MMM d, yyyy')}</p></div>
                                                </div>
                                                <div className="text-center sm:text-right shrink-0"><p className="text-[9px] font-black uppercase text-destructive/60 tracking-widest mb-1">Fee Amount</p><p className="text-3xl font-black font-mono tracking-tighter text-destructive">${safeNumber(fee.feeAmount).toFixed(2)}</p></div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            ) : (<div className="py-24 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4"><ShieldCheck className="w-16 h-16 text-green-500" /><p className="text-[10px] font-black uppercase tracking-widest">Account Clear & Settled</p></div>)}
                        </div>
                    </TabsContent>
                </Tabs>
            </main>

            <Dialog open={isSettlementOpen} onOpenChange={setIsSettlementOpen}>
                <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden bg-background">
                    <AnimatePresence mode="wait">
                        {!settlementSuccess ? (
                            <motion.div key="pay-form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left"><div className="flex items-center gap-3 mb-2"><ShieldCheck className="w-5 h-5 text-primary" /><span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Settlement</span></div><DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none text-left">Account Reconciliation</DialogTitle></DialogHeader>
                                <div className="p-8 space-y-8">
                                    <div className="p-8 rounded-[3rem] bg-primary/5 border-4 border-primary/10 text-center space-y-4 shadow-inner">
                                        <p className="text-[10px] font-black uppercase text-primary/60 tracking-[0.3em]">Total Arrears Balance</p>
                                        <p className="text-6xl font-black text-primary tracking-tighter font-mono">${safeBalance.toFixed(2)}</p>
                                    </div>
                                    <div className="space-y-6 text-left">
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Distribution Method</Label>
                                            {client.cardOnFile ? (
                                                <div className="p-5 rounded-2xl border-2 bg-primary/[0.02] border-primary/10 flex items-center justify-between shadow-sm">
                                                    <div className="flex items-center gap-4 text-left">
                                                        <div className="p-2 bg-white rounded-xl shadow-sm border"><CreditCard className="w-5 h-5 text-primary" /></div>
                                                        <div className="text-left"><p className="font-black text-sm uppercase tracking-tight text-slate-900">{client.cardOnFile.brand} •••• {client.cardOnFile.last4}</p><p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Authorized Vault Card</p></div>
                                                    </div>
                                                    <Lock className="w-4 h-4 text-primary opacity-20" />
                                                </div>
                                            ) : (
                                                <div className="space-y-4">
                                                    <div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Card Protocol</Label><Input placeholder="•••• •••• •••• 4242" className="h-14 rounded-2xl border-2 font-mono text-lg shadow-inner bg-muted/5" /></div>
                                                    <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Expiry</Label><Input placeholder="MM / YY" className="h-12 rounded-xl border-2 text-center" /></div><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">CVC</Label><Input placeholder="•••" className="h-12 rounded-xl border-2 text-center" /></div></div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <DialogFooter className="p-8 pt-4 border-t bg-muted/5 flex flex-col gap-3"><Button onClick={handleSettleArrears} disabled={isProcessing} className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 active:scale-95 transition-all">{isProcessing ? <Loader className="animate-spin" /> : `Authorize $${safeBalance.toFixed(2)}`}</Button><Button variant="ghost" onClick={() => setIsSettlementOpen(false)} className="w-full font-black uppercase text-[10px] tracking-widest text-slate-400">Abort Protocol</Button></DialogFooter>
                            </motion.div>
                        ) : (<motion.div key="pay-success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-12 text-center space-y-10"><div className="w-32 h-32 bg-green-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/5 rotate-6"><CheckCircle2 className="w-16 h-16 text-green-500 -rotate-6" /></div><div className="space-y-2 text-center"><h3 className="text-3xl font-black uppercase tracking-tighter">Settlement Certified</h3><p className="text-sm font-medium text-slate-500 uppercase tracking-tight leading-relaxed">Your studio account has been reconciled.</p></div><Button className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20" onClick={() => { setIsSettlementOpen(false); setSettlementSuccess(false); }}>Return to Dashboard</Button></motion.div>)}
                    </AnimatePresence>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!appointmentToCancel} onOpenChange={() => setAppointmentToCancel(null)}>
                <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                    <AlertDialogHeader className="p-6 pb-0 text-left"><div className="flex items-center gap-3 mb-2 text-left"><AlertTriangle className="w-5 h-5 text-destructive" /><span className="text-[10px] font-black uppercase tracking-[0.2em] text-destructive">Policy Enforcement</span></div><AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter text-left">Authorize Cancellation</AlertDialogTitle></AlertDialogHeader>
                    <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3"><Button onClick={handleConfirmCancellation} disabled={isProcessing} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20 bg-destructive text-white hover:bg-destructive/90">{isProcessing ? <Loader className="animate-spin" /> : 'Confirm Termination'}</Button><AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none">Abort</AlertDialogCancel></AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {appointmentToReschedule && (<RescheduleDialog open={!!appointmentToReschedule} onOpenChange={() => setAppointmentToReschedule(null)} appointment={appointmentToReschedule} clients={clients || []} services={services || []} appointments={appointments || []} onConfirm={handleRescheduleConfirm} />)}
        </div>
    );
}
