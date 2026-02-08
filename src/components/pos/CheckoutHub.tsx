

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Banknote, CreditCard, Scan, Trash2, Edit, User, Printer, UserPlus, DollarSign, Award, Loader, Gift } from 'lucide-react';
import { type Appointment, type Service, type Client, type Discount, type Staff } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import { BrowseDiscountsDialog } from '../discounts/BrowseDiscountsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Progress } from '@/components/ui/progress';

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
}) => {
    
    const [promoCode, setPromoCode] = useState('');
    const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);

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
    const subtotalAfterDiscounts = subtotal > totalDiscount ? subtotal - totalDiscount : 0;
    const mockTax = subtotalAfterDiscounts * 0.07;
    const grandTotal = subtotalAfterDiscounts + mockTax + tipAmount;
    
    const changeDue = amountTendered > 0 && paymentTab === 'cash' ? amountTendered - total : 0;
    
    const quickCashAmounts = useMemo(() => {
        if (total <= 0) return [];
        const suggestions = new Set<number>();
        // Suggest the next highest $5, $10, or $20
        suggestions.add(Math.ceil(total / 5) * 5);
        suggestions.add(Math.ceil(total / 10) * 10);
        suggestions.add(Math.ceil(total / 20) * 20);

        return Array.from(suggestions)
          .filter(amount => amount > total && amount !== Infinity)
          .sort((a,b) => a - b)
          .slice(0, 3);
    }, [total]);


    return (
        <div className="flex flex-col h-full">
            {showTitle && (
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">Current Sale</h2>
                </div>
            )}
             <div className="mb-4">
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

            <ScrollArea className="flex-1 my-4 pr-2 -mr-2">
                 {/* RETAIL ITEMS */}
                {cart.length > 0 && (
                    <div className="space-y-3">
                        {cart.map(item => (
                            <div key={item.id} className="flex items-center gap-2">
                                <p className="flex-1 text-sm">{item.quantity}x {item.name}</p>
                                <p className="font-semibold text-sm">${(item.price * item.quantity).toFixed(2)}</p>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleUpdateQuantity(item.id, 0)}><Trash2 className="w-4 h-4 text-destructive"/></Button>
                            </div>
                        ))}
                    </div>
                )}
                
                {/* SEPARATOR */}
                {cart.length > 0 && appointmentsData.length > 0 && <Separator className="my-3" />}

                {/* SERVICE ITEMS */}
                {appointmentsData.length > 0 && (
                     <div className="space-y-3">
                        {appointmentsData.map(aptData => (
                             <div key={aptData.id} className="text-sm p-2 rounded-md bg-muted/50">
                                {isGroupCheckout && (
                                    <p className="font-semibold text-xs text-muted-foreground flex items-center gap-2 mb-2 pb-2 border-b">
                                        <Avatar className="w-5 h-5"><AvatarImage src={aptData.client.avatarUrl} /><AvatarFallback>{aptData.client.name.charAt(0)}</AvatarFallback></Avatar>
                                        {aptData.client.name}
                                    </p>
                                )}
                                <div className="flex items-center gap-2">
                                    <p className="flex-1 font-medium">{aptData.service.name}</p>
                                    <p className="font-semibold">${(aptData.service.price || 0).toFixed(2)}</p>
                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onSelectAppointment(aptData.id)}><Trash2 className="w-4 h-4 text-destructive"/></Button>
                                </div>
                                {aptData.addOnServices.map(addon => (
                                    <div key={addon.id} className="flex items-center gap-2 pl-4">
                                        <p className="flex-1 text-xs text-muted-foreground">+ {addon.name}</p>
                                        <p className="font-semibold text-xs">${(addon.price || 0).toFixed(2)}</p>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </ScrollArea>

            <Separator />
            <div className="my-4 space-y-2 text-sm">
                <h3 className="font-semibold mb-2">Payment Summary</h3>
                <div className="flex justify-between"><p>Subtotal</p><p>${subtotal.toFixed(2)}</p></div>
                 {discount > 0 && (
                <div className="flex justify-between text-sm text-primary font-medium">
                    <span>Promo Code Discount:</span>
                    <span>-${discount.toFixed(2)}</span>
                </div>
                )}
                {membershipDiscount > 0 && (
                <div className="flex justify-between text-sm text-primary font-medium">
                    <span className="flex items-center gap-1.5"><Award className="w-3 h-3" />Membership Discount:</span>
                    <span>-${membershipDiscount.toFixed(2)}</span>
                </div>
                )}
                <div className="flex justify-between"><p>Tax</p><p>${tax.toFixed(2)}</p></div>
                <div className="flex justify-between text-sm items-center">
                    <p className="text-muted-foreground">Tip</p>
                    <div className="relative w-24">
                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                        type="number"
                        value={tipAmount || ''}
                        onChange={(e) =>
                            setTipAmount(parseFloat(e.target.value) || 0)
                        }
                        className="h-8 text-right pr-2 pl-7"
                        placeholder="0.00"
                        />
                    </div>
                </div>
                <Separator className="my-2" />
                <div className="flex justify-between font-bold text-lg"><p>Total Payable</p><p>${total.toFixed(2)}</p></div>
            </div>
            
            <Separator />
            <div className="mt-4">
                <h3 className="font-semibold mb-2">Payment Method</h3>
                <div className="grid grid-cols-3 gap-2">
                    <Button variant={paymentTab === 'cash' ? 'default' : 'outline'} onClick={() => setPaymentTab('cash')} className="flex-col h-16"><Banknote /><span className="mt-1">Cash</span></Button>
                    <Button variant={paymentTab === 'card' ? 'default' : 'outline'} onClick={() => setPaymentTab('card')} className="flex-col h-16"><CreditCard /><span className="mt-1">Card</span></Button>
                    <Button variant={paymentTab === 'scan' ? 'default' : 'outline'} onClick={() => setPaymentTab('scan')} className="flex-col h-16"><Scan /><span className="mt-1">Scan</span></Button>
                </div>
                {paymentTab === 'cash' && (
                    <div className="mt-4 space-y-4">
                        <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Quick Tender</Label>
                            <div className="grid grid-cols-4 gap-2">
                                <Button variant="secondary" onClick={() => setAmountTendered(total)}>Exact</Button>
                                {quickCashAmounts.map(amount => (
                                    <Button key={amount} variant="secondary" onClick={() => setAmountTendered(amount)}>
                                        ${amount}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="amount-tendered">Amount Tendered</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                <Input
                                    id="amount-tendered"
                                    type="number"
                                    placeholder="0.00"
                                    value={amountTendered || ''}
                                    onChange={(e) => setAmountTendered(parseFloat(e.target.value) || 0)}
                                    className="pl-10 text-2xl font-bold h-14 text-right pr-4"
                                />
                            </div>
                            <div className="space-y-2 pt-2">
                                <Progress value={total > 0 ? (amountTendered / total) * 100 : 0} />
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>Tendered: ${amountTendered.toFixed(2)}</span>
                                    <span>Remaining: <span className="font-medium text-foreground">${Math.max(0, total - amountTendered).toFixed(2)}</span></span>
                                </div>
                            </div>
                        </div>
                        
                        <Accordion type="single" collapsible>
                            <AccordionItem value="denominations" className="border-0">
                                <AccordionTrigger className="text-xs p-0 hover:no-underline text-muted-foreground">Add Denominations</AccordionTrigger>
                                <AccordionContent className="pt-2">
                                    <div className="space-y-3">
                                        <div>
                                            <Label className="text-xs text-muted-foreground">Bills</Label>
                                            <div className="grid grid-cols-3 gap-2 mt-1">
                                                {[100, 50, 20, 10, 5, 1].map(amount => (
                                                    <Button key={amount} variant="outline" className="h-12 text-lg" onClick={() => setAmountTendered(prev => prev + amount)}>
                                                        ${amount}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <Label className="text-xs text-muted-foreground">Coins</Label>
                                            <div className="grid grid-cols-4 gap-2 mt-1">
                                                {[0.25, 0.10, 0.05, 0.01].map(amount => (
                                                    <Button key={amount} variant="outline" className="h-12" onClick={() => setAmountTendered(prev => prev + amount)}>
                                                        {amount * 100}¢
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => setAmountTendered(0)} className="w-full text-muted-foreground">Clear Tendered</Button>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>

                        {amountTendered > total ? (
                            <Card className="bg-primary/5 border-primary/20">
                                <CardContent className="p-4 text-center">
                                    <p className="text-sm font-medium text-primary">Change Due</p>
                                    <p className="text-4xl font-bold text-primary">${changeDue > 0 ? changeDue.toFixed(2) : '0.00'}</p>
                                    {changeDue > 0 && (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            className="mt-2"
                                            onClick={() => {
                                                setTipAmount(tipAmount + changeDue);
                                                setAmountTendered(amountTendered - changeDue);
                                            }}
                                        >
                                            <Gift className="mr-2 h-4 w-4" /> Add to Tip
                                        </Button>
                                    )}
                                </CardContent>
                            </Card>
                        ) : null}
                    </div>
                )}
            </div>

            <div className="mt-auto pt-4 flex gap-2">
                <Button variant="outline" className="flex-1"><Printer /> Print</Button>
                <Button className="flex-1" onClick={() => onCheckout({paymentMethod: paymentTab, amountTendered})} disabled={isSubmitting}>
                    {isSubmitting ? <Loader className="animate-spin" /> : 'Checkout'}
                </Button>
            </div>
            <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts || []} onSelect={() => {}} cartServiceIds={cartServiceIds} />
        </div>
    );
};
