

'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';


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
    
    // New state for landed cost calculation
    const [shippingCost, setShippingCost] = useState(0);
    const [taxCost, setTaxCost] = useState(0);
    const [discounts, setDiscounts] = useState(0);

    const [paymentContext, setPaymentContext] = useState<'Business' | 'Personal'>('Business');
    const [paymentMethod, setPaymentMethod] = useState('');
    const [paymentMethodIdentifier, setPaymentMethodIdentifier] = useState('');

    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    
    const handleAddProducts = (selectedProducts: InventoryItem[]) => {
        const newItems = selectedProducts.map(p => ({
            productId: p.id,
            productName: p.name,
            quantity: 1,
            costPerUnit: p.costPerUnit || 0
        }));
        setItems(prev => {
          const newAndUpdatedItems = [...prev];
          
          if (newAndUpdatedItems.length === 0 && newItems.length > 0) {
            const firstProductSupplier = products.find(p => p.id === newItems[0].productId)?.supplier;
            if (firstProductSupplier) {
              setSupplier(firstProductSupplier);
            }
          }

          newItems.forEach(newItem => {
            if (!newAndUpdatedItems.find(item => item.productId === newItem.productId)) {
              newAndUpdatedItems.push(newItem);
            }
          });
          return newAndUpdatedItems;
        });
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

    const { itemsSubtotal, totalLandedCost, itemsWithLandedCost } = useMemo(() => {
        const subtotal = items.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);
        const otherCosts = shippingCost + taxCost - discounts;
        const total = subtotal + otherCosts;

        const itemsWithCosts = items.map(item => {
            const itemSubtotal = item.quantity * item.costPerUnit;
            const proportionOfSubtotal = subtotal > 0 ? itemSubtotal / subtotal : 0;
            const proportionalOtherCosts = otherCosts * proportionOfSubtotal;
            const totalItemCost = itemSubtotal + proportionalOtherCosts;
            const landedCostPerUnit = item.quantity > 0 ? totalItemCost / item.quantity : 0;
            return {
                ...item,
                landedCostPerUnit: isNaN(landedCostPerUnit) ? item.costPerUnit : landedCostPerUnit,
            };
        });

        return { itemsSubtotal: subtotal, totalLandedCost: total, itemsWithLandedCost: itemsWithCosts };
    }, [items, shippingCost, taxCost, discounts]);


    const handleSave = () => {
        let finalTrackingUrl = trackingUrl;
        if (finalTrackingUrl && !/^https?:\/\//i.test(finalTrackingUrl)) {
            finalTrackingUrl = `https://${finalTrackingUrl}`;
        }
        
        // Use the calculated landed cost for each item
        const finalItems = itemsWithLandedCost.map(item => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            costPerUnit: item.landedCostPerUnit,
        }));

        const newOrder: Omit<Order, 'id'> = {
            supplier,
            orderDate: (orderDate || new Date()).toISOString(),
            status: 'Placed',
            trackingNumber,
            trackingUrl: finalTrackingUrl,
            notes,
            items: finalItems,
            invoiceUrl,
            expectedArrivalDate: expectedDate ? expectedDate.toISOString() : undefined,
            paymentMethod,
            paymentContext,
            paymentMethodIdentifier,
            shippingCost, // New field
            taxCost,      // New field
            discounts,    // New field
        };

        onSave(newOrder);
        onOpenChange(false);
    };

    return (
        <>
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Create New Purchase Order</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
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

                    <Card>
                        <CardHeader><CardTitle className="text-base">Landed Cost Calculator</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex justify-between text-sm"><span>Items Subtotal:</span><span className="font-mono">${itemsSubtotal.toFixed(2)}</span></div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="space-y-2"><Label>Shipping Cost</Label><Input type="number" value={shippingCost || ''} onChange={e => setShippingCost(parseFloat(e.target.value) || 0)} placeholder="0.00" /></div>
                                <div className="space-y-2"><Label>Taxes</Label><Input type="number" value={taxCost || ''} onChange={e => setTaxCost(parseFloat(e.target.value) || 0)} placeholder="0.00" /></div>
                                <div className="space-y-2"><Label>Discounts</Label><Input type="number" value={discounts || ''} onChange={e => setDiscounts(parseFloat(e.target.value) || 0)} placeholder="0.00" /></div>
                            </div>
                            <div className="p-3 bg-muted rounded-md flex items-center justify-between">
                                <span className="font-medium">Total Landed Cost:</span>
                                <span className="text-lg font-bold text-primary">${totalLandedCost.toFixed(2)}</span>
                            </div>
                        </CardContent>
                    </Card>


                    <div className="space-y-2">
                        <Label htmlFor="supplier">Supplier</Label>
                        <Input id="supplier" value={supplier} onChange={e => setSupplier(e.target.value)} />
                    </div>
                     <div className="space-y-2">
                        <Label>Payment Method</Label>
                        <RadioGroup value={paymentContext} onValueChange={(v: any) => setPaymentContext(v)} className="grid grid-cols-2 gap-2">
                            <div>
                                <RadioGroupItem value="Business" id="business-order" className="peer sr-only" />
                                <Label htmlFor="business-order" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Business</Label>
                            </div>
                            <div>
                                <RadioGroupItem value="Personal" id="personal-order" className="peer sr-only" />
                                <Label htmlFor="personal-order" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Personal</Label>
                            </div>
                        </RadioGroup>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="paymentMethod">Account</Label>
                            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                                <SelectTrigger id="paymentMethod">
                                <SelectValue placeholder="Select an account" />
                                </SelectTrigger>
                                <SelectContent>
                                <SelectItem value="Checking">Checking</SelectItem>
                                <SelectItem value="Credit Card">Credit Card</SelectItem>
                                <SelectItem value="Cash">Cash</SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="paymentMethodIdentifier">Identifier (Optional)</Label>
                            <Input id="paymentMethodIdentifier" placeholder="e.g., Chase ****1234" value={paymentMethodIdentifier} onChange={e => setPaymentMethodIdentifier(e.target.value)} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
