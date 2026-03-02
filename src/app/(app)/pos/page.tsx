
'use client';

import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, getServicePrice, type Discount, type Membership, type Package, type AppointmentCheckoutState, type StockCorrection } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from '@/components/ui/button';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
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
import { ShoppingCart, Clock, TrendingUp, Users, DollarSign, QrCode, Loader, MessageSquare, Play, Square, XCircle, Fingerprint, Printer } from 'lucide-react';
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
    const { inventory, services, appointments: appointmentsFromInventory, clients, walkIns, staff, transactions, activityLogs, discounts, memberships, packages } = useInventory();
    const { firestore, user: currentUser } = useFirebase();
    const { selectedTenant, role } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();
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

    const handleSkip = (walkInId: string) => {
        if (!firestore || !tenantId) return;
        updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'skipped' });
        toast({ title: "Guest Skipped" });
    };

    const handleReturnToQueue = (walkInId: string) => {
        if (!firestore || !tenantId) return;
        const walkIn = walkIns?.find(w => w.id === walkInId);
        const batch = writeBatch(firestore);
        
        batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { 
            status: 'waiting', 
            notifiedTimestamp: deleteField(), 
            assignedStaffId: deleteField() 
        });

        if (walkIn?.assignedStaffId) {
            batch.update(doc(firestore, 'tenants', tenantId, 'staff', walkIn.assignedStaffId), { 
                status: 'idle' 
            });
        }

        const aptId = `apt-walkin-${walkInId}`;
        batch.delete(doc(firestore, 'tenants', tenantId, 'appointments', aptId));
        
        batch.commit().then(() => toast({ title: "Guest Returned to Queue" }));
    };

    const handleRevertToReady = (appointmentId: string) => {
        if (!firestore || !tenantId) return;
        updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { status: 'confirmed' });
        if (appointmentId.startsWith('apt-walkin-')) {
            const walkInId = appointmentId.replace('apt-walkin-', '');
            updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'notified' });
        }
    };

    const handleRevertToService = (appointmentId: string) => {
        if (!firestore || !tenantId) return;
        updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { status: 'servicing' });
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

    useEffect(() => {
        const checkoutId = searchParams.get('checkout_id');
        const payerId = searchParams.get('payer_id');
        const action = searchParams.get('action');
        
        if (checkoutId) {
            handleSelectAppointment(checkoutId);
        }
        
        if (payerId && clients && clients.length > 0) {
            const client = clients.find(c => c.id === payerId);
            if (client) {
                setSelectedClientId(client.id);
                if (action === 'settle' && client.unpaidFees) {
                    const feeIds = client.unpaidFees.map(f => f.feeId);
                    setAppliedAdjustments(new Set(feeIds));
                    toast({ title: "Settlement Active", description: `Added ${feeIds.length} unpaid fee(s) to sale.` });
                }
            }
        }
    }, [searchParams, clients, toast, handleSelectAppointment]);

    const appointments = useMemo(() => appointmentsFromInventory || [], [appointmentsFromInventory]);
    const todayAppointments = useMemo(() => {
        const todayStart = startOfDay(new Date());
        return appointments.filter(apt => isSameDay(safeDate(apt.startTime), todayStart));
    }, [appointments]);

    const readyForCheckoutAppointments = useMemo(() => {
        if (!todayAppointments || !clients || !services || !staff) return [];
        return todayAppointments
            .filter(apt => apt.status === 'ready_for_checkout')
            .map(apt => {
                const client = clients.find(c => c.id === apt.clientId);
                const service = services.find(s => s.id === apt.serviceId);
                const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
                const staffMember = staff.find(s => s.id === apt.staffId);
                return { id: apt.id, appointment: apt, client, service, addOnServices, staff: staffMember };
            }).filter((a): a is { id: string, appointment: Appointment, client: Client, service: Service, addOnServices: Service[], staff: Staff } => !!(a.client && a.service));
    }, [todayAppointments, clients, services, staff]);

    const handleApplyAdjustmentToggle = useCallback((id: string, apply: boolean) => {
        setAppliedAdjustments(prev => {
            const next = new Set(prev);
            if (apply) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

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

    const rawSubtotal = useMemo(() => {
        const selectedApts = Array.from(selectedAppointmentIds)
            .map(id => readyForCheckoutAppointments.find(a => a.id === id))
            .filter(Boolean);
        
        const appointmentsRawSubtotal = selectedApts.reduce((acc, data) => {
            if (!data) return acc;
            const mainPrice = getServicePrice(data.service, data.staff);
            const addOnsPrice = data.addOnServices.reduce((sum, s) => sum + getServicePrice(s, data.staff), 0);
            const additional = waivedAppointmentFees.has(data.id) ? 0 : (data.appointment.checkoutState?.additionalCharge || 0);
            return acc + mainPrice + addOnsPrice + additional;
        }, 0);

        const cartRawSubtotal = retailItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        const adjustmentsRawSubtotal = Array.from(appliedAdjustments).reduce((acc, feeId) => {
            const client = clients.find(c => c.id === selectedClientId);
            const fee = client?.unpaidFees?.find(f => f.feeId === feeId);
            return acc + (fee?.feeAmount || 0);
        }, 0);

        return appointmentsRawSubtotal + cartRawSubtotal + adjustmentsRawSubtotal;
    }, [selectedAppointmentIds, readyForCheckoutAppointments, retailItems, appliedAdjustments, clients, selectedClientId, waivedAppointmentFees]);

    const financialCalcs = useMemo(() => {
        let dVal = 0;
        let mVal = 0;

        appliedDiscountCodes.forEach(code => {
            const disc = discounts.find(d => d.code === code);
            if (disc) {
                if (disc.type === 'percentage') dVal += rawSubtotal * (disc.value / 100);
                else dVal += disc.value;
            }
        });

        const membershipId = selectedClientId ? clients.find(c => c.id === selectedClientId)?.activeMembershipId : null;
        const activeMem = membershipId ? memberships.find(m => m.id === membershipId) : null;
        if (activeMem?.retailDiscount) {
            const retailSub = retailItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
            mVal = retailSub * (activeMem.retailDiscount / 100);
        }

        const subtotalAfterDiscounts = Math.max(0, rawSubtotal - (dVal + mVal));
        const tax = subtotalAfterDiscounts * 0.07;
        const total = subtotalAfterDiscounts + tax + tipAmount;

        return { discount: dVal, membershipDiscount: mVal, tax, total };
    }, [rawSubtotal, appliedDiscountCodes, discounts, selectedClientId, clients, memberships, retailItems, tipAmount]);

    const { discount, membershipDiscount, tax, total } = financialCalcs;

    const allInvolvedStaffIds = useMemo(() => {
        const ids = new Set<string>();
        Array.from(selectedAppointmentIds).forEach(id => {
            const data = readyForCheckoutAppointments.find(a => a.id === id);
            if (data) {
                if (data.appointment.staffId) ids.add(data.appointment.staffId);
                const overrides = data.appointment.checkoutState?.serviceStaffOverrides || {};
                Object.values(overrides).forEach(sid => {
                    if (sid) ids.add(sid);
                });
            }
        });
        return Array.from(ids);
    }, [selectedAppointmentIds, readyForCheckoutAppointments]);

    useEffect(() => {
        if (allInvolvedStaffIds.length > 0 && tipAmount > 0) {
            const splitAmount = Math.floor((tipAmount / allInvolvedStaffIds.length) * 100) / 100;
            const newAllocations: Record<string, number> = {};
            
            allInvolvedStaffIds.forEach((sid, index) => {
                if (index === allInvolvedStaffIds.length - 1) {
                    const currentSum = Object.values(newAllocations).reduce((a, b) => a + b, 0);
                    newAllocations[sid] = Math.max(0, parseFloat((tipAmount - currentSum).toFixed(2)));
                } else {
                    newAllocations[sid] = splitAmount;
                }
            });
            setTipAllocations(newAllocations);
        } else if (tipAmount === 0) {
            setTipAllocations({});
        }
    }, [tipAmount, allInvolvedStaffIds]);

    const handleCheckout = async (paymentDetails: { paymentMethod: string; amountTendered?: number }) => {
        if (!firestore || !tenantId) return;
        if (!selectedClientId && (selectedAppointmentIds.size > 0 || retailItems.length > 0)) {
            toast({ variant: 'destructive', title: 'Payer Required' });
            return;
        }
        setIsSubmitting(true);
        const batch = writeBatch(firestore);
        const now = new Date();
        const nowTimestamp = Timestamp.fromDate(now);
        const nowISO = now.toISOString();

        // Aggregated inventory updates
        const inventoryUpdates = new Map<string, { 
            totalStockChange: number, 
            partialSizeChange: number, 
            partialUsesChange: number 
        }>();

        try {
            for (const id of Array.from(selectedAppointmentIds)) {
                const data = readyForCheckoutAppointments.find(a => a.id === id);
                if (!data) continue;
                const { appointment } = data;
                const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointment.id);
                
                const waiver = waivedAppointmentFees.get(id);
                const updatePayload: any = { 
                    status: 'completed',
                    revenue: getServicePrice(data.service, data.staff) + data.addOnServices.reduce((sum, s) => sum + getServicePrice(s, data.staff), 0),
                    appliedDiscountCodes: appliedDiscountCodes.join(','),
                };
                if (waiver) {
                    updatePayload.cancellationFeeWaived = true;
                    updatePayload.waivedBy = waiver.authorizerId;
                    updatePayload.waivedReason = waiver.reason;
                    updatePayload.waivedAt = nowISO;
                }

                batch.update(appointmentRef, updatePayload);
                if (appointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'completed' });
                
                const formula = appointment.checkoutState?.formula || [];
                formula.forEach((p: any) => {
                    const item = inventory.find(i => i.id === p.id);
                    if (item) {
                        if (!inventoryUpdates.has(item.id)) {
                            inventoryUpdates.set(item.id, { totalStockChange: 0, partialSizeChange: 0, partialUsesChange: 0 });
                        }
                        const update = inventoryUpdates.get(item.id)!;
                        if (item.costingMethod === 'size') update.partialSizeChange -= p.quantity;
                        else if (item.costingMethod === 'uses') update.partialUsesChange -= p.quantity;
                        else update.totalStockChange -= p.quantity;
                        
                        const staffName = data.staff?.name || 'Unknown Staff';
                        const appointmentShortId = appointment.id.slice(-6).toUpperCase();

                        const correctionRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
                        batch.set(correctionRef, {
                            productId: item.id,
                            date: nowISO,
                            change: -p.quantity,
                            unit: item.unit || 'units',
                            reason: `Service: ${data.service.name} (#${appointmentShortId}) for ${data.client.name} by ${staffName}`
                        });
                    }
                });

                const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
                batch.set(txnRef, {
                    date: nowTimestamp,
                    description: `Service: ${data.service.name} for ${data.client.name}`,
                    clientOrVendor: data.client.name,
                    clientId: data.client.id,
                    type: 'income',
                    context: 'Business',
                    category: 'Service Revenue',
                    amount: updatePayload.revenue,
                    paymentMethod: paymentDetails.paymentMethod,
                    staffId: data.staff.id,
                    appointmentId: appointment.id,
                });
            }

            Object.entries(tipAllocations).forEach(([staffId, amount]) => {
                if (amount > 0) {
                    const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
                    batch.set(txnRef, {
                        date: nowTimestamp,
                        description: `Tip Allocation`,
                        clientOrVendor: selectedClient?.name || 'Various',
                        clientId: selectedClientId,
                        type: 'income',
                        context: 'Business',
                        category: 'Tips',
                        amount: amount,
                        paymentMethod: paymentDetails.paymentMethod,
                        staffId: staffId,
                        appointmentId: Array.from(selectedAppointmentIds)[0],
                    });
                }
            });

            retailItems.forEach(item => {
                if (!inventoryUpdates.has(item.id)) {
                    inventoryUpdates.set(item.id, { totalStockChange: 0, partialSizeChange: 0, partialUsesChange: 0 });
                }
                inventoryUpdates.get(item.id)!.totalStockChange -= item.quantity;
                
                const clientName = selectedClient?.name || 'Walk-in';
                const correctionRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
                batch.set(correctionRef, {
                    productId: item.id,
                    date: nowISO,
                    change: -item.quantity,
                    unit: 'units',
                    reason: `Retail Sale to ${clientName}`
                });

                const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
                batch.set(txnRef, {
                    date: nowTimestamp,
                    description: `Retail: ${item.quantity}x ${item.name}`,
                    clientOrVendor: clientName,
                    type: 'income',
                    context: 'Business',
                    category: 'Retail',
                    amount: item.price * item.quantity,
                    paymentMethod: paymentDetails.paymentMethod,
                });
            });

            // Apply aggregated inventory updates
            inventoryUpdates.forEach((changes, productId) => {
                const item = inventory.find(i => i.id === productId)!;
                const productRef = doc(firestore, `tenants/${tenantId}/inventory`, productId);
                
                let newTotalStock = item.totalStock + changes.totalStockChange;
                let newPartialSize = (item.partialContainerSize || 0) + changes.partialSizeChange;
                let newPartialUses = (item.partialContainerUses || 0) + changes.partialUsesChange;

                if (item.costingMethod === 'size') {
                    while (newPartialSize < 0 && newTotalStock > 0) { newTotalStock -= 1; newPartialSize += (item.size || 1); }
                    batch.update(productRef, { totalStock: newTotalStock, partialContainerSize: Math.max(0, newPartialSize) });
                } else if (item.costingMethod === 'uses') {
                    while (newPartialUses < 0 && newTotalStock > 0) { newTotalStock -= 1; newPartialUses += (item.estimatedUses || 1); }
                    batch.update(productRef, { totalStock: newTotalStock, partialContainerUses: Math.max(0, newPartialUses) });
                } else {
                    batch.update(productRef, { totalStock: newTotalStock });
                }
            });

            if (selectedClientId && clients.find(c => c.id === selectedClientId)) {
                const clientDocRef = doc(firestore, `tenants/${tenantId}/clients`, selectedClientId);
                batch.update(clientDocRef, { lastAppointment: nowISO, lifetimeValue: increment(total - tax - tipAmount) });
            }
            await batch.commit();
            setRetailItems([]); setSelectedAppointmentIds(new Set()); setSelectedClientId(null); setTipAmount(0); setAppliedDiscountCodes([]); setAppliedAdjustments(new Set()); setRedeemedOffer(null); 
            toast({ title: 'Sale Complete!' });
        } catch (e) {
            console.error(e);
            toast({ variant: 'destructive', title: 'Checkout Failed' });
        } finally { setIsSubmitting(false); }
    };

    const handleStartService = (appointmentId: string) => {
      if (!firestore || !tenantId || !appointments) return;
      const appointment = appointments.find(a => a.id === appointmentId);
      if (!appointment) return;
      const nowISO = new Date().toISOString();
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { status: 'servicing', actualStartTime: nowISO });
      
      if (appointment.checkInToken) {
          batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'servicing' });
      }
      
      if (appointment.staffId) {
          const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId);
          batch.update(staffDocRef, { status: 'busy' });
      }

      if (appointment.isWalkIn) {
          const walkInId = appointment.id.replace('apt-walkin-', '');
          batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'servicing', serviceStartTime: nowISO });
      }

      batch.commit().then(() => toast({ title: "Service Started" }));
    };

    const handleFinishService = (apt: Appointment) => {
        setAppointmentToReview(apt);
        setIsTechnicianReviewOpen(true);
    };

    const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
        if (!firestore || !tenantId || !currentUser) return;
        const batch = writeBatch(firestore);
        
        batch.update(doc(firestore, 'tenants', tenantId, 'staff', currentUser.uid), { status: 'idle' });
        
        const apt = appointments.find(a => a.id === appointmentId);
        if (apt) {
            const totalServicesCount = 1 + (apt.addOnIds?.length || 0);
            const completedIds = checkoutState.completedServiceIds || [];
            const allComplete = completedIds.length >= totalServicesCount;
            
            if (allComplete) {
                batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { status: 'ready_for_checkout', checkoutState, actualEndTime: new Date().toISOString() });
                if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'ready_for_checkout' });
            } else {
                batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { checkoutState });
            }
        }

        batch.commit().then(() => { setIsTechnicianReviewOpen(false); setIsDetailsOpen(false); toast({ title: "Status Updated" }); });
    };

    const handleStaffReorder = (newOrder: Staff[]) => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        newOrder.forEach((s, i) => {
            batch.update(doc(firestore, 'tenants', tenantId, 'staff', s.id), { turnOrder: i });
        });
        batch.commit().catch(err => {
            console.error("Failed to save staff order:", err);
            toast({ variant: 'destructive', title: "Error", description: "Could not save new staff order." });
        });
    };

    const handleReorderWalkIns = (newOrder: WalkIn[]) => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        const now = Date.now();
        newOrder.forEach((w, i) => {
            batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', w.id), { queueOrder: now + i });
        });
        batch.commit().catch(err => {
            console.error("Failed to reorder queue:", err);
            toast({ variant: 'destructive', title: "Error", description: "Could not save new queue order." });
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

    const handleResolve = (item: any) => {
        if (item.type === 'walk-in') {
            const ghostApt: Partial<Appointment> = {
                id: `walkin-resolve-${item.id}`,
                clientName: item.customerName,
                clientId: item.clientId || item.id,
                serviceId: item.serviceIds[0],
                status: 'confirmed',
                isWalkIn: true,
                isPotentialAlias: item.isPotentialAlias,
                matchedClientId: item.matchedClientId,
                startTime: item.checkInTime,
                endTime: item.checkInTime,
            };
            setSelectedAppointment(ghostApt as Appointment);
            setIsDetailsOpen(true);
        } else {
            setSelectedAppointment(item);
            setIsDetailsOpen(true);
        }
    };

    const handleCancelAppointment = (id: string) => {
        const apt = appointments.find(a => a.id === id);
        if (apt) {
            setSelectedAppointment(apt);
            setIsCancelDialogOpen(true);
        }
    };

    const handleCancelAction = (id: string, isWalkIn: boolean) => {
        if (!isWalkIn) {
            handleCancelAppointment(id);
            return;
        }
        
        setConfirmation({
            isOpen: true,
            title: 'Are you sure?',
            description: 'This will remove the guest from the queue. This action cannot be undone.',
            onConfirm: async () => {
                if (!firestore || !tenantId) return;
                const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', id);
                await updateDocumentNonBlocking(walkInRef, { status: 'cancelled' });
                toast({ title: "Walk-in Removed" });
                setConfirmation(null);
            }
        });
    };

    const handleConfirmCancellation = async (data: any) => {
        if (!selectedAppointment || !firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        const now = new Date();
        const nowTimestamp = Timestamp.fromDate(now);
        const nowISO = now.toISOString();
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id);
        const clientRef = doc(firestore, 'tenants', tenantId, 'clients', selectedAppointment.clientId);

        batch.update(appointmentRef, {
            status: 'cancelled',
            cancellationReason: data.reason,
            cancellationFeeApplied: data.feeAmount,
            cancellationPaymentStatus: data.paymentMethod === 'card_on_file' ? 'paid' : (data.paymentMethod === 'waived' ? 'waived' : 'unpaid')
        });

        if (data.chargeFee && data.feeAmount > 0) {
            if (data.paymentMethod === 'add_to_balance') {
                batch.update(clientRef, {
                    unpaidFees: arrayUnion({ feeId: nanoid(), appointmentId: selectedAppointment.id, appointmentDate: selectedAppointment.startTime, feeAmount: data.feeAmount, reason: `Late cancellation: ${data.reason}`, staffId: selectedAppointment.staffId }),
                    outstandingBalance: increment(data.feeAmount)
                });
            } else if (data.paymentMethod === 'card_on_file') {
                const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
                batch.set(txnRef, {
                    date: nowTimestamp,
                    description: `Cancellation Fee: ${selectedAppointment.clientName}`,
                    clientOrVendor: selectedAppointment.clientName,
                    clientId: selectedAppointment.clientId,
                    type: 'income',
                    context: 'Business',
                    category: 'Cancellation Fee',
                    amount: data.feeAmount,
                    paymentMethod: 'Card on File',
                    staffId: selectedAppointment.staffId,
                    appointmentId: selectedAppointment.id,
                });
            }
        }

        try {
            await batch.commit();
            setIsCancelDialogOpen(false);
            setIsDetailsOpen(false);
            toast({ title: "Appointment Cancelled" });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Cancellation Failed' });
        }
    };

    const handleWaiveFee = (id: string, authorizer: Staff, reason: string) => {
        if (!firestore || !tenantId) return;
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', id);
        updateDocumentNonBlocking(appointmentRef, { cancellationFeeWaived: true, waivedBy: authorizer.id, waivedReason: reason, waivedAt: new Date().toISOString() });
        toast({ title: "Fee Waived" });
    };

    const handleOverrideConfirm = async (staffId: string, reason: string) => {
        if (!selectedAppointment || !firestore || !tenantId) return;
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id);
        updateDocumentNonBlocking(appointmentRef, { status: 'confirmed', checkInStatus: 'pending', overrideReason: reason, overriddenBy: staffId });
        setIsOverrideOpen(false);
        setIsDetailsOpen(false);
        toast({ title: "Override Complete" });
    };

    const handleAssignStaff = (walkIn: WalkIn, staffId: string) => {
      if (!firestore || !tenantId || !services) return;
      
      const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkIn.id);
      updateDocumentNonBlocking(walkInRef, { assignedStaffId: staffId, status: 'notified', notifiedTimestamp: new Date().toISOString() });
      
      const personServices = (walkIn.serviceIds || []).map(id => services.find(s => s.id === id)).filter(Boolean) as Service[];
      const duration = personServices.reduce((acc, s) => acc + s.duration, 0);

      const appointmentId = `apt-walkin-${walkIn.id}`;
      const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
      
      const now = new Date();

      const appointmentData = {
          id: appointmentId,
          tenantId: tenantId,
          clientId: walkIn.clientId || walkIn.id,
          clientName: walkIn.customerName,
          serviceId: walkIn.serviceIds[0],
          staffId: staffId,
          status: 'confirmed' as const,
          source: 'walk-in' as const,
          isWalkIn: true,
          startTime: now.toISOString(),
          endTime: addMinutes(now, duration).toISOString(),
      };
      setDocumentNonBlocking(appointmentRef, appointmentData, {});
        
      toast({ title: "Staff Assigned", description: "The client has been notified and an appointment is on the planner." });
    };

    const handleAssignNext = () => {
        if (!staff || !walkIns || !services) { toast({ title: "Data not loaded", description: "Please wait a moment and try again." }); return; }
    
        const notifiedStaffIds = new Set(walkIns.filter(w => w.status === 'notified').map(w => w.assignedStaffId));

        const idleStaff = staff
            .filter(s => s.active && !s.onBreak && (s.status === 'idle' || !s.status) && !notifiedStaffIds.has(s.id))
            .sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
        
        if (idleStaff.length === 0) {
          toast({ variant: 'destructive', title: 'No Staff Available', description: 'All staff members are currently busy or already assigned.' });
          return;
        }
        
        const waitingClients = (walkIns || [])
            .filter(w => w.status === 'waiting')
            .sort((a, b) => (a.queueOrder || 0) - (b.queueOrder || 0));
        
        if (waitingClients.length === 0) {
          toast({ title: 'No Clients Waiting', description: 'The waiting queue is empty.' });
          return;
        }
    
        for (const staffMember of idleStaff) {
            for (const client of waitingClients) {
                const allServiceIds = client.serviceIds;
                const allRequiredSkills = [...new Set(services?.filter(s => allServiceIds.includes(s.id)).flatMap(s => s.requiredSkills || []))];
                const staffSkills = staffMember.skillSet || [];
                const canPerformService = allRequiredSkills.every(skill => staffSkills.includes(skill));

                if (canPerformService) {
                    handleAssignStaff(client, staffMember.id);
                    toast({ title: 'Assigned!', description: `${client.customerName} has been assigned to ${staffMember.name}.` });
                    return;
                }
            }
        }
    
        toast({ variant: 'destructive', title: 'No Match', description: "Found available providers, but none have the required skills for the next clients in line." });
    };

    const handleVerifyPin = () => {
        if (!pendingStatusAction || !staff || !firestore || !tenantId) return;
        const targetStaff = staff.find(s => s.pin === authPin);
        if (targetStaff && targetStaff.pin === authPin) {
            const { staffId, action } = pendingStatusAction;
            const activityLogsRef = collection(firestore, 'tenants', tenantId, 'activityLogs');
            const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
            const now = new Date().toISOString();
            let staffUpdate: Partial<Staff> = {};
            let logEntry: any = { staffId, type: action, timestamp: now };
            switch (action) {
                case 'clock_in': staffUpdate = { active: true }; break;
                case 'clock_out': staffUpdate = { active: false, onBreak: false, status: 'idle' }; break;
                case 'break_start': staffUpdate = { onBreak: true, breakStartTime: now }; break;
                case 'break_end':
                    if (targetStaff.breakStartTime) {
                        const duration = differenceInMinutes(new Date(now), safeDate(targetStaff.breakStartTime));
                        logEntry.durationMinutes = duration;
                    }
                    staffUpdate = { onBreak: false, breakStartTime: undefined };
                    break;
            }
            addDocumentNonBlocking(activityLogsRef, logEntry);
            updateDocumentNonBlocking(staffDocRef, staffUpdate);
            
            setIsPinAuthOpen(false);
            setAuthPin('');
            setPendingStatusAction(null);
            toast({ title: "Authorized", description: "Status updated successfully." });
        } else {
            toast({ variant: "destructive", title: "Invalid PIN" });
        }
    };

    const kpiData = useMemo(() => {
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        const walkInsToday = (walkIns || []).filter(w => {
            const checkInDate = parseISO(w.checkInTime);
            return checkInDate >= todayStart && checkInDate <= todayEnd;
        });

        const servedWalkIns = walkInsToday.filter(w => w.serviceStartTime);
        const waitTimes = servedWalkIns.map(w => {
            const startTime = safeDate(w.serviceStartTime);
            const checkInTime = parseISO(w.checkInTime);
            return differenceInMinutes(startTime, checkInTime);
        });
        const avgWaitTime = waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0;

        const terminalWalkIns = walkInsToday.filter(w => ['completed', 'skipped', 'cancelled'].includes(w.status));
        const completedWalkIns = walkInsToday.filter(w => w.status === 'completed');
        const conversionRate = terminalWalkIns.length > 0 ? (completedWalkIns.length / terminalWalkIns.length) * 100 : 0;

        const totalInServiceMinutes = appointments.reduce((total, apt) => {
            if (apt.status === 'completed' && isSameDay(safeDate(apt.startTime), todayStart)) {
                if (apt.actualStartTime && apt.actualEndTime) {
                    const end = safeDate(apt.actualEndTime);
                    const start = safeDate(apt.actualStartTime);
                    return total + differenceInMinutes(end, start);
                }
                const service = services?.find(s => s.id === apt.serviceId);
                return total + (service?.duration || 0);
            }
            return total;
        }, 0);

        const totalServiceRevenue = (transactions || []).filter(t => {
            const transactionDate = safeDate(t.date);
            return t.category === 'Service Revenue' && transactionDate >= todayStart && transactionDate <= todayEnd;
        }).reduce((acc, t) => acc + t.amount, 0);

        const revenuePerServiceHour = totalInServiceMinutes > 0 ? (totalServiceRevenue / (totalInServiceMinutes / 60)) : 0;

        return {
            avgWaitTime,
            walkInConversionRate: conversionRate,
            totalWalkIns: walkInsToday.length,
            revenuePerServiceHour,
        };
    }, [walkIns, appointments, transactions, services]);

    const [orderedStaff, setOrderedStaff] = useState<Staff[]>([]);
    useEffect(() => {
        if (staff) {
            const sorted = [...staff].sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
            setOrderedStaff(sorted);
        }
    }, [staff]);

    const enrichedOrderedStaff = useMemo(() => {
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        return orderedStaff.map(member => {
            const staffTransactionsToday = (transactions || []).filter(t => {
                if (t.staffId !== member.id) return false;
                const transactionDate = safeDate(t.date);
                return transactionDate >= todayStart && transactionDate <= todayEnd;
            });

            const serviceRevenue = staffTransactionsToday
                .filter(t => t.category === 'Service Revenue')
                .reduce((acc, t) => acc + t.amount, 0);

            const retailSales = staffTransactionsToday
                .filter(t => t.category === 'Retail')
                .reduce((acc, t) => acc + t.amount, 0);

            const tips = staffTransactionsToday
                .filter(t => t.category === 'Tips')
                .reduce((acc, t) => acc + (t.tipAmount || 0), 0);
            
            let earnings = 0;
            if (member.payStructure === 'commission') {
                earnings = serviceRevenue * ((member.commissionRate || 0) / 100);
            } 

            const retailCommission = retailSales * ((member.retailCommissionRate || 0) / 100);
            earnings += tips + retailCommission;

            return {
                ...member,
                stats: {
                    totalSales: serviceRevenue + retailSales,
                    tips,
                    earnings,
                }
            };
        });
    }, [orderedStaff, transactions]);

    const checkoutHubProps = {
        cart: retailItems, onCartChange: setRetailItems,
        appointmentsData: Array.from(selectedAppointmentIds).map(id => readyForCheckoutAppointments.find(a => a.id === id)).filter(Boolean) as any,
        onSelectAppointment: handleSelectAppointment, clients: clients || [], isGroupCheckout: selectedAppointmentIds.size > 1,
        payerOptions: (clients || []).filter(c => Array.from(selectedAppointmentIds).some(id => readyForCheckoutAppointments.find(a => a.id === id)?.appointment.clientId === c.id)),
        selectedClientId, setSelectedClientId, onAddClientClick: () => setIsAddClientOpen(true), onScanClick: () => setIsScannerOpen(true),
        subtotal: rawSubtotal, tax, total, tipAmount, setTipAmount, onCheckout: handleCheckout,
        appliedDiscountCodes, setAppliedDiscountCodes, discount, membershipDiscount,
        isSubmitting, paymentTab, setPaymentTab, discounts: discounts || [], amountTendered, setAmountTendered,
        appliedAdjustments, onApplyAdjustmentToggle: handleApplyAdjustmentToggle,
        redeemedOffer, setRedeemedOffer, memberships: memberships || [], packages: packages || [], allowStacking: selectedTenant?.allowDiscountStacking || false, showTitle: false,
        waivedAppointmentFees, onWaiveFeeToggle: handleWaiveFeeToggle,
        tipAllocations,
    };

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

                    <TeamStatus staff={staff} onStatusChange={(id, act) => { setPendingStatusAction({ staffId: id, action: act }); setIsPinAuthOpen(true); }} appointments={todayAppointments} services={services} onReorder={handleStaffReorder} assignmentMode={assignmentMode} onAssignmentModeChange={setAssignmentMode} />
                    <WalkInQueue walkIns={walkIns} appointments={todayAppointments} readyForCheckoutAppointments={readyForCheckoutAppointments} selectedAppointmentIds={selectedAppointmentIds} onSelectAppointment={handleSelectAppointment} services={services} staff={staff} onAssignStaff={handleAssignStaff} onAssignNext={handleAssignNext} onCancel={handleCancelAction} onStartService={handleStartService} orderedWaitingQueue={[]} onReorder={handleReorderWalkIns} assignmentMode={assignmentMode} onPrintTicket={handlePrintTicket} onSkip={handleSkip} onReturnToQueue={handleReturnToQueue} groupSizes={new Map()} onToggleWaitForStaff={() => {}} onScanClick={() => setIsScannerOpen(true)} onFinishService={handleFinishService} onUpdateStatus={onUpdateStatus} onRevertToReady={handleRevertToReady} onRevertToService={handleRevertToService} onResolve={handleResolve} />
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
                onCancel={handleCancelAppointment}
                onReschedule={() => {}}
                onRebook={() => {}}
                onBookNewForClient={() => {}}
                onPrintTicket={() => {}}
                onOverride={() => setIsOverrideOpen(true)}
                onWaiveFee={handleWaiveFee}
            />

            {selectedAppointment && (
                <CancelAppointmentDialog
                    open={isCancelDialogOpen}
                    onOpenChange={setIsCancelDialogOpen}
                    appointment={selectedAppointment}
                    tenant={selectedTenant}
                    onConfirm={handleConfirmCancellation}
                />
            )}

            <OverrideCancellationDialog 
                open={isOverrideOpen}
                onOpenChange={setIsOverrideOpen}
                staff={staff || []}
                onConfirm={handleOverrideConfirm}
            />

            {appointmentToReview && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: appointmentToReview, client: clients?.find(c => c.id === appointmentToReview.clientId), service: services?.find(s => s.id === appointmentToReview.serviceId) }} staff={staff || []} onSendToFrontDesk={handleSendToFrontDesk} />}
            <Dialog open={isPinAuthOpen} onOpenChange={setIsPinAuthOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Authorize Action</DialogTitle></DialogHeader><div className="py-6 flex flex-col items-center gap-4"><Input type="password" value={authPin} onChange={e => setAuthPin(e.target.value)} maxLength={4} className="text-center text-3xl font-black h-16 w-48" /></div><DialogFooter><Button onClick={handleVerifyPin}>Confirm</Button></DialogFooter></DialogContent></Dialog>
            
            <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
                <DialogContent className="max-w-sm print:hidden">
                    <DialogHeader>
                        <DialogTitle>Walk-in Ticket</DialogTitle>
                    </DialogHeader>
                    <div id="print-ticket-area">
                        {ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsPrintDialogOpen(false)}>Close</Button>
                        <Button onClick={() => window.print()}>
                            <Printer className="mr-2 h-4 w-4" />
                            Print
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={confirmation?.isOpen} onOpenChange={(val) => !val && setConfirmation(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>{confirmation?.title}</AlertDialogTitle><AlertDialogDescription>{confirmation?.description}</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel onClick={() => setConfirmation(null)}>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmation?.onConfirm}>Confirm</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export default function POSPage() { return <Suspense fallback={<div>Loading...</div>}><POSPageContent /></Suspense> }
