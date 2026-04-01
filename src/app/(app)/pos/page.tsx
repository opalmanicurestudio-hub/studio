'use client';

import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
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
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, query, where, deleteField } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, addMinutes, isToday, isSameDay, startOfDay, endOfDay, format, subMinutes } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { AddClientDialog, type ClientFormData } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Clock, Users, DollarSign, QrCode, Loader, Play, XCircle, Fingerprint, UserPlus, Sparkles, ChevronRight, ChevronLeft, ShoppingCart, Square, Wallet, AlertTriangle, MapPin, ShieldCheck, ArrowRight, Info, CheckCircle2, Ban, ShieldAlert, Landmark, Smartphone, Cake, Printer, Trash2, Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn, safeNumber } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TillManagement } from '@/components/pos/TillManagement';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CheckInConfirmationDialog } from '@/components/pos/CheckInConfirmationDialog';
import { PrintTicket } from '@/components/planner/PrintTicket';

const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeForFirestore(v)])
  );
};

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
    <CardContent className="p-3 md:p-4 pt-0 text-left">
      <div className="text-xl md:text-3xl font-black tracking-tighter text-slate-900">{value}</div>
      <p className="text-[9px] font-bold text-muted-foreground uppercase mt-1 opacity-60 truncate">{description}</p>
    </CardContent>
  </Card>
);

