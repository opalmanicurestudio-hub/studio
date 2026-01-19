
'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
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
import { type InventoryItem, type Location, type ConsentForm } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { useForm, FormProvider, useFormContext, Controller, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, PlusCircle, QrCode, DollarSign, Package, Hammer, Trash2 } from 'lucide-react';
import { services as allServices, type Service } from '@/lib/data';
import { BrowseProductsDialog } from './BrowseProductsDialog';
import { SelectEquipmentDialog } from './SelectEquipmentDialog';
import { SelectAddOnsDialog } from './SelectAddOnsDialog';
import { BrowseConsentFormsDialog } from './BrowseConsentFormsDialog';
import { Switch } from '../ui/switch';
import { useInventory } from '@/context/InventoryContext';

const serviceSchema = z.object({
    name: z.string().min(1, 'Service name is required'),
    category: z.string().min(1, 'Category is required'),
    duration: z.coerce.number({ invalid_type_error: 'Duration is required.' }).min(1, 'Duration must be at least 1 minute'),
    padBefore: z.coerce.number().optional(),
    padAfter: z.coerce.number().optional(),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    isPrivate: z.boolean().optional(),
    isAddon: z.boolean().optional(),
    
    products: z.array(z.any()).optional(),
    equipment: z.array(z.any()).optional(),
    addOns: z.array(z.any()).optional(),
    
    depositType: z.enum(['none', 'deposit', 'full', 'breakeven']),
    depositSubType: z.enum(['flat', 'percentage']).optional(),
    depositAmount: z.coerce.number().optional(),
    
    price: z.coerce.number().optional(),
    confirmationMessage: z.string().optional(),
    requiredFormIds: z.array(z.string()).optional(),
});

type ServiceFormData = z.infer<typeof serviceSchema>;

