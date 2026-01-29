

'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { MoreHorizontal, PlusCircle, Search, SlidersHorizontal, Package, Hammer, FlaskConical, Pencil, Rocket, CheckCircle, Trash2, Edit, MapPin, Printer, PackageX, Box, Building, Store, ClipboardList, Plus, BarChart, File, Pipette, QrCode, AlertTriangle, ListFilter, ChevronDown, ShoppingCart, Briefcase, DollarSign, Activity, Eye, CircleHelp, Warehouse, Beaker, Recycle, TrendingUp, Truck, Clock, Check, Link as LinkIcon, FileImage, X } from 'lucide-react';
import { 
    type InventoryItem, 
    type StockCorrection,
    type Client,
    type Appointment,
    type Location,
    type LocationType,
    type Service,
    type Order,
    type Batch,
    type SpoilageItem,
} from '@/lib/data';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { AddLocationDialog } from '@/components/inventory/AddLocationDialog';
import { EditLocationDialog } from '@/components/inventory/EditLocationDialog';
import { EndCostPerUseTestDialog } from '@/components/inventory/EndCostPerUseTestDialog';
import { WriteOffDialog } from '@/components/inventory/WriteOffDialog';
import { LogUseDialog } from '@/components/inventory/LogUseDialog';
import { Locations } from '@/components/inventory/Locations';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { isPast, parseISO, differenceInMonths } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ManageSpoilageDialog } from '@/components/inventory/ManageSpoilageDialog';
import { InventorySidebar } from '@/components/inventory/InventorySidebar';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Transaction } from '@/lib/financial-data';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { AddProductDialog } from '@/components/inventory/AddProductDialog';
import { AddEquipmentDialog } from '@/components/inventory/AddEquipmentDialog';
import { AddOverheadDialog } from '@/components/inventory/AddOverheadDialog';
import { useInventory } from '@/context/InventoryContext';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { EditProductDialog } from '@/components/inventory/EditProductDialog';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { BrowseProductsDialog } from '@/components/services/BrowseProductsDialog';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { AddOrderDialog } from '@/components/inventory/AddOrderDialog';
import { ReceiveStockDialog, type ReceivedItem } from '@/components/inventory/ReceiveStockDialog';
import { useTenant } from '@/context/TenantContext';
import { Html5Qrcode } from 'html5-qrcode';
import { ProductCard } from '@/components/inventory/ProductCard';
import { EditEquipmentDialog } from '@/components/inventory/EditEquipmentDialog';


