'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { 
    Banknote, 
    CreditCard, 
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
    Repeat,
    Wallet,
    UserPlus,
    Cake,
    ChevronDown,
    Zap,
    Search,
    User,
    Plus,
    Minus,
    TicketIcon,
    XCircle,
    Fingerprint,
    Scan as ScanIcon,
    ArrowRight,
    Star,
    Check,
    Lock,
    Sparkles,
    Info,
    PartyPopper,
    Box,
    CheckCircle2,
    VolumeX,
    Ear,
    SunDim,
    Coffee
} from 'lucide-react';
import { type Client, type Service, type Staff, type Membership, type Package, getServicePrice } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Label } from '../ui/label';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label as RadioLabel } from '@/components/ui/label';
import { BrowseDiscountsDialog } from '../discounts/BrowseDiscountsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn, hexToHSLComponents, safeNumber } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { subMonths, parseISO, isAfter, isSameMonth, differenceInDays, subYears } from 'date-fns';
import { 
    Dialog, 
    DialogContent, 
    DialogDescription, 
    DialogFooter, 
    DialogHeader, 
    DialogTitle,
    DialogTrigger
} from '@/components/ui/dialog';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { useTenant } from '@/context/TenantContext';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
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
                        <Label htmlFor="waive-reason-hub" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Waiver Reason</Label>
                        <Textarea id="waive-reason-hub" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g., Client verified emergency..." className="rounded-2xl border-2 bg-muted/5 focus-visible:ring-primary/20 font-medium" />
                    </div>
                </div>
                <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
                    <Button onClick={handleConfirm} disabled={pin.length < 4 || !reason.trim()} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/20">Confirm Waiver</Button>
                    <Button variant="ghost" onOpenChange={() => onOpenChange(false)} className="w-full font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
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
    activeTill,
    staff,
    role
}: any) => {
    
    const [promoCodeInput, setPromoCodeInput] = useState('');
    const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);
    const [isPayerDialogOpen, setIsPayerDialogOpen] = useState(false);
    const { services, inventory } = useInventory();
    const { toast } = useToast();

    const [isWaiveAuthOpen, setIsPointOfSaleWaiveAuthOpen] = useState(false);
    const [pendingWaiveAptId, setPendingWaiveAptId] = useState<string | null>(null);
    const [clientSearch, setClientSearch] = useState('');

    const isOwnerOrAdmin = role === 'owner' || role === 'admin';

    const handleWaiveClick = (aptId: string) => {
        setPendingWaiveAptId(aptId);
        setIsPointOfSaleWaiveAuthOpen(true);
    };

    const handleConfirmWaive = (authorizer: Staff, reason: string) => {
        if (pendingWaiveAptId) {
            onWaiveFeeToggle(pendingWaiveAptId, true, authorizer.id, reason);
            setIsPointOfSaleWaiveAuthOpen(false);
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
        const appointmentServiceIds = (appointmentsData || []).map((a: any) => a.appointment.serviceId);
        const cartServices = (cart || []).filter((item: any) => item.type === 'service').map((item: any) => item.id);
        const appointmentAddOnIds = (appointmentsData || []).flatMap((a: any) => a.appointment.addOnIds || []);
        return [...new Set([...appointmentServiceIds, ...cartServices, ...appointmentAddOnIds])];
    }, [cart, appointmentsData]);

    const allInvolvedStaff = useMemo(() => {
        const staffIds = new Set<string>();
        (appointmentsData || []).forEach((data: any) => {
            if (data.appointment.staffId) staffIds.add(data.appointment.staffId);
            if (data.appointment.checkoutState?.serviceStaffOverrides) {
                Object.values(data.appointment.checkoutState.serviceStaffOverrides).forEach((id: any) => {
                    if (id && typeof id === 'string') staffIds.add(id);
                });
            }
        });
        return staff.filter((s: Staff) => staffIds.has(s.id));
    }, [appointmentsData, staff]);

    const handleTotalTipChange = useCallback((value: number) => {
        const roundedValue = Number(safeNumber(value).toFixed(2));
        setTipAmount(roundedValue);
        
        if (allInvolvedStaff.length > 0) {
            const splitAmount = Number((roundedValue / allInvolvedStaff.length).toFixed(2));
            const newAllocations: Record<string, number> = {};
            let currentTotal = 0;
            
            allInvolvedStaff.forEach((member: Staff, index: number) => {
                if (index === allInvolvedStaff.length - 1) {
                    newAllocations[member.id] = Number((roundedValue - currentTotal).toFixed(2));
                } else {
                    newAllocations[member.id] = splitAmount;
                    currentTotal += splitAmount;
                }
            });
            setTipAllocations(newAllocations);
        }
    }, [allInvolvedStaff, setTipAmount, setTipAllocations]);

    useEffect(() => {
        if (tipAmount > 0) {
            handleTotalTipChange(tipAmount);
        }
    }, [allInvolvedStaff.length, handleTotalTipChange, tipAmount]);

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
        if (!client.subscription || client.subscription.status !== 'active') return true;
        
        const usageCount = safeNumber(client.subscription?.perkUsage?.[perkId]);
        const perkDef = membership.includedServices?.find(s => s.id === perkId) || membership.includedAddOns?.find(a => a.id === perkId);
        const limit = safeNumber(perkDef?.quantity || 1);
        
        if (usageCount >= limit) return true;

        if (!client.subscription?.nextBillingDate) return false;

        const lastUsedStr = client.subscription.perkLastUsed;
        if (!lastUsedStr) return false;
        
        const lastUsed = safeDate(lastUsedStr);
        const nextBilling = safeDate(client.subscription.nextBillingDate);
        const cycleStart = membership.interval === 'yearly' ? subYears(nextBilling, 1) : subMonths(nextBilling, 1);
        
        if (!isAfter(lastUsed, cycleStart)) return false;

        return usageCount >= limit;
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
                            usage: `${safeNumber(selectedClient.subscription?.perkUsage?.[perk.id])}/${perk.quantity}`
                        });
                    }
                });
                membership.includedAddOns?.forEach(perk => {
                    if (cartServiceIds.includes(perk.id)) {
                        const exhausted = isPerkExhausted(selectedClient, perk.id, membership);
                        items.push({
                            type: 'membership', id: membership.id, itemId: perk.id, label: perk.name, subLabel: 'Membership Perk (Add-on)', exhausted, 
                            usage: `${safeNumber(selectedClient.subscription?.perkUsage?.[perk.id])}/${perk.quantity}`
                        });
                    }
                });
            }
        }

        selectedClient.activePackages?.forEach(p => {
            const pkgDef = packages?.find(pkg => pkg.id === p.packageId);
            if (pkgDef && cartServiceIds.includes(pkgDef.serviceId)) {
                items.push({
                    type: 'package', id: pkgDef.id, itemId: pkgDef.serviceId, label: pkgDef.name, subLabel: 'Prepaid Bundle', exhausted: p.sessionsRemaining <= 0,
                    usage: `${p.sessionsRemaining} left`
                });
            }
        });

        return items;
    }, [selectedClient, memberships, packages, cartServiceIds]);

    const handleRedeem = (entitlement: any) => {
        if (entitlement.exhausted) return toast({ variant: 'destructive', title: 'Perk Exhausted', description: 'Usage limit reached for this cycle.' });
        setRedeemedOffer({ type: entitlement.type, id: entitlement.id, itemId: entitlement.itemId });
        toast({ title: 'Entitlement Applied', description: `${entitlement.label} redeemed.` });
    };

    const isCartEmpty = appointmentsData.length === 0 && cart.length === 0 && appliedAdjustments.size === 0;
    
    // Financial logic synchronization
    const finalSubtotal = subtotal;
    const totalDiscount = safeNumber(discount) + safeNumber(membershipDiscount);
    const finalTotal = total;

    return (
        <div className="flex flex-col space-y-6 md:space-y-10">
            <div className="flex-shrink-0 text-left">
                {isGroupCheckout && !selectedClientId && !isCartEmpty && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
                        <Alert variant="destructive" className="border-2 border-primary/20 bg-primary/5 rounded-2xl p-4 shadow-xl shadow-primary/5 text-left">
                            <Users className="h-5 w-5 text-primary" />
                            <AlertTitle className="text-[10px] font-black uppercase text-primary tracking-widest text-left">Group Protocol Required</AlertTitle>
                            <AlertDescription className="text-[10px] font-bold uppercase text-slate-600 opacity-80 leading-tight mt-1 text-left">
                                Multiple guests detected. Please identify the primary account for settlement.
                            </AlertDescription>
                        </Alert>
                    </motion.div>
                )}

                <div className="flex gap-2 mt-2">
                    <Dialog open={isPayerDialogOpen} onOpenChange={setIsPayerDialogOpen}>
                        <DialogTrigger asChild>
                            <Button 
                                variant="outline" 
                                className={cn(
                                    "h-12 md:h-14 rounded-2xl border-2 font-black uppercase tracking-tight shadow-inner bg-muted/5 flex-1 justify-between px-4",
                                    isGroupCheckout && !selectedClientId && !isCartEmpty && "border-primary animate-pulse bg-primary/5 ring-4 ring-primary/10"
                                )}
                                onClick={() => setIsPayerDialogOpen(true)}
                            >
                                {selectedClient ? (
                                    <div className="flex items-center gap-3 text-left">
                                        <div className="relative shrink-0">
                                            <Avatar className="h-7 v-7 md:h-8 md:w-8 border-2 shadow-sm rounded-xl">
                                                <AvatarImage src={selectedClient.avatarUrl} className="object-cover" />
                                                <AvatarFallback className="font-black text-[10px] md:text-xs bg-primary/10 text-primary">{(selectedClient.name || 'C')?.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            {isMember && (
                                                <div className="absolute -top-1 -right-1 bg-indigo-600 text-white p-0.5 rounded shadow-sm border border-background">
                                                    <Award className="w-2 x-2" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 min-w-0 text-left">
                                            <span className="truncate text-xs md:sm">{selectedClient.name}</span>
                                            {isBirthdayToday && <Cake className="h-3.5 w-3.5 text-pink-500 animate-pulse shrink-0" />}
                                            {isMember && <Badge className="bg-indigo-600 text-white border-none text-[7px] h-4 px-1 font-black uppercase hidden sm:flex">MEM</Badge>}
                                            {hasPackage && <Badge className="bg-teal-600 text-white border-none text-[7px] h-4 px-1 font-black uppercase hidden sm:flex">PKG</Badge>}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        {isGroupCheckout ? <Users className="w-4 h-4 text-primary" /> : <User className="w-4 h-4" />}
                                        <span className={cn("text-xs md:text-sm", isGroupCheckout ? "text-primary" : "opacity-40")}>
                                            {isGroupCheckout ? "Select Primary Payee..." : "Search Payer..."}
                                        </span>
                                    </div>
                                )}
                                <ChevronDown className="h-4 w-4 opacity-40 ml-2 shrink-0" />
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md rounded-[3rem] p-0 border-4 overflow-hidden shadow-3xl bg-background">
                            <DialogHeader className="p-6 pb-4 border-b bg-muted/5 text-left">
                                <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">
                                    {isGroupCheckout ? 'Identify Group Payer' : 'Guest Search'}
                                </DialogTitle>
                                <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
                                    {isGroupCheckout ? 'The only available options are the guests being serviced in this group.' : 'Attribute this sale to a guest dossier.'}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="p-6 space-y-6">
                                {!isGroupCheckout && (
                                    <div className="relative">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                                        <Input 
                                            placeholder="SEARCH BY NAME, EMAIL, OR PHONE..." 
                                            value={clientSearch} 
                                            onChange={e => setClientSearch(e.target.value)} 
                                            className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-sm tracking-tight focus-visible:ring-primary/20"
                                            autoFocus
                                        />
                                    </div>
                                )}
                                <ScrollArea className={cn("-mx-2 px-2", isGroupCheckout ? "h-auto" : "h-[300px] md:h-[350px]")}>
                                    <div className="space-y-2 pb-4 text-left">
                                        {!isGroupCheckout && (
                                            <button 
                                                className="w-full text-left p-4 hover:bg-muted/50 transition-all flex items-center gap-4 border-2 rounded-2xl border-transparent hover:border-border"
                                                onClick={() => { setSelectedClientId(null); setIsPayerDialogOpen(false); }}
                                            >
                                                <div className="p-3 bg-muted rounded-xl shadow-inner"><User className="w-5 h-5 text-muted-foreground" /></div>
                                                <span className="font-black uppercase tracking-widest text-[11px] text-slate-600 text-left">WALK-IN GUEST (ANONYMOUS)</span>
                                            </button>
                                        )}
                                        {filteredPayerOptions.map((c: Client) => {
                                            const cMember = !!(c.activeMembershipId || c.subscription);
                                            const cPkg = (c.activePackages?.length || 0) > 0;
                                            return (
                                                <button 
                                                    key={c.id} 
                                                    className={cn(
                                                        "w-full text-left p-4 transition-all flex items-center gap-4 border-2 rounded-2xl",
                                                        selectedClientId === c.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-primary/5 hover:border-primary/10"
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
                                                    <div className="min-w-0 flex-1 text-left">
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-black uppercase tracking-tight text-xs text-slate-900 truncate">{c.name}</p>
                                                            {cPkg && <Badge className="bg-teal-600 text-white border-none text-[7px] h-3.5 px-1 font-black uppercase">PKG</Badge>}
                                                        </div>
                                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 truncate text-left">{c.email || c.phone || 'No contact on file'}</p>
                                                    </div>
                                                    {selectedClientId === c.id && <CheckCircle className="ml-auto w-5 h-5 text-primary" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </ScrollArea>
                            </div>
                            {!isGroupCheckout && (
                                <DialogFooter className="p-6 pt-0 bg-muted/5 border-t text-left">
                                    <Button variant="outline" className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2 bg-white" onClick={() => { setIsPayerDialogOpen(false); onAddClientClick(); }}>
                                        <UserPlus className="w-4 h-4 mr-2" />
                                        Register New Client Profile
                                    </Button>
                                </DialogFooter>
                            )}
                        </DialogContent>
                    </Dialog>
                    <Button variant="outline" size="icon" className="h-12 w-12 md:h-14 md:w-14 rounded-2xl border-2 shadow-sm shrink-0 bg-white/50 backdrop-blur-sm" onClick={onScanClick}><QrCode className="w-6 h-6 opacity-40" /></Button>
                </div>
            </div>

            {selectedClient && isBirthdayToday && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-4 text-left">
                    <Alert className="bg-pink-500/5 border-pink-500/20 border-2 rounded-2xl p-4 shadow-lg shadow-pink-500/5 text-left">
                        <Cake className="h-5 w-5 text-pink-500" />
                        <AlertTitle className="text-[10px] font-black uppercase text-pink-600 tracking-widest text-left">Birthday Protocol Active</AlertTitle>
                        <AlertDescription className="text-[10px] font-bold uppercase text-slate-600 opacity-80 leading-tight mt-1 text-left">
                            It's {selectedClient.name.split(' ')[0]}'s special day. Consider a complimentary enhancement or birthday gift.
                        </AlertDescription>
                    </Alert>
                </motion.div>
            )}

            {selectedClient && availableEntitlements.length > 0 && (
                <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2 ml-1 text-left">
                        <Award className="w-3 h-3" />
                        Available Benefits
                    </p>
                    <div className="grid gap-2">
                        {availableEntitlements.map((ent: any, idx: number) => (
                            <Button 
                                key={idx} 
                                variant="outline" 
                                disabled={ent.exhausted || redeemedOffer?.itemId === ent.itemId}
                                onClick={() => handleRedeem(ent)}
                                className={cn(
                                    "h-auto py-3 px-4 rounded-2xl border-2 flex justify-between items-center transition-all",
                                    redeemedOffer?.itemId === ent.itemId ? "bg-green-500/5 border-green-500/20 text-green-700" : 
                                    ent.exhausted ? "opacity-50 bg-muted/30 grayscale border-dashed cursor-not-allowed" : "bg-white border-indigo-500/10 hover:border-primary/30 shadow-sm"
                                )}
                            >
                                <div className="text-left min-w-0 flex-1">
                                    <p className="text-[11px] font-black uppercase tracking-tight truncate">{ent.label}</p>
                                    <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{ent.subLabel}</p>
                                </div>
                                <div className="text-right ml-4 shrink-0">
                                    {redeemedOffer?.itemId === ent.itemId ? (
                                        <Badge className="bg-green-500 text-white border-none h-5 px-2 font-black text-[8px] uppercase">Applied</Badge>
                                    ) : ent.exhausted ? (
                                        <div className="flex flex-col items-end gap-1">
                                            <Badge variant="destructive" className="h-5 px-2 font-black text-[8px] uppercase border-none animate-pulse">Exhausted</Badge>
                                            <span className="text-[7px] font-black uppercase opacity-40">{ent.usage}</span>
                                        </div>
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
                <div className="flex items-center gap-2 px-1 text-left">
                    <ShoppingCart className="w-4 h-4 text-primary" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Itemized Manifest</h3>
                </div>
                
                {isCartEmpty ? (
                    <div className="py-12 md:py-16 text-center border-4 border-dashed rounded-[3rem] md:rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                        <ShoppingCart className="w-10 h-10 md:w-12 md:h-12" />
                        <div className="space-y-1 text-center">
                            <p className="text-sm font-black uppercase tracking-widest">Cart Idle</p>
                            <p className="text-[10px] font-bold uppercase tracking-tight px-4 text-center leading-relaxed">Scan a ticket or select retail items from the catalog.</p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {appointmentsData.map((data: any) => {
                            const isRedeemed = redeemedOffer?.itemId === data.service.id;
                            const addOns = (data.appointment.addOnIds || []).map((id: any) => services.find((s: any) => s.id === id)).filter(Boolean);
                            const refreshmentsInSession = data.appointment.checkoutState?.refreshments || [];
                            
                            const overrides = data.appointment.checkoutState?.serviceStaffOverrides || {};
                            const mainStaffId = overrides[data.service.id] || data.appointment.staffId;
                            const mainStaffMember = staff.find((s: any) => s.id === mainStaffId);

                            return (
                                <Card key={data.appointment.id} className={cn("overflow-hidden rounded-[1.5rem] md:rounded-[2rem] border-2 shadow-sm transition-all text-left", isRedeemed ? "border-primary bg-primary/5 shadow-lg" : "border-border/50 bg-muted/5")}>
                                    <CardContent className="p-4 md:p-5 space-y-3 md:space-y-4 text-left">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="flex-1 min-w-0 text-left w-full">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <p className="font-black text-xs md:text-sm uppercase tracking-tight text-slate-900 truncate">{data.service.name}</p>
                                                    {isRedeemed && <Badge className="bg-primary text-white border-none text-[7px] h-4 px-1.5 font-black uppercase tracking-widest">Entitlement</Badge>}
                                                </div>
                                                <div className="flex items-center gap-2 text-left">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">{mainStaffMember?.name?.split(' ')[0] || 'Tech'} &middot; {data.service.duration}m</p>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className={cn("font-black font-mono text-base md:text-lg tracking-tighter", isRedeemed ? "line-through text-muted-foreground opacity-40" : "text-slate-900")}>${safeNumber(getServicePrice(data.service, data.staff)).toFixed(2)}</p>
                                                <Button variant="ghost" size="icon" className="h-7 h-7 text-destructive -mr-2" onClick={() => onSelectAppointment(data.appointment.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                                            </div>
                                        </div>
                                        
                                        {addOns.length > 0 && (
                                            <div className="space-y-2 pl-4 border-l-2 border-primary/10 text-left">
                                                {addOns.map((addon: any) => {
                                                    const addonStaffId = overrides[addon.id] || data.appointment.staffId;
                                                    const addonStaff = staff.find((s: any) => s.id === addonStaffId);
                                                    const isAddonRedeemed = redeemedOffer?.itemId === addon.id;
                                                    
                                                    return (
                                                        <div key={addon.id} className="space-y-0.5 group text-left">
                                                            <div className="flex justify-between items-center text-left">
                                                                <div className="flex items-center gap-2 text-left">
                                                                    <span className={cn("text-[10px] font-bold uppercase tracking-tight", isAddonRedeemed ? "text-primary" : "text-muted-foreground")}>+ {addon.name}</span>
                                                                    {isAddonRedeemed && <Badge className="bg-primary text-white border-none text-[6px] h-3 font-black uppercase">REDEEMED</Badge>}
                                                                </div>
                                                                <span className={cn("text-[10px] font-black font-mono", isAddonRedeemed ? "line-through text-muted-foreground opacity-40" : "text-muted-foreground")}>${safeNumber(getServicePrice(addon, data.staff)).toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 opacity-60 text-left">
                                                                <span className="text-[8px] font-black uppercase text-primary tracking-widest">{addonStaff?.name?.split(' ')[0] || 'Tech'}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {refreshmentsInSession.length > 0 && (
                                            <div className="space-y-2 pt-2 border-t border-dashed text-left">
                                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Concierge Amenities</p>
                                                {refreshmentsInSession.map((item: any, idx: number) => (
                                                    <div key={idx} className="flex justify-between items-center text-left">
                                                        <span className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-2"><Coffee className="w-3 h-3" /> {item.name}</span>
                                                        <span className="font-mono text-[10px] text-slate-900">{safeNumber(item.price) > 0 ? `$${safeNumber(item.price).toFixed(2)}` : 'Complimentary'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {safeNumber(data.appointment.checkoutState?.additionalCharge) > 0 && (
                                            <div className="pt-3 border-t border-dashed flex justify-between items-center text-left">
                                                <span className="text-[10px] font-black uppercase text-muted-foreground">Audit Overage</span>
                                                <div className="flex items-center gap-3 text-left">
                                                    <span className={cn("font-black font-mono text-xs", waivedAppointmentFees.has(data.appointment.id) ? "line-through text-muted-foreground opacity-40" : "text-amber-600")}>+${safeNumber(data.appointment.checkoutState.additionalCharge).toFixed(2)}</span>
                                                    {isOwnerOrAdmin && (waivedAppointmentFees.has(data.appointment.id) ? <Button variant="ghost" size="xs" className="h-5 px-1.5 text-[8px] font-black uppercase text-primary underline" onClick={() => onWaiveFeeToggle(data.appointment.id, false)}>Restore</Button> : <Button variant="ghost" size="xs" className="h-5 px-1.5 text-[8px] font-black uppercase text-amber-600 border border-amber-200 bg-amber-50" onClick={() => handleWaiveClick(data.appointment.id)}>Absorb</Button>)}
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}

                        {cart.map((item: any) => (
                            <div key={item.id} className="p-3 md:p-4 rounded-2xl md:rounded-3xl bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all flex items-center gap-3 md:gap-4 group text-left shadow-sm">
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
                                    <p className="font-black font-mono text-sm tracking-tighter w-14 md:w-16 text-right text-slate-900">${(safeNumber(item.price) * item.quantity).toFixed(2)}</p>
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={() => handleUpdateQuantity(item.id, 0)}><Trash2 className="w-4 h-4"/></Button>
                            </div>
                        ))}

                        {Array.from(appliedAdjustments).map(id => {
                            const fee = clients.flatMap((c: any) => c.unpaidFees || []).find((f: any) => f.feeId === id);
                            return (
                                <div key={id} className="p-3 md:p-4 rounded-2xl md:rounded-[2rem] border-2 border-destructive/20 bg-destructive/5 flex items-center gap-3 md:gap-4 animate-in fade-in slide-in-from-left-2 text-left shadow-sm">
                                    <div className="p-2 bg-destructive/10 rounded-xl shadow-inner"><Wallet className="w-4 h-4 md:w-5 md:h-5 text-destructive" /></div>
                                    <div className="flex-1 min-w-0 text-left">
                                        <p className="font-black text-[11px] md:text-xs uppercase tracking-tight text-destructive truncate">{fee?.reason}</p>
                                        <p className="text-[9px] font-black text-destructive/60 uppercase tracking-widest">Protocol Debt</p>
                                    </div>
                                    <p className="font-black font-mono text-sm tracking-tighter text-destructive">+${safeNumber(fee?.feeAmount).toFixed(2)}</p>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => onApplyAdjustmentToggle(id as string, false)}><XCircle className="h-4 w-4"/></Button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="space-y-4 text-left">
                <div className="flex justify-between items-center text-muted-foreground font-bold uppercase text-[9px] tracking-widest opacity-60 text-left">
                    <p>Gross Manifest Value</p>
                    <p className="font-mono text-[11px] md:text-xs">${safeNumber(finalSubtotal).toFixed(2)}</p>
                </div>
                {finalTotal > 0 && (
                    <div className="flex justify-between items-center text-muted-foreground font-bold uppercase text-[9px] tracking-widest opacity-60 text-left">
                        <p>Studio Tax (7%)</p>
                        <p className="font-mono text-[11px] md:text-xs">${(finalSubtotal * 0.07).toFixed(2)}</p>
                    </div>
                )}
                
                {totalDiscount > 0 && (
                    <div className="flex justify-between items-center text-[10px] text-primary font-black uppercase tracking-tighter text-left">
                        <span className="flex items-center gap-2"><Percent className="w-3.5 h-3.5" /> Promotion Delta</span>
                        <span className="font-mono text-[11px] md:text-xs">-${safeNumber(totalDiscount).toFixed(2)}</span>
                    </div>
                )}
                
                <div className="flex justify-between items-center py-1 md:py-2 text-left">
                    <p className="font-black uppercase font-bold text-[10px] tracking-[0.2em] text-muted-foreground">Gratuity</p>
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

                <div className="flex justify-between items-baseline font-black text-xl md:text-4xl text-primary tracking-tighter px-1 pt-4 border-t border-border/50 text-left">
                    <div className="space-y-0.5 text-left">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground opacity-60">Final Settlement</p>
                        <p className="text-[8px] md:text-[9px] font-bold uppercase text-primary/40">COLLECT UPON AUTHORIZE</p>
                    </div>
                    <p className="font-mono text-2xl md:text-4xl">${safeNumber(finalTotal).toFixed(2)}</p>
                </div>

                <div className="pt-2 text-left">
                    <Button 
                        className="w-full h-14 md:h-16 text-base md:text-xl font-black rounded-2xl md:rounded-3xl shadow-2xl shadow-primary/30 transition-all hover:scale-105 active:scale-95 uppercase tracking-tight" 
                        onClick={() => onCheckout({paymentMethod: paymentTab, amountTendered})} 
                        disabled={isSubmitting || (paymentTab === 'cash' && amountTendered < finalTotal) || isCartEmpty || (isGroupCheckout && !selectedClientId)}
                    >
                        {isSubmitting ? <Loader className="animate-spin h-6 w-6 md:h-7 md:w-7" /> : (finalTotal <= 0 ? 'FINALIZE FREE SESSION' : `AUTHORIZE $${safeNumber(finalTotal).toFixed(2)}`)}
                    </Button>
                </div>
            </div>
            <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts || []} onSelect={handleApplyDiscount} cartServiceIds={cartServiceIds} />
            <WaiveFeeDialog open={isWaiveAuthOpen} onOpenChange={setIsPointOfSaleWaiveAuthOpen} staff={staff} onConfirm={handleConfirmWaive} />
        </div>
    );
};
