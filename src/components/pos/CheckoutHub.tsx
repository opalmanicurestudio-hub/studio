'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Banknote, CreditCard, Scan, Trash2, Edit, User, Printer, UserPlus, DollarSign, Award, Loader, Gift, AlertTriangle, Repeat, CheckCircle, Percent } from 'lucide-react';
import { type Appointment, type Service, type Client, type Discount, type Staff, Membership, Package } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import { BrowseDiscountsDialog } from '../discounts/BrowseDiscountsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { Switch } from '../ui/switch';
import { Checkbox } from '../ui/checkbox';
import { useToast } from '@/hooks/use-toast';


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
    redeemedOffer: { type: 'membership' | 'package'; id: string } | null;
    setRedeemedOffer: (offer: { type: 'membership' | 'package'; id: string } | null) => void;
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
        if (total === 0) return [];
    
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
                <div className="flex justify-between items-center mb-4 flex-shrink-0">
                    <h2 className="text-xl font-bold">Current Sale</h2>
                </div>
            )}
             <div className="mb-4 flex-shrink-0">
                <Label>{isGroupCheckout ? "Primary Payer" : "Client"}</Label>
                <div className="flex gap-2 mt-2">
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
                        <SelectTrigger>
                            <SelectValue placeholder={isGroupCheckout ? "Select a primary payer" : "Walk-in Customer"} />
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
                    <Button variant="outline" size="icon" onClick={onAddClientClick}><UserPlus className="w-4 h-4" /></Button>
                    <Button variant="outline" size="icon" onClick={onScanClick}><Scan className="w-4 h-4" /></Button>
                </div>
                {selectedClient && (
                    <div className="mt-2 text-sm text-muted-foreground">
                        Paying as: <span className="font-semibold text-foreground">{selectedClient.name}</span>
                    </div>
                )}
            </div>

            <Separator />

            <ScrollArea className="flex-1 min-h-0 my-4 pr-2 -mr-2">
                <div className="space-y-6">
                    {/* APPOINTMENT ITEMS */}
                    {appointmentsData.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Services</h3>
                            {appointmentsData.map(data => {
                                const { service, client } = data;
                                if (!service || !client) return null;

                                const isRedeemed = redeemedOffer?.id === service.id;

                                const membershipPerk = client.activeMembershipId && memberships.find(m => m.id === client.activeMembershipId)?.includedServices?.find(s => s.id === service.id);
                                
                                const packagePerk = client.activePackages?.find(p => {
                                    const packageDetails = packages.find(pkg => pkg.id === p.packageId);
                                    return packageDetails?.serviceId === service.id && p.sessionsRemaining > 0;
                                });

                                const hasPerk = !!membershipPerk || !!packagePerk;
                                
                                const handleRedeem = () => {
                                    if (isRedeemed) {
                                        setRedeemedOffer(null);
                                    } else if (redeemedOffer) {
                                        toast({ variant: 'destructive', title: 'Only one offer can be redeemed per transaction.' });
                                    } else {
                                        setRedeemedOffer({ type: packagePerk ? 'package' : 'membership', id: service.id });
                                    }
                                };
                                
                                if (!hasPerk) {
                                    return (
                                        <div key={data.id} className="text-sm flex items-center gap-3 p-2 bg-muted/30 rounded-lg">
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">
                                                    {service.name}
                                                </p>
                                                {isGroupCheckout && <p className="text-[10px] text-muted-foreground">for {client.name}</p>}
                                            </div>
                                            <p className="font-semibold">
                                                ${(service.price || 0).toFixed(2)}
                                            </p>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onSelectAppointment(data.id)}><Trash2 className="w-4 h-4"/></Button>
                                        </div>
                                    )
                                }
                            
                                return (
                                    <Card key={data.id} className={cn("overflow-hidden", isRedeemed ? "bg-primary/5 border-primary/20 shadow-sm" : "")}>
                                        <CardContent className="p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-sm truncate">
                                                        {service.name}
                                                    </p>
                                                    {isGroupCheckout && <p className="text-[10px] text-muted-foreground">for {client.name}</p>}
                                                    <p className={cn("text-sm font-bold mt-1", isRedeemed ? "line-through text-muted-foreground" : "text-primary")}>
                                                        ${(service.price || 0).toFixed(2)}
                                                    </p>
                                                </div>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" onClick={() => onSelectAppointment(data.id)}><Trash2 className="w-4 h-4" /></Button>
                                            </div>

                                            {isRedeemed ? (
                                                <div className="mt-2 p-2 rounded-md bg-green-500/10 text-green-700 dark:text-green-300 flex items-center justify-between border border-green-500/20">
                                                    <div className="flex items-center gap-2 text-xs font-bold">
                                                        <CheckCircle className="w-3.5 h-3.5" />
                                                        Perk Applied
                                                    </div>
                                                    <Button variant="ghost" size="xs" onClick={handleRedeem} className="h-6 px-2 text-xs hover:bg-green-500/20 text-green-700 dark:text-green-300">Undo</Button>
                                                </div>
                                            ) : (
                                                <div className="mt-2">
                                                    <Button variant="secondary" size="sm" className="w-full text-xs h-8" onClick={handleRedeem}>
                                                        {membershipPerk && <><Award className="w-3.5 h-3.5 mr-1.5 text-indigo-500"/>Redeem Monthly Perk</>}
                                                        {packagePerk && <><Repeat className="w-3.5 h-3.5 mr-1.5 text-teal-500"/>Use 1 Session ({packagePerk.sessionsRemaining} left)</>}
                                                    </Button>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>
                    )}

                    {/* RETAIL & MANUAL SERVICE ITEMS */}
                    {cart.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Retail & Products</h3>
                            {cart.map(item => (
                                <div key={item.id} className="text-sm flex items-center gap-3 p-2 bg-muted/30 rounded-lg">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}</p>
                                        <p className="text-[10px] text-muted-foreground capitalize">{item.type}</p>
                                    </div>
                                    <p className="font-semibold">${(item.price * item.quantity).toFixed(2)}</p>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleUpdateQuantity(item.id, 0)}><Trash2 className="w-4 h-4"/></Button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* SERVICE ADJUSTMENTS */}
                    {(adjustments && adjustments.length > 0) && (
                        <div className="space-y-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Adjustments</h3>
                            <Card className="bg-amber-500/10 border-amber-500/20 border-2">
                                <CardHeader className="p-3 pb-2">
                                    <CardTitle className="text-sm flex items-center gap-2">
                                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                                        Performance Review
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-3 pt-0 space-y-2">
                                    {adjustments.map(adj => (
                                        <div key={adj.id} className="flex items-start gap-3 p-2 rounded-md bg-background/50 border border-amber-500/10">
                                            <Checkbox 
                                                id={`adj-${adj.id}`}
                                                checked={appliedAdjustments.has(adj.id)}
                                                onCheckedChange={(checked) => onApplyAdjustmentToggle(adj.id, !!checked)}
                                                className="mt-1"
                                            />
                                            <div className="flex-1 min-w-0 space-y-0.5">
                                                <Label htmlFor={`adj-${adj.id}`} className="text-xs font-bold leading-tight block truncate">
                                                    {adj.description}
                                                </Label>
                                                <p className="text-[10px] text-muted-foreground truncate">{adj.clientName} &middot; {adj.serviceName}</p>
                                            </div>
                                            <p className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">+${adj.cost.toFixed(2)}</p>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </div>
            </ScrollArea>
            
            <div className="flex-shrink-0 pt-4 border-t bg-card">
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-muted-foreground"><p>Subtotal</p><p>${subtotal.toFixed(2)}</p></div>
                    {totalDiscount > 0 && (
                        <div className="flex justify-between text-sm text-primary font-bold">
                            <span className="flex items-center gap-1.5"><Percent className="w-3.5 h-3.5" /> Discounts Applied</span>
                            <span>-${totalDiscount.toFixed(2)}</span>
                        </div>
                    )}
                    <div className="flex justify-between text-muted-foreground"><p>Tax</p><p>${tax.toFixed(2)}</p></div>
                    <div className="flex justify-between text-sm items-center py-1">
                        <p className="font-medium">Gratuity</p>
                        <div className="relative w-28">
                            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="number"
                                value={tipAmount || ''}
                                onChange={(e) => setTipAmount(parseFloat(e.target.value) || 0)}
                                className="h-9 text-right pr-3 pl-7 font-bold"
                                placeholder="0.00"
                            />
                        </div>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between font-extrabold text-2xl text-primary"><p>Total</p><p>${total.toFixed(2)}</p></div>
                </div>
                
                <div className="mt-6 space-y-4">
                    <RadioGroup value={paymentTab} onValueChange={setPaymentTab} className="grid grid-cols-3 gap-2">
                        <div>
                            <RadioGroupItem value="cash" id="pay-cash" className="peer sr-only" />
                            <Label htmlFor="pay-cash" className="flex flex-col items-center justify-center rounded-xl border-2 border-muted bg-popover p-3 text-xs hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all">
                                <Banknote className="mb-1 h-5 w-5" />Cash
                            </Label>
                        </div>
                        <div>
                            <RadioGroupItem value="card" id="pay-card" className="peer sr-only" />
                            <Label htmlFor="pay-card" className="flex flex-col items-center justify-center rounded-xl border-2 border-muted bg-popover p-3 text-xs hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all">
                                <CreditCard className="mb-1 h-5 w-5" />Card
                            </Label>
                        </div>
                        <div>
                            <RadioGroupItem value="scan" id="pay-scan" className="peer sr-only" />
                            <Label htmlFor="pay-scan" className="flex flex-col items-center justify-center rounded-xl border-2 border-muted bg-popover p-3 text-xs hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all">
                                <Scan className="mb-1 h-5 w-5" />Scan
                            </Label>
                        </div>
                    </RadioGroup>

                    {paymentTab === 'cash' && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3 overflow-hidden">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tendered</Label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            type="number"
                                            value={amountTendered || ''}
                                            onChange={(e) => setAmountTendered(parseFloat(e.target.value) || 0)}
                                            className="pl-8 h-10 font-bold text-lg"
                                        />
                                    </div>
                                </div>
                                {changeDue > 0 && (
                                    <div className="space-y-1.5">
                                        <Label className="text-[10px] uppercase font-bold text-green-600">Change Due</Label>
                                        <div className="h-10 flex items-center justify-center bg-green-500/10 border border-green-500/20 rounded-md">
                                            <p className="font-bold text-lg text-green-600">${changeDue.toFixed(2)}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2">
                                {quickTenderOptions.map(val => (
                                    <Button key={val} variant="outline" size="sm" className="flex-1" onClick={() => setAmountTendered(val)}>${val}</Button>
                                ))}
                                <Button variant="outline" size="sm" className="flex-1 font-bold" onClick={() => setAmountTendered(total)}>Exact</Button>
                            </div>
                        </motion.div>
                    )}

                    <Button 
                        className="w-full h-14 text-xl font-bold rounded-2xl shadow-xl shadow-primary/20" 
                        onClick={() => onCheckout({paymentMethod: paymentTab, amountTendered})} 
                        disabled={isSubmitting || (paymentTab === 'cash' && amountTendered < total)}
                    >
                        {isSubmitting ? <Loader className="animate-spin" /> : `Collect $${total.toFixed(2)}`}
                    </Button>
                </div>
            </div>
            <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts || []} onSelect={(code) => { setPromoCode(code); }} cartServiceIds={cartServiceIds} />
        </div>
    );
};
