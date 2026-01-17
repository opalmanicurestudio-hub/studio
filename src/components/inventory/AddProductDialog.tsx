
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
import { PlusCircle, Info, Trash2, Check, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { AddLocationDialog, type Location, type LocationType } from './AddLocationDialog';

import { useForm, FormProvider, useFormContext, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ImageUpload } from '../shared/ImageUpload';

export type ProductType = 'professional' | 'retail' | 'both';

const productSchema = z.object({
    name: z.string().min(1, 'Product name is required'),
    type: z.enum(['professional', 'retail', 'both']),
    category: z.string().min(1, 'Category is required'),
    description: z.string().optional(),
    imageUrl: z.string().optional(),

    costingMethod: z.enum(['by-size', 'by-uses']).default('by-size'),
    containerSize: z.coerce.number().optional(),
    unit: z.string().optional(),
    estimatedUses: z.coerce.number().optional(),
    useUnit: z.string().optional(),
    customUseUnit: z.string().optional(),
    isExperimentActive: z.boolean().default(false),
    restockingMarkup: z.coerce.number().optional(),

    msrp: z.coerce.number().optional(),
    markdownPrice: z.coerce.number().optional(),

    totalCostOfGoods: z.coerce.number().optional(),
    numberOfUnits: z.coerce.number().optional(),
    shipping: z.coerce.number().optional(),
    taxes: z.coerce.number().optional(),
    
    vendor: z.string().optional(),
    sku: z.string().optional(),
    reorderPoint: z.coerce.number().optional(),
    primaryLocationId: z.string().optional(),
    
    initialQuantity: z.coerce.number().optional(),
    expirationDate: z.string().optional(),
});

type ProductFormData = z.infer<typeof productSchema>;


const Step1_Basics = () => {
    const { register, control, setValue, watch, formState: { errors } } = useFormContext<ServiceFormData>();
    const { categories, setCategories } = useDialogState();
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    
    const handleAddNewCategory = () => {
        if (newCategoryName.trim() && !categories.includes(newCategoryName.trim())) {
            const newCategory = newCategoryName.trim();
            setCategories(prev => [...prev, newCategory]);
            setValue('category', newCategory, { shouldValidate: true });
            setNewCategoryName('');
            setIsAddingCategory(false);
        }
    };
    
    return (
  <div className="grid gap-4 py-4">
    <div className="space-y-2">
      <Label htmlFor="product-name">Product Name</Label>
      <Input id="product-name" placeholder="e.g., Hydrating Shampoo" {...register('name')} />
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
            <div>
              <RadioGroupItem value="professional" id="professional" className="peer sr-only" />
              <Label htmlFor="professional" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Professional</Label>
            </div>
            <div>
              <RadioGroupItem value="retail" id="retail" className="peer sr-only" />
              <Label htmlFor="retail" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Retail</Label>
            </div>
            <div>
              <RadioGroupItem value="both" id="both" className="peer sr-only" />
              <Label htmlFor="both" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Both</Label>
            </div>
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
      <Textarea id="internal-notes" placeholder="Private notes or usage instructions..." {...register('description')} />
    </div>
  </div>
    );
};

const Step2_CostingPricing = ({ productType }: { productType: ProductType }) => {
    const { register, control, watch } = useFormContext<ProductFormData>();
    const costingMethod = watch('costingMethod');
    const [showCustomUseUnit, setShowCustomUseUnit] = useState(false);

    return (
    <div className="grid gap-6 py-4">
        { (productType === 'professional' || productType === 'both') && (
            <Card>
                <CardHeader>
                    <CardTitle>Professional Costing</CardTitle>
                    <CardDescription>How much does it cost to use this once in a service?</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                     <div className="space-y-2">
                        <Label>Costing Method</Label>
                        <Controller
                            name="costingMethod"
                            control={control}
                            render={({ field }) => (
                                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                                    <div>
                                        <RadioGroupItem value="by-size" id="by-size" className="peer sr-only" />
                                        <Label htmlFor="by-size" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Size</Label>
                                    </div>
                                    <div>
                                        <RadioGroupItem value="by-uses" id="by-uses" className="peer sr-only" />
                                        <Label htmlFor="by-uses" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Uses</Label>
                                    </div>
                                </RadioGroup>
                            )}
                        />
                    </div>

                    {costingMethod === 'by-size' ? (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="container-size">Container Size</Label>
                                <Input id="container-size" type="number" placeholder="e.g., 1000" {...register('containerSize')} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="unit">Unit</Label>
                                 <Controller
                                    name="unit"
                                    control={control}
                                    render={({ field }) => (
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <SelectTrigger id="unit">
                                                <SelectValue placeholder="Select unit" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="g">gram (g)</SelectItem>
                                                <SelectItem value="kg">kilogram (kg)</SelectItem>
                                                <SelectItem value="oz_wt">ounce (oz)</SelectItem>
                                                <SelectItem value="lb">pound (lb)</SelectItem>
                                                <SelectItem value="ml">milliliter (ml)</SelectItem>
                                                <SelectItem value="l">liter (l)</SelectItem>
                                                <SelectItem value="oz_fl">fluid ounce (fl oz)</SelectItem>
                                                <SelectItem value="pt">pint (pt)</SelectItem>
                                                <SelectItem value="qt">quart (qt)</SelectItem>
                                                <SelectItem value="gal">gallon (gal)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                 />
                            </div>
                        </div>
                    ) : (
                         <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="estimated-uses">Estimated Quantity</Label>
                                <Input id="estimated-uses" type="number" placeholder="e.g., 160" {...register('estimatedUses')} />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="use-unit">Dispensing Unit</Label>
                                <Controller
                                    name="useUnit"
                                    control={control}
                                    render={({ field }) => (
                                        <Select onValueChange={(value) => { field.onChange(value); setShowCustomUseUnit(value === 'other'); }} defaultValue={field.value}>
                                            <SelectTrigger id="use-unit">
                                                <SelectValue placeholder="Select dispensing unit" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="each">each</SelectItem>
                                                <SelectItem value="piece">piece</SelectItem>
                                                <SelectItem value="set">set</SelectItem>
                                                <SelectItem value="pair">pair</SelectItem>
                                                <SelectItem value="sheet">sheet</SelectItem>
                                                <SelectItem value="capsule">capsule</SelectItem>
                                                <SelectItem value="tablet">tablet</SelectItem>
                                                <SelectItem value="wipe">wipe</SelectItem>
                                                <SelectItem value="pumps">pumps</SelectItem>
                                                <SelectItem value="sprays">sprays</SelectItem>
                                                <SelectItem value="drops">drops</SelectItem>
                                                <SelectItem value="applications">applications</SelectItem>
                                                <SelectItem value="treatments">treatments</SelectItem>
                                                <SelectItem value="scoops">scoops</SelectItem>
                                                <SelectItem value="uses">uses</SelectItem>
                                                <SelectItem value="services">services</SelectItem>
                                                <SelectItem value="other">Other...</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                            </div>
                            {showCustomUseUnit && (
                                <div className="space-y-2 col-span-2">
                                    <Label htmlFor="custom-use-unit">Custom Unit Name</Label>
                                    <Input id="custom-use-unit" placeholder="Enter your custom unit" {...register('customUseUnit')} />
                                </div>
                            )}
                        </div>
                    )}
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center space-x-2">
                            <Controller name="isExperimentActive" control={control} render={({ field }) => <Switch id="cost-experiment" checked={field.value} onCheckedChange={field.onChange} />} />
                            <Label htmlFor="cost-experiment">Cost-Per-Use Experiment</Label>
                        </div>
                        <Info className="h-4 w-4 text-muted-foreground" />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="restocking-markup">Restocking Markup</Label>
                        <div className="relative">
                            <Input id="restocking-markup" type="number" placeholder="e.g., 5" className="pl-8" {...register('restockingMarkup')} />
                             <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        )}

        { (productType === 'retail' || productType === 'both') && (
            <Card>
                <CardHeader>
                    <CardTitle>Retail Pricing</CardTitle>
                    <CardDescription>How much will clients pay for this product?</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="msrp">MSRP</Label>
                        <Input id="msrp" type="number" placeholder="0.00" {...register('msrp')} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="markdown-price">Markdown Price</Label>
                        <Input id="markdown-price" type="number" placeholder="Optional sale price" {...register('markdownPrice')} />
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
                        <Input id="total-cost" type="number" placeholder="From invoice" {...register('totalCostOfGoods')} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="num-units">Number of Units</Label>
                        <Input id="num-units" type="number" placeholder="In shipment" {...register('numberOfUnits')} />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="shipping">Shipping</Label>
                        <Input id="shipping" type="number" placeholder="0.00" {...register('shipping')} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="taxes">Taxes</Label>
                        <Input id="taxes" type="number" placeholder="0.00" {...register('taxes')} />
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


const Step3_InventorySupplier = ({ onAddLocationClick, locations }: { onAddLocationClick: () => void, locations: Location[] }) => {
    const { register, control } = useFormContext<ProductFormData>();
    const [secondaryLocations, setSecondaryLocations] = useState<string[]>([]);
    const addSecondaryLocation = () => setSecondaryLocations(prev => [...prev, `loc-${Date.now()}`]);
    const removeSecondaryLocation = (id: string) => setSecondaryLocations(prev => prev.filter(locId => locId !== id));

    return (
    <div className="grid gap-6 py-4">
        <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
                <Label htmlFor="vendor">Vendor</Label>
                 <Controller
                    name="vendor"
                    control={control}
                    render={({ field }) => (
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select vendor" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="vendor-a">Vendor A</SelectItem>
                                <SelectItem value="vendor-b">Vendor B</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                 />
            </div>
             <div className="space-y-2">
                <Label htmlFor="sku">SKU</Label>
                <Input id="sku" placeholder="Product SKU" {...register('sku')} />
            </div>
        </div>
         <div className="space-y-2">
            <Label htmlFor="low-stock-point">Low Stock Point</Label>
            <Input id="low-stock-point" type="number" placeholder="e.g., 5" {...register('reorderPoint')} />
        </div>

        <Card>
            <CardHeader>
                <CardTitle>Storage Locations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>Primary Location</Label>
                    <div className="flex gap-2">
                        <Controller
                            name="primaryLocationId"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select primary location" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {locations.map(loc => (
                                            <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                         <Button variant="outline" size="icon" onClick={onAddLocationClick} type="button"><PlusCircle className="h-4 w-4" /></Button>
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
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeSecondaryLocation(locId)} type="button"><Trash2 className="h-4 w-4" /></Button>
                            </div>
                        </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addSecondaryLocation} type="button"><PlusCircle className="mr-2 h-4 w-4" />Add Secondary Location</Button>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Initial Stock</CardTitle>
                <CardDescription>Log the first batch of this product you have on hand.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="initial-quantity">Quantity</Label>
                    <Input id="initial-quantity" type="number" placeholder="0" {...register('initialQuantity')} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="expiration-date">Expiration Date</Label>
                    <Input id="expiration-date" type="date" {...register('expirationDate')} />
                </div>
            </CardContent>
        </Card>

    </div>
    )
};

const DialogStateContext = React.createContext<{
    categories: string[];
    setCategories: React.Dispatch<React.SetStateAction<string[]>>;
} | null>(null);

const useDialogState = () => {
    const context = React.useContext(DialogStateContext);
    if (!context) {
        throw new Error("useDialogState must be used within a DialogStateProvider");
    }
    return context;
};

export const AddProductDialog = ({ 
    open, 
    onOpenChange, 
    locations,
    locationTypes,
    onProductAdded,
    initialCategories,
}: { 
    open: boolean, 
    onOpenChange: (open: boolean) => void, 
    locations: Location[],
    locationTypes: LocationType[],
    onProductAdded: (product: any) => void;
    initialCategories: string[];
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  const [isAddLocationDialogOpen, setIsAddLocationDialogOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>(initialCategories);

  useEffect(() => {
    if (open) {
      setCategories(initialCategories);
    }
  }, [initialCategories, open]);

  const methods = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
        type: 'professional',
        costingMethod: 'by-size',
        isExperimentActive: false,
    }
  });

  const productType = methods.watch('type');

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
        setTimeout(() => {
            setStep(1);
            methods.reset();
        }, 300);
    }
  }
  
  const onSubmit = (data: ProductFormData) => {
    onProductAdded(data);
    handleOpenChange(false);
  };

  const handleNext = async () => {
    const fieldsToValidate: (keyof ProductFormData)[] = [];
    if (step === 1) {
        fieldsToValidate.push('name', 'category');
    }
    
    const isValid = await methods.trigger(fieldsToValidate);
    
    if (isValid && step < totalSteps) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
            <DialogStateContext.Provider value={{ categories, setCategories }}>
                <FormProvider {...methods}>
                    <form onSubmit={methods.handleSubmit(onSubmit)}>
                    <DialogHeader>
                        <DialogTitle>Add New Product</DialogTitle>
                        <DialogDescription>Create a new professional or retail product for your inventory.</DialogDescription>
                    </DialogHeader>

                    <div className="py-4 space-y-4">
                        <Progress value={(step / totalSteps) * 100} />
                        <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-4">
                            {step === 1 && <Step1_Basics />}
                            {step === 2 && <Step2_CostingPricing productType={productType} />}
                            {step === 3 && <Step3_InventorySupplier onAddLocationClick={() => setIsAddLocationDialogOpen(true)} locations={locations}/>}
                        </div>
                    </div>

                    <DialogFooter>
                        <div className='flex justify-between w-full'>
                            <div>
                            {step > 1 && <Button variant="outline" onClick={handleBack} type="button">Back</Button>}
                            </div>
                            <div className="flex gap-2">
                            <Button variant="outline" onClick={() => handleOpenChange(false)} type="button">Cancel</Button>
                            {step < totalSteps && <Button onClick={handleNext} type="button">Next</Button>}
                            {step === totalSteps && <Button type="submit">Save Product</Button>}
                            </div>
                        </div>
                    </DialogFooter>
                    </form>
                </FormProvider>
            </DialogStateContext.Provider>
        </DialogContent>
      </Dialog>
      <AddLocationDialog 
          open={isAddLocationDialogOpen} 
          onOpenChange={setIsAddLocationDialogOpen}
          onSave={() => {}}
          locationTypes={locationTypes}
          onAddNewLocationType={() => ({ id: '', name: '', icon: '' })}
      />
    </>
  );
};
