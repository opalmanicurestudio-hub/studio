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
    Cake,
    ChevronDown,
    Zap,
    Search
} from 'lucide-react';
import { type Appointment, type Service, type Client, type Discount, type Staff, type Membership, type Package, getServicePrice } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '../ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label as RadioLabel } from '@/components/ui/label';
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
            <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle className="flex items-center gap-3 text-2xl font-black uppercase tracking-tighter">
                        <ShieldCheck className="w-6 h-6 text-primary" />
                        Admin Override
                    </DialogTitle>
                    <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Authorize the waiver of ${feeAmount.toFixed(2)} with a manager PIN.</DialogDescription>
                </DialogHeader>
                <div className="space-y-10 py-10 flex flex-col items-center">
                    <div className="space-y-3 w-48">
                        <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground text-center block">Manager PIN</Label>
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
                    <div className="space-y-2 w-full px-6">
                        <Label htmlFor="waive-reason-pos" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Waiver Reason</Label>
                        <Textarea id="waive-reason-pos" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g., Client verified emergency..." className="rounded-2xl border-2 bg-muted/5 focus-visible:ring-primary/20" />
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
}: any) => {
    
    const [promoCodeInput, setPromoCodeInput] = useState('');
    const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);
    const { appointments: allAppointments, staff, services } = useInventory();
    const { role, selectedTenant } = useTenant();
    const { toast } = useToast();
    const { firestore } = useFirebase();

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
    
    const filteredClients = useMemo(() => {
        if (!clientSearch.trim()) return payerOptions;
        const search = clientSearch.toLowerCase();
        return payerOptions.filter((c: Client) => 
            c.name.toLowerCase().includes(search) || 
            c.email?.toLowerCase().includes(search) || 
            c.phone?.includes(search)
        );
    }, [payerOptions, clientSearch]);

    const isBirthdayToday = useMemo(() => {
        if (!selectedClient?.birthday) return false;
        const birth = safeDate(selectedClient.birthday);
        return isSameMonth(new Date(), birth) && birth.getDate() === new Date().getDate();
    }, [selectedClient]);

    const handleUpdateQuantity = (itemId: string, newQuantity: number) => {
        if (newQuantity <= 0) onCartChange(cart.filter((item: any) => item.id !== itemId));
        else onCartChange(cart.map((item: any) => item.id === itemId ? { ...item, quantity: newQuantity } : item));
    };

    const cartServiceIds = useMemo(() => {
        const appointmentServiceIds = appointmentsData.map((a: any) => a.appointment.serviceId);
        const cartServices = cart.filter(item => item.type === 'service').map(item => item.id);
        const appointmentAddOnIds = appointmentsData.flatMap((a: any) => a.appointment.addOnIds || []);
        return [...new Set([...appointmentServiceIds, ...cartServices, ...appointmentAddOnIds])];
    }, [cart, appointmentsData]);

    const handleApplyDiscount = (code: string) => {
        const codeUpper = code.trim().toUpperCase();
        if (!codeUpper) return;
        const d = discounts.find(d => d.code.toUpperCase() === codeUpper);
        if (d && d.isActive) {
            const isCompatible = !d.applicableServiceIds || d.applicableServiceIds.length === 0 || (d.applicableServiceIds.some(id => cartServiceIds.includes(id)));
            if (!isCompatible) return toast({ variant: 'destructive', title: 'Incompatible' });
            if (appliedDiscountCodes.includes(d.code)) return;
            if (!allowStacking) setAppliedDiscountCodes([d.code]);
            else setAppliedDiscountCodes([...appliedDiscountCodes, d.code]);
            setPromoCodeInput('');
        } else toast({ variant: 'destructive', title: 'Invalid Code' });
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

    const allInvolvedStaff = useMemo(() => {
        const staffIds = new Set<string>();
        appointmentsData.forEach((data: any) => {
            staffIds.add(data.staff.id);
            if (data.appointment.checkoutState?.serviceStaffOverrides) Object.values(data.appointment.checkoutState.serviceStaffOverrides).forEach((id: any) => staffIds.add(id));
        });
        return staff.filter(s => staffIds.has(s.id));
    }, [appointmentsData, staff]);

    const handleRemoveDiscount = (code: string) => {
        setAppliedDiscountCodes(appliedDiscountCodes.filter((c: string) => c !== code));
    };

    return (
        <div className="flex flex-col h-full">
            <div className="mb-8 flex-shrink-0">
                <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-[0.2em] ml-1">Payer Account</Label>
                <div className="flex gap-3 mt-2">
                    <Select value={selectedClientId || 'walk-in'} onValueChange={(v) => setSelectedClientId(v === 'walk-in' ? null : v)}>
                        <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase tracking-tight shadow-inner bg-muted/5">
                            <SelectValue placeholder={isGroupCheckout ? "Group Payer" : "Search Payer..."} />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl border-2 shadow-2xl p-0 overflow-hidden">
                            <div className="p-3 border-b bg-muted/10">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                                    <Input 
                                        placeholder="Find client..." 
                                        value={clientSearch} 
                                        onChange={e => setClientSearch(e.target.value)} 
                                        className="pl-9 h-10 rounded-xl border-2 font-bold focus-visible:ring-primary/20"
                                        onKeyDown={e => e.stopPropagation()}
                                    />
                                </div>
                            </div>
                            <ScrollArea className="h-64">
                                <SelectItem value="walk-in" className="font-bold py-3">WALK-IN GUEST</SelectItem>
                                {filteredClients.map((c: Client) => (
                                    <SelectItem key={c.id} value={c.id} className="font-bold py-3">
                                        <div className="flex items-center gap-2">
                                            <Avatar className="h-6 w-6 rounded-lg"><AvatarImage src={c.avatarUrl} /><AvatarFallback>{c.name.charAt(0)}</AvatarFallback></Avatar>
                                            <span className="uppercase">{c.name}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                                {filteredClients.length === 0 && <div className="p-10 text-center text-xs text-muted-foreground font-bold uppercase tracking-widest opacity-40">No matches found</div>}
                            </ScrollArea>
                        </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                        <Button variant="outline" size="icon" className="h-14 w-14 rounded-2xl border-2 shadow-sm" onClick={onAddClientClick}><UserPlus className="w-6 h-6" /></Button>
                        <Button variant="outline" size="icon" className="h-14 w-14 rounded-2xl border-2 shadow-sm" onClick={onScanClick}><QrCode className="w-6 h-6" /></Button>
                    </div>
                </div>
                {selectedClient && (
                    <div className="mt-3 flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] font-black uppercase text-primary tracking-widest bg-primary/5 px-2 py-0.5 rounded-full border border-primary/10">{selectedClient.name}</span>
                        </div>
                        {isBirthdayToday && <Badge className="bg-pink-500 text-white border-none animate-pulse h-5 px-2 text-[8px] font-black uppercase tracking-widest shadow-lg shadow-pink-500/20"><Cake className="w-2.5 h-2.5 mr-1" /> Celebration</Badge>}
                    </div>
                )}
            </div>

            <ScrollArea className="flex-1 min-h-0 -mx-2 px-2">
                <div className="space-y-8 pb-10">
                    {selectedClient && (selectedClient.outstandingBalance || 0) > 0 && (
                        <div className="p-5 rounded-[2rem] border-4 border-destructive bg-destructive/5 text-destructive shadow-2xl shadow-destructive/5 space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-destructive rounded-xl shadow-lg shadow-destructive/20"><Wallet className="h-5 w-5 text-white" /></div>
                                <div className="space-y-0.5">
                                    <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Accounting Alert</p>
                                    <p className="text-sm font-black uppercase tracking-tight">Debt Detected</p>
                                </div>
                            </div>
                            <p className="text-xs font-bold leading-relaxed opacity-80 uppercase tracking-tight">Client owes <strong className="text-lg tracking-tighter">${selectedClient.outstandingBalance!.toFixed(2)}</strong> from past sessions.</p>
                            <Button variant="destructive" size="sm" className="w-full h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-destructive/20" onClick={() => selectedClient.unpaidFees?.forEach(fee => onApplyAdjustmentToggle(fee.feeId, true))}>Resolve & Collect Now</Button>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="flex items-center gap-2 px-1">
                            <ShoppingCart className="w-4 h-4 text-primary" />
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Session Summary</h3>
                        </div>
                        <div className="space-y-3">
                            {appointmentsData.map((data: any) => {
                                const isRedeemed = redeemedOffer?.id === data.service.id;
                                const isWaived = waivedAppointmentFees.has(data.appointment.id);
                                const addOns = (data.appointment.addOnIds || []).map((id: any) => services.find(s => s.id === id)).filter(Boolean);
                                
                                return (
                                    <Card key={data.appointment.id} className={cn("overflow-hidden rounded-[2rem] border-2 shadow-sm transition-all", isRedeemed ? "border-primary bg-primary/[0.03] shadow-lg" : "border-border bg-muted/5")}>
                                        <CardContent className="p-5 space-y-4">
                                            <div className="flex justify-between items-start gap-4">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <p className="font-black text-sm uppercase tracking-tight truncate text-slate-900">{data.service.name}</p>
                                                        {isRedeemed && <Badge className="bg-primary text-white border-none text-[8px] h-4 font-black uppercase">Perk</Badge>}
                                                    </div>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">{data.staff.name.split(' ')[0]} &middot; {data.service.duration}m</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className={cn("font-black font-mono text-lg tracking-tighter", isRedeemed ? "line-through text-muted-foreground opacity-40" : "text-slate-900")}>${getServicePrice(data.service, data.staff).toFixed(2)}</p>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive -mr-2" onClick={() => onSelectAppointment(data.appointment.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                                                </div>
                                            </div>
                                            
                                            {addOns.length > 0 && (
                                                <div className="space-y-2 pl-4 border-l-2 border-primary/10">
                                                    {addOns.map((addon: any) => (
                                                        <div key={addon.id} className="flex justify-between items-center group">
                                                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">+ {addon.name}</span>
                                                            <span className="text-[10px] font-black font-mono text-muted-foreground">${getServicePrice(addon, data.staff).toFixed(2)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {data.appointment.checkoutState?.additionalCharge > 0 && (
                                                <div className="pt-3 border-t border-dashed flex justify-between items-center">
                                                    <span className="text-[10px] font-black uppercase text-muted-foreground">Dynamic Overage Fee</span>
                                                    <div className="flex items-center gap-3">
                                                        <span className={cn("font-black font-mono text-xs", isWaived ? "line-through text-muted-foreground opacity-40" : "text-amber-600")}>+${data.appointment.checkoutState.additionalCharge.toFixed(2)}</span>
                                                        {isOwnerOrAdmin && (isWaived ? <Button variant="ghost" size="xs" className="h-5 px-1.5 text-[8px] font-black uppercase text-primary underline" onClick={() => onWaiveFeeToggle(data.appointment.id, false)}>Undo</Button> : <Button variant="ghost" size="xs" className="h-5 px-1.5 text-[8px] font-black uppercase text-amber-600 border border-amber-200 bg-amber-50" onClick={() => handleWaiveClick(data.appointment.id)}>Absorb</Button>)}
                                                    </div>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                );
                            })}

                            {cart.map((item: any) => (
                                <div key={item.id} className="p-4 rounded-2xl bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all flex items-center gap-4 group">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-black text-xs uppercase tracking-tight text-slate-900 truncate">{item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}</p>
                                        <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-60">{item.type}</p>
                                    </div>
                                    <p className="font-black font-mono text-sm tracking-tighter">${(item.price * item.quantity).toFixed(2)}</p>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleUpdateQuantity(item.id, 0)}><Trash2 className="h-4 w-4"/></Button>
                                </div>
                            ))}

                            {Array.from(appliedAdjustments).map(id => {
                                const fee = clients.flatMap((c: any) => c.unpaidFees || []).find((f: any) => f.feeId === id);
                                return (
                                    <div key={id} className="p-4 rounded-2xl border-2 border-destructive/20 bg-destructive/[0.02] flex items-center gap-4 animate-in fade-in slide-in-from-left-2">
                                        <div className="p-2 bg-destructive/10 rounded-xl"><Wallet className="w-4 h-4 text-destructive" /></div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-black text-xs uppercase tracking-tight text-destructive truncate">{fee?.reason}</p>
                                            <p className="text-[9px] font-black text-destructive/60 uppercase tracking-widest">Historical Balance</p>
                                        </div>
                                        <p className="font-black font-mono text-sm tracking-tighter text-destructive">+${fee?.feeAmount.toFixed(2)}</p>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onApplyAdjustmentToggle(id as string, false)}><X className="h-4 w-4"/></Button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center gap-2 px-1">
                            <Tag className="w-4 h-4 text-primary" />
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Discounts & Growth</h3>
                        </div>
                        <div className="flex gap-3">
                            <div className="relative flex-1">
                                <Tag className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                                <Input placeholder="ENTER PROMO..." value={promoCodeInput} onChange={e => setPromoCodeInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleApplyDiscount(promoCodeInput)} className="pl-10 h-12 rounded-xl border-2 font-black uppercase text-xs tracking-widest focus-visible:ring-primary/20" />
                            </div>
                            <Button variant="outline" size="icon" className="h-12 w-12 rounded-xl border-2 shadow-sm" onClick={() => setIsDiscountBrowserOpen(true)}><Users className="w-5 h-5" /></Button>
                        </div>

                        {appliedDiscountCodes.length > 0 && (
                            <div className="space-y-2">
                                {appliedDiscountCodes.map((code: string) => (
                                    <div key={code} className="p-3 rounded-xl bg-primary/10 border-2 border-primary/20 flex items-center justify-between animate-in zoom-in-95">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle className="h-4 w-4 text-primary" />
                                            <p className="text-xs font-black uppercase tracking-widest text-primary">{code}</p>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:bg-primary/10" onClick={() => handleRemoveDiscount(code)}><X className="h-4 w-4" /></Button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {suggestedDiscounts.length > 0 && (
                            <div className="space-y-3 pt-2">
                                <p className="text-[9px] font-black uppercase text-amber-600 tracking-[0.2em] flex items-center gap-2 px-1"><Wand2 className="h-3 w-3" /> Growth Recommendations</p>
                                {suggestedDiscounts.map(d => (
                                    <Button key={d.id} variant="outline" className="w-full justify-between h-auto py-4 px-5 border-amber-500/20 bg-amber-500/[0.03] hover:bg-amber-500/10 border-2 rounded-2xl group transition-all" onClick={() => handleApplyDiscount(d.code)}>
                                        <div className="text-left min-w-0 flex-1">
                                            <p className="text-xs font-black uppercase tracking-widest text-amber-700">{d.code}</p>
                                            <p className="text-[10px] text-muted-foreground font-bold truncate opacity-60 uppercase">{d.description}</p>
                                        </div>
                                        <div className="text-right ml-4 shrink-0">
                                            <p className="text-sm font-black text-amber-700">{d.type === 'percentage' ? `${d.value}%` : `$${d.value}`} OFF</p>
                                        </div>
                                    </Button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </ScrollArea>
            
            <div className="flex-shrink-0 pt-6 border-t-4 border-muted/30 bg-white">
                <div className="space-y-3 text-sm px-1">
                    <div className="flex justify-between items-center text-muted-foreground font-bold uppercase text-[10px] tracking-widest opacity-60"><p>Subtotal</p><p className="font-mono text-xs">${subtotal.toFixed(2)}</p></div>
                    {(discount + membershipDiscount) > 0 && (
                        <div className="flex justify-between items-center text-[11px] text-primary font-black uppercase tracking-tighter">
                            <span className="flex items-center gap-2"><Percent className="w-3.5 h-3.5" /> Discounts Applied</span>
                            <span className="font-mono text-xs">-${(discount + membershipDiscount).toFixed(2)}</span>
                        </div>
                    )}
                    {appliedAdjustments.size > 0 && (
                        <div className="flex justify-between items-center text-[11px] text-destructive font-black uppercase tracking-tighter">
                            <span className="flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Settling Historical Debt</span>
                            <span className="font-mono text-xs">+${Array.from(appliedAdjustments).reduce((sum, id) => {
                                const fee = clients.flatMap((c: any) => c.unpaidFees || []).find((f: any) => f.feeId === id);
                                return sum + (fee?.feeAmount || 0);
                            }, 0).toFixed(2)}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center text-muted-foreground font-bold uppercase text-[10px] tracking-widest opacity-60"><p>Studio Tax (7%)</p><p className="font-mono text-xs">${tax.toFixed(2)}</p></div>
                    <div className="flex justify-between items-center py-2">
                        <p className="font-black uppercase text-[11px] tracking-[0.2em] text-muted-foreground">Gratuity</p>
                        <div className="relative w-36">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary font-black" />
                            <Input type="number" value={tipAmount || ''} onChange={(e) => setTipAmount(parseFloat(e.target.value) || 0)} className="h-12 text-right pr-4 pl-10 font-black text-xl border-2 rounded-2xl shadow-inner focus-visible:ring-primary/20" placeholder="0.00" />
                        </div>
                    </div>
                    {allInvolvedStaff.length > 1 && (
                        <div className="p-4 rounded-2xl border-2 bg-muted/10 space-y-3">
                            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2"><Users className="w-3 h-3" /> Split Tip Distribution</p>
                            {allInvolvedStaff.map((member: any) => (
                                <div key={member.id} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Avatar className="h-6 w-6 border shadow-sm"><AvatarImage src={member.avatarUrl} className="object-cover" /><AvatarFallback>{member.name.charAt(0)}</AvatarFallback></Avatar>
                                        <span className="text-[10px] font-black uppercase tracking-tight truncate">{member.name.split(' ')[0]}</span>
                                    </div>
                                    <div className="relative w-24">
                                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 h-3 text-muted-foreground" />
                                        <Input type="number" value={tipAllocations[member.id] || ''} onChange={(e) => setTipAllocations({...tipAllocations, [member.id]: parseFloat(e.target.value) || 0})} className="h-7 text-right text-[10px] pl-5 font-bold rounded-lg border-primary/10" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <Separator className="my-4" />
                    <div className="flex justify-between items-baseline font-black text-4xl text-primary tracking-tighter"><p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Checkout Total</p><p className="font-mono">${total.toFixed(2)}</p></div>
                </div>
                
                <div className="mt-8 space-y-4 pb-10">
                    <RadioGroup value={paymentTab} onValueChange={setPaymentTab} className="grid grid-cols-3 gap-3">
                        <div><RadioGroupItem value="cash" id="pos-pay-cash" className="peer sr-only" /><RadioLabel htmlFor="pos-pay-cash" className="flex flex-col items-center justify-center rounded-[1.25rem] border-2 border-muted bg-white p-3 text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all cursor-pointer h-20 shadow-sm"><Banknote className="mb-1.5 h-6 w-6 opacity-40" />Cash</RadioLabel></div>
                        <div><RadioGroupItem value="card" id="pos-pay-card" className="peer sr-only" /><RadioLabel htmlFor="pos-pay-card" className="flex flex-col items-center justify-center rounded-[1.25rem] border-2 border-muted bg-white p-3 text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all cursor-pointer h-20 shadow-sm"><CreditCard className="mb-1.5 h-6 w-6 opacity-40" />Card</Label></div>
                        <div><RadioGroupItem value="scan" id="pos-pay-scan" className="peer sr-only" /><RadioLabel htmlFor="pos-pay-scan" className="flex flex-col items-center justify-center rounded-[1.25rem] border-2 border-muted bg-white p-3 text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all cursor-pointer h-20 shadow-sm"><Scan className="mb-1.5 h-6 w-6 opacity-40" />Scan</Label></div>
                    </RadioGroup>

                    {paymentTab === 'cash' && (
                        <div className="space-y-4 pt-2 animate-in slide-in-from-top-2">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5"><Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground ml-1">Tendered</Label><div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground font-black" /><Input type="number" value={amountTendered || ''} onChange={(e) => setAmountTendered(parseFloat(e.target.value) || 0)} className="pl-9 h-14 font-black text-2xl border-2 rounded-2xl shadow-inner" /></div></div>
                                {amountTendered > total && (<div className="space-y-1.5"><Label className="text-[10px] uppercase font-black tracking-widest text-green-600 ml-1">Change</Label><div className="h-14 flex items-center justify-center bg-green-500/10 border-4 border-green-500/20 rounded-2xl"><p className="font-black text-2xl text-green-600 font-mono tracking-tighter">${(amountTendered - total).toFixed(2)}</p></div></div>)}
                            </div>
                            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                {quickTenderOptions.map(val => (<Button key={val} variant="outline" size="sm" className="flex-1 font-black h-10 rounded-xl text-xs shrink-0 border-2" onClick={() => setAmountTendered(val)}>${val}</Button>))}
                                <Button variant="outline" size="sm" className="flex-1 font-black h-10 rounded-xl border-4 border-primary text-primary text-xs shrink-0" onClick={() => setAmountTendered(total)}>EXACT</Button>
                            </div>
                        </div>
                    )}

                    <div className="pt-4">
                        <Button className="w-full h-20 text-2xl font-black rounded-3xl shadow-2xl shadow-primary/30 transition-all hover:scale-[1.02] active:scale-95 uppercase tracking-tighter" onClick={() => onCheckout({paymentMethod: paymentTab, amountTendered})} disabled={isSubmitting || (paymentTab === 'cash' && amountTendered < total)}>
                            {isSubmitting ? <Loader className="animate-spin h-8 w-8" /> : (total <= 0 ? 'COMPLETE SALE' : `COLLECT $${total.toFixed(2)}`)}
                        </Button>
                    </div>
                </div>
            </div>
            <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts || []} onSelect={handleApplyDiscount} cartServiceIds={cartServiceIds} />
            <WaiveFeeDialog open={isWaiveAuthOpen} onOpenChange={setIsWaiveAuthOpen} feeAmount={appointmentsData.find((a:any) => a.appointment.id === pendingWaiveAptId)?.appointment.checkoutState?.additionalCharge || 0} staff={staff} onConfirm={handleConfirmWaive} />
        </div>
    );
};
