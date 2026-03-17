'use client';

import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, getServicePrice, type AppointmentCheckoutState, type Redemption, type TillSession, type Membership } from '@/lib/data';
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
import { differenceInMinutes, parseISO, addMinutes, isToday, isSameDay, startOfDay, endOfDay, format, subMinutes, differenceInDays, subMonths, isAfter, subYears } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Clock, TrendingUp, Users, DollarSign, QrCode, Loader, Play, XCircle, Fingerprint, UserPlus, Sparkles, ChevronRight, ChevronLeft, ShoppingCart, Square, Wallet, AlertTriangle, MapPin, ShieldCheck, ArrowRight, Info, CheckCircle2, Ban, ShieldAlert, Landmark } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn, hexToHSLComponents } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';
import { Html5Qrcode } from 'html5-qrcode';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '../ui/switch';
import { TillManagement } from '@/components/pos/TillManagement';

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

const WaiveFeeDialog = ({ open, onOpenChange, staff, onConfirm }: any) => {
    const [pin, setPin] = useState('');
    const [reason, setReason] = useState('');
    const { toast } = useToast();

    const handleConfirm = () => {
        const authorizedStaff = staff.find((s: any) => s.pin === pin && (s.role === 'admin' || s.role === 'owner'));
        if (!authorizedStaff) {
            toast({ variant: 'destructive', title: 'Unauthorized', description: 'Manager authorization required.' });
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl">
                <DialogHeader className="p-6 pb-0 text-left">
                    <DialogTitle className="flex items-center gap-3 text-2xl font-black uppercase tracking-tighter text-slate-900">
                        <ShieldCheck className="w-6 h-6 text-primary" />
                        Admin Override
                    </DialogTitle>
                    <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Authorize fee waiver with manager PIN.</DialogDescription>
                </DialogHeader>
                <div className="space-y-8 py-8 flex flex-col items-center">
                    <div className="space-y-2 w-48 text-center">
                        <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">Manager PIN</Label>
                        <Input 
                            type="password" 
                            placeholder="••••"
                            maxLength={4} 
                            className="text-center text-4xl font-black h-20 tracking-[0.5em] bg-muted/30 border-4 rounded-3xl" 
                            value={pin} 
                            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                            autoFocus
                        />
                    </div>
                    <div className="space-y-2 w-full px-6 text-left">
                        <Label htmlFor="waive-reason-pos" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Waiver Reason</Label>
                        <Textarea id="waive-reason-pos" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g., Client verified emergency..." className="rounded-2xl border-2 bg-muted/5 focus-visible:ring-primary/20 font-medium" />
                    </div>
                </div>
                <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
                    <Button onClick={handleConfirm} disabled={pin.length < 4 || !reason.trim()} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/20">Confirm Waiver</Button>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const CheckoutHub = ({ 
    cart, 
    onCartChange,
    appointmentsData,
    onSelectAppointment,
    clients,
    payerOptions,
    selectedClientId,
    setSelectedClientId,
    onAddClientClick,
    onScanClick,
    subtotal,
    tax,
    total,
    tipAmount,
    setTipAmount,
    onCheckout,
    appliedDiscountCodes,
    setAppliedDiscountCodes,
    discount,
    membershipDiscount: _passedMembershipDiscount,
    isSubmitting,
    paymentTab,
    setPaymentTab,
    discounts,
    amountTendered,
    setAmountTendered,
    appliedAdjustments,
    onApplyAdjustmentToggle,
    redeemedOffer,
    setRedeemedOffer,
    memberships,
    packages,
    allowStacking,
    waivedAppointmentFees,
    onWaiveFeeToggle,
    tipAllocations,
    setTipAllocations,
    isGroupCheckout,
    activeTill,
    staff,
    role
}: any) => {
    
    const [promoCodeInput, setPromoCodeInput] = useState('');
    const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);
    const [isPayerDialogOpen, setIsPayerDialogOpen] = useState(false);
    const { appointments: allAppointments, services, inventory } = useInventory();
    const { toast } = useToast();

    const [isWaiveAuthOpen, setIsWaiveAuthOpen] = useState(false);
    const [pendingWaiveAptId, setPendingWaiveAptId] = useState<string | null>(null);
    const [clientSearch, setClientSearch] = useState('');

    const isOwnerOrAdmin = role === 'owner' || role === 'admin';

    const handleWaiveClick = (aptId: string) => {
        setPendingWaiveAptId(aptId);
        setIsWaiveAuthOpen(true);
    };

    const handleConfirmWaive = (authorizer: Staff, reason: string) => {
        if (pendingWaiveAptId) {
            onWaiveFeeToggle(pendingWaiveAptId, true, authorizer.id, reason);
            setIsWaiveAuthOpen(false);
            setPendingWaiveAptId(null);
            toast({ title: "Fees Absorbed" });
        }
    };

    const selectedClient = useMemo(() => clients.find((c: Client) => c.id === selectedClientId), [selectedClientId, clients]);
    
    const isBirthdayToday = useMemo(() => {
        if (!selectedClient?.birthday) return false;
        const birth = safeDate(selectedClient.birthday);
        const today = new Date();
        return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
    }, [selectedClient]);

    const isMember = !!(selectedClient?.activeMembershipId || selectedClient?.subscription);
    const hasPackage = (selectedClient?.activePackages?.length || 0) > 0;
    const hasCardOnFile = !!selectedClient?.cardOnFile?.token;

    const filteredPayerOptions = useMemo(() => {
        const listToFilter = payerOptions || [];
        if (!clientSearch.trim()) return listToFilter;
        const search = clientSearch.toLowerCase();
        return listToFilter.filter((c: Client) => 
            c.name.toLowerCase().includes(search) || 
            (c.email && c.email.toLowerCase().includes(search)) || 
            (c.phone && c.phone.includes(search))
        );
    }, [payerOptions, clientSearch]);

    const handleUpdateQuantity = (itemId: string, newQuantity: number) => {
        if (newQuantity <= 0) onCartChange(cart.filter((item: any) => item.id !== itemId));
        else onCartChange(cart.map((item: any) => item.id === itemId ? { ...item, quantity: newQuantity } : item));
    };

    const cartServiceIds = useMemo(() => {
        const appointmentServiceIds = appointmentsData.map((a: any) => a.appointment.serviceId);
        const cartServices = cart.filter((item: any) => item.type === 'service').map((item: any) => item.id);
        const appointmentAddOnIds = appointmentsData.flatMap((a: any) => a.appointment.addOnIds || []);
        return [...new Set([...appointmentServiceIds, ...cartServices, ...appointmentAddOnIds])];
    }, [cart, appointmentsData]);

    const allInvolvedStaff = useMemo(() => {
        const staffIds = new Set<string>();
        appointmentsData.forEach((data: any) => {
            if (data.appointment.staffId) staffIds.add(data.appointment.staffId);
            if (data.appointment.checkoutState?.serviceStaffOverrides) {
                Object.values(data.appointment.checkoutState.serviceStaffOverrides).forEach((id: any) => {
                    if (id && typeof id === 'string') staffIds.add(id);
                });
            }
        });
        return staff.filter((s: Staff) => staffIds.has(s.id));
    }, [appointmentsData, staff]);

    const handleTotalTipChange = (value: number) => {
        const roundedValue = Number(value.toFixed(2));
        setTipAmount(roundedValue);
        if (allInvolvedStaff.length > 0) {
            const splitAmount = Number((roundedValue / allInvolvedStaff.length).toFixed(2));
            const newAllocations: Record<string, number> = {};
            let currentTotal = 0;
            
            allInvolvedStaff.forEach((member, index) => {
                if (index === allInvolvedStaff.length - 1) {
                    newAllocations[member.id] = Number((roundedValue - currentTotal).toFixed(2));
                } else {
                    newAllocations[member.id] = splitAmount;
                    currentTotal += splitAmount;
                }
            });
            setTipAllocations(newAllocations);
        }
    };

    const handleIndividualTipChange = (staffId: string, value: number) => {
        const nextAllocations = { ...tipAllocations, [staffId]: value };
        setTipAllocations(nextAllocations);
        const nextTotal = Object.values(nextAllocations).reduce((sum: number, val: any) => sum + (Number(val) || 0), 0);
        setTipAmount(Number(nextTotal.toFixed(2)));
    };

    const handleApplyDiscount = (code: string) => {
        const codeUpper = code.trim().toUpperCase();
        if (!codeUpper) return;
        const d = discounts.find((d: any) => d.code.toUpperCase() === codeUpper);
        if (d && d.isActive) {
            const isCompatible = !d.applicableServiceIds || d.applicableServiceIds.length === 0 || (d.applicableServiceIds.some((id: string) => cartServiceIds.includes(id)));
            if (!isCompatible) return toast({ variant: 'destructive', title: 'Incompatible Code' });
            if (appliedDiscountCodes.includes(d.code)) return;
            if (!allowStacking) setAppliedDiscountCodes([d.code]);
            else setAppliedDiscountCodes([...appliedDiscountCodes, d.code]);
            setPromoCodeInput('');
        } else toast({ variant: 'destructive', title: 'Invalid Code' });
    };

    const isPerkExhausted = (client: Client, perkId: string, membership: Membership) => {
        if (!client.subscription?.nextBillingDate) return false;
        if (client.subscription.status !== 'active') return true;

        const lastUsedStr = client.subscription.perkLastUsed;
        if (!lastUsedStr) return false;
        
        const lastUsed = parseISO(lastUsedStr);
        const nextBilling = parseISO(client.subscription.nextBillingDate);
        const cycleStart = membership.interval === 'yearly' ? subYears(nextBilling, 1) : subMonths(nextBilling, 1);
        
        if (!isAfter(lastUsed, cycleStart)) return false;

        const usageCount = client.subscription.perkUsage?.[perkId] || 0;
        const perkDef = membership.includedServices?.find(s => s.id === perkId) || membership.includedAddOns?.find(a => a.id === perkId);
        return usageCount >= (perkDef?.quantity || 1);
    };

    const isRetailDiscountExhausted = (client: Client, membership: Membership) => {
        if (!membership.retailDiscountLimit || membership.retailDiscountLimit === 0) return false;
        if (!client.subscription?.nextBillingDate) return false;
        if (client.subscription.status !== 'active') return true;

        const lastUsedStr = client.subscription.perkLastUsed;
        if (!lastUsedStr) return false;

        const lastUsed = parseISO(lastUsedStr);
        const nextBilling = parseISO(client.subscription.nextBillingDate);
        const cycleStart = membership.interval === 'yearly' ? subYears(nextBilling, 1) : subMonths(nextBilling, 1);
        
        if (!isAfter(lastUsed, cycleStart)) return false;

        const usageCount = client.subscription.perkUsage?.['retail_discount'] || 0;
        return usageCount >= membership.retailDiscountLimit;
    };

    const availableEntitlements = useMemo(() => {
        if (!selectedClient) return [];
        const items = [];

        if (selectedClient.activeMembershipId && memberships) {
            const membership = memberships.find(m => m.id === selectedClient.activeMembershipId);
            if (membership) {
                membership.includedServices?.forEach(perk => {
                    if (cartServiceIds.includes(perk.id)) {
                        const exhausted = isPerkExhausted(selectedClient, perk.id, membership);
                        items.push({
                            type: 'membership', id: membership.id, itemId: perk.id, label: perk.name, subLabel: 'Membership Perk', exhausted, 
                            usage: `${selectedClient.subscription?.perkUsage?.[perk.id] || 0}/${perk.quantity}`
                        });
                    }
                });
                membership.includedAddOns?.forEach(perk => {
                    if (cartServiceIds.includes(perk.id)) {
                        const exhausted = isPerkExhausted(selectedClient, perk.id, membership);
                        items.push({
                            type: 'membership', id: membership.id, itemId: perk.id, label: perk.name, subLabel: 'Membership Perk (Add-on)', exhausted, 
                            usage: `${selectedClient.subscription?.perkUsage?.[perk.id] || 0}/${perk.quantity}`
                        });
                    }
                });
            }
        }

        selectedClient.activePackages?.forEach(p => {
            const pkgDef = packages?.find(pkg => pkg.id === p.packageId);
            if (pkgDef && cartServiceIds.includes(pkgDef.serviceId)) {
                items.push({
                    type: 'package', id: pkgDef.id, label: pkgDef.name, subLabel: 'Prepaid Bundle', exhausted: p.sessionsRemaining <= 0,
                    usage: `${p.sessionsRemaining} left`
                });
            }
        });

        return items;
    }, [selectedClient, memberships, packages, cartServiceIds]);

    const handleRedeem = (entitlement: any) => {
        if (entitlement.exhausted) return toast({ variant: 'destructive', title: 'Perk Exhausted', description: 'Limit reached for this billing cycle.' });
        setRedeemedOffer({ type: entitlement.type, id: entitlement.id, itemId: entitlement.itemId });
        toast({ title: 'Entitlement Applied', description: `${entitlement.label} redeemed.` });
    };

    const suggestedDiscounts = useMemo(() => {
        if (!selectedClient || !discounts) return [];
        const completedCount = allAppointments.filter(a => a.clientId === selectedClient.id && a.status === 'completed').length;
        return discounts.filter(d => {
            if (!d.isActive || d.automation?.trigger === 'none' || appliedDiscountCodes.includes(d.code)) return false;
            if (d.limitOnePerCustomer && d.usedByClientIds?.includes(selectedClient.id)) return false;
            const isComp = !d.applicableServiceIds || d.applicableServiceIds.length === 0 || (d.applicableServiceIds.some(id => cartServiceIds.includes(id)));
            if (!isComp) return false;
            const trig = d.automation?.trigger;
            if (trig === 'birthday' && selectedClient.birthday) return isSameMonth(new Date(), safeDate(selectedClient.birthday));
            if (trig === 'loyalty' && d.automation?.appointmentThreshold) return (completedCount + 1) % d.automation.appointmentThreshold === 0;
            if (trig === 'new_client') return completedCount === 0;
            const lastAptDate = selectedClient.lastAppointment ? safeDate(selectedClient.lastAppointment) : null;
            const daysSince = lastAptDate ? differenceInDays(new Date(), lastAptDate) : 0;
            if (trig === 're_engagement' && d.automation?.daysSinceLastVisit && lastAptDate) return daysSince >= d.automation.daysSinceLastVisit;
            return false;
        });
    }, [selectedClient, discounts, appliedDiscountCodes, allAppointments, cartServiceIds]);
    
    const quickTenderOptions = useMemo(() => {
        const options = new Set<number>();
        if (total <= 0) return [];
        const roundUp = (num: number, multiple: number) => Math.ceil(num / multiple) * multiple;
        [5, 10, 20, 50, 100].forEach(m => { const r = roundUp(total, m); if (r > total) options.add(r); });
        return Array.from(options).sort((a,b) => a - b).slice(0, 3);
    }, [total]);

    const handleRemoveDiscount = (code: string) => {
        setAppliedDiscountCodes(appliedDiscountCodes.filter((c: string) => c !== code));
    };

    const isCartEmpty = appointmentsData.length === 0 && cart.length === 0 && appliedAdjustments.size === 0;

    return (
        <div className="flex flex-col space-y-6 md:space-y-10">
            <div className="flex-shrink-0 text-left">
                <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-[0.2em] ml-1">Payer Account</Label>
                <div className="flex gap-2 mt-2">
                    <Dialog open={isPayerDialogOpen} onOpenChange={setIsPayerDialogOpen}>
                        <DialogTrigger asChild>
                            <Button 
                                variant="outline" 
                                className="h-12 md:h-14 rounded-2xl border-2 font-black uppercase tracking-tight shadow-inner bg-muted/5 flex-1 justify-between px-4"
                                onClick={() => setIsPayerDialogOpen(true)}
                            >
                                {selectedClient ? (
                                    <div className="flex items-center gap-3">
                                        <div className="relative shrink-0">
                                            <Avatar className="h-7 w-7 md:h-8 md:w-8 border-2 shadow-sm rounded-xl">
                                                <AvatarImage src={selectedClient.avatarUrl} className="object-cover" />
                                                <AvatarFallback className="font-black text-[10px] md:text-xs bg-primary/10 text-primary">{(selectedClient.name || 'C')?.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            {isMember && (
                                                <div className="absolute -top-1 -right-1 bg-indigo-600 text-white p-0.5 rounded shadow-sm border border-background">
                                                    <Award className="w-2 x-2" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="truncate text-xs md:text-sm">{selectedClient.name}</span>
                                            {isBirthdayToday && (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Cake className="h-3.5 w-3.5 text-pink-500 animate-pulse shrink-0" />
                                                        </TooltipTrigger>
                                                        <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Guest Birthday Today</TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                            {isMember && <Badge className="bg-indigo-600 text-white border-none text-[7px] h-4 px-1 font-black uppercase hidden sm:flex">MEM</Badge>}
                                            {hasPackage && <Badge className="bg-teal-600 text-white border-none text-[7px] h-4 px-1 font-black uppercase hidden sm:flex">PKG</Badge>}
                                        </div>
                                    </div>
                                ) : <span className="opacity-40 text-xs md:text-sm">{isGroupCheckout ? "Select Account..." : "Search Payer..."}</span>}
                                <ChevronDown className="h-4 w-4 opacity-40 ml-2 shrink-0" />
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md rounded-[3rem] p-0 border-4 overflow-hidden shadow-3xl">
                            <DialogHeader className="p-6 pb-4 border-b bg-muted/5 text-left">
                                <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Guest Search</DialogTitle>
                                <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Attribute this sale to a guest dossier.</DialogDescription>
                            </DialogHeader>
                            <div className="p-6 space-y-6">
                                <div className="relative">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                                    <Input 
                                        placeholder="SEARCH BY NAME, EMAIL, OR PHONE..." 
                                        value={clientSearch} 
                                        onChange={e => setClientSearch(e.target.value)} 
                                        className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-sm tracking-tight focus-visible:ring-primary/20"
                                        autoFocus
                                    />
                                </div>
                                <ScrollArea className="h-[300px] md:h-[350px] -mx-2 px-2">
                                    <div className="space-y-2 pb-4">
                                        <button 
                                            className="w-full text-left p-4 hover:bg-muted/50 transition-all flex items-center gap-4 border-2 rounded-2xl border-transparent hover:border-border"
                                            onClick={() => { setSelectedClientId(null); setIsPayerDialogOpen(false); }}
                                        >
                                            <div className="p-3 bg-muted rounded-xl shadow-inner"><User className="w-5 h-5 text-muted-foreground" /></div>
                                            <span className="font-black uppercase tracking-widest text-[11px] text-slate-600">WALK-IN GUEST (ANONYMOUS)</span>
                                        </button>
                                        {filteredPayerOptions.map((c: Client) => {
                                            const cMember = !!(c.activeMembershipId || c.subscription);
                                            const cPkg = (c.activePackages?.length || 0) > 0;
                                            return (
                                                <button 
                                                    key={c.id} 
                                                    className={cn(
                                                        "w-full text-left p-4 transition-all flex items-center gap-4 border-2 rounded-2xl",
                                                        selectedClientId === c.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-primary/[0.03] hover:border-primary/10"
                                                    )}
                                                    onClick={() => { setSelectedClientId(c.id); setIsPayerDialogOpen(false); }}
                                                >
                                                    <div className="relative shrink-0">
                                                        <Avatar className="h-10 w-10 border-2 shadow-sm rounded-xl">
                                                            <AvatarImage src={c.avatarUrl} className="object-cover" />
                                                            <AvatarFallback className="font-black text-xs">{(c.name || 'C')[0]}</AvatarFallback>
                                                        </Avatar>
                                                        {cMember && <div className="absolute -top-1 -right-1 bg-indigo-600 text-white p-0.5 rounded shadow-sm border border-background"><Award className="w-2.5 h-2.5" /></div>}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-black uppercase tracking-tight text-xs text-slate-900 truncate">{c.name}</p>
                                                            {cPkg && <Badge className="bg-teal-600 text-white border-none text-[7px] h-3.5 px-1 font-black uppercase">PKG</Badge>}
                                                        </div>
                                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 truncate">{c.email || c.phone || 'No contact on file'}</p>
                                                    </div>
                                                    {selectedClientId === c.id && <CheckCircle className="ml-auto w-5 h-5 text-primary" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </ScrollArea>
                            </div>
                            <DialogFooter className="p-6 pt-0 bg-muted/5 border-t">
                                <Button variant="outline" className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2" onClick={() => { setIsPayerDialogOpen(false); onAddClientClick(); }}>
                                    <UserPlus className="w-4 h-4 mr-2" />
                                    Register New Client Profile
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                    <Button variant="outline" size="icon" className="h-12 w-12 md:h-14 md:w-14 rounded-2xl border-2 shadow-sm shrink-0 bg-white/50 backdrop-blur-sm" onClick={onScanClick}><QrCode className="w-6 h-6 opacity-40" /></Button>
                </div>
            </div>

            {selectedClient && isBirthdayToday && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
                    <Alert className="bg-pink-500/5 border-pink-500/20 border-2 rounded-2xl p-4 shadow-lg shadow-pink-500/5">
                        <Cake className="h-5 w-5 text-pink-500" />
                        <AlertTitle className="text-[10px] font-black uppercase text-pink-600 tracking-widest">Birthday Protocol Active</AlertTitle>
                        <AlertDescription className="text-[10px] font-bold uppercase text-slate-600 opacity-80 leading-tight mt-1 text-left">
                            It's {selectedClient.name.split(' ')[0]}'s special day. Consider a complimentary enhancement or birthday gift.
                        </AlertDescription>
                    </Alert>
                </motion.div>
            )}

            {selectedClient && availableEntitlements.length > 0 && (
                <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2 ml-1">
                        <Award className="w-3 h-3" />
                        Available Benefits
                    </p>
                    <div className="grid gap-2">
                        {availableEntitlements.map((ent, idx) => (
                            <Button 
                                key={idx} 
                                variant="outline" 
                                disabled={ent.exhausted || redeemedOffer?.itemId === ent.itemId}
                                onClick={() => handleRedeem(ent)}
                                className={cn(
                                    "h-auto py-3 px-4 rounded-2xl border-2 flex justify-between items-center transition-all",
                                    redeemedOffer?.itemId === ent.itemId ? "bg-green-500/10 border-green-500/20 text-green-700" : "bg-white border-indigo-500/10 hover:border-primary/30"
                                )}
                            >
                                <div className="text-left min-w-0 flex-1">
                                    <p className="text-[11px] font-black uppercase tracking-tight truncate">{ent.label}</p>
                                    <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{ent.subLabel}</p>
                                </div>
                                <div className="text-right ml-4 shrink-0">
                                    {redeemedOffer?.itemId === ent.itemId ? (
                                        <Badge className="bg-green-500 text-white border-none h-5 px-2 font-black text-[8px] uppercase">Applied</Badge>
                                    ) : (
                                        <div className="space-y-0.5">
                                            <Badge variant="outline" className={cn("h-5 px-2 font-black text-[8px] uppercase border-2", ent.exhausted ? "text-destructive border-destructive/20" : "text-indigo-600 border-indigo-500/20")}>{ent.usage}</Badge>
                                        </div>
                                    )}
                                </div>
                            </Button>
                        ))}
                    </div>
                </div>
            )}

            <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                        <ShoppingCart className="w-4 h-4 text-primary" />
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Itemized Manifest</h3>
                    </div>
                </div>
                
                {isCartEmpty ? (
                    <div className="py-12 md:py-16 text-center border-4 border-dashed rounded-[3rem] md:rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                        <ShoppingCart className="w-10 h-10 md:w-12 md:h-12" />
                        <div className="space-y-1">
                            <p className="text-sm font-black uppercase tracking-widest">Cart Idle</p>
                            <p className="text-[10px] font-bold uppercase tracking-tight px-4 text-center">Scan a ticket or select retail items</p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {appointmentsData.map((data: any) => {
                            const isRedeemed = redeemedOffer?.itemId === data.service.id;
                            const addOns = (data.appointment.addOnIds || []).map((id: any) => services.find((s: any) => s.id === id)).filter(Boolean);
                            
                            const overrides = data.appointment.checkoutState?.serviceStaffOverrides || {};
                            const mainStaffId = overrides[data.service.id] || data.appointment.staffId;
                            const mainStaffMember = staff.find((s: any) => s.id === mainStaffId);

                            return (
                                <Card key={data.appointment.id} className={cn("overflow-hidden rounded-[1.5rem] md:rounded-[2rem] border-2 shadow-sm transition-all text-left", isRedeemed ? "border-primary bg-primary/[0.03] shadow-lg" : "border-border/50 bg-muted/5")}>
                                    <CardContent className="p-4 md:p-5 space-y-3 md:space-y-4">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <p className="font-black text-xs md:text-sm uppercase tracking-tight text-slate-900 truncate">{data.service.name}</p>
                                                    {isRedeemed && <Badge className="bg-primary text-white border-none text-[7px] h-4 px-1.5 font-black uppercase tracking-widest">Entitlement</Badge>}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">{mainStaffMember?.name?.split(' ')[0] || 'Tech'} &middot; {data.service.duration}m</p>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className={cn("font-black font-mono text-base md:text-lg tracking-tighter", isRedeemed ? "line-through text-muted-foreground opacity-40" : "text-slate-900")}>${getServicePrice(data.service, data.staff).toFixed(2)}</p>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive -mr-2" onClick={() => onSelectAppointment(data.appointment.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                                            </div>
                                        </div>
                                        
                                        {addOns.length > 0 && (
                                            <div className="space-y-2 pl-4 border-l-2 border-primary/10">
                                                {addOns.map((addon: any) => {
                                                    const addonStaffId = overrides[addon.id] || data.appointment.staffId;
                                                    const addonStaffMember = staff.find((s: any) => s.id === addonStaffId);
                                                    const isAddonRedeemed = redeemedOffer?.itemId === addon.id;
                                                    
                                                    return (
                                                        <div key={addon.id} className="space-y-0.5 group">
                                                            <div className="flex justify-between items-center">
                                                                <div className="flex items-center gap-2">
                                                                    <span className={cn("text-[10px] font-bold uppercase tracking-tight", isAddonRedeemed ? "text-primary" : "text-muted-foreground")}>+ {addon.name}</span>
                                                                    {isAddonRedeemed && <Badge className="bg-primary text-white border-none text-[6px] h-3 px-1 font-black uppercase">REDEEMED</Badge>}
                                                                </div>
                                                                <span className={cn("text-[10px] font-black font-mono", isAddonRedeemed ? "line-through text-muted-foreground opacity-40" : "text-muted-foreground")}>${getServicePrice(addon, data.staff).toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 opacity-60">
                                                                <span className="text-[8px] font-black uppercase text-primary tracking-widest">{addonStaffMember?.name?.split(' ')[0] || 'Tech'}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {data.appointment.checkoutState?.additionalCharge > 0 && (
                                            <div className="pt-3 border-t border-dashed flex justify-between items-center">
                                                <span className="text-[10px] font-black uppercase text-muted-foreground">Audit Overage</span>
                                                <div className="flex items-center gap-3">
                                                    <span className={cn("font-black font-mono text-xs", waivedAppointmentFees.has(data.appointment.id) ? "line-through text-muted-foreground opacity-40" : "text-amber-600")}>+${data.appointment.checkoutState.additionalCharge.toFixed(2)}</span>
                                                    {isOwnerOrAdmin && (waivedAppointmentFees.has(data.appointment.id) ? <Button variant="ghost" size="xs" className="h-5 px-1.5 text-[8px] font-black uppercase text-primary underline" onClick={() => onWaiveFeeToggle(data.appointment.id, false)}>Restore</Button> : <Button variant="ghost" size="xs" className="h-5 px-1.5 text-[8px] font-black uppercase text-amber-600 border border-amber-200 bg-amber-50" onClick={() => handleWaiveClick(data.appointment.id)}>Absorb</Button>)}
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}

                        {cart.map((item: any) => (
                            <div key={item.id} className="p-3 md:p-4 rounded-2xl md:rounded-3xl bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all flex items-center gap-3 md:gap-4 group">
                                <div className="flex-1 min-w-0 text-left">
                                    <p className="font-black text-[11px] md:text-xs uppercase tracking-tight text-slate-900 truncate">{item.name}</p>
                                    <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-60">{item.type}</p>
                                </div>
                                <div className="flex items-center gap-2 md:gap-3">
                                    <div className="flex items-center bg-background rounded-xl border-2 h-8 md:h-9 px-1 shadow-sm">
                                        <Button variant="ghost" size="icon" className="h-6 w-6 md:h-7 md:w-7 rounded-lg hover:bg-primary/5" onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}><Minus className="h-3 w-3"/></Button>
                                        <span className="w-6 md:w-8 text-center text-xs font-black">{item.quantity}</span>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 md:h-7 md:w-7 rounded-lg hover:bg-primary/5" onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}><Plus className="h-3 w-3"/></Button>
                                    </div>
                                    <p className="font-black font-mono text-sm tracking-tighter w-14 md:w-16 text-right text-slate-900">${(item.price * item.quantity).toFixed(2)}</p>
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={() => handleUpdateQuantity(item.id, 0)}><Trash2 className="h-4 w-4"/></Button>
                            </div>
                        ))}

                        {Array.from(appliedAdjustments).map(id => {
                            const fee = clients.flatMap((c: any) => c.unpaidFees || []).find((f: any) => f.feeId === id);
                            return (
                                <div key={id} className="p-3 md:p-4 rounded-2xl md:rounded-[2rem] border-2 border-destructive/20 bg-destructive/[0.02] flex items-center gap-3 md:gap-4 animate-in fade-in slide-in-from-left-2">
                                    <div className="p-2 bg-destructive/10 rounded-xl shadow-inner"><Wallet className="w-4 h-4 md:w-5 md:h-5 text-destructive" /></div>
                                    <div className="flex-1 min-w-0 text-left">
                                        <p className="font-black text-[11px] md:text-xs uppercase tracking-tight text-destructive truncate">{fee?.reason}</p>
                                        <p className="text-[9px] font-black text-destructive/60 uppercase tracking-widest">Protocol Debt</p>
                                    </div>
                                    <p className="font-black font-mono text-sm tracking-tighter text-destructive">+${fee?.feeAmount.toFixed(2)}</p>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => onApplyAdjustmentToggle(id as string, false)}><XCircle className="h-4 w-4"/></Button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="space-y-4">
                <div className="flex items-center gap-2 px-1 text-left">
                    <Tag className="w-4 h-4 text-primary" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Incentive Architecture</h3>
                </div>
                <div className="flex gap-3">
                    <div className="relative flex-1">
                        <Tag className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                        <Input placeholder="MANUAL CODE..." value={promoCodeInput} onChange={e => setPromoCodeInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleApplyDiscount(promoCodeInput)} className="pl-10 h-11 md:h-12 rounded-2xl border-2 font-black uppercase text-[10px] md:text-xs tracking-widest focus-visible:ring-primary/20 bg-muted/5 shadow-inner" />
                    </div>
                    <Button variant="outline" size="icon" className="h-11 w-11 md:h-12 md:w-12 rounded-2xl border-2 shadow-sm shrink-0" onClick={() => setIsDiscountBrowserOpen(true)}><Users className="w-5 h-5" /></Button>
                </div>

                {appliedDiscountCodes.length > 0 && (
                    <div className="space-y-2">
                        {appliedDiscountCodes.map((code: string) => (
                            <div key={code} className="p-2 md:p-3 rounded-xl md:rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-between animate-in zoom-in-95">
                                <div className="flex items-center gap-2 px-1">
                                    <CheckCircle2 className="h-4 w-4 text-primary" />
                                    <p className="text-[10px] md:text-xs font-black uppercase tracking-widest text-primary">{code}</p>
                                </div>
                                <Button variant="ghost" size="icon" className="h-7 i-7 md:h-8 md:w-8 text-primary hover:bg-primary/10 rounded-xl" onClick={() => handleRemoveDiscount(code)}><X className="h-4 w-4" /></Button>
                            </div>
                        ))}
                    </div>
                )}

                {suggestedDiscounts.length > 0 && (
                    <div className="space-y-3 pt-2 text-left">
                        <p className="text-[9px] font-black uppercase text-amber-600 tracking-[0.2em] flex items-center gap-2 px-1"><Wand2 className="h-3 w-3" /> System Recommendation</p>
                        {suggestedDiscounts.map((d: any) => (
                            <Button key={d.id} variant="outline" className="w-full justify-between h-auto py-3 md:py-4 px-4 md:px-5 border-amber-500/20 bg-amber-500/[0.03] hover:bg-amber-500/10 border-2 rounded-2xl md:rounded-[1.5rem] group transition-all" onClick={() => handleApplyDiscount(d.code)}>
                                <div className="text-left min-w-0 flex-1">
                                    <p className="text-[11px] md:text-xs font-black uppercase tracking-widest text-amber-700">{d.code}</p>
                                    <p className="text-[9px] md:text-[10px] text-muted-foreground font-bold truncate opacity-60 uppercase">{d.description}</p>
                                </div>
                                <div className="text-right ml-4 shrink-0">
                                    <p className="text-xs md:sm font-black text-amber-700">{d.type === 'percentage' ? `${d.value}%` : `$${d.value}`} OFF</p>
                                </div>
                            </Button>
                        ))}
                    </div>
                )}
            </div>

            <div className="space-y-4 pt-6 border-t border-dashed text-left">
                <div className="flex justify-between items-center text-muted-foreground font-bold uppercase text-[9px] tracking-widest opacity-60">
                    <p>Subtotal</p>
                    <p className="font-mono text-[11px] md:text-xs">${subtotal.toFixed(2)}</p>
                </div>
                {(discount + membershipDiscount) > 0 && (
                    <div className="flex justify-between items-center text-[10px] text-primary font-black uppercase tracking-tighter">
                        <span className="flex items-center gap-2"><Percent className="w-3.5 h-3.5" /> Promotion Delta</span>
                        <span className="font-mono text-[11px] md:text-xs">-${(discount + membershipDiscount).toFixed(2)}</span>
                    </div>
                )}
                {appliedAdjustments.size > 0 && (
                    <div className="flex justify-between items-center text-[10px] text-destructive font-black uppercase tracking-tighter">
                        <span className="flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Debt Consolidation</span>
                        <span className="font-mono text-[11px] md:text-xs">+{Array.from(appliedAdjustments).reduce((sum, id) => {
                            const fee = clients.flatMap((c: any) => c.unpaidFees || []).find((f: any) => f.feeId === id);
                            return sum + (fee?.feeAmount || 0);
                        }, 0).toFixed(2)}</span>
                    </div>
                )}
                {redeemedOffer && (
                    <div className="flex justify-between items-center text-[10px] text-indigo-600 font-black uppercase tracking-tighter">
                        <span className="flex items-center gap-2"><Award className="w-3.5 h-3.5" /> Entitlement Active</span>
                        <span className="font-black">REDEEMED</span>
                    </div>
                )}
                <div className="flex justify-between items-center text-muted-foreground font-bold uppercase text-[9px] tracking-widest opacity-60">
                    <p>Studio Tax (7%)</p>
                    <p className="font-mono text-[11px] md:text-xs">${tax.toFixed(2)}</p>
                </div>
                
                <div className="flex justify-between items-center py-1 md:py-2">
                    <p className="font-black uppercase text-token font-bold uppercase text-[10px] tracking-[0.2em] text-muted-foreground">Gratuity</p>
                    <div className="relative w-32 md:w-36">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 md:h-4 md:w-4 text-primary font-black" />
                        <Input 
                            type="number" 
                            value={tipAmount || ''} 
                            onChange={(e) => handleTotalTipChange(parseFloat(e.target.value) || 0)} 
                            className="h-9 md:h-11 text-right pr-4 pl-9 font-black text-base md:text-xl border-2 rounded-xl md:rounded-2xl shadow-inner focus-visible:ring-primary/20 bg-muted/5" 
                            placeholder="0.00" 
                        />
                    </div>
                </div>

                {allInvolvedStaff.length > 1 && (
                    <div className="p-3 md:p-4 rounded-xl md:rounded-[1.5rem] border-2 bg-muted/10 space-y-2 md:space-y-3">
                        <p className="text-[8px] md:text-[9px] font-black text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2 opacity-60"><Users className="w-3 x-3" /> Distribution Matrix</p>
                        {allInvolvedStaff.map((member: any) => (
                            <div key={member.id} className="flex items-center gap-3">
                                <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
                                    <Avatar className="h-5 w-5 md:h-6 md:w-6 border-2 border-white shadow-sm rounded-lg">
                                        <AvatarImage src={member.avatarUrl} className="object-cover" />
                                        <AvatarFallback className="font-black text-[7px] md:text-[8px]">{(member.name || 'S')[0]}</AvatarFallback>
                                    </Avatar>
                                    <span className="text-[9px] font-black uppercase tracking-tight truncate text-slate-700">{member.name.split(' ')[0]}</span>
                                </div>
                                <div className="relative w-24 md:w-32">
                                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 md:h-3.5 md:w-3.5 text-muted-foreground" />
                                    <Input 
                                        type="number" 
                                        value={tipAllocations[member.id] || ''} 
                                        onChange={(e) => handleIndividualTipChange(member.id, parseFloat(e.target.value) || 0)} 
                                        className="h-7 md:h-8 text-right text-[10px] pr-2 pl-5 font-bold rounded-lg border-primary/10 focus-visible:ring-primary/20" 
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex justify-between items-baseline font-black text-xl md:text-4xl text-primary tracking-tighter px-1 pt-4 border-t border-border/50">
                    <div className="space-y-0.5 text-left">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground opacity-60">Final Settlement</p>
                        <p className="text-[8px] md:text-[9px] font-bold uppercase text-primary/40">COLLECT UPON AUTHORIZE</p>
                    </div>
                    <p className="font-mono text-2xl md:text-4xl">${total.toFixed(2)}</p>
                </div>

                <AnimatePresence>
                    {amountTendered > total && paymentTab === 'cash' && (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="pt-2">
                            <Button 
                                variant="outline" 
                                className="w-full h-12 rounded-2xl border-2 border-green-500/20 bg-green-500/5 hover:bg-green-500/10 text-green-700 font-black uppercase text-[10px] tracking-widest shadow-sm"
                                onClick={() => handleTotalTipChange(tipAmount + (amountTendered - total))}
                            >
                                <Sparkles className="w-3.5 h-3.5 mr-2" />
                                Keep Full Change as Tip (${(amountTendered - total).toFixed(2)})
                            </Button>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="space-y-3 md:space-y-4 pt-6">
                    <RadioGroup value={paymentTab} onValueChange={setPaymentTab} className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
                        <div>
                            <RadioGroupItem value="cash" id="hub-pay-cash" className="peer sr-only" disabled={!activeTill} />
                            <RadioLabel htmlFor="hub-pay-cash" className={cn("flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-white p-2 text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/[0.03] peer-data-[state=checked]:text-primary transition-all cursor-pointer h-16 md:h-20 shadow-sm", !activeTill && "opacity-40 grayscale")}>
                                <Banknote className="mb-1 h-5 w-5 md:h-6 md:w-6 opacity-40" />
                                Cash
                            </RadioLabel>
                        </div>
                        <div>
                            <RadioGroupItem value="card" id="hub-pay-card" className="peer sr-only" />
                            <RadioLabel htmlFor="hub-pay-card" className={cn("flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-white p-2 text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/[0.03] peer-data-[state=checked]:text-primary transition-all cursor-pointer h-16 md:h-20 shadow-sm")}>
                                <CreditCard className="mb-1 h-5 w-5 md:h-6 md:w-6 opacity-40" />
                                Card
                            </RadioLabel>
                        </div>
                        <div>
                            <RadioGroupItem value="card_on_file" id="hub-pay-cof" className="peer sr-only" disabled={!hasCardOnFile}/>
                            <RadioLabel htmlFor="hub-pay-cof" className={cn("flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-white p-2 text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/[0.03] peer-data-[state=checked]:text-primary transition-all cursor-pointer h-16 md:h-20 shadow-sm", !hasCardOnFile && "opacity-40 grayscale")}>
                                <ShieldCheck className="mb-1 h-5 w-5 md:h-6 md:w-6 opacity-40" />
                                Vaulted
                            </RadioLabel>
                        </div>
                        <div>
                            <RadioGroupItem value="scan" id="hub-pay-scan" className="peer sr-only" />
                            <RadioLabel htmlFor="hub-pay-scan" className={cn("flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-white p-2 text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/[0.03] peer-data-[state=checked]:text-primary transition-all cursor-pointer h-16 md:h-20 shadow-sm")}>
                                <ScanIcon className="mb-1 h-5 w-5 md:h-6 md:w-6 opacity-40" />
                                Scan
                            </RadioLabel>
                        </div>
                    </RadioGroup>

                    {paymentTab === 'cash' && (
                        <div className="space-y-3 md:space-y-4 pt-1 md:pt-2 animate-in slide-in-from-top-4 duration-500">
                            <div className="grid grid-cols-2 gap-3 md:gap-4">
                                <div className="space-y-1.5 text-left">
                                    <Label className="text-[9px] md:text-[10px] uppercase font-black tracking-widest text-muted-foreground ml-2">Tendered</Label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 h-4 w-4 md:h-5 md:w-5 text-muted-foreground font-black" />
                                        <Input type="number" value={amountTendered || ''} onChange={(e) => setAmountTendered(parseFloat(e.target.value) || 0)} className="pl-8 md:pl-10 h-12 md:h-14 font-black text-lg md:text-2xl border-2 rounded-xl md:rounded-2xl shadow-inner bg-muted/5 focus-visible:ring-primary/20" />
                                    </div>
                                </div>
                                {amountTendered > total && (
                                    <div className="space-y-1.5 text-left">
                                        <Label className="text-[9px] md:text-[10px] uppercase font-black tracking-widest text-green-600 ml-2">Change Due</Label>
                                        <div className="h-12 md:h-14 flex items-center justify-center bg-green-500/10 border-2 border-green-500/20 rounded-xl md:rounded-2xl shadow-sm">
                                            <p className="font-black text-lg md:text-2xl text-green-600 font-mono tracking-tighter">-${(amountTendered - total).toFixed(2)}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                {quickTenderOptions.map(val => (
                                    <Button key={val} variant="outline" size="sm" className="flex-1 font-black h-9 md:h-11 rounded-xl text-[10px] md:text-xs shrink-0 border-2 bg-background hover:bg-primary/5" onClick={() => setAmountTendered(val)}>${val}</Button>
                                ))}
                                <Button variant="outline" size="sm" className="flex-1 font-black h-9 md:h-11 rounded-xl border-2 border-primary text-primary text-[9px] md:text-xs shrink-0 hover:bg-primary/5" onClick={() => setAmountTendered(total)}>EXACT AMOUNT</Button>
                            </div>
                        </div>
                    )}

                    {!activeTill && (
                        <div className="p-4 rounded-2xl border-2 border-dashed bg-amber-50 border-amber-200 flex items-start gap-3 text-left">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-[9px] font-bold text-amber-700 uppercase leading-relaxed">
                                Cash payments disabled. Please open a till session to reconcile physical currency.
                            </p>
                        </div>
                    )}

                    <div className="pt-2">
                        <Button 
                            className="w-full h-14 md:h-16 text-base md:text-xl font-black rounded-2xl md:rounded-[2rem] shadow-2xl shadow-primary/30 transition-all hover:scale-[1.02] active:scale-95 uppercase tracking-tight" 
                            onClick={() => onCheckout({paymentMethod: paymentTab, amountTendered})} 
                            disabled={isSubmitting || (paymentTab === 'cash' && amountTendered < total) || isCartEmpty}
                        >
                            {isSubmitting ? <Loader className="animate-spin h-6 w-6 md:h-7 md:w-7" /> : (total <= 0 ? 'FINALIZE FREE SESSION' : `AUTHORIZE $${total.toFixed(2)}`)}
                        </Button>
                    </div>
                </div>
            </div>
            <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts || []} onSelect={handleApplyDiscount} cartServiceIds={cartServiceIds} />
            <WaiveFeeDialog open={isWaiveAuthOpen} onOpenChange={setIsWaiveAuthOpen} staff={staff} onConfirm={handleConfirmWaive} />
        </div>
    );
};

export default function POSPage() {
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

    const isRetailDiscountExhausted = (client: Client, membership: Membership) => {
        if (!membership.retailDiscountLimit || membership.retailDiscountLimit === 0) return false;
        if (!client.subscription?.nextBillingDate) return false;
        if (client.subscription.status !== 'active') return true;

        const lastUsedStr = client.subscription.perkLastUsed;
        if (!lastUsedStr) return false;

        const lastUsed = parseISO(lastUsedStr);
        const nextBilling = parseISO(client.subscription.nextBillingDate);
        const cycleStart = membership.interval === 'yearly' ? subYears(nextBilling, 1) : subMonths(nextBilling, 1);
        
        if (!isAfter(lastUsed, cycleStart)) return false;

        const usageCount = client.subscription.perkUsage?.['retail_discount'] || 0;
        return usageCount >= membership.retailDiscountLimit;
    };

    const membershipDiscount = useMemo(() => {
        if (!selectedClientId || !clients || !memberships || !packages) return 0;
        const client = clients.find(c => c.id === selectedClientId);
        const mId = client?.activeMembershipId || client?.subscription?.membershipId;
        
        if (client?.subscription?.status && client.subscription.status !== 'active') return 0;

        let bestDiscountPct = 0;
        let eligibleProductIds: string[] = [];

        if (mId) {
            const membership = memberships.find(m => m.id === mId);
            if (membership?.retailDiscount) {
                const exhausted = isRetailDiscountExhausted(client!, membership);
                if (!exhausted) {
                    bestDiscountPct = membership.retailDiscount;
                    eligibleProductIds = membership.applicableProductIds || [];
                }
            }
        }

        if (client?.activePackages) {
            client.activePackages.forEach(p => {
                const pkgDef = packages.find(pkg => pkg.id === p.packageId);
                if (pkgDef?.retailDiscount && pkgDef.retailDiscount > bestDiscountPct) {
                    bestDiscountPct = pkgDef.retailDiscount;
                    eligibleProductIds = pkgDef.applicableProductIds || [];
                }
            });
        }

        if (bestDiscountPct === 0) return 0;

        return retailItems.reduce((acc, item) => {
            const product = inventory.find(p => p.id === item.id);
            if (product?.type !== 'retail') return acc;
            
            const isEligible = eligibleProductIds.length === 0 || eligibleProductIds.includes(item.id);
            if (isEligible) {
                const price = product?.msrp || product?.costPerUnit || 0;
                return acc + (price * item.quantity * (bestDiscountPct / 100));
            }
            return acc;
        }, 0);
    }, [selectedClientId, clients, memberships, packages, retailItems, inventory]);

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
        const tmhrValue = selectedTenant.tmhr || 50;
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
                    const timeLostCost = (lateMinutes / 60) * tmhrValue;
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
        
        const sanitizedCheckoutState = sanitizeForFirestore(checkoutState);

        if (allComplete) {
            batch.update(appointmentRef, { status: 'ready_for_checkout', checkoutState: sanitizedCheckoutState, actualEndTime: new Date().toISOString() });
            if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'ready_for_checkout', tenantId });
            const involvedIds = new Set<string>(); if (apt.staffId) involvedIds.add(apt.staffId);
            if (checkoutState.serviceStaffOverrides) Object.values(checkoutState.serviceStaffOverrides).forEach((id: any) => { if (id && typeof id === 'string') involvedIds.add(id); });
            involvedIds.forEach(sid => { batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true }); });
        } else {
            batch.update(appointmentRef, { checkoutState: sanitizedCheckoutState });
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
                const addonStaffMember = (staff || []).find((s: any) => s.id === addonStaffId);
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

            // Track Retail Discount usage if applied
            if (membershipDiscount > 0) {
                const mId = selectedClient.activeMembershipId || selectedClient.subscription?.membershipId;
                const membership = memberships?.find(m => m.id === mId);
                if (membership?.retailDiscountLimit) {
                    updates['subscription.perkUsage.retail_discount'] = increment(1);
                    updates['subscription.perkLastUsed'] = now;
                }
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
        
        const finalTax = 0; // Simplified
        if (discount > 0) {
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { date: now, description: `Promotion Applied`, clientOrVendor: 'Internal', clientId: selectedClientId, type: 'expense', context: 'Business', category: 'Discounts', amount: discount, paymentMethod: 'Internal', hasReceipt: false });
        }

        if (paymentData.paymentMethod === 'cash' && activeTill) {
            const finalCashInput = totalCashIncrease + finalTax + cashTipsTotal;
            batch.update(doc(firestore, `tenants/${tenantId}/tillSessions`, activeTill.id), { 
                expectedCash: increment(finalCashInput),
                totalCashSales: increment(totalCashIncrease + finalTax),
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
            ...sanitizeForFirestore(data)
        };
        await setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/tillSessions`, sessionId), session, {});
        toast({ title: "Till Opened", description: `Session initialized with $${data.openingFloat.toFixed(2)}.` });
    };

    const handleCloseTill = async (data: any) => {
        if (!firestore || !tenantId || !activeTill) return;
        const updates: Partial<TillSession> = {
            status: 'closed',
            closedAt: new Date().toISOString(),
            ...sanitizeForFirestore(data)
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

    const tax = subtotal * 0.07;
    const total = subtotal + tax + tipAmount - discount - membershipDiscount;

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
        activeTill, staff, role
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

export function POSPageWrapper() { return <Suspense fallback={<div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Terminal...</p></div>}><POSPage /></Suspense> }