// Top-level PIN dialog — renders above everything including the mobile Sheet
const RecoveryOverrideDialog = ({ open, onOpenChange, staff, onConfirm }: any) => {
    const [pin, setPin] = useState('');
    const [reason, setReason] = useState('');
    const { toast } = useToast();
    const pinInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (open) {
            setTimeout(() => pinInputRef.current?.focus(), 150);
        } else {
            setPin('');
            setReason('');
        }
    }, [open]);

    const handleConfirm = () => {
        const authorizedStaff = (staff || []).find((s: any) => s.pin === pin && (s.role === 'admin' || s.role === 'owner'));
        if (!authorizedStaff) {
            toast({ variant: 'destructive', title: 'Unauthorized', description: 'Manager PIN not recognized.' });
            return;
        }
        if (!reason.trim()) {
            toast({ variant: 'destructive', title: 'Reason Required' });
            return;
        }
        onConfirm(authorizedStaff, reason);
        setPin('');
        setReason('');
    };

    const handleOpenChange = (val: boolean) => {
        if (!val) { setPin(''); setReason(''); }
        onOpenChange(val);
    };

    if (!open) return null;

    return (
        <div 
            style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', pointerEvents: 'all' }}
        >
            {/* Backdrop — closes modal on tap but doesn't block modal content */}
            <div 
                style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 0 }}
                onClick={() => handleOpenChange(false)}
            />
            {/* Modal — sits above backdrop */}
            <div 
                style={{ position: 'relative', zIndex: 1, backgroundColor: 'white', borderRadius: '2rem', border: '4px solid #e2e8f0', boxShadow: '0 25px 50px rgba(0,0,0,0.25)', width: '100%', maxWidth: '440px', overflow: 'hidden' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ padding: '1.5rem 1.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <ShieldCheck style={{ width: '1.5rem', height: '1.5rem', color: 'var(--primary, #6366f1)' }} />
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.05em', color: '#0f172a', margin: 0 }}>Recovery Override</h2>
                    </div>
                    <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', marginBottom: '1rem' }}>Manager PIN required to authorize this adjustment.</p>
                </div>
                {/* Body */}
                <div style={{ padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', width: '12rem' }}>
                        <label style={{ fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#94a3b8' }}>Manager PIN</label>
                        <input
                            ref={pinInputRef}
                            type="number"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="0000"
                            maxLength={4}
                            value={pin}
                            onChange={e => setPin(e.target.value.slice(0, 4).replace(/\D/g, ''))}
                            style={{ width: '100%', textAlign: 'center', fontSize: '2rem', fontWeight: 900, height: '5rem', letterSpacing: '0.4em', backgroundColor: '#f8fafc', border: '4px solid #e2e8f0', borderRadius: '1.5rem', outline: 'none', padding: '0 1rem' }}
                        />
                    </div>
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8' }}>Override Reason</label>
                        <textarea
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Detail the justification..."
                            rows={3}
                            style={{ width: '100%', borderRadius: '1rem', border: '2px solid #e2e8f0', padding: '0.75rem', fontSize: '0.875rem', fontFamily: 'inherit', resize: 'none', outline: 'none', boxSizing: 'border-box' }}
                        />
                    </div>
                </div>
                {/* Footer */}
                <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <button
                        onClick={handleConfirm}
                        disabled={pin.length < 4 || !reason.trim()}
                        style={{ width: '100%', height: '4rem', borderRadius: '1rem', border: 'none', backgroundColor: pin.length < 4 || !reason.trim() ? '#cbd5e1' : '#6366f1', color: 'white', fontSize: '0.75rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: pin.length < 4 || !reason.trim() ? 'not-allowed' : 'pointer' }}
                    >
                        Authorize Override
                    </button>
                    <button
                        onClick={() => handleOpenChange(false)}
                        style={{ width: '100%', height: '2.5rem', borderRadius: '1rem', border: 'none', backgroundColor: 'transparent', color: '#94a3b8', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};


// Identity Match Dialog — shown when walk-in phone/email matches existing client
const IdentityMatchDialog = ({ open, onOpenChange, walkIn, matchedClient, onLink }: any) => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl bg-background">
                <DialogHeader className="p-6 pb-0 text-left">
                    <DialogTitle className="flex items-center gap-3 text-2xl font-black uppercase tracking-tighter text-slate-900">
                        <Fingerprint className="w-6 h-6 text-primary" />
                        Identity Match Found
                    </DialogTitle>
                    <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
                        This walk-in shares contact info with an existing client record.
                    </DialogDescription>
                </DialogHeader>
                <div className="p-6 space-y-6">
                    <div className="p-5 rounded-2xl bg-primary/5 border-2 border-primary/10 space-y-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Existing Client Record</p>
                        <p className="text-xl font-black uppercase tracking-tighter text-slate-900">{matchedClient?.name}</p>
                        <div className="space-y-1">
                            {matchedClient?.phone && <p className="text-[10px] font-bold text-slate-600 uppercase">{matchedClient.phone}</p>}
                            {matchedClient?.email && <p className="text-[10px] font-bold text-slate-600 uppercase">{matchedClient.email}</p>}
                        </div>
                    </div>
                    <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-200">
                        <p className="text-[10px] font-black uppercase text-amber-700">Walk-in Guest</p>
                        <p className="text-sm font-black uppercase text-slate-900 mt-1">{walkIn?.customerName}</p>
                        {(walkIn?.customerPhone || walkIn?.phone) && <p className="text-[10px] font-bold text-slate-600 uppercase mt-1">{walkIn.customerPhone || walkIn.phone}</p>}
                        {(walkIn?.customerEmail || walkIn?.email) && <p className="text-[10px] font-bold text-slate-600 uppercase">{walkIn.customerEmail || walkIn.email}</p>}
                    </div>
                </div>
                <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
                    <Button onClick={() => onLink(matchedClient)} className="w-full h-14 rounded-2xl font-black uppercase shadow-2xl shadow-primary/20">
                        <Fingerprint className="w-4 h-4 mr-2" /> Link to Existing Record
                    </Button>
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full h-12 rounded-2xl font-black uppercase border-2">
                        Keep as New Guest
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

function POSPage() {
    const isMobile = useIsMobile();
    const { inventory, services, appointments: appointmentsFromInventory, clients, walkIns, staff, transactions, memberships, packages, resources, discounts, tillSessions, isLoading: isInventoryLoading } = useInventory();
    const { firestore, user: currentUser } = useFirebase();
    const { selectedTenant, role } = useTenant();
    const tenantId = selectedTenant?.id;
    const router = useRouter();
    const { toast } = useToast();

    const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<Set<string>>(new Set());
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [retailItems, setRetailItems] = useState<any[]>([]);
    const [tipAmount, setTipAmount] = useState(0);
    const [tipAllocations, setTipAllocations] = useState<Record<string, number>>({});
    const [paymentTab, setPaymentTab] = useState('card');
    const [amountTendered, setAmountTendered] = useState<number>(0);
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

    // Top-level override dialog state — lives here so it renders ABOVE the mobile Sheet
    const [isRecoveryOverrideOpen, setIsRecoveryOverrideOpen] = useState(false);
    const [pendingIdentityMatch, setPendingIdentityMatch] = useState<any | null>(null);

    const isOwnerOrAdminUser = role === 'owner' || role === 'admin';
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
        const walkInWithServiceStart = walkInsToday.filter(w => w.serviceStartTime);
        const waitTimes = walkInWithServiceStart.map(w => differenceInMinutes(safeDate(w.serviceStartTime), safeDate(w.checkInTime)));
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
                const mainStaffId = data.appointment.checkoutState?.serviceStaffOverrides?.[data.service.id] || data.appointment.staffId;
                const mainStaff = staff.find(s => s.id === mainStaffId);
                const mainPrice = isServiceRedeemed ? 0 : getServicePrice(data.service, mainStaff);
                const addonsPrice = (data.addOnServices || []).reduce((sum: number, s: any) => {
                    const isAddonRedeemed = redeemedOffer?.itemId === s.id;
                    const addonStaffId = data.appointment.checkoutState?.serviceStaffOverrides?.[s.id] || data.appointment.staffId;
                    const addonStaff = staff.find(st => st.id === addonStaffId);
                    return sum + (isAddonRedeemed ? 0 : getServicePrice(s, addonStaff));
                }, 0);
                const adjustments = data.appointment.checkoutState?.adjustments;
                let adjTotal = 0;
                if (adjustments) {
                    const isWaived = waivedAppointmentFees.has(data.appointment.id);
                    if (!isWaived) {
                        adjTotal = safeNumber(adjustments.rescheduleFee) + safeNumber(adjustments.timeOverage) + safeNumber(adjustments.materialOverage);
                    }
                } else {
                    const isWaived = waivedAppointmentFees.has(data.appointment.id);
                    adjTotal = isWaived ? 0 : safeNumber(data.appointment.checkoutState?.additionalCharge);
                }
                const refreshmentsSub = (data.appointment.checkoutState?.refreshments || []).reduce((sum: number, r: any) => sum + (safeNumber(r.price) * safeNumber(r.quantity || 1)), 0);
                return acc + mainPrice + addonsPrice + adjTotal + refreshmentsSub;
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

    const handleSelectAppointment = useCallback((id: string) => {
        const nextIds = new Set(selectedAppointmentIds);
        if (nextIds.has(id)) {
            nextIds.delete(id);
            if (nextIds.size === 0) setSelectedClientId(null);
        } else {
            nextIds.add(id);
            const aptData = readyForCheckoutAppointments.find(a => a.id === id);
            if (aptData?.client?.id) setSelectedClientId(aptData.client.id);
        }
        setSelectedAppointmentIds(nextIds);
    }, [readyForCheckoutAppointments, selectedAppointmentIds]);

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

    const handleStartService = (appointmentId: string) => {
      if (!firestore || !tenantId || !appointmentsFromInventory) return;
      const appointment = (appointmentsFromInventory || []).find(a => a.id === appointmentId) || (appointmentsFromInventory || []).find(a => a.id === `apt-walkin-${appointmentId}`);
      if (!appointment) return;
      const nowISO = new Date().toISOString();
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { status: 'servicing', actualStartTime: nowISO });
      if (appointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'servicing', tenantId });
      if (appointment.staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId), { status: 'busy' }, { merge: true });
      if (appointment.isWalkIn) batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', appointment.id.replace('apt-walkin-', '')), { status: 'servicing', serviceStartTime: nowISO });
      batch.commit().then(() => toast({ title: "Service Started" }));
    };

    const handleAssignStaff = useCallback((walkIn: WalkIn, staffId: string) => {
      if (!firestore || !tenantId || !services) return;
      const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkIn.id);
      updateDocumentNonBlocking(walkInRef, { assignedStaffId: staffId, status: 'notified', notifiedTimestamp: new Date().toISOString() });
      const personServices = (walkIn.serviceIds || []).map(id => (services || []).find(s => s.id === id)).filter(Boolean) as Service[];
      const duration = personServices.reduce((acc, s) => acc + s.duration, 0);
      const appointmentId = `apt-walkin-${walkIn.id}`;
      setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { id: appointmentId, tenantId, clientId: walkIn.clientId || walkIn.id, clientName: walkIn.customerName, serviceId: walkIn.serviceIds[0], staffId, status: 'confirmed', source: 'walk-in', isWalkIn: true, startTime: new Date().toISOString(), endTime: addMinutes(new Date(), duration).toISOString() }, {});
      toast({ title: "Staff Assigned" });
    }, [firestore, tenantId, services, toast]);

    const handleAssignNext = useCallback(() => {
        if (!firestore || !tenantId || !walkIns || !staff || !services) return;
        const waitingQueue = [...walkIns].filter(w => w.status === 'waiting').sort((a, b) => (a.queueOrder || safeDate(a.checkInTime).getTime()) - (b.queueOrder || safeDate(b.checkInTime).getTime()));
        if (waitingQueue.length === 0) return;
        const nextGuest = waitingQueue[0];
        const idleStaff = staff.filter(s => s.active && !s.onBreak && (s.status === 'idle' || !s.status));
        if (idleStaff.length === 0) return;
        const qualified = idleStaff.filter(s => nextGuest.serviceIds.every(sid => { const svc = services.find(ser => ser.id === sid); return !svc?.requiredSkills?.length || svc.requiredSkills.every(skill => (s.skillSet || []).includes(skill)); }));
        if (qualified.length === 0) return;
        let selected = [...qualified].sort((a, b) => (assignmentMode === 'fair_play' ? (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0) : (a.turnOrder || 0) - (b.turnOrder || 0)))[0];
        handleAssignStaff(nextGuest, selected.id);
    }, [firestore, tenantId, walkIns, staff, services, assignmentMode, handleAssignStaff]);

    const handleUpdateStatus = (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => {
        if (!firestore || !tenantId || !selectedTenant) return;
        const isAssignedWalkIn = id.startsWith('apt-walkin-');
        const effectiveIsWalkIn = isWalkIn && !isAssignedWalkIn;
        const collectionName = effectiveIsWalkIn ? 'walkIns' : 'appointments';
        const docRef = doc(firestore, 'tenants', tenantId, collectionName, id);
        const tmhrValue = selectedTenant.tmhr || 50;
        const premium = selectedTenant.lateInconveniencePremium || 0;

        if (status === 'running_late' && lateMinutes && !effectiveIsWalkIn) {
            const apt = appointmentsFromInventory?.find(a => a.id === id);
            if (apt) {
                const grace = selectedTenant.lateArrivalGracePeriod || 15;
                const autoCancel = selectedTenant.autoCancelLateArrivals === true;
                const primarySvc = services?.find(s => s.id === apt.serviceId);
                const addOns = (apt.addOnIds || []).map(aid => services?.find(s => s.id === aid)).filter(Boolean) as Service[];
                const totalDur = (primarySvc?.duration || 0) + addOns.reduce((sum, a) => sum + a.duration, 0);
                const totalPadding = (primarySvc?.padBefore || 0) + (primarySvc?.padAfter || 0);
                const fullSessionBlock = totalDur + totalPadding;
                const staffId = apt.staffId;
                let clash = null;
                if (staffId) {
                    const theoreticalStart = addMinutes(safeDate(apt.startTime), lateMinutes);
                    const theoreticalEnd = addMinutes(theoreticalStart, fullSessionBlock);
                    const nextApt = (appointmentsFromInventory || []).filter(a => a.staffId === staffId && a.id !== apt.id && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > safeDate(apt.startTime)).sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];
                    if (nextApt) {
                        const nextService = services?.find(s => s.id === nextApt.serviceId);
                        const nextStartWithPad = subMinutes(safeDate(nextApt.startTime), nextService?.padBefore || 0);
                        if (theoreticalEnd > nextStartWithPad) clash = { nextApt, clashTime: format(nextStartWithPad, 'h:mm a') };
                    }
                }
                if ((lateMinutes > grace && autoCancel) || clash) {
                    const cancelReason = clash ? 'clash' : 'late';
                    const fee = Number(((fullSessionBlock / 60) * tmhrValue + (primarySvc?.cost || 0) + addOns.reduce((sum, a) => sum + (a.cost || 0), 0)).toFixed(2));
                    const batch = writeBatch(firestore);
                    batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'auto_cancelled', status: 'cancelled', lateTimeMinutes: lateMinutes, cancellationReason: cancelReason, cancellationFeeApplied: fee }));
                    if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ checkInStatus: 'auto_cancelled', status: 'cancelled', tenantId }));
                    if (fee > 0 && apt.clientId) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Auto-Cancel: ${clash ? 'Clash' : 'Late'} (+${lateMinutes}m)` })) });
                    batch.commit().then(() => toast({ title: clash ? "Clash: Auto-Cancelled" : "Late: Auto-Cancelled" }));
                    return;
                } else if (lateMinutes > grace) {
                    const fee = Number(((lateMinutes / 60) * tmhrValue + premium).toFixed(2));
                    const batch = writeBatch(firestore);
                    batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'running_late', lateTimeMinutes: lateMinutes }));
                    if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ checkInStatus: 'running_late', lateTimeMinutes: lateMinutes, tenantId }));
                    if (apt.clientId && fee > 0) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Late Penalty: +${lateMinutes}m` })) });
                    batch.commit().then(() => toast({ title: "Status Updated: Fee Applied" }));
                    return;
                }
            }
        }
        const updates: any = { checkInStatus: status };
        if (lateMinutes !== undefined) updates.lateTimeMinutes = lateMinutes;
        const batch = writeBatch(firestore);
        batch.set(docRef, sanitizeForFirestore(updates), { merge: true });
        const apt = !effectiveIsWalkIn ? appointmentsFromInventory?.find(a => a.id === id) : null;
        if (apt?.checkInToken) batch.set(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ ...updates, tenantId }), { merge: true });
        batch.commit().then(() => toast({ title: "Status Updated" }));
    };

    const handleCheckout = async (paymentData: {paymentMethod: string, amountTendered: number, recoveryAmount?: number, recoveryReason?: string}) => {
        if (!selectedClientId || !firestore || !tenantId) return;
        setIsSubmitting(true);
        const batch = writeBatch(firestore);
        const now = new Date().toISOString();
        const clientObj = (clients || []).find(c => c.id === selectedClientId);
        const recoveryAmount = safeNumber(paymentData.recoveryAmount);
        const recoveryReason = paymentData.recoveryReason || 'Service Recovery Adjustment';
        let totalLtvIncrease = 0; let totalCashIncrease = 0; let cashTipsTotal = 0; const cashTipsByStaffUpdate: Record<string, number> = {};

        for (const aptData of readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id))) {
            const { appointment: apt, service, addOnServices } = aptData;
            const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', apt.id);
            const checkoutState = apt.checkoutState || {};
            const overrides = checkoutState.serviceStaffOverrides || {};
            const isWaived = waivedAppointmentFees.has(apt.id);
            const mainStaffId = overrides[service.id] || apt.staffId; const isMainRedeemed = redeemedOffer?.itemId === service.id;
            const mainStaffMember = staff.find(s => s.id === mainStaffId);
            const mainPartRevenue = (isMainRedeemed ? 0 : getServicePrice(service, mainStaffMember));
            totalLtvIncrease += mainPartRevenue; if (paymentData.paymentMethod === 'cash') totalCashIncrease += mainPartRevenue;
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: isMainRedeemed ? `Redemption: ${service.name}` : `Service: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Service Revenue', amount: mainPartRevenue, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: true, tenantId }));
            if (!isWaived && checkoutState.adjustments) {
                const { rescheduleFee, timeOverage, materialOverage } = checkoutState.adjustments;
                if (safeNumber(rescheduleFee) > 0) { const amt = safeNumber(rescheduleFee); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Reschedule Recovery: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Protocol Recovery', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId })); }
                if (safeNumber(timeOverage) > 0) { const amt = safeNumber(timeOverage); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Time Floor Overage: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Strategic Adjustment', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId })); }
                if (safeNumber(materialOverage) > 0) { const amt = safeNumber(materialOverage); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Material Protocol Overage: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Strategic Adjustment', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId })); }
            } else if (!isWaived && safeNumber(checkoutState.additionalCharge) > 0) { const amt = safeNumber(checkoutState.additionalCharge); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Strategic Adjustment Fee`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Adjustment Fee', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId })); }
            addOnServices.forEach((addon: any) => { const addonStaffId = overrides[addon.id] || apt.staffId; const isAddonRedeemed = redeemedOffer?.itemId === addon.id; const addonStaff = staff.find((s: any) => s.id === addonStaffId); const addonPrice = isAddonRedeemed ? 0 : getServicePrice(addon, addonStaff); totalLtvIncrease += addonPrice; if (paymentData.paymentMethod === 'cash') totalCashIncrease += addonPrice; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: isAddonRedeemed ? `Redemption: ${addon.name}` : `Add-on: ${addon.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Service Revenue', amount: addonPrice, paymentMethod: paymentData.paymentMethod, staffId: addonStaffId, appointmentId: apt.id, hasReceipt: true, tenantId })); });
            (checkoutState.refreshments || []).forEach((amenity: any) => { const qty = safeNumber(amenity.quantity || 1); const amenityPrice = safeNumber(amenity.price) * qty; if (amenityPrice > 0) { totalLtvIncrease += amenityPrice; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amenityPrice; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Concierge: ${amenity.name} (x${qty})`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Hospitality Revenue', amount: amenityPrice, paymentMethod: paymentData.paymentMethod, appointmentId: apt.id, hasReceipt: false, tenantId })); } });
            batch.update(appointmentRef, sanitizeForFirestore({ status: 'completed', revenue: mainPartRevenue + addOnServices.reduce((s: number, a: any) => s + getServicePrice(a, staff.find(st => st.id === (overrides[a.id] || apt.staffId))), 0), actualEndTime: now }));
            if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ status: 'completed' }));
            const involvedIds = new Set<string>(); if (apt.staffId) involvedIds.add(apt.staffId); if (overrides) Object.values(overrides).forEach((id: any) => { if (id && typeof id === 'string') involvedIds.add(id); });
            involvedIds.forEach(sid => { if (sid) batch.update(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }); });
        }

        retailItems.forEach(item => { const productValue = item.price * item.quantity; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Retail: ${item.quantity}x ${item.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Retail', amount: productValue, paymentMethod: paymentData.paymentMethod, hasReceipt: true, tenantId })); batch.update(doc(firestore, 'tenants', tenantId, 'inventory', item.id), { totalStock: increment(-item.quantity) }); batch.set(doc(collection(firestore, `tenants/${tenantId}/stockCorrections`)), sanitizeForFirestore({ id: nanoid(), productId: item.id, date: now, change: -item.quantity, unit: 'units', reason: `Retail Sale: ${item.name} for ${clientObj?.name || 'Guest'}` })); totalLtvIncrease += productValue; if (paymentData.paymentMethod === 'cash') totalCashIncrease += productValue; });

        if (clientObj && appliedAdjustments.size > 0) { const currentUnpaid = clientObj.unpaidFees || []; const settledTotal = Array.from(appliedAdjustments).reduce((sum, id) => { const fee = currentUnpaid.find(f => f.feeId === id); return sum + safeNumber(fee?.feeAmount); }, 0); batch.update(doc(firestore, `tenants/${tenantId}/clients`, clientObj.id), sanitizeForFirestore({ unpaidFees: currentUnpaid.filter(f => !appliedAdjustments.has(f.feeId)), outstandingBalance: increment(-settledTotal) })); if (paymentData.paymentMethod === 'cash') totalCashIncrease += settledTotal; appliedAdjustments.forEach(id => { const fee = currentUnpaid.find(f => f.feeId === id); if (fee) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Debt Settlement: ${fee.reason}`, clientOrVendor: clientObj.name, clientId: selectedClientId, type: 'income', context: 'Business', category: 'Fee Recovery', amount: fee.feeAmount, paymentMethod: paymentData.paymentMethod, hasReceipt: false, tenantId })); }); totalLtvIncrease += settledTotal; }

        if (clientObj) { const finalLtvDelta = Math.max(0, totalLtvIncrease - discountValue - membershipDiscountValue); const updates: any = { lifetimeValue: increment(finalLtvDelta), lastAppointment: now }; if (redeemedOffer) { const redemptionRef = doc(collection(firestore, `tenants/${tenantId}/clients/${selectedClientId}/redemptions`)); const offeringName = redeemedOffer.type === 'membership' ? memberships?.find(m => m.id === redeemedOffer.id)?.name : packages?.find(p => p.id === redeemedOffer.id)?.name; batch.set(redemptionRef, sanitizeForFirestore({ id: redemptionRef.id, clientId: selectedClientId, type: redeemedOffer.type, offeringId: redeemedOffer.id, offeringName: offeringName || 'Offer', serviceId: redeemedOffer.itemId, serviceName: services?.find(s => s.id === redeemedOffer.itemId)?.name || 'Service', date: now, staffId: currentUser?.uid, tenantId })); if (redeemedOffer.type === 'package') updates.activePackages = (clientObj.activePackages || []).map(p => p.packageId === redeemedOffer.id ? { ...p, sessionsRemaining: p.sessionsRemaining - 1 } : p).filter(p => p.sessionsRemaining > 0); else { updates[`subscription.perkUsage.${redeemedOffer.itemId}`] = increment(1); updates['subscription.perkLastUsed'] = now; } } batch.update(doc(firestore, `tenants/${tenantId}/clients`, clientObj.id), sanitizeForFirestore(updates)); }

        Object.entries(tipAllocations).forEach(([staffId, amount]) => { const finalAmount = safeNumber(amount); if (finalAmount > 0) { batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: 'Gratuity', clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'income', context: 'Business', category: 'Tips', amount: finalAmount, paymentMethod: paymentData.paymentMethod, staffId, hasReceipt: true, tenantId })); if (paymentData.paymentMethod === 'cash') { cashTipsTotal += finalAmount; cashTipsByStaffUpdate[`cashTipsByStaff.${staffId}`] = increment(finalAmount); } } });

        if (discountValue > 0) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Promotion Applied`, clientOrVendor: 'Internal', clientId: selectedClientId, type: 'expense', context: 'Business', category: 'Discounts', amount: discountValue, paymentMethod: 'Internal', hasReceipt: false, tenantId }));
        
        // Write service recovery transaction — matched exactly to what the recovery ledger queries
        if (recoveryAmount > 0) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Service Recovery: ${recoveryReason}`, clientOrVendor: clientObj?.name || 'Client', clientId: selectedClientId, type: 'expense', context: 'Business', category: 'Discounts', amount: recoveryAmount, notes: recoveryReason, paymentMethod: 'Internal', hasReceipt: false, tenantId }));
        if (paymentTab === 'cash' && activeTill) { const finalCashInput = totalCashIncrease + cashTipsTotal; batch.update(doc(firestore, `tenants/${tenantId}/tillSessions`, activeTill.id), sanitizeForFirestore({ expectedCash: increment(finalCashInput), totalCashSales: increment(totalCashIncrease), totalCashTips: increment(cashTipsTotal), ...cashTipsByStaffUpdate })); }
        try { await batch.commit(); toast({ title: "Checkout Successful" }); setRetailItems([]); setSelectedAppointmentIds(new Set()); setTipAmount(0); setIsCartSheetOpen(false); setRedeemedOffer(null); setAppliedDiscountCodes([]); setAppliedAdjustments(new Set()); }
        catch (e) { console.error(e); toast({ variant: 'destructive', title: 'Checkout Failed' }); }
        finally { setIsSubmitting(false); }
    };

    const handleCancelAction = (id: string, isWalkIn: boolean) => {
        const isAssignedWalkIn = id.startsWith('apt-walkin-');
        const effectiveIsWalkIn = isWalkIn && !isAssignedWalkIn;
        let item = effectiveIsWalkIn ? walkIns?.find(w => w.id === id) : appointmentsFromInventory?.find(a => a.id === id);
        if (item) { setSelectedAppointment({ ...item, isWalkIn: effectiveIsWalkIn } as any); setIsCancelDialogOpen(true); }
    };

    const handleResolveCheckInConfirmation = async (data: any) => {
        if (!pendingCheckInItem || !firestore || !tenantId) return;
        const isWalkIn = !!pendingCheckInItem.serviceIds;
        const docRef = isWalkIn ? doc(firestore, 'tenants', tenantId, 'walkIns', pendingCheckInItem.id) : doc(firestore, 'tenants', tenantId, 'appointments', pendingCheckInItem.id);
        const batch = writeBatch(firestore);
        const updates: any = { serviceId: data.serviceId, addOnIds: data.addOnIds, checkInStatus: 'arrived', notes: data.notes };
        if (data.accommodations?.length) updates.sensoryNeeds = data.accommodations.join(', ');
        batch.update(docRef, sanitizeForFirestore(updates));
        if (!isWalkIn && pendingCheckInItem.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', pendingCheckInItem.checkInToken), sanitizeForFirestore({ ...updates, tenantId }));
        if (pendingCheckInItem.clientId) batch.update(doc(firestore, `tenants/${tenantId}/clients`, pendingCheckInItem.clientId), sanitizeForFirestore({ email: data.email, phone: data.phone, ...(data.accommodations?.length ? { sensoryNeeds: data.accommodations.join(', ') } : {}) }));
        try { await batch.commit(); toast({ title: "Check-in Certified" }); setPendingCheckInItem(null); }
        catch (e) { console.error(e); toast({ variant: 'destructive', title: "Confirmation Failed" }); }
    };

    const handleRevertToService = (appointmentId: string) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/appointments`, appointmentId), { status: 'servicing' }); toast({ title: "Status Reverted" }); };
    const handleRevertToReady = (appointmentId: string) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/appointments`, appointmentId), { status: 'ready_for_checkout' }); toast({ title: "Status Reverted" }); };
    const handleOpenTill = (data: any) => { if (!firestore || !tenantId) return; const sessionRef = doc(collection(firestore, 'tenants', tenantId, 'tillSessions')); const newSession: any = { ...data, id: sessionRef.id, openedAt: new Date().toISOString(), status: 'open', expectedCash: data.openingFloat, totalCashSales: 0, totalCashTips: 0, totalCashRefunds: 0, cashTipsByStaff: {} }; setDocumentNonBlocking(sessionRef, sanitizeForFirestore(newSession), {}); toast({ title: "Till Session Initialized" }); };
    const handleCloseTill = (data: any) => { if (!firestore || !tenantId || !activeTill) return; const sessionRef = doc(firestore, 'tenants', tenantId, 'tillSessions', activeTill.id); updateDocumentNonBlocking(sessionRef, sanitizeForFirestore({ ...data, status: 'closed', closedAt: new Date().toISOString() })); toast({ title: "Till Session Finalized" }); };

    const checkoutHubProps = {
        cart: retailItems, onCartChange: setRetailItems, appointmentsData: readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)), onSelectAppointment: handleSelectAppointment,
        clients: clients || [], isGroupCheckout: selectedAppointmentIds.size > 1, payerOptions: payerOptions || [], selectedClientId, setSelectedClientId,
        onAddClientClick: () => setIsAddClientOpen(true), onScanClick: () => {},
        subtotal: subtotalCalc, tax: taxCalc, total: totalCalc, tipAmount, setTipAmount, onCheckout: handleCheckout,
        appliedDiscountCodes, setAppliedDiscountCodes, discount: discountValue, membershipDiscount: membershipDiscountValue,
        isSubmitting, paymentTab, setPaymentTab, discounts: discounts || [], amountTendered, setAmountTendered,
        appliedAdjustments, onApplyAdjustmentToggle: (id: string, apply: boolean) => { const next = new Set(appliedAdjustments); if (apply) next.add(id); else next.delete(id); setAppliedAdjustments(next); },
        redeemedOffer, setRedeemedOffer, memberships: memberships || [], packages: packages || [],
        allowStacking: selectedTenant?.allowDiscountStacking || false, showTitle: false,
        waivedAppointmentFees, onWaiveFeeToggle: (id: string, waive: boolean, authorizerId?: string, reason?: string) => { setWaivedAppointmentFees(prev => { const next = new Map(prev); if (waive && authorizerId && reason) next.set(id, { authorizerId, reason }); else next.delete(id); return next; }); },
        tipAllocations, setTipAllocations, activeTill, staff, role,
        // Pass the setter up so CheckoutHub can open the top-level dialog
        onRequestOverride: () => { setIsCartSheetOpen(false); setTimeout(() => setIsRecoveryOverrideOpen(true), 300); },
    };

    if (isInventoryLoading) return <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Terminal...</p></div>;

    return (
        <div className="h-[100dvh] w-full flex flex-col bg-background text-left">
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
                        <WalkInQueue walkIns={walkIns} appointments={appointmentsFromInventory?.filter(a => isToday(safeDate(a.startTime)))} readyForCheckoutAppointments={readyForCheckoutAppointments} selectedAppointmentIds={selectedAppointmentIds} onSelectAppointment={handleSelectAppointment} services={services} staff={staff} onAssignStaff={handleAssignStaff} onAssignNext={handleAssignNext} onCancel={handleCancelAction} onStartService={handleStartService} orderedWaitingQueue={[]} onReorder={() => {}} assignmentMode={assignmentMode} onPrintTicket={(id) => { const item = (walkIns || []).find(w => w.id === id) || (appointmentsFromInventory || []).find(a => a.id === id); if (item) { const client = clients?.find(c => c.id === item.clientId); const service = services?.find(s => s.id === (item.serviceId || item.serviceIds?.[0])); if (client && service) { setTicketToPrint({ business: { name: selectedTenant?.name || 'Studio', phone: selectedTenant?.twilioPhoneNumber || '' }, client, service, appointment: item }); setIsPrintDialogOpen(true); } } }} onSkip={(id) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', id), { status: 'skipped' }); }} onReturnToQueue={(id) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', id), { status: 'waiting' }); }} groupSizes={new Map()} onToggleWaitForStaff={() => {}} onFinishService={setAppointmentToReview} onUpdateStatus={handleUpdateStatus} onRevertToReady={handleRevertToReady} onRevertToService={handleRevertToService} onResolve={(item) => { if (item.isPotentialAlias && item.matchedClient) { setPendingIdentityMatch(item); } else if (item.type === 'walk-in') { setPendingCheckInItem(item); } else { setSelectedAppointment(item); setIsDetailsOpen(true); } }} />
                        <div className="space-y-4 text-left"><h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />Retail & Additions</h3><RetailCatalog services={services || []} inventory={inventory || []} memberships={memberships || []} packages={packages || []} onAddToCart={handleAddToCart} onScanClick={() => {}} /></div>
                    </div>
                </main>
                <aside className={cn("hidden lg:flex border-l-4 border-muted/30 bg-white flex-col h-full transition-all duration-500 relative overflow-hidden", isCartCollapsed ? "w-20" : "w-full")}>
                    {!isCartCollapsed ? (<div className="flex flex-col h-full w-full"><div className="absolute top-6 left-[-24px] z-50"><Button variant="outline" size="icon" onClick={() => setIsCartCollapsed(true)} className="h-12 w-12 rounded-2xl border-4 border-white bg-white shadow-xl hover:bg-muted text-slate-400 group transition-all"><ChevronRight className="h-6 w-6 group-hover:translate-x-0.5 transition-transform" /></Button></div><div className="absolute inset-0 flex flex-col"><ScrollArea className="flex-1"><div className="p-6 pb-40"><CheckoutHub {...checkoutHubProps} /></div></ScrollArea></div></div>) : (<div className="flex flex-col items-center py-8 gap-8 h-full"><button onClick={() => setIsCartCollapsed(false)} className="h-12 w-12 rounded-2xl bg-primary/5 text-primary hover:bg-primary/10 shadow-sm flex items-center justify-center"><ChevronLeft className="h-6 w-6" /></button><div className="flex flex-col items-center gap-1 [writing-mode:vertical-lr] rotate-180"><span className="font-black uppercase tracking-[0.3em] text-sm text-slate-900 opacity-40">Current Sale</span><span className="font-black text-primary text-xl mt-6 tracking-tighter">${totalCalc.toFixed(2)}</span></div><div className="mt-auto pb-8"><Badge className="rounded-full h-8 w-8 flex items-center justify-center p-0 font-black bg-primary text-white border-none shadow-lg animate-in zoom-in duration-300">{retailItems.length + selectedAppointmentIds.size}</Badge></div></div>)}
                </aside>
            </div>

            {isMobile && (<div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-xl lg:hidden z-40"><Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}><SheetTrigger asChild><Button className="w-full h-14 rounded-2xl text-lg font-black uppercase tracking-tight shadow-2xl shadow-primary/30">View Cart (${totalCalc.toFixed(2)})</Button></SheetTrigger><SheetContent side="bottom" className="h-[95dvh] p-0 flex flex-col border-none rounded-t-[3rem] bg-background"><SheetHeader className="p-8 pb-4 border-b bg-muted/5 flex-shrink-0"><SheetTitle className="text-2xl font-black uppercase tracking-tighter">Current Sale</SheetTitle></SheetHeader><div className="flex-1 overflow-y-auto"><div className="p-6 pb-24"><CheckoutHub {...checkoutHubProps} /></div></div></SheetContent></Sheet></div>)}

            {/* TOP-LEVEL DIALOGS — render above Sheet and all other overlays */}
            <RecoveryOverrideDialog
                open={isRecoveryOverrideOpen}
                onOpenChange={setIsRecoveryOverrideOpen}
                staff={staff || []}
                onConfirm={(authorizer: any, reason: string) => {
                    setIsRecoveryOverrideOpen(false);
                    toast({ title: "Override Authorized", description: `Approved by ${authorizer.name}. Proceed with adjustment.` });
                }}
            />
            <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={() => {}} />
            <AppointmentDetailsSheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={selectedAppointment} client={clients?.find(c => c.id === selectedAppointment?.clientId) || null} service={services?.find(s => s.id === selectedAppointment?.serviceId) || null} tmhr={selectedTenant?.tmhr || 50} transactions={transactions || []} onStartService={handleStartService} onFinishService={setAppointmentToReview} onEdit={() => {}} onDelete={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))} onCancel={handleCancelAction} onReschedule={() => {}} onRebook={() => {}} onBookNewForClient={() => {}} onPrintTicket={() => {}} onOverride={() => setIsOverrideOpen(true)} onWaiveFee={() => {}} />
            {selectedAppointment && <CancelAppointmentDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen} appointment={selectedAppointment} tenant={selectedTenant} onConfirm={async (data) => { if (!selectedAppointment || !firestore || !tenantId) return; const batch = writeBatch(firestore); const isAssignedWalkIn = selectedAppointment.id.startsWith('apt-walkin-'); const effectiveIsWalkIn = (selectedAppointment as any).isWalkIn || (isAssignedWalkIn && !selectedAppointment.clientId); const collectionPath = effectiveIsWalkIn ? 'walkIns' : 'appointments'; const updates = { status: 'cancelled' as const, cancellationReason: data.reason, cancellationFeeApplied: data.feeAmount }; batch.set(doc(firestore, `tenants/${tenantId}/${collectionPath}`, selectedAppointment.id), sanitizeForFirestore(updates), { merge: true }); if (data.feeAmount > 0 && selectedAppointment.clientId) { batch.update(doc(firestore, `tenants/${tenantId}/clients`, selectedAppointment.clientId), { outstandingBalance: increment(data.feeAmount) }); } await batch.commit(); setIsCancelDialogOpen(false); setIsDetailsOpen(false); }} />}
            <OverrideCancellationDialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen} staff={staff || []} onConfirm={async (sid: string, res: string) => { const appointmentRef = doc(firestore!, 'tenants', tenantId!, 'appointments', selectedAppointment!.id); updateDocumentNonBlocking(appointmentRef, { status: 'confirmed', checkInStatus: 'pending', overrideReason: res, overriddenBy: sid }); setIsOverrideOpen(false); setIsDetailsOpen(false); }} />
            {appointmentToReview && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: appointmentToReview, client: (clients || []).find(c => c.id === appointmentToReview.clientId), service: (services || []).find(s => s.id === appointmentToReview.serviceId) }} staff={staff || []} onSendToFrontDesk={async (id, state) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/appointments`, id), { status: 'ready_for_checkout', checkoutState: sanitizeForFirestore(state), actualEndTime: new Date().toISOString() }); setIsTechnicianReviewOpen(false); }} />}
            <TillManagement open={isTillManagementOpen} onOpenChange={setIsTillManagementOpen} activeTill={activeTill} staff={staff || []} onOpenTill={handleOpenTill} onCloseTill={handleCloseTill} requireTillWitness={selectedTenant?.requireTillWitness !== false} />
            <CheckInConfirmationDialog open={!!pendingCheckInItem} onOpenChange={() => setPendingCheckInItem(null)} item={pendingCheckInItem} services={services || []} tenant={selectedTenant} onConfirm={handleResolveCheckInConfirmation} />
            <IdentityMatchDialog
                open={!!pendingIdentityMatch}
                onOpenChange={() => setPendingIdentityMatch(null)}
                walkIn={pendingIdentityMatch}
                matchedClient={pendingIdentityMatch?.matchedClient}
                onLink={async (matchedClient: any) => {
                    if (!firestore || !tenantId || !pendingIdentityMatch) return;
                    updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/walkIns`, pendingIdentityMatch.id), { clientId: matchedClient.id, customerName: matchedClient.name });
                    toast({ title: "Identity Linked", description: `Walk-in linked to ${matchedClient.name}.` });
                    setPendingIdentityMatch(null);
                }}
            />
            <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}><DialogContent className="max-w-sm rounded-[2rem] border-2 shadow-3xl p-0 overflow-hidden text-center"><DialogHeader className="p-6 bg-muted/5 border-b"><DialogTitle className="text-xl font-bold uppercase tracking-tight text-center text-slate-900 leading-none">Ticket Issued</DialogTitle></DialogHeader><div className="flex justify-center p-8 bg-white text-center">{ticketToPrint && <PrintTicket data={ticketToPrint} />}</div><DialogFooter className="p-6 border-t bg-muted/5"><Button className="w-full h-12 rounded-xl text-lg font-bold uppercase tracking-widest shadow-xl shadow-primary/20" onClick={() => { window.print(); setIsPrintDialogOpen(false); }}>Authorize Print</Button></DialogFooter></DialogContent></Dialog>
        </div>
    );
}

export default function POSPageWrapper() { return <Suspense fallback={<div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Terminal...</p></div>}><POSPage /></Suspense>; }