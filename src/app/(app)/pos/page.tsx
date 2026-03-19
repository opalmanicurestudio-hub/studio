'use client';

import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, getServicePrice, type AppointmentCheckoutState, type Redemption, type TillSession, type Membership, type Package } from '@/lib/data';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { Button } from '@/components/ui/button';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardFooter 
} from '@/components/ui/card';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, query, where, deleteField } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, addMinutes, isToday, isSameDay, startOfDay, endOfDay, format, subMinutes, subMonths, isAfter, subYears, differenceInDays, isSameMonth } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { AddClientDialog, type ClientFormData } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Clock, Users, DollarSign, QrCode, Loader, Play, XCircle, Fingerprint, UserPlus, Sparkles, ChevronRight, ChevronLeft, ShoppingCart, Square, Wallet, AlertTriangle, MapPin, ShieldCheck, ArrowRight, Info, CheckCircle2, Ban, ShieldAlert, Landmark, Smartphone, Cake, Printer } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn, hexToHSLComponents, safeNumber } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';
import { Html5Qrcode } from 'html5-qrcode';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TillManagement } from '@/components/pos/TillManagement';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CheckInConfirmationDialog } from '@/components/pos/CheckInConfirmationDialog';
import { PrintTicket } from '@/components/planner/PrintTicket';

// HELPER FUNCTIONS (Declared before component to avoid reference issues)
const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val?.toDate === 'function') return val.toDate();
    return new Date(val);
};

const sanitizeForFirestore = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
    if (obj.constructor && (obj.constructor.name === 'FieldValue' || obj.constructor.name === 'FieldValueImpl')) return obj;
    return Object.fromEntries(
        Object.entries(obj)
            .filter(([_, v]) => v !== undefined)
            .map(([k, v]) => [k, sanitizeForFirestore(v)])
    );
};

const KpiCard = ({ title, value, icon, description, iconBgColor }: { title: string; value: string; icon: React.ReactNode, description: string, iconBgColor: string }) => (
  <Card className="border-2 shadow-sm overflow-hidden bg-white/50 backdrop-blur-sm">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 md:p-4 pb-2">
      <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
      <div className={cn("p-1.5 md:p-2 rounded-xl", iconBgColor)}>
        {React.cloneElement(icon as React.ReactElement, { className: 'w-3.5 h-3.5 md:w-4 md:h-4' })}
      </div>
    </CardHeader>
    <CardContent className="p-3 md:p-4 pt-0 text-left">
      <div className="text-xl md:text-3xl font-black tracking-tighter text-slate-900">{value}</div>
      <p className="text-[9px] font-bold text-muted-foreground uppercase mt-1 opacity-60 truncate">{description}</p>
    </CardContent>
  </Card>
);

