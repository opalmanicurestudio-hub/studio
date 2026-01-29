
'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { type Order, type InventoryItem } from '@/lib/data';
import { CalendarIcon, Truck, FileImage } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ImageUpload } from '../shared/ImageUpload';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const ViewOrEditOrderDialog = ({ order, open, onOpenChange, onSave, onCancelOrder, onTrack }: { order: Order | null, open: boolean, onOpenChange: (open: boolean) => void, onSave: (order: Order) => void, onCancelOrder: (orderId: string) => void, onTrack: (e: React.MouseEvent, url?: string) => void }) => {
    const [editableOrder, setEditableOrder] = useState<Order | null>(order);
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
        setEditableOrder(order);
        if (!open) {
            setIsEditing(false);
        }
    }, [order, open]);

    const handleSave = () => {
        if (editableOrder) {
            onSave(editableOrder);
        }
        setIsEditing(false);
    }
    
    const handleCancel = () => {
        if (editableOrder) {
            onCancelOrder(editableOrder.id);
            onOpenChange(false);
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setEditableOrder(prev => prev ? ({ ...prev, [name]: value }) : null);
    };

    const handleDateChange = (date: Date | undefined, field: 'orderDate' | 'expectedArrivalDate') => {
        setEditableOrder(prev => prev ? ({...prev, [field]: date?.toISOString()}) : null)
    }
    
    const handleItemChange = (productId: string, field: 'quantity' | 'costPerUnit', value: number) => {
        setEditableOrder(prev => prev ? ({
            ...prev,
            items: prev.items.map(item => item.productId === productId ? { ...item, [field]: value } : item)
        }) : null);
    }

    if (!editableOrder) return null;

    const totalCost = editableOrder.items.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <div className="flex justify-between items-start">
                        <div>
                            <DialogTitle>Order from {editableOrder.supplier}</DialogTitle>
                            <DialogDescription>
                                Order ID: {editableOrder.id.slice(-6).toUpperCase()}
                            </DialogDescription>
                        </div>
                        <Badge variant="secondary">{editableOrder.status}</Badge>
                    </div>
                </DialogHeader>
                 <div className="py-4 max-h-[60vh] overflow-y-auto pr-4 -mr-4">
                     <div className="space-y-4">
                        {isEditing ? (
                            <div className="space-y-4">
                                <div className="space-y-2"><Label htmlFor="edit-supplier">Supplier</Label><Input id="edit-supplier" value={editableOrder.supplier} onChange={handleChange} name="supplier" /></div>
                                <div className="space-y-2">
                                    <Label>Payment Method</Label>
                                    <RadioGroup value={editableOrder.paymentContext || 'Business'} onValueChange={(v: any) => setEditableOrder(prev => prev ? ({...prev, paymentContext: v}) : null)} className="grid grid-cols-2 gap-2">
                                        <div><RadioGroupItem value="Business" id="business-order-edit" className="peer sr-only" /><Label htmlFor="business-order-edit" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Business</Label></div>
                                        <div><RadioGroupItem value="Personal" id="personal-order-edit" className="peer sr-only" /><Label htmlFor="personal-order-edit" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Personal</Label></div>
                                    </RadioGroup>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2"><Label htmlFor="paymentMethod-edit">Account</Label><Select value={editableOrder.paymentMethod || ''} onValueChange={(v) => setEditableOrder(prev => prev ? ({...prev, paymentMethod: v}) : null)}><SelectTrigger id="paymentMethod-edit"><SelectValue placeholder="Select an account" /></SelectTrigger><SelectContent><SelectItem value="Checking">Checking</SelectItem><SelectItem value="Credit Card">Credit Card</SelectItem><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></div>
                                    <div className="space-y-2"><Label htmlFor="paymentMethodIdentifier-edit">Identifier</Label><Input id="paymentMethodIdentifier-edit" placeholder="e.g., Chase ****1234" value={editableOrder.paymentMethodIdentifier || ''} onChange={e => setEditableOrder(prev => prev ? ({...prev, paymentMethodIdentifier: e.target.value}) : null)} /></div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2"><Label>Order Date</Label><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start font-normal">{editableOrder.orderDate ? format(parseISO(editableOrder.orderDate), 'PPP') : 'Select date'}</Button></PopoverTrigger><PopoverContent><Calendar mode="single" selected={parseISO(editableOrder.orderDate)} onSelect={(d) => handleDateChange(d, 'orderDate')} /></PopoverContent></Popover></div>
                                    <div className="space-y-2"><Label>Expected Arrival</Label><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start font-normal">{editableOrder.expectedArrivalDate ? format(parseISO(editableOrder.expectedArrivalDate), 'PPP') : 'Select date'}</Button></PopoverTrigger><PopoverContent><Calendar mode="single" selected={editableOrder.expectedArrivalDate ? parseISO(editableOrder.expectedArrivalDate) : undefined} onSelect={(d) => handleDateChange(d, 'expectedArrivalDate')} /></PopoverContent></Popover></div>
                                </div>
                                <div className="space-y-2"><Label htmlFor="edit-trackingNumber">Tracking Number</Label><Input id="edit-trackingNumber" value={editableOrder.trackingNumber || ''} onChange={handleChange} name="trackingNumber" /></div>
                                <div className="space-y-2"><Label htmlFor="edit-trackingUrl">Tracking URL</Label><Input id="edit-trackingUrl" value={editableOrder.trackingUrl || ''} onChange={handleChange} name="trackingUrl" placeholder="https://carrier.com/track/..."/></div>
                                 <div className="space-y-2"><Label>Items</Label><div className="space-y-2">{editableOrder.items.map(item => (<div key={item.productId} className="flex items-center gap-2 p-2 border rounded-md"><span className="flex-1 text-sm font-medium">{item.productName}</span><Input type="number" value={item.quantity} onChange={e => handleItemChange(item.productId, 'quantity', Number(e.target.value))} className="w-16 h-8" /><Input type="number" value={item.costPerUnit} onChange={e => handleItemChange(item.productId, 'costPerUnit', Number(e.target.value))} className="w-20 h-8" /></div>))}</div></div>
                                <div className="space-y-2">
                                    <Label>Invoice/Receipt</Label>
                                    <ImageUpload
                                        onImageUploaded={(url) => setEditableOrder(prev => prev ? ({...prev, invoiceUrl: url}) : null)}
                                        initialImage={editableOrder.invoiceUrl}
                                    />
                                </div>
                                <div className="space-y-2"><Label htmlFor="edit-notes">Notes</Label><Textarea id="edit-notes" value={editableOrder.notes || ''} onChange={handleChange} name="notes" /></div>
                            </div>
                        ) : (
                             <div className="space-y-4">
                                <p><strong>Items:</strong></p>
                                <div className="space-y-2 border rounded-md p-2">
                                {editableOrder.items.map(item => (
                                    <div key={item.productId} className="flex justify-between items-center p-2 hover:bg-muted/50 rounded-md">
                                        <div>
                                            <p className="font-medium">{item.productName}</p>
                                            <p className="text-xs text-muted-foreground">{item.quantity} units @ ${item.costPerUnit.toFixed(2)}/unit</p>
                                        </div>
                                        <p className="font-semibold">${(item.quantity * item.costPerUnit).toFixed(2)}</p>
                                    </div>
                                ))}
                                <div className="flex justify-between font-bold text-lg pt-2 border-t">
                                    <span>Total Cost</span>
                                    <span>${totalCost.toFixed(2)}</span>
                                </div>
                                </div>
                                <div className="text-sm space-y-2">
                                     <Button
                                        variant="link"
                                        size="xs"
                                        className="p-0 h-auto"
                                        onClick={(e) => onTrack(e, editableOrder.trackingUrl)}
                                    >
                                        <Truck className="w-4 h-4 text-muted-foreground mr-2"/>
                                        Track
                                    </Button>
                                    {editableOrder.expectedArrivalDate && <p><strong>Expected Arrival:</strong> {format(parseISO(editableOrder.expectedArrivalDate), 'MMM d, yyyy')}</p>}
                                    {editableOrder.paymentMethod && <p><strong>Paid with:</strong> {editableOrder.paymentContext} {editableOrder.paymentMethod} {editableOrder.paymentMethodIdentifier && `(****${editableOrder.paymentMethodIdentifier.slice(-4)})`}</p>}
                                    {editableOrder.invoiceUrl && (
                                        <div className="flex items-center gap-2">
                                            <FileImage className="w-4 h-4 text-muted-foreground" />
                                            <a href={editableOrder.invoiceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">View Attached File</a>
                                        </div>
                                    )}
                                    {editableOrder.notes && <p><strong>Notes:</strong> {editableOrder.notes}</p>}
                                </div>
                            </div>
                        )}
                     </div>
                </div>
                <DialogFooter>
                    {isEditing ? (
                        <>
                            <Button variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
                            <Button onClick={handleSave}>Save Changes</Button>
                        </>
                    ) : (
                        <>
                            <Button variant="destructive" onClick={handleCancel} disabled={editableOrder.status === 'Cancelled'}>Cancel Order</Button>
                            <div className="flex-1" />
                            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                            <Button onClick={() => setIsEditing(true)}>Edit Order</Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
