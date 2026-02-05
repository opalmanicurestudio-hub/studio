
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Banknote, CreditCard, Scan, Trash2, Edit, User, Printer } from 'lucide-react';
import { type Appointment, type Service } from '@/lib/data';

export const CheckoutHub = ({ order, cart, onCartChange }: { order: Appointment | null, cart: any[], onCartChange: (cart: any[]) => void }) => {
    const [subtotal, setSubtotal] = useState(0);
    const [tax, setTax] = useState(0);
    const [donation, setDonation] = useState(1.00);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        const currentSubtotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        const currentTax = currentSubtotal * 0.06; // 6% tax
        setSubtotal(currentSubtotal);
        setTax(currentTax);
        setTotal(currentSubtotal + currentTax + donation);
    }, [cart, donation]);

    const handleUpdateQuantity = (itemId: string, newQuantity: number) => {
        if (newQuantity <= 0) {
            onCartChange(cart.filter(item => item.id !== itemId));
        } else {
            onCartChange(cart.map(item => item.id === itemId ? { ...item, quantity: newQuantity } : item));
        }
    };
    
    return (
        <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">{order ? `Order #${order.id.slice(-5).toUpperCase()}`: "New Sale"}</h2>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon"><User className="w-5 h-5"/></Button>
                    <p className="text-sm font-medium">{order ? order.clientName : "Walk-in"}</p>
                </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">Staff: {order?.staffId ? 'Brenda' : 'N/A'}</p>
            <Separator />

            <div className="flex-1 my-4 overflow-y-auto pr-2 -mr-2">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold">Ordered Items</h3>
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
            </div>

            <Separator />
            <div className="my-4 space-y-2 text-sm">
                <h3 className="font-semibold mb-2">Payment Summary</h3>
                <div className="flex justify-between"><p>Subtotal</p><p>${subtotal.toFixed(2)}</p></div>
                <div className="flex justify-between"><p>Tax</p><p>${tax.toFixed(2)}</p></div>
                <div className="flex justify-between"><p>Donation</p><p>${donation.toFixed(2)}</p></div>
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
