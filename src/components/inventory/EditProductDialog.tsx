
'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useForm, FormProvider, useFormContext, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { Check, PlusCircle } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { inventory, services as allServices, type Service } from '@/lib/data';

const productSchema = z.object({
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

  supplier: z.string().optional(),
  sku: z.string().optional(),
  purchaseLink: z.string().url().optional().or(z.literal('')),
  reorderPoint: z.coerce.number().optional(),
  initialStock: z.coerce.number().min(1, 'Initial stock is required'),
  expirationDate: z.date().optional(),
  primaryLocationId: z.string().optional(),
});

type ProductFormData = z.infer<typeof productSchema>;

const Step1_BasicDetails = ({ categories, onNewCategory }: { categories: string[]; onNewCategory: (category: string) => void; }) => {
    const { register, control, setValue, formState: { errors } } = useFormContext<ProductFormData>();
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');

    const handleAddNewCategory = () => {
        if (newCategoryName.trim()) {
            onNewCategory(newCategoryName.trim());
            setValue('category', newCategoryName.trim(), { shouldValidate: true });
            setIsAddingCategory(false);
            setNewCategoryName('');
        }
    };
    
    return (
        <div className="grid gap-6 py-4">
            <div className="space-y-2">
            <Label htmlFor="product-name">Product Name</Label>
            <Input id="product-name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            {isAddingCategory ? (
                <div className="flex gap-2">
                <Input placeholder="New category..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
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
        </div>
    );
};

const Step2_CostingPricing = () => {
    const { control, watch, register } = useFormContext<ProductFormData>();
    const productType = watch('type');
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Costing card for all types */}
      </div>
    );
};

const Step3_InventorySupplier = ({ onAddLocationClick, locations }: { onAddLocationClick: () => void; locations: Location[] }) => {
    const { control, register } = useFormContext<ProductFormData>();
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Supplier Info</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="vendor">Vendor</Label><Input id="vendor" {...register('supplier')} /></div>
                    <div className="space-y-2"><Label htmlFor="sku">SKU / Barcode</Label><Input id="sku" {...register('sku')} /></div>
                    <div className="space-y-2"><Label htmlFor="purchase-link">Purchase Link</Label><Input id="purchase-link" type="url" {...register('purchaseLink')} /></div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader><CardTitle>Stock Management</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="reorder-point">Reorder Point</Label><Input id="reorder-point" type="number" {...register('reorderPoint')} /></div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader><CardTitle>Storage Locations</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Primary Location</Label>
                        <Controller name="primaryLocationId" control={control} render={({ field }) => (
                            <div className="flex gap-2">
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                                    <SelectContent>{locations.map(loc => (<SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>))}</SelectContent>
                                </Select>
                                <Button variant="outline" size="icon" onClick={onAddLocationClick} type="button"><PlusCircle className="h-4 w-4" /></Button>
                            </div>
                        )} />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
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
    resolver: zodResolver(productSchema),
  });

  useEffect(() => {
    if (product && open) {
        methods.reset({
            id: product.id,
            name: product.name,
            type: product.type,
            category: product.category,
            imageUrl: product.imageUrl || '',
            supplier: product.supplier || '',
            supplierUrl: product.supplierUrl || '',
            costPerUnit: product.costPerUnit,
            reorderPoint: product.reorderPoint,
            primaryLocationId: product.primaryLocationId,
            costingMethod: product.costingMethod,
            containerSize: product.size,
            containerUnit: product.unit,
            usesPerContainer: product.estimatedUses,
            initialStock: product.totalStock,
      });
      setStep(1); // Reset to first step when dialog opens with new product
    }
  }, [product, open, methods]);

  const onSubmit = (data: ProductFormData) => {
    onProductUpdated({ ...product, ...data });
    onOpenChange(false);
  };

  const handleNext = async () => {
    const fieldsToValidate: (keyof ProductFormData)[] = [];
    if (step === 1) {
      fieldsToValidate.push('name', 'category');
    }
    
    const isValid = fieldsToValidate.length > 0 ? await methods.trigger(fieldsToValidate) : true;
    
    if (isValid && step < totalSteps) {
      setStep(step + 1);
    }
  };

  const handleBack = () => step > 1 && setStep(step - 1);

  const getStepContent = () => {
    switch (step) {
      case 1: return <Step1_BasicDetails categories={categories} onNewCategory={onNewCategory} />;
      case 2: return <Step2_CostingPricing />;
      case 3: return <Step3_InventorySupplier onAddLocationClick={onAddLocationClick} locations={locations} />;
      default: return null;
    }
  };
  
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
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[90dvh] flex flex-col p-0">
          {formBody}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col p-0">
        {formBody}
      </DialogContent>
    </Dialog>
  );
};
