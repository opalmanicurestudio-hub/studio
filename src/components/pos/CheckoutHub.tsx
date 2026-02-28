'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Banknote, CreditCard, Scan, Trash2, Edit, User, Printer, UserPlus, DollarSign, Award, Loader, Gift, AlertTriangle, Repeat, CheckCircle, Percent, QrCode, Tag, Wand2, X, ShoppingCart, ChevronDown } from 'lucide-react';
import { type Appointment, type Service, type Client, type Discount, type Staff, Membership, Package, getServicePrice } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { BrowseDiscountsDialog } from '../discounts/BrowseDiscountsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Progress } from '../ui/progress';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { Switch } from '../ui/switch';
import { Checkbox } from '../ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { subMonths, parseISO, isAfter, format, isSameMonth, differenceInDays } from 'date-fns';


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
    subtotal: propSubtotal,
    tax: propTax,
    total: propTotal,
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
    adjustments,
    appliedAdjustments,
    onApplyAdjustmentToggle,
    absorbedCost,
    redeemedOffer,
    setRedeemedOffer,
    memberships,
    packages,
    allowStacking,
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
    adjustments: { id: string; clientName: string; serviceName: string; description: string; cost: number; }[];
    appliedAdjustments: Set<string>;
    onApplyAdjustmentToggle: (adjustmentId: string, apply: boolean) => void;
    absorbedCost: number;
    redeemedOffer: { type: 'membership' | 'package' | 'retail_discount'; id: string } | null;
    setRedeemedOffer: (offer: { type: 'membership' | 'package' | 'retail_discount'; id: string } | null) => void;
    memberships: Membership[];
    packages: Package[];
    allowStacking: boolean;
}) => {
    
    const [promoCodeInput, setPromoCodeInput] = useState('');
    const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);
    const { appointments: allAppointments, inventory, services } = useInventory();
    const { toast } = useToast();

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
        const appointmentAddOnIds = appointmentsData.flatMap(a => a.addOnIds || []);
        return [...new Set([...appointmentServiceIds, ...cartServices, ...appointmentAddOnIds])];
    }, [cart, appointmentsData]);

    const subtotal = useMemo(() => {
        const servicesTotal = appointmentsData.reduce((total, data) => {
            const { service, staff } = data;
            const servicePrice = redeemedOffer?.id === service?.id ? 0 : getServicePrice(service, staff);
            const addOnsPrice = (data.appointment.addOnIds || [])
                .map(id => services.find(s => s.id === id))
                .filter((s): s is Service => !!s)
                .reduce((a, b) => a + getServicePrice(b, staff), 0);
            return total + servicePrice + addOnsPrice;
        }, 0);

        const retailTotal = cart.reduce((acc, item) => {
            return acc + (item.quantity * item.price);
        }, 0);
        
        return servicesTotal + retailTotal;
    }, [appointmentsData, services, cart, redeemedOffer]);

    const handleApplyDiscount = (code: string) => {
        const codeUpper = code.trim().toUpperCase();
        if (!codeUpper) return;

        const d = discounts.find(d => d.code.toUpperCase() === codeUpper);
        if (d && d.isActive) {
            // Check compatibility
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
                if (appliedDiscountCodes.length > 0) {
                    toast({ title: 'Discount Replaced', description: `Stacking is disabled. ${appliedDiscountCodes[0]} replaced with ${d.code}.` });
                }
            } else {
                setAppliedDiscountCodes([...appliedDiscountCodes, d.code]);
                toast({ title: 'Discount Added', description: `${d.code} added to sale.` });
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

            // Usage limit check
            if (d.limitOnePerCustomer && d.usedByClientIds?.includes(selectedClient.id)) return false;

            // Automation compatibility check
            const isCompatible = !d.applicableServiceIds || d.applicableServiceIds.length === 0 || 
                                (d.applicableServiceIds.some(id => cartServiceIds.includes(id)));
            if (!isCompatible) return false;

            const trigger = d.automation?.trigger;

            if (trigger === 'birthday' && selectedClient.birthday) {
                return isSameMonth(new Date(), parseISO(selectedClient.birthday));
            }

            if (trigger === 'loyalty' && d.automation?.appointmentThreshold) {
                // Trigger if they just hit the threshold or a multiple of it
                return completedCount > 0 && (completedCount % d.automation.appointmentThreshold === 0);
            }

            if (trigger === 'new_client') {
                return completedCount === 0;
            }

            if (trigger === 're_engagement' && d.automation?.daysSinceLastVisit && selectedClient.lastAppointment) {
                const daysSince = differenceInDays(new Date(), parseISO(selectedClient.lastAppointment));
                return daysSince >= d.automation.daysSinceLastVisit;
            }

            return false;
        });
    }, [selectedClient, discounts, appliedDiscountCodes, allAppointments, cartServiceIds]);
    
    const totalDiscountValue = discount + membershipDiscount;
    const subtotalAfterDiscounts = Math.max(0, (subtotal + (adjustments?.filter(a => appliedAdjustments.has(a.id)).reduce((s, a) => s + a.cost, 0) || 0)) - totalDiscountValue);
    const taxValue = subtotalAfterDiscounts * 0.07;
    const grandTotal = subtotalAfterDiscounts + taxValue + tipAmount;
    
    const changeDueValue = amountTendered > 0 && paymentTab === 'cash' ? amountTendered - grandTotal : 0;
    
    const quickTenderOptions = useMemo(() => {
        const options = new Set<number>();
        if (grandTotal <= 0) return [];
    
        const roundUp = (num: number, multiple: number) => Math.ceil(num / multiple) * multiple;

        const next5 = roundUp(grandTotal, 5);
        if (next5 > grandTotal) options.add(next5);

        const next10 = roundUp(grandTotal, 10);
        if (next10 > grandTotal) options.add(next10);

        const next20 = roundUp(grandTotal, 20);
        if (next20 > grandTotal) options.add(next20);
        
        const next50 = roundUp(grandTotal, 50);
        if (next50 > grandTotal) options.add(next50);
        
        const next100 = roundUp(grandTotal, 100);
        if (next100 > grandTotal) options.add(next100);

        return Array.from(options).sort((a,b) => a - b).slice(0, 3);
    }, [grandTotal]);

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
                    {/* ACCORDION WRAPPER FOR ITEMS */}
                    <Accordion type="single" collapsible defaultValue="items" className="w-full">
                        <AccordionItem value="items" className="border-none">
                            <AccordionTrigger className="p-0 hover:no-underline py-2">
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                    <ShoppingCart className="w-3 h-3" />
                                    Items in Sale ({appointmentsData.length + cart.length})
                                </h3>
                            </AccordionTrigger>
                            <AccordionContent className="pt-2 pb-4">
                                <div className="space-y-4">
                                    {/* APPOINTMENT ITEMS */}
                                    {appointmentsData.length > 0 && (
                                        <div className="space-y-2">
                                            {appointmentsData.map(data => {
                                                const { service, client, staff } = data;
                                                if (!service || !client) return null;

                                                const itemPrice = getServicePrice(service, staff);
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
                                                                ${itemPrice.toFixed(2)}
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
                                                                        ${itemPrice.toFixed(2)}
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
                                        <div className="space-y-2">
                                            {cart.map(item => (
                                                <div key={item.id} className="text-sm flex items-center gap-3 p-2 md:p-3 bg-muted/20 border rounded-xl">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-bold text-xs md:text-sm truncate">{item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}</p>
                                                        <p className="text-[9px] md:text-[10px] text-muted-foreground uppercase font-bold">{item.type}</p>
                                                    </div>
                                                    <p className="font-bold font-mono text-xs md:text-sm">${(item.price * item.quantity).toFixed(2)}</p>
                                                    <div className="flex items-center gap-1">
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8 text-destructive" onClick={() => handleUpdateQuantity(item.id, 0)}><Trash2 className="w-3.5 h-3.5"/></Button>
                                                    </div>
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
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>

                    {/* DISCOUNTS SECTION */}
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
                                            <div>
                                                <p className="text-xs font-black uppercase">{code}</p>
                                            </div>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => handleRemoveDiscount(code)}><X className="h-3.5 w-3.5" /></Button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <AnimatePresence>
                            {suggestedDiscounts.length > 0 && (
                                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 pt-1">
                                    <p className="text-[9px] font-black uppercase text-amber-600 tracking-widest flex items-center gap-1.5">
                                        <Wand2 className="h-3 w-3" /> Suggested Rewards
                                    </p>
                                    {suggestedDiscounts.map(d => (
                                        <Button 
                                            key={d.id} 
                                            variant="outline" 
                                            className="w-full justify-between h-auto py-2.5 px-3 border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/30 text-left"
                                            onClick={() => handleApplyDiscount(d.code)}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[11px] font-black uppercase text-amber-700 dark:text-amber-400">{d.code}</p>
                                                <p className="text-[10px] text-muted-foreground truncate">{d.description}</p>
                                            </div>
                                            <div className="text-right ml-2 shrink-0">
                                                <p className="text-xs font-black text-amber-700 dark:text-amber-400">
                                                    {d.type === 'percentage' ? `${d.value}%` : `$${d.value}`} OFF
                                                </p>
                                            </div>
                                        </Button>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

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
                    {totalDiscountValue > 0 && (
                        <div className="flex justify-between text-[11px] md:text-sm text-primary font-black uppercase tracking-tight">
                            <span className="flex items-center gap-1.5"><Percent className="w-3 h-3 md:w-3.5 md:h-3.5" /> Discounts Applied</span>
                            <span className="font-mono">-${totalDiscountValue.toFixed(2)}</span>
                        </div>
                    )}
                    <div className="flex justify-between text-muted-foreground font-medium text-xs md:text-sm"><p>Estimated Tax</p><p className="font-mono">${taxValue.toFixed(2)}</p></div>
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
                    <div className="flex justify-between items-baseline font-black text-2xl md:text-3xl text-primary tracking-tighter"><p className="text-[10px] md:text-sm uppercase tracking-widest text-muted-foreground">Total</p><p className="font-mono">${grandTotal.toFixed(2)}</p></div>
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
                                {changeDueValue > 0 && (
                                    <div className="space-y-1">
                                        <Label className="text-[9px] md:text-[10px] uppercase font-black tracking-widest text-green-600">Change Due</Label>
                                        <div className="h-10 md:h-12 flex items-center justify-center bg-green-500/10 border-2 border-green-500/20 rounded-xl">
                                            <p className="font-black text-lg md:text-xl text-green-600 font-mono">${changeDueValue.toFixed(2)}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-1.5 md:gap-2 overflow-x-auto pb-1 no-scrollbar">
                                {quickTenderOptions.map(val => (
                                    <Button key={val} variant="outline" size="sm" className="flex-1 font-bold h-8 md:h-9 rounded-xl text-xs md:text-sm shrink-0" onClick={() => setAmountTendered(val)}>${val}</Button>
                                ))}
                                <Button variant="outline" size="sm" className="flex-1 font-black h-8 md:h-9 rounded-xl border-primary text-primary text-xs md:text-sm shrink-0" onClick={() => setAmountTendered(grandTotal)}>Exact</Button>
                            </div>
                        </motion.div>
                    )}

                    <div className="pt-2">
                        <Button 
                            className="w-full h-14 md:h-16 text-xl md:text-2xl font-black rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95" 
                            onClick={() => onCheckout({paymentMethod: paymentTab, amountTendered})} 
                            disabled={isSubmitting || (paymentTab === 'cash' && amountTendered < grandTotal)}
                        >
                            {isSubmitting ? <Loader className="animate-spin" /> : `Collect $${grandTotal.toFixed(2)}`}
                        </Button>
                    </div>
                </div>
            </div>
            <BrowseDiscountsDialog 
                open={isDiscountBrowserOpen} 
                onOpenChange={setIsDiscountBrowserOpen} 
                allDiscounts={discounts || []} 
                onSelect={handleApplyDiscount} 
                cartServiceIds={cartServiceIds} 
            />
        </div>
    );
};