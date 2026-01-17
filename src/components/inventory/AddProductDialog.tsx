
'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusCircle, Package, Hammer, Trash2, QrCode, Check, AlertTriangle, Info, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { inventory, services as allServices, type Service, type InventoryItem, type Location } from '@/lib/data';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { SelectEquipmentDialog } from '../services/SelectEquipmentDialog';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useForm, FormProvider, useFormContext, Controller, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '../ui/sheet';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';

const productSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  type: z.enum(['professional', 'retail']),
  category: z.string().min(1, 'Category is required'),
  imageUrl: z.string().optional(),
  internalNotes: z.string().optional(),
  
  // Costing
  totalPurchaseCost: z.number().optional(),
  numUnits: z.number().optional(),
  shippingCost: z.number().optional(),
  taxCost: z.number().optional(),
  discounts: z.number().optional(),
  
  costingMethod: z.enum(['size', 'uses']).optional(),
  containerSize: z.number().optional(),
  containerUnit: z.string().optional(),
  usesPerContainer: z.number().optional(),
  restockingMarkup: z.number().optional(),

  // Pricing
  msrp: z.number().optional(),
  markdownPrice: z.number().optional(),

  // Inventory
  supplier: z.string().optional(),
  sku: z.string().optional(),
  purchaseLink: z.string().url().optional().or(z.literal('')),
  reorderPoint: z.number().optional(),
  initialStock: z.number().optional(),
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
    <div className="space-y-2">
      <Label htmlFor="product-name">Product Name</Label>
      <Input id="product-name" placeholder="e.g., Hydrating Shampoo" {...register('name')} />
       {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
    </div>
    <Controller
      name="type"
      control={control}
      render={({ field }) => (
        <input type="hidden" {...field} />
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
          <Controller
            name="category"
            control={control}
            render={({ field }) => (
               <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
         
          <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button">
            <PlusCircle className="h-4 w-4" />
          </Button>
        </div>
      )}
       {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>}
    </div>
    <div className="space-y-2">
      <Label>Product Image</Label>
       <Controller
        name="imageUrl"
        control={control}
        render={({ field }) => (
          <ImageUpload onImageUploaded={field.onChange} />
        )}
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="internal-notes">Internal Notes</Label>
      <Textarea id="internal-notes" placeholder="Private usage instructions, formulation tips..." {...register('internalNotes')} />
    </div>
  </div>
    );
};

const Step2_CostingAndPricing = () => {
    const { control, watch } = useFormContext<ProductFormData>();
    const productType = watch('type');
    const costingMethod = watch('costingMethod');
    return (
        <div className="grid gap-6 py-4">
             <Card>
                <CardHeader><CardTitle>Landed Cost Calculator</CardTitle><CardDescription>Calculate the true cost per item.</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4"><Controller name="totalPurchaseCost" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="total-cost">Total Purchase Cost</Label><Input id="total-cost" type="number" placeholder="From invoice" {...field} /></div>)}/><Controller name="numUnits" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="num-units">Number of Units</Label><Input id="num-units" type="number" placeholder="In shipment" {...field} /></div>)}/></div>
                    <div className="grid grid-cols-2 gap-4"><Controller name="shippingCost" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="shipping">Shipping</Label><Input id="shipping" type="number" placeholder="0.00" {...field} /></div>)}/><Controller name="taxCost" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="taxes">Taxes</Label><Input id="taxes" type="number" placeholder="0.00" {...field} /></div>)}/></div>
                    <div className="space-y-2"><Label htmlFor="discounts">Discounts</Label><Input id="discounts" type="number" placeholder="0.00" /></div>
                    <div className="p-3 bg-muted rounded-md flex items-center justify-between"><span className="font-medium">Landed Cost Per Item:</span><span className="text-lg font-bold text-primary">$0.00</span></div>
                </CardContent>
            </Card>
            {(productType === 'professional') && (
                <Card>
                    <CardHeader><CardTitle>Professional Costing</CardTitle><CardDescription>How much does it cost to use this once?</CardDescription></CardHeader>
                    <CardContent className="space-y-4">
                        <Controller name="costingMethod" control={control} render={({ field }) => (<div className="space-y-2"><Label>Costing Method</Label><RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2"><div><RadioGroupItem value="size" id="by-size" className="peer sr-only" /><Label htmlFor="by-size" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Size</Label></div><div><RadioGroupItem value="uses" id="by-uses" className="peer sr-only" /><Label htmlFor="by-uses" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Uses</Label></div></RadioGroup></div>)}/>
                        {costingMethod === 'size' && (<div className="grid grid-cols-2 gap-4"><Controller name="containerSize" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="container-size">Container Size</Label><Input id="container-size" type="number" placeholder="e.g., 1000" {...field} /></div>)}/><Controller name="containerUnit" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="unit">Unit</Label><Select onValueChange={field.onChange} value={field.value}><SelectTrigger id="unit"><SelectValue placeholder="Unit" /></SelectTrigger><SelectContent><SelectItem value="ml">ml</SelectItem><SelectItem value="oz">oz</SelectItem><SelectItem value="g">g</SelectItem></SelectContent></Select></div>)}/></div>)}
                        {costingMethod === 'uses' && (<Controller name="usesPerContainer" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="estimated-uses">Uses Per Container</Label><Input id="estimated-uses" type="number" placeholder="e.g., 50" {...field} /></div>)}/>)}
                         <Controller name="restockingMarkup" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="restocking-markup">Restocking Markup (%)</Label><Input id="restocking-markup" type="number" placeholder="e.g., 5" {...field} /></div>)}/>
                    </CardContent>
                </Card>
            )}
            {(productType === 'retail') && (
                <Card>
                    <CardHeader><CardTitle>Retail Pricing</CardTitle><CardDescription>How much will clients pay?</CardDescription></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4"><Controller name="msrp" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="msrp">MSRP</Label><Input id="msrp" type="number" placeholder="0.00" {...field} /></div>)}/><Controller name="markdownPrice" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="markdown-price">Markdown Price</Label><Input id="markdown-price" type="number" placeholder="Optional" {...field} /></div>)}/></div>
                        <div className="p-3 bg-muted rounded-md"><p className="font-medium text-center">Profit Margin: <span className="text-lg font-bold text-primary">0%</span></p></div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

const Step3_InventorySupplier = ({ onAddLocationClick, locations }: { onAddLocationClick: () => void, locations: Location[] }) => {
     const { control, register } = useFormContext<ProductFormData>();
    return (
        <div className="grid gap-6 py-4">
            <Card>
                <CardHeader><CardTitle>Supplier Info</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <Controller name="supplier" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="vendor">Vendor</Label><Input id="vendor" placeholder="e.g., SalonCentric" {...field} /></div>)} />
                    <Controller name="sku" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="sku">SKU / Barcode</Label><Input id="sku" placeholder="Product identifier" {...field} /></div>)} />
                    <Controller name="purchaseLink" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="purchase-link">Purchase Link</Label><Input id="purchase-link" type="url" placeholder="https://..." {...field} /></div>)} />
                </CardContent>
            </Card>
            <Card>
                 <CardHeader><CardTitle>Stock Management</CardTitle></CardHeader>
                 <CardContent className="space-y-4">
                    <Controller name="reorderPoint" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="reorder-point">Reorder Point</Label><Input id="reorder-point" type="number" placeholder="e.g., 5" {...field} /></div>)} />
                     <div className="grid grid-cols-2 gap-4">
                        <Controller name="initialStock" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="initial-stock">Initial Stock</Label><Input id="initial-stock" type="number" placeholder="Quantity" {...field} /></div>)} />
                        <Controller name="expirationDate" control={control} render={({ field }) => (<div className="space-y-2"><Label>Expiration</Label><p className="text-xs text-muted-foreground">Batch tracking coming soon</p></div>)} />
                    </div>
                </CardContent>
            </Card>
             <Card>
                <CardHeader><CardTitle>Storage Locations</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <Controller name="primaryLocationId" control={control} render={({ field }) => (<div className="space-y-2"><Label>Primary Location</Label><div className="flex gap-2"><Select onValueChange={field.onChange} value={field.value}><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{locations.map(loc => (<SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>))}</SelectContent></Select><Button variant="outline" size="icon" onClick={onAddLocationClick} type="button"><PlusCircle className="h-4 w-4" /></Button></div></div>)} />
                </CardContent>
            </Card>
        </div>
    )
};

