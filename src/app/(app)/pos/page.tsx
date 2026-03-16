'use client';

import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, getServicePrice, type AppointmentCheckoutState, type Redemption, type TillSession } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { Button } from '@/components/ui/button';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, query, where, deleteField } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, addMinutes, isToday, isSameDay, startOfDay, endOfDay, format, subMinutes, differenceInDays } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Clock, TrendingUp, Users, DollarSign, QrCode, Loader, Play, XCircle, Fingerprint, UserPlus, Sparkles, ChevronRight, ChevronLeft, ShoppingCart, Square, Wallet, AlertTriangle, MapPin, ShieldCheck, ArrowRight, Info, CheckCircle2, Ban, ShieldAlert, Landmark } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';
import { Html5Qrcode } from 'html5-qrcode';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { TillManagement } from '@/components/pos/TillManagement';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val?.toDate === 'function') return val.toDate();
    return new Date(val);
};

const KpiCard = ({ title, value, icon, description, iconBgColor }: { title: string; value: string; icon: React.ReactNode, description: string, iconBgColor: string }) => (
  <Card className="border-2 shadow-sm overflow-hidden bg-white/50 backdrop-blur-sm">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 md:p-4 pb-2">
      <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
      <div className={cn("p-1.5 md:p-2 rounded-xl", iconBgColor)}>
        {React.cloneElement(icon as React.ReactElement, { className: 'w-3.5 h-3.5 md:w-4 md:h-4' })}
      </div>
    </CardHeader>
    <CardContent className="p-3 md:p-4 pt-0">
      <div className="text-xl md:text-3xl font-black tracking-tighter text-slate-900">{value}</div>
      <p className="text-[9px] md:text-[10px] font-bold text-muted-foreground uppercase mt-1 opacity-60 truncate">{description}</p>
    </CardContent>
  </Card>
);

