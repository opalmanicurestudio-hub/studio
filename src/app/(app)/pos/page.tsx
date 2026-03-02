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
import { Button } from '@/components/ui/button';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, query, where, deleteField } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, startOfDay, endOfDay, addMinutes, isSameDay } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Clock, TrendingUp, Users, DollarSign, QrCode, Loader, MessageSquare, Play, XCircle, Fingerprint } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
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
    const { inventory, services, appointments: appointmentsFromInventory, clients, walkIns, staff, transactions, discounts, memberships, packages, resources } = useInventory();
    const { firestore, user: currentUser } = useFirebase();
    const { selectedTenant, role } = useTenant();
    const tenantId = selectedTenant?.id;
    const router = useRouter();
    const isMobile = useIsMobile();

    const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<Set<string>>(new Set());
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [retailItems, setRetailItems] = useState<any[]>([]);
    const [tipAmount, setTipAmount] = useState(0);
    const [tipAllocations, setTipAllocations] = useState<Record<string, number>>({});
    const [paymentTab, setPaymentTab] = useState('card');
    const [amountTendered, setAmountTendered] = useState<number>(0);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isAddClientOpen, setIsAddClientOpen] = useState(false);
    
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
    const [isOverrideOpen, setIsOverrideOpen] = useState(false);
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
    const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);
    const [isPinAuthOpen, setIsPinAuthOpen] = useState(false);

    const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
    const [appointmentToReview, setAppointmentToReview] = useState<Appointment | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const [authPin, setAuthPin] = useState('');
    const [pendingStatusAction, setPendingStatusAction] = useState<{ staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' } | null>(null);

    const [assignmentMode, setAssignmentMode] = useState<'fair_play' | 'ordered_list'>('ordered_list');
    const [confirmation, setConfirmation] = useState<{ isOpen: boolean; title: string; description: string; onConfirm: () => void; } | null>(null);

    const { toast } = useToast();

    const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
    const [appliedAdjustments, setAppliedAdjustments] = useState<Set<string>>(new Set());
    const [redeemedOffer, setRedeemedOffer] = useState<{ type: 'membership' | 'package' | 'retail_discount'; id: string } | null>(null);
    const [waivedAppointmentFees, setWaivedAppointmentFees] = useState<Map<string, { authorizerId: string; reason: string }>>(new Map());

    const readyForCheckoutAppointments = useMemo(() => {
        if (!appointmentsFromInventory || !clients || !services || !staff) return [];
        return appointmentsFromInventory
            .filter(apt => apt.status === 'ready_for_checkout')
            .map(apt => {
                const client = clients.find(c => c.id === apt.clientId);
                const service = services.find(s => s.id === apt.serviceId);
                const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
                const staffMember = staff.find(s => s.id === apt.staffId);
                return { 
                    id: apt.id,
                    appointment: apt,
                    client, 
                    service, 
                    addOnServices, 
                    staff: staffMember 
                };
            }).filter((a): a is any => !!(a.client && a.service));
    }, [appointmentsFromInventory, clients, services, staff]);

    const handleSelectAppointment = useCallback((id: string) => {
        setSelectedAppointmentIds(prev => {
            const next = new Set(prev);
            let targetClientId = selectedClientId;
            
            if (prev.has(id)) {
                next.delete(id);
                if (next.size === 0) targetClientId = null;
            } else {
                next.add(id);
                const aptData = readyForCheckoutAppointments.find(a => a.id === id);
                if (aptData?.client?.id) {
                    targetClientId = aptData.client.id;
                }
            }
            setSelectedClientId(targetClientId);
            return next;
        });
    }, [readyForCheckoutAppointments, selectedClientId]);

    const selectedAptsData = useMemo(() => 
        Array.from(selectedAppointmentIds)
            .map(id => readyForCheckoutAppointments.find(a => a.id === id))
            .filter(Boolean) as any[]
    , [selectedAppointmentIds, readyForCheckoutAppointments]);

    const subtotal = useMemo(() => {
        const servicesSub = selectedAptsData.reduce((acc, data) => {
            const mainPrice = getServicePrice(service, data.staff);
            const addonsPrice = (data.addOnServices || []).reduce((sum: number, s: any) => sum + getServicePrice(s, data.staff), 0);
            
            const additional = (data.appointment.checkoutState?.additionalCharge || 0);
            const isWaived = waivedAppointmentFees.has(data.appointment.id);
            const effectiveAdditional = isWaived ? 0 : additional;

            return acc + mainPrice + addonsPrice + effectiveAdditional;
        }, 0);
        
        const retailSub = retailItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        
        const adjustmentSub = Array.from(appliedAdjustments).reduce((acc, id) => {
            const allFees = (clients || []).flatMap(c => c.unpaidFees || []);
            const fee = allFees.find(f => f.feeId === id);
            return acc + (fee?.feeAmount || 0);
        }, 0);

        return servicesSub + retailSub + adjustmentSub;
    }, [selectedAptsData, retailItems, appliedAdjustments, clients, waivedAppointmentFees]);

    const discount = useMemo(() => {
        return appliedDiscountCodes.reduce((acc, code) => {
            const d = (discounts || []).find(dis => dis.code.toUpperCase() === code.toUpperCase());
            if (!d) return acc;
            return acc + (d.type === 'percentage' ? subtotal * (d.value / 100) : d.value);
        }, 0);
    }, [appliedDiscountCodes, discounts, subtotal]);

    const membershipDiscount = useMemo(() => {
        if (!selectedClientId || !clients || !memberships) return 0;
        const client = clients.find(c => c.id === selectedClientId);
        const mId = client?.activeMembershipId || client?.subscription?.membershipId;
        if (!mId) return 0;
        const membership = memberships.find(m => m.id === mId);
        if (!membership?.retailDiscount) return 0;
        
        const retailSub = retailItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        return retailSub * (membership.retailDiscount / 100);
    }, [selectedClientId, clients, memberships, retailItems]);

    const tax = useMemo(() => (subtotal - discount - membershipDiscount) * 0.07, [subtotal, discount, membershipDiscount]);
    const total = useMemo(() => Math.max(0, subtotal - discount - membershipDiscount + tax + tipAmount), [subtotal, discount, membershipDiscount, tax, tipAmount]);

    const handleSkip = (walkInId: string) => {
        if (!firestore || !tenantId) return;
        const walkIn = walkIns?.find(w => w.id === walkInId);
        const batch = writeBatch(firestore);
        batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'skipped' });
        if (walkIn?.assignedStaffId) {
            const staffRef = doc(firestore, 'tenants', tenantId, 'staff', walkIn.assignedStaffId);
            batch.set(staffRef, { status: 'idle' }, { merge: true });
            const aptRef = doc(firestore, 'tenants', tenantId, 'appointments', `apt-walkin-${walkInId}`);
            batch.update(aptRef, { status: 'cancelled', cancellationReason: 'no-show' });
        }
        batch.commit().then(() => toast({ title: "Guest Skipped" }));
    };

    const handleReturnToQueue = (walkInId: string) => {
        if (!firestore || !tenantId) return;
        const walkIn = walkIns?.find(w => w.id === walkInId);
        const batch = writeBatch(firestore);
        batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'waiting', assignedStaffId: deleteField(), notifiedTimestamp: deleteField() });
        if (walkIn?.assignedStaffId) {
            const staffRef = doc(firestore, 'tenants', tenantId, 'staff', walkIn.assignedStaffId);
            batch.set(staffRef, { status: 'idle' }, { merge: true });
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
        batch.commit().then(() => { 
            setSelectedAppointmentIds(prev => { const next = new Set(prev); next.delete(appointmentId); return next; }); 
            toast({ title: "Reverted to In-Service" }); 
        });
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

    const handleForceIdle = (staffId: string) => {
        if (!firestore || !tenantId) return;
        const staffRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
        setDocumentNonBlocking(staffRef, { status: 'idle' }, { merge: true });
        toast({ title: "Staff Reset", description: "Technician is now marked as idle." });
    };

    const handleUpdateStatus = (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => {
        if (!firestore || !tenantId) return;
        const docRef = isWalkIn ? doc(firestore, 'tenants', tenantId, 'walkIns', id) : doc(firestore, 'tenants', tenantId, 'appointments', id);
        const updates: any = { checkInStatus: status };
        if (lateMinutes !== undefined) updates.lateTimeMinutes = lateMinutes;
        updateDocumentNonBlocking(docRef, updates);
        toast({ title: "Status Updated" });
    };

    const handleResolve = (item: any) => {
        setSelectedAppointment(item);
        setIsDetailsOpen(true);
    };

    const handlePrintTicket = (walkInId: string) => {
        const walkIn = walkIns?.find(w => w.id === walkInId);
        if (walkIn) {
            toast({ title: "Printing Ticket...", description: "Simulating hardware call." });
        }
    };

    const handleStaffReorder = (newOrder: Staff[]) => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        newOrder.forEach((s, idx) => {
            batch.set(doc(firestore, 'tenants', tenantId, 'staff', s.id), { turnOrder: idx }, { merge: true });
        });
        batch.commit();
    };

    const handleAssignNext = () => {
        const waiting = walkIns?.filter(w => w.status === 'waiting').sort((a,b) => (a.queueOrder || 0) - (b.queueOrder || 0));
        const idle = staff?.filter(s => s.active && !s.onBreak && s.status === 'idle');
        if (waiting?.length && idle?.length) {
            handleAssignStaff(waiting[0], idle[0].id);
        }
    };

    const handleFinishService = (apt: Appointment) => {
        setAppointmentToReview(apt);
        setIsTechnicianReviewOpen(true);
    };

    const handleCheckout = async () => {
        if (!selectedClientId || !firestore || !tenantId) return;
        setIsSubmitting(true);

        const batch = writeBatch(firestore);
        const now = new Date().toISOString();
        const selectedClient = clients?.find(c => c.id === selectedClientId);

        // 1. Process Appointments
        for (const aptData of selectedAptsData) {
            const { appointment: apt, service, addOnServices, staff: tech } = aptData;
            const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', apt.id);
            
            // Formula & Inventory Deduction (Accurate Ledger Integration)
            const formula = apt.checkoutState?.formula || [];
            formula.forEach(item => {
                const productRef = doc(firestore, 'tenants', tenantId, 'inventory', item.id);
                const product = inventory.find(p => p.id === item.id);
                if (product?.costingMethod === 'uses') {
                    batch.update(productRef, { partialContainerUses: increment(-item.quantity) });
                } else if (product?.costingMethod === 'size') {
                    batch.update(productRef, { partialContainerSize: increment(-item.quantity) });
                } else {
                    batch.update(productRef, { totalStock: increment(-item.quantity) });
                }

                // Add to Inventory Ledger
                const scRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
                batch.set(scRef, {
                    productId: item.id,
                    date: now,
                    change: -item.quantity,
                    unit: item.unit || 'units',
                    reason: `Appointment for ${selectedClient?.name || 'Guest'}`,
                });
            });

            const mainPrice = getServicePrice(service, tech);
            const addOnsPrice = addOnServices.reduce((sum, s) => sum + getServicePrice(s, tech), 0);
            const additional = !waivedAppointmentFees.has(apt.id) ? (apt.checkoutState?.additionalCharge || 0) : 0;
            const itemRevenue = mainPrice + addOnsPrice + additional;

            batch.update(appointmentRef, { 
                status: 'completed', 
                revenue: itemRevenue,
                actualEndTime: now
            });

            if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'completed' });
            
            // Log Service Revenue (Per Staff)
            const serviceTxnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
            batch.set(serviceTxnRef, {
                date: now,
                description: `Service: ${service.name} ${addOnServices.length > 0 ? `+ ${addOnServices.length} add-ons` : ''}`,
                clientOrVendor: selectedClient?.name || 'Client',
                clientId: selectedClientId,
                type: 'income',
                context: 'Business',
                category: 'Service Revenue',
                amount: itemRevenue,
                paymentMethod: paymentTab,
                staffId: tech.id,
                appointmentId: apt.id,
                hasReceipt: true
            });
        }

        // 2. Process Retail Items
        retailItems.forEach(item => {
            const retailTxnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
            batch.set(retailTxnRef, {
                date: now,
                description: `Retail: ${item.quantity}x ${item.name}`,
                clientOrVendor: selectedClient?.name || 'Client',
                clientId: selectedClientId,
                type: 'income',
                context: 'Business',
                category: 'Retail',
                amount: item.price * item.quantity,
                paymentMethod: paymentTab,
                hasReceipt: true
            });
            
            const productRef = doc(firestore, 'tenants', tenantId, 'inventory', item.id);
            batch.update(productRef, { totalStock: increment(-item.quantity) });

            // Add to Inventory Ledger for Retail Sale
            const scRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
            batch.set(scRef, {
                productId: item.id,
                date: now,
                change: -item.quantity,
                unit: 'units',
                reason: `Retail Sale to ${selectedClient?.name || 'Guest'}`,
            });
        });

        // 3. Log Tips (Accurate Allocation)
        Object.entries(tipAllocations).forEach(([staffId, amount]) => {
            if (amount > 0) {
                const tipTxnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
                batch.set(tipTxnRef, {
                    date: now,
                    description: 'Gratuity',
                    clientOrVendor: selectedClient?.name || 'Client',
                    clientId: selectedClientId,
                    type: 'income',
                    context: 'Business',
                    category: 'Tips',
                    amount: amount,
                    paymentMethod: paymentTab,
                    staffId: staffId,
                    hasReceipt: true
                });
            }
        });

        // 4. Log Discount Absorption (Marketing Expense)
        if (discount > 0) {
            const discountTxnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
            batch.set(discountTxnRef, {
                date: now,
                description: `Marketing Expense: ${appliedDiscountCodes.join(', ')}`,
                clientOrVendor: 'Internal',
                clientId: selectedClientId,
                type: 'expense',
                context: 'Business',
                category: 'Discounts',
                amount: discount,
                paymentMethod: 'Internal',
                hasReceipt: false
            });
        }

        try {
            await batch.commit();
            toast({ title: "Checkout Successful", description: "Inventory updated and transactions recorded." });
            setRetailItems([]);
            setSelectedAppointmentIds(new Set());
            setTipAmount(0);
            setAppliedDiscountCodes([]);
            setAppliedAdjustments(new Set());
        } catch (e) {
            console.error(e);
            toast({ variant: 'destructive', title: 'Checkout Failed' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const checkoutHubProps = {
        cart: retailItems, 
        onCartChange: setRetailItems,
        appointmentsData: selectedAptsData,
        onSelectAppointment: handleSelectAppointment, 
        clients: clients || [], 
        isGroupCheckout: selectedAppointmentIds.size > 1,
        payerOptions: (clients || []).filter(c => Array.from(selectedAppointmentIds).some(id => readyForCheckoutAppointments.find(a => a.id === id)?.client?.id === c.id)),
        selectedClientId, 
        setSelectedClientId, 
        onAddClientClick: () => setIsAddClientOpen(true), 
        onScanClick: () => setIsScannerOpen(true),
        subtotal, 
        tax, 
        total, 
        tipAmount, 
        setTipAmount, 
        onCheckout: handleCheckout,
        appliedDiscountCodes, 
        setAppliedDiscountCodes, 
        discount, 
        membershipDiscount,
        isSubmitting, 
        paymentTab, 
        setPaymentTab, 
        discounts: discounts || [], 
        amountTendered, 
        setAmountTendered,
        appliedAdjustments, 
        onApplyAdjustmentToggle: (id: string, apply: boolean) => setAppliedAdjustments(prev => { const next = new Set(prev); apply ? next.add(id) : next.delete(id); return next; }),
        redeemedOffer, 
        setRedeemedOffer, 
        memberships: memberships || [], 
        packages: packages || [], 
        allowStacking: selectedTenant?.allowDiscountStacking || false, 
        showTitle: false,
        waivedAppointmentFees, 
        onWaiveFeeToggle: (id: string, waive: boolean, authorizerId?: string, reason?: string) => onWaiveFeeToggle(id, waive, authorizerId, reason),
        tipAllocations,
    };

    const todayAppointments = useMemo(() => {
        const today = startOfDay(new Date());
        return (appointmentsFromInventory || []).filter(a => isSameDay(safeDate(a.startTime), today));
    }, [appointmentsFromInventory]);

    const selectedClient = useMemo(() => clients?.find(c => c.id === selectedClientId), [clients, selectedClientId]);

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
                    <WalkInQueue walkIns={walkIns} appointments={todayAppointments} readyForCheckoutAppointments={readyForCheckoutAppointments} selectedAppointmentIds={selectedAppointmentIds} onSelectAppointment={handleSelectAppointment} services={services} staff={staff} onAssignStaff={handleAssignStaff} onAssignNext={handleAssignNext} onCancel={handleCancelAction} onStartService={handleStartService} orderedWaitingQueue={[]} onReorder={() => {}} assignmentMode={assignmentMode} onPrintTicket={handlePrintTicket} onSkip={handleSkip} onReturnToQueue={handleReturnToQueue} groupSizes={new Map()} onToggleWaitForStaff={() => {}} onScanClick={() => setIsScannerOpen(true)} onFinishService={handleFinishService} onUpdateStatus={handleUpdateStatus} onRevertToReady={handleRevertToReady} onRevertToService={handleRevertToService} onResolve={handleResolve} />
                    <RetailCatalog services={services || []} inventory={inventory || []} memberships={memberships || []} packages={packages || []} onAddToCart={handleAddToCart} onScanClick={() => setIsScannerOpen(true)} />
                </main>
                <aside className="hidden lg:flex border-l bg-card p-4 lg:p-6 flex-col h-full overflow-y-auto"><CheckoutHub {...checkoutHubProps} /></aside>
            </div>
            {isMobile && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-sm lg:hidden z-40">
                    <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                        <SheetTrigger asChild><Button className="w-full h-14">View Cart (${total.toFixed(2)})</Button></SheetTrigger>
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
                    addDocumentNonBlocking(collection(firestore!, 'tenants', tenantId!, 'activityLogs'), logEntry);
                    setDocumentNonBlocking(staffDocRef, staffUpdate, { merge: true });
                    setIsPinAuthOpen(false); setAuthPin(''); setPendingStatusAction(null);
                } else toast({ variant: 'destructive', title: 'Invalid PIN' });
            }}>Confirm</Button></DialogFooter></Content></Dialog>
            
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