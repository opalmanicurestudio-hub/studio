

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
import { MoreHorizontal, PlusCircle, Search, SlidersHorizontal, Package, Hammer, FlaskConical, Pencil, Rocket, CheckCircle, Trash2, Edit, MapPin, Printer, PackageX, Box, Building, Store, ClipboardList, Plus, BarChart, File, Pipette, QrCode, AlertTriangle, ListFilter, ChevronDown, ShoppingCart, Briefcase, DollarSign, Activity, Eye, CircleHelp, Warehouse, Beaker, Recycle, TrendingUp, Truck, Clock, Check } from 'lucide-react';
import { 
    inventory as initialInventoryData,
    stockCorrections as initialStockCorrectionsData,
    type InventoryItem, 
    type StockCorrection,
    type Client,
    clients as initialClientsData,
    type Appointment,
    type Location,
    type LocationType,
    services as initialServicesData,
    appointments as initialAppointmentsData,
    billDefinitions as initialBillDefinitionsData,
    billInstances as initialBillInstancesData,
    initialLocations as initialLocationsData,
    initialLocationTypes as initialLocationTypesData,
    type Order,
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
import { ManageSpoilageDialog, type SpoilageItem } from '@/components/inventory/ManageSpoilageDialog';
import { InventorySidebar } from '@/components/inventory/InventorySidebar';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { type Batch } from '@/lib/data';
import { ScrollArea } from '@/components/ui/scroll-area';
import { transactions as initialTransactionsData, type Transaction } from '@/lib/financial-data';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { AddProductDialog } from '@/components/inventory/AddProductDialog';
import { AddEquipmentDialog } from '@/components/inventory/AddEquipmentDialog';
import { AddOverheadDialog } from '@/components/inventory/AddOverheadDialog';
import { useInventory } from '@/context/InventoryContext';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { EditProductDialog } from '@/components/inventory/EditProductDialog';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { BrowseProductsDialog } from '@/components/services/BrowseProductsDialog';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';


const OrderCard = ({ order }: { order: Order }) => {
    const getStatusVariant = (status: Order['status']) => {
        switch (status) {
            case 'Placed': return { icon: <Clock className="h-3 w-3" />, className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300' };
            case 'Shipped': return { icon: <Truck className="h-3 w-3" />, className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300' };
            case 'Received':
            case 'Partially Received':
                return { icon: <Check className="h-3 w-3" />, className: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' };
            default: return { icon: <Package className="h-3 w-3" />, className: 'bg-gray-100 text-gray-700' };
        }
    };
    const statusInfo = getStatusVariant(order.status);
    const totalItems = order.items.reduce((acc, item) => acc + item.quantity, 0);
    const totalCost = order.items.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="text-base">{order.supplier}</CardTitle>
                        <CardDescription>Order placed: {format(parseISO(order.orderDate), 'MMM d, yyyy')}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge className={statusInfo.className}>{statusInfo.icon} <span className="ml-1.5">{order.status}</span></Badge>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem>View/Edit Order</DropdownMenuItem>
                                <DropdownMenuItem>Receive Stock</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-sm space-y-2">
                    <p><strong>{totalItems}</strong> items ordered</p>
                    <p>Total Cost: <strong>${totalCost.toFixed(2)}</strong></p>
                    {order.trackingNumber && <p>Tracking: <strong>{order.trackingNumber}</strong></p>}
                    {order.expectedArrivalDate && <p>Expected: <strong>{format(parseISO(order.expectedArrivalDate), 'MMM d, yyyy')}</strong></p>}
                </div>
            </CardContent>
        </Card>
    );
}

const AddOrderDialog = ({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (orderData: Omit<Order, 'id'>) => void;
}) => {
    const { inventory: products } = useInventory();
    const [supplier, setSupplier] = useState('');
    const [orderDate, setOrderDate] = useState<Date | undefined>(new Date());
    const [expectedDate, setExpectedDate] = useState<Date | undefined>();
    const [trackingNumber, setTrackingNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [items, setItems] = useState<OrderItem[]>([]);

    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    
    type OrderItem = {
        productId: string;
        productName: string;
        quantity: number;
        costPerUnit: number;
    };

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
        let newOrder: Omit<Order, 'id'> = {
            supplier,
            orderDate: (orderDate || new Date()).toISOString(),
            status: 'Draft',
            trackingNumber,
            notes,
            items,
        };

        if (expectedDate) {
            newOrder = {
                ...newOrder,
                expectedArrivalDate: expectedDate.toISOString(),
            };
        }

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

const OrdersTab = ({ orders, isLoading, onAddOrder }: { orders: Order[], isLoading: boolean, onAddOrder: (order: Omit<Order, 'id'>) => void }) => {
    const [isAddOrderOpen, setIsAddOrderOpen] = useState(false);
    
    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>Purchase Orders</CardTitle>
                            <CardDescription>Track your inventory supply orders.</CardDescription>
                        </div>
                        <Button onClick={() => setIsAddOrderOpen(true)}><PlusCircle className="mr-2"/>New Order</Button>
                    </div>
                </CardHeader>
                <CardContent>
                     {isLoading ? <p>Loading orders...</p> : orders.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {orders.map(order => <OrderCard key={order.id} order={order} />)}
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
        </>
    );
};


const ProductCard = ({ item, onEdit, onToggleExperiment, onEndExperiment, onWriteOff, onLogUse, isSelected, onSelect, isOrdered }: { item: InventoryItem, onEdit: (item: InventoryItem) => void, onToggleExperiment: (item: InventoryItem) => void, onEndExperiment: (item: InventoryItem) => void, onWriteOff: (itemId: string) => void, onLogUse: (item: InventoryItem) => void, isSelected: boolean, onSelect: () => void, isOrdered: boolean }) => {
    
    const stockStatus = useMemo(() => {
        const hasExpiredBatch = item.batches.some(b => b.expirationDate && isPast(parseISO(b.expirationDate)) && b.stock > 0);
        if (hasExpiredBatch) return { label: 'Expired', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-600/30' };
        if (item.totalStock <= 0 && (item.partialContainerUses === undefined || item.partialContainerUses <= 0) && (item.partialContainerSize === undefined || item.partialContainerSize <= 0) ) return { label: 'Out of Stock', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-600/30' };
        if (item.reorderPoint && item.totalStock <= item.reorderPoint) return { label: 'Low Stock', className: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-400 dark:border-yellow-600/30' };
        return { label: 'In Stock', className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-600/30' };
    }, [item]);

    const detailHref = `/inventory/${item.id}`;

    let stockDisplay;

    if (item.costingMethod === 'size' && typeof item.partialContainerSize === 'number') {
        stockDisplay = (
            <div className="text-right">
                <p className="font-mono font-semibold text-lg">{item.totalStock} <span className="text-sm text-muted-foreground">full</span></p>
                <p className="text-xs text-muted-foreground">{item.partialContainerSize.toFixed(0)}{item.unit} left</p>
            </div>
        );
    } else if (item.costingMethod === 'uses' && typeof item.partialContainerUses === 'number') {
         stockDisplay = (
            <div className="text-right">
                <p className="font-mono font-semibold text-lg">{item.totalStock} <span className="text-sm text-muted-foreground">full</span></p>
                <p className="text-xs text-muted-foreground">{item.partialContainerUses} {item.useUnit || 'uses'} left</p>
            </div>
        );
    } else {
        stockDisplay = (
             <div className="text-right">
                <p className="font-mono font-semibold text-lg">{item.totalStock}</p>
                <p className="text-xs text-muted-foreground">{item.unit || 'units'}</p>
            </div>
        );
    }
    
    return (
        <Card className={cn(
            "transition-all duration-200 hover:shadow-xl hover:-translate-y-1 flex flex-col",
            item.isExperimentActive && "shadow-lg shadow-purple-500/10 border-purple-500/20",
            isSelected && "border-primary ring-2 ring-primary"
        )}>
            <CardContent className="p-4 flex-1 flex flex-col space-y-4">
                 <div className="flex items-start gap-4">
                    <div className="flex items-center pt-1">
                        <Checkbox
                            id={`select-${item.id}`}
                            checked={isSelected}
                            onCheckedChange={onSelect}
                            aria-label={`Select ${item.name}`}
                        />
                    </div>
                     <Link href={detailHref} className='w-20 h-20 bg-muted rounded-md flex-shrink-0'>
                        <Image src={item.imageUrl || `https://picsum.photos/seed/inv${item.id}/100/100`} alt={item.name} width={80} height={80} className='rounded-md object-cover' data-ai-hint="product photo"/>
                    </Link>
                    <div className='flex-1 min-w-0'>
                        <div className="flex justify-between items-start">
                            <Link href={detailHref} className="group">
                               <p className="font-semibold text-base leading-tight group-hover:underline pr-2">{item.name}</p>
                            </Link>
                            <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button aria-haspopup="true" size="icon" variant="ghost" className="h-8 w-8 flex-shrink-0 -mt-1 -mr-1">
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Toggle menu</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild><Link href={detailHref}>View Details</Link></DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onEdit(item)}>
                                    <Edit className="mr-2 h-4 w-4"/>Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => item.isExperimentActive ? onEndExperiment(item) : onToggleExperiment(item)}>
                                    {item.isExperimentActive ? <><CheckCircle className="mr-2 h-4 w-4 text-green-500" />End Lifespan Test</> : <><Rocket className="mr-2 h-4 w-4 text-purple-500"/>Start Lifespan Test</>}
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild><Link href={`/inventory/labels?product=${item.id}`}><Printer className="mr-2 h-4 w-4" /> Print Label</Link></DropdownMenuItem>
                            </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        <p className="text-sm text-muted-foreground">{item.category}</p>
                    </div>
                </div>
                 <div className="flex items-center justify-between mt-auto">
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className={stockStatus.className}>{stockStatus.label}</Badge>
                        {isOrdered && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Truck className="h-4 w-4 text-blue-500" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>This item is on order.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                    {stockDisplay}
                </div>
            </CardContent>
             <CardFooter className="p-2 border-t bg-muted/50">
                <div className="grid grid-cols-2 gap-2 w-full">
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => onLogUse(item)}><Pipette className="mr-2 h-4 w-4"/>Log Use</Button>
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => onWriteOff(item.id)}><PackageX className="mr-2 h-4 w-4"/>Write-off</Button>
                </div>
            </CardFooter>
        </Card>
    )
}

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
    inventory, setInventory, 
    stockCorrections, addStockCorrection,
    locations, setLocations, 
    locationTypes, setLocationTypes,
    setTransactions 
  } = useInventory();
  
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const tenantId = 'tenant-abc';
  
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
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [selectedItems, setSelectedItems] = useState(new Set<string>());
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 8;
  
  const ordersQuery = useMemoFirebase(() => firestore ? collection(firestore, `tenants/${tenantId}/orders`) : null, [firestore, tenantId]);
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
    setInventory(prev => prev.map(item => item.id === updatedItem.id ? updatedItem : item));
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
    if (!firestore) return;
    const itemCount = selectedItems.size;
    selectedItems.forEach(id => {
      const clientDoc = doc(firestore, `tenants/${tenantId}/clients`, id);
      deleteDocumentNonBlocking(clientDoc);
    });
    setInventory(prev => prev.filter(item => !selectedItems.has(item.id)));
    setSelectedItems(new Set());
    setIsBulkDeleteConfirmOpen(false);
    toast({
        title: "Items Deleted",
        description: `${itemCount} item(s) have been removed from your inventory.`,
    })
  }, [selectedItems, setInventory, toast, firestore, tenantId]);

    const handleBulkArchive = useCallback(() => {
        if (!firestore) return;
        selectedItems.forEach(id => {
            const itemDoc = doc(firestore, `tenants/${tenantId}/inventory`, id);
            updateDocumentNonBlocking(itemDoc, { status: 'archived' });
        });
        setInventory(prev =>
            prev.map(item =>
                selectedItems.has(item.id) ? { ...item, status: 'archived' } : item
            )
        );
        toast({ title: `${selectedItems.size} item(s) have been archived.` });
        setSelectedItems(new Set());
    }, [selectedItems, setInventory, toast, firestore, tenantId]);

    const handleBulkUnarchive = useCallback(() => {
        if (!firestore) return;
        selectedItems.forEach(id => {
            const itemDoc = doc(firestore, `tenants/${tenantId}/inventory`, id);
            updateDocumentNonBlocking(itemDoc, { status: 'active' });
        });
        setInventory(prev =>
            prev.map(item =>
                selectedItems.has(item.id) ? { ...item, status: 'active' } : item
            )
        );
        toast({ title: `${selectedItems.size} item(s) have been restored.` });
        setSelectedItems(new Set());
    }, [selectedItems, setInventory, toast, firestore, tenantId]);


  const handleOpenAddProductDialog = (type: 'professional' | 'retail') => {
    setAddProductDialogType(type);
    setIsAddProductDialogOpen(true);
  };
  
  const handleProductAdded = (newProduct: InventoryItem) => {
    setInventory(prev => [...prev, newProduct]);
    toast({
      title: `New ${newProduct.type} product created`,
      description: `${newProduct.name} has been added to your inventory.`
    });
  };

  const handleEquipmentAdded = (newEquipment: InventoryItem) => {
    setInventory(prev => [...prev, newEquipment]);
  };
  
  const handleOverheadAdded = (newOverhead: InventoryItem) => {
    setInventory(prev => [...prev, newOverhead]);
  };
  
  const handleAddOrder = (newOrderData: Omit<Order, 'id'>) => {
    if (!firestore) return;
    const newOrder: Order = {
      ...newOrderData,
      id: nanoid(),
      status: 'Draft',
    };
    const orderRef = collection(firestore, 'tenants', tenantId, 'orders');
    addDocumentNonBlocking(orderRef, newOrder);
    toast({
      title: "Order Created!",
      description: `Your order to ${newOrder.supplier} has been saved.`
    });
  };

  const handleOpenAddLocation = () => setIsAddLocationDialogOpen(true);
  
  const handleOpenEditLocation = (location: Location) => {
    setSelectedLocation(location);
    setIsEditLocationDialogOpen(true);
  };
  
  const handleSaveLocation = (newLocation: Omit<Location, 'id'>) => {
    const newLocWithId = { ...newLocation, id: `loc-${Date.now()}`};
    setLocations(prev => [...prev, newLocWithId]);
    return newLocWithId;
  };

  const handleUpdateLocation = (updatedLocation: Location) => {
    setLocations(prev => prev.map(loc => loc.id === updatedLocation.id ? updatedLocation : loc));
  };

  const handleAddNewLocationType = (name: string, icon: string): LocationType => {
    const newType = { id: `lt-${Date.now()}`, name, icon };
    setLocationTypes(prev => [...prev, newType]);
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

  const handleOpenWriteOff = (itemId: string) => {
    const productToWriteOff = inventory.find(item => item.id === itemId);
    if(productToWriteOff) {
      setSelectedProduct(productToWriteOff);
      setIsWriteOffOpen(true);
    }
  }
  
  const handleLogUseConfirm = (productId: string, quantity: number, notes: string): { success: boolean, message: string } => {
    let success = false;
    let message = '';
    
    setInventory(prevInventory => {
        const newInventory = JSON.parse(JSON.stringify(prevInventory));
        const productIndex = newInventory.findIndex((p: InventoryItem) => p.id === productId);
        
        if (productIndex === -1) {
            message = 'Product not found.';
            return prevInventory;
        }

        const product = newInventory[productIndex];
        let unit = product.unit || 'units';

        if (product.isExperimentActive) {
            product.experimentUses = (product.experimentUses || 0) + quantity;
        } else if (product.costingMethod === 'uses') {
            unit = product.useUnit || 'uses';
            let currentUses = product.partialContainerUses || 0;
            
            if (currentUses >= quantity) {
                product.partialContainerUses -= quantity;
            } else {
                let usesNeeded = quantity - currentUses;
                product.partialContainerUses = 0;
                
                const usesPerContainer = product.estimatedUses || 1;
                
                const containersToOpen = Math.ceil(usesNeeded / usesPerContainer);

                if (product.totalStock >= containersToOpen) {
                    product.totalStock -= containersToOpen;
                    const remainingUses = (containersToOpen * usesPerContainer) - usesNeeded;
                    product.partialContainerUses = remainingUses;
                } else {
                    message = `Insufficient stock for ${product.name}. Cannot log use.`;
                    return prevInventory;
                }
            }
        } else if (product.costingMethod === 'size') {
            unit = product.unit || 'units';
            let currentSize = product.partialContainerSize || 0;

            if (currentSize >= quantity) {
                product.partialContainerSize -= quantity;
            } else {
                let sizeNeeded = quantity - currentSize;
                product.partialContainerSize = 0;

                const sizePerContainer = product.size || 1;
                const containersToOpen = Math.ceil(sizeNeeded / sizePerContainer);

                 if (product.totalStock >= containersToOpen) {
                    product.totalStock -= containersToOpen;
                    const remainingSize = (containersToOpen * sizePerContainer) - sizeNeeded;
                    product.partialContainerSize = remainingSize;
                } else {
                    message = `Insufficient stock for ${product.name}. Cannot log use.`;
                    return prevInventory;
                }
            }
        } else {
            if (product.totalStock >= quantity) {
                product.totalStock -= quantity;
                let remainingToDeduct = quantity;
                const sortedBatches = product.batches.filter((b: Batch) => b.stock > 0).sort((a: Batch, b: Batch) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
                for (const batch of sortedBatches) {
                    if (remainingToDeduct === 0) break;
                    const canDeduct = Math.min(batch.stock, remainingToDeduct);
                    batch.stock -= canDeduct;
                    remainingToDeduct -= canDeduct;
                }
            } else {
                 message = `Insufficient stock for ${product.name}. Only ${product.totalStock} units available.`;
                 return prevInventory;
            }
        }

        const newCorrection: StockCorrection = {
            id: `sc-${Date.now()}`,
            productId: productId,
            date: new Date().toISOString(),
            change: -quantity,
            unit: unit,
            reason: notes || (product.isExperimentActive ? 'Experiment Use' : 'Manual Use'),
        };
        addStockCorrection(newCorrection);
        
        success = true;
        if (!message) {
             if (product.isExperimentActive) {
                message = `Logged ${quantity} experimental use(s) for ${product.name}.`;
             } else {
                message = `${quantity} ${unit} of ${product.name} logged.`;
             }
        }
        
        return newInventory;
    });

    return { success, message };
  };

  const handleWriteOffConfirm = (productId: string, batchId: string, quantity: number, reason: string): { success: boolean, message: string } => {
    let success = false;
    let message = '';
  
    setInventory(prevInventory => {
      const newInventory = [...prevInventory];
      const productIndex = newInventory.findIndex(p => p.id === productId);
  
      if (productIndex === -1) {
        message = 'Product not found.';
        return prevInventory;
      }
  
      const product = { ...newInventory[productIndex] };
      const batchIndex = product.batches.findIndex(b => b.id === batchId);
  
      if (batchIndex === -1) {
        message = 'Batch not found.';
        return prevInventory;
      }
  
      const batch = { ...product.batches[batchIndex] };
  
      if (batch.stock < quantity) {
        message = `Cannot write off more than available in batch (${batch.stock}).`;
        return prevInventory;
      }
  
      batch.stock -= quantity;
      product.batches[batchIndex] = batch;
  
      product.totalStock = product.batches.reduce((acc, b) => acc + b.stock, 0);
  
      if (product.totalStock === 0) {
        product.partialContainerSize = 0;
        product.partialContainerUses = 0;
      }
  
      newInventory[productIndex] = product;
  
      const newCorrection: StockCorrection = {
        id: `sc-${Date.now()}`,
        productId: productId,
        date: new Date().toISOString(),
        change: -quantity,
        unit: 'units',
        reason: reason,
      };
      addStockCorrection(newCorrection);
  
      const newTransaction = {
        date: new Date().toISOString(),
        description: `Write-off: ${quantity} x ${product.name}`,
        clientOrVendor: 'Internal',
        type: 'expense' as const,
        context: 'Business' as const,
        category: 'Spoilage',
        amount: batch.costPerUnit * quantity,
        paymentMethod: 'Internal',
        hasReceipt: false,
      };
      setTransactions(prev => [...prev, { ...newTransaction, id: `txn-${Date.now()}` }]);
  
      success = true;
      message = `${quantity} unit(s) of ${product.name} written off.`;
      return newInventory;
    });
  
    return { success, message };
  };

  const handleLogOverheadConsumption = (productId: string) => {
    // This function logic would be very similar to handleLogUseConfirm but simplified for single-unit overhead items.
    toast({ title: 'Overhead Consumed', description: `An overhead item has been logged as an expense.` });
  };
  
 const handleSpoilageConfirm = (itemsToWriteOff: SpoilageItem[]) => {
    let totalLoss = 0;
    itemsToWriteOff.forEach(item => {
        handleWriteOffConfirm(item.productId, item.batchId, item.stock, 'Expired');
        totalLoss += item.stock * item.costPerUnit;
    });

    if (itemsToWriteOff.length > 0) {
        toast({
            title: 'Spoilage Written Off',
            description: `${itemsToWriteOff.length} item(s) totaling $${totalLoss.toFixed(2)} have been removed and expensed.`,
        });
    }
  };
  
  const handleToggleExperiment = (item: InventoryItem) => {
    setInventory(prev => prev.map(p => 
        p.id === item.id 
        ? { ...p, isExperimentActive: true, experimentUses: 0 } 
        : p
    ));
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
    if (!selectedProduct) return;
    
    setInventory(prev => prev.map(p => 
        p.id === selectedProduct.id 
        ? { ...p, isExperimentActive: false, lastTestResult: results } 
        : p
    ));

    toast({
        title: "Experiment Ended",
        description: `Cost-per-use tracking for ${selectedProduct.name} has been stopped.`,
    });
    setIsEndExperimentOpen(false);
    setSelectedProduct(null);
  }

  const filteredInventory = useMemo(() => {
    let items = inventory.filter(item => {
      return showArchived ? item.status === 'archived' : item.status !== 'archived';
    });

    if (activeFilter !== 'all') {
      items = items.filter(item => item.type === activeFilter);
    }
    
    if (searchTerm) {
        items = items.filter(item => 
            item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.id.toLowerCase().includes(searchTerm.toLowerCase())
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


  useEffect(() => {
    if (isScannerOpen) {
      const getCameraPermission = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          setHasCameraPermission(true);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        } catch (error) {
          console.error('Error accessing camera:', error);
          setHasCameraPermission(false);
          toast({
            variant: 'destructive',
            title: 'Camera Access Denied',
            description: 'Please enable camera permissions in your browser settings to use this app.',
          });
        }
      };
      getCameraPermission();
    } else {
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
    }
  }, [isScannerOpen, toast]);
  
  const hasInventory = inventory.length > 0;
  const hasFilteredInventory = filteredInventory.length > 0;

  const productCategories = useMemo(() => {
    const allCategories = inventory.map(p => p.category).filter((c): c is string => !!c);
    return [...new Set(allCategories)];
  }, [inventory]);

  const onNewCategory = useCallback((newCategory: string) => {
    // This logic would ideally be in the context, but for now, it's local
    // to demonstrate the dialog functionality.
  }, []);

  return (
    <ClientOnly>
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Inventory Hub" />
      <main className="flex-1 p-4 md:p-8">
        
        <div className="grid lg:grid-cols-4 gap-8">
            <div className="hidden lg:block lg:col-span-1">
                <InventorySidebar
                  inventory={inventory}
                  stockCorrections={stockCorrections}
                  onSpoilageConfirm={handleSpoilageConfirm} 
                  onLogOverheadUse={handleLogOverheadConsumption} 
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
                                      inventory={inventory}
                                      stockCorrections={stockCorrections}
                                      onSpoilageConfirm={handleSpoilageConfirm}
                                      onLogOverheadUse={handleLogOverheadConsumption}
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
                                            placeholder="Search by name or SKU..." 
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
                                            onWriteOff={handleOpenWriteOff} 
                                            onLogUse={handleOpenLogUse}
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
                        isLoading={ordersLoading} 
                        onAddOrder={handleAddOrder}
                    />
                </TabsContent>
                <TabsContent value="locations" className="mt-6">
                        <Locations 
                            locations={locations}
                            locationTypes={locationTypes}
                            inventory={inventory}
                            setLocations={setLocations}
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
        locations={locations}
        onAddLocationClick={handleOpenAddLocation}
      />
      
       <AddEquipmentDialog
        open={isAddEquipmentDialogOpen}
        onOpenChange={setIsAddEquipmentDialogOpen}
        onEquipmentAdded={handleEquipmentAdded}
        equipmentCategories={productCategories.filter(c => c === 'Tools')}
        onNewCategory={onNewCategory}
        locations={locations}
      />
      
      <AddOverheadDialog
        open={isAddOverheadDialogOpen}
        onOpenChange={setIsAddOverheadDialogOpen}
        onOverheadAdded={handleOverheadAdded}
        categories={productCategories.filter(c => c === 'Cleaning')}
        onNewCategory={onNewCategory}
        locations={locations}
      />

        {editingItem && editingItem.type === 'equipment' && (
            <EditEquipmentDialog
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
                equipment={editingItem}
                onEquipmentUpdated={handleUpdateItem}
                equipmentCategories={productCategories}
                onNewCategory={onNewCategory}
                locations={locations}
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
                locations={locations}
                onAddLocationClick={handleOpenAddLocation}
            />
        )}

      <LogUseDialog
        open={isLogUseOpen}
        onOpenChange={setIsLogUseOpen}
        product={selectedProduct}
        allProducts={inventory}
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
            locationTypes={locationTypes}
            onAddNewLocationType={handleAddNewLocationType}
        />
        {selectedLocation && (
            <EditLocationDialog
                open={isEditLocationDialogOpen}
                onOpenChange={setIsEditLocationDialogOpen}
                location={selectedLocation}
                onSave={handleUpdateLocation}
                locationTypes={locationTypes}
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
             <video ref={videoRef} className="w-full aspect-video rounded-md bg-muted" autoPlay muted playsInline />
             <div className="absolute inset-4 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>
            {hasCameraPermission === false && (
                <Alert variant="destructive" className="mt-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Camera Access Required</AlertTitle>
                    <AlertDescription>
                        Please enable camera permissions in your browser settings to use this feature.
                    </AlertDescription>
                </Alert>
            )}
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

    

