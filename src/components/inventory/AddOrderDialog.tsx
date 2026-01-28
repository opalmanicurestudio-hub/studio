
'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { type Order, type InventoryItem } from '@/lib/data';
import { CalendarIcon, PlusCircle, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useInventory } from '@/context/InventoryContext';

interface AddOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (orderData: Omit<Order, 'id'>) => void;
}

type OrderItem = {
    productId: string;
    productName: string;
    quantity: number;
    costPerUnit: number;
};

export const AddOrderDialog: React.FC<AddOrderDialogProps> = ({
  open,
  onOpenChange,
  onSave,
}) => {
    const { inventory: products } = useInventory();
    const [supplier, setSupplier] = useState('');
    const [orderDate, setOrderDate] = useState<Date | undefined>(new Date());
    const [expectedDate, setExpectedDate] = useState<Date | undefined>();
    const [trackingNumber, setTrackingNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [items, setItems] = useState<OrderItem[]>([]);

    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    
    const handleAddProducts = (selectedProducts: InventoryItem[]) => {
        const newItems = selectedProducts.map(p => ({
            productId: p.id,
            productName: p.name,
            quantity: 1,
            costPerUnit: p.costPerUnit || 0
        }));
        setItems(prev => [...prev, ...newItems.filter(newItem => !prev.find(item => item.productId === newItem.productId))]);
    };

    const handleItemChange = (productId: string, field: 'quantity' | 'costPerUnit', value: number) => {
        setItems(prev => prev.map(item => item.productId === productId ? { ...item, [field]: value } : item));
    }
    
    const handleRemoveItem = (productId: string) => {
        setItems(prev => prev.filter(item => item.productId !== productId));
    }

    const handleSave = () => {
        const newOrder: Omit<Order, 'id' | 'status'> = {
            supplier,
            orderDate: (orderDate || new Date()).toISOString(),
            expectedArrivalDate: expectedDate?.toISOString(),
            status: 'Draft',
            trackingNumber,
            notes,
            items,
        };
        onSave(newOrder);
        onOpenChange(false);
    };

    return (
        <>
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Create New Purchase Order</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
                    <div className="space-y-2">
                        <Label htmlFor="supplier">Supplier</Label>
                        <Input id="supplier" value={supplier} onChange={e => setSupplier(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                             <Label>Order Date</Label>
                            <Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start font-normal">{orderDate ? format(orderDate, 'PPP') : 'Select date'}</Button></PopoverTrigger><PopoverContent><Calendar mode="single" selected={orderDate} onSelect={setOrderDate} /></PopoverContent></Popover>
                        </div>
                        <div className="space-y-2">
                            <Label>Expected Arrival</Label>
                            <Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start font-normal">{expectedDate ? format(expectedDate, 'PPP') : 'Select date'}</Button></PopoverTrigger><PopoverContent><Calendar mode="single" selected={expectedDate} onSelect={setExpectedDate} /></PopoverContent></Popover>
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="tracking">Tracking Number</Label>
                        <Input id="tracking" value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} />
                    </div>
                    <div>
                        <Label>Items</Label>
                        <div className="space-y-2 mt-2">
                             {items.map(item => (
                                <div key={item.productId} className="flex items-center gap-2 p-2 border rounded-md">
                                    <span className="flex-1 text-sm font-medium">{item.productName}</span>
                                    <Input type="number" value={item.quantity} onChange={e => handleItemChange(item.productId, 'quantity', Number(e.target.value))} className="w-16 h-8" />
                                    <Input type="number" value={item.costPerUnit} onChange={e => handleItemChange(item.productId, 'costPerUnit', Number(e.target.value))} className="w-20 h-8" />
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveItem(item.productId)}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                            ))}
                        </div>
                        <Button variant="outline" className="mt-2 w-full" type="button" onClick={() => setIsProductBrowserOpen(true)}><PlusCircle className="mr-2"/>Add Items</Button>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="notes">Notes</Label>
                        <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSave}>Save Order</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <BrowseProductsDialog
            open={isProductBrowserOpen}
            onOpenChange={setIsProductBrowserOpen}
            onSelect={handleAddProducts}
            allProducts={products}
            initialSelected={[]}
        />
        </>
    );
};
