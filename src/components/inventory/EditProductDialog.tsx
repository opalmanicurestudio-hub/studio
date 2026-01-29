

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useForm, FormProvider, useFormContext, Controller, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { type InventoryItem, type Location, type ConsentForm, type Resource } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { Check, PlusCircle, QrCode, AlertTriangle, DollarSign, Package, Hammer, Trash2, ShoppingCart, Calculator } from 'lucide-react';
import { type Service } from '@/lib/data';
import { useIsMobile } from '@/hooks/use-mobile';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { SelectResourcesDialog } from './SelectResourcesDialog';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { BrowseConsentFormsDialog } from '../services/BrowseConsentFormsDialog';
import { Switch } from '../ui/switch';
import { useInventory } from '@/context/InventoryContext';
import { SelectResourcesDialog as NewSelectResourcesDialog } from '../services/SelectResourcesDialog';
import { cn } from '@/lib/utils';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { format, parseISO } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { CalendarIcon } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';


const editProductSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Product name is required'),
  type: z.enum(['professional', 'retail', 'equipment', 'overhead']),
  category: z.string().min(1, 'Category is required'),
  imageUrl: z.string().optional(),
  internalNotes: z.string().optional(),
  
  totalPurchaseCost: z.coerce.number().optional(),
  numUnits: z.coerce.number().optional(),
  shippingCost: z.coerce.number().optional(),
  taxCost: z.coerce.number().optional(),
  discounts: z.coerce.number().optional(),
  
  costingMethod: z.enum(['size', 'uses']).optional(),
  containerSize: z.coerce.number().optional(),
  containerUnit: z.string().optional(),
  usesPerContainer: z.coerce.number().optional(),
  restockingMarkup: z.coerce.number().optional(),

  msrp: z.coerce.number().optional(),
  markdownPrice: z.coerce.number().optional(),
  wholesalePrice: z.coerce.number().optional(),
  packagingCost: z.coerce.number().optional(),
  shippingCostToCustomer: z.coerce.number().optional(),

  supplier: z.string().optional(),
  sku: z.string().optional(),
  purchaseLink: z.string().optional(),
  reorderPoint: z.coerce.number().optional(),
  primaryLocationId: z.string().optional(),
  expirationDate: z.date().optional(),
});

type ProductFormData = z.infer<typeof editProductSchema>;

const Step1_BasicDetails = ({
  categories,
  onNewCategory,
}: {
  categories: string[];
  onNewCategory: (category: string) => void;
}) => {
    const { register, control, setValue, watch, formState: { errors } } = useFormContext<ProductFormData>();
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');

    const handleAddNewCategory = () => {
        if (newCategoryName.trim() && !categories.includes(newCategoryName.trim())) {
            const newCategory = newCategoryName.trim();
            onNewCategory(newCategory);
            setValue('category', newCategory, { shouldValidate: true });
            setNewCategoryName('');
            setIsAddingCategory(false);
        }
    };

    return (
        <div className="grid gap-6 py-4">
            <div className="space-y-2">
                <Label htmlFor="product-name-edit">Product Name</Label>
                <Input id="product-name-edit" {...register('name')} />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <Controller
                name="type"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label>Product Type</Label>
                        <RadioGroup value={field.value} className="grid grid-cols-2 gap-2" disabled>
                            <RadioGroupItem value="professional" id="professional-edit" className="peer sr-only" />
                            <Label htmlFor="professional-edit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                                <Package className="mb-2 h-6 w-6" /> Professional
                            </Label>
                            <RadioGroupItem value="retail" id="retail-edit" className="peer sr-only" />
                            <Label htmlFor="retail-edit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                                <ShoppingCart className="mb-2 h-6 w-6" /> Retail
                            </Label>
                        </RadioGroup>
                    </div>
                )}
            />
            <div className="space-y-2">
                <Label htmlFor="category-edit">Category</Label>
                {isAddingCategory ? (
                    <div className="flex gap-2">
                        <Input
                            placeholder="Enter new category name..."
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddNewCategory()}
                        />
                        <Button onClick={handleAddNewCategory} type="button"><Check className="h-4 w-4" /></Button>
                    </div>
                ) : (
                    <div className="flex gap-2">
                        <Controller name="category" control={control} render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                                <SelectContent>{categories.map(cat => (<SelectItem key={cat} value={cat}>{cat}</SelectItem>))}</SelectContent>
                            </Select>
                        )} />
                        <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button"><PlusCircle className="h-4 w-4" /></Button>
                    </div>
                )}
                {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>}
            </div>
            <div className="space-y-2">
                <Label>Product Image</Label>
                <Controller name="imageUrl" control={control} render={({ field }) => (<ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />)} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="internalNotes-edit">Internal Notes</Label>
                <Textarea id="internalNotes-edit" {...register('internalNotes')} />
            </div>
        </div>
    );
};