const OrderCard = ({ order, onSelect, onTrack, onReceive }: { order: Order, onSelect: (order: Order) => void, onTrack: (e: React.MouseEvent, url?: string) => void, onReceive: (order: Order) => void }) => {
    const getStatusVariant = (status: Order['status']) => {
        switch (status) {
            case 'Placed': return { icon: <Clock className="h-3 w-3" />, className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300' };
            case 'Shipped': return { icon: <Truck className="h-3 w-3" />, className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300' };
            case 'Received':
            case 'Partially Received':
                return { icon: <Check className="h-3 w-3" />, className: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' };
            case 'Cancelled':
                return { icon: <X className="h-3 w-3" />, className: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300' };
            default: return { icon: <Package className="h-3 w-3" />, className: 'bg-gray-100 text-gray-700' };
        }
    };
    const statusInfo = getStatusVariant(order.status);
    const totalItems = order.items.reduce((acc, item) => acc + item.quantity, 0);
    const totalCost = order.items.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);

    return (
        <Card onClick={() => onSelect(order)} className="cursor-pointer hover:shadow-lg transition-colors">
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="text-base">{order.supplier}</CardTitle>
                        <CardDescription>Order placed: {format(parseISO(order.orderDate), 'MMM d, yyyy')}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge className={statusInfo.className}>{statusInfo.icon} <span className="ml-1.5">{order.status}</span></Badge>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent onClick={(e) => e.stopPropagation()} align="end">
                                <DropdownMenuItem onClick={() => onSelect(order)}>View/Edit Order</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onReceive(order)}>Receive Stock</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-sm space-y-2">
                    <p><strong>{totalItems}</strong> items ordered</p>
                    <p>Total Cost: <strong>${totalCost.toFixed(2)}</strong></p>
                     <Button
                        variant="link"
                        size="xs"
                        className="p-0 h-auto"
                        onClick={(e) => onTrack(e, order.trackingUrl)}
                    >
                        <Truck className="w-4 h-4 text-muted-foreground mr-2"/>
                        Track
                    </Button>
                    {order.expectedArrivalDate && <p>Expected: <strong>{format(parseISO(order.expectedArrivalDate), 'MMM d, yyyy')}</strong></p>}
                </div>
            </CardContent>
        </Card>
    );
}

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
                                        <div><RadioGroupItem value="Business" id="business-order-edit-dialog" className="peer sr-only" /><Label htmlFor="business-order-edit-dialog" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Business</Label></div>
                                        <div><RadioGroupItem value="Personal" id="personal-order-edit-dialog" className="peer sr-only" /><Label htmlFor="personal-order-edit-dialog" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Personal</Label></div>
                                    </RadioGroup>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2"><Label htmlFor="paymentMethod-edit-dialog">Account</Label><Select value={editableOrder.paymentMethod || ''} onValueChange={(v) => setEditableOrder(prev => prev ? ({...prev, paymentMethod: v}) : null)}><SelectTrigger id="paymentMethod-edit-dialog"><SelectValue placeholder="Select an account" /></SelectTrigger><SelectContent><SelectItem value="Checking">Checking</SelectItem><SelectItem value="Credit Card">Credit Card</SelectItem><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></div>
                                    <div className="space-y-2"><Label htmlFor="paymentMethodIdentifier-edit-dialog">Identifier</Label><Input id="paymentMethodIdentifier-edit-dialog" placeholder="e.g., Chase ****1234" value={editableOrder.paymentMethodIdentifier || ''} onChange={e => setEditableOrder(prev => prev ? ({...prev, paymentMethodIdentifier: e.target.value}) : null)} /></div>
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

const OrdersTab = ({ orders, inventory, isLoading, onAddOrder, onUpdateOrder, onCancelOrder }: { 
    orders: Order[],
    inventory: InventoryItem[],
    isLoading: boolean, 
    onAddOrder: (order: Omit<Order, 'id'>) => void, 
    onUpdateOrder: (order: Order) => void, 
    onCancelOrder: (orderId: string) => void 
}) => {
    const [isAddOrderOpen, setIsAddOrderOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [orderToReceive, setOrderToReceive] = useState<Order | null>(null);
    const { toast } = useToast();
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    
    const openTrackingUrl = (e: React.MouseEvent, url?: string) => {
        e.stopPropagation();
        if (!url) return;
        let finalUrl = url;
        if (!/^https?:\/\//i.test(url)) {
            finalUrl = 'https://' + url;
        }
        window.open(finalUrl, '_blank', 'noopener,noreferrer');
    };

    const handleReceiveStock = (receivedItems: ReceivedItem[]) => {
      if (!firestore || !orderToReceive || !tenantId) return;

      const batch = writeBatch(firestore);

      receivedItems.forEach(item => {
        const existingProduct = inventory.find(p => p.id === item.productId);
        if (existingProduct) {
          const productRef = doc(firestore, `tenants/${tenantId}/inventory`, item.productId);
          
          if (item.quantityReceived > 0) {
              const newBatchData: Batch = {
                id: `batch-${nanoid()}`,
                stock: item.quantityReceived,
                costPerUnit: item.costPerUnit,
                receivedDate: new Date().toISOString(),
                expirationDate: item.expirationDate?.toISOString(),
              };
              
              const updatedBatches = [...existingProduct.batches, newBatchData];
              const totalStock = updatedBatches.reduce((acc, b) => acc + b.stock, 0);

              batch.update(productRef, {
                batches: updatedBatches,
                totalStock: totalStock,
                costPerUnit: item.costPerUnit,
              });

              const stockCorrection: Omit<StockCorrection, 'id'> = {
                productId: item.productId,
                date: new Date().toISOString(),
                change: item.quantityReceived,
                unit: existingProduct.unit || 'units',
                reason: `Shipment from ${orderToReceive.supplier}`,
              };
              const scRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
              batch.set(scRef, stockCorrection);
          }

          if (item.quantityDamaged > 0) {
              const damageCost = item.quantityDamaged * item.costPerUnit;
              const damageTransaction: Omit<Transaction, 'id'> = {
                date: new Date().toISOString(),
                description: `Damaged on arrival: ${item.quantityDamaged} x ${item.productName}`,
                clientOrVendor: orderToReceive.supplier,
                type: 'expense',
                context: 'Business',
                category: 'Spoilage',
                amount: damageCost,
                paymentMethod: 'Internal',
                hasReceipt: !!orderToReceive.invoiceUrl,
                receiptUrl: orderToReceive.invoiceUrl,
                relatedOrderId: orderToReceive.id,
              };
              const dtRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
              batch.set(dtRef, damageTransaction);
          }
        }
      });
      
      const allItemsFullyOrPartiallyReceived = receivedItems.every(item => item.quantityReceived + item.quantityDamaged >= item.quantityOrdered);
      const someItemsReceived = receivedItems.some(item => item.quantityReceived > 0 || item.quantityDamaged > 0);

      let newStatus: Order['status'] = orderToReceive.status;
      if (allItemsFullyOrPartiallyReceived) {
        newStatus = 'Received';
      } else if (someItemsReceived) {
        newStatus = 'Partially Received';
      }
      
      if (newStatus !== orderToReceive.status) {
        const orderRef = doc(firestore, `tenants/${tenantId}/orders`, orderToReceive.id);
        batch.update(orderRef, { status: newStatus });
      }

      batch.commit().then(() => {
          toast({
              title: "Stock Updated!",
              description: "Inventory has been updated with the received items.",
          });
          setOrderToReceive(null);
      }).catch(error => {
          console.error("Error receiving stock: ", error);
          toast({
              variant: "destructive",
              title: "Error",
              description: "Failed to update stock.",
          });
      });
    };
    
    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <CardTitle>Purchase Orders</CardTitle>
                            <CardDescription>Track your inventory supply orders.</CardDescription>
                        </div>
                        <Button onClick={() => setIsAddOrderOpen(true)} className="w-full sm:w-auto"><PlusCircle className="mr-2 h-4 w-4"/>New Order</Button>
                    </div>
                </CardHeader>
                <CardContent>
                     {isLoading ? <p>Loading orders...</p> : orders.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {orders.map(order => <OrderCard key={order.id} order={order} onSelect={setSelectedOrder} onTrack={openTrackingUrl} onReceive={setOrderToReceive} />)}
                        </div>
                    ) : (
                         <div className="text-center py-10 px-6 border-2 border-dashed rounded-lg">
                            <Truck className="mx-auto h-12 w-12 text-muted-foreground" />
                            <h3 className="mt-2 text-sm font-semibold">No orders yet</h3>
                            <p className="mt-1 text-sm text-muted-foreground">Create your first purchase order to start tracking supplies.</p>
                         </div>
                    )}
                </CardContent>
            </Card>

            <AddOrderDialog
                open={isAddOrderOpen}
                onOpenChange={setIsAddOrderOpen}
                onSave={onAddOrder}
            />
            <ViewOrEditOrderDialog
                order={selectedOrder}
                open={!!selectedOrder}
                onOpenChange={(isOpen) => !isOpen && setSelectedOrder(null)}
                onSave={onUpdateOrder}
                onCancelOrder={onCancelOrder}
                onTrack={openTrackingUrl}
            />
             <ReceiveStockDialog
                open={!!orderToReceive}
                onOpenChange={() => setOrderToReceive(null)}
                order={orderToReceive}
                onConfirm={handleReceiveStock}
            />
        </>
    );
};

const EmptyState = ({ onAddFirstItem }: { onAddFirstItem: () => void }) => (
    <div className="text-center py-20 px-6 col-span-full border-2 border-dashed rounded-lg">
        <div className='flex justify-center mb-6'>
            <div className='w-20 h-20 bg-muted rounded-full flex items-center justify-center'>
                <Package className='w-10 h-10 text-muted-foreground' />
            </div>
        </div>
        <h3 className="text-xl font-semibold mb-2">Your Inventory is Empty</h3>
        <p className="text-muted-foreground max-w-sm mx-auto mb-6">
            Get started by adding your first product, piece of equipment, or overhead supply.
        </p>
         <Button onClick={onAddFirstItem}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add First Item
        </Button>
    </div>
);


export default function InventoryPage() {
  const { 
    inventory, 
    stockCorrections,
    locations, 
    locationTypes,
    transactions,
    isLoading: isInventoryLoading
  } = useInventory();
  
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  
  const [activeView, setActiveView] = useState('products');
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  
  const [isAddProductDialogOpen, setIsAddProductDialogOpen] = useState(false);
  const [addProductDialogType, setAddProductDialogType] = useState<'professional' | 'retail'>('professional');
  const [isAddEquipmentDialogOpen, setIsAddEquipmentDialogOpen] = useState(false);
  const [isAddOverheadDialogOpen, setIsAddOverheadDialogOpen] = useState(false);
  const [isAddLocationDialogOpen, setIsAddLocationDialogOpen] = useState(false);
  const [isEditLocationDialogOpen, setIsEditLocationDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  const [isLogUseOpen, setIsLogUseOpen] = useState(false);
  const [isWriteOffOpen, setIsWriteOffOpen] = useState(false);
  const [isEndExperimentOpen, setIsEndExperimentOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<InventoryItem | null>(null);
  const [logUseDialogType, setLogUseDialogType] = useState<'product' | 'overhead'>('product');

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  
  const [selectedItems, setSelectedItems] = useState(new Set<string>());
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 8;
  
  const [productCategories, setProductCategories] = useState<string[]>([]);

    useEffect(() => {
        if (inventory) {
            const allCategories = inventory.map(p => p.category).filter((c): c is string => !!c);
            setProductCategories([...new Set(allCategories)]);
        }
    }, [inventory]);

    const onNewCategory = useCallback((newCategory: string) => {
        if (!productCategories.includes(newCategory)) {
            setProductCategories(prev => [...prev, newCategory].sort());
        }
    }, [productCategories]);
  
  const ordersQuery = useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/orders`) : null, [firestore, tenantId]);
  const { data: orders, isLoading: ordersLoading } = useCollection<Order>(ordersQuery);

  const orderedProductIds = useMemo(() => {
    if (!orders) return new Set();
    const activeOrders = orders.filter(
      (order) => order.status === 'Placed' || order.status === 'Shipped'
    );
    const productIds = new Set<string>();
    activeOrders.forEach((order) => {
      order.items.forEach((item) => {
        productIds.add(item.productId);
      });
    });
    return productIds;
  }, [orders]);

  const handleEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setIsEditDialogOpen(true);
  };

  const handleUpdateItem = (updatedItem: InventoryItem) => {
    if (!firestore || !tenantId) return;
    const itemDocRef = doc(firestore, `tenants/${tenantId}/inventory`, updatedItem.id);
    updateDocumentNonBlocking(itemDocRef, updatedItem);
    toast({
        title: "Item Updated",
        description: `${updatedItem.name} has been successfully updated.`,
    });
    setIsEditDialogOpen(false);
  };

  const handleItemSelect = useCallback((itemId: string) => {
    setSelectedItems(prev => {
        const newSelection = new Set(prev);
        if (newSelection.has(itemId)) {
            newSelection.delete(itemId);
        } else {
            newSelection.add(itemId);
        }
        return newSelection;
    });
  }, []);

  const handleBulkDeleteClick = () => {
    setIsBulkDeleteConfirmOpen(true);
  };
  
  const handleBulkDeleteConfirm = useCallback(() => {
    if (!firestore || !tenantId) return;
    const itemCount = selectedItems.size;
    const batch = writeBatch(firestore);
    selectedItems.forEach(id => {
      const itemDoc = doc(firestore, `tenants/${tenantId}/inventory`, id);
      batch.delete(itemDoc);
    });
    batch.commit();
    setSelectedItems(new Set());
    setIsBulkDeleteConfirmOpen(false);
    toast({
        title: "Items Deleted",
        description: `${itemCount} item(s) have been removed from your inventory.`,
    })
  }, [selectedItems, toast, firestore, tenantId]);
  
    const handleBulkArchive = useCallback(() => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        selectedItems.forEach(id => {
            const itemDoc = doc(firestore, `tenants/${tenantId}/inventory`, id);
            batch.update(itemDoc, { status: 'archived' });
        });
        batch.commit();
        toast({ title: `${selectedItems.size} item(s) have been archived.` });
        setSelectedItems(new Set());
    }, [selectedItems, firestore, tenantId, toast]);

    const handleBulkUnarchive = useCallback(() => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        selectedItems.forEach(id => {
            const itemDoc = doc(firestore, `tenants/${tenantId}/inventory`, id);
            batch.update(itemDoc, { status: 'active' });
        });
        batch.commit();
        toast({ title: `${selectedItems.size} item(s) have been restored.` });
        setSelectedItems(new Set());
    }, [selectedItems, firestore, tenantId, toast]);


  const handleOpenAddProductDialog = (type: 'professional' | 'retail') => {
    setAddProductDialogType(type);
    setIsAddProductDialogOpen(true);
  };
  
  const handleProductAdded = (newProduct: InventoryItem) => {
    if (!firestore || !tenantId) return;
    const newProductRef = doc(firestore, 'tenants', tenantId, 'inventory', newProduct.id);
    const sanitizedData = JSON.parse(JSON.stringify(newProduct));
    setDocumentNonBlocking(newProductRef, sanitizedData, {});
    toast({
      title: `New ${newProduct.type} product created`,
      description: `${newProduct.name} has been added to your inventory.`
    });
  };

  const handleEquipmentAdded = (newEquipment: InventoryItem) => {
    if (!firestore || !tenantId) return;
    const newEquipmentRef = doc(firestore, 'tenants', tenantId, 'inventory', newEquipment.id);
    const sanitizedData = JSON.parse(JSON.stringify(newEquipment));
    setDocumentNonBlocking(newEquipmentRef, sanitizedData, {});
  };
  
  const handleOverheadAdded = (newOverhead: InventoryItem) => {
    if (!firestore || !tenantId) return;
    const newOverheadRef = doc(firestore, 'tenants', tenantId, 'inventory', newOverhead.id);
    const sanitizedData = JSON.parse(JSON.stringify(newOverhead));
    setDocumentNonBlocking(newOverheadRef, sanitizedData, {});
  };
  
  const handleAddOrder = (newOrderData: Omit<Order, 'id'>) => {
    if (!firestore || !tenantId) return;

    const finalItems: { productId: string; productName: string; quantity: number; costPerUnit: number; }[] = [];
    
    newOrderData.items.forEach(item => {
        if (item.productId.startsWith('custom-')) {
            const newProductId = nanoid();
            const newProductShell: InventoryItem = {
                id: newProductId,
                name: item.productName,
                type: 'professional',
                category: 'Uncategorized',
                totalStock: 0,
                supplier: newOrderData.supplier,
                costPerUnit: item.costPerUnit,
                batches: [],
            };
            const productDocRef = doc(firestore, `tenants/${tenantId}/inventory`, newProductId);
            setDocumentNonBlocking(productDocRef, newProductShell, {});
            finalItems.push({ ...item, productId: newProductId });
        } else {
            finalItems.push(item);
        }
    });

    const newOrder: Order = {
        ...newOrderData,
        id: nanoid(),
        items: finalItems,
        status: 'Placed',
    };
    const orderRef = collection(firestore, 'tenants', tenantId, 'orders');
    addDocumentNonBlocking(orderRef, newOrder);
    
    const totalCost = newOrder.items.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);
    if (totalCost > 0) {
        const newTransaction: Omit<Transaction, 'id' | 'date'> = {
            description: `Purchase Order: ${newOrder.supplier}`,
            clientOrVendor: newOrder.supplier,
            type: 'expense',
            context: newOrder.paymentContext || 'Business',
            category: 'Supplies',
            amount: totalCost,
            paymentMethod: newOrder.paymentMethod || 'On Account',
            paymentMethodIdentifier: newOrder.paymentMethodIdentifier,
            hasReceipt: !!newOrder.invoiceUrl,
            receiptUrl: newOrder.invoiceUrl,
            relatedOrderId: newOrder.id,
        };
        const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
        addDocumentNonBlocking(transactionsRef, { ...newTransaction, date: newOrder.orderDate });
    }

    toast({
        title: "Order Created!",
        description: `Your order to ${newOrder.supplier} has been saved as '${newOrder.status}'.`
    });
  };
  
  const handleUpdateOrder = (updatedOrder: Order) => {
      if (!firestore || !tenantId) return;
      const orderRef = doc(firestore, `tenants/${tenantId}/orders`, updatedOrder.id);
      updateDocumentNonBlocking(orderRef, updatedOrder);
      toast({
          title: "Order Updated",
          description: `Order ${updatedOrder.id.slice(-6)} has been updated.`
      })
  }

  const handleCancelOrder = (orderId: string) => {
      if(!firestore || !orders || !tenantId) return;
      
      const orderToCancel = orders.find(o => o.id === orderId);
      if (!orderToCancel) return;

      const orderRef = doc(firestore, `tenants/${tenantId}/orders`, orderId);
      updateDocumentNonBlocking(orderRef, { status: 'Cancelled' });

      // Create a reversal transaction
      const totalCost = orderToCancel.items.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);
      const newTransaction: Omit<Transaction, 'id' | 'date'> = {
        description: `Reversal for Order: ${orderToCancel.supplier}`,
        clientOrVendor: orderToCancel.supplier,
        type: 'reversal',
        context: 'Business',
        category: 'Supplies',
        amount: totalCost,
        paymentMethod: 'On Account',
        hasReceipt: true,
        relatedOrderId: orderToCancel.id,
      };
      const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
      addDocumentNonBlocking(transactionsRef, { ...newTransaction, date: new Date().toISOString() });

      toast({
          title: "Order Cancelled",
          description: `Order ${orderId.slice(-6)} has been cancelled and the expense reversed.`
      })
  }

  const handleOpenAddLocation = () => setIsAddLocationDialogOpen(true);
  
  const handleOpenEditLocation = (location: Location) => {
    setSelectedLocation(location);
    setIsEditLocationDialogOpen(true);
  };
  
  const handleSaveLocation = (newLocation: Omit<Location, 'id'>) => {
    if (!firestore || !tenantId) return {} as Location;
    const newLocWithId = { ...newLocation, id: `loc-${nanoid()}`};
    const locationRef = doc(firestore, 'tenants', tenantId, 'locations', newLocWithId.id);
    const sanitizedData = JSON.parse(JSON.stringify(newLocWithId));
    setDocumentNonBlocking(locationRef, sanitizedData, {});
    return newLocWithId;
  };

  const handleUpdateLocation = (updatedLocation: Location) => {
    if (!firestore || !tenantId) return;
    const locationRef = doc(firestore, 'tenants', tenantId, 'locations', updatedLocation.id);
    const sanitizedData = JSON.parse(JSON.stringify(updatedLocation));
    updateDocumentNonBlocking(locationRef, sanitizedData);
  };

  const handleAddNewLocationType = (name: string, icon: string): LocationType => {
    if (!firestore || !tenantId) return { id: '', name: '', icon: '' };
    const newType = { id: `lt-${nanoid()}`, name, icon };
    const locTypeRef = doc(firestore, 'tenants', tenantId, 'locationTypes', newType.id);
    const sanitizedData = JSON.parse(JSON.stringify(newType));
    setDocumentNonBlocking(locTypeRef, sanitizedData, {});
    return newType;
  };


  const handleOpenLogUse = (item: InventoryItem) => {
    setLogUseDialogType('product');
    setSelectedProduct(item);
    setIsLogUseOpen(true);
  }
  
  const handleOpenOverheadLogUse = () => {
    setLogUseDialogType('overhead');
    setIsLogUseOpen(true);
  }

  const handleOpenWriteOff = (item: InventoryItem) => {
    setSelectedProduct(item);
    setIsWriteOffOpen(true);
  };

  const handleWriteOffConfirm = (productId: string, batchId: string, quantity: number, reason: string): { success: boolean, message: string } => {
    if (!firestore || !tenantId || !inventory) return { success: false, message: 'Firestore not available' };

    const product = inventory.find(p => p.id === productId);
    if (!product) return { success: false, message: 'Product not found.' };

    const batchToIndex = product.batches.findIndex(b => b.id === batchId);
    if (batchToIndex === -1) return { success: false, message: 'Batch not found.' };

    const batchToUpdate = product.batches[batchToIndex];
    if (batchToUpdate.stock < quantity) {
      return { success: false, message: `Cannot write off more than available stock (${batchToUpdate.stock}).` };
    }

    const lossAmount = quantity * batchToUpdate.costPerUnit;

    const productRef = doc(firestore, `tenants/${tenantId}/inventory`, productId);
    const updatedBatches = [...product.batches];
    updatedBatches[batchToIndex] = { ...batchToUpdate, stock: batchToUpdate.stock - quantity };
    const newTotalStock = updatedBatches.reduce((acc, b) => acc + b.stock, 0);
    const updatedData = {
      batches: updatedBatches,
      totalStock: newTotalStock
    };
    updateDocumentNonBlocking(productRef, updatedData);
    
    const stockCorrection: Omit<StockCorrection, 'id'> = {
      productId: productId,
      date: new Date().toISOString(),
      change: -quantity,
      unit: product.unit || 'units',
      reason: `Write-off: ${reason}`,
    };
    addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/stockCorrections`), stockCorrection);

    const transaction: Omit<Transaction, 'id' | 'date'> = {
      description: `Write-off: ${quantity} x ${product.name}`,
      clientOrVendor: 'Internal',
      type: 'expense',
      context: 'Business',
      category: 'Spoilage',
      amount: lossAmount,
      paymentMethod: 'Internal',
      hasReceipt: false,
    };
    addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/transactions`), { ...transaction, date: new Date().toISOString() });

    toast({
        title: "Item Written Off",
        description: `${quantity} unit(s) of ${product.name} have been written off with a total loss of $${lossAmount.toFixed(2)}.`,
    });

    return { success: true, message: "Write-off successful." };
  };
  
  const handleLogUseConfirm = (productId: string, quantity: number, notes: string): { success: boolean, message: string } => {
    if (!firestore || !tenantId || !inventory) return { success: false, message: 'Firestore not available' };
    
    const product = inventory.find((p: InventoryItem) => p.id === productId);
    if (!product) return { success: false, message: 'Product not found' };

    const productDocRef = doc(firestore, 'tenants', tenantId, 'inventory', productId);
    const stockCorrectionsRef = collection(firestore, 'tenants', tenantId, 'stockCorrections');
    
    const updateData: Partial<InventoryItem> = {};
    let unit = 'units';
    
    if (product.costingMethod === 'uses') {
        unit = product.useUnit || 'uses';
        let currentUses = product.partialContainerUses || 0;
        let currentStock = product.totalStock;
        const usesPerContainer = product.estimatedUses || 1;
        
        currentUses -= quantity;
        while (currentUses < 0 && currentStock > 0) {
            currentStock -= 1;
            currentUses += usesPerContainer;
        }
        
        updateData.totalStock = currentStock;
        updateData.partialContainerUses = currentUses;

    } else if (product.costingMethod === 'size') {
        unit = product.unit || 'ml';
        let currentSize = product.partialContainerSize || 0;
        let currentStock = product.totalStock;
        const sizePerContainer = product.size || 1;

        currentSize -= quantity;
        while (currentSize < 0 && currentStock > 0) {
            currentStock -= 1;
            currentSize += sizePerContainer;
        }
        
        updateData.totalStock = currentStock;
        updateData.partialContainerSize = currentSize;

    } else { // 'unit' costing method, or undefined
        updateData.totalStock = (product.totalStock || 0) - quantity;
        unit = product.unit || 'units';
    }

    if ((updateData.totalStock !== undefined && updateData.totalStock < 0) || 
        (updateData.partialContainerUses !== undefined && updateData.partialContainerUses < 0) || 
        (updateData.partialContainerSize !== undefined && updateData.partialContainerSize < 0)) {
        return { success: false, message: `Insufficient stock for ${product.name}.`};
    }
    
    updateDocumentNonBlocking(productDocRef, updateData);

    const newCorrection: Omit<StockCorrection, 'id'> = {
        productId: productId,
        date: new Date().toISOString(),
        change: -quantity,
        unit: unit,
        reason: notes || 'Manual Use Log',
    };
    addDocumentNonBlocking(stockCorrectionsRef, newCorrection);
    
    return { success: true, message: `${quantity} ${unit} of ${product.name} logged.` };
  };

  const handleLogOverheadUse = (productId: string) => {
    handleLogUseConfirm(productId, 1, 'Manual Overhead Use');
  };
  
  const handleSpoilageConfirm = (items: SpoilageItem[], notes?: string, imageUrl?: string) => {
    if (!firestore || !tenantId || !inventory) return;

    const batch = writeBatch(firestore);
    let totalLoss = 0;

    items.forEach(item => {
        const product = inventory.find(p => p.id === item.productId);
        if (product) {
            const productRef = doc(firestore, `tenants/${tenantId}/inventory`, item.productId);
            const updatedBatches = product.batches.map(b => {
                if (b.id === item.batchId) {
                    return { ...b, stock: 0 };
                }
                return b;
            });

            const newTotalStock = updatedBatches.reduce((acc, b) => acc + b.stock, 0);

            batch.update(productRef, {
                batches: updatedBatches,
                totalStock: newTotalStock,
            });
            
            const stockCorrection: Omit<StockCorrection, 'id'> = {
                productId: item.productId,
                date: new Date().toISOString(),
                change: -item.stock,
                unit: product.unit || 'units',
                reason: 'Spoilage - Expired',
            };
            const scRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
            batch.set(scRef, stockCorrection);
            
            const lossAmount = item.stock * item.costPerUnit;
            totalLoss += lossAmount;
            
            const transaction: Omit<Transaction, 'id' | 'date'> = {
                description: `Spoilage: ${item.stock} x ${item.productName}`,
                clientOrVendor: 'Internal',
                type: 'expense',
                context: 'Business',
                category: 'Spoilage',
                amount: lossAmount,
                paymentMethod: 'Internal',
                hasReceipt: false,
            };
            const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
            batch.set(txnRef, {...transaction, date: new Date().toISOString() });
        }
    });

    batch.commit().then(() => {
        toast({
            title: "Spoilage Written Off",
            description: `${items.length} item(s) written off with a total loss of $${totalLoss.toFixed(2)}.`,
        });
    }).catch((error) => {
        console.error("Error writing off spoilage:", error);
        toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to write off spoilage.",
        });
    });
  };
  
  const handleToggleExperiment = (item: InventoryItem) => {
    if (!firestore || !tenantId) return;
    const itemRef = doc(firestore, 'tenants', tenantId, 'inventory', item.id);
    updateDocumentNonBlocking(itemRef, { isExperimentActive: true, experimentUses: 0 });
    toast({
        title: "Experiment Started!",
        description: `You are now tracking the cost-per-use for ${item.name}.`,
    });
  };

  const handleEndExperiment = (item: InventoryItem) => {
    setSelectedProduct(item);
    setIsEndExperimentOpen(true);
  };
  
  const handleEndExperimentConfirmed = (results: any) => {
    if (!selectedProduct || !firestore || !tenantId) return;
    
    const itemRef = doc(firestore, 'tenants', tenantId, 'inventory', selectedProduct.id);
    updateDocumentNonBlocking(itemRef, { isExperimentActive: false, lastTestResult: results });

    toast({
        title: "Experiment Ended",
        description: `Cost-per-use tracking for ${selectedProduct.name} has been stopped.`,
    });
    setIsEndExperimentOpen(false);
    setSelectedProduct(null);
  }

  const filteredInventory = useMemo(() => {
    if (!inventory) return [];
    let items = inventory.filter(item => {
      return showArchived ? item.status === 'archived' : item.status !== 'archived';
    });

    if (activeFilter !== 'all') {
      items = items.filter(item => item.type === activeFilter);
    }
    
    if (searchTerm) {
        const lowercasedSearchTerm = searchTerm.toLowerCase();
        items = items.filter(item => 
            item.name.toLowerCase().includes(lowercasedSearchTerm) ||
            item.id.toLowerCase().includes(lowercasedSearchTerm)
        );
    }

    return items;
  }, [inventory, activeFilter, searchTerm, showArchived]);
  
  const totalPages = Math.ceil(filteredInventory.length / ITEMS_PER_PAGE);
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredInventory.slice(startIndex, endIndex);
  }, [filteredInventory, currentPage]);

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  };


  const handleScan = useCallback((data: string) => {
    if (data.startsWith('clarityflow://product/')) {
        const productId = data.split('/').pop();
        if (productId) {
            setSearchTerm(productId);
            toast({
                title: "Product Found",
                description: `Displaying results for scanned product.`,
            });
        }
    } else {
        toast({
            variant: 'destructive',
            title: 'Invalid QR Code',
            description: 'Please scan a valid ClarityFlow product QR code.',
        });
    }
  }, [toast]);
  
  useEffect(() => {
    let html5QrCode: Html5Qrcode | undefined;
    if (isScannerOpen) {
      const timer = setTimeout(() => {
        const element = document.getElementById('qr-reader-inventory');
        if (element) {
          html5QrCode = new Html5Qrcode('qr-reader-inventory');
          const onScanSuccess = (decodedText: string) => {
            if (html5QrCode?.isScanning) {
              html5QrCode.stop().catch(console.error);
            }
            handleScan(decodedText);
            setIsScannerOpen(false);
          };
          const onScanFailure = () => { /* ignore */ };
          html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, onScanFailure)
            .catch(err => {
              toast({ variant: 'destructive', title: 'Camera Error', description: 'Could not start the camera. Please check permissions and try again.' });
              setIsScannerOpen(false);
            });
        }
      }, 300);
      return () => {
          clearTimeout(timer);
          if (html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().catch(err => console.error("Failed to stop QR Code scanner.", err));
          }
      };
    }
  }, [isScannerOpen, handleScan, toast]);
  
  const hasInventory = inventory && inventory.length > 0;
  const hasFilteredInventory = filteredInventory.length > 0;

  return (
    <ClientOnly>
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Inventory Hub" />
      <main className="flex-1 p-4 md:p-8">
        
        <div className="grid lg:grid-cols-4 gap-8">
            <div className="hidden lg:block lg:col-span-1">
                <InventorySidebar
                  inventory={inventory || []}
                  stockCorrections={stockCorrections || []}
                  onSpoilageConfirm={handleSpoilageConfirm} 
                  onLogOverheadUse={handleLogOverheadUse} 
                />
            </div>

            <div className="lg:col-span-3">
                 <div className="lg:hidden mb-6">
                    <Sheet>
                        <SheetTrigger asChild>
                            <Button variant="outline" className="w-full">
                                <SlidersHorizontal className="mr-2 h-4 w-4" />
                                View Stats & Actions
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="bottom" className="h-[80vh] flex flex-col p-0">
                             <SheetHeader className="p-4 border-b">
                                <SheetTitle>Inventory Overview</SheetTitle>
                                <SheetDescription>Key metrics and actions for your inventory.</SheetDescription>
                            </SheetHeader>
                            <ScrollArea className="flex-1">
                                <div className="p-4">
                                     <InventorySidebar
                                      inventory={inventory || []}
                                      stockCorrections={stockCorrections || []}
                                      onSpoilageConfirm={handleSpoilageConfirm}
                                      onLogOverheadUse={handleLogOverheadUse}
                                     />
                                </div>
                            </ScrollArea>
                        </SheetContent>
                    </Sheet>
                </div>
                <Tabs value={activeView} onValueChange={setActiveView} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="products">Products</TabsTrigger>
                    <TabsTrigger value="orders">Orders</TabsTrigger>
                    <TabsTrigger value="locations">Locations</TabsTrigger>
                </TabsList>
                <TabsContent value="products" className="mt-6">
                    <Card>
                        <CardHeader>
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div>
                                    <CardTitle>All Inventory</CardTitle>
                                    <CardDescription>A complete list of your professional, retail, and equipment stock.</CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" asChild>
                                        <Link href="/inventory/report"><BarChart className="mr-2 h-4 w-4" />View Report</Link>
                                    </Button>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button><PlusCircle className="mr-2" /> New Item</Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => handleOpenAddProductDialog('professional')}><Package className="mr-2" />Product (Professional)</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleOpenAddProductDialog('retail')}><Store className="mr-2" />Product (Retail)</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setIsAddEquipmentDialogOpen(true)}><Hammer className="mr-2" />Equipment</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setIsAddOverheadDialogOpen(true)}><Recycle className="mr-2" />Overhead</DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="mb-4 space-y-4">
                                <div className="flex flex-col sm:flex-row items-center gap-4">
                                    <div className="relative flex-1 w-full">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input 
                                            placeholder="Search by name..." 
                                            className="pl-9"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 w-full sm:w-auto">
                                        <Button variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}>
                                            <QrCode className="h-4 w-4" />
                                            <span className="sr-only">Scan</span>
                                        </Button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="outline" className="w-full sm:w-auto">
                                                    <ListFilter className="mr-2 h-4 w-4" />
                                                    Filter
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => setActiveFilter('all')}>All</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => setActiveFilter('professional')}>Professional</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => setActiveFilter('retail')}>Retail</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => setActiveFilter('equipment')}>Equipment</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => setActiveFilter('overhead')}>Overhead</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
                                    <Label htmlFor="show-archived">{showArchived ? "Viewing Archived" : "Show Archived"}</Label>
                                </div>
                            </div>
                             {selectedItems.size > 0 && (
                                <div className="mb-4 p-3 rounded-lg bg-muted/50 flex items-center justify-between">
                                    <p className="text-sm font-medium">{selectedItems.size} item(s) selected</p>
                                    <div className="flex gap-2">
                                        {showArchived ? (
                                            <Button variant="outline" size="sm" onClick={handleBulkUnarchive}>Unarchive</Button>
                                        ) : (
                                            <Button variant="outline" size="sm" onClick={handleBulkArchive}>Archive</Button>
                                        )}
                                        <Button variant="destructive" size="sm" onClick={handleBulkDeleteClick}>Delete</Button>
                                    </div>
                                </div>
                            )}
                            {!hasInventory ? (
                                <EmptyState onAddFirstItem={() => handleOpenAddProductDialog('professional')} />
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6">
                                    {hasFilteredInventory ? paginatedItems.map(item => (
                                        <ProductCard 
                                            key={item.id}
                                            item={item} 
                                            onEdit={handleEditItem} 
                                            onToggleExperiment={handleToggleExperiment} 
                                            onEndExperiment={handleEndExperiment} 
                                            onLogUse={handleOpenLogUse}
                                            onWriteOff={handleOpenWriteOff}
                                            isSelected={selectedItems.has(item.id)}
                                            onSelect={() => handleItemSelect(item.id)}
                                            isOrdered={orderedProductIds.has(item.id)}
                                        />
                                    )) : (
                                        <p className="text-muted-foreground col-span-full text-center py-10">No items match your filters.</p>
                                    )}
                                </div>
                            )}
                        </CardContent>
                        {totalPages > 1 && (
                            <CardFooter>
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-sm text-muted-foreground">
                                        Page {currentPage} of {totalPages}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handlePrevPage}
                                            disabled={currentPage === 1}
                                        >
                                            Previous
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleNextPage}
                                            disabled={currentPage === totalPages}
                                        >
                                            Next
                                        </Button>
                                    </div>
                                </div>
                            </CardFooter>
                        )}
                    </Card>
                </TabsContent>
                <TabsContent value="orders" className="mt-6">
                    <OrdersTab 
                        orders={orders || []} 
                        inventory={inventory || []}
                        isLoading={ordersLoading} 
                        onAddOrder={handleAddOrder}
                        onUpdateOrder={handleUpdateOrder}
                        onCancelOrder={handleCancelOrder}
                    />
                </TabsContent>
                <TabsContent value="locations" className="mt-6">
                        <Locations 
                            locations={locations || []}
                            locationTypes={locationTypes || []}
                            inventory={inventory || []}
                            setLocations={() => {}}
                            onAddLocation={handleOpenAddLocation}
                            onEditLocation={handleOpenEditLocation}
                        />
                </TabsContent>
                </Tabs>
            </div>
        </div>
      </main>
      
      <AddProductDialog
        open={isAddProductDialogOpen}
        onOpenChange={setIsAddProductDialogOpen}
        initialType={addProductDialogType}
        categories={productCategories}
        onNewCategory={onNewCategory}
        onProductAdded={handleProductAdded}
        locations={locations || []}
        onAddLocationClick={handleOpenAddLocation}
      />
      
       <AddEquipmentDialog
        open={isAddEquipmentDialogOpen}
        onOpenChange={setIsAddEquipmentDialogOpen}
        onEquipmentAdded={handleEquipmentAdded}
        equipmentCategories={productCategories}
        onNewCategory={onNewCategory}
        locations={locations || []}
      />
      
      <AddOverheadDialog
        open={isAddOverheadDialogOpen}
        onOpenChange={setIsAddOverheadDialogOpen}
        onOverheadAdded={handleOverheadAdded}
        categories={productCategories}
        onNewCategory={onNewCategory}
        locations={locations || []}
      />

        {editingItem && editingItem.type === 'equipment' && (
            <EditEquipmentDialog
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
                equipment={editingItem}
                onEquipmentUpdated={handleUpdateItem}
                equipmentCategories={productCategories}
                onNewCategory={onNewCategory}
                locations={locations || []}
            />
        )}
        
        {editingItem && (editingItem.type === 'professional' || editingItem.type === 'retail') && (
            <EditProductDialog
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
                product={editingItem}
                onProductUpdated={handleUpdateItem}
                categories={productCategories}
                onNewCategory={onNewCategory}
                locations={locations || []}
                onAddLocationClick={handleOpenAddLocation}
            />
        )}

      <LogUseDialog
        open={isLogUseOpen}
        onOpenChange={setIsLogUseOpen}
        product={selectedProduct}
        allProducts={inventory || []}
        onConfirm={handleLogUseConfirm}
        dialogType={logUseDialogType}
      />

      {selectedProduct && (
        <WriteOffDialog
            open={isWriteOffOpen}
            onOpenChange={setIsWriteOffOpen}
            product={selectedProduct}
            onConfirm={handleWriteOffConfirm}
        />
      )}
      
      {selectedProduct && (
        <EndCostPerUseTestDialog
            open={isEndExperimentOpen}
            onOpenChange={setIsEndExperimentOpen}
            product={selectedProduct}
            onConfirm={handleEndExperimentConfirmed}
        />
       )}
        <AddLocationDialog 
            open={isAddLocationDialogOpen} 
            onOpenChange={setIsAddLocationDialogOpen}
            onSave={handleSaveLocation}
            locationTypes={locationTypes || []}
            onAddNewLocationType={handleAddNewLocationType}
        />
        {selectedLocation && (
            <EditLocationDialog
                open={isEditLocationDialogOpen}
                onOpenChange={setIsEditLocationDialogOpen}
                location={selectedLocation}
                onSave={handleUpdateLocation}
                locationTypes={locationTypes || []}
                onAddNewLocationType={handleAddNewLocationType}
            />
        )}
        
       <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Scan Product</DialogTitle>
            <DialogDescription>
              Position the product's barcode or QR code inside the frame.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 relative">
             <div id="qr-reader-inventory" className="w-full rounded-md bg-muted" />
             <div className="absolute inset-4 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-1/2 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>
          </div>
           <DialogFooter className="p-4 pt-0">
                <Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

        <AlertDialog open={isBulkDeleteConfirmOpen} onOpenChange={setIsBulkDeleteConfirmOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will permanently delete {selectedItems.size} item(s) from your inventory. This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleBulkDeleteConfirm} className={buttonVariants({ variant: "destructive" })}>
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </div>
    </ClientOnly>
  );
}

