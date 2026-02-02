
'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
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
import { type InventoryItem, type Location, type ConsentForm, type Resource, type PricingTier } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { useForm, FormProvider, useFormContext, Controller, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, PlusCircle, QrCode, AlertTriangle, DollarSign, Package, Hammer, Trash2, ShoppingCart, Calculator, Clock } from 'lucide-react';
import { type Service } from '@/lib/data';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { SelectResourcesDialog } from './SelectResourcesDialog';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { BrowseConsentFormsDialog } from './BrowseConsentFormsDialog';
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
import { useFirebase, useMemoFirebase, useCollection } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection } from 'firebase/firestore';


const serviceSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Service name is required'),
  type: z.enum(['service', 'addon']),
  category: z.string().min(1, 'Category is required'),
  duration: z.coerce.number({ invalid_type_error: 'Duration is required.' }).min(1, 'Duration must be at least 1 minute'),
  padBefore: z.coerce.number().optional(),
  padAfter: z.coerce.number().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  isPrivate: z.boolean().optional(),
  isAddon: z.boolean().optional(),
  capacity: z.coerce.number().min(1).optional(),
  
  products: z.array(z.any()).optional(),
  requiredResourceIds: z.array(z.string()).optional(),
  compatibleAddOnIds: z.array(z.string()).optional(),
  
  depositType: z.enum(['none', 'deposit', 'full', 'breakeven']),
  depositSubType: z.enum(['flat', 'percentage']).optional(),
  depositAmount: z.coerce.number().optional(),
  
  pricingTiers: z.object({
    apprentice: z.object({ enabled: z.boolean(), price: z.coerce.number().optional(), durationMinutes: z.coerce.number().optional() }),
    junior: z.object({ enabled: z.boolean(), price: z.coerce.number().optional(), durationMinutes: z.coerce.number().optional() }),
    senior: z.object({ enabled: z.boolean(), price: z.coerce.number().optional(), durationMinutes: z.coerce.number().optional() }),
    master: z.object({ enabled: z.boolean(), price: z.coerce.number().optional(), durationMinutes: z.coerce.number().optional() }),
  }),
  confirmationMessage: z.string().optional(),
  requiredFormIds: z.array(z.string()).optional(),
}).superRefine((data, ctx) => {
    const tiers = ['apprentice', 'junior', 'senior', 'master'] as const;
    let enabledCount = 0;
    for (const tier of tiers) {
        if (data.pricingTiers[tier].enabled) {
            enabledCount++;
            if (data.pricingTiers[tier].price === undefined || data.pricingTiers[tier].price! < 0) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Price is required.", path: [`pricingTiers.${tier}.price`] });
            }
             if (data.pricingTiers[tier].durationMinutes === undefined || data.pricingTiers[tier].durationMinutes! < 1) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duration is required.", path: [`pricingTiers.${tier}.durationMinutes`] });
            }
        }
    }
    if (enabledCount === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one pricing tier must be enabled.", path: ["pricingTiers"] });
    }
});

type ServiceFormData = z.infer<typeof serviceSchema>;

const Step1_BasicDetails = ({ 
    categories, 
    onNewCategory 
}: { 
    categories: string[];
    onNewCategory: (category: string) => void;
}) => {
    const { register, control, setValue, watch, formState: { errors } } = useFormContext<ServiceFormData>();
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const category = watch('category');

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
    <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className='space-y-1'><Label htmlFor="is-addon-edit">Is this an Add-on Service?</Label><p className='text-sm text-muted-foreground'>Add-ons can be appended to primary services.</p></div>
        <Controller name="isAddon" control={control} render={({ field }) => ( <Switch id="is-addon-edit" checked={field.value} onCheckedChange={field.onChange} /> )}/>
    </div>
    <div className="space-y-2">
      <Label htmlFor="service-name-edit">Service Name</Label>
      <Input id="service-name-edit" placeholder="e.g., Signature Haircut" {...register('name')} />
       {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
    </div>
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
                <SelectTrigger> <SelectValue placeholder="Select a category" /> </SelectTrigger>
                <SelectContent> {categories.map(cat => ( <SelectItem key={cat} value={cat}>{cat}</SelectItem> ))} </SelectContent>
              </Select>
          )}/>
          <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button"> <PlusCircle className="h-4 w-4" /> </Button>
        </div>
      )}
       {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>}
    </div>

    <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
            <Label htmlFor="duration-edit">Duration (min)</Label>
            <Input id="duration-edit" type="number" placeholder="e.g., 60" {...register('duration', { valueAsNumber: true })}/>
            {errors.duration && <p className="text-sm text-destructive">{errors.duration.message}</p>}
        </div>
        <div className="space-y-2">
            <Label htmlFor="pad-before-edit">Pad Before (min)</Label>
            <Input id="pad-before-edit" type="number" placeholder="e.g., 0" {...register('padBefore', { valueAsNumber: true })} />
        </div>
        <div className="space-y-2">
            <Label htmlFor="pad-after-edit">Pad After (min)</Label>
            <Input id="pad-after-edit" type="number" placeholder="e.g., 15" {...register('padAfter', { valueAsNumber: true })} />
        </div>
    </div>
    
    <div className="space-y-2">
      <Label htmlFor="description-edit">Description</Label>
      <Textarea id="description-edit" placeholder="Describe the service for your booking page..." {...register('description')} />
    </div>

    <div className="space-y-2">
      <Label>Service Image</Label>
       <Controller name="imageUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} initialImage={field.value}/> )}/>
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

