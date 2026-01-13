

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
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusCircle, Package, Hammer, Trash2, QrCode, Check, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { inventory, services as allServices, type Service, type InventoryItem } from '@/lib/data';
import { BrowseProductsDialog } from './BrowseProductsDialog';
import { SelectEquipmentDialog } from './SelectEquipmentDialog';
import { SelectAddOnsDialog } from './SelectAddOnsDialog';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useForm, FormProvider, useFormContext, Controller, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';


const serviceSchema = z.object({
    name: z.string().min(1, 'Service name is required'),
    category: z.string().min(1, 'Category is required'),
    duration: z.number({ invalid_type_error: 'Duration is required.' }).min(1, 'Duration must be at least 1 minute'),
    padBefore: z.number().optional(),
    padAfter: z.number().optional(),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    isPrivate: z.boolean().optional(),
    isAddon: z.boolean().optional(),
    
    products: z.array(z.any()).optional(),
    equipment: z.array(z.any()).optional(),
    addOns: z.array(z.any()).optional(),
    
    depositType: z.enum(['none', 'deposit', 'full']),
    depositAmount: z.number().optional(),
    
    pricingStrategy: z.enum(['manual', 'auto']),
    price: z.number().optional(),
    margin: z.number().optional(),
});

type ServiceFormData = z.infer<typeof serviceSchema>;


