

'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, File, MoreHorizontal, Database, Camera, AlertTriangle, Truck, Search, SlidersHorizontal, QrCode, Package, Hammer, Beaker, FlaskConical, Pencil, Rocket, CheckCircle, Trash2, Edit, MapPin, Printer, PackageX, BellRing, TrendingUp, DollarSign, BarChart, LineChart, FileText } from 'lucide-react';
import { type InventoryItem, type Batch, inventory as initialInventory, stockCorrections as initialStockCorrections, type StockCorrection } from '@/lib/data';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import Image from 'next/image';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AddProductDialog } from '@/components/inventory/AddProductDialog';
import { EditProductDialog } from '@/components/inventory/EditProductDialog';
import { AddLocationDialog, type Location } from '@/components/inventory/AddLocationDialog';
import { EndCostPerUseTestDialog } from '@/components/inventory/EndCostPerUseTestDialog';
import { WriteOffDialog } from '@/components/inventory/WriteOffDialog';
import { ManageSpoilageDialog } from '@/components/inventory/ManageSpoilageDialog';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel';
import { isPast, parseISO, differenceInYears, format } from 'date-fns';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';


const ProductCard = ({ item, onEdit, onToggleExperiment, onEndExperiment, onWriteOff, onLogUse }: { item: InventoryItem, onEdit: (item: InventoryItem) => void, onToggleExperiment: (item: InventoryItem) => void, onEndExperiment: (item: InventoryItem) => void, onWriteOff: (item: InventoryItem) => void, onLogUse: (item: InventoryItem) => void }) => {
    
    const stockStatus = useMemo(() => {
        const hasExpiredBatch = item.batches.some(b => b.expirationDate && isPast(parseISO(b.expirationDate)));
        if (hasExpiredBatch) return { label: 'Expired', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-600/30' };
        if (item.totalStock <= 0) return { label: 'Out of Stock', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-600/30' };
        if (item.reorderPoint && item.totalStock <= item.reorderPoint) return { label: 'Low Stock', className: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-400 dark:border-yellow-600/30' };
        return { label: 'In Stock', className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-600/30' };
    }, [item]);

    const activeBatches = useMemo(() => item.batches.filter(b => b.stock > 0), [item.batches]);
    
    return (
        <Card className={cn("w-full transition-all duration-200 hover:shadow-xl hover:-translate-y-1", item.isExperimentActive && "shadow-lg shadow-purple-500/10 border-purple-500/20")}>
            <CardContent className="p-3 space-y-3">
                <div className="grid grid-cols-[auto,1fr,auto] items-start gap-3">
                    <Link href={`/inventory/${item.id}`} className='w-16 h-16 bg-muted rounded-md flex-shrink-0'>
                        <Image src={item.imageUrl || `https://picsum.photos/seed/inv${item.id}/100/100`} alt={item.name} width={64} height={64} className='rounded-md' data-ai-hint="product photo"/>
                    </Link>
                    <div className='pt-1 min-w-0'>
                        <Link href={`/inventory/${item.id}`} className="font-semibold text-sm leading-snug truncate hover:underline">{item.name}</Link>
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
                           <Link href={`/inventory/${item.id}`}>
                                <FileText className="mr-2 h-4 w-4" /> View Details
                           </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(item)}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                        {item.type === 'professional' && (
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
                                <QrCode className="mr-2 h-4 w-4" /> Print Label
                           </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild disabled={!item.supplierUrl}>
                           <Link href={item.supplierUrl || '#'} target="_blank" rel="noopener noreferrer">
                                <Truck className="mr-2 h-4 w-4" /> Reorder from Supplier
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
                        <p className='text-xs text-muted-foreground'>Total On Hand</p>
                        <p className='text-2xl font-bold'>{item.totalStock}</p>
                        {item.isExperimentActive ? (
                             <p className='text-xs text-purple-500 font-medium'>
                                {item.experimentUses} uses logged
                            </p>
                        ) : (
                             <p className='text-xs text-muted-foreground'>{item.partialContainerUses || 'N/A'} uses left</p>
                        )}
                    </CardContent>
                </Card>

                <div className='space-y-2'>
                    <Badge variant="secondary" className={cn("w-full justify-center h-6", stockStatus.className)}>{stockStatus.label}</Badge>
                    <Button variant='outline' size="sm" className='w-full h-8' onClick={() => onLogUse(item)} disabled={item.type !== 'professional'}>Log 1 Use</Button>
                </div>
                
                <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="batches" className='border-0'>
                        <AccordionTrigger className='p-2 text-xs text-muted-foreground justify-center gap-2 hover:no-underline rounded-md hover:bg-muted/50 h-8'>
                             <Database className='w-3 h-3' /> Batches ({activeBatches.length})
                        </AccordionTrigger>
                        <AccordionContent className='pt-2'>
                             <div className="space-y-1 text-xs text-muted-foreground">
                                {activeBatches.length > 0 ? activeBatches.map(batch => (
                                    <div key={batch.id} className="flex justify-between">
                                        <span>{batch.stock} units @ ${batch.costPerUnit.toFixed(2)}</span>
                                        <span className="text-right">{format(new Date(batch.receivedDate), 'MMM d, yyyy')}</span>
                                    </div>
                                )) : <p className="text-center text-xs">No active batches.</p>}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </CardContent>
        </Card>
    )
}

const EmptyState = ({ message }: { message: string }) => (
    <Card>
        <CardContent className="text-center py-20">
            <p className="text-muted-foreground">{message}</p>
        </CardContent>
    </Card>
);

type ShipmentItem = InventoryItem & {
    shipmentQuantity: number;
    shipmentCost: number;
};

const ReceiveStockDialog = ({ open, onOpenChange, allProducts, onReceiveStock }: { open: boolean, onOpenChange: (open: boolean) => void, allProducts: InventoryItem[], onReceiveStock: (items: ShipmentItem[], landedCosts: Record<string, number>) => void }) => {
    const [step, setStep] = useState(1);
    const [shipmentItems, setShipmentItems] = useState<ShipmentItem[]>([]);
    const [isProductSelectorOpen, setIsProductSelectorOpen] = useState(false);
    const [shippingCost, setShippingCost] = useState(0);
    const [taxes, setTaxes] = useState(0);
    const [otherFees, setOtherFees] = useState(0);

    const handleClose = () => {
        onOpenChange(false);
        setTimeout(() => {
            setStep(1);
            setShipmentItems([]);
            setShippingCost(0);
            setTaxes(0);
            setOtherFees(0);
        }, 300);
    }
    
    const handleProductSelect = (selectedProducts: InventoryItem[]) => {
        const newShipmentItems: ShipmentItem[] = selectedProducts.map(p => ({
            ...p,
            shipmentQuantity: 1,
            shipmentCost: p.costPerUnit || 0,
        }));
        setShipmentItems(newShipmentItems);
        setIsProductSelectorOpen(false);
    }

    const updateItem = (id: string, field: 'shipmentQuantity' | 'shipmentCost', value: number) => {
        setShipmentItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
    }
    
    const subtotal = useMemo(() => shipmentItems.reduce((acc, item) => acc + item.shipmentCost, 0), [shipmentItems]);
    const totalCost = subtotal + shippingCost + taxes + otherFees;

    const landedCosts = useMemo(() => {
        const costs: Record<string, number> = {};
        if (subtotal === 0) return costs;

        const additionalCostRatio = (totalCost - subtotal) / subtotal;
        
        shipmentItems.forEach(item => {
            const itemSubtotalCost = item.shipmentCost;
            const additionalCostForItem = itemSubtotalCost * additionalCostRatio;
            const landedCostPerUnit = (itemSubtotalCost + additionalCostForItem) / item.shipmentQuantity;
            costs[item.id] = landedCostPerUnit;
        });

        return costs;
    }, [shipmentItems, totalCost, subtotal]);

    const handleConfirm = () => {
        onReceiveStock(shipmentItems, landedCosts);
        handleClose();
    }


    return (
        <>
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Receive Stock</DialogTitle>
                    <DialogDescription>Log a new shipment from a vendor and update your stock levels.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4 max-h-[70vh] overflow-y-auto pr-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="vendor">Vendor</Label>
                            <Select>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a vendor" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="vendor1">Supplier A</SelectItem>
                                    <SelectItem value="vendor2">Supplier B</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="po-number">PO Number / Tracking</Label>
                            <Input id="po-number" placeholder="Optional" />
                        </div>
                    </div>
                    <Card>
                        <CardHeader>
                            <CardTitle>Items in Shipment</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {shipmentItems.length > 0 ? (
                                <div className="space-y-3">
                                {shipmentItems.map(item => (
                                    <div key={item.id} className="grid grid-cols-[1fr,80px,100px] gap-2 items-center">
                                        <p className="text-sm font-medium truncate">{item.name}</p>
                                        <Input type="number" value={item.shipmentQuantity} onChange={e => updateItem(item.id, 'shipmentQuantity', parseInt(e.target.value))} className="h-8 text-sm" />
                                        <Input type="number" value={item.shipmentCost} onChange={e => updateItem(item.id, 'shipmentCost', parseFloat(e.target.value))} className="h-8 text-sm pl-6" />
                                    </div>
                                ))}
                                </div>
                            ) : (
                                <div className='p-4 border rounded-md'>
                                    <p className="text-sm text-muted-foreground mb-4">No items added yet. Add products from your library.</p>
                                </div>
                            )}
                             <Button variant="outline" onClick={() => setIsProductSelectorOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Add Items</Button>
                        </CardContent>
                    </Card>
                     <Card>
                        <CardHeader>
                            <CardTitle>Landed Cost Calculator</CardTitle>
                            <CardDescription>Add shipping, taxes, or other fees from the invoice to calculate the true cost per item.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="shipping-cost">Shipping</Label>
                                    <Input id="shipping-cost" type="number" placeholder="0.00" value={shippingCost} onChange={e => setShippingCost(parseFloat(e.target.value) || 0)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="tax-cost">Taxes</Label>
                                    <Input id="tax-cost" type="number" placeholder="0.00" value={taxes} onChange={e => setTaxes(parseFloat(e.target.value) || 0)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="other-fees">Other Fees</Label>
                                    <Input id="other-fees" type="number" placeholder="0.00" value={otherFees} onChange={e => setOtherFees(parseFloat(e.target.value) || 0)} />
                                </div>
                            </div>
                            <CardFooter className="p-0 pt-4">
                                <div className="w-full bg-muted/50 rounded-md p-4 space-y-2">
                                    <div className="flex justify-between text-sm"><span>Subtotal:</span><span>${subtotal.toFixed(2)}</span></div>
                                    <div className="flex justify-between text-sm"><span>Additional Costs:</span><span>${(totalCost - subtotal).toFixed(2)}</span></div>
                                    <div className="flex justify-between font-bold text-base border-t pt-2"><span>Total Shipment Cost:</span><span>${totalCost.toFixed(2)}</span></div>
                                </div>
                            </CardFooter>
                        </CardContent>
                    </Card>
                    {shipmentItems.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Landed Cost per Item</CardTitle>
                            </CardHeader>
                             <CardContent className="space-y-2">
                                {shipmentItems.map(item => (
                                    <div key={item.id} className="flex justify-between text-sm p-2 bg-muted/50 rounded-md">
                                        <span>{item.name}</span>
                                        <span className="font-mono font-semibold">${landedCosts[item.id]?.toFixed(2) || '0.00'} / unit</span>
                                    </div>
                                ))}
                             </CardContent>
                        </Card>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>Cancel</Button>
                    <Button onClick={handleConfirm} disabled={shipmentItems.length === 0}>Save Shipment &amp; Update Stock</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <Dialog open={isProductSelectorOpen} onOpenChange={setIsProductSelectorOpen}>
             <DialogContent>
                 <DialogHeader>
                    <DialogTitle>Select Products for Shipment</DialogTitle>
                 </DialogHeader>
                 <div className="p-4">
                     <Button onClick={() => handleProductSelect(allProducts)}>Select All</Button>
                 </div>
             </DialogContent>
        </Dialog>
        </>
    );
};

const AddEquipmentDialog = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
    return (
         <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add Equipment</DialogTitle>
                    <DialogDescription>Add a new piece of capital equipment to your asset list.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="equipment-name">Equipment Name</Label>
                        <Input id="equipment-name" placeholder="e.g., Hydraulic Styling Chair" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="purchase-cost">Purchase Cost</Label>
                            <Input id="purchase-cost" type="number" placeholder="0.00" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lifespan">Lifespan (Years)</Label>
                            <Input id="lifespan" type="number" placeholder="5" />
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="purchase-date">Purchase Date</Label>
                        <Input id="purchase-date" type="date" />
                    </div>
                    <div className="space-y-2">
                        <Label>Image</Label>
                        <Button variant="outline" className="w-full">Upload Image</Button>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button>Save Equipment</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
const AddOverheadDialog = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
    return (
         <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add Overhead Item</DialogTitle>
                    <DialogDescription>Add a general supply item to your inventory.</DialogDescription>
                </DialogHeader>
                 <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="item-name">Item Name</Label>
                        <Input id="item-name" placeholder="e.g., Disinfectant Wipes" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="purchase-cost">Total Purchase Cost</Label>
                            <Input id="purchase-cost" type="number" placeholder="0.00" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="initial-stock">Initial Stock (Units)</Label>
                            <Input id="initial-stock" type="number" placeholder="1" />
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="category">Category</Label>
                        <Select>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a category" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="cleaning">Cleaning Supplies</SelectItem>
                                <SelectItem value="office">Office Supplies</SelectItem>
                                <SelectItem value="beverages">Client Beverages</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button>Save Item</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
const CreateBundleDialog = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
    return (
         <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create Bundle</DialogTitle>
                    <DialogDescription>Group existing retail products into a sellable bundle.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="bundle-name">Bundle Name</Label>
                        <Input id="bundle-name" placeholder="e.g., Summer Glow Kit" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="bundle-price">Bundle Price</Label>
                        <Input id="bundle-price" type="number" placeholder="0.00" />
                    </div>
                    <div className='space-y-2'>
                        <Label>Component Products</Label>
                        <Card>
                            <CardContent className="p-4 text-sm text-muted-foreground text-center">
                                <p>No products added yet.</p>
                            </CardContent>
                        </Card>
                        <Button variant="outline"><PlusCircle className="mr-2 h-4 w-4" /> Add Products</Button>
                    </div>
                    <Card className="bg-muted/50">
                        <CardHeader>
                            <CardTitle className="text-base">Profitability Analysis</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                             <div className="flex justify-between">
                                <span>Total Component Cost:</span>
                                <span className="font-medium">$0.00</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Net Profit:</span>
                                <span className="font-medium text-primary">$0.00</span>
                            </div>
                             <div className="flex justify-between">
                                <span>Profit Margin:</span>
                                <span className="font-medium text-primary">0.0%</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button>Save Bundle</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

const tabOptions = [
    { value: 'professional', label: 'Professional' },
    { value: 'retail', label: 'Retail' },
    { value: 'overhead', label: 'Overhead' },
    { value: 'equipment', label: 'Equipment' },
    { value: 'locations', label: 'Locations' },
];


export default function InventoryPage() {
  const [inventory, setInventory] = useState(initialInventory);
  const [stockCorrections, setStockCorrections] = useState(initialStockCorrections);
  
  const { professionalValue, retailValue, overheadValue, equipmentValue, totalValue } = useMemo(() => {
    let professional = 0;
    let retail = 0;
    let overhead = 0;
    let equipment = 0;

    inventory.forEach(item => {
        const itemTotalValue = item.batches.reduce((acc, batch) => acc + (batch.stock * batch.costPerUnit), 0);
        switch (item.type) {
            case 'professional':
                professional += itemTotalValue;
                break;
            case 'retail':
                retail += itemTotalValue;
                break;
            case 'overhead':
                overhead += itemTotalValue;
                break;
            case 'equipment':
                const purchaseCost = item.costPerUnit || 0;
                const yearsSincePurchase = item.batches[0]?.receivedDate ? differenceInYears(new Date(), parseISO(item.batches[0].receivedDate)) : 0;
                const lifespan = item.lifespanYears || 5;
                const depreciationPerYear = purchaseCost / lifespan;
                const accumulatedDepreciation = Math.min(depreciationPerYear * yearsSincePurchase, purchaseCost);
                const bookValue = purchaseCost - accumulatedDepreciation;
                equipment += bookValue * item.totalStock;
                break;
        }
    });
    
    return {
        professionalValue: professional,
        retailValue: retail,
        overheadValue: overhead,
        equipmentValue: equipment,
        totalValue: professional + retail + overhead + equipment,
    }
  }, [inventory]);

  const topProductUsage = useMemo(() => {
      return inventory
        .filter(item => item.type === 'professional' && (item.experimentUses || 0) > 0)
        .sort((a,b) => (b.experimentUses || 0) - (a.experimentUses || 0))
        .slice(0, 5)
        .map(item => ({
            ...item,
            totalCost: (item.experimentUses || 0) * (item.costPerUnit || 0)
        }))
  }, [inventory]);
  
  const expiredProducts = useMemo(() => {
    const expired: (InventoryItem & { expiredValue: number })[] = [];
    inventory.forEach(product => {
      let totalExpiredValue = 0;
      product.batches.forEach(batch => {
        if (batch.expirationDate && isPast(parseISO(batch.expirationDate)) && batch.stock > 0) {
          totalExpiredValue += batch.stock * batch.costPerUnit;
        }
      });
      if (totalExpiredValue > 0) {
        expired.push({ ...product, expiredValue: totalExpiredValue });
      }
    });
    return expired;
  }, [inventory]);

  const ongoingExperiments = useMemo(() => {
    return inventory.filter(item => item.isExperimentActive);
  }, [inventory]);


  const professionalColor: InventoryItem[] = inventory.filter(
    (item) => item.type === 'professional' && item.category === 'Color'
  );
  const professionalStyling: InventoryItem[] = inventory.filter(
    (item) => item.type === 'professional' && item.category === 'Styling'
  );
  const professionalCare: InventoryItem[] = inventory.filter(
    (item) => item.type === 'professional' && item.category === 'Care'
  );
  const professionalTools: InventoryItem[] = inventory.filter(
    (item) => item.type === 'professional' && item.category === 'Tools'
  );
  const retailItems: InventoryItem[] = inventory.filter(
    (item) => item.type === 'retail'
  );
  const overheadItems: InventoryItem[] = inventory.filter(
    (item) => item.type === 'overhead'
  );
  const equipmentItems: InventoryItem[] = inventory.filter(
    (item) => item.type === 'equipment'
  );
  
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationTypes, setLocationTypes] = useState([
    { id: 'lt1', name: 'Back Room Storage' },
    { id: 'lt2', name: 'Retail Display' },
    { id: 'lt3', name: 'Styling Station' },
    { id: 'lt4', name: 'Color Bar' },
  ]);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();
  const lastAddedLocationRef = useRef<Location | null>(null);

  const [isReceiveStockOpen, setIsReceiveStockOpen] = useState(false);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isEditProductOpen, setIsEditProductOpen] = useState(false);
  const [isAddEquipmentOpen, setIsAddEquipmentOpen] = useState(false);
  const [isAddOverheadOpen, setIsAddOverheadOpen] = useState(false);
  const [isCreateBundleOpen, setIsCreateBundleOpen] = useState(false);
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [isAddLocationFromProductOpen, setIsAddLocationFromProductOpen] = useState(false);
  const [isEndExperimentOpen, setIsEndExperimentOpen] = useState(false);
  const [isWriteOffOpen, setIsWriteOffOpen] = useState(false);
  const [isManageSpoilageOpen, setIsManageSpoilageOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<InventoryItem | null>(null);
  
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('professional');

  const productCategories = useMemo(() => {
    const categories = inventory.map(i => i.category).filter(Boolean) as string[];
    return [...new Set(categories)];
  }, [inventory]);

  useEffect(() => {
    if (lastAddedLocationRef.current) {
        toast({
            title: "Location Added",
            description: `${lastAddedLocationRef.current.name} has been created.`
        });
        lastAddedLocationRef.current = null; // Reset after showing toast
    }
  }, [locations, toast]);

  const handleAddNewLocation = (newLocation: Omit<Location, 'id'>) => {
    const locationWithId = { ...newLocation, id: `loc-${Date.now()}` };
    setLocations(prev => [...prev, locationWithId]);
    lastAddedLocationRef.current = locationWithId; // Store the new location to trigger toast
    setIsAddLocationOpen(false);
    setIsAddLocationFromProductOpen(false);
  }

  const handleAddNewLocationType = (newType: string) => {
    const newLocationType = { id: `lt-${Date.now()}`, name: newType };
    setLocationTypes(prev => [...prev, newLocationType]);
    return newLocationType;
  };

  const handleNewProductCategory = (category: string) => {
    // In a real app, this would update a central category list if it's not already present
    console.log("New product category added:", category);
  }

  const handleUpdateProduct = (updatedProduct: InventoryItem) => {
    setInventory(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
    toast({
        title: "Product Updated",
        description: `${updatedProduct.name} has been updated successfully.`
    })
  };

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
    toast({
        title: `Experiment ${product.isExperimentActive ? 'Stopped' : 'Started'}`,
        description: `Cost-per-use tracking for ${product.name} has been ${product.isExperimentActive ? 'stopped' : 'started'}.`,
    })
  };
  
  const handleEndExperiment = (product: InventoryItem) => {
    setSelectedProduct(product);
    setIsEndExperimentOpen(true);
  };
  
  const handleOpenWriteOff = (product: InventoryItem) => {
    setSelectedProduct(product);
    setIsWriteOffOpen(true);
  };

  const handleWriteOff = (productId: string, batchId: string, quantity: number, reason: string) => {
     setInventory(prevInventory => {
        const newInventory = [...prevInventory];
        const productIndex = newInventory.findIndex(p => p.id === productId);
        if (productIndex === -1) return prevInventory;

        const product = { ...newInventory[productIndex] };
        const batchIndex = product.batches.findIndex(b => b.id === batchId);
        if (batchIndex === -1) return prevInventory;

        const batch = { ...product.batches[batchIndex] };
        const cost = batch.costPerUnit * quantity;

        batch.stock -= quantity;
        product.totalStock -= quantity;
        
        product.batches[batchIndex] = batch;
        newInventory[productIndex] = product;
        
        toast({
            title: "Inventory Written Off",
            description: `${quantity} unit(s) of ${product.name} written off as ${reason}. Expense of $${cost.toFixed(2)} logged.`
        });
        
        console.log(`LOGGED EXPENSE: ${quantity} x ${product.name} for $${cost.toFixed(2)} due to ${reason}`);

        return newInventory;
    });
  };

  const handleUpdateCost = (productId: string, newCost: number) => {
    setInventory(prev => prev.map(p => 
      p.id === productId 
      ? { ...p, costPerUnit: newCost, isExperimentActive: false, experimentUses: 0 } 
      : p
    ));
  };
  
  const handleSimulateScan = () => {
    const scannedProductId = 'inv-3'; // Simulate scanning "Base Coat Polish"
    const product = inventory.find(p => p.id === scannedProductId);
    if (product) {
        setIsScannerOpen(false);
        // Delay opening the edit dialog slightly to allow the scanner to close
        setTimeout(() => {
            handleOpenEditDialog(product);
        }, 150);
        toast({
            title: "Product Scanned",
            description: `Showing details for ${product.name}.`
        });
    } else {
        toast({
            variant: "destructive",
            title: "Product Not Found",
            description: `Product with ID ${scannedProductId} not found.`
        });
    }
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
            description: 'Please enable camera permissions in your browser settings to use the scanner.',
          });
          setIsScannerOpen(false);
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

  const handleReceiveStock = (items: ShipmentItem[], landedCosts: Record<string, number>) => {
    setInventory(prevInventory => {
      const newInventory = [...prevInventory];
      const newCorrections: StockCorrection[] = [];

      items.forEach(item => {
        const productIndex = newInventory.findIndex(p => p.id === item.id);
        if (productIndex !== -1) {
          const newBatch: Batch = {
            id: `batch-${Date.now()}-${item.id}`,
            stock: item.shipmentQuantity,
            costPerUnit: landedCosts[item.id] || item.costPerUnit || 0,
            receivedDate: new Date().toISOString(),
          };

          newInventory[productIndex].batches.push(newBatch);
          newInventory[productIndex].totalStock += item.shipmentQuantity;
          
          newCorrections.push({
            id: `sc-${Date.now()}-${item.id}`,
            productId: item.id,
            date: new Date().toISOString(),
            change: item.shipmentQuantity,
            unit: newInventory[productIndex].unit || 'unit',
            reason: 'Shipment Received'
          });
        }
      });

      setStockCorrections(prev => [...prev, ...newCorrections]);
      return newInventory;
    });

    toast({
        title: "Stock Received",
        description: `${items.length} product(s) have been updated.`
    });
  };

  const handleLogUse = (productToUpdate: InventoryItem) => {
    setInventory(prevInventory => {
      const newInventory = [...prevInventory];
      const productIndex = newInventory.findIndex(p => p.id === productToUpdate.id);
      if (productIndex === -1) return prevInventory;
      
      const product = { ...newInventory[productIndex] };
      const quantityNeeded = 1; // Always 1 for this button

      let newCorrection: StockCorrection | null = null;
      let changeDescription = '';

      if (product.costingMethod === 'uses') {
        product.partialContainerUses = product.partialContainerUses ?? product.estimatedUses ?? 0;
        
        if (product.partialContainerUses >= quantityNeeded) {
            product.partialContainerUses -= quantityNeeded;
        } else {
            if (product.totalStock > 0) {
                product.totalStock -= 1;
                product.partialContainerUses += (product.estimatedUses || 0) - quantityNeeded;
            } else {
                toast({ variant: 'destructive', title: 'Out of Stock', description: `Cannot log use for ${product.name}.` });
                return prevInventory;
            }
        }
        if (product.isExperimentActive) {
          product.experimentUses = (product.experimentUses || 0) + 1;
        }
        
        newCorrection = {
          id: `sc-manual-${Date.now()}`,
          productId: product.id,
          date: new Date().toISOString(),
          change: -quantityNeeded,
          unit: 'use',
          reason: 'Manual Use Log'
        };
        changeDescription = `1 use`;

      } else {
        toast({ variant: 'destructive', title: 'Not Applicable', description: `Manual use logging is only for products costed 'by uses'.` });
        return prevInventory;
      }
      
      newInventory[productIndex] = product;
      
      if (newCorrection) {
        setStockCorrections(prev => [...prev, newCorrection!]);
      }
      
      toast({ title: 'Use Logged', description: `${changeDescription} of ${product.name} deducted.` });

      return newInventory;
    });
  };
  
  const ProductShelf = ({ title, items }: { title: string, items: InventoryItem[] }) => {
    if (items.length === 0) return null;
    
    return (
        <div className="space-y-4">
            <h2 className="text-xl font-bold">{title}</h2>
            <ScrollArea>
                <div className="flex w-max space-x-4 pb-4">
                    {items.map((item) => (
                        <div key={item.id} className='w-72'>
                             <ProductCard item={item} onEdit={handleOpenEditDialog} onToggleExperiment={handleToggleExperiment} onEndExperiment={handleEndExperiment} onWriteOff={handleOpenWriteOff} onLogUse={handleLogUse} />
                        </div>
                    ))}
                </div>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    );
  };

  const kpiCards = [
    <Card className="shrink-0" key="total-value">
        <CardHeader>
            <CardTitle>Total Inventory Value</CardTitle>
            <CardDescription>Real-time valuation of all your business assets.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <div className="text-4xl font-bold text-primary">${totalValue.toFixed(2)}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Professional</span>
                    <span className="font-medium">${professionalValue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Retail</span>
                    <span className="font-medium">${retailValue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Overhead</span>
                    <span className="font-medium">${overheadValue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Equipment</span>
                    <span className="font-medium">${equipmentValue.toFixed(2)}</span>
                </div>
            </div>
        </CardContent>
    </Card>,
    <Card className="shrink-0" key="top-usage">
        <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart className="text-muted-foreground"/> Top Product Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
            {topProductUsage.length > 0 ? topProductUsage.map(item => (
                <div key={item.id} className="flex justify-between items-center text-sm">
                    <span className="truncate flex-1">{item.name}</span>
                    <div className="flex items-center gap-4 ml-4">
                        <span className="font-mono">{item.experimentUses} uses</span>
                        <span className="font-mono w-20 text-right">${item.totalCost.toFixed(2)}</span>
                    </div>
                </div>
            )) : <p className="text-sm text-muted-foreground text-center py-8">No usage data yet.</p>}
        </CardContent>
    </Card>,
    <Card className="shrink-0" key="risks">
         <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="text-muted-foreground"/> Risks &amp; Spoilage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
             <div>
                <h4 className="font-medium text-sm mb-2">Expired Products</h4>
                {expiredProducts.length > 0 ? (
                     <div className="flex justify-between items-center text-red-500">
                        <span className="font-bold">{expiredProducts.length} item(s) expired</span>
                        <span className="font-mono text-lg font-bold">${expiredProducts.reduce((acc, p) => acc + p.expiredValue, 0).toFixed(2)}</span>
                    </div>
                ): <p className="text-sm text-muted-foreground text-center py-4">No expired products.</p>}
            </div>
            <Button className="w-full" variant="secondary" onClick={() => setIsManageSpoilageOpen(true)}>Manage Spoilage</Button>
        </CardContent>
    </Card>
  ];

  const filteredItems = useMemo(() => {
    switch (activeTab) {
      case 'professional':
        return inventory.filter(item => item.type === 'professional');
      case 'retail':
        return retailItems;
      case 'overhead':
        return overheadItems;
      case 'equipment':
        return equipmentItems;
      default:
        return [];
    }
  }, [activeTab, inventory, retailItems, overheadItems, equipmentItems]);

  if (isMobile === undefined) {
    return (
      <div className="flex min-h-screen w-full flex-col">
        <AppHeader title="Inventory Hub" />
        <main className="flex-1 p-4 md:p-8 space-y-6">
           {/* Render a skeleton or loading state */}
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Inventory Hub" />
      <main className="flex-1 p-4 md:p-8 space-y-6">

        {isMobile ? (
            <Carousel className="w-full">
                <CarouselContent className="-ml-2">
                    {kpiCards.map((card, index) => (
                        <CarouselItem key={index} className="pl-4 basis-11/12">
                            {card}
                        </CarouselItem>
                    ))}
                </CarouselContent>
            </Carousel>
        ) : (
            <div className='grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 mb-6'>
                {kpiCards}
            </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-2">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search inventory..." className="pl-9" />
            </div>
            <div className="flex w-full sm:w-auto items-center gap-2">
              <Button variant="outline" className="flex-1 sm:flex-initial" onClick={() => setIsScannerOpen(true)}>
                <Camera className="mr-2 h-4 w-4" /> Scan
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="flex-1 sm:flex-initial">
                    <SlidersHorizontal className="mr-2 h-4 w-4" /> Filters
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>Filter by Status</DropdownMenuItem>
                  <DropdownMenuItem>Filter by Category</DropdownMenuItem>
                  <DropdownMenuItem>Filter by Vendor</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button className="w-auto" onClick={() => setIsReceiveStockOpen(true)}>
                <Truck className="mr-2 h-4 w-4" /> Receive
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="flex-1 sm:flex-initial">
                    <PlusCircle className="mr-2 h-4 w-4" /> New
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setIsAddProductOpen(true)}>
                    <Package className="mr-2 h-4 w-4" /> Add Product
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsAddEquipmentOpen(true)}>
                    <Hammer className="mr-2 h-4 w-4" /> Add Equipment
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsAddOverheadOpen(true)}>
                    <Beaker className="mr-2 h-4 w-4" /> Add Overhead Item
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsCreateBundleOpen(true)}>
                    <FlaskConical className="mr-2 h-4 w-4" /> Create Bundle
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          
          {isMobile ? (
              <Select value={activeTab} onValueChange={setActiveTab}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {tabOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
          ) : null}

        </div>

        <div className='space-y-8'>
          {isMobile ? (
             <div className="grid grid-cols-2 gap-4">
                {activeTab === 'locations' ? (
                   locations.length > 0 ? (
                        locations.map(location => (
                        <Card key={location.id}>
                          <CardHeader>
                            <CardTitle className="text-lg">{location.name}</CardTitle>
                            {location.description && <CardDescription>{location.description}</CardDescription>}
                          </CardHeader>
                          <CardFooter className="flex gap-2">
                            <Button variant="outline" size="sm"><Edit className="mr-2 h-3 w-3" /> Edit</Button>
                            <Button variant="outline" size="sm" className="text-destructive"><Trash2 className="mr-2 h-3 w-3" /> Delete</Button>
                          </CardFooter>
                        </Card>
                      ))
                    ) : (
                         <div className="col-span-2">
                            <EmptyState message="No storage locations defined yet." />
                         </div>
                    )
                ) : (
                    filteredItems.length > 0 ? (
                        filteredItems.map(item => (
                            <ProductCard key={item.id} item={item} onEdit={handleOpenEditDialog} onToggleExperiment={handleToggleExperiment} onEndExperiment={handleEndExperiment} onWriteOff={handleOpenWriteOff} onLogUse={handleLogUse} />
                        ))
                    ) : (
                        <div className="col-span-2">
                            <EmptyState message={`No ${activeTab} products yet.`} />
                        </div>
                    )
                )}
             </div>
          ) : (
            <div className='space-y-8'>
              <div className="border-b">
                <Tabs defaultValue="professional" onValueChange={setActiveTab} className="w-full">
                  <TabsList>
                    {tabOptions.map((option) => (
                      <TabsTrigger key={option.value} value={option.value}>
                        {option.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              {activeTab === 'professional' && (
                (professionalColor.length === 0 && professionalCare.length === 0 && professionalStyling.length === 0 && professionalTools.length === 0) ? (
                  <EmptyState message="No professional products yet. Add one to get started." />
                ) : (
                  <>
                    <ProductShelf title="Color" items={professionalColor} />
                    <ProductShelf title="Styling" items={professionalStyling} />
                    <ProductShelf title="Care" items={professionalCare} />
                    <ProductShelf title="Tools" items={professionalTools} />
                  </>
                )
              )}
              {activeTab === 'retail' && (retailItems.length > 0 ? (
                <ProductShelf title="Retail Products" items={retailItems} />
              ) : (
                <EmptyState message="No retail items yet. Add one to get started." />
              ))}
              {activeTab === 'overhead' && (overheadItems.length > 0 ? (
                 <ProductShelf title="Overhead Supplies" items={overheadItems} />
              ) : (
                <EmptyState message="No overhead items yet. Add one to get started." />
              ))}
              {activeTab === 'equipment' && (equipmentItems.length > 0 ? (
                <ProductShelf title="Capital Equipment" items={equipmentItems} />
              ) : (
                <EmptyState message="No equipment items yet. Add one to get started." />
              ))}
              {activeTab === 'locations' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold">Storage Locations</h2>
                      <p className="text-muted-foreground">A map of all your physical storage areas.</p>
                    </div>
                    <Button onClick={() => setIsAddLocationOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> New Location</Button>
                  </div>
                  {locations.length === 0 ? (
                    <EmptyState message="No storage locations defined yet. Add one to get started." />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {locations.map(location => (
                        <Card key={location.id}>
                          <CardHeader>
                            <CardTitle className="text-lg">{location.name}</CardTitle>
                            {location.description && <CardDescription>{location.description}</CardDescription>}
                          </CardHeader>
                          <CardFooter className="flex gap-2">
                            <Button variant="outline" size="sm"><Edit className="mr-2 h-3 w-3" /> Edit</Button>
                            <Button variant="outline" size="sm" className="text-destructive"><Trash2 className="mr-2 h-3 w-3" /> Delete</Button>
                          </CardFooter>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

       <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Scan Barcode/QR Code</DialogTitle>
            <DialogDescription>
              Position the barcode or QR code inside the frame to scan it.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 relative">
             <video ref={videoRef} className="w-full aspect-square rounded-md bg-muted" autoPlay muted playsInline />
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>
            {hasCameraPermission === false && (
                <Alert variant="destructive" className="mt-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Camera Access Required</AlertTitle>
                    <AlertDescription>
                        Please allow camera access to use the scanner. You may need to change permissions in your browser settings.
                    </AlertDescription>
                </Alert>
            )}
          </div>
           <DialogFooter className="p-4 pt-0 flex-col gap-2">
                <Button onClick={handleSimulateScan}>Simulate Scan (inv-3)</Button>
                <Button variant="outline" onClick={() => setIsScannerOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiveStockDialog open={isReceiveStockOpen} onOpenChange={setIsReceiveStockOpen} allProducts={inventory} onReceiveStock={handleReceiveStock} />
      <AddProductDialog 
        open={isAddProductOpen} 
        onOpenChange={setIsAddProductOpen}
        locations={locations}
        isAddLocationDialogOpen={isAddLocationFromProductOpen}
        onAddLocationDialogOpenChange={setIsAddLocationFromProductOpen}
        onAddNewLocation={handleAddNewLocation}
        locationTypes={locationTypes}
        onAddNewLocationType={handleAddNewLocationType}
        categories={productCategories}
        onNewCategory={handleNewProductCategory}
      />
      {selectedProduct && (
        <EditProductDialog
            open={isEditProductOpen}
            onOpenChange={setIsEditProductOpen}
            product={selectedProduct}
            onProductUpdated={handleUpdateProduct}
            locations={locations}
            locationTypes={locationTypes}
            categories={productCategories}
            onNewCategory={handleNewProductCategory}
            onAddNewLocationType={handleAddNewLocationType}
        />
      )}
      {selectedProduct && (
          <EndCostPerUseTestDialog
            open={isEndExperimentOpen}
            onOpenChange={setIsEndExperimentOpen}
            product={selectedProduct}
            onUpdateCost={handleUpdateCost}
          />
      )}
      {selectedProduct && (
        <WriteOffDialog
          open={isWriteOffOpen}
          onOpenChange={setIsWriteOffOpen}
          product={selectedProduct}
          onConfirm={handleWriteOff}
        />
      )}
      <ManageSpoilageDialog
        open={isManageSpoilageOpen}
        onOpenChange={setIsManageSpoilageOpen}
        inventory={inventory}
        onConfirm={handleWriteOff}
      />
      <AddEquipmentDialog open={isAddEquipmentOpen} onOpenChange={setIsAddEquipmentOpen} />
      <AddOverheadDialog open={isAddOverheadOpen} onOpenChange={setIsAddOverheadOpen} />
      <CreateBundleDialog open={isCreateBundleOpen} onOpenChange={setIsCreateBundleOpen} />
      <AddLocationDialog 
        open={isAddLocationOpen} 
        onOpenChange={setIsAddLocationOpen}
        onSave={handleAddNewLocation}
        locationTypes={locationTypes}
        onAddNewLocationType={handleAddNewLocationType}
       />

    </div>
  );
}
