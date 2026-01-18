
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { type InventoryItem, type Location } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { useForm, FormProvider, useFormContext, Controller, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, PlusCircle, QrCode, AlertTriangle, Package, Hammer, Trash2, DollarSign } from 'lucide-react';
import { inventory, services as allServices, type Service, consentForms, type ConsentForm } from '@/lib/data';
import { BrowseProductsDialog } from './BrowseProductsDialog';
import { SelectEquipmentDialog } from './SelectEquipmentDialog';
import { SelectAddOnsDialog } from './SelectAddOnsDialog';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { BrowseConsentFormsDialog } from './BrowseConsentFormsDialog';
import { cn } from '@/lib/utils';
import { Switch } from '../ui/switch';
import { ScrollArea } from '../ui/scroll-area';

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
    
    depositType: z.enum(['none', 'deposit', 'full']),
    depositSubType: z.string().optional(),
    depositAmount: z.coerce.number().optional(),
    
    price: z.coerce.number().optional(),
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
    {/* Basics */}
    <Card>
        <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
        <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className='space-y-1'>
                    <Label htmlFor="is-addon">Is this an Add-on Service?</Label>
                    <p className='text-sm text-muted-foreground'>Add-ons can be appended to primary services.</p>
                </div>
                <Controller name="isAddon" control={control} render={({ field }) => ( <Switch id="is-addon" checked={field.value} onCheckedChange={field.onChange} /> )}/>
            </div>
            <div className="space-y-2">
                <Label htmlFor="service-name">Name</Label>
                <Input id="service-name" placeholder="e.g., Signature Haircut" {...register('name')} />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                {isAddingCategory ? ( <div className="flex gap-2"> <Input placeholder="Enter new category name..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddNewCategory()} /> <Button onClick={handleAddNewCategory} type="button"><Check className="h-4 w-4" /></Button> </div> ) : ( <div className="flex gap-2"> <Controller name="category" control={control} render={({ field }) => ( <Select onValueChange={field.onChange} value={field.value}> <SelectTrigger> <SelectValue placeholder="Select a category" /> </SelectTrigger> <SelectContent> {categories.map(cat => ( <SelectItem key={cat} value={cat}>{cat}</SelectItem> ))} </SelectContent> </Select> )}/> <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button"> <PlusCircle className="h-4 w-4" /> </Button> </div> )}
                {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>}
            </div>
            <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2"><Label htmlFor="duration">Duration (min)</Label><Input id="duration" type="number" placeholder="e.g., 60" {...register('duration', { valueAsNumber: true })}/>{errors.duration && <p className="text-sm text-destructive">{errors.duration.message}</p>}</div>
                <div className="space-y-2"><Label htmlFor="pad-before">Pad Before (min)</Label><Input id="pad-before" type="number" placeholder="e.g., 0" {...register('padBefore', { valueAsNumber: true })} /></div>
                <div className="space-y-2"><Label htmlFor="pad-after">Pad After (min)</Label><Input id="pad-after" type="number" placeholder="e.g., 15" {...register('padAfter', { valueAsNumber: true })} /></div>
            </div>
            <div className="space-y-2"><Label htmlFor="description">Description</Label><Textarea id="description" placeholder="Describe the service for your booking page..." {...register('description')} /></div>
            <div className="space-y-2"><Label>Service Image</Label><Controller name="imageUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} /> )}/></div>
        </CardContent>
    </Card>
  </div>
    );
};

