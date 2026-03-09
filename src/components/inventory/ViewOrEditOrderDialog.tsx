'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { type Order, type InventoryItem } from '@/lib/data';
import { CalendarIcon, Truck, FileImage, DollarSign, Eye, PackageOpen } from 'lucide-react';
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
                     <div className="space-y-4 text-left">
                        {isEditing ? (
                            <div className="space-y-4">
                                <div className="space-y-2"><Label htmlFor="edit-supplier-manual">Supplier</Label><Input id="edit-supplier-manual" value={editableOrder.supplier} onChange={handleChange} name="supplier" /></div>
                                <div className="space-y-2">
                                    <Label>Payment Method</Label>
                                    <RadioGroup value={editableOrder.paymentContext || 'Business'} onValueChange={(v: any) => setEditableOrder(prev => prev ? ({...prev, paymentContext: v}) : null)} className="grid grid-cols-2 gap-2">
                                        <div><RadioGroupItem value="Business" id="business-order-edit-manual" className="peer sr-only" /><Label htmlFor="business-order-edit-manual" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Business</Label></div>
                                        <div><RadioGroupItem value="Personal" id="personal-order-edit-manual" className="peer sr-only" /><Label htmlFor="personal-order-edit-manual" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Personal</Label></div>
                                    </RadioGroup>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2"><Label htmlFor="paymentMethod-edit-manual">Account</Label><Select value={editableOrder.paymentMethod || ''} onValueChange={(v) => setEditableOrder(prev => prev ? ({...prev, paymentMethod: v}) : null)}><SelectTrigger id="paymentMethod-edit-manual"><SelectValue placeholder="Select an account" /></SelectTrigger><SelectContent><SelectItem value="Checking">Checking</SelectItem><SelectItem value="Credit Card">Credit Card</SelectItem><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></div>
                                    <div className="space-y-2"><Label htmlFor="paymentMethodIdentifier-edit-manual">Identifier</Label><Input id="paymentMethodIdentifier-edit-manual" placeholder="e.g., Chase ****1234" value={editableOrder.paymentMethodIdentifier || ''} onChange={e => setEditableOrder(prev => prev ? ({...prev, paymentMethodIdentifier: e.target.value}) : null)} /></div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Order Date</Label>
                                        <Input
                                            type="date"
                                            value={editableOrder.orderDate ? format(parseISO(editableOrder.orderDate), 'yyyy-MM-dd') : ''}
                                            onChange={(e) => handleDateChange(e.target.value ? new Date(e.target.value) : undefined, 'orderDate')}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Expected Arrival</Label>
                                        <Input
                                            type="date"
                                            value={editableOrder.expectedArrivalDate ? format(parseISO(editableOrder.expectedArrivalDate), 'yyyy-MM-dd') : ''}
                                            onChange={(e) => handleDateChange(e.target.value ? new Date(e.target.value) : undefined, 'expectedArrivalDate')}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2"><Label htmlFor="edit-trackingNumber-manual">Tracking Number</Label><Input id="edit-trackingNumber-manual" value={editableOrder.trackingNumber || ''} onChange={handleChange} name="trackingNumber" /></div>
                                <div className="space-y-2"><Label htmlFor="edit-trackingUrl-manual">Tracking URL</Label><Input id="edit-trackingUrl-manual" value={editableOrder.trackingUrl || ''} onChange={handleChange} name="trackingUrl" placeholder="https://carrier.com/track/..."/></div>
                                 <div className="space-y-2"><Label>Items</Label><div className="space-y-2">{editableOrder.items.map(item => (<div key={item.productId} className="flex items-center gap-2 p-2 border rounded-md"><span className="flex-1 text-sm font-medium">{item.productName}</span><Input type="number" value={item.quantity} onChange={e => handleItemChange(item.productId, 'quantity', Number(e.target.value))} className="w-16 h-8 text-center" /><div className="relative w-24"><DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40"/><Input type="number" value={item.costPerUnit} onChange={e => handleItemChange(item.productId, 'costPerUnit', Number(e.target.value))} className="h-8 pl-6 text-center" /></div></div>))}</div></div>
                                <div className="space-y-2">
                                    <Label>Invoice/Receipt</Label>
                                    <ImageUpload
                                        onImageUploaded={(url) => setEditableOrder(prev => prev ? ({...prev, invoiceUrl: url}) : null)}
                                        initialImage={editableOrder.invoiceUrl}
                                    />
                                </div>
                                <div className="space-y-2"><Label htmlFor="edit-notes-manual">Notes</Label><Textarea id="edit-notes-manual" value={editableOrder.notes || ''} onChange={handleChange} name="notes" /></div>
                            </div>
                        ) : (
                             <div className="space-y-4">
                                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Itemized manifest</p>
                                <div className="space-y-2 border-2 rounded-2xl p-3 bg-muted/5 shadow-inner">
                                {editableOrder.items.map(item => (
                                    <div key={item.productId} className="flex justify-between items-center p-2 hover:bg-white hover:shadow-sm rounded-xl transition-all">
                                        <div className="min-w-0">
                                            <p className="font-black text-xs uppercase tracking-tight text-slate-900 truncate">{item.productName}</p>
                                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{item.quantity} units @ ${item.costPerUnit.toFixed(2)}/unit</p>
                                        </div>
                                        <p className="font-black font-mono text-sm tracking-tighter text-slate-900 ml-4">${(item.quantity * item.costPerUnit).toFixed(2)}</p>
                                    </div>
                                ))}
                                <div className="flex justify-between font-black text-lg pt-3 mt-1 border-t border-dashed border-primary/20 text-primary tracking-tighter">
                                    <span className="text-[10px] uppercase tracking-widest">Total Investment</span>
                                    <span>${totalCost.toFixed(2)}</span>
                                </div>
                                </div>
                                <div className="text-xs space-y-3 pt-2">
                                     <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-10 rounded-xl border-2 w-full justify-start font-bold uppercase text-[10px] tracking-widest bg-white shadow-sm"
                                        onClick={(e) => onTrack(e, editableOrder.trackingUrl)}
                                    >
                                        <Truck className="w-4 h-4 text-primary mr-2"/>
                                        Track Delivery
                                    </Button>
                                    {editableOrder.expectedArrivalDate && <div className="flex justify-between text-[10px] font-bold uppercase"><span className="text-muted-foreground opacity-60">Est. Arrival</span><span className="text-slate-900">{format(parseISO(editableOrder.expectedArrivalDate), 'MMM d, yyyy')}</span></div>}
                                    {editableOrder.paymentMethod && <div className="flex justify-between text-[10px] font-bold uppercase"><span className="text-muted-foreground opacity-60">Payer Account</span><span className="text-slate-900">{editableOrder.paymentContext} {editableOrder.paymentMethod}</span></div>}
                                    {editableOrder.invoiceUrl && (
                                        <a href={editableOrder.invoiceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-xl border-2 bg-primary/5 text-primary hover:bg-primary/10 transition-all">
                                            <FileImage className="w-4 h-4" />
                                            <span className="font-black uppercase text-[9px] tracking-widest">View Digital Manifest</span>
                                        </a>
                                    )}
                                    {editableOrder.notes && (
                                        <div className="p-3 rounded-xl bg-muted/20 border-2 italic text-slate-600 leading-relaxed">
                                            "{editableOrder.notes}"
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                     </div>
                </div>
                <DialogFooter className="p-6 pt-4 border-t bg-muted/5">
                    {isEditing ? (
                        <div className="grid grid-cols-2 gap-3 w-full">
                            <Button variant="ghost" onClick={() => setIsEditing(false)} className="h-12 font-black uppercase text-[10px] tracking-widest text-slate-400">Cancel</Button>
                            <Button onClick={handleSave} className="h-12 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">Commit Changes</Button>
                        </div>
                    ) : (
                        <div className="flex flex-col sm:flex-row gap-2 w-full">
                            <Button variant="outline" onClick={handleCancel} disabled={editableOrder.status === 'Cancelled'} className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest text-destructive hover:bg-destructive/5 border-destructive/20">Terminate Order</Button>
                            <div className="flex-1" />
                            <Button variant="outline" onClick={() => onOpenChange(false)} className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-white">Close</Button>
                            <Button onClick={() => setIsEditing(true)} className="h-12 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">Modify Manifest</Button>
                        </div>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default ViewOrEditOrderDialog;