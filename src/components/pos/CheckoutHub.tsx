'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { 
    Banknote, 
    CreditCard, 
    Scan, 
    Trash2, 
    DollarSign, 
    Award, 
    Loader, 
    Tag, 
    Wand2, 
    X, 
    ShoppingCart, 
    CheckCircle, 
    Percent, 
    AlertTriangle, 
    QrCode, 
    ShieldCheck, 
    Users,
    MessageSquare,
    Repeat,
    Wallet,
    UserPlus,
    Cake
} from 'lucide-react';
import { type Appointment, type Service, type Client, type Discount, type Staff, type Membership, type Package, getServicePrice } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '../ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { BrowseDiscountsDialog } from '../discounts/BrowseDiscountsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { subMonths, parseISO, isAfter, isSameMonth, differenceInDays, isToday, format } from 'date-fns';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

interface WaiveFeeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    feeAmount: number;
    staff: Staff[];
    onConfirm: (staffMember: Staff, reason: string) => void;
}

const WaiveFeeDialog = ({ open, onOpenChange, feeAmount, staff, onConfirm }: WaiveFeeDialogProps) => {
    const [pin, setPin] = useState('');
    const [reason, setReason] = useState('');
    const { toast } = useToast();

    const handleConfirm = () => {
        const authorizedStaff = staff.find(s => s.pin === pin && s.role === 'admin');
        if (!authorizedStaff) {
            toast({ 
                variant: 'destructive', 
                title: 'Unauthorized', 
                description: 'Invalid PIN or insufficient permissions. Admin authorization required.' 
            });
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
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-primary" />
                        Waive Usage Overage Fees
                    </DialogTitle>
                    <DialogDescription>Authorize the waiver of ${feeAmount.toFixed(2)} with a manager PIN.</DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-4">
                    <div className="space-y-2 text-center">
                        <Label className="text-sm font-black uppercase tracking-widest text-muted-foreground">Admin/Owner PIN</Label>
                        <div className="flex justify-center">
                            <Input 
                                type="password" 
                                placeholder="••••"
                                maxLength={4} 
                                className="text-center text-2xl font-black h-14 w-48 tracking-[0.5em] bg-muted/50 border-2" 
                                value={pin} 
                                onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="waive-reason-pos">Reason for Waiver</Label>
                        <Textarea id="waive-reason-pos" value={reason} onChange={e => setReason(e.target.value)} placeholder="Provide context for this waiver..." />
                    </div>
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleConfirm} disabled={pin.length < 4 || !reason.trim()}>Absorb Fees</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export const CheckoutHub = ({ 
    cart, 
    onCartChange,
    appointmentsData,
    onSelectAppointment,
    clients,
    isGroupCheckout,
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
    membershipDiscount,
    showTitle = true,
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
}: { 
    cart: any[], 
    onCartChange: (cart: any[]) => void,
    appointmentsData: { appointment: Appointment, client: Client, service: Service, addOnServices: Service[], staff: Staff }[],
    onSelectAppointment: (appointmentId: string) => void,
    clients: Client[],
    isGroupCheckout: boolean,
    payerOptions: Client[],
    selectedClientId: string | null,
    setSelectedClientId: (id: string | null) => void,
    onAddClientClick: () => void,
    onScanClick: () => void,
    subtotal: number,
    tax: number,
    total: number,
    tipAmount: number,
    setTipAmount: (amount: number) => void;
    onCheckout: (details: { paymentMethod: string; amountTendered?: number }) => void;
    appliedDiscountCodes: string[];
    setAppliedDiscountCodes: (codes: string[]) => void;
    discount: number;
    membershipDiscount: number;
    showTitle?: boolean,
    isSubmitting: boolean;
    paymentTab: string;
    setPaymentTab: (tab: string) => void;
    discounts: Discount[];
    amountTendered: number;
    setAmountTendered: (amount: number) => void;
    appliedAdjustments: Set<string>;
    onApplyAdjustmentToggle: (adjustmentId: string, apply: boolean) => void;
    redeemedOffer: { type: 'membership' | 'package' | 'retail_discount'; id: string } | null;
    setRedeemedOffer: (offer: { type: 'membership' | 'package' | 'retail_discount'; id: string } | null) => void;
    memberships: Membership[];
    packages: Package[];
    allowStacking: boolean;
    waivedAppointmentFees: Map<string, { authorizerId: string; reason: string }>;
    onWaiveFeeToggle: (id: string, waive: boolean, authorizerId?: string, reason?: string) => void;
    tipAllocations: Record<string, number>;
    setTipAllocations: (allocations: Record<string, number>) => void;
}) => {
    
    const [promoCodeInput, setPromoCodeInput] = useState('');
    const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);
    const { appointments: allAppointments, staff, services } = useInventory();
    const { role, selectedTenant } = useTenant();
    const { toast } = useToast();
    const { firestore } = useFirebase();

    const [isWaiveAuthOpen, setIsWaiveAuthOpen] = useState(false);
    const [pendingWaiveAptId, setPendingWaiveAptId] = useState<string | null>(null);

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
            toast({ title: "Fees Absorbed", description: `Authorization provided by ${authorizer.name}.` });
        }
    };

    const handleRemoveAddOn = async (appointmentId: string, addOnId: string) => {
        if (!firestore || !selectedTenant) return;
        
        const appointmentRef = doc(firestore, 'tenants', selectedTenant.id, 'appointments', appointmentId);
        const data = appointmentsData.find(a => a.appointment.id === appointmentId);
        if (!data) return;

        const newAddOns = (data.appointment.addOnIds || []).filter(id => id !== addOnId);
        const newOverrides = { ...(data.appointment.checkoutState?.serviceStaffOverrides || {}) };
        delete newOverrides[addOnId];

        updateDocumentNonBlocking(appointmentRef, {
            addOnIds: newAddOns,
            'checkoutState.serviceStaffOverrides': newOverrides
        });
        
        toast({ title: "Service Removed" });
    };

    const selectedClient = useMemo(() => {
        return clients.find((c: Client) => c.id === selectedClientId);
    }, [selectedClientId, clients]);

    const isBirthdayToday = useMemo(() => {
        if (!selectedClient?.birthday) return false;
        const birth = safeDate(selectedClient.birthday);
        const today = new Date();
        return birth.getMonth() === today.getMonth() && birth.getDate() === today.getDate();
    }, [selectedClient]);

    const handleUpdateQuantity = (itemId: string, newQuantity: number) => {
        if (newQuantity <= 0) {
            onCartChange(cart.filter(item => item.id !== itemId));
        } else {
            onCartChange(cart.map(item => item.id === itemId ? { ...item, quantity: newQuantity } : item));
        }
    };

    const cartServiceIds = useMemo(() => {
        const appointmentServiceIds = appointmentsData.map(a => a.appointment.serviceId);
        const cartServices = cart.filter(item => item.type === 'service').map(item => item.id);
        const appointmentAddOnIds = appointmentsData.flatMap(a => a.appointment.addOnIds || []);
        return [...new Set([...appointmentServiceIds, ...cartServices, ...appointmentAddOnIds])];
    }, [cart, appointmentsData]);

    const handleApplyDiscount = (code: string) => {
        const codeUpper = code.trim().toUpperCase();
        if (!codeUpper) return;

        const d = discounts.find(d => d.code.toUpperCase() === codeUpper);
        if (d && d.isActive) {
            const isCompatible = !d.applicableServiceIds || d.applicableServiceIds.length === 0 || 
                                (d.applicableServiceIds.some(id => cartServiceIds.includes(id)));
            
            if (!isCompatible) {
                toast({ variant: 'destructive', title: 'Incompatible Discount', description: 'This code is restricted to services not currently in the cart.' });
                return;
            }

            if (appliedDiscountCodes.includes(d.code)) {
                toast({ title: 'Already Applied', description: `Discount ${d.code} is already in the list.` });
                return;
            }

            if (!allowStacking) {
                setAppliedDiscountCodes([d.code]);
            } else {
                setAppliedDiscountCodes([...appliedDiscountCodes, d.code]);
            }
            setPromoCodeInput('');
        } else {
            toast({ variant: 'destructive', title: 'Invalid Code', description: 'This discount code is not active or invalid.' });
        }
    };

    const handleRemoveDiscount = (code: string) => {
        setAppliedDiscountCodes(appliedDiscountCodes.filter(c => c !== code));
    };

    const suggestedDiscounts = useMemo(() => {
        if (!selectedClient || !discounts) return [];

        const completedCount = allAppointments.filter(a => a.clientId === selectedClient.id && a.status === 'completed').length;

        return discounts.filter(d => {
            if (!d.isActive || d.automation?.trigger === 'none') return false;
            if (appliedDiscountCodes.includes(d.code)) return false;

            if (d.limitOnePerCustomer && d.usedByClientIds?.includes(selectedClient.id)) return false;

            const isCompatible = !d.applicableServiceIds || d.applicableServiceIds.length === 0 || 
                                (d.applicableServiceIds.some(id => cartServiceIds.includes(id)));
            if (!isCompatible) return false;

            const trigger = d.automation?.trigger;

            if (trigger === 'birthday' && selectedClient.birthday) {
                return isSameMonth(new Date(), safeDate(selectedClient.birthday));
            }

            if (trigger === 'loyalty' && d.automation?.appointmentThreshold) {
                return (completedCount + 1) % d.automation.appointmentThreshold === 0;
            }

            if (trigger === 'new_client') {
                return completedCount === 0;
            }

            const lastAptDate = selectedClient.lastAppointment ? safeDate(selectedClient.lastAppointment) : null;
            const daysSince = lastAptDate ? differenceInDays(new Date(), lastAptDate) : 0;
            if (trigger === 're_engagement' && d.automation?.daysSinceLastVisit && lastAptDate) {
                return daysSince >= d.automation.daysSinceLastVisit;
            }

            return false;
        });
    }, [selectedClient, discounts, appliedDiscountCodes, allAppointments, cartServiceIds]);
    
    const quickTenderOptions = useMemo(() => {
        const options = new Set<number>();
        if (total <= 0) return [];
    
        const roundUp = (num: number, multiple: number) => Math.ceil(num / multiple) * multiple;

        const next5 = roundUp(total, 5); if (next5 > total) options.add(next5);
        const next10 = roundUp(total, 10); if (next10 > total) options.add(next10);
        const next20 = roundUp(total, 20); if (next20 > total) options.add(next20);
        const next50 = roundUp(total, 50); if (next50 > total) options.add(next50);
        const next100 = roundUp(total, 100); if (next100 > total) options.add(next100);

        return Array.from(options).sort((a,b) => a - b).slice(0, 3);
    }, [total]);

    const allInvolvedStaff = useMemo(() => {
        const staffIds = new Set<string>();
        appointmentsData.forEach(data => {
            staffIds.add(data.staff.id);
            if (data.appointment.checkoutState?.serviceStaffOverrides) {
                Object.values(data.appointment.checkoutState.serviceStaffOverrides).forEach(id => staffIds.add(id));
            }
        });
        return staff.filter(s => staffIds.has(s.id));
    }, [appointmentsData, staff]);

    useEffect(() => {
        if (allInvolvedStaff.length === 1 && tipAmount > 0) {
            setTipAllocations({ [allInvolvedStaff[0].id]: tipAmount });
        }
    }, [tipAmount, allInvolvedStaff, setTipAllocations]);

    return (
        <div className="flex flex-col h-full max-h-full">
            {showTitle && (
                <div className="flex justify-between items-center mb-2 flex-shrink-0 px-4 md:px-0">
                    <h2 className="text-xl font-bold">Current Sale</h2>
                </div>
            )}
            <div className="mb-2 md:mb-4 flex-shrink-0 px-4 md:px-0">
                <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Payer</Label>
                <div className="flex gap-2 mt-1">
                    <Select
                        value={selectedClientId || 'walk-in'}
                        onValueChange={(value) => {
                            if (value === 'walk-in') {
                                setSelectedClientId(null);
                            } else {
                                setSelectedClientId(value);
                            }
                        }}
                    >
                        <SelectTrigger className="h-10 md:h-11 border-2">
                            <SelectValue placeholder={isGroupCheckout ? "Select primary payer" : "Walk-in Customer"} />
                        </SelectTrigger>
                        <SelectContent>
                        {isGroupCheckout ? (
                            payerOptions.map((c: Client) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))
                        ) : (
                            <>
                                <SelectItem value="walk-in">Walk-in Customer</SelectItem>
                                {clients.map((c: Client) => (
                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                            </>
                        )}
                        </SelectContent>
                    </Select>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="icon" className="h-10 w-10 md:h-11 md:w-11" onClick={onAddClientClick}><UserPlus className="w-4 h-4" /></Button>
                            </TooltipTrigger>
                            <TooltipContent>Register New Client</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="icon" className="h-10 w-10 md:h-11 md:w-11" onClick={onScanClick}><QrCode className="w-4 h-4" /></Button>
                            </TooltipTrigger>
                            <TooltipContent>Scan Ticket or SKU</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                {selectedClient && (
                    <div className="mt-1.5 flex items-center justify-between">
                        <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                            Account: <span className="text-foreground">{selectedClient.name}</span>
                        </div>
                        {isBirthdayToday && (
                            <Badge className="bg-pink-500 text-white border-none animate-bounce h-5 px-1.5 text-[9px] font-black uppercase">
                                <Cake className="w-2.5 h-2.5 mr-1" /> Birthday Today
                            </Badge>
                        )}
                    </div>
                )}
            </div>

            <Separator className="mx-4 md:mx-0" />

            <ScrollArea className="flex-1 min-h-0 my-2 md:my-4 px-4 md:px-0">
                <div className="space-y-4 md:space-y-6 pb-4">
                    {selectedClient && (selectedClient.outstandingBalance || 0) > 0 && (
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                            <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20 shadow-sm border-2">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle className="text-xs font-black uppercase tracking-tight">Outstanding Balance Warning</AlertTitle>
                                <AlertDescription className="text-xs space-y-2 mt-1">
                                    <p>This client owes <strong>${selectedClient.outstandingBalance!.toFixed(2)}</strong> from past unpaid fees.</p>
                                    <Button 
                                        variant="destructive" 
                                        size="sm" 
                                        className="w-full h-8 font-bold text-[10px] uppercase"
                                        onClick={() => {
                                            selectedClient.unpaidFees?.forEach(fee => onApplyAdjustmentToggle(fee.feeId, true));
                                        }}
                                    >
                                        Add to Current Sale
                                    </Button>
                                </AlertDescription>
                            </Alert>
                        </motion.div>
                    )}

                    <Accordion type="single" collapsible defaultValue="items" className="w-full">
                        <AccordionItem value="items" className="border-none">
                            <AccordionTrigger className="p-0 hover:no-underline py-2">
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                    <ShoppingCart className="w-3 h-3" />
                                    Items in Sale ({appointmentsData.length + cart.length + appliedAdjustments.size})
                                </h3>
                            </AccordionTrigger>
                            <AccordionContent className="pt-2 pb-4">
                                <div className="space-y-4">
                                    {appointmentsData.length > 0 && (
                                        <div className="space-y-2">
                                            {appointmentsData.map(data => {
                                                const { service, client, staff: provider } = data;
                                                const itemPrice = getServicePrice(service, provider);
                                                const isRedeemed = redeemedOffer?.id === service.id;
                                                const additional = (data.appointment.checkoutState?.additionalCharge || 0);
                                                const reviewNotes = data.appointment.checkoutState?.reviewNotes;
                                                const isWaived = waivedAppointmentFees.has(data.appointment.id);

                                                const membership = client.activeMembershipId ? memberships.find(m => m.id === client.activeMembershipId) : null;
                                                const membershipPerk = membership?.includedServices?.find(ps => ps.id === service.id);
                                                
                                                const currentPerkUsage = client.subscription?.perkUsage?.[service.id] || 0;
                                                const isUsedInThisCycle = client.subscription?.nextBillingDate ? (
                                                    isAfter(safeDate(client.subscription.perkLastUsed || '1970-01-01'), subMonths(parseISO(client.subscription.nextBillingDate), 1))
                                                ) : false;

                                                const effectiveUsageCount = isUsedInThisCycle ? currentPerkUsage : 0;
                                                const hasMembershipPerk = !!membershipPerk && effectiveUsageCount < membershipPerk.quantity;
                                                const packagePerk = client.activePackages?.find(p => {
                                                    const pkg = packages.find(pk => pk.id === p.packageId);
                                                    return pkg?.serviceId === service.id && p.sessionsRemaining > 0;
                                                });

                                                const hasPerk = hasMembershipPerk || !!packagePerk;
                                                const handleRedeem = () => setRedeemedOffer(isRedeemed ? null : { type: packagePerk ? 'package' : 'membership', id: service.id });
                                                
                                                return (
                                                    <Card key={data.appointment.id} className={cn("overflow-hidden rounded-xl border-2", isRedeemed ? "bg-primary/5 border-primary shadow-sm" : "border-indigo-500/20")}>
                                                        <CardContent className="p-2 md:p-3">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="font-bold text-xs md:text-sm truncate">{service.name}</p>
                                                                    {isGroupCheckout && <p className="text-[9px] md:text-[10px] text-muted-foreground">for {client.name}</p>}
                                                                    <div className="flex flex-wrap items-center gap-2 mt-1">
                                                                        <p className={cn("text-xs md:text-sm font-black font-mono", isRedeemed ? "line-through text-muted-foreground opacity-50" : "text-primary")}>${itemPrice.toFixed(2)}</p>
                                                                        {additional > 0 && (
                                                                            <Badge variant="outline" className={cn("text-[9px] h-4 border-amber-500/30", isWaived ? "line-through opacity-50" : "text-amber-700 bg-amber-50")}>
                                                                                +{additional.toFixed(2)} Usage Fees
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8 shrink-0 text-destructive" onClick={() => onSelectAppointment(data.appointment.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                                                            </div>
                                                            
                                                            {reviewNotes && (
                                                                <div className="mt-2 p-2 rounded-lg bg-muted/50 border flex gap-2 items-start">
                                                                    <MessageSquare className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                                                                    <p className="text-[10px] leading-tight italic">"{reviewNotes}"</p>
                                                                </div>
                                                            )}

                                                            <div className="mt-2 space-y-1">
                                                                {(data.appointment.addOnIds || []).map(addonId => {
                                                                    const addon = services?.find(s => s.id === addonId);
                                                                    if (!addon) return null;
                                                                    const providerId = data.appointment.checkoutState?.serviceStaffOverrides?.[addonId] || data.appointment.staffId;
                                                                    const provider = staff.find(s => s.id === providerId);
                                                                    return (
                                                                        <div key={addonId} className="flex justify-between items-center bg-muted/30 p-1.5 rounded-lg border border-border/50 group">
                                                                            <div className="flex items-center gap-2 min-w-0">
                                                                                <p className="text-[10px] font-bold text-muted-foreground truncate">+ {addon.name}</p>
                                                                                {provider && <Badge variant="outline" className="text-[8px] h-3.5 px-1 uppercase">{provider.name.split(' ')[0]}</Badge>}
                                                                            </div>
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-[10px] font-black text-muted-foreground">${getServicePrice(addon, provider).toFixed(2)}</span>
                                                                                <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveAddOn(data.appointment.id, addonId)}>
                                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                                </Button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>

                                                            {hasPerk && !isRedeemed && (
                                                                <Button variant="secondary" size="sm" className="w-full mt-2 text-[10px] md:text-[11px] font-bold uppercase" onClick={handleRedeem}>
                                                                    {hasMembershipPerk ? <><Award className="w-3 h-3 mr-1.5" />Redeem Perk ({effectiveUsageCount}/{membershipPerk.quantity})</> : <><Repeat className="w-3 h-3 mr-1.5" />Use Package Session</>}
                                                                </Button>
                                                            )}
                                                            {isRedeemed && (
                                                                <div className="mt-2 p-1.5 rounded-lg bg-green-500/10 text-green-700 flex items-center justify-between border border-green-500/20">
                                                                    <span className="text-[10px] font-black uppercase flex items-center gap-1.5"><CheckCircle className="w-3 h-3" /> Perk Applied</span>
                                                                    <Button variant="ghost" size="xs" onClick={handleRedeem} className="h-5 px-1.5 text-[9px] font-bold uppercase underline">Undo</Button>
                                                                </div>
                                                            )}
                                                            {additional > 0 && isOwnerOrAdmin && (
                                                                <div className="mt-2 pt-2 border-t border-dashed flex justify-between items-center">
                                                                    <span className="text-[9px] font-black text-muted-foreground uppercase">Overage Recovery</span>
                                                                    {isWaived ? (
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[9px] font-bold text-green-600 uppercase">Absorbed</span>
                                                                            <Button variant="ghost" size="xs" onClick={() => onWaiveFeeToggle(data.appointment.id, false)} className="h-5 text-[9px] font-black uppercase underline">Restore</Button>
                                                                        </div>
                                                                    ) : (
                                                                        <Button variant="ghost" size="xs" onClick={() => handleWaiveClick(data.appointment.id)} className="h-5 text-[9px] font-black uppercase text-amber-600 border border-amber-200 bg-amber-50">Absorb Fee</Button>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </CardContent>
                                                    </Card>
                                                )
                                            })}
                                        </div>
                                    )}

                                    {cart.length > 0 && (
                                        <div className="space-y-2">
                                            {cart.map(item => (
                                                <div key={item.id} className="text-sm flex items-center gap-3 p-2 md:p-3 bg-muted/20 border rounded-xl">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-bold text-xs md:text-sm truncate">{item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}</p>
                                                        <p className="text-[9px] md:text-[10px] text-muted-foreground uppercase font-bold">{item.type}</p>
                                                    </div>
                                                    <p className="font-bold font-mono text-xs md:text-sm">${(item.price * item.quantity).toFixed(2)}</p>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8 text-destructive" onClick={() => handleUpdateQuantity(item.id, 0)}><Trash2 className="w-3.5 h-3.5"/></Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {appliedAdjustments.size > 0 && (
                                        <div className="space-y-2">
                                            {Array.from(appliedAdjustments).map(id => {
                                                const clientFees = clients.flatMap(c => c.unpaidFees || []);
                                                const adj = clientFees.find(f => f.feeId === id);
                                                return (
                                                    <div key={id} className="text-sm flex items-center gap-3 p-2 md:p-3 bg-destructive/5 border border-destructive/20 rounded-xl">
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-bold text-xs md:text-sm truncate">{adj?.reason || 'Past Due Fee'}</p>
                                                            <p className="text-[9px] md:text-[10px] text-destructive uppercase font-black">Settling Debt</p>
                                                        </div>
                                                        <p className="font-bold font-mono text-xs md:text-sm text-destructive">${adj?.feeAmount.toFixed(2)}</p>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8 text-destructive" onClick={() => onApplyAdjustmentToggle(id, false)}><X className="h-3.5 w-3.5"/></Button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>

                    <div className="space-y-2 md:space-y-3">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Discounts & Rewards</h3>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input 
                                    placeholder="Enter Code..." 
                                    value={promoCodeInput}
                                    onChange={(e) => setPromoCodeInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleApplyDiscount(promoCodeInput)}
                                    className="pl-8 h-9 text-xs"
                                />
                            </div>
                            <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => setIsDiscountBrowserOpen(true)}>Browse</Button>
                        </div>

                        {appliedDiscountCodes.length > 0 && (
                            <div className="space-y-2">
                                {appliedDiscountCodes.map(code => (
                                    <div key={code} className="p-2 rounded-xl bg-primary/10 border-2 border-primary/20 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle className="h-4 w-4 text-primary" />
                                            <p className="text-xs font-black uppercase">{code}</p>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => handleRemoveDiscount(code)}><X className="h-3.5 w-3.5" /></Button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <AnimatePresence>
                            {suggestedDiscounts.length > 0 && (
                                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 pt-1">
                                    <p className="text-[9px] font-black uppercase text-amber-600 tracking-widest flex items-center gap-1.5"><Wand2 className="h-3 w-3" /> Suggested Rewards</p>
                                    {suggestedDiscounts.map(d => (
                                        <Button 
                                            key={d.id} 
                                            variant="outline" 
                                            className="w-full justify-between h-auto py-2.5 px-3 border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 text-left"
                                            onClick={() => handleApplyDiscount(d.code)}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[11px] font-black uppercase text-amber-700 dark:text-amber-400">{d.code}</p>
                                                <p className="text-[10px] text-muted-foreground truncate">{d.description}</p>
                                            </div>
                                            <div className="text-right ml-2 shrink-0">
                                                <p className="text-xs font-black text-amber-700 dark:text-amber-400">{d.type === 'percentage' ? `${d.value}%` : `$${d.value}`} OFF</p>
                                            </div>
                                        </Button>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </ScrollArea>
            
            <div className="flex-shrink-0 pt-2 md:pt-4 border-t bg-card px-4 md:px-0">
                <div className="space-y-1.5 md:space-y-2.5 text-sm">
                    <div className="flex justify-between text-muted-foreground font-medium text-xs md:text-sm"><p>Subtotal</p><p className="font-mono">${subtotal.toFixed(2)}</p></div>
                    {(discount + membershipDiscount) > 0 && (
                        <div className="flex justify-between text-[11px] md:text-sm text-primary font-black uppercase tracking-tight">
                            <span className="flex items-center gap-1.5"><Percent className="w-3 h-3 md:w-3.5 md:h-3.5" /> Discounts Applied</span>
                            <span className="font-mono">-${(discount + membershipDiscount).toFixed(2)}</span>
                        </div>
                    )}
                    {appliedAdjustments.size > 0 && (
                        <div className="flex justify-between text-[11px] md:text-sm text-destructive font-black uppercase tracking-tight">
                            <span className="flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 md:w-3.5 md:h-3.5" /> Settling Debt</span>
                            <span className="font-mono">+${Array.from(appliedAdjustments).reduce((sum, id) => {
                                const clientFees = clients.flatMap(c => c.unpaidFees || []);
                                const fee = clientFees.find(f => f.feeId === id);
                                return sum + (fee?.feeAmount || 0);
                            }, 0).toFixed(2)}</span>
                        </div>
                    )}
                    <div className="flex justify-between text-muted-foreground font-medium text-xs md:text-sm"><p>Estimated Tax</p><p className="font-mono">${tax.toFixed(2)}</p></div>
                    <div className="flex justify-between text-sm items-center py-0.5 md:py-1">
                        <p className="font-black uppercase text-[10px] md:text-[11px] tracking-widest text-muted-foreground">Gratuity</p>
                        <div className="relative w-28 md:w-32">
                            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" />
                            <Input
                                type="number"
                                value={tipAmount || ''}
                                onChange={(e) => setTipAmount(parseFloat(e.target.value) || 0)}
                                className="h-9 md:h-10 text-right pr-3 pl-8 font-black text-base md:text-lg border-2"
                                placeholder="0.00"
                            />
                        </div>
                    </div>
                    {allInvolvedStaff.length > 0 && (
                        <Accordion type="single" collapsible className="w-full">
                            <AccordionItem value="tip-allocation" className="border-none">
                                <AccordionTrigger className="p-0 hover:no-underline py-1">
                                    <span className="text-[9px] font-black text-muted-foreground uppercase flex items-center gap-1.5">
                                        <Users className="w-3 h-3" />
                                        Tip Allocation ({allInvolvedStaff.length} Staff)
                                    </span>
                                </AccordionTrigger>
                                <AccordionContent className="pt-2">
                                    <div className="space-y-3 p-3 rounded-xl border bg-muted/10">
                                        {allInvolvedStaff.map(member => {
                                            const allocation = tipAllocations[member.id] || 0;
                                            return (
                                                <div key={member.id} className="flex items-center justify-between gap-3">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <Avatar className="h-6 w-6 border shadow-sm">
                                                            <AvatarImage src={member.avatarUrl} />
                                                            <AvatarFallback>{(member.name || 'S').charAt(0)}</AvatarFallback>
                                                        </Avatar>
                                                        <span className="text-[11px] font-bold truncate">{member.name}</span>
                                                    </div>
                                                    <div className="relative w-20">
                                                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 h-3 text-muted-foreground" />
                                                        <Input 
                                                            type="number" 
                                                            value={allocation || ''} 
                                                            onChange={(e) => {}}
                                                            readOnly
                                                            className="h-7 text-right text-[11px] pl-5 font-bold"
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    )}
                    <Separator className="my-1.5 md:my-3" />
                    <div className="flex justify-between items-baseline font-black text-2xl md:text-3xl text-primary tracking-tighter"><p className="text-[10px] md:text-sm uppercase tracking-widest text-muted-foreground">Total</p><p className="font-mono">${total.toFixed(2)}</p></div>
                </div>
                
                <div className="mt-3 md:mt-6 space-y-3 md:space-y-4 pb-8 md:pb-10">
                    <RadioGroup value={paymentTab} onValueChange={setPaymentTab} className="grid grid-cols-3 gap-2">
                        <div><RadioGroupItem value="cash" id="pay-cash" className="peer sr-only" /><Label htmlFor="pay-cash" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-2 md:p-3 text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all cursor-pointer h-14 md:h-16"><Banknote className="mb-1 h-4 w-4 md:h-5 md:w-5" />Cash</Label></div>
                        <div><RadioGroupItem value="card" id="pay-card" className="peer sr-only" /><Label htmlFor="pay-card" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-2 md:p-3 text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all cursor-pointer h-14 md:h-16"><CreditCard className="mb-1 h-4 w-4 md:h-5 md:w-5" />Card</Label></div>
                        <div><RadioGroupItem value="scan" id="pay-scan" className="peer sr-only" /><Label htmlFor="pay-scan" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-2 md:p-3 text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all cursor-pointer h-14 md:h-16"><Scan className="mb-1 h-4 w-4 md:h-5 md:w-5" />Scan</Label></div>
                    </RadioGroup>

                    {paymentTab === 'cash' && (
                        <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 md:space-y-4 pt-1">
                            <div className="grid grid-cols-2 gap-3 md:gap-4">
                                <div className="space-y-1"><Label className="text-[9px] md:text-[10px] uppercase font-black tracking-widest text-muted-foreground">Amount Tendered</Label><div className="relative"><DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" /><Input type="number" value={amountTendered || ''} onChange={(e) => setAmountTendered(parseFloat(e.target.value) || 0)} className="pl-7 md:pl-8 h-10 md:h-12 font-black text-lg md:text-xl border-2" /></div></div>
                                {amountTendered > total && (<div className="space-y-1"><Label className="text-[9px] md:text-[10px] uppercase font-black tracking-widest text-green-600">Change Due</Label><div className="h-10 md:h-12 flex items-center justify-center bg-green-500/10 border-2 border-green-500/20 rounded-xl"><p className="font-black text-lg md:text-xl text-green-600 font-mono">${(amountTendered - total).toFixed(2)}</p></div></div>)}
                            </div>
                            <div className="flex gap-1.5 md:gap-2 overflow-x-auto pb-1 no-scrollbar">
                                {quickTenderOptions.map(val => (<Button key={val} variant="outline" size="sm" className="flex-1 font-bold h-8 md:h-9 rounded-xl text-xs md:text-sm shrink-0" onClick={() => setAmountTendered(val)}>${val}</Button>))}
                                <Button variant="outline" size="sm" className="flex-1 font-black h-8 md:h-9 rounded-xl border-primary text-primary text-xs md:text-sm shrink-0" onClick={() => setAmountTendered(total)}>Exact</Button>
                            </div>
                        </motion.div>
                    )}

                    <div className="pt-2">
                        <Button className="w-full h-14 md:h-16 text-xl md:text-2xl font-black rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95" onClick={() => onCheckout({paymentMethod: paymentTab, amountTendered})} disabled={isSubmitting || (paymentTab === 'cash' && amountTendered < total)}>
                            {isSubmitting ? <Loader className="animate-spin" /> : `Collect $${total.toFixed(2)}`}
                        </Button>
                    </div>
                </div>
            </div>
            <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts || []} onSelect={handleApplyDiscount} cartServiceIds={cartServiceIds} />
            
            <WaiveFeeDialog 
                open={isWaiveAuthOpen} 
                onOpenChange={setIsWaiveAuthOpen} 
                feeAmount={appointmentsData.find(a => a.appointment.id === pendingWaiveAptId)?.appointment.checkoutState?.additionalCharge || 0} 
                staff={staff}
                onConfirm={handleConfirmWaive}
            />
        </div>
    );
};