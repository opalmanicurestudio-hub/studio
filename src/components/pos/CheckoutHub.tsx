'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Banknote, CreditCard, Scan, Trash2, Edit, User, Printer, UserPlus, DollarSign } from 'lucide-react';
import { type Appointment, type Service, type Client } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';

export const CheckoutHub = ({ 
    cart, 
    onCartChange,
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
    showTitle = true,
}: { 
    cart: any[], 
    onCartChange: (cart: any[]) => void,
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
    setTipAmount: (amount: number) => void,
    showTitle?: boolean,
}) => {
    
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
                <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold">Items</h3>
                    <p className="text-sm font-medium">{cart.reduce((acc, item) => acc + item.quantity, 0)}</p>
                </div>
                <div className="space-y-3">
                    {cart.map(item => (
                        <div key={item.id} className="flex items-center gap-2">
                            <p className="flex-1 text-sm">{item.quantity}x {item.name}</p>
                            <p className="font-semibold text-sm">${(item.price * item.quantity).toFixed(2)}</p>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleUpdateQuantity(item.id, 0)}><Trash2 className="w-4 h-4 text-destructive"/></Button>
                        </div>
                    ))}
                </div>
            </ScrollArea>

            <Separator />
            <div className="my-4 space-y-2 text-sm">
                <h3 className="font-semibold mb-2">Payment Summary</h3>
                <div className="flex justify-between"><p>Subtotal</p><p>${subtotal.toFixed(2)}</p></div>
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
                    <Button variant="outline" className="flex-col h-16"><Banknote /><span className="mt-1">Cash</span></Button>
                    <Button variant="outline" className="flex-col h-16 ring-2 ring-primary"><CreditCard /><span className="mt-1">Card</span></Button>
                    <Button variant="outline" className="flex-col h-16"><Scan /><span className="mt-1">Scan</span></Button>
                </div>
            </div>

            <div className="mt-auto pt-4 flex gap-2">
                <Button variant="outline" className="flex-1"><Printer /> Print</Button>
                <Button className="flex-1">Place Order</Button>
            </div>
        </div>
    );
};