const Step1_Basics = ({ 
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
        if (newCategoryName.trim()) {
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
      <div className='space-y-1'>
        <Label htmlFor="is-addon">Is this an Add-on Service?</Label>
        <p className='text-sm text-muted-foreground'>Add-ons can be appended to primary services.</p>
      </div>
      <Controller
        name="isAddon"
        control={control}
        render={({ field }) => (
          <Switch id="is-addon" checked={field.value} onCheckedChange={field.onChange} />
        )}
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="service-name">Name</Label>
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
         
          <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button"><PlusCircle className="h-4 w-4" /></Button>
        </div>
      )}
       {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>}
    </div>
    <div className="grid grid-cols-3 gap-4">
      <div className="space-y-2">
        <Label htmlFor="duration">Duration (min)</Label>
        <Input id="duration" type="number" placeholder="e.g., 60" {...register('duration', { valueAsNumber: true })}/>
        {errors.duration && <p className="text-sm text-destructive">{errors.duration.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="pad-before">Pad Before (min)</Label>
        <Input id="pad-before" type="number" placeholder="e.g., 0" {...register('padBefore', { valueAsNumber: true })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pad-after">Pad After (min)</Label>
        <Input id="pad-after" type="number" placeholder="e.g., 15" {...register('padAfter', { valueAsNumber: true })} />
      </div>
    </div>
    <div className="space-y-2">
      <Label htmlFor="description">Description</Label>
      <Textarea id="description" placeholder="Describe the service for your booking page..." {...register('description')} />
    </div>
    <div className="space-y-2">
      <Label>Service Image</Label>
       <Controller
        name="imageUrl"
        control={control}
        render={({ field }) => (
          <ImageUpload onImageUploaded={field.onChange} />
        )}
      />
    </div>
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className='space-y-1'>
        <Label htmlFor="private-service">Private Service</Label>
        <p className='text-sm text-muted-foreground'>Hide from public booking page.</p>
      </div>
      <Controller
        name="isPrivate"
        control={control}
        render={({ field }) => (
          <Switch id="private-service" checked={field.value} onCheckedChange={field.onChange} />
        )}
      />
    </div>
     <div className="space-y-2">
      <Label>Required Consent Forms</Label>
      <Card>
        <CardContent className="p-4 text-center text-sm text-muted-foreground">
          Consent form selection will go here.
        </CardContent>
      </Card>
    </div>
  </div>
    );
};

const Step2_Formula = ({ onScanClick }: { onScanClick: () => void; }) => {
    const { control, watch, setValue } = useFormContext<ServiceFormData>();
    const selectedProducts = watch('products') || [];
    const selectedEquipment = watch('equipment') || [];
    const selectedAddOns = watch('addOns') || [];
    const isAddon = watch('isAddon');

    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    const [isEquipmentSelectorOpen, setIsEquipmentSelectorOpen] = useState(false);
    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);

    const handleProductSelect = (products: InventoryItem[]) => {
        setValue('products', products);
        setIsProductBrowserOpen(false);
    };
    
    const handleEquipmentSelect = (equipment: InventoryItem[]) => {
        setValue('equipment', equipment);
        setIsEquipmentSelectorOpen(false);
    };
    
    const handleAddOnSelect = (addOns: Service[]) => {
        setValue('addOns', addOns);
        setIsAddOnSelectorOpen(false);
    };

    const removeProduct = (productId: string) => {
        setValue('products', selectedProducts.filter(p => p.id !== productId));
    };

    const removeEquipment = (equipmentId: string) => {
        setValue('equipment', selectedEquipment.filter(e => e.id !== equipmentId));
    };
    
    const removeAddOn = (addOnId: string) => {
        setValue('addOns', selectedAddOns.filter(a => a.id !== addOnId));
    };

    return (
    <>
    <div className="grid gap-6 py-4">
        <div className="space-y-4">
            <div className="space-y-2">
                <div className='flex items-center gap-2'>
                    <Package className="w-5 h-5 text-primary" />
                    <Label className="text-lg font-semibold">Product Formula</Label>
                </div>
                {selectedProducts.length > 0 ? (
                    <Card>
                        <CardContent className="p-2 space-y-2">
                            {selectedProducts.map(product => (
                                <div key={product.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                                    <span className="text-sm font-medium">{product.name}</span>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeProduct(product.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                 ) : (
                    <Card>
                        <CardContent className="p-4 text-center text-sm text-muted-foreground">
                            No products added yet.
                        </CardContent>
                    </Card>
                 )}
                <div className='flex gap-2'>
                    <Button variant="outline" onClick={() => setIsProductBrowserOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Browse Library</Button>
                    <Button variant="outline" onClick={onScanClick} type="button"><QrCode className="mr-2 h-4 w-4" /> Scan to Add</Button>
                </div>
            </div>
        </div>
        <div className="space-y-4">
            <div className="space-y-2">
                 <div className='flex items-center gap-2'>
                    <Hammer className="w-5 h-5 text-primary" />
                    <Label className="text-lg font-semibold">Equipment Used</Label>
                </div>
                {selectedEquipment.length > 0 ? (
                    <Card>
                         <CardContent className="p-2 space-y-2">
                            {selectedEquipment.map(item => (
                                <div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                                    <span className="text-sm font-medium">{item.name}</span>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeEquipment(item.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <CardContent className="p-4 text-center text-sm text-muted-foreground">
                            No equipment added.
                        </CardContent>
                    </Card>
                )}
                <Button variant="outline" onClick={() => setIsEquipmentSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Equipment</Button>
            </div>
        </div>
        {!isAddon && (
             <div className="space-y-4">
                <div className="space-y-2">
                    <div className='flex items-center gap-2'>
                        <PlusCircle className="w-5 h-5 text-primary" />
                        <Label className="text-lg font-semibold">Compatible Add-ons</Label>
                    </div>
                    {selectedAddOns.length > 0 ? (
                        <Card>
                            <CardContent className="p-2 space-y-2">
                                {selectedAddOns.map(item => (
                                    <div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                                        <span className="text-sm font-medium">{item.name}</span>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAddOn(item.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    ) : (
                        <Card>
                            <CardContent className="p-4 text-center text-sm text-muted-foreground">
                                No add-ons selected.
                            </CardContent>
                        </Card>
                    )}
                    <Button variant="outline" onClick={() => setIsAddOnSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Add-ons</Button>
                </div>
            </div>
        )}
    </div>
    <BrowseProductsDialog
        open={isProductBrowserOpen}
        onOpenChange={setIsProductBrowserOpen}
        onSelect={handleProductSelect}
        allProducts={inventory.filter(i => i.type === 'professional' || i.type === 'retail')}
        initialSelected={selectedProducts}
    />
     <SelectEquipmentDialog
        open={isEquipmentSelectorOpen}
        onOpenChange={setIsEquipmentSelectorOpen}
        onSelect={handleEquipmentSelect}
        allEquipment={inventory.filter(i => i.type === 'equipment')}
        initialSelected={selectedEquipment}
    />
    <SelectAddOnsDialog
        open={isAddOnSelectorOpen}
        onOpenChange={setIsAddOnSelectorOpen}
        onSelect={handleAddOnSelect}
        allAddOns={allServices.filter(s => s.type === 'addon')}
        initialSelected={selectedAddOns}
    />
    </>
    );
};

const Step3_Deposits = () => {
    const { control, watch, register } = useFormContext<ServiceFormData>();
    const depositType = watch('depositType');
    
    return (
        <div className="grid gap-6 py-4">
             <div className="space-y-2">
                <Label>Deposit Requirement</Label>
                <Controller
                    name="depositType"
                    control={control}
                    defaultValue="none"
                    render={({ field }) => (
                         <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="grid grid-cols-3 gap-2"
                        >
                            <div>
                                <RadioGroupItem value="none" id="none" className="peer sr-only" />
                                <Label htmlFor="none" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">None</Label>
                            </div>
                            <div>
                                <RadioGroupItem value="deposit" id="deposit" className="peer sr-only" />
                                <Label htmlFor="deposit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Deposit</Label>
                            </div>
                            <div>
                                <RadioGroupItem value="full" id="full" className="peer sr-only" />
                                <Label htmlFor="full" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Pay in Full</Label>
                            </div>
                        </RadioGroup>
                    )}
                />
               
            </div>

            {depositType === 'deposit' && (
                 <Card className="bg-muted/50">
                    <CardContent className="p-4 space-y-4">
                         <div className="space-y-2">
                            <Label>Deposit Type</Label>
                            <Select>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select deposit type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="flat">Flat Rate</SelectItem>
                                    <SelectItem value="percentage">Percentage</SelectItem>
                                    <SelectItem value="break-even">Break-Even Cost</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Deposit Amount</Label>
                            <Input type="number" placeholder="25.00" {...register('depositAmount', { valueAsNumber: true })} />
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

const PricingForm = () => {
    const { control, watch, register, setValue } = useFormContext<ServiceFormData>();
    const [tmhr, setTmhr] = useState(0);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const storedTmhr = localStorage.getItem('tmhr');
            if (storedTmhr) {
                setTmhr(parseFloat(storedTmhr));
            }
        }
    }, []);

    const formValues = watch();
    const {
        pricingStrategy,
        duration,
        padBefore,
        padAfter,
        products: selectedProducts,
        equipment: selectedEquipment,
        margin,
        price: manualPrice,
    } = formValues;
    
    const timeCost = useMemo(() => {
        const totalDuration = (duration || 0) + (padBefore || 0) + (padAfter || 0);
        return (totalDuration / 60) * tmhr;
    }, [duration, padBefore, padAfter, tmhr]);

    const productCost = useMemo(() => {
        return (selectedProducts || []).reduce((acc: number, p: any) => {
            const product = inventory.find(i => i.id === p.id);
            return acc + (product?.costPerUnit || 0);
        }, 0);
    }, [selectedProducts]);
    
    const equipmentDepreciation = useMemo(() => {
        return (selectedEquipment || []).reduce((acc: any, eq: any) => {
            const equipmentItem = inventory.find(i => i.id === eq.id);
            if (!equipmentItem) return acc;
            const totalDuration = (duration || 0) + (padBefore || 0) + (padAfter || 0);
            const lifespanInMinutes = (equipmentItem.lifespanYears || 5) * 365 * 8 * 60; // Assuming 8hr work day
            const costPerMinute = (equipmentItem.costPerUnit || 0) / lifespanInMinutes;
            return acc + (costPerMinute * totalDuration);
        }, 0);
    }, [selectedEquipment, duration, padBefore, padAfter]);

    const breakEvenCost = timeCost + productCost + equipmentDepreciation;

    let finalPrice = 0;
    if (pricingStrategy === 'manual') {
        finalPrice = manualPrice || 0;
    } else {
        const currentMargin = margin ?? 60;
        if (breakEvenCost > 0 && currentMargin > 0 && (1 - (currentMargin / 100)) > 0) {
            finalPrice = breakEvenCost / (1 - (currentMargin / 100));
        } else {
            finalPrice = breakEvenCost; // if margin is 0 or 100, price equals cost
        }
    }
    
    useEffect(() => {
        if (pricingStrategy === 'auto') {
            setValue('price', finalPrice, { shouldTouch: true });
        }
    }, [pricingStrategy, finalPrice, setValue]);


    const netProfit = finalPrice - breakEvenCost;
    const profitMargin = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;

    return (
        <div className="grid gap-6 py-4">
            <div className="space-y-2">
                <Label>Pricing Strategy</Label>
                 <Controller
                    name="pricingStrategy"
                    control={control}
                    defaultValue="manual"
                    render={({ field }) => (
                        <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="grid grid-cols-2 gap-2"
                        >
                            <div>
                                <RadioGroupItem value="manual" id="manual" className="peer sr-only" />
                                <Label htmlFor="manual" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Manual</Label>
                            </div>
                            <div>
                                <RadioGroupItem value="auto" id="auto" className="peer sr-only" />
                                <Label htmlFor="auto" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Auto (Margin-Based)</Label>
                            </div>
                        </RadioGroup>
                    )}
                />
            </div>
            
            {pricingStrategy === 'manual' ? (
                <div className="space-y-2">
                    <Label htmlFor="final-price">Final Price</Label>
                    <Input id="final-price" type="number" placeholder="100.00" {...register('price', { valueAsNumber: true })} />
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex justify-between items-baseline">
                        <Label>Desired Profit Margin</Label>
                        <span className="text-2xl font-bold text-primary">{margin}%</span>
                    </div>
                     <Controller
                        name="margin"
                        control={control}
                        defaultValue={60}
                        render={({ field: { onChange, value, ...fieldProps } }) => (
                           <Slider
                                min={0}
                                max={100}
                                step={1}
                                onValueChange={(value) => onChange(value[0])}
                                value={[value || 60]}
                                {...fieldProps}
                            />
                        )}
                    />
                </div>
            )}

            <Card>
                <CardContent className="p-4 space-y-4">
                    <h4 className="font-semibold text-center">Profitability Preview</h4>
                    <div className="flex justify-between items-center p-4 rounded-lg bg-primary/10">
                        <div>
                        <p className="text-sm text-primary/80">Final Price</p>
                        <p className="text-2xl font-bold text-primary">${finalPrice.toFixed(2)}</p>
                        </div>
                    </div>
                     <div className="space-y-2 text-sm text-muted-foreground">
                        <div className="flex justify-between">
                            <span>Break-Even Cost:</span>
                            <span className="font-mono text-destructive">${breakEvenCost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-medium border-t pt-2 mt-2">
                            <span>Net Profit:</span>
                            <span className="text-primary">${netProfit.toFixed(2)}</span>
                        </div>
                         <div className="flex justify-between text-sm text-muted-foreground">
                            <span>Profit Margin:</span>
                            <span className="text-primary">{profitMargin.toFixed(1)}%</span>
                        </div>
                    </div>
                     <Progress value={profitMargin} className="h-2 text-green-500" />
                </CardContent>
            </Card>

        </div>
    );
};

export const AddServiceDialog = ({ 
    open, 
    onOpenChange,
    categories,
    onNewCategory,
    onServiceAdded
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    categories: string[];
    onNewCategory: (category: string) => void;
    onServiceAdded: (service: Service) => void;
}) => {
  const [step, setStep] = useState(1);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();
  
  const methods = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
        duration: undefined,
        padBefore: undefined,
        padAfter: undefined,
        isPrivate: false,
        isAddon: false,
        products: [],
        equipment: [],
        addOns: [],
        depositType: 'none',
        pricingStrategy: 'manual',
        margin: 60,
    }
  });

  const isAddon = methods.watch('isAddon');
  
  const totalSteps = isAddon ? 3 : 4;
  
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
      const price = data.price || 0;
      
      const duration = data.duration || 0;
      const padBefore = data.padBefore || 0;
      const padAfter = data.padAfter || 0;

      const tmhr = (typeof window !== 'undefined' && parseFloat(localStorage.getItem('tmhr') || '0')) || 0;
      const totalTime = duration + padBefore + padAfter;
      const timeCost = (totalTime / 60) * tmhr;
      const productCost = (data.products || []).reduce((acc: number, p: any) => {
        const product = inventory.find(i => i.id === p.id);
        return acc + (product?.costPerUnit || 0);
      }, 0);
      const equipmentDepreciation = (data.equipment || []).reduce((acc: any, eq: any) => {
          const equipmentItem = inventory.find(i => i.id === eq.id);
          if (!equipmentItem) return acc;
          const lifespanInMinutes = (equipmentItem.lifespanYears || 5) * 365 * 8 * 60;
          const costPerMinute = (equipmentItem.costPerUnit || 0) / lifespanInMinutes;
          return acc + (costPerMinute * totalTime);
      }, 0);
      const breakEvenCost = timeCost + productCost + equipmentDepreciation;
      const netProfit = price - breakEvenCost;
      const margin = price > 0 ? (netProfit / price) * 100 : 0;
      
      const newService: Service = {
        id: `svc-${Date.now()}`,
        name: data.name,
        type: data.isAddon ? 'addon' : 'service',
        category: data.category || 'Uncategorized',
        duration: duration,
        padBefore: padBefore,
        padAfter: padAfter,
        price: price,
        cost: breakEvenCost,
        profit: netProfit,
        margin: margin,
        imageUrl: data.imageUrl,
        products: data.products,
        equipment: data.equipment,
        description: data.description,
      };
      
      onServiceAdded(newService);

      toast({
          title: `New ${data.isAddon ? 'Add-on' : 'Service'} Created`,
          description: `${data.name} has been added to your library.`
      })
      handleOpenChange(false);
  }

  const handleNext = async () => {
    const fieldsToValidate: (keyof ServiceFormData)[] = [];
    if (step === 1) {
        fieldsToValidate.push('name', 'duration', 'category');
    }
    
    const isValid = fieldsToValidate.length > 0 ? await methods.trigger(fieldsToValidate) : true;
    
    if (isValid && step < totalSteps) {
      setStep(step + 1);
    }
  };

  const handleBack = () => step > 1 && setStep(step - 1);

   useEffect(() => {
    if (isScannerOpen) {
      const getCameraPermission = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          setHasCameraPermission(true);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        } catch (error) {
          console.error('Error accessing camera:', error);
          setHasCameraPermission(false);
          toast({
            variant: 'destructive',
            title: 'Camera Access Denied',
            description: 'Please enable camera permissions in your browser settings to use the scanner.',
          });
          setIsScannerOpen(false);
        }
      };
      getCameraPermission();
    } else {
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
    }
  }, [isScannerOpen, toast]);
  
  const getStepContent = () => {
    const stepMap = [
      <Step1_Basics key="step1" categories={categories} onNewCategory={onNewCategory} />,
      <Step2_Formula key="step2" onScanClick={() => setIsScannerOpen(true)} />,
    ];
    
    if (!isAddon) {
      stepMap.push(<Step3_Deposits key="step3" />);
    }
    
    // Always add the pricing step last
    stepMap.push(<PricingForm key="pricing" />);
    
    return stepMap[step - 1];
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)}>
            <DialogHeader>
                <DialogTitle>Add New {isAddon ? 'Add-on' : 'Service'}</DialogTitle>
                <DialogDescription>
                    Create a new {isAddon ? 'add-on' : 'service'} for your menu. Follow the steps to ensure accurate pricing.
                </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-4">
            <Progress value={(step / totalSteps) * 100} />
            <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-4">
                {getStepContent()}
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
                        <Button type="submit">Save {isAddon ? 'Add-on' : 'Service'}</Button>
                    )}
                </div>
            </div>
            </DialogFooter>
        </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
    <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Scan Product</DialogTitle>
            <DialogDescription>
              Position the product's barcode or QR code inside the frame.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 relative">
             <video ref={videoRef} className="w-full aspect-square rounded-md bg-muted" autoPlay muted playsInline />
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>
            {hasCameraPermission === false && (
                <Alert variant="destructive" className="mt-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Camera Access Required</AlertTitle>
                    <AlertDescription>
                        Please enable camera access to use the scanner. You may need to change permissions in your browser settings.
                    </AlertDescription>
                </Alert>
            )}
          </div>
           <DialogFooter className="p-4 pt-0">
                <Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
