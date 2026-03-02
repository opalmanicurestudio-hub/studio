'use client';

import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, getServicePrice, type Discount, type Membership, type Package, type AppointmentCheckoutState, type StockCorrection, type InventoryItem, type Resource } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from '@/components/ui/button';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, query, where, deleteField, Timestamp } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, startOfDay, endOfDay, addMinutes, isSameDay } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ShoppingCart, Clock, TrendingUp, Users, DollarSign, QrCode, Loader, MessageSquare, Play, Square, XCircle, Fingerprint, Printer, Undo2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Html5Qrcode } from 'html5-qrcode';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';

/**
 * Utility to safely convert potential strings, Timestamps or Date objects into valid Date instances.
 */
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

const KpiCard = ({ title, value, icon, description, iconBgColor }: { title: string; value: string; icon: React.ReactNode, description: string, iconBgColor: string }) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <div className={cn("p-2 rounded-lg", iconBgColor)}>
        {React.cloneElement(icon as React.ReactElement, { className: 'w-5 h-5' })}
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </CardContent>
  </Card>
);

function POSPageContent() {
    const { inventory, services, appointments: appointmentsFromInventory, clients, walkIns, staff, transactions, activityLogs, discounts, memberships, packages, resources } = useInventory();
    const { firestore, user: currentUser } = useFirebase();
    const { selectedTenant, role } = useTenant();
    const tenantId = selectedTenant?.id;
    const router = useRouter();
    const searchParams = useSearchParams();
    const isMobile = useIsMobile();

    const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<Set<string>>(new Set());
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [retailItems, setRetailItems] = useState<any[]>([]);
    const [tipAmount, setTipAmount] = useState(0);
    const [paymentTab, setPaymentTab] = useState('card');
    const [amountTendered, setAmountTendered] = useState<number>(0);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isAddClientOpen, setIsAddClientOpen] = useState(false);
    
    const [waivedAppointmentFees, setWaivedAppointmentFees] = useState<Map<string, { authorizerId: string; reason: string }>>(new Map());

    const handleWaiveFeeToggle = useCallback((appointmentId: string, waive: boolean, authorizerId?: string, reason?: string) => {
        setWaivedAppointmentFees(prev => {
            const next = new Map(prev);
            if (waive && authorizerId && reason) {
                next.set(appointmentId, { authorizerId, reason });
            } else {
                next.delete(appointmentId);
            }
            return next;
        });
    }, []);

    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
    const [isOverrideOpen, setIsOverrideOpen] = useState(false);
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
    const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);
    const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
    const [isPinAuthOpen, setIsPinAuthOpen] = useState(false);

    const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
    const [appointmentToReview, setAppointmentToReview] = useState<Appointment | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [redeemedOffer, setRedeemedOffer] = useState<{type: 'membership' | 'package' | 'retail_discount', id: string} | null>(null);
    const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
    const [appliedAdjustments, setAppliedAdjustments] = useState<Set<string>>(new Set());
    const [tipAllocations, setTipAllocations] = useState<Record<string, number>>({});
    
    const [authPin, setAuthPin] = useState('');
    const [pendingStatusAction, setPendingStatusAction] = useState<{ staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' } | null>(null);

    const [assignmentMode, setAssignmentMode] = useState<'fair_play' | 'ordered_list'>('ordered_list');
    const [ticketToPrint, setTicketToPrint] = useState<WalkInTicketData | null>(null);
    const [confirmation, setConfirmation] = useState<{ isOpen: boolean; title: string; description: string; onConfirm: () => void; } | null>(null);

    const { toast } = useToast();

    const onUpdateStatus = (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => {
        if (!firestore || !tenantId) return;
        const targetRef = isWalkIn 
            ? doc(firestore, 'tenants', tenantId, 'walkIns', id)
            : doc(firestore, 'tenants', tenantId, 'appointments', id);
        
        const updateData: any = { checkInStatus: status };
        if (lateMinutes !== undefined) updateData.lateTimeMinutes = lateMinutes;
        
        updateDocumentNonBlocking(targetRef, updateData);
        toast({ title: "Status Updated" });
    };

    const handleSelectAppointment = useCallback((id: string) => {
        setSelectedAppointmentIds(prev => {
            const next = new Set(prev);
            if (prev.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const handleSkip = (walkInId: string) => {
        if (!firestore || !tenantId) return;
        const walkIn = walkIns?.find(w => w.id === walkInId);
        const batch = writeBatch(firestore);
        batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'skipped' });
        if (walkIn?.assignedStaffId) {
            batch.set(doc(firestore, 'tenants', tenantId, 'staff', walkIn.assignedStaffId), { status: 'idle' }, { merge: true });
            batch.update(doc(firestore, 'tenants', tenantId, 'appointments', `apt-walkin-${walkInId}`), { status: 'cancelled', cancellationReason: 'no-show' });
        }
        batch.commit().then(() => toast({ title: "Guest Skipped" }));
    };

    const handleReturnToQueue = (walkInId: string) => {
        if (!firestore || !tenantId) return;
        const walkIn = walkIns?.find(w => w.id === walkInId);
        const batch = writeBatch(firestore);
        batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'waiting', assignedStaffId: deleteField(), notifiedTimestamp: deleteField() });
        if (walkIn?.assignedStaffId) {
            batch.set(doc(firestore, 'tenants', tenantId, 'staff', walkIn.assignedStaffId), { status: 'idle' }, { merge: true });
            batch.delete(doc(firestore, 'tenants', tenantId, 'appointments', `apt-walkin-${walkInId}`));
        }
        batch.commit().then(() => toast({ title: "Returned to Queue" }));
    };

    const handleRevertToReady = (appointmentId: string) => {
        if (!firestore || !tenantId) return;
        const walkInId = appointmentId.replace('apt-walkin-', '');
        const batch = writeBatch(firestore);
        batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'notified', serviceStartTime: deleteField() });
        batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { status: 'confirmed', actualStartTime: deleteField() });
        const apt = appointmentsFromInventory?.find(a => a.id === appointmentId);
        if (apt?.staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', apt.staffId), { status: 'idle' }, { merge: true });
        batch.commit().then(() => toast({ title: "Reverted to Ready" }));
    };

    const handleRevertToService = (appointmentId: string) => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { status: 'servicing', actualEndTime: deleteField() });
        const apt = appointmentsFromInventory?.find(a => a.id === appointmentId);
        if (apt?.staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', apt.staffId), { status: 'busy' }, { merge: true });
        if (apt?.isWalkIn) batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', appointmentId.replace('apt-walkin-', '')), { status: 'servicing' });
        batch.commit().then(() => { setSelectedAppointmentIds(prev => { const next = new Set(prev); next.delete(appointmentId); return next; }); toast({ title: "Reverted" }); });
    };

    const handleForceIdle = (staffId: string) => {
        if (!firestore || !tenantId) return;
        const staffRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
        setDocumentNonBlocking(staffRef, { status: 'idle' }, { merge: true });
        toast({ title: "Staff Reset", description: "Technician is now marked as idle." });
    };

    const handleResolve = (item: any) => {
        if (item.type === 'walk-in') {
            const ghostApt: Partial<Appointment> = { id: `walkin-resolve-${item.id}`, clientName: item.customerName, clientId: item.clientId || item.id, serviceId: item.serviceIds[0], status: 'confirmed', isWalkIn: true, matchedClientId: item.matchedClientId, startTime: item.checkInTime, endTime: item.checkInTime };
            setSelectedAppointment(ghostApt as Appointment);
            setIsDetailsOpen(true);
        } else { setSelectedAppointment(item); setIsDetailsOpen(true); }
    };

    const handleCancelAction = (id: string, isWalkIn: boolean) => {
        if (!isWalkIn) { setSelectedAppointment(appointmentsFromInventory?.find(a => a.id === id) || null); setIsCancelDialogOpen(true); return; }
        setConfirmation({
            isOpen: true, title: 'Are you sure?', description: 'This will remove the guest from the queue.',
            onConfirm: async () => {
                if (!firestore || !tenantId) return;
                await updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', id), { status: 'cancelled' });
                toast({ title: "Walk-in Removed" });
                setConfirmation(null);
            }
        });
    };

    const handlePrintTicket = (walkInId: string) => {
        const walkIn = walkIns?.find(w => w.id === walkInId);
        if (walkIn) {
            setTicketToPrint({
                id: walkIn.id,
                name: walkIn.customerName,
                services: (walkIn.serviceIds || []).map(id => services?.find(s => s.id === id)).filter((s): s is Service => !!s),
                queuePosition: (walkIns?.filter(w => w.status === 'waiting').sort((a,b) => (a.queueOrder || 0) - (b.queueOrder || 0)).findIndex(w => w.id === walkInId) || 0) + 1,
                checkInTime: walkIn.checkInTime,
            });
            setIsPrintDialogOpen(true);
        }
    };

    const handleStaffReorder = (newOrder: Staff[]) => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        newOrder.forEach((s, i) => { batch.set(doc(firestore, 'tenants', tenantId, 'staff', s.id), { turnOrder: i }, { merge: true }); });
        batch.commit().catch(err => { toast({ variant: 'destructive', title: "Error", description: "Could not save new staff order." }); });
    };

    const handleReorderWalkIns = (newOrder: WalkIn[]) => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        const now = Date.now();
        newOrder.forEach((w, i) => { batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', w.id), { queueOrder: now + i }); });
        batch.commit().catch(err => { toast({ variant: 'destructive', title: "Error", description: "Could not save new queue order." }); });
    };

    const handleAssignStaff = (walkIn: WalkIn, staffId: string) => {
      if (!firestore || !tenantId || !services) return;
      const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkIn.id);
      updateDocumentNonBlocking(walkInRef, { assignedStaffId: staffId, status: 'notified', notifiedTimestamp: new Date().toISOString() });
      const personServices = (walkIn.serviceIds || []).map(id => services.find(s => s.id === id)).filter(Boolean) as Service[];
      const duration = personServices.reduce((acc, s) => acc + s.duration, 0);
      const appointmentId = `apt-walkin-${walkIn.id}`;
      setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { id: appointmentId, tenantId, clientId: walkIn.clientId || walkIn.id, clientName: walkIn.customerName, serviceId: walkIn.serviceIds[0], staffId, status: 'confirmed', source: 'walk-in', isWalkIn: true, startTime: new Date().toISOString(), endTime: addMinutes(new Date(), duration).toISOString() }, {});
      toast({ title: "Staff Assigned" });
    };

    const handleAssignNext = () => {
        if (!staff || !walkIns || !services) return;
        const notifiedStaffIds = new Set(walkIns.filter(w => w.status === 'notified').map(w => w.assignedStaffId));
        const idleStaff = staff.filter(s => s.active && !s.onBreak && (s.status === 'idle' || !s.status) && !notifiedStaffIds.has(s.id)).sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
        const waitingClients = (walkIns || []).filter(w => w.status === 'waiting').sort((a, b) => (a.queueOrder || 0) - (b.queueOrder || 0));
        if (idleStaff.length === 0 || waitingClients.length === 0) return;
        for (const staffMember of idleStaff) {
            for (const client of waitingClients) {
                const reqSkills = [...new Set(services?.filter(s => client.serviceIds.includes(s.id)).flatMap(s => s.requiredSkills || []))];
                if (reqSkills.every(skill => (staffMember.skillSet || []).includes(skill))) {
                    handleAssignStaff(client, staffMember.id);
                    return;
                }
            }
        }
    };

    const handleStartService = (appointmentId: string) => {
      if (!firestore || !tenantId || !appointmentsFromInventory) return;
      const appointment = appointmentsFromInventory.find(a => a.id === appointmentId) || appointmentsFromInventory.find(a => a.id === `apt-walkin-${appointmentId}`);
      if (!appointment) return;
      const nowISO = new Date().toISOString();
      const batch = writeBatch(firestore);
      batch.set(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { status: 'servicing', actualStartTime: nowISO }, { merge: true });
      if (appointment.checkInToken) batch.set(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'servicing', tenantId }, { merge: true });
      if (appointment.staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId), { status: 'busy' }, { merge: true });
      if (appointment.isWalkIn) {
          const walkInId = appointment.id.replace('apt-walkin-', '');
          batch.set(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'servicing', serviceStartTime: nowISO }, { merge: true });
      }
      batch.commit().then(() => toast({ title: "Service Started" }));
    };

    const handleFinishService = (apt: Appointment) => {
        setAppointmentToReview(apt);
        setIsTechnicianReviewOpen(true);
    };

    const handleAddToCart = useCallback((item: any) => {
        setRetailItems(prev => {
            const existing = prev.find(i => i.id === item.id);
            if (existing) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
            let price = 0;
            let type: 'product' | 'service' | 'membership' | 'package' = 'product';
            if ('msrp' in item) { price = item.msrp || item.costPerUnit || 0; type = 'product'; }
            else if ('duration' in item) { price = item.price || 0; type = 'service'; }
            else if ('interval' in item) { price = item.price || 0; type = 'membership'; }
            else if ('sessions' in item) { price = item.price || 0; type = 'package'; }
            return [...prev, { id: item.id, name: item.name, quantity: 1, price, type, imageUrl: item.imageUrl, stock: item.totalStock }];
        });
    }, []);

    const kpiData = useMemo(() => {
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        const walkInsToday = (walkIns || []).filter(w => {
            const checkInDate = safeDate(w.checkInTime);
            return checkInDate >= todayStart && checkInDate <= todayEnd;
        });

        const completedWalkIns = walkInsToday.filter(w => w.status === 'completed' && w.serviceStartTime);
        const waitTimes = completedWalkIns.map(w => differenceInMinutes(safeDate(w.serviceStartTime), safeDate(w.checkInTime)));
        const avgWaitTime = waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0;

        const terminalWalkIns = walkInsToday.filter(w => ['completed', 'skipped', 'cancelled'].includes(w.status));
        const conversionRate = terminalWalkIns.length > 0 ? (completedWalkIns.length / terminalWalkIns.length) * 100 : 0;

        const totalInServiceMinutes = (appointmentsFromInventory || []).filter(apt => 
            isSameDay(safeDate(apt.startTime), new Date()) && apt.status === 'completed'
        ).reduce((acc, apt) => {
             if (apt.actualStartTime && apt.actualEndTime) {
                return acc + differenceInMinutes(safeDate(apt.actualEndTime), safeDate(apt.actualStartTime));
             }
             const service = services?.find(s => s.id === apt.serviceId);
             return acc + (service?.duration || 0);
        }, 0);

        const totalServiceRevenue = (transactions || []).filter(t => {
            const transactionDate = safeDate(t.date);
            return t.category === 'Service Revenue' && isSameDay(transactionDate, new Date());
        }).reduce((acc, t) => acc + t.amount, 0);

        const revenuePerServiceHour = totalInServiceMinutes > 0 ? (totalServiceRevenue / (totalInServiceMinutes / 60)) : 0;

        return {
            avgWaitTime,
            walkInConversionRate: conversionRate,
            totalWalkIns: walkInsToday.length,
            revenuePerServiceHour,
        };
    }, [walkIns, appointmentsFromInventory, transactions, services]);

    const handleCheckout = async (paymentDetails: { paymentMethod: string; amountTendered?: number }) => {
        // Implementation here
    };

    const readyForCheckoutAppointments = useMemo(() => {
        if (!appointmentsFromInventory || !clients || !services || !staff) return [];
        return appointmentsFromInventory
            .filter(apt => apt.status === 'ready_for_checkout')
            .map(apt => {
                const client = clients.find(c => c.id === apt.clientId);
                const service = services.find(s => s.id === apt.serviceId);
                const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
                const staffMember = staff.find(s => s.id === apt.staffId);
                return { ...apt, client, service, addOnServices, staff: staffMember };
            }).filter((a): a is Appointment & { client: Client, service: Service, addOnServices: Service[], staff: Staff } => !!(a.client && a.service));
    }, [appointmentsFromInventory, clients, services, staff]);

    const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
        if (!firestore || !tenantId) return;
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
        const apt = appointmentsFromInventory?.find(a => a.id === appointmentId);
        if (!apt) return;
        const totalServicesCount = 1 + (apt.addOnIds?.length || 0);
        const completedIds = checkoutState.completedServiceIds || [];
        const allComplete = completedIds.length >= totalServicesCount;
        const batch = writeBatch(firestore);
        if (allComplete) {
            batch.update(appointmentRef, { status: 'ready_for_checkout', checkoutState, actualEndTime: new Date().toISOString() });
            if (apt.checkInToken) batch.set(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'ready_for_checkout', tenantId }, { merge: true });
        } else {
            batch.update(appointmentRef, { checkoutState });
        }
        if (currentUser) batch.set(doc(firestore, 'tenants', tenantId, 'staff', currentUser.uid), { status: 'idle' }, { merge: true });
        batch.commit().then(() => { toast({ title: allComplete ? "Service Finished" : "Part Completed" }); setIsTechnicianReviewOpen(false); });
    };

    const checkoutHubProps = {
        cart: retailItems, onCartChange: setRetailItems,
        appointmentsData: Array.from(selectedAppointmentIds).map(id => readyForCheckoutAppointments.find(a => a.id === id)).filter(Boolean) as any,
        onSelectAppointment: handleSelectAppointment, clients: clients || [], isGroupCheckout: selectedAppointmentIds.size > 1,
        payerOptions: (clients || []).filter(c => Array.from(selectedAppointmentIds).some(id => readyForCheckoutAppointments.find(a => a.id === id)?.client.id === c.id)),
        selectedClientId, setSelectedClientId, onAddClientClick: () => setIsAddClientOpen(true), onScanClick: () => setIsScannerOpen(true),
        subtotal: 0, tax: 0, total: 0, tipAmount, setTipAmount, onCheckout: handleCheckout,
        appliedDiscountCodes: [], setAppliedDiscountCodes: () => {}, discount: 0, membershipDiscount: 0,
        isSubmitting, paymentTab, setPaymentTab, discounts: discounts || [], amountTendered, setAmountTendered,
        appliedAdjustments: new Set<string>(), onApplyAdjustmentToggle: () => {},
        redeemedOffer: null, setRedeemedOffer: () => {}, memberships: memberships || [], packages: packages || [], allowStacking: selectedTenant?.allowDiscountStacking || false, showTitle: false,
        waivedAppointmentFees: waivedAppointmentFees, onWaiveFeeToggle: handleWaiveFeeToggle,
        tipAllocations: tipAllocations,
    };

    const todayAppointments = useMemo(() => {
        const today = startOfDay(new Date());
        return (appointmentsFromInventory || []).filter(a => isSameDay(safeDate(a.startTime), today));
    }, [appointmentsFromInventory]);

    return (
        <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950">
            <AppHeader />
            <div className="flex-1 grid lg:grid-cols-[1fr,400px] overflow-hidden">
                <main className="flex-1 flex flex-col overflow-auto p-4 md:p-6 lg:p-8 gap-8 pb-24 lg:pb-8">
                    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                        <KpiCard title="Avg. Wait Time" value={`${kpiData.avgWaitTime.toFixed(0)} min`} icon={<Clock className="text-blue-500" />} iconBgColor="bg-blue-100 dark:bg-blue-900/50" description="Check-in to service." />
                        <KpiCard title="Walk-in Conversion" value={`${kpiData.walkInConversionRate.toFixed(0)}%`} icon={<TrendingUp className="text-green-500"/>} iconBgColor="bg-green-100 dark:bg-green-900/50" description="Check-in to chair rate." />
                        <KpiCard title="Today's Volume" value={kpiData.totalWalkIns.toString()} icon={<Users className="text-purple-500"/>} iconBgColor="bg-purple-100 dark:bg-purple-900/50" description="Total check-ins today." />
                        <KpiCard title="Revenue / Hour" value={`$${kpiData.revenuePerServiceHour.toFixed(2)}`} icon={<DollarSign className="text-amber-500"/>} iconBgColor="bg-amber-100 dark:bg-amber-900/50" description="Rev per service hour." />
                    </div>

                    <TeamStatus staff={staff} onStatusChange={(id, act) => { setPendingStatusAction({ staffId: id, action: act }); setIsPinAuthOpen(true); }} appointments={todayAppointments} services={services} onReorder={handleStaffReorder} assignmentMode={assignmentMode} onAssignmentModeChange={setAssignmentMode} resources={resources || []} onForceIdle={handleForceIdle} />
                    <WalkInQueue walkIns={walkIns} appointments={todayAppointments} readyForCheckoutAppointments={readyForCheckoutAppointments} selectedAppointmentIds={selectedAppointmentIds} onSelectAppointment={handleSelectAppointment} services={services} staff={staff} onAssignStaff={handleAssignStaff} onAssignNext={handleAssignNext} onCancel={handleCancelAction} onStartService={handleStartService} orderedWaitingQueue={[]} onReorder={handleReorderWalkIns} assignmentMode={assignmentMode} onPrintTicket={handlePrintTicket} onSkip={handleSkip} onReturnToQueue={handleReturnToQueue} groupSizes={new Map()} onToggleWaitForStaff={() => {}} onScanClick={() => setIsScannerOpen(true)} onFinishService={handleFinishService} onUpdateStatus={onUpdateStatus} onRevertToReady={handleRevertToReady} onRevertToService={handleRevertToService} onResolve={handleResolve} />
                    <RetailCatalog services={services || []} inventory={inventory || []} memberships={memberships || []} packages={packages || []} onAddToCart={handleAddToCart} onScanClick={() => setIsScannerOpen(true)} />
                </main>
                <aside className="hidden lg:flex border-l bg-card p-4 lg:p-6 flex-col h-full overflow-y-auto"><CheckoutHub {...checkoutHubProps} /></aside>
            </div>
            {isMobile && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-sm lg:hidden z-40">
                    <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                        <SheetTrigger asChild><Button className="w-full h-14">View Cart</Button></SheetTrigger>
                        <SheetContent side="bottom" className="h-[90vh] p-0 flex flex-col">
                            <SheetHeader className="p-4 border-b">
                                <SheetTitle>Current Sale</SheetTitle>
                            </SheetHeader>
                            <div className="p-4 flex-1 overflow-y-auto">
                                <CheckoutHub {...checkoutHubProps} />
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            )}
            <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={() => {}} />
            
            <AppointmentDetailsSheet 
                open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={selectedAppointment}
                client={clients?.find(c => c.id === selectedAppointment?.clientId) || null}
                service={services?.find(s => s.id === selectedAppointment?.serviceId) || null}
                tmhr={selectedTenant?.tmhr || 50} transactions={transactions || []}
                onStartService={handleStartService}
                onFinishService={handleFinishService}
                onEdit={() => {}}
                onDelete={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
                onCancel={handleCancelAction}
                onReschedule={() => {}}
                onRebook={() => {}}
                onBookNewForClient={() => {}}
                onPrintTicket={() => {}}
                onOverride={() => setIsOverrideOpen(true)}
                onWaiveFee={() => {}}
            />

            {selectedAppointment && (
                <CancelAppointmentDialog
                    open={isCancelDialogOpen}
                    onOpenChange={setIsCancelDialogOpen}
                    appointment={selectedAppointment}
                    tenant={selectedTenant}
                    onConfirm={async (data) => {
                        const batch = writeBatch(firestore!);
                        batch.update(doc(firestore!, 'tenants', tenantId!, 'appointments', selectedAppointment.id), { status: 'cancelled', cancellationReason: data.reason });
                        await batch.commit();
                        setIsCancelDialogOpen(false);
                    }}
                />
            )}

            <OverrideCancellationDialog 
                open={isOverrideOpen}
                onOpenChange={setIsOverrideOpen}
                staff={staff || []}
                onConfirm={async (sid, res) => {
                    const appointmentRef = doc(firestore!, 'tenants', tenantId!, 'appointments', selectedAppointment!.id);
                    updateDocumentNonBlocking(appointmentRef, { status: 'confirmed', checkInStatus: 'pending', overrideReason: res, overriddenBy: sid });
                    setIsOverrideOpen(false);
                    setIsDetailsOpen(false);
                }}
            />

            {appointmentToReview && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: appointmentToReview, client: clients?.find(c => c.id === appointmentToReview.clientId), service: services?.find(s => s.id === appointmentToReview.serviceId) }} staff={staff || []} onSendToFrontDesk={handleSendToFrontDesk} />}
            <Dialog open={isPinAuthOpen} onOpenChange={setIsPinAuthOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Authorize Action</DialogTitle></DialogHeader><div className="py-6 flex flex-col items-center gap-4"><Input type="password" value={authPin} onChange={e => setAuthPin(e.target.value)} maxLength={4} className="text-center text-3xl font-black h-16 w-48" /></div><DialogFooter><Button onClick={() => {
                const target = staff?.find(s => s.pin === authPin);
                if (target && pendingStatusAction) {
                    const { staffId, action } = pendingStatusAction;
                    const activityLogsRef = collection(firestore!, 'tenants', tenantId!, 'activityLogs');
                    const staffDocRef = doc(firestore!, 'tenants', tenantId!, 'staff', staffId);
                    const now = new Date().toISOString();
                    let staffUpdate: Partial<Staff> = {};
                    let logEntry: any = { staffId, type: action, timestamp: now };
                    switch (action) {
                        case 'clock_in': staffUpdate = { active: true }; break;
                        case 'clock_out': staffUpdate = { active: false, onBreak: false, status: 'idle' }; break;
                        case 'break_start': staffUpdate = { onBreak: true, breakStartTime: now }; break;
                        case 'break_end': if(target.breakStartTime) logEntry.durationMinutes = differenceInMinutes(parseISO(now), parseISO(target.breakStartTime)); staffUpdate = { onBreak: false, breakStartTime: deleteField() as any }; break;
                    }
                    addDocumentNonBlocking(activityLogsRef, logEntry);
                    setDocumentNonBlocking(staffDocRef, staffUpdate, { merge: true });
                    setIsPinAuthOpen(false); setAuthPin(''); setPendingStatusAction(null);
                } else toast({ variant: 'destructive', title: 'Invalid PIN' });
            }}>Confirm</Button></DialogFooter></DialogContent></Dialog>
            
            <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
              <DialogContent className="sm:max-w-md p-0">
                <DialogHeader className="p-4 pb-0"><DialogTitle>Scan QR Code</DialogTitle></DialogHeader>
                <div className="p-4 relative">
                  <div id="qr-reader-pos" className="w-full rounded-md bg-muted" />
                  <div className="absolute inset-4 flex items-center justify-center pointer-events-none"><div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" /></div>
                </div>
                <DialogFooter className="p-4 pt-0"><Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Cancel</Button></DialogFooter>
              </DialogContent>
            </Dialog>
        </div>
    );
}

export default function POSPage() { return <Suspense fallback={<div>Loading...</div>}><POSPageContent /></Suspense> }
