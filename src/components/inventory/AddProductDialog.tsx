
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
import { useForm, FormProvider, useFormContext, Controller, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, PlusCircle, QrCode, AlertTriangle, DollarSign, Package, Hammer, Trash2, ShoppingCart } from 'lucide-react';
import { type Service } from '@/lib/data';
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


const productSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  type: z.enum(['professional', 'retail']),
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

  supplier: z.string().optional(),
  sku: z.string().optional(),
  purchaseLink: z.string().optional(),
  reorderPoint: z.coerce.number().optional(),
  initialStock: z.coerce.number().min(1, 'Initial stock is required'),
  expirationDate: z.date().optional(),
  primaryLocationId: z.string().optional(),
});

type ProductFormData = z.infer<typeof productSchema>;

const Step1_BasicDetails = ({ 
    categories, 
    onNewCategory 
}: { 
    categories: string[];
    onNewCategory: (category: string) => void;
}) => {
    const { register, control, setValue, watch, formState: { errors } } = useFormContext<ProductFormData>();
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const productType = watch('type');

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
      <Label htmlFor="product-name">Product Name</Label>
      <Input id="product-name" placeholder="e.g., Hydrating Shampoo" {...register('name')} />
       {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
    </div>
    <Controller
        name="type"
        control={control}
        render={({ field }) => (
            <div className="space-y-2">
                <Label>Product Type</Label>
                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                    <div>
                        <RadioGroupItem value="professional" id="professional" className="peer sr-only" />
                        <Label htmlFor="professional" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                            <Package className="mb-2 h-6 w-6" /> Professional
                        </Label>
                    </div>
                    <div>
                        <RadioGroupItem value="retail" id="retail" className="peer sr-only" />
                        <Label htmlFor="retail" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                            <ShoppingCart className="mb-2 h-6 w-6" /> Retail
                        </Label>
                    </div>
                </RadioGroup>
            </div>
        )}
    />
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

    <div className="space-y-2">
      <Label>Product Image</Label>
       <Controller name="imageUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} /> )}/>
    </div>
     <div className="space-y-2">
        <Label htmlFor="internalNotes">Internal Notes</Label>
        <Textarea id="internalNotes" placeholder="e.g., Back-ordered until June, store on bottom shelf." {...register('internalNotes')} />
    </div>
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

const Step3_InventorySupplier = ({ onAddLocationClick, locations }: { onAddLocationClick: () => void, locations: Location[] }) => {
     const { control, register, formState: { errors } } = useFormContext<ProductFormData>();
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Supplier Info</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="vendor">Vendor</Label><Input id="vendor" placeholder="e.g., SalonCentric" {...register('supplier')} /></div>
                    <div className="space-y-2"><Label htmlFor="sku">SKU / Barcode</Label><Input id="sku" placeholder="Product identifier" {...register('sku')} /></div>
                    <div className="space-y-2"><Label htmlFor="purchase-link">Purchase Link</Label><Input id="purchase-link" type="text" placeholder="www.example.com" {...register('purchaseLink')} /></div>
                </CardContent>
            </Card>
            <Card>
                 <CardHeader><CardTitle>Stock Management</CardTitle></CardHeader>
                 <CardContent className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="reorder-point">Reorder Point</Label><Input id="reorder-point" type="number" placeholder="e.g., 5" {...register('reorderPoint')} /></div>
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label htmlFor="initial-stock">Initial Stock</Label><Input id="initial-stock" type="number" placeholder="Quantity" {...register('initialStock')} />{errors.initialStock && <p className="text-sm text-destructive">{errors.initialStock.message}</p>}</div>
                        <div className="space-y-2">
                            <Label>Expiration Date</Label>
                            <Controller name="expirationDate" control={control} render={({ field }) => (
                                <Popover>
                                    <PopoverTrigger className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {field.value ? format(field.value, 'PPP') : 'No expiry'}
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} />
                                    </PopoverContent>
                                </Popover>
                            )}/>
                        </div>
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


export const AddProductDialog: React.FC<{ 
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType: 'professional' | 'retail';
  categories: string[];
  onNewCategory: (category: string) => void;
  onProductAdded: (product: InventoryItem) => void;
  locations: Location[],
  onAddLocationClick: () => void;
}> = ({
  open,
  onOpenChange,
  initialType,
  categories,
  onNewCategory,
  onProductAdded,
  locations,
  onAddLocationClick,
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  const isMobile = useIsMobile();
  
  const methods = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      type: initialType,
    }
  });

  useEffect(() => {
    if (open) {
      methods.reset({ type: initialType });
      setStep(1);
    }
  }, [open, initialType, methods]);

  const { watch, trigger, handleSubmit } = methods;
  
  const onSubmit = (data: ProductFormData) => {
    const costPerUnit = (data.numUnits || 1) > 0 ? ((data.totalPurchaseCost || 0) + (data.shippingCost || 0) + (data.taxCost || 0) - (data.discounts || 0)) / (data.numUnits || 1) : 0;
    
    let finalPurchaseLink = data.purchaseLink;
    if (finalPurchaseLink && !/^(https?:\/\/)/i.test(finalPurchaseLink)) {
        finalPurchaseLink = `https://${finalPurchaseLink}`;
    }

    const newProduct: InventoryItem = {
        id: `prod-${Date.now()}`,
        name: data.name,
        type: data.type,
        category: data.category,
        totalStock: data.initialStock || 0,
        supplier: data.supplier || '',
        supplierUrl: finalPurchaseLink,
        costPerUnit: costPerUnit,
        reorderPoint: data.reorderPoint,
        imageUrl: data.imageUrl,
        primaryLocationId: data.primaryLocationId,
        costingMethod: data.costingMethod,
        size: data.containerSize,
        unit: data.containerUnit as any,
        estimatedUses: data.usesPerContainer,
        msrp: data.msrp,
        markdownPrice: data.markdownPrice,
        restockingMarkup: data.restockingMarkup,
        internalNotes: data.internalNotes,
        batches: [{
            id: `batch-${Date.now()}`,
            stock: data.initialStock || 0,
            costPerUnit: costPerUnit,
            receivedDate: new Date().toISOString(),
            expirationDate: data.expirationDate?.toISOString(),
        }],
    };
    onProductAdded(newProduct);
    onOpenChange(false);
  };
  
    const handleNext = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        const fieldsToValidate: (keyof ProductFormData)[] = [];
        if (step === 1) {
            fieldsToValidate.push('name', 'category');
        }
        if (step === 3) {
            fieldsToValidate.push('initialStock');
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
    if (!isOpen) {
      setTimeout(() => {
        setStep(1);
        methods.reset();
      }, 300);
    }
  };

  const getStepContent = () => {
      switch(step) {
          case 1: return <Step1_BasicDetails categories={categories} onNewCategory={onNewCategory} />;
          case 2: return <Step2_CostingPricing />;
          case 3: return <Step3_InventorySupplier onAddLocationClick={onAddLocationClick} locations={locations} />;
          default: return null;
      }
  }
  
  const formId = `add-product-form-${initialType}`;
  const title = `Add New ${initialType === 'retail' ? 'Retail Product' : 'Professional Product'}`;
  const description = "Use this wizard to add a new item to your inventory.";

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
                <Button type="submit" form={formId}>Save Product</Button>
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
