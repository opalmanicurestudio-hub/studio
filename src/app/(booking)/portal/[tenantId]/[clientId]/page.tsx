'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, writeBatch, increment, arrayUnion, deleteField, getDocs } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { format, parseISO, subMonths, isAfter, subYears, startOfMonth, differenceInHours, isSameDay, startOfDay, addMonths, isToday } from 'date-fns';
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
    Heart,
    Landmark,
    LayoutDashboard,
    PlusCircle
} from 'lucide-react';
import { type Client, type Appointment, type Service, type Membership, type Package, type Tenant, type Redemption, type RefreshmentRequest, type Discount, type Staff, type Review, type InventoryItem, type PricingTier } from '@/lib/data';
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
import { GuestRescheduleDialog } from '@/components/booking/GuestRescheduleDialog';
import { nanoid } from 'nanoid';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { BookingSheet } from '@/components/booking/BookingSheet';
import { BookingServices } from '@/components/booking/BookingServices';

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
    const [appointmentToCancel, setAppointmentToCancel] = useState<Appointment | null>(null);
    const [appointmentToReschedule, setAppointmentToReschedule] = useState<Appointment | null>(null);
    const [isSettlementOpen, setIsSettlementOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [settlementSuccess, setSettlementSuccess] = useState(false);
    
    // Booking flow within portal
    const [isBookingFlowOpen, setIsBookingFlowOpen] = useState(false);
    const [selectedServiceForBooking, setSelectedServiceForBooking] = useState<Service | null>(null);
    const [isBookingSheetOpen, setIsBookingSheetOpen] = useState(false);

    // --- DATA FETCHING ---
    const clientRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}/clients/${clientId}`), [firestore, tenantId, clientId]);
    const { data: client, isLoading: clientLoading } = useDoc<Client>(clientRef);

    const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
    const { data: tenant } = useDoc<Tenant>(tenantRef);

    const appointmentsQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/appointments`), where('clientId', '==', clientId)), [firestore, tenantId, clientId]);
    const { data: appointments, isLoading: appointmentsLoading } = useCollection<Appointment>(appointmentsQuery);

    const redemptionsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/clients/${clientId}/redemptions`), [firestore, tenantId, clientId]);
    const { data: redemptions } = useCollection<Redemption>(redemptionsQuery);

    const refreshmentRequestsQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/refreshmentRequests`), where('clientId', '==', clientId)), [firestore, tenantId, clientId]);
    const { data: refreshmentRequests } = useCollection<RefreshmentRequest>(refreshmentRequestsQuery);

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

    const scheduleProfilesQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isActive", "==", true)), [firestore, tenantId]);
    const { data: scheduleProfiles } = useCollection<any>(scheduleProfilesQuery);

    const inventoryQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/inventory`), [firestore, tenantId]);
    const { data: inventory } = useCollection<InventoryItem>(inventoryQuery);

    const pricingTiersQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/pricingTiers`), [firestore, tenantId]);
    const { data: pricingTiers } = useCollection<PricingTier>(pricingTiersQuery);

    // --- LOGIC ---
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
        const now = new Date();
        const startOfToday = startOfDay(now);
        return appointments
            .filter(a => {
                const isCancelled = a.status === 'cancelled';
                const isCompleted = a.status === 'completed';
                const startTime = safeDate(a.startTime);
                return !isCancelled && !isCompleted && (startTime > now || isSameDay(startTime, startOfToday));
            })
            .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime());
    }, [appointments]);

    const pastAppointments = useMemo(() => {
        if (!appointments) return [];
        const now = new Date();
        const startOfToday = startOfDay(now);
        return appointments
            .filter(a => {
                const isCancelled = a.status === 'cancelled';
                const isCompleted = a.status === 'completed';
                const startTime = safeDate(a.startTime);
                return isCompleted || isCancelled || (startTime < startOfToday);
            })
            .sort((a, b) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime());
    }, [appointments]);

    const handleConfirmCancellation = async () => {
        if (!appointmentToCancel || !firestore || !tenantId || !client) return;
        setIsProcessing(true);
        
        const batch = writeBatch(firestore);
        const now = new Date().toISOString();
        const appointmentRef = doc(firestore, `tenants/${tenantId}/appointments`, appointmentToCancel.id);
        const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);

        const hoursUntil = differenceInHours(safeDate(appointmentToCancel.startTime), new Date());
        const svc = services?.find(s => s.id === appointmentToCancel.serviceId);
        const requiredWindow = svc?.cancellationWindowHours || tenant?.cancellationWindowHours || 24;
        const isLate = hoursUntil < requiredWindow;

        let feeAmount = 0;
        if (isLate) {
            const duration = svc?.duration || 60;
            const tmhrVal = tenant?.tmhr || 50;
            const overhead = (duration / 60) * tmhrVal;
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

        // --- INTELLIGENCE ALERT DISPATCH ---
        const adminsAndOwners = (staff || []).filter(s => s.role === 'admin' || s.role === 'owner');
        const recipients = new Set(adminsAndOwners.map(s => s.id));
        if (appointmentToCancel.staffId) recipients.add(appointmentToCancel.staffId);

        recipients.forEach(rid => {
            const notifRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
            batch.set(notifRef, {
                id: notifRef.id,
                userId: rid,
                type: 'cancellation',
                message: `Cancellation: ${client.name} for ${svc?.name || 'Service'} on ${format(safeDate(appointmentToCancel.startTime), 'MMM d @ h:mm a')}`,
                link: '/planner',
                createdAt: now,
                read: false
            });
        });

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
        if (!firestore || !tenantId || !client) return;
        setIsProcessing(true);
        
        const { applyFee, feeAmount, paymentMethod, ...aptData } = data;
        const batch = writeBatch(firestore);
        const appointmentRef = doc(firestore, `tenants/${tenantId}/appointments`, aptData.id);
        const now = new Date().toISOString();
        const svc = services?.find(s => s.id === aptData.serviceId);
        
        const updates: any = {
            startTime: aptData.startTime,
            endTime: aptData.endTime
        };

        if (applyFee && feeAmount > 0) {
            if (paymentMethod === 'settle_now' || paymentMethod === 'new_card') {
                const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
                batch.set(txnRef, {
                    id: txnRef.id,
                    date: now,
                    description: `Reschedule Recovery: ${aptData.clientName}`,
                    clientOrVendor: aptData.clientName || 'Client',
                    clientId: client.id,
                    type: 'income',
                    context: 'Business',
                    category: 'Adjustment Fee',
                    amount: feeAmount,
                    paymentMethod: paymentMethod === 'new_card' ? 'New Card' : 'Card on File',
                    hasReceipt: false,
                    appointmentId: aptData.id,
                    tenantId
                });
            } else if (paymentMethod === 'add_to_session') {
                updates['checkoutState.additionalCharge'] = increment(feeAmount);
            } else {
                const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
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
        }

        batch.update(appointmentRef, updates);

        // --- INTELLIGENCE ALERT DISPATCH ---
        const adminsAndOwners = (staff || []).filter(s => s.role === 'admin' || s.role === 'owner');
        const recipients = new Set(adminsAndOwners.map(s => s.id));
        if (aptData.staffId) recipients.add(aptData.staffId);

        recipients.forEach(rid => {
            const notifRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
            batch.set(notifRef, {
                id: notifRef.id,
                userId: rid,
                type: 'reschedule',
                message: `Reschedule: ${client.name} moved ${svc?.name || 'Session'} to ${format(safeDate(aptData.startTime), 'MMM d @ h:mm a')}`,
                link: '/planner',
                createdAt: now,
                read: false
            });
        });

        try {
            await batch.commit();
            toast({ title: "Session Shifted", description: applyFee ? "Protocol adjustment applied to ledger." : "Agenda updated." });
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

    const handleConfirmDirectBooking = async (
        formData: { clientName: string; clientEmail: string; clientPhone?: string },
        appointmentDetails: Omit<Appointment, 'id' | 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'>,
        signedForms: { formId: string; formTitle: string; formData: Record<string, any> }[],
        setBookingStep: (step: string) => void
    ) => {
        if (!firestore || !tenantId || !client) return;
        setIsProcessing(true);
        const batch = writeBatch(firestore);
        const now = new Date().toISOString();

        try {
            const appointmentRef = doc(collection(firestore, `tenants/${tenantId}/appointments`));
            const newAppointmentId = appointmentRef.id;
            const checkInToken = nanoid(16);

            const newAppointment = {
                ...appointmentDetails,
                id: newAppointmentId,
                tenantId: tenantId,
                clientId: client.id,
                clientName: client.name,
                clientEmail: client.email,
                clientPhone: client.phone,
                checkInToken: checkInToken,
            };

            batch.set(appointmentRef, newAppointment);
            batch.set(doc(firestore, 'appointmentCheckIns', checkInToken), newAppointment);

            signedForms.forEach(form => {
                const consentDocRef = doc(collection(firestore, `tenants/${tenantId}/clients/${client.id}/signedConsents`));
                batch.set(consentDocRef, {
                    ...form,
                    id: consentDocRef.id,
                    clientId: client.id,
                    signedAt: now,
                });
            });

            if (newAppointment.staffId) {
                const notificationRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
                batch.set(notificationRef, {
                    id: nanoid(),
                    userId: newAppointment.staffId,
                    type: 'new_appointment',
                    message: `New booking: ${client.name} for ${selectedServiceForBooking?.name} on ${format(parseISO(newAppointment.startTime), 'MMM d @ h:mm a')}`,
                    link: '/planner',
                    createdAt: now,
                    read: false,
                });
            }
            
            await batch.commit();
            toast({ title: 'Booking Confirmed!' });
            setBookingStep('confirmation');
        } catch (error) {
            console.error(error);
            toast({ variant: 'destructive', title: "Booking Failed" });
        } finally {
            setIsProcessing(false);
        }
    };

    const safeBalance = useMemo(() => safeNumber(client?.outstandingBalance), [client]);

    if (clientLoading || appointmentsLoading) {
        return (
            <div className="flex h-screen w-full flex-col items-center justify-center p-4 bg-background text-center">
                <Loader className="h-10 w-10 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40 mt-4">Initializing Studio Pulse...</p>
            </div>
        );
    }

    if (!client) return null;

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
                                    <Image src={tenant.bookingPageSettings.logoUrl} alt={tenant.name || 'Studio'} fill className="object-cover" />
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
                "relative transition-all duration-1000 p-4 md:p-8 max-w-6xl mx-auto space-y-8 md:space-y-10",
                !entered ? "opacity-0 translate-y-10" : "opacity-100 translate-y-0"
            )}>
                <header className="flex flex-col md:flex-row items-center gap-6 md:gap-8 text-center md:text-left pt-10">
                    <div className="relative group">
                        <Avatar className="w-20 h-20 md:w-28 md:h-28 border-4 border-white shadow-2xl rounded-[2.5rem] overflow-hidden transition-all group-hover:scale-105">
                            <AvatarImage src={client.avatarUrl} className="object-cover" />
                            <AvatarFallback className="font-black text-xl bg-primary/10 text-primary uppercase">{(client.name || 'G').substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        {activeMembership && (
                            <div className="absolute -top-2 -right-2 bg-indigo-600 text-white p-1.5 rounded-2xl shadow-xl border-4 border-white">
                                <Award className="w-4 h-4 md:w-5 md:h-5" />
                            </div>
                        )}
                    </div>
                    <div className="space-y-1 flex-1 min-w-0 text-left">
                        <h1 className={cn("font-black uppercase tracking-tighter text-slate-900 leading-none truncate w-full md:w-auto text-center md:text-left", client.name.length > 15 ? "text-xl md:text-2xl" : "text-2xl md:text-4xl")}>
                            {client.name}
                        </h1>
                        <p className="text-[10px] md:text-xs font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-center md:text-left">{tenant?.name} &middot; Authenticated Guest</p>
                    </div>
                    <div className="shrink-0 flex gap-2 w-full md:w-auto">
                        <Button asChild variant="outline" className="flex-1 md:flex-none h-12 md:h-14 px-4 md:px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest border-border/50 bg-white/50 backdrop-blur-sm">
                            <Link href={`/book/${tenantId}`}>View Menu</Link>
                        </Button>
                        <Button 
                            onClick={() => setIsBookingFlowOpen(true)}
                            size="lg" 
                            className="flex-[2] md:flex-none h-12 md:h-14 px-6 md:px-8 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 group"
                        >
                            Secure Session <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </Button>
                    </div>
                </header>

                <AnimatePresence>
                    {safeBalance > 0 && (
                        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}>
                            <Alert variant="destructive" className="border-4 border-destructive/20 bg-destructive/[0.02] rounded-[2.5rem] p-6 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6 text-left">
                                <div className="flex items-start gap-4 md:gap-6 text-left">
                                    <div className="p-3 md:p-4 bg-destructive text-white rounded-2xl shadow-xl shadow-destructive/20 shrink-0 mt-1">
                                        <Wallet className="w-6 h-6 md:w-8 md:h-8" />
                                    </div>
                                    <div className="space-y-1 text-left">
                                        <AlertTitle className="text-lg md:text-xl font-black uppercase tracking-tighter text-destructive leading-none text-left">Accounting Balance</AlertTitle>
                                        <AlertDescription className="text-[10px] md:text-sm font-bold text-slate-600 uppercase tracking-tight opacity-80 mt-2 text-left">
                                            A total of <strong>${safeBalance.toFixed(2)}</strong> in outstanding fees is recorded. Reconcile now to maintain active status.
                                        </AlertDescription>
                                        <div className="pt-4 text-left text-left">
                                            <Button variant="outline" onClick={() => setIsSettlementOpen(true)} className="h-9 md:h-10 rounded-xl border-destructive/30 bg-white text-destructive font-black uppercase text-[10px] tracking-widest hover:bg-destructive hover:text-white transition-all shadow-sm text-left"><Zap className="w-3.5 h-3.5 mr-2" />Settle Balance Now</Button>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-[9px] md:text-[10px] font-black uppercase text-destructive tracking-[0.2em] mb-1 text-right">Total Arrears</p>
                                    <p className="text-2xl md:text-4xl font-black font-mono tracking-tighter text-destructive text-right">${safeBalance.toFixed(2)}</p>
                                </div>
                            </Alert>
                        </motion.div>
                    )}
                </AnimatePresence>

                <Tabs defaultValue="appointments" className="w-full">
                    <ScrollArea className="w-full">
                        <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-10 w-max mx-auto">
                            <TabsTrigger value="appointments" className="px-6 md:px-8 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">
                                <Clock className="w-3.5 h-3.5 mr-2" /> Schedule
                            </TabsTrigger>
                            <TabsTrigger value="portfolio" className="px-6 md:px-8 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">
                                <Award className="w-3.5 h-3.5 mr-2" /> Membership
                            </TabsTrigger>
                            <TabsTrigger value="rewards" className="px-6 md:px-8 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">
                                <Trophy className="w-3.5 h-3.5 mr-2" /> Rewards
                            </TabsTrigger>
                            <TabsTrigger value="ledger" className="px-6 md:px-8 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">
                                <Landmark className="w-3.5 h-3.5 mr-2" /> Ledger
                            </TabsTrigger>
                        </TabsList>
                        <ScrollBar orientation="horizontal" className="hidden" />
                    </ScrollArea>

                    <TabsContent value="appointments" className="space-y-12 animate-in fade-in duration-500 text-left">
                        <div className="space-y-6 text-left">
                            <div className="flex items-center justify-between px-1 text-left">
                                <div className="flex items-center gap-3 text-left">
                                    <Calendar className="w-5 h-5 text-primary" />
                                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 text-left">Agenda Matrix</h3>
                                </div>
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => setIsBookingFlowOpen(true)}
                                    className="h-8 rounded-xl font-black uppercase text-[10px] tracking-widest text-primary border border-primary/20 hover:bg-primary/5"
                                >
                                    <PlusCircle className="w-3.5 h-3.5 mr-2" /> Reserve Session
                                </Button>
                            </div>
                            {upcomingAppointments.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-left">
                                    {upcomingAppointments.map(apt => {
                                        const svc = services?.find(s => s.id === apt.serviceId);
                                        const pro = staff?.find(s => s.id === apt.staffId);
                                        const isActionable = apt.status === 'confirmed' || apt.status === 'deposit_pending' || apt.status === 'ready_for_checkout' || apt.status === 'servicing';
                                        return (
                                            <Card key={apt.id} className="border-2 rounded-[2.5rem] overflow-hidden bg-white shadow-sm hover:border-primary/20 transition-all group flex flex-col text-left">
                                                <CardContent className="p-6 flex items-center gap-6 flex-1 text-left text-left">
                                                    <div className="p-4 bg-primary/5 rounded-2xl border-2 border-primary/10 shadow-inner text-primary shrink-0 group-hover:bg-primary group-hover:text-white transition-all duration-500"><Calendar className="w-8 h-8" /></div>
                                                    <div className="min-w-0 text-left flex-1 text-left">
                                                        <p className="font-black text-lg uppercase tracking-tight text-slate-900 truncate mb-1 text-left">{svc?.name || 'Service'}</p>
                                                        <div className="flex items-center gap-2 mb-2 text-left">
                                                            <Badge variant="outline" className="h-5 px-2 border-none bg-muted/50 text-muted-foreground text-[8px] font-black uppercase">By {pro?.name.split(' ')[0] || 'Technician'}</Badge>
                                                            <Badge className={cn("h-5 px-2 border-none font-black text-[8px] uppercase", apt.status === 'confirmed' ? "bg-green-500 text-white" : "bg-amber-500 text-white")}>{apt.status.replace('_', ' ')}</Badge>
                                                        </div>
                                                        <p className="text-xl font-black text-primary font-mono tracking-tighter text-left">{format(safeDate(apt.startTime), 'EEEE, MMM d @ h:mm a')}</p>
                                                    </div>
                                                </CardContent>
                                                {isActionable && apt.status !== 'servicing' && apt.status !== 'ready_for_checkout' && (
                                                    <div className="p-3 border-t bg-muted/5 grid grid-cols-2 gap-2 text-left">
                                                        <Button variant="ghost" onClick={() => setAppointmentToReschedule(apt)} className="h-10 rounded-xl font-black uppercase text-[9px] tracking-widest hover:bg-primary/5 text-primary"><Undo2 className="w-3.5 h-3.5 mr-2" /> Reschedule</Button>
                                                        <Button variant="ghost" onClick={() => setAppointmentToCancel(apt)} className="h-10 rounded-xl font-black uppercase text-[9px] tracking-widest hover:bg-destructive/5 text-destructive"><XCircle className="w-3.5 h-3.5 mr-2" /> Cancel</Button>
                                                    </div>
                                                )}
                                                {apt.checkInToken && apt.status !== 'ready_for_checkout' && apt.status !== 'servicing' && (
                                                    <div className="p-2 pt-0 border-t bg-muted/5 text-left">
                                                        <Button asChild variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[9px] tracking-widest text-primary hover:bg-primary/5">
                                                            <Link href={`/check-in/${apt.checkInToken}`}>Open Digital Key <ArrowRight className="ml-2 h-3 w-3" /></Link>
                                                        </Button>
                                                    </div>
                                                )}
                                            </Card>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="py-24 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4 text-center"><Clock className="w-16 h-16" /><p className="text-[10px] font-black uppercase tracking-widest text-center px-8">No Upcoming Appointments</p></div>
                            )}
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-6 text-left">
                            <div className="flex items-center gap-3 px-1 text-left text-left">
                                <History className="w-5 h-5 text-muted-foreground opacity-40" />
                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60 text-left">Technical History Archive</h3>
                            </div>
                            <div className="grid gap-4 text-left">
                                {pastAppointments.slice(0, 10).map(apt => {
                                    const svc = services?.find(s => s.id === apt.serviceId);
                                    const pro = staff?.find(s => s.id === apt.staffId);
                                    return (
                                        <Card key={apt.id} className="border-2 rounded-[1.5rem] bg-white hover:bg-muted/5 transition-all overflow-hidden text-left">
                                            <CardContent className="p-5 flex items-center justify-between gap-6 text-left text-left">
                                                <div className="flex items-center gap-4 min-w-0 flex-1 text-left text-left">
                                                    <div className="p-2.5 bg-muted/30 rounded-xl shrink-0"><CheckCircle2 className="w-5 h-5 text-slate-400" /></div>
                                                    <div className="min-w-0 text-left text-left">
                                                        <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate leading-none mb-1 text-left">{svc?.name}</p>
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">Verified with {pro?.name || 'Staff'}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0 ml-4">
                                                    <p className="text-[10px] font-black font-mono text-slate-600 text-right">{format(safeDate(apt.startTime), 'MMM d, yyyy')}</p>
                                                    <Badge variant="outline" className="h-4 px-1.5 rounded-md border-none bg-muted/20 text-[7px] font-black uppercase mt-1">{(apt.status || 'UNKN').toUpperCase()}</Badge>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="portfolio" className="space-y-12 animate-in fade-in duration-500 text-left">
                        {activeMembership ? (
                            <div className="space-y-12 text-left">
                                <section className="space-y-6 text-left">
                                    <div className="flex flex-col sm:flex-row items-center justify-between px-1 gap-4 text-left">
                                        <div className="flex items-center gap-3 w-full sm:w-auto text-left text-left">
                                            <ShieldCheck className="w-5 h-5 text-indigo-600" />
                                            <div className="text-left text-left">
                                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 leading-tight text-left">Active Allotment Matrix</h3>
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">Cycle: {format(cycleStart, 'MMM d')} - {client?.subscription?.nextBillingDate ? format(safeDate(client.subscription.nextBillingDate), 'MMM d, yyyy') : '...'}</p>
                                            </div>
                                        </div>
                                        {loyaltyHubData && (<div className="w-full sm:w-auto flex items-center gap-2 px-4 py-2 rounded-2xl bg-green-500/5 border-2 border-green-500/10 text-left"><TrendingUp className="w-3.5 h-3.5 text-green-600" /><span className="text-[10px] font-black uppercase text-green-700">Value Secured: ${loyaltyHubData.cycleSavings.toFixed(0)}</span></div>)}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                        {perkAllotments.map(perk => {
                                            const used = safeNumber(perk.used);
                                            const total = safeNumber(perk.quantity);
                                            const remaining = Math.max(0, total - used);
                                            const isExhausted = used >= total;
                                            return (
                                                <Card key={perk.id} className={cn("border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm hover:border-primary/20 transition-all text-left", isExhausted && "opacity-60")}>
                                                    <CardContent className="p-6 space-y-5 text-left text-left">
                                                        <div className="flex justify-between items-start gap-4 text-left text-left">
                                                            <div className="space-y-1 flex-1 min-w-0 text-left text-left">
                                                                <p className="font-black text-base uppercase tracking-tight text-slate-900 truncate leading-none mb-1 text-left">{perk.name}</p>
                                                                <p className={cn("text-[9px] font-black uppercase tracking-widest text-left", perk.color)}>{perk.type} Allotment</p>
                                                            </div>
                                                            <div className={cn("p-3 rounded-2xl shadow-inner shrink-0", isExhausted ? "bg-green-500/10 text-green-600" : perk.bg + " " + perk.color)}>{isExhausted ? <CheckCircle2 className="w-6 h-6" /> : <perk.icon className="w-6 h-6" />}</div>
                                                        </div>
                                                        <div className="space-y-2 text-left">
                                                            <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1 text-left text-left"><span>Allotment State</span><div className="flex items-center gap-1.5"><span>Used {used} / {total}</span><Badge variant="outline" className={cn("h-4 border-none font-black", isExhausted ? "text-muted-foreground" : "text-primary")}>({remaining} LEFT)</Badge></div></div>
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
                                    <div className="flex items-center gap-3 px-1 text-left text-left"><Activity className="w-5 h-5 text-primary" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 text-left">Current Cycle Redemptions</h3></div>
                                    {currentCycleActivity.all.length > 0 ? (
                                        <div className="grid gap-3 text-left">
                                            {currentCycleActivity.all.map((item: any) => {
                                                const isRefreshment = !!item.itemName;
                                                const date = safeDate(item.date || item.requestedAt);
                                                return (
                                                    <div key={item.id} className="flex items-center justify-between p-5 rounded-[1.5rem] border-2 bg-white shadow-sm hover:border-primary/20 transition-all text-left">
                                                        <div className="flex items-center gap-4 text-left min-w-0 flex-1 text-left text-left">
                                                            <div className={cn("p-3 rounded-2xl shadow-inner shrink-0", isRefreshment ? "bg-primary/10 text-primary" : "bg-indigo-500/10 text-indigo-600")}>{isRefreshment ? <Coffee className="w-5 h-5" /> : <Star className="w-5 h-5" />}</div>
                                                            <div className="min-w-0 text-left text-left text-left">
                                                                <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate leading-none mb-1 text-left text-left">{isRefreshment ? item.itemName : item.serviceName}</p>
                                                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left text-left">Drawn from Membership Portfolio</p>
                                                            </div>
                                                        </div>
                                                        <div className="text-right shrink-0 ml-4">
                                                            <p className="font-black font-mono text-[11px] text-slate-900 leading-none text-right">{format(date, 'MMM d, p')}</p>
                                                            <Badge variant="outline" className="h-4 px-1 text-[7px] font-black uppercase mt-2 border-none bg-muted/20 text-muted-foreground shadow-sm">VERIFIED</Badge>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (<div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4 text-center"><History className="w-12 h-12" /><p className="text-[10px] font-black uppercase tracking-widest text-center px-8">No Activity Logged in Current Cycle</p></div>)}
                                </section>
                            </div>
                        ) : (
                            <div className="py-24 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4 text-center">
                                <Award className="w-16 h-16" />
                                <p className="text-xl font-black uppercase tracking-tighter text-slate-900 text-center">Portfolio Inactive</p>
                                <Button asChild className="h-12 px-8 rounded-xl font-black uppercase text-[10px] tracking-widest mt-4">
                                    <Link href={`/book/${tenantId}#memberships`}>Explore Tiers</Link>
                                </Button>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="rewards" className="space-y-10 animate-in fade-in duration-500 text-left">
                        {loyaltyHubData ? (
                            <div className="space-y-10 text-left">
                                <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group text-left">
                                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><Flame className="w-32 h-32 text-primary" /></div>
                                    <CardHeader className="p-8 pb-2 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2 text-left"><Sparkles className="w-3.5 h-3.5" /> Next Reward Protocol</CardTitle></CardHeader>
                                    <CardContent className="p-8 pt-4 space-y-6 text-left">
                                        <div className="text-left text-left">
                                            <p className="text-4xl md:text-6xl font-black text-primary tracking-tighter leading-none text-left">{loyaltyHubData.visitsToNext}</p>
                                            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2 text-left">Sessions remaining until next reward</p>
                                        </div>
                                        <div className="space-y-2 text-left">
                                            <Progress value={loyaltyHubData.progressToNextReward} className="h-2 rounded-full bg-white/40" />
                                            <div className="flex justify-between text-[8px] font-black uppercase tracking-widest text-primary/60 text-left text-left"><span>Active Progress</span><span>{Math.round(loyaltyHubData.progressToNextReward)}% Path</span></div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border-2 rounded-[2.5rem] overflow-hidden bg-white shadow-sm text-left">
                                    <CardHeader className="p-8 pb-4 border-b bg-muted/5 flex flex-col md:flex-row md:items-center justify-between gap-6 text-left">
                                        <div className="space-y-1 text-left"><CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-3 text-left"><HeartHandshake className="w-5 h-5 text-primary" /> Advocacy Impact</CardTitle><CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 text-left">Revenue earned through guest referrals.</CardDescription></div>
                                        <div className="text-right text-right"><p className="text-[9px] font-black uppercase text-primary/60 tracking-widest mb-1 text-right">Total Credit Earned</p><p className="text-3xl font-black font-mono tracking-tighter text-primary leading-none text-right">${loyaltyHubData.referralEarnings.toFixed(2)}</p></div>
                                    </CardHeader>
                                    <CardContent className="p-8 space-y-8 text-left">
                                        {client.successfulReferrals?.length ? (
                                            <div className="space-y-4 text-left">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Converted Referrals</p>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-left text-left">
                                                    {client.successfulReferrals.map((name, idx) => (<div key={idx} className="flex items-center gap-3 p-3 rounded-xl border-2 bg-muted/5 text-left text-left"><div className="p-2 bg-white rounded-lg shadow-sm shrink-0"><User className="w-3.5 h-3.5 text-primary opacity-40" /></div><span className="text-[10px] font-black uppercase text-slate-700 truncate text-left">{name}</span></div>))}
                                                </div>
                                            </div>
                                        ) : (<div className="py-12 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3 text-center"><PartyPopper className="w-10 h-10" /><p className="text-[10px] font-black uppercase tracking-widest">No Referrals Registered</p></div>)}
                                        <div className="p-6 rounded-3xl border-2 border-dashed border-primary/20 bg-primary/[0.02] flex flex-col sm:flex-row items-center justify-between gap-6 text-left">
                                            <div className="space-y-1 text-center sm:text-left text-left"><p className="text-sm font-black uppercase tracking-tight text-slate-900 text-left">Expand the Circle</p><p className="text-[10px] font-medium text-slate-500 leading-relaxed uppercase tracking-tight text-left">Share your referral code to earn instant studio credit.</p></div>
                                            <div className="flex gap-2 w-full sm:w-auto text-left"><div className="flex-1 p-3 px-5 rounded-xl bg-white border-2 border-primary/10 shadow-inner font-black font-mono text-primary uppercase text-sm tracking-widest text-center">{client.referralCode}</div><Button variant="outline" size="icon" className="h-12 w-12 rounded-xl border-2 bg-white" onClick={() => { navigator.clipboard.writeText(client.referralCode || ''); toast({ title: 'Code Copied' }); }}><Repeat className="w-5 h-5 opacity-40" /></Button></div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        ) : (
                            <div className="py-24 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4 text-center">
                                <Trophy className="w-16 h-16" />
                                <p className="text-[10px] font-black uppercase tracking-widest text-center">Reward profile loading...</p>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="ledger" className="space-y-8 animate-in fade-in duration-500 text-left">
                        <div className="space-y-6 text-left text-left">
                            <div className="flex items-center gap-3 px-1 text-left text-left text-left"><Landmark className="w-5 h-5 text-primary" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 text-left">Accounting Manifest</h3></div>
                            {client.unpaidFees?.length ? (
                                <div className="grid gap-4 text-left text-left">
                                    {client.unpaidFees.map((fee) => (
                                        <Card key={fee.feeId} className="border-4 border-destructive/20 bg-destructive/[0.02] rounded-3xl overflow-hidden shadow-xl shadow-destructive/5 text-left text-left">
                                            <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-6 text-left text-left text-left">
                                                <div className="flex items-center gap-4 text-left w-full sm:w-auto text-left text-left">
                                                    <div className="p-3 bg-destructive rounded-2xl shadow-lg shadow-destructive/20 shrink-0"><AlertTriangle className="w-6 h-6 text-white" /></div>
                                                    <div className="space-y-1 text-left text-left"><p className="font-black text-sm uppercase tracking-tight text-destructive text-left">{fee.reason}</p><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">Incurred {format(safeDate(fee.appointmentDate), 'MMM d, yyyy')}</p></div>
                                                </div>
                                                <div className="text-center sm:text-right shrink-0 text-right"><p className="text-[9px] font-black uppercase text-destructive/60 tracking-widest mb-1 text-right">Fee Amount</p><p className="text-3xl font-black font-mono tracking-tighter text-destructive text-right">${safeNumber(fee.feeAmount).toFixed(2)}</p></div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            ) : (<div className="py-24 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4 text-left text-center"><ShieldCheck className="w-16 h-16 text-green-500" /><p className="text-[10px] font-black uppercase tracking-widest text-center">Account Clear & Settled</p></div>)}
                        </div>
                    </TabsContent>
                </Tabs>
            </main>

            <AnimatePresence>
                {isBookingFlowOpen && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed inset-0 z-[110] bg-background/95 backdrop-blur-3xl overflow-y-auto">
                        <div className="max-w-6xl mx-auto p-6 md:p-12 pb-32">
                            <header className="flex justify-between items-center mb-12">
                                <div className="space-y-1 text-left">
                                    <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900">Secure New Session</h2>
                                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest opacity-60">Choose your next technical protocol</p>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => setIsBookingFlowOpen(false)} className="h-12 w-12 rounded-full hover:bg-muted"><XCircle className="w-8 h-8 opacity-40"/></Button>
                            </header>
                            <BookingServices 
                                services={services || []} 
                                onServiceSelect={(s) => { 
                                    setSelectedServiceForBooking(s); 
                                    setIsBookingSheetOpen(true); 
                                }} 
                                tenant={tenant}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <Dialog open={isSettlementOpen} onOpenChange={setIsSettlementOpen}>
                <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden bg-background">
                    <AnimatePresence mode="wait">
                        {!settlementSuccess ? (
                            <motion.div key="pay-form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left"><div className="flex items-center gap-3 mb-2 text-left text-left"><ShieldCheck className="w-5 h-5 text-primary" /><span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60 text-left">Strategic Settlement</span></div><DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none text-left">Account Reconciliation</DialogTitle></DialogHeader>
                                <div className="p-8 space-y-8 text-left">
                                    <div className="p-8 rounded-[3rem] bg-primary/5 border-4 border-primary/10 text-center space-y-4 shadow-inner">
                                        <p className="text-[10px] font-black uppercase text-primary/60 tracking-[0.3em]">Total Arrears Balance</p>
                                        <p className="text-6xl font-black text-primary tracking-tighter font-mono">${safeBalance.toFixed(2)}</p>
                                    </div>
                                    <div className="space-y-6 text-left">
                                        <div className="space-y-3 text-left">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Distribution Method</Label>
                                            {client.cardOnFile ? (
                                                <div className="p-5 rounded-2xl border-2 bg-primary/[0.02] border-primary/10 flex items-center justify-between shadow-sm text-left">
                                                    <div className="flex items-center gap-4 text-left">
                                                        <div className="p-2 bg-white rounded-xl shadow-sm border shrink-0"><CreditCard className="w-5 h-5 text-primary" /></div>
                                                        <div className="text-left"><p className="font-black text-sm uppercase tracking-tight text-slate-900 text-left">{client.cardOnFile.brand} •••• {client.cardOnFile.last4}</p><p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 text-left">Authorized Vault Card</p></div>
                                                    </div>
                                                    <Lock className="w-4 h-4 text-primary opacity-20" />
                                                </div>
                                            ) : (
                                                <div className="space-y-4 text-left">
                                                    <div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Card Protocol</Label><Input placeholder="•••• •••• •••• 1234" className="h-14 rounded-2xl border-2 font-mono text-lg shadow-inner bg-muted/5" /></div>
                                                    <div className="grid grid-cols-2 gap-4 text-left"><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Expiry</Label><Input placeholder="MM / YY" className="h-12 rounded-xl border-2 text-center" /></div><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">CVC</Label><Input placeholder="•••" className="h-12 rounded-xl border-2 text-center" /></div></div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <DialogFooter className="p-8 pt-4 border-t bg-muted/5 flex flex-col gap-3 text-left"><Button onClick={handleSettleArrears} disabled={isProcessing} className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 active:scale-95 transition-all">{isProcessing ? <Loader className="animate-spin" /> : `Authorize $${safeBalance.toFixed(2)}`}</Button><Button variant="ghost" onClick={() => setIsSettlementOpen(false)} className="w-full font-black uppercase text-[10px] tracking-widest text-slate-400">Abort Protocol</Button></DialogFooter>
                            </motion.div>
                        ) : (<motion.div key="pay-success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-12 text-center space-y-10 text-center"><div className="w-32 h-32 bg-green-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/5 rotate-6"><CheckCircle2 className="w-16 h-16 text-green-500 -rotate-6" /></div><div className="space-y-2 text-center"><h3 className="text-3xl font-black uppercase tracking-tighter text-center">Settlement Certified</h3><p className="text-sm font-medium text-slate-500 uppercase tracking-tight leading-relaxed text-center">Your studio account has been reconciled.</p></div><Button className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20" onClick={() => { setIsSettlementOpen(false); setSettlementSuccess(false); }}>Return to Dashboard</Button></motion.div>)}
                    </AnimatePresence>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!appointmentToCancel} onOpenChange={() => setAppointmentToCancel(null)}>
                <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden bg-background text-left">
                    <AlertDialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left"><div className="flex items-center gap-3 mb-2 text-left"><AlertTriangle className="w-5 h-5 text-destructive" /><span className="text-[10px] font-black uppercase tracking-[0.2em] text-destructive">Policy Enforcement</span></div><AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter text-left">Authorize Cancellation</AlertDialogTitle></AlertDialogHeader>
                    <div className="p-8 text-sm font-medium text-slate-600 leading-relaxed uppercase tracking-tight text-left">
                        Terminating your session at this stage may incur a recovery fee based on the proximity to your appointment time. Continue?
                    </div>
                    <AlertDialogFooter className="p-8 pt-4 bg-muted/5 border-t flex flex-col gap-3 text-left">
                        <Button onClick={handleConfirmCancellation} disabled={isProcessing} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/30 bg-destructive text-white hover:bg-destructive/90">{isProcessing ? <Loader className="animate-spin" /> : 'Confirm Termination'}</Button>
                        <AlertDialogCancel onClick={() => setAppointmentToCancel(null)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none">Abort</AlertDialogCancel>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {appointmentToReschedule && (
                <GuestRescheduleDialog 
                    open={!!appointmentToReschedule} 
                    onOpenChange={() => setAppointmentToReschedule(null)} 
                    appointment={appointmentToReschedule} 
                    client={client} 
                    service={services?.find(s => s.id === appointmentToReschedule.serviceId)!} 
                    appointments={appointments || []}
                    services={services || []}
                    tenant={tenant}
                    staff={staff || []}
                    scheduleProfiles={scheduleProfiles || []}
                    inventory={inventory || []}
                    onConfirm={handleRescheduleConfirm} 
                />
            )}

            {selectedServiceForBooking && (
                <BookingSheet
                    open={isBookingSheetOpen}
                    onOpenChange={setIsBookingSheetOpen}
                    service={selectedServiceForBooking}
                    staff={staff || []}
                    pricingTiers={pricingTiers || []}
                    appointments={appointments || []}
                    events={[]} // Handled in DB queries internally
                    scheduleProfiles={scheduleProfiles || []}
                    services={services || []}
                    consentForms={[]}
                    tenant={tenant || null}
                    onConfirm={handleConfirmDirectBooking}
                />
            )}
        </div>
    );
}
