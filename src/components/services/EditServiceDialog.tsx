
'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusCircle, Package, Hammer, Trash2, QrCode, Check, AlertTriangle, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { inventory, services as allServices, type Service, type InventoryItem, consentForms } from '@/lib/data';
import { BrowseProductsDialog } from './BrowseProductsDialog';
import { SelectEquipmentDialog } from './SelectEquipmentDialog';
import { SelectAddOnsDialog } from './SelectAddOnsDialog';
import { useToast } from '@/hooks/use-toast';
import { useForm, FormProvider, useFormContext, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent } from '../ui/sheet';
import { ScrollArea } from '../ui/scroll-area';
import { BrowseConsentFormsDialog } from './BrowseConsentFormsDialog';

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
    
    products: z.array(z.any()).optional(),
    equipment: z.array(z.any()).optional(),
    addOns: z.array(z.any()).optional(),
    
    depositType: z.enum(['none', 'deposit', 'full']),
    depositAmount: z.coerce.number().optional(),
    
    price: z.coerce.number().optional(),
    confirmationMessage: z.string().optional(),
    requiredFormIds: z.array(z.string()).optional(),
});

type ServiceFormData = z.infer<typeof serviceSchema>;


const EditServiceForm = ({ 
    categories, 
    onNewCategory,
    breakEvenCost,
    onScanClick,
    locations
}: { 
    categories: string[];
    onNewCategory: (category: string) => void;
    breakEvenCost: number;
    onScanClick: () => void;
    locations: any[];
}) => {
    const { register, control, setValue, watch, formState: { errors } } = useFormContext<ServiceFormData>();
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    
    const requiredFormIds = watch('requiredFormIds') || [];
    const [isConsentFormBrowserOpen, setIsConsentFormBrowserOpen] = useState(false);
    
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
    const depositSubType = watch('depositSubType');

    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    const [isEquipmentSelectorOpen, setIsEquipmentSelectorOpen] = useState(false);
    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);

    const handleProductSelect = (products: InventoryItem[]) => {
        setValue('products', products, { shouldDirty: true, shouldTouch: true });
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
        setValue('products', selectedProducts.filter(p => p.id !== productId), { shouldDirty: true, shouldTouch: true });
    };

    const removeEquipment = (equipmentId: string) => {
        setValue('equipment', selectedEquipment.filter(e => e.id !== equipmentId), { shouldDirty: true, shouldTouch: true });
    };
    
    const removeAddOn = (addOnId: string) => {
        setValue('addOns', selectedAddOns.filter(a => a.id !== addOnId), { shouldDirty: true, shouldTouch: true });
    };

    const price = watch('price');
    const finalPrice = price || 0;
    const netProfit = finalPrice - breakEvenCost;
    const profitMargin = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;
    
    return (
    <>
        <div className="grid gap-6 py-4">
            {/* Basics */}
            <Card>
                <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className='space-y-1'><Label htmlFor="is-addon-edit">Is this an Add-on Service?</Label><p className='text-sm text-muted-foreground'>Add-ons can be appended to primary services.</p></div>
                        <Controller name="isAddon" control={control} render={({ field }) => ( <Switch id="is-addon-edit" checked={field.value} onCheckedChange={field.onChange} /> )}/>
                    </div>
                    <div className="space-y-2"><Label htmlFor="service-name">Name</Label><Input id="service-name" placeholder="e.g., Signature Haircut" {...register('name')} />{errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}</div>
                    <div className="space-y-2"><Label htmlFor="category">Category</Label>
                    {isAddingCategory ? ( <div className="flex gap-2"><Input placeholder="Enter new category name..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddNewCategory()} /><Button onClick={handleAddNewCategory} type="button"><Check className="h-4 w-4" /></Button></div> ) : ( <div className="flex gap-2"><Controller name="category" control={control} render={({ field }) => ( <Select onValueChange={field.onChange} value={field.value}> <SelectTrigger> <SelectValue placeholder="Select a category" /> </SelectTrigger> <SelectContent> {categories.map(cat => ( <SelectItem key={cat} value={cat}>{cat}</SelectItem> ))} </SelectContent> </Select> )}/> <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button"> <PlusCircle className="h-4 w-4" /> </Button> </div> )}
                    {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>}</div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2"><Label htmlFor="duration">Duration (min)</Label><Input id="duration" type="number" placeholder="e.g., 60" {...register('duration', { valueAsNumber: true })}/>{errors.duration && <p className="text-sm text-destructive">{errors.duration.message}</p>}</div>
                        <div className="space-y-2"><Label htmlFor="pad-before">Pad Before (min)</Label><Input id="pad-before" type="number" placeholder="e.g., 0" {...register('padBefore', { valueAsNumber: true })} /></div>
                        <div className="space-y-2"><Label htmlFor="pad-after">Pad After (min)</Label><Input id="pad-after" type="number" placeholder="e.g., 15" {...register('padAfter', { valueAsNumber: true })} /></div>
                    </div>
                    <div className="space-y-2"><Label htmlFor="description">Description</Label><Textarea id="description" placeholder="Describe the service for your booking page..." {...register('description')} /></div>
                    <div className="space-y-2"><Label>Service Image</Label><Controller name="imageUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} /> )}/></div>
                </CardContent>
            </Card>

            {/* Formula */}
            <Card>
                <CardHeader><CardTitle>Formula</CardTitle></CardHeader>
                 <CardContent className="space-y-6">
                    <div className="space-y-2"><div className='flex items-center gap-2'><Package className="w-5 h-5 text-primary" /><Label className="text-base font-semibold">Product Formula</Label></div>
                    {selectedProducts.length > 0 ? (<Card><CardContent className="p-2 space-y-2">{selectedProducts.map(product => (<div key={product.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"><span className="text-sm font-medium">{product.name}</span><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeProduct(product.id)}><Trash2 className="h-4 w-4" /></Button></div>))}</CardContent></Card>) : (<Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No products added yet.</CardContent></Card>)}
                    <div className='flex gap-2'><Button variant="outline" onClick={() => setIsProductBrowserOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Browse Library</Button><Button variant="outline" onClick={onScanClick} type="button"><QrCode className="mr-2 h-4 w-4" /> Scan to Add</Button></div></div>
                    <div className="space-y-2"><div className='flex items-center gap-2'><Hammer className="w-5 h-5 text-primary" /><Label className="text-base font-semibold">Equipment Used</Label></div>
                    {selectedEquipment.length > 0 ? (<Card><CardContent className="p-2 space-y-2">{selectedEquipment.map(item => (<div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"><span className="text-sm font-medium">{item.name}</span><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeEquipment(item.id)}><Trash2 className="h-4 w-4" /></Button></div>))}</CardContent></Card>) : (<Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No equipment added.</CardContent></Card>)}
                    <Button variant="outline" onClick={() => setIsEquipmentSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Equipment</Button></div>
                    {!isAddon && (<div className="space-y-2"><div className='flex items-center gap-2'><PlusCircle className="w-5 h-5 text-primary" /><Label className="text-base font-semibold">Compatible Add-ons</Label></div>
                    {selectedAddOns.length > 0 ? (<Card><CardContent className="p-2 space-y-2">{selectedAddOns.map(item => (<div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"><span className="text-sm font-medium">{item.name}</span><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAddOn(item.id)}><Trash2 className="h-4 w-4" /></Button></div>))}</CardContent></Card>) : (<Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No add-ons selected.</CardContent></Card>)}
                    <Button variant="outline" onClick={() => setIsAddOnSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Add-ons</Button></div>)}
                </CardContent>
            </Card>

            {/* Pricing & Booking */}
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
                            <Controller name="depositType" control={control} defaultValue="none" render={({ field }) => (<RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-3 gap-2"><div><RadioGroupItem value="none" id="none-edit" className="peer sr-only" /><Label htmlFor="none-edit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">None</Label></div><div><RadioGroupItem value="deposit" id="deposit-edit" className="peer sr-only" /><Label htmlFor="deposit-edit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Deposit</Label></div><div><RadioGroupItem value="full" id="full-edit" className="peer sr-only" /><Label htmlFor="full-edit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Pay in Full</Label></div></RadioGroup>)}/>
                            {depositType === 'deposit' && (
                                <Card className="bg-background"><CardContent className="p-4 space-y-4">
                                <div className="space-y-2"><Label>Deposit Type</Label><Controller name="depositSubType" control={control} render={({ field }) => (<Select onValueChange={field.onChange} value={field.value}><SelectTrigger><SelectValue placeholder="Select deposit type" /></SelectTrigger><SelectContent><SelectItem value="flat">Flat Rate</SelectItem><SelectItem value="percentage">Percentage</SelectItem><SelectItem value="break-even">Break-Even Cost</SelectItem></SelectContent></Select>)}/></div>
                                <div className="space-y-2"><Label>Deposit Amount</Label><Controller name="depositAmount" control={control} render={({ field }) => { const isBreakEven = depositSubType === 'break-even'; const isPercentage = depositSubType === 'percentage'; let displayValue: string | number = field.value || ''; if (isBreakEven && typeof field.value === 'number') { displayValue = field.value.toFixed(2); } return (<div className="relative">{!isPercentage && (<DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />)}<Input type={isBreakEven ? "text" : "number"} placeholder={isPercentage ? '%' : '25.00'} {...field} value={displayValue} onChange={e => { if (!isBreakEven) { field.onChange(parseFloat(e.target.value) || 0) } }} readOnly={isBreakEven} className={!isPercentage ? "pl-8" : ""} />{isPercentage && (<span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>)}</div>)}} /></div>
                                </CardContent></Card>
                            )}
                        </div>
                    )}
                </CardContent>
             </Card>

             {/* Visibility & Confirmation */}
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
        </div>

        <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleProductSelect} allProducts={inventory.filter(i => i.type === 'professional' || i.type === 'retail')} initialSelected={selectedProducts} />
        <SelectEquipmentDialog open={isEquipmentSelectorOpen} onOpenChange={setIsEquipmentSelectorOpen} onSelect={handleEquipmentSelect} allEquipment={inventory.filter(i => i.type === 'equipment')} initialSelected={selectedEquipment} />
        <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={handleAddOnSelect} allAddOns={allServices.filter(s => s.type === 'addon')} initialSelected={selectedAddOns} />
        <BrowseConsentFormsDialog open={isConsentFormBrowserOpen} onOpenChange={setIsConsentFormBrowserOpen} onSelect={(forms) => { setValue('requiredFormIds', forms.map(f => f.id), { shouldDirty: true }); }} allForms={consentForms} initialSelected={requiredForms} />
    </>
    );
};


export const EditServiceDialog = ({ 
    open, 
    onOpenChange, 
    service,
    onServiceUpdated,
    categories,
    onNewCategory,
}: { 
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Service;
  onServiceUpdated: (service: Service) => void;
  categories: string[];
  onNewCategory: (category: string) => void;
}) => {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  const methods = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
  });

  const { watch } = methods;
  const values = watch();
  const { duration, padBefore, padAfter, products, equipment, price } = values;

  const [tmhr, setTmhr] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
        setTmhr(parseFloat(localStorage.getItem('tmhr') || '50'));
    }
  }, []);

  useEffect(() => {
      if (service) {
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
            price: service.price,
            products: service.products || [],
            equipment: service.equipment || [],
            addOns: [], // This should come from service data if available
            depositType: 'none', // This should come from service data if available
            confirmationMessage: service.confirmationMessage || '',
            requiredFormIds: service.requiredFormIds || [],
          });
      }
  }, [service, methods.reset])
  
  
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
  }

  const breakEvenCost = useMemo(() => {
      const totalDuration = (duration || 0) + (padBefore || 0) + (padAfter || 0);
      const timeCost = (totalDuration / 60) * tmhr;

      const productCost = (products || []).reduce((acc: number, p: any) => {
          const product = inventory.find(i => i.id === p.id);
          return acc + (product?.costPerUnit || 0);
      }, 0);

      const equipmentDepreciation = (equipment || []).reduce((acc: any, eq: any) => {
          const equipmentItem = inventory.find(i => i.id === eq.id);
          if (!equipmentItem) return acc;
          const lifespanInMinutes = (equipmentItem.lifespanYears || 5) * 365 * 8 * 60;
          const costPerMinute = (equipmentItem.costPerUnit || 0) / lifespanInMinutes;
          return acc + (costPerMinute * totalDuration);
      }, 0);

      return timeCost + productCost + equipmentDepreciation;
  }, [duration, padBefore, padAfter, products, equipment, tmhr]);

  const onSubmit = (data: ServiceFormData) => {
      const finalPrice = data.price || 0;
      const netProfit = finalPrice - breakEvenCost;
      const margin = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;
      
      const updatedService: Service = {
        id: data.id,
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
        description: data.description,
        isPrivate: data.isPrivate,
        products: data.products,
        equipment: data.equipment,
        confirmationMessage: data.confirmationMessage,
        requiredFormIds: data.requiredFormIds,
      };
      
      onServiceUpdated(updatedService);
      handleOpenChange(false);
  };
  
  const formId = `edit-service-form-${service.id}`;
  const title = `Edit Service`;
  const description = `Update the details for "${service.name}".`;

  const formBody = (
    <FormProvider {...methods}>
      <form id={formId} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={isMobile ? "p-4 border-b text-left" : "p-6 pb-4"}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-4">
              <EditServiceForm 
                 categories={categories}
                 onNewCategory={onNewCategory}
                 onScanClick={() => setIsScannerOpen(true)}
                 locations={[]}
                 breakEvenCost={breakEvenCost}
                 onAddLocationClick={() => {}}
              />
          </div>
        </ScrollArea>
        
        <DialogFooter className={isMobile ? "p-4 border-t" : "p-6 border-t"}>
          <Button variant="outline" onClick={() => onOpenChange(false)} type="button">Cancel</Button>
          <Button type="button" onClick={methods.handleSubmit(onSubmit)}>Save Changes</Button>
        </DialogFooter>
      </form>
    </FormProvider>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] flex flex-col p-0">
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