const AddServiceForm = ({ 
    categories, 
    onNewCategory,
    breakEvenCost,
    onScanClick
}: { 
    categories: string[];
    onNewCategory: (category: string) => void;
    breakEvenCost: number;
    onScanClick: () => void;
}) => {
    const { inventory } = useInventory();
    const { register, control, setValue, watch, formState: { errors } } = useFormContext<ServiceFormData>();
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    
    const requiredFormIds = watch('requiredFormIds') || [];
    const [isConsentFormBrowserOpen, setIsConsentFormBrowserOpen] = useState(false);
    
    const { consentForms } = useInventory();
    const requiredForms = consentForms.filter(f => requiredFormIds.includes(f.id));

    const handleRemoveForm = (formId: string) => {
        const newIds = requiredFormIds.filter(id => id !== formId);
        setValue('requiredFormIds', newIds, { shouldDirty: true });
    };

    const handleAddNewCategory = () => {
        if (newCategoryName.trim() && !categories.includes(newCategoryName.trim())) {
            const newCategory = newCategoryName.trim();
            onNewCategory(newCategory);
            setValue('category', newCategory, { shouldValidate: true });
            setNewCategoryName('');
            setIsAddingCategory(false);
        }
    };
    
    const selectedProducts = watch('products') || [];
    const selectedEquipment = watch('equipment') || [];
    const selectedAddOns = watch('addOns') || [];
    const isAddon = watch('isAddon');
    const depositType = watch('depositType');

    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    const [isEquipmentSelectorOpen, setIsEquipmentSelectorOpen] = useState(false);
    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);

    useEffect(() => {
        if (depositType === 'breakeven') {
            setValue('depositAmount', breakEvenCost, { shouldValidate: true });
            setValue('depositSubType', 'flat', { shouldValidate: true });
        }
    }, [depositType, breakEvenCost, setValue]);

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
    
    const handleEquipmentSelect = (equipment: InventoryItem[]) => {
        setValue('equipment', equipment, { shouldDirty: true, shouldTouch: true });
        setIsEquipmentSelectorOpen(false);
    };
    
    const handleAddOnSelect = (addOns: Service[]) => {
        setValue('addOns', addOns, { shouldDirty: true, shouldTouch: true });
        setIsAddOnSelectorOpen(false);
    };

    const removeProduct = (productId: string) => {
      const newProducts = selectedProducts.filter((p: any) => p.id !== productId);
      setValue('products', newProducts, { shouldDirty: true, shouldTouch: true });
    };

    const removeEquipment = (equipmentId: string) => {
        setValue('equipment', selectedEquipment.filter((e: any) => e.id !== equipmentId), { shouldDirty: true, shouldTouch: true });
    };
    
    const removeAddOn = (addOnId: string) => {
        setValue('addOns', selectedAddOns.filter((a: any) => a.id !== addOnId), { shouldDirty: true, shouldTouch: true });
    };

    const price = watch('price');
    const finalPrice = price || 0;
    const netProfit = finalPrice - breakEvenCost;
    const profitMargin = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;
    
    return (
    <>
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className='space-y-1'><Label htmlFor="is-addon">Is this an Add-on Service?</Label><p className='text-sm text-muted-foreground'>Add-ons can be appended to primary services.</p></div>
                        <Controller name="isAddon" control={control} render={({ field }) => ( <Switch id="is-addon" checked={field.value} onCheckedChange={field.onChange} /> )}/>
                    </div>
                    <div className="space-y-2"><Label htmlFor="service-name">Name</Label><Input id="service-name" placeholder="e.g., Signature Haircut" {...register('name')} />{errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}</div>
                    <div className="space-y-2"><Label htmlFor="category">Category</Label>
                    {isAddingCategory ? ( <div className="flex gap-2"> <Input placeholder="Enter new category name..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddNewCategory()} /> <Button onClick={handleAddNewCategory} type="button"><Check className="h-4 w-4" /></Button> </div> ) : ( <div className="flex gap-2"> <Controller name="category" control={control} render={({ field }) => ( <Select onValueChange={field.onChange} value={field.value}> <SelectTrigger> <SelectValue placeholder="Select a category" /> </SelectTrigger> <SelectContent> {categories.map(cat => ( <SelectItem key={cat} value={cat}>{cat}</SelectItem> ))} </SelectContent> </Select> )}/> <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button"> <PlusCircle className="h-4 w-4" /> </Button> </div> )}
                    {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>}</div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2"><Label htmlFor="duration">Duration (min)</Label><Input id="duration" type="number" placeholder="e.g., 60" {...register('duration', { valueAsNumber: true })}/>{errors.duration && <p className="text-sm text-destructive">{errors.duration.message}</p>}</div>
                        <div className="space-y-2"><Label htmlFor="pad-before">Pad Before (min)</Label><Input id="pad-before" type="number" placeholder="e.g., 0" {...register('padBefore')} /></div>
                        <div className="space-y-2"><Label htmlFor="pad-after">Pad After (min)</Label><Input id="pad-after" type="number" placeholder="e.g., 15" {...register('padAfter')} /></div>
                    </div>
                    <div className="space-y-2"><Label htmlFor="description">Description</Label><Textarea id="description" placeholder="Describe the service for your booking page..." {...register('description')} /></div>
                    <div className="space-y-2"><Label>Service Image</Label><Controller name="imageUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} /> )}/></div>
                </CardContent>
            </Card>

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
                    <div className="space-y-2"><div className='flex items-center gap-2'><Hammer className="w-5 h-5 text-primary" /><Label className="text-base font-semibold">Equipment Used</Label></div>
                    {selectedEquipment.length > 0 ? (<Card><CardContent className="p-2 space-y-2">{selectedEquipment.map((item: any) => (<div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"><span className="text-sm font-medium">{item.name}</span><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeEquipment(item.id)}><Trash2 className="h-4 w-4" /></Button></div>))}</CardContent></Card>) : (<Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No equipment added.</CardContent></Card>)}
                    <Button variant="outline" onClick={() => setIsEquipmentSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Equipment</Button></div>
                    {!isAddon && (<div className="space-y-2"><div className='flex items-center gap-2'><PlusCircle className="w-5 h-5 text-primary" /><Label className="text-base font-semibold">Compatible Add-ons</Label></div>
                    {selectedAddOns.length > 0 ? (<Card><CardContent className="p-2 space-y-2">{selectedAddOns.map((item: any) => (<div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"><span className="text-sm font-medium">{item.name}</span><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAddOn(item.id)}><Trash2 className="h-4 w-4" /></Button></div>))}</CardContent></Card>) : (<Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No add-ons selected.</CardContent></Card>)}
                    <Button variant="outline" onClick={() => setIsAddOnSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Add-ons</Button></div>)}
                </CardContent>
            </Card>

             <Card>
                <CardHeader><CardTitle>Pricing & Booking</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2"><Label htmlFor="final-price">Final Price</Label><div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input id="final-price" type="number" placeholder="100.00" {...register('price', { valueAsNumber: true })} className="pl-8"/></div></div>
                    <Card className="bg-muted/50"><CardContent className="p-4 space-y-4">
                        <h4 className="font-semibold text-center">Profitability Preview</h4>
                        <div className="flex justify-between items-center"><p className="text-sm text-muted-foreground">Break-Even Cost:</p><p className="font-mono text-destructive">${breakEvenCost.toFixed(2)}</p></div>
                        <div className="flex justify-between items-center font-medium border-t pt-2 mt-2"><p>Net Profit:</p><p className="text-primary">${netProfit.toFixed(2)}</p></div>
                        <div className="flex justify-between items-center text-sm text-muted-foreground"><span>Profit Margin:</span><span className="text-primary">{profitMargin.toFixed(1)}%</span></div>
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
                            {['deposit', 'breakeven'].includes(depositType) && (
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
                                            <Input type="number" placeholder="25.00" {...field} className="pl-8" disabled={depositType === 'breakeven'}/>
                                        </div>
                                        )} />
                                    </div>
                                </CardContent></Card>
                            )}
                        </div>
                    )}
                </CardContent>
             </Card>

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
        </div>
        <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleProductSelect} allProducts={inventory.filter(i => i.type === 'professional' || i.type === 'retail')} initialSelected={selectedProducts as InventoryItem[]} />
        <SelectEquipmentDialog open={isEquipmentSelectorOpen} onOpenChange={setIsEquipmentSelectorOpen} onSelect={handleEquipmentSelect} allEquipment={inventory.filter(i => i.type === 'equipment')} initialSelected={selectedEquipment as InventoryItem[]} />
        <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={handleAddOnSelect} allAddOns={allServices.filter(s => s.type === 'addon')} initialSelected={selectedAddOns as Service[]} />
        <BrowseConsentFormsDialog open={isConsentFormBrowserOpen} onOpenChange={setIsConsentFormBrowserOpen} onSelect={(forms) => { setValue('requiredFormIds', forms.map(f => f.id), { shouldDirty: true }); }} allForms={consentForms} initialSelected={requiredForms} />
    </>
    );
};

export const AddServiceDialog = ({
    open,
    onOpenChange,
    categories,
    onNewCategory,
    onServiceAdded,
}: { 
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
  onNewCategory: (category: string) => void;
  onServiceAdded: (service: Service) => void;
}) => {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  const methods = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      isPrivate: false,
      isAddon: false,
      products: [],
      equipment: [],
      addOns: [],
      depositType: 'none',
      price: 0,
    }
  });

  const { watch } = methods;
  const values = watch();
  const { duration, padBefore, padAfter, products, equipment } = values;
  const [tmhr, setTmhr] = useState(0);

  const { inventory, consentForms } = useInventory();

  useEffect(() => {
    if (typeof window !== 'undefined') {
        setTmhr(parseFloat(localStorage.getItem('tmhr') || '50'));
    }
  }, []);

  useEffect(() => {
    if (open) {
      methods.reset({ isAddon: false, isPrivate: false, depositType: 'none', price: 0, products: [], equipment: [], addOns: [] });
    }
  }, [open, methods]);

  const breakEvenCost = useMemo(() => {
      const totalDuration = (duration || 0) + (padBefore || 0) + (padAfter || 0);
      const timeCost = (totalDuration / 60) * tmhr;

      const productCost = (products || []).reduce((acc: number, p: any) => {
          const product = inventory.find(i => i.id === p.id);
          const quantity = p.quantityUsed || 1;
          return acc + ((product?.costPerUnit || 0) * quantity);
      }, 0);

      const equipmentDepreciation = (equipment || []).reduce((acc: any, eq: any) => {
          const equipmentItem = inventory.find(i => i.id === eq.id);
          if (!equipmentItem) return acc;
          const lifespanInMinutes = (equipmentItem.lifespanYears || 5) * 365 * 8 * 60;
          const costPerMinute = (equipmentItem.costPerUnit || 0) / lifespanInMinutes;
          return acc + (costPerMinute * totalDuration);
      }, 0);

      return timeCost + productCost + equipmentDepreciation;
  }, [duration, padBefore, padAfter, products, equipment, tmhr, inventory]);
  
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
        setTimeout(() => {
            methods.reset();
        }, 300);
    }
  }

  const onSubmit = (data: ServiceFormData) => {
      const finalPrice = data.price || 0;
      const netProfit = finalPrice - breakEvenCost;
      const margin = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;
      
      const newService: Service = {
        id: `svc-${Date.now()}`,
        name: data.name,
        type: data.isAddon ? 'addon' : 'service',
        category: data.category || 'Uncategorized',
        duration: data.duration,
        padBefore: data.padBefore,
        padAfter: data.padAfter,
        price: finalPrice,
        cost: breakEvenCost,
        profit: netProfit,
        margin: margin,
        imageUrl: data.imageUrl,
        products: data.products,
        equipment: data.equipment,
        description: data.description,
        isPrivate: data.isPrivate,
        confirmationMessage: data.confirmationMessage,
        requiredFormIds: data.requiredFormIds,
        depositType: data.depositType,
        depositSubType: data.depositSubType,
        depositAmount: data.depositAmount
      };
      
      onServiceAdded(newService);

      toast({
          title: `New ${data.isAddon ? 'Add-on' : 'Service'} Created`,
          description: `${data.name} has been added to your library.`
      })
      handleOpenChange(false);
  };
  
  const formId = `add-service-form`;
  const title = `Add New ${methods.getValues('isAddon') ? 'Add-on' : 'Service'}`;
  const description = "Create a new service for your menu.";

  const formBody = (
     <FormProvider {...methods}>
      <form id={formId} onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={isMobile ? "p-4 border-b text-left" : "p-6 pb-4"}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-6 py-4">
                <AddServiceForm 
                    categories={categories}
                    onNewCategory={onNewCategory}
                    onScanClick={() => setIsScannerOpen(true)}
                    breakEvenCost={breakEvenCost}
                />
            </div>
        </div>
        <DialogFooter className={isMobile ? "p-4 border-t" : "p-6 border-t"}>
          <Button variant="outline" onClick={() => onOpenChange(false)} type="button">Cancel</Button>
          <Button type="submit" form={formId}>Save Service</Button>
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