const PolicyEnforcementDialog = ({ open, onOpenChange, data, staff, onResolve }: { open: boolean, onOpenChange: (open: boolean) => void, data: any, staff: Staff[], onResolve: (action: 'charge_cancel' | 'charge_accommodate' | 'waive_accommodate' | 'decline_void', finalFee: number) => void }) => {
    const [pin, setPin] = useState('');
    const { toast } = useToast();

    const handleAction = (action: 'charge_cancel' | 'charge_accommodate' | 'waive_accommodate' | 'decline_void') => {
        if (action === 'waive_accommodate') {
            const authorized = staff.find(s => s.pin === pin && (s.role === 'admin' || s.role === 'owner'));
            if (!authorized) {
                toast({ variant: 'destructive', title: 'Invalid PIN', description: 'Manager authorization required to waive protocol fees.' });
                return;
            }
        }
        onResolve(action, data.fee);
        setPin('');
    };

    if (!data) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden bg-background">
                <DialogHeader className="p-6 pb-8 border-b bg-muted/5 text-left">
                    <div className="flex items-center gap-3 mb-2">
                        <AlertTriangle className="w-5 h-5 text-destructive" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Protocol Intervention</span>
                    </div>
                    <DialogTitle className="text-xl md:text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">Status Resolution</DialogTitle>
                    <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Guest: {data.appointment.clientName}</DialogDescription>
                </DialogHeader>
                <div className="p-6 md:p-8 space-y-8">
                    <div className="p-6 rounded-[2rem] bg-destructive/5 border-2 border-destructive/10 text-center space-y-2 shadow-inner">
                        <p className="text-[9px] font-black uppercase text-destructive/60 tracking-widest">Protocol Recovery Fee</p>
                        <p className="text-4xl md:text-6xl font-black text-destructive tracking-tighter font-mono">${Math.ceil(data.fee).toFixed(2)}</p>
                        <div className="pt-3 border-t border-destructive/10">
                            <p className="text-[10px] font-bold text-slate-600 uppercase">Penalty for +{data.minutes}m delay</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        <Button 
                            variant="destructive" 
                            className="h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-destructive/20"
                            onClick={() => handleAction('charge_cancel')}
                        >
                            <DollarSign className="w-4 h-4 mr-2" /> Charge & Cancel
                        </Button>
                        <Button 
                            className="h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg"
                            onClick={() => handleAction('charge_accommodate')}
                        >
                            <Clock className="w-4 h-4 mr-2" /> Charge & Accommodate
                        </Button>
                        
                        <div className="space-y-3 pt-4 border-t border-dashed">
                            <div className="flex items-center justify-between px-1">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Manager Override</Label>
                                <ShieldCheck className="w-3 h-3 text-primary" />
                            </div>
                            <div className="flex gap-2">
                                <Input 
                                    type="password" 
                                    placeholder="PIN" 
                                    maxLength={4} 
                                    value={pin}
                                    onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                                    className="h-14 rounded-2xl border-2 text-center text-xl font-black tracking-[0.5em] w-32 bg-muted/5 shadow-inner"
                                />
                                <Button 
                                    variant="outline" 
                                    className="h-14 rounded-2xl border-2 flex-1 font-black uppercase text-[10px] tracking-widest"
                                    onClick={() => handleAction('waive_accommodate')}
                                >
                                    Waive & Accommodate
                                </Button>
                            </div>
                        </div>

                        <Button 
                            variant="ghost" 
                            className="h-10 font-bold uppercase text-[9px] text-muted-foreground hover:text-destructive"
                            onClick={() => handleAction('decline_void')}
                        >
                            Void Protocol without Penalty
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

function POSPage() {
    const { inventory, services, appointments: appointmentsFromInventory, clients, walkIns, staff, transactions, activityLogs, memberships, packages, resources, discounts, tillSessions, isLoading: isInventoryLoading } = useInventory();
    const { firestore, user: currentUser } = useFirebase();
    const { selectedTenant, role } = useTenant();
    const tenantId = selectedTenant?.id;
    const router = useRouter();
    const isMobile = useIsMobile();
    const searchParams = useSearchParams();

    const isOwnerOrAdmin = role === 'owner' || role === 'admin';

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
    const [confirmation, setConfirmation] = useState<{ isOpen: boolean; title: string; description: string; onConfirm: () => void; } | null>(null);

    const { toast } = useToast();

    const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
    const [appliedAdjustments, setAppliedAdjustments] = useState<Set<string>>(new Set());
    const [redeemedOffer, setRedeemedOffer] = useState<{ type: 'membership' | 'package'; id: string; itemId?: string } | null>(null);
    const [waivedAppointmentFees, setWaivedAppointmentFees] = useState<Map<string, { authorizerId: string; reason: string }>>(new Map());

    const [policyEnforcementData, setPolicyEnforcementData] = useState<any | null>(null);

    const activeTill = useMemo(() => tillSessions?.find(s => s.status === 'open') || null, [tillSessions]);

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

    const kpiData = useMemo(() => {
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        const walkInsToday = (walkIns || []).filter(w => {
            const checkInDate = safeDate(w.checkInTime);
            return checkInDate >= todayStart && checkInDate <= todayEnd;
        });

        const completedWalkIns = walkInsToday.filter(w => (w.status === 'completed' || w.status === 'servicing') && w.serviceStartTime);
        const waitTimes = completedWalkIns.map(w => differenceInMinutes(safeDate(w.serviceStartTime), safeDate(w.checkInTime)));
        const avgWaitTime = waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0;

        const convertedCount = walkInsToday.filter(w => ['servicing', 'completed', 'ready_for_checkout'].includes(w.status)).length;
        const walkInConversionRate = walkInsToday.length > 0 ? (convertedCount / walkInsToday.length) * 100 : 0;

        const dailyTransactions = (transactions || []).filter(t => {
            const d = safeDate(t.date);
            return d >= todayStart && d <= todayEnd && t.type === 'income';
        });
        const totalDailyGrossRevenue = dailyTransactions.reduce((acc, t) => acc + t.amount, 0);

        return {
            avgWaitTime,
            walkInConversionRate,
            totalWalkIns: walkInsToday.length,
            totalDailyGrossRevenue
        };
    }, [walkIns, transactions]);

    const payerOptions = useMemo(() => {
        if (selectedAppointmentIds.size === 0) return clients || [];
        const clientIds = new Set<string>();
        selectedAppointmentIds.forEach(aptId => {
          const apt = readyForCheckoutAppointments.find(a => a.id === aptId);
          if (apt?.client?.id) {
            clientIds.add(apt.client.id);
          }
        });
        return (clients || []).filter(c => clientIds.has(c.id));
    }, [selectedAppointmentIds, readyForCheckoutAppointments, clients]);

    useEffect(() => {
        const payerId = searchParams.get('payer_id');
        const action = searchParams.get('action');
        
        if (payerId && clients && clients.length > 0) {
            const targetClient = clients.find(c => c.id === payerId);
            if (targetClient) {
                setSelectedClientId(payerId);
                if (action === 'settle' && targetClient.unpaidFees) {
                    const feeIds = targetClient.unpaidFees.map(f => f.feeId);
                    const nextAdjustments = new Set<string>();
                    feeIds.forEach(id => nextAdjustments.add(id));
                    onApplyAdjustmentToggle(nextAdjustments);
                    
                    if (targetClient.cardOnFile?.token) {
                        setPaymentTab('card_on_file');
                    }
                    toast({ title: "Settlement Staged", description: `Pre-populated ${feeIds.length} unpaid fees from ${targetClient.name}'s dossier.` });
                }
            }
        }
    }, [searchParams, clients, toast]);

    const handleSelectAppointment = useCallback((id: string) => {
        const nextIds = new Set(selectedAppointmentIds);
        let nextClientId = selectedClientId;

        if (nextIds.has(id)) {
            nextIds.delete(id);
            if (nextIds.size === 0) nextClientId = null;
        } else {
            nextIds.add(id);
            const aptData = readyForCheckoutAppointments.find(a => a.id === id);
            if (aptData?.client?.id) {
                nextClientId = aptData.client.id;
            }
        }
        
        setSelectedAppointmentIds(nextIds);
        setSelectedClientId(nextClientId);
    }, [readyForCheckoutAppointments, selectedClientId, selectedAppointmentIds]);

    const selectedAptsData = useMemo(() => 
        Array.from(selectedAppointmentIds)
            .map(id => readyForCheckoutAppointments.find(a => a.id === id))
            .filter(Boolean) as any[]
    , [selectedAppointmentIds, readyForCheckoutAppointments]);

    const subtotal = useMemo(() => {
        const servicesSub = selectedAptsData.reduce((acc, data) => {
            const isServiceRedeemed = redeemedOffer?.itemId === data.service.id;
            const mainPrice = isServiceRedeemed ? 0 : getServicePrice(data.service, data.staff);
            
            const addonsPrice = (data.addOnServices || []).reduce((sum: number, s: any) => {
                const isAddonRedeemed = redeemedOffer?.itemId === s.id;
                const addonStaffId = data.appointment.checkoutState?.serviceStaffOverrides?.[s.id] || data.appointment.staffId;
                const addonStaff = staff.find(st => st.id === addonStaffId);
                return sum + (isAddonRedeemed ? 0 : getServicePrice(s, addonStaff));
            }, 0);
            
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
    }, [selectedAptsData, retailItems, appliedAdjustments, clients, waivedAppointmentFees, staff, redeemedOffer]);

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
            const aptRef = doc(firestore, 'tenants', tenantId, 'appointments', `apt-walkin-${walkInId}`);
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

    const handleStartService = (appointmentId: string) => {
      if (!firestore || !tenantId || !appointmentsFromInventory) return;
      const appointment = (appointmentsFromInventory || []).find(a => a.id === appointmentId) || (appointmentsFromInventory || []).find(a => a.id === `apt-walkin-${appointmentId}`);
      if (!appointment) return;
      const nowISO = new Date().toISOString();
      const batch = writeBatch(firestore);
      batch.set(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { status: 'servicing', actualStartTime: nowISO }, { merge: true });
      if (appointment.checkInToken) batch.set(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'servicing', tenantId }, { merge: true });
      
      if (appointment.staffId) {
          batch.set(doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId), { status: 'busy' }, { merge: true });
      }

      const concurrentIds = appointment.checkoutState?.concurrentServiceIds || [];
      const overrides = appointment.checkoutState?.serviceStaffOverrides || {};
      concurrentIds.forEach(svcId => {
          const assignedStaffId = overrides[svcId];
          if (assignedStaffId) {
              const assistantRef = doc(firestore, 'tenants', tenantId, 'staff', assignedStaffId);
              batch.set(assistantRef, { status: 'busy' }, { merge: true });
          }
      });

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
      const personServices = (walkIn.serviceIds || []).map(id => (services || []).find(s => s.id === id)).filter(Boolean) as Service[];
      const duration = personServices.reduce((acc, s) => acc + s.duration, 0);
      const appointmentId = `apt-walkin-${walkIn.id}`;
      setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { id: appointmentId, tenantId, clientId: walkIn.clientId || walkIn.id, clientName: walkIn.customerName, serviceId: walkIn.serviceIds[0], staffId, status: 'confirmed', source: 'walk-in', isWalkIn: true, startTime: new Date().toISOString(), endTime: addMinutes(new Date(), duration).toISOString() }, {});
      toast({ title: "Staff Assigned" });
    };

    const handleCancelAction = (id: string, isWalkIn: boolean) => {
        if (!isWalkIn) { 
            const apt = (appointmentsFromInventory || []).find(a => a.id === id);
            if (apt) {
                setSelectedAppointment(apt);
                setIsCancelDialogOpen(true);
            }
            return; 
        }
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

    const handleConfirmCancellation = async (data: any) => {
        if (!selectedAppointment || !firestore || !tenantId) return;
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id);
        const clientRef = doc(firestore, 'tenants', tenantId, 'clients', selectedAppointment.clientId);
        const currentClient = clients?.find(c => c.id === selectedAppointment.clientId);
        const batch = writeBatch(firestore);
        const now = new Date().toISOString();

        batch.update(appointmentRef, { 
            status: 'cancelled', 
            cancellationReason: data.reason, 
            cancellationFeeApplied: data.feeAmount, 
            cancellationPaymentStatus: data.paymentMethod === 'card_on_file' ? 'paid' : (data.paymentMethod === 'waived' ? 'waived' : 'unpaid') 
        });
        
        if (selectedAppointment.checkInToken) {
            batch.update(doc(firestore, 'appointmentCheckIns', selectedAppointment.checkInToken), { status: 'cancelled', cancellationReason: data.reason, tenantId });
        }

        if (data.chargeFee && data.feeAmount > 0) {
            if (data.paymentMethod === 'card_on_file') {
                batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { date: now, description: `Cancellation Fee: ${selectedAppointment.clientName}`, clientOrVendor: selectedAppointment.clientName || 'Client', clientId: selectedAppointment.clientId, type: 'income', context: 'Business', category: 'Cancellation Fee', amount: data.feeAmount, paymentMethod: 'Card on File', hasReceipt: false, appointmentId: selectedAppointment.id, staffId: selectedAppointment.staffId });
            } else if (data.paymentMethod === 'add_to_balance') {
                batch.update(clientRef, { unpaidFees: arrayUnion({ feeId: nanoid(), appointmentId: selectedAppointment.id, appointmentDate: safeDate(selectedAppointment.startTime).toISOString(), feeAmount: data.feeAmount, reason: `Late Cancellation: ${data.reason.replace('_', ' ')}`, staffId: selectedAppointment.staffId }), outstandingBalance: increment(data.feeAmount) });
            }
        }

        if (currentClient && (data.reason === 'late' || data.reason === 'no-show' || data.reason === 'client_request' || data.reason === 'other')) {
            const isLateOrNoShow = data.reason === 'late' || data.reason === 'no-show';
            if (currentClient.activeMembershipId && memberships) {
                const membership = memberships.find(m => m.id === currentClient.activeMembershipId);
                const shouldForfeit = (data.reason === 'no-show' && membership?.forfeitOnNoShow) || ((data.reason === 'late' || data.reason === 'client_request' || data.reason === 'other') && membership?.forfeitOnLateCancel);
                if (shouldForfeit) {
                    const perkId = selectedAppointment.serviceId;
                    const currentUsage = currentClient.subscription?.perkUsage || {};
                    const nextUsage = { ...currentUsage, [perkId]: (currentUsage[perkId] || 0) + 1 };
                    batch.update(clientRef, { 'subscription.perkUsage': nextUsage, 'subscription.perkLastUsed': now });
                    const redemptionRef = doc(collection(firestore, `tenants/${tenantId}/clients/${currentClient.id}/redemptions`));
                    batch.set(redemptionRef, { id: redemptionRef.id, clientId: currentClient.id, type: 'membership', offeringId: membership!.id, offeringName: membership!.name, serviceId: selectedAppointment.serviceId, serviceName: services?.find(s => s.id === selectedAppointment.serviceId)?.name || 'Service', date: now, staffId: currentUser?.uid, isForfeit: true });
                }
            }
            const activePack = currentClient.activePackages?.find(p => { const pkgDef = packages?.find(pkg => pkg.id === p.packageId); return pkgDef?.serviceId === selectedAppointment.serviceId; });
            if (activePack && (isLateOrNoShow || data.reason === 'client_request' || data.reason === 'other')) {
                const nextPackages = currentClient.activePackages!.map(p => { if (p.packageId === activePack.packageId) return { ...p, sessionsRemaining: p.sessionsRemaining - 1 }; return p; }).filter(p => p.sessionsRemaining > 0);
                batch.update(clientRef, { activePackages: nextPackages });
                const redemptionRef = doc(collection(firestore, `tenants/${tenantId}/clients/${currentClient.id}/redemptions`));
                const pkgDef = packages?.find(pkg => pkg.id === activePack.packageId);
                batch.set(redemptionRef, { id: redemptionRef.id, clientId: currentClient.id, type: 'package', offeringId: activePack.packageId, offeringName: pkgDef?.name || 'Package', serviceId: selectedAppointment.serviceId, serviceName: services?.find(s => s.id === selectedAppointment.serviceId)?.name || 'Service', date: now, staffId: currentUser?.uid, isForfeit: true });
            }
        }

        try {
            await batch.commit();
            toast({ title: "Policy Enforced", description: "Appointment voided and logic reconciled." });
        } catch (e) {
            console.error("Cancellation failed:", e);
            toast({ variant: 'destructive', title: "Process Error" });
        }
        setIsCancelDialogOpen(false);
        setIsDetailsOpen(false);
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

    const handleForceIdle = (staffId: string) => {
        if (!firestore || !tenantId) return;
        const staffRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
        setDocumentNonBlocking(staffRef, { status: 'idle' }, { merge: true });
        toast({ title: "Staff Reset", description: "Technician is now marked as idle." });
    };

    const handleUpdateStatus = (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => {
        if (!firestore || !tenantId || !selectedTenant) return;
        const docRef = isWalkIn ? doc(firestore, 'tenants', tenantId, 'walkIns', id) : doc(firestore, 'tenants', tenantId, 'appointments', id);
        const tmhr = selectedTenant.tmhr || 50;
        const premium = selectedTenant.lateInconveniencePremium || 0;

        if (status === 'running_late' && lateMinutes && !isWalkIn) {
            const apt = (appointmentsFromInventory || []).find(a => a.id === id);
            if (apt) {
                const grace = selectedTenant.lateArrivalGracePeriod || 15;
                const primarySvc = (services || []).find(s => s.id === apt.serviceId);
                const addOns = (apt.addOnIds || []).map(aid => (services || []).find(s => s.id === aid)).filter(Boolean) as Service[];
                const totalDur = (primarySvc?.duration || 0) + addOns.reduce((sum, a) => sum + a.duration, 0);
                const totalPadding = (primarySvc?.padBefore || 0) + (primarySvc?.padAfter || 0);
                const fullSessionBlock = totalDur + totalPadding;
                const staffId = apt.staffId;
                let clash = null;
                if (staffId) {
                    const theoreticalStart = addMinutes(safeDate(apt.startTime), lateMinutes);
                    const theoreticalEnd = addMinutes(theoreticalStart, fullSessionBlock);
                    const nextApt = (appointmentsFromInventory || [])
                        .filter(a => a.staffId === staffId && a.id !== apt.id && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > safeDate(apt.startTime))
                        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];
                    if (nextApt) {
                        const nextService = (services || []).find(s => s.id === nextApt.serviceId);
                        const nextStartWithPad = subMinutes(safeDate(nextApt.startTime), nextService?.padBefore || 0);
                        if (theoreticalEnd > nextStartWithPad) clash = { nextApt, clashTime: format(nextStartWithPad, 'h:mm a') };
                    }
                }
                if (lateMinutes > grace || clash) {
                    const timeLostCost = (lateMinutes / 60) * tmhr;
                    const fee = Math.ceil(timeLostCost + premium);
                    setPolicyEnforcementData({ id, isWalkIn, fee, reason: clash ? 'clash' : 'late', minutes: lateMinutes, appointment: apt, service: primarySvc, fullSessionBlock });
                    return;
                }
            }
        }
        updateDocumentNonBlocking(docRef, { checkInStatus: status, lateTimeMinutes: lateMinutes ?? 0 });
        toast({ title: "Status Updated" });
    };

    const handleResolvePolicyEnforcement = async (action: 'charge_cancel' | 'charge_accommodate' | 'waive_accommodate' | 'decline_void', finalFee: number) => {
        if (!policyEnforcementData || !firestore || !tenantId) return;
        const { appointment: apt, reason, id, isWalkIn, minutes } = policyEnforcementData;
        const docRef = isWalkIn ? doc(firestore, 'tenants', tenantId, 'walkIns', id) : doc(firestore, 'tenants', tenantId, 'appointments', id);
        const fee = Math.ceil(finalFee);
        const batch = writeBatch(firestore);
        const now = new Date().toISOString();
        if (action === 'charge_cancel') {
            batch.update(docRef, { checkInStatus: 'auto_cancelled', status: 'cancelled', lateTimeMinutes: minutes, cancellationReason: reason, cancellationFeeApplied: fee, cancellationPaymentStatus: 'paid' });
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { date: now, description: `Late Protocol Fee: ${apt.clientName}`, clientOrVendor: apt.clientName || 'Client', clientId: apt.clientId, type: 'income', context: 'Business', category: 'Cancellation Fee', amount: fee, paymentMethod: 'Card on File', hasReceipt: false, appointmentId: id, staffId: apt.staffId });
            toast({ title: "Fee Charged & Voided" });
        } else if (action === 'charge_accommodate') {
            batch.update(docRef, { checkInStatus: 'running_late', lateTimeMinutes: minutes, status: 'confirmed' });
            if (fee > 0 && apt.clientId) {
                batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion({ feeId: nanoid(), appointmentId: id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Late Arrival Penalty: +${minutes}m (Accommodated)` }) });
            }
            toast({ title: "Charged & Restored" });
        } else if (action === 'waive_accommodate') {
            batch.update(docRef, { checkInStatus: 'running_late', lateTimeMinutes: minutes, status: 'confirmed', cancellationFeeWaived: true });
            toast({ title: "Protocol Waived" });
        } else {
            batch.update(docRef, { checkInStatus: 'auto_cancelled', status: 'cancelled', lateTimeMinutes: minutes, cancellationReason: reason });
            toast({ title: "Session Voided" });
        }
        await batch.commit();
        setPolicyEnforcementData(null);
    };

    const handleResolve = (item: any) => {
        if (item.checkInStatus === 'auto_cancelled') {
            const tmhrValue = selectedTenant?.tmhr || 50;
            const premiumValue = selectedTenant?.lateInconveniencePremium || 0;
            const serviceObj = services?.find(s => s.id === item.serviceId);
            const addOns = (item.addOnIds || []).map(aid => services?.find(s => s.id === aid)).filter(Boolean) as Service[];
            const totalDur = (serviceObj?.duration || 0) + addOns.reduce((sum, a) => sum + a.duration, 0);
            const totalPadding = (serviceObj?.padBefore || 0) + (serviceObj?.padAfter || 0);
            const fee = Math.ceil(((totalDur + totalPadding) / 60) * tmhrValue + premiumValue);
            setPolicyEnforcementData({ id: item.id, isWalkIn: !!item.isWalkIn, fee, reason: 'late', minutes: item.lateTimeMinutes || 0, appointment: item, service: serviceObj, fullSessionBlock: totalDur + totalPadding });
        } else { setSelectedAppointment(item); setIsDetailsOpen(true); }
    };

    const handleStaffReorder = (newOrder: Staff[]) => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        newOrder.forEach((s, idx) => { batch.set(doc(firestore, 'tenants', tenantId, 'staff', s.id), { turnOrder: idx }, { merge: true }); });
        batch.commit();
    };

    const handleAssignNext = () => {
        const waiting = (walkIns || []).filter(w => w.status === 'waiting').sort((a,b) => (a.queueOrder || 0) - (b.queueOrder || 0));
        const idle = (staff || []).filter(s => s.active && !s.onBreak && s.status === 'idle');
        if (waiting.length && idle.length) handleAssignStaff(waiting[0], idle[0].id);
    };

    const handleFinishService = (apt: Appointment) => { setAppointmentToReview(apt); setIsTechnicianReviewOpen(true); };

    const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
        if (!firestore || !tenantId) return;
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
        const apt = (appointmentsFromInventory || []).find(a => a.id === appointmentId);
        if (!apt) return;
        const allPartIds = [apt.serviceId, ...(apt.addOnIds || [])];
        const completedIds = checkoutState.completedServiceIds || [];
        const allComplete = completedIds.length >= allPartIds.length;
        const batch = writeBatch(firestore);
        if (allComplete) {
            batch.update(appointmentRef, { status: 'ready_for_checkout', checkoutState, actualEndTime: new Date().toISOString() });
            if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'ready_for_checkout', tenantId });
            const involvedIds = new Set<string>();
            if (apt.staffId) involvedIds.add(apt.staffId);
            if (checkoutState.serviceStaffOverrides) Object.values(checkoutState.serviceStaffOverrides).forEach((id: any) => { if (id && typeof id === 'string') involvedIds.add(id); });
            involvedIds.forEach(sid => { batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true }); });
        } else {
            batch.update(appointmentRef, { checkoutState });
            const overrides = checkoutState.serviceStaffOverrides || {};
            const involvedStaffIdsSet = new Set<string>();
            if (apt.staffId) involvedStaffIdsSet.add(apt.staffId);
            Object.values(overrides).forEach((id: any) => { if (id && typeof id === 'string') involvedStaffIdsSet.add(id); });
            involvedStaffIdsSet.forEach(sid => {
                const hasRemainingParts = allPartIds.some(pid => !completedIds.includes(pid) && (overrides[pid] === sid || (pid === apt.serviceId && apt.staffId === sid && !overrides[pid])));
                if (!hasRemainingParts) batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true });
            });
            const nextPartId = allPartIds.find(id => !completedIds.includes(id) && !(checkoutState.concurrentServiceIds || []).includes(id));
            const nextStaffId = overrides[nextPartId || ''] || (nextPartId === apt.serviceId ? apt.staffId : null);
            if (nextStaffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', nextStaffId), { status: 'busy' }, { merge: true });
        }
        batch.commit().then(() => { toast({ title: allComplete ? "Service Finished" : "Part Completed" }); setIsTechnicianReviewOpen(false); setIsDetailsOpen(false); });
    };

    const onApplyAdjustmentToggle = (ids: string | Set<string>, apply: boolean = true) => {
        setAppliedAdjustments((prev: Set<string>) => {
            const next = new Set(prev);
            if (typeof ids === 'string') {
                apply ? next.add(ids) : next.delete(ids);
            } else {
                ids.forEach((id: string) => apply ? next.add(id) : next.delete(id));
            }
            return next;
        });
    };

    const handleCheckout = async (paymentData: {paymentMethod: string, amountTendered: number}) => {
        if (!selectedClientId || !firestore || !tenantId) return;
        setIsSubmitting(true);
        const batch = writeBatch(firestore);
        const now = new Date().toISOString();
        const selectedClient = (clients || []).find(c => c.id === selectedClientId);
        let totalLtvIncrease = 0;
        let totalCashIncrease = 0;
        
        let cashTipsTotal = 0;
        const cashTipsByStaffUpdate: Record<string, number> = {};

        for (const aptData of selectedAptsData) {
            const { appointment: apt, service, addOnServices } = aptData;
            const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', apt.id);
            const checkoutState = apt.checkoutState || {};
            const overrides = checkoutState.serviceStaffOverrides || {};
            const isWaived = waivedAppointmentFees.has(apt.id);
            const additional = !isWaived ? (checkoutState.additionalCharge || 0) : 0;
            const formula = checkoutState.formula || [];
            formula.forEach((item: any) => {
                const product = (inventory || []).find(p => p.id === item.id);
                if (!product) return;
                const productRef = doc(firestore, 'tenants', tenantId, 'inventory', item.id);
                const updateData: any = {};
                if (product.costingMethod === 'uses') {
                    let currentUses = product.partialContainerUses || 0;
                    let currentStock = product.totalStock;
                    const usesPerContainer = product.estimatedUses || 1;
                    currentUses -= item.quantity;
                    while (currentUses <= 0 && currentStock > 0) { currentStock -= 1; currentUses += usesPerContainer; }
                    updateData.totalStock = currentStock; updateData.partialContainerUses = currentUses;
                } else if (product.costingMethod === 'size' && product.size) {
                    let currentSize = product.partialContainerSize || 0;
                    let currentStock = product.totalStock;
                    const sizePerContainer = product.size || 1;
                    currentSize -= item.quantity;
                    while (currentSize <= 0 && currentStock > 0) { currentStock -= 1; currentSize += sizePerContainer; }
                    updateData.totalStock = currentStock; updateData.partialContainerSize = currentSize;
                } else updateData.totalStock = (product.totalStock || 0) - item.quantity;
                batch.update(productRef, updateData);
                const scRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
                batch.set(scRef, { productId: item.id, date: now, change: -item.quantity, unit: item.unit || 'units', reason: `Service: ${service.name} for ${selectedClient?.name || 'Guest'}`, appointmentId: apt.id });
            });
            const mainStaffId = overrides[service.id] || apt.staffId;
            const mainStaffMember = (staff || []).find(s => s.id === mainStaffId);
            const isMainRedeemed = redeemedOffer?.itemId === service.id;
            const mainPartRevenue = (isMainRedeemed ? 0 : getServicePrice(service, mainStaffMember)) + additional; 
            totalLtvIncrease += mainPartRevenue;
            if (paymentData.paymentMethod === 'cash') totalCashIncrease += mainPartRevenue;

            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { date: now, description: isMainRedeemed ? `Redemption: ${service.name}` : `Service: ${service.name}`, clientOrVendor: selectedClient?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Service Revenue', amount: mainPartRevenue, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: true });
            addOnServices.forEach((addon: any) => {
                const addonStaffId = overrides[addon.id] || apt.staffId;
                const addonStaffMember = staff.find((s: any) => s.id === addonStaffId);
                const isAddonRedeemed = redeemedOffer?.itemId === addon.id;
                const addonPrice = isAddonRedeemed ? 0 : getServicePrice(addon, addonStaffMember);
                totalLtvIncrease += addonPrice;
                if (paymentData.paymentMethod === 'cash') totalCashIncrease += addonPrice;
                batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { date: now, description: isAddonRedeemed ? `Redemption: ${addon.name}` : `Add-on: ${addon.name}`, clientOrVendor: selectedClient?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Service Revenue', amount: addonPrice, paymentMethod: paymentData.paymentMethod, staffId: addonStaffId, appointmentId: apt.id, hasReceipt: true });
            });
            batch.update(appointmentRef, { status: 'completed', revenue: totalLtvIncrease, actualEndTime: now });
            if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'completed' });
            const involvedIds = new Set<string>(); if (apt.staffId) involvedIds.add(apt.staffId);
            if (overrides) Object.values(overrides).forEach((id: any) => { if (id && typeof id === 'string') involvedIds.add(id); });
            involvedIds.forEach(sid => { batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true }); });
        }
        const retailTotalValue = retailItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        retailItems.forEach(item => {
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { date: now, description: `Retail: ${item.quantity}x ${item.name}`, clientOrVendor: selectedClient?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Retail', amount: item.price * item.quantity, paymentMethod: paymentData.paymentMethod, hasReceipt: true });
            batch.update(doc(firestore, 'tenants', tenantId, 'inventory', item.id), { totalStock: increment(-item.quantity) });
            batch.set(doc(collection(firestore, `tenants/${tenantId}/stockCorrections`)), { productId: item.id, date: now, change: -item.quantity, unit: 'units', reason: `Retail Sale: ${item.name} for ${selectedClient?.name || 'Guest'}` });
        });
        totalLtvIncrease += retailTotalValue;
        if (paymentData.paymentMethod === 'cash') totalCashIncrease += retailTotalValue;

        if (selectedClient && appliedAdjustments.size > 0) {
            const currentUnpaid = selectedClient.unpaidFees || [];
            const settledTotal = Array.from(appliedAdjustments).reduce((sum, id) => { const fee = currentUnpaid.find(f => f.feeId === id); return sum + (fee?.feeAmount || 0); }, 0);
            batch.update(doc(firestore, `tenants/${tenantId}/clients`, selectedClient.id), { unpaidFees: currentUnpaid.filter(f => !appliedAdjustments.has(f.feeId)), outstandingBalance: increment(-settledTotal) });
            if (paymentData.paymentMethod === 'cash') totalCashIncrease += settledTotal;
            appliedAdjustments.forEach(id => {
                const fee = currentUnpaid.find(f => f.feeId === id);
                if (fee) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { date: now, description: `Debt Settlement: ${fee.reason}`, clientOrVendor: selectedClient.name, clientId: selectedClientId, type: 'income', context: 'Business', category: 'Fee Recovery', amount: fee.feeAmount, paymentMethod: paymentData.paymentMethod, hasReceipt: false });
            });
        }
        if (selectedClient) {
            const updates: any = { lifetimeValue: increment(totalLtvIncrease), lastAppointment: now };
            if (redeemedOffer) {
                const redemptionRef = doc(collection(firestore, `tenants/${tenantId}/clients/${selectedClientId}/redemptions`));
                const offeringName = redeemedOffer.type === 'membership' ? memberships?.find(m => m.id === redeemedOffer.id)?.name : packages?.find(p => p.id === redeemedOffer.id)?.name;
                batch.set(redemptionRef, { id: redemptionRef.id, clientId: selectedClientId, type: redeemedOffer.type, offeringId: redeemedOffer.id, offeringName: offeringName || 'Offer', serviceId: redeemedOffer.itemId, serviceName: services?.find(s => s.id === redeemedOffer.itemId)?.name || 'Service', date: now, staffId: currentUser?.uid });
                if (redeemedOffer.type === 'package') updates.activePackages = (selectedClient.activePackages || []).map(p => p.packageId === redeemedOffer.id ? { ...p, sessionsRemaining: p.sessionsRemaining - 1 } : p).filter(p => p.sessionsRemaining > 0);
                else { updates['subscription.perkUsage.' + redeemedOffer.itemId] = increment(1); updates['subscription.perkLastUsed'] = now; }
            }
            batch.update(doc(firestore, `tenants/${tenantId}/clients`, selectedClient.id), updates);
        }
        
        Object.entries(tipAllocations).forEach(([staffId, amount]) => {
            if ((amount as number) > 0) {
                batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { date: now, description: 'Gratuity', clientOrVendor: selectedClient?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Tips', amount, paymentMethod: paymentData.paymentMethod, staffId, hasReceipt: true });
                if (paymentData.paymentMethod === 'cash') {
                    cashTipsTotal += (amount as number);
                    cashTipsByStaffUpdate[`cashTipsByStaff.${staffId}`] = increment(amount as number);
                }
            }
        });
        
        if (discount > 0) {
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { date: now, description: `Promotion Applied`, clientOrVendor: 'Internal', clientId: selectedClientId, type: 'expense', context: 'Business', category: 'Discounts', amount: discount, paymentMethod: 'Internal', hasReceipt: false });
        }

        if (paymentData.paymentMethod === 'cash' && activeTill) {
            const finalCashInput = totalCashIncrease + tax + cashTipsTotal;
            batch.update(doc(firestore, `tenants/${tenantId}/tillSessions`, activeTill.id), { 
                expectedCash: increment(finalCashInput),
                totalCashSales: increment(totalCashIncrease + tax),
                totalCashTips: increment(cashTipsTotal),
                ...cashTipsByStaffUpdate
            });
        }

        try {
            await batch.commit();
            toast({ title: "Checkout Successful" });
            setRetailItems([]); setSelectedAppointmentIds(new Set()); setTipAmount(0); setIsCartSheetOpen(false); setRedeemedOffer(null); setAppliedDiscountCodes([]); setAppliedAdjustments(new Set());
        } catch (e) {
            console.error(e); toast({ variant: 'destructive', title: 'Checkout Failed' });
        } finally { setIsSubmitting(false); }
    };

    const handleOpenTill = async (data: any) => {
        if (!firestore || !tenantId) return;
        const sessionId = nanoid();
        const session: TillSession = {
            id: sessionId,
            status: 'open',
            openedAt: new Date().toISOString(),
            expectedCash: data.openingFloat,
            totalCashSales: 0,
            totalCashTips: 0,
            cashTipsByStaff: {},
            ...data
        };
        await setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/tillSessions`, sessionId), session, {});
        toast({ title: "Till Opened", description: `Session initialized with $${data.openingFloat.toFixed(2)}.` });
    };

    const handleCloseTill = async (data: any) => {
        if (!firestore || !tenantId || !activeTill) return;
        const updates: Partial<TillSession> = {
            status: 'closed',
            closedAt: new Date().toISOString(),
            ...data
        };
        updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/tillSessions`, activeTill.id), updates);
        
        if (Math.abs(data.discrepancy) > 0.01) {
            const txn: Omit<Transaction, 'id'> = {
                date: new Date().toISOString(),
                description: `Till Discrepancy: ${data.discrepancy > 0 ? 'Overage' : 'Shortage'}`,
                clientOrVendor: 'Internal Audit',
                type: data.discrepancy > 0 ? 'income' : 'expense',
                context: 'Business',
                category: 'Audit Adjustment',
                amount: Math.abs(data.discrepancy),
                paymentMethod: 'Till Internal',
                hasReceipt: false,
            };
            addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/transactions`), txn);
        }

        toast({ title: "Till Reconciled" });
    };

    const onWaiveFeeToggle = (id: string, waive: boolean, authorizerId?: string, reason?: string) => { setWaivedAppointmentFees(prev => { const next = new Map(prev); if (waive && authorizerId && reason) next.set(id, { authorizerId, reason }); else next.delete(id); return next; }); };

    const checkoutHubProps = {
        cart: retailItems, onCartChange: setRetailItems,
        appointmentsData: selectedAptsData, onSelectAppointment: handleSelectAppointment,
        clients: clients || [], isGroupCheckout: selectedAppointmentIds.size > 1,
        payerOptions: payerOptions || [], selectedClientId, setSelectedClientId,
        onAddClientClick: () => setIsAddClientOpen(true), onScanClick: () => setIsScannerOpen(true),
        subtotal, tax, total, tipAmount, setTipAmount, onCheckout: handleCheckout,
        appliedDiscountCodes, setAppliedDiscountCodes, discount, membershipDiscount,
        isSubmitting, paymentTab, setPaymentTab, discounts: discounts || [], amountTendered, setAmountTendered,
        appliedAdjustments, onApplyAdjustmentToggle: (ids: any, apply?: boolean) => onApplyAdjustmentToggle(ids, apply),
        redeemedOffer, setRedeemedOffer, memberships: memberships || [], packages: packages || [],
        allowStacking: selectedTenant?.allowDiscountStacking || false, showTitle: false,
        waivedAppointmentFees, onWaiveFeeToggle: (id: string, waive: boolean, authorizerId?: string, reason?: string) => onWaiveFeeToggle(id, waive, authorizerId, reason),
        tipAllocations, setTipAllocations,
        activeTill
    };

    useEffect(() => {
        let html5QrCode: Html5Qrcode | undefined;
        if (isScannerOpen) {
            const timer = setTimeout(() => {
                const element = document.getElementById('qr-reader-pos');
                if (element) {
                    html5QrCode = new Html5Qrcode('qr-reader-pos');
                    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, (decodedText) => handleScan(decodedText), () => {}).catch(() => { toast({ variant: 'destructive', title: 'Camera Error' }); setIsScannerOpen(false); });
                }
            }, 300);
            return () => { clearTimeout(timer); if (html5QrCode?.isScanning) html5QrCode.stop().catch(console.error); };
        }
    }, [isScannerOpen, toast]);

    const handleScan = useCallback((data: string) => {
        if (data.startsWith('clarityflow://checkout/')) {
            const id = data.split('/').pop();
            if (id) handleSelectAppointment(id);
        } else {
            const product = inventory.find(p => p.sku === data || p.id === data);
            if (product) handleAddToCart(product);
        }
    }, [inventory, handleAddToCart, handleSelectAppointment]);

    if (isInventoryLoading) return <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Syncing Terminal...</p></div>;

    const todayAppointments = (appointmentsFromInventory || []).filter(a => isSameDay(new Date(a.startTime), startOfDay(new Date())));

    return (
        <div className="h-[100dvh] w-full flex flex-col bg-background">
            <AppHeader title="Studio POS" />
            <div className={cn("flex-1 grid transition-all duration-500 ease-in-out overflow-hidden", isCartCollapsed ? "lg:grid-cols-[1fr,80px]" : "lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px]")}>
                <main className="flex-1 flex flex-col overflow-auto p-4 md:p-10 gap-10 pb-32 lg:pb-10">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-2 text-left">
                        <div className="grid gap-4 md:gap-6 grid-cols-2 lg:grid-cols-4 flex-1 w-full">
                            <KpiCard title="Wait Velocity" value={`${kpiData.avgWaitTime.toFixed(0)}m`} icon={<Clock className="text-blue-500" />} iconBgColor="bg-blue-100 dark:bg-blue-900/50" description="Check-in to service." />
                            <KpiCard title="Success Rate" value={`${kpiData.walkInConversionRate.toFixed(0)}%`} icon={<TrendingUp className="text-green-500" />} iconBgColor="bg-green-100 dark:bg-green-900/50" description="Walk-in conversion." />
                            <KpiCard title="Arrival Count" value={kpiData.totalWalkIns.toString()} icon={<Users className="text-purple-500" />} iconBgColor="bg-purple-100 dark:bg-purple-900/50" description="Total guests today." />
                            <KpiCard title="Daily Gross" value={`$${kpiData.totalDailyGrossRevenue.toFixed(2)}`} icon={<DollarSign className="text-amber-500" />} iconBgColor="bg-amber-100 dark:bg-amber-900/50" description="Current yield." />
                        </div>
                        {isOwnerOrAdmin && (
                            <Button 
                                variant={activeTill ? "outline" : "default"} 
                                onClick={() => setIsTillManagementOpen(true)}
                                className={cn("h-14 md:h-20 px-8 rounded-3xl font-black uppercase text-xs shadow-xl border-4 flex flex-col items-center justify-center gap-1", activeTill ? "border-green-500/20 bg-green-500/5 text-green-700" : "shadow-primary/20")}
                            >
                                <Landmark className="w-5 h-5 mb-1" />
                                {activeTill ? `Till: $${activeTill.expectedCash.toFixed(2)}` : "Open Studio Till"}
                            </Button>
                        )}
                    </div>
                    <div className="grid gap-10 grid-cols-1 text-left">
                        <TeamStatus staff={staff} onStatusChange={(id, act) => {}} appointments={todayAppointments} services={services} onReorder={handleStaffReorder} assignmentMode={assignmentMode} onAssignmentModeChange={setAssignmentMode} resources={resources || []} onForceIdle={handleForceIdle} />
                        <WalkInQueue walkIns={walkIns} appointments={todayAppointments} readyForCheckoutAppointments={readyForCheckoutAppointments} selectedAppointmentIds={selectedAppointmentIds} onSelectAppointment={handleSelectAppointment} services={services} staff={staff} onAssignStaff={handleAssignStaff} onAssignNext={handleAssignNext} onCancel={handleCancelAction} onStartService={handleStartService} orderedWaitingQueue={[]} onReorder={() => {}} assignmentMode={assignmentMode} onPrintTicket={() => {}} onSkip={handleSkip} onReturnToQueue={handleReturnToQueue} groupSizes={new Map()} onToggleWaitForStaff={() => {}} onScanClick={() => setIsScannerOpen(true)} onFinishService={handleFinishService} onUpdateStatus={handleUpdateStatus} onRevertToReady={handleRevertToReady} onRevertToService={handleRevertToService} onResolve={handleResolve} />
                        <div className="space-y-4">
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />Retail & Additions</h3>
                            <RetailCatalog services={services || []} inventory={inventory || []} memberships={memberships || []} packages={packages || []} onAddToCart={handleAddToCart} onScanClick={() => setIsScannerOpen(true)} />
                        </div>
                    </div>
                </main>
                <aside className={cn("hidden lg:flex border-l-4 border-muted/30 bg-white flex-col h-full transition-all duration-500 relative overflow-hidden", isCartCollapsed ? "w-20" : "w-full")}>
                    {isCartCollapsed ? (
                        <div className="flex flex-col items-center py-8 gap-8 h-full">
                            <button onClick={() => setIsCartCollapsed(false)} className="h-12 w-12 rounded-2xl bg-primary/5 text-primary hover:bg-primary/10 shadow-sm flex items-center justify-center"><ChevronLeft className="h-6 w-6" /></button>
                            <div className="flex flex-col items-center gap-1 [writing-mode:vertical-lr] rotate-180"><span className="font-black uppercase tracking-[0.3em] text-sm text-slate-900 opacity-40">Current Sale</span><span className="font-black text-primary text-xl mt-6 tracking-tighter">${total.toFixed(2)}</span></div>
                            <div className="mt-auto pb-8"><Badge className="rounded-full h-8 w-8 flex items-center justify-center p-0 font-black bg-primary text-white border-none shadow-lg animate-in zoom-in duration-300">{(retailItems?.length || 0) + selectedAppointmentIds.size}</Badge></div>
                        </div>
                    ) : (
                        <div className="flex flex-col h-full w-full">
                            <div className="absolute top-6 left-[-24px] z-50"><Button variant="outline" size="icon" onClick={() => setIsCartCollapsed(true)} className="h-12 w-12 rounded-2xl border-4 border-white bg-white shadow-xl hover:bg-muted text-slate-400 group transition-all"><ChevronRight className="h-6 w-6 group-hover:translate-x-0.5 transition-transform" /></Button></div>
                            <div className="absolute inset-0 flex flex-col"><ScrollArea className="flex-1"><div className="p-6 pb-40"><CheckoutHub {...checkoutHubProps} /></div></ScrollArea></div>
                        </div>
                    )}
                </aside>
            </div>
            {isMobile && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-xl lg:hidden z-40">
                    <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                        <SheetTrigger asChild><Button className="w-full h-14 rounded-2xl text-lg font-black uppercase tracking-tight shadow-2xl shadow-primary/30">View Cart (${total.toFixed(2)})</Button></SheetTrigger>
                        <SheetContent side="bottom" className="h-[95dvh] p-0 flex flex-col border-none rounded-t-[3rem] bg-background"><SheetHeader className="p-8 pb-4 border-b bg-muted/5 flex-shrink-0"><SheetTitle className="text-2xl font-black uppercase tracking-tighter">Current Sale</SheetTitle></SheetHeader><div className="flex-1 overflow-y-auto"><div className="p-6 pb-24"><CheckoutHub {...checkoutHubProps} /></div></div></SheetContent>
                    </Sheet>
                </div>
            )}
            <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={() => {}} />
            <AppointmentDetailsSheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={selectedAppointment} client={clients?.find(c => c.id === selectedAppointment?.clientId) || null} service={services?.find(s => s.id === selectedAppointment?.serviceId) || null} tmhr={selectedTenant?.tmhr || 50} transactions={transactions || []} onStartService={handleStartService} onFinishService={handleFinishService} onEdit={() => {}} onDelete={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))} onCancel={handleCancelAction} onReschedule={() => {}} onRebook={() => {}} onBookNewForClient={() => {}} onPrintTicket={() => {}} onOverride={() => setIsOverrideOpen(true)} onWaiveFee={() => {}} />
            {selectedAppointment && <CancelAppointmentDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen} appointment={selectedAppointment} tenant={selectedTenant} onConfirm={handleConfirmCancellation} />}
            <OverrideCancellationDialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen} staff={staff || []} onConfirm={async (sid, res) => { const appointmentRef = doc(firestore!, 'tenants', tenantId!, 'appointments', selectedAppointment!.id); updateDocumentNonBlocking(appointmentRef, { status: 'confirmed', checkInStatus: 'pending', overrideReason: res, overriddenBy: sid }); setIsOverrideOpen(false); setIsDetailsOpen(false); }} />
            {appointmentToReview && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: appointmentToReview, client: (clients || []).find(c => c.id === appointmentToReview.clientId), service: (services || []).find(s => s.id === appointmentToReview.serviceId) }} staff={staff || []} onSendToFrontDesk={handleSendToFrontDesk} />}
            <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}><DialogContent className="sm:max-w-md p-0 border-4 rounded-[3rem] shadow-3xl"><DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left"><DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Scan Terminal</DialogTitle><DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Authenticate asset codes or session tickets.</DialogDescription></DialogHeader><div className="p-10 relative"><div id="qr-reader-pos" className="w-full aspect-square rounded-3xl bg-muted shadow-inner" /><div className="absolute inset-10 flex items-center justify-center pointer-events-none"><div className="w-2/3 h-1/2 border-4 border-primary rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" /></div></div><DialogFooter className="p-6 pt-4 border-t bg-muted/5"><Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button" className="w-full h-14 rounded-2xl font-bold uppercase tracking-widest text-xs">Close Scanner</Button></DialogFooter></DialogContent></Dialog>
            <PolicyEnforcementDialog open={!!policyEnforcementData} onOpenChange={() => setPolicyEnforcementData(null)} data={policyEnforcementData} staff={staff || []} onResolve={handleResolvePolicyEnforcement} />
            <TillManagement open={isTillManagementOpen} onOpenChange={setIsTillManagementOpen} activeTill={activeTill} staff={staff || []} onOpenTill={handleOpenTill} onCloseTill={handleCloseTill} requireTillWitness={selectedTenant?.requireTillWitness !== false} />
        </div>
    );
}

export default function POSPageWrapper() { return <Suspense fallback={<div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Terminal...</p></div>}><POSPage /></Suspense> }