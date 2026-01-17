
'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, PlusCircle, Search, SlidersHorizontal, Package, Hammer, FlaskConical, Pencil, Rocket, CheckCircle, Trash2, Edit, MapPin, Printer, PackageX, Box, Building, Store, ClipboardList, Plus, BarChart, File, Pipette, QrCode, AlertTriangle, ListFilter, ChevronDown, ShoppingCart, Briefcase, DollarSign, Activity, Eye, CircleHelp, Warehouse, Beaker, Recycle, TrendingUp } from 'lucide-react';
import { 
    inventory as initialInventoryData,
    stockCorrections as initialStockCorrectionsData,
    type InventoryItem, 
    type StockCorrection,
    type Client,
    clients as initialClientsData,
    type Transaction,
    type Location,
    type LocationType,
    initialLocations as initialLocationsData,
    initialLocationTypes as initialLocationTypesData,
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
import { AddProductDialog } from '@/components/inventory/AddProductDialog';
import { AddEquipmentDialog } from '@/components/inventory/AddEquipmentDialog';
import { AddOverheadDialog } from '@/components/inventory/AddOverheadDialog';
import { EditProductDialog } from '@/components/inventory/EditProductDialog';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ManageSpoilageDialog, type SpoilageItem } from '@/components/inventory/ManageSpoilageDialog';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { InventorySidebar } from '@/components/inventory/InventorySidebar';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Batch } from '@/lib/data';


const ProductCard = ({ item, onEdit, onToggleExperiment, onEndExperiment, onWriteOff, onLogUse }: { item: InventoryItem, onEdit: (item: InventoryItem) => void, onToggleExperiment: (item: InventoryItem) => void, onEndExperiment: (item: InventoryItem) => void, onWriteOff: (itemId: string) => void, onLogUse: (item: InventoryItem) => void }) => {
    
    const stockStatus = useMemo(() => {
        const hasExpiredBatch = item.batches.some(b => b.expirationDate && isPast(parseISO(b.expirationDate)));
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
            item.isExperimentActive && "shadow-lg shadow-purple-500/10 border-purple-500/20"
        )}>
            <CardContent className="p-4 flex-1 flex flex-col space-y-4">
                <div className="flex items-start gap-4">
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
                                <DropdownMenuItem onClick={() => onEdit(item)}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => item.isExperimentActive ? onEndExperiment(item) : onToggleExperiment(item)}>
                                    {item.isExperimentActive ? <><CheckCircle className="mr-2 h-4 w-4 text-green-500" />End Lifespan Test</> : <><Rocket className="mr-2 h-4 w-4 text-purple-500"/>Start Lifespan Test</>}
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild><Link href={`/inventory/labels?product=${item.id}`}><Printer className="mr-2 h-4 w-4" /> Print Label</Link></DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        <p className="text-sm text-muted-foreground">{item.category}</p>
                    </div>
                </div>
                 <div className="flex items-center justify-between mt-auto">
                    <Badge variant="outline" className={stockStatus.className}>{stockStatus.label}</Badge>
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