function POSPage() {
    const { inventory, services, appointments: appointmentsFromInventory, clients, walkIns, staff, transactions, memberships, packages, resources, discounts, tillSessions, isLoading: isInventoryLoading } = useInventory();
    const { firestore, user: currentUser } = useFirebase();
    const { selectedTenant, role } = useTenant();
    const tenantId = selectedTenant?.id;
    const router = useRouter();
    const { toast } = useToast();
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
    const [isCartCollapsed, setIsCartCollapsed] = useState(false);
    const [isTillManagementOpen, setIsTillManagementOpen] = useState(false);
    const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
    const [appointmentToReview, setAppointmentToReview] = useState<Appointment | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [assignmentMode, setAssignmentMode] = useState<'fair_play' | 'ordered_list'>('ordered_list');
    const [pendingCheckInItem, setPendingCheckInItem] = useState<any | null>(null);
    const [ticketToPrint, setTicketToPrint] = useState<any | null>(null);
    const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
    const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
    const [appliedAdjustments, setAppliedAdjustments] = useState<Set<string>>(new Set());
    const [redeemedOffer, setRedeemedOffer] = useState<{ type: 'membership' | 'package'; id: string; itemId?: string } | null>(null);
    const [waivedAppointmentFees, setWaivedAppointmentFees] = useState<Map<string, { authorizerId: string; reason: string }>>(new Map());

    const isOwnerOrAdminUser = role === 'owner' || role === 'admin';
    const activeTill = useMemo(() => tillSessions?.find(s => s.status === 'open') || null, [tillSessions]);

    // DATA RESOLUTION (Declared early to satisfy hoisting)
    const readyForCheckoutAppointments = useMemo(() => {
        if (!appointmentsFromInventory || !clients || !services || !staff) return [];
        return appointmentsFromInventory
            .filter(apt => apt.status === 'ready_for_checkout')
            .map(apt => {
                const client = clients.find(c => c.id === apt.clientId);
                const service = services.find(s => s.id === apt.serviceId);
                const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
                const staffMember = staff.find(s => s.id === apt.staffId);
                return { id: apt.id, appointment: apt, client, service, addOnServices, staff: staffMember };
            }).filter((a): a is any => !!(a.client && a.service));
    }, [appointmentsFromInventory, clients, services, staff]);

    const kpiData = useMemo(() => {
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());
        const walkInsToday = (walkIns || []).filter(w => {
            const checkInDate = safeDate(w.checkInTime);
            return checkInDate >= todayStart && checkInDate <= todayEnd;
        });
        const completedWalkIns = walkInsToday.filter(w => ['servicing', 'completed', 'ready_for_checkout'].includes(w.status)) && walkInsToday.filter(w => w.serviceStartTime);
        const waitTimes = completedWalkIns.map(w => differenceInMinutes(safeDate(w.serviceStartTime), safeDate(w.checkInTime)));
        const avgWaitTime = waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0;
        const dailyTransactions = (transactions || []).filter(t => { const d = safeDate(t.date); return d >= todayStart && d <= todayEnd && t.type === 'income'; });
        const totalDailyGrossRevenue = dailyTransactions.reduce((acc, t) => acc + safeNumber(t.amount), 0);
        return { avgWaitTime, totalWalkIns: walkInsToday.length, totalDailyGrossRevenue };
    }, [walkIns, transactions]);

    const selectedClient = useMemo(() => clients.find((c: Client) => c.id === selectedClientId), [selectedClientId, clients]);

    const subtotalCalc = useMemo(() => {
        const servicesSub = readyForCheckoutAppointments
            .filter(a => selectedAppointmentIds.has(a.id))
            .reduce((acc, data) => {
                const isServiceRedeemed = redeemedOffer?.itemId === data.service.id;
                const mainPrice = isServiceRedeemed ? 0 : getServicePrice(data.service, data.staff);
                const addonsPrice = (data.addOnServices || []).reduce((sum: number, s: any) => {
                    const isAddonRedeemed = redeemedOffer?.itemId === s.id;
                    const addonStaffId = data.appointment.checkoutState?.serviceStaffOverrides?.[s.id] || data.appointment.staffId;
                    const addonStaff = staff.find(st => st.id === addonStaffId);
                    return sum + (isAddonRedeemed ? 0 : getServicePrice(s, addonStaff));
                }, 0);
                const additional = safeNumber(data.appointment.checkoutState?.additionalCharge);
                const effectiveAdditional = waivedAppointmentFees.has(data.appointment.id) ? 0 : additional;
                return acc + mainPrice + addonsPrice + effectiveAdditional;
            }, 0);
        const retailSub = retailItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        const adjustmentSub = Array.from(appliedAdjustments).reduce((acc, id) => {
            const fee = clients.flatMap(c => c.unpaidFees || []).find(f => f.feeId === id);
            return acc + safeNumber(fee?.feeAmount);
        }, 0);
        return safeNumber(servicesSub + retailSub + adjustmentSub);
    }, [readyForCheckoutAppointments, selectedAppointmentIds, retailItems, appliedAdjustments, clients, waivedAppointmentFees, staff, redeemedOffer]);

    const discountValue = useMemo(() => {
        return safeNumber(appliedDiscountCodes.reduce((acc, code) => {
            const d = (discounts || []).find((dis: any) => dis.code.toUpperCase() === code.toUpperCase());
            if (!d) return acc;
            return acc + (d.type === 'percentage' ? subtotalCalc * (d.value / 100) : d.value);
        }, 0));
    }, [appliedDiscountCodes, discounts, subtotalCalc]);

    const membershipDiscountValue = useMemo(() => {
        if (!selectedClient || !memberships || !packages) return 0;
        const mId = selectedClient.activeMembershipId || selectedClient?.subscription?.membershipId;
        if (selectedClient?.subscription?.status && selectedClient.subscription.status !== 'active') return 0;
        let bestDiscountPct = 0;
        let eligibleProductIds: string[] = [];
        if (mId) {
            const membership = memberships.find(m => m.id === mId);
            if (membership?.retailDiscount) {
                bestDiscountPct = membership.retailDiscount;
                eligibleProductIds = membership.applicableProductIds || [];
            }
        }
        if (bestDiscountPct === 0) return 0;
        return retailItems.reduce((acc, item) => {
            const isEligible = eligibleProductIds.length === 0 || eligibleProductIds.includes(item.id);
            return isEligible ? acc + (item.price * item.quantity * (bestDiscountPct / 100)) : acc;
        }, 0);
    }, [selectedClient, memberships, packages, retailItems]);

    const taxCalc = subtotalCalc * 0.07;
    const totalCalc = subtotalCalc + taxCalc + tipAmount - discountValue - membershipDiscountValue;

    const payerOptions = useMemo(() => {
        const clientIds = new Set<string>();
        readyForCheckoutAppointments
            .filter(a => selectedAppointmentIds.has(a.id))
            .forEach(data => { if (data.client?.id) clientIds.add(data.client.id); });
        return (clients || []).filter(c => clientIds.has(c.id));
    }, [readyForCheckoutAppointments, selectedAppointmentIds, clients]);

    // HANDLERS
    const handleSelectAppointment = useCallback((id: string) => {
        const nextIds = new Set(selectedAppointmentIds);
        let nextClientId = selectedClientId;
        if (nextIds.has(id)) {
            nextIds.delete(id);
            if (nextIds.size === 0) nextClientId = null;
        } else {
            nextIds.add(id);
            const aptData = readyForCheckoutAppointments.find(a => a.id === id);
            if (aptData?.client?.id) nextClientId = aptData.client.id;
        }
        setSelectedAppointmentIds(nextIds);
        setSelectedClientId(nextClientId);
    }, [readyForCheckoutAppointments, selectedClientId, selectedAppointmentIds]);

    const handleAddToCart = useCallback((item: any) => {
        setRetailItems(prev => {
            const existing = prev.find(i => i.id === item.id);
            if (existing) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
            let price = 0;
            let type: 'product' | 'service' | 'membership' | 'package' = 'product';
            if ('msrp' in item) { price = safeNumber(item.msrp || item.costPerUnit); type = 'product'; }
            else if ('duration' in item) { price = safeNumber(item.price); type = 'service'; }
            else if ('interval' in item) { price = safeNumber(item.price); type = 'membership'; }
            else if ('sessions' in item) { price = safeNumber(item.price); type = 'package'; }
            return [...prev, { id: item.id, name: item.name, quantity: 1, price, type, imageUrl: item.imageUrl, stock: item.totalStock }];
        });
    }, []);

    const handleScan = useCallback((data: string) => {
        if (data.startsWith('clarityflow://checkout/')) {
            const id = data.split('/').pop();
            if (id) handleSelectAppointment(id);
        } else {
            const product = inventory.find(p => p.sku === data || p.id === data);
            if (product) handleAddToCart(product);
        }
    }, [inventory, handleSelectAppointment, handleAddToCart]);

    const handleFinishService = (apt: Appointment) => { setAppointmentToReview(apt); setIsTechnicianReviewOpen(true); };

    const handleStartService = (appointmentId: string) => {
      if (!firestore || !tenantId || !appointmentsFromInventory) return;
      const appointment = (appointmentsFromInventory || []).find(a => a.id === appointmentId) || (appointmentsFromInventory || []).find(a => a.id === `apt-walkin-${appointmentId}`);
      if (!appointment) return;
      const nowISO = new Date().toISOString();
      const batch = writeBatch(firestore);
      batch.set(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { status: 'servicing', actualStartTime: nowISO }, { merge: true });
      if (appointment.checkInToken) batch.set(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'servicing', tenantId }, { merge: true });
      if (appointment.staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId), { status: 'busy' }, { merge: true });
      if (appointment.isWalkIn) batch.set(doc(firestore, 'tenants', tenantId, 'walkIns', appointment.id.replace('apt-walkin-', '')), { status: 'servicing', serviceStartTime: nowISO }, { merge: true });
      batch.commit().then(() => toast({ title: "Service Started" }));
    };

    const handleAssignStaff = (walkIn: WalkIn, staffId: string) => {
      if (!firestore || !tenantId || !services) return;
      const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkIn.id);
      updateDocumentNonBlocking(walkInRef, { assignedStaffId: staffId, status: 'notified', notifiedTimestamp: new Date().toISOString() });
      const personServices = (walkIn.serviceIds || []).map(id => (services || []).find(s => s.id === id)).filter(Boolean) as Service[];
      const duration = personServices.reduce((acc, s) => acc + s.duration, 0);
      const appointmentId = `apt-walkin-${walkIn.id}`;
      setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { id: appointmentId, tenantId, clientId: walkIn.clientId || walkIn.id, clientName: walkIn.customerName, serviceId: walkIn.serviceIds[0], staffId, status: 'confirmed', source: 'walk-in', isWalkIn: true, startTime: new Date().toISOString(), endTime: addMinutes(new Date(), duration).toISOString() }, {});
      toast({ title: "Staff Assigned" });
    };

    const handleUpdateStatus = (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => {
        if (!firestore || !tenantId) return;
        const docRef = isWalkIn ? doc(firestore, 'tenants', tenantId, 'walkIns', id) : doc(firestore, 'tenants', tenantId, 'appointments', id);
        const updates: any = { checkInStatus: status };
        if (lateMinutes !== undefined) updates.lateTimeMinutes = lateMinutes;
        updateDocumentNonBlocking(docRef, updates);
        toast({ title: "Status Updated" });
    };

    const handleSkip = (walkInId: string) => {
        if (!firestore || !tenantId) return;
        const walkIn = walkIns?.find(w => w.id === walkInId);
        const batch = writeBatch(firestore);
        batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'skipped' });
        if (walkIn?.assignedStaffId) {
            batch.set(doc(firestore, 'tenants', tenantId, 'staff', walkIn.assignedStaffId), { status: 'idle' }, { merge: true });
            batch.update(doc(firestore, 'tenants', tenantId, 'appointments', `apt-walkin-${walkInId}`), { status: 'cancelled', cancellationReason: 'late' });
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
        const apt = (appointmentsFromInventory || []).find(a => a.id === appointmentId);
        if (apt?.staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', apt.staffId), { status: 'idle' }, { merge: true });
        batch.commit().then(() => toast({ title: "Reverted to Ready" }));
    };

    const handleRevertToService = (appointmentId: string) => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { status: 'servicing', actualEndTime: deleteField() });
        const apt = (appointmentsFromInventory || []).find(a => a.id === appointmentId);
        if (apt?.staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', apt.staffId), { status: 'busy' }, { merge: true });
        if (apt?.isWalkIn) batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', appointmentId.replace('apt-walkin-', '')), { status: 'servicing' });
        batch.commit().then(() => { 
            setSelectedAppointmentIds(prev => { const next = new Set(prev); next.delete(appointmentId); return next; }); 
            toast({ title: "Reverted to In-Service" }); 
        });
    };

    const handleResolveCheckInConfirmation = async (data: any) => {
        if (!pendingCheckInItem || !firestore || !tenantId) return;
        const { id, isWalkIn, clientId, checkInToken } = pendingCheckInItem;
        const docRef = isWalkIn ? doc(firestore, 'tenants', tenantId, 'walkIns', id) : doc(firestore, 'tenants', tenantId, 'appointments', id);
        const batch = writeBatch(firestore);
        const updates: any = { checkInStatus: 'arrived', serviceId: data.serviceId, addOnIds: data.addOnIds, clientEmail: String(data.email || ''), clientPhone: String(data.phone || ''), notes: data.notes || '' };
        if (isWalkIn) { updates.serviceIds = [data.serviceId, ...(data.addOnIds || [])]; updates.customerEmail = String(data.email || ''); updates.customerPhone = String(data.phone || ''); }
        batch.update(docRef, updates);
        if (!isWalkIn && checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', checkInToken), { checkInStatus: 'arrived' });
        if (clientId) batch.update(doc(firestore, 'tenants', tenantId, 'clients', clientId), { email: String(data.email || ''), phone: String(data.phone || ''), sensoryNeeds: data.accommodations?.length > 0 ? data.accommodations.join(', ') : deleteField() as any });
        try { await batch.commit(); toast({ title: "Check-in Certified" }); setPendingCheckInItem(null); }
        catch (e) { console.error(e); toast({ variant: 'destructive', title: "Certification Failed" }); }
    };

    const handleCheckout = async (paymentData: {paymentMethod: string, amountTendered: number}) => {
        if (!selectedClientId || !firestore || !tenantId) return;
        setIsSubmitting(true);
        const batch = writeBatch(firestore);
        const now = new Date().toISOString();
        const clientObj = (clients || []).find(c => c.id === selectedClientId);
        let totalLtvIncrease = 0; let totalCashIncrease = 0; let cashTipsTotal = 0; const cashTipsByStaffUpdate: Record<string, number> = {};

        for (const aptData of readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id))) {
            const { appointment: apt, service, addOnServices } = aptData;
            const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', apt.id);
            const checkoutState = apt.checkoutState || {};
            const overrides = checkoutState.serviceStaffOverrides || {};
            const isWaived = waivedAppointmentFees.has(apt.id);
            const additional = !isWaived ? safeNumber(checkoutState.additionalCharge) : 0;
            const formula = checkoutState.formula || [];
            formula.forEach((item: any) => {
                const productRef = doc(firestore, 'tenants', tenantId, 'inventory', item.id);
                const product = (inventory || []).find(p => p.id === item.id);
                if (!product) return;
                const updateData: any = {};
                if (product.costingMethod === 'uses') {
                    let currentUses = product.partialContainerUses || 0; let currentStock = product.totalStock; const usesPerContainer = product.estimatedUses || 1;
                    currentUses -= item.quantity; while (currentUses <= 0 && currentStock > 0) { currentStock -= 1; currentUses += usesPerContainer; }
                    updateData.totalStock = currentStock; updateData.partialContainerUses = currentUses;
                } else if (product.costingMethod === 'size' && product.size) {
                    let currentSize = product.partialContainerSize || 0; let currentStock = product.totalStock; const sizePerContainer = product.size || 1;
                    currentSize -= item.quantity; while (currentSize <= 0 && currentStock > 0) { currentStock -= 1; currentSize += sizePerContainer; }
                    updateData.totalStock = currentStock; updateData.partialContainerSize = currentSize;
                } else updateData.totalStock = (product.totalStock || 0) - item.quantity;
                batch.update(productRef, updateData);
                const scRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
                batch.set(scRef, { id: nanoid(), productId: item.id, date: now, change: -item.quantity, unit: item.unit || 'units', reason: `Service: ${service.name} for ${clientObj?.name || 'Guest'}`, appointmentId: apt.id });
            });
            const mainStaffId = overrides[service.id] || apt.staffId; const isMainRedeemed = redeemedOffer?.itemId === service.id;
            const mainPartRevenue = (isMainRedeemed ? 0 : getServicePrice(service, staff.find(s => s.id === mainStaffId))) + additional; 
            totalLtvIncrease += mainPartRevenue; if (paymentData.paymentMethod === 'cash') totalCashIncrease += mainPartRevenue;
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { id: nanoid(), date: now, description: isMainRedeemed ? `Redemption: ${service.name}` : `Service: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Service Revenue', amount: mainPartRevenue, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: true });
            addOnServices.forEach((addon: any) => {
                const addonStaffId = overrides[addon.id] || apt.staffId; const isAddonRedeemed = redeemedOffer?.itemId === addon.id;
                const addonPrice = isAddonRedeemed ? 0 : getServicePrice(addon, staff.find(st => st.id === addonStaffId));
                totalLtvIncrease += addonPrice; if (paymentData.paymentMethod === 'cash') totalCashIncrease += addonPrice;
                batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { id: nanoid(), date: now, description: isAddonRedeemed ? `Redemption: ${addon.name}` : `Add-on: ${addon.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Service Revenue', amount: addonPrice, paymentMethod: paymentData.paymentMethod, staffId: addonStaffId, appointmentId: apt.id, hasReceipt: true });
            });
            batch.update(appointmentRef, { status: 'completed', revenue: mainPartRevenue + addOnServices.reduce((s: number, a: any) => s + getServicePrice(a, staff.find(st => st.id === (overrides[a.id] || apt.staffId))), 0), actualEndTime: now });
            if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'completed' });
            const involvedIds = new Set<string>(); if (apt.staffId) involvedIds.add(apt.staffId); if (overrides) Object.values(overrides).forEach((id: any) => { if (id && typeof id === 'string') involvedIds.add(id); });
            involvedIds.forEach(sid => { batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true }); });
        }

        retailItems.forEach(item => {
            const productValue = item.price * item.quantity;
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { id: nanoid(), date: now, description: `Retail: ${item.quantity}x ${item.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Retail', amount: productValue, paymentMethod: paymentData.paymentMethod, hasReceipt: true });
            batch.update(doc(firestore, 'tenants', tenantId, 'inventory', item.id), { totalStock: increment(-item.quantity) });
            batch.set(doc(collection(firestore, `tenants/${tenantId}/stockCorrections`)), { id: nanoid(), productId: item.id, date: now, change: -item.quantity, unit: 'units', reason: `Retail Sale: ${item.name} for ${clientObj?.name || 'Guest'}` });
            totalLtvIncrease += productValue; if (paymentData.paymentMethod === 'cash') totalCashIncrease += productValue;
        });

        if (clientObj && appliedAdjustments.size > 0) {
            const currentUnpaid = clientObj.unpaidFees || [];
            const settledTotal = Array.from(appliedAdjustments).reduce((sum, id) => { const fee = currentUnpaid.find(f => f.feeId === id); return sum + safeNumber(fee?.feeAmount); }, 0);
            batch.update(doc(firestore, `tenants/${tenantId}/clients`, clientObj.id), { unpaidFees: currentUnpaid.filter(f => !appliedAdjustments.has(f.feeId)), outstandingBalance: increment(-settledTotal) });
            if (paymentData.paymentMethod === 'cash') totalCashIncrease += settledTotal;
            appliedAdjustments.forEach(id => {
                const fee = currentUnpaid.find(f => f.feeId === id);
                if (fee) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { id: nanoid(), date: now, description: `Debt Settlement: ${fee.reason}`, clientOrVendor: clientObj.name, clientId: selectedClientId, type: 'income', context: 'Business', category: 'Fee Recovery', amount: fee.feeAmount, paymentMethod: paymentData.paymentMethod, hasReceipt: false });
            });
            totalLtvIncrease += settledTotal;
        }

        if (clientObj) {
            const finalLtvDelta = Math.max(0, totalLtvIncrease - discountValue - membershipDiscountValue);
            const updates: any = { lifetimeValue: increment(finalLtvDelta), lastAppointment: now };
            if (redeemedOffer) {
                const redemptionRef = doc(collection(firestore, `tenants/${tenantId}/clients/${selectedClientId}/redemptions`));
                const offeringName = redeemedOffer.type === 'membership' ? memberships?.find(m => m.id === redeemedOffer.id)?.name : packages?.find(p => p.id === redeemedOffer.id)?.name;
                batch.set(redemptionRef, { id: redemptionRef.id, clientId: selectedClientId, type: redeemedOffer.type, offeringId: redeemedOffer.id, offeringName: offeringName || 'Offer', serviceId: redeemedOffer.itemId, serviceName: services?.find(s => s.id === redeemedOffer.itemId)?.name || 'Service', date: now, staffId: currentUser?.uid });
                if (redeemedOffer.type === 'package') updates.activePackages = (clientObj.activePackages || []).map(p => p.packageId === redeemedOffer.id ? { ...p, sessionsRemaining: p.sessionsRemaining - 1 } : p).filter(p => p.sessionsRemaining > 0);
                else { updates[`subscription.perkUsage.${redeemedOffer.itemId}`] = increment(1); updates['subscription.perkLastUsed'] = now; }
            }
            batch.update(doc(firestore, `tenants/${tenantId}/clients`, clientObj.id), updates);
        }
        
        Object.entries(tipAllocations).forEach(([staffId, amount]) => {
            const finalAmount = safeNumber(amount);
            if (finalAmount > 0) {
                batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { id: nanoid(), date: now, description: 'Gratuity', clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Tips', amount: finalAmount, paymentMethod: paymentData.paymentMethod, staffId, hasReceipt: true });
                if (paymentData.paymentMethod === 'cash') { cashTipsTotal += finalAmount; cashTipsByStaffUpdate[`cashTipsByStaff.${staffId}`] = increment(finalAmount); }
            }
        });
        
        if (discountValue > 0) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { id: nanoid(), date: now, description: `Promotion Applied`, clientOrVendor: 'Internal', clientId: selectedClientId, type: 'expense', context: 'Business', category: 'Discounts', amount: discountValue, paymentMethod: 'Internal', hasReceipt: false });
        if (paymentTab === 'cash' && activeTill) {
            const finalCashInput = totalCashIncrease + cashTipsTotal;
            batch.update(doc(firestore, `tenants/${tenantId}/tillSessions`, activeTill.id), { expectedCash: increment(finalCashInput), totalCashSales: increment(totalCashIncrease), totalCashTips: increment(cashTipsTotal), ...cashTipsByStaffUpdate });
        }
        try { await batch.commit(); toast({ title: "Checkout Successful" }); setRetailItems([]); setSelectedAppointmentIds(new Set()); setTipAmount(0); setIsCartSheetOpen(false); setRedeemedOffer(null); setAppliedDiscountCodes([]); setAppliedAdjustments(new Set()); }
        catch (e) { console.error(e); toast({ variant: 'destructive', title: 'Checkout Failed' }); }
        finally { setIsSubmitting(false); }
    };

    const checkoutHubProps = {
        cart: retailItems, onCartChange: setRetailItems, appointmentsData: readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)), onSelectAppointment: handleSelectAppointment,
        clients: clients || [], isGroupCheckout: selectedAppointmentIds.size > 1, payerOptions: payerOptions || [], selectedClientId, setSelectedClientId,
        onAddClientClick: () => setIsAddClientOpen(true), onScanClick: () => setIsScannerOpen(true),
        subtotal: subtotalCalc, tax: taxCalc, total: totalCalc, tipAmount, setTipAmount, onCheckout: handleCheckout,
        appliedDiscountCodes, setAppliedDiscountCodes, discount: discountValue, membershipDiscount: membershipDiscountValue,
        isSubmitting, paymentTab, setPaymentTab, discounts: discounts || [], amountTendered, setAmountTendered,
        appliedAdjustments, onApplyAdjustmentToggle: (ids: any, apply?: boolean) => { /* logic */ },
        redeemedOffer, setRedeemedOffer, memberships: memberships || [], packages: packages || [],
        allowStacking: selectedTenant?.allowDiscountStacking || false, showTitle: false,
        waivedAppointmentFees, onWaiveFeeToggle: (id: string, waive: boolean, authorizerId?: string, reason?: string) => { setWaivedAppointmentFees(prev => { const next = new Map(prev); if (waive && authorizerId && reason) next.set(id, { authorizerId, reason }); else next.delete(id); return next; }); },
        tipAllocations, setTipAllocations, activeTill, staff, role
    };

    if (isInventoryLoading) return <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Syncing Terminal...</p></div>;

    return (
        <div className="h-[100dvh] w-full flex flex-col bg-background">
            <AppHeader title="Studio POS" />
            <div className={cn("flex-1 grid transition-all duration-500 ease-in-out overflow-hidden", isCartCollapsed ? "lg:grid-cols-[1fr,80px]" : "lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px]")}>
                <main className="flex-1 flex flex-col overflow-auto p-4 md:p-10 gap-10 pb-32 lg:pb-10 text-left">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-2">
                        <div className="grid gap-4 md:gap-6 grid-cols-2 lg:grid-cols-4 flex-1 w-full text-left">
                            <KpiCard title="Wait Velocity" value={`${kpiData.avgWaitTime.toFixed(0)}m`} icon={<Clock className="text-blue-500" />} iconBgColor="bg-blue-100 dark:bg-blue-900/50" description="Check-in to service." />
                            <KpiCard title="Arrival Count" value={kpiData.totalWalkIns.toString()} icon={<Users className="text-purple-500" />} iconBgColor="bg-purple-100 dark:bg-purple-900/50" description="Total guests today." />
                            <KpiCard title="Daily Gross" value={`$${safeNumber(kpiData.totalDailyGrossRevenue).toFixed(2)}`} icon={<DollarSign className="text-amber-500" />} iconBgColor="bg-amber-100 dark:bg-amber-900/50" description="Current yield." />
                        </div>
                        {isOwnerOrAdminUser && (<Button variant={activeTill ? "outline" : "default"} onClick={() => setIsTillManagementOpen(true)} className={cn("h-14 md:h-20 px-8 rounded-3xl font-black uppercase text-xs shadow-xl border-4 flex flex-col items-center justify-center gap-1", activeTill ? "border-green-500/20 bg-green-500/5 text-green-700" : "shadow-primary/20")}><Landmark className="w-5 h-5 mb-1" /> {activeTill ? `Till: $${safeNumber(activeTill.expectedCash).toFixed(2)}` : "Open Studio Till"}</Button>)}
                    </div>
                    <div className="grid gap-10 grid-cols-1">
                        <TeamStatus staff={staff} onStatusChange={(id, act) => {}} appointments={appointmentsFromInventory?.filter(a => isToday(safeDate(a.startTime)))} services={services} onReorder={(newOrder) => { if (!firestore || !tenantId) return; const batch = writeBatch(firestore); newOrder.forEach((s, idx) => { batch.set(doc(firestore, 'tenants', tenantId, 'staff', s.id), { turnOrder: idx }, { merge: true }); }); batch.commit(); }} assignmentMode={assignmentMode} onAssignmentModeChange={setAssignmentMode} resources={resources || []} onForceIdle={(staffId) => { if (!firestore || !tenantId) return; const staffRef = doc(firestore, 'tenants', tenantId, 'staff', staffId); setDocumentNonBlocking(staffRef, { status: 'idle' }, { merge: true }); toast({ title: "Staff Reset" }); }} />
                        <WalkInQueue walkIns={walkIns} appointments={appointmentsFromInventory?.filter(a => isToday(safeDate(a.startTime)))} readyForCheckoutAppointments={readyForCheckoutAppointments} selectedAppointmentIds={selectedAppointmentIds} onSelectAppointment={handleSelectAppointment} services={services} staff={staff} onAssignStaff={handleAssignStaff} onAssignNext={() => {}} onCancel={(id, isWalkIn) => { if (!isWalkIn) { const apt = (appointmentsFromInventory || []).find(a => a.id === id); if (apt) { setSelectedAppointment(apt); setIsCancelDialogOpen(true); } } }} onStartService={handleStartService} orderedWaitingQueue={[]} onReorder={() => {}} assignmentMode={assignmentMode} onPrintTicket={(id) => { const item = (walkIns || []).find(w => w.id === id) || (appointmentsFromInventory || []).find(a => a.id === id); if (item) { const client = clients?.find(c => c.id === item.clientId); const service = services?.find(s => s.id === (item.serviceId || item.serviceIds?.[0])); if (client && service) { setTicketToPrint({ business: { name: selectedTenant?.name || 'Studio', phone: selectedTenant?.twilioPhoneNumber || '' }, client, service, appointment: item }); setIsPrintDialogOpen(true); } } }} onSkip={handleSkip} onReturnToQueue={handleReturnToQueue} groupSizes={new Map()} onToggleWaitForStaff={() => {}} onScanClick={() => setIsScannerOpen(true)} onFinishService={handleFinishService} onUpdateStatus={handleUpdateStatus} onRevertToReady={handleRevertToReady} onRevertToService={handleRevertToService} onResolve={(item) => { setSelectedAppointment(item); setIsDetailsOpen(true); }} />
                        <div className="space-y-4 text-left"><h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />Retail & Additions</h3><RetailCatalog services={services || []} inventory={inventory || []} memberships={memberships || []} packages={packages || []} onAddToCart={handleAddToCart} onScanClick={() => setIsScannerOpen(true)} /></div>
                    </div>
                </main>
                <aside className={cn("hidden lg:flex border-l-4 border-muted/30 bg-white flex-col h-full transition-all duration-500 relative overflow-hidden", isCartCollapsed ? "w-20" : "w-full")}>
                    {!isCartCollapsed ? (<div className="flex flex-col h-full w-full"><div className="absolute top-6 left-[-24px] z-50"><Button variant="outline" size="icon" onClick={() => setIsCartCollapsed(true)} className="h-12 w-12 rounded-2xl border-4 border-white bg-white shadow-xl hover:bg-muted text-slate-400 group transition-all"><ChevronRight className="h-6 w-6 group-hover:translate-x-0.5 transition-transform" /></Button></div><div className="absolute inset-0 flex flex-col"><ScrollArea className="flex-1"><div className="p-6 pb-40"><CheckoutHub {...checkoutHubProps} /></div></ScrollArea></div></div>) : (<div className="flex flex-col items-center py-8 gap-8 h-full"><button onClick={() => setIsCartCollapsed(false)} className="h-12 w-12 rounded-2xl bg-primary/5 text-primary hover:bg-primary/10 shadow-sm flex items-center justify-center"><ChevronLeft className="h-6 w-6" /></button><div className="flex flex-col items-center gap-1 [writing-mode:vertical-lr] rotate-180"><span className="font-black uppercase tracking-[0.3em] text-sm text-slate-900 opacity-40">Current Sale</span><span className="font-black text-primary text-xl mt-6 tracking-tighter">${totalCalc.toFixed(2)}</span></div><div className="mt-auto pb-8"><Badge className="rounded-full h-8 w-8 flex items-center justify-center p-0 font-black bg-primary text-white border-none shadow-lg animate-in zoom-in duration-300">{retailItems.length + selectedAppointmentIds.size}</Badge></div></div>)}
                </aside>
            </div>
            {isMobile && (<div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-xl lg:hidden z-40"><Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}><SheetTrigger asChild><Button className="w-full h-14 rounded-2xl text-lg font-black uppercase tracking-tight shadow-2xl shadow-primary/30">View Cart (${totalCalc.toFixed(2)})</Button></SheetTrigger><SheetContent side="bottom" className="h-[95dvh] p-0 flex flex-col border-none rounded-t-[3rem] bg-background"><SheetHeader className="p-8 pb-4 border-b bg-muted/5 flex-shrink-0"><SheetTitle className="text-2xl font-black uppercase tracking-tighter">Current Sale</SheetTitle></SheetHeader><div className="flex-1 overflow-y-auto"><div className="p-6 pb-24"><CheckoutHub {...checkoutHubProps} /></div></div></SheetContent></Sheet></div>)}
            <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={() => {}} />
            <AppointmentDetailsSheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={selectedAppointment} client={clients?.find(c => c.id === selectedAppointment?.clientId) || null} service={services?.find(s => s.id === selectedAppointment?.serviceId) || null} tmhr={selectedTenant?.tmhr || 50} transactions={transactions || []} onStartService={handleStartService} onFinishService={handleFinishService} onEdit={() => {}} onDelete={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))} onCancel={(id) => { const apt = (appointmentsFromInventory || []).find(a => a.id === id); if (apt) { setSelectedAppointment(apt); setIsCancelDialogOpen(true); } }} onReschedule={() => {}} onRebook={() => {}} onBookNewForClient={() => {}} onPrintTicket={() => {}} onOverride={() => setIsOverrideOpen(true)} onWaiveFee={() => {}} />
            {selectedAppointment && <CancelAppointmentDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen} appointment={selectedAppointment} tenant={selectedTenant} onConfirm={async (data) => { if (!selectedAppointment || !firestore || !tenantId) return; const batch = writeBatch(firestore); const updates = { status: 'cancelled' as const, cancellationReason: data.reason, cancellationFeeApplied: data.feeAmount }; batch.update(doc(firestore, `tenants/${tenantId}/appointments`, selectedAppointment.id), updates); if (data.feeAmount > 0 && selectedAppointment.clientId) { batch.update(doc(firestore, `tenants/${tenantId}/clients`, selectedAppointment.clientId), { outstandingBalance: increment(data.feeAmount) }); } await batch.commit(); setIsCancelDialogOpen(false); setIsDetailsOpen(false); }} />}
            <OverrideCancellationDialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen} staff={staff || []} onConfirm={async (sid, res) => { const appointmentRef = doc(firestore!, 'tenants', tenantId!, 'appointments', selectedAppointment!.id); updateDocumentNonBlocking(appointmentRef, { status: 'confirmed', checkInStatus: 'pending', overrideReason: res, overriddenBy: sid }); setIsOverrideOpen(false); setIsDetailsOpen(false); }} />
            {appointmentToReview && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: appointmentToReview, client: (clients || []).find(c => c.id === appointmentToReview.clientId), service: (services || []).find(s => s.id === appointmentToReview.serviceId) }} staff={staff || []} onSendToFrontDesk={async (id, state) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/appointments`, id), { status: 'ready_for_checkout', checkoutState: sanitizeForFirestore(state), actualEndTime: new Date().toISOString() }); setIsTechnicianReviewOpen(false); }} />}
            <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}><DialogContent className="sm:max-w-md p-0 border-4 rounded-[3rem] shadow-3xl"><DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left"><DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Scan Terminal</DialogTitle><DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Authenticate asset codes or session tickets.</DialogDescription></DialogHeader><div className="p-10 relative"><div id="qr-reader-pos" className="w-full aspect-square rounded-3xl bg-muted shadow-inner" /><div className="absolute inset-10 flex items-center justify-center pointer-events-none"><div className="w-2/3 h-1/2 border-4 border-primary rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" /></div></div><DialogFooter className="p-6 pt-4 border-t bg-muted/5"><Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button" className="w-full h-14 rounded-2xl font-bold uppercase tracking-widest text-xs">Close Scanner</Button></DialogFooter></DialogContent></Dialog>
            <TillManagement open={isTillManagementOpen} onOpenChange={setIsTillManagementOpen} activeTill={activeTill} staff={staff || []} onOpenTill={handleOpenTill} onCloseTill={handleCloseTill} requireTillWitness={selectedTenant?.requireTillWitness !== false} />
            <CheckInConfirmationDialog open={!!pendingCheckInItem} onOpenChange={() => setPendingCheckInItem(null)} item={pendingCheckInItem} services={services || []} tenant={selectedTenant} onConfirm={handleResolveCheckInConfirmation} />
            <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}><DialogContent className="max-w-sm rounded-[2rem] border-2 shadow-3xl p-0 overflow-hidden text-center"><DialogHeader className="p-6 bg-muted/5 border-b"><DialogTitle className="text-xl font-bold uppercase tracking-tight text-center text-slate-900 leading-none">Ticket Issued</DialogTitle></DialogHeader><div className="flex justify-center p-8 bg-white text-center">{ticketToPrint && <PrintTicket data={ticketToPrint} />}</div><DialogFooter className="p-6 border-t bg-muted/5"><Button className="w-full h-12 rounded-xl text-lg font-bold uppercase tracking-widest shadow-xl shadow-primary/20" onClick={() => { window.print(); setIsPrintDialogOpen(false); }}>Authorize Print</Button></DialogFooter></DialogContent></Dialog>
        </div>
    );
}

export default function POSPageWrapper() { return <Suspense fallback={<div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Terminal...</p></div>}><POSPage /></Suspense>; }
