
'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { type Order, type InventoryItem } from '@/lib/data';
import { CalendarIcon, PlusCircle, Trash2, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useInventory } from '@/context/InventoryContext';
import { nanoid } from 'nanoid';
import { ImageUpload } from '../shared/ImageUpload';


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
    const [trackingUrl, setTrackingUrl] = useState('');
    const [notes, setNotes] = useState('');
    const [invoiceUrl, setInvoiceUrl] = useState('');
    const [items, setItems] = useState<OrderItem[]>([]);
    const [customItemName, setCustomItemName] = useState('');

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

    const handleAddCustomItem = () => {
        if (!customItemName.trim()) return;
        const newItem: OrderItem = {
            productId: `custom-${nanoid()}`, // Temporary unique ID for a new product
            productName: customItemName,
            quantity: 1,
            costPerUnit: 0,
        };
        setItems(prev => [...prev, newItem]);
        setCustomItemName('');
    }

    const handleItemChange = (productId: string, field: 'quantity' | 'costPerUnit', value: number) => {
        setItems(prev => prev.map(item => item.productId === productId ? { ...item, [field]: value } : item));
    }
    
    const handleRemoveItem = (productId: string) => {
        setItems(prev => prev.filter(item => item.productId !== productId));
    }

    const handleSave = () => {
        let finalTrackingUrl = trackingUrl;
        if (finalTrackingUrl && !/^https?:\/\//i.test(finalTrackingUrl)) {
            finalTrackingUrl = `https://${finalTrackingUrl}`;
        }

        const newOrder: Omit<Order, 'id'> = {
            supplier,
            orderDate: (orderDate || new Date()).toISOString(),
            status: 'Placed',
            trackingNumber,
            trackingUrl: finalTrackingUrl,
            notes,
            items: items,
            invoiceUrl,
            expectedArrivalDate: expectedDate ? expectedDate.toISOString() : undefined,
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
                            <Input
                                type="date"
                                value={orderDate ? format(orderDate, 'yyyy-MM-dd') : ''}
                                onChange={(e) => setOrderDate(e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Expected Arrival</Label>
                            <Input
                                type="date"
                                value={expectedDate ? format(expectedDate, 'yyyy-MM-dd') : ''}
                                onChange={(e) => setExpectedDate(e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined)}
                            />
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="tracking">Tracking Number</Label>
                        <Input id="tracking" value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="trackingUrl">Tracking URL</Label>
                        <Input id="trackingUrl" value={trackingUrl} onChange={e => setTrackingUrl(e.target.value)} placeholder="https://carrier.com/track/..."/>
                    </div>
                    <div>
                        <Label>Items</Label>
                        <div className="space-y-2 mt-2">
                             {items.map(item => (
                                <div key={item.productId} className="flex items-center gap-2 p-2 border rounded-md">
                                    <div className="flex-1">
                                        <p className="text-sm font-medium">{item.productName}</p>
                                    </div>
                                    <Input type="number" value={item.quantity} onChange={e => handleItemChange(item.productId, 'quantity', Number(e.target.value))} className="w-16 h-8" />
                                    <div className="relative w-24">
                                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input type="number" value={item.costPerUnit} onChange={e => handleItemChange(item.productId, 'costPerUnit', Number(e.target.value))} className="w-24 h-8 pl-7" />
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveItem(item.productId)}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                            <Input
                                placeholder="Add a new product by name..."
                                value={customItemName}
                                onChange={(e) => setCustomItemName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddCustomItem()}
                            />
                            <Button variant="outline" size="sm" type="button" onClick={handleAddCustomItem}>Add New</Button>
                        </div>
                        <Button variant="outline" className="mt-2 w-full" type="button" onClick={() => setIsProductBrowserOpen(true)}><PlusCircle className="mr-2"/>Add from Inventory</Button>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="invoice">Invoice/Receipt</Label>
                        <ImageUpload onImageUploaded={setInvoiceUrl} />
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