const EmptyState = ({ onActionClick }: { onActionClick: () => void }) => (
    <div className="text-center py-20 px-6 col-span-full border-2 border-dashed rounded-lg">
        <div className='flex justify-center mb-6'>
            <div className='w-20 h-20 bg-muted rounded-full flex items-center justify-center'>
                <Package className='w-10 h-10 text-muted-foreground' />
            </div>
        </div>
        <h3 className="text-xl font-semibold mb-2">Your Inventory is Empty</h3>
        <p className="text-muted-foreground max-w-sm mx-auto mb-6">Get started by adding your first product, piece of equipment, or overhead supply.</p>
         <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" /> New Item <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
                <DropdownMenuItem onClick={onActionClick}>
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    <span>Professional/Retail Product</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                    <Hammer className="mr-2 h-4 w-4" />
                    <span>Equipment</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                    <Briefcase className="mr-2 h-4 w-4" />
                    <span>Overhead/Supply</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    </div>
);

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>(initialInventoryData);
  const [stockCorrections, setStockCorrections] = useState<StockCorrection[]>(initialStockCorrectionsData);
  const [locations, setLocations] = useState<Location[]>(initialLocationsData);
  const [locationTypes, setLocationTypes] = useState<LocationType[]>(initialLocationTypesData);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [clients, setClients] = useState<Client[]>(initialClientsData);
  const { toast } = useToast();
  
  const [activeView, setActiveView] = useState('products');
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isAddLocationDialogOpen, setIsAddLocationDialogOpen] = useState(false);
  const [isEditLocationDialogOpen, setIsEditLocationDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isAddEquipmentOpen, setIsAddEquipmentOpen] = useState(false);
  const [isAddOverheadOpen, setIsAddOverheadOpen] = useState(false);
  
  const [isEditProductOpen, setIsEditProductOpen] = useState(false);
  const [isLogUseOpen, setIsLogUseOpen] = useState(false);
  const [isWriteOffOpen, setIsWriteOffOpen] = useState(false);
  const [isEndExperimentOpen, setIsEndExperimentOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<InventoryItem | null>(null);
  const [logUseDialogType, setLogUseDialogType] = useState<'product' | 'overhead'>('product');

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const addStockCorrection = useCallback((correction: StockCorrection) => {
    setStockCorrections(prev => [...prev, correction]);
  }, []);

  const inventoryCategories = useMemo(() => {
    const allCategories = inventory.map(i => i.category).filter((c): c is string => !!c);
    return [...new Set(allCategories)];
  }, [inventory]);
  
  const handleAddProduct = (newProductData: any) => {
    const landedCost = newProductData.totalCostOfGoods && newProductData.numberOfUnits 
      ? (newProductData.totalCostOfGoods + (newProductData.shipping || 0) + (newProductData.taxes || 0)) / newProductData.numberOfUnits 
      : 0;

    const newProduct: InventoryItem = {
        id: `inv-${Date.now()}`,
        name: newProductData.name,
        type: newProductData.type,
        category: newProductData.category,
        totalStock: newProductData.initialQuantity || 0,
        supplier: newProductData.vendor || 'N/A',
        costPerUnit: landedCost,
        reorderPoint: newProductData.reorderPoint,
        primaryLocationId: newProductData.primaryLocationId,
        imageUrl: newProductData.imageUrl,
        description: newProductData.description,
        batches: newProductData.initialQuantity > 0 ? [{
            id: `batch-${Date.now()}`,
            stock: newProductData.initialQuantity,
            costPerUnit: landedCost,
            receivedDate: new Date().toISOString(),
            expirationDate: newProductData.expirationDate || undefined,
        }] : [],
        costingMethod: newProductData.costingMethod,
        size: newProductData.containerSize,
        unit: newProductData.unit,
        estimatedUses: newProductData.estimatedUses,
        useUnit: newProductData.useUnit === 'other' ? newProductData.customUseUnit : newProductData.useUnit,
        isExperimentActive: newProductData.isExperimentActive,
        partialContainerSize: newProductData.costingMethod === 'size' ? 0 : undefined,
        partialContainerUses: newProductData.costingMethod === 'uses' ? 0 : undefined,
    };
    setInventory(prev => [...prev, newProduct]);
  };


  const handleOpenAddLocation = () => setIsAddLocationDialogOpen(true);
  const handleOpenEditLocation = (location: Location) => {
    setSelectedLocation(location);
    setIsEditLocationDialogOpen(true);
  };
  const handleSaveLocation = (newLocation: Omit<Location, 'id'>) => {
    const newLocWithId = { ...newLocation, id: `loc-${Date.now()}`};
    setLocations(prev => [...prev, newLocWithId]);
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

      const newTransaction: Omit<Transaction, 'id'> = {
          date: new Date().toISOString(),
          description: `Inventory Write-off: ${product.name} (${reason})`,
          clientOrVendor: 'Internal',
          type: 'expense',
          context: 'Business',
          category: 'spoilage',
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
    let consumedBatchCost = 0;
    let consumedProduct: InventoryItem | undefined;

    setInventory(prevInventory => {
      const newInventory = JSON.parse(JSON.stringify(prevInventory));
      const productIndex = newInventory.findIndex((p: InventoryItem) => p.id === productId);
      
      if (productIndex === -1) {
        toast({ variant: 'destructive', title: 'Error', description: 'Product not found.' });
        return prevInventory;
      }
  
      const product = newInventory[productIndex];
      consumedProduct = product;

      const sortedBatches = product.batches.sort((a: Batch, b: Batch) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
      const batchToUpdate = sortedBatches.find((b: Batch) => b.stock > 0);
  
      if (!batchToUpdate) {
        toast({ variant: 'destructive', title: 'Error', description: 'No stock available to consume.' });
        return prevInventory;
      }

      consumedBatchCost = batchToUpdate.costPerUnit;
      batchToUpdate.stock -= 1;
      product.totalStock = product.batches.reduce((acc: number, b: Batch) => acc + b.stock, 0);
  
      addStockCorrection({
        id: `sc-${Date.now()}`,
        productId: productId,
        date: new Date().toISOString(),
        change: -1,
        unit: 'unit',
        reason: 'Overhead Consumption',
      });
  
      return newInventory;
    });

    if(consumedProduct && consumedBatchCost > 0) {
      const newTransaction: Omit<Transaction, 'id'> = {
        date: new Date().toISOString(),
        description: `Overhead: ${consumedProduct.name}`,
        clientOrVendor: 'Internal',
        type: 'expense',
        context: 'Business',
        category: 'supplies',
        amount: consumedBatchCost,
        paymentMethod: 'Internal',
        hasReceipt: false,
      };
      setTransactions(prev => [...prev, { ...newTransaction, id: `txn-${Date.now()}` }]);

      toast({ title: 'Overhead Consumed', description: `${consumedProduct.name} has been logged as an expense.` });
    }
  };
  
 const handleSpoilageConfirm = (itemsToWriteOff: SpoilageItem[]) => {
    let totalLoss = 0;
    setInventory(prevInventory => {
      const newInventory = [...prevInventory];
      itemsToWriteOff.forEach(item => {
        const productIndex = newInventory.findIndex(p => p.id === item.productId);
        if (productIndex !== -1) {
          const product = { ...newInventory[productIndex] };
          const batchIndex = product.batches.findIndex(b => b.id === item.batchId);
          if (batchIndex !== -1) {
            const batch = { ...product.batches[batchIndex] };
            const stockChange = batch.stock;
            totalLoss += stockChange * batch.costPerUnit;

            batch.stock = 0;
            product.batches[batchIndex] = batch;

            product.totalStock = product.batches.reduce((acc, b) => acc + b.stock, 0);
            
            if (product.totalStock === 0) {
              product.partialContainerSize = 0;
              product.partialContainerUses = 0;
            }

            newInventory[productIndex] = product;

            addStockCorrection({
              id: `sc-${Date.now()}-${item.productId}`,
              productId: item.productId,
              date: new Date().toISOString(),
              change: -stockChange,
              unit: 'units',
              reason: 'Expired',
            });
          }
        }
      });
      return newInventory;
    });

    if (totalLoss > 0) {
        const newTransaction: Omit<Transaction, 'id'> = {
            date: new Date().toISOString(),
            description: `Inventory Write-off: ${itemsToWriteOff.length} expired item(s)`,
            clientOrVendor: 'Internal',
            type: 'expense',
            context: 'Business',
            category: 'spoilage',
            amount: totalLoss,
            paymentMethod: 'Internal',
            hasReceipt: false,
        };
        setTransactions(prev => [...prev, { ...newTransaction, id: `txn-${Date.now()}` }]);
    }

    toast({
      title: 'Spoilage Written Off',
      description: `${itemsToWriteOff.length} item(s) have been removed from inventory and expensed.`,
    });
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
    let items = inventory;

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
  }, [inventory, activeFilter, searchTerm]);

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

  return (
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
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="products">Products</TabsTrigger>
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
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button className='w-full sm:w-auto'>
                                            <PlusCircle className="mr-2 h-4 w-4" /> New Item <ChevronDown className="ml-2 h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => setIsAddProductOpen(true)}>
                                            <ShoppingCart className="mr-2 h-4 w-4" />
                                            <span>Professional/Retail Product</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setIsAddEquipmentOpen(true)}>
                                            <Hammer className="mr-2 h-4 w-4" />
                                            <span>Equipment</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setIsAddOverheadOpen(true)}>
                                            <Briefcase className="mr-2 h-4 w-4" />
                                            <span>Overhead/Supply</span>
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
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
                            {inventory.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                    {filteredInventory.length > 0 ? filteredInventory.map(item => (
                                        <ProductCard 
                                            key={item.id}
                                            item={item} 
                                            onEdit={() => {}} 
                                            onToggleExperiment={handleToggleExperiment} 
                                            onEndExperiment={handleEndExperiment} 
                                            onWriteOff={handleOpenWriteOff} 
                                            onLogUse={handleOpenLogUse}
                                        />
                                    )) : (
                                        <p className="text-muted-foreground col-span-full text-center">No items match your search.</p>
                                    )}
                                </div>
                            ) : (
                                <EmptyState onActionClick={() => setIsAddProductOpen(true)} />
                            )}
                        </CardContent>
                    </Card>
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
        
        <AddProductDialog 
            open={isAddProductOpen}
            onOpenChange={setIsAddProductOpen}
            locations={locations}
            locationTypes={locationTypes}
            onProductAdded={handleAddProduct}
            initialCategories={inventoryCategories}
            onAddNewLocation={handleSaveLocation}
            onAddNewLocationType={handleAddNewLocationType}
        />

        <AddEquipmentDialog 
            open={isAddEquipmentOpen}
            onOpenChange={setIsAddEquipmentOpen}
            locations={locations}
            locationTypes={locationTypes}
            isAddLocationDialogOpen={isAddLocationDialogOpen}
            onAddLocationDialogOpenChange={setIsAddLocationDialogOpen}
            onAddNewLocation={handleSaveLocation}
            onAddNewLocationType={handleAddNewLocationType}
            onEquipmentAdded={() => {}}
        />
        
        <AddOverheadDialog 
            open={isAddOverheadOpen}
            onOpenChange={setIsAddOverheadOpen}
            locations={locations}
            onOverheadAdded={() => {}}
        />


       <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Scan Product</DialogTitle>
            <DialogDescription>
              Position the product's barcode or QR code inside the frame.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 relative">
             <video ref={videoRef} className="w-full aspect-video rounded-md" autoPlay muted playsInline />
             <div className="absolute inset-4 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-1/2 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
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
    </div>
  );
}