const Step2_CostingPricing = () => {
    const { control, watch, register } = useFormContext<ProductFormData>();
    const productType = watch('type');
    const costingMethod = watch('costingMethod');
    const [totalPurchaseCost, numUnits, shippingCost, taxCost, discounts, msrp] = watch([
        'totalPurchaseCost',
        'numUnits',
        'shippingCost',
        'taxCost',
        'discounts',
        'msrp'
    ]);

    const landedCostPerItem = useMemo(() => {
        const safeParse = (val: any) => parseFloat(val) || 0;

        const total = safeParse(totalPurchaseCost) + safeParse(shippingCost) + safeParse(taxCost) - safeParse(discounts);
        const units = safeParse(numUnits);

        if (units === 0) return 0;
        return total / units;
    }, [totalPurchaseCost, numUnits, shippingCost, taxCost, discounts]);

    const profitMargin = useMemo(() => {
        const price = msrp || 0;
        if (price === 0 || landedCostPerItem === 0) return 0;
        const profit = price - landedCostPerItem;
        return (profit / price) * 100;
    }, [msrp, landedCostPerItem]);
    
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
             <Card>
                <CardHeader><CardTitle>Landed Cost Calculator</CardTitle><CardDescription>Calculate the true cost per item.</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label htmlFor="total-cost">Total Purchase Cost</Label><Input id="total-cost" type="number" placeholder="From invoice" {...register('totalPurchaseCost')} /></div>
                        <div className="space-y-2"><Label htmlFor="num-units">Number of Units</Label><Input id="num-units" type="number" placeholder="In shipment" {...register('numUnits')} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label htmlFor="shipping">Shipping</Label><Input id="shipping" type="number" placeholder="0.00" {...register('shippingCost')} /></div>
                        <div className="space-y-2"><Label htmlFor="taxes">Taxes</Label><Input id="taxes" type="number" placeholder="0.00" {...register('taxCost')} /></div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="discounts">Discounts</Label>
                        <Input id="discounts" type="number" placeholder="0.00" {...register('discounts')} />
                    </div>
                    <div className="p-3 bg-muted rounded-md flex items-center justify-between">
                        <span className="font-medium">Landed Cost Per Item:</span>
                        <span className="text-lg font-bold text-primary">${landedCostPerItem.toFixed(2)}</span>
                    </div>
                </CardContent>
            </Card>
            {(productType === 'professional') && (
                <Card>
                    <CardHeader><CardTitle>Professional Costing</CardTitle><CardDescription>How much does it cost to use this once?</CardDescription></CardHeader>
                    <CardContent className="space-y-4">
                        <Controller name="costingMethod" control={control} render={({ field }) => (<div className="space-y-2"><Label>Costing Method</Label><RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2"><div><RadioGroupItem value="size" id="by-size" className="peer sr-only" /><Label htmlFor="by-size" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Size</Label></div><div><RadioGroupItem value="uses" id="by-uses" className="peer sr-only" /><Label htmlFor="by-uses" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Uses</Label></div></RadioGroup></div>)}/>
                        {costingMethod === 'size' && (<div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="container-size">Container Size</Label><Input id="container-size" type="number" placeholder="e.g., 1000" {...register('containerSize')} /></div><div className="space-y-2"><Label htmlFor="unit">Unit</Label><Controller name="containerUnit" control={control} render={({ field }) => (<Select onValueChange={field.onChange} value={field.value}><SelectTrigger id="unit"><SelectValue placeholder="Unit" /></SelectTrigger><SelectContent><SelectItem value="ml">ml</SelectItem><SelectItem value="oz">oz</SelectItem><SelectItem value="g">g</SelectItem></SelectContent></Select>)}/></div></div>)}
                        {costingMethod === 'uses' && (<div className="space-y-2"><Label htmlFor="estimated-uses">Uses Per Container</Label><Input id="estimated-uses" type="number" placeholder="e.g., 50" {...register('usesPerContainer')} /></div>)}
                         <div className="space-y-2"><Label htmlFor="restocking-markup">Restocking Markup (%)</Label><Input id="restocking-markup" type="number" placeholder="e.g., 5" {...register('restockingMarkup')} /></div>
                    </CardContent>
                </Card>
            )}
            {(productType === 'retail') && (
                <Card>
                    <CardHeader><CardTitle>Retail Pricing</CardTitle><CardDescription>How much will clients pay?</CardDescription></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="msrp">MSRP</Label><Input id="msrp" type="number" placeholder="0.00" {...register('msrp')} /></div><div className="space-y-2"><Label htmlFor="markdown-price">Markdown Price</Label><Input id="markdown-price" type="number" placeholder="Optional" {...register('markdownPrice')} /></div></div>
                        <div className="p-3 bg-muted rounded-md"><p className="font-medium text-center">Profit Margin: <span className="text-lg font-bold text-primary">{profitMargin.toFixed(1)}%</span></p></div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

const Step3_InventorySupplier = ({ onAddLocationClick, locations }: { onAddLocationClick: () => void; locations: Location[] }) => {
     const { control, register, formState: { errors } } = useFormContext<ProductFormData>();
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Supplier Info</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="vendor">Vendor</Label><Input id="vendor" placeholder="e.g., SalonCentric" {...register('supplier')} /></div>
                    <div className="space-y-2"><Label htmlFor="sku">SKU / Barcode</Label><Input id="sku" placeholder="Product identifier" {...register('sku')} /></div>
                    <div className="space-y-2"><Label htmlFor="purchase-link">Purchase Link</Label><Input id="purchase-link" type="url" placeholder="https://..." {...register('purchaseLink')} /></div>
                </CardContent>
            </Card>
            <Card>
                 <CardHeader><CardTitle>Stock Management</CardTitle></CardHeader>
                 <CardContent className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="reorder-point">Reorder Point</Label><Input id="reorder-point" type="number" placeholder="e.g., 5" {...register('reorderPoint')} /></div>
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label htmlFor="initial-stock">Initial Stock</Label><Input id="initial-stock" type="number" placeholder="Quantity" {...register('initialStock')} />{errors.initialStock && <p className="text-sm text-destructive">{errors.initialStock.message}</p>}</div>
                        <div className="space-y-2"><Label>Expiration</Label><p className="text-xs text-muted-foreground">Batch tracking coming soon</p></div>
                    </div>
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
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select location" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {locations.map(loc => (
                                            <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                                        ))}
                                    </SelectContent>
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


export const AddServiceDialog = ({ 
    open, 
    onOpenChange,
    initialType,
    categories,
    onNewCategory,
    onServiceAdded
}: { 
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType: 'professional' | 'retail';
  categories: string[];
  onNewCategory: (category: string) => void;
  onServiceAdded: (service: Service) => void;
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
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
  const { duration, padBefore, padAfter, products, equipment, price } = values;
  const [tmhr, setTmhr] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
        setTmhr(parseFloat(localStorage.getItem('tmhr') || '50'));
    }
  }, []);

  useEffect(() => {
    if (open) {
      methods.reset({ isAddon: false, isPrivate: false, depositType: 'none', price: 0, products: [], equipment: [], addOns: [] });
      setStep(1);
    }
  }, [open, methods]);

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
  
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
        setTimeout(() => {
            setStep(1);
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
      };
      
      onServiceAdded(newService);

      toast({
          title: `New ${data.isAddon ? 'Add-on' : 'Service'} Created`,
          description: `${data.name} has been added to your library.`
      })
      handleOpenChange(false);
  };
  
  const handleNext = async () => {
    const fieldsToValidate: (keyof ServiceFormData)[] = [];
    if (step === 1) {
      fieldsToValidate.push('name', 'category', 'duration');
    }
    
    const isValid = fieldsToValidate.length > 0 ? await methods.trigger(fieldsToValidate) : true;
    
    if (isValid && step < totalSteps) {
      setStep(step + 1);
    }
  };

  const handleBack = () => step > 1 && setStep(step - 1);
  
  const getStepContent = () => {
      switch(step) {
          case 1: return <Step1_BasicDetails categories={categories} onNewCategory={onNewCategory} />;
          case 2: return <Step2_CostingPricing />;
          case 3: return <Step3_InventorySupplier onAddLocationClick={() => { /* TODO */ }} locations={[]} />;
          default: return null;
      }
  }
  
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
        <div className="px-4 md:px-6 py-4">
          <Progress value={(step / totalSteps) * 100} />
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 pb-6">
              <AddServiceForm 
                categories={categories}
                onNewCategory={onNewCategory}
                onScanClick={() => setIsScannerOpen(true)}
                onAddLocationClick={() => { /* TODO */ }}
                locations={[]}
                breakEvenCost={breakEvenCost}
              />
          </div>
        </ScrollArea>
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
