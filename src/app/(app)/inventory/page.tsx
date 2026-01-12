
'use client';

import React, { useState, useMemo } from 'react';
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
import { MoreHorizontal, PlusCircle, Search, SlidersHorizontal, Package, Hammer, FlaskConical, Pencil, Rocket, CheckCircle, Trash2, Edit, MapPin, Printer, PackageX, Box, Building, Store, ClipboardList, Plus, BarChart, File, Pipette } from 'lucide-react';
import { type InventoryItem, type StockCorrection } from '@/lib/data';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { AddProductDialog } from '@/components/inventory/AddProductDialog';
import { EditProductDialog } from '@/components/inventory/EditProductDialog';
import { AddLocationDialog, type Location, type LocationType } from '@/components/inventory/AddLocationDialog';
import { EndCostPerUseTestDialog } from '@/components/inventory/EndCostPerUseTestDialog';
import { WriteOffDialog } from '@/components/inventory/WriteOffDialog';
import { LogUseDialog } from '@/components/inventory/LogUseDialog';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { isPast, parseISO } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { ClientOnly } from '@/components/shared/ClientOnly';

const KPI_CARDS = [
    { title: "Total Inventory Value", value: "$1,850.75", icon: Package, description: "Landed cost of all stock" },
    { title: "Potential Revenue", value: "$4,320.00", icon: BarChart, description: "Retail value of sellable stock" },
    { title: "At-Risk Stock", value: "$75.00", icon: PackageX, description: "Value of expired/expiring items" },
    { title: "Items to Reorder", value: "3", icon: ClipboardList, description: "Products at or below reorder point" }
];

