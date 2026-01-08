

'use client';

import React, { useState, useEffect } from 'react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusCircle, Info, Trash2, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useForm, FormProvider, useFormContext, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { type InventoryItem } from '@/lib/data';
import { type Location, type LocationType, AddLocationDialog } from './AddLocationDialog';

export type ProductType = 'professional' | 'retail' | 'both';

const productSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Product name is required'),
  type: z.enum(['professional', 'retail', 'equipment', 'overhead']),
  category: z.string().min(1, 'Category is required'),
  // Add other fields as needed for validation
});

type ProductFormData = z.infer<typeof productSchema> & {
    [key: string]: any;
};

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
    const productType = watch('type');

    const handleAddNewCategory = () => {
        if (newCategoryName.trim()) {
            const newCategory = newCategoryName.trim();
            onNewCategory(newCategory);
            setValue('category', newCategory, { shouldValidate: true });
            setNewCategoryName('');
            setIsAddingCategory(false);
        }
    };
    
    return (
  <div className="grid gap-4 py-4">
    <div className="space-y-2">
      <Label htmlFor="product-name">Product Name</Label>
      <Input id="product-name" {...register('name')} />
      {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
    </div>
    <div className="space-y-2">
      <Label>Product Type</Label>
      <Controller
        name="type"
        control={control}
        render={({ field }) => (
            <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="grid grid-cols-3 gap-2"
            >
                <RadioGroupItem value="professional" id="edit-professional" className="peer sr-only" />
                <Label htmlFor="edit-professional" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Professional</Label>
                <RadioGroupItem value="retail" id="edit-retail" className="peer sr-only" />
                <Label htmlFor="edit-retail" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Retail</Label>
                <RadioGroupItem value="both" id="edit-both" className="peer sr-only" disabled />
                <Label htmlFor="edit-both" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Both</Label>
            </RadioGroup>
        )}
      />
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
        <Label>Image</Label>
        <Button variant="outline" className="w-full">Upload Image</Button>
    </div>
    <div className="space-y-2">
      <Label htmlFor="internal-notes">Internal Notes</Label>
      <Textarea id="internal-notes" placeholder="Private notes or usage instructions..." />
    </div>
  </div>
    );
};

const Step2_CostingPricing = () => {
    const { watch } = useFormContext<ProductFormData>();
    const productType = watch('type');
    const [costingMethod, setCostingMethod] = useState('by-size');

    return (
    <div className="grid gap-6 py-4">
        { (productType === 'professional') && (
            <Card>
                <CardHeader>
                    <CardTitle>Professional Costing</CardTitle>
                    <CardDescription>How much does it cost to use this once in a service?</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                     <div className="space-y-2">
                        <Label>Costing Method</Label>
                        <RadioGroup defaultValue="by-size" onValueChange={setCostingMethod} className="grid grid-cols-2 gap-2">
                            <div>
                                <RadioGroupItem value="by-size" id="edit-by-size" className="peer sr-only" />
                                <Label htmlFor="edit-by-size" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Size</Label>
                            </div>
                            <div>
                                <RadioGroupItem value="by-uses" id="edit-by-uses" className="peer sr-only" />
                                <Label htmlFor="edit-by-uses" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Uses</Label>
                            </div>
                        </RadioGroup>
                    </div>

                    {costingMethod === 'by-size' ? (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="container-size">Container Size</Label>
                                <Input id="container-size" type="number" placeholder="e.g., 1000" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="unit">Unit</Label>
                                 <Select>
                                    <SelectTrigger id="unit">
                                        <SelectValue placeholder="Select unit" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ml">ml</SelectItem>
                                        <SelectItem value="oz">oz</SelectItem>
                                        <SelectItem value="g">g</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    ) : (
                         <div className="space-y-2">
                            <Label htmlFor="estimated-uses">Estimated Uses Per Container</Label>
                            <Input id="estimated-uses" type="number" placeholder="e.g., 50" />
                        </div>
                    )}
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center space-x-2">
                            <Switch id="cost-experiment" />
                            <Label htmlFor="cost-experiment">Cost-Per-Use Experiment</Label>
                        </div>
                        <Info className="h-4 w-4 text-muted-foreground" />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="restocking-markup">Restocking Markup</Label>
                        <div className="relative">
                            <Input id="restocking-markup" type="number" placeholder="e.g., 5" className="pl-8"/>
                             <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        )}

        { (productType === 'retail') && (
            <Card>
                <CardHeader>
                    <CardTitle>Retail Pricing</CardTitle>
                    <CardDescription>How much will clients pay for this product?</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="msrp">MSRP</Label>
                        <Input id="msrp" type="number" placeholder="0.00" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="markdown-price">Markdown Price</Label>
                        <Input id="markdown-price" type="number" placeholder="Optional sale price" />
                    </div>
                </CardContent>
            </Card>
        )}
        
        <Card>
            <CardHeader>
                <CardTitle>Landed Cost</CardTitle>
                <CardDescription>Calculate the true cost per item after fees.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="total-cost">Total Cost of Goods</Label>
                        <Input id="total-cost" type="number" placeholder="From invoice" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="num-units">Number of Units</Label>
                        <Input id="num-units" type="number" placeholder="In shipment" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="shipping">Shipping</Label>
                        <Input id="shipping" type="number" placeholder="0.00" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="taxes">Taxes</Label>
                        <Input id="taxes" type="number" placeholder="0.00" />
                    </div>
                </div>
                <div className="p-3 bg-muted rounded-md flex items-center justify-between">
                    <span className="font-medium">Landed Cost Per Item:</span>
                    <span className="text-lg font-bold text-primary">$0.00</span>
                </div>
            </CardContent>
        </Card>
    </div>
    );
};


