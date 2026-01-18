
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
import { Check, PlusCircle, QrCode, AlertTriangle, Hammer, Trash2, Package, DollarSign } from 'lucide-react';
import { inventory, services as allServices, type Service, consentForms, type ConsentForm } from '@/lib/data';
import { BrowseProductsDialog } from './BrowseProductsDialog';
import { SelectEquipmentDialog } from './SelectEquipmentDialog';
import { SelectAddOnsDialog } from './SelectAddOnsDialog';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { BrowseConsentFormsDialog } from './BrowseConsentFormsDialog';
import { cn } from '@/lib/utils';
import { Switch } from '../ui/switch';

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
    depositSubType: z.string().optional(),
    depositAmount: z.number().optional(),
    
    price: z.number().optional(),
    confirmationMessage: z.string().optional(),
    requiredFormIds: z.array(z.string()).optional(),
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
    
    return (
    <>
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
                        <SelectTrigger> <SelectValue placeholder="Select a category" /> </SelectTrigger>
                        <SelectContent> {categories.map(cat => ( <SelectItem key={cat} value={cat}>{cat}</SelectItem> ))} </SelectContent>
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
                <Label htmlFor="confirmationMessage">Confirmation Message</Label>
                <Textarea id="confirmationMessage" placeholder="Optional: A message to show clients after they book this service." {...register('confirmationMessage')} />
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
                {requiredForms.length > 0 ? (
                    <Card>
                        <CardContent className="p-2 space-y-2">
                            {requiredForms.map(form => (
                                <div key={form.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                                    <span className="text-sm font-medium">{form.title}</span>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveForm(form.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <CardContent className="p-4 text-center text-sm text-muted-foreground">
                            No forms required.
                        </CardContent>
                    </Card>
                )}
                <Button variant="outline" onClick={() => setIsConsentFormBrowserOpen(true)} type="button" className="w-full">
                    <PlusCircle className="mr-2 h-4 w-4" /> Browse Forms
                </Button>
            </div>
        </div>
        <BrowseConsentFormsDialog
            open={isConsentFormBrowserOpen}
            onOpenChange={setIsConsentFormBrowserOpen}
            onSelect={(forms) => {
                setValue('requiredFormIds', forms.map(f => f.id), { shouldDirty: true });
            }}
            allForms={consentForms}
            initialSelected={requiredForms}
        />
    </>
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

const Step3_Deposits = ({ breakEvenCost }: { breakEvenCost: number }) => {
    const { control, watch, setValue } = useFormContext<ServiceFormData>();
    const depositType = watch('depositType');
    const depositSubType = watch('depositSubType');

    useEffect(() => {
        if (depositType === 'deposit' && depositSubType === 'break-even') {
            setValue('depositAmount', breakEvenCost, { shouldValidate: true });
        }
    }, [depositType, depositSubType, breakEvenCost, setValue]);
    
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
                            value={field.value}
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
                             <Controller
                                name="depositSubType"
                                control={control}
                                render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select deposit type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="flat">Flat Rate</SelectItem>
                                            <SelectItem value="percentage">Percentage</SelectItem>
                                            <SelectItem value="break-even">Break-Even Cost</SelectItem>
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Deposit Amount</Label>
                            <Controller
                                name="depositAmount"
                                control={control}
                                render={({ field }) => {
                                    const isBreakEven = depositSubType === 'break-even';
                                    const isPercentage = depositSubType === 'percentage';
                                    
                                    let displayValue: string | number = field.value || '';
                                    if (isBreakEven && typeof field.value === 'number') {
                                        displayValue = field.value.toFixed(2);
                                    }

                                    return (
                                        <div className="relative">
                                            {!isPercentage && (
                                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            )}
                                            <Input 
                                                type={isBreakEven ? "text" : "number"}
                                                placeholder={isPercentage ? '%' : '25.00'}
                                                {...field}
                                                value={displayValue}
                                                onChange={e => {
                                                    if (!isBreakEven) {
                                                        field.onChange(parseFloat(e.target.value) || 0)
                                                    }
                                                }}
                                                readOnly={isBreakEven}
                                                className={cn(!isPercentage && "pl-8")}
                                            />
                                            {isPercentage && (
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                                            )}
                                        </div>
                                    )
                                }}
                            />
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

const PricingPreview = ({ breakEvenCost }: { breakEvenCost: number }) => {
    const { watch } = useFormContext<ServiceFormData>();
    const price = watch('price');
    
    const finalPrice = price || 0;
    const netProfit = finalPrice - breakEvenCost;
    const profitMargin = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;
    
    return (
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
    )
}


const PricingForm = ({ breakEvenCost }: { breakEvenCost: number }) => {
    const { register } = useFormContext<ServiceFormData>();

    return (
        <div className="grid gap-6 py-4">
            <div className="space-y-2">
                <Label htmlFor="final-price">Final Price</Label>
                <Input id="final-price" type="number" placeholder="100.00" {...register('price', { valueAsNumber: true })} />
            </div>
            <PricingPreview breakEvenCost={breakEvenCost} />
        </div>
    );
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
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
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

  const isAddon = methods.watch('isAddon');
  const values = methods.watch();
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

  const handleSave = () => {
    methods.handleSubmit(onSubmit)();
  };

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
      stepMap.push(<Step3_Deposits key="step3" breakEvenCost={breakEvenCost} />);
    }
    
    stepMap.push(<PricingForm key="pricing" breakEvenCost={breakEvenCost} />);
    
    return stepMap[step - 1];
  }
  
  const formId = `add-service-form`;
  const title = `Add New ${isAddon ? 'Add-on' : 'Service'}`;
  const description = "Create a new service for your menu. Follow the steps to ensure accurate pricing.";

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
              {step < totalSteps && (
                <Button onClick={handleNext} type="button">Next</Button>
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