const ProductCard = ({ item, onEdit, onToggleExperiment, onEndExperiment, onWriteOff, onLogUse }: { item: InventoryItem, onEdit: (item: InventoryItem) => void, onToggleExperiment: (item: InventoryItem) => void, onEndExperiment: (item: InventoryItem) => void, onWriteOff: (item: InventoryItem) => void, onLogUse: (item: InventoryItem) => void }) => {
    
    const stockStatus = useMemo(() => {
        const hasExpiredBatch = item.batches.some(b => b.expirationDate && isPast(parseISO(b.expirationDate)));
        if (hasExpiredBatch) return { label: 'Expired', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-600/30' };
        if (item.totalStock <= 0 && (item.partialContainerUses === undefined || item.partialContainerUses <= 0) && (item.partialContainerSize === undefined || item.partialContainerSize <= 0) ) return { label: 'Out of Stock', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-600/30' };
        if (item.reorderPoint && item.totalStock <= item.reorderPoint) return { label: 'Low Stock', className: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-400 dark:border-yellow-600/30' };
        return { label: 'In Stock', className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-600/30' };
    }, [item]);

    const detailHref = `/inventory/${item.id}`;

    const stockDisplay = useMemo(() => {
      return (
        <div className="text-right">
            <p className="font-mono font-semibold text-lg">{item.totalStock} <span className="text-sm text-muted-foreground">full</span></p>
            {item.costingMethod === 'size' && item.partialContainerSize !== undefined && (
                <p className="text-xs text-muted-foreground">{item.partialContainerSize.toFixed(0)}{item.unit} left in open container</p>
            )}
            {item.costingMethod === 'uses' && item.partialContainerUses !== undefined && (
                <p className="text-xs text-muted-foreground">{item.partialContainerUses} uses left in open container</p>
            )}
        </div>
      )
    }, [item]);
    
    return (
        <Card className={cn("transition-all duration-200 hover:shadow-lg flex flex-col", item.isExperimentActive && "shadow-lg shadow-purple-500/10 border-purple-500/20")}>
            <CardContent className="p-4 flex-1 flex flex-col">
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
                                <DropdownMenuItem asChild><Link href={`/inventory/labels?product=${item.id}`}><Printer className="mr-2 h-4 w-4" /> Print Label</Link></DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        <p className="text-sm text-muted-foreground">{item.category}</p>
                    </div>
                </div>
                 <div className="mt-4 flex items-center justify-between">
                    <Badge variant="outline" className={stockStatus.className}>{stockStatus.label}</Badge>
                    {stockDisplay}
                </div>
            </CardContent>
             <CardFooter className="p-2 border-t bg-muted/50">
                <div className="grid grid-cols-2 gap-2 w-full">
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => onLogUse(item)}><Pipette className="mr-2"/>Log Use</Button>
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => onWriteOff(item)}><PackageX className="mr-2"/>Write-off</Button>
                </div>
            </CardFooter>
        </Card>
    )
}

const EmptyState = ({ message, onActionClick }: { message: string, onActionClick: () => void }) => (
    <div className="text-center py-20 px-6 col-span-full border-2 border-dashed rounded-lg">
        <div className='flex justify-center mb-6'>
            <div className='w-20 h-20 bg-muted rounded-full flex items-center justify-center'>
                <Package className='w-10 h-10 text-muted-foreground' />
            </div>
        </div>
        <h3 className="text-xl font-semibold mb-2">No Items Found</h3>
        <p className="text-muted-foreground max-w-sm mx-auto mb-6">{message}</p>
        <Button onClick={onActionClick}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add Your First Product
        </Button>
    </div>
);

export default function InventoryPage() {
  const { inventory, setInventory, addStockCorrection, stockCorrections, locations, setLocations, locationTypes, setLocationTypes } = useInventory();
  const { toast } = useToast();
  
  const [activeTab, setActiveTab] = useState('all');
  const [isAddLocationDialogOpen, setAddLocationDialogOpen] = useState(false);
  const [isEditLocationDialogOpen, setIsEditLocationDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isLogUseOpen, setIsLogUseOpen] = useState(false);
  const [isWriteOffOpen, setIsWriteOffOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<InventoryItem | null>(null);

  const handleOpenLogUse = (item: InventoryItem) => {
    setSelectedProduct(item);
    setIsLogUseOpen(true);
  }

  const handleOpenWriteOff = (item: InventoryItem) => {
    setSelectedProduct(item);
    setIsWriteOffOpen(true);
  }
  
  const handleLogUseConfirm = (productId: string, quantity: number, notes: string): { success: boolean, message: string } => {
    let success = false;
    let message = '';
    
    setInventory(prev => {
        const newInventory = [...prev];
        const productIndex = newInventory.findIndex(p => p.id === productId);
        if (productIndex === -1) {
            message = 'Product not found.';
            return prev;
        }

        const product = { ...newInventory[productIndex] };
        let unit = product.unit || 'units';

        if (product.costingMethod === 'uses') {
            unit = 'uses';
            let currentTotalUses = (product.totalStock * (product.estimatedUses || 1)) + (product.partialContainerUses || 0);
            if (currentTotalUses < quantity) {
                message = 'Insufficient stock to log this use.';
                return prev;
            }
            currentTotalUses -= quantity;
            product.totalStock = Math.floor(currentTotalUses / (product.estimatedUses || 1));
            product.partialContainerUses = currentTotalUses % (product.estimatedUses || 1);
        } else if (product.costingMethod === 'size') {
            unit = product.unit || 'ml';
            let currentTotalSize = (product.totalStock * (product.size || 1)) + (product.partialContainerSize || 0);
             if (currentTotalSize < quantity) {
                message = 'Insufficient stock to log this use.';
                return prev;
            }
            currentTotalSize -= quantity;
            product.totalStock = Math.floor(currentTotalSize / (product.size || 1));
            product.partialContainerSize = currentTotalSize % (product.size || 1);
        } else { // Standard unit-based
            if (product.totalStock < quantity) {
                message = 'Insufficient stock to log this use.';
                return prev;
            }
            product.totalStock -= quantity;
        }

        newInventory[productIndex] = product;
        
        const newCorrection: StockCorrection = {
            id: `sc-${Date.now()}`,
            productId: productId,
            date: new Date().toISOString(),
            change: -quantity,
            unit: unit,
            reason: notes || 'Manual Use',
        };
        addStockCorrection(newCorrection);
        
        success = true;
        message = `${quantity} ${unit} of ${product.name} logged.`;
        return newInventory;
    });

    return { success, message };
  };

  const handleWriteOffConfirm = (productId: string, batchId: string, quantity: number, reason: string) => {
    // Logic similar to handleLogUseConfirm, but for a specific batch and with a different reason.
  }
  
  const filteredInventory = useMemo(() => {
    if (activeTab === 'all') return inventory;
    return inventory.filter(item => item.type === activeTab);
  }, [inventory, activeTab]);

  return (
    <div className="h-screen w-full flex flex-col">
      <AppHeader title="Inventory Hub" />
      <main className="flex-1 flex flex-col p-4 md:p-8 space-y-6 overflow-y-auto">
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
             {KPI_CARDS.map((kpi, index) => (
                <Card key={index}>
                    <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{kpi.title}</CardTitle>
                        <kpi.icon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpi.value}</div>
                        <p className="text-xs text-muted-foreground">{kpi.description}</p>
                    </CardContent>
                </Card>
            ))}
        </div>

        <Card>
            <CardHeader>
                 <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                        <CardTitle>All Inventory</CardTitle>
                        <CardDescription>A complete list of your professional, retail, and equipment stock.</CardDescription>
                    </div>
                     <Button className='w-full sm:w-auto' onClick={() => setIsAddProductOpen(true)}>
                        <PlusCircle className="mr-2 h-4 w-4" /> New Item
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search by name or SKU..." className="pl-9" />
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button variant={activeTab === 'all' ? 'default' : 'outline'} onClick={() => setActiveTab('all')} className="flex-1">All</Button>
                        <Button variant={activeTab === 'professional' ? 'default' : 'outline'} onClick={() => setActiveTab('professional')} className="flex-1">Pro</Button>
                        <Button variant={activeTab === 'retail' ? 'default' : 'outline'} onClick={() => setActiveTab('retail')} className="flex-1">Retail</Button>
                        <Button variant={activeTab === 'equipment' ? 'default' : 'outline'} onClick={() => setActiveTab('equipment')} className="flex-1">Equip</Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredInventory.length > 0 ? filteredInventory.map(item => (
                        <ProductCard 
                            key={item.id} 
                            item={item} 
                            onEdit={() => {}} 
                            onToggleExperiment={() => {}} 
                            onEndExperiment={() => {}} 
                            onWriteOff={handleOpenWriteOff} 
                            onLogUse={handleOpenLogUse}
                        />
                    )) : (
                        <EmptyState 
                            message={`You haven't added any ${activeTab} items yet.`}
                            onActionClick={() => setIsAddProductOpen(true)}
                        />
                    )}
                </div>
            </CardContent>
        </Card>
      </main>
      
      {selectedProduct && (
        <LogUseDialog
            open={isLogUseOpen}
            onOpenChange={setIsLogUseOpen}
            product={selectedProduct}
            onConfirm={handleLogUseConfirm}
        />
      )}

      {selectedProduct && (
        <WriteOffDialog
            open={isWriteOffOpen}
            onOpenChange={setIsWriteOffOpen}
            product={selectedProduct}
            onConfirm={handleWriteOffConfirm}
        />
      )}

    </div>
  );
}
