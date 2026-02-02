
'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { ScrollArea } from '../ui/scroll-area';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, query } from 'firebase/firestore';
import { nanoid } from 'nanoid';

const serviceSchema = z.object({
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
  
  serviceTiers: z.array(z.object({
      tierId: z.string(),
      price: z.coerce.number().min(0, "Price must be positive."),
      durationMinutes: z.coerce.number().min(1, "Duration must be at least 1."),
  })).min(1, "At least one pricing tier must be configured."),

  confirmationMessage: z.string().optional(),
  requiredFormIds: z.array(z.string()).optional(),
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
        <div className='space-y-1'><Label htmlFor="is-addon">Is this an Add-on Service?</Label><p className='text-sm text-muted-foreground'>Add-ons can be appended to primary services.</p></div>
        <Controller name="isAddon" control={control} render={({ field }) => ( <Switch id="is-addon" checked={field.value} onCheckedChange={(checked) => { field.onChange(checked); setValue('type', checked ? 'addon' : 'service'); }} /> )}/>
    </div>
    <div className="space-y-2">
      <Label htmlFor="service-name">Service Name</Label>
      <Input id="service-name" placeholder="e.g., Signature Haircut" {...register('name')} />
       {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
    </div>
    <div className="space-y-2">
      <Label htmlFor="category">Category</Label>
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
            <Label htmlFor="duration">Base Duration (min)</Label>
            <Input id="duration" type="number" placeholder="e.g., 60" {...register('duration')}/>
            {errors.duration && <p className="text-sm text-destructive">{errors.duration.message}</p>}
        </div>
        <div className="space-y-2">
            <Label htmlFor="pad-before">Pad Before (min)</Label>
            <Input id="pad-before" type="number" placeholder="e.g., 0" {...register('padBefore')} />
        </div>
        <div className="space-y-2">
            <Label htmlFor="pad-after">Pad After (min)</Label>
            <Input id="pad-after" type="number" placeholder="e.g., 15" {...register('padAfter')} />
        </div>
    </div>
     <div className="space-y-2">
        <Label htmlFor="capacity">Capacity</Label>
        <Input id="capacity" type="number" placeholder="1" {...register('capacity')}/>
        <p className="text-xs text-muted-foreground">Max number of clients for this service at the same time. Set to 1 for individual services.</p>
        {errors.capacity && <p className="text-sm text-destructive">{errors.capacity.message}</p>}
    </div>
    
    <div className="space-y-2">
      <Label htmlFor="description">Description</Label>
      <Textarea id="description" placeholder="Describe the service for your booking page..." {...register('description')} />
    </div>

    <div className="space-y-2">
      <Label>Service Image</Label>
       <Controller name="imageUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} /> )}/>
    </div>
  </div>
    );
};

type EditableFormulaItem = {
    id: string; // productId
    name: string;
    quantity: number;
    unit: string;
};

const Step2_Formula = ({ onScanClick, resources, allServices }: { onScanClick: () => void, resources: Resource[], allServices: Service[] }) => {
    const { inventory } = useInventory();
    const { control, setValue, watch } = useFormContext<ServiceFormData>();

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
    const { watch, setValue, formState: { errors } } = useFormContext<ServiceFormData>();
    const serviceTiers = watch('serviceTiers') || [];
    const tierData = serviceTiers.find(t => t.tierId === tier.id);
    const isEnabled = !!tierData;

    const handleToggle = (checked: boolean) => {
        let newTiers = [...serviceTiers];
        if (checked) {
            if (!newTiers.find(t => t.tierId === tier.id)) {
                newTiers.push({ tierId: tier.id, price: 0, durationMinutes: watch('duration') || 0 });
            }
        } else {
            newTiers = newTiers.filter(t => t.tierId !== tier.id);
        }
        setValue('serviceTiers', newTiers, { shouldDirty: true, shouldValidate: true });
    };

    const handlePriceChange = (price: number) => {
        const newTiers = serviceTiers.map(t => t.tierId === tier.id ? {...t, price} : t);
        setValue('serviceTiers', newTiers, { shouldDirty: true });
    };

    const handleDurationChange = (durationMinutes: number) => {
        const newTiers = serviceTiers.map(t => t.tierId === tier.id ? {...t, durationMinutes} : t);
        setValue('serviceTiers', newTiers, { shouldDirty: true });
    };
    
    const getError = (fieldName: 'price' | 'durationMinutes') => {
        if (!errors.serviceTiers) return null;
        const tierIndex = serviceTiers.findIndex(t => t.tierId === tier.id);
        if (tierIndex === -1) return null;
        const error = errors.serviceTiers[tierIndex]?.[fieldName] as any;
        return error?.message;
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
                         {getError('price') && <p className="text-sm text-destructive">{getError('price')}</p>}
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor={`${tier.id}-durationMinutes`} className="text-xs flex items-center gap-1.5"><Clock className="w-3 h-3 text-muted-foreground"/>Duration</Label>
                        <div className="relative">
                            <Input id={`${tier.id}-durationMinutes`} type="number" placeholder="0" value={tierData?.durationMinutes ?? ''} onChange={e => handleDurationChange(parseInt(e.target.value) || 0)} className="pr-12"/>
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">mins</span>
                        </div>
                        {getError('durationMinutes') && <p className="text-sm text-destructive">{getError('durationMinutes')}</p>}
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
                     {errors.serviceTiers && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>At least one pricing tier must be configured with a price and duration.</AlertDescription></Alert>}
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
                                <div><RadioGroupItem value="none" id="none" className="peer sr-only" /><Label htmlFor="none" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">None</Label></div>
                                <div><RadioGroupItem value="deposit" id="deposit" className="peer sr-only" /><Label htmlFor="deposit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Deposit</Label></div>
                                <div><RadioGroupItem value="breakeven" id="breakeven" className="peer sr-only" /><Label htmlFor="breakeven" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Breakeven<span className="text-xs text-muted-foreground font-normal mt-1">${breakEvenCost.toFixed(2)}</span></Label></div>
                                <div><RadioGroupItem value="full" id="full" className="peer sr-only" /><Label htmlFor="full" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Pay in Full</Label></div>
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
                    <div className="space-y-2"><Label htmlFor="confirmationMessage">Confirmation Message</Label><Textarea id="confirmationMessage" placeholder="Optional: A message to show clients after they book this service." {...register('confirmationMessage')} /></div>
                    <div className="flex items-center justify-between p-4 border rounded-lg"><div className='space-y-1'><Label htmlFor="private-service">Private Service</Label><p className='text-sm text-muted-foreground'>Hide from public booking page.</p></div><Controller name="isPrivate" control={control} render={({ field }) => ( <Switch id="private-service" checked={field.value} onCheckedChange={field.onChange} /> )}/></div>
                    <div className="space-y-2"><Label>Required Consent Forms</Label>
                    {requiredForms.length > 0 ? (<Card><CardContent className="p-2 space-y-2">{requiredForms.map(form => (<div key={form.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"><span className="text-sm font-medium">{form.title}</span><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveForm(form.id)}><Trash2 className="h-4 w-4" /></Button></div>))}</CardContent></Card>) : (<Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No forms required.</CardContent></Card>)}
                    <Button variant="outline" onClick={() => setIsConsentFormBrowserOpen(true)} type="button" className="w-full"><PlusCircle className="mr-2 h-4 w-4" /> Browse Forms</Button></div>
                </CardContent>
            </Card>
            <BrowseConsentFormsDialog open={isConsentFormBrowserOpen} onOpenChange={setIsConsentFormBrowserOpen} onSelect={(forms) => { setValue('requiredFormIds', forms.map(f => f.id), { shouldDirty: true }); }} allForms={consentForms || []} initialSelected={requiredForms} />
        </>
    );
};

interface AddServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServiceAdded: (service: Service) => void;
  categories: string[];
  onNewCategory: (category: string) => void;
  resources: Resource[];
  services: Service[];
}

export const AddServiceDialog: React.FC<AddServiceDialogProps> = ({
  open,
  onOpenChange,
  onServiceAdded,
  categories,
  onNewCategory,
  resources,
  services,
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 4;
  const isMobile = useIsMobile();
  
  const methods = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      isAddon: false,
      isPrivate: false,
      type: 'service',
      capacity: 1,
      products: [],
      requiredResourceIds: [],
      compatibleAddOnIds: [],
      depositType: 'none',
      pricingTiers: [{ tierId: 'tier-senior', price: 0, durationMinutes: 0 }],
      requiredFormIds: [],
    }
  });

  useEffect(() => {
    if (open) {
      methods.reset({
        isAddon: false,
        isPrivate: false,
        type: 'service',
        capacity: 1,
        products: [],
        requiredResourceIds: [],
        compatibleAddOnIds: [],
        depositType: 'none',
        pricingTiers: [{ tierId: 'tier-senior', price: 0, durationMinutes: 0 }],
        requiredFormIds: [],
      });
      setStep(1);
    }
  }, [open, methods]);

  const { watch, trigger, handleSubmit } = methods;
  const values = watch();
  const { duration, padBefore, padAfter, products, requiredResourceIds, pricingTiers } = values;
  const [tmhr, setTmhr] = useState(0);
  const { inventory } = useInventory();
  const { firestore, selectedTenant } = useTenant();
  const consentFormsQuery = useMemoFirebase(() => {
      if (!firestore || !selectedTenant) return null;
      return collection(firestore, `tenants/${selectedTenant.id}/consentForms`);
  }, [firestore, selectedTenant]);
  const { data: consentForms } = useCollection<ConsentForm>(consentFormsQuery);

  const pricingTiersQuery = useMemoFirebase(() => {
    if (!firestore || !selectedTenant) return null;
    return collection(firestore, `tenants/${selectedTenant.id}/pricingTiers`);
  }, [firestore, selectedTenant]);
  const { data: pricingTiersData } = useCollection<PricingTier>(pricingTiersQuery);


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
      const enabledTiersData = (pricingTiersData || [])
        .filter(tier => data.pricingTiers[tier.id as keyof typeof data.pricingTiers]?.enabled)
        .map(tier => ({
            tierId: tier.id,
            price: data.pricingTiers[tier.id as keyof typeof data.pricingTiers].price!,
            durationMinutes: data.pricingTiers[tier.id as keyof typeof data.pricingTiers].durationMinutes!,
        }));

      const finalPrice = enabledTiersData.find(t => t.tierId === 'tier-senior')?.price ?? enabledTiersData[0]?.price ?? 0;
      const netProfit = finalPrice - breakEvenCost;
      const margin = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;
      
      const newService: Service = {
        id: `svc-${nanoid()}`,
        name: data.name,
        type: data.isAddon ? 'addon' : 'service',
        category: data.category,
        duration: data.duration,
        padBefore: data.padBefore,
        padAfter: data.padAfter,
        description: data.description,
        imageUrl: data.imageUrl,
        isPrivate: data.isPrivate,
        capacity: data.capacity,
        products: data.products,
        requiredResourceIds: data.requiredResourceIds,
        compatibleAddOnIds: data.compatibleAddOnIds,
        depositType: data.depositType,
        depositSubType: data.depositSubType,
        depositAmount: data.depositAmount,
        price: finalPrice,
        cost: breakEvenCost,
        profit: netProfit,
        margin: margin,
        serviceTiers: enabledTiersData,
        confirmationMessage: data.confirmationMessage,
        requiredFormIds: data.requiredFormIds,
      };
      onServiceAdded(newService);
      onOpenChange(false);
  };
  
    const handleNext = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        const fieldsToValidate: (keyof ServiceFormData)[] = [];
        if (step === 1) {
            fieldsToValidate.push('name', 'category', 'duration');
        }
        if (step === 3) {
            fieldsToValidate.push('serviceTiers');
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
          case 2: return <Step2_Formula onScanClick={() => {}} resources={resources} allServices={services} />;
          case 3: return <Step3_PricingBooking breakEvenCost={breakEvenCost} pricingTiers={pricingTiersData || []} />;
          case 4: return <Step4_VisibilityConfirmation consentForms={consentForms || []} />;
          default: return null;
      }
  }
  
  const formId = "add-service-form";
  const title = "Add New Service";
  const description = "Use this wizard to create a new service for your menu.";

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
                <Button type="submit" form={formId}>Save Service</Button>
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