const PackagingCostCalculatorDialog = ({ open, onOpenChange, onCalculated }: { open: boolean, onOpenChange: (open: boolean) => void, onCalculated: (cost: number) => void }) => {
    const [totalCost, setTotalCost] = useState('');
    const [numItems, setNumItems] = useState('');

    const costPerItem = useMemo(() => {
        const tc = parseFloat(totalCost);
        const ni = parseInt(numItems);
        if (tc > 0 && ni > 0) {
            return (tc / ni);
        }
        return 0;
    }, [totalCost, numItems]);

    const handleApply = () => {
        onCalculated(costPerItem);
        onOpenChange(false);
    };

    useEffect(() => {
        if (!open) {
            setTotalCost('');
            setNumItems('');
        }
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Calculate Packaging Cost</DialogTitle>
                    <DialogDescription>Enter the total cost of your packaging materials and the number of packages to find the cost per item.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="total-packaging-cost">Total Packaging Cost</Label>
                        <Input id="total-packaging-cost" type="number" placeholder="e.g., 50.00" value={totalCost} onChange={e => setTotalCost(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="num-packages">Number of Packages</Label>
                        <Input id="num-packages" type="number" placeholder="e.g., 100" value={numItems} onChange={e => setNumItems(e.target.value)} />
                    </div>
                    <Card className="bg-muted/50">
                        <CardContent className="p-4 flex items-center justify-between">
                            <span className="font-medium">Cost Per Item:</span>
                            <span className="text-2xl font-bold text-primary">${costPerItem.toFixed(2)}</span>
                        </CardContent>
                    </Card>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleApply} disabled={costPerItem <= 0}>Apply Cost</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ShippingCostCalculatorDialog = ({ open, onOpenChange, onCalculated }: { open: boolean, onOpenChange: (open: boolean) => void, onCalculated: (cost: number) => void }) => {
    const [costs, setCosts] = useState<number[]>([]);
    const [newCost, setNewCost] = useState('');

    const averageCost = useMemo(() => {
        if (costs.length === 0) return 0;
        const sum = costs.reduce((a, b) => a + b, 0);
        return (sum / costs.length);
    }, [costs]);

    const handleAddCost = () => {
        const cost = parseFloat(newCost);
        if (cost > 0) {
            setCosts([...costs, cost]);
            setNewCost('');
        }
    };

    const handleRemoveCost = (index: number) => {
        setCosts(costs.filter((_, i) => i !== index));
    };

    const handleApply = () => {
        onCalculated(averageCost);
        onOpenChange(false);
    };

    useEffect(() => {
        if (!open) {
            setCosts([]);
            setNewCost('');
        }
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Calculate Average Shipping Cost</DialogTitle>
                    <DialogDescription>Enter several recent shipping costs to calculate an average for your DTC pricing.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="flex gap-2">
                        <Input
                            type="number"
                            placeholder="Enter a shipping cost..."
                            value={newCost}
                            onChange={(e) => setNewCost(e.target.value)}
                            onKeyDown={(e) => { if(e.key === 'Enter') { e.preventDefault(); handleAddCost(); }}}
                        />
                        <Button onClick={handleAddCost} type="button">Add</Button>
                    </div>
                    <div className="space-y-2">
                        <Label>Entered Costs</Label>
                        <ScrollArea className="h-40 border rounded-md">
                            <div className="p-2 space-y-1">
                                {costs.length > 0 ? costs.map((cost, index) => (
                                    <div key={index} className="flex items-center justify-between p-1.5 bg-muted/50 rounded-md">
                                        <span className="font-mono">${cost.toFixed(2)}</span>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveCost(index)}>
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                )) : (
                                    <p className="text-sm text-center text-muted-foreground p-4">No costs entered yet.</p>
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                    <Card className="bg-muted/50">
                        <CardContent className="p-4 flex items-center justify-between">
                            <span className="font-medium">Average Shipping Cost:</span>
                            <span className="text-2xl font-bold text-primary">${averageCost.toFixed(2)}</span>
                        </CardContent>
                    </Card>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleApply} disabled={averageCost <= 0}>Apply Average</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const Step2_CostingPricing = () => {
    const { control, watch, register, setValue } = useFormContext<ProductFormData>();
    const productType = watch('type');
    const costingMethod = watch('costingMethod');
    const [totalPurchaseCost, numUnits, shippingCost, taxCost, discounts, msrp, wholesalePrice, packagingCost, shippingCostToCustomer] = watch([
        'totalPurchaseCost',
        'numUnits',
        'shippingCost',
        'taxCost',
        'discounts',
        'msrp',
        'wholesalePrice',
        'packagingCost',
        'shippingCostToCustomer'
    ]);
    
    const [isPackagingCalcOpen, setIsPackagingCalcOpen] = useState(false);
    const [isShippingCalcOpen, setIsShippingCalcOpen] = useState(false);

    const landedCostPerItem = useMemo(() => {
        const safeParse = (val: any) => parseFloat(val) || 0;
        const total = safeParse(totalPurchaseCost) + safeParse(shippingCost) + safeParse(taxCost) - safeParse(discounts);
        const units = safeParse(numUnits);
        if (units === 0) return 0;
        return total / units;
    }, [totalPurchaseCost, numUnits, shippingCost, taxCost, discounts]);

    const wholesaleProfit = useMemo(() => {
        const price = wholesalePrice || 0;
        if (price === 0 || landedCostPerItem === 0) return { profit: 0, margin: 0 };
        const profit = price - landedCostPerItem;
        const margin = (profit / price) * 100;
        return { profit, margin };
    }, [wholesalePrice, landedCostPerItem]);

    const dtcProfit = useMemo(() => {
        const price = msrp || 0;
        const totalDtcCost = landedCostPerItem + (packagingCost || 0) + (shippingCostToCustomer || 0);
        if (price === 0) return { profit: 0, margin: 0 };
        const profit = price - totalDtcCost;
        const margin = (profit / price) * 100;
        return { profit, margin };
    }, [msrp, landedCostPerItem, packagingCost, shippingCostToCustomer]);
    
    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <Card>
                    <CardHeader><CardTitle>Landed Cost Calculator</CardTitle><CardDescription>Calculate the true cost per item.</CardDescription></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label htmlFor="total-cost-edit">Total Purchase Cost</Label><Input id="total-cost-edit" type="number" placeholder="From invoice" {...register('totalPurchaseCost')} /></div>
                            <div className="space-y-2"><Label htmlFor="num-units-edit">Number of Units</Label><Input id="num-units-edit" type="number" placeholder="In shipment" {...register('numUnits')} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label htmlFor="shipping-edit">Shipping</Label><Input id="shipping-edit" type="number" placeholder="0.00" {...register('shippingCost')} /></div>
                            <div className="space-y-2"><Label htmlFor="taxes-edit">Taxes</Label><Input id="taxes-edit" type="number" placeholder="0.00" {...register('taxCost')} /></div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="discounts-edit">Discounts</Label>
                            <Input id="discounts-edit" type="number" placeholder="0.00" {...register('discounts')} />
                        </div>
                        <div className="p-3 bg-muted rounded-md flex items-center justify-between"><span className="font-medium">Landed Cost Per Item:</span><span className="text-lg font-bold text-primary">${landedCostPerItem.toFixed(2)}</span></div>
                    </CardContent>
                </Card>
                {(productType === 'professional') && (
                    <Card>
                        <CardHeader><CardTitle>Professional Costing</CardTitle><CardDescription>How much does it cost to use this once?</CardDescription></CardHeader>
                        <CardContent className="space-y-4">
                            <Controller name="costingMethod" control={control} render={({ field }) => (<div className="space-y-2"><Label>Costing Method</Label><RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2"><div><RadioGroupItem value="size" id="by-size-edit" className="peer sr-only" /><Label htmlFor="by-size-edit" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Size</Label></div><div><RadioGroupItem value="uses" id="by-uses-edit" className="peer sr-only" /><Label htmlFor="by-uses-edit" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Uses</Label></div></RadioGroup></div>)}/>
                            {costingMethod === 'size' && (<div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="container-size-edit">Container Size</Label><Input id="container-size-edit" type="number" placeholder="e.g., 1000" {...register('containerSize')} /></div><div className="space-y-2"><Label htmlFor="unit-edit">Unit</Label><Controller name="containerUnit" control={control} render={({ field }) => (<Select onValueChange={field.onChange} value={field.value}><SelectTrigger id="unit-edit"><SelectValue placeholder="Unit" /></SelectTrigger><SelectContent><SelectItem value="ml">ml</SelectItem><SelectItem value="oz">oz</SelectItem><SelectItem value="g">g</SelectItem></SelectContent></Select>)}/></div></div>)}
                            {costingMethod === 'uses' && (<div className="space-y-2"><Label htmlFor="estimated-uses-edit">Uses Per Container</Label><Input id="estimated-uses-edit" type="number" placeholder="e.g., 50" {...register('usesPerContainer')} /></div>)}
                             <div className="space-y-2"><Label htmlFor="restocking-markup-edit">Restocking Markup (%)</Label><Input id="restocking-markup-edit" type="number" placeholder="e.g., 5" {...register('restockingMarkup')} /></div>
                        </CardContent>
                    </Card>
                )}
                {(productType === 'retail') && (
                     <Card>
                        <CardHeader><CardTitle>Retail Pricing</CardTitle><CardDescription>Set pricing for different sales channels.</CardDescription></CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-2">
                               <Label className="font-semibold">Wholesale</Label>
                               <div className="space-y-2 p-3 border rounded-md">
                                    <div className="space-y-1">
                                        <Label htmlFor="wholesale-price-edit" className="text-xs">Wholesale Price</Label>
                                        <div className="relative">
                                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input id="wholesale-price-edit" type="number" placeholder="0.00" {...register('wholesalePrice')} className="pl-8" />
                                        </div>
                                    </div>
                                    <div className="p-2 bg-muted rounded-md text-xs flex justify-between">
                                        <span>Profit: <span className="font-bold">${wholesaleProfit.profit.toFixed(2)}</span></span>
                                        <span>Margin: <span className="font-bold">{wholesaleProfit.margin.toFixed(1)}%</span></span>
                                    </div>
                               </div>
                            </div>
                            <div className="space-y-2">
                                <Label className="font-semibold">Direct-to-Consumer (DTC)</Label>
                                 <div className="space-y-4 p-3 border rounded-md">
                                    <div className="space-y-1">
                                        <Label htmlFor="dtc-price-edit" className="text-xs">DTC Price (MSRP)</Label>
                                        <div className="relative">
                                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input id="dtc-price-edit" type="number" placeholder="0.00" {...register('msrp')} className="pl-8" />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="packaging-cost-edit" className="text-xs">Packaging Cost / item</Label>
                                             <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsPackagingCalcOpen(true)}>
                                                <Calculator className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <div className="relative">
                                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input id="packaging-cost-edit" type="number" placeholder="0.00" {...register('packagingCost')} className="pl-8" />
                                        </div>
                                    </div>
                                     <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="shipping-cost-edit" className="text-xs">Avg. Shipping Cost / item</Label>
                                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsShippingCalcOpen(true)}>
                                                <Calculator className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <div className="relative">
                                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input id="shipping-cost-edit" type="number" placeholder="0.00" {...register('shippingCostToCustomer')} className="pl-8" />
                                        </div>
                                    </div>
                                    <div className="p-2 bg-muted rounded-md text-xs flex justify-between">
                                        <span>Profit: <span className="font-bold">${dtcProfit.profit.toFixed(2)}</span></span>
                                        <span>Margin: <span className="font-bold">{dtcProfit.margin.toFixed(1)}%</span></span>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
             <PackagingCostCalculatorDialog
                open={isPackagingCalcOpen}
                onOpenChange={setIsPackagingCalcOpen}
                onCalculated={(cost) => setValue('packagingCost', cost, { shouldDirty: true })}
            />
            <ShippingCostCalculatorDialog
                open={isShippingCalcOpen}
                onOpenChange={setIsShippingCalcOpen}
                onCalculated={(cost) => setValue('shippingCostToCustomer', cost, { shouldDirty: true })}
            />
        </>
    );
};

const Step3_InventorySupplier = ({ onAddLocationClick, locations }: { onAddLocationClick: () => void; locations: Location[] }) => {
    const { control, register, formState: { errors } } = useFormContext<ProductFormData>();
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Supplier Info</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="vendor-edit">Vendor</Label><Input id="vendor-edit" placeholder="e.g., SalonCentric" {...register('supplier')} /></div>
                    <div className="space-y-2"><Label htmlFor="sku-edit">SKU / Barcode</Label><Input id="sku-edit" placeholder="Product identifier" {...register('sku')} /></div>
                    <div className="space-y-2"><Label htmlFor="purchase-link-edit">Purchase Link</Label><Input id="purchase-link-edit" type="text" placeholder="https://..." {...register('purchaseLink')} /></div>
                </CardContent>
            </Card>
            <Card>
                 <CardHeader><CardTitle>Stock Management</CardTitle></CardHeader>
                 <CardContent className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="reorder-point-edit">Reorder Point</Label><Input id="reorder-point-edit" type="number" placeholder="e.g., 5" {...register('reorderPoint')} /></div>
                    <div className="space-y-2">
                        <Label>Expiration</Label>
                        <p className="text-xs text-muted-foreground">Editing expiration for the first/most recent batch.</p>
                        <Controller name="expirationDate" control={control} render={({ field }) => ( <Popover><PopoverTrigger className={cn( buttonVariants({ variant: 'outline' }), 'w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground' )}> <CalendarIcon className="mr-2 h-4 w-4" /> {field.value ? format(field.value, 'PPP') : 'No expiry'}</PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} /></PopoverContent></Popover> )}/>
                    </div>
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Stock Levels</AlertTitle>
                        <AlertDescription>
                            Stock quantities are managed through inventory actions (e.g., Log Use, Write-off) and cannot be edited directly here.
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>
             <Card>
                <CardHeader><CardTitle>Storage Locations</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Primary Location</Label>
                        <Controller
                            name="primaryLocationId"
                            control={control}
                            render={({ field }) => (
                                <div className="flex gap-2">
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                                    <SelectContent>{locations.map(loc => (<SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>))}</SelectContent>
                                </Select>
                                <Button variant="outline" size="icon" onClick={onAddLocationClick} type="button">
                                    <PlusCircle className="h-4 w-4" />
                                </Button>
                                </div>
                            )}
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
    )
};


interface EditProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryItem;
  onProductUpdated: (product: InventoryItem) => void;
  categories: string[];
  onNewCategory: (category: string) => void;
  locations: Location[];
  onAddLocationClick: () => void;
}

export const EditProductDialog: React.FC<EditProductDialogProps> = ({
  open,
  onOpenChange,
  product,
  onProductUpdated,
  categories,
  onNewCategory,
  locations,
  onAddLocationClick,
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  const isMobile = useIsMobile();
  
  const methods = useForm<ProductFormData>({
    resolver: zodResolver(editProductSchema),
  });

  useEffect(() => {
    if (product && open) {
        const firstBatch = product.batches?.[0];
        methods.reset({
            id: product.id,
            name: product.name,
            type: product.type,
            category: product.category,
            imageUrl: product.imageUrl || '',
            internalNotes: product.internalNotes || '',
            
            totalPurchaseCost: product.costPerUnit || 0,
            numUnits: 1, 
            shippingCost: 0,
            taxCost: 0,
            discounts: 0,

            costingMethod: product.costingMethod,
            containerSize: product.size,
            containerUnit: product.unit,
            usesPerContainer: product.estimatedUses,
            restockingMarkup: product.restockingMarkup,

            msrp: product.msrp,
            markdownPrice: product.markdownPrice,
            wholesalePrice: product.wholesalePrice,
            packagingCost: product.packagingCost,
            shippingCostToCustomer: product.shippingCostToCustomer,

            supplier: product.supplier,
            sku: product.sku,
            purchaseLink: product.supplierUrl,
            reorderPoint: product.reorderPoint,
            primaryLocationId: product.primaryLocationId,
            expirationDate: firstBatch?.expirationDate ? parseISO(firstBatch.expirationDate) : undefined,
        });
      setStep(1);
    }
  }, [product, open, methods]);

  const { watch, trigger, handleSubmit } = methods;
  
  const onSubmit = (data: ProductFormData) => {
    const costPerUnit = (data.numUnits || 1) > 0 ? ((data.totalPurchaseCost || 0) + (data.shippingCost || 0) + (data.taxCost || 0) - (data.discounts || 0)) / (data.numUnits || 1) : 0;
    
    const updatedBatches = [...product.batches];
    if (updatedBatches.length > 0) {
        updatedBatches[0] = {
            ...updatedBatches[0],
            costPerUnit: costPerUnit,
            expirationDate: data.expirationDate?.toISOString()
        };
    }

    let finalPurchaseLink = data.purchaseLink;
    if (finalPurchaseLink && !/^(https?:\/\/)/i.test(finalPurchaseLink)) {
        finalPurchaseLink = `https://${finalPurchaseLink}`;
    }

    const updatedProduct: InventoryItem = {
        ...product,
        ...data,
        costPerUnit: costPerUnit,
        batches: updatedBatches,
        supplierUrl: finalPurchaseLink,
    };
    onProductUpdated(updatedProduct);
    onOpenChange(false);
  };
  
    const handleNext = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        const fieldsToValidate: (keyof ProductFormData)[] = [];
        if (step === 1) {
            fieldsToValidate.push('name', 'category');
        }
        
        const isValid = fieldsToValidate.length > 0 ? await trigger(fieldsToValidate) : true;
        
        if (isValid && step < totalSteps) {
            setStep(step + 1);
        }
    };

    const handleBack = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        if (step > 1) {
            setStep(step - 1);
        }
    };
  
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
  };

  const getStepContent = () => {
      switch(step) {
          case 1: return <Step1_BasicDetails categories={categories} onNewCategory={onNewCategory} />;
          case 2: return <Step2_CostingPricing />;
          case 3: return <Step3_InventorySupplier onAddLocationClick={onAddLocationClick} locations={locations} />;
          default: return null;
      }
  }
  
  const formId = `edit-product-form-${product.id}`;
  const title = `Edit Product: ${product.name}`;
  const description = "Update the details for this product.";

  const formBody = (
    <FormProvider {...methods}>
      <form id={formId} onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={isMobile ? "p-4 border-b text-left" : "p-6 pb-4"}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="px-4 md:px-6 py-4">
          <Progress value={(step / totalSteps) * 100} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          {getStepContent()}
        </div>
        <DialogFooter className={isMobile ? "p-4 border-t" : "p-6 border-t"}>
          <div className='flex justify-between w-full'>
            <div>{step > 1 && <Button variant="outline" onClick={handleBack} type="button">Back</Button>}</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} type="button">Cancel</Button>
              {step < totalSteps ? (
                <Button onClick={handleNext} type="button">Next</Button>
              ) : (
                <Button type="submit" form={formId}>Save Changes</Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </form>
    </FormProvider>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="bottom" className="max-h-[90dvh] flex flex-col p-0">
          {formBody}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col p-0">
        {formBody}
      </DialogContent>
    </Dialog>
  );
};