export const AddProductDialog = ({
  open,
  onOpenChange,
  initialType,
  categories,
  onNewCategory,
  onProductAdded,
  locations,
  onAddLocationClick,
}: { 
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType: 'professional' | 'retail';
  categories: string[];
  onNewCategory: (category: string) => void;
  onProductAdded: (product: InventoryItem) => void;
  locations: Location[],
  onAddLocationClick: () => void;
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
      methods.reset({
        type: initialType,
      });
      setStep(1);
    }
  }, [open, initialType, methods]);

  const handleSave = (data: ProductFormData) => {
    const costPerUnit = (data.totalPurchaseCost || 0) / (data.numUnits || 1);
    const newProduct: InventoryItem = {
        id: `prod-${Date.now()}`,
        name: data.name,
        type: data.type,
        category: data.category,
        totalStock: data.initialStock || 0,
        supplier: data.supplier || '',
        supplierUrl: data.purchaseLink,
        costPerUnit: costPerUnit,
        reorderPoint: data.reorderPoint,
        imageUrl: data.imageUrl,
        primaryLocationId: data.primaryLocationId,
        costingMethod: data.costingMethod,
        size: data.containerSize,
        unit: data.containerUnit as any,
        estimatedUses: data.usesPerContainer,
        batches: [{
            id: `batch-${Date.now()}`,
            stock: data.initialStock || 0,
            costPerUnit: costPerUnit,
            receivedDate: new Date().toISOString(),
            expirationDate: data.expirationDate?.toISOString(),
        }]
    };
    onProductAdded(newProduct);
    onOpenChange(false);
  };

  const handleNext = async () => {
    let isValid = false;
    if (step === 1) {
      isValid = await methods.trigger(['name', 'category']);
    } else {
      isValid = true;
    }
    
    if (isValid && step < totalSteps) {
      setStep(step + 1);
    }
  };

  const handleBack = () => step > 1 && setStep(step - 1);

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
          case 2: return <Step2_CostingAndPricing />;
          case 3: return <Step3_InventorySupplier onAddLocationClick={onAddLocationClick} locations={locations} />;
          default: return null;
      }
  }

  const formId = `add-product-form-${initialType}`;

  if (isMobile) {
    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
            <SheetContent side="bottom" className="h-[95vh] flex flex-col p-0">
                <FormProvider {...methods}>
                    <form id={formId} onSubmit={methods.handleSubmit(handleSave)} className="flex flex-col flex-1 min-h-0">
                        <SheetHeader className="p-4 border-b text-left">
                            <SheetTitle>Add New Product</SheetTitle>
                            <SheetDescription>
                                Use this wizard to add a new professional or retail product.
                            </SheetDescription>
                        </SheetHeader>

                        <div className="flex-1 min-h-0">
                          <ScrollArea className="h-full px-4">
                              <div className="py-4 space-y-4">
                                  <Progress value={(step / totalSteps) * 100} />
                                  {getStepContent()}
                              </div>
                          </ScrollArea>
                        </div>
                        
                        <SheetFooter className="p-4 border-t">
                             <div className='flex justify-between w-full'>
                                <div>{step > 1 && <Button variant="outline" onClick={handleBack} type="button">Back</Button>}</div>
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={() => onOpenChange(false)} type="button">Cancel</Button>
                                    {step < totalSteps ? (
                                        <Button onClick={handleNext} type="button">Next</Button>
                                    ) : (
                                        <Button type="submit">Save Product</Button>
                                    )}
                                </div>
                            </div>
                        </SheetFooter>
                    </form>
                </FormProvider>
            </SheetContent>
        </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl flex flex-col max-h-[90vh]">
        <FormProvider {...methods}>
          <form id={formId} onSubmit={methods.handleSubmit(handleSave)} className="flex flex-col flex-1 min-h-0">
            <DialogHeader>
              <DialogTitle>Add New Product</DialogTitle>
              <DialogDescription>
                Use this wizard to add a new professional or retail product to your inventory.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 min-h-0 py-4">
                <ScrollArea className="h-full pr-6 -mr-6">
                    <div className="space-y-4 pl-6">
                        <Progress value={(step / totalSteps) * 100} />
                        {getStepContent()}
                    </div>
                </ScrollArea>
            </div>

            <DialogFooter className="pt-4 border-t mt-4 pr-0">
              <div className='flex justify-between w-full'>
                <div>
                    {step > 1 && <Button variant="outline" onClick={handleBack} type="button">Back</Button>}
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)} type="button">Cancel</Button>
                    {step < totalSteps ? (
                        <Button onClick={handleNext} type="button">Next</Button>
                    ) : (
                        <Button type="submit">Save Product</Button>
                    )}
                </div>
              </div>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
};

    