const Step2_Formula = ({ onScanClick, resources, allServices }: { onScanClick: () => void, resources: Resource[], allServices: Service[] }) => {
    const { inventory } = useInventory();
    const { control, setValue, watch, formState: { errors } } = useFormContext<ServiceFormData>();

    const selectedProducts = watch('products') || [];
    const selectedResourceIds = watch('requiredResourceIds') || [];
    const compatibleAddOnIds = watch('compatibleAddOnIds') || [];
    const isAddon = watch('isAddon');
    
    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    const [isResourceSelectorOpen, setIsResourceSelectorOpen] = useState(false);
    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);

    const selectedResources = useMemo(() => {
        return resources.filter(r => selectedResourceIds.includes(r.id));
    }, [resources, selectedResourceIds]);

    const handleProductSelect = (products: InventoryItem[]) => {
      const productsWithQuantity = products.map(p => {
        const existing = selectedProducts.find((sp: any) => sp.id === p.id);
        return {
            ...p,
            quantityUsed: existing?.quantityUsed || 1, // Keep existing quantity or default to 1
        };
      });
      setValue('products', productsWithQuantity, { shouldDirty: true, shouldTouch: true });
      setIsProductBrowserOpen(false);
    };
    
    const handleResourceSelect = (resources: Resource[]) => {
        setValue('requiredResourceIds', resources.map(r => r.id), { shouldDirty: true, shouldTouch: true });
        setIsResourceSelectorOpen(false);
    };
    
    const handleAddOnSelect = (addOns: Service[]) => {
        setValue('compatibleAddOnIds', addOns.map(a => a.id), { shouldDirty: true, shouldTouch: true });
    };

    const removeProduct = (productId: string) => {
      const newProducts = selectedProducts.filter((p: any) => p.id !== productId);
      setValue('products', newProducts, { shouldDirty: true, shouldTouch: true });
    };

    const removeResource = (resourceId: string) => {
        setValue('requiredResourceIds', selectedResourceIds.filter((id: string) => id !== resourceId), { shouldDirty: true, shouldTouch: true });
    };
    
    const removeAddOn = (addOnId: string) => {
        setValue('compatibleAddOnIds', compatibleAddOnIds.filter((id: string) => id !== addOnId), { shouldDirty: true, shouldTouch: true });
    };

    const selectedAddOns = allServices.filter(s => compatibleAddOnIds.includes(s.id));

    return (
        <>
            <Card>
                <CardHeader><CardTitle>Formula</CardTitle></CardHeader>
                 <CardContent className="space-y-6">
                    <div className="space-y-2"><div className='flex items-center gap-2'><Package className="w-5 h-5 text-primary" /><Label className="text-base font-semibold">Product Formula</Label></div>
                    {selectedProducts.length > 0 ? (<Card><CardContent className="p-2 space-y-2">{selectedProducts.map((product: any, index: number) => {
                      const inventoryItem = inventory.find(i => i.id === product.id);
                      const unit = inventoryItem?.costingMethod === 'uses' 
                        ? (inventoryItem.useUnit || 'uses') 
                        : (inventoryItem?.unit || 'unit');
                        
                      return (
                        <div key={product.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 gap-2">
                          <span className="text-sm font-medium flex-1 truncate pr-2">{product.name}</span>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              value={product.quantityUsed || ''}
                              onChange={(e) => {
                                const newQuantity = parseFloat(e.target.value) || 0;
                                const updatedProducts = [...selectedProducts];
                                updatedProducts[index] = { ...product, quantityUsed: newQuantity };
                                setValue('products', updatedProducts, { shouldDirty: true });
                              }}
                              className="w-20 h-8 text-center"
                              step="0.1"
                            />
                            <span className="text-xs text-muted-foreground w-10 truncate">{unit}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive flex-shrink-0" onClick={() => removeProduct(product.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}</CardContent></Card>) : (<Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No products added yet.</CardContent></Card>)}
                    <div className='flex gap-2'><Button variant="outline" onClick={() => setIsProductBrowserOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Browse Library</Button><Button variant="outline" onClick={onScanClick} type="button"><QrCode className="mr-2 h-4 w-4" /> Scan to Add</Button></div></div>
                    <div className="space-y-2"><div className='flex items-center gap-2'><Hammer className="w-5 h-5 text-primary" /><Label className="text-base font-semibold">Required Resources</Label></div>
                    {selectedResources.length > 0 ? (<Card><CardContent className="p-2 space-y-2">{selectedResources.map((item: any) => (<div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"><span className="text-sm font-medium">{item.name}</span><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeResource(item.id)}><Trash2 className="h-4 w-4" /></Button></div>))}</CardContent></Card>) : (<Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No resources required.</CardContent></Card>)}
                    <Button variant="outline" onClick={() => setIsResourceSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Resources</Button></div>
                    {!isAddon && (<div className="space-y-2"><div className='flex items-center gap-2'><PlusCircle className="w-5 h-5 text-primary" /><Label className="text-base font-semibold">Compatible Add-ons</Label></div>
                    {selectedAddOns.length > 0 ? (<Card><CardContent className="p-2 space-y-2">{selectedAddOns.map((item: any) => (<div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"><span className="text-sm font-medium">{item.name}</span><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAddOn(item.id)}><Trash2 className="h-4 w-4" /></Button></div>))}</CardContent></Card>) : (<Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No add-ons selected.</CardContent></Card>)}
                    <Button variant="outline" onClick={() => setIsAddOnSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Add-ons</Button></div>)}
                </CardContent>
            </Card>
            <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleProductSelect} allProducts={inventory.filter(i => i.type === 'professional' || i.type === 'retail')} initialSelected={selectedProducts as InventoryItem[]} />
            <SelectResourcesDialog open={isResourceSelectorOpen} onOpenChange={setIsResourceSelectorOpen} onSelect={handleResourceSelect} allResources={resources} initialSelected={selectedResources} />
            <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={handleAddOnSelect} allAddOns={allServices.filter(s => s.type === 'addon')} initialSelected={selectedAddOns as Service[]} />
        </>
    );
};

const PricingTierInput = ({ tier, control }: { tier: PricingTier, control: Control<ServiceFormData> }) => {
    const { watch, setValue } = useFormContext<ServiceFormData>();
    
    const serviceTiers = watch('serviceTiers') || [];
    const tierData = serviceTiers.find(t => t.tierId === tier.id);
    const isEnabled = !!tierData;

    const handleToggle = (checked: boolean) => {
        let newTiers = [...serviceTiers];
        if (checked) {
            if (!newTiers.find(t => t.tierId === tier.id)) {
                newTiers.push({ tierId: tier.id, price: 0, durationMinutes: 0 });
            }
        } else {
            newTiers = newTiers.filter(t => t.tierId !== tier.id);
        }
        setValue('serviceTiers', newTiers, { shouldDirty: true });
    };

    const handlePriceChange = (price: number) => {
        const newTiers = serviceTiers.map(t => t.tierId === tier.id ? {...t, price} : t);
        setValue('serviceTiers', newTiers, { shouldDirty: true });
    };

    const handleDurationChange = (durationMinutes: number) => {
        const newTiers = serviceTiers.map(t => t.tierId === tier.id ? {...t, durationMinutes} : t);
        setValue('serviceTiers', newTiers, { shouldDirty: true });
    };

    return (
        <Card>
            <CardHeader className="p-4 flex flex-row items-center justify-between">
                <CardTitle className="text-base capitalize">{tier.name}</CardTitle>
                <Switch checked={isEnabled} onCheckedChange={handleToggle} />
            </CardHeader>
            {isEnabled && (
                <CardContent className="p-4 pt-0 grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <Label htmlFor={`${tier.id}-price`} className="text-xs flex items-center gap-1.5"><DollarSign className="w-3 h-3 text-muted-foreground"/>Price</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input id={`${tier.id}-price`} type="number" placeholder="0.00" value={tierData?.price ?? ''} onChange={e => handlePriceChange(parseFloat(e.target.value) || 0)} className="pl-7" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor={`${tier.id}-durationMinutes`} className="text-xs flex items-center gap-1.5"><Clock className="w-3 h-3 text-muted-foreground"/>Duration</Label>
                        <div className="relative">
                            <Input id={`${tier.id}-durationMinutes`} type="number" placeholder="0" value={tierData?.durationMinutes ?? ''} onChange={e => handleDurationChange(parseInt(e.target.value) || 0)} className="pr-12"/>
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">mins</span>
                        </div>
                    </div>
                </CardContent>
            )}
        </Card>
    );
};


const Step3_PricingBooking = ({ breakEvenCost, pricingTiers }: { breakEvenCost: number, pricingTiers: PricingTier[] }) => {
    const { control, watch, register, setValue, formState: { errors } } = useFormContext<ServiceFormData>();
    const isAddon = watch('isAddon');
    const depositType = watch('depositType');
    const serviceTiers = watch('serviceTiers');

    useEffect(() => {
        if (depositType === 'breakeven') {
            setValue('depositAmount', breakEvenCost, { shouldValidate: true });
            setValue('depositSubType', 'flat', { shouldValidate: true });
        }
    }, [depositType, breakEvenCost, setValue]);

    return (
        <Card>
            <CardHeader><CardTitle>Pricing & Booking</CardTitle></CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-4">
                    <Label>Pricing & Duration by Tier</Label>
                     {errors.serviceTiers && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>At least one tier must be configured.</AlertDescription></Alert>}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {pricingTiers.map(tier => <PricingTierInput key={tier.id} tier={tier} control={control} />)}
                    </div>
                </div>

                <Card className="bg-muted/50"><CardContent className="p-4 space-y-4">
                    <h4 className="font-semibold text-center">Profitability Preview</h4>
                     <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <p className="font-semibold">Level</p>
                        <p className="font-semibold">Profit</p>
                        <p className="font-semibold">Margin</p>
                    </div>
                     {(serviceTiers || []).map(tier => {
                        const tierInfo = pricingTiers.find(t => t.id === tier.tierId);
                        if (!tierInfo) return null;

                        const netProfit = tier.price - breakEvenCost;
                        const profitMargin = tier.price > 0 ? (netProfit / tier.price) * 100 : 0;
                        return (
                            <div key={tier.tierId} className="grid grid-cols-3 gap-2 text-center text-sm items-center">
                                <p className="capitalize font-medium">{tierInfo.name}</p>
                                <p className={cn("font-mono", netProfit >= 0 ? 'text-primary' : 'text-destructive')}>${netProfit.toFixed(2)}</p>
                                <p className={cn("font-mono", profitMargin >= 0 ? 'text-primary' : 'text-destructive')}>{profitMargin.toFixed(1)}%</p>
                            </div>
                        )
                     })}
                    <div className="flex justify-between items-center text-xs border-t pt-2 mt-2">
                        <p className="text-muted-foreground">Break-Even Cost:</p>
                        <p className="font-mono text-destructive">${breakEvenCost.toFixed(2)}</p>
                    </div>
                </CardContent></Card>
                
                {!isAddon && (
                    <div className="space-y-4 pt-4 border-t">
                        <Label>Deposit Requirement</Label>
                        <Controller name="depositType" control={control} defaultValue="none" render={({ field }) => (
                            <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-4">
                                <div><RadioGroupItem value="none" id="none-edit" className="peer sr-only" /><Label htmlFor="none-edit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">None</Label></div>
                                <div><RadioGroupItem value="deposit" id="deposit-edit" className="peer sr-only" /><Label htmlFor="deposit-edit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Deposit</Label></div>
                                <div><RadioGroupItem value="breakeven" id="breakeven-edit" className="peer sr-only" /><Label htmlFor="breakeven-edit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Breakeven<span className="text-xs text-muted-foreground font-normal mt-1">${breakEvenCost.toFixed(2)}</span></Label></div>
                                <div><RadioGroupItem value="full" id="full-edit" className="peer sr-only" /><Label htmlFor="full-edit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Pay in Full</Label></div>
                            </RadioGroup>
                        )}/>
                        {['deposit', 'breakeven'].includes(depositType!) && (
                            <Card className="bg-background"><CardContent className="p-4 space-y-4">
                                {depositType === 'deposit' && (
                                <div className="space-y-2">
                                    <Label>Deposit Type</Label>
                                    <Controller name="depositSubType" control={control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger><SelectValue placeholder="Select deposit type" /></SelectTrigger>
                                        <SelectContent><SelectItem value="flat">Flat Rate</SelectItem><SelectItem value="percentage">Percentage</SelectItem></SelectContent>
                                    </Select>
                                    )}/>
                                </div>
                                )}
                                <div className="space-y-2">
                                    <Label>Deposit Amount</Label>
                                    <Controller name="depositAmount" control={control} render={({ field }) => (
                                    <div className="relative">
                                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input type="number" placeholder="25.00" {...field} value={field.value ?? ''} className="pl-8" disabled={depositType === 'breakeven'}/>
                                    </div>
                                    )} />
                                </div>
                            </CardContent></Card>
                        )}
                    </div>
                )}
            </CardContent>
         </Card>
    );
};

const Step4_VisibilityConfirmation = ({ consentForms }: { consentForms: ConsentForm[] }) => {
    const { register, control, setValue, watch } = useFormContext<ServiceFormData>();
    const requiredFormIds = watch('requiredFormIds') || [];
    const [isConsentFormBrowserOpen, setIsConsentFormBrowserOpen] = useState(false);
    
    const requiredForms = consentForms?.filter(f => requiredFormIds.includes(f.id)) || [];

    const handleRemoveForm = (formId: string) => {
        const newIds = requiredFormIds.filter(id => id !== formId);
        setValue('requiredFormIds', newIds, { shouldDirty: true });
    };

    return (
        <>
            <Card>
                <CardHeader><CardTitle>Visibility & Confirmation</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="confirmationMessage-edit">Confirmation Message</Label><Textarea id="confirmationMessage-edit" placeholder="Optional: A message to show clients after they book this service." {...register('confirmationMessage')} /></div>
                    <div className="flex items-center justify-between p-4 border rounded-lg"><div className='space-y-1'><Label htmlFor="private-service-edit">Private Service</Label><p className='text-sm text-muted-foreground'>Hide from public booking page.</p></div><Controller name="isPrivate" control={control} render={({ field }) => ( <Switch id="private-service-edit" checked={field.value} onCheckedChange={field.onChange} /> )}/></div>
                    <div className="space-y-2"><Label>Required Consent Forms</Label>
                    {requiredForms.length > 0 ? (<Card><CardContent className="p-2 space-y-2">{requiredForms.map(form => (<div key={form.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"><span className="text-sm font-medium">{form.title}</span><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveForm(form.id)}><Trash2 className="h-4 w-4" /></Button></div>))}</CardContent></Card>) : (<Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No forms required.</CardContent></Card>)}
                    <Button variant="outline" onClick={() => setIsConsentFormBrowserOpen(true)} type="button" className="w-full"><PlusCircle className="mr-2 h-4 w-4" /> Browse Forms</Button></div>
                </CardContent>
            </Card>
            <BrowseConsentFormsDialog open={isConsentFormBrowserOpen} onOpenChange={setIsConsentFormBrowserOpen} onSelect={(forms) => { setValue('requiredFormIds', forms.map(f => f.id), { shouldDirty: true }); }} allForms={consentForms || []} initialSelected={requiredForms} />
        </>
    );
};


export const EditServiceDialog: React.FC<EditServiceDialogProps> = ({ 
    open, 
    onOpenChange, 
    service,
    services,
    onServiceUpdated,
    categories,
    onNewCategory,
    resources,
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 4;
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const isMobile = useIsMobile();
  
  const methods = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
  });

  useEffect(() => {
    if (service && open) {
        const pricingTiersData: any = {};
        const allTiers = ['apprentice', 'junior', 'senior', 'master'];
        allTiers.forEach(tier => {
            const tierData = service.pricingTiers?.find(t => t.level === tier);
            pricingTiersData[tier] = {
                enabled: !!tierData,
                price: tierData?.price,
                durationMinutes: tierData?.durationMinutes
            };
        });

        methods.reset({
            id: service.id,
            name: service.name,
            type: service.type,
            isAddon: service.type === 'addon',
            isPrivate: service.isPrivate,
            category: service.category,
            duration: service.duration,
            padBefore: service.padBefore || undefined,
            padAfter: service.padAfter || undefined,
            description: service.description || undefined,
            imageUrl: service.imageUrl || undefined,
            pricingTiers: pricingTiersData,
            products: service.products || [],
            requiredResourceIds: service.requiredResourceIds || [],
            compatibleAddOnIds: service.compatibleAddOnIds || [],
            depositType: service.depositType || 'none',
            depositSubType: service.depositSubType,
            depositAmount: service.depositAmount,
            confirmationMessage: service.confirmationMessage || '',
            requiredFormIds: service.requiredFormIds || [],
        });
      setStep(1); // Reset to first step when dialog opens with new service
    }
  }, [service, open, methods]);

  const { watch, trigger, handleSubmit } = methods;
  const values = watch();
  const { duration, padBefore, padAfter, products, requiredResourceIds, pricingTiers } = values;
  const [tmhr, setTmhr] = useState(0);
  const { inventory } = useInventory();
  
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const consentFormsQuery = useMemoFirebase(() => {
      if (!firestore || !selectedTenant) return null;
      return collection(firestore, `tenants/${selectedTenant.id}/consentForms`);
  }, [firestore, selectedTenant]);
  const { data: consentForms } = useCollection<ConsentForm>(consentFormsQuery);


  useEffect(() => {
    if (typeof window !== 'undefined') {
        setTmhr(parseFloat(localStorage.getItem('tmhr') || '50'));
    }
  }, []);

  const breakEvenCost = useMemo(() => {
      const totalDuration = (duration || 0) + (padBefore || 0) + (padAfter || 0);
      const timeCost = (totalDuration / 60) * tmhr;

      const productCost = (products || []).reduce((acc: number, p: any) => {
          const product = inventory.find(i => i.id === p.id);
          const quantity = p.quantityUsed || 1;
          let costPerUse = 0;
            if (product) {
                if (product.costingMethod === 'size' && product.size && product.size > 0) {
                    costPerUse = (product.costPerUnit || 0) / product.size;
                } else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) {
                    costPerUse = (product.costPerUnit || 0) / product.estimatedUses;
                } else {
                    costPerUse = product.costPerUnit || 0;
                }
            }
          return acc + (costPerUse * quantity);
      }, 0);

      const equipmentDepreciation = (requiredResourceIds || []).reduce((acc, resourceId) => {
          const equipmentItem = inventory.find(i => i.id === resourceId && i.type === 'equipment');
          if (!equipmentItem || !equipmentItem.lifespanYears || equipmentItem.lifespanYears === 0) return acc;
          const lifespanInMinutes = (equipmentItem.lifespanYears || 5) * 365 * 8 * 60;
          const costPerMinute = (equipmentItem.costPerUnit || 0) / lifespanInMinutes;
          return acc + (costPerMinute * totalDuration);
      }, 0);

      return timeCost + productCost + equipmentDepreciation;
  }, [duration, padBefore, padAfter, products, requiredResourceIds, tmhr, inventory]);
  
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
  }

  const onSubmit = (data: ServiceFormData) => {
      const enabledTiersData = (['apprentice', 'junior', 'senior', 'master'] as const)
        .filter(tier => data.pricingTiers[tier].enabled)
        .map(tier => ({
            level: tier,
            price: data.pricingTiers[tier].price!,
            durationMinutes: data.pricingTiers[tier].durationMinutes!,
        }));

      const finalPrice = enabledTiersData.find(t => t.level === 'senior')?.price ?? enabledTiersData[0]?.price ?? 0;
      const netProfit = finalPrice - breakEvenCost;
      const margin = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;
      
      const updatedService: Service = {
        ...service,
        ...data,
        price: finalPrice,
        cost: breakEvenCost,
        profit: netProfit,
        margin: margin,
        pricingTiers: enabledTiersData,
      };
      
      onServiceUpdated(updatedService);
      handleOpenChange(false);
  };
  
    const handleNext = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        const fieldsToValidate: (keyof ServiceFormData)[] = [];
        if (step === 1) {
            fieldsToValidate.push('name', 'category', 'duration');
        }
        if (step === 3) {
            fieldsToValidate.push('pricingTiers');
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

  const getStepContent = () => {
      switch(step) {
          case 1: return <Step1_BasicDetails categories={categories} onNewCategory={onNewCategory} />;
          case 2: return <Step2_Formula onScanClick={() => setIsScannerOpen(true)} resources={resources} allServices={services} />;
          case 3: return <Step3_PricingBooking breakEvenCost={breakEvenCost} pricingTiers={[]} />;
          case 4: return <Step4_VisibilityConfirmation consentForms={consentForms || []} />;
          default: return null;
      }
  }
  
  const formId = `edit-service-form-${service.id}`;
  const title = `Edit Service`;
  const description = `Update the details for "${service.name}".`;

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
