'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Banknote, CreditCard, Scan, Trash2, Edit, User, Printer, UserPlus, DollarSign, Award, Loader, Gift, AlertTriangle, Repeat, CheckCircle, Percent, QrCode } from 'lucide-react';
import { type Appointment, type Service, type Client, type Discount, type Staff, Membership, Package } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { BrowseDiscountsDialog } from '../discounts/BrowseDiscountsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { Switch } from '../ui/switch';
import { Checkbox } from '../ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { subMonths, parseISO, isAfter } from 'date-fns';


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
    appliedDiscountCode,
    setAppliedDiscountCode,
    discount,
    membershipDiscount,
    showTitle = true,
    isSubmitting,
    paymentTab,
    setPaymentTab,
    discounts,
    amountTendered,
    setAmountTendered,
    adjustments,
    appliedAdjustments,
    onApplyAdjustmentToggle,
    absorbedCost,
    redeemedOffer,
    setRedeemedOffer,
    memberships,
    packages,
}: { 
    cart: any[], 
    onCartChange: (cart: any[]) => void,
    appointmentsData: (Appointment & { client: Client, service: Service, addOnServices: Service[], staff: Staff })[],
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
    appliedDiscountCode: string | undefined;
    setAppliedDiscountCode: (code: string | undefined) => void;
    discount: number;
    membershipDiscount: number;
    showTitle?: boolean,
    isSubmitting: boolean;
    paymentTab: string;
    setPaymentTab: (tab: string) => void;
    discounts: Discount[];
    amountTendered: number;
    setAmountTendered: (amount: number) => void;
    adjustments: { id: string; clientName: string; serviceName: string; description: string; cost: number; }[];
    appliedAdjustments: Set<string>;
    onApplyAdjustmentToggle: (adjustmentId: string, apply: boolean) => void;
    absorbedCost: number;
    redeemedOffer: { type: 'membership' | 'package' | 'retail_discount'; id: string } | null;
    setRedeemedOffer: (offer: { type: 'membership' | 'package' | 'retail_discount'; id: string } | null) => void;
    memberships: Membership[];
    packages: Package[];
}) => {
    
    const [promoCode, setPromoCode] = useState('');
    const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);
    const { inventory } = useInventory();
    const { toast } = useToast();

    useEffect(() => {
        setPromoCode(appliedDiscountCode || '');
    }, [appliedDiscountCode]);
    
    const selectedClient = useMemo(() => {
        return clients.find((c: Client) => c.id === selectedClientId);
    }, [selectedClientId, clients]);

    const handleUpdateQuantity = (itemId: string, newQuantity: number) => {
        if (newQuantity <= 0) {
            onCartChange(cart.filter(item => item.id !== itemId));
        } else {
            onCartChange(cart.map(item => item.id === itemId ? { ...item, quantity: newQuantity } : item));
        }
    };

    const cartServiceIds = useMemo(() => {
        const appointmentServiceIds = appointmentsData.map(a => a.serviceId);
        const cartServices = cart.filter(item => item.type === 'service').map(item => item.id);
        return [...new Set([...appointmentServiceIds, ...cartServices])];
    }, [cart, appointmentsData]);
    
    const totalDiscount = discount + membershipDiscount;
    
    const changeDue = amountTendered > 0 && paymentTab === 'cash' ? amountTendered - total : 0;
    
     const quickTenderOptions = useMemo(() => {
        const options = new Set<number>();
        if (total <= 0) return [];
    
        const roundUp = (num: number, multiple: number) => Math.ceil(num / multiple) * multiple;

        const next5 = roundUp(total, 5);
        if (next5 > total) options.add(next5);

        const next10 = roundUp(total, 10);
        if (next10 > total) options.add(next10);

        const next20 = roundUp(total, 20);
        if (next20 > total) options.add(next20);
        
        const next50 = roundUp(total, 50);
        if (next50 > total) options.add(next50);
        
        const next100 = roundUp(total, 100);
        if (next100 > total) options.add(next100);

        return Array.from(options).sort((a,b) => a - b).slice(0, 3);
    }, [total]);

    return (
        <div className="flex flex-col h-full max-h-full">
            {showTitle && (
                <div className="flex justify-between items-center mb-2 flex-shrink-0 px-4 md:px-0">
                    <h2 className="text-xl font-bold">Current Sale</h2>
                </div>
            )}
             <div className="mb-2 md:mb-4 flex-shrink-0 px-4 md:px-0">
                <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">Payer</Label>
                <div className="flex gap-2 mt-1">
                    <Select
                        value={isGroupCheckout ? selectedClientId || '' : selectedClientId || 'walk-in'}
                        onValueChange={(value) => {
                            if (value === 'walk-in') {
                                setSelectedClientId(null);
                            } else {
                                setSelectedClientId(value);
                            }
                        }}
                    >
                        <SelectTrigger className="h-10 md:h-11">
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
                    <div className="mt-1 text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                        Account: <span className="text-foreground">{selectedClient.name}</span>
                    </div>
                )}
            </div>

            <Separator className="mx-4 md:mx-0" />

            <ScrollArea className="flex-1 min-h-0 my-2 md:my-4 px-4 md:px-0">
                <div className="space-y-4 md:space-y-6 pb-4">
                    {/* APPOINTMENT ITEMS */}
                    {appointmentsData.length > 0 && (
                        <div className="space-y-2 md:space-y-3">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Services</h3>
                            {appointmentsData.map(data => {
                                const { service, client } = data;
                                if (!service || !client) return null;

                                const isRedeemed = redeemedOffer?.id === service.id;

                                const membership = client.activeMembershipId ? memberships.find(m => m.id === client.activeMembershipId) : null;
                                const membershipPerk = membership?.includedServices?.find(ps => ps.id === service.id);
                                
                                const currentPerkUsage = client.subscription?.perkUsage?.[service.id] || 0;
                                const isUsedInThisCycle = client.subscription?.nextBillingDate ? (
                                    isAfter(parseISO(client.subscription.perkLastUsed || '1970-01-01'), subMonths(parseISO(client.subscription.nextBillingDate), 1))
                                ) : false;

                                const effectiveUsageCount = isUsedInThisCycle ? currentPerkUsage : 0;
                                const hasMembershipPerk = !!membershipPerk && effectiveUsageCount < membershipPerk.quantity;
                                
                                const packagePerk = client.activePackages?.find(p => {
                                    const packageDetails = packages.find(pkg => pkg.id === p.packageId);
                                    return packageDetails?.serviceId === service.id && p.sessionsRemaining > 0;
                                });

                                const hasPerk = hasMembershipPerk || !!packagePerk;
                                
                                const handleRedeem = () => {
                                    if (isRedeemed) {
                                        setRedeemedOffer(null);
                                    } else if (redeemedOffer) {
                                        toast({ variant: 'destructive', title: 'Only one offer can be redeemed per transaction.' });
                                    } else {
                                        setRedeemedOffer({ type: packagePerk ? 'package' : 'membership', id: service.id });
                                    }
                                };
                                
                                if (!hasPerk && !isRedeemed) {
                                    return (
                                        <div key={data.id} className="text-sm flex items-center gap-3 p-2 md:p-3 bg-muted/20 border rounded-xl">
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-xs md:text-sm truncate">
                                                    {service.name}
                                                </p>
                                                {isGroupCheckout && <p className="text-[9px] md:text-[10px] text-muted-foreground">for {client.name}</p>}
                                            </div>
                                            <p className="font-bold font-mono text-xs md:text-sm">
                                                ${(service.price || 0).toFixed(2)}
                                            </p>
                                            <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8 text-destructive" onClick={() => onSelectAppointment(data.id)}><Trash2 className="w-3.5 h-3.5"/></Button>
                                        </div>
                                    )
                                }
                            
                                return (
                                    <Card key={data.id} className={cn("overflow-hidden rounded-xl border-2", isRedeemed ? "bg-primary/5 border-primary shadow-sm" : "border-indigo-500/20")}>
                                        <CardContent className="p-2 md:p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-bold text-xs md:text-sm truncate">
                                                        {service.name}
                                                    </p>
                                                    {isGroupCheckout && <p className="text-[9px] md:text-[10px] text-muted-foreground">for {client.name}</p>}
                                                    <p className={cn("text-xs md:text-sm font-black mt-1 font-mono", isRedeemed ? "line-through text-muted-foreground opacity-50" : "text-primary")}>
                                                        ${(service.price || 0).toFixed(2)}
                                                    </p>
                                                </div>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8 shrink-0 text-destructive" onClick={() => onSelectAppointment(data.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                                            </div>

                                            {isRedeemed ? (
                                                <div className="mt-2 p-1.5 rounded-lg bg-green-500/10 text-green-700 dark:text-green-300 flex items-center justify-between border border-green-500/20">
                                                    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-tight">
                                                        <CheckCircle className="w-3 h-3" />
                                                        Perk Applied
                                                    </div>
                                                    <Button variant="ghost" size="xs" onClick={handleRedeem} className="h-5 px-1.5 text-[9px] font-bold uppercase hover:bg-green-500/20 text-green-700 dark:text-green-300 underline">Undo</Button>
                                                </div>
                                            ) : (
                                                <div className="mt-2">
                                                    <Button variant="secondary" size="sm" className="w-full text-[10px] md:text-[11px] h-8 md:h-9 font-bold uppercase tracking-tight" onClick={handleRedeem}>
                                                        {hasMembershipPerk && <><Award className="w-3 h-3 mr-1.5 text-indigo-500"/>Redeem ({effectiveUsageCount}/{membershipPerk.quantity})</>}
                                                        {packagePerk && <><Repeat className="w-3 h-3 mr-1.5 text-teal-500"/>Use 1 Session</>}
                                                    </Button>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>
                    )}

                    {/* RETAIL ITEMS */}
                    {cart.length > 0 && (
                        <div className="space-y-2 md:space-y-3">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Retail & Products</h3>
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
                            
                            {/* Membership Retail Discount Support */}
                            {selectedClient && (
                                <div className="mt-2">
                                    {(() => {
                                        const membership = memberships.find(m => m.id === selectedClient.activeMembershipId);
                                        const retailDiscount = membership?.retailDiscount;
                                        const retailDiscountLimit = membership?.retailDiscountLimit || 0;
                                        
                                        if (!retailDiscount) return null;

                                        const isRedeemed = redeemedOffer?.type === 'retail_discount';
                                        const usage = selectedClient.subscription?.perkUsage?.['retail_discount'] || 0;
                                        
                                        const isUsedInThisCycle = selectedClient.subscription?.nextBillingDate ? (
                                            isAfter(parseISO(selectedClient.subscription.perkLastUsed || '1970-01-01'), subMonths(parseISO(selectedClient.subscription.nextBillingDate), 1))
                                        ) : false;

                                        const effectiveUsage = isUsedInThisCycle ? usage : 0;
                                        const hasUsesLeft = retailDiscountLimit === 0 || effectiveUsage < retailDiscountLimit;

                                        if (!hasUsesLeft && !isRedeemed) return null;

                                        return (
                                            <Card className={cn("border-2", isRedeemed ? "bg-primary/5 border-primary" : "border-indigo-500/20")}>
                                                <CardContent className="p-3">
                                                    <div className="flex justify-between items-center">
                                                        <div>
                                                            <p className="font-bold text-xs">{retailDiscount}% Member Retail Discount</p>
                                                            {retailDiscountLimit > 0 && (
                                                                <p className="text-[9px] text-muted-foreground uppercase font-black">
                                                                    {effectiveUsage}/{retailDiscountLimit} Used this cycle
                                                                </p>
                                                            )}
                                                        </div>
                                                        <Button 
                                                            variant={isRedeemed ? "outline" : "secondary"} 
                                                            size="sm" 
                                                            className="h-8 text-[10px] font-black uppercase"
                                                            onClick={() => setRedeemedOffer(isRedeemed ? null : { type: 'retail_discount', id: 'retail_discount' })}
                                                        >
                                                            {isRedeemed ? 'Remove' : 'Apply'}
                                                        </Button>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ADJUSTMENTS */}
                    {(adjustments && adjustments.length > 0) && (
                        <div className="space-y-2 md:space-y-3">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Adjustments</h3>
                            <Card className="bg-amber-500/5 border-amber-500/20 border-2 rounded-xl">
                                <CardHeader className="p-2 md:p-3 pb-1 md:pb-2">
                                    <CardTitle className="text-[10px] md:text-xs font-black uppercase tracking-tight flex items-center gap-2">
                                        <AlertTriangle className="h-3.5 w-3.5 md:h-4 md:w-4 text-amber-600" />
                                        Performance Adjustments
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-2 md:p-3 pt-0 space-y-1.5 md:space-y-2">
                                    {adjustments.map(adj => (
                                        <div key={adj.id} className="flex items-start gap-2 md:gap-3 p-2 md:p-2.5 rounded-lg bg-background/50 border border-amber-500/10">
                                            <Checkbox 
                                                id={`adj-${adj.id}`}
                                                checked={appliedAdjustments.has(adj.id)}
                                                onCheckedChange={(checked) => onApplyAdjustmentToggle(adj.id, !!checked)}
                                                className="mt-0.5"
                                            />
                                            <div className="flex-1 min-w-0 space-y-0.5">
                                                <Label htmlFor={`adj-${adj.id}`} className="text-[11px] md:text-xs font-bold leading-tight block truncate">
                                                    {adj.description}
                                                </Label>
                                                <p className="text-[9px] md:text-[10px] text-muted-foreground truncate">{adj.clientName} &middot; {adj.serviceName}</p>
                                            </div>
                                            <p className="font-mono text-[11px] md:text-xs font-black text-amber-700 dark:text-amber-400">+${adj.cost.toFixed(2)}</p>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </div>
            </ScrollArea>
            
            <div className="flex-shrink-0 pt-2 md:pt-4 border-t bg-card px-4 md:px-0">
                <div className="space-y-1.5 md:space-y-2.5 text-sm">
                    <div className="flex justify-between text-muted-foreground font-medium text-xs md:text-sm"><p>Subtotal</p><p className="font-mono">${subtotal.toFixed(2)}</p></div>
                    {totalDiscount > 0 && (
                        <div className="flex justify-between text-[11px] md:text-sm text-primary font-black uppercase tracking-tight">
                            <span className="flex items-center gap-1.5"><Percent className="w-3 h-3 md:w-3.5 md:h-3.5" /> Discounts Applied</span>
                            <span className="font-mono">-${totalDiscount.toFixed(2)}</span>
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
                    <Separator className="my-1.5 md:my-3" />
                    <div className="flex justify-between items-baseline font-black text-2xl md:text-3xl text-primary tracking-tighter"><p className="text-[10px] md:text-sm uppercase tracking-widest text-muted-foreground">Total</p><p className="font-mono">${total.toFixed(2)}</p></div>
                </div>
                
                <div className="mt-3 md:mt-6 space-y-3 md:space-y-4 pb-8 md:pb-10">
                    <RadioGroup value={paymentTab} onValueChange={setPaymentTab} className="grid grid-cols-3 gap-2">
                        <div>
                            <RadioGroupItem value="cash" id="pay-cash" className="peer sr-only" />
                            <Label htmlFor="pay-cash" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-2 md:p-3 text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all cursor-pointer h-14 md:h-16">
                                <Banknote className="mb-1 h-4 w-4 md:h-5 md:w-5" />Cash
                            </Label>
                        </div>
                        <div>
                            <RadioGroupItem value="card" id="pay-card" className="peer sr-only" />
                            <Label htmlFor="pay-card" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-2 md:p-3 text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all cursor-pointer h-14 md:h-16">
                                <CreditCard className="mb-1 h-4 w-4 md:h-5 md:w-5" />Card
                            </Label>
                        </div>
                        <div>
                            <RadioGroupItem value="scan" id="pay-scan" className="peer sr-only" />
                            <Label htmlFor="pay-scan" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-2 md:p-3 text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all cursor-pointer h-14 md:h-16">
                                <Scan className="mb-1 h-4 w-4 md:h-5 md:w-5" />Scan
                            </Label>
                        </div>
                    </RadioGroup>

                    {paymentTab === 'cash' && (
                        <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 md:space-y-4 pt-1">
                            <div className="grid grid-cols-2 gap-3 md:gap-4">
                                <div className="space-y-1">
                                    <Label className="text-[9px] md:text-[10px] uppercase font-black tracking-widest text-muted-foreground">Amount Tendered</Label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" />
                                        <Input
                                            type="number"
                                            value={amountTendered || ''}
                                            onChange={(e) => setAmountTendered(parseFloat(e.target.value) || 0)}
                                            className="pl-7 md:pl-8 h-10 md:h-12 font-black text-lg md:text-xl border-2"
                                        />
                                    </div>
                                </div>
                                {changeDue > 0 && (
                                    <div className="space-y-1">
                                        <Label className="text-[9px] md:text-[10px] uppercase font-black tracking-widest text-green-600">Change Due</Label>
                                        <div className="h-10 md:h-12 flex items-center justify-center bg-green-500/10 border-2 border-green-500/20 rounded-xl">
                                            <p className="font-black text-lg md:text-xl text-green-600 font-mono">${changeDue.toFixed(2)}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-1.5 md:gap-2 overflow-x-auto pb-1 no-scrollbar">
                                {quickTenderOptions.map(val => (
                                    <Button key={val} variant="outline" size="sm" className="flex-1 font-bold h-8 md:h-9 rounded-xl text-xs md:text-sm shrink-0" onClick={() => setAmountTendered(val)}>${val}</Button>
                                ))}
                                <Button variant="outline" size="sm" className="flex-1 font-black h-8 md:h-9 rounded-xl border-primary text-primary text-xs md:text-sm shrink-0" onClick={() => setAmountTendered(total)}>Exact</Button>
                            </div>
                        </motion.div>
                    )}

                    <div className="pt-2">
                        <Button 
                            className="w-full h-14 md:h-16 text-xl md:text-2xl font-black rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95" 
                            onClick={() => onCheckout({paymentMethod: paymentTab, amountTendered})} 
                            disabled={isSubmitting || (paymentTab === 'cash' && amountTendered < total)}
                        >
                            {isSubmitting ? <Loader className="animate-spin" /> : `Collect $${total.toFixed(2)}`}
                        </Button>
                    </div>
                </div>
            </div>
            <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts || []} onSelect={(code) => { setPromoCode(code); }} cartServiceIds={cartServiceIds} />
        </div>
    );
};