const Step3_InventorySupplier = ({ locations }: { locations: Location[] }) => {
    const [secondaryLocations, setSecondaryLocations] = useState<string[]>([]);
    const addSecondaryLocation = () => setSecondaryLocations(prev => [...prev, `loc-${Date.now()}`]);
    const removeSecondaryLocation = (id: string) => setSecondaryLocations(prev => prev.filter(locId => locId !== id));

    return (
    <div className="grid gap-6 py-4">
        <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
                <Label htmlFor="vendor">Vendor</Label>
                 <Select>
                    <SelectTrigger>
                        <SelectValue placeholder="Select vendor" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="vendor-a">Vendor A</SelectItem>
                        <SelectItem value="vendor-b">Vendor B</SelectItem>
                    </SelectContent>
                </Select>
            </div>
             <div className="space-y-2">
                <Label htmlFor="sku">SKU</Label>
                <Input id="sku" placeholder="Product SKU" />
            </div>
        </div>
         <div className="space-y-2">
            <Label htmlFor="low-stock-point">Low Stock Point</Label>
            <Input id="low-stock-point" type="number" placeholder="e.g., 5" />
        </div>

        <Card>
            <CardHeader>
                <CardTitle>Storage Locations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>Primary Location</Label>
                    <div className="flex gap-2">
                        <Select>
                            <SelectTrigger>
                                <SelectValue placeholder="Select primary location" />
                            </SelectTrigger>
                            <SelectContent>
                                {locations.map(loc => (
                                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                         <Button variant="outline" size="icon" type="button"><PlusCircle className="h-4 w-4" /></Button>
                    </div>
                </div>
                 <div className="space-y-2">
                    {secondaryLocations.map((locId) => (
                        <div key={locId} className="space-y-2">
                             <Label className="text-muted-foreground">Secondary Location</Label>
                             <div className="flex gap-2">
                                <Select>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select secondary location" />
                                    </SelectTrigger>
                                    <SelectContent>
                                         {locations.map(loc => (
                                            <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button variant="ghost" size="icon" className="text-destructive" type="button" onClick={() => removeSecondaryLocation(locId)}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                        </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addSecondaryLocation} type="button"><PlusCircle className="mr-2 h-4 w-4" />Add Secondary Location</Button>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Current Stock</CardTitle>
                <CardDescription>View and manage current batches.</CardDescription>
            </CardHeader>
            <CardContent>
                 <p className="text-sm text-muted-foreground text-center p-4">Batch management coming soon.</p>
            </CardContent>
        </Card>
    </div>
    )
};


export const EditProductDialog = ({ 
    open, 
    onOpenChange, 
    product,
    onProductUpdated,
    locations,
    locationTypes,
    categories,
    onNewCategory,
    onAddNewLocationType,
}: { 
    open: boolean, 
    onOpenChange: (open: boolean) => void, 
    product: InventoryItem,
    onProductUpdated: (product: InventoryItem) => void,
    locations: Location[],
    locationTypes: LocationType[],
    categories: string[],
    onNewCategory: (category: string) => void,
    onAddNewLocationType: (name: string) => LocationType,
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  
  const methods = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
  });

  useEffect(() => {
    if (product) {
      methods.reset({
        id: product.id,
        name: product.name,
        type: product.type,
        category: product.category,
        costPerUnit: product.costPerUnit,
        supplier: product.supplier,
      });
    }
  }, [product, methods.reset]);
  
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
        setTimeout(() => {
            setStep(1);
        }, 300);
    }
  }

  const onSubmit = (data: ProductFormData) => {
      onProductUpdated(data as InventoryItem);
      handleOpenChange(false);
  }

  const handleNext = async () => {
    const fieldsToValidate: (keyof ProductFormData)[] = [];
    if (step === 1) {
        fieldsToValidate.push('name', 'type', 'category');
    }
    
    const isValid = fieldsToValidate.length > 0 ? await methods.trigger(fieldsToValidate) : true;
    
    if (isValid && step < totalSteps) {
      setStep(step + 1);
    }
  };

  const handleBack = () => step > 1 && setStep(step - 1);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)}>
            <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>Update the details for &quot;{product.name}&quot;.</DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-4">
                <Progress value={(step / totalSteps) * 100} />
                <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-4">
                    {step === 1 && <Step1_BasicDetails categories={categories} onNewCategory={onNewCategory} />}
                    {step === 2 && <Step2_CostingPricing />}
                    {step === 3 && <Step3_InventorySupplier locations={locations} />}
                </div>
            </div>

            <DialogFooter>
            <div className='flex justify-between w-full'>
                <div>
                    {step > 1 && <Button variant="outline" onClick={handleBack} type="button">Back</Button>}
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => handleOpenChange(false)} type="button">Cancel</Button>
                    {step < totalSteps ? (
                        <Button onClick={handleNext} type="button">Next</Button>
                    ) : (
                        <Button type="submit">Save Changes</Button>
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
