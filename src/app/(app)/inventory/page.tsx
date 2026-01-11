

'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, MoreHorizontal, Search, SlidersHorizontal, Package, Hammer, FlaskConical, Pencil, Rocket, CheckCircle, Trash2, Edit, MapPin, Printer, PackageX, Box, Building, Store, ClipboardList } from 'lucide-react';
import { type InventoryItem, type StockCorrection } from '@/lib/data';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import Image from 'next/image';
import React, { useState, useEffect, useMemo } from 'react';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useInventory } from '@/context/InventoryContext';

const ProductCard = ({ item, onEdit, onToggleExperiment, onEndExperiment, onWriteOff, onLogUse }: { item: InventoryItem, onEdit: (item: InventoryItem) => void, onToggleExperiment: (item: InventoryItem) => void, onEndExperiment: (item: InventoryItem) => void, onWriteOff: (item: InventoryItem) => void, onLogUse: (item: InventoryItem) => void }) => {
    
    const stockStatus = useMemo(() => {
        const hasExpiredBatch = item.batches.some(b => b.expirationDate && isPast(parseISO(b.expirationDate)));
        if (hasExpiredBatch) return { label: 'Expired', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-600/30' };
        if (item.totalStock <= 0 && (item.partialContainerUses === undefined || item.partialContainerUses === 0) && (item.partialContainerSize === undefined || item.partialContainerSize === 0) ) return { label: 'Out of Stock', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-600/30' };
        if (item.reorderPoint && item.totalStock <= item.reorderPoint) return { label: 'Low Stock', className: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-400 dark:border-yellow-600/30' };
        return { label: 'In Stock', className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-600/30' };
    }, [item]);

    const detailHref = `/inventory/${item.id}`;
    
    return (
        <Card className={cn("w-72 shrink-0 transition-all duration-200 hover:shadow-xl hover:-translate-y-1", item.isExperimentActive && "shadow-lg shadow-purple-500/10 border-purple-500/20")}>
            <CardContent className="p-3 space-y-3">
                <div className="grid grid-cols-[auto,1fr,auto] items-start gap-3">
                    <Link href={detailHref} className='w-16 h-16 bg-muted rounded-md flex-shrink-0'>
                        <Image src={item.imageUrl || `https://picsum.photos/seed/inv${item.id}/100/100`} alt={item.name} width={64} height={64} className='rounded-md' data-ai-hint="product photo"/>
                    </Link>
                    <div className='pt-1 min-w-0'>
                        <Link href={detailHref} className="font-semibold text-sm leading-snug truncate hover:underline">{item.name}</Link>
                        <p className="text-xs text-muted-foreground">{item.category}</p>
                    </div>
                     <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost" className="h-8 w-8 flex-shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Toggle menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                           <Link href={detailHref}>
                                View Details
                           </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(item)}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                        {(item.type === 'professional' || item.type === 'equipment') && (
                            item.isExperimentActive ? (
                                <DropdownMenuItem onClick={() => onEndExperiment(item)}>
                                    <CheckCircle className="mr-2 h-4 w-4" /> End Experiment
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuItem onClick={() => onToggleExperiment(item)}>
                                    <Rocket className="mr-2 h-4 w-4" /> Start Experiment
                                </DropdownMenuItem>
                            )
                        )}
                        <DropdownMenuItem onClick={() => onWriteOff(item)}><PackageX className="mr-2 h-4 w-4" /> Write-off / Damage</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                           <Link href={`/inventory/labels?product=${item.id}`}>
                                <Printer className="mr-2 h-4 w-4" /> Print Label
                           </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                
                 <div className="flex items-center justify-between text-xs">
                     <Badge variant="outline" className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3" />
                        Back Room
                    </Badge>
                     {item.isExperimentActive && (
                        <Badge variant="secondary" className="flex items-center gap-1.5 bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300">
                            <FlaskConical className="h-3 w-3" /> Experiment
                        </Badge>
                     )}
                </div>
                
                <Card className='bg-muted/50'>
                    <CardContent className='p-2 text-center'>
                       {item.type === 'professional' ? (
                            <div className="grid grid-cols-2 divide-x">
                                <div>
                                    <p className='text-xs text-muted-foreground'>Full Units</p>
                                    <p className='text-2xl font-bold'>{item.totalStock}</p>
                                </div>
                                <div>
                                    <p className='text-xs text-muted-foreground'>
                                        {item.costingMethod === 'uses' ? 'Uses Left' : 'Size Left'}
                                    </p>
                                    <p className='text-2xl font-bold'>
                                        {item.costingMethod === 'uses'
                                            ? item.partialContainerUses || 0
                                            : `${item.partialContainerSize || 0}${item.unit || ''}`
                                        }
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <p className='text-xs text-muted-foreground'>Total Stock</p>
                                <p className='text-3xl font-bold'>{item.totalStock}</p>
                            </div>
                        )}
                         {item.isExperimentActive && item.type === 'professional' && (
                            <p className='text-xs text-purple-500 font-medium mt-1'>
                                {item.experimentUses} uses logged in experiment
                            </p>
                        )}
                    </CardContent>
                </Card>

                <div className='space-y-2'>
                    <Badge variant="secondary" className={cn("w-full justify-center h-6", stockStatus.className)}>{stockStatus.label}</Badge>
                    {item.type === 'professional' && (
                        <Button variant='outline' size="sm" className='w-full h-8' onClick={() => onLogUse(item)}>Log Use</Button>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

const EmptyState = ({ message }: { message: string }) => (
    <Card>
        <CardContent className="text-center py-20 px-6">
            <div className='flex justify-center mb-6'>
                <div className='w-20 h-20 bg-muted rounded-full flex items-center justify-center'>
                    <Package className='w-10 h-10 text-muted-foreground' />
                </div>
            </div>
            <p className="text-muted-foreground">{message}</p>
        </CardContent>
    </Card>
);

const ProductShelf = ({ 
    title, 
    items,
    ...props
}: { 
    title: string, 
    items: InventoryItem[]
} & Omit<Parameters<typeof ProductCard>[0], 'item'>) => {
    if (items.length === 0) return null;
    
    return (
        <div className="space-y-4">
            <h2 className="text-xl font-bold">{title}</h2>
            <ScrollArea>
                <div className="flex w-max space-x-4 pb-4">
                    {items.map((item) => (
                       <ProductCard key={item.id} item={item} {...props} />
                    ))}
                </div>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    );
};

const LocationCard = ({ location, items, locationTypes }: { location: Location, items: InventoryItem[], locationTypes: LocationType[] }) => {
    const locationType = locationTypes.find(lt => lt.id === location.locationTypeId);

    const Icon = useMemo(() => {
        switch (locationType?.icon) {
            case 'Box': return Box;
            case 'Building': return Building;
            case 'Store': return Store;
            case 'ClipboardList': return ClipboardList;
            default: return MapPin;
        }
    }, [locationType?.icon]);

    return (
        <Card>
            <CardHeader>
                 <div className="flex justify-between items-start gap-4">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <Icon className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <CardTitle>{location.name}</CardTitle>
                            <CardDescription>{locationType?.name || 'Uncategorized'}</CardDescription>
                        </div>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 -mt-2 -mr-2 flex-shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuItem>Edit Location</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive">Delete Location</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent>
                {location.description && <p className="text-sm text-muted-foreground mb-4">{location.description}</p>}
                <div className="space-y-2">
                    <h4 className="font-medium text-sm">Products at this location:</h4>
                    {items.length > 0 ? (
                        <div className="border rounded-md max-h-60">
                           <ScrollArea className="h-full">
                                {items.map((item, index) => (
                                    <div key={item.id} className={cn("flex items-center gap-3 p-2", index < items.length - 1 && "border-b")}>
                                        <Image src={item.imageUrl || `https://picsum.photos/seed/inv${item.id}/40/40`} alt={item.name} width={32} height={32} className="rounded-sm" />
                                        <span className="text-sm flex-1 truncate">{item.name}</span>
                                        <Badge variant="outline">{item.totalStock}</Badge>
                                    </div>
                                ))}
                           </ScrollArea>
                        </div>
                    ) : <p className="text-sm text-muted-foreground text-center p-4 border rounded-md">No products assigned.</p>}
                </div>
            </CardContent>
        </Card>
    )
}

const tabOptions = [
    { value: 'professional', label: 'Professional' },
    { value: 'retail', label: 'Retail' },
    { value: 'equipment', label: 'Equipment' },
    { value: 'locations', label: 'Locations' },
];


export default function InventoryPage() {
  const { inventory, setInventory, addStockCorrection, stockCorrections, locations, setLocations, locationTypes, setLocationTypes } = useInventory();
  const { toast } = useToast();
  
  const [activeTab, setActiveTab] = useState('professional');
  const [isClient, setIsClient] = useState(false);
  const [isAddLocationDialogOpen, setAddLocationDialogOpen] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);
  
  const professionalColor: InventoryItem[] = inventory.filter(
    (item) => item.type === 'professional' && item.category === 'Color'
  );
  const professionalStyling: InventoryItem[] = inventory.filter(
    (item) => item.type === 'professional' && item.category === 'Styling'
  );
  const professionalCare: InventoryItem[] = inventory.filter(
    (item) => item.type === 'professional' && item.category === 'Care'
  );
  const retailItems: InventoryItem[] = inventory.filter(
    (item) => item.type === 'retail'
  );
  const equipmentItems: InventoryItem[] = inventory.filter(
    (item) => item.type === 'equipment'
  );

  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isEditProductOpen, setIsEditProductOpen] = useState(false);
  const [isEndExperimentOpen, setIsEndExperimentOpen] = useState(false);
  const [isWriteOffOpen, setIsWriteOffOpen] = useState(false);
  const [isLogUseOpen, setIsLogUseOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<InventoryItem | null>(null);
  
  const handleAddNewLocation = (newLocationData: Omit<Location, 'id'>) => {
    const newLocation = { ...newLocationData, id: `loc-${Date.now()}`};
    setLocations(prev => [...prev, newLocation]);
    toast({
        title: "Location Added",
        description: `New location "${newLocation.name}" has been created.`
    });
  }

  const handleAddNewLocationType = (name: string, icon: string) => {
    const newType = { id: `lt-${Date.now()}`, name, icon };
    setLocationTypes(prev => [...prev, newType]);
    return newType;
  }

  const handleOpenEditDialog = (product: InventoryItem) => {
    setSelectedProduct(product);
    setIsEditProductOpen(true);
  };
  const handleToggleExperiment = (product: InventoryItem) => {
     setInventory(prev => prev.map(p => 
      p.id === product.id 
      ? { ...p, isExperimentActive: !p.isExperimentActive, experimentUses: p.isExperimentActive ? p.experimentUses : 0 } 
      : p
    ));
    toast({ title: `Experiment ${!product.isExperimentActive ? 'started' : 'stopped'} for ${product.name}` });
  };
  const handleEndExperiment = (product: InventoryItem) => {
    setSelectedProduct(product);
    setIsEndExperimentOpen(true);
  };
  const handleOpenWriteOff = (product: InventoryItem) => {
    setSelectedProduct(product);
    setIsWriteOffOpen(true);
  };
   const handleOpenLogUse = (product: InventoryItem) => {
    setSelectedProduct(product);
    setIsLogUseOpen(true);
  };

  if (!isClient) {
    return (
        <div className="flex flex-col h-screen">
            <AppHeader title="Inventory Hub" />
            <main className="flex-1 p-4 md:p-8">
            </main>
        </div>
    );
  }


  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Inventory Hub" />
      <main className="flex-1 flex flex-col p-4 md:p-8 space-y-6 overflow-hidden">
        <div className="flex flex-col sm:flex-row items-center gap-2">
            <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search inventory..." className="pl-9" />
            </div>
            <div className="flex w-full sm:w-auto items-center gap-2">
            <Button variant="outline" className="flex-1 sm:flex-initial">
                <SlidersHorizontal className="mr-2 h-4 w-4" /> Filters
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                <Button className="flex-1 sm:flex-initial">
                    <PlusCircle className="mr-2 h-4 w-4" /> New
                </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsAddProductOpen(true)}>
                    <Package className="mr-2 h-4 w-4" /> Add Product
                </DropdownMenuItem>
                <DropdownMenuItem>
                    <Hammer className="mr-2 h-4 w-4" /> Add Equipment
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAddLocationDialogOpen(true)}>
                    <MapPin className="mr-2 h-4 w-4" /> Add Location
                </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            </div>
        </div>
          
        <Tabs value={activeTab} onValueChange={setActiveTab}>
             <ScrollArea>
                <TabsList>
                    {tabOptions.map((option) => (
                        <TabsTrigger key={option.value} value={option.value}>
                        {option.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </Tabs>
        
        <div className='flex-1 space-y-8 overflow-y-auto -mr-4 pr-4'>
            {activeTab === 'professional' && (
            (professionalColor.length > 0 || professionalStyling.length > 0 || professionalCare.length > 0) ? (
                <>
                <ProductShelf title="Color" items={professionalColor} onEdit={handleOpenEditDialog} onToggleExperiment={handleToggleExperiment} onEndExperiment={handleEndExperiment} onWriteOff={handleOpenWriteOff} onLogUse={handleOpenLogUse} />
                <ProductShelf title="Styling" items={professionalStyling} onEdit={handleOpenEditDialog} onToggleExperiment={handleToggleExperiment} onEndExperiment={handleEndExperiment} onWriteOff={handleOpenWriteOff} onLogUse={handleOpenLogUse} />
                <ProductShelf title="Care" items={professionalCare} onEdit={handleOpenEditDialog} onToggleExperiment={handleToggleExperiment} onEndExperiment={handleEndExperiment} onWriteOff={handleOpenWriteOff} onLogUse={handleOpenLogUse} />
                </>
            ) : (
                <EmptyState message="No professional products found." />
            )
            )}
            {activeTab === 'retail' && (
                retailItems.length > 0 ? (
                    <ProductShelf title="Retail Products" items={retailItems} onEdit={handleOpenEditDialog} onToggleExperiment={handleToggleExperiment} onEndExperiment={handleEndExperiment} onWriteOff={handleOpenWriteOff} onLogUse={handleOpenLogUse} />
                ) : <EmptyState message="No retail products found." />
            )}
            {activeTab === 'equipment' && (
                equipmentItems.length > 0 ? (
                    <ProductShelf title="Capital Equipment" items={equipmentItems} onEdit={handleOpenEditDialog} onToggleExperiment={handleToggleExperiment} onEndExperiment={handleEndExperiment} onWriteOff={handleOpenWriteOff} onLogUse={handleOpenLogUse} />
                ) : <EmptyState message="No equipment found." />
            )}
            {activeTab === 'locations' && (
                 locations.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {locations.map(loc => (
                            <LocationCard key={loc.id} location={loc} items={inventory.slice(0,3)} locationTypes={locationTypes}/>
                        ))}
                    </div>
                 ) : <EmptyState message="No locations created yet." />
            )}
        </div>
      </main>
      <AddLocationDialog 
        open={isAddLocationDialogOpen}
        onOpenChange={setAddLocationDialogOpen}
        onSave={handleAddNewLocation}
        locationTypes={locationTypes}
        onAddNewLocationType={handleAddNewLocationType}
      />
    </div>
  );
}
