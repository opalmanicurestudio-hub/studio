
'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
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
import { MoreHorizontal, PlusCircle, Search, SlidersHorizontal, Package, Hammer, FlaskConical, Pencil, Rocket, CheckCircle, Trash2, Edit, MapPin, Printer, PackageX, Box, Building, Store, ClipboardList, Plus, BarChart, File, Pipette, QrCode, AlertTriangle } from 'lucide-react';
import { type InventoryItem, type StockCorrection } from '@/lib/data';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';


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
            {item.costingMethod === 'size' && item.partialContainerSize !== undefined && item.partialContainerSize > 0 && (
                <p className="text-xs text-muted-foreground">{item.partialContainerSize.toFixed(0)}{item.unit} left in open container</p>
            )}
            {item.costingMethod === 'uses' && item.partialContainerUses !== undefined && item.partialContainerUses > 0 && (
                <p className="text-xs text-muted-foreground">{item.partialContainerUses} uses left in open container</p>
            )}
        </div>
      )
    }, [item]);
    
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
                    <div className='flex items-center gap-2'>
                        <Badge variant="outline" className={stockStatus.className}>{stockStatus.label}</Badge>
                        {item.isExperimentActive && (
                            <Badge variant="secondary" className="flex items-center gap-1.5 bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300">
                                <FlaskConical className="h-3 w-3" />
                                {item.experimentUses || 0} uses logged
                            </Badge>
                        )}
                    </div>
                    {stockDisplay}
                </div>
            </CardContent>
             <CardFooter className="p-2 border-t bg-muted/50">
                <div className="grid grid-cols-2 gap-2 w-full">
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => onLogUse(item)}><Pipette className="mr-2 h-4 w-4"/>Log Use</Button>
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => onWriteOff(item)}><PackageX className="mr-2 h-4 w-4"/>Write-off</Button>
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
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddLocationDialogOpen, setAddLocationDialogOpen] = useState(false);
  const [isEditLocationDialogOpen, setIsEditLocationDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isLogUseOpen, setIsLogUseOpen] = useState(false);
  const [isWriteOffOpen, setIsWriteOffOpen] = useState(false);
  const [isEndExperimentOpen, setIsEndExperimentOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<InventoryItem | null>(null);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);


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

        if (product.isExperimentActive) {
            product.experimentUses = (product.experimentUses || 0) + quantity;
        }

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
  
  const handleEndExperimentConfirmed = (results: any) => { // Using 'any' for now since LifespanTestResult is also on product. Adjust as needed.
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

    if (activeTab !== 'all') {
      items = items.filter(item => item.type === activeTab);
    }
    
    if (searchTerm) {
        items = items.filter(item => 
            item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.id.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }

    return items;
  }, [inventory, activeTab, searchTerm]);

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
    <div className="h-screen w-full flex flex-col">
      <AppHeader title="Inventory Hub" />
      <main className="flex-1 flex flex-col p-4 md:p-8 space-y-6">
        
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
                        <div className="flex items-center gap-2 w-full sm:w-auto p-1 bg-muted rounded-md">
                          <Button variant={activeTab === 'all' ? 'default' : 'ghost'} onClick={() => setActiveTab('all')} className="flex-1 text-xs h-8">All</Button>
                          <Button variant={activeTab === 'professional' ? 'default' : 'ghost'} onClick={() => setActiveTab('professional')} className="flex-1 text-xs h-8">Pro</Button>
                          <Button variant={activeTab === 'retail' ? 'default' : 'ghost'} onClick={() => setActiveTab('retail')} className="flex-1 text-xs h-8">Retail</Button>
                          <Button variant={activeTab === 'equipment' ? 'default' : 'ghost'} onClick={() => setActiveTab('equipment')} className="flex-1 text-xs h-8">Equip</Button>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
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
      
      {selectedProduct && (
        <EndCostPerUseTestDialog
            open={isEndExperimentOpen}
            onOpenChange={setIsEndExperimentOpen}
            product={selectedProduct}
            onConfirm={handleEndExperimentConfirmed}
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
             <video ref={videoRef} className="w-full aspect-video rounded-md" autoPlay muted playsInline />
             <div className="absolute inset-4 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-1/2 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>
            {hasCameraPermission === false && (
                <Alert variant="destructive" className="mt-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Camera Access Required</AlertTitle>
                    <AlertDescription>
                        Please allow camera access to use this feature.
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

    
